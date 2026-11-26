import JSZip from 'jszip';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import apiClient from '@/utils/ApiClient';
import { fetchUrlAsBlob } from '@/utils/mediaAssets';
import { createClientId } from '@/utils/browserCapabilities.mjs';
import { createMemoryWorkVersionTarget, exportWorkRecords, importWorkRecords } from './workVersionStorage.mjs';

const FORMAT = 'novelai-work-versions';
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_MANIFEST = 32 * 1024 * 1024;

async function readFile(file, limit, budget) {
  if (!file) throw new Error('gallery.errors.archiveFormat');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const stream = file.internalStream('uint8array');
    stream.on('data', (chunk) => {
      size += chunk.length; budget.bytes += chunk.length;
      if (size > limit || budget.bytes > MAX_BYTES) {
        stream.pause(); reject(new Error('gallery.errors.archiveSize')); return;
      }
      chunks.push(chunk);
    }).on('error', reject).on('end', () => resolve(new Blob(chunks))).resume();
  });
}

async function checksum(blob) {
  return bytesToHex(sha256(new Uint8Array(await blob.arrayBuffer())));
}

/**
 * 导出所选作品的全部节点、分支、蓝图和原图快照，可跨浏览器或域名恢复。
 * @param {Array<string>|null} [ids] 选中作品 ID，null 表示全部作品。
 * @param {object} [target] 测试或长任务固定的存储目标。
 * @returns {Promise<Blob>} 独立作品 ZIP，不依赖原图库文件。
 */
export async function exportWorkArchive(ids = null, target) {
  let records;
  if (target) records = await exportWorkRecords(ids, target);
  else {
    records = { works: [], versions: [], assets: [] };
    const { works } = await apiClient.getWorks();
    for (const work of works.filter(item => !ids || ids.includes(item.id))) {
      const detail = await apiClient.getWork(work.id);
      const versions = [...detail.versions].sort((a, b) => a.number - b.number);
      records.works.push({ ...work, created_at: Date.parse(work.created_at), updated_at: Date.parse(work.updated_at),
        version_ids: versions.map(version => version.id), blueprint: detail.blueprint });
      const snapshots = new Map();
      for (const version of versions) {
        const images = [];
        for (const image of version.images) {
          if (!snapshots.has(image.asset_id)) {
            const blob = await fetchUrlAsBlob(image.url);
            // 原生和 Flask 的缩略图是 PNG，归档中的缩略图统一编码为 WebP。
            const preview = await createImageBitmap(await fetchUrlAsBlob(image.thumbnail_url));
            let thumbnail;
            try {
              const canvas = document.createElement('canvas');
              canvas.width = preview.width; canvas.height = preview.height;
              canvas.getContext('2d').drawImage(preview, 0, 0);
              thumbnail = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
            } finally { preview.close(); }
            if (!thumbnail) throw new Error('gallery.errors.imageType');
            const extension = ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png', 'image/gif': 'gif', 'image/bmp': 'bmp' })[blob.type] || image.filename.split('.').pop().toLowerCase().replace('jpeg', 'jpg');
            const asset = { id: createClientId(), extension, blob, thumbnail };
            snapshots.set(image.asset_id, asset); records.assets.push(asset);
          }
          const { id, extension } = snapshots.get(image.asset_id);
          images.push({ id, asset_id: id, extension, source: image.source, filename: image.filename, title: image.title || '',
            width: image.width, height: image.height, created_at: Date.parse(image.created_at) || Date.parse(version.created_at) });
        }
        records.versions.push({ ...version, created_at: Date.parse(version.created_at), images });
      }
    }
  }
  const zip = new JSZip();
  const assets = [];
  let bytes = 0;
  for (const asset of records.assets) {
    bytes += asset.blob.size + asset.thumbnail.size;
    if (bytes > MAX_BYTES) throw new Error('gallery.errors.archiveSize');
    assets.push({ id: asset.id, extension: asset.extension, checksum: await checksum(asset.blob), thumbnail_checksum: await checksum(asset.thumbnail) });
    zip.file(`assets/${asset.id}.${asset.extension}`, await asset.blob.arrayBuffer());
    zip.file(`assets/${asset.id}.thumb.webp`, await asset.thumbnail.arrayBuffer());
  }
  // 缩略图来自独立资产，清单不重复写入 Base64 封面。
  const works = records.works.map(({ thumbnail_url, ...work }) => work);
  const manifest = JSON.stringify({ format: FORMAT, version: 1, exported_at: new Date().toISOString(), works, versions: records.versions, assets });
  const manifestSize = new Blob([manifest]).size;
  if (manifestSize > MAX_MANIFEST || bytes + manifestSize > MAX_BYTES) throw new Error('gallery.errors.archiveSize');
  zip.file('manifest.json', manifest);
  const result = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  if (result.size > MAX_BYTES) throw new Error('gallery.errors.archiveSize');
  return result;
}

/**
 * 校验并恢复作品 ZIP，重新分配 ID，保留已有作品和图库原图。
 * @param {Blob} file 用户选中的作品备份文件。
 * @param {object} [target] 测试或长任务固定的存储目标。
 * @returns {Promise<object>} imported 数量和新 work_ids。
 */
export async function importWorkArchive(file, target) {
  const storage = target || createMemoryWorkVersionTarget();
  if (file.size > MAX_BYTES) throw new Error('gallery.errors.archiveSize');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  if (Object.keys(zip.files).length > 20002) throw new Error('gallery.errors.archiveSize');
  const budget = { bytes: 0 };
  const manifest = JSON.parse(await (await readFile(zip.file('manifest.json'), MAX_MANIFEST, budget)).text());
  if (manifest.format !== FORMAT || manifest.version !== 1 || !Array.isArray(manifest.assets) || manifest.assets.length > 10000) throw new Error('gallery.errors.archiveFormat');
  const assets = [];
  for (const asset of manifest.assets) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(asset.id) || !['png', 'jpg', 'webp', 'gif', 'bmp'].includes(asset.extension)
      || !/^[a-f0-9]{64}$/.test(asset.checksum) || !/^[a-f0-9]{64}$/.test(asset.thumbnail_checksum)) throw new Error('gallery.errors.archiveFormat');
    const blob = await readFile(zip.file(`assets/${asset.id}.${asset.extension}`), 32 * 1024 * 1024, budget);
    const thumbnail = await readFile(zip.file(`assets/${asset.id}.thumb.webp`), 4 * 1024 * 1024, budget);
    if (await checksum(blob) !== asset.checksum || await checksum(thumbnail) !== asset.thumbnail_checksum) throw new Error('gallery.errors.archiveChecksum');
    assets.push({ ...asset, blob, thumbnail });
  }
  const result = await importWorkRecords({ works: manifest.works, versions: manifest.versions, assets }, storage);
  if (target) return result;
  // 先在内存完成完整校验和 ID 重映射，再把快照逐张传入原生资料库，最后一次提交版本树。
  const records = await exportWorkRecords(null, storage);
  const assetIds = {};
  for (const asset of records.assets) {
    const body = new FormData();
    body.append('files', asset.blob, asset.id + '.' + asset.extension);
    const uploaded = await apiClient.request('/local/works/archive-assets', { method: 'POST', body });
    assetIds[asset.id] = uploaded.id;
  }
  const works = records.works.map(({ thumbnail_url, ...work }) => ({ ...work,
    created_at: new Date(work.created_at).toISOString(), updated_at: new Date(work.updated_at).toISOString() }));
  for (const version of records.versions) {
    version.created_at = new Date(version.created_at).toISOString();
    for (const image of version.images) image.created_at = new Date(image.created_at || version.created_at).toISOString();
  }
  return apiClient.request('/local/works/archive', { method: 'POST', body: { works, versions: records.versions, asset_ids: assetIds } });
}
