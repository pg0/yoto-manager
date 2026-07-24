export interface MeResponse {
  authenticated: boolean;
  displayName?: string | null;
  /** signed-in account's Yoto userId (auth0|…); labels the "self" card group */
  userId?: string | null;
}

/** Backend session state. Works in dev via the Vite proxy, same-origin in prod. */
export async function fetchMe(): Promise<MeResponse> {
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    if (!r.ok) return { authenticated: false };
    return (await r.json()) as MeResponse;
  } catch {
    // backend not running (pure-frontend dev) - stay in local/mock mode
    return { authenticated: false };
  }
}

export const LOGIN_URL = '/auth/login';

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
}
