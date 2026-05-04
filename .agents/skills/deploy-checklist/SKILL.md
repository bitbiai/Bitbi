---
name: deploy-checklist
description: Use at the end of bitbi.ai changes to determine static Pages, Worker, D1 migration, R2/binding/config, Cloudflare dashboard/manual, and secret deployment requirements from repo rules.
---

# Name

deploy-checklist

# Description

Produce a deployment checklist for completed bitbi.ai changes. This skill determines deploy units and manual follow-up without guessing Cloudflare requirements.

# When to Use This Skill

- Use at the end of any non-trivial change.
- Use before release, merge, or handoff.
- Use when changes touch static files, Workers, migrations, bindings, release compatibility, assets, secrets, or Cloudflare dashboard-managed behavior.

# Step-by-Step Workflow

1. Read `AGENTS.md` deploy-sensitive rules.
2. Inspect `git diff --name-only` and map changed files to deploy units.
3. Check relevant config when needed:
   - `config/release-compat.json`
   - `workers/*/wrangler.jsonc`
   - `workers/auth/src/app/route-policy.js`
   - `.github/workflows/static.yml`
   - migration files under `workers/auth/migrations/`
4. Determine whether the change needs:
   - Static Pages deploy
   - auth Worker deploy
   - AI Worker deploy
   - contact Worker deploy
   - D1 migration
   - R2/binding/config change
   - Cloudflare dashboard/manual follow-up
   - secrets update
5. Recommend deploy ordering.
6. State exactly what was verified and what remains manual.

# Repository-Specific Constraints

- Static Pages deploy does not deploy Workers.
- Workers deploy separately.
- Apply auth migrations before auth code that depends on them.
- Keep Worker routes/bindings aligned with `config/release-compat.json`.
- Do not assume secrets, bindings, WAF rules, transform rules, or dashboard settings exist; verify in repo docs/config or call them out as manual.
- Preserve current deploy ordering unless the task explicitly changes it.

# Validation Expectations

- Run `git diff --check`.
- Run `npm run release:plan` or `npm run release:preflight` when practical for release-impacting changes.
- Run `npm run test:release-compat` and `npm run validate:release` for route/config/migration/binding changes.
- Run `npm run test:asset-version`, `npm run validate:asset-version`, or `npm run build:static` for asset/build changes.
- If not running broad checks, explain why.

# Final Reporting Format

- Changed files reviewed
- Deploy units required
- D1 migrations required or not
- Worker deploys required or not
- Static Pages deploy required or not
- R2/binding/config/secrets/manual Cloudflare follow-up
- Recommended deploy order
- Validation commands and results
- Remaining manual checks
