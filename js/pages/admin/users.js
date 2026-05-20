import {
    apiAdminUserBilling,
    apiAdminUsers,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { createAdminUserActions } from './user-actions.js?v=__ASSET_VERSION__';
import { createAdminUserStorage } from './user-storage.js?v=__ASSET_VERSION__';

const USERS_LIMIT = 50;
const numberFormatter = new Intl.NumberFormat('en-US');

function formatCredits(value) {
    return `${numberFormatter.format(Number(value || 0))} credits`;
}

export function createAdminUsersDomain({
    showToast,
    formatDate,
    formatApiError,
    getCurrentAdminUser,
    invalidateStats,
} = {}) {
    const refs = {
        loading: document.getElementById('loadingState'),
        empty: document.getElementById('emptyState'),
        table: document.getElementById('userTable'),
        tbody: document.getElementById('userTbody'),
        mobileList: document.getElementById('userMobileList'),
        mobileSection: document.getElementById('mobileSection'),
        searchForm: document.getElementById('searchForm'),
        searchInput: document.getElementById('searchInput'),
        pagination: document.getElementById('userPagination'),
        paginationStatus: document.getElementById('userPaginationStatus'),
        loadMoreBtn: document.getElementById('userLoadMoreBtn'),
        creditModal: document.getElementById('userCreditModal'),
        creditModalTitle: document.getElementById('userCreditModalTitle'),
        creditModalSubtitle: document.getElementById('userCreditModalSubtitle'),
        creditModalBody: document.getElementById('userCreditModalBody'),
        infoModal: document.getElementById('userInfoModal'),
        infoModalTitle: document.getElementById('userInfoModalTitle'),
        infoModalSubtitle: document.getElementById('userInfoModalSubtitle'),
        infoModalBody: document.getElementById('userInfoModalBody'),
    };

    let usersVersion = 0;
    let usersEntries = [];
    let usersNextCursor = null;
    let usersHasMore = false;
    let selectedInfoUser = null;

    function createBadge(text, variant) {
        const span = document.createElement('span');
        span.className = `badge badge--${variant}`;
        span.textContent = text;
        return span;
    }

    function createActionBtn(label, onClick, danger, options = {}) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-action' + (danger ? ' btn-action--danger' : '');
        btn.textContent = label;
        if (options.title) btn.title = options.title;
        if (options.disabled) {
            btn.disabled = true;
            btn.setAttribute('aria-disabled', 'true');
        }
        btn.addEventListener('click', onClick);
        return btn;
    }

    async function copyText(text, successMessage = 'Copied.') {
        if (!text) return;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'fixed';
                textarea.style.insetInlineStart = '-9999px';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            }
            showToast(successMessage, 'success');
        } catch {
            showToast('Copy failed.', 'error');
        }
    }

    function shortUserId(userId) {
        const value = String(userId || '');
        if (value.length <= 18) return value;
        return `${value.slice(0, 8)}...${value.slice(-6)}`;
    }

    function createUserIdMeta(userId, { compact = false } = {}) {
        const wrap = document.createElement('div');
        wrap.className = `admin-user-id${compact ? ' admin-user-id--compact' : ''}`;

        const code = document.createElement('code');
        code.className = 'admin-user-id__code';
        code.textContent = compact ? shortUserId(userId) : String(userId || '');
        code.title = String(userId || '');

        const copy = createActionBtn('Copy', (event) => {
            event.stopPropagation();
            copyText(String(userId || ''), 'User ID copied.');
        });
        copy.classList.add('admin-user-id__copy');
        copy.setAttribute('aria-label', `Copy user ID ${userId}`);

        wrap.append(code, copy);
        return wrap;
    }

    function syncModalBodyLock() {
        const hasOpenModal = [
            refs.creditModal,
            refs.infoModal,
            document.getElementById('userStorageModal'),
        ].some((modal) => modal && !modal.hidden);
        document.body.classList.toggle('modal-open', hasOpenModal);
    }

    function setModalOpen(modal, open) {
        if (!modal) return;
        modal.hidden = !open;
        modal.setAttribute('aria-hidden', open ? 'false' : 'true');
        syncModalBodyLock();
    }

    function setUserCreditModalOpen(open) {
        setModalOpen(refs.creditModal, open);
    }

    function closeUserCreditDetails() {
        setUserCreditModalOpen(false);
    }

    function userCreditState(message, variant = '') {
        const box = document.createElement('div');
        box.className = `admin-credit-modal__state${variant ? ` admin-credit-modal__state--${variant}` : ''}`;
        box.textContent = message;
        return box;
    }

    function setUserInfoModalOpen(open) {
        setModalOpen(refs.infoModal, open);
    }

    function closeUserInfoDetails() {
        selectedInfoUser = null;
        setUserInfoModalOpen(false);
    }

    function renderInfoUserIdentity(user) {
        const identity = document.createElement('div');
        identity.className = 'admin-credit-modal__identity admin-info-modal__identity';

        const main = document.createElement('div');
        const email = document.createElement('div');
        email.className = 'admin-credit-modal__identity-email';
        email.textContent = user.email || 'Unknown email';
        main.appendChild(email);

        const meta = document.createElement('div');
        meta.className = 'admin-info-modal__meta';
        meta.append(
            createBadge(user.role || 'user', user.role === 'admin' ? 'admin' : 'user'),
            createBadge(user.status || 'unknown', user.status === 'active' ? 'active' : 'disabled'),
        );
        main.appendChild(meta);

        identity.append(main, createUserIdMeta(user.id));
        return identity;
    }

    const storage = createAdminUserStorage({
        showToast,
        formatDate,
        createBadge,
        createActionBtn,
        createUserIdMeta,
        shortUserId,
        renderInfoUserIdentity,
        userCreditState,
    });

    const actions = createAdminUserActions({
        showToast,
        formatApiError,
        getCurrentAdminUser,
        getSearchValue: () => refs.searchInput?.value.trim() || '',
        reloadUsers: (search) => load(search),
        invalidateStats,
    });

    const infoActions = [
        {
            id: 'credits',
            label: 'Credits',
            description: 'Inspect personal credit balance and recent member credit transactions.',
            open: (user) => {
                closeUserInfoDetails();
                openUserCreditDetails(user);
            },
        },
        {
            id: 'usage',
            label: 'Usage',
            description: 'Inspect Assets Manager storage, folders, files, visibility, and management actions.',
            open: (user) => {
                closeUserInfoDetails();
                storage.open(user);
            },
        },
    ];

    function buildMobileCard(user) {
        const card = document.createElement('div');
        card.className = 'admin-mobile-card';

        const isLegacy = user.verification_method === 'legacy_auto';
        const isVerified = !!user.email_verified_at && !isLegacy;
        const primaryName = user.display_name || user.email;
        const secondaryLine = user.display_name ? user.email : null;

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
        const verifiedLabel = isVerified ? 'Yes' : isLegacy ? 'Legacy' : 'No';
        const verifiedStyle = isVerified ? 'active' : isLegacy ? 'legacy' : 'disabled';
        const badgeVerified = createBadge(verifiedLabel, verifiedStyle);

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

        const body = document.createElement('div');
        body.className = 'admin-mobile-card__body';

        const bodyInner = document.createElement('div');
        bodyInner.className = 'admin-mobile-card__body-inner';

        const content = document.createElement('div');
        content.className = 'admin-mobile-card__content';

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

        const idMeta = document.createElement('div');
        idMeta.className = 'admin-mobile-card__meta admin-mobile-card__meta--id';
        const idLabel = document.createElement('span');
        idLabel.className = 'admin-mobile-card__label';
        idLabel.textContent = 'User ID';
        idMeta.appendChild(idLabel);
        idMeta.appendChild(createUserIdMeta(user.id, { compact: true }));

        const actionWrap = document.createElement('div');
        actionWrap.className = 'admin-mobile-card__actions';
        appendUserActions(actionWrap, user);

        content.appendChild(meta);
        content.appendChild(idMeta);
        content.appendChild(actionWrap);
        bodyInner.appendChild(content);
        body.appendChild(bodyInner);

        card.appendChild(header);
        card.appendChild(body);

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

    function appendUserActions(actionsWrap, user) {
        actionsWrap.appendChild(
            createActionBtn('Info', () => openUserInfoDetails(user)),
        );

        const newRole = user.role === 'admin' ? 'user' : 'admin';
        actionsWrap.appendChild(
            createActionBtn(
                newRole === 'admin' ? 'Make Admin' : 'Make User',
                () => actions.handleChangeRole(user.id, newRole),
            ),
        );

        const newStatus = user.status === 'active' ? 'disabled' : 'active';
        actionsWrap.appendChild(
            createActionBtn(
                newStatus === 'disabled' ? 'Disable' : 'Enable',
                () => actions.handleChangeStatus(user.id, newStatus),
            ),
        );

        actionsWrap.appendChild(
            createActionBtn('Revoke Sessions', () => actions.handleRevokeSessions(user.id)),
        );

        const currentAdminUser = getCurrentAdminUser?.();
        const isSelf = currentAdminUser?.id && user.id === currentAdminUser.id;
        actionsWrap.appendChild(
            createActionBtn(
                isSelf ? 'Self-delete blocked' : 'Delete',
                (event) => actions.handleDeleteUser(user, event),
                true,
                {
                    disabled: isSelf,
                    title: isSelf
                        ? 'The currently signed-in admin account cannot delete itself.'
                        : 'Delete this user with explicit confirmation.',
                },
            ),
        );
    }

    function renderUserInfoDetails(user) {
        if (!refs.infoModalBody) return;
        refs.infoModalBody.textContent = '';
        refs.infoModalBody.appendChild(renderInfoUserIdentity(user));

        const grid = document.createElement('div');
        grid.className = 'admin-info-modal__grid';
        for (const action of infoActions) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'admin-info-modal__action';
            button.dataset.infoAction = action.id;
            button.setAttribute('aria-label', `${action.label} for ${user.email || user.id}`);

            const label = document.createElement('span');
            label.className = 'admin-info-modal__action-label';
            label.textContent = action.label;

            const desc = document.createElement('span');
            desc.className = 'admin-info-modal__action-desc';
            desc.textContent = action.description;

            button.append(label, desc);
            button.addEventListener('click', () => action.open(user));
            grid.appendChild(button);
        }
        refs.infoModalBody.appendChild(grid);
    }

    function openUserInfoDetails(user) {
        if (!refs.infoModal || !refs.infoModalBody) return;
        selectedInfoUser = user;
        if (refs.infoModalTitle) refs.infoModalTitle.textContent = 'Info';
        if (refs.infoModalSubtitle) refs.infoModalSubtitle.textContent = `${user.email || 'Selected user'} • ${shortUserId(user.id)}`;
        renderUserInfoDetails(user);
        setUserInfoModalOpen(true);
    }

    function creditMetric(label, value) {
        const card = document.createElement('article');
        card.className = 'admin-credit-modal__metric';
        const labelEl = document.createElement('span');
        labelEl.className = 'admin-credit-modal__metric-label';
        labelEl.textContent = label;
        const valueEl = document.createElement('strong');
        valueEl.className = 'admin-credit-modal__metric-value';
        valueEl.textContent = value;
        card.append(labelEl, valueEl);
        return card;
    }

    function transactionDetails(item = {}) {
        const usage = item.usage || {};
        return [
            usage.model,
            usage.action || usage.route,
            usage.pricingSource,
            item.featureKey,
            item.createdByEmail ? `by ${item.createdByEmail}` : null,
            item.id ? `ref ${shortUserId(item.id)}` : null,
        ].filter(Boolean).join(' • ') || 'Not reported';
    }

    function renderUserCreditTransactions(rows = []) {
        const wrap = document.createElement('div');
        wrap.className = 'admin-credit-modal__table-wrap';
        const table = document.createElement('table');
        table.className = 'admin-table admin-credit-modal__table';

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Date', 'Type', 'Description', 'Details', 'Amount', 'Balance'].forEach((heading) => {
            const th = document.createElement('th');
            th.textContent = heading;
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        if (!rows.length) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 6;
            cell.className = 'admin-credit-modal__empty-cell';
            cell.textContent = 'No member credit transactions yet.';
            row.appendChild(cell);
            tbody.appendChild(row);
        } else {
            for (const item of rows) {
                const row = document.createElement('tr');
                [
                    formatDate(item.createdAt),
                    item.type || item.entryType || 'Not reported',
                    item.description || item.reason || item.source || 'Not reported',
                    transactionDetails(item),
                    formatCredits(item.amount),
                    formatCredits(item.balanceAfter),
                ].forEach((value) => {
                    const cell = document.createElement('td');
                    cell.textContent = value;
                    row.appendChild(cell);
                });
                tbody.appendChild(row);
            }
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        return wrap;
    }

    function renderUserCreditDetails(user, billing = {}) {
        if (!refs.creditModalBody) return;
        const balance = billing.balance || {};
        const transactions = Array.isArray(billing.transactions) ? billing.transactions : [];

        refs.creditModalBody.textContent = '';
        const identity = document.createElement('div');
        identity.className = 'admin-credit-modal__identity';

        const email = document.createElement('div');
        email.className = 'admin-credit-modal__identity-email';
        email.textContent = billing.email || user.email || 'Unknown email';
        identity.appendChild(email);
        identity.appendChild(createUserIdMeta(billing.userId || user.id));
        refs.creditModalBody.appendChild(identity);

        const metrics = document.createElement('div');
        metrics.className = 'admin-credit-modal__metrics';
        metrics.append(
            creditMetric('Current balance', formatCredits(balance.current ?? billing.creditBalance)),
            creditMetric('Daily top-up target', formatCredits(balance.dailyAllowance ?? billing.dailyCreditAllowance)),
            creditMetric('Incoming credits', formatCredits(balance.lifetimeIncoming)),
            creditMetric('Consumed credits', formatCredits(balance.lifetimeConsumed)),
            creditMetric('Manual grants', formatCredits(balance.lifetimeManualGrants)),
        );
        refs.creditModalBody.appendChild(metrics);

        const topUp = document.createElement('div');
        topUp.className = 'admin-credit-modal__topup';
        topUp.textContent = billing.dailyTopUp
            ? `Daily top-up: ${formatCredits(billing.dailyTopUp.grantedCredits)} granted for ${formatDate(billing.dailyTopUp.dayStart)}.`
            : `Daily top-up target: ${formatCredits(balance.dailyAllowance ?? billing.dailyCreditAllowance)}. Admin inspection does not apply a top-up.`;
        refs.creditModalBody.appendChild(topUp);

        const sectionTitle = document.createElement('h3');
        sectionTitle.className = 'admin-credit-modal__section-title';
        sectionTitle.textContent = 'Recent transactions';
        refs.creditModalBody.appendChild(sectionTitle);
        refs.creditModalBody.appendChild(renderUserCreditTransactions(transactions));
    }

    async function openUserCreditDetails(user) {
        if (!refs.creditModal || !refs.creditModalBody) return;
        if (refs.creditModalTitle) refs.creditModalTitle.textContent = 'Credit details';
        if (refs.creditModalSubtitle) refs.creditModalSubtitle.textContent = `${user.email || 'Selected user'} • ${shortUserId(user.id)}`;
        refs.creditModalBody.textContent = '';
        refs.creditModalBody.appendChild(userCreditState('Loading credit details...'));
        setUserCreditModalOpen(true);

        let res = null;
        try {
            res = await apiAdminUserBilling(user.id);
        } catch {
            res = { ok: false, error: 'Could not load credit details.' };
        }
        if (!res.ok) {
            refs.creditModalBody.textContent = '';
            refs.creditModalBody.appendChild(userCreditState(res.error || 'Could not load credit details.', 'error'));
            return;
        }
        renderUserCreditDetails(user, res.data?.billing || {});
    }

    function updatePagination(users) {
        if (!refs.pagination || !refs.paginationStatus || !refs.loadMoreBtn) return;
        if (!users || users.length === 0) {
            refs.pagination.style.display = 'none';
            refs.paginationStatus.textContent = '';
            return;
        }

        refs.pagination.style.display = '';
        refs.paginationStatus.textContent = usersHasMore
            ? `Showing ${users.length} users.`
            : `Showing all ${users.length} users.`;
        refs.loadMoreBtn.disabled = false;
        refs.loadMoreBtn.textContent = 'Load more users';
        refs.loadMoreBtn.style.display = usersHasMore ? '' : 'none';
    }

    function render(users) {
        refs.tbody.replaceChildren();
        refs.mobileList.replaceChildren();

        if (!users || users.length === 0) {
            refs.table.style.display = 'none';
            refs.mobileSection.style.display = 'none';
            refs.empty.style.display = '';
            updatePagination([]);
            return;
        }

        refs.empty.style.display = 'none';
        refs.table.style.display = '';
        refs.mobileSection.style.display = '';

        for (const user of users) {
            const tr = document.createElement('tr');

            const tdEmail = document.createElement('td');
            tdEmail.textContent = user.email;
            tr.appendChild(tdEmail);

            const tdUserId = document.createElement('td');
            tdUserId.className = 'admin-user-id-cell';
            tdUserId.appendChild(createUserIdMeta(user.id, { compact: true }));
            tr.appendChild(tdUserId);

            const tdRole = document.createElement('td');
            tdRole.appendChild(createBadge(user.role, user.role === 'admin' ? 'admin' : 'user'));
            tr.appendChild(tdRole);

            const tdStatus = document.createElement('td');
            tdStatus.appendChild(createBadge(user.status, user.status === 'active' ? 'active' : 'disabled'));
            tr.appendChild(tdStatus);

            const tdVerified = document.createElement('td');
            const isLegacyV = user.verification_method === 'legacy_auto';
            const isVerifiedV = !!user.email_verified_at && !isLegacyV;
            const vLabel = isVerifiedV ? 'Yes' : isLegacyV ? 'Legacy' : 'No';
            const vStyle = isVerifiedV ? 'active' : isLegacyV ? 'legacy' : 'disabled';
            tdVerified.appendChild(createBadge(vLabel, vStyle));
            tr.appendChild(tdVerified);

            const tdCreated = document.createElement('td');
            tdCreated.className = 'hide-mobile';
            tdCreated.textContent = formatDate(user.created_at);
            tr.appendChild(tdCreated);

            const tdActions = document.createElement('td');
            const actionsWrap = document.createElement('div');
            actionsWrap.className = 'admin-actions';
            appendUserActions(actionsWrap, user);
            tdActions.appendChild(actionsWrap);
            tr.appendChild(tdActions);
            refs.tbody.appendChild(tr);

            refs.mobileList.appendChild(buildMobileCard(user));
        }

        updatePagination(users);
    }

    async function load(search, { append = false } = {}) {
        const myVersion = ++usersVersion;
        const normalizedSearch = search?.trim() || refs.searchInput?.value.trim() || '';

        if (!append) {
            usersEntries = [];
            usersNextCursor = null;
            usersHasMore = false;
            refs.loading.style.display = '';
            refs.empty.style.display = 'none';
            refs.table.style.display = 'none';
            refs.mobileSection.style.display = 'none';
            if (refs.pagination) refs.pagination.style.display = 'none';
        } else if (refs.loadMoreBtn) {
            refs.loadMoreBtn.disabled = true;
            refs.loadMoreBtn.textContent = 'Loading...';
        }

        const res = await apiAdminUsers(normalizedSearch || undefined, {
            limit: USERS_LIMIT,
            cursor: append ? usersNextCursor : undefined,
        });

        if (myVersion !== usersVersion) return;

        if (!append) {
            refs.loading.style.display = 'none';
        } else if (refs.loadMoreBtn) {
            refs.loadMoreBtn.disabled = false;
            refs.loadMoreBtn.textContent = 'Load more users';
        }

        if (!res.ok) {
            showToast(res.error, 'error');
            return;
        }

        const users = Array.isArray(res.data?.users)
            ? res.data.users
            : Array.isArray(res.data)
                ? res.data
                : [];
        usersEntries = append ? usersEntries.concat(users) : users;
        usersNextCursor = typeof res.data?.next_cursor === 'string' ? res.data.next_cursor : null;
        usersHasMore = res.data?.has_more === true;

        render(usersEntries);
    }

    function bindModals() {
        if (refs.creditModal && refs.creditModal.dataset.bound !== '1') {
            refs.creditModal.dataset.bound = '1';
            refs.creditModal.querySelectorAll('[data-user-credit-close]').forEach((button) => {
                button.addEventListener('click', closeUserCreditDetails);
            });
        }
        if (refs.infoModal && refs.infoModal.dataset.bound !== '1') {
            refs.infoModal.dataset.bound = '1';
            refs.infoModal.querySelectorAll('[data-user-info-close]').forEach((button) => {
                button.addEventListener('click', closeUserInfoDetails);
            });
        }
        storage.bind();
        if (bindModals.escapeBound === true) return;
        bindModals.escapeBound = true;
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (refs.infoModal && !refs.infoModal.hidden) closeUserInfoDetails();
            if (refs.creditModal && !refs.creditModal.hidden) closeUserCreditDetails();
            storage.close();
        });
    }

    function bind() {
        bindModals();
        if (refs.searchForm && refs.searchForm.dataset.bound !== '1') {
            refs.searchForm.dataset.bound = '1';
            refs.searchForm.addEventListener('submit', (e) => {
                e.preventDefault();
                load(refs.searchInput.value.trim());
            });
        }
        if (refs.loadMoreBtn && refs.loadMoreBtn.dataset.bound !== '1') {
            refs.loadMoreBtn.dataset.bound = '1';
            refs.loadMoreBtn.addEventListener('click', () => {
                if (!usersHasMore || !usersNextCursor) return;
                load(refs.searchInput.value.trim(), { append: true });
            });
        }
    }

    return {
        bind,
        load,
    };
}
