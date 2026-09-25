# Repair regression register

Required callers below apply to their selected impact scope; the bounded `admin-reader-v1` policy does not require unrelated decorative media. Keep one row per cause family. A discovered test is not an executed test; a replay is not native acceptance. Link matching final inputs and reports in the private release handoff. The budget hook is deliberately not a complete functional gate.

| Signature / first retained evidence | Cause and correction | Executable regression / countercontrol | Actual caller and required CI selection | Evidence and boundary |
| --- | --- | --- | --- | --- |
| Q3 `ai-lab.js`: 369,320 bytes against 365,000 at `6b833541` | Cohesive Compare extraction; preserve all ten existing budgets. Pre-push validates outgoing Git blobs, not dirty working files. | `scripts/test-quality-gates.mjs`, `scripts/test-pre-push.mjs`: oversized push blocked at a local bare remote; compliant push allowed; clean working copy cannot hide oversized commit. | `npm run test:quality-gates`; `npm run hooks:check` confirms this checkout's activation. Release/quality CI also runs these tests. | Historical red retained. The hook prevents this deterministic violation when installed; it cannot establish browser correctness or protect an unconfigured clone. |
| Q3 save-flow ESM import and MFA panel cleared, run 34067451777 | Browser-only dialog dependency crossed the Node import boundary; MFA fixtures disagreed about the base session. Separate actual save operations from DOM control and align session/MFA phase fixtures. | `tests/admin-ai-save-operations.spec.js`, actual Worker save-helper cases, `tests/auth-admin.spec.js`, Q3 logout/context cases. Explicit fallback codes, original save intent, enrollment/verification and invalidated identity are asserted. | `npm run test:q3-integration`; normal `test:workers` and broad browser jobs retain the real imports and auth cases. | Matching Worker/browser jobs in 34312435904 passed on `562c4094`. This media-only repair does not change their inputs; no renewed billing/MFA live claim. |
| Media callback quotas, pause frame budgets and global idle checks; transition failure run 34259326995; redundant time/resume checks in34362121716 | Callback frequency and decoder statistics were not playback contracts; later lawful turns invalidated a global idle assumption. Use current video/source/pause epochs, native output and captured transition-instance completion. Remove the redundant250ms currentTime comparison: a loop can return to the same position. At turn resume the existing captured-target observer now requires both settled geometry and fresh output; a separate general wait that followed later loading identities is removed. | `tests/homepage-hero-state.spec.js`: frozen/stale/foreign callbacks, wrong/missing/hung transition target, equal loop positions with/without output, unpaused-but-frozen resume, old epoch, and correct output/completion followed by another turn. Native pause, corrupt-media, resume and EN/DE cases remain in `tests/homepage-hero-playback.spec.js`. | `npm run test:homepage-functional`; `npm run test:homepage-webkit` on macOS. `test:homepage-selection` + `check:homepage-selection` reject missing native scenarios or wrong OS membership. | Model controls supplement native tests. Historical Linux native-media divergence remains separate bounded diagnosis; macOS WebKit is not a Safari/iPhone device certificate. |
| Fourth active slot has no new output while seeking; run 34312435904, artifact 10089641378 | Actual missing-output interval is retained, but its engine/controller/observer attribution is not established. Local plain-four/Hero-four controls did not reproduce it. Remove avoidable synchronous layout/decoder reads from the observer; close the separate stale pre-seek proof gap. Do not change the clip, HTTP handler or controller on speculation. | `hero-stalled-slot.json` replays all 13 original samples and stays red. A seek needs subsequent own output; three neighbours, an old phase/source or a seeked event alone cannot pass. Hot-path layout/decoder queries throw in the focused observer regression. `homepage-native-control.spec.js` independently exercises one/four concurrent videos, original/changing short sources, two genuine loops, seek, pause and resume over HTTP. | The four named independent scenarios now remain in explicit `test:homepage-functional:extended` / `test:homepage-webkit:extended` (Full regression), including discovery countercases removing a required extended scenario. Core retains stale/frozen-slot and corrupt-media controls. Linux Chromium extended runs them; Linux WebKit records them only through `diagnose:homepage-linux-media`. | Native results and bounded coldstarts belong to the final private Q4 handoff. The earlier red run is not replaced by the earlier green push run. This row does not declare the historical seek stall fixed or approve missing output. |
| Linux UID mapping/bootstrap and ambient host-interface postcheck failures, latest ambient example run 34250807973 | Own namespace/privilege/egress boundaries must be proved directly; host inventory changes alone do not prove a child escape. Fixed bootstrap checks its private namespaces before privileged operations, drops rights and reports ambient identity-based differences separately. | `scripts/test-q2-runtime-launcher.mjs`, `tests/q2-recovery-staging.test.mjs`, native runner entry/exit checks: missing boundary, remaining privileges or real outside connectivity fail. Primary and postcheck errors remain distinct. | `npm run test:q2-runtime`, reached by `npm run test:workers`; hosted Linux preflight and complete Worker/Q4 native suite remain required. | Worker/Linux job 102347580613 passed in 34312435904. No new isolation implementation or native Linux claim from local Mac tests. |
| Unknown diagnostic config and reconciliation without a deployment, run 34276520093 | Exact validation-only classification was missing; unconditional follow-up ran after a blocked deploy. Classify the exact file, keep unknown paths blocked, perform the full-range guard early and immediately before deploy, and use the actual official deployment action. | `scripts/test-release-plan.mjs`, `scripts/test-static-deploy-safety.mjs`, `scripts/test-ci-test-selection.mjs`: full mixed Q4 range, valid/invalid acknowledgements, unknown paths, blocked/skipped/failed/cancelled/no deployment. | `npm run test:release-plan`, `test:static-deploy-safety`, `test:ci-selection`; real `check:static-deploy-safety` with base/head/event/ack in the release job and deploy job. | Release job 102347444479 passed; Pages was correctly skipped after the later media failure. Plan prerequisites are not evidence of missing live resources. |
| sharp GHSA-rgj7-g3m4-5g8c and npm10 `Missing sharp@0.35.2`, runs 34307277787 / 34310987440 | Three independent Worker projects need patched sharp. Nested override installed under npm12 but failed npm10 cold ci; direct `sharp:0.35.4` override and npm10-generated locks retain undici/ws and platform entries. | Existing dependency/toolchain validators reject old sharp/unsupported native chain. `check-worker-dependency-audits.mjs --install` performs real ci/ls, verifies unchanged package/lock bytes and installed sharp/libheif, then runtime and dev audits for all three projects. | `npm run check:worker-dependency-audits -- --install` in standard/full early release steps; native Images smoke via `test:workers`. Reinstall when package/installation inputs change, not for every unrelated test edit. | The complete Linux cold-install/audit and native Worker chain passed in 34312435904. Root-only or omit-dev audit is insufficient; no audit exception, package upgrade or backend deployment is introduced here. |
| Hidden Video generation not ready after Gallery switch, run 34347675542 / artifact 10103665965 | The test demanded visible-layout readiness from an inert, zero-width wall and then never returned to Video. No product fault reproduced. `waitForPublicWall` now verifies the active category, current measured/container width, generation and card/column geometry across frames. Hidden cards/structure survive; the test actually reopens Video and verifies original cards, focus and current layout without requests/rebuilds. | `public-wall-readiness.cjs` plus `homepage-carousel-focused.spec.js`: stale ready/second generation, hide before completion, reopening, stuck layout and wrong/missing cards. The full EN/DE responsive browser path tests the actual product module/build. | `test:homepage-functional`, `test:homepage-carousel` and broad static entrypoints; full homepage group finishes all cases before the long browser job. | Original hidden ready=false is legitimate, not rewritten to true. Local synthetic window controls supplement Chromium/WebKit execution; CI remains required on final workflow inputs. |
| Full push validation followed by a queued duplicate full dispatch, runs 34347645021 / 34347675542 | Workflow-wide production lock and unconditional manual full regression. Static validation builds once; after confirmed Q4 publication, schema-2 scope follows the complete unpublished range and selected browser jobs verify that artifact. A selected completed run/attempt can publish it through the existing workflow without repeating suites. Only real eligible deploy jobs take the shared Pages lock. After34362121716, long standard/full browser jobs also wait for the native WebKit and Worker jobs; a failed short prerequisite must not start another35-minute suite. | `scripts/test-pages-candidate.mjs`, imported by `test-pages-workflow.mjs`: exact own repo/SHA/attempt, executed suites, missing/expired artifacts, altered bytes/OS proof, later failed validation, old main, missing outputs and cancelled jobs. Real local record/proof/publish CLI roundtrip preserves bytes. Existing full-diff/unknown-path/ack countercases remain. | `npm run test:static-deploy-safety` and the early Release/Quality job; live reuse uses `pages-candidate.mjs source` plus immediate final source/current-ref check under the write lock. | Candidate artifact transfer and Linux consumption worked in34362121716, but its failed Mac acceptance blocks reuse. Actual dependency-list countercases reject failed/missing/skipped prerequisites; successful selected or deliberately unselected/reporting jobs preserve selection semantics. Local orchestration controls are not publication evidence. |

| Decorative source churn into unloaded targets, run34370836697 / artifact10112081978 | Timer-driven advance committed an unready incoming face. Prepare one next source while retaining the current face; commit only available media, bound speculative loading and hold on error/cancellation. Visible poster layer handles unavailable playback; no exact source cadence. | `homepage-hero-state.spec.js` preview readiness control: delayed valid commit, failed/timeout source, no retry chain, stale callbacks and visibility cancellation. Native EN/DE delayed HTTP release/cancellation, visible corrupt-source poster, own output and Models navigation in `homepage-hero-playback.spec.js`. The `smoke.spec.js` Models-CTA case uses intentionally invalid video bytes: its redundant timed rotation assertions now check retained visible posters and accessible navigation instead. | Standard/Fast `test:homepage-functional` + macOS `test:homepage-webkit` require named core cases; `check:homepage-selection` checks actual core/extended discovery. Full regression explicitly invokes extended timing/multi-loop comparisons. Candidate proof rejects missing core titles or retired policy/build. | Original206 responses and42-sample failed window retained privately; transport bytes checked against fixture. Product gate fixes unsafe replacement, not an asserted decoder cause. Final OS results/hash belong to the existing Q4 handoff. |

| News spec forced full selection and completed Q4 stayed the implicit release range, run34395792740 | Missing Admin test mapping plus Q4-only candidate assumptions. Map the exact spec; derive the complete unpublished range from a verified Pages deployment. Selection, actual jobs and schema-2 build/report proofs share that range. | `test-ci-test-selection.mjs`: actual six-file News delta stays Admin/static, unknown neighbor stays broad. `test-pages-candidate.mjs` / `test-pages-workflow.mjs`: ordinary Admin scope, missing/failed selected jobs, unselected Worker, intervening unpublished commit, actual deploy receipt, wrong SHA/bytes/proofs and later failure. | `test:ci-selection`, `test:static-deploy-safety`; News executes through the existing `test:auth` command and broad static entrypoint. `pages-candidate.mjs baseline/record/proof/source/publish` implements the live contract. | Q4 publication34393537797 is the initial verified baseline, not the failed News run. Local CLI/selection tests are orchestration evidence, not a Pages deployment. |
| Optional successors not simultaneously loading; EN Chromium run34395792740 | Usable originals continued output; the test assumed both optional preparations must start together. Exact seek/advance interleaving was not observed. Loading-only fixture uses12s of stream-copied native H.264, avoiding a one-second loop seek at preparation start. Require each actual held HTTP request, retained own output, then valid adoption or cancellation. | Existing `homepage-hero-playback.spec.js` EN adoption / DE cancellation plus `homepage-hero-state.spec.js` delayed/failed/timeout/manual-pause/stale-callback controls; the unsafe old controller still violates the retained-face control. Original short-clip loop cases remain extended. | Required Chromium `test:homepage-functional` and macOS `test:homepage-webkit`; readiness countercontrols also run in broad static. | No controller change or claimed universal decoder fix. Real HTTP uses the product range helper. Native results remain distinct from deterministic state controls. |

| Admin release still blocked by unchanged decorative pause/bfcache cases, run34400980411 / macOS job102632774689 | Broad orchestration-path fallback selected unrelated media. Production diff remains the Admin reader only. Closed reviewed Admin/tooling inputs now select `admin-reader-v1`: existing News/shell/session/MFA in both engines and short homepage visibility/navigation smoke. Any additional shared/runtime/backend/dependency or unknown input rejects this scope. | `test-ci-test-selection.mjs`: complete Admin/tooling delta and added shared/Worker/unknown counterinputs. `test-pages-candidate.mjs`: real discovery retains every News scenario in both engines; missing/skipped/failed/zero Admin result, wrong identity and old-policy/bytes fail. | `test:ci-selection`, `test:static-deploy-safety`; actual `npm run test:static -- --config playwright.admin-release.config.js` in selected browser job; per-case report is matched to discovery before the existing artifact proof. | Latest EN configured pause/resume no-output and EN hidden-init/bfcache timeout remain **unresolved**, retained in `test:homepage-webkit:extended` / Full regression. Delayed successor passed in that run. No media debugging/product change, retry or historical pass relabeling. New policy requires fresh candidate acceptance. |
| Admin proof ENOENT after 176 passing cases, run34404123954 | Playwright cleaned discovery from its default output directory. Admin artifacts now use `test-results/admin-artifacts`; discovery and result JSON remain siblings. The workflow removes both old reports before discovery. | `test-pages-candidate.mjs` executes the actual workflow discovery/execution commands with a browser-free fixture in all six effective projects: old layout loses discovery, corrected layout retains its exact bytes; stale reports/artifacts are removed. Existing missing/failed/skipped case and build-identity rejection remains. | `npm run test:static-deploy-safety`; selected Admin workflow then runs real acceptance → `pages-candidate.mjs proof` → unchanged-artifact publication. | Lifecycle regression is not native acceptance. Final local Admin/build/proof evidence belongs to this correction; the earlier 176 passes did not produce a valid CI proof or deployment. |

| Sound Lab More reads idle after a valid selection in built-site CI, run34635233151 | The test imported `audio-manager.js?v=__ASSET_VERSION__`, creating a different module-local state from the real versioned application import. Resolve the unique same-origin homepage entry version and verify the pre-observed audio response URL before using that exact URL for reset and reads. Built roots reject placeholders. | Existing `smoke.spec.js` Sound Lab More case retains 60/100/identity limits, clears and reselects the real manager, then loads a deliberately different version: foreign reset cannot change the real selection and ambiguous identity is rejected. Two distinct local build tokens plus source mode exercise the same case. | `npm run test:static -- tests/smoke.spec.js --grep "homepage Sound Lab More starts at 60 Memtracks" --project=chromium`; full static/browser CI includes this existing mapped spec against `_site`. | Original CI failure and retry remain red. Local browser controls use mocked `play()`, not native audio acceptance. Final local results/hashes are recorded privately; no new CI or publication is implied. |

| EN hidden-init/bfcache failure, run34642675559 / macOS job103406370743 | Original sample 12 invalidates right-bottom output at seek baseline 20; samples 13/14 still have 20 despite window-start output 9. Left-top remains seeking through samples 1–11. The delay's engine/scheduling/probe cause remains unresolved. Run34763273493 additionally proves an 868ms resume-to-observer gap: post-resume output became the new baseline. Register the existing progress window and captured identities before pageshow/visibility/offscreen resume in one browser task; reject a replaced source, element or epoch. A separate post-bfcache loop/output check retains the subsequent-seek requirement and its existing finite bound. | `homepage-hero-state.spec.js` replays the exact projected 14-sample fixture, keeps it red, tests fresh-output and stale identity/pause/error countercases. The same spec now exercises the actual browser action callback: late observation stays red, joined observation survives delayed collection, stale/missing/paused/seeking/foreign identities remain red and finished timers stop. Effective seek baseline, action time/identities and bounded native metadata remain diagnostic, never substitutes for output. | Existing `playwright.homepage.config.js` / homepage functional selection executes the state tests in Chromium/WebKit; `playwright.homepage-webkit.config.js` retains native EN/DE lifecycle cases. | Local original EN and instrumented EN/DE/native countercases passed; this neither repairs nor re-certifies the failed CI run. Synthetic PageTransitionEvents are not real bfcache navigation. Private raw reports preserve exact inputs and the unresolved scheduling/seek hypotheses. Run34766444430 subsequently exposed timer aliasing despite joined actions: native output exists between samples that land on following loop seeks (9/11 pass, DE lifecycle and native negative-control resume fail). The existing registered native-frame callback now notifies the same progress window immediately; one fallback timer, unchanged seek/identity/output rules, bounded samples and cleanup remain. The existing action-order test proves timer-only misses, notified output, a fresh stuck-seek phase failing and callback unsubscription. No callback quota or native result is inferred from this synthetic control. The exact native probe helper now maps to the existing homepage/Carousel selection; the complete News repair delta retains native macOS, Linux homepage and browser jobs. Selector counterchecks retain broad unknown-helper coverage and Worker impact; no native gate is removed. |

### Workers Static Assets preparation (2026-09-11)

- Risk: activating dormant Geo routing, exposing repository files, or treating an upload/old Pages success as the new serving baseline.
- Correction: allowlisted immutable site plus separate frontend entry; explicit document routing; independent active-version/domain receipt; Pages bootstrap only from its verified deployment. Wrangler temporary state stays outside the immutable package.
- Caller: `npm run test:frontend-hosting` in static validation; `--standalone` in Full regression. Native local workerd checks actual routing/bytes and upload dry-run; `--unit` rejects missing/partial/wrong activation, failed uploads, displaced candidates and unsafe partial recovery. `test:static-deploy-safety` executes workflow/candidate counterchecks (including branch/validation-only publication denial).
- Limit: local macOS runtime and synthetic API fixtures are not Linux CI, live domains/certificates, or a completed hosting migration. See `STATIC_HOSTING_MIGRATION.md` for the separately authorized external stages.

- Hosting review follow-up: preparation had not compared the full upload tree or authenticated branch CI archives; validation inherited Pages/OIDC writes, and artifact-only receipts could not represent rollback or expiry. `test:frontend-hosting` now invokes `test-frontend-review.mjs`: real CLI/Git/ZIP countercases, effective job permissions and A -> B -> protected recovery A with durable metadata. Raw `test-results/frontend-review.json` distinguishes synthetic API contracts from native runtime. Upload commands repeat provenance checks; only publish/recovery jobs have write permissions. Candidate archives still expire, while verified durable production receipts use independent GitHub job and Cloudflare serving evidence. No live activation is implied.

- Frontend stored-log privacy: reset links carry URL tokens; enabling default invocation logs would record request metadata. Version 10% persisted custom logs with invocation logs/traces disabled and query redaction enabled; emit fixed failure codes only. `npm run test:frontend-hosting` (normal static validation/Full caller) checks synthetic secret-bearing requests/errors, generic 500/HEAD, unchanged successful responses, generated preview/production config and rejects unsafe policy changes; native local workerd confirms emission. `test-results/frontend-logging.json` is local payload evidence, not proof of dashboard persistence. Post-deployment active-settings/stored-log verification remains required.

- Logging release34691096299: frontend entry/config and known release-tooling paths forced the full platform matrix; unchanged native media failed and deployment was skipped. Map those exact paths to existing release/build/native frontend acceptance; unknown scripts, authority changes and real media/backend changes retain appropriate wider selection. Unselected jobs now skip without runners; actual workflow conditions accept only successful selected jobs. `test:ci-selection`, `test:static-deploy-safety` and `test:frontend-hosting` cover the cumulative logging delta, mixed/unknown inputs, failed/missing selected steps, zero/wrong package proof and Full-vs-narrow source policy. Contact install is reused after the dependency audit's actual `--install`. Historical media failure remains unresolved in its own scope; neither retries nor timing changes recertify it.


### Browser-bound member generation and missing video posters

Session preflight (2026-09-23): a failed `/api/me` returned before admission but
Generate Lab blamed prompt/model/credits. The D1 internal cause remains unproven.
The durable client now permits two five-second session reads with one 400ms delay,
fences identity/credential changes, and serializes submissions; no generation POST
is retried. EN/DE session feedback preserves inputs and the existing preview.
`test:auth` in `static.yml` executes `oma2-q1-member.spec.js` preflight cases through
Generate Lab and homepage image/music/video callers: transient/persistent/timeout,
401/403/guest/malformed identity, account switch/logout, non-cooperative late
responses, concurrent clicks, zero unverified POSTs and one post-recovery POST.
Existing durable cases retain accepted-job observation and opaque-key reuse.
The baseline browser countercontrol reproduced both the missing retry and false
advice; controlled fixtures do not prove a live D1 repair or paid inference.
`test:q3-integration` also exercises shared auth/MFA/save/Compare. Its isolated
auth-ordering fixture now serves the existing GET `/api/model-pricing`; the
baseline failed on that missing fixture, and unexpected requests still fail.
No Worker/schema change; Auth checkpoint remains `0095_retained_image_delivery.sql`.

Release follow-up to failed run `35884833389/1` (320 passed, 17 failed): the seven
pre-existing families remain recorded, not recertified. `test:homepage-core`
now checks exact GPT Image 2 identity, registry-derived image membership, explicit
H3/PixVerse selection and unchanged prices, localized available operations and
background capabilities, and the full visible save failure/retry/success flow
(one generation, identical save payload, retained preview and balance). P13 and
mobile swipe fixtures serve legitimate appearance/pricing GETs; unexpected
requests/writes and console errors still fail. Decorative video fallback remains
its existing curated subset; Preview and H3 stay in the global member contract.
The mixed preflight/help range selects homepage core, Assets and Auth acceptance;
the informational help module does not select native homepage decoders. Selector
tests retain registry/shared/unknown-input countercontrols and required proof jobs.
Executing the previously skipped `test:auth` also exposed the same substring
selectors in `auth-admin.spec.js` and obsolete Lab save-success assertions in
the EN/DE P03 cases. Those use exact identity and visible workflow/handoff feedback;
immutable Alpha/Beta saves, explicit retry, folder, focus and reopen checks remain.
The first full Auth execution recorded 600 passed/74 failed: the same GET fixture
omissions also affected Q3 media/workflows. Their exact GET replies now preserve
unexpected-request/write checks. Four private-media shell cases omitted the
existing independent `thumbnailBackend` from the fixture and expected payload;
the corrected exact contract verifies that changing full-video service leaves
the stored thumbnail service unchanged across reload. No service/runtime change.
An unchanged appearance case also sampled a notice during its ancestor card's
700ms reveal (ratio 1; an unchanged isolated rerun passed). It now waits for that
ancestor to finish before triggering the transient notice; actual composited
contrast still must meet 4.5:1, and the media/focus assertions are unchanged.
Admin guide keyboard coverage now awaits the existing scheduled title focus on
every reopen before pressing a destination; two missing waits raced that focus.

Member generation previously completed within the browser HTTP request; image
saving and missing video posters additionally depended on browser callbacks.
Durable acceptance now uses the existing queue/cron, private provider/download
receipts, an immutable owner/job identity, idempotent billing and the existing
FFmpeg poster path. `workers.spec.js` loads `member-generation.cases.js`; the same
control executes under the normal isolated native runtime. Counterchecks cover
browser departure/outbox repair, duplicate delivery, stale poster claims, poster
retry/expired final leases, bounded interrupted executions, committed-but-lost DB/debit replies, private uncharged assets, expired
provider download URLs, unknown paid outcomes, image persistence and bundled music
cover retry, confirmed service rejection without debit, and preserved browser
throttling without re-throttling accepted continuations. `test:auth` includes `oma2-q1-member.spec.js` for EN/DE automatic saving,
opaque intent reuse after reload and read-only backend status. Processor headers
and the actual workflow configuration gate (member/legacy modes, missing secrets)
are checked in `test:homepage-ffmpeg-processor`. Selector regression keeps these
real callers required without making unchanged decorative decoder suites gates.
Local native evidence is not a Linux-CI or paid-provider/live acceptance. Unknown
provider outcomes without a retained receipt remain review cases, not retry permission.

Run34705981330 passed Assets/Auth execution but Auth's default Playwright cleanup
removed `candidate-assets.json` before the common proof. The existing workflow
now passes `--output=test-results/browser-artifacts` to every default-config
report producer (static/core/assets/auth); dedicated Admin/Carousel directories
remain isolated. Candidate reports and prior browser proof start clean after
restore. `test:static-deploy-safety` invokes `test-pages-candidate.mjs`, whose
browser-free real npm/Playwright Assets -> Auth -> CLI proof sequence reproduces
the old loss and checks retained reports, disposable cleanup, stale/missing/failed
reports and wrong SHA/run/attempt/build rejection. No product suite is replaced
by this lifecycle control; the final CI still executes selected product cases.

Run34703893895 passed Worker/native Linux acceptance but two member UI cases
still required legacy caller prefixes. Member opt-in deliberately uses a stored
UUID plus `Prefer: respond-async`. The Sound Lab/PixVerse cases now exercise
202 acceptance -> job result, retain payload/credit/asset checks and reject
browser asset/poster writes. The existing lost-response control covers image,
music and video: unchanged opaque UUID/body after reload, overriding caller
headers, then a fresh intent after completed delivery. Caller: `test:auth`
(`auth-admin.spec.js` and `oma2-q1-member.spec.js`); a focused `--grep 'durable
generation|homepage Sound Lab Create opens|homepage Video Create exposes'`
selects these cases. Earlier HTTP-200/explicit-save fixtures remain deliberate
compatibility tests, not durable completion proofs. Shared API calls without
opt-in, profile/avatar and Admin generation were not converted and retain their
original contracts. UI mocks do not replace the accepted native backend proof.

Run34700787400 exposed a stale Fable latest-checkpoint assertion and a MockD1
anti-join/parser gap (including shifted folder bindings in mixed asset lists).
Fable now checks its required migration remains included; the actual asset-read
SQL is compared with SQLite for legacy, finalized and unfinalized rows before
pagination. Caller: the affected `workers.spec.js` and `fable-chat-workers.spec.js`
cases in `test:workers`; no production list SQL was changed.
Simulated16/31-minute cases in the same member-generation controls exposed late
receipts stranded after lease loss. Cron now resumes only an owned retained
receipt, with no second inference or extended credit reservation. Known success
can finish after30minutes; an unknown result arriving after reservation release
is stored privately (including video bytes) for explicit credit reconciliation,
never exposed or automatically charged. Missing receipts remain unknown. Both
Node and native workerd execute these controls through the existing callers.

Run34702468263 passed1270 Worker routes and the FFmpeg/member-mode contracts,
but launcher self-tests still imposed Worker selection on static release tooling
and immediate Playwright-to-native adjacency. The launcher now checks the scoped
selection and executes the actual npm shell chain with harmless command doubles:
required Q4-selection, route, processor and native steps run once in order; a
failure at each step stops all downstream commands. The two exact launcher
scripts select Worker/native checks without unrelated full regression; unknown
script names remain broad. Caller: `node --test tests/q2-recovery-staging.test.mjs
scripts/test-q2-runtime-launcher.mjs`, also required by `test:q2-runtime`.
These orchestration checks do not certify Linux execution or deployment.

### Shared asset cards and automatic names

The shared saved-assets browser had tall video cards and inherited action margins
that clipped/shrank controls. Images/videos now share square previews, a permanent
video Play control and a keyboard/touch disclosure. Native buttons retain the
existing owner actions; nested key events no longer also activate the card.
Publication refresh restores the active disclosure/focus instead of leaving a
detached button and a visible but non-interactive overlay.
`playwright.assets.config.js` runs the focused cards, Generate Lab reference picker,
owner rename/publication and durable-client neighbors in Chromium/WebKit on `_site`.
The selected Assets step discovers and executes those cases; candidate proof checks
every discovered result and both engines, outside disposable Playwright output.

Music follow-up: old inline audio controls made cards tall and the disclosure
used an ambiguous ellipsis. All three media now share the square card/disclosure;
music opens the existing native audio detail with explicit return focus and cleanup.
The existing mobile deck scales hit areas: scoped 50px controls retain >44px on screen.
`shared music cards` in `tests/assets-manager-focused.spec.js` executes through the
same Assets command on both engines: cover/missing cover, media icons, rendered
bounds, publish/unpublish, cancelled deletion, selection without playback, native
play/pause, Escape cleanup and focus return. Explicit disclosure keeps visible action
names on hybrid pointers; the media-icon attribute does not reuse Generate Lab tab
selectors, and the existing reference-order badge must render. No provider/storage/naming change.
The shared detail export is narrow only with this classified card delta; alone it
retains ordinary homepage/auth selection.

Run34768791107 exposed nine stale broad Admin card scenarios: inline media titles,
SOUND badges and card audio no longer describe the shared reader. The complete
cases in `auth-admin.spec.js` now check asset ID/title/accessibility, poster identity,
real fixture playback in the detail, close/switch cleanup, contained actions and
owner publication while preserving upload/cover/credit and text-panel assertions.
Their new publication countercheck also caught desktop menu restoration invoking
mobile deck layout: only an active deck now receives `setActive`, so desktop cards
and their neighbors retain normal geometry. Actionability precedes geometry reads
through mobile transitions. The broad caller's German model-status tap case sets
`hasTouch` only in its own describe; desktop mouse/keyboard context stays unchanged.
Caller: `npm run test:auth` (selected browser job), locally `npm run test:static`
with the ten named cases and zero retries against `_site`; existing Assets music/
image-publication neighbors additionally exercise the shared fix in both engines.
Synthetic media proves connected UI playback/cleanup, not provider generation.
Run34772729581 also exposed the old image-owner neighbor relying on hover alone:
Linux WebKit clicks hit the poster rather than the hidden action. That existing
case now opens the explicit media disclosure and uses keyboard focus after refresh;
publication state, contained hit targets and no unintended preview remain asserted.
Separate existing desktop hover cases remain executable and passed in that run.
The complete mobile grouped-grid neighbor in34774257994 still expected the action
overlay to remain visible after bulk-mode exit. It now explicitly opens/closes the
media disclosure, preserving all selection/move/notice/grid/detail/dot assertions.
The same owner-action entry is used by the directly related save/delete storage
case; separate focused hover coverage remains unchanged. No visibility is forced.

`asset-names.js` shares first-three-word naming and the existing filename sanitizer.
Image/video/music storage uses it without changing provider input, storage keys,
credits or jobs. Explicit names and later renames win; durable image saving forwards
the explicit title. Existing image `prompt` is also its rename/display-name field.
Old assets lack reliable automatic-name provenance: retain their names rather than
infer origin or rewrite records. Existing title/filename length limits remain.
`workers.spec.js` loads naming and owner-file/rename controls from
`member-generation.cases.js`; the same six storage cases run with real workerd/D1/R2
in `test-q2-runtime.mjs --suite member-generation`, including the existing failure
and credit/ownership controls. This scope uses the unchanged isolation boundaries;
no option still executes all runtime suites. The standard selected Worker job runs
image/video/music/text-asset route neighbors plus this native suite. Unknown,
additional security/dependency or homepage inputs retain ordinary wider selection;
Full Regression remains full. `test:ci-selection`, launcher and candidate tests
exercise both choices, failed commands and missing/failed/wrong-build evidence.
Local synthetic/native results are neither Linux CI nor paid-provider live proof.

### Public media detail window (2026-09-13)
- Cause: preview/poster/requested dimensions were labelled as resolution; Download was a placeholder; fixed dialog/media heights created empty space. Close and open-original are distinct controls (operated); their touch targets were undersized and WebKit’s native upper-left fullscreen control overlapped the application close action.
- Correction: read intrinsic dimensions only from the already-open original file, otherwise unavailable; download only the existing same-origin original route with response/type checks and cleanup. Keep close/open separate with 44px targets in a reserved strip above the video, outside native controls. Content determines height, with one overflow owner when needed. An active public dialog keeps a CSS-scoped background lock even after a late inline unlock; the controlled countercase remains executable.
- Executable controls: `npm run test:static -- --config playwright.public-media.config.js` covers EN/DE desktop/touch/tablet, actual original bytes/name vs poster/requested dimensions, denial, image/Sound Lab/like/comment neighbors, empty/short/long comments and tab return. Its existing Worker file-route case checks public/withdrawn, owner/guest/other-user access without production changes.
- CI caller: existing selected browser job (`public-media-detail-v1`, candidate-auth report), discovery compared with actual Chromium/WebKit and file-contract results before the immutable candidate proof. Selector/workflow tests keep unknown, backend and other controller inputs outside this reviewed detail scope. Full regression remains separate. Local Node route mocks are not a live/private-account or native Linux deployment attestation.

### Creation Workspace guidance (2026-09-13)
The six-tile checklist duplicated form state and described browser-bound/manual saving. It is removed in both locales; the existing estimate/validation remain beside Generate. Help lazily reads all exposed models from the form registry, grouped by mode, with durable acceptance/automatic storage guidance. Existing `smoke.spec.js` Workspace/model-switch/session cases plus registry-driven EN/DE desktop/touch Help checks and `locale.spec.js` run through `playwright.workspace.config.js` (Chromium/WebKit). `workspace-help-v1` binds this closed informational delta to discovery and actual results; model/pricing/runtime/unknown changes cannot use it. Selector/candidate tests reject missing, skipped or failed coverage. WebKit's canvas ResizeObserver notification also reproduced on unchanged 0640931c; it is attached as diagnostic, while other page exceptions fail. No generation, price or backend changes.

| Admin model status must not infer global health from HTTP acceptance, cached replies or recent cleanup | `admin-model-status.js` derives membership from existing Admin/member/chat contracts. Bounded indexed attempt reads distinguish provider results, owned durable assets, preview/cover work, unknown attribution and stale sources. No inference or job mutation; the existing Admin/MFA guard precedes cache access. | `admin-model-status.spec.js`: registry changes, deduplication, stale completion versus updated_at, cache/input/unknown errors, independent paths, retained video and real SQL/index checks. `admin-model-status-runtime.mjs`: actual production fetch guard/MFA, native D1 and no job/provider mutation. `oma2-q3-model-status.spec.js`: both UI engines, EN/DE, filters, denial, stale refresh and cancellation. | Existing Worker runner `--suite model-status`; `playwright.workers.config.js tests/admin-model-status.spec.js`; `playwright.model-status.config.js`. `admin-model-status-v1` selects these through the existing jobs; candidate discovery/proof rejects missing/skipped/failed cases. Unknown shared/billing/generation inputs reject this closed scope; Full retains the cases. | 24-hour bounded sample, not an availability percentage. Historical member errors without result_model remain unattributed. Admin storage correlation, chat turn history, organization-metered Admin image attempts and independent Gateway logs are not connected. Public Cloudflare component notices are supplemental, not model/account guarantees. No migration, model-release or billing change. |

| Model-status Linux child rejected an admitted suite; its individual report was not retained (34748932098) | Explicit child scope admission and bounded report allowlist now include model-status; unchanged privilege checks run before repository imports. | Existing launcher test executes the actual child module with synthetic imports/identity: supported scopes reach the runner, unknown/empty scopes and wrong UID/GID/OS cannot. Existing Python tests copy real report files and reject symlinks/oversize; staging checks the actual model-status import. | `node --test tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs`; `npm run test:ci-selection`. The complete unpublished status delta retains `admin-model-status-v1`; hosted Worker job must execute `--suite model-status`, then focused browser proof. | Portable dispatch/copy tests are not Linux isolation or native acceptance. The correction commit requires fresh hosted Linux, browser and CodeQL results; no product or permission change. |

### Homepage News Pulse free-space placement (2026-09-13)

The original label-only placement missed real obstacles; the subsequent full-width side-preview bottom plus vertical centering then hid useful central space (1728×1117: central Canvas bottom 644.6, feed top 736.5). Placement now preserves the published lower anchor and grows upward: only horizontally adjacent rectangles constrain the top, with a 0.5rem gap. Existing 1.5rem side/bottom gutters remain; compact padding permits an 11rem readable minimum, with 0.25rem re-entry hysteresis. The existing EN/DE geometry case compares the previous lower anchor, tests 1920×950/1080, stepped hide/return and stable boundary notifications, lateral versus central obstruction, delayed images and disabled mobile data. Hidden content stays `display:none` and inert; no hidden-box measurement, polling, media-controller or visibility-switch change.

Executable caller: `npx playwright test -c playwright.homepage.config.js tests/homepage-carousel-focused.spec.js --grep 'homepage news ' --retries=0` (EN/DE, Chromium/WebKit; selected homepage CI and extended existing entrypoints). Countercontrols cover enlarged central content, insufficient width/height, resize return, text/visual-viewport zoom, delayed images, missing optional content, source navigation, keyboard/touch and request counts. Overflow comparison removes/reinserts the hidden feed synchronously to distinguish its contribution from existing animated neighbours. Native browser geometry is the evidence; fixture-enabled news is not proof that production visibility is enabled. Existing disabled-source coverage remains in `oma2-q3-newsfeed.spec.js`.

Runs34867734187 and34871690537 exhausted the single 45s geometry case (the latter after18.35s frame waits and4.57s screenshots), without a recorded gap violation. Reducing repetitions alone in34869664537 did not remove the workload coupling. The same fixture now serves three independent scenarios: geometry/boundary, content/interaction/obstacles, and surface policy/zoom/request caching. Resize waits for the actual current bounds; representative pre-change bottom coordinates independently supplement the anchor calculation. Screenshots are outside repeated boundary notifications; teardown attaches saved geometry after page closure. No timeout/retry or product controller change. Linux CI remains distinct from macOS evidence.

Existing `impact-v1` selection assigns the two News consumer files and functional specs to homepage coverage, not shared Auth/Admin ownership or a duplicate carousel matrix. Model-registry/overlay inputs still own model parity; generic smoke/locale tests own core coverage. `homepageMedia` selects native Chromium/macOS proof separately; actual carousel/shared-runtime/unknown impact remains conservative. Current unpublished media-spec changes still require native acceptance. `static.yml`, `pages-candidate.mjs`, and the existing discovery/report verifier share this decision; missing/failed selected cases/jobs, absent flags, wrong build identity and unpublished intermediate changes block. Actual callers: `npm run test:ci-selection`, `npm run test:homepage-selection`, `node scripts/test-pages-candidate.mjs`, `node scripts/test-pages-workflow.mjs`, and `npm run check:homepage-selection`. Full/extended remains available; no new release profile or workflow.

Run34869664537 passed all four Linux News geometry cases and native macOS acceptance, then exposed an unrelated DE delayed-successor assertion: the all-four resume identity lock rejected a legitimate upper-slot change (left_top playback-5 → playback-6), while the cancelled lower preparations retained their original sources. The existing native loading case now resumes and starts current-output observation in one browser task, requires fresh native pairs for every current slot, and pins both cancelled lower identities/sources/epochs throughout the recorded window. The strict general resume probe is unchanged. The existing controlled readiness case advances the real controller clock through a subsequent upper transition, rejects the old global identity assumption, and verifies that late cancelled callbacks cannot replace either lower source. Callers: `playwright.homepage.config.js` state/Chromium and `playwright.homepage-webkit.config.js` native EN/DE loading cases, with existing frozen/foreign-source/ignored-pause/corrupt-media countercontrols. No product controller, fixture bytes, timeout, retry or CI gate changed.

Run34764931638 passed native lifecycle acceptance (11/11) and Linux homepage (70/5 engine skips), then exposed stale smoke contracts: always-visible narrow/empty news, removed placement attributes/mobile cube, and the prior manual-save Help copy. Existing `tests/smoke.spec.js` now checks real safe geometry, bounded size, retained manual selection across hiding, inert narrow content, empty/error clearing and auth transitions; unrelated Hero geometry remains asserted. The existing German Help check follows durable acceptance/automatic storage instead of instructing manual save. Caller: `npm run test:homepage-core`; focused `npm run test:static -- tests/smoke.spec.js --grep 'KI-PULS uses|German homepage Live Pulse|mobile logged-in|retains manual selection|initializes after login|failed endpoint responses|Models video module sits flush|localizes route-prioritized|hero foreground scales' --retries=0`. These replace obsolete presentation assumptions, not native output checks; no product change or failed-run recertification.

Run34767139699 passed native macOS11/11 but Linux EN/WebKit geometry reached its final request count before the mobile matchMedia request had been observed (69 pass/1 fail/5 skips). The existing geometry case now awaits that requested surface before resizing back/cancelling it; the exact final two-request/cache assertion and every safety/visibility assertion remain. Same existing EN/DE Chromium/WebKit caller above; no product change.

Run34767708882 passed macOS11/11 and Linux70/5 skips; browser161/1 exposed an overfixed smoke expectation added during alignment:1920×1080 hides locally but fits on Linux. The scale smoke now evaluates actual neighbour/viewport safety and inert zero-area hiding at that boundary, while requiring visibility at its large viewports. Platform-specific font/layout metrics are not a fixed News breakpoint. Existing `test:homepage-core` caller; per-viewport raw geometry attached before assertions.

- Run34776760807: final EN visibility resume contained two own rVFC frames
  within the deadline, but delayed delivery during a later seek discarded the
  second frame; repeated seek invalidation erased the prior resume evidence.
  `homepage-hero-native-probe.js` classifies compositor presentationTime and PTS,
  retires pause/source callback registrations, and pins frame pairs to the action.
  Resume proof is retained; separate current/loop proof requires new output after
  an observed seek. Both bfcache and final visibility resume retain a subsequent
  loop window with the unchanged absolute bound. `homepage-hero-state.spec.js`
  feeds original raw A/B metadata through the actual lower classifier, rejects
  stale source/epoch/presentation, frozen PTS, seek-only and expired callbacks.
  Existing `test:homepage-functional` / Carousel callers execute these controls;
  `test:homepage-webkit` executes native EN/DE lifecycle and pause controls.
  rVFC timing semantics: https://wicg.github.io/video-rvfc/. Local/replay success
  does not explain historical multi-second CI output gaps or replace native CI.

### Admin workspace presentation (2026-09-15)

The existing twenty destinations retain their hashes and guarded modules. Section
search must reveal a collapsed matching group before keyboard focus; a repeated
Help alias must reopen its real disclosure target. Existing shell/workflow tests
exercise both, mobile close/focus, drafts across navigation, and real form/dialog
bindings. General guidance uses the existing Help panel; focused News/Hero tests
open native disclosures before their unchanged guarded actions. Callers:
`test:auth` (including `oma2-q3-*`) and the existing static Playwright runner in
Chromium/WebKit. The complete redesign selects `impact-v1` Auth + static, not
`admin-reader-v1` or Fast UI. Local synthetic browser evidence is not live access
or hosted CI acceptance.

The Hero upload UI fixture also passed Playwright's Request argument as MP4 bytes;
its route now explicitly forwards only `route`. It checks two real poster captures
at 0.2/0.4s and multipart output. The unchanged helper's detached zero-time
metadata-only WebKit decode limit is separately reproduced; this presentation
change does not claim to repair it or change production media processing.


The subsequent Admin release exposed three remaining legacy presentation assertions
and cold AI/Fable controls accepting clicks before lazy event binding. The existing
Auth spec now checks compact News guidance plus its real Help disclosure, the
intentionally hidden decorative mood, and all five groups with exact destinations
and independent keyboard operation. Static AI/Fable controls start disabled and
are enabled by their own module after binding, independently of the other module.
`oma2-q3-shell.spec.js` holds each actual module response and records a real early
pointer click (old code loses it), then verifies usable controls and navigation;
existing cancellation and late-transcript cases retain output/context protection.
Caller: the regular `npm run test:auth` selection through `playwright.config.js`,
including the complete selected collection, not only a private focused harness.

## Generate Lab presentation and retained input context

The Lab uses one composing surface and a separate result/library surface, with
the existing Magenta/Cyan/Gold mode variables. Native image selection replaces
duplicate image cards; registry-backed Help retains model details. Original
field wrappers, busy scope, save identities and private job handling remain.
An intentionally empty Assets dialog description must be remembered by attribute
presence, not truthiness, or picker guidance leaks into normal browsing. Reference
copy follows the selected registry limit; narrow headers must not overlap actions.
Existing `smoke.spec.js` journeys cover picker Apply/Cancel → ordinary library,
EN/DE keyboard/reflow and lyrics/instrumental states; `oma2-q1-member.spec.js`
retains immutable saves, retry and durable acceptance. Pricing and locale checks
remain in their existing specs. Real CI callers are `test:homepage-core` and
`test:auth`; the four exact Lab UI inputs select those via `impact-v1`, not native
homepage media or the narrower `workspace-help-v1`. Shared/unknown changes keep
their own coverage. `test:ci-selection` checks this distinction and required jobs.
Local focused Chromium/WebKit execution and synthetic visual evidence do not
claim hosted CI, live private access or provider/decoder acceptance.

### Canvas administrator execution and image persistence (2026-09-17)

Release follow-up: run 35249186783 exposed a stale music-lyrics assertion after the shared text mapper gained `text_output_empty` (HTTP 502). The existing music failure case now distinguishes empty lyrics from genuine `upstream_error`, retaining no-debit, reservation, call-count and storage checks; the valid generated-lyrics and Canvas text-schema cases are its countercontrols. The separate SQLite atomicity flake was reproduced by committing the second caller first: the test had reconciled `attempts[1]` regardless of which debit failed. Its existing batch harness now coordinates at the actual debit (after bucket reconciliation), covers both commit orders and asserts the rejected attempt has no debit and stays failed while only the committed attempt reconciles as charged. Production billing is unchanged. Actual callers: `playwright.workers.config.js` with `tests/workers.spec.js` and `tests/rel01/workers.spec.js`, both included by `npm run test:workers`; downstream FFmpeg/native CI evidence is still required, not inferred from these local checks. Historical live model 502/5006 findings remain unresolved.

Canvas previously forced a platform administrator through member handlers, discarded the selected organization and even asserted personal-credit consumption. Role-specific model contracts now reuse Admin text platform budgets and priced Admin-image organization billing with existing MFA, membership, switches, caps and signed service callers. The exact organization/model/options participate in the run fingerprint. Members retain personal credits. A persisted owner-bound image reference and run-derived image ID permit save-only retries without regeneration/debit; missing checkpoints or expired references fail closed. The existing 30-minute reference lifetime and the provider-to-checkpoint crash window remain explicit limits, not a new durable orchestration guarantee. Dev stays blocked for missing durable persistence/replay; Grok stays blocked for its unadapted source/multi-image contract. Qwen is Admin-only. Empty/reasoning-only/token-limited text has safe distinct errors; historical live 502/5006 causes remain unproven.

Callers: `playwright.workers.config.js tests/workers.spec.js --grep 'Canvas|canvas' --retries=0`; existing Admin save/provider/budget cases; `npm run test:q3-integration`; both Canvas specs in `playwright.config.js` Chromium/WebKit. `node scripts/test-q2-runtime.mjs --suite canvas` uses the existing isolated native launcher (and is included in its default CI plan), with real Auth/D1/R2/Images and synthetic AI service replies. Countercontrols cover missing MFA/budget/org/credits, foreign owner, exact replay, changed organization, failed provider, native save interruption/concurrent retry, lost checkpoint and missing temporary image. A committed-insert/lost-response countercontrol also proves that cleanup preserves the committed original and continues derivative handoff. Launcher tests cover child admission/staging/report retention; macOS execution is not Linux CI acceptance. `test:ci-selection` maps this exact shared contract to Canvas/Auth/Workers, not decorative media; `test:release-plan` retains its Auth deployment dependency. Release-plan scripts use their existing mandatory early contract/safety tests; unknown automation remains broad. Final evidence is local-only; no live provider health or production activation claimed.

### Canvas last-frame / Admin-only PixVerse extension (18 September 2026)

The old generic video capability rejected every video→video edge. The reviewed local prototype offered native Extend in Canvas; the owner's scope correction restricts it to Admin, even when Canvas is used by an administrator. Canvas now automatically prepares its only allowed method, a private owner/source-version-bound decoded final frame, and normalizes saved Extend choices without inference. Stored/manipulated Extend runs fail before upload/jobs/credits. Normal Cloudflare image input uses existing durable member jobs, one credit debit and original run identity; a lost Canvas checkpoint is recovered by that identity.

Admin AI Lab reuses its existing video picker, protected job endpoint, MFA/CSRF, platform budget, queue/dispatch fence, result ingestion and Save to Folder. Optional secret presence is shown without a key or live-health claim; unavailable direct access never falls back to Cloudflare. Lost direct submission responses become the existing unknown-outcome review state after lease expiry, without a second paid call. No new orchestration or schema.

Executable countercontrols: `tests/canvas.spec.js` via Chromium/`webkit-canvas` (native final-frame pixels, automatic EN/DE preparation, old choice/reload/source identity, private preview, abort/error and one run); `tests/auth-admin.spec.js --grep 'Admin PixVerse direct'` uses worker-scoped Chromium/WebKit fixtures in the existing Auth caller (configured/unconfigured, exact owned source/payload, return to Cloudflare), plus the existing Grok-operation neighbor. `tests/helpers/canvas-video-control.mjs` executes via `tests/workers.spec.js` and the existing isolated `--suite canvas` native runner: both-role Canvas denial, member-route spoofing denial, actual last-frame input/one debit/checkpoint recovery; Admin role/MFA/CSRF/key/budget/ownership denial, upload bytes/V6 schema, success/failure/lost response, private ingest and one platform event. Selection and Auth deployment dependencies remain checked by `test:ci-selection`/`test:release-plan`. Mac workerd is not Linux CI; synthetic direct results are not a live account or provider acceptance. Limits and real callers are recorded in `CANVAS_VIDEO_INPUT.md`.

Linux run 35361147923 passed 1,297 route cases but seven native suites failed at Control build: the standard control's `canvas-video-control.mjs` import was absent from the staging allowlist. The existing closure test covered only named alternative controls. The staged native reproduction then passed six Canvas cases and exposed the likewise missing `canvas-end-frame.mp4` fixture. The allowlist now includes exactly this helper and fixture; `node --test tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs` resolves the standard control too, builds it from the actual staged tree, verifies the native video fixture bytes and rejects removal of the helper. CI calls this self-test before native execution. A staged macOS Canvas run checks the same inputs with local bindings; it does not replace the required Linux namespace/runtime acceptance. No product or isolation boundary changed.


Canvas accepted-video status / missing provider receipt (2026-09-18): clearing the request spinner discarded the accepted run, and the inspector ignored durable jobs; poll errors were transient toasts. Acceptance now returns the existing run/key/job identity, reload joins its actual job phase, and the shared inspector/node/history preserve processing and review-required states. Read observation expiry is not cancellation or permission to regenerate. Phase updates retain focused draft inputs. The provider intent still fences duplicate inference; content-free invocation/return/receipt checkpoints and specific video errors distinguish an interrupted call from receipt persistence failure. No missing historical receipt is reconstructed or treated as provider acceptance. Existing `tests/canvas.spec.js` (Chromium/`webkit-canvas`, `test:homepage-core`) covers EN/DE acceptance, selection/reload, simulated 120-read exhaustion, terminal errors and the original key. `tests/helpers/canvas-video-control.mjs` runs through `tests/workers.spec.js` and the native `--suite canvas` caller: lost response and failed receipt write keep one provider invocation, one job, no debit/refund, and unknown review state; successful private ingestion/replay remains covered. Local SQLite and macOS workerd evidence do not certify Linux CI or paid provider behavior. First-attempt live interruption remains unproven without its invocation/return/receipt telemetry.

### Canvas private video completion and historical export (2026-09-18)

First clips previously bypassed durable poster handling; Canvas retained frozen
preview snapshots. All video starts now use the existing queue; backend completion
attaches the owned run and readers refresh poster state. New private postprocessing
uses historical Last-Frame provenance and the existing FFmpeg transport, with
claim fencing, stable identity and saved-video recovery before reprocessing.
Countercontrols: foreign/missing/version-changed/cyclic sources, duplicate requests
and claims, lost completion, poster failure/retry, no second inference/debit.
Callers: focused `tests/workers.spec.js`; native `test-q2-runtime.mjs --suite canvas`
(including staged helpers); `test:homepage-ffmpeg-processor` real 2/5-clip media;
`test:homepage-core` → Canvas EN/DE Chromium/webkit-canvas export/reload cases.
The existing protected release job verifies candidate archives before schema/Auth
and active-version receipt before frontend. `test:release-plan` and
`test:static-deploy-safety` exercise scope, identity and failure-stop controls.
Local native results are not Linux CI or live processor acceptance; those remain
separate release evidence. No paid generation is used for these checks.

Linux run35389905932 passed 1,301 Worker routes, then could not start FFmpeg;
the full `test:workers` caller had no media-tool installation. Its existing
Worker job now installs Ubuntu ffmpeg and verifies both ffmpeg/ffprobe before
execution. `test:static-deploy-safety` → `test-pages-workflow.mjs` rejects missing
setup and exercises the real selection expression and shell order/fail-fast.
Narrow status/assets jobs remain unchanged. Shell controls are not Linux media
acceptance: the real 2/5-clip test and subsequent native runtime remain CI gates.


### Private media dispatch and backend assignment (2026-09-19)
Private exports/posters previously depended on the public 600-second dispatcher
cooldown and cron. Durable acceptance now wakes the existing video queue;
atomic start fencing and finish/recheck cover duplicate delivery, lost response,
crash and new work after a claim. Migration 0089 pins backend per job; completion,
source and poster routes enforce it. Native `test:q2-runtime -- --suite canvas`
executes the actual queue/fetch/D1 path, including Admin/MFA denials, persistent
switching, cross-backend denial, stale token, poster retry and saved-result reuse.
Both native Linux staging lists include the new helper/imports.
Run35431293437 passed 1301 route cases and FFmpeg but stopped at the launcher
self-test: it mistook the preceding media-image upload for native evidence.
The existing launcher/staging test now uniquely identifies the native step and
artifact in both normal and Full callers, then checks its path and runner context.
An unrelated preceding upload passes; missing/duplicate native identity, wrong
path and pre-runner context fail. Caller: `node --test tests/q2-recovery-staging.test.mjs scripts/test-q2-runtime-launcher.mjs`
inside `test:q2-runtime`; neither upload ordering nor native acceptance is bypassed.
Run35574133948 exposed a second fixture assumption: global first/last environment
removal targeted the added repair-smoke step instead of the actual Worker caller.
The same negative control now locates each unique preflight/Worker execution step
inside its job before removing its artifact environment. Both callers must reject
the mutation; unrelated steps and the production guard remain unchanged.
`test:homepage-ffmpeg-processor` and the selected existing Worker job's
`private-media-image.mjs` run shared FFmpeg tests; the latter kills/restarts the
real Container HTTP/child process in the immutable Linux image. `test:auth` runs
Admin service tests in Chromium/WebKit with synthetic responses (not live E2E).
Run35428306333 stopped before those tests: the homepage-selection self-test still
required Chromium-only installation for generic Auth. The private-media cases
explicitly launch WebKit even under `test:auth --project=chromium`; keep both
engines installed. `test:homepage-selection` now executes the actual normal/Fast
workflow installation branches with a harmless `npx` recorder, checks exact
browser sets and install-failure propagation, and rejects the old normal branch.
Fast UI remains Chromium-only without homepage; its scope excludes Admin.
Real `test:auth --list` discovery binds the four service cases to that caller;
discovery and shell countercontrols do not replace selected Linux/browser CI.
`test:release-plan`/`test:static-deploy-safety` exercise schema/image/Auth/smoke
order, missing evidence, source attempts, image identity and failure stops.
Deploy-only retry cannot skip backend work or synthesize dependency completion.
Local green remains distinct from CI, account provisioning and live smoke;
only the protected publication's durable MP4/poster checks establish the latter.

### Private media container idle lifecycle (2026-09-19)
The production actor remained running after all jobs/leases finished: SDK 0.3.7
keeps `containerFetch` in-flight until the response body drains. `deliver` now
consumes success/error acknowledgements. Idle health is consumed and validated;
busy processing, queued activation or unknown health never permits termination.
The health/stop/exit boundary excludes new wake events; a previous source SHA
may retire safely after finishing, without interrupting its child.
`node scripts/test-private-media-lifecycle.mjs` executes the pinned SDK's stream
accounting/alarm and production subclass with simulated platform transport. Its
old-path control remains non-idle after three simulated hours; corrected paths
cover busy/queued work, errors, previous version and concurrent wake during exit.
The existing Worker CI job calls it only for the exact actor/test + release-tooling
scope; Auth/processor/config/dependency/unknown changes retain broader selection.
The tested Linux image and release/candidate checks remain required. This local
SDK control is not Cloudflare acceptance: the protected publisher records actual
platform stop → wake → durable synthetic videos/posters → stop, failing on unknown,
abnormal or stuck state. No AI request, user setting, concurrency limit or schema
change is involved. Production timestamps belong to the activation receipt.

The first idle-fix release (35449579589/1) activated the exact Media Worker,
but checked the application image before Cloudflare's asynchronous rollout
converged. Auth/frontend had not advanced. The publisher now bounds its image
convergence check while rechecking exact Worker identity, traffic, namespace
and limits; a stuck or wrong deployment still fails. A partially completed
same-source/image activation skips another Worker deployment after artifact
verification. Existing `test:release-plan` exercises delayed/permanent mismatch,
identity/traffic/binding/limit failures and the resumed activation order. A failed
write may resume only its deploy job with the original accepted candidate;
completed functional suites and immutable image archives are not rebuilt.

Run 35509493844 exposed a separate false negative: the application **list**
retained the old image after its referenced rollout completed. `mediaActive`
now verifies the current rollout's exact target/version, completed 100%
distribution, application detail and singleton image assignment, then fences
rollout/Worker replacement during readback. It never searches historical
successes. Initial creation without a rollout remains supported; assignment
does not replace the subsequent real stop/wake/process/stop smoke acceptance.
`npm run test:release-plan` (local and `static.yml` release-compatibility) replays
this shape and rejects incomplete/foreign/stale/missing evidence, wrong
accounts/limits/traffic and superseded reads under the unchanged finite deadline.
Private current API snapshots reproduce the old failure and corrected acceptance;
they establish assignment only, not completed Auth/frontend activation.

Attempt 2 then exited from Auth `wrangler deploy` after version activation.
The wrapper discarded stdout/stderr; the original API error cannot be recovered
from that job. Independent readback confirms the expected bundle bytes, API route,
all three consumers, cron and disabled subdomain. Do not infer denied permissions
from a partial audit window. The old command rewrote unchanged routes despite the
documented read-only route contract. Auth now uses version upload/activation and
checks unchanged triggers before/after, including when resuming an active SHA;
independent downloaded module bytes must match the local pinned build. Unknown
or mismatched state blocks before synthetic work/frontend publication.
`test:release-plan` covers changed/missing triggers and bundle, denied reads,
upload/identity/activation/supersession failures and safe command diagnostics.
`test:static-deploy-safety` calls the workflow regression proving failed-job
diagnostics are retained while failed backend gates still prohibit publication.
The exact underlying discarded API error remains unconfirmed; this repair does
not assert a token-rights change or a new production lifecycle pass.

### Canvas Grok one-shot reasoning and ordered activation (2026-09-19)

Grok existed only in private chat; generic Canvas text pricing would charge one credit without accounting for reasoning. Canvas now shares Grok's low/medium/high limits (medium default), supplies only prompt/system text, and uses the existing member reservation/replay or Admin platform-budget path. The conservative text estimate includes UTF-8 input/protocol allowance, the combined answer/reasoning token ceiling, published $2/$6 per-million rates and Cloudflare Unified Billing's 5% funding fee, followed by the existing 20% margin, exchange rate, cheapest active pack value and ceiling. This preserves the existing estimated-upper-bound charging rule; it is not actual-token settlement. Sources: https://docs.x.ai/developers/models/grok-4.6 and https://developers.cloudflare.com/ai-gateway/features/unified-billing/ (checked 2026-09-19).

`static.yml`'s existing Worker job executes the Canvas/text route cases, Grok chat regression, relevant Fable neighbors and isolated `test-q2-runtime.mjs --suite canvas`. The browser job executes both existing Canvas specs in Chromium/WebKit on the exact candidate; discovery/result comparison rejects missing, skipped or failed cases. New tests cover persisted reasoning in EN/DE desktop/mobile, connected input and saved output, role billing, disabled model, insufficient credits, changed-key payload conflicts and unknown outcome replay. The closed Canvas-text selection retains broad fallback for other runtime/security/billing inputs. `test:ci-selection`, `test:static-deploy-safety` and `test:release-plan` cover the real selectors, command failure propagation, immutable candidate and AI→Auth ordering. AI code/bindings/100% active version are verified before dependent Auth; unchanged media source identity is retained. No new migration, provider account, chat persona, tool, queue or billing system. Native macOS evidence is not Linux or live provider evidence; actual activation and bounded live generation remain separately verified release outcomes.

### Canvas text purpose and compact Inspector (2026-09-19)

Canvas text nodes now select image prompt, video prompt or song lyrics. The shared Canvas contract supplies server-owned deliverable-only instructions to every existing text adapter, estimation and the existing generation fingerprint; no chat behavior or billing policy changes. Old system text remains stored but is not used for new purpose-based runs; missing purpose defaults to image prompt, invalid purpose rejects before dispatch. Existing outputs remain unchanged. Inspector retains editable Prompt, connected input/validation and a plain credit estimate; contextual explanations use the existing Canvas-only Help section.

Actual callers: the existing `canvasText` Worker selection executes `tests/workers.spec.js` (all text adapter purposes, lyric structure, both billing roles, replay/change conflicts and failures); `test-q2-runtime.mjs --suite canvas` verifies native D1 purpose persistence, billing and no duplicate dispatch. Both existing Canvas browser suites remain required in Chromium/WebKit; the changed cases verify EN/DE desktop/mobile persistence, estimates, connected input, removal of obsolete editors/copy and Canvas-only Help without leaking into Pricing. `test:ci-selection` covers the complete closed Canvas/help delta and broad fallback for unrelated auth/unknown inputs. Only Auth and the tested frontend need publication; unchanged AI, media, schema, queues and pricing remain intact. Synthetic provider responses prove request/output handling, not guaranteed model compliance or a live generation.


### Canvas private media, explicit promotion and Grok Image 2 (2026-09-19)

The Inspector confused the payer with consumption (Admin estimates were zero), hid supported video resolution controls, and replaced connected image text instead of supplementing it. Shared central pricing/composition now drives both sides; the existing Inspector retains persisted purpose/reasoning and offers collapsed Additional prompt plus explicit Save to Assets. New media is registered by the atomic Canvas run, privately stored using existing writers and excluded from Assets/folder counts until an owner-bound, atomic promotion. Migration 0090 affects only newly registered outputs: legacy/imported and combined full videos keep their permanent lifetime. Deleted producers are reclaimed by existing managed deletion/cron only after live references, writers, derivatives and full-video processing clear. Exact byte cleanup, quota release and tombstones fence save/delete, late completion and duplicate delivery; held managed R2 receipts retry when their last reference clears. D1 counts tombstone trigger writes in delete metadata, so image deletion confirms source absence instead of rejecting a successful two-write deletion.

Grok Imagine Image 2.0 uses the shared member/Admin/Canvas catalogs: low/medium, 1k/2k, at most five additional images, one URL/data-URI output. Published provider output rates ($0.04/$0.06/$0.06/$0.08), $0.01 per input image and Cloudflare Unified Billing's 5% funding cost pass through existing margin/FX/pack/rounding, reservation and replay accounting. Sources: https://developers.cloudflare.com/ai/models/xai/grok-imagine-image-2.0/ and https://docs.x.ai/developers/models/grok-imagine-image-2.0 (checked 2026-09-19). No chat/provider duplication or new paid healthcheck.

Real callers: existing canvasText selection in static.yml executes Canvas/text/image/Assets/folder/readiness route cases, Grok chat/Fable neighbors, Q2 lifecycle, and isolated native canvas + member-generation suites. Native D1/R2 cases cover hidden/persistent outputs, owner/foreign save, idempotent promotion, both save/delete orders, earlier and late runs, image derivatives, audio, live references/deferred reclamation, quota and full-video retention. Existing Canvas specs plus tagged Admin/Generate Lab cases execute Chromium/WebKit against the candidate with discovery/result matching. Required release/selector/launcher/candidate checks remain fail-closed; schema 0090 → AI → Auth → same tested frontend, unchanged media service. Local macOS native/synthetic evidence is not Linux CI, live provider compliance or production activation.

Run 35466797029 stopped before candidate creation: the expanded WebKit project was still compared with the old two-file homepage-core contract. Local browser/candidate checks had passed, but the required `npm run test:homepage-selection` had been omitted. The project file set and the npm caller's intersection are now explicit: homepage-core includes tagged WebKit smoke coverage, not Admin. That same existing self-test executes real discovery from the npm caller and the exact Canvas CI line, checks discovery/execution argument parity, both engines and all four release files, and retains rejection of missing, extra or skipped cases. `npm run check:homepage-selection` checks the wider discovery union; neither discovery certifies execution. Candidate verification still requires new successful Worker/browser evidence and exact build identity; the failed run has no reusable artifact. No product or deployment gate changed in this repair.

### Generate Lab payer context, Grok video inputs and independent previews (2026-09-20)

Generate Lab previously rejected an authenticated Admin without an organization and returned no usable balance. It now retains Admin identity and uses the existing charged personal-credit context (not platform-budget units), with authoritative quota refresh. The native member-generation caller derives coverage from the actual Generate Lab catalog; it checks every exposed model, both Grok Generate aliases and rejection of the four held Edit/Extend combinations, insufficient Admin credits, one debit, failure/unknown outcomes, ownership and replay. The generic no-context Admin guard remains. Existing provider source inventory now includes the durable member executor and Grok text helper; unknown sources remain failures.

Both exact Cloudflare Grok video aliases share the documented input serializer, not tariffs. Owned image/video/reference selection, persisted Canvas edit/extend/size and source-version checks preserve native audio bytes and avoid appending an already included source segment during full-video assembly. Additive 0092 pins accepted sources through existing R2 reference fences, including owner deletion, and makes terminal job capabilities unusable. Native populated migration/rollback, immutable source identity, retired-source rejection and lifecycle tests cover the storage boundary. Four native Canvas cases now verify that held Edit/Extend settings remain stored but cannot queue/debit; lower serializer/source-capability fixtures retain the prepared operation support. The last-frame competing-image rejection remains. Existing accepted Admin jobs without snapshots retain their original owner-checked source path; explicit new empty snapshots and terminal jobs fail closed. Preview output rates were owner-verified from the authenticated Cloudflare dashboard on 2026-09-20 (480p $0.08/s, 720p $0.14/s); the base model keeps $0.05/s. Unified Billing acquisition cost is included once before the central cost/0.8 target margin, FX, net credit valuation and ceiling. **Operation billing acceptance remains open:** the inherited duration-only calculator does not establish Edit source-duration or Extend billable-length/input charges. Synthetic provider tests are not tariff evidence. New Edit/Extend admissions are explicitly unavailable in the shared capability contract until exact-route quantities/input charges are verified; no new call or debit is allowed. Existing accepted jobs and stored settings remain compatible.

The old processor choice coupled assembly and private posters; public Hero/Stream work dispatched only GitHub. Additive 0091 freezes accepted backends and this installation's GitHub default. Independent thumbnail selection uses the existing FFmpeg runner, queue, container, leases, audit and bounded recovery. Valid posters survive; late callbacks cannot cross processors or resurrect deleted sources. The protected release verifies fixed private outputs plus Hero/source-poster outputs, independent container stop/wake/stop, and then activates Cloudflare thumbnails while retaining assembly preference. No public Hero slot is changed by smoke fixtures. Stream protocol is tested natively; configured credentials alone are not a live Stream processing pass.

Actual callers: static.yml canvasText selection runs the selected Worker route neighbors, pricing/policy checks, isolated native canvas + member-generation + q4-stream suites, FFmpeg/Linux image and SDK lifecycle tests, and both Canvas specs plus tagged Admin/Generate Lab cases in Chromium/WebKit against candidate bytes. Exact `npm run test:homepage-selection` checks real shared caller discovery, not execution. Selector/launcher/staging/report/candidate tests retain unknown-input, zero-case, missing/failed proof and wrong-artifact rejection. Deployment order is 0091/0092 → changed AI/media → Auth → exact tested frontend; no current local evidence is a Linux CI or production activation claim.

Bounded live route probes (2026-09-20) rejected before output because the configured ZDR team requires `output.upload_url` (Cloudflare 7003). This is an actual Generate prerequisite as well as an Edit probe failure, not evidence of Edit/Extend billing. The existing durable job now registers a private HMAC PUT destination in its managed R2 receipt before submission. Correct owner/model/job identity, active status, immutable bytes, terminal rejection and retirement racing PUT are verified through the real native Worker endpoint; missing uploads cannot fall back to another file. Member/Admin ingest uses those bytes and existing accounting/cleanup. The output capability cannot read media. Auth invocation URL logs are disabled with protected pre-activation readback; Grok Gateway `collectLog:false` excludes signed source/output URLs. No token, prompt or private media enters new diagnostics. Sources: https://docs.x.ai/build/settings/zdr-video-storage and https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/ (protocol/privacy only, not CF operation tariffs).

Real countercontrols: `test-q2-runtime.mjs --suite canvas` (Admin upload/MFA/platform charge, replay, retirement race), `--suite member-generation` (all Generate Lab models, charged Admin personal balance, forged/overwritten uploads and retained lifecycle), existing Grok Worker tests and tagged EN/DE Chromium/WebKit Generate Lab/Canvas cases. The existing launcher self-test executes every selected shell command including the three cost checks and proves fail-fast at each; canonical private-HOME temporary paths preserve macOS set-ID/path controls. Local checks do not replace the new required Linux/candidate acceptance or authenticated production billing verification.

Final-source correction (run 35506674207): the Canvas catalog contract still classified Grok Video 1.5 Preview as disabled and required its obsolete Assets Manager explanation after Generate was enabled. The previous local Grok-name grep omitted this test; CI's actual `Canvas|...` selection included it. The existing case now positively checks both Generate aliases, member/Admin credit context, exact available-vs-supported operations, retained held settings, and real pre-reservation Edit/Extend rejection. Genuinely disabled models remain asserted. Red/green control and the entire existing selected Worker shell are executed from final source; catalog changes require their consuming Canvas contract, not only provider-named tests. A successful build artifact cannot replace skipped downstream native/Linux/browser acceptance. No product, selection or release gate changes in this correction.

Browser continuation correction (run 35507601764): legacy PixVerse `extend` fixtures contradicted the deliberate no-silent-conversion guard; a resolver assertion and Admin Preview UI case also expected native operations despite the real Generate-only billing allowlist. Existing Canvas matrix/EN-DE journeys now distinguish fresh automatic last-frame input, matching saved unavailable operations, explicit recovery (one upload, reload reuse, one run), and model/source/run provenance invalidation. Real catalogs stay gated; only an explicitly synthetic capability tests multi-method resolution. Accessible combobox queries replace the vacuous `select[data-video-method]` absence check. Admin tests retain exact Generate payload and lower Edit/Extend serialization while requiring hidden/disabled options and server admission rejection. A generic EN/DE unavailable-model notice avoids attributing unsupported PixVerse operations to billing. Caller: static.yml's exact Canvas/model discovery and execution (`npm run test:static -- tests/canvas.spec.js tests/oma2-q1-canvas.spec.js tests/auth-admin.spec.js tests/smoke.spec.js --grep 'Canvas|P13|@canvas-model-ui' --output=test-results/canvas-artifacts --retries=0 --reporter=list,json`), followed by the unchanged candidate report verifier. Focused name filters alone did not establish this full consuming contract; no capability, pricing or selection gate was changed.

The integrated browser check also exposed a fixture ordering race: Admin Preview's custom media-source route was installed after navigation, allowing the generic initial response to populate the valid picker cache. Install scenario responses before navigation; keep exact expected source identity/payload and production caching unchanged. No sleeps, retries or timeout changes.


### MiniMax H3 and durable Generate Lab status (2026-09-20)

Generate Lab duplicated accepted status below the form, used a PixVerse-only loading label and treated interrupted observation as failed output. Its existing upper banner now distinguishes submission, accepted processing, reconciliation, storage and preview completion. Only durable acceptance permits the close-tab message. Frozen submitted identity and owner-scoped GET-only restoration prevent selector/stale callbacks from relabelling or resubmitting a job.

H3 uses the exact Cloudflare input/task schema, ordered owned image/video/audio roles, bounded original-byte validation and the existing durable jobs/R2/processor. HMAC job-bound callbacks (including the documented challenge) preserve task identity and terminal receipts; no invented polling endpoint or repeat inference. Reference snapshots retain input lifetime and revoke completed capabilities. Output-second tariffs are owner-confirmed Cloudflare rates: 768P/default $0.08, 2K $0.13; central cost/0.8, currency conversion, net-credit value and rounding apply. Input/total counters are not billable output. Actual output usage settles within the original reservation; missing/contradictory usage preserves the result for reconciliation, not a guessed debit. Existing Grok operation gates and payer boundaries remain. No schema/container change is required; changed AI precedes Auth, then the tested frontend.

Countercontrols/callers: existing selected Worker Canvas/model cases cover role limits, settings, adapter states, private Gateway logging and pricing; native `--suite member-generation` covers forged/duplicate/foreign callbacks, original reference bytes/ownership, callback-only resume, no polling/retry exhaustion, output debit and restored result; native `--suite canvas` covers Admin MFA/platform settlement and unchanged storage/assembly lifecycle. Existing Canvas specs plus tagged Admin/Generate Lab cases run Chromium/WebKit via static.yml canvasText selection, including EN/DE roles, persisted controls, submission/acceptance, interrupted observation and reload. Final `test:homepage-selection` validates real discovery; it is not execution or live billing evidence. Sources: https://developers.cloudflare.com/ai/models/minimax/h3/schema-input.json and schema-output.json; linked H3 reference/callback documentation.

### H3 Canvas predecessor-frame continuation (2026-09-20)

H3 bypassed the shared video-input resolver/preparation and immutable `connected_video_inputs`, so a connected video could only be a whole-video reference. The existing edge method now offers explicit last-frame preparation alongside the unchanged reference default. The decoded predecessor frame is a private image mapped to H3 `first_frame`; a separately selected image may remain the target `last_frame`. Existing frame/reference-mode and adaptive-ratio validation still applies. Whole-video references never become assembly parents. Preparation pins the original version before decode and rejects replacement before upload; run admission rechecks ownership, existence, version and frame association. No inference is made during preparation, and no provider, pricing, schema or processor change is required.

Countercontrols/real callers: `tests/canvas.spec.js` runs EN/DE choices, reload, actual final decoded pixels and private preparation in Chromium/WebKit. Native `test-q2-runtime.mjs --suite canvas` exercises actual D1/R2 admission, first/end-frame provider bytes, foreign/deleted/replaced sources, no preparation debit, replay and immutable two-clip assembly versus reference-only ancestry. Existing full-video/poster and lifecycle checks remain. Static workflow's closed `canvasText` caller selects these when the video adapter changes without a catalog edit; selector negatives keep unknown/security/shared-runtime changes broad. Auth precedes the exact tested frontend; unchanged AI/media/container and schema need no deployment.

### H3 whole-video encoder overrun (2026-09-20)

A nominal 15-second generated H3 original contained 362 frames at 24 fps (15.083333 s). The shared byte inspector correctly rejected the actual over-limit reference but exposed only a generic error. A server-proven H3 15-second generation with at most two extra frames now receives a private, independently measured FFmpeg derivative through the existing pinned media backend, dispatcher, processor and managed R2 cleanup. Original bytes/audio and the selected whole-video role remain unchanged; no last-frame substitution, metadata rounding or inference during preparation. Unproven uploads, genuinely long clips and aggregate limits still reject with EN/DE feedback. Actual presentation timing includes composition offsets and audio encoder-delay edits.

Additive 0093 binds source/version/output identity, finite claims, active consumers, cleanup and quota. Provider dispatch waits for validated derivative readiness; retries reuse the same bytes after lost completion responses. The native Admin countercheck exposed premature `create_attempted` marking: resumption was suppressed as a duplicate without any provider call. Mark the attempt only after source preparation, retaining the dispatch claim and unknown-outcome fences. Actual callers: the existing selected Worker command, native `--suite canvas` (member and Admin prepared bytes/one debit, ownership, changed source, failed preparation/no debit, deletion/consumer fences, quota and managed cleanup), `--suite member-generation`, `--suite q4-stream`, `test:homepage-ffmpeg-processor` (real 336/360/362/366-frame MP4s with audio), and existing tagged Chromium/WebKit Canvas/Admin/Generate Lab cases. No unknown path or broad security change inherits the narrow selection. Protected production media acceptance now checks the same fixed synthetic reference with both processors plus the existing stop/wake/drain/stop evidence; missing, oversized or audio-less reference receipts block frontend continuation. Deploy order: 0093, changed shared processor/container, Auth, runtime acceptance, exact tested frontend; AI and pricing unchanged. Local evidence does not establish Linux CI, live H3 inference or deployment success.

### H3 release-ending Linux reference preparation (2026-09-20)

The pinned FFprobe 5.1.9 reports the committed 362-frame/24fps fixture's MP4 movie duration as 15.084s, while its video track is exactly 362/24s. Comparing the rounded container duration to the two-frame admission limit rejected it before encoding. Reference admission now uses exact track timestamps (including audio); output still must be <=15s, retain audio and original bytes. The Docker image caller now executes the existing reference test against these exact committed bytes plus excessive-track and redacted subprocess-failure controls. Generated-only fixtures had missed both this header difference and the old encoder's early audio termination with `-frames:v`.

The protected smoke reports terminal failure immediately. Its explicit reference retry is limited to the fixed disabled synthetic owner/source digest, failed first attempt, no active lease/reservation/output/tombstone, with atomic stale-token fencing and audit. Existing native Canvas smoke covers retry, duplicate request, old claim, foreign fixture and lease denial; successful unrelated outputs are reused. No migration or inference is involved.

`static.yml`/`select-ci-tests` and the existing candidate/upload/receipt boundaries may reuse an accepted ancestor only for the closed media-repair path set. Original frontend SHA/run/attempt/digests/proofs remain unchanged; new Linux image, native D1/R2 smoke, SDK lifecycle and release/security checks bind the repair SHA. Unknown/product/security input changes reject equivalence. The protected job repairs backend dependencies, recovers only the failed synthetic reference, verifies runtime/idle state and publishes the original tested frontend bytes. CLI archive and actual workflow-condition counterchecks run through existing `test:frontend-hosting`, `test:static-deploy-safety` and `test:release-plan`; no old image is relabelled and no browser suite is silently reported as re-executed.

Run35537162806 exposed inherited `REPAIR_SOURCE_SHA` in the candidate test's temporary Git repository. The previous local check lacked that CI environment. The existing CLI roundtrip now inherits only OS process settings, injects its own synthetic identity and exercises poisoned parent repair/run values plus explicit foreign-identity rejection. `npm run test:static-deploy-safety` verifies record/proof/publish with the real repair environment; production identity validation is unchanged.

### H3 rejected versus uncertain dispatch (2026-09-21)

2026-09-25 REST workaround: Cloudflare support recommends REST after the retained
official input succeeded directly (task 444983054504211) but failed in BITBI
(dispatch ae92d9fd0945a07bab3291db88d83d1c, 400/7003). Source URL, callback and
transport differed; a binding defect and provider non-billing remain unproven.
The durable member/Canvas caller now uses account-scoped Workers AI Read REST,
normalizes the retained double result envelope, and preserves the model callback,
source lifetime, task identity and credit guards. No fallback/retry after ambiguity.
Native fetch uses manual redirects with explicit refusal, as required by the
retained HTTPS-delivery lesson below. Existing selected Worker H3 checks cover
REST/error/credential/response limits; native member-generation crosses workerd
fetch with a stubbed external boundary and real queue/D1/R2/callback/settlement.
Its catalog fixture now supplies GPT Image 2.5's required data URI, not bare
base64; product image behavior is unchanged. Local checks are not provider access.
Run 36144872253/1 stopped at one stale Canvas catalog count (111/112 passed):
the September 22 GPT Image 2.5 addition made 27 models, not 25. The countercheck
now asserts the independent exact ID list and both aliases' runnable state;
all existing authorization/disabled-model assertions remain. The selected 112
Worker checks pass locally; downstream skipped CI checks still require execution.
Run 36147088055/1 then passed the selected Worker/Grok/Fable/lifecycle commands,
but native Canvas exposed a second binding-only H3 fixture. Canvas now crosses
the same isolated workerd REST boundary, retaining signed-byte/role checks and
rejecting H3 binding fallback. Native Canvas43 and member-generation53 pass
locally; no product behavior was changed to accommodate either fixture repair.
The existing protected release job also accepts backend-only candidates without
publishing unchanged frontend bytes; actual gate/failure/resume conditions are
exercised by test-pages-candidate and the Auth-only plan by test-release-plan.
Private execution/release evidence remains in diagnostic-20260923; publication
and one fresh live acceptance must be recorded independently, not inferred here.

Run36148344096/1 subsequently passed and published Auth only. Its single authorized
live REST submission still returned400/7003; no task/output, reservation not debit.
That is not a binding-root-cause or provider non-billing finding. Separately, REST
Gateway controls must use `cf-aig-*` headers, not binding `options.gateway` in the
body: the time-correlated Gateway record had null metadata and retained a request
head. Corrected default Gateway, skip-cache, collect-log and metadata headers;
single attempt/model callback/input remain unchanged. Unit and both native caller
fixtures assert the actual wire headers and exact model/input-only envelope.
Do not claim no payload logging for the first live REST candidate, or replay its
uncertain job to test the correction. Prior media/edge findings remain unchanged.

The durable video wrapper erased every thrown provider cause; the late-error handler also reported failure without proving non-acceptance. H3 now reads response-local Cloudflare request/Gateway IDs with content logging disabled, retains only allowlisted diagnostics, and records a terminal rejection only for documented pre-inference validation codes. HTTP 400 alone remains unknown. The existing receipt CAS fences racing callbacks; replay settles the same reservation without another inference. Failed settlement stays reconciliation, and Canvas reports released credits only after the owned usage row confirms it, including reload. The historical 06:33/06:43 jobs remain untouched: Gateway request/response bodies are unavailable and no independent correlation proves their 400 cause. This correction is not evidence that that live reference failure is repaired.

Actual callers: selected Worker `Canvas MiniMax H3 rejection diagnostics`; native `--suite member-generation` known/unknown rejection, callback race, settlement retry, private status and replay controls; existing `Canvas durable video status` EN/DE in Chromium/WebKit. Selection keeps the existing Canvas/model path and rejects unknown/security neighbors; unchanged container bytes do not require another media image. No schema/provider/pricing change.

### Canvas shared Assets picker (2026-09-21)

Canvas's immediate-assignment, first-page dropdown now hosts the existing Generate Lab saved-assets browser and modal styles. The opt-in folder-first entry preserves Generate Lab's all-assets reference entry. Only explicit confirmation calls the owned Canvas asset-reference API; the existing node-save queue persists a display-only name/preview snapshot. Source URLs and downstream identity remain the API's result. Cancel/loading races, failed assignment, stale node/project identity and late responses cannot produce a success on a different selection. File/text previews no longer fall through to a video element. The existing Generate Lab picker fixture explicitly selects PixVerse for its image-input scenario; H3 becoming the default had invalidated that implicit precondition.

Callers: `playwright.assets.config.js` executes existing Canvas/save-coordination specs and shared cards/Generate Lab picker in Chromium/WebKit. `tests/canvas.spec.js` covers EN/DE, mobile touch, keyboard/cancel, reload, all asset types, denied assignment and stale callbacks using synthetic owned assets. `test:ci-selection` retains the closed member-assets frontend mapping and rejects API/workflow/model/backend/unknown neighbors; candidate proof requires both Canvas files in both engines and exact successful execution matching discovery. No Worker or provider change; ordinary protected static publication consumes the same tested build.

Release follow-up (35628222777): all ten picker cases passed; four durable-image neighbors stopped at an obsolete lower-message assertion. The unchanged Generate Lab renders the localized saved title in `#labWorkflowStatus` and clears `#labMessage`. The existing EN/DE test now requires that visible exact title (not the success tone shared by unsaved output), an empty lower message, exact image, one accepted POST/GET, no browser save, cleared intent and no overflow. The earlier local picker-only run had not executed this neighbor. Selection and candidate recording compare the actual Git versions of the multipurpose member spec: only edits inside this already-executed test body qualify for the closed Assets scope. Shared fixtures, neighboring tests, new declarations, missing source context and unknown runtime inputs retain broader selection. `test:ci-selection` and actual selector/candidate CLI fixtures check both paths; the Assets caller still executes 194 cases in both engines. A diagnostic outside that scope also found older P03 Lab manual-save expectations still targeting the cleared lower message; those unchanged cases remain in the broad Auth caller, not relabelled as passing. Missing/failed cases and foreign candidate bytes still block; the old failed run is not recertified.


### Persisted model tariffs and accepted-job pricing (2026-09-21)

Previously, per-model credit calculators were code-only. Additive migration 0094 stores the immutable factory catalog/formulas, separate exact-configuration retail overrides, revision/CAS audit and source observations. Factory rollout changes no charges. Never modify an applied factory snapshot: a future factory change requires a new version and forward migration; preserve custom rules and accepted pins. Provider-source retrieval is not rate approval. Customer overrides do not change provider costs, explicitly unmetered execution or independent Admin platform caps.

All charged member/organization paths, Admin organization-image admission and Admin reference estimates use the central tariff. Admission pins the revision/rates/units; D1 triggers close quote/edit races. Existing unresolved attempts retain their original reservation. H3 authoritative output-second settlement retains its admitted factory conversion or custom unit rates. Canvas's separate API client must send the revision too; shared auth wrappers alone do not cover it. Stale quotes reject before provider dispatch and refresh the estimate without automatic paid retry.

Actual callers: static.yml model-pricing selection runs the four pricing/SQL cases, selected existing member/org/Admin accounting cases and isolated native `--suite model-pricing`; the existing browser job discovers/executes pricing controls, MFA/access denial, cross-surface estimates, real Canvas/member request headers, conflict and logout fences in Chromium/WebKit against the candidate. Reports are siblings of disposable Playwright artifacts and candidate proof rejects missing/failed/skipped/zero-case execution. Launcher/staging, selector, release-plan and candidate counterchecks retain unknown/security breadth, exact bytes and protected 0094 → AI → Auth → frontend continuation. No media image is selected for unchanged processor inputs. Local macOS workerd acceptance is not Linux CI or production acceptance.

### Global segment appearance and browser-cache authority (2026-09-21)

Global settings use the existing app_settings row and atomic revision/CAS plus Admin audit; public reads expose only safe theme values. Five segments share one route/resolver and semantic paint layer. Defaults remain Dark; personal editing is server-denied. A higher disk-cache revision must not defeat the first confirmed server response, while an older in-flight response must never roll back a newer confirmed save. Page lifecycle aborts are released before resume so an aborted request cannot suppress revalidation. Theme changes update paint only and preserve drafts, Canvas identity and private media.

Actual callers: appearance-v1 in existing static.yml runs focused Worker/SQLite cases, native --suite appearance (Admin/MFA/CSRF, concurrent HTTP writes, audit rollback, durable read/reset and pricing isolation), and the shared appearance/strict navigation browser cases in Chromium/WebKit. The matrix verifies five segments, EN/DE, desktop/mobile, host-overlay inheritance, cache versus authority, bounded first paint, periodic refresh and tab resume without inference. Discovery/results survive runner cleanup; candidate proof rejects missing/failed/skipped/retried cases. Native macOS is not Linux CI. No new schema, permission, media or billing behavior is involved.

### Website roots and unchanged-package release repair (2026-09-22)

The post-Auth deploy checker resolved `/css` and `/js` against the runner filesystem and mixed checkout/candidate HTML. `validate-site-references.mjs` now requires an explicit website root; source uses the build allowlist, candidate validation stands alone and runs before backend publication. The actual workflow CLI regression in `test-pages-workflow.mjs` covers root/nested URLs, version queries, missing files, candidate-missing/source-present and symlink rejection. Caller: `npm run test:static-deploy-safety`.

The existing repair continuation has a distinct closed tooling scope with complete protected Git-tree equality, fresh release checks and authenticated original SHA/run/attempt/archive/proofs. It does not claim new browser/Worker execution. Candidate and frontend-review countercontrols reject changed product/build inputs and invalid repair acceptance. A digest-checked successful backend receipt keeps its original identity and must still match active version, bytes, schema and triggers; a tooling repair never redeploys Auth merely to change its annotation. Caller: static deploy safety and `npm run test:frontend-hosting -- --unit`.

Public appearance acceptance must compare the document actually served by the existing single-hop DACH route. Only the observed empty, hidden same-origin AI Labyrinth link and digest-pinned Cloudflare Insights augmentation may be removed before exact candidate hashing; all other HTML/asset changes and unexpected redirects fail. A locale redirect is recorded as German delivery, never English evidence. Countercontrols run through `test-pages-workflow.mjs` under static deploy safety.

A failure after activation is not a completed publication. The baseline resolver permits reconciliation only after independently matching the original accepted candidate archive, protected failed upload artifact, exact source/run/attempt/package, current 100% version and domains. It retains the previous accepted baseline until the existing protected deploy job verifies the active version without uploading and records a new durable receipt; the old job remains failed. `test-frontend-review.mjs` covers wrong/expired evidence, supersession, unconfirmed activation, unchanged-byte reuse across tooling repairs and durable receipt survival after diagnostic artifact expiry; the publication adapter has a zero-upload countercheck. No Auth redeployment or routing/protection change follows from this verification repair.

### Light component visibility and Soft value propagation (2026-09-22)

Light surfaces alone did not fix pinned white text in Admin model cards, nested
user dialogs and account/legal states; shared accent tokens also darkened actions
that retained dark media-overlay backgrounds. Keep semantic foreground/background
pairs together, without changing media pixels. Soft extends the same validated
five-segment contract, preserving stored Light/Dark values, reset defaults, CAS,
audit and disabled personal overrides; unknown values fail closed.

Countercontrols use the actual `appearance-v1` Worker/native D1 callers and
`oma2-q3-appearance.spec.js` in Chromium/WebKit against `_site`: all three palettes,
Admin save/conflict/failure, propagation/resume, actual catalog controls, decoded
image/poster/video/audio fixtures, measured action/text contrast and retained player
identity. A visible skeleton/container is not proof of readable controls or media.
Ordinary Appearance publication now calls the same strict live verifier as
reconciliation, including tokens.css. `test-pages-workflow.mjs` executes that
publication caller and rejects changed palette bytes, unexpected HTML/redirects
and enabled personal preferences before a success receipt can be returned.

### GPT Image 2.5 adapter, bounded quotes and pending activation (2026-09-22)

Sunburst/Flare reuse the existing image admission and private storage paths. Their
Cloudflare contract uses ordered base64 references and one image URI; legacy GPT
Image 2 options, token tables and reference surcharges are not transferable.
Explicit generation quotes use the official 2.5 output calculator plus a UTF-8
text-token bound, Cloudflare catalog rates and one Unified funding fee. Accepted
quotes remain pinned. Reference editing stays blocked before reservation/dispatch
until its input-image token quantities are evidenced; an override cannot bypass
that guard. No provider inference is used as a health check.

Actual callers: the existing model-pricing CI selection adds the image adapter
spec, legacy image regressions and native Canvas D1/R2 checks; its two-browser
configuration discovers the pricing editor and tagged Admin/Generate Lab/Canvas
cases. Any unpublished Appearance bytes also retain their own browser/native
checks. Unknown security/runtime paths remain outside this closed selection.
Discovery/result identity and optional-block failure propagation are tested in
`test-pages-candidate.mjs`; source-root/candidate-root checks stay before writes.

An ordinary product release can fail public-byte acceptance after activation,
just as a tooling repair can. Read-only historical attribution verifies original
selected jobs, archive/proof digests and the exact protected failed upload while
retaining the last accepted baseline. It does not authorize unchanged-byte reuse
for new product code. `test-frontend-review.mjs` covers ordinary activation with
newer product work, missing proofs, wrong versions and unchanged reuse guards.

Run 35714314642 exposed a Canvas fixture read relative to cwd: the hosted Linux
boundary deliberately starts in `/`, although the PNG was correctly staged.
Canvas now resolves that fixture relative to its module, like its other readers.
The existing launcher self-test executes this reader from `/` and an empty cwd,
checks the staged PNG digest, and rejects the old cwd-relative implementation.
Actual caller: `node --test tests/q2-recovery-staging.test.mjs
scripts/test-q2-runtime-launcher.mjs`. This orchestration countercheck does not
replace the selected hosted `test:q2-runtime -- --suite canvas` or the subsequent
Appearance/native and Chromium/WebKit gates; the failed run provided neither.

### GPT Image 2.5 retained HTTPS delivery (2026-09-22)

Pinned native workerd rejects `fetch(..., {redirect:'error'})` before transport;
Completed HTTPS image receipts therefore survived while ingestion exhausted its
attempts. Data-URI fixtures had missed the queued path. Use manual redirect mode
and reject every redirect explicitly; keep HTTPS, format, byte/decode limits and
safe stage diagnostics. The real AI binding receives the immutable receipt
correlation without discarding existing Gateway metadata. Retained Completed
receipts get at most three delivery-only attempts; no inference re-dispatch.
Released reservations remain released, with a receipt-digest-bound audit instead
of retrospective charging. Migration **0095_retained_image_delivery.sql** keeps
unready assets hidden except exact succeeded, audited image recoveries; missing
audit fields fail closed. Apply it before Auth. AI/shared adapter, Auth and the
exact tested frontend are the only changed deployment units; no media image.

Actual callers: `tests/q2-gpt-image-25.spec.js`, native `--suite canvas` through
`tests/helpers/q2-runtime/canvas.mjs` (real Generate Lab queue, D1/R2/Images,
HTTPS output, transport/truncated body/redirect, released eight-attempt recovery,
owner download, replay, missing audit and deletion), and the existing tagged
`tests/smoke.spec.js` EN/DE Chromium/WebKit cases. Existing model-pricing/image
selection executes these plus charged-role regression; unknown inputs remain
broad. `scripts/test-release-plan.mjs` covers protected receipt/owner/byte checks,
no debit, bounded incomplete rejection and partial-activation reuse. The existing
backend publication captures eligible retained jobs before deployment and checks
cron recovery afterward before allowing the frontend; it invokes no model.
Local success is not hosted Linux or production acceptance. Private originals,
receipt hashes, native failures and final reports remain outside the repository.

Run 35725851650 stopped before Worker/browser acceptance because the Admin
schema label still named 0094. Keep this label aligned with the release manifest
(0095), and run both `test:doc-currentness` and **`check:doc-currentness`** on final
source: fixture tests alone do not check the checkout. The release acceptance
also accepted an empty sample and allowed only 180 seconds before a five-minute
cron. It now requires both exact incident jobs and authenticated input, provider
receipt, result and original bytes; empty, unrelated, duplicate or incomplete
receipt evidence fails. Both jobs share a 39-minute maximum: one cron interval,
three existing ten-minute processing deadlines, two one-minute retry delays and
two minutes for storage/readback. Normal completion returns immediately; terminal
failure of either job aborts promptly. `test:release-plan` exercises this actual
helper with simulated time, missing/foreign evidence, no debit, partial recovery,
supersession and a hard deadline. Production remains the existing protected
backend job; this observer never dispatches work or modifies reservations.

Run 35740462268 passed Worker/native acceptance but WebKit Canvas observed factory
262 instead of the configured 45. Controlled browser reproduction establishes
the shared pricing client's cause: every auth event cleared pricing, including
same-user credit/profile updates, and superseded refresh waiters returned before
their replacement. It does not establish the historical CI event ordering.
Bind pricing to actor/access identity, preserve confirmed snapshots on routine
updates, join current-session refreshes, and fence responses across logout,
denial and actor changes. Existing `oma2-q3-model-pricing.spec.js` covers controlled
/me/pricing order, stale bodies/responses, denial, and the actual EN/DE Canvas
Inspector (45) plus Run revision (1). Its caller is the unchanged 40-case
`CI_IMAGE_MODELS=true` pricing configuration in the static workflow, executed
against `_site`; no new suite or billing/provider change.

### Recovered-image acceptance after backend activation (2026-09-22)

Run 35749416706 activated AI/Auth and recovered both released image jobs, then
its verifier queried nonexistent `ai_images.width,height`. The D1 wrapper
mislabelled SQL400/7500 as a credential failure. Acceptance now selects the real
migrated columns and fully decodes authenticated original bytes with the existing
pinned native decoder; original/result hashes, owner, visibility, immutable
receipt and zero debit remain required. D1 errors expose bounded numeric codes
and a category, never SQL, parameters or arbitrary provider messages.

Real callers: `npm run test:release-plan` executes the acceptance SQL, original
raster and corrupt-image controls, completed recovery replay and protected failed
activation/fresh-receipt identity checks. `test-pages-candidate.mjs` and
`test-frontend-review.mjs` exercise closed tooling equivalence and the actual CI
selector across a publish-only failure; changed product/test bytes or a failed
validation still block reuse. `test-pages-workflow.mjs` requires decoder installation
before the actual caller. Protected continuation recompiles and compares active
AI/Auth bytes, attributes their original protected activation window, verifies
schema and both recovered originals, then records new acceptance without repeating
migration, deployment or recovery. Original candidate SHA/run/attempt/proofs stay
unchanged; fresh backend acceptance is included in the existing durable frontend
receipt. Authenticated D1/R2 readback is not an authenticated browser visibility test.

Run 35756067520 recorded that fresh receipt, then its second read-only
verification lost the fetch operation and nested transport cause behind the generic
`fetch failed` message. Backend receipt reads now retry only bounded transient
transport/service failures and fail with redacted provider, operation, transport
type and safe cause code. Authorization, identity, archive digest and content
failures remain immediate. `test-frontend-review.mjs` exercises recovery, exhausted
transport diagnostics and a non-retried authorization countercontrol through the
actual release helper; `test:static-deploy-safety` remains the final caller.
