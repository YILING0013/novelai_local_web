import { getPromptCommentRanges } from './promptCommentRanges.mjs';

export { weightUpText, weightDownText } from './promptWeights.mjs';

/**
 * 将选区涉及的完整标签注释起来，保留之前已经注释的范围。
 * @param {string} text 编辑器原始提示词。
 * @param {number} start 选区起点。
 * @param {number} end 选区终点。
 * @returns {{text: string, start: number, end: number}} 更新后的文本与选区。
 */
export const commentText = (text, start, end) => {
  if (start === end) return { text, start, end };

  let termStart = start;
  while (termStart > 0 && text[termStart - 1] !== ',' && text[termStart - 1] !== '\n') {
    termStart--;
  }
  let termEnd = end;
  while (termEnd < text.length && text[termEnd] !== ',' && text[termEnd] !== '\n') {
    termEnd++;
  }

  // 分隔符可能在已有注释内部，扩到整块可以让取消注释恢复原样。
  for (const range of getPromptCommentRanges(text)) {
    if (range.start >= termEnd || range.end <= termStart) continue;
    if (range.start <= termStart && range.end >= termEnd) {
      return { text, start: range.start, end: range.end };
    }
    termStart = Math.min(termStart, range.start);
    termEnd = Math.max(termEnd, range.end);
  }

  const commentedTerms = '/*' + text.slice(termStart, termEnd) + '*/';
  return {
    text: text.slice(0, termStart) + commentedTerms + text.slice(termEnd),
    start: termStart,
    end: termStart + commentedTerms.length,
  };
};

/**
 * 移除选区内完整注释块的外层标记，保留原先独立注释的内层文字。
 * @param {string} text 编辑器原始提示词。
 * @param {number} start 选区起点。
 * @param {number} end 选区终点。
 * @returns {{text: string, start: number, end: number}} 更新后的文本与选区。
 */
export const uncommentText = (text, start, end) => {
  if (start === end) return { text, start, end };

  let updated = text;
  let removed = 0;
  for (const range of getPromptCommentRanges(text).reverse()) {
    if (range.start < start || range.end > end) continue;
    updated = updated.slice(0, range.start) + updated.slice(range.start + 2, range.end - 2) + updated.slice(range.end);
    removed += 4;
  }
  return { text: updated, start, end: end - removed };
};

/**
 * 在提示词选区切换注释。注释中的部分选区解除整块注释，混有有效词条时沿用整词注释。
 * @param {string} text 当前编辑内容。
 * @param {number} start 选区起点。
 * @param {number} end 选区终点。
 * @returns {{text: string, start: number, end: number}} 新内容和选区。
 */
export function togglePromptComment(text, start, end) {
  if (start === end) return { text, start, end };
  const selected = getPromptCommentRanges(text).filter((range) => range.start < end && range.end > start);
  let offset = start;
  const onlyComments = selected.length && selected.every((range) => {
    const gap = text.slice(offset, Math.max(offset, range.start));
    offset = range.end;
    return !/[^,\s]/u.test(gap);
  }) && !/[^,\s]/u.test(text.slice(Math.min(offset, end), end));
  return onlyComments
    ? uncommentText(text, Math.min(start, selected[0].start), Math.max(end, selected.at(-1).end))
    : commentText(text, start, end);
}

/**
 * 处理编辑器自己的 Ctrl+/，只在有选区且实际改动文本时拦截浏览器事件。
 * @param {object} event 输入框键盘事件。
 * @param {Function} commit 提交文本并恢复选区的编辑器回调。
 * @returns {boolean} 是否处理了快捷键。
 */
export function handlePromptCommentKey(event, commit) {
  const input = event.currentTarget;
  if (event.defaultPrevented || event.nativeEvent?.isComposing || event.keyCode === 229 || input.readOnly
      || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.key !== '/') return false;
  const result = togglePromptComment(input.value, input.selectionStart, input.selectionEnd);
  if (result.text === input.value) return false;
  event.preventDefault();
  event.stopPropagation();
  commit(result);
  return true;
}

// Renamed and updated for consistency
const processSequentialItemsInCategory = (category, storage) => {
  if (!category || !category.items || category.items.length === 0) {
    return [];
  }
  
  // 使用ID确保唯一性，如果ID不存在则回退到名称 (与RandomPromptConfig.js一致)
  const storageKey = `category_item_position_${category.id || category.name}`; 
  let currentPosition = parseInt(storage.getItem(storageKey), 10);

  // 如果localStorage没有，则使用类别配置的起始位置，若无则为0
  if (isNaN(currentPosition) || currentPosition === null) {
    currentPosition = category.startPosition || 0; 
  }

  // 确保位置有效
  if (currentPosition >= category.items.length) {
    currentPosition = 0; // 超出范围则重置
  }
  
  const extractCount = category.extractCount || 1;
  const result = [];
  
  for (let i = 0; i < extractCount; i++) {
    const itemPosition = (currentPosition + i) % category.items.length;
    result.push(category.items[itemPosition]);
  }
  
  const nextPosition = (currentPosition + extractCount) % category.items.length;
  storage.setItem(storageKey, nextPosition.toString());
  
  return result;
};

/**
 * 处理随机提示词标记
 * @param {string} text - 提示词文本
 * @param {Object} randomPromptConfig - 随机提示词配置 { categories: [], collections: [] }
 * @returns {string} - 处理后的文本
 */
export const processRandomPrompts = (text, randomPromptConfig, storage = globalThis.localStorage) => {
  if (!text || !randomPromptConfig || (!randomPromptConfig.categories && !randomPromptConfig.collections)) {
    return text;
  }
  
  const categories = randomPromptConfig.categories || [];
  const collections = randomPromptConfig.collections || [];

  // 处理类别标记 <ran_id="类别名称"/>
  const categoryRegex = /<ran_id="([^"]+)"\s*\/>/g;
  let processedText = text.replace(categoryRegex, (match, categoryName) => {
    const category = categories.find(c => c.name === categoryName);
    if (!category) return match; // 如果未找到类别，保留原标记
    
    const { items, extractCount = 1, weightConfig = { type: 'none' }, extractMode = 'random' } = category;
    if (!items || items.length === 0) return ''; // 如果类别没有词条，则替换为空字符串
    
    let selectedItems;
    if (extractMode === 'sequential') {
      selectedItems = processSequentialItemsInCategory(category, storage);
    } else { // random
      selectedItems = [...items]
        .sort(() => 0.5 - Math.random())
        .slice(0, Math.min(extractCount, items.length));
    }
    
    if (selectedItems.length === 0) return '';
    
    return selectedItems.map(word => {
      if (weightConfig.type === 'none') {
        return word;
      } else if (weightConfig.type === 'fixed') {
        return `${weightConfig.fixedValue !== undefined ? weightConfig.fixedValue.toFixed(2) : '1.00'}::${word}::`;
      } else if (weightConfig.type === 'random') {
        const min = weightConfig.randomMin || 0;
        const max = weightConfig.randomMax || 1;
        const randomValue = (Math.random() * (max - min) + min).toFixed(2);
        return `${randomValue}::${word}::`;
      }
      return word;
    }).join(', ');
  });
  
  // 处理集合标记 <ran_sorting_id="集合名称"/>
  const collectionRegex = /<ran_sorting_id="([^"]+)"\s*\/>/g;
  processedText = processedText.replace(collectionRegex, (match, collectionName) => {
    const collection = collections.find(c => c.name === collectionName);
    if (!collection) return match; // 如果未找到集合，保留原标记
    
    const { 
      categoryRefs, 
      randomOrder = true, 
      useFixedWeight = false, 
      fixedWeight = 1,
      extractNCategories = false, // 新增：是否抽取N个类别
      numToExtract = 1,           // 新增：要抽取的类别数量
      categoryExtractMode = 'random', // 新增：集合中类别的抽取模式
      categoryStartPosition = 0     // 新增：集合中类别轮询的配置起始位置
    } = collection;

    if (!categoryRefs || categoryRefs.length === 0) return ''; // 如果集合没有引用类别，则替换为空字符串

    let categoriesToProcess = [];
    const availableCategoriesInCollection = categoryRefs
      .map(ref => categories.find(c => c.id === ref.categoryId))
      .filter(Boolean); // 获取实际的类别对象并过滤掉未找到的

    if (availableCategoriesInCollection.length === 0) return '';

    if (extractNCategories) {
      const numToPick = Math.min(numToExtract, availableCategoriesInCollection.length);
      if (categoryExtractMode === 'sequential') {
        // 使用ID确保唯一性，如果ID不存在则回退到名称 (与RandomPromptConfig.js一致)
        const storageKey = `collection_category_position_${collection.id || collection.name}`;
        let currentCollectionCatPos = parseInt(storage.getItem(storageKey), 10);

        // 如果localStorage没有，则使用集合配置的起始位置，若无则为0
        if (isNaN(currentCollectionCatPos) || currentCollectionCatPos === null) {
          currentCollectionCatPos = categoryStartPosition || 0;
        }
        // 确保位置有效
        if (currentCollectionCatPos >= availableCategoriesInCollection.length) {
          currentCollectionCatPos = 0; 
        }

        for (let i = 0; i < numToPick; i++) {
          const catIndex = (currentCollectionCatPos + i) % availableCategoriesInCollection.length;
          categoriesToProcess.push(availableCategoriesInCollection[catIndex]);
        }
        const nextCollectionCatPos = (currentCollectionCatPos + numToPick) % availableCategoriesInCollection.length;
        storage.setItem(storageKey, nextCollectionCatPos.toString());
      } else { // random category extraction from collection
        categoriesToProcess = [...availableCategoriesInCollection]
          .sort(() => 0.5 - Math.random())
          .slice(0, numToPick);
      }
    } else {
      // 处理集合中的所有类别
      categoriesToProcess = availableCategoriesInCollection;
    }
    
    let allItemsFromCollection = [];
    categoriesToProcess.forEach(category => {
      // category本身可能为undefined，如果categoryRefs中的ID在categories数组中找不到
      if (!category) return; 

      const { items, extractCount = 1, weightConfig = { type: 'none' }, extractMode = 'random' } = category;
      if (!items || items.length === 0) return;
      
      let selectedItemsFromCategory;
      if (extractMode === 'sequential') {
        selectedItemsFromCategory = processSequentialItemsInCategory(category, storage);
      } else { // random
        selectedItemsFromCategory = [...items]
          .sort(() => 0.5 - Math.random())
          .slice(0, Math.min(extractCount, items.length));
      }
      
      if (selectedItemsFromCategory.length > 0) {
        const processedItems = selectedItemsFromCategory.map(word => {
          if (useFixedWeight) { // 如果集合使用固定权重，则类别自身的权重不应用，词条保持原样
            return word; 
          }
          // 否则，应用类别自身的权重
          if (weightConfig.type === 'none') {
            return word;
          } else if (weightConfig.type === 'fixed') {
            return `${weightConfig.fixedValue !== undefined ? weightConfig.fixedValue.toFixed(2) : '1.00'}::${word}::`;
          } else if (weightConfig.type === 'random') {
            const min = weightConfig.randomMin || 0;
            const max = weightConfig.randomMax || 1;
            const randomValue = (Math.random() * (max - min) + min).toFixed(2);
            return `${randomValue}::${word}::`;
          }
          return word;
        });
        allItemsFromCollection = [...allItemsFromCollection, ...processedItems];
      }
    });
    
    if (randomOrder && allItemsFromCollection.length > 0) {
      allItemsFromCollection.sort(() => 0.5 - Math.random());
    }
    
    if (useFixedWeight && allItemsFromCollection.length > 0) {
      // 提取纯文本用于集合权重包裹
      const plainWordsJoined = allItemsFromCollection.map(itemStr => {
          // 尝试去除已有的 n::X:: 包裹，只取 X 部分
          // 正则表达式解释:
          // ^           - 字符串开始
          // [\d.]+     - 匹配一个或多个数字或点 (权重值)
          // :?:         - 匹配一个可选的冒号 (处理 N:X: 和 N::X::)
          // (.*?)       - 捕获组1: 匹配任何字符 (非贪婪模式) (这是我们想要的文本)
          // :?:         - 匹配一个可选的冒号
          // $           - 字符串结束
          // 这个正则可能需要根据实际的词条格式调整，特别是如果词条本身可能包含冒号
          // 一个更安全的做法可能是，如果词条本身已经是 N::X:: 格式，先提取 X
          const weightMatch = itemStr.match(/^(\d+(\.\d+)?)::(.*?)::$/);
          if (weightMatch && weightMatch[3]) {
            return weightMatch[3]; // 如果是 N::文本::, 取出文本
          }
          return itemStr; // 否则返回原样
      }).join(', ');

      if (plainWordsJoined) {
          return `${fixedWeight !== undefined ? fixedWeight.toFixed(2) : '1.00'}::${plainWordsJoined}::`;
      }
      return ''; // 如果没有有效内容，返回空
    } else {
      return allItemsFromCollection.join(', ');
    }
  });
  
  return processedText;
};

// 只清除完整注释；未配对的标记沿用原有的纯文本行为。
const removePromptComments = (text) => {
  let activeText = '';
  let offset = 0;
  for (const { start, end } of getPromptCommentRanges(text)) {
    activeText += text.slice(offset, start);
    offset = end;
  }
  return (activeText + text.slice(offset)).trim();
};

/**
 * 提取生效提示词，移除注释并按需展开随机词条。
 * @param {string} text - 编辑器原始提示词。
 * @param {Object} options - 可选参数
 * @param {boolean} options.processRandomPrompts - 是否处理随机提示词
 * @param {Object} options.randomPromptConfig - 随机提示词配置
 * @returns {string} - 不含注释的生效提示词，不修改编辑器原文。
 */
export const extractActiveContent = (text, options = {}) => {
  if (!text) return '';
  
  const activeText = removePromptComments(text);
  if (options?.processRandomPrompts && options.randomPromptConfig) {
    // 随机词条本身也可能带注释；展开后只清理注释，不再次抽取随机内容。
    return removePromptComments(processRandomPrompts(activeText, options.randomPromptConfig, options.randomCursorStorage));
  }
  return activeText;
};

/**
 * 增强版的格式化函数，支持注释、加权和降权高亮
 * 新增支持数字权重格式：1.5::text::
 * @param {string} text - The prompt text
 * @returns {Array} - Array of text segments with type ('comment', 'weight-up', 'weight-down', or 'normal')
 */
export const formatPromptWithHighlighting = (text) => {
  if (!text) return [{ text: '', type: 'normal' }];
  
  const segments = [];
  let lastIndex = 0;
  const allMatches = getPromptCommentRanges(text).map(({ start, end }) => ({
    start, end, text: text.slice(start, end), type: 'comment',
  }));
  // 注释优先于跨过注释边界的权重和随机语法。
  const overlapsMark = (match) => allMatches.some(({ start, end, type }) =>
    match.index < end && (match.index >= start || (type === 'comment' && match.index + match[0].length > start))
  );
  let match;

  const weightUpRegex = /\{([^{}]*)\}/g;
  while ((match = weightUpRegex.exec(text)) !== null) {
    if (!overlapsMark(match)) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: 'weight-up'
      });
    }
  }
  
  const weightDownRegex = /\[([^\[\]]*)\]/g;
  while ((match = weightDownRegex.exec(text)) !== null) {
    if (!overlapsMark(match)) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: 'weight-down'
      });
    }
  }
  
  const numberWeightRegex = /(\d+(\.\d+)?)::(.*?)::/g;
  while ((match = numberWeightRegex.exec(text)) !== null) {
    if (!overlapsMark(match)) {
      const weightValue = parseFloat(match[1]);
      const type = weightValue >= 1 ? 'weight-up' : 'weight-down';
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: type
      });
    }
  }
  
  allMatches.sort((a, b) => a.start - b.start);
  
  lastIndex = 0;
  for (const match of allMatches) {
    if (match.start >= lastIndex) {
      if (match.start > lastIndex) {
        segments.push({
          text: text.substring(lastIndex, match.start),
          type: 'normal'
        });
      }
      segments.push({
        text: match.text,
        type: match.type
      });
      lastIndex = match.end;
    }
  }
  
  if (lastIndex < text.length) {
    segments.push({
      text: text.substring(lastIndex),
      type: 'normal'
    });
  }
  
  return segments;
};

/**
 * 自动格式化文本：
 * @param {string} text - 输入文本
 * @returns {string} - 格式化后的文本
 */
export const autoFormatText = (text) => {
  if (!text) return '';
  
  let formattedText = text
    .replace(/，/g, ',')      
    .replace(/。/g, '.')      
    .replace(/；/g, ';')      
    .replace(/：/g, ':')      
    .replace(/【/g, '[')      
    .replace(/】/g, ']')
    .replace(/「/g, '[')      
    .replace(/」/g, ']')
    .replace(/『/g, '{')      
    .replace(/』/g, '}')
    .replace(/（/g, '(')      
    .replace(/）/g, ')')
    .replace(/：：/g, '::');   
  
  return formattedText;
};
