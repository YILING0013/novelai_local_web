"""验证官方英文联想、本地中文补充以及原有本机会话边界。"""

import pytest

from api_utils.novelai_client import NovelAIUpstreamError
from conftest import ORIGIN, login


def test_chinese_search_and_exact_translation_stay_local(client, fake_client):
    csrf = login(client)
    response = client.get("/api/suggest-tags", query_string={"prompt": "长发"})
    assert response.status_code == 200
    assert response.json["upstream_status"] == "not_requested"
    assert next(tag for tag in response.json["tags"] if tag["name"] == "long_hair")["translation"] == "长发"
    assert not any(call[0] == "tags" for call in fake_client.calls)
    translated = client.post("/api/translate-tags", json={"tags": [" LONG_HAIR ", "long  hair", "blue_eyes", "longhair"]},
                             headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert translated.json == {"translations": {"long hair": "长发", "blue eyes": "蓝瞳"}}


def test_official_english_suggestions_keep_order_and_receive_local_translations(client, fake_client, monkeypatch):
    login(client)
    captured = []

    def suggest(token, params):
        captured.append(params)
        return {"tags": [{"tag": "Long Hair", "confidence": 0.9}, {"tag": "long_hair", "confidence": 0.8}]}

    monkeypatch.setattr(fake_client, "suggest_tags", suggest)
    response = client.get("/api/suggest-tags", query_string={"prompt": "LONG__HAIR", "model": "nai-diffusion-5-full"})
    assert response.status_code == 200
    assert captured == [{"prompt": "long hair", "model": "nai-diffusion-5-full"}]
    assert response.json["upstream_status"] == "ok"
    assert response.json["tags"][0]["name"] == "Long Hair"
    assert response.json["tags"][0]["translation"] == "长发"
    assert response.json["tags"][0]["source"] == "upstream"
    assert any(tag["source"] == "local" for tag in response.json["tags"])
    assert sum(tag["name"].lower().replace("_", " ") == "long hair" for tag in response.json["tags"]) == 1


def test_official_failure_returns_local_suggestions_without_logging_prompt(client, fake_client, monkeypatch, caplog):
    login(client)

    def unavailable(token, params):
        raise NovelAIUpstreamError("private upstream body", 502, "NOVELAI_NETWORK_ERROR")

    monkeypatch.setattr(fake_client, "suggest_tags", unavailable)
    response = client.get("/api/suggest-tags", query_string={"prompt": "long_hair"})
    assert response.status_code == 200
    assert response.json["upstream_status"] == "unavailable"
    assert response.json["tags"][0]["translation"] == "长发"
    assert "tag_suggestion_upstream_failed" in caplog.text
    assert "private upstream body" not in caplog.text
    assert "long_hair" not in caplog.text


@pytest.mark.parametrize("payload", [{"tags": "long_hair"}, {"tags": [1]}, {"tags": ["a"] * 1001}, {"tags": ["a" * 501]}])
def test_translation_rejects_invalid_batches(client, payload):
    csrf = login(client)
    response = client.post("/api/translate-tags", json=payload, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert response.status_code == 400


def test_new_routes_keep_session_and_csrf_checks(client):
    assert client.get("/api/suggest-tags?prompt=长发").status_code == 401
    login(client)
    assert client.post("/api/translate-tags", json={"tags": []}, headers={"Origin": ORIGIN}).status_code == 403
    assert client.post("/api/image-tools/estimate", json={}, headers={"Origin": ORIGIN}).status_code == 403
