# Privacy Text Follow-Up — 2026-03-07

## Changes Made

### Files Modified
- `datenschutz.html` (German privacy policy)
- `privacy.html` (English privacy policy)

### 1. Contact Form — Legal Basis Split (Section 5)
- **Before:** Only Art. 6(1)(b) GDPR (pre-contractual measures) for all inquiries.
- **After:** Split into Art. 6(1)(b) for project-related/pre-contractual inquiries and Art. 6(1)(f) for general contact (legitimate interest in handling inquiries and efficient communication).
- Both DE and EN updated consistently.

### 2. "Necessary" Category — Narrower Formulation (Section 6)
- **Before:** Game scores were described as part of the always-active "Necessary" category without qualification.
- **After:** Consent storage is clearly marked as "strictly necessary for consent management". Game scores are described as a separate, narrowly scoped local storage use on specific interactive pages ("where required for that specific game feature"), not as a site-wide necessity.
- Cookie consent banner UI (`js/shared/cookie-consent.js`) was already narrow (only mentions "consent storage") — no change needed there.

### 3. CoinGecko — Accurate Proxy Description (Sections 10 + 12)
- **Section 10 (Live Markets):** Removed unverifiable entity designation "CoinGecko, Inc., USA". CoinGecko is now referenced neutrally by service name only.
- **Section 12 (International Transfers):** CoinGecko entry removed entirely. Since no personal visitor data is transmitted to CoinGecko (server-side proxy only), listing it as a data transfer recipient was misleading.

### 4. Typo Fix (Section 7 DE)
- Fixed "Einschleuseungsversuche" → "Einschleusungsversuche" in the German RUM passage.

## Technical Verification
- `worker/crypto-worker.js`: Confirmed — Worker sends only `Accept: application/json` header to CoinGecko API. No client headers, IP addresses, or personal data are forwarded.
- `js/pages/index/markets.js`: Confirmed — Browser only calls `https://api.bitbi.ai/crypto`, never CoinGecko directly.
- `king.html`: No localStorage usage found.
- `skyfall.html`: Uses `localStorage.setItem('skyfall_best_v3', ...)` for best times — local only, never transmitted.
- `js/shared/cookie-consent.js`: Banner label for "Necessary" already says only "consent storage" — no UI change needed.

## No Open Owner Decisions
All three changes are factually grounded in the current codebase. No assumptions or unverified claims were introduced.
