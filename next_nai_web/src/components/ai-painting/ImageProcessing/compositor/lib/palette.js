/** 从 RGBA 像素中提取代表色，透明像素不参与，半透明像素按覆盖面积计权。
 * @param {Uint8ClampedArray} pixels 取样图像的 RGBA 像素。
 * @param {number} count 期望颜色数量。
 * @returns {{color: string, percent: number}[]} 按像素占比降序排列的代表色。
 */
export function extractPalette(pixels, count = 8) {
  const histogram = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const weight = pixels[i + 3] / 255;
    const key = (pixels[i] >> 4) * 256 + (pixels[i + 1] >> 4) * 16 + (pixels[i + 2] >> 4);
    const bucket = histogram.get(key) || { rgb: [0, 0, 0], weight: 0 };
    for (let channel = 0; channel < 3; channel++) bucket.rgb[channel] += pixels[i + channel] * weight;
    bucket.weight += weight;
    histogram.set(key, bucket);
  }
  const buckets = [...histogram.values()].map((bucket) => ({
    rgb: bucket.rgb.map((value) => value / bucket.weight),
    weight: bucket.weight,
  })).sort((a, b) => b.weight - a.weight);
  if (!buckets.length) return [];

  const centers = [buckets[0].rgb];
  // 优先选择既有明显色差、又有实际面积的颜色，避免把所有名额分给同色阴影。
  while (centers.length < Math.min(count, buckets.length)) {
    let candidate = null, bestScore = 0;
    for (const bucket of buckets) {
      const distance = Math.min(...centers.map((center) =>
        bucket.rgb.reduce((sum, value, channel) => sum + (value - center[channel]) ** 2, 0),
      ));
      const score = distance * Math.sqrt(bucket.weight);
      if (score > bestScore) {
        bestScore = score;
        candidate = bucket.rgb;
      }
    }
    if (!candidate) break;
    centers.push(candidate);
  }

  let groups;
  for (let pass = 0; pass < 10; pass++) {
    groups = centers.map(() => ({ rgb: [0, 0, 0], weight: 0 }));
    for (const bucket of buckets) {
      let closest = 0, shortest = Infinity;
      centers.forEach((center, index) => {
        const distance = bucket.rgb.reduce((sum, value, channel) => sum + (value - center[channel]) ** 2, 0);
        if (distance < shortest) {
          shortest = distance;
          closest = index;
        }
      });
      const group = groups[closest];
      group.weight += bucket.weight;
      bucket.rgb.forEach((value, channel) => { group.rgb[channel] += value * bucket.weight; });
    }
    groups.forEach((group, index) => {
      if (group.weight) centers[index] = group.rgb.map((value) => value / group.weight);
    });
  }
  const total = buckets.reduce((sum, bucket) => sum + bucket.weight, 0);
  const colors = new Map();
  groups.forEach((group, index) => {
    if (!group.weight) return;
    const color = `#${centers[index].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
    colors.set(color, (colors.get(color) || 0) + group.weight);
  });
  return [...colors].sort((a, b) => b[1] - a[1]).map(([color, weight]) => ({
    color,
    percent: Math.round(weight / total * 1000) / 10,
  }));
}
