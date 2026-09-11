# Static hosting migration — local preparation, 11 September 2026

**Not activated.** `config/static-hosting.json` still selects `github-pages`.
Read-only deployment resolution identified main and the published Pages SHA
`d6b53c85f433c94b3c41a641a92e4dd859d2cde4`, deployment `6364415557`.
This is the bootstrap receipt, not a permanent baseline. Refresh it against the
last actual Pages publication immediately before an approved cutover.
Auth migration 0086 and the existing backend activation are unaffected.
No backend, registration, Stripe, mail, tracing, storage or queue change is included.

## Package and serving contract

`build:static` produces the allowlisted `_site`. Candidate recording copies those
bytes into `candidate/site` and adds a separate `candidate/frontend` entry/config.
Only `site` is an ASSETS directory. Source, tests, evidence and configuration are
not public assets; `_worker.js` is deliberately excluded. GitHub Pages did not
execute its Geo redirect, and moving hosts must not silently activate it.

`frontend/index.mjs` supplies explicit directory-index handling and document-level
www-to-apex canonicalization, preserving query strings. `.html` URLs stay valid;
missing files return real 404s, with no SPA fallback. `/account/` has no index and
remains unavailable; actual `/account/profile.html` is served. The frontend's
`/api` and `/api/*` return a JSON 404. On production the existing more-specific
`bitbi.ai/api/*` Auth route must remain intact and takes precedence over the
frontend Custom Domain. No API proxy or cookie/domain change is introduced.

`main` alone is insufficient: the explicit `run_worker_first` pattern invokes
this small entry for document/unknown/API paths. `/assets/*`, `/css/*`, `/js/*`
and `/fonts/*` are asset-first; www resource requests can therefore remain on
www, while document links canonicalize to apex. There is no country/language
redirect. Existing browser language selection remains unchanged. Existing
account/admin HTML is public code, not authorization; protected data still needs
the existing server checks. No private records are embedded in the package.

The existing Contact tooling lock supplies **Wrangler 4.129.0**; installation uses
`npm --prefix workers/contact ci`. The adapter checks both installed version and
lock resolution, preserving existing sharp/undici/ws overrides. No Contact
Worker is built or deployed by this use. Node remains 22.x / npm 10 or later per
the existing contract; local preparation used Node 22.23.1 / npm 10.9.8.
Compatibility date is 2026-09-03, supported by this pinned local runtime.

Wrangler receives `no_bundle: true` and no imports, remote bindings or routes.
A temporary config outside the immutable package changes only absolute paths;
Wrangler's generated `.wrangler` cache cannot contaminate the package. Preview
additionally changes only worker name to `bitbi-frontend-preview` and enables
workers.dev. Assets and entry bytes remain identical; Cloudflare version IDs
for different workers/configurations are not assumed equal.

## Existing CI, provenance and write ownership

`static.yml` remains the normal build-once owner. Native local Wrangler dry-run
and routing checks run before artifact upload. Existing selected Linux Worker,
Chromium and native macOS WebKit jobs consume the same candidate. The hosting
migration selects full acceptance; this is not a Fast UI change. Full regression
also runs the native frontend check via `--standalone`, which is test-only.

The legacy Fast UI workflow is manual-only while Pages is active. It resolves
the complete published range and refuses a retired Pages target. Both actual
publication paths use concurrency group `pages`. A branch or `validation_only`
dispatch cannot deploy. No Cloudflare Git auto-build/deploy should be enabled.

Before publication, existing source SHA/run/attempt, required executed jobs,
case reports, artifact digest/expiry, supersession and dependency guards remain
mandatory. Production uses the tested asset/entry package without rebuilding.
Cloudflare deployment additionally verifies the current version at 100%, its
package annotation, account, worker and both domain mappings. The success receipt
records source and publication runs separately. GitHub's successful environment
job, its durable GitHub deployment payload (`task=bitbi-static-receipt`), and
independent Cloudflare API reads establish the new baseline. The 90-day ZIP is
diagnostic evidence; its expiry does not expire an existing durable production
receipt. Candidate ZIP expiry still prevents a new upload/reuse. Missing or
changed durable records or their authorizing job metadata fail closed. A mutable JSON file or an upload response alone does
not. Missing/expired evidence, wrong active version or API errors stop resolution.
There is no silent fallback to Pages after a recorded Cloudflare success.

Old workflow revisions cannot acquire new code retrospectively. Before cutover,
finish/cancel old Pages jobs and prevent new legacy Pages writes through the
existing environment protection. **The shared lock alone is not a retirement
fence for already queued pre-migration workflow revisions.** Preserve the old
site for rollback, but deny its deployment jobs after switching authority.

## Required access — not provisioned by this preparation

The read-only GitHub environment inspection found only `github-pages`, protected
by a custom branch policy; no Cloudflare production environment was configured.
Do not claim reviewers or Cloudflare secrets already exist. The owner must create
`cloudflare-static-production`, restrict it to protected `main`, and configure
required reviewer protection if supported by this repository/account plan.
Until that is confirmed, do not give its job a write token.

- Separate CI deployment token: account **Workers Scripts Write/Edit** for the
  chosen BITBI account, as required by Wrangler Worker/asset upload/deployment.
  Cloudflare does **not** restrict that permission to one Worker name; its wider
  account Worker reach is a material limitation. No D1/R2/KV/AI/Stripe permissions.
- Baseline reader: separate **Workers Scripts Read** token for that account.
  Store as `CF_FRONTEND_READ_TOKEN` where the trusted validation job can read it;
  `CF_FRONTEND_DEPLOY_TOKEN` only in the protected production environment.
  Store the account ID as `CF_FRONTEND_ACCOUNT_ID` variable.
- Cutover operator token: Workers Scripts Write for Custom Domain endpoints and
  **DNS Write limited to zone bitbi.ai** for the exact DNS records removed or
  restored. Zone Read is needed for identification if the ID is not supplied.
  No account-wide DNS permission and no unrelated zone changes.
- GitHub validation uses only contents/actions/deployments read, with
  `persist-credentials: false` on every checkout. Branch and validation-only
  jobs do not inherit publication permissions. The transitional
  publication job retains Pages write and OIDC permissions for the old Pages
  action; the protected publication/recovery jobs additionally use Deployments
  Write to record durable platform metadata. Recovery has no Pages/OIDC rights.
  Cloudflare itself uses only its explicit environment token. No
  `pull_request_target` or secrets with untrusted PR checkout.

Do not copy or upgrade Supers' observer tokens or use the operations Mac. The
owner enters secrets directly in GitHub/Cloudflare's protected UI (or an existing
hidden-input local channel). Never put tokens in commands, tracked files or logs.

## Next external phase — separate authorization required

All commands below are a **future operator procedure, not commands executed in
this phase**. Use the developer's authorized repository access. The first scope
is branch publication and CI, not production cutover:

The current branch is **uncommitted**. First review the explicit file list in
`LOCAL_PREPARATION.json` against `git status` and the current diff. In the later
approved phase, stage only those reviewed paths (never `git add .`), including
new files, then inspect the staged diff and use the active budget hook:

```sh
# Only in the later authorized phase: verify each reviewed file, then stage
# exactly that manifest list. Refuse an existing staged delta or changed bytes.
python3 - <<'PYFILES'
import pathlib,json,hashlib,subprocess
m=json.load(open('/Users/bitbi/Bitbi-hosting-prep-20260911/LOCAL_PREPARATION.json'))
assert subprocess.run(['git','diff','--cached','--quiet']).returncode==0
for name,digest in m['changedFiles'].items():
    assert hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()==digest,name
subprocess.run(['git','add','--',*sorted(m['changedFiles'])],check=True)
PYFILES
git diff --cached --check
git diff --cached --stat
git commit -m "Prepare verified Workers Static Assets hosting"
git rev-parse HEAD HEAD^{tree}
export GITHUB_REPOSITORY=bitbiai/Bitbi
export GITHUB_SHA="$(git rev-parse HEAD)"
# Existing read-only GH_TOKEN is supplied privately, never printed.
BASE_EVIDENCE="$(mktemp)"
GITHUB_OUTPUT="$BASE_EVIDENCE" node scripts/pages-candidate.mjs baseline
export CANDIDATE_BASE="$(sed -n 's/^base=//p' "$BASE_EVIDENCE")"
# Retain the output as the complete unpublished-range evidence.
node scripts/select-ci-tests.mjs --base "$CANDIDATE_BASE" --head "$(git rev-parse HEAD)"
git push origin HEAD:refs/heads/prep/workers-static-assets
git ls-remote origin refs/heads/prep/workers-static-assets
# Compare the returned SHA with the recorded commit before dispatch:
gh workflow run static.yml --repo bitbiai/Bitbi --ref prep/workers-static-assets \
  -f validation_only=true
```

Do not merge main, queue duplicate workflows, or treat committing as this phase's
authorization. The owner records the resulting run ID and exact attempt, then
uses `gh api repos/bitbiai/Bitbi/actions/runs/<run-id>` (id, head_sha,
head_branch, event, run_attempt, status, conclusion)
to identify the completed branch validation. A workflow_dispatch file must exist
on the default branch for GitHub to expose the workflow; static.yml already does.
The branch revision must contain these new source/permission guards. A successful
local check cannot provision environment protection or authorize an upload.

The concrete read-only preview source/download/preparation sequence, from a
clean checkout of the tested SHA, is:

```sh
export GITHUB_REPOSITORY=bitbiai/Bitbi
export GITHUB_SHA=<exact-reviewed-and-tested-commit>
export CANDIDATE_BASE=<last-verified-publication-or-explicit-wider-base>
export CANDIDATE_BRANCH=prep/workers-static-assets
export CANDIDATE_RUN=<completed-branch-run-id>
export CANDIDATE_ATTEMPT=<exact-attempt>
# Existing developer read-only GH_TOKEN must be provided privately; do not print it.
node scripts/frontend-release.mjs preview-source
node scripts/frontend-release.mjs preview-config
# Only after separate preview-publication approval and private scoped CF credentials:
FRONTEND_EXTERNAL_PHASE=APPROVED_PREVIEW node scripts/frontend-release.mjs preview-upload
```

`preview-source` refuses an existing candidate directory, reads own-repository
Actions metadata and current branch identity, verifies the computed complete
selection and actual required job steps, then downloads exact digest/expiry-
checked ZIPs. Extraction rejects symlinks, path escapes, duplicate/oversized files.
Preparation and upload compare the **entire** local candidate with those freshly
verified archives and check the complete site tree, source checkout, proofs and
branch identity again. A local self-consistent proof is never CI authorization.
Only explicit workflow_dispatch is accepted for a non-main preview branch.
Production source validation remains main-only (`production-source` /
`production-config`); preview provenance cannot authorize staging, production
or a production baseline. No raw Wrangler upload is an alternative to these
commands. If preparation and upload are separated, the upload command repeats
the complete guard before invoking Wrangler.

When the later authorized main/hosting-policy revision changes the package or
asset token, its own accepted package must be previewed; do not combine different
builds' evidence. Main publication/reuse stays in the existing protected workflow.

The workers.dev preview is externally public static code/content, with no
production routes, bindings, authentication API or production cookie context.
Noindex is not access protection. First approve that exposure or provide a
separately authorized Access boundary. Use synthetic mocked APIs for preview
UI checks. Integrated login preview needs separately scoped test backend/origin
resources and is not supplied or authorized here; never proxy production APIs.

## Cutover and abort procedure — separately authorized later

Prerequisites: successful matching CI and preview, immutable package identity,
main unchanged, scoped access/environment protections, known initial and recovery
versions, active-zone/certificate check, and no queued legacy writers. Take a
timestamped read-only snapshot of **only** apex/www A/AAAA/CNAME, the existing
Auth API route, frontend domains, current Pages deployment and active frontend
version. Retain each DNS ID, value, TTL and proxy flag. The reported initial
hosting has four GitHub A targets and a www CNAME; re-read before acting.

1. Freeze only publication jobs through their existing protection/lock; do not
   place the application/backend in maintenance. Keep Pages origin available.
   Set the reviewed hosting policy to Cloudflare only in the approved cutover
   revision, pinning the freshly verified last Pages receipt. Accept that exact
   main candidate with `validation_only=true`; do not rebuild it for cutover.
2. For the **first** frontend worker, stage the verified candidate without domains
   and with workers.dev disabled using its prepared production config and
   `node scripts/frontend-release.mjs production-config`, followed by
   `FRONTEND_EXTERNAL_PHASE=APPROVED_UNROUTED_STAGING node scripts/frontend-release.mjs stage-upload`.
   Use `production-source` first with the explicit completed main run/SHA/attempt.
   The staging upload repeats GitHub, archive, complete-tree and proof checks;
   raw Wrangler/config invocation is not the staging procedure.
   This creates the separate, initially unrouted worker. Read its version and
   deployment back; it is not yet a production hosting receipt. Subsequent
   releases use only the gated normal CI adapter. This initial staging also
   requires explicit external authorization and the completed candidate proof.
3. Read planned DNS/domain changes before mutation. Remove only conflicting
   apex/www hosting records as required; in particular the existing www CNAME
   cannot coexist with a Workers Custom Domain. Attach each via documented
   `PUT /accounts/{account}/workers/domains` with body
   `{hostname,service:"bitbi-frontend",environment:"production",zone_id}`.
   Cloudflare manages corresponding DNS and certificates. Record returned IDs
   and read each result before continuing. Preserve `bitbi.ai/api/*`, contact,
   mail, pay/Stripe and media records and all backend bindings.
4. Use the existing main candidate reuse dispatch once with the exact accepted
   run/attempt and truthful dependency acknowledgement. The `deploy` adapter
   publishes/reads the same package, confirms both domains and 100% active
   version, and records independent GitHub/Cloudflare provenance. Initial
   staging and routed release may have different version IDs; bytes must match.
5. Bound initial certificate/routing acceptance to **15 minutes** from the first
   domain change, with operator checks at defined milestones, not arbitrary
   sleeps pretending to drain anything. Abort earlier for wrong API routing,
   wrong bytes, unexpected DNS changes, unavailable HTTPS, missing access or an
   unknown mutation outcome. An unknown write is read back before any retry.
   This is a proposed cutover bound, not a promised certificate issuance time.
6. Read-only live acceptance: exact Worker version/deployment and artifact tag;
   apex/www HTTPS, EN/DE and query redirects, true404, versioned JS/CSS/media;
   `/api/me` must be an API response (normally unauthorized without a session),
   never HTML. Existing owner session may test login/admin reads; absence of
   that session is a missing live check, not permission to bypass protection.
   Registration remains off. No payments, generations, deletes or event replay.

Initial partial-failure recovery is modeled by `cutoverRecovery`: remove only
Custom Domain IDs created in this attempt (reverse order), then restore only
removed snapshot hosting DNS records. Use
`DELETE /accounts/{account}/workers/domains/{domain-id}` and
`POST /zones/{zone}/dns_records` with the exact saved DNS values; read back each
mutation. Verify Pages origin, apex/www HTTPS and the unchanged API route. Do
not delete the new Worker as an attempted undo of an uncertain write. Return
hosting authority to the verified Pages receipt through the approved protected
change; do not allow an old queued job to make that decision.

Once Pages is intentionally unavailable, recovery uses a known **durable
publication receipt**, not a raw version ID or an expired candidate archive.
The protected `recover-frontend` job in the same static workflow shares the
`pages` write lock. It verifies the original successful main/environment job,
version/package annotation and explicit current deployment, activates that
existing version without uploading assets, reads back its new activation and
records a new durable rollback receipt. The restored SHA can be older than the
authorizing main revision; both identities are stored separately.

```sh
# Future separately approved recovery only; read the IDs first, do not guess:
gh api 'repos/bitbiai/Bitbi/deployments?environment=cloudflare-static-production&task=bitbi-static-receipt&per_page=20'
gh workflow run static.yml --repo bitbiai/Bitbi --ref main \
  -f frontend_recovery_receipt=<original-known-publication-receipt-id> \
  -f frontend_expected_deployment=<freshly-read-current-cloudflare-deployment-id>
```

This performs no Worker upload, migration or backend operation. A -> B ->
authorized recovery A yields a new deployment receipt for A, and subsequent
release planning starts at A. An unrecorded rollback, foreign job, missing
protected authorization or wrong version still blocks. Unknown write outcomes
are read back before retry; never manufacture the success metadata manually.

Durable receipts use existing GitHub Deployments payloads/statuses (no service
or database) and bind to the protected workflow's separate automatic environment
deployment. Creating these metadata records does not invoke a deployment-event
workflow in this repository. The required-contexts array is empty only for the
**metadata record**, after existing candidate and environment gates ran; it is
not a replacement for those gates. The authorizing job and its successful
operation/receipt steps must be independently readable before the record is
accepted as a baseline. Active Cloudflare deployment/version/domain checks remain
mandatory. Diagnostic ZIP expiration after 90 days is harmless for such an
existing verified receipt; expired candidate archives are never uploadable.
Deletion of durable records, authorizing Actions metadata or Cloudflare versions
is a different event and remains a concrete blocker requiring separately reviewed
evidence recovery, not fallback to arbitrary Pages/green CI. Keep those records
when retiring old logs; no infinite platform-retention guarantee is claimed.

Only after successful Cloudflare live acceptance and explicit retirement approval:
disable Pages publication/settings, verify old hosting records and paths are no
longer active, retain repository/CI and the Cloudflare recovery version. Do not
assume the old Pages target remains a usable recovery path afterwards.

## Validation and limits

`npm run test:frontend-hosting -- --unit` exercises provenance/activation,
missing/partial/wrong targets, upload failure, supersession and partial DNS
recovery without mutations. The normal command additionally uses actual pinned
Wrangler/workerd with synthetic HOME, no remote bindings and the existing
loopback-only OS isolation; it checks dry-run, EN/DE/indexes, API/404, exact asset
bytes, MIME/HEAD/ETag and www canonicalization. `test:static-deploy-safety` runs
existing candidate/selection/report-lifecycle and real workflow-condition
counterchecks, including branch/validation-only denial. `check:js` includes the
new entry/adapter. Full CI still owns the Linux and native macOS acceptance;
local Node mocks are not cloud deployment or certificate evidence.

Primary contracts consulted: [Static Assets](https://developers.cloudflare.com/workers/static-assets/),
[worker-first routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/),
[HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/),
[GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/),
[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/),
[versions/deployments](https://developers.cloudflare.com/workers/versions-and-deployments/),
[Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/),
[API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/).

Review follow-up: `npm run test:frontend-hosting -- --unit` includes actual CLI/ZIP/Git fixture controls and effective permissions for every job, plus A/B/recovery and durable-expiry fixtures. Raw per-case outcomes are written to `test-results/frontend-review.json`. Synthetic Git commits are confined to disposable fixtures; the preparation branch remains uncommitted.

Long-lived metadata APIs: [GitHub deployment payloads](https://docs.github.com/en/rest/deployments/deployments#create-a-deployment) and [statuses](https://docs.github.com/en/rest/deployments/statuses#create-a-deployment-status). Their API result is checked; a mutable JSON file alone never authorizes a baseline.

The actual forthcoming Linux frontend entry is already wired into
`static.yml/release-compatibility`: root `npm ci`, pinned
`npm --prefix workers/contact ci`, `npm run build:static`,
`node scripts/pages-candidate.mjs record` with the job's exact SHA/base/run/attempt
and computed CANDIDATE_FULL, then `npm run test:frontend-hosting` before artifact
upload. Full regression invokes `npm run test:frontend-hosting -- --standalone`.
Existing selected native Worker isolation and Linux/macOS browser jobs remain
separate required evidence. This local macOS review does not attest that Linux run.
