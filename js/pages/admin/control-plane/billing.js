/* ============================================================
   BITBI — Admin Control Plane / Billing + Organizations Domain
   Frontend-only rendering and event binding for billing/operator evidence.
   ============================================================ */

import {
    apiAdminBillingEvent,
    apiAdminBillingEvidenceStatus,
    apiAdminBillingEvents,
    apiAdminBillingPlans,
    apiAdminBillingReconciliation,
    apiAdminBillingReview,
    apiAdminBillingReviews,
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
        const events = Array.isArray(res.data?.events) ? res.data.events : [];
        if (events.length === 0) {
            setState('billingEventsState', 'No billing events found.');
            return;
        }
        setState('billingEventsState', `Showing ${events.length} sanitized events. Live payments disabled.`);
        const { wrap, tbody } = table(['Provider', 'Mode', 'Type', 'Status', 'Organization', 'Received', 'Actions']);
        for (const event of events) {
            const tr = document.createElement('tr');
            addCell(tr, event.provider || '-');
            addCell(tr, badge(event.providerMode || '-', event.providerMode === 'live' ? 'disabled' : 'user'));
            addCell(tr, event.eventType || '-');
            addCell(tr, badge(event.processingStatus || '-', variantFor(event.processingStatus)));
            addCell(tr, shortId(event.organizationId));
            addCell(tr, formatDate(event.receivedAt));
            const btn = el('button', 'btn-action', 'Inspect');
            btn.type = 'button';
            btn.addEventListener('click', () => loadBillingEventDetail(event.id));
            addCell(tr, btn);
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
        ]));
        panel.appendChild(overview);

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
            ['Notes', Array.isArray(report.notes) ? report.notes.join(' ') : 'Read-only local report.'],
        ]));
        panel.appendChild(overview);

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
        if (reviews.length === 0) {
            setState('billingReviewsState', 'No billing review events found for the selected filters.');
            return;
        }
        setState('billingReviewsState', `Showing ${reviews.length} sanitized billing review event${reviews.length === 1 ? '' : 's'}.`);
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
            const btn = el('button', 'btn-action', 'Inspect Review');
            btn.type = 'button';
            btn.addEventListener('click', () => {
                selectedBillingReviewId = review.id;
                loadBillingReviewDetail(review.id);
            });
            addCell(tr, btn);
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

    async function loadBillingEventsPanel() {
        await Promise.all([loadBillingEvidenceStatus(), loadBillingReconciliation(), loadBillingReviews(), loadBillingEvents()]);
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
        byId('billingEvidenceRefresh')?.addEventListener('click', loadBillingEvidenceStatus);
        byId('billingReconciliationRefresh')?.addEventListener('click', loadBillingReconciliation);
    }

    return {
        bind,
        loadOrgs,
        loadBillingPlans,
        loadBillingEventsPanel,
        loadBillingEvidenceStatus,
        loadBillingReconciliation,
        loadBillingReviews,
        loadBillingEvents,
    };
}
