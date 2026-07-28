import { useState } from 'react';
import { useStore } from '../store';
import { LOGIN_URL } from '../lib/api';
import { applyTheme, getTheme, nextTheme, type Theme } from '../lib/theme';
import { DeviceWidget } from './DeviceWidget';

/** Glyph per theme: sun (full white), half-disc (mixed), moon (full dark). */
function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'day')
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="4.2" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 2.5v2.6M12 18.9v2.6M4.2 4.2l1.9 1.9M17.9 17.9l1.9 1.9M2.5 12h2.6M18.9 12h2.6M4.2 19.8l1.9-1.9M17.9 6.1l1.9-1.9" />
        </g>
      </svg>
    );
  if (theme === 'dark')
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" fill="currentColor" />
      </svg>
    );
  // mixed: half-filled disc
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 3a9 9 0 010 18z" fill="currentColor" />
    </svg>
  );
}

const THEME_LABEL: Record<Theme, string> = {
  day: 'Theme: full white - click for mixed',
  mixed: 'Theme: mixed - click for full dark',
  dark: 'Theme: full dark - click for full white',
};

/** Filled heart glyph for the support link. */
function Heart() {
  return (
    <svg className="heart" width="11" height="11" viewBox="0 0 24 24" aria-label="love" role="img">
      <path
        fill="currentColor"
        d="M12 21s-7.5-4.9-10.2-9.3C.2 8.9 1.5 5.2 4.8 4.4c2-.5 3.9.4 5 2 .3.4.9.4 1.2 0 1.1-1.6 3-2.5 5-2 3.3.8 4.6 4.5 3 7.3C19.5 16.1 12 21 12 21z"
      />
    </svg>
  );
}

export function TopBar() {
  const authed = useStore((s) => s.authed);
  const displayName = useStore((s) => s.displayName);
  const loading = useStore((s) => s.loading);
  const signOut = useStore((s) => s.signOut);
  const [theme, setTheme] = useState<Theme>(getTheme);

  function toggleTheme() {
    const next = nextTheme(theme);
    setTheme(next);
    applyTheme(next);
  }

  return (
    <div className="topbar">
      <div className="brand">
        <span className="dot" />
        <b>yoto</b>
        <span>manager</span>
      </div>
      <div className="spacer" />
      {loading && <span className="who-loading">Loading your cards…</span>}
      {authed && <DeviceWidget />}
      <button className="theme-btn" onClick={toggleTheme} title={THEME_LABEL[theme]}>
        <ThemeIcon theme={theme} />
      </button>
      <a
        className="support-link"
        href="https://github.com/pg0/yoto-manager"
        target="_blank"
        rel="noopener noreferrer"
        title="Support this project"
      >
        <Heart /> support
      </a>
      {authed ? (
        <div
          className="who"
          title={displayName ? `Yoto account: ${displayName}` : 'Signed in to your Yoto account'}
        >
          <span className="who-dot" />
          Signed in
          <button className="btn ghost sm" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      ) : (
        <a className="btn primary sm" href={LOGIN_URL}>
          Sign in with Yoto
        </a>
      )}
    </div>
  );
}
