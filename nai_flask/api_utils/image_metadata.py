"""读取和另存 NovelAI 图片的文本、EXIF 与 alpha 隐写元数据。"""

from __future__ import annotations

import base64
import copy
import gzip
import io
import json
import re

from PIL import ExifTags, Image, PngImagePlugin


MAX_METADATA_BYTES = 4 * 1024 * 1024
CONTAINERS = {"metadata", "JSON", "Comment", "Description", "parameters", "UserComment"}
PARAMETER_ALIASES = {
    "positivePrompt": ("positivePrompt", "prompt", "input", "Description"),
    "negativePrompt": ("negativePrompt", "negative_prompt", "uc"),
    "guidanceScale": ("guidanceScale", "scale"),
    "noiseSchedule": ("noiseSchedule", "noise_schedule"),
    "promptGuidanceRescale": ("promptGuidanceRescale", "cfg_rescale"),
    "smea": ("smea", "sm"), "dyn": ("dyn", "sm_dyn"),
    "model": ("model", "model_name"),
}
for _key in ("width", "height", "steps", "seed", "sampler", "use_coords", "ucPresetId",
             "qualityPresetId", "variety", "decrisp", "legacy", "legacy_uc",
             "legacy_v3_extend", "prefer_brownian", "deliberate_euler_ancestral_bug"):
    PARAMETER_ALIASES[_key] = (_key,)


def _decode(value):
    if isinstance(value, bytes):
        if value.startswith(b"UNICODE\x00"):
            value = value[8:].decode("utf-16", errors="replace").rstrip("\x00")
        elif value.startswith(b"ASCII\x00\x00\x00"):
            value = value[8:].decode("utf-8", errors="replace").rstrip("\x00")
        else:
            return {"binary_base64": base64.b64encode(value).decode("ascii")}
    if isinstance(value, str):
        # 官方图片存在 Comment 中再次包含 JSON 字符串 Comment 的情况。
        try:
            decoded = json.loads(value)
        except (json.JSONDecodeError, RecursionError):
            return value
        if isinstance(decoded, (dict, list)):
            return _decode(decoded)
        return value
    if isinstance(value, dict):
        return {str(key): _decode(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_decode(item) for item in value]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    # Pillow 的 IFDRational 可精确描述为分子、分母，供 EXIF 写回。
    if hasattr(value, "numerator") and hasattr(value, "denominator"):
        return {"rational": [value.numerator, value.denominator]}
    return str(value)


def read_stealth_metadata(image, channel="alpha"):
    """
    读取列优先 alpha 隐写及社区 RGB LSB 格式，损坏数据抛出明确错误。

    Args:
        image: 已打开的 Pillow 图像。
        channel: alpha 读取官方通道，rgb 读取社区兼容通道。

    Returns:
        解码后的 JSON 或文字；没有该通道签名时返回 None。
    """
    channels = 1 if channel == "alpha" else 3
    if (channel == "alpha" and "A" not in image.getbands()) or image.width * image.height * channels < 152:
        return None
    pixels = image.getchannel("A").load() if channel == "alpha" else image.convert("RGB").load()
    position = 0

    def read_bytes(length):
        nonlocal position
        if position + length * 8 > image.width * image.height * channels:
            raise ValueError("The embedded NovelAI metadata is incomplete.")
        result = bytearray(length)
        for index in range(length):
            value = 0
            for _ in range(8):
                pixel_index, component = divmod(position, channels)
                x, y = divmod(pixel_index, image.height)
                sample = pixels[x, y] if channels == 1 else pixels[x, y][component]
                value = (value << 1) | (sample & 1)
                position += 1
            result[index] = value
        return bytes(result)

    magic = read_bytes(15)
    prefix = b"stealth_png" if channel == "alpha" else b"stealth_rgb"
    if magic not in {prefix + b"comp", prefix + b"info"}:
        return None
    bit_length = int.from_bytes(read_bytes(4), "big")
    if bit_length % 8 or bit_length <= 0 or bit_length // 8 > MAX_METADATA_BYTES:
        raise ValueError("The embedded NovelAI metadata length is invalid.")
    content = read_bytes(bit_length // 8)
    if magic.endswith(b"comp"):
        with gzip.GzipFile(fileobj=io.BytesIO(content)) as compressed:
            content = compressed.read(MAX_METADATA_BYTES + 1)
    if len(content) > MAX_METADATA_BYTES:
        raise ValueError("The embedded NovelAI metadata is too large.")
    return _decode(content.decode("utf-8"))


def read_metadata_document(image):
    """
    读取可编辑的元数据树，并保留未知 JSON 字段和 EXIF 标签。

    Args:
        image: 已打开的 Pillow 图片。

    Returns:
        文档字典与读取警告列表；文档按 png、exif、stealth 分载体。
    """
    document, warnings = {}, []
    text = {key: _decode(value) for key, value in image.info.items() if isinstance(value, str)}
    if text:
        document["png"] = text
    exif = image.getexif()
    tags = dict(exif)
    if 34665 in exif:
        tags.update(exif.get_ifd(34665))
    tags.pop(34665, None)  # 子 IFD 指针由 Pillow 重建，不能复用原文件偏移。
    for pointer in (34853, 40965):
        if pointer in tags:
            tags[pointer] = exif.get_ifd(pointer)
    if tags:
        document["exif"] = {
            str(key): {"name": ExifTags.TAGS.get(key, str(key)), "value": _decode(value)}
            for key, value in tags.items()
        }
    for channel, key in (("alpha", "stealth"), ("rgb", "stealth_rgb")):
        try:
            stealth = read_stealth_metadata(image, channel)
        except (ValueError, OSError, EOFError) as exc:
            warnings.append(f"{channel}: {exc}")
            stealth = None
        if stealth is not None:
            document[key] = _decode(stealth)
    return document, warnings


def _parameter_scopes(document):
    """只遍历已知参数容器，不把未知业务对象中的 prompt 当作主提示词。"""
    def descend(value, path):
        if not isinstance(value, dict):
            return
        yield value, path
        for key, item in value.items():
            if key in CONTAINERS and isinstance(item, dict):
                yield from descend(item, [*path, key])

    png = document.get("png", {})
    if isinstance(png, dict):
        yield from descend(png, ["png"])
    for tag, entry in document.get("exif", {}).items():
        if tag in {"37510", "270"} and isinstance(entry, dict):
            yield from descend(entry.get("value"), ["exif", tag, "value"])
    yield from descend(document.get("stealth"), ["stealth"])
    yield from descend(document.get("stealth_rgb"), ["stealth_rgb"])


def metadata_parameters(document):
    """
    合并各已知载体的生成参数，深层 Comment 和隐写优先于外层描述。

    Args:
        document: 已解码的元数据树。

    Returns:
        供绘画参数规范化使用的原始字段字典。
    """
    result = {}
    for tag, entry in document.get("exif", {}).items():
        if isinstance(entry, dict) and isinstance(entry.get("value"), str):
            if tag == "270":
                result["Description"] = entry["value"]
            elif tag == "305":
                result["Source"] = entry["value"]
    for scope, _ in _parameter_scopes(document):
        result.update({key: value for key, value in scope.items() if key not in CONTAINERS or not isinstance(value, dict)})
    return result


def _character_collections(scope, path):
    for key in ("characterTabs", "characterPrompts"):
        if isinstance(scope.get(key), list):
            yield scope[key], [*path, key], None
    for key, polarity in (("v4_prompt", "prompt"), ("v4_negative_prompt", "uc")):
        value = scope.get(key)
        caption = value.get("caption", {}) if isinstance(value, dict) else {}
        if isinstance(caption, dict) and isinstance(caption.get("char_captions"), list):
            yield caption["char_captions"], [*path, key, "caption", "char_captions"], polarity


def metadata_bindings(document):
    """
    列出共享表单负责的精确叶子路径，供前端去重和写回使用同一份规则。

    Args:
        document: 解码后的元数据树。

    Returns:
        path 为元数据路径，parameter_path 为绘画参数路径的映射列表。
    """
    bindings = []
    for scope, path in _parameter_scopes(document):
        for target, aliases in PARAMETER_ALIASES.items():
            for alias in aliases:
                if alias in scope and not isinstance(scope[alias], (dict, list)):
                    bindings.append({"path": [*path, alias], "parameter_path": [target]})
        for key, target in (("v4_prompt", "positivePrompt"), ("v4_negative_prompt", "negativePrompt")):
            value = scope.get(key)
            caption = value.get("caption", {}) if isinstance(value, dict) else {}
            if isinstance(caption, dict) and "base_caption" in caption:
                bindings.append({"path": [*path, key, "caption", "base_caption"], "parameter_path": [target]})
            if isinstance(value, dict) and "use_coords" in value:
                bindings.append({"path": [*path, key, "use_coords"], "parameter_path": ["use_coords"]})
        for characters, character_path, polarity in _character_collections(scope, path):
            for index, character in enumerate(characters):
                if not isinstance(character, dict):
                    continue
                fields = {"name": "name", "prompt": "prompt", "positivePrompt": "prompt", "uc": "uc", "negative_prompt": "uc", "negativePrompt": "uc", "position": "position"}
                if polarity:
                    fields["char_caption"] = polarity
                for key, target in fields.items():
                    if key in character and not isinstance(character[key], (dict, list)):
                        bindings.append({"path": [*character_path, index, key], "parameter_path": ["characterTabs", index, target]})
                centers = character.get("centers")
                center_paths = [["centers", 0]] if isinstance(centers, list) and centers else []
                if isinstance(character.get("center"), dict):
                    center_paths.append(["center"])
                for center_path in center_paths:
                    center = character["centers"][0] if len(center_path) == 2 else character["center"]
                    for axis in ("x", "y"):
                        if isinstance(center, dict) and axis in center:
                            bindings.append({"path": [*character_path, index, *center_path, axis], "parameter_path": ["characterTabs", index, "center", axis]})
    for tag, target in (("270", "positivePrompt"),):
        entry = document.get("exif", {}).get(tag)
        if isinstance(entry, dict) and isinstance(entry.get("value"), str):
            bindings.append({"path": ["exif", tag, "value"], "parameter_path": [target]})
    return bindings


def edit_metadata_document(original, submitted, changes, *, pixels_changed=False):
    """
    将共享字段写回各载体，同时保留未知字段和用户从文档中删除的字段。

    Args:
        original: 文件当前元数据树。
        submitted: 用户编辑后的完整树，None 表示沿用原树。
        changes: 仅包含用户改动的参数；角色按索引与原角色对应。
        pixels_changed: 方向校正改变像素时使原签名失效。

    Returns:
        可直接写入另存文件的新元数据树。
    """
    document = copy.deepcopy(original if submitted is None else submitted)
    for section in ("png", "exif"):
        if section in document and not isinstance(document[section], dict):
            raise ValueError(f"The {section} metadata container must be an object.")
    if any(not isinstance(entry, dict) for entry in document.get("exif", {}).values()):
        raise ValueError("Each EXIF metadata entry must be an object.")
    changes = copy.deepcopy(changes)
    tabs = changes.get("characterTabs")
    if tabs is not None:
        if not isinstance(tabs, list) or any(not isinstance(tab, dict) for tab in tabs):
            raise ValueError("Character parameters must be an array of objects.")
        for tab in tabs:
            if "center" not in tab and re.fullmatch(r"[A-E][1-5]", str(tab.get("position", ""))):
                tab["center"] = {"x": ("ABCDE".index(tab["position"][0]) + 0.5) / 5,
                                 "y": (int(tab["position"][1]) - 0.5) / 5}
        for scope, path in list(_parameter_scopes(document)):
            for characters, collection_path, polarity in _character_collections(scope, path):
                del characters[len(tabs):]
                prior = original
                try:
                    for key in collection_path:
                        prior = prior[key]
                except (KeyError, IndexError, TypeError):
                    prior = []
                # 文档中主动删掉的角色不被共享表单中的旧数组重新添加。
                count = len(characters) if submitted is not None and isinstance(prior, list) and len(prior) > len(characters) else len(tabs)
                for index in range(len(characters), count):
                    tab = tabs[index]
                    characters.append({"char_caption": tab.get(polarity, ""), "centers": [tab.get("center", {"x": 0.5, "y": 0.5})]} if polarity else copy.deepcopy(tab))
    bound_targets = set()
    for binding in metadata_bindings(document):
        target = binding["parameter_path"]
        bound_targets.add(target[0])
        value = changes
        try:
            for key in target:
                value = value[key]
        except (KeyError, IndexError, TypeError):
            continue
        parent = document
        for key in binding["path"][:-1]:
            parent = parent[key]
        parent[binding["path"][-1]] = copy.deepcopy(value)

    old_targets = {binding["parameter_path"][0] for binding in metadata_bindings(original)}
    missing = {key: value for key, value in changes.items() if key not in bound_targets and not (submitted is not None and key in old_targets)}
    if missing:
        # 没有现成参数载体时才创建 Comment；文档中被删除的共享字段不重新生成。
        scopes = [(scope, path) for scope, path in _parameter_scopes(document) if path[-1] in {"Comment", "parameters", "value"}]
        if scopes:
            target = scopes[-1][0]
        else:
            target = document.setdefault("png", {}).setdefault("Comment", {})
            if not isinstance(target, dict):
                raise ValueError("A text Comment cannot also store new generation parameters.")
        target.update(copy.deepcopy(missing))
        if submitted is None:
            for canonical, official in (("positivePrompt", "prompt"), ("negativePrompt", "uc"), ("guidanceScale", "scale")):
                if canonical in missing:
                    target[official] = missing[canonical]
    # 官方 signed_hash 仅覆盖解码后的 Comment；未知 signature 等自定义字段不受影响。
    def remove_invalid_signatures(value, old, comment=False):
        if not isinstance(value, dict):
            return
        if comment and "signed_hash" in value and (pixels_changed or json.dumps(value, ensure_ascii=False) != json.dumps(old, ensure_ascii=False)):
            value.pop("signed_hash")
        for key, child in value.items():
            previous = old.get(key) if isinstance(old, dict) else None
            remove_invalid_signatures(child, previous, key in {"Comment", "UserComment"})
    remove_invalid_signatures(document, original)
    for tag in ("37510",):
        entry = document.get("exif", {}).get(tag)
        if isinstance(entry, dict):
            old = original.get("exif", {}).get(tag, {}).get("value")
            remove_invalid_signatures(entry.get("value"), old, True)
    return document


def write_metadata_png(image, document, *, clear_rgb=False):
    """
    将像素和各载体另存为 PNG，重新编码隐写且不继承旧签名尾部或文本块。

    Args:
        image: 已校正方向的 Pillow 图像；不修改调用者图像。
        document: 完整元数据树；空字典清除所有元数据。
        clear_rgb: 原图含 RGB 隐写时清除旧最低位；普通图片不改变 RGB。

    Returns:
        新 PNG 文件字节。
    """
    pixels = image.convert("RGBA")
    if clear_rgb or "stealth_rgb" in document:
        red, green, blue, alpha = pixels.split()
        pixels = Image.merge("RGBA", (red.point(lambda value: value & 254), green.point(lambda value: value & 254),
                                      blue.point(lambda value: value & 254), alpha))
    pixels.putalpha(pixels.getchannel("A").point(lambda value: 255 if value >= 254 else value & 254))
    pixels.info.clear()
    pnginfo = PngImagePlugin.PngInfo()
    for key, value in document.get("png", {}).items():
        text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        pnginfo.add_itxt(key, text)
    exif, sub_ifd = Image.Exif(), {}
    def exif_value(value):
        if isinstance(value, dict) and set(value) == {"binary_base64"}:
            return base64.b64decode(value["binary_base64"], validate=True)
        if isinstance(value, dict) and set(value) == {"rational"}:
            from PIL.TiffImagePlugin import IFDRational
            return IFDRational(*value["rational"])
        if isinstance(value, dict):
            return {int(key): exif_value(item) for key, item in value.items()}
        if isinstance(value, list):
            return tuple(exif_value(item) for item in value)
        return value
    for key, entry in document.get("exif", {}).items():
        if "value" not in entry:
            continue
        tag, value = int(key), entry["value"]
        if tag in {274, 34665}:
            continue  # 已按 EXIF 旋转像素，不再写入旧方向或文件偏移。
        if isinstance(value, (dict, list)) and tag in {270, 37510} and not (isinstance(value, dict) and set(value) == {"binary_base64"}):
            value = json.dumps(value, ensure_ascii=True)
        else:
            value = exif_value(value)
        if tag in {37510, 40965}:
            if tag == 37510 and not isinstance(value, bytes):
                text = str(value)
                value = b"ASCII\x00\x00\x00" + text.encode("ascii") if text.isascii() else b"UNICODE\x00" + text.encode("utf-16")
            sub_ifd[tag] = value
        else:
            exif[tag] = value
    if sub_ifd:
        exif[34665] = sub_ifd
    for key, channel in (("stealth", "alpha"), ("stealth_rgb", "rgb")):
        if key not in document:
            continue
        stealth = copy.deepcopy(document[key])
        # 官方签名读取器对外层 Comment 执行 json.loads，保留其字符串容器约定。
        if isinstance(stealth, dict) and isinstance(stealth.get("Comment"), dict):
            stealth["Comment"] = json.dumps(stealth["Comment"], ensure_ascii=False)
        text = stealth if isinstance(stealth, str) else json.dumps(stealth, ensure_ascii=False)
        compressed = gzip.compress(text.encode("utf-8"))
        magic = b"stealth_pngcomp" if channel == "alpha" else b"stealth_rgbcomp"
        content = magic + (len(compressed) * 8).to_bytes(4, "big") + compressed
        channels = 1 if channel == "alpha" else 3
        if len(content) * 8 > pixels.width * pixels.height * channels:
            raise ValueError("The edited hidden metadata no longer fits in this image; shorten it or remove its stealth container.")
        target = pixels.getchannel("A") if channel == "alpha" else pixels
        values = target.load()
        for index in range(len(content) * 8):
            pixel_index, component = divmod(index, channels)
            x, y = divmod(pixel_index, pixels.height)
            bit = (content[index // 8] >> (7 - index % 8)) & 1
            if channel == "alpha":
                values[x, y] = (values[x, y] & 254) | bit
            else:
                color = list(values[x, y])
                color[component] = (color[component] & 254) | bit
                values[x, y] = tuple(color)
        if channel == "alpha":
            pixels.putalpha(target)
    output = io.BytesIO()
    options = {"pnginfo": pnginfo}
    if exif:
        options["exif"] = exif
    pixels.save(output, "PNG", **options)
    return output.getvalue()
