"use client";

import { useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, ListItemIcon, ListItemText, Menu, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { CheckBoxOutlined, Code, ExpandMore, FileUploadOutlined, ImageSearch, UploadFile } from '@mui/icons-material';
import GalleryMetadataFields from '@/components/gallery/GalleryMetadataFields';
import { readGalleryImageMetadata } from '@/components/gallery/galleryImages';
import { useI18n } from '@/i18n/I18nProvider';
import { tryParseJsonObject } from './tools/ImageTools/metadataParserCore';
import { isCustomMetadataKey, parseCustomImageMetadata } from './tools/ImageTools/previewImageExport';

const expandTextFields = (fields) => Object.fromEntries(Object.entries(fields).map(([name, value]) => [
  name, tryParseJsonObject(value, true) ?? value,
]));

// 对数组项按删除前的下标一次处理，避免前一项删除后影响剩余选项。
const removeSelectedFields = (value, paths) => {
  const isArray = Array.isArray(value);
  const kept = Object.entries(value).flatMap(([key, field]) => {
    const matching = paths.filter(([name]) => name === (isArray ? Number(key) : key));
    if (matching.some((path) => path.length === 1)) return [];
    return [[key, matching.length ? removeSelectedFields(field, matching.map((path) => path.slice(1))) : field]];
  });
  return isArray ? kept.map(([, field]) => field) : Object.fromEntries(kept);
};

/**
 * 用图库字段树编辑用于导出的元数据，保存时仅提交编辑后的字段。
 * @param {object} props 已保存的 JSON、保存回调以及可选的当前图片读取回调。
 * @returns {React.ReactElement} 对话框中的编辑表单。
 */
export default function CustomImageMetadataEditor({ initialValue, onSave, onCancel, getCurrentImage }) {
  const { t } = useI18n();
  const fileInput = useRef(null);
  const [initialFields] = useState(() => parseCustomImageMetadata(initialValue));
  const [fields, setFields] = useState(() => expandTextFields(initialFields ?? {}));
  const [importAnchor, setImportAnchor] = useState(null);
  const [selectedPaths, setSelectedPaths] = useState(null);
  const [jsonText, setJsonText] = useState(initialFields ? null : initialValue);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(initialFields ? null : { type: 'error', key: 'invalidCustomMetadata' });
  const label = (key) => t(`painting.workspace.gallery.${key}`);
  const fieldCount = Object.keys(fields).length;
  const selecting = selectedPaths !== null;

  const loadImage = async (getImage) => {
    setLoading(true);
    setNotice(null);
    try {
      const image = await getImage();
      const document = await readGalleryImageMetadata(image, image.name || 'image', true);
      if (!Object.keys(document).length) {
        setNotice({ type: 'info', key: 'customMetadataMissing' });
        return;
      }
      if (!Object.keys(document).every(isCustomMetadataKey)) {
        setNotice({ type: 'error', key: 'invalidCustomMetadata' });
        return;
      }
      setFields(expandTextFields(document));
      setJsonText(null);
    } catch {
      setNotice({ type: 'error', key: 'customMetadataReadFailed' });
    } finally {
      setLoading(false);
    }
  };

  return <>
    <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}
      sx={{ px: { xs: 2, sm: 3 }, py: 1.25, flexWrap: 'wrap', borderBottom: 1, borderColor: 'divider' }}>
      <Typography variant="subtitle2" color="text.secondary">
        {selecting
          ? t('gallery.metadataEdit.selectedCount', { count: selectedPaths.length })
          : t('gallery.metadataEdit.fieldCount', { count: fieldCount })}
      </Typography>
      <Stack direction="row" spacing={1}>
        <Button size="small" color={selecting ? 'primary' : 'inherit'} startIcon={<CheckBoxOutlined fontSize="small" />}
          disabled={!fieldCount || loading} aria-pressed={selecting}
          onClick={() => setSelectedPaths(selecting ? null : [])}>
          {t(selecting ? 'gallery.metadataEdit.cancelSelection' : 'gallery.metadataEdit.select')}
        </Button>
        <Button size="small" variant="outlined" startIcon={loading ? <CircularProgress size={14} /> : <FileUploadOutlined fontSize="small" />}
          endIcon={<ExpandMore fontSize="small" />} disabled={loading || selecting}
          aria-haspopup="menu" aria-expanded={Boolean(importAnchor)} onClick={(event) => setImportAnchor(event.currentTarget)}>
          {label('customMetadataImport')}
        </Button>
      </Stack>
    </Stack>
    <Menu anchorEl={importAnchor} open={Boolean(importAnchor)} onClose={() => setImportAnchor(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
      {getCurrentImage && <MenuItem onClick={() => {
        setImportAnchor(null);
        void loadImage(getCurrentImage);
      }}><ListItemIcon><ImageSearch fontSize="small" /></ListItemIcon><ListItemText>{label('customMetadataCurrentImage')}</ListItemText></MenuItem>}
      <MenuItem onClick={() => {
        setImportAnchor(null);
        fileInput.current.click();
      }}><ListItemIcon><UploadFile fontSize="small" /></ListItemIcon><ListItemText>{label('customMetadataImageFile')}</ListItemText></MenuItem>
      <MenuItem onClick={() => {
        setImportAnchor(null);
        setJsonText((value) => value ?? '');
      }}><ListItemIcon><Code fontSize="small" /></ListItemIcon><ListItemText>{label('customMetadataImportJson')}</ListItemText></MenuItem>
    </Menu>
    <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => {
      const image = event.currentTarget.files[0];
      event.currentTarget.value = '';
      if (image) void loadImage(() => image);
    }} />
    <Stack spacing={2} sx={{ overflowY: 'auto', flex: 1, minHeight: 0, px: { xs: 2, sm: 3 }, py: 2, bgcolor: 'background.default' }}>
      {jsonText !== null && !selecting && (
        <Stack spacing={1.25} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper' }}>
          <TextField multiline minRows={3} maxRows={8} size="small" label="JSON"
            value={jsonText} onChange={(event) => setJsonText(event.target.value)} disabled={loading}
            placeholder={'{"Title": "My image", "Comment": {"prompt": "..."}}'}
            helperText={label('customMetadataHint')}
            slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: '0.85rem' } } }} />
          <Stack direction="row" justifyContent="flex-end" spacing={1}>
            <Button size="small" onClick={() => { setJsonText(null); setNotice(null); }}>{t('common.cancel')}</Button>
            <Button size="small" variant="outlined" disabled={loading || !jsonText.trim()} onClick={() => {
              const parsed = parseCustomImageMetadata(jsonText);
              if (!parsed) { setNotice({ type: 'error', key: 'invalidCustomMetadata' }); return; }
              setFields(expandTextFields(parsed));
              setJsonText(null);
              setNotice(null);
            }}>{label('customMetadataLoadJson')}</Button>
          </Stack>
        </Stack>
      )}
      {notice && <Alert severity={notice.type} onClose={() => setNotice(null)}>{label(notice.key)}</Alert>}
      <GalleryMetadataFields value={fields} onChange={setFields} editStructure validateRootField={isCustomMetadataKey} disabled={loading}
        selection={selecting ? { paths: selectedPaths, toggle: (path) => {
          setSelectedPaths((previous) => {
            const others = previous.filter((candidate) => !path.every((name, index) => name === candidate[index]));
            const wasSelected = previous.some((candidate) => candidate.length === path.length && path.every((name, index) => name === candidate[index]));
            return wasSelected ? others : [...others, path];
          });
        } } : null} />
    </Stack>
    <Box sx={{ borderTop: 1, borderColor: 'divider', px: { xs: 2, sm: 3 }, py: 1.5 }}>
      <Stack direction="row" justifyContent="flex-end" spacing={1}>
        <Button color="inherit" onClick={selecting ? () => setSelectedPaths(null) : onCancel}>{t('common.cancel')}</Button>
        {selecting ? (
          <Button color="error" variant="contained" disabled={!selectedPaths.length} onClick={() => {
            setFields((value) => removeSelectedFields(value, selectedPaths));
            setSelectedPaths(null);
          }}>{t('gallery.metadataEdit.removeSelected')}</Button>
        ) : (
          <Button variant="contained" disabled={loading || Boolean(jsonText?.trim())} onClick={() => {
            try {
              onSave(fieldCount ? JSON.stringify(fields) : '');
            } catch {
              setNotice({ type: 'error', key: 'customMetadataSaveFailed' });
            }
          }}>{label('customMetadataSave')}</Button>
        )}
      </Stack>
    </Box>
  </>;
}
