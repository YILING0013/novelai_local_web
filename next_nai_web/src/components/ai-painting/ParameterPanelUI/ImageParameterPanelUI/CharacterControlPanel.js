"use client";

import React, { useId, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Collapse,
  IconButton,
  InputBase,
  Paper,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  ArrowDownward as ArrowDownwardIcon,
  ArrowUpward as ArrowUpwardIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  Face as FaceIcon,
  GridOn as GridOnIcon,
  Info as InfoIcon,
  OpenInFull as OpenInFullIcon,
} from '@mui/icons-material';
import TemporaryDisableButton from './TemporaryDisableButton';
import CharacterPositionEditorDialog from './CharacterPositionEditorDialog';
import {
  NOVELAI_V5_CHARACTER_WARNING_THRESHOLD,
  normalizeNovelAICharacterCenter,
} from '../../utils/modelUtils';
import {
  CHARACTER_NAME_MAX_LENGTH,
  normalizeCharacterName,
  resolveCharacterName,
} from '../../utils/characterName.mjs';
import { useI18n } from '@/i18n/I18nProvider';

const CharacterControlTab = ({
  data,
  onDelete,
  onMoveUp,
  onMoveDown,
  onDataChange,
  index,
  onOpenEditor,
  onToggleDisabled,
  canMoveUp,
  canMoveDown,
  isV5Model,
  isV5Medium,
  characterPositionMode,
}) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const visibleTab = isV5Medium ? 0 : activeTab;
  const activeField = visibleTab === 0 ? 'prompt' : 'uc';
  const activeFieldLabel = t(visibleTab === 0
    ? 'painting.workspace.parameters.characterDescription'
    : 'painting.workspace.parameters.avoidContent');
  const editorId = useId();
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const cancelNameEditRef = useRef(false);
  const isTemporarilyDisabled = data.isTemporarilyDisabled === true;
  const defaultCharacterName = t('painting.workspace.parameters.defaultCharacterName', { index: index + 1 });

  const getPreviewText = () => {
    return resolveCharacterName(data.name, defaultCharacterName);
  };

  const startNameEdit = (event) => {
    event.stopPropagation();
    cancelNameEditRef.current = false;
    setNameDraft(normalizeCharacterName(data.name));
    setIsEditingName(true);
  };

  const commitNameEdit = (event) => {
    event.stopPropagation();
    if (cancelNameEditRef.current) {
      cancelNameEditRef.current = false;
      return;
    }

    const nextName = normalizeCharacterName(nameDraft);
    const currentName = typeof data.name === 'string' ? data.name : '';
    if (nextName !== currentName) {
      onDataChange(index, { ...data, name: nextName });
    }
    setIsEditingName(false);
  };

  const handleNameKeyDown = (event) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelNameEditRef.current = true;
      setNameDraft(normalizeCharacterName(data.name));
      setIsEditingName(false);
    }
  };

  const handleNameTitleKeyDown = (event) => {
    event.stopPropagation();
    if (event.key !== 'Enter' && event.key !== 'F2') return;

    event.preventDefault();
    startNameEdit(event);
  };

  return (
    <Paper
      elevation={0}
      sx={{
        mb: 2,
        overflow: 'hidden',
        borderRadius: 1,
        bgcolor: 'transparent',
        boxShadow: 'none',
        border: '1px solid',
        borderColor: isTemporarilyDisabled ? 'warning.light' : 'divider',
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 0.75,
          minHeight: 40,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 0.75,
          position: 'relative',
          bgcolor: 'action.hover',
          borderBottom: expanded ? '1px solid' : 0,
          borderColor: 'divider',
        }}
      >
        <ButtonBase
          aria-label={`${t(expanded ? 'painting.workspace.parameters.collapseCharacter' : 'painting.workspace.parameters.expandCharacter')}: ${getPreviewText()}`}
          aria-expanded={expanded}
          aria-controls={editorId}
          onClick={() => setExpanded((prev) => !prev)}
          sx={{ position: 'absolute', inset: 0, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flexGrow: 1, position: 'relative', pointerEvents: 'none' }}>
          {isEditingName ? (
            <InputBase
              autoFocus
              value={nameDraft}
              placeholder={defaultCharacterName}
              onChange={(event) => setNameDraft(normalizeCharacterName(event.target.value))}
              onBlur={commitNameEdit}
              onKeyDown={handleNameKeyDown}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              inputProps={{
                maxLength: CHARACTER_NAME_MAX_LENGTH,
                'aria-label': t('painting.workspace.parameters.characterName'),
              }}
              sx={{
                minWidth: 0,
                pointerEvents: 'auto',
                width: 'min(100%, 160px)',
                color: 'text.primary',
                fontSize: '0.875rem',
                fontWeight: 500,
                lineHeight: 1.25,
                borderBottom: '1px solid',
                borderColor: 'primary.main',
                '& input': { p: 0, height: 'auto' },
                '& input::placeholder': { color: 'text.secondary', opacity: 0.72 },
              }}
            />
          ) : (
            <Tooltip title={t('painting.workspace.parameters.editCharacterName')}>
              <Typography
                component="button"
                type="button"
                variant="body2"
                fontWeight="medium"
                aria-label={t('painting.workspace.parameters.editCharacterName')}
                onDoubleClick={startNameEdit}
                onKeyDown={handleNameTitleKeyDown}
                onPointerDown={(event) => event.stopPropagation()}
                sx={{
                  display: 'block',
                  pointerEvents: 'auto',
                  minWidth: 0,
                  maxWidth: '100%',
                  p: 0,
                  border: 0,
                  bgcolor: 'transparent',
                  cursor: 'text',
                  color: 'text.primary',
                  fontSize: 15,
                  lineHeight: 1.25,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textAlign: 'left',
                  '&:hover': { textDecoration: 'underline' },
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: 2,
                    borderRadius: 0.25,
                  },
                }}
              >
                {getPreviewText()}
              </Typography>
            </Tooltip>
          )}
          {isV5Model ? (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
              {characterPositionMode === 'custom'
                ? t('painting.workspace.parameters.normalizedCoordinates', {
                  x: normalizeNovelAICharacterCenter(data.center, data.position).x.toFixed(3),
                  y: normalizeNovelAICharacterCenter(data.center, data.position).y.toFixed(3),
                })
                : t('painting.workspace.parameters.aiDecidesPosition')}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
              {t('painting.workspace.parameters.positionValue', { position: data.position || 'C3' })}
            </Typography>
          )}
          {isTemporarilyDisabled && (
            <Typography variant="caption" color="warning.main" noWrap sx={{ minWidth: 0 }}>
              {t('painting.workspace.parameters.temporarilyDisabled')}
            </Typography>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, position: 'relative' }}>
          <IconButton aria-label={t('painting.workspace.parameters.moveCharacterUp')} color="primary" size="small" onClick={onMoveUp} disabled={!canMoveUp} sx={{ p: 0.5 }}>
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
          <IconButton aria-label={t('painting.workspace.parameters.moveCharacterDown')} color="primary" size="small" onClick={onMoveDown} disabled={!canMoveDown} sx={{ p: 0.5 }}>
            <ArrowDownwardIcon fontSize="small" />
          </IconButton>
          <TemporaryDisableButton
            isDisabled={isTemporarilyDisabled}
            onToggle={() => onToggleDisabled(index)}
            iconOnly
            sx={{ color: isTemporarilyDisabled ? 'warning.main' : 'primary.main' }}
          />
          <IconButton aria-label={t('painting.workspace.parameters.deleteCharacter')} color="primary" size="small" onClick={onDelete} sx={{ p: 0.5 }}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {expanded && (
        <Box id={editorId} sx={{ p: '1px', opacity: isTemporarilyDisabled ? 0.74 : 1, transition: 'opacity 0.2s ease' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <Tabs
              value={visibleTab}
              onChange={(_, nextTab) => setActiveTab(nextTab)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ flex: 1, minWidth: 0, minHeight: 30, '& .MuiTab-root': { minWidth: 0, minHeight: 30, px: 0.75, py: 0.5, fontSize: '0.75rem', textTransform: 'none' } }}
            >
              <Tab label={t('painting.workspace.parameters.characterPromptTab')} />
              <Tab label={t(isV5Medium ? 'painting.workspace.parameters.fixedNegativeTab' : 'painting.workspace.parameters.characterAvoidTab')} disabled={isV5Medium} />
            </Tabs>
            {isV5Medium && (
              <Tooltip title={t('painting.workspace.parameters.modelV5MediumNegativeHelp')} arrow>
                <IconButton size="small" aria-label={t('painting.workspace.parameters.fixedNegativeTab')}><InfoIcon fontSize="small" /></IconButton>
              </Tooltip>
            )}
            <Tooltip title={t('painting.workspace.parameters.expandEditor')}>
              <IconButton
                size="small"
                aria-label={`${t('painting.workspace.parameters.expandEditor')}: ${activeFieldLabel}`}
                onClick={() => onOpenEditor(index, activeField, data[activeField] || '')}
                sx={{ width: 30, height: 30, flexShrink: 0, p: 0.5 }}
              >
                <OpenInFullIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <TextField
            fullWidth
            multiline
            minRows={2}
            maxRows={5}
            label={activeFieldLabel}
            placeholder={t(visibleTab === 0
              ? 'painting.workspace.parameters.characterDescriptionPlaceholder'
              : 'painting.workspace.parameters.avoidContentPlaceholder')}
            value={data[activeField] || ''}
            onChange={(event) => onDataChange(index, { ...data, [activeField]: event.target.value })}
            size="small"
            sx={{
              mt: 0.75,
              minWidth: 0,
              '& .MuiInputLabel-root': { maxWidth: 'calc(100% - 16px)' },
              '& .MuiOutlinedInput-root': { px: 0.75 },
            }}
          />
        </Box>
      )}
    </Paper>
  );
};

/**
 * 管理角色控件，并把折叠入口和展开列表交给词条区安排位置。
 * @param {object} props 角色数据、操作回调和可选的词条区渲染函数。
 * @returns {React.ReactElement} 词条区、角色控件和位置弹窗。
 */
const CharacterControlPanel = ({
  params,
  handleParamChange,
  expandedPanels,
  onExpandedPanelsChange,
  characterTabs,
  handleAddCharacterTab,
  handleDeleteCharacterTab,
  handleMoveUpCharacterTab,
  handleMoveDownCharacterTab,
  handleCharacterDataChange,
  handleOpenCharacterEditor,
  handleCharacterToggleDisabled,
  isV5Model = false,
  visible = true,
  renderPromptPanel = null,
}) => {
  const { t } = useI18n();
  const controlId = useId();
  const [positionEditorOpen, setPositionEditorOpen] = useState(false);
  const enabledCharacterCount = characterTabs.filter((tab) => tab.isTemporarilyDisabled !== true).length;
  const characterPositionMode = isV5Model
    ? (params.characterPositionMode === 'custom' ? 'custom' : 'ai')
    : (params.aiDecidePosition ? 'ai' : 'custom');

  const summary = visible ? (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, maxWidth: '100%' }}>
      <Button
        id={`${controlId}-toggle`}
        aria-expanded={Boolean(expandedPanels.character)}
        aria-controls={`${controlId}-content`}
        onClick={() => onExpandedPanelsChange('character', !expandedPanels.character)}
        color="inherit"
        size="small"
        sx={{ minWidth: 0, minHeight: 34, px: 0.5, gap: 0.5, textTransform: 'none', whiteSpace: 'nowrap' }}
      >
        <FaceIcon sx={{ flexShrink: 0, fontSize: 16, color: 'text.secondary' }} />
        <Typography component="span" noWrap sx={{ minWidth: 0, fontSize: 13, fontWeight: 500 }}>{t('painting.workspace.parameters.characterControl')}</Typography>
        <Typography component="span" color="text.secondary" noWrap sx={{ minWidth: 0, fontSize: 11 }}>
          {t('painting.workspace.parameters.characterCount', {
            configured: characterTabs.length,
            enabled: enabledCharacterCount,
          })}
        </Typography>
        <ExpandMoreIcon sx={{ flexShrink: 0, fontSize: 16, color: 'text.secondary', transform: expandedPanels.character ? 'rotate(180deg)' : 'none' }} />
      </Button>
      <Tooltip title={t('painting.workspace.parameters.characterControlDescription')} arrow>
        <Box component="span" tabIndex={0} sx={{ display: 'inline-flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center', height: 20, lineHeight: 0, color: 'text.secondary', transform: 'translateY(-1px)' }}>
          <InfoIcon sx={{ display: 'block', fontSize: 15 }} />
        </Box>
      </Tooltip>
    </Box>
  ) : null;

  const content = visible ? (
    <Collapse in={Boolean(expandedPanels.character)}>
      <Box id={`${controlId}-content`} role="region" aria-labelledby={`${controlId}-toggle`} sx={{ pt: 0.5, pb: 1, maxHeight: 420, overflowY: 'auto', pr: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 0.75, mb: 1 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            onClick={handleAddCharacterTab}
            disabled={!isV5Model && enabledCharacterCount >= 6}
            sx={{ flexShrink: 0, px: 0.75, textTransform: 'none', whiteSpace: 'nowrap', minHeight: 34, fontSize: 13 }}
          >
            {t('painting.workspace.parameters.addCharacter')}
          </Button>

          <ToggleButtonGroup
            exclusive
            size="small"
            value={characterPositionMode}
            onChange={(_, nextMode) => {
              if (!nextMode) return;
              if (isV5Model) handleParamChange('characterPositionMode', nextMode);
              else handleParamChange('aiDecidePosition', nextMode === 'ai');
            }}
            aria-label={t('painting.workspace.parameters.characterPositionMode')}
            sx={{ ml: 'auto', minWidth: 0, maxWidth: '100%', '& .MuiToggleButton-root': { minWidth: 0, minHeight: 34, px: 0.75, py: 0.5, fontSize: 13 } }}
          >
            <ToggleButton value="ai" sx={{ flex: 1, textTransform: 'none', whiteSpace: 'nowrap' }}>
              <Typography component="span" noWrap sx={{ minWidth: 0, fontSize: 'inherit', fontWeight: 'inherit' }}>{t('painting.workspace.parameters.aiDecidesPosition')}</Typography>
            </ToggleButton>
            <ToggleButton
              value="custom"
              onClick={() => setPositionEditorOpen(true)}
              sx={{ flex: 1, gap: 0.75, textTransform: 'none', whiteSpace: 'nowrap' }}
            >
              <Typography component="span" noWrap sx={{ minWidth: 0, fontSize: 'inherit', fontWeight: 'inherit' }}>{t('painting.workspace.parameters.customPosition')}</Typography>
              <GridOnIcon fontSize="small" sx={{ flexShrink: 0 }} />
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {isV5Model && enabledCharacterCount > NOVELAI_V5_CHARACTER_WARNING_THRESHOLD && (
          <Alert severity="warning" sx={{ mb: 0.75 }}>
            {t('painting.workspace.errors.v5CharacterOverlapWarning')}
          </Alert>
        )}

        <Box>
          {characterTabs.length === 0 ? (
            <Box
              sx={{
                px: 2,
                py: 2,
                textAlign: 'center',
              }}
            >
              <Typography sx={{ fontSize: 14 }} color="text.secondary">
                {t('painting.workspace.parameters.noCharacters')}
              </Typography>
            </Box>
          ) : (
            characterTabs.map((tab, index) => (
              <CharacterControlTab
                key={index}
                index={index}
                data={tab}
                onDelete={() => handleDeleteCharacterTab(index)}
                onMoveUp={() => handleMoveUpCharacterTab(index)}
                onMoveDown={() => handleMoveDownCharacterTab(index)}
                onDataChange={handleCharacterDataChange}
                onOpenEditor={handleOpenCharacterEditor}
                onToggleDisabled={handleCharacterToggleDisabled}
                canMoveUp={index > 0}
                canMoveDown={index < characterTabs.length - 1}
                isV5Model={isV5Model}
                isV5Medium={params.model === 'nai-diffusion-5-full-medium'}
                characterPositionMode={characterPositionMode}
              />
            ))
          )}
        </Box>
      </Box>
    </Collapse>
  ) : null;

  return (
    <>
      {renderPromptPanel ? renderPromptPanel(summary, content) : <>{summary}{content}</>}
      {visible && (
        <CharacterPositionEditorDialog
          open={positionEditorOpen}
          onClose={() => setPositionEditorOpen(false)}
          characterTabs={characterTabs}
          onCharacterDataChange={handleCharacterDataChange}
          width={params.width}
          height={params.height}
          gridMode={!isV5Model}
        />
      )}
    </>
  );
};

export default CharacterControlPanel;
