# Repair regression register

Required callers below apply to their selected impact scope; the bounded `admin-reader-v1` policy does not require unrelated decorative media. Keep one row per cause family. A discovered test is not an executed test; a replay is not native acceptance. Link matching final inputs and reports in the private release handoff. The budget hook is deliberately not a complete functional gate. Current decorative Hero acceptance follows [the owner-approved fallback policy](../production-readiness/MAIN_ONLY_RELEASE_RUNBOOK.md#decorative-hero-acceptance); historical decoder findings remain observations, not repaired playback.

| Signature / first retained evidence | Cause and correction | Executable regression / countercontrol | Actual caller and required CI selection | Evidence and boundary |
| --- | --- | --- | --- | --- |
| Website assistant prepublication review, 2026-10-01: malformed durable budget and delayed cleanup | Invalid stored cost values could admit spend; a control-only object could fall through generic limiter cleanup and lose configuration. Validate durable ledger state before admission/settlement and preserve settings independently of metric retention. Runtime mode/revision and spend admission share the existing durable object; restoration cannot reactivate inference or reset counters. | `tests/website-assistant-budget.test.mjs`, `tests/website-assistant-control.test.mjs` and the native `website-assistant` suite cover corrupt/unknown state, stale admission after disable, settings conflict/recovery, cleanup and direct Admin/MFA boundaries. | Existing `test:website-assistant` → `test:workers` and `test:q2-runtime`; Admin/public UI execute in the existing core/default browser callers. | Prepublication defects, no observed production spend or lost settings. Fixtures are synthetic; real model acceptance remains blocked. Release `36907520476/1` at `4472ea0a` stopped before publication because the new guide was missing from the Markdown inventory: classify the exact guide in the existing index/rules and run the actual `check:doc-currentness`, not only guard unit tests. A focused known-guide/unreviewed-neighbor control preserves strict classification. Final-source execution and protected publication evidence are retained in the assistant checkpoint. Release `36908129676/1` at `81d0eb6` then passed Worker/native and homepage acceptance but stopped before publication: the exact Admin menu fixture omitted the authorized assistant destination in both engines; the synthetic WebKit DE chat test typed before Help’s existing initial heading focus. Retain the complete independent nav contract with a wrong-destination countercontrol, and wait for initial focus before typing with delayed-focus/blocked-submit controls. Focused local checks passed (2 navigation; 24 assistant executions, three repetitions, no retries). The existing closed browser-fixture continuation retains unchanged passing cases/upstream evidence, requires fresh changed/failed/flaky cases and the unexecuted carousel tail, and rejects missing coverage or altered product bytes. Old failed artifacts remain failed. Release `36919040626/1` at `db158dfe` passed the fresh Linux acceptance (10 repaired/control cases and 34 carousel cases; five existing engine skips) but publication stopped before mutation: `assertMediaAuthConfig` rejected the newly introduced `WEBSITE_ASSISTANT_ENABLED="false"`. Its old fixture cloned the current config on both sides and missed the absent-to-disabled transition. Admit only that exact disabled value; `scripts/test-media-auth-config.mjs`, retained in the existing release-plan caller, rejects activation, unknown values, switch removal and unrelated config drift. Authenticate and reuse the completed browser proof alongside the original candidate/Worker/homepage evidence for the subsequent deploy-only correction; protected product/test trees must remain unchanged. Cloudflare readback confirmed both active components still at the prior `f3c34ec` publication before retry. Final publication remains pending until verified. |
| Release `36890326317/1`, source `3c54e9b4`: `scripts/test-release-plan.mjs:1138 generic-secret-assignment` | A new synthetic credential/sentinel declaration matched the existing secret rule. The repair ran guard unit tests but omitted the actual repository scan; the installed push hook checked only budgets. Use explicit `test-` fixture values, run the existing secret CLI from `test:quality-gates`, and scan outgoing committed text with the same unchanged CI rules/path policy in the existing hook. | Actual old repository scan reproduced the exact finding; corrected scan passes. Existing bare-remote hook tests reject a committed unmarked value without leaking it or changing the remote, even with a clean working file; accepted fixture successor and dirty-working-file independence pass. Multi-ref, ignored-path parity and text larger than 2 MiB are covered. | `npm run test:quality-gates`, installed `.githooks/pre-push` → `scripts/check-push-quality.mjs`, and the existing independent `Check committed secrets` steps in release/Full. | Confirmed implementation error introduced by this repair, not a leaked production credential. The run failed before Worker/browser validation or deployment; no component was published by `3c54e9b4`. Earlier media repair and native evidence remain separate. Fresh repair source `f3c34ec5` passed release `36891679936/1` and published under durable deployment receipt `6791271433`; 2026-10-01 readback matched frontend version `3d35b69c-0905-4387-aac4-66924fd130d9` and Auth version `0c507fee-956b-4877-874f-c3d1b25c0f7d`. |
| Protected release `36769770146/1`, source `8c0cb42a`: `Private smoke HTTP 409: media_smoke_failed` after Auth/media activation | The smoke collapsed invariant failures to one code; the route and publisher masked it again. Readback proves partial activation and no source-specific synthetic rows. Current fixtures pass admission locally; serving the previous SHA reproduces the same old error. Historical edge propagation is unproven. Add fixed safe invariant codes and an authenticated, write-free source/fixture preflight before seeding. | Actual Worker route controls reject wrong source, credentials, fixtures and output/reference/processor proof; poisoned service bindings prove preflight has no side effects. Publication controls bound stale/legacy admission observation, reject malformed responses, preserve safe diagnostics and never retry mutations. Unchanged-media reuse counterchecks require original protected activation, accepted artifact and unchanged inputs. | Existing `test:release-plan`, `test:q2-runtime -- --suite canvas`, selected Worker/native acceptance, and protected `release-apply.mjs` in `static.yml`; frontend remains gated by fresh backend acceptance. | Original Full `36769800668/1` and all release validation jobs passed; deploy remains failed. Auth/media `8c0cb42a` were active, frontend remained `ff45989c`. Safe private checkpoint retains identities/readback. Local native Canvas passed 84/84; actual-route admission and partial-activation counterchecks passed through `test:release-plan`. Real authenticated GitHub/Cloudflare metadata matched the verifier, and all 19 media inputs matched the original source. Fresh release `36891679936/1` at `f3c34ec5` succeeded with Auth/frontend publication and verified reuse of the unchanged media activation plus fresh smoke. Readback and receipt `6791271433` reconcile the previous partial publication; old failed artifacts remain historical failures. |
| Q3 `ai-lab.js`: 369,320 bytes against 365,000 at `6b833541` | Cohesive Compare extraction; preserve all ten existing budgets. Pre-push validates outgoing Git blobs, not dirty working files. | `scripts/test-quality-gates.mjs`, `scripts/test-pre-push.mjs`: oversized push blocked at a local bare remote; compliant push allowed; clean working copy cannot hide oversized commit. | `npm run test:quality-gates`; `npm run hooks:check` confirms this checkout's activation. Release/quality CI also runs these tests. | Historical red retained. The hook prevents this deterministic violation when installed; it cannot establish browser correctness or protect an unconfigured clone. |
| Q3 save-flow ESM import and MFA panel cleared, run 34067451777 | Browser-only dialog dependency crossed the Node import boundary; MFA fixtures disagreed about the base session. Separate actual save operations from DOM control and align session/MFA phase fixtures. | `tests/admin-ai-save-operations.spec.js`, actual Worker save-helper cases, `tests/auth-admin.spec.js`, Q3 logout/context cases. Explicit fallback codes, original save intent, enrollment/verification and invalidated identity are asserted. | `npm run test:q3-integration`; normal `test:workers` and broad browser jobs retain the real imports and auth cases. | Matching Worker/browser jobs in 34312435904 passed on `562c4094`. This media-only repair does not change their inputs; no renewed billing/MFA live claim. |
| Decorative Hero playback/state/decoder/timing coverage; historical Full `36751637249/1`, `36761410380/1`, `36765022318/1` and release `36751584855/1`, `36761371798/1`, `36764984680/1` | Owner decision 2026-09-30 supersedes warning-only acceptance: remove dedicated decorative tests/probes/controls/diagnostics from all engines and callers. Product videos and the preserved Models loading fix are unchanged; no decoder repair is claimed. | Existing selection guards reject retired Hero files/cases/configs/commands; functional report and candidate counterchecks reject missing/malformed/failed retained execution and old policy. Independent Models/navigation/layout checks live in smoke without video prerequisites. | Existing `test:homepage-selection`, `check:homepage-selection`, `test:static-deploy-safety`, `test:release-compat`, `test:ci-selection` and retained browser suites; Full/release dependencies omit the deleted native job. `homepage-functional-v3` candidates require functional proof, no decorative observations. | Prior failed runs remain failed. Detailed source/run/artifact history is preserved in the [pre-removal register](https://github.com/bitbiai/Bitbi/blob/23232a1025db44a1c864fbcb36624b913a8c881f/docs/runbooks/REGRESSION_REGISTER.md). The native stall remains unresolved and no further stall investigation is required. Local removal validation: 28/28 focused executions passed without skips/retries against the built site, including EN/DE cold Models, both desktop buttons, touch/mobile navigation, UI layout, public-gallery loading and real Canvas MP3/Opus/invalid-audio/Range controls in the selected Chromium/WebKit scope. Selection, workflow, candidate, release-plan and CI-selection counterchecks pass. No removed video suite was executed. Fresh final-source CI/publication remains pending; coverage removal is not a passed former assertion. |
| Carousel blocking-work countercontrol reports within budget, Release `36761371798/1`, job `110045341128`, artifact `11119233588` | Its deliberate 90ms block ran entirely before the link input timestamp; overlap depended on incidental later event work. Native Long Task duration has integer-millisecond precision. Split the same 90ms across document capture (30ms) and bubble (60ms) for the same real pointer event, straddling the measured boundary. Keep the measurement algorithm, limits and deadlines unchanged; attach raw evidence before assertions. | `homepage-carousel-focused.spec.js` asserts target/event identity, before/after ordering and an independently isolated native blocking task. The real overlap summarizer must exceed budget; the old start-time-only filter must miss that same task. Existing `homepage-performance-contract.spec.js` retains native input/completion-boundary and malformed-observer controls. | Existing `npm run test:homepage-performance` in Linux homepage jobs in Full and release; no new gate or product change. | 2026-09-30: three instrumented original controls confirmed the deliberate work ended before measurement; three corrected controls passed with native 93–94ms tasks deliberately spanning the marker, no retries. The final existing five-case performance caller passes 5/5 on local Chromium, without skips or retries. The failed CI control attached evidence only after its failed assertion, so its exact native endpoint is unavailable; no claim of reproducing that historical endpoint. Hosted final-source execution remains required. |
| Linux UID mapping/bootstrap and ambient host-interface postcheck failures, latest ambient example run 34250807973 | Own namespace/privilege/egress boundaries must be proved directly; host inventory changes alone do not prove a child escape. Fixed bootstrap checks its private namespaces before privileged operations, drops rights and reports ambient identity-based differences separately. | `scripts/test-q2-runtime-launcher.mjs`, `tests/q2-recovery-staging.test.mjs`, native runner entry/exit checks: missing boundary, remaining privileges or real outside connectivity fail. Primary and postcheck errors remain distinct. | `npm run test:q2-runtime`, reached by `npm run test:workers`; hosted Linux preflight and complete Worker/Q4 native suite remain required. | 2026-09-30 full-chain local execution exposed two launcher-test path assumptions on macOS: /var resolves to /private/var, so the synthetic set-ID matcher never injected and the expected artifact path was lexical. Canonical matcher/output assertions plus explicit repository/external symlink aliases now exercise real staging, require the injection and preserve no-copy/repository-escape guards; 26 launcher/staging checks pass under the local OS network boundary. No launcher isolation policy changed. Worker/Linux job 102347580613 passed in 34312435904. No new isolation implementation or native Linux claim from local Mac tests. |
| Unknown diagnostic config and reconciliation without a deployment, run 34276520093 | Exact validation-only classification was missing; unconditional follow-up ran after a blocked deploy. Classify the exact file, keep unknown paths blocked, perform the full-range guard early and immediately before deploy, and use the actual official deployment action. | `scripts/test-release-plan.mjs`, `scripts/test-static-deploy-safety.mjs`, `scripts/test-ci-test-selection.mjs`: full mixed Q4 range, valid/invalid acknowledgements, unknown paths, blocked/skipped/failed/cancelled/no deployment. | `npm run test:release-plan`, `test:static-deploy-safety`, `test:ci-selection`; real `check:static-deploy-safety` with base/head/event/ack in the release job and deploy job. | Release job 102347444479 passed; Pages was correctly skipped after the later media failure. Plan prerequisites are not evidence of missing live resources. |
| sharp GHSA-rgj7-g3m4-5g8c and npm10 `Missing sharp@0.35.2`, runs 34307277787 / 34310987440 | Three independent Worker projects need patched sharp. Nested override installed under npm12 but failed npm10 cold ci; direct `sharp:0.35.4` override and npm10-generated locks retain undici/ws and platform entries. | Existing dependency/toolchain validators reject old sharp/unsupported native chain. `check-worker-dependency-audits.mjs --install` performs real ci/ls, verifies unchanged package/lock bytes and installed sharp/libheif, then runtime and dev audits for all three projects. | `npm run check:worker-dependency-audits -- --install` in standard/full early release steps; native Images smoke via `test:workers`. Reinstall when package/installation inputs change, not for every unrelated test edit. | 2026-09-30: Full runs [36698235836/1](https://github.com/bitbiai/Bitbi/actions/runs/36698235836) and [36552156288/1](https://github.com/bitbiai/Bitbi/actions/runs/36552156288) exposed obsolete exact overrides and a stale compatible lock: root brace-expansion 1.1.18 → 1.1.21, fast-uri 3.1.7 → 3.1.8, all three Wrangler projects undici 7.29.0 → 7.29.1. [Brace advisory](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr), [fast-uri patch](https://github.com/fastify/fast-uri/releases/tag/v3.1.8), [Undici security release](https://github.com/nodejs/undici/releases/tag/v7.29.1). Node22/npm10 cold installs, root low audit, every Worker runtime/dev audit, installed/locked native Sharp and toolchain checks pass without changed package/lock bytes; no allowlist/threshold change. Wrangler/Miniflare/Sharp and application runtime dependencies remain unchanged. These are tooling findings, not evidence of live compromise. The complete Linux cold-install/audit and native Worker chain passed in 34312435904. Root-only or omit-dev audit is insufficient. These development-tool patches introduce no audit exception. The Models identity extraction exposed an overbroad sibling-shared-file check: final proof compares every reached Worker source across Git base/head, preserving unchanged AI/Contact classification while the Auth graph change still deploys. A distinct reviewed compatible package-patch proof admits that affected Auth deployment through its existing continuation; real-Git controls reject changed reachable sources from the unchanged-runtime exception and unsafe/missing/config/compiler evidence from both proofs. The identity leaf is explicitly mapped to Auth in release and CI selection. The reviewed deployment-only Undici exception now uses immutable Git base/head evidence of the compatible dev-leaf patch, unchanged runtime/compiler graph and absence of app/tool imports or custom builds. Missing/unknown evidence retains deployment; affected audits/tests remain selected. Existing `test-release-plan.mjs` real-Git mixed/fallback and unsafe-import/build controls prevent unrelated runtime changes inheriting that exception. |
| Hidden Video generation not ready after Gallery switch, run 34347675542 / artifact 10103665965 | The test demanded visible-layout readiness from an inert, zero-width wall and then never returned to Video. No product fault reproduced. `waitForPublicWall` now verifies the active category, current measured/container width, generation and card/column geometry across frames. Hidden cards/structure survive; the test actually reopens Video and verifies original cards, focus and current layout without requests/rebuilds. | `public-wall-readiness.cjs` plus `homepage-carousel-focused.spec.js`: stale ready/second generation, hide before completion, reopening, stuck layout and wrong/missing cards. The full EN/DE responsive browser path tests the actual product module/build. | `test:homepage-functional`, `test:homepage-carousel` and broad static entrypoints; full homepage group finishes all cases before the long browser job. | Original hidden ready=false is legitimate, not rewritten to true. Local synthetic window controls supplement Chromium/WebKit execution; CI remains required on final workflow inputs. |
| Duplicate release validation / queued extra Full, historical runs 34347645021 and 34347675542; local migration 2026-10-04 from `903f4680` | Hosted release jobs repeated portable local acceptance and ephemeral setup. The existing release command contract now runs in a pinned, cached development-Mac Linux VM; GitHub imports authenticated exact-source evidence and preserves protected publication. Full remains independently scheduled; Fast UI and legacy apply wrappers cannot start duplicate suites. | `test:local-release` real Git/report/archive controls reject stale, missing, failed, changed and unauthorized evidence, omitted media preparation and skipped import. Existing candidate/selection/workflow guards retain artifact, discovery and protected continuation checks; hosted/local bootstrap controls reject mixed origin and unisolated fallback. | `npm run release:local` → `config/release-validation.yml` → `static.yml` import → existing protected backend/frontend continuation. `release:preflight` and exact-source resume share the same receipt. `test:quality-gates`, `test:static-deploy-safety`, `test:ci-selection`, native launcher and local-evidence tests execute through that contract. | Historical failed native candidates remain failed. Development checks have verified the distinct Linux isolation preflight and initial matching/invalid evidence controls; current source acceptance must be proven by its complete local receipt and successful GitHub import. First local `b78be62e` attempts stopped at an outdated deploy-dependency validator before product suites. The validator now checks the actual import gate; missing import/reuse/dependency countercontrols remain blocking. An overlapping credential-wait entry duplicated early checks, so the entrypoint now holds a process lock before preparation, with an executable concurrent-start rejection. The next attempt exposed missing `zip`; the pinned image and executable early tool preflight now cover both archive tools. Local `a918c749` then passed 42 commands and 1,404/1,408 Worker cases, stopping before FFmpeg/native acceptance. Four stale tests assumed pre-Seedance catalog counts/pricing revision, a mock's old asset-reference SQL, and Generation Lab access to Canvas-only Seedance Standard. Exact approved catalog membership with broken controls, before/after pricing plus a real mutation control, migrated SQLite ownership operations, and trusted-area routing fix those assumptions without product changes. The corrected 3+1 cases passed separately without repeating earlier passes; valid key and separate limiter fixtures preserve the actual admission gates. The closed local continuation binds original checkpoint/log/discovery hashes, reviewed spec hashes, unchanged protected inputs and fresh corrected reports; missing/altered/duplicate/skipped/retried evidence rejects, and the previously unreached FFmpeg/native tail remains mandatory. `ed7a7d6a` passed actual FFmpeg and 25/27 launcher/staging checks. Two assertions still assumed the hosted-origin marker in the migrated release plan, including a mutation that no longer changed its input. They now check each real caller's distinct origin and assert the mutation target exists; only those two cases resume before native execution. The failed tail remains hash-pinned and the case union requires all 27 checks. `b1efd966` passed the two repaired guards and 272 native checks. The browser restore then exposed a job-boundary mismatch: hosted jobs start without `_site`, while local groups retained the generated build. The adapter now verifies generated and stored candidate bytes before resetting only that disposable input; changed-byte and symlink controls reject. The native checkpoint stays pinned and is not rerun. The unchanged selector's additional Auth browser job is required, not replaced by Worker evidence. Warm readiness reuses the immutable image without installs; it is not a repeated suite or a publication claim. No extra Full/Memvid run, production deployment, paid inference or protection change follows from the migration itself. Linux ARM Chromium launch did not establish H.264 decoding: five real user-media cases failed with unsupported streams. Local browser routing now preserves Linux homepage/three-engine carousel and prepares locked native Mac Chromium/WebKit for user-media suites; missing codec/tool/version evidence fails the existing local verifier. `97e0ec95` retained 664 browser passes; exact fixture/codec corrections passed 42 cases at `a4d3f433`, then only the remaining Admin locale case at `004ff2ec`. These 707 passes are retained. Two Lab cases exposed a genuine product race after awaiting pricing; the committed guard rechecks busy after the await, with deterministic EN/DE broken/positive controls. Final-source acceptance remains required. `8c471701` passed 45 applicable Linux cases (five unchanged engine-specific exclusions) and 225 core cases. Its 20 failed core cases lacked public availability in legacy Lab/Models/help fixtures; reuse the approved fixture and synchronize catalog reads, preserving exact membership and broken controls. The closed continuation retains every pass and executes only the remaining cases. Do not infer completion before the full case union and GitHub import/publication. All outstanding browser cases passed by `115eecc5`, and `e637dce9` completed local acceptance. Run `37209583530/1` then failed before candidate upload or deployment: its read-only token received HTTP 403 for private draft asset `609991867` (release `403057927`, locator `6842273904`). Owner-approved correction scopes `contents: write` to the import job, disables dependency lifecycle scripts there and retains non-persisted checkout/token isolation. The existing early `validationPlan` guard rejects missing or broadened rights and skipped import; focused actual Git/source/hash counterchecks permit only the reviewed workflow delta and retain the original passed evidence. No old failed run is relabelled, no evidence draft is published and no product suite repeats. Local `092904d0` stopped before push when pretty-printed evidence file/hash maps triggered generic secret-assignment detection. Evidence now uses the existing `test-results` boundary; actual candidate source remains scanned with the unchanged policy. The import-staging countercheck preserves original bytes, rejects overwrite and detects a planted candidate secret. The transport delta is hash-pinned. Actual corrected CI access and protected publication remain required. |

| Cold Models navigation waits on Admin/pricing imports; [release 36751584855/1](https://github.com/bitbiai/Bitbi/actions/runs/36751584855), source `7dab3e96`, macOS artifact `11115980105` | The click reached the handler, but cold model-catalog imports finished after the existing visibility assertion; the failure screenshot already shows the eventually opened overlay. An image-model identity imported from the pricing dispatcher pulled unrelated Admin/music validation into public navigation. Move only that constant to `flux-2-max-identity.mjs`, preserving its pricing re-export and the single member exposure list. | Existing `smoke.spec.js` cold EN/DE desktop/mobile controls hold or fail the unrelated Admin dependency, require lazy opening, complete catalog, localized close/focus/Escape, unchanged route and no writes. Old import graph is a negative control. Existing native staging guard imports the real copied member suite and rejects a missing identity leaf. | `test:homepage-core` / broad `test:static` and tagged `webkit-canvas`; the independent Models cases execute without decorative media prerequisites. `test:q2-runtime` executes the staging guard. | Local final checks: 12 selected Chromium/WebKit cold-navigation/membership cases and the original sandboxed macOS DE loading/navigation case pass without retries. Both held/failed dependency controls fail on the old candidate. Exact 15-model membership/labels/order and pricing export are unchanged; catalog graph 26 to 17 modules. Selection guards and actual staged-import/removal countercheck pass. Hosted acceptance and publication are not established. This correction does not fix the separate Full native-video stall. |

| News spec forced full selection and completed Q4 stayed the implicit release range, run34395792740 | Missing Admin test mapping plus Q4-only candidate assumptions. Map the exact spec; derive the complete unpublished range from a verified Pages deployment. Selection, actual jobs and schema-2 build/report proofs share that range. | `test-ci-test-selection.mjs`: actual six-file News delta stays Admin/static, unknown neighbor stays broad. `test-pages-candidate.mjs` / `test-pages-workflow.mjs`: ordinary Admin scope, missing/failed selected jobs, unselected Worker, intervening unpublished commit, actual deploy receipt, wrong SHA/bytes/proofs and later failure. | `test:ci-selection`, `test:static-deploy-safety`; News executes through the existing `test:auth` command and broad static entrypoint. `pages-candidate.mjs baseline/record/proof/source/publish` implements the live contract. | Q4 publication34393537797 is the initial verified baseline, not the failed News run. Local CLI/selection tests are orchestration evidence, not a Pages deployment. |

| Admin proof ENOENT after 176 passing cases, run34404123954 | Playwright cleaned discovery from its default output directory. Admin artifacts now use `test-results/admin-artifacts`; discovery and result JSON remain siblings. The workflow removes both old reports before discovery. | `test-pages-candidate.mjs` executes the actual workflow discovery/execution commands with a browser-free fixture in all six effective projects: old layout loses discovery, corrected layout retains its exact bytes; stale reports/artifacts are removed. Existing missing/failed/skipped case and build-identity rejection remains. | `npm run test:static-deploy-safety`; selected Admin workflow then runs real acceptance → `pages-candidate.mjs proof` → unchanged-artifact publication. | Lifecycle regression is not native acceptance. Final local Admin/build/proof evidence belongs to this correction; the earlier 176 passes did not produce a valid CI proof or deployment. |

| Sound Lab More reads idle after a valid selection in built-site CI, run34635233151 | The test imported `audio-manager.js?v=__ASSET_VERSION__`, creating a different module-local state from the real versioned application import. Resolve the unique same-origin homepage entry version and verify the pre-observed audio response URL before using that exact URL for reset and reads. Built roots reject placeholders. | Existing `smoke.spec.js` Sound Lab More case retains 60/100/identity limits, clears and reselects the real manager, then loads a deliberately different version: foreign reset cannot change the real selection and ambiguous identity is rejected. Two distinct local build tokens plus source mode exercise the same case. | `npm run test:static -- tests/smoke.spec.js --grep "homepage Sound Lab More starts at 60 Memtracks" --project=chromium`; full static/browser CI includes this existing mapped spec against `_site`. | Original CI failure and retry remain red. Local browser controls use mocked `play()`, not native audio acceptance. Final local results/hashes are recorded privately; no new CI or publication is implied. |


### Workers Static Assets preparation (2026-09-11)

- Risk: activating dormant Geo routing, exposing repository files, or treating an upload/old Pages success as the new serving baseline.
- Correction: allowlisted immutable site plus separate frontend entry; explicit document routing; independent active-version/domain receipt; Pages bootstrap only from its verified deployment. Wrangler temporary state stays outside the immutable package.
- Caller: `npm run test:frontend-hosting` in static validation; `--standalone` in Full regression. Native local workerd checks actual routing/bytes and upload dry-run; `--unit` rejects missing/partial/wrong activation, failed uploads, displaced candidates and unsafe partial recovery. `test:static-deploy-safety` executes workflow/candidate counterchecks (including branch/validation-only publication denial).
- Limit: local macOS runtime and synthetic API fixtures are not Linux CI, live domains/certificates, or a completed hosting migration. See `STATIC_HOSTING_MIGRATION.md` for the separately authorized external stages.

- Hosting review follow-up: preparation had not compared the full upload tree or authenticated branch CI archives; validation inherited Pages/OIDC writes, and artifact-only receipts could not represent rollback or expiry. `test:frontend-hosting` now invokes `test-frontend-review.mjs`: real CLI/Git/ZIP countercases, effective job permissions and A -> B -> protected recovery A with durable metadata. Raw `test-results/frontend-review.json` distinguishes synthetic API contracts from native runtime. Upload commands repeat provenance checks. The separately approved private-evidence importer has its exact scoped contents-write contract; other validation jobs remain read-only and production writes remain protected. On 2026-10-04 local source `e4ca9f58` exposed the stale blanket assertion after 36 passed steps, before any push. Hosting review now calls the same `verifyImportWorkflow()` guard as local preparation, preserving missing/broadened permission, token exposure and skipped-import countercontrols. The existing local continuation pins the failed checkpoint and corrected assertion, retains unchanged passes, refreshes affected checks and rejects changed product/workflow/dependencies or forged success. Candidate archives still expire, while verified durable production receipts use independent GitHub job and Cloudflare serving evidence. No live activation is implied.

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

Existing `impact-v1` selection assigns the two News consumer files and functional specs to homepage coverage, not shared Auth/Admin ownership or a duplicate carousel matrix. Model-registry/overlay inputs still own model parity; generic smoke/locale tests own core coverage. The retired `homepageMedia` flag and its dedicated native Hero proof are removed by the 2026-09-30 owner decision. Actual Carousel/shared-runtime/unknown impact remains conservative; independent functional coverage stays required. `static.yml`, `pages-candidate.mjs`, and the existing discovery/report verifier share this decision; missing/failed selected cases/jobs, absent flags, wrong build identity and unpublished intermediate changes block. Actual callers: `npm run test:ci-selection`, `npm run test:homepage-selection`, `node scripts/test-pages-candidate.mjs`, `node scripts/test-pages-workflow.mjs`, and `npm run check:homepage-selection`. Full regression remains available with retained functional coverage; no new release profile or workflow.

Historical run34869664537 passed Linux News geometry and native macOS acceptance, then failed a decorative DE successor identity assertion. The subsequent controller/probe test correction and original artifacts remain in the pre-removal register linked above. Those dedicated state/native/decoder controls and callers are now retired under the owner decision; the incident is not recertified or investigated further.

Run34764931638 passed native lifecycle acceptance (11/11) and Linux homepage (70/5 engine skips), then exposed stale smoke contracts: always-visible narrow/empty news, removed placement attributes/mobile cube, and the prior manual-save Help copy. Existing `tests/smoke.spec.js` now checks real safe geometry, bounded size, retained manual selection across hiding, inert narrow content, empty/error clearing and auth transitions; unrelated Hero geometry remains asserted. The existing German Help check follows durable acceptance/automatic storage instead of instructing manual save. Caller: `npm run test:homepage-core`; focused `npm run test:static -- tests/smoke.spec.js --grep 'KI-PULS uses|German homepage Live Pulse|mobile logged-in|retains manual selection|initializes after login|failed endpoint responses|Models buttons sit|localizes route-prioritized|hero foreground scales' --retries=0`. These replace obsolete presentation assumptions, not native output checks; no product change or failed-run recertification.

Run34767139699 passed native macOS11/11 but Linux EN/WebKit geometry reached its final request count before the mobile matchMedia request had been observed (69 pass/1 fail/5 skips). The existing geometry case now awaits that requested surface before resizing back/cancelling it; the exact final two-request/cache assertion and every safety/visibility assertion remain. Same existing EN/DE Chromium/WebKit caller above; no product change.

Run34767708882 passed macOS11/11 and Linux70/5 skips; browser161/1 exposed an overfixed smoke expectation added during alignment:1920×1080 hides locally but fits on Linux. The scale smoke now evaluates actual neighbour/viewport safety and inert zero-area hiding at that boundary, while requiring visibility at its large viewports. Platform-specific font/layout metrics are not a fixed News breakpoint. Existing `test:homepage-core` caller; per-viewport raw geometry attached before assertions.

Historical run34776760807 recorded own-frame callback/seek evidence and a probe-classification repair. Its raw evidence and technical account remain in the pre-removal register linked above; the dedicated probe, state/loop/resume controls and native caller are now removed. This does not explain or repair the later native stalls.

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

Recurrence on 2026-10-03: release `37107490938/1`, source `7ccae8d1`, passed all 85 native Canvas cases and 9/10 pricing cases, then failed opening `/workspace/tests/fixtures/media/canvas-preview.mp4`. The import-only closure plus one manually named video did not cover the new pricing suite’s filesystem read. The allowlist now includes that file. The same existing closure test resolves media literals/templates from every actual native suite/control import graph, checks identical copied bytes for all 11 referenced fixtures, rejects each omitted input, and reproduces ENOENT when the pricing file is physically removed. Both release/Full use this common staging plan. The existing selected Worker caller executes this staging-closure check after locked root/Auth dependency preparation and before the product suites; the early workflow-safety job has root dependencies only and retains its browser-free command-chain guard. Local staged-tree/countercheck success is portable input evidence; Linux pricing/member/Stream and selected browser completion still require the fresh protected run. No product behavior, isolation, retry or acceptance threshold changed.


Inspector presentation fixtures (2026-10-04, local source `e9642235`): four merge cases
addressed an unpublished `tests/` URL instead of the existing candidate HTTP media
fixture; two narrow-layout keyboard cases tried to move a node while the Graph was
hidden by the Inspector. Correction uses `/api/plain/canvas-preview/video.mp4`,
checks visible playback, and explicitly returns to Graph before ArrowRight. Retain
14 genuine passes and require six fresh cases through the existing local browser
continuation; preserve the failed report. `test-local-release.mjs` counterchecks
reject changed product inputs, missing cases, retries and forged provenance; the
actual caller remains selected `tests/canvas.spec.js` in Chromium/WebKit, EN/DE.
This is a fixture correction, not a production decoder or graph repair.

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

Linux media-tool caller lesson (updated 2026-09-30): run `35389905932`
passed 1,301 Worker routes before FFmpeg could not start; the static workflow's
full Worker caller lacked installation. Full run `36720467950/1`, Worker job
`109904868384`, source `c540a323`, repeated the caller-coverage gap: 1,386 routes
passed, then the first Canvas FFmpeg export reported `canvas_media_tool_failed`. The wrapper
discarded the OS error, so ENOENT is not proven from that historical log; subsequent
native Q2 acceptance was not reached.

Ubuntu static, Full, processor and backend callers now share
`scripts/setup-media-tools.sh`; `check-media-tools.mjs` executes both FFmpeg and
ffprobe before expensive routes/media. The real media command preserves bounded
tool/OS-code diagnostics without arguments or private payloads. Full also runs
native `--preflight` before routes. Existing `test:static-deploy-safety` →
`test-pages-workflow.mjs` checks all consuming workflows and the real missing-tool
entrypoint/fail-fast; staging/launcher tests retain complete chain order.
`test:ci-selection`/`test:release-plan` cover those helpers and unknown neighbors.
Shell/route success is not full acceptance: the same `test:workers` invocation
must finish real 2/5-clip exports and native Q2. Source `a3dd944c` passed the
entire Ubuntu chain in Full `36735789410/1` (job `109958050998`, artifact
`11108025592`) and release `36735751622/1` (job `109957974420`, artifact
`11110800675`): 1,386 routes, real FFmpeg integration, 26 launcher checks and 231
native cases across 13 suites, with isolation checks and no unexpected outbound
requests. Release also passed private-media image/lifecycle tests. Its 21-minute
setup delay was a slow 94.8 MB apt download, not a test failure. Both surrounding
runs later failed browser acceptance; component evidence is not publication proof.


### Canvas versioned music exports (2026-09-27)

The legacy empty-body export keyed only video sources, returned an existing
permanent aggregate, and Canvas Save targeted the original clip. Migration
`0096_canvas_export_versions.sql` adds immutable recipes and latest/current heads
only for new exports; historical permanent exports are not reclassified. Explicit
Save protects the concrete aggregate. Native D1 guards serialize save/cleanup,
retain processing sources and prevent an older completion replacing latest intent.
Export-only music edges are excluded before provider input resolution, including
unresolved sources; ordinary H3 audio references retain their existing semantics.

Counterchecks: the actual Auth callers in `canvas-processing-control.mjs` through
`tests/workers.spec.js` and native `--suite canvas` cover duplicate/conflicting
keys, changed music versions, foreign ownership, failed/late completion, saved
survival and zero inference/debits. `tests/canvas.spec.js` exercises EN/DE purpose
selection, keyboard gain, save/reload, explicit rerender and retained preview in
Chromium/WebKit. The pinned Linux container's `canvas-full-video.test.mjs` decodes
audio to measure original unity, 0/half/full music, looping, trim, silence, peaks
and non-cumulative rerenders, including the real processor download/upload caller.
The same migrated-schema queries run natively and in protected publication.
Release requires the exact changed container image and decoded persisted synthetic
music output before frontend continuation. Local layered fixtures do not certify
the live browser-to-container path; CI, activation and durable smoke receipts are
separate evidence. No paid generation is involved.

Center-crop and reference-only sequence correction, 2026-10-03 (baseline
`030f70b6`): an owned completed Seedance run used H3 as `reference_video` and
retained its source/run/version in `used_sources`, but had no continuation
`connected_video_inputs`. The live export GET returned 200, `eligible:false`,
`clips:1`; the H3 export was eligible. Actual originals probed 1344×768 and
1280×720. Resolution was not the visibility cause. Private incident evidence is
outside Git in the task checkpoint; no prompts, footage or owner IDs are logged.

The existing panel now accepts an explicit ordered sequence of owned completed
originals, without inventing last-frame ancestry. Auth validates each immutable
identity/version and rejects native included-segment duplication. New recipe v2
pins `center-crop-v1`; capability-3 claims exclude old processors, while prior
queued recipes/keys and saved exports retain their policy/identity. New intent
cannot return an old padded aggregate. The common raster is the even-rounded
minimum of display-oriented dimensions; exact central crop preserves chroma
origin, rotation, equal SAR, sound and existing music/clean-base handling.
Incompatible SAR is rejected instead of stretched.

Counterchecks/callers: `canvas-processing-control.mjs` through the existing
Worker case and native Canvas suite covers immutable historical provenance, explicit
order, foreign/missing/changed sources, native inclusion, no charges, old/new
claims, replay and stale leases. `canvas-full-video.test.mjs`, called inside the
existing private-media Linux image, decodes coordinate markers for exact odd
1343×768→1280×720, reverse/middle/equal/odd cases, rotation/SAR, and rejects
scaled/corner-cropped controls; original bytes and prior audio/music checks remain.
Existing EN/DE Canvas browser cases cover keyboard/mobile, failed submission,
immutable graph and reload. The selector maps this exact export boundary into
existing Canvas acceptance plus the required image, retaining broader handling
for unknown/security neighbors. Focused local crop, Worker and four browser cases
passed; final Linux/candidate execution and protected media→Auth→frontend/live
receipts remain required. A separate broad local preflight exposed the unchanged
Admin image-budget evidence count (9 versus stale 6); it is outside this export
scope and is not a selected static release check.

Current-node merge selection, 2026-10-03 (baseline `f9c89c38`): live readback
found 19 run-based candidates for seven attached video outputs. The query read
project run history; it did not join existing nodes to their selected output.
The blue highlight also followed historical generation contributors. New admission
joins the current node/run/asset/version and checks owned usable video media.
Current directed video edges now define both the blue strand and the chain preview;
non-video references do not become clips. Native edit/extend evidence only removes
already included footage; it never adds historical nodes to the strand. Manual
selection remains independent and uses live titles plus stable immutable identities.
A single conditional D1 insert rejects deletion, output replacement or graph changes
between validation and acceptance. Accepted jobs/keys retain their immutable sources.

Counterchecks: the existing `canvas-processing-control.mjs` Worker/native caller
covers current versus historical output, deleted/foreign/non-video/replaced sources,
branch/cycle/broken-link controls, native inclusion, atomic admission races, both
modes through the same processor claim, and accepted-job replay after graph deletion.
Existing EN/DE Canvas browser suites cover the exact highlighted order, live and
duplicate titles, manual drafts, deletion/reopen, late refresh/project changes,
output replacement/undo, keyboard/mobile and the unchanged music/save path.
Focused local Worker acceptance and 26 Chromium/WebKit cases passed without retries.
`test-ci-test-selection.mjs` keeps this exact change in existing Canvas/native/browser
acceptance, explicitly excludes a media image rebuild, and rejects unknown/auth
neighbors. No processor/schema/model/pricing change. Protected Auth then frontend
publication and final live readback remain separate evidence in the task checkpoint.

Native shared-fixture follow-up: `370364ac` / `37150166111/1` passed all 315
Worker cases and 37 native Canvas cases, then the following private-media fixture
hit `canvas_projects.id` uniqueness. The added cross-project control had reused
that sibling's short synthetic ID and left its project behind. Namespaced hashed
IDs plus explicit fixture cleanup preserve shared D1 state. The same helper now
asserts the project count is restored before returning to subsequent callers;
its actual native sibling remains the integration countercheck. This is a fixture
repair, not a product or processor failure. Retain the failed artifact; do not
label that mixed Worker/native job successful or reuse it as a complete proof.

Browser fixture follow-up: `11f1c54d` / `37150831760/1` completed all 315
Worker and 188 native cases, then reported 322 browser passes and five failures.
Four audition fixtures exposed an enabled export without the new current output
identities; supply two attached, versioned videos and assert their exact chain in
that explicit render request. Decoded gain, original audio, recovery and no-extra-
write controls remain intact. The DE Chromium deletion test selected C while B's
asynchronous delete was still pending; its eventual completion cleared selection.
Wait for B to leave the rendered graph before selecting C; do not alter timeouts,
retries or protected assertions. The screenshot confirmed an empty Inspector.
The existing closed browser repair profile pins source/run/attempt, artifact/report/
case hashes and both reviewed fixture hashes. It reuses 322 passes and executes
only the five failures against the unchanged candidate. Three already passing
merge variants retain identical assertions with the same deletion synchronization.
`node scripts/test-browser-fixture-repair.mjs --canvas-merge` checks missing,
failed/retried/tampered evidence, unrequested execution and forbidden product deltas;
the real `static.yml` caller must discover all 327 and execute exactly five fresh.
No repeated Worker/native/processor acceptance or new media image is needed.

Completion metadata follow-up, 2026-10-04 (baseline `1b374e3a`): live Safari
held the completed Out run/asset without `sourceVersion`, while canonical project
and full-video GETs contained all eight valid outputs. Exact UI reconciliation
excluded that endpoint; resolving from the filtered list then turned its absence
into a misleading one-clip message. The alternate browser attachment serializer
also omitted the owned R2 version. Its omission is reproduced through real
Worker/queue/D1/R2 callers with a controlled projection gap; the original incident's
response/timing was not captured, so that ingress is not claimed as proven history.

The attachment route now returns the verified owned original version. Ordinary
Inspector status reconciliation fills only absent versions for the same project,
existing node, current run and asset. It never replaces differing metadata. Strand
resolution starts from the current graph endpoint; missing/replaced/unready
endpoints have distinct reasons. No migration, regeneration or media rebuild.

Executable prevention: `canvas-completion-control.mjs` exercises Seedance → H3,
further H3 extension, independent canonical queue/attach/reopen identities, exact
eight/nine clip order, no repeated inference and music-off/on export admission.
`Canvas completion metadata` runs the actual completion/Inspector transition in
EN/DE Chromium/WebKit, injects only the observed deficient response, and rejects
changed/deleted endpoints. Local four browser cases and isolated native scope passed;
provider responses are synthetic. Existing `--suite canvas` includes this regression;
`--suite canvas-completion` executes it alone for the closed metadata repair.
Selection compares the complete route before/after blobs and fails back to broader
Canvas acceptance for other route/product inputs. Real workflow discovery/candidate
checks require all four engine/locale cases, reject omissions/skips/failures/retries,
and retain native staging/Images preparation. Processor, manual/deletion/ownership
and prior release evidence are reused only where inputs are unchanged. Fresh final
CI, protected publication and live export receipts belong in the task checkpoint.

Browser audition, 2026-09-28: preview is separate decoded music plus the existing
aggregate player, never an export request. Migration `0097_canvas_preview_base.sql`
retains a private, quota-counted clean base inside the same explicit export lease;
legacy mixed versions without one remain playable but cannot be auditioned.
Save/download still target the immutable completed version. The existing processor
and protected smoke preserve/read/decode the clean base before frontend publication.
`canvas-music-preview.cjs` is registered in the selected Canvas spec: EN/DE decoded
0/30/100% gain, original sound, loop/seek, buffering, stale track reads, failed media,
cleanup and zero preview submissions. Linux WebKit can advance at HAVE_CURRENT_DATA
after seeking: waiting/playing events, not a HAVE_FUTURE_DATA-only gate, control
music suspension. Keep actual audio assertions; macOS Playwright WebKit, Linux
WebKit and native Safari are distinct evidence. Native Canvas controls additionally
check clean-base ownership, lease fencing, duplicate quota and saved/failed cleanup.

Browser pointer failure follow-up (2026-09-30, release `36720433227/1`,
source `c540a323`): the historical blank idle feedback is consistent with a lost
click, but its CI trace alone does not prove that cause. A deterministic reproduction
against the exact original candidate released video metadata during the pointer
gesture: the Preview button moved 116.5 px between pointer-down and pointer-up,
and no click reached its handler. The product now reserves 16:9 space for the
original player, matching the aggregate player; object-fit preserves proportions.
The EN/DE countercheck in `tests/canvas.spec.js` requires stable control geometry,
404 feedback, return to the playable completed video and no mutation/render request.
It rejects the original candidate. Callers remain `test:homepage-core` and Full's
`test:static`.

Separate audio observation: during the completed-source → clean-base switch,
matched AudioContext samples measured Hann-windowed 1000 Hz magnitudes of
`0.0720608` at input and `0.0720930` at output (unity ratio `1.000446`), both below
the old fixed `0.085` cutoff. Native input peaks were also lower. The upstream
native amplitude cause remains unresolved; neither mixer attenuation nor FFT
detuning is established. The repaired measurement checks preservation of the actual
incoming original with paired source/output unity within ±5%, an audible floor,
440 Hz leakage checks, volume 1 and actual AudioContext destination samples. Retained raw PCM replay
and synthetic missing-source / 0.5 / 0.8 / 1.2 original-level controls reject
meaningful audio failures without changing product mixing, retries or timeouts.

Final-input correction, 2026-09-30: source `a3dd944c`, Full
[`36735789410/1`](https://github.com/bitbiai/Bitbi/actions/runs/36735789410)
and release [`36735751622/1`](https://github.com/bitbiai/Bitbi/actions/runs/36735751622)
failed both EN/DE WebKit auditions at the added `muted === false` assertion.
That assertion had been checked only on macOS after the earlier Linux run. The
unchanged candidate reproduces both failures on Linux. Pinned
[WebKit/GStreamer source](https://github.com/WebKit/WebKit/blob/486de399887bc8fa8a69e2f194ebc9476589a08a/Source/WebCore/platform/audio/gstreamer/AudioSourceProviderGStreamer.cpp#L281)
intentionally mutes the native sink when Web Audio owns playback. The verifier now
samples the actual destination instead of a parallel worklet tap. Disconnecting
the mixer must produce silence, and reconnecting must restore both decoded signals;
returning to the completed video must restore original-only destination audio.
Original/missing/attenuated/amplified signal, gain, leakage, peak, playback and
no-extra-write controls remain mandatory; retries and thresholds are unchanged.

Local Playwright 1.58.2 checks: Linux ARM64 / Node 22.23.2 passed 10 focused
cases. After strengthening completed-video recovery, the final helper passed eight
bounded Linux audition repetitions (two per locale/engine) and four macOS ARM64 /
Node 22.23.1 auditions. All retries were disabled. These
checks establish the measurement and its countercontrols; hosted Full/release
acceptance still belongs to the exact final candidate SHA and run/attempt.

Fixture follow-up, 2026-09-28: `c77d8b6b`, run `36467657329/1`, worker job
`109082515330`, passed discovery but failed 15 of 136 cases in the Canvas-selected
`workers.spec.js` subcommand. The existing MockD1 array was initialized; its exact
failed-preview-base SELECT was unhandled after successful generation and node
deletion. Both representative routes reproduced HTTP500 locally. The fixture now
recognizes only that guarded SELECT: no eligible row returns empty; eligible
populated cleanup explicitly requires native D1, just like recipe reclamation.
Production cleanup and accounting are unchanged. The CI-selected Canvas fixture
regression covers status, retained asset, owner/global scope, positive bytes,
live/equal/expired locks, no mutation and unknown/weakened SQL rejection.
The 15 former failures plus this regression pass (16/16); the exact existing
Canvas Worker grep also passes (137/137, zero retries). Retained native Linux
Canvas evidence passes 84 cases, including populated failed-base cleanup and
exact quota release; all 286 recorded production-source hashes still match and
that native control does not import MockD1. Preview browser cases are unchanged.
These local results do not certify a candidate: later selected Worker/native,
container/lifecycle and browser CI acceptance were skipped after the old failure;
its build-only artifact must not be published. Existing protected full-range
backend/frontend continuation and fresh candidate proof remain required.

Save follow-up, 2026-09-27: `58e3adc3`, run `36345673640/1`, passed Worker/image
acceptance and 250 Assets cases, then failed WebKit EN aggregate Save (234 Canvas
cases passed; counts overlap). Browser proof/deployment skipped. Artifact
`playwright-report-selected` / `10940593821` shows no Save request, not a backend
rejection. Controlled macOS and Linux WebKit traces reproduce a concrete defect:
metadata changes the unsized preview from 267×133.5 to 267×200.25 during a press;
Save moves 66.75px, pointer-up hits video and click targets the parent. The original
CI artifact has no pointer trace, so this is an evidenced matching mechanism, not
proof excluding every alternative historical cause. Reserve the aggregate video
box before metadata, retaining object-fit contain, and keep saved-version status
visible after refresh. The same EN/DE test now keeps ordinary clicks plus a
request-gated metadata-during-press countercheck, target/geometry evidence, exactly
one Save, saved-state success and all later rerender/retention/H3 assertions.
WebKit retains the incident MP4; Chromium's new metadata check uses synthetic VP8
because the local Linux bundled browser cannot decode H264. Both existing selected
Assets and Canvas CI callers discover these cases; no selector or retry change.
Final local repaired-build acceptance: 254 Assets and 239 Canvas/Auth cases passed
on macOS, no retries; eight focused cases passed in Playwright 1.58.2 Linux ARM64.
The broader ARM run hit H264 decoder failures and was stopped; an overlapping
local run lost its shared server and was replaced by the isolated passing run.
Those retained failures are not passes. Final-SHA Linux CI and publication receipts
remain required; unchanged Worker/image checks from the failed run are not a new
candidate certificate.

2026-10-04 extension (base `a281fc9e`, pre-publication local evidence): imported
video references formerly had no real export subject; per-node original-audio
settings were absent. Migration 0100 and recipe v3/protocol 4 preserve old records,
use real node/asset/version identities and immutable per-clip envelopes. Existing
`--suite canvas-audio` passed four native cases including populated migration,
role/type replacement, synthetic image/video provider inputs and export recovery.
EN/DE Chromium/WebKit integration decodes ordered mixed generated/imported clips,
original gain/fades and separate background music off/on through the actual Worker
and FFmpeg path. Final CI/source/attempt and live receipts belong in the task
checkpoint; these local passes alone do not establish publication.

Related confirmed boundary defects: ranged MockBucket reads replaced the whole
object size with the partial body length; its fixture now matches R2 metadata,
with a range/body countercheck in `q2-mock-lifecycle` and native export acceptance.
Music upload sent a Data-URL to the existing plain-Base64 API; the shared client now
strips only the audio prefix, tested by real fixture upload/type replacement.
Late metadata could overwrite a focused fractional fade edit or move the preview
button during pointer-down. The input preserves its draft, and dynamic notes sit
below action buttons; existing Canvas tests inject metadata and verify the exact
persisted fade and click/error-recovery outcome. No retry/time-limit/audio-threshold
relaxation, provider generation or decorative Hero test is involved.

2026-10-04 smooth-join extension (base `a52bda33`, implementation acceptance):
controlled AMD64 FFmpeg 5.1.9 sources confirmed that maximum audio/container duration
plus terminal-frame padding extended two one-second pictures to about 2.72 seconds.
The original v4 exports used the video clock, rejected meaningful excess audio and
allowed only measured inaudible codec residue. The owner superseded that rejection
for new exports on 2026-10-04 (correction below). Continuous audio encoding also removes the observed
per-clip AAC priming offset. Optional motion reconstruction is separate from these
normal-join corrections. A generated patch did not prove replacement: an independent
subject-position check caught a frame-indexed overlay that left output unchanged.
Frame-derived time bounds and final decoded-patch validation now reject that failure;
`canvas-seams.test.mjs` deliberately disables the compositor to check the rejection.
The same existing processor-image, native Canvas audio and EN/DE browser callers cover
private comparison caching/replay, original/music envelopes, persistence and export.
Audio-fit correction, 2026-10-04, inspected main `6f4dcbd6`: the owned nine-clip
Grok/Outro v4 export failed `canvas_audio_tail_exceeds_video`. Measured clip 7:
10.041667 s picture, 10.080 s sound; 38.333 ms overhang, decoded RMS 0.0001283,
above the former 0.0001 threshold. This is not evidence of a corrupt source or
perceptually silent tail. Clip 8 also exceeds that threshold in a 0.333 ms tail.
Recipe v5 / protocol 6 pins `fit-picture-v1`, fits sound to verified normalized
picture windows, preserves offsets, and reports trimming without blocking. Old
accepted jobs stay immutable; a new explicit export cannot reuse the old failure.
Executable counterchecks: `canvas-audio-fit.test.mjs` decodes audible/short/missing/
offset fixtures, checks exact frame PTS and audio envelopes; the native Canvas fit
caller checks policy/claim fences, missing/malformed completion metadata, old-key
replay and private comparison readback. Four required EN/DE engine cases exercise
real processing, playback/download/save and truthful disclosure. Actual callers:
existing target-image validation, `--suite canvas-audio-fit`, and the selected
Canvas browser command. Source/attempt results and live owner-chain output belong
in the private acceptance checkpoint; implementation alone is not a live repair.
Local `d54db317` passed the target AMD64 decoded/timing/lifecycle checks, native
API admission/completion checks and both EN browser cases. Both DE cases stopped
at an exact button query: enabling background music intentionally changes its
name to “Gesamtes Video mit Hintergrundmusik erstellen”. The fixture now requires
that exact existing control and retains export, playback, preview and saved-byte
assertions. The closed continuation pins the original failed report/checkpoint,
reviewed one-line query and discovery, preserves its two genuine EN passes and
runs only the two unresolved DE cases. Candidate/import countercontrols reject
missing, failed, retried or changed cases and any product/image drift; unchanged
processor/API proofs are retained with their original source identity. These
fixture and local results alone do not establish successful live publication.

The actual target-container 1280 × 720 sample used one CPU, about 23 seconds additional
seam processing and 0.88 GB peak container memory (6 GB limit). These controlled
measurements are not production or arbitrary-content quality claims; final source,
release receipts and live output are recorded in the task acceptance checkpoint.
Local candidate `a2866590` passed the actual AMD64 image, five native cases and all
four new EN/DE Chromium/WebKit smooth-join flows. Its browser report retained 208
passes and 20 failures: old exact export requests omitted the new OFF snapshot;
a music-only test counted every checkbox and rejected the unrelated new control.
Correct only those expectations, retaining full ordered/versioned request checks,
OFF-by-default, music destination/amplitude countercontrols and ordinary Save clicks.
The existing local continuation binds the original failed checkpoint/report and
corrected fixture bytes, executes exactly unresolved cases, and reuses the original
image digest/source with checked publication identity. The actual candidate/import
verifiers reject missing/failed/retried cases, product drift and altered image proof.
Old failed reports stay failed; this is fixture compatibility, not an audio repair.
Release `37221046580/1` at `3ee89ea4` imported all local evidence, then stopped before
media activation: Mac Docker recorded OCI index `7c0708fa…`, GitHub Docker reported
config `4eafa8bc…` from the same SHA-verified archive. Readback confirmed only schema
0101 had advanced; Auth/media/frontend still served their previous versions. The
existing publisher now resolves both IDs through the archive and independently
checks platform, runtime configuration and ordered layers. Existing
`test-media-activation-reuse.mjs` / `test:release-plan` reject unrelated IDs, changed
commands, wrong platforms/layers and altered provenance; a retained real archive
control covers this exact format. No image rebuild or processor/browser rerun is
required for this deploy-only correction. The original failed release remains failed.

Release `37189472421/1` at `3e6f82ed` passed all four Linux native cases and the
seven required Linux image controls, then stopped with 218 browser passes and six
failures before deployment. The new UI fixture encoded two unnecessary 80-second
exports inside a 30-second case. Four eight-second clips preserve ordered pixels,
loop/fade boundaries, both render modes, real ownership/versions and decoded gain
without increasing the deadline. Preview seeks now wait for actual advancing
playback after asynchronous source initialization; gain assertions require one
paired decoded window within both bounds, rejecting stale unity, silence and
wrong gain. Sufficient steady audio separates a gain observation from short-clip
fade/end behavior, which remains covered by the processor controls.

Separately, the existing Linux WebKit audition reproduced a stopped native source
with its element screenshot during playback. Moving that artifact capture before
playback passed two bounded EN/DE repetitions; all destination disconnect/reconnect,
unity, limiter, seek/recovery and no-extra-write checks remain. No viewport resize
was observed, and the underlying native snapshot interaction is not claimed fixed.
The initial corrected export cases passed locally in Linux and native macOS
WebKit, but release `37192908814/1` still failed the DE WebKit clean-source start
while its other five repaired cases passed. The player was below the narrow
Inspector viewport after the sound button scrolled into view. Source-binding and
preroll hypotheses did not remain reliable and were reverted. The fixture now
explicitly brings the measured player into view after those controls. Three
bounded Linux repetitions passed without retries. A temporary broken worklet
that silenced original audio only in merged previews failed the retained decoded
gain assertion; the worklet was restored unchanged. No signal thresholds or
timeouts changed. Offscreen native behavior remains unproven; this is not a
decoder-repair claim.

The existing closed browser continuation authenticates archive/report/case hashes,
requires complete 224-case discovery and retains 218 original plus five
intermediate successes. It authenticates the intermediate failed run, preparation,
archive and both reports; only the unresolved DE WebKit case executes again.
Actual report-union validation and synthetic counterchecks reject missing, changed
or retried intermediate evidence and accidental execution of already passed cases.
Its focused counterchecks also reject missing media preparation,
unknown product changes and incomplete/failed/retried proofs. Pre-push inspection
also found that generic repair publication would look for the image in the new
run and assume existing production smoke outputs. This fixture-only continuation
now verifies/reuses the original tested image with its original source/run/attempt,
records a separate activation identity, and requires fresh production smoke.
Actual callers remain static.yml, the candidate verifier and protected media
publication; final publication/live receipts belong in the task checkpoint.


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

2026-09-28 recurrence: runs 36464782633/1 and 36464781440/1 at
f3ed3c31 failed this discovery gate before candidate creation (zero artifacts).
Four imported music-preview cases were collected, but their helper declaration
location (`spec.file`) failed the owning-spec allowlist in both homepage-core
and Canvas expected sets. Registration now stays in `canvas.spec.js`; the helper
still supplies the test bodies. Report/candidate identity rules and strict
equality remain unchanged. The actual `test:homepage-selection` passes with
380 core / 265 Canvas cases, explicitly requiring all four EN/DE × engine
preview cases in standard/core/Canvas discovery; `check:homepage-selection`
also passes. Missing/duplicate/skipped/foreign controls remain mandatory.
The existing impact-based `release:preflight` now executes this cheap check first
for test/helper, Playwright or selection-contract changes, with executable
failure-propagation and unrelated-change controls in `test:release-plan`.
Discovery is not media execution: fresh selected CI and exact candidate evidence
remain required for unpublished 0097 → media/container → Auth → synthetic
durable clean-base acceptance → frontend. Neither failed run certifies release.

The focused browser rerun also exposed a measurement false positive (3/4 passed):
a rectangular 8192-sample frequency window reports ~0.004 at 440 Hz for a
clipped 1 kHz-only signal at 48 kHz. The meter now uses coherent-gain-corrected
Hann weighting; the unchanged 0.003 no-overlap limit rejects leakage, while a
0.02-amplitude added 440 Hz countercontrol must still be detected above 0.019.
Peak samples, decoded source/gain assertions and zero-submission checks remain
independent and unchanged. The corrected four cases pass in both macOS and
isolated Linux Chromium/Playwright WebKit against the static build; this is not
native Safari or a CI release certificate. The first Linux attempt's missing
static-build directory produced 404s; its failed setup evidence is retained.

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

Seedance extension (2026-10-03, owner-approved output-duration rule): migration
0099 legitimately advances the initial tariff revision. Native pricing and
pre-grant insufficient-balance fixtures previously assumed revision zero, causing
a stale-quote rejection before their intended boundary. Fixtures now read the
actual revision and retain stale-edit/no-dispatch counterchecks. Native
`--suite model-pricing` passed all 11 cases; focused member-generation fixed/Auto,
storage recovery, queued OFF/running completion and Canvas edit cases passed.
The focused member wrapper's unrelated image-preview tail had no seeded image;
it is not whole-suite acceptance. Final integrated CI remains separately required.

Run [37129092860/1](https://github.com/bitbiai/Bitbi/actions/runs/37129092860),
source `4cc47085`, passed staging guards and 72 Worker cases, then exposed the
same zero-revision assumption in the shared ElevenLabs caller and today's request
in the frozen legacy-transition fixture. Inspecting the still-unexecuted selected
commands also exposed the MiniMax music caller and stale catalog membership.
The corrected current-client fixtures read the migrated tariff revision; explicit stale
quotes still reject without provider/debit, legacy accepted operations retain
frozen evidence, and custom music cases preserve unrelated migrated rules without
resetting the global revision. Appearance compares the complete unchanged pricing
row; model-area tests retain baseline audit rows and explicitly include Seedance
while Main remains off. Native Appearance (6) and model-area (7) checks passed;
23 music/transition and 18 catalog/MiniMax checks passed. The remaining previously
unexecuted adapter/chat/lifecycle commands passed; unchanged passing cases were
not rerun locally. The existing Canvas/model CI caller now also executes native
Appearance/model-area preservation checks, with missing-command and failure-stop
countercontrols in its actual shell guard. Review every consumer of changed
schema/defaults before push, not just the newly added model's tests; keep fresh
hosted candidate acceptance distinct from these local results.
Run [37130098354/1](https://github.com/bitbiai/Bitbi/actions/runs/37130098354),
source `9a62f8f3`, passed all 315 selected Worker cases before native Canvas found
a second Admin request builder missing that revision. Complete local native
execution then caught the separate asynchronous image-queue request too. Both
now send the current fixture tariff, preserving their existing owned-input,
provider-failure, replay, receipt and exact-debit assertions. Final native Canvas
86/86, member-generation 71/71 and Stream 7/7 passed under loopback-only macOS
sandboxing; earlier pricing 11/11, Appearance 6/6 and model-area 7/7 evidence is
unchanged. A partial native prefix cannot certify the remaining request builders.
Hosted Linux and the downstream browser/publication gates still require success.

Executable Seedance checks in `q2-seedance-25.spec.js` exercise actual migrated
SQLite/R2/Admin queue and manual recovery, all 52 owned sources, foreign-owner
rejection, four independent rate calculations, pinned settlement and missing
usage failure. Existing EN/DE workspace tests cover controls/persistence; the
saved MOV test measures the actual media element's decoded audio, with a zero-gain
countercontrol, twice in Chromium and native macOS WebKit without retries. MOV
playability does not imply support in WebKit's separate `decodeAudioData` API;
paused analyser buffers are not a silence measurement. No decorative tests return.
The actual selected Worker shell guard requires the Seedance file and rejects its
removal before downstream commands. Planner/guard tests exercise supported 0099,
AI/Auth ordering and rejection of unreviewed siblings. Pricing basis and unresolved
provider-only evidence are documented in the release runbook; publication requires
fresh candidate evidence, never the previous model-area repair exception.

Run [37127836822/1](https://github.com/bitbiai/Bitbi/actions/runs/37127836822)
passed release guards but stopped at the candidate build: adding Seedance to the
public member registry changed generated help text without its reviewed knowledge
version. Refreshing the existing corpus version after reviewing the derived EN/DE
model list repairs that mismatch; all 23 knowledge checks and the actual static
build passed locally. The existing change-aware preflight now runs the same cheap
knowledge guard before selected product suites, including registry-only edits;
its failure countercheck prevents execution from continuing. Corpus refresh stays
in the existing Canvas/model scope and keeps Main inference off. Run the final
build as well as guard fixtures before push; no old artifact is relabelled.

Omni extension (2026-10-03, owner-revised scope): unknown provider metering is not
a guessed retail tariff. Exact `google/gemini-omni-flash` uses manual fixed
operation/resolution credits in this same ledger, pins admission and settles that
accepted amount without another margin. Admin testing has a separate explicit
platform reservation; member admission additionally checks durable capability and
resolution acceptance. `q2-gemini-omni.spec.js` rejects absent prices, unsupported
controls, fabricated interaction IDs, unowned/unexercised acceptance and stale
writes, and proves tariff edits/reset cannot reprice accepted work. Native
member-generation66/model-pricing10/Canvas85 passed on the working candidate with
real local D1/R2/queue boundaries and synthetic decoded media, including URL/inline
storage, ownership, reference bytes, one debit and no second inference on recovery.

The rendered Admin countercheck found `/admin` missing from the price-client Admin
route predicate: it fetched public data while `/admin/` and `/admin/index.html`
were recognized. All three forms now retain the protected Admin pricing context.
The actual AI service adapter countercheck also found Omni missing from the
private Gateway-options branch; it now explicitly disables content logging/cache.
Canvas's independent-edit sources have no frame-extraction method; contributor
metadata now checks that a method exists before reading it. Native Canvas Omni
editing exercises this actual boundary. Admin inline output pins the existing
job output key before R2 storage, preserving its managed cleanup reference.

Actual callers are the existing Canvas/model selection in static.yml: focused
Worker contracts, native member-generation/model-pricing/Canvas and tagged
Chromium/WebKit UI. Selection, candidate and workflow counterchecks require
execution, including pricing, and retain failed/skipped/missing-case rejection.
Budget guards stay unchanged: new Admin integration code lives in a focused module.
The public Models fixture excludes runtime-unapproved models and has a positive
activation plus missing-tariff countercheck. No decorative Hero tests were added.
No paid provider call or live Omni acceptance occurred. The initial disabled
publication was followed by the explicit 2026-10-03 owner activation: all 20
tariffs read back at 100 credits (pricing revision 20), all six capabilities and
four resolutions enabled (readiness revision 1), with unverified provider
acceptance recorded honestly and previous state retained. The website assistant
remains off. See the release runbook's Omni
section and the external `bitbi-gemini-omni-flash-checkpoint` for final source and
publication evidence; local tests are not deployment receipts.

Cold guest follow-up (2026-10-03, published source `84673d3c`): live read-only
mobile inspection found Omni absent after the initial guest `/api/me` cleared
the already-loaded public tariff snapshot. Refresh retail pricing after that
clear on public pages; retain protected Admin denial and session epoch/abort
fences. Existing `oma2-q3-model-pricing.spec.js` now forces this response order
and requires restored EN/DE Models visibility, the 100-credit estimate and zero
mutations. The original implementation fails that control; corrected Chromium/
native WebKit cases pass 4/4, plus existing conflict/logout/account-switch checks
2/2. Actual CI caller: existing `model-pricing-v1` browser discovery/execution and
candidate report verification. Selector counterchecks omit unchanged Workers
only for the closed browser-client scope, broaden for shared/backend/unknown
neighbors and preserve forced Full. Fresh publication/live evidence belongs in
the same external checkpoint; no paid inference or decorative-media test occurs.

Release follow-up (2026-10-03): `37105294832/1`, source `33e86425`, failed in
`release-compatibility / Test mandatory homepage selection` before candidate
creation or any deployment. The workflow and candidate verifier required the
four new Chromium/WebKit pricing cases, but the independent discovery comparison
still used only the five workspace specs and two workspace projects. Local
focused product tests and synthetic candidate fixtures did not exercise that
stale comparison. The exact CI command reproduced the same failure locally.

`CANVAS_RELEASE_SCOPES` and `canvasReleaseProject` now define the shared required
matrix for discovery and candidate proof. The existing homepage-selection check
compares the actual workflow command with standard Playwright discovery, requires
the four pricing cases independently, and rejects removed cases/files/engines,
skips, duplicates and foreign/replaced cases. `test-pages-workflow.mjs` now invokes
that guard as well as candidate proof checks, so `test:static-deploy-safety` cannot
pass only its synthetic proof fixtures while real discovery is broken. Local
checks cover 303 discovered cases without re-executing product browser suites;
this is not CI acceptance. The failed run created no reusable candidate or Worker/
browser acceptance: those previously unexecuted jobs still require the fresh
protected run, with normal release gates and no unchanged-backend redeployment.

The next run `37106195156/1` (`a897879e`) passed release compatibility and created
the candidate, then stopped in the Worker shell countercheck: it still expected
13 commands after knowledge validation and native model-pricing expanded the
selected chain to 15. No provider/Worker product suite had started. The corrected
ordered command requirements explicitly include both new boundaries and Omni's
contract spec. Real shell failure injection still proves every command stops the
tail; missing/substituted knowledge, contract or native-pricing checks are negative
controls. The existing workflow safety caller now executes this focused launcher
countercheck automatically without running the native/product suites. The prior
candidate has no complete hosted Worker/browser acceptance and cannot be published
as passed. Preserve successful product evidence; new CI must execute the missing
acceptance through the normal guarded path.

Run `37107028067/1` (`a7bb1c49`) then passed both orchestration guards and the first
83 + 20 Worker cases. The next collection passed 136/137: the publisher-order
case still asserted eight video catalog members after the authorized Omni
addition. Its repaired oracle names the exact nine integrated models and rejects
each omission, duplication and substitution with Gemini 1.1; publisher ordering
and independent image-dimension rejection remain unchanged. Only this failed
product case was rerun locally. Static registry membership still does not enable
paid use: the separate readiness/tariff guards and public-listing checks remain.
The existing protected pipeline has no general cross-SHA cache for incomplete
Worker jobs; those logs are retained as evidence, not promoted to a successful
job or used to skip the previously unexecuted native/browser tail.

Run `37108321888/1` (`730b4116`) then passed the complete selected Worker chain, including isolated Linux Canvas 85, pricing 10, member-generation and Stream. Browser execution finished 297 passed / 6 failed: the Admin list and shared EN/DE Generate Lab helper still omitted the explicitly integrated Omni model. The independent ordered expected lists now include its exact identifier; each actual DOM oracle also rejects missing, duplicated and substituted Omni options. Existing default selection, dimensions, prompt retention and request-count assertions remain. All six repaired cases passed locally against the original downloaded candidate in Chromium/native WebKit without retries. The existing closed browser-repair continuation now has a second pinned incident (original run/attempt/archive/report/case digests and exact before/after test hashes), retaining the historical assistant incident for receipt verification. It reuses 297 unchanged passes and successful Worker acceptance, executes only the six changed cases with controls, and checks complete 303-case discovery. Product/build/backend/dependency inputs remain byte-identical; unknown deltas, source mismatches, failed/skipped/retried cases, missing selected proofs or an altered case union block acceptance. This source has no unexecuted browser tail and no selected homepage job; preparation requires only its actual independent proofs, never a fake homepage pass. Counterchecks run through `test:static-deploy-safety` and the existing candidate verifier; fresh protected continuation remains required for publication.

The final built-candidate check passed all 16 Omni browser cases in Chromium and
WebKit (EN/DE). It also exposed the public knowledge model list inheriting a
runtime-gated model: that static list now excludes unverified runtime entries,
with a bilingual knowledge countercheck in the existing selected Worker caller.
The cost-policy caller exposed an existing omitted assistant adapter inventory;
its existing durable caller budget is now explicitly inventoried (no ledger or
activation change), with registry and unknown-provider-source guards retained.

### Global segment appearance and browser-cache authority (2026-09-21)

Global settings use the existing app_settings row and atomic revision/CAS plus Admin audit; public reads expose only safe theme values. Five segments share one route/resolver and semantic paint layer. Defaults remain Dark; personal editing is server-denied. A higher disk-cache revision must not defeat the first confirmed server response, while an older in-flight response must never roll back a newer confirmed save. Page lifecycle aborts are released before resume so an aborted request cannot suppress revalidation. Theme changes update paint only and preserve drafts, Canvas identity and private media.

Actual callers: appearance-v1 in existing static.yml runs focused Worker/SQLite cases, native --suite appearance (Admin/MFA/CSRF, concurrent HTTP writes, audit rollback, durable read/reset and pricing isolation), and the shared appearance/strict navigation browser cases in Chromium/WebKit. The matrix verifies five segments, EN/DE, desktop/mobile, host-overlay inheritance, cache versus authority, bounded first paint, periodic refresh and tab resume without inference. Discovery/results survive runner cleanup; candidate proof rejects missing/failed/skipped/retried cases. Native macOS is not Linux CI. No new schema, permission, media or billing behavior is involved.

### Website roots and unchanged-package release repair (2026-09-22)

The post-Auth deploy checker resolved `/css` and `/js` against the runner filesystem and mixed checkout/candidate HTML. `validate-site-references.mjs` now requires an explicit website root; source uses the build allowlist, candidate validation stands alone and runs before backend publication. The actual workflow CLI regression in `test-pages-workflow.mjs` covers root/nested URLs, version queries, missing files, candidate-missing/source-present and symlink rejection. Caller: `npm run test:static-deploy-safety`.

The existing repair continuation has a distinct closed tooling scope with complete protected Git-tree equality, fresh release checks and authenticated original SHA/run/attempt/archive/proofs. It does not claim new browser/Worker execution. Candidate and frontend-review countercontrols reject changed product/build inputs and invalid repair acceptance. A digest-checked successful backend receipt keeps its original identity and must still match active version, bytes, schema and triggers; a tooling repair never redeploys Auth merely to change its annotation. Caller: static deploy safety and `npm run test:frontend-hosting -- --unit`.

Public appearance acceptance must compare the document actually served by the existing single-hop DACH route. Only the observed empty, hidden same-origin AI Labyrinth link and digest-pinned Cloudflare Insights augmentation may be removed before exact candidate hashing; all other HTML/asset changes and unexpected redirects fail. A locale redirect is recorded as German delivery, never English evidence. Countercontrols run through `test-pages-workflow.mjs` under static deploy safety.

A failure after activation is not a completed publication. The baseline resolver permits reconciliation only after independently matching the original accepted candidate archive, protected failed upload artifact, exact source/run/attempt/package, current 100% version and domains. It retains the previous accepted baseline until the existing protected deploy job verifies the active version without uploading and records a new durable receipt; the old job remains failed. `test-frontend-review.mjs` covers wrong/expired evidence, supersession, unconfirmed activation, unchanged-byte reuse across tooling repairs and durable receipt survival after diagnostic artifact expiry; the publication adapter has a zero-upload countercheck. No Auth redeployment or routing/protection change follows from this verification repair.

On 2026-10-03, `37120854735/1` activated Auth and the unchanged accepted frontend,
then exact public-byte readback failed; subsequent EN/DE reads matched without
code/configuration changes. `37121383011/1` exposed a separate reconciliation
bug: an earlier pre-upload schema failure was incorrectly required to contain
activation evidence. The existing resolver now excludes only authenticated jobs
whose frontend-upload step completed as skipped. Its real-Git/API/ZIP regression
includes both failures, plus missing/unknown/attempted upload and no-activation
countercontrols. Unknown outcomes still block. The accepted Auth receipt from
`37120854735/1` is reused, preserving its version and billing/policy state. Caller:
`test:frontend-hosting -- --unit` / static deploy safety, then protected baseline,
backend receipt and frontend reconciliation. Never blind-rerun a byte mismatch;
first read the served bytes and reconcile the actual activation. Run
`37121752248` selected product suites again after recent-run source discovery
returned no repair; it was cancelled. The known incident now directly verifies
its exact source/run/attempt before selection. Missing/invalid proof throws and
cannot silently fall back to repeated product suites. `test:release-plan` tests
this no-listing/no-fallback boundary; real Actions evidence is also checked by
the actual selector. The reason the generic discovery missed that source remains
unproven; no transient API explanation is claimed. Run `37122123162/1` then
exposed a classifier still using the backend activation SHA as the product
acceptance SHA. The receipt context now carries both identities; the real
publication/verification classifier has a broken-context countercontrol in
`test:release-plan`. A read-only call through `readToolingBackendReceipt` also
verified the genuine Actions metadata, ZIP digest and `37120854735/1` receipt
before the next protected continuation; no inference or redeployment was used.

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
On 2026-10-03, source `7a807dad`, run `37119454435` attempt 1 repeated this
assumption in the new model-area queue fixture: 69 Worker cases and four native
cases passed before its cwd-relative PNG read failed. The model-area reader now
uses its module URL too. The existing launcher checks both actual readers from
`/` and an empty cwd, verifies the staged PNG digest and rejects each old reader.
Its resolved module-graph guard also rejects direct cwd-relative media reads,
so adding another native suite cannot silently repeat this assumption.
Actual caller: `node --test tests/q2-recovery-staging.test.mjs
scripts/test-q2-runtime-launcher.mjs`. This orchestration countercheck does not
replace the selected hosted `test:q2-runtime -- --suite canvas` or the subsequent
Appearance/native and Chromium/WebKit gates; the failed run provided neither.

Seedance follow-up (2026-10-03), source `25566771`, run
[37128306488/1](https://github.com/bitbiai/Bitbi/actions/runs/37128306488):
release compatibility/build passed, but the staging guard stopped before product
cases because its isolated Canvas fixture lacked the new tariff-revision scalar
query. The real runtime already supports it. The stub now accepts only that SQL
query and returns a nonzero revision; both cwd/digest assertions and the broken
cwd-reader countercontrol remain. All 27 staging/launcher checks passed locally.
The earlier targeted shell-only check missed this sibling: after shared native
fixture or schema edits, execute the complete small guard, not just the named
changed case. Existing `release:preflight` now schedules that guard before costly
suites, and `test:release-plan` rejects continued execution after its failure while
excluding unrelated CSS/docs/Contact changes. This is fixture/orchestration proof,
not hosted native or production acceptance; the failed run remains failed.

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
schema label still named 0094. Auth now obtains this label from the canonical
release manifest at build time (2026-10-03 follow-up below). Run both
`test:doc-currentness` and **`check:doc-currentness`** on final source: fixture
tests alone do not check the checkout. The release acceptance
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

### FLUX.1 Schnell request schema and unresolved-job feedback (2026-09-27)

Auth's Generate Lab helper sent `num_steps`; the 09:31:36Z production log on
Auth 95f569fd (source 14ba4afa) explicitly rejected that property. The account
model-schema endpoint confirms only `prompt` and `steps` (maximum 8), with
additional properties forbidden. Seed-bearing documentation examples contradict
that schema; Auth omits seed and member controls no longer advertise it. The
separate Admin AI adapter and adjacent models are unchanged.

An exact allowlisted schema exception now retains a content-free reason in the
existing dispatch receipt. It is not a no-inference receipt: arbitrary AiError,
5006, HTTP400 and transport failures remain unknown, with no refund or redispatch
authorization. Generate Lab shows EN/DE review-required feedback without a busy
spinner and restores it read-only. Existing operation keys remain retained.

Counterchecks: `workers.spec.js` strict default payload and adjacent Admin/model
cases; `member-generation.cases.js` and native `--suite member-generation` exercise
the actual queue/D1/R2 path, private status, schema versus ambiguous failures,
reservation/no-debit and same-job/no-second-call fences. Tagged member browser
cases run EN/DE Chromium/WebKit via the existing Canvas/model CI caller; discovery,
execution and candidate proof require that file in both engines. Unknown paths,
session/billing changes and dependencies cannot inherit this bounded selection.

One unresolved FLUX image job was found in the incident window, without an asset,
terminal rejection receipt or debit. Its retained private input reproduces the
stored legacy `num_steps` dispatch fingerprint exactly (4 steps, no seed). The
log has no job correlation, so timing alone still does not prove its attribution.
No production row/key/credit was reset: authoritative
job-bound terminal evidence is still required for recovery. Full-regression run
36309014115 remains historically red (Worker and homepage/media failures); this
repair does not recertify that run. Synthetic checks are not live generation proof.

### Generation selectors, dimensions and typed asset pagination (2026-09-27)

Confirmed: Klein's member mapping omitted dimensions and its multipart builder
fixed output size at 1024 square; Canvas exposed invalid arbitrary dimensions.
Selected/default dimensions now share the validated application subset through
the actual route, multipart request, pricing and usage/result metadata. Ordering
uses publisher metadata, never Gateway labels or sort position as a default.
See [capability audit and caller map](GENERATION_CONTROLS.md) for all exposed
image/video families, preserved gates and unresolved provider-schema limits.

Optional type filtering precedes the D1 UNION limit; native Canvas acceptance
checks 65 assets per type and owner/type/folder cursor fences. Shared browser
tests cover independent groups, late reads, manual read recovery, normal text,
mobile playback and picker actions. The new disclosure exposed an ancestor
`details` click guard: guards must exclude controls inside the card, not its
containing group. Mixed Assets + Canvas proof must select the named auth report;
wrong, duplicate, missing and failed reports remain fatal. Existing protected
AI → Auth → frontend continuation and both-engine candidate proof remain required.

### Composer notices, wallet visibility and private preview details (2026-09-27)

Fresh Generate Lab previously selected an arbitrary retained job and its accepted
status blocked ready resets. Fresh entry now leaves those jobs in explicit Assets
history; media/identity changes invalidate presentation, not jobs or durable intents.
The earlier automatic-restoration description is superseded for this composer.
`oma2-q1-member.spec.js` retains one submission, stable intent, current review and
read-only history; `oma2-q3-appearance.spec.js` covers clean entry and stale identity.

Wallet visibility shares audited Appearance revision/CAS, defaulting absent to on.
Partial saves preserve themes/visibility independently. Cached enabled state cannot
expose controls before fresh confirmation; hiding closes UI, never changes identity
or wallet data. Native `--suite appearance` and both-engine Appearance cases cover
guards, persistence, off/on, unavailable settings, stale reads and localized routes.

Browser acceptance follow-up (2026-09-30): release `36720433227/1`, browser
job `109908986456`, source `c540a323`, recorded 12 failures and 368 passes in
`candidate-homepage.json`/browser traces. Six Wallet/Panel/header tests assumed
visibility without fresh `/api/appearance` confirmation; controlled enabled
fixtures now establish that precondition. Existing Appearance cases still reject
disabled, unavailable and stale cached enabled state. Desktop geometry measures
the layout viewport (`clientWidth`), excluding native WebKit's scrollbar; the
original pixel tolerance is unchanged.

The Lab fixture began with 401 but expected the lower message reserved for a
previously authenticated session. EN/DE cases now distinguish cold unauthorized
entry from an authenticated session expiring at the actual generation preflight,
then verify login recovery, retained prompt/model and no generation mutation.
Four Models Help cases incorrectly compared grouped/sorted rendering with raw
registry order. Their independent contract checks complete unique membership,
image/video/music groups, vendor/name/id order and localized headings/options;
missing, duplicate, misgrouped, misordered and wrong-locale controls must fail.
This exposed a product defect: Schnell advertised unsupported dimensions and
Klein rendered a continuous range with an undefined pixel cap. Help now honors
dimension support, the discrete 256/512/768/1024 sizes and finite caps, matching
[generation controls](GENERATION_CONTROLS.md). The corrected test fails against
the original candidate. These are contract/fixture/measurement repairs, not
expectations copied from implementation output.

Local focused Chromium/WebKit checks cover those paths and negative controls;
the existing actual candidate `test:homepage-core` collection and Full's
downstream `test:static` require independent evidence for the final candidate SHA
and exact run/attempt. The separate Canvas pointer finding is recorded under
versioned music exports; neither local checks nor historical reports establish
hosted CI/publication success.

Full-scope fixture correction, 2026-09-30: the same `a3dd944c` Full/release
runs above each recorded 40 browser failures; release artifact `11113402939`
retains `candidate-static.json`, and Full artifact `11112079859` retains its traces.
The enabled-Wallet precondition was also absent from 28 wallet-navigation cases,
four profile assertions and four authentication keyboard cases. Shared
`mockPublicAppearance` now supplies fresh controlled settings at those fixture
boundaries, including the earlier smoke callers, and fails unexpected mutations.
EN/DE controls retain unresolved, disabled, cached-enabled and connected-identity
behavior. Removing the fresh-authority gate is rejected by the browser check.
The full Wallet file passed 30 cases; its new state controls passed both engines.
The profile/studio/pagination scope passed 32 cases and shared smoke callers six.

Two other assertions were stale: Schnell's retired seed support contradicted the
confirmed schema incident above, and the pagination CSS class also matched the
new sort control. The tests now require supported steps and omitted seed, and
address Load More by accessible name while retaining the sort control and exact
asset identity/order checks. Candidate mutants re-enabling seed or duplicating the
first asset on the next page both fail their intended assertions. Existing
`test:static` in Full and the selected static workflow execute these sibling
callers; focused results do not replace that complete candidate acceptance.

The Full-only WebKit retry at `oma2-q3-appearance.spec.js` recorded a credits-read
access-control page error while the test rapidly changed routes. Inspection and
held-read countercontrols prove the previous wallet-visibility assertion could
finish before member initialization. The test now requires rendered fixture
content and completed credits presentation before moving on; removing those waits
is rejected in both engines/locales. The precise historical access-control cause
and a separate local ResizeObserver warning remain unconfirmed; no error filter,
retry increase or speculative particle change is used.

Truthful credits fixtures exposed a product defect: the
[Auth route](../../workers/auth/src/routes/account-credits.js) returns top-level
`dashboard`, while [Canvas](../../js/pages/canvas/api.js) discarded everything
except `data`. Only `getCredits` now selects `dashboard`; HTTP/ok checks and all
other response contracts remain unchanged. Existing Appearance cases require the
rendered EN/DE balance, zero and unavailable states, including rejected responses
containing a misleading balance. The old consumer fails the truthful 500-credit
fixture in both engines. Shared Canvas/pricing fixtures use the same API shape.
Local checks passed 22 authentication remediation cases, 32 bounded Appearance
repetitions without retry/browser errors, and 12 final credits/pricing/Canvas
callers. Separate mutants removing only Canvas readiness or only Profile readiness
also fail. Four final native Linux Chromium/WebKit EN/DE auditions passed with the
corrected API/fixtures and exact destination disconnect/reconnect controls. These
results do not certify the final hosted candidate or establish the unconfirmed
historical browser-error causes.

Private on-demand preview details use an allowlist and owner-scoped durable image
input: renameable titles and thumbnails are not original prompt/dimension evidence.
Missing provenance remains unavailable. `asset-preview-details-runtime.mjs` executes
after actual queue/save fixtures in `--suite member-generation`; shared Assets cases
check both engines/locales/viewports, late owners, measured media and close cleanup.
No inference, migration, bulk probe or public prompt exposure is needed.

`workspace-presentation-v1` composes existing Appearance + Assets/native callers;
named report selection prevents Assets evidence being mistaken for Appearance.
Selector/proof and real selected-shell failure countercontrols preserve exact
candidate identity and fail closed for unknown/session/billing/dependency changes.
Selected legacy tests required three evidenced fixture/assertion repairs: Admin
dropdowns replace retired cards, read-only mocks initialize Canvas tables up front,
and poster dispatch requires actual assigned durable backlog, not an admission hint.
Earlier red results remain red; final source/run/artifacts belong to release evidence.

Linux packaging follow-up (2026-09-27, run `36328788911/1`, source `476e87b8`):
the launcher closure correctly rejected the newly imported details suite missing
from `stageInputPlan`. Selected product/native suites, browser acceptance and deploy
were consequently not executed; uploaded candidate artifacts are not acceptance.
Add that exact file, retain the full import closure, and countercheck the actual
copied member-suite import with/without it. The existing staging/launcher command
must run before delivery whenever a native suite gains imports (same cause family
as the September 18 Canvas omission). Keep Appearance + Assets acceptance across
the full unpublished range; no deployment-only reuse or relaxed Linux boundary.

### Canvas → member music request contract (2026-09-27)

Canvas's common body included `model`; the strict fixed-model member music
validator rejects it as `unsupported_option` before usage/provider execution.
Omit only that field from the delegated music copy, retaining the catalog-validated
model in Canvas's original stored identity. Do not relax the member allowlist or
revive old failed keys. Generate Lab already uses the fixed-model body contract.

`tests/helpers/canvas-music-control.mjs` exercises the actual Canvas → music handler
with a controlled AI-service boundary: member/Admin personal debits, owned audio
storage, instrumental/automatic/manual/generated lyrics, invalid combinations and
unknown fields without usage/provider calls, foreign ownership, successful/failed
and pre-fix historical replay, and preserved prior owned bytes. Existing callers:
`tests/workers.spec.js` (`Canvas music contract:`) and native `--suite canvas`.
The staging closure checks the new helper; the existing Canvas/Auth/native CI
branch now also recognizes a server-only Canvas adapter change, retaining broad
unknown/shared-input and force-Full countercontrols. No new acceptance pipeline.

Local red reproduced the owner's exact `400 unsupported_option`; final Node cases
and macOS workerd/D1/R2 cases pass (private source/runtime reports retained). A
Node mock lacked R2's `.text()` convenience method; byte-preservation assertions
now read the common body stream, without relaxing equality. Synthetic audio/storage
acceptance does not establish live MiniMax output or account-wide billing. No paid
call, historical production mutation, schema, binding or frontend change.

Selected-browser follow-up: run `36335849113/1` on `f7cd2480` passed Worker/native
acceptance but failed 12 of 231 browser cases; proof/publication were skipped.
The earlier focused repair missed stale smoke contracts: an absolute quota-read
count crossed startup/auth-change lifecycles, and reload assertions expected
historical jobs to repopulate the intentionally clean composer. Gate generation
completion and its quota refresh (893, not stale 899), preserve `/me` preflight and
one POST, and explicitly open Assets history for H3 identity/output and GPT pending,
failed and saved delivery. Decode the saved original and prohibit extra writes
across reloads. Existing `smoke.spec.js` entrypoints run both locales/engines in
the selected Canvas acceptance; GPT delivery uses its existing UI helper to keep
the smoke budget intact. The full unpublished range retains that selected suite,
not a failed-candidate reuse certificate. No product change was needed for these
contracts; synthetic browser success is not live provider acceptance.

### ElevenLabs member music and frozen Canvas contributors — 2026-09-28

Source baseline `4a3cc3be`; Auth schema remains `0096_canvas_export_versions.sql`.
ElevenLabs member admission now uses the existing signed Auth → AI music adapter,
personal-credit reservation and revision-pinned output-second tariff, including
Admin member surfaces and a selected organization. Authoritative duration settles
within the reservation; invalid/overrun usage requires review. Missing usage settles
the accepted quote with `usage_missing_accepted_quote`, not invented provider cost.
No MiniMax cover/lyrics bundle is attached. Keep the separate Admin Lab policy.

`q2-member-music.spec.js` and native `--suite canvas` execute the same real-caller
fixtures (only the provider boundary is fake): full plans, MP3/Opus byte-preserving
owned delivery, both roles, custom revision/replay, failure/no-debit, durable queue
duplicates and background-export eligibility. Contributor records capture consumed
sources, not every connection; the owner/project resolver follows frozen successful
runs beyond the UI history, bounded at 200 runs/500 reads/500 edges. Legacy evidence
is explicitly incomplete. `canvas.spec.js` checks branched/history highlights,
EN/DE editors and actual MP3/Opus browser decoding; `assets-manager-focused.spec.js`
retains independent sorting/pagination assertions with the new toolbar placement.

Relevant Full failure `36406235710/1` is not recertified: harness read-side mutation
of `canvasExportVersions`, stale Stream/current-candidate schema fixtures, old Admin
catalog expectations and the usage-query fixture were repaired without weakening
ownership/rollback assertions. A real FLUX response-order defect hid timeout 504
behind generic 502; the timeout branch now wins while unknown-outcome reservation,
late-success evidence and replay fencing remain. A bare late exception still does
not prove provider rejection. Historical homepage failures remain separate.

2026-09-30 current-main reproduction: all 1,386 Playwright Worker cases passed
unchanged before this repair. The `036e08d3` lineage had already removed the
Stream/video fixture callers’ 0084/0083 cutoffs; the common helper always enumerated
all migrations. Fresh SQLite realized all 97 migrations, the processing backend
column and pricing state, with clean foreign keys. Full-suite execution also
confirmed the existing timeout, transition, catalog, accounting, cooldown,
unknown-result and lazy snapshot corrections. No new production migration or
Worker implementation fix follows from those historical errors. The complete
`npm run test:workers` chain subsequently passed Q4 selection, the same 1,386
Worker cases and FFmpeg processing, then exposed the canonical-path launcher
fixture defects recorded above. After that test-only repair, its complete
`npm run test:q2-runtime` tail passed 26 staging/launcher checks and 231 native
cases across all 13 suites under the local macOS OS network boundary (Node
22.23.1, Wrangler 4.129.0, workerd 1.20260903.1). No paid providers were used.
Final hosted Full acceptance remains separate; skipped descendants are not passes.

Existing `static.yml` Canvas selection executes these Worker/adapter cases, native
Canvas/member/Stream and dual-engine browser acceptance; staged-input closure and
selected-shell failure counterchecks include the new helpers/AI route. Reports use
separate paths across chained runs. Local Linux workerd/D1/R2: Canvas 84, member 62,
Stream 7 passed; Linux staging/launcher 26 passed. Private task artifacts bind runtime
and source hashes. Local checks do not replace hosted candidate proofs or live
receipts. Protected continuation is AI → Auth → exact frontend candidate; no new
schema, container, secret or paid inference is required.

Opus acceptance follow-up (`36444992508/1`, source `036e08d3`): selected Assets
finished 272/274; WebKit EN/DE stopped at a metadata-only positive-duration check.
Native Ubuntu 24.04 ARM64 / Playwright 1.58.2 reproduced zero duration with no media
error, including over real HTTP; explicit playback then established finite duration
and clock advancement. This supports a preload/readiness assertion defect, not an
unsupported codec or provider failure. Keep both assertions after playback starts,
exercise the actual Generate Lab result, and retain HTTP byte/range checks plus
invalid-audio rejection and media/request attachments. Chromium and MP3 remain
independent controls. The exact x64 hosted runner remains a required fresh CI gate:
local x64 emulation failed browser launch, and the wider ARM64 run had unchanged
video-decode failures (retained, not waived). The failed candidate has no browser
proof and cannot be reused for publication. The existing Canvas selection includes
this exact fixture-server change only with its reviewed Canvas anchor; standalone
or unknown helper changes retain broader selection. AI → Auth → frontend and the
previously skipped selected Auth/proof gates remain required.
Local final checks: six focused native Linux audio cases and all 276 selected
Assets cases on macOS passed without retries against the retained `036e08d3`
candidate bytes. These results do not certify the fresh hosted candidate or live
publication; retain exact run/attempt/artifact proof and protected continuation.

### Independent model-area admission (2026-10-03)

Previously the user catalog and model readiness did not express independent
Generation Lab/Canvas availability. The Admin overview now derives 25 offered
models (16 Lab, 24 Canvas, one Main assistant) from existing registries; per-pair
CAS and admission/dispatch fences preserve pricing, Admin testing and running work.
The old assistant deployment flag is superseded by its existing durable mode,
without weakening activation evidence or spend caps. No production policy is seeded.

Executable checks: `tests/admin-model-status.spec.js` covers defaults, independent
CAS, invalid state, reservation/dispatch races and Main controlled activation;
`--suite model-status` exercises real Admin/MFA/CSRF, native D1, queued OFF,
already-dispatched storage/settlement and organization holds. The actual selected
Worker shell has a failure countercheck at every stage. Existing dual-engine
model-status/assistant callers cover saved/failed state, mobile/keyboard/themes,
EN/DE hidden Lab choices and Canvas retained output/edges/downstream reuse.
Candidate checks reject missing Main evidence or failed/skipped functional cases.
Run `37119971202` attempt 1 completed selected Worker/browser acceptance for
`eac93008`, then stopped before migration/activation: the separate backend
migration allowlist still ended at 0097. The reviewed additive 0098 is admitted;
`test:release-plan` now checks the moving contract against the actual admission
function before publication and rejects unreviewed migrations. The existing
closed tooling continuation retains the exact accepted product trees/archive
and runs only release-tooling checks. A fresh backend receipt is required; the
known pre-activation Auth version (or this continuation's own resumed version)
is checked, and unknown/partial activations block. No old failure becomes green.
SQL mocks gained the real availability-list query; no assertions were removed.
Native and focused Chromium/macOS WebKit checks passed locally with synthetic
providers. Hosted exact-source acceptance/publication is recorded in the private
model-areas checkpoint and the resulting protected release receipt; no paid inference.


Browser-fixture follow-up (2026-10-03), source `22bfa3be`, [37130840933/1](https://github.com/bitbiai/Bitbi/actions/runs/37130840933): 315 Worker and 188 native checks passed; 258/317 browser cases passed and 59 failed before publication. Authenticated Lab/Models fixtures omitted public pricing availability; Admin membership omitted Seedance 2.5; Canvas dimensions expected retired models absent from its public fixture. Supply the existing independent availability fixture and retain exact membership plus missing/duplicate/substitution DOM controls. Malformed-policy controls must still hide models and block generation. P13 removed its injected failure before asynchronous availability refresh/save flush completed: await the rejected PATCH and failed state before clearing it, retaining no-run and exact saved identity assertions. One WebKit internal navigation error occurred before music execution; its cause remains unresolved and fresh execution is required without retry/threshold changes. Local 62-case Chromium/native WebKit acceptance and four EN/DE malformed-policy controls passed against the immutable CI candidate.

The existing closed browser repair pins artifact/report/case hashes, six exact fixture/spec deltas and unchanged product/backend/build trees. Passing WebKit P13 evidence retains identical behavioral assertions; the synchronization correction changes no product behavior. The actual `static.yml` caller preserves 258 unaffected browser passes and upstream Linux evidence, executes 59 failed cases with their controls without retries, and checks all 317 discovered cases. Unchanged passing Lab cases override the shared pricing route before navigation. Missing, failed, skipped, retried or substituted proof blocks; `test-pages-candidate.mjs` executes these counterchecks. Fresh hosted acceptance and protected publication/live readback remain required; this entry is not publication proof.

Release-fixture follow-up (2026-10-03): Seedance candidate `977548e9`, run
[37127459429/1](https://github.com/bitbiai/Bitbi/actions/runs/37127459429), stopped
at `test:release-plan` before product suites or publication. Its historical
schema-repair positive control used moving `HEAD`; after a real product commit,
the production guard correctly rejected that tree as outside closed repair scope.
The test now binds the real accepted repair `cea24f59` and separately rejects the
Seedance product tree, including actual source discovery from its published base.
The guard itself is unchanged. Execute Git-tree-dependent checks after committing
the reviewed inputs and before push; dirty-tree success cannot certify the new
Git identity. Local planner counterchecks passed; fresh hosted acceptance remains
required. No already-passed product suite from this failed run existed to reuse.

Before the corrected push, the actual currentness check also caught the copied
Admin schema label still at 0098. Auth now bundles the canonical release manifest
using its existing JSON-import mechanism, removing that duplicate moving number.
The real protected readiness-route tests compare its response to the manifest;
currentness and the Worker build check the caller. This supersedes the earlier
instruction to manually keep the Admin label aligned on every migration.
