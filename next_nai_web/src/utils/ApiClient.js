const CSRF_STORAGE_KEY = 'novelai-local.csrf-token';

function getApiBaseUrl() {
  return '/api';
}

function createApiError(response, data) {
  const code = data?.code || data?.error_code || data?.error || `HTTP_${response.status}`;
  return Object.assign(new Error(String(code)), {
    code,
    status: response.status,
    statusCode: response.status,
    category: data?.category,
    errorId: data?.error_id || data?.correlation_id || null,
    data,
  });
}

class ApiClient {
  constructor() {
    this.csrfToken = '';
  }

  readCsrfToken() {
    if (this.csrfToken) return this.csrfToken;
    if (typeof window === 'undefined') return '';
    this.csrfToken = window.sessionStorage.getItem(CSRF_STORAGE_KEY) || '';
    return this.csrfToken;
  }

  setCsrfToken(token) {
    this.csrfToken = String(token || '');
    if (typeof window === 'undefined') return;
    if (this.csrfToken) {
      window.sessionStorage.setItem(CSRF_STORAGE_KEY, this.csrfToken);
    } else {
      window.sessionStorage.removeItem(CSRF_STORAGE_KEY);
    }
  }

  async request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    const hasBody = options.body !== undefined;
    if (hasBody && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    if (!['GET', 'HEAD'].includes(method)) {
      const csrfToken = this.readCsrfToken();
      if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
    }

    let response;
    try {
      response = await fetch(`${getApiBaseUrl()}${path}`, {
        ...options,
        method,
        headers,
        credentials: 'include',
        body: hasBody && !(options.body instanceof FormData)
          ? JSON.stringify(options.body)
          : options.body,
      });
    } catch (cause) {
      throw Object.assign(new Error('NETWORK_ERROR'), {
        code: 'NETWORK_ERROR',
        category: 'network',
        cause,
      });
    }

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) throw createApiError(response, data);
    if (typeof window !== 'undefined' && Array.isArray(data?.images)) {
      if (data.images.some((image) => image.save_error)) window.dispatchEvent(new Event('novelai:image-save-failed'));
      if (data.images.some((image) => image.saved_file)) window.dispatchEvent(new Event('novelai:gallery-updated'));
    }
    return data;
  }

  async getSession() {
    const data = await this.request('/session');
    if (data.csrf_token) this.setCsrfToken(data.csrf_token);
    return data;
  }

  async loginWithPersistentToken(token) {
    const data = await this.request('/session/persistent-token', {
      method: 'POST',
      body: { token: String(token || '').trim() },
    });
    this.setCsrfToken(data.csrf_token);
    return data;
  }

  async loginWithPassword(email, password) {
    const data = await this.request('/session/password', {
      method: 'POST',
      body: { email: String(email || '').trim(), password },
    });
    this.setCsrfToken(data.csrf_token);
    return data;
  }

  async logout() {
    const result = await this.request('/session', { method: 'DELETE' });
    this.setCsrfToken('');
    return result;
  }

  async getAccount() {
    return this.request('/account');
  }

  async changePassword(currentPassword, newPassword) {
    const data = await this.request('/account/change-password', {
      method: 'POST',
      body: {
        current_password: currentPassword,
        new_password: newPassword,
        backup_confirmed: true,
      },
    });
    if (data.csrf_token) this.setCsrfToken(data.csrf_token);
    return data;
  }

  async changeEmail(currentPassword, newEmail) {
    const data = await this.request('/account/change-email', {
      method: 'POST',
      body: {
        current_password: currentPassword,
        new_email: String(newEmail || '').trim(),
        backup_confirmed: true,
      },
    });
    if (data.csrf_token) this.setCsrfToken(data.csrf_token);
    return data;
  }

  async getAccountRecovery() {
    return this.request('/account/recovery');
  }

  async resolveAccountRecovery(credentials) {
    const data = await this.request('/account/recovery/resolve', {
      method: 'POST',
      body: credentials,
    });
    if (data.csrf_token) this.setCsrfToken(data.csrf_token);
    return data;
  }

  async generateImage(requestBody) {
    return this.request('/images/generate', { method: 'POST', body: requestBody });
  }

  async cancelImageBatch(batchId, keepalive = false) {
    return this.request('/images/batch', {
      method: 'DELETE',
      body: batchId ? { batch_id: batchId } : {},
      keepalive,
    });
  }

  async encodeVibe(image, informationExtracted, model) {
    return this.request('/images/vibe', {
      method: 'POST',
      body: {
        image,
        information_extracted: informationExtracted,
        model,
      },
    });
  }

  async upscaleImage(body) {
    return this.request('/images/upscale', { method: 'POST', body });
  }

  async augmentImage(body) {
    return this.request('/images/augment', { method: 'POST', body });
  }

  /** 查询当前输入片段的中英文标签联想，支持取消过期请求。 */
  async getPrompt(prompt, { signal } = {}) {
    const searchParams = new URLSearchParams({ prompt: String(prompt || '').trim() });
    return this.request(`/suggest-tags?${searchParams.toString()}`, { signal });
  }

  /** 批量查询标签的中文释义，返回以规范化标签为键的 translations。 */
  async translatePromptTags(tags, { signal } = {}) {
    return this.request('/translate-tags', { method: 'POST', body: { tags }, signal });
  }

  /** 查询图片工具输出尺寸、预计 Anlas 和官方账户余额，不生成图片。 */
  async estimateImageTool(params, { signal } = {}) {
    return this.request('/image-tools/estimate', { method: 'POST', body: params, signal });
  }

  async getLocalSettings() {
    const response = await this.request('/local/settings');
    return response.settings || {};
  }

  async saveLocalSettings(settings) {
    const response = await this.request('/local/settings', {
      method: 'PUT',
      body: { settings },
    });
    return response.settings || {};
  }

  async getRandomPromptConfig() {
    const response = await this.request('/local/random-prompts');
    return response.random_prompts || {};
  }

  async saveRandomPromptConfig(randomPrompts) {
    const response = await this.request('/local/random-prompts', {
      method: 'PUT',
      body: { random_prompts: randomPrompts },
    });
    return response.random_prompts || randomPrompts;
  }

  async getTexts() {
    const response = await this.request('/local/notes');
    return { ...response, texts: response.notes || [] };
  }

  /** 分页读取参考图库或生成文件夹的缩略图索引。 */
  async getGallery(options = {}) {
    return this.request(`/local/gallery?${new URLSearchParams(options)}`);
  }

  /** 按 ID 读取一张本地图像的完整元数据。 */
  async getGalleryEntry(id) {
    return this.request(`/local/gallery/${encodeURIComponent(id)}`);
  }

  /** 浏览本机目录；空路径返回元数据导出的建议位置和磁盘根目录。 */
  async getLocalDirectories(path = '') {
    return this.request(`/local/directories?${new URLSearchParams({ path })}`);
  }

  /** 将多张图像上传到本机参考目录，后端读取内嵌元数据。 */
  async importGalleryImages(formData) {
    return this.request('/local/gallery/import', { method: 'POST', body: formData });
  }

  /** 保存图像的提示词、画风和分组等本地索引信息。 */
  async updateGalleryEntry(id, changes) {
    return this.request(`/local/gallery/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes });
  }

  /** 读取指定图库来源的分组。 */
  async getGalleryGroups(source) {
    return this.request(`/local/gallery/groups?${new URLSearchParams({ source })}`);
  }

  /** 创建本地虚拟分组。 */
  async createGalleryGroup(body) {
    return this.request('/local/gallery/groups', { method: 'POST', body });
  }

  /** 批量分组、回收、恢复或将编辑后的元数据另存为新图。 */
  async batchGallery(body) {
    return this.request('/local/gallery/batch', { method: 'POST', body });
  }

  /** 读取全部作品，包括没有图片的提示词作品。 */
  async getWorks() { return this.request('/local/works'); }

  /** 创建作品及首个不可变版本。 */
  async createWork(body) { return this.request('/local/works', { method: 'POST', body }); }

  /** 读取作品的完整父子版本记录。 */
  async getWork(id) { return this.request(`/local/works/${encodeURIComponent(id)}`); }

  /** 按作品与版本 ID 读取完整快照，避免经浏览器本地存储传递参考图片。 */
  async getWorkVersion(workId, versionId) { return this.request(`/local/works/${encodeURIComponent(workId)}/versions/${encodeURIComponent(versionId)}`); }

  /** 从指定父版本提交图片或提示词快照。 */
  async createWorkVersion(id, body) { return this.request(`/local/works/${encodeURIComponent(id)}/versions`, { method: 'POST', body }); }

  /** 修改作品标题，历史快照保持不变。 */
  async updateWork(id, body) { return this.request(`/local/works/${encodeURIComponent(id)}`, { method: 'PATCH', body }); }

  /** 保存蓝图布局、连线思路、路径折叠和分组，不改变生成快照。 */
  async updateWorkBlueprint(id, body) { return this.request(`/local/works/${encodeURIComponent(id)}/blueprint`, { method: 'PATCH', body }); }

  /** 查找图片参与的作品与版本。 */
  async getImageVersions(id) { return this.request(`/local/gallery/${encodeURIComponent(id)}/versions`); }

  /** 读取指定图库保存的动态筛选收藏。 */
  async getGalleryCollections(source) { return this.request(`/local/gallery/collections?${new URLSearchParams({ source })}`); }

  /** 保存动态收藏的名称与筛选条件。 */
  async createGalleryCollection(body) { return this.request('/local/gallery/collections', { method: 'POST', body }); }

  /** 仅删除动态收藏规则，不删除图片。 */
  async deleteGalleryCollection(id) { return this.request(`/local/gallery/collections/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  async saveTexts(title, positivePrompt, negativePrompt, imageUrl, characterTabs, groupId = null) {
    return this.request('/local/notes', {
      method: 'POST',
      body: {
        note: {
          title,
          text_content1: positivePrompt,
          text_content2: negativePrompt,
          image_url: imageUrl || '',
          character_tabs: characterTabs || [],
          group_id: groupId,
        },
      },
    });
  }

  async updateText(originalTitle, title, positivePrompt, negativePrompt, imageUrl, characterTabs, groupId = null) {
    return this.request('/local/notes', {
      method: 'PUT',
      body: {
        original_title: originalTitle,
        note: {
          title,
          text_content1: positivePrompt,
          text_content2: negativePrompt,
          image_url: imageUrl || '',
          character_tabs: characterTabs || [],
          group_id: groupId,
        },
      },
    });
  }

  async deleteText(title) {
    return this.request('/local/notes', {
      method: 'DELETE',
      body: { title },
    });
  }

  async exportTexts() {
    return this.getTexts();
  }

  /** 一次导入旧笔记数组或含分组的导出文件；冲突时整次导入失败。 */
  async importTexts(content) {
    return this.request('/local/notes/import', { method: 'POST', body: { content } });
  }

  /** 创建本地词条分组，data 包含名称和可选父分组。 */
  async createNoteGroup(data) {
    return this.request('/local/note-groups', { method: 'POST', body: data });
  }

  /** 按分组 ID 更新名称。 */
  async updateNoteGroup(id, data) {
    return this.request(`/local/note-groups/${encodeURIComponent(id)}`, { method: 'PUT', body: data });
  }

  /** 删除分组及子分组，词条移回未分组。 */
  async deleteNoteGroup(id) {
    return this.request(`/local/note-groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** 原子批量移动或删除选中的词条。 */
  async batchNotes(action, titles, groupId = null) {
    return this.request('/local/notes/batch', { method: 'POST', body: { action, titles, group_id: groupId } });
  }
}

const apiClient = new ApiClient();

export { ApiClient };
export default apiClient;
