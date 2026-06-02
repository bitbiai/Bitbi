# BITBI Phase D - Media Derivatives and Visual Guardrails

## 1. Executive Summary

Phase D created a safe foundation for future media optimization without replacing any runtime asset. The implementation added:

- a machine-readable derivative planning manifest at `docs/performance/media-derivatives-manifest.json`;
- a deterministic media derivative inventory script;
- a local Playwright visual evidence capture script with API stubs that avoid paid generation, billing, payment, and mutation endpoints.

No original media asset was deleted, renamed, recompressed, replaced, or integrated through a new derivative. No HTML, CSS, public runtime JavaScript, Worker route, model, billing, auth, D1, R2, binding, secret, workflow, or deployment configuration was changed.

The main Phase D decision is conservative: the largest media opportunities are real, but current references make blind replacement unsafe. `assets/images/1.png` is both a hero/structured/social asset, favicon/manifest assets are high-risk browser/SEO assets, and the largest MP4 is currently referenced by tests/docs rather than direct runtime HTML/CSS/JS. Phase D therefore ships guardrails and manifest evidence, not visual swaps.

## 2. Repository State Inspected

| Item | Value |
| --- | --- |
| Branch | `main` |
| Latest commit | `56571334 PhaseC` |
| Initial working tree | Clean before Phase D edits |
| Current Phase D changed files | `package.json`, `docs/performance/media-derivatives-manifest.json`, `docs/performance/phase-d-media-derivatives-visual-guardrails.md`, `scripts/capture-visual-guardrails.mjs`, `scripts/media-derivative-inventory.mjs` |
| Node | `v26.0.0` |
| npm | `11.12.1` |
| Engine note | `package.json` declares Node `>=20 <21`; `npm run check:toolchain` passed in this environment |

The first non-escalated visual audit attempt failed with `listen EPERM: operation not permitted 127.0.0.1`, which is a sandbox loopback binding limitation. The visual audit was rerun with explicit approval to bind a local loopback server and launch Playwright browsers.

## 3. Phase A/B/C Baseline Recap

| Phase | Result |
| --- | --- |
| Phase A | Lazy-loaded homepage Create-only modules: `studio.js`, `video-create.js`, `soundlab-create.js`. Static homepage graph changed from 63 modules / 969,663 source bytes to 60 modules / 925,343 source bytes. |
| Phase B | Lazy-loaded Models overlay and fixed first-click replay around lazy boundaries. Static homepage graph changed from 60 modules / 925,343 source bytes to 47 modules / 801,606 source bytes. |
| Phase C | Audited media, CSS, and runtime cost. Deferred media derivative changes because they need visual/SEO/pipeline guardrails. No runtime behavior changes. |
| Phase D baseline | Static homepage graph remained 47 modules / 801,606 source bytes before Phase D runtime decisions. |

## 4. Media Inventory Summary

`npm run audit:media-derivatives` scanned `assets/` and `fonts/`, traced first-party references in text-like source files, and loaded the Phase D derivative manifest.

| Category | Files | Bytes | Human |
| --- | --- | --- | --- |
| font | 20 | 476,132 | 465.0 KB |
| image | 17 | 2,959,787 | 2.8 MB |
| other | 2 | 650 | 650 B |
| video | 1 | 2,170,158 | 2.1 MB |

Largest media/font assets:

| Rank | Path | Bytes | Dimensions | Notes |
| --- | --- | --- | --- | --- |
| 1 | `assets/images/hero/hero-flow-mobile.mp4` | 2,170,158 | unknown | Largest asset; current references are tests/docs, not direct homepage runtime references. |
| 2 | `assets/images/1.jpg` | 536,335 | 1429x803 | Test/public-media fixture references; do not replace without fixture contract review. |
| 3 | `assets/images/1.png` | 361,041 | 600x391 | Hero image, Open Graph/Twitter, JSON-LD image, high-priority preload. |
| 4 | `assets/favicons/android-chrome-512x512.png` | 358,316 | 512x512 | Favicon/manifest icon and Organization logo reference. |
| 5 | `assets/images/4.jpg` | 344,749 | 784x1168 | No direct runtime reference found; provenance review required before any cleanup. |
| 6 | `assets/images/6.jpg` | 294,695 | 784x1168 | Same as above. |
| 7 | `assets/images/5.jpg` | 294,653 | 784x1168 | Same as above. |
| 8 | `assets/images/3.jpg` | 243,978 | 784x1168 | Same as above. |
| 9 | `assets/images/2.jpg` | 224,996 | 784x1168 | Same as above. |
| 10 | `assets/favicons/android-chrome-192x192.png` | 58,380 | 192x192 | Manifest icon; high-risk browser/favicons class. |

Favicon/social/manifest assets found:

- `assets/images/1.png`: social preview and structured data image.
- `assets/favicons/android-chrome-512x512.png`: manifest icon and structured Organization logo reference.
- `assets/favicons/android-chrome-192x192.png`: manifest icon.
- `assets/favicons/apple-touch-icon.png`, `favicon.ico`, `favicon-32x32.png`, `favicon-16x16.png`, and `site.webmanifest`: browser icon/manifest references.

No generated derivatives are present.

## 5. Derivative Candidate Matrix

| Source asset | Current bytes | Current dimensions | Current references | Fold/role | Proposed derivative | Impact | Risk | Effort | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `assets/images/hero/hero-flow-mobile.mp4` | 2,170,158 | unknown | `tests/auth-admin.spec.js`, `tests/smoke.spec.js`, performance docs | Candidate video / fixture evidence | Same-format MP4 derivative under `assets/derivatives/hero/` after playback review | 5 | 4 | 4 | `deferred_phase_e` |
| `assets/images/1.png` | 361,041 | 600x391 | home EN/DE, Generate Lab EN/DE, social metadata, JSON-LD, tests | Above fold / social / structured data | Lossless PNG candidate only | 3 | 5 | 3 | `do_not_change_phase_d` |
| `assets/favicons/android-chrome-512x512.png` | 358,316 | 512x512 | key pages, `site.webmanifest`, structured Organization logo | Favicon/manifest/SEO | Lossless PNG candidate only after favicon/browser review | 3 | 5 | 3 | `do_not_change_phase_d` |
| `assets/images/1.jpg` | 536,335 | 1429x803 | Worker/static fixture tests | Test/public media fixture | Fixture-specific thumbnail only if route fixture semantics change intentionally | 2 | 5 | 3 | `deferred_fixture_review` |
| `assets/images/2.jpg` to `6.jpg` | 224,996 to 344,749 | 784x1168 | No direct runtime reference found by source scan; docs mention inventory | Legacy/unconfirmed | WebP candidate after ownership/provenance review | 2 | 4 | 3 | `deferred_provenance_review` |
| `assets/images/botton/gallery.webp` | 49,664 | 480x322 | `css/pages/index.css` | CSS background | Optional AVIF with CSS fallback design | 2 | 3 | 3 | `deferred_visual_css_review` |
| `assets/images/botton/video.webp` | 51,446 | 480x322 | `css/pages/index.css` | CSS background | Optional AVIF with CSS fallback design | 2 | 3 | 3 | `deferred_visual_css_review` |
| `assets/images/botton/soundlab.webp` | 45,654 | 480x322 | `css/pages/index.css` | CSS background | Optional AVIF with CSS fallback design | 2 | 3 | 3 | `deferred_visual_css_review` |

Recommendation rule applied: implement now only when impact >= 3, risk <= 2, effort <= 3, visual guardrails pass, SEO/social risk is absent, and rollback is trivial. No candidate met that full bar in Phase D.

## 6. CSS Inventory Summary

Source CSS largest files:

| Path | Bytes |
| --- | --- |
| `css/pages/index.css` | 175,774 |
| `css/admin/admin.css` | 145,273 |
| `css/account/assets-manager.css` | 77,478 |
| `css/components/components.css` | 76,714 |
| `css/account/profile.css` | 69,183 |
| `css/pages/generate-lab.css` | 49,843 |
| `css/components/wallet.css` | 28,589 |
| `css/components/auth.css` | 21,893 |
| `css/components/news-pulse.css` | 19,299 |

`npm run audit:performance` reported 22 CSS files and 750,167 CSS bytes in `_site`.

Render-blocking stylesheet counts remain unchanged:

| Page | CSS links | Module scripts | Preloads |
| --- | --- | --- | --- |
| `index.html` | 9 | 1 | 3 |
| `de/index.html` | 9 | 1 | 3 |
| `generate-lab/index.html` | 8 | 1 | 2 |
| `de/generate-lab/index.html` | 8 | 1 | 2 |
| `admin/index.html` | 8 | 1 | 2 |

No CSS splitting, pruning, critical extraction, `content-visibility`, containment, or selector deletion was implemented in Phase D. Those remain Phase E/D+ candidates because they need route coverage and visual approval.

## 7. Runtime Cost Inventory

Phase D did not change runtime behavior. The visual guardrail script records DOM/resource/animation metrics for route/device evidence:

- Chromium desktop `/` initial sample: 1,414 DOM nodes, 97 active animations, 3 images, 0 videos, 76 resource entries.
- Chromium desktop `/` initial sample: `domContentLoadedEventEnd` around 80 ms and `loadEventEnd` around 87 ms in the local stub/static environment. These are local-only numbers, not production Web Vitals.
- Homepage initial active category remained `video` in the local capture.
- First Models interaction, mobile nav open, and Gallery/Video/Sound Lab scroll/category paths were exercised for home routes.

Runtime hotspots remain the same as Phase C:

- hero canvas/particle and binary rain effects;
- large inline hero SVG/ray/filter/animation surfaces;
- category carousel and media-wall layout settling;
- public Gallery/Video/Sound Lab render paths and fetch/pagination behavior;
- News Pulse placement and carousel behavior;
- mobile/tablet staged layout interactions.

No runtime optimization was implemented because Phase D's scope prioritized media derivative safety and visual guardrails over CSS/runtime rewrites.

## 8. Visual Guardrail Design

Script added: `scripts/capture-visual-guardrails.mjs`

Package script added: `npm run audit:visual-guardrails`

Design:

- Serves `_site` if present, otherwise the source root.
- Uses a local loopback HTTP server and local JSON/media stubs.
- Blocks external network requests.
- Does not invoke paid generation, billing, payment, upload, admin mutation, or Worker mutation endpoints.
- Captures screenshots into ignored `test-results/visual-guardrails/latest/`.
- Writes `summary.json` and `summary.md` for manual review.
- Uses screenshots as evidence artifacts, not brittle committed snapshots.
- Records DOM/resource/layout metrics, console/page errors, expected local auth/stub notices, mobile nav behavior, Models first-click behavior, and category scroll/category transitions.

Coverage from the final run:

| Browser | Coverage |
| --- | --- |
| Chromium | `/`, `/de/`, `/generate-lab/`, `/de/generate-lab/`, `/admin/` across desktop 1440x900, mobile 390x844, tablet 768x1024; plus reduced motion for desktop/mobile home. |
| Firefox | `/` desktop/mobile, `/de/` desktop, and reduced-motion desktop home. |
| WebKit | `/` desktop/mobile, `/de/` desktop, and reduced-motion desktop home. |

The script filters expected local unauthenticated/stub console notices separately from real console errors. Final run result: 25 scenarios, 0 unfiltered console errors, 0 page errors, 0 warnings, 36 expected local auth/stub notices.

Known unstable/limited regions:

- The script does not assert pixel-perfect screenshots. Human visual review remains required before asset integration.
- Admin is captured unauthenticated with local stubs. It verifies page/access-denied rendering, not privileged admin workflows.
- Firefox does not support Playwright `isMobile`; the script uses mobile-sized viewport/touch settings for Firefox instead.
- The local metrics are not Lighthouse, RUM, LCP, INP, CLS, or production-equivalent network metrics.

## 9. Implemented Tooling and Scripts

### `docs/performance/media-derivatives-manifest.json`

Machine-readable planning metadata for derivative candidates. It is stored under `docs/performance/` instead of `config/` because it is audit/reporting metadata, not production runtime source-of-truth configuration.

Every risky candidate is marked `safeToAutoIntegrate: false`.

### `scripts/media-derivative-inventory.mjs`

Local no-network inventory tool:

- scans `assets/` and `fonts/`;
- detects size and dimensions for PNG/JPEG/WebP/GIF/SVG where practical;
- traces first-party references in HTML/CSS/JS/MJS/JSON/XML/SVG/Markdown/Web Manifest files;
- identifies social/SEO/favicon/manifest/high-priority roles;
- reports manifest status/risk and generated derivative presence;
- supports `--markdown`.

### `scripts/capture-visual-guardrails.mjs`

Local no-network visual evidence tool:

- serves static output locally;
- stubs safe API reads;
- blocks external network requests;
- captures screenshots/metrics across browsers, routes, viewports, and reduced-motion modes;
- writes artifacts under ignored `test-results/visual-guardrails/latest/`.

### `package.json`

Added audit scripts:

- `audit:media-derivatives`
- `audit:media-derivatives:markdown`
- `audit:visual-guardrails`

No dependency, lockfile, package upgrade, or package install change was made.

## 10. Generated Derivative Files

None.

Phase D intentionally did not generate derivatives because the current candidates either have SEO/social/favicon risk, fixture contract risk, provenance uncertainty, or CSS fallback/visual review requirements.

## 11. Integrated Derivative Usage

None.

No HTML/CSS/JS/media references were changed. Existing SEO/social/favicons/manifest behavior remains unchanged.

## 12. Before / After Measurements

### Static Homepage Import Graph

| State | Modules | Source bytes |
| --- | --- | --- |
| Phase D before | 47 | 801,606 |
| Phase D after | 47 | 801,606 |
| Delta | 0 | 0 |

Phase D did not target JavaScript graph reduction.

### Asset Totals

| State | Files scanned | Image bytes | Video bytes | Font bytes | Generated derivatives |
| --- | --- | --- | --- | --- | --- |
| Before Phase D | 40 | 2,959,787 | 2,170,158 | 476,132 | 0 |
| After Phase D | 40 | 2,959,787 | 2,170,158 | 476,132 | 0 |
| Delta | 0 | 0 | 0 | 0 | 0 |

### CSS Totals

| State | `_site` CSS files | `_site` CSS bytes |
| --- | --- | --- |
| Before Phase D | 22 | 750,167 |
| After Phase D | 22 | 750,167 |
| Delta | 0 | 0 |

### Visual Guardrail Results

Final `npm run audit:visual-guardrails` run:

- 25 scenarios captured.
- 45 artifact files under `test-results/visual-guardrails/latest/`.
- 0 unfiltered console errors.
- 0 page errors.
- 0 warnings.
- 36 expected local auth/stub console notices filtered.

## 13. Rollback Plan

Rollback is straightforward:

1. Remove `docs/performance/media-derivatives-manifest.json`.
2. Remove `docs/performance/phase-d-media-derivatives-visual-guardrails.md`.
3. Remove `scripts/media-derivative-inventory.mjs`.
4. Remove `scripts/capture-visual-guardrails.mjs`.
5. Remove the three `audit:*` script entries from `package.json`.

No runtime references, deployed assets, Workers, D1 migrations, bindings, or static HTML/CSS/JS paths need rollback because none were changed.

## 14. Deferred Items and Reasons

| Candidate | Decision | Reason |
| --- | --- | --- |
| Lossless optimize `assets/images/1.png` | Defer | High SEO/social/hero/structured data risk; needs exact visual and social-preview approval. |
| Optimize favicon/manifest assets | Defer | Browser icon behavior and manifest/structured-data references are high-risk. |
| Re-encode `hero-flow-mobile.mp4` | Defer | Largest asset, but current source scan found tests/docs references rather than direct runtime references; fixture/playback role must be clarified first. |
| Convert category CSS WebP backgrounds to AVIF | Defer | Needs CSS fallback design and route/device screenshot review before integration. |
| Remove or convert numbered JPGs | Defer | No direct runtime reference found, but provenance and release history are not proven. |
| CSS splitting/critical CSS | Defer | Requires route coverage and visual testing beyond Phase D media guardrail scope. |
| Hero SVG/filter simplification | Defer | Visible design and animation risk. |
| `content-visibility` / containment | Defer | Safari/iOS, scroll restoration, anchor, and reveal-animation risks require a separate focused phase. |

## 15. Phase E Recommendations

1. Use the Phase D manifest to select exactly one low-risk derivative candidate.
2. Generate an additive derivative in a dedicated `assets/derivatives/` path only after human visual approval criteria are defined.
3. Start with non-social, non-favicon, non-hero candidates if possible.
4. Add visual comparison artifacts before integration.
5. Keep original assets and one-line rollback.
6. Consider a favicon/social-specific review phase separately because those assets have browser/SEO semantics beyond byte size.
7. Consider CSS route splitting only after a route-coverage test matrix is stable.

## 16. Commands Run and Results

Baseline and implementation commands run before final validation:

| Command | Result |
| --- | --- |
| `git status --short` | Passed; clean before edits, then expected Phase D tool/report changes. |
| `git branch --show-current` | `main` |
| `git log -1 --oneline` | `56571334 PhaseC` |
| `node --version` | `v26.0.0` |
| `npm --version` | `11.12.1` |
| `npm run check:toolchain` | Passed |
| `npm run check:js` | Passed |
| `npm run check:dom-sinks` | Passed |
| `npm run check:doc-currentness` | Passed before adding Phase D report |
| `npm run build:static` | Passed |
| `npm run audit:performance` | Passed |
| `npm run audit:performance:markdown` | Passed |
| `npm run audit:media-derivatives` | Passed |
| `npm run audit:media-derivatives:markdown` | Passed |
| `npm run audit:visual-guardrails` | First non-escalated attempt failed with sandbox `listen EPERM`; final escalated local run passed with 25 scenarios and no unfiltered errors. |

Final validation results are recorded in the final Codex response for this phase.

## 17. Phase D Recommendation

Ship the guardrails and manifest as tooling/docs only after validation passes. Hold all derivative integration until a single candidate receives explicit visual/SEO/browser approval.

