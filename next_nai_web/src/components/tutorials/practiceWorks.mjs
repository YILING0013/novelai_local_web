import { createClientId } from '@/utils/browserCapabilities.mjs';
/** 为一轮教程保存作品与分支，所有读写都只作用于本轮样图。 */
export function createPracticeWorks() {
  const works = new Map();
  const versions = new Map();
  const store = {
    async getWorks() { return { works: [...works.values()].map(work => ({ ...work })) }; },
    async getWork(id) {
      const work = works.get(id);
      return { work: { ...work }, versions: structuredClone(versions.get(id)), blueprint: structuredClone(work.blueprint) };
    },
    async createWork(body) {
      const id = createClientId();
      const work = { id, title: body.title, version_count: 0, created_at: Date.now(),
        blueprint: { positions: {}, edge_notes: {}, hidden_node_ids: [], groups: [] } };
      works.set(id, work);
      versions.set(id, []);
      if (body.images?.length) return store.createWorkVersion(id, body);
      return { work: { ...work }, version: null };
    },
    async createWorkVersion(id, body) {
      const work = works.get(id);
      const list = versions.get(id);
      const source = list.find(v => v.id === body.restore_version_id);
      const images = source?.images ?? (body.images || []).map(image => ({
        id: image.id, url: image.src, thumbnail_url: image.src, width: image.width, height: image.height,
      }));
      const version = { id: createClientId(), work_id: id, parent_id: body.parent_id || null,
        number: list.length + 1, operation: body.operation || 'commit', message: body.message || '', created_at: Date.now(),
        parameters: structuredClone(source?.parameters ?? body.parameters ?? {}), images };
      list.push(version);
      Object.assign(work, { version_count: list.length, latest_version_id: version.id, updated_at: version.created_at });
      if (images.length) work.thumbnail_url = images[0].thumbnail_url;
      return { work: { ...work }, version: structuredClone(version) };
    },
    async updateWorkBlueprint(id, blueprint) { works.get(id).blueprint = structuredClone(blueprint); },
    async updateWork(id, patch) { return { work: { ...Object.assign(works.get(id), patch) } }; },
    async updateWorkVersion(id, versionId, patch) {
      return { version: { ...Object.assign(versions.get(id).find(v => v.id === versionId), patch) } };
    },
    async deleteWorks(ids) {
      for (const id of ids) { works.delete(id); versions.delete(id); }
      return { deleted_ids: ids };
    },
  };
  return store;
}
