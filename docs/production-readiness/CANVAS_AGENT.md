# Canvas production assistant

The Canvas **Create with AI / Mit KI erstellen** panel accepts a short film brief
and an explicitly authorized credit ceiling. Duration is optional: the planner
chooses a suitable creative target within the cap when it is absent. A supplied
duration is a creative target, not a runtime deadline or an exact success gate.
Create or open a normal Canvas project, set the ceiling and start once. Revisions
read the currently saved graph and assembly, including manual edits.

The reopenable assistant shows real actions, model/tool identities, a persisted
storyboard, partial outputs and authoritative costs before final completion.
Proposal visibility does not depend on executable validation or graph creation.
The ordinary model adapters validate conditional settings before paid media
dispatch. Safe defaults may be filled locally; changing an explicit creative
choice requires a bounded, separately accounted planning correction. At most two
preflight corrections are admitted within the same authorized ceiling.

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

The ordinary assembly editor exposes Creative/Exact duration mode. Existing exact
targets retain their tolerance and recipe semantics. New creative targets report
measured duration without padding, repetitions or retries solely to match a
number. Media validity, source sequence, trims and resource bounds remain strict.
Creative targets use the versioned recipe/processor compatibility boundary.

## Execution and accounting

[`canvas-agent-execution.js`](../../workers/auth/src/lib/canvas-agent-execution.js)
coordinates the existing generation queue and private media processor. D1 stores
runs, immutable intended steps, allocations, original job identities and receipts.
The existing queue wakes runs; the existing five-minute scheduled task recovers
missed wakes. A leased coordinator admits one generation at a time. The browser
only observes status. No new Workflow, queue, provider account or billing ledger
is provisioned.

Planning and evaluation each retain one immutable model operation before the
single background submission. Cloudflare completes inference independently of
the requesting Worker and posts to an operation-bound authenticated callback.
The callback persists the response before acknowledging it; existing queue/cron
processing validates and reconciles that response. Duplicate delivery cannot
replace terminal evidence or start another inference. A stopped run may retain
and account for its accepted result without resuming creative work.

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

The cap constrains allocations atomically across the project's assistant runs;
existing member usage reservations and the existing ledger perform the actual
charge. Each operation contributes one commitment: its unsettled ceiling or its
actual settled charge. Allocation, reservation and settlement are not added as
three expenses. Unknown accepted work retains its commitment. Normal manual
generation retains its separate explicit user authorization. Planner context
contains the cap, actual charges, reservations, commitments, remaining headroom
and its prospective planning ceiling. Tariff changes require renewed admission.
Planning and sampled-frame evaluation use the pinned tariff and reported usage.
Evaluation reserves the documented maximum context because no dependable image
token formula has been verified; this ceiling is **not** reported as actual spend.
If that optional review cannot fit, the assistant explicitly reports technical
validation only; it does not claim visual approval. Final technical checks remain
mandatory.

A necessary increase pauses before new commitment and shows the affected action,
additional maximum and exact new ceiling. Accept/Decline bind to the request,
project revision, budget revision and tariff. Duplicate acceptance cannot change
the amount; stale decisions fail. Decline retains the old ceiling and existing
work, then permits a bounded cheaper correction or explains the limitation. A
declined increase is not repeatedly requested. Silence grants no authority.

Ambiguous dispatch never starts a replacement generation. Original queue receipts
repair a stale `canvas_video_pending` projection; known image save-pending work
can retry storage under the original identity. Unknown outcomes require review.
The panel retains the production phase and separately displays reserved and
charged credits. An unknown planning/evaluation request cannot be resumed as a
new inference. Its reservation remains held until matched terminal evidence
allows reconciliation; cancellation is not a refund. Cloudflare documents
webhook delivery as best effort, without retries. Missing delivery therefore
ends in an explicit review state, not fabricated success or automatic replay.
Pause, cancel and takeover preserve the cause/history and paid proposals. A
completed operation without its expected plan is an explicit invariant error.

The deployed Cloudflare REST background route documents terminal callbacks, not
pre-completion summary events. The model's separate Chat Completions streaming
capability does not turn that callback into a stream. Only the documented bounded
`reasoning_content` summary is retained, labelled as received at completion;
hidden/encrypted reasoning is excluded. The assistant's live activity stream is
the persisted tool/action log, delivered through an authenticated observer with
cursor replay and polling fallback. It does not simulate token streaming or own
background execution. Closing or reconnecting the panel creates no inference.
Pause/cancel stop new admission; they do not promise provider cancellation or
reimbursement. Bounded visual rejection can produce up to two explicitly new
variants of affected shots and genuine dependents, with at most two evaluations.
Larger repairs or an insufficient cap stop with a partial, actionable result.
A two-minute film can wait across an hourly admission window; target film duration
is not production latency.

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
Creative targets use recipe v8 and processor protocol v9. Existing exact targets
retain recipe v7 and their tolerance; older export recipes remain supported.
Thirteen 10-second clips, twelve 0.5-second overlaps and a final 6-second trim yield
120 seconds. Twelve untrimmed 10-second clips with eleven such overlaps yield
114.5 seconds. The measured duration is reported honestly against the creative
target; the legacy Exact mode still enforces its tolerance. No padding or repeated
footage conceals a shortfall. Actual source quality determines normalization.
Sampled frames cannot establish complete motion, sound or unsampled-shot quality.

## Model and release prerequisites

The exact model is `xai/grok-4.7`. The existing signed AI Worker prepares and
validates its strict Chat Completions contract; Auth coordinates the durable
[Cloudflare REST background request](https://developers.cloudflare.com/ai-gateway/usage/rest-api/#background-requests-and-webhooks).
It reuses the account-restricted `H3_CLOUDFLARE_API_TOKEN` (Workers AI Read), default
Gateway and Unified Billing. No new credential or provider route is provisioned.
[Cloudflare's model documentation](https://developers.cloudflare.com/ai/models/xai/grok-4.7/)
lists text/image input, structured output, 500,000 context tokens and the two
token-price tiers. [xAI's guide](https://docs.x.ai/developers/grok-4-7) documents
the provider identifier `grok-4.7`. The private transport disables gateway cache
and log collection, validates the actual returned model/envelope, and has no
automatic inference retries. Existing Grok 4.6/Fable chat and one-shot Canvas text
remain independent. No private administrator history or tools enter a member run.

The autonomy update requires the additive Auth migration, compatible private
media processor, AI Worker, dependent Auth Worker and tested frontend. The moving required
schema checkpoint is owned by [`release-compat.json`](../../config/release-compat.json).
The existing protected release continuation is the only publication path. Config
and binding readiness are separate from actual account access and film quality.

A retained production receipt on 2026-10-16 confirms a completed Grok planning
response, followed by an incompatible H3 plan before media dispatch. The actual
ledger debit was 78 credits against a 127-credit ceiling. This is separate from
the older unknown attempt's held 127-credit reservation. The stopped production
is not silently resumed. This receipt does not establish complete autonomous-film
acceptance of a later candidate. Any new paid acceptance needs its own explicit
cap. Credentials remain in existing secret mechanisms, never in chat or logs.

## Executable acceptance

- [`tests/q2-canvas-agent-autonomy.spec.js`](../../tests/q2-canvas-agent-autonomy.spec.js)
  covers actual ledger commitments, atomic project ceilings, exact consent,
  duplicate/stale/foreign decisions, proposals, stopped-state preservation and
  missing-plan invariants. Its core cases also run with native D1.
- [`tests/q2-canvas-agent-preflight.spec.js`](../../tests/q2-canvas-agent-preflight.spec.js)
  exercises real conditional H3 rejection and repair, creative duration, ordinary
  editable graph execution and the processor recipe compatibility boundary.
- [`tests/q2-canvas-agent-model-operation.spec.js`](../../tests/q2-canvas-agent-model-operation.spec.js)
  and its shared native cases exercise original dispatch identity, late plan/evaluation
  receipts, unknown/failure/rejection distinctions, bounded recovery, held credits
  and cancelled/manual/newer-project fences. The signed AI boundary is exercised
  by [`tests/q2-canvas-agent-provider.spec.js`](../../tests/q2-canvas-agent-provider.spec.js).
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

The focused browser cases cover Chromium/WebKit and EN/DE, including ordinary
image/video/music Inspector regressions. The
[`assistant fixture`](../../tests/helpers/canvas-agent-ui.cjs) checks desktop and
390-pixel layouts, labeled controls, Escape/focus return, genuine video playback,
optional and explicit creative duration, stable start identity after a lost
response, and hostile output rejection. Film duration is distinguished from shot
length, including German adjectives (`zweiminütiger` / `2-minütigen`). The
[`editable-film fixture`](../../tests/helpers/canvas-assembly-editing-ui.cjs)
finishes a durable agent run through real Worker handlers, private test storage
and FFmpeg, then performs the complete manual revision without agent calls. It
independently measures output duration, decoded clip order and transition frames,
calibrates the music tone/gain against positive and absent-audio controls, and
checks immutable prior-export bytes, retained sources and reload persistence.
Model replies are synthetic; this is local behavioral evidence, not live model
quality, account access or deployment evidence. The assistant adds no third-party
frontend dependency; status polling observes work and does not advance production.
