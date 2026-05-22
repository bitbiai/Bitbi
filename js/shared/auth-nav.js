/* ============================================================
   BITBI — Auth nav: sign-in/out button in desktop + mobile nav
   Shared module — used by index.html and all subpages
   ============================================================ */

import { getAuthState, authLogout, patchAuthUser } from './auth-state.js';
import { openAuthModal } from './auth-modal.js';
import { withGenerateLabReturnContext } from './generate-lab-context.js?v=__ASSET_VERSION__';
import { localeText, localizedHref } from './locale.js?v=__ASSET_VERSION__';
import {
    authSourceFromCurrentPath,
    buildPasswordResetHref,
    buildWorkspaceHref,
    contextKeyForAuthSource,
} from './auth-return-context.js?v=__ASSET_VERSION__';

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

function buildMobileWorkspaceLink(href, labelKey, className = '') {
    const link = document.createElement('a');
    link.href = href;
    link.className = `auth-nav__mobile-workspace-link${className ? ` ${className}` : ''}`;
    link.textContent = localeText(labelKey);
    return link;
}

function buildMobileWorkspaceStatus(user) {
    const source = authSourceFromCurrentPath();
    const wrap = document.createElement('div');
    wrap.className = 'auth-nav__mobile-continuity';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');

    const status = document.createElement('p');
    status.className = 'auth-nav__mobile-status';
    status.textContent = localeText('auth.signedInAs', { name: getIdentityLabel(user) });

    const copy = document.createElement('p');
    copy.className = 'auth-nav__mobile-copy';
    copy.textContent = localeText('auth.workspaceStatus');

    const actions = document.createElement('nav');
    actions.className = 'auth-nav__mobile-workspace';
    actions.setAttribute('aria-label', localeText('auth.workspaceActions'));
    actions.append(
        buildMobileWorkspaceLink(
            withGenerateLabReturnContext(buildWorkspaceHref('profile', source)),
            'auth.profile',
            'auth-nav__mobile-workspace-link--primary',
        ),
        buildMobileWorkspaceLink(buildWorkspaceHref('credits', source), 'auth.openCredits'),
        buildMobileWorkspaceLink(buildWorkspaceHref('generate-lab', source), 'auth.openGenerateLab'),
        buildMobileWorkspaceLink(buildWorkspaceHref('assets-manager', source), 'auth.openAssetsManager'),
    );

    wrap.append(status, copy, actions);
    return wrap;
}

function buildMobileSignedOutRecovery() {
    const source = authSourceFromCurrentPath();
    const contextKey = contextKeyForAuthSource(source);
    const wrap = document.createElement('div');
    wrap.className = 'auth-nav__mobile-continuity auth-nav__mobile-continuity--signed-out';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');

    const status = document.createElement('p');
    status.className = 'auth-nav__mobile-status';
    status.textContent = localeText('authReturn.signedOutTitle');

    const copy = document.createElement('p');
    copy.className = 'auth-nav__mobile-copy';
    copy.textContent = localeText('authReturn.signedOutCopy');

    const actions = document.createElement('div');
    actions.className = 'auth-nav__mobile-workspace';
    actions.setAttribute('aria-label', localeText('authReturn.signedOutActions'));

    const signIn = document.createElement('button');
    signIn.type = 'button';
    signIn.className = 'auth-nav__mobile-workspace-link auth-nav__mobile-workspace-link--primary';
    signIn.textContent = localeText('auth.signIn');
    signIn.addEventListener('click', () => openAuthModal('login', { contextKey, returnSource: source }));

    const register = document.createElement('button');
    register.type = 'button';
    register.className = 'auth-nav__mobile-workspace-link';
    register.textContent = localeText('auth.createAccount');
    register.addEventListener('click', () => openAuthModal('register', { contextKey, returnSource: source }));

    const reset = buildMobileWorkspaceLink(buildPasswordResetHref(source), 'authRecovery.contextReset');
    actions.append(signIn, register, reset);

    wrap.append(status, copy, actions);
    return wrap;
}

function usesReorganizedPublicHeader() {
    return !document.body.classList.contains('generate-lab-page') && !document.getElementById('adminHeroTitle');
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
    const useActionLinks = usesReorganizedPublicHeader();

    // Remove any previous injected links
    const navLinks = document.querySelector('.site-nav__links');
    document
        .querySelectorAll('.site-nav__links .auth-nav__admin-link, .site-nav__links .auth-nav__profile-link, .site-nav__actions .auth-nav__admin-link, .site-nav__actions .auth-nav__profile-link')
        .forEach((link) => link.remove());

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
            email.setAttribute('aria-label', localeText('auth.openProfileFor', { name: getIdentityLabel(user) }));
            wrap.appendChild(email);
            if (mood) mood.hidden = useActionLinks;
        }

        const logout = document.createElement('button');
        logout.type = 'button';
        logout.className = 'auth-nav__logout';
        logout.textContent = localeText('auth.signOut');
        logout.addEventListener('click', () => authLogout());
        wrap.appendChild(logout);

        // Profile link — only when the header stays in the legacy no-avatar state
        const profileLinkTarget = useActionLinks ? actions : navLinks;
        if (profileLinkTarget && !hasAvatar(user)) {
            const profileLink = document.createElement('a');
            profileLink.href = withGenerateLabReturnContext(localizedHref('/account/profile.html'));
            profileLink.className = 'site-nav__link nav-link auth-nav__profile-link';
            profileLink.textContent = localeText('auth.profile');
            profileLinkTarget.appendChild(profileLink);
        }

        // Admin link — Pricing is a public shared-header link for every visitor.
        const adminLinkTarget = useActionLinks ? actions : navLinks;
        if (user?.role === 'admin' && adminLinkTarget) {
            const adminLink = document.createElement('a');
            adminLink.href = localizedHref('/admin/');
            adminLink.className = 'site-nav__link nav-link auth-nav__admin-link';
            adminLink.textContent = localeText('auth.admin');
            adminLinkTarget.appendChild(adminLink);
        }
    } else {
        if (mood) mood.hidden = useActionLinks;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'site-nav__cta pulse-glow';
        btn.textContent = localeText('auth.signIn');
        btn.addEventListener('click', () => {
            const source = authSourceFromCurrentPath();
            openAuthModal('login', {
                contextKey: contextKeyForAuthSource(source),
                returnSource: source,
            });
        });
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
            if (adminLink) accountWrap.appendChild(adminLink);
            accountWrap.appendChild(logout);
            authContainer.appendChild(accountWrap);
            authContainer.appendChild(buildMobileWorkspaceStatus(user));
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

            if (adminLink) actionsWrap.appendChild(adminLink);
            actionsWrap.appendChild(logout);
            authContainer.appendChild(actionsWrap);
            authContainer.appendChild(buildMobileWorkspaceStatus(user));
        }
    } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mobile-nav__cta pulse-glow';
        btn.textContent = localeText('auth.signIn');
        btn.addEventListener('click', () => {
            const source = authSourceFromCurrentPath();
            openAuthModal('login', {
                contextKey: contextKeyForAuthSource(source),
                returnSource: source,
            });
        });
        authContainer.appendChild(btn);
        authContainer.appendChild(buildMobileSignedOutRecovery());
    }
}
