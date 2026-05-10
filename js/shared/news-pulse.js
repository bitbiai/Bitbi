import { getCurrentLocale, localeText } from './locale.js?v=__ASSET_VERSION__';

const NEWS_PULSE_ENDPOINT = '/api/public/news-pulse';
const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const MAX_SOURCE_ITEMS = 6;
const MIN_VISUAL_ITEMS = 7;
const MAX_VISUAL_ITEMS = 8;
const MIN_WHEEL_DURATION_SECONDS = 38;
const MAX_WHEEL_DURATION_SECONDS = 57;
const WHEEL_DURATION_SECONDS_PER_SOURCE_ITEM = 9.4;
const MOBILE_INTERVAL_MS = 5000;
const MOBILE_ANIMATION_MS = 780;
const MOBILE_TOP_RATIO = 0.05;
const MOBILE_BOTTOM_RATIO = 0.83;

function normalizeLocale(value) {
    const locale = String(value || '').trim().toLowerCase();
    return locale === 'de' || locale.startsWith('de-') ? 'de' : 'en';
}

function validNewsUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        if (url.username || url.password) return '';
        return url.protocol === 'https:' ? url.href : '';
    } catch {
        return '';
    }
}

function normalizeItem(item) {
    const url = validNewsUrl(item?.url);
    const title = String(item?.title || '').replace(/\s+/g, ' ').trim();
    const summary = String(item?.summary || '').replace(/\s+/g, ' ').trim();
    const source = String(item?.source || '').replace(/\s+/g, ' ').trim();
    if (!url || !title || !summary || !source) return null;
    return {
        id: String(item?.id || url).slice(0, 96),
        title: title.slice(0, 160),
        summary: summary.slice(0, 220),
        source: source.slice(0, 80),
        category: String(item?.category || 'AI').replace(/\s+/g, ' ').trim().slice(0, 48),
        url,
    };
}

async function fetchNewsPulse(locale) {
    const response = await fetch(`${NEWS_PULSE_ENDPOINT}?locale=${encodeURIComponent(locale)}`, {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (Array.isArray(data?.items) ? data.items : [])
        .map(normalizeItem)
        .filter(Boolean)
        .slice(0, MAX_SOURCE_ITEMS);
}

function createElement(tagName, className, text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function createPulseLink(item, locale, { isDuplicate = false } = {}) {
    const link = createElement('a', 'news-pulse__link');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `${item.title} - ${localeText('newsPulse.openSource', {}, locale)}`);
    if (isDuplicate) {
        link.tabIndex = -1;
    }

    const mark = createElement('span', 'news-pulse__mark');
    mark.setAttribute('aria-hidden', 'true');
    const body = createElement('span', 'news-pulse__body');
    const meta = createElement('span', 'news-pulse__meta', item.category || 'AI');
    const title = createElement('span', 'news-pulse__title', item.title);
    const summary = createElement('span', 'news-pulse__summary', item.summary);
    const source = createElement('span', 'news-pulse__source', `${localeText('newsPulse.source', {}, locale)}: ${item.source}`);

    body.append(meta, title, summary, source);
    link.append(mark, body);
    return link;
}

function createPulseItem(item, locale, { index = 0, total = 1, duration = MIN_WHEEL_DURATION_SECONDS, isDuplicate = false } = {}) {
    const wrapper = createElement('span', 'news-pulse__item');
    wrapper.setAttribute('role', 'listitem');
    wrapper.dataset.newsPulseItemId = item.id;
    wrapper.dataset.newsPulseRenderIndex = String(index);
    wrapper.style.setProperty('--pulse-index', String(index));
    wrapper.style.setProperty('--pulse-delay', `${-(duration / Math.max(total, 1)) * index}s`);
    if (isDuplicate) {
        wrapper.setAttribute('aria-hidden', 'true');
    }

    const link = createPulseLink(item, locale, { isDuplicate });
    wrapper.appendChild(link);
    return wrapper;
}

function createMobilePulseItem(item, locale, state = 'active') {
    const wrapper = createElement('span', `news-pulse__mobile-item is-${state}`);
    wrapper.setAttribute('role', 'listitem');
    wrapper.dataset.newsPulseItemId = item.id;

    const link = createPulseLink(item, locale);
    if (state !== 'active') {
        link.tabIndex = -1;
        link.setAttribute('aria-hidden', 'true');
    }
    wrapper.appendChild(link);
    return wrapper;
}

function buildVisualItems(items) {
    if (!items.length) return [];
    const visualItems = [];
    while (visualItems.length < MIN_VISUAL_ITEMS) {
        visualItems.push(...items);
    }
    return visualItems.slice(0, Math.max(MIN_VISUAL_ITEMS, Math.min(MAX_VISUAL_ITEMS, visualItems.length)));
}

function renderTrack(items, locale) {
    const visualItems = buildVisualItems(items);
    const duration = Math.min(
        MAX_WHEEL_DURATION_SECONDS,
        Math.max(MIN_WHEEL_DURATION_SECONDS, items.length * WHEEL_DURATION_SECONDS_PER_SOURCE_ITEM),
    );
    const track = createElement('div', 'news-pulse__track');
    track.setAttribute('role', 'list');
    track.style.setProperty('--pulse-duration', `${duration}s`);
    track.style.setProperty('--pulse-count', String(visualItems.length));

    visualItems.forEach((item, index) => {
        track.appendChild(createPulseItem(item, locale, {
            duration,
            index,
            total: visualItems.length,
            isDuplicate: index >= items.length,
        }));
    });
    return track;
}

function renderEmpty(root, locale) {
    root.classList.remove('is-loading');
    root.classList.add('is-empty');
    root.replaceChildren();

    const shell = createElement('div', 'news-pulse__shell');
    const label = createElement('span', 'news-pulse__label', localeText('newsPulse.label', {}, locale));
    const empty = createElement('span', 'news-pulse__empty', localeText('newsPulse.empty', {}, locale));
    shell.append(label, empty);
    root.appendChild(shell);
}

function renderNewsPulse(root, items, locale) {
    if (!items.length) {
        renderEmpty(root, locale);
        return;
    }

    root.classList.remove('is-loading', 'is-empty');
    root.classList.add('is-ready');
    root.replaceChildren();

    const shell = createElement('div', 'news-pulse__shell');
    const label = createElement('span', 'news-pulse__label', localeText('newsPulse.label', {}, locale));
    const flow = createElement('div', 'news-pulse__flow');

    flow.append(renderTrack(items, locale));
    shell.append(label, flow);
    root.appendChild(shell);
}

function clearNewsPulse(root) {
    root.classList.remove('is-loading', 'is-ready', 'is-empty', 'news-pulse--desktop', 'news-pulse--mobile');
    root.classList.add('is-disabled');
    root.setAttribute('aria-hidden', 'true');
    root.replaceChildren();
}

function updateMobilePlacement(root) {
    const hero = root.closest('#hero');
    const header = document.querySelector('#navbar');
    const heroLogo = hero?.querySelector('.hero__title-img') || hero?.querySelector('.hero__title');
    if (!hero || !header || !heroLogo) return false;

    const heroRect = hero.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const logoRect = heroLogo.getBoundingClientRect();
    const distance = logoRect.top - headerRect.bottom;
    if (!Number.isFinite(distance) || distance <= 0) return false;

    const top = headerRect.bottom + (distance * MOBILE_TOP_RATIO);
    const bottom = headerRect.bottom + (distance * MOBILE_BOTTOM_RATIO);
    root.style.setProperty('--news-pulse-mobile-top', `${Math.max(0, top - heroRect.top)}px`);
    root.style.setProperty('--news-pulse-mobile-height', `${Math.max(0, bottom - top)}px`);
    root.dataset.newsPulseMobilePlacement = 'ready';
    return true;
}

function readAuthState(getAuthState) {
    if (typeof getAuthState !== 'function') return { ready: false, loggedIn: false };
    try {
        const state = getAuthState() || {};
        return { ready: !!state.ready, loggedIn: !!state.loggedIn };
    } catch {
        return { ready: false, loggedIn: false };
    }
}

export async function initNewsPulse(container = document, { getAuthState } = {}) {
    const roots = [...container.querySelectorAll('[data-news-pulse]')];
    const desktopQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const reducedMotionQuery = window.matchMedia(REDUCED_MOTION_QUERY);

    await Promise.all(roots.map(async (root) => {
        let hasRenderedDesktop = false;
        let mode = 'disabled';
        let fetchToken = 0;
        let mobileItems = [];
        let mobileIndex = 0;
        let mobileTimer = 0;
        let mobileTransitionTimer = 0;
        let mobilePlacementFrame = 0;
        let disconnectObserver = null;

        const clearMobileTimers = () => {
            if (mobileTimer) {
                window.clearInterval(mobileTimer);
                mobileTimer = 0;
            }
            if (mobileTransitionTimer) {
                window.clearTimeout(mobileTransitionTimer);
                mobileTransitionTimer = 0;
            }
            if (mobilePlacementFrame) {
                window.cancelAnimationFrame(mobilePlacementFrame);
                mobilePlacementFrame = 0;
            }
        };

        const scheduleMobilePlacement = () => {
            if (mode !== 'mobile') return;
            if (mobilePlacementFrame) window.cancelAnimationFrame(mobilePlacementFrame);
            mobilePlacementFrame = window.requestAnimationFrame(() => {
                mobilePlacementFrame = 0;
                updateMobilePlacement(root);
            });
        };

        const clearForDisabledState = () => {
            mode = 'disabled';
            fetchToken += 1;
            clearMobileTimers();
            clearNewsPulse(root);
        };

        const showMobileItem = (nextIndex, { transition = true } = {}) => {
            const viewport = root.querySelector('.news-pulse__mobile-viewport');
            if (!viewport || !mobileItems.length) return;
            const normalizedIndex = ((nextIndex % mobileItems.length) + mobileItems.length) % mobileItems.length;
            const currentItem = mobileItems[mobileIndex];
            const nextItem = mobileItems[normalizedIndex];
            const shouldAnimate = transition
                && mobileItems.length > 1
                && normalizedIndex !== mobileIndex
                && !reducedMotionQuery.matches;

            if (!shouldAnimate) {
                mobileIndex = normalizedIndex;
                viewport.replaceChildren(createMobilePulseItem(nextItem, root.dataset.newsPulseLocale || 'en', 'active'));
                return;
            }

            if (mobileTransitionTimer) window.clearTimeout(mobileTransitionTimer);
            const locale = root.dataset.newsPulseLocale || 'en';
            const outgoing = createMobilePulseItem(currentItem, locale, 'exiting');
            const incoming = createMobilePulseItem(nextItem, locale, 'entering');
            viewport.replaceChildren(outgoing, incoming);
            mobileTransitionTimer = window.setTimeout(() => {
                mobileIndex = normalizedIndex;
                viewport.replaceChildren(createMobilePulseItem(nextItem, locale, 'active'));
                mobileTransitionTimer = 0;
            }, MOBILE_ANIMATION_MS);
        };

        const startMobileTimer = () => {
            if (mobileTimer || mobileItems.length <= 1) return;
            mobileTimer = window.setInterval(() => {
                if (!root.isConnected || mode !== 'mobile') {
                    clearMobileTimers();
                    return;
                }
                showMobileItem(mobileIndex + 1);
            }, MOBILE_INTERVAL_MS);
        };

        const renderMobileNewsPulse = (items, locale) => {
            root.classList.remove('is-loading', 'is-empty', 'is-disabled', 'news-pulse--desktop');
            root.classList.add('is-ready', 'news-pulse--mobile');
            root.setAttribute('aria-label', localeText('newsPulse.label', {}, locale));
            root.removeAttribute('aria-hidden');
            root.replaceChildren();

            mobileItems = items;
            mobileIndex = 0;

            const shell = createElement('div', 'news-pulse__shell news-pulse__shell--mobile');
            const label = createElement('span', 'news-pulse__label', localeText('newsPulse.label', {}, locale));
            const viewport = createElement('div', 'news-pulse__mobile-viewport');
            viewport.setAttribute('role', 'list');
            viewport.setAttribute('aria-live', 'polite');
            shell.append(label, viewport);
            root.appendChild(shell);
            showMobileItem(0, { transition: false });
            scheduleMobilePlacement();
            startMobileTimer();
        };

        const renderMobileEmpty = (locale) => {
            clearMobileTimers();
            root.classList.remove('is-disabled', 'news-pulse--desktop');
            root.classList.add('news-pulse--mobile');
            root.setAttribute('aria-label', localeText('newsPulse.label', {}, locale));
            root.removeAttribute('aria-hidden');
            renderEmpty(root, locale);
            scheduleMobilePlacement();
        };

        const renderDesktop = async () => {
            clearMobileTimers();
            mode = 'desktop';
            root.classList.remove('news-pulse--mobile');
            root.classList.add('news-pulse--desktop');
            if (hasRenderedDesktop) return;
            hasRenderedDesktop = true;

            const locale = normalizeLocale(root.dataset.newsPulseLocale || getCurrentLocale());
            root.dataset.newsPulseLocale = locale;
            root.setAttribute('aria-label', localeText('newsPulse.label', {}, locale));
            root.removeAttribute('aria-hidden');
            root.classList.remove('is-disabled');
            root.classList.add('is-loading');
            try {
                renderNewsPulse(root, await fetchNewsPulse(locale), locale);
            } catch {
                renderEmpty(root, locale);
            }
        };

        const renderMobile = async () => {
            const locale = normalizeLocale(root.dataset.newsPulseLocale || getCurrentLocale());
            root.dataset.newsPulseLocale = locale;
            const authState = readAuthState(getAuthState);
            if (!authState.ready || !authState.loggedIn) {
                clearForDisabledState();
                return;
            }

            if (mode === 'mobile' && root.classList.contains('is-ready')) {
                scheduleMobilePlacement();
                return;
            }

            mode = 'mobile';
            clearMobileTimers();
            root.classList.remove('is-ready', 'is-empty', 'is-disabled', 'news-pulse--desktop');
            root.classList.add('is-loading', 'news-pulse--mobile');
            root.setAttribute('aria-label', localeText('newsPulse.label', {}, locale));
            root.removeAttribute('aria-hidden');
            root.replaceChildren();
            scheduleMobilePlacement();

            const token = ++fetchToken;
            try {
                const items = await fetchNewsPulse(locale);
                if (token !== fetchToken || mode !== 'mobile') return;
                if (!readAuthState(getAuthState).loggedIn || desktopQuery.matches) {
                    clearForDisabledState();
                    return;
                }
                if (!items.length) {
                    renderMobileEmpty(locale);
                    return;
                }
                renderMobileNewsPulse(items, locale);
            } catch {
                if (token === fetchToken && mode === 'mobile') renderMobileEmpty(locale);
            }
        };

        const renderForViewport = async () => {
            if (desktopQuery.matches) {
                await renderDesktop();
                return;
            }
            await renderMobile();
        };

        const handleViewportChange = () => {
            if (desktopQuery.matches) {
                hasRenderedDesktop = false;
            }
            renderForViewport();
        };

        if (typeof desktopQuery.addEventListener === 'function') {
            desktopQuery.addEventListener('change', handleViewportChange);
        } else if (typeof desktopQuery.addListener === 'function') {
            desktopQuery.addListener(handleViewportChange);
        }

        window.addEventListener('resize', scheduleMobilePlacement, { passive: true });
        window.addEventListener('orientationchange', scheduleMobilePlacement, { passive: true });
        window.addEventListener('load', scheduleMobilePlacement, { once: true });
        document.fonts?.ready?.then(scheduleMobilePlacement).catch(() => {});
        const heroLogo = root.closest('#hero')?.querySelector('.hero__title-img');
        if (heroLogo && !heroLogo.complete) {
            heroLogo.addEventListener('load', scheduleMobilePlacement, { once: true });
        }
        document.addEventListener('bitbi:auth-change', renderForViewport);
        if (window.MutationObserver) {
            disconnectObserver = new MutationObserver(() => {
                if (!root.isConnected) {
                    clearMobileTimers();
                    disconnectObserver?.disconnect();
                    disconnectObserver = null;
                }
            });
            disconnectObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
        await renderForViewport();
    }));
}
