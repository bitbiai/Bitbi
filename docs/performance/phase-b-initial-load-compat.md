# BITBI Phase B Initial Load Compatibility Report

## Executive Summary

Phase B implemented one conservative homepage startup optimization and one required documentation-currentness fix.

- Homepage initial static module graph before Phase B: 60 modules, 925,343 source bytes.
- Homepage initial static module graph after Phase B: 47 modules, 801,606 source bytes.
- Measured local source-byte delta: -123,737 source bytes and -13 static modules.
- Optimization implemented: lazy-load `js/shared/models-overlay.js` and its static dependency graph on first Models interaction or `#models` hash use.
- Compatibility fix implemented: classify `docs/performance/phase-*.md` reports as historical performance evidence so doc-currentness remains strict without blocking Phase A/Phase B performance reports.

No production Lighthouse, RUM, CDN, Core Web Vitals, LCP, INP, or CLS measurements were taken. The performance result is a local static source graph reduction and an expected reduction in initial parse/evaluation work.

## Phase A Baseline Recap

Phase A established the local inventory tooling and moved homepage Create-only modules behind dynamic imports:

- `js/pages/index/studio.js`
- `js/pages/index/video-create.js`
- `js/pages/index/soundlab-create.js`

The Phase B starting inventory, measured locally before Phase B edits, was:

| Metric | Value |
| --- | ---: |
| Homepage static modules | 60 |
| Homepage static source bytes | 925,343 |
| Homepage dynamic imports already present | `studio.js`, `video-create.js`, `soundlab-create.js` |

## Phase B Goals And Non-goals

Goals:

- Reduce public homepage initial JavaScript parse/evaluation cost only where a lazy boundary is proven safe.
- Preserve first-click behavior and exactly-once initialization semantics.
- Preserve asset-version placeholder use in dynamic imports.
- Fix the blocking doc-currentness failure for performance phase reports without weakening unknown Markdown checks.
- Record compatibility and validation evidence for future phases.

Non-goals:

- No visible redesign, layout, copy, navigation, animation, color, typography, route, locale, API, Worker, billing, credit, AI model, or Cloudflare configuration changes.
- No image/video compression, CSS consolidation, bundler migration, package changes, D1 migration, dependency addition, or deployment action.
- No production performance claims.

## Exact Commands Run

| Command | Result |
| --- | --- |
| `git status --short` | Passed before edits; working tree was clean. |
| `node --version` | `v26.0.0`; note that `package.json` declares `>=20 <21`. |
| `npm --version` | `11.12.1`. |
| `npm run audit:performance` | Passed before edits; recorded 60 modules / 925,343 source bytes. |
| `npm run audit:performance:markdown` | Passed before edits; same graph numbers. |
| `npm run check:doc-currentness` | Failed before edits as expected because `docs/performance/phase-a-baseline.md` was unclassified. |
| `npm run test:doc-currentness` | Passed before edits. |
| `npm run test:doc-currentness` | Passed after doc-currentness fix. |
| `npm run check:doc-currentness` | Passed after doc-currentness fix. |
| `npm run check:js` | Passed. |
| `npm run build:static` | Passed. |
| `npm run check:toolchain` | Passed despite the local Node version being newer than the declared engine. |
| `npm run check:dom-sinks` | Passed. |
| `npm run audit:performance` | Passed after edits; recorded 47 modules / 801,606 source bytes. |
| `npm run audit:performance:markdown` | Passed after edits; same graph numbers. |
| `npm run test:asset-version` | Passed. |
| `npm run validate:asset-version` | Passed. |
| `npm run test:release-compat` | Passed. |
| `npm run validate:release` | Passed. |
| `npm run check:static-deploy-safety` | Passed before this report was added; rerun required after final documentation write. |
| `npm run test:static-deploy-safety` | Passed. |
| `npm run test:static` | Passed: 355 tests. |
| `npm run test:workers` | Passed: 673 tests. |
| `npm test` | First run found a real lazy-boundary regression in the Phase A Create flow; after the replay guard fix, full `npm test` passed: 355 static tests and 673 worker tests. |
| `npx playwright test -c playwright.config.js tests/auth-admin.spec.js -g "homepage create studio sends a fresh idempotency key for each image generation click"` | Passed after the Create generate-click replay fix. |

One local command batch accidentally ran `npm run build:static` and inventory commands in parallel. Inventory briefly failed with `_site` missing while the build was replacing it. The commands passed when rerun sequentially.

## Baseline Measurements Before Phase B Changes

| Measurement | Value |
| --- | ---: |
| Homepage static modules | 60 |
| Homepage static source bytes | 925,343 |
| Largest initial concern from candidate review | Models Overlay dependency graph |
| Doc-currentness state | Blocking failure for unclassified `docs/performance/phase-a-baseline.md` |

## Candidate Evaluation

| Candidate | Current startup role | Estimated source-byte impact | Safety level | Decision | Reason |
| --- | --- | ---: | --- | --- | --- |
| Models Overlay | Imported and initialized on homepage startup, but only needed for `[data-models-link]` clicks or `#models` hash. | Final measured graph delta after implementation: -123,737 source bytes. | Low to medium | Implemented | Stable DOM triggers exist in EN/DE pages. First click can be replayed after import. Existing excluded homepage model IDs and locale behavior are preserved. |
| Help Menu | Creates the visible help trigger on startup. | Not independently measured. | Medium | Deferred | Lazy-loading would require a visible skeleton or markup change. Keeping it eager preserves visible UI exactly. |
| Wallet Controller | Initializes wallet/auth-related visible state and wallet interactions. | Not independently measured. | High | Deferred | Coupled to auth modal wallet sign-in, profile/nav state, and injected provider behavior. |
| Global Audio UI | Supports Sound Lab/media playback state. | Not independently measured. | High | Deferred | User gesture timing and playback controls are behavior-sensitive. |
| News Pulse | Visible in homepage hero and fetches visible content. | Not independently measured. | Medium | Deferred | Deferring it would change visible timing/content. |
| Auth Modal / Auth Entry Actions | Used by guest Create gates, auth nav actions, recovery flows, and wallet auth paths. | Not independently measured. | Medium to high | Deferred | Possible Phase C target, but first-click auth behavior is too important for Phase B without a broader wrapper and tests. |
| Favorites | Loads member favorite state and updates visible media controls. | Not independently measured. | Medium | Deferred | Deferring could create visible favorite-state flicker or incorrect initial state. |

## Implemented Changes

### Models Overlay Lazy Load

`js/pages/index/main.js` no longer statically imports the models overlay. It now installs a small delegated loader for `[data-models-link]` triggers and imports:

```js
import('../../shared/models-overlay.js?v=__ASSET_VERSION__')
```

The loader:

- Caches the dynamic import promise.
- Initializes the overlay once with the existing homepage excluded model IDs.
- Preserves mobile nav closing behavior for the mobile trigger.
- Opens/toggles the overlay on the original first click.
- Preserves `#models` hash behavior.
- Logs import/init failures with the existing `modelsOverlay:` warning style.

`js/shared/models-overlay.js` now exports small `openModelsOverlay()` and `toggleModelsOverlay()` wrappers around the existing internal open/close behavior. The existing `initModelsOverlay(...)` binding behavior remains unchanged for any caller that imports it eagerly.

### Create Lazy-boundary Replay Guard

Full static tests exposed a real race in the existing Phase A lazy Create modules: a user or test could open a Create pane and click Generate before the lazily imported module attached its button handler. Phase B added small capture-phase guards for:

- `#galStudioGenerate`
- `#videoGenerate`
- `#soundMusicGenerate`

If the first Generate click arrives before the lazy module is ready, the guard waits for the module initialization promise and replays the same button click once. This preserves first-click behavior without changing payloads, model lists, billing, UI copy, or generated output behavior.

### Doc-currentness Classification

`docs/performance/phase-*.md` is now classified as `historical_phase_report`. The rule is narrow and only matches performance phase report filenames under `docs/performance/`.

## Before/After Source Graph Measurements

| State | Static modules | Source bytes | Delta modules | Delta source bytes |
| --- | ---: | ---: | ---: | ---: |
| Before Phase B | 60 | 925,343 | - | - |
| After Phase B | 47 | 801,606 | -13 | -123,737 |

This is a static source graph measurement, not a transfer-size or production timing measurement.

## Compatibility Verification Matrix

| Area | Result | Notes |
| --- | --- | --- |
| English homepage `/` | Passed through static test suite and full `npm test`. | No intentional visual changes. |
| German homepage `/de/` | Passed through static test suite and full `npm test`. | Same lazy loader uses shared `[data-models-link]` triggers. |
| Gallery Explore | Passed through static test suite. | Initial Explore rendering unchanged. |
| Video Explore | Passed through static test suite. | Initial Explore rendering unchanged. |
| Sound Lab Explore | Passed through static test suite. | Audio UI left eager. |
| Guest Create gates | Passed after the Generate replay fix. | Auth gate and first-click behavior preserved. |
| Models overlay first click | Covered by static tests and loader logic; direct browser-family check was attempted. | Direct local Chromium/Firefox/WebKit launch was blocked by macOS sandbox process permissions outside the test runner. |
| Mobile nav | Static tests passed. | Mobile Models trigger still closes nav before opening overlay. |
| Hash navigation `#models` | Loader preserves the existing deep-link behavior. | `#gallery`, `#video-creations`, and `#soundlab` logic was not changed. |
| Reduced motion | No animation code changed. | Existing reduced-motion behavior remains unchanged. |
| Coarse pointer/tablet | No hover/pointer behavior changed. | Existing static suite passed; manual device testing still recommended. |
| Doc-currentness | Passed after classification. | Unknown Markdown remains blocked. |

## Manual QA Checklist And Results

Automated local validation covered the core homepage flows. Manual live browser/device QA was limited by the local sandbox for direct browser-family launch, so these remain recommended preview checks before release:

- Open `/` and `/de/`; verify hero/nav/category structure appears unchanged.
- Switch Gallery, Video, and Sound Lab Explore categories.
- Open/close mobile nav.
- Click Models trigger on desktop and mobile; confirm overlay opens on first click and closes/reopens.
- Use `#models` hash directly.
- As guest, click Gallery Create, Video Create, and Sound Lab Create; confirm auth modal opens on first click.
- With an authenticated local state, open each Create pane and click Generate immediately; confirm no dropped first click.
- Confirm cookie settings, contact drawer, footer, and locale switcher remain unchanged.

## Doc-currentness Fix

Root cause:

- Phase A added `docs/performance/phase-a-baseline.md`.
- The doc-currentness inventory did not classify performance phase reports.
- The file correctly failed as `unknown_needs_review`, because the tooling intentionally blocks unclassified first-party Markdown.

Classification decision:

- `docs/performance/phase-*.md` files are historical performance audit phase reports and local measurement evidence.
- They are not active release truth, release prerequisites, or current-state deployment documentation.

Files changed:

- `scripts/lib/doc-currentness.mjs`
- `scripts/test-doc-currentness.mjs`
- `docs/audits/README.md`

Why the rule is narrow and safe:

- It only matches `docs/performance/phase-[a-z0-9-]+.md`.
- It does not classify all unknown Markdown.
- It does not create a broad `docs/**` catch-all.
- It does not suppress `unknown_needs_review`.
- The existing unknown Markdown test remains effective.

Validation:

- `npm run check:doc-currentness`: passed after the fix.
- `npm run test:doc-currentness`: passed after the fix.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Dynamic import failure could prevent Models overlay from opening. | Import promise errors reset the cache and log a warning. Other homepage features continue to work. |
| First-click Models interaction could be dropped. | The click handler prevents default only before initialization, imports the module, then opens/toggles the overlay from the same event path. |
| Create pane Generate clicks could race lazy module initialization. | Capture-phase replay guards wait for module readiness and replay the same button click once. |
| Cross-browser manual verification was incomplete locally. | Full Playwright static and worker suites passed; direct browser-family launch failure is documented as an environment limitation. Preview/manual QA remains recommended. |
| Node version mismatch could hide engine-specific issues. | `check:toolchain` passed, but local Node was `v26.0.0` while the repo declares `>=20 <21`; CI should use the declared engine. |

## Deferred Phase C Candidates

- Auth modal lazy wrapper with full guest/auth recovery/wallet coverage.
- Help menu startup skeleton or server-rendered trigger if a visible-neutral lazy boundary is approved.
- Wallet controller split between visible auth-state sync and wallet-specific provider logic.
- Global audio UI lazy boundary with media gesture tests.
- CSS render-blocking consolidation after visual screenshot baselines exist.
- Hero/media asset byte optimization after product/design review.
- Broader MediaQueryList listener fallback hardening.

## Final Recommendation

Ship after standard preview/manual browser QA.

Phase B reduces the local homepage initial static source graph by 123,737 source bytes and fixes the blocking doc-currentness classification without changing visible design, routes, product behavior, API contracts, model behavior, billing, credits, Workers, D1 migrations, bindings, or deployment configuration.
