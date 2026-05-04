---
name: website-planner
description: Use before coding complex bitbi.ai website changes to produce a practical implementation plan, sitemap/page structure, components, responsive behavior, risks, tests, and deploy impact without editing code.
---

# Name

website-planner

# Description

Plan complex website or product-surface changes in the bitbi.ai repository before implementation. This skill produces a concrete plan and does not edit code unless the user explicitly asks for implementation.

# When to Use This Skill

- Use before coding multi-page, multi-section, or high-risk frontend changes.
- Use when the request affects homepage sections, account pages, admin pages, legal pages, media galleries, or saved assets.
- Use when the user asks for planning, architecture, sitemap, phases, risks, or implementation strategy.
- Do not use for small single-line fixes unless the user asks for a plan.

# Step-by-Step Workflow

1. Read `AGENTS.md` and any deeper `AGENTS.md` that applies to the target area.
2. Inspect the existing page/module structure before proposing changes:
   - `index.html`, `account/`, `admin/`, `legal/`
   - `js/shared/`, `js/pages/*/main.js`
   - `css/base/`, `css/components/`, `css/pages/`, `css/account/`, `css/admin/`
3. Identify the current routes, UI states, data flows, and user workflows.
4. Produce a plan with:
   - sitemap or affected page list
   - page structure and section hierarchy
   - component/module list
   - responsive behavior for mobile, tablet, desktop
   - implementation phases
   - risks and guardrails
   - tests/checks to run
   - deployment impact
5. Call out unclear requirements and assumptions.
6. Stop after the plan unless the user explicitly asks to implement.

# Repository-Specific Constraints

- Frontend is static HTML/CSS/vanilla ES modules. Do not plan framework rewrites.
- Backend is Cloudflare Workers: `workers/auth`, `workers/ai`, `workers/contact`.
- Persistent resources include D1, R2, Queues, Durable Objects, Workers AI, and Cloudflare Images.
- Static Pages deploy and Worker deploys are separate.
- Treat auth/session, admin routes, private media, AI generation/save/publish flows, D1 migrations, Worker config, route policy, release compatibility, caching, and rate limits as high-risk.
- Preserve account, admin, profile, saved-assets browser, folder flows, favorites, auth modal, galleries, and media behavior unless explicitly in scope.
- Do not invent commands. Use only real scripts from `package.json` and repo docs.

# Validation Expectations

- Planning-only work usually does not require tests.
- Recommend proportional validation:
  - Static/UI changes: `npm run test:static`
  - Worker/API changes: `npm run test:workers`
  - Release/config/migration changes: `npm run test:release-compat`, `npm run validate:release`
  - Asset build/version changes: `npm run test:asset-version`, `npm run validate:asset-version`, `npm run build:static`
- State when validation is not run because no files were changed.

# Final Reporting Format

- Goal and scope
- Pages/routes/modules affected
- Sitemap or structure plan
- Component/module plan
- Responsive behavior
- Implementation phases
- Risks and assumptions
- Test plan
- Deploy impact
- Open questions
