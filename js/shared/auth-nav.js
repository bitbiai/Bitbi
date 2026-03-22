/* ============================================================
   BITBI — Auth nav: sign-in/out button in desktop + mobile nav
   Shared module — used by index.html and all subpages
   ============================================================ */

import { getAuthState, authLogout } from './auth-state.js';
import { openAuthModal } from './auth-modal.js';

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

    // Remove any previous injected links
    const navLinks = document.querySelector('.site-nav__links');
    const oldAdminLink = navLinks?.querySelector('.auth-nav__admin-link');
    if (oldAdminLink) oldAdminLink.remove();
    const oldProfileLink = navLinks?.querySelector('.auth-nav__profile-link');
    if (oldProfileLink) oldProfileLink.remove();

    wrap = document.createElement('span');
    wrap.className = 'auth-nav__wrap';

    const { loggedIn, user } = getAuthState();

    if (loggedIn) {
        const email = document.createElement('span');
        email.className = 'auth-nav__email';
        email.textContent = user?.email || 'Member';
        wrap.appendChild(email);

        const logout = document.createElement('button');
        logout.type = 'button';
        logout.className = 'auth-nav__logout';
        logout.textContent = 'Sign Out';
        logout.addEventListener('click', () => authLogout());
        wrap.appendChild(logout);

        // Profile link — all logged-in users
        if (navLinks) {
            const profileLink = document.createElement('a');
            profileLink.href = '/account/profile.html';
            profileLink.className = 'site-nav__link nav-link auth-nav__profile-link';
            profileLink.textContent = 'Profile';
            navLinks.appendChild(profileLink);
        }

        // Admin link — only for admin role
        if (user?.role === 'admin' && navLinks) {
            const adminLink = document.createElement('a');
            adminLink.href = '/admin/';
            adminLink.className = 'site-nav__link nav-link auth-nav__admin-link';
            adminLink.textContent = 'Admin';
            navLinks.appendChild(adminLink);
        }
    } else {
        const btn = document.createElement('button');
        btn.type = 'button';
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
    const authContainer = document.getElementById('mobileNavAuth');
    if (!authContainer) return;

    authContainer.innerHTML = '';

    const { loggedIn, user } = getAuthState();

    if (loggedIn) {
        const email = document.createElement('span');
        email.className = 'auth-nav__mobile-email';
        email.textContent = user?.email || 'Member';
        authContainer.appendChild(email);

        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'auth-nav__mobile-actions';

        const logout = document.createElement('button');
        logout.type = 'button';
        logout.className = 'auth-nav__mobile-logout';
        logout.textContent = 'Sign Out';
        logout.addEventListener('click', () => authLogout());
        actionsWrap.appendChild(logout);

        const profileLink = document.createElement('a');
        profileLink.href = '/account/profile.html';
        profileLink.className = 'auth-nav__mobile-profile';
        profileLink.textContent = 'Profile';
        actionsWrap.appendChild(profileLink);

        if (user?.role === 'admin') {
            const adminLink = document.createElement('a');
            adminLink.href = '/admin/';
            adminLink.className = 'auth-nav__mobile-admin';
            adminLink.textContent = 'Admin';
            actionsWrap.appendChild(adminLink);
        }

        authContainer.appendChild(actionsWrap);
    } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mobile-nav__cta pulse-glow';
        btn.textContent = 'Sign In';
        btn.addEventListener('click', () => openAuthModal('login'));
        authContainer.appendChild(btn);
    }
}
