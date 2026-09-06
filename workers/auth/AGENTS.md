# AGENTS.md

## Scope

These rules apply specifically to `workers/auth` and override broader repo guidance when more specific.

## Core rules

- Preserve the existing `workers/auth` architecture and route organization.
- Reuse existing helpers, response shapes, auth guards, and error-handling patterns.
- Prefer extending the current worker over introducing new workers unless separation clearly reduces risk.

## Security and access

- Do not weaken auth, session, admin, ownership, or private-media protections.
- Never expose private assets publicly to simplify implementation.
- Preserve existing `requireUser`, `requireAdmin`, and ownership-check patterns where they exist.
- Treat private media access and user-owned image access as high-risk areas.

## D1 and migrations

- Follow existing D1 schema and migration naming/style conventions.
- Make schema changes through explicit migrations.
- Prefer safe, additive migrations over destructive changes.
- Keep data migrations and backfill paths resumable and production-safe.

## R2 and media

- Respect current bucket responsibilities, especially `USER_IMAGES` and `PRIVATE_MEDIA`.
- Preserve existing object-key conventions unless a change is required for robustness.
- Prefer deterministic keys for derived assets.
- Keep originals as the source of truth unless the task explicitly changes that.

## Async and queue work

- Any queue/background processing must be idempotent and retry-safe.
- Handle duplicate delivery, stale messages, and partial failure safely.
- Prefer explicit processing state over implicit assumptions.
- Do not create flows that can get stuck permanently without recovery.

## API and compatibility

- Preserve existing API shapes unless all affected callers are updated together.
- Validate input carefully.
- Keep protected endpoints protected.
- Avoid breaking current frontend integrations.

## Verification

- Add or update meaningful tests for changed worker behavior.
- Follow root proportional validation: run relevant Worker tests for changed behavior; use focused toolchain/dependency/local build checks for tooling-only changes and relevant documentation checks for docs-only changes.
- Validate D1 migration/SQL and runtime-sensitive behavior in the target workerd/D1 implementation, beyond Node SQLite or state mocks. Use native local bindings, the actual affected fetch/scheduled/queue entrypoint, and empty/populated schema fixtures as applicable; assert specific errors, rollback, mutation counts and preserved state. Record runtime versions and distinguish local binding checks from distributed or live behavior.
- An explicitly approved repair to the Linux CI test launcher may be reviewed, locally checked where supported, committed and pushed before its real Linux acceptance on the existing CI runner. Do not require a new local Linux installation or treat source review/macOS results as a Linux isolation pass. Preserve network isolation, fail-closed behavior and every production-release gate; follow the root no-CI-wait rule.
- Reproduce, fix, test, document and commit/push within the approved package without requesting fresh approval for each internal step. Keep production maintenance and new semantics within the user's explicit scope; follow the root privacy, user-work and no-CI-wait rules.
- Call out manual Cloudflare binding/dashboard/setup steps explicitly.

## Required report for worker changes

Use the root Git workflow and “Commit/push completion: no CI waiting”, including local checks, confirmed push and a run or Actions link. CI/deployment may remain unverified; Stefan performs post-push verification. Identify migrations, Wrangler/config/binding impact, deploy order, manual setup, and limitations when relevant; no separate audit report is required.
