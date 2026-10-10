"""本地词条分组的数据校验。词条和分组由 LocalJsonStore 一起原子保存。"""

from typing import Any


class NotebookValidationError(ValueError):
    """词条或分组输入不合法。"""


def validate_groups(groups: Any) -> None:
    """
    校验三级分组树，拒绝重复 ID、同级重名、失效父级和循环引用。

    Args:
        groups: 从界面或导入文件取得的分组数组。

    Returns:
        无返回值；无效数据抛出 ValueError，由路由统一转为输入错误。
    """
    if not isinstance(groups, list) or len(groups) > 500:
        raise NotebookValidationError("Groups must be an array of at most 500 items.")
    by_id = {}
    names = set()
    for group in groups:
        if not isinstance(group, dict):
            raise NotebookValidationError("Each group must be an object.")
        group_id, name, parent = group.get("id"), group.get("name"), group.get("parent_id")
        if not isinstance(group_id, str) or not group_id or len(group_id) > 128 or group_id in by_id:
            raise NotebookValidationError("Group ids must be unique non-empty strings.")
        if not isinstance(name, str) or not name.strip() or len(name) > 80:
            raise NotebookValidationError("Group names must contain 1 to 80 characters.")
        if parent is not None and not isinstance(parent, str):
            raise NotebookValidationError("The parent group id must be a string or null.")
        key = (parent, name.strip().casefold())
        if key in names:
            raise NotebookValidationError("Group names must be unique within the same parent.")
        group["name"] = name.strip()
        group["parent_id"] = parent
        names.add(key)
        by_id[group_id] = group
    for group in groups:
        seen = {group["id"]}
        parent = group["parent_id"]
        while parent is not None:
            if parent not in by_id or parent in seen:
                raise NotebookValidationError("The group tree contains a missing parent or a cycle.")
            seen.add(parent)
            if len(seen) > 3:
                raise NotebookValidationError("Groups can have at most three levels.")
            parent = by_id[parent]["parent_id"]


def validate_note_groups(notebook: dict) -> dict:
    """
    校验完整笔记本，防止词条引用已经不存在的分组。

    Args:
        notebook: 包含 notes 和 groups 数组的笔记本。

    Returns:
        通过校验、可供原子写入的原笔记本。
    """
    validate_groups(notebook["groups"])
    ids = {group["id"] for group in notebook["groups"]}
    for note in notebook["notes"]:
        group_id = note.get("group_id")
        if group_id is not None and (not isinstance(group_id, str) or group_id not in ids):
            raise NotebookValidationError("The note group does not exist.")
    return notebook
