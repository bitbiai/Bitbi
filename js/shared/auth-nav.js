/* ============================================================
   BITBI — Auth nav: sign-in/out button in desktop + mobile nav
   Shared module — used by index.html and all subpages
   ============================================================ */

import { getAuthState, authLogout, patchAuthUser } from './auth-state.js';
import { openAuthModal } from './auth-modal.js';
import { withGenerateLabReturnContext } from './generate-lab-context.js?v=__ASSET_VERSION__';
import { localeText, localizedHref } from './locale.js?v=__ASSET_VERSION__';

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
    return displayName || user?.email || localeText('auth.member');
}

function hasAvatar(user) {
    return !!(user?.has_avatar && user?.avatar_url);
}

function buildAvatarImage(user, className) {
    const img = document.createElement('img');
    img.className = className;
    img.src = user.avatar_url;
    img.alt = localeText('auth.profilePhoto', { name: getIdentityLabel(user) });
    img.decoding = 'async';
    img.loading = 'eager';
    img.addEventListener('error', () => {
        patchAuthUser({ has_avatar: false, avatar_url: null });
    }, { once: true });
    return img;
}

function buildDesktopIdentity(user) {
    const identity = document.createElement('a');
    identity.href = withGenerateLabReturnContext(localizedHref('/account/profile.html'));
    identity.className = 'auth-nav__identity';
    identity.setAttribute('aria-label', localeText('auth.openProfileFor', { name: getIdentityLabel(user) }));

    const avatarFrame = document.createElement('span');
    avatarFrame.className = 'auth-nav__avatar-link';
    avatarFrame.appendChild(buildAvatarImage(user, 'auth-nav__avatar-img'));
    identity.appendChild(avatarFrame);

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
    inline.href = withGenerateLabReturnContext(localizedHref('/account/profile.html'));
    inline.className = 'auth-nav__mobile-inline';
    inline.setAttribute('aria-label', localeText('auth.openProfile'));

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
    const oldPricingLink = navLinks?.querySelector('.auth-nav__pricing-link');
    if (oldPricingLink) oldPricingLink.remove();
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
            const email = document.createElement('a');
            email.href = withGenerateLabReturnContext(localizedHref('/account/profile.html'));
            email.className = 'auth-nav__email auth-nav__email-link';
            email.textContent = user?.email || localeText('auth.member');
            wrap.appendChild(email);
            if (mood) mood.hidden = false;
        }

        const logout = document.createElement('button');
        logout.type = 'button';
        logout.className = 'auth-nav__logout';
        logout.textContent = localeText('auth.signOut');
        logout.addEventListener('click', () => authLogout());
        wrap.appendChild(logout);

        // Profile link — only when the header stays in the legacy no-avatar state
        if (navLinks && !hasAvatar(user)) {
            const profileLink = document.createElement('a');
            profileLink.href = withGenerateLabReturnContext(localizedHref('/account/profile.html'));
            profileLink.className = 'site-nav__link nav-link auth-nav__profile-link';
            profileLink.textContent = localeText('auth.profile');
            navLinks.appendChild(profileLink);
        }

        // Controlled rollout links — only for admin role
        if (user?.role === 'admin' && navLinks) {
            const pricingLink = document.createElement('a');
            pricingLink.href = localizedHref('/pricing.html');
            pricingLink.className = 'site-nav__link nav-link auth-nav__pricing-link';
            pricingLink.textContent = localeText('auth.pricing');
            navLinks.insertBefore(pricingLink, navLinks.firstElementChild || null);

            const adminLink = document.createElement('a');
            adminLink.href = localizedHref('/admin/');
            adminLink.className = 'site-nav__link nav-link auth-nav__admin-link';
            adminLink.textContent = localeText('auth.admin');
            navLinks.appendChild(adminLink);
        }
    } else {
        if (mood) mood.hidden = false;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'site-nav__cta pulse-glow';
        btn.textContent = localeText('auth.signIn');
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
        const logout = document.createElement('button');
        logout.type = 'button';
        logout.className = 'auth-nav__mobile-logout';
        logout.textContent = localeText('auth.signOut');
        logout.addEventListener('click', () => authLogout());

        const adminLink = user?.role === 'admin'
            ? (() => {
                const link = document.createElement('a');
                link.href = localizedHref('/admin/');
                link.className = 'auth-nav__mobile-admin';
                link.textContent = localeText('auth.admin');
                return link;
            })()
            : null;
        const pricingLink = user?.role === 'admin'
            ? (() => {
                const link = document.createElement('a');
                link.href = localizedHref('/pricing.html');
                link.className = 'auth-nav__mobile-pricing';
                link.textContent = localeText('auth.pricing');
                return link;
            })()
            : null;

        if (hasAvatar(user)) {
            const accountWrap = document.createElement('div');
            accountWrap.className = 'auth-nav__mobile-account';

            const identityLink = document.createElement('a');
            identityLink.href = withGenerateLabReturnContext(localizedHref('/account/profile.html'));
            identityLink.className = 'auth-nav__mobile-identity';
            identityLink.setAttribute('aria-label', localeText('auth.openProfile'));

            identityLink.appendChild(buildAvatarImage(user, 'auth-nav__mobile-identity-img'));

            const label = document.createElement('span');
            label.className = 'auth-nav__mobile-identity-label';
            label.textContent = getIdentityLabel(user);
            identityLink.appendChild(label);

            accountWrap.appendChild(identityLink);
            if (pricingLink) accountWrap.appendChild(pricingLink);
            if (adminLink) accountWrap.appendChild(adminLink);
            accountWrap.appendChild(logout);
            authContainer.appendChild(accountWrap);
        } else {
            const email = document.createElement('span');
            email.className = 'auth-nav__mobile-email';
            email.textContent = user?.email || localeText('auth.member');
            authContainer.appendChild(email);
            const actionsWrap = document.createElement('div');
            actionsWrap.className = 'auth-nav__mobile-actions';

            const profileLink = document.createElement('a');
            profileLink.href = withGenerateLabReturnContext(localizedHref('/account/profile.html'));
            profileLink.className = 'auth-nav__mobile-profile';
            profileLink.textContent = localeText('auth.profile');
            actionsWrap.appendChild(profileLink);

            if (pricingLink) actionsWrap.appendChild(pricingLink);
            if (adminLink) actionsWrap.appendChild(adminLink);
            actionsWrap.appendChild(logout);
            authContainer.appendChild(actionsWrap);
        }
    } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mobile-nav__cta pulse-glow';
        btn.textContent = localeText('auth.signIn');
        btn.addEventListener('click', () => openAuthModal('login'));
        authContainer.appendChild(btn);
    }
}
