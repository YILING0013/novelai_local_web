"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Tooltip,
  Slider,
  Select,
  MenuItem,
  FormControl,
  Paper,
  Stack,
} from '@mui/material';
import {
  Info as InfoIcon,
  Delete as DeleteIcon,
  PhotoCamera as PhotoCameraIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

// 辅助函数：生成 HMAC-SHA256
const generateHMAC = async (key, message) => {
  if (!key || !message) return null;
  try {
    const enc = new TextEncoder();
    const keyData = enc.encode(key);
    const msgData = enc.encode(message);

    const cryptoKey = await window.crypto.subtle.importKey(
      "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const signature = await window.crypto.subtle.sign("HMAC", cryptoKey, msgData);
    return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    console.error("HMAC Generation Failed", e);
    return null;
  }
};

// 生成随机密钥
const generateRandomKey = () => {
  if (typeof window === 'undefined') return '';
  const array = new Uint8Array(32);
  window.crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
};

const ImageReferenceControl = ({ onReferenceImageChange, disabled = false }) => {
  const { t } = useI18n();
  // 多图状态: { id, data: base64, displayUrl, type, strength, fidelity, disabled, cache_secret_key }
  const [images, setImages] = useState([]);
  const [masterKey, setMasterKey] = useState('');
  const refImageInputRef = useRef(null);

  // 初始化 masterKey（页面加载时生成一次）
  useEffect(() => {
    setMasterKey(generateRandomKey());
  }, []);

  // 当 masterKey 变化或新图片添加时，为没有 key 的图片生成 cache_secret_key
  useEffect(() => {
    if (!masterKey) return;

    let isMounted = true;
    const updateKeys = async () => {
      let hasUpdates = false;
      const updatedImages = await Promise.all(images.map(async (img) => {
        if (!img.data || img.cache_secret_key) return img;

        const newKey = await generateHMAC(masterKey, img.data);
        if (newKey) {
          hasUpdates = true;
          return { ...img, cache_secret_key: newKey };
        }
        return img;
      }));

      if (hasUpdates && isMounted) {
        setImages(updatedImages);
      }
    };

    updateKeys();
    return () => { isMounted = false; };
  }, [masterKey, images]);

  // 使用 ref 保持回调函数的稳定引用，避免 useEffect 无限循环
  const onReferenceImageChangeRef = useRef(onReferenceImageChange);
  useEffect(() => {
    onReferenceImageChangeRef.current = onReferenceImageChange;
  }, [onReferenceImageChange]);

  // 通知父组件参数变化
  useEffect(() => {
    if (disabled) return;

    // 过滤掉被禁用或没有 key 的图片
    const activeImages = images.filter(img => !img.disabled && img.cache_secret_key);

    if (activeImages.length === 0) {
      if (onReferenceImageChangeRef.current) {
        onReferenceImageChangeRef.current(null);
      }
      return;
    }

    // 构建参数
    const cachedImages = activeImages.map(img => ({
      cache_secret_key: img.cache_secret_key,
      data: img.data
    }));

    const descriptions = activeImages.map(img => ({
      caption: {
        base_caption: img.type || "character",
        char_captions: []
      },
      legacy_uc: false
    }));

    const strengthValues = activeImages.map(img => img.strength ?? 0.6);
    const secondaryStrengthValues = activeImages.map(img => {
      const fid = img.fidelity ?? 1.0;
      return parseFloat((1 - fid).toFixed(2));
    });
    const infoExtracted = activeImages.map(() => 1);

    if (onReferenceImageChangeRef.current) {
      onReferenceImageChangeRef.current({
        director_reference_images_cached: cachedImages,
        director_reference_descriptions: descriptions,
        director_reference_strength_values: strengthValues,
        director_reference_secondary_strength_values: secondaryStrengthValues,
        director_reference_information_extracted: infoExtracted,
      });
    }

  }, [images, disabled]);

  // 添加图片处理
  const handleFileSelect = (e) => {
    if (images.length >= 12) {
      alert(t('painting.workspace.parameters.referenceImageLimit', { max: 12 }));
      return;
    }

    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 6 * 1024 * 1024) {
      alert(t('painting.workspace.parameters.referenceImageSizeLimit', { size: '6 MB' }));
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const originalW = img.naturalWidth;
        const originalH = img.naturalHeight;
        const originalRatio = originalW / originalH;

        const targets = [
          { w: 1024, h: 1536 },
          { w: 1536, h: 1024 },
          { w: 1472, h: 1472 },
        ];

        let bestTarget = targets[0];
        let minDiff = Math.abs(originalRatio - bestTarget.w / bestTarget.h);

        for (let i = 1; i < targets.length; i++) {
          const target = targets[i];
          const targetRatio = target.w / target.h;
          const diff = Math.abs(originalRatio - targetRatio);
          if (diff < minDiff) {
            minDiff = diff;
            bestTarget = target;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = bestTarget.w;
        canvas.height = bestTarget.h;
        const ctx = canvas.getContext('2d');

        let newW, newH;
        if (originalRatio > bestTarget.w / bestTarget.h) {
          newW = bestTarget.w;
          newH = bestTarget.w / originalRatio;
        } else {
          newH = bestTarget.h;
          newW = bestTarget.h * originalRatio;
        }

        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const offsetX = (canvas.width - newW) / 2;
        const offsetY = (canvas.height - newH) / 2;
        ctx.drawImage(img, offsetX, offsetY, newW, newH);

        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1];

        setImages(prev => [
          ...prev,
          {
            id: Date.now() + Math.random(),
            data: base64,
            displayUrl: dataUrl,
            type: "character",
            strength: 0.6,
            fidelity: 1.0,
            disabled: false,
            cache_secret_key: null
          }
        ]);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
    if (e.target) e.target.value = null;
  };

  // 更新单个图片属性
  const updateImage = (id, field, value) => {
    setImages(prev => prev.map(img =>
      img.id === id ? { ...img, [field]: value } : img
    ));
  };

  // 删除图片
  const deleteImage = (id) => {
    setImages(prev => prev.filter(img => img.id !== id));
  };

  return (
    <Tooltip title={disabled ? t('painting.workspace.parameters.removeVibesFirst') : ''} arrow>
      <Box sx={{ mt: 1, p: 1, border: '1px dashed', borderColor: 'divider', borderRadius: 2, opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {t('painting.workspace.parameters.characterReferences', { count: images.length, max: 12 })}
          <Tooltip title={t('painting.workspace.parameters.characterReferencesHelp')} arrow placement="top">
            <InfoIcon sx={{ ml: 0.5, fontSize: 16, verticalAlign: 'middle', opacity: 0.7 }} />
          </Tooltip>
        </Typography>

        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {images.map((img, index) => (
            <Paper key={img.id} variant="outlined" sx={{ p: 0.75, opacity: img.disabled ? 0.5 : 1, borderRadius: 0.5 }}>
              {/* 第一行：删除按钮 | 启用开关 | 类型选择 */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                <IconButton
                  size="small"
                  onClick={() => deleteImage(img.id)}
                  sx={{ p: 0.25 }}
                >
                  <DeleteIcon sx={{ fontSize: 16 }} />
                </IconButton>
                <Button
                  size="small"
                  variant={img.disabled ? "outlined" : "contained"}
                  onClick={() => updateImage(img.id, 'disabled', !img.disabled)}
                  disabled={disabled}
                  sx={{
                    minWidth: 'auto',
                    px: 1,
                    py: 0.25,
                    fontSize: '0.7rem',
                    textTransform: 'none',
                  }}
                >
                  {img.disabled
                    ? t('painting.workspace.parameters.disabled')
                    : t('painting.workspace.parameters.enabled')}
                </Button>
                <FormControl size="small" sx={{ flex: 1 }}>
                  <Select
                    value={img.type}
                    onChange={(e) => updateImage(img.id, 'type', e.target.value)}
                    disabled={img.disabled || disabled}
                    sx={{ fontSize: '0.7rem', height: 24, '.MuiSelect-select': { py: 0.25, pl: 1 } }}
                  >
                    <MenuItem value="character" sx={{ fontSize: '0.75rem' }}>{t('painting.workspace.parameters.referenceTypeCharacter')}</MenuItem>
                    <MenuItem value="style" sx={{ fontSize: '0.75rem' }}>{t('painting.workspace.parameters.referenceTypeStyle')}</MenuItem>
                    <MenuItem value="character&style" sx={{ fontSize: '0.75rem' }}>{t('painting.workspace.parameters.referenceTypeCharacterAndStyle')}</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              {/* 第二行：预览图 + 滑块 */}
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                {/* 预览图 */}
                <Box sx={{
                  width: 64,
                  height: 48,
                  borderRadius: 0.5,
                  overflow: 'hidden',
                  bgcolor: 'black',
                  flexShrink: 0,
                }}>
                  <img
                    src={img.displayUrl}
                  alt={t('painting.workspace.parameters.referenceImageNumber', { index: index + 1 })}
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                </Box>

                {/* 滑块区域 */}
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  {/* Strength 滑块 */}
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography variant="caption" sx={{ minWidth: 48, opacity: 0.8, fontSize: '0.7rem' }}>{t('painting.workspace.parameters.strengthShort')}</Typography>
                    <Typography variant="caption" sx={{ minWidth: 24, fontSize: '0.7rem', mr: 0.5 }}>{img.strength.toFixed(2)}</Typography>
                    <Slider
                      size="small"
                      value={img.strength}
                      onChange={(e, v) => updateImage(img.id, 'strength', v)}
                      min={0} max={1} step={0.05}
                      sx={{ flexGrow: 1 }}
                      disabled={img.disabled || disabled}
                    />
                  </Box>

                  {/* Fidelity 滑块 */}
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography variant="caption" sx={{ minWidth: 48, opacity: 0.8, fontSize: '0.7rem' }}>{t('painting.workspace.parameters.fidelityShort')}</Typography>
                    <Typography variant="caption" sx={{ minWidth: 24, fontSize: '0.7rem', mr: 0.5 }}>{img.fidelity.toFixed(2)}</Typography>
                    <Slider
                      size="small"
                      value={img.fidelity}
                      onChange={(e, v) => updateImage(img.id, 'fidelity', v)}
                      min={0} max={1} step={0.05}
                      sx={{ flexGrow: 1 }}
                      disabled={img.disabled || disabled}
                    />
                  </Box>
                </Box>
              </Box>
            </Paper>
          ))}
        </Stack>

        {/* 添加按钮 */}
        <input
          type="file"
          ref={refImageInputRef}
          onChange={handleFileSelect}
          accept="image/png, image/jpeg, image/webp"
          style={{ display: 'none' }}
          disabled={disabled}
        />
        {images.length < 12 && (
          <Button
            variant="outlined"
            startIcon={images.length === 0 ? <PhotoCameraIcon /> : <AddIcon />}
            onClick={() => refImageInputRef.current?.click()}
            fullWidth
            sx={{ mt: 1, borderStyle: 'dashed' }}
            disabled={disabled}
          >
            {images.length === 0
              ? t('painting.workspace.parameters.uploadReferenceImage')
              : t('painting.workspace.parameters.addMoreImages')}
          </Button>
        )}
      </Box>
    </Tooltip>
  );
};

export default ImageReferenceControl;
