import { useEffect, useState } from 'react';
import { Alert } from '@mui/material';
import { ArrowRight, KeyRound, Mail, Monitor } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher';
import DesktopWebAccess from '@/components/settings/DesktopWebAccess';
import api from '@/utils/ApiClient';
import TitleBar, { native } from './TitleBar';

export default function SignIn() {
  const { t, locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [mode, setMode] = useState('token');
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { native('ready'); }, []);
  useEffect(() => {
    let live = true;
    setChecking(true); setError('');
    api.getAccountRecovery().then(result => {
      if (live) { setMode(result.active ? 'recovery' : 'token'); setChecking(false); }
    }).catch(() => { if (live) setError('LOCAL_SERVICE_UNAVAILABLE'); });
    return () => { live = false; };
  }, [attempt]);
  const input = (name, label, type, autoComplete) => <label className="auth-field" key={name}>
    <span>{label}</span><input type={type} autoComplete={autoComplete} value={fields[name] || ''}
      disabled={busy} required onChange={e => setFields({ ...fields, [name]: e.target.value })} />
  </label>;
  async function submit(e) {
    e.preventDefault();
    if (checking || busy) return;
    setBusy(true); setError('');
    try {
      const result = mode === 'recovery' ? await api.resolveAccountRecovery(fields)
        : mode === 'password' ? await api.loginWithPassword(fields.email, fields.password)
          : await api.loginWithPersistentToken(fields.token);
      if (!result.authenticated) throw new Error('AUTH_REQUIRED');
      setFields({}); native('workspace');
    } catch (err) { setError(err.data?.error || err.code || t('login.invalidCredentials')); }
    finally { setBusy(false); }
  }
  return <div className="studio-frame">
    <TitleBar auth><DesktopWebAccess /><LanguageSwitcher compact /></TitleBar>
    <main className="auth-layout">
      <div className="auth-art"><div className="art-caption"><img src="/logo.png" alt="" /><div>NovelAI Local</div>
        <span>{zh ? '本地创作工作台' : 'Local creative workspace'}</span></div></div>
      <div className="auth-panel">
        <form className="auth-form" onSubmit={submit}>
          <h1>{mode === 'recovery' ? t('login.local.recoveryRequired') : (zh ? '登录 NovelAI' : 'Sign in to NovelAI')}</h1>
          {mode === 'recovery' ? <><p>{t('login.local.recoveryDescription')}</p>
            {['source_email','source_password','target_email','target_password'].map((n,i) =>
              input(n,t('login.local.'+['oldEmail','oldPassword','newEmail','newPassword'][i]),i%2 ? 'password':'email','off'))}</>
            : <><div className="auth-modes">
              {[[KeyRound,'token','Token'],[Mail,'password',zh ? '邮箱密码' : 'Email & password']].map(([Icon,id,label]) =>
                <button type="button" key={id} disabled={busy || checking} aria-pressed={mode === id} onClick={() => {setMode(id);setError('');}}><Icon size={15}/>{label}</button>)}
            </div>
            {mode === 'token' ? input('token',t('login.local.pat'),'password','off') : <>
              {input('email',t('login.local.email'),'email','username')}{input('password',t('login.password'),'password','current-password')}
              <small>{t('login.local.passwordCompatibilityNotice')}</small></>}
            </>}
          {error && <Alert severity="error">{error} {checking && <button type="button" onClick={() => setAttempt(n=>n+1)}>{t('common.retry')}</button>}</Alert>}
          <button className="auth-submit" disabled={busy || checking}>{busy ? t('login.loggingIn') : mode === 'recovery' ? t('login.local.resolveRecovery') : t('login.login')}<ArrowRight size={17}/></button>
        </form>
        <button className="local-entry" disabled={busy} onClick={() => native('local')}><Monitor size={21}/><span><b>{zh ? '本机工具' : 'Local tools'}</b>
          <small>{zh ? '免登录打开图库、编辑器和本地推理' : 'Open your library, editor and inference tools offline'}</small></span><ArrowRight size={17}/></button>
      </div>
    </main>
  </div>;
}
