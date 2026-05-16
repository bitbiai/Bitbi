# BITBI Production/Staging Evidence Pack

Evidence date:

Prepared by:

Environment: local / staging / canary / production

Branch:

Commit:

Default final verdict: **BLOCKED**

Allowed final verdict values: **BLOCKED**, **STAGING READY**, **CANARY READY**, **PRODUCTION READY**.

Do not paste secret values, raw webhook secrets/signatures, API keys, private keys, bearer tokens, session cookies, raw provider payloads, or unredacted customer data.

## 1. Repo Baseline

| Item | Evidence |
| --- | --- |
| `pwd` |  |
| `git branch --show-current` |  |
| `git rev-parse HEAD` |  |
| `git status --short` summary |  |
| `npm run readiness:evidence` output attached | yes / no |
| `npm run readiness:evidence -- --markdown` output attached | yes / no |
| Operator-run `--include-live` read-only HTTP evidence attached | yes / no / not applicable |
| Repo-local checks attached | yes / no |

## 2. Branch / Commit / Worktree

Record the exact branch, commit, and whether the worktree was clean. If dirty, summarize changed file categories without pasting secrets.

## 3. Migration Status Through Latest Auth Migration

Latest auth D1 migration required by release config: `0051_add_admin_ai_usage_attempts.sql`.

| Environment | Database | Evidence Through `0051` | Operator | Date | Result |
| --- | --- | --- | --- | --- | --- |
| staging | `bitbi-auth-db` |  |  |  | BLOCKED |
| production | `bitbi-auth-db` |  |  |  | BLOCKED |

Do not run remote migrations from this template. Record only operator-run migration status evidence.

## 4. Cloudflare Auth Worker Bindings

| Binding Type | Expected Name(s) | Staging Present? | Production Present? | Evidence Link/Note |
| --- | --- | --- | --- | --- |
| D1 | `DB` / `bitbi-auth-db` |  |  |  |
| R2 | `PRIVATE_MEDIA`, `USER_IMAGES`, `AUDIT_ARCHIVE` |  |  |  |
| Queues | `ACTIVITY_INGEST_QUEUE`, `AI_IMAGE_DERIVATIVES_QUEUE`, `AI_VIDEO_JOBS_QUEUE` |  |  |  |
| Durable Object | `PUBLIC_RATE_LIMITER` |  |  |  |
| AI / Images | `AI`, `IMAGES` |  |  |  |
| Service binding | `AI_LAB` |  |  |  |
| Cron | `0 3 * * *` |  |  |  |

## 5. Cloudflare AI Worker Bindings

| Binding Type | Expected Name(s) | Staging Present? | Production Present? | Evidence Link/Note |
| --- | --- | --- | --- | --- |
| AI | `AI` |  |  |  |
| Durable Object | `SERVICE_AUTH_REPLAY` |  |  |  |
| DO migration | `v1-service-auth-replay` |  |  |  |

## 6. Cloudflare Contact Worker Bindings

| Binding Type | Expected Name(s) | Staging Present? | Production Present? | Evidence Link/Note |
| --- | --- | --- | --- | --- |
| Durable Object | `PUBLIC_RATE_LIMITER` |  |  |  |
| DO migration | `v1-public-rate-limiter` |  |  |  |
| Route/custom domain | `contact.bitbi.ai` |  |  |  |

## 7. D1 / R2 / Queue / Durable Object / Service Binding Presence

Summarize read-only evidence that each expected Cloudflare resource exists in the target environment. Record names and status only.

| Resource | Staging Evidence | Production Evidence | Result |
| --- | --- | --- | --- |
| D1 database |  |  | BLOCKED |
| R2 buckets |  |  | BLOCKED |
| Queues |  |  | BLOCKED |
| Durable Objects |  |  | BLOCKED |
| Service bindings |  |  | BLOCKED |
| Worker routes |  |  | BLOCKED |

## 8. Required Secret Presence, Redacted

Record `present` / `missing` only. Never paste values.

| Secret Name | Staging | Production | Evidence Link/Note |
| --- | --- | --- | --- |
| `SESSION_SECRET` |  |  |  |
| `SESSION_HASH_SECRET` |  |  |  |
| `PAGINATION_SIGNING_SECRET` |  |  |  |
| `ADMIN_MFA_ENCRYPTION_KEY` |  |  |  |
| `ADMIN_MFA_PROOF_SECRET` |  |  |  |
| `ADMIN_MFA_RECOVERY_HASH_SECRET` |  |  |  |
| `AI_SAVE_REFERENCE_SIGNING_SECRET` |  |  |  |
| `RESEND_API_KEY` |  |  |  |
| `AI_SERVICE_AUTH_SECRET` |  |  |  |

## 9. Stripe Testmode Configuration Presence, Redacted

Record `present` / `missing` only. Never paste values.

| Name | Staging/Testmode Status | Evidence Link/Note |
| --- | --- | --- |
| `STRIPE_MODE` |  |  |
| `STRIPE_SECRET_KEY` |  |  |
| `STRIPE_WEBHOOK_SECRET` |  |  |
| `STRIPE_CHECKOUT_SUCCESS_URL` |  |  |
| `STRIPE_CHECKOUT_CANCEL_URL` |  |  |
| `ENABLE_ADMIN_STRIPE_TEST_CHECKOUT` |  |  |

## 10. Stripe Live Configuration Presence, Redacted

Record `present` / `missing` only. Never paste values.

| Name | Canary/Production Status | Evidence Link/Note |
| --- | --- | --- |
| `ENABLE_LIVE_STRIPE_CREDIT_PACKS` |  |  |
| `STRIPE_LIVE_SECRET_KEY` |  |  |
| `STRIPE_LIVE_WEBHOOK_SECRET` |  |  |
| `STRIPE_LIVE_CHECKOUT_SUCCESS_URL` |  |  |
| `STRIPE_LIVE_CHECKOUT_CANCEL_URL` |  |  |
| `ENABLE_LIVE_STRIPE_SUBSCRIPTIONS` |  |  |
| `STRIPE_LIVE_SUBSCRIPTION_PRICE_ID` |  |  |
| `STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL` |  |  |
| `STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL` |  |  |

## 11. Live Health Checks

Optional helper command for read-only HTTP evidence. This does not prove production readiness and does not perform credentialed Cloudflare/Stripe validation:

```bash
npm run readiness:evidence -- \
  --include-live \
  --static-url <staging-or-canary-static-url> \
  --auth-worker-url <staging-or-canary-auth-base-url> \
  --ai-worker-url <staging-or-canary-ai-base-url> \
  --contact-worker-url <staging-or-canary-contact-base-url> \
  --output docs/production-readiness/evidence/YYYY-MM-DD-<environment>-readiness.md
```

The helper runs only read-only GET requests against explicit URLs. It records status, final origin, selected safe headers, and public-safe health fields only. It strips query strings/fragments, does not send credentials, does not print env values, and does not dump page or JSON bodies.

| Check | URL/Environment | Operator | Date | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| Auth health |  |  |  | BLOCKED |  |
| Contact health/form non-mutating validation, if applicable |  |  |  | BLOCKED |  |
| Static site availability |  |  |  | BLOCKED |  |

## 12. Static Security Headers

| Header/Policy | Staging Result | Production Result | Evidence |
| --- | --- | --- | --- |
| HSTS |  |  |  |
| CSP or documented equivalent |  |  |  |
| X-Content-Type-Options |  |  |  |
| Referrer-Policy |  |  |  |
| Permissions-Policy |  |  |  |
| Cache behavior |  |  |  |

## 13. Admin Control Plane Smoke Evidence

| Smoke | Account/Role | Environment | Result | Evidence |
| --- | --- | --- | --- | --- |
| Admin MFA enforced |  |  | BLOCKED |  |
| Dashboard loads sanitized data |  |  | BLOCKED |  |
| Readiness panels do not expose secrets |  |  | BLOCKED |  |
| Billing/event panels redact payloads |  |  | BLOCKED |  |
| Billing review queue UI lists sanitized `needs_review` / `blocked` events |  |  | BLOCKED |  |
| Billing review detail UI shows safe identifiers and blocked warnings only |  |  | BLOCKED |  |
| Billing review resolve/dismiss UI requires note, confirmation, and `Idempotency-Key` |  |  | BLOCKED |  |
| Billing review UI has no Stripe/remediation/credit-clawback action buttons |  |  | BLOCKED |  |
| Data lifecycle panels render fail-closed/unavailable states |  |  | BLOCKED |  |

## 14. Pricing / Credits / Organization Smoke Evidence

| Smoke | Account/Role | Environment | Result | Evidence |
| --- | --- | --- | --- | --- |
| Pricing page copy and CTAs |  |  | BLOCKED |  |
| Account Credits dashboard |  |  | BLOCKED |  |
| Organization dashboard/context |  |  | BLOCKED |  |
| Active organization selection survives expected navigation |  |  | BLOCKED |  |
| Ineligible users are denied billing actions |  |  | BLOCKED |  |

## 15. Stripe Testmode Checkout / Webhook Smoke Evidence

| Smoke | Environment | Result | Evidence |
| --- | --- | --- | --- |
| Testmode checkout disabled by default |  | BLOCKED |  |
| Testmode checkout canary enabled intentionally |  | BLOCKED |  |
| Admin-created checkout succeeds |  | BLOCKED |  |
| Non-admin-created checkout does not grant credits |  | BLOCKED |  |
| Webhook signature verification rejects invalid signatures |  | BLOCKED |  |
| Duplicate webhook does not double grant |  | BLOCKED |  |
| Failed/unpaid/expired session does not grant credits |  | BLOCKED |  |
| Phase 2.1 failure/refund/dispute/expired events record review-only action metadata |  | BLOCKED |  |
| Phase 2.3 review queue UI lists `needs_review`, `blocked`, and `informational` events with sanitized metadata |  | BLOCKED |  |
| Phase 2.3 review detail UI shows safe identifiers/recommended action and no raw payload/signatures/secrets |  | BLOCKED |  |
| Phase 2.3 review resolution UI records `resolved`/`dismissed` metadata with `Idempotency-Key` and audit evidence |  | BLOCKED |  |
| Phase 2.3 review-only/resolution events do not call Stripe, reverse, claw back, or subtract credits automatically |  | BLOCKED |  |
| Phase 2.4 reconciliation report shows generated timestamp, local D1 source, and BLOCKED verdict |  | BLOCKED |  |
| Phase 2.4 reconciliation report lists critical/warning items from local billing events, checkouts, ledgers, subscriptions, and reviews only |  | BLOCKED |  |
| Phase 2.4 reconciliation UI has no Stripe, refund, credit reversal, clawback, cancellation, or remediation action buttons |  | BLOCKED |  |

## 16. Phase 2.1-2.4 Billing Review/Reconciliation Staging Evidence

Use `docs/production-readiness/PHASE2_BILLING_REVIEW_STAGING_CHECKLIST.md` for the full operator checklist. This section records staging evidence only. It does not authorize production deploy, live billing, Stripe remediation, credit clawback, subscription cancellation, or automatic reconciliation.

| Evidence Item | Staging Evidence | Result |
| --- | --- | --- |
| Auth Worker deployed commit |  | BLOCKED |
| Static deployed commit |  | BLOCKED |
| Release plan attached and expected deploy units are auth Worker plus static/pages |  | BLOCKED |
| Staging auth D1 migration evidence through `0051_add_admin_ai_usage_attempts.sql` |  | BLOCKED |
| Admin authentication and MFA prerequisites verified |  | BLOCKED |
| Billing Review Queue API smoke: admin-only list/filter with sanitized fields |  | BLOCKED |
| Billing Review Detail API smoke: safe identifiers, no raw payload/signature/secret/card data |  | BLOCKED |
| Billing Review Resolution API smoke: note, confirmation, `Idempotency-Key`, idempotent duplicate behavior |  | BLOCKED |
| Billing Review Resolution no-mutation evidence: credits, subscriptions, checkout state, and Stripe unchanged |  | BLOCKED |
| Billing Reconciliation API smoke: `source=local_d1_only`, blocked verdict, local sections, no forbidden fields |  | BLOCKED |
| Admin Control Plane Review Queue UI smoke |  | BLOCKED |
| Admin Control Plane Billing Reconciliation UI smoke |  | BLOCKED |
| Blocked/live-billing warning evidence visible in UI |  | BLOCKED |
| Read-only/no-Stripe/no-automatic-remediation copy visible in UI |  | BLOCKED |
| No raw payload, signature, secret, card, payment method, or unredacted customer data rendered |  | BLOCKED |
| Remaining staging blockers recorded |  | BLOCKED |

Phase 2.1-2.4 staging evidence may support a `STAGING EVIDENCE COLLECTED` operator note, but it must not be recorded as production readiness or live billing readiness.

## 17. Main-Only Release Evidence

Use `docs/production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md` and `docs/production-readiness/MAIN_ONLY_RELEASE_CHECKLIST.md` when the owner deploys directly from `main` without a separate staging environment. This is riskier than staging and requires strict evidence discipline. This section does not approve production readiness or live billing readiness.

| Evidence Item | Main/Live Evidence | Result |
| --- | --- | --- |
| Deployed commit SHA |  | BLOCKED |
| `npm run check:main-release-readiness` output attached |  | BLOCKED |
| Release plan output attached |  | BLOCKED |
| Auth Worker deploy evidence and deployed commit/version |  | BLOCKED |
| Static/pages deploy evidence and deployed commit/build |  | BLOCKED |
| Production D1 migration evidence through `0051_add_admin_ai_usage_attempts.sql` |  | BLOCKED |
| Live readiness evidence collector output with explicit URLs |  | BLOCKED |
| Manual admin login/MFA smoke evidence |  | BLOCKED |
| Manual billing review queue list/filter evidence |  | BLOCKED |
| Manual billing review detail evidence |  | BLOCKED |
| Manual billing review resolution evidence on approved test review data only |  | BLOCKED |
| Manual reconciliation report evidence with `source=local_d1_only` and blocked verdict |  | BLOCKED |
| No raw payload/signature/secret/card/payment method rendering evidence |  | BLOCKED |
| No Stripe API action evidence |  | BLOCKED |
| No credit mutation evidence |  | BLOCKED |
| Rollback target and owner recorded |  | BLOCKED |
| Operator verdict: `BLOCKED`, `MAIN DEPLOYED - EVIDENCE INCOMPLETE`, `MAIN DEPLOYED - OPERATOR VERIFIED`, or `ROLLBACK REQUIRED` |  | BLOCKED |
| Remaining blockers |  | BLOCKED |

Main-only release evidence does not prove external Stripe truth, does not enable live billing, does not prove refund/dispute/chargeback remediation, and does not prove legal/accounting readiness.

## 18. Phase 3.4 Member Image Gateway Pilot Evidence

Use `docs/production-readiness/PHASE3_MEMBER_IMAGE_GATEWAY_MAIN_CHECKLIST.md` for the full operator checklist. This section records evidence for the member personal image AI Cost Gateway pilot only. It does not prove that all AI cost routes are migrated.

| Evidence Item | Main/Live Evidence | Result |
| --- | --- | --- |
| Deployed commit SHA |  | BLOCKED |
| Release plan result: auth schema checkpoint `0048` plus auth Worker; static/pages not required for Phase 3.4 |  | BLOCKED |
| Remote migration `0048_add_member_ai_usage_attempts.sql` evidence |  | BLOCKED |
| Auth Worker deploy evidence and deployed commit/version |  | BLOCKED |
| Member personal image valid-key smoke evidence |  | BLOCKED |
| Missing `Idempotency-Key` rejection evidence before provider call |  | BLOCKED |
| Malformed `Idempotency-Key` rejection evidence before provider call |  | BLOCKED |
| Insufficient-credit pre-provider rejection evidence, if safely testable |  | BLOCKED |
| Provider-failure no-charge evidence, if safely testable with mocks/non-live controls only |  | BLOCKED |
| Duplicate same-key behavior evidence: no duplicate debit and replay/suppression when available |  | BLOCKED |
| Same-key different-request conflict evidence |  | BLOCKED |
| Org-scoped image behavior remains on existing org attempt path |  | BLOCKED |
| Admin legacy/no-org image behavior remains exempt as documented |  | BLOCKED |
| No raw prompt, secret, cookie, token, provider payload, or unsafe R2 key in evidence |  | BLOCKED |
| Operator verdict: `BLOCKED`, `MAIN DEPLOYED - EVIDENCE INCOMPLETE`, `MAIN DEPLOYED - OPERATOR VERIFIED`, or `ROLLBACK REQUIRED` |  | BLOCKED |

Phase 3.4 evidence does not prove full AI Cost Gateway coverage. Member music/video and later admin/platform coverage must still be verified separately. Phase 4.12 covers Admin Live-Agent only with metadata-only stream-session attempts, caller-policy propagation, and duplicate stream suppression. Phase 4.13 retires sync video debug from normal provider-cost operations as disabled-by-default/emergency-only; async admin video jobs remain the supported budgeted admin video path. Unmetered admin image, platform/background AI, broader internal AI Worker routes, runtime env kill-switch enforcement, live platform caps, and broader replay/provider-result cache work remain open. Live billing remains blocked.

## 18A. Admin Text/Embeddings Attempt Cleanup Evidence

This section records Phase 4.8.2 API-first operator evidence, Phase 4.9 Admin Music reuse, Phase 4.10 Admin Compare reuse of the same attempt table, Phase 4.12 Admin Live-Agent metadata-only stream-session reuse, and Phase 4.13 sync video debug disabled-by-default evidence. It does not approve sync video debug as a normal provider-cost path, unmetered admin image migration, public billing, provider calls, Stripe calls, live platform budget caps, or live billing.

| Evidence Item | Environment | Result | Evidence |
| --- | --- | --- | --- |
| Admin-only list endpoint `GET /api/admin/ai/admin-usage-attempts` denies non-admins |  | BLOCKED |  |
| Admin list/detail responses omit raw prompts, raw lyrics, raw embedding input, raw Live-Agent messages/output, generated text, embedding vectors, audio, provider request bodies, raw idempotency keys/hashes, request fingerprints, cookies, auth headers, Stripe data, Cloudflare tokens, private keys, and private R2 keys |  | BLOCKED |  |
| Admin Music and Admin Compare duplicate same-key and same-key/different-request conflict evidence shows no duplicate provider-cost work |  | BLOCKED |  |
| Admin Live-Agent duplicate same-key, same-key/different-request conflict, and observable stream finalization evidence shows no duplicate provider stream and no raw stream persistence |  | BLOCKED |  |
| Sync video debug route returns disabled-by-default response and does not call the AI Worker/provider unless an explicitly approved emergency `ALLOW_SYNC_VIDEO_DEBUG=true` window exists |  | BLOCKED |  |
| Cleanup dry-run endpoint returns bounded counts and mutates no rows |  | BLOCKED |  |
| Cleanup execution marks only expired pending/running rows and retains completed/succeeded/failed rows |  | BLOCKED |  |
| Scheduled cleanup logs count-only safe metadata and does not break unrelated scheduled tasks |  | BLOCKED |  |
| No provider calls, credit mutations, billing ledger mutations, R2 deletes, or destructive row deletes occurred |  | BLOCKED |  |

## 19. Live Credit-Pack Canary Evidence, If Intentionally Enabled

Leave this section BLOCKED unless an approved bounded live canary occurred.

| Canary Item | Result | Evidence |
| --- | --- | --- |
| Approval and rollback owner recorded | BLOCKED |  |
| `ENABLE_LIVE_STRIPE_CREDIT_PACKS=true` window recorded | BLOCKED |  |
| Live checkout created by eligible account only | BLOCKED |  |
| Live webhook signature verified | BLOCKED |  |
| Exactly-once live credit grant | BLOCKED |  |
| Role revocation/no-credit path | BLOCKED |  |
| Flag disabled after canary | BLOCKED |  |

## 20. BITBI Pro Subscription Evidence

| Smoke | Environment | Result | Evidence |
| --- | --- | --- | --- |
| Subscription checkout disabled by default |  | BLOCKED |  |
| Subscription checkout enabled only by approved flag |  | BLOCKED |  |
| Verified subscription checkout records subscription state |  | BLOCKED |  |
| Paid invoice tops up subscription bucket exactly once |  | BLOCKED |  |
| Cancel at period end works for signed-in owner |  | BLOCKED |  |
| Reactivate works for signed-in owner |  | BLOCKED |  |
| Failed payment does not grant credits |  | BLOCKED |  |
| Refund/dispute/chargeback behavior documented and tested as review queue/resolution metadata only |  | BLOCKED |  |
| Automated refund/dispute/chargeback credit remediation is intentionally absent or separately approved |  | BLOCKED |  |

## 21. Restore Drill Evidence

| Drill | Environment | Operator | Date | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| D1 backup/restore drill |  |  |  | BLOCKED |  |
| R2 recovery/owner-map drill |  |  |  | BLOCKED |  |
| Queue backlog/poison recovery drill |  |  |  | BLOCKED |  |
| Rollback rehearsal |  |  |  | BLOCKED |  |

## 22. Alert / WAF / Static Header / RUM Evidence

| Control | Environment | Result | Evidence |
| --- | --- | --- | --- |
| Auth Worker alerting |  | BLOCKED |  |
| AI Worker alerting |  | BLOCKED |  |
| Contact Worker alerting |  | BLOCKED |  |
| Queue backlog alerting |  | BLOCKED |  |
| WAF/rate-limit dashboard rules |  | BLOCKED |  |
| Static security transform rules |  | BLOCKED |  |
| Cloudflare RUM setting reviewed |  | BLOCKED |  |

## 23. Blockers

- Production Cloudflare live validation:
- Remote migration evidence through `0051_add_admin_ai_usage_attempts.sql`:
- Admin AI usage-attempt cleanup/inspection evidence:
- Phase 3.4 member personal image gateway main-only evidence:
- Stripe Testmode checkout/webhook evidence:
- Stripe live credit-pack/BITBI Pro canary evidence:
- Phase 2.1-2.4 billing review/reconciliation staging evidence:
- Main-only release evidence and operator verdict:
- Phase 2.3 review queue UI/resolution refund/dispute/chargeback/failed-payment/expired-checkout evidence:
- Phase 2.4 read-only local billing reconciliation report evidence:
- Automated billing remediation evidence:
- Restore drill evidence:
- Alert/WAF/static header/RUM evidence:
- Legal/product approval:

## 24. Final Verdict

Final verdict: **BLOCKED**

Rationale:

Read-only HTTP evidence alone is not sufficient to move the verdict above `BLOCKED`. Phase 2.3 review queue UI/resolution records, Phase 2.4 read-only reconciliation reports, Phase 2.5 staging evidence plans, Phase 2.6 main-only release evidence processes, Phase 4.8.2 admin usage-attempt cleanup/inspection, Phase 4.9 Admin Music metadata-only idempotency, Phase 4.10 Admin Compare metadata-only idempotency, Phase 4.12 Admin Live-Agent metadata-only stream-session idempotency, and Phase 4.13 sync video debug retirement classification are not live billing readiness, automated accounting reconciliation, automated remediation, or full AI budget enforcement. A human approver must verify migrations through `0051_add_admin_ai_usage_attempts.sql`, Cloudflare resources/secrets, Stripe Testmode/live billing lifecycle, member personal image gateway behavior, admin async video job budget metadata behavior, News Pulse visual budget metadata behavior, admin text/embeddings attempt cleanup/inspection behavior, Admin Music duplicate-suppression/conflict behavior, Admin Compare duplicate-suppression/conflict behavior, Admin Live-Agent duplicate-suppression/conflict/finalization behavior, sync video debug disabled-by-default behavior, restore drills, alerts, WAF/RUM/static headers, Admin Control Plane smoke, Pricing/Credits/Organization smoke, and legal/product gates before selecting any higher verdict.

Approver:

Date:
