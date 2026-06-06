import { localizedHref } from './locale.js?v=__ASSET_VERSION__';

const SAFE_AUTH_SOURCES = new Set([
    'profile',
    'credits',
    'assets-manager',
    'generate-lab',
    'pricing',
    'landing',
]);

const CONTEXT_SOURCE_MAP = Object.freeze({
    'authRecovery.profileMessage': 'profile',
    'authRecovery.creditsMessage': 'credits',
    'authRecovery.assetsMessage': 'assets-manager',
    'authRecovery.generateMessage': 'generate-lab',
    'authRecovery.pricingMessage': 'pricing',
    'authRecovery.publicMessage': 'landing',
});

const SOURCE_CONTEXT_MAP = Object.freeze({
    profile: 'authRecovery.profileMessage',
    credits: 'authRecovery.creditsMessage',
    'assets-manager': 'authRecovery.assetsMessage',
    'generate-lab': 'authRecovery.generateMessage',
    pricing: 'authRecovery.pricingMessage',
    landing: 'authRecovery.publicMessage',
});

const UNSAFE_RETURN_PARAMS = Object.freeze([
    'returnTo',
    'return_to',
    'redirect',
    'redirect_uri',
    'next',
    'token',
]);

function localHrefWithParams(path, params = {}, hash = '') {
    const base = localizedHref(path);
    const [pathname, existingHash = ''] = String(base).split('#');
    const [pathOnly, existingQuery = ''] = pathname.split('?');
    const search = new URLSearchParams(existingQuery);
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        search.set(key, String(value));
    }
    const query = search.toString();
    const nextHash = hash || (existingHash ? `#${existingHash}` : '');
    return `${pathOnly}${query ? `?${query}` : ''}${nextHash}`;
}

export function normalizeAuthSource(value) {
    const source = String(value || '').trim().toLowerCase();
    return SAFE_AUTH_SOURCES.has(source) ? source : '';
}

export function authSourceFromSearch(search = '') {
    const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    return normalizeAuthSource(params.get('source'));
}

export function sourceForAuthContextKey(contextKey) {
    return normalizeAuthSource(CONTEXT_SOURCE_MAP[contextKey]);
}

export function contextKeyForAuthSource(source) {
    return SOURCE_CONTEXT_MAP[normalizeAuthSource(source)] || SOURCE_CONTEXT_MAP.landing;
}

export function authSourceFromPath(pathname = '') {
    const path = String(pathname || '').toLowerCase();
    if (path.includes('/account/profile')) return 'profile';
    if (path.includes('/account/credits')) return 'credits';
    if (path.includes('/account/assets-manager')) return 'assets-manager';
    if (path.includes('/generate-lab')) return 'generate-lab';
    if (path.includes('/pricing')) return 'pricing';
    return 'landing';
}

export function authSourceFromCurrentPath() {
    if (typeof window === 'undefined') return 'landing';
    return authSourceFromPath(window.location?.pathname || '');
}

export function authSourceFromCurrentSearch() {
    if (typeof window === 'undefined') return '';
    return authSourceFromSearch(window.location?.search || '');
}

export function resolveAuthSource({ source, contextKey } = {}) {
    return normalizeAuthSource(source)
        || sourceForAuthContextKey(contextKey)
        || authSourceFromCurrentPath();
}

export function authContinuationKey(source) {
    const safeSource = normalizeAuthSource(source) || 'landing';
    return `authReturn.continue${safeSource
        .split('-')
        .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '')
        .join('')}`;
}

export function buildAuthContinuationHref(source) {
    const safeSource = normalizeAuthSource(source) || 'landing';
    switch (safeSource) {
        case 'profile':
            return localHrefWithParams('/account/profile-settings.html', { source: safeSource }, '#profileCompletionCard');
        case 'credits':
            return localHrefWithParams('/account/credits.html', { scope: 'member', source: safeSource });
        case 'assets-manager':
            return localHrefWithParams('/account/assets-manager.html', { source: safeSource, recent: '1' }, '#generate-lab-recent');
        case 'generate-lab':
            return localHrefWithParams('/generate-lab/', { source: safeSource });
        case 'pricing':
            return localHrefWithParams('/pricing.html', { source: safeSource }, '#pricingAccountEntry');
        case 'landing':
        default:
            return localHrefWithParams('/generate-lab/', { source: 'landing' });
    }
}

export function buildWorkspaceHref(target, source) {
    const safeSource = normalizeAuthSource(source) || authSourceFromCurrentPath();
    switch (target) {
        case 'profile':
            return localHrefWithParams('/account/profile-settings.html', { source: safeSource }, '#profileCompletionCard');
        case 'credits':
            return localHrefWithParams('/account/credits.html', { scope: 'member', source: safeSource });
        case 'generate-lab':
            return localHrefWithParams('/generate-lab/', { source: safeSource });
        case 'assets-manager':
            return localHrefWithParams('/account/assets-manager.html', { source: safeSource, recent: '1' }, '#generate-lab-recent');
        default:
            return buildAuthContinuationHref(safeSource);
    }
}

export function buildPasswordResetHref(source) {
    return localHrefWithParams('/account/forgot-password.html', { source: normalizeAuthSource(source) || 'landing' });
}

export function buildVerificationHref(source) {
    return localHrefWithParams(
        '/account/profile-settings.html',
        { source: normalizeAuthSource(source) || 'landing', returnContext: 'verification' },
        '#profileCompletionCard',
    );
}

export function scrubUnsafeAuthReturnParamsFromCurrentUrl() {
    if (typeof window === 'undefined' || !window.location || !window.history) return false;
    const url = new URL(window.location.href);
    let changed = false;
    for (const name of UNSAFE_RETURN_PARAMS) {
        if (url.searchParams.has(name)) {
            url.searchParams.delete(name);
            changed = true;
        }
    }
    if (!changed) return false;
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    return true;
}
