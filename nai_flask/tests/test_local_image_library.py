import gzip
import io
import json
import os
import sqlite3

import pytest
from PIL import Image, PngImagePlugin

from api_utils.custom_errors import ExposableError
from api_utils.local_image_library import LocalImageLibrary, normalize_image_parameters


def image_bytes(image_format="PNG", metadata=None, size=(48, 32)):
    """构造测试专用图片，不使用用户磁盘上的任何图像。"""
    image = Image.new("RGB", size, (30, 60, 90))
    output = io.BytesIO()
    options = {}
    if metadata is not None:
        if image_format == "PNG":
            pnginfo = PngImagePlugin.PngInfo()
            pnginfo.add_itxt("Comment", json.dumps(metadata))
            options["pnginfo"] = pnginfo
        elif image_format in {"JPEG", "WEBP"}:
            exif = Image.Exif()
            exif[37510] = b"ASCII\x00\x00\x00" + json.dumps(metadata).encode("utf-8")
            options["exif"] = exif
    image.save(output, image_format, **options)
    return output.getvalue()


def stealth_image_bytes():
    """按官方 alpha.T 顺序写入合成隐写参数，并同时加入常规文本和 EXIF。"""
    image = Image.new("RGBA", (96, 96), (30, 60, 90, 255))
    metadata = {"Comment": json.dumps({"prompt": "hidden original", "uc": "hidden negative", "seed": 456})}
    compressed = gzip.compress(json.dumps(metadata).encode("utf-8"))
    content = b"stealth_pngcomp" + (len(compressed) * 8).to_bytes(4, "big") + compressed
    pixels = image.load()
    for index in range(len(content) * 8):
        x, y = divmod(index, image.height)
        bit = (content[index // 8] >> (7 - index % 8)) & 1
        pixels[x, y] = (30, 60, 90, 254 | bit)
    pnginfo = PngImagePlugin.PngInfo()
    pnginfo.add_text("Comment", json.dumps({"prompt": "visible original", "seed": 123}))
    exif = Image.Exif()
    exif[270] = "private image description"
    output = io.BytesIO()
    image.save(output, "PNG", pnginfo=pnginfo, exif=exif)
    return output.getvalue()


@pytest.fixture
def library(tmp_path):
    return LocalImageLibrary(tmp_path / "data", tmp_path / "outputs")


def test_import_stores_files_and_index_persists_edits_groups_and_safe_ids(library):
    group = library.create_group("水彩", "references", group_id="legacy-group")
    original = image_bytes(metadata={"prompt": "old prompt", "uc": "bad", "scale": 6, "seed": 12})
    entry = library.import_image(original, "../../reference.exe", group_id=group["id"], image_id="stable-import")
    path = library.image_path(entry["id"])
    assert path.parent == library.roots["references"]
    assert path.suffix == ".png"
    assert path.read_bytes() == original
    assert entry["parameters"]["guidanceScale"] == 6
    assert entry["negative_prompt"] == "bad"
    library.update_image(entry["id"], {"prompt": "new prompt", "style_prompt": "watercolor"})

    restarted = LocalImageLibrary(library.data_dir, library.roots["outputs"])
    repeated = restarted.import_image(b"invalid does not overwrite", "other.png", image_id="stable-import")
    assert repeated["prompt"] == "new prompt"
    assert repeated["style_prompt"] == "watercolor"
    assert repeated["group_id"] == group["id"]
    assert restarted.list_groups("references")[0]["count"] == 1
    assert restarted.image_path(entry["id"]).read_bytes() == original
    assert restarted.delete_group(group["id"])
    assert restarted.get_image(entry["id"])["group_id"] is None
    assert path.exists()


def test_scan_formats_metadata_pagination_and_changed_or_missing_files(library, tmp_path):
    nested = library.roots["outputs"] / "nested"
    nested.mkdir()
    for image_format, suffix in (("PNG", "png"), ("JPEG", "jpg"), ("WEBP", "webp"), ("BMP", "bmp")):
        (nested / f"test.{suffix}").write_bytes(image_bytes(image_format, {"prompt": image_format, "steps": 23}))
    assert library.scan() == {"indexed": 4, "errors": []}
    assert library.scan() == {"indexed": 0, "errors": []}
    first = library.list_images("outputs", page_size=2)
    second = library.list_images("outputs", page=2, page_size=2)
    assert first["total"] == 4
    assert len(first["items"]) == len(second["items"]) == 2
    assert {row["id"] for row in first["items"]}.isdisjoint(row["id"] for row in second["items"])
    jpeg = library.list_images("outputs", query="JPEG")["items"][0]
    assert jpeg["parameters"]["steps"] == 23
    assert "UserComment" in library.get_image(jpeg["id"])["metadata"]
    path = library.image_path(jpeg["id"])
    path.write_bytes(image_bytes("JPEG", {"prompt": "changed", "steps": 28}))
    assert library.scan()["indexed"] == 1
    assert library.get_image(jpeg["id"])["prompt"] == "changed"
    path.rename(tmp_path / "outside.jpg")
    library.scan()
    assert library.list_images("outputs")["total"] == 3


def test_invalid_scan_reports_file_and_does_not_destroy_other_index_entries(library):
    original = library.import_image(image_bytes(), "saved.png", source="outputs")
    bad = library.roots["outputs"] / "corrupt.png"
    bad.write_bytes(b"not a picture")
    result = library.scan()
    assert result["indexed"] == 0
    assert result["errors"][0]["filename"] == "corrupt.png"
    assert library.get_image(original["id"])["filename"] == original["filename"]


def test_output_directory_switch_hides_old_records_and_blocks_direct_access(library, tmp_path):
    old = library.import_image(image_bytes(), "old.png", source="outputs")
    old_path = library.image_path(old["id"])
    reference = library.import_image(image_bytes(), "reference.png")
    library.configure_output_dir(tmp_path / "new-output")
    assert library.list_images("outputs")["total"] == 0
    assert library.get_image(reference["id"])["source"] == "references"
    with pytest.raises(ExposableError) as caught:
        library.image_path(old["id"])
    assert caught.value.status_code == 404
    assert old_path.exists()
    library.configure_output_dir(old_path.parent)
    assert library.image_path(old["id"]) == old_path


def test_path_escape_and_overlapping_library_roots_are_rejected(library, tmp_path):
    entry = library.import_image(image_bytes(), "safe.png")
    outside = tmp_path / "outside.png"
    outside.write_bytes(image_bytes())
    with sqlite3.connect(library.path) as db:
        db.execute("UPDATE library_images SET relative_path='../../outside.png' WHERE id=?", (entry["id"],))
    with pytest.raises(ExposableError) as caught:
        library.image_path(entry["id"])
    assert caught.value.code == "LIBRARY_PATH_INVALID"
    with pytest.raises(ExposableError):
        library.configure_output_dir(library.data_dir)
    assert outside.exists()


def test_recycle_preserves_bytes_groups_and_restore_does_not_overwrite(library, tmp_path):
    group = library.create_group("Keep", "outputs")
    content = image_bytes()
    entry = library.import_image(content, "generated.png", source="outputs", group_id=group["id"])
    original_path = library.image_path(entry["id"])
    trashed = library.trash_image(entry["id"])
    assert not original_path.exists()
    assert trashed["trashed_at"]
    assert library.list_images("outputs")["total"] == 0
    assert library.list_images("outputs", trashed=True)["total"] == 1
    assert library.image_path(entry["id"]).read_bytes() == content
    assert library.scan() == {"indexed": 0, "errors": []}
    original_path.write_bytes(b"occupying file")
    with pytest.raises(ExposableError) as caught:
        library.restore_image(entry["id"])
    assert caught.value.code == "LIBRARY_RESTORE_CONFLICT"
    assert original_path.read_bytes() == b"occupying file"
    original_path.rename(tmp_path / "occupying-file")
    restored = library.restore_image(entry["id"])
    assert restored["trashed_at"] is None
    assert restored["group_id"] == group["id"]
    assert original_path.read_bytes() == content


def test_group_source_boundaries_are_enforced(library):
    group = library.create_group("Outputs only", "outputs")
    reference = library.import_image(image_bytes(), "reference.png")
    with pytest.raises(ExposableError) as caught:
        library.update_image(reference["id"], {"group_id": group["id"]})
    assert caught.value.code == "LIBRARY_GROUP_INVALID"
    assert library.get_image(reference["id"])["group_id"] is None
    assert library.list_groups("references") == []
    assert library.list_images("references", group_id="__ungrouped")["total"] == 1
    reference_group = library.create_group("References only", "references")
    library.update_image(reference["id"], {"group_id": reference_group["id"]})
    assert library.list_images("references", group_id="__ungrouped")["total"] == 0
    assert library.list_images("references", group_id=reference_group["id"])["total"] == 1


def test_recycled_filename_can_be_reused_without_changing_old_record(library):
    original = image_bytes(metadata={"prompt": "old"})
    entry = library.import_image(original, "example.png", source="outputs")
    path = library.image_path(entry["id"])
    library.trash_image(entry["id"])
    replacement = image_bytes(metadata={"prompt": "new"})
    path.write_bytes(replacement)
    assert library.scan() == {"indexed": 1, "errors": []}
    current = library.list_images("outputs")["items"][0]
    assert current["id"] != entry["id"]
    assert current["prompt"] == "new"
    assert library.image_path(entry["id"]).read_bytes() == original
    with pytest.raises(ExposableError) as caught:
        library.restore_image(entry["id"])
    assert caught.value.code == "LIBRARY_RESTORE_CONFLICT"


def test_metadata_rewrite_and_strip_create_new_png_and_remove_old_stealth(library):
    original_bytes = stealth_image_bytes()
    entry = library.import_image(original_bytes, "original.png")
    assert entry["prompt"] == "hidden original"
    assert entry["parameters"]["seed"] == 456
    edited = library.save_metadata_copy(entry["id"], {
        "positivePrompt": "new prompt", "negativePrompt": "new negative",
        "steps": 28, "guidanceScale": 6.5, "model": "nai-diffusion-5-full", "seed": 789,
    })
    assert edited["source"] == "outputs"
    assert edited["prompt"] == "new prompt"
    assert edited["parameters"]["seed"] == 789
    assert "stealth" not in edited["metadata"]
    assert "private image description" not in json.dumps(edited["metadata"])
    partial_edit = library.save_metadata_copy(edited["id"], {"positivePrompt": "partial update"})
    assert partial_edit["prompt"] == "partial update"
    assert partial_edit["parameters"]["seed"] == 789
    assert partial_edit["parameters"]["steps"] == 28
    clean = library.save_metadata_copy(entry["id"], clear=True)
    assert clean["metadata"] == {}
    assert clean["prompt"] == ""
    assert clean["negative_prompt"] == ""
    assert "seed" not in clean["parameters"]
    assert library.image_path(entry["id"]).read_bytes() == original_bytes
    assert len({entry["id"], edited["id"], clean["id"]}) == 3
    with Image.open(library.image_path(clean["id"])) as image:
        assert image.getexif() == {}
        assert image.getchannel("A").getextrema() == (255, 255)
        assert image.convert("RGB").getpixel((0, 0)) == (30, 60, 90)


def test_stripping_metadata_preserves_fully_transparent_pixels(library):
    image = Image.new("RGBA", (10, 10), (12, 34, 56, 0))
    stream = io.BytesIO()
    image.save(stream, "PNG")
    entry = library.import_image(stream.getvalue(), "transparent.png")
    clean = library.save_metadata_copy(entry["id"], clear=True)
    with Image.open(library.image_path(clean["id"])) as result:
        assert result.getchannel("A").getextrema() == (0, 0)


def test_generated_files_preserve_existing_metadata_and_embed_missing_parameters(library):
    original = image_bytes(metadata={"prompt": "official prompt", "seed": 123, "steps": 23})
    saved = library.save_generated(original, "result.jpg", {"prompt": "request prompt", "seed": 99, "model": "nai-diffusion-5-full"})
    assert library.image_path(saved["id"]).read_bytes() == original
    assert saved["filename"].endswith(".png")
    assert saved["prompt"] == "official prompt"
    assert saved["parameters"]["seed"] == 123
    assert saved["parameters"]["model"] == "nai-diffusion-5-full"
    # 原图没有 model，但生成时已知模型：重启、重新扫描不能把索引补充的信息丢掉。
    restarted = LocalImageLibrary(library.data_dir, library.roots["outputs"])
    path = restarted.image_path(saved["id"])
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
    restarted.scan()
    assert restarted.get_image(saved["id"])["parameters"]["model"] == "nai-diffusion-5-full"
    assert path.read_bytes() == original

    tool = library.save_generated(image_bytes(), "upscale.png", {"prompt": "tool prompt", "negativePrompt": "avoid", "model": "nai-diffusion-4-5-full"})
    with Image.open(library.image_path(tool["id"])) as reopened:
        comment = json.loads(reopened.info["Comment"])
    assert comment["prompt"] == "tool prompt"
    assert comment["uc"] == "avoid"
    assert comment["model"] == "nai-diffusion-4-5-full"
    library.scan()
    assert library.get_image(tool["id"])["prompt"] == "tool prompt"


def test_import_merges_v4_characters_negative_prompts_and_exact_centers(library):
    entry = library.import_image(image_bytes(metadata={
        "model_name": "nai-diffusion-4-5-full",
        "v4_prompt": {"use_coords": True, "caption": {
            "base_caption": "two people",
            "char_captions": [
                {"char_caption": "first character", "centers": [{"x": 0.12, "y": 0.73}]},
                {"char_caption": "second character", "centers": [{"x": 0, "y": 0}]},
            ],
        }},
        "v4_negative_prompt": {"caption": {"base_caption": "bad background", "char_captions": [
            {"char_caption": "bad first"}, {"char_caption": "bad second"},
        ]}},
    }), "characters.png")
    parameters = entry["parameters"]
    assert parameters["model"] == "nai-diffusion-4-5-full"
    assert parameters["positivePrompt"] == "two people"
    assert parameters["negativePrompt"] == "bad background"
    assert parameters["use_coords"] is True
    first, second = parameters["characterTabs"]
    assert first["prompt"] == "first character"
    assert first["uc"] == "bad first"
    assert first["center"] == {"x": 0.12, "y": 0.73}
    assert first["position"] == "A4"
    assert second["uc"] == "bad second"
    assert second["center"] == {"x": 0, "y": 0}
    assert second["position"] == "C3"
    copied = library.save_metadata_copy(entry["id"], {"steps": 28})
    assert copied["parameters"]["characterTabs"] == parameters["characterTabs"]


def test_metadata_edits_round_trip_official_captions_characters_and_advanced_parameters(library):
    original = image_bytes(metadata={
        "prompt": "old prompt", "uc": "old negative", "strength": 0.55,
        "noise": 0.1, "add_original_image": True, "model_name": "nai-diffusion-4-5-full",
        "v4_prompt": {"use_coords": True, "use_order": True, "caption": {
            "base_caption": "old prompt", "char_captions": [{"char_caption": "old character", "centers": [{"x": 0.1, "y": 0.2}]}],
        }},
        "v4_negative_prompt": {"caption": {
            "base_caption": "old negative", "char_captions": [{"char_caption": "old character negative"}],
        }},
    })
    entry = library.import_image(original, "original.png")
    changes = {
        "positivePrompt": "new prompt", "negativePrompt": "new negative",
        "noise": 0.7, "advanced_new_value": 42, "guidanceScale": 5.5,
        "characterTabs": [{"prompt": "new character", "uc": "new character negative", "center": {"x": 0.3, "y": 0.8}, "position": "B5"}],
    }
    edited = library.save_metadata_copy(entry["id"], changes)
    with Image.open(library.image_path(edited["id"])) as image:
        comment = json.loads(image.info["Comment"])
        assert image.info["Description"] == "new prompt"
    assert comment["prompt"] == comment["positivePrompt"] == comment["v4_prompt"]["caption"]["base_caption"] == "new prompt"
    assert comment["uc"] == comment["negativePrompt"] == comment["v4_negative_prompt"]["caption"]["base_caption"] == "new negative"
    assert comment["v4_prompt"]["caption"]["char_captions"] == [{"char_caption": "new character", "centers": [{"x": 0.3, "y": 0.8}]}]
    assert comment["v4_negative_prompt"]["caption"]["char_captions"][0]["char_caption"] == "new character negative"
    assert comment["v4_prompt"]["use_order"] is True
    assert comment["strength"] == 0.55
    assert comment["noise"] == 0.7
    assert comment["add_original_image"] is True
    assert comment["advanced_new_value"] == 42
    assert comment["scale"] == 5.5
    assert "Source" not in comment and "stealth" not in comment and "metadata" not in comment
    repeated = library.save_metadata_copy(edited["id"], {"prompt": "raw prompt edit", "uc": "raw negative edit"})
    with Image.open(library.image_path(repeated["id"])) as image:
        round_trip = json.loads(image.info["Comment"])
    assert round_trip["prompt"] == round_trip["v4_prompt"]["caption"]["base_caption"] == "raw prompt edit"
    assert round_trip["uc"] == round_trip["v4_negative_prompt"]["caption"]["base_caption"] == "raw negative edit"
    assert round_trip["noise"] == 0.7 and round_trip["advanced_new_value"] == 42
    assert library.image_path(entry["id"]).read_bytes() == original


@pytest.mark.parametrize(("metadata", "expected"), [
    ({"Source": "NovelAI Diffusion V4.5 Full"}, "nai-diffusion-4-5-full"),
    ({"Source": "NAI Diffusion V4 Curated Preview"}, "nai-diffusion-4-curated-preview"),
    ({"Source": "NovelAI Diffusion V5 Curated"}, "nai-diffusion-5-curated"),
    ({"model_name": "nai-diffusion-furry-3"}, "nai-diffusion-furry-3"),
    ({"model": "nai-diffusion-4-5-full-inpainting"}, "nai-diffusion-4-5-full"),
    ({"Source": "NovelAI Diffusion V5 ABCD1234"}, None),
])
def test_model_names_are_normalized_only_when_source_identifies_the_variant(metadata, expected):
    assert normalize_image_parameters(metadata).get("model") == expected


def test_migration_markers_and_thumbnail_file_are_persistent(library):
    entry = library.import_image(image_bytes(size=(900, 600)), "large.png")
    with Image.open(library.image_path(entry["id"], thumbnail=True)) as thumbnail:
        assert thumbnail.size == (480, 320)
    assert not library.has_migration("legacy")
    library.mark_migration("legacy")
    restarted = LocalImageLibrary(library.data_dir, library.roots["outputs"])
    assert restarted.has_migration("legacy")


def test_import_rejects_non_images_before_creating_files(library):
    with pytest.raises(OSError):
        library.import_image(b"<svg></svg>", "picture.png")
    assert list(library.roots["references"].iterdir()) == []


def test_interrupted_stable_import_recovers_written_file_without_overwriting(library, monkeypatch):
    original = image_bytes()
    original_index = library._index_file
    def fail_index(*args, **kwargs):
        raise OSError("Simulated database disk failure")
    monkeypatch.setattr(library, "_index_file", fail_index)
    with pytest.raises(OSError):
        library.import_image(original, "legacy.png", image_id="stable-legacy")
    assert library.list_images("references")["total"] == 0
    written_file = next(library.roots["references"].iterdir())
    first_write_time = written_file.stat().st_mtime_ns
    monkeypatch.setattr(library, "_index_file", original_index)
    restored = library.import_image(original, "legacy.png", image_id="stable-legacy")
    assert restored["id"] == "stable-legacy"
    assert written_file.stat().st_mtime_ns == first_write_time
    assert library.image_path(restored["id"]).read_bytes() == original
    assert library.list_images("references")["total"] == 1
