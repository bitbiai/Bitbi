# Phase 3.4 Member Image Gateway Main-Only Checklist

Last updated: 2026-05-15

Default verdict: **BLOCKED**

Allowed final verdicts:

- `BLOCKED`
- `MAIN DEPLOYED - EVIDENCE INCOMPLETE`
- `MAIN DEPLOYED - OPERATOR VERIFIED`
- `ROLLBACK REQUIRED`

## Purpose And Scope

This checklist is for the owner-run direct `main` release of the Phase 3.4 member personal image AI Cost Gateway pilot. Phase 3.4 changed only member personal `POST /api/ai/generate-image` and added the additive auth D1 migration `0048_add_member_ai_usage_attempts.sql`.

This is a main-only release process, not staging. Direct-main deployment is riskier because the first deployed environment is live. This checklist does not deploy, run remote migrations, mutate Cloudflare, call AI providers, call Stripe, change secrets, enable live billing, approve production readiness, or approve live billing readiness.

## Required Local Checks Before Deploy

Run from the reviewed repo commit and record pass/fail output. Do not paste secret values.

```bash
npm run check:js
npm run check:secrets
npm run check:doc-currentness
npm run validate:release
npm run test:release-compat
npm run test:release-plan
npm run test:readiness-evidence
npm run test:main-release-readiness
npm run test:ai-cost-gateway
npm run test:ai-cost-policy
npm run test:ai-cost-operations
npm run check:ai-cost-policy
npm run release:plan
npm run release:preflight
git diff --check
git status --short
```

| Check | Evidence | Result |
| --- | --- | --- |
| Branch/commit recorded |  | BLOCKED |
| Worktree clean before direct-main release |  | BLOCKED |
| `npm run release:plan` attached |  | BLOCKED |
| `npm run release:preflight` passed |  | BLOCKED |
| Latest auth migration is `0048_add_member_ai_usage_attempts.sql` |  | BLOCKED |
| Release plan reports auth schema checkpoint 0048 and auth Worker |  | BLOCKED |
| Release plan reports static/pages not required for Phase 3.4 |  | BLOCKED |
| AI Worker/contact Worker not impacted |  | BLOCKED |

## Mandatory Deploy Order

Operator action only. Codex must not run these deploy or remote migration actions.

1. Verify current commit.
2. Run release preflight.
3. Apply remote auth D1 migration `0048_add_member_ai_usage_attempts.sql`.
4. Verify remote auth D1 migration status through `0048_add_member_ai_usage_attempts.sql`.
5. Deploy the auth Worker from the reviewed commit.
6. Run readiness evidence with explicit live URLs.
7. Perform manual member personal image smoke checks.
8. Record the final operator verdict.

Do not deploy the auth Worker before migration `0048` is applied and verified. The Phase 3.4 runtime depends on `member_ai_usage_attempts` for member image reservations, idempotency conflict detection, and replay metadata.

## Remote Migration Evidence

Record migration status only. Do not paste credentials, tokens, dashboard secrets, raw database contents, or customer data.

| Evidence Item | Evidence | Result |
| --- | --- | --- |
| Operator who applied or verified migration |  | BLOCKED |
| Remote auth DB name/environment |  | BLOCKED |
| Migration `0048_add_member_ai_usage_attempts.sql` applied |  | BLOCKED |
| Migration status verified after apply |  | BLOCKED |
| No destructive migration steps observed |  | BLOCKED |

## Auth Worker Deploy Evidence

| Evidence Item | Evidence | Result |
| --- | --- | --- |
| Auth Worker deployed from reviewed commit |  | BLOCKED |
| Auth Worker deployment id/version recorded if available |  | BLOCKED |
| Rollback target recorded |  | BLOCKED |
| Live billing flags unchanged/disabled unless separately approved |  | BLOCKED |
| No secret values printed |  | BLOCKED |

## Member Personal Image Smoke Checks

Use approved operator accounts and safe prompts only. Do not paste raw cookies, bearer tokens, secrets, raw provider payloads, or unredacted user data. Do not use these smoke checks to claim all AI routes are migrated.

| Smoke | Expected | Evidence | Result |
| --- | --- | --- | --- |
| Member personal image request without `Idempotency-Key` | rejected before provider call |  | BLOCKED |
| Member personal image request with malformed `Idempotency-Key` | rejected before provider call |  | BLOCKED |
| Member personal image request with valid key and sufficient credits | succeeds or returns safe provider error |  | BLOCKED |
| Duplicate same-key/same-request | no duplicate debit; replay/suppression when result available |  | BLOCKED |
| Same-key/different-request | idempotency conflict before provider call |  | BLOCKED |
| Insufficient-credit path, if safely testable | rejected before provider call |  | BLOCKED |
| Provider-failure no-charge path, if tested only with approved mocks/non-live provider controls | no credit debit |  | BLOCKED |
| Org-scoped image behavior | unchanged from existing org attempt path |  | BLOCKED |
| Admin legacy/no-org image behavior | unchanged/exempt as documented |  | BLOCKED |

## Safety Checks

| Check | Evidence | Result |
| --- | --- | --- |
| No raw prompt stored in attempt metadata evidence |  | BLOCKED |
| No secrets/cookies/tokens in response or evidence |  | BLOCKED |
| No member music route migrated |  | BLOCKED |
| No member video route migrated |  | BLOCKED |
| No admin/platform/internal AI route migrated |  | BLOCKED |
| No public pricing or billing UI changed |  | BLOCKED |
| No Stripe API call |  | BLOCKED |
| Production/live billing remains BLOCKED |  | BLOCKED |

## Readiness Evidence Command

Use explicit URLs only. This helper is read-only and keeps the verdict blocked.

```bash
npm run readiness:evidence -- \
  --include-live \
  --static-url https://bitbi.ai/ \
  --auth-worker-url https://bitbi.ai/ \
  --ai-worker-url https://<live-ai-worker-origin>/ \
  --contact-worker-url https://contact.bitbi.ai/ \
  --output docs/production-readiness/evidence/YYYY-MM-DD-phase3-member-image-main-readiness.md
```

## Rollback Notes

- Redeploy the previous auth Worker version if the member personal image route fails in a way that cannot be safely mitigated.
- Keep migration `0048` as additive/forward-only; do not delete or roll back the table destructively.
- Do not delete `member_ai_usage_attempts` rows as rollback.
- Do not mutate member credit ledgers as rollback.
- Do not call Stripe or mutate billing records as rollback.
- If needed, temporarily disable or hide the affected member personal image route through an approved runtime/operator mitigation rather than deleting evidence.

## Final Operator Verdict

Final verdict:

Rationale:

Operator:

Date:

Commit:

Evidence links:

Remaining blockers:
