# Public website assistant

Release contract: publish the assistant and its Admin control centre with public
inference **off**. Disabled publication is authorized independently of model access;
activation is a separate operation requiring verified access, pricing/terms, explicit
spending approval and genuine EN/DE acceptance. Synthetic results never satisfy those
gates. Do not submit another access application or make unpriced/unauthorized calls.

## Product and data boundary

The existing Help menu lazily opens a vanilla EN/DE chat. Only a validated page ID,
language, content version, typed question and bounded in-memory conversation are sent
to `/api/public/assistant/chat`. No DOM, form values, cookies, query parameters,
account records, assets, balances, jobs or admin content enter its model context.
The assistant cannot execute actions. Its text and independently approved BITBI
source links are rendered with DOM APIs. Navigation, logout and clearing discard
conversation state; closing/cancelling stops reading without automatic replay.

The Auth Worker uses its existing `AI` binding directly. It does not use the existing
`default` AI Gateway, whose read-only configuration showed content logging enabled.
Application prompts and responses are not logged or stored. Public rate limits use
daily pseudonymous client keys; aggregate usage/spend metadata is separate from
member billing and credits. See the updated public privacy section, not a claim of
EU-only processing or zero provider retention. No conflicting hard EU-only requirement
was found in the current privacy policy. Any new such requirement blocks activation.

## Knowledge and refresh

`workers/shared/website-assistant-content.mjs` contains 18 reviewed bilingual help
articles. Public packs, Pro allowances and catalog membership derive from existing
product contracts. Specific generation estimates and operation availability defer to
the current workspace/server controls; the assistant does not invent per-model quotes
or treat catalog membership as live availability. Canvas guidance is based on its real
workflow, saving and export behavior, rather than its public loading shell.

`config/website-assistant-sources.json` holds private build review anchors; these source
paths and excerpts never enter the public response or prompt. Retrieval is bounded,
deterministic lexical search. Missing evidence produces a local unknown answer without
paid inference. Three supported questions are selected and cached per page, language
and content version. There is no model call per page view or paid rewriting step.

After a related product/content change, review the matching article and source anchor,
then run `node scripts/check-website-assistant-knowledge.mjs --refresh`. The existing
static build rejects stale knowledge versions or changed review anchors. It also runs
`check-website-assistant-contract.mjs`: a change to the assistant implementation,
rates, approvals or limits invalidates its previous real-provider acceptance identity.
After reviewing such changes, refresh that contract with `--refresh`; this is not a
substitute for new affected real acceptance.

## Admin control centre

`/admin/#website-assistant` uses the existing English Admin shell, session, MFA and
same-origin protections. Direct API reads, saves, restore, configuration check and
real-response tests require the same guards. No dashboard read, suggestion preview or
configuration check calls a model.

The saved modes are Off, Admin test and Public. Effective state separately reports
missing evidence, deployment disablement, budget/request pauses and unavailable
bindings. A configured binding is not verified connectivity. Real-response tests also
require `spendingApproval.testApproved: true` in the reviewed budget record. Access
requires a valid recorded `accessVerifiedAt`; settings cannot edit approvals, prices,
security instructions or acceptance receipts. The model never switches automatically.

Settings include bounded answer length, a fixed tone choice, bilingual greeting,
languages, page eligibility, suggestion visibility and limits within the reviewed
approval. Revision conflicts retain the unsaved draft. Recovery restores the previous
settings with mode Off. Each successful change atomically records actor ID, time and
changed field names, retaining the latest 50 changes without message content.

The same durable ledger supplies request outcomes, latency and measured tokens;
consumption includes conservative unresolved reservations. Scope excludes rejected
requests and local unknown answers. Estimated inference cost, reserved cap consumption
and provider-billed totals are distinct. Missing prices/billing/verification remain
unknown. Dashboard freshness means the time of that metadata read, not a successful
provider health check. Synthetic usage never establishes genuine provider success.

Knowledge preview shows all approved EN/DE topics, BITBI source links and per-page
questions. To maintain it, edit the existing content module and matching review
anchors, inspect the preview, run the knowledge guard with `--refresh`, and use the
normal protected release. Recover an earlier reviewed content revision by reverting
that scoped content change through the same checks/release. The current content hash
is the identity; there is no inferred review date or separate CMS. Internal review
anchors are not returned in public or Admin topic content.

## Access, rates and architecture decision — 2026-10-01

Preferred pilot remains `@cf/swiss-ai/apertus-v1.5-8b`; the only configured alternative
is `@cf/utter-project/eurollm-9b-it`. Authenticated catalog and schema reads list both
and document messages, bounded output and SSE. They do **not** prove entitlement.
The model pages were inaccessible to this session; the catalog still points to access
applications. Neither model has a verified rate in the inspected general pricing
table. Streaming usage events, provider cancellation, exact access errors, latency
and German/English answer quality still require approved real acceptance.

Cloudflare's outstanding response must establish account entitlement, exact billing
units/rates/limits and applicable processing terms. Then obtain the owner's scoped
test budget and production cap. Existing private-chat approvals do not cover this
public feature. Keep credentials in the protected release setup, never chat or Git.

AI Search has no existing index in this account. Its maintained vanilla
[chat/search components](https://github.com/cloudflare/ai-search-snippet) were evaluated;
direct public endpoint integration would introduce another admission boundary and
does not fit the existing Help lifecycle. The small curated corpus currently needs
neither a new index nor a new UI framework. Retrieval and generation remain separate.
Neither requested model is a listed built-in AI Search generator.

Cloudflare documents no Regional Services support for Workers AI, AI Search or
AI Gateway. European model origin supplies no residency guarantee. Workers AI's
no-training-without-consent statement does not establish unconditional zero retention.
Sources: [processing](https://developers.cloudflare.com/workers-ai/platform/data-usage/),
[localization](https://developers.cloudflare.com/data-localization/compatibility/),
[Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/).

## Costs and enforcement

No real model tokens or inference cost have been measured: only fixtures have run.
For verified rates `I`/`O` dollars per million input/output tokens, a measured request
cost is `(inputTokens × I + outputTokens × O) / 1,000,000`. Bundled retrieval and
suggestion/rewrite inference cost zero; Worker and Durable Object usage is additional
infrastructure metering, subject to shared allowances. Workers Paid starts at
$5/account/month, not per assistant. Account subscription/unused allowance could not
be confirmed by this connector (read permission denied).

If later adopted, AI Search billing is announced for 2026-11-01: 1,000 semantic queries
per account/month included, then $0.75/1,000, with separate ingestion/storage allowances.
Included embeddings, reranking and internal indexing/crawling must not be double counted.
See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) and
[AI Search pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/).

If both preferred models remain blocked, the researched recommendation for a separate
owner decision is `@cf/mistralai/mistral-small-3.1-24b-instruct`, at published
$0.351/M input and $0.555/M output. Example: 3,000 input + 512 output costs about
$0.00134/request, or $0.134 for 100 questions before shared allowances/infrastructure.
A $1 acceptance ceiling and $1/day, $10/month initial inference cap are proposals,
not approvals. It is outside the implementation allowlist and has not been called or
quality-tested. [Model pricing](https://developers.cloudflare.com/workers-ai/models/mistral-small-3.1-24b-instruct/).

Default limits are 2,000 input characters, six history messages/6,000 history characters,
512 output tokens/8,000 output characters, six requests/client/minute, 100 paid requests/day,
two concurrent calls and a 30-second response deadline. An isolated instance of the
existing rate-limiter Durable Object atomically reserves daily/monthly USD micro-unit
spend before dispatch. Until the gated tokenizer contract is verified, it reserves the
model's full input context ceiling plus bounded output. Only positive measured terminal
usage refunds the difference. Unknown, failed and cancelled outcomes retain the full
reservation and concurrency lease; timeout does not prove inference was free/stopped.
No automatic provider retry or fallback occurs. Usage records contain no transcripts.

## Existing acceptance and release path

Focused local entry: `npm run test:website-assistant`; native boundary:
`node scripts/test-q2-runtime.mjs --suite website-assistant` under the runbook's approved
OS network sandbox. The existing `test:workers` caller includes both the focused checks
and the native suite; `test:homepage-core`/`test:static` execute the connected Help
checks in Chromium and WebKit. Cosmetic assistant edits select browser acceptance
without forcing backend tests. No decorative Hero tests are added.

`tests/fixtures/website-assistant/questions.json` is the small DE/EN grounded/unknown
evaluation set. Fixtures verify the interface, boundaries and enforcement; they are
not model quality or live acceptance. Once access/rates/spending are approved, the
existing admin/MFA-protected `/api/admin/website-assistant/acceptance` route permits
bounded real checks while public acceptance remains unset. Review grounding, unknowns,
citations, latency, measured tokens, cancellation and both languages against those
questions and the actual UI. Preserve the original result and source identity.

For public activation, only then populate the reviewed config's acceptance record with model, knowledge and
implementation versions, real-provider EN/DE results, exact source SHA and date. Follow
the existing protected Auth → frontend candidate release; no new proof pipeline or
environment bypass. The `WEBSITE_ASSISTANT_ENABLED` switch and release compatibility
expectation remain false for this disabled release. Publish Auth prerequisites and
the tested frontend through the existing main-to-live continuation; access/pricing
do not block the disabled Admin surface. Verify deployed identities, protected API
responses and public-off behavior without inference. Authenticated production UI
observations require an available authorized session; disclose their absence. A
dispatch is not a live receipt. After separately approved activation, verify the real
EN/DE visitor flow and update privacy availability wording.

Emergency disable: save **Off** in Admin. Its revision and budget admission share the
existing durable object, so new public inference cannot pass an earlier settings
read. The scoped deployment switch provides a second disable path through a protected
Auth release. Ordinary Help stays available; unrelated AI/media/billing switches are
unchanged. Running provider work is cancelled best effort, without assuming a refund.
