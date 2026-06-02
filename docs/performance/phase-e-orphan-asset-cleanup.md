# BITBI Phase E - Orphan Asset Cleanup

## 1. Executive Summary

This cleanup verified and removed only confirmed orphan assets from the retired home category arrow surface. The current runtime HTML contains no `.home-categories__arrow` or `data-category-nav` controls, and existing smoke tests explicitly assert that those controls are absent.

Removed assets:

- `assets/images/botton/gallery.webp`
- `assets/images/botton/video.webp`
- `assets/images/botton/soundlab.webp`
- `assets/images/botton/pivimu.webp`
- `assets/derivatives/phase-e/botton-video-q82.webp`
- `assets/images/2.jpg`
- `assets/images/3.jpg`
- `assets/images/4.jpg`
- `assets/images/5.jpg`
- `assets/images/6.jpg`

Runtime cleanup:

- Removed dead `.home-categories__arrow*` CSS from `css/pages/index.css`.
- Removed unreachable optional prev/next button logic from `js/pages/index/category-carousel.js`.

No SEO/social/favicon/runtime-critical asset was removed. `assets/images/1.png` is preserved.

## 2. Repository State Inspected

| Item | Value |
| --- | --- |
| Branch | `main` |
| Latest commit | `55bd1029 PhaseE` |
| Initial working tree | Clean before cleanup edits |
| Node | `v26.0.0` |
| npm | `11.12.1` |
| Toolchain | `npm run check:toolchain` passed, despite local Node being outside repo engine range `>=20 <21` |

Initial commands before deletion:

- `git status --short`: clean
- `git branch --show-current`: `main`
- `git log -1 --oneline`: `55bd1029 PhaseE`
- `node --version`: `v26.0.0`
- `npm --version`: `11.12.1`
- `npm run check:toolchain`: passed
- `npm run build:static`: passed
- `npm run audit:performance`: passed
- `npm run audit:media-derivatives`: passed

## 3. Reference Audit

Exact source and built-output scans were run before deletion. Results:

| Asset or surface | Result | Decision |
| --- | --- | --- |
| `assets/images/1.png` | Referenced by EN/DE homepage hero, OG/Twitter metadata, JSON-LD, high-priority preload, Generate Lab metadata, Pricing metadata, and tests. | Keep. |
| `assets/images/hero/hero-flow-mobile.mp4` | Referenced by `tests/auth-admin.spec.js`, `tests/smoke.spec.js`, and performance docs. | Keep. |
| `assets/images/1.jpg` | Referenced by Worker/static tests as a media fixture. | Keep. |
| `assets/images/2.jpg` to `assets/images/6.jpg` | Follow-up `rg` scans found no runtime, test, active-doc-currentness, manifest dependency, or built-output dependency. Remaining mentions are historical performance evidence and cleanup metadata only. | Delete. |
| `assets/images/botton/pivimu.webp` | No source or built-output references found. | Delete. |
| `assets/derivatives/phase-e/botton-video-q82.webp` | Mentioned only by Phase E docs/manifest; not integrated. | Delete. |
| Category arrow assets | Prior references existed only through `.home-categories__arrow*` CSS. Current HTML has no arrow controls and smoke tests assert zero arrow controls. | Delete assets and dead CSS/JS branch. |

After cleanup and rebuild, `_site` scans found no runtime references to:

- `botton/gallery`
- `botton/video`
- `botton/soundlab`
- `botton/pivimu`
- `botton-video-q82`
- `home-categories__arrow`
- `data-category-nav`
- `assets/images/2.jpg` through `assets/images/6.jpg`

## 4. Category Arrow Status

The category arrow UI is confirmed inactive in current runtime:

- `index.html`, `de/index.html`, Pricing pages, Generate Lab pages, and Admin HTML do not contain `data-category-nav` or `.home-categories__arrow` controls.
- `tests/smoke.spec.js` asserts `stage.locator('[data-category-nav]')` has count `0`.
- `tests/smoke.spec.js` asserts `page.locator('.home-categories__arrow')` has count `0`.
- The only previous live source references were dead CSS rules and optional JS branches that tolerated absent buttons.

The active category navigation remains the header/category link flow handled by `[data-category-link]`, hash changes, staged layout state, and alignment logic.

## 5. Manifest And Phase E Report Updates

`docs/performance/media-derivatives-manifest.json` now records the removed category-arrow assets as `removed_orphan_cleanup` with their removed byte counts. The Phase E generated derivative entry was changed from pending approval to removed/not integrated.

`docs/performance/phase-e-controlled-media-pilot.md` now includes a cleanup follow-up note explaining that the Phase E approval packet is historical evidence only because the underlying category-arrow runtime was confirmed dead.

## 6. Before / After Measurements

### Asset Totals

| Metric | Before cleanup | After cleanup | Delta |
| --- | ---: | ---: | ---: |
| `_site` total files | 228 | 218 | -10 |
| `_site` image files | 18 | 8 | -10 |
| `_site` image bytes | 2,985,879 | 1,385,592 | -1,600,287 |
| `_site` CSS bytes | 750,167 | 739,057 | -11,110 |
| Source media assets scanned | 41 | 31 | -10 |
| Generated derivative assets | 1 | 0 | -1 |

### Static Homepage Graph

| Metric | Before cleanup | After cleanup | Delta |
| --- | ---: | ---: | ---: |
| Static homepage modules | 47 | 47 | 0 |
| Static homepage source bytes | 801,606 | 798,689 | -2,917 |

## 7. Assets Deleted

| Path | Bytes | Reason |
| --- | ---: | --- |
| `assets/images/botton/gallery.webp` | 49,664 | Old category-arrow CSS background; category-arrow DOM is absent. |
| `assets/images/botton/video.webp` | 51,446 | Old category-arrow CSS background; category-arrow DOM is absent. |
| `assets/images/botton/soundlab.webp` | 45,654 | Old category-arrow CSS background; category-arrow DOM is absent. |
| `assets/images/botton/pivimu.webp` | 24,360 | Exact source and built-output scans found no references. |
| `assets/derivatives/phase-e/botton-video-q82.webp` | 26,092 | Phase E derivative was never integrated and its source UI is dead. |
| `assets/images/2.jpg` | 224,996 | Follow-up exact scans found no runtime, test, active-doc-currentness, manifest dependency, or built-output dependency. |
| `assets/images/3.jpg` | 243,978 | Follow-up exact scans found no runtime, test, active-doc-currentness, manifest dependency, or built-output dependency. |
| `assets/images/4.jpg` | 344,749 | Follow-up exact scans found no runtime, test, active-doc-currentness, manifest dependency, or built-output dependency. |
| `assets/images/5.jpg` | 294,653 | Follow-up exact scans found no runtime, test, active-doc-currentness, manifest dependency, or built-output dependency. |
| `assets/images/6.jpg` | 294,695 | Follow-up exact scans found no runtime, test, active-doc-currentness, manifest dependency, or built-output dependency. |

Total removed asset bytes from the cleanup diff: 1,395,287.

## 8. Assets Kept

| Path | Reason |
| --- | --- |
| `assets/images/1.png` | Active hero image, OG/Twitter image, JSON-LD image, high-priority preload, and locale/static test target. |
| `assets/images/hero/hero-flow-mobile.mp4` | Test fixture references remain active. |
| `assets/images/1.jpg` | Worker/static tests use it as a fixture. |
| favicon and manifest assets | SEO/browser identity assets; not part of this cleanup. |

## 9. Risk Assessment

Risk is low because the removed files had no live runtime DOM path after deleting the dead CSS/JS references, and tests already assert that category arrow controls are absent. The remaining risk is that the old category-arrow UI might be intentionally restored later; rollback is straightforward by reverting this cleanup and restoring the deleted assets.

No visible design change is expected because there was no matching DOM to render the removed CSS surface.

## 10. Rollback Plan

To roll back:

1. Restore the five deleted asset files from git.
2. Revert the `.home-categories__arrow*` CSS removal in `css/pages/index.css`.
3. Revert the optional prev/next branch removal in `js/pages/index/category-carousel.js`.
4. Revert the manifest and Phase E report follow-up updates.
5. Re-run static build, media inventory, visual guardrails, and static tests.

## 11. Validation Results

Initial read-only validation:

- `npm run check:toolchain`: passed
- `npm run build:static`: passed
- `npm run audit:performance`: passed
- `npm run audit:media-derivatives`: passed

Post-cleanup validation:

- Manifest JSON parse check: passed
- `npm run check:toolchain`: passed
- `npm run check:js`: passed
- `npm run check:dom-sinks`: passed
- `npm run check:doc-currentness`: passed
- `npm run test:doc-currentness`: passed
- `npm run build:static`: passed
- `npm run audit:performance`: passed
- `npm run audit:performance:markdown`: passed
- `npm run audit:media-derivatives`: passed
- `npm run audit:media-derivatives:markdown`: passed
- `npm run audit:visual-guardrails`: passed, captured 25 scenarios with 0 warnings and 0 unfiltered console errors
- `npm run test:asset-version`: passed
- `npm run validate:asset-version`: passed
- `npm run test:release-compat`: passed
- `npm run validate:release`: passed
- `npm run check:static-deploy-safety`: passed, classified as `static_only`
- `npm run test:static-deploy-safety`: passed
- `npm run test:static`: passed, 355 tests
- `npm run test:workers`: passed, 673 tests
- `npm test`: passed, 355 static tests and 673 worker tests
- `git diff --check`: passed
