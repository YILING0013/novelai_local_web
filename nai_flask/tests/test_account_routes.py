import json
from urllib.parse import urlsplit

from api_utils.account_change import (
    decrypt_keystore,
    encrypt_keystore,
    get_access_key,
    get_encryption_key,
)
from api_utils.novelai_client import NovelAIClient
from app import create_app
from conftest import ORIGIN


class _FakeResponse:
    """提供 NovelAIClient 所需的最小 requests 响应表面。"""

    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.content = json.dumps(payload).encode("utf-8")

    def json(self):
        """返回预设 JSON 对象。"""

        return self._payload


class _FakeOfficialAccountApi:
    """在内存中模拟一次真实的改密、keystore 重包和回读。"""

    def __init__(self):
        self.email = "owner@example.com"
        self.old_password = "Old-password-123!"
        self.new_password = "New-password-456!"
        self.source_access_key = get_access_key(self.email, self.old_password)
        self.target_access_key = get_access_key(self.email, self.new_password)
        self.valid_access_key = self.source_access_key
        self.plaintext = {"keys": {"story": list(range(32))}}
        self.keystore = encrypt_keystore(
            self.plaintext,
            get_encryption_key(self.email, self.old_password),
            nonce=bytes(range(24)),
        )
        self.change_index = 7
        self.change_calls = 0
        self.put_calls = 0

    def request(self, method, url, **kwargs):
        """按固定官方路径执行内存状态转换并返回响应。"""

        path = urlsplit(url).path
        if method == "POST" and path == "/user/login":
            access_key = kwargs["json"]["key"]
            if access_key != self.valid_access_key:
                return _FakeResponse(403, {"code": "INVALID_ACCESS_KEY"})
            token = "token-target" if access_key == self.target_access_key else "token-source"
            return _FakeResponse(200, {"accessToken": token})
        if method == "GET" and path == "/user/information":
            return _FakeResponse(200, {
                "plainTextEmail": self.email,
                "emailVerified": True,
            })
        if method == "GET" and path == "/user/subscription":
            return _FakeResponse(200, {
                "tier": 3,
                "trainingStepsLeft": {
                    "fixedTrainingStepsLeft": 100,
                    "purchasedTrainingSteps": 20,
                },
            })
        if method == "GET" and path == "/user/keystore":
            return _FakeResponse(200, {
                "keystore": self.keystore,
                "changeIndex": self.change_index,
            })
        if method == "POST" and path == "/user/change-access-key":
            self.change_calls += 1
            assert kwargs["json"] == {
                "currentAccessKey": self.source_access_key,
                "newAccessKey": self.target_access_key,
            }
            self.valid_access_key = self.target_access_key
            return _FakeResponse(200, {"accessToken": "token-target"})
        if method == "PUT" and path == "/user/keystore":
            self.put_calls += 1
            assert kwargs["headers"]["Authorization"] == "Bearer token-target"
            self.keystore = kwargs["json"]["keystore"]
            self.change_index += 1
            return _FakeResponse(200, {})
        raise AssertionError(f"unexpected fake official request: {method} {path}")


def test_password_change_route_runs_real_client_coordinator_and_keystore_flow(tmp_path):
    """从 Flask 路由贯通真实客户端、协调器、重包回读与会话 finalize。"""

    official = _FakeOfficialAccountApi()
    data_dir = tmp_path / "data"
    app = create_app(
        {"TESTING": True, "DATA_DIR": str(data_dir)},
        novelai_client=NovelAIClient(request_func=official.request),
    )
    client = app.test_client()
    login = client.post(
        "/api/session/password",
        json={"email": official.email, "password": official.old_password},
        headers={"Origin": ORIGIN},
    )
    assert login.status_code == 200

    changed = client.post(
        "/api/account/change-password",
        json={
            "current_password": official.old_password,
            "new_password": official.new_password,
            "backup_confirmed": True,
        },
        headers={
            "Origin": ORIGIN,
            "X-CSRF-Token": login.get_json()["csrf_token"],
        },
    )

    assert changed.status_code == 200
    assert changed.get_json()["operation"] == "password"
    assert official.change_calls == 1
    assert official.put_calls == 1
    assert decrypt_keystore(
        official.keystore,
        get_encryption_key(official.email, official.new_password),
    ) == official.plaintext
    stored = next(iter(app.extensions["local_sessions"].values()))
    assert stored["token"] == "token-target"
    assert not (data_dir / "account-change-recovery.json").exists()
