---
name: security-review
description: Use after bitbi.ai changes touching auth, uploads, profile, media, admin, Workers, generated content, DOM rendering, or external input to preserve validation and security boundaries.
---

# Name

security-review

# Description

Review bitbi.ai changes for auth, upload, media, admin, Worker, generated-content, DOM, and external-input security risks. This skill is defensive and should not weaken protections.

# When to Use This Skill

- Use after changes to auth/session/cookies, profile/avatar, file uploads, media serving, admin tools, Workers, AI generation/save/publish, billing/credits, route policies, or user-generated DOM rendering.
- Use when a bug involves MIME/type validation, ownership checks, public/private media, CSRF, rate limits, or API contracts.
- Use before release for high-risk backend or security-sensitive frontend changes.

# Step-by-Step Workflow

1. Read `AGENTS.md`; if touching `workers/auth/*`, read `workers/auth/AGENTS.md` and `workers/auth/CLAUDE.md`.
2. Identify trust boundaries:
   - browser to Worker
   - member vs admin
   - private vs public media
   - frontend estimates vs server billing
   - generated content vs DOM rendering
3. Check that the change does not weaken:
   - auth/session protections
   - admin guards
   - ownership checks
   - MIME/magic-byte validation
   - CSRF/same-origin protections
   - credit/billing enforcement
   - rate limits and body limits
   - route-policy/release-compat coverage
4. Check DOM rendering for unsafe sinks such as unjustified `innerHTML`.
5. Check frontend/server contract changes for silent response-shape drift.
6. Recommend minimal fixes; do not hide issues with UI-only changes.

# Repository-Specific Constraints

- Keep protected endpoints protected with existing `requireUser`/`requireAdmin` patterns.
- Preserve private/public media boundaries and ownership checks.
- Keep queue/async flows idempotent and retry-safe.
- Do not relax file validation, MIME/magic-byte checks, request body limits, or provider fetch safety.
- Do not silently alter JSON response shapes consumed by frontend modules/tests.
- Keep Worker route policies and `config/release-compat.json` aligned when routes/config change.

# Validation Expectations

- Run `npm run check:dom-sinks` for frontend JS.
- Run focused Worker tests for touched Worker routes.
- Run `npm run test:workers` for broad Worker/security changes when practical.
- Run `npm run check:route-policies`, `npm run test:release-compat`, or `npm run validate:release` if routes/config/release contracts changed.
- Always run `git diff --check`.

# Final Reporting Format

- Security surfaces reviewed
- Trust boundaries affected
- Findings and severity
- Fixes applied or recommended
- Validation run and results
- Residual risks
- Deploy/config/manual follow-up
