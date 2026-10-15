# Canvas production assistant

The Canvas **Create with AI / Mit KI erstellen** panel accepts a film brief, an
explicit target duration and an explicitly authorized credit ceiling. Create or
open a normal Canvas project first. Missing duration persists a clarification;
no inference or media generation starts. After that question, the user can
explicitly delegate duration selection (the displayed target is 60 seconds).
Revisions start from the currently saved graph and its current assembly.

## Editable deliverables

Productions contain ordinary persisted generation nodes, reference edges, a
visible continuity note and a project assembly. The assembly owns clip order,
trims, transitions, target duration, music selection/gain/fades and smoothing.
Generation dependencies do not determine playback order. The stable export
anchor identifies the project's export history independently of clip order.

After reopening, users can edit prompts, model settings and references, rerun a
selected node, remove/reorder assembly clips, choose transitions and music, and
export with the ordinary controls. Prompt edits indicate that regeneration is
needed; they do not change existing pixels. Reordered or regenerated sources
mark the old export as stale while retaining its immutable saved version.
Removing a node from the active graph does not cascade-delete retained clips.
Required reference repairs remain explicit. Editing and exporting do not depend
on Grok or the agent feature switch.

## Execution and accounting

[`canvas-agent-execution.js`](../../workers/auth/src/lib/canvas-agent-execution.js)
coordinates the existing generation queue and private media processor. D1 stores
runs, immutable intended steps, allocations, original job identities and receipts.
The existing queue wakes runs; the existing five-minute scheduled task recovers
missed wakes. A leased coordinator admits one generation at a time. The browser
only observes status. No new Workflow, queue, provider account or billing ledger
is provisioned.

Existing hourly generation limits remain in force (12 video, 20 image, 24 music
and 60 text requests). A production that exhausts a limit waits for the next fixed
window and resumes through the durable coordinator. The assistant explains this
waiting phase in both languages; browser closure does not release the limit or
restart accepted work. Only the internal pre-dispatch admission signal permits
this wait. Generic provider errors and uncertain outcomes do not authorize it.

The server uses an in-process project/step authority, current project revision,
active-account check, expiry and lease fencing. Browser cookies and administrator
chat authority are never persisted. Manual creative edits pause active work;
resuming a stale plan is refused. A revision requires a new explicit budget and
reads the saved current project. Late results retain their history without
overwriting newer node decisions.

The cap constrains allocations atomically; existing member usage reservations and
the existing ledger perform the actual charge. Status distinguishes allocated
ceilings, wallet reservations, charged credits and uncertain accepted outcomes.
Tariff changes require renewed admission. Planning and sampled-frame evaluation
use the existing pinned tariff and authoritative reported token quantities.
Evaluation reserves the documented maximum context because no dependable image
token formula has been verified; this ceiling is **not** reported as actual spend.

Ambiguous dispatch never starts a replacement generation. Original queue receipts
repair a stale `canvas_video_pending` projection; known image save-pending work
can retry storage under the original identity. Unknown outcomes require review.
Pause/cancel stop new admission; they do not promise provider cancellation or
reimbursement. Bounded visual rejection can produce up to two explicitly new
variants of affected shots and genuine dependents, with at most two evaluations.
Larger repairs or an insufficient cap stop with a partial, actionable result.
Existing hourly generation limits remain unchanged. A definite local rejection
before dispatch persists a waiting phase and resumes the original node/run/key
after the limiter window resets. Generic provider throttling or ambiguous
acceptance never enters this retry path. A two-minute film can therefore wait
across an hourly admission window; target film duration is not production latency.

## Capability coverage

The versioned inventory is generated from the member Canvas model contract,
server area availability and current tariffs. Unsupported, unavailable or unpriced
models cannot enter execution. Descriptive creative suitability is provisional;
there are no fabricated quality scores or live comparative benchmark claims.

| Capability | Agent and ordinary editing path |
| --- | --- |
| Text, image, video, music | Existing priced member models and normal node execution/admission |
| Prompts and supported parameters | Strict structured plan, normal effective node settings, shared body projection |
| Image/audio/video references | Existing model roles; source ownership and compatibility checked again at execution |
| Continuation, edit, last frame | Existing supported video methods; private server frame extraction for last-frame inputs. Role-based models use native references; Seedance workflow settings remain editable. Unsupported generic edit/extend methods are rejected before allocation. |
| Montage | Explicit assembly, all integrated transition presets, editable start/duration trims |
| Sound | Per-source original audio plus project music selection, gain, fades and existing fit/smoothing behavior |
| Inspection | Exact source-version-bound technical metadata and private timepoint/last-frame extraction |
| Evaluation | Up to three frames from first/middle/final shots; genuine Grok image input, bounded strict judgments |
| Export/save | Existing private export job, ownership-aware durable asset, preserved editable project and older exports |

The production target is 3–180 seconds, subject to existing project, media-size,
model, storage and credit limits. There is no quota increase, arbitrary external
media service, model-generated shell/FFmpeg command or automatic public publishing.
The fixed duration tolerance is ±0.5 seconds. Recipe v7 and processor protocol v8
measure source timing and final output; older export recipes remain supported.
Thirteen 10-second clips, twelve 0.5-second overlaps and a final 6-second trim yield
120 seconds. Twelve untrimmed 10-second clips with eleven such overlaps yield
114.5 seconds and cannot pass a 120-second target. No padding or repeated footage
conceals a shortfall. Actual source quality determines export normalization.
Sampled frames cannot establish complete motion, sound or unsampled-shot quality.

## Model and release prerequisites

The exact model is `xai/grok-4.7` through the existing signed AI Worker service and
Cloudflare AI binding. [Cloudflare's model documentation](https://developers.cloudflare.com/ai/models/xai/grok-4.7/)
lists text/image input, structured output, 500,000 context tokens and the two
token-price tiers. [xAI's guide](https://docs.x.ai/developers/grok-4-7) documents
the provider identifier `grok-4.7`. The private transport disables gateway cache
and log collection, validates the actual returned model/envelope, and has no
automatic inference retries. Existing Grok 4.6/Fable chat and one-shot Canvas text
remain independent. No private administrator history or tools enter a member run.

Affected deployment units are Auth D1 migrations, AI Worker, Auth Worker, the
existing private media image/service and the static frontend. The moving required
schema checkpoint is owned by [`release-compat.json`](../../config/release-compat.json).
The existing protected release continuation is the only publication path. Config
and binding readiness are separate from actual account access and film quality.

On 2026-10-15 the authorized non-inference Cloudflare model-catalog read returned
HTTP 403 / code 10000. That read credential cannot establish account model access;
it is not evidence that inference is unavailable. No paid live inference was run.
Live verification requires the deployed AI binding/gateway to have funded access
to this exact model and an explicitly authorized paid acceptance cap. Credentials
remain in the existing secret mechanisms, never in chat or logs.

## Executable acceptance

- [`tests/q2-canvas-agent.spec.js`](../../tests/q2-canvas-agent.spec.js) and its
  shared native runtime helper exercise real Worker handlers, SQLite/D1, private
  storage, signed synthetic providers, replay/recovery and production accounting.
- [`tests/canvas.spec.js`](../../tests/canvas.spec.js) imports the EN/DE assistant
  and editability regressions in the existing Chromium/WebKit callers: complete an
  agent production, reload, rerun one node, delete a middle node, reorder retained
  clips, change transition/music, export, decode the new output and reopen again.
  It checks unchanged prior export bytes and no unrelated generation.
- [`tests/grok-chat-workers.spec.js`](../../tests/grok-chat-workers.spec.js)
  exercises the signed 4.7 transport, strict output/image boundaries and existing
  Grok behavior. [`tests/canvas-assembly.test.mjs`](../../tests/canvas-assembly.test.mjs)
  and the real processor fixtures check overlap math, output duration, decoded
  sequence, single-clip export and meaningful broken controls.

Synthetic provider acceptance, native runtime acceptance, a pushed candidate,
protected deployment and paid live-provider verification are distinct evidence.
Use the [main-only release runbook](MAIN_ONLY_RELEASE_RUNBOOK.md) and the actual
complete-diff selector; this document does not authorize production mutations.

The focused browser check passed 32 cases across Chromium/WebKit and EN/DE,
including the normal image/video/music Inspector regressions. The
[`assistant fixture`](../../tests/helpers/canvas-agent-ui.cjs) checks desktop and
390-pixel layouts, labeled controls, Escape/focus return, genuine video playback,
missing and competing duration clarification, stable start identity after a lost
response, and hostile output rejection. Film duration is distinguished from shot
length; a further four-browser-case check passed after explicit German adjective
normalization (`zweiminütiger` / `2-minütigen`). The
[`editable-film fixture`](../../tests/helpers/canvas-assembly-editing-ui.cjs)
finishes a durable agent run through real Worker handlers, private test storage
and FFmpeg, then performs the complete manual revision without agent calls. It
independently measures output duration, decoded clip order and transition frames,
calibrates the music tone/gain against positive and absent-audio controls, and
checks immutable prior-export bytes, retained sources and reload persistence.
Model replies are synthetic; this is local behavioral evidence, not live model
quality, account access or deployment evidence. The assistant adds no third-party
frontend dependency; status polling observes work and does not advance production.
