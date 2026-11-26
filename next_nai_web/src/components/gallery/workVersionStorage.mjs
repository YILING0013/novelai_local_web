import { createClientId } from '../../utils/browserCapabilities.mjs';
import { getGalleryBlob, getGalleryEntry, getGalleryStorageTarget } from './galleryStorage.mjs';

export const WORK_VERSIONS_CHANGED = 'novelai:work-versions-changed';
const folders = { works: 'works', workVersions: 'work-versions', workAssets: 'work-assets' };
const imageTypes = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
let database;

/**
 * 为一轮教程创建内存版本存储，快照、图片与蓝图使用正式版本规则。
 * @returns {object} 只在当前练习会话内有效的存储目标。
 */
export function createMemoryWorkVersionTarget() {
  return { mode: 'memory', records: Object.fromEntries(Object.keys(folders).map((name) => [name, new Map()])), writes: Promise.resolve() };
}
const snapshotFields = new Set(`positivePrompt negativePrompt prompt input uc negative_prompt width height steps guidanceScale
scale seed model sampler noiseSchedule noise_schedule promptGuidanceRescale cfg_rescale smea dyn sm sm_dyn autoSmea strength noise
upscaled_enhance image_tool upscale_amount local_upscale_model local_upscale_factor characterTabs characterPrompts characterControl
v4_prompt v4_negative_prompt v4_prompt_char_captions v4_negative_prompt_char_captions use_coords use_order ucPresetId qualityPresetId
variety decrisp legacy legacy_uc legacy_v3_extend prefer_brownian deliberate_euler_ancestral_bug image mask action inpaint_strength
disabled_original_image color_correct req_type defry imageToImage vibeTransfer reference_image reference_strength reference_information_extracted
reference_image_multiple reference_strength_multiple reference_information_extracted_multiple use_v4_vibe director_reference_images_cached
director_reference_images director_reference_descriptions director_reference_strength_values director_reference_secondary_strength_values
director_reference_information_extracted tag_hint_transparent_background use_upscale_credits source_width source_height editor_state
layout regions shift skip_layer cfg num_inference_steps uncond_skip_layers ref_boost grounding_px guidance guidance_scale aspect_ratio image_size images
source_image source_image_name source_image_mime_type`.split(/\s+/));

function checkId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('gallery.errors.invalidData');
}

async function openWorkDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    let blocked = false;
    // 与旧图库数据库独立，回退旧前端仍能正常打开图库。
    const request = indexedDB.open('novelai-work-versions', 1);
    request.onupgradeneeded = () => {
      for (const name of Object.keys(folders)) request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onerror = () => { database = null; reject(request.error); };
    request.onblocked = () => { blocked = true; database = null; reject(new Error('gallery.errors.databaseBlocked')); };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
  });
  return database;
}

async function readRecords(target, name, id) {
  if (id !== undefined) checkId(id);
  if (target.mode === 'memory') {
    const records = target.records[name];
    return structuredClone(id === undefined ? [...records.values()] : records.get(id));
  }
  if (target.mode === 'browser') {
    const db = await openWorkDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readonly');
      const request = id === undefined ? tx.objectStore(name).getAll() : tx.objectStore(name).get(id);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
  }
  let directory;
  try { directory = await target.directory.getDirectoryHandle(folders[name]); }
  catch (error) { if (error.name === 'NotFoundError') return id === undefined ? [] : null; throw error; }
  if (id !== undefined) {
    try { return JSON.parse(await (await (await directory.getFileHandle(`${id}.json`)).getFile()).text()); }
    catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
  }
  const result = [];
  for await (const file of directory.values()) {
    if (file.kind === 'file' && /^[a-zA-Z0-9_-]+\.json$/.test(file.name)) result.push(JSON.parse(await (await file.getFile()).text()));
  }
  return result;
}

async function writeFile(directory, name, content) {
  const file = await directory.getFileHandle(name, { create: true });
  const stream = await file.createWritable();
  try { await stream.write(content); await stream.close(); }
  catch (error) { await stream.abort().catch(() => {}); throw error; }
}

async function saveRecords(target, records) {
  if (target.mode === 'memory') {
    for (const [name, values] of Object.entries(records)) {
      for (const value of values) target.records[name].set(value.id, structuredClone(value));
    }
    return;
  }
  if (target.mode === 'browser') {
    const db = await openWorkDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(Object.keys(records), 'readwrite');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
      try {
        // 图片读取和缩略图转换均在事务前完成，避免异步任务让事务提前关闭。
        for (const [name, values] of Object.entries(records)) for (const value of values) tx.objectStore(name).put(value);
      } catch (error) { tx.abort(); reject(error); }
    });
    return;
  }
  // 作品索引最后落盘；未成功保存的版本不会出现在蓝图中。
  for (const name of ['workAssets', 'workVersions', 'works']) {
    if (!records[name]?.length) continue;
    const directory = await target.directory.getDirectoryHandle(folders[name], { create: true });
    for (const value of records[name]) {
      checkId(value.id);
      if (name === 'workAssets') {
        if (!imageTypes[value.extension]) throw new Error('gallery.errors.invalidData');
        await writeFile(directory, `${value.id}.${value.extension}`, value.blob);
        await writeFile(directory, `${value.id}.thumb.webp`, value.thumbnail);
      } else await writeFile(directory, `${value.id}.json`, JSON.stringify(value));
    }
  }
}

async function readAsset(target, image, thumbnailOnly = false) {
  checkId(image.asset_id);
  if (!imageTypes[image.extension]) throw new Error('gallery.errors.invalidData');
  if (target.mode === 'browser' || target.mode === 'memory') {
    const asset = await readRecords(target, 'workAssets', image.asset_id);
    if (!asset) throw new Error('gallery.errors.missingImage');
    return asset;
  }
  const directory = await target.directory.getDirectoryHandle(folders.workAssets);
  const thumbnail = await (await directory.getFileHandle(`${image.asset_id}.thumb.webp`)).getFile();
  const result = { id: image.asset_id, extension: image.extension, thumbnail: new Blob([thumbnail], { type: 'image/webp' }) };
  if (!thumbnailOnly) {
    const blob = await (await directory.getFileHandle(`${image.asset_id}.${image.extension}`)).getFile();
    result.blob = new Blob([blob], { type: imageTypes[image.extension] });
  }
  return result;
}

async function dataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function presentVersion(version, target) {
  return { ...version, images: await Promise.all(version.images.map(async (image) => {
    const asset = await readAsset(target, image, true);
    // 蓝图只需要缩略图，原图由用户点击后读取，避免一次编码整部作品的图片。
    return { ...image, available: true, thumbnail_url: await dataUrl(asset.thumbnail) };
  })) };
}

async function requireWork(target, id) {
  const work = await readRecords(target, 'works', id);
  if (!work || work.id !== id) throw new Error('gallery.errors.missingWork');
  return work;
}

async function requireVersion(target, work, id) {
  if (!work.version_ids.includes(id)) throw new Error('gallery.errors.missingWork');
  const version = await readRecords(target, 'workVersions', id);
  if (!version || version.work_id !== work.id || version.id !== id) throw new Error('gallery.errors.missingWork');
  return version;
}

function serializeWrite(target, operation) {
  if (target.mode === 'memory') {
    const pending = target.writes.then(operation);
    target.writes = pending.catch(() => {});
    return pending;
  }
  if (!globalThis.navigator?.locks) throw new Error('gallery.errors.writeConflict');
  return navigator.locks.request('novelai-work-versions-write', operation);
}

/**
 * 只保留可恢复的生成参数，递归去除账号凭据和临时鉴权字段。
 * @param {object} parameters 请求参数与完整 editor_state。
 * @returns {object} 与输入完全独立的可持久化快照。
 */
export function safeWorkVersionParameters(parameters) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('gallery.errors.invalidData');
  return JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(parameters).filter(([key]) => snapshotFields.has(key))),
    (key, value) => /token|secret|password|authorization|cookie|api.?key|access.?key/i.test(key) ? undefined : value));
}

async function commitVersion(target, work, body) {
  const parentId = body.parent_id || work.latest_version_id;
  const parent = parentId ? await requireVersion(target, work, parentId) : null;
  const restored = body.operation === 'restore' ? await requireVersion(target, work, body.restore_version_id || parentId) : null;
  const imageIds = [...new Set(body.image_ids || [])];
  const inputs = [...(body.images || [])];
  if (imageIds.length + inputs.length > 30 || typeof (body.message ?? '') !== 'string' || (body.message || '').length > 2000
    || typeof (body.operation ?? 'commit') !== 'string' || (body.operation || 'commit').length > 50) throw new Error('gallery.errors.invalidData');
  if (!parent && !imageIds.length && !inputs.length) throw new Error('gallery.errors.firstVersionImage');
  for (const id of imageIds) {
    const entry = await getGalleryEntry(id, target);
    if (entry.trashed_at) throw new Error('gallery.errors.missingImage');
    inputs.push({ ...entry, blob: await getGalleryBlob(entry, false, target), thumbnail: await getGalleryBlob(entry, true, target) });
  }
  const parameters = safeWorkVersionParameters(restored?.parameters || body.parameters || parent?.parameters || inputs[0]?.parameters || {});
  const assets = [];
  const images = restored ? structuredClone(restored.images) : [];
  if (!restored) for (const input of inputs) {
    const extension = input.extension || Object.keys(imageTypes).find((key) => imageTypes[key] === input.blob?.type);
    if (!(input.blob instanceof Blob) || !(input.thumbnail instanceof Blob) || !imageTypes[extension]
      || input.blob.size > 32 * 1024 * 1024 || !Number.isFinite(input.width) || input.width <= 0
      || !Number.isFinite(input.height) || input.height <= 0) throw new Error('gallery.errors.imageType');
    const asset = { id: createClientId(), extension, blob: input.blob, thumbnail: input.thumbnail };
    assets.push(asset);
    images.push({ id: input.id || asset.id, asset_id: asset.id, extension, source: input.source || 'outputs', filename: input.filename || `image.${extension}`,
      title: input.title || '', width: input.width, height: input.height, created_at: input.created_at || Date.now() });
  }
  const now = Date.now();
  const version = { id: createClientId(), work_id: work.id, parent_id: parent?.id || null, number: work.version_count + 1,
    message: body.message || '', operation: body.operation || 'commit', created_at: now, parameters, images };
  const next = { ...work, updated_at: now, latest_version_id: version.id, version_count: version.number, version_ids: [...work.version_ids, version.id] };
  if (images.length) next.thumbnail_url = await dataUrl(assets[0]?.thumbnail || (await readAsset(target, images[0], true)).thumbnail);
  await saveRecords(target, { works: [next], workVersions: [version], ...(assets.length ? { workAssets: assets } : {}) });
  if (target.mode !== 'memory') window.dispatchEvent(new Event(WORK_VERSIONS_CHANGED));
  return { work: next, version: await presentVersion(version, target) };
}

/**
 * 按最近修改时间读取作品摘要；封面只加载缩略图。
 * @param {object} [target] 固定的图库存储目标。
 * @returns {Promise<object>} works 作品列表。
 */
export async function getWorks(target) {
  const storage = target || await getGalleryStorageTarget();
  const works = await readRecords(storage, 'works');
  return { works: works.sort((a, b) => b.updated_at - a.updated_at) };
}

/**
 * 新建空作品，或把选中的图库图片保存为 V1。
 * @param {object} body 作品 title、可选 image_ids、images 与 parameters。
 * @param {object} [target] 固定的图库存储目标。
 * @returns {Promise<object>} work 与可选 version。
 */
export async function createWork(body, target) {
  const storage = target || await getGalleryStorageTarget();
  if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) throw new Error('gallery.errors.invalidData');
  return serializeWrite(storage, async () => {
    const now = Date.now();
    const work = { id: createClientId(), title: body.title.trim(), created_at: now, updated_at: now, latest_version_id: null,
      version_count: 0, version_ids: [], thumbnail_url: null, blueprint: { positions: {}, edge_notes: {}, hidden_node_ids: [], groups: [] } };
    if (body.image_ids?.length || body.images?.length) return commitVersion(storage, work, body);
    await saveRecords(storage, { works: [work] });
    if (storage.mode !== 'memory') window.dispatchEvent(new Event(WORK_VERSIONS_CHANGED));
    return { work, version: null };
  });
}

/**
 * 读取作品全部节点与蓝图，只加载独立快照的缩略图。
 * @param {string} id 作品 ID。
 * @param {object} [target] 固定的图库存储目标。
 * @returns {Promise<object>} work、versions 和 blueprint。
 */
export async function getWork(id, target) {
  const storage = target || await getGalleryStorageTarget();
  const work = await requireWork(storage, id);
  const versions = await Promise.all(work.version_ids.map(async (versionId) => presentVersion(await requireVersion(storage, work, versionId), storage)));
  return { work, versions, blueprint: work.blueprint };
}

/**
 * 从选定父节点新增图片或提示词版本，恢复操作也只新增节点。
 * @param {string} id 作品 ID。
 * @param {object} body parent_id、parameters、image_ids 或已准备的 images，以及说明和操作名。
 * @param {object} [target] 生成开始时固定的存储目标。
 * @returns {Promise<object>} 已保存的 work 与 version。
 */
export async function createWorkVersion(id, body, target) {
  const storage = target || await getGalleryStorageTarget();
  return serializeWrite(storage, async () => commitVersion(storage, await requireWork(storage, id), body));
}

/**
 * 读取一个节点，用于从图库进入作品或继续指定分支。
 * @param {string} id 作品 ID。
 * @param {string} versionId 节点 ID。
 * @param {object} [target] 固定存储目标。
 * @returns {Promise<object>} work 和 version。
 */
export async function getWorkVersion(id, versionId, target) {
  const storage = target || await getGalleryStorageTarget();
  const work = await requireWork(storage, id);
  return { work, version: await presentVersion(await requireVersion(storage, work, versionId), storage) };
}

/**
 * 用户查看原图时读取指定节点的独立图片，拒绝跨作品或跨节点访问资产。
 * @param {string} id 作品 ID。
 * @param {string} versionId 节点 ID。
 * @param {string} assetId 该节点包含的图片资产 ID。
 * @param {object} [target] 固定存储目标。
 * @returns {Promise<Blob>} 未进行 Base64 编码的原图字节。
 */
export async function getWorkVersionImage(id, versionId, assetId, target) {
  const storage = target || await getGalleryStorageTarget();
  const work = await requireWork(storage, id);
  const version = await requireVersion(storage, work, versionId);
  const image = version.images.find((item) => item.asset_id === assetId);
  if (!image) throw new Error('gallery.errors.missingImage');
  return (await readAsset(storage, image)).blob;
}

/**
 * 查找引用指定图库图片的作品；版本原图独立保存，图库删除不影响历史。
 * @param {string} imageId 图库图片 ID。
 * @param {object} [target] 固定存储目标。
 * @returns {Promise<object>} works 关联作品。
 */
export async function getImageVersions(imageId, target) {
  const storage = target || await getGalleryStorageTarget();
  const { works } = await getWorks(storage);
  const linked = [];
  for (const work of works) for (const id of work.version_ids) {
    const version = await requireVersion(storage, work, id);
    if (version.images.some((image) => image.id === imageId)) { linked.push(work); break; }
  }
  return { works: linked };
}

/**
 * 修改作品名称，保留全部不可变版本。
 * @param {string} id 作品 ID。
 * @param {object} body 新 title。
 * @param {object} [target] 固定存储目标。
 * @returns {Promise<object>} 更新后的 work。
 */
export async function updateWork(id, body, target) {
  if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) throw new Error('gallery.errors.invalidData');
  const storage = target || await getGalleryStorageTarget();
  return serializeWrite(storage, async () => {
    const work = { ...await requireWork(storage, id), title: body.title.trim(), updated_at: Date.now() };
    await saveRecords(storage, { works: [work] });
    if (storage.mode !== 'memory') window.dispatchEvent(new Event(WORK_VERSIONS_CHANGED));
    return { work };
  });
}

/**
 * 只修改节点说明，不允许修改已保存参数、图片或分支关系。
 * @param {string} id 作品 ID。
 * @param {string} versionId 节点 ID。
 * @param {object} body 只包含 message。
 * @param {object} [target] 固定存储目标。
 * @returns {Promise<object>} 更新后的 version。
 */
export async function updateWorkVersion(id, versionId, body, target) {
  if (Object.keys(body).length !== 1 || typeof body.message !== 'string' || body.message.length > 2000) throw new Error('gallery.errors.invalidData');
  const storage = target || await getGalleryStorageTarget();
  return serializeWrite(storage, async () => {
    const work = await requireWork(storage, id);
    const version = { ...await requireVersion(storage, work, versionId), message: body.message };
    await saveRecords(storage, { workVersions: [version] });
    if (storage.mode !== 'memory') window.dispatchEvent(new Event(WORK_VERSIONS_CHANGED));
    return { version: await presentVersion(version, storage) };
  });
}

/**
 * 保存蓝图布局、隐藏节点、连线说明和分组，不改变版本内容。
 * @param {string} id 作品 ID。
 * @param {object} blueprint 画布编辑后的布局。
 * @param {object} [target] 固定存储目标。
 * @returns {Promise<object>} 保存后的 blueprint。
 */
export async function updateWorkBlueprint(id, blueprint, target) {
  const storage = target || await getGalleryStorageTarget();
  return serializeWrite(storage, async () => {
    const work = await requireWork(storage, id);
    const next = structuredClone(blueprint);
    if (!next.positions || !next.edge_notes || !Array.isArray(next.hidden_node_ids) || !Array.isArray(next.groups)) throw new Error('gallery.errors.invalidData');
    await saveRecords(storage, { works: [{ ...work, blueprint: next }] });
    if (storage.mode !== 'memory') window.dispatchEvent(new Event(WORK_VERSIONS_CHANGED));
    return { blueprint: next };
  });
}

/**
 * 删除用户确认的作品与其独立快照，保留原图库和其他作品。
 * @param {Array<string>} ids 用户已确认删除的作品 ID，最多 100 个。
 * @param {object} [target] 固定存储目标。
 * @returns {Promise<object>} deleted_ids；目录清理失败时 cleanup_failed 为 true。
 */
export async function deleteWorks(ids, target) {
  const storage = target || await getGalleryStorageTarget();
  if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw new Error('gallery.errors.invalidData');
  return serializeWrite(storage, async () => {
    const workIds = [...new Set(ids)];
    const versions = [];
    for (const id of workIds) {
      const work = await requireWork(storage, id);
      for (const versionId of work.version_ids) versions.push(await requireVersion(storage, work, versionId));
    }
    const assets = new Map(versions.flatMap((version) => version.images.map((image) => [image.asset_id, image])));
    let cleanupFailed = false;
    if (storage.mode === 'memory') {
      for (const id of workIds) storage.records.works.delete(id);
      for (const version of versions) storage.records.workVersions.delete(version.id);
      for (const id of assets.keys()) storage.records.workAssets.delete(id);
    } else if (storage.mode === 'browser') {
      const db = await openWorkDatabase();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['works', 'workVersions', 'workAssets'], 'readwrite');
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        for (const id of workIds) tx.objectStore('works').delete(id);
        for (const version of versions) tx.objectStore('workVersions').delete(version.id);
        for (const id of assets.keys()) tx.objectStore('workAssets').delete(id);
      });
    } else {
      const directory = await storage.directory.getDirectoryHandle(folders.works);
      // 先移除作品入口；之后即使快照清理失败，也不会呈现缺图的历史。
      for (const id of workIds) await directory.removeEntry(`${id}.json`);
      const files = [
        ...versions.map((version) => [folders.workVersions, `${version.id}.json`]),
        ...[...assets.values()].flatMap((asset) => [[folders.workAssets, `${asset.asset_id}.${asset.extension}`], [folders.workAssets, `${asset.asset_id}.thumb.webp`]]),
      ];
      for (const [folder, name] of files) {
        try { await (await storage.directory.getDirectoryHandle(folder)).removeEntry(name); }
        catch (error) { if (error.name !== 'NotFoundError') cleanupFailed = true; }
      }
    }
    if (storage.mode !== 'memory') window.dispatchEvent(new Event(WORK_VERSIONS_CHANGED));
    return { deleted_ids: workIds, cleanup_failed: cleanupFailed };
  });
}

/**
 * 读取作品备份需要的原始索引、版本与图片字节，不包含临时展示地址。
 * @param {Array<string>|null} [ids] 选中的作品，null 表示全部。
 * @param {object} [target] 固定存储目标。
 * @returns {Promise<object>} works、versions、assets，assets 中包含 Blob。
 */
export async function exportWorkRecords(ids = null, target) {
  const storage = target || await getGalleryStorageTarget();
  return serializeWrite(storage, async () => {
    const all = await getWorks(storage);
    const works = all.works.filter((work) => !ids || ids.includes(work.id));
    const versions = [];
    const assets = new Map();
    for (const work of works) for (const id of work.version_ids) {
      const version = await requireVersion(storage, work, id);
      versions.push(version);
      for (const image of version.images) if (!assets.has(image.asset_id)) assets.set(image.asset_id, await readAsset(storage, image));
    }
    return { works, versions, assets: [...assets.values()] };
  });
}

/**
 * 导入备份并为每个作品、节点及图片重新分配 ID，永远不覆盖已有作品。
 * @param {object} records 作品备份的 works、versions、assets（图片为 Blob）。
 * @param {object} [target] 固定存储目标。
 * @param {object} [options] 旧站迁移可保存原站作品标识，用来去重。
 * @returns {Promise<object>} imported 数量及新 work_ids。
 */
export async function importWorkRecords(records, target, { migrationSource } = {}) {
  const storage = target || await getGalleryStorageTarget();
  if (!Array.isArray(records.works) || !Array.isArray(records.versions) || !Array.isArray(records.assets)
    || records.works.length > 1000 || records.versions.length > 10000 || records.assets.length > 10000) throw new Error('gallery.errors.archiveFormat');
  const workIds = new Map(); const versionIds = new Map(); const assetIds = new Map();
  for (const [items, ids] of [[records.works, workIds], [records.versions, versionIds], [records.assets, assetIds]]) for (const item of items) {
    checkId(item.id);
    if (ids.has(item.id)) throw new Error('gallery.errors.archiveFormat');
    ids.set(item.id, createClientId());
  }
  const assets = records.assets.map((asset) => {
    if (!imageTypes[asset.extension] || !(asset.blob instanceof Blob) || !(asset.thumbnail instanceof Blob)
      || asset.blob.size > 32 * 1024 * 1024 || asset.thumbnail.size > 4 * 1024 * 1024) throw new Error('gallery.errors.archiveFormat');
    return { id: assetIds.get(asset.id), extension: asset.extension, blob: new Blob([asset.blob], { type: imageTypes[asset.extension] }),
      thumbnail: new Blob([asset.thumbnail], { type: 'image/webp' }) };
  });
  const originalWorks = new Map(records.works.map((work) => [work.id, work]));
  const originalVersions = new Map(records.versions.map((version) => [version.id, version]));
  const assetsByOldId = new Map(records.assets.map((asset, index) => [asset.id, assets[index]]));
  const assetOwners = new Map();
  const versions = records.versions.map((version) => {
    const work = originalWorks.get(version.work_id);
    const parent = version.parent_id ? originalVersions.get(version.parent_id) : null;
    if (!work || !Array.isArray(work.version_ids) || !work.version_ids.includes(version.id)
      || !Number.isInteger(version.number) || version.number < 1 || !Number.isFinite(version.created_at)
      || typeof version.message !== 'string' || version.message.length > 2000 || typeof version.operation !== 'string'
      || (version.parent_id && (!parent || parent.work_id !== version.work_id || parent.number >= version.number))
      || !Array.isArray(version.images) || version.images.length > 30) throw new Error('gallery.errors.archiveFormat');
    return { id: versionIds.get(version.id), work_id: workIds.get(version.work_id), parent_id: version.parent_id ? versionIds.get(version.parent_id) : null,
      number: version.number, message: version.message, operation: version.operation, created_at: version.created_at,
      parameters: safeWorkVersionParameters(version.parameters), images: version.images.map((image) => {
        const asset = assetsByOldId.get(image.asset_id);
        if (!asset || asset.extension !== image.extension || !Number.isFinite(image.width) || image.width <= 0
          || !Number.isFinite(image.height) || image.height <= 0 || typeof image.filename !== 'string' || typeof image.title !== 'string'
          || (assetOwners.has(image.asset_id) && assetOwners.get(image.asset_id) !== version.work_id)) throw new Error('gallery.errors.archiveFormat');
        // 每个作品独立拥有快照，删除一个作品不能破坏另一作品的图片。
        assetOwners.set(image.asset_id, version.work_id);
        // 导入的作品不假装关联本站图库条目；快照仍完整可看、可继续创作。
        return { id: asset.id, asset_id: asset.id, extension: asset.extension, source: 'outputs', filename: image.filename,
          title: image.title, width: image.width, height: image.height, created_at: image.created_at };
      }) };
  });
  const works = [];
  for (const work of records.works) {
    if (typeof work.title !== 'string' || !work.title.trim() || work.title.length > 200 || !Number.isFinite(work.created_at)
      || !Array.isArray(work.version_ids) || new Set(work.version_ids).size !== work.version_ids.length
      || work.version_count !== work.version_ids.length || work.latest_version_id !== (work.version_ids.at(-1) || null)
      || work.version_ids.some((id, index) => originalVersions.get(id)?.work_id !== work.id || originalVersions.get(id)?.number !== index + 1)) throw new Error('gallery.errors.archiveFormat');
    const source = work.blueprint;
    if (!source?.positions || !source.edge_notes || !Array.isArray(source.hidden_node_ids) || !Array.isArray(source.groups)
      || Object.values(source.positions).some((position) => !Number.isFinite(position?.x) || !Number.isFinite(position?.y))
      || Object.values(source.edge_notes).some((note) => typeof note !== 'string')
      || source.groups.some((group) => !Array.isArray(group.node_ids))) throw new Error('gallery.errors.archiveFormat');
    const blueprint = {
      positions: Object.fromEntries(Object.entries(source.positions).filter(([id]) => work.version_ids.includes(id)).map(([id, position]) => [versionIds.get(id), position])),
      edge_notes: Object.fromEntries(Object.entries(source.edge_notes).filter(([id]) => work.version_ids.includes(id)).map(([id, note]) => [versionIds.get(id), note])),
      hidden_node_ids: source.hidden_node_ids.filter((id) => work.version_ids.includes(id)).map((id) => versionIds.get(id)),
      groups: source.groups.map((group) => ({ ...group, id: createClientId(), node_ids: group.node_ids.filter((id) => work.version_ids.includes(id)).map((id) => versionIds.get(id)) })),
    };
    const cover = [...work.version_ids].reverse().map((id) => originalVersions.get(id).images[0]).find(Boolean);
    works.push({ id: workIds.get(work.id), title: work.title, created_at: work.created_at, updated_at: Date.now(), version_count: work.version_count,
      latest_version_id: work.latest_version_id ? versionIds.get(work.latest_version_id) : null, version_ids: work.version_ids.map((id) => versionIds.get(id)),
      thumbnail_url: cover ? await dataUrl(assetsByOldId.get(cover.asset_id).thumbnail) : null, blueprint,
      ...(migrationSource ? { migration_source: migrationSource } : {}) });
  }
  return serializeWrite(storage, async () => {
    await saveRecords(storage, { works, workVersions: versions, workAssets: assets });
    if (storage.mode !== 'memory') window.dispatchEvent(new Event(WORK_VERSIONS_CHANGED));
    return { imported: works.length, work_ids: works.map((work) => work.id) };
  });
}

const workVersionStorage = { getWorks, getWork, createWork, getWorkVersion, getWorkVersionImage, createWorkVersion, getImageVersions, updateWork, updateWorkVersion, updateWorkBlueprint, deleteWorks };
export default workVersionStorage;
