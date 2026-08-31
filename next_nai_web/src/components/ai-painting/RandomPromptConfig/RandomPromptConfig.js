// RandomPromptConfig.js
import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Tabs,
  Tab,
  Typography,
  IconButton,
  Divider,
  Switch,
  FormControlLabel,
  CircularProgress,
  Snackbar,
  Alert,
  useMediaQuery,
  useTheme
} from '@mui/material';
import {
  Close as CloseIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
  Casino as CasinoIcon
} from '@mui/icons-material';
import CategoryForm from './CategoryForm';
import CollectionForm from './CollectionForm';
import apiClient from '@/utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';
import { getPublicToolErrorMessageKey } from '@/utils/publicToolErrors.mjs';
import { forwardPaintingPanelError } from '../Generation/errorRecords.mjs';

// 实现类别内部词条轮询逻辑的工具函数
const processSequentialExtractionForCategoryItems = (category) => {
  if (!category || !category.items || category.items.length === 0) {
    return [];
  }

  const storageKey = `category_item_position_${category.id || category.name}`; // 使用ID确保唯一性
  let currentPosition = parseInt(localStorage.getItem(storageKey), 10);

  if (isNaN(currentPosition) || currentPosition === null) {
    currentPosition = category.startPosition || 0;
  }

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

// 随机提示词配置对话框
const RandomPromptConfig = ({ open, onClose, onInsert, onError = null }) => {
  const theme = useTheme();
  const { t } = useI18n();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [tabValue, setTabValue] = useState(0);
  const [categories, setCategories] = useState([]);
  const [collections, setCollections] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, messageKey: '', severity: 'info' });

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiClient.getRandomPromptConfig();
      setCategories(response.categories || []);
      setCollections(response.collections || []);
      setIsEnabled(response.enabled !== false);
    } catch (error) {
      console.error('加载随机提示词配置失败:', error);
      const messageKey = getPublicToolErrorMessageKey(
        error,
        'painting.tools.randomPrompt.errors.loadFailed',
      );
      forwardPaintingPanelError(onError, error, {
        source: 'random-prompt-config',
        messageKey,
      });
      setSnackbar({
        open: true,
        messageKey,
        severity: 'error'
      });
    } finally {
      setIsLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    if (open) {
      loadConfig();
    }
  }, [loadConfig, open]);

  const saveConfig = async () => {
    setIsLoading(true);
    try {
      await apiClient.saveRandomPromptConfig({
        categories,
        collections,
        enabled: isEnabled
      });
      setSnackbar({
        open: true,
        messageKey: 'painting.tools.randomPrompt.messages.saved',
        severity: 'success'
      });
    } catch (error) {
      console.error('保存随机提示词配置失败:', error);
      const messageKey = getPublicToolErrorMessageKey(
        error,
        'painting.tools.randomPrompt.errors.saveFailed',
      );
      forwardPaintingPanelError(onError, error, {
        source: 'random-prompt-config',
        messageKey,
      });
      setSnackbar({
        open: true,
        messageKey,
        severity: 'error'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };

  const handleCategoryChange = (updatedCategories) => {
    setCategories(updatedCategories);
  };

  const handleCollectionChange = (updatedCollections) => {
    setCollections(updatedCollections);
  };

  const handleEnableChange = (event) => {
    setIsEnabled(event.target.checked);
  };

  const handleInsertSyntax = (item, type) => {
    if (typeof onInsert === 'function') {
      const syntax = type === 'category'
        ? `<ran_id="${item.name}"/>`
        : `<ran_sorting_id="${item.name}"/>`;
      onInsert(syntax);
    }
  };

  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  // 生成示例提示词
  const generateExample = (item, type) => {
    if (!item) return '';

    if (type === 'category') {
      const category = item;
      if (!category || !category.items || category.items.length === 0) return '';

      const { items, extractCount, weightConfig, extractMode } = category;

      let selectedItems;
      if (extractMode === 'sequential') {
        selectedItems = processSequentialExtractionForCategoryItems(category);
      } else {
        selectedItems = [...items]
          .sort(() => 0.5 - Math.random())
          .slice(0, Math.min(extractCount || 1, items.length));
      }

      if (selectedItems.length === 0) return '';

      return selectedItems.map(word => {
        if (!weightConfig || weightConfig.type === 'none') {
          return word;
        } else if (weightConfig.type === 'fixed') {
          // 使用 n::文本:: 格式
          return `${weightConfig.fixedValue !== undefined ? weightConfig.fixedValue.toFixed(2) : '1.00'}::${word}::`;
        } else if (weightConfig.type === 'random') {
          const min = weightConfig.randomMin || 0;
          const max = weightConfig.randomMax || 1;
          const randomValue = (Math.random() * (max - min) + min).toFixed(2);
          // 使用 n::文本:: 格式
          return `${randomValue}::${word}::`;
        }
        return word;
      }).join(', ');

    } else if (type === 'collection') {
      const collection = item;
      if (!collection || !collection.categoryRefs || collection.categoryRefs.length === 0) return '';

      const { categoryRefs, randomOrder, useFixedWeight, fixedWeight,
        extractNCategories, numToExtract, categoryExtractMode, categoryStartPosition } = collection;

      let categoriesToProcess = [];
      const availableCategoriesInCollection = categoryRefs
        .map(ref => categories.find(c => c.id === ref.categoryId))
        .filter(Boolean);

      if (availableCategoriesInCollection.length === 0) return '';

      if (extractNCategories) {
        const numToPick = Math.min(numToExtract || 1, availableCategoriesInCollection.length);
        if (categoryExtractMode === 'sequential') {
          const storageKey = `collection_category_position_${collection.id || collection.name}`;
          let currentCollectionCatPos = parseInt(localStorage.getItem(storageKey), 10);

          if (isNaN(currentCollectionCatPos) || currentCollectionCatPos === null) {
            currentCollectionCatPos = categoryStartPosition || 0;
          }
          if (currentCollectionCatPos >= availableCategoriesInCollection.length) {
            currentCollectionCatPos = 0;
          }

          for (let i = 0; i < numToPick; i++) {
            const catIndex = (currentCollectionCatPos + i) % availableCategoriesInCollection.length;
            categoriesToProcess.push(availableCategoriesInCollection[catIndex]);
          }
          const nextCollectionCatPos = (currentCollectionCatPos + numToPick) % availableCategoriesInCollection.length;
          localStorage.setItem(storageKey, nextCollectionCatPos.toString());
        } else {
          categoriesToProcess = [...availableCategoriesInCollection]
            .sort(() => 0.5 - Math.random())
            .slice(0, numToPick);
        }
      } else {
        categoriesToProcess = availableCategoriesInCollection;
      }

      let allItemsFromCollection = [];
      categoriesToProcess.forEach(category => {
        if (!category || !category.items || category.items.length === 0) return;

        const { items, extractCount, weightConfig, extractMode } = category;
        let selectedItemsFromCategory;

        if (extractMode === 'sequential') {
          selectedItemsFromCategory = processSequentialExtractionForCategoryItems(category);
        } else {
          selectedItemsFromCategory = [...items]
            .sort(() => 0.5 - Math.random())
            .slice(0, Math.min(extractCount || 1, items.length));
        }

        if (selectedItemsFromCategory.length > 0) {
          const processedItems = selectedItemsFromCategory.map(word => {
            if (useFixedWeight) {
              return word;
            }
            if (!weightConfig || weightConfig.type === 'none') {
              return word;
            } else if (weightConfig.type === 'fixed') {
              // 使用 n::文本:: 格式
              return `${weightConfig.fixedValue !== undefined ? weightConfig.fixedValue.toFixed(2) : '1.00'}::${word}::`;
            } else if (weightConfig.type === 'random') {
              const min = weightConfig.randomMin || 0;
              const max = weightConfig.randomMax || 1;
              const randomValue = (Math.random() * (max - min) + min).toFixed(2);
              // 使用 n::文本:: 格式
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
        // 当使用集合固定权重时，allItemsFromCollection 应该已经是处理过的词条（可能是纯词条，也可能是 n::词条:: 格式）
        // 如果希望固定权重包住所有内容，需要先将所有词条提取为纯文本
        const plainWordsJoined = allItemsFromCollection.map(itemStr => {
          // 尝试去除已有的 n::X:: 包裹，只取 X 部分
          const match = itemStr.match(/^[\d.]+:?:(.*?):?:?$/);
          return match ? match[1] : itemStr;
        }).join(', ');

        if (plainWordsJoined) {
          // 使用 n::文本:: 格式
          return `${fixedWeight !== undefined ? fixedWeight.toFixed(2) : '1.00'}::${plainWordsJoined}::`;
        }
        return ''; // 如果没有有效内容，返回空
      } else {
        return allItemsFromCollection.join(', ');
      }
    }
    return '';
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      fullScreen={isMobile}
      PaperProps={{
        sx: { minHeight: isMobile ? '100%' : '80vh' }
      }}
    >
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" display="flex" alignItems="center">
            <CasinoIcon sx={{ mr: 1 }} /> {t('painting.tools.randomPrompt.title')}
          </Typography>
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={isEnabled}
                  onChange={handleEnableChange}
                  color="primary"
                />
              }
              label={t('painting.tools.randomPrompt.enable')}
            />
            <IconButton aria-label={t('painting.tools.common.close')} onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: isMobile ? 1 : 2 }}>
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
          >
            <Tab label={t('painting.tools.randomPrompt.tabs.categories')} />
            <Tab label={t('painting.tools.randomPrompt.tabs.collections')} />
            <Tab label={t('painting.tools.randomPrompt.tabs.help')} />
          </Tabs>
        </Box>

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
            {tabValue === 0 && (
              <CategoryForm
                categories={categories}
                onChange={handleCategoryChange}
                onInsert={item => handleInsertSyntax(item, 'category')}
                generateExample={item => generateExample(item, 'category')}
              />
            )}

            {tabValue === 1 && (
              <CollectionForm
                collections={collections}
                categories={categories}
                onChange={handleCollectionChange}
                onInsert={item => handleInsertSyntax(item, 'collection')}
                generateExample={item => generateExample(item, 'collection')}
              />
            )}

            {tabValue === 2 && (
              <Box sx={{ p: isMobile ? 2 : 3 }}>
                <Typography variant="h6" gutterBottom>{t('painting.tools.randomPrompt.help.title')}</Typography>
                <Typography variant="body1" paragraph>{t('painting.tools.randomPrompt.help.intro')}</Typography>

                <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>{t('painting.tools.randomPrompt.help.categoriesTitle')}</Typography>
                <Typography variant="body2" paragraph sx={{ whiteSpace: 'pre-line' }}>{t('painting.tools.randomPrompt.help.categoriesBody')}</Typography>

                <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>{t('painting.tools.randomPrompt.help.collectionsTitle')}</Typography>
                <Typography variant="body2" paragraph sx={{ whiteSpace: 'pre-line' }}>{t('painting.tools.randomPrompt.help.collectionsBody')}</Typography>

                <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>{t('painting.tools.randomPrompt.help.usageTitle')}</Typography>
                <Typography variant="body2" paragraph>{t('painting.tools.randomPrompt.help.usageBody')}</Typography>
                <Box sx={{ bgcolor: 'rgba(0,0,0,0.05)', p: 2, borderRadius: 1, my: 2, fontFamily: '"Roboto Mono", monospace' }}>
                  {t('painting.tools.randomPrompt.help.categorySyntax')}: <code>&lt;ran_id=&quot;category-name&quot;/&gt;</code><br />
                  {t('painting.tools.randomPrompt.help.collectionSyntax')}: <code>&lt;ran_sorting_id=&quot;collection-name&quot;/&gt;</code>
                </Box>
                <Typography variant="body2" paragraph>
                  {t('painting.tools.randomPrompt.help.example')}: <code>1girl, &lt;ran_id=&quot;hair-color&quot;/&gt;, &lt;ran_sorting_id=&quot;outfit&quot;/&gt;, best quality</code>
                </Typography>

                <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>{t('painting.tools.randomPrompt.help.resultTitle')}</Typography>
                <Typography variant="body2" paragraph sx={{ whiteSpace: 'pre-line' }}>{t('painting.tools.randomPrompt.help.resultBody')}</Typography>
                <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>{t('painting.tools.randomPrompt.help.weightTitle')}</Typography>
                <Typography variant="body2" paragraph>{t('painting.tools.randomPrompt.help.weightBody')}</Typography>
              </Box>
            )}
          </Box>
        )}
      </DialogContent>

      <Divider />

      <DialogActions sx={{ p: isMobile ? 1.5 : 2 }}>
        <Button
          startIcon={<RefreshIcon />}
          onClick={loadConfig}
          disabled={isLoading}
          size={isMobile ? "small" : "medium"}
        >
          {t('painting.tools.common.refresh')}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          onClick={onClose}
          disabled={isLoading}
          size={isMobile ? "small" : "medium"}
        >
          {t('painting.tools.common.cancel')}
        </Button>
        <Button
          variant="contained"
          color="primary"
          startIcon={<SaveIcon />}
          onClick={saveConfig}
          disabled={isLoading}
          size={isMobile ? "small" : "medium"}
        >
          {t('painting.tools.randomPrompt.saveConfig')}
        </Button>
      </DialogActions>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={handleCloseSnackbar}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.messageKey ? t(snackbar.messageKey) : ''}
        </Alert>
      </Snackbar>
    </Dialog>
  );
};

export default RandomPromptConfig;
