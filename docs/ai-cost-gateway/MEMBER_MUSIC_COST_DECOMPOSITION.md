# Member Music Cost Decomposition

Date: 2026-05-15

Status: Phase 3.5 design, registry, and report-only check baseline only. This document does not migrate `/api/ai/generate-music`, does not require `Idempotency-Key` on the live music route, does not reserve credits, does not change credit debits, does not call AI providers, and does not prove production or live billing readiness.

## Current Request Flow

Current member music generation is handled by `workers/auth/src/routes/ai/music-generate.js`.

1. `handleGenerateMusic` requires an authenticated user, applies rate limits, reads a bounded JSON body, and normalizes prompt, optional lyrics, instrumental mode, optional separate lyrics generation, folder, title, and price.
2. `calculateMemberMusic26CreditCost` uses `js/shared/music-2-6-pricing.mjs`. Current fixed prices are 150 credits for MiniMax Music 2.6 base generation and 160 credits when separate lyrics generation is requested.
3. `prepareAiUsagePolicy` is called with `AI_USAGE_OPERATIONS.MEMBER_MUSIC_GENERATE`. Organization context is rejected for this route.
4. Member mode calls `usagePolicy.prepareForProvider()`. This checks/top-ups member credits before provider execution, but it does not create a durable member music reservation or replay record.
5. If `separateLyricsGeneration` is true, `generateLyrics` calls the HMAC-protected AI Worker text route `/internal/ai/test-text` through `AI_LAB.fetch`.
6. `generateMusic` calls the HMAC-protected AI Worker music route `/internal/ai/test-music` through `AI_LAB.fetch`.
7. The route saves returned audio through `persistMusicResult`, which stores a music text asset and R2/audio metadata.
8. After successful save, `usagePolicy.chargeAfterSuccess()` debits member credits once and records usage metadata.
9. After successful billing, `scheduleMemberMusicCoverGeneration()` runs background cover generation through `workers/auth/src/lib/member-music-cover.js`. That helper calls `env.AI.run` for a cover image if the saved asset still has no poster.

## Provider-Cost Sub-Operations

| Sub-operation | Code path | Provider cost trigger | Current credit check | Current idempotency | Retry / duplicate risk | Replay today | Current charge model | Target registry operation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Parent member music request | `handleGenerateMusic` | Coordinates lyrics, audio, save, debit, and cover scheduling | yes, before provider calls | recommended only through route policy; not required | duplicate requests can re-run provider work | none | one fixed debit after successful audio save | `member.music.generate` |
| Separate lyrics generation | `generateLyrics` -> `/internal/ai/test-text` | `AI_LAB.fetch` then AI Worker text provider | parent check only | inherits optional parent key if supplied; no durable sub-attempt | retry can repeat lyrics provider call before music succeeds | none | bundled into parent price; separate lyrics currently adds 10 credits | `member.music.lyrics.generate` |
| Music audio generation | `generateMusic` -> `/internal/ai/test-music` | `AI_LAB.fetch` then AI Worker MiniMax Music 2.6 provider | parent check only | inherits optional parent key if supplied; no durable sub-attempt | duplicate parent request can repeat audio provider call | none | bundled into parent fixed debit | `member.music.audio.generate` |
| Generated cover image | `scheduleMemberMusicCoverGeneration` -> `generateMemberMusicCover` | direct `env.AI.run` with `@cf/black-forest-labs/flux-1-schnell` | no separate member credit check beyond prior parent success | absent | `poster_r2_key` suppresses already-covered assets, but there is no gateway key or budget reservation | partial only through existing poster state | not billed separately today | `member.music.cover.generate` |
| Storage and saved asset metadata | `persistMusicResult`, R2/D1 save helpers | storage/metadata cost, not an AI provider call | storage quota checks where implemented | not an AI cost idempotency boundary | save failure after provider success can waste provider spend | saved asset exists only after success | no separate AI debit | outside provider gateway; must be part of parent finalization safety |

## Current Charge Versus Provider Work

The current product charge is a single bundled member music debit after successful provider audio generation and local save:

- 150 credits: MiniMax Music 2.6 base generation.
- 160 credits: MiniMax Music 2.6 generation with separate lyrics generation.

That debit does not separately meter cover generation. The extra 10 credits for separate lyrics reflects the current fixed schedule, but there is no durable reservation that ties the lyrics call and audio call to one exactly-once parent lifecycle. Cover generation currently runs after successful billing and is best described as bundled or platform-budgeted pending an explicit product decision.

## Failure Scenarios

| Scenario | Current behavior | Target gateway behavior |
| --- | --- | --- |
| Lyrics success plus music failure | Lyrics provider cost may be spent; no final member debit if music fails. | One parent reservation exists before lyrics. Lyrics sub-attempt metadata is recorded safely. Music failure releases the parent reservation and charges nothing. Retry with same key should avoid repeating lyrics if safe replay metadata exists. |
| Music success plus cover failure | Music save/debit can succeed; cover failure is logged and non-fatal. | Parent music debit remains finalized. Cover is tracked as a post-success sub-operation with explicit bundled or platform-budget policy. Cover failure does not claw back or alter music credits. |
| Provider failure after partial output | Route returns provider/upstream error and should not debit, but there is no durable attempt state. | Provider failure marks the parent attempt failed, releases reservation, records safe provider status, and returns no paid output. |
| Storage failure after provider success | Provider spend is incurred, saved asset is not available, and no debit is written if save fails. | Parent attempt records provider success plus storage failure as a no-charge terminal or retryable-safe state. It must not return uncharged paid output. |
| Billing failure after provider success | The route attempts `cleanupSavedAsset` and returns a billing/policy error. | Parent attempt transitions to terminal billing failure, suppresses replay of unpaid output, and exposes safe operator metadata. |
| Duplicate request in progress | A duplicate request can reach provider work because no durable member music attempt exists. | Same idempotency key and same fingerprint returns in-progress/conflict without another provider call. |
| Duplicate completed request | Same request can call providers again and debit again if the client retries with a new/no key. | Same key and same fingerprint replays safe result metadata or returns replay-expired metadata without another provider call or debit. |

## Target Gateway Behavior

Phase 3.6 should use a single parent reservation for `member.music.generate`, not independent user-facing debits per sub-operation. The parent attempt should:

- require `Idempotency-Key` before any lyrics/audio provider call;
- build a fingerprint from route id, operation id, member id, member credit account, model/pricing version, prompt hash, lyrics hash or generated-lyrics flag, instrumental mode, and other stable request fields;
- reserve the full fixed music credit amount before lyrics or audio provider execution;
- mark sub-operation states for lyrics, audio, and cover in safe metadata under the parent attempt;
- suppress duplicate lyrics/audio provider execution for same key and same fingerprint;
- reject same key with different fingerprint before provider execution;
- finalize exactly one member debit after audio provider success and successful local save;
- store replay metadata that can return the prior music asset result safely when the same request is retried;
- release/no-charge the reservation on lyrics or audio provider failure;
- treat billing finalization failure as terminal and prevent replay of unpaid output;
- keep cover generation explicitly budgeted as bundled, platform-budgeted, or disabled/retry-limited before it is considered fully covered.

Safe metadata may include operation ids, model ids, credit cost, pricing version, prompt hash, prompt length, lyrics hash, lyrics length, generated lyrics flag, asset id, replay availability, provider status, and correlation id. It must not include secret headers, cookies, raw auth tokens, provider credentials, raw request fingerprints, or unbounded raw prompts in gateway state. Existing user-owned asset metadata may continue to store product-visible prompt/lyrics only under the route's existing product contract.

## Phase 3.5 Result

Phase 3.5 adds this decomposition, explicit registry sub-operations, and report-only policy/test coverage. It does not change live music behavior. Member image remains the only migrated member AI Cost Gateway route. Member video, admin AI, platform/background AI, and internal AI Worker routes remain unmigrated.
