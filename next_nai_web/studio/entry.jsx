import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import AppProviders from '@/providers/AppProviders';
import { LOCALE_STORAGE_KEY } from '@/i18n/utils.mjs';
import SignIn from './SignIn';
import '@/app/globals.css';
import './studio.css';

const Studio = lazy(() => import('./Studio'));
const role = location.hash.slice(1);
if (!localStorage.getItem(LOCALE_STORAGE_KEY))
  localStorage.setItem(LOCALE_STORAGE_KEY, navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US');
createRoot(document.getElementById('root')).render(
  <AppProviders><Suspense fallback={null}>{role === 'auth' ? <SignIn /> : <Studio local={role === 'local'} />}</Suspense></AppProviders>
);
