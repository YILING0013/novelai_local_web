export const BLUEPRINT_NODE_WIDTH = 216;
export const BLUEPRINT_NODE_HEIGHT = 202;

/**
 * 根据首张图片比例确定节点大小，图片区域保持原比例且不裁剪。
 * @param {object} version 节点及图片元数据。
 * @returns {object} 节点宽高和图片区域高度。
 */
export function versionNodeSize(version) {
  const image = version.images?.[0];
  if (!image) return { width: BLUEPRINT_NODE_WIDTH, height: 142, imageHeight: 64 };
  const ratio = (image.width || 1) / (image.height || 1);
  const imageWidth = ratio >= 1 ? 260 : Math.max(136, 260 * ratio);
  const imageHeight = imageWidth / ratio;
  return { width: imageWidth + 4, height: imageHeight + 78, imageHeight };
}

/**
 * 将作品版本按父子关系从左到右排布，分支分开占行。
 * @param {Array<object>} versions 同一作品的完整版本。
 * @returns {Object<string, {x: number, y: number}>} 每个版本的默认画布位置。
 */
export function layoutVersionBlueprint(versions) {
  const ordered = [...versions].sort((left, right) => left.number - right.number);
  const ids = new Set(ordered.map((version) => version.id));
  const children = new Map();
  for (const version of ordered) {
    const parent = ids.has(version.parent_id) ? version.parent_id : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(version);
  }
  const sizes = new Map(ordered.map((version) => [version.id, versionNodeSize(version)]));
  const depths = new Map();
  const widths = [];
  for (const version of ordered) {
    const depth = (depths.get(version.parent_id) ?? -1) + 1;
    depths.set(version.id, depth);
    widths[depth] = Math.max(widths[depth] || 0, sizes.get(version.id).width);
  }
  const columns = widths.map((_, depth) => widths.slice(0, depth).reduce((sum, width) => sum + width + 112, 0));
  const rowHeight = Math.max(142, ...[...sizes.values()].map((size) => size.height)) + 50;
  const positions = {};
  let row = 0;
  const place = (version, depth) => {
    const branch = children.get(version.id) || [];
    const rows = branch.map((child) => place(child, depth + 1));
    const y = rows.length ? (rows[0] + rows.at(-1)) / 2 : row++ * rowHeight + rowHeight / 2;
    positions[version.id] = { x: columns[depth], y: y - sizes.get(version.id).height / 2 };
    return y;
  };
  for (const root of children.get(null) || []) place(root, 0);
  return positions;
}

/**
 * 把保存的布局转换为可见节点、分组框与连线，隐藏路径跨到最近可见祖先。
 * @param {Array<object>} versions 同一作品的版本记录。
 * @param {object} blueprint 位置、隐藏节点、分组和连线备注。
 * @returns {object} 节点、连线、分组框、所有版本位置及当前画布边界。
 */
export function buildVersionBlueprint(versions, blueprint) {
  const byId = new Map(versions.map((version) => [version.id, version]));
  const positions = { ...layoutVersionBlueprint(versions), ...blueprint.positions };
  const hidden = new Set(blueprint.hidden_node_ids);
  const grouped = new Map();
  for (const group of blueprint.groups) {
    if (group.collapsed) for (const id of group.node_ids) grouped.set(id, group);
  }
  const representatives = new Map();
  const nodes = [];
  const groups = [];
  for (const version of versions) {
    if (hidden.has(version.id)) continue;
    const group = grouped.get(version.id);
    const key = group ? `group:${group.id}` : version.id;
    representatives.set(version.id, key);
    if (!group) nodes.push({ key, type: 'version', version, memberIds: [version.id], ...positions[version.id], ...versionNodeSize(version), hiddenAncestorIds: [] });
  }
  for (const group of blueprint.groups) {
    const memberIds = group.node_ids.filter((id) => byId.has(id));
    const visibleMembers = memberIds.filter((id) => !hidden.has(id));
    if (!visibleMembers.length) continue;
    const left = Math.min(...visibleMembers.map((id) => positions[id].x));
    const top = Math.min(...visibleMembers.map((id) => positions[id].y));
    if (group.collapsed) nodes.push({ key: `group:${group.id}`, type: 'group', group, memberIds, x: left, y: top, width: BLUEPRINT_NODE_WIDTH, height: BLUEPRINT_NODE_HEIGHT, hiddenAncestorIds: [] });
    else groups.push({ group, memberIds, x: left - 18, y: top - 48,
      width: Math.max(...visibleMembers.map((id) => positions[id].x + versionNodeSize(byId.get(id)).width)) - left + 36,
      height: Math.max(...visibleMembers.map((id) => positions[id].y + versionNodeSize(byId.get(id)).height)) - top + 66 });
  }
  const visibleByKey = new Map(nodes.map((node) => [node.key, node]));
  const edges = [];
  for (const version of versions) {
    const to = representatives.get(version.id);
    if (!to) continue;
    let parentId = version.parent_id;
    const hiddenIds = [];
    while (parentId && !representatives.has(parentId)) {
      const parent = byId.get(parentId);
      if (!parent) break;
      hiddenIds.push(parentId);
      parentId = parent.parent_id;
    }
    const from = representatives.get(parentId);
    if (from && from !== to) edges.push({ id: version.id, from, to, parentId: version.parent_id, hiddenIds, note: blueprint.edge_notes[version.id] || '' });
    else if (!from && hiddenIds.length) {
      // 根节点也允许隐藏；没有入线时，将可展开提示放在当前可见节点旁。
      const node = visibleByKey.get(to);
      node.hiddenAncestorIds = [...new Set([...node.hiddenAncestorIds, ...hiddenIds])];
    }
  }
  const bounds = nodes.length ? {
    left: Math.min(...nodes.map((node) => node.x), ...groups.map((group) => group.x)),
    top: Math.min(...nodes.map((node) => node.y), ...groups.map((group) => group.y)),
    right: Math.max(...nodes.map((node) => node.x + node.width), ...groups.map((group) => group.x + group.width)),
    bottom: Math.max(...nodes.map((node) => node.y + node.height), ...groups.map((group) => group.y + group.height)),
  } : { left: 0, top: 0, right: BLUEPRINT_NODE_WIDTH, bottom: BLUEPRINT_NODE_HEIGHT };
  return { nodes, edges, groups, positions, bounds };
}

/**
 * 找出可折叠的祖先路径，保留根节点及用户明确选中的中间或末端版本。
 * @param {Array<object>} versions 同一作品的版本记录。
 * @param {Array<string>} keptIds 用户希望保留的版本 ID。
 * @returns {Array<string>} 应隐藏的中间祖先 ID，不修改版本历史。
 */
export function getVersionPathCollapseIds(versions, keptIds) {
  const byId = new Map(versions.map((version) => [version.id, version]));
  const kept = new Set(keptIds);
  const hidden = new Set();
  for (const id of kept) {
    let parent = byId.get(byId.get(id)?.parent_id);
    while (parent) {
      if (parent.parent_id && byId.has(parent.parent_id) && !kept.has(parent.id)) hidden.add(parent.id);
      parent = byId.get(parent.parent_id);
    }
  }
  return [...hidden];
}
