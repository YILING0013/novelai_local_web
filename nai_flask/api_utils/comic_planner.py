"""把漫画剧情编排成可供 NovelAI V5 使用的完整页面计划。"""

from __future__ import annotations

import json
import math
import re
from typing import Any

from .novelai_client import NovelAIClient


COMIC_MODELS = ("glm-4-6", "xialong-v1")
STORY_SYSTEM_PROMPT = """你是漫画编剧兼分镜师。把用户素材改编为有起因、行动、反应和收尾的漫画，结尾用看得见的动作兑现笑点、反转或感情变化。保留用户明确的人设、画风、角色标签和故事重点。给定台词尽量保留原文与语言，可按叙事重排并用 [sN] 标出引用；没有给台词时创作简短自然的对白。画外音可以跨空镜，不要求说话人出现在画面里；明确无字时用动作讲故事。
先写一段“整页分镜设计”，再用1.、2.、3.连续编号描述镜头。一般用5–8格，根据故事增减，不把这个数量当规则。整页设计必须说清视觉重心、主格与小格的大小关系、画框如何穿插和阅读动线；可以选择纵向主格、窄条切镜、斜切边框、重叠插格、局部破框或留白，但只用适合本段剧情的手法，不每页套同一布局，不把“复杂”理解为多加几排方格。
每格写出大致位置和画框设计、景别与机位、可见人物或物件、具体动作表情，以及说话人与台词。用远近、俯仰、正背侧面、手脚或物件特写、空镜和双人互动形成节奏，避免连续正面站桩。一个细节可以占小插格，关键行动可撑起主格；镜头中的人与道具关系要能一眼读懂。
不要输出百分比或精确长宽比例；仍然要具体描述宽窄、高矮、跨行、叠压、斜切和边框关系。参考框存在时围绕其布局编排。把完整故事安排在指定的一张或两张图片里。输出分镜设计与剧本，不输出JSON或分析过程。
"""

SYSTEM_PROMPT = """你是NovelAI V5漫画提示词作者。把storyDraft中的分镜设计和故事转成下面的JSON，只输出完整JSON。画面提示采用英文Danbooru标签与自然语言混合，台词使用原语言。
结构：
{"summary":"故事概要","characters":[{"id":"c1","name":"姓名","appearance":"稳定的人物外貌和服装标签"}],"sections":[{"globalPrompt":"漫画与画风标签，加具体整页分镜设计","negativePrompt":"本页不希望出现的内容","panels":[{"summary":"景别标签，加这格可画的画框、场景与动作","instances":[{"characterId":"c1","prompt":"本次出场可见的人物特征、机位标签和具体动作"}],"dialogues":[DIALOGUE_SCHEMA]}]}]}
globalPrompt负责真正的整页设计：先写适用的comic、multiple views、画风与环境标签，再具体描述主格的位置和形状、小格围绕它的排列、宽窄高矮对比、插格或破框与边框关系、阅读动线和光影。沿用storyDraft为本故事选择的设计，不要只写“非对称、电影感、大小不等”等空话，也不要自动排成相同的横向条带或1-2-1-2格子。斜切、叠格、纵向大格、无框画面按剧情选用，不把它们组合成每次固定的模板。
panel.summary也会传给生图：用from above、from below、from behind、profile、close-up、wide shot、dutch angle、hand focus等合适标签配合自然语言，写出这格的画框设计、景别、环境、道具和共同动作。空镜直接描述no humans与可见场景。不要把重要镜头只留在summary总览里。人物动作、道具状态与结尾变化应清楚可画。
每个可见人物每次出场使用独立instance；人物表保留固定外貌标签，instance.prompt写本次可见特征、机位、姿势、表情和动作，局部特写明确hands only、feet only或eye focus。一个槽只写这个人，不把另一人的全套描述也塞进来；共同动作放在该格summary。不要在同一人的提示中用solo否定同格实际存在的另一人。画外音没有人物槽，空镜instances可以为空。
坐标只在JSON元数据中给出：尽量为panel提供与版式设计一致的bounds={x,y,width,height}，是相对全页的近似占位；instance可加center={x,y}，是格内位置。它们用于人物定位，不代表必须把画框画成矩形网格；重叠插格可以占位重叠。没有可用的分镜位置时，程序让图像模型按画面提示自行排位。画面提示要保留版式设计，但不用百分比、精确长宽比或坐标数值。参考框存在时沿用其顺序。人物槽最多22个。
保留用户的画师、角色、配色和数值权重，不猜未提供的作品或画师。protectedVisualPrefix由程序原样前置，无需复制。未提供画风时可用monochrome、greyscale、screentones、lineart；明确彩色时按用户要求。角色与镜头以实际标签为骨架，用自然语言补充关系，不能整页只输出泛泛的散文。
NAI权重是n::内容::，负数是-n::概念::，并不固定为-1。按需要选择强度，例如1.4::overlapping panels::、-3::4koma::、-2.5::static composition::；不要把这些示例当每页必加的词。自由布局可针对方格、重复站姿等设负权重，用户明确要四格或网格时尊重它。UC使用正权重列不想要的内容，程序不再固定追加排除词。保留完整闭合的::分组，不使用(tag:1.2)。不要用排除词误伤用户要求的漫画、多视角、文字或画风。
保留故事的关键镜头和最后的可见收尾。对白放dialogues，不在画面字段重复写引号台词或Text块；程序会添加它们。dialogue默认type="speech"、direction="horizontal"，需要时可用narration/sfx或vertical；画外音可保留speakerId，旁白/sfx用null。无声镜头可省略dialogues，空镜可省略instances。人物之外的编号和顺序由程序生成。每张图的实际文字含分隔符应控制在750字符内。
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
    # 原始输入留在 source；模型只接收拆分后的素材，标题不再交给它重复分配。
    model_input = {key: value for key, value in source.items() if key not in {"text", "language"}}
    model_input["dialogueLanguage"] = source["language"]
    model_input["visualLanguage"] = "English"
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
    user_prompt = json.dumps(model_input, ensure_ascii=False, separators=(",", ":"))
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
                if instances:
                    compiled["useCoords"] = False
            summary = panel.get("summary", "")
            compiled_panel = {"id": panel_id, "number": panel_number, "summary": summary if isinstance(summary, str) else ""}
            if bounds is not None:
                compiled_panel["bounds"] = dict(bounds)
            compiled["panels"].append(compiled_panel)
            for instance_index, instance in enumerate(instances):
                if reference:
                    center = dict(reference["center"])
                elif bounds is None:
                    center = {"x": 0.5, "y": 0.5}
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
    """先写完整分镜故事，再由 GLM 整理结构，两阶段各请求一次。

    Args:
        client: 复用当前账号身份 TLS 的官方客户端。
        token: 只在内存中的当前登录令牌。
        subscription: 当前登录会话的订阅信息。
        payload: 当前页的剧情、角色、画风和生成区域。
        correlation_id: 当前请求的排查编号。

    Returns:
        完整漫画计划、写作原文与阶段模型；任何失败均不生图或自动重试。
    """
    request_body, source = prepare_comic_request(payload, subscription)
    story_model = request_body["model"]
    tier = subscription.get("tier")
    context_limit = 28672 if type(tier) is int and tier >= 3 else 12288 if tier == 2 else 8192
    stage_id = correlation_id or "comic"
    story_budget = 2048 if context_limit > 12288 else 1024 if context_limit > 8192 else 768
    story_request = {
        "model": story_model,
        "messages": [
            {"role": "system", "content": STORY_SYSTEM_PROMPT},
            dict(request_body["messages"][-1]),
        ],
        "temperature": 0.8, "max_tokens": story_budget,
        "enable_thinking": False, "stream": True,
    }
    story_draft = client.chat_completion(token, story_request, f"{stage_id}-story")
    # 第一阶段原文完整交给第二阶段，不能截断、替换成摘要或伪造补写内容。
    model_input = json.loads(request_body["messages"][-1]["content"])
    model_input["storyDraft"] = story_draft
    model_input["formatInstructions"] = (
        "把整页分镜设计明确写进globalPrompt，用英文标签加自然语言描述画框主次、形状、穿插与动线；"
        "不要用坐标代替版式描述。panel.summary写具体镜头，instance写该人物这次出场，dialogues保留台词。"
        "保留结尾的可见变化；不写精确百分比。"
    )
    request_body["messages"][-1] = {"role": "user", "content": json.dumps(model_input, ensure_ascii=False, separators=(",", ":"))}
    request_body["model"] = "glm-4-6"
    request_body["temperature"] = 0.45
    text = client.chat_completion(token, request_body, f"{stage_id}-format")
    try:
        # 允许完整 JSON 外的一层 Markdown 包装，不摘片段、不补截断内容。
        fenced = re.fullmatch(r"\s*```(?:json)?\s*\n(.*?)\n```\s*", text, flags=re.DOTALL | re.IGNORECASE)
        if fenced:
            text = fenced[1]
        plan = json.loads(text)
    except (ValueError, TypeError) as exc:
        raise ComicPlanError("模型没有返回完整的 JSON 漫画计划，请重新编排。", "COMIC_PLAN_INVALID_JSON", 502) from exc
    plan = validate_comic_plan(compile_comic_plan(plan, source), source)
    plan["storyDraft"] = story_draft
    plan["planningModels"] = {"story": story_model, "format": "glm-4-6"}
    return plan
