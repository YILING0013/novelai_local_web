import copy
import json

import pytest

from api_utils.comic_planner import ComicPlanError, compile_comic_plan, prepare_comic_request, validate_comic_plan
from tests.test_comic_planner import NATIVE_COMIC_PROMPT, OPUS, sample_request


def test_native_prompt_is_split_without_losing_weights_original_dialogue_or_title():
    payload = sample_request()
    payload.update(inputType="prompt", text=NATIVE_COMIC_PROMPT, style="", characters="")
    payload["sections"][0]["referencePanels"] = []
    request, source = prepare_comic_request(payload, OPUS)
    assert source["text"] == NATIVE_COMIC_PROMPT
    assert NATIVE_COMIC_PROMPT.split(", 1girl", 1)[0] in source["protectedVisualPrefix"]
    assert "4::greyscale, flat color::" in source["protectedVisualPrefix"]
    assert all(tag in source["protectedVisualPrefix"] for tag in ("no text", "4koma", "horizontal split screen"))
    assert "comic title" not in source["protectedVisualPrefix"]
    assert len(source["sourceTexts"]) == 9
    assert source["sourceTexts"][0] == {"id": "s1", "text": "세리나의 귀청소", "title": True}
    assert source["sourceTexts"][1]["text"] == "부탁할게\n세리나!"
    assert source["sourceTexts"][-1]["text"] == "그럼 자고 있을 때 -"
    model_input = json.loads(request["messages"][-1]["content"])
    assert len(model_input["sourceTexts"]) == 8
    assert all(entry["id"] != "s1" for entry in model_input["sourceTexts"])
    assert [entry["id"] for entry in model_input["sourceTexts"]] == [f"s{number}" for number in range(2, 10)]
    assert [message["role"] for message in request["messages"]] == ["system", "user"]
    assert "selectedLayout" not in model_input["sections"][0]
    assert request["enable_thinking"] is False


@pytest.fixture
def compiled_material():
    """提供两格的纯编译测试数据，不替实际用户编排故事。"""
    payload = sample_request()
    payload.update(inputType="prompt", text='artist:tester, 2::greyscale, flat color::, comic title "题目", no text, Text: 题目\n\n甲\\n乙\n\n丙')
    payload["sections"][0]["referencePanels"] = []
    _, source = prepare_comic_request(payload, OPUS)
    draft = {
        "summary": "测试分镜", "characters": [{"id": "c1", "name": "甲", "appearance": "short hair"}],
        "sections": [{
            "globalPrompt": "two panels, clean borders", "negativePrompt": "1.5::text, letters, worst quality::, blurry",
            "panels": [{
                "summary": "第一格", "bounds": {"x": 0, "y": 0, "width": 1, "height": 0.5},
                "instances": [{"characterId": "c1", "prompt": "waving", "negativePrompt": "text, illegible text", "center": {"x": 0.25, "y": 0.5}}],
                "dialogues": [{"sourceId": "s2", "speakerId": "c1", "type": "speech", "direction": "horizontal"}],
            }, {
                "summary": "第二格", "bounds": {"x": 0, "y": 0.5, "width": 1, "height": 0.5},
                "instances": [{"characterId": "c1", "prompt": "smiling", "negativePrompt": "", "center": {"x": 0.75, "y": 0.5}}],
                "dialogues": [{"sourceId": "s3", "speakerId": "c1", "type": "speech", "direction": "horizontal"}],
            }],
        }],
    }
    return source, draft


def test_nested_plan_compiles_ids_coordinates_and_original_text_once(compiled_material):
    source, draft = compiled_material
    plan = validate_comic_plan(compile_comic_plan(draft, source), source)
    section = plan["sections"][0]
    assert section["useCoords"] is True
    assert (section["id"], section["width"], section["height"]) == (0, 832, 1216)
    assert [item["center"] for item in section["instances"]] == [{"x": 0.25, "y": 0.25}, {"x": 0.75, "y": 0.75}]
    assert [item["prompt"] for item in section["instances"]] == ["panel 1, waving", "panel 2, smiling"]
    assert [item["text"] for item in section["dialogues"]] == ["题目", "甲\n乙", "丙"]
    assert [item["order"] for item in section["dialogues"]] == [1, 2, 3]
    assert [item["panelId"] for item in section["dialogues"]] == ["p1", "p1", "p2"]
    assert section["dialogues"][0]["speakerId"] is None
    assert section["dialogues"][0]["type"] == "narration"
    assert section["negativePrompt"] == "1.5::text, letters, worst quality::, blurry"
    assert section["instances"][0]["negativePrompt"] == "text, illegible text"
    assert section["globalPrompt"].startswith("artist:tester, 2::greyscale, flat color::")
    assert section["globalPrompt"].endswith("two panels, clean borders")
    assert "题目" not in section["globalPrompt"]


@pytest.mark.parametrize("duplicate", [False, True])
def test_missing_or_repeated_source_dialogue_does_not_block_generation(compiled_material, duplicate):
    source, original = compiled_material
    draft = copy.deepcopy(original)
    draft["sections"][0]["panels"][1]["dialogues"] = (
        [dict(draft["sections"][0]["panels"][0]["dialogues"][0])] if duplicate else []
    )
    result = validate_comic_plan(compile_comic_plan(draft, source), source)
    assert [item["text"] for item in result["sections"][0]["dialogues"]] == (["题目", "甲\n乙", "甲\n乙"] if duplicate else ["题目", "甲\n乙"])


@pytest.mark.parametrize("mutation", ["exact", "changed", "ambiguous", "reused"])
def test_model_text_is_kept_without_exact_source_matching(compiled_material, mutation):
    source, draft = copy.deepcopy(compiled_material)
    for panel in draft["sections"][0]["panels"]:
        for dialogue in panel["dialogues"]:
            source_id = dialogue.pop("sourceId")
            dialogue["text"] = next(entry["text"] for entry in source["sourceTexts"] if entry["id"] == source_id)
    if mutation == "changed":
        draft["sections"][0]["panels"][0]["dialogues"][0]["text"] += "。"
    elif mutation == "ambiguous":
        source["sourceTexts"].append({"id": "s4", "text": "甲\n乙", "title": False})
    elif mutation == "reused":
        draft["sections"][0]["panels"][1]["dialogues"][0]["text"] = "甲\n乙"
    compiled = validate_comic_plan(compile_comic_plan(draft, source), source)
    assert [entry["text"] for entry in compiled["sections"][0]["dialogues"]] == [
        "题目", "甲\n乙。" if mutation == "changed" else "甲\n乙", "甲\n乙" if mutation == "reused" else "丙",
    ]


def test_story_can_reorder_source_dialogue_without_changing_words(compiled_material):
    source, draft = copy.deepcopy(compiled_material)
    panels = draft["sections"][0]["panels"]
    panels[0]["dialogues"], panels[1]["dialogues"] = panels[1]["dialogues"], panels[0]["dialogues"]
    result = validate_comic_plan(compile_comic_plan(draft, source), source)
    assert [item["text"] for item in result["sections"][0]["dialogues"]] == ["题目", "丙", "甲\n乙"]
    assert panels[0]["dialogues"][0]["sourceId"] == "s3"


def test_compiler_supplies_only_deterministic_defaults(compiled_material):
    source, draft = copy.deepcopy(compiled_material)
    section = draft["sections"][0]
    section.pop("negativePrompt")
    for panel in section["panels"]:
        panel["instances"][0].pop("negativePrompt")
        panel["dialogues"][0].pop("type")
        panel["dialogues"][0].pop("direction")
    section["panels"][1]["dialogues"][0].update(type="narration", direction="vertical", speakerId=None)
    result = validate_comic_plan(compile_comic_plan(draft, source), source)["sections"][0]
    assert result["negativePrompt"] == ""
    assert all(instance["negativePrompt"] == "" for instance in result["instances"])
    assert (result["dialogues"][1]["type"], result["dialogues"][1]["direction"]) == ("speech", "horizontal")
    assert (result["dialogues"][2]["type"], result["dialogues"][2]["direction"]) == ("narration", "vertical")


@pytest.mark.parametrize("text", ["1girl, Text: Hello!", NATIVE_COMIC_PROMPT])
def test_tier_one_omits_example_without_truncating_native_input(text):
    payload = sample_request()
    payload.update(inputType="prompt", text=text, style="", characters="")
    payload["sections"][0]["referencePanels"] = []
    request, source = prepare_comic_request(payload, {"tier": 1, "active": True})
    assert len(request["messages"]) == 2
    assert source["text"] == text
    assert 2048 <= request["max_tokens"] <= 4096


def test_text_free_request_does_not_make_model_dialogue_a_generation_error(compiled_material):
    payload = sample_request()
    payload.update(inputType="prompt", text="artist:tester, comic, no text", style="", characters="")
    payload["sections"][0]["referencePanels"] = []
    request, source = prepare_comic_request(payload, OPUS)
    assert "no text" in source["protectedVisualPrefix"]
    assert source["textless"] is True
    assert "用户明确要求无字漫画" in request["messages"][0]["content"]
    _, draft = copy.deepcopy(compiled_material)
    for panel in draft["sections"][0]["panels"]:
        panel["dialogues"] = []
    result = validate_comic_plan(compile_comic_plan(draft, source), source)
    assert result["sections"][0]["dialogues"] == []
    draft["sections"][0]["panels"][0]["dialogues"] = [{"text": "invented", "speakerId": "c1"}]
    result = validate_comic_plan(compile_comic_plan(draft, source), source)
    assert result["sections"][0]["dialogues"][0]["text"] == "invented"


def test_numeric_weight_groups_and_user_layout_tags_are_preserved():
    payload = sample_request()
    protected = '-1::4koma, split screen, static pose::, 1.5::artist:tester, split screen::'
    payload.update(inputType="prompt", text=f"comic, {protected}, 4koma, horizontal split screen, Text: Hello")
    _, source = prepare_comic_request(payload, OPUS)
    assert source["protectedVisualPrefix"] == f"comic, {protected}, 4koma, horizontal split screen"
    assert source["sourceTexts"] == [{"id": "s1", "text": "Hello", "title": False}]


def test_empty_shots_keep_offscreen_speakers_without_fabricated_appearance_or_slots(compiled_material):
    source, draft = copy.deepcopy(compiled_material)
    draft["characters"][0]["appearance"] = ""
    for panel in draft["sections"][0]["panels"]:
        panel["instances"] = []
    section = validate_comic_plan(compile_comic_plan(draft, source), source)["sections"][0]
    assert section["instances"] == []
    assert [item["speakerId"] for item in section["dialogues"]] == [None, "c1", "c1"]
    assert [panel["bounds"] for panel in section["panels"]] == [
        {"x": 0, "y": 0, "width": 1, "height": 0.5}, {"x": 0, "y": 0.5, "width": 1, "height": 0.5},
    ]


@pytest.mark.parametrize("has_instance", [False, True])
def test_invalid_panel_bounds_do_not_invent_layout_or_block_story(compiled_material, has_instance):
    source, draft = copy.deepcopy(compiled_material)
    panels = draft["sections"][0]["panels"]
    panels.extend({"summary": "Silent view.", "instances": [], "dialogues": []} for _ in range(8))
    for index, panel in enumerate(panels):
        panel["bounds"] = {"x": 0, "y": index / 10, "width": 1, "height": 0.1}
    panels[-1]["bounds"].update(y=1, height=0.3)
    if has_instance:
        panels[-1]["instances"] = [{"prompt": "walking away", "center": {"x": 0.1, "y": 0.9}}]
    original = copy.deepcopy(draft)
    result = validate_comic_plan(compile_comic_plan(draft, source), source)
    assert draft == original
    assert len(result["sections"][0]["panels"]) == 10
    section = result["sections"][0]
    assert "bounds" not in section["panels"][-1]
    assert section["useCoords"] is (not has_instance)
    if has_instance:
        assert section["instances"][-1]["center"] == {"x": 0.5, "y": 0.5}


def test_missing_bounds_keep_only_editor_centers_without_guessing_layout(compiled_material):
    source, draft = copy.deepcopy(compiled_material)
    panel = draft["sections"][0]["panels"][0]
    panel.pop("bounds")
    panel["instances"].append({"prompt": "looking back", "center": {"x": 0.9, "y": 0.1}})
    section = validate_comic_plan(compile_comic_plan(draft, source), source)["sections"][0]
    assert section["useCoords"] is False
    assert "bounds" not in section["panels"][0]
    assert [instance["center"] for instance in section["instances"][:2]] == [{"x": 0.5, "y": 0.5}] * 2
    assert section["panels"][1]["bounds"] == draft["sections"][0]["panels"][1]["bounds"]
    assert section["instances"][-1]["center"] == {"x": 0.75, "y": 0.75}


def test_real_reference_frames_allow_coordinates_without_model_bounds(compiled_material):
    source, draft = copy.deepcopy(compiled_material)
    source["sections"][0]["referencePanels"] = sample_request()["sections"][0]["referencePanels"]
    for panel in draft["sections"][0]["panels"]:
        panel.pop("bounds")
        panel["instances"][0].pop("center")
    section = validate_comic_plan(compile_comic_plan(draft, source), source)["sections"][0]
    assert section["useCoords"] is True
    assert [instance["center"] for instance in section["instances"]] == [{"x": 0.5, "y": 0.25}, {"x": 0.5, "y": 0.75}]
    assert all("bounds" in panel for panel in section["panels"])


@pytest.mark.parametrize(("direction", "count", "expected_x"), [
    ("ltr", 1, [0.5]), ("rtl", 1, [0.5]),
    ("ltr", 2, [0.25, 0.75]), ("rtl", 2, [0.75, 0.25]),
    ("ltr", 3, [0.25, 0.5, 0.75]), ("rtl", 3, [0.75, 0.5, 0.25]),
])
def test_omitted_centers_are_arranged_in_panel_reading_order(compiled_material, direction, count, expected_x):
    source, draft = copy.deepcopy(compiled_material)
    source["readingDirection"] = direction
    panel = draft["sections"][0]["panels"][0]
    original = panel["instances"][0]
    panel["instances"] = [{key: value for key, value in original.items() if key != "center"} for _ in range(count)]
    section = validate_comic_plan(compile_comic_plan(draft, source), source)["sections"][0]
    assert section["useCoords"] is True
    assert [item["center"] for item in section["instances"][:count]] == [{"x": x, "y": 0.25} for x in expected_x]
    # 下一格的显式坐标不随默认排布或阅读方向改变。
    assert section["instances"][-1]["center"] == {"x": 0.75, "y": 0.75}


@pytest.mark.parametrize("center", [None, {}, {"x": -0.1, "y": 0.5}, {"x": 0.5, "y": float("nan")}])
def test_invalid_center_uses_automatic_placement(compiled_material, center):
    source, draft = copy.deepcopy(compiled_material)
    draft["sections"][0]["panels"][0]["instances"][0]["center"] = center
    result = validate_comic_plan(compile_comic_plan(draft, source), source)
    assert result["sections"][0]["useCoords"] is True
    assert result["sections"][0]["instances"][0]["center"] == {"x": 0.5, "y": 0.25}


def test_silent_and_empty_panel_arrays_may_be_omitted_without_losing_shots(compiled_material):
    source, draft = copy.deepcopy(compiled_material)
    panels = draft["sections"][0]["panels"]
    panels[0]["dialogues"].extend(panels[1].pop("dialogues"))
    panels[1].pop("instances")
    section = validate_comic_plan(compile_comic_plan(draft, source), source)["sections"][0]
    assert len(section["panels"]) == 2
    assert section["panels"][1]["summary"] == panels[1]["summary"]
    assert section["panels"][1]["bounds"] == panels[1]["bounds"]
    assert len(section["instances"]) == 1
    assert [item["text"] for item in section["dialogues"]] == ["题目", "甲\n乙", "丙"]


@pytest.mark.parametrize("field", ["instances", "dialogues"])
@pytest.mark.parametrize("value", [None, {}])
def test_empty_or_null_panel_arrays_do_not_block_generation(compiled_material, field, value):
    source, draft = copy.deepcopy(compiled_material)
    draft["sections"][0]["panels"][0][field] = value
    result = validate_comic_plan(compile_comic_plan(draft, source), source)
    assert len(result["sections"][0]["panels"]) == 2
    assert isinstance(result["sections"][0][field], list)


def test_source_id_errors_and_changed_words_keep_usable_text(compiled_material):
    source, draft = copy.deepcopy(compiled_material)
    draft["sections"][0]["panels"][0]["dialogues"] = [
        {"sourceId": "missing", "text": "模型实际写出的对白", "speakerId": "unknown"},
        {"sourceId": "s2", "text": "改写后的对白", "type": "unexpected", "direction": "unexpected"},
        {"sourceId": ["invalid"]},
        {"sourceId": "missing"},
    ]
    result = validate_comic_plan(compile_comic_plan(draft, source), source)["sections"][0]
    assert [item["text"] for item in result["dialogues"]] == ["题目", "模型实际写出的对白", "改写后的对白", "丙"]
    assert result["dialogues"][1]["speakerId"] is None
    assert (result["dialogues"][2]["type"], result["dialogues"][2]["direction"]) == ("speech", "horizontal")


def test_reference_count_mismatch_and_missing_metadata_do_not_block(compiled_material):
    source, draft = copy.deepcopy(compiled_material)
    source["sections"][0]["referencePanels"] = [sample_request()["sections"][0]["referencePanels"][0]]
    draft.pop("summary")
    draft["characters"] = None
    draft["sections"][0]["panels"][1].pop("bounds")
    result = validate_comic_plan(compile_comic_plan(draft, source), source)
    assert result["summary"] == ""
    assert result["characters"] == []
    assert len(result["sections"][0]["panels"]) == 2
    assert result["sections"][0]["instances"][0]["center"] == {"x": 0.5, "y": 0.25}
    assert result["sections"][0]["useCoords"] is False
    assert "bounds" not in result["sections"][0]["panels"][1]
    assert all(instance["characterId"] is None for instance in result["sections"][0]["instances"])


def test_scene_only_plan_can_generate_without_panel_metadata():
    _, source = prepare_comic_request(sample_request(), OPUS)
    result = validate_comic_plan(compile_comic_plan({"sections": [{"globalPrompt": "a quiet rainy street"}]}, source), source)
    assert result["sections"][0]["globalPrompt"] == "a quiet rainy street"
    assert result["sections"][0]["panels"] == result["sections"][0]["instances"] == result["sections"][0]["dialogues"] == []
