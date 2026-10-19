"""验证漫画流的换行边界、连接关闭时机与可选本地诊断。"""

import json

import pytest
import requests

from api_utils.novelai_client import NovelAIClient, NovelAIUpstreamError


def response_for(body, content_type="text/event-stream; charset=utf-8"):
    """构造可被真实 Requests 接口读取的隔离响应。"""
    response = requests.Response()
    response.status_code = 200
    response.headers = {
        "Content-Type": content_type,
        "Set-Cookie": "private-response-cookie",
        "X-Private": "private-response-header",
    }
    response._content = body.encode("utf-8")
    return response


@pytest.mark.parametrize("newline", ["\n", "\r\n", "\r"])
def test_sse_bom_and_unicode_text_are_not_protocol_line_breaks(newline, monkeypatch):
    monkeypatch.delenv("NAI_COMIC_RESPONSE_DIAGNOSTIC_DIR", raising=False)
    text = "第一段\u2028第二段\u0085第三段\u2029结束"
    body = "\ufeffdata: " + json.dumps({"choices": [{"delta": {"content": text}}]}, ensure_ascii=False)
    body += newline * 2 + "data: [DONE]" + newline * 2
    client = NovelAIClient(request_func=lambda *args, **kwargs: response_for(body))

    assert client.chat_completion("private-token", {"messages": []}) == text


def test_requests_consumes_sse_before_tls_session_closes(monkeypatch):
    monkeypatch.delenv("NAI_COMIC_RESPONSE_DIAGNOSTIC_DIR", raising=False)
    body = 'data: {"choices":[{"delta":{"content":"漫画正文"}}]}\n\ndata: [DONE]\n\n'.encode()
    events = []
    original_close = requests.Session.close

    class RawBody:
        """分块返回响应，确认消费时连接池仍然存活。"""

        def stream(self, chunk_size, decode_content=True):
            assert "closed" not in events
            events.append("body")
            yield body[:49]
            yield body[49:]

    def send(adapter, request, stream=False, **kwargs):
        assert stream is False
        response = requests.Response()
        response.status_code = 200
        response.headers["Content-Type"] = "text/event-stream"
        response.raw = RawBody()
        return response

    def close(session):
        events.append("closed")
        original_close(session)

    monkeypatch.setattr(requests.adapters.HTTPAdapter, "send", send)
    monkeypatch.setattr(requests.Session, "close", close)

    assert NovelAIClient().chat_completion("private-token", {"messages": []}) == "漫画正文"
    assert events == ["body", "closed"]


@pytest.mark.parametrize("thinking", [None, False, True])
def test_thinking_option_is_preserved_without_mixing_reasoning_into_final_json(thinking, monkeypatch, caplog):
    monkeypatch.delenv("NAI_COMIC_RESPONSE_DIAGNOSTIC_DIR", raising=False)
    chunks = [
        {"choices": [{"delta": {"reasoning_content": "private-thought", "content": None}}]},
        {"choices": [{"delta": {"reasoning_content": "private-thought"}}]},
        {"choices": [{"delta": {"content": '{"version":'}}]},
        {"choices": [{"delta": {"content": '1}'}, "finish_reason": "stop"}]},
    ]
    body = "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks) + "data: [DONE]\n\n"
    sent = []

    def transport(*args, **kwargs):
        sent.append(kwargs["json"])
        return response_for(body)

    payload = {"messages": []}
    if thinking is not None:
        payload["enable_thinking"] = thinking
    text = NovelAIClient(request_func=transport).chat_completion("private-token", payload)

    assert text == '{"version":1}'
    assert json.loads(text) == {"version": 1}
    assert len(sent) == 1
    assert sent[0]["enable_thinking"] is (thinking is True)
    assert "private-thought" not in caplog.text


def test_http_200_stream_with_observed_trailing_timeout_json_is_not_completion(monkeypatch, caplog):
    monkeypatch.delenv("NAI_COMIC_RESPONSE_DIAGNOSTIC_DIR", raising=False)
    body = 'data: {"choices":[{"delta":{"reasoning_content":"private-thought"}}]}\n\n'
    body += '{"statusCode":504,"message":"Timeout error."}'
    calls = []

    def transport(*args, **kwargs):
        calls.append(1)
        return response_for(body)

    client = NovelAIClient(request_func=transport)
    with pytest.raises(NovelAIUpstreamError) as failure:
        client.chat_completion("private-token", {"messages": [], "enable_thinking": True})

    assert failure.value.code == "NOVELAI_TIMEOUT"
    assert failure.value.status_code == 504
    assert "编排超时" in str(failure.value)
    assert "重新编排" in str(failure.value)
    assert len(calls) == 1
    assert "Timeout error." not in str(failure.value)
    assert "Timeout error." not in caplog.text
    assert "private-thought" not in caplog.text


@pytest.mark.parametrize(("body", "code"), [
    ('data: {"choices":[{"delta":{"content":"private-output"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', None),
    ('data: {"choices":[{"delta":{"content":"private-output"},"token_ids":[101,102]}]}\n\n', "COMIC_PLAN_INCOMPLETE"),
    ('data: invalid-private-output\n\n', "COMIC_PLAN_INVALID_RESPONSE"),
])
def test_enabled_diagnostic_saves_actual_request_response_and_partial_text_without_credentials(body, code, tmp_path, monkeypatch, caplog):
    diagnostic_dir = tmp_path / "diagnostics"
    monkeypatch.setenv("NAI_COMIC_RESPONSE_DIAGNOSTIC_DIR", str(diagnostic_dir))
    sent = []

    def transport(*args, **kwargs):
        request_file = next(diagnostic_dir.glob("*.request.json"))
        # 在传输调用开始前就应存在，且保存的正文与这次实际交给 Requests 的对象一致。
        assert json.loads(request_file.read_text(encoding="utf-8")) == kwargs["json"]
        sent.append(kwargs["json"])
        return response_for(body)

    payload = {"model": "glm-4-6", "max_tokens": 8192, "enable_thinking": True, "messages": [
        {"role": "system", "content": "private-system\n保留原文。"},
        {"role": "user", "content": "example-input"},
        {"role": "assistant", "content": "example-output"},
        {"role": "user", "content": "private-prompt\r\n保留换行。"},
    ]}
    client = NovelAIClient(request_func=transport)

    if code:
        with pytest.raises(NovelAIUpstreamError) as failure:
            client.chat_completion("private-token", payload, "../private-id")
        assert failure.value.code == code
    else:
        assert client.chat_completion("private-token", payload, "../private-id") == "private-output"

    files = list(diagnostic_dir.iterdir())
    assert len(files) == 5
    assert all(path.name.startswith("comic-response---") for path in files)
    raw = next(path for path in files if path.suffix == ".bin")
    metadata = raw.with_suffix(".json")
    assert raw.read_bytes() == body.encode("utf-8")
    assert raw.with_suffix(".response.txt").read_bytes() == raw.read_bytes()
    assert len(sent) == 1
    assert json.loads(raw.with_suffix(".request.json").read_text(encoding="utf-8")) == {**payload, "stream": True}
    expected_text = "" if code == "COMIC_PLAN_INVALID_RESPONSE" else "private-output"
    assert raw.with_suffix(".text.txt").read_bytes() == expected_text.encode("utf-8")
    saved = json.loads(metadata.read_text(encoding="utf-8"))
    assert saved["correlation_id"] == "-"
    assert saved["shape"]["content_type"] == "text/event-stream"
    assert saved["shape"]["body_bytes"] == len(body.encode("utf-8"))
    assert saved["shape"]["error_code"] == code
    assert saved["shape"]["content_status"] == ("complete" if code is None else "partial" if expected_text else "empty")
    if code == "COMIC_PLAN_INCOMPLETE":
        assert saved["shape"]["token_id_count"] == 2
        assert saved["shape"]["text_length"] == 14
        assert saved["shape"]["done"] is False
        assert saved["shape"]["finish_reason"] is None
    for secret in ("private-token", "private-prompt", "private-output", "private-id", "private-response-cookie", "private-response-header"):
        assert secret not in metadata.read_text(encoding="utf-8")
        assert secret not in caplog.text
    for path in files:
        assert all(secret not in path.read_text(encoding="utf-8") for secret in ("private-token", "private-response-cookie", "private-response-header"))


def test_http_rejection_diagnostic_preserves_raw_body_and_original_error_mapping(tmp_path, monkeypatch, caplog):
    monkeypatch.setenv("NAI_COMIC_RESPONSE_DIAGNOSTIC_DIR", str(tmp_path))
    body = '{"statusCode":400,"message":"private-upstream-reason：参数被拒绝。"}\r\n'
    calls = []

    def transport(*args, **kwargs):
        calls.append(kwargs["json"])
        response = response_for(body, "application/json; charset=utf-8")
        response.status_code = 400
        return response

    with pytest.raises(NovelAIUpstreamError) as failure:
        NovelAIClient(request_func=transport).chat_completion("private-token", {"messages": []}, "case-story")

    assert failure.value.code == "NOVELAI_REQUEST_REJECTED"
    assert failure.value.status_code == 400
    assert str(failure.value) == "NovelAI rejected the request."
    assert len(calls) == 1
    files = list(tmp_path.iterdir())
    assert len(files) == 5
    raw = next(tmp_path.glob("comic-response-case-story-*.bin"))
    assert raw.read_bytes() == body.encode("utf-8")
    assert raw.with_suffix(".response.txt").read_bytes() == raw.read_bytes()
    assert raw.with_suffix(".text.txt").read_bytes() == b""
    assert json.loads(raw.with_suffix(".request.json").read_text(encoding="utf-8")) == calls[0]
    saved = json.loads(raw.with_suffix(".json").read_text(encoding="utf-8"))
    assert saved["correlation_id"] == "case-story"
    assert saved["shape"] == {
        "status_code": 400, "content_type": "application/json", "body_bytes": len(body.encode("utf-8")),
        "error_code": "NOVELAI_REQUEST_REJECTED", "content_status": "empty",
    }
    for path in files:
        assert all(secret not in path.read_text(encoding="utf-8") for secret in ("private-token", "private-response-cookie", "private-response-header"))
    assert "private-upstream-reason" not in caplog.text


def test_stage_correlation_suffix_is_local_only_for_actual_session_headers(monkeypatch, tmp_path):
    monkeypatch.setenv("NAI_COMIC_RESPONSE_DIAGNOSTIC_DIR", str(tmp_path))
    sent_ids = []

    def send(adapter, request, **kwargs):
        sent_ids.append(request.headers["X-Correlation-ID"])
        return response_for('data: {"choices":[{"text":"complete","finish_reason":"stop"}]}\n\n')

    monkeypatch.setattr(requests.adapters.HTTPAdapter, "send", send)
    client = NovelAIClient()
    for stage in ("story", "format"):
        assert client.chat_completion("private-token", {"messages": []}, f"Ab12Cd-{stage}") == "complete"
        raw = next(tmp_path.glob(f"comic-response-Ab12Cd-{stage}-*.bin"))
        saved = json.loads(raw.with_suffix(".json").read_text(encoding="utf-8"))
        assert saved["correlation_id"] == f"Ab12Cd-{stage}"
    assert sent_ids == ["Ab12Cd", "Ab12Cd"]
    assert all(len(value) == 6 and value.isascii() and value.isalnum() for value in sent_ids)


def test_diagnostic_is_off_by_default_and_write_failure_does_not_lose_result(monkeypatch, tmp_path, caplog):
    from pathlib import Path

    monkeypatch.delenv("NAI_COMIC_RESPONSE_DIAGNOSTIC_DIR", raising=False)
    body = 'data: {"choices":[{"text":"complete","finish_reason":"stop"}]}\n\n'
    writes = []

    def write_failure(path, data):
        writes.append(path)
        raise OSError("private-path-information")

    monkeypatch.setattr(Path, "write_bytes", write_failure)
    client = NovelAIClient(request_func=lambda *args, **kwargs: response_for(body))
    assert client.chat_completion("private-token", {"messages": []}) == "complete"
    assert writes == []

    monkeypatch.setenv("NAI_COMIC_RESPONSE_DIAGNOSTIC_DIR", str(tmp_path))
    assert client.chat_completion("private-token", {"messages": []}) == "complete"
    assert len(writes) == 1
    assert "event=novelai_chat_diagnostic_failed stage=body" in caplog.text
    assert "private-path-information" not in caplog.text
