import { createComicElement, fitComicTextFontSize } from './comicElements.mjs';
import { comicAIImagePlacement } from './comicAI.mjs';

/**
 * 将真实图片上已安全去字的区域转换为漫画文字；参考分镜不参与坐标换算。
 * @param {object} page 接收结果的漫画页。
 * @param {number} sectionId 单页或双页中的目标区。
 * @param {object} image 实际生成图片及其原始像素尺寸。
 * @param {object} result 本地文字重建结果，未去字的待核对块不创建重复文字。
 * @returns {Array<object>} 可保存、导出和继续编辑的独立文字元素。
 */
export function buildComicLetteringElements(page, sectionId, image, result) {
  const placement = comicAIImagePlacement(page, sectionId, image);
  return result.blocks.filter((block) => block.applied).map((block) => {
    const bounds = block.layoutBounds || block.bounds;
    const element = createComicElement('text', {
      x: placement.x + bounds.x * placement.scale,
      y: placement.y + bounds.y * placement.scale,
      width: bounds.width * placement.scale,
      height: bounds.height * placement.scale,
    }, {
      name: block.text, text: block.text, color: block.color || '#111111',
      writingMode: block.direction, lineHeight: 1.15,
      dialogueId: block.dialogueId, comicTextBlockId: block.id,
    });
    element.fontSize = fitComicTextFontSize(element, 32 * placement.scale);
    return element;
  });
}
