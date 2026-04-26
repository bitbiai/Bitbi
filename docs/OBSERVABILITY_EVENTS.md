# Observability Events

This document defines the repo-owned event taxonomy for Worker logs and operational reviews. It is a taxonomy and safety contract, not proof that every Cloudflare dashboard alert already exists.

## Field Policy

Safe fields:

- `ts`
- `service`
- `component`
- `event`
- `level`
- `correlation_id`
- `request_method`
- `request_path`
- `status`
- `duration_ms`
- `job_id`
- `queue`
- `attempts`
- `provider`
- `model`
- `error_code`
- `failure_reason`

Forbidden fields:

- Session tokens, cookies, bearer tokens, API keys, HMAC secrets, signatures, nonces, MFA codes, recovery codes, raw passwords, provider credentials, full request bodies, full prompts when prompts may contain sensitive content, raw provider payloads, and stack traces in user-visible responses.

Identifiers:

- User/admin identifiers should be hashed, truncated, or replaced by internal IDs only when already safe by route policy.
- Correlation IDs must be syntactically safe and never derived from secret material.

## Event Families

| Family | Event examples | Severity | Safe fields | Alert use |
|---|---|---|---|---|
| Auth/session | `auth_login_failed`, `auth_register_failed`, config failure events | warn/error | route, status, correlation id, safe error code | Login failure spikes, auth 5xx rate |
| Admin/MFA | `admin_mfa_rate_limited`, `admin_mfa_verified`, `admin_mfa_locked` | info/warn/error | admin id if safe, method, lockout status, correlation id | MFA lockout spike, verification failures |
| Rate-limit/fail-closed | `shared_rate_limiter_blocked`, `shared_rate_limiter_fail_closed` | warn/error | limiter scope, route, status, production flag | Limiter outage, abuse spikes |
| Service auth/HMAC | service-auth failure codes | warn/error | route, status, correlation id, failure code | Internal auth failures, replay attempts |
| Async video jobs | `ai_video_job_created`, `ai_video_job_enqueued`, `ai_video_job_provider_task_created`, `ai_video_job_poll_scheduled`, `ai_video_job_succeeded`, `ai_video_job_failed` | info/warn/error | job id, provider, model, status, attempts, safe reason | Queue health, provider health, job duration |
| Queue consumers | `ai_video_job_consumer_retry`, `ai_derivative_consumer_failed`, `queue_batch_unrecognized` | warn/error | queue, batch size, attempts, job id if safe | Backlog, poison messages, consumer failures |
| R2/media ingest | ingest/fetch/delete failure events | warn/error | bucket binding name, safe object category, status, error code | Media delivery/ingest failures |
| Contact submit | `contact_submit_upstream_error` | warn/error | provider, upstream status, duration | Contact delivery outage |
| Security/config validation | `worker_config_invalid`, prereq validation output | error | missing config category only, no values | Deploy blocker, fail-closed state |
| Release/deploy checks | release preflight and prereq output | info/error | check id, status, missing resource names | Release readiness |
| Poison messages | `video_job_poison_message_recorded` | error | reason, queue, job id if parseable, redacted shape | Malformed producer/consumer contract |
| Health/readiness | health status and live-check script output | info/error | endpoint id, status, origin only | Uptime and drift checks |

## Correlation ID Behavior

- HTTP responses should include `x-bitbi-correlation-id` where existing Worker helpers support it.
- Queue messages should preserve the originating correlation id when the message schema supports it.
- Operators should use correlation ids to link HTTP requests, queue processing, provider calls, and job status transitions.

## Redaction Review Checklist

- Does the event include only the safe fields above?
- Does any error helper include `error_message` from an untrusted provider? If yes, sanitize or suppress it.
- Does any diagnostic include a prompt, body, token, code, secret, signature, nonce, or raw provider payload? If yes, remove it.
- Does the event have an owner and a runbook link in `docs/SLO_ALERT_BASELINE.md` or `docs/runbooks/`?
