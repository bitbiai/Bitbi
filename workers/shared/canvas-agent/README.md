# Canvas runtime policy

This directory contains nonsecret, server-only build inputs for the Canvas
specialist. It is separate from repository `AGENTS.md` instructions for developers.
Application users cannot upload, select or modify these instructions. Source may
be publicly readable; authorization never depends on hiding the policy text.

`manifest.mjs` statically imports the approved core, personality and skills.
It composes only the skills selected for a known phase. The AI Worker imports the
package normally; there is no runtime filesystem/network loader or client path.
Planning and correction retain the production JSON contract, evaluation retains
the sampled-frame JSON contract, and briefing uses the independent dialogue
contract in `../canvas-agent-dialogue.mjs`. Existing signed prepare/normalize
endpoints perform no inference themselves. Auth owns the existing durable
background dispatch, wallet admission, callback and settlement paths.

Each preparation records the package version, phase, selected skill versions and
SHA-256 of the effective system text. Quote admission uses the same composed
instructions and schema as the provider request. New dialogue/production steps
pin the policy before allocation; evaluation pins it with its sample plan. If an
undispatched step has no pin or its policy has changed, it requires review before
any reservation or paid call. Already accepted operations normalize using their
immutable original context, including after a release or model disablement.
Hashes identify accepted content; protected source publication remains the
authority to change it.

The current `canvas-policy-4` core names the Canvas role independently of its
provider. Versions 1, 2 and 3 retain their original text, skill selection and hashes
for accepted operations. Both admitted assistants receive the same canonical
project context and phase skills; neither receives private Admin conversations,
tools or opaque provider thinking/signatures. The project selector is stored in
`canvas_agent_conversations`; new production runs and dialogue turns pin its
model and revision. A switch cancels unaccepted quotes, not accepted operations.
Planning, corrections, billing receipts and message attribution keep the model
that was accepted even when a later conversation uses a different one.

Briefing/explanation v4 loads `skills/project-explanations.mjs`. Its bounded
`currentProject.execution` context is assembled from existing project, budget,
event, action, step, receipt and export rows by
`canvas-agent-conversation-context.js`. It records observation time/revisions,
detects concurrent source changes, separates historical errors from current
state and distinguishes the briefing allowance from production authorization.
The observer contains only SELECTs and never dispatches or repairs work. Both
native adapters and their quotes receive this same canonical context.

Model replies retain their original text; application receipts never replace
them. Message `provenance`/`kind` distinguish model answers, application
decisions, local explanations and operation acknowledgements. Safe local status
and `production.reconcile` explanations work without paid inference. Explanatory
questions and quoted commands cannot mutate creative memory or create actions.
Generic limits are clarified; a model cannot reinterpret a production budget as
the conversation allowance. Historical allowances and production caps remain
separate records and are not silently corrected.

`js/shared/canvas-assistant-models.mjs` lists integrated adapter contracts, while
`canvas-agent-assistant-models.js` combines those contracts with the Canvas area
switch, deployment readiness and valid retail tariffs. Grok 4.7 remains the
historical default. Fable 5 uses the existing Cloudflare `/ai/run` background
route with the real `anthropic/claude-fable-5` native Messages body. Its
`output_config.format` requests a JSON schema; unsupported schema constraints
are explained in descriptions and the complete local validator still enforces
them before acceptance. Adaptive thinking is included in reported output tokens.
The request has no cache-control or external tools; unexpected billed cache or
inconsistent usage enters review instead of silently changing the tariff.
Quotes account for the actual system, schema and canonical data context with a
model-specific input bound and output ceiling. Grok's separately versioned
conservative context admission and historical settlement review remain intact.

Other actual platform text-model IDs are shown with an explicit exclusion reason
until a Canvas adapter with these contracts is integrated. A model appearing in
the catalog or documentation does not prove account access. There is no fallback
to another provider. Fable visual evaluation is currently unavailable in this
adapter: production records technical-only review with
`model_visual_review_unavailable`, charges no visual review and makes no claim
that the assistant watched the film. Ordinary media models and editing/export
remain independent of the selected assistant.

Transport and metering references (reviewed 2026-10-19):

- [Cloudflare Fable 5 native Messages model contract](https://developers.cloudflare.com/ai/models/anthropic/claude-fable-5/)
- [Cloudflare unified REST background envelope](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)
- [Native JSON-schema output and supported schema constraints](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Adaptive thinking and output usage](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost)
- [Explicit prompt-cache controls and usage](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

Briefing context is reconstructed by Auth from this project's validated current
brief, recent completed messages, selected current graph data and execution
facts. User content stays inside a single data message, never a system message.
Replies may propose allowlisted creative-field updates with source message IDs;
they cannot authorize production, set budgets, modify tools or edit the graph.
Duration admission and spending approval remain deterministic application gates.
Missing duration is unresolved, not delegation. Historical accepted creative and
exact-duration requests retain their original semantics.

Conversation retention, corrections, deletion and separate conversation/brief
revisions live in `workers/auth/src/lib/canvas-agent-conversation.js` and its
project-scoped route. Nodes, assembly, media and export receipts remain the
existing execution facts. Chat availability never owns the production loop or
manual editing. Receipt normalization accepts valid earlier policy identities
and never makes an uncertain request eligible for fresh inference.

Policy/schema and signed-adapter regressions are discovered through
`tests/q2-canvas-agent-dialogue-provider.spec.js`; durable release-boundary cases
live in `tests/helpers/canvas-agent-model-operation-cases.mjs`. The normal release
candidate checks must also verify these Worker inputs are absent from public
frontend assets and their import graph. Synthetic provider tests do not prove
configured live account access or subjective conversational quality.
