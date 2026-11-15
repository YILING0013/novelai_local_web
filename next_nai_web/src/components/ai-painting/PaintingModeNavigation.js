import { Box, Button, Tooltip } from '@mui/material';
import { Brush, Image, ViewQuilt } from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

/** Web 与桌面共用绘画子导航，工作台通过插槽提供当前模式和切换操作。 */
export default function PaintingModeNavigation({ selected, onChange, expanded = false }) {
  const { t } = useI18n();
  return [
    ['generation', Image, 'painting.workspace.tabs.generation'],
    ['inpaint', Brush, 'painting.workspace.tabs.inpaint'],
    ['comic', ViewQuilt, 'painting.workspace.tabs.comic'],
  ].map(([id, Icon, labelKey]) => <Tooltip key={id} title={t(labelKey)} placement="right" arrow>
    <Button aria-label={t(labelKey)} aria-pressed={id === selected} onClick={() => onChange(id)}
      sx={{ minWidth: 0, minHeight: 40, py: 0.5, px: 0.25, flexDirection: expanded ? 'row' : 'column', gap: 0.25,
        borderRadius: 1, fontSize: 10, lineHeight: 1.3, bgcolor: id === selected ? 'action.selected' : 'transparent',
        color: id === selected ? 'primary.main' : 'text.secondary' }}>
      <Icon sx={{ fontSize: 17 }} /><Box component="span" sx={{ whiteSpace: 'nowrap' }}>{t(labelKey)}</Box>
    </Button>
  </Tooltip>);
}
