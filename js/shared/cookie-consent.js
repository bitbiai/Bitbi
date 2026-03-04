/* ============================================================
   BITBI — Cookie Consent Banner (EU only, GDPR-compliant)
   Shared across all pages. Supports an onConsent callback
   for page-specific behavior (e.g., YouTube iframe control).
   ============================================================ */

const CONSENT_KEY = 'bitbi_cookie_consent';
const CONSENT_VERSION = '1';

function getConsent() {
    try {
        const c = JSON.parse(localStorage.getItem(CONSENT_KEY));
        if (c && c.v === CONSENT_VERSION) return c;
    } catch (e) { /* ignore */ }
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
    localStorage.setItem(CONSENT_KEY, JSON.stringify(data));
    if (onConsent) onConsent(data);
    document.dispatchEvent(new CustomEvent('cookieConsent', { detail: data }));
}

function createBanner(onConsent) {
    const overlay = document.createElement('div');
    overlay.id = 'cookieBanner';
    overlay.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;padding:16px;pointer-events:none;';
    overlay.innerHTML = `
    <div style="max-width:680px;margin:0 auto;background:rgba(13,27,42,0.97);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(0,240,255,0.12);border-radius:16px;padding:20px 24px;pointer-events:auto;box-shadow:0 -4px 40px rgba(0,0,0,0.5)">
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px">
            <svg style="width:20px;height:20px;flex-shrink:0;margin-top:2px;color:rgba(0,240,255,0.7)" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
            <div>
                <h3 style="font-family:'Playfair Display',serif;font-weight:700;font-size:15px;color:rgba(255,255,255,0.9);margin:0 0 6px 0">Cookie Preferences</h3>
                <p style="font-size:12px;color:rgba(255,255,255,0.45);line-height:1.5;margin:0">We use cookies to enhance your experience. Necessary cookies are always active. You can choose to enable analytics and marketing cookies. <a href="privacy.html" style="color:rgba(0,240,255,0.6);text-decoration:underline">Privacy Policy</a></p>
            </div>
        </div>
        <div id="cookieDetails" style="display:none;margin-bottom:14px;padding:12px 16px;background:rgba(0,0,0,0.2);border-radius:10px;font-size:12px">
            <label style="display:flex;align-items:center;gap:8px;color:rgba(255,255,255,0.5);margin-bottom:8px;cursor:default">
                <input type="checkbox" checked disabled style="accent-color:#00F0FF;width:14px;height:14px">
                <span><strong style="color:rgba(255,255,255,0.7)">Necessary</strong> — Required for the website to function (consent storage)</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;color:rgba(255,255,255,0.5);margin-bottom:8px;cursor:pointer">
                <input type="checkbox" id="ckAnalytics" style="accent-color:#00F0FF;width:14px;height:14px">
                <span><strong style="color:rgba(255,255,255,0.7)">Analytics</strong> — Performance measurement (Cloudflare RUM)</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;color:rgba(255,255,255,0.5);cursor:pointer">
                <input type="checkbox" id="ckMarketing" style="accent-color:#00F0FF;width:14px;height:14px">
                <span><strong style="color:rgba(255,255,255,0.7)">Marketing</strong> — Embedded content (YouTube)</span>
            </label>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
            <button id="ckAcceptAll" style="flex:1;min-width:120px;padding:9px 16px;border-radius:10px;border:none;background:rgba(0,240,255,0.12);color:#00F0FF;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;cursor:pointer;transition:background 0.2s">Accept All</button>
            <button id="ckSavePrefs" style="display:none;flex:1;min-width:120px;padding:9px 16px;border-radius:10px;border:none;background:rgba(0,240,255,0.12);color:#00F0FF;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;cursor:pointer;transition:background 0.2s">Save Preferences</button>
            <button id="ckCustomize" style="flex:1;min-width:120px;padding:9px 16px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:transparent;color:rgba(255,255,255,0.5);font-family:'JetBrains Mono',monospace;font-size:11px;cursor:pointer;transition:all 0.2s">Customize</button>
            <button id="ckRejectAll" style="flex:1;min-width:120px;padding:9px 16px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:transparent;color:rgba(255,255,255,0.5);font-family:'JetBrains Mono',monospace;font-size:11px;cursor:pointer;transition:all 0.2s">Reject All</button>
        </div>
    </div>`;
    document.body.appendChild(overlay);

    const details = overlay.querySelector('#cookieDetails');
    const saveBtn = overlay.querySelector('#ckSavePrefs');
    const customBtn = overlay.querySelector('#ckCustomize');

    overlay.querySelector('#ckAcceptAll').addEventListener('click', () => {
        saveConsent({ analytics: true, marketing: true }, onConsent);
        removeBanner();
    });
    overlay.querySelector('#ckRejectAll').addEventListener('click', () => {
        saveConsent({ analytics: false, marketing: false }, onConsent);
        removeBanner();
    });
    customBtn.addEventListener('click', () => {
        const open = details.style.display !== 'none';
        details.style.display = open ? 'none' : 'block';
        saveBtn.style.display = open ? 'none' : 'inline-block';
        customBtn.textContent = open ? 'Customize' : 'Hide Details';
    });
    saveBtn.addEventListener('click', () => {
        saveConsent({
            analytics: document.getElementById('ckAnalytics').checked,
            marketing: document.getElementById('ckMarketing').checked
        }, onConsent);
        removeBanner();
    });
}

function removeBanner() {
    const b = document.getElementById('cookieBanner');
    if (b) b.remove();
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
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        const euZones = ['Europe/', 'Atlantic/Canary', 'Atlantic/Faroe', 'Atlantic/Madeira', 'Atlantic/Reykjavik'];
        return euZones.some((z) => tz.startsWith(z));
    } catch (e) { return true; }
}

export function initCookieConsent(options = {}) {
    const onConsent = options.onConsent || null;

    /* Footer "Cookie Settings" link */
    const settingsLink = document.getElementById('openCookieSettings');
    if (settingsLink) {
        settingsLink.addEventListener('click', (e) => {
            e.preventDefault();
            showBanner(onConsent);
        });
    }

    /* Optional "Enable Marketing Cookies" button (index.html YouTube placeholder) */
    if (options.ytEnableBtnId) {
        const ytBtn = document.getElementById(options.ytEnableBtnId);
        if (ytBtn) ytBtn.addEventListener('click', () => showBanner(onConsent));
    }

    /* Show banner only if EU and no consent stored */
    if (isLikelyEU() && !getConsent()) {
        showBanner(onConsent);
    }

    /* Always apply stored consent on load, or block if no consent */
    const stored = getConsent();
    if (stored) {
        if (onConsent) onConsent(stored);
        document.dispatchEvent(new CustomEvent('cookieConsent', { detail: stored }));
    } else if (onConsent) {
        onConsent({ necessary: true, analytics: false, marketing: false });
    }
}
