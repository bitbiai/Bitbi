# OMA2 Q4 release and recovery

Status: candidate work; not a production activation record. The private Q4 handoff/manifest holds exact tested inputs, artifact hashes and outstanding gates. Q2's dated technical activation remains in `OMA2_Q2_RELEASE.md`; do not repeat 0082/0083. The latest candidate checkpoint is `0086_add_fable_memory_source_revision.sql` in `config/release-compat.json`.

## Package and invariants

| Area | Change | Boundary / safe continuation |
| --- | --- | --- |
| Subscription | Local member customer relation distinct from Stripe customer ID; immutable owner/mode; receipt and once-per-period fulfillment; atomic ledger/bucket/state/event completion. | Checkout alone does not grant an allowance. A legacy bucket without retained grant proof needs separate reconciliation; no automatic historical top-up. Pack behavior remains independently tested. |
| Video jobs | Own processing token, conditional renewal, dispatch-bound durable outcome and idempotent usage continuation. | A processing claim is not a dispatch permission. Unknown/cancelled jobs remain held; a known receipt can resume without another paid Create. Unreceived outcomes remain unknown. |
| Memvid Stream | Protocol 2 claims, durable pre-upload intent, immutable UID receipt before download/completion, source retirement guards. | An unknown upload must not be retried automatically. A retained UID resumes download; late receipts never republish a removed source. Exact download UID must match the receipt. |
| Memory | Nullable immutable source revision; covered-prefix and transitive-ancestor validation at claim, finalization and following Fable/Grok context selection. | Normal appended turns preserve a valid prefix. Changed/deleted content and legacy unproven checkpoints are excluded. Real provider cost evidence remains attributable when a result is discarded. |

0084 adds the Stream receipt table, retirement/identity triggers and a bounded repair-scan index. It does not manufacture receipts for historical previews. An advisory scan position in existing `app_settings` advances through up to 64 legacy ready rows per pass; it grants no processing authority. New/resumable work is selected first. Partial scans are reported explicitly. Unknown upload intents, retired receipts and old unclaimed processing states need a bounded, separately authorized investigation; never reset them into a new upload.

0085 adds member customer ownership, subscription/period fulfillment guards and relations without rebuilding organization billing tables. Existing Stripe test-mode behavior is preserved; the live-mode subscription path receives the new fulfillment protocol. Prices, tax configuration, period allowance and Pack rules remain unchanged. Do not infer historical correctness from a successful new event.

0086 adds checkpoint source revision metadata. Legacy NULL rows remain stored but cannot be selected as proven memory. No transcript rewrite or historical regeneration is performed. The existing bounded raw-turn fallback and token/budget gates remain authoritative.

## Inputs and deployment units

- Auth Worker and exactly new migrations 0084, 0085, 0086. Applied 0065/0081/0082/0083 bytes remain unchanged.
- `services/homepage-ffmpeg-processor/processor.mjs` and `memvid-preview-flow.mjs` form the processor input. Existing GitHub processor workflows are `workflow_dispatch`, not push deployments. Their checkout/ref must identify this candidate before a later legitimate job. Do not dispatch a processing workflow as a deployment test.
- The narrow Credits subscription-dialog focus correction is an EN/DE frontend neighbor fix on the existing API contract. It does not require Q4 backend behavior. The mixed package still retains the normal Pages backend-compatibility gate; skipped Pages deployment is not frontend delivery.
- AI/Contact Worker, bindings, routes, secrets and prices have no new required deployment. Stefan has authorized one subsequent existing Pages release start for this Q4 package after its backend prerequisites are verified; this is not permission to bypass compatibility gates or dispatch media processing.
- New processor → old Auth fails its read-only protocol preflight before claiming. Old processor → new Auth receives a protocol conflict before claiming. Neither permits mixed old/new Auth writers or a rollback between preflight and claim.

## Local acceptance and limited claims

`npm run test:q4-integration` discovers the actual Q4 cases, runs their real imports, processor neighbors and the existing native runtime chain. `npm run test:workers` includes all Worker cases plus native Q2/Q4 and restricted-recovery checks. Discovery requires a minimum per functional file; no skipped/empty group is acceptance. The hosted Linux staging closure is checked against actual resolved module inputs.

Node SQLite keeps foreign keys enabled. Actual Wrangler dry-run bytes are separately exercised with native workerd/D1/R2/DO. Processor crash tests start the real CLI and terminate an OS process, with synthetic encoder bytes/provider transport. These are not real Stripe, Stream, distributed queue, billing or live acceptance tests. Preserve failed setup runs and intermediate input hashes; only final matching inputs qualify.

Required completion includes Q3 import/MFA regressions, current budgets/active hook, syntax/secret/route/DOM checks, release/selection/docs/toolchain checks and independent integrity review. The pre-push hook checks committed budgets; it does not establish functional or Linux acceptance. No CI waiting.

## Homepage acceptance before activation

The [current owner-approved coverage contract](../production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md#decorative-hero-acceptance)
removes dedicated decorative Hero playback/state/decoder/timing tests and their
native jobs, diagnostics and artifact requirements from all engines. The videos
remain unchanged. Earlier decoder incidents and failed runs stay historical;
coverage removal is not a repair or evidence of eventual playback recovery.

Linux homepage functional acceptance retains Carousel navigation, creation-stream
layout and independent public-media loading/keyboard preview. Models cold loading,
desktop/mobile navigation and accessibility remain in existing smoke suites without
video prerequisites. Selection validates actual discovery and execution; candidate
proof requires final-source functional reports and rejects retired policy manifests.
Standard/Full browser jobs depend on release/security, selected Worker and Linux
homepage success. No new pipeline or placeholder job replaces removed decoration.

`test:homepage-performance` retains one Chromium worker and genuine measurement
countercontrols. The 50ms task threshold and Carousel wall-time budgets are
diagnostic warnings; functionality, finite waits and measurement integrity remain
mandatory. Canvas, primary media/audio, generation, save, auth and accounting
coverage and the native Worker/processor path are unaffected. Existing same-origin
HTTP fixtures still support real user-media acceptance and Range contracts.

The Linux Worker launcher still proves private namespaces, UID/GID/capabilities,
NoNewPrivs, read-only inputs and absence of host sockets/credentials. Ambient
host-topology changes alone do not replace child isolation evidence. Missing
boundaries remain hard failures; bootstrap, primary and postcheck errors stay distinct.

| Check / protected requirement | Platform / input | Trigger |
| --- | --- | --- |
| Release/security/quality/selection and package ordering | Exact Git config/scripts and full unpublished range | Required for the candidate; a test-only follow-up does not activate or reclassify pending backend inputs. |
| Worker + Q4 native; accounting, schema, claims, receipts and isolation | Linux Node22 + pinned workerd/D1/R2, current imports/SQL and actual Wrangler build | Worker/runtime/shared/launcher changes and full Q4 release; preflight is not acceptance. |
| Homepage navigation, layout and independent media loading EN/DE | Chromium/WebKit, fresh built `_site`, controlled fixtures | Selected homepage/config/fixture changes; no dedicated Hero media coverage. |
| Broad auth/admin/static and Carousel engine matrix | Existing Chromium/Firefox/WebKit scopes | Required when selected; source and candidate-build results remain distinct. |
| Carousel performance and measurement controls | Single Chromium process, fresh `_site` | Timing warnings, with measurement integrity and functionality required. |
| Processor compatibility | Existing pinned workflow/ref and protocols | Release dependency; no paid generation as a test. |

The existing protected release path retains affected backend prerequisites,
source/candidate identity, approval, publication receipt and live readback. An
owner-authorized asynchronous handoff initiates required workflows and records
pending status without an active CI wait loop; it does not claim publication.

## Native image tooling security

Auth, Contact and AI each pin sharp to `0.35.4` via a project-level npm override
for [GHSA-rgj7-g3m4-5g8c](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c).
Miniflare is the only sharp parent. The former nested override passes npm12 but
fails npm10.9.8 cold `ci` with missing sharp0.35.2, both with `--prefix` and cwd;
the direct override supports the existing CI npm without an upgrade.
Generate locks with npm10.9.8 and validate from a clean checkout: `npm ci`, then
`npm run check:worker-dependency-audits -- --install`. This is also the early
standard/full-regression CI step: all three `ci`/`ls` calls, unchanged package/lock
bytes and both audits, using the invoking npm throughout. No preceding install
may repair the lock during acceptance. Report actual Node/npm/OS; npm12-only
acceptance is insufficient. npm10 omits libc hints in the lock serialization,
but preserves every platform package/version/integrity and native package bytes.
The npm-generated locks retain every optional platform; patched prebuilt libvips
packages are `1.3.3`. The dependency audit guard checks the actual Miniflare import
and loaded libheif (at least `1.23.2`) before auditing runtime and tooling. Existing
esbuild exceptions are not expanded. Quality tests reject old/nested resolutions
and missing native platform packages. The existing isolated native Worker entry
also transforms safe PNG/AVIF through the real local Images binding and rejects
invalid image data. Mac and Linux execution evidence remains separate.

sharp is used by Miniflare's local Images emulation, not by the deployed Worker
Images service. A tooling update still requires build-input/module comparison and
native acceptance; package classification alone does not require redeploying all
Workers. Preserve active Q4 schema/version receipts and distinguish changed local
build provenance from the already active artifact. No automatic migration,
processor run or production media operation is part of this dependency repair.

## Pages release preflight and completion

The private activation receipts record Q4 Auth/schema activation; a failed Pages
workflow does not undo that backend state. Do not repeat migrations or roll back
Auth because the static release guard failed.

The standard workflow runs the actual static safety CLI before test selection and
again immediately before Pages setup, with the same event, acknowledgement and
complete base/head range. All validation and deployment checkouts use the event
SHA. The Q4 release comparison remains based on `8292a492`; unknown paths and
invalid plans still block even with the manual dependency acknowledgement.
`playwright.homepage-linux-diagnostic.config.js` is an exact validation-only path;
this classification does not disable its diagnostic execution.

Standard and fast Pages workflows use the existing official
[`actions/deploy-pages`](https://github.com/actions/deploy-pages/blob/v5/src/internal/deployment.js)
action as the sole completion authority. Build/upload/guard failures, missing
outputs and cancellation cannot start deployment. Action failures remain fatal;
no independent SHA-based reconciliation can mistake an earlier publication for
this attempt. Status requests belong to the action's created deployment, with a
10-minute bound and one API error before failure. No reconciliation runs after a
skipped action. Run `npm run test:static-deploy-safety` for the full Q4 path and
workflow-state countercontrols; this is local orchestration evidence, not a live
GitHub deployment. Codex's No-CI-Wait rule remains unchanged.

## Conditional activation sequence

1. Require successful applicable CI for the exact candidate, including executed hosted Linux native stages; no old/other/skip-only result. Refresh only serving version/traffic, correct Auth D1/schema receipts/definitions, artifact hashes and valid access. Confirm no unexpected migration or newer producer changes.
2. Record the dated operator report of no active external/manual business use, plus bounded current subscription/video/Stream/Memory work, processor runs, both cron paths and the three existing Auth queues. Historical holds and a quiet queue are not proof of an idle consumer. Resolve concrete in-flight incompatible writers before schema mutation.
3. Record the Q4-specific conditional authorization from Stefan (Q4 sections 6–7) in the manifest; it covers only this package after its gates, not a general reuse of Q2 permission. With all other gates ready, use the schema-compatible Auth entry restriction and pause only required existing queue delivery. No false webhook success. The pre-schema bridge must wrap the identified current serving artifact, not a Q4-dependent recovery module. Record exactly what was paused and the objectively supported end condition for old work; do not invent a sleep-based drain guarantee.
4. Apply only unapplied exact 0084 → 0085 → 0086, each through the reviewed migration path with immediate receipt/schema confirmation. They are separate transactional steps. On ambiguous results read state first. Do not replay historical jobs, grants, webhooks or old migrations.
5. Activate the exact tested Auth artifact at the planned traffic allocation after all dependencies. Confirm serving version/modules, traffic, required schema and unchanged resources. Protocol-2 processor inputs must already be available at their pinned execution ref; no real processing canary is authorized.
6. Reopen only after those immediate technical checks; resume only this release's paused queues. Retain legacy holds and unknown outcomes. Subsequent normal business observations and longer monitoring belong to Stefan.
7. Account for the entire still-undelivered Q4 package, not only its last test repair. If a subsequent Pages start is needed, dispatch the existing static workflow once with the correct original release-plan base and `release_plan_dependency_acknowledgement=I_CONFIRM_RELEASE_PLAN_DEPENDENCIES_HANDLED` only after those actual dependencies are verified. Do not require an already successful dependent Pages deployment as a prerequisite to establishing its backend dependencies. Do not wait for the started publication; report its real pending state.

Before every mutation the next safe state and operator recovery instruction must be recorded. If CI is pending, stop before any maintenance or Cloud change and hand off the candidate. No unattended timed reopening.

## Recovery and interruption

After Q4 business state exists, the old full-function Auth writer and the historical Q2 recovery artifact are not assumed compatible. Build restricted recovery from the exact final Q4 Auth module plus the existing checked restriction adapter; native tests must retain fulfilled periods/ledger, outcomes/receipts, memory revisions, MFA consumption and tombstones. It is an emergency restricted service, not full functionality or a schema/R2 restore.

For interruption during additive schema application, keep the validated pre-schema restriction in place and record the exact last confirmed migration. After Q4 activation, use only the manifest-identified tested restricted Q4 recovery; do not restore consumed MFA proofs, repeat period grants or reactivate retired keys. Resume normal operation only with a compatible candidate and explicit confirmed resource/schema state. Separate data reconciliation, historical 0065 investigation and any new business policy remain outside this release.

### Validate once, publish the tested candidate

Q4 was published as `843a566372cefc7184a11a73ab981801ef7854ed` by run `34393537797`. Ordinary static releases now resolve their base from the latest verified successful `github-pages` deployment and its exact successful Actions deploy step. Failed/skipped pushes stay in that unpublished range. An explicit base may widen the range, but cannot omit unpublished changes. The same range drives the early/final guard, selection and schema-2 candidate manifest; `full` records the actual selection, not an unconditional historical Q4 requirement.

The early job builds one `pages-candidate-<sha>-<run>-<attempt>` artifact. Selected Linux homepage jobs and the selected broad/Admin browser job restore and hash-check those bytes before/after testing. Only selected suites require execution and matching report proofs; a selected missing, skipped, failed or empty suite blocks. Unselected jobs report that state without fabricating test passes. Full regression and Fast UI retain their separate stated scope and are not reusable candidate sources. Fresh `homepage-functional-v3` candidate proofs require exact retained functional discovery and execution, with no decorative observations; see [the owner-approved coverage contract](../production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md#decorative-hero-acceptance). Independent navigation, user-media and security failures stay blocking. Old failed runs retain their original result.

An ordinary eligible push validates and publishes once. If a separate publication is necessary, dispatch `static.yml` with the exact completed `candidate_run_id` and `candidate_run_attempt` on its still-current main SHA, keeping its release base and truthful dependency acknowledgement where required. Reuse checks own repository, source attempt/commit, computed scope, actually executed selected jobs/steps, unexpired artifact digests and all selected tested-build proofs. It rejects superseded main and later unresolved validation failures. Unknown paths and mixed backend changes still require the complete release guard; an acknowledgement cannot override unknown files. No replacement build or token is generated.

Only an eligible deploy job holds `group: pages`, shared with Fast UI. The final guard and current-main/source checks run under that lock before the official Pages action. API/permission errors fail without custom reconciliation. A failed Pages write can reuse completed passing validation, not a failed functional candidate. No-CI-Wait applies after push or a necessary reuse dispatch; a started deployment is not a published baseline.

For the reviewed Admin-reader-only production delta with its enumerated release/test-tooling follow-up, `admin-reader-v1` selects existing News, navigation, session/MFA and short homepage smoke scenarios in both Chromium and WebKit. The normal browser job tests the candidate `_site`; its report must cover every discovered case exactly once with a pass, and discovery is checked against all existing News tests. The policy is recorded inside the schema-2 selection. Unselected Worker work is reported as unselected; dedicated decorative media jobs are removed. Other production/shared/dependency or unknown inputs return to ordinary impact selection; explicit Full regression exercises retained functional and security coverage. Unresolved decorative findings in34400980411 are not reclassified as passes or reused for this delivery.
