/* ============================================================
   BITBI — Admin Control Plane / Data Lifecycle Domain
   Frontend-only lifecycle request rendering and guarded workflow actions.
   ============================================================ */

import {
    apiAdminDataLifecycleApprove,
    apiAdminDataLifecycleArchives,
    apiAdminDataLifecycleClose,
    apiAdminDataLifecycleComplete,
    apiAdminDataLifecycleExecuteSafe,
    apiAdminDataLifecycleGenerateExport,
    apiAdminDataLifecycleGeneratePlan,
    apiAdminDataLifecycleReject,
    apiAdminDataLifecycleRequest,
    apiAdminDataLifecycleRequestEvidence,
    apiAdminDataLifecycleRequestExport,
    apiAdminDataLifecycleRequests,
} from '../../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    addCell,
    apiUnavailableMessage,
    badge,
    byId,
    clear,
    detailRows,
    downloadTextFile,
    el,
    readableToken,
    renderJsonSummary,
    renderUnavailable,
    setState,
    setSubmitting,
    shortId,
    table,
    variantFor,
} from './core.js?v=__ASSET_VERSION__';

export function createLifecycleDomain({ notify, formatDate }) {
    let lifecycleDetailOverlay = null;

    async function loadLifecycle() {
        await Promise.all([loadLifecycleRequests(), loadLifecycleArchives()]);
    }

    function lifecycleRequestId(request) {
        return request?.id || request?.requestId || request?.request_id || '';
    }

    function lifecycleItems(detail) {
        return Array.isArray(detail?.items) ? detail.items : [];
    }

    function lifecyclePlanSummary(detail) {
        const items = lifecycleItems(detail);
        const byAction = {};
        const byStatus = {};
        const retained = new Set();
        for (const item of items) {
            byAction[item.action || 'unknown'] = (byAction[item.action || 'unknown'] || 0) + 1;
            byStatus[item.status || 'unknown'] = (byStatus[item.status || 'unknown'] || 0) + 1;
            if (['retain', 'retain_or_anonymize', 'retain_or_rekey', 'export_reference'].includes(item.action)) {
                retained.add(item.tableName || item.resourceType || 'unknown');
            }
        }
        return {
            count: items.length,
            byAction,
            byStatus,
            retainedCategories: Array.from(retained).sort(),
            blockedCount: items.filter((item) => item.status === 'blocked').length,
            safeActionCount: items.filter((item) => (
                (item.tableName === 'sessions' && item.action === 'revoke') ||
                (['password_reset_tokens', 'email_verification_tokens', 'siwe_challenges'].includes(item.tableName) && item.action === 'expire_or_delete') ||
                (item.resourceType === 'data_export_archive' && item.action === 'expire')
            )).length,
        };
    }

    function lifecycleFinalStatus(request) {
        const finalStatuses = new Set(['completed', 'completed_with_retention', 'rejected', 'closed', 'blocked_requires_legal_review']);
        if (request?.finalStatus) return request.finalStatus;
        return finalStatuses.has(request?.status) ? request.status : '';
    }

    function lifecycleCategoryMatrix(request, detail) {
        const summaryMatrix = request?.completionSummary?.categoryMatrix;
        if (Array.isArray(summaryMatrix) && summaryMatrix.length) return summaryMatrix;
        const items = lifecycleItems(detail);
        const labels = {
            auth_session_token_profile: 'Auth/session/token/profile',
            operational_user_account: 'Operational account',
            ai_asset_metadata_folders: 'AI assets/folders',
            avatar_reference_media: 'Avatar/reference media',
            billing_credit_ledger: 'Billing/credit ledger',
            provider_webhook_evidence: 'Provider/webhook evidence',
            admin_audit_user_activity_security: 'Audit/activity/security',
            legal_compliance_retention: 'Legal/compliance retention',
            lifecycle_evidence_records: 'Lifecycle/evidence records',
        };
        const policyRetained = new Set([
            'billing_credit_ledger',
            'provider_webhook_evidence',
            'admin_audit_user_activity_security',
            'legal_compliance_retention',
            'lifecycle_evidence_records',
        ]);
        const categoryFor = (item) => {
            const tableName = item.tableName || '';
            const resourceType = item.resourceType || '';
            if (['sessions', 'password_reset_tokens', 'email_verification_tokens', 'siwe_challenges', 'admin_mfa_credentials', 'profiles', 'linked_wallets', 'favorites', 'ai_daily_quota_usage'].includes(tableName)) return 'auth_session_token_profile';
            if (tableName === 'users' || resourceType === 'user') return 'operational_user_account';
            if (['ai_folders', 'ai_images', 'ai_text_assets', 'ai_video_jobs'].includes(tableName)) return 'ai_asset_metadata_folders';
            if (resourceType === 'r2_object') return 'avatar_reference_media';
            if (['member_credit_ledger', 'member_subscriptions', 'member_subscription_credit_buckets', 'stripe_credit_pack_checkout_sessions'].includes(tableName)) return 'billing_credit_ledger';
            if (['billing_provider_events', 'billing_reviews'].includes(tableName)) return 'provider_webhook_evidence';
            if (['admin_audit_log', 'user_activity_log', 'activity_events'].includes(tableName) || resourceType === 'admin_audit_log') return 'admin_audit_user_activity_security';
            if (['data_lifecycle_requests', 'data_lifecycle_request_items', 'data_export_archives'].includes(tableName) || resourceType === 'data_export_archive') return 'lifecycle_evidence_records';
            return 'legal_compliance_retention';
        };
        const rank = { blocked: 6, retained: 5, pending: 4, anonymized: 3, deleted: 2, not_applicable: 0 };
        const resultFor = (item) => {
            const action = String(item.action || '').toLowerCase();
            const status = String(item.status || '').toLowerCase();
            if (status === 'blocked' || action === 'manual_review_required') return 'blocked';
            if (['retain', 'retain_or_anonymize', 'retain_or_rekey', 'export_reference', 'export'].includes(action)) return 'retained';
            if (status === 'completed') return ['anonymize', 'retain_or_anonymize', 'retain_or_rekey'].includes(action) ? 'anonymized' : 'deleted';
            if (['delete', 'delete_planned', 'revoke', 'expire_or_delete', 'expire'].includes(action)) return 'pending';
            return 'not_applicable';
        };
        const matrix = Object.entries(labels).map(([id, label]) => ({
            id,
            label,
            result: policyRetained.has(id) ? 'retained' : 'not_applicable',
            itemCount: 0,
            retainedByPolicy: policyRetained.has(id),
        }));
        const byId = new Map(matrix.map((entry) => [entry.id, entry]));
        for (const item of items) {
            const entry = byId.get(categoryFor(item));
            const next = resultFor(item);
            entry.itemCount += 1;
            entry.result = (rank[next] || 0) > (rank[entry.result] || 0) ? next : entry.result;
        }
        return matrix;
    }

    function lifecycleActionState(request, detail) {
        const status = request?.status || '';
        const summary = lifecyclePlanSummary(detail);
        const hasPlan = summary.count > 0;
        const planned = status === 'planned';
        const approved = status === 'approved';
        const safeCompleted = status === 'safe_actions_completed';
        const exportRequest = request?.type === 'export';
        const finalStatus = lifecycleFinalStatus(request);
        const isFinal = Boolean(finalStatus);
        const canComplete = !isFinal && hasPlan && summary.blockedCount === 0 && (safeCompleted || (exportRequest && status === 'export_ready'));
        return {
            isFinal,
            finalStatus,
            canPlan: !isFinal && ['submitted', 'planned', 'blocked'].includes(status),
            canApprove: !isFinal && planned && hasPlan && summary.blockedCount === 0,
            approveDisabledReason: planned
                ? (hasPlan ? (summary.blockedCount ? 'Blocked plan items require manual review before approval.' : '') : 'Generate a plan before approval.')
                : 'Request must be planned before approval.',
            canExecuteDryRun: !isFinal && (approved || safeCompleted),
            canExecuteSafe: !isFinal && approved,
            executeDisabledReason: approved || safeCompleted ? '' : 'Request must be approved before safe execution.',
            canGeneratePrivateArchive: !isFinal && exportRequest && approved,
            archiveDisabledReason: exportRequest ? 'Export request must be approved before archive generation.' : 'Private archives are only available for export requests.',
            canMarkCompleted: canComplete,
            markCompletedReason: canComplete ? '' : (isFinal ? 'Request already has a final lifecycle status.' : 'Completion requires plan evidence, approval, safe execution or export archive evidence, and no blocked plan items.'),
            canRejectClose: !isFinal,
            rejectCloseReason: isFinal ? 'Request already has a final lifecycle status.' : '',
        };
    }

    function formatLifecycleError(res, fallback) {
        const parts = [apiUnavailableMessage(res, fallback)];
        if (res?.code) parts.push(`Code: ${res.code}`);
        if (res?.status) parts.push(`Status: ${res.status}`);
        return parts.join(' ');
    }

    function lifecyclePanel(title, copy) {
        const panel = el('section', 'admin-lifecycle-detail__panel');
        panel.appendChild(el('h4', 'admin-lifecycle-detail__panel-title', title));
        if (copy) panel.appendChild(el('p', 'admin-shell__desc', copy));
        return panel;
    }

    function lifecycleFieldGrid(entries = []) {
        const grid = el('div', 'admin-lifecycle-field-grid');
        for (const entry of entries) {
            const [label, value, options = {}] = entry;
            const row = el('div', options.block ? 'admin-lifecycle-field admin-lifecycle-field--block' : 'admin-lifecycle-field');
            row.appendChild(el('span', 'admin-lifecycle-field__label', label));
            const valueNode = el('div', 'admin-lifecycle-field__value');
            if (value instanceof Node) {
                valueNode.appendChild(value);
            } else {
                valueNode.textContent = value == null || value === '' ? '-' : String(value);
            }
            row.appendChild(valueNode);
            grid.appendChild(row);
        }
        return grid;
    }

    function lifecycleTextBlock(label, value) {
        const block = el('div', 'admin-lifecycle-text-block');
        block.appendChild(el('span', 'admin-lifecycle-text-block__label', label));
        block.appendChild(el('p', 'admin-lifecycle-text-block__value', value || 'Not recorded.'));
        return block;
    }

    function renderLifecycleCategoryMatrix(panel, request, detail) {
        const matrix = lifecycleCategoryMatrix(request, detail);
        const grid = el('div', 'admin-lifecycle-category-grid');
        for (const entry of matrix) {
            const card = el('div', 'admin-lifecycle-category');
            card.appendChild(badge(readableToken(entry.result || 'not_applicable'), variantFor(entry.result)));
            card.appendChild(el('strong', null, entry.label || readableToken(entry.id)));
            card.appendChild(el('span', null, `${entry.itemCount ?? 0} item${Number(entry.itemCount || 0) === 1 ? '' : 's'}`));
            if (entry.retainedByPolicy) card.appendChild(el('span', 'admin-shell__desc', 'Policy-retained'));
            grid.appendChild(card);
        }
        panel.appendChild(grid);
    }

    function addActionButton(rowNode, label, { disabled, reason, onClick, secondary = false } = {}) {
        const button = el('button', secondary ? 'btn-action btn-action--secondary' : 'btn-action', label);
        button.type = 'button';
        button.disabled = Boolean(disabled);
        if (reason) button.title = reason;
        if (typeof onClick === 'function') button.addEventListener('click', onClick);
        rowNode.appendChild(button);
        if (disabled && reason) rowNode.appendChild(el('span', 'admin-shell__desc', reason));
        return button;
    }

    function renderLifecyclePlan(panel, detail) {
        const items = lifecycleItems(detail);
        const summary = lifecyclePlanSummary(detail);
        panel.appendChild(lifecycleFieldGrid([
            ['Plan items', summary.count],
            ['Blocked items', summary.blockedCount],
            ['Safe executable actions', summary.safeActionCount],
            ['Actions', renderJsonSummary(summary.byAction)],
            ['Statuses', renderJsonSummary(summary.byStatus)],
            ['Retained policy categories', summary.retainedCategories.join(', ') || 'Not reported'],
        ]));
        if (!items.length) {
            panel.appendChild(el('p', 'admin-shell__desc', 'No plan items exist yet. Generate a plan before approval or safe execution.'));
            return;
        }
        const { wrap, tbody } = table(['Resource', 'Table', 'Action', 'Status', 'Storage']);
        for (const item of items.slice(0, 12)) {
            const tr = document.createElement('tr');
            addCell(tr, item.resourceType || '-');
            addCell(tr, item.tableName || '-');
            addCell(tr, item.action || '-');
            addCell(tr, badge(item.status || '-', variantFor(item.status)));
            addCell(tr, item.storageReference?.keyClass ? `${item.r2Bucket || item.storageReference.bucket || 'storage'} / ${item.storageReference.keyClass}` : '-');
            tbody.appendChild(tr);
        }
        panel.appendChild(wrap);
        if (items.length > 12) panel.appendChild(el('p', 'admin-shell__desc', `Showing 12 of ${items.length} redacted plan items.`));
    }

    function closeLifecycleDetailOverlay() {
        if (!lifecycleDetailOverlay) return;
        document.removeEventListener('keydown', lifecycleDetailOverlay.onKeydown, true);
        lifecycleDetailOverlay.modal.remove();
        const opener = lifecycleDetailOverlay.opener;
        lifecycleDetailOverlay = null;
        if (opener && typeof opener.focus === 'function') opener.focus();
    }

    function trapLifecycleOverlayFocus(event) {
        if (event.key !== 'Tab' || !lifecycleDetailOverlay?.modal) return;
        const focusable = Array.from(lifecycleDetailOverlay.modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
            .filter((node) => !node.disabled && node.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    async function refreshLifecycleDetail(requestId, bodyNode) {
        clear(bodyNode);
        bodyNode.appendChild(el('p', 'admin-state', 'Loading lifecycle request detail...'));
        const res = await apiAdminDataLifecycleRequest(requestId);
        clear(bodyNode);
        if (!res.ok) {
            const box = el('div', 'admin-alert admin-alert--danger');
            box.appendChild(el('strong', null, 'Lifecycle request detail failed.'));
            box.appendChild(el('p', null, formatLifecycleError(res, 'Request detail unavailable.')));
            bodyNode.appendChild(box);
            return null;
        }
        renderLifecycleDetailBody(requestId, res.data, bodyNode);
        return res.data;
    }

    async function runLifecycleAction({ requestId, button, bodyNode, stateNode, action, call, successMessage }) {
        setSubmitting(button, true);
        stateNode.textContent = `${action}...`;
        stateNode.dataset.state = 'neutral';
        try {
            const res = await call();
            if (!res.ok) {
                stateNode.textContent = formatLifecycleError(res, `${action} failed.`);
                stateNode.dataset.state = 'error';
                notify(`${action} failed.`, 'error');
                return;
            }
            stateNode.textContent = successMessage;
            stateNode.dataset.state = 'success';
            notify(successMessage, 'success');
            await refreshLifecycleDetail(requestId, bodyNode);
            await loadLifecycleRequests();
        } finally {
            setSubmitting(button, false);
        }
    }

    async function exportLifecycleEvidence(requestId, format, button, stateNode) {
        setSubmitting(button, true);
        stateNode.textContent = `Preparing ${format} evidence packet...`;
        stateNode.dataset.state = 'neutral';
        try {
            const res = await apiAdminDataLifecycleRequestEvidence(requestId, { format });
            if (!res.ok) {
                stateNode.textContent = formatLifecycleError(res, 'Evidence export failed.');
                stateNode.dataset.state = 'error';
                notify('Evidence export failed.', 'error');
                return;
            }
            const extension = format === 'markdown' ? 'md' : format;
            const contentType = res.contentType || (format === 'html' ? 'text/html' : format === 'markdown' ? 'text/markdown' : 'application/json');
            if (format === 'html' && typeof window.open === 'function' && typeof Blob !== 'undefined' && window.URL?.createObjectURL) {
                const blob = new Blob([res.text || ''], { type: contentType });
                const url = window.URL.createObjectURL(blob);
                const popup = window.open(url, '_blank', 'noopener');
                window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
                if (popup) {
                    stateNode.textContent = 'PDF-friendly evidence HTML opened. Use browser print or Save as PDF.';
                    stateNode.dataset.state = 'success';
                    return;
                }
            }
            downloadTextFile(`data-lifecycle-${requestId}-evidence.${extension}`, res.text || '', contentType);
            stateNode.textContent = 'Evidence packet downloaded. No lifecycle execution occurred.';
            stateNode.dataset.state = 'success';
        } finally {
            setSubmitting(button, false);
        }
    }

    function renderLifecycleDetailBody(requestId, detail, bodyNode) {
        const request = detail?.request || {};
        const actions = lifecycleActionState(request, detail);
        const stateNode = el('p', 'admin-state', 'Ready. Actions remain guarded by backend confirmation, idempotency, approval, and safe execution policy.');
        const finalStatus = actions.finalStatus || 'not_completed';
        const userItem = lifecycleItems(detail).find((item) => item.resourceType === 'user');

        const header = el('section', 'admin-lifecycle-detail__hero');
        const headerText = el('div', 'admin-lifecycle-detail__hero-main');
        headerText.appendChild(el('h4', 'admin-lifecycle-detail__eyebrow', 'Lifecycle control packet'));
        const badges = el('div', 'admin-control-chip-row');
        badges.append(
            badge(request.type || 'request', 'user'),
            badge(request.status || 'unknown', variantFor(request.status)),
            badge(request.dryRun ? 'dry-run' : 'execution-capable', request.dryRun ? 'legacy' : 'user'),
            badge(`final: ${readableToken(finalStatus)}`, actions.isFinal ? 'active' : 'disabled'),
            badge('evidence required', 'legacy'),
            actions.isFinal ? badge('legal outcome recorded', 'active') : badge('no legal completion claim', 'disabled'),
        );
        headerText.append(
            badges,
            lifecycleFieldGrid([
                ['Request ID', request.id || requestId],
                ['Subject user', shortId(request.subjectUserId)],
                ['Created', formatDate(request.createdAt)],
                ['Updated', formatDate(request.updatedAt)],
                ['Expires', formatDate(request.expiresAt)],
                ['Approval required', request.approvalRequired ? 'Yes' : 'No'],
            ]),
        );
        header.appendChild(headerText);
        bodyNode.append(header, stateNode);

        const grid = el('div', 'admin-lifecycle-layout');

        const subjectPanel = lifecyclePanel('Subject Snapshot', 'Only safe request metadata and redacted plan summaries are shown.');
        subjectPanel.appendChild(lifecycleFieldGrid([
            ['User ID', request.subjectUserId || '-'],
            ['Email snapshot', userItem?.summary?.email || 'Not available until plan captures a safe user item.'],
            ['Role/status snapshot', [userItem?.summary?.role, userItem?.summary?.status].filter(Boolean).join(' / ') || 'Not available'],
            ['Request source', request.reason?.includes('admin_delete_user_modal') ? 'Admin delete user modal' : 'Lifecycle request'],
            ['Admin actor', request.requestedByAdminId ? shortId(request.requestedByAdminId) : 'Not reported'],
        ]));
        subjectPanel.appendChild(lifecycleTextBlock('Reason', request.reason || 'Not recorded'));
        subjectPanel.appendChild(lifecycleTextBlock('Privacy caveat', 'Billing, audit, provider, security, and legal records may be retained or anonymized according to policy. Final legal completion is only claimed when the final status and evidence support it.'));
        grid.appendChild(subjectPanel);

        const statePanel = lifecyclePanel('Current Lifecycle State', 'This panel reflects request state; it does not claim legal completion.');
        statePanel.appendChild(lifecycleFieldGrid([
            ['Submitted/planned/approved state', request.status || '-'],
            ['Final status', readableToken(finalStatus)],
            ['Approved', request.approvedAt ? `Yes (${formatDate(request.approvedAt)})` : 'No'],
            ['Approved by', request.approvedByAdminId ? shortId(request.approvedByAdminId) : 'Not reported'],
            ['Execution state', request.status === 'safe_actions_completed' ? 'Safe actions completed' : 'Not completed'],
            ['Evidence state', request.evidenceStatus || (request.status === 'safe_actions_completed' ? 'Safe action evidence available; completion still requires review.' : 'Evidence pending / partial.')],
            ['Completed', formatDate(request.completedAt)],
            ['Completed by', request.completedByUserId ? shortId(request.completedByUserId) : 'Not reported'],
        ]));
        statePanel.appendChild(lifecycleTextBlock('Retention caveat', 'Do not delete billing ledger, Stripe/provider evidence, audit logs, security records, or legal/compliance records from this overlay. These categories are retained or anonymized only through approved policy workflow.'));
        grid.appendChild(statePanel);

        const planPanel = lifecyclePanel('Plan', 'Generate or inspect the redacted lifecycle plan. Raw private keys and secrets are not rendered.');
        renderLifecyclePlan(planPanel, detail);
        const planActions = el('div', 'admin-control-chip-row');
        addActionButton(planActions, 'Generate Plan', {
            disabled: !actions.canPlan,
            reason: actions.canPlan ? '' : 'Plan generation is no longer available for this state.',
            onClick: (event) => runLifecycleAction({
                requestId,
                button: event.currentTarget,
                bodyNode,
                stateNode,
                action: 'Generate Plan',
                call: () => apiAdminDataLifecycleGeneratePlan(requestId),
                successMessage: 'Plan generated or refreshed.',
            }),
        });
        planPanel.appendChild(planActions);
        planPanel.classList.add('admin-lifecycle-detail__panel--wide');

        const approvePanel = lifecyclePanel('Approval', 'Approval moves a planned request into approved state. It is not legal completion and does not execute erasure.');
        const approveCheckId = `lifecycle-approve-${requestId}`;
        const approveLabel = el('label', 'admin-form__check');
        const approveCheck = document.createElement('input');
        approveCheck.type = 'checkbox';
        approveCheck.id = approveCheckId;
        approveLabel.append(approveCheck, document.createTextNode(' I understand approval does not complete legal/GDPR erasure.'));
        const approveReason = document.createElement('textarea');
        approveReason.className = 'admin-input';
        approveReason.rows = 2;
        approveReason.placeholder = 'Approval note / review reason';
        const approveActions = el('div', 'admin-control-chip-row');
        const approveButton = addActionButton(approveActions, 'Approve', {
            disabled: !actions.canApprove,
            reason: actions.canApprove ? '' : actions.approveDisabledReason,
            onClick: (event) => {
                if (!approveCheck.checked) {
                    stateNode.textContent = 'Approval acknowledgement is required.';
                    stateNode.dataset.state = 'error';
                    return;
                }
                runLifecycleAction({
                    requestId,
                    button: event.currentTarget,
                    bodyNode,
                    stateNode,
                    action: 'Approve',
                    call: () => apiAdminDataLifecycleApprove(requestId, { reason: approveReason.value.trim() }),
                    successMessage: 'Lifecycle request approved.',
                });
            },
        });
        approvePanel.append(approveLabel, approveReason, approveActions);
        if (!actions.canApprove) approveButton.disabled = true;
        grid.appendChild(approvePanel);

        const executePanel = lifecyclePanel('Execute Safe', 'Safe execution is backend-gated. Destructive modes are blocked; dry-run is available after approval.');
        executePanel.appendChild(lifecycleFieldGrid([
            ['Dry-run default', 'Yes'],
            ['Non-dry-run requirements', 'Approved plan, Idempotency-Key, confirm=true, and backend safe-action policy.'],
            ['Retained records', 'Billing, audit, legal, and provider evidence are retained/anonymized under policy.'],
        ]));
        const executeCheck = document.createElement('input');
        executeCheck.type = 'checkbox';
        const executeLabel = el('label', 'admin-form__check');
        executeLabel.append(executeCheck, document.createTextNode(' I understand safe execution is limited and does not perform full legal erasure.'));
        const executeActions = el('div', 'admin-control-chip-row');
        addActionButton(executeActions, 'Execute Safe Dry-run', {
            disabled: !actions.canExecuteDryRun,
            reason: actions.executeDisabledReason,
            secondary: true,
            onClick: (event) => runLifecycleAction({
                requestId,
                button: event.currentTarget,
                bodyNode,
                stateNode,
                action: 'Execute Safe Dry-run',
                call: () => apiAdminDataLifecycleExecuteSafe(requestId, { dryRun: true }),
                successMessage: 'Safe execution dry-run completed.',
            }),
        });
        addActionButton(executeActions, 'Execute Safe', {
            disabled: !actions.canExecuteSafe,
            reason: actions.executeDisabledReason,
            onClick: (event) => {
                if (!executeCheck.checked) {
                    stateNode.textContent = 'Safe execution acknowledgement is required.';
                    stateNode.dataset.state = 'error';
                    return;
                }
                runLifecycleAction({
                    requestId,
                    button: event.currentTarget,
                    bodyNode,
                    stateNode,
                    action: 'Execute Safe',
                    call: () => apiAdminDataLifecycleExecuteSafe(requestId, { dryRun: false }),
                    successMessage: 'Safe lifecycle actions executed.',
                });
            },
        });
        executePanel.append(executeLabel, executeActions);
        grid.appendChild(executePanel);

        const completionPanel = lifecyclePanel('Completion / Legal Outcome', 'Final completion records evidence truth. It does not execute deletion and does not overclaim full legal/GDPR completion when policy-retained categories remain.');
        completionPanel.appendChild(lifecycleFieldGrid([
            ['Current final status', readableToken(finalStatus)],
            ['Evidence completeness', request.evidenceStatus || 'Pending / partial'],
            ['Retained categories', (request.retainedCategories || request.completionSummary?.retainedCategories || []).join(', ') || 'Computed from category matrix / policy.'],
            ['Completion action', actions.canMarkCompleted ? 'Eligible after evidence review.' : actions.markCompletedReason],
            ['Audit trail', 'Use Admin Activity plus evidence export; raw logs are not rendered here.'],
        ]));
        const completionNote = document.createElement('textarea');
        completionNote.className = 'admin-input';
        completionNote.rows = 3;
        completionNote.placeholder = 'Completion note / evidence review summary';
        const completeCheck = document.createElement('input');
        completeCheck.type = 'checkbox';
        const completeLabel = el('label', 'admin-form__check');
        completeLabel.append(completeCheck, document.createTextNode(' I confirm this is a final evidence marker, not an unchecked purge or legal advice.'));
        const completionActions = el('div', 'admin-control-chip-row');
        addActionButton(completionActions, 'Mark Completed', {
            disabled: !actions.canMarkCompleted,
            reason: actions.markCompletedReason,
            onClick: (event) => {
                if (!completeCheck.checked) {
                    stateNode.textContent = 'Completion acknowledgement is required.';
                    stateNode.dataset.state = 'error';
                    return;
                }
                if (!completionNote.value.trim()) {
                    stateNode.textContent = 'Completion note is required.';
                    stateNode.dataset.state = 'error';
                    return;
                }
                runLifecycleAction({
                    requestId,
                    button: event.currentTarget,
                    bodyNode,
                    stateNode,
                    action: 'Mark Completed',
                    call: () => apiAdminDataLifecycleComplete(requestId, { completionNote: completionNote.value.trim() }),
                    successMessage: 'Lifecycle completion evidence recorded.',
                });
            },
        });
        completionPanel.append(completeLabel, completionNote, completionActions);
        completionPanel.classList.add('admin-lifecycle-detail__panel--wide');

        const closePanel = lifecyclePanel('Reject / Close', 'Reject or close updates lifecycle state only. It does not delete data.');
        closePanel.appendChild(lifecycleFieldGrid([
            ['Reject / Close', actions.canRejectClose ? 'Available while the request is not final.' : actions.rejectCloseReason],
            ['Data mutation', 'No data deletion is performed by this disabled action.'],
        ]));
        const closeReason = document.createElement('textarea');
        closeReason.className = 'admin-input';
        closeReason.rows = 3;
        closeReason.placeholder = 'Reject/close reason';
        const closeStatus = document.createElement('select');
        closeStatus.className = 'admin-input';
        for (const [value, label] of [
            ['closed', 'Close without execution'],
            ['blocked_requires_legal_review', 'Close as blocked - legal review required'],
        ]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            closeStatus.appendChild(option);
        }
        const rejectCheck = document.createElement('input');
        rejectCheck.type = 'checkbox';
        const rejectLabel = el('label', 'admin-form__check');
        rejectLabel.append(rejectCheck, document.createTextNode(' I understand reject/close does not execute erasure or delete data.'));
        const closeActions = el('div', 'admin-control-chip-row');
        addActionButton(closeActions, 'Reject', {
            disabled: !actions.canRejectClose,
            reason: actions.rejectCloseReason,
            secondary: true,
            onClick: (event) => {
                if (!rejectCheck.checked || !closeReason.value.trim()) {
                    stateNode.textContent = 'Reject acknowledgement and reason are required.';
                    stateNode.dataset.state = 'error';
                    return;
                }
                runLifecycleAction({
                    requestId,
                    button: event.currentTarget,
                    bodyNode,
                    stateNode,
                    action: 'Reject',
                    call: () => apiAdminDataLifecycleReject(requestId, { reason: closeReason.value.trim() }),
                    successMessage: 'Lifecycle request rejected without data execution.',
                });
            },
        });
        addActionButton(closeActions, 'Close', {
            disabled: !actions.canRejectClose,
            reason: actions.rejectCloseReason,
            secondary: true,
            onClick: (event) => {
                if (!rejectCheck.checked || !closeReason.value.trim()) {
                    stateNode.textContent = 'Close acknowledgement and reason are required.';
                    stateNode.dataset.state = 'error';
                    return;
                }
                runLifecycleAction({
                    requestId,
                    button: event.currentTarget,
                    bodyNode,
                    stateNode,
                    action: 'Close',
                    call: () => apiAdminDataLifecycleClose(requestId, {
                        reason: closeReason.value.trim(),
                        finalStatus: closeStatus.value,
                    }),
                    successMessage: 'Lifecycle request closed without data execution.',
                });
            },
        });
        closePanel.append(rejectLabel, closeReason, closeStatus, closeActions);
        grid.appendChild(closePanel);

        const exportPanel = lifecyclePanel('Export Evidence', 'Exports are sanitized JSON, Markdown, or printable HTML. Use browser Save as PDF for PDF-friendly storage.');
        const exportActions = el('div', 'admin-control-chip-row');
        addActionButton(exportActions, 'Export Evidence JSON', {
            secondary: true,
            onClick: (event) => exportLifecycleEvidence(requestId, 'json', event.currentTarget, stateNode),
        });
        addActionButton(exportActions, 'Export Evidence Markdown', {
            secondary: true,
            onClick: (event) => exportLifecycleEvidence(requestId, 'markdown', event.currentTarget, stateNode),
        });
        addActionButton(exportActions, 'Open PDF-friendly HTML', {
            secondary: true,
            onClick: (event) => exportLifecycleEvidence(requestId, 'html', event.currentTarget, stateNode),
        });
        if (request.type === 'export') {
            addActionButton(exportActions, 'Generate Private Archive', {
                disabled: !actions.canGeneratePrivateArchive,
                reason: actions.archiveDisabledReason,
                onClick: (event) => runLifecycleAction({
                    requestId,
                    button: event.currentTarget,
                    bodyNode,
                    stateNode,
                    action: 'Generate Private Archive',
                    call: () => apiAdminDataLifecycleGenerateExport(requestId),
                    successMessage: 'Private export archive generated.',
                }),
            });
            addActionButton(exportActions, 'Open Archive Metadata', {
                secondary: true,
                onClick: async (event) => {
                    await runLifecycleAction({
                        requestId,
                        button: event.currentTarget,
                        bodyNode,
                        stateNode,
                        action: 'Open Archive Metadata',
                        call: () => apiAdminDataLifecycleRequestExport(requestId),
                        successMessage: 'Archive metadata checked.',
                    });
                },
            });
        }
        exportPanel.appendChild(exportActions);
        exportPanel.appendChild(el('p', 'admin-shell__desc', 'Evidence packets include request state, plan summary, approval/execution state, retained categories, pending actions, generated timestamp, and redaction guarantees. They are not legal advice.'));
        exportPanel.classList.add('admin-lifecycle-detail__panel--wide');

        const categoryPanel = lifecyclePanel('Category Matrix', 'Category-level outcomes keep legal truth visible without exposing table internals, raw keys, secrets, or payloads.');
        renderLifecycleCategoryMatrix(categoryPanel, request, detail);
        categoryPanel.classList.add('admin-lifecycle-detail__panel--wide');

        const timelinePanel = lifecyclePanel('Timeline / Audit', 'Detailed immutable audit is available in Admin Activity; this overlay shows current lifecycle timestamps only.');
        timelinePanel.appendChild(lifecycleFieldGrid([
            ['Created', formatDate(request.createdAt)],
            ['Updated', formatDate(request.updatedAt)],
            ['Approved', formatDate(request.approvedAt)],
            ['Completed', formatDate(request.completedAt)],
            ['Closed', formatDate(request.closedAt)],
            ['Expires', formatDate(request.expiresAt)],
        ]));
        timelinePanel.appendChild(lifecycleTextBlock('Audit caveat', 'Raw request hashes, idempotency keys, cookies, auth headers, tokens, Stripe/provider payloads, and private R2 keys are never rendered.'));
        timelinePanel.classList.add('admin-lifecycle-detail__panel--wide');

        bodyNode.appendChild(grid);
        bodyNode.append(planPanel, completionPanel, categoryPanel, exportPanel, timelinePanel);
    }

    function openLifecycleDetailOverlay(requestId, opener) {
        closeLifecycleDetailOverlay();
        const modal = el('div', 'admin-lifecycle-modal');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'adminLifecycleDetailTitle');
        const backdrop = el('div', 'admin-lifecycle-modal__backdrop');
        const dialog = el('div', 'admin-lifecycle-detail glass glass-card');
        const header = el('div', 'admin-lifecycle-detail__header');
        const title = el('h3', 'admin-section-title', 'Data Lifecycle Request Detail');
        title.id = 'adminLifecycleDetailTitle';
        const closeButton = el('button', 'btn-action btn-action--secondary', 'Close');
        closeButton.type = 'button';
        closeButton.addEventListener('click', closeLifecycleDetailOverlay);
        header.append(title, closeButton);
        const body = el('div', 'admin-lifecycle-detail__body');
        dialog.append(header, body);
        modal.append(backdrop, dialog);
        backdrop.addEventListener('click', closeLifecycleDetailOverlay);
        const onKeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeLifecycleDetailOverlay();
                return;
            }
            trapLifecycleOverlayFocus(event);
        };
        lifecycleDetailOverlay = { modal, opener, onKeydown };
        document.body.appendChild(modal);
        document.addEventListener('keydown', onKeydown, true);
        closeButton.focus();
        refreshLifecycleDetail(requestId, body);
    }

    async function loadLifecycleRequests() {
        const holder = byId('lifecycleRequests');
        setState('lifecycleRequestsState', 'Loading requests...');
        clear(holder);
        const res = await apiAdminDataLifecycleRequests({ limit: 20 });
        if (!res.ok) {
            setState('lifecycleRequestsState', '');
            renderUnavailable(holder, res, 'Lifecycle requests unavailable.');
            return;
        }
        const requests = Array.isArray(res.data?.requests) ? res.data.requests : [];
        if (requests.length === 0) {
            setState('lifecycleRequestsState', 'No lifecycle requests found.');
            return;
        }
        setState('lifecycleRequestsState', `Showing ${requests.length} requests.`);
        const { wrap, tbody } = table(['Type', 'Status', 'Subject', 'Dry-run', 'Created', 'Expires', 'Review']);
        for (const request of requests) {
            const tr = document.createElement('tr');
            addCell(tr, request.type || '-');
            addCell(tr, badge(request.status || '-', variantFor(request.status)));
            addCell(tr, shortId(request.subjectUserId || request.subject_user_id));
            addCell(tr, request.dryRun ?? request.dry_run ? 'Yes' : 'No');
            addCell(tr, formatDate(request.createdAt || request.created_at));
            addCell(tr, formatDate(request.expiresAt || request.expires_at));
            const requestId = lifecycleRequestId(request);
            const actions = el('div', 'admin-control-chip-row');
            const openButton = el('button', 'btn-action btn-action--secondary', 'Open');
            openButton.type = 'button';
            openButton.addEventListener('click', (event) => openLifecycleDetailOverlay(requestId, event.currentTarget));
            actions.appendChild(openButton);
            addCell(tr, actions);
            tbody.appendChild(tr);
        }
        holder.appendChild(wrap);
    }

    async function loadLifecycleArchives() {
        const holder = byId('lifecycleArchives');
        setState('lifecycleArchivesState', 'Loading archives...');
        clear(holder);
        const res = await apiAdminDataLifecycleArchives({ limit: 20 });
        if (!res.ok) {
            setState('lifecycleArchivesState', '');
            renderUnavailable(holder, res, 'Export archive metadata unavailable.');
            return;
        }
        const archives = Array.isArray(res.data?.archives) ? res.data.archives : [];
        if (archives.length === 0) {
            setState('lifecycleArchivesState', 'No export archives found.');
            return;
        }
        setState('lifecycleArchivesState', `Showing ${archives.length} archive metadata rows.`);
        const { wrap, tbody } = table(['Archive', 'Status', 'Subject', 'Size', 'Created', 'Expires']);
        for (const archive of archives) {
            const tr = document.createElement('tr');
            addCell(tr, shortId(archive.id));
            addCell(tr, badge(archive.status || '-', variantFor(archive.status)));
            addCell(tr, shortId(archive.subjectUserId || archive.subject_user_id));
            addCell(tr, archive.sizeBytes ?? archive.size_bytes ?? '-');
            addCell(tr, formatDate(archive.createdAt || archive.created_at));
            addCell(tr, formatDate(archive.expiresAt || archive.expires_at));
            tbody.appendChild(tr);
        }
        holder.appendChild(wrap);
    }

    function bind() {
        byId('lifecycleRequestsRefresh')?.addEventListener('click', loadLifecycleRequests);
        byId('lifecycleArchivesRefresh')?.addEventListener('click', loadLifecycleArchives);
    }

    return {
        bind,
        loadLifecycle,
        loadLifecycleRequests,
        loadLifecycleArchives,
    };
}
