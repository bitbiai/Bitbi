# MiniMax consent

Candidate scope: member `minimax/h3`, `minimax/h3-lite`, `minimax/music-2.6`.
Model availability remains unchanged. Admin Lab uses its separate routes and is
exempt; an administrator using member Generate Lab or Canvas is not exempt.

## Contract

- Signup remains possible with the separate, unchecked consent box left empty.
- A grant records server-owned version `minimax-consent-v3-2026-11-16`, account ID,
  UTC time, locale and `register`, `first_use` or `settings` source. No IP is retained.
  A positive request must identify the exact displayed version; stale UI cannot
  grant the new version. Version changes only for material MiniMax changes, not age.
- Current status and immutable proof events are written in a D1 batch. Missing or
  withdrawn/outdated consent denies new member transfers before credits and source
  preparation with `403 consent_required`. Durable queues recheck before a new
  provider intent with an atomic consent predicate; a denial releases the unspent
  reservation and terminates the job. Already dispatched pending H3 receipts remain
  callback-recoverable after interruption and withdrawal.
- Existing primary receipts, callbacks, stored outputs and non-MiniMax music-cover
  delivery remain recoverable after withdrawal without another MiniMax inference.
  Canvas consent rejection is retryable with the same key only without prior paid
  usage, provider job or output. New generation is never inferred from an old receipt. Existing assets stay visible.
- Profile withdrawal is one click; re-enabling opens the complete consent dialog.
  Full supplied DE/EN risk text is shared across registration, first use and settings.
  Reference-file assurance is separate, unchecked, and required when adding each
  H3/H3 Lite file, including replacement on connected Canvas sources; it is not a substitute for a third party's consent.

## Retention and lifecycle

Migration `0120_add_minimax_consent.sql` adds current status, immutable events and
separate retention metadata. No historical grant is backfilled. Active proof has
no age deadline. Withdrawal closes the previously open proof cycle; a new grant
opens a new cycle without extending already closed history. Account operational
status transition to `deleted`, and physical deletion, close outstanding proof in
SQL triggers in the same mutation. Proof has no cascading user foreign key.

For withdrawal/deletion in year Y, the earliest deletion is January 1 of Y+4 UTC:
three full years after the end of the event year. Event updates always fail;
deletes before the applicable deadline fail independently in D1. Existing daily
cleanup deletes at most 500 expired events, their retention metadata, and expired
revoked current state with no remaining proof. No new scheduler is introduced;
five-minute recovery and Memvid catch-up keep their original lifecycle.

## Acceptance and delivery

- `test:asset-version` executes exact supplied-copy/complete legal snapshot checks.
- `test:homepage-core` executes `minimax-consent.spec.js` in Chromium/WebKit, EN/DE;
  actual Canvas entry coverage remains in `canvas.spec.js` on both engines.
- Existing `test:q2-runtime` includes `minimax-consent` and `member-generation`.
  Their focused suites exercise actual fetch, queue and daily scheduled entrypoints
  with native workerd/D1 and synthetic providers. Use the existing isolated launcher.
- Existing Worker generation and Q3 auth/session/save regressions remain required
  for changes to those inputs. Tests never use real providers or live resources.

**PR only:** Justiziar reviews the exact inserted text before merge, and Stefan's
approval is required for merge/deployment. Deployment order is migration0120,
`bitbi-auth`, then frontend including both privacy notices and terms on the same
calendar day. All prerequisites must be verified through the existing protected
publisher. Its reviewed migration allowlist includes `0120`; planner and publisher
select Auth schema, Auth Worker and static frontend, not unchanged services. No new binding or credential is required. Immutable previous consumer
terms snapshots remain available; new contracts pin the candidate terms version.

Migration is forward-only. Do not remove retained proof. A rollback that removes
server consent enforcement would reopen transfers and is not a safe consent
rollback; preserve enforcement and recorded proof when designing release recovery.
