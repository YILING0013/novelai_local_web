import { countNovelAIMultiPromptTokens } from '../PromptEditor/novelAIImageTokenizer.mjs';

// 超过 V5 Full 输入预算两倍时提醒拆分；本地存储不沿用线上笔记容量限制。
export const NOTE_TOKEN_LIMIT = 2942;
export const NOTE_TOKEN_MODEL = 'nai-diffusion-5-full';
export const NOTE_CONTENT_LIMIT = 100000;
export const NOTE_CHARACTER_JSON_LIMIT = 100000;

/**
 * 统计笔记正文和角色正负提示词的字符总数，与后端的 Unicode 字符计数一致。
 * @param {string} positive 正文正向提示词。
 * @param {string} negative 正文负向提示词。
 * @param {object[]} characters 已解析的角色卡数组。
 * @returns {number} 不含 JSON 结构、名称和位置字段的字符总数。
 */
export function getNoteContentLength(positive = '', negative = '', characters = []) {
  return [positive, negative, ...characters.flatMap((character) => [character.prompt, character.uc])]
    .reduce((total, value) => total + Array.from(value ?? '').length, 0);
}

/**
 * 使用 NovelAI V5 分词器统计笔记所有正负提示词，停用的角色卡仍属于存储内容。
 * @param {object} tokenizer 已加载的 NovelAI V5 分词器。
 * @param {string} positive 正文正向提示词。
 * @param {string} negative 正文负向提示词。
 * @param {object[]} characters 已解析的角色卡数组。
 * @returns {number} 各提示词独立编码后的 token 总数。
 */
export function getNoteTokenCount(tokenizer, positive = '', negative = '', characters = []) {
  return countNovelAIMultiPromptTokens(tokenizer, [positive, negative, ...characters.flatMap((character) => [character.prompt, character.uc])]);
}
