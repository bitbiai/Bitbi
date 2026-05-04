---
name: frontend-builder
description: Use to implement approved bitbi.ai frontend phases in the static vanilla HTML/CSS/ES module architecture while preserving existing behavior and adding focused tests.
---

# Name

frontend-builder

# Description

Implement approved website/frontend changes in bitbi.ai with minimal, targeted diffs. This skill is for actual frontend work after scope is clear.

# When to Use This Skill

- Use for homepage, account, admin, legal, profile, gallery, video, Sound Lab, Assets Manager, saved-assets, modal, or navigation UI changes.
- Use after a plan is approved or when the user directly asks to implement a frontend fix.
- Do not use for backend-only Worker changes unless a frontend integration is also required.

# Step-by-Step Workflow

1. Read `AGENTS.md`; read deeper instructions if editing a scoped area.
2. Inspect existing markup, modules, styles, and tests before editing.
3. Identify the smallest safe frontend change.
4. Preserve existing selectors, IDs, data attributes, and event hooks where possible.
5. Reuse existing CSS variables, components, helpers, safe DOM utilities, and local assets.
6. Implement with vanilla HTML/CSS/ES modules.
7. Avoid unsafe DOM sinks. Prefer `textContent`, `setAttribute`, `classList`, `append`, and `replaceChildren`.
8. Add or update focused tests for changed behavior.
9. Run proportional validation and inspect the diff.

# Repository-Specific Constraints

- Keep the static site architecture; no React/Vue/Svelte/framework migration.
- Avoid broad refactors and opportunistic cleanup.
- Preserve account, admin, profile, saved-assets browser, folder flows, favorites, auth modal, galleries, Sound Lab, Video, and media behavior unless explicitly part of the task.
- Do not switch self-hosted assets to third-party CDNs.
- Do not silently alter API response shapes expected by frontend modules.
- If Worker files are touched, read `workers/auth/AGENTS.md` and `workers/auth/CLAUDE.md` first.
- Keep high-risk flows conservative: auth, admin, private media, AI generation/save/publish, D1 migrations, route policies, release compatibility.

# Validation Expectations

- Always run `git diff --check`.
- Run `npm run check:dom-sinks` for frontend JavaScript changes.
- Run focused Playwright/static tests for the changed surface.
- Run `npm run test:static` when practical for broad UI changes.
- Run Worker tests only if Worker/API behavior changed.
- State exact commands and results.

# Final Reporting Format

- Files changed
- What changed and why
- Existing behavior preserved
- Tests added or updated
- Commands run and results
- Known risks or limitations
- Deploy impact
