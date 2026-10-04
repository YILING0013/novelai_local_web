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
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Info as InfoIcon,
  Delete as DeleteIcon,
  PhotoCamera as PhotoCameraIcon,
  Add as AddIcon,
  ExpandMore as ExpandMoreIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';
import { hmacSha256 } from '../../../utils/cryptoUtils';

// 生成随机密钥
const generateRandomKey = () => {
  if (typeof window === 'undefined') return '';
  const array = new Uint8Array(32);
  window.crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
};

const referenceActionSx = {
  width: 30,
  height: 30,
  p: 0.5,
  borderRadius: 0.75,
  bgcolor: 'action.selected',
  '&:hover': { bgcolor: 'action.focus' },
};

const ImageReferenceControl = ({ onReferenceImageChange, disabled = false, expanded, onExpandedChange }) => {
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

        const newKey = hmacSha256(masterKey, img.data);
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
    <Accordion
      expanded={expanded}
      onChange={onExpandedChange}
      disableGutters
      sx={{
        m: 0,
        border: 0,
        borderTop: '1px solid',
        borderColor: 'divider',
        borderRadius: 0,
        bgcolor: 'transparent',
        backgroundImage: 'none',
        boxShadow: 'none',
        '&::before': { display: 'none' },
        '&:first-of-type, &:last-of-type': { borderRadius: 0 },
        '&.Mui-expanded': { margin: 0 },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon sx={{ fontSize: 18 }} />}
        sx={{
          minHeight: 44,
          px: 0,
          py: 0,
          '&.Mui-expanded': { minHeight: 44 },
          '& .MuiAccordionSummary-content, & .MuiAccordionSummary-content.Mui-expanded': { margin: 0 },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <PhotoCameraIcon sx={{ mr: 1, fontSize: 18, color: 'text.secondary' }} />
          <Typography sx={{ fontSize: 15, fontWeight: 500 }}>
            {t('painting.workspace.parameters.characterReferences', { count: images.length, max: 12 })}
          </Typography>
          <Tooltip title={disabled
            ? t('painting.workspace.parameters.removeVibesFirst')
            : t('painting.workspace.parameters.characterReferencesHelp')} arrow>
            <InfoIcon sx={{ ml: 0.75, fontSize: 16, color: 'text.secondary' }} />
          </Tooltip>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 1, pb: 2, opacity: disabled ? 0.5 : 1, transition: 'opacity 0.2s' }}>

        <Stack spacing={1.25}>
          {images.map((img, index) => (
            <Paper key={img.id} variant="outlined" sx={{ bgcolor: 'transparent', borderRadius: 1, overflow: 'hidden', backgroundImage: 'none' }}>
              {/* 类型靠左、操作靠右；标题栏底色与正文形成轻微层次。 */}
              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.25,
                py: 0.75,
                borderBottom: '1px solid',
                borderColor: 'divider',
                bgcolor: (theme) => alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.16 : 0.04),
              }}>
                <FormControl size="small" sx={{ minWidth: 96, maxWidth: 'calc(100% - 72px)' }}>
                  <Select
                    value={img.type}
                    onChange={(e) => updateImage(img.id, 'type', e.target.value)}
                    disabled={img.disabled || disabled}
                    inputProps={{ 'aria-label': t('painting.workspace.parameters.referenceType') }}
                    sx={{ fontSize: '0.75rem', height: 30, '.MuiSelect-select': { py: 0.5, pl: 1 } }}
                  >
                    <MenuItem value="character" sx={{ fontSize: '0.75rem' }}>{t('painting.workspace.parameters.referenceTypeCharacter')}</MenuItem>
                    <MenuItem value="style" sx={{ fontSize: '0.75rem' }}>{t('painting.workspace.parameters.referenceTypeStyle')}</MenuItem>
                    <MenuItem value="character&style" sx={{ fontSize: '0.75rem' }}>{t('painting.workspace.parameters.referenceTypeCharacterAndStyle')}</MenuItem>
                  </Select>
                </FormControl>
                <Tooltip title={t(`painting.workspace.parameters.${img.disabled ? 'enableReferenceImage' : 'disableReferenceImage'}`)} arrow>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={t(`painting.workspace.parameters.${img.disabled ? 'enableReferenceImage' : 'disableReferenceImage'}`)}
                      aria-pressed={!img.disabled}
                      onClick={() => updateImage(img.id, 'disabled', !img.disabled)}
                      disabled={disabled}
                      sx={{ ...referenceActionSx, color: img.disabled ? 'text.secondary' : 'primary.main' }}
                    >
                      {img.disabled ? <VisibilityOffIcon sx={{ fontSize: 16 }} /> : <VisibilityIcon sx={{ fontSize: 16 }} />}
                    </IconButton>
                  </span>
                </Tooltip>
                <Box sx={{ flexGrow: 1 }} />
                <Tooltip title={t('painting.workspace.parameters.deleteReferenceImage')} arrow>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={t('painting.workspace.parameters.deleteReferenceImage')}
                      onClick={() => deleteImage(img.id)}
                      disabled={disabled}
                      sx={{ ...referenceActionSx, color: 'text.secondary', '&:hover': { bgcolor: 'action.focus', color: 'error.main' } }}
                    >
                      <DeleteIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>

              {/* 第二行：预览图 + 滑块 */}
              <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', p: 1.25, opacity: img.disabled ? 0.5 : 1 }}>
                {/* 预览图 */}
                <Box sx={{
                  width: 72,
                  height: 64,
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
                <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {/* Strength 滑块 */}
                  <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 30 }}>
                    <Typography sx={{ minWidth: 52, color: 'text.secondary', fontSize: 12 }}>{t('painting.workspace.parameters.strengthShort')}</Typography>
                    <Typography sx={{ minWidth: 32, fontSize: 12, mr: 1 }}>{img.strength.toFixed(2)}</Typography>
                    <Slider
                      size="small"
                      value={img.strength}
                      aria-label={t('painting.workspace.parameters.strengthShort')}
                      onChange={(e, v) => updateImage(img.id, 'strength', v)}
                      min={0} max={1} step={0.05}
                      sx={{ flexGrow: 1 }}
                      disabled={img.disabled || disabled}
                    />
                  </Box>

                  {/* Fidelity 滑块 */}
                  <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 30 }}>
                    <Typography sx={{ minWidth: 52, color: 'text.secondary', fontSize: 12 }}>{t('painting.workspace.parameters.fidelityShort')}</Typography>
                    <Typography sx={{ minWidth: 32, fontSize: 12, mr: 1 }}>{img.fidelity.toFixed(2)}</Typography>
                    <Slider
                      size="small"
                      value={img.fidelity}
                      aria-label={t('painting.workspace.parameters.fidelityShort')}
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
            sx={{ mt: images.length > 0 ? 1.25 : 0, minHeight: 56, fontSize: 14, borderStyle: 'dashed', borderColor: 'divider' }}
            disabled={disabled}
          >
            {images.length === 0
              ? t('painting.workspace.parameters.uploadReferenceImage')
              : t('painting.workspace.parameters.addMoreImages')}
          </Button>
        )}
      </AccordionDetails>
    </Accordion>
  );
};

export default ImageReferenceControl;
