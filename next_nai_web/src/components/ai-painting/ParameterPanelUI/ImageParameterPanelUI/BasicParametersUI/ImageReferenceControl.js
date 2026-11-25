"use client";

import { hasFileDrag, readDroppedFiles } from '../../../tools/ImageTools/previewImageDragData.mjs';
import { imageDropHighlight } from '../imageDropHighlight';

import React, { useState, useEffect, useRef } from 'react';
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
  FormControlLabel,
  Switch,
  Paper,
  Stack,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import { getReferenceImageLayout } from '../../../utils/novelAIReferenceParams.mjs';
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

const ImageReferenceControl = ({ isV5, images, setImages, disabled = false, expanded, onExpandedChange, imageImportRequest, onImageImportHandled }) => {
  const { t } = useI18n();
  // 多图状态: { id, data: base64, displayUrl, type, strength, fidelity, disabled, cache_secret_key }
  const [masterKey, setMasterKey] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const refImageInputRef = useRef(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

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
  }, [masterKey, images, setImages]);

  // 添加图片处理
  const addReferenceImage = (file) => {
    if (disabled || !file) return;
    if (!file.type.startsWith('image/')) {
      alert(t('painting.workspace.errors.imageFileRequired'));
      return;
    }
    if (images.length >= 12) {
      void (window.novelaiDialog?.alert ?? window.alert)(t('painting.workspace.parameters.referenceImageLimit', { max: 12 }));
      return;
    }

    if (file.size > 6 * 1024 * 1024) {
      void (window.novelaiDialog?.alert ?? window.alert)(t('painting.workspace.parameters.referenceImageSizeLimit', { size: '6 MB' }));
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        if (!mounted.current) return;
        const { canvasWidth, canvasHeight, drawWidth, drawHeight, x, y } =
          getReferenceImageLayout(img.naturalWidth, img.naturalHeight, isV5);
        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');
        if (!isV5) {
          ctx.fillStyle = 'black';
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        }
        ctx.drawImage(img, x, y, drawWidth, drawHeight);

        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1];

        setImages(prev => prev.length >= 12 ? prev : [
          ...prev,
          {
            id: Date.now() + Math.random(),
            name: file.name,
            originalImage: event.target.result,
            data: base64,
            displayUrl: dataUrl,
            type: isV5 ? "character&style" : "character",
            strength: isV5 ? 1 : 0.6,
            fidelity: 1.0,
            disabled: false,
            cache_secret_key: null
          }
        ]);
        onExpandedChange(null, true);
      };
      img.onerror = () => alert(t('painting.workspace.errors.imageProcessingFailed'));
      img.src = event.target.result;
    };
    reader.onerror = () => alert(t('painting.workspace.errors.imageProcessingFailed'));
    reader.readAsDataURL(file);
  };

  const handledImageImport = useRef(null);
  useEffect(() => {
    if (!imageImportRequest || imageImportRequest.target !== 'reference' || handledImageImport.current === imageImportRequest.id) return;
    handledImageImport.current = imageImportRequest.id;
    addReferenceImage(imageImportRequest.file);
    onImageImportHandled();
  });

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
      data-drop-zone="reference"
      onDragOver={(event) => {
        if (!hasFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      }}
      onDragEnter={(event) => {
        if (!disabled && hasFileDrag(event.dataTransfer)) setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        addReferenceImage(readDroppedFiles(event.dataTransfer)[0]);
      }}
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
          ...(isDragging && !disabled && imageDropHighlight),
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
            : t(isV5 ? 'painting.workspace.parameters.v5ReferenceHelp' : 'painting.workspace.parameters.characterReferencesHelp')} arrow>
            <InfoIcon sx={{ ml: 0.75, fontSize: 16, color: 'text.secondary' }} />
          </Tooltip>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 1, pb: 2, opacity: disabled ? 0.5 : 1, transition: 'opacity 0.2s' }}>

        <Stack spacing={1.25}>
          {images.map((img, index) => {
            // 保存官方描述，恢复历史作品时也能区分角色组合的服装开关。
            const type = ({ character_mainoutfit: 'character', 'character&style_anyoutfit': 'character&style' })[img.type] || img.type;
            const sameOutfit = img.type === 'character_mainoutfit' || img.type === 'character&style';
            return (
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
                    value={type}
                    onChange={(e) => updateImage(img.id, 'type', e.target.value)}
                    disabled={img.disabled || disabled}
                    inputProps={{ 'aria-label': t('painting.workspace.parameters.referenceType') }}
                    sx={{ fontSize: '0.75rem', height: 30, '.MuiSelect-select': { py: 0.5, pl: 1 } }}
                  >
                    <MenuItem value="character" sx={{ fontSize: '0.75rem' }}>{t('painting.workspace.parameters.referenceTypeCharacter')}</MenuItem>
                    <MenuItem value="style" sx={{ fontSize: '0.75rem' }}>{t('painting.workspace.parameters.referenceTypeStyle')}</MenuItem>
                    {isV5 && <MenuItem value="costume" sx={{ fontSize: '0.75rem' }}>{t('painting.workspace.parameters.referenceTypeOutfit')}</MenuItem>}
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
                      min={0} max={isV5 ? 5 : 1} step={0.05}
                      sx={{ flexGrow: 1 }}
                      disabled={img.disabled || disabled}
                    />
                  </Box>

                  {isV5 && (type === 'character' || type === 'character&style') && (
                    <FormControlLabel
                      sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 12 } }}
                      control={<Switch size="small" checked={sameOutfit} disabled={img.disabled || disabled}
                        onChange={(_, checked) => {
                          const nextType = type === 'character'
                            ? (checked ? 'character_mainoutfit' : 'character')
                            : (checked ? 'character&style' : 'character&style_anyoutfit');
                          updateImage(img.id, 'type', nextType);
                        }} />}
                      label={t('painting.workspace.parameters.preferSameOutfit')}
                    />
                  )}
                  {!isV5 && (
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
                  )}
                </Box>
              </Box>
            </Paper>
            );
          })}
        </Stack>

        {/* 添加按钮 */}
        <input
          type="file"
          ref={refImageInputRef}
          onChange={(event) => {
            addReferenceImage(event.currentTarget.files[0]);
            event.currentTarget.value = '';
          }}
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
