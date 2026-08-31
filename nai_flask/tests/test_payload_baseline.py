import pytest

from api_utils.custom_errors import ExposableError
from api_utils.novelai_payload_builder import (
    ALL_MODELS,
    INPAINTING_MODELS,
    build_novelai_payload,
)
from conftest import PNG_BASE64


def _build(values):
    """用本地账户固定额度构造一份官方请求数据。"""

    source = {
        "positivePrompt": "1girl",
        "negativePrompt": "",
        "width": 512,
        "height": 512,
        "steps": 20,
        "seed": 7,
        "n_samples": 8,
    }
    source.update(values)
    return build_novelai_payload(
        source,
        current_user="local",
        user_total_amount=999,
    )["data"]


@pytest.mark.parametrize("model", sorted(ALL_MODELS))
def test_all_eight_models_derive_official_inpaint_model_and_one_sample(model):
    official = _build({
        "model": model,
        "action": True,
        "image": PNG_BASE64,
        "mask": PNG_BASE64,
        "inpaint_strength": 0.75,
    })
    assert len(ALL_MODELS) == 8
    assert official["model"] == INPAINTING_MODELS[model]
    assert official["action"] == "infill"
    assert official["parameters"]["n_samples"] == 1
    assert official["parameters"]["image"] == PNG_BASE64
    assert official["parameters"]["mask"] == PNG_BASE64


def test_img2img_character_coordinates_and_vibe_fields_are_preserved():
    img2img = _build({
        "model": "nai-diffusion-4-5-full",
        "action": True,
        "image": PNG_BASE64,
        "strength": 0.6,
        "noise": 0.2,
        "use_coords": True,
        "characterPrompts": [{"prompt": "hero", "center": {"x": 0.2, "y": 0.7}}],
        "v4_prompt_char_captions": [{"char_caption": "hero", "centers": [{"x": 0.2, "y": 0.7}]}],
        "v4_negative_prompt_char_captions": [{"char_caption": "", "centers": [{"x": 0.2, "y": 0.7}]}],
        "reference_image_multiple": ["encoded-vibe"],
        "reference_strength_multiple": [0.8],
    })
    assert img2img["action"] == "img2img"
    assert img2img["parameters"]["image"] == PNG_BASE64
    assert img2img["parameters"]["strength"] == 0.6
    assert img2img["parameters"]["use_coords"] is True
    assert img2img["parameters"]["characterPrompts"][0]["prompt"] == "hero"
    assert img2img["parameters"]["v4_prompt"]["caption"]["char_captions"]
    assert img2img["parameters"]["reference_image_multiple"] == ["encoded-vibe"]
    assert img2img["parameters"]["reference_strength_multiple"] == [0.8]


def test_v5_rejects_unsupported_vibe_and_never_adds_site_verification_fields():
    with pytest.raises(ExposableError):
        _build({
            "model": "nai-diffusion-5-full",
            "reference_image_multiple": ["encoded-vibe"],
            "reference_strength_multiple": [1.0],
        })

    official = _build({"model": "nai-diffusion-5-full"})
    assert official["model"] == "nai-diffusion-5-full"
    assert official["parameters"]["n_samples"] == 1
    assert "recaptcha_token" not in official
    assert "captcha_token" not in official
    assert "turnstile_token" not in official
