import { getCurrentLocale, localeText } from './locale.js?v=__ASSET_VERSION__';

const NEWS_PULSE_ENDPOINT = '/api/public/news-pulse';
const MAX_RENDERED_ITEMS = 6;

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
        .slice(0, MAX_RENDERED_ITEMS);
}

function createElement(tagName, className, text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function createPulseItem(item, locale, { decorative = false } = {}) {
    const wrapper = createElement('span', 'news-pulse__item');
    if (!decorative) wrapper.setAttribute('role', 'listitem');

    const link = createElement('a', 'news-pulse__link');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `${item.title} - ${localeText('newsPulse.openSource', {}, locale)}`);
    if (decorative) {
        link.tabIndex = -1;
        link.setAttribute('aria-hidden', 'true');
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

function renderTrack(items, locale, { reverse = false, decorative = false } = {}) {
    const track = createElement('div', `news-pulse__track${reverse ? ' news-pulse__track--reverse' : ''}`);
    if (decorative) {
        track.setAttribute('aria-hidden', 'true');
    } else {
        track.setAttribute('role', 'list');
    }

    const ordered = reverse ? [...items].reverse() : items;
    const repeated = [...ordered, ...ordered];
    repeated.forEach((item, index) => {
        track.appendChild(createPulseItem(item, locale, {
            decorative: decorative || index >= ordered.length,
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

    flow.append(
        renderTrack(items, locale),
        renderTrack(items, locale, { reverse: true, decorative: true }),
    );
    shell.append(label, flow);
    root.appendChild(shell);
}

export async function initNewsPulse(container = document) {
    const roots = [...container.querySelectorAll('[data-news-pulse]')];
    await Promise.all(roots.map(async (root) => {
        const locale = normalizeLocale(root.dataset.newsPulseLocale || getCurrentLocale());
        root.setAttribute('aria-label', localeText('newsPulse.label', {}, locale));
        root.classList.add('is-loading');
        try {
            renderNewsPulse(root, await fetchNewsPulse(locale), locale);
        } catch {
            renderEmpty(root, locale);
        }
    }));
}
