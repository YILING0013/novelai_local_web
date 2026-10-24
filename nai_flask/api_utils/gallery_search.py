"""按本机图片参数检索、比较提示词，并保存随图库变化的智能收藏。"""

from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
import uuid
from datetime import datetime, timezone

from .custom_errors import ExposableError


_PROMPT_PARTS = re.compile(r"(\\.|[+-]?(?:\d+(?:\.\d*)?|\.\d+)::|::|[{}\[\],\r\n])")
_FILTER_KEYS = {"group", "q", "trash", "model", "orientation", "tags", "negative_tags",
                "sort", "similar_to", "min_similarity"}


def initialize_gallery_schema(db):
    """
    在现有图库数据库中建立提示词索引和智能收藏表。

    Args:
        db: 已启用外键的 SQLite 连接。

    Returns:
        None。
    """
    db.executescript("""
        CREATE TABLE IF NOT EXISTS library_prompt_features(
            image_id TEXT PRIMARY KEY REFERENCES library_images(id) ON DELETE CASCADE,
            fingerprint TEXT NOT NULL, features_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS library_smart_collections(
            id TEXT PRIMARY KEY, source TEXT NOT NULL, name TEXT NOT NULL,
            filters_json TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS library_collection_source
            ON library_smart_collections(source, created_at DESC);
    """)


def parse_prompt_tags(prompt):
    """
    将逗号分隔的提示词转为规范标签与有符号权重。

    Args:
        prompt: 提示词文本；支持 NAI 花括号、方括号、数字双冒号和转义。

    Returns:
        标签到权重的字典。大小写、全半角和下划线差异被归一化。
    """
    if not isinstance(prompt, str):
        return {}
    tags, pieces = {}, []
    numeric_weight, bracket_level = 1.0, 0
    # 双冒号结束数值强调并关闭所有括号，与官方语法一致。
    # 标签内部局部强调用字符长度加权，避免把“red {hair}”拆成两种标签。
    for part in [*_PROMPT_PARTS.split(prompt), ","]:
        if not part:
            continue
        if part in {",", "\r", "\n"}:
            text = unicodedata.normalize("NFKC", "".join(piece for piece, _ in pieces))
            tag = " ".join(text.casefold().replace("_", " ").split())
            length = sum(len(piece.strip()) for piece, _ in pieces)
            if tag and length:
                weight = sum(len(piece.strip()) * weight for piece, weight in pieces) / length
                if weight and (tag not in tags or abs(weight) > abs(tags[tag])):
                    tags[tag] = weight
            pieces = []
        elif part in {"{", "]"}:
            bracket_level += 1
        elif part in {"}", "["}:
            bracket_level -= 1
        elif part.endswith("::"):
            numeric_weight = float(part[:-2]) if part != "::" else 1.0
            # 外部 PNG 可以带任意文本；极端权重不应让排序产生 NaN/Infinity。
            numeric_weight = max(-1e6, min(1e6, numeric_weight))
            bracket_level = 0
        else:
            weight = numeric_weight * 1.05 ** max(-256, min(256, bracket_level))
            pieces.append((part[1:] if part.startswith("\\") else part, weight))
    return tags


def weighted_jaccard(left, right):
    """
    比较两个非负提示词特征集合，不推断图片视觉内容或标签同义词。

    Args:
        left: 参考提示词的特征权重字典。
        right: 待比较提示词的特征权重字典。

    Returns:
        0 到 1 的加权交并比；没有提示词时返回 0。
    """
    keys = left.keys() | right.keys()
    denominator = sum(max(left.get(key, 0), right.get(key, 0)) for key in keys)
    return sum(min(left.get(key, 0), right.get(key, 0)) for key in keys) / denominator if denominator else 0.0


def _image_features(db, row):
    parameters = json.loads(row["parameters_json"])
    characters = parameters.get("characterTabs", [])
    content = json.dumps([row["prompt"], row["negative_prompt"], row["style_prompt"], characters], ensure_ascii=False)
    fingerprint = hashlib.sha256(content.encode("utf-8")).hexdigest()
    cached = db.execute("SELECT fingerprint,features_json FROM library_prompt_features WHERE image_id=?", (row["id"],)).fetchone()
    if cached and cached["fingerprint"] == fingerprint:
        return json.loads(cached["features_json"])
    prompts = [("positive", row["prompt"]), ("positive", row["style_prompt"]), ("negative", row["negative_prompt"])]
    if isinstance(characters, list):
        for index, character in enumerate(characters):
            if isinstance(character, dict):
                prompts.extend([(f"character:{index}:positive", character.get("prompt", "")),
                                (f"character:{index}:negative", character.get("uc", ""))])
    weights, positive_tags = {}, set()
    for channel, prompt in prompts:
        for tag, weight in parse_prompt_tags(prompt).items():
            # 正负提示词、角色和负数强调分开比较，防止互相抵消或误判一致。
            key = f"{channel}:{'+' if weight > 0 else '-'}|{tag}"
            weights[key] = max(weights.get(key, 0), abs(weight))
            if channel.endswith("positive") and weight > 0:
                positive_tags.add(tag)
    features = {"weights": weights, "positive_tags": sorted(positive_tags)}
    db.execute("""INSERT INTO library_prompt_features(image_id,fingerprint,features_json) VALUES(?,?,?)
        ON CONFLICT(image_id) DO UPDATE SET fingerprint=excluded.fingerprint,features_json=excluded.features_json""",
               (row["id"], fingerprint, json.dumps(features, ensure_ascii=False)))
    return features


def _validate_filters(filters):
    if not isinstance(filters, dict) or filters.keys() - _FILTER_KEYS:
        raise ExposableError("The gallery filters are invalid.", code="LIBRARY_FILTER_INVALID")
    result = dict(filters)
    for key, value in result.items():
        if key == "trash":
            if not isinstance(value, bool):
                raise ExposableError("The trash filter must be a boolean.", code="LIBRARY_FILTER_INVALID")
        elif key == "min_similarity":
            try:
                number = float(value)
            except (TypeError, ValueError) as exc:
                raise ExposableError("Similarity must be between zero and one.", code="LIBRARY_FILTER_INVALID") from exc
            if isinstance(value, bool) or not math.isfinite(number) or not 0 <= number <= 1:
                raise ExposableError("Similarity must be between zero and one.", code="LIBRARY_FILTER_INVALID")
            result[key] = number
        elif not isinstance(value, str):
            raise ExposableError("The gallery filter must be text.", code="LIBRARY_FILTER_INVALID")
        else:
            result[key] = value.strip()
    if result.get("orientation", "") not in {"", "portrait", "landscape", "square"}:
        raise ExposableError("The gallery orientation is invalid.", code="LIBRARY_FILTER_INVALID")
    if result.get("sort", "newest") not in {"newest", "oldest", "similarity"}:
        raise ExposableError("The gallery sort order is invalid.", code="LIBRARY_FILTER_INVALID")
    if (result.get("sort") == "similarity" or result.get("min_similarity", 0) > 0) and not result.get("similar_to"):
        raise ExposableError("Choose a reference image for similarity search.", code="LIBRARY_FILTER_INVALID")
    return result


def search_images(library, source=None, limit=60, offset=0, group_id=None, query="", trashed=False,
                  model="", orientation="", tags="", negative_tags="", sort="newest",
                  similar_to="", min_similarity=0.0, collection_id=""):
    """
    在活动目录内组合筛选、比较提示词，完成全量排序后再分页。

    Args:
        library: 当前 LocalImageLibrary 实例。
        source: references 或 outputs，None 查询两个来源。
        limit: 每页数量，1 到 200。
        offset: 从第几条结果开始读取。
        group_id: 分组 ID，__ungrouped 表示未分组。
        query: 文件名、标题、提示词或画风检索文本。
        trashed: 是否查询回收站。
        model: 模型标识。
        orientation: portrait、landscape 或 square。
        tags: 必须全部命中的正向标签，逗号分隔，包含角色和画风。
        negative_tags: 要排除的正向标签，逗号分隔，不是负向提示词查询。
        sort: newest、oldest 或 similarity。
        similar_to: 提示词相似检索的参考图片 ID，结果不含参考图自身。
        min_similarity: 0 到 1 的最低相似度。
        collection_id: 智能收藏 ID，非空请求条件覆盖已保存条件。

    Returns:
        兼容图库列表的 items、total、page、page_size、limit、offset。
    """
    if type(limit) is not int or type(offset) is not int or not 1 <= limit <= 200 or offset < 0:
        raise ExposableError("The gallery page or page size is invalid.", code="LIBRARY_PAGE_INVALID")
    with library.lock, library._connect() as db:
        initialize_gallery_schema(db)
        filters = {}
        if collection_id:
            collection = db.execute("SELECT * FROM library_smart_collections WHERE id=?", (collection_id,)).fetchone()
            if not collection:
                raise ExposableError("The smart collection no longer exists.", 404, "LIBRARY_COLLECTION_NOT_FOUND")
            if source and source != collection["source"]:
                raise ExposableError("The smart collection belongs to another gallery.", code="LIBRARY_COLLECTION_SOURCE_INVALID")
            source = collection["source"]
            filters = json.loads(collection["filters_json"])
        incoming = {"group": group_id, "q": query, "trash": trashed, "model": model, "orientation": orientation,
                    "tags": tags, "negative_tags": negative_tags, "sort": sort, "similar_to": similar_to,
                    "min_similarity": min_similarity}
        for key, value in incoming.items():
            if value not in (None, "", False) and not (collection_id and key == "sort" and value == "newest"):
                filters[key] = value
        filters = _validate_filters(filters)
        clauses, args = [], []
        for current_source in [source] if source else ["references", "outputs"]:
            clauses.append("(source=? AND root=?)")
            args.extend((current_source, str(library._root(current_source))))
        where = f"({' OR '.join(clauses)}) AND missing=0 AND trashed_at IS {'NOT ' if filters.get('trash') else ''}NULL"
        group = filters.get("group")
        if group == "__ungrouped":
            where += " AND group_id IS NULL"
        elif group:
            where += " AND group_id=?"
            args.append(group)
        if filters.get("q"):
            where += " AND (title LIKE ? OR filename LIKE ? OR prompt LIKE ? OR style_prompt LIKE ?)"
            args.extend([f"%{filters['q']}%"] * 4)
        if filters.get("model"):
            where += " AND lower(json_extract(parameters_json,'$.model'))=lower(?)"
            args.append(filters["model"])
        orientation_clause = {"portrait": "height>width", "landscape": "width>height", "square": "width=height"}
        if filters.get("orientation"):
            where += f" AND {orientation_clause[filters['orientation']]}"
        reference = None
        if filters.get("similar_to"):
            reference_row = library._row(db, filters["similar_to"])
            if reference_row["missing"]:
                raise ExposableError("The reference image is missing.", 404, "LIBRARY_IMAGE_NOT_FOUND")
            reference = _image_features(db, reference_row)["weights"]
        required = set(parse_prompt_tags(filters.get("tags", "")))
        excluded = set(parse_prompt_tags(filters.get("negative_tags", "")))
        order = filters.get("sort", "newest")
        # 普通筛选交给 SQLite 分页，避免大图库为了展示一页而读取全部元数据。
        if not required and not excluded and reference is None:
            total = db.execute(f"SELECT COUNT(*) FROM library_images WHERE {where}", args).fetchone()[0]
            direction = "ASC" if order == "oldest" else "DESC"
            rows = db.execute(f"SELECT * FROM library_images WHERE {where} ORDER BY created_at {direction},id {direction} LIMIT ? OFFSET ?",
                              [*args, limit, offset])
            return {"items": [library._record(row, detail=False) for row in rows], "total": total,
                    "page": offset // limit + 1, "page_size": limit, "limit": limit, "offset": offset}
        matches = []
        for row in db.execute(f"SELECT * FROM library_images WHERE {where}", args).fetchall():
            if row["id"] == filters.get("similar_to"):
                continue
            similarity = None
            if required or excluded or reference is not None:
                features = _image_features(db, row)
                positive = set(features["positive_tags"])
                if not required <= positive or excluded & positive:
                    continue
                if reference is not None:
                    similarity = weighted_jaccard(reference, features["weights"])
                    if similarity < filters.get("min_similarity", 0):
                        continue
            matches.append((row, similarity))
        matches.sort(key=lambda item: ((item[1] if item[1] is not None else 0), item[0]["created_at"], item[0]["id"])
                     if order == "similarity" else (item[0]["created_at"], item[0]["id"]), reverse=order != "oldest")
        items = []
        for row, similarity in matches[offset:offset + limit]:
            record = library._record(row, detail=False)
            if similarity is not None:
                record["similarity"] = round(similarity, 6)
            items.append(record)
        return {"items": items, "total": len(matches), "page": offset // limit + 1, "page_size": limit,
                "limit": limit, "offset": offset}


def list_collections(library, source=None):
    """
    读取按来源保存的智能收藏条件。

    Args:
        library: 当前本机图库。
        source: 图片来源，None 读取全部来源。

    Returns:
        包含 id、source、name、filters 和 created_at 的列表。
    """
    if source:
        library._root(source)
    with library.lock, library._connect() as db:
        initialize_gallery_schema(db)
        rows = db.execute("SELECT * FROM library_smart_collections" + (" WHERE source=?" if source else "") +
                          " ORDER BY created_at DESC,id DESC", (source,) if source else ())
        result = []
        for row in rows:
            item = dict(row)
            item["filters"] = json.loads(item.pop("filters_json"))
            result.append(item)
        return result


def create_collection(library, source, name, filters):
    """
    保存筛选规则，收藏内容在下次查询时根据当前图库重新计算。

    Args:
        library: 当前本机图库。
        source: references 或 outputs。
        name: 1 到 80 个字符的收藏名称。
        filters: 图库查询条件，不含来源、分页或其他收藏 ID。

    Returns:
        新建收藏字典。
    """
    library._root(source)
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
        raise ExposableError("The collection name must contain 1 to 80 characters.", code="LIBRARY_COLLECTION_NAME_INVALID")
    filters = _validate_filters(filters)
    collection = {"id": uuid.uuid4().hex, "source": source, "name": name.strip(), "filters": filters,
                  "created_at": datetime.now(timezone.utc).isoformat()}
    with library.lock, library._connect() as db:
        initialize_gallery_schema(db)
        if filters.get("similar_to"):
            library._row(db, filters["similar_to"])
        db.execute("INSERT INTO library_smart_collections(id,source,name,filters_json,created_at) VALUES(?,?,?,?,?)",
                   (collection["id"], source, collection["name"], json.dumps(filters, ensure_ascii=False), collection["created_at"]))
    return collection


def delete_collection(library, collection_id):
    """
    删除一条智能收藏规则，不修改任何图片或分组。

    Args:
        library: 当前本机图库。
        collection_id: 收藏 ID。

    Returns:
        True；收藏不存在时返回 404 错误。
    """
    with library.lock, library._connect() as db:
        initialize_gallery_schema(db)
        changed = db.execute("DELETE FROM library_smart_collections WHERE id=?", (collection_id,)).rowcount
        if not changed:
            raise ExposableError("The smart collection no longer exists.", 404, "LIBRARY_COLLECTION_NOT_FOUND")
    return True
