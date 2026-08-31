"use client";

import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  IconButton,
  InputBase,
  InputAdornment,
  Paper,
  Stack,
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

const positionMapping = {
  row: { '1': 0.1, '2': 0.3, '3': 0.5, '4': 0.7, '5': 0.9 },
  col: { 'A': 0.1, 'B': 0.3, 'C': 0.5, 'D': 0.7, 'E': 0.9 },
};

const characterColors = [
  { light: 'rgba(233, 30, 99, 0.05)', main: '#D81B60' },
  { light: 'rgba(156, 39, 176, 0.05)', main: '#8E24AA' },
  { light: 'rgba(103, 58, 183, 0.05)', main: '#5E35B1' },
  { light: 'rgba(33, 150, 243, 0.05)', main: '#1E88E5' },
  { light: 'rgba(0, 150, 136, 0.05)', main: '#00897B' },
  { light: 'rgba(255, 152, 0, 0.05)', main: '#FB8C00' },
];

const compactTabSx = {
  minHeight: 30,
  px: 0.75,
  py: 0.5,
  fontSize: '0.75rem',
  minWidth: 0,
  textTransform: 'none',
};

const PositionSelector = ({ value, onChange }) => {
  const { t } = useI18n();
  const [position, setPosition] = useState(value || 'C3');

  useEffect(() => {
    setPosition(value || 'C3');
  }, [value]);

  const handlePositionChange = (nextPosition) => {
    setPosition(nextPosition);
    onChange(nextPosition);
  };

  const rows = ['1', '2', '3', '4', '5'];
  const cols = ['A', 'B', 'C', 'D', 'E'];

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
        <Typography variant="caption" color="text.secondary">
          {t('painting.workspace.parameters.characterPosition')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {position} · ({positionMapping.col[position.charAt(0)]}, {positionMapping.row[position.charAt(1)]})
        </Typography>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '16px repeat(5, 28px)',
          columnGap: 0.5,
          rowGap: 0.5,
          justifyContent: 'start',
          alignItems: 'center',
        }}
      >
        <Box />
        {cols.map((col) => (
          <Box key={col} sx={{ textAlign: 'center' }}>
            <Typography variant="caption" fontWeight={700}>{col}</Typography>
          </Box>
        ))}

        {rows.map((row) => (
          <React.Fragment key={row}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="caption" fontWeight={700}>{row}</Typography>
            </Box>
            {cols.map((col) => {
              const key = `${col}${row}`;
              const isSelected = position === key;

              return (
                <Box key={key}>
                  <Button
                    variant={isSelected ? 'contained' : 'outlined'}
                    size="small"
                    onClick={() => handlePositionChange(key)}
                    sx={{
                      width: 28,
                      minWidth: 28,
                      height: 28,
                      p: 0,
                      borderRadius: 0.875,
                      fontSize: '0.62rem',
                      lineHeight: 1,
                    }}
                  >
                    {key}
                  </Button>
                </Box>
              );
            })}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
};

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
  characterPositionMode,
}) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const cancelNameEditRef = useRef(false);
  const colorIndex = data.colorId !== undefined ? data.colorId % characterColors.length : index % characterColors.length;
  const color = characterColors[colorIndex];
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

  useEffect(() => {
    if (isV5Model && activeTab > 1) {
      setActiveTab(0);
    }
  }, [activeTab, isV5Model]);

  const renderTextFieldWithEditButton = (field, label, placeholder) => (
    <TextField
      fullWidth
      multiline
      rows={2}
      label={label}
      placeholder={placeholder}
      value={data[field] || ''}
      onChange={(event) => onDataChange(index, { ...data, [field]: event.target.value })}
      size="small"
      sx={{
        mt: 0.5,
        '& .MuiOutlinedInput-root': {
          pr: 4.5,
        },
        '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
          borderColor: color.main,
        },
        '& .MuiInputLabel-root.Mui-focused': {
          color: color.main,
        },
      }}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end" sx={{ position: 'absolute', right: 6, top: 6 }}>
            <Tooltip title={t('painting.workspace.parameters.expandEditor')}>
              <IconButton
                size="small"
                onClick={() => onOpenEditor(index, field, data[field] || '')}
                sx={{ p: 0.5 }}
              >
                <OpenInFullIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </InputAdornment>
        ),
      }}
    />
  );

  return (
    <Paper
      elevation={0}
      sx={{
        mb: 0.75,
        overflow: 'hidden',
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: isTemporarilyDisabled ? 'warning.light' : 'divider',
      }}
    >
      <Box
        sx={{
          px: 0.75,
          py: 0.625,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 0.75,
          bgcolor: color.light,
        }}
      >
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
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
                display: 'block',
                width: 'min(100%, 240px)',
                color: color.main,
                fontSize: '0.875rem',
                fontWeight: 500,
                lineHeight: 1.25,
                borderBottom: '1px solid',
                borderColor: color.main,
                '& input': { p: 0, height: 'auto' },
                '& input::placeholder': { color: color.main, opacity: 0.72 },
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
                  maxWidth: '100%',
                  p: 0,
                  border: 0,
                  bgcolor: 'transparent',
                  cursor: 'text',
                  color: color.main,
                  lineHeight: 1.25,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textAlign: 'left',
                  '&:hover': { textDecoration: 'underline' },
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: color.main,
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
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.125 }}>
              {characterPositionMode === 'custom'
                ? t('painting.workspace.parameters.normalizedCoordinates', {
                  x: normalizeNovelAICharacterCenter(data.center, data.position).x.toFixed(3),
                  y: normalizeNovelAICharacterCenter(data.center, data.position).y.toFixed(3),
                })
                : t('painting.workspace.parameters.aiDecidesPosition')}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.125 }}>
              {t('painting.workspace.parameters.positionValue', { position: data.position || 'C3' })}
            </Typography>
          )}
          {isTemporarilyDisabled && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.125 }}>
              {t('painting.workspace.parameters.temporarilyDisabled')}
            </Typography>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <IconButton aria-label={t('painting.workspace.parameters.moveCharacterUp')} size="small" onClick={onMoveUp} disabled={!canMoveUp} sx={{ p: 0.5 }}>
            <ArrowUpwardIcon fontSize="small" sx={{ color: color.main }} />
          </IconButton>
          <IconButton aria-label={t('painting.workspace.parameters.moveCharacterDown')} size="small" onClick={onMoveDown} disabled={!canMoveDown} sx={{ p: 0.5 }}>
            <ArrowDownwardIcon fontSize="small" sx={{ color: color.main }} />
          </IconButton>
          <TemporaryDisableButton
            isDisabled={isTemporarilyDisabled}
            onToggle={() => onToggleDisabled(index)}
            iconOnly
            sx={{ color: isTemporarilyDisabled ? 'warning.main' : color.main }}
          />
          <IconButton aria-label={t('painting.workspace.parameters.deleteCharacter')} size="small" onClick={onDelete} sx={{ p: 0.5 }}>
            <DeleteIcon fontSize="small" sx={{ color: color.main }} />
          </IconButton>
          <IconButton size="small" onClick={() => setExpanded((prev) => !prev)} sx={{ p: 0.5 }}>
            <ExpandMoreIcon
              fontSize="small"
              sx={{
                color: color.main,
                transform: expanded ? 'rotate(0deg)' : 'rotate(-180deg)',
                transition: 'transform 0.2s ease',
              }}
            />
          </IconButton>
        </Box>
      </Box>

      {expanded && (
        <Box sx={{ p: 1, pt: 0.75, opacity: isTemporarilyDisabled ? 0.74 : 1, transition: 'opacity 0.2s ease' }}>
          <Tabs
            value={activeTab}
            onChange={(_, newValue) => setActiveTab(newValue)}
            variant="fullWidth"
            sx={{
              mb: 0.5,
              minHeight: 30,
              '& .MuiTab-root': {
                ...compactTabSx,
                color: 'text.secondary',
              },
              '& .Mui-selected': { color: color.main },
              '& .MuiTabs-indicator': {
                backgroundColor: color.main,
                height: 2,
              },
            }}
          >
            <Tab disableRipple label={t('painting.workspace.parameters.characterPromptTab')} />
            <Tab disableRipple label={t('painting.workspace.parameters.characterAvoidTab')} />
            {!isV5Model && <Tab disableRipple label={t('painting.workspace.parameters.characterPositionTab')} />}
          </Tabs>

          {activeTab === 0 && renderTextFieldWithEditButton(
            'prompt',
            t('painting.workspace.parameters.characterDescription'),
            t('painting.workspace.parameters.characterDescriptionPlaceholder'),
          )}
          {activeTab === 1 && renderTextFieldWithEditButton(
            'uc',
            t('painting.workspace.parameters.avoidContent'),
            t('painting.workspace.parameters.avoidContentPlaceholder'),
          )}
          {!isV5Model && activeTab === 2 && (
            <PositionSelector
              value={data.position}
              onChange={(pos) => onDataChange(index, { ...data, position: pos })}
            />
          )}
        </Box>
      )}
    </Paper>
  );
};

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
}) => {
  const { t } = useI18n();
  const [positionEditorOpen, setPositionEditorOpen] = useState(false);
  const enabledCharacterCount = characterTabs.filter((tab) => tab.isTemporarilyDisabled !== true).length;
  const characterPositionMode = params.characterPositionMode === 'custom' ? 'custom' : 'ai';

  return (
    <Accordion
      expanded={expandedPanels.character}
      onChange={(_, isExpanded) => onExpandedPanelsChange('character', isExpanded)}
      disableGutters
      sx={{
        boxShadow: 'none',
        '&::before': { display: 'none' },
        mt: 1,
        borderRadius: 2,
        overflow: 'hidden',
        '&.Mui-expanded': { margin: '8px 0 0 0' },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{
          minHeight: 40,
          backgroundColor: expandedPanels.character ? 'action.hover' : 'transparent',
          '&.Mui-expanded': { minHeight: 40 },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <FaceIcon sx={{ mr: 1, color: 'text.secondary', opacity: 0.7 }} />
          <Typography variant="subtitle2" fontWeight="medium">{t('painting.workspace.parameters.characterControl')}</Typography>
        </Box>
      </AccordionSummary>

      <AccordionDetails sx={{ p: 1.25, pt: 0.75 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
          {t('painting.workspace.parameters.characterControlDescription')}
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} sx={{ mb: 0.75 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            onClick={handleAddCharacterTab}
            disabled={!isV5Model && enabledCharacterCount >= 6}
            sx={{ flexGrow: 1, textTransform: 'none', minHeight: 32 }}
          >
            {t('painting.workspace.parameters.addCharacter')}
          </Button>

          {isV5Model ? (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={characterPositionMode}
              onChange={(_, nextMode) => {
                if (!nextMode) return;
                handleParamChange('characterPositionMode', nextMode);
                if (nextMode === 'custom') setPositionEditorOpen(true);
              }}
              aria-label={t('painting.workspace.parameters.characterPositionMode')}
              sx={{ alignSelf: { xs: 'stretch', sm: 'stretch' } }}
            >
              <ToggleButton value="ai" sx={{ flex: 1, textTransform: 'none', whiteSpace: 'nowrap' }}>
                {t('painting.workspace.parameters.aiDecidesPosition')}
              </ToggleButton>
              <ToggleButton
                value="custom"
                onClick={() => setPositionEditorOpen(true)}
                sx={{ flex: 1, gap: 0.75, textTransform: 'none', whiteSpace: 'nowrap' }}
              >
                {t('painting.workspace.parameters.customPosition')}
                <GridOnIcon fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>
          ) : (
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                alignSelf: { xs: 'flex-start', sm: 'stretch' },
                gap: 0.25,
                pl: 0.25,
                pr: 0.75,
                borderRadius: 999,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: params.aiDecidePosition ? 'action.hover' : 'transparent',
              }}
            >
              <Checkbox
                checked={params.aiDecidePosition}
                onChange={(event) => handleParamChange('aiDecidePosition', event.target.checked)}
                size="small"
                sx={{ p: 0.5 }}
              />
              <Typography variant="caption">{t('painting.workspace.parameters.aiDecidesPosition')}</Typography>
              <Tooltip title={t('painting.workspace.parameters.aiDecidesPositionHelp')} arrow>
                <InfoIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
              </Tooltip>
            </Box>
          )}
        </Stack>

        {isV5Model && enabledCharacterCount > NOVELAI_V5_CHARACTER_WARNING_THRESHOLD && (
          <Alert severity="warning" sx={{ mb: 0.75 }}>
            {t('painting.workspace.errors.v5CharacterOverlapWarning')}
          </Alert>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
          {t('painting.workspace.parameters.characterCount', {
            configured: characterTabs.length,
            enabled: enabledCharacterCount,
          })}
        </Typography>

        <Box sx={{ maxHeight: 420, overflowY: 'auto', pr: 0.5 }}>
          {characterTabs.length === 0 ? (
            <Box
              sx={{
                border: '1px dashed',
                borderColor: 'divider',
                borderRadius: 1.5,
                px: 1.25,
                py: 1.5,
                textAlign: 'center',
              }}
            >
              <Typography variant="caption" color="text.secondary">
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
                characterPositionMode={characterPositionMode}
              />
            ))
          )}
        </Box>
      </AccordionDetails>

      {isV5Model && (
        <CharacterPositionEditorDialog
          open={positionEditorOpen}
          onClose={() => setPositionEditorOpen(false)}
          characterTabs={characterTabs}
          onCharacterDataChange={handleCharacterDataChange}
          width={params.width}
          height={params.height}
        />
      )}
    </Accordion>
  );
};

export default CharacterControlPanel;
