from api_utils.novelai_client import NovelAIUpstreamError
from conftest import ORIGIN, login


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
