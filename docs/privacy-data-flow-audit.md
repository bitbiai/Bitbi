# Privacy Data Flow and Contract Evidence

Future audit work starts from [docs/audits/NEXT_AUDIT_BASELINE.md](audits/NEXT_AUDIT_BASELINE.md).

Reviewed: 2026-10-23. Engineering evidence for owner/counsel review, not legal
certification. Public documents and source establish only the facts stated below;
account agreements and transfer assessments require separate evidence. The model
inventory is [privacy-provider-routes.json](../config/privacy-provider-routes.json),
not a second availability or spending policy. Release/schema authority remains
[release-compat.json](../config/release-compat.json).

## Actual routes and data

| Route / source | Data, role and boundary |
| --- | --- |
| Public frontend — `config/static-hosting.json` | Cloudflare `bitbi-frontend` serves requests, network metadata and static content. Authorized deployment readback confirmed this on 2026-10-23. GitHub hosts source/CI/release evidence, not ordinary visitor delivery; following GitHub links is separate. [GitHub statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). |
| Auth, D1, R2, Images, queues and private-media processing | Account/session/security data, credit/usage records, prompts and saved media metadata/bytes. Private access and public publication remain separate. Cloudflare service locations are not established by its US seat. [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/) and [subprocessors](https://www.cloudflare.com/gdpr/subprocessors/). |
| Cloudflare-hosted `@cf/` inference — `workers/ai/src/lib/invoke-ai.js` and generation callers | Text, references and generation settings go to Cloudflare-hosted inference. The developer named in the model ID is not thereby an API recipient; there is no corresponding author API call in these paths. This is different from third-party gateway models. |
| Gateway media — Auth `routes/ai/{images-write,video-generate,music-generate}.js`, AI `invoke-ai-video.js` | Selected supplier receives applicable prompts, lyrics, images/video references and settings; generated media return through Cloudflare or provider delivery. Usage identifiers, callbacks and storage receipts persist independently. Supported catalog entry does not prove account availability. |
| Canvas assistant — `canvas-agent-model-operations.js`, `canvas-agent-plan.js`, shared Fable adapter | Selected Grok/Fable receives bounded project conversation, brief, relevant graph/media references, execution/budget/error facts and shared instructions. Durable operations use Cloudflare REST `/ai/run` background envelope; Fable retains native Messages input/output. Supported Grok visual review sends selected frames; Fable is not the visual reviewer. Project memory is persisted, unlike the disabled public website assistant. |
| Private Admin assistants — `grok-chat.js`, Admin chat/memory helpers | Separate conversations/memory and optional tools/location; not imported into member Canvas. Gateway payload logging controls do not establish provider retention/training terms. |
| Vidu direct fallback — AI `invoke-ai-video.js` | `api.vidu.com`, Admin Q3 route only; requires configured key, gateway mode, no gateway identity and positive `not_dispatched` validation evidence. Timeouts/unknown outcomes prohibit fallback. Deployed key **presence** was verified 2026-10-23; this proves potential execution, not actual use or an applicable contract. |
| PixVerse direct extend — Auth `pixverse-extend.js` | `app-api.pixverse.ai` is a distinct Admin extension route. No corresponding key binding was present in the inspected Auth deployment on 2026-10-23; retain the conditional route disclosure and do not activate it as a test. |
| Stripe — Auth `stripe-billing.js` / verified fulfillment | Customer, order, payment, subscription and tax metadata; payment details go to Stripe. [DPA, updated 2026-09-28](https://stripe.com/legal/dpa) distinguishes processor services from controller purposes such as fraud/compliance. Applicable agreement, not the brand, determines the contracting entity. |
| Resend — `email.js`, transactional messages, contact Worker | Recipient and verification/reset/contact/contract/declaration messages plus send status. [DPA](https://resend.com/legal/dpa) names Plus Five Five, Inc. (US), incorporated on agreement acceptance; SCC modules 2/3 depend on roles. Electronic incorporation can suffice: no invented wet-signature requirement. |

Cloudflare [Unified Billing documentation](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)
states that supplied provider credentials and a stored default BYOK key take precedence
over Cloudflare-managed billing credentials. An `AI.run` call or Cloudflare invoice
alone does not prove the complete receiving/contractual chain. No private gateway
key values were read. The inspected Canvas background path disables payload logging
and cache, retaining limited operation metadata; that does not promise zero supplier
retention, EU-only processing, or universal no-training treatment.

## Supplier evidence and unresolved contract coverage

Public sources below were checked on 2026-10-23. Direct API terms identify their own
parties; they do **not** prove those parties or terms cover BITBI's gateway route.
US/EU/UK/Swiss company seats are not an inventory of processing/access countries.

| Supplier route | Official business/API evidence | Missing BITBI evidence / owner |
| --- | --- | --- |
| OpenAI gateway images | [Business DPA](https://openai.com/policies/data-processing-addendum/): OpenAI Ireland Ltd. for direct EEA/Swiss customers, OpenAI OpCo, LLC otherwise; processor obligations under the incorporated services agreement. | Owner: gateway supply chain, effective account agreement/DPA, receiving affiliates and locations. Consumer privacy terms are not substituted. |
| Anthropic gateway Fable | [Commercial terms](https://www.anthropic.com/legal/commercial-terms) and [DPA](https://www.anthropic.com/legal/data-processing-addendum): Anthropic Ireland, Limited for direct EEA/Swiss/UK customers, Anthropic, PBC otherwise; business customer content obligations. | Owner: applicable gateway contract, subprocessing role, actual receiving entity and onward transfers. |
| BFL gateway FLUX Max | [EU Developer terms](https://bfl.ai/legal/eu-developer-terms-of-service) name BFL GmbH; [non-EU Developer terms](https://bfl.ai/legal/developer-terms-of-service) name Black Forest Labs Inc. Website/Playground terms are not the API contract. | Owner: actual gateway recipient and incorporated API/DPA terms. Hosted `@cf/` FLUX remains a separate Cloudflare route. |
| xAI gateway | [Enterprise API terms](https://x.ai/legal/terms-of-service-enterprise), 2026-08-14, name SpaceXAI LLC (US); business service/embedded application terms differ from consumer Grok terms. | Owner: effective gateway agreement and processing/transfer annexes. No verified DPF assertion for xAI/SpaceXAI. |
| ElevenLabs Music v2 gateway | Official DPF profile below; [Music terms](https://elevenlabs.io/music-terms), 2026-10-09, distinguish plan-specific use rights and require express written authorization for music-model resale. | Owner: actual Cloudflare/ElevenLabs reseller/order coverage, plan and permitted end-user film/TV/games/distribution uses. Self-serve music terms alone do not establish BITBI's permission. No automatic route disable or supplier agreement acceptance performed. |
| MiniMax music/H3 gateway | [Open Platform API terms](https://platform.minimax.io/protocol/terms-of-service), [paid agreement](https://platform.minimax.io/protocol/paid-agreement) and [API privacy](https://platform.minimax.io/protocol/privacy-policy) name Nanonoble Pte. Ltd., Singapore. | Owner: Cloudflare supplier/billed entity and applicable locations/processing terms. Neither brand origin nor consumer app terms prove this route's recipient. |
| ByteDance Seedance gateway | [BytePlus customer agreement](https://docs.byteplus.com/en/docs/legal/docs-customer-agreement), 2026-09-30, names BytePlus Pte. Ltd. **or a designated affiliate**. | Owner: whether this agreement applies at all to Cloudflare Seedance; exact billed/receiving party, model-specific terms, access/storage locations and transfer mechanism. |
| Alibaba HH1 gateway | [Alibaba Cloud international product terms](https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-product-terms-of-service-v-3-8-0) cover Model Studio and separate third-party model terms; these do not identify Cloudflare HH1's contract. | Owner: actual gateway supplier agreement/invoice entity, service and processing locations. No country inferred from model prefix. |
| Google gateway Omni | Google LLC official DPF scope below; hosted Gemma/EmbeddingGemma requests are separate. | Owner: actual Google service/order, applicable contracting/receiving entity and gateway onward-transfer scope. |
| Vidu gateway and direct | [Vidu policy](https://www.vidu.com/privacy), 2026-07-03, names ShengShu AI HK Limited and Singapore storage / possible China processing. This is a public policy, not proof of BITBI's direct API agreement or Cloudflare chain. | **Owner priority:** configured direct-route account/API terms, billed entity, Singapore/China access and applicable safeguards/TIA. Do not treat public policy consent as GDPR Art. 49 authorization. |
| PixVerse gateway / conditional direct extend | [API Platform Terms](https://pixverse.ai/en/pixverse-platform-terms-of-service), 2026-09-04, name operator MOTIVAI PRIVATE LIMITED and possible affiliate AIVORA PTE. LTD. (Singapore). Terms require written permission for specified API resale/commercial uses. | Owner: gateway reseller/use permissions and actual recipient; direct-route account evidence before activation. Absence of its deployed key does not settle gateway coverage. |

The official EU adequacy list does not include China, Hong Kong or Singapore. Missing
contract evidence is **unverified**, not a finding that an agreement does not exist.
It prevents certifying a transfer basis. The operator must resolve the actual chain
before asserting its lawfulness; a public warning, ordinary terms consent or a DPF
badge on an intermediary cannot supply missing onward-transfer safeguards.

## DPF and international transfers

Official [US Department of Commerce register](https://www.dataprivacyframework.gov/list)
was rendered and its participant profiles read on 2026-10-23, approximately
13:16–13:20 UTC. Original profile/search evidence is retained in the protected local
legal evidence cache (`dpf-official-search.json`, `dpf-official-profiles.json`), not Git.

| Exact legal entity / participant | Register status and scope |
| --- | --- |
| Cloudflare, Inc. / 5666 | Active — Re-certification under Review; EU-US, UK extension, Swiss-US; HR/non-HR. No additional covered entities listed. Covers its stated service data, not automatically every downstream AI supplier. |
| Google LLC / 5780 | Active; all three frameworks; HR/non-HR. Specified wholly owned US subsidiaries with profile exceptions; not an assertion that every Google global entity is covered. |
| Eleven Labs Inc. / 9996 (display ElevenLabs) | Active; all three frameworks; HR/non-HR; profile purposes include service inputs/outputs. No additional covered entities listed. Contracting/route scope still requires verification. |
| OpenAI, Anthropic, Black Forest Labs, xAI/SpaceXAI searches | No matching result was established in the official search. **Unverified**, not “not certified”; no absent/negative certification conclusion. Obtain exact receiving-entity record or applicable alternative safeguard. |

The [Commission's current adequacy list](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/adequacy-decisions_en)
includes Switzerland and UK decisions renewed in December 2025. Apply their actual
scope to storage/access, not only supplier seat. EU-to-Switzerland adequacy does not
answer whether BITBI's Swiss-user processing falls under the FADP or how onward
transfers are covered. The [FDPIC guidance](https://www.edoeb.admin.ch/en/cross-border-transfer-of-personal-data)
requires applicable Art. 16/17 safeguards, country/guarantee inventory and appropriate
SCC adaptations where relevant; counsel must assess BITBI's actual Swiss nexus.

For uncovered restricted transfers, obtain the effective DPA/SCC version, acceptance
evidence (including valid online incorporation), parties, modules/annexes, onward
subprocessors and any required transfer-impact assessment/supplementary measures.
Public SCC availability is not account acceptance; no completed BITBI TIA was found.
Store agreements, invoices, acceptance logs and assessments privately.

## Offer and consent decisions

### Versioned interim integration (2026-10-24)

The revised notices narrow unsupported promises; they do not establish missing
supplier coverage, fix analytics consent, change credit balances or resolve the
confirmation-before-performance boundary below. The owner confirmed Pro's
top-up-to-6,000 intent; the general credit-bucket balance/consumption discrepancy
still needs a separate implementation and acquired-rights decision.

New checkout admission uses `2026-10-25`. Fulfillment separately recognizes the immutable
`2026-10-23` and `2026-10-24` snapshots, validates owner, scope, version and hash,
and uses the text and consent stored at purchase. Those bundles stay in
`consumer-terms-content-2026-10-23.js` and `consumer-terms-content-2026-10-24.js`.
Completed documents and unknown mail payloads are never regenerated. Old cached clients receive an explicit refresh
response before a new Stripe checkout. The `2026-10-22` creation cutoff is
unchanged. A new website version does not replace existing customer contracts.

Counterchecks: signed consumer cases in `q2-billing-pack.spec.js`, populated native
subscription cases in `q4-runtime-consumer-billing.mjs`, and the existing
`@consumer-contract` browser callers. The privacy guard retains the exact model
inventory, direct-route drift and missing protected-caller controls.

The legal table's focused-region ArrowRight failed in an isolated WebKit
overflow fixture while programmatic scrolling worked. `js/pages/legal/tables.js`
handles only unmodified horizontal/Home/End keys on that region, with cleanup
across soft navigation. The EN/DE browser case checks both engines, exact movement,
descendant/modifier exclusion and listener removal. These source changes and
local checks are not publication evidence; use the protected release receipt.

The `bf06cbca` core browser attempt exposed a stale English classification of
the already-German `/legal/datenschutz.html` alias. Its navigation also selected
English after initialization. Keep this alias German with or without the static
server's `.html` normalization, retain its canonical URL, and send its EN switch
to `/legal/privacy.html`. The existing locale and `@consumer-contract` callers
cover cookie overrides, near-match/Admin exclusions and the actual language switch
in Chromium/WebKit. The legal document body remains unchanged by this repair.

Current [§356 BGB](https://www.gesetze-im-internet.de/bgb/__356.html) addresses services
in (5), non-physical digital content in (6). [§327](https://www.gesetze-im-internet.de/bgb/__327.html)
does not classify a credit merely by its name. [§312f](https://www.gesetze-im-internet.de/bgb/__312f.html)
confirmation, [§356a](https://www.gesetze-im-internet.de/bgb/__356a.html) withdrawal
and [§312k](https://www.gesetze-im-internet.de/bgb/__312k.html) cancellation are distinct.

| Offer / source | Established product facts | Owner/counsel decision before an extinction policy |
| --- | --- | --- |
| Starter / Creator — `js/shared/live-credit-packs.mjs`, signed Stripe fulfillment | One-time credits for later generation; not a recurring subscription. Purchased credit history is separate from monthly grants. | Classify the **actual single offer**, contract-conclusion event and performance; decide appropriate early-start/knowledge wording. Do not silently split contracts or treat first use as automatic extinction. |
| BITBI Pro — `js/shared/member-subscription.mjs` | Monthly 6,000 credits plus continuing features and 5 GB storage. Billing/cancellation do not themselves delete account/media. | Confirm continuing-service/mixed-contract treatment, full-performance conditions, term/renewal and end-of-period credit/storage consequences. First credit use is not full performance of an ongoing service. |
| Organization checkout — Auth `routes/orgs.js` | A separate purchase path exists. Organization naming alone does not establish B2B status. | Verify buyer eligibility and contractual exclusion, if any; retain consumer protections absent established B2B facts. |

Conservative implementation records early-start request and knowledge separately,
with immutable accepted offer/text/version; it does not infer expired rights from
credit use or age. Signed payment fulfillment remains independent of declaration
receipt and of refunds. New purchase documents must reach the durable-confirmation
boundary before performance is enabled; a queued email is not delivered evidence.
Legacy paid sessions retain their historical terms/consent without invented proof.

**Unresolved performance-timing boundary:** the implementation persists an immutable
account document and queues confirmation email in the verified fulfillment
transaction. Credit access is not gated on providing that email before performance.
Neither a queued message nor a stored document alone is asserted to prove timely
durable provision under §312f. The owner decision on that product/performance boundary
and a prolonged mail outage is pending; publication must not describe this point as
legally resolved. No already purchased benefits were revoked to manufacture compliance.

**Bounded old-client transition:** new checkout requests with the previously
published `2026-10-22` terms may be accepted only through
`2026-10-25T23:59:59.999Z`. They retain the recorded legacy consent and do not acquire
a fabricated `2026-10-23` snapshot; consequently the new confirmation pipeline is
not established for that temporary creation path. After the server cutoff, a new
legacy-version request receives `terms_version_outdated` and reload guidance.
Already-created sessions remain eligible for signature-verified fulfillment under
their original evidence after that date. This compatibility window is not a legal
exemption or a retroactive assertion of consent/withdrawal extinction.

## Consolidated owner/counsel inputs

1. Approve classification, contract-conclusion/performance timing and exact consent
   wording for each offer above; establish genuine B2B eligibility where claimed.
2. Supply the applicable Cloudflare account agreement/DPA, gateway credential mode,
   third-party/reseller chain and processing-location annexes. Prioritize the
   configured Vidu direct API route and ElevenLabs/PixVerse resale/use rights; obtain
   actual MiniMax, ByteDance and Alibaba supplier/billed entities.
3. Supply effective Stripe entity/role agreement and Resend account acceptance/DPA
   records; verify transactional sender/domain and delivery-event configuration.
   A provider send acceptance is not proof of inbox delivery.
4. Supply remaining exact-entity DPF evidence or effective SCC/annex/TIA coverage
   and necessary supplementary measures; assess actual UK access and Swiss-user
   applicability. No supplier terms were accepted on the owner's behalf.
5. Assign declaration-review responsibility/deadlines and the decision for a
   prolonged confirmation-mail outage. Refund/credit/subscription consequences
   require verified association and existing authorized workflows; no automatic
   clawback, test purchase, live cancellation or mass historical email is authorized.

## Guard and retained boundaries

`tests/privacy-ai-recipients.test.mjs` compares the canonical Admin/Canvas/assistant
catalog to the route inventory and all EN/DE disclosures. Positive and broken cases
detect a new model, missing direct fallback, wrong hosted recipient, newly introduced
API host in the covered callers, and a missing disclosure row. Existing
`test:asset-version` executes it once in the unconditional protected
`config/release-validation.yml` caller. A removed/conditional caller and a removed
package entry fail counterchecks. Protected impact selection also covers the
inventory/caller inputs. Discovery is not a passed execution.

Do not publish raw prompts, provider bodies, signed media URLs, secrets, raw payment
identifiers or private agreements. Retain existing [data inventory](../DATA_INVENTORY.md),
[retention policy](DATA_RETENTION_POLICY.md) and [tenant evidence](tenant-assets/evidence/README.md)
boundaries: legacy ownership/backfill, irreversible deletion and public/gallery resets
are not certified or authorized by this legal change. Deletion/lifecycle evidence is
not permission to erase billing, recovery or legal records. No new live billing,
tenant-isolation, supplier-contract or complete legal-compliance claim is made here.
