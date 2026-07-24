import 'dotenv/config';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

const clientId = req('YOTO_CLIENT_ID');
// A client secret is OPTIONAL. Yoto's recommended setup (and the louis editor) is
// a PUBLIC client using PKCE, which needs only the client id. A secret is used
// only if one is actually configured (i.e. a real value, not blank/placeholder,
// and not just the client id echoed back).
const rawSecret = (process.env.YOTO_CLIENT_SECRET ?? '').trim();
const clientSecret = rawSecret === 'REPLACE_ME' || rawSecret === clientId ? '' : rawSecret;
const authFlow: 'confidential' | 'public-pkce' = clientSecret ? 'confidential' : 'public-pkce';

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 8788),

  // Yoto OAuth (register at https://dashboard.yoto.dev). Public (PKCE) by default.
  clientId,
  clientSecret,
  authFlow,
  redirectUri: req('YOTO_REDIRECT_URI', 'http://127.0.0.1:8788/auth/callback'),
  scopes: req(
    'YOTO_SCOPES',
    'openid profile user:content:view user:content:manage user:icons:manage family:devices:view offline_access',
  ),

  authBase: req('YOTO_AUTH_BASE', 'https://login.yotoplay.com'),
  apiBase: req('YOTO_API_BASE', 'https://api.yotoplay.com'),
  // Auth0 audience: identifies the Yoto API as the token's target.
  audience: req('YOTO_AUDIENCE', 'https://api.yotoplay.com'),

  // where the SPA runs in dev (for post-login redirect); same-origin in prod
  appOrigin: process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173',

  sessionSecret: req('SESSION_SECRET', isProd ? undefined : 'dev-insecure-session-secret'),
  // 32-byte hex key encrypting refresh tokens at rest
  tokenEncKey: req('TOKEN_ENC_KEY', isProd ? undefined : '00'.repeat(32)),

  // token store: 'file' (dev default) or 'postgres'
  store: (process.env.TOKEN_STORE ?? (process.env.DATABASE_URL ? 'postgres' : 'file')) as
    | 'file'
    | 'postgres',
  databaseUrl: process.env.DATABASE_URL,
  dataDir: process.env.DATA_DIR ?? './.data',
};

export const authUrls = {
  authorize: `${config.authBase}/authorize`,
  token: `${config.authBase}/oauth/token`,
};
