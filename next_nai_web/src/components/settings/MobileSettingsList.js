import { Box, List, ListItemButton, ListItemIcon, ListItemText, Paper, Typography } from '@mui/material';
import { ChevronRight } from '@mui/icons-material';

/** 以手机设置入口卡片呈现各个可以独立打开的分区。 */
export default function MobileSettingsList({ items, onSelect, label }) {
  return <Paper component="nav" aria-label={label} elevation={0} sx={{ borderRadius: 3, overflow: 'hidden', border: 1, borderColor: 'divider' }}>
    <List disablePadding>
      {items.map((item, index) => <ListItemButton component="button" type="button" data-mobile-settings-section={item.id}
        key={item.id} onClick={() => onSelect(item.id)} sx={{
        width: '100%', textAlign: 'start',
        minHeight: 76, px: 2, py: 1.5, gap: 1.5,
        '&::after': index < items.length - 1 ? { content: '""', position: 'absolute', bottom: 0, left: 68, right: 16, borderBottom: 1, borderColor: 'divider' } : {},
      }}>
        <ListItemIcon sx={{ minWidth: 0, width: 36, height: 36, borderRadius: 1.5, bgcolor: 'action.selected', color: 'primary.main', display: 'grid', placeItems: 'center' }}>{item.icon}</ListItemIcon>
        <ListItemText sx={{ m: 0, minWidth: 0 }} primary={<Typography sx={{ fontWeight: 600, fontSize: 16 }}>{item.label}</Typography>}
          secondary={item.description && <Typography component="span" sx={{ display: 'block', mt: 0.5, fontSize: 13, lineHeight: 1.5, color: 'text.secondary' }}>{item.description}</Typography>} />
        <Box sx={{ color: 'text.secondary', display: 'flex', flexShrink: 0 }}><ChevronRight /></Box>
      </ListItemButton>)}
    </List>
  </Paper>;
}
