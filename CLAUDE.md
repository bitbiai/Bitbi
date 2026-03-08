# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## PERMANENT PROJECT RULES – ALWAYS FOLLOW THESE FIRST

From now on, for this entire project:
- ALWAYS prioritize self-hosted content first.
- Never suggest or use external CDNs (Google Fonts, jsDelivr, cdnjs, unpkg, aframe.io, etc.) if self-hosting is technically possible.
- Always prefer local files (fonts in `fonts/`, JS libraries in `js/vendor/`, images in `assets/images/`, favicons in `assets/favicons/`).
- If a library like A-Frame, Three.js or any other asset is needed, instruct me to download and self-host it locally — never link to a CDN.
- Only use external sources when it is technically impossible to self-host (e.g. Resend API or payment providers).
- This rule overrides everything else and applies permanently to all future work on this project.

## Project Overview

Bitbi is a static portfolio website showcasing digital art and experimental web projects. It's hosted on GitHub Pages with automatic deployment via GitHub Actions on push to `main`.

**No build step required.** All development is direct HTML/CSS/JS — push to `main` triggers deployment.

## Architecture

### Pages
- `index.html` — Main landing page with particle effects, gallery, cookie consent
- `cosmic.html` — A-Frame WebXR/VR art gallery experience
- `king.html` — Medieval-themed 3D puzzle game (Canvas API)
- `skyfall.html` — Arcade-style falling objects game (Canvas API)
- `privacy.html`, `imprint.html` — Legal/GDPR pages

### JavaScript Structure
**Shared modules** (`js/shared/`) — reusable ES6 modules imported across pages:
- `cookie-consent.js` — GDPR cookie banner (EU timezone detection, localStorage, Cloudflare RUM gating)
- `particles.js` — Configurable hero canvas particle system
- `scroll-reveal.js` — IntersectionObserver scroll animations
- `binary-footer.js` — Random binary string generator for footers
- `binary-rain.js` — Matrix-style falling binary rain effect

**Page modules** (`js/pages/<page>/`) — page-specific logic, e.g. `js/pages/index/main.js` is the entry point for `index.html`, importing both shared modules and page-specific modules (navbar, gallery, soundlab, markets, experiments, smooth-scroll).

Game pages (`king.html`, `skyfall.html`) and `cosmic.html` use inline `<script>` blocks rather than the module system.

### Styling
- **Tailwind CSS** loaded from CDN (not installed locally)
- `css/cookie-banner.css` — standalone cookie banner styles for game pages (no CSS variable dependencies)
- CSS uses `@layer` cascade layers: `tokens` → `reset` → `components` → `utilities`
- `css/tokens.css` — design tokens using `@property` and oklch colors with hex fallbacks
- `css/base.css` (shared), `css/index.css`, `css/legal.css`, `css/reset.css`, `css/components.css`, `css/utilities.css`
- Color palette: `--color-midnight`, `--color-cyan`, `--color-gold`, `--color-ember`, `--color-magenta`
- Typography: Playfair Display (display), Inter (body), JetBrains Mono (code)

### Self-Hosted Vendor Libraries (`js/vendor/`)
- `aframe-1.5.0.min.js` — A-Frame WebXR framework (used by `cosmic.html`)
- `aframe-extras-7.2.0.min.js` — A-Frame movement/animation extras (used by `cosmic.html`)
- `three-r128.min.js` — Three.js 3D library (used by `king.html`)

### Remaining External Dependencies (CDN-loaded)
- Cloudflare RUM (consent-gated analytics)

### Self-Hosted Fonts (`fonts/`)
All fonts are self-hosted as woff2 files — no Google Fonts CDN connections. Includes Inter, Playfair Display, JetBrains Mono, Cinzel Decorative, MedievalSharp, Orbitron, Exo 2.

## Development

No build tools, test framework, or linter are configured. Development workflow:

1. Edit HTML/CSS/JS files directly
2. `npm run dev` — starts a local server on port 3000 (`npx serve -l 3000`)
3. Commit and push to `main` for automatic GitHub Pages deployment

### Cloudflare Workers

Workers are deployed separately on Cloudflare — they are not part of the static site.

- `worker/contact-worker.js` — Contact form email handler. Uses Resend API with `RESEND_API_KEY` secret.
- `worker/crypto-worker.js` — CoinGecko proxy for crypto market data. CORS-locked to `https://bitbi.ai`.
- `workers/auth/` — Auth API (register, login, logout, session management). Uses Cloudflare D1 database (`bitbi-auth-db`) with PBKDF2 password hashing and cookie-based sessions. Configured via `workers/auth/wrangler.jsonc`. Routes: `/api/health`, `/api/me`, `/api/register`, `/api/login`, `/api/logout`. Error messages are in German. Requires `SESSION_SECRET` env var.
  - Dev: `cd workers/auth && npx wrangler dev`
  - Deploy: `cd workers/auth && npx wrangler deploy`

## Key Conventions

- JavaScript uses vanilla ES6 modules — no frameworks or bundlers
- GDPR cookie consent uses timezone-based EU detection (no API calls)
- Canvas-based effects and games use inline `<script>` blocks within their HTML pages
- Shared functionality is extracted to `js/shared/` as ES6 exports
- Legal pages follow German law requirements (§ 5 DDG, § 18 MStV)
