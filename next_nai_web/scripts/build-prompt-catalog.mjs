/** 从词屿 SQLite 生成浏览器查询用的二进制词库。仅在更新词库或 WASM 时运行。 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { pinyin } from 'pinyin-pro';
import initSqlJs from 'sql.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sqlite = process.argv[2];
if (!sqlite) throw new Error('用法：npm run build:prompt-catalog -- <ciyu.sqlite>');
const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync(resolve(sqlite)));
const normalize = value => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '_');
const hash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
function readings(label) {
  if (!/\p{Script=Han}/u.test(label)) return ['', ''];
  const syllables = pinyin(label, { type: 'array', toneType: 'none', nonZh: 'consecutive', v: true })
    .map(s => s.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
  return [syllables.join(''), syllables.map(s => s[0]).join('')];
}

const metadata = Object.fromEntries(db.exec('SELECT key, value_json FROM export_metadata')[0]
  .values.map(([key, json]) => [key, JSON.parse(json)]));
const topics = [];
const ids = new Map();
db.each('SELECT topic, parent, label FROM taxonomy_topics ORDER BY parent IS NOT NULL, topic',
  ({ topic: key, parent, label }) => {
    const id = topics.length + 1;
    if (id > 65535) throw new Error('分类数量超出词库格式');
    ids.set(key, id);
    topics.push([key, parent ? ids.get(parent) : 0, label, ...readings(label)]);
  });
const tagTopics = new Map();
db.each('SELECT name, topic FROM tag_topics ORDER BY name, position', ({ name, topic: key }) => {
  const idsForTag = tagTopics.get(name) ?? [];
  const id = ids.get(key);
  const parent = topics[id - 1][1];
  for (const related of [id, parent]) {
    if (related && !idsForTag.includes(related)) idsForTag.push(related);
  }
  tagTopics.set(name, idsForTag);
});

const topicBytes = Buffer.from(JSON.stringify(topics));
const header = Buffer.alloc(12);
header.write('CIYU-T01');
header.writeUInt32LE(topicBytes.length, 8);
const chunks = [header, topicBytes];
let rowCount = 0;
// 同分用数据库引用量与英文键打破平局，打包后无需在每次按键时重新排序整库。
db.each('SELECT name, effective_cn_name FROM effective_tags ORDER BY post_count DESC, name', ({ name, effective_cn_name: translation }) => {
  const cn = translation || '';
  const fields = [name, cn, normalize(cn), ...readings(cn)].map(s => Buffer.from(s));
  const related = tagTopics.get(name) ?? [];
  const row = Buffer.allocUnsafe(12 + fields.reduce((n, s) => n + s.length, 0) + related.length * 2);
  let position = 12;
  fields.forEach((field, i) => {
    row.writeUInt16LE(field.length, 2 * i);
    position += field.copy(row, position);
  });
  row.writeUInt16LE(related.length, 10);
  for (const topic of related) { row.writeUInt16LE(topic, position); position += 2; }
  chunks.push(row);
  rowCount++;
});
db.close();
if (!rowCount || !topics.length) throw new Error('词屿数据库为空');
const compressed = gzipSync(Buffer.concat(chunks), { level: 9 });
const catalogFile = 'catalog-' + hash(compressed) + '.bin.gz';
const output = join(root, 'public/tag-search');
mkdirSync(output, { recursive: true });

const buildDir = join(root, 'node_modules/.cache/ciyu-wasm');
execFileSync('wasm-pack', ['build', 'tag_search_runtime', '--target', 'web', '--release', '--no-pack',
  '--no-typescript', '--out-dir', buildDir, '--', '--locked'], { cwd: root, stdio: 'inherit' });
const wasm = readFileSync(join(buildDir, 'ciyu_search_bg.wasm'));
const wasmFile = 'search-' + hash(wasm) + '.wasm';
// 绑定模块的默认 URL 也指向同一版本，使测试和浏览器都能按 URL 直接加载。
const glue = readFileSync(join(buildDir, 'ciyu_search.js'), 'utf8').replaceAll('ciyu_search_bg.wasm', wasmFile);
const glueFile = 'search-' + hash(glue) + '.mjs';
for (const [name, bytes] of [[catalogFile, compressed], [wasmFile, wasm], [glueFile, glue]]) {
  writeFileSync(join(output, name), bytes);
}
const manifest = { catalogFile, wasmFile, glueFile, rowCount, topicCount: topics.length,
  sourceCommit: metadata.source_commit, sourceManifest: metadata.manifest_sha256 };
const manifestPath = join(root, 'src/components/ai-painting/PromptEditor/promptSearchAssets.json');
mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(manifest);
