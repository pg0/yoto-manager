# yoto-manager

Batch editor for Yoto MYO card playlists. The official Yoto app has no multi-select and no bulk anything - this is the power tool: fast reordering, mass rename, bulk icons and MP3 upload in a file-manager UI.

Sign in with your own Yoto account; you only ever see and edit your own cards.

**Use it at https://lda.io/yoto-manager/** - free, nothing to install.

## What it does

- Multi-select tracks and move them up, down or to the top - or sort by name or number.
- Bulk rename with live preview: auto-numbering and find & replace (regex works).
- Assign icons in bulk, from the Yoto icon library or your own uploads.
- Upload MP3s straight onto a card.
- See what your Yoto player is playing right now, and control it: play/pause, stop, volume, sleep timer, and send a playlist to the box.

## Local-first

All editing happens in a local draft in your browser - instant, offline-capable, with undo/redo. Your Yoto account only changes when you hit **Publish**. There is no backend: nothing leaves your browser except the calls to Yoto itself, and your login tokens stay in your browser's storage.

## Self-host / dev

Static SPA (Vite + React + TypeScript). The build output runs on any static webspace, subfolder included - no Node, no Docker, no rewrite rules.

1. Register a **public** client (PKCE) at https://dashboard.yoto.dev. Add every origin you serve the app from as an Allowed Callback URL **with a trailing slash** (`http://127.0.0.1:5173/` for dev), and the same values as Allowed Logout URLs and Allowed Web Origins. Scopes: `user:content:manage user:icons:manage family:devices:view family:devices:control offline_access` (the two device scopes power the player status and controls; drop them and everything else still works).
2. `cp .env.example .env` and set `VITE_YOTO_CLIENT_ID`. The client id is compiled into the bundle and public by design - PKCE is what proves possession, there is no secret.
3. `npm install`, then `npm run dev` - or `npm run build` and upload `dist/`.

Per Yoto's API guidelines: no AI training on API-provided content, no scraping.
