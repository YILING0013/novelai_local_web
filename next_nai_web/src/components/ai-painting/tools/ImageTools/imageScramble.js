// 曲线分割规则源自 Jakub Červený 的 Gilbert 算法（BSD-2-Clause），见 public/vendor/gilbert.LICENSE.txt。
/**
 * 按小番茄工具的取整和方向生成 Gilbert 曲线。
 * @param {number} width 图像宽度，单位为像素。
 * @param {number} height 图像高度，单位为像素。
 * @returns {Uint32Array} 曲线上各点对应的行优先像素索引。
 */
export function gilbertCurve(width, height) {
  const curve = new Uint32Array(width * height);
  let index = 0;

  function fill(x, y, ax, ay, bx, by) {
    const along = Math.abs(ax + ay);
    const across = Math.abs(bx + by);
    const dx = Math.sign(ax);
    const dy = Math.sign(ay);
    const ex = Math.sign(bx);
    const ey = Math.sign(by);
    if (across === 1 || along === 1) {
      const count = Math.max(along, across);
      const step = across === 1 ? dx + dy * width : ex + ey * width;
      let pixel = x + y * width;
      for (let i = 0; i < count; i++, pixel += step) curve[index++] = pixel;
      return;
    }

    // 负方向也向下取整，奇数尺寸时才能与参考工具使用同一路径。
    let halfAx = Math.floor(ax / 2), halfAy = Math.floor(ay / 2);
    let halfBx = Math.floor(bx / 2), halfBy = Math.floor(by / 2);
    if (2 * along > 3 * across) {
      if (along > 2 && Math.abs(halfAx + halfAy) % 2) {
        halfAx += dx;
        halfAy += dy;
      }
      fill(x, y, halfAx, halfAy, bx, by);
      fill(x + halfAx, y + halfAy, ax - halfAx, ay - halfAy, bx, by);
      return;
    }
    if (across > 2 && Math.abs(halfBx + halfBy) % 2) {
      halfBx += ex;
      halfBy += ey;
    }
    fill(x, y, halfBx, halfBy, halfAx, halfAy);
    fill(x + halfBx, y + halfBy, ax, ay, bx - halfBx, by - halfBy);
    fill(x + ax - dx + halfBx - ex, y + ay - dy + halfBy - ey,
      -halfBx, -halfBy, halfAx - ax, halfAy - ay);
  }

  if (width >= height) fill(0, 0, width, 0, 0, height);
  else fill(0, 0, 0, height, width, 0);
  return curve;
}

const shiftLength = count => Math.round(((Math.sqrt(5) - 1) / 2) * count);

/**
 * 沿 Gilbert 曲线平移整组 RGBA 像素，保留尺寸、颜色和透明度。
 * @param {Uint8ClampedArray} pixels 行优先的 RGBA 像素。
 * @param {Uint32Array} curve 对应图像尺寸的 Gilbert 曲线。
 * @param {'scramble'|'unscramble'} direction 位移方向。
 * @returns {Uint8ClampedArray} 处理后的 RGBA 像素。
 */
export function scramblePixels(pixels, curve, direction) {
  const count = curve.length;
  const shift = shiftLength(count);
  const source = new Uint32Array(pixels.buffer, pixels.byteOffset, count);
  const result = new Uint32Array(count);
  let dest = direction === 'scramble' ? shift % count : (count - shift) % count;
  for (let i = 0; i < count; i++) {
    result[curve[dest]] = source[curve[i]];
    if (++dest === count) dest = 0;
  }
  return new Uint8ClampedArray(result.buffer);
}

/**
 * 比较网格边缘与格内的色差，并抽样检查双向位移是否恢复了像素邻接关系。
 * @param {Uint8ClampedArray} pixels 行优先的 RGBA 像素。
 * @param {number} width 图像宽度，单位为像素。
 * @param {number} height 图像高度，单位为像素。
 * @param {Uint32Array} curve 对应图像尺寸的 Gilbert 曲线。
 * @param {Uint32Array} curveIndices 每个行优先像素在曲线上的索引。
 * @returns {boolean} 图像是否呈现典型的混淆特征。
 */
export function looksScrambled(pixels, width, height, curve, curveIndices) {
  if (Math.min(width, height) < 16) return false;
  const count = curve.length;
  const stride = Math.max(1, Math.floor(Math.sqrt(count / 16000))) | 1;
  const difference = (a, b) => {
    a *= 4;
    b *= 4;
    return Math.min(192, Math.abs(pixels[a] - pixels[b]) + Math.abs(pixels[a + 1] - pixels[b + 1])
      + Math.abs(pixels[a + 2] - pixels[b + 2]) + Math.abs(pixels[a + 3] - pixels[b + 3]));
  };

  let edgeSum = 0;
  let samples = 0;
  for (let y = 0; y < height - 1; y += stride) {
    for (let x = 0; x < width - 1; x += stride) {
      const pixel = y * width + x;
      edgeSum += difference(pixel, pixel + 1) + difference(pixel, pixel + width);
      samples += 2;
    }
  }
  if (edgeSum < 2 * samples) return false;

  const shift = shiftLength(count);
  // 只计算候选位移后的抽样色差，识别时不生成候选图片，也不修改预览。
  for (const rounds of [-1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -7, 7, -8, 8]) {
    const offset = ((rounds * shift) % count + count) % count;
    let candidate = 0;
    for (let y = 0; y < height - 1; y += stride) {
      for (let x = 0; x < width - 1; x += stride) {
        const pixel = y * width + x;
        const center = curve[(curveIndices[pixel] + offset) % count];
        candidate += difference(center, curve[(curveIndices[pixel + 1] + offset) % count])
          + difference(center, curve[(curveIndices[pixel + width] + offset) % count]);
      }
    }
    if (candidate < 0.84 * edgeSum && edgeSum - candidate > 2 * samples) return true;
  }

  // 多次重排时，粗细两级格线仍可能同时比附近格内像素更突兀。
  let matchedScales = 0;
  for (const tile of [16, 32, 64, 128]) {
    if (tile * 4 > Math.min(width, height)) break;
    let acrossX = 0, insideX = 0, acrossY = 0, insideY = 0;
    for (let x = tile; x + tile / 2 < width; x += tile) {
      for (let y = 0; y < height; y += stride) {
        const pixel = y * width + x;
        acrossX += difference(pixel - 1, pixel);
        insideX += difference(pixel + tile / 2 - 1, pixel + tile / 2);
      }
    }
    for (let y = tile; y + tile / 2 < height; y += tile) {
      for (let x = 0; x < width; x += stride) {
        const pixel = y * width + x;
        acrossY += difference(pixel - width, pixel);
        insideY += difference(pixel + (tile / 2 - 1) * width, pixel + tile / 2 * width);
      }
    }
    if (acrossX > 1.38 * insideX && acrossY > 1.38 * insideY && ++matchedScales === 3) return true;
  }
  return false;
}
