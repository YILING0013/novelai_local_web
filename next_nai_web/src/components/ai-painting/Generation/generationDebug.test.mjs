import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeGenerationParameters } from './generationDebug.mjs';

test('调试导出保留结构和图片长度，截断文本、图片及凭据', () => {
  const image = 'A'.repeat(32) + 'B'.repeat(100) + 'C'.repeat(32);
  const prompt = 'a'.repeat(100) + 'exclude-middle' + 'z'.repeat(100);
  const value = summarizeGenerationParameters({
    model: 'nai-diffusion-4-5-full', width: 1216, seed: 42,
    positivePrompt: prompt, turnstile_token: 'private-token', debugCode: 'private-code',
    imageToImage: { image: 'data:image/png;base64,' + image, noise: 0.1 },
    reference_image_multiple: [image, 'aGk='],
    vibeTransfer: { images: ['aGk='] },
    headers: { Authorization: 'private-header' },
    originalUrl: 'https://example.test/image.jpg?access_token=private-url',
    originalFile: new Blob([new Uint8Array(8)], { type: 'image/png' }),
  });
  const body = JSON.parse(JSON.stringify(value));
  assert.equal(body.model, 'nai-diffusion-4-5-full');
  assert.equal(body.width, 1216);
  assert.equal(body.seed, 42);
  assert.equal(body.imageToImage.noise, 0.1);
  assert.deepEqual(body.positivePrompt, { length: prompt.length, head: prompt.slice(0, 80), tail: prompt.slice(-80) });
  assert.deepEqual(body.imageToImage.image, { base64_length: 164, head: 'A'.repeat(24), tail: 'C'.repeat(24) });
  assert.deepEqual(body.reference_image_multiple[0], body.imageToImage.image);
  assert.deepEqual(body.reference_image_multiple[1], { base64_length: 4, head: 'a', tail: '=' });
  assert.deepEqual(body.vibeTransfer.images[0], body.reference_image_multiple[1]);
  assert.deepEqual(body.originalFile, { type: 'image/png', bytes: 8 });
  assert.deepEqual(body.originalUrl, { url_omitted: true });
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /private-|exclude-middle|BBBB/);
});

test('短图片、蒙版字段和混合大小写的数据 URL 都不导出完整内容', () => {
  const png = 'iVBORw0KGgo' + 'R'.repeat(65) + 'ABCD';
  const output = summarizeGenerationParameters({
    attachment: png,
    preview: 'DATA:image/png;BASE64,' + png,
    mask_data: 'QUJDRA==',
    image_bytes: 'R0lGODlh',
    reference_image_multiple_cached: ['d2Vidg==', { data: 'aGk=' }],
    model: 'nai-diffusion-4-5-full',
  });
  assert.deepEqual(output.attachment, { base64_length: 80, head: png.slice(0, 24), tail: png.slice(-24) });
  assert.deepEqual(output.preview, output.attachment);
  assert.deepEqual(output.mask_data, { base64_length: 8, head: 'QU', tail: '==' });
  assert.deepEqual(output.image_bytes, { base64_length: 8, head: 'R0', tail: 'lh' });
  assert.deepEqual(output.reference_image_multiple_cached[0], { base64_length: 8, head: 'd2', tail: '==' });
  assert.deepEqual(output.reference_image_multiple_cached[1].data, { base64_length: 4, head: 'a', tail: '=' });
  assert.equal(output.model, 'nai-diffusion-4-5-full');
});
