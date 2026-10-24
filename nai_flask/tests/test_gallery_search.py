"""验证本机智能图库的标签、相似检索、动态收藏和目录隔离。"""

import io
import json

import pytest
from PIL import Image, PngImagePlugin

from api_utils.custom_errors import ExposableError
from api_utils.gallery_search import (create_collection, delete_collection, list_collections,
                                     parse_prompt_tags, search_images, weighted_jaccard)
from api_utils.local_image_library import LocalImageLibrary


@pytest.fixture
def library(tmp_path):
    """为每个测试准备独立的临时图片目录和索引。"""
    return LocalImageLibrary(tmp_path / "data", tmp_path / "outputs")


def add_image(library, prompt, filename="sample.png", size=(32, 48), source="references", **parameters):
    """只把测试合成图片写入临时图库。"""
    stream = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_itxt("Comment", json.dumps({"prompt": prompt, **parameters}))
    Image.new("RGB", size, (12, 34, 56)).save(stream, "PNG", pnginfo=metadata)
    return library.import_image(stream.getvalue(), filename, source=source)


def test_prompt_weight_syntax_and_normalization():
    tags = parse_prompt_tags("{{ＢＬＵＥ_ＥＹＥＳ}}, [long_hair], 2::red hair, rain::, -1.5::hat::, plain, 0::ignored::")
    assert tags == pytest.approx({"blue eyes": 1.1025, "long hair": 1 / 1.05,
                                  "red hair": 2, "rain": 2, "hat": -1.5, "plain": 1})
    reset = parse_prompt_tags("{{rain::, plain, red {hair}, escaped\\,tag")
    assert reset["rain"] == pytest.approx(1.1025)
    assert reset["plain"] == 1
    assert "red hair" in reset
    assert "escaped,tag" in reset
    assert weighted_jaccard({}, {}) == 0
    assert weighted_jaccard({"cat": 2}, {"cat": 1, "rain": 1}) == pytest.approx(1 / 3)


def test_combined_filters_apply_before_pagination_and_keep_total(library):
    first = add_image(library, "1girl, blue_eyes, {{long hair}}", "first.png", model="nai-diffusion-4-full", uc="hat")
    second = add_image(library, "1girl, blue eyes, long hair", "second.png", model="nai-diffusion-4-full")
    add_image(library, "1girl, blue eyes, long hair, hat", "excluded.png", model="nai-diffusion-4-full")
    add_image(library, "1girl, blue eyes", "short.png", model="nai-diffusion-4-full")
    add_image(library, "1girl, blue eyes, long hair", "wide.png", size=(48, 32), model="nai-diffusion-4-full")
    add_image(library, "1girl, blue eyes, long hair", "other.png", model="nai-diffusion-5-full")
    filters = {"source": "references", "tags": "BLUE_EYES, long hair", "negative_tags": "hat",
               "orientation": "portrait", "model": "NAI-DIFFUSION-4-FULL", "sort": "oldest", "limit": 1}
    page = search_images(library, **filters)
    next_page = search_images(library, **filters, offset=1)
    assert page["total"] == next_page["total"] == 2
    assert page["items"][0]["id"] == first["id"]
    assert next_page["items"][0]["id"] == second["id"]


def test_similarity_separates_negative_and_character_channels(library):
    reference = add_image(library, "cat", uc="dog", characterTabs=[{"prompt": "blue eyes", "uc": "hat"}])
    exact = add_image(library, "cat", uc="dog", characterTabs=[{"prompt": "blue_eyes", "uc": "hat"}])
    swapped = add_image(library, "dog", uc="cat", characterTabs=[{"prompt": "hat", "uc": "blue eyes"}])
    different_weight = add_image(library, "2::cat::", uc="dog", characterTabs=[{"prompt": "blue eyes", "uc": "hat"}])
    negative_emphasis = add_image(library, "-1::cat::", uc="dog", characterTabs=[{"prompt": "blue eyes", "uc": "hat"}])
    result = search_images(library, source="references", similar_to=reference["id"], sort="similarity", min_similarity=0.1)
    assert [row["id"] for row in result["items"]] == [exact["id"], different_weight["id"], negative_emphasis["id"]]
    assert [row["similarity"] for row in result["items"]] == [1, 0.8, 0.6]
    assert swapped["id"] not in {row["id"] for row in result["items"]}
    assert search_images(library, tags="blue_eyes", negative_tags="cat")["items"][0]["id"] == negative_emphasis["id"]


def test_feature_cache_reuses_unchanged_prompts_and_invalidates_edits(library, monkeypatch):
    entry = add_image(library, "cat")
    assert search_images(library, tags="cat")["total"] == 1
    from api_utils import gallery_search
    original = gallery_search.parse_prompt_tags
    seen = []

    def record_parse(prompt):
        seen.append(prompt)
        return original(prompt)

    monkeypatch.setattr(gallery_search, "parse_prompt_tags", record_parse)
    assert search_images(library, tags="cat")["total"] == 1
    assert seen.count("cat") == 1  # 只解析查询标签，图片特征命中持久化缓存。
    library.update_image(entry["id"], {"prompt": "dog"})
    assert search_images(library, tags="cat")["total"] == 0
    assert search_images(library, tags="dog")["total"] == 1


def test_collection_is_persistent_dynamic_and_source_scoped(library):
    first = add_image(library, "cat", source="outputs")
    collection = create_collection(library, "outputs", "猫咪竖图", {"tags": "cat", "orientation": "portrait", "sort": "oldest"})
    assert search_images(library, collection_id=collection["id"])["total"] == 1
    second = add_image(library, "cat", "new.png", source="outputs")
    add_image(library, "cat", source="references")
    restarted = LocalImageLibrary(library.data_dir, library.roots["outputs"])
    assert list_collections(restarted, "outputs") == [collection]
    assert list_collections(restarted, "references") == []
    assert [row["id"] for row in search_images(restarted, collection_id=collection["id"])["items"]] == [first["id"], second["id"]]
    with pytest.raises(ExposableError) as caught:
        search_images(restarted, source="references", collection_id=collection["id"])
    assert caught.value.code == "LIBRARY_COLLECTION_SOURCE_INVALID"
    assert delete_collection(restarted, collection["id"])
    assert list_collections(restarted) == []
    assert restarted.image_path(first["id"]).exists()


def test_existing_group_text_trash_and_active_directory_boundaries(library, tmp_path):
    group = library.create_group("test", "outputs")
    entry = add_image(library, "cat", "chosen.png", source="outputs", size=(32, 32))
    library.update_image(entry["id"], {"group_id": group["id"]})
    assert search_images(library, source="outputs", group_id=group["id"], query="chosen", orientation="square")["total"] == 1
    assert search_images(library, source="outputs", group_id="__ungrouped")["total"] == 0
    library.trash_image(entry["id"])
    assert search_images(library, source="outputs")["total"] == 0
    assert search_images(library, source="outputs", trashed=True, tags="cat")["total"] == 1
    library.configure_output_dir(tmp_path / "another-output")
    assert search_images(library, source="outputs", trashed=True)["total"] == 0
    with pytest.raises(ExposableError) as caught:
        search_images(library, similar_to=entry["id"], sort="similarity")
    assert caught.value.status_code == 404


@pytest.mark.parametrize("filters", [{"orientation": "round"}, {"sort": "random"}, {"min_similarity": -1},
                                    {"min_similarity": "nan"}, {"min_similarity": 1.1}, {"tags": []},
                                    {"sort": "similarity"}, {"min_similarity": 0.1}])
def test_invalid_search_filters_are_visible_errors(library, filters):
    with pytest.raises(ExposableError) as caught:
        search_images(library, **filters)
    assert caught.value.code == "LIBRARY_FILTER_INVALID"


@pytest.mark.parametrize("filters", [{"source": "outputs"}, {"limit": 10}, {"collection_id": "loop"}, {"trash": "true"}, None])
def test_collections_reject_non_filter_fields(library, filters):
    with pytest.raises(ExposableError):
        create_collection(library, "references", "invalid", filters)
