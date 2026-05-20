import {
    apiAdminActivity,
    apiAdminUserActivity,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { createBadge } from './ui.js?v=__ASSET_VERSION__';

const ACTIVITY_LIMIT = 50;
const ACTIVITY_VISIBLE = 10;

const ADMIN_ACTION_LABELS = {
    change_role: 'Role Change',
    change_status: 'Status Change',
    revoke_sessions: 'Sessions Revoked',
    delete_user: 'User Deleted',
};
const ADMIN_ACTION_VARIANTS = {
    change_role: 'user',
    change_status: 'legacy',
    revoke_sessions: 'disabled',
    delete_user: 'disabled',
};
const USER_ACTION_LABELS = {
    register: 'Registration',
    login: 'Login',
    logout: 'Logout',
    verify_email: 'Email Verified',
    reset_password: 'Password Reset',
    update_profile: 'Profile Update',
    upload_avatar: 'Avatar Upload',
    delete_avatar: 'Avatar Deleted',
};
const USER_ACTION_VARIANTS = {
    register: 'active',
    login: 'user',
    logout: 'legacy',
    verify_email: 'active',
    reset_password: 'admin',
    update_profile: 'user',
    upload_avatar: 'user',
    delete_avatar: 'disabled',
};

function formatAdminMeta(action, metaJson) {
    try {
        const meta = JSON.parse(metaJson || '{}');
        switch (action) {
            case 'change_role':      return `New role: ${meta.role || '\u2014'}`;
            case 'change_status':    return `New status: ${meta.status || '\u2014'}`;
            case 'revoke_sessions':  return `${meta.revokedSessions || 0} sessions revoked`;
            case 'delete_user': {
                const parts = [];
                if (meta.target_role) parts.push(`was ${meta.target_role}`);
                if (meta.target_status && meta.target_status !== 'active') parts.push(meta.target_status);
                return parts.length ? `Account deleted (${parts.join(', ')})` : 'Account deleted';
            }
            default:                 return Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join(', ') || '\u2014';
        }
    } catch { return '\u2014'; }
}

function formatUserMeta(action, metaJson) {
    try {
        const meta = JSON.parse(metaJson || '{}');
        switch (action) {
            case 'register':        return meta.email || '\u2014';
            case 'update_profile':  return meta.fields ? `Updated: ${meta.fields.join(', ')}` : '\u2014';
            case 'upload_avatar':   return meta.type || '\u2014';
            default:                return '\u2014';
        }
    } catch { return '\u2014'; }
}

export function createAdminActivity({ showToast, formatDate }) {
    let version = 0;
    let mode = 'admin';
    let entries = [];
    let nextCursor = null;
    let expanded = false;
    let searchTimer = null;

    function buildAdminRow(entry) {
        const tr = document.createElement('tr');
        const tdTime = document.createElement('td');
        tdTime.textContent = formatDate(entry.created_at);
        tr.appendChild(tdTime);

        const tdAdmin = document.createElement('td');
        tdAdmin.textContent = entry.admin_email || (entry.admin_user_id?.slice(0, 8) + '\u2026');
        tr.appendChild(tdAdmin);

        const tdAction = document.createElement('td');
        tdAction.appendChild(createBadge(
            ADMIN_ACTION_LABELS[entry.action] || entry.action,
            ADMIN_ACTION_VARIANTS[entry.action] || 'user',
        ));
        tr.appendChild(tdAction);

        const tdTarget = document.createElement('td');
        tdTarget.textContent = entry.target_email || (entry.target_user_id ? entry.target_user_id.slice(0, 8) + '\u2026' : '\u2014');
        tr.appendChild(tdTarget);

        const tdDetails = document.createElement('td');
        tdDetails.className = 'hide-mobile';
        tdDetails.textContent = formatAdminMeta(entry.action, entry.meta_json);
        tr.appendChild(tdDetails);
        return tr;
    }

    function buildUserRow(entry) {
        const tr = document.createElement('tr');
        const tdTime = document.createElement('td');
        tdTime.textContent = formatDate(entry.created_at);
        tr.appendChild(tdTime);

        const tdUser = document.createElement('td');
        tdUser.textContent = entry.user_email || (entry.user_id?.slice(0, 8) + '\u2026');
        tr.appendChild(tdUser);

        const tdAction = document.createElement('td');
        tdAction.appendChild(createBadge(
            USER_ACTION_LABELS[entry.action] || entry.action,
            USER_ACTION_VARIANTS[entry.action] || 'user',
        ));
        tr.appendChild(tdAction);

        const tdDetails = document.createElement('td');
        tdDetails.textContent = formatUserMeta(entry.action, entry.meta_json);
        tr.appendChild(tdDetails);
        return tr;
    }

    function renderEntries() {
        const tbody = document.getElementById('activityTbody');
        const tbodyMore = document.getElementById('activityTbodyMore');
        const table = document.getElementById('activityTable');
        const expand = document.getElementById('activityExpand');
        const expandLabel = document.getElementById('activityExpandLabel');
        const loadMore = document.getElementById('activityLoadMore');
        const empty = document.getElementById('activityEmpty');

        tbody.replaceChildren();
        tbodyMore.replaceChildren();

        if (entries.length === 0) {
            table.style.display = 'none';
            expand.style.display = 'none';
            empty.style.display = '';
            return;
        }

        empty.style.display = 'none';
        table.style.display = '';

        const buildRow = mode === 'admin' ? buildAdminRow : buildUserRow;

        const visible = entries.slice(0, ACTIVITY_VISIBLE);
        for (const entry of visible) {
            tbody.appendChild(buildRow(entry));
        }

        const rest = entries.slice(ACTIVITY_VISIBLE);
        if (rest.length > 0 || nextCursor) {
            expand.style.display = '';
            expandLabel.textContent = expanded
                ? 'Hide older entries'
                : `Show ${rest.length} more entr${rest.length === 1 ? 'y' : 'ies'}`;

            for (const entry of rest) {
                tbodyMore.appendChild(buildRow(entry));
            }

            loadMore.style.display = nextCursor ? '' : 'none';
            expand.classList.toggle('admin-activity-expand--open', expanded);
        } else {
            expand.style.display = 'none';
        }
    }

    function renderSummary(counts) {
        const summaryEl = document.getElementById('activitySummary');
        if (summaryEl) {
            summaryEl.replaceChildren();
            const inventory = document.createElement('div');
            inventory.className = 'admin-inventory';
            [
                ['Role changes', counts.change_role || 0],
                ['Status changes', counts.change_status || 0],
            ].forEach(([label, count]) => {
                const row = document.createElement('div');
                row.className = 'admin-inventory__row';
                const name = document.createElement('span');
                name.className = 'admin-inventory__name';
                name.textContent = label;
                const value = document.createElement('span');
                value.className = 'admin-inventory__count';
                value.textContent = String(count);
                row.append(name, value);
                inventory.appendChild(row);
            });
            summaryEl.appendChild(inventory);
        }

        const securityEl = document.getElementById('securitySummary');
        if (securityEl) {
            securityEl.replaceChildren();
            const inventory = document.createElement('div');
            inventory.className = 'admin-inventory';
            [
                ['Sessions revoked', counts.revoke_sessions || 0],
                ['Users deleted', counts.delete_user || 0],
            ].forEach(([label, count]) => {
                const row = document.createElement('div');
                row.className = 'admin-inventory__row';
                const name = document.createElement('span');
                name.className = 'admin-inventory__name';
                name.textContent = label;
                const value = document.createElement('span');
                value.className = 'admin-inventory__count';
                value.textContent = String(count);
                row.append(name, value);
                inventory.appendChild(row);
            });
            securityEl.appendChild(inventory);
        }
    }

    async function load(appendMode) {
        const loading = document.getElementById('activityLoading');
        const empty = document.getElementById('activityEmpty');
        const table = document.getElementById('activityTable');

        const myVersion = ++version;
        const searchVal = document.getElementById('activitySearch')?.value.trim() || '';

        if (!appendMode) {
            entries = [];
            nextCursor = null;
            expanded = false;
            loading.style.display = '';
            empty.style.display = 'none';
            table.style.display = 'none';
            document.getElementById('activityExpand').style.display = 'none';
        }

        const cursor = appendMode ? nextCursor : null;
        const fetchFn = mode === 'admin' ? apiAdminActivity : apiAdminUserActivity;
        const res = await fetchFn(ACTIVITY_LIMIT, cursor, searchVal || undefined);

        if (myVersion !== version) return;
        loading.style.display = 'none';

        if (!res.ok) {
            showToast('Failed to load activity log.', 'error');
            return;
        }

        const { entries: rows, nextCursor: cursorValue, counts, unavailable, reason } = res.data || {};
        nextCursor = cursorValue || null;

        if (unavailable) {
            empty.textContent = reason || 'User activity logging is not yet available.';
            empty.style.display = '';
            document.getElementById('activitySummaryArea').style.display = 'none';
            return;
        }

        if (appendMode) {
            entries = entries.concat(rows || []);
        } else {
            entries = rows || [];
        }

        const summaryArea = document.getElementById('activitySummaryArea');
        if (mode === 'admin') {
            summaryArea.style.display = '';
            renderSummary(counts || {});
        } else {
            summaryArea.style.display = 'none';
        }

        renderEntries();
    }

    function switchMode(nextMode) {
        if (nextMode === mode) return;
        mode = nextMode;

        document.querySelectorAll('.admin-activity-mode').forEach(btn => {
            btn.classList.toggle('admin-activity-mode--active', btn.dataset.mode === mode);
        });

        const title = document.getElementById('activityTitle');
        const desc = document.getElementById('activityDesc');
        const thead = document.getElementById('activityThead');

        if (mode === 'admin') {
            title.textContent = 'Admin Audit Log';
            desc.textContent = 'Recent administrative actions.';
            thead.replaceChildren();
            const tr = document.createElement('tr');
            ['Time', 'Admin', 'Action', 'Target', 'Details'].forEach((heading, index) => {
                const th = document.createElement('th');
                th.textContent = heading;
                if (index === 4) th.className = 'hide-mobile';
                tr.appendChild(th);
            });
            thead.appendChild(tr);
        } else {
            title.textContent = 'User Activity Log';
            desc.textContent = 'Recent user events and actions.';
            thead.replaceChildren();
            const tr = document.createElement('tr');
            ['Time', 'User', 'Event', 'Details'].forEach((heading, index) => {
                const th = document.createElement('th');
                th.textContent = heading;
                if (index === 3) th.className = 'hide-mobile';
                tr.appendChild(th);
            });
            thead.appendChild(tr);
        }

        const search = document.getElementById('activitySearch');
        if (search) search.value = '';

        load();
    }

    function bind() {
        document.querySelectorAll('.admin-activity-mode').forEach(btn => {
            if (btn.dataset.bound === '1') return;
            btn.dataset.bound = '1';
            btn.addEventListener('click', () => switchMode(btn.dataset.mode));
        });

        const search = document.getElementById('activitySearch');
        if (search && search.dataset.bound !== '1') {
            search.dataset.bound = '1';
            search.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => load(), 350);
            });
        }

        const expandBtn = document.getElementById('activityExpandBtn');
        if (expandBtn && expandBtn.dataset.bound !== '1') {
            expandBtn.dataset.bound = '1';
            expandBtn.addEventListener('click', () => {
                expanded = !expanded;
                const wrap = document.getElementById('activityExpand');
                wrap.classList.toggle('admin-activity-expand--open', expanded);
                const label = document.getElementById('activityExpandLabel');
                const restCount = entries.length - ACTIVITY_VISIBLE;
                label.textContent = expanded
                    ? 'Hide older entries'
                    : `Show ${restCount} more entr${restCount === 1 ? 'y' : 'ies'}`;
                expandBtn.setAttribute('aria-expanded', String(expanded));
            });
        }

        const loadMoreBtn = document.getElementById('activityLoadMoreBtn');
        if (loadMoreBtn && loadMoreBtn.dataset.bound !== '1') {
            loadMoreBtn.dataset.bound = '1';
            loadMoreBtn.addEventListener('click', () => {
                if (nextCursor) {
                    expanded = true;
                    load(true);
                }
            });
        }
    }

    return {
        bind,
        load,
    };
}
