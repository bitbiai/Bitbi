# Manual Review Idempotency Evidence Runbook

Date: 2026-05-18

Purpose: collect sanitized operator evidence for the remaining AI folders/images manual-review idempotency gaps. This runbook is evidence collection only. It does not approve ownership backfill, access-check switching, source asset row mutation, ownership metadata updates, legacy media reset, R2 actions, tenant isolation, production readiness, or live billing readiness.

## Current Status

- Current decision: `operator_evidence_collected_needs_more_idempotency`.
- Idempotency completion status: `operator_evidence_pending_manual_review_idempotency_completion`.
- Existing evidence proves import dry-run, confirmed import, queue export, and one status-change rollup.
- Existing evidence does not prove import replay, import conflict, successful standalone status-update response, status replay, or status conflict.

## Safety Scope

Allowed future operator evidence collection is limited to manual-review item/event rows. It must not:

- backfill ownership;
- switch runtime access checks;
- update `ai_folders` or `ai_images`;
- update ownership metadata;
- execute legacy media reset or enable `ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION`;
- list, move, copy, rewrite, or delete R2 objects;
- call providers, Stripe, Cloudflare APIs, or GitHub settings APIs;
- mutate credits, billing, lifecycle, quota, media serving, public gallery, or generation behavior.

## Required Evidence

Collect sanitized evidence for each missing behavior:

| Evidence | Required proof |
| --- | --- |
| Import same-key/same-request replay | Replay returns a replay/no-duplicate result and does not create extra review items/events. |
| Import same-key/different-request conflict | Conflict fails closed with an explicit conflict code and creates no review rows/events. |
| Standalone status-update success | A real review item status update succeeds and returns bounded metadata only. |
| Status same-key/same-request replay | Replay returns a replay/no-duplicate result and creates no duplicate status-change event. |
| Status same-key/different-request conflict | Conflict fails closed with an explicit conflict code and creates no extra status event. |
| Queue/item/event readback | Before/after counts prove only intended review item/event state changed. |

## Before / After Counts

Record these counts before and after each replay/conflict/status step:

- total review item count;
- total review event count;
- target item status;
- target item status-change event count;
- target item event history count;
- import-created event count;
- idempotency replay event count if exposed.

## Safe Fields

Evidence may include bounded:

- endpoint path;
- generated timestamp;
- repo commit or deployed Auth Worker reference;
- operator note;
- HTTP status and stable error/success code;
- redacted item reference or bounded review item id if approved for internal evidence;
- old/new status labels;
- event type and event count;
- `storedAs: sha256` or equivalent safe idempotency storage metadata;
- booleans proving no backfill, no access switch, no source mutation, no ownership metadata update, no R2 operation, no provider/Stripe/Cloudflare/GitHub mutation.

## Prohibited Fields

Do not commit:

- raw idempotency keys;
- raw request hashes or request fingerprints unless explicitly proven safe and non-sensitive;
- cookies, authorization headers, bearer tokens, or session values;
- signed URLs;
- private R2 keys;
- raw prompts or provider request/response bodies;
- Stripe payloads or identifiers;
- Cloudflare or GitHub tokens/API keys;
- private keys;
- private user data or unbounded item lists.

## Evidence File Names

Use clear sanitized names under `docs/tenant-assets/evidence/`, for example:

- `YYYY-MM-DD-manual-review-import-replay-live.json`
- `YYYY-MM-DD-manual-review-import-conflict-live.json`
- `YYYY-MM-DD-manual-review-status-update-success-live.json`
- `YYYY-MM-DD-manual-review-status-replay-live.json`
- `YYYY-MM-DD-manual-review-status-conflict-live.json`
- `YYYY-MM-DD-manual-review-idempotency-readback-live.json`

## Classification

Classify evidence as accepted only if every required replay, conflict, success, and readback item is present and sanitized.

If any item is missing or unsafe, keep the decision blocked as `operator_evidence_collected_needs_more_idempotency` with idempotency completion status `operator_evidence_pending_manual_review_idempotency_completion`.

Accepted manual-review idempotency evidence, if collected later, still does not prove tenant isolation, production readiness, ownership backfill readiness, access-switch readiness, live billing readiness, or confirmed legacy media reset readiness.
