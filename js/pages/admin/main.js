/* ============================================================
   BITBI — Admin Dashboard
   Entry point for admin.html
   ============================================================ */

import { initParticles }     from '../../shared/particles.js';
import { initBinaryRain }    from '../../shared/binary-rain.js';
import { initBinaryFooter }  from '../../shared/binary-footer.js';
import { initScrollReveal }  from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';

import {
    apiAdminMe,
    apiAdminUsers,
    apiAdminChangeRole,
    apiAdminChangeStatus,
    apiAdminRevokeSessions,
    apiAdminDeleteUser,
} from '../../shared/auth-api.js';

/* ── DOM refs ── */
const $denied      = document.getElementById('adminDenied');
const $panel       = document.getElementById('adminPanel');
const $loading     = document.getElementById('loadingState');
const $empty       = document.getElementById('emptyState');
const $table       = document.getElementById('userTable');
const $tbody       = document.getElementById('userTbody');
const $mobileList  = document.getElementById('userMobileList');
const $mobileSec   = document.getElementById('mobileSection');
const $searchForm  = document.getElementById('searchForm');
const $searchInput = document.getElementById('searchInput');
const $toast       = document.getElementById('adminToast');

/* ── Toast ── */
function showToast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `admin-toast__item admin-toast__item--${type}`;
    el.textContent = message;
    $toast.appendChild(el);
    setTimeout(() => { el.remove(); }, 3000);
}

/* ── Date formatter ── */
const dtf = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
});

function formatDate(iso) {
    if (!iso) return '—';
    return dtf.format(new Date(iso));
}

/* ── Render helpers ── */
function createBadge(text, variant) {
    const span = document.createElement('span');
    span.className = `badge badge--${variant}`;
    span.textContent = text;
    return span;
}

function createActionBtn(label, onClick, danger) {
    const btn = document.createElement('button');
    btn.className = 'btn-action' + (danger ? ' btn-action--danger' : '');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
}

/* ── Build mobile card ── */
function buildMobileCard(user) {
    const card = document.createElement('div');
    card.className = 'admin-mobile-card';

    const isVerified = !!user.email_verified_at;
    const primaryName = user.display_name || user.email;
    const secondaryLine = user.display_name ? user.email : null;

    /* Header (always visible) */
    const header = document.createElement('div');
    header.className = 'admin-mobile-card__header';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');

    const identity = document.createElement('div');
    identity.className = 'admin-mobile-card__identity';

    const nameEl = document.createElement('div');
    nameEl.className = 'admin-mobile-card__name';
    nameEl.textContent = primaryName;
    identity.appendChild(nameEl);

    if (secondaryLine) {
        const subEl = document.createElement('div');
        subEl.className = 'admin-mobile-card__sub';
        subEl.textContent = secondaryLine;
        identity.appendChild(subEl);
    }

    const badgeRole = createBadge(user.role, user.role === 'admin' ? 'admin' : 'user');
    const badgeStatus = createBadge(user.status, user.status === 'active' ? 'active' : 'disabled');
    const badgeVerified = createBadge(isVerified ? 'Yes' : 'No', isVerified ? 'active' : 'disabled');

    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.classList.add('admin-mobile-card__chevron');
    chevron.setAttribute('width', '16');
    chevron.setAttribute('height', '16');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('fill', 'none');
    chevron.setAttribute('stroke', 'currentColor');
    chevron.setAttribute('stroke-width', '2');
    chevron.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', 'M19 9l-7 7-7-7');
    chevron.appendChild(path);

    header.appendChild(identity);
    header.appendChild(badgeRole);
    header.appendChild(badgeStatus);
    header.appendChild(badgeVerified);
    header.appendChild(chevron);

    /* Body (expandable accordion) */
    const body = document.createElement('div');
    body.className = 'admin-mobile-card__body';

    const bodyInner = document.createElement('div');
    bodyInner.className = 'admin-mobile-card__body-inner';

    const content = document.createElement('div');
    content.className = 'admin-mobile-card__content';

    // Created date
    const meta = document.createElement('div');
    meta.className = 'admin-mobile-card__meta';
    const metaLabel = document.createElement('span');
    metaLabel.className = 'admin-mobile-card__label';
    metaLabel.textContent = 'Created';
    const metaValue = document.createElement('span');
    metaValue.className = 'admin-mobile-card__value';
    metaValue.textContent = formatDate(user.created_at);
    meta.appendChild(metaLabel);
    meta.appendChild(metaValue);

    // Actions (same logic as desktop)
    const actions = document.createElement('div');
    actions.className = 'admin-mobile-card__actions';

    const newRole = user.role === 'admin' ? 'user' : 'admin';
    actions.appendChild(createActionBtn(
        newRole === 'admin' ? 'Make Admin' : 'Make User',
        () => handleChangeRole(user.id, newRole),
    ));

    const newStatus = user.status === 'active' ? 'disabled' : 'active';
    actions.appendChild(createActionBtn(
        newStatus === 'disabled' ? 'Disable' : 'Enable',
        () => handleChangeStatus(user.id, newStatus),
    ));

    actions.appendChild(createActionBtn(
        'Revoke Sessions',
        () => handleRevokeSessions(user.id),
    ));

    actions.appendChild(createActionBtn(
        'Delete',
        () => handleDeleteUser(user.id, user.email),
        true,
    ));

    content.appendChild(meta);
    content.appendChild(actions);
    bodyInner.appendChild(content);
    body.appendChild(bodyInner);

    card.appendChild(header);
    card.appendChild(body);

    /* Toggle expand/collapse */
    const toggle = () => {
        const isOpen = card.classList.toggle('admin-mobile-card--open');
        header.setAttribute('aria-expanded', String(isOpen));
    };
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
        }
    });

    return card;
}

/* ── Render user rows ── */
function renderUsers(users) {
    $tbody.replaceChildren();
    $mobileList.replaceChildren();

    if (!users || users.length === 0) {
        $table.style.display = 'none';
        $mobileSec.style.display = 'none';
        $empty.style.display = '';
        return;
    }

    $empty.style.display = 'none';
    $table.style.display = '';
    $mobileSec.style.display = '';

    for (const user of users) {
        const tr = document.createElement('tr');

        // Email
        const tdEmail = document.createElement('td');
        tdEmail.textContent = user.email;
        tr.appendChild(tdEmail);

        // Role badge
        const tdRole = document.createElement('td');
        tdRole.appendChild(createBadge(user.role, user.role === 'admin' ? 'admin' : 'user'));
        tr.appendChild(tdRole);

        // Status badge
        const tdStatus = document.createElement('td');
        tdStatus.appendChild(createBadge(user.status, user.status === 'active' ? 'active' : 'disabled'));
        tr.appendChild(tdStatus);

        // Verified badge
        const tdVerified = document.createElement('td');
        const isVerified = !!user.email_verified_at;
        tdVerified.appendChild(createBadge(isVerified ? 'Yes' : 'No', isVerified ? 'active' : 'disabled'));
        tr.appendChild(tdVerified);

        // Created date
        const tdCreated = document.createElement('td');
        tdCreated.className = 'hide-mobile';
        tdCreated.textContent = formatDate(user.created_at);
        tr.appendChild(tdCreated);

        // Actions
        const tdActions = document.createElement('td');
        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'admin-actions';

        // Toggle role
        const newRole = user.role === 'admin' ? 'user' : 'admin';
        actionsWrap.appendChild(
            createActionBtn(
                newRole === 'admin' ? 'Make Admin' : 'Make User',
                () => handleChangeRole(user.id, newRole),
            ),
        );

        // Toggle status
        const newStatus = user.status === 'active' ? 'disabled' : 'active';
        actionsWrap.appendChild(
            createActionBtn(
                newStatus === 'disabled' ? 'Disable' : 'Enable',
                () => handleChangeStatus(user.id, newStatus),
            ),
        );

        // Revoke sessions
        actionsWrap.appendChild(
            createActionBtn('Revoke Sessions', () => handleRevokeSessions(user.id)),
        );

        // Delete
        actionsWrap.appendChild(
            createActionBtn('Delete', () => handleDeleteUser(user.id, user.email), true),
        );

        tdActions.appendChild(actionsWrap);
        tr.appendChild(tdActions);
        $tbody.appendChild(tr);

        // Mobile card
        $mobileList.appendChild(buildMobileCard(user));
    }
}

/* ── Load users ── */
async function loadUsers(search) {
    $loading.style.display = '';
    $empty.style.display = 'none';
    $table.style.display = 'none';
    $mobileSec.style.display = 'none';

    const res = await apiAdminUsers(search || undefined);

    $loading.style.display = 'none';

    if (!res.ok) {
        showToast(res.error, 'error');
        return;
    }

    renderUsers(res.data?.users ?? res.data);
}

/* ── Action handlers ── */
async function handleChangeRole(userId, newRole) {
    const res = await apiAdminChangeRole(userId, newRole);
    if (res.ok) {
        showToast(res.data?.message || 'Role changed', 'success');
        loadUsers($searchInput.value.trim());
    } else {
        showToast(res.error, 'error');
    }
}

async function handleChangeStatus(userId, newStatus) {
    const res = await apiAdminChangeStatus(userId, newStatus);
    if (res.ok) {
        showToast(res.data?.message || 'Status changed', 'success');
        loadUsers($searchInput.value.trim());
    } else {
        showToast(res.error, 'error');
    }
}

async function handleRevokeSessions(userId) {
    if (!confirm('Revoke all sessions for this user?')) return;
    const res = await apiAdminRevokeSessions(userId);
    if (res.ok) {
        showToast(res.data?.message || 'Sessions revoked', 'success');
    } else {
        showToast(res.error, 'error');
    }
}

async function handleDeleteUser(userId, email) {
    if (!confirm(`Permanently delete user "${email}"?`)) return;
    const res = await apiAdminDeleteUser(userId);
    if (res.ok) {
        showToast(res.data?.message || 'User deleted', 'success');
        loadUsers($searchInput.value.trim());
    } else {
        showToast(res.error, 'error');
    }
}

/* ── Init ── */
async function init() {
    // Shared modules
    try { initParticles('heroCanvas'); }     catch (e) { console.warn(e); }
    try { initBinaryRain('binaryRain'); }    catch (e) { console.warn(e); }
    try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn(e); }
    try { initScrollReveal(); }              catch (e) { console.warn(e); }
    try { initCookieConsent(); }             catch (e) { console.warn(e); }

    // Auth check
    const me = await apiAdminMe();

    if (!me.ok) {
        $denied.style.display = '';
        $denied.classList.add('visible');
        return;
    }

    // Show admin panel
    $panel.style.display = '';
    $panel.classList.add('visible');

    // Search form
    $searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        loadUsers($searchInput.value.trim());
    });

    // Initial load
    loadUsers();
}

init();
