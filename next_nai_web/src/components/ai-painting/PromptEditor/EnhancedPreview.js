// EnhancedPreview.js
import React, { useState, useEffect } from 'react';
import { Box, Typography, Tooltip, Paper, Chip } from '@mui/material';
// formatPromptWithHighlighting from promptUtils is not used here directly for main formatting,
// but enhancedFormatPromptWithHighlighting is defined and used within this file.
// import { formatPromptWithHighlighting } from './promptUtils'; 
import {
  Casino as CasinoIcon,
  PlaylistPlay as SequentialIcon,
  Loop as LoopIcon,
  Info as InfoIcon,
  Shuffle as ShuffleIcon // 新增图标
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

// 扩展formatPromptWithHighlighting函数以识别随机标签和集合
export const enhancedFormatPromptWithHighlighting = (text, randomPromptConfig = null) => {
  if (!text) return [{ text: '', type: 'normal' }];
  
  const segments = [];
  let lastIndex = 0;
  const allMatches = [];
  const commentRegex = /\/\*[\s\S]*?\*\//g;
  let match;
  
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
  
  const numberWeightRegex = /([-]?\d+(\.\d+)?)::(.*?)::/g;
  while ((match = numberWeightRegex.exec(text)) !== null) {
    const isInOtherMark = allMatches.some(
      mark => match.index >= mark.start && match.index < mark.end
    );
    if (!isInOtherMark) {
      const weightValue = parseFloat(match[1]);
      let type;
      if (weightValue < 0) {
        type = 'weight-negative'; 
      } else if (weightValue >= 1) {
        type = 'weight-up';
      } else {
        type = 'weight-down';
      }
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: type,
        weightValue: weightValue
      });
    }
  }
  
  const randomTagRegex = /<ran_id="([^"]+)"\s*\/>/g;
  while ((match = randomTagRegex.exec(text)) !== null) {
    const categoryName = match[1];
    const categoryInfo = randomPromptConfig?.categories?.find(c => c.name === categoryName);
    const isInOtherMark = allMatches.some(
      mark => match.index >= mark.start && match.index < mark.end
    );
    if (!isInOtherMark) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: 'random-tag',
        categoryName: categoryName,
        categoryInfo: categoryInfo || null
      });
    }
  }
  
  const randomCollectionRegex = /<ran_sorting_id="([^"]+)"\s*\/>/g;
  while ((match = randomCollectionRegex.exec(text)) !== null) {
    const collectionName = match[1];
    const collectionInfo = randomPromptConfig?.collections?.find(c => c.name === collectionName);
    const isInOtherMark = allMatches.some(
      mark => match.index >= mark.start && match.index < mark.end
    );
    if (!isInOtherMark) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: 'random-collection',
        collectionName: collectionName,
        collectionInfo: collectionInfo || null
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
        ...match, // Spread match to include all its properties like categoryInfo, collectionInfo
        text: match.text // Ensure text property is explicitly set
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

// 辅助函数: 获取随机标签的预览内容 - 更新 localStorage key
const getRandomTagPreview = (categoryInfo, t) => {
  if (!categoryInfo) return t('painting.tools.promptEditor.preview.categoryNotFound');
  
  const { name, items, extractCount, weightConfig, extractMode, startPosition, id } = categoryInfo;
  
  let currentItemPositionDisplay = startPosition || 0; // 用于UI显示的配置起始点
  let actualCurrentItemPosition = startPosition || 0; // 用于计算预览词条的实际轮询位置

  if (extractMode === 'sequential') {
    // 使用ID确保唯一性 (与 promptUtils.js 和 RandomPromptConfig.js 一致)
    const storageKey = `category_item_position_${id || name}`; 
    const storedPosition = localStorage.getItem(storageKey);
    if (storedPosition !== null) {
        const parsedStoredPosition = parseInt(storedPosition, 10);
        if (!isNaN(parsedStoredPosition)) {
            actualCurrentItemPosition = parsedStoredPosition; // 实际轮询位置
        }
    }
    // 确保实际轮询位置有效
    if (actualCurrentItemPosition >= (items?.length || 0)) {
      actualCurrentItemPosition = 0;
    }
  }
  
  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 'bold' }}>
        {t('painting.tools.promptEditor.preview.category')}: {name}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        <Chip 
          size="small" 
          label={t('painting.tools.promptEditor.preview.extractCount', { count: extractCount || 1 })}
          color="primary"
          variant="outlined"
        />
        <Chip 
          size="small" 
          icon={extractMode === 'random' ? <CasinoIcon fontSize="small" /> : <SequentialIcon fontSize="small" />}
          label={extractMode === 'random'
            ? t('painting.tools.randomPrompt.modes.random')
            : t('painting.tools.randomPrompt.modes.sequential')}
          color="secondary"
          variant="outlined"
        />
      </Box>
      
      {extractMode === 'sequential' && (
        <Typography variant="body2" gutterBottom sx={{ 
          display: 'flex', 
          alignItems: 'center',
          bgcolor: 'rgba(0,0,0,0.03)',
          p: 1, 
          borderRadius: 1,
          fontSize: '0.8rem'
        }}>
          <LoopIcon fontSize="small" sx={{ mr: 0.5 }} />
          {t('painting.tools.promptEditor.preview.nextItem')}: {items && items[actualCurrentItemPosition] ? `${actualCurrentItemPosition}: ${items[actualCurrentItemPosition]}` : t('painting.tools.common.notAvailable')}
          <Tooltip title={t('painting.tools.promptEditor.preview.configuredStart', { position: startPosition || 0 })} arrow placement="top">
            <InfoIcon fontSize="inherit" sx={{ ml: 0.5, opacity: 0.6, cursor: 'help' }} />
          </Tooltip>
        </Typography>
      )}
      
      <Typography variant="body2" gutterBottom>
        {t('painting.tools.promptEditor.preview.weightType')}: {
          !weightConfig || weightConfig.type === 'none'
            ? t('painting.tools.randomPrompt.weights.none')
            : weightConfig.type === 'fixed'
              ? t('painting.tools.promptEditor.preview.fixedWeight', { value: weightConfig.fixedValue })
              : weightConfig.type === 'random'
                ? t('painting.tools.promptEditor.preview.randomWeight', { min: weightConfig.randomMin, max: weightConfig.randomMax })
                : t('painting.tools.promptEditor.preview.notConfigured')
        }
      </Typography>
      <Typography variant="caption">{t('painting.tools.promptEditor.preview.items')} ({items?.length || 0}):</Typography>
      <Box 
        component="ul" 
        sx={{ 
          mt: 0.5, 
          pl: 2, 
          maxHeight: '150px', 
          overflowY: 'auto',
          bgcolor: 'rgba(0,0,0,0.03)',
          borderRadius: 1,
          p: 1
        }}
      >
        {items && items.length > 0 ? (
          items.map((item, idx) => (
            <Box 
              component="li" 
              key={idx} 
              sx={{ 
                fontSize: '0.8rem',
                ...(extractMode === 'sequential' && idx === actualCurrentItemPosition ? { // 高亮实际轮询位置
                  fontWeight: 'bold',
                  color: 'secondary.main',
                  bgcolor: 'rgba(124, 77, 255, 0.1)',
                  p: 0.5,
                  borderRadius: 1,
                  position: 'relative',
                } : {})
              }}
            >
              {extractMode === 'sequential' && idx === actualCurrentItemPosition && (
                <Typography 
                  component="span" 
                  variant="caption" 
                  sx={{ 
                    position: 'absolute',
                    right: 4,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'secondary.main',
                    fontSize: '0.7rem',
                  }}
                >
                  {t('painting.tools.promptEditor.preview.current')}
                </Typography>
              )}
              {item}
            </Box>
          ))
        ) : (
          <Typography variant="caption" color="text.secondary">
            {t('painting.tools.randomPrompt.category.noItems')}
          </Typography>
        )}
      </Box>
    </Box>
  );
};

// 辅助函数: 获取随机集合的预览内容 - 更新以显示新配置和轮询状态
const getRandomCollectionPreview = (collectionInfo, randomPromptConfig, t) => {
  if (!collectionInfo) return t('painting.tools.promptEditor.preview.collectionNotFound');
  
  const { 
    id, name, categoryRefs, randomOrder, useFixedWeight, fixedWeight,
    extractNCategories, numToExtract, categoryExtractMode, categoryStartPosition 
  } = collectionInfo;
  
  const categoriesInCollection = categoryRefs?.map(ref => {
    return randomPromptConfig?.categories?.find(c => c.id === ref.categoryId);
  }).filter(Boolean) || [];

  let currentCategoryPositionDisplay = categoryStartPosition || 0; // UI显示的配置起始点
  let actualCurrentCategoryPosition = categoryStartPosition || 0; // 实际轮询位置

  if (extractNCategories && categoryExtractMode === 'sequential' && categoriesInCollection.length > 0) {
    // 使用ID确保唯一性 (与 promptUtils.js 和 RandomPromptConfig.js 一致)
    const storageKey = `collection_category_position_${id || name}`;
    const storedPosition = localStorage.getItem(storageKey);
    if (storedPosition !== null) {
        const parsedStoredPosition = parseInt(storedPosition, 10);
        if(!isNaN(parsedStoredPosition)) {
            actualCurrentCategoryPosition = parsedStoredPosition;
        }
    }
    if (actualCurrentCategoryPosition >= categoriesInCollection.length) {
      actualCurrentCategoryPosition = 0;
    }
  }
  
  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 'bold' }}>
        {t('painting.tools.promptEditor.preview.collection')}: {name}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        <Chip 
          size="small" 
          icon={<ShuffleIcon fontSize="small"/>}
          label={randomOrder
            ? t('painting.tools.randomPrompt.collection.shuffleItems')
            : t('painting.tools.promptEditor.preview.fixedOrder')}
          color={randomOrder ? "primary" : "default"}
          variant="outlined"
        />
        {useFixedWeight && (
          <Chip 
            size="small" 
            label={t('painting.tools.promptEditor.preview.fixedWeightLabel', { value: fixedWeight })}
            color="info"
            variant="outlined"
          />
        )}
      </Box>

      <Typography variant="body2" gutterBottom sx={{mt:1.5, fontWeight:'500'}}>{t('painting.tools.promptEditor.preview.categoryProcessing')}:</Typography>
      {extractNCategories ? (
        <>
          <Chip 
            size="small" 
            label={t('painting.tools.randomPrompt.collection.extractCategoryCount', { count: numToExtract })}
            color="success"
            variant="outlined"
            sx={{ mr: 1, mb: 0.5 }}
          />
          <Chip 
            size="small" 
            icon={categoryExtractMode === 'random' ? <CasinoIcon fontSize="small" /> : <SequentialIcon fontSize="small" />}
            label={categoryExtractMode === 'random'
              ? t('painting.tools.randomPrompt.collection.randomCategoriesShort')
              : t('painting.tools.randomPrompt.collection.sequentialCategoriesShort')}
            color="warning"
            variant="outlined"
            sx={{ mb: 0.5 }}
          />
          {categoryExtractMode === 'sequential' && categoriesInCollection.length > 0 && (
            <Typography variant="body2" gutterBottom sx={{ 
              display: 'flex', 
              alignItems: 'center',
              bgcolor: 'rgba(0,0,0,0.03)',
              p: 1, 
              borderRadius: 1,
              fontSize: '0.8rem',
              mt: 0.5
            }}>
              <LoopIcon fontSize="small" sx={{ mr: 0.5 }} />
              {t('painting.tools.promptEditor.preview.nextCategory')}: {categoriesInCollection[actualCurrentCategoryPosition]?.name ? `${actualCurrentCategoryPosition}: ${categoriesInCollection[actualCurrentCategoryPosition].name}` : t('painting.tools.common.notAvailable')}
               <Tooltip title={t('painting.tools.promptEditor.preview.configuredCategoryStart', { position: categoryStartPosition || 0 })} arrow placement="top">
                <InfoIcon fontSize="inherit" sx={{ ml: 0.5, opacity: 0.6, cursor: 'help' }} />
              </Tooltip>
            </Typography>
          )}
        </>
      ) : (
        <Chip 
          size="small" 
          label={t('painting.tools.promptEditor.preview.processAllSelected')}
          variant="outlined"
          sx={{ mb: 1 }}
        />
      )}
      
      <Typography variant="caption">{t('painting.tools.randomPrompt.collection.includedCategories')} ({categoriesInCollection.length}):</Typography>
      <Box 
        component="ul" 
        sx={{ 
          mt: 0.5, 
          pl: 2, 
          maxHeight: '100px', // 调整最大高度
          overflowY: 'auto',
          bgcolor: 'rgba(0,0,0,0.03)',
          borderRadius: 1,
          p: 1
        }}
      >
        {categoriesInCollection.length > 0 ? (
          categoriesInCollection.map((category, idx) => (
            <Box 
              component="li" 
              key={idx} 
              sx={{ 
                fontSize: '0.8rem',
                ...(extractNCategories && categoryExtractMode === 'sequential' && idx === actualCurrentCategoryPosition ? { // 高亮实际轮询的类别
                  fontWeight: 'bold',
                  color: 'warning.dark', // 使用不同的高亮颜色
                  bgcolor: 'rgba(255, 167, 38, 0.1)', // 橙色系背景
                  p: 0.5,
                  borderRadius: 1,
                  position: 'relative',
                } : {})
              }}
            >
              {category.name} 
              <Box component="span" sx={{ ml: 0.5 }}>
                <Chip 
                  size="small" 
                  label={category.extractMode === 'random'
                    ? t('painting.tools.randomPrompt.modes.randomShort')
                    : t('painting.tools.randomPrompt.modes.sequentialShort')}
                  color={category.extractMode === 'random' ? 'primary' : 'secondary'}
                  sx={{ height: 16, '& .MuiChip-label': { px: 0.5, fontSize: '0.65rem' } }}
                />
                 {extractNCategories && categoryExtractMode === 'sequential' && idx === actualCurrentCategoryPosition && (
                    <Typography 
                    component="span" 
                    variant="caption" 
                    sx={{ 
                        position: 'absolute',
                        right: 4,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'warning.dark',
                        fontSize: '0.7rem',
                    }}
                    >
                    {t('painting.tools.promptEditor.preview.current')}
                    </Typography>
                )}
              </Box>
            </Box>
          ))
        ) : (
          <Typography variant="caption" color="text.secondary">
            {t('painting.tools.promptEditor.preview.noRelatedCategories')}
          </Typography>
        )}
      </Box>
    </Box>
  );
};

// 自定义段落渲染组件
const SegmentRenderer = ({ segment, randomPromptConfig, t }) => {
  // ... (保持 SegmentRenderer 的其他 type 处理不变)
  if (segment.type === 'comment') {
    return (
      <Typography component="span" sx={{ color: 'grey.500', backgroundColor: 'rgba(0, 0, 0, 0.05)', textDecoration: 'line-through', borderRadius: '2px', padding: '1px 0', fontFamily: 'inherit', fontSize: 'inherit' }}>
        {segment.text}
      </Typography>
    );
  } else if (segment.type === 'weight-up') {
    return (
      <Typography component="span" sx={{ backgroundColor: 'rgba(255, 0, 0, 0.2)', borderRadius: '2px', padding: '1px 2px', fontFamily: 'inherit', fontSize: 'inherit' }}>
        {segment.text}
      </Typography>
    );
  } else if (segment.type === 'weight-down') {
    return (
      <Typography component="span" sx={{ backgroundColor: 'rgba(0, 60, 255, 0.2)', borderRadius: '2px', padding: '1px 2px', fontFamily: 'inherit', fontSize: 'inherit' }}>
        {segment.text}
      </Typography>
    );
  } else if (segment.type === 'weight-negative') {
    return (
      <Typography component="span" sx={{ backgroundColor: 'rgba(0, 20, 255, 0.2)', color: 'error.dark', borderRadius: '2px', padding: '1px 2px', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'bold', border: '1px dashed rgba(25, 0, 255, 0.5)'}}>
        {segment.text}
      </Typography>
    );
  } else if (segment.type === 'random-tag') {
    return (
      <Tooltip
        title={<Paper sx={{ p: 1, maxWidth: 320 }}>{getRandomTagPreview(segment.categoryInfo, t)}</Paper>}
        arrow placement="top"
        componentsProps={{ tooltip: { sx: { bgcolor: 'background.paper', color: 'text.primary', boxShadow: 3, '& .MuiTooltip-arrow': { color: 'background.paper' } } } }}
      >
        <Typography component="span" sx={{ borderBottom: '1px dashed purple', cursor: 'help', fontFamily: 'inherit', fontSize: 'inherit', position: 'relative', '&::after': { content: '"ⓡ"', fontSize: '0.7em', verticalAlign: 'super', color: 'purple', ml: 0.5 }}}>
          {segment.categoryName}
        </Typography>
      </Tooltip>
    );
  } else if (segment.type === 'random-collection') {
    return (
      <Tooltip
        title={<Paper sx={{ p: 1, maxWidth: 320 }}>{getRandomCollectionPreview(segment.collectionInfo, randomPromptConfig, t)}</Paper>}
        arrow placement="top"
        componentsProps={{ tooltip: { sx: { bgcolor: 'background.paper', color: 'text.primary', boxShadow: 3, '& .MuiTooltip-arrow': { color: 'background.paper' } } } }}
      >
        <Typography component="span" sx={{ borderBottom: '1px dashed teal', cursor: 'help', fontFamily: 'inherit', fontSize: 'inherit', position: 'relative', '&::after': { content: '"ⓒ"', fontSize: '0.7em', verticalAlign: 'super', color: 'teal', ml: 0.5 }}}>
          {segment.collectionName}
        </Typography>
      </Tooltip>
    );
  } else {
    return segment.text;
  }
};

// 仿生学阅读函数
const bionicRead = (word) => {
  if (!word || word.length <= 1) return word;
  const boldLength = Math.ceil(word.length / 2);
  const boldPart = word.substring(0, boldLength);
  const normalPart = word.substring(boldLength);
  return (<><b>{boldPart}</b>{normalPart}</>);
};

// 处理句子中的每个单词
const processBionicText = (text) => {
  const pattern = /([a-zA-Z0-9]+)|([^a-zA-Z0-9\s]+)/g;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    if (match[1]) { 
      parts.push(<span key={`word-${match.index}`}>{bionicRead(match[0])}</span>);
    } else if (match[2]) { 
      const chars = match[0].split('');
      parts.push(<span key={`word-${match.index}`}>{chars.map((char, i) => <span key={i}>{bionicRead(char)}</span>)}</span>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  return parts;
};

const EnhancedPreview = ({ text, randomPromptConfig }) => {
  const { t } = useI18n();
  const [segments, setSegments] = useState([]);
  
  useEffect(() => {
    if (text) {
      const formattedSegments = enhancedFormatPromptWithHighlighting(text, randomPromptConfig);
      setSegments(formattedSegments);
    } else {
      setSegments([]);
    }
  }, [text, randomPromptConfig]);
  
  if (!text) return null;
  
  return (
    <Paper 
      elevation={0} 
      sx={{ p: 2, height: '100%', overflowY: 'auto', bgcolor: 'rgba(0, 0, 0, 0.02)', borderRadius: 2, border: '1px dashed rgba(0, 0, 0, 0.1)'}}
    >
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {t('painting.tools.promptEditor.preview.title')}:
      </Typography>
      <Box sx={{ fontFamily: '"Roboto Mono", monospace', fontSize: '13px', lineHeight: 1.5 }}>
        {segments.map((segment, index) => (
          <React.Fragment key={index}>
            {segment.type === 'normal' ? (
              processBionicText(segment.text)
            ) : (
              <SegmentRenderer segment={segment} randomPromptConfig={randomPromptConfig} t={t} />
            )}
          </React.Fragment>
        ))}
      </Box>
    </Paper>
  );
};

export default EnhancedPreview;
