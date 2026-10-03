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

Owner decision, 2026-09-30, supersedes the warning-only policy: remove all
**dedicated decorative homepage Hero video** automated tests, state/decoder/timing
probes, synthetic controls and diagnostics from every engine, local/default
collection, scheduled Full and release. No warning-only run, skipped placeholder,
poster/freeze replacement or native Hero job remains. The actual videos are
unchanged; the unresolved stall is accepted without further investigation. This
coverage decision is not a playback repair and does not recertify failed runs.

Existing functional suites retain independent EN/DE Models navigation, cold
loading, responsive layout and accessibility. Canvas, user-controlled players,
audio, generation, saving, authentication, ownership, credits and security remain
required under their existing selection. Mixed navigation tests have no Hero
playback, poster, video-ready or decoder prerequisites.

`check:homepage-selection` checks actual retained discovery and rejects retired
Hero scenarios in every configured/default collection. Required execution reports
must match functional discovery; missing, malformed, failed, skipped or retried
required cases fail. Full and Fast invoke the report verifier; static candidate
proof uses the same contract. `MEDIA_POLICY=homepage-functional-v3` versions the
manifest boundary and rejects old candidate policies; no `decorativeMedia` proof
or native-Hero artifact is required. Source/run/attempt identity, selected-job
success, candidate bytes, backend prerequisites and protected publication remain
unchanged. Old failed artifacts are historical evidence only.

Before every task push, `npm run test:quality-gates` executes the actual repository
secret scan as well as guard tests. The installed push hook scans each proposed
branch-tip Git tree with the same CI secret rules and file selection, alongside
the existing budgets. Guard unit tests alone are not a repository scan. A clean
working file cannot hide a failing committed blob; diagnostics contain only
path, line and rule. Keep the independent CI secret step and its detection rules.

## CI repair and required acceptance

The website assistant and `/admin/#website-assistant` publish through this same
Auth → frontend path with inference off. Model access does not block the disabled
release; activation still requires genuine access, pricing/terms, explicit spending
approval and EN/DE acceptance. Settings never reset its durable budget. See
[Website assistant](WEBSITE_ASSISTANT.md) for knowledge preview/recovery, scoped
disable and focused checks; fixture success does not authorize activation.

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
   downstream browser job runs `npm run test:static` after
   security, Worker and selected Linux homepage jobs succeed.
   Shared fixtures must establish fresh feature settings for every affected sibling
   caller. For retained user-media assertions, check the final measurement in each affected
   runtime; local macOS success is not Linux evidence. Use decoded output and broken-signal controls for audio.
5. A main push starts the static workflow, not Full regression. When Full is an
   explicit acceptance requirement, first inspect runs for the exact SHA, then use
   the existing `full-regression.yml` `workflow_dispatch` if no matching requested
   run exists. Record the dispatched run's resolved SHA; do not duplicate a matching
   run or dispatch a second validation pipeline merely to publish.
6. Observe required runs with bounded status checks unless the owner explicitly
   requests asynchronous handoff. In that mode, initiate each required existing
   workflow once for the exact SHA, record links/checkpoint and stop active waiting;
   pending CI/publication remains open. Otherwise inspect completed failures and
   continue scoped repairs. Never report queued/running jobs as acceptance. Keep source/run/attempt, case reports and
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
staging/launcher tests check native admission, chain order and the actual suite/control source plus filesystem-media input closure after required root/Auth dependency preparation; `test:ci-selection`
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

For an explicitly reviewed browser-fixture correction, the existing closed repair
continuation can preserve successful source cases and completed upstream jobs. It
requires exact source/run/attempt and artifact digests, unchanged product/build/
backend inputs, reviewed before/after test hashes, complete fresh discovery and
fresh execution of every changed, failed or flaky case plus unexecuted command
tails. Its composite proof names the original and new evidence separately; the
old failed run remains failed. Unknown deltas, missing cases, new failures, stale
artifacts or incomplete proof block publication. This is not general permission
to reuse failed candidates or to repeat a failed job until it turns green. The reviewed incident profiles preserve their own immutable provenance; the Omni catalog correction reuses 297 unchanged browser passes plus successful Worker acceptance and executes exactly six repaired Chromium/WebKit cases. Its complete discovery must remain 303 cases. Preparation requires the selected independent proofs only; an unselected homepage job is not fabricated or rerun.

Private-media release admission is checked through the authenticated smoke route
before seeding fixed synthetic jobs. Its write-free preflight validates the serving
media source, protocol marker and exact fixtures. Only explicit source mismatch or
the prior handler's exact legacy rejection can be observed within the bounded
readiness window; neither is acceptance. Invalid credentials, fixtures, responses
and output proofs fail closed. Mutating smoke actions are never retried by this
readiness check. Persist fixed action/backend/status/reason diagnostics without
request bodies, private media or credentials. After partial activation, preserve
the original media source/artifact and active-version identity when unchanged
inputs and protected activation provenance are verified; require fresh backend
functional acceptance before frontend continuation. See the `8c0cb42a` incident in
the [regression register](../runbooks/REGRESSION_REGISTER.md).

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

## Seedance 2.5 custom output-duration pricing

Owner decision, 2026-10-03: exact `bytedance/seedance-2.5` uses BITBI's custom
stored-output-duration rule. The four owner rates are USD 0.1028/0.4304 per second
at 480p and 0.2312/0.9676 at 720p (non-video/video input). The unmapped average is
0.4330; the duplicate default does not enter that average. Apply the approved 5%
funding factor once, the central 20% margin, configured FX/net-credit value and
final upward credit rounding. These are owner-supplied rates, not independently
verified Cloudflare metering. No paid provider acceptance was performed.

Forward migration 0099 adds six **Custom configurations**, preserves previous
rules and accepted tariff pins, and advances the pricing revision. Native fixtures
must read that revision; they must not assume a new migrated database starts at
zero. Actual validated video references determine the execution tier. Every run
shows a 30-second reservation ceiling; settlement measures the stored original,
releases unused credits and fails closed for unknown duration/format. Recovery
uses the same pinned price without another inference. Use existing area switches
to stop new work; preserve already-dispatched results and holds for reconciliation.
Do not roll back applied migrations or restore old prices over later Admin edits.

The existing Canvas/model release selection executes Seedance Worker boundaries,
member-generation/model-pricing/Canvas native suites and tagged Chromium/WebKit
controls. `test:ci-selection`, the actual shell countercheck in the runtime launcher,
`test:release-plan` and `test:static-deploy-safety` guard discovery, execution and
0099 → AI → Auth → exact frontend publication. Unchanged media and Contact stay
out of deployment. Local fixture acceptance includes 52 owned references, Auto/
fixed output settlement, queued OFF/running completion, storage recovery and MOV
playback/native audio; it does not establish provider quality or production state.

## Gemini Omni Flash: publication and owner activation

The owner-approved integration targets only `google/gemini-omni-flash` through the
existing Cloudflare binding/Gateway. Admin Lab, Generate Lab and Canvas share
`js/shared/gemini-omni-contract.mjs`: text, first/last frames, ten ordered image
references, independent video editing and audio references; 16:9/9:16 and
360p/720p/1080p/4k. These are implemented adapter inputs, not live provider
acceptance. Generated audio is requested in the instruction, separately from an
uploaded audio reference. There is no duration, seed or audio-toggle parameter;
4k is an output choice, not a native-render claim. Stateful
`previous_interaction_id` continuation is deferred. Only an explicit returned
interaction field is preserved; job/asset/Gateway IDs are never substituted.

Release AI → Auth → the tested frontend using the existing protected continuation.
No new migration, secret, resource or media deployment is needed. Default Omni
readiness in `app_settings` is off for Admin tests and every member capability/
resolution. On 2026-10-03 the owner explicitly authorized platform-wide activation
with all 20 operation/resolution tariffs at 100 credits per request. The audited
runtime setting records that exception, its previous disabled state, and that no
real provider acceptance was performed. This is configuration activation, not
verified provider quality or a known provider cost. Website-assistant public off
is independent and remains off.

In English Admin, use Model Pricing to set **final credits per request** for each
Omni operation/resolution. No factory price is guessed and no second margin is
applied. Reset removes that member tariff and blocks new admissions for it.
Provider cost remains unknown. Existing accepted quotes keep their pinned tariff,
including after edits/reset; uncertain dispatches are never regenerated blindly.
In Model Status, separately enable explicitly initiated Admin tests with a positive
platform-budget reservation. Existing platform caps/switches still apply, without
requiring a member tariff. A completed owned Admin job plus an explicit acceptance
note is required by the ordinary Admin activation API for each member input
capability and resolution; the dated owner/operator exception above did not
remove that API guard or invent acceptance jobs. Review
its actual result; successful storage alone is not quality approval. Admin API
reads and changes retain MFA/CSRF protection, revision conflicts and audit history.
Deactivation blocks fresh dispatches, including queued work checked before the
provider call; it cannot recall a provider request already dispatched. The public
Models overlay additionally requires a usable activated and priced configuration.
Guest session initialization must refresh public tariffs after clearing a prior
snapshot; Admin denial still blocks pricing. Browser-only price-client changes
use the existing model-pricing selection and both-engine pricing suite, without
repeating unchanged Worker/native suites. Added backend/shared/unknown inputs
restore the broader selection.

Private uploads/asset pickers and Canvas roles/order retain ownership and source
version checks. Generate Lab retains Omni settings/reference IDs per signed-in
owner in tab storage, without storing the instruction there. Admin and Canvas use
their existing persisted forms/nodes. Inline output is bounded to 16 MiB by BITBI's
existing receipt transport; HTTPS output uses the existing bounded downloader.
Admin inline bytes use the existing job output reference/cleanup fence. Storage
resumption and duplicate delivery must reuse the same received result.

Acceptance callers: selected Canvas/model branch in `static.yml`,
`q2-gemini-omni.spec.js`, native `--suite member-generation`, `--suite model-pricing`
and `--suite canvas`; tagged Admin/Generate Lab/Canvas cases and Model Pricing in
Chromium/WebKit. Candidate proof requires both workspace and pricing reports.
Synthetic fixtures establish these contracts, never paid/live capability success.
Local native evidence (2026-10-03 working candidate): member-generation 66,
model-pricing 10, Canvas 85 passed. Final Git/run/attempt and production receipts
belong in the task checkpoint; these local counts do not certify CI/publication.

Selection maintenance: the shared `CANVAS_RELEASE_SCOPES`/`canvasReleaseProject`
contract covers workspace and pricing engines in both real discovery and candidate
proof. Existing `test:static-deploy-safety` imports the real `test:homepage-selection`
guard through `test-pages-workflow`; discovery/candidate repairs must execute that
caller on final inputs. The guard discovers tests without running browsers. Do not
add a new coverage file/project only to workflow and proof fixtures: the omitted
discovery comparison caused `37105294832/1` to stop before candidate creation.
Such a pre-candidate failure has no reusable hosted functional acceptance; retain
valid local evidence and execute the still-required CI tail through the existing
workflow, without a duplicate Full dispatch or relabelling skipped jobs.

Prepared paid acceptance proposal, **not executed or authorized by this note**:
after the owner reviews actual account costs, approve a total USD 10 ceiling and
at most three single attempts: (1) text at 360p/16:9 with requested audible content,
(2) first/last frames at 720p/9:16, (3) owned short-video editing plus an audio
reference at 360p. Stop on unknown outcome, rejection, missing retained output or
budget exhaustion; reconcile before another attempt. If verified rates do not
bound a requested attempt within the remaining ceiling, do not submit it. Other
resolutions/reference modes remain off until separately accepted. No autonomous
paid calls, top-ups, model substitution or inferred Cloudflare bill.

## Model area availability

Admin → AI & Models → Model status (`/admin/index.html#model-status`) derives its
availability overview from the shared member and runnable Canvas registries.
Generation Lab and Canvas use independent versioned `app_settings` entries; an
absent entry preserves existing eligibility. Invalid state fails closed. Each
mutation compares its own revision, records actor/time and previous state, and
requires Admin/MFA/CSRF without a user-supplied reason. Pricing and Admin Lab remain
independent. Main controls the existing assistant durable mode; its legacy false
deployment flag is a compatibility sentinel, not a second activation veto. Main
starts off; access, terms, prices, approved budgets and real EN/DE acceptance remain
required. Main off preserves independent Admin testing.

OFF omits new-use selectors. Canvas keeps nodes, edges and retained outputs, with
the localized disabled note; downstream reuse does not invoke the source model.
Trusted route/queue context determines the area, never a client workspace header.
Admission and atomic SQL dispatch checks reject OFF before new provider exposure;
undispatched holds use the existing release lifecycle. Dispatched work and retained
output recovery finish/settle normally. Migration 0098 adds guards only: no policy
seeding or data rewrites. Recovery keeps this compatible Auth/schema active; restore
an individual switch through its current revision, never delete policy keys or
roll back to an Auth build that ignores them.

The closed `model-area-availability-v1` selection extends the existing model-status
Worker/browser callers: policy/SQL and native Admin, queue, organization billing,
plus existing Canvas/Admin boundaries; both browser engines exercise Admin, EN/DE
Generation Lab/Canvas and Main Help. `MODEL_STATUS_ASSISTANT=true` includes the
existing Main suite in discovery and execution. Candidate proof requires both
files/engines; failure/skip/missing reports block publication. Unknown billing,
session or provider siblings cannot use this scope; ordinary read-only status and
cosmetic scopes retain their narrower checks. No decorative Hero tests or paid
inference. Native/local fixtures prove enforcement, not live model quality.
