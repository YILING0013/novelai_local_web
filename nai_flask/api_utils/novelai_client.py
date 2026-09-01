# -*- coding: utf-8 -*-
"""只连接 NovelAI 官方图像主机的轻量客户端。"""

from __future__ import annotations

import base64
import binascii
import io
import json
import logging
import time
import zipfile
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urlsplit

import requests
from PIL import Image, UnidentifiedImageError

from .image_validation import (
    ALLOWED_IMAGE_MODES,
    MAX_IMAGE_DIMENSION,
    MAX_IMAGE_PIXELS,
)

from . import tools
from .account_change import (
    CredentialChangeRejected,
    CredentialChangeUncertain,
    RemoteKeystore,
)


NOVELAI_ORIGIN = "https://image.novelai.net"
NOVELAI_HOST = "image.novelai.net"
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


class NovelAIClient:
    """固定连接 NovelAI 官方图像主机，不接受运行时上游地址。"""

    def __init__(
        self,
        timeout_seconds: float = 120.0,
        request_func: Callable[..., Any] | None = None,
    ) -> None:
        """
        初始化官方客户端。

        Args:
            timeout_seconds: 单次上游请求的读取超时秒数。
            request_func: 测试时可注入的 requests 兼容调用函数。
        """

        self.timeout_seconds = float(timeout_seconds)
        self._request_func = request_func or requests.request

    def _request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        correlation_id: str | None = None,
        accepted_error_statuses: frozenset[int] = frozenset(),
        **kwargs: Any,
    ) -> Any:
        """向固定官方主机发送一次不跟随重定向的请求。"""

        if not path.startswith("/"):
            raise ValueError("NovelAI API path must start with '/'.")
        url = f"{NOVELAI_ORIGIN}{path}"
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname != NOVELAI_HOST:
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
            response = self._request_func(
                method,
                url,
                headers=headers,
                timeout=(10.0, self.timeout_seconds),
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
                NOVELAI_HOST,
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
                NOVELAI_HOST,
                (time.perf_counter() - started_at) * 1000,
                safe_correlation_id,
            )
            raise NovelAIUpstreamError(
                "The NovelAI service could not be reached.",
                502,
                "NOVELAI_UNAVAILABLE",
            ) from exc

        status_code = int(response.status_code)
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
        else:
            error_code = "NOVELAI_REQUEST_REJECTED"
        logger.log(
            log_level,
            "event=novelai_request_complete operation=%s method=%s host=%s status=%d "
            "result=%s elapsed_ms=%.2f error_code=%s certain=%s correlation_id=%s",
            operation_name,
            logged_method,
            NOVELAI_HOST,
            status_code,
            "success" if 200 <= status_code < 300 else (
                "failed" if status_code >= 500 else "rejected"
            ),
            (time.perf_counter() - started_at) * 1000,
            error_code,
            str(status_code < 500).lower(),
            safe_correlation_id,
        )
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
        return token.strip()

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
            response = self._request_func(
                method,
                url,
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
        response = self._mutation_request(
            "POST",
            "/user/change-access-key",
            token=token,
            payload=payload,
        )
        try:
            response_payload = response.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise CredentialChangeUncertain(
                "官方账户变更成功响应无法确认"
            ) from exc
        new_token = response_payload.get("accessToken") if isinstance(response_payload, dict) else None
        if not isinstance(new_token, str) or not new_token:
            raise CredentialChangeUncertain("官方账户变更成功响应无法确认")
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
        )
        try:
            return response.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise NovelAIUpstreamError(
                "NovelAI returned an invalid tag response.",
                502,
                "NOVELAI_INVALID_RESPONSE",
            ) from exc
