# BITBI

**AI visuals, sound explorations, generated media, accounts, credits, and Cloudflare-backed product foundations.**

BITBI is a static vanilla HTML/CSS/ES module site backed by Cloudflare Workers. It started as a creative portfolio and now includes authenticated account flows, generated media storage, member credits, organization and billing foundations, guarded Stripe checkout/webhook flows, admin operations tooling, and AI generation surfaces.

This repository is not a production-deploy approval, full SaaS maturity claim, full tenant-isolation claim, legal compliance certification, or live billing readiness claim. The release contract in `config/release-compat.json` is the current deploy/schema source of truth. As of Phase 4.20 read-only platform budget repair evidence reporting/export on 2026-05-16, the latest auth D1 migration remains:

```text
0054_add_platform_budget_repair_actions.sql
```

Phase 4.15.1 adds only a D1-backed app-level Admin AI budget switch layer on top of the Phase 4.15 Cloudflare master budget flags. A covered provider-cost admin/platform path is enabled only when the Cloudflare master flag is enabled, the D1/Admin UI app switch is enabled, and, for the Phase 4.17 `platform_admin_lab_budget` routes, a daily/monthly platform cap allows the request. Phase 4.18 adds read-only reconciliation evidence; Phase 4.19 adds an explicit admin-approved repair executor that can create missing platform budget usage evidence only from still-successful local D1 source proof and records other candidates as review-only. Phase 4.20 adds bounded admin-only repair evidence report/export over those repair action rows; it is read-only and does not apply repairs, mutate usage/source rows, call providers, call Stripe, or change credits. The Admin UI does not edit Cloudflare variables, does not store Cloudflare API tokens, and cannot override a disabled or missing Cloudflare master flag. Phase 4.16 live platform budget cap design/evidence remains completed and preserved; Phase 4.17 implements only the first narrow admin-lab cap foundation, and Phases 4.19/4.20 are not customer billing, Stripe billing, automatic repair, or production readiness. Production remains blocked until staging/live migrations, Worker secrets, bindings, Cloudflare resources, Stripe webhooks, health checks, security headers, and operational evidence are verified without exposing secret values.

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
