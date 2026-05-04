---
name: responsive-qa
description: Use after bitbi.ai frontend/UI changes to audit mobile, tablet, desktop, iPhone/Safari-sensitive behavior, modals, overflow, viewport issues, touch targets, sticky/fixed elements, and forms.
---

# Name

responsive-qa

# Description

Audit responsive behavior after UI changes and recommend minimal fixes. This skill focuses on layout quality and regression safety across common viewport classes.

# When to Use This Skill

- Use after homepage, account, admin, profile, gallery, video, Sound Lab, modal, footer, header, or form UI changes.
- Use when users report mobile/iPhone/Safari layout or interaction issues.
- Use before release when a change affects responsive layout.

# Step-by-Step Workflow

1. Read `AGENTS.md` and inspect the changed files.
2. Identify affected pages, sections, modals, overlays, cards, forms, and fixed/sticky elements.
3. Check mobile, tablet, and desktop behavior.
4. Pay special attention to:
   - iPhone/mobile Safari-sensitive behavior
   - viewport height and safe-area issues
   - horizontal overflow
   - text clipping and wrapping
   - touch targets and dense controls
   - sticky/fixed headers, drawers, and modals
   - form usability and keyboard overlap risk
5. Report concrete issues with file/selector references.
6. If asked to fix, apply the smallest scoped CSS/JS change and re-test.

# Repository-Specific Constraints

- Preserve the existing static HTML/CSS/vanilla ES module architecture.
- Avoid broad global CSS changes that can affect `index`, `account/*`, and `admin`.
- Reuse existing breakpoints, CSS variables, layout utilities, and component patterns.
- Do not change header navigation or media behavior unless explicitly in scope.
- Preserve auth modal, saved-assets browser, folder flows, galleries, Sound Lab, and admin behavior unless explicitly part of the responsive bug.

# Validation Expectations

- Use focused Playwright tests where available.
- For substantial UI changes, run `npm run test:static`.
- Run `npm run check:dom-sinks` if JavaScript was touched.
- Run `git diff --check`.
- Do not run Worker tests unless backend files changed.

# Final Reporting Format

- Viewports checked
- Issues found, with selectors/files
- Minimal fixes applied or recommended
- Regression areas checked
- Commands run and results
- Remaining responsive risks
