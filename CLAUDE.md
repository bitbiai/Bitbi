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

**No build step.** All development is direct HTML/CSS/JS. No test framework or linter.

## Development

```bash
# Local dev server (port 3000)
npm run dev

# Auth worker (workers/auth/)
cd workers/auth && npx wrangler dev                                          # local dev
cd workers/auth && npx wrangler deploy                                       # deploy to Cloudflare
cd workers/auth && npx wrangler d1 migrations apply bitbi-auth-db --local    # run migrations locally
cd workers/auth && npx wrangler d1 migrations apply bitbi-auth-db --remote   # run migrations in prod
```

Contact (`worker/contact-worker.js`) and crypto (`worker/crypto-worker.js`) workers have no wrangler config in this repo — they are deployed separately via Cloudflare dashboard or standalone wrangler commands.

### Deployment

GitHub Actions (`.github/workflows/static.yml`) deploys to Pages on push to `main`. Only these are copied to `_site/`: `*.html`, `robots.txt`, `sitemap.xml`, `assets/`, `css/`, `fonts/`, `js/`, `music/`. The `worker/` and `workers/` directories are **not** deployed to Pages.

## Architecture

### Pages
- `index.html` — Main landing page (particle effects, gallery, experiments, soundlab, markets, auth-gated sections)
- `cosmic.html` — A-Frame WebXR/VR art gallery
- `king.html` — Medieval-themed 3D puzzle game (Canvas + Three.js)
- `skyfall.html` — Arcade falling objects game (Canvas)
- `admin.html` — Admin dashboard (user management, requires admin role)
- `forgot-password.html`, `reset-password.html`, `verify-email.html` — Auth flow pages
- `privacy.html`, `datenschutz.html`, `imprint.html` — Legal/GDPR pages

### JavaScript

Vanilla ES6 modules — no frameworks or bundlers.

**Module system**: `js/shared/` for reusable modules, `js/pages/<page>/main.js` as entry point per page. Game pages (`king.html`, `skyfall.html`) and `cosmic.html` use inline `<script>` blocks instead of the module system.

**Auth client** (`js/shared/auth-api.js`, `auth-state.js`, `auth-modal.js`):
- `auth-state.js` dispatches `CustomEvent('bitbi:auth-change')` on login/logout — this is how all other modules react to auth changes
- `auth-modal.js` injects login/register forms only when the modal opens (not on page load) — this is intentional to prevent Safari autofill on page load. Do not "optimize" by pre-rendering the forms
- `auth-api.js` wraps all `/api/*` fetch calls with `credentials: 'include'`

**Index page initialization** (`js/pages/index/main.js`): Auth is started as a non-blocking promise, visual content (particles, binary rain, navbar) renders first, then `await authReady` gates the auth UI. This ordering is intentional for perceived performance.

**Locked sections** (`js/pages/index/locked-sections.js`): Injects 5 auth-gated placements into the index page — an experiment card, a gallery filter button, an exclusive gallery folder (Little Monster, 15 images), a soundlab track, and a markets portfolio card. All listen to `'bitbi:auth-change'` and toggle `data-locked` attribute.

**Vendor libraries** (`js/vendor/`): Self-hosted `aframe-1.5.0.min.js`, `aframe-extras-7.2.0.min.js` (cosmic.html), `three-r128.min.js` (king.html).

### CSS

- **Tailwind CSS** loaded from CDN (only remaining CDN dependency besides Cloudflare RUM)
- `@layer` cascade order: `tokens → reset → base → components → pages → utilities`
- `css/tokens.css` — design tokens using `@property` and oklch colors with hex fallbacks
- `css/base.css` — @font-face declarations, gradient text utilities, glass effects, reveal animations, keyframes
- `css/index.css` — index page styles
- `css/cookie-banner.css` — standalone cookie banner styles for game pages (hardcoded values, no CSS variable dependencies — this is intentional so game pages don't need tokens.css)
- `css/auth.css` — auth modal, locked-area overlays, auth flow page styles
- `css/pages/` — page-specific styles (admin, forgot-password, reset-password)
- Color palette: `--color-midnight`, `--color-navy`, `--color-cyan`, `--color-gold`, `--color-ember`, `--color-magenta`
- Typography: Playfair Display (display), Inter (body), JetBrains Mono (code)
- All fonts self-hosted as woff2 in `fonts/`

### Cloudflare Workers

Three workers, deployed separately from the static site:

| Worker | Endpoint | Purpose |
|--------|----------|---------|
| `workers/auth/src/index.js` | `bitbi.ai/api/*` | Auth API — D1, R2, cookie sessions, PBKDF2-SHA256. Has its own `CLAUDE.md` with full route docs |
| `worker/contact-worker.js` | `contact.bitbi.ai` | Contact form email via Resend API |
| `worker/crypto-worker.js` | `api.bitbi.ai` | CoinGecko proxy for crypto market data |

All workers are CORS-locked to `https://bitbi.ai`. Auth worker secrets: `SESSION_SECRET`, `RESEND_API_KEY`.

## Key Conventions

- GDPR cookie consent uses timezone-based EU detection (no API calls)
- Legal pages follow German law requirements (§ 5 DDG, § 18 MStV)
- Auth error messages are in English
- Protected content (gallery images, music) served from R2 bucket, requires authentication
- Accessibility: all modals use `focus-trap.js`, keyboard navigation (Escape closes, arrow keys cycle), `prefers-reduced-motion` respected in particles and scroll animations, ARIA attributes on interactive elements
- Admin date formatting uses German locale (`Intl.DateTimeFormat('de-DE')`)
