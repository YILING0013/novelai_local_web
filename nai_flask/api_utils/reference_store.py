"""将本地参考记录和图片保存在同一个 SQLite 数据库中。"""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path

from .local_store import LocalStoreError


class ReferenceStore:
    """保存画师串和图片参考，并保留已有 JSON 参考库的迁移入口。"""

    def __init__(self, data_dir, public_dir):
        """
        初始化参考库并导入尚未迁移的旧数据。

        Args:
            data_dir: 本地运行数据目录。
            public_dir: 旧参考图片所在的前端 public 目录。
        """
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.public_dir = Path(public_dir)
        self.path = self.data_dir / "references.db"
        self.lock = threading.RLock()
        with self._connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS reference_entries(
              id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('artist','image')),
              title TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '', parameters_json TEXT,
              created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS reference_images(
              id TEXT PRIMARY KEY, reference_id TEXT NOT NULL REFERENCES reference_entries(id) ON DELETE CASCADE,
              original_name TEXT NOT NULL, mime_type TEXT NOT NULL, image_data BLOB NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0);
            CREATE INDEX IF NOT EXISTS idx_reference_kind ON reference_entries(kind, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_reference_images ON reference_images(reference_id, sort_order);
            CREATE TABLE IF NOT EXISTS reference_migrations(name TEXT PRIMARY KEY);
            """)
        self._migrate_json("artist", "artist-threads", "artist-thread-images")
        self._migrate_json("image", "image-references", "image-reference-images")

    @contextmanager
    def _connect(self):
        """每次操作使用独立连接，并统一提交或回滚事务。"""
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def _migrate_json(self, kind, name, image_folder):
        """一次性导入旧记录；保留原文件且不覆盖已经编辑过的同 ID 记录。"""
        path = self.data_dir / f"{name}.json"
        if not path.exists():
            return
        with self.lock, self._connect() as db:
            if db.execute("SELECT 1 FROM reference_migrations WHERE name=?", (name,)).fetchone():
                return
            try:
                envelope = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise LocalStoreError(f"Legacy reference file '{name}' could not be read.") from exc
            if not isinstance(envelope, dict) or not isinstance(envelope.get("data"), list):
                raise LocalStoreError(f"Legacy reference file '{name}' must contain a data array.")
            rows = envelope["data"]
            for row in rows:
                if not isinstance(row, dict):
                    raise LocalStoreError(f"Legacy reference file '{name}' contains an invalid record.")
                rid = str(row.get("id") or uuid.uuid4().hex)
                if db.execute("SELECT 1 FROM reference_entries WHERE id=?", (rid,)).fetchone():
                    continue
                db.execute("INSERT INTO reference_entries VALUES(?,?,?,?,?,?)", (
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
        """组合参考信息和图片地址，列表查询不读取图片二进制。"""
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
        """
        按创建时间读取一种参考记录。

        Args:
            kind: artist 或 image。

        Returns:
            包含图片地址的参考记录列表。
        """
        with self.lock, self._connect() as db:
            return [self._hydrate(db, row) for row in db.execute(
                "SELECT * FROM reference_entries WHERE kind=? ORDER BY created_at DESC,rowid DESC", (kind,)
            )]

    def get(self, kind, reference_id):
        """
        按类别和 ID 读取单条参考记录。

        Args:
            kind: artist 或 image。
            reference_id: 参考记录 ID。

        Returns:
            参考记录；未找到时返回 None。
        """
        with self.lock, self._connect() as db:
            row = db.execute("SELECT * FROM reference_entries WHERE id=? AND kind=?", (reference_id, kind)).fetchone()
            return self._hydrate(db, row) if row else None

    def create(self, kind, entry, images):
        """
        在一个事务中新增参考记录和图片。

        Args:
            kind: artist 或 image。
            entry: 已校验的参考信息。
            images: 已校验的图片信息和二进制内容。

        Returns:
            已保存的参考记录及其图片地址。
        """
        with self.lock, self._connect() as db:
            db.execute("INSERT INTO reference_entries VALUES(?,?,?,?,?,?)", (
                entry["id"], kind, entry["title"], entry["prompt"],
                json.dumps(entry["parameters"], ensure_ascii=False) if entry.get("parameters") is not None else None,
                entry["created_at"],
            ))
            db.executemany("INSERT INTO reference_images VALUES(?,?,?,?,?,?)", [
                (image["id"], entry["id"], image["original_name"], image["mime_type"], image["data"], position)
                for position, image in enumerate(images)
            ])
            return self._hydrate(db, db.execute("SELECT * FROM reference_entries WHERE id=?", (entry["id"],)).fetchone())

    def update(self, kind, reference_id, title, prompt, parameters=None, replace_parameters=False):
        """
        更新参考文字和可选的生成参数，保留已有图片。

        Args:
            kind: artist 或 image。
            reference_id: 参考记录 ID。
            title: 标题。
            prompt: 提示词。
            parameters: 新的生成参数，None 表示清除。
            replace_parameters: 是否更新生成参数；未提交时保留原参数。

        Returns:
            更新后的参考记录；未找到时返回 None。
        """
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
        """
        删除参考记录，并通过外键级联删除它的图片。

        Args:
            kind: artist 或 image。
            reference_id: 参考记录 ID。

        Returns:
            是否删除了指定记录。
        """
        with self.lock, self._connect() as db:
            return db.execute("DELETE FROM reference_entries WHERE id=? AND kind=?", (reference_id, kind)).rowcount == 1

    def image(self, image_id):
        """
        读取一张参考图片的二进制内容。

        Args:
            image_id: 图片 ID。

        Returns:
            包含内容、MIME 和原文件名的字典；未找到时返回 None。
        """
        with self.lock, self._connect() as db:
            row = db.execute("SELECT image_data,mime_type,original_name FROM reference_images WHERE id=?", (image_id,)).fetchone()
            return dict(row) if row else None
