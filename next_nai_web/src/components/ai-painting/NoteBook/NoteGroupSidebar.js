import React, { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, List, ListItemButton, Menu, MenuItem, TextField,
  Tooltip, Typography,
} from '@mui/material';
import {
  Add, ChevronRight, DeleteOutline, DriveFileRenameOutline, ExpandMore,
  FolderOutlined, FolderOpenOutlined, InboxOutlined, MoreHoriz, NotesOutlined,
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';
import notebookMessages from './notebookMessages';

/**
 * 显示最多三级分组，并在创建、重命名和删除后保留当前筛选。
 * options 为 getGroupOptions 的结果；写入回调失败时应抛错或返回 false。
 */
export default function NoteGroupSidebar({
  notes, options, selectedGroup, onSelectGroup, onCreateGroup, onUpdateGroup, onDeleteGroup,
}) {
  const { locale } = useI18n();
  const copy = notebookMessages[locale];
  const [collapsedIds, setCollapsedIds] = useState(new Set());
  const [menu, setMenu] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 三级树很小，直接计算父级归属，使分组数量与右侧筛选结果一致。
  const counts = new Map(options.map((group) => [group.id, 0]));
  const groupsById = new Map(options.map((group) => [group.id, group]));
  for (const note of notes) {
    let group = groupsById.get(note.group_id);
    while (group) {
      counts.set(group.id, counts.get(group.id) + 1);
      group = groupsById.get(group.parent_id);
    }
  }

  const openDialog = (type, group = null) => {
    setDialog({ type, group });
    setName(type === 'rename' ? group.name : '');
    setParentId(type === 'create' && group ? group.id : '');
    setError('');
    setMenu(null);
  };

  const submitGroup = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      let result;
      if (dialog.type === 'create') {
        result = await onCreateGroup({ name: name.trim(), parent_id: parentId || null });
      } else if (dialog.type === 'rename') {
        result = await onUpdateGroup(dialog.group.id, { name: name.trim() });
      } else {
        result = await onDeleteGroup(dialog.group.id);
      }
      if (result === false) {
        setError(copy.groupActionFailed);
        return;
      }
      if (dialog.type === 'create' && parentId) {
        setCollapsedIds((previous) => {
          const next = new Set(previous);
          let group = groupsById.get(parentId);
          while (group) {
            next.delete(group.id);
            group = groupsById.get(group.parent_id);
          }
          return next;
        });
      }
      setDialog(null);
    } catch {
      setError(copy.groupActionFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Box component="nav" aria-label={copy.groups} sx={{ p: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, mb: 1 }}>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>{copy.groups}</Typography>
          <Tooltip title={copy.newGroup}>
            <IconButton aria-label={copy.newGroup} size="small" onClick={() => openDialog('create')}><Add fontSize="small" /></IconButton>
          </Tooltip>
        </Box>
        <List component="div" disablePadding>
          {[
            { id: null, label: copy.allNotes, icon: <NotesOutlined fontSize="small" />, count: notes.length },
            { id: '', label: copy.ungrouped, icon: <InboxOutlined fontSize="small" />, count: notes.filter((note) => !note.group_id).length },
          ].map((item) => (
            <ListItemButton key={item.id ?? "all-notes"} selected={selectedGroup === item.id} onClick={() => onSelectGroup(item.id)} sx={{ gap: 1, borderRadius: 1.5, mb: 0.5, px: 1.25, py: 1 }}>
              {item.icon}
              <Typography variant="body2" sx={{ flexGrow: 1, fontWeight: selectedGroup === item.id ? 600 : 400 }}>{item.label}</Typography>
              <Typography variant="caption" color="text.secondary">{item.count}</Typography>
            </ListItemButton>
          ))}
          <Divider sx={{ my: 1.5 }} />
          {options.map((group) => {
            let parent = groupsById.get(group.parent_id);
            while (parent) {
              if (collapsedIds.has(parent.id)) return null;
              parent = groupsById.get(parent.parent_id);
            }
            const hasChildren = options.some((item) => item.parent_id === group.id);
            const expanded = !collapsedIds.has(group.id);
            return (
              <Box key={group.id} sx={{ display: 'flex', alignItems: 'center', pl: (group.depth - 1) * 1.5, mb: 0.5 }}>
                {hasChildren ? (
                  <IconButton size="small" aria-label={`${expanded ? copy.collapseGroup : copy.expandGroup} ${group.name}`} onClick={() => setCollapsedIds((previous) => {
                    const next = new Set(previous);
                    if (expanded) next.add(group.id); else next.delete(group.id);
                    return next;
                  })} sx={{ p: 0.25 }}>{expanded ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}</IconButton>
                ) : <Box sx={{ width: 24, flexShrink: 0 }} />}
                <ListItemButton selected={selectedGroup === group.id} onClick={() => onSelectGroup(group.id)} title={group.label} sx={{ minWidth: 0, gap: 0.75, borderRadius: 1.5, px: 0.75, py: 1 }}>
                  {selectedGroup === group.id ? <FolderOpenOutlined fontSize="small" color="primary" /> : <FolderOutlined fontSize="small" color="action" />}
                  <Typography variant="body2" noWrap sx={{ flexGrow: 1, fontWeight: selectedGroup === group.id ? 600 : 400 }}>{group.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{counts.get(group.id)}</Typography>
                </ListItemButton>
                <IconButton size="small" aria-label={`${copy.groupActions} ${group.name}`} onClick={(event) => setMenu({ anchor: event.currentTarget, group })} sx={{ p: 0.25 }}><MoreHoriz fontSize="small" /></IconButton>
              </Box>
            );
          })}
        </List>
        <Button startIcon={<Add />} fullWidth onClick={() => openDialog('create')} sx={{ mt: 1, justifyContent: 'flex-start', px: 1.25 }}>{copy.newGroup}</Button>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1, mt: 1, lineHeight: 1.6 }}>{copy.groupHelp}</Typography>
      </Box>
      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {menu?.group.depth < 3 && <MenuItem onClick={() => openDialog('create', menu.group)}><Add fontSize="small" sx={{ mr: 1 }} />{copy.addChild}</MenuItem>}
        <MenuItem onClick={() => openDialog('rename', menu.group)}><DriveFileRenameOutline fontSize="small" sx={{ mr: 1 }} />{copy.renameGroup}</MenuItem>
        <MenuItem onClick={() => openDialog('delete', menu.group)} sx={{ color: 'error.main' }}><DeleteOutline fontSize="small" sx={{ mr: 1 }} />{copy.deleteGroup}</MenuItem>
      </Menu>
      <Dialog open={Boolean(dialog)} onClose={() => !busy && setDialog(null)} fullWidth maxWidth="xs" PaperProps={{ component: 'form', onSubmit: submitGroup }}>
        <DialogTitle>{dialog?.type === 'create' ? copy.newGroup : dialog?.type === 'rename' ? copy.renameGroup : copy.deleteGroup}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {dialog?.type === 'delete' ? (
            <><Typography sx={{ mb: 1, overflowWrap: 'anywhere' }} fontWeight={600}>{dialog.group.label}</Typography><Typography variant="body2" color="text.secondary">{copy.deleteGroupHelp}</Typography></>
          ) : (
            <>
              <TextField autoFocus fullWidth required label={copy.groupName} value={name} onChange={(event) => setName(event.target.value)} inputProps={{ maxLength: 50 }} helperText={copy.groupNameHelp} disabled={busy} sx={{ mt: 1 }} />
              {dialog?.type === 'create' && (
                <TextField select fullWidth label={copy.parentGroup} value={parentId} onChange={(event) => setParentId(event.target.value)} disabled={busy} sx={{ mt: 2 }} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}>
                  <MenuItem value="">{copy.rootGroup}</MenuItem>
                  {options.filter((group) => group.depth < 3).map((group) => <MenuItem key={group.id} value={group.id}>{group.label}</MenuItem>)}
                </TextField>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialog(null)} disabled={busy}>{copy.cancel}</Button>
          <Button type="submit" variant="contained" color={dialog?.type === 'delete' ? 'error' : 'primary'} disabled={busy || (dialog?.type !== 'delete' && !name.trim())}>{dialog?.type === 'create' ? copy.create : dialog?.type === 'rename' ? copy.save : copy.delete}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
