import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/i18n/I18nProvider';
import { AppThemeProvider } from '@/providers/AppThemeProvider';
import TutorialDemoWorkspace from './TutorialDemoWorkspace';
import '@/app/globals.css';

const topic = new URLSearchParams(window.location.search).get('topic');
createRoot(document.getElementById('root')).render(
  <LanguageProvider><AppThemeProvider><TutorialDemoWorkspace topic={topic} /></AppThemeProvider></LanguageProvider>,
);
