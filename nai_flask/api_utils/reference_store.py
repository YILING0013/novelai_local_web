"""SQLite-backed reference records and image blobs."""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path


class ReferenceStore:
    def __init__(self, data_dir, public_dir):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.public_dir = Path(public_dir)
        self.path = self.data_dir / "references.db"
        self.lock = threading.RLock()
        with self._connect() as db:
            db.executescript("""
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS reference_entries(
              id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('artist','image')),
              title TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '', parameters_json TEXT,
              created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS reference_images(
              id TEXT PRIMARY KEY, reference_id TEXT NOT NULL REFERENCES reference_entries(id) ON DELETE CASCADE,
              original_name TEXT NOT NULL, mime_type TEXT NOT NULL, image_data BLOB NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0);
            CREATE INDEX IF NOT EXISTS idx_reference_kind ON reference_entries(kind, created_at DESC);
            CREATE TABLE IF NOT EXISTS reference_migrations(name TEXT PRIMARY KEY);
            """)
        self._migrate_json("artist", "artist-threads", "artist-thread-images")
        self._migrate_json("image", "image-references", "image-reference-images")

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def _migrate_json(self, kind, name, image_folder):
        path = self.data_dir / f"{name}.json"
        if not path.exists():
            return
        try:
            rows = json.loads(path.read_text(encoding="utf-8")).get("data", [])
        except Exception:
            return
        with self.lock, self._connect() as db:
            if db.execute("SELECT 1 FROM reference_migrations WHERE name=?", (name,)).fetchone():
                return
            if db.execute("SELECT 1 FROM reference_entries WHERE kind=? LIMIT 1", (kind,)).fetchone():
                db.execute("INSERT INTO reference_migrations VALUES(?)", (name,))
                return
            for row in rows:
                rid = str(row.get("id") or uuid.uuid4().hex)
                db.execute("INSERT OR IGNORE INTO reference_entries VALUES(?,?,?,?,?,?)", (
                    rid, kind, str(row.get("title") or "未命名"), str(row.get("prompt") or ""),
                    json.dumps(row.get("parameters"), ensure_ascii=False) if isinstance(row.get("parameters"), dict) else None,
                    str(row.get("created_at") or ""),
                ))
                for position, image in enumerate(row.get("images") or []):
                    raw = None
                    filename = image.get("filename")
                    if filename:
                        source = self.data_dir / image_folder / Path(filename).name
                    else:
                        source = self.public_dir / "reference_img" / Path(image.get("image_url") or "").name
                    if source.is_file():
                        raw = source.read_bytes()
                    if raw:
                        db.execute("INSERT OR IGNORE INTO reference_images VALUES(?,?,?,?,?,?)", (
                            str(image.get("id") or uuid.uuid4().hex), rid,
                            str(image.get("original_name") or source.name), str(image.get("mime_type") or "image/png"),
                            raw, position,
                        ))
            db.execute("INSERT INTO reference_migrations VALUES(?)", (name,))

    def _hydrate(self, db, row):
        parameters = json.loads(row["parameters_json"]) if row["parameters_json"] else None
        images = [{
            "id": image["id"], "original_name": image["original_name"], "mime_type": image["mime_type"],
            "url": f"/api/local/reference-images/{image['id']}",
        } for image in db.execute(
            "SELECT id,original_name,mime_type FROM reference_images WHERE reference_id=? ORDER BY sort_order", (row["id"],)
        )]
        return {"id": row["id"], "title": row["title"], "prompt": row["prompt"], "parameters": parameters,
                "created_at": row["created_at"], "images": images}

    def list(self, kind):
        with self.lock, self._connect() as db:
            return [self._hydrate(db, row) for row in db.execute(
                "SELECT * FROM reference_entries WHERE kind=? ORDER BY created_at DESC,rowid DESC", (kind,)
            )]

    def create(self, kind, entry, images):
        with self.lock, self._connect() as db:
            db.execute("INSERT INTO reference_entries VALUES(?,?,?,?,?,?)", (
                entry["id"], kind, entry["title"], entry["prompt"],
                json.dumps(entry.get("parameters"), ensure_ascii=False) if entry.get("parameters") else None,
                entry["created_at"],
            ))
            db.executemany("INSERT INTO reference_images VALUES(?,?,?,?,?,?)", [
                (image["id"], entry["id"], image["original_name"], image["mime_type"], image["data"], position)
                for position, image in enumerate(images)
            ])
            return self._hydrate(db, db.execute("SELECT * FROM reference_entries WHERE id=?", (entry["id"],)).fetchone())

    def update(self, kind, reference_id, title, prompt, parameters=None, replace_parameters=False):
        with self.lock, self._connect() as db:
            row = db.execute("SELECT * FROM reference_entries WHERE id=? AND kind=?", (reference_id, kind)).fetchone()
            if not row:
                return None
            encoded = row["parameters_json"]
            if replace_parameters:
                encoded = json.dumps(parameters, ensure_ascii=False) if parameters is not None else None
            db.execute("UPDATE reference_entries SET title=?,prompt=?,parameters_json=? WHERE id=?", (title, prompt, encoded, reference_id))
            return self._hydrate(db, db.execute("SELECT * FROM reference_entries WHERE id=?", (reference_id,)).fetchone())

    def delete(self, kind, reference_id):
        with self.lock, self._connect() as db:
            return db.execute("DELETE FROM reference_entries WHERE id=? AND kind=?", (reference_id, kind)).rowcount == 1

    def image(self, image_id):
        with self.lock, self._connect() as db:
            row = db.execute("SELECT image_data,mime_type,original_name FROM reference_images WHERE id=?", (image_id,)).fetchone()
            return dict(row) if row else None
