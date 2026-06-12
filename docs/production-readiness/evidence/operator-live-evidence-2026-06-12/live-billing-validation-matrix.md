# Live Billing Validation Matrix

Date prepared: 2026-06-12

Branch: `main`

Audited HEAD before this packet: `43d9f4c72b788fd64916e6136be65d70149a4676`

This matrix is local validation evidence only. It does not prove production readiness, live billing readiness, Stripe live completion, deploy completion, or tax/legal/accounting readiness.

## Local Validation Results

| Area | Command | Result | Evidence |
| --- | --- | --- | --- |
| Toolchain | `npm run check:toolchain` | PASS | Toolchain consistency guard passed. |
| JavaScript | `npm run check:js` | PASS | Syntax guard passed for 60 targeted files. |
| DOM security | `npm run check:dom-sinks` | PASS | DOM sink baseline guard passed. |
| Worker body parsing | `npm run check:worker-body-parsers` | PASS | Worker body parser guard passed. |
| Secrets | `npm run check:secrets` | PASS | Secret leakage guard passed. |
| Docs tests | `npm run test:doc-currentness` | PASS | Doc currentness tests passed. |
| Docs inventory | `npm run check:doc-currentness` | PASS | Runbook classified; inventory passed. |
| Route policy | `npm run check:route-policies` | PASS | 262 registered route policies passed. |
| Release compatibility tests | `npm run test:release-compat` | PASS | Release compatibility tests passed. |
| Release compatibility validation | `npm run validate:release` | PASS | Release compatibility validation passed. |
| Release plan | `npm run release:plan` | PASS | Before packet creation, working tree had no changed files and no runtime deploy steps. |
| Release preflight | `npm run release:preflight` | PASS | Local preflight passed; live/manual Cloudflare evidence remains a production deploy blocker. |
| Readiness evidence | `npm run test:readiness-evidence` | PASS | Readiness evidence tests passed. |
| Billing canary evidence | `npm run billing:canary-evidence` | PASS | Local-only blocked skeleton generated; no Stripe calls or mutations. |
| Static build | `npm run build:static` | PASS | Static site built successfully. |
| Worker tests | `npm run test:workers` | PASS | 695 tests passed. |
| Static tests | `npm run test:static` | PASS | 372 tests passed. |

## Live Billing Source Review

| Check | Result |
| --- | --- |
| `/admin/#live-billing` route exists and is wired through Admin nav/router/control-plane. | PASS |
| `GET /api/admin/billing/live-readiness/status` is admin-only, GET-only, rate-limited, redacted, bounded, read-only, and does not call Stripe. | PASS |
| `POST /api/account/billing/portal` is authenticated member-only, same-origin protected by route policy, idempotency protected, rate-limited, live-mode constrained, portal-origin validated, and requires existing member Stripe customer/subscription context. | PASS |
| Live webhook verification uses raw body text and the Stripe signature header before JSON parse, with `verified_live_signature`. | PASS |
| Live checkout creation requires live env gates, live webhook secret readiness, legal acceptance, idempotency, live key shape, and HTTPS URLs before session creation. | PASS |
| Optional automatic tax, tax ID collection, and invoice creation are disabled unless exactly `true` and are reflected only as redacted evidence/config state. | PASS |
| Admin status/evidence output redacts secrets and does not render raw provider payloads, signatures, cards, cookies, tokens, sessions, or raw customer IDs. | PASS |
| Route policy and release compatibility include the portal, live-readiness, live webhook, and live env flags. | PASS |
| `LIVE_BILLING_RUNBOOK.md` is classified by doc-currentness and listed in `docs/audits/README.md`. | PASS |

## Remaining Operator-Owned Evidence

- Cloudflare live secret/var configuration evidence.
- Stripe Dashboard webhook/Price/Portal configuration evidence.
- Auth Worker deploy evidence if live billing Worker changes are not already deployed.
- Static Pages deploy evidence if Admin/Credits UI changes are not already deployed.
- Live credit-pack canary evidence.
- Live subscription canary evidence.
- Verified webhook receipt evidence.
- Duplicate webhook idempotency evidence.
- Wrong Price ID rejection evidence.
- No-credit-before-webhook evidence.
- Paid invoice subscription top-up evidence.
- Refund, dispute, failed invoice, and action-required review-only evidence.
- Sanitized Admin Live Billing export after configuration.
