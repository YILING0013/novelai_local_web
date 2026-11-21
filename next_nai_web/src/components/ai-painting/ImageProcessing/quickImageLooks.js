import { ADJUSTMENT_RANGES } from './compositor/lib/model';

// 胶片组取材于 Kodak 的低饱和人像、暖调与高饱和风格描述，数值为本项目配方。
// https://www.kodakprofessional.com/sites/default/files/wysiwyg/film/KODAKPROFESSIONAL_Film_Brochure2018.pdf
export const imageLooks = {
  neutral: { group: 'allLooks', colors: ['#8b979f', '#d9ddd9'], values: {} },
  film: { group: 'filmLooks', colors: ['#a16b51', '#f1cf99'], values: { contrast: 8, saturation: -13, temperature: 16, shadows: 14, vignette: 13, gamma: 1.08 } },
  portrait: { group: 'filmLooks', colors: ['#b87979', '#f3d9bb'], values: { contrast: -9, saturation: -15, vibrance: 10, temperature: 9, tint: 5, highlights: -16, shadows: 12, blacks: 7 } },
  colorSlide: { group: 'filmLooks', colors: ['#b73e42', '#f6b550'], values: { contrast: 11, saturation: 23, vibrance: 18, temperature: 5, highlights: -12, sharpen: 14 } },
  fadedFilm: { group: 'filmLooks', colors: ['#646b59', '#d6c98d'], values: { contrast: -9, saturation: -28, temperature: 11, blacks: 22, highlights: -15, noise: 9, vignette: 15 } },
  monochrome: { group: 'filmLooks', colors: ['#4d5056', '#dedede'], values: { grayscale: 1, contrast: 15, shadows: 6 } },
  silver: { group: 'filmLooks', colors: ['#403f44', '#dfdfdf'], values: { grayscale: 1, contrast: 22, highlights: -10, blacks: -9, noise: 13, vignette: 16 } },
  matteCinema: { group: 'filmLooks', colors: ['#346a75', '#df9c6d'], values: { saturation: -13, contrast: 14, blacks: 8, shadows: 7, highlights: -13 }, grade: [[193, 35], [24, 8], [35, 23]] },
  clear: { group: 'illustrationLooks', colors: ['#529eab', '#eadfa8'], values: { contrast: 7, saturation: 7, vibrance: 15, sharpen: 16, highlights: -6 } },
  cool: { group: 'illustrationLooks', colors: ['#3b6189', '#bbd6ed'], values: { temperature: -25, saturation: -6, contrast: 8, highlights: -10 } },
  sakura: { group: 'illustrationLooks', colors: ['#9475a8', '#ffc4d5'], values: { saturation: -13, contrast: -13, tint: 13, shadows: 18, bloom: 16 }, grade: [[271, 23], [329, 9], [18, 15]] },
  blueHour: { group: 'illustrationLooks', colors: ['#34345f', '#7ab6d7'], values: { temperature: -22, tint: 9, highlights: -14, vignette: 13 }, grade: [[247, 33], [206, 15], [193, 13]] },
  dusk: { group: 'illustrationLooks', colors: ['#643468', '#f5ab72'], values: { contrast: 10, vibrance: 19, temperature: 13, shadows: 7, bloom: 12 }, grade: [[286, 25], [337, 9], [32, 32]] },
  jade: { group: 'illustrationLooks', colors: ['#327d6c', '#d1deb3'], values: { saturation: -14, tint: -13, exposure: 0.12, highlights: -8, blacks: 12 }, grade: [[164, 27], [140, 9], [58, 19]] },
  ink: { group: 'illustrationLooks', colors: ['#263b50', '#dbe2e9'], values: { saturation: -90, contrast: 14, brightness: 6, highlights: 9, sharpen: 18 }, grade: [[215, 20], [220, 9], [205, 5]] },
};

/** 将选中风格和独立的手动调色合成到同一组渲染参数。
 * @param {object} adjustments 手动调色参数。
 * @param {string} key 风格 ID。
 * @param {number} amount 风格强度百分比。
 * @returns {object} 提供给合成器的调色参数。
 */
export function imageLookAdjustments(adjustments, key, amount) {
  const recipe = imageLooks[key];
  if (!recipe || key === 'neutral' || !amount) return adjustments;
  const factor = amount / 100;
  const result = { ...adjustments };
  for (const [field, value] of Object.entries(recipe.values)) {
    const [min, max] = ADJUSTMENT_RANGES[field];
    const shift = field === 'gamma' ? value - 1 : value;
    result[field] = Math.min(max, Math.max(min, result[field] + shift * factor));
  }
  if (recipe.grade) {
    result.grading = { ...adjustments.grading };
    ['shadows', 'midtones', 'highlights'].forEach((band, index) => {
      const [hue, saturation] = recipe.grade[index];
      const manual = adjustments.grading[band];
      // 色轮上的方向和强度一起叠加，反向色可以抵消预设偏色。
      const presetRadians = hue * Math.PI / 180;
      const manualRadians = manual.hue * Math.PI / 180;
      const x = Math.cos(presetRadians) * saturation * factor + Math.cos(manualRadians) * manual.saturation;
      const y = Math.sin(presetRadians) * saturation * factor + Math.sin(manualRadians) * manual.saturation;
      result.grading[band] = { ...manual, hue: (Math.atan2(y, x) * 180 / Math.PI + 360) % 360, saturation: Math.min(100, Math.hypot(x, y)) };
    });
  }
  return result;
}
