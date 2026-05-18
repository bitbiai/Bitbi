# Phase 1-D Secret Rotation Report

Date: 2026-04-25

## Executive Summary

Phase 1-D separates security material that previously shared `SESSION_SECRET` across unrelated boundaries. New writes now use purpose-specific secrets for session hashing, pagination cursors, admin MFA encryption, admin MFA proof cookies, admin MFA recovery-code hashing, and generated-image save references. `SESSION_SECRET` remains only as an explicit legacy compatibility fallback during the migration window.

Risk reduced:

- A compromise of one secret no longer automatically compromises new sessions, admin MFA encrypted secrets, admin MFA proof cookies, signed cursors, recovery-code hashes, and generated-image save references.
- Missing or too-short purpose-specific auth secrets now fail closed through auth Worker config validation.
- Release compatibility and Cloudflare deploy prerequisite checks now require the new auth secret names.
- Existing compatible sessions, admin MFA material, admin MFA proofs, recovery codes, cursors, and image save references remain readable during the documented compatibility window.

Still not solved:

- This does not execute live secret rotation or provision Cloudflare secrets.
- Legacy fallback remains enabled by default until operators intentionally disable `ALLOW_LEGACY_SECURITY_SECRET_FALLBACK`.
- Admin MFA ciphertexts do not have key IDs, so MFA lazy re-encryption is deferred.
- There is no automated secret rotation scheduler or KMS-like key version registry.

## Scope

Implemented:

- Secret usage inventory.
- Purpose-specific auth secret helper.
- Dual-read/single-write migration behavior for sessions, admin MFA proofs/recovery hashes, pagination cursors, and generated-image save references.
- Ordered current-key then legacy-key decrypt attempts for admin MFA encrypted TOTP secrets.
- Opportunistic session hash upgrade after legacy session validation.
- Auth config and Cloudflare prerequisite validation for new required auth secrets.
- Worker tests for current-secret writes, legacy fallback, fallback disabled, missing-secret fail closed, and no secret value leakage in the tested error body.

Not implemented:

- Cloudflare secret provisioning.
- Production or staging deployment.
- MFA ciphertext lazy re-encryption.
- Key IDs in persisted MFA/cursor/reference payloads.
- Removal of `SESSION_SECRET` fallback.

## Phase 1-D Pre-Merge Review Findings

| Finding | Status | Evidence | Fix |
|---|---:|---|---|
| Purpose-specific auth secrets inherited the old legacy 16-character minimum in some helper/config paths. | Fixed | `workers/auth/src/lib/security-secrets.js`, `workers/auth/src/lib/config.js`, `tests/workers.spec.js` | New purpose-specific auth secrets now require at least 32 characters. Legacy `SESSION_SECRET` keeps the 16-character compatibility threshold while fallback remains enabled. |
| Admin MFA proof verification accepted any future `exp` value if the proof was correctly signed by a current or legacy candidate. | Fixed | `workers/auth/src/lib/admin-mfa.js`, `tests/workers.spec.js` | Verification now rejects proof cookies whose expiry exceeds the configured 12-hour proof TTL plus 60 seconds of clock skew. |
| Root operational docs still listed `SESSION_SECRET` as the auth Worker secret instead of the separated Phase 1-D secret set. | Fixed | `CLAUDE.md` | The root operational doc now lists the purpose-specific auth secrets and labels `SESSION_SECRET` as legacy compatibility material. |
| Continued `SESSION_SECRET` usage was reviewed for new security material. | Pass | `workers/auth/src/lib/session.js`, `workers/auth/src/lib/admin-mfa.js`, `workers/auth/src/lib/pagination.js`, `workers/auth/src/routes/ai/generated-image-save-reference.js` | Remaining `SESSION_SECRET` use is limited to explicit legacy fallback candidates, tests, docs, and prereq validation while compatibility is enabled. |

## Secret Usage Inventory

| File/path | Purpose | Previous secret | New secret | Data affected | Lifetime | Compatibility required | Migration behavior |
|---|---|---|---|---|---|---:|---|
| `workers/auth/src/lib/session.js` | Session token hashing | `SESSION_SECRET` | `SESSION_HASH_SECRET` | `sessions.token_hash` | 30 days | Yes | New sessions write current hash. Reads try current hash, then legacy hash while fallback is enabled. Successful legacy reads opportunistically update `token_hash`. |
| `workers/auth/src/routes/auth.js` | Logout session deletion | `SESSION_SECRET` | `SESSION_HASH_SECRET` plus legacy candidates | `sessions.token_hash` lookup/delete | Session lifetime | Yes | Logout deletes current and legacy candidate hashes for the cookie token. |
| `workers/auth/src/lib/admin-mfa.js` | TOTP secret AES-GCM encryption | `SESSION_SECRET` | `ADMIN_MFA_ENCRYPTION_KEY` | `admin_mfa_credentials.secret_ciphertext` and pending setup ciphertext | Until admin reenrolls or migration | Yes | New encryption uses current key. Decrypt tries current key, then legacy `SESSION_SECRET` while fallback is enabled. |
| `workers/auth/src/lib/admin-mfa.js` | Admin MFA proof cookie HMAC | `SESSION_SECRET` | `ADMIN_MFA_PROOF_SECRET` | `__Host-bitbi_admin_mfa` / `bitbi_admin_mfa` proof cookies | 12 hours | Yes | New proofs use current proof secret. Verification tries current, then legacy while fallback is enabled. |
| `workers/auth/src/lib/admin-mfa.js` | Recovery-code hashing | `SESSION_SECRET` | `ADMIN_MFA_RECOVERY_HASH_SECRET` | `admin_mfa_recovery_codes.code_hash` | Until used/regenerated | Yes | New recovery codes use current hash secret. Verification tries current and legacy hashes while fallback is enabled. |
| `workers/auth/src/lib/pagination.js` | Signed pagination cursors | `SESSION_SECRET` | `PAGINATION_SIGNING_SECRET` | Stateless pagination cursors | Client/request dependent | Yes | New cursors use current signing secret. Decode tries current, then legacy while fallback is enabled. |
| `workers/auth/src/routes/ai/generated-image-save-reference.js` | Temporary generated-image save references and user binding | `SESSION_SECRET` | `AI_SAVE_REFERENCE_SIGNING_SECRET` | 30-minute save references | 30 minutes | Yes | New references use current signing secret. Decode verifies signature and subject with the matched current/legacy candidate. |
| `js/shared/service-auth.mjs` and AI/auth worker service calls | Auth-to-AI HMAC service auth | Already separated | `AI_SERVICE_AUTH_SECRET` | Internal `/internal/ai/*` calls | 5-minute timestamp window plus nonce TTL | Existing Phase 0-A+ control | Unchanged in Phase 1-D. |

## New Secret Map

| Secret | Worker | Purpose | Required before production deploy |
|---|---|---|---:|
| `SESSION_HASH_SECRET` | `workers/auth` | Hashes new session tokens. | Yes |
| `PAGINATION_SIGNING_SECRET` | `workers/auth` | Signs new pagination cursors. | Yes |
| `ADMIN_MFA_ENCRYPTION_KEY` | `workers/auth` | Encrypts new admin MFA TOTP secrets. | Yes |
| `ADMIN_MFA_PROOF_SECRET` | `workers/auth` | Signs new short-lived admin MFA proof cookies. | Yes |
| `ADMIN_MFA_RECOVERY_HASH_SECRET` | `workers/auth` | Hashes new admin MFA recovery codes. | Yes |
| `AI_SAVE_REFERENCE_SIGNING_SECRET` | `workers/auth` | Signs generated-image save references and user bindings. | Yes |
| `SESSION_SECRET` | `workers/auth` | Legacy fallback only during migration. | Yes while fallback remains enabled |
| `AI_SERVICE_AUTH_SECRET` | `workers/auth`, `workers/ai` | Auth-to-AI service HMAC. | Existing Phase 0-A+ requirement |

Secret values must be provisioned through Cloudflare secret mechanisms only. They must not be printed, logged, committed, echoed in CI, or copied into documentation.

Purpose-specific auth secrets must be at least 32 characters. Legacy `SESSION_SECRET` remains accepted at the prior 16-character compatibility threshold only while `ALLOW_LEGACY_SECURITY_SECRET_FALLBACK` is enabled.

## Legacy Compatibility Behavior

`ALLOW_LEGACY_SECURITY_SECRET_FALLBACK` controls legacy `SESSION_SECRET` fallback behavior.

- Default: enabled, to avoid breaking existing sessions, enrolled admin MFA records, proof cookies, recovery codes, cursors, and short-lived save references immediately after deploy.
- Disabled values: `0`, `false`, `no`, or `off`.
- Production config validation requires `SESSION_SECRET` while fallback is enabled.
- After the compatibility window, operators can set `ALLOW_LEGACY_SECURITY_SECRET_FALLBACK=false` and remove `SESSION_SECRET` only after validating that legacy material has expired or migrated.

## Session Migration Behavior

New behavior:

- `createSession()` writes `sha256(token:SESSION_HASH_SECRET)`.
- `getSessionUser()` tries the current hash first.
- If fallback is enabled and the current hash is not found, it tries `sha256(token:SESSION_SECRET)`.
- If a legacy session row is found, the Worker attempts to update that row to the current hash using a compare-and-set update.
- If the opportunistic update fails, the session remains valid until natural expiry instead of locking the user out.

Tests:

- New sessions are hashed with `SESSION_HASH_SECRET`, not `SESSION_SECRET`.
- Legacy session hashes remain valid during fallback and are upgraded.
- Legacy session hashes fail when fallback is disabled.
- Missing `SESSION_HASH_SECRET` returns a generic 503 without exposing secret names or values.
- `SESSION_SECRET` is no longer required once `ALLOW_LEGACY_SECURITY_SECRET_FALLBACK=false` is explicitly set.

## Admin MFA Encryption Migration Behavior

New behavior:

- New setup/enrollment encryption uses `ADMIN_MFA_ENCRYPTION_KEY`.
- Decryption tries `ADMIN_MFA_ENCRYPTION_KEY` first and legacy `SESSION_SECRET` second while fallback is enabled.
- No key ID is added to existing ciphertext in Phase 1-D.
- Lazy re-encryption is deferred because current ciphertext rows do not identify their key and a failed rewrite could lock out admins. The safe follow-up is to add a key-version column or controlled migration path before rewriting MFA ciphertext.

Tests:

- A pending MFA secret encrypted with legacy-compatible key material can still be enabled after switching to `ADMIN_MFA_ENCRYPTION_KEY`.
- A legacy-hashed recovery code can still be consumed during compatibility.

## Admin MFA Proof Migration Behavior

New behavior:

- New proof cookies are signed with `ADMIN_MFA_PROOF_SECRET`.
- Verification tries `ADMIN_MFA_PROOF_SECRET` first and legacy `SESSION_SECRET` second while fallback is enabled.
- Proof TTL remains unchanged at 12 hours.
- Expired proofs remain invalid.
- Proofs with future expiries beyond the configured 12-hour TTL plus 60 seconds of clock skew are rejected even when signed by a valid current or legacy secret.

Tests:

- Legacy proof tokens verify only while fallback is enabled.
- Legacy proof tokens fail when fallback is disabled.
- Expired proof tokens fail.
- Far-future proof tokens fail.
- New proof cookies are not accepted if only `SESSION_SECRET` matches and `ADMIN_MFA_PROOF_SECRET` is wrong.

## Pagination And Cursor Migration Behavior

New behavior:

- New pagination cursors are signed with `PAGINATION_SIGNING_SECRET`.
- Decode verifies with the current signing secret first and legacy `SESSION_SECRET` second while fallback is enabled.
- Tampered or wrong-key cursors fail with the existing safe cursor error.

Tests:

- New cursors fail when verified with the wrong current secret and fallback disabled.
- Legacy cursors signed with `SESSION_SECRET` verify during fallback.
- Legacy cursors fail when fallback is disabled.

## Generated Image Save Reference Migration Behavior

New behavior:

- New generated-image save references are signed with `AI_SAVE_REFERENCE_SIGNING_SECRET`.
- The user-binding subject hash also uses the matched current or legacy candidate secret.
- Existing 30-minute references generated with `SESSION_SECRET` remain valid during fallback.

Tests:

- New references fail with the wrong current signing secret.
- Legacy references verify during fallback.
- Legacy references fail when fallback is disabled.

## Config And Preflight Changes

Code/config changed:

- `workers/auth/src/lib/config.js` requires all purpose-specific auth secrets.
- `workers/auth/src/lib/security-secrets.js` centralizes purpose-specific lookup and explicit legacy fallback.
- `config/release-compat.json` now lists every new auth secret as a required manual prerequisite.
- `scripts/lib/cloudflare-deploy-prereqs.mjs` includes every new auth secret in production prereq validation.
- `scripts/test-release-compat.mjs` and `scripts/test-cloudflare-deploy-prereqs.mjs` cover the new prerequisites.
- `scripts/check-js.mjs` includes the new secret helper in targeted syntax checks.

Production-ready validation must fail if required new auth secret names are missing. Live validation was not run by this implementation pass.

## Files Changed

| Area | Files |
|---|---|
| Secret helper/config | `workers/auth/src/lib/security-secrets.js`, `workers/auth/src/lib/config.js` |
| Sessions/logout | `workers/auth/src/lib/session.js`, `workers/auth/src/routes/auth.js` |
| Admin MFA | `workers/auth/src/lib/admin-mfa.js` |
| Cursor/save-reference signing | `workers/auth/src/lib/pagination.js`, `workers/auth/src/routes/ai/generated-image-save-reference.js` |
| Release/prereq tooling | `config/release-compat.json`, `scripts/lib/cloudflare-deploy-prereqs.mjs`, `scripts/test-cloudflare-deploy-prereqs.mjs`, `scripts/test-release-compat.mjs`, `scripts/check-js.mjs` |
| Tests/harness | `tests/helpers/auth-worker-harness.js`, `tests/workers.spec.js` |
| Docs | `PHASE1D_SECRET_ROTATION_REPORT.md`, `AUDIT_ACTION_PLAN.md`, `AUDIT_NEXT_LEVEL.md`, `CLAUDE.md`, `workers/auth/CLAUDE.md` |

## Commands Run And Results

| Command | Result | Notes |
|---|---:|---|
| `git status --short` | PASS | Baseline was clean before Phase 1-D changes. Current output must be reviewed before merge for all modified/untracked files. |
| `git branch --show-current` | PASS, `main` | Phase 1-D work is on `main` in this workspace. |
| `npm run test:workers` | PASS, 300/300 | Full Worker route/security suite passed after Phase 1-D tests and pre-merge review hardening coverage were added. |
| `npx playwright test -c playwright.workers.config.js tests/workers.spec.js --grep "Phase 1-D"` | PASS, 11/11 | Targeted purpose-specific secret regression block passed, including short-secret fail-closed, fallback-disabled `SESSION_SECRET` removal, and far-future MFA proof rejection coverage. |
| `npm run test:release-compat` | PASS | Release compatibility tests include the new secret prerequisites. |
| `npm run test:release-plan` | PASS | Release planner tests still pass with the existing quality-gate/preflight sequence. |
| `npm run test:cloudflare-prereqs` | PASS | Cloudflare prereq tests include missing new-secret coverage. |
| `npm run validate:cloudflare-prereqs` | PASS repo config, production BLOCKED | Repo config declares the new secret names; live validation was skipped, so production remains blocked. |
| `npm run check:toolchain` | PASS | Node/npm toolchain guard remains green. |
| `npm run test:quality-gates` | PASS | Secret, DOM sink, and toolchain scanner tests passed. |
| `npm run check:secrets` | PASS | New docs and config references did not introduce obvious committed secret patterns. |
| `npm run check:dom-sinks` | PASS | No DOM sink baseline changes. |
| `npm run check:worker-body-parsers` | PASS | Worker body parser guard remains green. |
| `npm run check:js` | PASS | Targeted syntax guard includes `workers/auth/src/lib/security-secrets.js`. |
| `npm run validate:release` | PASS | Release compatibility validation passed. |
| `npm run test:asset-version` | PASS | Asset-version tests passed. |
| `npm run validate:asset-version` | PASS | Asset-version validation passed. |
| `npm run build:static` | PASS | Static build completed. |
| `npm run test:static` | PASS, 155/155 | Static/admin UI suite stayed green after Phase 1-D. |
| `npm ci` | PASS with expected EBADENGINE warning | Root dependencies install reproducibly; this local shell uses Node `v24.14.0` while project/CI expects Node 20. |
| `npm ls --depth=0` | PASS | Root package graph resolves. |
| `npm audit --audit-level=low` | PASS, 0 vulnerabilities | Root audit has no low-or-higher findings. |
| `npm run release:preflight` | PASS | Full preflight passed for the Phase 1-D worker-auth diff. Preflight included quality gates, release compatibility, Cloudflare prereq repo validation, body-parser guard, and Worker tests, including 300/300 Worker tests. |
| `git diff --check` | PASS | No whitespace errors in the final diff. |
| `git status --short` | PASS with expected modified/untracked files | Shows the Phase 1-D modified files plus untracked `PHASE1D_SECRET_ROTATION_REPORT.md` and `workers/auth/src/lib/security-secrets.js`; both untracked files must be committed. |

Not run:

- Live Cloudflare validation, because this implementation pass does not use production/staging credentials.
- Production deploy, `release:apply`, remote Worker deploys, and remote D1 migrations.
- Worker package `npm ci`/`npm ls`/`npm audit` for `workers/auth`, `workers/contact`, and `workers/ai`, because no worker package manifests or lockfiles changed in Phase 1-D.

## Merge Readiness

Current status: conditional pass.

Merge is safe only if all Phase 1-D files listed above are committed together, including untracked `PHASE1D_SECRET_ROTATION_REPORT.md` and `workers/auth/src/lib/security-secrets.js`. A partial commit can break auth config validation, session verification, admin MFA verification, release prerequisite validation, or test harness behavior.

## Production Deploy Readiness

Current status: not production-deploy-ready from this code pass alone.

Production remains blocked until all new purpose-specific auth secrets are provisioned in `workers/auth`, existing Phase 0/1 secrets and bindings are verified, and staging confirms both current and legacy behavior.

Required before deploy:

- Provision `SESSION_HASH_SECRET` in `workers/auth`.
- Provision `PAGINATION_SIGNING_SECRET` in `workers/auth`.
- Provision `ADMIN_MFA_ENCRYPTION_KEY` in `workers/auth`.
- Provision `ADMIN_MFA_PROOF_SECRET` in `workers/auth`.
- Provision `ADMIN_MFA_RECOVERY_HASH_SECRET` in `workers/auth`.
- Provision `AI_SAVE_REFERENCE_SIGNING_SECRET` in `workers/auth`.
- Keep `SESSION_SECRET` present while `ALLOW_LEGACY_SECURITY_SECRET_FALLBACK` remains enabled.
- Keep matching `AI_SERVICE_AUTH_SECRET` in both `workers/auth` and `workers/ai`.
- Keep `SERVICE_AUTH_REPLAY`, `AI_VIDEO_JOBS_QUEUE`, `USER_IMAGES`, and auth migrations through `0030` verified as required by prior phases.
- Run repo validation and staging checks without printing secret values.

## Backward-Compatible Rollout Plan

1. Add the new purpose-specific secrets to staging.
2. Keep `SESSION_SECRET` present and keep fallback enabled.
3. Deploy Phase 1-D code to staging.
4. Verify new login/session creation writes `SESSION_HASH_SECRET` hashes.
5. Verify old sessions created with `SESSION_SECRET` still work and upgrade.
6. Verify enrolled admin MFA still works for legacy encrypted records and recovery codes.
7. Verify new MFA setup/proofs use purpose-specific secrets.
8. Verify pagination cursors and generated-image save references work during the transition.
9. Add the new purpose-specific secrets to production.
10. Deploy Phase 1-D code to production.
11. Monitor auth, admin MFA, cursor, and AI save-reference errors.
12. After the compatibility window, set `ALLOW_LEGACY_SECURITY_SECRET_FALLBACK=false` in staging, validate, then repeat in production.
13. Remove `SESSION_SECRET` only after fallback is disabled and no legacy dependencies remain.
14. Rotate purpose-specific secrets independently by boundary with a planned grace window.

## Rollback Plan

- If a new purpose-specific secret is missing, the auth Worker should fail closed with a generic 503. Provision the missing secret rather than disabling validation.
- If a new session secret is wrong, rollback to the previous code or set the correct secret; legacy sessions can still work while fallback and `SESSION_SECRET` remain present.
- If an admin MFA key is wrong, restore the correct `ADMIN_MFA_ENCRYPTION_KEY` or rollback while keeping `SESSION_SECRET` available; do not delete MFA records.
- If admin proofs fail unexpectedly, restore the previous `ADMIN_MFA_PROOF_SECRET` or rely on re-verification while fallback remains enabled.
- If pagination/save-reference compatibility fails, rollback code or re-enable fallback; cursors/save references are short-lived and can be regenerated.
- Do not disable `SESSION_SECRET` or fallback as part of emergency rollback unless legacy material is proven unnecessary.

## Remaining Risks

| Risk | Impact | Blocks merge | Blocks production deploy | Next action |
|---|---|---:|---:|---|
| New secrets not live-provisioned | Auth Worker fails closed or specific auth/MFA/cursor flows fail. | No | Yes | Provision and live-verify all new auth secrets in staging and production. |
| Legacy fallback remains enabled | `SESSION_SECRET` remains useful for legacy material until disabled. | No | No during migration | Define a migration window, monitor, then disable fallback. |
| MFA ciphertexts lack key IDs | Lazy re-encryption cannot be safely automated yet. | No | No | Add a key-version column or controlled MFA re-enrollment/migration plan. |
| No automated rotation scheduler | Secret rotation is still operational/runbook driven. | No | No | Add a key-versioned rotation runbook and tests before routine rotations. |
| Live Cloudflare validation not run locally | Repo checks cannot prove dashboard state. | No | Yes | Run live prereq validation in staging with credentials. |

## Next Recommended Actions

1. Commit all Phase 1-D files together after final validation.
2. Provision the six new `workers/auth` purpose-specific secrets in staging without printing values.
3. Deploy Phase 1-D to staging with `SESSION_SECRET` still present and legacy fallback enabled.
4. Verify new sessions/proofs/cursors/save references use purpose-specific secrets while legacy material still works.
5. Define the fallback-disable date and a follow-up plan for MFA key IDs or controlled re-encryption.
