"""用不可变参数提交和内容寻址图片保存本地作品的分支历史。"""

from __future__ import annotations

import hashlib
import io
import json
import math
import os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .custom_errors import ExposableError


SNAPSHOT_FIELDS = set("""
positivePrompt negativePrompt prompt input uc negative_prompt width height steps guidanceScale
scale seed model sampler noiseSchedule noise_schedule promptGuidanceRescale cfg_rescale smea
dyn sm sm_dyn autoSmea strength noise upscaled_enhance image_tool upscale_amount
local_upscale_model local_upscale_factor characterTabs characterPrompts characterControl
v4_prompt v4_negative_prompt v4_prompt_char_captions v4_negative_prompt_char_captions
use_coords use_order ucPresetId qualityPresetId variety decrisp legacy legacy_uc legacy_v3_extend
prefer_brownian deliberate_euler_ancestral_bug image mask action inpaint_strength
disabled_original_image color_correct req_type defry imageToImage vibeTransfer
reference_image reference_strength reference_information_extracted reference_image_multiple
reference_strength_multiple reference_information_extracted_multiple use_v4_vibe
director_reference_images_cached director_reference_images director_reference_descriptions
director_reference_strength_values director_reference_secondary_strength_values
director_reference_information_extracted tag_hint_transparent_background use_upscale_credits source_width source_height
editor_state
""".split())


def validate_version_editor(editor):
    """
    校验只保存在本机的版本编辑态，在收费生成前拒绝不可恢复的数据结构。

    Args:
        editor: 完整编辑态，或早期只包含 characterTabs 的编辑态。

    Returns:
        统一为 parameterState 与 vibeImages 等字段的编辑态字典。
    """
    invalid = ExposableError("The version editor data is invalid.", code="VERSION_EDITOR_INVALID")
    if not isinstance(editor, dict):
        raise invalid
    if set(editor) == {"characterTabs"}:
        editor = {"parameterState": {"characterTabs": editor["characterTabs"]}}
    if set(editor) - {"parameterState", "vibeImages", "positivePrompt", "negativePrompt"}:
        raise invalid
    state = editor.get("parameterState")
    if not isinstance(state, dict) or set(state) - {"params", "characterTabs", "referenceImages", "imagePreview", "editedImageData", "directorToolParams", "restoredMask"}:
        raise invalid
    for items in (state.get("characterTabs", []), state.get("referenceImages", []), editor.get("vibeImages", [])):
        if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
            raise invalid
    if not isinstance(state.get("params", {}), dict):
        raise invalid
    for key in ("directorToolParams", "restoredMask"):
        if state.get(key) is not None and not isinstance(state[key], dict):
            raise invalid
    for key in ("imagePreview", "editedImageData"):
        if state.get(key) is not None and not isinstance(state[key], str):
            raise invalid
    for key in ("positivePrompt", "negativePrompt"):
        if key in editor and not isinstance(editor[key], str):
            raise invalid
    return editor


def safe_version_parameters(parameters):
    """
    保留绘画参数与可恢复输入，移除会话凭据和临时请求字段。

    Args:
        parameters: 工作台参数或已经保存的版本参数。

    Returns:
        可持久保存的独立参数字典。
    """
    if not isinstance(parameters, dict):
        raise ExposableError("Version parameters must be an object.", code="VERSION_PARAMETERS_INVALID")
    if "editor_state" in parameters:
        parameters = {**parameters, "editor_state": validate_version_editor(parameters["editor_state"])}

    def clean(value):
        if isinstance(value, dict):
            return {key: clean(item) for key, item in value.items()
                    if not re.search(r"token|secret|password|authorization|cookie|api.?key|access.?key", key, re.I)}
        if isinstance(value, list):
            return [clean(item) for item in value]
        return value

    return clean({key: value for key, value in parameters.items() if key in SNAPSHOT_FIELDS})


def initialize_version_schema(db):
    """
    为现有图库数据库添加作品、不可变提交与共享图片快照表。

    Args:
        db: 已开启外键约束的 SQLite 连接。

    Returns:
        None.
    """
    db.executescript("""
        CREATE TABLE IF NOT EXISTS works(
            id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS work_versions(
            id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id),
            parent_id TEXT REFERENCES work_versions(id), number INTEGER NOT NULL,
            message TEXT NOT NULL, operation TEXT NOT NULL, created_at TEXT NOT NULL,
            parameters_json TEXT NOT NULL, UNIQUE(work_id,number));
        CREATE INDEX IF NOT EXISTS work_versions_work ON work_versions(work_id,number);
        CREATE TABLE IF NOT EXISTS version_assets(
            id TEXT PRIMARY KEY, suffix TEXT NOT NULL, byte_size INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS version_images(
            version_id TEXT NOT NULL REFERENCES work_versions(id), position INTEGER NOT NULL,
            image_id TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES version_assets(id),
            image_json TEXT NOT NULL, PRIMARY KEY(version_id,position));
        CREATE INDEX IF NOT EXISTS version_images_original ON version_images(image_id);
        CREATE TABLE IF NOT EXISTS work_blueprints(
            work_id TEXT PRIMARY KEY REFERENCES works(id), blueprint_json TEXT NOT NULL);
    """)


class ImageVersionStore:
    """复用图库锁和数据库，为作品保存分支版本及独立图片快照。"""

    def __init__(self, library):
        """
        绑定本地图库，不另外启动服务或创建数据库。

        Args:
            library: LocalImageLibrary 实例。

        Returns:
            None.
        """
        self.library = library
        self.asset_dir = library.data_dir / "version-assets"

    def _work(self, db, work_id):
        row = db.execute("SELECT * FROM works WHERE id=?", (work_id,)).fetchone()
        if row is None:
            raise ExposableError("The work does not exist.", 404, "WORK_NOT_FOUND")
        result = dict(row)
        latest = db.execute("SELECT id,number FROM work_versions WHERE work_id=? ORDER BY number DESC LIMIT 1", (work_id,)).fetchone()
        result.update(version_count=latest["number"] if latest else 0,
                      latest_version_id=latest["id"] if latest else None)
        cover = db.execute("""SELECT vi.asset_id FROM version_images vi JOIN work_versions v ON v.id=vi.version_id
            WHERE v.work_id=? ORDER BY v.number DESC,vi.position LIMIT 1""", (work_id,)).fetchone()
        result["thumbnail_url"] = f"/api/local/versions/assets/{cover['asset_id']}/thumbnail" if cover else None
        return result

    def _parent(self, db, work_id, parent_id):
        if not isinstance(parent_id, str) or not parent_id:
            raise ExposableError("Choose a parent version.", code="VERSION_PARENT_REQUIRED")
        row = db.execute("SELECT * FROM work_versions WHERE id=? AND work_id=?", (parent_id, work_id)).fetchone()
        if row is None:
            raise ExposableError("The parent version does not belong to this work.", 400, "VERSION_PARENT_INVALID")
        return row

    def _version(self, db, row):
        result = dict(row)
        result["parameters"] = json.loads(result.pop("parameters_json"))
        result["images"] = []
        for link in db.execute("SELECT * FROM version_images WHERE version_id=? ORDER BY position", (row["id"],)):
            item = json.loads(link["image_json"])
            current = db.execute("SELECT * FROM library_images WHERE id=?", (link["image_id"],)).fetchone()
            available = bool(current and not current["trashed_at"] and not current["missing"]
                             and Path(current["root"]) == self.library._root(current["source"]))
            if available:
                available = self.library._contained(Path(current["root"]), current["relative_path"]).is_file()
            # 历史始终展示快照；原图库是否还可使用是另一项明确状态。
            asset = db.execute("SELECT suffix FROM version_assets WHERE id=?", (link["asset_id"],)).fetchone()
            snapshot_available = bool(asset and (self.asset_dir / f"{link['asset_id']}{asset['suffix']}").is_file())
            item.update(asset_id=link["asset_id"], available=snapshot_available, gallery_available=available,
                        url=f"/api/local/versions/assets/{link['asset_id']}",
                        thumbnail_url=f"/api/local/versions/assets/{link['asset_id']}/thumbnail")
            result["images"].append(item)
        return result

    def _snapshot_image(self, db, row, content, inspected):
        digest = hashlib.sha256(content).hexdigest()
        self.asset_dir.mkdir(parents=True, exist_ok=True)
        suffix = Path(row["relative_path"]).suffix.lower()
        target = self.asset_dir / f"{digest}{suffix}"
        existing = db.execute("SELECT suffix FROM version_assets WHERE id=?", (digest,)).fetchone()
        if existing:
            target = self.asset_dir / f"{digest}{existing['suffix']}"
        if not target.exists():
            # 同目录原子替换避免中断后留下看似完整的内容寻址快照。
            with tempfile.NamedTemporaryFile(dir=self.asset_dir, prefix=".snapshot-", delete=False) as output:
                temporary = Path(output.name)
                output.write(content)
            try:
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
        thumbnail = self.asset_dir / f"{digest}.thumb.png"
        if not thumbnail.exists():
            thumbnail.write_bytes(inspected["thumbnail"])
        db.execute("INSERT OR IGNORE INTO version_assets(id,suffix,byte_size) VALUES(?,?,?)", (digest, suffix, len(content)))
        summary = {key: row[key] for key in ("id", "source", "filename", "title", "width", "height", "created_at")}
        summary.update(width=inspected["width"], height=inspected["height"])
        return digest, json.dumps(summary, ensure_ascii=False)

    def _commit(self, db, work_id, body, parent=None):
        operation = body.get("operation", "commit")
        message = body.get("message", "")
        if not isinstance(operation, str) or not operation or len(operation) > 50:
            raise ExposableError("The version operation is invalid.", code="VERSION_OPERATION_INVALID")
        if not isinstance(message, str) or len(message) > 2000:
            raise ExposableError("The version message is too long.", code="VERSION_MESSAGE_INVALID")
        image_ids = body.get("image_ids", [])
        if not isinstance(image_ids, list) or len(image_ids) > 30 or any(not isinstance(item, str) for item in image_ids):
            raise ExposableError("Choose at most 30 gallery images.", code="VERSION_IMAGES_INVALID")
        image_ids = list(dict.fromkeys(image_ids))
        restored = None
        if operation == "restore":
            restored = self._parent(db, work_id, body.get("restore_version_id") or (parent["id"] if parent else None))
        if restored:
            parameters = json.loads(restored["parameters_json"])
        elif "parameters" in body:
            parameters = body["parameters"]
        elif parent:
            parameters = json.loads(parent["parameters_json"])
        elif image_ids:
            parameters = json.loads(self.library._row(db, image_ids[0])["parameters_json"])
        else:
            parameters = {}
        parameters = safe_version_parameters(parameters)
        from .local_image_library import _inspect_image, normalize_image_parameters
        parameters.update(normalize_image_parameters(parameters))
        prepared_images = []
        if not restored:
            # 整批引用和图片内容都通过检查后才落盘，避免后一张无效时留下前面的孤立快照。
            for image_id in image_ids:
                image_row = self.library._row(db, image_id)
                if image_row["trashed_at"] or image_row["missing"]:
                    raise ExposableError("This image is not available in the active gallery.", 409, "VERSION_IMAGE_UNAVAILABLE")
                path = self.library._contained(self.library._root(image_row["source"]), image_row["relative_path"])
                if path.stat().st_size > 30 * 1024 * 1024:
                    raise ExposableError("The image exceeds 30 MiB.", code="LIBRARY_IMAGE_TOO_LARGE")
                content = path.read_bytes()
                prepared_images.append((image_row, content, _inspect_image(io.BytesIO(content))))
        version_id, now = uuid.uuid4().hex, datetime.now(timezone.utc).isoformat()
        number = db.execute("SELECT COALESCE(MAX(number),0)+1 FROM work_versions WHERE work_id=?", (work_id,)).fetchone()[0]
        db.execute("""INSERT INTO work_versions(id,work_id,parent_id,number,message,operation,created_at,parameters_json)
            VALUES(?,?,?,?,?,?,?,?)""", (version_id, work_id, parent["id"] if parent else None, number,
                                       message, operation, now, json.dumps(parameters, ensure_ascii=False, allow_nan=False)))
        if restored:
            db.execute("""INSERT INTO version_images(version_id,position,image_id,asset_id,image_json)
                SELECT ?,position,image_id,asset_id,image_json FROM version_images WHERE version_id=?""", (version_id, restored["id"]))
        else:
            for index, (image_row, content, inspected) in enumerate(prepared_images):
                asset_id, summary = self._snapshot_image(db, image_row, content, inspected)
                db.execute("INSERT INTO version_images VALUES(?,?,?,?,?)", (version_id, index, image_row["id"], asset_id, summary))
        db.execute("UPDATE works SET updated_at=? WHERE id=?", (now, work_id))
        row = db.execute("SELECT * FROM work_versions WHERE id=?", (version_id,)).fetchone()
        return {"work": self._work(db, work_id), "version": self._version(db, row)}

    def list_works(self):
        """
        按最近提交时间读取作品摘要。

        Returns:
            作品摘要列表。
        """
        with self.library.lock, self.library._connect() as db:
            return [self._work(db, row["id"]) for row in db.execute("SELECT id FROM works ORDER BY updated_at DESC,id DESC")]

    def create_work(self, body):
        """
        创建作品及首个版本，支持只有提示词而没有图片。

        Args:
            body: title、image_ids、parameters 与可选提交说明。

        Returns:
            work 与 version。
        """
        title = body.get("title", "")
        if not isinstance(title, str) or not title.strip() or len(title) > 200:
            raise ExposableError("Enter a work title of at most 200 characters.", code="WORK_TITLE_INVALID")
        with self.library.lock, self.library._connect() as db:
            work_id, now = uuid.uuid4().hex, datetime.now(timezone.utc).isoformat()
            db.execute("INSERT INTO works VALUES(?,?,?,?)", (work_id, title.strip(), now, now))
            return self._commit(db, work_id, body)

    def get_work(self, work_id):
        """
        读取作品与全部分支提交，版本按创建编号排序。

        Args:
            work_id: 作品 ID。

        Returns:
            work、versions 与独立保存的可编辑 blueprint。
        """
        with self.library.lock, self.library._connect() as db:
            work = self._work(db, work_id)
            versions = [self._version(db, row) for row in db.execute("SELECT * FROM work_versions WHERE work_id=? ORDER BY number", (work_id,))]
            saved = db.execute("SELECT blueprint_json FROM work_blueprints WHERE work_id=?", (work_id,)).fetchone()
            blueprint = json.loads(saved["blueprint_json"]) if saved else {
                "positions": {}, "edge_notes": {}, "hidden_node_ids": [], "groups": [],
            }
            return {"work": work, "versions": versions, "blueprint": blueprint}

    def save_blueprint(self, work_id, blueprint):
        """
        保存作品画布的位置、连线备注、隐藏节点和分组，不改写版本历史。

        Args:
            work_id: 作品 ID。
            blueprint: 包含 positions、edge_notes、hidden_node_ids、groups 的完整画布状态。

        Returns:
            已保存的画布状态。
        """
        if not isinstance(blueprint, dict) or set(blueprint) != {"positions", "edge_notes", "hidden_node_ids", "groups"}:
            raise ExposableError("The blueprint structure is invalid.", code="BLUEPRINT_INVALID")
        positions, notes = blueprint["positions"], blueprint["edge_notes"]
        hidden, groups = blueprint["hidden_node_ids"], blueprint["groups"]
        if not isinstance(positions, dict) or not isinstance(notes, dict) or not isinstance(hidden, list) or not isinstance(groups, list):
            raise ExposableError("The blueprint fields are invalid.", code="BLUEPRINT_INVALID")
        with self.library.lock, self.library._connect() as db:
            self._work(db, work_id)
            nodes = {row["id"]: row["parent_id"] for row in db.execute("SELECT id,parent_id FROM work_versions WHERE work_id=?", (work_id,))}
            for node_id, position in positions.items():
                if node_id not in nodes:
                    raise ExposableError("Blueprint nodes must belong to this work.", code="BLUEPRINT_NODE_INVALID")
                if (not isinstance(position, dict) or set(position) != {"x", "y"}
                        or any(type(value) not in (int, float) or not math.isfinite(value) for value in position.values())):
                    raise ExposableError("Node positions must contain finite coordinates.", code="BLUEPRINT_POSITION_INVALID")
            for node_id, note in notes.items():
                if node_id not in nodes or nodes[node_id] is None:
                    raise ExposableError("An edge note must refer to a child version in this work.", code="BLUEPRINT_EDGE_INVALID")
                if not isinstance(note, str) or len(note) > 2000:
                    raise ExposableError("An edge note must contain at most 2000 characters.", code="BLUEPRINT_NOTE_INVALID")
            if any(not isinstance(node_id, str) or node_id not in nodes for node_id in hidden) or len(set(hidden)) != len(hidden):
                raise ExposableError("Hidden nodes must be unique versions in this work.", code="BLUEPRINT_NODE_INVALID")
            group_ids, grouped_nodes = set(), set()
            for group in groups:
                if not isinstance(group, dict) or set(group) != {"id", "title", "node_ids", "collapsed"}:
                    raise ExposableError("The blueprint group structure is invalid.", code="BLUEPRINT_GROUP_INVALID")
                group_id, title, node_ids = group["id"], group["title"], group["node_ids"]
                if not isinstance(group_id, str) or not group_id or len(group_id) > 80 or group_id in group_ids:
                    raise ExposableError("Blueprint group IDs must be unique and contain at most 80 characters.", code="BLUEPRINT_GROUP_INVALID")
                if not isinstance(title, str) or not title.strip() or len(title) > 120 or type(group["collapsed"]) is not bool:
                    raise ExposableError("A group needs a title of at most 120 characters and a collapsed flag.", code="BLUEPRINT_GROUP_INVALID")
                if (not isinstance(node_ids, list) or any(not isinstance(node_id, str) or node_id not in nodes for node_id in node_ids)
                        or len(set(node_ids)) != len(node_ids) or grouped_nodes.intersection(node_ids)):
                    raise ExposableError("Each version may belong to only one blueprint group in this work.", code="BLUEPRINT_GROUP_NODES_INVALID")
                group_ids.add(group_id)
                grouped_nodes.update(node_ids)
            # 画布可以反复编辑；版本表和参数快照只由提交接口追加。
            db.execute("""INSERT INTO work_blueprints(work_id,blueprint_json) VALUES(?,?)
                ON CONFLICT(work_id) DO UPDATE SET blueprint_json=excluded.blueprint_json""",
                       (work_id, json.dumps(blueprint, ensure_ascii=False, allow_nan=False)))
            return blueprint

    def create_version(self, work_id, body):
        """
        从指定父版本追加提交，恢复也只追加记录而不覆盖历史。

        Args:
            work_id: 作品 ID。
            body: parent_id、parameters、image_ids、message、operation，恢复时可指定 restore_version_id。

        Returns:
            work 与 version。
        """
        with self.library.lock, self.library._connect() as db:
            self._work(db, work_id)
            parent = self._parent(db, work_id, body.get("parent_id"))
            return self._commit(db, work_id, body, parent)

    def get_version(self, work_id, version_id):
        """
        读取指定作品的单个完整版本，用于恢复大体积图像输入。

        Args:
            work_id: 作品 ID。
            version_id: 属于该作品的版本 ID。

        Returns:
            work 与 version，不依赖浏览器本地存储传递图片数据。
        """
        with self.library.lock, self.library._connect() as db:
            work = self._work(db, work_id)
            row = self._parent(db, work_id, version_id)
            return {"work": work, "version": self._version(db, row)}

    def rename_work(self, work_id, title):
        """
        修改作品标题，保持所有历史参数与提交说明不变。

        Args:
            work_id: 作品 ID。
            title: 新标题。

        Returns:
            作品摘要。
        """
        if not isinstance(title, str) or not title.strip() or len(title) > 200:
            raise ExposableError("Enter a work title of at most 200 characters.", code="WORK_TITLE_INVALID")
        with self.library.lock, self.library._connect() as db:
            self._work(db, work_id)
            db.execute("UPDATE works SET title=? WHERE id=?", (title.strip(), work_id))
            return self._work(db, work_id)

    def image_versions(self, image_id):
        """
        查询同一图库图片被哪些作品和版本引用。

        Args:
            image_id: 原图库图片 ID，删除后仍可查询已有历史。

        Returns:
            works 与 versions。
        """
        with self.library.lock, self.library._connect() as db:
            rows = db.execute("""SELECT DISTINCT v.* FROM work_versions v JOIN version_images vi ON vi.version_id=v.id
                WHERE vi.image_id=? ORDER BY v.created_at""", (image_id,)).fetchall()
            return {"works": [self._work(db, work_id) for work_id in dict.fromkeys(row["work_id"] for row in rows)],
                    "versions": [self._version(db, row) for row in rows]}

    def validate_context(self, context):
        """
        在收费生成之前校验作品与父节点，防止结果落入错误作品。

        Args:
            context: work_id 与 parent_version_id，或 None。

        Returns:
            校验后的上下文字典或 None。
        """
        if context is None:
            return None
        if not isinstance(context, dict) or set(context) != {"work_id", "parent_version_id"} or not all(isinstance(value, str) and value for value in context.values()):
            raise ExposableError("The version context is invalid.", code="VERSION_CONTEXT_INVALID")
        with self.library.lock, self.library._connect() as db:
            self._work(db, context["work_id"])
            self._parent(db, context["work_id"], context["parent_version_id"])
        return dict(context)

    def asset_path(self, asset_id, thumbnail=False):
        """
        通过内容 ID 提供历史快照，不接受任意磁盘路径。

        Args:
            asset_id: SHA-256 内容 ID。
            thumbnail: 是否读取快照缩略图。

        Returns:
            已验证的快照文件 Path。
        """
        with self.library.lock, self.library._connect() as db:
            row = db.execute("SELECT * FROM version_assets WHERE id=?", (asset_id,)).fetchone()
            if row is None or not re.fullmatch(r"[a-f0-9]{64}", asset_id):
                raise ExposableError("The version image does not exist.", 404, "VERSION_ASSET_NOT_FOUND")
            path = self.asset_dir / f"{asset_id}{'.thumb.png' if thumbnail else row['suffix']}"
            if not path.is_file():
                raise ExposableError("The version image file is missing.", 404, "VERSION_ASSET_MISSING")
            return path
