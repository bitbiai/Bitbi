# BITBI Phase F CSS Route Scope and Render Blocking Report

## Executive Summary

Phase F was a controlled CSS route-scope and render-blocking audit. The result is audit tooling and a route ownership report, not a CSS runtime rewrite.

Implemented:

- Added a local, deterministic CSS route inventory script.
- Added package scripts for text and Markdown CSS route reports.
- Classified stylesheet ownership and render-blocking cost for public, localized, member, account, legal, pricing, and admin pages.

Not implemented:

- No stylesheet links were removed.
- No CSS rules were deleted.
- No CSS order, cascade layers, breakpoints, selectors, visual effects, or layout behavior changed.
- No async stylesheet loading, critical CSS extraction, or CSS splitting was introduced.

The audit found real render-blocking cost, especially on the homepage, admin, Generate Lab, and account pages. The highest-impact candidates are also coupled to authenticated overlays, shared save/folder UI, wallet/payment UI, auth modals, and admin/member flows. Those candidates were deferred because static selector evidence is not enough to prove safety across route, auth, device, and first-click states.

## Repository State Inspected

| Item | Value |
| --- | --- |
| Branch | `main` |
| Latest commit | `71745899 Cleanup` |
| Initial working tree | clean |
| Node | `v26.0.0` |
| npm | `11.12.1` |
| Declared Node engine | `>=20 <21` |
| Toolchain result | `npm run check:toolchain` passed despite Node 26 being outside the declared engine |

## Phase A-E Baseline Recap

| Phase | Result |
| --- | --- |
| Phase A | Lazy-loaded homepage Create-only modules: `studio.js`, `video-create.js`, `soundlab-create.js`. Homepage initial graph dropped from 63 modules / 969,663 source bytes to 60 modules / 925,343 source bytes. |
| Phase B | Lazy-loaded the homepage Models overlay and added first-click replay protection. Homepage initial graph dropped to 47 modules / 801,606 source bytes. |
| Phase C | Audited media, CSS, and runtime costs without runtime/media/CSS changes. |
| Phase D | Added media derivative inventory tooling, visual guardrail capture tooling, and a media derivative manifest. |
| Phase E and cleanup | Invalidated the Phase E category-arrow pilot, removed dead category-arrow assets/CSS/JS, removed unused `assets/images/2.jpg` through `assets/images/6.jpg`, preserved `assets/images/1.png`, `assets/images/1.jpg`, and `hero-flow-mobile.mp4`. |

Current local audit baseline after the Phase E cleanup:

- Homepage static graph: 47 modules / 798,689 source bytes.
- Static build inventory: 22 CSS files / 739,057 bytes.
- Media inventory: 8 image files / 1,385,592 bytes, 1 video file / 2,170,158 bytes, 20 font files / 476,132 bytes.

## Commands Run Before Changes

| Command | Result |
| --- | --- |
| `git status --short` | passed; initially clean |
| `git branch --show-current` | passed; `main` |
| `git log -1 --oneline` | passed; `71745899 Cleanup` |
| `node --version` | passed; `v26.0.0` |
| `npm --version` | passed; `11.12.1` |
| `npm run check:toolchain` | passed |
| `npm run check:js` | passed |
| `npm run check:dom-sinks` | passed |
| `npm run check:doc-currentness` | passed |
| `npm run build:static` | passed |
| `npm run audit:performance` | first attempt failed because it overlapped with `build:static`; rerun after build passed |
| `npm run audit:performance:markdown` | passed |
| `npm run audit:media-derivatives` | passed |
| `npm run audit:media-derivatives:markdown` | passed |
| `npm run audit:visual-guardrails` | passed |

## Implemented Tooling

Added:

- `scripts/css-route-inventory.mjs`
- `npm run audit:css-routes`
- `npm run audit:css-routes:markdown`

The script:

- Uses Node built-ins only.
- Performs no network access.
- Performs no file mutation.
- Scans source HTML pages, not `_site`, `docs`, `test-results`, generated Playwright reports, or dependencies.
- Lists CSS files, file sizes, route stylesheet links, route preload counts, route ownership classifications, and CSS `url(...)` references.
- Fails only on invalid local filesystem assumptions such as missing files during read; it does not fail on subjective route-scope findings.

## CSS Inventory

`npm run audit:css-routes` measured 22 CSS files and 739,057 total CSS bytes.

| CSS file | Bytes | Human | Classification |
| --- | ---: | ---: | --- |
| `css/pages/index.css` | 164,664 | 160.8 KB | `page_specific_required` |
| `css/admin/admin.css` | 145,273 | 141.9 KB | `admin_required` |
| `css/account/assets-manager.css` | 77,478 | 75.7 KB | `auth_or_wallet_required` |
| `css/components/components.css` | 76,714 | 74.9 KB | `shared_component_required` |
| `css/account/profile.css` | 69,183 | 67.6 KB | `page_specific_required` |
| `css/pages/generate-lab.css` | 49,843 | 48.7 KB | `page_specific_required` |
| `css/components/wallet.css` | 28,589 | 27.9 KB | `auth_or_wallet_required` |
| `css/components/auth.css` | 21,893 | 21.4 KB | `auth_or_wallet_required` |
| `css/components/news-pulse.css` | 19,299 | 18.8 KB | `shared_component_required` |
| `css/account/credits.css` | 18,325 | 17.9 KB | `page_specific_required` |
| `css/account/wallet.css` | 18,157 | 17.7 KB | `page_specific_required` |
| `css/pages/pricing.css` | 13,032 | 12.7 KB | `page_specific_required` |
| `css/account/forgot-password.css` | 9,731 | 9.5 KB | `page_specific_required` |
| `css/base/base.css` | 9,214 | 9.0 KB | `critical_global` |
| `css/components/member-workflow.css` | 4,232 | 4.1 KB | `shared_component_required` |
| `css/base/tokens.css` | 3,383 | 3.3 KB | `critical_global` |
| `css/components/cookie-banner.css` | 2,794 | 2.7 KB | `shared_component_required` |
| `css/base/utilities.css` | 2,027 | 2.0 KB | `critical_global` |
| `css/pages/legal.css` | 1,670 | 1.6 KB | `page_specific_required` |
| `css/base/reset.css` | 1,590 | 1.6 KB | `critical_global` |
| `css/account/reset-password.css` | 1,057 | 1.0 KB | `page_specific_required` |
| `css/account/organization.css` | 909 | 909 B | `page_specific_required` |

CSS `url(...)` references:

- 13 references were found.
- All are font references from `css/base/base.css`.
- Missing CSS `url(...)` references: 0.

## Route-Scope Matrix

`npm run audit:css-routes` measured 33 source HTML routes.

| Route | CSS links | CSS bytes | Decision |
| --- | ---: | ---: | --- |
| `/` (`index.html`) | 9 | 376,262 | Keep all links in Phase F. Homepage uses shared components, news pulse, homepage layout, auth modal, assets/folder/save surfaces, and utilities. |
| `/de/` | 9 | 376,262 | Keep all links; German route must stay visually and functionally equivalent. |
| `/pricing.html` | 9 | 158,112 | Keep all links; wallet/auth/pricing flow risk is too high for link removal without deeper checkout-state coverage. |
| `/de/pricing.html` | 9 | 158,112 | Keep all links; preserve English/German pricing parity. |
| `/generate-lab/` | 8 | 242,142 | Keep all links; Generate Lab depends on auth and shared assets manager UI. |
| `/de/generate-lab/` | 8 | 242,142 | Keep all links; preserve localized member workspace parity. |
| `/admin/` | 8 | 337,572 | Keep all links; admin CSS and shared assets manager/auth CSS are route-critical. |
| Legal pages | 7 | 116,491 | Keep all links; auth modal/shared navigation and legal layout use shared/component CSS. |
| Account profile | 8 | 261,482 | Keep all links; profile and assets manager surfaces are stateful and shared. |
| Account assets manager | 7 | 192,299 | Keep all links; page-specific surface. |
| Account credits | 7 | 133,146 | Keep all links; billing/credits pages are sensitive and need dedicated coverage before reduction. |
| Password reset/verify pages | 8 | 125,609 | Keep all links; auth/error state styling is route-critical. |
| Organization pages | 8 | 134,055 | Keep all links; account/credits/organization state must remain intact. |

Zero-stylesheet account redirect/minimal pages (`account/image-studio.html`, `account/wallet.html`, and localized equivalents) were recorded by the route script but are not CSS reduction candidates.

## Render-Blocking Analysis

The route HTML currently uses normal stylesheet links in a fixed order. The base CSS declares the intended cascade order:

```css
@layer tokens, reset, base, components, pages, utilities;
```

Phase F preserved that order. No `media=print` swaps, preload-to-stylesheet swaps, JS-injected stylesheets, critical CSS extraction, or layer reordering were introduced.

Primary render-blocking candidates:

| Candidate | Potential benefit | Risk | Phase F decision |
| --- | --- | --- | --- |
| Homepage `css/account/assets-manager.css` | 75.7 KB from the homepage CSS set | Medium/high: authenticated Create/save/folder flows and shared asset picker/recovery surfaces can appear from homepage flows | Deferred |
| Homepage `css/components/auth.css` | 21.4 KB from public pages | High: login/register/auth modal first-click behavior must remain immediate and styled | Deferred |
| Homepage `css/components/news-pulse.css` | 18.8 KB | Medium: news pulse is a homepage component, potentially visible/loaded at startup | Keep |
| Pricing `css/components/wallet.css` | 27.9 KB | High: checkout, wallet, subscription, and auth state behavior is payment-sensitive | Deferred |
| Generate Lab `css/account/assets-manager.css` | 75.7 KB from Generate Lab | High: shared asset manager/folder/reference-image flows are member-facing and stateful | Keep |
| Admin `css/account/assets-manager.css` | 75.7 KB from Admin | High: Admin AI Lab save/reference/folder surfaces reuse shared asset manager styles | Keep |
| `css/pages/index.css` splitting | Large homepage-specific file | High: hero, category carousel, gallery/video/sound sections, responsive layouts, and reduced-motion behavior are tightly coupled | Deferred |
| Critical CSS extraction | Possible first-paint benefit | High: requires new CSS architecture and visual approval across route/device/state coverage | Deferred |

## Selector and Use Analysis

Static CSS selector scans are insufficient for this repo because many selectors are used by JavaScript-generated DOM, authenticated state, modals, overlays, saved asset/folder surfaces, admin panels, and localized route variants.

Evidence checked:

- Route stylesheet links in public, localized, pricing, Generate Lab, admin, legal, and account pages.
- JS modules that generate or toggle CSS classes, including homepage category behavior, auth modal, auth state, wallet controller, models overlay, and shared asset surfaces.
- CSS `url(...)` references, including font references.
- Visual guardrail output across browser/viewport scenarios.

False-positive risks:

- Dynamic class generation in JS is not fully visible to static HTML scans.
- Authenticated-only UI can require CSS that is not visible in guest screenshots.
- Admin/member folder and save flows can reuse account CSS on routes that look public at first paint.
- Pricing/wallet styles can affect payment-sensitive states that should not be changed from static evidence alone.

## Implemented Safe Changes

| Change | File | Rationale |
| --- | --- | --- |
| Added deterministic CSS route inventory script | `scripts/css-route-inventory.mjs` | Provides repeatable CSS bytes, route links, ownership classification, preload counts, and CSS URL reference validation without mutating files. |
| Added npm audit scripts | `package.json` | Makes Phase F route-scope measurement reproducible in CI/local review. |
| Added Phase F report | `docs/performance/phase-f-css-route-scope-render-blocking.md` | Documents decisions, risks, measurements, and next-phase candidates. |

## Deferred Candidates

| Candidate | Impact | Risk | Effort | Decision |
| --- | ---: | ---: | ---: | --- |
| Split homepage `assets-manager.css` into interaction-specific CSS | 4 | 4 | 4 | Defer to Phase G; requires authenticated homepage Create/save/folder visual coverage. |
| Defer auth modal CSS on public pages | 3 | 5 | 3 | Defer; first-click auth modal must not flash unstyled or fail. |
| Split `index.css` into hero/category/gallery/video/sound sections | 4 | 5 | 5 | Defer; this is a CSS architecture change. |
| Remove wallet CSS from pricing until interaction | 3 | 5 | 3 | Defer; payment and subscription surfaces are sensitive. |
| Admin CSS route splitting | 3 | 5 | 4 | Defer; admin-only state coverage is not sufficient for Phase F. |
| Critical CSS extraction | 5 | 5 | 5 | Defer to a separate design-reviewed phase. |

## Before and After Measurements

Phase F made no runtime CSS or HTML changes. Therefore the CSS byte counts and route stylesheet counts are intentionally unchanged.

| Metric | Before Phase F | After Phase F |
| --- | ---: | ---: |
| CSS files | 22 | 22 |
| Total CSS bytes | 739,057 | 739,057 |
| Homepage CSS links | 9 | 9 |
| Homepage CSS bytes | 376,262 | 376,262 |
| Generate Lab CSS links | 8 | 8 |
| Generate Lab CSS bytes | 242,142 | 242,142 |
| Admin CSS links | 8 | 8 |
| Admin CSS bytes | 337,572 | 337,572 |
| Homepage static graph | 47 modules / 798,689 source bytes | unchanged |
| Image assets | 8 / 1,385,592 bytes | unchanged |
| Video assets | 1 / 2,170,158 bytes | unchanged |
| Font assets | 20 / 476,132 bytes | unchanged |

## Browser and Visual Guardrail Verification

`npm run audit:visual-guardrails` completed successfully before Phase F code changes:

- Scenarios: 25
- Warnings: 0
- Expected filtered local auth/stub notices: 36
- Artifact directory: `test-results/visual-guardrails/latest`

Coverage:

| Area | Result |
| --- | --- |
| Chromium | Passed route/interaction coverage for homepage, German homepage, Generate Lab, German Generate Lab, Admin, mobile, tablet, desktop, Models first click, Create first-click auth gate, and reduced motion. |
| Firefox | Passed the script's limited homepage/German/reduced-motion route plan. |
| WebKit | Passed the script's limited homepage/German/reduced-motion route plan. |
| Mobile | Passed mobile viewport scenarios included by the guardrail script. |
| Tablet | Passed tablet viewport scenarios included by the guardrail script. |
| Reduced motion | Passed reduced-motion scenarios included by the guardrail script. |

No CSS runtime changes were made after this verification. Final validation reruns are recorded below.

## Validation Results

Final validation commands were run after the Phase F report and tooling changes.

| Command | Result |
| --- | --- |
| `npm run check:toolchain` | passed |
| `npm run check:js` | passed; JavaScript syntax guard passed for 60 targeted files |
| `npm run check:dom-sinks` | passed |
| `npm run check:doc-currentness` | passed; Phase F report classified as a historical phase report |
| `npm run test:doc-currentness` | passed |
| `npm run build:static` | passed; `_site` built with asset version `local-20260602180251` |
| `npm run audit:performance` | passed |
| `npm run audit:performance:markdown` | passed |
| `npm run audit:media-derivatives` | passed |
| `npm run audit:media-derivatives:markdown` | passed |
| `npm run audit:visual-guardrails` | passed; 25 scenarios, 0 warnings |
| `npm run audit:css-routes` | passed |
| `npm run audit:css-routes:markdown` | passed |
| `npm run test:asset-version` | passed |
| `npm run validate:asset-version` | passed |
| `npm run test:release-compat` | passed |
| `npm run validate:release` | passed |
| `npm run check:static-deploy-safety` | passed; changed files require no static deploy and no Worker/schema steps |
| `npm run test:static-deploy-safety` | passed |
| `npm run test:static` | passed; 355 tests |
| `npm run test:workers` | passed; 673 tests |
| `npm test` | passed; 355 static tests and 673 worker tests |
| `git diff --check` | passed |

Validation notes:

- Node `v26.0.0` is outside the declared `>=20 <21` engine, but `npm run check:toolchain` accepted the local toolchain.
- Playwright emitted Node 26 deprecation and `NO_COLOR`/`FORCE_COLOR` warnings during browser suites. These were warnings only; the suites passed.

## Risk Assessment

Phase F runtime risk is low because no CSS/HTML runtime behavior changed. The main residual risk is that the new route inventory script is a heuristic audit tool, not proof that CSS selectors are unused.

Mitigations:

- The script labels route ownership conservatively.
- The report defers all CSS removal/splitting candidates that touch auth, wallet, assets, admin, Generate Lab, or pricing surfaces.
- Visual guardrails remain available for later implementation phases.
- The script checks CSS `url(...)` references to prevent hidden broken asset references after cleanup phases.

## Rollback Plan

Rollback is straightforward:

1. Remove `scripts/css-route-inventory.mjs`.
2. Remove `audit:css-routes` and `audit:css-routes:markdown` from `package.json`.
3. Remove this Phase F report if the audit output itself should be reverted.

No runtime CSS, HTML, JavaScript application behavior, Worker code, D1 schema, bindings, assets, API contracts, model behavior, pricing, billing, or credits were changed.

## Phase G Recommendations

Recommended next steps, only after dedicated visual/auth/member coverage:

1. Investigate splitting `css/account/assets-manager.css` into route-critical and overlay/interaction-only portions, with authenticated homepage, Generate Lab, Admin AI Lab, and account manager screenshots.
2. Investigate whether pricing wallet CSS can be scoped to checkout/wallet states without causing FOUC or payment-flow regressions.
3. Add CSS selector coverage instrumentation from Playwright for selected routes/states before any deletion.
4. Consider critical CSS extraction only as a separate architecture phase with route-by-route visual approval.
5. Keep using `npm run audit:css-routes` before and after any CSS link or rule changes.

## Final Recommendation

Ship the audit tooling and report if desired. Hold runtime CSS reductions until Phase G with broader stateful visual coverage.
