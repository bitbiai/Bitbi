# BITBI Phase C Media, CSS, and Runtime Cost Audit

## Executive Summary

Phase C audited BITBI's public homepage media loading, stylesheet loading, and runtime animation/layout cost after the Phase A and Phase B initial JavaScript reductions.

No runtime, CSS, media, API, Worker, billing, AI model, route, layout, or visual implementation change was made in Phase C. The audit found several high-impact candidates, but none met the Phase C proof threshold for a low-risk, no-visual-change implementation:

- Large media candidates require asset-pipeline, visual, SEO/social-preview, or fixture review.
- CSS candidates require route coverage and visual regression proof before changing render-blocking stylesheet structure.
- Runtime candidates are already guarded in several important places, and the remaining hotspots are tightly coupled to visible hero/category behavior.

Phase C therefore ships as an audit plus one test-only fixture-hardening change. The local static homepage import graph remains unchanged from Phase B.

## Repo State Inspected

| Item | Value |
| --- | --- |
| Branch | `main` |
| Latest commit inspected | `b00eb011 PhaseB` |
| Initial working tree | Clean before Phase C edits |
| Node | `v26.0.0` |
| npm | `11.12.1` |
| Engine note | `package.json` declares Node `>=20 <21`; local Node is newer than the declared engine, but `npm run check:toolchain` passed. |

No commit, push, merge, deploy, remote migration, or production mutation was performed.

## Phase A/B Baseline And Phase C Baseline

| State | Static homepage modules | Source bytes | Delta |
| --- | ---: | ---: | ---: |
| Before Phase A | 63 | 969,663 | - |
| After Phase A | 60 | 925,343 | -44,320 bytes |
| After Phase B / Phase C baseline | 47 | 801,606 | -168,057 cumulative bytes |
| After Phase C | 47 | 801,606 | 0 bytes |

These are local static source graph measurements from `scripts/performance-inventory.mjs`, not production transfer-size, Lighthouse, RUM, Core Web Vitals, LCP, INP, or CLS measurements.

## Media Inventory

### Largest Media And Font Assets

| Path | Type | Bytes | Dimensions | Classification | Notes |
| --- | --- | ---: | --- | --- | --- |
| `assets/images/hero/hero-flow-mobile.mp4` | video | 2,170,158 | not inspected frame-by-frame | `needs_visual_review` | Largest asset. It is used by tests/fixtures and is not directly referenced by the current homepage HTML/JS scan. Do not remove or compress without fixture and visual review. |
| `assets/images/1.jpg` | image/jpeg | 536,335 | 1429x803 | `do_not_change` | Used in worker/static fixtures as a public media thumbnail path. Deletion or conversion would affect tests and route behavior. |
| `assets/images/1.png` | image/png | 361,041 | 600x391 | `do_not_change` | Homepage hero logo, Open Graph/Twitter image, JSON-LD image, and preloaded LCP candidate. Preserve exact asset/format unless social and visual previews are reviewed. |
| `assets/favicons/android-chrome-512x512.png` | image/png | 358,316 | 512x512 | `do_not_change` | Favicon/manifest/Organization logo and decorative watermark source. High bytes but semantically important. |
| `assets/images/4.jpg` | image/jpeg | 344,749 | 784x1168 | `needs_visual_review` | Not referenced by current static route scan; may be legacy/test/content asset. Do not delete without inventory confirmation. |
| `assets/images/6.jpg` | image/jpeg | 294,695 | 784x1168 | `needs_visual_review` | Same risk class as other numbered JPGs. |
| `assets/images/5.jpg` | image/jpeg | 294,653 | 784x1168 | `needs_visual_review` | Same risk class as other numbered JPGs. |
| `assets/images/3.jpg` | image/jpeg | 243,978 | 784x1168 | `needs_visual_review` | Same risk class as other numbered JPGs. |
| `assets/images/2.jpg` | image/jpeg | 224,996 | 784x1168 | `needs_visual_review` | Same risk class as other numbered JPGs. |
| `assets/images/botton/video.webp` | image/webp | 51,446 | 480x322 | `do_not_change` | CSS background for Video category arrow card. Visual route-specific asset. |
| `assets/images/botton/gallery.webp` | image/webp | 49,664 | 480x322 | `do_not_change` | CSS background for Gallery category arrow card. |
| `assets/images/botton/soundlab.webp` | image/webp | 45,654 | 480x322 | `do_not_change` | CSS background for Sound Lab category arrow card. |
| `fonts/inter-v20-latin_latin-ext-600.woff2` | font | 52,452 | n/a | `do_not_change` | Font-face uses `font-display: swap`; typography must not change. |
| `fonts/inter-v20-latin_latin-ext-500.woff2` | font | 52,304 | n/a | `do_not_change` | Same. |
| `fonts/inter-v20-latin_latin-ext-regular.woff2` | font | 50,696 | n/a | `do_not_change` | Preloaded by key pages. |

### Aggregate Asset Totals

Measured from `_site` after `npm run build:static`:

| Category | Files | Bytes |
| --- | ---: | ---: |
| HTML | 33 | 927,936 |
| CSS | 22 | 750,167 |
| JS | 129 | 2,358,205 |
| Images | 17 | 2,959,787 |
| Fonts | 20 | 476,132 |
| Video | 1 | 2,170,158 |
| Other | 5 | 2,931 |

### Preload, Fetch Priority, Loading, And Decoding

| Area | Finding | Decision |
| --- | --- | --- |
| Homepage hero logo | `assets/images/1.png` is preloaded with `fetchpriority="high"` and rendered with explicit width/height plus `decoding="async"`. | `do_not_change`; above-the-fold and social/structured-data asset. |
| Decorative watermark | Favicon watermark image has explicit width/height, `loading="lazy"`, `decoding="async"`, and `fetchpriority="low"`. | `implemented_safe` already present before Phase C; no change needed. |
| Category arrow WebP backgrounds | Loaded through CSS background images, not regular `<img>` tags. | `deferred_phase_d`; changing loading requires CSS/HTML behavior change. |
| Dynamic gallery/video/sound media | Rendered from API data by JS modules, not static HTML assets. | `do_not_change`; media wall behavior and paid/usage-sensitive preview logic must remain intact. |
| Favicons/social assets | Manifest, favicon links, OG/Twitter, JSON-LD references are intentional. | `do_not_change`; preserve SEO/social behavior. |

No missing `loading="lazy"` or `decoding="async"` issue was found on a below-the-fold static `<img>` that could be changed safely without altering semantics or route behavior.

## CSS Inventory

### Key Page Stylesheet Counts

Measured by `scripts/performance-inventory.mjs`:

| Page | CSS links | Module scripts | Preloads |
| --- | ---: | ---: | ---: |
| `index.html` | 9 | 1 | 3 |
| `de/index.html` | 9 | 1 | 3 |
| `generate-lab/index.html` | 8 | 1 | 2 |
| `de/generate-lab/index.html` | 8 | 1 | 2 |
| `admin/index.html` | 8 | 1 | 2 |

### Selected CSS File Sizes

| File | Bytes | Classification | Notes |
| --- | ---: | --- | --- |
| `css/pages/index.css` | 175,774 | `do_not_change` | Homepage visual system, hero, category carousel, media walls, stream, tablet/desktop/mobile rules. High impact but high visual risk. |
| `css/admin/admin.css` | 145,273 | `do_not_change` | Admin-only route CSS; not a public homepage target. |
| `css/account/assets-manager.css` | 77,478 | `deferred_phase_d` | Loaded on homepage for shared saved-asset/auth/media components. Splitting/deferring requires route/state coverage. |
| `css/components/components.css` | 76,714 | `do_not_change` | Shared component styles used across public pages. |
| `css/account/profile.css` | 69,183 | `do_not_change` | Account route CSS, not a homepage target. |
| `css/pages/generate-lab.css` | 49,843 | `do_not_change` | Generate Lab route CSS, outside Phase C homepage target. |
| `css/components/wallet.css` | 28,589 | `do_not_change` | Wallet/auth-related styles; not safe to alter without auth/member coverage. |
| `css/components/auth.css` | 21,893 | `do_not_change` | Auth modal and entry actions. |
| `css/components/news-pulse.css` | 19,299 | `do_not_change` | Above-the-fold homepage News Pulse component. |
| `css/pages/pricing.css` | 13,032 | `do_not_change` | Pricing route CSS. |

### CSS Loading And Render-blocking Risk

The public homepage still loads multiple render-blocking stylesheets. The largest homepage-specific risk is not a single incorrect file; it is the current intentionally shared CSS architecture:

- Base tokens/reset/base/utilities are broad, expected render-blocking dependencies.
- `css/pages/index.css` is large but contains the homepage visual design and responsive behavior.
- `css/account/assets-manager.css` is a potential deferral/splitting candidate, but it may support shared saved-asset/auth/media flows and should not be changed without dedicated route/state visual coverage.

No CSS was deleted or deferred in Phase C. A route-specific CSS split could be a Phase D optimization if it is backed by screenshot coverage for guest/member/admin/account/generate/legal routes.

## Runtime Cost Inventory

| Runtime area | Current behavior | Cost risk | Decision |
| --- | --- | --- | --- |
| Hero canvas / `js/shared/particles.js` | Uses ResizeObserver, IntersectionObserver visibility gating, `document.hidden`, and reduced-motion static behavior. | Moderate GPU/CPU cost while visible. | `do_not_change`; already guarded and visually central. DPR changes could alter cost/visuals. |
| Binary rain / `js/shared/binary-rain.js` | Skips reduced-motion and caps columns in homepage options. | Moderate DOM/animation count. | `do_not_change`; visible brand effect, no duplication found. |
| Footer binary / `js/shared/binary-footer.js` | Generates 800 characters once; no continuous animation observed from source. | Low. | `do_not_change`. |
| Scroll reveal / `js/shared/scroll-reveal.js` | IntersectionObserver-based; reduced motion makes elements visible immediately. | Low to moderate. | `do_not_change`. |
| Hero creation stream SVG | Large inline SVG paths and filters with CSS animation/highlight layers; no-hover highlights disabled from earlier task. | High paint/filter cost while visible. | `deferred_phase_d`; simplification would require visual review. |
| Category carousel / `js/pages/index/category-carousel.js` | Uses transition prep, requestAnimationFrame, and height/layout sync to avoid stale one-column panels. | Moderate layout cost. | `do_not_change`; prior correctness fixes depend on this behavior. |
| Public media wall / `js/pages/index/public-media-wall.js` | Uses measurement, fixed metrics, validation loops, and category transition guards. | Moderate layout/read-write cost. | `do_not_change`; critical to avoiding category flash/regression. |
| Gallery/video/sound modules | Fetch and render Explore content, manage hover previews, pagination, mobile overlays, favorites. | Moderate startup and interaction cost. | `do_not_change`; initial Explore correctness and media behavior required. |
| Video hover previews | Desktop/hover gated, reduced-motion aware, uses `preload="none"` for preview video creation. | Usage/cost-sensitive. | `do_not_change`; current safeguards should remain. |

## Measured Browser Verification

A local `serve` instance was started against the built static site and a Playwright browser measurement script was run. The first non-escalated launch attempt failed because the local sandbox blocked browser process startup. The escalated retry completed.

### Browser Results

| Scenario | Result | Notes |
| --- | --- | --- |
| Chromium desktop 1440x900 | Passed | Homepage loaded with no console errors. Initial snapshot: 1,683 DOM nodes, 18 images, 4 videos, 94 animations, 85 resource entries, 0 observed long tasks. First Models click lazy-loaded the overlay and increased script resources from 51 to 64. |
| Chromium mobile 390x844 | Passed | Homepage loaded with no console errors. Initial snapshot: 1,644 DOM nodes, 18 images, 0 videos, 37 animations, 88 resource entries, 0 observed long tasks. |
| Chromium tablet 768x1024 | Passed | Homepage loaded and interacted without console errors in the local script. |
| Chromium reduced motion | Passed | Homepage loaded with no console errors and `document.getAnimations().length` reported 0 in the sampled state. |
| Firefox desktop 1440x900 | Limited pass | Homepage loaded. Firefox logged "Image corrupt or truncated" for local `/api/gallery/memvids/.../poster` fixture poster URLs. This appears to be a local fixture/static-server limitation, not a Phase C code change. |
| WebKit desktop 1440x900 | Passed | Homepage loaded with no console errors. Initial snapshot: 1,683 DOM nodes, 18 images, 4 videos, 88 animations, 100 resource entries. |

No paid generation, billing, model, or Worker endpoint was invoked by the measurement script.

## Implemented Safe Changes

### Runtime/media/CSS implementation

None. Phase C made no implementation changes to runtime code, CSS, HTML, media assets, Workers, API routes, billing, model behavior, or deployment configuration.

### Test-only hardening

`tests/workers.spec.js` was hardened after `npm run test:workers` exposed a clock-dependent false positive. The Admin embeddings contract test intentionally verifies that raw embedding vectors such as `0.1` are not stored in usage-attempt metadata. On the local run, an ISO timestamp contained `13:58:10.199Z`, which made the whole-row string scan match `0.1` even though the vector value was not leaked.

The test now normalizes ISO timestamps to `<timestamp>` before the raw-vector leak assertion. This keeps the sensitive-data assertion intact while removing date-dependent false positives. No Worker implementation code was changed.

## Before/After Measurements

| Measurement | Before Phase C | After Phase C | Delta |
| --- | ---: | ---: | ---: |
| Static homepage modules | 47 | 47 | 0 |
| Static homepage source bytes | 801,606 | 801,606 | 0 |
| `_site` image bytes | 2,959,787 | 2,959,787 | 0 |
| `_site` video bytes | 2,170,158 | 2,170,158 | 0 |
| `_site` font bytes | 476,132 | 476,132 | 0 |
| `_site` CSS bytes | 750,167 | 750,167 | 0 |

The before/after numbers are unchanged because Phase C was audit-only.

## Cost-benefit Matrix

| Candidate | Expected impact | Risk | Effort | Expected user benefit | Compatibility risk | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| Compress/replace `hero-flow-mobile.mp4` | High byte reduction if served | Medium to high | Medium | Lower media transfer where used | Visual/poster/test fixture risk | Defer Phase D |
| Convert or remove numbered JPGs | Medium asset inventory reduction | High | Medium | Smaller repository/build footprint | Fixture/content route risk | Defer Phase D |
| Replace/optimize `assets/images/1.png` | Medium byte reduction | High | Medium | Smaller hero/social asset | Hero/social/JSON-LD visual risk | Defer Phase D |
| Split homepage/account CSS | Potential render-blocking reduction | Medium to high | High | Faster first paint potential | Route/auth/member visual risk | Defer Phase D |
| Critical CSS extraction | Potential render-blocking reduction | High | High | Faster first paint potential | Requires build/pipeline/design review | Defer Phase D |
| Hero SVG/filter simplification | Potential paint reduction | High | High | Lower runtime paint/GPU cost | Visible hero regression risk | Defer Phase D |
| Content visibility for below-the-fold sections | Potential layout/render reduction | Medium | Medium | Less initial render work | Safari/anchor/category transition risk | Defer Phase D |
| Additional animation gating | Low to medium | Medium | Medium | Lower runtime cost when inactive | Must preserve visual timing | Defer Phase D |

## Rollback Notes

Phase C added this report and one test-only hardening line. Rollback is limited to removing `docs/performance/phase-c-media-css-runtime.md` and reverting the timestamp normalization in `tests/workers.spec.js`.

No static runtime bundle, Worker, API route, D1 migration, R2 binding, Cloudflare config, secret, package, media asset, model behavior, pricing, billing, or credit behavior was changed.

## Exact Validation Commands And Results

| Command | Result |
| --- | --- |
| `git status --short` | Passed before edits; working tree was clean. |
| `git branch --show-current` | `main`. |
| `git log -1 --oneline` | `b00eb011 PhaseB`. |
| `node --version` | `v26.0.0`; outside declared engine range. |
| `npm --version` | `11.12.1`. |
| `npm run check:toolchain` | Passed. |
| `npm run check:js` | Passed. |
| `npm run check:dom-sinks` | Passed. |
| `npm run check:doc-currentness` | Passed before and after the Phase C report. |
| `npm run test:doc-currentness` | Passed after the Phase C report. |
| `npm run build:static` | Passed. |
| `npm run audit:performance` | Passed. |
| `npm run audit:performance:markdown` | Passed. |
| `npm run test:asset-version` | Passed. |
| `npm run validate:asset-version` | Passed. |
| `npm run test:release-compat` | Passed. |
| `npm run validate:release` | Passed. |
| `npm run check:static-deploy-safety` | Passed; changed files require no static deploy and no Worker deploy. |
| `npm run test:static-deploy-safety` | Passed. |
| `npm run test:static` | First full run had one News Pulse timeout; the focused test passed, and a full rerun passed with 355 tests. |
| `npx playwright test -c playwright.config.js tests/smoke.spec.js -g "homepage KI-PULS renders as a centered hero news box with indicator navigation"` | Passed after the first full static timeout. |
| `npm run test:workers` | First run exposed the timestamp false positive described above; after test hardening, full rerun passed with 673 tests. |
| `npx playwright test -c playwright.workers.config.js tests/workers.spec.js -g "POST /api/admin/ai/test-embeddings returns the embeddings response contract used by the UI"` | Passed after test hardening. |
| `npm test` | Passed: static suite and Worker suite both exited cleanly. |
| `git diff --check` | Passed. |

## Phase D Recommendations

1. Add screenshot-based route coverage for homepage, German homepage, account/auth modal states, Generate Lab, admin, pricing, legal, mobile, tablet, and reduced-motion before CSS loading changes.
2. Investigate whether `assets/images/hero/hero-flow-mobile.mp4` is still needed by runtime routes or only by tests, then decide whether to keep, replace, or move it into a fixture-specific location.
3. Build a media derivative policy for hero/social assets before changing `assets/images/1.png`.
4. Audit numbered JPGs with content ownership and fixture coverage before deletion or derivative conversion.
5. Explore route-specific CSS splitting only with visual regression coverage and no framework/bundler migration.
6. Prototype `content-visibility` on below-the-fold Explore sections in a separate branch with Safari/iOS and hash-scroll verification.
7. Profile hero SVG filters with DevTools/Performance in a browser environment that can record paint/GPU traces, then decide whether a visually equivalent lower-cost version is worth a design review.

## Final Recommendation

Hold implementation changes for Phase D. Phase C should be treated as a measured audit checkpoint: it preserves Phase A/B gains, documents the remaining media/CSS/runtime risks, and avoids making unproven changes that could affect BITBI's current visual identity or product behavior.
