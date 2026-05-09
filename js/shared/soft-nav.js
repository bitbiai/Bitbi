/* ============================================================
   BITBI — Progressive-enhancement soft navigation
   Keeps the shared shell (header, audio player, auth, cookies)
   alive across a strict allowlist of internal page transitions.
   ============================================================ */

const SOFT_NAV_PATHS = new Set([
    '/legal/privacy.html',
    '/legal/imprint.html',
    '/legal/datenschutz.html',
    '/legal/terms.html',
]);

let active = false;
let onBeforeSwap = null;
let onAfterSwap = null;

/* ── URL helpers ── */

function resolveHref(href) {
    try {
        return new URL(href, location.href);
    } catch {
        return null;
    }
}

function resolveHttpHref(href) {
    if (!href) return null;
    const url = resolveHref(href);
    if (!url) return null;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
}

function isSoftNavTarget(url) {
    if (!url) return false;
    if (url.origin !== location.origin) return false;
    if (!SOFT_NAV_PATHS.has(url.pathname)) return false;
    if (url.pathname === location.pathname) return false;
    return true;
}

export function isSoftNavigableHref(href) {
    return isSoftNavTarget(resolveHttpHref(href));
}

function isModifiedClick(e) {
    return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
}

/* ── Content swap ── */

async function navigate(targetUrl, isPop) {
    try {
        const res = await fetch(targetUrl, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('fetch ' + res.status);

        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const newMain = doc.querySelector('main#main-content') || doc.querySelector('main');
        if (!newMain) throw new Error('no <main> in response');

        const curMain = document.querySelector('main#main-content') || document.querySelector('main');
        if (!curMain) throw new Error('no <main> in current page');

        /* Cleanup old page visuals */
        if (onBeforeSwap) onBeforeSwap();

        /* Swap content */
        curMain.innerHTML = newMain.innerHTML;

        /* Update document metadata */
        const newTitle = doc.querySelector('title');
        if (newTitle) document.title = newTitle.textContent;

        const newDesc = doc.querySelector('meta[name="description"]');
        const curDesc = document.querySelector('meta[name="description"]');
        if (newDesc && curDesc) {
            curDesc.setAttribute('content', newDesc.getAttribute('content') || '');
        }

        const newCanonical = doc.querySelector('link[rel="canonical"]');
        const curCanonical = document.querySelector('link[rel="canonical"]');
        if (newCanonical && curCanonical) {
            curCanonical.setAttribute('href', newCanonical.getAttribute('href') || '');
        }

        /* History */
        const parsedTarget = new URL(targetUrl);
        if (!isPop) {
            history.pushState({ softNav: true }, '', parsedTarget.pathname + parsedTarget.search);
        }

        /* Scroll */
        if (parsedTarget.hash) {
            const hashTarget = document.querySelector(parsedTarget.hash);
            if (hashTarget) {
                hashTarget.scrollIntoView();
            } else {
                window.scrollTo(0, 0);
            }
        } else {
            window.scrollTo(0, 0);
        }

        /* Reinit page visuals for new content */
        if (onAfterSwap) onAfterSwap();

    } catch (err) {
        console.warn('soft-nav fallback:', err);
        location.href = targetUrl;
    }
}

/* ── Event handlers ── */

function handleClick(e) {
    if (isModifiedClick(e)) return;

    const anchor = e.target.closest('a');
    if (!anchor) return;

    /* Skip non-standard navigation */
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download')) return;

    const href = anchor.getAttribute('href');
    const url = resolveHttpHref(href);
    if (!isSoftNavTarget(url)) return;

    e.preventDefault();
    navigate(url.toString(), false);
}

function handlePopState() {
    const url = new URL(location.href);
    if (SOFT_NAV_PATHS.has(url.pathname)) {
        navigate(location.href, true);
    } else {
        /* Destination is outside allowlist — hard reload */
        location.reload();
    }
}

/* ── Public API ── */

export function initSoftNav(callbacks = {}) {
    if (active) return;
    /* Only activate on pages within the allowlist */
    if (!SOFT_NAV_PATHS.has(location.pathname)) return;

    active = true;
    onBeforeSwap = typeof callbacks.onBeforeSwap === 'function' ? callbacks.onBeforeSwap : null;
    onAfterSwap = typeof callbacks.onAfterSwap === 'function' ? callbacks.onAfterSwap : null;

    document.addEventListener('click', handleClick);
    window.addEventListener('popstate', handlePopState);

    /* Mark initial history entry so popstate can distinguish */
    history.replaceState({ softNav: true }, '', location.href);
}
