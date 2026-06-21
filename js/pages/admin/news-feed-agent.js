import {
    apiAdminNewsPulseDeleteItems,
    apiAdminNewsPulseGetItem,
    apiAdminNewsPulseListItems,
    apiAdminNewsPulseOverview,
    apiAdminNewsPulseUpdateItem,
    apiAdminNewsPulseVisibilityGet,
    apiAdminNewsPulseVisibilityUpdate,
    createAdminIdempotencyKey,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';

const DELETE_CONFIRMATION = 'delete_news_pulse_items';

function el(tagName, className, text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function clear(node) {
    if (node) node.replaceChildren();
}

function valueOf(container, selector) {
    return container.querySelector(selector)?.value?.trim() || '';
}

function checked(container, selector) {
    return container.querySelector(selector)?.checked === true;
}

function metric(label, value, tone = 'neutral') {
    const card = el('div', `admin-news-feed__metric is-${tone}`);
    card.append(el('span', 'admin-news-feed__metric-label', label), el('strong', '', String(value ?? '—')));
    return card;
}

function option(value, label, selectedValue) {
    const item = document.createElement('option');
    item.value = value;
    item.textContent = label;
    if (value === selectedValue) item.selected = true;
    return item;
}

function normalizeDateInput(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 16);
}

function isoFromDatetimeLocal(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

function statusLabel(item) {
    if (item.expired) return 'expired';
    return item.status || 'active';
}

function formatCount(value) {
    const count = Number(value || 0);
    return Number.isFinite(count) ? count.toLocaleString('en-GB') : '0';
}

export function createAdminNewsFeedAgent({ showToast, formatDate, formatApiError }) {
    const refs = {
        container: document.getElementById('newsFeedAgentAdmin'),
    };
    const state = {
        loaded: false,
        loading: false,
        overview: null,
        visibility: null,
        items: [],
        selected: new Set(),
        filters: {
            locale: 'all',
            surface: 'desktop',
            status: 'active',
            visualStatus: 'all',
        },
        nextCursor: null,
        hasMore: false,
        editItem: null,
    };

    function renderState(message, tone = 'neutral') {
        clear(refs.container);
        const box = el('div', `admin-control-card admin-news-feed__state is-${tone}`);
        box.textContent = message;
        refs.container.appendChild(box);
    }

    function renderHeader() {
        const header = el('div', 'admin-news-feed__header');
        const text = el('div');
        text.append(
            el('h2', 'admin-section-title', 'News Feed Agent'),
            el('p', 'admin-shell__desc', 'Control public News Pulse visibility, edit current rows, and irreversibly delete selected rows plus generated thumbnails. Background ingestion and visual generation remain independent.'),
        );
        const actions = el('div', 'admin-control-toolbar');
        const refresh = el('button', 'btn-action', 'Refresh');
        refresh.type = 'button';
        refresh.dataset.newsPulseAction = 'refresh';
        actions.appendChild(refresh);
        header.append(text, actions);
        return header;
    }

    function renderOverview() {
        const overview = state.overview || {};
        const counts = overview.counts || {};
        const visibility = overview.visibility?.settings || state.visibility?.settings || {};
        const card = el('section', 'admin-control-card admin-news-feed__overview');
        const statusTone = counts.expired || counts.hidden ? 'warn' : 'ok';
        card.append(
            el('h3', 'admin-control-card__title', 'Status'),
            el('p', 'admin-shell__desc', 'Visibility switches only affect public rendering/loading. OpenClaw ingest, scheduled refresh, D1 storage, and thumbnail generation continue.'),
        );
        const grid = el('div', 'admin-news-feed__metrics');
        grid.append(
            metric('Desktop visibility', visibility.desktop?.enabled === false ? 'Off' : 'On', visibility.desktop?.enabled === false ? 'warn' : 'ok'),
            metric('Mobile visibility', visibility.mobile?.enabled === false ? 'Off' : 'On', visibility.mobile?.enabled === false ? 'warn' : 'ok'),
            metric('Active rows', formatCount(counts.active), 'ok'),
            metric('Hidden rows', formatCount(counts.hidden), statusTone),
            metric('Expired rows', formatCount(counts.expired), statusTone),
            metric('Generated images', formatCount(counts.with_visual_object), 'neutral'),
        );
        card.appendChild(grid);
        const meta = el('p', 'admin-news-feed__meta', `Last update: ${formatDate?.(overview.last_updated_at || overview.generated_at) || '—'}`);
        card.appendChild(meta);
        return card;
    }

    function renderVisibility() {
        const settings = state.visibility?.settings || state.overview?.visibility?.settings || {};
        const card = el('section', 'admin-control-card admin-news-feed__visibility');
        card.append(
            el('h3', 'admin-control-card__title', 'Public visibility'),
            el('p', 'admin-shell__desc', 'Switching a surface off removes the News Pulse box and stops public item/thumb URL loading for that surface only.'),
        );

        const switches = el('div', 'admin-news-feed__switches');
        for (const [surface, label] of [['desktop', 'Desktop'], ['mobile', 'Mobile']]) {
            const field = el('label', 'admin-form__check');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `newsPulse${label}Enabled`;
            input.checked = settings[surface]?.enabled !== false;
            field.append(input, el('span', '', `${label} News Pulse visible`));
            switches.appendChild(field);
        }

        const reasonLabel = el('label', 'admin-ai__field');
        reasonLabel.append(el('span', 'admin-ai__label', 'Reason'));
        const reason = document.createElement('input');
        reason.id = 'newsPulseVisibilityReason';
        reason.className = 'admin-ai__input';
        reason.type = 'text';
        reason.maxLength = 500;
        reason.placeholder = 'Required for audit log';
        reasonLabel.appendChild(reason);

        const save = el('button', 'btn-action', 'Save visibility');
        save.type = 'button';
        save.dataset.newsPulseAction = 'save-visibility';
        card.append(switches, reasonLabel, save);
        return card;
    }

    function renderFilters() {
        const card = el('section', 'admin-control-card admin-news-feed__filters');
        card.appendChild(el('h3', 'admin-control-card__title', 'Items'));
        const row = el('div', 'admin-news-feed__filter-row');
        const configs = [
            ['newsPulseFilterLocale', 'Locale', [['all', 'All'], ['en', 'English'], ['de', 'German']], state.filters.locale],
            ['newsPulseFilterSurface', 'Surface context', [['desktop', 'Desktop'], ['mobile', 'Mobile']], state.filters.surface],
            ['newsPulseFilterStatus', 'Status', [['active', 'Active'], ['hidden', 'Hidden'], ['expired', 'Expired'], ['all', 'All']], state.filters.status],
            ['newsPulseFilterVisual', 'Visual status', [['all', 'All'], ['missing', 'Missing'], ['pending', 'Pending'], ['ready', 'Ready'], ['failed', 'Failed'], ['skipped', 'Skipped']], state.filters.visualStatus],
        ];
        for (const [id, label, options, selected] of configs) {
            const field = el('label', 'admin-ai__field');
            field.appendChild(el('span', 'admin-ai__label', label));
            const select = document.createElement('select');
            select.id = id;
            select.className = 'admin-ai__input';
            select.dataset.newsPulseFilter = '1';
            options.forEach(([value, text]) => select.appendChild(option(value, text, selected)));
            field.appendChild(select);
            row.appendChild(field);
        }
        card.appendChild(row);
        return card;
    }

    function renderBulkDelete() {
        const card = el('section', 'admin-control-card admin-news-feed__delete');
        card.append(
            el('h3', 'admin-control-card__title', 'Irreversible cleanup'),
            el('p', 'admin-shell__desc', `Deletes selected D1 rows and validated News Pulse thumbnail objects from USER_IMAGES. Type ${DELETE_CONFIRMATION} to confirm.`),
        );
        const controls = el('div', 'admin-news-feed__bulk-controls');
        const reason = document.createElement('input');
        reason.id = 'newsPulseDeleteReason';
        reason.className = 'admin-ai__input';
        reason.type = 'text';
        reason.placeholder = 'Deletion reason';
        reason.maxLength = 500;
        const confirmation = document.createElement('input');
        confirmation.id = 'newsPulseDeleteConfirmation';
        confirmation.className = 'admin-ai__input';
        confirmation.type = 'text';
        confirmation.placeholder = DELETE_CONFIRMATION;
        const button = el('button', 'btn-action btn-action--danger', `Delete selected (${state.selected.size})`);
        button.type = 'button';
        button.dataset.newsPulseAction = 'delete-selected';
        controls.append(reason, confirmation, button);
        card.appendChild(controls);
        return card;
    }

    function renderItemsTable() {
        const card = el('section', 'admin-control-card admin-news-feed__items');
        const table = el('table', 'admin-table admin-news-feed__table');
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const selectTh = document.createElement('th');
        const selectAll = document.createElement('input');
        selectAll.type = 'checkbox';
        selectAll.dataset.newsPulseAction = 'select-all';
        selectAll.checked = state.items.length > 0 && state.items.every((item) => state.selected.has(item.id));
        selectTh.appendChild(selectAll);
        headerRow.append(selectTh);
        ['Thumbnail', 'Title', 'Locale', 'Status', 'Visual', 'Published', 'Expires', 'Actions'].forEach((label) => {
            const th = document.createElement('th');
            th.textContent = label;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        if (!state.items.length) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 9;
            cell.textContent = 'No News Pulse rows match the current filters.';
            row.appendChild(cell);
            tbody.appendChild(row);
        }
        for (const item of state.items) {
            const row = document.createElement('tr');
            const selectCell = document.createElement('td');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.newsPulseSelect = item.id;
            checkbox.checked = state.selected.has(item.id);
            selectCell.appendChild(checkbox);
            const thumbCell = document.createElement('td');
            if (item.admin_thumb_url) {
                const img = document.createElement('img');
                img.className = 'admin-news-feed__thumb';
                img.src = item.admin_thumb_url;
                img.alt = '';
                img.loading = 'lazy';
                img.decoding = 'async';
                thumbCell.appendChild(img);
            } else {
                thumbCell.textContent = '—';
            }
            const titleCell = document.createElement('td');
            titleCell.append(el('strong', '', item.title || 'Untitled'), el('span', 'admin-news-feed__summary', item.summary || ''));
            const localeCell = document.createElement('td');
            localeCell.textContent = item.locale || '—';
            const statusCell = document.createElement('td');
            statusCell.appendChild(el('span', `badge badge--${item.expired ? 'warning' : 'success'}`, statusLabel(item)));
            const visualCell = document.createElement('td');
            visualCell.textContent = item.visual_status || 'missing';
            const publishedCell = document.createElement('td');
            publishedCell.textContent = formatDate?.(item.published_at) || '—';
            const expiresCell = document.createElement('td');
            expiresCell.textContent = formatDate?.(item.expires_at) || '—';
            const actionCell = document.createElement('td');
            const edit = el('button', 'btn-action', 'Edit');
            edit.type = 'button';
            edit.dataset.newsPulseEdit = item.id;
            actionCell.appendChild(edit);
            row.append(selectCell, thumbCell, titleCell, localeCell, statusCell, visualCell, publishedCell, expiresCell, actionCell);
            tbody.appendChild(row);
        }
        table.appendChild(tbody);
        const scroll = el('div', 'admin-table-scroll');
        scroll.appendChild(table);
        card.appendChild(scroll);
        if (state.hasMore) {
            const loadMore = el('button', 'btn-action', 'Load more');
            loadMore.type = 'button';
            loadMore.dataset.newsPulseAction = 'load-more';
            card.appendChild(loadMore);
        }
        return card;
    }

    function renderEditPanel() {
        const item = state.editItem;
        const card = el('section', 'admin-control-card admin-news-feed__edit');
        card.id = 'newsPulseEditPanel';
        card.appendChild(el('h3', 'admin-control-card__title', item ? `Edit: ${item.title}` : 'Edit item'));
        if (!item) {
            card.appendChild(el('p', 'admin-shell__desc', 'Select an item to edit title, summary, source, URL, status, and expiry.'));
            return card;
        }
        const fields = el('div', 'admin-news-feed__edit-grid');
        const fieldDefs = [
            ['newsPulseEditTitle', 'Title', 'text', item.title || ''],
            ['newsPulseEditSummary', 'Summary', 'textarea', item.summary || ''],
            ['newsPulseEditSource', 'Source', 'text', item.source || ''],
            ['newsPulseEditUrl', 'URL', 'url', item.url || ''],
            ['newsPulseEditCategory', 'Category', 'text', item.category || ''],
            ['newsPulseEditPublished', 'Published at', 'datetime-local', normalizeDateInput(item.published_at)],
            ['newsPulseEditExpires', 'Expires at', 'datetime-local', normalizeDateInput(item.expires_at)],
        ];
        for (const [id, label, type, value] of fieldDefs) {
            const field = el('label', 'admin-ai__field');
            field.appendChild(el('span', 'admin-ai__label', label));
            const input = type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
            input.id = id;
            input.className = 'admin-ai__input';
            if (type !== 'textarea') input.type = type;
            input.value = value;
            field.appendChild(input);
            fields.appendChild(field);
        }
        const statusField = el('label', 'admin-ai__field');
        statusField.appendChild(el('span', 'admin-ai__label', 'Status'));
        const status = document.createElement('select');
        status.id = 'newsPulseEditStatus';
        status.className = 'admin-ai__input';
        status.append(option('active', 'Active', item.status), option('hidden', 'Hidden', item.status));
        statusField.appendChild(status);
        fields.appendChild(statusField);

        const reasonField = el('label', 'admin-ai__field');
        reasonField.appendChild(el('span', 'admin-ai__label', 'Reason'));
        const reason = document.createElement('input');
        reason.id = 'newsPulseEditReason';
        reason.className = 'admin-ai__input';
        reason.type = 'text';
        reason.maxLength = 500;
        reason.placeholder = 'Required for audit log';
        reasonField.appendChild(reason);
        fields.appendChild(reasonField);

        const resetVisual = el('label', 'admin-form__check');
        const resetInput = document.createElement('input');
        resetInput.id = 'newsPulseEditResetVisual';
        resetInput.type = 'checkbox';
        resetVisual.append(resetInput, el('span', '', 'Reset generated thumbnail metadata for later background regeneration'));
        fields.appendChild(resetVisual);

        const actions = el('div', 'admin-control-toolbar');
        const save = el('button', 'btn-action', 'Save item');
        save.type = 'button';
        save.dataset.newsPulseAction = 'save-edit';
        const cancel = el('button', 'btn-action', 'Cancel');
        cancel.type = 'button';
        cancel.dataset.newsPulseAction = 'cancel-edit';
        actions.append(save, cancel);
        card.append(fields, actions);
        return card;
    }

    function render() {
        if (!refs.container) return;
        clear(refs.container);
        refs.container.append(
            renderHeader(),
            renderOverview(),
            renderVisibility(),
            renderFilters(),
            renderBulkDelete(),
            renderItemsTable(),
            renderEditPanel(),
        );
    }

    function collectFilters() {
        state.filters.locale = valueOf(refs.container, '#newsPulseFilterLocale') || state.filters.locale;
        state.filters.surface = valueOf(refs.container, '#newsPulseFilterSurface') || state.filters.surface;
        state.filters.status = valueOf(refs.container, '#newsPulseFilterStatus') || state.filters.status;
        state.filters.visualStatus = valueOf(refs.container, '#newsPulseFilterVisual') || state.filters.visualStatus;
    }

    async function loadItems({ append = false } = {}) {
        const res = await apiAdminNewsPulseListItems({
            locale: state.filters.locale,
            status: state.filters.status,
            visualStatus: state.filters.visualStatus,
            surface: state.filters.surface,
            limit: 50,
            cursor: append ? state.nextCursor : null,
        });
        if (!res.ok) throw new Error(formatApiError?.(res, 'Failed to load News Pulse items.') || res.error);
        const data = res.data?.data || res.data || {};
        state.items = append ? [...state.items, ...(data.items || [])] : (data.items || []);
        state.hasMore = data.has_more === true;
        state.nextCursor = data.next_cursor || null;
    }

    async function load() {
        if (!refs.container) return;
        if (!state.loaded) renderState('Loading News Feed Agent controls...');
        state.loading = true;
        try {
            const [overview, visibility] = await Promise.all([
                apiAdminNewsPulseOverview(),
                apiAdminNewsPulseVisibilityGet(),
            ]);
            if (!overview.ok) throw new Error(formatApiError?.(overview, 'Failed to load News Pulse overview.') || overview.error);
            if (!visibility.ok) throw new Error(formatApiError?.(visibility, 'Failed to load News Pulse visibility.') || visibility.error);
            state.overview = overview.data?.data || overview.data || null;
            state.visibility = visibility.data?.data || visibility.data || null;
            await loadItems();
            state.loaded = true;
            render();
        } catch (error) {
            renderState(error?.message || 'Failed to load News Feed Agent controls.', 'error');
        } finally {
            state.loading = false;
        }
    }

    async function saveVisibility() {
        const reason = valueOf(refs.container, '#newsPulseVisibilityReason');
        const payload = {
            desktop_enabled: checked(refs.container, '#newsPulseDesktopEnabled'),
            mobile_enabled: checked(refs.container, '#newsPulseMobileEnabled'),
            reason,
        };
        const res = await apiAdminNewsPulseVisibilityUpdate(payload, {
            idempotencyKey: createAdminIdempotencyKey('admin-news-pulse-visibility'),
        });
        if (!res.ok) {
            showToast(formatApiError?.(res, 'Visibility update failed.') || res.error, 'error');
            return;
        }
        showToast('News Pulse visibility updated.');
        await load();
    }

    async function openEdit(id) {
        const res = await apiAdminNewsPulseGetItem(id);
        if (!res.ok) {
            showToast(formatApiError?.(res, 'Failed to load News Pulse item.') || res.error, 'error');
            return;
        }
        state.editItem = res.data?.data?.item || res.data?.item || null;
        render();
    }

    async function saveEdit() {
        const item = state.editItem;
        if (!item) return;
        const payload = {
            title: valueOf(refs.container, '#newsPulseEditTitle'),
            summary: valueOf(refs.container, '#newsPulseEditSummary'),
            source: valueOf(refs.container, '#newsPulseEditSource'),
            url: valueOf(refs.container, '#newsPulseEditUrl'),
            category: valueOf(refs.container, '#newsPulseEditCategory'),
            published_at: isoFromDatetimeLocal(valueOf(refs.container, '#newsPulseEditPublished')),
            expires_at: isoFromDatetimeLocal(valueOf(refs.container, '#newsPulseEditExpires')),
            status: valueOf(refs.container, '#newsPulseEditStatus'),
            reason: valueOf(refs.container, '#newsPulseEditReason'),
            reset_visual: checked(refs.container, '#newsPulseEditResetVisual'),
        };
        const res = await apiAdminNewsPulseUpdateItem(item.id, payload, {
            idempotencyKey: createAdminIdempotencyKey('admin-news-pulse-item'),
        });
        if (!res.ok) {
            showToast(formatApiError?.(res, 'News Pulse item update failed.') || res.error, 'error');
            return;
        }
        showToast('News Pulse item updated.');
        state.editItem = null;
        await load();
    }

    async function deleteSelected() {
        const ids = [...state.selected];
        const reason = valueOf(refs.container, '#newsPulseDeleteReason');
        const confirmation = valueOf(refs.container, '#newsPulseDeleteConfirmation');
        const res = await apiAdminNewsPulseDeleteItems({
            ids,
            reason,
            confirmation,
        }, {
            idempotencyKey: createAdminIdempotencyKey('admin-news-pulse-delete'),
        });
        if (!res.ok && res.status !== 207) {
            showToast(formatApiError?.(res, 'News Pulse deletion failed.') || res.error, 'error');
            return;
        }
        const data = res.data?.data || {};
        showToast(`Deleted ${data.deleted_rows || 0} rows and ${data.deleted_visuals || 0} thumbnails.${data.failed_count ? ' Some items failed.' : ''}`, data.failed_count ? 'error' : 'success');
        state.selected.clear();
        await load();
    }

    function bind() {
        if (!refs.container || refs.container.dataset.newsPulseBound === '1') return;
        refs.container.dataset.newsPulseBound = '1';
        refs.container.addEventListener('click', async (event) => {
            const target = event.target;
            const action = target?.dataset?.newsPulseAction;
            if (action === 'refresh') {
                await load();
            } else if (action === 'save-visibility') {
                await saveVisibility();
            } else if (action === 'load-more') {
                try {
                    await loadItems({ append: true });
                    render();
                } catch (error) {
                    showToast(error?.message || 'Failed to load more News Pulse rows.', 'error');
                }
            } else if (action === 'select-all') {
                const checkedState = target.checked === true;
                state.items.forEach((item) => {
                    if (checkedState) state.selected.add(item.id);
                    else state.selected.delete(item.id);
                });
                render();
            } else if (action === 'delete-selected') {
                await deleteSelected();
            } else if (action === 'save-edit') {
                await saveEdit();
            } else if (action === 'cancel-edit') {
                state.editItem = null;
                render();
            }
            const editId = target?.dataset?.newsPulseEdit;
            if (editId) await openEdit(editId);
        });
        refs.container.addEventListener('change', async (event) => {
            const target = event.target;
            if (target?.dataset?.newsPulseSelect) {
                if (target.checked) state.selected.add(target.dataset.newsPulseSelect);
                else state.selected.delete(target.dataset.newsPulseSelect);
                render();
                return;
            }
            if (target?.dataset?.newsPulseFilter === '1') {
                collectFilters();
                state.selected.clear();
                try {
                    await loadItems();
                    render();
                } catch (error) {
                    showToast(error?.message || 'Failed to filter News Pulse rows.', 'error');
                }
            }
        });
    }

    return {
        bind,
        load,
    };
}
