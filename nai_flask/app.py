# -*- coding: utf-8 -*-
"""NovelAI 本地精简版 Flask API。"""

from __future__ import annotations

import copy
import base64
import binascii
import json
import logging
import math
import os
import secrets
import string
import threading
import time
import uuid
from io import BytesIO
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

from flask import (
    Flask,
    Response,
    current_app,
    g,
    has_request_context,
    jsonify,
    request,
    send_file,
)
from werkzeug.exceptions import RequestEntityTooLarge
from PIL import Image as PillowImage

from api_utils.custom_errors import ExposableError
from api_utils.account_change import (
    AccountChangeCoordinator,
    CredentialChangeError,
    CredentialChangeRejected,
    CredentialChangeUncertain,
    RecoveryJournal,
)
from api_utils.local_store import LocalJsonStore, LocalStoreError
from api_utils.reference_store import ReferenceStore
from api_utils.image_validation import validate_base64_image, validate_generation_images
from api_utils.novelai_client import NovelAIClient, NovelAIUpstreamError
from api_utils.novelai_payload_builder import (
    ALL_MODELS,
    NOVELAI_MAX_COST_PER_IMAGE,
    V5_MODEL_FAMILY,
    V5_MODELS,
    build_novelai_payload,
)


BASE_DIR = Path(__file__).resolve().parent
MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
DIRECTOR_TOOLS = frozenset({"lineart", "sketch", "declutter", "emotion", "colorize"})
IMAGE_ENDPOINT_LOG_NAMES = {
    "generate_image": "generate",
    "augment_image": "augment",
    "upscale_image": "upscale",
}
TRUSTED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
LOCAL_CONFIG_KEYS = frozenset({
    "port",
    "data_dir",
    "upstream_timeout_seconds",
})


def _filter_normal_waitress_queue_depth(record: logging.LogRecord) -> bool:
    """只隐藏 Waitress 在线程刚被占用时产生的 depth=1 噪音。"""

    return record.getMessage() != "Task queue depth is 1"


def _configure_runtime_logging() -> None:
    """配置本地 CMD 可读的单一标准日志管线。"""

    raw_level = os.getenv("NOVELAI_LOCAL_LOG_LEVEL", "INFO").strip().upper()
    log_level = getattr(logging, raw_level, logging.INFO)
    if not isinstance(log_level, int):
        log_level = logging.INFO
    logging.basicConfig(
        level=log_level,
        format=(
            "%(asctime)s level=%(levelname)s role=local pid=%(process)d "
            "thread=%(threadName)s logger=%(name)s %(message)s"
        ),
    )
    logging.getLogger().setLevel(log_level)
    logging.getLogger("waitress").setLevel(logging.INFO)
    queue_logger = logging.getLogger("waitress.queue")
    if _filter_normal_waitress_queue_depth not in queue_logger.filters:
        queue_logger.addFilter(_filter_normal_waitress_queue_depth)


_configure_runtime_logging()


def _safe_traceback_frames(error: Exception) -> str:
    """保留异常调用位置，同时省略可能包含凭据的异常消息和源码行。"""

    frames = []
    traceback_frame = error.__traceback__
    while traceback_frame is not None:
        code = traceback_frame.tb_frame.f_code
        frames.append(
            f"{Path(code.co_filename).name}:{traceback_frame.tb_lineno}:{code.co_name}"
        )
        traceback_frame = traceback_frame.tb_next
    return " > ".join(frames[-8:]) or "-"


class ApiError(Exception):
    """表示可安全公开的本地 API 业务错误。"""

    def __init__(
        self,
        message: str,
        status_code: int = 400,
        code: str = "INVALID_REQUEST",
        extra: dict[str, Any] | None = None,
        uncertain: bool = False,
    ) -> None:
        """初始化稳定错误码、状态码和可选响应字段。"""

        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.extra = extra or {}
        self.uncertain = bool(uncertain)


def load_local_config(path: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    """
    读取本地版非敏感运行配置。

    Args:
        path: 可选配置路径；未提供时只尝试当前后端目录的 config.local.json。

    Returns:
        配置字典；文件不存在时返回空字典。
    """

    config_path = Path(path) if path is not None else BASE_DIR / "config.local.json"
    if not config_path.exists():
        return {}
    with config_path.open("r", encoding="utf-8") as file:
        config = json.load(file)
    if not isinstance(config, dict):
        raise ValueError("Local config must contain a JSON object.")
    unknown_keys = set(config) - LOCAL_CONFIG_KEYS
    if unknown_keys:
        raise ValueError("Local config contains unsupported fields.")
    return config


def _error_response(error: ApiError | NovelAIUpstreamError) -> tuple[Response, int]:
    """构建不含内部诊断或上游正文的稳定 JSON 错误。"""

    uncertain = (
        error.status_code >= 500
        if isinstance(error, NovelAIUpstreamError)
        else error.uncertain
    )
    payload = {
        "success": False,
        "error": error.message,
        "code": error.code,
        "certain": not uncertain,
        "uncertain": uncertain,
        "correlation_id": _request_correlation_id(),
    }
    payload.update(getattr(error, "extra", {}) or {})
    return jsonify(payload), int(error.status_code)


def _request_json() -> dict[str, Any]:
    """读取必须为 JSON 对象的请求正文。"""

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ApiError("The request body must be a JSON object.")
    return payload


def _origin_is_allowed(origin: str, allowed_origins: set[str]) -> bool:
    """按完整 scheme、host 与 port 比较浏览器 Origin。"""

    try:
        parsed = urlsplit(origin)
    except ValueError:
        return False
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    normalized = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    return normalized in allowed_origins


def _current_session() -> tuple[str | None, dict[str, Any] | None]:
    """读取当前 opaque Cookie 对应的内存会话并执行闲置过期。"""

    app = current_app
    session_id = request.cookies.get(app.config["SESSION_COOKIE_NAME"])
    if not session_id:
        g.request_authenticated = False
        g.request_login_mode = "none"
        return None, None
    now = time.monotonic()
    with app.extensions["session_lock"]:
        entry = app.extensions["local_sessions"].get(session_id)
        if entry is None:
            g.request_authenticated = False
            g.request_login_mode = "none"
            return None, None
        if now - entry["last_used_at"] > app.config["SESSION_TTL_SECONDS"]:
            app.extensions["local_sessions"].pop(session_id, None)
            _clear_session_batches(app, session_id)
            g.request_authenticated = False
            g.request_login_mode = "none"
            return None, None
        entry["last_used_at"] = now
        g.request_authenticated = True
        g.request_login_mode = entry["login_mode"]
        return session_id, entry


def _clear_session_batches(app: Flask, session_id: str) -> None:
    """只清理指定会话的内存批次状态。"""

    with app.extensions["batch_lock"]:
        for batch_id, state in list(app.extensions["batch_states"].items()):
            if state["owner"] == session_id:
                app.extensions["batch_states"].pop(batch_id, None)


def _prune_batch_states_locked(app: Flask) -> None:
    """移除长时间无活动的批次，避免浏览器异常退出后永久阻断新请求。"""

    now = app.config["MONOTONIC_CLOCK"]()
    ttl = app.config["BATCH_STATE_TTL_SECONDS"]
    for batch_id, state in list(app.extensions["batch_states"].items()):
        if now - state.get("updated_at", now) > ttl:
            app.extensions["batch_states"].pop(batch_id, None)


def _delete_session(session_id: str | None) -> None:
    """删除一个内存会话及其批次状态。"""

    if not session_id:
        return
    app = current_app
    with app.extensions["session_lock"]:
        app.extensions["local_sessions"].pop(session_id, None)
    _clear_session_batches(app, session_id)
    if has_request_context():
        g.request_authenticated = False
        g.request_login_mode = "none"


def _set_session_cookie(response: Response, session_id: str) -> None:
    """把随机 opaque 会话 ID 写入 HttpOnly Cookie。"""

    response.set_cookie(
        current_app.config["SESSION_COOKIE_NAME"],
        session_id,
        httponly=True,
        secure=bool(current_app.config["SESSION_COOKIE_SECURE"]),
        samesite="Strict",
        path="/",
    )


def _expire_session_cookie(response: Response) -> None:
    """让浏览器立即移除本地会话 Cookie。"""

    response.delete_cookie(
        current_app.config["SESSION_COOKIE_NAME"],
        path="/",
        secure=bool(current_app.config["SESSION_COOKIE_SECURE"]),
        samesite="Strict",
    )


def session_required(*, csrf: bool = False) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """
    要求路由具有有效内存会话，并可额外校验 CSRF。

    Args:
        csrf: 是否要求 X-CSRF-Token 与内存会话完全匹配。

    Returns:
        Flask 路由装饰器。
    """

    def decorator(function: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(function)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            session_id, entry = _current_session()
            if entry is None:
                raise ApiError("Authentication is required.", 401, "AUTH_REQUIRED")
            if csrf:
                supplied = request.headers.get("X-CSRF-Token", "")
                expected = entry["csrf_token"]
                if not supplied or not secrets.compare_digest(supplied, expected):
                    raise ApiError("The CSRF token is invalid.", 403, "CSRF_INVALID")
            g.local_session_id = session_id
            g.local_session = entry
            g.request_authenticated = True
            g.request_login_mode = entry["login_mode"]
            return function(*args, **kwargs)

        return wrapped

    return decorator


def _number_or_none(value: Any) -> int | float | None:
    """只保留有限数值，并明确排除 bool。"""

    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(float(value)):
        return None
    return value


def _build_account_snapshot(
    raw_snapshot: dict[str, Any],
    login_mode: str,
    fallback_email: str | None = None,
) -> dict[str, Any]:
    """将官方 information/subscription 收敛为稳定且不补零的本地契约。"""

    raw_information = raw_snapshot.get("information")
    raw_subscription = raw_snapshot.get("subscription")
    if not isinstance(raw_information, dict) or not isinstance(raw_subscription, dict):
        raise NovelAIUpstreamError(
            "NovelAI returned an invalid account response.",
            502,
            "NOVELAI_INVALID_RESPONSE",
        )

    training = raw_subscription.get("trainingStepsLeft")
    if not isinstance(training, dict):
        training = {}
    fixed = _number_or_none(training.get("fixedTrainingStepsLeft"))
    purchased = _number_or_none(training.get("purchasedTrainingSteps"))
    total = fixed + purchased if fixed is not None and purchased is not None else None

    usage = raw_subscription.get("usage")
    if not isinstance(usage, dict):
        usage = {}
    raw_is_negative = usage.get("isNegative")
    available = not raw_is_negative if isinstance(raw_is_negative, bool) else None

    return {
        "auth": {
            "login_mode": login_mode,
            "can_manage_credentials": login_mode == "password",
        },
        "information": {
            "email": raw_information.get("plainTextEmail") or fallback_email,
            "email_verified": raw_information.get("emailVerified"),
            "account_created_at": raw_information.get("accountCreatedAt"),
            "trial_activated": raw_information.get("trialActivated"),
            "trial_actions_left": raw_information.get("trialActionsLeft"),
            "trial_images_left": raw_information.get("trialImagesLeft"),
            "ban_status": raw_information.get("banStatus", raw_information.get("banned")),
            "ban_message": raw_information.get("banMessage"),
        },
        "subscription": {
            "tier": raw_subscription.get("tier"),
            "active": raw_subscription.get("active"),
            "expires_at": raw_subscription.get("expiresAt"),
            "is_grace_period": raw_subscription.get("isGracePeriod"),
        },
        "anlas": {
            "fixed": fixed,
            "purchased": purchased,
            "total": total,
        },
        "v5": {
            "percent": _number_or_none(usage.get("percent")),
            "is_negative": raw_is_negative if isinstance(raw_is_negative, bool) else None,
            "available": available,
            "time_until_next_percent": _number_or_none(usage.get("timeUntilNextPercent")),
        },
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
        "stale": False,
    }


def _refresh_account_snapshot(
    entry: dict[str, Any],
    *,
    preserve_success_on_unauthorized: bool = False,
) -> dict[str, Any]:
    """刷新账户快照；失败时按调用场景保留 last-good。"""

    started_at = time.perf_counter()
    correlation_id = _request_correlation_id()
    try:
        raw_snapshot = current_app.extensions["novelai_client"].account_snapshot(entry["token"])
        snapshot = _build_account_snapshot(
            raw_snapshot,
            entry["login_mode"],
            entry.get("account_email"),
        )
        entry["account_snapshot"] = snapshot
        entry["last_snapshot"] = copy.deepcopy(snapshot)
        current_app.logger.info(
            "event=account_refresh result=success stale=false login_mode=%s "
            "elapsed_ms=%.2f correlation_id=%s",
            entry["login_mode"],
            (time.perf_counter() - started_at) * 1000,
            correlation_id,
        )
        return snapshot
    except NovelAIUpstreamError as exc:
        if exc.status_code == 401 and not preserve_success_on_unauthorized:
            current_app.logger.warning(
                "event=account_refresh result=failed stale=false login_mode=%s "
                "error_code=%s certain=true elapsed_ms=%.2f correlation_id=%s",
                entry["login_mode"],
                exc.code,
                (time.perf_counter() - started_at) * 1000,
                correlation_id,
            )
            raise
        snapshot = copy.deepcopy(entry["last_snapshot"])
        snapshot["stale"] = True
        entry["account_snapshot"] = snapshot
        if exc.status_code == 401:
            entry["refresh_unauthorized"] = True
        current_app.logger.warning(
            "event=account_refresh result=stale stale=true login_mode=%s "
            "error_code=%s certain=%s elapsed_ms=%.2f correlation_id=%s",
            entry["login_mode"],
            exc.code,
            str(exc.status_code < 500).lower(),
            (time.perf_counter() - started_at) * 1000,
            correlation_id,
        )
        return snapshot


def _operation_json_response(
    payload: dict[str, Any],
    entry: dict[str, Any],
    session_id: str,
) -> Response:
    """返回已成功的操作结果，并在余额刷新 401 后清理会话 Cookie。"""

    response = jsonify(payload)
    if entry.pop("refresh_unauthorized", False):
        _delete_session(session_id)
        _expire_session_cookie(response)
    return response


def _create_session(
    token: str,
    account_snapshot: dict[str, Any],
    *,
    login_mode: str,
    account_email: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """创建只存在于当前进程内存中的 opaque 会话。"""

    session_id = secrets.token_urlsafe(32)
    now = time.monotonic()
    entry = {
        "token": token,
        "csrf_token": secrets.token_urlsafe(32),
        "account_snapshot": copy.deepcopy(account_snapshot),
        "last_snapshot": copy.deepcopy(account_snapshot),
        "login_mode": login_mode,
        "account_email": account_email or account_snapshot.get("information", {}).get("email"),
        "created_at": now,
        "last_used_at": now,
    }
    with current_app.extensions["session_lock"]:
        current_app.extensions["local_sessions"][session_id] = entry
    return session_id, entry


def _parse_batch_metadata(payload: dict[str, Any]) -> tuple[str | None, int, int | None]:
    """从请求中移除并校验批次 ID、索引与固定总张数。"""

    batch_id = payload.pop("batch_id", None)
    index = payload.pop("index", None)
    batch_size = payload.pop("batch_size", None)
    if batch_id is None and index is None and batch_size is None:
        return None, 0, None
    if not isinstance(batch_id, str) or not batch_id.strip() or len(batch_id) > 128:
        raise ApiError("batch_id must be a non-empty string of at most 128 characters.")
    if (
        isinstance(batch_size, bool)
        or not isinstance(batch_size, int)
        or not 1 <= batch_size <= 8
    ):
        raise ApiError("batch_size must be an integer between 1 and 8.")
    if (
        isinstance(index, bool)
        or not isinstance(index, int)
        or not 0 <= index < batch_size
    ):
        raise ApiError("index must be within the declared batch_size.")
    return batch_id.strip(), index, batch_size


@contextmanager
def _image_operation(
    session_id: str,
    batch_id: str | None,
    index: int,
    batch_size: int | None,
):
    """串行化图像请求，并对显式批次执行顺序与十五秒间隔约束。"""

    app = current_app._get_current_object()
    operation_lock = app.extensions["image_operation_lock"]
    operation_name = IMAGE_ENDPOINT_LOG_NAMES.get(request.endpoint or "", "image")
    correlation_id = _request_correlation_id()
    if not operation_lock.acquire(blocking=False):
        app.logger.warning(
            "event=image_batch_result operation=%s result=busy batched=%s index=%d "
            "batch_size=%s error_code=IMAGE_OPERATION_BUSY certain=true correlation_id=%s",
            operation_name,
            str(batch_id is not None).lower(),
            index,
            batch_size if batch_size is not None else "-",
            correlation_id,
        )
        raise ApiError(
            "Another image operation is still running.",
            409,
            "IMAGE_OPERATION_BUSY",
        )

    completed = False
    operation_started = False
    try:
        with app.extensions["batch_lock"]:
            _prune_batch_states_locked(app)
            state = None
            if batch_id is not None:
                state = app.extensions["batch_states"].get(batch_id)
                if state is None:
                    if index != 0:
                        raise ApiError(
                            "A new batch must start at index 0.",
                            409,
                            "BATCH_OUT_OF_ORDER",
                        )
                    if any(
                        existing["terminal"] is None and not existing["cancelled"]
                        for existing in app.extensions["batch_states"].values()
                    ):
                        raise ApiError(
                            "Another image batch is still active.",
                            409,
                            "IMAGE_BATCH_ACTIVE",
                        )
                    state = {
                        "owner": session_id,
                        "next_index": 0,
                        "next_allowed_at": float("-inf"),
                        "cancelled": False,
                        "terminal": None,
                        "batch_size": batch_size,
                        "updated_at": app.config["MONOTONIC_CLOCK"](),
                    }
                    app.extensions["batch_states"][batch_id] = state
                if state["owner"] != session_id:
                    raise ApiError(
                        "This batch_id belongs to another local session.",
                        409,
                        "BATCH_OWNER_MISMATCH",
                    )
                if state["cancelled"]:
                    raise ApiError("The image batch was cancelled.", 409, "BATCH_CANCELLED")
                if state["terminal"] is not None:
                    raise ApiError(
                        "The image batch has already reached a terminal state.",
                        409,
                        "BATCH_TERMINAL",
                        {"batch_status": state["terminal"]},
                    )
                if state.get("batch_size") != batch_size:
                    raise ApiError(
                        "batch_size must remain unchanged within a batch.",
                        409,
                        "BATCH_SIZE_MISMATCH",
                    )
                if index != state["next_index"]:
                    raise ApiError(
                        f"The next batch index must be {state['next_index']}.",
                        409,
                        "BATCH_OUT_OF_ORDER",
                        {"expected_index": state["next_index"]},
                    )
                remaining = state["next_allowed_at"] - app.config["MONOTONIC_CLOCK"]()
                if remaining > 0:
                    raise ApiError(
                        "Please wait before starting the next image in this batch.",
                        429,
                        "IMAGE_INTERVAL_ACTIVE",
                        {"retry_after": round(remaining, 3)},
                    )
        operation_started = True
        app.logger.info(
            "event=image_batch_start operation=%s batched=%s index=%d batch_size=%s "
            "correlation_id=%s",
            operation_name,
            str(batch_id is not None).lower(),
            index,
            batch_size if batch_size is not None else "-",
            correlation_id,
        )
        yield
        completed = True
    except Exception as error:
        if operation_started and batch_id is not None:
            with app.extensions["batch_lock"]:
                state = app.extensions["batch_states"].get(batch_id)
                if state is not None and not state["cancelled"]:
                    # 首次发送失败后批次立即终止，调用方不得自动重放同一 index。
                    state["terminal"] = "failed"
                    state["updated_at"] = app.config["MONOTONIC_CLOCK"]()
        error_code = getattr(error, "code", "INTERNAL_ERROR")
        certain = not (
            isinstance(error, NovelAIUpstreamError) and error.status_code >= 500
        ) and not (isinstance(error, ApiError) and error.uncertain)
        app.logger.warning(
            "event=image_batch_result operation=%s result=%s batched=%s index=%d "
            "batch_size=%s error_code=%s certain=%s correlation_id=%s",
            operation_name,
            "failed" if operation_started else "rejected",
            str(batch_id is not None).lower(),
            index,
            batch_size if batch_size is not None else "-",
            error_code,
            str(certain).lower(),
            correlation_id,
        )
        raise
    finally:
        terminal = "single"
        if completed and batch_id is not None:
            with app.extensions["batch_lock"]:
                state = app.extensions["batch_states"].get(batch_id)
                if state is not None and not state["cancelled"]:
                    state["next_index"] += 1
                    state["next_allowed_at"] = (
                        app.config["MONOTONIC_CLOCK"]()
                        + app.config["IMAGE_INTERVAL_SECONDS"]
                    )
                    if batch_size is not None and index == batch_size - 1:
                        state["terminal"] = "completed"
                    state["updated_at"] = app.config["MONOTONIC_CLOCK"]()
                    terminal = state["terminal"] or "continuing"
                elif state is not None and state["cancelled"]:
                    terminal = "cancelled"
        if completed:
            app.logger.info(
                "event=image_batch_result operation=%s result=success batched=%s index=%d "
                "batch_size=%s terminal=%s correlation_id=%s",
                operation_name,
                str(batch_id is not None).lower(),
                index,
                batch_size if batch_size is not None else "-",
                terminal,
                correlation_id,
            )
        operation_lock.release()


def _image_result(
    image: dict[str, str],
    *,
    seed: int | None,
    index: int,
) -> dict[str, Any]:
    """将官方单图响应收敛为前端统一的 images 数组成员。"""

    return {
        "data": image["data"],
        "mime_type": image["mime_type"],
        "seed": seed,
        "index": index,
    }


def _correlation_id() -> str:
    """生成官方图像接口要求的六位字母数字关联 ID。"""

    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(6))


def _request_correlation_id() -> str:
    """读取当前 API 请求关联 ID；无请求上下文时生成独立 ID。"""

    if has_request_context():
        correlation_id = getattr(g, "request_correlation_id", None)
        if isinstance(correlation_id, str) and correlation_id:
            return correlation_id
    return _correlation_id()


def _controlled_api_route() -> str | None:
    """返回受 Flask 路由表控制的 API 模板，不记录用户提交的原始 URL。"""

    if not request.path.startswith("/api"):
        return None
    route = request.url_rule.rule if request.url_rule is not None else None
    if isinstance(route, str) and route.startswith("/api"):
        return route
    return "/api/<unmatched>"


def _request_auth_log_fields(app: Flask) -> tuple[bool, str]:
    """读取请求对应的认证状态，不返回或记录 opaque Session ID。"""

    authenticated = getattr(g, "request_authenticated", None)
    login_mode = getattr(g, "request_login_mode", None)
    if isinstance(authenticated, bool):
        safe_login_mode = (
            login_mode if login_mode in {"persistent_token", "password"} else "none"
        )
        return authenticated, safe_login_mode

    session_id = request.cookies.get(app.config["SESSION_COOKIE_NAME"])
    if not session_id:
        return False, "none"
    with app.extensions["session_lock"]:
        entry = app.extensions["local_sessions"].get(session_id)
        if entry is None:
            return False, "none"
        mode = entry.get("login_mode")
        return True, mode if mode in {"persistent_token", "password"} else "none"


def _log_local_json(operation: str, collection: str, value: Any) -> None:
    """记录本地 JSON 操作类型和条目数，绝不记录实际内容。"""

    item_count = len(value) if isinstance(value, (dict, list)) else 0
    current_app.logger.info(
        "event=local_json operation=%s collection=%s item_count=%d correlation_id=%s",
        operation,
        collection,
        item_count,
        _request_correlation_id(),
    )


def _account_change_correlation_id() -> str:
    """生成账户恢复日志允许保存的六位关联 ID。"""

    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(6))


def _prepare_note(note: Any, inherited_id: str | None = None) -> dict[str, Any]:
    """复制并校验一条笔记，必要时继承或生成本地 opaque ID。"""

    if not isinstance(note, dict):
        raise ApiError("note must be a JSON object.")
    prepared = copy.deepcopy(note)
    title = prepared.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ApiError("note.title must be a non-empty string.")
    note_id = prepared.get("id", inherited_id)
    if note_id is None:
        note_id = uuid.uuid4().hex
    if not isinstance(note_id, str) or not note_id.strip() or len(note_id) > 128:
        raise ApiError("note.id must be a non-empty string of at most 128 characters.")
    prepared["id"] = note_id
    return prepared


def _prepare_artist_thread(thread: Any, inherited_id: str | None = None) -> dict[str, Any]:
    """校验并规范化一条本地画师串记录。"""

    if not isinstance(thread, dict):
        raise ApiError("artist_thread must be a JSON object.")
    title = str(thread.get("title") or "").strip()
    prompt = str(thread.get("prompt") or "").strip()
    if not title or len(title) > 200:
        raise ApiError("artist_thread.title must contain 1 to 200 characters.")
    if len(prompt) > 100_000:
        raise ApiError("artist_thread.prompt is too long.")
    thread_id = thread.get("id", inherited_id) or uuid.uuid4().hex
    if not isinstance(thread_id, str) or not thread_id.strip() or len(thread_id) > 128:
        raise ApiError("artist_thread.id is invalid.")
    images = thread.get("images", [])
    if not isinstance(images, list) or len(images) > 30:
        raise ApiError("artist_thread.images must be an array with at most 30 entries.")
    prepared_images = []
    for image in images:
        if not isinstance(image, dict):
            raise ApiError("artist_thread image is invalid.")
        image_id = str(image.get("id") or uuid.uuid4().hex)
        filename = image.get("filename")
        image_url = image.get("image_url")
        if filename is not None and (not isinstance(filename, str) or Path(filename).name != filename):
            raise ApiError("artist_thread image filename is invalid.")
        if image_url is not None and (
            not isinstance(image_url, str) or not image_url.startswith("/reference_img/")
        ):
            raise ApiError("artist_thread image URL is invalid.")
        if not filename and not image_url:
            raise ApiError("artist_thread image source is required.")
        prepared_images.append({
            "id": image_id,
            "filename": filename,
            "image_url": image_url,
            "original_name": str(image.get("original_name") or filename or "reference image")[:255],
            "mime_type": str(image.get("mime_type") or "image/png")[:100],
        })
    return {
        "id": thread_id,
        "title": title,
        "prompt": prompt,
        "parameters": copy.deepcopy(thread.get("parameters")) if isinstance(thread.get("parameters"), dict) else None,
        "images": prepared_images,
        "created_at": str(thread.get("created_at") or datetime.now(timezone.utc).isoformat()),
    }


def _decode_reference_image(data_url: Any, original_name: Any) -> dict[str, Any]:
    """Validate entirely in memory and return bytes for the configured SQLite store."""

    if not isinstance(data_url, str) or "," not in data_url:
        raise ApiError("A valid image data URL is required.", 400, "IMAGE_INVALID")
    header, encoded = data_url.split(",", 1)
    if not header.startswith("data:image/") or ";base64" not in header:
        raise ApiError("A valid image data URL is required.", 400, "IMAGE_INVALID")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ApiError("The uploaded image is invalid.", 400, "IMAGE_INVALID") from exc
    if not raw or len(raw) > 30 * 1024 * 1024:
        raise ApiError("The uploaded image is too large.", 413, "IMAGE_TOO_LARGE")
    try:
        with PillowImage.open(BytesIO(raw)) as image:
            image.verify()
            image_format = str(image.format or "").lower()
    except Exception as exc:
        raise ApiError("The uploaded image is invalid.", 400, "IMAGE_INVALID") from exc
    extensions = {"png": ".png", "jpeg": ".jpg", "webp": ".webp", "bmp": ".bmp"}
    extension = extensions.get(image_format)
    if not extension:
        raise ApiError("The uploaded image format is not supported.", 400, "IMAGE_FORMAT_UNSUPPORTED")
    filename = f"{uuid.uuid4().hex}{extension}"
    return {
        "id": uuid.uuid4().hex,
        "filename": filename,
        "image_url": None,
        "original_name": str(original_name or filename)[:255],
        "mime_type": f"image/{'jpeg' if extension == '.jpg' else image_format}",
        "data": raw,
    }


def _ensure_no_account_recovery() -> None:
    """存在恢复日志时阻断普通登录、图像 mutation 和新账户变更。"""

    if current_app.extensions["account_recovery_journal"].load() is not None:
        raise ApiError(
            "An unfinished account change must be resolved before continuing.",
            409,
            "ACCOUNT_RECOVERY_REQUIRED",
            {"recovery_required": True},
        )


def create_app(
    test_config: dict[str, Any] | None = None,
    novelai_client: NovelAIClient | None = None,
) -> Flask:
    """
    创建仅供本机 loopback 使用的 Flask 应用。

    Args:
        test_config: 测试或嵌入运行时覆盖的非敏感配置。
        novelai_client: 测试时可注入的官方客户端。

    Returns:
        已注册本地会话、NovelAI 与 JSON 存储路由的 Flask 应用。
    """

    file_config = {} if test_config is not None else load_local_config()
    app = Flask(__name__, static_folder=None)
    app.config.update(
        HOST="127.0.0.1",
        PORT=5000,
        DATA_DIR=str(BASE_DIR / "data"),
        FRONTEND_OUT_DIR=str(BASE_DIR.parent / "next_nai_web" / "out"),
        SESSION_COOKIE_NAME="nai_local_session",
        SESSION_COOKIE_SECURE=False,
        SESSION_TTL_SECONDS=12 * 60 * 60,
        IMAGE_INTERVAL_SECONDS=15.0,
        BATCH_STATE_TTL_SECONDS=5 * 60,
        UPSTREAM_TIMEOUT_SECONDS=120.0,
        LOCAL_STORE_MAX_BYTES=10 * 1024 * 1024,
        MAX_CONTENT_LENGTH=80 * 1024 * 1024,
        MONOTONIC_CLOCK=time.monotonic,
    )
    app.config.update({str(key).upper(): value for key, value in file_config.items()})
    if test_config:
        app.config.update(test_config)

    if app.config["HOST"] not in TRUSTED_HOSTS:
        raise ValueError("The local API host must be a loopback address.")
    if (
        isinstance(app.config["PORT"], bool)
        or not isinstance(app.config["PORT"], int)
        or not 1 <= app.config["PORT"] <= 65535
    ):
        raise ValueError("The local API port must be between 1 and 65535.")
    data_dir = Path(app.config["DATA_DIR"])
    if not data_dir.is_absolute():
        data_dir = BASE_DIR / data_dir
    app.config["DATA_DIR"] = str(data_dir.resolve())
    frontend_out_dir = Path(app.config["FRONTEND_OUT_DIR"])
    if not frontend_out_dir.is_absolute():
        frontend_out_dir = BASE_DIR / frontend_out_dir
    app.config["FRONTEND_OUT_DIR"] = str(frontend_out_dir.resolve())
    port = int(app.config["PORT"])
    # 本地配置只能改变服务端口，浏览器来源始终由最终端口和固定开发端口推导。
    app.config["ALLOWED_ORIGINS"] = {
        f"http://localhost:{port}",
        f"http://127.0.0.1:{port}",
        f"http://[::1]:{port}",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://[::1]:3000",
    }

    app.extensions["novelai_client"] = novelai_client or NovelAIClient(
        app.config["UPSTREAM_TIMEOUT_SECONDS"]
    )
    app.extensions["local_store"] = LocalJsonStore(
        app.config["DATA_DIR"],
        app.config["LOCAL_STORE_MAX_BYTES"],
    )
    app.extensions["reference_store"] = ReferenceStore(
        app.config["DATA_DIR"],
        Path(app.config["FRONTEND_OUT_DIR"]).parent / "public",
    )
    app.extensions["local_sessions"] = {}
    app.extensions["session_lock"] = threading.RLock()
    app.extensions["batch_states"] = {}
    app.extensions["batch_lock"] = threading.RLock()
    app.extensions["image_operation_lock"] = threading.Lock()
    recovery_journal = RecoveryJournal(
        Path(app.config["DATA_DIR"]) / "account-change-recovery.json"
    )
    app.extensions["account_recovery_journal"] = recovery_journal
    app.extensions["account_change_coordinator"] = AccountChangeCoordinator(
        app.extensions["novelai_client"],
        recovery_journal,
    )

    @app.before_request
    def log_api_request_start() -> None:
        """记录 API 请求开始信息，不读取正文、查询值或认证材料。"""

        route = _controlled_api_route()
        if route is None:
            return
        g.request_started_at = time.perf_counter()
        g.request_correlation_id = _correlation_id()
        authenticated, login_mode = _request_auth_log_fields(app)
        g.request_authenticated = authenticated
        g.request_login_mode = login_mode
        g.request_route = route
        app.logger.info(
            "event=api_request_start method=%s route=%s authenticated=%s "
            "login_mode=%s correlation_id=%s",
            request.method,
            route,
            str(authenticated).lower(),
            login_mode,
            g.request_correlation_id,
        )

    @app.after_request
    def log_api_request_complete(response: Response) -> Response:
        """记录 API 终态、耗时和稳定错误码，不解析成功响应正文。"""

        route = getattr(g, "request_route", None)
        started_at = getattr(g, "request_started_at", None)
        if not isinstance(route, str) or not isinstance(started_at, float):
            return response
        authenticated, login_mode = _request_auth_log_fields(app)
        error_code = "-"
        certain = response.status_code < 500
        if response.status_code >= 400 and response.is_json:
            payload = response.get_json(silent=True)
            if isinstance(payload, dict):
                if isinstance(payload.get("code"), str):
                    error_code = payload["code"]
                if isinstance(payload.get("certain"), bool):
                    certain = payload["certain"]
        level = logging.ERROR if response.status_code >= 500 else (
            logging.WARNING if response.status_code >= 400 else logging.INFO
        )
        app.logger.log(
            level,
            "event=api_request_complete method=%s route=%s status=%d elapsed_ms=%.2f "
            "authenticated=%s login_mode=%s error_code=%s certain=%s correlation_id=%s",
            request.method,
            route,
            response.status_code,
            (time.perf_counter() - started_at) * 1000,
            str(authenticated).lower(),
            login_mode,
            error_code,
            str(certain).lower(),
            _request_correlation_id(),
        )
        return response

    @app.before_request
    def enforce_local_request_boundary() -> Response | None:
        """阻止非 loopback Host 和未批准浏览器 Origin。"""

        try:
            hostname = urlsplit(f"http://{request.host}").hostname
        except ValueError:
            hostname = None
        if hostname not in TRUSTED_HOSTS:
            raise ApiError("The Host header is not allowed.", 400, "HOST_NOT_ALLOWED")

        origin = request.headers.get("Origin")
        if origin and not _origin_is_allowed(origin, app.config["ALLOWED_ORIGINS"]):
            raise ApiError("The Origin header is not allowed.", 403, "ORIGIN_NOT_ALLOWED")
        if request.method in MUTATING_METHODS and request.method != "OPTIONS" and not origin:
            raise ApiError("The Origin header is required.", 403, "ORIGIN_REQUIRED")
        if request.method == "OPTIONS":
            return Response(status=204)
        return None

    @app.after_request
    def add_local_cors_headers(response: Response) -> Response:
        """仅为批准的本地前端 Origin 返回凭据型 CORS 头。"""

        origin = request.headers.get("Origin")
        if origin and _origin_is_allowed(origin, app.config["ALLOWED_ORIGINS"]):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-CSRF-Token"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
            response.headers.add("Vary", "Origin")
        response.headers.setdefault("Cache-Control", "no-store")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        return response

    @app.errorhandler(ApiError)
    def handle_api_error(error: ApiError) -> tuple[Response, int]:
        """返回本地业务错误。"""

        return _error_response(error)

    @app.errorhandler(ExposableError)
    def handle_payload_error(error: ExposableError) -> tuple[Response, int]:
        """返回已由原 payload builder 清理过的校验错误。"""

        return _error_response(ApiError(error.message, error.status_code, error.code or "INVALID_REQUEST"))

    @app.errorhandler(NovelAIUpstreamError)
    def handle_upstream_error(error: NovelAIUpstreamError) -> tuple[Response, int] | Response:
        """返回上游错误，并在官方 401 时同步清除本地会话。"""

        response, status_code = _error_response(error)
        if error.status_code == 401:
            _delete_session(request.cookies.get(app.config["SESSION_COOKIE_NAME"]))
            _expire_session_cookie(response)
        return response, status_code

    @app.errorhandler(LocalStoreError)
    def handle_local_store_error(error: LocalStoreError) -> tuple[Response, int]:
        """隐藏本地文件路径并返回稳定存储错误。"""

        return _error_response(ApiError("Local data could not be saved or read.", 500, "LOCAL_STORE_ERROR"))

    @app.errorhandler(CredentialChangeRejected)
    def handle_account_change_rejected(error: CredentialChangeRejected) -> tuple[Response, int]:
        """返回官方明确拒绝的账户变更。"""

        return _error_response(ApiError(
            "NovelAI rejected the account change.",
            400,
            "ACCOUNT_CHANGE_REJECTED",
        ))

    @app.errorhandler(CredentialChangeUncertain)
    def handle_account_change_uncertain(error: CredentialChangeUncertain) -> tuple[Response, int]:
        """提示调用方必须进入恢复流程，绝不猜测 mutation 结果。"""

        return _error_response(ApiError(
            "The account change result is uncertain. Use the recovery flow before continuing.",
            409,
            "ACCOUNT_CHANGE_UNCERTAIN",
            {"recovery_required": True},
            uncertain=True,
        ))

    @app.errorhandler(CredentialChangeError)
    def handle_account_change_error(error: CredentialChangeError) -> tuple[Response, int]:
        """隐藏凭据与恢复摘要并返回稳定账户错误。"""

        recovery_required = app.extensions["account_recovery_journal"].load() is not None
        return _error_response(ApiError(
            "The account change could not be completed safely.",
            409 if recovery_required else 400,
            "ACCOUNT_CHANGE_FAILED",
            {"recovery_required": recovery_required},
            uncertain=recovery_required,
        ))

    @app.errorhandler(RequestEntityTooLarge)
    def handle_large_request(error: RequestEntityTooLarge) -> tuple[Response, int]:
        """拒绝超过本地 API 明确上限的请求正文。"""

        return _error_response(ApiError("The request body is too large.", 413, "REQUEST_TOO_LARGE"))

    @app.errorhandler(Exception)
    def handle_unexpected_error(error: Exception) -> tuple[Response, int]:
        """把未预期异常收敛为安全 JSON，同时保留测试传播行为。"""

        if app.config.get("PROPAGATE_EXCEPTIONS"):
            raise error
        correlation_id = _request_correlation_id()
        app.logger.error(
            "event=unhandled_api_error error_type=%s traceback=%s "
            "certain=false correlation_id=%s",
            type(error).__name__,
            _safe_traceback_frames(error),
            correlation_id,
        )
        return jsonify({
            "success": False,
            "error": "The local service encountered an unexpected error.",
            "code": "INTERNAL_ERROR",
            "certain": False,
            "uncertain": True,
            "correlation_id": correlation_id,
        }), 500

    @app.get("/api/session")
    def get_session() -> Response:
        """读取当前内存会话，不存在时返回 authenticated=false。"""

        _, entry = _current_session()
        if entry is None:
            return jsonify({"authenticated": False})
        return jsonify({
            "authenticated": True,
            "csrf_token": entry["csrf_token"],
            "account_snapshot": entry["account_snapshot"],
        })

    @app.post("/api/session/persistent-token")
    def login_persistent_token() -> Response:
        """验证 PAT 并建立只存在于内存中的本地会话。"""

        _ensure_no_account_recovery()
        payload = _request_json()
        token = payload.get("token")
        if not isinstance(token, str) or not token.strip() or len(token) > 4096:
            raise ApiError("A valid persistent token is required.", 400, "TOKEN_INVALID")
        token = token.strip()
        raw_snapshot = app.extensions["novelai_client"].account_snapshot(token)
        account_snapshot = _build_account_snapshot(raw_snapshot, "persistent_token")
        old_session_id = request.cookies.get(app.config["SESSION_COOKIE_NAME"])
        _delete_session(old_session_id)
        session_id, entry = _create_session(
            token,
            account_snapshot,
            login_mode="persistent_token",
        )
        g.request_authenticated = True
        g.request_login_mode = "persistent_token"
        app.logger.info(
            "event=session_login result=success login_mode=persistent_token correlation_id=%s",
            _request_correlation_id(),
        )
        response = jsonify({
            "authenticated": True,
            "csrf_token": entry["csrf_token"],
            "account_snapshot": entry["account_snapshot"],
        })
        _set_session_cookie(response, session_id)
        return response

    @app.post("/api/session/password")
    def login_password() -> Response:
        """本机派生登录密钥，官方登录成功后立即丢弃原始密码。"""

        _ensure_no_account_recovery()
        payload = _request_json()
        email = payload.get("email")
        password = payload.get("password")
        if not isinstance(email, str) or not email.strip() or len(email) > 320:
            raise ApiError("A valid email address is required.", 400, "EMAIL_INVALID")
        if not isinstance(password, str) or not password or len(password) > 4096:
            raise ApiError("A valid password is required.", 400, "PASSWORD_INVALID")
        try:
            token = app.extensions["novelai_client"].login_with_password(email.strip(), password)
        finally:
            password = None
            payload.pop("password", None)
        normalized_email = email.strip().lower()
        raw_snapshot = app.extensions["novelai_client"].account_snapshot(token)
        account_snapshot = _build_account_snapshot(raw_snapshot, "password", normalized_email)
        old_session_id = request.cookies.get(app.config["SESSION_COOKIE_NAME"])
        _delete_session(old_session_id)
        session_id, entry = _create_session(
            token,
            account_snapshot,
            login_mode="password",
            account_email=normalized_email,
        )
        g.request_authenticated = True
        g.request_login_mode = "password"
        app.logger.info(
            "event=session_login result=success login_mode=password correlation_id=%s",
            _request_correlation_id(),
        )
        response = jsonify({
            "authenticated": True,
            "csrf_token": entry["csrf_token"],
            "account_snapshot": entry["account_snapshot"],
        })
        _set_session_cookie(response, session_id)
        return response

    @app.delete("/api/session")
    @session_required(csrf=True)
    def logout() -> Response:
        """清除当前进程中的令牌、CSRF 与批次状态。"""

        _delete_session(g.local_session_id)
        app.logger.info(
            "event=session_logout result=success login_mode=%s correlation_id=%s",
            g.local_session["login_mode"],
            _request_correlation_id(),
        )
        response = jsonify({"authenticated": False})
        _expire_session_cookie(response)
        return response

    @app.get("/api/account")
    @session_required()
    def get_account() -> Response:
        """刷新并返回官方账户信息与订阅聚合快照。"""

        snapshot = _refresh_account_snapshot(g.local_session)
        return jsonify({"account_snapshot": snapshot})

    def _perform_account_change(operation: str) -> Response:
        """在全局 operation lock 内执行一次密码或邮箱变更。"""

        _ensure_no_account_recovery()
        if g.local_session["login_mode"] != "password":
            raise ApiError(
                "Credential management requires an email and password login.",
                403,
                "CREDENTIAL_MANAGEMENT_REQUIRES_PASSWORD_LOGIN",
            )
        payload = _request_json()
        if payload.get("backup_confirmed") is not True:
            raise ApiError(
                "You must confirm that your recovery backup is current.",
                400,
                "BACKUP_CONFIRMATION_REQUIRED",
            )
        current_password = payload.get("current_password")
        if not isinstance(current_password, str) or not current_password:
            raise ApiError("The current password is required.", 400, "CURRENT_PASSWORD_REQUIRED")
        if len(current_password) > 4096:
            raise ApiError("The current password is too long.", 400, "CURRENT_PASSWORD_INVALID")
        source_email = g.local_session.get("account_email")
        if not isinstance(source_email, str) or not source_email:
            raise ApiError("The current account email is unavailable.", 409, "ACCOUNT_EMAIL_UNAVAILABLE")

        if operation == "password":
            target_email = source_email
            target_password = payload.get("new_password")
            if not isinstance(target_password, str) or not target_password:
                raise ApiError("A new password is required.", 400, "NEW_PASSWORD_REQUIRED")
            if not 8 <= len(target_password) <= 4096:
                raise ApiError(
                    "The new password must contain between 8 and 4096 characters.",
                    400,
                    "NEW_PASSWORD_INVALID",
                )
        else:
            target_email = payload.get("new_email")
            target_password = current_password
            if not isinstance(target_email, str) or not target_email:
                raise ApiError("A new email address is required.", 400, "NEW_EMAIL_REQUIRED")

        with app.extensions["batch_lock"]:
            _prune_batch_states_locked(app)
            active_batch = any(
                not state["cancelled"]
                and state["terminal"] is None
                for state in app.extensions["batch_states"].values()
            )
        if active_batch:
            raise ApiError(
                "Wait for the current image batch to finish or cancel it before changing credentials.",
                409,
                "IMAGE_BATCH_ACTIVE",
            )

        correlation_id = _account_change_correlation_id()
        operation_lock = app.extensions["image_operation_lock"]
        if not operation_lock.acquire(blocking=False):
            raise ApiError(
                "Another image or account operation is still running.",
                409,
                "IMAGE_OPERATION_BUSY",
            )
        app.logger.info(
            "event=account_change_start operation=%s correlation_id=%s",
            operation,
            correlation_id,
        )
        try:
            _ensure_no_account_recovery()
            new_token = app.extensions["account_change_coordinator"].change(
                operation=operation,
                source_email=source_email,
                source_password=current_password,
                target_email=target_email,
                target_password=target_password,
                correlation_id=correlation_id,
            )
            normalized_target_email = target_email.lower()
            # 必须先切换内存身份，再清理 verified 恢复日志。
            g.local_session["token"] = new_token
            g.local_session["login_mode"] = "password"
            g.local_session["account_email"] = normalized_target_email
            g.local_session["last_snapshot"]["auth"] = {
                "login_mode": "password",
                "can_manage_credentials": True,
            }
            g.local_session["last_snapshot"]["information"]["email"] = normalized_target_email
            if operation == "email":
                # 刷新失败时不能沿用旧邮箱的已验证状态冒充新邮箱已验证。
                g.local_session["last_snapshot"]["information"]["email_verified"] = None
            snapshot = _refresh_account_snapshot(g.local_session)
            app.extensions["account_change_coordinator"].finalize()
            app.logger.info(
                "event=account_change_result operation=%s result=success correlation_id=%s",
                operation,
                correlation_id,
            )
        finally:
            current_password = None
            target_password = None
            payload.pop("current_password", None)
            payload.pop("new_password", None)
            operation_lock.release()
        return jsonify({
            "changed": True,
            "operation": operation,
            "account_snapshot": snapshot,
            "correlation_id": correlation_id,
        })

    @app.post("/api/account/change-password")
    @session_required(csrf=True)
    def change_account_password() -> Response:
        """在备份确认后同步修改官方密码并重包 keystore。"""

        return _perform_account_change("password")

    @app.post("/api/account/change-email")
    @session_required(csrf=True)
    def change_account_email() -> Response:
        """在备份确认后同步修改官方邮箱并重包 keystore。"""

        return _perform_account_change("email")

    @app.get("/api/account/recovery")
    def get_account_recovery() -> Response:
        """公开恢复是否激活及安全阶段信息，不返回任何摘要或凭据绑定。"""

        record = app.extensions["account_recovery_journal"].load()
        if record is None:
            return jsonify({"active": False})
        return jsonify({
            "active": True,
            "operation": record["operation"],
            "stage": record["stage"],
            "created_at": record["created_at"],
            "updated_at": record["updated_at"],
            "correlation_id": record["correlation_id"],
        })

    @app.post("/api/account/recovery/resolve")
    def resolve_account_recovery() -> Response:
        """用用户重新输入的旧、新凭据收敛一次中断账户变更。"""

        payload = _request_json()
        required = ("source_email", "source_password", "target_email", "target_password")
        if any(not isinstance(payload.get(name), str) or not payload[name] for name in required):
            raise ApiError("All source and target credentials are required.")
        if any(len(payload[name]) > 4096 for name in ("source_password", "target_password")):
            raise ApiError(
                "Recovery passwords must not exceed 4096 characters.",
                400,
                "RECOVERY_CREDENTIALS_INVALID",
            )
        operation_lock = app.extensions["image_operation_lock"]
        if not operation_lock.acquire(blocking=False):
            raise ApiError(
                "Another image or account operation is still running.",
                409,
                "IMAGE_OPERATION_BUSY",
            )
        try:
            status, new_token = app.extensions["account_change_coordinator"].resolve(
                source_email=payload["source_email"],
                source_password=payload["source_password"],
                target_email=payload["target_email"],
                target_password=payload["target_password"],
            )
            if status != "completed" or not new_token:
                raise CredentialChangeError("恢复流程没有确认目标凭据")
            target_email = payload["target_email"].lower()
            session_id, entry = _current_session()
            created_session = entry is None
            if entry is None:
                raw_snapshot = app.extensions["novelai_client"].account_snapshot(new_token)
                snapshot = _build_account_snapshot(raw_snapshot, "password", target_email)
                session_id, entry = _create_session(
                    new_token,
                    snapshot,
                    login_mode="password",
                    account_email=target_email,
                )
            else:
                entry["token"] = new_token
                entry["login_mode"] = "password"
                entry["account_email"] = target_email
                entry["last_snapshot"]["auth"] = {
                    "login_mode": "password",
                    "can_manage_credentials": True,
                }
                entry["last_snapshot"]["information"]["email"] = target_email
                if payload["source_email"].lower() != target_email:
                    # 改邮恢复同样只能由新邮箱的官方 information 恢复验证状态。
                    entry["last_snapshot"]["information"]["email_verified"] = None
                snapshot = _refresh_account_snapshot(entry)
            app.extensions["account_change_coordinator"].finalize()
        finally:
            for name in required:
                if name.endswith("password"):
                    payload.pop(name, None)
            operation_lock.release()

        response = jsonify({
            "status": "completed",
            "authenticated": True,
            "csrf_token": entry["csrf_token"],
            "account_snapshot": snapshot,
        })
        if created_session:
            _set_session_cookie(response, session_id)
        return response

    @app.post("/api/images/generate")
    @session_required(csrf=True)
    def generate_image() -> Response:
        """使用原 ImageGenerationService 参数同步生成一张 NovelAI 图像。"""

        _ensure_no_account_recovery()
        source_payload = copy.deepcopy(_request_json())
        batch_id, index, batch_size = _parse_batch_metadata(source_payload)
        validate_generation_images(source_payload)
        model_name = source_payload.get("model", "nai-diffusion-3")
        if model_name not in ALL_MODELS:
            raise ApiError("The selected model is not allowed.", 400, "MODEL_NOT_SUPPORTED")
        if "width" not in source_payload:
            source_payload["width"] = 832 if model_name in V5_MODELS else 512
        if "height" not in source_payload:
            source_payload["height"] = 1216 if model_name in V5_MODELS else 512

        use_large_image = bool(source_payload.get("use_upscale_credits", False))
        internal_payload = build_novelai_payload(
            source_payload,
            current_user="local",
            user_total_amount=999,
            use_upscale_credits=use_large_image,
            user_upscale_credits=NOVELAI_MAX_COST_PER_IMAGE,
        )
        official_payload = internal_payload["data"]
        if isinstance(official_payload.get("parameters"), dict):
            official_payload["parameters"]["n_samples"] = 1
        correlation_id = internal_payload["headers"].get("X-Correlation-ID") or _correlation_id()
        seed = official_payload.get("parameters", {}).get("seed")

        with _image_operation(g.local_session_id, batch_id, index, batch_size):
            if official_payload.get("req_type"):
                image = app.extensions["novelai_client"].augment_image(
                    g.local_session["token"], official_payload, correlation_id
                )
                images = [_image_result(image, seed=seed, index=index)]
            else:
                upstream_images = app.extensions["novelai_client"].generate_image(
                    g.local_session["token"], official_payload, correlation_id
                )
                if len(upstream_images) != 1:
                    raise NovelAIUpstreamError(
                        "NovelAI returned an unexpected image count.",
                        502,
                        "NOVELAI_INVALID_IMAGE",
                    )
                upstream_image = upstream_images[0]
                images = [_image_result(
                    upstream_image,
                    seed=upstream_image.get("seed", seed),
                    index=upstream_image.get("index", index),
                )]
        account_snapshot = _refresh_account_snapshot(
            g.local_session,
            preserve_success_on_unauthorized=True,
        )
        return _operation_json_response({
            "images": images,
            "account_snapshot": account_snapshot,
            "correlation_id": correlation_id,
            "batch_id": batch_id,
            "index": index,
        }, g.local_session, g.local_session_id)

    @app.delete("/api/images/batch")
    @session_required(csrf=True)
    def cancel_image_batch() -> Response:
        """在内存中取消一个批次，后续同批次索引会被拒绝。"""

        payload = _request_json()
        batch_id = payload.get("batch_id")
        if not isinstance(batch_id, str) or not batch_id.strip() or len(batch_id) > 128:
            raise ApiError("A valid batch_id is required.")
        batch_id = batch_id.strip()
        with app.extensions["batch_lock"]:
            _prune_batch_states_locked(app)
            state = app.extensions["batch_states"].get(batch_id)
            if state is None:
                state = {
                    "owner": g.local_session_id,
                    "next_index": 0,
                    "next_allowed_at": float("-inf"),
                    "cancelled": False,
                    "terminal": None,
                    "batch_size": None,
                    "updated_at": app.config["MONOTONIC_CLOCK"](),
                }
                app.extensions["batch_states"][batch_id] = state
            if state["owner"] != g.local_session_id:
                raise ApiError(
                    "This batch_id belongs to another local session.",
                    409,
                    "BATCH_OWNER_MISMATCH",
                )
            state["cancelled"] = True
            state["updated_at"] = app.config["MONOTONIC_CLOCK"]()
        app.logger.info(
            "event=image_batch_result operation=cancel result=cancelled batched=true "
            "index=%d batch_size=%s terminal=cancelled correlation_id=%s",
            state["next_index"],
            state["batch_size"] if state["batch_size"] is not None else "-",
            _request_correlation_id(),
        )
        account_snapshot = _refresh_account_snapshot(g.local_session)
        return jsonify({
            "cancelled": True,
            "batch_id": batch_id,
            "account_snapshot": account_snapshot,
        })

    def run_direct_image_operation(operation_name: str) -> Response:
        """执行 Upscale 或 Director 的统一同步二进制响应流程。"""

        _ensure_no_account_recovery()
        payload = copy.deepcopy(_request_json())
        batch_id, index, batch_size = _parse_batch_metadata(payload)
        image_value = payload.get("image")
        if not isinstance(image_value, str) or not image_value:
            raise ApiError("A Base64 image is required.", 400, "IMAGE_REQUIRED")
        payload["image"] = validate_base64_image(image_value, "image")
        if operation_name == "augment" and payload.get("req_type") not in DIRECTOR_TOOLS:
            raise ApiError("The selected Director tool is not allowed.", 400, "DIRECTOR_TOOL_INVALID")
        if operation_name == "upscale":
            unknown_fields = set(payload) - {"image", "model", "declared_blur_sigma"}
            if unknown_fields:
                raise ApiError(
                    "The upscale request contains unsupported fields.",
                    400,
                    "UPSCALE_FIELD_INVALID",
                )
            if payload.get("model") not in ALL_MODELS:
                raise ApiError(
                    "The selected upscale model is not allowed.",
                    400,
                    "MODEL_NOT_SUPPORTED",
                )
            if "declared_blur_sigma" in payload and _number_or_none(
                payload["declared_blur_sigma"]
            ) is None:
                raise ApiError("declared_blur_sigma must be a finite number.")

        correlation_id = _correlation_id()
        with _image_operation(g.local_session_id, batch_id, index, batch_size):
            if operation_name == "augment":
                image = app.extensions["novelai_client"].augment_image(
                    g.local_session["token"], payload, correlation_id
                )
                images = [_image_result(image, seed=None, index=index)]
            else:
                upstream_images = app.extensions["novelai_client"].upscale_image(
                    g.local_session["token"], payload, correlation_id
                )
                if len(upstream_images) != 1:
                    raise NovelAIUpstreamError(
                        "NovelAI returned an unexpected image count.",
                        502,
                        "NOVELAI_INVALID_IMAGE",
                    )
                upstream_image = upstream_images[0]
                images = [_image_result(
                    upstream_image,
                    seed=upstream_image.get("seed"),
                    index=upstream_image.get("index", index),
                )]
        account_snapshot = _refresh_account_snapshot(
            g.local_session,
            preserve_success_on_unauthorized=True,
        )
        return _operation_json_response({
            "images": images,
            "account_snapshot": account_snapshot,
            "correlation_id": correlation_id,
            "batch_id": batch_id,
            "index": index,
        }, g.local_session, g.local_session_id)

    @app.post("/api/images/augment")
    @session_required(csrf=True)
    def augment_image() -> Response:
        """同步调用官方 Director Tools 图像增强端点。"""

        return run_direct_image_operation("augment")

    @app.post("/api/images/upscale")
    @session_required(csrf=True)
    def upscale_image() -> Response:
        """同步调用官方 NovelAI Upscale 端点。"""

        return run_direct_image_operation("upscale")

    @app.post("/api/images/vibe")
    @session_required(csrf=True)
    def encode_vibe() -> Response:
        """使用当前官方账户同步编码 Vibe。"""

        _ensure_no_account_recovery()
        payload = _request_json()
        image_value = payload.get("image")
        information_extracted = payload.get("information_extracted")
        model_name = payload.get("model")
        if not isinstance(image_value, str) or not image_value:
            raise ApiError("A Base64 image is required.", 400, "IMAGE_REQUIRED")
        image_value = validate_base64_image(image_value, "image")
        if isinstance(information_extracted, bool) or not isinstance(information_extracted, (int, float)):
            raise ApiError("information_extracted must be a number.")
        if model_name not in ALL_MODELS or model_name in V5_MODEL_FAMILY:
            raise ApiError("The selected model does not support Vibe encoding.", 400, "MODEL_CAPABILITY_NOT_SUPPORTED")
        correlation_id = _correlation_id()
        operation_lock = app.extensions["image_operation_lock"]
        if not operation_lock.acquire(blocking=False):
            raise ApiError("Another image operation is still running.", 409, "IMAGE_OPERATION_BUSY")
        try:
            result = app.extensions["novelai_client"].encode_vibe(
                g.local_session["token"],
                {
                    "image": image_value,
                    "information_extracted": information_extracted,
                    "model": model_name,
                },
                correlation_id,
            )
        finally:
            operation_lock.release()
        account_snapshot = _refresh_account_snapshot(
            g.local_session,
            preserve_success_on_unauthorized=True,
        )
        return _operation_json_response({
            "encoding": result["encoding"],
            "mime_type": result["mime_type"],
            "account_snapshot": account_snapshot,
            "correlation_id": correlation_id,
        }, g.local_session, g.local_session_id)

    @app.get("/api/images/tags")
    @session_required()
    def suggest_tags() -> Response:
        """把 prompt 与可选白名单模型提交给官方标签建议端点。"""

        prompt = request.args.get("prompt", "")
        model_name = request.args.get("model")
        if not prompt or len(prompt) > 1000:
            raise ApiError("prompt must contain between 1 and 1000 characters.")
        params = {"prompt": prompt}
        if model_name is not None:
            if model_name not in ALL_MODELS:
                raise ApiError("The selected model is not allowed.", 400, "MODEL_NOT_SUPPORTED")
            params["model"] = model_name
        tag_payload = app.extensions["novelai_client"].suggest_tags(
            g.local_session["token"], params
        )
        tags = tag_payload.get("tags", tag_payload) if isinstance(tag_payload, dict) else tag_payload
        return jsonify({
            "tags": tags,
            "account_snapshot": g.local_session["account_snapshot"],
            "correlation_id": _correlation_id(),
        })

    @app.get("/api/local/settings")
    @session_required()
    def get_settings() -> Response:
        """读取本地设置对象。"""

        settings = app.extensions["local_store"].read("settings")
        if not isinstance(settings, dict):
            raise LocalStoreError("settings has an invalid shape")
        _log_local_json("read", "settings", settings)
        return jsonify({"settings": settings})

    @app.put("/api/local/settings")
    @session_required(csrf=True)
    def put_settings() -> Response:
        """原子替换本地设置对象。"""

        settings = _request_json().get("settings")
        if not isinstance(settings, dict):
            raise ApiError("settings must be a JSON object.")
        saved = app.extensions["local_store"].write("settings", settings)
        _log_local_json("write", "settings", saved)
        return jsonify({"settings": saved})

    @app.get("/api/local/random-prompts")
    @session_required()
    def get_random_prompts() -> Response:
        """读取本地随机提示词列表。"""

        prompts = app.extensions["local_store"].read("random-prompts")
        if not isinstance(prompts, dict):
            raise LocalStoreError("random-prompts has an invalid shape")
        _log_local_json("read", "random-prompts", prompts)
        return jsonify({"random_prompts": prompts})

    @app.put("/api/local/random-prompts")
    @session_required(csrf=True)
    def put_random_prompts() -> Response:
        """原子替换本地随机提示词列表。"""

        prompts = _request_json().get("random_prompts")
        if not isinstance(prompts, dict):
            raise ApiError("random_prompts must be a JSON object.")
        saved = app.extensions["local_store"].write("random-prompts", prompts)
        _log_local_json("write", "random-prompts", saved)
        return jsonify({"random_prompts": saved})

    @app.get("/api/local/notes")
    @session_required()
    def get_notes() -> Response:
        """读取全部本地笔记。"""

        notes = app.extensions["local_store"].read("notes")
        if not isinstance(notes, list):
            raise LocalStoreError("notes has an invalid shape")
        _log_local_json("read", "notes", notes)
        return jsonify({"notes": notes})

    def reference_kind(collection: str) -> str:
        return "artist" if collection == "artist-threads" else "image"

    def reference_payload_key(collection: str) -> str:
        return "artist_thread" if collection == "artist-threads" else "image_reference"

    @app.get("/api/local/<collection>")
    @session_required()
    def get_references(collection: str) -> Response:
        if collection not in {"artist-threads", "image-references"}:
            raise ApiError("The reference collection was not found.", 404, "NOT_FOUND")
        key = "artist_threads" if collection == "artist-threads" else "image_references"
        return jsonify({key: app.extensions["reference_store"].list(reference_kind(collection))})

    @app.get("/api/local/reference-images/<image_id>")
    @session_required()
    def get_reference_image(image_id: str) -> Response:
        image = app.extensions["reference_store"].image(image_id)
        if image is None:
            raise ApiError("The image was not found.", 404, "IMAGE_NOT_FOUND")
        return send_file(BytesIO(image["image_data"]), mimetype=image["mime_type"], download_name=image["original_name"])

    @app.post("/api/local/<collection>")
    @session_required(csrf=True)
    def create_reference(collection: str) -> tuple[Response, int]:
        if collection not in {"artist-threads", "image-references"}:
            raise ApiError("The reference collection was not found.", 404, "NOT_FOUND")
        payload = _request_json()
        uploads = payload.get("images", [])
        if not isinstance(uploads, list) or len(uploads) > 30:
            raise ApiError("images must contain at most 30 entries.")
        prepared = _prepare_artist_thread({
            "title": payload.get("title"), "prompt": payload.get("prompt"),
            "parameters": payload.get("parameters"), "images": [],
        })
        images = [_decode_reference_image(item.get("data_url"), item.get("original_name"))
                  for item in uploads if isinstance(item, dict)]
        value = app.extensions["reference_store"].create(reference_kind(collection), prepared, images)
        return jsonify({reference_payload_key(collection): value}), 201

    @app.put("/api/local/<collection>/<reference_id>")
    @session_required(csrf=True)
    def update_reference(collection: str, reference_id: str) -> Response:
        if collection not in {"artist-threads", "image-references"}:
            raise ApiError("The reference collection was not found.", 404, "NOT_FOUND")
        payload = _request_json()
        current = next((item for item in app.extensions["reference_store"].list(reference_kind(collection)) if item["id"] == reference_id), None)
        if current is None:
            raise ApiError("The reference was not found.", 404, "REFERENCE_NOT_FOUND")
        title = str(payload.get("title", current["title"])).strip()
        prompt = str(payload.get("prompt", current["prompt"])).strip()
        if not title or len(title) > 200 or len(prompt) > 100_000:
            raise ApiError("The reference fields are invalid.")
        value = app.extensions["reference_store"].update(
            reference_kind(collection), reference_id, title, prompt,
            payload.get("parameters"), "parameters" in payload,
        )
        return jsonify({reference_payload_key(collection): value})

    @app.delete("/api/local/<collection>/<reference_id>")
    @session_required(csrf=True)
    def delete_reference(collection: str, reference_id: str) -> Response:
        if collection not in {"artist-threads", "image-references"}:
            raise ApiError("The reference collection was not found.", 404, "NOT_FOUND")
        if not app.extensions["reference_store"].delete(reference_kind(collection), reference_id):
            raise ApiError("The reference was not found.", 404, "REFERENCE_NOT_FOUND")
        return jsonify({"deleted": True, "id": reference_id})

    @app.post("/api/local/notes")
    @session_required(csrf=True)
    def create_note() -> tuple[Response, int]:
        """新增一条带 opaque ID 的本地笔记。"""

        note = _prepare_note(_request_json().get("note"))

        def append_note(notes: Any) -> list[Any]:
            """在 notes 集合锁内完成唯一性检查与追加。"""

            if not isinstance(notes, list):
                raise LocalStoreError("notes has an invalid shape")
            if any(isinstance(item, dict) and item.get("id") == note["id"] for item in notes):
                raise ApiError("A note with this id already exists.", 409, "NOTE_ALREADY_EXISTS")
            if any(isinstance(item, dict) and item.get("title") == note["title"] for item in notes):
                raise ApiError("A note with this title already exists.", 409, "NOTE_TITLE_EXISTS")
            notes.append(note)
            return notes

        saved_notes = app.extensions["local_store"].mutate("notes", append_note)
        _log_local_json("create", "notes", saved_notes)
        return jsonify({"note": note}), 201

    @app.put("/api/local/notes")
    @session_required(csrf=True)
    def update_note() -> Response:
        """按 ID/原标题更新笔记，或用 notes 数组事务化完整导入。"""

        payload = _request_json()
        if "notes" in payload:
            imported = payload["notes"]
            if not isinstance(imported, list):
                raise ApiError("notes must be a JSON array.")
            prepared_notes = [_prepare_note(note) for note in imported]
            note_ids = [note["id"] for note in prepared_notes]
            note_titles = [note["title"] for note in prepared_notes]
            if len(set(note_ids)) != len(note_ids):
                raise ApiError("Imported note ids must be unique.", 409, "NOTE_ALREADY_EXISTS")
            if len(set(note_titles)) != len(note_titles):
                raise ApiError("Imported note titles must be unique.", 409, "NOTE_TITLE_EXISTS")
            saved_notes = app.extensions["local_store"].write("notes", prepared_notes)
            _log_local_json("import", "notes", saved_notes)
            return jsonify({"notes": saved_notes})

        note_payload = payload.get("note")
        if not isinstance(note_payload, dict):
            raise ApiError("note must be a JSON object.")
        updated: dict[str, Any] = {}

        def replace_note(notes: Any) -> list[Any]:
            """在 notes 集合锁内查找并完整替换一条笔记。"""

            if not isinstance(notes, list):
                raise LocalStoreError("notes has an invalid shape")
            note_id = note_payload.get("id")
            if note_id is not None:
                if not isinstance(note_id, str) or not note_id.strip():
                    raise ApiError("note.id must be a non-empty string.")
                positions = [
                    index for index, existing in enumerate(notes)
                    if isinstance(existing, dict) and existing.get("id") == note_id
                ]
            else:
                original_title = payload.get("original_title")
                if not isinstance(original_title, str) or not original_title.strip():
                    raise ApiError("note.id or original_title is required.")
                positions = [
                    index for index, existing in enumerate(notes)
                    if isinstance(existing, dict) and existing.get("title") == original_title
                ]
            if not positions:
                raise ApiError("The note was not found.", 404, "NOTE_NOT_FOUND")
            if len(positions) != 1:
                raise ApiError("The note selector is ambiguous.", 409, "NOTE_AMBIGUOUS")

            position = positions[0]
            existing = notes[position]
            saved_note = _prepare_note(note_payload, existing.get("id"))
            if any(
                index != position
                and isinstance(item, dict)
                and item.get("title") == saved_note["title"]
                for index, item in enumerate(notes)
            ):
                raise ApiError("A note with this title already exists.", 409, "NOTE_TITLE_EXISTS")
            notes[position] = saved_note
            updated["note"] = saved_note
            return notes

        saved_notes = app.extensions["local_store"].mutate("notes", replace_note)
        _log_local_json("update", "notes", saved_notes)
        return jsonify({"note": updated["note"]})

    @app.delete("/api/local/notes")
    @session_required(csrf=True)
    def delete_note() -> Response:
        """优先按 ID，否则按原 UI 的唯一标题删除一条笔记。"""

        payload = _request_json()
        note_id = payload.get("id")

        def remove_note(notes: Any) -> list[Any]:
            """在 notes 集合锁内查找并删除一条笔记。"""

            if not isinstance(notes, list):
                raise LocalStoreError("notes has an invalid shape")
            if note_id is not None:
                if not isinstance(note_id, str) or not note_id.strip():
                    raise ApiError("A valid note id is required.")
                positions = [
                    index for index, item in enumerate(notes)
                    if isinstance(item, dict) and item.get("id") == note_id
                ]
            else:
                title = payload.get("title")
                if not isinstance(title, str) or not title.strip():
                    raise ApiError("A valid note id or title is required.")
                positions = [
                    index for index, item in enumerate(notes)
                    if isinstance(item, dict) and item.get("title") == title
                ]
            if not positions:
                raise ApiError("The note was not found.", 404, "NOTE_NOT_FOUND")
            if len(positions) != 1:
                raise ApiError("The note selector is ambiguous.", 409, "NOTE_AMBIGUOUS")
            return notes[:positions[0]] + notes[positions[0] + 1:]

        saved_notes = app.extensions["local_store"].mutate("notes", remove_note)
        _log_local_json("delete", "notes", saved_notes)
        return jsonify({"deleted": True})

    @app.get("/", defaults={"frontend_path": ""})
    @app.get("/<path:frontend_path>")
    def serve_frontend(frontend_path: str) -> Response | tuple[Response, int]:
        """安全提供 Next 静态导出，并为页面深链接回退到 index.html。"""

        if frontend_path == "api" or frontend_path.startswith("api/"):
            return _error_response(ApiError(
                "The API route was not found.",
                404,
                "API_ROUTE_NOT_FOUND",
            ))

        output_root = Path(app.config["FRONTEND_OUT_DIR"]).resolve()
        index_path = output_root / "index.html"
        if not index_path.is_file():
            return _error_response(ApiError(
                "The frontend static export is not available.",
                503,
                "FRONTEND_NOT_BUILT",
            ))

        candidates = []
        if frontend_path:
            candidates.extend([
                output_root / frontend_path,
                output_root / f"{frontend_path}.html",
                output_root / frontend_path / "index.html",
            ])
        else:
            candidates.append(index_path)

        for candidate in candidates:
            resolved = candidate.resolve()
            if resolved.is_relative_to(output_root) and resolved.is_file():
                return send_file(resolved, conditional=True)

        # 缺失的静态资源不能回退为 HTML，否则浏览器会把 index 当作 JS/CSS。
        if frontend_path.startswith("_next/") or Path(frontend_path).suffix:
            return _error_response(ApiError(
                "The static file was not found.",
                404,
                "STATIC_FILE_NOT_FOUND",
            ))
        return send_file(index_path, conditional=True)

    app.logger.info(
        "event=service_initialized bind=%s:%d threads=4 storage=local_json+sqlite_references "
        "frontend_built=%s upstream_host=image.novelai.net upstream_timeout_seconds=%.1f",
        app.config["HOST"],
        app.config["PORT"],
        str((Path(app.config["FRONTEND_OUT_DIR"]) / "index.html").is_file()).lower(),
        float(app.config["UPSTREAM_TIMEOUT_SECONDS"]),
    )
    return app


def main() -> None:
    """使用 Waitress 在固定 loopback 地址启动本地 API。"""

    from waitress import serve

    app = create_app()
    serve(
        app,
        host=app.config["HOST"],
        port=int(app.config["PORT"]),
        threads=4,
        clear_untrusted_proxy_headers=True,
    )


if __name__ == "__main__":
    main()
