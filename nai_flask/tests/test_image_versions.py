"""用合成图片验证不可变分支、快照去重和收费生成的版本关联。"""

import base64
import io
import json
import sqlite3

import pytest
from PIL import Image

from api_utils.custom_errors import ExposableError
from api_utils.local_image_library import LocalImageLibrary, normalize_image_parameters
from conftest import ORIGIN, PNG_BASE64, login


@pytest.fixture
def library(tmp_path):
    """在临时目录建立图库，避免接触用户图片。"""
    return LocalImageLibrary(tmp_path / "data")


@pytest.fixture
def work_context(app):
    """预先建立用户主动启用的作品，供生成后的版本关联测试复用。"""
    created = app.extensions["image_library"].versions.create_work({"title": "主动启用的作品", "parameters": {}})
    return {"work_id": created["work"]["id"], "parent_version_id": None}


def create_image_work(library, body):
    """用合成图片建立有根节点的作品，复用于分支和快照测试。"""
    image = library.import_image(base64.b64decode(PNG_BASE64), "root.png")
    return library.versions.create_work({**body, "image_ids": [image["id"]]})


def test_branches_restore_and_prompt_only_commits_keep_history(library):
    store = library.versions
    first = create_image_work(library, {"title": "角色探索", "parameters": {"positivePrompt": "red hair", "seed": 42}})
    work_id, root_id = first["work"]["id"], first["version"]["id"]
    second = store.create_version(work_id, {"parent_id": root_id, "parameters": {"positivePrompt": "blue hair"}})
    branch = store.create_version(work_id, {"parent_id": root_id, "parameters": {"positivePrompt": "green hair"}})
    restored = store.create_version(work_id, {"parent_id": branch["version"]["id"], "restore_version_id": root_id, "operation": "restore"})
    versions = store.get_work(work_id)["versions"]
    assert [item["number"] for item in versions] == [1, 2, 3, 4]
    assert second["version"]["parent_id"] == branch["version"]["parent_id"] == root_id
    assert restored["version"]["parent_id"] == branch["version"]["id"]
    assert restored["version"]["parameters"] == versions[0]["parameters"]
    assert versions[1]["parameters"]["positivePrompt"] == "blue hair"
    assert all(item["images"] == [] for item in versions[1:3])
    assert versions[0]["images"] == versions[3]["images"]
    assert store.rename_work(work_id, "改名")["version_count"] == 4
    other = create_image_work(library, {"title": "另一作品"})
    with pytest.raises(ExposableError, match="parent version"):
        store.create_version(work_id, {"parent_id": other["version"]["id"]})
    with pytest.raises(ExposableError, match="parent version"):
        store.create_version(work_id, {"parent_id": root_id, "restore_version_id": other["version"]["id"], "operation": "restore"})
    assert len(store.get_work(work_id)["versions"]) == 4


def test_blueprint_persists_per_work_without_changing_versions(library):
    first = create_image_work(library, {"title": "画布", "parameters": {"positivePrompt": "first"}})
    work_id, root_id = first["work"]["id"], first["version"]["id"]
    child = library.versions.create_version(work_id, {"parent_id": root_id, "parameters": {"positivePrompt": "second"}})["version"]
    before = library.versions.get_work(work_id)["versions"]
    other = library.versions.create_work({"title": "另一画布"})
    blueprint = {"positions": {root_id: {"x": -120.5, "y": 80}, child["id"]: {"x": 320, "y": 180}},
                 "edge_notes": {child["id"]: "调整人物配色"}, "hidden_node_ids": [child["id"]],
                 "groups": [{"id": "color-study", "title": "配色试验", "node_ids": [root_id, child["id"]], "collapsed": True}]}
    assert library.versions.save_blueprint(work_id, blueprint) == blueprint
    restarted = LocalImageLibrary(library.data_dir)
    assert restarted.versions.get_work(work_id)["blueprint"] == blueprint
    assert restarted.versions.get_work(work_id)["versions"] == before
    empty = {"positions": {}, "edge_notes": {}, "hidden_node_ids": [], "groups": []}
    assert restarted.versions.get_work(other["work"]["id"])["blueprint"] == empty
    restarted.versions.save_blueprint(work_id, empty)
    assert restarted.versions.get_work(work_id)["blueprint"] == empty
    assert restarted.versions.get_work(work_id)["versions"] == before


def test_blueprint_rejects_invalid_coordinates_edges_and_group_members(library):
    first = create_image_work(library, {"title": "画布"})
    work_id, root_id = first["work"]["id"], first["version"]["id"]
    child_id = library.versions.create_version(work_id, {"parent_id": root_id})["version"]["id"]
    foreign_id = create_image_work(library, {"title": "外部作品"})["version"]["id"]
    empty = {"positions": {}, "edge_notes": {}, "hidden_node_ids": [], "groups": []}
    invalid = [
        {**empty, "positions": {foreign_id: {"x": 0, "y": 0}}},
        {**empty, "positions": {root_id: {"x": float("inf"), "y": 0}}},
        {**empty, "positions": {root_id: {"x": True, "y": 0}}},
        {**empty, "edge_notes": {root_id: "根节点没有父连线"}},
        {**empty, "edge_notes": {child_id: "x" * 2001}},
        {**empty, "hidden_node_ids": [foreign_id]},
        {**empty, "groups": [{"id": "a", "title": "组一", "node_ids": [root_id], "collapsed": False},
                              {"id": "b", "title": "组二", "node_ids": [root_id], "collapsed": True}]},
        {**empty, "groups": [{"id": "a", "title": "x" * 121, "node_ids": [root_id], "collapsed": False}]},
    ]
    for blueprint in invalid:
        with pytest.raises(ExposableError):
            library.versions.save_blueprint(work_id, blueprint)
    assert library.versions.get_work(work_id)["blueprint"] == empty
    assert len(library.versions.get_work(work_id)["versions"]) == 2


def test_blueprint_route_requires_session_csrf_and_returns_saved_layout(client, app):
    empty = {"positions": {}, "edge_notes": {}, "hidden_node_ids": [], "groups": []}
    assert client.patch("/api/local/works/missing/blueprint", json=empty, headers={"Origin": ORIGIN}).status_code == 401
    csrf = login(client)
    created = create_image_work(app.extensions["image_library"], {"title": "路由画布"})
    work_id, version_id = created["work"]["id"], created["version"]["id"]
    path = f"/api/local/works/{work_id}/blueprint"
    assert client.patch(path, json=empty, headers={"Origin": ORIGIN}).status_code == 403
    layout = {**empty, "positions": {version_id: {"x": 160, "y": 240}}}
    response = client.patch(path, json=layout, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert response.status_code == 200 and response.get_json() == {"blueprint": layout}
    assert client.get(f"/api/local/works/{work_id}").get_json()["blueprint"] == layout


def test_content_addressed_assets_survive_original_changes_and_deletion(library):
    original = base64.b64decode(PNG_BASE64)
    image = library.import_image(original, "original.png")
    first = library.versions.create_work({"title": "第一作品", "image_ids": [image["id"]]})
    second = library.versions.create_work({"title": "另一作品", "image_ids": [image["id"]]})
    asset = first["version"]["images"][0]
    assert asset["asset_id"] == second["version"]["images"][0]["asset_id"]
    assert "root" not in asset and "relative_path" not in asset
    assert len(list(library.versions.asset_dir.glob("*.png"))) == 2  # 一份原图、一份缩略图。
    assert len(library.versions.image_versions(image["id"])["works"]) == 2
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(output, "PNG")
    library.image_path(image["id"]).write_bytes(output.getvalue())
    library.scan("references")
    third = library.versions.create_version(first["work"]["id"], {"parent_id": first["version"]["id"], "image_ids": [image["id"]]})
    assert third["version"]["images"][0]["asset_id"] != asset["asset_id"]
    assert library.versions.asset_path(asset["asset_id"]).read_bytes() == original
    library.trash_image(image["id"])
    trashed_snapshot = library.versions.get_work(first["work"]["id"])["versions"][0]["images"][0]
    assert not trashed_snapshot["gallery_available"] and trashed_snapshot["available"]
    library.delete_trashed_image(image["id"])
    restored = library.versions.create_version(first["work"]["id"], {
        "parent_id": third["version"]["id"], "restore_version_id": first["version"]["id"], "operation": "restore",
    })
    assert restored["version"]["images"][0]["asset_id"] == asset["asset_id"]
    assert not restored["version"]["images"][0]["gallery_available"]
    assert restored["version"]["images"][0]["available"]
    assert library.versions.asset_path(asset["asset_id"]).read_bytes() == original
    assert len(library.versions.image_versions(image["id"])["works"]) == 2


def test_parameter_snapshot_keeps_inputs_but_strips_credentials(library):
    parameters = {
        "positivePrompt": "1girl", "scale": 6, "image": PNG_BASE64, "mask": PNG_BASE64,
        "token": "private-token", "api_key": "private-key", "cache_secret_key": "private-cache",
        "director_reference_images_cached": [{"data": PNG_BASE64, "cache_secret_key": "nested-secret", "token": "nested-token"}],
        "characterPrompts": [{"prompt": "red hair", "uc": "blue hair", "center": {"x": 0.3, "y": 0.7}}],
        "batch_id": "temporary", "version_context": {"work_id": "temporary"},
    }
    result = create_image_work(library, {"title": "可恢复", "parameters": parameters})
    snapshot = result["version"]["parameters"]
    assert snapshot["guidanceScale"] == 6
    assert snapshot["image"] == snapshot["mask"] == PNG_BASE64
    assert snapshot["director_reference_images_cached"] == [{"data": PNG_BASE64}]
    assert snapshot["characterTabs"][0]["prompt"] == "red hair"
    assert all(key not in snapshot for key in ("token", "api_key", "cache_secret_key", "batch_id", "version_context"))
    assert "secret" not in json.dumps(snapshot)
    parameters["characterPrompts"][0]["prompt"] = "changed after save"
    assert library.versions.get_work(result["work"]["id"])["versions"][0]["parameters"] == snapshot


@pytest.mark.parametrize("model", ["nai-diffusion-5-full-medium", "nai-diffusion-5-full-medium-inpainting", "NovelAI Diffusion V5 Full Medium"])
def test_medium_model_normalization_preserves_variant(model):
    assert normalize_image_parameters({"model": model})["model"] == "nai-diffusion-5-full-medium"


@pytest.mark.parametrize("model", ["nai-diffusion-4-full", "nai-diffusion-4-5-full"])
@pytest.mark.parametrize("center,position", [({"x": 0.3, "y": 0.3}, "B2"), ({"x": 0.12, "y": 0.73}, "A4")])
def test_v4_character_positions_survive_version_restore(library, model, center, position):
    parameters = {"model": model, "use_coords": True, "positivePrompt": "scene",
                  "characterPrompts": [{"prompt": "blue hair", "uc": "red hair", "center": center}]}
    first = create_image_work(library, {"title": "角色坐标", "parameters": parameters})
    work_id, root_id = first["work"]["id"], first["version"]["id"]
    changed = library.versions.create_version(work_id, {"parent_id": root_id, "parameters": {"positivePrompt": "other scene"}})
    restored = library.versions.create_version(work_id, {"parent_id": changed["version"]["id"], "operation": "restore", "restore_version_id": root_id})
    for version in (first["version"], restored["version"]):
        assert version["parameters"]["use_coords"] is True
        character = version["parameters"]["characterTabs"][0]
        assert character["position"] == position
        assert character["center"] == center
        assert character["prompt"] == "blue hair" and character["uc"] == "red hair"


@pytest.mark.parametrize("invalid_image", ["missing", "corrupt"])
def test_failed_multi_image_commit_does_not_write_orphan_assets(library, invalid_image):
    first = library.import_image(base64.b64decode(PNG_BASE64), "valid.png")
    second_id = "missing-image"
    if invalid_image == "corrupt":
        second = library.import_image(base64.b64decode(PNG_BASE64), "corrupt.png")
        second_id = second["id"]
        library.image_path(second_id).write_bytes(b"invalid external replacement")
    with pytest.raises((ExposableError, OSError)):
        library.versions.create_work({"title": "不会创建", "image_ids": [first["id"], second_id]})
    assert library.versions.list_works() == []
    assert not library.versions.asset_dir.exists()
    with library._connect() as db:
        assert db.execute("SELECT COUNT(*) FROM version_assets").fetchone()[0] == 0


def test_version_routes_require_session_csrf_and_assets_use_ids(client, app):
    assert client.get("/api/local/works").status_code == 401
    assert client.get("/api/local/works/missing/versions/missing").status_code == 401
    assert client.get("/api/local/versions/assets/unknown").status_code == 401
    csrf = login(client)
    assert client.post("/api/local/works", json={"title": "拒绝"}, headers={"Origin": ORIGIN}).status_code == 403
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    image = app.extensions["image_library"].import_image(base64.b64decode(PNG_BASE64), "route.png")
    response = client.post("/api/local/works", json={"title": "路由作品", "image_ids": [image["id"]]}, headers=headers)
    assert response.status_code == 200
    payload = response.get_json()
    work_id = payload["work"]["id"]
    image_snapshot = payload["version"]["images"][0]
    assert client.get(image_snapshot["url"]).data == base64.b64decode(PNG_BASE64)
    assert client.get(image_snapshot["thumbnail_url"]).status_code == 200
    assert client.get("/api/local/versions/assets/not-a-hash").status_code == 404
    assert client.get(f"/api/local/gallery/{image['id']}/versions").get_json()["works"][0]["id"] == work_id
    assert client.patch(f"/api/local/works/{work_id}", json={"title": "更新"}, headers=headers).get_json()["work"]["title"] == "更新"
    created = client.post(f"/api/local/works/{work_id}/versions", json={"parent_id": payload["version"]["id"], "parameters": {"positivePrompt": "blue"}}, headers=headers)
    assert created.status_code == 200
    assert len(client.get(f"/api/local/works/{work_id}").get_json()["versions"]) == 2
    single = client.get(f"/api/local/works/{work_id}/versions/{payload['version']['id']}")
    assert single.status_code == 200 and single.get_json()["version"] == payload["version"]
    other = create_image_work(app.extensions["image_library"], {"title": "另一作品"})
    assert client.get(f"/api/local/works/{work_id}/versions/{other['version']['id']}").status_code == 400


def test_generation_context_is_validated_before_paid_call(client, fake_client):
    csrf = login(client)
    response = client.post("/api/images/generate", json={"version_context": {"work_id": "missing", "parent_version_id": "missing"}},
                           headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert response.status_code == 404
    assert not any(call[0] == "generate" for call in fake_client.calls)


def test_smart_collection_routes_apply_saved_filters_and_require_csrf(client, app):
    assert client.get("/api/local/gallery/collections").status_code == 401
    csrf = login(client)
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    library = app.extensions["image_library"]
    selected = library.import_image(base64.b64decode(PNG_BASE64), "red.png", prompt="red hair")
    library.import_image(base64.b64decode(PNG_BASE64), "blue.png", prompt="blue hair")
    body = {"source": "references", "name": "红发", "filters": {"tags": "red hair"}}
    assert client.post("/api/local/gallery/collections", json=body, headers={"Origin": ORIGIN}).status_code == 403
    result = client.post("/api/local/gallery/collections", json=body, headers=headers)
    assert result.status_code == 200
    collection_id = result.get_json()["collection"]["id"]
    listing = client.get("/api/local/gallery", query_string={"source": "references", "collection_id": collection_id}).get_json()
    assert [item["id"] for item in listing["items"]] == [selected["id"]]
    assert client.get("/api/local/gallery/collections").get_json()["collections"][0]["id"] == collection_id
    assert client.delete(f"/api/local/gallery/collections/{collection_id}", headers=headers).get_json()["deleted"]
    assert library.image_path(selected["id"]).is_file()


def test_work_history_is_opt_in_and_leaving_keeps_existing_history(client, app, fake_client, monkeypatch, clock):
    csrf = login(client)
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    real_generate = fake_client.generate_image

    def generated(token, payload, correlation_id):
        images = real_generate(token, payload, correlation_id)
        images[0]["data"] = PNG_BASE64
        return images

    monkeypatch.setattr(fake_client, "generate_image", generated)
    library = app.extensions["image_library"]
    body = {"model": "nai-diffusion-4-5-full", "positivePrompt": "ordinary image", "seed": 42,
            "version_editor": {"obsolete": "ignored without an active work"}}
    ordinary = client.post("/api/images/generate", json=body, headers=headers)
    assert ordinary.status_code == 200
    image = ordinary.json["images"][0]
    assert library.image_path(image["saved_file"]["id"]).is_file()
    assert "version" not in image and "version_error" not in image
    assert library.versions.list_works() == []
    assert not library.versions.asset_dir.exists()
    assert "version_editor" not in json.dumps(next(call[2] for call in fake_client.calls if call[0] == "generate"))

    created = client.post("/api/local/works", json={"title": "主动启用", "parameters": {"positivePrompt": "draft"}}, headers=headers)
    assert created.status_code == 200
    work = created.json
    body.pop("version_editor")
    body["version_context"] = {"work_id": work["work"]["id"], "parent_version_id": None}
    clock[0] += 15
    recorded = client.post("/api/images/generate", json=body, headers=headers)
    assert recorded.status_code == 200
    assert work["version"] is None and work["work"]["version_count"] == 0
    assert recorded.json["images"][0]["version"]["number"] == 1
    history = library.versions.get_work(work["work"]["id"])

    body.pop("version_context")
    body["seed"] = 43
    clock[0] += 15
    left = client.post("/api/images/generate", json=body, headers=headers)
    assert left.status_code == 200
    assert "version" not in left.json["images"][0]
    assert library.image_path(left.json["images"][0]["saved_file"]["id"]).is_file()
    assert library.versions.get_work(work["work"]["id"]) == history
    assert len(library.versions.list_works()) == 1


@pytest.mark.parametrize("model", ["nai-diffusion-4-5-full", "nai-diffusion-5-full-medium"])
def test_generation_commits_actual_seed_and_branch_without_sending_context(client, app, fake_client, monkeypatch, clock, model, work_context):
    csrf = login(client)
    real_generate = fake_client.generate_image

    def generated(token, payload, correlation_id):
        images = real_generate(token, payload, correlation_id)
        images[0]["data"] = PNG_BASE64
        return images

    monkeypatch.setattr(fake_client, "generate_image", generated)
    body = {"model": model, "positivePrompt": "1girl", "negativePrompt": "", "seed": "", "width": 512, "height": 512,
            "version_context": work_context}
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    first = client.post("/api/images/generate", json=body, headers=headers)
    assert first.status_code == 200
    image = first.get_json()["images"][0]
    version = image["version"]
    saved = app.extensions["image_library"].versions.get_version(version["work_id"], version["version_id"])["version"]
    assert saved["parent_id"] == work_context["parent_version_id"]
    assert saved["parameters"]["seed"] == image["seed"] and isinstance(image["seed"], int)
    assert saved["parameters"]["model"] == model
    assert saved["images"][0]["id"] == image["saved_file"]["id"]
    clock[0] += 15
    body["version_context"] = {"work_id": version["work_id"], "parent_version_id": version["version_id"]}
    second = client.post("/api/images/generate", json=body, headers=headers)
    assert second.status_code == 200
    assert second.get_json()["images"][0]["version"]["number"] == 2
    official_payload = [call for call in fake_client.calls if call[0] == "generate"][-1][2]
    assert "version_context" not in json.dumps(official_payload)

    def fail_version(*args, **kwargs):
        raise sqlite3.OperationalError("synthetic disk failure")

    monkeypatch.setattr(app.extensions["image_library"].versions, "create_version", fail_version)
    clock[0] += 15
    third = client.post("/api/images/generate", json=body, headers=headers)
    assert third.status_code == 200
    assert third.get_json()["images"][0]["version_error"] == "LOCAL_VERSION_SAVE_FAILED"
    assert third.get_json()["images"][0]["saved_file"]["id"]
    assert len([call for call in fake_client.calls if call[0] == "generate"]) == 3


@pytest.mark.parametrize("tool,prompt", [("emotion", "happy;; smiling character"), ("colorize", "red dress, blue sky")])
def test_director_version_preserves_tool_prompt_separately(client, app, fake_client, monkeypatch, tool, prompt, work_context):
    csrf = login(client)
    real_augment = fake_client.augment_image

    def augmented(token, payload, correlation_id):
        image = real_augment(token, payload, correlation_id)
        image["data"] = PNG_BASE64
        return image

    monkeypatch.setattr(fake_client, "augment_image", augmented)
    body = {"model": "nai-diffusion-4-5-full", "positivePrompt": "main workbench prompt", "negativePrompt": "", "seed": 123,
            "width": 512, "height": 512, "image": PNG_BASE64, "action": True, "req_type": tool, "prompt": prompt, "defry": 2,
            "version_context": work_context}
    response = client.post("/api/images/generate", json=body, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert response.status_code == 200
    version = response.get_json()["images"][0]["version"]
    snapshot = app.extensions["image_library"].versions.get_version(version["work_id"], version["version_id"])["version"]["parameters"]
    assert snapshot["positivePrompt"] == "main workbench prompt"
    assert snapshot["prompt"] == prompt
    assert snapshot["req_type"] == tool and snapshot["defry"] == 2


def test_generation_preserves_local_character_editor_without_sending_it_upstream(client, app, fake_client, monkeypatch, work_context):
    csrf = login(client)
    real_generate = fake_client.generate_image

    def generated(token, payload, correlation_id):
        images = real_generate(token, payload, correlation_id)
        images[0]["data"] = PNG_BASE64
        return images

    monkeypatch.setattr(fake_client, "generate_image", generated)
    tabs = [{"name": "旅人", "prompt": "blue hair", "uc": "", "position": "B2", "colorId": 4},
            {"name": "同伴", "prompt": "red hair", "uc": "", "isTemporarilyDisabled": True, "colorId": 2}]
    characters = [{"prompt": "blue hair", "uc": "", "center": {"x": 0.3, "y": 0.3}}]
    body = {"model": "nai-diffusion-4-5-full", "positivePrompt": "scene", "seed": 123,
            "characterPrompts": characters, "version_editor": {"characterTabs": tabs}, "version_context": work_context}
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    rejected = client.post("/api/images/generate", json={**body, "version_editor": {"characterTabs": tabs, "settings": {}}}, headers=headers)
    assert rejected.status_code == 400 and rejected.get_json()["code"] == "VERSION_EDITOR_INVALID"
    assert not any(call[0] == "generate" for call in fake_client.calls)
    response = client.post("/api/images/generate", json=body, headers=headers)
    assert response.status_code == 200
    version = response.get_json()["images"][0]["version"]
    snapshot = app.extensions["image_library"].versions.get_version(version["work_id"], version["version_id"])["version"]["parameters"]
    assert snapshot["characterTabs"] == tabs
    assert "version_editor" not in snapshot
    official = next(call[2] for call in fake_client.calls if call[0] == "generate")
    assert official["parameters"]["characterPrompts"] == characters
    assert "version_editor" not in json.dumps(official) and "characterTabs" not in json.dumps(official)


def test_complete_editor_state_is_local_reusable_and_immutable(client, app, fake_client, monkeypatch, work_context):
    csrf = login(client)
    real_generate = fake_client.generate_image

    def generated(token, payload, correlation_id):
        images = real_generate(token, payload, correlation_id)
        images[0]["data"] = PNG_BASE64
        return images

    monkeypatch.setattr(fake_client, "generate_image", generated)
    editor = {
        "parameterState": {
            "params": {"model": "nai-diffusion-4-5-full", "seed": "", "api_key": "private"},
            "characterTabs": [{"name": "旅人", "prompt": "blue hair", "isTemporarilyDisabled": True}],
            "referenceImages": [{"name": "reference.png", "data": PNG_BASE64, "originalImage": f"data:image/png;base64,{PNG_BASE64}", "disabled": True, "strength": 0.4, "cache_secret_key": "private"}],
            "imagePreview": f"data:image/png;base64,{PNG_BASE64}", "editedImageData": None,
            "restoredMask": {"mask": f"data:image/png;base64,{PNG_BASE64}", "inpaintStrength": 0.5},
            "directorToolParams": None,
        },
        "vibeImages": [{"name": "Watercolor", "filename": "watercolor.naiv4vibe", "image": f"data:image/png;base64,{PNG_BASE64}", "encoding": "local-v4-encoding", "referenceStrength": 0.7, "informationExtracted": 0.5, "isTemporarilyDisabled": True}],
        "positivePrompt": "unexpanded draft", "negativePrompt": "",
    }
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    body = {"model": "nai-diffusion-4-5-full", "positivePrompt": "actual prompt", "seed": "", "version_editor": editor,
            "version_context": work_context}
    rejected = client.post("/api/images/generate", json={**body, "version_editor": {"parameterState": {"referenceImages": "invalid"}}}, headers=headers)
    assert rejected.status_code == 400
    assert not any(call[0] == "generate" for call in fake_client.calls)
    response = client.post("/api/images/generate", json=body, headers=headers)
    assert response.status_code == 200
    image = response.json["images"][0]
    store = app.extensions["image_library"].versions
    saved = store.get_version(image["version"]["work_id"], image["version"]["version_id"])["version"]
    snapshot = saved["parameters"]
    assert snapshot["positivePrompt"] == "actual prompt" and snapshot["seed"] == image["seed"]
    assert snapshot["editor_state"]["parameterState"]["params"]["seed"] == ""
    assert snapshot["editor_state"]["parameterState"]["referenceImages"][0]["data"] == PNG_BASE64
    assert snapshot["editor_state"]["vibeImages"][0]["encoding"] == "local-v4-encoding"
    assert snapshot["characterTabs"][0]["name"] == "旅人"
    assert "private" not in json.dumps(snapshot)
    official = next(call[2] for call in fake_client.calls if call[0] == "generate")
    assert "editor_state" not in json.dumps(official) and "local-v4-encoding" not in json.dumps(official)
    branch = store.create_version(image["version"]["work_id"], {"parent_id": saved["id"], "parameters": snapshot})
    restored = store.create_version(image["version"]["work_id"], {"parent_id": branch["version"]["id"], "restore_version_id": saved["id"], "operation": "restore"})
    assert restored["version"]["parameters"]["editor_state"] == snapshot["editor_state"]
    editor["vibeImages"][0]["name"] = "mutated after submit"
    assert store.get_version(image["version"]["work_id"], saved["id"])["version"]["parameters"]["editor_state"]["vibeImages"][0]["name"] == "Watercolor"


def test_prompt_only_version_keeps_complete_editor_and_rejects_invalid_structure(library):
    parameters = {"positivePrompt": "draft", "editor_state": {"parameterState": {"params": {"seed": ""}, "referenceImages": [{"data": "reference", "disabled": True}]}, "vibeImages": [{"encoding": "encoded-vibe", "name": "Saved vibe"}]}}
    root = create_image_work(library, {"title": "纯提示词编辑态"})
    created = library.versions.create_version(root["work"]["id"], {"parent_id": root["version"]["id"], "parameters": parameters})
    assert created["version"]["images"] == []
    assert created["version"]["parameters"]["editor_state"] == parameters["editor_state"]
    with pytest.raises(ExposableError) as caught:
        library.versions.create_version(created["work"]["id"], {"parent_id": created["version"]["id"], "parameters": {"editor_state": {"parameterState": {"characterTabs": [1]}}}})
    assert caught.value.code == "VERSION_EDITOR_INVALID"


def test_empty_work_starts_with_first_image_and_rejects_prompt_root(library):
    created = library.versions.create_work({"title": "空作品", "parameters": {"positivePrompt": "draft"}})
    work_id = created["work"]["id"]
    assert created["version"] is None and created["work"]["version_count"] == 0
    assert library.versions.get_work(work_id)["versions"] == []
    context = {"work_id": work_id, "parent_version_id": None}
    assert library.versions.validate_context(context) == context
    with pytest.raises(ExposableError) as caught:
        library.versions.create_version(work_id, {"parent_id": None, "parameters": {"positivePrompt": "draft"}})
    assert caught.value.code == "VERSION_FIRST_IMAGE_REQUIRED"
    image = library.import_image(base64.b64decode(PNG_BASE64), "first.png")
    first = library.versions.create_version(work_id, {"parent_id": None, "image_ids": [image["id"]]})["version"]
    assert first["number"] == 1 and first["parent_id"] is None
    # 两个首图请求同时开始时，后保存的图片仍接在有效根节点之后。
    next_version = library.versions.create_version(work_id, {"parent_id": None, "image_ids": [image["id"]]})["version"]
    assert next_version["number"] == 2 and next_version["parent_id"] == first["id"]


def test_edit_message_keeps_snapshot_and_rejects_other_changes(library):
    created = create_image_work(library, {"title": "说明", "parameters": {"seed": 12}})
    work_id, version = created["work"]["id"], created["version"]
    edited = library.versions.update_message(work_id, version["id"], {"message": "蓝色灯光"})
    assert edited == {**version, "message": "蓝色灯光"}
    for body in ({"message": 123}, {"message": "x" * 2001}, {"message": "valid", "parameters": {}}):
        with pytest.raises(ExposableError):
            library.versions.update_message(work_id, version["id"], body)


def test_bulk_delete_preserves_gallery_and_shared_assets(library):
    image = library.import_image(base64.b64decode(PNG_BASE64), "shared.png")
    first = library.versions.create_work({"title": "一", "image_ids": [image["id"]]})
    second = library.versions.create_work({"title": "二", "image_ids": [image["id"]]})
    empty = library.versions.create_work({"title": "空"})
    library.versions.create_version(first["work"]["id"], {"parent_id": first["version"]["id"], "parameters": {"seed": 2}})
    asset = first["version"]["images"][0]["asset_id"]
    asset_path = library.versions.asset_path(asset)
    # 任意选中作品不存在时，整批拒绝，不出现只删掉前半批的情况。
    with pytest.raises(ExposableError):
        library.versions.delete_works([first["work"]["id"], "missing"])
    assert len(library.versions.list_works()) == 3
    result = library.versions.delete_works([first["work"]["id"], empty["work"]["id"]])
    assert len(result["deleted_ids"]) == 2 and result["cleanup_failed"] == 0
    assert library.versions.asset_path(asset).is_file()
    assert library.versions.get_work(second["work"]["id"])["versions"][0]["images"][0]["available"]
    library.versions.delete_works([second["work"]["id"]])
    assert not asset_path.exists()
    assert library.image_path(image["id"]).is_file()
    with library._connect() as db:
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("SELECT COUNT(*) FROM version_assets").fetchone()[0] == 0


def test_message_and_bulk_delete_require_session_and_csrf(client, app):
    created = create_image_work(app.extensions["image_library"], {"title": "受保护"})
    work_id = created["work"]["id"]
    version_path = f"/api/local/works/{work_id}/versions/{created['version']['id']}"
    assert client.patch(version_path, json={"message": "改动"}, headers={"Origin": ORIGIN}).status_code == 401
    assert client.post("/api/local/works/batch-delete", json={"ids": [work_id]}, headers={"Origin": ORIGIN}).status_code == 401
    csrf = login(client)
    assert client.patch(version_path, json={"message": "改动"}, headers={"Origin": ORIGIN}).status_code == 403
    assert client.post("/api/local/works/batch-delete", json={"ids": [work_id]}, headers={"Origin": ORIGIN}).status_code == 403
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    assert client.patch(version_path, json={"message": "改动"}, headers=headers).json["version"]["message"] == "改动"
    assert client.post("/api/local/works/batch-delete", json={"ids": [work_id]}, headers=headers).json["deleted_ids"] == [work_id]
    assert client.get(f"/api/local/works/{work_id}").status_code == 404
