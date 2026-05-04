---
name: accessibility-qa
description: Use after bitbi.ai UI, form, dialog, modal, or navigation changes to check labels, semantics, focus, keyboard behavior, ARIA, alt text, contrast risk, and error messages.
---

# Name

accessibility-qa

# Description

Audit and improve accessibility for bitbi.ai UI changes without redesigning the product. Prefer semantic HTML and existing component patterns.

# When to Use This Skill

- Use after changes to forms, buttons, navigation, modals, dialogs, overlays, media cards, auth flows, profile pages, admin pages, or creation tools.
- Use when user reports keyboard, screen-reader, focus, or form-label problems.
- Use before release for high-impact UI surfaces.

# Step-by-Step Workflow

1. Read `AGENTS.md` and inspect the changed UI.
2. Identify interactive controls, forms, dialogs, and dynamic status/error regions.
3. Check:
   - labels associated with controls
   - button vs link semantics
   - keyboard navigation and Escape handling
   - focus order and visible focus states
   - dialog/modal role, `aria-modal`, `aria-hidden`, and focus trap behavior
   - alt text for meaningful images and empty alt for decorative images
   - ARIA usage only where semantic HTML is insufficient
   - readable error/status messages
   - contrast and text legibility risk
4. Prefer semantic fixes over ARIA patches.
5. If asked to fix, make targeted changes and update tests.

# Repository-Specific Constraints

- Preserve existing modal, auth, profile, saved-assets, gallery, Sound Lab, Video, and admin behavior.
- Do not remove accessibility attributes unless replacing them with equivalent or better behavior.
- Avoid unsafe DOM sinks. Use safe DOM APIs and existing helpers.
- Keep vanilla HTML/CSS/ES module architecture.
- Avoid broad CSS changes that alter unrelated pages.

# Validation Expectations

- Run focused static tests for changed interactions.
- Run `npm run check:dom-sinks` if JavaScript changed.
- Run `npm run test:static` for broad navigation/modal/form changes when practical.
- Run `git diff --check`.

# Final Reporting Format

- Accessibility surfaces checked
- Issues found
- Fixes applied or recommended
- Keyboard/focus behavior notes
- ARIA/semantic changes
- Tests and results
- Remaining accessibility risks
