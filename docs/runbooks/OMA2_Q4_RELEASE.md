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
- AI/Contact Worker, bindings, routes, secrets and prices have no new required deployment. No manual Pages dispatch or compatibility-gate bypass is implied by backend activation.
- New processor → old Auth fails its read-only protocol preflight before claiming. Old processor → new Auth receives a protocol conflict before claiming. Neither permits mixed old/new Auth writers or a rollback between preflight and claim.

## Local acceptance and limited claims

`npm run test:q4-integration` discovers the actual Q4 cases, runs their real imports, processor neighbors and the existing native runtime chain. `npm run test:workers` includes all Worker cases plus native Q2/Q4 and restricted-recovery checks. Discovery requires a minimum per functional file; no skipped/empty group is acceptance. The hosted Linux staging closure is checked against actual resolved module inputs.

Node SQLite keeps foreign keys enabled. Actual Wrangler dry-run bytes are separately exercised with native workerd/D1/R2/DO. Processor crash tests start the real CLI and terminate an OS process, with synthetic encoder bytes/provider transport. These are not real Stripe, Stream, distributed queue, billing or live acceptance tests. Preserve failed setup runs and intermediate input hashes; only final matching inputs qualify.

Required completion includes Q3 import/MFA regressions, current budgets/active hook, syntax/secret/route/DOM checks, release/selection/docs/toolchain checks and independent integrity review. The pre-push hook checks committed budgets; it does not establish functional or Linux acceptance. No CI waiting.

## Homepage acceptance before activation

Normal, full-regression and fast UI CI retain their existing broad suites and add an independent mandatory `homepage-validation` job. `check:homepage-selection` records actual discovery/coverage; `test:homepage-functional` checks Chromium/WebKit carousel, Hero and media behavior. `test:homepage-performance` uses one Chromium worker, no retries and no tracing during timing; its 50 ms page-work gate remains required. Failure evidence is uploaded without waiting for the long browser regression. Discovery counts and successful retries are not acceptance.

The performance observer reads no geometry, includes tasks crossing input/completion boundaries and drains late native records. It reports the complete document through the stable post-settle window, not guessed carousel attribution or field INP. Functional runs publish timing but cannot replace this controlled performance gate. Native blocking countercontrols must be rejected; missing Long Tasks support is a failed performance prerequisite. Real-clock measurements remain separate from Hero clock/state fixtures. Hero continuity is checked during confirmed suspension and at native resume; a legitimately due next video after resume is tested separately. The original CI145/162 ms tasks lack function attribution; no runner-load explanation is asserted without evidence.

## Conditional activation sequence

1. Require successful applicable CI for the exact candidate, including executed hosted Linux native stages; no old/other/skip-only result. Refresh only serving version/traffic, correct Auth D1/schema receipts/definitions, artifact hashes and valid access. Confirm no unexpected migration or newer producer changes.
2. Record the dated operator report of no active external/manual business use, plus bounded current subscription/video/Stream/Memory work, processor runs, both cron paths and the three existing Auth queues. Historical holds and a quiet queue are not proof of an idle consumer. Resolve concrete in-flight incompatible writers before schema mutation.
3. Record the Q4-specific conditional authorization from Stefan (Q4 sections 6–7) in the manifest; it covers only this package after its gates, not a general reuse of Q2 permission. With all other gates ready, use the schema-compatible Auth entry restriction and pause only required existing queue delivery. No false webhook success. The pre-schema bridge must wrap the identified current serving artifact, not a Q4-dependent recovery module. Record exactly what was paused and the objectively supported end condition for old work; do not invent a sleep-based drain guarantee.
4. Apply only unapplied exact 0084 → 0085 → 0086, each through the reviewed migration path with immediate receipt/schema confirmation. They are separate transactional steps. On ambiguous results read state first. Do not replay historical jobs, grants, webhooks or old migrations.
5. Activate the exact tested Auth artifact at the planned traffic allocation after all dependencies. Confirm serving version/modules, traffic, required schema and unchanged resources. Protocol-2 processor inputs must already be available at their pinned execution ref; no real processing canary is authorized.
6. Reopen only after those immediate technical checks; resume only this release's paused queues. Retain legacy holds and unknown outcomes. Subsequent normal business observations and longer monitoring belong to Stefan.

Before every mutation the next safe state and operator recovery instruction must be recorded. If CI is pending, stop before any maintenance or Cloud change and hand off the candidate. No unattended timed reopening.

## Recovery and interruption

After Q4 business state exists, the old full-function Auth writer and the historical Q2 recovery artifact are not assumed compatible. Build restricted recovery from the exact final Q4 Auth module plus the existing checked restriction adapter; native tests must retain fulfilled periods/ledger, outcomes/receipts, memory revisions, MFA consumption and tombstones. It is an emergency restricted service, not full functionality or a schema/R2 restore.

For interruption during additive schema application, keep the validated pre-schema restriction in place and record the exact last confirmed migration. After Q4 activation, use only the manifest-identified tested restricted Q4 recovery; do not restore consumed MFA proofs, repeat period grants or reactivate retired keys. Resume normal operation only with a compatible candidate and explicit confirmed resource/schema state. Separate data reconciliation, historical 0065 investigation and any new business policy remain outside this release.
