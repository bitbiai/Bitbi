# AGENTS.md

## Project identity

This repository powers **bitbi.ai**.

Core architecture:
- Static frontend
- Vanilla JavaScript with ES modules
- Cloudflare Workers backend
- D1 database
- R2 storage
- Cloudflare Workers AI / related AI routes
- Existing authenticated/private member flows
- Existing admin area
- Existing image-studio / saved-assets / folder-management flows

Treat the current architecture as intentional.
Preserve it unless a change is absolutely necessary to satisfy the task safely.

---

## Primary engineering principles

- Prefer **robustness, correctness, and future scalability** over clever shortcuts.
- Prefer **low-risk, repo-native changes** over large refactors.
- Preserve working behavior unless the task explicitly requires behavior changes.
- Be conservative with auth, permissions, private media, and ownership boundaries.
- Do not introduce speculative abstractions.
- Do not switch frameworks.
- Do not add dependencies unless clearly necessary and justified.

---

## Hard guardrails

- Do not break existing auth flows.
- Do not break session handling.
- Do not break admin protections.
- Do not break favorites behavior.
- Do not break folder management.
- Do not break saved-assets flows.
- Do not break private media access rules.
- Do not make private/member assets public to simplify implementation.
- Do not replace existing architecture with a different stack.
- Do not silently change API response shapes unless all affected callers are updated.
- Do not remove or weaken ownership checks.
- Do not bypass existing requireUser / requireAdmin style protections where they exist.

---

## Backend rules

- Reuse existing backend conventions, helpers, and response patterns.
- Prefer extending the existing `workers/auth` worker rather than creating new workers, unless separation materially reduces risk.
- Reuse current route organization and naming style.
- Respect current D1 migration style and naming conventions.
- Respect current R2 bucket responsibilities.
- Respect current Cloudflare binding names unless there is a strong reason to change them.
- Keep async/background pipelines idempotent and retry-safe.
- Design queue consumers and background jobs to tolerate duplicate delivery and partial failure.
- Prefer deterministic object keys and durable state transitions.

### Data and migration rules

- New schema changes must be implemented through proper D1 migrations.
- Migrations must be safe, explicit, and compatible with existing production data.
- Avoid destructive migrations unless explicitly required.
- For evolving image/media pipelines, prefer versioned fields and version-aware logic over one-off hacks.
- Keep backfill/rebuild paths resumable.

### API rules

- Preserve existing API ergonomics unless the task requires a change.
- Keep JSON response shapes consistent with surrounding code.
- Validate input carefully.
- Return explicit errors for invalid requests.
- Keep protected endpoints protected.
- Call out any manual Cloudflare/dashboard/configuration step clearly in the final report.

---

## Frontend rules

- Preserve the current vanilla JS + ES module architecture.
- Preserve current file organization unless there is a strong reason to move files.
- Preserve current styling system and CSS structure.
- Avoid layout regressions.
- Preserve current mobile and desktop behavior unless the task explicitly changes UX.
- Do not regress:
  - mobile deck/swipe behavior
  - folder navigation
  - selection mode
  - overlay/viewer flows
  - responsive behavior
  - existing admin navigation
  - favorites/profile integrations

### UI behavior rules

- Do not let small preview/card/grid contexts load unnecessarily large originals when a smaller derivative/preset is the intended architecture.
- Prefer placeholders/skeletons/pending states over hidden fragile fallback behavior.
- Do not silently degrade private media protections for convenience.

---

## Image and media rules

- Originals are the source of truth unless the task explicitly changes that.
- Prefer fixed derivative presets over arbitrary on-demand sizes for private/member assets.
- Keep derivative/object-key strategies stable and deterministic.
- Avoid making derivative paths depend on mutable folder placement when a stable image-based path is safer.
- Preserve secure serving for private assets.
- For private/member-generated assets, prefer authenticated serving paths over public shortcuts.

---

## Performance and reliability rules

- Keep request paths lightweight.
- Avoid unnecessary reads/writes.
- Avoid race conditions.
- Prefer explicit state tracking for long-running or async flows.
- Queue-based/background designs must be:
  - idempotent
  - retry-safe
  - safe under duplicate delivery
  - safe under stale-message arrival
- Prefer boring, durable engineering over clever but fragile solutions.

---

## Testing rules

- Inspect the repo before changing code.
- Add or update meaningful tests for behavior you change.
- Do not add placeholder tests just to say tests were added.
- Reuse the repo’s current testing style and tooling.
- Run relevant tests after changes.
- Mention exactly which tests were run.
- Mention what was not tested if something could not be tested.

### High-priority regression areas

Always watch for regressions in:
- auth and session behavior
- private asset exposure
- ownership checks
- folder/image relationships
- saved-assets rendering
- admin-only behavior
- response shape compatibility
- mobile image/folder UX
- existing image studio flows

---

## Preferred workflow for tasks

1. Inspect the real repo structure first.
2. Identify the current implementation path before proposing changes.
3. Choose the lowest-risk implementation that fully satisfies the requirement.
4. Reuse existing patterns wherever possible.
5. Make coherent end-to-end changes instead of partial patchwork.
6. Update tests and docs/runbook when needed.
7. End with a concise implementation report.

Do not ask unnecessary clarification questions when the answer can be derived from repo inspection.
Make the best grounded choice and proceed.

---

## Reporting rules

Every substantial change should end with an implementation report that includes:

- Exact files changed
- Exact files added, if any
- Why each file changed
- Schema or migration changes
- Config/binding/deploy changes
- Manual Cloudflare/dashboard steps still required
- Deployment order
- Backfill/rebuild steps, if applicable
- Tests run
- Known limitations or follow-up risks

Be concrete.
Do not give vague summaries.

---

## Bitbi.ai-specific priorities

When multiple valid approaches exist, prefer the one that best preserves:

- existing auth/security posture
- current Workers + D1 + R2 architecture
- current image-studio and saved-assets flows
- current folder model
- existing admin tooling
- responsive/mobile behavior
- long-term maintainability under growth

For this repo, correctness and durability matter more than minimal code size.