# -*- coding: utf-8 -*-
"""浏览器上传图像与 Base64 二进制的本地校验。"""

from __future__ import annotations

import base64
import binascii
import io
from typing import Any

from PIL import Image, UnidentifiedImageError

from .custom_errors import ExposableError


MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_IMAGE_PIXELS = 16 * 1024 * 1024
MAX_IMAGE_DIMENSION = 8192
ALLOWED_IMAGE_FORMATS = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "WEBP": "image/webp",
}
ALLOWED_IMAGE_MODES = frozenset({"1", "L", "LA", "P", "RGB", "RGBA"})


def validate_base64_blob(value: Any, field_name: str) -> str:
    """
    校验一般 Base64 二进制并返回不带 data URL 的规范值。

    Args:
        value: 浏览器提交的 Base64 字符串。
        field_name: 用于安全校验提示的固定字段名。

    Returns:
        重新编码后的标准 Base64 字符串。
    """

    if not isinstance(value, str) or not value:
        raise ExposableError(f"{field_name} must contain Base64 data.")
    encoded = value.partition(",")[2] if value.startswith("data:") else value
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ExposableError(f"{field_name} must contain valid Base64 data.") from exc
    if not decoded or len(decoded) > MAX_IMAGE_BYTES:
        raise ExposableError(f"{field_name} exceeds the allowed byte size.")
    return base64.b64encode(decoded).decode("ascii")


def validate_base64_image(value: Any, field_name: str) -> str:
    """
    解码并用 Pillow 校验上传图像的 MIME、尺寸、像素和色彩模式。

    Args:
        value: 原始 Base64 或 image data URL。
        field_name: 用于安全校验提示的固定字段名。

    Returns:
        不带 data URL 的标准 Base64 图像。
    """

    declared_mime = None
    if isinstance(value, str) and value.startswith("data:"):
        header, separator, _ = value.partition(",")
        if not separator or ";base64" not in header:
            raise ExposableError(f"{field_name} must contain a Base64 image.")
        declared_mime = header[5:].split(";", 1)[0].lower()
        if declared_mime not in ALLOWED_IMAGE_FORMATS.values():
            raise ExposableError(f"{field_name} uses an unsupported image MIME type.")

    normalized = validate_base64_blob(value, field_name)
    image_bytes = base64.b64decode(normalized)
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image_format = str(image.format or "").upper()
            detected_mime = ALLOWED_IMAGE_FORMATS.get(image_format)
            width, height = image.size
            mode = image.mode
            frame_count = int(getattr(image, "n_frames", 1))
            if detected_mime is None:
                raise ExposableError(f"{field_name} uses an unsupported image format.")
            if declared_mime is not None and declared_mime != detected_mime:
                raise ExposableError(f"{field_name} MIME type does not match its image data.")
            if (
                width <= 0
                or height <= 0
                or width > MAX_IMAGE_DIMENSION
                or height > MAX_IMAGE_DIMENSION
                or width * height > MAX_IMAGE_PIXELS
            ):
                raise ExposableError(f"{field_name} exceeds the allowed pixel dimensions.")
            if mode not in ALLOWED_IMAGE_MODES or frame_count != 1:
                raise ExposableError(f"{field_name} uses an unsupported image mode.")
            image.verify()
    except ExposableError:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
        raise ExposableError(f"{field_name} must contain a valid image.") from exc
    return normalized


def validate_generation_images(payload: dict[str, Any]) -> None:
    """
    就地校验并规范化生成请求中的所有原始上传图像。

    Args:
        payload: ImageGenerationService 构造的请求对象。
    """

    for field_name in ("image", "mask", "reference_image"):
        if field_name in payload and payload[field_name]:
            payload[field_name] = validate_base64_image(payload[field_name], field_name)

    references = payload.get("reference_image_multiple")
    if references is not None:
        if not isinstance(references, list):
            raise ExposableError("reference_image_multiple must be an array.")
        validator = (
            validate_base64_blob
            if str(payload.get("model", "")).startswith("nai-diffusion-4-")
            else validate_base64_image
        )
        payload["reference_image_multiple"] = [
            validator(value, f"reference_image_multiple[{index}]")
            for index, value in enumerate(references)
        ]

    for collection_name in ("director_reference_images_cached", "director_reference_images"):
        references = payload.get(collection_name)
        if references is None:
            continue
        if not isinstance(references, list):
            raise ExposableError(f"{collection_name} must be an array.")
        normalized_references = []
        for index, reference in enumerate(references):
            if not isinstance(reference, dict) or not reference.get("data"):
                raise ExposableError(f"{collection_name}[{index}] must contain image data.")
            normalized_reference = dict(reference)
            normalized_reference["data"] = validate_base64_image(
                reference["data"],
                f"{collection_name}[{index}].data",
            )
            normalized_references.append(normalized_reference)
        payload[collection_name] = normalized_references
