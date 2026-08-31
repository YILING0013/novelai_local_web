import json

import app as app_module
from app import create_app, load_local_config
from conftest import FakeNovelAIClient


def test_static_export_serves_files_and_deep_links_without_api_fallback(tmp_path):
    output = tmp_path / "out"
    asset_dir = output / "_next"
    asset_dir.mkdir(parents=True)
    (output / "index.html").write_text("<html>home</html>", encoding="utf-8")
    (asset_dir / "app.js").write_text("window.ready=true", encoding="utf-8")
    app = create_app({
        "TESTING": True,
        "DATA_DIR": str(tmp_path / "data"),
        "FRONTEND_OUT_DIR": str(output),
    }, novelai_client=FakeNovelAIClient())
    client = app.test_client()

    assert client.get("/").get_data(as_text=True) == "<html>home</html>"
    assert client.get("/workspace/deep-link").get_data(as_text=True) == "<html>home</html>"
    assert client.get("/_next/app.js").get_data(as_text=True) == "window.ready=true"

    missing_api = client.get("/api/not-a-route")
    assert missing_api.status_code == 404
    assert missing_api.is_json
    assert missing_api.get_json()["code"] == "API_ROUTE_NOT_FOUND"
    missing_asset = client.get("/_next/missing.js")
    assert missing_asset.status_code == 404
    assert missing_asset.get_json()["code"] == "STATIC_FILE_NOT_FOUND"


def test_allowed_origins_are_derived_from_final_port_and_fixed_dev_port(tmp_path):
    app = create_app({
        "TESTING": True,
        "PORT": 6789,
        "DATA_DIR": str(tmp_path / "data"),
    }, novelai_client=FakeNovelAIClient())
    client = app.test_client()

    same_port = client.options(
        "/api/session/persistent-token",
        headers={"Origin": "http://localhost:6789"},
    )
    assert same_port.status_code == 204
    assert same_port.headers["Access-Control-Allow-Origin"] == "http://localhost:6789"

    dev = client.options(
        "/api/session/persistent-token",
        headers={"Origin": "http://127.0.0.1:3000"},
    )
    assert dev.status_code == 204

    old_port = client.options(
        "/api/session/persistent-token",
        headers={"Origin": "http://localhost:5000"},
    )
    assert old_port.status_code == 403


def test_default_config_path_ignores_environment_override(tmp_path, monkeypatch):
    """默认配置只来自后端固定目录，显式 path 仍可供测试读取。"""

    backend_dir = tmp_path / "backend"
    backend_dir.mkdir()
    expected_path = backend_dir / "config.local.json"
    override_path = tmp_path / "override.json"
    expected_path.write_text(json.dumps({"port": 6789}), encoding="utf-8")
    override_path.write_text(json.dumps({"port": 7777}), encoding="utf-8")
    monkeypatch.setattr(app_module, "BASE_DIR", backend_dir)
    monkeypatch.setenv("NAI_LOCAL_CONFIG", str(override_path))

    assert load_local_config() == {"port": 6789}
    assert load_local_config(override_path) == {"port": 7777}
