/* ============================================================
   BITBI — Admin Control Plane / AI Budget Domain
   Frontend-only rendering and guarded admin controls for AI budget evidence.
   ============================================================ */

import {
    apiAdminAiBudgetSwitches,
    apiAdminAiCleanupExpiredPlatformBudgetEvidenceArchives,
    apiAdminAiCleanupUsageAttempts,
    apiAdminAiCreatePlatformBudgetEvidenceArchive,
    apiAdminAiDownloadPlatformBudgetEvidenceArchive,
    apiAdminAiExpirePlatformBudgetEvidenceArchive,
    apiAdminAiPlatformBudgetCaps,
    apiAdminAiPlatformBudgetEvidenceArchives,
    apiAdminAiPlatformBudgetReconciliation,
    apiAdminAiPlatformBudgetRepairReport,
    apiAdminAiPlatformBudgetRepairReportExport,
    apiAdminAiPlatformBudgetUsage,
    apiAdminAiRepairPlatformBudgetCandidate,
    apiAdminAiUpdateBudgetSwitch,
    apiAdminAiUpdatePlatformBudgetCap,
    apiAdminAiUsageAttempt,
    apiAdminAiUsageAttempts,
} from '../../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    FEATURE_BADGES,
    addCell,
    apiUnavailableMessage,
    badge,
    byId,
    clear,
    createIdempotencyKey,
    detailRows,
    downloadTextFile,
    effectiveSwitchVariant,
    el,
    filenameFromContentDisposition,
    renderUnavailable,
    setState,
    setSubmitting,
    shortId,
    table,
    variantFor,
} from './core.js?v=__ASSET_VERSION__';

export function createAiBudgetDomain({ notify, formatDate }) {
    async function loadAiAttempts() {
        const list = byId('aiAttemptsList');
        setState('aiAttemptsState', 'Loading usage attempts...');
        clear(list);
        const res = await apiAdminAiUsageAttempts({
            feature: byId('aiAttemptsFeature')?.value || undefined,
            status: byId('aiAttemptsStatus')?.value.trim() || undefined,
            organizationId: byId('aiAttemptsOrgId')?.value.trim() || undefined,
            limit: 25,
        });
        if (!res.ok) {
            setState('aiAttemptsState', '');
            renderUnavailable(list, res, 'AI usage attempts unavailable.');
            return;
        }
        const attempts = Array.isArray(res.data?.attempts) ? res.data.attempts : [];
        if (attempts.length === 0) {
            setState('aiAttemptsState', 'No AI usage attempts found.');
            return;
        }
        setState('aiAttemptsState', `Showing ${attempts.length} sanitized attempts.`);
        const { wrap, tbody } = table(['Feature', 'Status', 'Provider', 'Billing', 'Credits', 'Replay', 'Updated', 'Actions']);
        for (const attempt of attempts) {
            const tr = document.createElement('tr');
            const feature = FEATURE_BADGES[attempt.feature] || [attempt.feature || '-', 'user'];
            addCell(tr, badge(feature[0], feature[1]));
            addCell(tr, badge(attempt.status || '-', variantFor(attempt.status)));
            addCell(tr, attempt.providerStatus || '-');
            addCell(tr, attempt.billingStatus || '-');
            addCell(tr, attempt.creditCost ?? '-');
            addCell(tr, attempt.replay?.available ? 'Available' : (attempt.replay?.status || '-'));
            addCell(tr, formatDate(attempt.updatedAt));
            const btn = el('button', 'btn-action', 'Inspect');
            btn.type = 'button';
            btn.addEventListener('click', () => loadAiAttemptDetail(attempt.attemptId));
            addCell(tr, btn);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);
    }

    async function loadAiBudgetSwitches() {
        const list = byId('aiBudgetSwitchesList');
        const summaryNode = byId('aiBudgetSwitchesSummary');
        setState('aiBudgetSwitchesState', 'Loading AI budget switches...');
        clear(list);
        clear(summaryNode);
        const res = await apiAdminAiBudgetSwitches();
        if (!res.ok) {
            setState('aiBudgetSwitchesState', '');
            renderUnavailable(list, res, 'AI budget switches unavailable.');
            return;
        }
        const summary = res.data?.summary || {};
        if (summaryNode) {
            summaryNode.appendChild(detailRows([
                ['Effective rule', 'Cloudflare master flag enabled AND app switch enabled'],
                ['Total switches', summary.totalSwitches ?? '-'],
                ['Master enabled', summary.masterEnabledCount ?? '-'],
                ['App enabled', summary.appEnabledCount ?? '-'],
                ['Effective enabled', summary.effectiveEnabledCount ?? '-'],
                ['Disabled by master', summary.disabledByMasterCount ?? '-'],
                ['Disabled by app', summary.disabledByAppCount ?? '-'],
                ['Live platform caps', summary.liveBudgetCapsStatus || 'not_implemented'],
            ]));
        }
        const switches = Array.isArray(res.data?.switches) ? res.data.switches : [];
        if (switches.length === 0) {
            setState('aiBudgetSwitchesState', 'No allowed AI budget switches returned.');
            return;
        }
        setState('aiBudgetSwitchesState', `Showing ${switches.length} allowed switches. Cloudflare values are not displayed.`);
        const { wrap, tbody } = table(['Switch', 'Scope', 'Master', 'App', 'Effective', 'Cap Status', 'Updated', 'Action']);
        for (const item of switches) {
            const tr = document.createElement('tr');
            const title = el('div', null);
            title.appendChild(el('strong', null, item.label || item.switchKey));
            title.appendChild(el('br'));
            title.appendChild(el('span', 'admin-inventory__meta', item.description || item.switchKey));
            title.appendChild(el('br'));
            title.appendChild(el('span', 'admin-inventory__meta', item.recommendedOperatorNote || 'Cloudflare master flag must also be enabled.'));
            addCell(tr, title);
            addCell(tr, item.budgetScope || '-');
            addCell(tr, badge(item.masterFlagStatus || 'unknown', effectiveSwitchVariant(item.masterFlagStatus)));
            addCell(tr, badge(item.appSwitchEnabled ? 'enabled' : (item.appSwitchStatus || 'disabled'), item.appSwitchEnabled ? 'active' : 'disabled'));
            addCell(tr, badge(item.effectiveEnabled ? 'enabled' : 'disabled', item.effectiveEnabled ? 'active' : 'disabled'));
            addCell(tr, `${item.liveCapStatus || 'not_implemented'} (${item.liveCapFuturePhase || 'future'})`);
            addCell(tr, item.updatedAt ? formatDate(item.updatedAt) : '-');
            const action = el('button', 'btn-action', item.appSwitchEnabled ? 'Disable' : 'Enable');
            action.type = 'button';
            action.dataset.switchKey = item.switchKey;
            action.dataset.enabled = item.appSwitchEnabled ? 'false' : 'true';
            action.disabled = item.appSwitchAvailable === false;
            action.title = item.masterEnabled
                ? 'Update the app-level switch. Cloudflare master must also remain enabled.'
                : 'Cloudflare master flag is disabled or missing; the app switch cannot make this effective.';
            action.addEventListener('click', () => handleAiBudgetSwitchUpdate(item, action));
            addCell(tr, action);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);
    }

    async function handleAiBudgetSwitchUpdate(item, button) {
        const nextEnabled = !item.appSwitchEnabled;
        const promptMessage = `${nextEnabled ? 'Enable' : 'Disable'} ${item.label || item.switchKey}. Enter an operator reason. Cloudflare master flag must also be enabled; platform_admin_lab_budget paths also require daily/monthly cap allowance.`;
        const reason = window.prompt(promptMessage, '');
        if (!reason || !reason.trim()) {
            setState('aiBudgetSwitchesState', 'Switch update cancelled: reason is required.', 'error');
            return;
        }
        const confirmed = window.confirm(`Confirm app-level ${nextEnabled ? 'enable' : 'disable'} for ${item.switchKey}? This does not change Cloudflare variables.`);
        if (!confirmed) {
            setState('aiBudgetSwitchesState', 'Switch update cancelled.', 'neutral');
            return;
        }
        setSubmitting(button, true);
        setState('aiBudgetSwitchesState', 'Updating AI budget switch...');
        try {
            const res = await apiAdminAiUpdateBudgetSwitch(item.switchKey, {
                enabled: nextEnabled,
                reason: reason.trim(),
                idempotencyKey: createIdempotencyKey('ai-budget-switch'),
            });
            if (!res.ok) {
                setState('aiBudgetSwitchesState', apiUnavailableMessage(res, 'AI budget switch update failed.'), 'error');
                notify('AI budget switch update failed.', 'error');
                return;
            }
            notify('AI budget switch updated.', 'success');
            await loadAiBudgetSwitches();
        } finally {
            setSubmitting(button, false);
        }
    }

    async function loadPlatformBudgetCaps() {
        const list = byId('platformBudgetCapsList');
        const summaryNode = byId('platformBudgetCapsSummary');
        setState('platformBudgetCapsState', 'Loading platform budget caps...');
        clear(list);
        clear(summaryNode);
        const res = await apiAdminAiPlatformBudgetCaps();
        if (!res.ok) {
            setState('platformBudgetCapsState', '');
            renderUnavailable(list, res, 'Platform budget caps unavailable.');
            return;
        }
        const data = res.data || {};
        const windows = Array.isArray(data.windows) ? data.windows : [];
        if (summaryNode) {
            summaryNode.appendChild(detailRows([
                ['Scope', data.budgetScope || 'platform_admin_lab_budget'],
                ['Status', data.liveBudgetCapsStatus || 'platform_admin_lab_budget_foundation'],
                ['Cap enforced', data.capEnforced ? 'Yes' : 'No'],
                ['Customer billing', 'No'],
                ['Generated', formatDate(data.generatedAt)],
            ]));
        }
        if (windows.length === 0) {
            setState('platformBudgetCapsState', 'No platform budget cap windows returned.');
            return;
        }
        setState('platformBudgetCapsState', 'Platform admin lab caps are enforced after Cloudflare master and D1 app switches.');
        const { wrap, tbody } = table(['Window', 'Limit', 'Used', 'Remaining', 'Status', 'Updated', 'Action']);
        for (const item of windows) {
            const tr = document.createElement('tr');
            const limit = item.limit || {};
            addCell(tr, item.windowType || '-');
            addCell(tr, limit.limitUnits ?? '-');
            addCell(tr, item.usedUnits ?? 0);
            addCell(tr, item.remainingUnits ?? '-');
            addCell(tr, badge(item.capStatus || 'missing', item.capStatus === 'available' ? 'active' : 'disabled'));
            addCell(tr, limit.updatedAt ? formatDate(limit.updatedAt) : '-');
            const action = el('button', 'btn-action', limit.limitUnits ? 'Update' : 'Set');
            action.type = 'button';
            action.addEventListener('click', () => handlePlatformBudgetCapUpdate(data.budgetScope || 'platform_admin_lab_budget', item, action));
            addCell(tr, action);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);

        const usageRes = await apiAdminAiPlatformBudgetUsage();
        if (usageRes.ok && Array.isArray(usageRes.data?.usage?.operationUsage) && usageRes.data.usage.operationUsage.length) {
            const usageTitle = el('h4', 'admin-section-title', 'Current Month Usage');
            list.appendChild(usageTitle);
            const usageTable = table(['Operation', 'Units', 'Events']);
            for (const row of usageRes.data.usage.operationUsage) {
                const tr = document.createElement('tr');
                addCell(tr, row.operationKey || '-');
                addCell(tr, row.usedUnits ?? 0);
                addCell(tr, row.eventCount ?? 0);
                usageTable.tbody.appendChild(tr);
            }
            list.appendChild(usageTable.wrap);
        }
    }

    async function handlePlatformBudgetCapUpdate(budgetScope, item, button) {
        const windowType = item.windowType;
        const current = item.limit?.limitUnits || '';
        const rawLimit = window.prompt(`Set ${windowType} cap units for ${budgetScope}. This is not customer billing.`, String(current));
        if (!rawLimit || !rawLimit.trim()) {
            setState('platformBudgetCapsState', 'Cap update cancelled: limit is required.', 'error');
            return;
        }
        const limitUnits = Number(rawLimit);
        if (!Number.isInteger(limitUnits) || limitUnits <= 0) {
            setState('platformBudgetCapsState', 'Cap update cancelled: limit must be a positive integer.', 'error');
            return;
        }
        const reason = window.prompt('Enter an operator reason for this budget cap update.', '');
        if (!reason || !reason.trim()) {
            setState('platformBudgetCapsState', 'Cap update cancelled: reason is required.', 'error');
            return;
        }
        const confirmed = window.confirm(`Confirm ${windowType} cap ${limitUnits} for ${budgetScope}? This does not change Stripe, Cloudflare, or customer billing.`);
        if (!confirmed) {
            setState('platformBudgetCapsState', 'Cap update cancelled.', 'neutral');
            return;
        }
        setSubmitting(button, true);
        setState('platformBudgetCapsState', 'Updating platform budget cap...');
        try {
            const res = await apiAdminAiUpdatePlatformBudgetCap(budgetScope, {
                windowType,
                limitUnits,
                reason: reason.trim(),
                idempotencyKey: createIdempotencyKey('platform-budget-cap'),
            });
            if (!res.ok) {
                setState('platformBudgetCapsState', apiUnavailableMessage(res, 'Platform budget cap update failed.'), 'error');
                notify('Platform budget cap update failed.', 'error');
                return;
            }
            notify('Platform budget cap updated.', 'success');
            await loadPlatformBudgetCaps();
        } finally {
            setSubmitting(button, false);
        }
    }

    function platformBudgetRepairPayload(candidate, { dryRun, reason }) {
        return {
            budgetScope: candidate.budgetScope || 'platform_admin_lab_budget',
            candidateId: candidate.candidateId,
            candidateType: candidate.issueType,
            requestedAction: candidate.proposedAction,
            dryRun,
            confirm: dryRun ? false : true,
            reason,
        };
    }

    async function handlePlatformBudgetRepair(candidate, mode, button) {
        const dryRun = mode === 'dry_run';
        const reviewOnly = mode === 'review';
        const label = reviewOnly ? 'record review note' : (dryRun ? 'dry run repair' : 'apply repair');
        const reason = window.prompt(`Enter an operator reason to ${label}. No provider, Stripe, credit, or source-row mutation is performed.`, '');
        if (!reason || !reason.trim()) {
            setState('platformBudgetReconciliationState', 'Repair action cancelled: reason is required.', 'error');
            return;
        }
        if (!dryRun) {
            const confirmed = window.confirm(
                reviewOnly
                    ? 'Record this review note only? No platform budget usage event, provider call, Stripe call, credit mutation, or source row update will occur.'
                    : 'Apply this repair by creating one missing platform budget usage event from local D1 evidence? No provider call, Stripe call, credit mutation, or source row update will occur.',
            );
            if (!confirmed) {
                setState('platformBudgetReconciliationState', 'Repair action cancelled.', 'neutral');
                return;
            }
        }
        setSubmitting(button, true);
        setState('platformBudgetReconciliationState', dryRun ? 'Running repair dry-run...' : 'Submitting admin-approved repair...');
        try {
            const res = await apiAdminAiRepairPlatformBudgetCandidate(
                platformBudgetRepairPayload(candidate, { dryRun, reason: reason.trim() }),
                { idempotencyKey: createIdempotencyKey('platform-budget-repair') },
            );
            if (!res.ok) {
                setState('platformBudgetReconciliationState', apiUnavailableMessage(res, 'Platform budget repair request failed.'), 'error');
                notify('Platform budget repair request failed.', 'error');
                return;
            }
            const repair = res.data?.repair || {};
            if (repair.dryRun) {
                setState('platformBudgetReconciliationState', 'Dry-run completed. No repair was applied.');
                notify('Repair dry-run completed.', 'success');
                return;
            }
            notify(repair.repairApplied ? 'Missing usage evidence created.' : 'Repair review recorded.', 'success');
            await loadPlatformBudgetReconciliation();
        } finally {
            setSubmitting(button, false);
        }
    }

    async function loadPlatformBudgetReconciliation() {
        const list = byId('platformBudgetReconciliationList');
        const summaryNode = byId('platformBudgetReconciliationSummary');
        setState('platformBudgetReconciliationState', 'Loading platform budget reconciliation...');
        clear(list);
        clear(summaryNode);
        const res = await apiAdminAiPlatformBudgetReconciliation({ limit: 25, includeCandidates: true });
        if (!res.ok) {
            setState('platformBudgetReconciliationState', '');
            renderUnavailable(list, res, 'Platform budget reconciliation unavailable.');
            return;
        }
        const reconciliation = res.data?.reconciliation || {};
        const summary = reconciliation.summary || {};
        if (summaryNode) {
            summaryNode.appendChild(detailRows([
                ['Scope', reconciliation.budgetScope || 'platform_admin_lab_budget'],
                ['Verdict', reconciliation.verdict || '-'],
                ['Critical issues', summary.criticalIssueCount ?? 0],
                ['Warnings', summary.warningIssueCount ?? 0],
                ['Repair candidates', summary.repairCandidateCount ?? 0],
                ['Read-only', reconciliation.repairApplied === false ? 'Yes' : 'No'],
                ['Generated', formatDate(reconciliation.generatedAt)],
            ]));
        }
        setState('platformBudgetReconciliationState', 'Read-only reconciliation evidence plus explicit admin-approved repair actions. No automatic repair is applied.');
        const candidates = Array.isArray(reconciliation.repairCandidates) ? reconciliation.repairCandidates : [];
        if (candidates.length === 0) {
            list.appendChild(el('p', 'admin-shell__desc', 'No reconciliation repair candidates were returned for the bounded report.'));
            return;
        }
        const { wrap, tbody } = table(['Issue', 'Severity', 'Operation', 'Source', 'Action', 'Reason', 'Repair']);
        for (const item of candidates.slice(0, 25)) {
            const tr = document.createElement('tr');
            addCell(tr, item.issueType || '-');
            addCell(tr, badge(item.severity || 'warning', item.severity === 'critical' ? 'disabled' : 'legacy'));
            addCell(tr, item.operationKey || '-');
            addCell(tr, shortId(item.sourceAttemptId || item.sourceJobId || item.usageEventIds?.[0]));
            addCell(tr, item.proposedAction || '-');
            addCell(tr, item.reason || '-');
            const actions = el('div', 'admin-control-chip-row');
            if (item.phase419Executable || item.proposedAction === 'create_missing_usage_event') {
                const dryRunButton = el('button', 'btn-action btn-action--secondary', 'Dry Run');
                dryRunButton.type = 'button';
                dryRunButton.addEventListener('click', () => handlePlatformBudgetRepair(item, 'dry_run', dryRunButton));
                const applyButton = el('button', 'btn-action', 'Apply Repair');
                applyButton.type = 'button';
                applyButton.addEventListener('click', () => handlePlatformBudgetRepair(item, 'apply', applyButton));
                actions.append(dryRunButton, applyButton);
            } else if (item.reviewOnly) {
                const reviewButton = el('button', 'btn-action btn-action--secondary', 'Record Review');
                reviewButton.type = 'button';
                reviewButton.addEventListener('click', () => handlePlatformBudgetRepair(item, 'review', reviewButton));
                actions.appendChild(reviewButton);
            } else {
                actions.appendChild(el('span', 'admin-shell__desc', 'Future review'));
            }
            addCell(tr, actions);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);
        list.appendChild(el('p', 'admin-shell__desc', 'Repairs are explicit and admin-approved only. Apply Repair creates missing platform budget usage evidence only; review actions do not mutate usage/source rows. No provider, Stripe, credit, or customer billing action is available here.'));
    }

    async function loadPlatformBudgetRepairReport() {
        const summaryNode = byId('platformBudgetRepairReportSummary');
        const list = byId('platformBudgetRepairReportList');
        setState('platformBudgetRepairReportState', 'Loading repair evidence report...');
        clear(summaryNode);
        clear(list);
        const res = await apiAdminAiPlatformBudgetRepairReport({
            limit: 25,
            includeDetails: false,
            includeCandidates: false,
        });
        if (!res.ok) {
            setState('platformBudgetRepairReportState', '');
            renderUnavailable(list, res, 'Platform budget repair evidence report unavailable.');
            return;
        }
        const report = res.data?.report || {};
        const summary = report.summary || {};
        if (summaryNode) {
            summaryNode.appendChild(detailRows([
                ['Scope', report.budgetScope || 'platform_admin_lab_budget'],
                ['Source', report.source || '-'],
                ['Total repair actions', summary.totalRepairActions ?? 0],
                ['Executable repairs applied', summary.executableRepairsApplied ?? 0],
                ['Review-only actions', summary.reviewOnlyActionsRecorded ?? 0],
                ['Failed repair attempts', summary.failedRepairAttempts ?? 0],
                ['Created usage events', summary.createdUsageEventCount ?? 0],
                ['Automatic repair', report.automaticRepair === false ? 'No' : 'Unknown'],
                ['Generated', formatDate(report.generatedAt)],
            ]));
        }
        setState('platformBudgetRepairReportState', 'No repair is applied. Read-only operator evidence report; export is bounded and sanitized.');
        const statusRows = report.sections?.repairActionStatusRollup || [];
        const typeRows = report.sections?.repairActionTypeRollup || [];
        if (!statusRows.length && !typeRows.length) {
            list.appendChild(el('p', 'admin-shell__desc', 'No platform budget repair actions were returned for the bounded report.'));
        } else {
            const { wrap, tbody } = table(['Rollup', 'Count', 'Created usage events', 'Last action']);
            for (const row of statusRows.slice(0, 12)) {
                const tr = document.createElement('tr');
                addCell(tr, `status:${row.key || '-'}`);
                addCell(tr, row.count ?? 0);
                addCell(tr, row.createdUsageEventCount ?? 0);
                addCell(tr, formatDate(row.lastActionAt));
                tbody.appendChild(tr);
            }
            for (const row of typeRows.slice(0, 12)) {
                const tr = document.createElement('tr');
                addCell(tr, `type:${row.key || '-'}`);
                addCell(tr, row.count ?? 0);
                addCell(tr, row.createdUsageEventCount ?? 0);
                addCell(tr, formatDate(row.lastActionAt));
                tbody.appendChild(tr);
            }
            list.appendChild(wrap);
        }
        list.appendChild(el('p', 'admin-shell__desc', 'Reports and exports expose no raw prompts, provider bodies, raw idempotency keys, Stripe data, Cloudflare tokens, private keys, credit repairs, delete actions, or provider actions.'));
    }

    async function exportPlatformBudgetRepairReportJson(button) {
        setSubmitting(button, true);
        setState('platformBudgetRepairReportState', 'Preparing repair evidence JSON export...');
        try {
            const res = await apiAdminAiPlatformBudgetRepairReportExport({
                format: 'json',
                limit: 50,
                includeDetails: true,
                includeCandidates: false,
            });
            if (!res.ok) {
                setState('platformBudgetRepairReportState', apiUnavailableMessage(res, 'Repair evidence export failed.'), 'error');
                notify('Repair evidence export failed.', 'error');
                return;
            }
            const filename = `platform-budget-repair-report-${new Date().toISOString().slice(0, 10)}.json`;
            downloadTextFile(filename, res.text || '{}\n', 'application/json');
            setState('platformBudgetRepairReportState', 'Repair evidence JSON export prepared. No repair was applied.');
            notify('Repair evidence export prepared.', 'success');
        } finally {
            setSubmitting(button, false);
        }
    }

    async function loadPlatformBudgetEvidenceArchives() {
        const summaryNode = byId('platformBudgetEvidenceArchivesSummary');
        const list = byId('platformBudgetEvidenceArchivesList');
        setState('platformBudgetEvidenceArchivesState', 'Loading evidence archives...');
        clear(summaryNode);
        clear(list);
        const res = await apiAdminAiPlatformBudgetEvidenceArchives({ limit: 25 });
        if (!res.ok) {
            setState('platformBudgetEvidenceArchivesState', '');
            renderUnavailable(list, res, 'Platform budget evidence archives unavailable.');
            return;
        }
        const archives = Array.isArray(res.data?.archives) ? res.data.archives : [];
        const createdCount = archives.filter((archive) => archive.archiveStatus === 'created').length;
        const expiredCount = archives.filter((archive) => archive.archiveStatus === 'expired').length;
        const deletedCount = archives.filter((archive) => archive.archiveStatus === 'deleted').length;
        if (summaryNode) {
            summaryNode.appendChild(detailRows([
                ['Scope', res.data?.budgetScope || 'platform_admin_lab_budget'],
                ['Archives returned', archives.length],
                ['Created', createdCount],
                ['Expired', expiredCount],
                ['Deleted', deletedCount],
                ['Storage', 'AUDIT_ARCHIVE / platform-budget-evidence/'],
                ['Sanitized', 'Yes'],
            ]));
        }
        setState('platformBudgetEvidenceArchivesState', 'Archives are sanitized operator evidence snapshots. No repair, provider call, Stripe call, credit mutation, or source-row mutation is performed.');
        if (!archives.length) {
            list.appendChild(el('p', 'admin-shell__desc', 'No platform budget evidence archives were returned for the bounded list.'));
            return;
        }
        const { wrap, tbody } = table(['Archive', 'Status', 'Format', 'Created', 'Expires', 'Summary', 'Actions']);
        for (const archive of archives.slice(0, 25)) {
            const tr = document.createElement('tr');
            addCell(tr, shortId(archive.id));
            addCell(tr, badge(archive.archiveStatus || 'unknown', archive.archiveStatus === 'created' ? 'active' : 'disabled'));
            addCell(tr, archive.format || '-');
            addCell(tr, formatDate(archive.createdAt));
            addCell(tr, formatDate(archive.expiresAt));
            addCell(tr, `${archive.summary?.totalRepairActions ?? 0} repairs; ${archive.summary?.createdUsageEventCount ?? 0} usage events`);
            const actions = el('div', 'admin-control-chip-row');
            if (archive.archiveStatus === 'created') {
                const downloadButton = el('button', 'btn-action btn-action--secondary', 'Download');
                downloadButton.type = 'button';
                downloadButton.addEventListener('click', () => downloadPlatformBudgetEvidenceArchive(archive, downloadButton));
                const expireButton = el('button', 'btn-action btn-action--secondary', 'Expire');
                expireButton.type = 'button';
                expireButton.addEventListener('click', () => expirePlatformBudgetEvidenceArchive(archive, expireButton));
                actions.append(downloadButton, expireButton);
            } else {
                actions.appendChild(el('span', 'admin-shell__desc', 'No download'));
            }
            addCell(tr, actions);
            tbody.appendChild(tr);
        }
        list.appendChild(wrap);
        list.appendChild(el('p', 'admin-shell__desc', 'Archive metadata omits private R2 keys, raw idempotency keys, prompts, provider bodies, Stripe data, Cloudflare tokens, private keys, repair execution controls, credit actions, and provider actions.'));
    }

    async function createPlatformBudgetEvidenceArchive(button) {
        const format = byId('platformBudgetEvidenceArchiveFormat')?.value || 'json';
        const archiveType = byId('platformBudgetEvidenceArchiveType')?.value || 'repair_report';
        const retentionDays = Number(byId('platformBudgetEvidenceArchiveRetentionDays')?.value || 90);
        const reason = byId('platformBudgetEvidenceArchiveReason')?.value?.trim() || '';
        const includeDetails = byId('platformBudgetEvidenceArchiveIncludeDetails')?.checked === true;
        const includeCandidates = byId('platformBudgetEvidenceArchiveIncludeCandidates')?.checked === true;
        if (!reason) {
            setState('platformBudgetEvidenceArchivesState', 'Archive creation cancelled: reason is required.', 'error');
            return;
        }
        if (!Number.isInteger(retentionDays) || retentionDays <= 0 || retentionDays > 365) {
            setState('platformBudgetEvidenceArchivesState', 'Archive creation cancelled: retention days must be between 1 and 365.', 'error');
            return;
        }
        const confirmed = window.confirm('Create a sanitized platform budget evidence archive? No repair is applied, and no provider, Stripe, credit, Cloudflare, or source-row action is performed.');
        if (!confirmed) {
            setState('platformBudgetEvidenceArchivesState', 'Archive creation cancelled.', 'neutral');
            return;
        }
        setSubmitting(button, true);
        setState('platformBudgetEvidenceArchivesState', 'Creating sanitized evidence archive...');
        try {
            const res = await apiAdminAiCreatePlatformBudgetEvidenceArchive({
                budgetScope: 'platform_admin_lab_budget',
                format,
                archiveType,
                retentionDays,
                reason,
                includeDetails,
                includeCandidates,
                filters: {
                    limit: 50,
                    includeDetails,
                    includeCandidates,
                },
            }, { idempotencyKey: createIdempotencyKey('platform-budget-evidence-archive') });
            if (!res.ok) {
                setState('platformBudgetEvidenceArchivesState', apiUnavailableMessage(res, 'Evidence archive creation failed.'), 'error');
                notify('Evidence archive creation failed.', 'error');
                return;
            }
            notify('Evidence archive created.', 'success');
            await loadPlatformBudgetEvidenceArchives();
        } finally {
            setSubmitting(button, false);
        }
    }

    async function downloadPlatformBudgetEvidenceArchive(archive, button) {
        setSubmitting(button, true);
        setState('platformBudgetEvidenceArchivesState', 'Preparing archived evidence download...');
        try {
            const res = await apiAdminAiDownloadPlatformBudgetEvidenceArchive(archive.id);
            if (!res.ok) {
                setState('platformBudgetEvidenceArchivesState', apiUnavailableMessage(res, 'Evidence archive download failed.'), 'error');
                notify('Evidence archive download failed.', 'error');
                return;
            }
            const fallback = `platform-budget-evidence-${archive.id}.${archive.format === 'markdown' ? 'md' : 'json'}`;
            downloadTextFile(filenameFromContentDisposition(res.filename, fallback), res.text || '', res.contentType || 'application/json');
            setState('platformBudgetEvidenceArchivesState', 'Evidence archive downloaded. No repair was applied.');
        } finally {
            setSubmitting(button, false);
        }
    }

    async function expirePlatformBudgetEvidenceArchive(archive, button) {
        const reason = window.prompt('Enter an operator reason to expire this evidence archive. The archive object is not deleted until cleanup.', '');
        if (!reason || !reason.trim()) {
            setState('platformBudgetEvidenceArchivesState', 'Archive expiry cancelled: reason is required.', 'error');
            return;
        }
        const confirmed = window.confirm('Expire this archive metadata? This does not repair budget data, mutate credits, or call providers/Stripe.');
        if (!confirmed) {
            setState('platformBudgetEvidenceArchivesState', 'Archive expiry cancelled.', 'neutral');
            return;
        }
        setSubmitting(button, true);
        setState('platformBudgetEvidenceArchivesState', 'Expiring evidence archive...');
        try {
            const res = await apiAdminAiExpirePlatformBudgetEvidenceArchive(archive.id, {
                reason: reason.trim(),
            }, { idempotencyKey: createIdempotencyKey('platform-budget-evidence-archive-expire') });
            if (!res.ok) {
                setState('platformBudgetEvidenceArchivesState', apiUnavailableMessage(res, 'Evidence archive expiry failed.'), 'error');
                notify('Evidence archive expiry failed.', 'error');
                return;
            }
            notify('Evidence archive expired.', 'success');
            await loadPlatformBudgetEvidenceArchives();
        } finally {
            setSubmitting(button, false);
        }
    }

    async function cleanupExpiredPlatformBudgetEvidenceArchives(button) {
        const reason = window.prompt('Enter an operator reason for bounded expired archive cleanup.', '');
        if (!reason || !reason.trim()) {
            setState('platformBudgetEvidenceArchivesState', 'Archive cleanup cancelled: reason is required.', 'error');
            return;
        }
        const confirmed = window.confirm('Cleanup expired platform budget evidence archives? Cleanup is bounded and restricted to the platform-budget-evidence/ prefix.');
        if (!confirmed) {
            setState('platformBudgetEvidenceArchivesState', 'Archive cleanup cancelled.', 'neutral');
            return;
        }
        setSubmitting(button, true);
        setState('platformBudgetEvidenceArchivesState', 'Cleaning up expired evidence archives...');
        try {
            const res = await apiAdminAiCleanupExpiredPlatformBudgetEvidenceArchives({
                budgetScope: 'platform_admin_lab_budget',
                limit: 25,
                reason: reason.trim(),
            }, { idempotencyKey: createIdempotencyKey('platform-budget-evidence-archive-cleanup') });
            if (!res.ok) {
                setState('platformBudgetEvidenceArchivesState', apiUnavailableMessage(res, 'Evidence archive cleanup failed.'), 'error');
                notify('Evidence archive cleanup failed.', 'error');
                return;
            }
            notify(`Evidence archive cleanup complete (${res.data?.cleanup?.deletedCount ?? 0} deleted).`, 'success');
            await loadPlatformBudgetEvidenceArchives();
        } finally {
            setSubmitting(button, false);
        }
    }

    async function loadAiAttemptDetail(attemptId) {
        const detail = byId('aiAttemptDetail');
        detail.hidden = false;
        detail.textContent = 'Loading attempt detail...';
        const res = await apiAdminAiUsageAttempt(attemptId);
        clear(detail);
        if (!res.ok) {
            renderUnavailable(detail, res, 'AI usage attempt detail unavailable.');
            return;
        }
        const attempt = res.data?.attempt || {};
        detail.appendChild(el('h3', 'admin-section-title', 'AI Usage Attempt Detail'));
        detail.appendChild(detailRows([
            ['Attempt', shortId(attempt.attemptId)],
            ['Organization', shortId(attempt.organizationId)],
            ['User', shortId(attempt.userId)],
            ['Feature', attempt.feature || '-'],
            ['Route', attempt.route || '-'],
            ['Status', attempt.status || '-'],
            ['Provider', attempt.providerStatus || '-'],
            ['Billing', attempt.billingStatus || '-'],
            ['Replay', attempt.replay?.status || '-'],
            ['Result model', attempt.result?.model || '-'],
            ['Prompt length', attempt.result?.promptLength ?? '-'],
            ['Error', attempt.error?.code || '-'],
        ]));
    }

    async function handleAiCleanup(event) {
        event.preventDefault();
        const submitButton = event.submitter;
        const limit = Math.max(1, Math.min(Number(byId('aiCleanupLimit')?.value) || 10, 50));
        const dryRun = !byId('aiCleanupExecute')?.checked;
        if (!dryRun && !confirm('Execute expired AI usage cleanup? This releases stale reservations and may delete only eligible expired temporary replay objects.')) {
            return;
        }
        setState('aiCleanupResult', dryRun ? 'Running cleanup dry-run...' : 'Executing cleanup...');
        setSubmitting(submitButton, true);
        try {
            const res = await apiAdminAiCleanupUsageAttempts({
                limit,
                dryRun,
                idempotencyKey: createIdempotencyKey('ai-usage-cleanup'),
            });
            if (!res.ok) {
                setState('aiCleanupResult', apiUnavailableMessage(res, 'AI usage cleanup failed.'), 'error');
                notify('AI usage cleanup failed.', 'error');
                return;
            }
            const cleanup = res.data?.cleanup || {};
            const failed = Number(cleanup.failedCount ?? cleanup.replayObjectFailedCount ?? 0);
            setState(
                'aiCleanupResult',
                `Mode ${cleanup.dryRun === false ? 'execute' : 'dry-run'}; scanned ${cleanup.scannedCount ?? 0}; expired ${cleanup.expiredCount ?? 0}; reservations released ${cleanup.reservationsReleasedCount ?? 0}; replay metadata cleared ${cleanup.replayObjectMetadataClearedCount ?? cleanup.replayMetadataExpiredCount ?? 0}; replay objects eligible ${cleanup.replayObjectsEligibleCount ?? 0}; replay objects deleted ${cleanup.replayObjectsDeletedCount ?? 0}; skipped ${cleanup.skippedCount ?? 0}; failed ${failed}.`,
                failed > 0 ? 'error' : 'success',
            );
            notify(dryRun ? 'AI usage cleanup dry-run completed.' : 'AI usage cleanup executed.', 'success');
            loadAiAttempts();
        } finally {
            setSubmitting(submitButton, false);
        }
    }

    async function loadAiBudgetSwitchesPanel() {
        await Promise.all([
            loadAiBudgetSwitches(),
            loadPlatformBudgetCaps(),
            loadPlatformBudgetReconciliation(),
            loadPlatformBudgetRepairReport(),
            loadPlatformBudgetEvidenceArchives(),
        ]);
    }

    function bind() {
        byId('aiAttemptsRefresh')?.addEventListener('click', loadAiAttempts);
        byId('aiAttemptsFilter')?.addEventListener('submit', (event) => {
            event.preventDefault();
            loadAiAttempts();
        });
        byId('aiCleanupForm')?.addEventListener('submit', handleAiCleanup);
        byId('aiBudgetSwitchesRefresh')?.addEventListener('click', loadAiBudgetSwitches);
        byId('platformBudgetCapsRefresh')?.addEventListener('click', loadPlatformBudgetCaps);
        byId('platformBudgetReconciliationRefresh')?.addEventListener('click', loadPlatformBudgetReconciliation);
        byId('platformBudgetRepairReportRefresh')?.addEventListener('click', loadPlatformBudgetRepairReport);
        byId('platformBudgetRepairReportExportJson')?.addEventListener('click', (event) => {
            exportPlatformBudgetRepairReportJson(event.currentTarget);
        });
        byId('platformBudgetEvidenceArchivesRefresh')?.addEventListener('click', loadPlatformBudgetEvidenceArchives);
        byId('platformBudgetEvidenceArchiveCreate')?.addEventListener('click', (event) => {
            createPlatformBudgetEvidenceArchive(event.currentTarget);
        });
        byId('platformBudgetEvidenceArchiveCleanup')?.addEventListener('click', (event) => {
            cleanupExpiredPlatformBudgetEvidenceArchives(event.currentTarget);
        });
    }

    return {
        bind,
        loadAiAttempts,
        loadAiBudgetSwitchesPanel,
    };
}
