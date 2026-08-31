"""NovelAI 账号凭据派生、keystore 重包和中断恢复。"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import stat
import subprocess
import tempfile
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Protocol

from argon2 import Type
from argon2.low_level import hash_secret_raw
from nacl.exceptions import CryptoError
from nacl.secret import SecretBox


ACCESS_KEY_DOMAIN = "novelai_data_access_key"
ENCRYPTION_KEY_DOMAIN = "novelai_data_encryption_key"
RECOVERY_VERSION = 1
_ACCOUNT_CHANGE_LOCK = threading.RLock()
_RECOVERY_JOURNAL_LOCK = threading.RLock()
_LOCAL_PART_PATTERN = re.compile(
    r"^[A-Za-z0-9!#$%&'*+/=?^_`{|}~](?:"
    r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{0,62}"
    r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~]"
    r")?$"
)
_DOMAIN_LABEL_PATTERN = re.compile(
    r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$"
)
_HEX_64_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_HEX_32_PATTERN = re.compile(r"^[0-9a-f]{32}$")
_CORRELATION_PATTERN = re.compile(r"^[A-Za-z0-9]{6}$")
_RECOVERY_STAGES = {
    "change_requested",
    "change_result_unknown",
    "access_key_changed",
    "keystore_result_unknown",
    "keystore_saved",
    "verified",
    "recovery_verified",
}


class CredentialChangeError(RuntimeError):
    """表示账号凭据变更无法安全继续。"""


class CredentialChangeUncertain(CredentialChangeError):
    """表示远端 mutation 的结果无法从当前响应确定。"""


class CredentialChangeRejected(CredentialChangeError):
    """表示官方在确定响应中明确拒绝本次凭据 mutation。"""


class NovelAIAccountClient(Protocol):
    """账号变更流程所需的最小官方客户端契约。"""

    def login(self, access_key: str) -> str:
        """
        使用派生 access key 登录。

        Args:
            access_key: 当前邮箱和密码派生的 access key。

        Returns:
            官方返回的非空 access token。
        """
        ...

    def try_login(self, access_key: str) -> str | None:
        """
        探测凭据是否被官方明确接受。

        Args:
            access_key: 待验证的 access key。

        Returns:
            成功时返回 token；明确无效时返回 None。
        """
        ...

    def get_keystore_record(self, token: str) -> "RemoteKeystore":
        """
        读取并确认当前官方 keystore 状态。

        Args:
            token: 当前有效的官方 access token。

        Returns:
            包含密文、changeIndex 与空库确认状态的记录。
        """
        ...

    def change_access_key(
        self,
        current_access_key: str,
        new_access_key: str,
        token: str,
        new_email: str | None,
    ) -> str:
        """
        提交一次不可自动重放的官方凭据变更。

        Args:
            current_access_key: 当前 access key。
            new_access_key: 目标 access key。
            token: 当前凭据登录得到的 token。
            new_email: 改邮目标；纯改密时为 None。

        Returns:
            官方变更响应中的新 access token。
        """
        ...

    def put_keystore(self, token: str, keystore: str) -> None:
        """
        上传已完成本地自校验的目标 keystore。

        Args:
            token: 目标凭据对应的 access token。
            keystore: 由目标加密密钥重包后的 v2 keystore。

        Returns:
            无返回值。
        """
        ...


@dataclass(frozen=True)
class RemoteKeystore:
    """官方 keystore 响应中恢复判断需要的字段。"""

    payload: str | None
    change_index: int | None = None
    confirmed_missing: bool = False


def _normalize_email(email: str) -> str:
    """严格验证 ASCII 邮箱，并只进行大小写规范化。"""
    if not isinstance(email, str) or not email:
        raise CredentialChangeError("邮箱不能为空")
    if email != email.strip():
        raise CredentialChangeError("邮箱前后不能包含空白")
    if not email.isascii() or any(
        character.isspace() or ord(character) < 32 for character in email
    ):
        raise CredentialChangeError("邮箱只能包含有效 ASCII 字符")
    if len(email) > 254 or email.count("@") != 1:
        raise CredentialChangeError("邮箱格式无效")
    local_part, domain = email.rsplit("@", 1)
    if (
        not local_part
        or len(local_part) > 64
        or local_part.startswith(".")
        or local_part.endswith(".")
        or ".." in local_part
        or _LOCAL_PART_PATTERN.fullmatch(local_part) is None
    ):
        raise CredentialChangeError("邮箱本地部分格式无效")
    labels = domain.split(".")
    if (
        len(labels) < 2
        or any(not label for label in labels)
        or any(_DOMAIN_LABEL_PATTERN.fullmatch(label) is None for label in labels)
        or len(labels[-1]) < 2
        or not labels[-1].isalpha()
    ):
        raise CredentialChangeError("邮箱域名格式无效")
    return email.lower()


def _credential_digest(access_key: str, salt_hex: str) -> str:
    """用每次操作随机盐计算不可直接反查的凭据绑定摘要。"""
    return hashlib.sha256(bytes.fromhex(salt_hex) + access_key.encode("ascii")).hexdigest()


def _replace_lone_surrogates(value: str) -> str:
    """模拟浏览器 TextEncoder 对孤立 UTF-16 代理项的处理。"""
    return "".join(
        "\ufffd" if 0xD800 <= ord(character) <= 0xDFFF else character
        for character in value
    )


def _javascript_prefix(value: str, code_units: int) -> str:
    """按 JavaScript UTF-16 code unit 语义截取字符串前缀。"""
    encoded = value.encode("utf-16-le", errors="surrogatepass")
    decoded = encoded[: code_units * 2].decode("utf-16-le", errors="surrogatepass")
    return _replace_lone_surrogates(decoded)


def _browser_utf8(value: str) -> bytes:
    """按浏览器 TextEncoder 语义生成 UTF-8 字节。"""
    return _replace_lone_surrogates(value).encode("utf-8")


def derive_key(email: str, password: str, size: int, domain: str) -> str:
    """
    按 NovelAI 网页端参数派生 URL-safe Base64 密钥。

    Args:
        email: NovelAI 账号邮箱。
        password: 原始账号密码。
        size: Argon2 原始输出字节数。
        domain: NovelAI 用途隔离字符串。

    Returns:
        去掉 Base64 填充后的派生文本。
    """
    if not isinstance(password, str) or not password:
        raise CredentialChangeError("密码不能为空")
    if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
        raise ValueError("size 必须是正整数")
    if domain not in {ACCESS_KEY_DOMAIN, ENCRYPTION_KEY_DOMAIN}:
        raise ValueError("不支持的密钥用途")

    normalized_email = _normalize_email(email)
    password_prefix = _javascript_prefix(password, 6)
    salt_input = _browser_utf8(
        f"{password_prefix}{normalized_email}{domain}"
    )
    salt = hashlib.blake2b(salt_input, digest_size=16).digest()
    raw = hash_secret_raw(
        secret=_browser_utf8(password),
        salt=salt,
        time_cost=2,
        memory_cost=2_000_000 // 1024,
        parallelism=1,
        hash_len=size,
        type=Type.ID,
        version=19,
    )
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def get_access_key(email: str, password: str) -> str:
    """
    生成官方登录和凭据变更使用的 64 字符 access key。

    Args:
        email: NovelAI 账号邮箱。
        password: NovelAI 账号密码。

    Returns:
        64 字符 access key。
    """
    return derive_key(email, password, 64, ACCESS_KEY_DOMAIN)[:64]


def get_encryption_key(email: str, password: str) -> str:
    """
    生成 NovelAI v2 keystore 使用的文本加密密钥。

    Args:
        email: NovelAI 账号邮箱。
        password: NovelAI 账号密码。

    Returns:
        由 128 字节 Argon2 输出编码得到的文本密钥。
    """
    return derive_key(email, password, 128, ENCRYPTION_KEY_DOMAIN)


def _secret_box_key(encryption_key: str) -> bytes:
    """把文本加密密钥压缩为 SecretBox 所需的 32 字节密钥。"""
    if not isinstance(encryption_key, str) or not encryption_key:
        raise CredentialChangeError("keystore 加密密钥为空")
    return hashlib.blake2b(_browser_utf8(encryption_key), digest_size=32).digest()


def _decode_byte_array(
    value: Any,
    field_name: str,
    *,
    exact_length: int | None = None,
    minimum_length: int | None = None,
) -> bytes:
    """严格校验 keystore JSON 中的整数字节数组。"""
    if not isinstance(value, list):
        raise CredentialChangeError(f"keystore 字段 {field_name} 格式错误")
    if exact_length is not None and len(value) != exact_length:
        raise CredentialChangeError(f"keystore 字段 {field_name} 长度错误")
    if minimum_length is not None and len(value) < minimum_length:
        raise CredentialChangeError(f"keystore 字段 {field_name} 长度不足")
    if any(
        isinstance(item, bool)
        or not isinstance(item, int)
        or item < 0
        or item > 255
        for item in value
    ):
        raise CredentialChangeError(f"keystore 字段 {field_name} 内容错误")
    return bytes(value)


def decode_keystore(payload: str) -> tuple[bytes, bytes, dict[str, Any]]:
    """
    解码并严格验证 NovelAI v2 keystore 外层结构。

    Args:
        payload: 官方接口返回的 Base64 keystore。

    Returns:
        nonce、认证密文与需要原样保留的历史字段。
    """
    if not isinstance(payload, str) or not payload:
        raise CredentialChangeError("远端 keystore 为空")
    try:
        envelope = json.loads(base64.b64decode(payload, validate=True).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CredentialChangeError("远端 keystore 格式无效") from exc
    if not isinstance(envelope, dict) or envelope.get("version") != 2:
        raise CredentialChangeError("只支持 NovelAI v2 keystore")

    has_iv = "iv" in envelope
    has_data = "data" in envelope
    if has_iv != has_data:
        raise CredentialChangeError("keystore 历史字段不完整")
    legacy = {"iv": envelope["iv"], "data": envelope["data"]} if has_iv else {}
    nonce = _decode_byte_array(envelope.get("nonce"), "nonce", exact_length=24)
    ciphertext = _decode_byte_array(
        envelope.get("sdata"),
        "sdata",
        minimum_length=16,
    )
    return nonce, ciphertext, legacy


def _validate_plaintext(value: Any) -> dict[str, Any]:
    """验证 keystore 明文，同时保留官方未来增加的未知顶层字段。"""
    if not isinstance(value, dict) or not isinstance(value.get("keys"), dict):
        raise CredentialChangeError("keystore 明文结构无效")
    for key_name, key_value in value["keys"].items():
        if not isinstance(key_name, str) or not key_name:
            raise CredentialChangeError("keystore 含无效键名")
        _decode_byte_array(key_value, "keys.*", exact_length=32)
    return value


def decrypt_keystore(payload: str, encryption_key: str) -> dict[str, Any]:
    """
    解密并认证 NovelAI v2 keystore。

    Args:
        payload: 官方返回的 Base64 keystore。
        encryption_key: 当前邮箱和密码派生的文本密钥。

    Returns:
        验证后的完整 keystore 明文对象。
    """
    nonce, ciphertext, _ = decode_keystore(payload)
    try:
        plaintext_bytes = SecretBox(_secret_box_key(encryption_key)).decrypt(
            ciphertext,
            nonce,
        )
    except CryptoError as exc:
        raise CredentialChangeError("当前凭据无法认证远端 keystore") from exc
    try:
        plaintext = json.loads(plaintext_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CredentialChangeError("keystore 明文不是有效 JSON") from exc
    return _validate_plaintext(plaintext)


def encrypt_keystore(
    plaintext: Mapping[str, Any],
    encryption_key: str,
    *,
    legacy_fields: Mapping[str, Any] | None = None,
    nonce: bytes | None = None,
) -> str:
    """
    使用目标凭据重包同一份 NovelAI v2 keystore。

    Args:
        plaintext: 已验证的 keystore 明文。
        encryption_key: 目标邮箱和密码派生的文本密钥。
        legacy_fields: 可选的成对历史字段 ``iv`` 与 ``data``。
        nonce: 仅供测试注入的 24 字节 nonce。

    Returns:
        可提交给官方接口的 Base64 keystore。
    """
    validated = _validate_plaintext(dict(plaintext))
    actual_nonce = secrets.token_bytes(24) if nonce is None else nonce
    if not isinstance(actual_nonce, bytes) or len(actual_nonce) != 24:
        raise ValueError("keystore nonce 必须是 24 字节")
    plaintext_bytes = json.dumps(
        validated,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    ciphertext = SecretBox(_secret_box_key(encryption_key)).encrypt(
        plaintext_bytes,
        actual_nonce,
    ).ciphertext
    envelope: dict[str, Any] = {
        "version": 2,
        "nonce": list(actual_nonce),
        "sdata": list(ciphertext),
    }
    if legacy_fields:
        if set(legacy_fields) != {"iv", "data"}:
            raise CredentialChangeError("keystore 历史字段不完整")
        try:
            envelope.update(json.loads(json.dumps(dict(legacy_fields), allow_nan=False)))
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise CredentialChangeError("keystore 历史字段无法安全保留") from exc
    encoded = json.dumps(envelope, separators=(",", ":")).encode("utf-8")
    return base64.b64encode(encoded).decode("ascii")


def keystore_fingerprint(plaintext: Mapping[str, Any]) -> str:
    """
    计算 keystore 明文的稳定摘要，用于远端回读比对。

    Args:
        plaintext: 已验证的 keystore 明文。

    Returns:
        SHA-256 十六进制摘要。
    """
    validated = _validate_plaintext(dict(plaintext))
    canonical = json.dumps(
        validated,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


class RecoveryJournal:
    """只保存非敏感阶段信息的单文件恢复日志。"""

    def __init__(self, path: Path) -> None:
        self.path = path
        # Waitress 固定单进程；模块级锁让不同请求创建的日志实例仍互斥。
        self._lock = _RECOVERY_JOURNAL_LOCK

    def load(self) -> dict[str, Any] | None:
        """读取并验证当前恢复日志。"""
        with self._lock:
            if not self.path.exists():
                return None
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise CredentialChangeError("账户恢复日志损坏，已阻止继续操作") from exc
            required = {
                "version",
                "operation",
                "stage",
                "created_at",
                "updated_at",
                "fingerprint",
                "change_index",
                "correlation_id",
                "credential_salt",
                "source_digest",
                "target_digest",
            }
            if not isinstance(data, dict) or set(data) != required:
                raise CredentialChangeError("账户恢复日志结构无效，已阻止继续操作")
            if data["version"] != RECOVERY_VERSION:
                raise CredentialChangeError("账户恢复日志版本不受支持")
            if data["operation"] not in {"password", "email"}:
                raise CredentialChangeError("账户恢复日志操作类型无效")
            if data["stage"] not in _RECOVERY_STAGES:
                raise CredentialChangeError("账户恢复日志阶段无效")
            if not isinstance(data["fingerprint"], str) or not _HEX_64_PATTERN.fullmatch(
                data["fingerprint"]
            ):
                raise CredentialChangeError("账户恢复日志摘要无效")
            if not isinstance(data["credential_salt"], str) or not _HEX_32_PATTERN.fullmatch(
                data["credential_salt"]
            ):
                raise CredentialChangeError("账户恢复日志随机盐无效")
            for field_name in ("source_digest", "target_digest"):
                if not isinstance(data[field_name], str) or not _HEX_64_PATTERN.fullmatch(
                    data[field_name]
                ):
                    raise CredentialChangeError("账户恢复日志凭据绑定无效")
            if not isinstance(data["correlation_id"], str) or not _CORRELATION_PATTERN.fullmatch(
                data["correlation_id"]
            ):
                raise CredentialChangeError("账户恢复日志关联 ID 无效")
            if data["change_index"] is not None and (
                isinstance(data["change_index"], bool)
                or not isinstance(data["change_index"], int)
                or data["change_index"] < 0
            ):
                raise CredentialChangeError("账户恢复日志 change index 无效")
            for field_name in ("created_at", "updated_at"):
                try:
                    parsed_time = datetime.fromisoformat(data[field_name])
                except (TypeError, ValueError) as exc:
                    raise CredentialChangeError("账户恢复日志时间无效") from exc
                if parsed_time.tzinfo is None:
                    raise CredentialChangeError("账户恢复日志时间缺少时区")
            return data

    def write(self, record: Mapping[str, Any]) -> None:
        """在同目录原子写入恢复日志，并限制为当前系统用户可读。"""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            dict(record),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ).encode("utf-8")
        with self._lock:
            descriptor, temp_name = tempfile.mkstemp(
                prefix=f".{self.path.name}.",
                suffix=".tmp",
                dir=self.path.parent,
            )
            try:
                if os.name != "nt":
                    os.fchmod(descriptor, 0o600)
                with os.fdopen(descriptor, "wb") as handle:
                    handle.write(payload)
                    handle.flush()
                    os.fsync(handle.fileno())
                if os.name == "nt":
                    # 替换前先限制临时文件 ACL；失败时旧恢复日志仍完整保留。
                    username = os.environ.get("USERNAME")
                    user_domain = os.environ.get("USERDOMAIN")
                    current_user = (
                        f"{user_domain}\\{username}"
                        if user_domain and username
                        else username
                    )
                    if not current_user:
                        raise OSError("Current Windows user is unavailable")
                    result = subprocess.run(
                        [
                            "icacls",
                            temp_name,
                            "/inheritance:r",
                            "/grant:r",
                            f"{current_user}:(R,W)",
                        ],
                        check=False,
                        capture_output=True,
                        text=True,
                    )
                    if result.returncode != 0:
                        raise OSError("Could not restrict recovery journal ACL")
                else:
                    os.chmod(temp_name, stat.S_IRUSR | stat.S_IWUSR)
                os.replace(temp_name, self.path)
            except Exception:
                if os.path.exists(temp_name):
                    os.unlink(temp_name)
                raise

    def clear(self) -> None:
        """删除已经完成或已确定未执行的单个恢复日志文件。"""
        with self._lock:
            if self.path.exists():
                self.path.unlink()


class AccountChangeCoordinator:
    """顺序执行一次官方凭据变更并在中断后只做状态判定。"""

    def __init__(self, client: NovelAIAccountClient, journal: RecoveryJournal) -> None:
        self.client = client
        self.journal = journal

    @staticmethod
    def _prepare_keystore(
        remote: RemoteKeystore,
        source_email: str,
        source_password: str,
        target_email: str,
        target_password: str,
    ) -> tuple[str, str]:
        """认证远端 keystore，并生成经本地回读自校验的目标密文。"""
        if remote.payload is None:
            if not remote.confirmed_missing:
                raise CredentialChangeError("官方未能确认账号确实没有 keystore")
            plaintext = {"keys": {}}
            legacy_fields: dict[str, Any] = {}
        else:
            _, _, legacy_fields = decode_keystore(remote.payload)
            plaintext = decrypt_keystore(
                remote.payload,
                get_encryption_key(source_email, source_password),
            )
        fingerprint = keystore_fingerprint(plaintext)
        target_key = get_encryption_key(target_email, target_password)
        prepared = encrypt_keystore(
            plaintext,
            target_key,
            legacy_fields=legacy_fields,
        )
        _, _, prepared_legacy_fields = decode_keystore(prepared)
        if prepared_legacy_fields != legacy_fields:
            raise CredentialChangeError("keystore 历史字段重包自校验失败")
        if not secrets.compare_digest(
            keystore_fingerprint(decrypt_keystore(prepared, target_key)),
            fingerprint,
        ):
            raise CredentialChangeError("keystore 本地重包自校验失败")
        return prepared, fingerprint

    @staticmethod
    def _new_record(
        operation: str,
        fingerprint: str,
        change_index: int | None,
        correlation_id: str,
        source_access_key: str,
        target_access_key: str,
    ) -> dict[str, Any]:
        """创建不含邮箱、密码、Token 或密钥的恢复记录。"""
        now = datetime.now(timezone.utc).isoformat()
        credential_salt = secrets.token_hex(16)
        return {
            "version": RECOVERY_VERSION,
            "operation": operation,
            "stage": "change_requested",
            "created_at": now,
            "updated_at": now,
            "fingerprint": fingerprint,
            "change_index": change_index,
            "correlation_id": correlation_id,
            "credential_salt": credential_salt,
            "source_digest": _credential_digest(source_access_key, credential_salt),
            "target_digest": _credential_digest(target_access_key, credential_salt),
        }

    def _set_stage(self, record: dict[str, Any], stage: str) -> None:
        """更新恢复记录阶段并立即持久化。"""
        record["stage"] = stage
        record["updated_at"] = datetime.now(timezone.utc).isoformat()
        self.journal.write(record)

    def change(
        self,
        *,
        operation: str,
        source_email: str,
        source_password: str,
        target_email: str,
        target_password: str,
        correlation_id: str,
    ) -> str:
        """
        完成一次改密或改邮，并返回目标凭据的新 Token。

        Args:
            operation: ``password`` 或 ``email``。
            source_email: 当前邮箱。
            source_password: 用户本次重新输入的当前密码。
            target_email: 变更后的邮箱。
            target_password: 变更后的密码。
            correlation_id: 供用户定位本次操作的随机标识。

        Returns:
            目标凭据登录得到的新 Token。
        """
        with _ACCOUNT_CHANGE_LOCK:
            return self._change_locked(
                operation=operation,
                source_email=source_email,
                source_password=source_password,
                target_email=target_email,
                target_password=target_password,
                correlation_id=correlation_id,
            )

    def _change_locked(
        self,
        *,
        operation: str,
        source_email: str,
        source_password: str,
        target_email: str,
        target_password: str,
        correlation_id: str,
    ) -> str:
        """在进程级互斥锁内执行一次完整远端凭据事务。"""
        if operation not in {"password", "email"}:
            raise ValueError("不支持的账户变更类型")
        if not _CORRELATION_PATTERN.fullmatch(correlation_id):
            raise ValueError("correlation_id 必须是 6 位字母或数字")
        if self.journal.load() is not None:
            raise CredentialChangeError("存在未完成的账户恢复记录")

        normalized_source_email = _normalize_email(source_email)
        normalized_target_email = _normalize_email(target_email)
        if operation == "password":
            if normalized_source_email != normalized_target_email:
                raise CredentialChangeError("改密时目标邮箱必须与当前邮箱一致")
            if source_password == target_password:
                raise CredentialChangeError("新密码不能与当前密码相同")
        else:
            if normalized_source_email == normalized_target_email:
                raise CredentialChangeError("新邮箱不能与当前邮箱相同")
            if source_password != target_password:
                raise CredentialChangeError("改邮操作不能同时修改密码")

        source_access_key = get_access_key(normalized_source_email, source_password)
        target_access_key = get_access_key(normalized_target_email, target_password)
        source_token = self.client.login(source_access_key)
        first_remote = self.client.get_keystore_record(source_token)
        _, first_fingerprint = self._prepare_keystore(
            first_remote,
            normalized_source_email,
            source_password,
            normalized_target_email,
            target_password,
        )

        # mutation 前再次读取，避免覆盖用户在准备期间由官方网页更新的远端故事密钥。
        latest_remote = self.client.get_keystore_record(source_token)
        if (
            first_remote.payload != latest_remote.payload
            or first_remote.confirmed_missing != latest_remote.confirmed_missing
            or (
                first_remote.change_index is not None
                and latest_remote.change_index is not None
                and first_remote.change_index != latest_remote.change_index
            )
        ):
            raise CredentialChangeError("远端 keystore 在操作期间发生变化，请重新开始")
        prepared, latest_fingerprint = self._prepare_keystore(
            latest_remote,
            normalized_source_email,
            source_password,
            normalized_target_email,
            target_password,
        )
        if not secrets.compare_digest(first_fingerprint, latest_fingerprint):
            raise CredentialChangeError("远端 keystore 在操作期间发生变化，请重新开始")

        record = self._new_record(
            operation,
            latest_fingerprint,
            latest_remote.change_index,
            correlation_id,
            source_access_key,
            target_access_key,
        )
        self.journal.write(record)
        try:
            target_token = self.client.change_access_key(
                source_access_key,
                target_access_key,
                source_token,
                normalized_target_email if operation == "email" else None,
            )
        except CredentialChangeRejected:
            self.journal.clear()
            raise
        except CredentialChangeUncertain:
            self._set_stage(record, "change_result_unknown")
            raise

        self._set_stage(record, "access_key_changed")
        try:
            self.client.put_keystore(target_token, prepared)
        except CredentialChangeUncertain:
            self._set_stage(record, "keystore_result_unknown")
            raise
        except CredentialChangeError:
            self._set_stage(record, "keystore_result_unknown")
            raise

        self._set_stage(record, "keystore_saved")
        remote_after = self.client.get_keystore_record(target_token)
        if remote_after.payload is None:
            raise CredentialChangeError("官方回读未返回 keystore")
        verified = decrypt_keystore(
            remote_after.payload,
            get_encryption_key(normalized_target_email, target_password),
        )
        if not secrets.compare_digest(
            keystore_fingerprint(verified),
            latest_fingerprint,
        ):
            raise CredentialChangeError("官方回读 keystore 摘要不一致")
        final_token = self.client.login(target_access_key)
        # 调用方必须先把新 Token 和账号身份切换进内存 Session，再显式 finalize。
        # 若进程在两者之间退出，恢复日志仍会在下次启动时阻断普通登录。
        self._set_stage(record, "verified")
        return final_token

    def finalize(self) -> None:
        """在调用方已完成内存会话切换后清理恢复日志。"""
        with _ACCOUNT_CHANGE_LOCK:
            record = self.journal.load()
            if record is None:
                return
            if record["stage"] not in {"verified", "recovery_verified"}:
                raise CredentialChangeError("账户变更尚未完成验证，不能清理恢复日志")
            self.journal.clear()

    def resolve(
        self,
        *,
        source_email: str,
        source_password: str,
        target_email: str,
        target_password: str,
    ) -> tuple[str, str | None]:
        """
        使用用户重新输入的旧/新凭据判断并收敛一次中断操作。

        Args:
            source_email: 变更前邮箱。
            source_password: 变更前密码。
            target_email: 变更后邮箱。
            target_password: 变更后密码。

        Returns:
            ``(状态, token)``；状态为 ``completed`` 或 ``not_applied``。
        """
        with _ACCOUNT_CHANGE_LOCK:
            return self._resolve_locked(
                source_email=source_email,
                source_password=source_password,
                target_email=target_email,
                target_password=target_password,
            )

    def _resolve_locked(
        self,
        *,
        source_email: str,
        source_password: str,
        target_email: str,
        target_password: str,
    ) -> tuple[str, str | None]:
        """在进程级互斥锁内依据真实登录和远端 keystore 解析中断状态。"""
        record = self.journal.load()
        if record is None:
            raise CredentialChangeError("没有需要恢复的账户变更")
        normalized_source_email = _normalize_email(source_email)
        normalized_target_email = _normalize_email(target_email)
        source_access_key = get_access_key(normalized_source_email, source_password)
        target_access_key = get_access_key(normalized_target_email, target_password)
        if not secrets.compare_digest(
            _credential_digest(source_access_key, record["credential_salt"]),
            record["source_digest"],
        ) or not secrets.compare_digest(
            _credential_digest(target_access_key, record["credential_salt"]),
            record["target_digest"],
        ):
            raise CredentialChangeError("输入的旧/新凭据与恢复记录不匹配")
        target_token = self.client.try_login(target_access_key)

        if target_token:
            remote = self.client.get_keystore_record(target_token)
            fingerprint = record["fingerprint"]
            if remote.payload is None:
                if not remote.confirmed_missing:
                    raise CredentialChangeError("目标凭据有效，但远端 keystore 状态无法确定")
                target_plaintext = {"keys": {}}
            else:
                try:
                    target_plaintext = decrypt_keystore(
                        remote.payload,
                        get_encryption_key(normalized_target_email, target_password),
                    )
                except CredentialChangeError:
                    target_plaintext = None
            # 远端仍明确无库时不能只凭空库摘要判定完成；必须继续走下方
            # PUT、回读和目标密钥解密验证，确保 change 后留下可用的 v2 keystore。
            if remote.payload is not None and target_plaintext is not None and secrets.compare_digest(
                keystore_fingerprint(target_plaintext),
                fingerprint,
            ):
                self._set_stage(record, "recovery_verified")
                return "completed", target_token

            # access key 已变更但 keystore 仍是旧密钥时，可由真实远端状态安全收敛；
            # 这里不再调用 change-access-key，只进行一次 keystore PUT。
            if remote.payload is None:
                source_plaintext = {"keys": {}}
                legacy_fields: dict[str, Any] = {}
            else:
                source_plaintext = decrypt_keystore(
                    remote.payload,
                    get_encryption_key(normalized_source_email, source_password),
                )
                _, _, legacy_fields = decode_keystore(remote.payload)
            if not secrets.compare_digest(
                keystore_fingerprint(source_plaintext),
                fingerprint,
            ):
                raise CredentialChangeError("远端 keystore 与恢复摘要不一致")
            prepared = encrypt_keystore(
                source_plaintext,
                get_encryption_key(normalized_target_email, target_password),
                legacy_fields=legacy_fields,
            )
            self.client.put_keystore(target_token, prepared)
            verified_remote = self.client.get_keystore_record(target_token)
            if verified_remote.payload is None:
                raise CredentialChangeError("恢复写入后无法回读 keystore")
            verified_plaintext = decrypt_keystore(
                verified_remote.payload,
                get_encryption_key(normalized_target_email, target_password),
            )
            if not secrets.compare_digest(
                keystore_fingerprint(verified_plaintext),
                fingerprint,
            ):
                raise CredentialChangeError("恢复后的 keystore 摘要不一致")
            final_token = self.client.login(target_access_key)
            self._set_stage(record, "recovery_verified")
            return "completed", final_token

        source_token = self.client.try_login(source_access_key)
        if source_token:
            remote = self.client.get_keystore_record(source_token)
            if remote.payload is not None:
                plaintext = decrypt_keystore(
                    remote.payload,
                    get_encryption_key(normalized_source_email, source_password),
                )
                if not secrets.compare_digest(
                    keystore_fingerprint(plaintext),
                    record["fingerprint"],
                ):
                    raise CredentialChangeError("源凭据有效，但远端 keystore 已漂移")
            elif not remote.confirmed_missing:
                raise CredentialChangeError("源凭据有效，但远端 keystore 状态无法确认")
            # 对不确定 mutation，源凭据当前仍有效不能证明请求不会稍后生效。
            # 保留日志并停止，绝不据此清理或重放 change-access-key。
            raise CredentialChangeUncertain(
                "源凭据仍可登录，但官方变更结果仍不确定；请稍后再次恢复或人工处理"
            )

        raise CredentialChangeError(
            "旧凭据和新凭据均无法确认，请停止操作并联系 NovelAI 官方支持"
        )
