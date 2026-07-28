import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { THEME_KEY } from './lib/theme';
import './styles.css';

// apply the saved theme before first paint so there's no flash
try {
  const t = localStorage.getItem(THEME_KEY);
  if (t === 'day' || t === 'dark') document.documentElement.dataset.theme = t;
} catch {
  /* ignore */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
