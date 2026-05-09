import { getCurrentLocale, localeText } from './locale.js?v=__ASSET_VERSION__';

const NEWS_PULSE_ENDPOINT = '/api/public/news-pulse';
const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';
const MAX_SOURCE_ITEMS = 6;
const MIN_VISUAL_ITEMS = 7;
const MAX_VISUAL_ITEMS = 8;
const MIN_WHEEL_DURATION_SECONDS = 38;
const MAX_WHEEL_DURATION_SECONDS = 57;
const WHEEL_DURATION_SECONDS_PER_SOURCE_ITEM = 9.4;

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
    root.classList.remove('is-loading', 'is-ready', 'is-empty');
    root.classList.add('is-disabled');
    root.setAttribute('aria-hidden', 'true');
    root.replaceChildren();
}

export async function initNewsPulse(container = document) {
    const roots = [...container.querySelectorAll('[data-news-pulse]')];
    const desktopQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);

    await Promise.all(roots.map(async (root) => {
        let hasRendered = false;

        const renderForViewport = async () => {
            if (!desktopQuery.matches) {
                clearNewsPulse(root);
                return;
            }
            if (hasRendered) return;
            hasRendered = true;

            const locale = normalizeLocale(root.dataset.newsPulseLocale || getCurrentLocale());
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

        const handleViewportChange = () => {
            if (!desktopQuery.matches) {
                clearNewsPulse(root);
            } else {
                hasRendered = false;
                renderForViewport();
            }
        };

        if (typeof desktopQuery.addEventListener === 'function') {
            desktopQuery.addEventListener('change', handleViewportChange);
        } else if (typeof desktopQuery.addListener === 'function') {
            desktopQuery.addListener(handleViewportChange);
        }
        await renderForViewport();
    }));
}
