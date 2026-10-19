"""把漫画剧情编排成可供 NovelAI V5 使用的完整页面计划。"""

from __future__ import annotations

import json
import math
import re
from typing import Any

from .novelai_client import NovelAIClient


COMIC_MODELS = ("glm-4-6", "xialong-v1")
STORY_SYSTEM_PROMPT = """你是短篇故事作者。根据用户的完整原始输入和补充设定，写一篇约400–800字、适合改编成漫画的短故事。保留明确的人物关系、故事重点和原有台词的语言，让起因、行动、反应与收尾自然衔接，用具体动作和简短对白表现情感、笑点或转折。用户要求无字时，以行动和可见变化讲故事。直接输出连续的故事正文。
"""

EXTRACT_SYSTEM_PROMPT = """从完整原始输入和补充设定整理画风与人物，storyDraft只帮助确认故事里有哪些人。

输出完整JSON：
{
  "visualStyle": "画师串与画风标签",
  "characters": [
    {"id": "c1", "name": "姓名", "appearance": "固定外貌与服装标签"}
  ]
}

visualStyle只收集画师、绘画风格、配色、画质与媒介。画师可能带artist:前缀，也可能直接写名字；已有画师串、画风说明、标签和数值权重按原顺序逐字保留，包括中文说明，n::内容::分组保持完整闭合。场景、动作和分镜安排留给后续故事设计。未指定画风时采用monochrome, greyscale, screentones, lineart。

为每个人物分配稳定id。已有角色名和外貌tags原样保留；需要细化的简短人物说明，用girl、boy等单人标签和明确、稳定的外貌、发型、发色、体态、服装等英文Danbooru标签表达。每份appearance描述一个人，故事中的动作、表情和临时衣发变化由出场提示负责。
"""

SYSTEM_PROMPT = """你是NovelAI V5漫画分镜与提示词作者。输入是完整故事、提取后的画风与固定人物、原始用户要求和页面规格。把这些素材设计成一页或指定的两张连续漫画，画面提示用英文Danbooru标签加自然语言，台词沿用原语言。

输出完整JSON：
{
  "summary": "故事概要",
  "sections": [
    {
      "globalPrompt": "人数、漫画标签、整页空间设计和故事场景",
      "negativePrompt": "本页需要排除的内容",
      "panels": [
        {
          "summary": "本格画框、镜头、环境和共同动作",
          "instances": [
            {
              "characterId": "c1",
              "prompt": "本次出场完整人物标签、衣发状态、动作与视角",
              "center": {"x": 0.3, "y": 0.25}
            }
          ],
          "dialogues": [DIALOGUE_SCHEMA]
        }
      ]
    }
  ]
}

先按情节把整页分成上下主次层，再在层内安排左右宽窄列，最后给细节和反应安排局部叠画。例如上层约占三分之二，分窄左列与宽右列：左列上下叠放环境和反应，右列用贯通的大画面承载主要行动，再将手部特写以overlapping panels、zoom layer或cut-in叠在行动画面边缘；底部通栏兑现结尾。根据本故事选择各层高度、列宽、主格和插格位置，让轻重、阅读动线与情节对应。用户已有参考框时沿用其顺序与位置。

globalPrompt写实际选定的整页空间切分、大致故事场景和光影，用comic、multiple views和主场景人数如1girl, 1boy作标签骨架。

panel.summary细写这一格的画框、环境、道具和共同动作，并选用wide shot、close-up、from above、from below、from behind、profile、dutch angle、hand focus等镜头标签。程序按阅读顺序把globalPrompt与各格summary合成最终主提示；两者分别负责整页设计与具体镜头。用这些镜头完整讲出起因、发展和最后的可见变化，近景、远景、背面、侧面、手脚细节、空镜和双人互动按故事交替。空镜使用no humans和具体场景描述。

固定人物表characters由程序保留供编辑核对，每次可见出场各用一个instance并引用characterId。instance.prompt写该人物本次出场的完整提示：继承appearance里稳定的脸型、发色、瞳色、体态和身份标签，按剧情选择当前衣服、发型状态，再加入动作、姿势、表情与视角。已有标签沿用原文，局部出场只保留可见特征并用hands only、feet only或eye focus说明。共同动作和人物关系放在本格summary，单人槽聚焦本人；画外音保留对白即可，空镜instances为空。

动作语法可用source#hug表示主动拥抱、target#hug表示被抱，双方互抱用mutual#hug，再用自然语言说明对象；#后面是动作。权重使用n::内容::并闭合，例如1.4::overlapping panels::、0.6::background::、-3::4koma::，按本页实际需要选择；UC用正权重描述不需要的内容。{内容}每层增强1.05倍，[内容]每层除以1.05；用户已有权重和角色(作品)标签按原样保留。

instance.center采用相对整张图片的0–1坐标，x从左到右、y从上到下。同格两人横向站位时使用相近x和相同y，纵向站位时使用相同x和相近y；跨格人物按实际分镜位置分开。精确坐标只用于人物中心，画框和叠画通过自然语言描述大致比例与空间关系。每张图片最多22个人物出场槽。

visualStyle会由程序原样前置到主提示；本阶段专注分镜、场景与动作。对白集中放dialogues，程序负责角色引号台词与末尾Text清单。type默认speech、direction默认horizontal，旁白和拟声词用narration或sfx以及speakerId:null；画外音可沿用人物speakerId。无声镜头dialogues为空。每张图的文字尽量简短，含分隔符控制在750字符内。
"""


class ComicPlanError(ValueError):
    """表示可向用户说明的编排输入、容量或模型计划错误。"""

    def __init__(self, message: str, code: str = "COMIC_PLAN_INVALID", status_code: int = 400) -> None:
        """记录可公开的编排错误。

        Args:
            message: 不包含凭据和上游原文的中文错误提示。
            code: 前端可识别的稳定错误码。
            status_code: 本地接口应返回的 HTTP 状态码。
        """
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code


def _valid_id(value: Any) -> bool:
    """分镜、人物、角色实例和对白使用稳定的非空字符串编号。"""
    return isinstance(value, str) and bool(value.strip())


def _valid_center(value: Any) -> bool:
    """在输入边界校验完整图片坐标，避免把无效位置交给图像生成。"""
    return isinstance(value, dict) and all(
        type(value.get(axis)) in {int, float}
        and math.isfinite(value[axis]) and 0 <= value[axis] <= 1
        for axis in ("x", "y")
    )


def preprocess_comic_input(source: dict[str, Any]) -> dict[str, Any]:
    """把原生提示词拆成受保护画风和可引用台词，不改写用户原文。

    Args:
        source: 已通过输入校验的剧情或原生图片提示词。

    Returns:
        原始 text 之外的编排素材；sourceTexts 中的标题由编译器放到首格。
    """
    if source["inputType"] != "prompt":
        return {"story": source["text"], "protectedVisualPrefix": "", "sourceTexts": [], "title": "", "textless": False}
    parts = re.split(r"\bText\s*:", source["text"], maxsplit=1, flags=re.IGNORECASE)
    visual = parts[0]
    title_match = re.search(r'\bcomic\s+title\s+"([^"]+)"', visual, re.IGNORECASE)
    title = title_match[1] if title_match else ""
    if title_match:
        visual = visual[:title_match.start()] + visual[title_match.end():]
    pieces = re.split(r"\n\s*\n", parts[1].replace(r"\n", "\n").replace("\r\n", "\n").strip()) if len(parts) == 2 else []
    has_text = bool(title or any(piece.strip() for piece in pieces))
    # 只识别无字要求，不删改用户的版式标签或正负权重。
    visual_parts = re.split(r"([+-]?(?:\d+(?:\.\d*)?|\.\d+)::.*?::)", visual, flags=re.DOTALL)
    textless = not has_text and any(
        re.search(r"(?:^|,)\s*no text\s*(?=,|$)", part, re.IGNORECASE)
        for part in visual_parts[::2]
    )
    visual = visual.strip(" ,\r\n")
    if title and pieces and pieces[0].strip() == title:
        pieces.pop(0)
    texts = [{"id": "s1", "text": title, "title": True}] if title else []
    for piece in pieces:
        if piece.strip():
            texts.append({"id": f"s{len(texts) + 1}", "text": piece.strip(), "title": False})
    return {"story": "", "protectedVisualPrefix": visual, "sourceTexts": texts, "title": title, "textless": textless}


def prepare_comic_request(payload: dict[str, Any], subscription: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """校验漫画输入和模型权限，准备结构整理指令与写作模型选择。

    Args:
        payload: 页面故事、风格、语言及一个或两个生成区域。
        subscription: 当前登录会话已验证的订阅信息。

    Returns:
        待加入写作结果的请求体，以及用于核对模型返回内容的规范化输入。
    """
    if not isinstance(payload, dict):
        raise ComicPlanError("请提供漫画编排内容。")
    tier = subscription.get("tier")
    opus = type(tier) is int and tier >= 3 and subscription.get("active") is True
    model = payload.get("model", "xialong-v1" if opus else "glm-4-6")
    if model not in COMIC_MODELS:
        raise ComicPlanError("请选择 GLM-4.6 或 Xialong。")
    if model == "xialong-v1" and not opus:
        raise ComicPlanError("Xialong 需要有效的 Opus 订阅，请选择 GLM-4.6。", "COMIC_MODEL_FORBIDDEN", 403)
    source = {
        "inputType": payload.get("inputType", "story"),
        "text": payload.get("text"),
        "style": payload.get("style", ""),
        "language": payload.get("language", "zh"),
        "readingDirection": payload.get("readingDirection", "ltr"),
        "characters": payload.get("characters", ""),
        "sections": payload.get("sections"),
    }
    if (
        source["inputType"] not in ("story", "prompt")
        or source["language"] not in ("zh", "ja", "en")
        or source["readingDirection"] not in ("ltr", "rtl")
    ):
        raise ComicPlanError("输入类型、对白语言或阅读方向不正确。")
    if not isinstance(source["text"], str) or not source["text"].strip() or any(not isinstance(source[key], str) for key in ("style", "characters")):
        raise ComicPlanError("请输入剧情或漫画提示词，风格和角色设定应为文字。")
    sections = source["sections"]
    if not isinstance(sections, list) or len(sections) not in {1, 2}:
        raise ComicPlanError("一次只能编排一个区域，或双行、双列页面的两个区域。")
    normalized_sections = []
    section_ids = set()
    for section in sections:
        if not isinstance(section, dict) or type(section.get("id")) is not int or section["id"] not in {0, 1} or section["id"] in section_ids:
            raise ComicPlanError("生成区域编号无效或重复。")
        section_ids.add(section["id"])
        width, height = section.get("width"), section.get("height")
        if type(width) is not int or type(height) is not int or (width, height) not in {(832, 1216), (1216, 832)}:
            raise ComicPlanError("漫画生成区域尺寸应为 832×1216 或 1216×832。")
        if len(sections) == 2 and (width, height) != (1216, 832):
            raise ComicPlanError("双行、双列页面的每个生成区域应为 1216×832。")
        references = section.get("referencePanels", [])
        if not isinstance(references, list):
            raise ComicPlanError("参考分镜应为列表。")
        panels, panel_ids, numbers = [], set(), set()
        for panel in references:
            if (
                not isinstance(panel, dict) or not _valid_id(panel.get("id")) or panel["id"] in panel_ids
                or type(panel.get("number")) is not int or panel["number"] < 1 or panel["number"] in numbers
            ):
                raise ComicPlanError("参考分镜编号无效或重复。")
            if not _valid_center(panel.get("center")) or any(
                type(panel.get(key)) not in {int, float}
                or not math.isfinite(panel[key]) or not 0 < panel[key] <= 1
                for key in ("width", "height")
            ):
                raise ComicPlanError("参考分镜的位置和尺寸必须是图片内的归一化坐标。")
            panel_ids.add(panel["id"])
            numbers.add(panel["number"])
            panels.append({key: panel[key] for key in ("id", "number", "center", "width", "height")})
        normalized_sections.append({"id": section["id"], "width": width, "height": height, "referencePanels": panels})
    source["sections"] = normalized_sections
    source.update(preprocess_comic_input(source))
    # 三个阶段都保留完整原文；拆出的台词只用于方便引用。
    model_input = {
        "originalInput": {key: source[key] for key in ("inputType", "text", "style", "characters", "language")},
        "sections": source["sections"], "readingDirection": source["readingDirection"],
        "dialogueLanguage": source["language"], "visualLanguage": "English", "title": source["title"],
    }
    model_input["sourceTexts"] = [
        {"id": entry["id"], "text": entry["text"]} for entry in source["sourceTexts"] if not entry["title"]
    ]
    if source["textless"]:
        system_prompt = SYSTEM_PROMPT.replace("DIALOGUE_SCHEMA", "")
        system_prompt += "\n用户明确要求无字漫画，用画面叙事，不安排对白、旁白或拟声文字。"
    elif model_input["sourceTexts"]:
        system_prompt = SYSTEM_PROMPT.replace(
            "DIALOGUE_SCHEMA", '{"sourceId":"s2","speakerId":"c1"}',
        )
        system_prompt += (
            "\n已有原始台词时优先用sourceId引用，程序会取对应原文；也可以直接用text填写台词。"
            "尽量保留原文、原语言和故事作用，可以按分镜重排。"
        )
    else:
        system_prompt = SYSTEM_PROMPT.replace(
            "DIALOGUE_SCHEMA", '{"text":"new words","speakerId":"c1"}',
        )
        system_prompt += "\n没有原始台词编号，用text填写storyDraft中对应语言的台词。"
    system_prompt += (
        f"\n本次生成{len(normalized_sections)}个区域，sections按输入区域顺序返回；在这些图片内讲完故事。"
    )
    user_prompt = json.dumps(model_input, ensure_ascii=False, indent=2)
    messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
    # UTF-8 字节数不是 token 数；不再用保守估算拦截中文素材，真实上下文限制交给上游。
    max_tokens = 8192 if opus else 4096
    return {
        "model": model,
        "messages": messages,
        "temperature": 0.65, "max_tokens": max_tokens,
        "enable_thinking": False, "stream": True,
    }, source


def compile_comic_plan(draft: Any, source: dict[str, Any]) -> dict[str, Any]:
    """把模型已有内容整理成可执行计划，不把故事质量问题变成生图门槛。

    Args:
        draft: 模型返回的嵌套分镜、人物出场和台词。
        source: 当前生成区域、参考框及可供引用的原始文字。

    Returns:
        带稳定编号和可用坐标的扁平计划；缺失的剧情和台词不另行补写。
    """
    if not isinstance(draft, dict) or not isinstance(draft.get("sections"), list) or not draft["sections"]:
        raise ComicPlanError("模型没有返回可用的漫画生成区域。", "COMIC_PLAN_INVALID_OUTPUT", 502)
    characters = draft.get("characters", [])
    if not isinstance(characters, list):
        characters = []
    plan = {"version": 1, "summary": draft.get("summary", ""), "characters": characters, "sections": []}
    source_texts = {entry["id"]: entry for entry in source.get("sourceTexts", [])}
    for section_index, (section, expected) in enumerate(zip(draft["sections"], source["sections"])):
        if not isinstance(section, dict):
            continue
        panels = section.get("panels", [])
        if not isinstance(panels, list):
            panels = []
        panels = [panel for panel in panels if isinstance(panel, dict)]
        references = expected["referencePanels"]
        global_prompt = section.get("globalPrompt", "")
        negative_prompt = section.get("negativePrompt", "")
        compiled = {
            "id": expected["id"], "width": expected["width"], "height": expected["height"],
            "globalPrompt": ", ".join(part for part in (source.get("protectedVisualPrefix", ""), global_prompt) if isinstance(part, str) and part),
            "negativePrompt": negative_prompt if isinstance(negative_prompt, str) else "",
            "panels": [], "instances": [], "dialogues": [], "useCoords": True,
        }
        for panel_index, panel in enumerate(panels):
            instances = panel.get("instances") or []
            dialogues = panel.get("dialogues") or []
            if isinstance(instances, dict):
                instances = [instances]
            if isinstance(dialogues, (dict, str)):
                dialogues = [dialogues]
            if not isinstance(instances, list):
                instances = []
            if not isinstance(dialogues, list):
                dialogues = []
            # 没有画面提示的空项不占角色槽；其他已有内容直接沿用。
            instances = [item for item in instances if isinstance(item, dict) and isinstance(item.get("prompt"), str) and item["prompt"].strip()]
            reference = references[panel_index] if panel_index < len(references) else None
            panel_id = reference["id"] if reference else f"{'extra-' if references else ''}p{panel_index + 1}"
            panel_number = reference["number"] if reference else panel_index + 1
            bounds = panel.get("bounds")
            if reference:
                x = max(0, reference["center"]["x"] - reference["width"] / 2)
                y = max(0, reference["center"]["y"] - reference["height"] / 2)
                bounds = {
                    "x": x, "y": y,
                    "width": min(1, reference["center"]["x"] + reference["width"] / 2) - x,
                    "height": min(1, reference["center"]["y"] + reference["height"] / 2) - y,
                }
            elif not (
                isinstance(bounds, dict)
                and all(type(bounds.get(key)) in {int, float} and math.isfinite(bounds[key]) for key in ("x", "y", "width", "height"))
                and 0 <= bounds["x"] < 1 and 0 <= bounds["y"] < 1
                and 0 < bounds["width"] <= 1 - bounds["x"] + 0.000001
                and 0 < bounds["height"] <= 1 - bounds["y"] + 0.000001
            ):
                # 缺少可靠边界时只留编辑占位点，不用程序猜出的布局约束生图。
                bounds = None
            summary = panel.get("summary", "")
            compiled_panel = {"id": panel_id, "number": panel_number, "summary": summary if isinstance(summary, str) else ""}
            if bounds is not None:
                compiled_panel["bounds"] = dict(bounds)
            compiled["panels"].append(compiled_panel)
            for instance_index, instance in enumerate(instances):
                if source.get("coordinateSpace") == "page" and _valid_center(instance.get("center")):
                    center = dict(instance["center"])
                elif reference:
                    center = dict(reference["center"])
                elif bounds is None:
                    center = {"x": 0.5, "y": 0.5}
                    compiled["useCoords"] = False
                else:
                    local_center = instance.get("center")
                    if not _valid_center(local_center):
                        count = len(instances)
                        local_x = 0.5 if count == 1 else 0.25 + instance_index / (count - 1) * 0.5
                        if source.get("readingDirection") == "rtl":
                            local_x = 1 - local_x
                        local_center = {"x": local_x, "y": 0.5}
                    center = {
                        "x": round(bounds["x"] + local_center["x"] * bounds["width"], 6),
                        "y": round(bounds["y"] + local_center["y"] * bounds["height"], 6),
                    }
                negative_prompt = instance.get("negativePrompt", "")
                compiled["instances"].append({
                    "id": f"i{len(compiled['instances']) + 1}", "panelId": panel_id,
                    "characterId": instance.get("characterId"), "prompt": f"panel {panel_number}, {instance['prompt']}",
                    "negativePrompt": negative_prompt if isinstance(negative_prompt, str) else "", "center": center,
                })
            if section_index == 0 and panel_index == 0:
                for entry in source_texts.values():
                    if entry.get("title"):
                        compiled["dialogues"].append({
                            "id": f"d{len(compiled['dialogues']) + 1}", "panelId": panel_id, "speakerId": None,
                            "text": entry["text"], "type": "narration", "order": len(compiled["dialogues"]) + 1, "direction": "horizontal",
                        })
            for dialogue in dialogues:
                if isinstance(dialogue, str):
                    dialogue = {"text": dialogue}
                if not isinstance(dialogue, dict):
                    continue
                text = dialogue.get("text")
                # 模型写出的文字可以改写或重复；只有没写文字时才按已知编号取原文。
                source_id = dialogue.get("sourceId")
                if (not isinstance(text, str) or not text.strip()) and isinstance(source_id, str) and source_id in source_texts:
                    text = source_texts[source_id]["text"]
                if not isinstance(text, str) or not text.strip():
                    continue
                compiled["dialogues"].append({
                    "id": f"d{len(compiled['dialogues']) + 1}", "panelId": panel_id,
                    "speakerId": dialogue.get("speakerId"), "text": text, "type": dialogue.get("type", "speech"),
                    "order": len(compiled["dialogues"]) + 1, "direction": dialogue.get("direction", "horizontal"),
                })
        plan["sections"].append(compiled)
    return plan


def validate_comic_plan(plan: Any, source: dict[str, Any]) -> dict[str, Any]:
    """整理前端实际使用的字段，保留 V5 容量边界。

    Args:
        plan: 已编译的计划或旧版扁平计划。
        source: 当前页面尺寸和参考分镜。

    Returns:
        可直接组装生图参数的计划，不检查剧情、台词覆盖率或镜头质量。
    """
    if not isinstance(plan, dict) or not isinstance(plan.get("sections"), list) or not plan["sections"]:
        raise ComicPlanError("模型没有返回可用的漫画生成区域。", "COMIC_PLAN_INVALID_OUTPUT", 502)
    plan["version"] = 1
    if not isinstance(plan.get("summary"), str):
        plan["summary"] = ""
    characters = plan.get("characters", [])
    if not isinstance(characters, list):
        characters = []
    character_ids = set()
    plan["characters"] = []
    for index, character in enumerate(characters):
        if not isinstance(character, dict):
            continue
        character_id = character.get("id")
        if not _valid_id(character_id):
            character_id = f"c{index + 1}"
        if character_id in character_ids:
            continue
        character_ids.add(character_id)
        plan["characters"].append({
            **character, "id": character_id,
            "name": character.get("name") if isinstance(character.get("name"), str) else character_id,
            "appearance": character.get("appearance") if isinstance(character.get("appearance"), str) else "",
        })
    # 模型多写的区域不能触发额外生图；少写时先生成已有区域。
    plan["sections"] = plan["sections"][:len(source["sections"])]
    for section, expected in zip(plan["sections"], source["sections"]):
        if not isinstance(section, dict):
            raise ComicPlanError("模型返回的生成区域不是对象。", "COMIC_PLAN_INVALID_OUTPUT", 502)
        section.update({key: expected[key] for key in ("id", "width", "height")})
        for key in ("globalPrompt", "negativePrompt"):
            if not isinstance(section.get(key), str):
                section[key] = ""
        for key in ("panels", "instances", "dialogues"):
            items = section.get(key)
            section[key] = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
        panels, instances, dialogues = section["panels"], section["instances"], section["dialogues"]
        for index, panel in enumerate(panels):
            if not _valid_id(panel.get("id")):
                panel["id"] = f"p{index + 1}"
            if type(panel.get("number")) is not int:
                panel["number"] = index + 1
            if not isinstance(panel.get("summary"), str):
                panel["summary"] = ""
        panel_ids = {panel["id"] for panel in panels}
        first_panel = panels[0]["id"] if panels else "p1"
        section["instances"] = instances = [item for item in instances if isinstance(item.get("prompt"), str) and item["prompt"].strip()]
        if len(instances) > 22:
            raise ComicPlanError("NovelAI V5 每张图片最多支持 22 个角色出场槽。", "COMIC_PLAN_INVALID_OUTPUT", 502)
        instances_by_panel = {panel_id: [] for panel_id in panel_ids}
        reference_panel_ids = {panel["id"] for _, panel in zip(expected["referencePanels"], panels)}
        for index, instance in enumerate(instances):
            if not _valid_id(instance.get("id")):
                instance["id"] = f"i{index + 1}"
            if not _valid_id(instance.get("panelId")) or instance["panelId"] not in panel_ids:
                instance["panelId"] = first_panel
            if not _valid_id(instance.get("characterId")) or instance["characterId"] not in character_ids:
                instance["characterId"] = None
            if not isinstance(instance.get("negativePrompt"), str):
                instance["negativePrompt"] = ""
            if not _valid_center(instance.get("center")):
                instance["center"] = {"x": 0.5, "y": 0.5}
                if instance["panelId"] not in reference_panel_ids:
                    section["useCoords"] = False
            if instance["panelId"] in instances_by_panel:
                instances_by_panel[instance["panelId"]].append(instance)
        for reference, panel in zip(expected["referencePanels"], panels):
            if source.get("coordinateSpace") == "page":
                continue
            group = instances_by_panel[panel["id"]]
            for index, instance in enumerate(group):
                # 已有参考框仍保留中心；多人在框中部横向分布。
                offset = 0 if len(group) == 1 else (index / (len(group) - 1) - 0.5) * reference["width"] * 0.5
                instance["center"] = {
                    "x": round(min(1.0, max(0.0, reference["center"]["x"] + offset)), 6),
                    "y": reference["center"]["y"],
                }
        section["dialogues"] = dialogues = [item for item in dialogues if isinstance(item.get("text"), str) and item["text"].strip()]
        dialogues.sort(key=lambda item: item["order"] if type(item.get("order")) is int else 0)
        for index, dialogue in enumerate(dialogues):
            if not _valid_id(dialogue.get("id")):
                dialogue["id"] = f"d{index + 1}"
            if not _valid_id(dialogue.get("panelId")) or dialogue["panelId"] not in panel_ids:
                dialogue["panelId"] = first_panel
            if not _valid_id(dialogue.get("speakerId")) or dialogue["speakerId"] not in character_ids:
                dialogue["speakerId"] = None
            if dialogue.get("type") not in ("speech", "narration", "sfx"):
                dialogue["type"] = "speech"
            if dialogue.get("direction") not in ("horizontal", "vertical"):
                dialogue["direction"] = "horizontal"
            dialogue["order"] = index + 1
    return plan


def plan_comic(
    client: NovelAIClient,
    token: str,
    subscription: dict[str, Any],
    payload: dict[str, Any],
    correlation_id: str | None = None,
) -> dict[str, Any]:
    """依次写故事、提取画风人物、设计漫画，三个阶段各请求一次。

    Args:
        client: 复用当前账号身份 TLS 的官方客户端。
        token: 只在内存中的当前登录令牌。
        subscription: 当前登录会话的订阅信息。
        payload: 当前页的剧情、角色、画风和生成区域。
        correlation_id: 当前请求的排查编号。

    Returns:
        完整漫画计划、故事正文、提取画风与阶段模型；失败不自动重试。
    """
    request_body, source = prepare_comic_request(payload, subscription)
    story_model = request_body["model"]
    stage_id = correlation_id or "comic"
    model_input = json.loads(request_body["messages"][-1]["content"])
    original_input = model_input["originalInput"]
    story_request = {
        "model": story_model,
        "messages": [
            {"role": "system", "content": STORY_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps({"originalInput": original_input}, ensure_ascii=False, indent=2)},
        ],
        "temperature": 0.8, "max_tokens": 2048,
        "enable_thinking": False, "stream": True,
    }
    story_draft = client.chat_completion(token, story_request, f"{stage_id}-story")
    extract_request = {
        "model": "glm-4-6",
        "messages": [
            {"role": "system", "content": EXTRACT_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps({"originalInput": original_input, "storyDraft": story_draft}, ensure_ascii=False, indent=2)},
        ],
        "temperature": 0.25, "max_tokens": 2048,
        "enable_thinking": False, "stream": True,
    }
    extracted_text = client.chat_completion(token, extract_request, f"{stage_id}-extract")
    try:
        fenced = re.fullmatch(r"\s*```(?:json)?\s*\n(.*?)\n```\s*", extracted_text, flags=re.DOTALL | re.IGNORECASE)
        extracted = json.loads(fenced[1] if fenced else extracted_text)
    except (ValueError, TypeError) as exc:
        raise ComicPlanError("模型没有返回完整的人物与画风 JSON，请重新编排。", "COMIC_PLAN_INVALID_JSON", 502) from exc
    if not isinstance(extracted, dict):
        raise ComicPlanError("模型没有返回可用的人物与画风对象。", "COMIC_PLAN_INVALID_OUTPUT", 502)
    visual_style = extracted.get("visualStyle", "")
    if not isinstance(visual_style, str):
        visual_style = ""
    characters = extracted.get("characters", [])
    if not isinstance(characters, list):
        characters = []
    # 只有提取的画师与画风进入固定前缀，原动作、场景与旧版式继续作为用户要求。
    source["protectedVisualPrefix"] = visual_style
    source["coordinateSpace"] = "page"
    model_input["storyDraft"] = story_draft
    model_input["visualStyle"] = visual_style
    model_input["characters"] = characters
    model_input["coordinateSpace"] = "page"
    request_body["messages"][-1] = {"role": "user", "content": json.dumps(model_input, ensure_ascii=False, indent=2)}
    request_body["model"] = "glm-4-6"
    request_body["temperature"] = 0.45
    text = client.chat_completion(token, request_body, f"{stage_id}-format")
    try:
        # 允许完整 JSON 外的一层 Markdown 包装，不摘片段、不补截断内容。
        fenced = re.fullmatch(r"\s*```(?:json)?\s*\n(.*?)\n```\s*", text, flags=re.DOTALL | re.IGNORECASE)
        if fenced:
            text = fenced[1]
        draft = json.loads(text)
    except (ValueError, TypeError) as exc:
        raise ComicPlanError("模型没有返回完整的 JSON 漫画计划，请重新编排。", "COMIC_PLAN_INVALID_JSON", 502) from exc
    if isinstance(draft, dict):
        draft["characters"] = characters
    plan = validate_comic_plan(compile_comic_plan(draft, source), source)
    for section in plan["sections"]:
        section["characterPromptsComplete"] = True
    plan["storyDraft"] = story_draft
    plan["visualStyle"] = visual_style
    plan["planningModels"] = {"story": story_model, "extract": "glm-4-6", "format": "glm-4-6"}
    return plan
