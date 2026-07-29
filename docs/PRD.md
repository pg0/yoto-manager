# yoto-manager - Product Requirements Document

- Status: Draft v0.2
- Date: 2026-07-24
- Owner: Patrick Gawron
- Model: public multi-user, local-first (localStorage draft to publish), file-manager UI
- Location: `C:\code\vibes\yoto-manager`
- Companion tool: `C:\code\vibes\yoto-icon` (image to 16x16 Yoto icon)

## 1. Summary

yoto-manager is a **public, multi-user** web app for power-editing Yoto MYO ("Make Your Own") card playlists. The official Yoto app is fine for casual edits but painful for bulk work: reordering many tracks, mass-renaming, applying icons across many songs, and adding audio. yoto-manager is the batch-editor the official app is not.

Any Yoto owner signs in with their own Yoto account via OAuth and manages only their own cards. It is hosted on a public domain, verified as a Yoto app (to drop the consent warning), and open to third parties. This makes data handling, privacy, and rate limits first-class concerns from day one.

## 2. Goals / non-goals

**Goals**
- Fast, keyboard-and-mouse-friendly bulk editing of a card's tracks and chapters.
- Safe round-tripping of card content (no data loss on kids' cards).
- Add audio from local MP3 files.
- Bulk icon assignment from the Yoto icon library and custom uploads.

**Non-goals (v1)**
- **No YouTube-URL download/convert** - out of scope. Server-side downloading YouTube audio on behalf of many users is a ToS and legal exposure a public, GmbH-operated service should not carry. Not planned.
- No cross-account features (sharing playlists between users, teams) - each user sees only their own cards.
- No player/device control (MQTT, remote playback) - out of scope.
- No podcast/RSS or streaming-track authoring UI (the API supports it; not a v1 feature).
- No mobile-native app. Responsive web is enough.

## 3. Users

Any Yoto account owner (parents, mainly). Each user signs in with their own Yoto account through OAuth; the app never sees a Yoto password. A user only ever sees and edits their own MYO cards. There is **no separate app account** - identity is the authenticated Yoto user (their Yoto user id is the primary key). No app-level password, no LAN-trust; access control is the OAuth session.

Operated by Red Coral Studios GmbH, so DSGVO applies: privacy policy, Impressum, a data-deletion path, and honoring Yoto's guideline "don't retain user data beyond what's necessary."

## 4. Platform constraints (from the Yoto API)

Grounded in yoto.dev docs, confirmed 2026-07-24. These shape the architecture and must not be contradicted.

- **Auth:** OAuth2 Authorization-Code + PKCE against Auth0 (`login.yotoplay.com`). Confidential client (ID + secret from `dashboard.yoto.dev`). Refresh tokens are **single-use** - each refresh issues a new one that must be persisted atomically, **per user**. Scopes: `user:content:manage user:icons:manage offline_access` (add `family:library:view` if needed).
- **App verification (required for public):** unverified apps show every user a consent-screen warning that exposes the dev email. A public app must be submitted at `yoto.dev/verify` to remove the warning, hide the dev email, and get a hub listing. Verification **locks scopes** - later scope changes need re-review, so settle the scope set before submitting.
- **Content model:**
  - `GET /content/mine` lists cards but **omits chapters** (payload size). List view must not N+1 the whole library for track detail.
  - `GET /content/{cardId}` returns the full `card.content.chapters[]`.
  - `POST /content` creates/updates. Pass `cardId` to overwrite; the **entire content object is round-tripped** - there is no per-item PATCH or reorder endpoint.
  - `DELETE /content/{cardId}` (MYO cards only).
- **Ordering is implicit array order** of `chapters[]` and `tracks[]`. `overlayLabel` is a display-only number badge, not order. Reorder = mutate arrays client-side, POST whole object back.
- **Track fields:** `key`, `title`, `trackUrl` (`yoto:#<sha256>` or https), `type` (audio|stream), `format`, `duration`, `fileSize`, `uid`, `display.icon16x16` (`yoto:#<43char base64url>`). **No per-track artist field** - author lives at card-level `metadata.author`/`authors`.
- **Icons:** `GET /media/displayIcons/user/yoto` (public library, no server-side search - filter client-side), `GET /media/displayIcons/user/me` (my icons), `POST /media/displayIcons/user/me/upload` (multipart, `autoConvert`). Reference as `yoto:#<mediaId>`.
- **MP3 upload flow:** (1) `GET /media/transcode/audio/uploadUrl?sha256=&filename=` returns a signed `uploadUrl` (or null on dedup hit), (2) `PUT` bytes to `uploadUrl`, (3) poll `GET /media/upload/{uploadId}/transcoded` until `transcodedSha256`, (4) set `track.trackUrl = yoto:#<transcodedSha256>`, (5) `POST /content`.
- **API guidelines:** no scraping, **no training AI on API content**, no published numeric rate limit (build own backoff). With many users behind one client, a shared limit is a real risk - see risk 3.

## 5. Architecture

**Decision: Vite + React + TypeScript SPA + a Node/TS backend (Hono or Fastify), one Docker image, deployed on odin behind Traefik with a real domain + HTTPS.** No Next.js / meta-framework - the app is a JSON editor with an upload runner attached; SSR/SEO add nothing.

The single load-bearing decision: **the backend owns every user's Yoto tokens and proxies every Yoto API call** (`/api/yoto/*`). Rationale:
- Single-use refresh tokens + browser = multi-tab race and token loss. One backend owner serializes refresh **per user** behind a mutex and persists the new token atomically.
- The client secret and the MP3 upload pipeline (sha256, signed-URL PUT, transcode polling) require a backend regardless.
- No CORS questions (incl. the signed-upload PUT).
- Tokens never reach the browser - critical for a public service.

**Sessions:** on OAuth callback the backend mints its own session (httpOnly, secure, SameSite cookie or short-lived JWT) keyed to the Yoto user id. The browser holds only the session, never Yoto tokens. Every `/api/yoto/*` call resolves the session to that user's token server-side.

**Local-first edit model (Patrick's call):** editing happens entirely against a **local draft in `localStorage`**, never live against Yoto. Flow:
1. Open a card: fetch full card JSON once, store it as the draft in `localStorage` (keyed by user + cardId), plus a hash of the pristine server version.
2. All reorder/rename/icon/upload ops mutate the local draft only. No network on any edit. Undo/redo is free (snapshot the draft per op - it is small). Work survives reload and is resumable.
3. **Publish** button pushes the draft to Yoto via the backend (whole-object `POST /content`). Before publish, refetch + hash-compare against the pristine version to catch external edits (see risk 4). On success, the draft is reconciled to the new server state.
4. A visible **dirty/unpublished** indicator and a **discard draft / reload from Yoto** action.

This keeps the UI instant, makes the risky whole-object write an explicit, deliberate step, and shrinks server state (the browser holds the working copy; the backend only owns tokens + proxy + upload + pre-publish snapshots).

**Token store:** a real database (Postgres - Patrick already self-hosts one), one row per user keyed by Yoto user id, **refresh tokens encrypted at rest** (app-held key from env, not plaintext in the DB). Register **separate dev and prod OAuth clients** so dev never burns prod's single-use refresh token.

**Jobs (MP3 upload):** in-process job map + SSE or polling for progress. No Redis / BullMQ / queue for v1; revisit if concurrency grows. ffmpeg (if needed for format normalization) via `execa`, baked into the image.

```
Browser SPA  ──cookie/JWT──►  Node backend  ──per-user token──►  api.yotoplay.com
 ├─ localStorage draft         (token owner,                       login.yotoplay.com
 │  (working copy + undo)        proxy, sessions,
 └─ Publish button ────────►     upload jobs)
                               ├─ Postgres: users + encrypted tokens
                               ├─ ffmpeg (execa, optional)
                               └─ pre-publish JSON snapshots (per user)
```

## 5a. UI / UX design direction

**Layout: a file-manager / explorer paradigm, not the official Yoto single-scroll editor and not louis's multi-panel toy.** Reference: a classic two-pane file manager (artgris FileManagerBundle style) - left rail of "folders", right pane a dense, selectable, sortable table with a toolbar acting on the selection.

**Concrete layout**
- **Left rail:** the user's cards/playlists as the "folder" list (name + track count + small cover). Click to open a card in the right pane. This replaces the official app's giant cover block.
- **Right pane = the track table**, the heart of the app:
  - **Checkbox column** for multi-select (shift-range, ctrl-toggle, header "select all"). This is the single most important element - every bulk action keys off it. The official Yoto editor has no multi-select at all; that is the whole reason this tool exists.
  - Columns: `#` (order), icon (16x16 thumbnail), Title, Duration, Size. **Sortable column headers** (click to sort ASC/DESC) - directly serves "sort by name/number".
  - **Toolbar above the table**, operating on the current selection: Move up / down / to top / to bottom, Rename (auto-number / regex), Set icon, Delete, Upload. Buttons enable/disable based on whether a selection exists.
  - **Search box** to filter tracks within the card.
  - **List/grid toggle** (grid = icon-forward view for icon work).
  - **Publish button** + dirty indicator in the header (see local-first model).

**Visual language - deliberately the opposite of louis**
- **1-2 accent colors max** on a neutral (white/gray) base. louis runs ~21 brand hues, one per panel; that is the "bunt/unübersichtlich" Patrick called out. Use a single accent for primary actions (Publish, selection highlight) and semantic colors only for destructive/warn.
- **Low chrome.** No thick borders + offset drop-shadows + rotation + wobble on every element (louis's "comic sticker" treatment). Flat rows, subtle dividers, hover states. Density over decoration - a 75-track card (Patrick's Sharky example) must be scannable.
- **Progressive disclosure.** One focused pane at a time (card list to track table), not three competing panels. Track options / metadata behind a panel or drawer, not always-on.
- **Calm, no noise.** No per-hover sound effects, no constant motion. Fast keyboard-driven selection and reordering.
- **Responsive** but desktop-first - bulk editing a long track list is a mouse-and-keyboard task.

**Explicitly avoid** (from the two disliked references):
- Official Yoto editor: single long scroll, no multi-select, one-drag-at-a-time reordering, everything one card at a time.
- louis: 3 always-on colored panels, maximalist kids'-toy palette, heavy borders/shadows/wobble, always-on secondary UI (capacity meters, status dots, audio scrubbers, sounds).

## 5b. Prior art / competitive positioning

- **Official Yoto app/site** (Patrick's screenshots): the baseline. Solid for casual, single-card, one-edit-at-a-time work. Gaps yoto-manager fills: multi-select, bulk move/rename/icon, sortable columns, regex rename, local draft + explicit publish.
- **louis** (`github.com/stuartromanek/louis`, MIT, Nuxt 4 + Vue 3 + Tailwind v4): a **YouTube to Yoto pipeline**, not a library manager. Has drag-reorder and capacity gating; has **no** bulk rename, **no** bulk icons, **no** local-MP3 upload (YouTube-only). So yoto-manager's bulk-editing + MP3 angle is genuine whitespace against it.
  - **Worth borrowing (MIT-licensed):** its **diff-before-whole-object-POST** pattern - classify each track as unchanged/reused/new so unchanged tracks are never re-uploaded, only the whole object is still POSTed. Also its Yoto capacity limits (100 tracks/card, 60min & 100MB/track, 5h & 500MB/card) and its human-remapping of Yoto's opaque capacity error messages.
  - **Not borrowing:** its React-less Vue stack (we're React), and emphatically not its visual language (see 5a).

## 6. Feature requirements

### F1 - Card / playlist management
- List all MYO cards (`/content/mine`): title, cover, track count where cheaply available. Lazy-load chapters only when a card is opened.
- Open a card: read full content, render chapters and tracks in play order.
- Read-only detail view is the M0 deliverable; edit is F2+.
- Delete card (MYO only) behind a confirm, low priority.

### F2 - Fast reordering (core value)
All operations are local array mutations, applied to the in-memory content object, committed to the local draft; pushed to Yoto on **Publish**.
- Multi-select tracks (shift-range, ctrl-toggle, select-all).
- Move selected up / down (preserving relative order within the selection).
- Move selected to top (and to bottom).
- Sort tracks by:
  - **Name** (title) ASC/DESC - full support.
  - **Number** - natural-sort by leading digits in the title (define explicitly; array order is the real number). ASC/DESC.
  - **Artist** ASC/DESC - **constrained**: no per-track artist field exists. Offer only via an optional `Artist - Title` title-parse toggle, or drop from MVP. See section 8.
- Buttons are the primary reorder UX. Drag-and-drop is phase-2 garnish.

### F3 - Bulk rename
- Select multiple tracks, apply a rename operation with **live before/after preview** (a table) before commit.
- **Auto-number:** apply a pattern like `{n}. {title}` or `{n} - {title}`, with configurable start, zero-pad width, and step. Auto-number should also set `overlayLabel` so the app's number badge matches the title.
- **Regexp rename:** find/replace with a JS regex (capture groups in replacement). Invalid regex is caught and shown in the preview, never applied blind.

### F4 - Bulk icons
- Icon picker fetches the public library (`/user/yoto`) and my icons (`/user/me`) once, caches in IndexedDB (public library is large), filters client-side by `title`/`publicTags`.
- Select multiple tracks, assign one icon to all (`display.icon16x16 = yoto:#<mediaId>`), local mutation, committed on Publish.
- Upload a custom icon (`POST .../user/me/upload`, multipart, `autoConvert`); appears in "my icons".
- Later: pipe `yoto-icon`'s pixelate/median-cut output straight into the upload endpoint instead of it being a separate tool.

### F5 - Audio ingest (MP3 upload)
- Pick one or more local MP3s. Backend runs sha256 to get the upload URL (dedup-aware), PUTs bytes, polls transcode, returns `transcodedSha256`. Each file becomes a new chapter+track (Yoto convention: one file = one chapter with one track) appended to the open card; title defaults to filename, editable. Progress UI per file.
- Uploaded bytes are processed and forwarded to Yoto, not persisted server-side beyond the in-flight job (privacy - see section 9).
- (YouTube-URL ingest is out of scope - see section 2 non-goals.)

### F6 - Player ("yotobox") manager

Patrick's refined ask: **primary = show whether a card/its songs are synced (downloaded) to the device**; remote **control is backlog/todo**, not v1.

**Hard API limitation (verified 2026-07-24, yoto.dev):** there is **no per-card "downloaded/synced" flag** and no on-device content inventory in the public API. On-device storage is opaque - no "offline cards" / "device library" / "cached content" endpoint on REST or MQTT. So a definitive "this card is on the box" cannot be read from the API. Do not present a hard synced/not-synced state as truth.

**Best-effort sync status we CAN build** from real signals, clearly labelled as inferred:
- `isBackgroundDownloadActive` (MQTT `/data/status`) - device is downloading *now* → show "syncing…".
- `freeDisk` / `totalDisk` bytes - a used-space bar (proxy for "content is loaded"), not an inventory.
- `online` + last-seen - a device that has never been online since a card's last publish cannot have synced it.
- **Our own publish log** - yoto-manager knows when the user published each card. Combine "published at T" + "device was online & background-download ran after T" → an inferred badge: `Awaiting device` → `Likely synced` (with an explicit "inferred, not confirmed by Yoto" tooltip). This is the most honest signal we can give and it directly answers "did my change reach the box yet?".

**Also buildable** (documented):
- **List players:** `GET /device-v2/devices/mine` (`family:devices:view`) - deviceId, name, online, type.
- **Live status:** MQTT over AWS IoT (`wss://…iot.eu-west-2.amazonaws.com/mqtt`, JWT auth, scope `family:devices:control`) - `/device/{id}/data/status` (battery, charging, freeDisk, volume, activeCard, playingStatus, wifi) and `/device/{id}/data/events` (now-playing). REST status endpoint deprecated. Connection idles ~5 min - re-request every ~4m55s.
- **Config:** `GET/PUT /device-v2/{id}/config` (`family:devices:manage`).
- **Remote control (BACKLOG):** `POST /device-v2/{id}/command/*` / MQTT commands (`family:devices:control`) - play/pause/stop, volume, ambient LED, sleep timer, reboot.

**Depends on backend + OAuth + device scopes + MQTT**, so F6 lands after M0/M1 (device data cannot be mocked usefully). Adds `family:devices:view` (+ `control` only for live status/backlog control) to the scope set - settle before verification (scopes lock).

## 7. Build sequencing / milestones

- **M0 - auth + read:** per-user OAuth flow, session cookie/JWT, encrypted per-user token store + refresh mutex, `/api/yoto/*` proxy, card list, read-only card detail. Validates every API assumption first. Test with Patrick's own Yoto account before opening up.
- **M1 - write path (MVP core):** local edit state, multi-select, move ops, sort, plain bulk rename + auto-number, **Save** (whole-object POST). Test the round-trip against a **throwaway test card** before anything else in M1 - it is the single riskiest call.
- **M2 - icons:** picker, bulk assign, custom-icon upload.
- **M3 - MP3 upload.**
- **M4 - public launch hardening:** Yoto app verification (`yoto.dev/verify`), privacy policy + Impressum + data-deletion, per-user rate-limit/backoff, error monitoring, abuse basics. Must land before opening to third parties.
- **M5 - player (yotobox) manager (F6):** device list + live status (MQTT), best-effort per-card sync badge (published-vs-online/background-download heuristic, labelled inferred). Remote control is backlog within this milestone. Depends on OAuth + device scopes.
- **Phase 2:** regexp rename, undo/redo polish, drag-and-drop, cross-card track moves, delete-card, remote device control.

**Private MVP = M0 + M1** (Patrick's own account). **Public MVP = through M4.** Reordering and renaming are the real pain points and carry the daily-use value.

## 8. Constraints the API imposes on the feature list

- **Sort by artist - not real as specced.** No per-track artist field; author is card-level (constant within a card). Ship only as an optional `Artist - Title` title-parse, or drop from MVP. Documented, not silently broken.
- **Sort by number - needs a definition.** No numeric order field; `overlayLabel` is a display string, often empty. Implement as natural-sort on leading digits in the title, or cut it. Sort-by-name covers ~90%.
- **No server-side icon search** - picker pulls the full public library and filters client-side; cache and refresh rarely.
- **No etag/version on content** - concurrent edits (Yoto app editing the same card) can be clobbered silently. Mitigation in section 9.
- **Capacity limits** (from louis's field-tested constants, verify against live API): 100 tracks/card, 60 min & 100 MB per track, 5 h & 500 MB per card. Validate in the draft before Publish and show a capacity meter, so a publish never fails on an over-limit card. Yoto's own over-limit error messages are opaque - remap them to human text.

## 9. Risks and mitigations

1. **Whole-object POST fidelity = data-loss on OTHER PEOPLE'S kids' cards.** Highest-severity risk now that it is multi-user - a bad save corrupts a stranger's card. Never rebuild the content object from an internal model - mutate the fetched JSON in place, round-trip every unknown field untouched. Backend writes a timestamped snapshot of the card JSON (per user) before every Save (restore path). **Non-negotiable in M1.**
2. **Single-use refresh token lifecycle, per user.** Crash between refresh and persist = that user forced to re-login; concurrent refreshes for one user = silent lockout. Mitigate: **per-user** refresh mutex + persist-before-use, tokens encrypted at rest, separate dev/prod clients, and a visible "re-auth needed" UI state instead of mystery 401s.
3. **Shared rate limit + one client for all users.** No published limit, but every user's traffic funnels through one Yoto client - one heavy user could throttle everyone. Mitigate: per-user request budgeting, backoff/retry with jitter, cache the icon library server-side and share it across users, avoid N+1 on the card list. Monitor for 429s.
4. **Concurrent-edit clobbering.** Refetch + hash-compare right before POST; warn on mismatch. Combined with pre-save snapshots, de-risked.
5. **Handling other people's data (DSGVO).** Storing per-user tokens + touching children's-content metadata. Mitigate: encrypt tokens at rest, don't persist audio beyond the in-flight upload, minimal retention, clear privacy policy + Impressum + self-serve data deletion (revoke + purge tokens/snapshots), and honor Yoto's "no AI training on content" / "don't retain beyond necessary" rules. Loop in Codie (GmbH/legal) before public launch.

## 10. Tech stack summary

| Layer | Choice |
|---|---|
| Frontend | Vite + React + TypeScript |
| Client state | zustand (or reducer) + undo snapshot stack |
| Icon cache | IndexedDB |
| Backend | Node 22 + Hono (or Fastify), TypeScript |
| Auth/session | per-user OAuth (auth-code+PKCE); httpOnly cookie or short JWT |
| Yoto access | backend proxy, `/api/yoto/*`, per-user token-owning |
| Token store | Postgres, one row/user, refresh tokens encrypted at rest |
| Jobs | in-process map + SSE/polling; `execa` for ffmpeg (optional) |
| Deploy | single Docker image on odin; Traefik + real domain + HTTPS |

## 11. Open questions

- One-file-per-chapter vs. multiple tracks per chapter as the default ingest layout? (Recommend chapter-per-file.)
- Include `family:library:view` scope for read-only view of purchased cards, or MYO-only? (Settle before verification - scopes lock.)
- Undo/redo depth and whether snapshots persist across reload.
- Ship regexp rename in MVP or phase 2? (Currently phase 2.)
- Domain / branding (own domain vs. subdomain of an existing property).
- Free for all vs. any limits? (Rate-limit blast radius, section 9 risk 3.)

## Appendix - key endpoints

| Purpose | Method + path |
|---|---|
| Authorize | `GET login.yotoplay.com/authorize` |
| Token | `POST login.yotoplay.com/oauth/token` |
| List cards | `GET api.yotoplay.com/content/mine` |
| Get card | `GET api.yotoplay.com/content/{cardId}` |
| Create/update card | `POST api.yotoplay.com/content` |
| Delete card | `DELETE api.yotoplay.com/content/{cardId}` |
| Public icons | `GET api.yotoplay.com/media/displayIcons/user/yoto` |
| My icons | `GET api.yotoplay.com/media/displayIcons/user/me` |
| Upload icon | `POST api.yotoplay.com/media/displayIcons/user/me/upload` |
| Get upload URL | `GET api.yotoplay.com/media/transcode/audio/uploadUrl?sha256=&filename=` |
| Poll transcode | `GET api.yotoplay.com/media/upload/{uploadId}/transcoded` |

Official examples (no official SDK, raw REST + OAuth): `github.com/yotoplay/examples` (react, next.js, node.js, vanilla-js-html).
