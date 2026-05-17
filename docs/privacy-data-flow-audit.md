# Privacy and Data-Flow Audit

Audit date: 2026-05-03

Last reconciled: 2026-05-16

Scope: repository-level audit for the public privacy policy and German
Datenschutzerklaerung. This report is an engineering/privacy inventory, not
legal advice and not a compliance certification. It is intended for owner and
German/EU privacy-lawyer review before relying on the public wording as final
legal text.

Current release truth: `config/release-compat.json` declares the latest auth D1
migration as `0053_add_platform_budget_caps.sql`. This audit
does not approve production deploy, full live billing readiness, full SaaS
maturity, full tenant isolation, or legal compliance.

Phase 4.18 adds no migration and no new user-facing data collection. It reads
existing `platform_budget_usage_events`, `admin_ai_usage_attempts`, and
`ai_video_jobs` rows for admin-only, read-only platform budget reconciliation
evidence and dry-run repair candidates. It does not expose raw prompts,
provider bodies, generated outputs, secrets, Stripe data, Cloudflare values, or
apply any repair.

## 1. Executive Summary

The current product is no longer a simple static website. The repository now
contains account creation, session authentication, email verification and
password reset, profile/avatar data, wallet linking, favorites, AI generation
for image/text/video/music, saved assets and folders, public publication
features for Mempics/Memvids/Memtracks, member and organization credit ledgers,
member subscription and credit bucket scaffolding, Stripe checkout/webhook
processing, admin audit and user activity logging, data lifecycle
planning/export archives, Cloudflare R2/D1/Queues/Durable Objects, and
Cloudflare Workers AI / AI Gateway model calls.

Phase 4.1 adds admin/platform AI budget policy design and local
registry/baseline/check metadata only. Phase 4.2 adds pure admin/platform
budget policy helper contracts, deterministic tests, and stricter baseline/check
metadata for kill-switch targets or explicit exemptions plus future enforcement
paths. Phase 4.3 uses that helper only on the existing charged Admin BFL
image-test branch to record safe `admin_org_credit_account` plan/audit metadata
in the admin response, `usage_events`, and `ai_usage_attempts` metadata. Phase
4.4 adds read-only Admin/Platform AI budget evidence reporting. Phase 4.5 uses
the helper only for admin async video jobs, adding sanitized
`platform_admin_lab_budget` job metadata and bounded queue budget summaries
before internal video task create/poll. Phase 4.6 uses the helper only for
OpenClaw/News Pulse visual generation, adding sanitized
`openclaw_news_pulse_budget` visual metadata before generated-thumbnail provider
calls and preserving status/attempt duplicate suppression. Phase 4.7 adds an
internal AI Worker caller-policy guard/metadata contract: signed internal calls
may include `__bitbi_ai_caller_policy`, the AI Worker validates it after
service-auth, and the reserved key is stripped before provider payload handling.
Phase 4.8 uses the helper only for admin text and embeddings test routes,
requires `Idempotency-Key`, returns sanitized `platform_admin_lab_budget`
budget/caller summaries, and propagates signed `budget_metadata_only`
caller-policy metadata to the AI Worker. Phase 4.8.1 adds additive migration
`0051_add_admin_ai_usage_attempts.sql` and metadata-only durable idempotency rows
for those same two admin routes, suppressing same-key duplicate provider calls
and same-key/different-request conflicts without storing generated text or
embedding vectors. Phase 4.8.2 adds no storage or migration; it adds admin-only
sanitized list/detail inspection and bounded non-destructive cleanup that marks
expired pending/running admin AI attempts without deleting rows. Phase 4.9 adds
no storage or migration; it extends the same metadata-only
`admin_ai_usage_attempts` foundation only to Admin Music and stores no raw
prompts, lyrics, audio, or provider bodies. Phase 4.10 adds no storage or
migration; it extends that foundation only to Admin Compare and stores no raw
prompts, compare outputs, provider request bodies, or provider response bodies.
Phase 4.11 adds no storage or migration; it audits Admin Live-Agent only.
Phase 4.12 adds no migration and reuses `admin_ai_usage_attempts` only for
Admin Live-Agent metadata-only stream-session attempts, duplicate suppression,
same-key conflict detection, caller-policy propagation, and observable stream
completion/failure summaries. It does not persist Live-Agent messages/output,
full stream replay, provider request bodies, or provider response bodies. Phase
4.13 adds no migration or storage; it retires Admin sync video debug from normal
provider-cost operations as disabled-by-default/emergency-only and keeps async
admin video jobs as the supported budgeted admin video path. Phase 4.14 adds no
migration or storage; it classifies Admin Image branches, keeps charged priced
models on the existing selected-organization path, treats FLUX.2 Dev as an
explicit unmetered admin exception with safe metadata, and blocks unclassified
models before provider execution. Phase 4.15 adds no migration or storage; it
enforces default-disabled Cloudflare master runtime budget switches for already
budget-classified admin/platform provider-cost paths before
provider/queue/credit/durable-attempt work and reports only safe boolean switch
state, never values. Phase 4.15.1 adds migration `0052` and stores only D1
app-level budget switch booleans, bounded operator reasons, safe metadata,
safe updater identifiers, idempotency keys, request hashes, and timestamps.
It does not store Cloudflare variable values, Cloudflare API tokens, prompts,
provider payloads, Stripe data, auth headers, cookies, private keys, or
secrets, and the Admin UI cannot mutate Cloudflare master flags. Phase 4.16
adds no migration, storage, or runtime route behavior change; it documents
future live platform budget cap tables and adds read-only cap-readiness evidence.
Phase 4.17 adds migration `0053` and stores only `platform_admin_lab_budget`
daily/monthly cap limits, bounded cap update events, and bounded usage events
for selected admin lab routes. It is not customer billing and does not store raw
prompts, provider bodies, Stripe data, Cloudflare values/tokens, or member/org
billing records.
These phases do not
call real providers in tests, change public billing, add provider-cost action buttons, migrate Admin
video beyond Phase 4.5, migrate OpenClaw/News
Pulse beyond Phase 4.6 compatibility, migrate platform/background AI, globally
hard-fail internal AI Worker routes, change member image/music/video billing
behavior, change org-scoped member route behavior, or make
admin/platform/internal AI cost flows production-ready. Phase 4.3, Phase 4.5,
Phase 4.6, Phase 4.7, Phase 4.8, Phase 4.8.1, Phase 4.8.2, Phase 4.9, Phase 4.10,
Phase 4.11, Phase 4.12, Phase 4.13, Phase 4.14, Phase 4.15, Phase 4.16, and Phase 4.17
metadata/inspection responses must not include raw prompts, raw lyrics, raw
audio, raw compare prompts, compare outputs, raw Live-Agent messages/output, raw provider request bodies, provider response bodies, auth headers, cookies, Stripe data,
Cloudflare tokens, private R2 keys, secrets, or sensitive raw article/source
payloads beyond already public-safe text.

The existing public privacy pages were materially stale. They described a
lighter site, made broad third-party/no-sharing statements that are no longer
accurate, and included old Cloudflare RUM/YouTube/contact retention claims that
are not proven by the current code. The replacement wording should be
transparent but defensive: describe categories and flows, avoid EU-only or
immediate-deletion guarantees, distinguish private saved assets from published
public media, and identify provider/retention questions for legal review.

## 2. Files and Areas Inspected

Representative files and searches inspected:

| Area | Files/routes inspected |
| --- | --- |
| Legal pages | `legal/privacy.html`, `legal/datenschutz.html`, `legal/imprint.html`, `docs/privacy-compliance-audit.md`, `DATA_INVENTORY.md`, `docs/DATA_RETENTION_POLICY.md` |
| Public/static frontend | `index.html`, `account/*.html`, `admin/index.html`, `js/pages/**`, `js/shared/**`, cookie consent, wallet, global audio, site header, saved assets, public media UI |
| Browser storage | `js/shared/cookie-consent.js`, `js/shared/audio/audio-manager.js`, `js/shared/active-organization.js`, `js/shared/wallet/*`, `js/pages/admin/ai-lab.js`, `index.html`, `js/shared/site-header.js`, `js/pages/index/category-carousel.js` |
| Auth worker | `workers/auth/src/index.js`, `routes/auth.js`, `routes/password.js`, `routes/verification.js`, `routes/profile.js`, `routes/avatar.js`, `routes/favorites.js`, `routes/wallet.js`, `routes/orgs.js`, `routes/ai.js`, gallery/video/audio gallery routes, billing webhook routes |
| AI/media storage | `workers/auth/src/routes/ai/*`, `workers/auth/src/lib/ai-text-assets.js`, `generated-audio-save.js`, `member-music-cover.js`, `ai-image-derivatives.js`, `ai-video-jobs.js`, public media routes |
| Admin/audit/lifecycle | `routes/admin*.js`, `lib/activity*.js`, `lib/data-lifecycle.js`, `lib/data-export-archive.js`, `lib/data-export-cleanup.js`, admin MFA files |
| Billing/credits | `lib/billing.js`, `lib/stripe-billing.js`, `lib/billing-events.js`, `routes/account-credits.js`, `routes/admin-billing.js`, `routes/billing-webhooks.js` |
| AI worker | `workers/ai/src/index.js`, `routes/text/image/music/video/video-task/live-agent`, `lib/invoke-ai.js`, `lib/invoke-ai-video.js`, shared admin AI contract |
| Schema/config | all `workers/auth/migrations/*.sql`, `workers/*/wrangler.jsonc`, `config/release-compat.json`, `workers/auth/src/app/route-policy.js` |
| Tests as behavioral evidence | `tests/workers.spec.js`, `tests/auth-admin.spec.js`, `tests/smoke.spec.js`, helper harness searches |

Repo-wide searches included privacy-sensitive terms such as `localStorage`,
`sessionStorage`, `cookie`, `Stripe`, `Resend`, `Cloudflare`, `AI.run`,
`pixverse`, `vidu`, `minimax`, `publication`, `favorites`, `data_lifecycle`,
`audit`, `activity`, `R2`, `D1`, `youtube`, and `cloudflareinsights`.

## 3. Authoritative References Considered

| Topic | Source |
| --- | --- |
| GDPR / DSGVO | Official EUR-Lex Regulation (EU) 2016/679: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679 |
| German TDDDG device storage/cookies | Official `gesetze-im-internet.de` Section 25 TDDDG: https://www.gesetze-im-internet.de/ttdsg/__25.html |
| German BDSG | Official English BDSG text: https://www.gesetze-im-internet.de/englisch_bdsg/ |
| EU AI Act context | Official EUR-Lex Regulation (EU) 2024/1689: https://eur-lex.europa.eu/eli/reg/2024/1689/oj |
| German DSK AI guidance context | Official supervisory-authority listing of DSK AI guidance: https://www.lda.brandenburg.de/lda/de/datenschutz/institutionen-und-dokumente/orientierungshilfen-und-anwendungshinweise-der-dsk/ |
| Cloudflare privacy | Cloudflare Privacy Policy: https://www.cloudflare.com/privacypolicy/ |
| Cloudflare DPA | Cloudflare Data Processing Addendum: https://www.cloudflare.com/cloudflare-customer-dpa/ |
| Cloudflare Workers AI data usage | Workers AI privacy/data-usage docs: https://developers.cloudflare.com/workers-ai/platform/privacy/ |
| Cloudflare AI Gateway logs | AI Gateway logging docs: https://developers.cloudflare.com/ai-gateway/observability/logging/ |
| Stripe privacy | Stripe Privacy Policy: https://stripe.com/privacy |
| Stripe security/privacy docs | Stripe security documentation: https://docs.stripe.com/security/stripe |
| Resend privacy/DPA | Resend Privacy Policy and DPA: https://resend.com/legal/privacy-policy and https://resend.com/legal/dpa |
| GitHub privacy | GitHub General Privacy Statement: https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement |

## 4. Data Inventory

| Data category | Source | Purpose | Code/storage | Visibility | Third party/provider | Privacy implication |
| --- | --- | --- | --- | --- | --- | --- |
| Public browsing request metadata | Browser/network request | Deliver static/API pages, security, routing | GitHub Pages/static, Cloudflare edge, Worker observability logs where applicable | Operator/provider-visible | GitHub, Cloudflare | Do not promise no logs or EU-only processing. Repo does not prove provider retention windows. |
| Contact form data | User-submitted name, email, subject, message, honeypot | Reply to inquiries, spam control | `workers/contact/src/index.js`; no D1 contact-message table found | Contact mailbox/operator, Resend | Cloudflare Worker, Resend | Code sends message content and email metadata to Resend; mailbox retention is outside repo. |
| Account data | Registration/login | Account, authentication, member features | `users` in D1; normalized email, password hash, role/status/timestamps | Private/admin-visible | Cloudflare D1/Workers; Resend for verification | Passwords are hashed; emails are used for account and notifications. |
| Email verification/reset tokens | Registration/reset flows | Verify email and reset password | D1 token tables store hashes; raw token only in email link | Private/operator security | Resend for email delivery | Token links expire after 60 minutes and are single-use by code. |
| Session cookies and session rows | Login/session use | Keep users signed in and authorize API calls | `__Host-bitbi_session`/legacy cookie; D1 `sessions` stores token hash and expiry/last seen | Private/auth system | Cloudflare Worker/D1 | 30-day session expiry; logout deletes row and clears cookie. |
| Admin MFA cookies/credentials | Admin login/MFA | Protect admin tools | D1 MFA tables and admin MFA cookie | Admin-only/private | Cloudflare Worker/D1 | Secret material must not be exported or described in public detail. |
| Profile data | User profile edits/avatar uploads | Display profile/publisher identity | D1 `profiles`, R2 `PRIVATE_MEDIA` avatars | Private unless publication avatar/display name exposed | Cloudflare R2/D1/Images | Display name/avatar may become public with published media. |
| Wallet data | SIWE link/login | Link Ethereum wallet and sign in | D1 `linked_wallets`, `siwe_challenges`; browser wallet localStorage | Private/account/admin summaries | Browser wallet provider, Ethereum network/explorers if user interacts | Wallet addresses are personal data; private keys are not handled by Bitbi code. |
| Favorites | Member favorite/unfavorite | Personal saved preferences | D1 `favorites`, UI filters retired Sound Lab items | Private/member profile | Cloudflare D1 | Stores item ids/titles/thumb URLs; old retired items are filtered. |
| AI prompts/settings/uploads | User/admin generation requests | Generate text/images/videos/music and previews | Auth Worker, AI Worker, `ai_generation_log`, `ai_video_jobs`, `ai_usage_attempts`, R2 temp objects where applicable | User/admin/provider-visible | Cloudflare Workers AI/AI Gateway, model providers, Vidu fallback, MiniMax, PixVerse, Black Forest Labs models via Cloudflare | Inputs may include personal data and are sent to model/infrastructure providers as needed. |
| Generated media and saved assets | AI outputs and user save actions | Asset library, playback, download, publish | D1 `ai_images`, `ai_text_assets`, `ai_video_jobs`; R2 `USER_IMAGES`; derivative queues | Private by default; public if published | Cloudflare R2/Images/Workers AI/model providers | Publication intentionally exposes media and selected metadata publicly. |
| Folders/assets manager | User creates/manages folders/assets | Organize saved media | D1 `ai_folders`, asset rows, R2 references | Private/member | Cloudflare D1/R2 | Folder names and metadata can contain user-provided text. |
| Public Mempics/Memvids/Memtracks | User toggles publication | Public gallery playback/browsing | Public gallery routes select `visibility='public'` rows | Public to anyone | Cloudflare R2/Worker cache, site visitors | Published file URLs, titles/captions, display name/avatar become public. |
| Credits and usage | Generation/billing actions | Quotas, charge credits, prevent double charge | D1 `member_credit_ledger`, `member_usage_events`, `member_credit_buckets`, `member_credit_bucket_events`, org `credit_ledger`, `usage_events`, `ai_usage_attempts` | Private/admin/billing | Cloudflare D1, Stripe for purchases | Billing/usage records may need legal retention; not fully integrated into lifecycle export/delete. |
| Stripe checkout/webhook/subscription metadata | Credit purchases and BITBI Pro subscription scaffolding | Payment processing, credit grants, subscription state, reconciliation evidence | `billing_checkout_sessions`, `billing_member_checkout_sessions`, `billing_member_subscriptions`, `billing_member_subscription_checkout_sessions`, `billing_provider_events`, `billing_event_actions` | Account/org/admin billing | Stripe | Code stores Stripe ids/status/pack/subscription metadata and sanitized summaries, not full card numbers. Phase 2.1 records selected failure/refund/dispute/expired-checkout events for operator review only; Phase 2.2 adds bounded admin resolution metadata only. Automated refund/dispute/chargeback/reconciliation operations are not proven complete. |
| Asset storage quota | Asset upload/save activity | Enforce member storage limits | D1 `user_asset_storage_usage`, asset metadata and R2 object references | Private/member/admin | Cloudflare D1/R2 | Quota summaries are derived account data and are not yet integrated into lifecycle export/delete planning. |
| Organization membership | Org creation/memberships | Org/team/account credit foundation | D1 `organizations`, `organization_memberships` | Private/org/admin | Cloudflare D1 | Export/delete treatment is not fully implemented in lifecycle planning. |
| User/admin activity logs | Auth/profile/admin/billing/security actions | Security, audit, support, abuse prevention | D1 `user_activity_log`, `admin_audit_log`, `activity_search_index`; archived to R2 | Admin/operator | Cloudflare Queues/D1/R2 | Hot retention/archiving exists; legal retention policy still needs owner review. |
| Data lifecycle/export records | Admin/support lifecycle process | Export/deletion/anonymization planning | D1 `data_lifecycle_*`, `data_export_archives`; R2 `AUDIT_ARCHIVE` | Admin/support | Cloudflare R2/D1 | Export exists as admin workflow; irreversible hard deletion is not enabled by default. |
| Rate-limit/security state | Requests/IP/user ids/route keys | Abuse prevention and fail-closed controls | Durable Objects, D1 `rate_limit_counters`, logs | Operator | Cloudflare Durable Objects/D1 | Keys may contain IP-derived or route identifiers. |

## 5. Third-Party and Provider Table

| Provider | Current use in code/config | Data that may be processed | Notes/uncertainties |
| --- | --- | --- | --- |
| Cloudflare | Workers, D1, R2, Queues, Durable Objects, Workers AI, AI Gateway, Images, CDN/DNS/security, logs | Requests, IP/user-agent/header metadata, account/media/billing records, AI inputs/outputs, R2 objects, logs | Public text should not claim EU-only processing. Workers AI docs say customer content is not used to train Workers AI models without explicit consent, but model-specific third-party terms should still be reviewed. AI Gateway logs may include prompts/responses if enabled. |
| GitHub Pages / GitHub | Static site hosting/deploy pipeline | Static page request metadata and repository/deploy data | Repo does not prove GitHub Pages log retention for visitors. |
| Resend | Verification/reset/contact email API | Recipient email, email metadata, email contents, contact form messages | Contact message retention in mailbox/Resend is outside repo. |
| Stripe | One-time live/test credit-pack checkout, BITBI Pro subscription checkout scaffolding, and webhooks | Checkout/customer/session/subscription/payment intent ids, transaction data, contact/payment details entered at Stripe | Bitbi code does not store full card details; Stripe is an independent payment processor/controller/processor depending on context. Refunds/chargebacks/tax/invoice/reconciliation policy needs review. |
| Cloudflare Workers AI / model vendors | Text/image/embedding/live-agent/image cover generation | Prompts, images, audio/video inputs/outputs, embeddings/settings | Vendors from model registry include Meta, Google, OpenAI OSS, BAAI, Black Forest Labs; code mainly calls through Cloudflare binding. |
| PixVerse | Member/admin video model through Workers AI/AI Gateway | Video prompts, negative prompts, optional image data, settings, generated video URLs/outputs | Provider terms/retention not proven by repo. |
| MiniMax | Music 2.6 through AI Worker service binding and gateway | Music prompts/style, lyrics, settings, generated audio/metadata | Provider terms/retention not proven by repo. |
| Vidu | Admin video fallback/direct provider API if configured | Video prompts/images/settings, provider task ids, generated video/poster URLs | Fallback depends on `VIDU_API_KEY`; terms/retention not proven by repo. |
| Browser wallet providers / Ethereum services | Wallet connection and SIWE signatures | Wallet address, chain id, signature request, balance/gas reads through provider | User-selected provider controls its own processing. Bitbi does not receive private keys. |
| X/Twitter/social links | External outbound links only | Data only if user clicks external links | No embedded social tracking found in code. |

## 6. Browser Storage, Cookies, and Device Access

| Key/cookie | Type | Source file | Purpose | Retention/lifetime |
| --- | --- | --- | --- | --- |
| `__Host-bitbi_session` | HttpOnly cookie | `workers/auth/src/lib/cookies.js` | Authenticated session on HTTPS live site | 30 days server/client max age; logout clears |
| `bitbi_session` | HttpOnly cookie | `workers/auth/src/lib/cookies.js` | Legacy/non-HTTPS fallback | Same as session cookie |
| `__Host-bitbi_admin_mfa` / `bitbi_admin_mfa` | HttpOnly cookie | `workers/auth/src/lib/cookies.js` | Admin MFA proof | Configured by admin MFA flow |
| `bitbi_cookie_consent` | localStorage | `js/shared/cookie-consent.js` | Cookie/preferences banner categories | Until changed or browser storage cleared |
| `bitbi_audio_state_v1` | localStorage | `js/shared/audio/audio-manager.js` | Restore global music player state across hard navigation | Until cleared/track closed/browser storage cleared |
| `bitbi.activeOrganizationId` | localStorage | `js/shared/active-organization.js` | Remember selected organization | Until changed/invalid/cleared |
| `bitbi_wallet_connector_type`, `bitbi_wallet_connector_id`, `bitbi_wallet_address`, `bitbi_wallet_chain_id`, `bitbi_wallet_updated_at` | localStorage | `js/shared/wallet/wallet-config.js` and controller | Restore wallet UI/provider selection | Cleared on disconnect/stale selection/browser clear |
| `bitbi_admin_ai_lab_state_v1` | localStorage | `js/pages/admin/ai-lab.js` | Persist admin AI Lab form/UI state | Admin browser only; until cleared/overwritten |
| `bitbi:pending-home-category` | sessionStorage | `index.html`, `js/shared/site-header.js`, `js/pages/index/category-carousel.js` | Homepage category navigation/deck state | Session only/removed after use |
| `bitbi_home_scroll_restore_v2` | sessionStorage | `index.html` | Restore homepage scroll on reload | Session only |
| Optional analytics/marketing consent categories | localStorage preference only unless integrations exist | `js/shared/cookie-consent.js` | Consent state and RUM blocking | No active YouTube embed or RUM loader was found outside legacy/legal/docs; banner still exposes categories |

TDDDG implication: necessary cookies/storage are used for login, security,
state restoration, selected organization/wallet UI, and consent preference.
Optional analytics/marketing storage or scripts require consent if enabled.

## 7. Public Sharing and Publication

| Feature | What becomes public | Code evidence | Private boundary |
| --- | --- | --- | --- |
| Mempics | Published image derivatives/original public file endpoint, title/caption/publisher display name/avatar where set | `routes/gallery.js`, `ai_images.visibility` | Only `visibility='public'` rows are listed/served publicly |
| Memvids | Published video file/poster/title/caption/publisher identity | `routes/video-gallery.js`, `ai_text_assets.source_module='video'` | Public routes check visibility and source module |
| Memtracks | Published audio file/poster/title/caption/publisher identity | `routes/audio-gallery.js`, `ai_text_assets.source_module='music'` | Public routes check visibility and source module |
| Favorites/profile surfaces | User favorites and profile pages can render saved item metadata | `routes/favorites.js`, profile UI | Auth required; retired bundled Sound Lab items are filtered |
| Avatar/display name | Published media may expose display name/avatar if set | public gallery/video/audio avatar routes | Avatar endpoints require the related asset to be public |

## 8. Billing and Stripe

| Flow | Data processed | Storage | Controls |
| --- | --- | --- | --- |
| Live credit pack checkout | User/org id, pack id, credits, EUR amount, Stripe checkout session/customer/payment intent ids, checkout URL/status | `billing_checkout_sessions`, `credit_ledger`, `usage_events` | Auth, org owner/platform admin checks, same-origin, idempotency |
| Stripe live/test webhooks | Raw body is verified, then sanitized event summary/hash/action state is stored | `billing_provider_events`, `billing_event_actions` | Signature verification, rate limiting, no raw body/signature/card data stored |
| Member AI charges | Feature, model, credits, idempotency/attempt metadata | `member_credit_ledger`, `member_usage_events`, `member_ai_usage_attempts` | Server-side pricing, balance checks, member image/music/video gateway idempotency and parent reservation before provider work, charge after successful persistence, Phase 3.7 replay-unavailable/no-double-debit and cleanup hardening for image/music, and Phase 3.8 member video replay/no-double-debit behavior |
| Organization/admin AI charges | Org id, actor, feature/model/credit amount, attempt/ledger rows | `credit_ledger`, `usage_events`, `ai_usage_attempts` | Idempotency and reservation/finalization helpers |

Public wording should say Stripe handles checkout/payment details and Bitbi stores
only the metadata needed to reconcile purchases and credits, based on the code.
Do not promise Stripe tax/invoice/refund automation; those are open product/legal
items.

## 9. AI Provider and Data Transfer Table

| Feature | User input sent | Output stored | Provider path |
| --- | --- | --- | --- |
| Member image generation | Prompt, model/settings, optional org context | Temporary R2 object, saved image row/R2, derivatives | Cloudflare Workers AI model binding; Black Forest Labs models for configured image models |
| Member text generation | Prompt/system/settings when org-scoped text is used | Response/replay metadata where enabled | Cloudflare Workers AI text models through auth/AI worker patterns |
| Member music generation | Style prompt, optional lyrics, mode/settings; optional separate lyrics generation | MP3/audio bytes in R2, asset row, generated cover thumbnail, safe member attempt/replay metadata without raw prompt or lyrics, safe cover status metadata | Auth Worker -> AI service binding -> Workers AI/AI Gateway `minimax/music-2.6`; cover uses `@cf/black-forest-labs/flux-1-schnell`; Phase 3.7 replay responses omit raw prompt/lyrics and missing replay does not re-run providers or double debit |
| Member PixVerse/HappyHorse video generation | Prompt, optional negative prompt, optional data URI image, duration/aspect/quality/audio/seed | Video bytes/poster in R2, asset row, safe member attempt/replay metadata without raw prompt or internal R2 key leakage | Auth Worker -> Workers AI `pixverse/v6` / HappyHorse T2V with AI Gateway; Phase 3.8 requires member gateway idempotency/reservation before provider work and returns replay-unavailable without re-running providers or double debiting |
| Admin AI Lab | Admin prompts/settings/images/audio/video jobs | Admin-visible result metadata and optionally saved assets/jobs | AI Worker internal service routes with service-auth. Phase 4.8/4.8.1 admin text/embeddings add safe `platform_admin_lab_budget`, caller-policy metadata, and metadata-only durable idempotency rows; Phase 4.9 extends that metadata-only pattern to Admin Music, Phase 4.10 extends it to Admin Compare, and Phase 4.12 extends it to Admin Live-Agent stream sessions. Phase 4.13 retires sync video debug from normal provider-cost operations as disabled-by-default/emergency-only; the async admin video job flow remains the supported budgeted admin video path. Phase 4.14 classifies Admin Image branches: charged priced models keep selected-organization credit attempts, FLUX.2 Dev emits sanitized `explicit_unmetered_admin` metadata only, and unknown/unclassified image models block before AI Worker/provider execution. Phase 4.15 enforces Cloudflare master runtime budget switches before covered admin/platform provider work. Phase 4.15.1 adds D1 app-level switch state and exposes only safe master/app/effective status; missing app rows default disabled and the Admin UI cannot mutate Cloudflare variables. Phase 4.16 adds read-only live cap readiness evidence and a future cap data-model design. Phase 4.17 implements the first `platform_admin_lab_budget` cap foundation for selected admin lab routes with safe limit and usage-event rows only; other scopes remain future work. Live-Agent replay remains metadata-only with no raw message/output persistence. Those rows and metadata must not store raw prompts, raw embedding inputs, raw lyrics, raw compare prompts, raw Live-Agent messages/output, generated text, embedding vectors, audio, compare outputs, provider request bodies, provider response bodies, auth headers, cookies, Stripe data, Cloudflare tokens, private keys, private R2 keys, runtime flag values, or cap override secret values. |

Cloudflare's Workers AI documentation says Customer Content includes inputs,
outputs, embeddings, and training data, and that Cloudflare does not use Workers
AI Customer Content to train models or improve services without explicit
consent. That statement does not by itself prove retention/training behavior for
every third-party model/provider path, especially provider fallback/API paths.

## 10. Account, Session, and Security Data

| Data | Purpose | Controls visible in code | Retention/deletion observed |
| --- | --- | --- | --- |
| Password hash | Login | PBKDF2-SHA-256 with salt/pepper-style server secret; no plain password storage | Until account deletion/anonymization process |
| Session token hash | Auth | Random token, server-side hash, HttpOnly/SameSite cookie | 30-day expiry; logout deletes; scheduled cleanup |
| Verification/reset token hash | Email verification/reset | Random raw token emailed, hash in D1, single-use | 60 minutes; used/expired cleanup |
| Rate-limit keys/IP-derived data | Abuse prevention | Durable Object/D1 rate limiters, fail-closed on sensitive routes | D1 counters expire; DO state operational |
| Admin audit/user activity | Security/support/audit | Queues, redacted search index, admin-only reads | 90-day hot window then archive to R2; exact archive retention policy open |
| Admin MFA secrets/recovery codes | Admin security | Admin-only enrollment/use; secret material excluded from exports | Retained while enrolled; deletion/revocation policy needs admin continuity review |

## 11. Retention, Deletion, and Export

| Flow | Current behavior | Privacy wording implication |
| --- | --- | --- |
| Sessions | 30-day expiry, logout deletion, scheduled cleanup | Can state session lifetime and logout behavior. |
| Reset/verification tokens | 60-minute email links, used/expired cleanup | Can state short-lived/single-use token behavior. |
| SIWE challenges | 10-minute expiry, scheduled cleanup | Can state short-lived wallet auth challenge behavior. |
| Activity/audit logs | Hot logs archived after 90 days into `AUDIT_ARCHIVE`; archival retention beyond that needs policy | Do not promise complete immediate deletion of logs. |
| Export archives | Admin-generated JSON archive manifests, 14-day expiry, R2 cleanup for `data-exports/` objects | Can state export support is currently an admin/support process. |
| User assets/media | Stored until user deletes assets or account/lifecycle handling proceeds | Do not promise automatic deletion unless code proves it. |
| Data deletion/anonymization | Planning/admin approval exists; irreversible hard delete is disabled by default in lifecycle executor | Public text should say requests can be made and will be handled subject to legal/technical obligations; do not promise immediate deletion. |
| Billing records | Ledger/checkout/webhook records retained for reconciliation/audit; no defined purge | Legal retention policy required before strong deletion promises. |
| Contact messages | Sent via Resend/mailbox; no repo-owned storage | Retention requires mailbox/provider review. |

## 12. Admin, Audit, and Logging

Admin routes are protected by `requireAdmin` and admin MFA where applicable.
Admin surfaces can inspect users, orgs, billing event summaries, lifecycle
requests, AI usage attempts, video diagnostics, and activity logs. The code uses
sanitizers/redaction for billing events, export archives, AI usage attempts, and
activity search projections. Logs and activity rows can include IP addresses,
email addresses, user ids, target ids, action names, timestamps, and sanitized
metadata; secrets and raw payment payloads are intentionally excluded in the
reviewed paths.

## 13. Current Privacy-Page Gaps

- The pages did not describe AI generation inputs/outputs or provider routing.
- They did not describe saved assets, folders, public publication, Mempics,
  Memvids, or Memtracks.
- They stated account data is not shared with other third parties, which is too
  broad given Cloudflare, Resend, Stripe, AI providers, and publication paths.
- They did not describe Stripe live credit packs, checkout sessions, webhooks,
  member/org credit ledgers, or billing metadata.
- They included hard Cloudflare/GitHub log-retention claims not proven by repo.
- They described YouTube embeds and Cloudflare RUM as active features; current
  code only shows consent controls/defensive RUM blocking, with no active
  YouTube embed or RUM loader found outside legacy/legal/docs.
- They promised account deletion "without undue delay" and "all associated
  data" deletion more strongly than current lifecycle code supports.
- They did not describe wallet/SIWE, profile avatars, favorites, export
  archives, audit/activity archiving, admin lifecycle handling, or localStorage
  keys such as audio/wallet/org state.
- German and English versions were substantively incomplete for the current app.

## 14. Recommended Wording Strategy

- Use category-level provider wording in public text instead of exact secret or
  R2 key details.
- Say "may be processed" where a provider path depends on the selected model or
  feature.
- Distinguish private saved assets from assets intentionally published to public
  galleries.
- State that full card details are handled by Stripe, while Bitbi stores
  checkout/payment-status metadata for credit grants.
- State that export/deletion requests can be made and are handled according to
  applicable law and technical/legal obligations; avoid exact deletion promises
  where lifecycle hard delete is not enabled.
- Do not claim EU-only processing. Use international-transfer language and note
  provider safeguards such as DPF/SCCs only at a high level.
- Treat cookies/localStorage/sessionStorage under TDDDG as device storage, with
  necessary storage separated from optional analytics/marketing choices.
- Avoid public disclosure of route names, bucket keys, secrets, internal
  signature schemes, or admin-control implementation details.

## 15. Owner/Lawyer Review Items

1. Confirm exact controller/legal identity, VAT/business registration needs, and
   whether the imprint alone is sufficient as a controller reference.
2. Confirm legal bases for each processing group, especially AI generation,
   publication, billing retention, wallet/SIWE, and security/audit retention.
3. Review Cloudflare, Stripe, Resend, GitHub, PixVerse, MiniMax, Vidu, and model
   vendor DPA/subprocessor/third-country transfer terms for the live account.
4. Decide whether AI Gateway logs are enabled in production and what retention
   setting applies; docs state logs can include prompts/responses by default.
5. Confirm provider retention/training terms for every selected model path,
   including direct Vidu fallback and MiniMax/PixVerse provider behavior.
6. Define contact mailbox/Resend retention and deletion workflow.
7. Define billing, ledger, checkout, webhook, refund, chargeback, invoice, and
   tax-record retention policy.
8. Define irreversible account/media deletion policy and whether lifecycle
   hard-delete executor will be enabled after legal/product review.
9. Decide whether local cookie banner text should keep analytics/marketing
   categories while no active optional integrations are currently found.
10. Review AI Act transparency obligations as product scope evolves; this report
    treats the AI Act as context only and does not classify the service.
11. Confirm whether self-service data export/deletion is planned or if requests
    remain manual/admin-supported.
12. Confirm treatment of organization and billing data in data export/deletion
    planning; current lifecycle coverage is incomplete for newer billing/org
    tables.

## 16. Assumptions Made

- The live deployment uses the Cloudflare Worker bindings and routes declared in
  `workers/*/wrangler.jsonc`.
- Public member media routes expose only records where the corresponding
  `visibility` field is public, as implemented in current route code.
- Stripe checkout currently uses hosted Stripe pages; the repository does not
  collect or store full card numbers.
- Resend is the email provider for verification/reset/contact based on code.
- The cookie banner can represent optional categories, but no active YouTube
  iframe or Cloudflare RUM injection was found in current runtime code outside
  legacy documentation/legal copy.
- This audit did not verify live Cloudflare dashboard settings, provider
  account DPA acceptance, AI Gateway log settings, or production retention
  configuration outside the repository.
