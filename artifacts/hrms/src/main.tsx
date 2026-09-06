import { createRoot } from 'react-dom/client';
import { initAuth } from '@/lib/auth';
import App from './App';
// Self-hosted Inter (OFL-1.1) — the only font origin is 'self', which is what the edge CSP allows.
import '@fontsource-variable/inter';
import './index.css';

// Wire the stored Bearer token into every API request before the app mounts.
// This must run before any React Query hook fires.
initAuth();

createRoot(document.getElementById('root')!).render(<App />);
