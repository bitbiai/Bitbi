/* ============================================================
   BITBI — Admin Control Plane / Billing + Organizations Domain
   Frontend-only rendering and event binding for billing/operator evidence.
   ============================================================ */

import {
    apiAdminBillingEvent,
    apiAdminBillingEvidenceStatus,
    apiAdminBillingEvents,
    apiAdminBillingLiveReadinessStatus,
    apiAdminBillingPlans,
    apiAdminBillingReconciliation,
    apiAdminBillingReview,
    apiAdminBillingReviews,
    apiAdminBillingOperatorArchive,
    apiAdminArchiveBillingItems,
    apiAdminRestoreBillingItems,
    apiAdminAssignOrganizationUser,
    apiAdminGrantOrganizationCredits,
    apiAdminGrantUserCredits,
    apiAdminOrganization,
    apiAdminOrganizationBilling,
    apiAdminOrganizationUserAccess,
    apiAdminOrganizations,
    apiAdminRemoveOrganizationUser,
    apiAdminResolveBillingReview,
    apiAdminUserBilling,
    apiAdminUsers,
} from '../../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    addCell,
    apiUnavailableMessage,
    badge,
    byId,
    clear,
    copyTextToClipboard,
    createIdempotencyKey,
    detailRows,
    downloadTextFile,
    el,
    isSensitiveKey,
    notReported,
    readableToken,
    renderJsonSummary,
    renderUnavailable,
    safeSummaryValue,
    setState,
    setSubmitting,
    shortId,
    table,
    variantFor,
} from './core.js?v=__ASSET_VERSION__';

export function createBillingDomain({ notify, formatDate }) {
    const billingTargets = {
        orgLookup: null,
        userLookup: null,
        orgGrant: null,
        userGrant: null,
    };
    let selectedBillingReviewId = '';
    let billingReviewResolutionSubmitting = false;
    let visibleBillingEventRefs = [];
    let visibleBillingReviewRefs = [];

    function normalizeLookupValue(value) {
        return String(value || '').trim().toLowerCase();
    }

    function orgDisplayName(org) {
        return org?.name || org?.companyName || org?.company_name || org?.slug || 'Organization';
    }

    function userDisplayEmail(user) {
        return user?.email || user?.userEmail || user?.user_email || '';
    }

    function organizationAccessLabel(user, orgName) {
        const email = user?.email || 'User without email';
        return `${email} organization access for ${orgName}`;
    }

    function clearLookupMatches(id) {
        clear(byId(id));
    }

    function renderLookupMatches(holderId, items, labelFn, onSelect) {
        const holder = byId(holderId);
        if (!holder) return;
        clear(holder);
        if (!items.length) return;
        const row = el('div', 'admin-control-chip-row');
        for (const item of items.slice(0, 8)) {
            const button = el('button', 'btn-action', labelFn(item));
            button.type = 'button';
            button.addEventListener('click', () => onSelect(item));
            row.appendChild(button);
        }
        holder.appendChild(row);
    }

    function rememberLookupTarget({ key, inputId, matchesId, target, label, stateId, message }) {
        billingTargets[key] = target;
        const input = byId(inputId);
        if (input) input.value = label;
        clearLookupMatches(matchesId);
        if (stateId && message) setState(stateId, message);
    }

    function matchingStoredTarget({ key, inputId, labelFn }) {
        const inputValue = normalizeLookupValue(byId(inputId)?.value);
        const target = billingTargets[key];
        if (!inputValue || !target) return null;
        return normalizeLookupValue(labelFn(target)) === inputValue ? target : null;
    }

    async function resolveOrganizationByName({ inputId, matchesId, stateId, key, onSelect }) {
        const existing = matchingStoredTarget({ key, inputId, labelFn: orgDisplayName });
        if (existing) return existing;
        const search = byId(inputId)?.value.trim();
        billingTargets[key] = null;
        clearLookupMatches(matchesId);
        if (!search) {
            setState(stateId, 'Enter an organization name to continue.', 'error');
            return null;
        }
        setState(stateId, 'Finding organization...');
        const res = await apiAdminOrganizations({ search, limit: 10 });
        if (!res.ok) {
            setState(stateId, apiUnavailableMessage(res, 'Organization lookup failed.'), 'error');
            return null;
        }
        const orgs = Array.isArray(res.data?.organizations) ? res.data.organizations : [];
        if (orgs.length === 0) {
            setState(stateId, 'No organization found by that name.', 'error');
            return null;
        }
        const normalizedSearch = normalizeLookupValue(search);
        const exactMatches = orgs.filter((org) => (
            normalizeLookupValue(orgDisplayName(org)) === normalizedSearch
            || normalizeLookupValue(org.slug) === normalizedSearch
        ));
        const chosen = exactMatches.length === 1 ? exactMatches[0] : (orgs.length === 1 ? orgs[0] : null);
        if (chosen) {
            rememberLookupTarget({
                key,
                inputId,
                matchesId,
                target: chosen,
                label: orgDisplayName(chosen),
                stateId,
                message: 'Organization selected.',
            });
            return chosen;
        }
        renderLookupMatches(
            matchesId,
            orgs,
            (org) => [orgDisplayName(org), org.createdByEmail ? `created by ${org.createdByEmail}` : org.slug]
                .filter(Boolean)
                .join(' - '),
            (org) => {
                rememberLookupTarget({
                    key,
                    inputId,
                    matchesId,
                    target: org,
                    label: orgDisplayName(org),
                    stateId,
                    message: 'Organization selected.',
                });
                if (typeof onSelect === 'function') onSelect(org);
            },
        );
        setState(stateId, 'Multiple organizations matched. Select one result.', 'error');
        return null;
    }

    async function resolveUserByEmail({ inputId, matchesId, stateId, key, onSelect }) {
        const existing = matchingStoredTarget({ key, inputId, labelFn: userDisplayEmail });
        if (existing) return existing;
        const search = byId(inputId)?.value.trim();
        billingTargets[key] = null;
        clearLookupMatches(matchesId);
        if (!search) {
            setState(stateId, 'Enter a user email address to continue.', 'error');
            return null;
        }
        setState(stateId, 'Finding user...');
        const res = await apiAdminUsers(search, { limit: 10 });
        if (!res.ok) {
            setState(stateId, apiUnavailableMessage(res, 'User lookup failed.'), 'error');
            return null;
        }
        const users = Array.isArray(res.data?.users) ? res.data.users : [];
        if (users.length === 0) {
            setState(stateId, 'No user found by that email.', 'error');
            return null;
        }
        const normalizedSearch = normalizeLookupValue(search);
        const exactMatches = users.filter((user) => normalizeLookupValue(userDisplayEmail(user)) === normalizedSearch);
        const chosen = exactMatches.length === 1 ? exactMatches[0] : (users.length === 1 ? users[0] : null);
        if (chosen) {
            rememberLookupTarget({
                key,
                inputId,
                matchesId,
                target: chosen,
                label: userDisplayEmail(chosen),
                stateId,
                message: 'User selected.',
            });
            return chosen;
        }
        renderLookupMatches(
            matchesId,
            users,
            (user) => userDisplayEmail(user) || 'User without email',
            (user) => {
                rememberLookupTarget({
                    key,
                    inputId,
                    matchesId,
                    target: user,
                    label: userDisplayEmail(user),
                    stateId,
                    message: 'User selected.',
                });
                if (typeof onSelect === 'function') onSelect(user);
            },
        );
        setState(stateId, 'Multiple users matched. Select one email.', 'error');
        return null;
    }

    async function loadOrgs() {
        const state = byId('orgsState');
        const list = byId('orgsList');
        setState('orgsState', 'Loading organizations...');
        clear(list);
        const res = await apiAdminOrganizations({ limit: 50 });
        if (!res.ok) {
            setState('orgsState', '');
            renderUnavailable(list, res, 'Organizations API unavailable.');
            return;
        }
        const orgs = Array.isArray(res.data?.organizations) ? res.data.organizations : [];
        if (orgs.length === 0) {
            setState('orgsState', 'No organizations found.');
            return;
        }
        setState('orgsState', `Showing ${orgs.length} organizations.`);
        const { wrap, tbody } = table(['Organization', 'Status', 'Members', 'Created by', 'Created', 'Actions']);
        for (const org of orgs) {
            const tr = document.createElement('tr');
            addCell(tr, org.name || shortId(org.id));
            addCell(tr, badge(org.status || 'unknown', variantFor(org.status)));
            addCell(tr, org.memberCount ?? org.member_count ?? '-');
            addCell(tr, org.createdByEmail || '-');
            addCell(tr, formatDate(org.createdAt || org.created_at));
            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'btn-action';
            action.textContent = 'Inspect';
            action.addEventListener('click', () => loadOrgDetail(org.id));
            addCell(tr, action);
            tbody.appendChild(tr);
        }
        clear(list);
        list.appendChild(wrap);
    }

    async function loadOrgDetail(orgId) {
        const detail = byId('orgDetail');
        if (!detail) return;
        detail.hidden = false;
        detail.textContent = 'Loading organization detail...';
        const res = await apiAdminOrganization(orgId);
        clear(detail);
        if (!res.ok) {
            renderUnavailable(detail, res, 'Organization detail unavailable.');
            return;
        }
        const org = res.data?.organization || {};
        detail.appendChild(el('h3', 'admin-section-title', org.name || 'Organization Detail'));
        detail.appendChild(detailRows([
            ['Organization ID', shortId(org.id)],
            ['Status', notReported(org.status)],
            ['Slug', notReported(org.slug)],
            ['Created by', notReported(org.createdByEmail)],
            ['Created', formatDate(org.createdAt || org.created_at)],
        ]));
        const members = Array.isArray(res.data?.members) ? res.data.members : [];
        const { wrap, tbody } = table(['Email', 'Role', 'Status', 'Created']);
        for (const member of members) {
            const tr = document.createElement('tr');
            addCell(tr, member.email || shortId(member.userId || member.user_id));
            addCell(tr, badge(member.role, member.role === 'owner' || member.role === 'admin' ? 'admin' : 'user'));
            addCell(tr, badge(member.status, variantFor(member.status)));
            addCell(tr, formatDate(member.createdAt || member.created_at));
            tbody.appendChild(tr);
        }
        detail.appendChild(wrap);
        const accessRefs = renderOrgUserAccessShell(detail, org);
        await loadOrgUserAccess(org.id, accessRefs);
    }

    function renderOrgUserAccessShell(detail, org) {
        const orgName = org.name || 'this organization';
        const section = el('section', 'admin-org-access');
        const header = el('div', 'admin-org-access__header');
        const copy = el('div');
        copy.appendChild(el('h3', 'admin-section-title', 'Organization user access'));
        copy.appendChild(el('p', 'admin-shell__desc', 'Membership controls organization context. It does not override tenant isolation, billing, AI budget safety, or Admin AI organization-context guards.'));
        header.appendChild(copy);
        section.appendChild(header);

        const form = el('form', 'admin-org-access__search');
        const label = el('label', 'sr-only', 'Search users for organization access');
        const searchId = `orgAccessSearch-${org.id}`;
        label.setAttribute('for', searchId);
        const input = document.createElement('input');
        input.id = searchId;
        input.className = 'admin-ai__input';
        input.type = 'search';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder = 'Search users by email...';
        const button = el('button', 'btn-action', 'Search users');
        button.type = 'submit';
        form.append(label, input, button);
        section.appendChild(form);

        const state = el('div', 'admin-state', 'Loading user access...');
        state.setAttribute('aria-live', 'polite');
        const list = el('div', 'admin-org-access__list');
        section.append(state, list);
        detail.appendChild(section);

        const refs = { org, orgName, input, state, list };
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            loadOrgUserAccess(org.id, refs);
        });
        return refs;
    }

    async function loadOrgUserAccess(orgId, refs, { successMessage = '' } = {}) {
        if (!refs?.list || !refs?.state) return;
        refs.state.textContent = successMessage || 'Loading user access...';
        refs.state.dataset.state = 'neutral';
        clear(refs.list);
        const res = await apiAdminOrganizationUserAccess(orgId, {
            search: refs.input?.value.trim(),
            limit: 100,
        });
        if (!res.ok) {
            renderUnavailable(refs.list, res, 'Organization user access unavailable.');
            refs.state.textContent = '';
            return;
        }
        const users = Array.isArray(res.data?.users) ? res.data.users : [];
        renderOrgUserAccessList(users, refs);
        refs.state.textContent = successMessage || (users.length
            ? `Showing ${users.length} users for assignment.`
            : 'No users matched that search.');
        refs.state.dataset.state = successMessage ? 'success' : 'neutral';
    }

    function renderOrgUserAccessList(users, refs) {
        clear(refs.list);
        if (!users.length) {
            refs.list.appendChild(el('div', 'admin-shell__empty', 'No users found for this organization access search.'));
            return;
        }
        const stack = el('div', 'admin-org-access__rows');
        for (const user of users) {
            const email = user.email || 'User without email';
            const rowNode = el('article', 'admin-org-access__row');
            const text = el('div', 'admin-org-access__user');
            text.appendChild(el('strong', null, email));
            const meta = [
                user.accountRole ? `Account role: ${user.accountRole}` : '',
                user.accountStatus ? `Status: ${user.accountStatus}` : '',
                user.membership?.role ? `Org role: ${user.membership.role}` : 'Org role: none',
            ].filter(Boolean).join(' | ');
            text.appendChild(el('span', 'admin-inventory__meta', meta || 'No account metadata reported'));

            const switchLabel = el('label', 'admin-org-access__switch');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.setAttribute('role', 'switch');
            checkbox.checked = user.assigned === true;
            checkbox.setAttribute('aria-checked', String(checkbox.checked));
            checkbox.setAttribute('aria-label', organizationAccessLabel(user, refs.orgName));
            checkbox.disabled = user.accountStatus && user.accountStatus !== 'active';
            checkbox.addEventListener('change', () => toggleOrgUserAccess({
                checkbox,
                user,
                org: refs.org,
                refs,
            }));
            const visual = el('span', 'admin-org-access__switch-track');
            visual.setAttribute('aria-hidden', 'true');
            const labelText = el('span', 'admin-org-access__switch-text', checkbox.checked ? 'Assigned' : 'Not assigned');
            switchLabel.append(checkbox, visual, labelText);
            rowNode.append(text, switchLabel);
            stack.appendChild(rowNode);
        }
        refs.list.appendChild(stack);
    }

    async function toggleOrgUserAccess({ checkbox, user, org, refs }) {
        const targetAssigned = checkbox.checked === true;
        const previousAssigned = !targetAssigned;
        checkbox.disabled = true;
        checkbox.setAttribute('aria-checked', String(targetAssigned));
        refs.state.dataset.state = 'neutral';
        refs.state.textContent = targetAssigned
            ? `Assigning ${user.email || 'user'} to ${refs.orgName}...`
            : `Removing ${user.email || 'user'} from ${refs.orgName}...`;
        const idempotencyKey = createIdempotencyKey(targetAssigned ? 'admin-org-assign' : 'admin-org-remove');
        const res = targetAssigned
            ? await apiAdminAssignOrganizationUser(org.id, user.userId, { idempotencyKey })
            : await apiAdminRemoveOrganizationUser(org.id, user.userId, { idempotencyKey });
        if (!res.ok) {
            checkbox.checked = previousAssigned;
            checkbox.setAttribute('aria-checked', String(previousAssigned));
            checkbox.disabled = false;
            refs.state.dataset.state = 'error';
            refs.state.textContent = apiUnavailableMessage(res, targetAssigned
                ? 'Assignment failed. Try again.'
                : 'Removal failed. Try again.');
            if (typeof notify === 'function') notify(refs.state.textContent, 'error');
            return;
        }
        const success = targetAssigned
            ? `${user.email || 'User'} assigned to ${refs.orgName}.`
            : `${user.email || 'User'} removed from ${refs.orgName}.`;
        if (typeof notify === 'function') notify(success, 'success');
        await loadOrgUserAccess(org.id, refs, { successMessage: success });
    }

    async function loadBillingPlans() {
        const holder = byId('billingPlans');
        setState('billingPlansState', 'Loading plans...');
        clear(holder);
        const res = await apiAdminBillingPlans();
        if (!res.ok) {
            setState('billingPlansState', '');
            renderUnavailable(holder, res, 'Billing plan API unavailable.');
            return;
        }
        const plans = Array.isArray(res.data?.plans) ? res.data.plans : [];
        setState('billingPlansState', res.data?.livePaymentProviderEnabled === false
            ? 'Live payment provider disabled.'
            : 'Plan catalog loaded.');
        if (plans.length === 0) {
            renderUnavailable(holder, null, 'No plans found.');
            return;
        }
        const stack = el('div', 'admin-control-stack');
        for (const plan of plans) {
            const card = el('article', 'admin-control-mini-card');
            const head = el('div', 'admin-control-card__top');
            head.append(el('strong', null, plan.name || plan.code), badge(plan.status || 'unknown', variantFor(plan.status)));
            card.appendChild(head);
            const entitlements = Array.isArray(plan.entitlements) ? plan.entitlements : [];
            card.appendChild(detailRows([
                ['Code', plan.code || '-'],
                ['Monthly credits', plan.monthlyCreditGrant ?? plan.monthly_credit_grant ?? '-'],
                ['Entitlements', entitlements.map((ent) => ent.featureKey || ent.feature_key || ent.key || ent.feature).filter(Boolean).join(', ') || '-'],
            ]));
            stack.appendChild(card);
        }
        holder.appendChild(stack);
    }

    async function loadOrgBilling(orgId, organization = null) {
        const state = byId('orgBillingState');
        const detail = byId('orgBillingDetail');
        clear(detail);
        if (!orgId) {
            setState('orgBillingState', 'Enter an organization name to inspect billing state.');
            return;
        }
        setState('orgBillingState', 'Loading organization billing...');
        const res = await apiAdminOrganizationBilling(orgId);
        if (!res.ok) {
            setState('orgBillingState', '');
            renderUnavailable(detail, res, 'Organization billing unavailable.');
            return;
        }
        const billing = res.data?.billing || {};
        setState('orgBillingState', 'Billing state loaded.');
        detail.appendChild(detailRows([
            ['Organization', orgDisplayName(organization) || '-'],
            ['Plan', billing.plan?.name || billing.planCode || billing.plan?.code || '-'],
            ['Credit balance', billing.creditBalance ?? billing.balance ?? '-'],
            ['Live payments', 'Disabled'],
        ]));
        const entitlements = Array.isArray(billing.entitlements)
            ? billing.entitlements
            : Object.entries(billing.entitlements || {}).map(([feature, value]) => ({ feature, value }));
        if (entitlements.length > 0) {
            const chips = el('div', 'admin-control-chip-row');
            for (const ent of entitlements.slice(0, 16)) {
            const feature = ent.featureKey || ent.feature_key || ent.feature || ent[0];
            if (feature && !isSensitiveKey(feature)) chips.appendChild(badge(feature, 'user'));
        }
            detail.appendChild(chips);
        }
    }

    async function loadUserBilling(userId, user = null) {
        const detail = byId('userBillingDetail');
        clear(detail);
        if (!userId) {
            setState('userBillingState', 'Enter a user email to inspect member credit state.');
            return;
        }
        setState('userBillingState', 'Loading user billing...');
        const res = await apiAdminUserBilling(userId);
        if (!res.ok) {
            setState('userBillingState', '');
            renderUnavailable(detail, res, 'User billing unavailable.');
            return;
        }
        const billing = res.data?.billing || {};
        setState('userBillingState', 'User billing state loaded.');
        detail.appendChild(detailRows([
            ['User email', billing.email || userDisplayEmail(user) || '-'],
            ['Role', billing.role || '-'],
            ['Status', billing.status || '-'],
            ['Credit balance', billing.creditBalance ?? '-'],
            ['Daily top-up target', billing.dailyCreditAllowance ?? '-'],
        ]));
    }

    async function handleCreditGrant(event) {
        event.preventDefault();
        const submitButton = event.submitter;
        const org = await resolveOrganizationByName({
            inputId: 'creditGrantOrgSearch',
            matchesId: 'creditGrantOrgMatches',
            stateId: 'creditGrantResult',
            key: 'orgGrant',
        });
        const amount = Number(byId('creditGrantAmount')?.value);
        const reason = byId('creditGrantReason')?.value.trim();
        if (!org || !org.id || !Number.isInteger(amount) || amount <= 0 || !reason) {
            setState('creditGrantResult', 'Organization name, positive credit amount, and reason are required.', 'error');
            return;
        }
        if (!confirm(`Grant ${amount} credits to ${orgDisplayName(org)}? This creates a credit ledger entry.`)) {
            return;
        }
        const idempotencyKey = createIdempotencyKey('admin-credit-grant');
        setState('creditGrantResult', 'Submitting credit grant...');
        setSubmitting(submitButton, true);
        try {
            const res = await apiAdminGrantOrganizationCredits(org.id, { amount, reason, idempotencyKey });
            if (!res.ok) {
                setState('creditGrantResult', apiUnavailableMessage(res, 'Credit grant failed.'), 'error');
                notify('Credit grant failed.', 'error');
                return;
            }
            const balance = res.data?.ledgerEntry?.balanceAfter ?? res.data?.ledgerEntry?.balance_after ?? '-';
            setState('creditGrantResult', `Credit grant recorded for ${orgDisplayName(org)}. Balance after: ${balance}.`, 'success');
            notify('Credit grant recorded.', 'success');
            const lookup = byId('orgBillingSearch');
            if (lookup) lookup.value = orgDisplayName(org);
            billingTargets.orgLookup = org;
            loadOrgBilling(org.id, org);
        } finally {
            setSubmitting(submitButton, false);
        }
    }

    async function handleUserCreditGrant(event) {
        event.preventDefault();
        const submitButton = event.submitter;
        const user = await resolveUserByEmail({
            inputId: 'creditGrantUserSearch',
            matchesId: 'creditGrantUserMatches',
            stateId: 'userCreditGrantResult',
            key: 'userGrant',
        });
        const amount = Number(byId('userCreditGrantAmount')?.value);
        const reason = byId('userCreditGrantReason')?.value.trim();
        if (!user || !user.id || !Number.isInteger(amount) || amount <= 0 || !reason) {
            setState('userCreditGrantResult', 'User email, positive credit amount, and reason are required.', 'error');
            return;
        }
        if (!confirm(`Grant ${amount} credits to ${userDisplayEmail(user)}? This creates a member credit ledger entry.`)) {
            return;
        }
        const idempotencyKey = createIdempotencyKey('admin-user-credit-grant');
        setState('userCreditGrantResult', 'Submitting user credit grant...');
        setSubmitting(submitButton, true);
        try {
            const res = await apiAdminGrantUserCredits(user.id, { amount, reason, idempotencyKey });
            if (!res.ok) {
                setState('userCreditGrantResult', apiUnavailableMessage(res, 'User credit grant failed.'), 'error');
                notify('User credit grant failed.', 'error');
                return;
            }
            const balance = res.data?.ledgerEntry?.balanceAfter ?? res.data?.ledgerEntry?.balance_after ?? '-';
            setState('userCreditGrantResult', `User credit grant recorded for ${userDisplayEmail(user)}. Balance after: ${balance}.`, 'success');
            notify('User credit grant recorded.', 'success');
            const lookup = byId('userBillingSearch');
            if (lookup) lookup.value = userDisplayEmail(user);
            billingTargets.userLookup = user;
            loadUserBilling(user.id, user);
        } finally {
            setSubmitting(submitButton, false);
        }
    }

    function archiveSummaryText(summary = {}) {
        const total = Number(summary.totalArchived || 0);
        const hidden = Number(summary.hiddenArchivedCount || 0);
        if (hidden > 0) {
            return `Archivierte Einträge sind in dieser aktiven Ansicht ausgeblendet (${hidden} in diesem Filter, ${total} insgesamt). Öffne das Archiv, um sie zu sehen.`;
        }
        if (total > 0) {
            return `Archivierte Einträge sind in aktiven Auswertungen ausgeblendet (${total} insgesamt). Öffne das Archiv, um sie zu sehen.`;
        }
        return 'Archivierte Einträge sind in dieser aktiven Ansicht ausgeblendet. Öffne das Archiv, um sie zu sehen.';
    }

    function appendArchiveNote(container, summary = {}) {
        if (!container) return;
        const note = el('p', 'admin-shell__desc admin-billing-archive-note', archiveSummaryText(summary));
        container.appendChild(note);
    }

    function eventArchiveRef(event, itemType = 'billing_provider_event') {
        if (!event?.id) return null;
        return {
            itemType,
            itemId: event.id,
            providerEventId: event.providerEventId || null,
            eventType: event.eventType || null,
        };
    }

    function reviewArchiveRef(review) {
        if (!review?.id) return null;
        return {
            itemType: 'billing_review',
            itemId: review.id,
            providerEventId: review.providerEventId || null,
            eventType: review.eventType || null,
        };
    }

    function nonEmptyRefs(refs) {
        return (Array.isArray(refs) ? refs : []).filter((ref) => ref?.itemType && ref?.itemId);
    }

    function providerEventIdsFromArchiveRefs(refs) {
        const ids = new Set();
        for (const ref of nonEmptyRefs(refs)) {
            const itemId = String(ref.itemId || '');
            if ((ref.itemType === 'billing_provider_event' || ref.itemType === 'billing_review') && itemId.startsWith('bpe_')) {
                ids.add(itemId);
            } else if ((ref.itemType === 'payment_problem' || ref.itemType === 'reconciliation_item') && itemId.startsWith('event-bpe_')) {
                ids.add(itemId.slice('event-'.length));
            } else if ((ref.itemType === 'payment_problem' || ref.itemType === 'reconciliation_item') && itemId.startsWith('bpe_')) {
                ids.add(itemId);
            }
            if (String(ref.billingEventId || '').startsWith('bpe_')) ids.add(ref.billingEventId);
            if (String(ref.id || '').startsWith('bpe_')) ids.add(ref.id);
        }
        return [...ids];
    }

    async function verifyArchivedRefsHiddenFromActiveEvents(refs, stateId) {
        const archivedEventIds = providerEventIdsFromArchiveRefs(refs);
        if (archivedEventIds.length === 0) return true;
        const provider = byId('billingEventsProvider')?.value || '';
        const status = byId('billingEventsStatus')?.value || '';
        const res = await apiAdminBillingEvents({ provider, status, limit: 100 });
        if (!res.ok) {
            setState(stateId, apiUnavailableMessage(res, 'Archiv wurde gespeichert, aber die aktive Ansicht konnte nicht nachgeprüft werden.'), 'error');
            return false;
        }
        const returned = (Array.isArray(res.data?.events) ? res.data.events : [])
            .filter((event) => archivedEventIds.includes(event.id));
        if (returned.length > 0) {
            setState(
                stateId,
                `Archiv wurde gespeichert, aber die aktive API liefert weiterhin archivierte IDs: ${returned.map((event) => shortId(event.id)).join(', ')}. Bitte Auth-Worker-Deploy und Migration prüfen.`,
                'error'
            );
            notify('Archiv-Regressionsprüfung fehlgeschlagen.', 'error');
            return false;
        }
        return true;
    }

    async function refreshBillingArchiveDependentPanels() {
        await Promise.all([
            loadBillingEvidenceStatus(),
            loadBillingReconciliation(),
            loadBillingReviews(),
            loadBillingEvents(),
            loadOperatorBillingArchive(),
        ]);
    }

    async function archiveBillingRefs(refs, { stateId = 'billingArchiveActionState', defaultReason = 'Aus aktiver Admin-Billing-Auswertung archiviert.' } = {}) {
        const itemRefs = nonEmptyRefs(refs);
        if (itemRefs.length === 0) {
            setState(stateId, 'Keine archivfähigen Einträge ausgewählt.', 'error');
            return;
        }
        const reason = window.prompt(
            'Grund für das Archivieren eingeben. Keine Secrets, Cookies, Karten- oder Rohdaten eintragen.',
            defaultReason
        );
        if (!reason || !reason.trim()) {
            setState(stateId, 'Archivieren abgebrochen: Grund ist erforderlich.', 'error');
            return;
        }
        if (!window.confirm(`Archivieren blendet ${itemRefs.length} Eintrag/Einträge nur aus der aktiven Auswertung aus. Im Archiv bleiben sie erhalten und können wiederhergestellt werden.`)) {
            setState(stateId, 'Archivieren abgebrochen.', 'neutral');
            return;
        }
        setState(stateId, 'Archivieren läuft...');
        const res = await apiAdminArchiveBillingItems({
            itemRefs,
            reason: reason.trim(),
            dryRun: false,
        }, {
            idempotencyKey: createIdempotencyKey('admin-billing-archive'),
        });
        if (!res.ok) {
            setState(stateId, apiUnavailableMessage(res, 'Archivieren fehlgeschlagen.'), 'error');
            notify('Archivieren fehlgeschlagen.', 'error');
            return;
        }
        setState(stateId, `${itemRefs.length} Eintrag/Einträge wurden aus der aktiven Ansicht ausgeblendet.`, 'success');
        notify('Einträge archiviert.', 'success');
        await refreshBillingArchiveDependentPanels();
        await verifyArchivedRefsHiddenFromActiveEvents(itemRefs, stateId);
    }

    async function restoreBillingRefs(refs, { stateId = 'billingArchiveState' } = {}) {
        const itemRefs = nonEmptyRefs(refs);
        if (itemRefs.length === 0) {
            setState(stateId, 'Keine archivierten Einträge ausgewählt.', 'error');
            return;
        }
        const reason = window.prompt(
            'Grund für die Wiederherstellung eingeben.',
            'Archivierten Admin-Billing-Eintrag wieder sichtbar machen.'
        );
        if (!reason || !reason.trim()) {
            setState(stateId, 'Wiederherstellen abgebrochen: Grund ist erforderlich.', 'error');
            return;
        }
        setState(stateId, 'Wiederherstellung läuft...');
        const res = await apiAdminRestoreBillingItems({
            itemRefs,
            reason: reason.trim(),
        }, {
            idempotencyKey: createIdempotencyKey('admin-billing-restore'),
        });
        if (!res.ok) {
            setState(stateId, apiUnavailableMessage(res, 'Wiederherstellung fehlgeschlagen.'), 'error');
            notify('Wiederherstellung fehlgeschlagen.', 'error');
            return;
        }
        setState(stateId, `${itemRefs.length} Eintrag/Einträge wurden wiederhergestellt.`, 'success');
        notify('Einträge wiederhergestellt.', 'success');
        await refreshBillingArchiveDependentPanels();
    }

    async function loadBillingEvents() {
        const provider = byId('billingEventsProvider')?.value || '';
        const status = byId('billingEventsStatus')?.value || '';
        const list = byId('billingEventsList');
        setState('billingEventsState', 'Loading billing events...');
        clear(list);
        const res = await apiAdminBillingEvents({ provider, status, limit: 25 });
        if (!res.ok) {
            setState('billingEventsState', '');
            renderUnavailable(list, res, 'Billing events unavailable.');
            return;
        }
        const rawEvents = Array.isArray(res.data?.events) ? res.data.events : [];
        const leakedArchivedEvents = rawEvents.filter((event) => event?.archived === true);
        const events = rawEvents.filter((event) => event?.archived !== true);
        visibleBillingEventRefs = events.map((event) => eventArchiveRef(event)).filter(Boolean);
        appendArchiveNote(list, res.data?.archiveSummary || {});
        if (leakedArchivedEvents.length > 0) {
            setState(
                'billingEventsState',
                `Aktive API hat archivierte Einträge zurückgegeben: ${leakedArchivedEvents.map((event) => shortId(event.id)).join(', ')}. Diese Zeilen werden nicht als aktive Einträge gerendert; bitte Auth-Worker prüfen.`,
                'error'
            );
        }
        if (events.length === 0) {
            if (leakedArchivedEvents.length === 0) {
                setState('billingEventsState', `Keine aktiven Billing Events gefunden. Archivierte Einträge findest du im Archiv. ${archiveSummaryText(res.data?.archiveSummary || {})}`);
            }
            return;
        }
        if (leakedArchivedEvents.length === 0) {
            setState('billingEventsState', `Showing ${events.length} sanitized events in the active view. ${archiveSummaryText(res.data?.archiveSummary || {})}`);
        }
        const { wrap, tbody } = table(['Provider', 'Mode', 'Type', 'Status', 'Organization', 'Received', 'Actions']);
        for (const event of events) {
            const tr = document.createElement('tr');
            addCell(tr, event.provider || '-');
            addCell(tr, badge(event.providerMode || '-', event.providerMode === 'live' ? 'disabled' : 'user'));
            addCell(tr, event.eventType || '-');
            addCell(tr, badge(event.processingStatus || '-', variantFor(event.processingStatus)));
            addCell(tr, shortId(event.organizationId));
            addCell(tr, formatDate(event.receivedAt));
            const actions = el('div', 'admin-control-chip-row');
            const btn = el('button', 'btn-action', 'Inspect');
            btn.type = 'button';
            btn.addEventListener('click', () => loadBillingEventDetail(event.id));
            const archiveBtn = el('button', 'btn-action btn-action--secondary', 'Archivieren');
            archiveBtn.type = 'button';
            archiveBtn.addEventListener('click', () => archiveBillingRefs([eventArchiveRef(event)], {
                stateId: 'billingEventsState',
                defaultReason: `Provider Event ${shortId(event.id)} aus aktiver Admin-Ansicht archivieren.`,
            }));
            actions.append(btn, archiveBtn);
            addCell(tr, actions);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);
    }

    async function loadBillingEventDetail(eventId) {
        const detail = byId('billingEventDetail');
        detail.hidden = false;
        detail.textContent = 'Loading billing event detail...';
        const res = await apiAdminBillingEvent(eventId);
        clear(detail);
        if (!res.ok) {
            renderUnavailable(detail, res, 'Billing event detail unavailable.');
            return;
        }
        const event = res.data?.event || {};
        detail.appendChild(el('h3', 'admin-section-title', 'Billing Event Detail'));
        detail.appendChild(detailRows([
            ['Event ID', shortId(event.id)],
            ['Provider', event.provider || '-'],
            ['Mode', event.providerMode || '-'],
            ['Type', event.eventType || '-'],
            ['Processing', event.processingStatus || '-'],
            ['Verification', event.verificationStatus || '-'],
            ['Organization', shortId(event.organizationId)],
            ['Received', formatDate(event.receivedAt)],
            ['Summary', renderJsonSummary(event.payloadSummary)],
        ]));
        const archiveActions = el('div', 'admin-control-chip-row');
        const archiveButton = el('button', 'btn-action btn-action--secondary', 'Diesen Eintrag archivieren');
        archiveButton.type = 'button';
        archiveButton.addEventListener('click', () => archiveBillingRefs([eventArchiveRef(event)], {
            stateId: 'billingEventsState',
            defaultReason: `Provider Event ${shortId(event.id)} aus aktiver Admin-Ansicht archivieren.`,
        }));
        archiveActions.appendChild(archiveButton);
        detail.appendChild(archiveActions);
        if (Array.isArray(event.actions) && event.actions.length) {
            const { wrap, tbody } = table(['Action', 'Status', 'Dry-run', 'Summary']);
            for (const action of event.actions) {
                const tr = document.createElement('tr');
                addCell(tr, action.actionType || '-');
                addCell(tr, badge(action.status || '-', variantFor(action.status)));
                addCell(tr, action.dryRun ? 'Yes' : 'No');
                addCell(tr, renderJsonSummary(action.summary));
                tbody.appendChild(tr);
            }
            detail.appendChild(wrap);
        }
    }

    function renderBillingEvidenceCard({ title, badgeLabel, badgeVariant = 'user', copy, rows = [], actions = [] }) {
        const card = el('article', 'admin-control-card glass glass-card reveal visible');
        const top = el('div', 'admin-control-card__top');
        top.append(el('h3', 'admin-section-title', title), badge(badgeLabel, badgeVariant));
        card.appendChild(top);
        if (copy) card.appendChild(el('p', 'admin-shell__desc', copy));
        if (rows.length) card.appendChild(detailRows(rows));
        if (actions.length) {
            const actionRow = el('div', 'admin-control-chip-row');
            for (const action of actions) actionRow.appendChild(action);
            card.appendChild(actionRow);
        }
        return card;
    }

    function evidenceStatusBadge(status) {
        const value = String(status || '').toLowerCase();
        if (value.includes('configured') || value.includes('present_https') || value.includes('shape_ok')) return ['configured', 'active'];
        if (value.includes('missing') || value.includes('blocked') || value.includes('invalid')) return ['blocked', 'disabled'];
        if (value.includes('pending') || value.includes('review')) return ['pending', 'legacy'];
        return [status || 'reported', 'user'];
    }

    function liveBillingBadgeVariant(value) {
        const text = String(value || '').toLowerCase();
        if (text.includes('no critical') || text.includes('no_critical')) return 'active';
        if (text.includes('blocked') || text.includes('missing') || text.includes('invalid')) return 'disabled';
        if (
            text.includes('operator_approved_live')
            || text.includes('operator_go_live_approved')
            || text.includes('operator approved live')
            || text.includes('operator go live approved')
            || text.includes('partial_evidence_operator_approved')
        ) return 'active';
        if (
            text.includes('critical')
            || text.includes('warning')
            || text.includes('pending')
            || text.includes('waived')
            || text.includes('partial')
            || text.includes('review')
        ) return 'legacy';
        if (
            text.includes('ready')
            || text.includes('configured')
            || text.includes('present')
            || text.includes('approved')
            || text.includes('operator')
            || text.includes('live')
            || text.includes('enabled')
        ) return 'active';
        return 'legacy';
    }

    function moneyCents(amountCents, currency = 'eur') {
        const amount = Number(amountCents || 0) / 100;
        try {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: String(currency || 'eur').toUpperCase(),
            }).format(amount);
        } catch {
            return `${amount.toFixed(2)} ${String(currency || '').toUpperCase()}`;
        }
    }

    function safeEvidenceExport(status) {
        return JSON.stringify({
            generatedAt: status.generatedAt,
            version: status.version,
            productionReadiness: status.productionReadiness,
            liveBillingReadiness: status.liveBillingReadiness,
            redactedResponse: status.redactedResponse === true,
            stripeCallsMade: status.stripeCallsMade === true,
            d1MutationPerformed: status.d1MutationPerformed === true,
            creditMutationPerformed: status.creditMutationPerformed === true,
            repositorySupport: status.repositorySupport,
            configShapeStatus: status.configShapeStatus,
            evidenceStatus: status.evidenceStatus,
            canaryStatus: status.canaryStatus,
            finalVerdict: status.finalVerdict || {},
            operatorApproval: status.operatorApproval || {},
            productionReadinessScope: status.productionReadinessScope || null,
            nextOperatorActions: status.nextOperatorActions || [],
            statusBadges: status.statusBadges || [],
            configuration: status.configuration || {},
            catalog: status.catalog || {},
            checkoutSafety: status.checkoutSafety || {},
            webhookHealth: status.webhookHealth || {},
            customerPortal: status.customerPortal || {},
            taxInvoice: status.taxInvoice || {},
            evidenceChecklist: status.evidenceChecklist || [],
            reviews: status.reviews || {},
            reconciliation: status.reconciliation || {},
            archiveSummary: status.archiveSummary || {},
        }, null, 2);
    }

    function safeEvidenceMarkdown(status) {
        const checklist = (status.evidenceChecklist || [])
            .map((item) => `| ${item.id} | ${item.status} | ${item.why || '-'} | ${item.inspect || '-'} |`)
            .join('\n');
        const badges = (status.statusBadges || [])
            .map((item) => `- ${item.label}: ${item.status}`)
            .join('\n');
        return `# Live Billing Readiness Evidence

Generated: ${formatDate(status.generatedAt)}

Production readiness: **${status.productionReadiness || 'blocked'}**
Live billing readiness: **${status.liveBillingReadiness || 'blocked'}**
Operator approval: **${status.operatorApproval?.status || 'not_recorded'}**

${status.operatorApproval?.acceptedRemainingEvidenceRisk ? 'Operator accepted remaining evidence risk. Artifact-backed evidence is partially complete.' : 'Operator approval not recorded in this export.'}

## Status

${badges || '- Not reported'}

## Next Operator Actions

${(status.nextOperatorActions || []).map((item, index) => `${index + 1}. ${item.label || item.id || 'Operator action required'}`).join('\n') || '1. Export redacted status and collect operator canary evidence.'}

## Required Evidence

| Evidence | Status | Why it matters | Where to inspect |
| --- | --- | --- | --- |
${checklist || '| pending | pending_operator_evidence | Operator evidence required. | Admin Live Billing |'}

## Safety

- Stripe calls made by this Admin status read: ${status.stripeCallsMade === true ? 'yes' : 'no'}
- D1 mutation performed by this Admin status read: ${status.d1MutationPerformed === true ? 'yes' : 'no'}
- Credit mutation performed by this Admin status read: ${status.creditMutationPerformed === true ? 'yes' : 'no'}
- Raw payloads, signatures, payment methods, cookies, tokens, and secrets are not included.
`;
    }

    function appendLiveBillingActions(container, status) {
        const actions = el('div', 'admin-control-chip-row admin-billing-evidence-actions');
        const refresh = el('button', 'btn-action', 'Refresh status');
        refresh.type = 'button';
        refresh.addEventListener('click', loadLiveBillingCommandCenter);

        const commands = el('button', 'btn-action', 'Copy validation commands');
        commands.type = 'button';
        commands.addEventListener('click', async () => {
            const copied = await copyTextToClipboard([
                'npm run check:js',
                'npm run check:secrets',
                'npm run check:route-policies',
                'npm run billing:canary-evidence',
                'npm run test:workers -- --grep "billing|Stripe|subscription|webhook|portal|reconciliation"',
                'npm run build:static',
                'npm run release:plan',
            ].join('\n'));
            notify(copied ? 'Live billing validation commands copied.' : 'Command copy failed.', copied ? 'success' : 'error');
        });

        const envChecklist = el('button', 'btn-action', 'Copy Cloudflare env checklist');
        envChecklist.type = 'button';
        envChecklist.addEventListener('click', async () => {
            const names = status.configuration?.namesInspected || [];
            const copied = await copyTextToClipboard(names.map((name) => `${name}=<configure in Cloudflare; value redacted>`).join('\n'));
            notify(copied ? 'Redacted env checklist copied.' : 'Env checklist copy failed.', copied ? 'success' : 'error');
        });

        const stripeChecklist = el('button', 'btn-action', 'Copy Stripe Dashboard checklist');
        stripeChecklist.type = 'button';
        stripeChecklist.addEventListener('click', async () => {
            const copied = await copyTextToClipboard([
                'Create/verify live credit-pack Prices that match the public BITBI catalog.',
                'Create/verify the BITBI Pro live subscription Price ID.',
                'Configure live webhook endpoint: /api/billing/webhooks/stripe/live.',
                'Attach events: checkout.session.completed, invoice.paid/payment_succeeded, customer.subscription.*, invoice.payment_failed/action_required, checkout.session.expired, refund.*, charge.refunded, charge.dispute.*.',
                'Configure Customer Portal if STRIPE_LIVE_CUSTOMER_PORTAL_RETURN_URL is set.',
                'Review Stripe Tax, tax ID collection, and invoice settings with accounting before claiming readiness.',
                'Collect sanitized canary evidence; never paste raw payloads, signatures, secrets, cards, cookies, or tokens.',
            ].join('\n'));
            notify(copied ? 'Stripe Dashboard checklist copied.' : 'Checklist copy failed.', copied ? 'success' : 'error');
        });

        const jsonButton = el('button', 'btn-action', 'Download evidence JSON');
        jsonButton.type = 'button';
        jsonButton.addEventListener('click', () => {
            downloadTextFile('live-billing-readiness-evidence.json', safeEvidenceExport(status), 'application/json');
            notify('Sanitized evidence JSON prepared.', 'success');
        });

        const markdownButton = el('button', 'btn-action', 'Download evidence Markdown');
        markdownButton.type = 'button';
        markdownButton.addEventListener('click', () => {
            downloadTextFile('live-billing-readiness-evidence.md', safeEvidenceMarkdown(status), 'text/markdown');
            notify('Sanitized evidence Markdown prepared.', 'success');
        });

        const reviews = el('a', 'btn-action', 'Open Billing Reviews');
        reviews.href = '#billing-events';
        const reconciliation = el('a', 'btn-action', 'Open Billing Reconciliation');
        reconciliation.href = '#billing-events';
        const credits = el('a', 'btn-action', 'Open Credits page');
        credits.href = '/account/credits.html?scope=member';
        actions.append(refresh, commands, envChecklist, stripeChecklist, jsonButton, markdownButton, reviews, reconciliation, credits);
        container.appendChild(actions);
    }

    function renderLiveBillingChecklist(status) {
        const card = el('article', 'admin-control-card glass glass-card reveal visible');
        const top = el('div', 'admin-control-card__top');
        top.append(el('h3', 'admin-section-title', 'Evidence Checklist'), badge('operator evidence required', 'disabled'));
        card.appendChild(top);
        const rows = el('div', 'admin-reconciliation-items');
        for (const item of status.evidenceChecklist || []) {
            const row = el('article', 'admin-reconciliation-item');
            const header = el('div', 'admin-reconciliation-item__header');
            header.append(badge(readableToken(item.status), liveBillingBadgeVariant(item.status)), el('strong', null, readableToken(item.id)));
            row.appendChild(header);
            row.appendChild(el('p', 'admin-shell__desc', item.why || 'Operator evidence required.'));
            row.appendChild(detailRows([
                ['Where to inspect', item.inspect || 'Admin Live Billing'],
                ['Safe next action', item.nextAction || 'Collect sanitized operator evidence.'],
            ]));
            rows.appendChild(row);
        }
        card.appendChild(rows);
        return card;
    }

    function renderLiveBillingNextActions(status) {
        const card = el('section', 'admin-operator-guidance glass glass-card reveal visible');
        const header = el('div', 'admin-operator-guidance__header');
        const heading = el('div');
        heading.append(
            el('p', 'admin-operator-guidance__eyebrow', 'Next operator action'),
            el('h3', 'admin-section-title', 'Safe Cutover Path'),
            el('p', 'admin-shell__desc', status.finalVerdict?.summary || 'Repository support is ready for an operator canary, but readiness remains blocked until evidence is reviewed.'),
        );
        header.append(heading, badge(status.finalVerdict?.status || 'blocked_pending_operator_evidence', liveBillingBadgeVariant(status.finalVerdict?.status)));
        card.appendChild(header);
        const list = el('div', 'admin-reconciliation-items');
        for (const item of (status.nextOperatorActions || []).slice(0, 7)) {
            const row = el('article', 'admin-reconciliation-item');
            const rowHeader = el('div', 'admin-reconciliation-item__header');
            rowHeader.append(badge('safe', 'user'), el('strong', null, item.label || readableToken(item.id)));
            row.append(rowHeader);
            row.appendChild(detailRows([
                ['Where to inspect', item.inspect || 'Admin Live Billing'],
                ['Safe action', item.safeAction || 'Collect sanitized evidence only.'],
            ]));
            list.appendChild(row);
        }
        if (!list.children.length) {
            const empty = el('article', 'admin-reconciliation-item');
            empty.append(el('p', 'admin-shell__desc', 'Monitor live billing and attach any remaining sanitized evidence without exposing secrets or raw payloads.'));
            list.appendChild(empty);
        }
        card.appendChild(list);
        return card;
    }

    async function loadLiveBillingCommandCenter() {
        const panel = byId('liveBillingPanel');
        const topBadges = byId('liveBillingTopBadges');
        setState('liveBillingState', 'Loading live billing readiness...');
        clear(panel);
        const res = await apiAdminBillingLiveReadinessStatus();
        if (!res.ok) {
            setState('liveBillingState', '');
            renderUnavailable(panel, res, 'Live billing readiness unavailable.');
            return;
        }
        const status = res.data || {};
        const liveLabel = String(status.liveBillingReadiness || 'blocked').toUpperCase();
        const statePrefix = status.liveBillingReadiness === 'operator_approved_live'
            ? 'Live billing readiness is'
            : 'Live billing readiness remains';
        setState('liveBillingState', `Generated ${formatDate(status.generatedAt)}. ${statePrefix} ${liveLabel}.`);
        if (topBadges) {
            clear(topBadges);
            for (const item of (status.statusBadges || []).slice(0, 4)) {
                topBadges.appendChild(badge(item.label, liveBillingBadgeVariant(item.status)));
            }
            const refresh = el('button', 'btn-action', 'Refresh status');
            refresh.type = 'button';
            refresh.addEventListener('click', loadLiveBillingCommandCenter);
            topBadges.appendChild(refresh);
        }

        const overview = el('section', 'admin-operator-guidance glass glass-card reveal visible');
        const header = el('div', 'admin-operator-guidance__header');
        const heading = el('div');
        heading.append(
            el('p', 'admin-operator-guidance__eyebrow', 'Live billing cockpit'),
            el('h3', 'admin-section-title', 'Operator Go/No-Go'),
            el('p', 'admin-shell__desc', status.copy || 'Admin guides configuration and evidence only.'),
        );
        const badgeWrap = el('div', 'admin-control-toolbar__badges');
        for (const item of status.statusBadges || []) {
            badgeWrap.appendChild(badge(item.label, liveBillingBadgeVariant(item.status)));
        }
        header.append(heading, badgeWrap);
        overview.appendChild(header);
        const heroGrid = el('div', 'admin-operator-guidance__grid');
        for (const item of [
            ['Repository', readableToken(status.repositorySupport || 'ready_for_operator_canary'), 'Repository support can guide a controlled operator canary after deploy.'],
            ['Canary', readableToken(status.canaryStatus || 'pending_operator_evidence'), status.operatorApproval?.status === 'operator_approved_live' ? 'Manual live validation was operator-confirmed; artifact evidence remains partial.' : 'No real canary evidence is assumed by this page.'],
            ['Final verdict', readableToken(status.finalVerdict?.status || 'blocked_pending_operator_evidence'), status.finalVerdict?.summary || 'Readiness remains blocked until sanitized evidence is reviewed.'],
            ['Read-only', 'No live Stripe calls', 'Refreshing this page does not create checkout, mutate credits, refund, cancel, or call Stripe.'],
            ['Redacted', 'Secrets stay hidden', 'Raw Stripe payloads, signatures, keys, cards, cookies, tokens, and session values are never rendered.'],
        ]) {
            const node = el('div', 'admin-operator-guidance__item');
            node.append(badge(item[0], item[0] === 'Final verdict' ? liveBillingBadgeVariant(status.finalVerdict?.status) : 'user'), el('strong', null, item[1]), el('span', null, item[2]));
            heroGrid.appendChild(node);
        }
        overview.appendChild(heroGrid);
        panel.appendChild(overview);
        panel.appendChild(renderLiveBillingNextActions(status));

        const config = status.configuration || {};
        const secrets = config.secrets || {};
        const urls = config.urls || {};
        const catalog = status.catalog || {};
        const creditPacks = catalog.creditPacks || {};
        const subscription = catalog.subscription || {};
        const portal = status.customerPortal || {};
        const taxInvoice = status.taxInvoice || {};
        const webhook = status.webhookHealth || {};
        const reconciliation = status.reconciliation || {};
        const reviewCounts = status.reviews || {};

        const grid = el('div', 'admin-control-grid admin-billing-evidence-grid');
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Configuration Readiness',
            badgeLabel: status.liveBillingReadiness || 'blocked',
            badgeVariant: liveBillingBadgeVariant(status.liveBillingReadiness),
            copy: 'Presence and shape only. Values are redacted and secrets are never shown.',
            rows: [
                ['Credit packs flag', readableToken(config.flags?.liveCreditPacks?.status)],
                ['Subscriptions flag', readableToken(config.flags?.liveSubscriptions?.status)],
                ['Config shape', readableToken(status.configShapeStatus || 'missing_required_shapes')],
                ['Live secret key', secrets.liveSecretKey?.present ? 'Present; value redacted' : 'Missing'],
                ['Live webhook secret', secrets.liveWebhookSecret?.present ? 'Present; value redacted' : 'Missing'],
                ['Subscription Price ID', config.priceIds?.liveSubscriptionPriceId?.present ? `Configured (...${config.priceIds.liveSubscriptionPriceId.safeSuffix || 'redacted'})` : 'Missing'],
                ['Portal return URL', urls.liveCustomerPortalReturn?.status || 'missing'],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Offer Catalog',
            badgeLabel: 'public catalog',
            badgeVariant: 'user',
            copy: 'Catalog facts are static repo facts and still need matching Stripe Dashboard evidence.',
            rows: [
                ['Credit packs', (creditPacks.activePacks || []).map((pack) => `${pack.name}: ${pack.credits} credits for ${moneyCents(pack.amountCents, pack.currency)}`).join(', ') || 'None'],
                ['BITBI Pro', `${subscription.plan?.name || 'BITBI Pro'}: ${moneyCents(subscription.plan?.amountCents, subscription.plan?.currency)} / ${subscription.plan?.interval || 'month'}`],
                ['Monthly allowance', `${subscription.plan?.allowanceCredits || 0} credits`],
                ['Storage', `${Math.round(Number(subscription.plan?.storageLimitBytes || 0) / 1024 / 1024 / 1024)} GB`],
                ['Stripe Dashboard evidence', catalog.needsStripeDashboardEvidence ? 'Required' : 'Not reported'],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Checkout Safety',
            badgeLabel: 'fail closed',
            badgeVariant: 'active',
            copy: 'Checkout creation is not credit delivery. Grants require verified webhook or invoice evidence.',
            rows: [
                ['No credit before webhook', status.checkoutSafety?.checkoutCreationDoesNotGrantCredits ? 'Yes' : 'Not reported'],
                ['Webhook secret required before checkout', status.checkoutSafety?.missingWebhookSecretFailsClosedBeforeCheckout ? 'Yes' : 'Not reported'],
                ['Wrong Price/provider mode', status.checkoutSafety?.wrongProviderModeOrPriceIdDoesNotGrant ? 'No grant' : 'Not reported'],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Webhook Health',
            badgeLabel: webhook.signatureVerification || 'verified_live_signature',
            badgeVariant: 'legacy',
            copy: 'Recent event data is sanitized local metadata only. Raw payloads and signatures are not rendered.',
            rows: [
                ['Endpoint', webhook.endpoint || '/api/billing/webhooks/stripe/live'],
                ['Recent live events shown', `${(webhook.recentEvents || []).length}`],
                ['Counts by type', renderJsonSummary(webhook.countsByType || {})],
                ['Counts by status', renderJsonSummary(webhook.countsByStatus || {})],
                ['Raw payload/signature rendered', webhook.rawPayloadsRendered || webhook.signaturesRendered ? 'Unexpected' : 'No'],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Customer / Subscription Management',
            badgeLabel: portal.implemented ? 'implemented' : 'pending',
            badgeVariant: portal.implemented ? 'active' : 'legacy',
            copy: 'Customer Portal is a member-triggered Stripe-hosted billing management flow, not an Admin mutation path.',
            rows: [
                ['Portal endpoint', portal.endpoint || '/api/account/billing/portal'],
                ['Portal config', portal.status || 'missing_or_pending'],
                ['Member-triggered only', portal.memberTriggeredOnly ? 'Yes' : 'Not reported'],
                ['Admin arbitrary customer mutation', portal.adminCustomerMutation ? 'Unexpected' : 'No'],
                ['Cancel/reactivate routes', 'Implemented separately for signed-in members'],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Reconciliation / Reviews',
            badgeLabel: reconciliation.operatorApprovalStatus || reconciliation.verdict || 'blocked',
            badgeVariant: liveBillingBadgeVariant(reconciliation.operatorApprovalStatus || reconciliation.verdict),
            copy: 'Read-only local D1 report. It does not repair, claw back, refund, retry, cancel, or call Stripe.',
            rows: [
                ['Billing review rows shown', `${reviewCounts.totalShown || 0}`],
                ['Unresolved reviews', `${reviewCounts.unresolved || 0}`],
                ['Blocking/needs-review rows', `${reviewCounts.blockingOrNeedsReview || 0}`],
                ['Critical reconciliation items', `${reconciliation.criticalItems || reconciliation.summary?.criticalItems || 0}`],
                ['Review states', renderJsonSummary(reviewCounts.byState || {})],
                ['Reconciliation notes', Array.isArray(reconciliation.notes) ? reconciliation.notes.join(' ') : '-'],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Tax / Invoice Review',
            badgeLabel: taxInvoice.status || 'disabled_by_default',
            badgeVariant: String(taxInvoice.status || '').includes('configured') ? 'legacy' : 'user',
            copy: 'Optional Stripe Tax, tax ID collection, and invoice creation remain operator/accounting review items.',
            rows: [
                ['Automatic Tax', taxInvoice.automaticTax?.status || 'missing'],
                ['Tax ID collection', taxInvoice.taxIdCollection?.status || 'missing'],
                ['Credit-pack invoice creation', taxInvoice.oneTimeInvoiceCreation?.status || 'missing'],
                ['Accounting review required', taxInvoice.operatorReviewRequired ? 'Yes' : 'Not reported'],
            ],
        }));
        panel.appendChild(grid);
        panel.appendChild(renderLiveBillingChecklist(status));
        appendLiveBillingActions(panel, status);
    }

    async function loadBillingEvidenceStatus() {
        const panel = byId('billingEvidencePanel');
        setState('billingEvidenceState', 'Loading billing evidence status...');
        clear(panel);
        const res = await apiAdminBillingEvidenceStatus();
        if (!res.ok) {
            setState('billingEvidenceState', '');
            renderUnavailable(panel, res, 'Billing evidence status unavailable.');
            return;
        }

        const evidence = res.data || {};
        const config = evidence.config || {};
        const secrets = config.secrets || {};
        const urls = config.urls || {};
        const priceId = config.priceIds?.liveSubscriptionPriceId || {};
        const creditPacks = evidence.creditPacks || {};
        const subscription = evidence.subscription || {};
        const plan = subscription.plan || {};
        const [creditStatusLabel, creditStatusVariant] = evidenceStatusBadge(creditPacks.status);
        const [subscriptionStatusLabel, subscriptionStatusVariant] = evidenceStatusBadge(subscription.status);
        const webhookSecret = secrets.liveWebhookSecret || {};

        setState(
            'billingEvidenceState',
            `Generated ${formatDate(evidence.generatedAt)}. Production readiness and live billing readiness remain ${String(evidence.liveBillingReadiness || 'blocked').toUpperCase()}.`
        );

        const overview = el('div', 'admin-reconciliation-overview');
        overview.appendChild(detailRows([
            ['Source', evidence.source || 'worker_env_and_static_catalog_only'],
            ['Production readiness', evidence.productionReadiness || 'blocked'],
            ['Live billing readiness', evidence.liveBillingReadiness || 'blocked'],
            ['Stripe calls made', evidence.stripeCallsMade === true ? 'Yes' : 'No'],
            ['Credit mutation performed', evidence.creditMutationPerformed === true ? 'Yes' : 'No'],
            ['Response redacted', evidence.redactedResponse === true ? 'Yes' : 'No'],
            ['Archived records hidden from active counters', evidence.archiveSummary?.totalArchived ? `${evidence.archiveSummary.totalArchived} archived record(s)` : '0'],
        ]));
        panel.appendChild(overview);
        appendArchiveNote(panel, evidence.archiveSummary || {});

        const grid = el('div', 'admin-control-grid admin-billing-evidence-grid');
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Live Billing Readiness',
            badgeLabel: String(evidence.liveBillingReadiness || 'blocked'),
            badgeVariant: 'disabled',
            copy: 'Live billing is not activated from Admin. Operator canary evidence is required before any readiness claim.',
            rows: [
                ['Required evidence', (evidence.evidenceRequired || []).slice(0, 6).map((item) => `${readableToken(item.id)}: ${readableToken(item.status)}`).join(', ') || 'Not reported'],
                ['Last evidence state', 'pending operator evidence'],
                ['Checkout grant rule', 'Checkout creation does not grant credits'],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Credit Packs',
            badgeLabel: creditStatusLabel,
            badgeVariant: creditStatusVariant,
            copy: 'Configured static pack labels and credit amounts are shown for operator review. Checkout canary remains pending.',
            rows: [
                ['Configured packs', `${creditPacks.configuredCount || 0}`],
                ['Pack catalog', (creditPacks.activePacks || []).map((pack) => `${pack.name} (${pack.credits} credits)`).join(', ') || 'No active packs reported'],
                ['No credit before webhook', creditPacks.noCreditBeforeWebhook === true ? 'Yes' : 'Not reported'],
                ['Checkout canary', readableToken(creditPacks.checkoutCanary)],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'BITBI Pro Subscription',
            badgeLabel: subscriptionStatusLabel,
            badgeVariant: subscriptionStatusVariant,
            copy: 'Subscription Price ID is reported by presence and safe suffix only. Monthly subscription credits require invoice.paid evidence.',
            rows: [
                ['Plan', plan.name || 'BITBI Pro'],
                ['Monthly credits', plan.allowanceCredits ?? '-'],
                ['Price ID present', priceId.present === true ? `Yes (...${priceId.safeSuffix || 'reported'})` : 'No'],
                ['Rollover policy', readableToken(plan.rolloverPolicy || 'subscription bucket top up; no rollover claim')],
                ['Invoice.paid evidence', readableToken(subscription.invoicePaidEvidence)],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Webhook Evidence',
            badgeLabel: webhookSecret.present ? 'secret present' : 'secret missing',
            badgeVariant: webhookSecret.present ? 'active' : 'disabled',
            copy: 'Webhook evidence is presence-only. Raw payloads, signatures, payment methods, and secrets are never rendered.',
            rows: [
                ['Endpoint', '/api/billing/webhooks/stripe/live'],
                ['Webhook secret', webhookSecret.present ? 'Present; value redacted' : 'Missing'],
                ['Duplicate idempotency evidence', 'pending operator evidence'],
                ['Wrong price ID rejection evidence', 'pending operator evidence'],
                ['Raw payload/signature rendering', 'not offered'],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Refund / Dispute / Failure Review',
            badgeLabel: 'review-only',
            badgeVariant: 'legacy',
            copy: 'Refunds, disputes, failed invoices, and payment action events are operator-review records only. Accounting/legal/support decisions remain external and auditable.',
            rows: [
                ['Automatic clawback', 'No'],
                ['Stripe action from Admin', 'No'],
                ['Credit mutation on resolution', 'No'],
                ['Review queue', 'Billing Reviews'],
            ],
        }));
        grid.appendChild(renderBillingEvidenceCard({
            title: 'Reconciliation',
            badgeLabel: 'local D1 only',
            badgeVariant: 'user',
            copy: 'Use the Billing Reconciliation panel for bounded mismatch categories. It does not repair, reverse, retry, cancel, or call Stripe.',
            rows: [
                ['Mismatch categories', 'checkout without grant, webhook without ledger, duplicate event, subscription/bucket mismatch, wrong provider mode, manual vs provider grant separation'],
                ['Latest local status', 'See Billing Reconciliation below'],
            ],
        }));
        panel.appendChild(grid);

        const facts = Array.isArray(evidence.failClosedFacts) ? evidence.failClosedFacts : [];
        if (facts.length) {
            const factCard = renderBillingEvidenceCard({
                title: 'Fail-closed Facts',
                badgeLabel: 'read-only',
                badgeVariant: 'user',
                rows: facts.slice(0, 10).map((fact, index) => [`Fact ${index + 1}`, fact]),
            });
            panel.appendChild(factCard);
        }

        const actions = el('div', 'admin-control-chip-row admin-billing-evidence-actions');
        const reviewsLink = el('a', 'btn-action', 'Open Billing Reviews');
        reviewsLink.href = '#billing-events';
        reviewsLink.addEventListener('click', () => byId('billingReviewsList')?.scrollIntoView({ block: 'start' }));
        const reconciliationLink = el('a', 'btn-action', 'Open Billing Reconciliation');
        reconciliationLink.href = '#billing-events';
        reconciliationLink.addEventListener('click', () => byId('billingReconciliationPanel')?.scrollIntoView({ block: 'start' }));
        const templateButton = el('button', 'btn-action', 'Copy billing evidence checklist path');
        templateButton.type = 'button';
        templateButton.addEventListener('click', async () => {
            const copied = await copyTextToClipboard('docs/production-readiness/EVIDENCE_TEMPLATE.md');
            notify(copied ? 'Billing evidence checklist path copied.' : 'Checklist copy failed.', copied ? 'success' : 'error');
        });
        const commandButton = el('button', 'btn-action', 'Copy billing validation commands');
        commandButton.type = 'button';
        commandButton.addEventListener('click', async () => {
            const copied = await copyTextToClipboard([
                'npm run billing:canary-evidence',
                'npx playwright test -c playwright.workers.config.js -g "billing|credit|Stripe|subscription|webhook|invoice|refund|dispute|review|reconciliation|idempotency"',
                'npx playwright test -c playwright.config.js tests/auth-admin.spec.js -g "billing|evidence|reconciliation|review|admin"',
            ].join('\n'));
            notify(copied ? 'Billing validation commands copied.' : 'Command copy failed.', copied ? 'success' : 'error');
        });
        actions.append(reviewsLink, reconciliationLink, templateButton, commandButton);
        panel.appendChild(actions);
    }

    function reconciliationSeverityVariant(severity) {
        const value = String(severity || '').toLowerCase();
        if (value === 'critical') return 'disabled';
        if (value === 'warning') return 'legacy';
        return 'user';
    }

    function renderReconciliationSummaryCard(title, badgeText, badgeVariant, meta) {
        const card = el('article', 'admin-control-card glass glass-card reveal visible');
        const top = el('div', 'admin-control-card__top');
        top.appendChild(el('h3', 'admin-section-title', title));
        top.appendChild(badge(badgeText, badgeVariant));
        card.appendChild(top);
        card.appendChild(detailRows(meta));
        return card;
    }

    function appendReconciliationSection(container, section) {
        const article = el('article', 'admin-reconciliation-section glass glass-card');
        const header = el('div', 'admin-control-card__top');
        header.appendChild(el('h3', 'admin-section-title', section.title || section.id || 'Report Section'));
        header.appendChild(badge(section.severity || 'info', reconciliationSeverityVariant(section.severity)));
        article.appendChild(header);
        if (section.summary && typeof section.summary === 'object') {
            article.appendChild(el('p', 'admin-shell__desc', renderJsonSummary(section.summary)));
        }
        const items = Array.isArray(section.items) ? section.items : [];
        if (items.length === 0) {
            article.appendChild(el('p', 'admin-shell__empty', 'No local items reported in this section.'));
        } else {
            const list = el('div', 'admin-reconciliation-items');
            for (const item of items) {
                const rowNode = el('article', `admin-reconciliation-item admin-reconciliation-item--${item.severity || 'info'}`);
                const itemHeader = el('div', 'admin-reconciliation-item__header');
                itemHeader.appendChild(badge(item.severity || 'info', reconciliationSeverityVariant(item.severity)));
                itemHeader.appendChild(el('strong', null, item.title || 'Billing reconciliation item'));
                rowNode.appendChild(itemHeader);
                if (item.detail) rowNode.appendChild(el('p', 'admin-shell__desc', item.detail));
                const meta = [];
                if (item.count != null) meta.push(['Count', item.count]);
                if (item.refs && typeof item.refs === 'object') meta.push(['Safe refs', renderJsonSummary(item.refs)]);
                if (meta.length) rowNode.appendChild(detailRows(meta));
                list.appendChild(rowNode);
            }
            article.appendChild(list);
        }
        if (section.truncated) {
            article.appendChild(el('p', 'admin-shell__desc', 'Additional local findings were omitted from this bounded UI view.'));
        }
        container.appendChild(article);
    }

    async function loadBillingReconciliation() {
        const panel = byId('billingReconciliationPanel');
        setState('billingReconciliationState', 'Loading billing reconciliation...');
        clear(panel);
        const res = await apiAdminBillingReconciliation();
        if (!res.ok) {
            setState('billingReconciliationState', '');
            renderUnavailable(panel, res, 'Billing reconciliation report unavailable.');
            return;
        }
        const report = res.data || {};
        const summary = report.summary || {};
        const archiveSummary = report.archiveSummary || summary.archiveSummary || {};
        const reviews = summary.reviews || {};
        const checkouts = summary.checkouts || {};
        const ledger = summary.creditLedger || {};
        const subscriptions = summary.subscriptions || {};
        setState(
            'billingReconciliationState',
            `Generated ${formatDate(report.generatedAt)} from local D1 only. Verdict remains ${String(report.verdict || 'blocked').toUpperCase()}.`
        );

        const overview = el('div', 'admin-reconciliation-overview');
        overview.appendChild(detailRows([
            ['Generated', formatDate(report.generatedAt)],
            ['Source', report.source || 'local_d1_only'],
            ['Production readiness', report.productionReadiness || 'blocked'],
            ['Live billing readiness', report.liveBillingReadiness || 'blocked'],
            ['Archiv ausgeblendet', archiveSummary.totalArchived ? `${archiveSummary.totalArchived} Eintrag/Einträge` : '0'],
            ['Notes', Array.isArray(report.notes) ? report.notes.join(' ') : 'Read-only local report.'],
        ]));
        panel.appendChild(overview);
        appendArchiveNote(panel, archiveSummary);

        const cards = el('div', 'admin-control-grid admin-reconciliation-summary');
        cards.appendChild(renderReconciliationSummaryCard('Risk Items', `${summary.criticalItems || 0} critical`, (summary.criticalItems || 0) > 0 ? 'disabled' : 'user', [
            ['Warnings', summary.warningItems || 0],
            ['Scan limit', summary.scanLimit || '-'],
        ]));
        cards.appendChild(renderReconciliationSummaryCard('Billing Reviews', `${reviews.blocked || 0} blocked`, (reviews.blocked || 0) > 0 ? 'disabled' : 'user', [
            ['Needs review', reviews.needsReview || 0],
            ['Stale unresolved', reviews.staleUnresolved || 0],
        ]));
        cards.appendChild(renderReconciliationSummaryCard('Checkouts', `${checkouts.completedWithoutLedger || 0} missing ledger`, (checkouts.completedWithoutLedger || 0) > 0 ? 'disabled' : 'user', [
            ['Ledger without event', checkouts.ledgerLinkedWithoutBillingEvent || 0],
            ['Org statuses', renderJsonSummary(checkouts.organizationLiveCreditPackByStatus)],
        ]));
        cards.appendChild(renderReconciliationSummaryCard('Ledger / Subscriptions', `${ledger.negativeBalances || 0} negative`, (ledger.negativeBalances || 0) > 0 ? 'disabled' : 'user', [
            ['Missing usage ledger', ledger.usageEventsMissingLedger || 0],
            ['Active subscriptions without top-up', subscriptions.activeWithoutTopUpMarker || 0],
        ]));
        panel.appendChild(cards);

        const safety = el('p', 'admin-shell__desc admin-reconciliation-safety', 'Read-only operator report: no Stripe API calls, no refunds, no credit reversal, no subscription cancellation, and no automatic remediation are available from this panel.');
        panel.appendChild(safety);

        const sections = Array.isArray(report.sections) ? report.sections : [];
        if (sections.length === 0) {
            panel.appendChild(el('div', 'admin-shell__empty', 'No reconciliation sections were returned.'));
            return;
        }
        for (const section of sections) appendReconciliationSection(panel, section);
    }

    function reviewStateLabel(value) {
        return String(value || 'unknown').replace(/_/g, ' ');
    }

    function reviewStateVariant(value) {
        const state = String(value || '').toLowerCase();
        if (state === 'resolved') return 'active';
        if (state === 'blocked') return 'disabled';
        if (state === 'dismissed' || state === 'informational') return 'legacy';
        return 'user';
    }

    function isFinalReviewState(value) {
        const state = String(value || '').toLowerCase();
        return state === 'resolved' || state === 'dismissed';
    }

    function isBlockedReview(review) {
        return String(review?.reviewState || '').toLowerCase() === 'blocked'
            || /dispute/i.test(String(review?.eventType || ''));
    }

    function renderSafeIdentifiers(identifiers) {
        if (!identifiers || typeof identifiers !== 'object' || Array.isArray(identifiers)) return '-';
        const safeEntries = Object.entries(identifiers)
            .filter(([key, value]) => !isSensitiveKey(key) && value != null && value !== '')
            .slice(0, 12);
        if (safeEntries.length === 0) return '-';
        return safeEntries.map(([key, value]) => `${key}: ${safeSummaryValue(value)}`).join(', ');
    }

    function appendBlockedReviewWarning(container, review) {
        if (!isBlockedReview(review)) return;
        const warning = el('div', 'admin-billing-review-warning');
        warning.setAttribute('role', 'alert');
        warning.textContent = review.warning
            || 'Blocked dispute lifecycle event: operator review is required. Do not claim live billing readiness from this UI.';
        container.appendChild(warning);
    }

    function appendBillingReviewResolutionForm(container, review) {
        if (!review?.id || isFinalReviewState(review.reviewState)) return;
        const form = el('form', 'admin-billing-review-resolution');
        form.id = 'billingReviewResolutionForm';

        const safety = el('p', 'admin-shell__desc', 'Resolution records operator review metadata only. It does not adjust credits, call Stripe, refund payments, claw back credits, cancel subscriptions, or reconcile chargebacks.');
        const noteField = el('label', 'admin-ai__field');
        noteField.appendChild(el('span', 'admin-ai__label', 'Resolution note'));
        const note = document.createElement('textarea');
        note.id = 'billingReviewResolutionNote';
        note.className = 'admin-ai__textarea';
        note.rows = 3;
        note.maxLength = 1000;
        note.setAttribute('aria-required', 'true');
        note.placeholder = 'Summarize the human review decision and any external accounting/support follow-up.';
        noteField.appendChild(note);

        const confirmationField = el('label', 'admin-ai__field admin-ai__field--inline admin-billing-review-confirm');
        const checkbox = document.createElement('input');
        checkbox.id = 'billingReviewResolutionConfirm';
        checkbox.type = 'checkbox';
        checkbox.setAttribute('aria-required', 'true');
        confirmationField.appendChild(checkbox);
        confirmationField.appendChild(el('span', null, 'I confirm this records review metadata only and does not perform payment, credit, account, or Stripe remediation.'));

        const result = el('div', 'admin-state');
        result.id = 'billingReviewResolutionState';
        result.setAttribute('aria-live', 'polite');

        const actions = el('div', 'admin-billing-review-actions');
        for (const [status, label] of [['resolved', 'Mark Resolved'], ['dismissed', 'Mark Dismissed']]) {
            const button = el('button', 'btn-action', label);
            button.type = 'submit';
            button.dataset.resolutionStatus = status;
            actions.appendChild(button);
        }

        form.append(safety, noteField, confirmationField, actions, result);
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const resolutionStatus = event.submitter?.dataset?.resolutionStatus || '';
            const resolutionNote = note.value.trim();
            if (billingReviewResolutionSubmitting) return;
            if (!resolutionNote || !checkbox.checked) {
                result.dataset.state = 'error';
                result.textContent = 'Resolution note and confirmation are required.';
                return;
            }
            billingReviewResolutionSubmitting = true;
            form.querySelectorAll('button').forEach((button) => setSubmitting(button, true));
            result.dataset.state = 'neutral';
            result.textContent = 'Recording review resolution...';
            try {
                const res = await apiAdminResolveBillingReview(review.id, {
                    resolutionStatus,
                    resolutionNote,
                    idempotencyKey: createIdempotencyKey('billing-review-resolution'),
                });
                if (!res.ok) {
                    result.dataset.state = 'error';
                    result.textContent = apiUnavailableMessage(res, 'Billing review resolution failed.');
                    notify('Billing review resolution failed.', 'error');
                    return;
                }
                result.dataset.state = 'success';
                result.textContent = res.data?.reused
                    ? 'Billing review resolution was already recorded for this request.'
                    : 'Billing review resolution recorded.';
                notify('Billing review resolution recorded.', 'success');
                selectedBillingReviewId = res.data?.review?.id || review.id;
                await loadBillingReviews();
                await loadBillingReviewDetail(selectedBillingReviewId);
            } finally {
                billingReviewResolutionSubmitting = false;
                form.querySelectorAll('button').forEach((button) => setSubmitting(button, false));
            }
        });
        container.appendChild(form);
    }

    async function loadBillingReviews() {
        const reviewState = byId('billingReviewsStateFilter')?.value || '';
        const providerMode = byId('billingReviewsProviderMode')?.value || 'live';
        const eventType = byId('billingReviewsEventType')?.value.trim() || '';
        const list = byId('billingReviewsList');
        setState('billingReviewsState', 'Loading billing reviews...');
        clear(list);
        const res = await apiAdminBillingReviews({
            reviewState,
            provider: 'stripe',
            providerMode,
            eventType,
            limit: 25,
        });
        if (!res.ok) {
            setState('billingReviewsState', '');
            renderUnavailable(list, res, 'Billing review queue unavailable.');
            return;
        }
        const reviews = Array.isArray(res.data?.reviews) ? res.data.reviews : [];
        visibleBillingReviewRefs = reviews.map((review) => reviewArchiveRef(review)).filter(Boolean);
        appendArchiveNote(list, res.data?.archiveSummary || {});
        if (reviews.length === 0) {
            setState('billingReviewsState', `Keine aktiven Billing Reviews für die Filter gefunden. ${archiveSummaryText(res.data?.archiveSummary || {})}`);
            return;
        }
        setState('billingReviewsState', `Showing ${reviews.length} sanitized billing review event${reviews.length === 1 ? '' : 's'} in the active view. ${archiveSummaryText(res.data?.archiveSummary || {})}`);
        const { wrap, tbody } = table(['State', 'Type', 'Provider', 'Mode', 'Provider event', 'Received', 'Recommended action', 'Actions']);
        wrap.classList.add('admin-billing-review-table');
        for (const review of reviews) {
            const tr = document.createElement('tr');
            if (isBlockedReview(review)) tr.classList.add('admin-billing-review-row--blocked');
            addCell(tr, badge(reviewStateLabel(review.reviewState), reviewStateVariant(review.reviewState)));
            addCell(tr, review.eventType || '-');
            addCell(tr, review.provider || '-');
            addCell(tr, badge(review.providerMode || '-', review.providerMode === 'live' ? 'disabled' : 'user'));
            addCell(tr, shortId(review.providerEventId));
            addCell(tr, formatDate(review.receivedAt || review.createdAt));
            addCell(tr, review.recommendedAction || review.reviewReason || '-');
            const actions = el('div', 'admin-control-chip-row');
            const btn = el('button', 'btn-action', 'Inspect Review');
            btn.type = 'button';
            btn.addEventListener('click', () => {
                selectedBillingReviewId = review.id;
                loadBillingReviewDetail(review.id);
            });
            const archiveBtn = el('button', 'btn-action btn-action--secondary', 'Archivieren');
            archiveBtn.type = 'button';
            archiveBtn.addEventListener('click', () => archiveBillingRefs([reviewArchiveRef(review)], {
                stateId: 'billingReviewsState',
                defaultReason: `Billing Review ${shortId(review.id)} aus aktiver Admin-Ansicht archivieren.`,
            }));
            actions.append(btn, archiveBtn);
            addCell(tr, actions);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);
    }

    async function loadBillingReviewDetail(reviewId) {
        const detail = byId('billingReviewDetail');
        if (!detail) return;
        detail.hidden = false;
        detail.textContent = 'Loading billing review detail...';
        const res = await apiAdminBillingReview(reviewId);
        clear(detail);
        if (!res.ok) {
            renderUnavailable(detail, res, 'Billing review detail unavailable.');
            return;
        }
        const review = res.data?.review || {};
        detail.appendChild(el('h3', 'admin-section-title', 'Billing Review Detail'));
        appendBlockedReviewWarning(detail, review);
        detail.appendChild(detailRows([
            ['Review state', reviewStateLabel(review.reviewState)],
            ['Review reason', review.reviewReason || '-'],
            ['Recommended action', review.recommendedAction || '-'],
            ['Event type', review.eventType || '-'],
            ['Provider', review.provider || '-'],
            ['Provider mode', review.providerMode || '-'],
            ['Provider event', shortId(review.providerEventId)],
            ['Processing', review.processingStatus || '-'],
            ['Action status', review.actionStatus || '-'],
            ['Side effects enabled', review.sideEffectsEnabled === true ? 'Yes' : 'No'],
            ['Operator review only', review.operatorReviewOnly === true ? 'Yes' : 'No'],
            ['Safe identifiers', renderSafeIdentifiers(review.safeIdentifiers)],
            ['Received', formatDate(review.receivedAt || review.createdAt)],
            ['Resolved at', review.resolvedAt ? formatDate(review.resolvedAt) : '-'],
            ['Resolution status', review.resolutionStatus || '-'],
            ['Resolution note', review.resolutionNote || '-'],
        ]));
        const archiveActions = el('div', 'admin-control-chip-row');
        const archiveButton = el('button', 'btn-action btn-action--secondary', 'Diesen Review archivieren');
        archiveButton.type = 'button';
        archiveButton.addEventListener('click', () => archiveBillingRefs([reviewArchiveRef(review)], {
            stateId: 'billingReviewsState',
            defaultReason: `Billing Review ${shortId(review.id)} aus aktiver Admin-Ansicht archivieren.`,
        }));
        archiveActions.appendChild(archiveButton);
        detail.appendChild(archiveActions);
        if (review.actionSummary && typeof review.actionSummary === 'object') {
            detail.appendChild(el('h3', 'admin-section-title', 'Action Summary'));
            detail.appendChild(detailRows([
                ['Credit mutation', review.actionSummary.creditMutation || 'none'],
                ['Credits granted', review.actionSummary.creditsGranted ?? 0],
                ['Credits reversed', review.actionSummary.creditsReversed ?? 0],
                ['Persisted checkout state', renderJsonSummary(review.actionSummary.persistedCheckoutState)],
            ]));
        }
        appendBillingReviewResolutionForm(detail, review);
    }

    async function loadOperatorBillingArchive() {
        const list = byId('billingArchiveList');
        if (!list) return;
        const q = byId('billingArchiveSearch')?.value.trim() || '';
        setState('billingArchiveState', 'Archiv wird geladen...');
        clear(list);
        const res = await apiAdminBillingOperatorArchive({ limit: 100, q });
        if (!res.ok) {
            setState('billingArchiveState', '');
            renderUnavailable(list, res, 'Billing-Archiv ist nicht verfügbar.');
            return;
        }
        const archiveItems = Array.isArray(res.data?.archiveItems) ? res.data.archiveItems : [];
        if (archiveItems.length === 0) {
            setState('billingArchiveState', 'Keine archivierten Billing-Einträge gefunden.');
            list.appendChild(el('div', 'admin-shell__empty', 'Archivierte Zahlungsereignisse werden hier angezeigt. Aktive Ansichten bleiben davon getrennt.'));
            return;
        }
        setState('billingArchiveState', `${archiveItems.length} archivierte Billing-Einträge gefunden. Archivierte Einträge sind nicht gelöscht.`);
        const { wrap, tbody } = table(['Typ', 'Eintrag', 'Zusammenfassung', 'Grund', 'Archiviert am', 'Aktion']);
        for (const item of archiveItems) {
            const tr = document.createElement('tr');
            addCell(tr, readableToken(item.itemType || '-'));
            addCell(tr, shortId(item.itemId));
            const summary = item.summary && typeof item.summary === 'object'
                ? (item.summary.title || renderJsonSummary(item.summary))
                : '-';
            addCell(tr, summary);
            addCell(tr, item.reason || '-');
            addCell(tr, formatDate(item.archivedAt || item.createdAt));
            const restoreButton = el('button', 'btn-action', 'Wiederherstellen');
            restoreButton.type = 'button';
            restoreButton.addEventListener('click', () => restoreBillingRefs([{
                itemType: item.itemType,
                itemId: item.itemId,
            }], { stateId: 'billingArchiveState' }));
            addCell(tr, restoreButton);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);
    }

    async function loadBillingEventsPanel() {
        await Promise.all([loadBillingEvidenceStatus(), loadBillingReconciliation(), loadBillingReviews(), loadBillingEvents(), loadOperatorBillingArchive()]);
    }

    function bind() {
        byId('orgsRefresh')?.addEventListener('click', loadOrgs);
        byId('billingPlansRefresh')?.addEventListener('click', loadBillingPlans);
        byId('orgBillingLookupForm')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const org = await resolveOrganizationByName({
                inputId: 'orgBillingSearch',
                matchesId: 'orgBillingMatches',
                stateId: 'orgBillingState',
                key: 'orgLookup',
                onSelect: (selectedOrg) => loadOrgBilling(selectedOrg.id, selectedOrg),
            });
            if (org) loadOrgBilling(org.id, org);
        });
        byId('userBillingLookupForm')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const user = await resolveUserByEmail({
                inputId: 'userBillingSearch',
                matchesId: 'userBillingMatches',
                stateId: 'userBillingState',
                key: 'userLookup',
                onSelect: (selectedUser) => loadUserBilling(selectedUser.id, selectedUser),
            });
            if (user) loadUserBilling(user.id, user);
        });
        byId('creditGrantForm')?.addEventListener('submit', handleCreditGrant);
        byId('userCreditGrantForm')?.addEventListener('submit', handleUserCreditGrant);
        byId('billingEventsFilter')?.addEventListener('submit', (event) => {
            event.preventDefault();
            loadBillingEvents();
        });
        byId('billingReviewsFilter')?.addEventListener('submit', (event) => {
            event.preventDefault();
            loadBillingReviews();
        });
        byId('billingReviewsRefresh')?.addEventListener('click', loadBillingReviews);
        byId('billingReviewsArchiveVisible')?.addEventListener('click', () => archiveBillingRefs(visibleBillingReviewRefs, {
            stateId: 'billingReviewsState',
            defaultReason: 'Sichtbare Billing Reviews aus aktiver Admin-Ansicht archivieren.',
        }));
        byId('billingEvidenceRefresh')?.addEventListener('click', loadBillingEvidenceStatus);
        byId('billingReconciliationRefresh')?.addEventListener('click', loadBillingReconciliation);
        byId('billingEventsArchiveVisible')?.addEventListener('click', () => archiveBillingRefs(visibleBillingEventRefs, {
            stateId: 'billingEventsState',
            defaultReason: 'Sichtbare Provider Events aus aktiver Admin-Ansicht archivieren.',
        }));
        byId('billingArchiveRefresh')?.addEventListener('click', loadOperatorBillingArchive);
        byId('billingArchiveSearchForm')?.addEventListener('submit', (event) => {
            event.preventDefault();
            loadOperatorBillingArchive();
        });
        byId('liveBillingRefresh')?.addEventListener('click', loadLiveBillingCommandCenter);
    }

    return {
        bind,
        loadOrgs,
        loadBillingPlans,
        loadLiveBillingCommandCenter,
        loadBillingEventsPanel,
        loadBillingEvidenceStatus,
        loadBillingReconciliation,
        loadBillingReviews,
        loadBillingEvents,
        loadOperatorBillingArchive,
    };
}
