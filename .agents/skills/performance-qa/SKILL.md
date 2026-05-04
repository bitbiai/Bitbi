---
name: performance-qa
description: Use after larger bitbi.ai frontend changes to review unnecessary JavaScript, oversized assets, image loading, CSS bloat, layout shifts, caching assumptions, and third-party dependency risk.
---

# Name

performance-qa

# Description

Review frontend performance risks in bitbi.ai after larger UI or asset changes. Optimize only within the approved scope and without changing design or behavior unless explicitly allowed.

# When to Use This Skill

- Use after larger homepage/account/admin UI changes.
- Use after adding images, video, audio, fonts, scripts, CSS, modals, carousels, or media grids.
- Use when performance, load time, layout shift, or asset size is a concern.

# Step-by-Step Workflow

1. Read `AGENTS.md` and inspect changed files.
2. Identify new or changed JS, CSS, images, videos, fonts, and network requests.
3. Check for:
   - unnecessary JavaScript or duplicate listeners
   - large assets or unoptimized media
   - missing lazy loading or oversized thumbnails
   - CSS bloat or overly broad selectors
   - layout shifts from missing dimensions
   - cache/version assumptions
   - accidental third-party CDNs or services
4. Recommend minimal optimizations that preserve behavior.
5. If approved to edit, keep changes scoped and re-run relevant checks.

# Repository-Specific Constraints

- Do not add dependencies, external services, accounts, MCP servers, or third-party CDNs.
- Keep self-hosted/local asset patterns.
- Preserve vanilla HTML/CSS/ES module architecture.
- Do not change design or behavior while optimizing unless explicitly approved.
- Do not alter backend caching/security behavior without inspecting Worker code and release config.

# Validation Expectations

- Run `git diff --check`.
- Run `npm run test:static` for UI behavior after optimization.
- Run `npm run test:asset-version`, `npm run validate:asset-version`, or `npm run build:static` if asset version/build-pipeline behavior changes.
- Run Worker/release checks only if Worker config/routes change.

# Final Reporting Format

- Performance surfaces reviewed
- Findings and risk level
- Optimizations applied or recommended
- Assets/scripts/CSS affected
- Tests/checks run
- Remaining performance risks
