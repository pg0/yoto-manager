# yoto-manager

Public, multi-user batch editor for Yoto MYO card playlists. The official Yoto app is fine for casual edits but has no multi-select and no bulk anything; this is the power tool for it - fast reordering, mass rename, bulk icons, and MP3 upload, in a file-manager UI.

Any Yoto owner signs in with their own Yoto account (OAuth) and manages only their own cards. See [`docs/PRD.md`](docs/PRD.md) for the full requirements.

## Status

M0 in progress. **Backend removed in 0.3.0** - the app is now a pure static SPA that runs the OAuth flow in the browser and calls the Yoto API directly. The previous Node/Hono backend (token store + authenticated proxy) is preserved on the `server-backend` branch.

## Features (planned)

- Card/playlist management in a file-manager layout (left rail = cards, right pane = sortable, multi-select track table).
- Fast reorder: multi-select, move up/down/to-top, sort by name/number (artist constrained - see PRD).
- Bulk rename with live preview: auto-number and regexp find/replace.
- Bulk icon assignment from the Yoto library + custom uploads.
- MP3 upload. (No YouTube downloader - out of scope, ToS/legal.)

## Design direction

File-manager / explorer paradigm: left rail of cards, right pane a dense sortable table with a checkbox column and a toolbar that acts on the selection. Restrained (1-2 accent colors, low chrome) - deliberately the opposite of the maximalist `louis` tool. Details in the PRD (section 5a).

## Local-first model

Editing happens against a local draft in `localStorage` (instant, offline, resumable, undo/redo). A **Publish** button pushes the draft to Yoto (whole-object `POST /content`) as an explicit, deliberate step. Nothing leaves the browser except the calls to Yoto itself.

## Stack

Vite + React + TS SPA. **No backend, no database, no server-side state.** The build output is static files that can be dropped on any webspace; the browser runs the OAuth flow and talks to `api.yotoplay.com` directly (every endpoint this app uses answers `Access-Control-Allow-Origin: *`).

## Setup

1. Register a **public** client (PKCE) at https://dashboard.yoto.dev. Add every origin you serve the app from as an Allowed Callback URL **with a trailing slash** - `http://127.0.0.1:5173/` for dev, `https://your-domain/` for prod - plus the same values as Allowed Logout URLs (and Allowed Web Origins, if the field exists). Request scopes `user:content:manage user:icons:manage offline_access`.
2. `cp .env.example .env`, then set `VITE_YOTO_CLIENT_ID`. Everything else has working defaults.
3. `npm install`, then `npm run dev` → http://127.0.0.1:5173, and hit "Sign in with Yoto".

## Deploy

`npm run build` and upload `dist/` to any static webspace. Assets are referenced relatively, so a subfolder deploy works too - the callback URL is derived from wherever `index.html` actually sits. No Node, no Docker, no rewrite rules.

### OAuth notes

- **Public client with PKCE** (no secret). The client id is compiled into the bundle and is public by design - PKCE is what proves possession.
- Tokens live in this browser's `localStorage` (`src/lib/auth.ts`). Switch the `STORE` constant to `sessionStorage` to trade persistent sign-in for a smaller XSS blast radius.
- Refresh tokens are single-use and rotate on every refresh; one in-flight refresh at a time so a token is never spent twice.
- `yotoFetch()` attaches the bearer token and retries once on a 401 after forcing a rotation.
- Sign-out just clears this browser's storage - there is nothing server-side to delete.

### Known open item

Waveform rendering and the trim editor call `decodeAudioData`, which needs the **signed media URL** to send CORS headers. Plain playback (`<audio>`) works regardless. If that host turns out to be CORS-locked, those two features need a proxy - see the `server-backend` branch, which has one (`/api/media`).

## Notes

- Content is round-tripped as a whole object - publish reads the canonical card first and overlays only the user's edits, so `yoto:#` refs survive verbatim.
- Operated by a GmbH: an Impressum and privacy policy are still needed (the host sees access logs, and the app hands data to Yoto). But no user content or token is ever processed on our side, so there is nothing to store, encrypt or delete server-side.
- Yoto API guidelines prohibit training AI on API-provided content and scraping.
