import { createRoot } from 'react-dom/client';
import { initAuth } from '@/lib/auth';
import { registerServiceWorker } from '@/lib/pwa';
import { initInstallPromptCapture } from '@/lib/pwa-install';
import App from './App';
// Self-hosted Inter (OFL-1.1) — the only font origin is 'self', which is what the edge CSP allows.
import '@fontsource-variable/inter';
import './index.css';

// Wire the stored Bearer token into every API request before the app mounts.
// This must run before any React Query hook fires.
initAuth();

// `beforeinstallprompt` can fire before React mounts; capture it now so the
// sidebar's "Install app" control can use it (see lib/pwa-install.ts).
initInstallPromptCapture();

createRoot(document.getElementById('root')!).render(<App />);

// Installability only — registers the shell service worker on secure origins.
// Never blocks startup and never caches authenticated data (see lib/pwa.ts).
registerServiceWorker();
