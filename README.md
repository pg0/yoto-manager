# yoto-manager

Public, multi-user batch editor for Yoto MYO card playlists. The official Yoto app is fine for casual edits but has no multi-select and no bulk anything; this is the power tool for it - fast reordering, mass rename, bulk icons, and MP3 upload, in a file-manager UI.

Any Yoto owner signs in with their own Yoto account (OAuth) and manages only their own cards. See [`docs/PRD.md`](docs/PRD.md) for the full requirements.

## Status

M0 in progress. SPA runs on mock data with full local edit logic; OAuth backend is built (Yoto confidential-client flow, token store, authenticated proxy) and boots. Real icons/cover/publish light up once a Yoto dev app is registered (see Setup).

## Features (planned)

- Card/playlist management in a file-manager layout (left rail = cards, right pane = sortable, multi-select track table).
- Fast reorder: multi-select, move up/down/to-top, sort by name/number (artist constrained - see PRD).
- Bulk rename with live preview: auto-number and regexp find/replace.
- Bulk icon assignment from the Yoto library + custom uploads.
- MP3 upload. (No YouTube downloader - out of scope, ToS/legal.)

## Design direction

File-manager / explorer paradigm: left rail of cards, right pane a dense sortable table with a checkbox column and a toolbar that acts on the selection. Restrained (1-2 accent colors, low chrome) - deliberately the opposite of the maximalist `louis` tool. Details in the PRD (section 5a).

## Local-first model

Editing happens against a local draft in `localStorage` (instant, offline, resumable, undo/redo). A **Publish** button pushes the draft to Yoto (whole-object `POST /content`) as an explicit, deliberate step. The backend only owns tokens + proxy + upload + pre-publish snapshots.

## Stack

Vite + React + TS SPA, thin Node/Hono backend that owns each user's Yoto tokens (encrypted in Postgres) and proxies the API. One Docker image on odin behind Traefik + HTTPS. Architecture rationale in the PRD.

## Setup

1. Register a **public** client (PKCE) at https://dashboard.yoto.dev (separate dev + prod clients). Add `http://127.0.0.1:8788/auth/callback` as an Allowed Callback URL, `http://127.0.0.1:5173` as an Allowed Logout URL, and request scopes `user:content:manage user:icons:manage offline_access`.
2. `cp .env.example .env`, then set `YOTO_CLIENT_ID` (leave `YOTO_CLIENT_SECRET` blank - public clients have none; the rest have working defaults). Never commit `.env`.
3. `npm install`, then `npm run dev` - starts the SPA on :5173 and the backend on :8788 together.
4. Open http://127.0.0.1:5173, then sign in at http://127.0.0.1:8788/auth/login.

The backend uses a local encrypted file token store by default (`./.data/tokens.json`). Set `DATABASE_URL` (and `TOKEN_STORE=postgres`) to use Postgres in prod.

### OAuth notes

- Default is a **public client with PKCE** (no secret) - the flow the louis editor uses and Yoto's recommended setup. The backend auto-switches to the confidential flow (`client_secret`, no PKCE) only if `YOTO_CLIENT_SECRET` is set.
- Refresh tokens are single-use and rotate on every refresh - the store swaps in the new one under a per-user in-flight lock so a token is never spent twice.
- Refresh tokens are encrypted at rest (AES-256-GCM, `TOKEN_ENC_KEY`); the browser only ever holds a signed session cookie, never a Yoto token.
- The SPA calls the Yoto API only through the backend proxy at `/api/yoto/*`, which injects the bearer token and retries once on a 401 after forcing a refresh.

## Notes

- Content is round-tripped as a whole object - the backend snapshots each card's JSON before every publish (restore path).
- Operated by a GmbH: DSGVO applies (privacy policy, Impressum, data-deletion path). Tokens encrypted at rest, audio not persisted beyond the in-flight upload.
- Yoto API guidelines prohibit training AI on API-provided content and scraping.
