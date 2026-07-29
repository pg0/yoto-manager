/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Yoto public (PKCE) client id - baked into the bundle at build time. */
  readonly VITE_YOTO_CLIENT_ID?: string;
  readonly VITE_YOTO_SCOPES?: string;
  readonly VITE_YOTO_AUTH_BASE?: string;
  readonly VITE_YOTO_API_BASE?: string;
  readonly VITE_YOTO_AUDIENCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
