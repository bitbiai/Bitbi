# Admin Text / Embeddings Idempotency Foundation

Status: Phase 4.8.1 implemented the narrow Path A foundation for `POST /api/admin/ai/test-text` and `POST /api/admin/ai/test-embeddings`; Phase 4.8.2 adds the operational cleanup and inspection layer for the resulting `admin_ai_usage_attempts` rows.

## Scope

Phase 4.8.1 adds only durable idempotency and metadata-only replay for admin text and embeddings tests. Phase 4.8.2 adds only admin-only sanitized inspection and bounded non-destructive cleanup for those attempts. Neither phase migrates Admin music, compare, live-agent, sync video debug, Admin image branches, Admin video beyond Phase 4.5, OpenClaw/News Pulse beyond Phase 4.6, member routes, org-scoped member routes, public billing, Stripe, or live billing. Phase 4.14 later classifies Admin Image branches separately without changing admin text/embeddings behavior.

## Storage

Migration `0051_add_admin_ai_usage_attempts.sql` adds `admin_ai_usage_attempts`.

The table stores:

- admin user id
- operation key
- route
- hashed idempotency key
- stable request fingerprint
- provider family and model key
- budget scope
- sanitized budget/caller-policy JSON
- attempt status, provider status, result status
- sanitized result metadata
- bounded error code/message
- timestamps and expiry

The table does not store raw prompts, raw embedding input, generated text, embedding vectors, provider request bodies, cookies, auth headers, Stripe data, Cloudflare tokens, secrets, or private keys.

## Fingerprinting

Admin text fingerprints include the normalized route, operation, admin actor, model, and sanitized request body. Prompt and system fields are hashed with length metadata before fingerprinting.

Admin embeddings fingerprints include the normalized route, operation, admin actor, model, and sanitized request body. Embedding input is hashed with length metadata before fingerprinting.

Volatile transport metadata, caller-policy transport fields, cookies, auth headers, and secrets are excluded.

## Runtime Behavior

For both routes:

- missing or malformed `Idempotency-Key` is rejected before the internal AI Worker call
- same key plus same request creates one attempt and performs one provider-cost call
- same key plus same request while pending/running returns `admin_ai_idempotency_in_progress` before any second provider call
- same key plus same completed request returns `admin_ai_idempotency_metadata_replay` without re-running the provider
- same key plus a different request returns `idempotency_conflict` before the provider call
- failed attempts become terminal for that key; retries require a new key

## Replay Policy

Replay is metadata-only. Completed duplicate requests return safe attempt/budget/caller-policy metadata with `result: null`.

Full generated text replay is intentionally not stored. Embedding vectors are intentionally not stored or replayed.

## Failure Policy

If the provider call fails, the attempt is marked `provider_failed` and no success state is returned. A later retry with the same key does not re-run the provider and returns a terminal idempotency response.

If the idempotency table is unavailable, the route fails closed before the internal AI Worker/provider call.

Runtime env kill switches and live platform budget caps remain future work; Phase 4.8.1 records only kill-switch metadata targets.

## Release Impact

Path A requires applying the additive auth D1 migration `0051_add_admin_ai_usage_attempts.sql` before deploying auth Worker code that depends on it. No remote migration was applied by Codex.

Phase 4.8.2 adds no migration. It reuses the `expires_at`, `status`, `provider_status`, `result_status`, and timestamp fields from `0051` to mark only expired active attempts as `expired`.

## Phase 4.8.2 Cleanup And Inspection

The cleanup policy is conservative:

- `pending` and `provider_running` attempts older than `expires_at` may be marked `expired`.
- Completed, succeeded, failed, and terminal rows are retained by default.
- Dry-run cleanup is the default for the admin endpoint.
- Scheduled cleanup uses a small fixed limit and logs counts only.
- Cleanup never deletes rows, R2 objects, media, ledgers, usage events, billing records, or audit records.
- Cleanup never calls providers, Stripe, Cloudflare APIs, or real AI services.

The admin inspection endpoints are API-first:

- `GET /api/admin/ai/admin-usage-attempts`
- `GET /api/admin/ai/admin-usage-attempts/:id`
- `POST /api/admin/ai/admin-usage-attempts/cleanup-expired`

List/detail responses return allowlisted fields such as attempt id, operation key, route, admin user id, provider/model family, budget scope, statuses, safe error code, safe timestamps, sanitized budget-policy summary, sanitized caller-policy summary, and sanitized result metadata summary. They do not return raw prompts, raw embedding input, generated text, embedding vectors, provider request bodies, cookies, auth headers, Stripe data, Cloudflare tokens, private keys, private R2 keys, raw `Idempotency-Key`, stored idempotency hash, or request fingerprint.
