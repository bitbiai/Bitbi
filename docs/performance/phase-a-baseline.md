# BITBI Phase A Performance Baseline

## Executive Summary

Phase A inspected the current static-site and Workers-backed architecture without changing product behavior. The site already has useful safety foundations: static HTML entry points, local versioned assets, ES module page entries, reduced-motion branches for major effects, and a release build that replaces `__ASSET_VERSION__` placeholders.

The main low-risk initial-load opportunity found locally is the homepage create-only code. `js/pages/index/main.js` previously imported Gallery Studio, Video Create, and Sound Lab Create during initial homepage module evaluation, even though those panes only initialize after a signed-in user selects Create mode. Phase A makes those modules lazy first-use imports while preserving the existing auth gate and one-time initialization behavior.

No live production timing, Core Web Vitals, CDN cache, Cloudflare analytics, or real-user measurement data was available locally. All byte counts below are local source or `_site` build measurements.

## Current Architecture Summary

- Frontend: static HTML, CSS, and vanilla ES modules.
- Main public entry points inspected: `/`, `/de/`, `/generate-lab/`, `/de/generate-lab/`, and `/admin/`.
- Static build: `scripts/build-static-site.mjs` copies the configured root files/directories to `_site` and replaces `__ASSET_VERSION__` through `scripts/lib/asset-version.mjs`.
- Backend/API: Cloudflare Workers remain separate deploy units and were not changed for Phase A.
- Homepage runtime: `js/pages/index/main.js` initializes the public homepage modules, auth/nav integrations, visual effects, media galleries, News Pulse, category carousel, favorites, wallet/audio UI, and create-mode gates.

## Local Score Estimates

| Area | Estimate | Reasoning |
| --- | ---: | --- |
| Performance foundation | 68 / 100 | The static architecture and local asset versioning are good. Initial load still carries 9 render-blocking CSS links on the homepage, a large homepage JS graph, heavy hero/media assets, and broad shared UI modules. No production RUM or Lighthouse data was available. |
| Compatibility foundation | 76 / 100 | ES modules, optional chaining, dynamic import, ResizeObserver, IntersectionObserver, `inert`, and modern media-query listeners are already part of the project. Several modules include fallbacks, but some media-query listeners still use direct `addEventListener('change')` without `addListener` fallback. Safari/iOS video autoplay remains a practical compatibility risk. |

## Initial Resource Inventory

Local `_site` inventory after `npm run build:static`:

| Category | Files | Bytes | Human |
| --- | ---: | ---: | ---: |
| css | 22 | 750,167 | 732.6 KB |
| font | 20 | 476,132 | 465.0 KB |
| html | 33 | 927,936 | 906.2 KB |
| image | 17 | 2,959,787 | 2.8 MB |
| js | 129 | 2,351,882 | 2.2 MB |
| other | 5 | 2,931 | 2.9 KB |
| video | 1 | 2,170,158 | 2.1 MB |

Largest local build files:

| Rank | File | Bytes | Human |
| ---: | --- | ---: | ---: |
| 1 | `assets/images/hero/hero-flow-mobile.mp4` | 2,170,158 | 2.1 MB |
| 2 | `assets/images/1.jpg` | 536,335 | 523.8 KB |
| 3 | `assets/images/1.png` | 361,041 | 352.6 KB |
| 4 | `assets/favicons/android-chrome-512x512.png` | 358,316 | 349.9 KB |
| 5 | `assets/images/4.jpg` | 344,749 | 336.7 KB |
| 6 | `assets/images/6.jpg` | 294,695 | 287.8 KB |
| 7 | `assets/images/5.jpg` | 294,653 | 287.7 KB |
| 8 | `js/pages/admin/ai-lab.js` | 257,049 | 251.0 KB |
| 9 | `assets/images/3.jpg` | 243,978 | 238.3 KB |
| 10 | `assets/images/2.jpg` | 224,996 | 219.7 KB |
| 11 | `admin/index.html` | 201,312 | 196.6 KB |
| 12 | `css/pages/index.css` | 175,774 | 171.7 KB |
| 13 | `css/admin/admin.css` | 145,273 | 141.9 KB |
| 14 | `js/shared/locale.js` | 126,941 | 124.0 KB |
| 15 | `js/shared/saved-assets-browser.js` | 110,477 | 107.9 KB |

Key HTML entry references:

| Page | CSS links | Module scripts | Preloads |
| --- | ---: | ---: | ---: |
| `index.html` | 9 | 1 | 3 |
| `de/index.html` | 9 | 1 | 3 |
| `generate-lab/index.html` | 8 | 1 | 2 |
| `de/generate-lab/index.html` | 8 | 1 | 2 |
| `admin/index.html` | 8 | 1 | 2 |

Homepage import graph:

| State | Static modules | Static source bytes |
| --- | ---: | ---: |
| Read-only baseline before Phase A code change | 63 | 969,663 |
| After Phase A create-module lazy loading | 60 | 925,343 |

The measured source-graph reduction is 44,320 bytes of initial static imports. This is not a network byte claim, because browser caching, transfer compression, and module waterfall timing were not measured locally.

## Initial Homepage Execution Map

Runs immediately on homepage load:

- Inline category-hash scroll guard in `index.html` and `de/index.html`.
- Inline reload scroll-restoration guard in `index.html` and `de/index.html`.
- Main homepage module entry: `js/pages/index/main.js`.
- Navigation, locale switcher, Help Menu, cookie consent, contact drawer, auth state, auth navigation, auth entry actions, and auth modal setup.
- Homepage hero scaling, creation-stream anchoring, latest model video module, News Pulse, particles, binary rain, binary footer, smooth scroll, and scroll reveal.
- Gallery, Video, and Sound Lab explore surfaces, category carousel, public media wall sizing, favorites loading, wallet controller, global audio UI, and models overlay setup.

Runs later or after user intent:

- Gallery Studio after an authenticated user selects Gallery Create.
- Video Create after an authenticated user selects Video Create.
- Sound Lab Create after an authenticated user selects Sound Lab Create.
- Auth modal interaction after auth-required actions.
- Models overlay content after the overlay is opened.
- Wallet workspace after wallet entry interaction.
- Audio playback after Sound Lab/media interaction.
- Video hover preview work after desktop hover on video cards.
- "More" pagination and media modals after user actions.

## Largest Likely Resource Consumers

| Rank | Consumer | Evidence | Impact |
| ---: | --- | --- | --- |
| 1 | Hero/mobile video asset | `assets/images/hero/hero-flow-mobile.mp4` is 2.1 MB | High network cost where requested. |
| 2 | Static image assets | Several homepage images are 220 KB to 524 KB | Medium to high, depending on which images are loaded by the current route. |
| 3 | Homepage CSS | `css/pages/index.css` is 171.7 KB and homepage loads 9 CSS files | High render-blocking potential. |
| 4 | Homepage JS graph | Pre-change graph was 63 modules and 969,663 source bytes | Medium to high parse/evaluation cost. |
| 5 | Locale/shared UI modules | `locale.js`, wallet, audio, auth, and overlay modules are prominent in the graph | Medium, but behavior-sensitive and deferred to later phases. |
| 6 | Media wall DOM generation | Gallery, Video, and Sound Lab initialize on the homepage | Medium runtime cost, but directly visible and behavior-sensitive. |
| 7 | Hero SVG/effects | Creation stream, particles, binary rain, and model videos initialize early | Medium CPU/rendering cost, with reduced-motion and visibility guards already present in several places. |

## Compatibility Risks

| Severity | Risk | Notes |
| --- | --- | --- |
| Medium | Modern JS baseline | The project uses module scripts, optional chaining, and now dynamic imports. This matches the existing static ES module architecture but excludes older browsers. |
| Medium | Media-query listener fallback inconsistency | Some modules use `addListener` fallback, while `shared/navbar.js`, `shared/audio/audio-ui.js`, `shared/studio-deck.js`, and selected page modules use direct `addEventListener('change')`. |
| Medium | Safari/iOS autoplay and inline video | Hero videos, hover previews, and generated video previews use muted/autoplay/playsinline patterns. Posters and fallback states reduce risk, but real device testing is needed. |
| Low to medium | `ResizeObserver` and `IntersectionObserver` availability | Many effects use guards or fallbacks, but older browsers may skip some enhancements. |
| Low to medium | `inert` support | Homepage category panels use `inert`; modern browsers support it, but legacy support is limited. |
| Low | Reduced-motion handling drift | Major visual systems have reduced-motion checks, but not every animation/effect path has identical cleanup behavior. |

## Safe Phase A Change Candidates

| Candidate | Evidence | Expected impact | Effort | Risk | Phase A action |
| --- | --- | --- | --- | --- | --- |
| Lazy-load homepage create-only modules | `studio.js`, `video-create.js`, and `soundlab-create.js` were statically imported but only called inside authenticated Create mode branches. Each module has its own initialization guard. | Reduces initial homepage static import graph by about 44 KB source and avoids initial parse/evaluation for create-only code. | Low | Low | Implemented. |
| Add local inventory script | Current measurements required ad hoc shell commands. | Makes future optimization phases repeatable and reviewable. | Low | Low | Implemented. |
| Lazy-load wallet/audio/models overlay | These are likely not needed for first paint, but they are cross-page and interaction-sensitive. | Potentially larger JS reduction. | Medium | Medium | Deferred to Phase B. |
| CSS consolidation/critical CSS | Homepage loads 9 CSS files and `index.css` is large. | Potential render-blocking improvement. | High | Medium to high visual regression risk. | Deferred. |
| Image/video encoding review | Largest build assets are media. | Potential network savings. | Medium | Medium visual quality and content risk. | Deferred pending visual review. |
| Media-query listener fallback hardening | `rg` found inconsistent listener fallback patterns. | Better compatibility. | Low to medium | Low if targeted. | Deferred unless test evidence requires it. |

## Explicit Non-goals For Phase A

- No visual redesign or intentional visible layout, color, typography, animation, navigation, route, copy, or breakpoint changes.
- No AI model, payload, provider, billing, credit, admin/member visibility, or API contract changes.
- No CSS consolidation or page redesign.
- No image/video re-encoding or asset replacement.
- No new framework, bundler, runtime dependency, package manager, or build pipeline.
- No Cloudflare Worker, D1 migration, binding, secret, queue, or workflow changes.
- No production/live measurement claims.

## Commands Run And Results

| Command | Result |
| --- | --- |
| `git status --short` | Passed; working tree was clean before edits. |
| `node --version` | `v26.0.0`. Note: `package.json` declares `>=20 <21`, so local Node is newer than the declared project engine. |
| `npm --version` | `11.12.1`. |
| dependency check | `node_modules present`; `npm install` was not run. |
| `npm run check:toolchain` | Passed. |
| `npm run check:js` | Passed before Phase A edits. |
| `npm run build:static` | Passed before Phase A edits. |
| `npm run test:static` | Passed before Phase A edits: 355 passed. |
| ad hoc resource inventory | Completed locally against `_site`; values are recorded above. |
| ad hoc import graph scan | Completed locally against `js/pages/index/main.js`; values are recorded above. |
| `npm run check:js` | Passed after Phase A edits. |
| `npm run check:dom-sinks` | Passed after Phase A edits. |
| `npm run build:static` | Passed after Phase A edits. |
| `npm run audit:performance` | Passed after Phase A edits. |
| `npm run audit:performance:markdown` | Passed after Phase A edits. |
| `npm run test:asset-version` | Passed after Phase A edits. |
| `npm run validate:asset-version` | Passed after Phase A edits. |
| `npm run test:static` | Passed after Phase A edits: 355 passed. |
| `npm run test:workers` | Passed after Phase A edits: 673 passed. |
| `npm run test:release-compat` | Passed after Phase A edits. |
| `npm run validate:release` | Passed after Phase A edits. |
| `npm run check:static-deploy-safety` | Passed after Phase A edits; mode reported `static_only`, worker deploys none, schema applies none. |
| `npm run test:static-deploy-safety` | Passed after Phase A edits. |
| `npm test` | Initial sandboxed run failed because the Playwright web server could not bind `0.0.0.0:3000` (`listen EPERM`). Re-run with approved escalation passed: 355 static tests and 673 worker tests. |
| `git diff --check` | Passed after Phase A edits. |

## Open Questions Requiring Production Or Product Input

- Real Core Web Vitals and browser timing are not measured locally. Production RUM or Lighthouse on a deployed preview is needed before ranking network and render-blocking improvements with confidence.
- CDN cache headers and Cloudflare compression behavior were not measured locally.
- Whether the large hero/mobile video can be re-encoded, poster-swapped, or conditionally loaded differently requires product/design review.
- CSS consolidation could help, but visual risk is higher than Phase A allows without screenshot baselines.
- Lazy-loading wallet/audio/models overlay modules may be safe, but it needs targeted interaction tests and a separate review because those modules affect auth, wallet, media, and overlay flows.
