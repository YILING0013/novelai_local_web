export const PANEL_IDS = ["properties", "adjustments", "layers", "palette"];

/** 创建默认布局；属性与调整为可拆分的标签组，图层和色板独立停靠。
 * @returns {object} 可直接保存的布局对象。
 */
export function defaultPanelLayout() {
  return {
    version: 2,
    front: "properties",
    dockWidths: { left: 290, right: 290 },
    panels: Object.fromEntries(PANEL_IDS.map((id) => [id, { hidden: false }])),
    groups: [["properties", "adjustments"], ["layers"], ["palette"]].map((tabs, order) => ({
      id: tabs[0], tabs, active: tabs[0], side: "right", collapsed: false,
      height: [340, 300, 160][order], x: 70 + order * 35, y: 30 + order * 35,
      width: 320, floatHeight: [440, 360, 260][order],
    })),
  };
}

/** 读取保存布局，迁移旧的属性/调整面板，并保证每个面板只属于一个组。
 * @param {object} saved 浏览器保存的布局或命名预设。
 * @returns {object} 补齐面板、限制尺寸后的独立布局对象。
 */
export function normalizePanelLayout(saved) {
  const result = defaultPanelLayout();
  if (!saved || ![1, 2].includes(saved.version)) return result;
  for (const side of ["left", "right"]) {
    const width = saved.dockWidths?.[side];
    if (Number.isFinite(width)) result.dockWidths[side] = Math.max(220, Math.min(640, width));
  }
  let groups = saved.groups;
  if (saved.version === 1) {
    groups = ["inspector", "layers", "palette"].map((id, order) => ({
      ...result.groups[order], ...saved.panels?.[id], id: id === "inspector" ? "properties" : id,
      tabs: id === "inspector" ? ["properties", "adjustments"] : [id],
      active: id === "inspector" ? "properties" : id, order: saved.panels?.[id]?.order ?? order,
    })).sort((a, b) => a.order - b.order);
  }
  for (const id of PANEL_IDS) {
    const oldId = ["properties", "adjustments"].includes(id) ? "inspector" : id;
    result.panels[id].hidden = saved.panels?.[saved.version === 1 ? oldId : id]?.hidden === true;
  }
  if (!Array.isArray(groups)) return result;
  const used = new Set();
  const ids = new Set();
  result.groups = groups.flatMap((source) => {
    if (!source || !Array.isArray(source.tabs)) return [];
    const tabs = source.tabs.filter((id) => {
      if (!PANEL_IDS.includes(id) || used.has(id)) return false;
      used.add(id); return true;
    });
    if (!tabs.length) return [];
    const defaults = defaultPanelLayout().groups.find((group) => group.tabs.includes(tabs[0]));
    let id = typeof source.id === "string" && source.id.length < 80 ? source.id : tabs[0];
    while (ids.has(id)) id += "-group";
    ids.add(id);
    const group = { ...defaults, id, tabs, active: tabs.includes(source.active) ? source.active : tabs[0], collapsed: source.collapsed === true };
    if (["left", "right", "floating"].includes(source.side)) group.side = source.side;
    for (const [key, min, max] of [["height", 100, 1600], ["width", 220, 1200], ["floatHeight", 120, 1600], ["x", 0, 10000], ["y", 0, 10000]]) {
      if (Number.isFinite(source[key])) group[key] = Math.max(min, Math.min(max, source[key]));
    }
    return [group];
  });
  // 被旧版本或损坏预设遗漏的面板仍可从菜单访问。
  for (const id of PANEL_IDS.filter((key) => !used.has(key))) {
    const base = defaultPanelLayout().groups.find((group) => group.tabs.includes(id));
    let groupId = id;
    while (ids.has(groupId)) groupId += "-group";
    ids.add(groupId);
    result.groups.push({ ...base, id: groupId, tabs: [id], active: id });
  }
  result.front = result.groups.find((group) => group.id === saved.front)?.id || result.groups[0].id;
  return result;
}

/** 移动一个标签或整组：可合并进目标组、调整标签顺序，或拆成独立停靠/浮窗。
 * @param {object} layout 当前布局。
 * @param {string[]} panelIds 要移动的面板，顺序即标签顺序。
 * @param {object} destination groupId 表示合组；side 表示独立放置，index 为目标位置，rect 为浮窗尺寸。
 * @returns {object} 不修改原始布局的新布局。
 */
export function movePanels(layout, panelIds, destination) {
  const source = layout.groups.find((group) => group.tabs.includes(panelIds[0]));
  const target = layout.groups.find((group) => group.id === destination.groupId);
  let groups = layout.groups.map((group) => {
    const tabs = group.tabs.filter((id) => !panelIds.includes(id));
    return { ...group, tabs, active: tabs.includes(group.active) ? group.active : tabs[0] };
  });
  const panels = { ...layout.panels };
  let front;
  panelIds.forEach((id) => { panels[id] = { ...panels[id], hidden: false }; });
  if (target) {
    front = target.id;
    groups = groups.map((group) => {
      if (group.id !== target.id) return group;
      const tabs = [...group.tabs];
      tabs.splice(Math.max(0, Math.min(destination.index ?? tabs.length, tabs.length)), 0, ...panelIds);
      return { ...group, tabs, active: panelIds[0], collapsed: false };
    }).filter((group) => group.tabs.length);
  } else {
    groups = groups.filter((group) => group.tabs.length);
    let id = source.tabs.length === panelIds.length ? source.id : panelIds[0];
    while (groups.some((group) => group.id === id)) id += "-group";
    const moved = { ...source, id, tabs: [...panelIds], active: panelIds.includes(source.active) ? source.active : panelIds[0], side: destination.side };
    front = id;
    if (destination.rect) Object.assign(moved, { x: destination.rect.x, y: destination.rect.y, width: destination.rect.width, floatHeight: destination.rect.height });
    const peers = groups.filter((group) => group.side === destination.side && group.tabs.some((key) => !panels[key].hidden));
    const before = peers[destination.index ?? peers.length];
    groups.splice(before ? groups.indexOf(before) : groups.length, 0, moved);
  }
  return { ...layout, panels, groups, front };
}

/** 将浮窗完整限制在工作区内，缩小浏览器后仍能看到拖动栏。
 * @param {object} rect 浮窗的 x、y、width、height。
 * @param {object} bounds 工作区可用的 width、height。
 * @returns {object} 可见范围内的位置与大小。
 */
export function fitPanelRect(rect, bounds) {
  const width = Math.min(bounds.width, Math.max(220, rect.width));
  const height = Math.min(bounds.height, Math.max(120, rect.height));
  return { width, height, x: Math.max(0, Math.min(rect.x, bounds.width - width)), y: Math.max(0, Math.min(rect.y, bounds.height - height)) };
}
