import json

import pytest

from api_utils.novelai_client import NovelAIClient
from conftest import ORIGIN, login


@pytest.fixture
def comic_data():
    """提供路由验收需要的最小完整剧情和模型计划。"""
    source = {
        "inputType": "story", "text": "旅人在清晨挥手告别。", "style": "黑白漫画",
        "language": "zh", "readingDirection": "ltr", "characters": "短发旅人",
        "sections": [{"id": 0, "width": 832, "height": 1216, "referencePanels": [
            {"id": "p1", "number": 1, "center": {"x": 0.5, "y": 0.5}, "width": 1, "height": 1},
        ]}],
    }
    plan = {
        "summary": "清晨告别。",
        "characters": [{"id": "c1", "name": "旅人", "appearance": "short hair"}],
        "sections": [{
            "globalPrompt": "comic, morning street", "negativePrompt": "blurry",
            "panels": [{
                "summary": "挥手。", "bounds": {"x": 0, "y": 0, "width": 1, "height": 1},
                "instances": [{"characterId": "c1", "prompt": "short hair, waving, speech bubble", "negativePrompt": "", "center": {"x": 0.5, "y": 0.5}}],
                "dialogues": [{"speakerId": "c1", "text": "再见。", "type": "speech", "direction": "horizontal"}],
            }],
        }],
    }
    return source, plan


@pytest.mark.parametrize(("tier", "story_model"), [(2, "glm-4-6"), (3, "xialong-v1")])
def test_comic_plan_requires_login_and_csrf_then_returns_complete_contract(client, fake_client, monkeypatch, comic_data, tier, story_model):
    source, plan = comic_data
    story_draft = "清晨的街道上，短发旅人停下脚步，回身挥手。对方点头回应，两人带着约定分别。"
    extracted = {"visualStyle": "黑白漫画", "characters": plan["characters"]}
    calls = []
    account_snapshot = fake_client.account_snapshot

    def subscribed_snapshot(token):
        snapshot = account_snapshot(token)
        snapshot["subscription"].update(tier=tier, active=True)
        return snapshot

    def completion(token, body, correlation_id):
        calls.append((token, body, correlation_id))
        return [story_draft, json.dumps(extracted, ensure_ascii=False), json.dumps(plan, ensure_ascii=False)][len(calls) - 1]

    monkeypatch.setattr(fake_client, "account_snapshot", subscribed_snapshot)
    monkeypatch.setattr(fake_client, "chat_completion", completion, raising=False)
    unauthorized = client.post("/api/comic/plan", json=source, headers={"Origin": ORIGIN})
    assert unauthorized.status_code == 401
    assert unauthorized.get_json()["code"] == "AUTH_REQUIRED"
    csrf = login(client)
    no_csrf = client.post("/api/comic/plan", json=source, headers={"Origin": ORIGIN})
    assert no_csrf.status_code == 403
    assert no_csrf.get_json()["code"] == "CSRF_INVALID"
    assert calls == []

    result = client.post("/api/comic/plan", json=source, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert result.status_code == 200
    actual = result.get_json()["plan"]
    assert actual["version"] == 1
    assert actual["summary"] == plan["summary"]
    assert actual["storyDraft"] == story_draft
    assert actual["planningModels"] == {"story": story_model, "extract": "glm-4-6", "format": "glm-4-6"}
    assert actual["visualStyle"] == extracted["visualStyle"]
    assert actual["characters"] == extracted["characters"]
    section = actual["sections"][0]
    assert section["characterPromptsComplete"] is True
    assert (section["id"], section["width"], section["height"]) == (0, 832, 1216)
    assert section["panels"] == [{
        "id": "p1", "number": 1, "summary": "挥手。",
        "bounds": {"x": 0, "y": 0, "width": 1, "height": 1},
    }]
    assert section["instances"][0]["prompt"] == "panel 1, short hair, waving, speech bubble"
    assert section["instances"][0]["panelId"] == section["dialogues"][0]["panelId"] == "p1"
    correlation_id = result.get_json()["correlation_id"]
    assert [call[2] for call in calls] == [f"{correlation_id}-story", f"{correlation_id}-extract", f"{correlation_id}-format"]
    assert all(call[0] == "pst-test" for call in calls)
    assert [call[1]["model"] for call in calls] == [story_model, "glm-4-6", "glm-4-6"]
    assert story_draft in calls[1][1]["messages"][-1]["content"]
    assert len(calls) == 3
    assert "pst-test" not in result.get_data(as_text=True)
    assert all(call[0] != "generate" for call in fake_client.calls)


@pytest.mark.parametrize("changes,status,code", [
    ({"text": ""}, 400, "COMIC_PLAN_INVALID"),
    ({"model": "xialong-v1"}, 403, "COMIC_MODEL_FORBIDDEN"),
])
def test_comic_plan_rejects_invalid_input_and_model_permissions_before_upstream(client, fake_client, monkeypatch, comic_data, changes, status, code):
    source, _ = comic_data
    calls = []
    monkeypatch.setattr(fake_client, "chat_completion", lambda *args: calls.append(args), raising=False)
    csrf = login(client)
    response = client.post("/api/comic/plan", json={**source, **changes}, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert response.status_code == status
    assert response.get_json()["code"] == code
    assert calls == []


@pytest.mark.parametrize("failure,status,code", [
    ("length", 502, "COMIC_PLAN_TRUNCATED"),
    ("json", 502, "COMIC_PLAN_INVALID_JSON"),
    ("unauthorized", 401, "NOVELAI_UNAUTHORIZED"),
    ("rate_limit", 429, "NOVELAI_RATE_LIMITED"),
])
def test_comic_plan_upstream_errors_are_explicit_and_only_401_clears_session(client, fake_client, monkeypatch, comic_data, failure, status, code):
    source, plan = comic_data
    calls = []

    class Response:
        status_code = 401 if failure == "unauthorized" else 429 if failure == "rate_limit" else 200
        content = b""
        headers = {"Content-Type": "application/json"}

        def __init__(self, stage):
            self.stage = stage

        def json(self):
            text = "旅人在清晨挥手告别，约定下次再见。" if self.stage == 1 else "{" if failure == "json" else json.dumps(plan)
            return {"choices": [{"text": text, "finish_reason": "length" if failure == "length" else "stop"}]}

    def transport(*args, **kwargs):
        calls.append((args, kwargs))
        return Response(len(calls))

    official = NovelAIClient(request_func=transport)
    monkeypatch.setattr(fake_client, "chat_completion", official.chat_completion, raising=False)
    csrf = login(client)
    response = client.post("/api/comic/plan", json=source, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert response.status_code == status
    assert response.get_json()["code"] == code
    assert len(calls) == (2 if failure == "json" else 1)
    assert client.get("/api/session").get_json()["authenticated"] is (failure != "unauthorized")
