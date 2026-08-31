import { isPaintingModelAllowed } from '@/components/ai-painting/utils/modelUtils';

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

  async getPrompt(prompt, model = null) {
    const searchParams = new URLSearchParams({
      prompt: String(prompt || '').trim(),
    });
    if (isPaintingModelAllowed(model)) searchParams.set('model', model);
    return this.request(`/images/tags?${searchParams.toString()}`);
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

  async saveTexts(title, positivePrompt, negativePrompt, imageUrl, characterTabs) {
    return this.request('/local/notes', {
      method: 'POST',
      body: {
        note: {
          title,
          text_content1: positivePrompt,
          text_content2: negativePrompt,
          image_url: imageUrl || '',
          character_tabs: characterTabs || [],
        },
      },
    });
  }

  async updateText(originalTitle, title, positivePrompt, negativePrompt, imageUrl, characterTabs) {
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

  async importTexts(notes) {
    for (const note of Array.isArray(notes) ? notes : []) {
      await this.request('/local/notes', {
        method: 'POST',
        body: { note },
      });
    }
    return { imported: true };
  }
}

const apiClient = new ApiClient();

export { ApiClient };
export default apiClient;
