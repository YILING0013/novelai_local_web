import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./maskBrush.js', import.meta.url), 'utf8');
const { createMask, createBrush, snapPoint, paintSegment, createMaskGrid, createOutpaintMaskGrid, createInpaintMaskGrid } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const path = (points, size = 8, mode = 'paint', shape = 'circle') => ({ type: 'path', points: points.map(([x, y]) => ({ x, y })), size, mode, shape });

test('65 档圆形及方形笔刷的实际格子覆盖与光标形状、标注直径相同', () => {
  for (const square of [false, true]) for (let diameter = 1; diameter <= 65; diameter += 1) {
    const brush = createBrush(diameter, square);
    const mask = createMask(1024, 1024);
    const center = snapPoint(516, 516, diameter);
    paintSegment(mask, center, center, brush, 1);
    assert.equal(mask.data.reduce((sum, value) => sum + value, 0), brush.offsets.length);
    const xs = brush.offsets.map(([x]) => x);
    const ys = brush.offsets.map(([, y]) => y);
    assert.equal(Math.max(...xs) - Math.min(...xs) + 1, diameter);
    assert.equal(Math.max(...ys) - Math.min(...ys) + 1, diameter);
    for (const [x, y] of brush.offsets) assert.equal(mask.data[(center.y + y) * mask.cols + center.x + x], 1);
  }
});

test('奇偶笔刷对齐规则与缩放无关，同一原图轨迹产生相同蒙版', () => {
  assert.deepEqual(snapPoint(7.99, 8, 1), { x: 0, y: 1 });
  assert.deepEqual(snapPoint(3.99, 4, 2), { x: 0, y: 1 });
  const points = [[17.25, 25.25], [163.25, 281.25], [623.25, 729.25]];
  const rect = { x: 0, y: 0, width: 1024, height: 768 };
  const expected = createMaskGrid([path(points, 40)], rect).data;
  for (const scale of [0.25, 0.625, 1, 2, 3.75, 16]) {
    const recovered = points.map(([x, y]) => [((x * scale - 213.5) + 213.5) / scale, ((y * scale + 157.75) - 157.75) / scale]);
    assert.deepEqual(createMaskGrid([path(recovered, 40)], rect).data, expected);
  }
});

test('快速拖动逐格补齐，重复涂抹保持二值；任意尺寸边缘补为完整格子', () => {
  const mask = createMask(1001, 703);
  assert.deepEqual([mask.width, mask.height], [1008, 704]);
  const brush = createBrush(1, false);
  for (let pass = 0; pass < 2; pass += 1) paintSegment(mask, { x: 0, y: 0 }, { x: 87, y: 87 }, brush, 1);
  assert.equal(mask.data.reduce((sum, value) => sum + value, 0), 88);
  for (let i = 0; i < 88; i += 1) assert.equal(mask.data[i * mask.cols + i], 1);
  for (let y = 0; y < mask.rows; y += 1) paintSegment(mask, { x: 0, y }, { x: mask.cols - 1, y }, brush, 1);
  assert.ok(mask.data.every((value) => value === 1));
  paintSegment(mask, { x: 0, y: 0 }, { x: 0, y: 0 }, createBrush(4, true), 0);
  assert.equal(mask.data.reduce((sum, value) => sum + value, 0), mask.data.length - 4);
  assert.equal(mask.data[mask.cols - 1], 1);
});

test('显示和导出的网格固定于原图，裁剪及负坐标不改变落点，擦除保留覆盖记录', () => {
  const strokes = [path([[-16, -8], [64, -8]]), path([[8, -8]], 8, 'erase')];
  const grid = createMaskGrid(strokes, { x: -8, y: -8, width: 40, height: 8 });
  assert.deepEqual([grid.x, grid.y, grid.width, grid.height], [-8, -8, 40, 8]);
  assert.deepEqual(Array.from(grid.data), [1, 1, 0, 1, 1]);
  assert.deepEqual(Array.from(grid.touched), [1, 1, 1, 1, 1]);
  const erased = createMaskGrid([path([[16, 16]], 16, 'erase', 'square')], { x: 0, y: 0, width: 64, height: 64 });
  assert.equal(erased.data.reduce((sum, value) => sum + value, 0), 0);
  assert.equal(erased.touched.reduce((sum, value) => sum + value, 0), 4);
});

test('区外矩形不会写入相邻行；没有笔迹时不分配巨大空白画布', () => {
  const strokes = [
    { type: 'rect', mode: 'paint', rect: { x: -16, y: -16, width: 32, height: 32 } },
    { type: 'rect', mode: 'erase', rect: { x: -100, y: -8, width: 8, height: 24 } },
    { type: 'rect', mode: 'paint', rect: { x: 104, y: 0, width: 8, height: 24 } },
  ];
  const grid = createMaskGrid(strokes, { x: -16, y: -16, width: 32, height: 32 });
  assert.equal(grid.data.reduce((sum, value) => sum + value, 0), 16);
  assert.equal(createMaskGrid([], { x: 0, y: 0, width: 20000, height: 20000 }).data.length, 0);
});

function imageWithAlpha(width, height, alphaAt) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data[(y * width + x) * 4 + 3] = alphaAt(x, y);
  }
  return { width, height, data };
}

test('317px 原图向右扩图时，接缝所在的整格和指定重叠区域都能重绘', () => {
  const image = imageWithAlpha(384, 16, (x) => x < 317 ? 255 : 0);
  for (const [radius, firstMaskedX] of [[0, 312], [3, 312], [8, 304]]) {
    const grid = createOutpaintMaskGrid(image, radius);
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        assert.equal(grid.data[row * grid.cols + col], Number(col * 8 >= firstMaskedX));
      }
    }
  }
});

test('纯手绘和混合扩图缩小到四分之一时，共用输出格的涂抹与擦除按最后一笔生效', () => {
  const worldRect = { x: -72.5, y: -40.5, width: 512, height: 512 };
  const paint = path([[-4.25, -3.5]]);
  const erase = path([[6.75, -3.5]], 8, 'erase');
  for (const contentWidth of [120, 128]) {
    const image = imageWithAlpha(128, 128, (x) => x < contentWidth ? 254 : 0);
    for (const [strokes, expectedCell] of [[[paint], 1], [[paint, erase], 0], [[paint, erase, paint], 1]]) {
      const mask = createInpaintMaskGrid(image, 0, strokes, worldRect);
      const expected = new Uint8Array(16 * 16);
      if (contentWidth === 120) {
        for (let row = 0; row < 16; row += 1) expected[row * 16 + 15] = 1;
      }
      // 原图第 -1 和第 0 列都映射到输出格 (2, 1)。
      expected[16 + 2] = expectedCell;
      assert.deepEqual(mask.data, expected);
    }
  }
});

test('单格笔迹随捕获原点对齐输出网格，原尺寸、偏移和大幅缩小时均覆盖完整格', () => {
  const image = imageWithAlpha(128, 128, () => 255);
  const cases = [
    [{ x: 0, y: 0, width: 128, height: 128 }, [65, 65], [8 * 16 + 8]],
    [{ x: 3.25, y: 4.75, width: 128, height: 128 }, [65, 65], [7 * 16 + 7, 7 * 16 + 8, 8 * 16 + 7, 8 * 16 + 8]],
    [{ x: 0.25, y: 0.5, width: 2016, height: 2016 }, [1, 1], [0]],
  ];
  for (const [worldRect, point, selected] of cases) {
    const grid = createInpaintMaskGrid(image, 0, [path([point])], worldRect);
    const expected = new Uint8Array(16 * 16);
    for (const index of selected) expected[index] = 1;
    assert.deepEqual([grid.x, grid.y, grid.cols, grid.rows], [0, 0, 16, 16]);
    assert.deepEqual(grid.data, expected);
  }
});

test('四边和内部透明孔按像素圆形扩展后覆盖整格，半透明原画和越界区域不触发扩图', () => {
  const holes = [[0, 9], [36, 26], [18, 0], [28, 34], [16, 16], [17, 16]];
  const image = imageWithAlpha(37, 35, (x, y) => {
    if (holes.some(([hx, hy]) => hx === x && hy === y)) return 0;
    return x < 8 ? 1 : 255;
  });
  for (const radius of [0, 3, 8]) {
    const grid = createOutpaintMaskGrid(image, radius);
    const expected = new Uint8Array(5 * 5);
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (holes.some(([hx, hy]) => (x - hx) ** 2 + (y - hy) ** 2 <= radius ** 2)) {
          expected[Math.floor(y / 8) * 5 + Math.floor(x / 8)] = 1;
        }
      }
    }
    assert.deepEqual([grid.cols, grid.rows], [5, 5]);
    assert.deepEqual(grid.data, expected, `扩展半径 ${radius}px`);
  }
});
