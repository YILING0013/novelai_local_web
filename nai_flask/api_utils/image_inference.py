"""Python 图像预处理、标签解码与透明图片分块放大。"""

import csv
import math
from collections import deque

from PIL import Image, ImageOps

from .custom_errors import ExposableError


CATEGORIES = {"0": "general", "1": "style", "3": "copyright", "4": "character", "5": "meta", "9": "rating"}
KAOMOJI = {"0_0", "(o)_(o)", "+_+", "+_-", "._.", "<o>_<o>", "<|>_<|>", "=_=", ">_<", "3_3", "6_9", ">_o", "@_@", "^_^", "o_o", "u_u", "x_x", "|_|", "||_||"}


def prepare_tagger_input(image, model):
    """
    按固定模型发布说明缩放和补边，输出 ONNX 输入数组。

    Args:
        image: Pillow 图像，透明像素先合成到白色。
        model: 模型清单中的输入尺寸和预处理约定。

    Returns:
        float32 NumPy 数组；WD 为 BGR NHWC 0–255，PixAI 为 RGB NCHW -1–1。
    """
    import numpy as np

    rgba = ImageOps.exif_transpose(image).convert("RGBA")
    rgb = Image.new("RGB", rgba.size, "white")
    rgb.paste(rgba, mask=rgba.getchannel("A"))
    size = model["inputSize"]
    if model["preprocessing"] == "wd-swinv2":
        side = max(rgb.size)
        padded = Image.new("RGB", (side, side), "white")
        padded.paste(rgb, ((side - rgb.width) // 2, (side - rgb.height) // 2))
        array = np.asarray(padded.resize((size, size), Image.Resampling.BICUBIC), dtype=np.float32)
        return np.ascontiguousarray(array[None, :, :, ::-1])
    ratio = size / max(rgb.size)
    resized = rgb.resize((max(1, round(rgb.width * ratio)), max(1, round(rgb.height * ratio))), Image.Resampling.BICUBIC)
    padded = Image.new("RGB", (size, size), "black")
    padded.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    array = np.asarray(padded, dtype=np.float32) / 127.5 - 1
    return np.ascontiguousarray(array.transpose(2, 0, 1)[None])


def decode_tagger_output(scores, labels_path, model, thresholds):
    """
    按发布包标签顺序和分类阈值解析概率，不对已带 sigmoid 的输出重复计算。

    Args:
        scores: ONNX 输出概率数组。
        labels_path: 同一固定版本的 selected_tags.csv。
        model: 包含标签数量及默认阈值的模型配置。
        thresholds: 用户覆盖的一般标签和角色阈值。

    Returns:
        包含分类、置信度和可复制提示词的结果对象。
    """
    import numpy as np

    with labels_path.open(encoding="utf-8-sig", newline="") as file:
        labels = list(csv.DictReader(file))
    scores = np.asarray(scores).reshape(-1)
    if len(scores) != len(labels) or len(labels) != model["labelCount"] or not np.isfinite(scores).all():
        raise ExposableError("Model output does not match the labels.", 500, "LOCAL_MODEL_LABELS_MISMATCH")
    limits = {**model["defaultThresholds"], **thresholds}
    tags = []
    for score, label in zip(scores, labels):
        category = CATEGORIES.get(label.get("category"))
        if category is None or not label.get("name"):
            raise ExposableError("Model labels are invalid.", 500, "LOCAL_MODEL_LABELS_MISMATCH")
        if category == "rating" or score <= limits[category]:
            continue
        tag = label["name"]
        tags.append({"tag": tag if tag in KAOMOJI else tag.replace("_", " "), "category": category, "confidence": float(score)})
    tags.sort(key=lambda item: item["confidence"], reverse=True)
    return {"tags": tags, "text": ", ".join(item["tag"] for item in tags)}


def upscale_image(image, model, run_tile, progress, check_cancelled, scale=4):
    """
    通过重叠分块进行神经网络放大，融合接缝并保留原始 Alpha。

    Args:
        image: Pillow 源图。
        model: 固定模型的原生倍数、块尺寸、上下文和输出裁剪配置。
        run_tile: 接收 NCHW 数组并返回模型输出的函数。
        progress: 每块完成后接收 completed、total。
        check_cancelled: 任务已取消时抛出异常的函数。
        scale: 用户选择的 2、3 或 4 倍，较小倍数在原生放大后缩小。

    Returns:
        已放大的 RGBA Pillow 图像。
    """
    import numpy as np

    image = ImageOps.exif_transpose(image).convert("RGBA")
    width, height = image.size
    native = model["scale"]
    if width * height * native * native > 32_000_000 or max(width, height) * native > 16384:
        raise ExposableError("The native 4x output exceeds 32 megapixels or 16384 pixels per side.", 400, "LOCAL_UPSCALE_SIZE")
    pixels = np.asarray(image)
    size, context, offset = model["tileSize"], model["tileContext"], model["outputOffset"]
    core = size - context * 2
    blend = 16
    step = core - blend // native
    crop = context * native - offset
    expected = size * native - offset * 2
    columns = max(1, math.ceil((width - core) / step) + 1)
    rows = max(1, math.ceil((height - core) / step) + 1)
    output = np.zeros((height * native, width * native, 3), dtype=np.uint8)
    weights = np.zeros((height * native, width * native), dtype=np.float32)
    for row in range(rows):
        for column in range(columns):
            check_cancelled()
            left, top = column * step, row * step
            xs = np.clip(np.arange(size) + left - context, 0, width - 1)
            ys = np.clip(np.arange(size) + top - context, 0, height - 1)
            tile = pixels[ys[:, None], xs[None, :]]
            colors = tile[:, :, :3].copy()
            known = tile[:, :, 3] > 0
            if not known.all() and known.any():
                # 只在小块里向透明区扩散可见颜色，避免黑色透明像素污染网络输出边缘。
                queue = deque(map(tuple, np.argwhere(known)))
                while queue:
                    y, x = queue.popleft()
                    for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                        if 0 <= ny < size and 0 <= nx < size and not known[ny, nx]:
                            colors[ny, nx] = colors[y, x]
                            known[ny, nx] = True
                            queue.append((ny, nx))
            tensor = np.ascontiguousarray(colors.transpose(2, 0, 1)[None], dtype=np.float32) / 255
            predicted = run_tile(tensor)
            if predicted.shape != (1, 3, expected, expected) or not np.isfinite(predicted).all():
                raise ExposableError("The upscaling model returned an invalid output.", 500, "LOCAL_UPSCALE_OUTPUT")
            check_cancelled()
            copy_w, copy_h = min(core, width - left) * native, min(core, height - top) * native
            rgb = predicted[0, :, crop:crop + copy_h, crop:crop + copy_w].transpose(1, 2, 0) * 255
            wx, wy = np.ones(copy_w, dtype=np.float32), np.ones(copy_h, dtype=np.float32)
            if column > 0:
                wx = np.minimum(wx, (np.arange(copy_w) + 1) / (blend + 1))
            if column < columns - 1:
                wx = np.minimum(wx, (copy_w - np.arange(copy_w)) / (blend + 1))
            if row > 0:
                wy = np.minimum(wy, (np.arange(copy_h) + 1) / (blend + 1))
            if row < rows - 1:
                wy = np.minimum(wy, (copy_h - np.arange(copy_h)) / (blend + 1))
            weight = (wy[:, None] * wx[None, :]).astype(np.float32)
            dest = np.s_[top * native:top * native + copy_h, left * native:left * native + copy_w]
            previous = weights[dest]
            combined = previous + weight
            output[dest] = np.rint(np.clip((output[dest] * previous[:, :, None] + rgb * weight[:, :, None]) / combined[:, :, None], 0, 255)).astype(np.uint8)
            weights[dest] = combined
            progress(row * columns + column + 1, rows * columns)
    result = Image.fromarray(output).convert("RGBA")
    result.putalpha(image.getchannel("A").resize(result.size, Image.Resampling.BILINEAR))
    if scale != native:
        result = result.resize((width * scale, height * scale), Image.Resampling.LANCZOS)
    return result
