/* ============================================================
   BITBI — Auth modal: login/register UI with focus trap
   Forms are injected only when modal opens (prevents Safari
   password autofill prompt on page load).
   ============================================================ */

import { authLogin, authRegister } from './auth-state.js';
import { apiResendVerification } from './auth-api.js';
import { setupFocusTrap } from './focus-trap.js';
import { requestWalletLogin } from './wallet/wallet-controller.js?v=__ASSET_VERSION__';
import { localeText, localizedHref } from './locale.js?v=__ASSET_VERSION__';

let overlay = null;
let formsContainer = null;
let focusTrapCleanup = null;
let formsInjected = false;

const LOCK_SVG = `<svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="color:rgba(0,240,255,0.5);margin-bottom:8px"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>`;

export function initAuthModal() {
    const container = document.getElementById('authModal');
    if (!container) return;

    /* Build shell only — no form inputs in the DOM yet */
    container.innerHTML = `
    <div class="auth-modal__overlay" role="dialog" aria-modal="true" aria-label="${localeText('auth.signIn')}">
        <div class="auth-modal__content">
            <button type="button" class="auth-modal__close" aria-label="${localeText('auth.closeAuth')}">&times; ${localeText('auth.close')}</button>
            <div class="auth-modal__card">
                <div style="text-align:center;margin-bottom:var(--space-4)">
                    ${LOCK_SVG}
                    <h3 style="font-family:var(--font-display);font-weight:700;font-size:1.25rem;color:rgba(255,255,255,0.9)">${localeText('auth.memberArea')}</h3>
                    <p style="font-size:0.75rem;color:rgba(255,255,255,0.35);margin-top:4px">${localeText('auth.unlock')}</p>
                </div>
                <div class="auth-modal__tabs">
                    <button type="button" class="auth-modal__tab active" data-tab="login">${localeText('auth.signIn')}</button>
                    <button type="button" class="auth-modal__tab" data-tab="register">${localeText('auth.createAccount')}</button>
                </div>
                <div id="authFormsContainer"></div>
            </div>
        </div>
    </div>`;

    overlay = container.querySelector('.auth-modal__overlay');
    formsContainer = document.getElementById('authFormsContainer');

    /* Close button */
    container.querySelector('.auth-modal__close').addEventListener('click', closeAuthModal);

    /* Backdrop click */
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeAuthModal();
    });

    /* Escape */
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) closeAuthModal();
    });

    /* Tab switching (delegated — works even after forms are re-injected) */
    overlay.addEventListener('click', (e) => {
        const tab = e.target.closest('.auth-modal__tab');
        if (!tab) return;
        const target = tab.dataset.tab;
        overlay.querySelectorAll('.auth-modal__tab').forEach(t => t.classList.toggle('active', t.dataset.tab === target));
        const loginForm = document.getElementById('authLoginForm');
        const registerForm = document.getElementById('authRegisterForm');
        if (loginForm) loginForm.classList.toggle('active', target === 'login');
        if (registerForm) registerForm.classList.toggle('active', target === 'register');
    });
}

function injectForms() {
    if (formsInjected) return;
    formsInjected = true;

    formsContainer.innerHTML = `
        <form class="auth-modal__form active" id="authLoginForm" novalidate>
            <div class="auth-modal__msg" id="authLoginMsg" role="alert"></div>
            <input type="email" name="email" placeholder="${localeText('auth.email')}" required class="form-input" autocomplete="email" aria-describedby="authLoginMsg" spellcheck="false" autocapitalize="off">
            <input type="password" name="password" placeholder="${localeText('auth.password')}" required class="form-input" autocomplete="current-password" minlength="8" maxlength="128" aria-describedby="authLoginMsg" spellcheck="false">
            <button type="submit" class="btn-primary btn-primary--block btn-primary--sm">${localeText('auth.signIn')}</button>
            <div class="auth-modal__wallet-actions">
                <span class="auth-modal__wallet-divider" aria-hidden="true">${localeText('auth.or')}</span>
                <button type="button" id="authWalletLoginBtn" class="btn-secondary btn-primary--block btn-primary--sm">${localeText('auth.signInEthereum')}</button>
                <p class="auth-modal__hint auth-modal__hint--wallet">${localeText('auth.walletHint')}</p>
            </div>
            <p style="text-align:center;margin-top:var(--space-3)"><a href="${localizedHref('/account/forgot-password.html')}" style="font-size:0.7rem;font-family:var(--font-mono);color:rgba(0,240,255,0.5);transition:color 0.3s" onmouseover="this.style.color='rgba(0,240,255,0.8)'" onmouseout="this.style.color='rgba(0,240,255,0.5)'">${localeText('auth.forgotPassword')}</a></p>
        </form>
        <form class="auth-modal__form" id="authRegisterForm" novalidate>
            <div class="auth-modal__msg" id="authRegisterMsg" role="alert"></div>
            <input type="email" name="email" placeholder="${localeText('auth.email')}" required class="form-input" autocomplete="email" aria-describedby="authRegisterMsg" spellcheck="false" autocapitalize="off">
            <input type="password" name="password" placeholder="${localeText('auth.passwordNew')}" required class="form-input" autocomplete="new-password" minlength="8" maxlength="128" aria-describedby="authRegisterMsg" spellcheck="false">
            <p class="auth-modal__hint">${localeText('auth.minPassword')}</p>
            <button type="submit" class="btn-primary btn-primary--block btn-primary--sm">${localeText('auth.createAccount')}</button>
        </form>`;

    const loginForm = document.getElementById('authLoginForm');
    const registerForm = document.getElementById('authRegisterForm');
    const loginMsg = document.getElementById('authLoginMsg');
    const registerMsg = document.getElementById('authRegisterMsg');
    const walletLoginBtn = document.getElementById('authWalletLoginBtn');

    /* Login */
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMsg(loginMsg);
        const email = loginForm.email.value.trim();
        const password = loginForm.password.value;
        if (!email || !password) { showMsg(loginMsg, 'error', localeText('auth.fillFields')); return; }
        const btn = loginForm.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.textContent = localeText('auth.signingIn');
        /* Release body scroll lock before authLogin dispatches
           bitbi:auth-change — the overlay still blocks interaction.
           This ensures all auth-change listeners run with the page
           in its normal (unlocked) layout state. */
        document.body.style.overflow = '';
        const res = await authLogin(email, password);
        btn.disabled = false;
        btn.textContent = localeText('auth.signIn');
        if (res.ok) {
            closeAuthModal();
        } else {
            document.body.style.overflow = 'hidden';
            if (res.data?.code === 'EMAIL_NOT_VERIFIED') {
                showMsgWithResend(loginMsg, res.error, email);
            } else {
                showMsg(loginMsg, 'error', res.error);
            }
        }
    });

    walletLoginBtn?.addEventListener('click', async () => {
        clearMsg(loginMsg);
        closeAuthModal();
        try {
            await requestWalletLogin();
        } catch {
            /* wallet controller surfaces its own UI messages */
        }
    });

    /* Register */
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMsg(registerMsg);
        const email = registerForm.email.value.trim();
        const password = registerForm.password.value;
        if (!email || !password) { showMsg(registerMsg, 'error', localeText('auth.fillFields')); return; }
        if (password.length < 8) { showMsg(registerMsg, 'error', localeText('auth.passwordTooShort')); return; }
        const btn = registerForm.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.textContent = localeText('auth.creatingAccount');
        const res = await authRegister(email, password);
        btn.disabled = false;
        btn.textContent = localeText('auth.createAccount');
        if (res.ok) {
            showMsg(registerMsg, 'success', localeText('auth.accountCreated'));
            registerForm.reset();
        } else {
            showMsg(registerMsg, 'error', res.error);
        }
    });
}

function removeForms() {
    if (!formsInjected) return;
    formsContainer.innerHTML = '';
    formsInjected = false;
}

function showMsg(el, type, text) {
    el.textContent = text;
    el.className = `auth-modal__msg auth-modal__msg--${type}`;
}

function showMsgWithResend(el, text, email) {
    el.className = 'auth-modal__msg auth-modal__msg--error';
    el.innerHTML = '';
    el.appendChild(document.createTextNode(text + ' '));
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = localeText('auth.resend');
    link.style.cssText = 'color:rgba(0,240,255,0.8);text-decoration:underline;cursor:pointer';
    link.addEventListener('click', async (e) => {
        e.preventDefault();
        link.textContent = localeText('auth.sending');
        link.style.pointerEvents = 'none';
        await apiResendVerification(email);
        el.className = 'auth-modal__msg auth-modal__msg--success';
        el.textContent = localeText('auth.resent');
    });
    el.appendChild(link);
}

function clearMsg(el) {
    el.textContent = '';
    el.className = 'auth-modal__msg';
}

export function openAuthModal(tab) {
    if (!overlay) return;

    /* Restore overlay to rendering tree (may have been set to display:none
       after previous close to avoid iOS Safari compositing interference) */
    overlay.style.display = '';
    void overlay.offsetHeight; /* reflow so the opacity transition plays */

    /* Inject forms into the DOM only now */
    injectForms();

    if (tab) {
        const tabs = overlay.querySelectorAll('.auth-modal__tab');
        const loginForm = document.getElementById('authLoginForm');
        const registerForm = document.getElementById('authRegisterForm');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        if (loginForm) loginForm.classList.toggle('active', tab === 'login');
        if (registerForm) registerForm.classList.toggle('active', tab === 'register');
    }
    clearMsg(document.getElementById('authLoginMsg'));
    clearMsg(document.getElementById('authRegisterMsg'));
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    focusTrapCleanup = setupFocusTrap(overlay);
}

export function closeAuthModal() {
    if (!overlay) return;
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    if (focusTrapCleanup) { focusTrapCleanup(); focusTrapCleanup = null; }

    /* Remove forms from the DOM so Safari won't re-scan them */
    removeForms();

    /* After the opacity fade-out finishes, pull the overlay out of the
       rendering/compositing tree entirely.  On iOS Safari the fixed,
       full-screen backdrop-filter layer at z-index 9999 can interfere
       with touch-event delivery to elements beneath it even when
       pointer-events:none and opacity:0 are set.  display:none is the
       only reliable way to fully neutralize it. */
    overlay.addEventListener('transitionend', function onFade(e) {
        if (e.propertyName !== 'opacity') return;
        overlay.removeEventListener('transitionend', onFade);
        if (!overlay.classList.contains('active')) {
            overlay.style.display = 'none';
        }
    });
}
