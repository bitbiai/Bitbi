# BITBI Phase G Large-Batch CSS Optimization

## Executive summary

Phase G expanded CSS route-state evidence and implemented one high-confidence render-blocking reduction: the English and German Pricing routes no longer include the static `css/components/wallet.css` stylesheet link. The shared wallet controller already injects the same wallet stylesheet through `walletConfig.stylesUrl` before it creates wallet UI, so Pricing wallet behavior remains covered while the HTML render-blocking stylesheet list is smaller.

This phase also expanded the CSS route inventory tooling and visual guardrail coverage. Riskier candidates, especially homepage and Generate Lab `assets-manager.css`, shared `auth.css`, admin CSS, and async stylesheet loading, remain deferred because they require broader authenticated/member visual coverage or carry FOUC/Safari risk.

## Repository state

| Item | Result |
| --- | --- |
| Branch | `main` |
| Latest commit | `71745899 Cleanup` |
| Working tree before Phase G | Existing Phase F work was present: `package.json`, `scripts/css-route-inventory.mjs`, and `docs/performance/phase-f-css-route-scope-render-blocking.md`. |
| Node | `v26.0.0` |
| npm | `11.12.1` |
| Declared engine | Node `>=20 <21`; local Node is outside the declared range. |
| Toolchain check | `npm run check:toolchain` passed. |

## Phase A-F recap

| Phase | Current outcome |
| --- | --- |
| A | Lazy-loaded homepage Create-only modules: `studio.js`, `video-create.js`, `soundlab-create.js`. |
| B | Lazy-loaded homepage Models overlay and added first-click replay protection. |
| C | Audited media, CSS, and runtime costs; no runtime CSS/media changes. |
| D | Added media derivative inventory and visual guardrail tooling; no derivatives integrated. |
| E and cleanup | Removed dead category-arrow assets/CSS/JS and `assets/images/2.jpg` through `assets/images/6.jpg`; preserved `assets/images/1.png`, `assets/images/1.jpg`, and `hero-flow-mobile.mp4`. |
| F | Added CSS route inventory tooling; no CSS links/rules changed. |

## Current CSS route inventory

After Phase G:

| Route | CSS links | CSS bytes | Notes |
| --- | ---: | ---: | --- |
| `/` | 9 | 376,262 | Unchanged. |
| `/de/` | 9 | 376,262 | Unchanged. |
| `/pricing.html` | 8 | 129,523 | Reduced from 9 / 158,112 by removing static wallet CSS link. |
| `/de/pricing.html` | 8 | 129,523 | Same reduction as English Pricing. |
| `/generate-lab/` | 8 | 242,142 | Unchanged. |
| `/de/generate-lab/` | 8 | 242,142 | Unchanged. |
| `/admin/` | 8 | 337,572 | Unchanged. |
| Legal routes | 7 | 116,491 | Unchanged. |
| Account Assets Manager | 7 | 192,299 | Unchanged. |

Total CSS files remain 22 and total CSS bytes remain 739,057. Phase G reduces route render-blocking bytes, not the repository's total CSS file set.

## State coverage expansion

The visual guardrail script now captures:

| Surface | Added or retained coverage |
| --- | --- |
| Homepage | Guest initial state, Gallery/Video/Sound Lab scroll states, mobile menu, desktop Models overlay, desktop Create auth-gate first-click state. |
| Generate Lab | Guest/default route and model-card selection state. |
| Pricing | English/German desktop, mobile, tablet; wallet panel first-click state; logged-out auth/registration gate. |
| Legal | English privacy route baseline. |
| Account | Assets Manager guest route baseline. |
| Admin | Admin route unauthenticated/default accessible state. |
| Browsers | Chromium covers all routes/viewports; Firefox and WebKit cover home and Pricing desktop plus home mobile/reduced-motion. |
| Reduced motion | Homepage desktop and mobile. |

Expanded guardrail result after Phase G: 39 scenarios, 0 warnings, 0 browser failures, 52 expected local auth/stub notices filtered.

## CSS candidate matrix

| Candidate | Files/routes | Current load cost | Evidence | Risk | Impact | Status |
| --- | --- | ---: | --- | --- | --- | --- |
| G1 dead category-arrow CSS/JS | `css/pages/index.css`, `js/pages/index/category-carousel.js` | 0 remaining CSS bytes identified | Source scans show no live `.home-categories__arrow*` or `data-category-nav` runtime CSS/JS. Smoke tests still assert absence. | Low | Low | No implementation needed. |
| G2 Pricing static wallet CSS link | `pricing.html`, `de/pricing.html` | 28,589 bytes per Pricing route | `initWalletUI()` calls `ensureStyles()` before wallet trigger/modal creation; guardrails confirm wallet styles load dynamically and wallet/auth states render. | Low | Moderate | Implemented. |
| G3 Homepage `assets-manager.css` | `/`, `/de/` | 77,478 bytes | Used by Create/save/shared asset browser flows; current coverage does not prove authenticated saved-asset states. | Medium-high | High | Deferred. |
| G4 Generate Lab `assets-manager.css` | `/generate-lab/`, `/de/generate-lab/` | 77,478 bytes | Generate Lab has Assets overlay/folder UI coupling and member save flows. | Medium-high | High | Deferred. |
| G5 Admin `assets-manager.css` | `/admin/` | 77,478 bytes | Admin AI Lab saved assets integration and existing tests assert stylesheet presence. | High | High | Deferred. |
| G6 Shared `auth.css` | Public/account/admin/legal routes | 21,893 bytes per route | Auth modal and entry actions are route-wide and state-dependent. | Medium-high | Medium | Deferred. |
| G7 Async/preload stylesheet strategy | All routes | Potential render-blocking reduction | Would risk FOUC/layout timing and needs Safari-specific manual approval. | High | High | Deferred. |
| G8 CSS route tooling | `scripts/css-route-inventory.mjs` | N/A | Existing output lacked route usage, selector families, overlap, and dynamic source-reference evidence. | Low | Medium | Implemented. |
| G9 Visual state tooling | `scripts/capture-visual-guardrails.mjs` | N/A | Phase F coverage was too narrow for CSS link decisions. | Low | High | Implemented. |

## Implemented changes

1. Removed the static `css/components/wallet.css` link from `pricing.html`.
2. Removed the static `../css/components/wallet.css` link from `de/pricing.html`.
3. Extended `scripts/css-route-inventory.mjs` to report:
   - CSS file to route usage,
   - CSS source references for dynamically loaded styles,
   - selector prefix heuristics,
   - route-kind overlap matrix.
4. Extended `scripts/capture-visual-guardrails.mjs` to cover more routes and states:
   - Pricing EN/DE,
   - legal privacy,
   - account Assets Manager guest,
   - Pricing wallet panel and auth gate,
   - homepage Create auth gate,
   - Generate Lab model-card selection,
   - stylesheet link/resource capture in metrics.

## Before / after measurements

| Metric | Before Phase G | After Phase G | Delta |
| --- | ---: | ---: | ---: |
| Total CSS files | 22 | 22 | 0 |
| Total CSS bytes | 739,057 | 739,057 | 0 |
| Homepage CSS links / bytes | 9 / 376,262 | 9 / 376,262 | 0 |
| Generate Lab CSS links / bytes | 8 / 242,142 | 8 / 242,142 | 0 |
| Admin CSS links / bytes | 8 / 337,572 | 8 / 337,572 | 0 |
| Pricing CSS links / bytes | 9 / 158,112 | 8 / 129,523 | -1 / -28,589 |
| Static homepage graph | 47 modules / 798,689 bytes | 47 modules / 798,689 bytes | 0 |
| `_site` images | 8 / 1,385,592 bytes | 8 / 1,385,592 bytes | 0 |
| Visual guardrail scenarios | 25 | 39 | +14 |

Built `_site` HTML total moved from 927,936 bytes in the pre-change baseline to 927,765 bytes after removing the two static stylesheet links.

## Browser/device compatibility

| Browser/device | Result |
| --- | --- |
| Chromium | Passed all expanded routes and desktop/mobile/tablet scenarios. |
| Firefox | Passed homepage and Pricing desktop coverage plus homepage mobile/reduced-motion scenarios. |
| WebKit | Passed homepage and Pricing desktop coverage plus homepage mobile/reduced-motion scenarios. |
| Mobile | Passed Chromium mobile coverage for home, Generate Lab, Pricing, legal, account-assets, and admin. |
| Tablet | Passed Chromium tablet coverage for all configured routes. |
| Reduced motion | Passed homepage desktop and mobile coverage. |
| Limitations | Guardrails use local API stubs and do not verify paid checkout, authenticated member saved-asset flows, or live Cloudflare/Stripe behavior. |

## Deferred candidates

| Candidate | Reason |
| --- | --- |
| Homepage/Generate Lab `assets-manager.css` removal or deferral | Create/save/folder/member states need authenticated coverage; removing could affect first visible save/asset UI. |
| Admin CSS route cleanup | Admin AI Lab has saved-assets coupling and dedicated tests; risk is too high without admin-specific state screenshots. |
| Shared `auth.css` route cleanup | Auth modal is route-wide and first-click behavior is safety-sensitive. |
| Shared component CSS split | `components.css` contains nav, mobile nav, help, models overlay, audio, and cross-route components; static prefix evidence alone is insufficient. |
| Async stylesheet loading | FOUC and Safari/iOS timing risk outweigh current proof. |
| CSS file deletion for dynamically loaded `wallet.css` / `account/wallet.css` | Both are dynamically referenced from wallet config and loaded by wallet UI/workspace. They are not orphaned. |

## Rollback plan

1. Restore the removed wallet stylesheet link in `pricing.html`.
2. Restore the removed wallet stylesheet link in `de/pricing.html`.
3. Revert `scripts/capture-visual-guardrails.mjs` to the Phase F route plan if the expanded scenarios are too slow for CI.
4. Revert `scripts/css-route-inventory.mjs` additions if the extra inventory detail is not desired.

## Commands run

Baseline before edits:

- `git status --short`: existing Phase F files present.
- `git branch --show-current`: `main`.
- `git log -1 --oneline`: `71745899 Cleanup`.
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
- `npm run audit:visual-guardrails`: passed, 25 scenarios, 0 warnings.

Focused after edits:

- `npm run check:js`: passed.
- `npm run build:static`: passed.
- `npm run audit:css-routes`: passed.
- `npm run audit:css-routes:markdown`: passed.
- `npm run audit:visual-guardrails`: passed, 39 scenarios, 0 warnings.
- `npm run audit:performance`: passed.
- `npm run audit:performance:markdown`: passed.
- `npm run audit:media-derivatives`: passed.
- `npm run audit:media-derivatives:markdown`: passed.

Full final validation results are recorded in the final Codex response.

## Phase H recommendations

1. Add authenticated fixture coverage for homepage and Generate Lab saved-asset/folder states before considering `assets-manager.css` deferral.
2. Add admin AI Lab state-specific visual guardrails before touching admin CSS links.
3. Consider a controlled wallet-controller lazy-load phase separately; wallet JS remains a large homepage initial graph contributor.
4. Keep async stylesheet loading deferred until Safari/iOS FOUC checks are explicit and repeatable.
5. Consider CSS component-domain extraction only after selector ownership is mapped to route and state fixtures, not static scans alone.
