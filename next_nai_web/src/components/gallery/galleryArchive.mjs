import JSZip from 'jszip';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { validateGalleryEntry, GALLERY_SOURCES } from './galleryStorage.mjs';
import apiClient from '@/utils/ApiClient';
import { fetchUrlAsBlob } from '@/utils/mediaAssets';

export const GALLERY_ARCHIVE_FORMAT = 'novelai-gallery';
export const GALLERY_ARCHIVE_VERSION = 1;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const imageTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };

async function checksum(blob) {
  return bytesToHex(sha256(new Uint8Array(await blob.arrayBuffer())));
}

async function listImages(source) {
  const entries = [];
  for (const trash of [false, true]) {
    let offset = 0;
    while (true) {
      const page = await apiClient.getGallery({ source, offset, limit: 100, trash });
      entries.push(...page.items);
      if (!page.has_more || !page.items.length) break;
      offset += page.items.length;
    }
  }
  return entries;
}

async function restoreImage(blob, entry, groupId) {
  const restoreId = 'archive_' + await checksum(new Blob([entry.id]));
  const body = new FormData();
  body.append('source', entry.source);
  body.append('files', blob, entry.filename);
  if (groupId) body.append('group_id', groupId);
  body.append('archive_entry', JSON.stringify({ ...entry, restore_id: restoreId }));
  const page = await apiClient.importGalleryImages(body);
  if (page.errors?.length || !page.items?.length) throw new Error(page.errors?.[0]?.error || 'gallery.errors.operation');
  if (entry.trashed_at && !page.items[0].trashed_at) {
    const result = await apiClient.batchGallery({ source: entry.source, ids: [page.items[0].id], action: 'trash' });
    if (result.errors?.length) throw new Error(result.errors[0].error);
  }
}
/**
 * 验证备份版本、索引与分组关联，拒绝未知格式和重复 ID。
 * @param {object} manifest ZIP 中解析出的索引清单。
 * @returns {object} 校验后的清单，无效时抛错。
 */
export function validateGalleryManifest(manifest) {
  if (manifest?.format !== GALLERY_ARCHIVE_FORMAT || manifest.version !== GALLERY_ARCHIVE_VERSION
    || !Array.isArray(manifest.entries) || manifest.entries.length > 10000 || !Array.isArray(manifest.groups)) {
    throw new Error('gallery.errors.archiveFormat');
  }
  const groups = new Map();
  for (const group of manifest.groups) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(group.id) || !GALLERY_SOURCES.includes(group.source)
      || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 100 || groups.has(group.id)) {
      throw new Error('gallery.errors.invalidData');
    }
    groups.set(group.id, group);
  }
  const ids = new Set();
  for (const entry of manifest.entries) {
    validateGalleryEntry(entry);
    if (ids.has(entry.id) || (entry.group_id && groups.get(entry.group_id)?.source !== entry.source)) throw new Error('gallery.errors.invalidData');
    ids.add(entry.id);
  }
  return manifest;
}

// 逐块解压并限定累计字节数，避免先把异常压缩包完整解压到内存。
async function readZipFile(file, limit, budget) {
  if (!file) throw new Error('gallery.errors.missingImage');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const stream = file.internalStream('uint8array');
    stream.on('data', (chunk) => {
      size += chunk.length;
      budget.bytes += chunk.length;
      if (size > limit || budget.bytes > MAX_ARCHIVE_BYTES) {
        stream.pause();
        reject(new Error('gallery.errors.archiveSize'));
        return;
      }
      chunks.push(chunk);
    }).on('error', reject).on('end', () => resolve(new Blob(chunks))).resume();
  });
}

/**
 * 导出指定画廊或所选图片；ZIP 包含原图与可恢复索引，包含回收站状态。
 * @param {string} source 要导出的画廊来源。
 * @param {Array<string>|null} ids 选中的图片 ID，null 表示整个画廊。
 * @param {Function} onProgress 接收已完成数和总数。
 * @returns {Promise<Blob>} 可下载或导入的 ZIP 文件。
 */
export async function exportGalleryArchive(source, ids, onProgress = () => {}) {
  const records = (await listImages(source)).filter(entry => !ids || ids.includes(entry.id));
  const { groups } = await apiClient.getGalleryGroups(source);
  const entries = [];
  const zip = new JSZip();
  let bytes = 0;
  for (const [index, row] of records.entries()) {
    const blob = await fetchUrlAsBlob(row.url);
    if (blob.size > MAX_IMAGE_BYTES || (bytes += blob.size) > MAX_ARCHIVE_BYTES) throw new Error('gallery.errors.archiveSize');
    const hash = await checksum(blob);
    const base = source + '-' + hash;
    const localHash = await checksum(new Blob([row.id]));
    const suffix = [localHash.slice(0, 8), localHash.slice(8, 12), '4' + localHash.slice(13, 16),
      '8' + localHash.slice(17, 20), localHash.slice(20, 32)].join('-');
    // 同一原图可有多条独立记录；单独导出某一条时也应得到相同标识。
    const id = base + '-' + suffix;
    const ext = Object.keys(imageTypes).find(key => imageTypes[key] === blob.type) || row.filename.split('.').pop().toLowerCase();
    const entry = { id, hash, source, extension: ext === 'jpeg' ? 'jpg' : ext, filename: row.filename, title: row.title || '',
      prompt: row.prompt || '', negative_prompt: row.negative_prompt || '', style_prompt: row.style_prompt || '', group_id: row.group_id || '',
      parameters: row.parameters || {}, width: row.width, height: row.height, size: blob.size, mime: blob.type,
      created_at: new Date(row.created_at).getTime(), updated_at: new Date(row.updated_at || row.created_at).getTime(),
      trashed_at: row.trashed_at ? new Date(row.trashed_at).getTime() : null, original_local_id: row.id };
    entries.push(entry);
    zip.file('images/' + id + '.' + entry.extension, await blob.arrayBuffer());
    onProgress(index + 1, records.length);
  }
  const manifest = { format: GALLERY_ARCHIVE_FORMAT, version: GALLERY_ARCHIVE_VERSION, exported_at: new Date().toISOString(), entries, groups };
  validateGalleryManifest(manifest);
  const manifestText = JSON.stringify(manifest, null, 2);
  const manifestBytes = new Blob([manifestText]).size;
  if (manifestBytes > 16 * 1024 * 1024) throw new Error('gallery.errors.archiveSize');
  zip.file('manifest.json', manifestText);
  const archive = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  if (archive.size > MAX_ARCHIVE_BYTES) throw new Error('gallery.errors.archiveSize');
  return archive;
}

/**
 * 导入本站备份或普通图片 ZIP；重复原图跳过，失败前已保存的条目可在重试时跳过。
 * @param {Blob} file 用户选择的 ZIP。
 * @param {string} source 普通图片 ZIP 的目标画廊；本站备份使用清单中的来源。
 * @param {Function} onProgress 接收新增、重复和总数。
 * @returns {Promise<object>} imported 新增数和 skipped 跳过数。
 */
export async function importGalleryArchive(file, source, onProgress = () => {}) {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('gallery.errors.archiveSize');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  if (files.length > 10001) throw new Error('gallery.errors.archiveSize');
  const budget = { bytes: 0 };
  const result = { imported: 0, skipped: 0 };
  if (!zip.file('manifest.json')) {
    const images = files.filter((entry) => imageTypes[entry.name.split('.').pop().toLowerCase()]);
    if (!images.length) throw new Error('gallery.errors.archiveFormat');
    const existingIds = new Set((await listImages(source)).map(row => row.id));
    for (const entry of images) {
      const blob = await readZipFile(entry, MAX_IMAGE_BYTES, budget);
      const type = imageTypes[entry.name.split('.').pop().toLowerCase()];
      const hash = await checksum(blob);
      const image = { id: source + '-' + hash, source, filename: entry.name.split('/').pop(), hash };
      const restoredId = 'archive_' + await checksum(new Blob([image.id]));
      if (existingIds.has(restoredId)) result.skipped++;
      else {
        await restoreImage(new Blob([blob], { type }), image, '');
        existingIds.add(restoredId);
        result.imported++;
      }
      onProgress({ ...result, total: images.length });
    }
    return result;
  }
  const manifest = validateGalleryManifest(JSON.parse(await (await readZipFile(zip.file('manifest.json'), 16 * 1024 * 1024, budget)).text()));
  // 文件完整性先检查，避免缺图备份在写入一半后才暴露结构错误。
  for (const entry of manifest.entries) {
    if (!zip.file(`images/${entry.id}.${entry.extension}`)) throw new Error('gallery.errors.missingImage');
  }
  const groupIds = new Map();
  for (const kind of new Set(manifest.groups.map(item => item.source))) {
    const { groups } = await apiClient.getGalleryGroups(kind);
    for (const group of manifest.groups.filter(item => item.source === kind)) {
      const existing = groups.find(item => item.name === group.name);
      const local = existing || await apiClient.createGalleryGroup({ source: kind, name: group.name });
      groupIds.set(group.id, local.id);
    }
  }
  const existing = new Map();
  for (const kind of new Set(manifest.entries.map(item => item.source))) {
    for (const row of await listImages(kind)) existing.set(row.id, row);
  }
  for (const entry of manifest.entries) {
    const content = await readZipFile(zip.file('images/' + entry.id + '.' + entry.extension), MAX_IMAGE_BYTES, budget);
    const blob = new Blob([content], { type: imageTypes[entry.extension] });
    if (await checksum(blob) !== entry.hash) throw new Error('gallery.errors.archiveChecksum');
    const restored = existing.get('archive_' + await checksum(new Blob([entry.id])));
    const original = existing.get(entry.original_local_id);
    if (restored || (original && original.source === entry.source && await checksum(await fetchUrlAsBlob(original.url)) === entry.hash)) {
      result.skipped++;
    } else {
      await restoreImage(blob, entry, groupIds.get(entry.group_id));
      result.imported++;
    }
    onProgress({ ...result, total: manifest.entries.length });
  }
  return result;
}
