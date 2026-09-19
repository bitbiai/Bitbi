# Canvas last-frame and Admin PixVerse extension

18 September 2026. Local implementation; no live provider acceptance or deployment receipt. Schema remains 0087. No new queue, Cron, workflow, model activation or AI Worker change.

## Surface and provider boundaries

Canvas offers only `last_frame`, including to administrators and when `PIXVERSE_API_KEY` exists. The existing role-aware catalog still controls model availability. A connected video automatically prepares this single supported input; a previously stored Extend choice normalizes to last-frame in the inspector without inference. Manipulated Extend patches, stored Extend runs and member direct-API payloads fail before job creation, provider upload or credit reservation. Loading a graph never starts paid generation.

The browser reads the owned private original, plays a temporary muted decoder to `ended` without seeking and exports its last decoded frame. Limits: 50 MB fetched bytes, 60-second source, 16 million pixels, finite 90-second preparation deadline. Native decoding is required; faulty/foreign input or cancellation stops preparation. Black frames are valid. PNG goes through the existing private image-save route, not graph JSON. Model, source asset/run and R2 ETag/size bind its reuse. Client pixels are not a cryptographic provenance attestation; server ownership and stored image identity remain enforced. Multiple video sources and competing image inputs are rejected.

The resulting `image_input` goes to the normal [Cloudflare PixVerse V6 adapter](https://developers.cloudflare.com/ai/models/pixverse/v6/), using existing member video pricing, durable jobs, storage and preview processing. No PixVerse secret is required. A browser is needed until frame preparation/save completes, not after durable generation acceptance. Server-derived run/job identity recovers the acceptance-to-Canvas checkpoint gap. Browser polling uses GET and attaches once with the original key. Editing context cannot silently overwrite a newer run; the owned asset remains available separately. Unresolved outcomes retain the original key and require review, never automatic regeneration.

## Admin-only native extension

Existing Admin AI Lab → Video AI → PixVerse V6 → Operation offers **Extend — direct PixVerse API**, separate from **Generate — Cloudflare**. It reuses the existing owned video picker, async `/api/admin/ai/video-jobs`, queue/lease/dispatch fence, platform-budget switches/caps, private output ingestion, recovery and Save to Folder flow. Role, secure session/MFA, CSRF and owner checks apply server-side. No client surface flag grants this path. No member credits are charged by an Admin video job; the existing platform budget estimate is retained. Direct provider billing is separate from Cloudflare and is not an asserted account balance or invoice.

`PIXVERSE_API_KEY` is an optional server-only Auth secret. The protected catalog exposes only whether it exists, with `private, no-store`; configured is not live account health. Without it, extension stays visible but paid execution is disabled/rejected; normal Cloudflare generation and Canvas remain available. Configure through the existing protected operator secret path only; no key, account purchase or live inference is requested by these tests.

The [direct V6 API](https://docs.platform.pixverse.ai/v6-2056814m0) receives exact owned MP4/MOV R2 bytes via `/openapi/v2/media/upload`, then `video_media_id` at `/video/extend/generate` (model v6, prompt, duration, quality, audio, optional negative prompt/seed). No BITBI ID is a provider ID, no fabricated Cloudflare operation, no aspect-ratio override. BITBI checks source ownership/version/type/50 MB; the provider upload gate enforces its 30-second/1920-pixel limits before paid submission. Source video is preserved; extension output is not concatenated or reinterpreted.

The existing job persists `video_id` and polls `/video/result/{id}` within its existing finite attempts. Matching successful output is ingested privately before success; known failure follows existing failure handling. Dispatch fencing precedes upload/submission. Lost acceptance without a stored task ID becomes the existing `provider_outcome=unknown` review state after lease expiry, not a second submission. Stable `Ai-trace-id` does not establish an unlimited exactly-once guarantee. The unpersisted upload-to-task-ID gap is conservatively held rather than retried. Existing protected recovery is available; live entitlements, actual output duration/audio and provider charges remain unverified.

## Executable evidence and release

- `playwright.config.js tests/canvas.spec.js --grep 'Canvas video continuation' --project=chromium --project=webkit-canvas --retries=0`: automatic old-choice normalization, member/admin contract, native VFR end-frame pixels, abort/error/foreign input, EN/DE, persisted preview/reload and one durable generation. Existing Canvas integration evidence remains separately dated.
- `playwright.config.js tests/auth-admin.spec.js --grep 'Admin PixVerse direct' --project=chromium --retries=0`: existing fixtures run both Chromium and WebKit via worker-scoped browser fixtures; configured/unconfigured UI, owned picker, keyboard submission, exact payload, protected job output and return to Cloudflare. Existing Grok operation neighbor remains covered.
- `playwright.workers.config.js tests/workers.spec.js --grep 'Canvas video continuation|Admin PixVerse extension' --retries=0`: real handlers and synthetic provider, role/MFA/CSRF/budget/source denials, upload bytes/schema, one Admin submission, pending/success/failure/unknown, private ingest and platform usage; Canvas image input, one credit debit, acceptance-gap recovery and ownership.
- `node scripts/test-q2-runtime.mjs --suite canvas`: same controls in the existing isolated native workerd/D1/R2/Images runner, including original Canvas cases. No remote bindings or real provider. macOS is not Linux CI/live acceptance.
- Existing selection/release tests map helper/fixture inputs, require Auth for the shared Canvas contract and retain unknown-path/full coverage. No new acceptance pipeline.

Deploy accepted Auth code before the matching frontend through existing protected paths. The current private-media service extension requires additive migration 0089 after 0088 before Auth; it does not require an AI Worker deployment. Publication remains bound to the current candidate and protected production review.

## Private posters and complete-chain export

Schema `0088_add_canvas_video_processing.sql` adds private postprocessing only.
All Canvas video starts use the existing durable member queue, including the
first clip. Queue completion attaches the owned result to its historical run;
a newer node run is never replaced. Readers refresh posters from the asset.
The existing scheduled catch-up queues at most 25 clearly associated historical
Canvas originals per pass. Existing posters and unknown provider jobs are kept.

Create full video follows immutable completed run inputs, not current edges.
Each predecessor's owned original/version is checked. Identical ordered sources
reuse one job and asset. Existing FFmpeg private mode handles concat then poster;
no inference or generation charge is made. Originals remain private and intact.
Compatible H.264/AAC clips use stream copy; other supported clips are letterboxed
and normalized with original audio or silence. Limits: 80 MB per original,
400 MB sources, 10 minutes, 80 MB output, 120 historical clips, one concat per
processor pass. Size/format failures are explicit; no shortened export is passed.

Migration precedes Auth, then the existing main processor and protected static
candidate. `release:apply -- --ci-verified-candidate` is restricted to the existing
protected deploy job and authentic candidate archives. It verifies current main,
existing bindings/secret names, the applied schema and sole active Auth version.
The existing CI credential must already support Auth publication and D1; missing
rights block before frontend publication, without widening any token. The
processor secret must match the existing repository secret; presence alone does
not prove a successful live processor pass. Environment owner review remains.
No arbitrary old Auth rollback is compatible with these durable jobs.

Checks: focused Canvas Worker cases and `test-q2-runtime.mjs --suite canvas`
share the actual fetch/queue/poster control. `test:homepage-ffmpeg-processor`
executes real 2/5-clip FFmpeg tests (order, sound/silence, duration, normalization).
`tests/canvas.spec.js` covers export/reload/poster in Chromium and webkit-canvas.
Live inference is not part of automated acceptance.

## Immediate private media services (0089)

`0089_add_private_media_services.sql` assigns each existing job to GitHub and
pins the chosen backend on new jobs. The existing video queue carries a wake
only after durable acceptance; the existing cron recovers lost sends/starts.
A fenced 20-minute start/runner lease deduplicates activation; job claims and
retry limits remain separate. Finish rechecks work arriving after the last
claim. Expired starts are recoverable, not proof of completion. Public Hero and
Memvid dispatch retain their previous path/cooldown.

Admin → Operations → Private media processing stores the choice with existing
Admin/MFA/CSRF/rate-limit/audit protections. `?lang=de#operations` on the canonical
`/admin` URL localizes this panel only. Old jobs and poster follow-ups stay with
their original service. No silent fallback. A service setting alone is not
readiness: Cloudflare requires the current version's private MP4/poster smoke.

The shared processor runs in `bitbi-private-media`: pinned Node 22/FFmpeg 5.1.9
Linux amd64 image, one standard-2 instance (1 vCPU, 6 GiB RAM, 12 GB disk), one
job per pass, at most eight passes/15 minutes per drain, 20-minute child bound,
30-second idle check/shutdown. Busy work renews activity; temporary files are
removed. D1/R2 remain authoritative across termination. The 30-second setting
is not a guaranteed wall-clock billing cutoff. Workers Paid/Containers access
is required and is not established by local Docker success.

Production uses only the existing protected `deploy` job and publication lock:
verified source run/attempt/archives → missing additive migration → digest-bound
CI image push/Container activation → Auth → private synthetic jobs on both
backends → frontend. Reuse exposes the same backend preflight and follows the
same order. Later attempts cannot relabel archive attempts or override failed
validation. Preflight schedules supported prerequisites; it does not authorize
static upload. Final guards require independent active-version/D1 readback.

The environment `cloudflare-static-production` needs a separate backend token
(`CF_BACKEND_DEPLOY_TOKEN`) for account Workers Scripts, D1 and Containers writes
and matching reads (including registry/application/version readback). Existing
Auth route verification also needs read access to the bitbi.ai zone/routes; no
new route or DNS authority is requested. Wrangler refuses conflicting routes. These
account permissions are **not** restricted to a single Worker by its name.
No DNS, AI inference, R2/KV management, billing-plan or zone write is requested.
Do not broaden the frontend token or copy local OAuth into CI. Preserve owner
review. Missing rights fail closed; provision the credential directly through
GitHub's protected secret UI, never in chat or source.

For first provisioning, current [Workers roles](https://developers.cloudflare.com/workers/authorization/workers/)
require **Workers product Admin** in the intended account to create the new
`bitbi-private-media` Worker; an Editor limited to existing Workers cannot do it.
After creation, Workers Editor can be scoped to `bitbi-auth` and
`bitbi-private-media`. The planned D1 migration/query and container registry/app
operations additionally need **D1 Edit/Write** and **Containers Edit/Write** in
that account, with readback; these are separate from Workers roles. See the
[API permission groups](https://developers.cloudflare.com/fundamentals/api/reference/permissions/).
Legacy Workers Scripts permissions are account-wide; do not infer a per-Worker
restriction from a name. Keep zone/Workers Routes reads limited to bitbi.ai.
Existing unchanged routes need no additional route-write grant. Actual access
must still be verified by the protected job; these requirements are not a claim
that the missing CI credential or paid Containers access has been provisioned.

The existing private GitHub processor secret derives a domain-separated
Cloudflare processor credential inside the protected job. Wrangler applies it
additively through a temporary mode-0600 secrets file, removed in finally.
The new service has no workers.dev/preview/public route. Public interfaces are
existing narrowly authenticated processor endpoints, never an open shell/URL
fetcher. The release smoke accepts only a fixed small fixture, current source
SHA and two backend names, with deterministic private jobs for a disabled
synthetic owner. It creates no AI invocation or credit debit; small synthetic
artifacts are retained as release evidence. The production setting is preserved.
Native tests verify actual Admin setting changes and restoration independently.

`node scripts/private-media-image.mjs` tests the exact image (two/five clips,
copy/normalization/audio, poster and real HTTP child abort/restart). Local dirty
images are explicitly marked and rejected for publication. CI archives are
bound to source files, SHA/run/attempt, image ID and archive digest; no rebuild
in the deployment job. `test:workers` also retains FFmpeg and isolated native
D1 tests. Source/activation/smoke counterchecks live in `test:release-plan` and
`test:static-deploy-safety`; Admin EN/DE Chromium/WebKit cases run via `test:auth`.

At published list rates, a continuously busy standard-2 instance is roughly
$0.129/hour before included allowances, network/DO/log charges; CPU use is
measured while memory/disk are provisioned. This is an estimate, not a bill cap.
Check current [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)
before activation. GitHub Actions remains a bounded compatibility adapter,
subject to runner/minute limits and [GitHub's additional terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions),
not an unlimited commercial compute service. No subscription change is automatic.
Rollback must retain 0089-compatible Auth, processor protocol and both job
backends; switching the setting affects future jobs only. Do not deploy an old
Worker that ignores immutable backend assignments.
