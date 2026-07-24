import { authUrls, config } from './config.js';

/**
 * Yoto uses Auth0. This app supports both client types (auto-selected in config):
 *  - public-pkce (default, like the louis editor): no secret; the /authorize call
 *    sends an S256 code_challenge and the token exchange sends the code_verifier.
 *  - confidential: authenticates the token exchange with client_secret, no PKCE.
 * Refresh tokens are single-use and rotate on every refresh.
 */

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

/**
 * Build the /authorize URL. `state` is our CSRF nonce, echoed back to /callback.
 * In the public-pkce flow, pass the S256 code_challenge derived from the verifier.
 */
export function buildAuthorizeUrl(state: string, codeChallenge?: string): string {
  const params = new URLSearchParams({
    audience: config.audience,
    scope: config.scopes,
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
  });
  if (codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  return `${authUrls.authorize}?${params.toString()}`;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(authUrls.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Yoto token endpoint ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as TokenResponse;
}

/**
 * Exchange the authorization code for tokens. Confidential clients authenticate
 * with client_secret; public clients prove possession with the PKCE code_verifier.
 */
export function exchangeCode(code: string, codeVerifier?: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
  });
  if (config.authFlow === 'confidential') {
    body.set('client_secret', config.clientSecret);
  } else {
    if (!codeVerifier) throw new Error('Missing PKCE code_verifier for public-client exchange.');
    body.set('code_verifier', codeVerifier);
    body.set('audience', config.audience);
  }
  return tokenRequest(body);
}

/**
 * Rotate the (single-use) refresh token for a fresh access token.
 * Confidential clients include client_secret; audience keeps the token scoped
 * to the Yoto API. The response carries a NEW refresh_token that must replace
 * the old one in the store.
 */
export function refresh(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: refreshToken,
    audience: config.audience,
  });
  if (config.authFlow === 'confidential') body.set('client_secret', config.clientSecret);
  return tokenRequest(body);
}

/** Decode a JWT id_token payload without verifying (display name only). */
export function decodeIdToken(idToken?: string): { sub?: string; name?: string; email?: string } {
  if (!idToken) return {};
  try {
    const payload = idToken.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}
