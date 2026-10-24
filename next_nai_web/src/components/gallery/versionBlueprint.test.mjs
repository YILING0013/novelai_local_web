import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVersionBlueprint, getVersionPathCollapseIds, layoutVersionBlueprint } from './versionBlueprint.mjs';

const versions = [
  { id: 'a', number: 1, parent_id: null }, { id: 'b', number: 2, parent_id: 'a' },
  { id: 'c', number: 3, parent_id: 'b' }, { id: 'd', number: 4, parent_id: 'c' },
  { id: 'e', number: 5, parent_id: 'b' },
];
const empty = { positions: {}, edge_notes: {}, hidden_node_ids: [], groups: [] };

test('蓝图按父子从左到右排布，兄弟分支分行且输入顺序无关', () => {
  const positions = layoutVersionBlueprint([...versions].reverse());
  assert.ok(positions.a.x < positions.b.x && positions.b.x < positions.c.x && positions.c.x < positions.d.x);
  assert.equal(positions.c.x, positions.e.x);
  assert.notEqual(positions.c.y, positions.e.y);
  assert.ok(positions.b.y > Math.min(positions.c.y, positions.e.y) && positions.b.y < Math.max(positions.c.y, positions.e.y));
});

test('隐藏中间路径后跨越到最近可见祖先，保留可展开 ID 与对应连线备注', () => {
  const graph = buildVersionBlueprint(versions, { ...empty, hidden_node_ids: ['b', 'c'], edge_notes: { d: '保留色调' } });
  assert.deepEqual(graph.nodes.map((node) => node.key), ['a', 'd', 'e']);
  assert.deepEqual(graph.edges.map(({ id, from, to, hiddenIds, note }) => ({ id, from, to, hiddenIds, note })), [
    { id: 'd', from: 'a', to: 'd', hiddenIds: ['c', 'b'], note: '保留色调' },
    { id: 'e', from: 'a', to: 'e', hiddenIds: ['b'], note: '' },
  ]);
  const rootHidden = buildVersionBlueprint(versions, { ...empty, hidden_node_ids: ['a', 'b'] });
  assert.deepEqual(rootHidden.nodes.find((node) => node.key === 'c').hiddenAncestorIds, ['b', 'a']);
});

test('路径折叠保留选择的中间节点、末端节点和根版本，不隐藏其他分支', () => {
  assert.deepEqual(getVersionPathCollapseIds(versions, ['c', 'd']), ['b']);
  assert.deepEqual(getVersionPathCollapseIds(versions, ['d']), ['c', 'b']);
  assert.deepEqual(getVersionPathCollapseIds(versions, ['a']), []);
});

test('折叠组用组卡片连接外部节点，组内原版本与位置完整保留', () => {
  const blueprint = { ...empty, positions: { b: { x: 200, y: 80 }, c: { x: 520, y: 80 } }, groups: [{ id: 'g', title: '人物试验', node_ids: ['b', 'c'], collapsed: true }] };
  const original = structuredClone(blueprint);
  const graph = buildVersionBlueprint(versions, blueprint);
  assert.deepEqual(graph.nodes.map((node) => node.key), ['a', 'd', 'e', 'group:g']);
  assert.deepEqual(graph.edges.map(({ id, from, to }) => ({ id, from, to })), [
    { id: 'b', from: 'a', to: 'group:g' }, { id: 'd', from: 'group:g', to: 'd' }, { id: 'e', from: 'group:g', to: 'e' },
  ]);
  assert.equal(graph.nodes.find((node) => node.key === 'group:g').x, 200);
  assert.deepEqual(graph.positions.c, { x: 520, y: 80 });
  assert.deepEqual(blueprint, original);
  const expanded = buildVersionBlueprint(versions, { ...blueprint, groups: [{ ...blueprint.groups[0], collapsed: false }] });
  assert.equal(expanded.nodes.length, 5);
  assert.equal(expanded.groups.length, 1);
});

test('全部隐藏后可恢复默认图；无节点和无分组成员时仍有有效画布范围', () => {
  const hidden = buildVersionBlueprint(versions, { ...empty, hidden_node_ids: versions.map((version) => version.id) });
  assert.deepEqual(hidden.nodes, []);
  assert.ok(hidden.bounds.right > hidden.bounds.left);
  assert.equal(buildVersionBlueprint(versions, empty).nodes.length, versions.length);
  assert.deepEqual(buildVersionBlueprint([], empty).edges, []);
});
