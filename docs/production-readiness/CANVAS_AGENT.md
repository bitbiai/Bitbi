# Canvas production assistant

The Canvas **Create with AI / Mit KI erstellen** panel is a project conversation.
Describe the film, approve a bounded briefing allowance, and develop a saved
**Project brief / Projektidee** with the selected assistant model. The allowance uses the existing
member tariff and credit ledger; the suggested limit covers one maximally bounded
reply, not a promise of actual spend or a new tariff. Actual usage settles the
original reservation. Increase the allowance explicitly when necessary.

New productions require a supplied duration or an explicit delegation. A blank
field and **Prepare brief** do not delegate duration or authorize production.
The server asks once and waits; a known answer is reused. A supplied duration
remains a creative target, not an exact success gate. Historical accepted runs
and Exact export settings retain their original semantics. **Save for later**
retains the draft; **Cancel briefing** stops further dialogue; production has its
own pause/cancel/takeover controls. Closing the panel grants no authority.

Review the visible brief and answer the budget question in chat, for example
**3000 Credits**. This saves the proposed total cap; it does not start production.
After the assistant displays the current film scope and cap and asks whether to
start, **Ja, starte / Yes, start** consumes that one server-owned decision.
**Starte jetzt mit maximal 3000 Credits** can supply both instructions when the
necessary brief and duration are already resolved. The existing buttons use the
same authoritative operation. A missing briefing allowance can also be approved
through a separate in-chat decision before any paid inference.

Negations, save-only requests, quoted story dialogue, euros and ambiguous amounts
do not authorize spend. Locale-specific grouping is validated; a bare number is
a budget only when the server is currently asking for one. Decisions expire and
pin the actor, current question/conversation revision, brief, graph, selected model,
tariff and total cap. An intervening exchange makes a short affirmation stale. Changes invalidate
unaccepted decisions; replay retains the original request identity. The server binds the conversation, brief,
current creative graph and tariff revisions to the normal production route.
Previous briefing charges count once within that project ceiling. Revisions
read the currently saved graph and assembly, including manual edits.

The reopenable assistant shows real actions, model/tool identities, a persisted
storyboard, partial outputs and authoritative costs before final completion.
Proposal visibility does not depend on executable validation or graph creation.
The ordinary model adapters validate conditional settings before paid media
dispatch. Safe defaults may be filled locally; changing an explicit creative
choice requires a bounded, separately accounted planning correction. At most two
preflight corrections are admitted within the same authorized ceiling.

## Assistant models

The chat header offers **Assistant model / Assistentenmodell**. Grok 4.7 remains
the historical default; Fable 5 uses its real `anthropic/claude-fable-5` native
Messages adapter. Both receive the same Canvas-only policy, phase skills and
project-owned memory. Integrated text models without a safe executable Canvas
adapter are listed as unavailable, with a reason; no invented OpenAI model or
silent fallback is used. Selection is saved with the project. It affects subsequent
turns and new productions; accepted turns, production reasoning, receipts and
tariffs remain pinned to their original model. Older replies retain attribution.
Provider-private reasoning and response state never transfer between models.

Policy package v3 has provider-neutral identity. Accepted v1/v2 policy content and
hashes remain unchanged. Fable uses native schema output with strict application
validation, its own metering and tariff; no cache is requested. Unexpected cache
or tool charges require review rather than being omitted. Fable visual review is
currently unavailable, so its productions disclose technical-only review. Grok
retains its existing separately bounded visual capability. Details and official
transport sources are in the [runtime package](../../workers/shared/canvas-agent/README.md).

## Runtime rules and private project memory

The release-controlled instruction package is
[`workers/shared/canvas-agent/manifest.mjs`](../../workers/shared/canvas-agent/manifest.mjs),
with a compact core/personality and seven platform-specific skill modules. Static
imports select briefing, planning, correction or evaluation instructions; project
text cannot select files, publish rules or grant tools. These are Worker build
inputs, excluded from the frontend website/import graph. The repository is
public: policy is nonsecret source, and security does not depend on hiding it.
Package version, selected skill versions and content hash are pinned on accepted
operations. Existing accepted receipts normalize under their stored context;
accepted v1 dialogue inputs retain their release-controlled original policy/schema; unknown policy identities require review before another paid operation.

[`canvas-agent-conversation.js`](../../workers/auth/src/lib/canvas-agent-conversation.js)
keeps conversation and brief revisions distinct from creative graph revision.
Project-owned D1 tables store ordered turns, delivery state, a bounded structured
brief with field provenance/source references, draft and explicit allowance.
Execution facts remain in the existing runs, nodes, assembly and credit records.
There is no account-wide memory, vector database, privileged Admin-chat import,
replacement ledger or browser-owned transcript. Existing projects receive an
empty conversation; old activity is not fabricated into dialogue.

Context contains the current brief, at most six recent completed exchanges,
selected current-project node facts and current production state. Older messages
are omitted first to stay within 64 KiB; incomplete replies never update the brief.
An 80-turn bound and a 4,096-token completion request control constrain dialogue.
The request control is not treated as a verified billable-output ceiling. Prompt,
schema and selected instructions are shared between quoting and actual dispatch.
The versioned typed response permits text, creative proposals and up to four narrowly typed action proposals. Proposals do not grant execution or spending authority. Duration is admitted
from user input or an explicit control, not a model-proposed memory field.
User content, summaries and proposed memories remain untrusted data. Ownership,
CSRF, tariff, allowance, resource and operation checks are enforced by code.
Messages render as plain text; there are no browsing, X, arbitrary URL or Admin
tools. A Paris/political film setting remains valid Canvas subject matter.

Correct decisions in conversation; provenance distinguishes suggestions from
user statements and explicit delegation. **Clear conversation and brief** clears
active context and tombstones messages so late responses cannot restore it.
Project deletion removes conversational storage through the existing lifecycle.
Already accepted paid request/usage receipts remain protected recovery evidence;
clearing memory is not deletion of billing evidence or a refund. Private replies
use `Cache-Control: private, no-store`; policy and receipt internals are not in
client responses. Unconfirmed request identity/body may survive in sessionStorage
only for exact replay, then is removed on acknowledgement.

Dialogue uses the existing leased Canvas queue and background reasoning receipt
path with a restricted `briefing` purpose. Inference itself cannot execute tools. Validated action receipts call existing Canvas services with the project owner, current revisions and any separately required confirmation.
Status-only messages do not alter creative revisions or pause production. Genuine
creative brief corrections pause active production and require a new authorized
handoff from the current project. Late dialogue replies bind to their source
revisions; clearing, cancelling or a newer decision prevents stale application.
Unknown provider acceptance is shown for review and never resubmitted. Duplicate
requests and callbacks reuse the original identity. Chat/model availability does
not own an accepted production or normal manual Canvas editing.

The **Conversation / Gespräch** tab keeps the transcript within the Canvas
viewport, with the composer and header outside its scrolling area. The project
brief, allowance and production controls live in **Project & production / Projekt & Produktion**. New
messages follow the viewport only while the reader is near its end; otherwise a
new-message control preserves the reading position. Enter sends, Shift+Enter
adds a line, and IME composition never submits a message. System delivery states
are separate from actual assistant replies.

## Briefing transport and recovery

The signed AI `prepare` route composes and validates input; Auth makes the single
paid Cloudflare background POST. A non-error HTTP 202 acknowledgement means
pending work, not a completed response. Its signed callback can bind the provider
identity later. A missing receipt, malformed terminal output, local preparation
failure and unsettled stored result are different stages. The delivery view
derives these stages from the original operation, usage attempt and saved result;
an old generic error label alone cannot lock a completed conversation.

The frontend observes every accepted pending turn, including the first queued
snapshot with no provider operation or receipt. Non-overlapping bounded GETs use
backoff and catch up after online, visibility and BFCache/pageshow restoration;
five minutes is not a logical-turn deadline. Reconnection never dispatches
inference. The small local CSS bee uses truthful waiting text, a static
reduced-motion state and a separate diagnostic disclosure. Terminal/review and
connection states replace ordinary waiting. Help moves to the panel header so
it cannot cover the composer. The existing cron also projects finalized replies
without a browser; callback receipt readiness avoids the media polling delay.
Queue-to-first-consumer, preparation, background acknowledgement and stored
callback/settlement/delivery timestamps remain distinct diagnostics.

**Reload conversation / Gespräch neu laden** is a secondary recovery control. It observes the original request and safely
reconciles a stored result. It never starts inference. Ambiguous dispatch remains
held; only matched evidence allows settlement or release. The original request
identity, accepted policy context, user wording and first terminal receipt remain
unchanged. A completed receipt can repair its saved dialogue after the execution
authority expires; this never renews that authority or starts media generation.
Draft saving and ordinary Canvas editing remain available during review. A valid late result clears the active delivery error and preserves the
original accounting identity.

Diagnostics expose a copyable opaque reference and bounded stage metadata, not
prompts, responses, credentials or signed callback URLs. Briefing inference requests
use per-request metadata-only AI Gateway logging (`cf-aig-collect-log: true`,
`cf-aig-collect-log-payload: false`) and one provider attempt. This does not change
global retention or other model transports. Auth invocation logging stays off
because callback paths contain signatures; structured application diagnostics
carry safe correlation instead. See the official [background REST contract](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)
and [Gateway logging controls](https://developers.cloudflare.com/ai-gateway/observability/logging/).
Gateway logs, Worker logs and D1 receipts are separate evidence: missing logs do
not establish that a request was never accepted.

## Immediate production and conversational actions

**Make my film now! / Mach mir den Film jetzt!** remains in the chat footer.
It saves an explicit immediate-production intention using the current brief,
current graph and deliberately submitted composer text. Its nearby explanation
delegates unspecified creative details, including duration only if absent.
Ordinary dialogue and **Prepare brief** still do not silently delegate duration.
A pending reply is resolved under its original identity before handoff. The
latest supplied wording (for example a 45-second bee/factory film) is retained.
A later direct creative correction is visible as Latest instruction alongside
the original story and constraints; subsequent starts read that saved context.

One compact in-chat decision displays the proposed total cap, planning ceiling,
media estimate, one bounded sampled-frame evaluation ceiling, tariff and bound brief/project revisions. The estimate uses
eligible integrated model request builders and real tariffs; it is not a promise
of the final model selection or cost. A delegated duration uses a visible
60-second estimate until planning chooses the target. Approval calls the existing
production start route automatically. An already authorized identical intention
or running production is reused. Briefing allowance is never production approval.
The normal atomic project commitment limits remain authoritative.

Migration 0110 adds start intentions and narrow action receipts, not another
billing or production ledger. Immutable request inputs, guarded D1 batches,
project revisions, original generation/export keys and bounded recovery make
repeated delivery safe. Manual edits, cancellation and takeover fence pending
intentions. Unknown paid outcomes are observed and never retried as new variants.

The model proposes the strict actions from
[`canvas-agent-actions.mjs`](../../workers/shared/canvas-agent-actions.mjs).
[`canvas-agent-actions.js`](../../workers/auth/src/lib/canvas-agent-actions.js)
resolves ownership and current targets, calls the same ordinary services, and
returns persisted effects or explicit failures. Chat displays these authoritative
results rather than an unchecked claim in model text. Straightforward known
status, pause, stop, resume and takeover commands use free deterministic handling;
other natural phrasing uses the bounded dialogue allowance and typed proposals.
A delayed chat reply cannot prevent an emergency production pause. No new
privileged tools, arbitrary URLs or model-authored command execution are added.

| Project/production operation | Conversational action and existing boundary |
| --- | --- |
| Brief, status, limits and costs | Current brief/execution context; `brief_summary`, `status`; read-only status does not revise creative state |
| Story, style, sound and duration corrections | Validated brief updates with source/provenance; duration from the actual user message or explicit delegation |
| Finish optional questions / delegate duration | `skip_questions`, `delegate_duration`; existing conversation controls |
| Save, continue or end briefing | `brief_save`, `brief_resume`, `brief_cancel`; current conversation revision and retained draft |
| Start production | `start_now` or footer; same persisted intention, quote and explicit cap approval |
| Pause, resume, cancel, manual takeover | Existing production controls; original accepted jobs/receipts retained |
| Briefing allowance / production budget | `allowance_propose`, `budget_accept`, `budget_decline`; exact displayed monetary confirmation, tariff and revision guards |
| Clear conversation and brief | `conversation_clear`; explicit destructive confirmation before existing tombstone operation |
| Show project, node or saved result | `show_project`, `focus_node`, `show_result`; owned targets and saved export evidence |
| Clip selection and playback order | `clip_remove`, `clip_order`, `clip_add`, `clip_replace`, `clip_trim`; normal persisted assembly, retained sources |
| Transitions and smoothing | `transition`, `transition_strength`, `smooth_joins`; shared transition/assembly validation |
| Music and original audio | Source selection, enable, gain and fades through normal assembly/node audio settings |
| Prompt, model and supported numeric parameters | `node_prompt`, `node_model`, `node_parameter`; ordinary node validation; pixels unchanged until regeneration |
| Targeted regeneration | `regenerate`; explicit exact quote/input confirmation and one existing node-run identity |
| Export and save | `export`, `save_result`; current assembly, private processor/storage and preserved old exports |

Node positions, file picking, references and detailed unsupported parameter
combinations retain the ordinary Canvas controls. An action cannot invent a
provider capability or bypass those controls' validation. Reversible settings do
not generate media by themselves. A subsequent export reflects the saved
assembly and settings, and manual editing remains independent of the assistant.

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
New Grok requests reserve the worst feasible input/output split of the documented
context, including reasoning and the long-context price tier; this ceiling is
**not** reported as actual spend. Image input also retains its conservative context bound.
If that optional review cannot fit, the assistant explicitly reports technical
validation only; it does not claim visual approval. Final technical checks remain
mandatory.

### Grok planning metering and settlement review

The scoped operator entrypoint is
`node scripts/canvas-planning-settlement-review.mjs --input /private/target.json --output /private/preview.json`.
Its default is read-only. The private input contains the exact `userId`,
`projectId`, `runId`, `stepId`, `operationId`, `usageAttemptId`, `expectedSource`
(full serving commit), `expectedSchema` (current release contract),
`originalReservationCredits` and `projectCapCredits`. Do not commit this file.
It must be outside the repository with owner-only file permissions. The command
silently captures existing Wrangler authorization; no new secret is needed.

Only an explicitly authorized recovery adds `--execute`, the preview's
`reviewDigest`, a bounded nonsecret `actor` and `authorizationRef`, and a new
private output path. The command verifies clean matching runtime source, both
serving Worker versions and D1 schema before invoking the same billing service.
It saves before/after evidence and never repeats an uncertain HTTP mutation.
Inspect the persisted original identities before retrying the same approval.
Successful accounting can produce `continuationStatus:held` if authority changed;
that is not permission to renew, edit, restart or increase the budget. The service
leaves wake-up to existing scheduled processing and prohibits new paid planning
for the reviewed run. It has no browser or agent-tool endpoint.

If the normal preflight subsequently blocks only a newly proposed ElevenLabs music
node's inert `originalAudio:{enabled:false,gain:0}`, use the same entrypoint with
`--continue-plan`. Its dry run verifies the settled review, original receipt and
proposal, current full preflight, pricing/capability revisions and unrenewed
project authority. Execution additionally binds `continuationDigest` from that
preview and the original review/actor/authorization reference. The guarded service
records one append-only continuation event and resumes only that exact boundary.
It performs no accounting operation and permits no new planning inference.

The derived executable plan omits only that exact video-only setting; the original
provider response, receipt and proposal remain unchanged. Other unsupported values
still fail. Generation and music mixing use the existing ordinary node and assembly
settings. Replays cannot duplicate the resume or replace a later manual decision.
Where the AI Worker is unchanged by this release, `expectedAiSource` may identify
its serving ancestor only after exact equality of its build-input trees is proven;
Auth must still serve the current candidate. Never redeploy unchanged AI merely
to replace its source annotation.

[`canvas-agent-metering.mjs`](../../workers/shared/canvas-agent-metering.mjs)
validates the original usage components before settlement. Cloudflare's
[Grok 4.7 examples](https://developers.cloudflare.com/ai/models/xai/grok-4.7/)
report completion and reasoning separately; an inclusive completion is accepted
only when the exact total proves that encoding. Missing, negative, contradictory
or unsupported metering requires review. Reasoning is never dropped, counted
twice or clipped to a requested limit. Existing cached-input pricing is unchanged.
[xAI documents reasoning at the completion rate](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing).

The versioned [`canvas-grok-admission.mjs`](../../js/shared/canvas-grok-admission.mjs)
policy separates the unchanged completion request controls (planning/correction
16,384; briefing 4,096; evaluation 2,048) from credit admission. The
[background transport documentation](https://developers.cloudflare.com/ai-gateway/usage/rest-api/#background-requests-and-webhooks)
does not establish enforcement of those controls, and
[xAI publishes no separate text-output limit](https://docs.x.ai/developers/grok-4-7).
New quotes therefore cover the most expensive feasible token split within the
500,000-token model context and the existing composed-input bound. Factory and
custom retail rates use their own worst split; rates, conversion and margin do
not change. This is conservative admission, not proof that a provider can never
violate its resource contract. A higher quote requires sufficient explicit
allowance or project authorization; it never raises an existing cap. Normalized
receipts retain bounded request-control diagnostics without prompt/response text.
Immediate-start quotes bind this admission version as well as the tariff. An
unstarted legacy quote requires fresh approval; already started intents retain
their original replay identities and accepted usage.

Historical quotes and accepted request identities are immutable. A stored
successful planning answer that exceeded its historical token estimate remains
review-required until an explicitly authorized settlement review verifies its
response/receipt digests, original tariff, ownership and unchanged monetary
reservation. Reviewed settlement must fit that original reservation; otherwise
the operation reports the exact additional authorization required. Review uses
the existing ledger and original idempotency identity, preserves exhausted retry
history and never repeats the planning inference. Accounting for accepted work
does not renew production authority: continuation still checks cancellation,
expiry, takeover, project/brief revisions and ordinary plan preflight.

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
| Evaluation | Grok: up to three frames from first/middle/final shots and bounded strict judgments. Fable: explicitly technical-only; no vision fallback or invented inspection. |
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

## Parallel images and late H3 recovery

The existing durable scheduler admits independent ready image nodes together;
required anchors and last-frame dependencies remain ordered. D1 capacity claims
coordinate the shared provider account, user and project before dispatch. Slot
identities bind the original usage/job; unknown acceptance retains capacity and
never permits another inference. Existing hourly rate, budget, quota and ownership
gates still apply. Queue batch size is not concurrency evidence. The UI reports
persisted waiting, generating, saved and blocked media counts.

`IMAGE_GENERATION_CAPACITY_JSON` is an operator-reviewed allocation: `version:1`,
`revision`, `reviewRef`, future `verifiedUntil`, and integer `global`, `user`,
`project`, `providers` limits (1–15). Provider keys follow the integrated adapter
registry. Missing, malformed or expired evidence defaults to one with
`image_capacity_unverified`; an unlisted provider also remains one. Raising a
configured bound requires actual account/provider evidence, not a guessed RPM
conversion or a new paid benchmark. Synthetic acceptance holds 15 distinct
provider requests open before the first completion and verifies original mapping,
out-of-order storage and exact accounting. This does not establish live capacity
or simultaneous provider GPU execution.

Legacy financial unknowns are not proof of currently active dispatchers. The
release-approved `image-generation-legacy-review.js` contains only reviewed opaque
fingerprints for the coordination cutover; private source evidence stays outside
Git. Exact previously reviewed unknown tuples may be excluded from physical slot
counts while their financial commitments and no-replay restrictions remain intact.
Every dispatched attempt and new/changed unknown still counts atomically. This
review never raises concurrency or claims provider termination. Optional protected
`IMAGE_GENERATION_LEGACY_REVIEW_JSON` uses the same strict version/date/reference/
fingerprint contract; malformed review data excludes nothing.

A Cloudflare H3 dispatch timeout can precede a valid authenticated callback. The
original durable job can finish storage and settlement while an agent remains in
receipt review. `canvas-agent-media-recovery.js` proves the original completed H3
job, private result and bytes, finalized debit, node version, active authority,
current graph/brief and unchanged project cap before completing the original
step. Normal successful usage updates preserve the agent budget binding.
Recovery makes no provider request and writes no credit ledger. Historical holds
require an explicit digest-bound operator decision; newly classified receipt
holds are eligible for the same guarded cron reconciliation. Expired, edited,
paused, cancelled, taken-over or unverifiable work stays held.

The sanctioned operator entry is `node scripts/canvas-h3-recovery.mjs --input
<private-0600-json> --output <new-private-evidence-path>` (dry-run by default).
Input names exact `runId`, `projectId`, `userId`, `expectedSource`,
`expectedAiSource`, `expectedSchema`, and unchanged `projectCapCredits`. After
review, `--execute` additionally requires the dry-run `recoveryDigest`, `actor`
and `authorizationRef`. It verifies live source/schema again and records only
that narrow recovery authorization; deployed cron verifies storage and continues
through the ordinary execution path. Keep all production identities and evidence
outside Git. No direct database status reset, retry reset or authority renewal is
part of this operation.

## Model and release prerequisites

Grok uses `xai/grok-4.7`; Fable uses `anthropic/claude-fable-5`. The existing signed
AI Worker prepares and validates their separate Chat Completions and native
Messages contracts; Auth coordinates the durable
[Cloudflare REST background request](https://developers.cloudflare.com/ai-gateway/usage/rest-api/#background-requests-and-webhooks).
It reuses the account-restricted `H3_CLOUDFLARE_API_TOKEN` (Workers AI Read), default
Gateway and Unified Billing. No new credential or provider route is provisioned.
[Cloudflare's model documentation](https://developers.cloudflare.com/ai/models/xai/grok-4.7/)
lists text/image input, structured output, 500,000 context tokens and the two
token-price tiers. [xAI's guide](https://docs.x.ai/developers/grok-4-7) documents
the provider identifier `grok-4.7`. The private transport disables gateway cache
and payload logging, validates the actual returned model/envelope, and has no
automatic inference retries. Existing Grok 4.6/Fable chat and one-shot Canvas text
remain independent. No private administrator history or tools enter a member run.

The conversation update requires the additive Auth conversation migration, the
compatible AI Worker, dependent Auth Worker and tested frontend. Dialogue readiness
checks the signed dialogue protocol/policy version independently of old production
readiness. The existing compatible private media processor is reused. The moving required
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

- [`tests/q2-canvas-agent-conversation.spec.js`](../../tests/q2-canvas-agent-conversation.spec.js)
  covers authenticated briefing, queued-first automatic delivery, durable immediate intentions, typed action effects/confirmations, stop fences, explicit duration/delegation, replay, isolation,
  hostile memory, allowance revocation and unknown outcomes. Shared cases are
  included in native D1 Canvas acceptance; populated migration preserves old runs.
- [`tests/q2-canvas-agent-action-recovery.spec.js`](../../tests/q2-canvas-agent-action-recovery.spec.js)
  covers late stop fences, exact confirmations, concurrent recovery claims and
  failed action dependencies; the same cases execute with native D1.
- [`tests/q2-canvas-agent-dialogue-provider.spec.js`](../../tests/q2-canvas-agent-dialogue-provider.spec.js)
  checks real policy composition, strict signed dialogue normalization and exact
  prompt/quote alignment. Existing release/build checks reject policy leakage.

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

The observer browser cases dispatch persisted `pagehide`/`pageshow` events to
exercise restoration handlers; they do not prove that a browser history navigation
actually entered BFCache. Reload/edit persistence uses real navigation.

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
