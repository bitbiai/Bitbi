# Privacy Compliance Audit — BITBI

**Audit date:** 7 March 2026
**Scope:** All pages of bitbi.ai (index, experiments/skyfall, experiments/king, experiments/cosmic, legal/privacy, legal/datenschutz, legal/imprint)

This document is historical audit context, not the canonical release contract.
Current repo-validated release/deploy truth lives in `config/release-compat.json`.

---

## Issues Found and Fixes Applied

### 1. No cookie consent on game pages (HIGH)
**Files:** `experiments/skyfall.html`, `experiments/king.html`, `experiments/cosmic.html`
**Fix:** Added `css/cookie-banner.css` stylesheet, Cookie Settings footer link, and `initCookieConsent()` module script to all three pages.

### 2. No defensive Cloudflare RUM blocking (HIGH)
**File:** `js/shared/cookie-consent.js`
**Fix:** Added `enforceRumConsent()` function that removes existing RUM scripts and uses a MutationObserver to block future injection when analytics consent is not given.

### 3. YouTube DNS-prefetch fires before consent (MEDIUM)
**File:** `index.html`
**Fix:** Removed `<link rel="dns-prefetch" href="https://www.youtube-nocookie.com">`.

### 4. Contact form lacks privacy notice and spam protection (MEDIUM)
**Files:** `index.html`, `workers/contact/src/index.js`
**Fix:** Added honeypot hidden field, privacy notice text above submit button, `website` field in fetch body. Worker silently discards submissions with filled honeypot. Added basic email format validation.

### 5. CoinGecko API called directly from browser (MEDIUM)
**Files:** `js/pages/index/markets.js`, historical external proxy worker at `api.bitbi.ai/crypto`
**Fix:** Updated markets.js to call `https://api.bitbi.ai/crypto` instead of `/api/crypto`. The proxy worker itself is not tracked in the current repo snapshot and is therefore not part of the repo-validated release contract.

### 6. No security meta headers (LOW)
**Files:** All 7 HTML pages
**Fix:** Added `<meta name="referrer" content="strict-origin-when-cross-origin">` to all pages.

### 7. Privacy policy inaccuracies — Necessary cookies description (MEDIUM)
**Files:** `legal/privacy.html`, `legal/datenschutz.html`
**Fix:** Updated Necessary category to accurately describe consent storage and game localStorage usage.

### 8. Privacy policy missing Live Markets section (MEDIUM)
**Files:** `legal/privacy.html`, `legal/datenschutz.html`
**Fix:** Added new Section 10 (Live Markets Data) explaining proxy-based CoinGecko data fetching. Added CoinGecko to international transfers. Renumbered sections 10-15 to 11-16.

### 9. Privacy policy missing contact form honeypot/notice details (LOW)
**Files:** `legal/privacy.html`, `legal/datenschutz.html`
**Fix:** Updated Section 5 (Contact Form) with honeypot and privacy notice description.

### 10. Privacy policy missing RUM defensive blocking note (LOW)
**Files:** `legal/privacy.html`, `legal/datenschutz.html`
**Fix:** Updated Section 7 (Analytics) noting client-side script removal mechanism.

---

## New Artifacts Created

| Artifact | Purpose |
|------|---------|
| `css/cookie-banner.css` | Standalone cookie banner styles for game/VR pages |
| Historical external worker at `api.bitbi.ai/crypto` | CoinGecko proxy worker noted in the original audit; not tracked in the current repo snapshot |
| `docs/privacy-compliance-audit.md` | This file |

---

## Manual Follow-Up Items

These dashboard-only privacy items remain manual and are intentionally not enforced by
`npm run validate:release`. Release-blocking manual prerequisites now live in
`config/release-compat.json`.

1. **Configure HTTP security headers** via Cloudflare Transform Rules:
   - `Content-Security-Policy` — restrict script sources
   - `X-Content-Type-Options: nosniff`
   - `Permissions-Policy` — restrict camera, microphone, etc.
   - These cannot be set via `<meta>` tags for static sites

2. **Verify Cloudflare RUM dashboard setting**
   - Check if RUM is currently enabled in Cloudflare dashboard
   - The client-side defensive blocking is now in place regardless

---

## Verification Checklist

- [ ] Open experiments/skyfall.html — cookie banner appears for EU timezone, Cookie Settings link works
- [ ] Open experiments/king.html — same verification
- [ ] Open experiments/cosmic.html — same verification
- [ ] Open index.html with DevTools Network tab, no consent given:
  - [ ] No requests to youtube-nocookie.com
  - [ ] No requests to cloudflareinsights/beacon
- [ ] Click "Reject All" — consent stored, no analytics on reload
- [ ] Click "Accept All" — YouTube iframe loads
- [ ] Contact form: honeypot hidden, privacy notice visible, submission works
- [ ] Fill honeypot via DevTools, submit — worker returns 200 but no email
- [ ] Both privacy pages: all section numbers sequential (1-16), dates show 7 March 2026
- [ ] `<meta name="referrer">` present in all HTML pages
- [ ] `npm run dev` — visual check that nothing is broken
