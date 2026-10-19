# -*- coding: utf-8 -*-
"""只连接 NovelAI 官方图像与文本主机的轻量客户端。"""

from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
import logging
import os
import ssl
import threading
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

import requests
from requests.adapters import HTTPAdapter
from PIL import Image, UnidentifiedImageError

from .image_validation import (
    ALLOWED_IMAGE_MODES,
    MAX_IMAGE_DIMENSION,
    MAX_IMAGE_PIXELS,
)

from . import tools
from .novelai_tls_profiles import create_tls_context, profile_ids, validate_tls_profile_id
from .account_change import (
    CredentialChangeRejected,
    CredentialChangeUncertain,
    RemoteKeystore,
)


NOVELAI_ORIGIN = "https://image.novelai.net"
NOVELAI_HOST = "image.novelai.net"
NOVELAI_CHAT_PATH = "/oa/v1/chat/completions"
MAX_UPSTREAM_BODY_BYTES = 80 * 1024 * 1024
OFFICIAL_OPERATION_NAMES = {
    ("POST", "/user/login"): "password_login",
    ("GET", "/user/data"): "read_user_data",
    ("GET", "/user/keystore"): "read_keystore",
    ("POST", "/user/change-access-key"): "change_access_key",
    ("PUT", "/user/keystore"): "write_keystore",
    ("GET", "/user/information"): "account_information",
    ("GET", "/user/subscription"): "account_subscription",
    ("POST", "/ai/generate-image"): "generate_image",
    ("POST", "/ai/encode-vibe"): "encode_vibe",
    ("POST", "/ai/augment-image"): "augment_image",
    ("POST", "/ai/upscale"): "upscale_image",
    ("GET", "/ai/generate-image/suggest-tags"): "suggest_tags",
    ("POST", NOVELAI_CHAT_PATH): "comic_plan",
}
logger = logging.getLogger(__name__)


def _safe_log_correlation_id(value: Any) -> str:
    """只允许短 ASCII 标识进入日志，拒绝换行和任意用户文本。"""

    text = str(value or "")
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
    if 1 <= len(text) <= 64 and all(character in allowed for character in text):
        return text
    return "-"


@dataclass
class NovelAIUpstreamError(Exception):
    """
    表示已收敛为安全状态的 NovelAI 上游错误。

    Args:
        message: 可安全返回给本地前端的英文提示。
        status_code: 本地 API 应返回的 HTTP 状态码。
        code: 稳定业务错误码。
    """

    message: str
    status_code: int = 502
    code: str = "NOVELAI_UPSTREAM_ERROR"

    def __str__(self) -> str:
        """返回不包含上游正文或认证材料的错误文本。"""

        return self.message


def derive_access_key(email: str, password: str) -> str:
    """
    使用账户变更模块中的同一 KDF 派生 NovelAI 登录密钥。

    Args:
        email: NovelAI 官方账户邮箱。
        password: 仅存在于当前本机请求内存中的原始密码。

    Returns:
        可提交给 NovelAI 登录接口的派生密钥。

    Raises:
        NovelAIUpstreamError: 账户 KDF 模块尚未就绪时拒绝猜测协议。
    """

    try:
        from .account_change import get_access_key
    except ImportError as exc:
        raise NovelAIUpstreamError(
            "Password login is unavailable because the local NovelAI KDF is not installed.",
            503,
            "PASSWORD_LOGIN_UNAVAILABLE",
        ) from exc
    return get_access_key(email, password)


class _NovelAITLSAdapter(HTTPAdapter):
    """让直连和代理连接池使用当前身份的独立 TLS 上下文。"""

    def __init__(self, profile_id: str) -> None:
        self._tls_context = create_tls_context(profile_id)
        super().__init__(pool_connections=1, pool_maxsize=1, max_retries=0, pool_block=True)

    def init_poolmanager(self, connections, maxsize, block=False, **pool_kwargs):
        """建立带身份 TLS 上下文的连接池。

        Args:
            connections: 缓存的池数量。
            maxsize: 每个池的连接上限。
            block: 池满时是否等待。
            **pool_kwargs: 其余连接池参数。

        Returns:
            None: 连接池保存到当前适配器。
        """
        pool_kwargs["ssl_context"] = self._tls_context
        return super().init_poolmanager(connections, maxsize, block=block, **pool_kwargs)

    def proxy_manager_for(self, proxy, **proxy_kwargs):
        """把同一指纹应用到代理隧道中的官方 HTTPS 连接。

        Args:
            proxy: Requests 解析的代理地址。
            **proxy_kwargs: 其余代理池参数。

        Returns:
            urllib3.ProxyManager: 当前请求使用的代理池。
        """
        proxy_kwargs["ssl_context"] = self._tls_context
        return super().proxy_manager_for(proxy, **proxy_kwargs)

    def build_connection_pool_key_attributes(self, request, verify, cert=None):
        """保留证书选项，防止 Requests 默认上下文覆盖身份指纹。

        Args:
            request: 已准备的 HTTP 请求。
            verify: 证书校验参数。
            cert: 客户端证书参数。

        Returns:
            tuple: 主机与使用身份上下文的连接池参数。
        """
        host, kwargs = super().build_connection_pool_key_attributes(request, verify, cert)
        kwargs["ssl_context"] = self._tls_context
        return host, kwargs

    def cert_verify(self, conn, url, verify, cert):
        """显式加载默认 CA，兼容假定默认上下文已装载 CA 的 Requests 版本。

        Args:
            conn: 当前 HTTPS 连接池。
            url: 官方请求 URL。
            verify: 证书校验参数。
            cert: 客户端证书参数。

        Returns:
            None: 由 Requests 为连接池设置证书校验。
        """
        return super().cert_verify(conn, url, requests.certs.where() if verify is True else verify, cert)


class NovelAIClient:
    """固定连接 NovelAI 官方主机，不接受运行时上游地址。"""

    def __init__(
        self,
        timeout_seconds: float = 120.0,
        request_func: Callable[..., Any] | None = None,
        *,
        tls_bindings_path: str | os.PathLike[str] | None = None,
    ) -> None:
        """
        初始化官方客户端。

        Args:
            timeout_seconds: 单次上游请求的读取超时秒数。
            request_func: 测试时可注入的 requests 兼容调用函数。
            tls_bindings_path: 本地指纹绑定文件；应用必须提供，省略时仅供隔离测试使用内存。
        """

        self.timeout_seconds = float(timeout_seconds)
        self._request_func = request_func
        # 文件只保存凭据摘要和配置编号；原始 Token、access key 和密码不落盘。
        self._tls_bindings: dict[bytes, str] = {}
        self._tls_bindings_path = Path(tls_bindings_path).expanduser().resolve() if tls_bindings_path is not None else None
        self._tls_lock = threading.Lock()
        if self._tls_bindings_path is not None:
            try:
                content = self._tls_bindings_path.read_text(encoding="utf-8")
            except FileNotFoundError:
                content = None
            except (OSError, UnicodeError) as exc:
                raise RuntimeError("无法读取本地 TLS 绑定文件，请检查数据目录权限。") from exc
            if content is not None:
                try:
                    saved = json.loads(content)
                    if (
                        not isinstance(saved, dict)
                        or saved.get("schema_version") != 1
                        or not isinstance(saved.get("bindings"), dict)
                    ):
                        raise ValueError("TLS 绑定文件结构或版本无效")
                    for digest, profile in saved["bindings"].items():
                        if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
                            raise ValueError("TLS 绑定摘要无效")
                        self._tls_bindings[bytes.fromhex(digest)] = validate_tls_profile_id(profile)
                except (ValueError, TypeError) as exc:
                    # 损坏时禁止重新分配，否则同一个账号会在用户不知情时换指纹。
                    raise RuntimeError("本地 TLS 绑定文件损坏或版本不受支持，请从备份恢复；原文件未修改。") from exc
        self._used_tls_profiles = set(self._tls_bindings.values())

    def _save_tls_bindings(self, bindings: dict[bytes, str]) -> None:
        """在调用方持锁时先原子保存，再更新内存，写入失败不接受新绑定。"""
        if bindings == self._tls_bindings:
            return
        if self._tls_bindings_path is not None:
            path = self._tls_bindings_path
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                # Waitress 为单进程；同一把锁串行写入同目录临时文件后替换正式文件。
                temp_path = path.with_name(path.name + ".tmp")
                with temp_path.open("w", encoding="utf-8") as handle:
                    json.dump({
                        "schema_version": 1,
                        "bindings": {digest.hex(): profile for digest, profile in bindings.items()},
                    }, handle, indent=2, sort_keys=True)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temp_path, path)
            except OSError as exc:
                raise NovelAIUpstreamError(
                    "Unable to save local TLS bindings. Check data directory permissions and free disk space.",
                    503,
                    "LOCAL_TLS_BINDINGS_WRITE_FAILED",
                ) from exc
        self._tls_bindings = bindings
        self._used_tls_profiles = set(bindings.values())

    def _tls_profile(self, credential: str) -> str:
        """按凭据摘要固定分配指纹；碰撞时选择空位，不让不同身份共用配置。"""
        digest = hashlib.sha256(credential.encode("utf-8")).digest()
        with self._tls_lock:
            if digest in self._tls_bindings:
                return self._tls_bindings[digest]
            profiles = profile_ids()
            start = int.from_bytes(digest[:4], "big") % len(profiles)
            for offset in range(len(profiles)):
                profile = profiles[(start + offset) % len(profiles)]
                if profile not in self._used_tls_profiles:
                    self._save_tls_bindings({**self._tls_bindings, digest: profile})
                    return profile
        raise NovelAIUpstreamError(
            "The local TLS profile capacity is exhausted. Existing identities remain available; new identities cannot be assigned.",
            503,
            "NOVELAI_TLS_PROFILES_EXHAUSTED",
        )

    def inherit_tls_profile(self, source_identity: str, target_identity: str) -> None:
        """
        为登录、凭据变更及中断恢复保存同一账号的身份关联，保留目标的已有绑定。

        Args:
            source_identity: 已知源账号的 Token 或 access key。
            target_identity: 同一账号新增的 Token 或 access key。

        Returns:
            None: 绑定持久化成功后返回。
        """
        profile = self._tls_profile(source_identity)
        digest = hashlib.sha256(target_identity.encode("utf-8")).digest()
        with self._tls_lock:
            if digest not in self._tls_bindings:
                self._save_tls_bindings({**self._tls_bindings, digest: profile})

    def _send_request(self, method: str, url: str, *, identity: str, **kwargs: Any) -> Any:
        """普通请求与账户变更共用指纹入口，每次请求结束即关闭自己的连接池。"""
        profile = self._tls_profile(identity)
        if self._request_func is not None:
            return self._request_func(method, url, **kwargs)
        try:
            adapter = _NovelAITLSAdapter(profile)
        except (ValueError, ssl.SSLError) as exc:
            raise NovelAIUpstreamError(
                "The local OpenSSL does not support the assigned TLS profile.",
                503,
                "NOVELAI_TLS_UNSUPPORTED",
            ) from exc
        with requests.Session() as session:
            # 保留用户现有系统/环境代理，但禁止 netrc 把 Bearer 替换成其它认证。
            session.trust_env = False
            session.mount("https://", adapter)
            return session.request(
                method, url, proxies=requests.utils.get_environ_proxies(url),
                verify=os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("CURL_CA_BUNDLE") or True,
                **kwargs,
            )

    def _request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        tls_identity: str | None = None,
        correlation_id: str | None = None,
        accepted_error_statuses: frozenset[int] = frozenset(),
        response_diagnostic_path: Path | None = None,
        log_correlation_id: str | None = None,
        **kwargs: Any,
    ) -> Any:
        """向固定官方主机发送一次不跟随重定向的请求。"""

        if not path.startswith("/"):
            raise ValueError("NovelAI API path must start with '/'.")
        # 文本仅开放这一条明确的官方接口，页面不能自行指定上游主机。
        host = "text.novelai.net" if method.upper() == "POST" and path == NOVELAI_CHAT_PATH else NOVELAI_HOST
        origin = "https://text.novelai.net" if host == "text.novelai.net" else NOVELAI_ORIGIN
        url = f"{origin}{path}"
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname != host:
            raise ValueError("NovelAI API host is not allowed.")

        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("Accept", "*/*")
        headers.setdefault("Origin", "https://novelai.net")
        headers.setdefault("Referer", "https://novelai.net/")
        upstream_correlation_id = headers.setdefault(
            "X-Correlation-ID",
            correlation_id or tools.correlation_id_generator(),
        )
        headers.setdefault("x-initiated-at", tools.get_z_time_now())
        if token:
            headers["Authorization"] = f"Bearer {token}"

        normalized_method = method.upper()
        logged_method = (
            normalized_method
            if normalized_method in {"GET", "POST", "PUT"}
            else "OTHER"
        )
        operation_name = OFFICIAL_OPERATION_NAMES.get(
            (normalized_method, path),
            "official_request",
        )
        safe_correlation_id = _safe_log_correlation_id(log_correlation_id or upstream_correlation_id)
        started_at = time.perf_counter()
        logger.info(
            "event=novelai_request_start operation=%s method=%s host=%s "
            "correlation_id=%s",
            operation_name,
            logged_method,
            host,
            safe_correlation_id,
        )
        try:
            response = self._send_request(
                method,
                url,
                identity=token or tls_identity,
                headers=headers,
                timeout=kwargs.pop("timeout", (10.0, self.timeout_seconds)),
                allow_redirects=False,
                **kwargs,
            )
        except requests.Timeout as exc:
            logger.warning(
                "event=novelai_request_complete operation=%s method=%s host=%s "
                "status=timeout result=failed elapsed_ms=%.2f error_code=NOVELAI_TIMEOUT "
                "certain=false correlation_id=%s",
                operation_name,
                logged_method,
                host,
                (time.perf_counter() - started_at) * 1000,
                safe_correlation_id,
            )
            raise NovelAIUpstreamError(
                "The NovelAI request timed out.",
                504,
                "NOVELAI_TIMEOUT",
            ) from exc
        except requests.RequestException as exc:
            logger.warning(
                "event=novelai_request_complete operation=%s method=%s host=%s "
                "status=unavailable result=failed elapsed_ms=%.2f "
                "error_code=NOVELAI_UNAVAILABLE certain=false correlation_id=%s",
                operation_name,
                logged_method,
                host,
                (time.perf_counter() - started_at) * 1000,
                safe_correlation_id,
            )
            raise NovelAIUpstreamError(
                "The NovelAI service could not be reached.",
                502,
                "NOVELAI_UNAVAILABLE",
            ) from exc

        status_code = int(response.status_code)
        insufficient_anlas = False
        if status_code == 402:
            try:
                error_payload = response.json()
            except ValueError:
                error_payload = None
            message = error_payload.get("message") if isinstance(error_payload, dict) else None
            insufficient_anlas = isinstance(message, str) and message.startswith("Not enough Anlas")
        log_level = logging.ERROR if status_code >= 500 else (
            logging.WARNING if status_code >= 300 else logging.INFO
        )
        if 200 <= status_code < 300:
            error_code = "-"
        elif 300 <= status_code < 400:
            error_code = "NOVELAI_REDIRECT_REJECTED"
        elif status_code == 401:
            error_code = "NOVELAI_UNAUTHORIZED"
        elif status_code == 429:
            error_code = "NOVELAI_RATE_LIMITED"
        elif insufficient_anlas:
            error_code = "NOVELAI_INSUFFICIENT_ANLAS"
        else:
            error_code = "NOVELAI_REQUEST_REJECTED"
        logger.log(
            log_level,
            "event=novelai_request_complete operation=%s method=%s host=%s status=%d "
            "result=%s elapsed_ms=%.2f error_code=%s certain=%s correlation_id=%s",
            operation_name,
            logged_method,
            host,
            status_code,
            "success" if 200 <= status_code < 300 else (
                "failed" if status_code >= 500 else "rejected"
            ),
            (time.perf_counter() - started_at) * 1000,
            error_code,
            str(status_code < 500).lower(),
            safe_correlation_id,
        )
        if response_diagnostic_path is not None and not 200 <= status_code < 300:
            # 编排诊断必须先保存上游拒绝原文，再沿用下面的公开错误映射。
            try:
                content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                response_diagnostic_path.with_suffix(".bin").write_bytes(response.content)
                response_diagnostic_path.with_suffix(".response.txt").write_bytes(response.content)
                response_diagnostic_path.with_suffix(".text.txt").write_bytes(b"")
                response_diagnostic_path.with_suffix(".json").write_text(json.dumps({
                    "correlation_id": safe_correlation_id,
                    "shape": {
                        "status_code": status_code,
                        "content_type": content_type if content_type in ("text/event-stream", "application/json") else "other",
                        "body_bytes": len(response.content), "error_code": error_code,
                        "content_status": "empty",
                    },
                }, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
            except OSError:
                logger.warning("event=novelai_chat_diagnostic_failed stage=http_error correlation_id=%s", safe_correlation_id)
        if status_code in accepted_error_statuses:
            return response
        if 300 <= status_code < 400:
            # Authorization 永远不会被 requests 带到重定向目标。
            raise NovelAIUpstreamError(
                "NovelAI returned an unexpected redirect.",
                502,
                "NOVELAI_REDIRECT_REJECTED",
            )
        if status_code == 401:
            raise NovelAIUpstreamError(
                "The NovelAI session is no longer authorized.",
                401,
                "NOVELAI_UNAUTHORIZED",
            )
        if status_code == 429:
            raise NovelAIUpstreamError(
                "NovelAI is rate limiting requests. Please try again later.",
                429,
                "NOVELAI_RATE_LIMITED",
            )
        if status_code >= 400:
            if insufficient_anlas:
                raise NovelAIUpstreamError(
                    "The NovelAI account has insufficient Anlas for this request.",
                    402,
                    "NOVELAI_INSUFFICIENT_ANLAS",
                )
            public_status = status_code if status_code in {400, 402, 403, 404, 409, 422} else 502
            raise NovelAIUpstreamError(
                "NovelAI rejected the request.",
                public_status,
                "NOVELAI_REQUEST_REJECTED",
            )

        content = getattr(response, "content", b"") or b""
        if len(content) > MAX_UPSTREAM_BODY_BYTES:
            raise NovelAIUpstreamError(
                "NovelAI returned a response that is too large.",
                502,
                "NOVELAI_RESPONSE_TOO_LARGE",
            )
        return response

    def chat_completion(
        self,
        token: str,
        payload: dict[str, Any],
        correlation_id: str | None = None,
    ) -> str:
        """使用当前登录身份请求一次完整的漫画编排文本，不自动重试。

        Args:
            token: 当前内存会话中的 NovelAI 访问令牌。
            payload: 已校验的模型、消息和生成预算。
            correlation_id: 用于排查请求的非敏感编号。

        Returns:
            模型完整返回的文本；截断或无正文时明确失败。
        """

        request_payload = {**payload, "stream": True, "enable_thinking": payload.get("enable_thinking", False)}
        diagnostic_path = None
        diagnostic_dir = os.environ.get("NAI_COMIC_RESPONSE_DIAGNOSTIC_DIR")
        if diagnostic_dir:
            # 用户显式开启时，在发送前记录同一份请求正文；不包含认证令牌或请求头。
            try:
                directory = Path(diagnostic_dir).expanduser().resolve()
                directory.mkdir(parents=True, exist_ok=True)
                diagnostic_path = directory / f"comic-response-{_safe_log_correlation_id(correlation_id)}-{time.time_ns()}"
                diagnostic_path.with_suffix(".request.json").write_text(
                    json.dumps(request_payload, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n",
                )
            except OSError:
                diagnostic_path = None
                logger.warning("event=novelai_chat_diagnostic_failed stage=request correlation_id=%s", _safe_log_correlation_id(correlation_id))
        # 官方请求头只接收六位字母数字；阶段后缀仅用于本地日志和诊断文件。
        upstream_correlation_id = (correlation_id or "").split("-", 1)[0]
        if len(upstream_correlation_id) != 6 or not upstream_correlation_id.isascii() or not upstream_correlation_id.isalnum():
            upstream_correlation_id = tools.correlation_id_generator()
        response = self._request(
            "POST", NOVELAI_CHAT_PATH, token=token,
            correlation_id=upstream_correlation_id,
            response_diagnostic_path=diagnostic_path,
            log_correlation_id=correlation_id,
            headers={"Accept": "text/event-stream"},
            json=request_payload,
            timeout=(10.0, max(180.0, self.timeout_seconds)),
        )
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        response_shape = {
            "content_type": content_type if content_type in ("text/event-stream", "application/json") else "other",
            "body_bytes": len(response.content), "error_code": None,
        }
        if diagnostic_path is not None:
            try:
                diagnostic_path.with_suffix(".bin").write_bytes(response.content)
                # 文本副本保留原始 UTF-8 字节，包含全部 SSE 事件，不转换换行或截断。
                diagnostic_path.with_suffix(".response.txt").write_bytes(response.content)
            except OSError:
                diagnostic_path = None
                logger.warning("event=novelai_chat_diagnostic_failed stage=body correlation_id=%s", _safe_log_correlation_id(correlation_id))
        parts, text, completed = None, None, False
        try:
            if content_type == "text/event-stream":
                # 官方非流式响应可能只有 token_ids 而没有 text；单次请求流式正文后在本地收齐。
                # _request 已缓冲完整响应并检查大小，这里不建立第二条请求或做 token 解码。
                try:
                    lines = response.content.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n").split("\n")
                except UnicodeDecodeError as exc:
                    raise NovelAIUpstreamError("NovelAI 返回了无效的漫画编排流。", 502, "COMIC_PLAN_INVALID_RESPONSE") from exc
                # SSE 只认 CR/LF；splitlines 会把模型正文中的 U+2028 等字符误当成协议换行。
                response_shape.update({
                    "line_count": len(lines), "data_line_count": 0, "event_count": 0,
                    "comment_line_count": 0, "unknown_line_count": 0, "text_length": 0,
                    "token_id_count": 0, "done": False, "finish_reason": None,
                    "top_fields": [], "choice_fields": [], "delta_fields": [],
                })
                parts, data_lines = [], []
                finish_reason, usage, event_name, done = None, None, "", False
                for line in [*lines, ""]:
                    if line.startswith("data:"):
                        response_shape["data_line_count"] += 1
                        data_lines.append(line[5:].removeprefix(" "))
                    elif line.startswith("event:"):
                        event_name = line[6:].strip()
                    elif line.startswith(":"):
                        response_shape["comment_line_count"] += 1
                    elif line and not line.startswith(("id:", "retry:")):
                        response_shape["unknown_line_count"] += 1
                        # 官方超时可能以 HTTP 200 开始，最后直接追加未带 data: 的 JSON 错误。
                        if line.lstrip().startswith("{"):
                            try:
                                stream_error = json.loads(line)
                            except json.JSONDecodeError:
                                stream_error = None
                            if isinstance(stream_error, dict) and stream_error.get("statusCode") == 504:
                                raise NovelAIUpstreamError("NovelAI 漫画编排超时，请稍后重新编排。", 504, "NOVELAI_TIMEOUT")
                    elif not line:
                        if event_name == "error":
                            raise NovelAIUpstreamError("NovelAI 漫画编排流返回错误，请稍后重新编排。", 502, "COMIC_PLAN_STREAM_ERROR")
                        event_name = ""
                        if not data_lines:
                            continue
                        data = "\n".join(data_lines)
                        data_lines = []
                        response_shape["event_count"] += 1
                        if data == "[DONE]":
                            response_shape["done"] = True
                            done = True
                            break
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError as exc:
                            raise NovelAIUpstreamError("NovelAI 返回了无效的漫画编排流。", 502, "COMIC_PLAN_INVALID_RESPONSE") from exc
                        if not isinstance(chunk, dict):
                            raise NovelAIUpstreamError("NovelAI 返回了无效的漫画编排流。", 502, "COMIC_PLAN_INVALID_RESPONSE")
                        response_shape["top_fields"] = sorted(set(response_shape["top_fields"]) | {
                            key for key in ("choices", "usage", "error", "data", "text", "token", "token_ids", "finish_reason", "done") if key in chunk
                        })
                        if chunk.get("error"):
                            raise NovelAIUpstreamError("NovelAI 漫画编排流返回错误，请稍后重新编排。", 502, "COMIC_PLAN_STREAM_ERROR")
                        if isinstance(chunk.get("usage"), dict):
                            usage = chunk["usage"]
                        chunk_choices = chunk.get("choices")
                        # 流末尾可单独附带用量，不包含新的正文。
                        if chunk_choices == [] and isinstance(chunk.get("usage"), dict):
                            continue
                        if not isinstance(chunk_choices, list) or not chunk_choices or not isinstance(chunk_choices[0], dict):
                            raise NovelAIUpstreamError("NovelAI 返回了无效的漫画编排流。", 502, "COMIC_PLAN_INVALID_RESPONSE")
                        stream_choice = chunk_choices[0]
                        response_shape["choice_fields"] = sorted(set(response_shape["choice_fields"]) | {
                            key for key in ("message", "delta", "text", "finish_reason", "token_ids") if key in stream_choice
                        })
                        token_ids = stream_choice.get("token_ids")
                        if isinstance(token_ids, list):
                            response_shape["token_id_count"] += len(token_ids)
                        delta = stream_choice.get("delta")
                        if isinstance(delta, dict):
                            response_shape["delta_fields"] = sorted(set(response_shape["delta_fields"]) | {
                                key for key in ("role", "content", "reasoning", "reasoning_content", "refusal", "tool_calls") if key in delta
                            })
                        piece = delta.get("content") if isinstance(delta, dict) else None
                        if piece is None:
                            piece = stream_choice.get("text", "")
                        if piece is None:
                            piece = ""
                        if not isinstance(piece, str):
                            raise NovelAIUpstreamError("NovelAI 返回了无效的漫画编排流。", 502, "COMIC_PLAN_INVALID_RESPONSE")
                        parts.append(piece)
                        response_shape["text_length"] += len(piece)
                        if stream_choice.get("finish_reason") is not None and finish_reason in (None, "stop"):
                            finish_reason = stream_choice["finish_reason"]
                            response_shape["finish_reason"] = finish_reason if finish_reason in ("stop", "length", "content_filter", "tool_calls") else "other"
                if not done and finish_reason is None:
                    raise NovelAIUpstreamError("漫画编排流意外中断，未返回完整计划。请重新编排。", 502, "COMIC_PLAN_INCOMPLETE")
                result = {"choices": [{"text": "".join(parts), "finish_reason": finish_reason}], "usage": usage}
            else:
                # 兼容官方在 stream 请求下仍返回 completion-style JSON 的情况。
                result = self._json_object(response)
                response_shape["top_fields"] = [key for key in ("choices", "usage", "error", "message", "text", "token_ids") if key in result]
            choices = result.get("choices")
            valid_choice = isinstance(choices, list) and bool(choices) and isinstance(choices[0], dict)
            choice = choices[0] if valid_choice else {}
            message = choice.get("message")
            content = message.get("content") if isinstance(message, dict) else None
            # 与现有对话项目一致：只有缺失或 null 的正文才读取 completion-style text。
            text = choice.get("text") if content is None else content
            invalid_choices = bool(result.get("error")) or not valid_choice
            empty_content = choice.get("finish_reason") in (None, "stop") and (not isinstance(text, str) or not text.strip())
            if invalid_choices or empty_content:
                upstream_error = result.get("error")
                error_code = upstream_error.get("code") if isinstance(upstream_error, dict) else None
                known_error_codes = {"invalid_api_key", "invalid_request_error", "model_not_found", "context_length_exceeded",
                                     "rate_limit_exceeded", "insufficient_quota", "content_filter", "server_error"}
                reasoning = message.get("reasoning_content", message.get("reasoning")) if isinstance(message, dict) else None
                delta = choice.get("delta")
                delta_content = delta.get("content") if isinstance(delta, dict) else None
                usage = result.get("usage")
                # 不记录提示词、正文、错误消息或未知字段值，真实账号日志只保留协议形状。
                shape = {
                    "branch": "invalid_choices" if invalid_choices else "empty_content",
                    "top_fields": [key for key in ("choices", "error", "message", "messages", "output", "data", "response", "text", "usage") if key in result],
                    "choices_type": type(choices).__name__, "choices_count": len(choices) if isinstance(choices, list) else None,
                    "choice_fields": [key for key in ("message", "delta", "text", "finish_reason", "token_ids") if key in choice],
                    "message_type": type(message).__name__,
                    "message_fields": [key for key in ("role", "content", "reasoning", "reasoning_content", "refusal", "tool_calls") if isinstance(message, dict) and key in message],
                    "content_type": type(content).__name__, "content_length": len(content) if isinstance(content, (str, list)) else None,
                    "text_type": type(choice.get("text")).__name__, "text_length": len(choice["text"]) if isinstance(choice.get("text"), str) else None,
                    "delta_content_type": type(delta_content).__name__, "delta_content_length": len(delta_content) if isinstance(delta_content, str) else None,
                    "reasoning_length": len(reasoning) if isinstance(reasoning, str) else None,
                    "finish_reason": choice.get("finish_reason") if choice.get("finish_reason") in (None, "stop", "length", "content_filter", "tool_calls") else "other",
                    "error_type": type(upstream_error).__name__,
                    "error_code": error_code if isinstance(error_code, str) and error_code in known_error_codes else "other" if error_code is not None else None,
                    "top_message_type": type(result.get("message")).__name__,
                    "top_message_length": len(result["message"]) if isinstance(result.get("message"), str) else None,
                    "completion_tokens": usage.get("completion_tokens") if isinstance(usage, dict) and type(usage.get("completion_tokens")) is int else None,
                }
                logger.warning("event=novelai_chat_invalid_response correlation_id=%s shape=%s",
                               _safe_log_correlation_id(correlation_id), json.dumps(shape, separators=(",", ":")))
            if invalid_choices:
                raise NovelAIUpstreamError("NovelAI 未返回有效的漫画编排内容。", 502, "COMIC_PLAN_INVALID_RESPONSE")
            if choice.get("finish_reason") == "length":
                raise NovelAIUpstreamError("漫画编排达到回复长度上限，尚未生成完整计划。请减少内容后重新编排。", 502, "COMIC_PLAN_TRUNCATED")
            if choice.get("finish_reason") not in (None, "stop"):
                raise NovelAIUpstreamError("漫画编排未正常完成，请调整内容后重新编排。", 502, "COMIC_PLAN_INCOMPLETE")
            if not isinstance(text, str) or not text.strip():
                raise NovelAIUpstreamError("NovelAI 未返回有效的漫画编排内容。", 502, "COMIC_PLAN_INVALID_RESPONSE")
            completed = True
            return text
        except NovelAIUpstreamError as exc:
            response_shape["error_code"] = exc.code
            raise
        finally:
            collected_text = "".join(parts) if parts is not None else text if isinstance(text, str) else ""
            response_shape["content_status"] = "complete" if completed else "partial" if collected_text else "empty"
            # 日志只保留白名单字段名、计数与固定错误码，正文和 token_ids 仅存在可选诊断文件。
            logger.log(logging.WARNING if response_shape["error_code"] else logging.INFO,
                       "event=novelai_chat_response correlation_id=%s shape=%s",
                       _safe_log_correlation_id(correlation_id), json.dumps(response_shape, separators=(",", ":")))
            if diagnostic_path is not None:
                try:
                    diagnostic_path.with_suffix(".text.txt").write_bytes(collected_text.encode("utf-8"))
                    diagnostic_path.with_suffix(".json").write_text(json.dumps({
                        "correlation_id": _safe_log_correlation_id(correlation_id),
                        "shape": response_shape,
                    }, ensure_ascii=False, indent=2), encoding="utf-8")
                except OSError:
                    logger.warning("event=novelai_chat_diagnostic_failed stage=metadata correlation_id=%s", _safe_log_correlation_id(correlation_id))

    @staticmethod
    def _json_object(response: Any) -> dict[str, Any]:
        """读取上游 JSON 对象并拒绝含糊的非对象响应。"""

        try:
            payload = response.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise NovelAIUpstreamError(
                "NovelAI returned an invalid JSON response.",
                502,
                "NOVELAI_INVALID_RESPONSE",
            ) from exc
        if not isinstance(payload, dict):
            raise NovelAIUpstreamError(
                "NovelAI returned an invalid JSON response.",
                502,
                "NOVELAI_INVALID_RESPONSE",
            )
        return payload

    @staticmethod
    def _verified_image_bytes(image_bytes: bytes) -> str:
        """校验官方图像确为单帧 PNG/WebP，并返回实测 MIME。"""

        if not image_bytes:
            raise NovelAIUpstreamError(
                "NovelAI returned an empty image.",
                502,
                "NOVELAI_INVALID_IMAGE",
            )
        if len(image_bytes) > MAX_UPSTREAM_BODY_BYTES:
            raise NovelAIUpstreamError(
                "NovelAI returned an image that is too large.",
                502,
                "NOVELAI_RESPONSE_TOO_LARGE",
            )
        try:
            with Image.open(io.BytesIO(image_bytes)) as image:
                image_format = str(image.format or "").upper()
                mime_type = {
                    "PNG": "image/png",
                    "WEBP": "image/webp",
                }.get(image_format)
                width, height = image.size
                if (
                    mime_type is None
                    or width <= 0
                    or height <= 0
                    or width > MAX_IMAGE_DIMENSION
                    or height > MAX_IMAGE_DIMENSION
                    or width * height > MAX_IMAGE_PIXELS
                    or image.mode not in ALLOWED_IMAGE_MODES
                    or int(getattr(image, "n_frames", 1)) != 1
                ):
                    raise NovelAIUpstreamError(
                        "NovelAI returned an invalid image.",
                        502,
                        "NOVELAI_INVALID_IMAGE",
                    )
                image.verify()
        except NovelAIUpstreamError:
            raise
        except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
            raise NovelAIUpstreamError(
                "NovelAI returned an invalid image.",
                502,
                "NOVELAI_INVALID_IMAGE",
            ) from exc
        return mime_type

    @staticmethod
    def _binary_image(response: Any) -> dict[str, str]:
        """把官方 ZIP 或单张二进制图像整理为 Base64 图像对象。"""

        content = bytes(getattr(response, "content", b"") or b"")
        filename = "image.png"
        image_bytes = content

        if zipfile.is_zipfile(io.BytesIO(content)):
            try:
                with zipfile.ZipFile(io.BytesIO(content)) as archive:
                    candidates = [item for item in archive.infolist() if not item.is_dir()]
                    if len(candidates) != 1:
                        raise NovelAIUpstreamError(
                            "NovelAI returned an invalid image archive.",
                            502,
                            "NOVELAI_INVALID_IMAGE",
                        )
                    selected = candidates[0]
                    if (
                        selected.flag_bits & 0x1
                        or selected.file_size <= 0
                        or selected.file_size > MAX_UPSTREAM_BODY_BYTES
                        or (
                            selected.file_size > 1024 * 1024
                            and selected.file_size > max(selected.compress_size, 1) * 200
                        )
                    ):
                        raise NovelAIUpstreamError(
                            "NovelAI returned an invalid image archive.",
                            502,
                            "NOVELAI_INVALID_IMAGE",
                        )
                    filename = selected.filename.rsplit("/", 1)[-1] or filename
                    with archive.open(selected, "r") as image_file:
                        image_bytes = image_file.read(MAX_UPSTREAM_BODY_BYTES + 1)
            except NovelAIUpstreamError:
                raise
            except (OSError, RuntimeError, ValueError, zipfile.BadZipFile) as exc:
                raise NovelAIUpstreamError(
                    "NovelAI returned an invalid image archive.",
                    502,
                    "NOVELAI_INVALID_IMAGE",
                ) from exc

        mime_type = NovelAIClient._verified_image_bytes(image_bytes)
        if filename == "image.png" and mime_type == "image/webp":
            filename = "image.webp"
        return {
            "data": base64.b64encode(image_bytes).decode("ascii"),
            "mime_type": mime_type,
            "filename": filename,
        }

    @staticmethod
    def _json_images(response: Any) -> list[dict[str, Any]]:
        """解析官方 generate/upscale 的 JSON images 数组。"""

        payload = NovelAIClient._json_object(response)
        images = payload.get("images")
        if not isinstance(images, list) or not images:
            raise NovelAIUpstreamError(
                "NovelAI returned an invalid image response.",
                502,
                "NOVELAI_INVALID_IMAGE",
            )

        normalized = []
        for position, item in enumerate(images):
            if not isinstance(item, dict) or not isinstance(item.get("image"), str):
                raise NovelAIUpstreamError(
                    "NovelAI returned an invalid image response.",
                    502,
                    "NOVELAI_INVALID_IMAGE",
                )
            image_data = item["image"]
            if image_data.startswith("data:"):
                header, separator, encoded = image_data.partition(",")
                if not separator or ";base64" not in header:
                    raise NovelAIUpstreamError(
                        "NovelAI returned an invalid image response.",
                        502,
                        "NOVELAI_INVALID_IMAGE",
                    )
                image_data = encoded
            try:
                image_bytes = base64.b64decode(image_data, validate=True)
            except (binascii.Error, ValueError, TypeError) as exc:
                raise NovelAIUpstreamError(
                    "NovelAI returned an invalid image response.",
                    502,
                    "NOVELAI_INVALID_IMAGE",
                ) from exc
            mime_type = NovelAIClient._verified_image_bytes(image_bytes)
            normalized.append({
                "data": base64.b64encode(image_bytes).decode("ascii"),
                "mime_type": mime_type,
                "seed": item.get("seed"),
                "index": item.get("index", position),
            })
        return normalized

    def login_with_password(self, email: str, password: str) -> str:
        """
        本机派生登录密钥并换取官方持久令牌，不保存原始密码。

        Args:
            email: NovelAI 官方账户邮箱。
            password: 仅用于当前调用的原始密码。

        Returns:
            NovelAI 官方返回的访问令牌。
        """

        access_key = derive_access_key(email, password)
        try:
            return self.login(access_key)
        finally:
            # Python 无法可靠擦除不可变字符串；这里只确保不把派生值保存到对象或日志。
            access_key = None

    def login(self, access_key: str) -> str:
        """
        使用派生 access key 登录 NovelAI 官方账户。

        Args:
            access_key: 已在本机派生的 NovelAI access key。

        Returns:
            官方响应中的非空 access token。
        """

        response = self._request(
            "POST",
            "/user/login",
            tls_identity=access_key,
            json={"key": access_key},
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            accepted_error_statuses=frozenset({400, 403}),
        )
        if response.status_code in {400, 403}:
            try:
                error_payload = response.json()
            except (ValueError, json.JSONDecodeError):
                error_payload = None
            candidates = []
            if isinstance(error_payload, dict):
                for field_name in ("code", "errorCode", "reason", "type"):
                    candidates.append(error_payload.get(field_name))
                details = error_payload.get("details")
                if isinstance(details, dict):
                    for field_name in ("code", "errorCode", "reason", "type"):
                        candidates.append(details.get(field_name))
                elif isinstance(details, str):
                    candidates.append(details)
            normalized_codes = {
                str(value).strip().lower().replace("-", "_").replace(" ", "_")
                for value in candidates
                if isinstance(value, str)
            }
            captcha_codes = {
                "captcha",
                "captcha_required",
                "recaptcha",
                "recaptcha_required",
                "missing_recaptcha",
                "invalid_recaptcha",
            }
            if normalized_codes & captcha_codes:
                raise NovelAIUpstreamError(
                    "NovelAI requires official CAPTCHA verification in its own client.",
                    403,
                    "OFFICIAL_CAPTCHA_REQUIRED",
                )
            raise NovelAIUpstreamError(
                "NovelAI rejected the login request.",
                int(response.status_code),
                "NOVELAI_LOGIN_REJECTED",
            )
        payload = self._json_object(response)
        token = payload.get("accessToken")
        if not isinstance(token, str) or not token.strip():
            raise NovelAIUpstreamError(
                "NovelAI did not return a usable access token.",
                502,
                "NOVELAI_INVALID_LOGIN_RESPONSE",
            )
        token = token.strip()
        profile = self._tls_profile(access_key)
        with self._tls_lock:
            # 已经通过 Token 登录的身份保留原指纹，后续密码登录跟随这一绑定。
            token_digest = hashlib.sha256(token.encode("utf-8")).digest()
            profile = self._tls_bindings.get(token_digest, profile)
            self._save_tls_bindings({
                **self._tls_bindings,
                token_digest: profile,
                hashlib.sha256(access_key.encode("utf-8")).digest(): profile,
            })
        return token

    def try_login(self, access_key: str) -> str | None:
        """
        探测 access key，仅把官方明确的 401/403 解释为无效凭据。

        Args:
            access_key: 待探测的 NovelAI access key。

        Returns:
            成功时返回 token；明确无效时返回 None。
        """

        try:
            return self.login(access_key)
        except NovelAIUpstreamError as exc:
            # CAPTCHA 等 403 不能证明 access key 无效，否则恢复状态机会走错分支。
            if exc.code in {"NOVELAI_LOGIN_REJECTED", "NOVELAI_UNAUTHORIZED"}:
                return None
            raise

    @staticmethod
    def _embedded_status(payload: dict[str, Any]) -> int | None:
        """读取 HTTP 200 JSON 中可能存在的嵌入业务状态码。"""

        status = payload.get("statusCode")
        if isinstance(status, int) and not isinstance(status, bool):
            return status
        return None

    @staticmethod
    def _change_index(value: Any) -> int | None:
        """严格读取 keystore changeIndex。"""

        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise NovelAIUpstreamError(
                "NovelAI returned an invalid keystore response.",
                502,
                "NOVELAI_INVALID_RESPONSE",
            )
        return value

    def _keystore_from_user_data(self, token: str) -> RemoteKeystore:
        """通过网页端 /user/data 交叉确认 keystore 是否确实不存在。"""

        response = self._request(
            "GET",
            "/user/data",
            token=token,
            headers={"Accept": "application/json"},
        )
        payload = self._json_object(response)
        embedded_status = self._embedded_status(payload)
        if embedded_status not in {None, 200}:
            raise NovelAIUpstreamError(
                "NovelAI could not confirm the keystore state.",
                502,
                "NOVELAI_INVALID_RESPONSE",
            )
        container = payload.get("keystore")
        if container is None:
            return RemoteKeystore(None, None, confirmed_missing=True)
        if not isinstance(container, dict):
            raise NovelAIUpstreamError(
                "NovelAI returned an invalid keystore response.",
                502,
                "NOVELAI_INVALID_RESPONSE",
            )
        keystore = container.get("keystore")
        change_index = self._change_index(container.get("changeIndex"))
        if keystore is None or keystore == "":
            return RemoteKeystore(None, change_index, confirmed_missing=True)
        if not isinstance(keystore, str):
            raise NovelAIUpstreamError(
                "NovelAI returned an invalid keystore response.",
                502,
                "NOVELAI_INVALID_RESPONSE",
            )
        return RemoteKeystore(keystore, change_index, confirmed_missing=False)

    def get_keystore_record(self, token: str) -> RemoteKeystore:
        """
        读取官方 keystore，并在空库时用 /user/data 二次确认。

        Args:
            token: 当前有效的官方 access token。

        Returns:
            包含密文、changeIndex 与空库确认状态的记录。
        """

        try:
            response = self._request(
                "GET",
                "/user/keystore",
                token=token,
                headers={"Accept": "application/json"},
            )
        except NovelAIUpstreamError as exc:
            if exc.status_code == 404:
                return self._keystore_from_user_data(token)
            raise
        payload = self._json_object(response)
        embedded_status = self._embedded_status(payload)
        if embedded_status == 404:
            return self._keystore_from_user_data(token)
        if embedded_status not in {None, 200}:
            raise NovelAIUpstreamError(
                "NovelAI could not read the keystore.",
                502,
                "NOVELAI_INVALID_RESPONSE",
            )
        keystore = payload.get("keystore")
        change_index = self._change_index(payload.get("changeIndex"))
        if isinstance(keystore, str) and keystore:
            return RemoteKeystore(keystore, change_index, confirmed_missing=False)
        if keystore is not None and keystore != "":
            raise NovelAIUpstreamError(
                "NovelAI returned an invalid keystore response.",
                502,
                "NOVELAI_INVALID_RESPONSE",
            )
        return self._keystore_from_user_data(token)

    def _mutation_request(
        self,
        method: str,
        path: str,
        *,
        token: str,
        payload: dict[str, Any],
    ) -> Any:
        """发送一次绝不重试、绝不重定向的官方账户 mutation。"""

        url = f"{NOVELAI_ORIGIN}{path}"
        upstream_correlation_id = tools.correlation_id_generator()
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "Origin": "https://novelai.net",
            "Referer": "https://novelai.net/",
            "X-Correlation-ID": upstream_correlation_id,
            "x-initiated-at": tools.get_z_time_now(),
        }
        normalized_method = method.upper()
        logged_method = (
            normalized_method if normalized_method in {"POST", "PUT"} else "OTHER"
        )
        operation_name = OFFICIAL_OPERATION_NAMES.get(
            (normalized_method, path),
            "account_mutation",
        )
        safe_correlation_id = _safe_log_correlation_id(upstream_correlation_id)
        started_at = time.perf_counter()
        logger.info(
            "event=novelai_request_start operation=%s method=%s host=%s "
            "correlation_id=%s",
            operation_name,
            logged_method,
            NOVELAI_HOST,
            safe_correlation_id,
        )
        try:
            response = self._send_request(
                method,
                url,
                identity=token,
                headers=headers,
                json=payload,
                timeout=(10.0, self.timeout_seconds),
                allow_redirects=False,
            )
        except requests.RequestException as exc:
            logger.error(
                "event=novelai_request_complete operation=%s method=%s host=%s "
                "status=unknown result=uncertain elapsed_ms=%.2f "
                "error_code=ACCOUNT_CHANGE_UNCERTAIN certain=false correlation_id=%s",
                operation_name,
                logged_method,
                NOVELAI_HOST,
                (time.perf_counter() - started_at) * 1000,
                safe_correlation_id,
            )
            raise CredentialChangeUncertain(
                "官方账户变更请求的结果无法确认"
            ) from exc
        status_code = int(response.status_code)
        if 200 <= status_code < 300:
            logger.info(
                "event=novelai_request_complete operation=%s method=%s host=%s status=%d "
                "result=success elapsed_ms=%.2f certain=true correlation_id=%s",
                operation_name,
                logged_method,
                NOVELAI_HOST,
                status_code,
                (time.perf_counter() - started_at) * 1000,
                safe_correlation_id,
            )
        elif 400 <= status_code < 500:
            logger.warning(
                "event=novelai_request_complete operation=%s method=%s host=%s status=%d "
                "result=rejected elapsed_ms=%.2f error_code=ACCOUNT_CHANGE_REJECTED "
                "certain=true correlation_id=%s",
                operation_name,
                logged_method,
                NOVELAI_HOST,
                status_code,
                (time.perf_counter() - started_at) * 1000,
                safe_correlation_id,
            )
        else:
            logger.error(
                "event=novelai_request_complete operation=%s method=%s host=%s status=%d "
                "result=uncertain elapsed_ms=%.2f error_code=ACCOUNT_CHANGE_UNCERTAIN "
                "certain=false correlation_id=%s",
                operation_name,
                logged_method,
                NOVELAI_HOST,
                status_code,
                (time.perf_counter() - started_at) * 1000,
                safe_correlation_id,
            )
        if 200 <= status_code < 300:
            return response
        if 400 <= status_code < 500:
            raise CredentialChangeRejected("官方明确拒绝了账户变更请求")
        raise CredentialChangeUncertain("官方账户变更请求的结果无法确认")

    def change_access_key(
        self,
        current_access_key: str,
        new_access_key: str,
        token: str,
        new_email: str | None,
    ) -> str:
        """
        修改官方 access key，并可在同一次请求中修改邮箱。

        Args:
            current_access_key: 当前邮箱和密码派生的 key。
            new_access_key: 目标邮箱和密码派生的 key。
            token: 当前凭据登录得到的 token。
            new_email: 仅改邮时发送的新邮箱；纯改密必须为 None。

        Returns:
            官方响应中的新 access token。
        """

        payload = {
            "currentAccessKey": current_access_key,
            "newAccessKey": new_access_key,
        }
        if new_email:
            payload["newEmail"] = new_email
        try:
            response = self._mutation_request(
                "POST",
                "/user/change-access-key",
                token=token,
                payload=payload,
            )
        except CredentialChangeUncertain:
            # 官方可能已接受变更，恢复登录沿用源身份；不覆盖其他已知身份的绑定。
            try:
                self.inherit_tls_profile(token, new_access_key)
            except NovelAIUpstreamError as exc:
                raise CredentialChangeUncertain("官方变更结果不确定，且本地 TLS 绑定保存失败；请修复存储后恢复账户变更") from exc
            raise
        try:
            # 明确拒绝的变更不会走到这里，避免改写目标邮箱已登录账号的指纹。
            self.inherit_tls_profile(token, new_access_key)
            try:
                response_payload = response.json()
            except (ValueError, json.JSONDecodeError) as exc:
                raise CredentialChangeUncertain("官方账户变更成功响应无法确认") from exc
            new_token = response_payload.get("accessToken") if isinstance(response_payload, dict) else None
            if not isinstance(new_token, str) or not new_token:
                raise CredentialChangeUncertain("官方账户变更成功响应无法确认")
            self.inherit_tls_profile(token, new_token)
        except NovelAIUpstreamError as exc:
            # 远端操作已成功，保存失败属于待恢复状态，绝不能诱导重新提交改密/改邮。
            raise CredentialChangeUncertain("官方凭据已变更，但本地 TLS 绑定保存失败；请修复存储后恢复账户变更") from exc
        return new_token

    def put_keystore(self, token: str, keystore: str) -> None:
        """
        使用变更后的 token 上传已经完成本地自校验的 keystore。

        Args:
            token: change-access-key 返回的新 token。
            keystore: 目标凭据加密后的 v2 keystore。
        """

        self._mutation_request(
            "PUT",
            "/user/keystore",
            token=token,
            payload={"keystore": keystore},
        )

    def account_snapshot(self, token: str) -> dict[str, Any]:
        """
        聚合 NovelAI 官方账户信息与订阅信息。

        Args:
            token: 当前内存会话中的官方访问令牌。

        Returns:
            包含 information 与 subscription 的账户快照。
        """

        information = self._json_object(self._request("GET", "/user/information", token=token))
        subscription = self._json_object(self._request("GET", "/user/subscription", token=token))
        return {"information": information, "subscription": subscription}

    def generate_image(
        self,
        token: str,
        payload: dict[str, Any],
        correlation_id: str,
    ) -> list[dict[str, Any]]:
        """同步提交官方生成请求并解析 JSON images 数组。"""

        response = self._request(
            "POST",
            "/ai/generate-image",
            token=token,
            correlation_id=correlation_id,
            json=payload,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        return self._json_images(response)

    def encode_vibe(
        self,
        token: str,
        payload: dict[str, Any],
        correlation_id: str,
    ) -> dict[str, str]:
        """提交官方 Vibe 编码请求并返回 Base64 编码数据。"""

        response = self._request(
            "POST",
            "/ai/encode-vibe",
            token=token,
            correlation_id=correlation_id,
            json=payload,
            headers={"Content-Type": "application/json"},
        )
        mime_type = str(response.headers.get("Content-Type", "application/octet-stream"))
        mime_type = mime_type.split(";", 1)[0].strip() or "application/octet-stream"
        return {
            "encoding": base64.b64encode(bytes(response.content)).decode("ascii"),
            "mime_type": mime_type,
        }

    def augment_image(
        self,
        token: str,
        payload: dict[str, Any],
        correlation_id: str,
    ) -> dict[str, str]:
        """把原始 Director 请求原样提交到固定官方端点。"""

        response = self._request(
            "POST",
            "/ai/augment-image",
            token=token,
            correlation_id=correlation_id,
            json=payload,
            headers={"Content-Type": "application/json"},
        )
        return self._binary_image(response)

    def upscale_image(
        self,
        token: str,
        payload: dict[str, Any],
        correlation_id: str,
    ) -> list[dict[str, Any]]:
        """提交官方 Upscale 请求并解析 JSON images 数组。"""

        response = self._request(
            "POST",
            "/ai/upscale",
            token=token,
            correlation_id=correlation_id,
            json=payload,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        return self._json_images(response)

    def suggest_tags(self, token: str, params: dict[str, str]) -> Any:
        """查询官方 NovelAI 标签建议并返回其 JSON 内容。"""

        response = self._request(
            "GET",
            "/ai/generate-image/suggest-tags",
            token=token,
            params=params,
            # 联想失败可使用本地词库，不让多个过期输入长时间占满本地服务线程。
            timeout=(2.0, 3.0),
        )
        try:
            return response.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise NovelAIUpstreamError(
                "NovelAI returned an invalid tag response.",
                502,
                "NOVELAI_INVALID_RESPONSE",
            ) from exc
