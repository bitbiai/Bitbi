# Main-Only Release Runbook

CI acceptance and protected-continuation procedure updated: 2026-09-30.
The broader operator readiness checklist below retains its original scope.

Status: **release procedure, not authorization**. Only the current assignment authorizes its scoped operations. This runbook does not itself approve production readiness, live billing, remote migrations, paid calls, settings/secret changes or rollback.

## Purpose

Delivery uses `main` and the existing protected release path; no separate staging environment is mandatory. Verify the task commit, affected prerequisites, tested candidate and required live evidence. Preserve unrelated working drafts; they do not belong in the task commit or candidate.

Production readiness remains **BLOCKED** unless all evidence gates are satisfied and reviewed by a human operator. Live billing readiness remains **BLOCKED**. Current readiness tooling includes a final RC validation matrix, Release Candidate Go/No-Go manifest, local-only production execution dossier, Cloudflare resource model, live-read-only verification plan, and rollback drill. These artifacts help collect evidence; they do not deploy, run remote migrations, call Cloudflare/Stripe/providers, change secrets, execute rollback, or approve readiness.

## Scope

This runbook covers current direct-main release evidence for the static site, Auth Worker, AI Worker, Contact Worker, auth D1 migration checkpoint, Cloudflare bindings/resources, Admin readiness/evidence panels, billing review/reconciliation/evidence controls, AI budget controls, tenant asset evidence, operator timeline, production execution dossier, live-read-only verification, and rollback drill.

Use `npm run release:plan` and `config/release-compat.json` as the current deploy-unit and auth migration checkpoint source.

Static/pages, Auth Worker, AI Worker, Contact Worker, and remote auth migration requirements are release-plan dependent. Repo-supported readiness is not live readiness; Cloudflare resource declarations and Wrangler parity still require operator live evidence.

`.github/workflows/static.yml` owns immutable tested frontend candidates and protected
publication; `config/static-hosting.json` selects the Cloudflare frontend Worker.
Selection uses the whole unpublished range from the last verified successful
publication. Missing/ambiguous provenance fails closed. Its existing protected
continuation may apply supported affected backend/schema prerequisites before the
tested frontend. Preserve owner review, candidate/source guards and the shared
write lock; an acknowledgement is neither authority nor evidence. See
`scripts/lib/backend-continuation.mjs`, `scripts/pages-candidate.mjs` and the current
workflow before execution. Do not redeploy unchanged components.

The following CI procedure governs ordinary delivery and explicitly requested
acceptance; the numbered operator readiness checklist is for a separately scoped
broad readiness review, not a blanket suite or deployment authorization for every edit.

## Decorative Hero acceptance

Owner decision, 2026-09-30: `decorative-fallback-v2` accepts delayed, uneven or
stalled **decorative homepage Hero** playback while a valid decoded poster/still
remains visible and the page remains usable. The native stall is unresolved, not
repaired; its bounded observation proves neither permanent failure nor eventual
recovery. Fixtures use local HTTP and loopback isolation, not Cloudflare delivery.

The existing Linux/macOS jobs still execute all selected functional scenarios.
Bounded frame, loop/seek and transition-resume observations are inline structured
`decorative-media-observation` evidence, tagged only in the allowlisted Hero cases;
missing progress is a warning, never successful playback. A finite per-case quality
budget leaves time for required checks without enlarging any observation deadline.
Visible decoded fallback/layout, Models navigation, pause/reduced-motion/cleanup
and isolation from independent players stay blocking and run despite quality
warnings. Independent media controls, Canvas preview/export, audio, generation,
save, auth, ownership and credits do not inherit this exception.

`homepage-test-selection.mjs` checks named cases and exact diagnostic classification;
`check-homepage-selection.mjs --verify-execution-report` validates the actual Full
reports. `pages-candidate.mjs` uses the same execution/diagnostic verifier before
candidate proof. The shared `homepage-media-policy.cjs` owns the version, bounded
observation schema and visible warning summary. All required cases must execute;
unknown/malformed/missing evidence, retries or genuine functional failures remain
red. Missing tags/observations, wrong policy and failed Models/fallback controls
cannot be accepted by adding a warning. Deliberately frozen media exercises the
accepted warning path separately from observed quality findings.

Keep protected jobs, environment preparation, report/artifact uploads, candidate
hashes and run/attempt identity. No whole-job exception, swallowed command failure,
retry-to-green or old-run recertification. Existing Full/release callers provide
fresh final-source functional evidence; do not repeat unrelated broad suites or
investigate accepted decorative stalls merely to remove warnings. Report completed
acceptance as “Functional acceptance passed; decorative playback limitation
accepted.” Publication still requires its own matching protected evidence.

## CI repair and required acceptance

Use this procedure when the assignment explicitly requires CI repair through final
acceptance or publication. Ordinary commit/push still ends after local checks and a
confirmed foreground push, with at most one immediate CI snapshot and unverified
status reported. Explicit acceptance instead includes the requested terminal results;
it does not authorize new production operations, paid calls or protection changes.

1. Read the matching [regression entry](../runbooks/REGRESSION_REGISTER.md). Record
   failing source SHA, run/attempt, job, command and artifacts. Reproduce against the
   actual candidate/runtime. Distinguish product defects from stale fixtures,
   measurements or synchronization using intended user behavior and source contracts.
   A test repair must accept that contract and reject a meaningful broken case;
   preserve coverage, independent assertions, unexpected-request checks and limits.
2. Inspect `package.json`, `scripts/lib/ci-test-selection.mjs` and the consuming
   workflows against the entire unpublished range from the last verified publication.
   Check discovered cases, runtime prerequisites and downstream jobs. Discovery,
   helper mocks and a green prefix of an `&&` chain are not complete acceptance.
3. For full Worker acceptance, install locked root/Auth dependencies and execute
   `bash scripts/setup-media-tools.sh` on Ubuntu; it installs and executes both
   FFmpeg and ffprobe. Run `node scripts/test-q2-runtime.mjs --preflight` before
   expensive Worker cases. `npm run test:workers` must finish the media-tool check,
   Q4 selection, Playwright routes, real `test:homepage-ffmpeg-processor` 2/5-clip
   exports, then staging/launcher self-tests and native `test:q2-runtime`. A local
   macOS pass does not certify Linux namespace/workerd/D1/R2 acceptance. Narrow
   jobs keep their actual selected callers; do not require this chain for every edit.
4. Browser repairs run the existing selected collection on the built candidate.
   `test:homepage-core` executes audio-player, canvas, oma2-q1-canvas, locale and smoke
   in Chromium/`webkit-canvas`; static.yml restores `_site` via `STATIC_TEST_ROOT`
   and retains `candidate-homepage.json` plus browser artifacts. Full selection in
   static.yml runs `test:static` and retains `candidate-static.json`, including the
   core scope. Focused EN/DE and broken-case checks precede the selected collection;
   they do not replace it. Full's
   downstream browser job runs `HOMEPAGE_EXTENDED=true npm run test:static` after
   security, Worker and required Linux/macOS homepage jobs succeed.
   Shared fixtures must establish fresh feature settings for every affected sibling
   caller. After changing native media assertions, check the final measurement in
   each affected runtime; an earlier Linux pass followed by macOS-only edits is not
   Linux evidence. Use decoded output and broken-signal controls for audio.
5. A main push starts the static workflow, not Full regression. When Full is an
   explicit acceptance requirement, first inspect runs for the exact SHA, then use
   the existing `full-regression.yml` `workflow_dispatch` if no matching requested
   run exists. Record the dispatched run's resolved SHA; do not duplicate a matching
   run or dispatch a second validation pipeline merely to publish.
6. Observe required runs with bounded status checks and regular progress updates;
   inspect newly completed failures and continue scoped repairs. Do not hand off at
   queued/running jobs or partial success. Keep source/run/attempt, case reports and
   candidate identity together. A failed/skipped required downstream gate is not a
   pass. Report an evidenced review/rights/runner blocker instead of claiming success.
   For explicit publication, finish the existing protected affected-backend/frontend
   continuation, durable receipt and authorized live verification. Reuse matching
   candidate evidence where supported; never redeploy unchanged components for a green run.

The reviewed Undici exception changes deployment classification only. For Auth,
AI and Contact, `scripts/lib/worker-tooling-impact.mjs` requires immutable Git
base/head evidence of only a forward compatible Undici development-leaf patch,
unchanged runtime/compiler inputs, and no application imports of that tool chain
or custom build/resolution path. The existing literal import traversal requires
every reached source to remain byte-identical across base/head; an unrelated
frontend-only shared module does not force an unchanged Worker deployment.
A separate proof of that same reviewed package patch can accompany an already
selected Auth runtime deployment; it never removes that deployment or admits an
unreviewed package/compiler/config change. Unknown or missing evidence retains normal
deployment requirements. Audits and affected Worker tests still run. Existing
`test:release-plan` real-Git controls cover mixed product changes, missing evidence,
runtime/tool imports, custom builds and unsafe fallback; this is not a general
development-dependency exemption.

Executable prevention stays in existing callers: `test:static-deploy-safety`
checks media setup/order and real missing-tool failures across workflow callers;
staging/launcher tests check native admission and chain order; `test:ci-selection`
and `test:release-plan` check affected selection plus unknown-input countercontrols.
Merge confirmed cause, smallest countercheck and remaining uncertainty into the
matching regression entry. Do not replace functional acceptance with prose or add
blanket suites for documentation/cosmetic edits.

## Non-Negotiable Safety Rules

- Do not paste secret values, raw cookies, bearer tokens, API keys, webhook secrets, Stripe signatures, private keys, or raw provider payloads.
- Do not run remote migrations from this runbook.
- Do not enable live billing flags from this runbook.
- Do not call Stripe APIs from this runbook.
- Do not mutate billing event records, credit ledgers, subscription state, checkout records, D1, R2, Queues, Cloudflare settings, GitHub settings, DNS, WAF, or secrets.
- Do not delete billing evidence during rollback.

## Main-Only Deploy Order

1. Verify the intended commit/candidate and preserve unrelated working drafts.
2. Run local preflight.
3. If selected and authorized, verify/apply required D1 prerequisites from `config/release-compat.json` and `npm run release:plan` before dependent backend code.
4. Deploy only required affected backend units in the contract order through the authorized protected process (AI/media before dependent Auth).
5. Publish the same tested frontend candidate through protected continuation only when required by the reviewed release plan.
6. Run the live readiness evidence collector against explicit live URLs.
7. Perform manual admin and member smoke checks required by the reviewed release plan.
8. Record evidence in `docs/production-readiness/EVIDENCE_TEMPLATE.md`.
9. Keep final verdict `BLOCKED`, `MAIN DEPLOYED - EVIDENCE INCOMPLETE`, or `MAIN DEPLOYED - OPERATOR VERIFIED`; never automatically mark production-ready.

## 1. Verify Clean Commit and Worktree

```bash
git branch --show-current
git rev-parse HEAD
git status --short
npm run check:main-release-readiness
```

Do not publish dirty or unverified candidate bytes. Preserve unrelated work and validate the intended Git/candidate inputs; this broad readiness helper's dirty-worktree result is not permission to discard user drafts. `--allow-dirty` is planning evidence only:

```bash
npm run check:main-release-readiness -- --allow-dirty --markdown
```

## 2. Run Local Preflight

```bash
npm run check:js
npm run check:secrets
npm run check:doc-currentness
npm run validate:release
npm run test:release-compat
npm run test:release-plan
npm run test:static-deploy-safety
npm run check:static-deploy-safety
npm run test:readiness-evidence
npm run test:cloudflare-resource-model
npm run test:readiness-dossier
npm run test:rollback-drill
npm run test:release-rc
npm run test:rc-check
npm run test:main-release-readiness
npm run rc:check
npm run release:rc
npm run release:rc:markdown
npm run cloudflare:resource-model
npm run readiness:dossier
npm run release:rollback-drill
npm run release:preflight
npm run release:plan
git diff --check
git status --short
```

Record pass/fail output with branch, commit, operator, and date. Do not paste secret values.

## 3. Build Production Execution Evidence

Generate the RC packet, local evidence packet, and resource model before deployment:

```bash
npm run rc:check
npm run release:rc
npm run release:rc:markdown
npm run readiness:dossier
npm run readiness:dossier:markdown
npm run cloudflare:resource-model
npm run cloudflare:resource-model:markdown
npm run release:rollback-drill
```

These commands are local-only and non-mutating. `rc:check` prints the final local validation matrix by default. The RC manifest supports code-merge/deploy preparation only. The Cloudflare model is repo-declared evidence unless the operator attaches separate live evidence. The rollback drill records placeholders and smoke checks; it does not execute rollback.

## 4. Verify Production D1 Migration Status

The production auth D1 database must be verified through the latest auth migration reported by `config/release-compat.json` before deploying current auth Worker code and before live smoke checks. Record migration names/status only.

This runbook does not provide or authorize a remote migration command. If production is not verified through the release-contract latest migration, stop and record final verdict `BLOCKED`.

## 5. Deploy Auth Worker

Task-specific deployment authority is required. Use the existing protected continuation for supported affected Auth changes; preserve review and dependency guards. Record:

- operator
- date/time
- deployed commit
- auth Worker version/deployment id if available
- rollback target
- whether live billing flags remained disabled

Do not change secrets, bindings, dashboard settings, or live billing flags as part of this checklist unless a separate approved change exists.

## 6. Publish the Tested Frontend, If Required

Use the existing protected `static.yml` path selected by the complete release plan.
Supported affected backend prerequisites precede frontend continuation; unresolved
unsupported prerequisites fail closed. A skipped mixed push does not complete an
explicit publication task. Dependency acknowledgement must reflect handled
prerequisites and never substitutes for authority, proof or owner review.

Preserve exact candidate bytes and selected successful reports, final dependency
guards and the shared publication lock. When supported, `candidate_run_id` /
`candidate_run_attempt` reuse the accepted source candidate without rebuilding or
duplicate validation. Record source and publication run/attempt, active frontend
version/readback and durable deployment receipt. If activation preceded a later
failure, reconcile actual versions and receipts before any continuation; do not
redeploy unchanged backends to obtain new annotations. Hosting/recovery details
remain in [Static hosting migration](../runbooks/STATIC_HOSTING_MIGRATION.md).

## 7. Run Live Readiness Evidence Collector

Use explicit URLs only. Do not include credentials in URLs.

```bash
npm run readiness:evidence -- \
  --include-live \
  --static-url https://bitbi.ai/ \
  --auth-worker-url https://bitbi.ai/ \
  --ai-worker-url https://<live-ai-worker-origin>/ \
  --contact-worker-url https://contact.bitbi.ai/ \
  --output docs/production-readiness/evidence/YYYY-MM-DD-main-readiness.md
```

The helper performs opt-in read-only checks and keeps the verdict `BLOCKED`. The post-deploy path is GET-only by default; admin readiness, billing evidence, operations timeline, and tenant evidence checks remain skipped/pending unless an admin cookie is supplied through the environment and redacted from output. Passing this command does not prove production readiness or live billing readiness.

## 8. Manual Admin Smoke Checks

Use a live admin account only after the operator has approved the direct-main smoke window. Redact all user data and never paste cookies or tokens.

Required live smoke areas:

- Admin login and MFA.
- Member AI generation paths in scope for the release: missing/malformed `Idempotency-Key` rejection before provider call.
- Member AI generation paths in scope for the release: valid-key success or safe provider error with no secret/raw prompt evidence.
- Member AI generation paths in scope for the release: same-key duplicate no double debit / replay or suppression when result is available.
- Member AI generation paths in scope for the release: same-key different-body conflict.
- Billing Review Queue list/filter.
- Billing Review Detail.
- Billing Review Resolution on approved test review data only.
- Billing Reconciliation report.
- Admin Control Plane Billing Review UI.
- Admin Control Plane Billing Reconciliation UI.
- No raw payload/signature/secret/card/payment method rendering.
- No Stripe action.
- No credit mutation.

## 9. Evidence Recording

Use:

- `docs/production-readiness/EVIDENCE_TEMPLATE.md`
- `docs/production-readiness/MAIN_ONLY_RELEASE_CHECKLIST.md`
- generated readiness evidence under `docs/production-readiness/evidence/`

Acceptable evidence records names, statuses, ids when safe, timestamps, pass/fail outcomes, and redacted screenshots. Unacceptable evidence includes raw secrets, full raw webhook payloads, unredacted customer data, raw cookies, or Stripe secret/signature values.

## 10. Rollback Strategy

Prepare rollback before deploying:

- Generate `npm run release:rollback-drill` and complete the placeholders before the deployment window.
- Hide or revert the static Admin Control Plane UI if the UI breaks or renders unsafe data.
- Redeploy the previous auth Worker version if an API issue appears.
- Keep live billing flags disabled.
- Do not delete billing provider events, billing reviews, checkout records, credit ledgers, member subscriptions, or reconciliation evidence.
- Do not mutate credit ledgers as rollback.
- Do not delete `member_ai_usage_attempts` rows as rollback.
- Keep migrations additive/forward-only; do not roll back by editing production D1.
- Do not call Stripe as rollback.
- Document whether rollback was required and which artifact/version was restored.

## 11. Final Verdict

Allowed direct-main release verdicts:

- `BLOCKED`
- `MAIN DEPLOYED - EVIDENCE INCOMPLETE`
- `MAIN DEPLOYED - OPERATOR VERIFIED`
- `ROLLBACK REQUIRED`

Do not use `PRODUCTION READY` as an automatic result. Production/live billing readiness remains blocked until all production, Stripe, restore, alert, WAF/RUM, legal/accounting, and remediation evidence gates are complete and reviewed.
