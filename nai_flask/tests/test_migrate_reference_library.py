import io

import pytest
from PIL import Image

from api_utils.local_image_library import LocalImageLibrary
from api_utils.local_store import LocalJsonStore
from api_utils.migrate_reference_library import MIGRATION_NAME, migrate_reference_library
from api_utils.reference_store import ReferenceStore


class RecordingLibrary:
    """模拟图库按指定 ID 幂等导入，并注入中断验证恢复流程。"""

    def __init__(self):
        self.images = {}
        self.groups = {}
        self.migrations = set()
        self.fail_image = None
        self.fail_marker = False

    def has_migration(self, name):
        return name in self.migrations

    def mark_migration(self, name):
        if self.fail_marker:
            raise OSError("Synthetic interruption before migration marker")
        self.migrations.add(name)

    def create_group(self, name, *, source, group_id):
        return self.groups.setdefault(group_id, {"id": group_id, "name": name, "source": source})

    def list_groups(self, source):
        return [group for group in self.groups.values() if group["source"] == source]

    def import_image(self, data, filename, **fields):
        if filename == self.fail_image:
            raise OSError("Synthetic image write interruption")
        return self.images.setdefault(fields["image_id"], {"data": data, "filename": filename, **fields})


def add_reference(store, kind, reference_id, image_ids=(), image_bytes=None):
    """添加不依赖真实账户或个人图片的旧参考记录。"""
    return store.create(kind, {
        "id": reference_id,
        "title": "Synthetic reference",
        "prompt": f"test prompt {reference_id}",
        "parameters": {"seed": 42, "negativePrompt": "test negative", "steps": 23},
        "created_at": "2026-01-01",
    }, [{
        "id": image_id,
        "original_name": f"{image_id}.png",
        "mime_type": "image/png",
        "data": image_bytes if image_bytes is not None else f"synthetic bytes {image_id}".encode(),
    } for image_id in image_ids])


def test_migration_preserves_images_parameters_notes_and_original_store(tmp_path):
    legacy = ReferenceStore(tmp_path / "data", tmp_path / "public")
    local = LocalJsonStore(tmp_path / "data")
    library = RecordingLibrary()
    add_reference(legacy, "artist", "artist-multiple", ("artist-a", "artist-b"))
    add_reference(legacy, "image", "image-single", ("image-a",))
    add_reference(legacy, "artist", "artist-text")
    add_reference(legacy, "image", "image-text")
    local.write("notes", [{"id": "existing", "title": "Synthetic reference", "text_content1": "Keep me"}])
    original_records = {kind: legacy.list(kind) for kind in ("artist", "image")}

    migrate_reference_library(library, legacy, local)

    assert library.has_migration(MIGRATION_NAME)
    assert len(library.images) == 3
    assert len(library.groups) == 1
    artist_images = [image for image in library.images.values() if image["style_prompt"]]
    assert len(artist_images) == 2
    assert artist_images[0]["group_id"] == artist_images[1]["group_id"]
    for image in artist_images:
        assert image["prompt"] == image["style_prompt"] == "test prompt artist-multiple"
        assert image["parameters"]["seed"] == 42
        assert image["negative_prompt"] == "test negative"
        assert image["source"] == "references"
    single = next(image for image in library.images.values() if image["filename"] == "image-a.png")
    assert single["group_id"] is None
    assert single["style_prompt"] == ""
    assert single["parameters"]["steps"] == 23
    notes = local.read("notes")
    assert len(notes) == 3
    assert notes[0] == {"id": "existing", "title": "Synthetic reference", "text_content1": "Keep me"}
    assert len({note["title"] for note in notes}) == 3
    assert all(note["text_content2"] == "test negative" for note in notes[1:])
    assert all(note["parameters"]["seed"] == 42 for note in notes[1:])
    assert {kind: legacy.list(kind) for kind in ("artist", "image")} == original_records
    assert legacy.image("image-a")["image_data"] == b"synthetic bytes image-a"

    # 完成后用户删掉新库内容，旧源记录也不会在下次启动时将其复活。
    library.images.clear()
    local.write("notes", [notes[0]])
    migrate_reference_library(library, legacy, local)
    assert not library.images
    assert local.read("notes") == [notes[0]]


def test_interrupted_image_import_reuses_stable_ids_without_overwriting_edits(tmp_path):
    legacy = ReferenceStore(tmp_path / "data", tmp_path / "public")
    local = LocalJsonStore(tmp_path / "data")
    library = RecordingLibrary()
    add_reference(legacy, "artist", "artist-multiple", ("first", "second"))
    library.fail_image = "second.png"

    with pytest.raises(OSError, match="image write interruption"):
        migrate_reference_library(library, legacy, local)
    assert not library.has_migration(MIGRATION_NAME)
    assert len(library.images) == 1
    first_id = next(iter(library.images))
    library.images[first_id]["prompt"] = "Edited after interruption"

    library.fail_image = None
    migrate_reference_library(library, legacy, local)
    assert len(library.images) == 2
    assert len(library.groups) == 1
    assert library.images[first_id]["prompt"] == "Edited after interruption"
    assert library.has_migration(MIGRATION_NAME)


def test_interrupted_marker_does_not_duplicate_or_overwrite_migrated_notes(tmp_path):
    legacy = ReferenceStore(tmp_path / "data", tmp_path / "public")
    local = LocalJsonStore(tmp_path / "data")
    library = RecordingLibrary()
    add_reference(legacy, "image", "text-only")
    library.fail_marker = True

    with pytest.raises(OSError, match="migration marker"):
        migrate_reference_library(library, legacy, local)
    notes = local.read("notes")
    notes[0]["text_content1"] = "Edited after interruption"
    local.write("notes", notes)

    library.fail_marker = False
    migrate_reference_library(library, legacy, local)
    assert local.read("notes") == notes
    assert library.has_migration(MIGRATION_NAME)


def test_real_library_migrates_duplicate_group_names_and_retries_without_renaming(tmp_path, monkeypatch):
    legacy = ReferenceStore(tmp_path / "data", tmp_path / "public")
    local = LocalJsonStore(tmp_path / "data")
    library = LocalImageLibrary(tmp_path / "data")
    output = io.BytesIO()
    Image.new("RGB", (2, 2), (12, 34, 56)).save(output, "PNG")
    image_bytes = output.getvalue()
    for reference_id in ("same-title-first", "same-title-second"):
        add_reference(legacy, "artist", reference_id, (f"{reference_id}-a", f"{reference_id}-b"), image_bytes)
        legacy.update("artist", reference_id, "长" * 200, "synthetic prompt")

    # 已有同名新分组也不能被迁移占用或重新命名。
    original_group = library.create_group("长" * 200)
    mark_migration = library.mark_migration

    def fail_marker(name):
        raise OSError("Synthetic interruption after file migration")

    monkeypatch.setattr(library, "mark_migration", fail_marker)
    with pytest.raises(OSError, match="after file migration"):
        migrate_reference_library(library, legacy, local)
    groups = library.list_groups("references")
    assert len(groups) == 3
    assert len({group["name"] for group in groups}) == 3
    assert all(len(group["name"]) <= 200 for group in groups)
    assert all("旧参考" in group["name"] for group in groups if group["id"] != original_group["id"])
    images = library.list_images(source="references")["items"]
    assert len(images) == 4
    assert {group["count"] for group in groups if group["id"] != original_group["id"]} == {2}
    assert all(library.image_path(image["id"]).read_bytes() == image_bytes for image in images)
    assert all(image["prompt"] == image["style_prompt"] == "synthetic prompt" for image in images)

    migrated_group = next(group for group in groups if group["id"] != original_group["id"])
    library.update_group(migrated_group["id"], "User edited group")
    monkeypatch.setattr(library, "mark_migration", mark_migration)
    migrate_reference_library(library, legacy, local)
    assert library.has_migration(MIGRATION_NAME)
    assert len(library.list_groups("references")) == 3
    assert "User edited group" in {group["name"] for group in library.list_groups("references")}
    assert {image["id"] for image in library.list_images(source="references")["items"]} == {image["id"] for image in images}
