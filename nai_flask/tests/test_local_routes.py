from conftest import ORIGIN, login


def headers(csrf):
    return {"Origin": ORIGIN, "X-CSRF-Token": csrf}


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
