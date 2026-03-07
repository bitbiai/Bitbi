/* ============================================================
   BITBI — Cookie Consent Banner (EU only, GDPR-compliant)
   Shared across all pages. Uses CSS classes from components.css.
   Supports onConsent callback for page-specific behavior.
   ============================================================ */

const CONSENT_KEY = 'bitbi_cookie_consent';
const CONSENT_VERSION = '1';

let rumObserver = null;

function enforceRumConsent(analyticsAllowed) {
    if (!analyticsAllowed) {
        /* Remove any existing RUM scripts */
        document.querySelectorAll('script[src*="beacon.min.js"], script[src*="cloudflareinsights"]').forEach(s => s.remove());

        /* Watch for future injection attempts */
        if (!rumObserver) {
            rumObserver = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    for (const node of m.addedNodes) {
                        if (node.tagName === 'SCRIPT' && node.src &&
                            (node.src.includes('beacon.min.js') || node.src.includes('cloudflareinsights'))) {
                            node.remove();
                        }
                    }
                }
            });
            rumObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
    } else {
        /* Analytics consented — stop blocking */
        if (rumObserver) {
            rumObserver.disconnect();
            rumObserver = null;
        }
    }
}

function getConsent() {
    try {
        const c = JSON.parse(localStorage.getItem(CONSENT_KEY));
        if (c?.v === CONSENT_VERSION) return c;
    } catch { /* ignore */ }
    return null;
}

function saveConsent(prefs, onConsent) {
    const data = {
        v: CONSENT_VERSION,
        ts: Date.now(),
        necessary: true,
        analytics: !!prefs.analytics,
        marketing: !!prefs.marketing
    };
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
    onConsent?.(data);
    enforceRumConsent(data.analytics);
    document.dispatchEvent(new CustomEvent('cookieConsent', { detail: data }));
}

function createBanner(onConsent) {
    const overlay = document.createElement('div');
    overlay.id = 'cookieBanner';
    overlay.className = 'cookie-banner';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Cookie preferences');
    overlay.innerHTML = `
    <div class="cookie-banner__card">
        <div class="cookie-banner__header">
            <svg class="cookie-banner__icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
            <div>
                <h3 class="cookie-banner__title">Cookie Preferences</h3>
                <p class="cookie-banner__desc">We use cookies to enhance your experience. Necessary cookies are always active. You can choose to enable analytics and marketing cookies. <a href="privacy.html">Privacy Policy</a></p>
            </div>
        </div>
        <div id="cookieDetails" class="cookie-banner__details">
            <label class="cookie-banner__label cookie-banner__label--disabled">
                <input type="checkbox" checked disabled>
                <span><strong>Necessary</strong> \u2014 Required for the website to function (consent storage)</span>
            </label>
            <label class="cookie-banner__label">
                <input type="checkbox" id="ckAnalytics">
                <span><strong>Analytics</strong> \u2014 Performance measurement (Cloudflare RUM)</span>
            </label>
            <label class="cookie-banner__label">
                <input type="checkbox" id="ckMarketing">
                <span><strong>Marketing</strong> \u2014 Embedded content (YouTube)</span>
            </label>
        </div>
        <div class="cookie-banner__actions">
            <button id="ckAcceptAll" class="cookie-banner__btn cookie-banner__btn--accept">Accept All</button>
            <button id="ckSavePrefs" class="cookie-banner__btn cookie-banner__btn--accept" style="display:none">Save Preferences</button>
            <button id="ckCustomize" class="cookie-banner__btn cookie-banner__btn--secondary">Customize</button>
            <button id="ckRejectAll" class="cookie-banner__btn cookie-banner__btn--secondary">Reject All</button>
        </div>
    </div>`;
    document.body.appendChild(overlay);

    const details = overlay.querySelector('#cookieDetails');
    const saveBtn = overlay.querySelector('#ckSavePrefs');
    const customBtn = overlay.querySelector('#ckCustomize');
    const acceptBtn = overlay.querySelector('#ckAcceptAll');

    /* Focus management — focus first interactive element */
    acceptBtn?.focus();

    acceptBtn?.addEventListener('click', () => {
        saveConsent({ analytics: true, marketing: true }, onConsent);
        removeBanner();
    });
    overlay.querySelector('#ckRejectAll')?.addEventListener('click', () => {
        saveConsent({ analytics: false, marketing: false }, onConsent);
        removeBanner();
    });
    customBtn?.addEventListener('click', () => {
        const isOpen = details.classList.contains('cookie-banner__details--open');
        details.classList.toggle('cookie-banner__details--open', !isOpen);
        saveBtn.style.display = isOpen ? 'none' : 'inline-block';
        customBtn.textContent = isOpen ? 'Customize' : 'Hide Details';
    });
    saveBtn?.addEventListener('click', () => {
        saveConsent({
            analytics: document.getElementById('ckAnalytics')?.checked ?? false,
            marketing: document.getElementById('ckMarketing')?.checked ?? false
        }, onConsent);
        removeBanner();
    });
}

function removeBanner() {
    document.getElementById('cookieBanner')?.remove();
}

function showBanner(onConsent) {
    removeBanner();
    createBanner(onConsent);
    const c = getConsent();
    if (c) {
        const a = document.getElementById('ckAnalytics');
        const m = document.getElementById('ckMarketing');
        if (a) a.checked = c.analytics;
        if (m) m.checked = c.marketing;
    }
}

function isLikelyEU() {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
        const euZones = ['Europe/', 'Atlantic/Canary', 'Atlantic/Faroe', 'Atlantic/Madeira', 'Atlantic/Reykjavik'];
        return euZones.some((z) => tz.startsWith(z));
    } catch { return true; }
}

export function initCookieConsent(options = {}) {
    const onConsent = options.onConsent ?? null;

    /* Footer "Cookie Settings" link */
    document.getElementById('openCookieSettings')?.addEventListener('click', (e) => {
        e.preventDefault();
        showBanner(onConsent);
    });

    /* Optional "Enable Marketing Cookies" button */
    if (options.ytEnableBtnId) {
        document.getElementById(options.ytEnableBtnId)?.addEventListener('click', () => showBanner(onConsent));
    }

    /* Show banner only if EU and no consent stored */
    if (isLikelyEU() && !getConsent()) {
        showBanner(onConsent);
    }

    /* Always apply stored consent on load, or block if no consent */
    const stored = getConsent();
    if (stored) {
        onConsent?.(stored);
        enforceRumConsent(stored.analytics);
        document.dispatchEvent(new CustomEvent('cookieConsent', { detail: stored }));
    } else {
        onConsent?.({ necessary: true, analytics: false, marketing: false });
        enforceRumConsent(false);
    }
}
