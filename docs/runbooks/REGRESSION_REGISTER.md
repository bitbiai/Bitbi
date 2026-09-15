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
