# Generation controls and typed assets

Reviewed 2026-09-27 against the routed Cloudflare model documentation and the
existing application contracts. This is an application capability audit, not
paid provider acceptance or an exhaustive provider catalog.

## Authorities and invariants

`member-model-exposure.mjs` owns member membership; `ai-image-models.mjs` and
`admin-ai-contract.mjs` own model capabilities. Canvas derives its role-specific
catalog from those contracts. `generation-model-order.mjs` orders copies by true
publisher, display name, then ID; defaults and availability do not follow sort
position. Generate Lab and Admin use native image/video/music selects.

`image-dimensions.mjs` shares the validated Klein/Dev subset and Max UI presets.
Selected Klein dimensions reach the member multipart builder, credit calculation,
usage metadata and durable result; no nonexistent image width/height SQL columns
are introduced. Invalid/incomplete dimensions fail before provider dispatch.
Restored/model-switched controls normalize incompatible dimensions/enums without
discarding prompts or existing outputs. Music has no image resolution controls.

## Routed capability audit

| Publisher / application models | Preserved application resolution contract | Evidence / limits |
| --- | --- | --- |
| Black Forest Labs / FLUX.1 Schnell | Provider-controlled dimensions; no width/height fields | [Workers AI schema](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/). Existing strict member adapter remains unchanged. |
| Black Forest Labs / FLUX.2 Klein 9B, Dev (Admin) | Width and height each 256, 512, 768, 1024; default 1024 square | [Klein](https://developers.cloudflare.com/workers-ai/models/flux-2-klein-9b/), [Dev](https://developers.cloudflare.com/workers-ai/models/flux-2-dev/) expose opaque multipart inputs. This is the validated BITBI subset, not proof of a complete provider range. Dev reference-image limits remain separate. |
| Black Forest Labs / FLUX.2 Max | Explicitly labeled presets within existing integer 64–2048/application pixel cap; retain valid stored intermediate sizes | [Routed schema](https://developers.cloudflare.com/ai/models/black-forest-labs/flux-2-max/). Continuous bounds are not represented as an exhaustive discrete provider list. |
| OpenAI / GPT Image 2 | 1024x1024, 1024x1536, 1536x1024, auto | [Routed schema](https://developers.cloudflare.com/ai/models/openai/gpt-image-2/). Existing application background/pricing restrictions stay intact. |
| OpenAI / GPT Image 2.5 Sunburst, Flare | Same four sizes; existing quality/format/background combinations | [Sunburst](https://developers.cloudflare.com/ai/models/openai/gpt-image-2.5-sunburst/), [Flare](https://developers.cloudflare.com/ai/models/openai/gpt-image-2.5-flare/). Unverified reference-token pricing remains gated. |
| xAI / Grok Imagine Image (Admin), Image 2.0 | 1k/2k separately from 14 aspect ratios; Image 2.0 quality low/medium | [Image](https://developers.cloudflare.com/ai/models/xai/grok-imagine-image/), [Image 2.0](https://developers.cloudflare.com/ai/models/xai/grok-imagine-image-2.0/). Generate Lab now maps aspect ratio; reference/count contracts unchanged. |
| MiniMax / H3 | 768P/2K, 4–15 seconds, existing adaptive/ratio options | [Routed schema](https://developers.cloudflare.com/ai/models/minimax/h3/). Private whole-video/frame roles, callback and transport are unchanged. No invented reference/output duration ratio. |
| PixVerse / V6 | `quality`: 360p/540p/720p/1080p; 1–15 seconds | [Routed schema](https://developers.cloudflare.com/ai/models/pixverse/v6/). Existing generate/extend policy stays intact; image input is not a native video reference. |
| Vidu / Q3 Pro (Admin) | 540p/720p/1080p; 1–16 seconds | [Routed schema](https://developers.cloudflare.com/ai/models/vidu/q3-pro/). Aspect ratio is omitted in the existing start/end-frame workflow. |
| Alibaba / HappyHorse 1.0 T2V | Case-sensitive 720P/1080P and `ratio` | [Routed schema](https://developers.cloudflare.com/ai/models/alibaba/hh1-t2v/). No unsupported reference controls. |
| ByteDance / Seedance 2.0 Fast, 2.0 (Admin) | Fast 480p/720p; standard 720p/1080p; existing 4–12 seconds | [Fast](https://developers.cloudflare.com/ai/models/bytedance/seedance-2.0-fast/), [standard](https://developers.cloudflare.com/ai/models/bytedance/seedance-2.0/). New documented resolutions/reference modes are not automatically priced or enabled. |
| xAI / Grok Imagine Video, 1.5 Preview | 480p/720p; existing optional size presets and per-operation controls | [Video](https://developers.cloudflare.com/ai/models/xai/grok-imagine-video/), [Preview](https://developers.cloudflare.com/ai/models/xai/grok-imagine-video-1.5-preview/). Existing available-operation and input-ownership gates remain authoritative. |

Nine image and eight video entries were reviewed, including Admin-only entries.
MiniMax Music 2.6 and ElevenLabs Music v2 retain their existing mode/format controls
and publisher identity. No model, unpriced mode, or provider capability was activated.
An account-schema batch returned a model-schema-not-found error; it is not evidence
that every partner account schema was retrievable. The linked routed public schemas
and retained application acceptance establish the bounds above, not live inference.

## Optional asset-type view

`createSavedAssetsBrowser` owns the default-off toolbar toggle for all consumers.
Images, Video and Music (`sound` storage type) independently disclose first 60
matches, then explicitly paginate the remaining matches. `/api/ai/assets` applies
optional `asset_type` before LIMIT; signed typed cursors bind owner, folder scope
and type. Unfiltered cursors and mixed newest-first/text access remain compatible.
No schema, storage layout, ownership, billing or public-media boundary changes.

Card control checks are scoped inside the card: an outer group `<details>` must
not suppress selection/playback. The mobile deck is disabled only for grouped
grids and restored for ordinary mode. Read epochs reject obsolete group responses;
one group's failure or loading does not reset another group.

## Counterchecks and delivery

- `tests/workers.spec.js`: actual Klein member route, selected/default multipart
  dimensions, quote/debit/usage metadata and invalid values before dispatch.
- Native `scripts/test-q2-runtime.mjs --suite canvas`: migrated D1 UNION with 65
  interleaved assets per type, ties, pagination, owner/folder/type cursor rejection,
  mixed text and unauthenticated reads, alongside durable caller protections.
- `playwright.assets.config.js`: actual shared consumers, EN/DE, mobile/desktop,
  both engines, pagination/recovery/stale responses, picker and owner actions.
- Existing Canvas/model browser selection includes `generation-selectors.cjs`
  through `smoke.spec.js` and tagged Admin controls; final candidate discovery and
  exact executed reports are mandatory. Mixed Assets/Canvas proof selects the
  named auth report, not whichever report happens to be first.
- CI selection/release tests reject unknown/security scope and missing/wrong
  reports. New shared imports map to AI → Auth → frontend, using the existing
  protected continuation. No new binding/secret/migration or paid inference.
