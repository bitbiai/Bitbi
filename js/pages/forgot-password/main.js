/* ============================================================
   BITBI — Forgot Password
   Entry point for forgot-password.html
   ============================================================ */

import { initParticles }     from '../../shared/particles.js';
import { initBinaryRain }    from '../../shared/binary-rain.js';
import { initBinaryFooter }  from '../../shared/binary-footer.js';
import { initScrollReveal }  from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';
import { apiForgotPassword } from '../../shared/auth-api.js';

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
    $submit.textContent = 'Sending...';

    const res = await apiForgotPassword(email);

    $submit.disabled = false;
    $submit.textContent = 'Send Reset Link';

    // Always show generic success (even on network error, to not leak info)
    showMsg(
        res.data?.message ||
        'If an account with this email exists, a reset link has been sent.',
        'success'
    );

    // Hide form after success
    $form.style.display = 'none';
});

/* ── Init shared modules ── */
try { initParticles('heroCanvas'); }     catch (e) { console.warn(e); }
try { initBinaryRain('binaryRain'); }    catch (e) { console.warn(e); }
try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn(e); }
try { initScrollReveal(); }              catch (e) { console.warn(e); }
try { initCookieConsent(); }             catch (e) { console.warn(e); }
