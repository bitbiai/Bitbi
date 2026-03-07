# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## PERMANENT PROJECT RULES – ALWAYS FOLLOW THESE FIRST

From now on, for this entire project:
- ALWAYS prioritize self-hosted content first.
- Never suggest or use external CDNs (Google Fonts, jsDelivr, cdnjs, unpkg, aframe.io, etc.) if self-hosting is technically possible.
- Always prefer local files in the /assets/ folder (fonts in /assets/fonts/, JS libraries in /assets/js/, images in /assets/images/, etc.).
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
- CSS uses `@layer` cascade layers: `tokens` → `reset` → `components` → `utilities`
- `css/tokens.css` — design tokens using `@property` and oklch colors with hex fallbacks
- `css/base.css` (shared), `css/index.css`, `css/legal.css`, `css/reset.css`, `css/components.css`, `css/utilities.css`
- Color palette: `--color-midnight`, `--color-cyan`, `--color-gold`, `--color-ember`, `--color-magenta`
- Typography: Playfair Display (display), Inter (body), JetBrains Mono (code)

### Third-Party Dependencies (all CDN-loaded)
- Tailwind CSS v3+
- A-Frame.io (VR/WebXR in cosmic.html)
- Google Fonts
- Cloudflare RUM (consent-gated analytics)

## Development

No build tools, test framework, or linter are configured. Development workflow:

1. Edit HTML/CSS/JS files directly
2. `npm run dev` — starts a local server on port 3000 (`npx serve -l 3000`)
3. Commit and push to `main` for automatic GitHub Pages deployment

### Cloudflare Worker
`worker/contact-worker.js` — Contact form email handler, deployed separately on Cloudflare Workers (not part of the static site). Uses Resend API with `RESEND_API_KEY` secret.

## Key Conventions

- JavaScript uses vanilla ES6 modules — no frameworks or bundlers
- GDPR cookie consent uses timezone-based EU detection (no API calls)
- Canvas-based effects and games use inline `<script>` blocks within their HTML pages
- Shared functionality is extracted to `js/shared/` as ES6 exports
- Legal pages follow German law requirements (§ 5 DDG, § 18 MStV)
