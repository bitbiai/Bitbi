/* ============================================================
   BITBI — Forgot Password
   Entry point for forgot-password.html
   ============================================================ */

import { initSiteHeader }    from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initParticles }     from '../../shared/particles.js';
import { initBinaryRain }    from '../../shared/binary-rain.js';
import { initBinaryFooter }  from '../../shared/binary-footer.js';
import { initScrollReveal }  from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';
import { apiForgotPassword } from '../../shared/auth-api.js';
import { localeText } from '../../shared/locale.js?v=__ASSET_VERSION__';

/* ── DOM refs ── */
const $form    = document.getElementById('forgotForm');
const $email   = document.getElementById('emailInput');
const $submit  = document.getElementById('submitBtn');
const $msg     = document.getElementById('formMsg');

/* ── Helpers ── */
function showMsg(text, type) {
    $msg.textContent = text;
    $msg.className = `auth-page__msg auth-page__msg--${type}`;
}

function hideMsg() {
    $msg.className = 'auth-page__msg';
    $msg.textContent = '';
}

/* ── Form submit ── */
$form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMsg();

    const email = $email.value.trim();
    if (!email) return;

    $submit.disabled = true;
    $submit.textContent = localeText('account.sending');

    const res = await apiForgotPassword(email);

    $submit.disabled = false;
    $submit.textContent = localeText('account.sendResetLink');

    // Always show generic success (even on network error, to not leak info)
    showMsg(
        res.data?.message ||
        localeText('account.resetGeneric'),
        'success'
    );

    // Hide form after success
    $form.style.display = 'none';
});

/* ── Init shared modules ── */
try { initSiteHeader(); }               catch (e) { console.warn(e); }
try { initParticles('heroCanvas'); }     catch (e) { console.warn(e); }
try { initBinaryRain('binaryRain'); }    catch (e) { console.warn(e); }
try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn(e); }
try { initScrollReveal(); }              catch (e) { console.warn(e); }
try { initCookieConsent(); }             catch (e) { console.warn(e); }
