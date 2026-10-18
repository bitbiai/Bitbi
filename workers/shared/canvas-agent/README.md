# Canvas runtime policy

This directory contains nonsecret, server-only build inputs for the Canvas
specialist. It is separate from repository `AGENTS.md` instructions for developers.
Application users cannot upload, select or modify these instructions. Source may
be publicly readable; authorization never depends on hiding the policy text.

`manifest.mjs` statically imports the approved core, personality and six skills.
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
