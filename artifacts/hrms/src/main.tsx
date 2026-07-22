import { createRoot } from 'react-dom/client';
import { initAuth } from '@/lib/auth';
import App from './App';
import './index.css';

// Wire the stored Bearer token into every API request before the app mounts.
// This must run before any React Query hook fires.
initAuth();

createRoot(document.getElementById('root')!).render(<App />);
