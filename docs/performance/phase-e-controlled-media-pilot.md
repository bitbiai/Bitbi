# BITBI Phase E - Controlled Media Derivative Pilot

## 1. Executive Summary

Phase E ran in E1 mode: candidate generation and approval packet only. No derivative was integrated into runtime HTML, CSS, JavaScript, SEO metadata, social preview metadata, favicon references, or manifest references.

One small pilot candidate was selected from the Phase D manifest:

- source: `assets/images/botton/video.webp`
- derivative: `assets/derivatives/phase-e/botton-video-q82.webp`
- current bytes: 51,446
- derivative bytes: 26,092
- byte delta: -25,454 bytes (-49.48%)

The derivative is additive, same-format WebP, preserves the 480x322 dimensions, and remains alpha-capable (`yuva420p`). It is not approved for integration. The manifest keeps `safeToAutoIntegrate: false`, `humanApprovalStatus: "pending"`, and `integrationStatus: "not_integrated"`.

No original asset was deleted, overwritten, renamed, or replaced.

## 2. Repository State Inspected

| Item | Value |
| --- | --- |
| Branch | `main` |
| Latest commit | `cabb4306 PhaseD` |
| Initial working tree | Clean before Phase E edits |
| Node | `v26.0.0` |
| npm | `11.12.1` |
| Toolchain result | `npm run check:toolchain` passed, despite local Node being outside the repo engine range `>=20 <21` |
| Phase E mode | E1 candidate/approval packet only |

Initial read-only commands:

- `git status --short`: clean
- `git branch --show-current`: `main`
- `git log -1 --oneline`: `cabb4306 PhaseD`
- `node --version`: `v26.0.0`
- `npm --version`: `11.12.1`

## 3. Phase A/B/C/D Recap

| Phase | Result |
| --- | --- |
| Phase A | Lazy-loaded homepage Create-only modules and reduced the initial homepage static graph from 63 modules / 969,663 source bytes to 60 modules / 925,343 source bytes. |
| Phase B | Lazy-loaded the homepage Models overlay and added first-click replay protection; initial homepage graph reached 47 modules / 801,606 source bytes. |
| Phase C | Audited media, CSS, and runtime cost; deferred risky media/CSS/runtime changes. |
| Phase D | Added media derivative inventory tooling, `docs/performance/media-derivatives-manifest.json`, and Playwright visual guardrails; generated and integrated no derivatives. |

## 4. Candidate Selection Process

Phase E used the Phase D manifest and current `npm run audit:media-derivatives` output. The default mode has no explicit integration approval block, so the only allowed work was candidate generation, manifest update, visual evidence, and approval packet documentation.

High-risk assets were excluded:

- `assets/images/1.png`: social preview, structured data, test fixture, and high-priority page image.
- favicon/manifest/social assets: browser/SEO approval required.
- `assets/images/hero/hero-flow-mobile.mp4`: video/Safari/mobile behavior risk.
- `assets/images/1.jpg`: Worker/static fixture contract risk.
- numbered JPGs: provenance/purpose review required.

The selected pilot candidate is the largest low-risk CSS background image from the Phase D manifest: `assets/images/botton/video.webp`.

An AVIF trial was briefly evaluated, but the available local encoder path dropped alpha. Because the source WebP has a meaningful alpha plane, that AVIF path was rejected and removed. The kept derivative is a same-format WebP re-encode with alpha preserved.

## 5. Candidate Matrix

| Source path | Current bytes | Dimensions | Runtime references | Fold / role | SEO/social/favicon risk | Browser/Safari risk | Impact | Risk | Effort | Decision | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `assets/images/botton/video.webp` | 51,446 | 480x322 | `css/pages/index.css` video category arrow background | Category arrow CSS background; not LCP/hero/social | Low | Medium because CSS background fallback must be reviewed before integration | 2 | 3 | 2 | Selected for E1 derivative generation | Small, reversible pilot that proves derivative generation and approval workflow without runtime changes. |
| `assets/images/botton/gallery.webp` | 49,664 | 480x322 | `css/pages/index.css` gallery category arrow background | Category arrow CSS background | Low | Medium | 2 | 3 | 2 | Rejected for this phase | Similar to selected candidate; Phase E intentionally limits scope to one pilot. |
| `assets/images/botton/soundlab.webp` | 45,654 | 480x322 | `css/pages/index.css` sound category arrow background | Category arrow CSS background | Low | Medium | 2 | 3 | 2 | Rejected for this phase | Similar to selected candidate; Phase E intentionally limits scope to one pilot. |
| `assets/images/1.png` | 361,041 | 600x391 | EN/DE pages, Generate Lab pages, social metadata, JSON-LD, tests | Above fold / social / structured data | High | Medium | 3 | 5 | 3 | Rejected | Explicitly blocked unless SEO/social visual approval is provided. |
| `assets/images/hero/hero-flow-mobile.mp4` | 2,170,158 | unknown | tests/docs, not direct runtime source refs | Video candidate | Low SEO risk, high mobile playback risk | High | 5 | 4 | 4 | Rejected | Video derivatives remain high-risk without mobile Safari playback review. |
| `assets/images/1.jpg` | 536,335 | 1429x803 | Worker/static fixtures | Test/public-media fixture | Low SEO risk, high fixture risk | Medium | 2 | 5 | 3 | Rejected | Do not change fixture media without route/test contract review. |

## 6. Generated Derivative

| Field | Value |
| --- | --- |
| Source | `assets/images/botton/video.webp` |
| Derivative | `assets/derivatives/phase-e/botton-video-q82.webp` |
| Format | WebP |
| Source bytes | 51,446 |
| Derivative bytes | 26,092 |
| Byte delta | -25,454 |
| Percent byte delta | -49.48% |
| Source dimensions | 480x322 |
| Derivative dimensions | 480x322 |
| Source pixel format | `yuva420p` |
| Derivative pixel format | `yuva420p` |
| SHA-256 | `e45321ce45f451c32f331a7ea76fb606464d7e3ba09e4815ade45508b161728d` |
| Tool | `cwebp 1.6.0` |
| Command | `cwebp -preset picture -q 82 -alpha_q 100 -m 6 -mt assets/images/botton/video.webp -o assets/derivatives/phase-e/botton-video-q82.webp` |
| Encoder output | `Y-U-V-All-PSNR 42.39 46.13 45.83 43.29 dB`; lossless alpha compressed size 11,421 bytes |
| Visual approval status | Pending human review |
| Integration status | Not integrated |

## 7. Integrated Derivative Usage

None.

No runtime references were changed. `css/pages/index.css` still points at the original `assets/images/botton/video.webp`.

## 8. Human Approval Packet

Artifacts for human review:

- visual guardrail summary: `test-results/visual-guardrails/latest/summary.md`
- browser/viewport screenshots: `test-results/visual-guardrails/latest/`
- side-by-side candidate review image: `test-results/phase-e-media-pilot/botton-video-original-vs-q82.png`
- difference review image: `test-results/phase-e-media-pilot/botton-video-diff.png`

Review checklist:

- Compare the original and derivative for the video category arrow background.
- Inspect opacity/transparency edges, glow, texture, color, and any visible compression artifacts.
- Verify that the derivative is acceptable specifically in the category arrow visual context.
- Confirm that no SEO/social/favicon/manifest references are involved.
- Confirm that CSS integration should change only the video arrow background reference.

Exact approval block required for E2 integration:

```text
APPROVED_PHASE_E_DERIVATIVE_INTEGRATION
Approved source asset: assets/images/botton/video.webp
Approved derivative asset: assets/derivatives/phase-e/botton-video-q82.webp
Approved integration location(s): css/pages/index.css .home-categories__arrow[data-category-target="video"] .home-categories__arrow-media background-image
Human visual approval: yes
SEO/social approval required: no
```

Without that exact approval block, the derivative must remain unintegrated.

## 9. Visual Guardrail Results

Baseline visual guardrails before candidate generation:

- `npm run audit:visual-guardrails`
- 25 scenarios captured.
- 0 unfiltered console errors.
- 0 page errors.
- 0 warnings.
- 36 expected local auth/stub notices filtered.

Post-generation visual guardrails:

- `npm run audit:visual-guardrails`
- 25 scenarios captured.
- 0 unfiltered console errors.
- 0 page errors.
- 0 warnings.
- 36 expected local auth/stub notices filtered.

Because no runtime references changed, visual guardrails prove current site behavior remained unchanged after adding the derivative candidate.

## 10. Before / After Measurements

### Static Homepage Graph

| State | Modules | Source bytes |
| --- | --- | --- |
| Before Phase E | 47 | 801,606 |
| After Phase E candidate generation | 47 | 801,606 |
| Delta | 0 | 0 |

### Asset Inventory

| State | Assets scanned | Image files | Image bytes | Video bytes | Font bytes |
| --- | --- | --- | --- | --- | --- |
| Before Phase E candidate generation | 40 | 17 | 2,959,787 | 2,170,158 | 476,132 |
| After Phase E candidate generation | 41 | 18 | 2,985,879 | 2,170,158 | 476,132 |
| Delta | +1 | +1 | +26,092 | 0 | 0 |

The asset inventory increases because the derivative is additive. Runtime referenced bytes are unchanged because no integration occurred.

### Candidate File Sizes

| File | Bytes |
| --- | --- |
| `assets/images/botton/video.webp` | 51,446 |
| `assets/derivatives/phase-e/botton-video-q82.webp` | 26,092 |
| Potential referenced-byte delta if approved and integrated | -25,454 |

### Media Derivative Inventory

`npm run audit:media-derivatives` after generation:

- assets scanned: 41
- generated derivatives: `assets/derivatives/phase-e/botton-video-q82.webp`
- generated derivative dimensions: 480x322
- manifest status for `assets/images/botton/video.webp`: `generated_pending_human_approval`
- safe to auto-integrate: no

## 11. Deferred Assets and Reasons

| Asset | Reason |
| --- | --- |
| `assets/images/1.png` | Social preview, JSON-LD, tests, high-priority image; explicit SEO/social approval required. |
| favicon/manifest assets | Browser icon, manifest, and structured logo behavior; explicit SEO/browser approval required. |
| `assets/images/hero/hero-flow-mobile.mp4` | Video playback, poster/autoplay, and Safari/mobile behavior risk. |
| `assets/images/1.jpg` | Worker/static fixture contract risk. |
| `assets/images/2.jpg` to `assets/images/6.jpg` | Provenance and release-history review required before any derivative or cleanup. |
| `assets/images/botton/gallery.webp` and `assets/images/botton/soundlab.webp` | Same class as selected candidate; deferred to keep Phase E small. |

## 12. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| The derivative could have subtle compression artifacts. | No runtime integration; human review artifacts are provided. |
| CSS background integration could affect a visible homepage arrow card. | Integration requires an exact approval block and post-integration visual guardrails. |
| The source image uses alpha. | AVIF path was rejected; WebP candidate preserves alpha-capable pixel format and alpha plane. |
| Additive derivative increases repository/static asset bytes before integration. | The file is small (26,092 bytes), isolated under `assets/derivatives/phase-e/`, and rollback is trivial. |

## 13. Rollback Plan

To roll back Phase E:

1. Delete `assets/derivatives/phase-e/botton-video-q82.webp`.
2. Revert the `assets/images/botton/video.webp` entry changes in `docs/performance/media-derivatives-manifest.json`.
3. Delete `docs/performance/phase-e-controlled-media-pilot.md`.

No runtime reference restoration is needed because nothing points at the derivative.

## 14. Validation Commands and Results

Pre-generation baseline:

- `npm run check:toolchain`: passed
- `npm run check:js`: passed
- `npm run check:dom-sinks`: passed
- `npm run check:doc-currentness`: passed
- `npm run build:static`: passed
- `npm run audit:performance`: passed
- `npm run audit:performance:markdown`: passed
- `npm run audit:media-derivatives`: passed
- `npm run audit:media-derivatives:markdown`: passed
- `npm run audit:visual-guardrails`: passed

Derivative generation and evidence:

- `cwebp -version`: `1.6.0`
- `ffmpeg -version`: `8.1.1`
- `cwebp -preset picture -q 82 -alpha_q 100 -m 6 -mt assets/images/botton/video.webp -o assets/derivatives/phase-e/botton-video-q82.webp`: passed
- `ffprobe -v error -show_entries stream=width,height,pix_fmt -of json assets/derivatives/phase-e/botton-video-q82.webp`: passed
- `shasum -a 256 assets/derivatives/phase-e/botton-video-q82.webp`: passed
- `npm run audit:media-derivatives`: passed after manifest update
- `npm run audit:media-derivatives:markdown`: passed after manifest update
- `npm run audit:visual-guardrails`: passed after candidate generation

Final post-build validation:

- `npm run check:toolchain`: passed
- `npm run check:js`: passed
- `npm run check:dom-sinks`: passed
- `npm run check:doc-currentness`: passed
- `npm run test:doc-currentness`: passed
- `npm run build:static`: passed
- `npm run audit:performance`: passed; static homepage graph remained 47 modules / 801,606 source bytes
- `npm run audit:performance:markdown`: passed
- `npm run audit:media-derivatives`: passed; generated derivative detected
- `npm run audit:media-derivatives:markdown`: passed
- `npm run audit:visual-guardrails`: passed after final build; 25 scenarios, 0 unfiltered console errors, 0 page errors, 0 warnings
- `npm run test:asset-version`: passed
- `npm run validate:asset-version`: passed
- `npm run test:release-compat`: passed
- `npm run validate:release`: passed
- `npm run check:static-deploy-safety`: passed; classified as `static_only`, no Worker deploys, no schema applies
- `npm run test:static-deploy-safety`: passed
- `npm run test:static`: passed; 355 tests
- `npm run test:workers`: passed; 673 tests
- `npm test`: first run failed one static focus assertion in `tests/auth-admin.spec.js:7542`; targeted rerun passed; second full `npm test` passed with 355 static tests and 673 worker tests
- `git diff --check`: passed

## 15. Phase F Recommendations

1. If the approval packet is accepted, run E2 integration for only `assets/images/botton/video.webp` and re-run visual guardrails before/after.
2. Repeat the same workflow for `gallery.webp` and `soundlab.webp` only after the video arrow pilot is accepted.
3. Keep `assets/images/1.png`, favicons, and manifest/social images behind explicit SEO/social approval.
4. Keep video derivatives for `hero-flow-mobile.mp4` deferred until mobile Safari playback review is part of the approval packet.
5. Consider adding an optional derivative generation script only after the first E2 integration proves the approval workflow is useful.
