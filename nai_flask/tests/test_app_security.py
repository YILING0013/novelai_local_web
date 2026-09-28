import pytest

import app as app_module
from app import create_app
from api_utils.novelai_client import NovelAIUpstreamError
from conftest import ORIGIN, login


@pytest.fixture
def lan_app(tmp_path, monkeypatch, fake_client):
    """使用合成本机地址创建 LAN 应用，不打开任何网络监听。"""
    monkeypatch.delenv("NOVELAI_LOCAL_ALLOW_LAN", raising=False)
    monkeypatch.setattr(app_module, "discover_lan_ipv4_addresses", lambda: ["192.168.0.103", "10.0.0.5"])
    return create_app({"TESTING": True, "ALLOW_LAN": True, "DATA_DIR": str(tmp_path / "lan-data")}, novelai_client=fake_client)


def test_default_mode_rejects_lan_host_and_non_loopback_peer(client):
    """默认不能借修改 Host 或代理头让私网设备访问本机 API。"""
    host = client.get("/api/session", base_url="http://192.168.0.103:5000", environ_overrides={"REMOTE_ADDR": "192.168.0.20"})
    assert host.status_code == 400 and host.get_json()["code"] == "HOST_NOT_ALLOWED"
    peer = client.get("/api/session", environ_overrides={"REMOTE_ADDR": "192.168.0.20"},
                      headers={"X-Forwarded-For": "127.0.0.1", "Forwarded": "for=127.0.0.1;host=localhost"})
    assert peer.status_code == 403 and peer.get_json()["code"] == "PEER_NOT_ALLOWED"


def test_lan_login_cookie_and_csrf_write_use_exact_same_origin(lan_app):
    """真实私网 peer 经本机地址同源登录后可写设置，仍要求会话 Cookie 与 CSRF。"""
    client = lan_app.test_client()
    origin = "http://192.168.0.103:5000"
    peer = {"REMOTE_ADDR": "192.168.0.20"}
    response = client.post("/api/session/persistent-token", base_url=origin, environ_overrides=peer,
                           json={"token": "pst-lan-test"}, headers={"Origin": origin})
    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == origin
    assert "HttpOnly" in response.headers["Set-Cookie"] and "SameSite=Strict" in response.headers["Set-Cookie"]
    csrf = response.get_json()["csrf_token"]
    assert client.get("/api/session", base_url=origin, environ_overrides=peer).get_json()["authenticated"] is True
    missing_csrf = client.put("/api/local/settings", base_url=origin, environ_overrides=peer,
                              json={"settings": {"theme": "dark"}}, headers={"Origin": origin})
    assert missing_csrf.status_code == 403 and missing_csrf.get_json()["code"] == "CSRF_INVALID"
    written = client.put("/api/local/settings", base_url=origin, environ_overrides=peer,
                         json={"settings": {"theme": "dark"}}, headers={"Origin": origin, "X-CSRF-Token": csrf,
                         "X-Forwarded-For": "8.8.8.8", "X-Forwarded-Host": "attacker.example", "X-Forwarded-Proto": "https"})
    assert written.status_code == 200 and written.get_json()["settings"]["theme"] == "dark"
    dev = client.options("/api/session/persistent-token", base_url="http://localhost:5000",
                         headers={"Origin": "http://localhost:3000"})
    assert dev.status_code == 204


@pytest.mark.parametrize("host", ["192.168.0.99:5000", "192.168.0.103.attacker.example:5000", "198.18.0.1:5000", "attacker.example", "192.168.0.103:3000"])
def test_lan_mode_rejects_undiscovered_or_spoofed_hosts(lan_app, host):
    """私网地址也必须属于本机发现集合，不能放开所有私网 Host 或相似域名。"""
    response = lan_app.test_client().get("/api/session", headers={"Host": host}, environ_overrides={"REMOTE_ADDR": "192.168.0.20"})
    assert response.status_code == 400 and response.get_json()["code"] == "HOST_NOT_ALLOWED"


@pytest.mark.parametrize("origin", ["https://attacker.example", "http://192.168.0.103.attacker.example:5000", "http://10.0.0.5:5000",
                                  "http://192.168.0.103:3000", "https://192.168.0.103:5000", "http://192.168.0.103:5000/path",
                                  "http://localhost:3000"])
def test_lan_origin_must_match_this_request_host_and_port(lan_app, origin):
    """另一张本机网卡、错误协议/端口及伪造相似来源均不视为本请求同源。"""
    response = lan_app.test_client().post("/api/session/persistent-token", base_url="http://192.168.0.103:5000",
                                        environ_overrides={"REMOTE_ADDR": "192.168.0.20"}, json={"token": "pst-test"}, headers={"Origin": origin})
    assert response.status_code == 403 and response.get_json()["code"] == "ORIGIN_NOT_ALLOWED"
    assert "Access-Control-Allow-Origin" not in response.headers


@pytest.mark.parametrize("peer", ["8.8.8.8", "198.18.0.1", "100.64.0.1", "169.254.1.2", "2001:4860:4860::8888"])
def test_lan_mode_rejects_non_rfc1918_peers_despite_forwarded_headers(lan_app, peer):
    """代理头不能把公网或特殊地址连接伪装为同 Wi-Fi 私网设备。"""
    origin = "http://192.168.0.103:5000"
    response = lan_app.test_client().get("/api/session", base_url=origin, environ_overrides={"REMOTE_ADDR": peer},
                                       headers={"Origin": origin, "X-Forwarded-For": "192.168.0.20", "Forwarded": "for=192.168.0.20"})
    assert response.status_code == 403 and response.get_json()["code"] == "PEER_NOT_ALLOWED"
    assert "Access-Control-Allow-Origin" not in response.headers


def password_login(client, email="owner@example.com"):
    """建立允许修改 NovelAI 凭据的本地密码会话。"""

    response = client.post(
        "/api/session/password",
        json={"email": email, "password": "Old-password-123!"},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 200
    return response.get_json()["csrf_token"]


def test_session_login_and_csrf_boundary(client, fake_client):
    assert client.get("/api/session").get_json() == {"authenticated": False}

    missing_origin = client.post(
        "/api/session/persistent-token",
        json={"token": "pst-test"},
    )
    assert missing_origin.status_code == 403
    assert missing_origin.get_json()["code"] == "ORIGIN_REQUIRED"
    assert missing_origin.get_json()["certain"] is True
    assert missing_origin.get_json()["uncertain"] is False
    assert missing_origin.get_json()["correlation_id"]

    csrf = login(client)
    session = client.get("/api/session").get_json()
    assert session["authenticated"] is True
    assert session["csrf_token"] == csrf
    assert "account_snapshot" in session
    assert fake_client.calls[0] == ("account", "pst-test")

    rejected = client.put(
        "/api/local/settings",
        json={"settings": {"theme": "dark"}},
        headers={"Origin": ORIGIN},
    )
    assert rejected.status_code == 403
    assert rejected.get_json()["code"] == "CSRF_INVALID"


def test_host_origin_and_cors_are_restricted(client):
    host_response = client.get("/api/session", headers={"Host": "attacker.example"})
    assert host_response.status_code == 400
    assert host_response.get_json()["code"] == "HOST_NOT_ALLOWED"

    origin_response = client.post(
        "/api/session/persistent-token",
        json={"token": "pst-test"},
        headers={"Origin": "https://attacker.example"},
    )
    assert origin_response.status_code == 403
    assert "Access-Control-Allow-Origin" not in origin_response.headers

    preflight = client.options(
        "/api/session/persistent-token",
        headers={"Origin": ORIGIN},
    )
    assert preflight.status_code == 204
    assert preflight.headers["Access-Control-Allow-Origin"] == ORIGIN
    assert preflight.headers["Access-Control-Allow-Credentials"] == "true"


def test_upstream_401_clears_local_session(client, fake_client):
    login(client)
    fake_client.reject_account = True

    response = client.get("/api/account")
    assert response.status_code == 401
    assert response.get_json()["code"] == "NOVELAI_UNAUTHORIZED"
    assert client.get("/api/session").get_json() == {"authenticated": False}


def test_password_login_does_not_store_password(client, fake_client, app):
    response = client.post(
        "/api/session/password",
        json={"email": "user@example.com", "password": "plain-secret"},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 200
    assert fake_client.calls[0] == ("password", "user@example.com", "plain-secret")
    stored = next(iter(app.extensions["local_sessions"].values()))
    assert stored["token"] == "pst-password"
    assert "password" not in stored


def test_logout_requires_csrf_and_removes_session(client):
    csrf = login(client)
    response = client.delete(
        "/api/session",
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )
    assert response.status_code == 200
    assert response.get_json() == {"authenticated": False}
    assert client.get("/api/session").get_json() == {"authenticated": False}


def test_email_change_switches_session_before_finalize_and_clears_stale_verification(
    client,
    fake_client,
    app,
):
    """改邮刷新失败时保留成功身份，但不得沿用旧邮箱的验证状态。"""

    csrf = password_login(client)

    class SuccessfulCoordinator:
        def __init__(self):
            self.change_kwargs = None
            self.token_seen_on_finalize = None

        def change(self, **kwargs):
            self.change_kwargs = kwargs
            return "pst-new-email"

        def finalize(self):
            entry = next(iter(app.extensions["local_sessions"].values()))
            self.token_seen_on_finalize = entry["token"]

    coordinator = SuccessfulCoordinator()
    app.extensions["account_change_coordinator"] = coordinator
    original_snapshot = fake_client.account_snapshot

    def account_snapshot(token):
        if token == "pst-new-email":
            raise NovelAIUpstreamError("temporary failure", 502, "TEST_FAILURE")
        return original_snapshot(token)

    fake_client.account_snapshot = account_snapshot
    response = client.post(
        "/api/account/change-email",
        json={
            "current_password": "Old-password-123!",
            "new_email": "new@example.com",
            "backup_confirmed": True,
        },
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )

    assert response.status_code == 200
    snapshot = response.get_json()["account_snapshot"]
    assert snapshot["stale"] is True
    assert snapshot["information"]["email"] == "new@example.com"
    assert snapshot["information"]["email_verified"] is None
    assert coordinator.change_kwargs["operation"] == "email"
    assert coordinator.token_seen_on_finalize == "pst-new-email"
    stored = next(iter(app.extensions["local_sessions"].values()))
    assert stored["token"] == "pst-new-email"


def test_account_routes_reject_weak_or_oversized_passwords_before_coordinator(
    client,
    app,
):
    """新操作执行密码策略，恢复只执行防止过大输入的上限。"""

    csrf = password_login(client)

    class MustNotRunCoordinator:
        def change(self, **kwargs):
            raise AssertionError("invalid change input reached coordinator")

        def resolve(self, **kwargs):
            raise AssertionError("invalid recovery input reached coordinator")

    app.extensions["account_change_coordinator"] = MustNotRunCoordinator()
    weak = client.post(
        "/api/account/change-password",
        json={
            "current_password": "Old-password-123!",
            "new_password": "short",
            "backup_confirmed": True,
        },
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )
    assert weak.status_code == 400
    assert weak.get_json()["code"] == "NEW_PASSWORD_INVALID"

    oversized = client.post(
        "/api/account/recovery/resolve",
        json={
            "source_email": "owner@example.com",
            "source_password": "x" * 4097,
            "target_email": "owner@example.com",
            "target_password": "short-history-password",
        },
        headers={"Origin": ORIGIN},
    )
    assert oversized.status_code == 400
    assert oversized.get_json()["code"] == "RECOVERY_CREDENTIALS_INVALID"


def test_account_change_waits_for_current_image_batch(client, app):
    """连续生成尚未终态时不得在两张图片之间修改官方凭据。"""

    csrf = password_login(client)
    generated = client.post(
        "/api/images/generate",
        json={
            "batch_id": "credential-change-guard",
            "index": 0,
            "batch_size": 2,
            "model": "nai-diffusion-4-5-full",
            "positivePrompt": "1girl",
            "negativePrompt": "",
            "width": 512,
            "height": 512,
            "steps": 20,
            "seed": 123,
        },
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )
    assert generated.status_code == 200

    class MustNotRunCoordinator:
        def change(self, **kwargs):
            raise AssertionError("active image batch reached credential mutation")

    app.extensions["account_change_coordinator"] = MustNotRunCoordinator()
    response = client.post(
        "/api/account/change-password",
        json={
            "current_password": "Old-password-123!",
            "new_password": "New-password-456!",
            "backup_confirmed": True,
        },
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )

    assert response.status_code == 409
    assert response.get_json()["code"] == "IMAGE_BATCH_ACTIVE"


def test_recovery_gate_and_resolve_create_session_before_finalize(client, app):
    """恢复激活时阻断普通登录，成功收敛后先建会话再清理日志。"""

    class ActiveJournal:
        def __init__(self):
            self.active = True

        def load(self):
            if not self.active:
                return None
            return {
                "operation": "password",
                "stage": "change_result_unknown",
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:01+00:00",
                "correlation_id": "ABC123",
            }

    journal = ActiveJournal()
    app.extensions["account_recovery_journal"] = journal

    class RecoveryCoordinator:
        def __init__(self):
            self.token_seen_on_finalize = None

        def resolve(self, **kwargs):
            return "completed", "pst-recovered"

        def finalize(self):
            entry = next(iter(app.extensions["local_sessions"].values()))
            self.token_seen_on_finalize = entry["token"]
            journal.active = False

    coordinator = RecoveryCoordinator()
    app.extensions["account_change_coordinator"] = coordinator

    blocked = client.post(
        "/api/session/persistent-token",
        json={"token": "pst-other"},
        headers={"Origin": ORIGIN},
    )
    assert blocked.status_code == 409
    assert blocked.get_json()["code"] == "ACCOUNT_RECOVERY_REQUIRED"

    response = client.post(
        "/api/account/recovery/resolve",
        json={
            "source_email": "owner@example.com",
            "source_password": "Old-password-123!",
            "target_email": "owner@example.com",
            "target_password": "New-password-456!",
        },
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 200
    assert response.get_json()["authenticated"] is True
    assert coordinator.token_seen_on_finalize == "pst-recovered"
    assert client.get("/api/account/recovery").get_json() == {"active": False}
    assert client.get("/api/session").get_json()["authenticated"] is True
