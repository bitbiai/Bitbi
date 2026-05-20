/* ============================================================
   BITBI — Admin Control Plane / Tenant Asset Evidence
   Read-only tenant asset domain evidence and storage safety panels.
   ============================================================ */

import {
    apiAdminTenantAssetDomainEvidence,
} from '../../../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    badge,
    copyTextToClipboard,
    detailRows,
    el,
    operatorGuidancePanel,
    readableToken,
    readinessCards,
    readinessSection,
    renderUnavailable,
} from '../core.js?v=__ASSET_VERSION__';
import {
    statusLabel,
    statusVariant,
} from '../readiness.js?v=__ASSET_VERSION__';

export function createTenantAssetEvidenceDomain({ notify }) {
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

    async function loadDomainReport() {
        const res = await apiAdminTenantAssetDomainEvidence();
        return { res, report: normalizeTenantDomainReport(res.ok ? res.data : null) };
    }

    function renderTenantAssetOverview(container, report, onRefresh) {
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
        refresh.addEventListener('click', () => { void onRefresh?.(); });
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
    }

    function renderEndpointUnavailable(container, res) {
        renderUnavailable(container, res, 'Tenant asset domain evidence endpoint unavailable; static fallback shown.');
    }

    return {
        loadDomainReport,
        renderTenantAssetOverview,
        renderTenantBlockedActions,
        renderEndpointUnavailable,
    };
}
