import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { handleRedirectCallback } from './lib/auth';
import { useStore } from './store';
import { THEME_KEY } from './lib/theme';
import './styles.css';

// apply the saved theme before first paint so there's no flash
try {
  const t = localStorage.getItem(THEME_KEY);
  if (t === 'day' || t === 'dark') document.documentElement.dataset.theme = t;
} catch {
  /* ignore */
}

function mount(authError: string | null) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  if (authError) {
    console.warn('[auth]', authError);
    useStore.getState().showToast(`Sign-in failed: ${authError}`);
  }
}

// Finish the OAuth redirect (if this load is one) BEFORE the app mounts, so the
// store's init() already sees the fresh session. The helper strips code/state
// from the URL either way, and a failure just leaves the app signed out.
handleRedirectCallback().then(
  (r) => mount(r.status === 'error' ? r.message : null),
  (e: Error) => mount(e.message),
);
