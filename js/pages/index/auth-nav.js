/* ============================================================
   BITBI — Auth nav: sign-in/out button in desktop + mobile nav
   ============================================================ */

import { getAuthState, authLogout } from '../../shared/auth-state.js';
import { openAuthModal } from '../../shared/auth-modal.js';

export function initAuthNav() {
    renderDesktop();
    renderMobile();

    document.addEventListener('bitbi:auth-change', () => {
        renderDesktop();
        renderMobile();
    });
}

function renderDesktop() {
    const actions = document.querySelector('.site-nav__actions');
    if (!actions) return;

    let wrap = actions.querySelector('.auth-nav__wrap');
    if (wrap) wrap.remove();

    wrap = document.createElement('span');
    wrap.className = 'auth-nav__wrap';

    const { loggedIn, user } = getAuthState();

    if (loggedIn) {
        const email = document.createElement('span');
        email.className = 'auth-nav__email';
        email.textContent = user?.email || 'Member';
        wrap.appendChild(email);

        const logout = document.createElement('button');
        logout.className = 'auth-nav__logout';
        logout.textContent = 'Sign Out';
        logout.addEventListener('click', () => authLogout());
        wrap.appendChild(logout);
    } else {
        const btn = document.createElement('button');
        btn.className = 'site-nav__cta pulse-glow';
        btn.textContent = 'Sign In';
        btn.addEventListener('click', () => openAuthModal('login'));
        wrap.appendChild(btn);
    }

    const cta = actions.querySelector('.site-nav__cta');
    if (cta) {
        actions.insertBefore(wrap, cta);
    } else {
        actions.appendChild(wrap);
    }
}

function renderMobile() {
    const mobileNav = document.getElementById('mobileNav');
    if (!mobileNav) return;

    let existing = mobileNav.querySelector('.auth-nav__mobile-link, .auth-nav__mobile-email, .auth-nav__mobile-logout');
    while (existing) {
        existing.remove();
        existing = mobileNav.querySelector('.auth-nav__mobile-link, .auth-nav__mobile-email, .auth-nav__mobile-logout');
    }

    const cta = mobileNav.querySelector('.mobile-nav__cta');
    const { loggedIn, user } = getAuthState();

    if (loggedIn) {
        const email = document.createElement('span');
        email.className = 'auth-nav__mobile-email';
        email.textContent = user?.email || 'Member';

        const logout = document.createElement('button');
        logout.className = 'auth-nav__mobile-logout';
        logout.textContent = 'Sign Out';
        logout.addEventListener('click', () => authLogout());

        if (cta) {
            mobileNav.insertBefore(logout, cta);
            mobileNav.insertBefore(email, logout);
        } else {
            mobileNav.appendChild(email);
            mobileNav.appendChild(logout);
        }
    } else {
        const link = document.createElement('button');
        link.className = 'mobile-nav__cta pulse-glow';
        link.textContent = 'Sign In';
        link.addEventListener('click', () => openAuthModal('login'));

        if (cta) {
            mobileNav.insertBefore(link, cta);
        } else {
            mobileNav.appendChild(link);
        }
    }
}
