import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import useImageGeneration from './useImageGeneration';
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

export const GenerationProvider = ({ children }) => {
  const {
    isGenerating,
    generationStatus,
    startGeneration,
    resetGeneration,
    batchStatus,
    startBatchGeneration,
    cancelBatchGeneration,
  } = useImageGeneration();
  const [generatedItems, setGeneratedItems] = useState([]);
  const [currentItem, setCurrentItem] = useState(null);
  const generatedItemsRef = useRef([]);

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
    setCurrentItem(normalizedItem);
    return normalizedItem;
  }, []);

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
    return imageResult ? appendGeneratedItem({ ...imageResult, type: 'image' }) : null;
  }, [appendGeneratedItem, resetGeneration, startGeneration]);

  const generatePreview = useCallback(async (params) => {
    resetGeneration();
    const imageResult = await startGeneration(params);
    return imageResult ? { ...imageResult, type: 'image' } : null;
  }, [resetGeneration, startGeneration]);

  const generateBatchImages = useCallback(async (params, onImageCallback, onErrorNotify) => {
    resetGeneration();
    return startBatchGeneration(
      params,
      (newImage) => {
        const newItem = appendGeneratedItem({ ...newImage, type: 'image' });
        if (typeof onImageCallback === 'function') onImageCallback(newItem);
      },
      onErrorNotify,
    );
  }, [appendGeneratedItem, resetGeneration, startBatchGeneration]);

  const selectItem = useCallback((itemId) => {
    const selected = generatedItems.find((item) => item.id === itemId);
    if (selected) setCurrentItem(selected);
  }, [generatedItems]);

  const deleteItem = useCallback((itemId) => {
    setGeneratedItems((previous) => {
      const itemToDelete = previous.find((item) => item.id === itemId);
      const remaining = previous.filter((item) => item.id !== itemId);
      revokeGeneratedItemUrls(itemToDelete);
      if (currentItem?.id === itemId) setCurrentItem(remaining.at(-1) || null);
      return remaining;
    });
  }, [currentItem]);

  const contextValue = {
    isGenerating,
    generationStatus,
    generatedItems,
    currentItem,
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
    </GenerationContext.Provider>
  );
};

export const useGeneration = () => {
  const context = useContext(GenerationContext);
  if (!context) throw new Error('useGeneration must be used within GenerationProvider');
  return context;
};
