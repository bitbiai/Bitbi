# Member Music Cost Decomposition

Date: 2026-05-15

Status: Phase 3.6 migrated only member `/api/ai/generate-music` to the AI Cost Gateway. This document records the member music cost decomposition, the implemented parent-reservation policy, and remaining gaps. Phase 3.6 does not migrate member video, admin AI, platform/background AI, OpenClaw/News Pulse, or internal AI Worker routes directly. It does not call real AI providers in tests, call Stripe, deploy, or prove production/live billing readiness.

## Current Request Flow

Current member music generation is handled by `workers/auth/src/routes/ai/music-generate.js`.

1. `handleGenerateMusic` requires an authenticated user, applies rate limits, reads a bounded JSON body, and normalizes prompt, optional lyrics, instrumental mode, optional separate lyrics generation, folder, title, and price.
2. `calculateMemberMusic26CreditCost` uses `js/shared/music-2-6-pricing.mjs`. Current fixed prices are 150 credits for MiniMax Music 2.6 base generation and 160 credits when separate lyrics generation is requested.
3. `prepareAiUsagePolicy` is called with `AI_USAGE_OPERATIONS.MEMBER_MUSIC_GENERATE`, the MiniMax model id, and the normalized policy body. Organization context is rejected for this route.
4. Member mode now requires a valid `Idempotency-Key` and creates a parent `member_ai_usage_attempts` reservation before any lyrics, audio, or cover provider-cost work.
5. The parent fingerprint covers route, operation, user/billing scope, model, price, prompt hash, lyrics hash/manual-lyrics flag, lyrics-generation mode, instrumental mode, title/folder, and other stable request fields. Raw prompt/lyrics are not stored in the attempt metadata.
6. If `separateLyricsGeneration` is true, `generateLyrics` calls the HMAC-protected AI Worker text route `/internal/ai/test-text` through `AI_LAB.fetch` after the parent reservation is active.
7. `generateMusic` calls the HMAC-protected AI Worker music route `/internal/ai/test-music` through `AI_LAB.fetch` after the parent reservation is active.
8. The route saves returned audio through `persistMusicResult`, which stores a music text asset and R2/audio metadata.
9. After successful audio persistence, `usagePolicy.chargeAfterSuccess()` debits member credits once, then the parent attempt is marked succeeded with safe replay metadata.
10. After successful billing, `scheduleMemberMusicCoverGeneration()` runs background cover generation through `workers/auth/src/lib/member-music-cover.js`. Phase 3.6 policy includes that cover call in the parent bundled music reservation with no separate user-visible charge.

## Provider-Cost Sub-Operations

| Sub-operation | Code path | Provider cost trigger | Current credit check | Current idempotency | Retry / duplicate risk | Replay today | Current charge model | Target registry operation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Parent member music request | `handleGenerateMusic` | Coordinates lyrics, audio, save, debit, and cover scheduling | yes, before provider calls and reservation | required | duplicate in-progress/completed same-key requests are suppressed before provider work | safe asset/audio replay metadata from parent attempt | one fixed debit after successful audio save | `member.music.generate` |
| Separate lyrics generation | `generateLyrics` -> `/internal/ai/test-text` | `AI_LAB.fetch` then AI Worker text provider | covered by parent reservation | required through parent key | same-key duplicate parent request is blocked/replayed before repeating lyrics | partial metadata only; raw generated lyrics are not stored in attempt metadata | bundled into parent price; separate lyrics currently adds 10 credits | `member.music.lyrics.generate` |
| Music audio generation | `generateMusic` -> `/internal/ai/test-music` | `AI_LAB.fetch` then AI Worker MiniMax Music 2.6 provider | covered by parent reservation | required through parent key | same-key duplicate parent request is blocked/replayed before repeating audio | safe replay points to the persisted member asset | bundled into parent fixed debit | `member.music.audio.generate` |
| Generated cover image | `scheduleMemberMusicCoverGeneration` -> `generateMemberMusicCover` | direct `env.AI.run` with `@cf/black-forest-labs/flux-1-schnell` | covered by parent bundle policy after audio success | required through parent key for the user-facing request | duplicate completed parent request does not schedule another cover; existing poster state still gates cover writes | partial through existing poster state; final cover status is not written back to parent attempt yet | included in parent music bundle with no separate visible charge | `member.music.cover.generate` |
| Storage and saved asset metadata | `persistMusicResult`, R2/D1 save helpers | storage/metadata cost, not an AI provider call | storage quota checks where implemented | not an AI cost idempotency boundary | save failure after provider success can waste provider spend | saved asset exists only after success | no separate AI debit | outside provider gateway; must be part of parent finalization safety |

## Current Charge Versus Provider Work

The current product charge is a single bundled member music debit after successful provider audio generation and local save:

- 150 credits: MiniMax Music 2.6 base generation.
- 160 credits: MiniMax Music 2.6 generation with separate lyrics generation.

That debit does not separately meter cover generation. The extra 10 credits for separate lyrics reflects the current fixed schedule. Phase 3.6 ties lyrics, audio, and scheduled cover work to one parent idempotency key and member attempt. Cover generation is explicitly treated as included in the parent music bundle for now; future work may split it into a separate member/platform budget if product economics require that.

## Failure Scenarios

| Scenario | Current behavior | Target gateway behavior |
| --- | --- | --- |
| Lyrics success plus music failure | Parent reservation is active; music failure releases the reservation and charges nothing. | Phase 3.7 may add richer sub-operation replay; raw generated lyrics are intentionally not stored in attempt metadata today. |
| Music success plus cover failure | Music save/debit can succeed; cover failure is logged and non-fatal. | Cover failure does not claw back or alter music credits. Final cover status writeback to parent attempt remains future work. |
| Provider failure after partial output | Provider failure marks the parent attempt failed, releases reservation, records safe status, and returns no paid output. | Continue adding per-provider telemetry without raw provider payload exposure. |
| Storage failure after provider success | Parent attempt is marked terminal `billing_failed`, no member debit is written, and no uncharged paid output is returned. | Operator/customer-support workflow remains manual. |
| Billing failure after provider success | Saved asset cleanup is attempted, parent attempt becomes terminal `billing_failed`, and same-key retry is suppressed before provider work. | Reconciliation/admin support tooling still needs approved remediation policy. |
| Duplicate request in progress | Same idempotency key and same fingerprint returns in-progress before a second provider call. | Keep tests covering concurrent duplicate suppression. |
| Duplicate completed request | Same key and same fingerprint returns safe replay metadata without another provider call or debit. | Full binary/audio replay remains via persisted member asset, not raw audio in attempt metadata. |

## Phase 3.6 Gateway Behavior

Phase 3.6 uses a single parent reservation for `member.music.generate`, not independent user-facing debits per sub-operation. The parent attempt:

- requires `Idempotency-Key` before any lyrics/audio provider call;
- builds a fingerprint from route id, operation id, member id, member credit account, model/pricing version, prompt hash, lyrics hash/manual-lyrics flag, instrumental mode, and other stable request fields;
- reserves the full fixed music credit amount before lyrics or audio provider execution;
- marks lyrics, audio, and cover policy/status in safe metadata under the parent attempt;
- suppresses duplicate lyrics/audio provider execution for same key and same fingerprint;
- rejects same key with different fingerprint before provider execution;
- finalizes exactly one member debit after audio provider success and successful local save;
- stores replay metadata that can return the prior music asset result safely when the same request is retried;
- releases/no-charges the reservation on lyrics or audio provider failure;
- treats storage/billing finalization failure as terminal and prevents replay of unpaid output;
- keeps cover generation explicitly included in the parent bundle for now, with no separate charge.

Safe metadata may include operation ids, model ids, credit cost, pricing version, prompt hash, prompt length, lyrics hash, lyrics length, generated lyrics flag, asset id, replay availability, provider status, and correlation id. It must not include secret headers, cookies, raw auth tokens, provider credentials, raw request fingerprints, or unbounded raw prompts in gateway state. Existing user-owned asset metadata may continue to store product-visible prompt/lyrics only under the route's existing product contract.

## Phase 3.6 Result

Phase 3.6 migrates only member music generation. Member image and member music are now the migrated member AI Cost Gateway routes. Member video, admin AI, platform/background AI, OpenClaw/News Pulse, and internal AI Worker routes remain unmigrated. No real AI provider calls were made by Codex/tests, no Stripe calls were made, no migration was added, no remote migration was applied, and production/live billing remains BLOCKED.
