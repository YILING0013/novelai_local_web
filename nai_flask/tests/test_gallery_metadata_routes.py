import copy
import gzip
import io
import json
from pathlib import Path

import pytest
from PIL import Image, PngImagePlugin
from PIL.TiffImagePlugin import IFDRational

from conftest import ORIGIN, login


@pytest.fixture
def multi_container_png():
    """在内存合成同时含 PNG 文本、EXIF 与官方 alpha 隐写的图片。"""
    comment = {
        "prompt": "synthetic main", "uc": "synthetic negative", "seed": 42,
        "steps": 23, "model": "nai-diffusion-4-5-full", "signed_hash": "synthetic-signature",
        "v4_prompt": {"use_coords": True, "caption": {
            "base_caption": "synthetic main", "char_captions": [
                {"char_caption": "synthetic character", "centers": [{"x": 0.2, "y": 0.8}]},
            ],
        }},
        "v4_negative_prompt": {"caption": {
            "base_caption": "synthetic negative", "char_captions": [
                {"char_caption": "synthetic character negative", "centers": [{"x": 0.2, "y": 0.8}]},
            ],
        }},
    }
    outer = {"Description": "synthetic main", "Comment": json.dumps(comment)}
    nested = {**outer, "unknown_array": [{"label": "keep"}, [1, 2], None], "custom_flag": True}
    text = PngImagePlugin.PngInfo()
    text.add_text("Comment", json.dumps(comment))
    text.add_text("Description", "synthetic main")
    text.add_itxt("metadata", json.dumps({"JSON": json.dumps(nested)}))
    text.add_text("compressed_note", "synthetic compressed text", zip=True)
    exif = Image.Exif()
    exif[270] = "synthetic main"
    exif[305] = "nai-diffusion-4-5-full"
    exif[34665] = {37510: b"ASCII\0\0\0" + json.dumps(outer).encode("ascii")}

    image = Image.new("RGBA", (512, 512), (12, 34, 56, 255))
    payload = gzip.compress(json.dumps(outer).encode("utf-8"))
    encoded = b"stealth_pngcomp" + (len(payload) * 8).to_bytes(4, "big") + payload
    pixels = image.load()
    # 与官方 nai_meta_writer.py 相同：列优先、alpha 最低位、每字节高位在前。
    for offset, value in enumerate(encoded):
        for bit in range(8):
            x, y = divmod(offset * 8 + bit, image.height)
            pixels[x, y] = (12, 34, 56, 254 | ((value >> (7 - bit)) & 1))
    output = io.BytesIO()
    image.save(output, "PNG", pnginfo=text, exif=exif)
    return output.getvalue()


def _read_alpha_metadata(image):
    """独立按官方字节布局读隐写，避免用被测解析器验证自身。"""
    alpha = image.getchannel("A")
    values = alpha.load()
    bits = [values[x, y] & 1 for x in range(image.width) for y in range(image.height)]
    header = bytes(sum(bits[offset + bit] << (7 - bit) for bit in range(8)) for offset in range(0, 152, 8))
    if header[:15] != b"stealth_pngcomp":
        return None
    length = int.from_bytes(header[15:19], "big")
    content = bytes(sum(bits[offset + bit] << (7 - bit) for bit in range(8)) for offset in range(152, 152 + length, 8))
    return json.loads(gzip.decompress(content))


def test_batch_template_replaces_source_metadata_across_request_chunks(client, app, tmp_path, multi_container_png):
    """模板树在不同请求中完整复用，改主提示词及角色时不混入各源图旧参数。"""
    csrf = login(client)
    library = app.extensions["image_library"]
    template_entry = library.import_image(multi_container_png, "template.png")
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("Comment", json.dumps({"prompt": "source-only old prompt", "seed": 9876, "source_only": True}))
    metadata.add_text("Description", "source-only old description")
    buffer = io.BytesIO()
    Image.new("RGB", (640, 384), (66, 88, 110)).save(buffer, "PNG", pnginfo=metadata)
    original = buffer.getvalue()
    target_entry = library.import_image(original, "different-source.png")
    document = copy.deepcopy(template_entry["metadata_document"])
    document["png"]["metadata"]["JSON"]["unknown_array"] = ["chosen template", {"editable": True}]
    # 用户从模板中删除字段，应在所有输出中保持删除。
    document["png"]["Comment"].pop("seed")
    destination = tmp_path / "template-results"
    copies = []
    for entry in (template_entry, target_entry):
        response = client.post("/api/local/gallery/batch", json={
            "action": "export", "ids": [entry["id"]], "mode": "edit", "output_directory": str(destination),
            "template_metadata_document": document,
            "parameters": {"positivePrompt": "template edited main", "negativePrompt": "template edited negative",
                           "characterTabs": [{"prompt": "template edited character", "uc": "template edited character negative",
                                              "center": {"x": 0.6, "y": 0.4}, "position": "D3"}]},
        }, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
        assert response.status_code == 200
        result = response.get_json()
        assert result["errors"] == [] and result["succeeded"] == [entry["id"]]
        copies.append(Path(result["items"][0]["saved_path"]))
    assert len(list(destination.iterdir())) == 2
    assert list(library.roots["outputs"].iterdir()) == []
    for path, size, color in ((copies[0], (512, 512), (12, 34, 56)), (copies[1], (640, 384), (66, 88, 110))):
        with Image.open(path) as image:
            assert image.size == size and image.convert("RGB").getpixel((0, 0)) == color
            comment = json.loads(image.info["Comment"])
            assert comment["prompt"] == "template edited main"
            assert "seed" not in comment and "source_only" not in comment and "signed_hash" not in comment
            alpha_comment = json.loads(_read_alpha_metadata(image)["Comment"])
            assert alpha_comment["prompt"] == "template edited main"
            assert alpha_comment["v4_prompt"]["caption"]["char_captions"][0]["char_caption"] == "template edited character"
            assert "signed_hash" not in alpha_comment
            assert all("source-only" not in value for value in image.info.values() if isinstance(value, str))
            assert b"source-only" not in image.info["exif"]
    assert library.image_path(target_entry["id"]).read_bytes() == original
    assert library.image_path(template_entry["id"]).read_bytes() == multi_container_png


def test_unchanged_template_drops_signature_for_other_image(client, app, tmp_path, multi_container_png):
    """模板 Comment 未编辑也不能在另一张图上保留原像素签名。"""
    csrf = login(client)
    library = app.extensions["image_library"]
    template = library.import_image(multi_container_png, "template.png")
    buffer = io.BytesIO()
    Image.new("RGB", (512, 512), (50, 100, 150)).save(buffer, "PNG")
    target = library.import_image(buffer.getvalue(), "target.png")
    result = client.post("/api/local/gallery/batch", json={
        "action": "export", "ids": [target["id"]], "mode": "edit",
        "output_directory": str(tmp_path / "unchanged-template"),
        "template_metadata_document": template["metadata_document"],
    }, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf}).get_json()
    assert result["errors"] == []
    with Image.open(result["items"][0]["saved_path"]) as image:
        assert "signed_hash" not in json.loads(image.info["Comment"])
        assert "signed_hash" not in json.loads(_read_alpha_metadata(image)["Comment"])


def test_template_container_deletion_wins_over_previously_changed_parameter(client, app, tmp_path, multi_container_png):
    """先改 seed 后删除模板 Comment，另存时整块删除优先且源图旧数据不参与。"""
    csrf = login(client)
    source = app.extensions["image_library"].import_image(multi_container_png, "source.png")
    original_template = {"png": {"Description": "chosen template", "Comment": {"prompt": "chosen template", "seed": 42}}}
    edited_template = {"png": {"Description": "chosen template"}}
    response = client.post("/api/local/gallery/batch", json={
        "action": "export", "ids": [source["id"]], "mode": "edit",
        "output_directory": str(tmp_path / "deleted-template-container"),
        "template_original_document": original_template,
        "template_metadata_document": edited_template,
        "parameters": {"seed": 100},
    }, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert response.status_code == 200
    result = response.get_json()
    assert result["errors"] == []
    with Image.open(result["items"][0]["saved_path"]) as image:
        assert image.text == {"Description": "chosen template"}
        assert not image.getexif() and _read_alpha_metadata(image) is None


def test_gallery_export_updates_every_metadata_container_and_keeps_unknown_arrays(client, app, multi_container_png):
    """完整路由流程应同步共享提示词/角色，同时保留用户编辑的未知嵌套数据。"""
    csrf = login(client)
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    uploaded = client.post(
        "/api/local/gallery/import",
        data={"files": [(io.BytesIO(multi_container_png), "multi-container.png")]}, headers=headers,
    )
    assert uploaded.status_code == 200
    assert uploaded.get_json()["errors"] == []
    original = uploaded.get_json()["items"][0]
    detail = client.get(f"/api/local/gallery/{original['id']}").get_json()
    document = detail["metadata_document"]
    assert document["png"]["Comment"]["prompt"] == "synthetic main"
    assert document["png"]["metadata"]["JSON"]["Comment"]["prompt"] == "synthetic main"
    assert document["exif"]["37510"]["value"]["Comment"]["prompt"] == "synthetic main"
    assert document["stealth"]["Comment"]["prompt"] == "synthetic main"
    assert ["png", "Comment", "prompt"] in detail["metadata_shared_paths"]
    assert ["png", "metadata", "JSON", "Comment", "prompt"] in detail["metadata_shared_paths"]
    assert ["png", "metadata", "JSON", "unknown_array"] not in detail["metadata_shared_paths"]

    edited_document = copy.deepcopy(document)
    new_array = [{"label": "edited", "nested": [False, {"custom": "new"}]}, [3, 4], None]
    edited_document["png"]["metadata"]["JSON"]["unknown_array"] = new_array
    response = client.post(
        "/api/local/gallery/batch",
        json={
            "action": "export", "ids": [original["id"]], "mode": "edit",
            "metadata_document": edited_document,
            "parameters": {
                "positivePrompt": "changed main", "negativePrompt": "changed negative", "use_coords": True,
                "characterTabs": [{
                    "name": "", "prompt": "changed character", "uc": "changed character negative",
                    "position": "A4", "center": {"x": 0.15, "y": 0.73}, "colorId": 0,
                }],
            },
        }, headers=headers,
    )
    assert response.status_code == 200
    result = response.get_json()
    assert result["errors"] == [] and result["succeeded"] == [original["id"]]
    copied = result["items"][0]
    assert copied["id"] != original["id"]
    library = app.extensions["image_library"]
    assert library.image_path(original["id"]).read_bytes() == multi_container_png
    with Image.open(library.image_path(copied["id"])) as image:
        text_comment = json.loads(image.info["Comment"])
        nested = json.loads(image.info["metadata"])
        nested = json.loads(nested["JSON"]) if isinstance(nested["JSON"], str) else nested["JSON"]
        assert nested["unknown_array"] == new_array
        assert nested["custom_flag"] is True
        nested_comment = json.loads(nested["Comment"]) if isinstance(nested["Comment"], str) else nested["Comment"]
        assert image.info["compressed_note"] == "synthetic compressed text"
        exif = image.getexif()
        exif_items = dict(exif)
        if 34665 in exif:
            exif_items.update(exif.get_ifd(34665))
        user_comment = exif_items[37510]
        if isinstance(user_comment, bytes):
            user_comment = user_comment.removeprefix(b"ASCII\0\0\0").decode("utf-8").rstrip("\0")
        exif_outer = json.loads(user_comment)
        exif_comment = json.loads(exif_outer["Comment"]) if isinstance(exif_outer["Comment"], str) else exif_outer["Comment"]
        alpha_outer = _read_alpha_metadata(image)
        alpha_comment = json.loads(alpha_outer["Comment"]) if isinstance(alpha_outer["Comment"], str) else alpha_outer["Comment"]
        for comment in (text_comment, nested_comment, exif_comment, alpha_comment):
            assert comment["prompt"] == "changed main"
            assert comment["uc"] == "changed negative"
            assert comment["seed"] == 42
            assert "signed_hash" not in comment
            positive = comment["v4_prompt"]["caption"]
            negative = comment["v4_negative_prompt"]["caption"]
            assert positive["base_caption"] == "changed main"
            assert negative["base_caption"] == "changed negative"
            assert positive["char_captions"][0]["char_caption"] == "changed character"
            assert negative["char_captions"][0]["char_caption"] == "changed character negative"
            assert positive["char_captions"][0]["centers"] == [{"x": 0.15, "y": 0.73}]
        assert image.info["Description"] == nested["Description"] == exif_items[270] == alpha_outer["Description"] == "changed main"
        assert image.convert("RGB").getpixel((0, 0)) == (12, 34, 56)


def test_gallery_strip_removes_all_metadata_containers_and_keeps_original(client, app, multi_container_png):
    """清除另存应去掉文本、EXIF 和隐写，而原始合成文件逐字节不变。"""
    csrf = login(client)
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    uploaded = client.post(
        "/api/local/gallery/import",
        data={"files": [(io.BytesIO(multi_container_png), "strip-source.png")]}, headers=headers,
    ).get_json()
    assert uploaded["errors"] == []
    original = uploaded["items"][0]
    response = client.post(
        "/api/local/gallery/batch", json={"action": "export", "ids": [original["id"]], "mode": "strip"}, headers=headers,
    )
    assert response.status_code == 200
    result = response.get_json()
    assert result["errors"] == []
    clean = result["items"][0]
    assert clean["prompt"] == clean["negative_prompt"] == ""
    library = app.extensions["image_library"]
    assert library.image_path(original["id"]).read_bytes() == multi_container_png
    with Image.open(library.image_path(clean["id"])) as image:
        assert not image.text
        assert not image.getexif()
        assert _read_alpha_metadata(image) is None
        assert image.getchannel("A").getextrema() == (255, 255)
        assert image.convert("RGB").getpixel((0, 0)) == (12, 34, 56)


def test_gallery_export_preserves_gps_sub_ifd_without_reusing_original_offset(client, app):
    """GPS 子 IFD 必须保存实际标签，不能把原文件偏移写进另存文件。"""
    exif = Image.Exif()
    exif[34853] = {
        1: "N", 2: (IFDRational(1, 1), IFDRational(2, 1), IFDRational(3, 1)),
        3: "E", 4: (IFDRational(4, 1), IFDRational(5, 1), IFDRational(6, 1)),
    }
    exif[34665] = {37510: b'ASCII\0\0\0{"prompt":"synthetic GPS test"}'}
    output = io.BytesIO()
    Image.new("RGB", (64, 64), (12, 34, 56)).save(output, "PNG", exif=exif)
    original_bytes = output.getvalue()
    csrf = login(client)
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    uploaded = client.post(
        "/api/local/gallery/import",
        data={"files": [(io.BytesIO(original_bytes), "synthetic-gps.png")]}, headers=headers,
    )
    assert uploaded.status_code == 200
    assert uploaded.get_json()["errors"] == []
    original = uploaded.get_json()["items"][0]
    detail = client.get(f"/api/local/gallery/{original['id']}").get_json()
    assert isinstance(detail["metadata_document"]["exif"]["34853"]["value"], dict)

    response = client.post(
        "/api/local/gallery/batch",
        json={
            "action": "export", "ids": [original["id"]], "mode": "edit",
            "metadata_document": detail["metadata_document"],
            "parameters": {"positivePrompt": "edited synthetic GPS test"},
        }, headers=headers,
    )
    assert response.status_code == 200
    result = response.get_json()
    assert result["errors"] == [] and result["succeeded"] == [original["id"]]
    copied = result["items"][0]
    assert copied["prompt"] == "edited synthetic GPS test"
    library = app.extensions["image_library"]
    assert library.image_path(original["id"]).read_bytes() == original_bytes
    with Image.open(library.image_path(copied["id"])) as image:
        gps = image.getexif().get_ifd(34853)
        assert gps[1] == "N" and gps[3] == "E"
        assert [float(value) for value in gps[2]] == [1, 2, 3]
        assert [float(value) for value in gps[4]] == [4, 5, 6]
        assert image.convert("RGB").getpixel((0, 0)) == (12, 34, 56)
