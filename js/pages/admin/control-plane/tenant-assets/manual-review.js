/* ============================================================
   BITBI — Admin Control Plane / Tenant Assets Manual Review
   Manual-review queue, post-cleanup dry-run, evidence export, and guarded review-state updates.
   ============================================================ */

import {
    apiAdminTenantAssetManualReviewEvidence,
    apiAdminTenantAssetManualReviewEvidenceExport,
    apiAdminTenantAssetManualReviewItem,
    apiAdminTenantAssetManualReviewItems,
    apiAdminTenantAssetManualReviewPostCleanupDryRun,
    apiAdminTenantAssetManualReviewPostCleanupEvidenceExport,
    apiAdminTenantAssetManualReviewPostCleanupSupersede,
    apiAdminUpdateTenantAssetManualReviewStatus,
} from '../../../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    TENANT_REVIEW_STATUSES,
    TENANT_REVIEW_SUPERSEDE_CONFIRMATION,
    addCell,
    allowedTenantReviewTransitions,
    apiUnavailableMessage,
    badge,
    byId,
    clear,
    createIdempotencyKey,
    detailRows,
    downloadTextFile,
    el,
    filenameFromContentDisposition,
    readableToken,
    renderCards,
    renderUnavailable,
    setState,
    setSubmitting,
    shortId,
    table,
    tenantReviewStatusVariant,
    variantFor,
} from '../core.js?v=__ASSET_VERSION__';

export function createTenantManualReviewDomain({ notify, formatDate }) {
    let selectedTenantReviewItemId = '';
    let tenantReviewStatusSubmitting = false;
    let tenantReviewSupersedeSubmitting = false;
    let tenantReviewPostCleanupReport = null;

    function tenantReviewSummaryCards(summary = {}) {
        const activeCurrent = summary.activeCurrentItems ?? summary.reviewStatusRollup?.review_in_progress ?? 0;
        const pendingManual = summary.stillPendingManualReview ?? summary.reviewStatusRollup?.pending_review ?? 0;
        const deferred = summary.stillDeferred ?? summary.reviewStatusRollup?.deferred ?? 0;
        const supersededCandidates = summary.supersededCandidates ?? 0;
        const stillBlocked = summary.stillBlocked ?? (
            Number(summary.issueCategoryRollup?.public_unsafe || 0) +
            Number(summary.issueCategoryRollup?.derivative_risk || 0) +
            Number(summary.terminalBlockedCount || 0)
        );
        return [
            {
                title: 'Historical Review Items',
                badge: { label: `${summary.totalReviewItems ?? 0} total`, variant: 'user' },
                copy: 'Manual-review rows currently stored in D1. Post-cleanup dry-run determines whether old rows are still current.',
                meta: [
                    ['Active current', activeCurrent],
                    ['Superseded candidates', supersededCandidates],
                    ['Events', summary.eventsCount ?? summary.totalEvents ?? 0],
                ],
            },
            {
                title: 'Current Review Split',
                badge: { label: 'Access blocked', variant: 'disabled' },
                copy: 'Blocked categories remain evidence for human review only.',
                meta: [
                    ['Still blocked', stillBlocked],
                    ['Still pending manual review', pendingManual],
                    ['Deferred', deferred],
                ],
            },
            {
                title: 'Status Evidence',
                badge: { label: 'Review-state only', variant: 'legacy' },
                copy: 'Status events are audit evidence. They do not approve backfill, tenant isolation, or production readiness.',
                meta: [
                    ['Unknown/manual review required', summary.unknownRequiresManualReview ?? 0],
                    ['Status changes', summary.statusChangedEventsCount ?? 0],
                    ['Latest status update', formatDate(summary.latestStatusUpdateTimestamp)],
                ],
            },
        ];
    }

    function mergedTenantReviewSummary(baseSummary = {}, postCleanupSummary = {}) {
        return {
            ...baseSummary,
            ...postCleanupSummary,
            totalReviewItems: postCleanupSummary.totalReviewItems ?? baseSummary.totalReviewItems,
            totalEvents: postCleanupSummary.totalEvents ?? baseSummary.totalEvents,
            eventsCount: postCleanupSummary.eventsCount ?? baseSummary.totalEvents,
            latestStatusUpdateTimestamp: postCleanupSummary.latestStatusAt ?? baseSummary.latestStatusUpdateTimestamp,
            mostRecentImportTimestamp: postCleanupSummary.latestImportAt ?? baseSummary.mostRecentImportTimestamp,
        };
    }

    function renderTenantReviewPostCleanupSummary(report) {
        const container = byId('tenantReviewPostCleanupSummary');
        clear(container);
        if (!container || !report?.summary) return;
        const summary = report.summary;
        renderCards(container, tenantReviewSummaryCards(mergedTenantReviewSummary({}, summary)));
        const chips = el('div', 'admin-control-chip-row');
        chips.append(
            badge('Post-cleanup dry-run evidence', 'active'),
            badge(`Safe candidates ${summary.supersededCandidates ?? 0}`, Number(summary.supersededCandidates || 0) > 0 ? 'legacy' : 'disabled'),
            badge('D1 not mutated', 'user'),
            badge('R2 not listed', 'user'),
            badge('Tenant isolation not claimed', 'legacy'),
        );
        container.appendChild(chips);
    }

    function tenantReviewSupersedeInputsReady() {
        const confirmation = byId('tenantReviewSupersedeConfirmation')?.value.trim() || '';
        const reason = byId('tenantReviewSupersedeReason')?.value.trim() || '';
        const safeCount = Number(tenantReviewPostCleanupReport?.summary?.supersededCandidates || 0);
        return Boolean(tenantReviewPostCleanupReport && safeCount > 0 && confirmation === TENANT_REVIEW_SUPERSEDE_CONFIRMATION && reason);
    }

    function updateTenantReviewSupersedeControls() {
        const submit = byId('tenantReviewSupersedeSubmit');
        if (!submit) return;
        submit.disabled = !tenantReviewSupersedeInputsReady() || tenantReviewSupersedeSubmitting;
    }

    function tenantReviewFilters() {
        return {
            limit: 25,
            reviewStatus: byId('tenantReviewStatusFilter')?.value || undefined,
            issueCategory: byId('tenantReviewCategoryFilter')?.value || undefined,
            severity: byId('tenantReviewSeverityFilter')?.value || undefined,
            priority: byId('tenantReviewPriorityFilter')?.value || undefined,
            assetDomain: byId('tenantReviewDomainFilter')?.value || undefined,
        };
    }

    async function loadTenantAssetManualReviewEvidence() {
        const summaryNode = byId('tenantReviewSummary');
        setState('tenantReviewState', 'Loading tenant asset manual-review evidence...');
        clear(summaryNode);
        const res = await apiAdminTenantAssetManualReviewEvidence({ limit: 10, includeItems: false });
        if (!res.ok) {
            setState('tenantReviewState', '');
            renderUnavailable(summaryNode, res, 'Tenant asset manual-review evidence unavailable.');
            return null;
        }
        const report = res.data?.report || {};
        const summary = report.summary || {};
        renderCards(summaryNode, tenantReviewSummaryCards(mergedTenantReviewSummary(summary, tenantReviewPostCleanupReport?.summary || {})));
        const safety = el('div', 'admin-control-chip-row');
        safety.append(
            badge('Access switch blocked', 'disabled'),
            badge('Backfill blocked', 'disabled'),
            badge('Tenant isolation not claimed', 'legacy'),
            badge('No R2 action', 'user'),
            badge('Review-state only', 'user'),
        );
        summaryNode.appendChild(safety);
        const statusText = [
            `Historical total ${summary.totalReviewItems ?? 0} review item${Number(summary.totalReviewItems || 0) === 1 ? '' : 's'}`,
            `active current ${tenantReviewPostCleanupReport?.summary?.activeCurrentItems ?? 'run dry-run'}`,
            `superseded candidates ${tenantReviewPostCleanupReport?.summary?.supersededCandidates ?? 'run dry-run'}`,
            `events ${summary.totalEvents ?? 0}`,
            `latest import ${formatDate(summary.mostRecentImportTimestamp)}`,
            `latest status ${formatDate(summary.latestStatusUpdateTimestamp)}`,
        ].join(' | ');
        setState('tenantReviewState', statusText);
        return report;
    }

    async function runTenantReviewPostCleanupDryRun(button) {
        if (button) setSubmitting(button, true);
        setState('tenantReviewSupersedeState', 'Running post-cleanup supersession dry-run...');
        try {
            const res = await apiAdminTenantAssetManualReviewPostCleanupDryRun({
                limit: 500,
                sampleLimit: 50,
            });
            if (!res.ok) {
                tenantReviewPostCleanupReport = null;
                renderTenantReviewPostCleanupSummary(null);
                setState('tenantReviewSupersedeState', apiUnavailableMessage(res, 'Post-cleanup supersession dry-run failed.'), 'error');
                updateTenantReviewSupersedeControls();
                return null;
            }
            tenantReviewPostCleanupReport = res.data?.report || {};
            renderTenantReviewPostCleanupSummary(tenantReviewPostCleanupReport);
            const summary = tenantReviewPostCleanupReport.summary || {};
            setState(
                'tenantReviewSupersedeState',
                `Dry-run complete: active current ${summary.activeCurrentItems ?? 0}, safe superseded candidates ${summary.supersededCandidates ?? 0}, still blocked ${summary.stillBlocked ?? 0}, unknown/manual review ${summary.unknownRequiresManualReview ?? 0}. No D1 or R2 mutation occurred.`,
                'success',
            );
            updateTenantReviewSupersedeControls();
            await loadTenantAssetManualReviewEvidence();
            return tenantReviewPostCleanupReport;
        } finally {
            if (button) setSubmitting(button, false);
        }
    }

    function renderTenantReviewEvents(container, events) {
        const safeEvents = Array.isArray(events) ? events : [];
        if (!safeEvents.length) {
            container.appendChild(el('p', 'admin-shell__desc', 'No bounded event history returned for this item.'));
            return;
        }
        const { wrap, tbody } = table(['Event', 'Old', 'New', 'Actor', 'Reason', 'Created']);
        for (const event of safeEvents.slice(0, 25)) {
            const tr = document.createElement('tr');
            addCell(tr, readableToken(event.eventType));
            addCell(tr, readableToken(event.oldStatus));
            addCell(tr, readableToken(event.newStatus));
            addCell(tr, event.actorUserIdPresent ? 'Recorded' : '-');
            addCell(tr, event.reasonPresent ? 'Recorded' : '-');
            addCell(tr, formatDate(event.createdAt));
            tbody.appendChild(tr);
        }
        container.appendChild(wrap);
    }

    function appendTenantReviewStatusForm(container, item) {
        const allowed = allowedTenantReviewTransitions(item.reviewStatus);
        if (!allowed.length) {
            container.appendChild(el('p', 'admin-shell__desc', 'This review status has no outgoing transition in the manual-review status workflow.'));
            return;
        }
        const form = el('form', 'admin-control-form');
        form.id = 'tenantReviewStatusForm';

        const statusField = el('label', 'admin-ai__field');
        statusField.appendChild(el('span', 'admin-ai__label', 'Next status'));
        const select = document.createElement('select');
        select.id = 'tenantReviewNextStatus';
        select.className = 'admin-ai__input';
        select.required = true;
        for (const status of allowed.filter((value) => TENANT_REVIEW_STATUSES.includes(value))) {
            const option = document.createElement('option');
            option.value = status;
            option.textContent = readableToken(status);
            select.appendChild(option);
        }
        statusField.appendChild(select);

        const reasonField = el('label', 'admin-ai__field');
        reasonField.appendChild(el('span', 'admin-ai__label', 'Operator reason'));
        const reason = document.createElement('textarea');
        reason.id = 'tenantReviewStatusReason';
        reason.className = 'admin-ai__textarea';
        reason.rows = 3;
        reason.maxLength = 500;
        reason.required = true;
        reason.placeholder = 'Record the manual review decision. This does not backfill ownership or change access checks.';
        reasonField.appendChild(reason);

        const confirmField = el('label', 'admin-ai__field admin-ai__field--inline');
        const checkbox = document.createElement('input');
        checkbox.id = 'tenantReviewStatusConfirm';
        checkbox.type = 'checkbox';
        checkbox.required = true;
        confirmField.appendChild(checkbox);
        confirmField.appendChild(el('span', null, 'I confirm this changes review-state rows only; it does not update assets, ownership metadata, access checks, R2, credits, or billing.'));

        const submit = el('button', 'admin-ai__run', 'Update Review Status');
        submit.type = 'submit';
        const state = el('div', 'admin-state');
        state.id = 'tenantReviewStatusUpdateState';
        state.setAttribute('aria-live', 'polite');

        form.append(statusField, reasonField, confirmField, submit, state);
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (tenantReviewStatusSubmitting) return;
            const newStatus = select.value;
            const reasonText = reason.value.trim();
            if (!newStatus || !reasonText || !checkbox.checked) {
                state.dataset.state = 'error';
                state.textContent = 'Next status, reason, and confirmation are required.';
                return;
            }
            const confirmed = window.confirm('Update this manual-review status? This records review-state evidence only and does not backfill ownership or change access behavior.');
            if (!confirmed) {
                state.dataset.state = 'neutral';
                state.textContent = 'Status update cancelled.';
                return;
            }
            tenantReviewStatusSubmitting = true;
            setSubmitting(submit, true);
            state.dataset.state = 'neutral';
            state.textContent = 'Recording review status update...';
            try {
                const res = await apiAdminUpdateTenantAssetManualReviewStatus(item.id, {
                    newStatus,
                    reason: reasonText,
                    confirm: true,
                    metadata: {
                        source: 'admin_control_plane',
                        phase: '6.18',
                    },
                    idempotencyKey: createIdempotencyKey('tenant-review-status'),
                });
                if (!res.ok) {
                    state.dataset.state = 'error';
                    state.textContent = apiUnavailableMessage(res, 'Manual-review status update failed.');
                    notify('Manual-review status update failed.', 'error');
                    return;
                }
                state.dataset.state = 'success';
                state.textContent = 'Manual-review status updated. No source asset rows were changed.';
                notify('Manual-review status updated.', 'success');
                await Promise.all([
                    loadTenantAssetManualReviewEvidence(),
                    loadTenantAssetManualReviewItems(),
                    loadTenantAssetManualReviewDetail(item.id),
                ]);
                setState('tenantReviewState', 'Manual-review status updated. No source asset rows were changed.', 'success');
            } finally {
                tenantReviewStatusSubmitting = false;
                setSubmitting(submit, false);
            }
        });
        container.appendChild(el('h3', 'admin-section-title', 'Review Status Update'));
        container.appendChild(el('p', 'admin-shell__desc', 'Status changes write only manual-review item/event rows. There is no backfill, access switch, source asset update, R2 action, provider call, Stripe call, or credit/billing action.'));
        container.appendChild(form);
    }

    async function loadTenantAssetManualReviewDetail(itemId) {
        const detail = byId('tenantReviewDetail');
        if (!detail) return;
        detail.hidden = false;
        detail.textContent = 'Loading manual-review item detail...';
        const res = await apiAdminTenantAssetManualReviewItem(itemId, { includeEvents: true });
        clear(detail);
        if (!res.ok) {
            renderUnavailable(detail, res, 'Manual-review item detail unavailable.');
            return;
        }
        const item = res.data?.item || {};
        selectedTenantReviewItemId = item.id || itemId;
        detail.appendChild(el('h3', 'admin-section-title', 'Tenant Asset Manual Review Detail'));
        detail.appendChild(detailRows([
            ['Review item', shortId(item.id)],
            ['Asset domain', item.assetDomain || '-'],
            ['Asset', shortId(item.assetId)],
            ['Issue category', readableToken(item.issueCategory)],
            ['Review status', readableToken(item.reviewStatus)],
            ['Severity', item.severity || '-'],
            ['Priority', item.priority || '-'],
            ['Evidence source', item.evidenceSourcePath || '-'],
            ['Created', formatDate(item.createdAt)],
            ['Updated', formatDate(item.updatedAt)],
            ['Reviewed at', formatDate(item.reviewedAt)],
            ['Safe notes', item.safeNotes || '-'],
        ]));
        detail.appendChild(el('h3', 'admin-section-title', 'Event History'));
        renderTenantReviewEvents(detail, item.events);
        appendTenantReviewStatusForm(detail, item);
    }

    async function loadTenantAssetManualReviewItems() {
        const list = byId('tenantReviewList');
        setState('tenantReviewItemsState', 'Loading manual-review queue...');
        clear(list);
        const res = await apiAdminTenantAssetManualReviewItems(tenantReviewFilters());
        if (!res.ok) {
            setState('tenantReviewItemsState', '');
            renderUnavailable(list, res, 'Manual-review queue unavailable.');
            return;
        }
        const items = Array.isArray(res.data?.items) ? res.data.items : [];
        if (!items.length) {
            setState('tenantReviewItemsState', 'No manual-review items found for the selected filters.');
            return;
        }
        setState('tenantReviewItemsState', `Showing ${items.length} of ${res.data?.total ?? items.length} review item${items.length === 1 ? '' : 's'}.`);
        const { wrap, tbody } = table(['Status', 'Category', 'Severity', 'Priority', 'Domain', 'Updated', 'Actions']);
        for (const item of items) {
            const tr = document.createElement('tr');
            addCell(tr, badge(readableToken(item.reviewStatus), tenantReviewStatusVariant(item.reviewStatus)));
            addCell(tr, readableToken(item.issueCategory));
            addCell(tr, badge(item.severity || '-', item.severity === 'critical' ? 'disabled' : variantFor(item.severity)));
            addCell(tr, item.priority || '-');
            addCell(tr, item.assetDomain || '-');
            addCell(tr, formatDate(item.updatedAt || item.createdAt));
            const button = el('button', 'btn-action', 'Inspect Review');
            button.type = 'button';
            button.addEventListener('click', () => loadTenantAssetManualReviewDetail(item.id));
            addCell(tr, button);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);
        if (!selectedTenantReviewItemId && items[0]?.id) {
            loadTenantAssetManualReviewDetail(items[0].id);
        }
    }

    async function loadTenantAssetManualReviewQueue() {
        await Promise.all([
            loadTenantAssetManualReviewEvidence(),
            loadTenantAssetManualReviewItems(),
        ]);
        await runTenantReviewPostCleanupDryRun();
    }

    async function exportTenantAssetManualReviewEvidenceJson(button) {
        setSubmitting(button, true);
        setState('tenantReviewState', 'Preparing tenant asset manual-review JSON export...');
        try {
            const res = await apiAdminTenantAssetManualReviewEvidenceExport({
                format: 'json',
                limit: 50,
                includeItems: true,
            });
            if (!res.ok) {
                setState('tenantReviewState', apiUnavailableMessage(res, 'Tenant asset manual-review evidence export failed.'), 'error');
                notify('Tenant asset evidence export failed.', 'error');
                return;
            }
            const fallback = `tenant-asset-manual-review-evidence-${new Date().toISOString().slice(0, 10)}.json`;
            downloadTextFile(filenameFromContentDisposition(res.filename, fallback), res.text || '{}\n', res.contentType || 'application/json');
            setState('tenantReviewState', 'Manual-review evidence JSON export prepared. No backfill or access switch was performed.');
            notify('Tenant asset evidence export prepared.', 'success');
        } finally {
            setSubmitting(button, false);
        }
    }

    async function exportTenantAssetManualReviewPostCleanupEvidence(button, format) {
        setSubmitting(button, true);
        setState('tenantReviewSupersedeState', `Preparing post-cleanup supersession ${format.toUpperCase()} evidence export...`);
        try {
            const res = await apiAdminTenantAssetManualReviewPostCleanupEvidenceExport({
                format,
                limit: 500,
                sampleLimit: 50,
            });
            if (!res.ok) {
                setState('tenantReviewSupersedeState', apiUnavailableMessage(res, 'Post-cleanup supersession evidence export failed.'), 'error');
                notify('Supersession evidence export failed.', 'error');
                return;
            }
            const extension = format === 'markdown' ? 'md' : format;
            const fallback = `tenant-asset-manual-review-post-cleanup-${new Date().toISOString().slice(0, 10)}.${extension}`;
            downloadTextFile(filenameFromContentDisposition(res.filename, fallback), res.text || '', res.contentType || 'application/octet-stream');
            setState('tenantReviewSupersedeState', `Post-cleanup supersession ${format.toUpperCase()} evidence prepared. No mutation was performed.`, 'success');
            notify('Supersession evidence export prepared.', 'success');
        } finally {
            setSubmitting(button, false);
        }
    }

    async function handleTenantReviewSupersedeSubmit(event) {
        event.preventDefault();
        if (tenantReviewSupersedeSubmitting) return;
        updateTenantReviewSupersedeControls();
        if (!tenantReviewSupersedeInputsReady()) {
            setState('tenantReviewSupersedeState', 'Run dry-run first, then enter exact confirmation and reason. Safe superseded candidates must be present.', 'error');
            return;
        }
        const dryRun = byId('tenantReviewSupersedeDryRun')?.checked !== false;
        if (!dryRun) {
            const confirmed = window.confirm('Mark stale manual-review rows as superseded? This does not delete assets, backfill ownership, switch access checks, reset media, or touch R2.');
            if (!confirmed) {
                setState('tenantReviewSupersedeState', 'Supersession cancelled.', 'neutral');
                return;
            }
        }
        const batchLimit = Number(byId('tenantReviewSupersedeBatchLimit')?.value || 25);
        const submit = byId('tenantReviewSupersedeSubmit');
        tenantReviewSupersedeSubmitting = true;
        setSubmitting(submit, true);
        setState('tenantReviewSupersedeState', dryRun ? 'Submitting supersession executor dry-run...' : 'Submitting guarded supersession update...');
        try {
            const res = await apiAdminTenantAssetManualReviewPostCleanupSupersede({
                dryRun,
                confirm: true,
                confirmation: TENANT_REVIEW_SUPERSEDE_CONFIRMATION,
                reason: byId('tenantReviewSupersedeReason')?.value.trim() || '',
                batchLimit,
            }, { idempotencyKey: createIdempotencyKey('tenant-review-supersede') });
            if (!res.ok) {
                setState('tenantReviewSupersedeState', apiUnavailableMessage(res, 'Manual-review supersession request failed.'), 'error');
                notify('Manual-review supersession failed.', 'error');
                return;
            }
            const result = res.data?.supersession || {};
            setState(
                'tenantReviewSupersedeState',
                `${dryRun ? 'Supersession executor dry-run' : 'Supersession'} completed: considered ${result.rowsConsidered ?? 0}, superseded ${result.rowsSuperseded ?? 0}, skipped ${result.rowsSkipped ?? 0}. Tenant isolation remains unclaimed.`,
                'success',
            );
            notify(dryRun ? 'Supersession dry-run completed.' : 'Review rows superseded.', 'success');
            await runTenantReviewPostCleanupDryRun();
            await loadTenantAssetManualReviewItems();
            setState(
                'tenantReviewSupersedeState',
                `${dryRun ? 'Supersession executor dry-run' : 'Supersession'} completed: considered ${result.rowsConsidered ?? 0}, superseded ${result.rowsSuperseded ?? 0}, skipped ${result.rowsSkipped ?? 0}. Tenant isolation remains unclaimed.`,
                'success',
            );
        } finally {
            tenantReviewSupersedeSubmitting = false;
            setSubmitting(submit, false);
            updateTenantReviewSupersedeControls();
        }
    }


    function bind() {
        byId('tenantReviewRefresh')?.addEventListener('click', loadTenantAssetManualReviewQueue);
        byId('tenantReviewDryRunPostCleanup')?.addEventListener('click', (event) => {
            runTenantReviewPostCleanupDryRun(event.currentTarget);
        });
        byId('tenantReviewExportJson')?.addEventListener('click', (event) => {
            exportTenantAssetManualReviewEvidenceJson(event.currentTarget);
        });
        byId('tenantReviewExportPostCleanupJson')?.addEventListener('click', (event) => {
            exportTenantAssetManualReviewPostCleanupEvidence(event.currentTarget, 'json');
        });
        byId('tenantReviewExportPostCleanupMarkdown')?.addEventListener('click', (event) => {
            exportTenantAssetManualReviewPostCleanupEvidence(event.currentTarget, 'markdown');
        });
        byId('tenantReviewExportPostCleanupHtml')?.addEventListener('click', (event) => {
            exportTenantAssetManualReviewPostCleanupEvidence(event.currentTarget, 'html');
        });
        byId('tenantReviewSupersedeWarning')?.addEventListener('click', () => {
            setState('tenantReviewSupersedeState', 'This does not delete assets. It marks manual-review rows as superseded when the referenced asset no longer exists or ownership evidence has superseded the old review. Active/blocking/manual-review rows remain untouched.');
        });
        byId('tenantReviewSupersedeForm')?.addEventListener('submit', handleTenantReviewSupersedeSubmit);
        byId('tenantReviewSupersedeConfirmation')?.addEventListener('input', updateTenantReviewSupersedeControls);
        byId('tenantReviewSupersedeReason')?.addEventListener('input', updateTenantReviewSupersedeControls);
        byId('tenantReviewSupersedeBatchLimit')?.addEventListener('input', updateTenantReviewSupersedeControls);
        byId('tenantReviewFilter')?.addEventListener('submit', (event) => {
            event.preventDefault();
            selectedTenantReviewItemId = '';
            loadTenantAssetManualReviewItems();
        });
    }

    return {
        bind,
        loadTenantAssetManualReviewQueue,
        exportTenantAssetManualReviewEvidenceJson,
    };
}
