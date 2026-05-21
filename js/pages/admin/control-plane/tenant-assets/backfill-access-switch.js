/* ============================================================
   BITBI — Admin Control Plane / Tenant Assets Backfill + Access-Switch
   Ownership backfill, access-switch diagnostics, and tenant execution shell.
   ============================================================ */

import {
    apiAdminAccessSwitchShadowDiagnostics,
    apiAdminAccessSwitchStatus,
    apiAdminOwnershipBackfillDryRun,
    apiAdminOwnershipBackfillExecute,
    apiAdminTenantIsolationEvidenceExport,
} from '../../../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    addCell,
    apiUnavailableMessage,
    badge,
    clear,
    createIdempotencyKey,
    detailRows,
    downloadTextFile,
    el,
    filenameFromContentDisposition,
    readableToken,
    readinessSection,
    setSubmitting,
    shortId,
    simpleList,
    table,
} from '../core.js?v=__ASSET_VERSION__';
import {
    createTenantLegacyResetDomain,
} from './legacy-reset.js?v=__ASSET_VERSION__';

export function createTenantExecutionDomain({ notify, formatDate }) {
    function lifecycleTextBlock(label, value) {
        const block = el('div', 'admin-lifecycle-text-block');
        block.appendChild(el('span', 'admin-lifecycle-text-block__label', label));
        block.appendChild(el('p', 'admin-lifecycle-text-block__value', value || 'Not recorded.'));
        return block;
    }

    let tenantIsolationBackfillReport = null;
    let tenantIsolationDangerModal = null;

    const TENANT_ISOLATION_DANGER = Object.freeze({
        backfill: {
            name: 'Ownership Backfill',
            confirmation: 'BACKFILL OWNERSHIP',
            changes: 'Writes tenant ownership metadata only for the exact ai_images candidate selected from current bounded D1 dry-run evidence.',
            domains: 'Current execution path is narrowed to one exact ai_images candidate ID with batchLimit 1. ai_folders and all deferred domains remain blocked from this UI execution path.',
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

    function getExactBackfillCandidate(report = tenantIsolationBackfillReport) {
        const candidates = Array.isArray(report?.candidates) ? report.candidates : [];
        const exactCandidates = candidates.filter((item) =>
            item?.domain === 'ai_images'
            && item?.classification === 'safe_to_backfill'
            && typeof item.assetId === 'string'
            && item.assetId.trim()
        );
        return exactCandidates.length === 1 ? exactCandidates[0] : null;
    }

    function explainExactBackfillCandidateBlock(report = tenantIsolationBackfillReport) {
        if (!report) return 'Load the ownership backfill dry-run before using the execution endpoint.';
        const candidates = Array.isArray(report?.candidates) ? report.candidates : [];
        const exactCandidates = candidates.filter((item) =>
            item?.domain === 'ai_images'
            && item?.classification === 'safe_to_backfill'
            && typeof item.assetId === 'string'
            && item.assetId.trim()
        );
        if (exactCandidates.length === 0) {
            return 'No exact safe ai_images candidate ID is available in the loaded dry-run. Execution remains disabled.';
        }
        return 'More than one safe ai_images candidate is present. This UI only supports one exact current evidence candidate with batchLimit 1.';
    }

    function renderOwnershipBackfillControl() {
        const card = tenantIsolationCard('backfill', 'Ownership Backfill', 'dangerous');
        card.appendChild(el('p', 'admin-shell__desc', 'Writes ownership metadata only for one exact ai_images candidate classified safe by a bounded dry-run. Unsafe, public, missing-evidence, manual-review, ai_folders, and deferred rows remain blocked.'));
        const summary = el('div', 'admin-inventory');
        const exactCandidate = el('div', 'admin-inventory');
        exactCandidate.id = 'tenantBackfillExactCandidate';
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
                renderExactBackfillCandidate();
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
        reason.placeholder = 'Operator reason required for exact ai_images candidate execution.';
        const confirmation = document.createElement('input');
        confirmation.id = 'tenantBackfillConfirmation';
        confirmation.className = 'admin-ai__input';
        confirmation.placeholder = 'Type BACKFILL OWNERSHIP for the exact ai_images candidate';
        const executeDryRun = el('button', 'btn-action btn-action--secondary', 'Execute Endpoint Dry-run');
        executeDryRun.type = 'button';
        const executeWrite = el('button', 'btn-action btn-action--danger', 'Write Safe Ownership Metadata');
        executeWrite.type = 'button';
        const blockedReason = el('p', 'admin-shell__desc', 'Execution disabled until dry-run evidence provides one exact safe ai_images candidate ID, reason is entered, and exact confirmation is typed.');

        function formReady() {
            return Boolean(reason.value.trim() && confirmation.value.trim() === 'BACKFILL OWNERSHIP');
        }
        function renderExactBackfillCandidate() {
            clear(exactCandidate);
            const candidate = getExactBackfillCandidate();
            if (!candidate) {
                exactCandidate.appendChild(el('p', 'admin-shell__desc', explainExactBackfillCandidateBlock()));
                return;
            }
            exactCandidate.appendChild(detailRows([
                ['Allowed execution domain', 'ai_images'],
                ['Batch limit', '1'],
                ['Exact candidate asset ID', candidate.assetId],
                ['Classification', readableToken(candidate.classification)],
                ['Reason', readableToken(candidate.reason)],
            ]));
        }
        function syncBackfillButtons() {
            const candidate = getExactBackfillCandidate();
            executeDryRun.disabled = !(candidate && formReady());
            executeWrite.disabled = !(candidate && formReady());
            if (!candidate) {
                blockedReason.textContent = explainExactBackfillCandidateBlock();
            } else if (!formReady()) {
                blockedReason.textContent = 'Execution disabled until operator reason is entered and exact BACKFILL OWNERSHIP confirmation is typed.';
            } else {
                blockedReason.textContent = `Execution will target only ai_images candidate ${candidate.assetId} with batchLimit 1. Tenant isolation remains unclaimed.`;
            }
        }
        reason.addEventListener('input', syncBackfillButtons);
        confirmation.addEventListener('input', syncBackfillButtons);

        async function runBackfillExecution(dryRunMode, button) {
            const candidate = getExactBackfillCandidate();
            if (!candidate) {
                state.dataset.state = 'error';
                state.textContent = explainExactBackfillCandidateBlock();
                return;
            }
            if (!formReady()) {
                state.dataset.state = 'error';
                state.textContent = 'Reason and exact BACKFILL OWNERSHIP confirmation are required.';
                return;
            }
            if (!dryRunMode) {
                const confirmed = window.confirm(`Write ownership metadata only for exact ai_images candidate ${candidate.assetId}? This does not switch access checks, does not reset media, and does not claim tenant isolation.`);
                if (!confirmed) return;
            }
            setSubmitting(button, true);
            state.dataset.state = 'neutral';
            state.textContent = dryRunMode ? 'Submitting exact-candidate backfill execution dry-run...' : 'Submitting guarded exact-candidate ownership metadata write...';
            try {
                const res = await apiAdminOwnershipBackfillExecute({
                    dryRun: dryRunMode,
                    confirm: true,
                    confirmation: 'BACKFILL OWNERSHIP',
                    reason: reason.value.trim(),
                    domains: ['ai_images'],
                    batchLimit: 1,
                    candidateAssetIds: [candidate.assetId],
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
                    renderExactBackfillCandidate();
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
        renderExactBackfillCandidate();
        card.append(summary, exactCandidate, form);
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
        controls.append(renderOwnershipBackfillControl(), renderAccessSwitchControl(), legacyResetDomain.renderLegacyMediaResetControl());
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

    const legacyResetDomain = createTenantLegacyResetDomain({
        notify,
        formatDate,
        postCleanupStatusText,
        tenantExportButtons,
        tenantIsolationCard,
    });

    return {
        renderTenantIsolationExecution,
        exportLegacyMediaResetDryRunJson: legacyResetDomain.exportLegacyMediaResetDryRunJson,
    };
}
