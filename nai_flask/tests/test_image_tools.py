"""验证本地放大、增强的真实尺寸、官方请求和保存结果。"""

import base64
import io
import json

import pytest
from PIL import Image, PngImagePlugin

from conftest import ORIGIN, login, png_base64


@pytest.mark.parametrize(("width", "height", "cost"), [(1024, 1024, 1), (1024, 1536, 2), (1472, 1472, 3), (1536, 2048, 4)])
def test_upscale_estimate_uses_official_anlas_and_does_not_submit(client, fake_client, width, height, cost):
    csrf = login(client)
    response = client.post("/api/image-tools/estimate", json={
        "image_tool": "upscale", "source_width": width, "source_height": height,
    }, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert response.status_code == 200
    assert response.json == {"width": width * 2, "height": height * 2, "cost": cost, "balance": None, "affordable": None}
    assert not any(call[0] in {"generate", "upscale"} for call in fake_client.calls)


@pytest.mark.parametrize(("amount", "expected_size", "max_flag"), [(1, (832, 1216), False), (1.5, (1280, 1856), False), ("max", (832, 1216), True)])
def test_enhance_uses_current_image_and_strips_workspace_references(client, fake_client, monkeypatch, amount, expected_size, max_flag):
    csrf = login(client)
    original = fake_client.generate_image

    def generate(token, payload, correlation_id):
        result = original(token, payload, correlation_id)
        result[0]["data"] = png_base64(128, 128)
        return result

    monkeypatch.setattr(fake_client, "generate_image", generate)
    response = client.post("/api/images/generate", json={
        "image_tool": "enhance", "image": png_base64(832, 1216),
        "model": "nai-diffusion-5-full", "upscale_amount": amount,
        "strength": 0.2, "noise": 0.1, "steps": 35, "positivePrompt": "cat", "seed": 42,
        "mask": "unrelated workspace mask", "reference_image_multiple": ["unrelated vibe"],
        "director_reference_images_cached": [{"data": "unrelated reference"}], "req_type": "lineart",
    }, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert response.status_code == 200
    official = next(call[2] for call in fake_client.calls if call[0] == "generate")
    parameters = official["parameters"]
    assert official["action"] == "img2img"
    assert (parameters["width"], parameters["height"]) == expected_size
    assert parameters["upscaled_enhance"] is max_flag
    assert parameters["steps"] == 35
    assert parameters["strength"] == 0.2
    assert not {"mask", "reference_image_multiple", "director_reference_images"}.intersection(parameters)
    assert response.json["images"][0]["saved_file"]["id"]
    image = response.json["images"][0]
    assert (image["width"], image["height"]) == (128, 128)
    detail = client.get(f'/api/local/gallery/{image["saved_file"]["id"]}').json
    assert (detail["parameters"]["width"], detail["parameters"]["height"]) == (128, 128)
    saved = client.get(image["saved_file"]["url"])
    with Image.open(io.BytesIO(saved.data)) as saved_image:
        metadata = json.loads(saved_image.info["Comment"])
    saved.close()
    assert metadata["strength"] == 0.2
    assert metadata["noise"] == 0.1
    assert metadata["upscaled_enhance"] is max_flag
    assert metadata["image_tool"] == "enhance"


def test_generation_upscale_uses_image_dimensions_and_saves_result(client, fake_client, monkeypatch):
    csrf = login(client)
    original = fake_client.upscale_image

    def upscale(token, payload, correlation_id):
        result = original(token, payload, correlation_id)
        output = io.BytesIO()
        metadata = PngImagePlugin.PngInfo()
        metadata.add_text("Comment", json.dumps({"prompt": "source cat", "width": 64, "height": 128}))
        Image.new("RGB", (128, 256)).save(output, "PNG", pnginfo=metadata)
        result[0]["data"] = base64.b64encode(output.getvalue()).decode("ascii")
        return result

    monkeypatch.setattr(fake_client, "upscale_image", upscale)
    response = client.post("/api/images/generate", json={
        "image_tool": "upscale", "image": png_base64(64, 128),
        "model": "nai-diffusion-5-curated", "source_width": 2048, "source_height": 2048,
    }, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert response.status_code == 200
    official = next(call[2] for call in fake_client.calls if call[0] == "upscale")
    assert (official["width"], official["height"], official["scale"]) == (64, 128, 2)
    assert "parameters" not in official
    assert response.json["images"][0]["saved_file"]["id"]
    image = response.json["images"][0]
    assert (image["width"], image["height"]) == (128, 256)
    detail = client.get(f'/api/local/gallery/{image["saved_file"]["id"]}').json
    assert (detail["parameters"]["width"], detail["parameters"]["height"]) == (128, 256)
    assert detail["prompt"] == "source cat"


@pytest.mark.parametrize("settings", [
    {"upscale_amount": "max", "model": "nai-diffusion-4-5-full"},
    {"strength": 2}, {"steps": 51}, {"upscale_amount": True},
])
def test_invalid_enhance_is_rejected_before_official_request(client, fake_client, settings):
    csrf = login(client)
    response = client.post("/api/images/generate", json={
        "image_tool": "enhance", "image": png_base64(64, 128),
        "model": "nai-diffusion-5-full", **settings,
    }, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert response.status_code == 400
    assert not any(call[0] in {"generate", "upscale"} for call in fake_client.calls)
