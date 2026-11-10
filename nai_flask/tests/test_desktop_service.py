"""Exercise the real listeners, including the private-window boundary and failed restores."""
import socket
from contextlib import closing

import pytest
import requests

import desktop_service


def free_port():
    with closing(socket.socket()) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture
def desktop(tmp_path, monkeypatch):
    monkeypatch.setattr(desktop_service, "discover_lan_ipv4_addresses", lambda: [])
    frontend = tmp_path / "out"
    frontend.mkdir()
    (frontend / "index.html").write_text("workspace", encoding="utf-8")
    private, public = free_port(), free_port()
    services = []

    def launch():
        svc = desktop_service.DesktopService(tmp_path, frontend, private, public)
        services.append(svc)
        return svc

    yield launch
    for service in services:
        service.close()


def client(service):
    session = requests.Session()
    session.trust_env = False
    origin = f"http://127.0.0.1:{service.private_port}"
    session.headers.update({"X-NAI-Desktop": service.key, "Origin": origin})
    return session, origin + "/api/desktop/web-access"


def test_private_window_and_live_web_toggle(desktop):
    service = desktop()
    http, settings = client(service)
    public = f"http://127.0.0.1:{service.web_port}"
    assert http.get(settings).json()["enabled"] is False
    assert http.get(settings, headers={"X-NAI-Desktop": ""}).status_code == 403
    assert http.put(settings, json={"enabled": True}, headers={"Origin": "http://other.test"}).status_code == 403
    with pytest.raises(requests.ConnectionError):
        http.get(public, timeout=1)
    assert http.put(settings, json={"enabled": True}).json()["urls"] == [public + "/login"]
    public_client = requests.Session()
    public_client.trust_env = False
    assert public_client.get(public).text == "workspace"
    assert public_client.get(public, headers={"Host": "bad.test"}).status_code == 400
    assert public_client.put(public + "/api/desktop/web-access", headers={
        "Origin": public, "X-NAI-Desktop": service.key}, json={"enabled": False}).status_code == 403
    assert http.put(settings, json={"enabled": False}).json()["enabled"] is False
    with pytest.raises(requests.ConnectionError):
        public_client.get(public, timeout=1)
    assert http.get(settings).ok


def test_restore_and_recover_from_occupied_port(desktop):
    first = desktop()
    session, url = client(first)
    assert session.put(url, json={"enabled": True}).ok
    first.close()
    with closing(socket.socket()) as occupied:
        occupied.bind(("127.0.0.1", first.web_port))
        occupied.listen()
        second = desktop()
        assert second.key != first.key
        session, url = client(second)
        assert session.get(url).json()["error"] == "WEB_START_FAILED"
        assert session.put(url, json={"enabled": True}).status_code == 409
    assert session.put(url, json={"enabled": True}).json()["enabled"] is True
    second.close()
    third = desktop()
    session, url = client(third)
    assert session.get(url).json()["enabled"] is True
