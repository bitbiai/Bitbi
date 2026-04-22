# Cloudflare WAF Rate Limiting — Wave 1

## Purpose

Wave 1 adds a Cloudflare WAF rate limiting rule in front of the auth worker on `bitbi.ai`. It targets the sensitive POST endpoints most commonly attacked via credential stuffing, brute-force login, and account enumeration. The rule operates at the Cloudflare edge, blocking abusive traffic before it reaches the Worker.

## Why Cloudflare WAF instead of relying only on Worker code

The current repo now has worker-side rate limiting in two forms: shared durable fixed-window counters backed by D1 for abuse-sensitive endpoints, and a smaller set of legacy per-isolate in-memory counters. Those layers still execute only after the request reaches the Worker.

A Cloudflare WAF rate limiting rule counts requests globally at the edge, across all isolates, before any Worker invocation or D1 work. Wave 1 adds this outer layer without replacing the runtime limiters, so the current setup remains defense in depth: the WAF rule blocks high-rate abuse globally at the edge, and the Worker-side limiters handle application-specific cases behind it.

## Current repo state

### Auth worker (`workers/auth/`)

The auth worker now uses the shared limiter helpers in `workers/auth/src/lib/rate-limit.js` for the most abuse-sensitive routes. Those public counters are stored in worker-local Durable Objects and are shared across isolates without depending on D1. In production, the hardened public routes fail closed with a generic `503` if the `PUBLIC_RATE_LIMITER` binding is unavailable instead of falling back to isolate-local memory.

Some lower-risk auth paths still use pure in-memory limits (for example verify-email token checks, reset token validation/reset, avatar upload, and favorites add). Those remain isolate-local.

The auth worker is routed via `bitbi.ai/api/*` (defined in `workers/auth/wrangler.jsonc`).

Wave 1 itself did not add runtime code. Later repo work added the D1-backed shared limiter, but the dashboard WAF rule remains a separate outer layer and must stay in place.

### Contact worker (`workers/contact/`)

The contact worker now uses `workers/contact/src/lib/rate-limit.js` for shared fixed-window Durable Object counters on two scopes: a burst limit (`3` requests per `10` minutes per IP) and an hourly limit (`5` requests per hour per IP). In production, contact submission now fails closed with a generic `503` if the `PUBLIC_RATE_LIMITER` binding is unavailable.

The contact worker is routed via `contact.bitbi.ai` (defined in `workers/contact/wrangler.jsonc`).

Wave 1 does **not** add any Cloudflare WAF protection for `contact.bitbi.ai`. The contact worker therefore relies entirely on its Worker-side limiter stack for now. See [Current limitations](#current-limitations).

## Active production rule

| Field | Value |
|---|---|
| **Rule name** | `bitbi-auth-sensitive-posts-ip` |
| **Expression** | `(ssl and http.host eq "bitbi.ai" and http.request.method eq "POST" and http.request.uri.path in {"/api/login" "/api/register" "/api/forgot-password" "/api/reset-password" "/api/resend-verification"})` |
| **Counting characteristic** | IP address |
| **Threshold** | 5 requests |
| **Period** | 10 seconds |
| **Action** | Block |
| **Mitigation timeout (duration)** | 10 seconds |

This rule is configured in the Cloudflare dashboard under Security > WAF > Rate limiting rules. It is not defined in any repo file — it exists only in Cloudflare's configuration.

## Validation results

A manual curl test confirmed the rule is active and functioning:

| Request # | Endpoint | HTTP status | Meaning |
|---|---|---|---|
| 1–5 | `POST /api/login` | 401 | Requests reached the auth worker; worker responded with authentication failure (expected for invalid credentials) |
| 6 | `POST /api/login` | 429 | Cloudflare blocked the request at the edge before it reached the worker |

Cloudflare security analytics confirmed:
- **Action taken**: Block
- **Service**: Rate limiting rules

This proves:
1. The WAF rule expression correctly matches POST requests to `/api/login`.
2. The IP-based counter increments correctly and triggers at the 5-request threshold within the 10-second window.
3. Blocked requests return HTTP 429 from the Cloudflare edge, not from the Worker.
4. After the 10-second mitigation timeout expires, requests are allowed through again.

## Current limitations

- **Free plan rule capacity**: The Cloudflare Free plan allows exactly 1 rate limiting rule. That single slot is now occupied by `bitbi-auth-sensitive-posts-ip` (1/1 used). No additional WAF rate limiting rules can be created without upgrading the plan.
- **Minimum period**: The Free plan limits the rate limiting period to a minimum of 10 seconds. Longer windows (e.g., per-minute or per-hour) are not available at this tier.
- **contact.bitbi.ai not covered**: The contact form endpoint on `contact.bitbi.ai` is not protected by any Cloudflare WAF rate limiting rule. It relies solely on Worker-side rate limiting: Durable Object-backed fixed-window counters, and a production fail-closed `503` if that protection binding is unavailable.

## Rollback

Disabling or deleting the `bitbi-auth-sensitive-posts-ip` rule in the Cloudflare dashboard fully rolls back Wave 1. No repo code was changed for this step, so there is nothing to revert in the codebase. The auth worker's in-code rate limiting continues to operate independently regardless of whether the WAF rule is active.

## Future considerations (Wave 2)

A future Wave 2 could add Cloudflare WAF rate limiting coverage for `contact.bitbi.ai`. This requires either upgrading the Cloudflare plan to gain additional rule slots, or restructuring the single available rule's expression to cover both domains (if expression syntax permits). No code changes or implementation details are proposed here — this is noted only as a logical next step.

## File references

Files inspected for this documentation:

| File | Relevance |
|---|---|
| `workers/auth/src/lib/rate-limit.js` | Auth worker limiter helpers: Durable Object public counters + remaining D1-backed internal counters |
| `workers/auth/migrations/0015_add_rate_limit_counters.sql` | Remaining D1-backed limiter schema for lower-risk/internal auth routes |
| `workers/auth/wrangler.jsonc` | Auth worker routing: `bitbi.ai/api/*` |
| `workers/contact/src/lib/rate-limit.js` | Contact worker shared Durable Object limiter + production fail-closed enforcement |
| `workers/contact/wrangler.jsonc` | Contact worker routing: `contact.bitbi.ai` |
