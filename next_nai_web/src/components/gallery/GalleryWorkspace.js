"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, ButtonBase, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, LinearProgress, Menu, MenuItem, Snackbar, Stack, TextField, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import { AddPhotoAlternateOutlined, CheckBoxOutlined, Close, CreateNewFolderOutlined, DeleteOutline, DescriptionOutlined, DriveFileMoveOutlined, ImageOutlined, PaletteOutlined, Refresh, RestoreFromTrashOutlined, Search } from '@mui/icons-material';
import apiClient from '@/utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';
import GalleryDetailDialog from './GalleryDetailDialog';
import GalleryMetadataDialog from './GalleryMetadataDialog';

const PAGE_SIZE = 60;

/**
 * 参考图库与生成目录共用分页瀑布流，文件操作由本地后端完成。
 * @param {object} props source 为 references 或 outputs；分组只整理索引，不移动原图。
 * @returns {React.ReactElement} 图片浏览、分组、批量操作和详情工作区。
 */
export default function GalleryWorkspace({ source = 'references' }) {
  const { t } = useI18n();
  const theme = useTheme();
  const tablet = useMediaQuery(theme.breakpoints.up('sm'));
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const wide = useMediaQuery(theme.breakpoints.up('xl'));
  const columns = wide ? 5 : desktop ? 4 : tablet ? 3 : 2;
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [groups, setGroups] = useState([]);
  const [group, setGroup] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [trash, setTrash] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [detailId, setDetailId] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [groupMenu, setGroupMenu] = useState(null);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [trashIds, setTrashIds] = useState(null);
  const [metadataTarget, setMetadataTarget] = useState(null);
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const moreRef = useRef(null);
  const requestVersionRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (source !== 'outputs') return undefined;
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('novelai:gallery-updated', refresh);
    return () => window.removeEventListener('novelai:gallery-updated', refresh);
  }, [source]);

  useEffect(() => {
    const version = ++requestVersionRef.current;
    setLoading(true);
    setLoadingMore(false);
    setLoadMoreFailed(false);
    loadingMoreRef.current = false;
    setItems([]);
    setHasMore(false);
    setSelected(new Set());
    Promise.all([
      apiClient.getGallery({ source, offset: 0, limit: PAGE_SIZE, group, q: search, trash }),
      apiClient.getGalleryGroups(source),
    ]).then(([result, groupResult]) => {
      if (requestVersionRef.current !== version) return;
      setItems(result.items);
      setTotal(result.total);
      setHasMore(result.has_more);
      setGroups(groupResult.groups);
      if (result.errors?.length) setError(t('gallery.scanErrors', { count: result.errors.length }));
    }).catch((requestError) => {
      if (requestVersionRef.current === version) setError(requestError.data?.error || requestError.message);
    }).finally(() => { if (requestVersionRef.current === version) setLoading(false); });
    return () => { requestVersionRef.current += 1; };
  }, [source, group, search, trash, revision, t]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMoreRef.current || !hasMore) return;
    const version = requestVersionRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const result = await apiClient.getGallery({ source, offset: items.length, limit: PAGE_SIZE, group, q: search, trash });
      if (version !== requestVersionRef.current) return;
      setItems((current) => [...current, ...result.items]);
      setTotal(result.total);
      setHasMore(result.has_more);
    } catch (requestError) {
      if (version === requestVersionRef.current) {
        setError(requestError.data?.error || requestError.message);
        // 同一页请求失败后保留手动重试，避免滚动观察器连续重复失败请求。
        setLoadMoreFailed(true);
      }
    }
    finally {
      if (version === requestVersionRef.current) { setLoadingMore(false); loadingMoreRef.current = false; }
    }
  }, [group, hasMore, items.length, loading, search, source, trash]);

  useEffect(() => {
    if (!hasMore || loading || loadingMore || loadMoreFailed || !moreRef.current) return undefined;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void loadMore(); }, { root: scrollRef.current, rootMargin: '300px' });
    observer.observe(moreRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loadMoreFailed, loading, loadingMore]);

  const importImages = async (files) => {
    if (!files.length || busy) return;
    setBusy(true);
    setError('');
    const result = { items: [], errors: [] };
    try {
      // 每批至多 30 张、约 60 MiB，为后端 80 MiB 请求限制预留表单空间。
      for (let offset = 0; offset < files.length;) {
        const body = new FormData();
        let batchSize = 0;
        let batchCount = 0;
        while (offset < files.length && batchCount < 30) {
          const file = files[offset];
          if (batchCount > 0 && batchSize + file.size > 60 * 1024 * 1024) break;
          body.append('files', file);
          batchSize += file.size;
          batchCount += 1;
          offset += 1;
        }
        if (group && group !== '__ungrouped') body.append('group_id', group);
        const page = await apiClient.importGalleryImages(body);
        result.items.push(...page.items);
        result.errors.push(...page.errors);
      }
      const count = result.items.length;
      setNotice(t('gallery.imported', { count }));
      if (result.errors.length) setError(t('gallery.operationErrors', { count: result.errors.length }) + '\n' + result.errors.map((item) => item.error).join('\n'));
    } catch (requestError) { setError(requestError.data?.error || requestError.message); }
    finally { if (result.items.length) setRevision((value) => value + 1); setBusy(false); }
  };

  const toggleSelected = (id) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const batch = async (action, ids, options = {}) => {
    setBusy(true);
    setError('');
    const result = { items: [], succeeded: [], errors: [] };
    try {
      for (let offset = 0; offset < ids.length; offset += 200) {
        const page = await apiClient.batchGallery({ source, ids: ids.slice(offset, offset + 200), action, ...options });
        result.items.push(...page.items);
        result.succeeded.push(...page.succeeded);
        result.errors.push(...page.errors);
      }
      if (result.errors.length) setError(t('gallery.operationErrors', { count: result.errors.length }) + '\n' + result.errors.map((item) => item.error).join('\n'));
      const message = action === 'export' ? 'gallery.copiesSaved' : action === 'trash' ? 'gallery.trashed' : action === 'restore' ? 'gallery.restored' : 'gallery.moved';
      setNotice(t(message, { count: result.succeeded.length }));
      if ((action === 'trash' || action === 'restore') && result.succeeded.includes(detailId)) setDetailId(null);
      return result;
    } catch (requestError) { setError(requestError.data?.error || requestError.message); return null; }
    finally { if (result.succeeded.length) setRevision((value) => value + 1); setBusy(false); }
  };

  const apply = (entry, mode) => {
    try {
      if (mode === 'style') {
        window.localStorage.setItem('novelai:pending-artist-prompt', entry.style_prompt);
        window.dispatchEvent(new CustomEvent('novelai:artist-prompt', { detail: entry.style_prompt }));
      } else {
        const parameters = { ...(mode === 'parameters' ? { ...entry.parameters, characterTabs: entry.parameters.characterTabs || [] } : {}), positivePrompt: entry.prompt || '', negativePrompt: entry.negative_prompt || '' };
        window.localStorage.setItem('novelai:pending-reference-parameters', JSON.stringify(parameters));
        window.dispatchEvent(new CustomEvent('novelai:reference-parameters', { detail: parameters }));
      }
      setDetailId(null);
      window.dispatchEvent(new CustomEvent('novelai:open-page', { detail: 'ai-painting' }));
    } catch { setError(t('gallery.applyFailed')); }
  };

  const createGroup = async () => {
    setBusy(true);
    setError('');
    try {
      await apiClient.createGalleryGroup({ source, name: newGroupName.trim() });
      setNewGroupOpen(false);
      setNewGroupName('');
      setRevision((value) => value + 1);
      setNotice(t('gallery.groupCreated'));
    } catch (requestError) { setError(requestError.data?.error || requestError.message); }
    finally { setBusy(false); }
  };

  const detailIndex = items.findIndex((item) => item.id === detailId);
  const selectedIds = [...selected];
  const actionButtonSx = { minHeight: 34, px: 1.25, whiteSpace: 'nowrap', '& .MuiButton-startIcon': { mr: 0.5 }, '& .MuiButton-startIcon .MuiSvgIcon-root': { fontSize: 18 } };

  return <Box ref={scrollRef} sx={{ height: '100%', minHeight: 0, overflowY: 'auto', p: { xs: 1, md: 2 }, position: 'relative' }}
    onDragEnter={(event) => {
      if (source !== 'references' || trash || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault(); dragDepthRef.current += 1; setDragging(true);
    }}
    onDragOver={(event) => { if (source === 'references' && !trash && event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDragLeave={() => { dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (!dragDepthRef.current) setDragging(false); }}
    onDrop={(event) => {
      if (source !== 'references' || trash) return;
      event.preventDefault(); dragDepthRef.current = 0; setDragging(false); void importImages(Array.from(event.dataTransfer.files));
    }}>
    <Stack spacing={1.5} sx={{ mb: 2 }}>
      <Box><Typography variant="h5" sx={{ fontSize: { xs: 21, md: 24 } }}>{t(source === 'references' ? 'gallery.referencesTitle' : 'gallery.outputsTitle')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{t(source === 'references' ? 'gallery.referencesHint' : 'gallery.outputsHint')}</Typography></Box>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <TextField size="small" value={query} placeholder={t('gallery.search')} onChange={(event) => setQuery(event.target.value)}
          inputProps={{ 'aria-label': t('gallery.search') }} sx={{ flex: '1 1 230px', maxWidth: { sm: 400 }, minWidth: 0, '& .MuiInputBase-root': { height: 36 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 19 }} /></InputAdornment> }} />
        <TextField select size="small" value={group} onChange={(event) => setGroup(event.target.value)}
          SelectProps={{ displayEmpty: true, inputProps: { 'aria-label': t('gallery.group') } }}
          sx={{ flex: { xs: '1 1 145px', sm: '0 1 190px' }, minWidth: 130, '& .MuiInputBase-root': { height: 36 } }}>
          <MenuItem value="">{t('gallery.allGroups')}</MenuItem><MenuItem value="__ungrouped">{t('gallery.ungrouped')}</MenuItem>
          {groups.map((item) => <MenuItem key={item.id} value={item.id}>{item.name} ({item.count})</MenuItem>)}
        </TextField>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, ml: { md: 'auto' } }}>
          {source === 'references' && !trash && <Button size="small" variant="contained" sx={actionButtonSx} startIcon={<AddPhotoAlternateOutlined />} disabled={busy} onClick={() => fileInputRef.current.click()}>{t('gallery.import')}</Button>}
          <Tooltip title={t('gallery.newGroup')}><IconButton size="small" aria-label={t('gallery.newGroup')} disabled={busy || trash} onClick={() => { setError(''); setNewGroupOpen(true); }}><CreateNewFolderOutlined fontSize="small" /></IconButton></Tooltip>
          <Button size="small" sx={actionButtonSx} variant={selecting ? 'outlined' : 'text'} startIcon={selecting ? <Close /> : <CheckBoxOutlined />} onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>{t(selecting ? 'gallery.doneSelecting' : 'gallery.select')}</Button>
          <Tooltip title={t('gallery.refresh')}><IconButton size="small" aria-label={t('gallery.refresh')} disabled={loading || busy} onClick={() => { setError(''); setRevision((value) => value + 1); }}><Refresh fontSize="small" /></IconButton></Tooltip>
          <Tooltip title={t(trash ? 'gallery.returnToGallery' : 'gallery.recycleBin')}><IconButton size="small" aria-label={t(trash ? 'gallery.returnToGallery' : 'gallery.recycleBin')} color={trash ? 'primary' : 'default'} onClick={() => { setTrash(!trash); setError(''); }}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
        </Box>
      </Box>
      {trash && <Alert severity="info">{t('gallery.trashHint')}</Alert>}
      {selecting && <Stack direction="row" flexWrap="wrap" alignItems="center" gap={0.75} sx={{ px: 1, py: 0.5, bgcolor: 'action.hover', borderRadius: 1 }}>
        <Checkbox size="small" checked={items.length > 0 && selected.size === items.length} indeterminate={selected.size > 0 && selected.size < items.length}
          inputProps={{ 'aria-label': t('gallery.selectLoaded') }} onChange={(_, checked) => setSelected(new Set(checked ? items.map((item) => item.id) : []))} />
        <Typography variant="body2" sx={{ mr: 'auto' }}>{t('gallery.selectedCount', { count: selected.size })}</Typography>
        {trash ? <Button size="small" sx={actionButtonSx} startIcon={<RestoreFromTrashOutlined />} disabled={!selected.size || busy} onClick={() => batch('restore', selectedIds)}>{t('gallery.restore')}</Button> : <>
          <Button size="small" sx={actionButtonSx} startIcon={<DriveFileMoveOutlined />} disabled={!selected.size || busy} onClick={(event) => setGroupMenu(event.currentTarget)}>{t('gallery.moveGroup')}</Button>
          <Button size="small" sx={actionButtonSx} startIcon={<DescriptionOutlined />} disabled={!selected.size || busy} onClick={() => { setError(''); setMetadataTarget({ ids: selectedIds, parameters: {} }); }}>{t('gallery.metadata')}</Button>
          <Button size="small" sx={actionButtonSx} color="error" startIcon={<DeleteOutline />} disabled={!selected.size || busy} onClick={() => { setError(''); setTrashIds(selectedIds); }}>{t('gallery.trash')}</Button>
        </>}
      </Stack>}
      {error && !newGroupOpen && !metadataTarget && !trashIds && <Alert severity="error" onClose={() => setError('')} sx={{ whiteSpace: 'pre-wrap' }}>{error}</Alert>}
      {busy && <LinearProgress />}
    </Stack>
    <input hidden ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/bmp" multiple onChange={(event) => { void importImages(Array.from(event.target.files)); event.target.value = ''; }} />
    {loading ? <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 260 }}><CircularProgress size={28} /></Box> : <>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{t('gallery.imageCount', { count: total })}</Typography>
      {!items.length ? <Box sx={{ minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', border: '1px dashed', borderColor: 'divider', borderRadius: 2, px: 3, textAlign: 'center' }}>
        <ImageOutlined sx={{ color: 'text.disabled', fontSize: 38, mb: 1 }} /><Typography color="text.secondary">{t(trash ? 'gallery.emptyTrash' : source === 'references' ? 'gallery.emptyReferences' : 'gallery.emptyOutputs')}</Typography>
      </Box> : <Box aria-label={t('gallery.waterfall')} sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: { xs: 1, md: 1.5 }, alignItems: 'start' }}>
        {Array.from({ length: columns }, (_, column) => <Stack key={column} spacing={{ xs: 1, md: 1.5 }} sx={{ minWidth: 0 }}>
          {items.filter((_, index) => index % columns === column).map((item) => {
            const title = item.title || item.filename || t('gallery.untitled');
            return <Box key={item.id} sx={{ position: 'relative', minWidth: 0, borderRadius: 1.5, overflow: 'hidden', bgcolor: 'background.paper', outline: selected.has(item.id) ? '2px solid' : '1px solid', outlineColor: selected.has(item.id) ? 'primary.main' : 'divider' }}>
              <ButtonBase aria-label={t(selecting ? 'gallery.selectImage' : 'gallery.viewImage', { title })} onClick={() => { if (selecting) toggleSelected(item.id); else { setError(''); setDetailId(item.id); } }}
                sx={{ display: 'block', width: '100%', textAlign: 'left', '&.Mui-focusVisible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: -3 } }}>
                {item.thumbnail_url ? <Box component="img" src={item.thumbnail_url} alt={title} loading="lazy" decoding="async"
                  sx={{ display: 'block', width: '100%', height: 'auto', aspectRatio: item.width && item.height ? `${item.width} / ${item.height}` : undefined, objectFit: 'cover', bgcolor: 'action.hover' }} /> : <Box sx={{ height: 150, display: 'grid', placeItems: 'center', bgcolor: 'action.hover' }}><ImageOutlined color="disabled" /></Box>}
                <Box sx={{ px: 1, py: 0.75 }}><Typography variant="body2" noWrap sx={{ fontSize: 12, fontWeight: 500 }}>{title}</Typography>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" gap={0.5}><Typography variant="caption" color="text.secondary">{item.width && item.height ? `${item.width} × ${item.height}` : ''}</Typography>{item.style_prompt && <PaletteOutlined sx={{ fontSize: 14, color: 'primary.main' }} />}</Stack></Box>
              </ButtonBase>
              {selecting && <Checkbox size="small" checked={selected.has(item.id)} onChange={() => toggleSelected(item.id)} inputProps={{ 'aria-label': t('gallery.selectImage', { title }) }} sx={{ position: 'absolute', top: 4, left: 4, p: 0.25, bgcolor: 'background.paper', borderRadius: 0.75, '&:hover': { bgcolor: 'background.paper' } }} />}
            </Box>;
          })}
        </Stack>)}
      </Box>}
      {hasMore && <Box ref={moreRef} sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><Button size="small" disabled={loadingMore} onClick={loadMore} startIcon={loadingMore ? <CircularProgress size={15} /> : null}>{t(loadingMore ? 'gallery.loading' : 'gallery.loadMore')}</Button></Box>}
    </>}
    {dragging && <Box sx={{ position: 'sticky', bottom: 12, p: 4, textAlign: 'center', bgcolor: 'background.paper', border: '2px dashed', borderColor: 'primary.main', borderRadius: 2, pointerEvents: 'none', boxShadow: 3, zIndex: 10 }}><Typography color="primary">{t('gallery.dropImages')}</Typography></Box>}
    <Menu anchorEl={groupMenu} open={Boolean(groupMenu)} onClose={() => setGroupMenu(null)}>
      <MenuItem onClick={() => { setGroupMenu(null); void batch('group', selectedIds, { group_id: '' }); }}>{t('gallery.ungrouped')}</MenuItem>
      {groups.map((item) => <MenuItem key={item.id} onClick={() => { setGroupMenu(null); void batch('group', selectedIds, { group_id: item.id }); }}>{item.name}</MenuItem>)}
    </Menu>
    <Dialog open={newGroupOpen} onClose={() => !busy && setNewGroupOpen(false)} fullWidth maxWidth="xs"><DialogTitle>{t('gallery.newGroup')}</DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>{error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}<TextField autoFocus fullWidth size="small" label={t('gallery.groupName')} value={newGroupName} inputProps={{ maxLength: 100 }} onChange={(event) => setNewGroupName(event.target.value)} />
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>{t('gallery.virtualGroupHint')}</Typography></DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setNewGroupOpen(false)}>{t('gallery.cancel')}</Button><Button variant="contained" disabled={busy || !newGroupName.trim()} onClick={createGroup}>{t('gallery.create')}</Button></DialogActions></Dialog>
    <Dialog open={Boolean(trashIds)} onClose={() => !busy && setTrashIds(null)} fullWidth maxWidth="xs"><DialogTitle>{t('gallery.trashConfirm', { count: trashIds?.length || 0 })}</DialogTitle>
      <DialogContent>{error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}<Typography variant="body2">{t('gallery.trashConfirmHint')}</Typography></DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setTrashIds(null)}>{t('gallery.cancel')}</Button><Button variant="contained" color="error" disabled={busy} onClick={async () => { const result = await batch('trash', trashIds); if (result) setTrashIds(null); }}>{t('gallery.trash')}</Button></DialogActions></Dialog>
    {detailId && <GalleryDetailDialog key={detailId} entryId={detailId} groups={groups} operationError={error} operationBusy={busy} onClose={() => setDetailId(null)} onChanged={() => setRevision((value) => value + 1)}
      onApply={apply} onTrash={(entry) => { setError(''); setTrashIds([entry.id]); }} onRestore={(entry) => batch('restore', [entry.id])}
      onMetadata={(entry) => { setError(''); setMetadataTarget({ ids: [entry.id], parameters: { ...entry.parameters, positivePrompt: entry.prompt || '', negativePrompt: entry.negative_prompt || '' }, document: entry.metadata_document, sharedPaths: entry.metadata_shared_paths }); }}
      onPrevious={detailIndex > 0 ? () => setDetailId(items[detailIndex - 1].id) : null}
      onNext={detailIndex >= 0 && detailIndex < items.length - 1 ? () => setDetailId(items[detailIndex + 1].id) : null} />}
    {metadataTarget && <GalleryMetadataDialog count={metadataTarget.ids.length} initialParameters={metadataTarget.parameters} initialDocument={metadataTarget.document} metadataSharedPaths={metadataTarget.sharedPaths} busy={busy} error={error} onClose={() => setMetadataTarget(null)}
      onSubmit={async (options) => { const result = await batch('export', metadataTarget.ids, options); if (result && !result.errors.length) setMetadataTarget(null); else if (result) setMetadataTarget({ ...metadataTarget, ids: result.errors.map((item) => item.id) }); }} />}
    <Snackbar open={Boolean(notice)} autoHideDuration={3500} onClose={() => setNotice('')} message={notice} />
  </Box>;
}
