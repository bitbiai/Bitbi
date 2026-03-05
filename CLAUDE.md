# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

### Shared Modules (`js/shared/`)
ES6 modules imported via `<script type="module">` in HTML pages:
- `cookie-consent.js` — GDPR cookie banner (EU timezone detection, localStorage, Cloudflare RUM gating)
- `particles.js` — Configurable hero canvas particle system
- `scroll-reveal.js` — IntersectionObserver scroll animations
- `binary-footer.js` — Random binary string generator for footers
- `binary-rain.js` — Matrix-style falling binary rain effect

### Styling
- **Tailwind CSS** loaded from CDN (not installed locally)
- Custom CSS in `css/base.css` (shared), `css/index.css`, `css/legal.css`
- CSS custom properties define the color palette: `--color-midnight`, `--color-cyan`, `--color-gold`, `--color-ember`, `--color-magenta`
- Typography: Playfair Display (display), Inter (body), JetBrains Mono (code)

### Third-Party Dependencies (all CDN-loaded)
- Tailwind CSS v3+
- A-Frame.io (VR/WebXR in cosmic.html)
- Google Fonts
- Cloudflare RUM (consent-gated analytics)

## Development

No build tools, package manager, test framework, or linter are configured. Development workflow:

1. Edit HTML/CSS/JS files directly
2. Open in browser to test locally
3. Commit and push to `main` for automatic GitHub Pages deployment

## Key Conventions

- JavaScript uses vanilla ES6 modules — no frameworks or bundlers
- GDPR cookie consent uses timezone-based EU detection (no API calls)
- Canvas-based effects and games use inline `<script>` blocks within their HTML pages
- Shared functionality is extracted to `js/shared/` as ES6 exports
- Legal pages follow German law requirements (§ 5 DDG, § 18 MStV)
