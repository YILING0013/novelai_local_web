// promptUtils.js
/**
 * Utility functions for prompt text manipulation
 */

/**
 * Weight up the selected text - ONE STEP AT A TIME:
 * 1. If term has [], remove one layer of []
 * 2. Otherwise, add one layer of {}
 * @param {string} text - The full text
 * @param {number} start - Selection start position
 * @param {number} end - Selection end position
 * @returns {Object} - Updated text and new cursor position
 */
export const weightUpText = (text, start, end) => {
  if (start === end) return { text, start, end };
  
  const selectedText = text.substring(start, end);
  let termStart = start;
  while (termStart > 0 && text[termStart - 1] !== ',' && text[termStart - 1] !== '\n') {
    termStart--;
  }
  let termEnd = end;
  while (termEnd < text.length && text[termEnd] !== ',' && text[termEnd] !== '\n') {
    termEnd++;
  }
  const completeTerms = text.substring(termStart, termEnd);
  const terms = completeTerms.split(',');
  
  const processedTerms = terms.map(term => {
    term = term.trim();
    if (!term) return term;
    if (term.startsWith('[') && term.endsWith(']')) {
      return term.substring(1, term.length - 1).trim();
    } 
    else {
      return `{${term}}`;
    }
  });
  
  const newTerms = processedTerms.join(', ');
  const newText = text.substring(0, termStart) + newTerms + text.substring(termEnd);
  
  return {
    text: newText,
    start: termStart,
    end: termStart + newTerms.length
  };
};


/**
 * Weight down the selected text - ONE STEP AT A TIME:
 * 1. If term has {}, remove one layer of {}
 * 2. Otherwise, add one layer of []
 * @param {string} text - The full text
 * @param {number} start - Selection start position
 * @param {number} end - Selection end position
 * @returns {Object} - Updated text and new cursor position
 */
export const weightDownText = (text, start, end) => {
  if (start === end) return { text, start, end };

  const selectedText = text.substring(start, end);
  let termStart = start;
  while (termStart > 0 && text[termStart - 1] !== ',' && text[termStart - 1] !== '\n') {
    termStart--;
  }
  let termEnd = end;
  while (termEnd < text.length && text[termEnd] !== ',' && text[termEnd] !== '\n') {
    termEnd++;
  }
  const completeTerms = text.substring(termStart, termEnd);
  const terms = completeTerms.split(',');

  const processedTerms = terms.map(term => {
    term = term.trim();
    if (!term) return term;
    if (term.startsWith('{') && term.endsWith('}')) {
      return term.substring(1, term.length - 1).trim();
    } 
    else {
      return `[${term}]`;
    }
  });

  const newTerms = processedTerms.join(', ');
  const newText = text.substring(0, termStart) + newTerms + text.substring(termEnd);
  
  return {
    text: newText,
    start: termStart,
    end: termStart + newTerms.length
  };
};

/**
 * Comment out the selected text
 * @param {string} text - The full text
 * @param {number} start - Selection start position
 * @param {number} end - Selection end position
 * @returns {Object} - Updated text and new cursor position
 */
export const commentText = (text, start, end) => {
  if (start === end) return { text, start, end };
  
  const selectedText = text.substring(start, end);
  let termStart = start;
  while (termStart > 0 && text[termStart - 1] !== ',' && text[termStart - 1] !== '\n') {
    termStart--;
  }
  let termEnd = end;
  while (termEnd < text.length && text[termEnd] !== ',' && text[termEnd] !== '\n') {
    termEnd++;
  }
  const completeTerms = text.substring(termStart, termEnd);
  const commentedTerms = `/*${completeTerms}*/`;
  const newText = text.substring(0, termStart) + commentedTerms + text.substring(termEnd);
  
  return {
    text: newText,
    start: termStart,
    end: termStart + commentedTerms.length
  };
};

/**
 * Remove comments from the selected text
 * @param {string} text - The full text
 * @param {number} start - Selection start position
 * @param {number} end - Selection end position
 * @returns {Object} - Updated text and new cursor position
 */
export const uncommentText = (text, start, end) => {
  if (start === end) return { text, start, end };
  
  const selectedText = text.substring(start, end);
  const commentStartIndex = selectedText.indexOf('/*');
  const commentEndIndex = selectedText.lastIndexOf('*/');
  
  if (commentStartIndex === -1 || commentEndIndex === -1) {
    return { text, start, end };
  }
  
  const commentedContent = selectedText.substring(commentStartIndex + 2, commentEndIndex);
  const newSelectedText = selectedText.substring(0, commentStartIndex) + 
                           commentedContent + 
                           selectedText.substring(commentEndIndex + 2);
  const newText = text.substring(0, start) + newSelectedText + text.substring(end);
  
  return {
    text: newText,
    start,
    end: start + newSelectedText.length
  };
};

// Renamed and updated for consistency
const processSequentialItemsInCategory = (category) => {
  if (!category || !category.items || category.items.length === 0) {
    return [];
  }
  
  // 使用ID确保唯一性，如果ID不存在则回退到名称 (与RandomPromptConfig.js一致)
  const storageKey = `category_item_position_${category.id || category.name}`; 
  let currentPosition = parseInt(localStorage.getItem(storageKey), 10);

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
  localStorage.setItem(storageKey, nextPosition.toString());
  
  return result;
};

/**
 * 处理随机提示词标记
 * @param {string} text - 提示词文本
 * @param {Object} randomPromptConfig - 随机提示词配置 { categories: [], collections: [] }
 * @returns {string} - 处理后的文本
 */
export const processRandomPrompts = (text, randomPromptConfig) => {
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
      selectedItems = processSequentialItemsInCategory(category);
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
        let currentCollectionCatPos = parseInt(localStorage.getItem(storageKey), 10);

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
        localStorage.setItem(storageKey, nextCollectionCatPos.toString());
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
        selectedItemsFromCategory = processSequentialItemsInCategory(category);
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

/**
 * Extract the active (non-commented) content from a prompt
 * @param {string} text - The prompt text
 * @param {Object} options - 可选参数
 * @param {boolean} options.processRandomPrompts - 是否处理随机提示词
 * @param {Object} options.randomPromptConfig - 随机提示词配置
 * @returns {string} - The active content without comments
 */
export const extractActiveContent = (text, options = {}) => {
  if (!text) return '';
  
  let processedText = text.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  
  if (options && options.processRandomPrompts && options.randomPromptConfig) {
    // 确保在调用 processRandomPrompts 之前，randomPromptConfig 是有效的
    if (options.randomPromptConfig.categories || options.randomPromptConfig.collections) {
      processedText = processRandomPrompts(processedText, options.randomPromptConfig);
    }
  }
  
  return processedText;
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
  const commentRegex = /\/\*[\s\S]*?\*\//g;
  let match;
  const allMatches = [];
  
  while ((match = commentRegex.exec(text)) !== null) {
    allMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      type: 'comment'
    });
  }
  
  const weightUpRegex = /\{([^{}]*)\}/g;
  while ((match = weightUpRegex.exec(text)) !== null) {
    const isInComment = allMatches.some(
      comment => comment.type === 'comment' && match.index >= comment.start && match.index < comment.end
    );
    if (!isInComment) {
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
    const isInOtherMark = allMatches.some(
      mark => match.index >= mark.start && match.index < mark.end
    );
    if (!isInOtherMark) {
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
    const isInOtherMark = allMatches.some(
      mark => match.index >= mark.start && match.index < mark.end
    );
    if (!isInOtherMark) {
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
