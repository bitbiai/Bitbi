# SLO and Alert Baseline

This baseline defines candidate service-level objectives and alerts. It does not claim Cloudflare alerts are already configured. Any dashboard-managed alert must be live-verified before production readiness is claimed.

| Signal | Source | Suggested threshold | Severity | Owner/action | Runbook | Measurable now |
|---|---|---:|---|---|---|---|
| Auth API availability | Auth Worker request logs and `GET /api/health` | 99.9% 2xx/3xx over 30 days | critical | API owner investigates auth Worker, D1, secrets | `docs/runbooks/auth-worker-incident.md` | Partial |
| Login/register p95 latency | Auth Worker logs | p95 under 750 ms excluding upstream email | warning | Check D1 latency and rate-limit DO | `docs/runbooks/auth-worker-incident.md` | Partial |
| Admin API availability | Auth Worker admin route logs | 99.9% over 30 days | critical | Verify admin auth, MFA, D1 | `docs/runbooks/auth-worker-incident.md` | Partial |
| AI job create latency | Auth Worker async video create logs | p95 under 1 s | warning | Check D1 insert and queue send | `docs/runbooks/async-video-jobs-incident.md` | Partial |
| AI video completion duration | `ai_video_jobs` lifecycle and logs | p95 under agreed product target | warning/critical | Check provider, queue backlog, R2 ingest | `docs/runbooks/async-video-jobs-incident.md` | Partial |
| Queue oldest pending job age | Cloudflare queue dashboard | warning at 5 min, critical at 15 min | warning/critical | Inspect queue consumer and provider health | `docs/runbooks/queue-backlog-incident.md` | Dashboard/manual |
| Queue retry/exhaustion rate | Queue logs and D1 job status | warning above baseline, critical on sustained exhaustion | warning/critical | Inspect poison messages and provider errors | `docs/runbooks/queue-backlog-incident.md` | Partial |
| Auth-to-AI service-auth failures | AI Worker service-auth logs | any spike above baseline | warning/critical | Check secret mismatch, nonce DO, deploy versions | `docs/runbooks/cloudflare-secret-mismatch.md` | Partial |
| Contact success/error rate | Contact Worker logs | 5xx above 1% for 5 min | warning | Check Resend, rate limiter, origin policy | `docs/runbooks/contact-worker-incident.md` | Partial |
| D1 error rate | Worker logs and Cloudflare metrics | 5xx/D1 errors above baseline | critical | Check D1 availability, migrations, query hot spots | `docs/runbooks/d1-incident.md` | Partial |
| R2 ingest failure rate | Auth Worker media/video logs | any sustained failure | warning/critical | Check bucket binding, provider download, object policy | `docs/runbooks/r2-media-incident.md` | Partial |
| 429 rate by route group | Rate-limit logs | route-specific spike | info/warning | Distinguish abuse from false positives | relevant route runbook | Partial |
| 413 body-limit rejection rate | Request parser logs/status metrics | sustained spike | info/warning | Check abuse, client regression, payload limits | `docs/runbooks/auth-worker-incident.md` | Partial |
| 5xx rate by Worker | Cloudflare Worker metrics | 1% for 5 min or any critical route spike | critical | Run service-specific incident checklist | service runbook | Dashboard/manual |
| MFA lockout spike | Admin MFA logs/D1 failed-attempt state | more than expected admin baseline | critical | Check attack, user lockout, recovery path | `docs/runbooks/admin-mfa-lockout.md` | Partial |
| Config fail-closed alert | Worker config failure logs | any production event | critical | Verify secrets/bindings and rollback | `docs/runbooks/cloudflare-secret-mismatch.md` | Partial |

## Current Gaps

- Cloudflare alert resources are not defined in repo-controlled IaC.
- Queue backlog and oldest-message-age signals require dashboard or Cloudflare API review.
- Load/performance SLOs are candidates only until a synthetic/load baseline exists.
- Restore drill SLOs are candidates until a staging drill is executed.
