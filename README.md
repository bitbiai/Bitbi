# BITBI

**Experimental web experiences, AI visuals, and creative coding projects.**

BITBI is a static creative portfolio and digital playground that brings together interactive web experiments, AI-generated visuals, immersive concepts, sound explorations, and live market data into one branded experience.

## Live Site

[bitbi.ai](https://bitbi.ai)

## What this project includes

- **Experiments** — interactive websites, visual concepts, and creative web ideas
- **AI Creations Gallery** — curated generative visuals and experimental imagery
- **Sound Lab** — ambient textures, sonic sketches, and audio experiments
- **Live Markets** — real-time crypto market data integrated into the experience
- **Contact flow** — privacy-aware contact form setup
- **Account-related pages** — profile, password reset, email verification, and admin-related flows

## Tech Stack

- **HTML**
- **CSS**
- **JavaScript**
- **GitHub Pages** for static hosting
- **GitHub Actions** for deployment
- **Cloudflare Workers** for backend-like functionality
- **Cloudflare D1** for auth-related persistence
- **Self-hosted assets first** wherever possible

## Project Philosophy

BITBI is intentionally lightweight and direct:

- no unnecessary framework overhead
- no mandatory build step for the main site
- self-hosted assets whenever technically possible
- creative freedom first
- privacy-conscious integrations

## Repository Structure

```text
.
├── .github/workflows/   # Deployment workflow
├── assets/              # Images, icons, and visual assets
├── css/                 # Stylesheets
├── docs/                # Supporting documentation
├── fonts/               # Self-hosted fonts
├── js/                  # Frontend JavaScript
├── experiments/         # Interactive experiments (cosmic, king, skyfall)
├── account/             # Auth flow pages (profile, forgot-password, reset-password, verify-email)
├── admin/               # Admin dashboard
├── legal/               # Legal pages (privacy, imprint, datenschutz)
├── workers/             # Cloudflare Workers (auth, ai, contact, crypto)
├── index.html           # Main landing page
└── sitemap.xml          # Search engine sitemap
