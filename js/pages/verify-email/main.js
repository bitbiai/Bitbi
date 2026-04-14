/* ============================================================
   BITBI — Verify Email
   Entry point for verify-email.html
   ============================================================ */

import { initSiteHeader }    from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initParticles }     from '../../shared/particles.js';
import { initBinaryRain }    from '../../shared/binary-rain.js';
import { initBinaryFooter }  from '../../shared/binary-footer.js';
import { initScrollReveal }  from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';
import { apiVerifyEmail }    from '../../shared/auth-api.js';

/* ── DOM refs ── */
const $loading = document.getElementById('loadingState');
const $invalid = document.getElementById('invalidState');
const $success = document.getElementById('successState');

/* ── Get token from URL ── */
const token = new URLSearchParams(window.location.search).get('token');

/* ── Helpers ── */
function showState(el) {
    $loading.style.display = 'none';
    $invalid.style.display = 'none';
    $success.style.display = 'none';
    el.style.display = '';
}

/* ── Verify on load ── */
async function init() {
    try { initSiteHeader(); }               catch (e) { console.warn(e); }
    try { initParticles('heroCanvas'); }     catch (e) { console.warn(e); }
    try { initBinaryRain('binaryRain'); }    catch (e) { console.warn(e); }
    try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn(e); }
    try { initScrollReveal(); }              catch (e) { console.warn(e); }
    try { initCookieConsent(); }             catch (e) { console.warn(e); }

    if (!token) {
        showState($invalid);
        return;
    }

    const res = await apiVerifyEmail(token);

    if (res.ok) {
        showState($success);
    } else {
        showState($invalid);
    }
}

init();
