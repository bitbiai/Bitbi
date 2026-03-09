/* ============================================================
   BITBI — Reset Password
   Entry point for reset-password.html
   ============================================================ */

import { initParticles }        from '../../shared/particles.js';
import { initBinaryRain }       from '../../shared/binary-rain.js';
import { initBinaryFooter }     from '../../shared/binary-footer.js';
import { initScrollReveal }     from '../../shared/scroll-reveal.js';
import { initCookieConsent }    from '../../shared/cookie-consent.js';
import { apiValidateResetToken, apiResetPassword } from '../../shared/auth-api.js';

/* ── DOM refs ── */
const $loading  = document.getElementById('loadingState');
const $invalid  = document.getElementById('invalidState');
const $formWrap = document.getElementById('formState');
const $success  = document.getElementById('successState');
const $form     = document.getElementById('resetForm');
const $password = document.getElementById('passwordInput');
const $confirm  = document.getElementById('confirmInput');
const $submit   = document.getElementById('submitBtn');
const $msg      = document.getElementById('formMsg');

/* ── Get token from URL ── */
const token = new URLSearchParams(window.location.search).get('token');

/* ── Helpers ── */
function showMsg(text, type) {
    $msg.textContent = text;
    $msg.className = `auth-page__msg auth-page__msg--${type}`;
}

function hideMsg() {
    $msg.className = 'auth-page__msg';
    $msg.textContent = '';
}

function showState(el) {
    $loading.style.display = 'none';
    $invalid.style.display = 'none';
    $formWrap.style.display = 'none';
    $success.style.display = 'none';
    el.style.display = '';
}

/* ── Validate token on load ── */
async function init() {
    // Init shared modules
    try { initParticles('heroCanvas'); }     catch (e) { console.warn(e); }
    try { initBinaryRain('binaryRain'); }    catch (e) { console.warn(e); }
    try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn(e); }
    try { initScrollReveal(); }              catch (e) { console.warn(e); }
    try { initCookieConsent(); }             catch (e) { console.warn(e); }

    if (!token) {
        showState($invalid);
        return;
    }

    const res = await apiValidateResetToken(token);

    if (!res.ok || !res.data?.valid) {
        showState($invalid);
        return;
    }

    showState($formWrap);
}

/* ── Form submit ── */
$form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMsg();

    const password = $password.value;
    const confirm  = $confirm.value;

    if (password.length < 10) {
        showMsg('Password must be at least 10 characters long.', 'error');
        return;
    }

    if (password !== confirm) {
        showMsg('Passwords do not match.', 'error');
        return;
    }

    $submit.disabled = true;
    $submit.textContent = 'Changing...';

    const res = await apiResetPassword(token, password);

    if (res.ok) {
        showState($success);
    } else {
        $submit.disabled = false;
        $submit.textContent = 'Change Password';
        showMsg(res.error, 'error');
    }
});

init();
