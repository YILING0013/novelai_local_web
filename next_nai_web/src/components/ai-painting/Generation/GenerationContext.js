import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { applyAutomaticWatermark } from '../ImageProcessing/quickImageAdjustments';
import useImageGeneration from './useImageGeneration';
import { Alert, Snackbar } from '@mui/material';
import { useI18n } from '@/i18n/I18nProvider';
import { restoreImageHistory, writeImageHistory } from './localImageHistory';
import { revokeObjectUrl } from '@/utils/mediaAssets';

const GenerationContext = createContext();

const revokeGeneratedItemUrls = (item) => {
  if (!item) return;
  new Set([
    item.objectUrlToRevoke,
    item.src,
    item.originalSrc,
    item.downloadSrc,
  ].filter(Boolean)).forEach(revokeObjectUrl);
};

export const GenerationProvider = ({ children, demoImages = null, owner, directory = '' }) => {
  const {
    isGenerating,
    generationStatus,
    startGeneration,
    resetGeneration,
    batchStatus,
    startBatchGeneration,
    cancelBatchGeneration,
  } = useImageGeneration(applyAutomaticWatermark);
  const [generatedItems, setGeneratedItems] = useState(demoImages ?? []);
  const [currentItem, setCurrentItem] = useState(demoImages?.[0] ?? null);
  const [selectedByGeneration, setSelectedByGeneration] = useState(false);
  const generatedItemsRef = useRef([]);
  const writes = useRef(Promise.resolve());
  const removed = useRef(new Set());
  const [historyError, setHistoryError] = useState(false);
  const { locale } = useI18n();
  useEffect(() => {
    if (!owner) return;
    let active = true;
    restoreImageHistory(owner, directory).then(items => {
      if (!active) { items.forEach(revokeGeneratedItemUrls); return; }
      const restored = items.filter(item => !removed.current.has(item.id));
      setGeneratedItems(previous => [...restored.filter(row => !previous.some(item => item.id === row.id)), ...previous]);
      const selection = sessionStorage.getItem('nai-local-selected-image');
      setCurrentItem(previous => previous || restored.find(item => item.id === selection) || restored.at(-1) || null);
    }).catch(() => { if (active) setHistoryError(true); });
    return () => { active = false; };
  }, [owner, directory]);
  const persist = useCallback((item, remove = false) => {
    if (!owner || item.type !== 'image') return;
    writes.current = writes.current.then(() => writeImageHistory(owner, directory, item, remove))
      .catch(() => setHistoryError(true));
  }, [owner, directory]);

  useEffect(() => {
    generatedItemsRef.current = generatedItems;
  }, [generatedItems]);

  useEffect(() => () => {
    generatedItemsRef.current.forEach(revokeGeneratedItemUrls);
  }, []);

  const appendGeneratedItem = useCallback((item) => {
    if (!item) return null;
    const normalizedItem = {
      type: 'image',
      ...item,
      id: item.id || `image-${Date.now()}-${Math.random()}`,
    };
    setGeneratedItems((previous) => [...previous, normalizedItem]);
    setSelectedByGeneration(normalizedItem.isGenerationResult === true);
    setCurrentItem(normalizedItem);
    persist(normalizedItem);
    return normalizedItem;
  }, [persist]);

  const updateGeneratedItem = useCallback((itemId, updates) => {
    if (!itemId || !updates) return;
    setGeneratedItems((previous) => previous.map((item) => (
      item.id === itemId ? { ...item, ...updates } : item
    )));
    setCurrentItem((previous) => (
      previous?.id === itemId ? { ...previous, ...updates } : previous
    ));
  }, []);

  const generate = useCallback(async (params) => {
    resetGeneration();
    const imageResult = await startGeneration(params);
    return imageResult ? appendGeneratedItem({ ...imageResult, type: 'image', isGenerationResult: true }) : null;
  }, [appendGeneratedItem, resetGeneration, startGeneration]);

  const generatePreview = useCallback(async (params) => {
    resetGeneration();
    const imageResult = await startGeneration(params, { previewOnly: true });
    return imageResult ? { ...imageResult, type: 'image' } : null;
  }, [resetGeneration, startGeneration]);

  const generateBatchImages = useCallback(async (params, onImageCallback, onErrorNotify) => {
    resetGeneration();
    return startBatchGeneration(
      params,
      (newImage) => {
        const newItem = appendGeneratedItem({ ...newImage, type: 'image', isGenerationResult: true });
        if (typeof onImageCallback === 'function') onImageCallback(newItem);
      },
      onErrorNotify,
    );
  }, [appendGeneratedItem, resetGeneration, startBatchGeneration]);

  const selectItem = useCallback((itemId) => {
    const selected = generatedItems.find((item) => item.id === itemId);
    if (selected) {
      setSelectedByGeneration(false);
      setCurrentItem(selected);
      if (owner) sessionStorage.setItem("nai-local-selected-image", itemId);
    }
  }, [generatedItems, owner]);

  const deleteItem = useCallback((itemId) => {
    const itemToDelete = generatedItemsRef.current.find(item => item.id === itemId);
    if (itemToDelete) {
      removed.current.add(itemId);
      persist(itemToDelete, true);
    }
    setGeneratedItems((previous) => {
      const remaining = previous.filter((item) => item.id !== itemId);
      revokeGeneratedItemUrls(itemToDelete);
      if (currentItem?.id === itemId) { setSelectedByGeneration(false); setCurrentItem(remaining.at(-1) || null); }
      return remaining;
    });
  }, [currentItem, persist]);

  const contextValue = {
    isGenerating,
    generationStatus,
    generatedItems,
    currentItem, selectedByGeneration,
    batchStatus,
    generate,
    generatePreview,
    appendGeneratedItem,
    updateGeneratedItem,
    resetGeneration,
    selectItem,
    deleteItem,
    generateBatchImages,
    cancelBatchGeneration,
  };

  return (
    <GenerationContext.Provider value={contextValue}>
      {children}
      <Snackbar open={historyError} onClose={() => setHistoryError(false)}>
        <Alert severity="warning" onClose={() => setHistoryError(false)}>{locale === 'zh-CN' ? '无法读写本机生成历史。' : 'Could not read or write local image history.'}</Alert>
      </Snackbar>
    </GenerationContext.Provider>
  );
};

export const useGeneration = () => {
  const context = useContext(GenerationContext);
  if (!context) throw new Error('useGeneration must be used within GenerationProvider');
  return context;
};
