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

**No build step.** All development is direct HTML/CSS/JS. No linter. Playwright smoke tests run in CI (see [Testing](#testing)).

## Development

```bash
# Local dev server (port 3000)
npm run dev

# Auth worker (workers/auth/)
cd workers/auth && npx wrangler dev                                          # local dev
cd workers/auth && npx wrangler deploy                                       # deploy to Cloudflare
cd workers/auth && npx wrangler d1 migrations apply bitbi-auth-db --local    # run migrations locally
cd workers/auth && npx wrangler d1 migrations apply bitbi-auth-db --remote   # run migrations in prod

# Contact worker (workers/contact/)
cd workers/contact && npx wrangler dev                                       # local dev
cd workers/contact && npx wrangler deploy                                    # deploy to Cloudflare

# Crypto worker (workers/crypto/)
cd workers/crypto && npx wrangler dev                                        # local dev
cd workers/crypto && npx wrangler deploy                                     # deploy to Cloudflare
```

### Testing

Playwright smoke tests in `tests/` validate page loads, navigation, asset integrity, and auth modal behavior against a local `serve` instance on port 3000.

```bash
npm test                    # run all smoke tests (headless Chromium, auto-starts serve)
npm run test:headed         # run with visible browser
npx playwright test tests/smoke.spec.js             # run a single test file
npx playwright test -g "hero section renders"        # run a single test by name
```

Test files: `tests/smoke.spec.js` (page loads, nav, assets, legal, experiments), `tests/auth-admin.spec.js` (auth modal, admin page). Config: `playwright.config.js` (Chromium only, `baseURL: http://localhost:3000`, auto-starts `npx serve -l 3000`).

Contact worker secret: `RESEND_API_KEY` (set via `wrangler secret put RESEND_API_KEY` before first CLI deploy). Contact form uses a `website` honeypot field — if filled, the submission silently returns 200 but sends no email.

### Deployment

GitHub Actions (`.github/workflows/static.yml`) deploys to Pages on push to `main`. Copied to `_site/`: `index.html` (homepage), `robots.txt`, `sitemap.xml`, `assets/`, `css/`, `fonts/`, `js/`, `experiments/`, `account/`, `admin/`, `legal/`. The `workers/` directory is **not** deployed to Pages.

**CI validates before deploy** (`.github/workflows/static.yml`). All five checks must pass or the build fails:
1. **JS import paths** — all `from '...'` imports in JS/HTML are resolved to files on disk. Broken imports fail the build.
2. **`target="_blank"` links** — every `target="_blank"` in HTML/JS (excluding `*.min.js`) must include `rel="noopener"` (or `noopener noreferrer`).
3. **Local CSS/JS references** — all `href="*.css"` and `src="*.js"` in HTML must point to existing files (external URLs excluded).
4. **Page metadata** — `index.html` and `experiments/*.html` must each contain `<meta name="description">`, `<link rel="canonical">`, and `og:title`.
5. **Playwright smoke tests** — runs `npx playwright test` (Chromium) against a local `serve` instance. Validates page loads, navigation, static asset responses, auth modal, and admin page structure.

## Architecture

### R2 Media Delivery

Two R2 buckets serve media — one public, one private:

| Bucket | Domain | Purpose |
|--------|--------|---------|
| Public | `https://pub.bitbi.ai` | Gallery images (thumb/preview/full), Sound Lab audio |
| Private (`PRIVATE_MEDIA`) | via `/api/*` auth worker routes | Exclusive gallery images, exclusive audio, avatars |

**Public R2 base URL** is defined as `const R2_PUBLIC_BASE = 'https://pub.bitbi.ai'` in each module that needs it (`js/shared/gallery-data.js`, `js/pages/index/soundlab.js`). Change it in both places if the domain changes.

**Public R2 key layout:**
- Gallery images: `gallery/[thumbs|previews|full]/ai-creations/{slug}-{width}.webp`
- Sound Lab audio: `audio/sound-lab/{track-name}.mp3`

**Private R2 key layout** (bucket `bitbi-private-media`, bound as `PRIVATE_MEDIA` in auth worker):
- Exclusive images: `images/Little_Monster/little-monster_NN.png` (full), `images/Little_Monster/thumbnails/little-monster_NN.webp` (thumbs)
- Exclusive audio: `audio/sound-lab/exclusive-track-01.mp3`
- Avatars: `avatars/{userId}`

Public content loads directly from `pub.bitbi.ai`. Private content routes through the auth worker (`/api/images/*`, `/api/thumbnails/*`, `/api/music/*`) which enforces authentication before proxying from R2.

### Pages
- `index.html` — Main landing page (particle effects, gallery, experiments, soundlab, markets, auth-gated sections)
- `experiments/cosmic.html` — A-Frame WebXR/VR art gallery
- `experiments/king.html` — Medieval-themed 3D puzzle game (Canvas + Three.js)
- `experiments/skyfall.html` — Arcade falling objects game (Canvas)
- `account/profile.html` — User profile page (avatar upload, account settings, requires auth)
- `admin/index.html` — Admin dashboard (user management, requires admin role)
- `account/forgot-password.html`, `account/reset-password.html`, `account/verify-email.html` — Auth flow pages
- `legal/privacy.html`, `legal/datenschutz.html`, `legal/imprint.html` — Legal/GDPR pages

### JavaScript

Vanilla ES6 modules — no frameworks or bundlers.

**Module system**: `js/shared/` for reusable modules, `js/pages/<page>/main.js` as entry point per page (index, profile, admin each have one). Game pages (`experiments/king.html`, `experiments/skyfall.html`) and `experiments/cosmic.html` use inline `<script>` blocks instead of the module system — they are CSS-isolated too, loading only `cookie-banner.css` (no tokens.css or design system) and declaring their own `@font-face` rules inline (king: Cinzel/MedievalSharp, skyfall: Orbitron/Exo 2). The dev server (`npm run dev`) is `npx serve` on port 3000 — plain static file serving, no hot reload.

**Shared modules** (`js/shared/`): Beyond auth, includes `gallery-data.js` (R2-backed gallery items with thumb/preview/full variants), `particles.js` (canvas particle effects), `binary-rain.js` (matrix-style rain), `binary-footer.js`, `scroll-reveal.js` (intersection observer animations), `focus-trap.js` (modal focus trapping), `cookie-consent.js` (GDPR banner), `make-tags.js` (DOM helpers), `format-time.js`, `navbar.js` (scroll handler + mobile toggle), `auth-nav.js` (sign-in/out button in desktop + mobile nav), `site-header.js` (injects full nav + mobile menu on subpages like profile, admin, legal).

**Index page modules** (`js/pages/index/`): `main.js` orchestrates initialization order. Sub-modules: `gallery.js`, `soundlab.js`, `markets.js`, `experiments.js`, `contact.js`, `smooth-scroll.js`, `locked-sections.js`. Note: `navbar.js` and `auth-nav.js` here are pure re-exports from `js/shared/` — this re-export pattern keeps index imports local while the real logic lives in shared modules.

**Auth client** (`js/shared/auth-api.js`, `auth-state.js`, `auth-modal.js`):
- `auth-state.js` dispatches `CustomEvent('bitbi:auth-change')` on login/logout — this is how all other modules react to auth changes
- `auth-modal.js` injects login/register forms only when the modal opens (not on page load) — this is intentional to prevent Safari autofill on page load. Do not "optimize" by pre-rendering the forms
- `auth-api.js` wraps all `/api/*` fetch calls with `credentials: 'include'`

**Index page initialization** (`js/pages/index/main.js`): Auth is started as a non-blocking promise, visual content (particles, binary rain, navbar) renders first, then `await authReady` gates the auth UI. This ordering is intentional for perceived performance.

**Locked sections** (`js/pages/index/locked-sections.js`): Injects 5 auth-gated placements into the index page — an experiment card, a gallery filter button, an exclusive gallery folder (Little Monster, 15 images), a soundlab track, and a markets portfolio card. All listen to `'bitbi:auth-change'` and toggle `data-locked` attribute.

**Vendor libraries** (`js/vendor/`): Self-hosted `aframe-1.5.0.min.js`, `aframe-extras-7.2.0.min.js` (cosmic.html), `three-r128.min.js` (king.html).

**Shared module defaults pattern**: `particles.js` and `binary-rain.js` define conservative default configs (e.g. `maxParticles: 35`, `maxCols: 16`). The index page overrides these with heavier settings via its `main.js` (e.g. `maxParticles: 100`, `maxCols: 30`). Subpages use the lighter defaults. Changing defaults only affects subpages; changing index overrides only affects the homepage.

### Gallery

**Data** (`js/shared/gallery-data.js`): Central source of truth for public gallery items 100–108. Each item has `id`, `slug`, `title`, `caption`, `category`, `aspectRatio`, and three image variants (`thumb`, `preview`, `full`) with URLs built from `R2_PUBLIC_BASE`. Items reference only public R2 URLs — exclusive/private items (Little Monster) are injected separately by `locked-sections.js` and have no `full` variant.

**Rendering** (`js/pages/index/gallery.js`): Imports `galleryItems` from `gallery-data.js`. Grid cards load **only thumb** images with explicit `width`/`height` and `loading="lazy"`. Modal loads **only preview** images. Full images are opened in a new tab via `window.open()` only on explicit click of the top-left modal action button. The full-link button (`#modalFullLink`) is shown only for public items (those with `item.full.url`) and hidden for exclusive items.

**Categories**: Desktop filter bar has three buttons: Pictures, Creepy Creatures, Experimental. The Exclusive filter button is injected by `locked-sections.js` and is auth-gated. Default active category is Pictures (no "All" category).

**Modal controls**: Two absolutely-positioned buttons inside `.modal-card` — open-full link (`.modal-action--left`, top-left) and close button (`.modal-action--right`, top-right). Both use `.modal-action` base class in `css/components/components.css`.

### Sound Lab

**Public tracks** (`js/pages/index/soundlab.js`): 5 tracks served from `R2_PUBLIC_BASE + '/audio/sound-lab/{name}.mp3'`. Audio metadata is deferred via IntersectionObserver — `preload` starts as `'none'`, switches to `'metadata'` only when the Sound Lab section scrolls into view.

**Exclusive track**: Injected by `locked-sections.js`, served via `/api/music/exclusive-track-01` (auth-required, routed through auth worker to private R2).

### CSS

- `@layer` cascade order: `tokens → reset → base → components → pages → utilities` — each layer maps to a file in `css/base/` or `css/components/`
- `css/base/` — `tokens.css` (design tokens, `@property`, oklch colors), `reset.css`, `base.css` (@font-face, gradients, glass, animations), `utilities.css`
- `css/components/` — `components.css`, `auth.css` (auth modal, locked-area overlays, auth flow page styles), `cookie-banner.css` (standalone, hardcoded values, no CSS variable dependencies — intentional so game pages don't need tokens.css)
- `css/pages/` — `index.css` (index page styles), `legal.css` (shared legal page styles)
- `css/account/` — `profile.css`, `forgot-password.css`, `reset-password.css`
- `css/admin/` — `admin.css`
- Color palette: `--color-midnight`, `--color-navy`, `--color-cyan`, `--color-gold`, `--color-ember`, `--color-magenta`
- Typography: Playfair Display (display), Inter (body), JetBrains Mono (code)
- All fonts self-hosted as woff2 in `fonts/`

### Cloudflare Workers

Three workers, deployed separately from the static site:

| Worker | Endpoint | Purpose |
|--------|----------|---------|
| `workers/auth/src/index.js` | `bitbi.ai/api/*` | Auth API — D1, R2, cookie sessions, PBKDF2-SHA256. **Read `workers/auth/CLAUDE.md` before modifying** — it has full route docs, handler signatures, DB schema, and rate limits |
| `workers/contact/src/index.js` | `contact.bitbi.ai` | Contact form email via Resend API |
| `workers/crypto/src/index.js` | `api.bitbi.ai` | CoinGecko proxy for crypto market data |

All workers are CORS-locked to `https://bitbi.ai`. Auth worker secrets: `SESSION_SECRET`, `RESEND_API_KEY`. Crypto worker secret: `COINGECKO_API_KEY`.

## Key Conventions

- GDPR cookie consent uses timezone-based EU detection (no API calls)
- Legal pages follow German law requirements (§ 5 DDG, § 18 MStV)
- Auth error messages are in English
- Protected content (exclusive gallery images, exclusive audio) served from private R2 bucket via auth worker; public content (gallery items 100–108, Sound Lab tracks) served directly from `pub.bitbi.ai`
- Accessibility: all modals use `focus-trap.js`, keyboard navigation (Escape closes, arrow keys cycle), `prefers-reduced-motion` respected in particles and scroll animations, ARIA attributes on interactive elements
- Admin date formatting uses German locale (`Intl.DateTimeFormat('de-DE')`)
- `docs/` contains internal compliance/audit notes — not deployed, not user-facing
- **Cache busting**: All CSS/JS `<link>`/`<script>` tags use `?v=YYYYMMDD` query params (e.g. `?v=20260317`). When modifying CSS or JS files, update the version string in the HTML files that reference them
- **Subpage pattern**: Subpages (profile, admin, legal) start with a minimal nav shell, then `initSiteHeader()` from `js/shared/site-header.js` injects the full nav + mobile menu at runtime. All subpages load the same CSS cascade: `tokens → reset → base → components → auth → page-specific → utilities`
