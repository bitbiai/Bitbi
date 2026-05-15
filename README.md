# BITBI

**AI visuals, sound explorations, generated media, accounts, credits, and Cloudflare-backed product foundations.**

BITBI is a static vanilla HTML/CSS/ES module site backed by Cloudflare Workers. It started as a creative portfolio and now includes authenticated account flows, generated media storage, member credits, organization and billing foundations, guarded Stripe checkout/webhook flows, admin operations tooling, and AI generation surfaces.

This repository is not a production-deploy approval, full SaaS maturity claim, full tenant-isolation claim, legal compliance certification, or live billing readiness claim. The release contract in `config/release-compat.json` is the current deploy/schema source of truth. As of the Alpha Audit reconciliation on 2026-05-15, the latest auth D1 migration is:

```text
0047_add_member_subscriptions_and_credit_buckets.sql
```

Production remains blocked until staging/live migrations, Worker secrets, bindings, Cloudflare resources, Stripe webhooks, health checks, security headers, and operational evidence are verified without exposing secret values.

## Live Site

[bitbi.ai](https://bitbi.ai)

## What this project includes

- **AI Creations Gallery** — public generated visuals and creative imagery
- **Sound Lab / Memtracks / Memvids** — audio and video media experiences
- **Assets Manager** — saved media, folders, storage quotas, and generated asset management
- **Account flows** — profile, wallet, credits, organization, password reset, email verification, and localized account pages
- **Admin area** — admin-only users, billing inspection, AI Lab, lifecycle, operations, and control-plane surfaces
- **Cloudflare Workers APIs** — auth/admin/media/billing/AI/contact routes with D1, R2, Queues, Durable Objects, Workers AI, Cloudflare Images, and service bindings

## Tech Stack

- **HTML**
- **CSS**
- **JavaScript**
- **GitHub Pages** for static hosting
- **GitHub Actions** for deployment
- **Cloudflare Workers** for backend-like functionality
- **Cloudflare D1** for auth, media, lifecycle, org, billing, credit, subscription, and operational persistence
- **Cloudflare R2 / Queues / Durable Objects / Workers AI / Images** for media, async work, rate limiting, replay protection, and generation flows
- **Self-hosted assets first** wherever possible

## Project Philosophy

BITBI is intentionally lightweight at the frontend layer and Cloudflare-native at the backend layer:

- no unnecessary framework overhead
- no framework rewrite of the static site
- self-hosted assets whenever technically possible
- explicit release/deploy contract for migrations, Workers, static deploy, and manual Cloudflare prerequisites
- conservative security posture for auth, admin, private media, billing, and AI cost-sensitive routes

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
