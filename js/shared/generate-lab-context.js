/* ============================================================
   BITBI — Generate Lab return context
   Per-tab navigation context for pages opened from Generate Lab.
   ============================================================ */

export const GENERATE_LAB_CONTEXT_KEY = 'bitbi:return-context';
export const GENERATE_LAB_CONTEXT_VALUE = 'generate-lab';
export const GENERATE_LAB_RETURN_PARAM = 'returnContext';
export const GENERATE_LAB_HOME_PATH = '/generate-lab/';

function getSessionStorage() {
    try {
        return window.sessionStorage || null;
    } catch {
        return null;
    }
}

function getUrlContext() {
    try {
        return new URL(window.location.href).searchParams.get(GENERATE_LAB_RETURN_PARAM);
    } catch {
        return null;
    }
}

export function activateGenerateLabContext() {
    getSessionStorage()?.setItem(GENERATE_LAB_CONTEXT_KEY, GENERATE_LAB_CONTEXT_VALUE);
    document.documentElement.dataset.returnContext = GENERATE_LAB_CONTEXT_VALUE;
}

export function clearGenerateLabContext() {
    getSessionStorage()?.removeItem(GENERATE_LAB_CONTEXT_KEY);
    if (document.documentElement.dataset.returnContext === GENERATE_LAB_CONTEXT_VALUE) {
        delete document.documentElement.dataset.returnContext;
    }
}

export function isGenerateLabContextActive() {
    const urlContext = getUrlContext();
    if (urlContext === GENERATE_LAB_CONTEXT_VALUE) {
        activateGenerateLabContext();
        return true;
    }
    if (urlContext === 'home' || urlContext === 'main') {
        clearGenerateLabContext();
        return false;
    }
    const active = getSessionStorage()?.getItem(GENERATE_LAB_CONTEXT_KEY) === GENERATE_LAB_CONTEXT_VALUE;
    if (active) {
        document.documentElement.dataset.returnContext = GENERATE_LAB_CONTEXT_VALUE;
    }
    return active;
}

export function withGenerateLabReturnContext(href) {
    const rawHref = String(href || '').trim();
    if (!rawHref || !isGenerateLabContextActive()) return rawHref;

    let url;
    try {
        url = new URL(rawHref, window.location.origin);
    } catch {
        return rawHref;
    }
    if (url.origin !== window.location.origin) return rawHref;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/')) return rawHref;
    if (!url.pathname.startsWith('/account/') && !url.pathname.startsWith('/legal/')) return rawHref;

    url.searchParams.set(GENERATE_LAB_RETURN_PARAM, GENERATE_LAB_CONTEXT_VALUE);
    return `${url.pathname}${url.search}${url.hash}`;
}

export function applyGenerateLabReturnLinks(root = document) {
    if (!isGenerateLabContextActive()) return;
    root.querySelectorAll('a[href]').forEach((link) => {
        const href = link.getAttribute('href') || '';
        let url;
        try {
            url = new URL(href, window.location.origin);
        } catch {
            return;
        }
        if (url.origin !== window.location.origin) return;
        if ((url.pathname === '/' || url.pathname === '/index.html') && !url.hash) {
            link.setAttribute('href', GENERATE_LAB_HOME_PATH);
            link.removeAttribute('target');
            link.removeAttribute('rel');
            return;
        }
        if (url.pathname.startsWith('/account/') || url.pathname.startsWith('/legal/')) {
            link.setAttribute('href', withGenerateLabReturnContext(href));
        }
    });
}
