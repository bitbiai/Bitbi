# BITBI Phase I Runtime, Animation, and Layout Work Reduction

## Executive summary

Phase I implemented a conservative runtime work reduction pass focused on provably safe homepage/effect lifecycle wins:

- Added `scripts/runtime-work-inventory.mjs` plus `audit:runtime` scripts for deterministic local runtime hotspot inventory.
- Eliminated the homepage's empty particle animation loop. The homepage currently calls `initParticles('heroCanvas', { maxParticles: 0, nebulaCount: 0, showConnections: false })`; before Phase I that still scheduled a recurring `requestAnimationFrame` loop that only cleared an empty canvas. The canvas is still sized and available for existing callers, but no rAF loop starts when there is no particle/nebula work.
- Added a rAF scheduling guard and cancellation path in `js/shared/particles.js` so visibility/intersection resumes cannot create duplicate animation loops.
- Updated `js/shared/scroll-reveal.js` so one-shot reveal elements are unobserved after they become visible, and browsers without `IntersectionObserver` reveal content immediately instead of leaving it hidden.
- Added an idempotency guard to `js/shared/binary-rain.js` so repeated initializer calls cannot append duplicate animated binary columns.
- Expanded visual guardrail metrics with a local rAF probe. This is test tooling only and is not shipped to production pages.

No visible design, layout, route behavior, API contract, Worker, model, billing, credit, SEO/social metadata, or asset behavior was changed intentionally.

## Repository state

| Item | Result |
| --- | --- |
| Branch | `main` |
| Latest commit inspected before Phase I edits | `c0b7446c PhaseH` |
| Working tree before Phase I | Clean |
| Node | `v26.0.0` |
| npm | `11.12.1` |
| Declared engine | Node `>=20 <21`; local Node is outside the declared range. |
| Toolchain check | `npm run check:toolchain` passed. |

## Phase A-H recap

| Phase | Current outcome |
| --- | --- |
| A | Lazy-loaded homepage Create-only modules and preserved authenticated Create behavior. |
| B | Lazy-loaded Models overlay and preserved first-click behavior with replay guards. |
| C | Audited media/CSS/runtime cost; no runtime changes. |
| D | Added media derivative inventory and visual guardrail tooling. |
| E | Removed dead category-arrow assets/CSS/JS and orphan media; preserved SEO/social/test-risk assets. |
| F | Added CSS route inventory tooling; no CSS route changes. |
| G | Removed static wallet CSS from Pricing EN/DE and expanded visual guardrails. |
| H | Removed static homepage `assets-manager.css`, added dynamic Create CSS loader, removed Pricing legal CSS, and expanded member Create guardrails. |

## Current runtime cost inventory

Baseline inspection before code edits found these runtime hotspots:

| Surface | Evidence | Phase I decision |
| --- | --- | --- |
| Homepage hero canvas particles | `js/pages/index/main.js` initializes particles with `maxParticles: 0`, `nebulaCount: 0`, and `showConnections: false`; `js/shared/particles.js` still scheduled `requestAnimationFrame(loop)`. | Implemented no-op loop skip and duplicate-frame guard. |
| Scroll reveal | `js/shared/scroll-reveal.js` observed every `.reveal` element and never unobserved after reveal. | Implemented one-shot `unobserve()` after visibility. |
| Binary rain | `initBinaryRain()` appended animated columns every time it was called. Current routes call once, but repeated init would duplicate DOM/animations. | Implemented idempotency guard. |
| Category carousel | Static scan shows 13 rAF signals and 6 timers, but inspection shows transition/hash/layout handling is tightly coupled to staged layout and Phase H cancellation behavior. | Deferred. |
| Gallery/video/sound media walls | Existing token guards, resize observers, render-ready validation, and layout-change checks already reduce stale work; further scheduling changes risk layout regressions. | Deferred. |
| Latest models video module | Timers rotate visible hero media; offscreen/hidden gating could reset visible video state on return. | Deferred to a browser-measured Phase J candidate. |
| Inline homepage scroll restoration | Inline scripts schedule repeated restore attempts only on reload. High route/hash risk. | Deferred. |

Post-change runtime inventory:

| Metric | Result |
| --- | ---: |
| JS files with runtime signals | 57 |
| CSS files with animation/effect signals | 19 |
| HTML files with inline runtime signals | 23 |
| `requestAnimationFrame` source signals | 49 |
| `setTimeout` source signals | 60 |
| `setInterval` source signals | 4 |
| `IntersectionObserver` source signals | 5 |
| `ResizeObserver` source signals | 17 |
| `MutationObserver` source signals | 12 |
| `document.hidden` guard signals | 3 |
| `prefers-reduced-motion` JS guard signals | 12 |

Static source counts are inventory signals, not browser frame cost. The particle no-op reduction is behavioral: it avoids starting a recurring frame loop when homepage particle/nebula counts are both zero.

## Browser measurement plan and results

Visual/runtime guardrails use the local static build and local API stubs. They do not invoke paid generation, billing mutation, payment, or production APIs.

Post-change guardrail summary:

| Browser | Coverage | Result |
| --- | --- | --- |
| Chromium | All configured routes/viewports, including member homepage Create state. | Passed. |
| Firefox | Homepage and Pricing desktop coverage plus homepage mobile/reduced-motion coverage. | Passed. |
| WebKit | Homepage and Pricing desktop coverage plus homepage mobile/reduced-motion coverage. | Passed. |
| Mobile | Chromium mobile route coverage and mobile nav state. | Passed. |
| Tablet | Chromium tablet route coverage. | Passed. |
| Reduced motion | Homepage desktop and mobile, plus Firefox/WebKit homepage reduced-motion desktop. | Passed. |

Representative Chromium runtime metrics after Phase I:

| Route/state | DOM nodes | CSS animations reported | Images | Videos | Resources | rAF scheduled | rAF callbacks | Active rAF at capture | Max active rAF |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Home EN desktop initial | 1,413 | 97 | 3 | 0 | 75 | 28 | 23 | 0 | 9 |
| Home EN member desktop initial | 1,409 | 93 | 3 | 0 | 77 | 27 | 22 | 0 | 9 |
| Home EN member Create | 1,413 | 111 | 3 | 0 | n/a | 55 | 48 | 2 | 9 |
| Generate Lab EN desktop initial | 802 | 22 | 0 | 0 | 74 | 23 | 22 | 1 | 1 |
| Pricing EN desktop initial | 640 | 20 | 1 | 0 | 59 | 25 | 24 | 1 | 1 |

The rAF probe was added during Phase I guardrail work, so direct before/after browser rAF counts are not available. The static runtime evidence for the particle fix is exact: before Phase I the empty homepage particle config still reached the `requestAnimationFrame(loop)` path; after Phase I that path returns a compatible handle before scheduling animation.

## Candidate matrix

| Candidate | Files/routes | Current cost/evidence | Risk | Impact | Status | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| I1 empty particle rAF loop | `js/shared/particles.js`, homepage | Homepage zero particle/nebula config still ran recurring canvas clears. | Low | Medium | Implemented | Remove no-op return and `scheduleLoop()` guard. |
| I2 particle duplicate rAF scheduling guard | `js/shared/particles.js` | Intersection/visibility resumes could request a loop without checking for an already scheduled frame. | Low | Low-medium | Implemented | Restore direct `requestAnimationFrame(loop)` calls. |
| I3 scroll reveal one-shot cleanup | `js/shared/scroll-reveal.js` | Observed `.reveal` elements remained observed after reveal. | Low | Low-medium | Implemented | Remove `observer.unobserve(entry.target)`. |
| I4 `IntersectionObserver` fallback | `js/shared/scroll-reveal.js` | Older/no-IO browsers could leave reveal content hidden. | Low | Low | Implemented | Remove fallback branch. |
| I5 binary rain idempotency | `js/shared/binary-rain.js` | Repeated init could append duplicate animated columns. | Low | Low | Implemented | Remove `data-binary-rain-ready` guard. |
| I6 category carousel layout/timer reduction | `js/pages/index/category-carousel.js` | Many rAF/timer signals, but tied to staged layout, hash, scroll restoration, and Phase H cancellation. | Medium-high | Medium | Deferred | Needs targeted browser trace and hash/reload coverage. |
| I7 media wall render scheduling | `gallery.js`, `video-gallery.js`, `soundlab.js`, `public-media-wall.js` | Existing token guards and metric checks present; changes risk masonry/card layout. | Medium | Medium | Deferred | Needs deeper route-state visual diffing. |
| I8 latest models video offscreen gating | `latest-models-video-module.js` | Timers/videos can continue after scroll, but pausing may reset visible state. | Medium | Medium | Deferred | Needs offscreen/return user-flow trace. |
| I9 inline scroll restoration reduction | `index.html`, `de/index.html` | Repeated rAF/timer restore attempts on reload only. | High | Medium | Deferred | High hash/reload behavior risk. |

## Implemented changes

### Particle no-op and duplicate-loop guard

`initParticles()` now:

- creates the same canvas sizing/resize observer setup;
- returns the same style of handle with `destroy()`;
- skips the animation loop when particle count and nebula count resolve to zero;
- tracks a pending animation frame and avoids duplicate scheduling;
- cancels the pending frame on `destroy()`.

This preserves legal/account/admin/generate-lab particle behavior because those routes use nonzero defaults.

### Scroll reveal lifecycle cleanup

Reveal behavior remains visually the same for normal-motion users: elements become visible when intersecting. Once visible, each element is unobserved. Reduced-motion users still receive immediate reveal, and no-`IntersectionObserver` browsers now get immediate visible content.

### Binary rain idempotency

`initBinaryRain()` now tags the container after first initialization. Repeated calls return without appending duplicate animated columns. The first initialization path and reduced-motion skip remain unchanged.

### Runtime inventory and guardrail metrics

`scripts/runtime-work-inventory.mjs` scans frontend runtime source only, excluding build, tests, Workers, docs, and report artifacts. It reports JS rAF/timer/observer/listener signals, CSS animation/compositor signals, and inline HTML runtime signals in text or Markdown.

`scripts/capture-visual-guardrails.mjs` now records a local rAF probe per scenario. This is only visual-audit instrumentation.

## Before / after measurements

| Metric | Before Phase I | After Phase I | Delta |
| --- | ---: | ---: | ---: |
| Static homepage graph | 47 modules / 801,560 bytes | 47 modules / 802,261 bytes | 0 / +701 |
| `_site` JS bytes | 2,358,162 | 2,358,863 | +701 |
| CSS files / bytes | 22 / 739,057 | 22 / 739,057 | 0 |
| Homepage CSS links / bytes | 8 / 298,784 | 8 / 298,784 | 0 |
| Pricing CSS links / bytes | 7 / 127,853 | 7 / 127,853 | 0 |
| Images | 8 / 1,385,592 bytes | 8 / 1,385,592 bytes | 0 |
| Video | 1 / 2,170,158 bytes | 1 / 2,170,158 bytes | 0 |
| Generated derivatives | 0 | 0 | 0 |
| Visual guardrail scenarios | 40 | 40 | 0 |
| Visual guardrail warnings | 0 | 0 | 0 |

The source-byte increase is the small runtime guard/tooling cost. The runtime benefit is reduced per-frame work, observer lifetime, and duplicate animation DOM risk.

## Browser/device compatibility notes

- Normal-motion visual behavior is preserved. The particle no-op affects an empty canvas that has no visible particle/nebula output on the homepage.
- Reduced-motion behavior is not worsened. Reveal behavior remains immediate; particle reduced-motion behavior is unchanged for nonzero-particle routes.
- Safari/WebKit guardrails passed on homepage and Pricing coverage after the changes.
- The no-`IntersectionObserver` reveal fallback improves compatibility by preventing permanently hidden reveal content.
- The `binaryRainReady` dataset guard is invisible and only prevents duplicate DOM mutation on repeated initialization.

## Deferred Phase J candidates

- Add a focused Playwright trace for category-carousel alignment and hash/reload restore before changing alignment timers.
- Investigate latest-models video offscreen/page-hidden gating with scroll-away and scroll-back scenarios.
- Add media wall render counters before changing gallery/video/sound masonry scheduling.
- Consider reduced-motion CSS hardening for admin/profile/wallet CSS only after dedicated route-state coverage.
- Consider turning the runtime rAF probe into a standalone optional browser audit script if future phases need before/after browser frame counts.

## Rollback plan

1. Remove `scripts/runtime-work-inventory.mjs` and the two `audit:runtime` package scripts.
2. Revert `js/shared/particles.js` to direct rAF scheduling.
3. Remove the `observer.unobserve()` and no-`IntersectionObserver` fallback from `js/shared/scroll-reveal.js`.
4. Remove the `data-binary-rain-ready` guard from `js/shared/binary-rain.js`.
5. Remove the rAF probe fields from `scripts/capture-visual-guardrails.mjs`.

All changes are static/frontend/tooling only and need no D1 migration, Worker deploy change, binding change, secret, or package install.

## Commands and results

Baseline before edits:

- `git status --short`: clean.
- `git branch --show-current`: `main`.
- `git log -1 --oneline`: `c0b7446c PhaseH`.
- `node --version`: `v26.0.0`.
- `npm --version`: `11.12.1`.
- `npm run check:toolchain`: passed.
- `npm run check:js`: passed.
- `npm run check:dom-sinks`: passed.
- `npm run check:doc-currentness`: passed.
- `npm run build:static`: passed.
- `npm run audit:performance`: passed.
- `npm run audit:performance:markdown`: passed.
- `npm run audit:media-derivatives`: passed.
- `npm run audit:media-derivatives:markdown`: passed.
- `npm run audit:css-routes`: passed.
- `npm run audit:css-routes:markdown`: passed.
- `npm run audit:visual-guardrails`: passed, 40 scenarios, 0 warnings.

Focused post-change checks before final validation:

- `npm run check:js`: passed.
- `npm run build:static`: passed.
- `npm run audit:performance`: passed.
- `npm run audit:performance:markdown`: passed.
- `npm run audit:media-derivatives`: passed.
- `npm run audit:media-derivatives:markdown`: passed.
- `npm run audit:css-routes`: passed.
- `npm run audit:css-routes:markdown`: passed.
- `npm run audit:runtime`: passed.
- `npm run audit:runtime:markdown`: passed.
- `npm run audit:visual-guardrails`: passed, 40 scenarios, 0 warnings.
- Custom local Chromium rAF probe: first attempt failed with sandbox `listen EPERM` on `127.0.0.1`; rerun with approved escalation succeeded but used a simplified server and was not used as primary evidence.

Final validation results are recorded in the final Codex response.
