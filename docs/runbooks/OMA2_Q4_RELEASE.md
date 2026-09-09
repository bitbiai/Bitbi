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

Normal, full-regression and fast UI CI require both `homepage-validation` (Linux) and `homepage-webkit-media` (standard `macos-15`, Node 22.23.2, lockfile Playwright 1.58.2). Deploy jobs depend on both. Linux retains all Worker/workerd/D1/R2/API/security checks, Chromium video and WebKit non-decoder homepage functions, including mobile image loading. Both `homepage-hero-playback.spec.js` and `homepage-native-control.spec.js` native WebKit cases belong to mandatory macOS acceptance (the original 15 scenarios plus the native pause countercontrol); Chromium retains both in Linux acceptance. `diagnose:homepage-linux-media` separately records the two independent Linux WebKit controls, with finite play/seek/frame waits and a 60-second process-group limit. Timeout/incomplete output is a diagnostic finding, never a native pass; required test failures still block release. All three workflow paths retain this separate report. Browser-internal progress windows preserve observed output before a normal source change without weakening per-source/pause-epoch validation or increasing functional deadlines. macOS WebKit is not a real Safari/iPhone device certification.

This is Stefan's explicitly authorized 2026-09-08 acceptance-platform change. In e7ef7cbd's completed Linux runs, an ordinary original one-second MP4 stalls after its first loop even over real HTTP, outside the Hero. The historical failure remains recorded; a macOS pass does not repair or explain the Linux decoder. Revisit on a Playwright/WebKit/image/codec or media-serving change, or a matching supported-client report. An independent native frame-metadata/time/event control with the original and a second changing one-second fixture distinguishes observer and media boundaries without an FPS quota. The existing corrupt-output and frozen-slot countercontrols remain required.

`check:homepage-selection` checks actual discovery and exact Chromium/macOS native-scenario parity, plus retained Linux non-decoder coverage. The broad static job no longer repeats the dedicated native-video specs. A failed short Linux functional command stops that job immediately (`--max-failures=1`); the final macOS native media group has no fail-fast limit or retries and runs every scenario. There is no repeated overlapping native preflight. Acceptance and timing diagnostics use the built `_site` and refuse reused servers; source-based broad/Firefox tests remain complementary, not build acceptance. Artifacts upload even on failure. Native jobs test the built `_site`; macOS test processes use a private HOME, cleaned environment and inherited loopback-only OS sandbox. Image pull, installation and execution times remain separate; no future duration is guaranteed.

`test:homepage-performance` retains one Chromium worker and genuine measurement/countercontrols. The 50 ms task threshold and narrow Carousel wall-time budgets are diagnostic warnings, not release failures. Functionality, finite waits and measurement integrity remain mandatory; a historical failure is not relabelled as a pass.

Public Hero/Memvid reads stream generation-bound single byte ranges from R2 with 206/416 and matching lengths. Publication/version guards, GET-only route policy, alias redirects and immutable cache scope remain intact. Unsupported/malformed/multiple ranges use the full response. Positive synthetic native requests use real same-origin HTTP with the actual product response helper, not Playwright fulfillment. The server does not buffer production media. Native output and completed loop restarts are bound to video/source/observation epoch; pause/source changes invalidate accumulated evidence. Callback count and native `presentedFrames` metadata remain distinct.

The Linux launcher records canonical, salted host-topology differences by interface identity. Ambient topology is diagnostic, not a substitute for the isolated child's security state. Before every privileged mount/network command the fixed bootstrap verifies its exact private namespaces against the parent. The unprivileged child verifies start/end namespaces, UID/GID/capabilities/NoNewPrivs, read-only inputs and absence of host sockets/credentials; native Node/curl denial and loopback controls also run at the end. Missing/violated own boundaries remain hard failures. Primary execution and boundary postcheck failures remain separate. No origin is asserted for unrelated host interface changes.

Native pause acceptance requires confirmed pause, stable timeline/video/source identities, no cycle advancement or application play restart, followed by fresh real output on resume. Total/decoded/dropped-frame statistics are separately named diagnostics, with no invented post-pause increment budget. Raw interval evidence is attached before assertions. Ignored pause, transient source mutation and stale progress are required countercontrols. A resumed fallback turn is observed inside the browser before visibility is released: completion requires the captured slot/turn/cube/incoming face/video/source to reach its own settled target. That proof survives a later regular cycle; global idle is not a completion criterion. Missing, stuck or foreign targets fail within the existing finite deadline; observers/timers are disposed and evidence is attached before assertions.

| Check / protected requirement | Platform / input | Mandatory or diagnosis / trigger |
| --- | --- | --- |
| Release/quality/selection; correct whole-package ordering | Linux, exact Git config/scripts and original Q4 base `8292a492` | Required for the candidate; a test-only delta does not activate or reclassify pending Q4 backend inputs. |
| Worker + Q4 native; accounting, schema, claims, receipts, memory and isolation | Linux Node22 + pinned workerd/D1/R2, staged current imports/SQL and actual Wrangler build | Required for Worker/runtime/shared/launcher changes and full Q4 release. Preflight is not product acceptance. |
| Homepage functional; media, navigation, bounded image loading EN/DE | Linux Chromium + non-decoder WebKit, fresh `_site` server, synthetic HTTP | Required for homepage/config/fixture changes; exact native scenarios also run on macOS. |
| Native WebKit media; original 15 scenarios and pause countercontrol | `macos-15`, Node22.23.2, lockfile Playwright, fresh `_site`, private HOME/loopback sandbox | Required complete group, no fail-fast or retries. Missing scenario/failed job blocks release. |
| Broad auth/admin/static and Carousel engine matrix | Linux source server, Chromium; explicit Carousel Firefox/WebKit matrix | Complementary source/engine coverage retained. Source and versioned-build results are not interchangeable or merged as duplicates. |
| Carousel timing and measurement controls | Single Chromium process, same fresh `_site` and local fixtures | Timing warnings; working measurement and functional controls required. No 50ms release veto. |
| Independent native Linux WebKit divergence | Same build/MP4s, dedicated bounded two-source diagnostic | Not media acceptance; timeout/tooling status and artifacts remain explicit. Required Mac/Linux functional jobs stay independent. |
| Processor compatibility | Existing pinned workflow/ref and protocol inputs | Release dependency only; never trigger real media processing as a test. |

All three workflow paths use the same npm/config/selection contracts. Dependencies install from lockfiles before isolated execution. The complete Q4 activation still requires matching release, Worker, broad browser, Linux homepage and macOS media jobs. No duplicate job is removed on the strength of a different platform, source tree, token or fixture.


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
