import json
import socket

import pytest

import app as app_module
from app import create_app, discover_lan_ipv4_addresses, load_local_config
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


def test_lan_address_discovery_includes_only_local_rfc1918_ipv4(monkeypatch):
    """地址发现去重，排除 VPN 测试地址、公网和并非 RFC1918 的特殊地址。"""
    monkeypatch.setattr(socket, "gethostname", lambda: "local-test-pc")
    def getaddrinfo(host, port, family):
        assert (host, port, family) == ("local-test-pc", None, socket.AF_INET)
        return [(socket.AF_INET, 0, 0, "", (address, 0)) for address in (
            "192.168.0.103", "198.18.0.1", "172.27.16.1", "10.0.0.5", "192.168.0.103",
            "8.8.8.8", "100.64.0.1", "169.254.1.1", "127.0.0.1", "172.15.0.1", "172.32.0.1",
        )]
    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)
    assert discover_lan_ipv4_addresses() == ["10.0.0.5", "172.27.16.1", "192.168.0.103"]


@pytest.mark.parametrize("value", ["true", 1, 0, None, []])
def test_allow_lan_config_requires_boolean(tmp_path, monkeypatch, value):
    """配置只接受 JSON 布尔值，不把非空字符串或数字解释为启用。"""
    monkeypatch.delenv("NOVELAI_LOCAL_ALLOW_LAN", raising=False)
    config_file = tmp_path / "config.json"
    config_file.write_text(json.dumps({"allow_lan": value}), encoding="utf-8")
    with pytest.raises(ValueError, match="boolean"):
        load_local_config(config_file)
    with pytest.raises(ValueError, match="boolean"):
        create_app({"TESTING": True, "ALLOW_LAN": value, "DATA_DIR": str(tmp_path / "data")}, novelai_client=FakeNovelAIClient())


@pytest.mark.parametrize("value", ["true", "false", "", " 1", "1 ", "2"])
def test_allow_lan_environment_requires_exact_zero_or_one(tmp_path, monkeypatch, value):
    """启动器环境开关严格限定 0/1，拼写错误不会意外扩大监听范围。"""
    monkeypatch.setenv("NOVELAI_LOCAL_ALLOW_LAN", value)
    with pytest.raises(ValueError, match="exactly 0 or 1"):
        create_app({"TESTING": True, "DATA_DIR": str(tmp_path / "data")}, novelai_client=FakeNovelAIClient())


def test_lan_host_and_environment_override_contract(tmp_path, monkeypatch):
    """显式环境值可临时开启或关闭 LAN，默认状态不枚举网络接口。"""
    monkeypatch.delenv("NOVELAI_LOCAL_ALLOW_LAN", raising=False)
    discovered = []
    def discover():
        discovered.append(True)
        return ["192.168.0.103"]
    monkeypatch.setattr(app_module, "discover_lan_ipv4_addresses", discover)
    base = {"TESTING": True, "DATA_DIR": str(tmp_path / "data")}
    local = create_app(base, novelai_client=FakeNovelAIClient())
    assert local.config["HOST"] == "127.0.0.1" and not local.config["ALLOW_LAN"]
    assert discovered == []
    enabled = create_app({**base, "ALLOW_LAN": True}, novelai_client=FakeNovelAIClient())
    assert enabled.config["HOST"] == "0.0.0.0"
    assert enabled.config["LAN_IPV4_ADDRESSES"] == ["192.168.0.103"]
    monkeypatch.setenv("NOVELAI_LOCAL_ALLOW_LAN", "0")
    disabled = create_app({**base, "ALLOW_LAN": True}, novelai_client=FakeNovelAIClient())
    assert disabled.config["HOST"] == "127.0.0.1" and not disabled.config["ALLOW_LAN"]
    monkeypatch.setenv("NOVELAI_LOCAL_ALLOW_LAN", "1")
    enabled = create_app(base, novelai_client=FakeNovelAIClient())
    assert enabled.config["HOST"] == "0.0.0.0" and enabled.config["ALLOW_LAN"]


def test_lan_discovery_failure_is_explicit_and_does_not_affect_default_mode(tmp_path, monkeypatch):
    """无网络解析结果时 LAN 给出可读错误，默认本机模式不依赖网络发现。"""
    monkeypatch.delenv("NOVELAI_LOCAL_ALLOW_LAN", raising=False)
    def unavailable(*args):
        raise socket.gaierror("synthetic network unavailable")
    monkeypatch.setattr(socket, "getaddrinfo", unavailable)
    base = {"TESTING": True, "DATA_DIR": str(tmp_path / "data")}
    local = create_app(base, novelai_client=FakeNovelAIClient())
    assert local.config["HOST"] == "127.0.0.1"
    with pytest.raises(ValueError, match="Connect to the local network or disable allow_lan"):
        create_app({**base, "ALLOW_LAN": True}, novelai_client=FakeNovelAIClient())
