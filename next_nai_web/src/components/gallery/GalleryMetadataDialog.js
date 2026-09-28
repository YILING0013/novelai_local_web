"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemIcon, ListItemText, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { ArrowUpward, FolderOpenOutlined, ImageOutlined } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';
import apiClient from '@/utils/ApiClient';
import GalleryMetadataFields, { getParameterSharedPaths } from './GalleryMetadataFields';

const basicFields = ['model', 'seed', 'steps', 'guidanceScale', 'sampler', 'width', 'height'];

/**
 * 用统一提示词、角色和递归字段编辑图片元数据，另存到指定目录并保留原图。
 * @param {object} props 图片参数与元数据树；批量可仅覆盖改动项，也可选一张图片作为完整模板。
 * @returns {React.ReactElement} 可视化元数据另存表单。
 */
export default function GalleryMetadataDialog({ count, initialParameters = {}, initialDocument, metadataSharedPaths = [], templateEntries = [], onClose, onSubmit, busy, error }) {
  const { t } = useI18n();
  const [mode, setMode] = useState('edit');
  const [parameters, setParameters] = useState(initialParameters);
  const [changes, setChanges] = useState({});
  const [document, setDocument] = useState(initialDocument);
  const [documentChanged, setDocumentChanged] = useState(false);
  const [sharedPaths, setSharedPaths] = useState(metadataSharedPaths);
  const [templateId, setTemplateId] = useState('');
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [templateOriginalDocument, setTemplateOriginalDocument] = useState(null);
  const templateRequest = useRef(0);
  const [outputDirectory, setOutputDirectory] = useState('');
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryListing, setDirectoryListing] = useState(null);
  const [directoryPath, setDirectoryPath] = useState('');
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const formBusy = busy || templateLoading;
  const hiddenParameters = [...getParameterSharedPaths(parameters), ...basicFields.map((key) => [key])];
  const cardSx = { p: { xs: 1.5, sm: 2 }, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' };

  const changeParameters = (next, path) => {
    setParameters(next);
    setChanges((current) => ({ ...current, [path[0]]: next[path[0]] }));
  };

  const browseDirectory = useCallback(async (path, initialize = false) => {
    setDirectoryLoading(true); setDirectoryError('');
    try {
      const result = await apiClient.getLocalDirectories(path);
      setDirectoryListing(result); setDirectoryPath(result.path);
      if (initialize) setOutputDirectory((current) => current || result.suggested_export_directory);
    } catch (requestError) { setDirectoryError(requestError.data?.error || requestError.message); }
    finally { setDirectoryLoading(false); }
  }, []);

  useEffect(() => { void browseDirectory('', true); }, [browseDirectory]);

  const selectTemplate = async (id) => {
    const request = ++templateRequest.current;
    setTemplateId(id); setTemplateError(''); setChanges({}); setDocumentChanged(false);
    if (!id) {
      setParameters(initialParameters); setDocument(initialDocument); setSharedPaths(metadataSharedPaths); setTemplateOriginalDocument(null); setTemplateLoading(false);
      return;
    }
    setTemplateLoading(true);
    try {
      const entry = await apiClient.getGalleryEntry(id);
      if (templateRequest.current !== request) return;
      const templateParameters = { ...entry.parameters, positivePrompt: entry.prompt || '', negativePrompt: entry.negative_prompt || '' };
      const templateDocument = structuredClone(entry.metadata_document);
      const bindings = entry.metadata_bindings || [];
      const paths = [...(entry.metadata_shared_paths || [])];
      // 先把图库中的提示词修改写进模板已有位置；随后只提交用户改动，删除字段不会被旧默认值补回。
      for (const binding of bindings) {
        const value = binding.parameter_path.reduce((node, key) => node?.[key], templateParameters);
        if (value === undefined) continue;
        const parent = binding.path.slice(0, -1).reduce((node, key) => node[key], templateDocument);
        parent[binding.path.at(-1)] = structuredClone(value);
      }
      for (const field of ['positivePrompt', 'negativePrompt']) {
        if (!templateParameters[field] || bindings.some((binding) => binding.parameter_path.length === 1 && binding.parameter_path[0] === field)) continue;
        const png = templateDocument.png ||= {};
        if (png.Comment === undefined) png.Comment = {};
        const useComment = png.Comment && typeof png.Comment === 'object' && !Array.isArray(png.Comment);
        const target = useComment ? png.Comment : png;
        target[field] = templateParameters[field];
        paths.push(useComment ? ['png', 'Comment', field] : ['png', field]);
      }
      setParameters(templateParameters); setDocument(templateDocument); setTemplateOriginalDocument(structuredClone(templateDocument)); setSharedPaths(paths);
    } catch (requestError) { if (templateRequest.current === request) setTemplateError(requestError.data?.error || requestError.message); }
    finally { if (templateRequest.current === request) setTemplateLoading(false); }
  };

  const submit = () => {
    const payload = { mode, output_directory: outputDirectory.trim() };
    if (mode === 'edit') {
      payload.parameters = changes;
      if (templateId) {
        payload.template_metadata_document = document;
        // 编辑前快照让后端区分“删除整个容器”和“缺少字段需要补写”。
        if (documentChanged) payload.template_original_document = templateOriginalDocument;
      } else if (documentChanged) payload.metadata_document = document;
    }
    onSubmit(payload);
  };

  return <Dialog open onClose={() => !busy && onClose()} maxWidth="md" fullWidth>
    <DialogTitle>{t('gallery.metadataTitle', { count })}</DialogTitle>
    <DialogContent sx={{ pt: '8px !important', px: { xs: 1.5, sm: 3 }, bgcolor: 'background.default' }}>
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        <Typography variant="body2" color="text.secondary">{t('gallery.metadataCopyHint')}</Typography>
        <Box sx={cardSx}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
            <TextField fullWidth size="small" label={t('gallery.outputDirectory')} value={outputDirectory} disabled={busy} onChange={(event) => setOutputDirectory(event.target.value)} helperText={t('gallery.outputDirectoryHint')} />
            <Button variant="outlined" size="small" startIcon={<FolderOpenOutlined />} disabled={busy || directoryLoading} sx={{ height: 40, flexShrink: 0 }} onClick={() => { setDirectoryOpen(true); void browseDirectory(outputDirectory.trim() === directoryListing?.suggested_export_directory ? '' : outputDirectory.trim()); }}>{t('gallery.browseDirectory')}</Button>
          </Stack>
          {directoryError && !directoryOpen && <Alert severity="error" sx={{ mt: 1 }}>{directoryError}</Alert>}
        </Box>
        <ToggleButtonGroup exclusive value={mode} size="small" onChange={(_, next) => next && setMode(next)} aria-label={t('gallery.metadataAction')} disabled={formBusy}>
          <ToggleButton value="edit">{t('gallery.editMetadata')}</ToggleButton>
          <ToggleButton value="strip">{t('gallery.clearMetadata')}</ToggleButton>
        </ToggleButtonGroup>
        {mode === 'strip' ? <Alert severity="info">{t('gallery.clearMetadataHint')}</Alert> : <>
          {(count > 1 || templateEntries.length > 0) && <Box sx={cardSx}>
            <TextField select fullWidth size="small" label={t('gallery.batchTemplate')} value={templateId} disabled={busy} onChange={(event) => void selectTemplate(event.target.value)} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}>
              <MenuItem value="">{t('gallery.noTemplate')}</MenuItem>
              {templateEntries.map((entry) => <MenuItem key={entry.id} value={entry.id}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  {entry.thumbnail_url ? <Box component="img" src={entry.thumbnail_url} alt="" sx={{ width: 30, height: 30, borderRadius: 0.5, objectFit: 'cover', flexShrink: 0 }} /> : <ImageOutlined sx={{ width: 30, color: 'text.secondary' }} />}
                  <Typography variant="body2" noWrap>{entry.title || entry.filename || t('gallery.untitled')}</Typography>
                </Stack>
              </MenuItem>)}
            </TextField>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{t(templateId ? 'gallery.templateHint' : 'gallery.batchMetadataHint')}</Typography>
            {templateLoading && <CircularProgress size={20} sx={{ mt: 1 }} />}
            {templateError && <Alert severity="error" sx={{ mt: 1 }}>{templateError}</Alert>}
          </Box>}
          <Box sx={cardSx}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('gallery.mainPrompts')}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>{t('gallery.sharedPromptHint')}</Typography>
            <Stack spacing={2}>{['positivePrompt', 'negativePrompt'].map((field) => <TextField key={field} size="small" multiline minRows={3} maxRows={12}
              label={t(`gallery.${field}`)} value={parameters[field] ?? ''} disabled={formBusy}
              onChange={(event) => changeParameters({ ...parameters, [field]: event.target.value }, [field])} />)}</Stack>
          </Box>
          <Box sx={cardSx}>
            <Typography variant="subtitle2" sx={{ mb: 2 }}>{t('gallery.generationParameters')}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
              {basicFields.map((field) => <TextField key={field} size="small" label={t(`gallery.${field}`)} value={parameters[field] ?? ''} disabled={formBusy}
                type={['model', 'sampler'].includes(field) ? 'text' : 'number'} inputProps={{ step: 'any' }} sx={field === 'model' ? { gridColumn: '1 / -1' } : undefined}
                onChange={(event) => changeParameters({ ...parameters, [field]: ['model', 'sampler'].includes(field) || event.target.value === '' ? event.target.value : Number(event.target.value) }, [field])} />)}
            </Box>
          </Box>
          {parameters.characterTabs?.length > 0 && <Box sx={cardSx}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('gallery.characterPrompts')}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>{t('gallery.characterPromptHint')}</Typography>
            <GalleryMetadataFields value={{ characterTabs: parameters.characterTabs }} disabled={formBusy} allowStructure={false}
              onChange={(next, path) => changeParameters({ ...parameters, ...next }, path)} />
          </Box>}
          <Box sx={cardSx}>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>{t('gallery.otherParameters')}</Typography>
            <GalleryMetadataFields value={parameters} hiddenPaths={hiddenParameters} disabled={formBusy} allowStructure={count > 1} onChange={changeParameters} />
          </Box>
          {document && (count === 1 || templateId) && <Box sx={cardSx}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('gallery.originalMetadata')}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>{t('gallery.metadataTreeHint')}</Typography>
            <GalleryMetadataFields value={document} hiddenPaths={sharedPaths} disabled={formBusy} onChange={(next) => { setDocument(next); setDocumentChanged(true); }} />
          </Box>}
        </>}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ px: { xs: 1.5, sm: 3 }, py: 2, borderTop: 1, borderColor: 'divider' }}>
      <Button onClick={onClose} disabled={busy}>{t('gallery.cancel')}</Button>
      <Button variant="contained" onClick={submit} disabled={formBusy || !outputDirectory.trim() || Boolean(templateError)}>{t(busy ? 'gallery.saving' : 'gallery.saveCopy')}</Button>
    </DialogActions>
    <Dialog open={directoryOpen} onClose={() => setDirectoryOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle>{t('gallery.browseDirectory')}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
            <TextField fullWidth size="small" label={t('gallery.directoryPath')} value={directoryPath} disabled={directoryLoading} onChange={(event) => setDirectoryPath(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void browseDirectory(directoryPath); } }} />
            <Button size="small" disabled={directoryLoading} onClick={() => void browseDirectory(directoryPath)}>{t('gallery.openDirectory')}</Button>
          </Stack>
          <Stack direction="row" flexWrap="wrap" gap={0.75}>
            <Button size="small" startIcon={<ArrowUpward />} disabled={directoryLoading || !directoryListing?.parent} onClick={() => void browseDirectory(directoryListing.parent)}>{t('gallery.parentDirectory')}</Button>
            {directoryListing?.roots.map((root) => <Button key={root.path} size="small" variant="outlined" disabled={directoryLoading} onClick={() => void browseDirectory(root.path)}>{root.name}</Button>)}
          </Stack>
          {directoryError && <Alert severity="error">{directoryError}</Alert>}
          {directoryLoading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}><CircularProgress size={24} /></Box> : <List dense sx={{ minHeight: 180, maxHeight: 320, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
            {directoryListing?.directories.map((directory) => <ListItemButton key={directory.path} onClick={() => void browseDirectory(directory.path)}><ListItemIcon sx={{ minWidth: 32 }}><FolderOpenOutlined fontSize="small" /></ListItemIcon><ListItemText primary={directory.name} primaryTypographyProps={{ noWrap: true }} /></ListItemButton>)}
            {!directoryListing?.directories.length && <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>{t('gallery.noSubdirectories')}</Typography>}
          </List>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={() => setDirectoryOpen(false)}>{t('gallery.cancel')}</Button><Button variant="contained" disabled={directoryLoading || !directoryListing || directoryPath !== directoryListing.path || Boolean(directoryError)} onClick={() => { setOutputDirectory(directoryListing.path); setDirectoryOpen(false); }}>{t('gallery.useDirectory')}</Button></DialogActions>
    </Dialog>
  </Dialog>;
}
