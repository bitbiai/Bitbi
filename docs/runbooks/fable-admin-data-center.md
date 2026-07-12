# Fable 5 Web App Data Center

The Admin AI Lab includes an MFA-protected **Fable 5 Web App Data** workspace for
Van Ark conversations. It provides bounded, paginated views of conversations,
the effective visible transcript, turns, memory checkpoints, Web-search metadata,
and budget evidence. It is a domain management surface, not a SQL console.

## Editable and immutable data

Admins may rename a conversation, update supported Fable settings, soft-delete or
restore a conversation, record a visible message revision, delete or restore a
complete visible turn, and invalidate a rolling-memory checkpoint. Every write
requires a reason, an `Idempotency-Key`, and the current conversation revision.

Original message rows, provider attempts, private provider blocks, fingerprints,
budget usage, and audit records remain immutable. Transcript changes are append-only
revisions. Future Fable context uses the latest effective revision and suppresses
provider-native replay only when it was created before the applicable Admin revision.
Affected rolling-memory checkpoints are invalidated without modifying their stored
summaries.

## Delete and purge

Soft delete is reversible and preserves the complete domain graph. Permanent purge
requires the conversation to be soft-deleted first and requires typing its exact ID.
The D1 foreign-key graph removes only that conversation's Fable domain rows. External
content-free budget, audit, mutation-claim, and write-receipt evidence is retained.

## Hidden memory and privacy

Hidden Qwen summaries are not returned by list or detail endpoints. Reveal is a
separate Admin-MFA request, is `no-store`, and requires an explicit privacy warning.
The browser renders the response as text and does not persist it. Thinking signatures,
encrypted Web-search data, service credentials, hashes, nonces, and raw provider
responses are never exposed.

## Deployment and rollback

Migration `0075_add_fable_admin_data_center.sql` must be applied before deploying the
Auth Worker. The tracked Admin static surface deploys separately through the guarded
static release workflow. Previous Auth versions remain compatible with the additive
schema; rollback may leave migration 0075 in place. Do not purge production data as a
smoke test.
