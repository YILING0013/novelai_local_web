"""验证不确定文字不擦除、蒙版之外不改像素及后台任务的保存边界。"""

import io
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from api_utils.comic_lettering import ComicLettering, _collect_blocks, _run_cpu_model, match_dialogues, validate_lettering_options
from api_utils.custom_errors import ExposableError
from api_utils.local_image_library import LocalImageLibrary
from api_utils.local_inference import InferenceCancelled, LocalInference
from conftest import PNG_BASE64


def test_unique_dialogue_matching_rejects_duplicates_and_respects_manual_choice():
    blocks = [{"id": "one", "ocrText": "Hello, world!", "confidence": .99},
              {"id": "two", "ocrText": "嗯", "confidence": .99},
              {"id": "three", "ocrText": "嗯", "confidence": .99}]
    dialogues = validate_lettering_options({"dialogues": [
        {"id": "hello", "text": "Hello world"}, {"id": "yes", "text": "嗯"},
    ]})["dialogues"]
    result = match_dialogues(blocks, dialogues, {})
    assert result[0]["dialogueId"] == "hello"
    assert not result[0]["needsReview"]
    assert all(item["needsReview"] for item in result[1:])
    corrected = match_dialogues(blocks, dialogues, {"three": "yes"})
    assert corrected[2]["dialogueId"] == "yes"
    assert corrected[1]["needsReview"]
    kept = match_dialogues(blocks, dialogues, {"one": None})
    assert kept[0]["dialogueId"] is None
    assert kept[0]["needsReview"] and kept[0]["reason"] == "kept-original"
    assert validate_lettering_options({"assignments": {"one": None, "two": None}})["assignments"] == {"one": None, "two": None}
    with pytest.raises(ExposableError) as stale:
        match_dialogues(blocks, dialogues, {"another-image": "yes"})
    assert stale.value.code == "COMIC_ASSIGNMENT_NOT_FOUND"


@pytest.mark.parametrize("closed_bubble", [True, False])
def test_unrecognized_lines_join_ocr_in_same_actual_bubble_or_ctd_box(closed_bubble):
    rgb = np.full((192, 256, 3), 128, np.uint8)
    if closed_bubble:
        rgb[10:115, 10:115] = 255
    mask = np.zeros((192, 256), np.uint8)
    for top in (30, 65, 90):
        mask[top:top + 10, 30:85] = 255
    mask[30:40, 170:205] = 255
    rgb[mask > 0] = 0
    ocr = SimpleNamespace(
        boxes=np.array([[[28, 28], [87, 28], [87, 42], [28, 42]],
                        [[168, 28], [207, 28], [207, 42], [168, 42]]]),
        txts=["misread first line", "decoration"], scores=[.9, .9],
    )
    detector_boxes = [] if closed_bubble else [[20, 20, 100, 110]]

    blocks = _collect_blocks(rgb, mask, detector_boxes, ocr, "ltr", "source")

    assert len(blocks) == 2
    speech = next(block for block in blocks if block["ocrText"] == "misread first line")
    decoration = next(block for block in blocks if block["ocrText"] == "decoration")
    bounds = speech["bounds"]
    assert bounds["x"] <= 30 and bounds["x"] + bounds["width"] >= 85
    assert bounds["y"] <= 30 and bounds["y"] + bounds["height"] >= 100
    assert bounds["x"] + bounds["width"] < decoration["bounds"]["x"]
    # 漏识别行不使 OCR 变得可信，但用户的一次明确对应必须覆盖整段三行台词。
    assert speech["confidence"] == 0
    dialogues = validate_lettering_options({"dialogues": [{"id": "speech", "text": "第一行\n第二行\n第三行"}]})["dialogues"]
    assigned = match_dialogues(blocks, dialogues, {speech["id"]: "speech"})
    assert sum(not block["needsReview"] for block in assigned) == 1
    assert next(block for block in assigned if block["id"] == speech["id"])["text"] == dialogues[0]["text"]
    assert next(block for block in assigned if block["id"] == decoration["id"])["needsReview"]


@pytest.mark.parametrize("changes", [
    {"assignments": {"one": []}}, {"reading_direction": []}, {"language": []},
    {"dialogues": [{"id": "one", "text": "Hello", "direction": []}]},
    {"dialogues": [{"id": "one", "text": "Hello", "type": {}}]},
    {"dialogues": [{"id": "one", "text": "Hello", "order": float("nan")}]},
    {"assignments": {"a": "one", "b": "one"}},
    {"assignments": {"one": {"action": "unknown"}}},
    {"assignments": {"one": {"action": "replace", "text": " "}}},
    {"assignments": {"one": {"action": "replace", "text": "字" * 2001}}},
    {"assignments": {"one": {"action": "replace", "text": "新文本", "direction": []}}},
])
def test_malformed_options_return_clear_request_errors(changes):
    with pytest.raises(ExposableError) as error:
        validate_lettering_options({"dialogues": [{"id": "one", "text": "Hello"}], **changes})
    assert error.value.status_code == 400


@pytest.fixture
def synthetic_runtime():
    mask = np.zeros((128, 128), dtype=np.float32)
    mask[35:43, 25:65] = 1
    mask[85:93, 25:65] = 1

    class Detector:
        def get_inputs(self):
            return [SimpleNamespace(name="images", shape=[1, 3, 128, 128])]

        def run_async(self, output, inputs, callback, user_data, options):
            callback([np.zeros((1, 0, 7), np.float32), mask[None, None], None], user_data, "")

    runtime = ComicLettering.__new__(ComicLettering)
    runtime.ctd = Detector()
    runtime.ocr = lambda source: SimpleNamespace(
        boxes=np.array([[[23, 33], [67, 33], [67, 45], [23, 45]],
                        [[23, 83], [67, 83], [67, 95], [23, 95]]]),
        txts=["Hello world", "Uncertain lettering"], scores=[.99, .99],
    )
    runtime.lama = None
    return runtime, mask


@pytest.mark.parametrize("edit", [{"action": "erase"}, {"action": "replace", "text": "自定义\n新对白", "direction": "vertical-rl"}])
def test_manual_erase_and_custom_text_only_clean_selected_original_region(synthetic_runtime, edit):
    runtime, detector_mask = synthetic_runtime
    pixels = np.full((128, 128, 3), 255, np.uint8)
    pixels[detector_mask > 0] = 0
    source = Image.fromarray(pixels)
    _, _, detected = runtime.rebuild(source, validate_lettering_options({}), lambda *args: None, lambda: None, None)
    first, second = detected["blocks"]
    options = validate_lettering_options({"assignments": {first["id"]: edit, second["id"]: None}})
    cleaned, mask, details = runtime.rebuild(source, options, lambda *args: None, lambda: None, None)
    updated = details["blocks"][0]
    assert updated["applied"] and updated["editAction"] == edit["action"]
    assert updated["text"] == edit.get("text", "") and updated["dialogueId"] is None
    assert updated["direction"] == edit.get("direction", first["direction"])
    assert details["sourceHash"] == detected["sourceHash"]
    assert not details["blocks"][1]["applied"]
    selected = np.array(mask) > 0
    assert selected.any() and not selected[75:].any()
    assert np.array_equal(np.array(cleaned)[~selected], pixels[~selected])
    assert (np.array(cleaned)[35:43, 25:65] == 255).all()
    # 无法识别的文字也接受用户明确指定的擦除或改写。
    manually_matched = match_dialogues([{**first, "ocrText": "", "confidence": 0}], [], {first["id"]: edit})
    assert not manually_matched[0]["needsReview"]


@pytest.mark.parametrize("mode", ["RGB", "RGBA", "JPEG"])
def test_only_confirmed_glyphs_change_and_alpha_is_preserved(synthetic_runtime, mode):
    runtime, detector_mask = synthetic_runtime
    source = Image.new("RGB", (128, 128), "white")
    pixels = np.array(source)
    pixels[detector_mask > 0] = 0
    # 合成 CTD 漏掉的独立短横；纯色气泡应从真实像素补齐，而不是留下残字。
    pixels[46, 27:65] = 0
    source = Image.fromarray(pixels)
    if mode == "RGBA":
        source = source.convert("RGBA")
        source.putalpha(180)
    elif mode == "JPEG":
        output = io.BytesIO()
        source.save(output, format="JPEG")
        source = Image.open(io.BytesIO(output.getvalue()))
    original = np.array(source)
    options = validate_lettering_options({"dialogues": [{"id": "hello", "text": "Hello world"}]})
    cleaned, mask, details = runtime.rebuild(source, options, lambda *args: None, lambda: None, None)
    changed = np.any(np.array(cleaned) != original, axis=2)
    selected = np.array(mask) > 0
    assert changed.any()
    assert not changed[~selected].any()
    assert not selected[75:].any()
    assert np.array(cleaned)[46, 27:65, :3].min() >= 250
    assert np.array_equal(np.array(cleaned)[75:], original[75:])
    if mode == "RGBA":
        assert np.array_equal(np.array(cleaned)[:, :, 3], original[:, :, 3])
    assert [item["applied"] for item in details["blocks"]] == [True, False]
    assert details["blocks"][0]["eraseMethod"] == "bubble-fill"
    assert len(details["sourceHash"]) == 64
    assert details["unmatchedDialogueIds"] == []


def test_closed_original_bubble_protects_tail_and_provides_separate_inside_text_bounds(monkeypatch):
    import cv2

    original = np.full((128, 128, 3), 150, np.uint8)
    cv2.ellipse(original, (60, 65), (20, 45), 0, 0, 360, (255, 255, 255), -1)
    cv2.ellipse(original, (60, 65), (20, 45), 0, 0, 360, (0, 0, 0), 2)
    original[40:80, 55:65] = 0
    original[57:65, 95:103] = 0
    detector_mask = np.zeros((128, 128), np.float32)
    detector_mask[40:80, 55:65] = 1
    detector_mask[57:65, 95:103] = 1

    class Detector:
        def get_inputs(self):
            return [SimpleNamespace(name="images", shape=[1, 3, 128, 128])]

        def run_async(self, output, inputs, callback, user_data, options):
            callback([np.zeros((1, 0, 7), np.float32), detector_mask[None, None], None], user_data, "")

    runtime = ComicLettering.__new__(ComicLettering)
    runtime.ctd = Detector()
    runtime.ocr = lambda image: None
    runtime.lama = None
    bounds = {"x": 50, "y": 30, "width": 60, "height": 70}
    monkeypatch.setattr("api_utils.comic_lettering._collect_blocks", lambda *args: [{
        "id": "same-block", "bounds": bounds, "ocrText": "Hello world", "confidence": .99,
        "direction": "horizontal-tb", "color": "#111111", "fontSize": 32,
    }])
    options = validate_lettering_options({"dialogues": [{"id": "hello", "text": "Hello world"}]})

    cleaned, mask, details = runtime.rebuild(Image.fromarray(original), options, lambda *args: None, lambda: None, None)

    actual = np.array(cleaned)
    selected = np.array(mask) > 0
    block = details["blocks"][0]
    assert block["id"] == "same-block" and block["bounds"] == bounds
    assert block["applied"]
    assert np.array_equal(actual[~selected], original[~selected])
    assert np.array_equal(actual[:, 82:], original[:, 82:])
    assert not selected[:, 82:].any()
    assert (actual[40:80, 55:65] == 255).all()
    layout = block["layoutBounds"]
    left, top, width, height = (layout[key] for key in ("x", "y", "width", "height"))
    assert width < bounds["width"]
    assert (actual[top:top + height, left:left + width] == 255).all()


def test_long_bubble_tail_does_not_collapse_text_layout_to_one_pixel(monkeypatch):
    original = np.full((160, 160, 3), 150, np.uint8)
    original[30:70, 20:140] = 255
    original[70:115, 79:82] = 255
    original[45:55, 40:120] = 0
    detector_mask = np.zeros((160, 160), np.float32)
    detector_mask[45:55, 40:120] = 1

    class Detector:
        def get_inputs(self):
            return [SimpleNamespace(name="images", shape=[1, 3, 160, 160])]

        def run_async(self, output, inputs, callback, user_data, options):
            callback([np.zeros((1, 0, 7), np.float32), detector_mask[None, None], None], user_data, "")

    runtime = ComicLettering.__new__(ComicLettering)
    runtime.ctd = Detector()
    runtime.ocr = lambda image: None
    runtime.lama = None
    bounds = {"x": 35, "y": 40, "width": 90, "height": 20}
    monkeypatch.setattr("api_utils.comic_lettering._collect_blocks", lambda *args: [{
        "id": "wide-speech", "bounds": bounds, "ocrText": "Hello world", "confidence": .99,
        "direction": "horizontal-tb", "color": "#111111", "fontSize": 24,
    }])
    options = validate_lettering_options({"dialogues": [{"id": "hello", "text": "Hello world"}]})

    cleaned, mask, details = runtime.rebuild(Image.fromarray(original), options, lambda *args: None, lambda: None, None)

    block = details["blocks"][0]
    # 尾巴将旧算法的中间 70% 高度交集压成 1px；实际宽气泡仍可容纳整行文字。
    assert block["layoutBounds"] == {"x": 21, "y": 31, "width": 118, "height": 38}
    assert block["id"] == "wide-speech" and block["bounds"] == bounds and block["applied"]
    actual, selected = np.array(cleaned), np.array(mask) > 0
    assert (actual[31:69, 21:139] == 255).all()
    assert np.array_equal(actual[~selected], original[~selected])
    assert np.array_equal(actual[70:], original[70:])


def test_lama_result_is_composited_only_inside_actual_mask(synthetic_runtime):
    runtime, detector_mask = synthetic_runtime
    original = np.random.default_rng(1).integers(0, 256, (128, 128, 3), dtype=np.uint8)
    original[detector_mask > 0] = 0
    calls = []

    class Lama:
        def run_async(self, output, inputs, callback, user_data, options):
            calls.append(inputs)
            callback([np.full((1, 3, 512, 512), 127, np.float32)], user_data, "")

    runtime.lama = Lama()
    options = validate_lettering_options({"dialogues": [{"id": "hello", "text": "Hello world"}]})
    cleaned, mask, details = runtime.rebuild(Image.fromarray(original), options, lambda *args: None, lambda: None, None)
    selected = np.array(mask) > 0
    assert len(calls) == 1
    assert calls[0]["image"].shape == (1, 3, 512, 512)
    assert np.array_equal(np.array(cleaned)[~selected], original[~selected])
    assert (np.array(cleaned)[selected] == 127).all()
    assert details["blocks"][0]["eraseMethod"] == "lama"


def test_no_confirmed_dialogue_leaves_entire_image_untouched(synthetic_runtime):
    runtime, detector_mask = synthetic_runtime
    original = np.full((128, 128, 3), 255, np.uint8)
    original[detector_mask > 0] = 0
    cleaned, mask, details = runtime.rebuild(Image.fromarray(original), validate_lettering_options({}),
                                            lambda *args: None, lambda: None, None)
    assert np.array_equal(np.array(cleaned), original)
    assert np.count_nonzero(np.array(mask)) == 0
    assert all(item["needsReview"] and not item["applied"] for item in details["blocks"])


def test_transparent_background_uses_original_color_without_double_blending(synthetic_runtime):
    runtime, detector_mask = synthetic_runtime
    original = np.full((128, 128, 4), 80, np.uint8)
    original[:, :, 3] = 180
    original[detector_mask > 0, :3] = 0
    options = validate_lettering_options({"dialogues": [{"id": "hello", "text": "Hello world"}]})
    cleaned, mask, _ = runtime.rebuild(Image.fromarray(original), options, lambda *args: None, lambda: None, None)
    assert (np.array(cleaned)[np.array(mask) > 0, :3] == 80).all()
    assert np.array_equal(np.array(cleaned)[:, :, 3], original[:, :, 3])


def test_cancel_stops_before_ocr_and_writes_nothing(synthetic_runtime):
    runtime, _ = synthetic_runtime
    calls = []
    def cancelled_after_detection():
        calls.append(True)
        if len(calls) == 2:
            raise InferenceCancelled()
    runtime.ocr = lambda image: pytest.fail("OCR must not begin after cancellation")
    with pytest.raises(InferenceCancelled):
        runtime.rebuild(Image.new("RGB", (128, 128), "white"), validate_lettering_options({}),
                        lambda *args: None, cancelled_after_detection, None)


def test_async_model_error_is_not_treated_as_success():
    class FailedModel:
        def run_async(self, output, inputs, callback, user_data, options):
            callback([], user_data, "Run was terminated")
    with pytest.raises(RuntimeError, match="terminated"):
        _run_cpu_model(FailedModel(), {}, None)


def test_worker_saves_cleaned_image_and_mask_with_source_hash(tmp_path, monkeypatch):
    manager = LocalInference(tmp_path / "models", LocalImageLibrary(tmp_path / "images"), device="cuda")
    monkeypatch.setattr(manager, "_download", lambda *args: tmp_path)
    devices = []
    class Runtime:
        def rebuild(self, source, options, progress, check_cancelled, run_options):
            return source.convert("RGB"), Image.new("L", source.size), {
                "sourceHash": "a" * 64, "blocks": [], "unmatchedDialogueIds": ["line"]}
    def load(job_id, model, folder, device):
        devices.append(device)
        return Runtime()
    monkeypatch.setattr(manager, "_load_session", load)
    job = manager.start("owner", {"action": "comic-lettering", "model_id": "comic-lettering", "image": PNG_BASE64,
                                  "dialogues": [{"id": "line", "text": "Hello"}]})
    manager.worker.join(5)
    result = manager.get_job(job["id"], "owner")
    assert result["status"] == "completed", result
    assert devices == ["cpu"]
    for key in ("image", "mask"):
        entry = result["result"][key]
        assert entry["parameters"]["comic_lettering_source_hash"] == "a" * 64
        with Image.open(manager.image_library.image_path(entry["id"])) as image:
            assert image.size == (2, 2)
    assert manager.active_id is None


def test_repeated_jobs_reuse_comic_models_with_new_run_options(tmp_path, monkeypatch):
    manager = LocalInference(tmp_path / "models", LocalImageLibrary(tmp_path / "images"))
    monkeypatch.setattr(manager, "_download", lambda *args: tmp_path)
    created, used_options = [], []

    class Runtime:
        def __init__(self, *args):
            created.append(self)

        def rebuild(self, source, options, progress, check_cancelled, run_options):
            assert not run_options.terminate
            used_options.append(run_options)
            return source.convert("RGB"), Image.new("L", source.size), {
                "sourceHash": "b" * 64, "blocks": [], "unmatchedDialogueIds": []}

    monkeypatch.setattr("api_utils.comic_lettering.ComicLettering", Runtime)
    for iteration in range(2):
        for action in ("load", "comic-lettering"):
            job = manager.start("owner", {"action": action, "model_id": "comic-lettering", "image": PNG_BASE64})
            manager.worker.join(5)
            assert manager.get_job(job["id"], "owner")["status"] == "completed"
        if iteration == 0:
            # 旧任务的中止标记不能污染下次任务。
            used_options[0].terminate = True
    assert len(created) == 1
    assert len(used_options) == 2 and used_options[0] is not used_options[1]
    manager.release()
    assert manager.session is None
