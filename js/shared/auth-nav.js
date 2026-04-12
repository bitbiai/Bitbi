/* ============================================================
   BITBI — Auth nav: sign-in/out button in desktop + mobile nav
   Shared module — used by index.html and all subpages
   ============================================================ */

import { getAuthState, authLogout, patchAuthUser } from './auth-state.js';
import { openAuthModal } from './auth-modal.js';

export function initAuthNav() {
    renderDesktop();
    renderMobile();

    document.addEventListener('bitbi:auth-change', () => {
        renderDesktop();
        renderMobile();
    });
}

function getIdentityLabel(user) {
    const displayName = typeof user?.display_name === 'string' ? user.display_name.trim() : '';
    return displayName || user?.email || 'Member';
}

function hasAvatar(user) {
    return !!(user?.has_avatar && user?.avatar_url);
}

function buildAvatarImage(user, className) {
    const img = document.createElement('img');
    img.className = className;
    img.src = user.avatar_url;
    img.alt = `${getIdentityLabel(user)} profile photo`;
    img.decoding = 'async';
    img.loading = 'eager';
    img.addEventListener('error', () => {
        patchAuthUser({ has_avatar: false, avatar_url: null });
    }, { once: true });
    return img;
}

function buildDesktopIdentity(user) {
    const identity = document.createElement('span');
    identity.className = 'auth-nav__identity';

    const avatarLink = document.createElement('a');
    avatarLink.href = '/account/profile.html';
    avatarLink.className = 'auth-nav__avatar-link';
    avatarLink.setAttribute('aria-label', 'Open profile');
    avatarLink.appendChild(buildAvatarImage(user, 'auth-nav__avatar-img'));
    identity.appendChild(avatarLink);

    const label = document.createElement('span');
    label.className = 'auth-nav__identity-label';
    label.textContent = getIdentityLabel(user);
    identity.appendChild(label);

    return identity;
}

function renderMobileHeaderIdentity(user) {
    const bar = document.querySelector('.site-nav__bar');
    const menuBtn = document.getElementById('mobileMenuBtn');
    if (!bar || !menuBtn) return;

    let inline = bar.querySelector('.auth-nav__mobile-inline');
    if (inline) inline.remove();

    if (!hasAvatar(user)) return;

    inline = document.createElement('a');
    inline.href = '/account/profile.html';
    inline.className = 'auth-nav__mobile-inline';
    inline.setAttribute('aria-label', 'Open profile');

    inline.appendChild(buildAvatarImage(user, 'auth-nav__mobile-inline-img'));

    const label = document.createElement('span');
    label.className = 'auth-nav__mobile-inline-label';
    label.textContent = getIdentityLabel(user);
    inline.appendChild(label);

    bar.appendChild(inline);
}

function renderDesktop() {
    const actions = document.querySelector('.site-nav__actions');
    if (!actions) return;

    let wrap = actions.querySelector('.auth-nav__wrap');
    if (wrap) wrap.remove();
    const mood = actions.querySelector('.site-nav__mood');

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
        if (hasAvatar(user)) {
            wrap.classList.add('auth-nav__wrap--avatar');
            wrap.appendChild(buildDesktopIdentity(user));
            if (mood) mood.hidden = true;
        } else {
            const email = document.createElement('span');
            email.className = 'auth-nav__email';
            email.textContent = user?.email || 'Member';
            wrap.appendChild(email);
            if (mood) mood.hidden = false;
        }

        const logout = document.createElement('button');
        logout.type = 'button';
        logout.className = 'auth-nav__logout';
        logout.textContent = 'Sign Out';
        logout.addEventListener('click', () => authLogout());
        wrap.appendChild(logout);

        // Profile link — only when the header stays in the legacy no-avatar state
        if (navLinks && !hasAvatar(user)) {
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
        if (mood) mood.hidden = false;
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
    renderMobileHeaderIdentity(loggedIn ? user : null);

    if (loggedIn) {
        if (hasAvatar(user)) {
            const identityLink = document.createElement('a');
            identityLink.href = '/account/profile.html';
            identityLink.className = 'auth-nav__mobile-identity';
            identityLink.setAttribute('aria-label', 'Open profile');

            identityLink.appendChild(buildAvatarImage(user, 'auth-nav__mobile-identity-img'));

            const label = document.createElement('span');
            label.className = 'auth-nav__mobile-identity-label';
            label.textContent = getIdentityLabel(user);
            identityLink.appendChild(label);

            authContainer.appendChild(identityLink);
        } else {
            const email = document.createElement('span');
            email.className = 'auth-nav__mobile-email';
            email.textContent = user?.email || 'Member';
            authContainer.appendChild(email);
        }

        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'auth-nav__mobile-actions';

        const logout = document.createElement('button');
        logout.type = 'button';
        logout.className = 'auth-nav__mobile-logout';
        logout.textContent = 'Sign Out';
        logout.addEventListener('click', () => authLogout());
        actionsWrap.appendChild(logout);

        if (!hasAvatar(user)) {
            const profileLink = document.createElement('a');
            profileLink.href = '/account/profile.html';
            profileLink.className = 'auth-nav__mobile-profile';
            profileLink.textContent = 'Profile';
            actionsWrap.appendChild(profileLink);
        }

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
