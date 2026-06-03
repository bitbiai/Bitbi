# BITBI Phase H Public Route CSS Extraction

## Executive summary

Phase H implemented a larger public-route CSS reduction package while preserving the existing static ESM architecture, visual design, route behavior, and English/German parity.

Implemented:

- Removed the static `css/account/assets-manager.css` link from the English and German homepages.
- Added a cached dynamic homepage loader for `css/account/assets-manager.css` so authenticated Create flows still receive the shared save/folder/asset styles before the Create pane is shown.
- Removed the static `css/pages/legal.css` link from the English and German Pricing routes because Pricing does not use the legal-page-only `.policy-section` selectors.
- Expanded visual guardrails with a local authenticated homepage fixture that verifies the first Gallery Create click loads the dynamic Assets Manager stylesheet without dropping the interaction.

Deferred:

- Shared `auth.css` extraction, Generate Lab `assets-manager.css`, admin CSS cleanup, broad component CSS splitting, and async stylesheet strategies remain deferred because they require higher state coverage or carry FOUC/Safari risk.

The result reduces static render-blocking CSS on four public route variants:

- `/` and `/de/`: 9 links / 376,262 bytes -> 8 links / 298,784 bytes.
- `/pricing.html` and `/de/pricing.html`: 8 links / 129,523 bytes -> 7 links / 127,853 bytes.

Repository-wide CSS file bytes remain unchanged at 22 files / 739,057 bytes because this phase changed route loading, not CSS file contents.

## Repository state

| Item | Result |
| --- | --- |
| Branch | `main` |
| Latest commit inspected | `a2796fff PhaseG` |
| Working tree before Phase H | Clean |
| Node | `v26.0.0` |
| npm | `11.12.1` |
| Declared engine | Node `>=20 <21`; local Node is outside the declared range. |
| Toolchain check | `npm run check:toolchain` passed. |

## Phase A-G recap

| Phase | Current outcome |
| --- | --- |
| A | Lazy-loaded homepage Create-only modules: `studio.js`, `video-create.js`, `soundlab-create.js`. |
| B | Lazy-loaded the homepage Models overlay and preserved first-click behavior with lazy-boundary replay guards. |
| C | Audited media, CSS, and runtime cost; no runtime CSS/media changes. |
| D | Added media derivative inventory and visual guardrail tooling. |
| E and cleanup | Removed dead category-arrow assets/CSS/JS and unused `assets/images/2.jpg` through `assets/images/6.jpg`; preserved `assets/images/1.png`, `assets/images/1.jpg`, and `hero-flow-mobile.mp4`. |
| F | Added CSS route inventory tooling; no CSS links/rules changed. |
| G | Removed static `css/components/wallet.css` from Pricing EN/DE, kept wallet CSS dynamic through the wallet controller, expanded route/state guardrails to 39 scenarios. |

## Baseline CSS route inventory

Baseline before Phase H:

| Route | CSS links | CSS bytes | Notes |
| --- | ---: | ---: | --- |
| `/` | 9 | 376,262 | Included `css/account/assets-manager.css`. |
| `/de/` | 9 | 376,262 | Same as English homepage. |
| `/pricing.html` | 8 | 129,523 | Included `css/pages/legal.css` after Phase G wallet cleanup. |
| `/de/pricing.html` | 8 | 129,523 | Same as English Pricing. |
| `/generate-lab/` | 8 | 242,142 | Unchanged. |
| `/de/generate-lab/` | 8 | 242,142 | Unchanged. |
| `/admin/` | 8 | 337,572 | Unchanged. |
| Legal routes | 7 | 116,491 | Unchanged. |
| Account Assets Manager | 7 | 192,299 | Unchanged. |

After Phase H:

| Route | CSS links | CSS bytes | Delta |
| --- | ---: | ---: | ---: |
| `/` | 8 | 298,784 | -1 / -77,478 |
| `/de/` | 8 | 298,784 | -1 / -77,478 |
| `/pricing.html` | 7 | 127,853 | -1 / -1,670 |
| `/de/pricing.html` | 7 | 127,853 | -1 / -1,670 |
| `/generate-lab/` | 8 | 242,142 | 0 |
| `/de/generate-lab/` | 8 | 242,142 | 0 |
| `/admin/` | 8 | 337,572 | 0 |
| Legal routes | 7 | 116,491 | 0 |
| Account Assets Manager | 7 | 192,299 | 0 |

Total route-level savings across the four affected public route variants: 158,956 static stylesheet bytes.

## Public route state coverage

Phase H uses the existing Phase D/G visual guardrail script and extends it with one authenticated member scenario.

| Surface | Coverage |
| --- | --- |
| Homepage guest | Initial state, Gallery/Video/Sound Lab scroll states, mobile menu, desktop Models overlay, Create auth-gate first click. |
| Homepage member | New Chromium desktop `home-en-member` scenario with local `/api/me`, `/api/ai/quota`, `/api/ai/folders`, `/api/favorites`, and `/api/wallet/status` stubs. The first Gallery Create click waits for `#galleryStudio` and dynamic `css/account/assets-manager.css`. |
| Pricing | English/German desktop/mobile/tablet, wallet first-click state, auth gate. |
| Generate Lab | English/German default guest state and model-card selection state. |
| Legal | English privacy route baseline. |
| Account | Assets Manager guest route baseline. |
| Admin | Unauthenticated/default accessible state. |
| Browsers | Chromium covers all configured routes/viewports; Firefox and WebKit cover home and Pricing desktop plus home mobile/reduced-motion. |
| Reduced motion | Homepage desktop and mobile. |

Final focused visual result after implementation: 40 scenarios, 0 warnings, 0 browser failures, 52 expected local auth/stub notices filtered.

## Candidate matrix

| Candidate | Affected files/routes | Current cost | Evidence | Risk | Impact | Status |
| --- | --- | ---: | --- | --- | --- | --- |
| H1 homepage `assets-manager.css` static link | `index.html`, `de/index.html` | 77,478 bytes per homepage route | Homepage guest and auth-gate states do not need the stylesheet. Authenticated Gallery Create state now dynamically loads it before showing the Create pane. `home-en-member` guardrail confirms dynamic stylesheet load. | Low-medium | High | Implemented. |
| H2 homepage Create dynamic stylesheet loader | `js/pages/index/main.js` | +2,871 source bytes in `main.js` vs Phase G baseline | Needed to preserve first authenticated Create styling after H1. Uses `?v=__ASSET_VERSION__`, cached promise, existing static-link detection, and cancellation guard. | Low | Safety enabler | Implemented. |
| H3 Pricing `legal.css` static link | `pricing.html`, `de/pricing.html` | 1,670 bytes per Pricing route | `css/pages/legal.css` only styles `.policy-section`; Pricing EN/DE do not use those selectors. Visual guardrails cover Pricing EN/DE and pricing auth/wallet states. | Low | Low | Implemented. |
| H4 Generate Lab `assets-manager.css` static link | `/generate-lab/`, `/de/generate-lab/` | 77,478 bytes per route | Generate Lab statically imports shared saved-assets browser behavior and uses member save/folder/reference flows. | Medium-high | High | Deferred. |
| H5 Admin `assets-manager.css` static link | `/admin/` | 77,478 bytes | Admin AI Lab save/reference/folder surfaces are coupled to this stylesheet. | High | High | Deferred. |
| H6 shared `auth.css` extraction | Public/account/admin/legal routes | 21,893 bytes per route | Auth modal and auth entry actions are first-click safety-sensitive across public/member routes. | Medium-high | Medium | Deferred. |
| H7 shared `components.css` split | Most routes | 76,714 bytes | Contains shared nav, buttons, overlays, media cards, carousel, footer, and generated UI selectors. Static prefix evidence is insufficient. | High | High | Deferred. |
| H8 async stylesheet loading | Public routes | Potential render-blocking reduction | FOUC and Safari/iOS timing risk; no route-specific async CSS mechanism in repo. | High | High | Deferred. |
| H9 dead selector cleanup | Public CSS | None identified for safe deletion in Phase H | Phase E/G cleanup already removed dead category-arrow CSS/JS/assets. Current CSS URL references are valid. | Low | Low | No implementation needed. |

## Implemented changes

### Homepage static `assets-manager.css` removal

Removed:

- `css/account/assets-manager.css?v=__ASSET_VERSION__` from `index.html`.
- `../css/account/assets-manager.css?v=__ASSET_VERSION__` from `de/index.html`.

Added in `js/pages/index/main.js`:

- A cached `loadHomepageAssetsManagerStyles()` function.
- A stable link ID, `bitbiHomepageAssetsManagerStyles`.
- Dynamic stylesheet URL `/css/account/assets-manager.css?v=__ASSET_VERSION__`.
- Detection for an existing stylesheet link so duplicate links are avoided.
- Integration into the existing lazy Create module loader.

Create pane behavior stays conservative: the first authenticated Create click waits for the stylesheet and lazy module before showing the Create pane. If the stylesheet fails, the module still initializes and logs a warning instead of breaking the page.

The Gallery, Video, and Sound Lab Create toggles also now guard against a late async Create-ready callback switching the pane back to Create after the user has clicked back to Explore.

### Pricing legal stylesheet cleanup

Removed:

- `css/pages/legal.css?v=__ASSET_VERSION__` from `pricing.html`.
- `../css/pages/legal.css?v=__ASSET_VERSION__` from `de/pricing.html`.

`legal.css` remains linked by actual legal pages only.

### Visual guardrail state expansion

Updated `scripts/capture-visual-guardrails.mjs`:

- Added a local member cookie fixture.
- Added member stubs for `/api/me`, `/api/ai/quota`, `/api/ai/folders`, `/api/favorites`, and `/api/wallet/status`.
- Added a Chromium desktop `home-en-member` scenario.
- Captured member Create state after the first Gallery Create click.
- Verified the dynamic `css/account/assets-manager.css` resource appears in the member Create metrics.

## Before / after measurements

| Metric | Before Phase H | After Phase H | Delta |
| --- | ---: | ---: | ---: |
| Total CSS files | 22 | 22 | 0 |
| Total CSS bytes | 739,057 | 739,057 | 0 |
| Homepage CSS links / bytes | 9 / 376,262 | 8 / 298,784 | -1 / -77,478 |
| German homepage CSS links / bytes | 9 / 376,262 | 8 / 298,784 | -1 / -77,478 |
| Pricing CSS links / bytes | 8 / 129,523 | 7 / 127,853 | -1 / -1,670 |
| German Pricing CSS links / bytes | 8 / 129,523 | 7 / 127,853 | -1 / -1,670 |
| Generate Lab CSS links / bytes | 8 / 242,142 | 8 / 242,142 | 0 |
| Admin CSS links / bytes | 8 / 337,572 | 8 / 337,572 | 0 |
| Static homepage graph | 47 modules / 798,689 bytes | 47 modules / 801,560 bytes | +2,871 |
| `_site` HTML bytes | 927,765 | 927,425 | -340 |
| `_site` JS bytes | 2,355,288 | 2,358,162 | +2,874 |
| `_site` images | 8 / 1,385,592 bytes | 8 / 1,385,592 bytes | 0 |
| `_site` video | 1 / 2,170,158 bytes | 1 / 2,170,158 bytes | 0 |
| Visual guardrail scenarios | 39 | 40 | +1 |

The homepage JS increase is the explicit dynamic stylesheet loader and first-click cancellation guard. The net performance tradeoff is intentional: remove a 77,478-byte static render-blocking stylesheet from each homepage route while adding a small JS loader that only pulls the stylesheet when authenticated Create is used.

## Browser/device/state verification

| Area | Result |
| --- | --- |
| Chromium | Passed all 40 configured scenarios, including the new authenticated homepage member Create state. |
| Firefox | Passed homepage and Pricing desktop coverage plus homepage mobile/reduced-motion coverage. |
| WebKit | Passed homepage and Pricing desktop coverage plus homepage mobile/reduced-motion coverage. |
| Mobile | Passed Chromium mobile coverage for home, Generate Lab, Pricing, legal, account-assets, and admin routes. |
| Tablet | Passed Chromium tablet coverage for all configured routes. |
| Reduced motion | Passed homepage desktop and mobile coverage. |
| Member state | `home-en-member` passed with no console/page errors. `memberCreate` metrics include `/css/account/assets-manager.css`. |
| Limitations | Guardrails use local API stubs and do not call paid generation, payment, billing mutation, production APIs, or live Cloudflare services. Generate Lab authenticated save/folder states and Admin AI Lab authenticated states remain deferred. |

## Deferred candidates

| Candidate | Reason |
| --- | --- |
| Generate Lab `assets-manager.css` removal | Generate Lab imports saved-assets browser behavior and has many member save/folder/reference-image states. Needs authenticated Generate Lab coverage before deferral/removal. |
| Admin `assets-manager.css` removal | Admin AI Lab uses shared assets/folder/reference UI and is high-risk without authenticated admin visual coverage. |
| Shared `auth.css` split or dynamic loading | Auth modal first-click styling is route-wide and safety-sensitive. Deferring avoids modal FOUC and Safari timing risk. |
| Shared `components.css` split | Selector ownership spans nav, modals, overlays, gallery cards, carousels, footer, generated UI, and account/admin surfaces. Needs deeper route/state selector mapping. |
| Async/preload stylesheet strategy | Would risk FOUC and cross-browser timing issues. No Phase H change used async stylesheet hacks. |
| Legal route shared CSS reduction | Legal pages still use shared nav/auth/components/base/utilities. Any further reduction needs legal route and auth-modal state coverage. |

## Rollback plan

1. Restore the removed `css/account/assets-manager.css` link in `index.html`.
2. Restore the removed `../css/account/assets-manager.css` link in `de/index.html`.
3. Remove the dynamic homepage Assets Manager stylesheet loader and `ensureHomepageAssetsManagerStyles()` call from `js/pages/index/main.js`.
4. Restore the removed `css/pages/legal.css` link in `pricing.html`.
5. Restore the removed `../css/pages/legal.css` link in `de/pricing.html`.
6. Remove the `home-en-member` guardrail scenario and local member API stubs if the extra guardrail runtime is not desired.

All changes are source-only and reversible without migrations, Worker deploy changes, binding changes, or package changes.

## Commands and results

Baseline before edits:

- `git status --short`: clean.
- `git branch --show-current`: `main`.
- `git log -1 --oneline`: `a2796fff PhaseG`.
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
- `npm run audit:visual-guardrails`: passed, 39 scenarios, 0 warnings.

Focused after edits:

- `npm run check:js`: passed.
- `npm run build:static`: passed.
- `npm run audit:performance`: passed.
- `npm run audit:css-routes`: passed.
- `npm run audit:media-derivatives`: passed.
- `npm run audit:visual-guardrails`: passed, 40 scenarios, 0 warnings.

One non-validation exploratory ad hoc Node server probe failed with `listen EPERM` under sandbox permissions and was not used for evidence. The repo-owned `npm run audit:visual-guardrails` command successfully provided the browser evidence.

Final validation after the report was added:

- `npm run check:toolchain`: passed.
- `npm run check:js`: passed.
- `npm run check:dom-sinks`: passed.
- `npm run check:doc-currentness`: passed.
- `npm run test:doc-currentness`: passed.
- `npm run build:static`: passed.
- `npm run audit:performance`: passed.
- `npm run audit:performance:markdown`: passed.
- `npm run audit:media-derivatives`: passed.
- `npm run audit:media-derivatives:markdown`: passed.
- `npm run audit:css-routes`: passed.
- `npm run audit:css-routes:markdown`: passed.
- `npm run audit:visual-guardrails`: passed, 40 scenarios, 0 warnings.
- `npm run test:asset-version`: passed.
- `npm run validate:asset-version`: passed.
- `npm run test:release-compat`: passed.
- `npm run validate:release`: passed.
- `npm run check:static-deploy-safety`: passed; mode `static_only`, changed files 7, worker deploys none, schema applies none, manual prerequisites none.
- `npm run test:static-deploy-safety`: passed.
- `npm run test:static`: passed, 355 tests.
- `npm run test:workers`: passed, 673 tests.
- `npm test`: passed, 355 static tests plus 673 worker tests.
- `git diff --check`: passed.

## Phase I recommendations

1. Add authenticated Generate Lab saved-assets/folder/reference-image visual fixtures before considering `assets-manager.css` changes there.
2. Add authenticated Admin AI Lab state coverage before touching Admin route CSS.
3. Build selector ownership evidence for `components.css` by route/state before splitting shared component CSS.
4. Evaluate auth modal CSS extraction as a dedicated phase with first-click, keyboard, mobile, and WebKit/Safari checks.
5. Keep async stylesheet loading and critical CSS extraction deferred until a no-FOUC Safari/iOS strategy is measurable and repeatable.
