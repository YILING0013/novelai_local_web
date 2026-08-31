"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { resizeImage, checkResolutionLimit } from './tools/ImageTools/ImageResizer';
import MetadataDialog from './tools/ImageTools/MetadataDialog';
import { extractActiveContent, ExpandedPromptDialog } from './PromptEditor';
import {
  NOVELAI_V5_DEFAULT_PARAMS,
  NOVELAI_V5_CHARACTER_WARNING_THRESHOLD,
  NOVELAI_DIRECTOR_REFERENCE_PARAM_KEYS,
  buildNovelAIV5CharacterControl,
  isNovelAIDirectorReferenceModel,
  isNovelAIV5Model,
  isNovelAIV4OrAboveModel as isV4Model,
  isNovelAIVibeModel,
  normalizePaintingModelId,
  normalizeNovelAISmeaParams,
  removeNovelAIUCPresetParams,
  sanitizeNovelAIV5GenerationParams,
} from './utils/modelUtils';
import apiClient from '../../utils/ApiClient';
import {
  Box,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  useTheme,
  Snackbar,
  Alert,
  Chip
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Tune as TuneIcon,
  Delete as DeleteIcon,
  Image as ImageIcon,
} from '@mui/icons-material';
import {
  applyImageParametersToUI,
  findAllowedResolutionWithFixedHeight,
  findAllowedResolutionWithFixedWidth,
} from './utils/parameterMapping';
import { extractMetadataFromFile } from './utils/metadataUtils';
import ImageParameterPanel from './ParameterPanelUI/ImageParameterPanel';
import BasicParameters from './ParameterPanelUI/ImageParameterPanelUI/BasicParameters';
import { sha256 } from './utils/cryptoUtils';
import { createThumbnail } from './utils/imageUtils';
// [修改] 导入新增的数据库函数
import { getVibeFromCache, addVibeToCache, getAllVibesFromCache } from './utils/vibeDB';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useI18n } from '@/i18n/I18nProvider';
import { forwardPaintingPanelError } from './Generation/errorRecords.mjs';
import { getEnabledNovelAICharacterPromptTexts } from './PromptEditor/novelAIImageTokenizer.mjs';
import { getPublicToolErrorMessageKey } from '@/utils/publicToolErrors.mjs';


// 模型选项
const modelOptions = [
  { value: 'nai-diffusion-5-full', label: 'NAI Diffusion V5 Full', descriptionKey: 'painting.workspace.parameters.modelV5Full', icon: <ImageIcon /> },
  { value: 'nai-diffusion-5-curated', label: 'NAI Diffusion V5 Curated', descriptionKey: 'painting.workspace.parameters.modelV5Curated', icon: <ImageIcon /> },
  { value: 'nai-diffusion-4-5-full', label: 'NAI Diffusion V4.5', descriptionKey: 'painting.workspace.parameters.modelV45Full', icon: <ImageIcon /> },
  { value: 'nai-diffusion-4-5-curated', label: 'NAI Diffusion V4.5 Curated', descriptionKey: 'painting.workspace.parameters.modelV45Curated', icon: <ImageIcon /> },
  { value: 'nai-diffusion-4-full', label: 'NAI Diffusion 4', descriptionKey: 'painting.workspace.parameters.modelV4Full', icon: <ImageIcon /> },
  { value: 'nai-diffusion-4-curated-preview', label: 'NAI Diffusion 4 Curated', descriptionKey: 'painting.workspace.parameters.modelV4CuratedPreview', icon: <ImageIcon /> },
  { value: 'nai-diffusion-3', label: 'NAI Diffusion 3', descriptionKey: 'painting.workspace.parameters.modelNaiV3', icon: <ImageIcon /> },
  { value: 'nai-diffusion-furry-3', label: 'NAI Diffusion Furry 3', descriptionKey: 'painting.workspace.parameters.modelNaiFurryV3', icon: <ImageIcon /> },
];

const getV4ModelType = (modelName) => {
  if (modelName === 'nai-diffusion-4-full') return 'v4full';
  if (modelName === 'nai-diffusion-4-curated-preview') return 'v4curated';
  if (modelName === 'nai-diffusion-4-5-full') return 'v4-5full';
  if (modelName === 'nai-diffusion-4-5-curated') return 'v4-5curated';
  return null;
};

const MAX_ACTIVE_VIBES = 4;
const MAX_ACTIVE_CHARACTERS = 6;

const getEnabledItemCount = (items = []) => items.filter((item) => item?.isTemporarilyDisabled !== true).length;

// 从Data URL提取Base64数据的辅助函数
const extractBase64FromDataUrl = (dataUrl) => {
  if (!dataUrl) return null;
  const matches = dataUrl.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  return matches ? matches[1] : dataUrl;
};

// 主组件
const ParameterPanel = ({
  params: externalParams,
  onParamChange,
  getAllParametersRef = null,
  expandedPanels = {},
  onExpandedPanelsChange = () => { },
  fileInputRef = null,
  vibeFileInputRef = null,
  vibeImages = [],
  setVibeImages = () => { },
  externalImageData = null,
  onImageToImageCostParametersChange = null,
  onCharacterTabsChange = null,
  onApplyMetadata = null,
  positivePrompt = '',
  negativePrompt = '',
  externalCharacterTabs,
  onError = null,
}) => {
  const { t } = useI18n();
  const theme = useTheme();
  const accountDefaultModel = normalizePaintingModelId('nai-diffusion-4-5-full');
  const defaultParams = useMemo(() => ({
    model: accountDefaultModel,
    width: 1024,
    height: 1024,
    steps: 23,
    guidanceScale: 5,
    seed: '',
    sampler: 'k_euler',
    batchSize: 1,
    promptGuidanceRescale: 0,
    noiseSchedule: 'karras',
    smea: false,
    dyn: false,
    variety: false,
    decrisp: false,
    aiDecidePosition: false,
    characterPositionMode: 'ai',
    strength: 0.7,
    noise: 0,
    prefer_brownian: true,
    deliberate_euler_ancestral_bug: false,
    legacy: false,
    legacy_uc: false,
    legacy_v3_extend: false,
    autoSmea: false,
  }), [accountDefaultModel]);

  const [params, setParams] = useState({ ...defaultParams });
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false);
  const [extractedMetadata, setExtractedMetadata] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isVibeDragging, setIsVibeDragging] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [editorKey, setEditorKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [characterTabs, setCharacterTabs] = useState([]);
  const [loadedFromCache, setLoadedFromCache] = useState(false);
  const [randomPromptEnabled, setRandomPromptEnabled] = useState(false);
  const [randomPromptConfig, setRandomPromptConfig] = useState(null);
  const [resolutionCheckDialogOpen, setResolutionCheckDialogOpen] = useState(false);
  const [pendingImageFile, setPendingImageFile] = useState(null);
  const [resolutionCheckData, setResolutionCheckData] = useState(null);

  const [editing, setEditing] = useState({ width: false, height: false });
  const [tempInputs, setTempInputs] = useState({ width: '', height: '' });
  const [toast, setToast] = useState({ open: false, message: '', severity: 'warning' });
  const [characterEditorOpen, setCharacterEditorOpen] = useState(false);
  const [editingCharacterPrompt, setEditingCharacterPrompt] = useState({ index: null, field: '', text: '' });
  const smeaRef = useRef(false);
  const [editedImageData, setEditedImageData] = useState(null);
  const [directorToolParams, setDirectorToolParams] = useState(null);

  const handleReferenceImageChange = (refData) => {
    const supportedRefData = isNovelAIDirectorReferenceModel(params.model) ? refData : null;
    // 新的多图参数格式
    const newValues = supportedRefData ? {
      director_reference_images_cached: supportedRefData.director_reference_images_cached,
      director_reference_descriptions: supportedRefData.director_reference_descriptions,
      director_reference_strength_values: supportedRefData.director_reference_strength_values,
      director_reference_secondary_strength_values: supportedRefData.director_reference_secondary_strength_values,
      director_reference_information_extracted: supportedRefData.director_reference_information_extracted
    } : {
      director_reference_images_cached: undefined,
      director_reference_descriptions: undefined,
      director_reference_strength_values: undefined,
      director_reference_secondary_strength_values: undefined,
      director_reference_information_extracted: undefined
    };

    // 更新本地 state 和父组件 state (不存储 cached images 到 localStorage)
    Object.keys(newValues).forEach(key => {
      const value = newValues[key];

      setParams(prev => {
        const newParams = { ...prev };
        if (value !== undefined) {
          newParams[key] = value;
          // 不保存 cached images 到 localStorage，因为它们太大且有缓存机制
          if (key !== 'director_reference_images_cached') {
            try {
              localStorage.setItem(`aiImageParams_${key}`, JSON.stringify(value));
            } catch (e) {
              console.error(`保存参数到localStorage失败 (key: ${key}):`, e);
              if (e.name === 'QuotaExceededError') {
                setToast({ open: true, message: t('painting.workspace.errors.storageFull'), severity: 'warning' });
              }
            }
          }
        } else {
          delete newParams[key];
          localStorage.removeItem(`aiImageParams_${key}`);
        }
        return newParams;
      });

      if (onParamChange) {
        setTimeout(() => onParamChange(key, value), 0);
      }
    });
  };

  // 处理重置参数确认
  const handleResetParamsConfirm = () => setResetDialogOpen(true);

  const handleResetParams = () => {
    setParams({ ...defaultParams });
    setTempInputs({
      width: defaultParams.width.toString(),
      height: defaultParams.height.toString()
    });
    Object.keys(defaultParams).forEach(key => localStorage.removeItem('aiImageParams_' + key));
    localStorage.removeItem('aiImageParams_ucPreset');
    localStorage.removeItem('aiImageParams_ucPresetId');
    smeaRef.current = defaultParams.smea;
    if (onParamChange) {
      Object.keys(defaultParams).forEach(key => setTimeout(() => onParamChange(key, defaultParams[key]), 0));
      setTimeout(() => {
        onParamChange('ucPreset', undefined);
        onParamChange('ucPresetId', undefined);
      }, 0);
    }
    setResetDialogOpen(false);
    setToast({ open: true, message: t('painting.workspace.notifications.parametersReset'), severity: 'success' });
  };

  useEffect(() => {
    localStorage.removeItem('aiImageParams_ucPreset');
    localStorage.removeItem('aiImageParams_ucPresetId');
    let initialParams = { ...defaultParams };
    Object.keys(defaultParams).forEach(key => {
      // [修复] 不从 localStorage 加载 reference image，因为它没有被存入
      if (key === 'director_reference_images' || key === 'director_reference_images_cached') return;

      const cached = localStorage.getItem('aiImageParams_' + key);
      if (cached !== null) {
        try {
          initialParams[key] = JSON.parse(cached);
        } catch (e) {
          initialParams[key] = cached;
        }
      }
    });
    if (externalParams) {
      Object.keys(externalParams).forEach(key => {
        if (initialParams[key] === defaultParams[key] || externalParams[key] !== undefined) {
          if (externalParams[key] !== undefined) {
            initialParams[key] = externalParams[key];
          }
        }
      });
    }
    initialParams = removeNovelAIUCPresetParams(initialParams);
    const normalizedModel = normalizePaintingModelId(
      initialParams.model,
      defaultParams.model,
    );
    if (normalizedModel !== initialParams.model) {
      // 旧缓存或外部参数中的下线模型必须立即回落，避免隐藏选项继续进入生成请求。
      initialParams.model = normalizedModel;
      localStorage.setItem('aiImageParams_model', JSON.stringify(normalizedModel));
    }
    const normalizedInitialParams = normalizeNovelAISmeaParams(initialParams);
    const normalizedNovelAIParams = sanitizeNovelAIV5GenerationParams(normalizedInitialParams);
    if (normalizedNovelAIParams.steps !== normalizedInitialParams.steps) {
      // V5 普通模式现以 23 步为上限，旧缓存必须同步回写，避免刷新后再次越界。
      localStorage.setItem('aiImageParams_steps', JSON.stringify(normalizedNovelAIParams.steps));
    }

    if (isV4Model(normalizedInitialParams.model)) {
      localStorage.removeItem("aiImageParams_smea");
      localStorage.removeItem("aiImageParams_dyn");
      localStorage.removeItem("aiImageParams_autoSmea");
    }

    setParams(normalizedNovelAIParams);
    setTempInputs({
      width: normalizedNovelAIParams.width.toString(),
      height: normalizedNovelAIParams.height.toString()
    });
    smeaRef.current = normalizedNovelAIParams.smea;
    setLoadedFromCache(true);
  }, [defaultParams, externalParams]);

  useEffect(() => {
    const savedCharacterTabs = localStorage.getItem('characterTabs');
    if (savedCharacterTabs) {
      try {
        const parsedTabs = JSON.parse(savedCharacterTabs);
        const tabsWithColors = parsedTabs.map(tab => ({
          ...tab,
          name: typeof tab.name === 'string' ? tab.name.slice(0, 16) : '',
          colorId: tab.colorId !== undefined ? tab.colorId : Math.floor(Math.random() * 6),
          isTemporarilyDisabled: tab.isTemporarilyDisabled === true,
        }));
        setCharacterTabs(tabsWithColors);
      } catch (e) {
        console.error('从localStorage解析角色标签时出错:', e);
        setCharacterTabs([]);
      }
    }
  }, []);

  useEffect(() => {
    if (externalCharacterTabs !== null && externalCharacterTabs !== undefined) {
      const tabsWithColors = externalCharacterTabs.map(tab => ({
        ...tab,
        name: typeof tab.name === 'string' ? tab.name.slice(0, 16) : '',
        colorId: tab.colorId !== undefined ? tab.colorId : Math.floor(Math.random() * 6),
        isTemporarilyDisabled: tab.isTemporarilyDisabled === true,
      }));
      setCharacterTabs(tabsWithColors);
    }
  }, [externalCharacterTabs]);

  useEffect(() => {
    if (loadedFromCache) {
      localStorage.setItem('characterTabs', JSON.stringify(characterTabs));
    }
  }, [characterTabs, loadedFromCache]);

  useEffect(() => {
    if (onCharacterTabsChange) {
      onCharacterTabsChange(characterTabs);
    }
  }, [characterTabs, onCharacterTabsChange]);

  useEffect(() => {
    const fetchRandomPromptConfig = async () => {
      try {
        const config = await apiClient.getRandomPromptConfig();
        setRandomPromptEnabled(config.enabled !== false);
        setRandomPromptConfig(config);
      } catch (error) {
        console.error('获取随机提示词配置失败:', error);
        forwardPaintingPanelError(onError, error, {
          source: 'random-prompt-config',
          messageKey: getPublicToolErrorMessageKey(
            error,
            'painting.tools.randomPrompt.errors.loadFailed',
          ),
        });
      }
    };
    fetchRandomPromptConfig();
  }, [onError]);

  useEffect(() => {
    if (isV4Model(params.model)) {
      smeaRef.current = false;

      if (params.smea || params.dyn || params.autoSmea) {
        setParams(prev => normalizeNovelAISmeaParams(prev));
        localStorage.removeItem("aiImageParams_smea");
        localStorage.removeItem("aiImageParams_dyn");
        localStorage.removeItem("aiImageParams_autoSmea");

        if (onParamChange) {
          setTimeout(() => {
            onParamChange('smea', false);
            onParamChange('dyn', false);
            onParamChange('autoSmea', false);
          }, 0);
        }
      }
      return;
    }

    smeaRef.current = params.smea;
    if (!params.smea && params.dyn) {
      setParams(prev => ({ ...prev, dyn: false }));
      localStorage.removeItem("aiImageParams_dyn");
      if (onParamChange) setTimeout(() => onParamChange('dyn', false), 0);
    }
  }, [params.model, params.smea, params.dyn, params.autoSmea, onParamChange]);

  const resetEditorState = () => {
    setEditedImageData(null);
    setDirectorToolParams(null);
  };

  useEffect(() => {
    if (externalImageData) {
      setImagePreview(externalImageData.dataURL);
      resetEditorState();
      setEditorKey(prev => prev + 1);
    }
  }, [externalImageData]);

  useEffect(() => {
    if (!onImageToImageCostParametersChange) return;

    onImageToImageCostParametersChange(imagePreview
      ? { image: true, strength: params.strength }
      : null);
  }, [imagePreview, onImageToImageCostParametersChange, params.strength]);

  const handleSmeaChange = (e) => {
    if (isV4Model(params.model)) return;

    const checked = e.target.checked;
    smeaRef.current = checked;
    setParams(prev => {
      const newParams = { ...prev, smea: checked };
      if (!checked) newParams.dyn = false;
      return newParams;
    });
    localStorage.setItem("aiImageParams_smea", JSON.stringify(checked));
    if (!checked) localStorage.removeItem("aiImageParams_dyn");
    if (onParamChange) {
      setTimeout(() => {
        onParamChange('smea', checked);
        if (!checked) onParamChange('dyn', false);
      }, 0);
    }
  };

  const handleDynChange = (e) => {
    if (isV4Model(params.model) || !smeaRef.current) return;

    const checked = e.target.checked;
    setParams(prev => ({ ...prev, dyn: checked }));
    localStorage.setItem("aiImageParams_dyn", JSON.stringify(checked));
    if (onParamChange) setTimeout(() => onParamChange('dyn', checked), 0);
  };

  const handleParamChange = (param, value) => {
    if (param === 'smea' || param === 'dyn') return;
    if (param === 'ucPreset' || param === 'ucPresetId') {
      localStorage.removeItem('aiImageParams_ucPreset');
      localStorage.removeItem('aiImageParams_ucPresetId');
      return;
    }
    if (param === 'autoSmea' && isV4Model(params.model)) return;

    const resolvedValue = param === 'model'
      ? normalizePaintingModelId(value, defaultParams.model)
      : value;
    const enteringV5 = param === 'model'
      && isNovelAIV5Model(resolvedValue)
      && !isNovelAIV5Model(params.model);

    const shouldClearDirectorReference = param === 'model'
      && !isNovelAIDirectorReferenceModel(resolvedValue);

    setParams((previousParams) => {
      const nextParams = {
        ...previousParams,
        ...(enteringV5 ? NOVELAI_V5_DEFAULT_PARAMS : {}),
        [param]: resolvedValue,
      };
      if (shouldClearDirectorReference) {
        NOVELAI_DIRECTOR_REFERENCE_PARAM_KEYS.forEach((key) => delete nextParams[key]);
      }
      return nextParams;
    });

    try {
      localStorage.setItem(`aiImageParams_${param}`, JSON.stringify(resolvedValue));
      if (enteringV5) {
        Object.entries(NOVELAI_V5_DEFAULT_PARAMS).forEach(([key, defaultValue]) => {
          localStorage.setItem(`aiImageParams_${key}`, JSON.stringify(defaultValue));
        });
      }
      if (shouldClearDirectorReference) {
        // 切离 4.5 时立即清除所有角色参考派生状态，避免隐藏数据继续影响请求与 Vibe。
        NOVELAI_DIRECTOR_REFERENCE_PARAM_KEYS.forEach((key) => localStorage.removeItem(`aiImageParams_${key}`));
      }
    } catch (e) {
      console.error(`保存参数到localStorage失败 (key: ${param}):`, e);
      if (e.name === 'QuotaExceededError') {
        setToast({ open: true, message: t('painting.workspace.errors.storageFull'), severity: 'warning' });
      }
    }

    setTimeout(() => {
      if (!onParamChange) {
        return;
      }
      onParamChange(param, resolvedValue);
      if (enteringV5) {
        Object.entries(NOVELAI_V5_DEFAULT_PARAMS).forEach(([key, defaultValue]) => {
          onParamChange(key, defaultValue);
        });
      }
      if (shouldClearDirectorReference) {
        NOVELAI_DIRECTOR_REFERENCE_PARAM_KEYS.forEach((key) => onParamChange(key, undefined));
      }
    }, 0);
  };

  const handleSizePresetClick = (width, height) => {
    handleParamChange('width', width);
    handleParamChange('height', height);
    setTempInputs({ width: width.toString(), height: height.toString() });
  };

  const handleRefreshSeed = () => {
    const randomSeed = Math.floor(Math.random() * 4294967295);
    handleParamChange('seed', randomSeed);
  };

  const handleClearSeed = () => {
    if (params.seed !== '') {
      handleParamChange('seed', '');
      setToast({ open: true, message: t('painting.workspace.notifications.seedCleared'), severity: 'success' });
    }
  };

  const handleDragOver = (e) => e.preventDefault();
  const handleDragEnter = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        handleImageUpload({ target: { files: [file] } });
      } else {
        setToast({ open: true, message: t('painting.workspace.errors.imageFileRequired'), severity: 'error' });
      }
    }
  };

  const handleVibeDragOver = (e) => e.preventDefault();
  const handleVibeDragEnter = (e) => { e.preventDefault(); setIsVibeDragging(true); };
  const handleVibeDragLeave = (e) => { e.preventDefault(); setIsVibeDragging(false); };

  const handleVibeDrop = (e) => {
    e.preventDefault();
    setIsVibeDragging(false);
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

    if (isV4Model(params.model)) {
      handleVibeV4FileUpload({ target: { files: e.dataTransfer.files } });
    } else {
      const allImages = Array.from(e.dataTransfer.files).every(file => file.type.startsWith('image/'));
      if (allImages) {
        handleVibeImageUpload({ target: { files: e.dataTransfer.files } });
      } else {
        setToast({ open: true, message: t('painting.workspace.errors.v3ImageOnly'), severity: 'error' });
      }
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const originalDataURL = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(Object.assign(new Error('IMAGE_FILE_READ_FAILED'), {
          code: 'IMAGE_FILE_READ_FAILED',
        }));
        reader.readAsDataURL(file);
      });
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(Object.assign(new Error('IMAGE_DECODE_FAILED'), {
          code: 'IMAGE_DECODE_FAILED',
        }));
        image.src = originalDataURL;
      });
      const resolutionCheck = checkResolutionLimit(img.width, img.height);
      if (resolutionCheck.isOverLimit) {
        setPendingImageFile(file);
        setResolutionCheckData(resolutionCheck);
        setResolutionCheckDialogOpen(true);
      } else {
        await processImageUpload(file);
      }
    } catch (error) {
      console.error('处理图像失败:', error);
      forwardPaintingPanelError(onError, error, {
        source: 'image-upload-processing',
        messageKey: 'painting.workspace.errors.imageProcessingFailed',
      });
      setToast({ open: true, message: t('painting.workspace.errors.imageProcessingFailed'), severity: 'error' });
    }
  };

  const processImageUpload = async (file) => {
    try {
      const resizeResult = await resizeImage(file);
      const finalWidth = resizeResult.width;
      const finalHeight = resizeResult.height;
      setImagePreview(resizeResult.dataURL);
      handleParamChange('width', finalWidth);
      handleParamChange('height', finalHeight);
      setTempInputs({ width: finalWidth.toString(), height: finalHeight.toString() });
      resetEditorState();
      setEditorKey(prev => prev + 1);

      try {
        const metadata = await extractMetadataFromFile(file);
        if (metadata) {
          setExtractedMetadata(metadata);
          setMetadataDialogOpen(true);
        }
      } catch (metadataError) {
        console.error('元数据提取失败:', metadataError);
        forwardPaintingPanelError(onError, metadataError, {
          source: 'image-metadata-parser',
          messageKey: 'painting.workspace.errors.applyImageMetadataFailed',
        });
      }
      onExpandedPanelsChange('img2img', true);
      setToast({ open: true, message: t('painting.workspace.notifications.addedToImg2Img'), severity: 'success' });
    } catch (error) {
      console.error('处理图像失败:', error);
      forwardPaintingPanelError(onError, error, {
        source: 'image-upload-processing',
        messageKey: 'painting.workspace.errors.imageProcessingFailed',
      });
      setToast({ open: true, message: t('painting.workspace.errors.imageProcessingFailed'), severity: 'error' });
    }
  };

  const handleResolutionChoice = async (shouldContinue) => {
    setResolutionCheckDialogOpen(false);
    if (shouldContinue && pendingImageFile) {
      await processImageUpload(pendingImageFile);
    } else if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setPendingImageFile(null);
    setResolutionCheckData(null);
  };

  const handleApplyMetadata = (filteredMetadata) => {
    if (!extractedMetadata) return;

    setMetadataDialogOpen(false);

    const promptPayload = {};
    const success = applyImageParametersToUI(filteredMetadata, {
      handleParamChange,
      handleBooleanParamChange: (key, value) => {
        if (key === 'smea') {
          handleSmeaChange({ target: { checked: value } });
          return;
        }

        if (key === 'dyn') {
          handleDynChange({ target: { checked: value } });
        }
      },
      onResolutionChange: (width, height) => {
        setTempInputs({ width: width.toString(), height: height.toString() });
      },
      setPositivePrompt: (value) => {
        promptPayload.positivePrompt = value;
      },
      setNegativePrompt: (value) => {
        promptPayload.negativePrompt = value;
      },
      setCharacterTabsFromNote: (tabs) => {
        const tabsWithColors = tabs.map((tab, index) => ({
          ...tab,
          colorId: tab.colorId !== undefined ? tab.colorId : index % 6,
        }));

        setCharacterTabs(tabsWithColors);
        promptPayload.characterTabs = tabsWithColors;
      },
      setExpandedPanels: (updater) => {
        const nextPanels = typeof updater === 'function'
          ? updater(expandedPanels)
          : updater;

        Object.entries(nextPanels).forEach(([panel, isExpanded]) => {
          if (expandedPanels[panel] !== isExpanded) {
            onExpandedPanelsChange(panel, isExpanded);
          }
        });
      },
      showNotification: (code, severity = 'success', params = {}) => {
        const message = code === 'PARAMETER_RESOLUTION_AUTO_ADJUSTED'
          ? t('painting.workspace.notifications.resolutionAdjusted', params)
          : t('painting.workspace.errors.generic');
        setToast({ open: true, message, severity });
      },
    });

    if (!success) {
      // 元数据中没有可应用字段属于内容校验结果，不写入运行时错误记录。
      setToast({ open: true, message: t('painting.workspace.errors.applyImageMetadataFailed'), severity: 'error' });
      return;
    }

    if (onApplyMetadata && Object.keys(promptPayload).length > 0) {
      onApplyMetadata(promptPayload);
    }

    setToast({ open: true, message: t('painting.workspace.notifications.imageMetadataApplied'), severity: 'success' });
  };

  const handleImageDelete = () => {
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    resetEditorState();
    setEditorKey(prev => prev + 1);
  };

  const handleOpenEditor = () => setEditorOpen(true);
  const clearDirectorToolParams = () => { setDirectorToolParams(null); setToast({ open: true, message: t('painting.workspace.notifications.editEffectRemoved'), severity: 'success' }); };

  const handleCloseEditor = (exportData) => {
    if (exportData) {
      if (exportData.editedImage) {
        setImagePreview(exportData.editedImage);
        setEditedImageData(exportData.editedImage);
      }
      if (exportData.directorTools && exportData.directorTools.type) {
        setDirectorToolParams({ type: exportData.directorTools.type, params: exportData.directorTools.params || { enabled: true } });
      }
    }
    setEditorOpen(false);
  };

  // V3 Vibe 图片上传
  const handleVibeImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      const processedVibes = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new window.Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 448;
            canvas.height = 448;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            let drawWidth;
            let drawHeight;
            let offsetX = 0;
            let offsetY = 0;
            const ratio = img.width / img.height;

            if (ratio > 1) {
              drawWidth = 448;
              drawHeight = 448 / ratio;
              offsetY = (448 - drawHeight) / 2;
            } else {
              drawHeight = 448;
              drawWidth = 448 * ratio;
              offsetX = (448 - drawWidth) / 2;
            }

            ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

            resolve({
              id: crypto.randomUUID(),
              image: canvas.toDataURL('image/png'),
              informationExtracted: 0.7,
              referenceStrength: 0.5,
              isTemporarilyDisabled: false,
            });
          };
          img.onerror = () => reject(Object.assign(new Error('VIBE_IMAGE_DECODE_FAILED'), {
            code: 'VIBE_IMAGE_DECODE_FAILED',
          }));
          img.src = reader.result;
        };
        reader.onerror = () => reject(Object.assign(new Error('VIBE_IMAGE_READ_FAILED'), {
          code: 'VIBE_IMAGE_READ_FAILED',
        }));
        reader.readAsDataURL(file);
      })));

      addVibeImagesToState(processedVibes.filter(Boolean));
    } catch (error) {
      console.error('处理Vibe图像失败:', error);
      forwardPaintingPanelError(onError, error, {
        source: 'vibe-image-processing',
        messageKey: 'painting.workspace.errors.processVibeImageFailed',
      });
      setToast({ open: true, message: t('painting.workspace.errors.processVibeImageFailed'), severity: 'error' });
    }

    if (vibeFileInputRef.current) {
      vibeFileInputRef.current.value = '';
    }
  };

  const addVibeImagesToState = (newVibes) => {
    setVibeImages(prev => {
      const normalizedVibes = newVibes.map(vibe => ({
        ...vibe,
        isTemporarilyDisabled: vibe.isTemporarilyDisabled === true,
      }));
      const activeCount = getEnabledItemCount(prev);
      const availableSlots = Math.max(0, MAX_ACTIVE_VIBES - activeCount);

      if (availableSlots <= 0) {
        setToast({ open: true, message: t('painting.workspace.errors.activeVibeLimit', { max: MAX_ACTIVE_VIBES }), severity: 'warning' });
        return prev;
      }

      if (normalizedVibes.length > availableSlots) {
        setToast({ open: true, message: t('painting.workspace.errors.vibeSlotsTruncated', { count: availableSlots }), severity: 'warning' });
        return [...prev, ...normalizedVibes.slice(0, availableSlots)];
      }

      return [...prev, ...normalizedVibes];
    });
  };

  // V4 Vibe 图片上传逻辑
  const handleV4ImageUploadLogic = async (files) => {
    const newVibes = [];
    for (const file of files) {
      if (getEnabledItemCount(vibeImages) + getEnabledItemCount(newVibes) >= MAX_ACTIVE_VIBES) break;
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(Object.assign(new Error('VIBE_IMAGE_READ_FAILED'), {
          code: 'VIBE_IMAGE_READ_FAILED',
        }));
        reader.readAsDataURL(file);
      });
      const base64Data = extractBase64FromDataUrl(base64);
      if (!base64Data) continue;

      const hash = await sha256(base64Data);
      const thumbnail = await createThumbnail(base64);
      const infoExtracted = 0.7; // 默认值

      const cachedVibe = await getVibeFromCache(hash, params.model, infoExtracted);

      if (cachedVibe) {
        const modelType = getV4ModelType(params.model);
        const encodingDataForCurrentModel = cachedVibe.encodings?.[modelType];
        let encodingInfo = null;
        if (encodingDataForCurrentModel) {
          const firstKey = Object.keys(encodingDataForCurrentModel)[0];
          if (firstKey) {
            encodingInfo = encodingDataForCurrentModel[firstKey];
          }
        }

        const infoExtractedFromCache = encodingInfo?.params?.information_extracted ?? cachedVibe.importInfo?.information_extracted ?? 0.7;
        const imageB64 = cachedVibe.image ? (cachedVibe.image.startsWith('data:') ? cachedVibe.image : `data:image/png;base64,${cachedVibe.image}`) : null;

        newVibes.push({
          id: crypto.randomUUID(),
          image: imageB64,
          thumbnail: cachedVibe.thumbnail || (imageB64 ? await createThumbnail(imageB64) : null),
          hash: cachedVibe.id || hash,
          informationExtracted: infoExtractedFromCache,
          referenceStrength: cachedVibe.importInfo?.strength || 0.6,
          isV4Vibe: true,
          status: 'converted',
          isReadOnly: !cachedVibe.image,
          encodingInfo: { name: cachedVibe.name },
          encoding: encodingInfo ? encodingInfo.encoding : null,
        });
      } else {
        newVibes.push({
          id: crypto.randomUUID(),
          image: base64,
          thumbnail: thumbnail,
          hash: hash,
          informationExtracted: infoExtracted,
          referenceStrength: 0.6,
          isV4Vibe: true,
          status: 'unconverted',
          isReadOnly: false,
        });
      }
    }
    if (newVibes.length > 0) addVibeImagesToState(newVibes);
  };

  // V4 .naiv4vibe 文件上传逻辑
  const handleV4VibeFileLogic = async (files) => {
    const currentModelType = getV4ModelType(params.model);
    const newVibes = [];

    for (const file of files) {
      if (getEnabledItemCount(vibeImages) + getEnabledItemCount(newVibes) >= MAX_ACTIVE_VIBES) break;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.identifier === 'novelai-vibe-transfer') {
          const vibe = await processVibeFile(data, currentModelType, params.model);
          if (vibe) newVibes.push(vibe);
        } else if (data.identifier === 'novelai-vibe-transfer-bundle') {
          for (const vibeData of data.vibes) {
            if (getEnabledItemCount(vibeImages) + getEnabledItemCount(newVibes) >= MAX_ACTIVE_VIBES) break;
            const vibe = await processVibeFile(vibeData, currentModelType, params.model);
            if (vibe) newVibes.push(vibe);
          }
        }
      } catch (e) {
        forwardPaintingPanelError(onError, e, {
          source: 'vibe-file-processing',
          messageKey: 'painting.workspace.errors.processFileFailed',
        });
        setToast({ open: true, message: t('painting.workspace.errors.processFileFailed', { fileName: file.name }), severity: 'error' });
      }
    }
    if (newVibes.length > 0) addVibeImagesToState(newVibes);
  };

  const processVibeFile = async (data, currentModelType, currentModelName) => {
    const hasImage = !!data.image;
    const encodingDataForCurrentModel = data.encodings?.[currentModelType];

    if (!hasImage && !encodingDataForCurrentModel) {
      setToast({ open: true, message: t('painting.workspace.errors.incompatibleVibeFile'), severity: 'error' });
      return null;
    }

    let encodingInfo = null;
    if (encodingDataForCurrentModel) {
      const firstKey = Object.keys(encodingDataForCurrentModel)[0];
      if (firstKey) {
        encodingInfo = encodingDataForCurrentModel[firstKey];
      }
    }

    const isConverted = !!encodingInfo;

    let hash, imageB64, thumbnail;
    if (hasImage) {
      imageB64 = data.image.startsWith('data:') ? data.image : `data:image/png;base64,${data.image}`;
      thumbnail = data.thumbnail || await createThumbnail(imageB64);
      hash = data.id || await sha256(extractBase64FromDataUrl(imageB64));

      if (data.encodings) {
        for (const modelKey in data.encodings) {
          const fullModelName = modelOptions.find(opt => getV4ModelType(opt.value) === modelKey)?.value;
          if (fullModelName) {
            const modelEncodingData = data.encodings[modelKey];
            const firstSubKey = Object.keys(modelEncodingData)[0];
            if (firstSubKey) {
              const specificEncodingInfo = modelEncodingData[firstSubKey];
              const infoExtracted = specificEncodingInfo?.params?.information_extracted ?? data.importInfo?.information_extracted ?? 0.7;
              await addVibeToCache(data, hash, fullModelName, infoExtracted);
            }
          }
        }
      }
    }

    const infoExtractedFromFile = encodingInfo?.params?.information_extracted ?? data.importInfo?.information_extracted ?? 0.7;

    const result = {
      id: crypto.randomUUID(),
      image: imageB64,
      thumbnail: thumbnail || null,
      hash: hash,
      informationExtracted: infoExtractedFromFile,
      referenceStrength: data.importInfo?.strength || 0.6,
      isV4Vibe: true,
      status: isConverted ? 'converted' : 'unconverted',
      isReadOnly: !hasImage,
      encodingInfo: { name: data.name },
      encoding: isConverted ? encodingInfo.encoding : null,
    };

    if (!result.image && result.status === 'unconverted') {
      return null;
    }

    return result;
  };

  const handleVibeV4FileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    const vibeFiles = files.filter(f => f.name.endsWith('.naiv4vibe') || f.name.endsWith('.naiv4vibebundle'));

    try {
      if (imageFiles.length > 0) await handleV4ImageUploadLogic(imageFiles);
      if (vibeFiles.length > 0) await handleV4VibeFileLogic(vibeFiles);
    } catch (error) {
      console.error('处理 V4 Vibe 文件失败:', error);
      forwardPaintingPanelError(onError, error, {
        source: 'vibe-file-processing',
        messageKey: 'painting.workspace.errors.processFileFailed',
      });
      setToast({ open: true, message: t('painting.workspace.errors.processFileFailed'), severity: 'error' });
    } finally {
      if (vibeFileInputRef.current) vibeFileInputRef.current.value = '';
    }
  };

  const handleVibeImageDelete = (index) => setVibeImages(prev => prev.filter((_, i) => i !== index));

  const handleVibeInfoChange = async (index, value) => {
    const updatedVibes = [...vibeImages];
    const vibe = updatedVibes[index];
    vibe.informationExtracted = value;

    if (vibe.isV4Vibe && !vibe.isReadOnly) {
      const cached = await getVibeFromCache(vibe.hash, params.model, value);
      if (cached) {
        const modelType = getV4ModelType(params.model);
        const encodingData = cached.encodings[modelType];
        const firstKey = Object.keys(encodingData)[0];
        vibe.encoding = encodingData[firstKey].encoding;
        vibe.status = 'converted';
        vibe.encodingInfo = { name: cached.name };
      } else {
        vibe.encoding = null;
        vibe.status = 'unconverted';
      }
    }
    setVibeImages(updatedVibes);
  };

  const handleVibeStrengthChange = (index, value) => setVibeImages(prev => { const n = [...prev]; n[index].referenceStrength = value; return n; });

  const handleVibeConvert = async (index) => {
    const vibe = vibeImages[index];
    if (!vibe || ['converting', 'converted'].includes(vibe.status)) {
      return;
    }

    setVibeImages(prev => prev.map((item, i) => i === index ? { ...item, status: 'converting' } : item));

    try {
      const model = params.model;
      const imageB64 = extractBase64FromDataUrl(vibe.image);
      const res = await apiClient.encodeVibe(imageB64, vibe.informationExtracted, model);
      const encoding = res.encoding;
      if (res.account_snapshot) {
        window.dispatchEvent(new CustomEvent('novelai:account-updated', {
          detail: res.account_snapshot,
        }));
      }

      const modelType = getV4ModelType(model);
      const hash = vibe.hash;
      const name = `${hash.substring(0, 6)}-${hash.substring(hash.length - 6)}`;

      const vibeJson = {
        identifier: "novelai-vibe-transfer",
        version: 1,
        type: "image",
        image: imageB64,
        id: hash,
        encodings: {
          [modelType]: {
            "unknown": {
              encoding: encoding,
              params: { information_extracted: vibe.informationExtracted }
            }
          }
        },
        name: name,
        thumbnail: vibe.thumbnail,
        createdAt: Date.now(),
        importInfo: {
          model: model,
          information_extracted: vibe.informationExtracted,
          strength: vibe.referenceStrength
        }
      };

      await addVibeToCache(vibeJson, hash, model, vibe.informationExtracted);
      setVibeImages(prev => prev.map((item, i) => i === index ? { ...item, status: 'converted', encoding: encoding, encodingInfo: { name } } : item));
      setToast({ open: true, message: t('painting.workspace.notifications.vibeConverted'), severity: 'success' });
    } catch (error) {
      console.error("Vibe conversion failed:", error);
      setVibeImages(prev => prev.map((item, i) => i === index ? { ...item, status: 'error' } : item));
      const reported = forwardPaintingPanelError(onError, error, {
        source: 'vibe-encoding',
        messageKey: 'painting.workspace.errors.vibeConversionFailed',
      });
      if (!reported) {
        setToast({ open: true, message: t('painting.workspace.errors.vibeConversionFailed'), severity: 'error' });
      }
    }
  };

  const handleDownloadVibe = async (index) => {
    const vibeItem = vibeImages[index];
    if (vibeItem.status !== 'converted') {
      setToast({ open: true, message: t('painting.workspace.errors.convertedVibeRequired'), severity: 'warning' });
      return;
    }

    try {
      const fullVibeData = await getVibeFromCache(vibeItem.hash, params.model, vibeItem.informationExtracted);
      if (!fullVibeData) {
        throw Object.assign(new Error('VIBE_DATA_NOT_FOUND'), { code: 'VIBE_DATA_NOT_FOUND' });
      }

      const blob = new Blob([JSON.stringify(fullVibeData, null, 2)], { type: 'application/json;charset=utf-8' });
      saveAs(blob, `${fullVibeData.name || vibeItem.hash}.naiv4vibe`);

    } catch (error) {
      console.error('下载Vibe文件失败:', error);
      forwardPaintingPanelError(onError, error, {
        source: 'vibe-download',
        messageKey: 'painting.workspace.errors.downloadFailed',
      });
      setToast({ open: true, message: t('painting.workspace.errors.downloadFailed'), severity: 'error' });
    }
  };

  const handleDownloadBundle = async () => {
    const convertedVibes = vibeImages.filter(v => v.status === 'converted');
    if (convertedVibes.length === 0) {
      setToast({ open: true, message: t('painting.workspace.errors.noConvertedVibes'), severity: 'info' });
      return;
    }

    try {
      const vibeDataList = await Promise.all(
        convertedVibes.map(v => getVibeFromCache(v.hash, params.model, v.informationExtracted))
      );

      const validVibeData = vibeDataList.filter(Boolean);

      const bundle = {
        identifier: "novelai-vibe-transfer-bundle",
        version: 1,
        vibes: validVibeData,
      };

      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' });
      saveAs(blob, 'vibes.naiv4vibebundle');

    } catch (error) {
      console.error('打包下载Vibe失败:', error);
      forwardPaintingPanelError(onError, error, {
        source: 'vibe-bundle-download',
        messageKey: 'painting.workspace.errors.bundleDownloadFailed',
      });
      setToast({ open: true, message: t('painting.workspace.errors.bundleDownloadFailed'), severity: 'error' });
    }
  };

  // [修改] ZIP 下载函数，从数据库读取所有数据
  const handleDownloadZip = async () => {
    try {
      const allVibesFromDB = await getAllVibesFromCache();
      if (!allVibesFromDB || allVibesFromDB.length === 0) {
        setToast({ open: true, message: t('painting.workspace.errors.noVibeDataForZip'), severity: 'info' });
        return;
      }

      const zip = new JSZip();

      const vibesByHash = allVibesFromDB.reduce((acc, vibe) => {
        const hash = vibe.id;
        if (!acc[hash]) acc[hash] = [];
        acc[hash].push(vibe);
        return acc;
      }, {});

      for (const hash in vibesByHash) {
        const vibes = vibesByHash[hash];
        if (vibes.length === 1) {
          const vibeData = vibes[0];
          const fileName = `${vibeData.name || vibeData.id}.naiv4vibe`;
          zip.file(fileName, JSON.stringify(vibeData, null, 2));
        } else {
          for (const vibeData of vibes) {
            const baseName = vibeData.name || vibeData.id;
            const ie = (vibeData.importInfo?.information_extracted?.toFixed(1)) || 'unknown';
            const fileName = `${baseName}_ie${ie}.naiv4vibe`;
            zip.file(fileName, JSON.stringify(vibeData, null, 2));
          }
        }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, 'vibes_database.zip');

    } catch (error) {
      console.error('ZIP下载Vibe失败:', error);
      forwardPaintingPanelError(onError, error, {
        source: 'vibe-zip-download',
        messageKey: 'painting.workspace.errors.zipDownloadFailed',
      });
      setToast({ open: true, message: t('painting.workspace.errors.zipDownloadFailed'), severity: 'error' });
    }
  };

  const handleAddCharacterTab = () => {
    const enabledCharacterCount = getEnabledItemCount(characterTabs);
    const isV5Model = isNovelAIV5Model(params.model);
    if (!isV5Model && enabledCharacterCount >= MAX_ACTIVE_CHARACTERS) {
      setToast({ open: true, message: t('painting.workspace.errors.activeCharacterLimit', { max: MAX_ACTIVE_CHARACTERS }), severity: 'warning' });
      return;
    }
    setCharacterTabs(prev => [...prev, {
      name: '',
      prompt: '',
      uc: '',
      position: 'C3',
      center: { x: 0.5, y: 0.5 },
      colorId: Math.floor(Math.random() * 6),
      isTemporarilyDisabled: false,
    }]);
    if (isV5Model && enabledCharacterCount + 1 > NOVELAI_V5_CHARACTER_WARNING_THRESHOLD) {
      setToast({ open: true, message: t('painting.workspace.errors.v5CharacterOverlapWarning'), severity: 'warning' });
    }
  };

  const handleDeleteCharacterTab = (index) => setCharacterTabs(prev => prev.filter((_, i) => i !== index));
  const handleMoveUpCharacterTab = (index) => {
    if (index <= 0) return;
    setCharacterTabs(prev => { const n = [...prev];[n[index], n[index - 1]] = [n[index - 1], n[index]]; return n; });
  };
  const handleMoveDownCharacterTab = (index) => {
    if (index >= characterTabs.length - 1) return;
    setCharacterTabs(prev => { const n = [...prev];[n[index], n[index + 1]] = [n[index + 1], n[index]]; return n; });
  };

  const handleCharacterDataChange = (index, newData) => setCharacterTabs(prev => { const n = [...prev]; n[index] = newData; return n; });
  const handleOpenCharacterEditor = (index, field, currentText) => {
    setEditingCharacterPrompt({ index, field, text: currentText || '' });
    setCharacterEditorOpen(true);
  };
  const handleCharacterPromptChange = (newText) => {
    const { index, field } = editingCharacterPrompt;
    if (index !== null && field) {
      handleCharacterDataChange(index, { ...characterTabs[index], [field]: newText });
    }
  };

  const handleCharacterToggleDisabled = (index) => setCharacterTabs(prev => {
    const targetCharacter = prev[index];
    if (!targetCharacter) {
      return prev;
    }

    const willEnable = targetCharacter.isTemporarilyDisabled === true;
    const enabledCharacterCount = getEnabledItemCount(prev);
    const isV5Model = isNovelAIV5Model(params.model);
    if (willEnable && !isV5Model && enabledCharacterCount >= MAX_ACTIVE_CHARACTERS) {
      setToast({ open: true, message: t('painting.workspace.errors.enableCharacterLimit', { max: MAX_ACTIVE_CHARACTERS }), severity: 'warning' });
      return prev;
    }
    if (willEnable && isV5Model && enabledCharacterCount + 1 > NOVELAI_V5_CHARACTER_WARNING_THRESHOLD) {
      setToast({ open: true, message: t('painting.workspace.errors.v5CharacterOverlapWarning'), severity: 'warning' });
    }

    return prev.map((item, i) => (
      i === index
        ? { ...item, isTemporarilyDisabled: !willEnable ? true : false }
        : item
    ));
  });

  const handleVibeToggleDisabled = (index) => setVibeImages(prev => {
    const targetVibe = prev[index];
    if (!targetVibe) {
      return prev;
    }

    const willEnable = targetVibe.isTemporarilyDisabled === true;
    if (willEnable && getEnabledItemCount(prev) >= MAX_ACTIVE_VIBES) {
      setToast({ open: true, message: t('painting.workspace.errors.enableVibeLimit', { max: MAX_ACTIVE_VIBES }), severity: 'warning' });
      return prev;
    }

    return prev.map((item, i) => (
      i === index
        ? { ...item, isTemporarilyDisabled: !willEnable ? true : false }
        : item
    ));
  });

  const getVibeTransferData = useCallback(() => {
    if (!isNovelAIVibeModel(params.model)) {
      return null;
    }

    const imageReferenceActive = !!(
      isNovelAIDirectorReferenceModel(params.model)
      && params.director_reference_images_cached
      && params.director_reference_images_cached.length > 0
    );
    const activeVibes = vibeImages.filter(item => item.isTemporarilyDisabled !== true).slice(0, MAX_ACTIVE_VIBES);

    if (imageReferenceActive || activeVibes.length === 0) {
      return null;
    }

    if (isV4Model(params.model)) {
      const v4Vibes = activeVibes.filter(item => item.isV4Vibe && item.status === 'converted');

      if (v4Vibes.length === 0) {
        return null;
      }

      return {
        reference_image_multiple: v4Vibes.map(item => item.encoding),
        reference_strength_multiple: v4Vibes.map(item => item.referenceStrength),
        use_v4_vibe: true
      };
    }
    return {
      images: activeVibes.map(item => item.image),
      informationExtracted: activeVibes.map(item => item.informationExtracted),
      referenceStrength: activeVibes.map(item => item.referenceStrength)
    };
  }, [vibeImages, params.model, params.director_reference_images_cached]);

  const getCharacterData = useCallback(() => {
    if (isNovelAIV5Model(params.model)) {
      return buildNovelAIV5CharacterControl(
        characterTabs,
        params.characterPositionMode === 'custom',
      );
    }

    const positionMapping = {
      row: { '1': 0.1, '2': 0.3, '3': 0.5, '4': 0.7, '5': 0.9 },
      col: { 'A': 0.1, 'B': 0.3, 'C': 0.5, 'D': 0.7, 'E': 0.9 }
    };
    const getCenter = (pos) => ({ x: positionMapping.col[pos.charAt(0)], y: positionMapping.row[pos.charAt(1)] });
    const activeCharacterTabs = characterTabs.filter(tab => tab.isTemporarilyDisabled !== true).slice(0, MAX_ACTIVE_CHARACTERS);

    return {
      characterPrompts: activeCharacterTabs.map(t => ({ prompt: t.prompt, uc: t.uc, center: getCenter(t.position) })),
      v4_prompt_char_captions: activeCharacterTabs.map(t => ({ char_caption: t.prompt, centers: [getCenter(t.position)] })),
      v4_negative_prompt_char_captions: activeCharacterTabs.map(t => ({ char_caption: t.uc, centers: [getCenter(t.position)] })),
      aiDecidePosition: activeCharacterTabs.length > 0 ? params.aiDecidePosition : false,
      enabledCharacterCount: activeCharacterTabs.length,
      characterTabs: characterTabs
    };
  }, [characterTabs, params.aiDecidePosition, params.characterPositionMode, params.model]);

  const getAllParameters = useCallback(() => {
    const normalizedParams = normalizeNovelAISmeaParams(params);
    const allParams = {
      ...normalizedParams,
      positivePrompt: extractActiveContent(positivePrompt, { processRandomPrompts: randomPromptEnabled, randomPromptConfig }),
      negativePrompt: extractActiveContent(negativePrompt, { processRandomPrompts: randomPromptEnabled, randomPromptConfig }),
      vibeTransfer: getVibeTransferData(),
      characterControl: getCharacterData()
    };

    if (!isNovelAIDirectorReferenceModel(params.model)) {
      NOVELAI_DIRECTOR_REFERENCE_PARAM_KEYS.forEach((key) => delete allParams[key]);
    }

    if (imagePreview) {
      allParams.imageToImage = {
        image: imagePreview,
        strength: params.strength,
        noise: params.noise,
        ...(editedImageData && { editedImage: editedImageData }),
        ...(directorToolParams && { directorTools: { active: true, tool: directorToolParams.type, params: directorToolParams.params || { enabled: true } } })
      };
    }
    return sanitizeNovelAIV5GenerationParams(allParams);
  }, [params, positivePrompt, negativePrompt, randomPromptEnabled, randomPromptConfig,
    getVibeTransferData, getCharacterData, imagePreview, editedImageData,
    directorToolParams]);

  useEffect(() => {
    if (getAllParametersRef) getAllParametersRef.current = getAllParameters;
  }, [getAllParametersRef, getAllParameters]);

  useEffect(() => {
    setTempInputs(prev => ({
      width: editing.width ? prev.width : params.width.toString(),
      height: editing.height ? prev.height : params.height.toString(),
    }));
  }, [editing.height, editing.width, params.height, params.width]);

  const getLinkedResolutionChange = (field, rawValue) => {
    const parsedValue = parseInt(rawValue, 10);

    if (Number.isNaN(parsedValue)) {
      return null;
    }

    const maxResolution = params.use_upscale_credits ? 4096 : 2048;
    const normalizedValue = Math.min(maxResolution, Math.max(512, Math.round(parsedValue / 64) * 64));
    const requestedWidth = field === 'width' ? normalizedValue : params.width;
    const requestedHeight = field === 'height' ? normalizedValue : params.height;
    const [nextWidth, nextHeight] = field === 'width'
      ? findAllowedResolutionWithFixedWidth(normalizedValue, params.height)
      : findAllowedResolutionWithFixedHeight(params.width, normalizedValue);

    return {
      parsedValue,
      requestedWidth,
      requestedHeight,
      nextWidth,
      nextHeight,
    };
  };

  const applyLinkedResolutionChange = ({ nextWidth, nextHeight }) => {
    if (nextWidth !== params.width) {
      handleParamChange('width', nextWidth);
    }
    if (nextHeight !== params.height) {
      handleParamChange('height', nextHeight);
    }
  };

  const handleInputFocus = (field) => {
    setEditing(prev => ({ ...prev, [field]: true }));
    setTempInputs(prev => ({ ...prev, [field]: params[field].toString() }));
  };
  const handleInputChange = (field, value) => {
    setTempInputs(prev => ({ ...prev, [field]: value }));

    const resolutionChange = getLinkedResolutionChange(field, value);

    if (!resolutionChange || resolutionChange.parsedValue < 512) {
      return;
    }

    applyLinkedResolutionChange(resolutionChange);
  };
  const handleInputBlur = (field) => {
    setEditing(prev => ({ ...prev, [field]: false }));

    const resolutionChange = getLinkedResolutionChange(field, tempInputs[field]);

    if (!resolutionChange) {
      setTempInputs(prev => ({ ...prev, [field]: params[field].toString() }));
      return;
    }

    const {
      requestedWidth,
      requestedHeight,
      nextWidth,
      nextHeight,
    } = resolutionChange;

    setTempInputs({ width: nextWidth.toString(), height: nextHeight.toString() });

    applyLinkedResolutionChange({ nextWidth, nextHeight });

    if (nextWidth !== requestedWidth || nextHeight !== requestedHeight) {
      setToast({
        open: true,
        message: t('painting.workspace.notifications.resolutionAdjusted', {
          originalWidth: requestedWidth,
          originalHeight: requestedHeight,
          newWidth: nextWidth,
          newHeight: nextHeight,
        }),
        severity: 'info',
      });
    }
  };

  const handleSeedChange = (value, isRandom = false) => {
    if (isRandom) {
      handleRefreshSeed();
      return;
    }
    if (value === '') {
      handleParamChange('seed', '');
    } else {
      const numValue = Number.parseInt(value, 10);
      const maxSeed = 4294967295;
      if (!isNaN(numValue)) {
        const clampedValue = Math.min(numValue, maxSeed);
        handleParamChange('seed', clampedValue);
        if (clampedValue !== numValue) {
          setToast({ open: true, message: t('painting.workspace.notifications.seedClamped', { max: maxSeed }), severity: 'warning' });
        }
      }
    }
  };

  const handleCloseToast = (event, reason) => {
    if (reason === 'clickaway') return;
    setToast(prev => ({ ...prev, open: false }));
  };

  const renderEditSummary = () => {
    if (!imagePreview) return null;
    return (
      <Box sx={{ p: 2, borderTop: `1px solid ${theme.palette.divider}` }}>
        <Typography variant="caption" fontWeight="bold" color="text.secondary">{t('painting.workspace.parameters.appliedEditEffects')}</Typography>
        {editedImageData && (
          <Box sx={{ display: 'flex', alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
            <Chip label={t('painting.workspace.parameters.imageEdited')} size="small" color="primary" sx={{ mr: 1 }} />
            <Typography variant="caption" color="text.secondary">{t('painting.workspace.parameters.editedImageWillBeUsed')}</Typography>
          </Box>
        )}
        {directorToolParams && (
          <Box sx={{ display: 'flex', alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
            <Chip label={directorToolParams.type} size="small" color="secondary" sx={{ mr: 1 }} />
            <Box sx={{ flexGrow: 1 }} />
            <Button variant="outlined" color="error" size="small" startIcon={<DeleteIcon fontSize="small" />} onClick={clearDirectorToolParams} sx={{ ml: 1, mt: { xs: 1, sm: 0 }, fontSize: '0.7rem', py: 0.5 }}>{t('painting.workspace.parameters.remove')}</Button>
          </Box>
        )}
        {!editedImageData && !directorToolParams && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{t('painting.workspace.parameters.noEditEffects')}</Typography>
        )}
      </Box>
    );
  };

  const debugParams = () => console.log('当前参数:', getAllParameters());

  // 添加状态判断，用于决定是否禁用相关模块
  const hasImageReference = !!(
    isNovelAIDirectorReferenceModel(params.model)
    && params.director_reference_images_cached
    && params.director_reference_images_cached.length > 0
  );
  const hasActiveVibes = vibeImages.some(item => item.isTemporarilyDisabled !== true);

  return (
    <Box sx={{ p: 0 }}>
      <Snackbar open={toast.open} autoHideDuration={3000} onClose={handleCloseToast} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert onClose={handleCloseToast} severity={toast.severity} sx={{ width: '100%' }}>{toast.message}</Alert>
      </Snackbar>

      {/* 模型选择与基础参数 Accordion */}
      <Accordion
        expanded={expandedPanels.basic}
        onChange={(_, isExpanded) => onExpandedPanelsChange('basic', isExpanded)}
        disableGutters
        sx={{ boxShadow: 'none', '&::before': { display: 'none' }, borderRadius: 2, overflow: 'hidden', '&.Mui-expanded': { margin: 0 } }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          sx={{
            minHeight: 40,
            backgroundColor: expandedPanels.basic ? 'action.hover' : 'transparent',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <TuneIcon sx={{ mr: 1, color: 'text.secondary', opacity: 0.7 }} />
            <Typography variant="subtitle2" fontWeight="medium">{t('painting.workspace.parameters.modelAndBasic')}</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 1, pb: 1, pt: 1 }}>
          <FormControl fullWidth variant="outlined" size="small" sx={{ mt: 1 }}>
            <InputLabel id="model-select-label">{t('painting.workspace.parameters.aiModel')}</InputLabel>
            <Select
              labelId="model-select-label"
              value={params.model}
              onChange={(e) => handleParamChange('model', e.target.value)}
              label={t('painting.workspace.parameters.aiModel')}
            >
              {modelOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    {option.icon && <Box sx={{ mr: 1.5, display: 'flex', alignItems: 'center', color: 'text.secondary' }}>{option.icon}</Box>}
                    <Box>
                      <Typography variant="body2">{option.label}</Typography>
                      <Typography variant="caption" color="text.secondary">{t(option.descriptionKey)}</Typography>
                    </Box>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {isNovelAIV5Model(params.model) && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {t('painting.workspace.parameters.modelV5Limitations')}
            </Typography>
          )}

          <BasicParameters
              params={{ ...normalizeNovelAISmeaParams(params), isV4Model: isV4Model(params.model) }}
              handleParamChange={handleParamChange}
              handleSeedChange={handleSeedChange}
              editing={editing}
              tempInputs={tempInputs}
              handleInputFocus={handleInputFocus}
              handleInputChange={handleInputChange}
              handleInputBlur={handleInputBlur}
              handleSizePresetClick={handleSizePresetClick}
              handleClearSeed={handleClearSeed}
              handleRefreshSeed={handleRefreshSeed}
              handleSmeaChange={handleSmeaChange}
              handleDynChange={handleDynChange}
              handleResetParamsConfirm={handleResetParamsConfirm}
              expandedPanels={expandedPanels}
              onExpandedPanelsChange={onExpandedPanelsChange}
              onReferenceImageChange={handleReferenceImageChange}
              isV5Model={isNovelAIV5Model(params.model)}
              imageReferenceDisabled={hasActiveVibes}
          />
        </AccordionDetails>
      </Accordion>

      <ImageParameterPanel
          params={{ ...normalizeNovelAISmeaParams(params), isV4Model: isV4Model(params.model) }}
          handleParamChange={handleParamChange}
          handleSeedChange={handleSeedChange}
          editing={editing}
          tempInputs={tempInputs}
          handleInputFocus={handleInputFocus}
          handleInputChange={handleInputChange}
          handleInputBlur={handleInputBlur}
          handleSizePresetClick={handleSizePresetClick}
          handleClearSeed={handleClearSeed}
          handleRefreshSeed={handleRefreshSeed}
          handleResetParamsConfirm={handleResetParamsConfirm}
          expandedPanels={expandedPanels}
          onExpandedPanelsChange={onExpandedPanelsChange}
          fileInputRef={fileInputRef}
          vibeFileInputRef={vibeFileInputRef}
          vibeImages={vibeImages}
          setVibeImages={setVibeImages}
          imagePreview={imagePreview}
          handleImageUpload={handleImageUpload}
          handleImageDelete={handleImageDelete}
          handleOpenEditor={handleOpenEditor}
          isDragging={isDragging} handleDragOver={handleDragOver} handleDragEnter={handleDragEnter} handleDragLeave={handleDragLeave} handleDrop={handleDrop}
          isVibeDragging={isVibeDragging} handleVibeDragOver={handleVibeDragOver} handleVibeDragEnter={handleVibeDragEnter} handleVibeDragLeave={handleVibeDragLeave} handleVibeDrop={handleVibeDrop}
          handleVibeImageUpload={handleVibeImageUpload} handleVibeImageDelete={handleVibeImageDelete} handleVibeInfoChange={handleVibeInfoChange} handleVibeStrengthChange={handleVibeStrengthChange}
          handleVibeConvert={handleVibeConvert}
          onDownloadVibe={handleDownloadVibe}
          onDownloadBundle={handleDownloadBundle}
          onDownloadZip={handleDownloadZip}
          handleVibeV4FileUpload={handleVibeV4FileUpload}
          onReferenceImageChange={handleReferenceImageChange}
          characterTabs={characterTabs}
          handleCharacterDataChange={handleCharacterDataChange}
          handleOpenCharacterEditor={handleOpenCharacterEditor}
          handleAddCharacterTab={handleAddCharacterTab}
          handleDeleteCharacterTab={handleDeleteCharacterTab}
          handleMoveUpCharacterTab={handleMoveUpCharacterTab}
          handleMoveDownCharacterTab={handleMoveDownCharacterTab}
          renderEditSummary={renderEditSummary}
          editorKey={editorKey} editorOpen={editorOpen} handleCloseEditor={handleCloseEditor}
          directorToolParams={directorToolParams}
          handleVibeToggleDisabled={handleVibeToggleDisabled}
          handleCharacterToggleDisabled={handleCharacterToggleDisabled}
          vibeDisabled={hasImageReference}
          imageReferenceDisabled={hasActiveVibes}
          isV5Model={isNovelAIV5Model(params.model)}
      />

      <Button variant="outlined" size="small" onClick={debugParams} sx={{ mt: 2, display: process.env.NODE_ENV === 'production' ? 'none' : 'block' }}>
        {t('painting.workspace.parameters.logParameters')}
      </Button>

      {/* Dialogs */}
      <Dialog open={resetDialogOpen} onClose={() => setResetDialogOpen(false)}>
        <DialogTitle>{t('painting.workspace.parameters.resetConfirmationTitle')}</DialogTitle>
        <DialogContent><DialogContentText>{t('painting.workspace.parameters.resetConfirmationDescription')}</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setResetDialogOpen(false)}>{t('painting.workspace.actions.cancel')}</Button>
          <Button onClick={handleResetParams} color="error" autoFocus>{t('painting.workspace.parameters.confirmReset')}</Button>
        </DialogActions>
      </Dialog>
      <MetadataDialog open={metadataDialogOpen} onClose={() => setMetadataDialogOpen(false)} metadata={extractedMetadata} onApply={handleApplyMetadata} />
      <Dialog open={resolutionCheckDialogOpen} onClose={() => handleResolutionChoice(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('painting.workspace.parameters.resolutionAdjustmentTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>{t('painting.workspace.parameters.resolutionOutOfRange', {
            width: resolutionCheckData?.currentResolution.width,
            height: resolutionCheckData?.currentResolution.height,
          })}</DialogContentText>
          {resolutionCheckData?.suggestedResolution && (
            <DialogContentText>
              {t('painting.workspace.parameters.suggestedResolution', {
                width: resolutionCheckData.suggestedResolution[0],
                height: resolutionCheckData.suggestedResolution[1],
              })}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleResolutionChoice(false)}>{t('painting.workspace.actions.cancel')}</Button>
          <Button onClick={() => handleResolutionChoice(true)} color="primary" variant="contained">{t('painting.workspace.parameters.compressAndContinue')}</Button>
        </DialogActions>
      </Dialog>
      <ExpandedPromptDialog
        open={characterEditorOpen}
        onClose={() => setCharacterEditorOpen(false)}
        initialText={editingCharacterPrompt.text}
        onTextChange={handleCharacterPromptChange}
        title={t('painting.workspace.parameters.editCharacterField', {
          number: editingCharacterPrompt.index !== null ? editingCharacterPrompt.index + 1 : '',
          field: editingCharacterPrompt.field === 'prompt'
            ? t('painting.workspace.parameters.descriptionField')
            : t('painting.workspace.parameters.avoidContent'),
        })}
        isPositive={editingCharacterPrompt.field === 'prompt'}
        model={params.model}
        relatedPromptTexts={[
          editingCharacterPrompt.field === 'prompt' ? positivePrompt : negativePrompt,
          ...getEnabledNovelAICharacterPromptTexts(
            characterTabs,
            editingCharacterPrompt.field === 'prompt' ? 'prompt' : 'uc',
            editingCharacterPrompt.index,
          ),
        ]}
        includeCurrentInTokenTotal={
          editingCharacterPrompt.index !== null
          && characterTabs[editingCharacterPrompt.index]?.isTemporarilyDisabled !== true
        }
      />
    </Box>
  );
};

export default ParameterPanel;
