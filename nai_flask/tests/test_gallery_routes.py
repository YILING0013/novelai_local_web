import base64
import io
import json
import sqlite3
from pathlib import Path

import pytest
from PIL import Image, PngImagePlugin

from conftest import ORIGIN, PNG_BASE64, login


def test_gallery_routes_recover_when_running_data_directory_is_moved(client, app, tmp_path, metadata_png):
    """模拟运行中工作目录被移走，两类图库重建并能再次导入图片。"""
    csrf = login(client)
    data_dir = Path(app.config["DATA_DIR"])
    backup = tmp_path / "moved-data"
    assert data_dir.resolve().parent == backup.resolve().parent == tmp_path.resolve()
    data_dir.rename(backup)
    for source in ("outputs", "references"):
        response = client.get(f"/api/local/gallery?source={source}")
        assert response.status_code == 200
        assert response.get_json()["items"] == []
        groups = client.get(f"/api/local/gallery/groups?source={source}")
        assert groups.status_code == 200
        assert groups.get_json()["groups"] == []
    uploaded = upload_images(client, csrf, [("recovered.png", metadata_png)]).get_json()
    assert uploaded["errors"] == []
    thumbnail = client.get(uploaded["items"][0]["thumbnail_url"])
    assert thumbnail.status_code == 200
    thumbnail.close()
    assert backup.is_dir()


@pytest.fixture
def metadata_png():
    """生成带 NovelAI 参数的合成图片，不读取个人文件。"""
    output = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("Comment", json.dumps({
        "prompt": "synthetic landscape", "uc": "synthetic negative", "seed": 42,
        "steps": 28, "scale": 7, "sampler": "k_euler", "model": "nai-diffusion-4-5-full",
    }))
    Image.new("RGB", (640, 360), (12, 34, 56)).save(output, "PNG", pnginfo=metadata)
    return output.getvalue()


def upload_images(client, csrf, files):
    """通过真实 multipart 接口上传合成文件列表。"""
    return client.post(
        "/api/local/gallery/import",
        data={"files": [(io.BytesIO(content), filename) for filename, content in files]},
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )


def gallery_batch(client, csrf, action, ids, **options):
    """执行图库的批量操作，保留逐项结果用于断言。"""
    return client.post(
        "/api/local/gallery/batch",
        json={"action": action, "ids": ids, **options},
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )


def test_gallery_authentication_and_csrf_are_required(client, app, metadata_png):
    for path in ("/api/local/gallery", "/api/local/gallery/groups", "/api/local/gallery/unknown/file"):
        assert client.get(path).status_code == 401
    rejected = upload_images(client, "not-authenticated", [("test.png", metadata_png)])
    assert rejected.status_code == 401
    login(client)
    rejected = upload_images(client, "wrong-csrf", [("test.png", metadata_png)])
    assert rejected.status_code == 403
    assert rejected.get_json()["code"] == "CSRF_INVALID"
    assert app.extensions["image_library"].list_images()["total"] == 0


def test_gallery_import_extracts_metadata_and_serves_thumbnail(client, app, metadata_png):
    csrf = login(client)
    response = upload_images(client, csrf, [("landscape.png", metadata_png)])
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["errors"] == []
    item = payload["items"][0]
    assert item["title"] == "landscape"
    assert item["prompt"] == "synthetic landscape"
    assert item["negative_prompt"] == "synthetic negative"
    assert item["parameters"]["seed"] == 42
    assert item["parameters"]["guidanceScale"] == 7
    assert item["width"] == 640 and item["height"] == 360
    assert app.extensions["image_library"].image_path(item["id"]).read_bytes() == metadata_png

    detail = client.get(f"/api/local/gallery/{item['id']}").get_json()
    assert "Comment" in detail["metadata"]
    original = client.get(item["url"])
    assert original.status_code == 200 and original.data == metadata_png
    original.close()
    thumbnail = client.get(item["thumbnail_url"])
    assert thumbnail.status_code == 200
    assert thumbnail.mimetype == "image/png"
    assert thumbnail.headers["Cache-Control"] == "private, no-cache"
    with Image.open(io.BytesIO(thumbnail.data)) as image:
        assert image.size == (480, 270)
    thumbnail.close()


def test_gallery_import_reports_bad_file_and_keeps_other_successes(client, metadata_png):
    csrf = login(client)
    gif = io.BytesIO()
    Image.new("RGB", (2, 2)).save(gif, "GIF")
    response = upload_images(client, csrf, [
        ("before.png", metadata_png), ("unsupported.gif", gif.getvalue()), ("after.png", metadata_png),
    ])
    assert response.status_code == 200
    payload = response.get_json()
    assert len(payload["items"]) == 2
    assert [item["filename"] for item in payload["errors"]] == ["unsupported.gif"]
    assert client.get("/api/local/gallery").get_json()["total"] == 2


def test_gallery_multipart_import_keeps_selected_group(client, metadata_png):
    csrf = login(client)
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    group = client.post("/api/local/gallery/groups", json={"name": "Import group"}, headers=headers).get_json()
    response = client.post(
        "/api/local/gallery/import",
        data={"files": [(io.BytesIO(metadata_png), "grouped.png")], "group_id": group["id"]},
        headers=headers,
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["errors"] == []
    item = payload["items"][0]
    assert item["group_id"] == group["id"]
    assert [image["id"] for image in client.get(f"/api/local/gallery?group={group['id']}").get_json()["items"]] == [item["id"]]
    assert client.get("/api/local/gallery?group=__ungrouped").get_json()["total"] == 0
    ungrouped = upload_images(client, csrf, [("ungrouped.png", metadata_png)]).get_json()["items"][0]
    assert [image["id"] for image in client.get("/api/local/gallery?group=__ungrouped").get_json()["items"]] == [ungrouped["id"]]


def test_gallery_pagination_search_groups_and_metadata_edits(client, app, metadata_png):
    csrf = login(client)
    items = upload_images(client, csrf, [(f"image-{index}.png", metadata_png) for index in range(3)]).get_json()["items"]
    first = client.get("/api/local/gallery?offset=0&limit=2").get_json()
    second = client.get("/api/local/gallery?offset=2&limit=2").get_json()
    assert first["total"] == second["total"] == 3
    assert len(first["items"]) == 2 and first["has_more"] is True
    assert len(second["items"]) == 1 and second["has_more"] is False
    assert {item["id"] for item in first["items"]}.isdisjoint(item["id"] for item in second["items"])
    assert all("metadata" not in item for item in first["items"])

    group = client.post(
        "/api/local/gallery/groups", json={"name": "Synthetic group"},
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    ).get_json()
    grouped = gallery_batch(client, csrf, "group", [items[0]["id"], items[1]["id"]], group_id=group["id"]).get_json()
    assert grouped["errors"] == []
    assert len(grouped["succeeded"]) == 2
    assert client.get(f"/api/local/gallery?group={group['id']}").get_json()["total"] == 2
    assert client.get("/api/local/gallery/groups").get_json()["groups"][0]["count"] == 2
    edited = client.patch(
        f"/api/local/gallery/{items[0]['id']}",
        json={"prompt": "edited prompt", "negative_prompt": "edited negative", "style_prompt": "watercolor"},
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )
    assert edited.status_code == 200
    assert edited.get_json()["parameters"]["positivePrompt"] == "edited prompt"
    assert edited.get_json()["parameters"]["negativePrompt"] == "edited negative"
    assert client.get("/api/local/gallery?q=watercolor").get_json()["total"] == 1
    assert app.extensions["image_library"].image_path(items[0]["id"]).read_bytes() == metadata_png


@pytest.mark.parametrize("query", ["offset=-1", "limit=0", "limit=121", "offset=one", "source=default"])
def test_gallery_rejects_invalid_listing_parameters(client, query):
    login(client)
    assert client.get(f"/api/local/gallery?{query}").status_code == 400


def test_gallery_batch_reports_missing_item_and_restores_other_files(client, app, metadata_png):
    csrf = login(client)
    items = upload_images(client, csrf, [("one.png", metadata_png), ("two.png", metadata_png)]).get_json()["items"]
    ids = [item["id"] for item in items]
    paths = [app.extensions["image_library"].image_path(image_id) for image_id in ids]
    trashed = gallery_batch(client, csrf, "trash", [ids[0], "missing-image", ids[1]]).get_json()
    assert trashed["succeeded"] == ids
    assert [error["id"] for error in trashed["errors"]] == ["missing-image"]
    assert all(not path.exists() for path in paths)
    assert client.get("/api/local/gallery").get_json()["total"] == 0
    assert client.get("/api/local/gallery?trash=true").get_json()["total"] == 2

    restored = gallery_batch(client, csrf, "restore", ids).get_json()
    assert restored["succeeded"] == ids and restored["errors"] == []
    assert all(path.read_bytes() == metadata_png for path in paths)
    assert client.get("/api/local/gallery").get_json()["total"] == 2


def test_gallery_metadata_copy_strips_metadata_without_changing_original(client, app, metadata_png):
    csrf = login(client)
    original = upload_images(client, csrf, [("original.png", metadata_png)]).get_json()["items"][0]
    response = gallery_batch(client, csrf, "export", [original["id"]], mode="strip")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["errors"] == [] and payload["succeeded"] == [original["id"]]
    copied = payload["items"][0]
    assert copied["id"] != original["id"] and copied["source"] == "outputs"
    assert copied["prompt"] == copied["negative_prompt"] == ""
    assert app.extensions["image_library"].image_path(original["id"]).read_bytes() == metadata_png
    with Image.open(app.extensions["image_library"].image_path(copied["id"])) as image:
        assert "Comment" not in image.info and "Description" not in image.info
        assert not image.getexif()
        assert image.convert("RGB").getpixel((0, 0)) == (12, 34, 56)


def test_output_directory_partial_setting_keeps_other_settings(client, app, tmp_path):
    csrf = login(client)
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    assert client.put("/api/local/settings", json={"settings": {"theme": "dark", "fileNamePrefix": "Test"}}, headers=headers).status_code == 200
    destination = tmp_path / "custom-output"
    response = client.put(
        "/api/local/settings", json={"settings": {"outputDirectory": str(destination), "inspirationSource": "outputs"}}, headers=headers,
    )
    assert response.status_code == 200
    settings = response.get_json()["settings"]
    assert settings["theme"] == "dark" and settings["fileNamePrefix"] == "Test"
    assert settings["inspirationSource"] == "outputs"
    assert app.extensions["image_library"].roots["outputs"] == destination.resolve()
    assert destination.is_dir()
    rejected = client.put("/api/local/settings", json={"settings": {"outputDirectory": "../outside"}}, headers=headers)
    assert rejected.status_code == 400
    assert app.extensions["image_library"].roots["outputs"] == destination.resolve()
    assert client.get("/api/local/settings").get_json()["settings"] == settings


def test_gallery_path_fields_and_traversal_cannot_read_outside_files(client, app, metadata_png):
    csrf = login(client)
    item = upload_images(client, csrf, [("../outside.png", metadata_png)]).get_json()["items"][0]
    library = app.extensions["image_library"]
    stored = library.image_path(item["id"])
    assert stored.is_relative_to(library.roots["references"])
    response = client.patch(
        f"/api/local/gallery/{item['id']}", json={"relative_path": "../outside.png"},
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )
    assert response.status_code == 400
    assert response.get_json()["code"] == "LIBRARY_EDIT_INVALID"
    assert client.get("/api/local/gallery/..%2Foutside.png/file").status_code == 404

    # 即使索引被本机外部程序写坏，文件接口也不能越过图库根目录。
    outside = Path(app.config["DATA_DIR"]) / "outside.png"
    outside.write_bytes(b"synthetic outside content")
    with sqlite3.connect(library.path) as db:
        db.execute("UPDATE library_images SET relative_path=? WHERE id=?", ("../outside.png", item["id"]))
    rejected = client.get(item["url"])
    assert rejected.status_code == 403
    assert rejected.get_json()["code"] == "LIBRARY_PATH_INVALID"
    assert b"synthetic outside content" not in rejected.data


@pytest.mark.parametrize("fail_save", [False, True])
def test_generation_saves_real_png_and_preserves_result_when_disk_save_fails(client, app, fake_client, monkeypatch, fail_save):
    csrf = login(client)
    calls = []

    def generate_png(token, payload, correlation_id):
        calls.append(payload)
        return [{"data": PNG_BASE64, "mime_type": "image/png", "seed": payload["parameters"]["seed"], "index": 0}]

    monkeypatch.setattr(fake_client, "generate_image", generate_png)
    if fail_save:
        def reject_save(*args, **kwargs):
            raise OSError("Synthetic disk full")

        monkeypatch.setattr(app.extensions["image_library"], "save_generated", reject_save)
    response = client.post(
        "/api/images/generate",
        json={"model": "nai-diffusion-4-5-full", "positivePrompt": "route prompt", "negativePrompt": "route negative",
              "width": 512, "height": 512, "steps": 20, "seed": 123},
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )
    assert response.status_code == 200
    image = response.get_json()["images"][0]
    assert len(calls) == 1
    assert base64.b64decode(image["data"]) == base64.b64decode(PNG_BASE64)
    if fail_save:
        assert image["save_error"] == "LOCAL_IMAGE_SAVE_FAILED"
        assert "saved_file" not in image
        assert app.extensions["image_library"].list_images(source="outputs")["total"] == 0
    else:
        assert "save_error" not in image
        saved = image["saved_file"]
        detail = client.get(f"/api/local/gallery/{saved['id']}").get_json()
        assert detail["source"] == "outputs"
        assert detail["prompt"] == "route prompt"
        assert detail["negative_prompt"] == "route negative"
        assert detail["parameters"]["seed"] == 123
        with Image.open(app.extensions["image_library"].image_path(saved["id"])) as png:
            assert png.size == (2, 2)
            assert json.loads(png.info["Comment"])["prompt"] == "route prompt"
