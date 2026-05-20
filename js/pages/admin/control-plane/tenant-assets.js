/* ============================================================
   BITBI — Admin Control Plane / Tenant Assets Domain
   Frontend-only tenant asset evidence, manual review, and guarded controls.
   ============================================================ */

import {
    apiAdminAccessSwitchShadowDiagnostics,
    apiAdminAccessSwitchStatus,
    apiAdminLegacyMediaResetDryRunExport,
    apiAdminLegacyMediaResetStatus,
    apiAdminOwnershipBackfillDryRun,
    apiAdminOwnershipBackfillExecute,
    apiAdminTenantAssetDomainEvidence,
    apiAdminTenantAssetManualReviewEvidence,
    apiAdminTenantAssetManualReviewEvidenceExport,
    apiAdminTenantAssetManualReviewItem,
    apiAdminTenantAssetManualReviewItems,
    apiAdminTenantAssetManualReviewPostCleanupDryRun,
    apiAdminTenantAssetManualReviewPostCleanupEvidenceExport,
    apiAdminTenantAssetManualReviewPostCleanupSupersede,
    apiAdminTenantIsolationEvidenceExport,
    apiAdminUpdateTenantAssetManualReviewStatus,
} from '../../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    TENANT_REVIEW_STATUSES,
    TENANT_REVIEW_SUPERSEDE_CONFIRMATION,
    addCell,
    allowedTenantReviewTransitions,
    apiUnavailableMessage,
    badge,
    byId,
    clear,
    copyTextToClipboard,
    createIdempotencyKey,
    detailRows,
    downloadTextFile,
    el,
    filenameFromContentDisposition,
    operatorGuidancePanel,
    readableToken,
    readinessCards,
    readinessSection,
    renderCards,
    renderUnavailable,
    row,
    setState,
    setSubmitting,
    shortId,
    simpleList,
    table,
    tenantReviewStatusVariant,
    variantFor,
} from './core.js?v=__ASSET_VERSION__';
import {
    statusLabel,
    statusVariant,
} from './readiness.js?v=__ASSET_VERSION__';

export function createTenantAssetsDomain({ notify, formatDate }) {
    let selectedTenantReviewItemId = '';
    let tenantReviewStatusSubmitting = false;
    let tenantReviewSupersedeSubmitting = false;
    let tenantReviewPostCleanupReport = null;

    function lifecycleTextBlock(label, value) {
        const block = el('div', 'admin-lifecycle-text-block');
        block.appendChild(el('span', 'admin-lifecycle-text-block__label', label));
        block.appendChild(el('p', 'admin-lifecycle-text-block__value', value || 'Not recorded.'));
        return block;
    }

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

    const TENANT_ASSET_FALLBACK_DOMAINS = Object.freeze([
        ['ai_folders', 'implemented_but_evidence_pending', 'yes_new_rows_only', 'legacy_user_id', 'yes', 'dry_run_and_gated_executor_limited', 'indirect_folder_rollup', 'yes', 'high'],
        ['ai_images', 'implemented_but_evidence_pending', 'yes_new_rows_only', 'legacy_user_id', 'yes', 'dry_run_and_gated_executor_limited', 'yes_size_bytes', 'yes', 'high'],
        ['ai_image_derivatives', 'evidence_pending', 'partial_parent_only', 'parent_ai_image_legacy_user_id', 'partial', 'dry_run_only_derivative_cleanup_required', 'partial_parent_size_only', 'partial_redacted_counts', 'high'],
        ['ai_text_assets', 'deferred', 'no', 'legacy_user_id', 'no', 'deferred_existing_delete_paths_only', 'yes_size_bytes', 'yes_assets_manager', 'high'],
        ['member_music_audio_assets', 'deferred', 'no', 'legacy_user_id', 'no', 'deferred_existing_delete_paths_only', 'yes_size_bytes_and_poster_size_bytes', 'yes_assets_manager', 'high'],
        ['member_video_assets', 'deferred', 'no', 'legacy_user_id_or_job_scope', 'no', 'deferred_existing_delete_paths_only', 'partial', 'partial', 'high'],
        ['profile_avatars', 'deferred', 'no', 'profile_user_id', 'no', 'deferred', 'no', 'partial_latest_avatar_view', 'medium'],
        ['data_lifecycle_exports', 'implemented_but_operator_evidence_pending', 'separate_lifecycle_model', 'admin_only_archive_read', 'not_applicable', 'not_applicable', 'no', 'yes', 'high'],
        ['r2_user_images', 'evidence_pending', 'partial_parent_only', 'D1 parent lookup', 'partial', 'blocked_without_parent_evidence', 'partial_d1_bytes_only', 'redacted_only', 'blocked'],
    ]).map(([id, currentStatus, ownershipMetadataSupport, runtimeAccessCheckSource, manualReviewSupport, resetSupport, quotaStorageAccountingSupport, adminVisibilitySupport, deletionResetRisk]) => ({
        id,
        label: readableToken(id),
        currentStatus,
        ownershipMetadataSupport,
        runtimeAccessCheckSource,
        manualReviewSupport,
        resetSupport,
        quotaStorageAccountingSupport,
        adminVisibilitySupport,
        deletionResetRisk,
    }));

    function normalizeTenantDomainReport(data) {
        const report = data?.report || data?.data?.report || null;
        if (report && Array.isArray(report.domains)) return report;
        return {
            source: 'frontend_static_fallback',
            generatedAt: new Date().toISOString(),
            noBackfill: true,
            noAccessSwitch: true,
            tenantIsolationClaimed: false,
            productionReadiness: 'blocked',
            liveBillingReadiness: 'blocked',
            ownershipBackfillReadiness: 'blocked',
            accessSwitchReadiness: 'blocked',
            confirmedResetReadiness: 'blocked',
            blockedClaims: [
                'tenant isolation is not claimed',
                'ownership backfill readiness remains blocked',
                'access-switch readiness remains blocked',
                'confirmed legacy media reset readiness remains blocked',
            ],
            domains: TENANT_ASSET_FALLBACK_DOMAINS,
            limitations: [
                'Backend domain evidence endpoint unavailable; static fallback is not live evidence.',
                'No R2 listing, mutation, backfill, access-switching, or reset action is available from this panel.',
            ],
        };
    }

    function renderTenantDomainMatrix(container, domains = []) {
        const wrap = el('div', 'admin-credit-modal__table-wrap admin-usage-modal__table-wrap');
        const table = el('table', 'admin-table admin-usage-modal__table');
        const thead = el('thead');
        const head = el('tr');
        ['Domain', 'Status', 'Ownership', 'Access check', 'Manual review', 'Reset', 'Quota', 'Admin visibility', 'Risk'].forEach((label) => {
            head.appendChild(el('th', '', label));
        });
        thead.appendChild(head);
        table.appendChild(thead);
        const tbody = el('tbody');
        for (const domain of domains) {
            const tr = el('tr');
            tr.appendChild(el('td', 'admin-usage-modal__asset-name', domain.label || readableToken(domain.id)));
            const statusCell = el('td');
            statusCell.appendChild(badge(statusLabel(domain.currentStatus), statusVariant(domain.currentStatus)));
            tr.appendChild(statusCell);
            [
                domain.ownershipMetadataSupport,
                domain.runtimeAccessCheckSource,
                domain.manualReviewSupport,
                domain.resetSupport,
                domain.quotaStorageAccountingSupport,
                domain.adminVisibilitySupport,
                domain.deletionResetRisk,
            ].forEach((value) => tr.appendChild(el('td', '', statusLabel(value))));
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        container.appendChild(wrap);
    }

    let tenantIsolationBackfillReport = null;
    let tenantIsolationDangerModal = null;

    const TENANT_ISOLATION_DANGER = Object.freeze({
        backfill: {
            name: 'Ownership Backfill',
            confirmation: 'BACKFILL OWNERSHIP',
            changes: 'Writes tenant ownership metadata only for selected ai_folders and ai_images rows classified safe by bounded D1 dry-run evidence.',
            domains: 'Supported write domains: ai_folders and ai_images. Deferred domains include derivatives, text/music/video assets, avatars, public galleries, and raw R2 object families.',
            dryRun: 'Dry-run and evidence export read local D1 metadata only and do not list or mutate R2.',
            metadata: 'Can write asset_owner_type, owning_user_id, created_by_user_id, ownership_status/source/confidence, metadata JSON, and assigned timestamp for safe rows only.',
            access: 'Does not change runtime access decisions by itself, but it can affect a future access-switch if one is later enabled.',
            reset: 'Does not retire or delete media references.',
            evidence: 'Requires dry-run evidence, supported domain selection, reason, Idempotency-Key, and exact typed confirmation.',
            rollback: 'Metadata writes are not presented as globally reversible from this panel. Unsafe/manual/deferred rows remain unchanged.',
        },
        access: {
            name: 'Runtime Access-Switch',
            confirmation: 'ENABLE ACCESS SWITCH',
            changes: 'Would change which ownership signal runtime reads use for asset authorization if a durable switch existed.',
            domains: 'Current diagnostics cover folder/image routes only. Other domains remain deferred.',
            dryRun: 'Shadow diagnostics compare legacy user_id checks with ownership metadata without changing authorization.',
            metadata: 'Does not write ownership metadata.',
            access: 'Enforced mode can make users lose access or see assets incorrectly if evidence is wrong. This implementation keeps enforced mode disabled.',
            reset: 'Does not retire or delete media references.',
            evidence: 'Requires passing shadow diagnostics, reviewed mismatch counts, a durable switch model, and exact confirmation before any future enablement.',
            rollback: 'Rollback would require a real kill switch. Current safe state is legacy access mode off/shadow-only.',
        },
        reset: {
            name: 'Legacy Media Reset',
            confirmation: 'CONFIRMED LEGACY MEDIA RESET',
            changes: 'May retire public references, enqueue cleanup, delete legacy media rows, release storage accounting, and remove media access if confirmed execution is approved.',
            domains: 'First-pass executor is limited to ai_images, ai_folders, image derivatives, and public gallery references. Text/music/video/avatar/export/audit domains remain deferred.',
            dryRun: 'Dry-run inventories D1 rows and reset classifications only. It does not list or mutate live R2.',
            metadata: 'Does not backfill ownership metadata.',
            access: 'Does not switch runtime access checks.',
            reset: 'Confirmed execution is destructive and remains blocked unless the backend gate is explicitly enabled and all evidence requirements are satisfied.',
            evidence: 'Requires sanitized dry-run evidence, Idempotency-Key, reason, selected scope, public/no-credit/irreversible acknowledgements, and exact typed confirmation.',
            rollback: 'Deleted or retired references may not be recoverable from this panel. Do not execute before backfill/access-switch evidence is reviewed.',
        },
    });

    function closeTenantIsolationDangerModal() {
        if (!tenantIsolationDangerModal) return;
        tenantIsolationDangerModal.modal.remove();
        document.removeEventListener('keydown', tenantIsolationDangerModal.onKeydown, true);
        tenantIsolationDangerModal.opener?.focus?.();
        tenantIsolationDangerModal = null;
    }

    function openTenantIsolationDangerModal(kind, opener) {
        const info = TENANT_ISOLATION_DANGER[kind];
        if (!info) return;
        closeTenantIsolationDangerModal();
        const modal = el('div', 'admin-lifecycle-modal admin-tenant-danger-modal');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'tenantIsolationDangerTitle');
        const backdrop = el('div', 'admin-lifecycle-modal__backdrop');
        const dialog = el('div', 'admin-lifecycle-detail glass glass-card admin-tenant-danger-dialog');
        const header = el('div', 'admin-lifecycle-detail__header');
        const title = el('h3', 'admin-section-title', `! ${info.name} danger explanation`);
        title.id = 'tenantIsolationDangerTitle';
        const close = el('button', 'btn-action btn-action--secondary', 'Close');
        close.type = 'button';
        close.addEventListener('click', closeTenantIsolationDangerModal);
        header.append(title, close);
        const body = el('div', 'admin-lifecycle-detail__body');
        body.appendChild(detailRows([
            ['Action', info.name],
            ['Exact confirmation', info.confirmation],
        ]));
        for (const [label, value] of [
            ['What changes', info.changes],
            ['Affected domains', info.domains],
            ['Dry-run vs mutating', info.dryRun],
            ['Ownership metadata impact', info.metadata],
            ['Runtime access impact', info.access],
            ['Media reset impact', info.reset],
            ['Evidence required', info.evidence],
            ['Rollback limitations', info.rollback],
        ]) {
            body.appendChild(lifecycleTextBlock(label, value));
        }
        dialog.append(header, body);
        modal.append(backdrop, dialog);
        backdrop.addEventListener('click', closeTenantIsolationDangerModal);
        const onKeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeTenantIsolationDangerModal();
            }
        };
        tenantIsolationDangerModal = { modal, opener, onKeydown };
        document.body.appendChild(modal);
        document.addEventListener('keydown', onKeydown, true);
        close.focus();
    }

    function tenantDangerButton(kind) {
        const info = TENANT_ISOLATION_DANGER[kind];
        const button = el('button', 'admin-danger-marker', '!');
        button.type = 'button';
        button.title = `${info.name}: open danger explanation`;
        button.setAttribute('aria-label', `${info.name} danger explanation`);
        button.addEventListener('click', (event) => openTenantIsolationDangerModal(kind, event.currentTarget));
        return button;
    }

    function tenantIsolationCard(kind, title, statusText) {
        const card = el('article', 'admin-control-card glass glass-card reveal visible admin-tenant-exec-card');
        const top = el('div', 'admin-control-card__top admin-tenant-exec-card__top');
        const heading = el('div', 'admin-tenant-exec-card__heading');
        heading.append(tenantDangerButton(kind), el('h3', 'admin-section-title', title));
        top.append(heading, badge(statusText, statusText === 'available' ? 'legacy' : 'disabled'));
        card.appendChild(top);
        return card;
    }

    function postCleanupStatusText(report) {
        return readableToken(report?.postCleanupRebaseline?.status || 'post_cleanup_evidence_pending');
    }

    function tenantExportButtons(scope, stateNode) {
        const row = el('div', 'admin-control-chip-row');
        for (const [format, label] of [['json', 'Export JSON evidence'], ['markdown', 'Export Markdown evidence'], ['html', 'Export HTML / PDF-friendly']]) {
            const button = el('button', 'btn-action btn-action--secondary', label);
            button.type = 'button';
            button.addEventListener('click', async () => {
                setSubmitting(button, true);
                stateNode.dataset.state = 'neutral';
                stateNode.textContent = `Preparing ${label.toLowerCase()}...`;
                try {
                    const res = await apiAdminTenantIsolationEvidenceExport({ scope, format, limit: 50 });
                    if (!res.ok) {
                        stateNode.dataset.state = 'error';
                        stateNode.textContent = apiUnavailableMessage(res, `${label} failed.`);
                        notify('Tenant isolation evidence export failed.', 'error');
                        return;
                    }
                    const fallback = `tenant-isolation-${scope}-evidence.${format === 'markdown' ? 'md' : format}`;
                    downloadTextFile(filenameFromContentDisposition(res.filename, fallback), res.text || '', res.contentType || 'text/plain');
                    stateNode.dataset.state = 'success';
                    stateNode.textContent = `${label} prepared. No tenant isolation action was executed.`;
                    notify('Tenant isolation evidence export prepared.', 'success');
                } finally {
                    setSubmitting(button, false);
                }
            });
            row.appendChild(button);
        }
        return row;
    }

    function renderBackfillSummary(node, report) {
        clear(node);
        const summary = report?.summary || {};
        node.appendChild(detailRows([
            ['Generated', formatDate(report?.generatedAt)],
            ['Post-cleanup rebaseline', postCleanupStatusText(report)],
            ['Safe candidates', summary.safeCandidates ?? summary.classifications?.safe_to_backfill ?? 0],
            ['Manual review', summary.classifications?.needs_manual_review ?? 0],
            ['Public unsafe', summary.classifications?.blocked_public_unsafe ?? 0],
            ['Missing evidence', summary.classifications?.blocked_missing_evidence ?? 0],
            ['Already owned', summary.classifications?.already_owned ?? 0],
            ['Backfill performed', report?.backfillPerformed ? 'unexpected' : 'No'],
        ]));
        const candidates = Array.isArray(report?.candidates) ? report.candidates.slice(0, 8) : [];
        if (candidates.length) {
            const { wrap, tbody } = table(['Domain', 'Asset', 'Classification', 'Reason']);
            for (const item of candidates) {
                const tr = document.createElement('tr');
                addCell(tr, readableToken(item.domain));
                addCell(tr, shortId(item.assetId));
                addCell(tr, badge(readableToken(item.classification), item.classification === 'safe_to_backfill' ? 'active' : 'disabled'));
                addCell(tr, readableToken(item.reason));
                tbody.appendChild(tr);
            }
            node.appendChild(wrap);
        }
    }

    function renderOwnershipBackfillControl() {
        const card = tenantIsolationCard('backfill', 'Ownership Backfill', 'dangerous');
        card.appendChild(el('p', 'admin-shell__desc', 'Writes ownership metadata only for rows classified safe by a bounded dry-run. Unsafe, public, missing-evidence, manual-review, and deferred rows remain blocked.'));
        const summary = el('div', 'admin-inventory');
        const state = el('div', 'admin-state', 'Post-cleanup evidence pending. Run dry-run preview before any execution attempt.');
        state.id = 'tenantIsolationBackfillState';
        state.setAttribute('aria-live', 'polite');
        const dryRun = el('button', 'btn-action', 'Run Backfill Dry-run');
        dryRun.type = 'button';
        dryRun.addEventListener('click', async () => {
            setSubmitting(dryRun, true);
            state.dataset.state = 'neutral';
            state.textContent = 'Loading ownership backfill dry-run...';
            try {
                const res = await apiAdminOwnershipBackfillDryRun({ limit: 50, includeDetails: true });
                if (!res.ok) {
                    state.dataset.state = 'error';
                    state.textContent = apiUnavailableMessage(res, 'Ownership backfill dry-run failed.');
                    return;
                }
                tenantIsolationBackfillReport = res.data?.report || {};
                renderBackfillSummary(summary, tenantIsolationBackfillReport);
                state.dataset.state = 'success';
                state.textContent = 'Post-cleanup dry-run loaded. No ownership metadata was written.';
                syncBackfillButtons();
            } finally {
                setSubmitting(dryRun, false);
            }
        });

        const reason = document.createElement('textarea');
        reason.id = 'tenantBackfillReason';
        reason.className = 'admin-ai__textarea';
        reason.rows = 3;
        reason.placeholder = 'Operator reason required for the execution endpoint.';
        const confirmation = document.createElement('input');
        confirmation.id = 'tenantBackfillConfirmation';
        confirmation.className = 'admin-ai__input';
        confirmation.placeholder = 'Type BACKFILL OWNERSHIP';
        const executeDryRun = el('button', 'btn-action btn-action--secondary', 'Execute Endpoint Dry-run');
        executeDryRun.type = 'button';
        const executeWrite = el('button', 'btn-action btn-action--danger', 'Write Safe Ownership Metadata');
        executeWrite.type = 'button';
        const blockedReason = el('p', 'admin-shell__desc', 'Write mode disabled until dry-run is loaded, safe candidates exist, reason is entered, and exact confirmation is typed.');

        function safeCandidateCount() {
            return Number(tenantIsolationBackfillReport?.summary?.safeCandidates ?? tenantIsolationBackfillReport?.summary?.classifications?.safe_to_backfill ?? 0);
        }
        function formReady() {
            return Boolean(reason.value.trim() && confirmation.value.trim() === 'BACKFILL OWNERSHIP');
        }
        function syncBackfillButtons() {
            executeDryRun.disabled = !formReady();
            executeWrite.disabled = !(tenantIsolationBackfillReport && safeCandidateCount() > 0 && formReady());
            blockedReason.textContent = executeWrite.disabled
                ? 'Write mode disabled until dry-run is loaded, safe candidates exist, reason is entered, and exact confirmation is typed.'
                : 'Write mode will update only safe ai_folders/ai_images rows in the selected bounded batch. Tenant isolation is still not claimed.';
        }
        reason.addEventListener('input', syncBackfillButtons);
        confirmation.addEventListener('input', syncBackfillButtons);

        async function runBackfillExecution(dryRunMode, button) {
            if (!formReady()) {
                state.dataset.state = 'error';
                state.textContent = 'Reason and exact BACKFILL OWNERSHIP confirmation are required.';
                return;
            }
            if (!dryRunMode) {
                const confirmed = window.confirm('Write ownership metadata for safe rows only? This does not switch access checks, does not reset media, and does not claim tenant isolation.');
                if (!confirmed) return;
            }
            setSubmitting(button, true);
            state.dataset.state = 'neutral';
            state.textContent = dryRunMode ? 'Submitting backfill execution dry-run...' : 'Submitting guarded ownership metadata write...';
            try {
                const res = await apiAdminOwnershipBackfillExecute({
                    dryRun: dryRunMode,
                    confirm: true,
                    confirmation: 'BACKFILL OWNERSHIP',
                    reason: reason.value.trim(),
                    domains: ['ai_folders', 'ai_images'],
                    batchLimit: 25,
                }, { idempotencyKey: createIdempotencyKey('tenant-ownership-backfill') });
                if (!res.ok) {
                    state.dataset.state = 'error';
                    state.textContent = apiUnavailableMessage(res, 'Ownership backfill execution request failed.');
                    notify('Ownership backfill request failed.', 'error');
                    return;
                }
                state.dataset.state = 'success';
                const backfill = res.data?.backfill || {};
                state.textContent = `${dryRunMode ? 'Post-cleanup backfill dry-run' : 'Ownership metadata write'} completed: considered ${backfill.rowsConsidered ?? 0}, written ${backfill.rowsWritten ?? 0}, blocked ${backfill.rowsBlocked ?? 0}. Tenant isolation remains unclaimed.`;
                notify(dryRunMode ? 'Backfill dry-run completed.' : 'Ownership backfill completed for safe rows.', 'success');
                const refreshed = await apiAdminOwnershipBackfillDryRun({ limit: 50, includeDetails: true });
                if (refreshed.ok) {
                    tenantIsolationBackfillReport = refreshed.data?.report || {};
                    renderBackfillSummary(summary, tenantIsolationBackfillReport);
                    syncBackfillButtons();
                }
            } finally {
                setSubmitting(button, false);
            }
        }
        executeDryRun.addEventListener('click', () => runBackfillExecution(true, executeDryRun));
        executeWrite.addEventListener('click', () => runBackfillExecution(false, executeWrite));
        syncBackfillButtons();

        const form = el('div', 'admin-control-form');
        form.append(
            dryRun,
            tenantExportButtons('backfill', state),
        );
        const reasonLabel = el('label', 'admin-ai__field');
        reasonLabel.append(el('span', 'admin-ai__label', 'Reason'), reason);
        const confirmLabel = el('label', 'admin-ai__field');
        confirmLabel.append(el('span', 'admin-ai__label', 'Exact confirmation'), confirmation);
        const actions = el('div', 'admin-control-chip-row');
        actions.append(executeDryRun, executeWrite);
        form.append(reasonLabel, confirmLabel, actions, blockedReason, state);
        card.append(summary, form);
        return card;
    }

    function renderAccessSwitchControl() {
        const card = tenantIsolationCard('access', 'Runtime Access-Switch', 'blocked');
        card.appendChild(el('p', 'admin-shell__desc', 'Shadow diagnostics compare legacy user_id access with ownership metadata. Enforced mode is not available because this repo has no durable switch state and unresolved evidence remains possible.'));
        const summary = el('div', 'admin-inventory');
        const state = el('div', 'admin-state', 'Post-cleanup Access-Switch evidence pending. Run status and shadow diagnostics.');
        state.id = 'tenantIsolationAccessState';
        state.setAttribute('aria-live', 'polite');
        const refresh = el('button', 'btn-action', 'Refresh Access-Switch Status');
        refresh.type = 'button';
        const shadow = el('button', 'btn-action btn-action--secondary', 'Run Shadow Diagnostics');
        shadow.type = 'button';
        async function loadStatus() {
            const res = await apiAdminAccessSwitchStatus();
            if (!res.ok) {
                state.dataset.state = 'error';
                state.textContent = apiUnavailableMessage(res, 'Access-switch status unavailable.');
                return;
            }
            const status = res.data?.status || {};
            clear(summary);
            summary.appendChild(detailRows([
                ['Current mode', readableToken(status.currentMode || 'off')],
                ['Post-cleanup rebaseline', postCleanupStatusText(status)],
                ['Runtime switch supported', status.runtimeSwitchRepoSupported ? 'Yes' : 'No'],
                ['Live switch enabled', status.liveSwitchEnabled ? 'Unexpected' : 'No'],
                ['Unsafe mismatches', status.mismatchCounts?.unsafe ?? 0],
                ['Manual review', status.mismatchCounts?.manualReview ?? 0],
                ['Tenant isolation claimed', status.tenantIsolationClaimed ? 'Unexpected' : 'No'],
            ]));
            state.dataset.state = 'neutral';
            state.textContent = 'Access-switch status loaded. Post-cleanup shadow evidence is still required; enforced mode remains disabled.';
        }
        refresh.addEventListener('click', () => { void loadStatus(); });
        shadow.addEventListener('click', async () => {
            setSubmitting(shadow, true);
            state.dataset.state = 'neutral';
            state.textContent = 'Running shadow diagnostics...';
            try {
                const res = await apiAdminAccessSwitchShadowDiagnostics({ limit: 50 });
                if (!res.ok) {
                    state.dataset.state = 'error';
                    state.textContent = apiUnavailableMessage(res, 'Shadow diagnostics failed.');
                    return;
                }
                const report = res.data?.report || {};
                clear(summary);
                summary.appendChild(detailRows([
                    ['Mismatch count', report.summary?.mismatchCount ?? 0],
                    ['Post-cleanup rebaseline', postCleanupStatusText(report)],
                    ['Metadata missing', (report.summary?.foldersWithNullOwnershipMetadata ?? 0) + (report.summary?.imagesWithNullOwnershipMetadata ?? 0)],
                    ['Enforced mode allowed', report.summary?.enforcedModeAllowed ? 'Unexpected' : 'No'],
                    ['Runtime changed', report.runtimeBehaviorChanged ? 'Unexpected' : 'No'],
                ]));
                const samples = Array.isArray(report.samples) ? report.samples.slice(0, 5) : [];
                if (samples.length) summary.appendChild(simpleList(samples, ['domain', 'mismatchType', 'reason']));
                state.dataset.state = 'success';
                state.textContent = 'Post-cleanup shadow diagnostics completed. No runtime access decision changed.';
            } finally {
                setSubmitting(shadow, false);
            }
        });
        const enforce = el('button', 'btn-action btn-action--danger', 'Enable Enforced Access-Switch');
        enforce.type = 'button';
        enforce.disabled = true;
        const disabled = el('p', 'admin-shell__desc', 'Disabled: enforced mode requires reviewed shadow diagnostics, safe thresholds, rollback/kill-switch state, and a durable backend switch model.');
        const actions = el('div', 'admin-control-chip-row');
        actions.append(refresh, shadow, tenantExportButtons('access', state), enforce);
        card.append(summary, actions, disabled, state);
        void loadStatus();
        return card;
    }

    function renderLegacyMediaResetControl() {
        const card = tenantIsolationCard('reset', 'Legacy Media Reset', 'blocked');
        card.appendChild(el('p', 'admin-shell__desc', 'Confirmed reset may retire public references, queue cleanup, delete first-pass legacy rows, and release storage. The backend gate remains disabled by default and readiness remains blocked.'));
        const summary = el('div', 'admin-inventory');
        const state = el('div', 'admin-state', 'Post-cleanup reset evidence pending. Confirmed execution remains blocked.');
        state.id = 'tenantIsolationResetState';
        state.setAttribute('aria-live', 'polite');
        const statusButton = el('button', 'btn-action', 'Refresh Reset Status');
        statusButton.type = 'button';
        async function loadStatus() {
            const res = await apiAdminLegacyMediaResetStatus();
            if (!res.ok) {
                state.dataset.state = 'error';
                state.textContent = apiUnavailableMessage(res, 'Legacy reset status unavailable.');
                return;
            }
            const status = res.data?.status || {};
            clear(summary);
            summary.appendChild(detailRows([
                ['Dry-run available', status.dryRunAvailable ? 'Yes' : 'No'],
                ['Post-cleanup rebaseline', postCleanupStatusText(status)],
                ['Confirmed gate enabled', status.confirmedExecutionGate?.enabled ? 'Yes' : 'No'],
                ['Sanitized evidence', readableToken(status.sanitizedEvidenceStatus || 'pending')],
                ['Confirmed readiness', readableToken(status.confirmedReadiness || 'blocked')],
                ['Danger approved', status.dangerousOperationsApproved ? 'Unexpected' : 'No'],
                ['Tenant isolation claimed', status.tenantIsolationClaimed ? 'Unexpected' : 'No'],
            ]));
            state.dataset.state = 'neutral';
            state.textContent = 'Legacy reset status loaded. Post-cleanup sanitized evidence remains pending and confirmed execution is blocked.';
        }
        statusButton.addEventListener('click', () => { void loadStatus(); });
        const dryExport = el('button', 'btn-action btn-action--secondary', 'Export Existing Dry-run JSON');
        dryExport.type = 'button';
        dryExport.addEventListener('click', () => exportLegacyMediaResetDryRunJson(dryExport));
        const execute = el('button', 'btn-action btn-action--danger', 'Confirmed Execute Reset');
        execute.type = 'button';
        execute.disabled = true;
        const disabled = el('p', 'admin-shell__desc', 'Disabled by default: gate disabled, sanitized evidence incomplete, backfill/access-switch evidence not reviewed, exact CONFIRMED LEGACY MEDIA RESET confirmation not accepted from this UI state.');
        const actions = el('div', 'admin-control-chip-row');
        actions.append(statusButton, dryExport, tenantExportButtons('reset', state), execute);
        card.append(summary, actions, disabled, state);
        void loadStatus();
        return card;
    }

    function renderTenantIsolationExecution(container) {
        const section = readinessSection('Tenant Isolation Execution', 'Dangerous staged controls for ownership backfill, runtime access-switch, and legacy media reset. This is an execution control plane, not a readiness claim.');
        const intro = el('div', 'admin-control-hero glass glass-card reveal visible admin-tenant-exec-hero');
        const copy = el('div');
        copy.append(el('p', 'admin-control-hero__eyebrow', 'Dangerous operations'));
        copy.append(el('h3', 'admin-section-title', 'Do not execute Reset before Backfill and Access-Switch evidence are reviewed.'));
        copy.append(el('p', 'admin-control-hero__copy', 'Every warning marker opens a concrete danger explanation. Production readiness remains blocked and tenant isolation is not claimed.'));
        copy.append(el('p', 'admin-control-hero__copy', 'Old owner-map, manual-review, and reset counts are stale after manual media cleanup. Collect fresh post-cleanup evidence before any Backfill, Access-Switch, or Reset decision.'));
        const badges = el('div', 'admin-control-chip-row');
        badges.append(
            badge('Evidence required', 'disabled'),
            badge('Post-cleanup evidence pending', 'disabled'),
            badge('No production readiness claim', 'disabled'),
            badge('Tenant isolation not claimed', 'legacy'),
            badge('Live R2 untouched', 'user'),
        );
        intro.append(copy, badges);
        section.appendChild(intro);
        const sequence = el('ol', 'admin-tenant-sequence');
        ['Step 1: Ownership Backfill', 'Step 2: Access-Switch', 'Step 3: Legacy Media Reset'].forEach((text) => {
            sequence.appendChild(el('li', '', text));
        });
        section.appendChild(sequence);
        const controls = el('div', 'admin-control-grid admin-tenant-exec-grid');
        controls.append(renderOwnershipBackfillControl(), renderAccessSwitchControl(), renderLegacyMediaResetControl());
        section.appendChild(controls);
        const combined = el('div', 'admin-control-chip-row');
        const state = el('div', 'admin-state', 'Combined evidence export is read-only and does not execute tenant isolation actions.');
        for (const [format, label] of [['json', 'Export Combined JSON'], ['markdown', 'Export Combined Markdown'], ['html', 'Export Combined HTML / PDF-friendly']]) {
            const button = el('button', 'btn-action btn-action--secondary', label);
            button.type = 'button';
            button.addEventListener('click', async () => {
                setSubmitting(button, true);
                state.dataset.state = 'neutral';
                state.textContent = `Preparing ${label.toLowerCase()}...`;
                try {
                    const res = await apiAdminTenantIsolationEvidenceExport({ scope: 'combined', format, limit: 50 });
                    if (!res.ok) {
                        state.dataset.state = 'error';
                        state.textContent = apiUnavailableMessage(res, `${label} failed.`);
                        return;
                    }
                    const fallback = `tenant-isolation-execution-evidence.${format === 'markdown' ? 'md' : format}`;
                    downloadTextFile(filenameFromContentDisposition(res.filename, fallback), res.text || '', res.contentType || 'text/plain');
                    state.dataset.state = 'success';
                    state.textContent = `${label} prepared. No backfill, access-switch, reset, R2, provider, Stripe, or Cloudflare action was executed.`;
                } finally {
                    setSubmitting(button, false);
                }
            });
            combined.appendChild(button);
        }
        section.append(combined, state);
        container.appendChild(section);
    }

    function renderTenantBlockedActions(container) {
        const section = readinessSection('Blocked Actions', 'Visible operator boundaries. These actions are not executable from the Admin Control Plane.');
        const grid = el('div', 'admin-control-grid');
        for (const item of [
            ['Ownership backfill', 'blocked'],
            ['Access switch', 'blocked'],
            ['Confirmed legacy reset', 'blocked'],
            ['Live R2 listing/deletion', 'not_available'],
        ]) {
            const card = el('article', 'admin-control-card glass glass-card reveal visible');
            const top = el('div', 'admin-control-card__top');
            top.append(el('h3', 'admin-section-title', item[0]), badge(statusLabel(item[1]), 'disabled'));
            card.append(top, el('p', 'admin-shell__desc', 'Requires separate approved evidence and operator implementation plan. This dashboard offers no execution control.'));
            grid.appendChild(card);
        }
        section.appendChild(grid);
        container.appendChild(section);
    }

    async function renderTenantAssets() {
        const container = byId('tenantAssetCenter');
        if (!container) return;
        clear(container);
        container.appendChild(el('div', 'admin-state', 'Loading tenant asset domain evidence...'));
        const res = await apiAdminTenantAssetDomainEvidence();
        const report = normalizeTenantDomainReport(res.ok ? res.data : null);
        clear(container);

        const hero = el('div', 'admin-control-hero glass glass-card reveal visible');
        const copy = el('div');
        copy.append(el('p', 'admin-control-hero__eyebrow', 'Tenant Asset Center'));
        copy.append(el('h2', 'admin-control-hero__title', 'Cross-domain ownership inventory, evidence gaps, and storage safety.'));
        copy.append(el('p', 'admin-control-hero__copy', 'This panel is read-only evidence and admin visibility. It does not claim tenant isolation, perform ownership backfill, switch runtime access checks, execute reset/delete operations, or list live R2.'));
        const facts = detailRows([
            ['Evidence source', report.source || 'repo registry'],
            ['Generated', report.generatedAt || 'not reported'],
            ['No backfill', report.noBackfill === true ? 'true' : 'not reported'],
            ['No access switch', report.noAccessSwitch === true ? 'true' : 'not reported'],
            ['Tenant isolation claimed', report.tenantIsolationClaimed === true ? 'true' : 'false'],
            ['Production readiness', report.productionReadiness || 'blocked'],
        ]);
        hero.append(copy, facts);
        container.appendChild(hero);

        container.appendChild(operatorGuidancePanel({
            eyebrow: 'Tenant asset safety',
            copy: 'Review D1 metadata evidence and manual-review dry-runs first. Backfill, access switching, confirmed reset, and live R2 operations remain blocked unless separately approved with operator evidence.',
            badges: [
                { label: 'Read-only evidence', variant: 'user' },
                { label: 'Tenant isolation unclaimed', variant: 'legacy' },
                { label: 'Backfill/access/reset blocked', variant: 'disabled' },
            ],
            items: [
                {
                    badge: { label: 'Review first', variant: 'user' },
                    title: 'Open the manual-review queue',
                    copy: 'Use Operations to run the post-cleanup supersession dry-run and export evidence before treating old counts as current.',
                },
                {
                    badge: { label: 'Diagnostics', variant: 'legacy' },
                    title: 'Use evidence actions',
                    copy: 'Copy current templates and roadmap paths; browser actions remain refresh/copy/export only.',
                },
                {
                    badge: { label: 'Blocked', variant: 'disabled' },
                    title: 'Do not execute tenant changes here',
                    copy: 'No browser control lists or mutates live R2, performs ownership backfill, enables access-switching, or executes reset/delete operations.',
                },
            ],
        }));

        const matrix = readinessSection('Tenant Asset Domain Matrix', 'Broader current-state domain inventory. Metrics are D1 metadata only when available and never live R2 proof.');
        renderTenantDomainMatrix(matrix, report.domains || []);
        container.appendChild(matrix);

        const evidence = readinessSection('Evidence Actions', 'Safe copy/open actions only. No browser shell execution and no destructive admin action.');
        const actions = el('div', 'admin-control-chip-row');
        const refresh = el('button', 'btn-action', 'Refresh domain evidence');
        refresh.type = 'button';
        refresh.addEventListener('click', () => { void renderTenantAssets(); });
        actions.appendChild(refresh);
        for (const [label, value] of [
            ['Copy domain roadmap path', 'docs/tenant-assets/TENANT_ASSET_DOMAIN_EXPANSION_ROADMAP.md'],
            ['Copy manual-review evidence template path', 'docs/tenant-assets/MANUAL_REVIEW_IDEMPOTENCY_EVIDENCE_TEMPLATE.md'],
            ['Copy legacy reset evidence template path', 'docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md'],
        ]) {
            const button = el('button', 'btn-action btn-action--secondary', label);
            button.type = 'button';
            button.addEventListener('click', async () => {
                const copied = await copyTextToClipboard(value);
                notify(copied ? `${label.replace(/^Copy /, '')} copied.` : 'Copy failed.', copied ? 'success' : 'error');
            });
            actions.appendChild(button);
        }
        const reviewLink = el('a', 'btn-action', 'Open manual-review queue');
        reviewLink.href = '#operations';
        actions.appendChild(reviewLink);
        evidence.appendChild(actions);
        const blockedClaims = el('div', 'admin-control-chip-row');
        for (const claim of report.blockedClaims || []) {
            blockedClaims.appendChild(badge(claim, 'disabled'));
        }
        evidence.appendChild(blockedClaims);
        container.appendChild(evidence);

        const storage = readinessSection('Storage Safety', 'Selected-user storage reconciliation is available from Admin Users > Usage. It uses D1 metadata only.');
        storage.appendChild(readinessCards([
            {
                title: 'Reconciliation dry-run',
                status: 'available',
                copy: 'Computes recorded usage, known D1 asset bytes, delta, missing byte metadata, public/private counts, folder count, and orphan metadata. It does not list R2 or fix counters.',
                meta: [
                    ['Mutation', 'none'],
                    ['R2 listing', 'not performed'],
                    ['Tenant isolation claim', 'false'],
                ],
            },
            {
                title: 'Future quota evidence',
                status: 'required',
                copy: 'Quota/storage evidence is required before any reset/delete/backfill/access-switch claim can be considered.',
                meta: [
                    ['Accepted proof', 'operator evidence plus local tests'],
                    ['Automatic repair', 'not implemented here'],
                ],
            },
        ], (item) => ({
            title: item.title,
            badge: { label: item.status, variant: statusVariant(item.status) },
            copy: item.copy,
            meta: item.meta,
        })));
        container.appendChild(storage);

        renderTenantIsolationExecution(container);
        renderTenantBlockedActions(container);
        if (!res.ok) {
            renderUnavailable(container, res, 'Tenant asset domain evidence endpoint unavailable; static fallback shown.');
        }
    }

    async function exportLegacyMediaResetDryRunJson(button) {
        setSubmitting(button, true);
        setState('readinessStatusState', 'Preparing legacy media reset dry-run evidence export...');
        try {
            const res = await apiAdminLegacyMediaResetDryRunExport({ format: 'json', limit: 50 });
            if (!res.ok) {
                setState('readinessStatusState', apiUnavailableMessage(res, 'Legacy reset dry-run export unavailable.'), 'error');
                notify('Legacy reset dry-run export unavailable.', 'error');
                return;
            }
            const fallback = `legacy-media-reset-dry-run-${new Date().toISOString().slice(0, 10)}.json`;
            downloadTextFile(filenameFromContentDisposition(res.filename, fallback), res.text || '{}\n', res.contentType || 'application/json');
            setState('readinessStatusState', 'Legacy reset dry-run JSON export prepared. No reset or deletion was executed.', 'success');
            notify('Legacy reset dry-run export prepared.', 'success');
        } finally {
            setSubmitting(button, false);
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
        renderTenantAssets,
        loadTenantAssetManualReviewQueue,
        exportTenantAssetManualReviewEvidenceJson,
        exportLegacyMediaResetDryRunJson,
    };
}
