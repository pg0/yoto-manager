import { useStore } from '../store';
import { LOGIN_URL } from '../lib/api';

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

  return (
    <div className="topbar">
      <div className="brand">
        <span className="dot" />
        <b>yoto</b>
        <span>manager</span>
      </div>
      <div className="spacer" />
      {loading && <span className="who-loading">Loading your cards…</span>}
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
