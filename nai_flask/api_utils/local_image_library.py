"""把参考图和生成图保存为本地文件，用 SQLite 管理检索、分组和回收站。"""

from __future__ import annotations

import io
import json
import math
import os
import re
import sqlite3
import tempfile
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps, PngImagePlugin

from .custom_errors import ExposableError
from .image_metadata import (read_metadata_document, metadata_parameters,
                             metadata_bindings, edit_metadata_document, write_metadata_png)


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
FORMAT_SUFFIXES = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp", "BMP": ".bmp"}
MAX_IMAGE_BYTES = 30 * 1024 * 1024


def normalize_image_parameters(values):
    """
    将 NovelAI PNG、隐写或官方请求参数转换为已有绘画页面接受的字段。

    Args:
        values: 原始元数据字典或已经规范化的 UI 参数。

    Returns:
        可直接应用到绘画页面的参数字典。
    """
    if not isinstance(values, dict):
        return {}
    source = dict(values)
    for key in ("Comment", "parameters"):
        nested = source.get(key)
        if isinstance(nested, str):
            try:
                nested = json.loads(nested)
            except json.JSONDecodeError:
                nested = None
        if isinstance(nested, dict):
            source.update(nested)
    result = {}
    mappings = {
        "positivePrompt": ("positivePrompt", "prompt", "input", "Description"),
        "negativePrompt": ("negativePrompt", "negative_prompt", "uc"),
        "width": ("width",), "height": ("height",), "steps": ("steps",),
        "guidanceScale": ("guidanceScale", "scale"), "seed": ("seed",),
        "model": ("model", "model_name"), "sampler": ("sampler",),
        "noiseSchedule": ("noiseSchedule", "noise_schedule"),
        "promptGuidanceRescale": ("promptGuidanceRescale", "cfg_rescale"),
        "smea": ("smea", "sm"), "dyn": ("dyn", "sm_dyn"),
        "characterTabs": ("characterTabs",), "use_coords": ("use_coords",),
        "v4_prompt": ("v4_prompt",), "v4_negative_prompt": ("v4_negative_prompt",),
        "ucPresetId": ("ucPresetId",), "qualityPresetId": ("qualityPresetId",),
        "variety": ("variety",), "decrisp": ("decrisp",),
        "legacy": ("legacy",), "legacy_uc": ("legacy_uc",),
        "legacy_v3_extend": ("legacy_v3_extend",),
        "prefer_brownian": ("prefer_brownian",),
        "deliberate_euler_ancestral_bug": ("deliberate_euler_ancestral_bug",),
    }
    for target, candidates in mappings.items():
        for key in candidates:
            if key in source and source[key] is not None:
                result[target] = source[key]
                break
    for target, key in (("positivePrompt", "v4_prompt"), ("negativePrompt", "v4_negative_prompt")):
        container = source.get(key)
        if target not in result and isinstance(container, dict):
            caption = container.get("caption")
            if isinstance(caption, dict) and "base_caption" in caption:
                result[target] = caption["base_caption"]
    positive_container = source.get("v4_prompt") or {}
    negative_container = source.get("v4_negative_prompt") or {}
    if "characterTabs" not in result and isinstance(source.get("characterPrompts"), list):
        result["characterTabs"] = []
        for index, character in enumerate(source["characterPrompts"]):
            if not isinstance(character, dict):
                character = {}
            center = character.get("center")
            if center is None and isinstance(character.get("centers"), list) and character["centers"]:
                center = character["centers"][0]
            tab = {"name": character.get("name", ""), "prompt": character.get("prompt", character.get("positivePrompt", "")),
                   "uc": character.get("uc", character.get("negativePrompt", character.get("negative_prompt", ""))),
                   "position": character.get("position", "C3"), "colorId": index % 6}
            if isinstance(center, dict):
                tab["center"] = center
            result["characterTabs"].append(tab)
    if "use_coords" not in result and isinstance(positive_container, dict) and "use_coords" in positive_container:
        result["use_coords"] = positive_container["use_coords"]
    # 绘画工作台的角色入口接收 characterTabs，不能只保存官方 caption 而丢掉角色。
    if "characterTabs" not in result and isinstance(positive_container, dict) and isinstance(negative_container, dict):
        positive_caption = positive_container.get("caption") or {}
        negative_caption = negative_container.get("caption") or {}
        positive_characters = positive_caption.get("char_captions", []) if isinstance(positive_caption, dict) else []
        negative_characters = negative_caption.get("char_captions", []) if isinstance(negative_caption, dict) else []
        if isinstance(positive_characters, list) and isinstance(negative_characters, list):
            tabs = []
            for index in range(max(len(positive_characters), len(negative_characters))):
                positive = positive_characters[index] if index < len(positive_characters) else {}
                negative = negative_characters[index] if index < len(negative_characters) else {}
                positive = positive if isinstance(positive, dict) else {}
                negative = negative if isinstance(negative, dict) else {}
                prompt = positive.get("char_caption", positive.get("prompt", ""))
                uc = negative.get("char_caption", negative.get("uc", ""))
                tab = {"name": positive.get("name", ""), "prompt": prompt, "uc": uc, "position": "C3", "colorId": index % 6}
                centers = positive.get("centers")
                center = centers[0] if isinstance(centers, list) and centers else positive.get("center")
                if isinstance(center, dict):
                    x, y = center.get("x"), center.get("y")
                    if isinstance(x, (int, float)) and isinstance(y, (int, float)) and math.isfinite(x) and math.isfinite(y):
                        tab["center"] = {"x": x, "y": y}
                        if x != 0 or y != 0:
                            tab["position"] = "ABCDE"[min(4, max(0, math.floor(x * 5)))] + str(min(4, max(0, math.floor(y * 5))) + 1)
                tabs.append(tab)
            if tabs:
                result["characterTabs"] = tabs
    # Source 只含版本哈希时不能可靠区分 Full/Curated，保留原始字段供查看，不猜模型。
    model_name = result.get("model") or source.get("Source")
    if isinstance(model_name, str):
        canonical = re.search(r"nai-diffusion-(?:furry-)?(?:[345](?:-5)?)-(?:full|curated(?:-preview)?)(?:-inpainting)?|nai-diffusion-(?:furry-)?3(?:-inpainting)?", model_name, re.IGNORECASE)
        if canonical:
            result["model"] = canonical.group(0).lower().removesuffix("-inpainting")
        else:
            label = re.search(r"(?:NovelAI|NAI)\s+Diffusion\s+(?:Anime\s+)?V?(4\.5|4|5)\s+(Full|Curated)(?:\s+Preview)?", model_name, re.IGNORECASE)
            if label:
                version, variant = label.group(1).replace(".", "-"), label.group(2).lower()
                result["model"] = f"nai-diffusion-{version}-{variant}"
                if version == "4" and variant == "curated":
                    result["model"] += "-preview"
    return result


def _inspect_image(file):
    with Image.open(file) as image:
        if image.format not in FORMAT_SUFFIXES or getattr(image, "n_frames", 1) != 1:
            raise ExposableError("Only single-frame PNG, JPEG, WebP and BMP images are supported.", code="LIBRARY_IMAGE_INVALID")
        if image.width * image.height > 64 * 1024 * 1024:
            raise ExposableError("The image exceeds 64 million pixels.", code="LIBRARY_IMAGE_TOO_LARGE")
        image.load()
        image_format = image.format
        document, warnings = read_metadata_document(image)
        raw = {key: value for key, value in image.info.items() if isinstance(value, str)}
        for entry in document.get("exif", {}).values():
            value = entry["value"]
            raw[entry["name"]] = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value
        for key in ("stealth", "stealth_rgb"):
            if key in document:
                raw[key] = document[key]
        if warnings:
            raw["metadata_warning"] = "; ".join(warnings)
        parameters = normalize_image_parameters(metadata_parameters(document))
        oriented = ImageOps.exif_transpose(image)
        width, height = oriented.size
        parameters.setdefault("width", width)
        parameters.setdefault("height", height)
        thumb = oriented.convert("RGBA")
        thumb.thumbnail((480, 480))
        encoded_thumbnail = io.BytesIO()
        thumb.save(encoded_thumbnail, "PNG")
    return {
        "width": width, "height": height, "format": image_format,
        "parameters": parameters, "metadata": raw, "metadata_document": document,
        "thumbnail": encoded_thumbnail.getvalue(),
    }


class LocalImageLibrary:
    """管理当前参考目录与生成目录中的文件，不把图像写入浏览器缓存。"""

    def __init__(self, data_dir, image_dir=None):
        """
        初始化文件目录和图库索引。

        Args:
            data_dir: 本地应用数据目录。
            image_dir: 用户配置的生成图目录，省略时使用 generated-images。

        Returns:
            None.
        """
        self.data_dir = Path(data_dir).expanduser().resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.roots = {"references": (self.data_dir / "reference-images").resolve()}
        self.roots["references"].mkdir(parents=True, exist_ok=True)
        self.thumbnail_dir = (self.data_dir / "gallery-thumbnails").resolve()
        self.thumbnail_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.configure_output_dir(image_dir)
        self.path = self.data_dir / "image-library.db"
        with self._connect():
            pass

    def _initialize_schema(self, db):
        db.executescript("""
                CREATE TABLE IF NOT EXISTS library_groups(
                    id TEXT PRIMARY KEY, source TEXT NOT NULL, name TEXT NOT NULL,
                    UNIQUE(source,name));
                CREATE TABLE IF NOT EXISTS library_images(
                    id TEXT PRIMARY KEY, source TEXT NOT NULL, root TEXT NOT NULL,
                    relative_path TEXT NOT NULL, filename TEXT NOT NULL, title TEXT NOT NULL,
                    prompt TEXT NOT NULL DEFAULT '', negative_prompt TEXT NOT NULL DEFAULT '',
                    style_prompt TEXT NOT NULL DEFAULT '', parameters_json TEXT NOT NULL,
                    metadata_json TEXT NOT NULL, metadata_document_json TEXT NOT NULL DEFAULT '{}', width INTEGER NOT NULL, height INTEGER NOT NULL,
                    created_at TEXT NOT NULL, mtime_ns INTEGER NOT NULL, byte_size INTEGER NOT NULL,
                    group_id TEXT REFERENCES library_groups(id) ON DELETE SET NULL,
                    trashed_at TEXT, trash_path TEXT, missing INTEGER NOT NULL DEFAULT 0);
                CREATE UNIQUE INDEX IF NOT EXISTS library_active_path
                    ON library_images(source,root,relative_path) WHERE trashed_at IS NULL;
                CREATE INDEX IF NOT EXISTS library_image_list ON library_images(source,root,trashed_at,created_at DESC);
                CREATE TABLE IF NOT EXISTS library_migrations(name TEXT PRIMARY KEY);
            """)
        columns = {row[1] for row in db.execute("PRAGMA table_info(library_images)")}
        if "metadata_document_json" not in columns:
            db.execute("ALTER TABLE library_images ADD COLUMN metadata_document_json TEXT NOT NULL DEFAULT '{}'")

    @contextmanager
    def _connect(self):
        # 桌面应用持续运行时，用户可能移走整个 data 或单独数据库。
        # 每次访问先恢复目录和建表，外部输出目录仍按原配置扫描。
        for directory in (self.data_dir, self.thumbnail_dir, *self.roots.values()):
            directory.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            self._initialize_schema(db)
            with db:
                yield db
        finally:
            db.close()

    def _root(self, source):
        if source not in self.roots:
            raise ExposableError("The gallery source must be references or outputs.", code="LIBRARY_SOURCE_INVALID")
        return self.roots[source]

    def _contained(self, root, relative_path):
        path = (root / relative_path).resolve()
        if not path.is_relative_to(root) or path == root:
            raise ExposableError("The image path is outside the configured gallery directory.", 403, "LIBRARY_PATH_INVALID")
        return path

    def _row(self, db, image_id):
        row = db.execute("SELECT * FROM library_images WHERE id=?", (image_id,)).fetchone()
        if row is None or Path(row["root"]) != self._root(row["source"]):
            raise ExposableError("The image is not in the current gallery directory.", 404, "LIBRARY_IMAGE_NOT_FOUND")
        return row

    def _record(self, row, detail=True):
        result = dict(row)
        result["parameters"] = json.loads(result.pop("parameters_json"))
        raw = result.pop("metadata_json")
        document = json.loads(result.pop("metadata_document_json"))
        if detail:
            result["metadata"] = json.loads(raw)
            if not document and result["metadata"]:
                path = self._contained(self._root(row["source"]), row["trash_path"] if row["trashed_at"] else row["relative_path"])
                if path.is_file():
                    document = _inspect_image(path)["metadata_document"]
            result["metadata_document"] = document
            result["metadata_bindings"] = metadata_bindings(document)
            result["metadata_shared_paths"] = []
            for item in result["metadata_bindings"]:
                value = result["parameters"]
                try:
                    for key in item["parameter_path"]:
                        value = value[key]
                except (KeyError, IndexError, TypeError):
                    continue
                result["metadata_shared_paths"].append(item["path"])
        result["url"] = f"/api/local/gallery/{row['id']}/file"
        result["thumbnail_url"] = f"/api/local/gallery/{row['id']}/thumbnail"
        result.pop("trash_path")
        return result

    def _check_group(self, db, group_id, source):
        if group_id and db.execute("SELECT 1 FROM library_groups WHERE id=? AND source=?", (group_id, source)).fetchone() is None:
            raise ExposableError("The selected group belongs to another gallery or no longer exists.", code="LIBRARY_GROUP_INVALID")

    def _index_file(self, db, path, source, image_id=None, overrides=None):
        root = self._root(source)
        path = self._contained(root, path.relative_to(root))
        stat = path.stat()
        if stat.st_size > MAX_IMAGE_BYTES:
            raise ExposableError("The image exceeds 30 MiB.", code="LIBRARY_IMAGE_TOO_LARGE")
        inspected = _inspect_image(path)
        relative_path = path.relative_to(root).as_posix()
        existing = db.execute("SELECT * FROM library_images WHERE source=? AND root=? AND relative_path=? AND trashed_at IS NULL", (source, str(root), relative_path)).fetchone()
        image_id = existing["id"] if existing else (image_id or uuid.uuid4().hex)
        parameters = inspected["parameters"]
        if existing and "model" not in parameters:
            saved_model = json.loads(existing["parameters_json"]).get("model")
            if saved_model:
                parameters["model"] = saved_model
        values = {
            "title": existing["title"] if existing else path.stem,
            "prompt": parameters.get("positivePrompt", ""),
            "negative_prompt": parameters.get("negativePrompt", ""),
            "style_prompt": existing["style_prompt"] if existing else "",
            "parameters": parameters,
            "group_id": existing["group_id"] if existing else None,
        }
        if overrides:
            values.update({key: value for key, value in overrides.items() if value is not None})
        parameters = normalize_image_parameters(values["parameters"])
        parameters.update({"positivePrompt": values["prompt"], "negativePrompt": values["negative_prompt"]})
        self._check_group(db, values["group_id"], source)
        (self.thumbnail_dir / f"{image_id}.png").write_bytes(inspected["thumbnail"])
        if existing:
            db.execute("""UPDATE library_images SET prompt=?,negative_prompt=?,parameters_json=?,
                metadata_json=?,metadata_document_json=?,width=?,height=?,mtime_ns=?,byte_size=?,missing=0 WHERE id=?""", (
                values["prompt"], values["negative_prompt"], json.dumps(parameters, ensure_ascii=False),
                json.dumps(inspected["metadata"], ensure_ascii=False), json.dumps(inspected["metadata_document"], ensure_ascii=False), inspected["width"], inspected["height"],
                stat.st_mtime_ns, stat.st_size, image_id,
            ))
            return self._record(self._row(db, image_id))
        db.execute("""INSERT INTO library_images
            (id,source,root,relative_path,filename,title,prompt,negative_prompt,style_prompt,
             parameters_json,metadata_json,metadata_document_json,width,height,created_at,mtime_ns,byte_size,group_id)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
            image_id, source, str(root), relative_path, path.name, values["title"],
            values["prompt"], values["negative_prompt"], values["style_prompt"],
            json.dumps(parameters, ensure_ascii=False), json.dumps(inspected["metadata"], ensure_ascii=False),
            json.dumps(inspected["metadata_document"], ensure_ascii=False), inspected["width"], inspected["height"],
            datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
            stat.st_mtime_ns, stat.st_size, values["group_id"],
        ))
        return self._record(self._row(db, image_id))

    def configure_output_dir(self, image_dir=None):
        """
        切换活动生成目录，旧目录的记录和文件继续保留但不再公开。

        Args:
            image_dir: 新的生成目录；空值使用应用默认目录。

        Returns:
            活动生成目录的绝对路径字符串。
        """
        root = Path(image_dir or self.data_dir / "generated-images").expanduser().resolve()
        reference_root = self.roots["references"]
        if (root.is_relative_to(reference_root) or reference_root.is_relative_to(root)
                or root.is_relative_to(self.thumbnail_dir) or self.thumbnail_dir.is_relative_to(root)):
            raise ExposableError("The output directory must be separate from the reference image directory.", code="LIBRARY_DIRECTORY_OVERLAP")
        root.mkdir(parents=True, exist_ok=True)
        # 设置成功前真实试写；Windows 的 os.access 不能可靠判断目录 ACL。
        with tempfile.TemporaryFile(dir=root, prefix=".novelai-write-") as probe:
            probe.write(b"NovelAI Local Web")
            probe.flush()
        with self.lock:
            self.roots["outputs"] = root
        return str(root)

    def scan(self, source="outputs"):
        """
        扫描活动目录及子目录，只重新解析新增或修改的图片。

        Args:
            source: references 或 outputs。

        Returns:
            indexed 为新增/更新数量，errors 为逐文件可见错误列表。
        """
        with self.lock, self._connect() as db:
            root = self._root(source)
            existing = {row["relative_path"]: row for row in db.execute("SELECT * FROM library_images WHERE source=? AND root=? AND trashed_at IS NULL", (source, str(root)))}
            seen, errors, indexed = set(), [], 0
            def directory_error(error):
                errors.append({"filename": str(error.filename), "error": str(error)})
            for directory, folders, filenames in os.walk(root, followlinks=False, onerror=directory_error):
                folders[:] = [name for name in folders if name != ".novelai-library" and not (Path(directory) / name).is_symlink()]
                for filename in filenames:
                    if Path(filename).suffix.lower() not in IMAGE_SUFFIXES:
                        continue
                    path = Path(directory) / filename
                    relative = path.relative_to(root).as_posix()
                    seen.add(relative)
                    try:
                        path = self._contained(root, relative)
                        stat = path.stat()
                        old = existing.get(relative)
                        if old and old["mtime_ns"] == stat.st_mtime_ns and old["byte_size"] == stat.st_size:
                            db.execute("UPDATE library_images SET missing=0 WHERE id=?", (old["id"],))
                            continue
                        self._index_file(db, path, source)
                        indexed += 1
                    except (OSError, ValueError, ExposableError) as exc:
                        errors.append({"filename": relative, "error": str(exc)})
            # 目录无法完整读取时不能把未看到的文件误判为已丢失。
            if not errors:
                for relative, row in existing.items():
                    if relative not in seen:
                        db.execute("UPDATE library_images SET missing=1 WHERE id=?", (row["id"],))
            return {"indexed": indexed, "errors": errors}

    def list_images(self, source=None, page=1, page_size=60, group_id=None, query="", trashed=False):
        """
        分页读取当前目录索引，不在每次列表请求中重新扫描磁盘。

        Args:
            source: 图片来源，None 同时读取两个来源。
            page: 从 1 开始的页码。
            page_size: 每页数量，最多 200。
            group_id: 可选分组 ID。
            query: 文件名、标题、提示词或画风检索词。
            trashed: 是否读取回收站。

        Returns:
            items、total、page 和 page_size。
        """
        if not isinstance(page, int) or page < 1 or not isinstance(page_size, int) or not 1 <= page_size <= 200:
            raise ExposableError("The gallery page or page size is invalid.", code="LIBRARY_PAGE_INVALID")
        sources = [source] if source else ["references", "outputs"]
        with self.lock, self._connect() as db:
            clauses, args = [], []
            for item in sources:
                clauses.append("(source=? AND root=?)")
                args.extend((item, str(self._root(item))))
            where = f"({' OR '.join(clauses)}) AND missing=0 AND trashed_at IS {'NOT ' if trashed else ''}NULL"
            if group_id == "__ungrouped":
                where += " AND group_id IS NULL"
            elif group_id:
                where += " AND group_id=?"
                args.append(group_id)
            if query:
                where += " AND (title LIKE ? OR filename LIKE ? OR prompt LIKE ? OR style_prompt LIKE ?)"
                args.extend([f"%{query}%"] * 4)
            total = db.execute(f"SELECT COUNT(*) FROM library_images WHERE {where}", args).fetchone()[0]
            rows = db.execute(f"SELECT * FROM library_images WHERE {where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", [*args, page_size, (page - 1) * page_size])
            return {"items": [self._record(row, detail=False) for row in rows], "total": total, "page": page, "page_size": page_size}

    def get_image(self, image_id):
        """
        读取一张当前图库图片的详细信息和原始元数据。

        Args:
            image_id: 图片 ID。

        Returns:
            图片详情字典。
        """
        with self.lock, self._connect() as db:
            return self._record(self._row(db, image_id))

    def image_path(self, image_id, thumbnail=False):
        """
        返回受目录边界保护的原图或缩略图路径。

        Args:
            image_id: 图片 ID。
            thumbnail: 是否请求缩略图。

        Returns:
            可交给 send_file 的绝对 Path。
        """
        with self.lock, self._connect() as db:
            row = self._row(db, image_id)
            original = self._contained(self._root(row["source"]), row["trash_path"] if row["trashed_at"] else row["relative_path"])
            if not original.is_file():
                raise ExposableError("The image file is missing from its gallery directory.", 404, "LIBRARY_FILE_MISSING")
            if thumbnail:
                path = self._contained(self.thumbnail_dir, f"{image_id}.png")
                if not path.exists():
                    path.write_bytes(_inspect_image(original)["thumbnail"])
                return path
            return original

    def import_image(self, image_bytes, filename, source="references", title="", prompt=None,
                     negative_prompt=None, style_prompt="", parameters=None, group_id=None, image_id=None):
        """
        导入图片为独立本地文件，并保留原始文件字节和元数据。

        Args:
            image_bytes: 完整图片二进制。
            filename: 原始文件名，仅用于安全文件名和显示标题。
            source: references 或 outputs。
            title: 可选标题。
            prompt: 可选正面提示词；None 从图像读取。
            negative_prompt: 可选负面提示词；None 从图像读取。
            style_prompt: 用户选中的画风片段。
            parameters: 可选 UI 参数。
            group_id: 可选同来源分组。
            image_id: 迁移时可指定稳定 ID；已存在时保留已有记录。

        Returns:
            新增或已存在的图片详情。
        """
        with self.lock, self._connect() as db:
            root = self._root(source)
            if image_id:
                existing = db.execute("SELECT * FROM library_images WHERE id=?", (image_id,)).fetchone()
                if existing:
                    return self._record(self._row(db, image_id))
                if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", image_id):
                    raise ExposableError("The imported image ID is invalid.", code="LIBRARY_IMAGE_ID_INVALID")
            image_id = image_id or uuid.uuid4().hex
            for value in (title, prompt, negative_prompt, style_prompt):
                if value is not None and (not isinstance(value, str) or len(value) > 100_000):
                    raise ExposableError("The image text fields are invalid.", code="LIBRARY_EDIT_INVALID")
            if parameters is not None and not isinstance(parameters, dict):
                raise ExposableError("The image parameters must be a JSON object.", code="LIBRARY_EDIT_INVALID")
            if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
                raise ExposableError("The image must contain at most 30 MiB.", code="LIBRARY_IMAGE_TOO_LARGE")
            inspected = _inspect_image(io.BytesIO(image_bytes))
            self._check_group(db, group_id, source)
            original_name = str(filename or "image").replace("\\", "/").split("/")[-1]
            stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", Path(original_name).stem).strip(" .")[:100] or "image"
            path = self._contained(root, f"{stem}-{image_id}{FORMAT_SUFFIXES[inspected['format']]}")
            # 稳定 ID 导入可能在文件已写入、索引未提交时中断；仅内容一致才补建索引。
            if path.exists():
                if path.read_bytes() != image_bytes:
                    raise ExposableError("The import filename is occupied by a different image.", 409, "LIBRARY_IMPORT_CONFLICT")
                indexed = db.execute("SELECT * FROM library_images WHERE source=? AND root=? AND relative_path=? AND trashed_at IS NULL",
                                     (source, str(root), path.relative_to(root).as_posix())).fetchone()
                if indexed:
                    return self._record(indexed)
            else:
                with path.open("xb") as output:
                    output.write(image_bytes)
            overrides = {"title": title or stem, "prompt": prompt, "negative_prompt": negative_prompt,
                         "style_prompt": style_prompt, "parameters": parameters, "group_id": group_id}
            if parameters is not None:
                normalized = normalize_image_parameters(parameters)
                if prompt is None:
                    overrides["prompt"] = normalized.get("positivePrompt", inspected["parameters"].get("positivePrompt", ""))
                if negative_prompt is None:
                    overrides["negative_prompt"] = normalized.get("negativePrompt", inspected["parameters"].get("negativePrompt", ""))
            return self._index_file(db, path, source, image_id=image_id, overrides=overrides)

    def save_generated(self, image_bytes, filename=None, metadata=None):
        """
        把生成结果直接保存到当前输出目录并建立索引。

        Args:
            image_bytes: 官方返回的完整图像。
            filename: 可选文件名。
            metadata: 生成参数，用于官方图片没有内嵌参数时补充索引。

        Returns:
            已保存的图片详情。
        """
        inspected = _inspect_image(io.BytesIO(image_bytes))
        parameters = normalize_image_parameters(metadata)
        parameters.update(inspected["parameters"])
        # 官方原图已有生成参数时保留完整字节；工具返回的无参数图片补写可导入的 PNG 文本。
        embedded_keys = set(inspected["parameters"]) - {"width", "height"}
        if metadata and not embedded_keys:
            with Image.open(io.BytesIO(image_bytes)) as original:
                pnginfo = PngImagePlugin.PngInfo()
                for key, value in original.info.items():
                    if isinstance(value, str):
                        pnginfo.add_itxt(key, value)
                comment = dict(parameters)
                comment["prompt"] = parameters.get("positivePrompt", "")
                comment["uc"] = parameters.get("negativePrompt", "")
                pnginfo.add_itxt("Comment", json.dumps(comment, ensure_ascii=False))
                pnginfo.add_itxt("Description", str(comment["prompt"]))
                output = io.BytesIO()
                original.save(output, "PNG", pnginfo=pnginfo)
                image_bytes = output.getvalue()
        return self.import_image(image_bytes, filename or "generation.png", source="outputs", parameters=parameters)

    def update_image(self, image_id, changes):
        """
        修改图库中的描述、画风、参数或虚拟分组，不改动原始文件。

        Args:
            image_id: 图片 ID。
            changes: title、prompt、negative_prompt、style_prompt、parameters、group_id 的子集。

        Returns:
            更新后的详情。
        """
        allowed = {"title", "prompt", "negative_prompt", "style_prompt", "parameters", "group_id"}
        if not isinstance(changes, dict) or set(changes) - allowed:
            raise ExposableError("The image edit contains unsupported fields.", code="LIBRARY_EDIT_INVALID")
        with self.lock, self._connect() as db:
            row = self._row(db, image_id)
            values = self._record(row)
            values.update(changes)
            for field in ("title", "prompt", "negative_prompt", "style_prompt"):
                if not isinstance(values[field], str) or len(values[field]) > 100_000:
                    raise ExposableError("The image text fields are invalid.", code="LIBRARY_EDIT_INVALID")
            if not isinstance(values["parameters"], dict):
                raise ExposableError("The image parameters must be a JSON object.", code="LIBRARY_EDIT_INVALID")
            self._check_group(db, values["group_id"], row["source"])
            parameters = normalize_image_parameters(values["parameters"])
            if "parameters" in changes:
                if "prompt" not in changes and "positivePrompt" in parameters:
                    values["prompt"] = parameters["positivePrompt"]
                if "negative_prompt" not in changes and "negativePrompt" in parameters:
                    values["negative_prompt"] = parameters["negativePrompt"]
            parameters.update({"positivePrompt": values["prompt"], "negativePrompt": values["negative_prompt"]})
            db.execute("UPDATE library_images SET title=?,prompt=?,negative_prompt=?,style_prompt=?,parameters_json=?,group_id=? WHERE id=?", (
                values["title"], values["prompt"], values["negative_prompt"], values["style_prompt"],
                json.dumps(parameters, ensure_ascii=False), values["group_id"], image_id,
            ))
            return self._record(self._row(db, image_id))

    def save_metadata_copy(self, image_id, parameters=None, clear=False, metadata_document=None):
        """
        改写或清除多载体元数据后另存 PNG，原始文件保持不变。

        Args:
            image_id: 来源图片 ID。
            parameters: 仅本次修改的 UI 或官方参数；只编辑文档时可省略。
            clear: 清除文本、EXIF 与 NovelAI alpha 隐写信息。
            metadata_document: 用户编辑后的完整元数据树；删除字段不从旧索引补回。

        Returns:
            另存 PNG 的详情。
        """
        if parameters is not None and not isinstance(parameters, dict):
            raise ExposableError("The image parameters must be a JSON object.", code="LIBRARY_EDIT_INVALID")
        if metadata_document is not None and not isinstance(metadata_document, dict):
            raise ExposableError("The metadata document must be a JSON object.", code="LIBRARY_EDIT_INVALID")
        with self.lock:
            record = self.get_image(image_id)
            with Image.open(self.image_path(image_id)) as original:
                pixels = ImageOps.exif_transpose(original)
                if clear:
                    document = {}
                else:
                    overrides = parameters if parameters is not None else ({} if metadata_document is not None else record["parameters"])
                    # 未知参数留在原 Comment，已知别名统一使用同一语义值写回全部载体。
                    changes = {**overrides, **normalize_image_parameters(overrides)}
                    for canonical, aliases in (("positivePrompt", ("prompt", "input", "Description")), ("negativePrompt", ("uc", "negative_prompt")), ("guidanceScale", ("scale",)), ("noiseSchedule", ("noise_schedule",)), ("promptGuidanceRescale", ("cfg_rescale",)), ("smea", ("sm",)), ("dyn", ("sm_dyn",)), ("model", ("model_name",))):
                        if canonical in changes:
                            for alias in aliases:
                                changes.pop(alias, None)
                    document = edit_metadata_document(record["metadata_document"], metadata_document, changes,
                                                      pixels_changed=original.getexif().get(274, 1) != 1 or "stealth_rgb" in record["metadata_document"])
                encoded = write_metadata_png(pixels, document, clear_rgb="stealth_rgb" in record["metadata_document"])
            suffix = "clean" if clear else "edited"
            return self.import_image(encoded, f"{Path(record['filename']).stem}-{suffix}.png", source="outputs")

    def trash_image(self, image_id):
        """
        将图片移入同一图库根目录的专用回收站，不永久删除文件。

        Args:
            image_id: 图片 ID。

        Returns:
            回收站中的图片详情。
        """
        with self.lock, self._connect() as db:
            row = self._row(db, image_id)
            if row["trashed_at"]:
                return self._record(row)
            root = self._root(row["source"])
            source = self._contained(root, row["relative_path"])
            destination = self._contained(root, f".novelai-library/trash/{image_id}{source.suffix}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                raise ExposableError("The recycle destination already exists; no file was replaced.", 409, "LIBRARY_TRASH_CONFLICT")
            source.rename(destination)
            try:
                db.execute("UPDATE library_images SET trashed_at=?,trash_path=? WHERE id=?", (
                    datetime.now(timezone.utc).isoformat(), destination.relative_to(root).as_posix(), image_id,
                ))
            except sqlite3.Error:
                destination.rename(source)
                raise
            return self._record(self._row(db, image_id))

    def restore_image(self, image_id):
        """
        从回收站恢复原位置，原位置被占用时明确报错且不覆盖。

        Args:
            image_id: 图片 ID。

        Returns:
            恢复后的图片详情。
        """
        with self.lock, self._connect() as db:
            row = self._row(db, image_id)
            if not row["trashed_at"]:
                return self._record(row)
            root = self._root(row["source"])
            source = self._contained(root, row["trash_path"])
            destination = self._contained(root, row["relative_path"])
            if destination.exists():
                raise ExposableError("The original filename is occupied; no file was replaced.", 409, "LIBRARY_RESTORE_CONFLICT")
            destination.parent.mkdir(parents=True, exist_ok=True)
            source.rename(destination)
            try:
                db.execute("UPDATE library_images SET trashed_at=NULL,trash_path=NULL,missing=0 WHERE id=?", (image_id,))
            except sqlite3.Error:
                destination.rename(source)
                raise
            return self._record(self._row(db, image_id))

    def list_groups(self, source="references"):
        """
        读取指定来源的分组及当前目录中未回收的图片数。

        Args:
            source: references 或 outputs。

        Returns:
            包含 id、name、source、count 的分组列表。
        """
        with self.lock, self._connect() as db:
            root = self._root(source)
            return [dict(row) for row in db.execute("""SELECT g.id,g.name,g.source,COUNT(i.id) AS count
                FROM library_groups g LEFT JOIN library_images i ON i.group_id=g.id
                AND i.root=? AND i.trashed_at IS NULL AND i.missing=0
                WHERE g.source=? GROUP BY g.id ORDER BY g.name""", (str(root), source))]

    def create_group(self, name, source="references", group_id=None):
        """
        新增虚拟分组，不移动图片文件。

        Args:
            name: 非空分组名，最多 200 字符。
            source: 分组来源。
            group_id: 迁移时可指定稳定 ID。

        Returns:
            分组字典；已有相同迁移 ID 时返回原组。
        """
        self._root(source)
        if not isinstance(name, str) or not name.strip() or len(name) > 200:
            raise ExposableError("The group name must contain 1 to 200 characters.", code="LIBRARY_GROUP_INVALID")
        with self.lock, self._connect() as db:
            if group_id:
                existing = db.execute("SELECT * FROM library_groups WHERE id=?", (group_id,)).fetchone()
                if existing:
                    return dict(existing)
            group_id = group_id or uuid.uuid4().hex
            try:
                db.execute("INSERT INTO library_groups VALUES(?,?,?)", (group_id, source, name.strip()))
            except sqlite3.IntegrityError as exc:
                raise ExposableError("A group with this name already exists.", 409, "LIBRARY_GROUP_EXISTS") from exc
            return {"id": group_id, "source": source, "name": name.strip(), "count": 0}

    def update_group(self, group_id, name):
        """
        修改分组名称。

        Args:
            group_id: 分组 ID。
            name: 新分组名。

        Returns:
            修改后的分组字典。
        """
        if not isinstance(name, str) or not name.strip() or len(name) > 200:
            raise ExposableError("The group name must contain 1 to 200 characters.", code="LIBRARY_GROUP_INVALID")
        with self.lock, self._connect() as db:
            try:
                cursor = db.execute("UPDATE library_groups SET name=? WHERE id=?", (name.strip(), group_id))
            except sqlite3.IntegrityError as exc:
                raise ExposableError("A group with this name already exists.", 409, "LIBRARY_GROUP_EXISTS") from exc
            if not cursor.rowcount:
                raise ExposableError("The gallery group was not found.", 404, "LIBRARY_GROUP_NOT_FOUND")
            return dict(db.execute("SELECT * FROM library_groups WHERE id=?", (group_id,)).fetchone())

    def delete_group(self, group_id):
        """
        删除虚拟分组，图片和文件保留并变为未分组。

        Args:
            group_id: 分组 ID。

        Returns:
            是否删除了分组。
        """
        with self.lock, self._connect() as db:
            return db.execute("DELETE FROM library_groups WHERE id=?", (group_id,)).rowcount == 1

    def has_migration(self, name):
        """
        检查旧库是否已经完整导入。

        Args:
            name: 固定迁移名称。

        Returns:
            是否存在完成标记。
        """
        with self.lock, self._connect() as db:
            return db.execute("SELECT 1 FROM library_migrations WHERE name=?", (name,)).fetchone() is not None

    def mark_migration(self, name):
        """
        标记旧库导入完成，调用方须先成功导入全部记录。

        Args:
            name: 固定迁移名称。

        Returns:
            None.
        """
        with self.lock, self._connect() as db:
            db.execute("INSERT OR IGNORE INTO library_migrations VALUES(?)", (name,))
