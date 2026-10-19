"""在本机识别漫画文字，按已确认的台词去字，返回可编辑文字的位置。"""

from __future__ import annotations

import hashlib
import math
import re
import threading
import unicodedata
from collections import Counter
from difflib import SequenceMatcher
from importlib.resources import files

import numpy as np
from PIL import Image

from .custom_errors import ExposableError


OCR_FILES = (
    {"name": "PP-OCRv6_det_small.onnx", "bytes": 9929594,
     "sha256": "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f"},
    {"name": "PP-OCRv6_rec_small.onnx", "bytes": 21234383,
     "sha256": "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884"},
    {"name": "ch_ppocr_mobile_v2.0_cls_mobile.onnx", "bytes": 585532,
     "sha256": "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c"},
)
WRITING_DIRECTIONS = {"horizontal-tb", "vertical-rl"}


def _run_cpu_model(session, inputs, run_options):
    """
    在已配置浮点模式的 ONNX 工作线程上运行 CTD 或 LaMa，并等待实际结果。

    Args:
        session: 使用 CPU 线程池和非正规数归零选项创建的 ONNX 会话。
        inputs: 模型输入张量。
        run_options: 当前任务的取消选项。

    Returns:
        模型输出列表；推理或取消失败时传播错误，由任务层记录状态。
    """
    finished = threading.Event()
    result = []

    def completed(outputs, _user_data, error):
        result.extend((outputs, error))
        finished.set()

    session.run_async(None, inputs, completed, None, run_options)
    finished.wait()
    if result[1]:
        raise RuntimeError(result[1])
    return result[0]


def validate_lettering_options(payload):
    """
    校验来自浏览器的台词和人工对应关系，不接受旧画框几何作为识别结果。

    Args:
        payload: 包含 dialogues、assignments、reading_direction 和 language 的请求。

    Returns:
        只包含文字重建所需字段的新字典。
    """
    dialogues = payload.get("dialogues", [])
    if not isinstance(dialogues, list) or len(dialogues) > 100:
        raise ExposableError("Provide at most 100 dialogue lines.", 400, "COMIC_DIALOGUES_INVALID")
    normalized = []
    identifiers = set()
    for index, item in enumerate(dialogues):
        if (not isinstance(item, dict) or not isinstance(item.get("id"), str)
                or not item["id"] or len(item["id"]) > 128 or item["id"] in identifiers
                or not isinstance(item.get("text"), str) or not item["text"].strip()
                or len(item["text"]) > 2000):
            raise ExposableError("Each dialogue needs a unique ID and nonempty text.", 400, "COMIC_DIALOGUES_INVALID")
        direction = item.get("direction", "horizontal-tb")
        if (not isinstance(direction, str) or direction not in WRITING_DIRECTIONS
                or item.get("type", "speech") not in ("speech", "narration", "sfx")):
            raise ExposableError("Unsupported dialogue direction or type.", 400, "COMIC_DIALOGUES_INVALID")
        order = item.get("order", index)
        if type(order) not in (int, float) or not math.isfinite(order):
            raise ExposableError("Dialogue order must be a finite number.", 400, "COMIC_DIALOGUES_INVALID")
        normalized.append({"id": item["id"], "text": item["text"], "direction": direction,
                           "type": item.get("type", "speech"), "order": order})
        identifiers.add(item["id"])
    assignments = payload.get("assignments", {})
    if (not isinstance(assignments, dict) or len(assignments) > 100
            or any(not isinstance(key, str) or not key or (value is not None and (not isinstance(value, str) or value not in identifiers))
                   for key, value in assignments.items())
            or len({value for value in assignments.values() if value is not None}) != sum(value is not None for value in assignments.values())):
        raise ExposableError("Assign each dialogue to one detected text block.", 400, "COMIC_ASSIGNMENTS_INVALID")
    reading_direction = payload.get("reading_direction", "ltr")
    language = payload.get("language", "zh")
    if reading_direction not in ("ltr", "rtl") or language not in ("zh", "zh-CN", "zh-TW", "en", "ja"):
        raise ExposableError("Choose a supported language and reading direction.", 400, "COMIC_LETTERING_OPTIONS_INVALID")
    return {"dialogues": sorted(normalized, key=lambda item: item["order"]),
            "assignments": dict(assignments), "reading_direction": reading_direction, "language": language}


def _comparable(text):
    """匹配时忽略空格、标点及全半角差异，保留原文用于最终嵌字。"""
    return re.sub(r"[\W_]", "", unicodedata.normalize("NFKC", text).casefold())


def match_dialogues(blocks, dialogues, assignments):
    """
    对齐真实文字块和规划台词；重复短句与相近候选保留人工核对。

    Args:
        blocks: 带 id、ocrText 和 confidence 的实际检测结果。
        dialogues: 已校验的规划台词。
        assignments: 用户明确选择的 blockId 到 dialogueId 对应关系；null 表示保留原字。

    Returns:
        新文字块列表；确定对应时填写 dialogueId，其余保持 needsReview。
    """
    by_id = {item["id"]: item for item in dialogues}
    block_ids = {block["id"] for block in blocks}
    if any(key not in block_ids for key in assignments):
        raise ExposableError("A selected text block is absent from this original image.", 400, "COMIC_ASSIGNMENT_NOT_FOUND")
    texts = [_comparable(block["ocrText"]) for block in blocks]
    scripts = [_comparable(item["text"]) for item in dialogues]
    repeated_texts, repeated_scripts = Counter(texts), Counter(scripts)
    used = {value for value in assignments.values() if value is not None}
    scores = [[SequenceMatcher(None, text, script).ratio() if text and script else 0
               for script in scripts] for text in texts]
    result = []
    for index, block in enumerate(blocks):
        item = {**block, "text": block["ocrText"], "dialogueId": None,
                "needsReview": True, "reason": "unmatched-text", "applied": False}
        selected = assignments.get(block["id"])
        if block["id"] in assignments and selected is None:
            item["reason"] = "kept-original"
        elif selected is None and dialogues and texts[index]:
            ranked = sorted(range(len(dialogues)), key=lambda j: scores[index][j], reverse=True)
            first = ranked[0]
            score = scores[index][first]
            second = scores[index][ranked[1]] if len(ranked) > 1 else 0
            competitors = [scores[i][first] for i in range(len(blocks)) if i != index and blocks[i]["id"] not in assignments]
            exact = texts[index] == scripts[first]
            repeated = repeated_texts[texts[index]] > 1 or repeated_scripts[scripts[first]] > 1
            # 短句只能精确对应；不能靠阅读顺序把漏字、串泡或重复的“嗯”猜给某个人。
            certain = (not repeated and dialogues[first]["id"] not in used
                       and block.get("confidence", 0) >= 0.6
                       and (exact or (len(texts[index]) >= 4 and score >= 0.86))
                       and score - second >= 0.12 and score - max(competitors, default=0) >= 0.12)
            if certain:
                selected = dialogues[first]["id"]
                used.add(selected)
            elif score >= 0.4:
                item["reason"] = "ambiguous-match"
        if selected is not None:
            dialogue = by_id[selected]
            item.update(text=dialogue["text"], dialogueId=selected, direction=dialogue["direction"],
                        needsReview=False, reason=None)
        result.append(item)
    return result


def _collect_blocks(rgb, mask, detector_boxes, ocr, reading_direction, source_hash):
    """合并同一真实气泡内的文字行；未识别出内容的字形也保留供人工对应。"""
    import cv2

    height, width = mask.shape
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    # 只用封闭的明亮区域合并文字行；与页边连通的大块白背景不当作一个气泡。
    paper = ((gray >= 210) & (rgb.max(2).astype(int) - rgb.min(2).astype(int) < 45)).astype(np.uint8)
    paper[cv2.dilate(mask, np.ones((3, 3), np.uint8)) > 0] = 1
    _, labels, stats, _ = cv2.connectedComponentsWithStats(paper, connectivity=4)
    lines = []
    covered = np.zeros_like(mask)
    boxes = [] if ocr.boxes is None else ocr.boxes
    for index, polygon in enumerate(boxes):
        x0, y0 = np.maximum(0, np.floor(np.min(polygon, axis=0)).astype(int))
        x1, y1 = np.minimum([width, height], np.ceil(np.max(polygon, axis=0)).astype(int))
        if x1 <= x0 or y1 <= y0:
            continue
        covered[max(0, y0 - 3):min(height, y1 + 3), max(0, x0 - 3):min(width, x1 + 3)] = 255
        lines.append({"rect": [int(x0), int(y0), int(x1), int(y1)],
                      "text": str(ocr.txts[index]), "confidence": float(ocr.scores[index])})

    # 漏识别的字形先作为文字行加入，再和 OCR 共用气泡/检测框归组。
    # 不能先完成 OCR 分块后独立追加，否则同一句台词会被拆成多个不能一对一人工对应的块。
    remaining = mask.copy()
    remaining[covered > 0] = 0
    grouped = cv2.dilate(remaining, np.ones((9, 9), np.uint8))
    count, _, components, _ = cv2.connectedComponentsWithStats(grouped)
    for index in range(1, count):
        x, y, w, h, _ = (int(value) for value in components[index])
        if np.count_nonzero(remaining[y:y + h, x:x + w]) >= 20:
            lines.append({"rect": [x, y, x + w, y + h], "text": "", "confidence": 0.0})

    groups = {}
    for index, line in enumerate(lines):
        x0, y0, x1, y1 = line["rect"]
        cx, cy = min(width - 1, (x0 + x1) // 2), min(height - 1, (y0 + y1) // 2)
        label = int(labels[cy, cx])
        bx, by, bw, bh, area = stats[label]
        # 区域必须包住整行；仅由蒙版补白生成的小色块不算气泡，交给 CTD 框判断。
        bounded = (label and 0 < bx <= x0 and 0 < by <= y0 and x1 <= bx + bw < width
                   and y1 <= by + bh < height and area < width * height * 0.25)
        key = ("bubble", label) if bounded else ("line", index)
        if not bounded:
            enclosing = [(i, box) for i, box in enumerate(detector_boxes) if box[0] <= cx <= box[2] and box[1] <= cy <= box[3]]
            if enclosing:
                key = ("detector", min(enclosing, key=lambda entry: (entry[1][2] - entry[1][0]) * (entry[1][3] - entry[1][1]))[0])
        groups.setdefault(key, []).append(line)

    regions = []
    for lines in groups.values():
        lines.sort(key=lambda line: (line["rect"][1], -line["rect"][0] if reading_direction == "rtl" else line["rect"][0]))
        x0 = max(0, min(line["rect"][0] for line in lines) - 3)
        y0 = max(0, min(line["rect"][1] for line in lines) - 3)
        x1 = min(width, max(line["rect"][2] for line in lines) + 3)
        y1 = min(height, max(line["rect"][3] for line in lines) + 3)
        regions.append(([x0, y0, x1, y1], "\n".join(line["text"] for line in lines if line["text"]),
                        min(line["confidence"] for line in lines), len(lines)))
    regions.sort(key=lambda item: (item[0][1], -item[0][0] if reading_direction == "rtl" else item[0][0]))
    blocks = []
    for rect, text, confidence, line_count in regions:
        x0, y0, x1, y1 = rect
        identifier = hashlib.sha256(f"{source_hash}:{x0},{y0},{x1},{y1}".encode()).hexdigest()[:16]
        vertical = y1 - y0 > (x1 - x0) * 1.4 and bool(re.search(r"[\u3040-\u30ff\u3400-\u9fff]", text))
        blocks.append({"id": f"text-{identifier}", "bounds": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
                       "direction": "vertical-rl" if vertical else "horizontal-tb", "ocrText": text,
                       "confidence": round(confidence, 4), "color": "#111111",
                       "fontSize": round(max(10, (x1 - x0) if vertical else (y1 - y0) / (line_count * 1.25)), 1)})
    return blocks


def _largest_inner_rectangle(mask, center):
    """在气泡内部寻找最大面积矩形，面积相同时优先靠近原文字中心。

    Args:
        mask: 裁到气泡外接框的非空内部蒙版，非零像素均允许排版。
        center: 原文字中心在该裁剪区域内的 (x, y) 坐标。

    Returns:
        裁剪区域内的 (x, y, width, height)，矩形每个像素都在气泡内部。
    """
    heights = np.zeros(mask.shape[1], dtype=np.int32)
    best = (0, 0, 0, 0)
    best_area, best_distance = 0, math.inf
    for bottom, row in enumerate(mask):
        heights = np.where(row > 0, heights + 1, 0)
        stack = []
        # 每行看作连续内部像素的高度直方图；单调栈枚举以该行为底的最大矩形。
        for right in range(len(heights) + 1):
            height = int(heights[right]) if right < len(heights) else 0
            left = right
            while stack and stack[-1][1] > height:
                left, previous_height = stack.pop()
                width = right - left
                top = bottom - previous_height + 1
                area = width * previous_height
                distance = (left + width / 2 - center[0]) ** 2 + (top + previous_height / 2 - center[1]) ** 2
                if area > best_area or (area == best_area and distance < best_distance):
                    best = (left, top, width, previous_height)
                    best_area, best_distance = area, distance
            if height and (not stack or stack[-1][1] < height):
                stack.append((left, height))
    return best


class ComicLettering:
    """一个漫画任务使用的 CPU 模型组；只处理实际字形，不识别或裁切分镜。"""

    def __init__(self, folder, threads, validate_file, check_cancelled):
        """
        加载固定的 CTD 和 OCR，LaMa 在首次需要复杂背景修复时加载。

        Args:
            folder: 已下载并校验过 CTD、LaMa 的目录。
            threads: CPU 线程数。
            validate_file: 现有模型文件大小和 SHA256 校验函数。
            check_cancelled: 已取消时抛出异常。
        """
        import onnxruntime as ort
        from rapidocr import RapidOCR

        self.folder = folder
        self.threads = threads
        self.session_options = ort.SessionOptions()
        # run_async 不让外部调用线程参与计算；线程池实际创建 threads 个工作线程。
        self.session_options.intra_op_num_threads = threads + 1
        self.session_options.log_severity_level = 3
        # CTD 卷积中的极小浮点数会让 CPU 处理同图时从秒级退化到分钟级。
        # run_async 保证计算始终落在启用此选项的线程，避开每次任务新建的 Python 线程。
        self.session_options.add_session_config_entry("session.set_denormal_as_zero", "1")
        self.ctd = ort.InferenceSession(str(folder / "comictextdetector.pt.onnx"), self.session_options,
                                       providers=["CPUExecutionProvider"])
        check_cancelled()
        bundled = files("rapidocr") / "models"
        for file in OCR_FILES:
            if not validate_file(bundled / file["name"], file):
                raise ExposableError("Reinstall rapidocr 3.10.0 to restore its OCR models.", 503, "COMIC_OCR_MODEL_INVALID")
        self.ocr = RapidOCR(params={
            "Det.model_path": str(bundled / OCR_FILES[0]["name"]),
            "Rec.model_path": str(bundled / OCR_FILES[1]["name"]),
            "Cls.model_path": str(bundled / OCR_FILES[2]["name"]),
            "EngineConfig.onnxruntime.intra_op_num_threads": threads,
            "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            "EngineConfig.onnxruntime.use_cuda": False,
            "EngineConfig.onnxruntime.use_dml": False,
            "Global.log_level": "error",
        })
        self.lama = None
        check_cancelled()

    def rebuild(self, source, options, progress, check_cancelled, run_options):
        """
        从原图重新识别和去字，保留不确定区域，输出底图、实际擦除蒙版和文字层资料。

        Args:
            source: Pillow 原始图片，每次人工纠正均须使用同一原图。
            options: 已校验的台词、语言、阅读方向和人工对应关系。
            progress: 接收阶段、完成数和总数的回调。
            check_cancelled: 在模型和文字块之间检查取消。
            run_options: 本次任务可终止的 ONNX RunOptions。

        Returns:
            (Pillow 底图, Pillow 蒙版, 包含 blocks、sourceHash、unmatchedDialogueIds 的字典)。
        """
        import cv2
        import onnxruntime as ort

        original = source.convert("RGBA" if source.mode in {"RGBA", "LA", "P"} else "RGB")
        if original.mode == "RGBA":
            paper = Image.new("RGBA", source.size, "white")
            paper.alpha_composite(original)
            rgb = np.asarray(paper.convert("RGB"))
        else:
            rgb = np.asarray(original)
        height, width = rgb.shape[:2]
        source_hash = hashlib.sha256(f"{width}x{height}:".encode() + original.tobytes()).hexdigest()
        check_cancelled()
        progress("detecting-text", 0, 1)
        size = int(self.ctd.get_inputs()[0].shape[2])
        ratio = size / max(height, width)
        scaled_width, scaled_height = max(1, round(width * ratio)), max(1, round(height * ratio))
        padded = np.zeros((size, size, 3), dtype=np.uint8)
        padded[:scaled_height, :scaled_width] = cv2.resize(rgb, (scaled_width, scaled_height))
        prediction, segmentation, _ = _run_cpu_model(self.ctd, {self.ctd.get_inputs()[0].name:
                                                              padded.transpose(2, 0, 1)[None].astype(np.float32) / 255}, run_options)
        check_cancelled()
        segmentation = cv2.resize(segmentation[0, 0], (size, size))[:scaled_height, :scaled_width]
        mask = (cv2.resize(segmentation, (width, height)) >= 0.3).astype(np.uint8) * 255
        detector_boxes = []
        candidates = prediction[0]
        confidence = candidates[:, 4] * candidates[:, 5:].max(axis=1)
        for cx, cy, w, h, *_ in candidates[confidence >= 0.4]:
            detector_boxes.append([max(0, (cx - w / 2) / ratio), max(0, (cy - h / 2) / ratio),
                                   min(width, (cx + w / 2) / ratio), min(height, (cy + h / 2) / ratio)])
        progress("recognizing-text", 0, 1)
        # PIL 输入明确为 RGB，避免把 OpenCV 的 BGR 约定误用于彩图。
        ocr = self.ocr(Image.fromarray(rgb))
        check_cancelled()
        blocks = _collect_blocks(rgb, mask, detector_boxes, ocr, options["reading_direction"], source_hash)
        progress("matching-dialogue", 0, len(blocks))
        blocks = match_dialogues(blocks, options["dialogues"], options["assignments"])
        output = np.array(original)
        # 识别时透明区域垫白；修复颜色仍取原始 RGB，避免半透明像素被再次混白。
        original_rgb = np.asarray(original)[:, :, :3]
        erased = np.zeros_like(mask)
        # 去字蒙版可能误认气泡尾线。这里使用未被蒙版补白的原图寻找封闭内部，
        # 与检测块的 bounds/ID 分开，避免人工对应失效或把尾巴当作可排版空间。
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        paper = ((gray >= 210) & (rgb.max(2).astype(int) - rgb.min(2).astype(int) < 45)).astype(np.uint8)
        _, bubble_labels, bubble_stats, _ = cv2.connectedComponentsWithStats(paper, connectivity=4)
        for index, block in enumerate(blocks):
            check_cancelled()
            progress("cleaning-text", index, len(blocks))
            if block["needsReview"]:
                continue
            bounds = block["bounds"]
            x, y, w, h = (bounds[key] for key in ("x", "y", "width", "height"))
            local_mask = np.zeros_like(mask)
            local_mask[y:y + h, x:x + w] = mask[y:y + h, x:x + w]
            local_mask = cv2.dilate(local_mask, np.ones((3, 3), np.uint8))
            bubble_mask = None
            candidates = np.bincount(bubble_labels[y:y + h, x:x + w].ravel(), minlength=len(bubble_stats))
            for label in np.argsort(candidates)[::-1]:
                bx, by, bw, bh, area = bubble_stats[label]
                if (not label or not candidates[label] or bx <= 0 or by <= 0 or bx + bw >= width
                        or by + bh >= height or area >= width * height * 0.25):
                    continue
                region = (bubble_labels == label).astype(np.uint8) * 255
                contours, _ = cv2.findContours(region, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                cv2.drawContours(region, contours, -1, 255, cv2.FILLED)
                region = cv2.erode(region, np.ones((3, 3), np.uint8))
                if np.count_nonzero(local_mask & region) < max(4, np.count_nonzero(local_mask) * 0.6):
                    continue
                bubble_mask = region
                local_mask &= bubble_mask
                # 气泡尾巴会拉长外接框，固定高度求交集可能只剩 1 像素窄条。
                # 在真实内部寻找最大可用矩形，不借用可能越过轮廓的 OCR 外接框。
                left, top, layout_width, layout_height = _largest_inner_rectangle(
                    region[by:by + bh, bx:bx + bw], (x + w / 2 - bx, y + h / 2 - by),
                )
                block["layoutBounds"] = {"x": int(bx + left), "y": int(by + top),
                                         "width": layout_width, "height": layout_height}
                break
            if np.count_nonzero(local_mask) < 4:
                block.update(needsReview=True, reason="text-mask-missing")
                continue
            ring = (cv2.dilate(local_mask, np.ones((11, 11), np.uint8)) > 0) & (local_mask == 0) & (mask == 0)
            samples = original_rgb[ring]
            if not len(samples):
                block.update(needsReview=True, reason="background-unavailable")
                continue
            background = np.median(samples, axis=0)
            uniform = np.mean(np.max(np.abs(samples.astype(float) - background), axis=1) <= 14) >= 0.85
            if uniform:
                # CTD 会漏掉“一”或句点这类细小字形。只在已读出的文字框内补充
                # 与背景有明显色差、且不接触框边的笔画，避免把穿过文字框的线稿当字擦掉。
                contrast = (np.max(np.abs(original_rgb[y:y + h, x:x + w].astype(float) - background), axis=2) > 20).astype(np.uint8)
                count, components, stats, _ = cv2.connectedComponentsWithStats(contrast)
                for component in range(1, count):
                    sx, sy, sw, sh, _ = stats[component]
                    if sx > 0 and sy > 0 and sx + sw < w and sy + sh < h:
                        local_mask[y:y + h, x:x + w][components == component] = 255
                local_mask = cv2.dilate(local_mask, np.ones((3, 3), np.uint8))
                if bubble_mask is not None:
                    local_mask &= bubble_mask
            # 重叠或串在一起的待核对文字不能被另一个确定的块顺带擦掉。
            overlaps = False
            for other in blocks:
                if other["id"] != block["id"] and other["needsReview"]:
                    box = other["bounds"]
                    if np.any(local_mask[box["y"]:box["y"] + box["height"], box["x"]:box["x"] + box["width"]]):
                        overlaps = True
                        break
            if overlaps:
                block.update(needsReview=True, reason="overlapping-text")
                continue
            glyph_pixels = original_rgb[local_mask > 0]
            if not len(glyph_pixels):
                block.update(needsReview=True, reason="overlapping-text")
                continue
            luma = glyph_pixels.mean(1)
            foreground = glyph_pixels[luma <= np.percentile(luma, 30)] if background.mean() >= 128 else glyph_pixels[luma >= np.percentile(luma, 70)]
            color = np.median(foreground, axis=0).astype(np.uint8)
            block["color"] = "#" + "".join(f"{value:02x}" for value in color)
            if uniform:
                output[local_mask > 0, :3] = np.rint(background).astype(np.uint8)
                block["eraseMethod"] = "bubble-fill"
            else:
                if self.lama is None:
                    progress("loading-inpaint", index, len(blocks))
                    self.lama = ort.InferenceSession(str(self.folder / "lama_fp32.onnx"), self.session_options,
                                                    providers=["CPUExecutionProvider"])
                    check_cancelled()
                padding = max(32, round(max(w, h) * 0.3))
                x0, y0 = max(0, x - padding), max(0, y - padding)
                x1, y1 = min(width, x + w + padding), min(height, y + h + padding)
                crop, crop_mask = original_rgb[y0:y1, x0:x1], local_mask[y0:y1, x0:x1]
                scale = min(1.0, 512 / max(crop.shape[:2]))
                cw, ch = max(1, round(crop.shape[1] * scale)), max(1, round(crop.shape[0] * scale))
                image_input = cv2.copyMakeBorder(cv2.resize(crop, (cw, ch)), 0, 512 - ch, 0, 512 - cw, cv2.BORDER_REFLECT_101)
                mask_input = np.zeros((512, 512), np.float32)
                mask_input[:ch, :cw] = cv2.resize(crop_mask, (cw, ch), interpolation=cv2.INTER_NEAREST) > 0
                progress("inpainting-text", index, len(blocks))
                repaired = _run_cpu_model(self.lama, {"image": image_input.transpose(2, 0, 1)[None].astype(np.float32) / 255,
                                                     "mask": mask_input[None, None]}, run_options)[0]
                check_cancelled()
                repaired = np.clip(repaired[0].transpose(1, 2, 0)[:ch, :cw], 0, 255).astype(np.uint8)
                repaired = cv2.resize(repaired, (x1 - x0, y1 - y0))
                # 模型预测的其余像素从不写回，避免整块气泡、线稿或颜色被重绘。
                target = output[y0:y1, x0:x1, :3]
                target[crop_mask > 0] = repaired[crop_mask > 0]
                block["eraseMethod"] = "lama"
            erased[local_mask > 0] = 255
            block["applied"] = True
        check_cancelled()
        progress("cleaning-text", len(blocks), len(blocks))
        applied = {block["dialogueId"] for block in blocks if block["applied"]}
        return Image.fromarray(output), Image.fromarray(erased), {
            "sourceHash": source_hash, "blocks": blocks,
            "unmatchedDialogueIds": [item["id"] for item in options["dialogues"] if item["id"] not in applied],
        }
