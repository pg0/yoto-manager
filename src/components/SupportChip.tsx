import { useEffect, useState } from 'react';
import {
  readSupporterUrlKey,
  stripSupporterUrlKey,
  verifySupporterKey,
  type SupporterInfo,
} from '../lib/supporter';

const STORAGE_KEY = 'yotoManagerSupporterKey';

/** Filled heart glyph for the support chip. */
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

/**
 * Subtle "♥ Support" chip for the top bar. Verifies an offline-signed
 * supporter key client-side (see src/lib/supporter.ts) - no network calls, no
 * gated features. Unlocking just swaps the chip for a thanks badge.
 */
export function SupportChip() {
  const [info, setInfo] = useState<SupporterInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // On mount: a `?key=`/`#key=` URL param wins over a stored key, and on
  // success gets saved + stripped from the URL. Otherwise fall back to
  // whatever is already in localStorage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const urlKey = readSupporterUrlKey();
      if (urlKey) {
        const result = await verifySupporterKey(urlKey.key);
        if (cancelled) return;
        if (result.valid) {
          try {
            localStorage.setItem(STORAGE_KEY, urlKey.key);
          } catch {
            /* quota / private mode */
          }
          stripSupporterUrlKey(urlKey.fromHash);
          setInfo({ name: result.name!, date: result.date! });
          return;
        }
      }

      let stored: string | null = null;
      try {
        stored = localStorage.getItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      if (!stored) return;
      const result = await verifySupporterKey(stored);
      if (cancelled) return;
      if (result.valid) {
        setInfo({ name: result.name!, date: result.date! });
      } else {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function openModal() {
    setKeyInput('');
    setError(null);
    setOpen(true);
  }

  async function tryUnlock() {
    const key = keyInput.trim();
    if (!key) return;
    setChecking(true);
    const result = await verifySupporterKey(key);
    setChecking(false);
    if (!result.valid) {
      setError('That key did not verify - double-check it and try again.');
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      /* quota / private mode */
    }
    setInfo({ name: result.name!, date: result.date! });
    setOpen(false);
  }

  return (
    <>
      <button
        className={`support-link${info ? ' unlocked' : ''}`}
        onClick={openModal}
        title={info ? `Supporter since ${info.date}` : 'Support yoto-manager'}
      >
        <Heart /> {info ? `Thanks, ${info.name}` : 'Support'}
      </button>
      {open && (
        <div className="modal-back" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {info ? (
              <>
                <h3>Thanks, {info.name}</h3>
                <p>
                  Supporter since {info.date} - that keeps yoto-manager free for everyone.
                </p>
                <div className="modal-foot">
                  <button className="btn primary" onClick={() => setOpen(false)}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>Support yoto-manager</h3>
                <p>
                  yoto-manager is free. If it saves you time, you can support development at{' '}
                  <a
                    href="https://patrickgawron.com/support/yoto-manager"
                    target="_blank"
                    rel="noopener"
                  >
                    patrickgawron.com/support/yoto-manager
                  </a>
                  .
                </p>
                <div className="field">
                  <label htmlFor="supporter-key-input">Supporter key</label>
                  <input
                    id="supporter-key-input"
                    type="text"
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="PG1...."
                    value={keyInput}
                    onChange={(e) => {
                      setKeyInput(e.target.value);
                      setError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void tryUnlock();
                      }
                    }}
                  />
                  {error && <div className="field-error">{error}</div>}
                </div>
                <div className="modal-foot">
                  <button className="btn ghost" onClick={() => setOpen(false)}>
                    Close
                  </button>
                  <button
                    className="btn primary"
                    disabled={checking || !keyInput.trim()}
                    onClick={() => void tryUnlock()}
                  >
                    {checking ? 'Checking…' : 'Unlock'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
