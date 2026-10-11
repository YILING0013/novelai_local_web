import test from 'node:test';
import assert from 'node:assert/strict';
import { COMIC_BALLOON_PRESETS, comicElementMatrix, comicElementSvg, createComicElement } from './comicElements.mjs';

test('元素有独立编号和蒙版，修改新元素不影响默认蒙版或调用方数据', () => {
  const bounds = { x: 30, y: 40, width: 240, height: 160 };
  const first = createComicElement('bubble', bounds);
  const second = createComicElement('bubble', bounds);
  assert.notEqual(first.id, second.id);
  assert.equal(first.presetId, 'speech');
  assert.equal(first.fill, '#ffffff');
  first.mask[0].x = 0.25;
  assert.equal(second.mask[0].x, 0);
  const suppliedMask = [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }, { x: 0.9, y: 0.8 }];
  const sticker = createComicElement('sticker', bounds, { mask: suppliedMask, layerId: 'art', order: 3 });
  sticker.mask[0].y = 0.4;
  assert.equal(suppliedMask[0].y, 0.2);
  assert.equal(sticker.layerId, 'art');
  assert.equal(sticker.order, 3);
  assert.equal(sticker.fill, 'none');
  assert.deepEqual(bounds, { x: 30, y: 40, width: 240, height: 160 });
});

test('未变形、90度旋转和镜像按元素中心定位', () => {
  const element = createComicElement('sticker', { x: 40, y: 80, width: 200, height: 100 });
  assert.deepEqual(comicElementMatrix(element), [1, 0, 0, 1, 40, 80]);
  for (const [changes, expected] of [
    [{ rotation: 90 }, [0, 1, -1, 0, 190, 30]],
    [{ flipX: true }, [-1, 0, 0, 1, 240, 80]],
    [{ flipY: true }, [1, 0, 0, -1, 40, 180]],
    [{ flipX: true, flipY: true }, [-1, 0, 0, -1, 240, 180]],
  ]) {
    const matrix = comicElementMatrix({ ...element, ...changes });
    matrix.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-10));
  }
});

test('旋转、倾斜和双向镜像组合保持中心，四角能从页面坐标逆变换恢复', () => {
  const element = createComicElement('text', { x: -70, y: 130, width: 260, height: 95 });
  for (const rotation of [-125, 0, 42, 180]) {
    for (const flipX of [false, true]) {
      for (const flipY of [false, true]) {
        const [a, b, c, d, e, f] = comicElementMatrix({ ...element, rotation, skewX: 19, skewY: -13, flipX, flipY });
        const determinant = a * d - b * c;
        assert.ok(Math.abs(Math.abs(determinant) - 1) < 1e-10);
        assert.ok(Math.abs(a * 130 + c * 47.5 + e - 60) < 1e-10);
        assert.ok(Math.abs(b * 130 + d * 47.5 + f - 177.5) < 1e-10);
        for (const [x, y] of [[0, 0], [260, 0], [260, 95], [0, 95]]) {
          const pageX = a * x + c * y + e;
          const pageY = b * x + d * y + f;
          assert.ok(Math.abs((d * (pageX - e) - c * (pageY - f)) / determinant - x) < 1e-9);
          assert.ok(Math.abs((-b * (pageX - e) + a * (pageY - f)) / determinant - y) < 1e-9);
        }
      }
    }
  }
});

test('至少12种中英气泡预设输出不同轮廓，所有预设都有有效文字区域', () => {
  assert.ok(COMIC_BALLOON_PRESETS.length >= 12);
  assert.equal(new Set(COMIC_BALLOON_PRESETS.map(({ id }) => id)).size, COMIC_BALLOON_PRESETS.length);
  const outputs = COMIC_BALLOON_PRESETS.map((preset) => {
    assert.ok(preset.name.zh && preset.name.en);
    const [x, y, width, height] = preset.textBox;
    assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1);
    return comicElementSvg(createComicElement('bubble', { x: 0, y: 0, width: 320, height: 180 }, { presetId: preset.id }));
  });
  assert.equal(new Set(outputs).size, COMIC_BALLOON_PRESETS.length);
});

test('文字、字体和颜色中的XML符号只作为文本或属性值输出', () => {
  const svg = comicElementSvg(createComicElement('text', { x: 0, y: 0, width: 2000, height: 500 }, {
    text: '<script>alert("x")</script> & \'quoted\'',
    fontFamily: 'A" onload="alert(1)',
    color: '#123456" onload="alert(2)',
    fontSize: 18,
  }));
  assert.ok(!svg.includes('<script>'));
  assert.ok(!svg.includes(' onload="'));
  assert.ok(svg.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
  assert.ok(svg.includes('&amp; &apos;quoted&apos;'));
  assert.ok(svg.includes('font-family="A&quot; onload=&quot;alert(1)"'));
});

test('导出只接受内嵌图像，不把远程地址带进最终SVG', () => {
  const element = createComicElement('sticker', { x: 0, y: 0, width: 64, height: 64 }, { dataUrl: 'https://example.invalid/image.png' });
  assert.throws(() => comicElementSvg(element), /embedded image/);
  const svg = comicElementSvg({ ...element, dataUrl: 'data:image/png;base64,AA==' });
  assert.ok(svg.includes('href="data:image/png;base64,AA=="'));
});

test('竖排按高度自动换列、从右向左排列，并保留手动换列和组合字符', () => {
  const element = createComicElement('text', { x: 0, y: 0, width: 200, height: 100 }, {
    text: '天地玄黄宇宙洪荒\n日月', fontSize: 20, writingMode: 'vertical-rl', textAlign: 'left',
  });
  const svg = comicElementSvg(element);
  const columns = [...svg.matchAll(/<tspan x="([^"]+)" y="([^"]+)"[^>]*>(.*?)<\/tspan>/g)];
  assert.deepEqual(columns.map((column) => column[3]), ['天地玄黄', '宇宙洪荒', '日月']);
  assert.ok(Number(columns[0][1]) > Number(columns[1][1]) && Number(columns[1][1]) > Number(columns[2][1]));
  assert.ok(columns.every((column) => Number(column[2]) === 4));
  assert.match(svg, /writing-mode="vertical-rl"/);
  const bottom = comicElementSvg({ ...element, textAlign: 'right' });
  assert.match(bottom, /text-anchor="end"/);
  assert.match(bottom, /<tspan x="[^"]+" y="96"/);
  const combined = comicElementSvg({ ...element, height: 50, text: '甲👩‍🎨乙' });
  assert.deepEqual([...combined.matchAll(/<tspan[^>]*>(.*?)<\/tspan>/g)].map((match) => match[1]), ['甲👩‍🎨', '乙']);
});

test('旧文字保持横排，对白文字也可以使用竖排且不丢失文字样式', () => {
  const element = createComicElement('bubble', { x: 0, y: 0, width: 240, height: 300 }, { text: '漫画对白', color: '#123456' });
  const legacy = { ...element };
  delete legacy.writingMode;
  assert.equal(comicElementSvg(legacy), comicElementSvg(element));
  const vertical = comicElementSvg({ ...element, writingMode: 'vertical-rl' });
  assert.match(vertical, /writing-mode="vertical-rl"/);
  assert.match(vertical, /fill="#123456"/);
  assert.match(vertical, />漫画对白<\/tspan>/);
  assert.match(vertical, /<path /);
});
