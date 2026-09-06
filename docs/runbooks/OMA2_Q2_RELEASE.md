# OMA2 Q2 Auth release decision

Status: Q2 correction and its regression/docs/commit/push package are approved; production activation remains conditional on a verified transition. The current task permits bounded queue suspension and a restricted API entry only when that transition is demonstrably safe. This is not yet a GO decision. The release contract is `config/release-compat.json`; commands in this document do not expand the authorized scope.

## Scope and schema

| Area | Candidate behavior | Required schema |
| --- | --- | --- |
| L01 | Source mutation and executable cleanup receipt commit in one D1 batch with source guards. A consumer retires a key only after an atomic no-reference check; permanent tombstones reject later references. | 0083; existing 0081 `_v2` tables |
| B03 packs | Signed pack retries and permitted manual repair share checkout/ledger identity; receipt is distinct from atomic ledger, balance/bucket, checkout and result completion. Member balance initialization and grants participate in the same atomic boundary; competing organization grants read the current balance and enforce its cap in their insert. | Existing billing tables, constraints and idempotency indexes |
| S01/S02 | Conditional credential mutation has one winner; recovery/TOTP consume is durable before proof issuance. Credential-bound v2 proofs and response helpers preserve cookie clearing and security headers. | 0082 |

0082 adds a nullable MFA mutation marker. 0083 adds permanent object tombstones, reference guards/indexes and distinct cleanup statuses. It holds existing ambiguous `pending` receipts as `legacy_held`; it does not authorize executing or deleting them. Do not edit applied migrations, remove tombstones or turn foreign keys off. The local full migration chain starts empty; populated transition fixtures are separate evidence and do not resolve historical 0065 effects.

The original 0083 reference view fails in the target workerd/D1 implementation with `too many terms in compound SELECT`, despite passing Node SQLite. The repository now contains the approved correction grouping the same 16 reference arms without `LIMIT`; its complete SQL SHA-256 is `c4a53134309e2ced9d2487dc9e5779829a8aed29b2c6a65918b28d2efd219624`. A bounded target-D1 read confirmed 0082/0083 were unapplied before this replacement. Recheck receipts before any eventual activation; preserve the original failure fixture and never rewrite applied history.

Q2 affects Auth, its scheduled consumer and its schema. AI, Contact, external processors, public frontend behavior, bindings and secrets are unchanged. No new cloud resource or secret is required. Build inputs and exact bundle bytes must still be recorded separately from commit and serving version.

## Coexistence and recovery boundaries

| State or writer | Required treatment |
| --- | --- |
| Pre-0081 attempt/job writer | Incompatible with read-only legacy views. Never choose by age or label alone. |
| Pre-Q2 MFA request/proof | Drain old consumers before accepting the new invariant. Existing v1 MFA proofs require normal re-verification; base login sessions are retained. Never restore used recovery codes or lower accepted TOTP steps. |
| Pre-Q2 pack writer or partially fulfilled checkout | Old multi-step writers may leave partial effects. Drain before cutover; examine bounded identified incomplete states separately. No global webhook replay or automatic historical grant. |
| Pre-Q2 cleanup consumer/raw managed-key writer | No mixed-version safety guarantee. Old `pending` receipts are held, but in-flight old code must be drained before trusting the new fence. |
| Q2 cleanup after R2 failure or lost response | Retry the same permanently retired key; do not create a replacement reference. R2 and D1 are not one transaction. A late failed-reference upload can leave an orphan, not a reactivated key. |
| Still-referenced, unsupported or ambiguous cleanup | Retain held state for a separately approved, exact-candidate reconciliation decision; never promote solely from age. |
| Legacy confirmed reset executor | Keep its existing default-off gate closed. It still uses the legacy queue protocol and direct deletion; 0083 holds its receipts, so it has no Q2 automatic retry guarantee. Enabling it requires separate compatibility work/approval. |
| Return from Q2 | Only an exact artifact proven to retain Q2 MFA, billing and cleanup invariants on the forward schema. Do not use arbitrary previous Auth, revert schema, resurrect receipts or restore pre-consume data. |

The prepared C artifact wraps the exact candidate with a fixed restriction: existing login/logout, MFA verification/status and limited diagnostics remain available; other APIs return 503 and both crons start no business work. Local native tests preserve durable MFA, pack and tombstone state. C is restricted operation, not full recovery to serving artifact A. Queue delivery must be safely suspended/retained separately; `retryAll()` consumes retries and cannot park messages indefinitely. An admission restriction does not terminate already admitted HTTP, service, `waitUntil`, scheduled or queue work. Require a supported, version-specific end condition for those old executions; a sleep, quiet logs or an empty queue counter is insufficient.

The downloaded serving artifact confirms a concrete remaining edge: an already authorized Admin R2 upload can wait for request-body data and later perform a direct R2 put without a new generation check. An old scheduled invocation can also retain its previously selected cleanup array. Neither a new entry wrapper nor the D1 reference fence retroactively stops these operations. Current platform HTTP limits provide no overall wall-clock deadline. Do not start the maintenance window until an applicable termination or effect-fencing mechanism closes these edges; queue metrics and the runtime-update grace period do not establish that condition for an application deployment.

## Activation gate and sequence

1. Identify serving Auth deployment/traffic and the D1 binding. Compare bounded schema/index/trigger definitions to required 0081 and billing contracts. Receipt names are insufficient SQL identity.
2. Secure exact serving and candidate bundles privately, with SHA-256, compiler/toolchain, actual build inputs and binding/runtime metadata without secret values. Validate the intended recovery behavior on populated Q2 states and name any restricted functionality. If bytes or compatibility cannot be established, **do not activate**. Global RUM/cost/device evidence is not a prerequisite for this package.
3. Establish the concrete drain/cutover plan and objective end condition for old HTTP/service/background work, billing writers and both scheduled and queued consumers. Use the current task's conditional operational authorization only after these conditions are met; do not start a pause merely to wait for an unknown drain. No lossless handling of every in-flight request is promised. Keep the confirmed reset gate closed.
4. Within the approved transition, apply and verify the exact additive 0082 and corrected 0083 inputs before the dependent Auth artifact. On an unclear migration response, inspect receipts and definitions before retrying. Do not mix an old writer back in. Do not deploy AI/Contact/processors or Pages just because Auth changed.
5. Verify exact active version/traffic, bindings, runtime and schema via bounded reads. Inspect authorized existing request/error evidence. No real payment, generation, deletion or MFA race is an implicit smoke test; use local regressions and separately authorized operational checks.
6. Abort activation on artifact/schema mismatch, missing compatible recovery, undrained old writers, missing dependency, unexplained grant/bucket divergence, stale MFA acceptance or a referenced-key deletion. Preserve evidence and use only the prevalidated compatible recovery/forward-fix path under explicit operator authority.

The GitHub static workflow does not deploy Workers or apply migrations. Its release-plan guard must classify this as a backend/schema change and skip dependent Pages delivery. Commit/push completion follows root `AGENTS.md`: no CI waiting or monitoring; Stefan handles publication and any later cloud release.

## Local acceptance and limitations

Permanent `tests/q2-*.spec.js` regressions use actual handlers, native SQLite and synthetic R2/HTTP/cryptographic fixtures. The MFA HTTP tests also reopen file-backed state after parallel requests. `tests/helpers/sqlite-d1.js` preserves synchronous batch rollback; it does not establish workerd/D1 compatibility. The focused native workerd regression must also exercise the corrected migration, populated states, actual Auth entrypoints and relevant native D1/R2/DO behavior. Keep specific negative assertions and the original migration counterexample. Local workerd is not distributed production D1, actual queue retention, or real TLS/browser evidence.

`npm run test:workers` now includes `npm run test:q2-runtime`: private staging regressions followed by `node scripts/test-q2-runtime.mjs`. The latter accepts `--artifacts <existing-external-directory>`; otherwise it creates temporary run artifacts. Install both root and Auth dependencies from their existing lockfiles. Linux execution creates a new network namespace with loopback only and fails if that boundary is unavailable; macOS execution requires the reviewed external `sandbox-exec` profile. No target-runtime test starts the production remote-R2 configuration as a development server. The existing CI Worker job installs the pinned Auth dependencies and retains all prior gates.

Local macOS acceptance covers 15 native schema/handler stages, three reference-fixture scales and nine restricted-recovery stages. These overlap by design and are not independent end-to-end journeys. The actual Wrangler dry-run, its emitted module bytes and all 574 build inputs are recorded privately. The target uses root-lockfile `viem` 2.49.3; an earlier locally installed 2.47.17 bundle is retained as historical evidence, not the final build. Pure preparation via `node scripts/prepare-q2-recovery.mjs --candidate <actual-Wrangler-module> --sha256 <exact-hash> --outdir <new-private-directory>` writes three modules and an explicitly unverified manifest; the native results must match those exact files before treating C as tested.

Run focused native and relevant existing Worker, billing, lifecycle, auth and release suites in a credential-free, network-restricted environment, reusing unchanged evidence. Do not start Wrangler with the repository's remote R2 bindings. Complete reproduction, the authorized correction, permanent regression, concise docs and commit/push as one coherent package; do not add internal approval loops or monitor CI afterward.

The private Q2 handoff records exact executions, failures, fixture repairs, reviews, build hashes and remaining production evidence. Local correctness is not live activation or a full OMA2 completion claim. Subscription ordering, refunds, historical data repair and subsequent queue/receipt/memory packages remain separate.

A separate native neighbor check exposes an existing subscription-event customer-reference mismatch: the subscription handlers pass a Stripe provider customer reference to an event column whose foreign key expects a local billing-customer ID. Q2 does not repair subscription processing. Legacy mocked subscription passes do not establish native subscription fulfillment; retain this follow-up and its private native evidence when making billing-readiness claims.
