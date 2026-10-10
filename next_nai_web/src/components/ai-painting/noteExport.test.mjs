import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOTE_EXPORT_INVALID_RESPONSE,
  downloadNotesExport,
} from './noteExport.mjs';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

let appendedAnchor;
let createdBlob;
let revokedUrl;

test.beforeEach(() => {
  appendedAnchor = null;
  createdBlob = null;
  revokedUrl = null;

  globalThis.window = {};
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, 'a');
      return {
        href: '',
        download: '',
        clicked: false,
        click() {
          this.clicked = true;
        },
      };
    },
    body: {
      appendChild(anchor) {
        appendedAnchor = anchor;
      },
      removeChild(anchor) {
        assert.equal(anchor, appendedAnchor);
        appendedAnchor.removed = true;
      },
    },
  };
  URL.createObjectURL = (blob) => {
    createdBlob = blob;
    return 'blob:notes-export-test';
  };
  URL.revokeObjectURL = (url) => {
    revokedUrl = url;
  };
});

test.afterEach(() => {
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
  if (originalDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = originalDocument;
  }
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

test('笔记导出使用 UTF-8 JSON Blob 并在下载后回收 object URL', async () => {
  const notes = [{ title: '中文笔记', text_content1: '1girl' }];

  await downloadNotesExport({ texts: notes });

  assert.ok(createdBlob instanceof Blob);
  assert.equal(createdBlob.type, 'application/json;charset=utf-8');
  assert.equal(await createdBlob.text(), JSON.stringify(notes));
  assert.equal(appendedAnchor.href, 'blob:notes-export-test');
  assert.equal(appendedAnchor.download, 'notes_export.json');
  assert.equal(appendedAnchor.clicked, true);
  assert.equal(appendedAnchor.removed, true);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(revokedUrl, 'blob:notes-export-test');
});

test('笔记导出响应缺少 texts 数组时不创建下载', async () => {
  for (const response of [null, {}, { texts: null }, { texts: {} }]) {
    await assert.rejects(
      downloadNotesExport(response),
      (error) => error.code === NOTE_EXPORT_INVALID_RESPONSE,
    );
  }

  assert.equal(createdBlob, null);
  assert.equal(appendedAnchor, null);
  assert.equal(revokedUrl, null);
});

test('有分组时导出完整分组树和笔记归属', async () => {
  const data = {
    texts: [{ title: '人物', group_id: 'child', character_tabs: [{ prompt: 'silver hair' }] }],
    groups: [{ id: 'parent', name: '角色', parent_id: null }, { id: 'child', name: '旅人', parent_id: 'parent' }],
  };
  await downloadNotesExport(data);
  assert.deepEqual(JSON.parse(await createdBlob.text()), data);
});
