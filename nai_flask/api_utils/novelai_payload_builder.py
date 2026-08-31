# -*- coding: utf-8 -*-
"""NovelAI 图像生成请求的校验、规范化与 payload 构造。"""

import base64
import binascii
import io
import json
import math
import random

from PIL import Image, UnidentifiedImageError

from . import tools
from .custom_errors import ExposableError


V4_MODELS = {
    "nai-diffusion-4-5-full",
    "nai-diffusion-4-5-curated",
    "nai-diffusion-4-full",
    "nai-diffusion-4-curated-preview",
}

V5_MODELS = {
    "nai-diffusion-5-full",
    "nai-diffusion-5-curated",
}
V5_INPAINTING_MODELS = {
    "nai-diffusion-5-full-inpainting",
    "nai-diffusion-5-curated-inpainting",
}
V5_MODEL_FAMILY = V5_MODELS | V5_INPAINTING_MODELS
NOVELAI_MAX_COST_PER_IMAGE = 140
V5_TEXT_TO_IMAGE_DEFAULTS = {
    "width": 832,
    "height": 1216,
    "scale": 7,
    "sampler": "k_euler_ancestral",
    "steps": 23,
    "n_samples": 1,
    "cfg_rescale": 0,
    "noise_schedule": "karras",
}
V5_UC_PRESET_IDS = frozenset({
    "heavy",
    "light",
    "furryFocus",
    "humanFocus",
    "none",
})
V5_LEGACY_UC_PRESET_IDS = {
    0: "heavy",
    1: "light",
    2: "furryFocus",
    3: "humanFocus",
    4: "none",
}
LEGACY_NONE_UC_PRESET_BY_MODEL = {
    "nai-diffusion-3": 3,
    "nai-diffusion-furry-3": 2,
    "nai-diffusion-4-curated-preview": 2,
    "nai-diffusion-4-full": 2,
    "nai-diffusion-4-5-curated": 3,
    "nai-diffusion-4-5-full": 4,
    "nai-diffusion-5-curated": 4,
    "nai-diffusion-5-full": 4,
}
V5_TAG_HINT_UC_PRESET_IDS = {
    "none": 0,
    "standard": 1,
    "heavy": 2,
    "light": 3,
    "humanFocus": 4,
    "furryFocus": 5,
}

V4_PROMPT_MODELS = V4_MODELS | V5_MODELS

ALL_MODELS = V4_PROMPT_MODELS | {
    "nai-diffusion-3",
    "nai-diffusion-furry-3",
}

DIRECTOR_REFERENCE_MODELS = {
    "nai-diffusion-4-5-full",
    "nai-diffusion-4-5-curated",
}
DIRECTOR_REFERENCE_ALLOWED_RESOLUTIONS = frozenset({
    (1024, 1536),
    (1536, 1024),
    (1472, 1472),
})
DIRECTOR_REFERENCE_PARAM_KEYS = (
    "director_reference_images_cached",
    "director_reference_images",
    "director_reference_descriptions",
    "director_reference_strength_values",
    "director_reference_secondary_strength_values",
    "director_reference_information_extracted",
)
V5_VIBE_PARAM_KEYS = (
    "reference_image_multiple",
    "reference_strength_multiple",
    "reference_information_extracted_multiple",
    "reference_image",
    "reference_strength",
    "reference_information_extracted",
)
REMOVED_SITE_SECURITY_FIELDS = frozenset({
    "recaptcha_token",
    "captcha_token",
    "turnstile_token",
})

INPAINTING_MODELS = {
    "nai-diffusion-3": "nai-diffusion-3-inpainting",
    "nai-diffusion-furry-3": "nai-diffusion-furry-3-inpainting",
    "nai-diffusion-4-curated-preview": "nai-diffusion-4-curated-inpainting",
    "nai-diffusion-4-full": "nai-diffusion-4-full-inpainting",
    "nai-diffusion-4-5-curated": "nai-diffusion-4-5-curated-inpainting",
    "nai-diffusion-4-5-full": "nai-diffusion-4-5-full-inpainting",
    "nai-diffusion-5-curated": "nai-diffusion-5-curated-inpainting",
    "nai-diffusion-5-full": "nai-diffusion-5-full-inpainting",
}


def validate_v5_request_capabilities(model_name, values, official_format=False):
    """
    校验 V5 请求仅使用当前模型已开放的能力。

    Args:
        model_name: 请求选择的完整 NovelAI 模型 ID。
        values: 本站通用格式请求，或包含 parameters 的官方格式请求。
        official_format: values 是否采用官方 generate-image 请求结构。

    Returns:
        None: 请求未携带角色参考或 Vibe 参数时返回。

    Raises:
        ExposableError: V5 模型 ID 无效，或请求启用了角色参考、Vibe。
    """
    if not str(model_name or "").startswith("nai-diffusion-5-"):
        return
    if model_name not in V5_MODEL_FAMILY:
        raise ExposableError(
            f"Model '{model_name}' is not supported. Use nai-diffusion-5-curated, "
            "nai-diffusion-5-full, or their inpainting variants.",
            code="MODEL_NOT_SUPPORTED",
        )

    request_values = values or {}
    parameters = (
        request_values.get("parameters", {})
        if official_format
        else request_values
    )
    has_director_reference = any(
        parameters.get(field_name)
        for field_name in DIRECTOR_REFERENCE_PARAM_KEYS
    )
    has_vibe = any(
        parameters.get(field_name)
        for field_name in V5_VIBE_PARAM_KEYS
    )

    if has_director_reference or has_vibe:
        raise ExposableError(
            "V5 models do not currently support Director reference or Vibe.",
            code="MODEL_CAPABILITY_NOT_SUPPORTED",
        )


def normalize_v5_request(request_data):
    """
    将 V5 请求整理为 NovelAI V5 所需结构并保留受支持的编辑参数。

    Args:
        request_data: 内部或官方 generate-image 请求字典。

    Returns:
        dict: 包含 V5 固定字段以及原有图生图、局部重绘、角色控制参数的新字典。
    """
    if request_data.get("model") not in V5_MODEL_FAMILY:
        return request_data

    normalized_request = dict(request_data)
    parameters = dict(normalized_request.get("parameters", {}))
    if any(field in normalized_request or field in parameters for field in REMOVED_SITE_SECURITY_FIELDS):
        raise ExposableError(
            "Site verification fields are not accepted by the local API.",
            code="SITE_SECURITY_FIELD_NOT_ALLOWED",
        )

    for field_name, default_value in V5_TEXT_TO_IMAGE_DEFAULTS.items():
        parameters.setdefault(field_name, default_value)

    uc_preset_id = parameters.get("ucPresetId")
    if uc_preset_id not in V5_UC_PRESET_IDS:
        uc_preset_id = V5_LEGACY_UC_PRESET_IDS.get(
            parameters.get("ucPreset"),
            "none",
        )

    positive_prompt = normalized_request.get("input", "")
    negative_prompt = parameters.get("negative_prompt", "")
    existing_v4_prompt = parameters.get("v4_prompt") or {}
    existing_v4_negative_prompt = parameters.get("v4_negative_prompt") or {}
    positive_caption = existing_v4_prompt.get("caption") or {}
    negative_caption = existing_v4_negative_prompt.get("caption") or {}
    positive_char_captions = positive_caption.get("char_captions", [])
    negative_char_captions = negative_caption.get("char_captions", [])
    character_prompts = parameters.get("characterPrompts", [])
    if isinstance(character_prompts, list) and character_prompts:
        active_indexes = [
            index
            for index, character_prompt in enumerate(character_prompts)
            if isinstance(character_prompt, dict)
            and character_prompt.get("enabled", True) is not False
            and str(character_prompt.get("prompt", "")).strip()
        ]
        character_prompts = [character_prompts[index] for index in active_indexes]
        if isinstance(positive_char_captions, list):
            positive_char_captions = [
                positive_char_captions[index]
                for index in active_indexes
                if index < len(positive_char_captions)
            ]
        if isinstance(negative_char_captions, list):
            negative_char_captions = [
                negative_char_captions[index]
                for index in active_indexes
                if index < len(negative_char_captions)
            ]
    use_coords = bool(parameters.get(
        "use_coords",
        existing_v4_prompt.get("use_coords", False),
    ))

    # V5 不发送 V3 旧字段；共享试用位于顶层，验证码只保留调用方真实提供的值。
    for field_name in (
        "sm",
        "sm_dyn",
        "qualityToggle",
        "extra_noise_seed",
        "skip_cfg_above_sigma",
        "ucPreset",
        "use_new_shared_trial",
        *DIRECTOR_REFERENCE_PARAM_KEYS,
        *V5_VIBE_PARAM_KEYS,
    ):
        parameters.pop(field_name, None)

    parameters.update({
        "params_version": 4,
        # 本站所有 NovelAI 请求均为单张；前端批量通过连续提交单张请求实现。
        "n_samples": 1,
        "autoSmea": False,
        "dynamic_thresholding": False,
        "controlnet_strength": 1,
        "legacy": False,
        "add_original_image": parameters.get("add_original_image", True),
        "legacy_v3_extend": False,
        "use_coords": use_coords,
        "legacy_uc": False,
        "normalize_reference_strength_multiple": True,
        "inpaintImg2ImgStrength": parameters.get("inpaintImg2ImgStrength", 1),
        "characterPrompts": character_prompts,
        "straight_alpha": True,
        "tag_hint_qt": parameters.get("tag_hint_qt", 1),
        "tag_hint_uc_preset": V5_TAG_HINT_UC_PRESET_IDS[uc_preset_id],
        "ucPresetId": uc_preset_id,
        "qualityPresetId": parameters.get("qualityPresetId", "standard"),
        "v4_prompt": {
            "caption": {
                "base_caption": positive_caption.get("base_caption", positive_prompt),
                "char_captions": positive_char_captions,
            },
            "use_coords": use_coords,
            "use_order": existing_v4_prompt.get("use_order", True),
        },
        "v4_negative_prompt": {
            "caption": {
                "base_caption": negative_caption.get("base_caption", negative_prompt),
                "char_captions": negative_char_captions,
            },
            "legacy_uc": False,
        },
        "deliberate_euler_ancestral_bug": False,
        "prefer_brownian": True,
        "noise_schedule": parameters.get("noise_schedule") or "karras",
        "image_format": "png",
    })

    action = normalized_request.get("action") or "generate"
    model_name = normalized_request.get("model")
    if action == "infill":
        model_name = INPAINTING_MODELS.get(model_name, model_name)
    normalized_request.update({
        "model": model_name,
        "action": action,
        "parameters": parameters,
        "use_new_shared_trial": True,
    })
    return normalized_request


def is_director_reference_model(model_name):
    """
    判断模型是否允许使用 NovelAI 角色参考。

    Args:
        model_name: 待判断的完整模型 ID。

    Returns:
        bool: 仅 NAI Diffusion 4.5 Full 与 Curated 返回 True。
    """
    return str(model_name or "") in DIRECTOR_REFERENCE_MODELS


def filter_director_reference_fields(model_name, values):
    """
    为不支持角色参考的模型移除所有 director_reference 参数。

    Args:
        model_name: 当前请求的完整模型 ID。
        values: 包含生成参数的原始映射。

    Returns:
        dict: 浅拷贝后的安全参数；4.5 模型保留角色参考字段，其它模型全部剥离。
    """
    filtered_values = dict(values or {})
    if is_director_reference_model(model_name):
        return filtered_values

    # 服务端必须再次过滤，防止旧客户端或构造请求绕过前端显示条件。
    for field_name in DIRECTOR_REFERENCE_PARAM_KEYS:
        filtered_values.pop(field_name, None)
    return filtered_values


def validate_director_reference_images(images):
    """
    校验角色参考请求中的每张 Base64 图像及其固定分辨率。

    Args:
        images: director_reference_images_cached 数组，每项必须携带 data 图像内容。

    Returns:
        None: 所有图像均可解码且分辨率符合前端生成规格时正常返回。

    Raises:
        ExposableError: 数组、图像内容或分辨率不符合请求契约。
    """
    if not isinstance(images, list):
        raise ExposableError("director_reference_images_cached must be an array.")

    for index, reference_image in enumerate(images, start=1):
        if not isinstance(reference_image, dict):
            raise ExposableError(
                f"Director reference image {index} must be an object."
            )

        encoded_image = reference_image.get("data")
        if not isinstance(encoded_image, str) or not encoded_image:
            raise ExposableError(
                f"Director reference image {index} must include Base64 image data."
            )

        try:
            image_bytes = base64.b64decode(encoded_image, validate=True)
            with Image.open(io.BytesIO(image_bytes)) as image:
                resolution = image.size
                image.verify()
        except (
            binascii.Error,
            Image.DecompressionBombError,
            UnidentifiedImageError,
            OSError,
            ValueError,
        ):
            raise ExposableError(
                f"Director reference image {index} must be a valid Base64 image."
            ) from None

        if resolution not in DIRECTOR_REFERENCE_ALLOWED_RESOLUTIONS:
            raise ExposableError(
                f"Director reference image {index} must have resolution "
                "1024x1536, 1536x1024, or 1472x1472."
            )


def sync_official_request_multipart_part(multipart_parts, request_data):
    """
    将过滤后的官方请求 JSON 同步回 multipart 的 request 部分。

    Args:
        multipart_parts: 官方接口解析出的 multipart 部分。
        request_data: 已完成服务端过滤的官方请求对象。

    Returns:
        list | None: 包含最新 request JSON 的 multipart 部分；传入 None 时返回 None。
    """
    if multipart_parts is None:
        return None

    request_json = json.dumps(request_data, ensure_ascii=False, separators=(",", ":"))
    synchronized_parts = []
    for part in multipart_parts:
        synchronized_part = dict(part)
        if synchronized_part.get("name") == "request":
            if "data" in synchronized_part:
                synchronized_part["data"] = request_json.encode("utf-8")
            else:
                synchronized_part["value"] = request_json
        synchronized_parts.append(synchronized_part)
    return synchronized_parts


def calculate_nai_cost(
    width,
    height,
    steps,
    enable_smea=False,
    enable_smea_dyn=False,
    model_name=None,
    strength=1.0,
):
    """
    计算 NovelAI 图像生成点数消耗。

    Args:
        width: 请求宽度。
        height: 请求高度。
        steps: 生成步数。
        enable_smea: 是否启用 SMEA。
        enable_smea_dyn: 是否启用动态 SMEA。
        model_name: NovelAI 模型 ID；V5 基础与局部重绘模型使用 1.5 倍成本。
        strength: 图生图或局部重绘强度，文生图传 1。

    Returns:
        int: 本次单张请求的预计点数。

    Raises:
        ExposableError: 单张成本超过 NovelAI 允许的最大值。
    """
    coeff_1 = 2951823174884865e-21
    coeff_2 = 5.753298233447344e-7
    pixels = width * height
    base_cost = math.ceil(
        (coeff_1 * pixels) + (coeff_2 * pixels * steps)
    )
    if enable_smea:
        base_cost *= 1.4 if enable_smea_dyn else 1.2
    if model_name in V5_MODEL_FAMILY:
        base_cost *= 1.5

    per_image_cost = max(math.ceil(base_cost * strength), 2)
    if per_image_cost > NOVELAI_MAX_COST_PER_IMAGE:
        raise ExposableError(
            "The selected settings would take too long to generate. "
            "Reduce the resolution, steps, or strength."
        )
    return int(per_image_cost)


def _is_allowed_resolution(width, height, max_product, max_dimension, step=64):
    """判断请求分辨率是否满足边长、步进和总像素限制。"""
    allowed_dimensions = range(step, max_dimension + 1, step)
    return (
        width in allowed_dimensions
        and height in allowed_dimensions
        and width * height <= max_product
    )


def build_novelai_payload(
    data,
    current_user,
    user_total_amount,
    use_upscale_credits=False,
    user_upscale_credits=0,
):
    """
    为 NovelAI 模型构建经过权限与兼容性过滤的请求体。

    Args:
        data: 浏览器或 API 提交的生成参数。
        current_user: 当前用户名。
        user_total_amount: 当前用户订阅档位金额。
        use_upscale_credits: 是否使用大图点数。
        user_upscale_credits: 用户剩余的大图点数。

    Returns:
        dict: 可交给 NovelAI worker 的内部请求体。
    """
    if any(field in data for field in REMOVED_SITE_SECURITY_FIELDS):
        raise ExposableError(
            "Site verification fields are not accepted by the local API.",
            code="SITE_SECURITY_FIELD_NOT_ALLOWED",
        )
    model_name = data.get("model", "nai-diffusion-3")
    if model_name not in ALL_MODELS:
        raise ExposableError(
            f"Model '{model_name}' is invalid. Use one of the allowed models.",
            code="MODEL_NOT_SUPPORTED",
        )
    validate_v5_request_capabilities(model_name, data)
    data = filter_director_reference_fields(model_name, data)
    if model_name in V5_MODELS:
        for field_name, default_value in V5_TEXT_TO_IMAGE_DEFAULTS.items():
            data.setdefault(field_name, default_value)

    requested_steps = data.get("steps", V5_TEXT_TO_IMAGE_DEFAULTS["steps"] if model_name in V5_MODELS else 28)
    if model_name in V5_MODELS:
        try:
            requested_steps = int(requested_steps)
        except (TypeError, ValueError) as exc:
            raise ExposableError("V5 steps must be an integer between 1 and 50.", 400) from exc
        if requested_steps < 1:
            raise ExposableError("V5 steps must be an integer between 1 and 50.", 400)
        if use_upscale_credits and requested_steps > 50:
            raise ExposableError("V5 large-image requests support at most 50 steps.", 400)
        data["steps"] = requested_steps

    if use_upscale_credits:
        max_resolution_product = 3145728
        max_dimension = 4096
        max_steps = 50
    else:
        max_resolution_product = 1048576
        max_dimension = 2048
        max_steps = 23 if model_name in V5_MODELS else 28

    current_resolution = (data.get("width"), data.get("height"))
    if not _is_allowed_resolution(
        current_resolution[0],
        current_resolution[1],
        max_resolution_product,
        max_dimension,
    ):
        req_width = data.get("width", 1024)
        req_height = data.get("height", 1024)
        if req_width * req_height > max_resolution_product:
            ratio = (max_resolution_product / (req_width * req_height)) ** 0.5
            data["width"] = int(req_width * ratio // 64) * 64
            data["height"] = int(req_height * ratio // 64) * 64
        else:
            data["width"] = (req_width // 64) * 64
            data["height"] = (req_height // 64) * 64
        data["width"] = max(64, min(data["width"], max_dimension))
        data["height"] = max(64, min(data["height"], max_dimension))

    data["steps"] = min(data.get("steps", 28), max_steps)
    data["scale"] = min(data.get("scale", 10.0), 10.0)
    is_sm = data.get("sm", False)
    is_sm_dyn = data.get("sm_dyn", False)

    required_cost = None
    if use_upscale_credits:
        if data.get("mask"):
            cost_strength = data.get("inpaint_strength", 1.0)
        elif data.get("action", False):
            cost_strength = data.get("strength", 0.7)
        else:
            cost_strength = 1.0
        required_cost = calculate_nai_cost(
            width=data["width"],
            height=data["height"],
            steps=data["steps"],
            enable_smea=is_sm,
            enable_smea_dyn=is_sm_dyn,
            model_name=model_name,
            strength=cost_strength,
        )
        if user_upscale_credits < required_cost:
            raise ExposableError(
                f"Insufficient upscale credits. This request needs {required_cost}, "
                f"but only {user_upscale_credits} remain.",
                code="UPSCALE_CREDITS_INSUFFICIENT",
            )

    decrisp = data.get("decrisp", False)
    variety = data.get("variety", False)
    seed_value = (
        random.randint(0, 2**32 - 1)
        if data.get("seed", "") == ""
        else int(data["seed"])
    )

    payload = {
        "type": "novelai",
        "url": "https://image.novelai.net/ai/generate-image",
        "user": current_user,
        "use_upscale_credits": use_upscale_credits,
        "user_upscale_credits": user_upscale_credits,
        "has_director_reference": bool(data.get("director_reference_images_cached")),
        "director_reference_count": len(data.get("director_reference_images_cached", [])),
        "data": {
            "input": data.get("positivePrompt", "1girl"),
            "model": "nai-diffusion-3",
            "action": "generate",
            "parameters": {
                "deliberate_euler_ancestral_bug": data.get("deliberate_euler_ancestral_bug", False),
                "dynamic_thresholding": False,
                "width": data.get("width", 512),
                "height": data.get("height", 512),
                "scale": data.get("scale", 5.5),
                "sampler": data.get("sampler", "k_euler"),
                "steps": data.get("steps", 28),
                "sm": is_sm,
                "sm_dyn": is_sm_dyn,
                "autoSmea": data.get("autoSmea", False),
                "controlnet_strength": 1,
                "legacy": data.get("legacy", False),
                "legacy_uc": data.get("legacy_uc", False),
                "legacy_v3_extend": data.get("legacy_v3_extend", False),
                "n_samples": 1,
                "params_version": 3,
                "prefer_brownian": data.get("prefer_brownian", True),
                "qualityToggle": False,
                "add_original_image": True,
                "cfg_rescale": data.get("promptGuidanceRescale", 0),
                "noise_schedule": data.get("noise_schedule", 0),
                "seed": seed_value,
                "extra_noise_seed": seed_value,
                "skip_cfg_above_sigma": None,
                # 旧模型仍使用数字枚举；V5 会在规范化时转成 ucPresetId="none"。
                "ucPreset": LEGACY_NONE_UC_PRESET_BY_MODEL[model_name],
                "negative_prompt": data.get("negativePrompt", ""),
                "use_new_shared_trial": True,
                "inpaintImg2ImgStrength": 1,
                "normalize_reference_strength_multiple": True,
            },
        },
        "headers": {
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
            "Content-Type": "application/json",
            "Origin": "https://novelai.net",
            "priority": "u=1, i",
            "Referer": "https://novelai.net/",
            "Sec-Ch-Ua": "Not;A=Brand\";v=\"99\", \"Google Chrome\";v=\"139\", \"Chromium\";v=\"139\"",
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": "\"Windows\"",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                "AppleWebKit/537.36 (KHTML, like Gecko)"
                "Chrome/139.0.0.0 Safari/537.36"
            ),
            "X-Correlation-ID": tools.correlation_id_generator(),
            "x-initiated-at": tools.get_z_time_now(),
        },
    }
    if required_cost is not None:
        # worker 在选择 Token 和官方点数查询失败时都使用同一预计值。
        payload["calculated_cost"] = required_cost

    if data.get("action", False):
        payload["data"]["action"] = "img2img"
        payload["data"]["parameters"]["strength"] = data.get("strength", 0.7)
        payload["data"]["parameters"]["image"] = data.get("image", "")
        payload["data"]["parameters"]["noise"] = data.get("noise", 0.1)

    if "tag_hint_transparent_background" in data:
        payload["data"]["parameters"]["tag_hint_transparent_background"] = bool(
            data.get("tag_hint_transparent_background")
        )

    if "model" in data:
        if model_name in V4_PROMPT_MODELS:
            if user_total_amount < 10:
                raise ExposableError(
                    "V4 and V5 models are not available for this subscription tier.",
                    code="MODEL_SUBSCRIPTION_REQUIRED",
                )
            payload["data"]["model"] = model_name
            default_use_coords = False if model_name in V5_MODELS else True
            payload["data"]["parameters"]["v4_prompt"] = {
                "caption": {
                    "base_caption": data.get("positivePrompt", ""),
                    "char_captions": data.get("v4_prompt_char_captions", []),
                },
                "use_coords": data.get("use_coords", default_use_coords),
                "use_order": data.get("use_order", True),
            }
            payload["data"]["parameters"]["v4_negative_prompt"] = {
                "caption": {
                    "base_caption": data.get("negativePrompt", ""),
                    "char_captions": data.get("v4_negative_prompt_char_captions", []),
                }
            }
            payload["data"]["parameters"]["use_coords"] = data.get(
                "use_coords",
                default_use_coords,
            )
            # V5 角色控制不在后端截断，25 仅是前端的软警告阈值。
            payload["data"]["parameters"]["characterPrompts"] = data.get("characterPrompts", [])
        else:
            payload["data"]["model"] = model_name

    if data.get("mask"):
        payload["data"]["action"] = "infill"
        payload["data"]["model"] = INPAINTING_MODELS.get(
            payload["data"]["model"],
            payload["data"]["model"],
        )
        payload["data"]["parameters"]["mask"] = data.get("mask", "")
        inpaint_strength = data.get("inpaint_strength", 1.0)
        payload["data"]["parameters"]["inpaintImg2ImgStrength"] = inpaint_strength
        if inpaint_strength < 1.0:
            payload["data"]["parameters"]["img2img"] = {
                "color_correct": data.get("color_correct", True),
                "strength": inpaint_strength,
            }
        if "disabled_original_image" in data:
            payload["data"]["parameters"]["add_original_image"] = not bool(
                data.get("disabled_original_image")
            )

    if "reference_image_multiple" in data and not data.get("director_reference_images_cached"):
        if payload["data"]["model"] in V4_PROMPT_MODELS or model_name in V4_PROMPT_MODELS:
            payload["data"]["parameters"]["reference_image_multiple"] = data.get("reference_image_multiple", [])[:4]
            payload["data"]["parameters"]["reference_strength_multiple"] = data.get("reference_strength_multiple", [])[:4]
        else:
            payload["data"]["parameters"]["reference_image_multiple"] = data.get("reference_image_multiple", [])
            payload["data"]["parameters"]["reference_information_extracted_multiple"] = data.get("reference_information_extracted_multiple", [])
            payload["data"]["parameters"]["reference_strength_multiple"] = data.get("reference_strength_multiple", [])

    if data.get("director_reference_images_cached"):
        max_items = 12
        director_references = data.get("director_reference_images_cached", [])[:max_items]
        validate_director_reference_images(director_references)
        payload["data"]["parameters"].update({
            # 本地版没有服务端 cache_secret_key；官方只接收纯 Base64 string[]。
            "director_reference_images": [reference["data"] for reference in director_references],
            "director_reference_descriptions": data.get("director_reference_descriptions", [])[:max_items],
            "director_reference_strength_values": data.get("director_reference_strength_values", [])[:max_items],
            "director_reference_secondary_strength_values": data.get("director_reference_secondary_strength_values", [])[:max_items],
            "director_reference_information_extracted": data.get("director_reference_information_extracted", [])[:max_items],
        })

    if decrisp:
        payload["data"]["parameters"]["dynamic_thresholding"] = True
    if variety:
        payload["data"]["parameters"]["skip_cfg_above_sigma"] = 58

    if data.get("req_type"):
        payload["data"] = {
            "req_type": data.get("req_type", ""),
            "width": data.get("width", 512),
            "height": data.get("height", 512),
            "image": data.get("image", ""),
        }
        if data["req_type"] in ["colorize", "emotion"]:
            payload["data"]["defry"] = data.get("defry", 1)
            payload["data"]["prompt"] = data.get("prompt", "")

    if model_name in V5_MODELS:
        payload["data"] = normalize_v5_request(payload["data"])

    return payload
