"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert, Box, Button, Container, Fade, Paper, TextField, Typography,
  alpha, useMediaQuery, useTheme,
} from '@mui/material';
import AccountCircleRoundedIcon from '@mui/icons-material/AccountCircleRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded';
import TextType from './ui/TextType/TextType';
import apiClient from '@/utils/ApiClient';
import { useI18n } from '@/i18n/I18nProvider';
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher';

export default function LoginPage() {
  const router = useRouter();
  const theme = useTheme();
  const { t } = useI18n();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mounted, setMounted] = useState(false);
  const backgroundImage = '/reference_img/3GGAQa90Mj6TbucNXrQPUUd1wdSMVaEJ.webp';
  const [loginMode, setLoginMode] = useState('token');
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [recoveryForm, setRecoveryForm] = useState({
    source_email: '', source_password: '', target_email: '', target_password: '',
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    apiClient.getAccountRecovery()
      .then((result) => setRecovery(result.active ? result : null))
      .catch(() => setRecovery(null));
  }, [mounted]);

  const handleSubmit = async () => {
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const result = loginMode === 'token'
        ? await apiClient.loginWithPersistentToken(token)
        : await apiClient.loginWithPassword(email, password);
      if (result.authenticated) router.replace('/main');
    } catch (requestError) {
      setError(requestError?.data?.message || requestError?.code || t('login.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };

  const handleResolveRecovery = async () => {
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const result = await apiClient.resolveAccountRecovery(recoveryForm);
      if (result.authenticated && result.status === 'completed') router.replace('/main');
    } catch (requestError) {
      setError(requestError?.data?.message || requestError?.code || t('login.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };

  const handleFormKeyDown = (event) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || loading) return;
    if (recovery) void handleResolveRecovery();
    else void handleSubmit();
  };

  if (!mounted) return null;

  const darkInputStyle = {
    mb: 2.5,
    '& .MuiOutlinedInput-root': {
      borderRadius: 2,
      color: '#fff',
      backgroundColor: alpha('#ffffff', 0.03),
      transition: 'all 0.3s ease',
      '& fieldset': { borderColor: alpha('#ffffff', 0.15) },
      '&:hover fieldset': { borderColor: alpha('#ffffff', 0.3) },
      '&.Mui-focused fieldset': { borderColor: '#7986CB', borderWidth: '1px' },
      '&.Mui-focused': { backgroundColor: alpha('#ffffff', 0.05) },
    },
    '& .MuiInputLabel-root': {
      color: alpha('#ffffff', 0.5),
      '&.Mui-focused': { color: '#7986CB' },
    },
    '& input:-webkit-autofill': {
      WebkitBoxShadow: '0 0 0 1000px #242526 inset !important',
      WebkitTextFillColor: '#fff !important',
    },
  };
  const primaryButtonStyle = {
    py: 1.5,
    borderRadius: 2,
    bgcolor: '#7986CB',
    color: '#ffffff',
    fontWeight: 600,
    fontSize: '1rem',
    textTransform: 'none',
    boxShadow: '0 4px 12px rgba(121, 134, 203, 0.3)',
    transition: 'all 0.3s ease',
    '&:hover': {
      bgcolor: '#5C6BC0',
      boxShadow: '0 6px 16px rgba(121, 134, 203, 0.4)',
      transform: 'translateY(-1px)',
    },
    '&:active': { transform: 'translateY(0)' },
    '&:disabled': { bgcolor: alpha('#7986CB', 0.5), color: alpha('#ffffff', 0.5) },
  };
  const languageSwitcherStyle = {
    bgcolor: alpha('#111827', 0.72),
    borderRadius: 2,
    backdropFilter: 'blur(10px)',
    '& .MuiSelect-select, & .MuiSvgIcon-root': { color: '#fff' },
    '& .MuiOutlinedInput-notchedOutline': { borderColor: alpha('#fff', 0.28) },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: alpha('#fff', 0.5) },
  };

  return (
    <Box sx={{
      minHeight: '100vh', background: `url(${backgroundImage})`, backgroundSize: 'cover',
      backgroundPosition: 'center', backgroundAttachment: 'fixed', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 2, position: 'relative',
    }}>
      <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
        <Fade in timeout={1000}>
          <Paper elevation={24} sx={{
            display: 'flex', flexDirection: 'row', width: '100%', maxWidth: 900,
            margin: '0 auto', minHeight: { xs: 'auto', md: 550 }, borderRadius: 4,
            overflow: 'hidden', background: '#1A1D21', boxShadow: '0 24px 48px rgba(0,0,0,0.6)',
            border: `1px solid ${alpha('#ffffff', 0.05)}`,
          }}>
            <Box sx={{
              display: { xs: 'none', md: 'block' }, width: '40%', background: `url(${backgroundImage})`,
              backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative',
            }} />
            <Box sx={{
              width: { xs: '100%', md: '60%' }, p: { xs: 2.5, sm: 4, md: 6 },
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
            }}>
              <Box sx={{ textAlign: 'center', mb: { xs: 2, md: 4 } }}>
                <Box component="img" src="/logo.png" alt={t('login.logoAlt')} sx={{
                  width: { xs: 48, md: 64 }, height: { xs: 48, md: 64 }, mb: { xs: 1, md: 2 },
                  mx: 'auto', display: 'block', objectFit: 'contain',
                }} />
                <Typography variant="h5" component="h1" sx={{
                  fontWeight: 700, color: '#ffffff', letterSpacing: 2, mb: { xs: 0.75, md: 1.5 },
                }}>
                  NOVELAI LOCAL
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, minHeight: 24 }}>
                  <TextType as={Typography} variant="body2" sx={{ color: alpha('#ffffff', 0.6), fontWeight: 400 }}
                    text={[t('login.tagline1'), t('login.tagline2'), t('login.tagline3')]}
                    typingSpeed={75} pauseDuration={1500} showCursor cursorCharacter="|" cursorBlinkDuration={0.5}
                  />
                </Box>
              </Box>

              <Box sx={{ width: '100%', maxWidth: 360, mx: 'auto' }}>
                {recovery ? (
                  <Fade in timeout={250}>
                    <Box>
                      <Alert severity="warning" variant="outlined" sx={{ mb: 2.5, borderRadius: 2 }}>
                        {t('login.local.recoveryRequired')}
                      </Alert>
                      <Typography variant="body2" sx={{ color: alpha('#ffffff', 0.6), mb: 2 }}>
                        {t('login.local.recoveryDescription')}
                      </Typography>
                      {[
                        ['source_email', 'login.local.oldEmail', 'email', MailOutlineRoundedIcon],
                        ['source_password', 'login.local.oldPassword', 'password', LockOutlinedIcon],
                        ['target_email', 'login.local.newEmail', 'email', MailOutlineRoundedIcon],
                        ['target_password', 'login.local.newPassword', 'password', LockOutlinedIcon],
                      ].map(([name, labelKey, type, Icon], index) => (
                        <TextField key={name} autoFocus={index === 0} fullWidth label={t(labelKey)} type={type}
                          value={recoveryForm[name]}
                          onChange={(event) => setRecoveryForm((current) => ({ ...current, [name]: event.target.value }))}
                          onKeyDown={handleFormKeyDown} disabled={loading}
                          InputProps={{ startAdornment: <Icon sx={{ mr: 1, color: alpha('#ffffff', 0.5) }} /> }}
                          sx={darkInputStyle}
                        />
                      ))}
                      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                      <Button fullWidth variant="contained" disabled={loading} onClick={handleResolveRecovery} sx={primaryButtonStyle}>
                        {loading ? t('login.loggingIn') : t('login.local.resolveRecovery')}
                      </Button>
                    </Box>
                  </Fade>
                ) : (
                  <Fade in key={loginMode} timeout={250}>
                    <Box>
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25, mb: 2.5 }}>
                        <Button fullWidth variant={loginMode === 'token' ? 'contained' : 'outlined'}
                          onClick={() => { setLoginMode('token'); setError(''); }} startIcon={<KeyRoundedIcon />}
                          sx={{ minHeight: 44, textTransform: 'none' }}>
                          {t('login.local.pat')}
                        </Button>
                        <Button fullWidth variant={loginMode === 'password' ? 'contained' : 'outlined'}
                          onClick={() => { setLoginMode('password'); setError(''); }} startIcon={<AccountCircleRoundedIcon />}
                          sx={{ minHeight: 44, textTransform: 'none' }}>
                          {t('login.local.emailPassword')}
                        </Button>
                      </Box>
                      {loginMode === 'token' ? (
                        <TextField autoFocus fullWidth label={t('login.local.pat')} type="password" autoComplete="off"
                          value={token} onChange={(event) => setToken(event.target.value)} onKeyDown={handleFormKeyDown}
                          disabled={loading} InputProps={{ startAdornment: <KeyRoundedIcon sx={{ mr: 1, color: alpha('#ffffff', 0.5) }} /> }}
                          sx={{ ...darkInputStyle, mb: { xs: 2, md: 4 } }}
                        />
                      ) : (
                        <>
                          <Alert severity="info" variant="outlined" sx={{ mb: 2.5, borderRadius: 2 }}>
                            {t('login.local.passwordCompatibilityNotice')}
                          </Alert>
                          <TextField autoFocus fullWidth label={t('login.local.email')} type="email" autoComplete="username"
                            value={email} onChange={(event) => setEmail(event.target.value)} onKeyDown={handleFormKeyDown}
                            disabled={loading} InputProps={{ startAdornment: <MailOutlineRoundedIcon sx={{ mr: 1, color: alpha('#ffffff', 0.5) }} /> }}
                            sx={darkInputStyle}
                          />
                          <TextField fullWidth label={t('login.password')} type="password" autoComplete="current-password"
                            value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={handleFormKeyDown}
                            disabled={loading} InputProps={{ startAdornment: <LockOutlinedIcon sx={{ mr: 1, color: alpha('#ffffff', 0.5) }} /> }}
                            sx={{ ...darkInputStyle, mb: { xs: 2, md: 4 } }}
                          />
                        </>
                      )}
                      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                      <Button fullWidth variant="contained" size="large"
                        disabled={loading || (loginMode === 'token' ? !token.trim() : !email.trim() || !password)}
                        onClick={handleSubmit} sx={primaryButtonStyle}>
                        {loading ? t('login.loggingIn') : t('login.login')}
                      </Button>
                    </Box>
                  </Fade>
                )}
              </Box>
              <Box sx={{ mt: { xs: 2.5, md: 5 }, display: { xs: 'flex', md: 'none' }, justifyContent: 'center' }}>
                <LanguageSwitcher sx={languageSwitcherStyle} />
              </Box>
            </Box>
          </Paper>
        </Fade>
      </Container>
      {!isMobile && (
        <Box sx={{ position: 'fixed', right: 20, bottom: 20, zIndex: 3 }}>
          <LanguageSwitcher sx={languageSwitcherStyle} />
        </Box>
      )}
    </Box>
  );
}
