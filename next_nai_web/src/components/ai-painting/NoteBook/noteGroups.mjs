/**
 * 按父子顺序列出分组，让侧栏和分组选择器使用相同的层级、完整路径。
 * @param {Array} groups 后端返回的分组列表，parent_id 为 null 表示第一层。
 * @returns {Array} 包含 depth（从 1 开始）和 label（完整路径）的分组列表。
 */
export function getGroupOptions(groups) {
  const result = [];
  const appendChildren = (parentId, depth, path) => {
    for (const group of groups.filter((item) => (item.parent_id || null) === parentId)) {
      const label = [...path, group.name].join(' / ');
      result.push({ ...group, depth, label });
      appendChildren(group.id, depth + 1, [...path, group.name]);
    }
  };
  appendChildren(null, 1, []);
  return result;
}
