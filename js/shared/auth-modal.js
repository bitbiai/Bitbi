/* ============================================================
   BITBI — Auth modal: login/register UI with focus trap
   ============================================================ */

import { authLogin, authRegister } from './auth-state.js';

let overlay = null;
let focusTrapCleanup = null;

const LOCK_SVG = `<svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="color:rgba(0,240,255,0.5);margin-bottom:8px"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>`;

export function initAuthModal() {
    const container = document.getElementById('authModal');
    if (!container) return;

    container.innerHTML = `
    <div class="auth-modal__overlay" role="dialog" aria-modal="true" aria-label="Anmeldung">
        <div class="auth-modal__content">
            <button class="auth-modal__close" aria-label="Close auth modal">&times; Close</button>
            <div class="auth-modal__card">
                <div style="text-align:center;margin-bottom:var(--space-4)">
                    ${LOCK_SVG}
                    <h3 style="font-family:var(--font-display);font-weight:700;font-size:1.25rem;color:rgba(255,255,255,0.9)">Member Area</h3>
                    <p style="font-size:0.75rem;color:rgba(255,255,255,0.35);margin-top:4px">Unlock exclusive content with a free account</p>
                </div>
                <div class="auth-modal__tabs">
                    <button class="auth-modal__tab active" data-tab="login">Sign In</button>
                    <button class="auth-modal__tab" data-tab="register">Create Account</button>
                </div>
                <form class="auth-modal__form active" id="authLoginForm" novalidate>
                    <div class="auth-modal__msg" id="authLoginMsg"></div>
                    <input type="email" name="email" placeholder="Email" required class="form-input" autocomplete="email">
                    <input type="password" name="password" placeholder="Password" required class="form-input" autocomplete="current-password" minlength="10">
                    <button type="submit" class="btn-primary btn-primary--block btn-primary--sm">Sign In</button>
                </form>
                <form class="auth-modal__form" id="authRegisterForm" novalidate>
                    <div class="auth-modal__msg" id="authRegisterMsg"></div>
                    <input type="email" name="email" placeholder="Email" required class="form-input" autocomplete="email">
                    <input type="password" name="password" placeholder="Password (min. 10 characters)" required class="form-input" autocomplete="new-password" minlength="10">
                    <p class="auth-modal__hint">Minimum 10 characters</p>
                    <button type="submit" class="btn-primary btn-primary--block btn-primary--sm">Create Account</button>
                </form>
            </div>
        </div>
    </div>`;

    overlay = container.querySelector('.auth-modal__overlay');
    const tabs = container.querySelectorAll('.auth-modal__tab');
    const loginForm = document.getElementById('authLoginForm');
    const registerForm = document.getElementById('authRegisterForm');
    const loginMsg = document.getElementById('authLoginMsg');
    const registerMsg = document.getElementById('authRegisterMsg');

    /* Tab switching */
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === target));
            loginForm.classList.toggle('active', target === 'login');
            registerForm.classList.toggle('active', target === 'register');
        });
    });

    /* Login */
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMsg(loginMsg);
        const email = loginForm.email.value.trim();
        const password = loginForm.password.value;
        if (!email || !password) { showMsg(loginMsg, 'error', 'Bitte fülle alle Felder aus.'); return; }
        const btn = loginForm.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.textContent = 'Signing in...';
        const res = await authLogin(email, password);
        btn.disabled = false;
        btn.textContent = 'Sign In';
        if (res.ok) {
            closeAuthModal();
        } else {
            showMsg(loginMsg, 'error', res.error);
        }
    });

    /* Register */
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMsg(registerMsg);
        const email = registerForm.email.value.trim();
        const password = registerForm.password.value;
        if (!email || !password) { showMsg(registerMsg, 'error', 'Bitte fülle alle Felder aus.'); return; }
        if (password.length < 10) { showMsg(registerMsg, 'error', 'Passwort muss mindestens 10 Zeichen lang sein.'); return; }
        const btn = registerForm.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.textContent = 'Creating account...';
        const res = await authRegister(email, password);
        btn.disabled = false;
        btn.textContent = 'Create Account';
        if (res.ok) {
            showMsg(registerMsg, 'success', 'Account erstellt! Du kannst dich jetzt anmelden.');
            registerForm.reset();
            setTimeout(() => {
                tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'login'));
                loginForm.classList.add('active');
                registerForm.classList.remove('active');
                clearMsg(registerMsg);
            }, 2000);
        } else {
            showMsg(registerMsg, 'error', res.error);
        }
    });

    /* Close button */
    const closeBtn = container.querySelector('.auth-modal__close');
    closeBtn.addEventListener('click', closeAuthModal);

    /* Backdrop click */
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeAuthModal();
    });

    /* Escape */
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) closeAuthModal();
    });
}

function showMsg(el, type, text) {
    el.textContent = text;
    el.className = `auth-modal__msg auth-modal__msg--${type}`;
}

function clearMsg(el) {
    el.textContent = '';
    el.className = 'auth-modal__msg';
}

export function openAuthModal(tab) {
    if (!overlay) return;
    if (tab) {
        const tabs = overlay.querySelectorAll('.auth-modal__tab');
        const loginForm = document.getElementById('authLoginForm');
        const registerForm = document.getElementById('authRegisterForm');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        loginForm.classList.toggle('active', tab === 'login');
        registerForm.classList.toggle('active', tab === 'register');
    }
    clearMsg(document.getElementById('authLoginMsg'));
    clearMsg(document.getElementById('authRegisterMsg'));
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    setupFocusTrap(overlay);
}

export function closeAuthModal() {
    if (!overlay) return;
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    if (focusTrapCleanup) { focusTrapCleanup(); focusTrapCleanup = null; }
}

function setupFocusTrap(container) {
    const focusable = container.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    function handler(e) {
        if (e.key !== 'Tab') return;
        if (e.shiftKey) {
            if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
        } else {
            if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
    }

    container.addEventListener('keydown', handler);
    focusTrapCleanup = () => container.removeEventListener('keydown', handler);
}
