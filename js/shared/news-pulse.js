import { getCurrentLocale, localeText } from './locale.js?v=__ASSET_VERSION__';

const NEWS_PULSE_ENDPOINT = '/api/public/news-pulse';
const MAX_SOURCE_ITEMS = 6;

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

function validVisualThumbUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || /[\u0000-\u001f\u007f\\]/.test(raw)) return '';
    try {
        const url = new URL(raw, window.location.origin);
        if (url.origin !== window.location.origin) return '';
        if (!url.pathname.startsWith('/api/public/news-pulse/thumbs/')) return '';
        return `${url.pathname}${url.search}`;
    } catch {
        return '';
    }
}

function normalizeItem(item) {
    const url = validNewsUrl(item?.url);
    const title = String(item?.title || '').replace(/\s+/g, ' ').trim();
    const summary = String(item?.summary || '').replace(/\s+/g, ' ').trim();
    const source = String(item?.source || '').replace(/\s+/g, ' ').trim();
    if (!url || !title) return null;
    const visualThumbUrl = String(item?.visual_type || '').trim().toLowerCase() === 'generated'
        ? validVisualThumbUrl(item?.visual_thumb_url || item?.visual_url)
        : '';
    const normalized = {
        id: String(item?.id || url).slice(0, 96),
        title: title.slice(0, 160),
        summary: summary.slice(0, 220),
        source: source.slice(0, 80),
        category: String(item?.category || '').replace(/\s+/g, ' ').trim().slice(0, 48),
        url,
    };
    if (visualThumbUrl) {
        normalized.visual_thumb_url = visualThumbUrl;
        normalized.visual_alt = String(item?.visual_alt || `Generated abstract thumbnail for ${title}`)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 180);
    }
    return normalized;
}

function uniqueNewsKey(item) {
    return [
        String(item?.title || '').trim().toLowerCase(),
        String(item?.source || '').trim().toLowerCase(),
        String(item?.url || '').trim().toLowerCase(),
    ].join('|');
}

function uniqueNewsItems(items) {
    const seen = new Set();
    return items.filter((item) => {
        const key = uniqueNewsKey(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function fetchNewsPulse(locale, surface = 'desktop', signal) {
    const params = new URLSearchParams();
    params.set('locale', locale);
    params.set('surface', surface === 'mobile' ? 'mobile' : 'desktop');
    const response = await fetch(`${NEWS_PULSE_ENDPOINT}?${params}`, {
        headers: { Accept: 'application/json' },
        credentials: 'omit', signal,
    });
    if (!response.ok) return { enabled: true, items: [] };
    const data = await response.json();
    return {
        enabled: data?.enabled !== false,
        items: uniqueNewsItems((Array.isArray(data?.items) ? data.items : [])
            .map(normalizeItem)
            .filter(Boolean))
            .slice(0, MAX_SOURCE_ITEMS),
    };
}

function createElement(tagName, className, text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function createPulseLink(item, locale, { isDuplicate = false, allowThumbnail = false } = {}) {
    const link = createElement('a', 'news-pulse__link');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `${item.title} - ${localeText('newsPulse.openSource', {}, locale)}`);
    if (isDuplicate) {
        link.tabIndex = -1;
    }

    const thumbUrl = allowThumbnail ? item.visual_thumb_url : '';
    let visual;
    if (thumbUrl) {
        link.classList.add('news-pulse__link--thumb');
        visual = createElement('img', 'news-pulse__thumb');
        visual.src = thumbUrl;
        visual.alt = item.visual_alt || '';
        visual.loading = 'lazy';
        visual.decoding = 'async';
        visual.width = 240;
        visual.height = 240;
        visual.addEventListener('error', () => { visual.remove(); link.classList.remove('news-pulse__link--thumb'); }, { once: true });
    } else {
        visual = null;
    }
    const body = createElement('span', 'news-pulse__body');
    const title = createElement('span', 'news-pulse__title', item.title);
    const summary = createElement('span', 'news-pulse__summary', item.summary);
    const source = createElement('span', 'news-pulse__source', `${localeText('newsPulse.source', {}, locale)}: ${item.source}`);

    if (item.category) body.append(createElement('span', 'news-pulse__meta', item.category));
    body.append(title);
    if (item.summary) body.append(summary);
    if (item.source) body.append(source);
    if (visual) link.append(visual);
    link.append(body);
    return link;
}

function desktopIndicatorLabel(index, total, locale) {
    return locale === 'de'
        ? `Nachricht ${index + 1} von ${total} anzeigen`
        : `Show news item ${index + 1} of ${total}`;
}

function createDesktopSlide(item, locale, index, isActive) {
    const slide = createElement('div', `news-pulse__slide${isActive ? ' is-active' : ''}`);
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${index + 1}`);
    slide.dataset.newsPulseItemId = item.id;
    slide.dataset.newsPulseRenderIndex = String(index);
    if (!isActive) slide.setAttribute('aria-hidden', 'true');

    const link = createPulseLink(item, locale, { allowThumbnail: true });
    if (!isActive) link.tabIndex = -1;
    slide.appendChild(link);
    return slide;
}

function createDesktopIndicatorButton(index, total, locale, isActive) {
    const button = createElement('button', `news-pulse__indicator-button${isActive ? ' is-active' : ''}`);
    button.type = 'button';
    button.dataset.newsPulseIndicator = String(index);
    button.setAttribute('aria-label', desktopIndicatorLabel(index, total, locale));
    if (isActive) button.setAttribute('aria-current', 'true');
    return button;
}

function renderDesktopNewsPulse(root, items, locale, onIndicatorSelect) {
    const visualItems = items;
    if (!visualItems.length) {
        clearNewsPulse(root);
        return;
    }

    root.classList.remove('is-loading', 'is-empty', 'is-disabled', 'news-pulse--mobile');
    root.classList.add('is-ready', 'news-pulse--desktop');
    root.replaceChildren();

    const shell = createElement('div', 'news-pulse__shell news-pulse__shell--hero');
    const label = createElement('span', 'news-pulse__label', localeText('newsPulse.label', {}, locale));
    const viewport = createElement('div', 'news-pulse__viewport');
    viewport.setAttribute('aria-live', 'off');
    const track = createElement('div', 'news-pulse__slides');
    track.style.setProperty('--news-pulse-active-index', '0');
    visualItems.forEach((item, index) => {
        track.appendChild(createDesktopSlide(item, locale, index, index === 0));
    });
    viewport.appendChild(track);

    const indicators = createElement('div', 'news-pulse__indicators');
    indicators.setAttribute('aria-label', localeText('newsPulse.label', {}, locale));
    visualItems.forEach((_, index) => {
        const button = createDesktopIndicatorButton(index, visualItems.length, locale, index === 0);
        button.addEventListener('click', () => onIndicatorSelect(index));
        indicators.appendChild(button);
    });

    shell.append(label, viewport, indicators);
    root.appendChild(shell);
    root.dataset.newsPulseActiveIndex = '0';
    root.dataset.newsPulseItemCount = String(visualItems.length);
}

function setDesktopActiveItem(root, nextIndex) {
    const slides = [...root.querySelectorAll('.news-pulse__slide')];
    if (!slides.length) return 0;
    const normalizedIndex = ((nextIndex % slides.length) + slides.length) % slides.length;
    const track = root.querySelector('.news-pulse__slides');
    if (track) {
        track.style.setProperty('--news-pulse-active-index', String(normalizedIndex));
    }
    slides.forEach((slide, index) => {
        const isActive = index === normalizedIndex;
        slide.classList.toggle('is-active', isActive);
        slide.toggleAttribute('aria-hidden', !isActive);
        const link = slide.querySelector('a[href]');
        if (link) link.tabIndex = isActive ? 0 : -1;
    });
    root.querySelectorAll('.news-pulse__indicator-button').forEach((button, index) => {
        const isActive = index === normalizedIndex;
        button.classList.toggle('is-active', isActive);
        if (isActive) {
            button.setAttribute('aria-current', 'true');
        } else {
            button.removeAttribute('aria-current');
        }
    });
    root.dataset.newsPulseActiveIndex = String(normalizedIndex);
    return normalizedIndex;
}

function clearNewsPulse(root) {
    root.classList.remove('is-loading', 'is-ready', 'is-empty', 'news-pulse--desktop', 'news-pulse--mobile');
    root.classList.add('is-disabled');
    root.setAttribute('aria-hidden', 'true');
    root.replaceChildren();
}

function isVisibleElement(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function parseCssLengthToPixels(value, fallback = 0, context = document.documentElement) {
    const raw = String(value || '').trim();
    if (!raw || raw === 'auto') return fallback;
    const numeric = Number.parseFloat(raw);
    if (!Number.isFinite(numeric)) return fallback;
    if (raw.endsWith('px') || /^-?\d+(\.\d+)?$/.test(raw)) return numeric;
    const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    if (raw.endsWith('rem')) return numeric * rootFontSize;
    if (raw.endsWith('em')) {
        const contextFontSize = Number.parseFloat(window.getComputedStyle(context).fontSize) || rootFontSize;
        return numeric * contextFontSize;
    }
    if (raw.endsWith('vh')) return (numeric / 100) * (window.innerHeight || document.documentElement.clientHeight || 0);
    if (raw.endsWith('vw')) return (numeric / 100) * (window.innerWidth || document.documentElement.clientWidth || 0);
    return fallback;
}

function getStableScrollBoundary(hero, heroRect) {
    const scrollHint = hero?.querySelector('.hero__scroll-hint');
    if (!hero || !heroRect || !isVisibleElement(scrollHint)) return null;
    const heroStyle = window.getComputedStyle(hero);
    const hintStyle = window.getComputedStyle(scrollHint);
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const fallbackBottom = Math.min(Math.max(viewportHeight * 0.0145, 10), 16);
    const bottomOffset = parseCssLengthToPixels(
        hintStyle.insetBlockEnd || hintStyle.bottom || heroStyle.getPropertyValue('--homepage-hero-scroll-bottom'),
        parseCssLengthToPixels(heroStyle.getPropertyValue('--homepage-hero-scroll-bottom'), fallbackBottom, hero),
        scrollHint,
    );
    const hintRect = scrollHint.getBoundingClientRect();
    const stableTop = heroRect.bottom - bottomOffset - hintRect.height;
    return Number.isFinite(stableTop) ? stableTop : null;
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

function canRenderForAuthenticatedUser(getAuthState) {
    const authState = readAuthState(getAuthState);
    return authState.ready && authState.loggedIn;
}

// Keep the established lower edge; grow upward only into the actual free column.
// Measure neighbours, never the hidden feed. Re-entry has a small hysteresis.
function placeNewsPulse(root) {
    const hero = root.closest('.hero--homepage');
    const rect = element => isVisibleElement(element) ? element.getBoundingClientRect() : null;
    const area = hero?.getBoundingClientRect();
    if (!area) return;
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const gutter = 1.5 * rem;
    const gap = 0.5 * rem;
    const left = rect(hero.querySelector('.hero__models-cta-wrap--left'));
    const right = rect(hero.querySelector('.hero__models-cta-wrap--right'));
    const content = rect(hero.querySelector('.hero__content'));
    const labels = [...hero.querySelectorAll('.latest-models-video-module__label')].map(rect).filter(Boolean);
    const cookie = rect(document.querySelector('#cookieBanner .cookie-banner__card'));
    const viewport = window.visualViewport;
    const x0 = Math.max(area.left, left?.right || area.left) + gutter;
    const x1 = Math.min(area.right, right?.left || area.right, viewport?.width || innerWidth) - gutter;
    const previousTop = Math.max(area.top, left?.bottom || 0, right?.bottom || 0, content?.bottom || 0, ...labels.map(r => r.bottom)) + gutter;
    // Reserve additional space for the existing floating scroll-hint animation.
    const y1 = Math.min(area.bottom, getStableScrollBoundary(hero, area) - 8,
        (viewport?.height || innerHeight) + (viewport?.offsetTop || 0), cookie?.top || Infinity) - gutter;
    const width = Math.min(60 * rem, x1 - x0);
    const columnLeft = x0 + (x1 - x0 - width) / 2;
    const neighbours = [left, right, content, ...labels].filter(Boolean);
    const y0 = Math.max(area.top, ...neighbours
        .filter(r => r.right + gap > columnLeft && r.left - gap < columnLeft + width)
        .map(r => r.bottom)) + gap;
    // This is the former centred 17rem panel's bottom, including its scroll/cookie
    // clearance. It is an anchor only, not a second upper obstacle or fit gate.
    const bottom = y1 - Math.max(0, (y1 - previousTop - 17 * rem) / 2);
    const height = Math.min(24 * rem, bottom - y0);
    const extra = root.dataset.newsPulseFits === 'true' ? 0 : 0.25 * rem;
    const fits = width >= 25 * rem + extra && height >= 11 * rem + extra;
    root.classList.toggle('news-pulse--compact', height < 15 * rem);
    root.dataset.newsPulseFits = String(fits);
    root.dataset.newsPulseGap = String(gap);
    root.inert = !fits || !root.classList.contains('is-ready');
    root.setAttribute('aria-hidden', String(root.inert));
    if (!fits) return;
    const properties = {left: columnLeft - area.left,
        top: bottom - height - area.top, width, height};
    for (const [key, value] of Object.entries(properties)) root.style.setProperty(`--news-${key}`, `${value}px`);
}

export async function initNewsPulse(container = document, { getAuthState } = {}) {
    await Promise.all([...container.querySelectorAll('[data-news-pulse]')].map(async root => {
        if (root.dataset.newsPulseInitialized) return;
        root.dataset.newsPulseInitialized = 'true';
        root.inert = true;
        root.setAttribute('aria-hidden', 'true');
        const hero = root.closest('.hero--homepage');
        const desktop = matchMedia('(min-width: 1024px)');
        const cache = new Map();
        let frame = 0, request = null, disposed = false, selectedId = null;
        const schedule = () => {
            if (disposed || frame) return;
            frame = requestAnimationFrame(() => { frame = 0; placeNewsPulse(root); });
        };
        const select = index => {
            setDesktopActiveItem(root, index);
            selectedId = root.querySelector('.news-pulse__slide.is-active')?.dataset.newsPulseItemId;
            schedule();
        };
        const load = async () => {
            if (disposed) return;
            if (!canRenderForAuthenticatedUser(getAuthState)) {
                request?.abort(); request = null; clearNewsPulse(root); root.inert = true; return;
            }
            const surface = desktop.matches ? 'desktop' : 'mobile';
            const locale = normalizeLocale(root.dataset.newsPulseLocale || getCurrentLocale());
            const key = `${locale}:${surface}`;
            request?.abort();
            const controller = new AbortController(); request = controller;
            try {
                const data = cache.get(key) || await fetchNewsPulse(locale, surface, controller.signal);
                if (disposed || controller.signal.aborted || !canRenderForAuthenticatedUser(getAuthState)) return;
                cache.set(key, data);
                if (data.enabled === false || !data.items.length) clearNewsPulse(root);
                else {
                    renderDesktopNewsPulse(root, data.items, locale, select);
                    const retained = data.items.findIndex(item => item.id === selectedId);
                    if (retained >= 0) setDesktopActiveItem(root, retained);
                }
                placeNewsPulse(root);
            } catch {
                if (!controller.signal.aborted) { clearNewsPulse(root); root.inert = true; }
            } finally { if (request === controller) request = null; }
        };
        const observer = new ResizeObserver(schedule);
        [hero, ...hero.querySelectorAll('.hero__models-cta-wrap, .latest-models-video-module__label, .hero__content, .hero__scroll-hint')]
            .forEach(el => observer.observe(el));
        const changes = new MutationObserver(() => {
            if (!root.isConnected) { dispose(); return; }
            const cookie = document.querySelector('#cookieBanner .cookie-banner__card');
            if (cookie) observer.observe(cookie);
            schedule();
        });
        // Root child changes cover delayed images; body children cover cookie dismissal.
        changes.observe(document.body, { childList: true });
        changes.observe(root, { childList: true, subtree: true });
        const events = [[window, 'resize', schedule], [window, 'orientationchange', schedule],
            [window, 'bitbi:homepage-hero-scale', schedule], [window, 'pageshow', schedule],
            [document, 'bitbi:auth-change', load], [document.fonts, 'loadingdone', schedule],
            [window.visualViewport, 'resize', schedule]];
        events.forEach(([target, event, handler]) => target?.addEventListener(event, handler));
        desktop.addEventListener('change', load);
        root.addEventListener('load', schedule, true);
        document.fonts?.ready.then(schedule);
        function dispose() {
            disposed = true; request?.abort(); cancelAnimationFrame(frame); observer.disconnect(); changes.disconnect();
            events.forEach(([target, event, handler]) => target?.removeEventListener(event, handler));
            desktop.removeEventListener('change', load); root.removeEventListener('load', schedule, true);
        }
        await load();
    }));
}
