import { apiAdminNewsPulseListItems, apiAdminNewsPulseGetItem } from '../../shared/auth-api.js?v=__ASSET_VERSION__';

const text = value => typeof value === 'string' ? value : '';
function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
}
function dateLabel(value) {
    if (!value) return 'Not provided';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Invalid supplied timestamp' : `${date.toISOString().replace('T', ' ').replace('.000Z', ' UTC')}`;
}
function sourceUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
}
function thumbnail(item) {
    // Only the supplied, same-origin, item-bound protected image route is used.
    // Public URLs do not establish an original/AI variant or permission to load it.
    try {
        const raw = text(item.admin_thumb_url);
        if (!raw || /[\u0000-\u0020\u007f\\]/.test(raw)) return '';
        const url = new URL(raw, location.origin);
        return url.origin === location.origin && !url.search && !url.hash && !url.username && !url.password
            && url.pathname === `/api/admin/news-pulse/thumbs/${encodeURIComponent(item.id)}` ? url.href : '';
    } catch { return ''; }
}
function field(list, label, value) {
    list.append(el('dt', '', label), el('dd', '', value === undefined || value === null || value === '' ? 'Not provided' : String(value)));
}

export function createAdminNewsfeed() {
    const root = document.getElementById('sectionNewsfeed');
    let active = false, generation = 0, lifecycle, request, items = [], cursor = null, hasMore = false;
    let grid, message, count, more, refresh, search, locale, status;
    const detailsRequests = new Set();
    const filters = { locale: 'all', status: 'all' };

    function dispose() {
        active = false; generation += 1;
        request?.abort(); lifecycle?.abort();
        for (const controller of detailsRequests) controller.abort();
        detailsRequests.clear(); items = []; cursor = null; hasMore = false;
        root.querySelectorAll('img').forEach(img => img.removeAttribute('src'));
        root.replaceChildren();
    }
    function listen(node, name, handler) { node.addEventListener(name, handler, { signal: lifecycle.signal }); }
    function notice(value, error = false) {
        message.textContent = value; message.setAttribute('role', error ? 'alert' : 'status');
        message.dataset.error = String(error);
    }
    function denied() {
        dispose();
        const warning = el('div', 'admin-reader__notice', 'News access could not be authorized. Reload to check your admin session and MFA.');
        warning.setAttribute('role', 'alert');
        const reload = el('a', 'btn-action', 'Reload admin'); reload.href = '/admin/index.html#newsfeed';
        root.append(warning, reload);
    }
    function image(item, large = false) {
        const figure = el('figure', `admin-reader__image${large ? ' admin-reader__image--large' : ''}`);
        const url = thumbnail(item);
        if (!url) {
            figure.append(el('span', 'admin-reader__placeholder', item.admin_thumb_url ? 'Image reference cannot be verified' : 'No image reference provided'));
            return figure;
        }
        const img = el('img'); img.alt = `Stored news preview: ${text(item.title) || 'Untitled article'}`;
        img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
        const state = el('span', 'admin-reader__placeholder', 'Loading image…');
        listen(img, 'load', () => { state.hidden = true; });
        listen(img, 'error', () => { img.hidden = true; state.hidden = false; state.textContent = 'Image failed to load. Refresh to try again.'; });
        img.src = url; figure.append(img, state); return figure;
    }
    function detailBody(item) {
        const body = el('div', 'admin-reader__detail-body');
        const link = sourceUrl(item.url);
        if (link) {
            const a = el('a', 'admin-reader__source-link', 'Read at source ↗');
            a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer'; body.append(a);
        } else body.append(el('p', 'admin-reader__muted', item.url ? 'Source link cannot be verified.' : 'Source link not provided.'));
        body.append(el('p', 'admin-reader__muted', 'Only the stored summary is available. Full article text and original/source image variants are not supplied by this API.'));
        const media = el('details', 'admin-reader__enlarge');
        media.append(el('summary', '', 'Image & provenance'));
        // An enlarged image is requested only on explicit inspection.
        listen(media, 'toggle', () => {
            if (media.open && media.children.length === 1) {
                media.append(image(item, true));
                const provenance = el('dl', 'admin-reader__metadata');
                field(provenance, 'Stored visual type', item.visual_type);
                field(provenance, 'Visual status', item.visual_status);
                field(provenance, 'Image identity', item.visual_type === 'generated'
                    ? 'Generated preview, as recorded by the API. No separate original or AI variant is supplied.'
                    : 'Stored preview. Image origin cannot be independently verified.');
                field(provenance, 'Generated at', dateLabel(item.visual_generated_at));
                field(provenance, 'Attempts recorded', item.visual_attempts);
                field(provenance, 'Visual error', item.visual_error || 'None reported');
                field(provenance, 'Prompt present', typeof item.visual_prompt_present === 'boolean' ? (item.visual_prompt_present ? 'Yes (prompt text not supplied)' : 'No') : null);
                media.append(provenance);
            }
        });
        body.append(media);
        const meta = el('dl', 'admin-reader__metadata');
        for (const [label, key] of [['Record ID','id'],['Language','locale'],['Category','category'],['Stored status','status']]) field(meta,label,item[key]);
        for (const [label,key] of [['Published','published_at'],['Created','created_at'],['Updated','updated_at'],['Expires','expires_at']]) field(meta,label,dateLabel(item[key]));
        field(meta,'Expired',typeof item.expired === 'boolean' ? (item.expired ? 'Yes' : 'No') : null);
        body.append(meta); return body;
    }
    function card(item) {
        const article = el('article', 'admin-reader__card'); article.dataset.newsId = item.id;
        article.append(image(item));
        const body = el('div', 'admin-reader__card-body');
        body.append(el('p', 'admin-reader__eyebrow', [text(item.category), text(item.locale).toUpperCase()].filter(Boolean).join(' · ')));
        if (item.admin_thumb_url && (item.visual_status !== 'ready' || item.visual_type !== 'generated')) body.append(el('p', 'admin-reader__muted', 'Stored image · Feed presentation not confirmed'));
        body.append(el('h2', '', text(item.title) || 'Headline not provided'));
        body.append(el('p', 'admin-reader__excerpt', text(item.summary) || 'Summary not provided.'));
        body.append(el('p', 'admin-reader__byline', `${text(item.source) || 'Source not provided'} · Published ${dateLabel(item.published_at)}`));
        const detail = el('details', 'admin-reader__details'), summary = el('summary', '', 'Inspect article');
        const content = el('div'); detail.append(summary, content);
        let controller = null, revision = 0;
        async function loadDetail() {
            const version = ++revision;
            controller?.abort(); controller = new AbortController(); detailsRequests.add(controller);
            const own = controller;
            content.replaceChildren(el('p', 'admin-reader__muted', 'Loading record details…'));
            const result = await apiAdminNewsPulseGetItem(item.id, { signal: own.signal });
            detailsRequests.delete(own);
            if (!active || own.signal.aborted || version !== revision || !detail.open || !detail.isConnected) return;
            if ([401,403].includes(result.status)) { denied(); return; }
            const record = result.data?.data?.item;
            if (!result.ok || result.data?.ok !== true || !record || record.id !== item.id) {
                content.replaceChildren(el('p', 'admin-reader__muted', result.status === 404 ? 'This record is no longer available.' : 'Details could not be loaded. The summary above is the last loaded version.'));
                const retry = el('button', 'btn-action', 'Retry details'); retry.type = 'button'; listen(retry,'click',loadDetail); content.append(retry); return;
            }
            content.replaceChildren(detailBody(record));
        }
        listen(detail, 'toggle', () => {
            if (detail.open) void loadDetail();
            else { revision += 1; controller?.abort(); content.replaceChildren(); }
        });
        body.append(detail); article.append(body); return article;
    }
    function render() {
        const query = search.value.trim().toLowerCase();
        const visible = items.filter(item => [item.title,item.summary,item.source,item.category].some(value => text(value).toLowerCase().includes(query)));
        // Search only hides existing cards: it does not restart images or discard detail focus/state.
        for (const article of grid.children) article.hidden = !visible.some(item => item.id === article.dataset.newsId);
        count.textContent = `${visible.length} shown · ${items.length} loaded${hasMore ? ' · More available' : ''}`;
        more.hidden = !hasMore;
        const empty = root.querySelector('[data-news-empty]');
        empty.hidden = visible.length > 0;
        empty.textContent = items.length ? 'No matches in loaded articles. Change your search or load more.' : 'No stored news matches these filters.';
    }
    async function fetchPage(append = false) {
        const token = ++generation;
        request?.abort(); request = new AbortController();
        if (!append) {
            for (const controller of detailsRequests) controller.abort();
            detailsRequests.clear(); items = []; cursor = null; hasMore = false;
            grid.replaceChildren(); count.textContent = ''; more.hidden = true;
        }
        refresh.disabled = true; more.disabled = true;
        notice(append ? 'Loading more articles…' : 'Loading stored news…');
        root.querySelector('[data-news-empty]').hidden = true;
        const usedCursor = cursor;
        const result = await apiAdminNewsPulseListItems({ ...filters, limit: 24, cursor: append ? cursor : undefined, signal: request.signal });
        if (!active || generation !== token) return;
        refresh.disabled = false; more.disabled = false;
        if ([401,403].includes(result.status)) { denied(); return; }
        const data = result.data?.data;
        if (!result.ok || result.data?.ok !== true || !data || !Array.isArray(data.items)) {
            notice(append ? 'More articles could not be loaded. Retry without changing the loaded list.' : 'News could not be loaded. Use Refresh to try again.', true);
            return;
        }
        if (data.schema_available === false) { notice('News storage is unavailable. This is not an empty feed.',true); return; }
        const valid = data.items.filter(item => item && typeof item.id === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(item.id));
        const added = valid.filter((item,i) => !items.some(existing => existing.id === item.id) && valid.findIndex(other => other.id === item.id) === i);
        items.push(...added); for (const item of added) grid.append(card(item));
        hasMore = data.has_more === true;
        cursor = typeof data.next_cursor === 'string' ? data.next_cursor : null;
        const badCursor = hasMore && (!cursor || cursor === usedCursor);
        if (badCursor) hasMore = false;
        render();
        notice(badCursor ? 'Loaded articles shown. The next page reference is unavailable; refresh to retry.'
            : valid.length !== data.items.length ? 'Partial response: records without a usable identity were omitted.'
            : `Stored news · Latest published first · Checked ${new Date().toLocaleTimeString('en-GB')}`, badCursor);
    }
    function select(label, values, value) {
        const wrapper = el('div', 'admin-reader__filter'), input = el('select');
        const caption = el('label', '', label); input.id = `newsfeed-${label.toLowerCase()}`; caption.htmlFor = input.id; wrapper.append(caption);
        for (const [v,name] of values) { const option = el('option','',name); option.value = v; input.append(option); }
        input.value = value; wrapper.append(input); return { wrapper,input };
    }
    function load() {
        dispose(); active = true; lifecycle = new AbortController();
        const toolbar = el('div','admin-reader__toolbar');
        const searchLabel = el('label','admin-reader__search','Search loaded articles'); search = el('input'); search.type = 'search'; search.placeholder = 'Headline, source or topic'; searchLabel.append(search);
        const language = select('Language',[['all','All languages'],['en','English'],['de','German']],filters.locale); locale=language.input;
        const state = select('Records',[['all','All records'],['active','Active'],['hidden','Hidden'],['expired','Expired']],filters.status); status=state.input;
        refresh = el('button','btn-action','Refresh'); refresh.type='button';
        toolbar.append(searchLabel,language.wrapper,state.wrapper,refresh);
        const info = el('div','admin-reader__info'); count = el('p','admin-reader__muted'); message=el('p','admin-reader__notice'); message.setAttribute('role','status'); info.append(count,message);
        grid=el('div','admin-reader__grid');
        const empty=el('p','admin-reader__empty'); empty.dataset.newsEmpty=''; empty.hidden=true;
        more=el('button','btn-action admin-reader__more','Load more');more.type='button';more.hidden=true;
        root.append(toolbar,info,grid,empty,more);
        listen(search,'input',render); listen(refresh,'click',()=>fetchPage()); listen(more,'click',()=>fetchPage(true));
        for (const input of [locale,status]) listen(input,'change',()=>{filters.locale=locale.value;filters.status=status.value;void fetchPage();});
        return fetchPage();
    }
    return { load, hide: dispose };
}
