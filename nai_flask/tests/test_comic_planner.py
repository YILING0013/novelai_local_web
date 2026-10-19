import json

import pytest

from api_utils.comic_planner import ComicPlanError, compile_comic_plan, plan_comic, prepare_comic_request, validate_comic_plan
from api_utils.novelai_client import NovelAIClient, NovelAIUpstreamError


OPUS = {"tier": 3, "active": True}
NATIVE_COMIC_PROMPT = r"""1.05::artist:hanekoto::, 0.95::artist:saya (mychristian2)::, 0.65::artist:sora 72-iro::, artist:kudo eru, 1.3::artist:freng::, 0.37::toosaka asagi::, 1.75::artist:guchico::, 1girl, 1boy, 4koma, horizontal split screen, comic, 4::greyscale, flat color::, comic title "세리나의 귀청소", very aesthetic, masterpiece, no text, teXt: 세리나의 귀청소

부탁할게\n세리나!

귀청소를\n해달라고요?

우오오\n왕도적인\n무릎베개!

후훗, 왠지 긴장되네요.

깨어있는 상태의 선생님에게 귀청소라니 어쩐지 신기하네요

움직이지 마세요~

그럼 시작할게요~

그럼 자고 있을 때 -"""


def sample_request(two_sections=False):
    """创建已有分镜中心的单区或双区输入。"""
    return {
        "inputType": "story", "text": "两人在雨后重逢，一人说：好久不见。", "style": "黑白漫画",
        "language": "zh", "readingDirection": "ltr", "characters": "林，短发；叶，长发。",
        "sections": [{
            "id": index, "width": 1216 if two_sections else 832, "height": 832 if two_sections else 1216,
            "referencePanels": [
                {"id": "p1", "number": 1, "center": {"x": 0.5, "y": 0.25}, "width": 0.8, "height": 0.4},
                {"id": "p2", "number": 2, "center": {"x": 0.5, "y": 0.75}, "width": 0.8, "height": 0.4},
            ],
        } for index in range(2 if two_sections else 1)],
    }


def sample_plan(source):
    """创建同格两人、下一格单人的完整模型计划。"""
    return {
        "version": 1, "summary": "雨后重逢。",
        "characters": [{"id": "c1", "name": "林", "appearance": "short hair"}, {"id": "c2", "name": "叶", "appearance": "long hair"}],
        "sections": [{
            "id": section["id"], "width": section["width"], "height": section["height"],
            "globalPrompt": "black and white comic, 2 panels, rainy street", "negativePrompt": "logo",
            "panels": [{"id": "p1", "number": 1, "summary": "双人远景。"}, {"id": "p2", "number": 2, "summary": "近景对白。"}],
            "instances": [
                {"id": "i1", "panelId": "p1", "characterId": "c1", "prompt": "panel 1, short hair", "negativePrompt": "", "center": {"x": 0.1, "y": 0.1}},
                {"id": "i2", "panelId": "p1", "characterId": "c2", "prompt": "panel 1, long hair", "negativePrompt": "", "center": {"x": 0.9, "y": 0.9}},
                {"id": "i3", "panelId": "p2", "characterId": "c1", "prompt": "panel 2, short hair, speech bubble", "negativePrompt": "", "center": {"x": 0.2, "y": 0.8}},
            ],
            "dialogues": [{"id": "d1", "panelId": "p2", "speakerId": "c1", "text": "好久不见。", "type": "speech", "order": 1, "direction": "horizontal"}],
        } for section in source["sections"]],
    }


class Response:
    """提供不访问网络的官方 JSON 响应。"""
    status_code = 200
    content = b""
    headers = {"Content-Type": "application/json"}

    def __init__(self, payload=None, body=None):
        self.payload = payload
        if body is not None:
            self.content = body.encode("utf-8")
            self.headers = {"Content-Type": "text/event-stream; charset=utf-8"}

    def json(self):
        return self.payload


def sample_draft(source):
    """将通用测试故事表示为模型负责的嵌套分镜格式。"""
    flat = sample_plan(source)
    draft = {
        "summary": flat["summary"], "characters": flat["characters"],
        "sections": [{
            "globalPrompt": section["globalPrompt"], "negativePrompt": section["negativePrompt"],
            "panels": [{
                "summary": panel["summary"],
                "bounds": {"x": 0, "y": index * 0.5, "width": 1, "height": 0.5},
                "instances": [{
                    key: item[key] for key in ("characterId", "prompt", "negativePrompt", "center")
                } for item in section["instances"] if item["panelId"] == panel["id"]],
                "dialogues": [{
                    key: item[key] for key in ("speakerId", "text", "type", "direction")
                } for item in section["dialogues"] if item["panelId"] == panel["id"]],
            } for index, panel in enumerate(section["panels"])],
        } for section in flat["sections"]],
    }
    return draft


@pytest.mark.parametrize(("section_ids", "has_references"), [([0], False), ([1], False), ([0, 1], False), ([0], True)])
def test_output_contract_is_derived_from_sections_and_uses_whole_image_coordinates(section_ids, has_references):
    source = sample_request(two_sections=len(section_ids) == 2)
    for section, section_id in zip(source["sections"], section_ids):
        section["id"] = section_id
        if not has_references:
            section["referencePanels"] = []
    request, normalized = prepare_comic_request(source, OPUS)
    instruction = request["messages"][0]["content"]
    expected_sections = [{key: section[key] for key in ("id", "width", "height")} for section in normalized["sections"]]
    assert f"本次生成{len(section_ids)}个区域" in instruction
    result = validate_comic_plan(compile_comic_plan(sample_draft(source), normalized), normalized)
    assert [{key: section[key] for key in ("id", "width", "height")} for section in result["sections"]] == expected_sections
    if len(section_ids) == 1:
        prepare_comic_request(source, {"tier": 1, "active": True})
    assert json.loads(request["messages"][1]["content"])["story"] == source["text"]


@pytest.mark.parametrize("panel_count", [4, 9])
def test_native_prompt_without_references_keeps_original_text_at_story_chosen_count(panel_count):
    source = sample_request()
    source.update(inputType="prompt", text=NATIVE_COMIC_PROMPT, style="", characters="")
    source["sections"][0]["referencePanels"] = []
    _, normalized = prepare_comic_request(source, OPUS)
    output = sample_plan(source)
    section = output["sections"][0]
    section["globalPrompt"] = (
        NATIVE_COMIC_PROMPT.split(", 1girl", 1)[0]
        + f", {panel_count} panels, comic, 4::greyscale, flat color::, very aesthetic, masterpiece"
    )
    section["panels"] = [{"id": f"p{number}", "number": number, "summary": "故事发展。"} for number in range(1, panel_count + 1)]
    section["instances"] = [{
        "id": f"i{number}", "panelId": f"p{number}", "characterId": "c1",
        "prompt": f"panel {number}, close-up, speech bubble", "negativePrompt": "",
        "center": {"x": 0.5, "y": (number - 0.5) / panel_count},
    } for number in range(1, panel_count + 1)]
    words = (
        "세리나의 귀청소", "부탁할게\n세리나!", "귀청소를\n해달라고요?", "우오오\n왕도적인\n무릎베개!",
        "후훗, 왠지 긴장되네요.", "깨어있는 상태의 선생님에게 귀청소라니 어쩐지 신기하네요",
        "움직이지 마세요~", "그럼 시작할게요~", "그럼 자고 있을 때 -",
    )
    section["dialogues"] = [{
        "id": f"d{index}", "panelId": f"p{min(index + 1, panel_count)}",
        "speakerId": None if index == 0 else "c1", "text": words[index],
        "type": "narration" if index == 0 else "speech", "order": index + 1, "direction": "horizontal",
    } for index in range(len(words))]
    validated = validate_comic_plan(output, normalized)["sections"][0]
    assert len(validated["panels"]) == panel_count
    assert tuple(dialogue["text"] for dialogue in validated["dialogues"]) == words
    assert validated["dialogues"][0]["type"] == "narration"
    assert "세리나의 귀청소" not in validated["globalPrompt"]
    assert NATIVE_COMIC_PROMPT.split(", 1girl", 1)[0] in validated["globalPrompt"]


@pytest.mark.parametrize("two_sections", [False, True])
def test_plan_writes_then_formats_once_and_places_occurrences_in_reference_panels(two_sections, caplog):
    source = sample_request(two_sections)
    output = sample_draft(source)
    story = "雨后两人重逢。第一格两人隔街相望，第二格林收起伞说：好久不见。\n叶抬眼认出林，露出惊喜。"
    calls = []

    def transport(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return Response({"choices": [{"message": {"content": story if len(calls) == 1 else json.dumps(output)}, "finish_reason": "stop"}]})

    client = NovelAIClient(request_func=transport)
    plan = plan_comic(client, "private-test-token", OPUS, source, "comic-test")
    assert len(calls) == 2
    assert calls[0][2]["json"]["model"] == "xialong-v1"
    assert "整页分镜设计" in calls[0][2]["json"]["messages"][0]["content"]
    assert "连续编号" in calls[0][2]["json"]["messages"][0]["content"]
    assert len(calls[0][2]["headers"]["X-Correlation-ID"]) == 6
    assert calls[0][2]["headers"]["X-Correlation-ID"].isalnum()
    assert plan["storyDraft"] == story
    assert plan["planningModels"] == {"story": "xialong-v1", "format": "glm-4-6"}
    method, url, request = calls[1]
    assert (method, url) == ("POST", "https://text.novelai.net/oa/v1/chat/completions")
    assert request["allow_redirects"] is False
    assert request["headers"]["Authorization"] == "Bearer private-test-token"
    assert request["json"]["model"] == "glm-4-6"
    format_system = request["json"]["messages"][0]["content"]
    assert "Danbooru" in format_system
    assert "-n::概念::" in format_system
    assert request["json"]["max_tokens"] == 8192
    assert request["json"]["stream"] is True
    assert request["headers"]["Accept"] == "text/event-stream"
    assert request["json"]["enable_thinking"] is False
    assert len(request["headers"]["X-Correlation-ID"]) == 6
    assert request["headers"]["X-Correlation-ID"].isalnum()
    format_input = json.loads(request["json"]["messages"][-1]["content"])
    assert format_input["storyDraft"] == story
    assert "globalPrompt" in format_input["formatInstructions"]
    assert len(client._tls_bindings) == 1
    for section in plan["sections"]:
        assert [instance["center"] for instance in section["instances"]] == [
            {"x": 0.3, "y": 0.25}, {"x": 0.7, "y": 0.25}, {"x": 0.5, "y": 0.75},
        ]
        assert section["dialogues"][0]["text"] == "好久不见。"
    assert "private-test-token" not in caplog.text
    assert "好久不见" not in caplog.text
    assert "text.novelai.net" in caplog.text
    assert "correlation_id=comic-test-story" in caplog.text
    assert "correlation_id=comic-test-format" in caplog.text


@pytest.mark.parametrize("panel_count", [4, 9, 23])
def test_free_layout_uses_model_bounds_without_a_fixed_panel_count(panel_count):
    payload = sample_request()
    payload["sections"][0]["referencePanels"] = []
    payload["readingDirection"] = "rtl"
    request, source = prepare_comic_request(payload, OPUS)
    model_input = json.loads(request["messages"][-1]["content"])
    assert "selectedLayout" not in model_input["sections"][0]
    assert model_input["readingDirection"] == "rtl"
    assert model_input["visualLanguage"] == "English"
    draft = {
        "summary": "安静房间的连续空镜。", "characters": [],
        "sections": [{"globalPrompt": "right-to-left comic, empty room, sunlight through windows", "panels": [{
            "summary": "光影变化。", "bounds": {"x": 0, "y": index / panel_count, "width": 1, "height": 1 / panel_count},
            "instances": [], "dialogues": [],
        } for index in range(panel_count)]}],
    }
    result = validate_comic_plan(compile_comic_plan(draft, source), source)["sections"][0]
    assert len(result["panels"]) == panel_count
    assert result["instances"] == []
    assert result["panels"][0]["bounds"] == draft["sections"][0]["panels"][0]["bounds"]
    assert result["globalPrompt"].startswith(draft["sections"][0]["globalPrompt"])


def test_reference_panels_can_outnumber_character_slots_without_changing_anchors():
    payload = sample_request()
    payload["sections"][0]["referencePanels"] = [{
        "id": f"p{index + 1}", "number": index + 1,
        "center": {"x": .5, "y": (index + .5) / 23}, "width": 1, "height": 1 / 23,
    } for index in range(23)]
    _, source = prepare_comic_request(payload, OPUS)
    draft = {
        "summary": "空镜序列。", "characters": [],
        "sections": [{"globalPrompt": "empty landscape sequence", "panels": [{
            "summary": "空镜。", "instances": [], "dialogues": [],
        } for _ in range(23)]}],
    }
    section = validate_comic_plan(compile_comic_plan(draft, source), source)["sections"][0]
    assert len(section["panels"]) == 23
    assert section["instances"] == []
    assert section["panels"][0]["bounds"]["height"] == pytest.approx(1 / 23)


def test_low_tier_uses_glm_twice_and_passes_full_story_without_truncating():
    payload = sample_request()
    payload["sections"][0]["referencePanels"] = []
    output = sample_draft(payload)
    story = "人物在雨后街头重逢。" * 50 + "\n林认出对方，说：好久不见。"
    calls = []

    def transport(*args, **kwargs):
        calls.append(kwargs["json"])
        return Response({"choices": [{"text": story if len(calls) == 1 else json.dumps(output), "finish_reason": "stop"}]})

    plan = plan_comic(NovelAIClient(request_func=transport), "test-token", {"tier": 1, "active": True}, payload)
    assert [request["model"] for request in calls] == ["glm-4-6", "glm-4-6"]
    assert json.loads(calls[1]["messages"][-1]["content"])["storyDraft"] == story
    assert plan["storyDraft"] == story
    assert calls[1]["max_tokens"] == 4096


def test_completion_style_text_is_supported_and_truncation_is_not_retried():
    source = sample_request()
    output = json.dumps(sample_draft(source))
    calls = []

    def transport(*args, **kwargs):
        calls.append(kwargs)
        return Response({"choices": [{"text": output, "finish_reason": "length" if len(calls) == 3 else "stop"}]})

    client = NovelAIClient(request_func=transport)
    assert plan_comic(client, "test-token", OPUS, source)["version"] == 1
    with pytest.raises(NovelAIUpstreamError) as truncated:
        plan_comic(client, "test-token", OPUS, source)
    assert truncated.value.code == "COMIC_PLAN_TRUNCATED"
    assert len(calls) == 3


@pytest.mark.parametrize("field", ["delta", "text"])
@pytest.mark.parametrize("ending", ["done", "stop", "both"])
def test_streamed_plan_is_collected_once_before_parsing(field, ending):
    source = sample_request()
    output = json.dumps(sample_draft(source), ensure_ascii=False)
    chunks = [{"choices": [{"delta": {"role": "assistant", "content": None}}]}]
    for part in (output[:100], output[100:]):
        chunks.append({"choices": [{"delta": {"content": part}} if field == "delta" else {"text": part}]})
    if ending in {"stop", "both"}:
        chunks.append({"choices": [{"finish_reason": "stop", "delta": {}}]})
    chunks.append({"choices": [], "usage": {"completion_tokens": 672}})
    body = ": keepalive\r\n\r\n" + "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\r\n\r\n" for chunk in chunks)
    if ending in {"done", "both"}:
        body += "data: [DONE]\r\n\r\n"
    calls = []

    def transport(*args, **kwargs):
        calls.append(kwargs)
        return Response(body=body)

    client = NovelAIClient(request_func=transport)
    plan = plan_comic(client, "private-test-token", OPUS, source)
    assert plan["sections"][0]["dialogues"][0]["text"] == "好久不见。"
    assert len(calls) == 2
    assert calls[0]["json"]["stream"] is True
    assert calls[0]["headers"]["Accept"] == "text/event-stream"


@pytest.mark.parametrize(("body", "code"), [
    ('data: {"choices":[{"text":"partial"}]}\n\n', "COMIC_PLAN_INCOMPLETE"),
    ('data: {"choices":[{"text":"partial","finish_reason":"length"}]}\n\ndata: [DONE]\n\n', "COMIC_PLAN_TRUNCATED"),
    ('data: {"choices":[{"text":"","token_ids":[1,2],"finish_reason":"stop"}],"usage":{"completion_tokens":672}}\n\ndata: [DONE]\n\n', "COMIC_PLAN_INVALID_RESPONSE"),
    ('data: {"error":{"message":"private-upstream-text"}}\n\n', "COMIC_PLAN_STREAM_ERROR"),
    ('event: error\ndata: {"message":"private-upstream-text"}\n\n', "COMIC_PLAN_STREAM_ERROR"),
    ('data: broken-json\n\n', "COMIC_PLAN_INVALID_RESPONSE"),
    ('data: {"choices":[{"delta":{"content":["private-upstream-text"]},"finish_reason":"stop"}]}\n\n', "COMIC_PLAN_INVALID_RESPONSE"),
])
def test_stream_errors_reject_partial_content_without_retry(body, code, caplog):
    calls = []

    def transport(*args, **kwargs):
        calls.append(kwargs)
        return Response(body=body)

    client = NovelAIClient(request_func=transport)
    with pytest.raises(NovelAIUpstreamError) as failure:
        client.chat_completion("private-test-token", {"messages": []})
    assert failure.value.code == code
    assert len(calls) == 1
    assert "private-upstream-text" not in str(failure.value)
    assert "private-upstream-text" not in caplog.text
    assert "private-test-token" not in caplog.text


@pytest.mark.parametrize("message", [{}, {"role": "assistant", "content": None}])
def test_nullish_message_content_uses_completion_text(message):
    source = sample_request()
    output = json.dumps(sample_draft(source))
    client = NovelAIClient(request_func=lambda *args, **kwargs: Response({
        "choices": [{"message": message, "text": output, "finish_reason": "stop"}],
    }))
    assert plan_comic(client, "private-test-token", OPUS, source)["version"] == 1


@pytest.mark.parametrize(("payload", "branch", "expected"), [
    ({"error": {"code": "rate_limit_exceeded", "message": "private-upstream-text"}}, "invalid_choices", {"error_code": "rate_limit_exceeded"}),
    ({"error": {"code": "private-upstream-text", "message": "private-upstream-text"}}, "invalid_choices", {"error_code": "other"}),
    ({"choices": []}, "invalid_choices", {"choices_count": 0}),
    ({"choices": [{"message": {"content": "", "reasoning_content": "private-upstream-text"}, "text": "private-upstream-text", "finish_reason": "stop"}]},
     "empty_content", {"content_length": 0, "text_length": 21, "reasoning_length": 21}),
    ({"choices": [{"message": {"content": [{"text": "private-upstream-text"}]}, "finish_reason": "stop"}]},
     "empty_content", {"content_type": "list", "content_length": 1}),
    ({"choices": [{"delta": {"content": "private-upstream-text"}}]}, "empty_content", {"delta_content_length": 21}),
])
def test_invalid_response_logs_only_shape_and_allowed_error_code(payload, branch, expected, caplog):
    calls = []

    def transport(*args, **kwargs):
        calls.append(kwargs)
        return Response(payload)

    client = NovelAIClient(request_func=transport)
    with pytest.raises(NovelAIUpstreamError) as failure:
        client.chat_completion("private-test-token", {"messages": [{"role": "user", "content": "private-prompt"}]}, "shp123")
    assert failure.value.code == "COMIC_PLAN_INVALID_RESPONSE"
    assert len(calls) == 1
    record = next(record.getMessage() for record in caplog.records if "event=novelai_chat_invalid_response" in record.getMessage())
    shape = json.loads(record.split(" shape=", 1)[1])
    assert shape["branch"] == branch
    for key, value in expected.items():
        assert shape[key] == value
    assert "correlation_id=shp123" in record
    assert "private-upstream-text" not in caplog.text
    assert "private-test-token" not in caplog.text
    assert "private-prompt" not in caplog.text


@pytest.mark.parametrize("text", ['{"version":1', 'Explanation: {"version":1}', '```json\n{"version":1\n```'])
def test_incomplete_json_or_extra_explanation_is_rejected_without_salvaging(text):
    client = NovelAIClient(request_func=lambda *args, **kwargs: Response({"choices": [{"text": text, "finish_reason": "stop"}]}))
    with pytest.raises(ComicPlanError) as invalid:
        plan_comic(client, "test-token", OPUS, sample_request())
    assert invalid.value.code == "COMIC_PLAN_INVALID_JSON"


def test_complete_json_code_fence_is_unwrapped_without_changing_plan():
    source = sample_request()
    output = '```json\n' + json.dumps(sample_draft(source)) + '\n```'
    client = NovelAIClient(request_func=lambda *args, **kwargs: Response({"choices": [{"text": output, "finish_reason": "stop"}]}))
    plan = plan_comic(client, "test-token", OPUS, source)
    assert plan["sections"][0]["dialogues"][0]["text"] == "好久不见。"


def test_model_permission_is_checked_without_guessing_context_from_utf8_bytes():
    source = sample_request()
    source["model"] = "xialong-v1"
    with pytest.raises(ComicPlanError) as forbidden:
        prepare_comic_request(source, {"tier": 2, "active": True})
    assert forbidden.value.code == "COMIC_MODEL_FORBIDDEN"
    request, _ = prepare_comic_request(sample_request(True), {"tier": 1, "active": True})
    assert request["max_tokens"] == 4096
    source = sample_request()
    source["text"] = "完整台词" * 5000
    request, _ = prepare_comic_request(source, OPUS)
    assert json.loads(request["messages"][-1]["content"])["story"] == source["text"]
    assert source["text"] == "完整台词" * 5000


@pytest.mark.parametrize(("tier", "extra_text", "expected_tokens"), [(1, 0, 4096), (3, 0, 8192), (3, 18000, 8192)])
def test_output_budget_uses_subscription_without_truncating_input(tier, extra_text, expected_tokens):
    source = sample_request()
    source["text"] += "x" * extra_text
    request, _ = prepare_comic_request(source, {"tier": tier, "active": True})
    assert request["enable_thinking"] is False
    assert request["max_tokens"] == expected_tokens
    assert json.loads(request["messages"][-1]["content"])["story"] == source["text"]


@pytest.mark.parametrize("mutation", ["panels", "empty_panels", "extra_section", "duplicate_order", "dialogue_panel_number", "missing_dialogue_panel", "unknown_speaker", "center", "unhashable_id"])
def test_model_relationship_and_layout_imperfections_are_normalized(mutation):
    source = sample_request()
    _, normalized = prepare_comic_request(source, OPUS)
    plan = sample_plan(source)
    section = plan["sections"][0]
    if mutation == "panels":
        section["panels"][0]["number"] = 3
    elif mutation == "empty_panels":
        section["panels"] = []
    elif mutation == "extra_section":
        plan["sections"].append(dict(section, id=1))
    elif mutation == "duplicate_order":
        section["dialogues"].append(dict(section["dialogues"][0], id="d2", panelId="p1"))
    elif mutation == "dialogue_panel_number":
        section["dialogues"][0]["panelId"] = 2
    elif mutation == "missing_dialogue_panel":
        section["dialogues"][0]["panelId"] = "p0"
    elif mutation == "unknown_speaker":
        section["dialogues"][0]["speakerId"] = "c99"
    elif mutation == "center":
        section["instances"][0]["center"]["x"] = float("nan")
    elif mutation == "unhashable_id":
        section["instances"][0]["panelId"] = []
    result = validate_comic_plan(plan, normalized)
    assert result["version"] == 1
    assert result["sections"][0]["dialogues"][0]["text"] == "好久不见。"
    if mutation == "extra_section":
        assert len(result["sections"]) == 1
    elif mutation in {"dialogue_panel_number", "missing_dialogue_panel"}:
        assert result["sections"][0]["dialogues"][0]["panelId"] == "p1"
    elif mutation == "unknown_speaker":
        assert result["sections"][0]["dialogues"][0]["speakerId"] is None
    elif mutation == "empty_panels":
        assert section["panels"] == []
        assert all(item["panelId"] == "p1" for item in section["instances"] + section["dialogues"])


@pytest.mark.parametrize("with_references", [False, True])
@pytest.mark.parametrize("center", [None, {"x": float("nan"), "y": 0.5}])
def test_legacy_invalid_centers_disable_controls_unless_reference_frames_locate_them(with_references, center):
    source = sample_request()
    if not with_references:
        source["sections"][0]["referencePanels"] = []
    _, normalized = prepare_comic_request(source, OPUS)
    plan = sample_plan(source)
    section = plan["sections"][0]
    section["instances"][0]["center"] = center
    section["instances"][1].pop("center")
    validate_comic_plan(plan, normalized)
    if with_references:
        assert "useCoords" not in section
        assert [instance["center"] for instance in section["instances"][:2]] == [{"x": 0.3, "y": 0.25}, {"x": 0.7, "y": 0.25}]
    else:
        assert section["useCoords"] is False
        assert [instance["center"] for instance in section["instances"][:2]] == [{"x": 0.5, "y": 0.5}] * 2


def test_legacy_valid_centers_keep_existing_coordinate_control_choice():
    source = sample_request()
    _, normalized = prepare_comic_request(source, OPUS)
    plan = sample_plan(source)
    section = validate_comic_plan(plan, normalized)["sections"][0]
    assert "useCoords" not in section
    section["useCoords"] = False
    assert validate_comic_plan(plan, normalized)["sections"][0]["useCoords"] is False


def test_real_v5_slot_capacity_remains_enforced():
    source = sample_request()
    _, normalized = prepare_comic_request(source, OPUS)
    plan = sample_plan(source)
    section = plan["sections"][0]
    section["instances"] = [dict(section["instances"][0], id=f"i{index}") for index in range(23)]
    with pytest.raises(ComicPlanError, match="22") as invalid:
        validate_comic_plan(plan, normalized)
    assert invalid.value.status_code == 502


def test_offscreen_speech_and_visual_quotes_are_not_invalid_relationships():
    source = sample_request()
    _, normalized = prepare_comic_request(source, OPUS)
    plan = sample_plan(source)
    section = plan["sections"][0]
    section["instances"] = section["instances"][:2]
    section["dialogues"][0]["speakerId"] = "c2"
    section["globalPrompt"] += '\nText: 好久不见。'
    section["instances"][0]["prompt"] += ', "好久不见。", sign "OPEN"'
    assert validate_comic_plan(plan, normalized) is plan


def test_empty_scene_can_use_null_character_and_narration_speaker():
    source = sample_request()
    _, normalized = prepare_comic_request(source, OPUS)
    plan = sample_plan(source)
    section = plan["sections"][0]
    section["instances"][2]["characterId"] = None
    section["dialogues"][0].update(speakerId=None, type="narration")
    assert validate_comic_plan(plan, normalized)["sections"][0]["instances"][2]["characterId"] is None


def test_text_host_error_preserves_existing_no_retry_and_secret_redaction(caplog):
    calls = []

    def transport(*args, **kwargs):
        calls.append(kwargs)
        response = Response({"message": "secret-test-token"})
        response.status_code = 429
        return response

    client = NovelAIClient(request_func=transport)
    with pytest.raises(NovelAIUpstreamError) as limited:
        plan_comic(client, "secret-test-token", OPUS, sample_request())
    assert limited.value.code == "NOVELAI_RATE_LIMITED"
    assert len(calls) == 1
    assert "secret-test-token" not in str(limited.value)
    assert "secret-test-token" not in caplog.text
