import base64
from pathlib import Path

import pytest

from conftest import ORIGIN, PNG_BASE64, login


def headers(csrf):
    return {"Origin": ORIGIN, "X-CSRF-Token": csrf}


@pytest.mark.parametrize("collection,key", [
    ("artist-threads", "artist_thread"),
    ("image-references", "image_reference"),
])
def test_reference_upload_needs_no_temporary_files(client, app, monkeypatch, collection, key):
    csrf = login(client)
    # The fixture puts DATA_DIR outside the source tree. Deny Python file writes
    # after initialization; SQLite can still write its configured database.
    def deny_write(*args, **kwargs):
        raise PermissionError("Source tree is read-only")

    monkeypatch.setattr(Path, "mkdir", deny_write)
    monkeypatch.setattr(Path, "write_bytes", deny_write)
    response = client.post(
        f"/api/local/{collection}",
        json={"title": "Synthetic reference", "images": [{
            "data_url": f"data:image/png;base64,{PNG_BASE64}",
            "original_name": "synthetic.png",
        }]},
        headers=headers(csrf),
    )
    assert response.status_code == 201
    stored = response.get_json()[key]["images"][0]
    image_response = client.get(stored["url"])
    assert image_response.status_code == 200
    assert image_response.mimetype == "image/png"
    assert image_response.data == base64.b64decode(PNG_BASE64)
    image_response.close()
    assert app.extensions["reference_store"].path.parent == Path(app.config["DATA_DIR"])
    assert not (Path(app.config["DATA_DIR"]) / ".upload-validation").exists()


@pytest.mark.parametrize("encoded", ["not-base64!", base64.b64encode(b"not an image").decode()])
def test_reference_upload_rejects_invalid_image_without_saving(client, encoded):
    csrf = login(client)
    response = client.post(
        "/api/local/image-references",
        json={"title": "Invalid reference", "images": [{
            "data_url": f"data:image/png;base64,{encoded}",
        }]},
        headers=headers(csrf),
    )
    assert response.status_code == 400
    assert response.get_json()["code"] == "IMAGE_INVALID"
    assert client.get("/api/local/image-references").get_json() == {"image_references": []}


def test_artist_thread_crud_with_local_image(client):
    csrf = login(client)
    created = client.post(
        "/api/local/artist-threads",
        json={
            "title": "测试画师串",
            "prompt": "artist:test",
            "images": [{
                "data_url": f"data:image/png;base64,{PNG_BASE64}",
                "original_name": "reference.png",
            }],
        },
        headers=headers(csrf),
    )
    assert created.status_code == 201
    thread = created.get_json()["artist_thread"]
    assert thread["title"] == "测试画师串"
    assert len(thread["images"]) == 1
    image_response = client.get(thread["images"][0]["url"])
    assert image_response.status_code == 200
    assert image_response.mimetype == "image/png"
    image_response.close()

    updated = client.put(
        f"/api/local/artist-threads/{thread['id']}",
        json={"title": "已编辑", "prompt": "artist:edited"},
        headers=headers(csrf),
    )
    assert updated.status_code == 200
    assert updated.get_json()["artist_thread"]["prompt"] == "artist:edited"
    assert len(updated.get_json()["artist_thread"]["images"]) == 1

    deleted = client.delete(
        f"/api/local/artist-threads/{thread['id']}",
        headers=headers(csrf),
    )
    assert deleted.status_code == 200
    assert client.get(thread["images"][0]["url"]).status_code == 404
    assert client.get("/api/local/artist-threads").get_json() == {"artist_threads": []}


def test_image_reference_crud_with_parameters_and_local_image(client):
    csrf = login(client)
    created = client.post(
        "/api/local/image-references",
        json={
            "title": "构图参考",
            "prompt": "blue hour",
            "parameters": {"steps": 28, "seed": 42},
            "images": [{
                "data_url": f"data:image/png;base64,{PNG_BASE64}",
                "original_name": "composition.png",
            }],
        },
        headers=headers(csrf),
    )
    assert created.status_code == 201
    reference = created.get_json()["image_reference"]
    assert reference["parameters"] == {"steps": 28, "seed": 42}
    image_response = client.get(reference["images"][0]["url"])
    assert image_response.status_code == 200
    image_response.close()

    updated = client.put(
        f"/api/local/image-references/{reference['id']}",
        json={"title": "已编辑构图", "prompt": "sunset"},
        headers=headers(csrf),
    )
    assert updated.status_code == 200
    assert updated.get_json()["image_reference"]["parameters"]["seed"] == 42

    deleted = client.delete(
        f"/api/local/image-references/{reference['id']}",
        headers=headers(csrf),
    )
    assert deleted.status_code == 200
    assert client.get(reference["images"][0]["url"]).status_code == 404
    assert client.get("/api/local/image-references").get_json() == {"image_references": []}


def test_settings_and_random_prompts_round_trip(client):
    csrf = login(client)
    settings = client.put(
        "/api/local/settings",
        json={"settings": {"theme": "dark"}},
        headers=headers(csrf),
    )
    assert settings.get_json() == {"settings": {"theme": "dark"}}
    assert client.get("/api/local/settings").get_json() == settings.get_json()

    prompts = client.put(
        "/api/local/random-prompts",
        json={"random_prompts": {
            "categories": ["one"],
            "collections": ["two"],
            "enabled": True,
        }},
        headers=headers(csrf),
    )
    assert prompts.get_json() == {"random_prompts": {
        "categories": ["one"],
        "collections": ["two"],
        "enabled": True,
    }}
    assert client.get("/api/local/random-prompts").get_json() == prompts.get_json()


def test_note_crud_contract(client):
    csrf = login(client)
    created = client.post(
        "/api/local/notes",
        json={"note": {"title": "draft", "content": "text"}},
        headers=headers(csrf),
    )
    assert created.status_code == 201
    note = created.get_json()["note"]
    assert note["id"]

    listed = client.get("/api/local/notes").get_json()["notes"]
    assert listed == [note]

    note["title"] = "updated"
    updated = client.put(
        "/api/local/notes",
        json={"note": note},
        headers=headers(csrf),
    )
    assert updated.get_json() == {"note": note}

    deleted = client.delete(
        "/api/local/notes",
        json={"id": note["id"]},
        headers=headers(csrf),
    )
    assert deleted.get_json() == {"deleted": True}
    assert client.get("/api/local/notes").get_json() == {"notes": []}


def test_note_routes_accept_original_title_and_title_delete(client):
    csrf = login(client)
    created = client.post(
        "/api/local/notes",
        json={"note": {"title": "original", "content": "one"}},
        headers=headers(csrf),
    ).get_json()["note"]

    updated = client.put(
        "/api/local/notes",
        json={
            "original_title": "original",
            "note": {"title": "renamed", "content": "two"},
        },
        headers=headers(csrf),
    )
    assert updated.status_code == 200
    assert updated.get_json()["note"]["id"] == created["id"]
    assert updated.get_json()["note"]["title"] == "renamed"

    deleted = client.delete(
        "/api/local/notes",
        json={"title": "renamed"},
        headers=headers(csrf),
    )
    assert deleted.get_json() == {"deleted": True}


def test_note_titles_are_unique_and_import_replaces_atomically(client):
    csrf = login(client)
    assert client.post(
        "/api/local/notes",
        json={"note": {"title": "same", "content": "one"}},
        headers=headers(csrf),
    ).status_code == 201
    duplicate = client.post(
        "/api/local/notes",
        json={"note": {"title": "same", "content": "two"}},
        headers=headers(csrf),
    )
    assert duplicate.status_code == 409
    assert duplicate.get_json()["code"] == "NOTE_TITLE_EXISTS"

    imported = client.put(
        "/api/local/notes",
        json={"notes": [
            {"title": "import-a", "content": "A"},
            {"title": "import-b", "content": "B"},
        ]},
        headers=headers(csrf),
    )
    assert imported.status_code == 200
    assert [note["title"] for note in imported.get_json()["notes"]] == [
        "import-a",
        "import-b",
    ]
    assert client.get("/api/local/notes").get_json() == imported.get_json()

    rejected = client.put(
        "/api/local/notes",
        json={"notes": [
            {"title": "duplicate"},
            {"title": "duplicate"},
        ]},
        headers=headers(csrf),
    )
    assert rejected.status_code == 409
    assert [note["title"] for note in client.get(
        "/api/local/notes"
    ).get_json()["notes"]] == ["import-a", "import-b"]
