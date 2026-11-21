import assert from 'node:assert/strict';
import test from 'node:test';
import { clearPreviewFileDrag, hasFileDrag, readDroppedFiles, writePreviewFileDrag } from './previewImageDragData.mjs';

test('页内 drop 丢失文件列表时只用当前拖拽的标识恢复原文件', () => {
  const types = new Map();
  const source = { setData: (type, value) => types.set(type, value) };
  const file = new File(['preview'], 'preview.png', { type: 'image/png' });
  const id = writePreviewFileDrag(source, file);
  const drop = { types: Array.from(types.keys()), files: [], getData: (type) => types.get(type) || '' };
  try {
    assert.equal(hasFileDrag(drop), true);
    assert.deepEqual(readDroppedFiles(drop), [file]);
    assert.deepEqual(readDroppedFiles({ ...drop, getData: () => 'unrelated-drag' }), []);
    assert.deepEqual(readDroppedFiles({ ...drop, types: ['Files'], files: [file], getData: () => '' }), [file]);
    clearPreviewFileDrag('unrelated-drag');
    assert.deepEqual(readDroppedFiles(drop), [file]);
  } finally {
    clearPreviewFileDrag(id);
  }
  assert.equal(hasFileDrag(drop), false);
  assert.deepEqual(readDroppedFiles(drop), []);
});
