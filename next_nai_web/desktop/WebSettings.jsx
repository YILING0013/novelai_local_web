import { useEffect, useState } from 'react';
import { Alert, Button, FormControlLabel, Paper, Stack, Switch, TextField, Typography } from '@mui/material';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '@/i18n/I18nProvider';
import { UpdateSettings } from './Updates';
export default function WebSettings(){
  const {locale}=useI18n(), zh=locale==='zh-CN';
  const [status,setStatus]=useState(null),[port,setPort]=useState('5000'),[lan,setLan]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  function show(s){setStatus(s);setPort(String(s.port));setLan(s.lan);setError(s.error||'')}
  useEffect(()=>{invoke('web_status').then(show).catch(e=>setError(String(e)))},[]);
  async function apply(enabled){setBusy(true);setError('');try{show(await invoke('web_configure',{config:{enabled,lan,port:!enabled&&invalid?status.port:Number(port)}}))}catch(e){setError(String(e))}finally{setBusy(false)}}
  const invalid=!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535;
  return <Stack sx={{maxWidth:760,mx:'auto'}} spacing={2}><Typography variant="h5">{zh?'桌面应用':'Desktop application'}</Typography>
    <Paper variant="outlined" sx={{p:3}}><Stack spacing={2}>
      <FormControlLabel control={<Switch checked={Boolean(status?.enabled)} disabled={busy||!status||(!status.enabled&&invalid)} onChange={e=>apply(e.target.checked)}/>} label={zh?'启用 Web 访问':'Enable Web access'}/>
      <TextField label={zh?'端口':'Port'} size="small" value={port} error={invalid} onChange={e=>setPort(e.target.value)}/>
      <FormControlLabel control={<Switch checked={lan} onChange={e=>setLan(e.target.checked)}/>} label={zh?'允许局域网设备访问':'Allow devices on the local network'}/>
      {status&&(Number(port)!==status.port||lan!==status.lan||status.enabled&&!status.running)&&<Button disabled={busy||invalid} onClick={()=>apply(status.enabled||false)}>{zh?'应用更改':'Apply changes'}</Button>}
      {error&&<Alert severity="error">{error}</Alert>}
      {status?.urls?.map(url=><Typography key={url} sx={{userSelect:'all'}}>{url}</Typography>)}
      <Typography color="text.secondary" variant="caption">{zh?'程序会记住此设置。退出程序后 Web 访问将关闭。':'This setting is remembered. Quitting the application stops Web access.'}</Typography>
    </Stack></Paper><Paper variant="outlined" sx={{p:3}}><UpdateSettings /></Paper></Stack>;
}
