'use client';

import { useEffect, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, List, ListItemButton, MenuItem, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Add, Close, DeleteOutline, ExpandMore, Refresh, SaveOutlined } from '@mui/icons-material';
import apiClient from '@/utils/ApiClient';
import { createClientId } from '@/utils/browserCapabilities.mjs';

const protocols = [
  ['openai', 'OpenAI', 'https://api.openai.com/v1'],
  ['claude', 'Claude', 'https://api.anthropic.com'],
  ['gemini', 'Gemini', 'https://generativelanguage.googleapis.com'],
  ['deepseek', 'DeepSeek · JSON', 'https://api.deepseek.com'],
];
const defaults = { provider: 'openai', baseUrl: protocols[0][2], model: '', storyModel: '', extractModel: '', formatModel: '', outputMode: 'schema', tokenParameter: 'max_completion_tokens', maxTokens: 8192, temperature: null, timeoutSeconds: 180 };

/**
 * 用列表和详情管理多套文字模型接口，密钥独立提交且不回显。
 * @param {object} props 打开状态、语言、关闭与已保存配置回调。
 * @returns {React.ReactElement} Provider 设置窗口。
 */
export default function ComicLLMSettings({ open, language, disabled, onClose, onChange }) {
  const mobile = useMediaQuery(useTheme().breakpoints.down('sm'));
  const [configuration, setConfiguration] = useState(null);
  const [saved, setSaved] = useState(null);
  const [selectedId, setSelectedId] = useState('novelai');
  const [credentials, setCredentials] = useState({});
  const [filter, setFilter] = useState('all');
  const [tests, setTests] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const w = (zh, en) => language === 'zh' ? zh : en;
  const dirty = Boolean(Object.keys(credentials).length || JSON.stringify(configuration) !== JSON.stringify(saved));
  const selected = configuration?.providers.find((item) => item.id === selectedId);
  const settings = selected?.settings;
  const custom = selectedId !== 'novelai';
  const locked = busy || disabled;
  const keyChange = credentials[selectedId] || {};
  const matchingEndpoint = saved?.providers.some((item) => item.id === selectedId && item.settings.provider === settings?.provider && item.settings.baseUrl === settings?.baseUrl);
  const hasKey = Boolean(keyChange.apiKey || (!keyChange.clearApiKey && matchingEndpoint && selected?.hasApiKey));

  useEffect(() => {
    if (!open || configuration) return;
    let active = true;
    setBusy(true);
    apiClient.request('/comic/llm-settings').then((result) => {
      if (!active) return;
      setConfiguration(result.configuration); setSaved(result.configuration); setSelectedId(result.configuration.activeProviderId); onChange(result.settings); setBusy(false);
    }).catch((cause) => { if (active) { setError(cause.data?.message || cause.data?.error || cause.message); setBusy(false); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open, configuration, onChange]);

  function updateProvider(changes) {
    setConfiguration({ ...configuration, providers: configuration.providers.map((item) => item.id === selectedId ? { ...item, ...changes } : item) });
    setNotice('');
  }

  function changeSetting(key, value) {
    updateProvider({ settings: { ...settings, [key]: value } });
    setTests((current) => ({ ...current, [selectedId]: '' }));
  }

  function changeKey(changes) {
    setCredentials({ ...credentials, [selectedId]: { ...keyChange, ...changes } }); setNotice('');
  }

  async function save() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiClient.request('/comic/llm-settings', { method: 'PUT', body: {
        configuration: { ...configuration, providers: configuration.providers.map(({ id, name, enabled, settings: values }) => ({ id, name, enabled, settings: values })) }, credentials,
      } });
      setConfiguration(result.configuration); setSaved(result.configuration); setCredentials({});
      onChange(result.settings); setNotice(w('已保存', 'Saved'));
    } catch (cause) { setError(cause.data?.message || cause.data?.error || cause.message); }
    finally { setBusy(false); }
  }

  async function testConnection() {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiClient.request('/comic/llm-test', { method: 'POST', body: { providerId: selectedId } });
      setTests((current) => ({ ...current, [selectedId]: 'passed' })); setNotice(w('连接成功', 'Connected'));
    } catch (cause) {
      setTests((current) => ({ ...current, [selectedId]: 'failed' })); setError(cause.data?.message || cause.data?.error || cause.message);
    } finally { setBusy(false); }
  }

  const visible = configuration?.providers.filter((item) => filter === 'all' || (filter === 'enabled' ? item.enabled : item.id !== 'novelai' && tests[item.id] !== 'passed')) || [];
  return <Dialog open={open} onClose={locked ? undefined : onClose} fullScreen={mobile} fullWidth maxWidth="md" aria-labelledby="comic-provider-title" slotProps={{ paper: { sx: { height: mobile ? '100%' : 'min(780px, 90dvh)' } } }}>
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.5 }}>
      <Typography id="comic-provider-title" component="span" sx={{ fontSize: 18, fontWeight: 600, flex: 1 }}>{w('Provider 管理', 'Providers')}</Typography>
      <Tooltip title={w('重新读取', 'Reload')}><span><IconButton aria-label={w('重新读取 Provider', 'Reload providers')} disabled={locked || dirty} onClick={() => { setConfiguration(null); setError(''); setNotice(''); }}><Refresh /></IconButton></span></Tooltip>
      <IconButton aria-label={w('关闭设置', 'Close settings')} disabled={locked} onClick={onClose}><Close /></IconButton>
    </DialogTitle>
    <DialogContent dividers sx={{ p: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {error && <Alert severity="error" sx={{ borderRadius: 0 }}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ borderRadius: 0 }}>{notice}</Alert>}
      {configuration && <>
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <TextField select fullWidth size="small" label={w('默认 Provider', 'Default provider')} disabled={locked} value={configuration.activeProviderId}
            onChange={(event) => { setConfiguration({ ...configuration, activeProviderId: event.target.value }); setNotice(''); }}>
            {configuration.providers.map((item) => <MenuItem key={item.id} value={item.id} disabled={!item.enabled}>{item.name}</MenuItem>)}
          </TextField>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '220px minmax(0,1fr)' }, gridTemplateRows: { xs: 'auto minmax(0,1fr)', sm: 'minmax(0,1fr)' }, flex: 1, minHeight: 0 }}>
          <Box component="aside" aria-label={w('Provider 列表', 'Provider list')} sx={{ minHeight: 0, overflowY: 'auto', borderRight: { sm: 1 }, borderBottom: { xs: 1, sm: 0 }, borderColor: 'divider' }}>
            <Box sx={{ px: 1, py: 1.25, display: 'flex', gap: 0.5, alignItems: 'center', justifyContent: 'space-between' }}>
              <ToggleButtonGroup exclusive size="small" value={filter} onChange={(_, value) => { if (value) setFilter(value); }} aria-label={w('筛选 Provider', 'Filter providers')}>
                <ToggleButton value="all">{w('全部', 'All')}</ToggleButton><ToggleButton value="enabled">{w('启用', 'Enabled')}</ToggleButton><ToggleButton value="untested">{w('待测试', 'Untested')}</ToggleButton>
              </ToggleButtonGroup>
              <Tooltip title={w('添加 Provider', 'Add provider')}><span><IconButton size="small" disabled={locked} aria-label={w('添加 Provider', 'Add provider')} onClick={() => {
                const id = createClientId(); let index = configuration.providers.length;
                while (configuration.providers.some((item) => item.name === `Provider ${index}`)) index += 1;
                setConfiguration({ ...configuration, providers: [...configuration.providers, { id, name: `Provider ${index}`, enabled: true, settings: { ...defaults }, hasApiKey: false, rememberApiKey: false }] });
                setSelectedId(id); setFilter('all'); setConfirmDelete(false); setNotice('');
              }}><Add /></IconButton></span></Tooltip>
            </Box>
            <List disablePadding sx={{ display: { xs: 'flex', sm: 'block' }, overflowX: { xs: 'auto', sm: 'visible' } }}>
              {visible.map((item) => <ListItemButton key={item.id} selected={selectedId === item.id} aria-current={selectedId === item.id ? 'true' : undefined}
                onClick={() => { setSelectedId(item.id); setConfirmDelete(false); }} sx={{ alignItems: 'flex-start', flexDirection: 'column', minWidth: { xs: 155, sm: 0 }, borderLeft: 3, borderColor: selectedId === item.id ? 'primary.main' : 'transparent', py: 1.25 }}>
                <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{item.name}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{item.id === 'novelai' ? 'NovelAI' : `${item.settings.provider} · ${item.settings.model || '—'}`}</Typography>
                <Stack direction="row" gap={0.5} sx={{ mt: 0.5 }}>
                  {item.id === configuration.activeProviderId && <Chip size="small" label={w('默认', 'Default')} color="primary" variant="outlined" />}
                  {!item.enabled && <Chip size="small" label={w('停用', 'Disabled')} />}
                  {tests[item.id] && <Chip size="small" color={tests[item.id] === 'passed' ? 'success' : 'error'} label={tests[item.id] === 'passed' ? w('已测试', 'Tested') : w('失败', 'Failed')} variant="outlined" />}
                </Stack>
              </ListItemButton>)}
            </List>
          </Box>
          <Box component="section" aria-label={selected?.name || 'Provider'} sx={{ p: 2, minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
            {selected && <Stack spacing={2}>
              <Stack direction="row" alignItems="center" gap={1}>
                <TextField fullWidth size="small" label={w('名称', 'Name')} value={selected.name} disabled={locked || !custom} onChange={(event) => updateProvider({ name: event.target.value })} />
                {custom && <FormControlLabel sx={{ mr: 0, flexShrink: 0 }} control={<Switch size="small" checked={selected.enabled} disabled={locked || configuration.activeProviderId === selectedId} onChange={(event) => updateProvider({ enabled: event.target.checked })} />} label={w('启用', 'Enabled')} />}
              </Stack>
              {custom ? <>
                <Stack direction={{ xs: 'column', md: 'row' }} gap={1.5}>
                  <TextField select fullWidth size="small" label={w('协议', 'Protocol')} value={settings.provider} disabled={locked} onChange={(event) => {
                    const protocol = event.target.value;
                    updateProvider({ settings: { ...settings, provider: protocol,
                      baseUrl: !settings.baseUrl || protocols.some((item) => item[2] === settings.baseUrl) ? protocols.find((item) => item[0] === protocol)[2] : settings.baseUrl,
                      outputMode: protocol === 'deepseek' ? 'json' : 'schema', tokenParameter: protocol === 'deepseek' ? 'max_tokens' : 'max_completion_tokens', temperature: null } });
                    setTests((current) => ({ ...current, [selectedId]: '' }));
                  }}>{protocols.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>
                  <TextField fullWidth size="small" label={w('默认模型', 'Default model')} value={settings.model} disabled={locked} onChange={(event) => changeSetting('model', event.target.value)} />
                </Stack>
                <TextField fullWidth size="small" label="Base URL" value={settings.baseUrl} disabled={locked} onChange={(event) => changeSetting('baseUrl', event.target.value)} />
                <TextField fullWidth size="small" type="password" autoComplete="new-password" label="API Key" slotProps={{ inputLabel: { shrink: true } }} value={keyChange.apiKey || ''} disabled={locked}
                  placeholder={hasKey ? w('已设置，留空保留', 'Configured; leave blank to keep') : w('未设置', 'Not configured')}
                  onChange={(event) => changeKey({ apiKey: event.target.value, clearApiKey: false })} />
                <Stack direction="row" gap={1} justifyContent="space-between" alignItems="center" flexWrap="wrap">
                  <Tooltip title={w('以明文保存在本地后端数据目录', 'Stored as plain text in the local backend data folder')}><FormControlLabel control={<Checkbox size="small" checked={keyChange.rememberApiKey ?? selected.rememberApiKey} disabled={locked} onChange={(event) => changeKey({ rememberApiKey: event.target.checked })} />} label={w('记住密钥', 'Remember key')} /></Tooltip>
                  {hasKey && <Button size="small" color="warning" disabled={locked} onClick={() => changeKey({ apiKey: '', clearApiKey: true, rememberApiKey: false })}>{w('清除密钥', 'Clear key')}</Button>}
                </Stack>
                <TextField select fullWidth size="small" label={w('结构化输出', 'Structured output')} value={settings.outputMode} disabled={locked || settings.provider === 'deepseek'} onChange={(event) => changeSetting('outputMode', event.target.value)}>
                  <MenuItem value="schema">JSON Schema</MenuItem>{settings.provider !== 'claude' && <MenuItem value="json">JSON mode</MenuItem>}<MenuItem value="prompt">{w('仅提示词 JSON', 'Prompt-only JSON')}</MenuItem>
                </TextField>
                <Accordion disableGutters elevation={0} sx={{ borderTop: 1, borderColor: 'divider', '&:before': { display: 'none' } }}>
                  <AccordionSummary expandIcon={<ExpandMore />} sx={{ px: 0 }}><Typography variant="body2">{w('分步模型与生成参数', 'Stage models and generation settings')}</Typography></AccordionSummary>
                  <AccordionDetails sx={{ px: 0 }}><Stack spacing={1.5}>
                    {[['storyModel', '故事模型', 'Story model'], ['extractModel', '提取模型', 'Extraction model'], ['formatModel', '分镜模型', 'Panel model']].map(([key, zh, en]) => <TextField key={key} fullWidth size="small" label={w(zh, en)} placeholder={settings.model} value={settings[key]} disabled={locked} onChange={(event) => changeSetting(key, event.target.value)} />)}
                    <Stack direction="row" gap={1.5}>
                      <TextField fullWidth size="small" type="number" label={w('输出 Token 上限', 'Max output tokens')} value={settings.maxTokens} disabled={locked} onChange={(event) => changeSetting('maxTokens', Number(event.target.value))} />
                      <TextField fullWidth size="small" type="number" label={w('超时（秒）', 'Timeout (s)')} value={settings.timeoutSeconds} disabled={locked} onChange={(event) => changeSetting('timeoutSeconds', Number(event.target.value))} />
                    </Stack>
                    {settings.provider !== 'claude' && <TextField fullWidth size="small" type="number" label={w('温度', 'Temperature')} value={settings.temperature ?? ''} disabled={locked} onChange={(event) => changeSetting('temperature', event.target.value === '' ? null : Number(event.target.value))} />}
                    {settings.provider === 'openai' && <TextField select fullWidth size="small" label={w('输出长度参数', 'Output token parameter')} value={settings.tokenParameter} disabled={locked} onChange={(event) => changeSetting('tokenParameter', event.target.value)}><MenuItem value="max_completion_tokens">max_completion_tokens</MenuItem><MenuItem value="max_tokens">max_tokens</MenuItem></TextField>}
                  </Stack></AccordionDetails>
                </Accordion>
                <Stack direction="row" gap={1} flexWrap="wrap">
                  <Tooltip title={w('调用模型测试，使用服务商额度', 'Calls the model and uses service credits')}><span><Button size="small" variant="outlined" disabled={locked || dirty || !hasKey} onClick={testConnection}>{w('测试连接', 'Test connection')}</Button></span></Tooltip>
                  <Button size="small" color="error" startIcon={<DeleteOutline />} disabled={locked} onClick={() => setConfirmDelete(true)}>{w('删除', 'Delete')}</Button>
                </Stack>
                {confirmDelete && <Alert severity="warning" action={<Stack direction="row"><Button color="inherit" onClick={() => setConfirmDelete(false)}>{w('取消', 'Cancel')}</Button><Button color="error" onClick={() => {
                  setConfiguration({ activeProviderId: configuration.activeProviderId === selectedId ? 'novelai' : configuration.activeProviderId, providers: configuration.providers.filter((item) => item.id !== selectedId) });
                  const next = { ...credentials }; delete next[selectedId]; setCredentials(next); setSelectedId('novelai'); setConfirmDelete(false);
                }}>{w('删除', 'Delete')}</Button></Stack>}>{w(`删除 ${selected.name}？`, `Delete ${selected.name}?`)}</Alert>}
              </> : <Chip sx={{ alignSelf: 'flex-start' }} label={w('使用当前 NovelAI 账户', 'Current NovelAI account')} variant="outlined" />}
            </Stack>}
          </Box>
        </Box>
      </>}
      {!configuration && <Box sx={{ p: 2 }}><Typography role="status">{busy ? w('读取中…', 'Loading…') : w('读取失败', 'Could not load settings')}</Typography></Box>}
    </DialogContent>
    <DialogActions sx={{ px: 2, py: 1.5, gap: 1 }}>
      {dirty && <Button disabled={locked} onClick={() => { setConfiguration(saved); setCredentials({}); setSelectedId(saved.activeProviderId); setError(''); setNotice(''); setConfirmDelete(false); }}>{w('撤销修改', 'Discard changes')}</Button>}
      <Button variant="contained" startIcon={<SaveOutlined />} disabled={locked || !dirty} onClick={save}>{busy ? w('处理中…', 'Working…') : w('保存', 'Save')}</Button>
    </DialogActions>
  </Dialog>;
}
