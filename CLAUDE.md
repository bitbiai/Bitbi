# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## PERMANENT PROJECT RULES – ALWAYS FOLLOW THESE FIRST

- ALWAYS prioritize self-hosted content first.
- Never suggest or use external CDNs (Google Fonts, jsDelivr, cdnjs, unpkg, aframe.io, etc.) if self-hosting is technically possible.
- Always prefer local files (fonts in `fonts/`, JS libraries in `js/vendor/`, images in `assets/images/`, favicons in `assets/favicons/`).
- If a library like A-Frame, Three.js or any other asset is needed, instruct me to download and self-host it locally — never link to a CDN.
- Only use external sources when it is technically impossible to self-host (e.g. Resend API or payment providers).
- This rule overrides everything else and applies permanently to all future work on this project.

## Project Overview

Bitbi is a static portfolio website showcasing digital art and experimental web projects. Live at `https://bitbi.ai`, hosted on GitHub Pages with automatic deployment via GitHub Actions on push to `main`.

Source authoring still stays plain HTML/CSS/JS, but deploys now run repo-native validation/build steps for release compatibility and asset-version rewriting. There is still no framework/bundler migration and no linter. Playwright smoke tests run in CI (see [Testing](#testing)).

## Development

```bash
# Local dev server (port 3000)
npm run dev

# Auth worker (workers/auth/)
cd workers/auth && npx wrangler dev                                          # local dev
cd workers/auth && npx wrangler deploy                                       # deploy to Cloudflare
cd workers/auth && npx wrangler d1 migrations apply bitbi-auth-db --local    # run migrations locally
cd workers/auth && npx wrangler d1 migrations apply bitbi-auth-db --remote   # run migrations in prod

# AI worker (workers/ai/)
cd workers/ai && npx wrangler dev                                            # local dev
cd workers/ai && npx wrangler deploy                                         # deploy to Cloudflare

# Contact worker (workers/contact/)
cd workers/contact && npx wrangler dev                                       # local dev
cd workers/contact && npx wrangler deploy                                    # deploy to Cloudflare
```

### Testing

Playwright smoke tests in `tests/` validate page loads, navigation, asset integrity, and auth modal behavior against a local `serve` instance on port 3000.

```bash
npm test                    # run all tests (static smoke + worker contract tests)
npm run test:static         # run only static-site smoke tests
npm run test:workers        # run only worker route contract tests
npm run test:release-compat # run release gate validation tests
npm run test:asset-version  # run asset-version validation tests
npm run validate:release    # validate release compatibility against the repo state
npm run validate:asset-version # validate source asset-version placeholders/tokens
npm run build:static        # build deploy-ready static output into _site/
npm run test:headed         # run static tests with visible browser
npx playwright test -c playwright.config.js tests/smoke.spec.js       # run a single test file
npx playwright test -c playwright.config.js -g "hero section renders" # run a single test by name
```

**Static tests** (`playwright.config.js`): `tests/smoke.spec.js` (page loads, nav, assets, legal), `tests/auth-admin.spec.js` (auth modal, admin page), `tests/wallet-nav.spec.js` (wallet navigation), `tests/audio-player.spec.js` (global audio player). Chromium only, `baseURL: http://localhost:3000`, auto-starts `npx serve -l 3000`.

**Worker contract tests** (`playwright.workers.config.js`): `tests/workers.spec.js` validates auth worker route handlers against a mock D1/R2/AI harness (`tests/helpers/auth-worker-harness.js`) — no network, no Wrangler required. Tests run sequentially (`workers: 1`) with no webServer.

Contact worker secret: `RESEND_API_KEY` (set via `wrangler secret put RESEND_API_KEY` before first CLI deploy). Contact form uses a `website` honeypot field — if filled, the submission silently returns 200 but sends no email.

### Deployment

GitHub Actions (`.github/workflows/static.yml`) deploys to Pages on push to `main`. Copied to `_site/`: `index.html` (homepage), `robots.txt`, `sitemap.xml`, `assets/`, `css/`, `fonts/`, `js/`, `account/`, `admin/`, `legal/`. The `workers/` directory is **not** deployed to Pages.

**CI validates before deploy** (`.github/workflows/static.yml`). Two jobs run: `worker-validation` (worker contract tests) and `deploy` (static checks + smoke tests + Pages deploy). All checks must pass or the build fails:
1. **Worker route contract tests** — `npm run test:workers` runs auth worker handler tests against the mock harness (separate job, runs before deploy).
2. **JS import paths** — all `from '...'` imports in JS/HTML are resolved to files on disk. Broken imports fail the build.
3. **`target="_blank"` links** — every `target="_blank"` in HTML/JS (excluding `*.min.js`) must include `rel="noopener"` (or `noopener noreferrer`).
4. **Local CSS/JS references** — all `href="*.css"` and `src="*.js"` in HTML must point to existing files (external URLs excluded).
5. **Page metadata** — `index.html` must contain `<meta name="description">`, `<link rel="canonical">`, and `og:title`.
6. **Playwright smoke tests** — runs `npm run test:static` (Chromium) against a local `serve` instance. Validates page loads, navigation, static asset responses, auth modal, and admin page structure.

### Worker Deploy Order

When a change adds or depends on new D1 tables, apply remote migrations from `workers/auth/` before deploying the worker code that uses them.

1. `cd workers/auth && npx wrangler d1 migrations apply bitbi-auth-db --remote`
2. Deploy `workers/ai` before `workers/auth` whenever auth changes depend on the internal AI lab service binding.
3. Deploy `workers/auth` for auth/API/cron changes.
4. Deploy `workers/contact` after `0015_add_rate_limit_counters.sql` is present, because it shares `bitbi-auth-db` for durable contact abuse counters.
5. Pages deploy is separate; publishing the static site does not deploy `workers/`.

Current migration-to-worker dependencies:
- `0010_add_r2_cleanup_queue` — auth worker AI delete flows and scheduled R2 cleanup retries
- `0012_add_user_activity_log` — admin user-activity views and durable activity logging
- `0014_add_ai_daily_quota_usage` — `/api/ai/quota` and non-admin daily image quota enforcement
- `0015_add_rate_limit_counters` — remaining D1-backed limiter paths (avatar, favorites, admin, AI generation)
- `0016_add_ai_text_assets` — admin AI text-asset persistence and shared-folder save flows
- `0017_add_ai_image_derivatives` — saved-image derivative tracking, queue generation, and derivative backfill
- `0018_add_profile_avatar_state` — `/api/me` cached avatar-state hot path and avatar cache updates
- `0020_add_wallet_siwe` — wallet SIWE login/link/unlink routes
- `0023_add_text_asset_publication` / `0024_add_text_asset_poster` — text-asset publication and poster routes
- `0025_add_media_favorite_types` — favorites support for media item types beyond gallery-only
- `0026_add_cursor_pagination_support` — admin activity and cursor-based asset listing
- `0027_add_admin_mfa` — admin TOTP MFA enrollment/verification and recovery codes

Some paths degrade gracefully if a table is missing, but the intended production deploy path is still migrations first, then worker deploys.

### Worker Bindings

| Worker | Required bindings / secrets | Operational note |
|--------|-----------------------------|------------------|
| `workers/auth/` | D1 `DB`; AI `AI`; Cloudflare Images `IMAGES`; service binding `AI_LAB`; R2 `PRIVATE_MEDIA`, `USER_IMAGES`, `AUDIT_ARCHIVE`; Durable Object `PUBLIC_RATE_LIMITER`; Queues `ACTIVITY_INGEST_QUEUE`, `AI_IMAGE_DERIVATIVES_QUEUE`; secrets `SESSION_HASH_SECRET`, `PAGINATION_SIGNING_SECRET`, `ADMIN_MFA_ENCRYPTION_KEY`, `ADMIN_MFA_PROOF_SECRET`, `ADMIN_MFA_RECOVERY_HASH_SECRET`, `AI_SAVE_REFERENCE_SIGNING_SECRET`, legacy compatibility `SESSION_SECRET`, `AI_SERVICE_AUTH_SECRET`, `RESEND_API_KEY` | Daily cron cleans expired sessions/tokens, AI quota reservations, shared rate-limit counters, pending R2 cleanup jobs, and archives cold audit logs; `/api/admin/ai/*` proxies admin-only lab traffic into `workers/ai/`; admin access MFA-gated via TOTP |
| `workers/ai/` | AI `AI` | Internal service-only worker for admin AI experiments; deploy this before auth when changing the lab proxy flow |
| `workers/contact/` | Durable Object `PUBLIC_RATE_LIMITER`; secret `RESEND_API_KEY` | Uses worker-local Durable Object counters for public abuse-sensitive rate limiting (no longer depends on D1) |

### Post-Deploy Checks

- `https://bitbi.ai/api/health` returns HTTP 200 from the auth worker
- Auth routes backed by new schema return application JSON instead of `500`/`503` (`/api/admin/user-activity` for `0012`, `/api/ai/quota` for `0014`, AI delete/bulk-delete flows for `0010`)
- One real contact-form submission from `https://bitbi.ai` returns the expected `200`/`400`/`429` shape, and contact worker logs do not show durable limiter fallback after `0015`
- Admin AI proxy and worker contract checks still pass via `npm run validate:release` after any auth/AI route changes
- Pages deploy should be built from `npm run build:static` output so `__ASSET_VERSION__` placeholders are rewritten consistently

**Cloudflare Free plan constraint**: the single WAF rate-limiting rule slot is already used by the auth-domain rule documented in `docs/cloudflare-rate-limiting-wave1.md`, so `contact.bitbi.ai` depends on worker-side limiting rather than dashboard WAF protection.

### Release Management

A release compatibility system in `config/release-compat.json` declares the canonical deploy order, all worker bindings/secrets, queue/bucket/DO prerequisites, and auth route contracts. Tooling in `scripts/`:

```bash
npm run release:plan       # generate a deploy plan from release-compat.json
npm run release:preflight  # check prerequisites before deploying
npm run release:apply      # execute the deploy plan
npm run validate:release   # validate current repo state matches release-compat contracts
npm run test:release-compat # test the release compatibility validation itself
```

The release-compat config is the source of truth for deploy ordering and is checked in CI before every deploy. When adding new worker routes, bindings, or migrations, update `config/release-compat.json` accordingly.

## Architecture

### R2 Media Delivery

Two R2 buckets serve media — one public, one private:

| Bucket | Domain | Purpose |
|--------|--------|---------|
| Public | `https://pub.bitbi.ai` | Gallery images (thumb/preview/full), Sound Lab audio |
| Private (`PRIVATE_MEDIA`) | via `/api/*` auth worker routes | Exclusive gallery images, exclusive audio, avatars |

**Public R2 base URL** is defined as `const R2_PUBLIC_BASE = 'https://pub.bitbi.ai'` in each module that needs it (`js/shared/audio/audio-library.js`, `js/pages/profile/main.js`). Change it in both places if the domain changes.

**Public R2 key layout:**
- Gallery images: `gallery/[thumbs|previews|full]/ai-creations/{slug}-{width}.webp`
- Sound Lab audio: `audio/sound-lab/{track-name}.mp3`

**Private R2 key layout** (bucket `bitbi-private-media`, bound as `PRIVATE_MEDIA` in auth worker):
- Exclusive images: `images/Little_Monster/little-monster_NN.png` (full), `images/Little_Monster/thumbnails/little-monster_NN.webp` (thumbs)
- Exclusive audio: `audio/sound-lab/exclusive-track-01.mp3`
- Avatars: `avatars/{userId}`

Public content loads directly from `pub.bitbi.ai`. Private content routes through the auth worker (`/api/images/*`, `/api/thumbnails/*`, `/api/music/*`) which enforces authentication before proxying from R2.

### Pages
- `index.html` — Main landing page (particle effects, gallery, soundlab, auth-gated sections)
- `account/profile.html` — User profile page (avatar upload, account settings, requires auth)
- `account/image-studio.html` — AI image generation studio (prompt-to-image, folder management, requires auth)
- `account/wallet.html` — Ethereum wallet page (connect wallet, SIWE link/unlink, requires auth)
- `admin/index.html` — Admin dashboard (user management, requires admin role + MFA)
- `account/forgot-password.html`, `account/reset-password.html`, `account/verify-email.html` — Auth flow pages
- `legal/privacy.html`, `legal/datenschutz.html`, `legal/imprint.html` — Legal/GDPR pages

### JavaScript

Vanilla ES6 modules — no frameworks or bundlers.

**Module system**: `js/shared/` for reusable modules, `js/pages/<page>/main.js` as entry point per page (index, profile, admin, image-studio, wallet, forgot-password, reset-password, verify-email each have one). The dev server (`npm run dev`) is `npx serve` on port 3000 — plain static file serving, no hot reload.

**Shared `.mjs` contract modules**: Several `.mjs` files in `js/shared/` are imported by both frontend code and Cloudflare Workers — they must remain isomorphic (no DOM, no Node-only APIs). These include `public-media-contract.mjs` (public media URL builders), `admin-ai-contract.mjs` (AI model catalog shared between admin UI and workers), `worker-observability.mjs` (structured logging / correlation IDs), and `ai-image-models.mjs` (AI image model config). Workers import them via relative paths (e.g. `../../../../js/shared/...`).

**Shared modules** (`js/shared/`): Beyond auth, includes `gallery-data.js` (R2-backed gallery items with thumb/preview/full variants), `particles.js` (canvas particle effects), `binary-rain.js` (matrix-style rain), `binary-footer.js`, `scroll-reveal.js` (intersection observer animations), `focus-trap.js` (modal focus trapping), `cookie-consent.js` (GDPR banner), `make-tags.js` (DOM helpers), `format-time.js`, `navbar.js` (scroll handler + mobile toggle), `auth-nav.js` (sign-in/out button in desktop + mobile nav), `site-header.js` (injects full nav + mobile menu on subpages like profile, admin, legal), `favorites.js` (client-side favorites state + star button factory, API-backed), `studio-deck.js` (saved-images deck with touch-swipe and modal/lightbox for studio pages), `saved-assets-browser.js` (unified folder/asset browser with bulk operations used by image-studio and other studio pages), `models-overlay.js` (AI model catalog overlay panel), `soft-nav.js` (SPA-like soft navigation for legal pages — keeps audio player and auth alive across page transitions).

**Audio subsystem** (`js/shared/audio/`): Three-module global audio player — `audio-library.js` (track catalog + R2 URL builders), `audio-manager.js` (singleton `<audio>` element, state machine, global playback API), `audio-ui.js` (injects persistent player shell before `<main>` on all pages). The player survives soft-nav transitions. All pages import `initGlobalAudioUI()` from `audio-ui.js`.

**Wallet subsystem** (`js/shared/wallet/`): Ethereum wallet connection via SIWE (Sign-In with Ethereum). Modules: `wallet-config.js` (chain IDs, storage keys), `wallet-connectors.js` (MetaMask/WalletConnect detection), `wallet-state.js` (connection state machine), `wallet-controller.js` (orchestrates connect/disconnect + SIWE link/unlink via auth API), `wallet-ui.js` (connection modal rendering), `wallet-qr.js` (WalletConnect QR display), `wallet-workspace.js` (full wallet management page), `siwe-message.js` (SIWE message construction). Uses the `viem` npm package for address validation and SIWE message parsing (the only non-dev npm dependency).

**Index page modules** (`js/pages/index/`): `main.js` orchestrates initialization order. Sub-modules: `gallery.js`, `video-gallery.js`, `category-carousel.js`, `soundlab.js`, `contact.js`, `smooth-scroll.js`, `locked-sections.js`, `studio.js` (inline gallery studio — AI image generation embedded in the gallery section, lazy-initialized on Create mode activation). Note: `navbar.js` and `auth-nav.js` here are pure re-exports from `js/shared/` — this re-export pattern keeps index imports local while the real logic lives in shared modules.

**Auth client** (`js/shared/auth-api.js`, `auth-state.js`, `auth-modal.js`):
- `auth-state.js` dispatches `CustomEvent('bitbi:auth-change')` on login/logout — this is how all other modules react to auth changes
- `auth-modal.js` injects login/register forms only when the modal opens (not on page load) — this is intentional to prevent Safari autofill on page load. Do not "optimize" by pre-rendering the forms
- `auth-api.js` wraps all `/api/*` fetch calls with `credentials: 'include'`

**Index page initialization** (`js/pages/index/main.js`): Auth is started as a non-blocking promise, visual content (particles, binary rain, navbar) renders first, then `await authReady` gates the auth UI. This ordering is intentional for perceived performance.

**Locked sections** (`js/pages/index/locked-sections.js`): Injects auth-gated placements into the index page — a gallery filter button, an exclusive gallery folder (Little Monster, 15 images), and exclusive soundlab tracks. All listen to `'bitbi:auth-change'` and toggle `data-locked` attribute.

**Shared module defaults pattern**: `particles.js` and `binary-rain.js` define conservative default configs (e.g. `maxParticles: 35`, `maxCols: 16`). The index page overrides these with heavier settings via its `main.js` (e.g. `maxParticles: 100`, `maxCols: 30`). Subpages use the lighter defaults. Changing defaults only affects subpages; changing index overrides only affects the homepage.

**Soft navigation** (`js/shared/soft-nav.js`): Progressive-enhancement SPA-style transitions for a strict allowlist of internal pages (currently the three legal pages). Fetches the target page, swaps `<main>` content, and updates the URL via `history.pushState` — the shared shell (header, audio player, auth state, cookie banner) stays alive without a full reload.

### Gallery

**Data** (`js/shared/gallery-data.js`): Central source of truth for public gallery items. Currently empty — Mempics are fetched from `/api/gallery/mempics` (cursor-paginated, served by `workers/auth/src/routes/gallery.js`), and exclusive/private items (Little Monster) are injected separately by `locked-sections.js`.

**Rendering** (`js/pages/index/gallery.js`): Imports `galleryItems` from `gallery-data.js`. Grid cards load **only thumb** images with explicit `width`/`height` and `loading="lazy"`. Modal loads **only preview** images. Full images are opened in a new tab via `window.open()` only on explicit click of the top-left modal action button. The full-link button (`#modalFullLink`) is shown only for public items (those with `item.full.url`) and hidden for exclusive items.

**Categories**: Desktop filter bar has one button: Mempics. The Exclusive filter button is injected by `locked-sections.js` and is auth-gated. Default active category is Mempics (no "All" category).

**Modal controls**: Two absolutely-positioned buttons inside `.modal-card` — open-full link (`.modal-action--left`, top-left) and close button (`.modal-action--right`, top-right). Both use `.modal-action` base class in `css/components/components.css`.

### Sound Lab

**Public tracks** (`js/pages/index/soundlab.js`): 5 tracks served from `R2_PUBLIC_BASE + '/audio/sound-lab/{name}.mp3'`. Audio metadata is deferred via IntersectionObserver — `preload` starts as `'none'`, switches to `'metadata'` only when the Sound Lab section scrolls into view.

**Exclusive track**: Injected by `locked-sections.js`, served via `/api/music/exclusive-track-01` (auth-required, routed through auth worker to private R2).

### Image Studio

Two entry points for AI image generation — both use the same `js/shared/ai-image-models.mjs` model config and auth-worker AI endpoints:

- **Standalone page** (`account/image-studio.html`, `js/pages/image-studio/main.js`): Full-featured studio with folder management, bulk operations, saved-images deck. Requires auth, uses `css/account/image-studio.css`.
- **Inline gallery studio** (`js/pages/index/studio.js`): Embedded in the gallery section's Create mode. Lazy-initialized on first activation to avoid loading AI dependencies upfront. Uses `apiAiGenerateImage`, `apiAiGetQuota`, `apiAiGetFolders`, `apiAiSaveImage` from `auth-api.js`.

Both share `js/shared/studio-deck.js` for the saved-images lightbox/modal pattern.

### Favorites

`js/shared/favorites.js` provides client-side favorites state backed by `/api/favorites/*` endpoints. Star buttons are injected into gallery cards and soundlab tracks. Favorites state is loaded after auth via `loadFavorites()` (called from index `main.js`). The module listens to `'bitbi:auth-change'` to clear state on logout.

### CSS

- `@layer` cascade order: `tokens → reset → base → components → pages → utilities` — each layer maps to a file in `css/base/` or `css/components/`
- `css/base/` — `tokens.css` (design tokens, `@property`, oklch colors), `reset.css`, `base.css` (@font-face, gradients, glass, animations), `utilities.css`
- `css/components/` — `components.css`, `auth.css` (auth modal, locked-area overlays, auth flow page styles), `wallet.css` (wallet connection modal + wallet nav elements), `cookie-banner.css` (standalone, hardcoded values, no CSS variable dependencies — intentional so game pages don't need tokens.css)
- `css/pages/` — `index.css` (index page styles), `legal.css` (shared legal page styles)
- `css/account/` — `profile.css`, `image-studio.css`, `wallet.css` (wallet workspace page), `forgot-password.css`, `reset-password.css`
- `css/admin/` — `admin.css`
- Color palette: `--color-midnight`, `--color-navy`, `--color-cyan`, `--color-gold`, `--color-ember`, `--color-magenta`
- Typography: Playfair Display (display), Inter (body), JetBrains Mono (code)
- All fonts self-hosted as woff2 in `fonts/`

### Cloudflare Workers

Three workers, deployed separately from the static site:

| Worker | Endpoint | Purpose |
|--------|----------|---------|
| `workers/auth/src/index.js` | `bitbi.ai/api/*` | Auth API — D1, R2, cookie sessions, PBKDF2-SHA256, wallet SIWE, admin MFA. **Read `workers/auth/CLAUDE.md` before modifying** — it has full route docs, handler signatures, DB schema, and rate limits |
| `workers/ai/src/index.js` | internal service binding only | Admin-only AI lab worker — model routing, text/image/embedding/music/video experiments, and compare flows via `workers/auth` |
| `workers/contact/src/index.js` | `contact.bitbi.ai` | Contact form email via Resend API |

All workers are CORS-locked to `https://bitbi.ai`. Auth Worker security material is purpose-separated: `SESSION_HASH_SECRET`, `PAGINATION_SIGNING_SECRET`, `ADMIN_MFA_ENCRYPTION_KEY`, `ADMIN_MFA_PROOF_SECRET`, `ADMIN_MFA_RECOVERY_HASH_SECRET`, and `AI_SAVE_REFERENCE_SIGNING_SECRET`; keep legacy `SESSION_SECRET` only while `ALLOW_LEGACY_SECURITY_SECRET_FALLBACK` remains enabled.

## Key Conventions

- GDPR cookie consent uses timezone-based EU detection (no API calls)
- Legal pages follow German law requirements (§ 5 DDG, § 18 MStV)
- Auth error messages are in English
- Protected content (exclusive gallery images, exclusive audio) served from private R2 bucket via auth worker; public content (gallery items 100–108, Sound Lab tracks) served directly from `pub.bitbi.ai`
- Accessibility: all modals use `focus-trap.js`, keyboard navigation (Escape closes, arrow keys cycle), `prefers-reduced-motion` respected in particles and scroll animations, ARIA attributes on interactive elements
- Admin date formatting uses German locale (`Intl.DateTimeFormat('de-DE')`)
- `docs/` contains internal compliance/audit notes — not deployed, not user-facing
- **Cache busting**: Versioned CSS/JS references use the shared `__ASSET_VERSION__` placeholder in source. Do not hand-edit per-file query tokens; use `npm run validate:asset-version` to verify sources and `npm run build:static` to generate deploy-ready versions.
- **Subpage pattern**: Subpages (profile, admin, legal) start with a minimal nav shell, then `initSiteHeader()` from `js/shared/site-header.js` injects the full nav + mobile menu at runtime. All subpages load the same CSS cascade: `tokens → reset → base → components → auth → page-specific → utilities`

### Admin Deploy Checklist

- If the deploy changes admin AI API contracts, deploy worker changes before the static/admin assets.
- After deploy, hard refresh or purge cache and smoke-test:
  - `/admin/index.html#dashboard`
  - `/admin/index.html#ai-lab`
  - one AI Lab text or compare run
