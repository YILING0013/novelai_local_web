import hashlib
import threading

import numpy as np
import pytest
from PIL import Image

from api_utils.custom_errors import ExposableError
from api_utils.image_inference import prepare_tagger_input, decode_tagger_output, upscale_image
from api_utils.local_inference import LocalInference
from api_utils.local_image_library import LocalImageLibrary
from conftest import PNG_BASE64, ORIGIN, login


@pytest.fixture
def manager(tmp_path):
    return LocalInference(tmp_path / "models", LocalImageLibrary(tmp_path / "data"))


def test_tagger_preprocessing_and_category_thresholds(tmp_path):
    image = Image.new("RGBA", (8, 4), (255, 0, 0, 255))
    wd = prepare_tagger_input(image, {"preprocessing": "wd-swinv2", "inputSize": 8})
    assert wd.shape == (1, 8, 8, 3)
    assert wd[0, 4, 4].tolist() == [0, 0, 255]
    assert wd[0, 0, 4].tolist() == [255, 255, 255]
    pixai = prepare_tagger_input(image, {"preprocessing": "pixai-v1", "inputSize": 8})
    assert pixai.shape == (1, 3, 8, 8)
    assert pixai[0, :, 4, 4].tolist() == [1, -1, -1]
    assert pixai[0, :, 0, 4].tolist() == [-1, -1, -1]
    labels = tmp_path / "tags.csv"
    labels.write_text("name,category\nsafe,9\nblue_hair,0\n^_^,0\nhero,4\n", encoding="utf-8")
    model = {"labelCount": 4, "defaultThresholds": {"general": .35, "character": .85}}
    result = decode_tagger_output(np.array([[.99, .8, .7, .6]]), labels, model, {"character": .5})
    assert result["text"] == "blue hair, ^_^, hero"
    with pytest.raises(ExposableError, match="labels"):
        decode_tagger_output(np.array([.9]), labels, model, {})


def test_upscale_tiles_keep_dimensions_colors_and_alpha():
    image = Image.new("RGBA", (17, 15), (128, 64, 32, 120))
    model = {"scale": 4, "tileSize": 16, "tileContext": 3, "outputOffset": 0}
    completed = []
    def run_tile(tensor):
        return tensor.repeat(4, 2).repeat(4, 3)
    result = upscale_image(image, model, run_tile, lambda n, total: completed.append((n, total)), lambda: None, 3)
    assert result.size == (51, 45)
    # Pillow 缩小半透明 RGBA 时有一次预乘与反预乘，允许一个色阶的舍入。
    assert np.abs(np.asarray(result).astype(int) - [128, 64, 32, 120]).max() <= 1
    assert np.asarray(result)[:, :, 3].min() == 120
    assert completed[-1][0] == completed[-1][1] > 1


@pytest.mark.parametrize("range_supported", [True, False])
def test_download_resumes_or_restarts_and_reuses_checked_file(manager, monkeypatch, range_supported):
    content = b"synthetic model bytes"
    file = {"name": "model.onnx", "url": "https://models.invalid/pinned", "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
    model = {"id": "test", "revision": "v1", "files": [file]}
    folder = manager.models_dir / "test/v1"
    folder.mkdir(parents=True)
    (folder / "model.onnx.part").write_bytes(content[:4])
    manager.jobs["job"] = {}
    calls = []
    class Response:
        status_code = 206 if range_supported else 200
        headers = {"Content-Range": f"bytes 4-{len(content)-1}/{len(content)}"}
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def raise_for_status(self): pass
        def iter_content(self, _): yield content[4:] if range_supported else content
    def get(url, **kwargs):
        calls.append(kwargs["headers"])
        return Response()
    monkeypatch.setattr("api_utils.local_inference.requests.get", get)
    manager._download("job", model)
    manager._download("job", model)
    assert (folder / "model.onnx").read_bytes() == content
    assert calls == [{"Range": "bytes=4-"}]
    assert not (folder / "model.onnx.part").exists()


def test_corrupt_download_is_not_promoted(manager, monkeypatch):
    content = b"bad"
    model = {"id": "test", "revision": "v1", "files": [{"name": "model.onnx", "url": "https://models.invalid/pinned", "bytes": 3, "sha256": hashlib.sha256(b"yes").hexdigest()}]}
    manager.jobs["job"] = {}
    class Response:
        status_code = 200
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def raise_for_status(self): pass
        def iter_content(self, _): yield content
    monkeypatch.setattr("api_utils.local_inference.requests.get", lambda *args, **kwargs: Response())
    with pytest.raises(ExposableError) as error:
        manager._download("job", model)
    assert error.value.code == "LOCAL_MODEL_CHECKSUM"
    assert not (manager.models_dir / "test/v1/model.onnx").exists()


def test_busy_ownership_and_cancel_release_worker(manager, monkeypatch):
    started, proceed = threading.Event(), threading.Event()
    def download(*args):
        started.set()
        assert proceed.wait(3)
        manager._check_cancelled()
    monkeypatch.setattr(manager, "_download", download)
    payload = {"action": "download", "model_id": "wd-swinv2-tagger-v3"}
    job = manager.start("owner", payload)
    assert started.wait(2)
    try:
        with pytest.raises(ExposableError) as busy:
            manager.start("owner", payload)
        assert busy.value.code == "LOCAL_INFERENCE_BUSY"
        with pytest.raises(ExposableError) as missing:
            manager.cancel(job["id"], "other")
        assert missing.value.status_code == 404
        assert manager.status("other")["job"] is None
        assert "owner" not in manager.get_job(job["id"], "owner")
        manager.cancel(job["id"], "owner")
    finally:
        proceed.set()
        manager.worker.join(3)
    assert not manager.worker.is_alive()
    assert manager.get_job(job["id"], "owner")["status"] == "cancelled"
    assert manager.active_id is None


def test_upscale_job_saves_real_png_and_model_metadata(manager, monkeypatch, tmp_path):
    monkeypatch.setattr(manager, "_download", lambda *args: tmp_path)
    class Session:
        def run(self, output, inputs, options):
            tensor = next(iter(inputs.values()))
            return [tensor.repeat(4, 2).repeat(4, 3)]
    monkeypatch.setattr(manager, "_load_session", lambda *args: Session())
    job = manager.start("owner", {"action": "upscale", "model_id": "quicksrnet-small", "image": PNG_BASE64, "scale": 2})
    manager.worker.join(5)
    result = manager.get_job(job["id"], "owner")
    assert result["status"] == "completed", result
    entry = result["result"]["image"]
    assert entry["parameters"]["local_upscale_model"] == "quicksrnet-small"
    assert entry["parameters"]["local_upscale_factor"] == 2
    with Image.open(manager.image_library.image_path(entry["id"])) as image:
        assert image.size == (4, 4)


def test_inference_routes_require_session_csrf_and_known_models(client):
    assert client.get("/api/local/inference").status_code == 401
    csrf = login(client)
    status = client.get("/api/local/inference").get_json()
    assert len(status["models"]) == 10
    assert any(model["id"] == "pixai-tagger-v1-fp32" for model in status["models"])
    assert client.post("/api/local/inference/jobs", json={}).status_code == 403
    response = client.post("/api/local/inference/jobs", json={"action": "download", "model_id": "../../external"}, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert response.status_code == 400
    assert response.get_json()["code"] == "LOCAL_MODEL_UNKNOWN"
