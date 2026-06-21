import { getCurrentLocale, localeText } from './locale.js?v=__ASSET_VERSION__';

const NEWS_PULSE_ENDPOINT = '/api/public/news-pulse';
const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const MAX_SOURCE_ITEMS = 6;
const MAX_VISUAL_ITEMS = 8;
const MIN_WHEEL_DURATION_SECONDS = 32.49;
const MAX_WHEEL_DURATION_SECONDS = 48.735;
const WHEEL_DURATION_SECONDS_PER_SOURCE_ITEM = 8.037;
const NEWS_ITEM_DISPLAY_MS = 5000;
const NEWS_SWITCH_SLOWDOWN_FACTOR = 1.21;
const NEWS_PULSE_VERTICAL_OFFSET_FACTOR = 1.1;
const MOBILE_FRAME_MIN_REM = 5.25;
const MOBILE_FRAME_MAX_REM = 6.25;
const DESKTOP_NEWS_INTERVAL_MS = NEWS_ITEM_DISPLAY_MS;
const DESKTOP_TRANSITION_MS = 450 * NEWS_SWITCH_SLOWDOWN_FACTOR;
const MOBILE_INTERVAL_MS = NEWS_ITEM_DISPLAY_MS;
const MOBILE_ANIMATION_MS = 1404 * NEWS_SWITCH_SLOWDOWN_FACTOR;
const MOBILE_TOP_RATIO = 0.055;
const MOBILE_BOTTOM_RATIO = 0.955;
const DESKTOP_PLACEMENT_MIN_GAP = 14;
const DESKTOP_PLACEMENT_MIN_HEIGHT = 82;
const DESKTOP_PLACEMENT_UPDATE_TOLERANCE_PX = 2;

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
    if (!url || !title || !summary || !source) return null;
    const visualThumbUrl = String(item?.visual_type || '').trim().toLowerCase() === 'generated'
        ? validVisualThumbUrl(item?.visual_thumb_url || item?.visual_url)
        : '';
    const normalized = {
        id: String(item?.id || url).slice(0, 96),
        title: title.slice(0, 160),
        summary: summary.slice(0, 220),
        source: source.slice(0, 80),
        category: String(item?.category || 'AI').replace(/\s+/g, ' ').trim().slice(0, 48),
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

async function fetchNewsPulse(locale, surface = 'desktop') {
    const params = new URLSearchParams();
    params.set('locale', locale);
    params.set('surface', surface === 'mobile' ? 'mobile' : 'desktop');
    const response = await fetch(`${NEWS_PULSE_ENDPOINT}?${params}`, {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
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
        visual.width = 48;
        visual.height = 48;
    } else {
        visual = createElement('span', 'news-pulse__mark');
        visual.setAttribute('aria-hidden', 'true');
    }
    const body = createElement('span', 'news-pulse__body');
    const title = createElement('span', 'news-pulse__title', item.title);
    const summary = createElement('span', 'news-pulse__summary', item.summary);
    const source = createElement('span', 'news-pulse__source', `${localeText('newsPulse.source', {}, locale)}: ${item.source}`);

    body.append(title, summary, source);
    link.append(visual, body);
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

    const link = createPulseLink(item, locale, { isDuplicate, allowThumbnail: true });
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

function createMobileCubeFace(item, locale, face) {
    const faceElement = createElement('span', `news-pulse__mobile-cube-face news-pulse__mobile-cube-face--${face}`);
    faceElement.setAttribute('aria-hidden', 'true');
    faceElement.appendChild(createMobilePulseItem(item, locale, face));
    return faceElement;
}

function createMobileCubeTransition(currentItem, nextItem, locale) {
    const scene = createElement('div', 'news-pulse__mobile-cube-scene');
    const cube = createElement('div', 'news-pulse__mobile-cube is-turning');
    cube.append(
        createMobileCubeFace(currentItem, locale, 'front'),
        createMobileCubeFace(nextItem, locale, 'right'),
    );
    scene.appendChild(cube);
    return scene;
}

function buildVisualItems(items) {
    return uniqueNewsItems(items).slice(0, MAX_VISUAL_ITEMS);
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
    const visualItems = buildVisualItems(items);
    if (!visualItems.length) {
        renderEmpty(root, locale);
        return;
    }

    root.classList.remove('is-loading', 'is-empty', 'is-disabled', 'news-pulse--mobile');
    root.classList.add('is-ready', 'news-pulse--desktop');
    root.style.setProperty('--news-pulse-desktop-transition-ms', `${DESKTOP_TRANSITION_MS}ms`);
    root.removeAttribute('aria-hidden');
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

function renderEmpty(root, locale) {
    root.classList.remove('is-loading', 'is-ready');
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

    const rangeTop = headerRect.bottom + (distance * MOBILE_TOP_RATIO);
    const rangeBottom = headerRect.bottom + (distance * MOBILE_BOTTOM_RATIO);
    const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    const compactHeight = Math.min(
        Math.max(MOBILE_FRAME_MIN_REM * rootFontSize, window.innerHeight * 0.11),
        MOBILE_FRAME_MAX_REM * rootFontSize,
        Math.max(0, rangeBottom - rangeTop),
    );
    const center = rangeTop + ((rangeBottom - rangeTop) / 2);
    const top = center - (compactHeight / 2);
    const bottom = center + (compactHeight / 2);
    root.style.setProperty('--news-pulse-mobile-top', `${Math.max(0, top - heroRect.top)}px`);
    root.style.setProperty('--news-pulse-mobile-height', `${Math.max(0, bottom - top)}px`);
    const rootRect = root.getBoundingClientRect();
    if (rootRect.width > 0) {
        root.style.setProperty('--news-pulse-cube-depth', `${Math.max(1, (rootRect.width - 8) / 2)}px`);
    }
    root.dataset.newsPulseMobilePlacement = 'ready';
    return true;
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

function getDesktopFallbackHeight(rootFontSize) {
    return Math.min(Math.max(5.75 * rootFontSize, window.innerHeight * 0.1), 6.75 * rootFontSize);
}

function getDesktopContentMinimumHeight(root) {
    const rootStyle = window.getComputedStyle(root);
    const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    const thumbSize = parseCssLengthToPixels(
        rootStyle.getPropertyValue('--news-pulse-thumb-size'),
        3.96 * rootFontSize,
        root,
    );
    const shell = root.querySelector('.news-pulse__shell--hero');
    const shellStyle = shell ? window.getComputedStyle(shell) : null;
    const paddingBlock = shellStyle
        ? parseCssLengthToPixels(shellStyle.paddingBlockStart, 0, shell)
            + parseCssLengthToPixels(shellStyle.paddingBlockEnd, 0, shell)
        : rootFontSize * 1.45;
    const shellGap = shellStyle
        ? parseCssLengthToPixels(shellStyle.rowGap || shellStyle.gap, rootFontSize * 0.46, shell)
        : rootFontSize * 0.46;
    const indicator = root.querySelector('.news-pulse__indicators');
    const indicatorRect = indicator?.getBoundingClientRect();
    const indicatorHeight = indicatorRect && indicatorRect.height > 0 ? indicatorRect.height : rootFontSize * 0.28;
    return Math.max(DESKTOP_PLACEMENT_MIN_HEIGHT, thumbSize + paddingBlock + shellGap + indicatorHeight);
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

function setPixelPropertyIfChanged(element, property, nextValue) {
    const previousValue = parseCssLengthToPixels(element.style.getPropertyValue(property), NaN, element);
    if (Number.isFinite(previousValue)
        && Math.abs(previousValue - nextValue) <= DESKTOP_PLACEMENT_UPDATE_TOLERANCE_PX) {
        return false;
    }
    element.style.setProperty(property, `${nextValue.toFixed(2)}px`);
    return true;
}

function updateDesktopPlacement(root) {
    const hero = root.closest('.hero--homepage') || root.closest('#hero');
    const labels = [...(hero?.querySelectorAll('.latest-models-video-module__label') || [])]
        .filter(isVisibleElement)
        .map((element) => element.getBoundingClientRect());
    if (!hero || !labels.length) return false;

    const heroRect = hero.getBoundingClientRect();
    const heroStyle = window.getComputedStyle(hero);
    const labelBottom = Math.max(...labels.map((rect) => rect.bottom));
    const scrollTop = getStableScrollBoundary(hero, heroRect);
    if (!Number.isFinite(scrollTop)) return false;
    const available = scrollTop - labelBottom;
    if (!Number.isFinite(available) || available <= DESKTOP_PLACEMENT_MIN_HEIGHT) return false;

    const minGap = Math.max(DESKTOP_PLACEMENT_MIN_GAP, Math.min(22, window.innerHeight * 0.015));
    const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    const preferredHeight = parseCssLengthToPixels(heroStyle.getPropertyValue('--homepage-hero-news-height'), NaN, hero);
    const fallbackHeight = getDesktopFallbackHeight(rootFontSize);
    const contentMinimumHeight = getDesktopContentMinimumHeight(root);
    const currentHeight = Math.max(
        contentMinimumHeight,
        hero.dataset.homepageHeroLargeScale === 'true' && Number.isFinite(preferredHeight) && preferredHeight > 0
            ? preferredHeight
            : fallbackHeight,
    );
    const maxHeight = Math.max(DESKTOP_PLACEMENT_MIN_HEIGHT, available - (minGap * 2));
    const height = Math.min(currentHeight, maxHeight);
    const centeredTop = labelBottom + ((available - height) / 2);
    const minTop = labelBottom + minGap;
    const maxTop = scrollTop - height - minGap;
    const top = Math.min(Math.max(centeredTop, minTop), Math.max(minTop, maxTop));

    const topOffset = Math.max(0, top - heroRect.top);
    const shiftedTopOffset = Math.min(
        topOffset * NEWS_PULSE_VERTICAL_OFFSET_FACTOR,
        Math.max(0, maxTop - heroRect.top),
    );

    setPixelPropertyIfChanged(root, '--news-pulse-hero-top', shiftedTopOffset);
    setPixelPropertyIfChanged(root, '--news-pulse-hero-height', Math.max(DESKTOP_PLACEMENT_MIN_HEIGHT, height));
    root.dataset.newsPulseHeroPlacement = 'ready';
    root.dataset.newsPulseHeroLabelBottom = String(Math.round((labelBottom - heroRect.top) * 100) / 100);
    root.dataset.newsPulseHeroScrollTop = String(Math.round((scrollTop - heroRect.top) * 100) / 100);
    root.dataset.newsPulseHeroBoundary = 'stable-scroll-hint';
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

function canRenderForAuthenticatedUser(getAuthState) {
    const authState = readAuthState(getAuthState);
    return authState.ready && authState.loggedIn;
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
        let desktopIndex = 0;
        let desktopTimer = 0;
        let desktopPlacementFrame = 0;
        let disconnectObserver = null;
        let desktopResizeObserver = null;

        const clearDesktopTimer = () => {
            if (desktopTimer) {
                window.clearInterval(desktopTimer);
                desktopTimer = 0;
            }
        };

        const clearDesktopPlacement = () => {
            if (desktopPlacementFrame) {
                window.cancelAnimationFrame(desktopPlacementFrame);
                desktopPlacementFrame = 0;
            }
        };

        const clearDesktopState = () => {
            clearDesktopTimer();
            clearDesktopPlacement();
            delete root.dataset.newsPulseHeroPlacement;
            delete root.dataset.newsPulseHeroLabelBottom;
            delete root.dataset.newsPulseHeroScrollTop;
            delete root.dataset.newsPulseHeroBoundary;
            delete root.dataset.newsPulseActiveIndex;
            delete root.dataset.newsPulseItemCount;
        };

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

        const scheduleDesktopPlacement = () => {
            if (mode !== 'desktop' || !desktopQuery.matches) return;
            if (desktopPlacementFrame) window.cancelAnimationFrame(desktopPlacementFrame);
            desktopPlacementFrame = window.requestAnimationFrame(() => {
                desktopPlacementFrame = window.requestAnimationFrame(() => {
                    desktopPlacementFrame = 0;
                    updateDesktopPlacement(root);
                });
            });
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
            hasRenderedDesktop = false;
            fetchToken += 1;
            clearMobileTimers();
            clearDesktopState();
            clearNewsPulse(root);
        };

        const showDesktopItem = (nextIndex, { resetTimer = false } = {}) => {
            desktopIndex = setDesktopActiveItem(root, nextIndex);
            scheduleDesktopPlacement();
            if (resetTimer) {
                clearDesktopTimer();
                startDesktopTimer();
            }
        };

        function startDesktopTimer() {
            clearDesktopTimer();
            const count = Number.parseInt(root.dataset.newsPulseItemCount || '0', 10);
            if (count <= 1) return;
            desktopTimer = window.setInterval(() => {
                if (!root.isConnected || mode !== 'desktop') {
                    clearDesktopTimer();
                    return;
                }
                if (document.hidden) return;
                showDesktopItem(desktopIndex + 1);
            }, DESKTOP_NEWS_INTERVAL_MS);
        }

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
            viewport.replaceChildren(createMobileCubeTransition(currentItem, nextItem, locale));
            scheduleMobilePlacement();
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
            clearDesktopState();
            root.classList.remove('is-loading', 'is-empty', 'is-disabled', 'news-pulse--desktop');
            root.classList.add('is-ready', 'news-pulse--mobile');
            root.setAttribute('aria-label', localeText('newsPulse.label', {}, locale));
            root.style.setProperty('--news-pulse-mobile-rotation-duration', `${MOBILE_ANIMATION_MS}ms`);
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
            clearDesktopState();
            clearMobileTimers();
            root.classList.remove('is-disabled', 'news-pulse--desktop');
            root.classList.add('news-pulse--mobile');
            root.setAttribute('aria-label', localeText('newsPulse.label', {}, locale));
            root.removeAttribute('aria-hidden');
            renderEmpty(root, locale);
            scheduleMobilePlacement();
        };

        const renderDesktop = async () => {
            if (!canRenderForAuthenticatedUser(getAuthState)) {
                clearForDisabledState();
                return;
            }

            clearMobileTimers();
            mode = 'desktop';
            root.classList.remove('news-pulse--mobile');
            root.classList.add('news-pulse--desktop');
            if (hasRenderedDesktop) {
                scheduleDesktopPlacement();
                return;
            }
            hasRenderedDesktop = true;

            const locale = normalizeLocale(root.dataset.newsPulseLocale || getCurrentLocale());
            root.dataset.newsPulseLocale = locale;
            root.setAttribute('aria-label', localeText('newsPulse.label', {}, locale));
            root.removeAttribute('aria-hidden');
            root.classList.remove('is-disabled');
            root.classList.add('is-loading');
            root.replaceChildren();
            clearDesktopTimer();
            try {
                const result = await fetchNewsPulse(locale, 'desktop');
                if (!canRenderForAuthenticatedUser(getAuthState) || !desktopQuery.matches) {
                    clearForDisabledState();
                    return;
                }
                if (result.enabled === false) {
                    hasRenderedDesktop = false;
                    clearForDisabledState();
                    return;
                }
                renderDesktopNewsPulse(root, result.items, locale, (index) => {
                    showDesktopItem(index, { resetTimer: true });
                });
                desktopIndex = 0;
                scheduleDesktopPlacement();
                startDesktopTimer();
            } catch {
                renderEmpty(root, locale);
                scheduleDesktopPlacement();
            }
        };

        const renderMobile = async () => {
            const locale = normalizeLocale(root.dataset.newsPulseLocale || getCurrentLocale());
            root.dataset.newsPulseLocale = locale;
            clearDesktopState();
            if (!canRenderForAuthenticatedUser(getAuthState)) {
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
                const result = await fetchNewsPulse(locale, 'mobile');
                if (token !== fetchToken || mode !== 'mobile') return;
                if (result.enabled === false) {
                    clearForDisabledState();
                    return;
                }
                if (!canRenderForAuthenticatedUser(getAuthState) || desktopQuery.matches) {
                    clearForDisabledState();
                    return;
                }
                const items = result.items;
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

        const scheduleActivePlacement = () => {
            scheduleDesktopPlacement();
            scheduleMobilePlacement();
        };

        if (typeof desktopQuery.addEventListener === 'function') {
            desktopQuery.addEventListener('change', handleViewportChange);
        } else if (typeof desktopQuery.addListener === 'function') {
            desktopQuery.addListener(handleViewportChange);
        }

        window.addEventListener('resize', scheduleActivePlacement, { passive: true });
        window.addEventListener('orientationchange', scheduleActivePlacement, { passive: true });
        window.addEventListener('bitbi:homepage-hero-scale', scheduleActivePlacement, { passive: true });
        window.addEventListener('load', scheduleActivePlacement, { once: true });
        document.fonts?.ready?.then(scheduleActivePlacement).catch(() => {});
        const heroLogo = root.closest('#hero')?.querySelector('.hero__title-img');
        if (heroLogo && !heroLogo.complete) {
            heroLogo.addEventListener('load', scheduleActivePlacement, { once: true });
        }
        if (window.ResizeObserver) {
            desktopResizeObserver = new ResizeObserver(scheduleActivePlacement);
            const hero = root.closest('#hero');
            if (hero) desktopResizeObserver.observe(hero);
            desktopResizeObserver.observe(root);
            hero?.querySelectorAll('.latest-models-video-module__label, .hero__scroll-hint, .hero__scroll-text')
                .forEach((element) => desktopResizeObserver.observe(element));
        }
        document.addEventListener('bitbi:auth-change', renderForViewport);
        if (window.MutationObserver) {
            disconnectObserver = new MutationObserver(() => {
                if (!root.isConnected) {
                    clearMobileTimers();
                    clearDesktopState();
                    desktopResizeObserver?.disconnect();
                    desktopResizeObserver = null;
                    disconnectObserver?.disconnect();
                    disconnectObserver = null;
                }
            });
            disconnectObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
        await renderForViewport();
    }));
}
