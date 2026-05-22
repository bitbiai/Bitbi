import { localeText } from './locale.js?v=__ASSET_VERSION__';
import {
    authSourceFromCurrentPath,
    authSourceFromCurrentSearch,
    buildWorkspaceHref,
    normalizeAuthSource,
    scrubUnsafeAuthReturnParamsFromCurrentUrl,
} from './auth-return-context.js?v=__ASSET_VERSION__';

const WORKSPACE_TARGETS = Object.freeze(['profile', 'credits', 'generate-lab', 'assets-manager']);

const TARGET_LABEL_KEYS = Object.freeze({
    profile: 'auth.profile',
    credits: 'auth.openCredits',
    'generate-lab': 'auth.openGenerateLab',
    'assets-manager': 'auth.openAssetsManager',
});

const PAGE_KEY_SUFFIX = Object.freeze({
    profile: 'profile',
    credits: 'credits',
    'assets-manager': 'assetsManager',
    'generate-lab': 'generateLab',
    pricing: 'pricing',
    landing: 'landing',
});

function safePageSource(pageSource) {
    return normalizeAuthSource(pageSource) || authSourceFromCurrentPath();
}

function sourceLabel(source) {
    return localeText(`postAuth.sources.${normalizeAuthSource(source) || 'landing'}`);
}

function pageTitleKey(pageSource) {
    return `postAuth.pages.${PAGE_KEY_SUFFIX[safePageSource(pageSource)] || 'landing'}Title`;
}

function pageCopyKey(pageSource) {
    return `postAuth.pages.${PAGE_KEY_SUFFIX[safePageSource(pageSource)] || 'landing'}Copy`;
}

function createWorkspaceLink(target, source, isPrimary = false) {
    const link = document.createElement('a');
    link.className = isPrimary ? 'auth-post-hint__link auth-post-hint__link--primary' : 'auth-post-hint__link';
    link.href = buildWorkspaceHref(target, source);
    link.textContent = localeText(TARGET_LABEL_KEYS[target]);
    return link;
}

export function renderPostAuthHint({ mount, pageSource, signedIn = false, insert = 'prepend' } = {}) {
    const container = typeof mount === 'string' ? document.querySelector(mount) : mount;
    if (!container) return null;

    const existing = container.querySelector('[data-auth-post-hint]');
    if (existing) existing.remove();

    scrubUnsafeAuthReturnParamsFromCurrentUrl();

    const source = authSourceFromCurrentSearch();
    const page = safePageSource(pageSource);
    if (!signedIn || !source) return null;

    const section = document.createElement('section');
    section.className = 'auth-post-hint';
    section.setAttribute('data-auth-post-hint', '');
    section.setAttribute('data-auth-post-source', source);
    section.setAttribute('role', 'status');
    section.setAttribute('aria-live', 'polite');
    section.setAttribute('aria-labelledby', `${page.replace(/-/g, '')}PostAuthHintTitle`);

    const body = document.createElement('div');
    body.className = 'auth-post-hint__body';

    const eyebrow = document.createElement('p');
    eyebrow.className = 'auth-post-hint__eyebrow';
    eyebrow.textContent = localeText('postAuth.eyebrow');

    const title = document.createElement('h2');
    title.className = 'auth-post-hint__title';
    title.id = `${page.replace(/-/g, '')}PostAuthHintTitle`;
    title.textContent = localeText(pageTitleKey(page));

    const copy = document.createElement('p');
    copy.className = 'auth-post-hint__copy';
    copy.textContent = localeText(pageCopyKey(page));

    const meta = document.createElement('p');
    meta.className = 'auth-post-hint__meta';
    meta.textContent = localeText('postAuth.safeSource', { source: sourceLabel(source) });

    body.append(eyebrow, title, copy, meta);

    const actions = document.createElement('nav');
    actions.className = 'auth-post-hint__actions';
    actions.setAttribute('aria-label', localeText('postAuth.actionsLabel'));
    for (const target of WORKSPACE_TARGETS) {
        actions.appendChild(createWorkspaceLink(target, source, target === page));
    }

    section.append(body, actions);
    if (insert === 'append') {
        container.appendChild(section);
    } else {
        container.prepend(section);
    }
    return section;
}
