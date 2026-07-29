import { AUTH_CONFIGURED, currentSession, clearSession, login } from './auth';

export interface MeResponse {
  authenticated: boolean;
  displayName?: string | null;
  /** signed-in account's Yoto userId (auth0|…); labels the "self" card group */
  userId?: string | null;
}

/** Session state, read straight from this browser's stored tokens. */
export function fetchMe(): MeResponse {
  if (!AUTH_CONFIGURED) return { authenticated: false };
  return currentSession();
}

/** Start the Yoto sign-in redirect. */
export const signIn = login;

export { AUTH_CONFIGURED };

/** Sign out = forget the tokens held in this browser. Nothing server-side. */
export function logout(): void {
  clearSession();
}
