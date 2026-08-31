"""NovelAI 凭据派生与 keystore 变更的离线回归测试。"""

import base64
import json

from pathlib import Path

import pytest

from api_utils.account_change import (
    AccountChangeCoordinator,
    CredentialChangeError,
    CredentialChangeUncertain,
    RecoveryJournal,
    RemoteKeystore,
    decrypt_keystore,
    encrypt_keystore,
    get_access_key,
    get_encryption_key,
    keystore_fingerprint,
)


def test_access_key_matches_browser_compatible_vectors() -> None:
    """固定普通与 emoji 向量，防止退回 Python code-point 截取语义。"""
    assert get_access_key(
        "User@Example.COM",
        "correct horse battery staple",
    ) == "AGpAvK0IEBF3UpqM3TJAfkGPdqF2JsCXUe9JM4mlH_ZuB80mR5xi3ujyhH2hbDIz"
    assert get_access_key(
        "unicode@example.com",
        "ab😀cd😀EF",
    ) == "6FApYJoyadXAKPacBJTntP879SCgcMHJDgt3AiDrNNZAw5U55rKUSXFS0lOHmV_I"


def test_keystore_round_trip_and_tamper_detection() -> None:
    """目标密钥必须能回读同一明文，篡改后的密文必须认证失败。"""
    plaintext = {"keys": {"story": list(range(32))}, "future": {"keep": True}}
    encryption_key = get_encryption_key("user@example.com", "A-password-123!")
    payload = encrypt_keystore(
        plaintext,
        encryption_key,
        nonce=bytes(range(24)),
    )
    assert decrypt_keystore(payload, encryption_key) == plaintext

    envelope = json.loads(base64.b64decode(payload).decode("utf-8"))
    envelope["sdata"][-1] ^= 1
    tampered = base64.b64encode(
        json.dumps(envelope, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    with pytest.raises(CredentialChangeError):
        decrypt_keystore(tampered, encryption_key)


class _FakeClient:
    """只实现账号变更流程所需方法的确定性官方接口替身。"""

    def __init__(
        self,
        source_access_key: str,
        target_access_key: str,
        remote_payload: str,
        *,
        fail_change: bool = False,
    ) -> None:
        self.source_access_key = source_access_key
        self.target_access_key = target_access_key
        self.remote_payload = remote_payload
        self.valid_access_key = source_access_key
        self.fail_change = fail_change
        self.change_calls = 0
        self.put_calls = 0

    def login(self, access_key: str) -> str:
        """模拟只允许当前有效 access key 登录。"""
        if access_key != self.valid_access_key:
            raise RuntimeError("unauthorized")
        return "token-source" if access_key == self.source_access_key else "token-target"

    def try_login(self, access_key: str) -> str | None:
        """模拟明确的凭据有效性探测。"""
        try:
            return self.login(access_key)
        except RuntimeError:
            return None

    def get_keystore_record(self, token: str) -> RemoteKeystore:
        """返回当前远端 keystore。"""
        return RemoteKeystore(
            self.remote_payload,
            7,
            confirmed_missing=self.remote_payload is None,
        )

    def change_access_key(
        self,
        current_access_key: str,
        new_access_key: str,
        token: str,
        new_email: str | None,
    ) -> str:
        """模拟一次不可重试的官方 access-key mutation。"""
        self.change_calls += 1
        if self.fail_change:
            raise CredentialChangeUncertain("result unknown")
        assert current_access_key == self.source_access_key
        assert new_access_key == self.target_access_key
        assert new_email is None
        self.valid_access_key = self.target_access_key
        return "token-target"

    def put_keystore(self, token: str, keystore: str) -> None:
        """模拟使用目标 token 覆盖远端 keystore。"""
        assert token == "token-target"
        self.put_calls += 1
        self.remote_payload = keystore


def _build_coordinator(tmp_path: Path, *, fail_change: bool = False):
    """构造密码变更所需的离线客户端和协调器。"""
    email = "owner@example.com"
    old_password = "Old-password-123!"
    new_password = "New-password-456!"
    plaintext = {"keys": {"story": list(range(32))}}
    remote_payload = encrypt_keystore(
        plaintext,
        get_encryption_key(email, old_password),
        nonce=bytes(range(24)),
    )
    client = _FakeClient(
        get_access_key(email, old_password),
        get_access_key(email, new_password),
        remote_payload,
        fail_change=fail_change,
    )
    journal = RecoveryJournal(tmp_path / "account-change-recovery.json")
    return (
        AccountChangeCoordinator(client, journal),
        client,
        journal,
        email,
        old_password,
        new_password,
        plaintext,
    )


def test_password_change_rewraps_and_verifies_keystore(tmp_path: Path) -> None:
    """完整成功前不得清理恢复日志或切换到目标 Token。"""
    coordinator, client, journal, email, old_password, new_password, plaintext = (
        _build_coordinator(tmp_path)
    )
    token = coordinator.change(
        operation="password",
        source_email=email,
        source_password=old_password,
        target_email=email,
        target_password=new_password,
        correlation_id="ABC123",
    )
    assert token == "token-target"
    assert client.change_calls == 1
    assert client.put_calls == 1
    assert journal.load()["stage"] == "verified"
    # 调用方先切换内存 Session，再显式确认清理；崩溃窗口仍可恢复。
    coordinator.finalize()
    assert journal.load() is None
    migrated = decrypt_keystore(
        client.remote_payload,
        get_encryption_key(email, new_password),
    )
    assert keystore_fingerprint(migrated) == keystore_fingerprint(plaintext)


def test_uncertain_change_is_not_retried_and_journal_has_no_secrets(
    tmp_path: Path,
) -> None:
    """不确定 mutation 只记录非敏感阶段，不能隐式发起第二次请求。"""
    coordinator, client, journal, email, old_password, new_password, _ = (
        _build_coordinator(tmp_path, fail_change=True)
    )
    with pytest.raises(CredentialChangeUncertain):
        coordinator.change(
            operation="password",
            source_email=email,
            source_password=old_password,
            target_email=email,
            target_password=new_password,
            correlation_id="XYZ789",
        )
    assert client.change_calls == 1
    record = journal.load()
    assert record is not None
    assert record["stage"] == "change_result_unknown"
    serialized = (tmp_path / "account-change-recovery.json").read_text(encoding="utf-8")
    for secret in (email, old_password, new_password, "token-source", "token-target"):
        assert secret not in serialized

    with pytest.raises(CredentialChangeUncertain):
        coordinator.resolve(
            source_email=email,
            source_password=old_password,
            target_email=email,
            target_password=new_password,
        )
    assert client.change_calls == 1
    assert journal.load()["stage"] == "change_result_unknown"


def test_change_operation_invariants_are_enforced(tmp_path: Path) -> None:
    """改密不能暗改邮箱，改邮也不能把密码变化合并进同一 mutation。"""
    coordinator, _, _, email, old_password, new_password, _ = _build_coordinator(tmp_path)
    with pytest.raises(CredentialChangeError):
        coordinator.change(
            operation="password",
            source_email=email,
            source_password=old_password,
            target_email="other@example.com",
            target_password=new_password,
            correlation_id="INV001",
        )
    with pytest.raises(CredentialChangeError):
        coordinator.change(
            operation="email",
            source_email=email,
            source_password=old_password,
            target_email="other@example.com",
            target_password=new_password,
            correlation_id="INV002",
        )
    with pytest.raises(CredentialChangeError):
        get_access_key(" owner@example.com", old_password)


def test_confirmed_missing_keystore_is_created_without_overwriting_unknown_empty(
    tmp_path: Path,
) -> None:
    """只有经官方 user/data 交叉确认无库时才能初始化空 keystore。"""
    email = "empty@example.com"
    old_password = "Old-password-123!"
    new_password = "New-password-456!"
    client = _FakeClient(
        get_access_key(email, old_password),
        get_access_key(email, new_password),
        None,
    )
    journal = RecoveryJournal(tmp_path / "account-change-recovery.json")
    coordinator = AccountChangeCoordinator(client, journal)
    coordinator.change(
        operation="password",
        source_email=email,
        source_password=old_password,
        target_email=email,
        target_password=new_password,
        correlation_id="EMP001",
    )
    assert decrypt_keystore(
        client.remote_payload,
        get_encryption_key(email, new_password),
    ) == {"keys": {}}
    coordinator.finalize()

    class _UnknownEmptyClient(_FakeClient):
        def get_keystore_record(self, token: str) -> RemoteKeystore:
            """模拟一次未经 user/data 交叉确认的空响应。"""
            return RemoteKeystore(None, 7, confirmed_missing=False)

    unknown_client = _UnknownEmptyClient(
        get_access_key(email, old_password),
        get_access_key(email, new_password),
        None,
    )
    with pytest.raises(CredentialChangeError):
        AccountChangeCoordinator(
            unknown_client,
            RecoveryJournal(tmp_path / "unknown.json"),
        ).change(
            operation="password",
            source_email=email,
            source_password=old_password,
            target_email=email,
            target_password=new_password,
            correlation_id="EMP002",
        )
    assert unknown_client.change_calls == 0


def test_second_read_change_index_drift_stops_before_mutation(tmp_path: Path) -> None:
    """mutation 前的第二次读取发现远端漂移时必须停止。"""
    coordinator, client, journal, email, old_password, new_password, _ = (
        _build_coordinator(tmp_path)
    )

    class _DriftClient(_FakeClient):
        def __init__(self) -> None:
            super().__init__(
                client.source_access_key,
                client.target_access_key,
                client.remote_payload,
            )
            self.reads = 0

        def get_keystore_record(self, token: str) -> RemoteKeystore:
            """第二次读取返回不同 change index。"""
            self.reads += 1
            return RemoteKeystore(self.remote_payload, 6 + self.reads)

    drift_client = _DriftClient()
    with pytest.raises(CredentialChangeError):
        AccountChangeCoordinator(drift_client, journal).change(
            operation="password",
            source_email=email,
            source_password=old_password,
            target_email=email,
            target_password=new_password,
            correlation_id="DRF001",
        )
    assert drift_client.change_calls == 0
    assert journal.load() is None


def test_recovery_with_target_login_only_rewraps_keystore(tmp_path: Path) -> None:
    """目标凭据已生效时，恢复流程只能补 keystore，不能重发 access-key mutation。"""
    coordinator, client, journal, email, old_password, new_password, plaintext = (
        _build_coordinator(tmp_path)
    )

    def applied_but_uncertain(current_access_key, new_access_key, token, new_email):
        client.change_calls += 1
        client.valid_access_key = client.target_access_key
        raise CredentialChangeUncertain("response lost")

    client.change_access_key = applied_but_uncertain
    with pytest.raises(CredentialChangeUncertain):
        coordinator.change(
            operation="password",
            source_email=email,
            source_password=old_password,
            target_email=email,
            target_password=new_password,
            correlation_id="RCV001",
        )
    status, token = coordinator.resolve(
        source_email=email,
        source_password=old_password,
        target_email=email,
        target_password=new_password,
    )
    assert status == "completed"
    assert token == "token-target"
    assert client.change_calls == 1
    assert client.put_calls == 1
    assert keystore_fingerprint(
        decrypt_keystore(
            client.remote_payload,
            get_encryption_key(email, new_password),
        )
    ) == keystore_fingerprint(plaintext)
    assert journal.load()["stage"] == "recovery_verified"
    coordinator.finalize()


def test_recovery_with_target_login_and_confirmed_missing_creates_keystore(
    tmp_path: Path,
) -> None:
    """change 已生效但远端仍无库时，恢复必须补写并验证目标空库。"""
    email = "empty-recovery@example.com"
    old_password = "Old-password-123!"
    new_password = "New-password-456!"
    client = _FakeClient(
        get_access_key(email, old_password),
        get_access_key(email, new_password),
        None,
    )
    journal = RecoveryJournal(tmp_path / "account-change-recovery.json")
    coordinator = AccountChangeCoordinator(client, journal)

    def applied_but_uncertain(current_access_key, new_access_key, token, new_email):
        client.change_calls += 1
        client.valid_access_key = client.target_access_key
        raise CredentialChangeUncertain("response lost")

    client.change_access_key = applied_but_uncertain
    with pytest.raises(CredentialChangeUncertain):
        coordinator.change(
            operation="password",
            source_email=email,
            source_password=old_password,
            target_email=email,
            target_password=new_password,
            correlation_id="EMP003",
        )

    assert client.remote_payload is None
    status, token = coordinator.resolve(
        source_email=email,
        source_password=old_password,
        target_email=email,
        target_password=new_password,
    )
    assert status == "completed"
    assert token == "token-target"
    assert client.change_calls == 1
    assert client.put_calls == 1
    assert client.remote_payload is not None
    assert decrypt_keystore(
        client.remote_payload,
        get_encryption_key(email, new_password),
    ) == {"keys": {}}
    assert journal.load()["stage"] == "recovery_verified"
    coordinator.finalize()
    assert journal.load() is None
