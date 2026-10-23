"""通过真实 SDK 的 HTTP 序列化验证自定义接口，不访问外网或消耗额度。"""

import json
from pathlib import Path

import httpx
import httpx2
import pytest

from api_utils.comic_llm import COMIC_SCHEMA, EXTRACTION_SCHEMA, complete_custom_llm, validate_llm_settings
from api_utils.custom_errors import ExposableError
from app import create_app
from conftest import ORIGIN, login


def settings_for(provider, **changes):
    """提供使用第三方代理前缀的合成接口配置。"""
    return validate_llm_settings({
        "provider": provider, "baseUrl": "https://proxy.example.test/gateway/v1" if provider == "openai" else "https://proxy.example.test/gateway",
        "model": "custom-model", **changes,
    })


def sdk_response(provider, text, finish="stop"):
    """构造各官方 SDK 实际解析的响应体。"""
    if provider == "claude":
        return {"id": "message-test", "type": "message", "role": "assistant", "model": "custom-model",
                "content": [{"type": "text", "text": text}], "stop_reason": "end_turn" if finish == "stop" else finish,
                "usage": {"input_tokens": 1, "output_tokens": 1}}
    if provider == "gemini":
        return {"candidates": [{"content": {"role": "model", "parts": [{"text": "private reasoning", "thought": True}, {"text": text}]},
                                "finishReason": "STOP" if finish == "stop" else finish}]}
    return {"id": "completion-test", "object": "chat.completion", "created": 1, "model": "custom-model",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": finish}]}


def transport_response(request, status, body):
    """匹配 OpenAI/Google 的 httpx 和 Claude 的 httpx2 响应类型。"""
    transport = httpx2 if isinstance(request, httpx2.Request) else httpx
    return transport.Response(status, json=body, request=request)


@pytest.fixture(autouse=True)
def block_network(monkeypatch):
    """测试必须拦截两个 SDK 传输层，防止误发外部请求。"""
    def blocked(*args, **kwargs):
        raise AssertionError("Unexpected real SDK network call")
    monkeypatch.setattr(httpx.Client, "send", blocked)
    monkeypatch.setattr(httpx2.Client, "send", blocked)


@pytest.mark.parametrize("provider", ["openai", "claude", "gemini", "deepseek"])
def test_three_stages_use_real_sdk_custom_address_and_preserve_plan(client, fake_client, monkeypatch, provider):
    settings = settings_for(provider, storyModel="writer", extractModel="extractor", formatModel="director")
    csrf = login(client)
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    saved = client.put("/api/comic/llm-settings", json={"settings": settings, "apiKey": "test-custom-key"}, headers=headers)
    assert saved.status_code == 200
    extraction = {"visualStyle": "1.4::artist:sample::, watercolor", "characters": [{"id": "c1", "name": "旅人", "appearance": "silver hair"}]}
    draft = {"summary": "清晨重逢", "sections": [{"globalPrompt": "comic, overlapping panels", "negativePrompt": "blur",
        "panels": [{"summary": "wide shot, morning street", "instances": [
            {"characterId": "c1", "prompt": "silver hair, yellow raincoat, source#hug", "center": {"x": 0.45, "y": 0.2}},
        ], "dialogues": [{"text": "好久不见。", "sourceId": None, "speakerId": "c1", "type": "speech", "direction": "horizontal"}]}]}]}
    replies = ["清晨，旅人在街头遇见旧友，两人相拥。", json.dumps(extraction, ensure_ascii=False), json.dumps(draft, ensure_ascii=False)]
    calls = []

    def send(_client, request, **kwargs):
        calls.append((request, json.loads(request.content)))
        return transport_response(request, 200, sdk_response(provider, replies[len(calls) - 1]))

    monkeypatch.setattr(httpx.Client, "send", send)
    monkeypatch.setattr(httpx2.Client, "send", send)
    response = client.post("/api/comic/plan", headers=headers, json={
        "model": "xialong-v1", "text": "清晨重逢", "inputType": "story",
        "sections": [{"id": 0, "width": 832, "height": 1216}],
    })
    assert response.status_code == 200, response.get_json()
    plan = response.get_json()["plan"]
    assert plan["planningProvider"] == provider
    assert plan["planningModels"] == {"story": "writer", "extract": "extractor", "format": "director"}
    assert plan["storyDraft"] == replies[0]
    assert plan["visualStyle"] == extraction["visualStyle"]
    assert plan["sections"][0]["instances"][0]["center"] == {"x": 0.45, "y": 0.2}
    assert "source#hug" in plan["sections"][0]["instances"][0]["prompt"]
    assert len(calls) == 3
    assert all(call[0] != "generate" for call in fake_client.calls)
    assert "test-custom-key" not in response.get_data(as_text=True)
    for index, (request, body) in enumerate(calls):
        assert str(request.url).startswith(settings["baseUrl"] + "/")
        assert "pst-test" not in str(request.headers) + request.content.decode()
        assert "enable_thinking" not in body and "stream" not in body and "temperature" not in body
        schema = EXTRACTION_SCHEMA if index == 1 else COMIC_SCHEMA
        if provider in {"openai", "deepseek"}:
            assert request.url.path.endswith("/chat/completions")
            assert request.headers["authorization"] == "Bearer test-custom-key"
            assert body[settings["tokenParameter"]] == 8192
            if index == 0:
                assert "response_format" not in body
            elif provider == "deepseek":
                assert body["response_format"] == {"type": "json_object"}
                assert "json_schema" not in json.dumps(body)
            else:
                assert body["response_format"]["json_schema"]["schema"] == schema
        elif provider == "claude":
            assert request.url.path.endswith("/v1/messages")
            assert request.headers["x-api-key"] == "test-custom-key"
            assert body["system"] and all(message["role"] != "system" for message in body["messages"])
            if index == 0:
                assert "output_config" not in body
            else:
                assert body["output_config"]["format"]["schema"] == schema
        else:
            assert "/v1beta/models/" in request.url.path
            assert request.headers["x-goog-api-key"] == "test-custom-key"
            assert body["systemInstruction"]
            if index == 0:
                assert "responseMimeType" not in body["generationConfig"]
            else:
                assert body["generationConfig"]["responseMimeType"] == "application/json"
                assert body["generationConfig"]["responseJsonSchema"] == schema


def test_settings_keep_keys_out_of_disk_responses_logs_and_other_sessions(client, app, caplog):
    assert client.get("/api/comic/llm-settings").status_code == 401
    csrf = login(client)
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    assert client.get("/api/comic/llm-settings").get_json()["settings"]["provider"] == "novelai"
    config = settings_for("openai")
    body = {"settings": config, "apiKey": "private-test-key"}
    assert client.put("/api/comic/llm-settings", json=body, headers={"Origin": ORIGIN}).status_code == 403
    result = client.put("/api/comic/llm-settings", json=body, headers=headers)
    assert result.status_code == 200 and result.get_json()["hasApiKey"]
    assert "private-test-key" not in result.get_data(as_text=True) + caplog.text
    stored = app.extensions["local_store"].read("comic-llm")
    assert stored["providers"][-1]["settings"] == config and "private-test-key" not in json.dumps(stored)
    assert not app.extensions["comic_llm_keys"].path.exists()
    assert result.get_json()["rememberApiKey"] is False
    assert client.get("/api/comic/llm-settings").get_json()["hasApiKey"]
    with app.test_client() as other:
        login(other)
        assert other.get("/api/comic/llm-settings").get_json()["hasApiKey"] is False
    changed = {**config, "baseUrl": "https://other.example.test/v1"}
    assert not client.put("/api/comic/llm-settings", json={"settings": changed}, headers=headers).get_json()["hasApiKey"]
    assert client.put("/api/comic/llm-settings", json={"settings": config}, headers=headers).get_json()["hasApiKey"]
    assert not client.put("/api/comic/llm-settings", json={"settings": config, "clearApiKey": True}, headers=headers).get_json()["hasApiKey"]


def test_remembered_key_survives_restart_for_test_and_plan(client, app, fake_client, monkeypatch, caplog):
    headers = {"Origin": ORIGIN, "X-CSRF-Token": login(client)}
    config = settings_for("openai")
    response = client.put("/api/comic/llm-settings", json={
        "settings": config, "apiKey": "remembered-test-key", "rememberApiKey": True,
    }, headers=headers)
    assert response.status_code == 200
    assert {key: response.get_json()[key] for key in ("settings", "hasApiKey", "rememberApiKey")} == {"settings": config, "hasApiKey": True, "rememberApiKey": True}
    data_dir = Path(app.config["DATA_DIR"])
    key_files = [path.name for path in data_dir.iterdir()
                 if path.is_file() and b"remembered-test-key" in path.read_bytes()]
    assert key_files == ["comic-llm-keys.json"]
    restarted = create_app({"TESTING": True, "DATA_DIR": str(data_dir)}, novelai_client=fake_client)
    with restarted.test_client() as fresh:
        assert fresh.get("/api/comic/llm-settings").status_code == 401
        headers = {"Origin": ORIGIN, "X-CSRF-Token": login(fresh)}
        loaded = fresh.get("/api/comic/llm-settings")
        assert loaded.get_json() == response.get_json()

        def send(_client, request, **kwargs):
            assert request.headers["authorization"] == "Bearer remembered-test-key"
            return transport_response(request, 200, sdk_response("openai", '{"ok": true}'))

        monkeypatch.setattr(httpx.Client, "send", send)
        assert fresh.post("/api/comic/llm-test", json={}, headers=headers).status_code == 200

        def plan(*args, **kwargs):
            assert kwargs["llm_api_key"] == "remembered-test-key"
            return {"summary": "restarted"}

        monkeypatch.setattr("app.plan_comic", plan)
        planned = fresh.post("/api/comic/plan", json={}, headers=headers)
        assert planned.status_code == 200
        assert "remembered-test-key" not in response.get_data(as_text=True) + loaded.get_data(as_text=True) + planned.get_data(as_text=True) + caplog.text
        for changed in ({**config, "baseUrl": "https://other.example.test/v1"}, {**config, "provider": "gemini"}):
            switched = fresh.put("/api/comic/llm-settings", json={"settings": changed}, headers=headers)
            assert switched.get_json()["hasApiKey"] is False
        restored = fresh.put("/api/comic/llm-settings", json={"settings": config}, headers=headers)
        assert restored.get_json()["rememberApiKey"] is True


@pytest.mark.parametrize("clear", [False, True])
def test_forgetting_key_removes_disk_copy_and_clear_also_removes_session(client, app, fake_client, monkeypatch, clear):
    config = settings_for("openai")
    headers = {"Origin": ORIGIN, "X-CSRF-Token": login(client)}
    assert client.put("/api/comic/llm-settings", json={
        "settings": config, "apiKey": "forget-test-key", "rememberApiKey": True,
    }, headers=headers).status_code == 200
    restarted = create_app({"TESTING": True, "DATA_DIR": app.config["DATA_DIR"]}, novelai_client=fake_client)
    with restarted.test_client() as fresh:
        headers = {"Origin": ORIGIN, "X-CSRF-Token": login(fresh)}
        result = fresh.put("/api/comic/llm-settings", json={
            "settings": config, "rememberApiKey": False, "clearApiKey": clear,
        }, headers=headers)
        assert result.status_code == 200
        assert result.get_json()["rememberApiKey"] is False
        assert result.get_json()["hasApiKey"] is (not clear)

        def send(_client, request, **kwargs):
            assert not clear
            assert request.headers["authorization"] == "Bearer forget-test-key"
            return transport_response(request, 200, sdk_response("openai", '{"ok": true}'))

        monkeypatch.setattr(httpx.Client, "send", send)
        checked = fresh.post("/api/comic/llm-test", json={}, headers=headers)
        assert checked.status_code == (400 if clear else 200)
    assert all(b"forget-test-key" not in path.read_bytes()
               for path in Path(app.config["DATA_DIR"]).iterdir() if path.is_file())
    restarted_again = create_app({"TESTING": True, "DATA_DIR": app.config["DATA_DIR"]}, novelai_client=fake_client)
    with restarted_again.test_client() as fresh:
        login(fresh)
        assert fresh.get("/api/comic/llm-settings").get_json()["hasApiKey"] is False


def test_remember_existing_session_key_without_retyping(client, app):
    config = settings_for("openai")
    headers = {"Origin": ORIGIN, "X-CSRF-Token": login(client)}
    client.put("/api/comic/llm-settings", json={"settings": config, "apiKey": "session-test-key"}, headers=headers)
    response = client.put("/api/comic/llm-settings", json={"settings": config, "rememberApiKey": True}, headers=headers)
    assert response.status_code == 200 and response.get_json()["rememberApiKey"]
    assert app.extensions["comic_llm_keys"].get(config["provider"], config["baseUrl"]) == "session-test-key"


def test_named_providers_isolate_keys_select_default_and_remove_all_saved_endpoints(client, app, fake_client, monkeypatch):
    headers = {"Origin": ORIGIN, "X-CSRF-Token": login(client)}
    builtin = client.get("/api/comic/llm-settings").get_json()["configuration"]["providers"][0]
    settings = settings_for("openai")
    configuration = {"activeProviderId": "one", "providers": [builtin,
        {"id": "one", "name": "个人", "enabled": True, "settings": settings},
        {"id": "two", "name": "工作", "enabled": True, "settings": {**settings, "model": "work-model"}}]}
    result = client.put("/api/comic/llm-settings", headers=headers, json={"configuration": configuration,
        "credentials": {"one": {"apiKey": "personal-test-key", "rememberApiKey": True}, "two": {"apiKey": "work-test-key", "rememberApiKey": True}}})
    assert result.status_code == 200
    assert all(item["hasApiKey"] for item in result.get_json()["configuration"]["providers"][1:])
    calls = []

    def completion(config, key, *_args):
        calls.append((config["model"], key))
        return '{"ok": true}'

    monkeypatch.setattr("app.complete_custom_llm", completion)
    for identity in ("two", "one"):
        assert client.post("/api/comic/llm-test", headers=headers, json={"providerId": identity}).status_code == 200
    assert calls == [("work-model", "work-test-key"), ("custom-model", "personal-test-key")]
    configuration["activeProviderId"] = "two"
    configuration["providers"][1]["enabled"] = False
    assert client.put("/api/comic/llm-settings", headers=headers, json={"configuration": configuration}).status_code == 200
    # 停用项仍可测试连接，但不能成为活动 Provider。
    assert client.post("/api/comic/llm-test", headers=headers, json={"providerId": "one"}).status_code == 200
    assert client.put("/api/comic/llm-settings", headers=headers, json={"configuration": {**configuration, "activeProviderId": "one"}}).status_code == 400

    def plan(*args, **kwargs):
        assert kwargs["llm_settings"]["model"] == "work-model"
        assert kwargs["llm_api_key"] == "work-test-key"
        return {"summary": "selected work provider"}

    monkeypatch.setattr("app.plan_comic", plan)
    assert client.post("/api/comic/plan", headers=headers, json={}).status_code == 200
    configuration["providers"][2]["settings"]["baseUrl"] = "https://second.example.test/v1"
    switched = client.put("/api/comic/llm-settings", headers=headers, json={"configuration": configuration})
    assert switched.get_json()["hasApiKey"] is False
    client.put("/api/comic/llm-settings", headers=headers, json={"configuration": configuration,
        "credentials": {"two": {"apiKey": "other-work-key", "rememberApiKey": True}}})
    configuration["activeProviderId"] = "novelai"
    configuration["providers"] = configuration["providers"][:2]
    assert client.put("/api/comic/llm-settings", headers=headers, json={"configuration": configuration}).status_code == 200
    data = (Path(app.config["DATA_DIR"]) / "comic-llm-keys.json").read_text()
    assert "personal-test-key" in data and "work-test-key" not in data and "other-work-key" not in data
    restarted = create_app({"TESTING": True, "DATA_DIR": app.config["DATA_DIR"]}, novelai_client=fake_client)
    with restarted.test_client() as fresh:
        login(fresh)
        loaded = fresh.get("/api/comic/llm-settings").get_json()
        assert loaded["configuration"]["activeProviderId"] == "novelai"
        assert len(loaded["configuration"]["providers"]) == 2
        assert "personal-test-key" not in json.dumps(loaded)


def test_legacy_configuration_migrates_without_losing_remembered_key(app, fake_client):
    config = settings_for("gemini")
    app.extensions["local_store"].write("comic-llm", config)
    app.extensions["comic_llm_keys"].update({("gemini", config["baseUrl"]): "legacy-test-key"})
    restarted = create_app({"TESTING": True, "DATA_DIR": app.config["DATA_DIR"]}, novelai_client=fake_client)
    with restarted.test_client() as fresh:
        login(fresh)
        loaded = fresh.get("/api/comic/llm-settings").get_json()
        assert loaded["configuration"]["activeProviderId"] == "legacy"
        assert loaded["settings"] == config
        assert loaded["hasApiKey"] and loaded["rememberApiKey"]


def test_invalid_provider_registry_does_not_modify_saved_configuration(client, app):
    headers = {"Origin": ORIGIN, "X-CSRF-Token": login(client)}
    previous = app.extensions["local_store"].read("comic-llm")
    for configuration in ({"activeProviderId": "missing", "providers": previous["providers"]},
                          {"activeProviderId": "novelai", "providers": previous["providers"] * 2},
                          {"activeProviderId": "novelai", "providers": []}):
        assert client.put("/api/comic/llm-settings", headers=headers, json={"configuration": configuration}).status_code == 400
        assert app.extensions["local_store"].read("comic-llm") == previous


@pytest.mark.parametrize("provider,finish", [("openai", "length"), ("deepseek", "length"), ("claude", "max_tokens"), ("gemini", "MAX_TOKENS")])
def test_truncated_output_stops_without_retry(monkeypatch, provider, finish):
    calls = []

    def send(_client, request, **kwargs):
        calls.append(request)
        return transport_response(request, 200, sdk_response(provider, '{"partial":', finish))

    monkeypatch.setattr(httpx.Client, "send", send)
    monkeypatch.setattr(httpx2.Client, "send", send)
    with pytest.raises(ExposableError) as caught:
        complete_custom_llm(settings_for(provider), "test-key", {"model": "model", "messages": [{"role": "user", "content": "JSON"}]}, EXTRACTION_SCHEMA)
    assert caught.value.code == "LLM_OUTPUT_TRUNCATED"
    assert len(calls) == 1


@pytest.mark.parametrize("provider", ["openai", "claude", "gemini", "deepseek"])
def test_custom_auth_error_keeps_novelai_login_and_does_not_leak_upstream_body(client, monkeypatch, provider, caplog):
    csrf = login(client)
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    client.put("/api/comic/llm-settings", json={"settings": settings_for(provider), "apiKey": "private-test-key"}, headers=headers)
    calls = []

    def send(_client, request, **kwargs):
        calls.append(request)
        return transport_response(request, 401, {"error": {"code": 401, "type": "authentication_error", "message": "private-test-key"}})

    monkeypatch.setattr(httpx.Client, "send", send)
    monkeypatch.setattr(httpx2.Client, "send", send)
    response = client.post("/api/comic/llm-test", json={}, headers=headers)
    assert response.status_code == 502 and response.get_json()["code"] == "LLM_UNAUTHORIZED"
    assert client.get("/api/session").get_json()["authenticated"]
    assert "private-test-key" not in response.get_data(as_text=True) + caplog.text
    assert len(calls) == 1


@pytest.mark.parametrize("provider,mode", [("openai", "json"), ("openai", "prompt"), ("claude", "prompt"), ("gemini", "json"), ("gemini", "prompt")])
def test_compatibility_modes_do_not_send_schema(monkeypatch, provider, mode):
    calls = []

    def send(_client, request, **kwargs):
        calls.append(json.loads(request.content))
        return transport_response(request, 200, sdk_response(provider, '{"ok": true}'))

    monkeypatch.setattr(httpx.Client, "send", send)
    monkeypatch.setattr(httpx2.Client, "send", send)
    settings = settings_for(provider, outputMode=mode, tokenParameter="max_tokens", temperature=None if provider == "claude" else 0.5)
    result = complete_custom_llm(settings, "test-key", {"model": "model", "messages": [{"role": "user", "content": "Return JSON"}]}, EXTRACTION_SCHEMA)
    assert json.loads(result) == {"ok": True}
    assert "json_schema" not in json.dumps(calls) and "responseJsonSchema" not in json.dumps(calls)
    if provider == "openai":
        assert calls[0]["max_tokens"] == 8192 and calls[0]["temperature"] == 0.5
        assert calls[0].get("response_format") == ({"type": "json_object"} if mode == "json" else None)


@pytest.mark.parametrize("changes", [{"baseUrl": "https://user:key@example.test"}, {"baseUrl": "https://example.test?key=secret"}, {"model": ""}, {"maxTokens": 0}])
def test_invalid_configuration_fails_before_sdk(changes):
    with pytest.raises(ExposableError):
        settings_for("openai", **changes)
