import { inflateRaw } from 'pako';

const V5_CURATED_MODELS = new Set([
  'nai-diffusion-5-curated',
  'nai-diffusion-5-curated-inpainting',
]);
const V5_FULL_MODELS = new Set([
  'nai-diffusion-5-full',
  'nai-diffusion-5-full-inpainting',
]);
const V4_MODELS = new Set([
  'nai-diffusion-4-curated-preview',
  'nai-diffusion-4-curated-inpainting',
  'nai-diffusion-4-full',
  'nai-diffusion-4-full-inpainting',
  'nai-diffusion-4-5-curated',
  'nai-diffusion-4-5-curated-inpainting',
  'nai-diffusion-4-5-full',
  'nai-diffusion-4-5-full-inpainting',
]);

const tokenizerCache = new Map();
const tokenizerPromises = new Map();

/**
 * 统计 NovelAI multiprompt 中各独立提示字段的 token 总数。
 *
 * @param {object} tokenizer 当前模型的 tokenizer。
 * @param {Array<string>} promptTexts 主提示词与启用角色的同向提示词。
 * @returns {number} 每个字段独立编码后相加的 token 数量。
 */
export const countNovelAIMultiPromptTokens = (tokenizer, promptTexts = []) => (
  promptTexts.reduce(
    (total, promptText) => total + tokenizer.encode(String(promptText ?? '')).length,
    0,
  )
);

/**
 * 取得启用角色的正向或负向提示词，并可排除正在编辑的角色。
 *
 * @param {Array<object>} characterTabs 当前角色卡列表。
 * @param {'prompt'|'uc'} field 要统计的角色字段。
 * @param {number|null} excludedIndex 需要排除的角色索引。
 * @returns {Array<string>} 按角色列表顺序排列的同向提示词。
 */
export const getEnabledNovelAICharacterPromptTexts = (
  characterTabs = [],
  field,
  excludedIndex = null,
) => characterTabs
  .map((character, index) => ({ character, index }))
  .filter(({ character, index }) => (
    character?.isTemporarilyDisabled !== true && index !== excludedIndex
  ))
  .map(({ character }) => String(character?.[field] ?? ''));

const createByteToCharacterMap = () => {
  const bytes = [];
  for (let value = 33; value <= 126; value += 1) bytes.push(value);
  for (let value = 161; value <= 172; value += 1) bytes.push(value);
  for (let value = 174; value <= 255; value += 1) bytes.push(value);

  const codePoints = [...bytes];
  let offset = 0;
  for (let value = 0; value < 256; value += 1) {
    if (!bytes.includes(value)) {
      bytes.push(value);
      codePoints.push(256 + offset);
      offset += 1;
    }
  }

  return Object.fromEntries(bytes.map((value, index) => [
    value,
    String.fromCodePoint(codePoints[index]),
  ]));
};

/**
 * NovelAI V5 使用的 Qwen byte-level BPE tokenizer。
 *
 * 该实现与 NovelAI 当前网页的分词流程一致：先做 NFC 规范化，再按官方
 * splitRegex 切分，最后执行 byte-level BPE 合并。
 */
export class NovelAIQwenTokenizer {
  constructor(vocab, merges, specialTokens, config) {
    this.encoder = Object.assign(Object.create(null), vocab);
    this.config = config;
    this.cache = new Map();
    this.textEncoder = new TextEncoder();
    this.byteToCharacter = createByteToCharacterMap();
    this.specialTokens = Object.fromEntries(
      specialTokens.map((token) => [token, this.encoder[token]]),
    );
    this.splitRegex = new RegExp(config.splitRegex, 'gu');
    this.bpeRanks = new Map(
      merges.map((pair, index) => [`${pair[0]}\0${pair[1]}`, index]),
    );

    const root = { character: '', children: [] };
    Object.keys(this.specialTokens)
      .sort((left, right) => right.length - left.length)
      .forEach((token) => {
        let node = root;
        for (const character of token) {
          let child = node.children.find((candidate) => candidate.character === character);
          if (!child) {
            child = { character, children: [] };
            node.children.push(child);
          }
          node = child;
        }
        node.value = token;
      });
    this.specialTokenTree = root;
  }

  splitWords(text) {
    const words = [];
    const root = this.specialTokenTree;
    let normalText = '';
    let possibleSpecial = '';
    let node = root;
    let matchedNode;

    const flush = () => {
      if (normalText) {
        words.push(...[...normalText.matchAll(this.splitRegex)].map((match) => match[0]));
        normalText = '';
      }
      if (possibleSpecial) {
        words.push(possibleSpecial);
        possibleSpecial = '';
        node = root;
      }
    };

    let index = 0;
    while (index < text.length) {
      const character = text[index];
      const child = node.children.find((candidate) => candidate.character === character);
      if (child) {
        node = child;
        possibleSpecial += character;
        index += 1;
      } else if (!possibleSpecial) {
        normalText += character;
        index += 1;
      } else if (matchedNode?.value) {
        const unmatchedSuffix = possibleSpecial.slice(matchedNode.value.length);
        possibleSpecial = matchedNode.value;
        index -= unmatchedSuffix.length;
        matchedNode = undefined;
        flush();
      } else {
        normalText += possibleSpecial[0];
        index -= possibleSpecial.length - 1;
        possibleSpecial = '';
        node = root;
      }

      if (node.value && possibleSpecial === node.value) {
        matchedNode = node;
      }
    }

    if (possibleSpecial) {
      if (matchedNode?.value) {
        const unmatchedSuffix = possibleSpecial.slice(matchedNode.value.length);
        possibleSpecial = matchedNode.value;
        flush();
        normalText = unmatchedSuffix;
      } else {
        normalText += possibleSpecial;
        possibleSpecial = '';
      }
    }
    flush();
    return words;
  }

  insertRankedPair(pairs, pair) {
    let index = 0;
    while (index < pairs.length && pairs[index].rank < pair.rank) index += 1;
    if (index >= pairs.length || pairs[index].rank !== pair.rank) {
      pairs.splice(index, 0, pair);
    }
  }

  getRankedPairs(tokens) {
    const pairs = [];
    let left = tokens[0];
    for (let index = 1; index < tokens.length; index += 1) {
      const right = tokens[index];
      const rank = this.bpeRanks.get(`${left}\0${right}`) ?? Number.POSITIVE_INFINITY;
      this.insertRankedPair(pairs, { rank, left, right });
      left = right;
    }
    return pairs;
  }

  encodeWord(word) {
    if (this.config.ignoreMerges && this.encoder[word] !== undefined) {
      return [this.encoder[word]];
    }
    const cached = this.cache.get(word);
    if (cached) return cached;

    let pieces = [...word];
    let rankedPairs = this.getRankedPairs(pieces);
    if (rankedPairs.length === 0) {
      const tokenIds = this.encoder[word] === undefined ? [] : [this.encoder[word]];
      this.cache.set(word, tokenIds);
      return tokenIds;
    }

    while (rankedPairs.length > 0) {
      const { left, right } = rankedPairs[0];
      if (!this.bpeRanks.has(`${left}\0${right}`)) break;

      const merged = [];
      let index = 0;
      while (index < pieces.length) {
        const leftIndex = pieces.indexOf(left, index);
        if (leftIndex === -1) {
          merged.push(...pieces.slice(index));
          break;
        }
        merged.push(...pieces.slice(index, leftIndex));
        if (leftIndex < pieces.length - 1 && pieces[leftIndex + 1] === right) {
          merged.push(left + right);
          index = leftIndex + 2;
        } else {
          merged.push(pieces[leftIndex]);
          index = leftIndex + 1;
        }
      }
      pieces = merged;
      if (pieces.length === 1) break;
      rankedPairs = this.getRankedPairs(pieces);
    }

    const tokenIds = pieces
      .map((piece) => this.encoder[piece])
      .filter((tokenId) => tokenId !== undefined);
    this.cache.set(word, tokenIds);
    return tokenIds;
  }

  encode(text) {
    const normalizedText = this.config.normalization
      ? String(text ?? '').normalize(this.config.normalization)
      : String(text ?? '');
    const chunks = [];
    const characters = [...normalizedText];
    const maxEncodeCharacters = this.config.maxEncodeChars;
    if (maxEncodeCharacters && characters.length > maxEncodeCharacters) {
      for (let index = 0; index < characters.length; index += maxEncodeCharacters) {
        chunks.push(characters.slice(index, index + maxEncodeCharacters).join(''));
      }
    } else {
      chunks.push(normalizedText);
    }

    const tokenIds = [];
    for (const chunk of chunks) {
      for (const word of this.splitWords(chunk)) {
        if (this.specialTokens[word] !== undefined) {
          tokenIds.push(this.specialTokens[word]);
          continue;
        }
        const byteEncodedWord = [...this.textEncoder.encode(word)]
          .map((byte) => this.byteToCharacter[byte])
          .join('');
        tokenIds.push(...this.encodeWord(byteEncodedWord));
      }
    }
    return tokenIds;
  }
}

/**
 * 返回当前 NovelAI 图像模型使用的 tokenizer 与提示词上限。
 *
 * @param {string} modelName NovelAI 模型 ID。
 * @returns {{type:'qwen'|'t5', path:string, limit:number|null}} tokenizer 配置。
 */
export const getNovelAIImageTokenizerConfig = (modelName) => {
  if (V5_CURATED_MODELS.has(modelName)) {
    return { type: 'qwen', path: '/qwen35_tokenizer.def', limit: 703 };
  }
  if (V5_FULL_MODELS.has(modelName)) {
    return { type: 'qwen', path: '/qwen35_tokenizer.def', limit: 1471 };
  }
  return {
    type: 't5',
    path: '/t5_tokenizer.json',
    limit: V4_MODELS.has(modelName) ? 512 : null,
  };
};

/**
 * 按模型加载 NovelAI 图像 tokenizer，同一资源在页面生命周期内只解析一次。
 *
 * @param {string} modelName NovelAI 模型 ID。
 * @returns {Promise<{tokenizer:object, limit:number|null, type:string}>} 分词器及模型上限。
 */
export async function getNovelAIImageTokenizer(modelName) {
  const config = getNovelAIImageTokenizerConfig(modelName);
  const cacheKey = `${config.type}:${config.path}`;
  if (tokenizerCache.has(cacheKey)) {
    return { tokenizer: tokenizerCache.get(cacheKey), limit: config.limit, type: config.type };
  }
  if (!tokenizerPromises.has(cacheKey)) {
    tokenizerPromises.set(cacheKey, (async () => {
      if (config.type === 't5') {
        const { getTokenizer } = await import('./t5Tokenizer');
        return getTokenizer(config.path);
      }

      const response = await fetch(config.path);
      if (!response.ok) {
        const error = new Error('TOKENIZER_LOAD_FAILED');
        error.code = 'TOKENIZER_LOAD_FAILED';
        throw error;
      }
      const compressed = new Uint8Array(await response.arrayBuffer());
      const definition = JSON.parse(new TextDecoder('utf-8').decode(inflateRaw(compressed)));
      return new NovelAIQwenTokenizer(
        definition.vocab,
        definition.merges,
        definition.specialTokens,
        definition.config || {},
      );
    })());
  }

  try {
    const tokenizer = await tokenizerPromises.get(cacheKey);
    tokenizerCache.set(cacheKey, tokenizer);
    return { tokenizer, limit: config.limit, type: config.type };
  } catch (error) {
    tokenizerPromises.delete(cacheKey);
    throw error;
  }
}
