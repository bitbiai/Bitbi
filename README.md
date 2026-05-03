# BITBI

**AI visuals, sound explorations, and creative coding projects.**

BITBI is a static creative portfolio and digital playground that brings together AI-generated visuals, sound explorations, and creative coding into one branded experience.

## Live Site

[bitbi.ai](https://bitbi.ai)

## What this project includes

- **AI Creations Gallery** — curated generative visuals and creative imagery
- **Sound Lab** — ambient textures, sonic sketches, and audio compositions
- **Assets Manager** — saved media and folder management
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
├── account/             # Auth flow pages (profile, assets-manager, forgot-password, reset-password, verify-email)
├── admin/               # Admin dashboard
├── legal/               # Legal pages (privacy, imprint, datenschutz)
├── workers/             # Cloudflare Workers (auth, ai, contact)
├── index.html           # Main landing page
└── sitemap.xml          # Search engine sitemap
