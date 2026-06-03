# Phase J - Release Hardening And Layout Work Reduction

## Executive Summary

Phase J replaced two legacy production-looking media fixtures with deterministic test-owned fixtures, removed the obsolete production assets after clean source and build-output scans, and added one low-risk hidden-tab runtime guard for decorative homepage ghost-label animation work.

The release hardening result is a smaller static payload and clearer test contract ownership:

- Removed `assets/images/1.jpg` after tests moved to `tests/fixtures/media/favorite-thumb.jpg`.
- Removed `assets/images/hero/hero-flow-mobile.mp4` after video tests moved to `tests/fixtures/media/test-video.mp4`.
- Preserved `assets/images/1.png` because it remains an active SEO/social/preload/JSON-LD asset.
- Added a `document.hidden` guard to the category ghost-label interval so hidden tabs do not recalculate decorative slot styles.
- Did not change Worker routes, D1 migrations, R2/bindings/config, API contracts, billing/credit/model behavior, auth contracts, SEO metadata, legal copy, visible layout, colors, typography, or deployment workflows.

## Repository State Inspected

| Item | Value |
| --- | --- |
| Branch | `main` |
| Latest commit | `d6b46d23 PhaseI` |
| Working tree before Phase J edits | clean |
| Local Node | `v26.0.0` |
| Local npm | `11.12.1` |
| Declared engine | `node >=20 <21`, `npm >=10` |
| `.nvmrc` | `20` |
| GitHub Actions Node | `20` in `.github/workflows/static.yml`, `.github/workflows/ui-fast-deploy.yml`, and the memvid processor workflow |
| Local Node 20 status | Not available locally; `nvm`, `fnm`, `volta`, `asdf`, `node20`, and `n` were not found. A filesystem search did not find a usable Node 20 binary. |
| Toolchain check under local Node 26 | Passed |

Node 20 local validation is still required before release if CI is not used as the Node 20 validation source. The repository already declares and uses Node 20 in CI, but this workstation validation ran under Node 26.

## Phase A-I Baseline Recap

| Phase | Result |
| --- | --- |
| A | Lazy-loaded homepage Create-only modules and reduced the initial homepage static graph by 44,320 source bytes. |
| B | Lazy-loaded the homepage Models overlay and added first-click replay guards for lazy Create readiness. |
| C | Completed media/CSS/runtime audit with no runtime changes. |
| D | Added media derivative inventory and visual guardrail tooling. |
| E | Removed dead category-arrow assets/CSS/JS and orphan images; preserved `assets/images/1.png`, `assets/images/1.jpg`, and `hero-flow-mobile.mp4` due active or fixture risk. |
| F | Added CSS route inventory tooling. |
| G | Removed static `css/components/wallet.css` from EN/DE Pricing; expanded visual guardrails. |
| H | Removed static homepage `assets-manager.css`, added dynamic authenticated Create CSS loader, removed Pricing `legal.css`, and added Create cancellation guards. |
| I | Added runtime inventory tooling, removed empty particle rAF loop, hardened particle scheduling, improved scroll reveal cleanup, and added binary rain idempotency. |

## Legacy Fixture Contract Audit

| Asset | Source scan result | Build-output result | Classification | Decision |
| --- | --- | --- | --- | --- |
| `assets/images/1.png` | Active in public pages as preload/social/structured image and tests | Active in `_site` | SEO/social/preload asset | Keep unchanged |
| `assets/images/1.jpg` | Referenced only by tests and manifest before Phase J | No runtime requirement after test rewrite | Test thumb URL fixture | Replaced with `tests/fixtures/media/favorite-thumb.jpg`, then deleted |
| `assets/images/hero/hero-flow-mobile.mp4` | Referenced only by tests and manifest before Phase J | No runtime requirement after test rewrite | Test MP4 byte/range fixture | Replaced with `tests/fixtures/media/test-video.mp4`, then deleted |

The worker favorite URL contract does not require the file to exist. It validates same-origin slash-prefixed URL shape, query/hash rejection, and accepted gallery/API/public thumbnail forms. Phase J preserved those checks with a slash-prefixed test fixture path.

The static/auth-admin video tests require MP4 bytes and range behavior. Phase J preserved `video/mp4`, range fulfillment, and inline preview semantics with a 1-second 16x16 H.264 fixture.

## Implemented Fixture And Media Changes

| Change | Old | New | Safety reason |
| --- | --- | --- | --- |
| Auth-admin MP4 fixture | `assets/images/hero/hero-flow-mobile.mp4` | `tests/fixtures/media/test-video.mp4` | Keeps the same test helper and MP4/range response behavior while removing static asset dependency. |
| Smoke MP4 fixture | `assets/images/hero/hero-flow-mobile.mp4` | `tests/fixtures/media/test-video.mp4` | Keeps homepage video hover fixture behavior without shipping the legacy MP4. |
| Worker favorite thumb URL fixture | `/assets/images/1.jpg` | `/tests/fixtures/media/favorite-thumb.jpg` | Preserves same-origin slash path validation; query/hash invalid cases still fail. |
| Auth-admin favorite fixture | `/assets/images/1.jpg` | `/tests/fixtures/media/favorite-thumb.jpg` | Keeps the favorite row omission contract without requiring a static production image. |
| Manifest | Deferred fixture entries | Removed fixture replacement entries | Current inventory now reflects that the legacy files are removed and test-owned fixtures replace them. |

Generated fixtures:

| Fixture | Bytes | Properties |
| --- | ---: | --- |
| `tests/fixtures/media/favorite-thumb.jpg` | 222 | JPEG, 16x16 |
| `tests/fixtures/media/test-video.mp4` | 1,953 | MP4/H.264, 16x16, 1 second, `faststart` |

The legacy removed bytes were 536,335 bytes for `1.jpg` and 2,170,158 bytes for `hero-flow-mobile.mp4`.

## Test Contract And Flake Hardening Changes

Phase J did not weaken tests or remove coverage. It made the fixture contract deterministic by moving the test media under `tests/fixtures/media/` and centralizing the worker favorite path as `TEST_FAVORITE_THUMB_URL`.

The previous production-looking asset paths were a hidden release hazard: deleting or changing static media could break test contracts that were not actually testing those production assets. The new contract makes that ownership explicit.

## Layout And Runtime Candidate Matrix

| Candidate | Files | Evidence | Risk | Decision |
| --- | --- | --- | --- | --- |
| J-R1: category ghost hidden-tab interval guard | `js/pages/index/category-ghost-models.js` | `setInterval` recalculated decorative style slots every 3.6s even when the document was hidden. | Low | Implemented `if (document.hidden === true) return;` inside the interval callback. |
| J-R2: homepage inline scroll restoration reduction | `index.html`, `de/index.html` | Inline scripts intentionally retry scroll restoration across rAF and timeout windows to preserve reload/hash behavior. | High | Deferred; changing this could break reload scroll restoration and category hash semantics. |
| J-R3: category carousel layout scheduler refactor | `js/pages/index/category-carousel.js` | Runtime inventory flags multiple rAF/timer paths, but they are tied to staged layout, hash navigation, resize, and Phase H cancellation guards. | Medium/high | Deferred; no low-risk simplification survived without stronger browser timing proof. |
| J-R4: latest models video offscreen/visibility lifecycle | `js/pages/index/latest-models-video-module.js` | Timers and autoplay video lifecycle are present, but WebKit/mobile video behavior is sensitive. | Medium/high | Deferred; keep for Phase K with focused Safari/mobile proof. |
| J-R5: public media wall render scheduling | `gallery.js`, `video-gallery.js`, `soundlab.js`, `public-media-wall.js` | Existing modules already contain metrics/cache guards and state-aware behavior. | Medium | Deferred; changing layout scheduling risks visible item/grid behavior. |

## Implemented Runtime/Layout Reductions

The only runtime code change was the hidden-tab guard in `category-ghost-models.js`. It reduces unnecessary decorative interval work while the page is hidden and does not affect visible normal-motion animation, model labels, category ordering, layout, hash behavior, or locale behavior.

## Deferred Candidates

- Node 20 local validation: deferred to CI or a workstation with Node 20 because no local Node 20 runtime was available.
- Scroll restoration scheduling: deferred because it protects reload and hash category behavior.
- Category carousel layout scheduler changes: deferred due staged desktop/tablet/mobile layout coupling.
- Latest models video offscreen gating: deferred due autoplay and Safari/mobile video lifecycle risk.
- Media wall resize/render scheduler changes: deferred because current guards exist and layout parity risk is non-trivial.

## Before/After Measurements

| Measurement | Before Phase J | After Phase J | Delta |
| --- | ---: | ---: | ---: |
| `_site` files | 218 | 216 | -2 |
| `_site` image files | 8 | 7 | -1 |
| `_site` image bytes | 1,385,592 | 849,257 | -536,335 |
| `_site` video files | 1 | 0 | -1 |
| `_site` video bytes | 2,170,158 | 0 | -2,170,158 |
| `_site` total removed media bytes | - | - | -2,706,493 |
| Static homepage graph modules | 47 | 47 | 0 |
| Static homepage graph source bytes | 802,261 | 802,307 | +46 |
| CSS files/bytes | 22 / 739,057 | 22 / 739,057 | 0 |
| Runtime `document.hidden` guards | 3 | 4 | +1 |
| Runtime rAF static signal count | 49 | 49 | 0 |
| Runtime setInterval static signal count | 4 | 4 | 0 |

The +46 source-byte homepage graph change is the hidden-tab guard. The static media payload reduction is the primary release-hardening byte reduction.

## Browser And Device Compatibility Notes

- The fixture replacement affects tests and static asset inventory only; it does not change runtime media references.
- The hidden-tab guard uses `document.hidden`, which is already part of the repository's runtime compatibility baseline and only changes hidden-document behavior.
- No normal-motion visible animation, reduced-motion path, category routing, or layout behavior was intentionally changed.
- WebKit/Safari video runtime behavior was not changed; the legacy MP4 was not a runtime source.

## Rollback Plan

1. Restore `assets/images/1.jpg` and `assets/images/hero/hero-flow-mobile.mp4`.
2. Repoint test fixture reads and favorite URL literals to the old paths.
3. Revert the manifest entries to deferred fixture review.
4. Remove the hidden-tab guard in `category-ghost-models.js` if needed.

Rollback does not require Worker, D1, R2, binding, secret, or Cloudflare dashboard changes.

## Validation Commands And Results

Final validation ran under local Node `v26.0.0`/npm `11.12.1` because no Node 20 binary was available on this workstation. CI workflows and `.nvmrc` remain configured for Node 20.

| Command | Result |
| --- | --- |
| `npm run check:toolchain` | Passed |
| `npm run check:js` | Passed |
| `npm run check:dom-sinks` | Passed |
| `npm run check:doc-currentness` | Passed |
| `npm run test:doc-currentness` | Passed |
| `npm run build:static` | Passed |
| `npm run audit:performance` | Passed |
| `npm run audit:performance:markdown` | Passed |
| `npm run audit:media-derivatives` | Passed |
| `npm run audit:media-derivatives:markdown` | Passed |
| `npm run audit:css-routes` | Passed |
| `npm run audit:css-routes:markdown` | Passed |
| `npm run audit:runtime` | Passed |
| `npm run audit:runtime:markdown` | Passed |
| `npm run audit:visual-guardrails` | Passed: 40 scenarios, 0 warnings, 52 expected local auth/stub console notices filtered |
| `npm run test:asset-version` | Passed |
| `npm run validate:asset-version` | Passed |
| `npm run test:release-compat` | Passed |
| `npm run validate:release` | Passed |
| `npm run check:static-deploy-safety` | Passed: local plan `static_only`, no Worker deploys, schema applies, non-static deploy steps, or manual prerequisites |
| `npm run test:static-deploy-safety` | Passed |
| `npm run test:static` | Passed: 355/355 |
| `npm run test:workers` | Passed: 673/673 |
| `npm test` | Passed: 355 static tests and 673 worker tests |
| `git diff --check` | Passed |

## Phase K Recommendations

1. Run the full validation set under Node 20 locally or treat GitHub Actions Node 20 as the release evidence source.
2. Continue runtime work with focused browser probes for scroll restoration, category carousel scheduler behavior, and latest-models video offscreen lifecycle.
3. Preserve `assets/images/1.png` unless a dedicated SEO/social/favicon review approves exact replacement behavior.
4. Keep test-only media under `tests/fixtures/media/` so production asset cleanup does not accidentally depend on test contracts.
