"""验证本地词条分组的持久化、兼容与整次导入行为。"""

from conftest import ORIGIN, login
from test_local_routes import headers


def test_groups_move_delete_and_legacy_file_preservation(client, app):
    store = app.extensions["local_store"]
    original = [{"id": "legacy", "title": "旧词条", "text_content1": "1girl"}]
    store.write("notes", original)
    csrf = headers(login(client))
    assert client.get("/api/local/notes").get_json()["notes"] == original
    parent = client.post("/api/local/note-groups", json={"name": "角色"}, headers=csrf).get_json()["groups"][0]
    child = client.post("/api/local/note-groups", json={"name": "服装", "parent_id": parent["id"]}, headers=csrf).get_json()["groups"][1]
    moved = client.post("/api/local/notes/batch", json={"action": "move", "titles": ["旧词条"], "group_id": child["id"]}, headers=csrf)
    assert moved.get_json()["notes"][0]["group_id"] == child["id"]
    # 新数据写入后，再次读取不重复迁移；旧文件可供回滚且保持字节内容不变。
    assert store.read("notes") == original
    assert store.read_notebook()["notes"][0]["group_id"] == child["id"]
    deleted = client.delete(f'/api/local/note-groups/{parent["id"]}', headers=csrf)
    assert deleted.get_json()["groups"] == []
    assert deleted.get_json()["notes"] == [{**original[0], "group_id": None}]
    assert store.read("notes") == original


def test_group_depth_invalid_parent_and_missing_batch_are_atomic(client):
    csrf = headers(login(client))
    parent = None
    for name in ["一", "二", "三"]:
        result = client.post("/api/local/note-groups", json={"name": name, "parent_id": parent}, headers=csrf)
        assert result.status_code == 200
        parent = result.get_json()["groups"][-1]["id"]
    before = client.get("/api/local/notes").get_json()
    for payload in [{"name": "四", "parent_id": parent}, {"name": "失效", "parent_id": "missing"}]:
        assert client.post("/api/local/note-groups", json=payload, headers=csrf).status_code == 400
    assert client.post("/api/local/notes/batch", json={"action": "delete", "titles": ["不存在"]}, headers=csrf).status_code == 404
    assert client.get("/api/local/notes").get_json() == before


def test_import_export_groups_old_arrays_and_conflicts(client):
    csrf = headers(login(client))
    content = {"texts": [{"title": "新词条", "group_id": "one", "character_tabs": [{"prompt": "blue eyes"}]}], "groups": [{"id": "one", "name": "角色", "parent_id": None}]}
    imported = client.post("/api/local/notes/import", json={"content": content}, headers=csrf)
    assert imported.status_code == 200
    exported = client.get("/api/local/notes").get_json()
    assert exported["groups"][0]["id"] != "one"
    assert exported["notes"][0]["group_id"] == exported["groups"][0]["id"]
    assert client.post("/api/local/notes/import", json={"content": [{"title": "数组词条"}]}, headers=csrf).status_code == 200
    before = client.get("/api/local/notes").get_json()
    assert client.post("/api/local/notes/import", json={"content": [{"title": "不应写入"}, {"title": "数组词条"}]}, headers=csrf).status_code == 409
    assert client.get("/api/local/notes").get_json() == before
    assert client.post("/api/local/notes/import", json={"content": {"wrong": []}}, headers=csrf).status_code == 400
    assert client.post("/api/local/notes/import", json={"content": [{"title": "失效引用", "group_id": "missing"}]}, headers=csrf).status_code == 400


def test_new_notebook_routes_require_session_and_csrf(client):
    assert client.post("/api/local/note-groups", json={"name": "角色"}, headers={"Origin": ORIGIN}).status_code == 401
    login(client)
    for path in ["/api/local/note-groups", "/api/local/notes/import", "/api/local/notes/batch"]:
        assert client.post(path, json={}).status_code == 403
