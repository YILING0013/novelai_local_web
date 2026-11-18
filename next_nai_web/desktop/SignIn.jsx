import { useEffect, useState } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import api from '@/utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';

export default function SignIn({ onSuccess }) {
  const { t, locale }=useI18n();
  const [password,setPassword]=useState(false),[recovery,setRecovery]=useState(false);
  const [fields,setFields]=useState({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{ api.getAccountRecovery().then(r=>setRecovery(r.active)).catch(e=>setError(e.message)); },[]);
  const input=(key,label,type='password')=><TextField key={key} fullWidth required label={label} type={type} value={fields[key]||''}
    autoComplete={key==='email'?'username':'off'} onChange={e=>setFields(prev=>({...prev,[key]:e.target.value}))}/>;
  async function submit(e){
    e.preventDefault(); if(busy)return;setError('');setBusy(true);
    try {const s=recovery?await api.resolveAccountRecovery(fields):password?await api.loginWithPassword(fields.email,fields.password):await api.loginWithPersistentToken(fields.token);
      if(s.authenticated)onSuccess();else setError(t('login.invalidCredentials'));
    }catch(e){setError(e.data?.message||e.message)}finally{setBusy(false)}
  }
  return <Box component="main" sx={{ flex:1,minHeight:0, width:'100%',bgcolor:'background.paper',display:'grid',gridTemplateColumns:{xs:'minmax(0,1fr)',md:'minmax(280px,1fr) minmax(420px,1fr)'},overflow:'hidden' }}>
    <Box aria-hidden="true" sx={{display:{xs:'none',md:'block'},position:'relative',overflow:'hidden'}}>
      <Box component="img" src="/reference_img/6JVxqoqt4t7qCGVBUkovwn8IKePfdDpk.webp" alt="" sx={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
      <Box sx={{position:'absolute',inset:0,background:'linear-gradient(180deg,transparent 50%,rgba(0,0,0,.62))'}}/>
      <Box sx={{position:'absolute',left:28,right:28,bottom:30,color:'#fff'}}><Typography sx={{fontSize:24,fontWeight:700,letterSpacing:2}}>NovelAI Local</Typography></Box>
    </Box>
    <Box sx={{overflowY:'auto',display:'flex',flexDirection:'column',px:{xs:3,md:4},py:3}}>
      <Stack component="form" onSubmit={submit} spacing={2.5} sx={{width:'100%',maxWidth:360,mx:'auto',my:'auto'}}>
        <Stack direction="row" spacing={1.5} alignItems="center"><Box component="img" src="/logo.svg" alt="" width={40}/>
          <Typography variant="h5">{recovery?t('login.local.recoveryRequired'):(locale==='zh-CN'?'登录 NovelAI':'Sign in to NovelAI')}</Typography></Stack>
        {recovery?['source_email','source_password','target_email','target_password'].map((k,i)=>input(k,t('login.local.'+['oldEmail','oldPassword','newEmail','newPassword'][i]),i%2?'password':'email'))
          :password?<>{input('email',t('login.local.email'),'email')}{input('password',t('login.password'))}<Typography color="text.secondary" variant="caption">{t('login.local.passwordCompatibilityNotice')}</Typography></>:input('token',t('login.local.pat'))}
        {error && <Alert severity="error">{error}</Alert>}
        <Button type="submit" size="large" variant="contained" disabled={busy}>{busy?t('login.loggingIn'):recovery?t('login.local.resolveRecovery'):t('login.login')}</Button>
        {!recovery&&<Button disabled={busy} onClick={()=>{setPassword(v=>!v);setError('')}}>{t(password?'login.local.usePat':'login.local.useEmailPassword')}</Button>}
      </Stack>
    </Box>
  </Box>;
}
