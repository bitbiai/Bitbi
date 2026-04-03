# Cloudflare WAF Rate Limiting — Wave 1

## Purpose

Wave 1 adds a Cloudflare WAF rate limiting rule in front of the auth worker on `bitbi.ai`. It targets the sensitive POST endpoints most commonly attacked via credential stuffing, brute-force login, and account enumeration. The rule operates at the Cloudflare edge, blocking abusive traffic before it reaches the Worker.

## Why Cloudflare WAF instead of replacing Worker code

The auth worker already has per-isolate, in-memory rate limiting (see [Current repo state](#current-repo-state)). That in-code layer has a structural limitation: Cloudflare Workers run across many isolates, and each isolate maintains its own independent counter. An attacker's requests may be spread across isolates, so no single isolate sees the full request volume. The in-code limiter is therefore best-effort.

A Cloudflare WAF rate limiting rule counts requests globally at the edge, across all isolates. Wave 1 adds this outer layer without touching any runtime code, so the existing in-code rate limiting remains as a second defense layer. This avoids regression risk and provides defense in depth: the WAF rule catches high-rate abuse globally, and the per-isolate limiter catches anything that slips through or falls outside the WAF rule's scope.

## Current repo state

### Auth worker (`workers/auth/`)

The auth worker has per-isolate, in-memory rate limiting implemented in `workers/auth/src/lib/rate-limit.js`. It uses a sliding-window algorithm backed by a `Map` that lives in Worker memory. Limits are applied per route inside the route handlers (e.g., login: 10 requests per 15 minutes per IP + per email, register: 5 per hour per IP + 3 per hour per email). These counters reset when an isolate is recycled or when requests land on a different isolate.

The auth worker is routed via `bitbi.ai/api/*` (defined in `workers/auth/wrangler.jsonc`).

No runtime code was changed for Wave 1. The in-code rate limiting remains active and must stay in place.

### Contact worker (`workers/contact/`)

The contact worker has its own independent per-isolate, in-memory rate limiter defined inline in `workers/contact/src/index.js`. It enforces 5 submissions per hour per IP using a fixed-window counter. The same per-isolate limitations apply.

The contact worker is routed via `contact.bitbi.ai` (defined in `workers/contact/wrangler.jsonc`).

Wave 1 does **not** add any Cloudflare WAF protection for `contact.bitbi.ai`. The contact worker relies solely on its in-code rate limiting for now. See [Current limitations](#current-limitations).

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
- **contact.bitbi.ai not covered**: The contact form endpoint on `contact.bitbi.ai` is not protected by any Cloudflare WAF rate limiting rule. It relies solely on its in-code per-isolate rate limiter (`workers/contact/src/index.js`, 5 requests per hour per IP).

## Rollback

Disabling or deleting the `bitbi-auth-sensitive-posts-ip` rule in the Cloudflare dashboard fully rolls back Wave 1. No repo code was changed for this step, so there is nothing to revert in the codebase. The auth worker's in-code rate limiting continues to operate independently regardless of whether the WAF rule is active.

## Future considerations (Wave 2)

A future Wave 2 could add Cloudflare WAF rate limiting coverage for `contact.bitbi.ai`. This requires either upgrading the Cloudflare plan to gain additional rule slots, or restructuring the single available rule's expression to cover both domains (if expression syntax permits). No code changes or implementation details are proposed here — this is noted only as a logical next step.

## File references

Files inspected for this documentation:

| File | Relevance |
|---|---|
| `workers/auth/src/lib/rate-limit.js` | Auth worker's per-isolate sliding-window rate limiter (in-code, unchanged) |
| `workers/auth/wrangler.jsonc` | Auth worker routing: `bitbi.ai/api/*` |
| `workers/contact/src/index.js` | Contact worker's inline per-isolate rate limiter (in-code, unchanged) |
| `workers/contact/wrangler.jsonc` | Contact worker routing: `contact.bitbi.ai` |
