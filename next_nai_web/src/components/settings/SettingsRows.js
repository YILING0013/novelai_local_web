import { useState } from 'react';
import { Box, MenuItem, Select, Stack, Typography, alpha } from '@mui/material';

/**
 * 设置项的说明文字：窄屏直接显示两行，点一下展开全文；
 * 宽屏（lg 及以上）改由设置页右侧说明栏显示，这里只留给读屏软件，不占版面。
 * @param {object} props text 为说明文字。
 * @returns {React.ReactElement} 说明文字。
 */
export function SettingsDescription({ text }) {
  const [expanded, setExpanded] = useState(false);
  return <Typography variant="body2" color="text.secondary" onClick={() => setExpanded(!expanded)} sx={(theme) => ({
    mt: 0.25, fontSize: 12.5, lineHeight: 1.55, cursor: 'pointer',
    ...(!expanded && { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
    [theme.breakpoints.up('lg')]: {
      // sx 中数字 1 会变成 100%，即使裁剪不可见，整块说明仍会撑大弹窗的滚动范围。
      position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
    },
  })}>{text}</Typography>;
}

/**
 * 一组同类设置：标题下方是用细线分隔的设置行，不使用卡片。
 * @param {object} props 分组标题、图标、可选说明 help 和设置行。
 * @returns {React.ReactElement} 设置分组。
 */
export function SettingsGroup({ title, icon, help, children }) {
  return <Box component="section" sx={{ minWidth: 0 }}>
    <Box data-setting={title} data-setting-help={help} sx={{ pb: 1, borderBottom: 2, borderColor: 'divider' }}>
      <Stack direction="row" alignItems="center" gap={1} sx={{ color: 'primary.main', '& > svg': { fontSize: 18 } }}>
        {icon}
        <Typography component="h2" variant="subtitle1" fontWeight={700} color="text.primary">{title}</Typography>
      </Stack>
      {help && <SettingsDescription text={help} />}
    </Box>
    <Box sx={{ '& > .settings-row:not(:last-child)': { borderBottom: 1, borderColor: 'divider' } }}>{children}</Box>
  </Box>;
}

/**
 * 一项设置：标签与控件同行；说明在窄屏显示在标签下，宽屏显示在右侧说明栏；status 是常驻的当前状态。
 * @param {object} props label 标签；description 说明；status 当前状态文字；
 *   changed 表示有未保存的修改；wide 表示控件在手机上需要占满整行。
 * @returns {React.ReactElement} 一项系统设置。
 */
export function SettingsRow({ label, description, status, changed = false, children, wide = false, guideTarget }) {
  return <Box className="settings-row" data-release-target={guideTarget} data-setting={label} data-setting-help={description} sx={(theme) => ({
    minHeight: 56, py: 1.25, px: 1, mx: -1, display: 'flex', gap: { xs: 1.25, sm: 3 },
    flexDirection: wide ? { xs: 'column', sm: 'row' } : 'row',
    alignItems: wide ? { xs: 'stretch', sm: 'center' } : 'center',
    justifyContent: 'space-between',
    transition: 'background-color 120ms linear',
    '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.035) },
  })}>
    <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
      <Stack direction="row" alignItems="center" gap={0.75}>
        <Typography variant="body1" fontWeight={600} sx={{ lineHeight: 1.45 }}>{label}</Typography>
        {changed && <Box aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0 }} />}
      </Stack>
      {status && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, fontSize: 12.5, lineHeight: 1.5 }}>{status}</Typography>}
      {description && <SettingsDescription text={description} />}
    </Box>
    {children && <Box sx={{ minWidth: 0, flex: '0 0 auto', width: wide ? { xs: '100%', sm: 240, md: 260 } : undefined }}>{children}</Box>}
  </Box>;
}

/**
 * 设置行内的下拉菜单，使用行标题作为无障碍名称。
 * @param {object} props 名称、当前值、选项与更改回调。
 * @returns {React.ReactElement} 一个下拉控件。
 */
export function SettingsSelect({ label, value, options, onChange, disabled = false }) {
  return <Select size="small" fullWidth value={value} onChange={(event) => onChange(event.target.value)}
    disabled={disabled} SelectDisplayProps={{ 'aria-label': label }}>
    {options.map(([key, text]) => <MenuItem key={key} value={key}>{text}</MenuItem>)}
  </Select>;
}
