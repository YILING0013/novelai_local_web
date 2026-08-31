import json
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from api_utils.local_store import LocalJsonStore, LocalStoreError


def test_store_enforces_schema_and_uses_independent_locks(tmp_path):
    store = LocalJsonStore(tmp_path)
    assert store.read("settings") == {}
    assert store.read("random-prompts") == {
        "categories": [],
        "collections": [],
        "enabled": True,
    }
    assert store.read("notes") == []
    assert store._locks["settings"] is not store._locks["notes"]

    with pytest.raises(LocalStoreError):
        store.write("settings", [])
    with pytest.raises(LocalStoreError):
        store.write("notes", {})
    with pytest.raises(LocalStoreError):
        store.write("random-prompts", [])


def test_store_rejects_credentials_without_blocking_normal_prompt_words(tmp_path):
    store = LocalJsonStore(tmp_path)
    store.write("notes", [{"id": "one", "text": "A character forgot the password."}])
    with pytest.raises(LocalStoreError, match="Credentials"):
        store.write("settings", {"access_token": "anything"})
    for field_name in (
        "currentPassword",
        "accessToken",
        "accountAccessKey",
        "persistentToken",
        "providerApiKey",
    ):
        with pytest.raises(LocalStoreError, match="Credentials"):
            store.write("settings", {field_name: "short"})
    with pytest.raises(LocalStoreError, match="Credentials"):
        store.write("notes", [{"text": "pst-abcdefghijklmnopqrstuvwxyz"}])
    with pytest.raises(LocalStoreError, match="Credentials"):
        store.write("settings", {"value": "eyJabcdefgh.abcdefgh.abcdefgh"})
    with pytest.raises(LocalStoreError, match="Credentials"):
        store.write("notes", [{
            "text": "copied token: pst-abcdefghijklmnopqrstuvwxyz inside prose",
        }])
    with pytest.raises(LocalStoreError, match="Credentials"):
        store.write("settings", {
            "note": "prefix eyJabcdefgh.abcdefgh.abcdefgh suffix",
        })


def test_store_rejects_credentials_from_existing_valid_envelope(tmp_path):
    """手工或旧版本写入的合法 envelope 也不能把凭据返回给浏览器。"""

    (tmp_path / "settings.json").write_text(
        json.dumps({
            "schema_version": 1,
            "data": {"accessToken": "short"},
        }),
        encoding="utf-8",
    )
    with pytest.raises(LocalStoreError, match="Credentials"):
        LocalJsonStore(tmp_path).read("settings")


def test_store_mutate_serializes_concurrent_read_modify_write(tmp_path):
    store = LocalJsonStore(tmp_path)
    workers = 6
    barrier = threading.Barrier(workers)

    def append_note(index):
        """让并发调用同时抵达 mutate，再在集合锁内追加。"""

        barrier.wait()
        store.mutate(
            "notes",
            lambda notes: notes + [{"id": str(index), "title": f"note-{index}"}],
        )

    with ThreadPoolExecutor(max_workers=workers) as executor:
        list(executor.map(append_note, range(workers)))

    saved = store.read("notes")
    assert len(saved) == workers
    assert {note["id"] for note in saved} == {str(index) for index in range(workers)}


def test_store_writes_atomically_and_keeps_last_good_backup(tmp_path):
    store = LocalJsonStore(tmp_path)
    store.write("settings", {"theme": "light"})
    store.write("settings", {"theme": "dark"})

    current = json.loads((tmp_path / "settings.json").read_text(encoding="utf-8"))
    backup = json.loads((tmp_path / "settings.json.bak").read_text(encoding="utf-8"))
    assert current == {"schema_version": 1, "data": {"theme": "dark"}}
    assert backup == {"schema_version": 1, "data": {"theme": "light"}}
    assert not list(tmp_path.glob("*.tmp"))


def test_damaged_file_is_reported_and_never_reset(tmp_path):
    path = tmp_path / "notes.json"
    path.write_text("not-json", encoding="utf-8")
    store = LocalJsonStore(tmp_path)

    with pytest.raises(LocalStoreError, match="damaged"):
        store.read("notes")
    with pytest.raises(LocalStoreError, match="damaged"):
        store.write("notes", [{"id": "one"}])
    assert path.read_text(encoding="utf-8") == "not-json"


def test_store_rejects_oversized_read_and_write(tmp_path):
    store = LocalJsonStore(tmp_path, max_bytes=16)
    with pytest.raises(LocalStoreError, match="too large"):
        store.write("settings", {"long": "x" * 30})

    (tmp_path / "notes.json").write_text("{" + " " * 20 + "}", encoding="utf-8")
    with pytest.raises(LocalStoreError, match="too large"):
        store.read("notes")
