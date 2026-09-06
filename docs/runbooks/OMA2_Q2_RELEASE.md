# OMA2 Q2 Auth release decision

Status: code candidate only; cloud activation requires Stefan's separate explicit approval. The release contract is `config/release-compat.json`. No command in this document authorizes migration, deployment, billing replay or object deletion.

## Scope and schema

| Area | Candidate behavior | Required schema |
| --- | --- | --- |
| L01 | Source mutation and executable cleanup receipt commit in one D1 batch with source guards. A consumer retires a key only after an atomic no-reference check; permanent tombstones reject later references. | 0083; existing 0081 `_v2` tables |
| B03 packs | Signed pack retries and permitted manual repair share checkout/ledger identity; receipt is distinct from atomic ledger, balance/bucket, checkout and result completion. Member balance initialization and grants participate in the same atomic boundary; competing organization grants read the current balance and enforce its cap in their insert. | Existing billing tables, constraints and idempotency indexes |
| S01/S02 | Conditional credential mutation has one winner; recovery/TOTP consume is durable before proof issuance. Credential-bound v2 proofs and response helpers preserve cookie clearing and security headers. | 0082 |

0082 adds a nullable MFA mutation marker. 0083 adds permanent object tombstones, reference guards/indexes and distinct cleanup statuses. It holds existing ambiguous `pending` receipts as `legacy_held`; it does not authorize executing or deleting them. Do not edit applied migrations, remove tombstones or turn foreign keys off. The local full migration chain starts empty; populated transition fixtures are separate evidence and do not resolve historical 0065 effects.

Only Auth source/its scheduled consumer changes. AI, Contact, external processors, public frontend behavior, bindings and secrets are unchanged. No new cloud resource or secret is required. Root build inputs and exact bundle bytes must still be recorded separately from commit and serving version.

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

## Activation gate and sequence (later operator task)

1. Identify serving Auth deployment/traffic and the D1 binding. Compare bounded schema/index/trigger definitions to required 0081 and billing contracts. Receipt names are insufficient SQL identity.
2. Secure exact serving and candidate bundles privately, with SHA-256, compiler/toolchain, all actual source/dependency/config inputs and binding/runtime metadata without secret values. Validate a compatible recovery artifact on populated Q2 states. If bytes or compatibility cannot be established, **do not activate**. Global RUM/cost/device evidence is not a prerequisite for this package.
3. Approve a concrete drain/cutover plan for old HTTP requests, billing writers and scheduled/queued consumers. No lossless handling of every in-flight request is promised. Keep the confirmed reset gate closed. Any necessary operational switch needs its own explicit authorization within that release task.
4. Under that separate approval, apply and verify the additive 0082 and 0083 inputs before the dependent Auth artifact. Do not mix an old writer back in. Do not deploy AI/Contact/processors or Pages just because Auth changed.
5. Verify exact active version/traffic, bindings, runtime and schema via bounded reads. Inspect authorized existing request/error evidence. No real payment, generation, deletion or MFA race is an implicit smoke test; use local regressions and separately authorized operational checks.
6. Abort activation on artifact/schema mismatch, missing compatible recovery, undrained old writers, missing dependency, unexplained grant/bucket divergence, stale MFA acceptance or a referenced-key deletion. Preserve evidence and use only the prevalidated compatible recovery/forward-fix path under explicit operator authority.

The GitHub static workflow does not deploy Workers or apply migrations. Its release-plan guard must classify this as a backend/schema change and skip dependent Pages delivery. Commit/push completion follows root `AGENTS.md`: no CI waiting or monitoring; Stefan handles publication and any later cloud release.

## Local acceptance and limitations

Permanent `tests/q2-*.spec.js` regressions use actual handlers, native SQLite and synthetic R2/HTTP/cryptographic fixtures. The MFA HTTP tests also reopen file-backed state after parallel requests. `tests/helpers/sqlite-d1.js` preserves synchronous batch rollback; this is not a distributed Cloudflare D1 or real TLS/browser test. Run new tests and relevant existing Worker, billing, lifecycle, auth and release suites in a credential-free, network-restricted environment. Do not start Wrangler with the repository's remote R2 bindings.

The private Q2 handoff records exact executions, failures, fixture repairs, reviews, build hashes and remaining production evidence. Local correctness is not live activation or a full OMA2 completion claim. Subscription ordering, refunds, historical data repair and subsequent queue/receipt/memory packages remain separate.

A separate native neighbor check exposes an existing subscription-event customer-reference mismatch: the subscription handlers pass a Stripe provider customer reference to an event column whose foreign key expects a local billing-customer ID. Q2 does not repair subscription processing. Legacy mocked subscription passes do not establish native subscription fulfillment; retain this follow-up and its private native evidence when making billing-readiness claims.
