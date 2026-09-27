"""把旧 SQLite 参考库一次性迁入文件图库，保留全部旧数据。"""

import uuid

from .local_store import LocalStoreError


MIGRATION_NAME = "legacy-reference-library-v1"


def migrate_reference_library(library, legacy_store, local_store):
    """
    将旧参考图片导入统一图库，无图记录转存到现有笔记本。

    Args:
        library: 提供图片导入、分组和迁移标记的 LocalImageLibrary。
        legacy_store: 只读使用的旧 ReferenceStore。
        local_store: 用于原子追加 notes 的 LocalJsonStore。

    Returns:
        None。失败时保留已导入图片，下次启动按稳定 ID 继续，不覆盖原数据。
    """
    if library.has_migration(MIGRATION_NAME):
        return

    groups = {group["id"]: group["name"] for group in library.list_groups("references")}
    group_names = set(groups.values())
    text_entries = []
    for kind in ("artist", "image"):
        for entry in legacy_store.list(kind):
            reference_key = f"novelai-local/reference/{kind}/{entry['id']}"
            if not entry["images"]:
                text_entries.append((kind, entry, reference_key))
                continue

            # 单图保持未分组；旧多图记录用同名分组保留图片之间的关系。
            group_id = None
            if len(entry["images"]) > 1:
                group_id = uuid.uuid5(uuid.NAMESPACE_URL, reference_key).hex
                if group_id not in groups:
                    group_name = entry["title"][:200]
                    suffix = 1
                    while group_name in group_names:
                        counter = f"-{suffix}" if suffix > 1 else ""
                        label = f"（旧参考 {entry['id'][:8]}{counter}）"
                        group_name = f"{entry['title'][:200 - len(label)]}{label}"
                        suffix += 1
                    library.create_group(group_name, source="references", group_id=group_id)
                    groups[group_id] = group_name
                    group_names.add(group_name)

            parameters = entry["parameters"] or {}
            for image in entry["images"]:
                stored = legacy_store.image(image["id"])
                if stored is None:
                    raise LocalStoreError("A legacy reference image could not be read.")
                image_id = uuid.uuid5(uuid.NAMESPACE_URL, f"{reference_key}/{image['id']}").hex
                library.import_image(
                    stored["image_data"],
                    stored["original_name"],
                    source="references",
                    title=entry["title"],
                    prompt=entry["prompt"],
                    negative_prompt=parameters.get("negativePrompt", parameters.get("uc")),
                    style_prompt=entry["prompt"] if kind == "artist" else "",
                    parameters=entry["parameters"],
                    group_id=group_id,
                    image_id=image_id,
                )

    if text_entries:
        def append_legacy_notes(notes):
            """按稳定来源标记追加无图记录，保留已有笔记及重试期间的编辑。"""
            existing_ids = {note["id"] for note in notes}
            existing_sources = {note.get("legacy_reference_id") for note in notes}
            existing_titles = {note["title"] for note in notes}
            for kind, entry, reference_key in text_entries:
                note_id = uuid.uuid5(uuid.NAMESPACE_URL, f"{reference_key}/note").hex
                if note_id in existing_ids or reference_key in existing_sources:
                    continue
                title = entry["title"]
                suffix = 1
                while title in existing_titles:
                    counter = f"-{suffix}" if suffix > 1 else ""
                    title = f"{entry['title']}（旧参考 {entry['id'][:8]}{counter}）"
                    suffix += 1
                parameters = entry["parameters"] or {}
                notes.append({
                    "id": note_id,
                    "title": title,
                    "text_content1": entry["prompt"],
                    "text_content2": parameters.get("negativePrompt", parameters.get("uc", "")),
                    "image_url": "",
                    "character_tabs": parameters.get("characterTabs", []),
                    "parameters": entry["parameters"],
                    "created_at": entry["created_at"],
                    "legacy_reference_id": reference_key,
                })
                existing_titles.add(title)
            return notes

        local_store.mutate("notes", append_legacy_notes)

    # 图片和笔记都保存成功后才完成迁移，重启不会复活用户后来删除的条目。
    library.mark_migration(MIGRATION_NAME)
