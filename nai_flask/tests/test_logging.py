import logging

import pytest

from api_utils.novelai_client import NovelAIClient, NovelAIUpstreamError
from app import create_app
from conftest import ORIGIN, login


class LoggingResponse:
    """提供日志契约测试所需的最小 requests 响应。"""

    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload
        self.content = b""
        self.headers = {}

    def json(self):
        """返回测试响应对象，内容不应进入运行日志。"""

        return self._payload


def _generation_body(batch_id: str) -> dict:
    """构造批次日志测试使用的最小 NovelAI 生成参数。"""

    return {
        "batch_id": batch_id,
        "index": 0,
        "batch_size": 1,
        "model": "nai-diffusion-4-5-full",
        "positivePrompt": "private-prompt-body",
        "negativePrompt": "",
        "width": 512,
        "height": 512,
        "steps": 20,
        "n_samples": 1,
        "seed": 123,
    }


def test_startup_and_waitress_logging_are_visible_without_depth_one_noise(
    caplog,
    tmp_path,
    fake_client,
):
    caplog.set_level(logging.INFO)
    create_app(
        {"TESTING": True, "DATA_DIR": str(tmp_path / "logging-data")},
        novelai_client=fake_client,
    )

    queue_logger = logging.getLogger("waitress.queue")
    queue_logger.warning("Task queue depth is 1")
    queue_logger.warning("Task queue depth is 2")

    text = caplog.text
    assert "event=service_initialized bind=127.0.0.1:5000 threads=4" in text
    assert "storage=local_json" in text
    assert "upstream_host=image.novelai.net" in text
    assert "Task queue depth is 1" not in text
    assert "Task queue depth is 2" in text


def test_api_account_and_local_json_logs_have_safe_controlled_fields(
    caplog,
    client,
):
    caplog.set_level(logging.INFO)
    caplog.clear()
    token = "pst-private-token-value-that-must-never-be-logged"
    password = "private-password-value"
    email = "private-owner@example.com"

    token_login = client.post(
        "/api/session/persistent-token",
        json={"token": token},
        headers={"Origin": ORIGIN},
    )
    assert token_login.status_code == 200
    password_login = client.post(
        "/api/session/password",
        json={"email": email, "password": password},
        headers={"Origin": ORIGIN},
    )
    assert password_login.status_code == 200
    csrf = password_login.get_json()["csrf_token"]
    session_cookie = client.get_cookie("nai_local_session").value

    assert client.get("/api/account").status_code == 200
    saved = client.put(
        "/api/local/settings",
        json={"settings": {"draft": "private-local-json-value"}},
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )
    assert saved.status_code == 200

    text = caplog.text
    assert "event=api_request_start method=POST route=/api/session/password" in text
    assert "event=api_request_complete method=GET route=/api/account status=200" in text
    assert "authenticated=true login_mode=password" in text
    assert "event=account_refresh result=success stale=false login_mode=password" in text
    assert "event=local_json operation=write collection=settings item_count=1" in text
    assert "elapsed_ms=" in text
    assert "correlation_id=" in text
    for sensitive_value in (
        token,
        password,
        email,
        csrf,
        session_cookie,
        "pst-password",
        "private-local-json-value",
    ):
        assert sensitive_value not in text


def test_batch_and_stable_error_logs_do_not_record_batch_id_or_prompt(
    caplog,
    client,
    fake_client,
):
    caplog.set_level(logging.INFO)
    caplog.clear()
    csrf = login(client, "pst-batch-secret-token")

    success = client.post(
        "/api/images/generate",
        json=_generation_body("private-success-batch-id"),
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )
    assert success.status_code == 200

    fake_client.fail_next_generate = True
    failed = client.post(
        "/api/images/generate",
        json=_generation_body("private-failed-batch-id"),
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )
    assert failed.status_code == 502

    text = caplog.text
    assert "event=image_batch_start operation=generate batched=true index=0 batch_size=1" in text
    assert "event=image_batch_result operation=generate result=success" in text
    assert "terminal=completed" in text
    assert "event=image_batch_result operation=generate result=failed" in text
    assert "error_code=TEST_FAILURE certain=false" in text
    assert "route=/api/images/generate status=502" in text
    assert "private-success-batch-id" not in text
    assert "private-failed-batch-id" not in text
    assert "private-prompt-body" not in text
    assert "pst-batch-secret-token" not in text


def test_official_request_logs_only_operation_host_status_and_timing(caplog):
    caplog.set_level(logging.INFO)
    caplog.clear()
    responses = iter([
        LoggingResponse(200, {"tags": []}),
        LoggingResponse(400, {"message": "private-official-response"}),
        LoggingResponse(200, {"accessToken": "private-new-token"}),
    ])
    client = NovelAIClient(request_func=lambda *args, **kwargs: next(responses))

    assert client.suggest_tags(
        "private-authorization-token",
        {"prompt": "private-tag-prompt"},
    ) == {"tags": []}
    with pytest.raises(NovelAIUpstreamError):
        client.generate_image(
            "private-authorization-token",
            {"prompt": "private-generation-prompt", "image": "private-image-base64"},
            "unsafe\ncorrelation",
        )
    assert client.change_access_key(
        "private-current-access-key",
        "private-new-access-key",
        "private-current-token",
        "private-new-email@example.com",
    ) == "private-new-token"

    text = caplog.text
    assert "event=novelai_request_start operation=suggest_tags method=GET host=image.novelai.net" in text
    assert "event=novelai_request_complete operation=generate_image" in text
    assert "status=400 result=rejected" in text
    assert "event=novelai_request_complete operation=change_access_key" in text
    assert "status=200 result=success" in text
    assert "elapsed_ms=" in text
    for sensitive_value in (
        "private-authorization-token",
        "private-tag-prompt",
        "private-official-response",
        "private-generation-prompt",
        "private-image-base64",
        "unsafe\ncorrelation",
        "private-current-access-key",
        "private-new-access-key",
        "private-current-token",
        "private-new-email@example.com",
        "private-new-token",
        "Authorization",
    ):
        assert sensitive_value not in text


def test_unexpected_error_keeps_safe_traceback_without_exception_message(
    caplog,
    client,
):
    caplog.set_level(logging.INFO)
    caplog.clear()
    csrf = login(client)
    secret = "private-exception-message"

    class ExplodingStore:
        def read(self, name):
            raise RuntimeError(secret)

    client.application.extensions["local_store"] = ExplodingStore()
    response = client.get(
        "/api/local/settings",
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )

    assert response.status_code == 500
    assert response.get_json()["code"] == "INTERNAL_ERROR"
    text = caplog.text
    assert "event=unhandled_api_error error_type=RuntimeError traceback=" in text
    assert "test_logging.py" in text
    assert "error_code=INTERNAL_ERROR certain=false" in text
    assert secret not in text
