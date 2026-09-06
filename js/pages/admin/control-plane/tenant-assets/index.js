/* ============================================================
   BITBI — Admin Control Plane / Tenant Assets Composer
   Root composition for tenant asset evidence, manual review, and guarded execution subdomains.
   ============================================================ */

import {
    badge,
    byId,
    clear,
    el,
    readableToken,
    readinessCards,
    readinessSection,
} from '../core.js?v=__ASSET_VERSION__';
import {
    createTenantExecutionDomain,
} from './backfill-access-switch.js?v=__ASSET_VERSION__';
import {
    createTenantAssetEvidenceDomain,
} from './evidence.js?v=__ASSET_VERSION__';
import {
    createTenantManualReviewDomain,
} from './manual-review.js?v=__ASSET_VERSION__';

export function createTenantAssetsDomain({ notify, formatDate }) {
    const manualReviewDomain = createTenantManualReviewDomain({ notify, formatDate });
    const evidenceDomain = createTenantAssetEvidenceDomain({ notify });
    const executionDomain = createTenantExecutionDomain({ notify, formatDate });

    const HISTORICAL_STORAGE_BASELINE = Object.freeze({
        source: 'latest_local_cloud_map_baseline',
        generatedAt: '2026-06-17T00:00:00.000Z',
        d1Tables: 76,
        d1R2References: 474,
        missingR2Objects: 0,
        r2Objects: 526,
        referencedR2Objects: 344,
        safeClassifiedObjects: 182,
        riskyReviewObjects: 0,
        deleteCandidates: 0,
        unknownBlocked: 0,
        totalBytes: 1030000000,
        protectedOwnerAccounts: 3,
        buckets: [
            { id: 'bitbi-user-images', label: 'bitbi-user-images', binding: 'USER_IMAGES', status: 'Auth Worker Binding', objects: 516, bytes: 1030000000 },
            { id: 'bitbi-private-media', label: 'bitbi-private-media', binding: 'PRIVATE_MEDIA', status: 'Auth Worker Binding', objects: 3, bytes: 136000 },
            { id: 'bitbi-audit-archive', label: 'bitbi-audit-archive', binding: 'AUDIT_ARCHIVE', status: 'Auth Worker Binding', objects: 7, bytes: 13000 },
            { id: 'bitbi-public-media', label: 'bitbi-public-media', binding: null, status: 'Dashboard visible; not bound to Auth Worker', objects: 0, bytes: 0 },
        ],
        classifications: [
            { id: 'current_and_valid', label: 'current_and_valid', count: 344, group: 'current' },
            { id: 'news_pulse_asset', label: 'news_pulse_asset', count: 172, group: 'retained' },
            { id: 'audit_or_legal_retention_keep', label: 'audit_or_legal_retention_keep', count: 7, group: 'retained' },
            { id: 'protected_user_avatar', label: 'protected_user_avatar', count: 3, group: 'retained' },
        ],
    });

    function formatBytes(bytes) {
        const value = Number(bytes || 0);
        if (!Number.isFinite(value) || value <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = value;
        let unit = 0;
        while (size >= 1024 && unit < units.length - 1) {
            size /= 1024;
            unit += 1;
        }
        const digits = unit >= 2 ? 2 : 0;
        return `${size.toFixed(digits)} ${units[unit]}`;
    }

    function renderStorageHealthSummary(container, report, res, onRefresh) {
        const baseline = HISTORICAL_STORAGE_BASELINE;
        const hero = el('div', 'admin-control-hero admin-health-hero glass glass-card reveal visible');
        const copy = el('div');
        copy.append(el('p', 'admin-control-hero__eyebrow', 'Storage Integrity'));
        copy.append(el('h2', 'admin-control-hero__title', 'Current storage integrity: not verified'));
        copy.append(el('p', 'admin-control-hero__copy', 'The stored baseline below is historical. Refresh loads domain evidence; it does not run a current D1/R2 inventory or verify the historical counts.'));
        const badges = el('div', 'admin-control-hero__badges');
        badges.append(badge('Not currently verified', 'legacy'), badge('Read-only evidence', 'user'));
        hero.append(copy, badges);
        container.appendChild(hero);

        const payloadReport = res.data?.report || res.data?.data?.report;
        const hasReportedEvidence = res.ok && Array.isArray(payloadReport?.domains);
        const evidence = readinessSection('Domain evidence', !res.ok
            ? 'Domain evidence could not be refreshed. Current storage integrity remains unknown.'
            : hasReportedEvidence
                ? 'The evidence endpoint responded. This is not a current storage-integrity check.'
                : 'The endpoint returned no usable domain report. Only static fallback diagnostics are available; current storage integrity remains unknown.');
        if (!res.ok) {
            const error = el('div');
            error.setAttribute('role', 'alert');
            evidenceDomain.renderEndpointUnavailable(error, res);
            evidence.appendChild(error);
        } else if (hasReportedEvidence) {
            evidence.appendChild(readinessCards([{
                title: 'Reported evidence',
                badge: { label: 'Evidence received', variant: 'user' },
                copy: 'Review the reported scope and limitations in Advanced Diagnostics.',
                meta: [['Source', report.source || 'Not reported'], ['Generated', report.generatedAt || 'Not reported']],
            }], (item) => item));
        }
        const refresh = el('button', 'btn-action', 'Refresh evidence');
        refresh.type = 'button';
        refresh.id = 'tenantAssetEvidenceRefresh';
        refresh.addEventListener('click', () => {
            void onRefresh?.({ restoreFocus: document.activeElement === refresh });
        });
        evidence.appendChild(refresh);
        container.appendChild(evidence);

        const history = readinessSection('Historical storage baseline', `Recorded ${baseline.generatedAt}. Source: ${baseline.source}. These fixed figures are not updated by Refresh evidence.`);
        history.appendChild(readinessCards([
            { title: 'D1 to R2 references', count: baseline.d1R2References, meta: [['D1 tables', baseline.d1Tables], ['Referenced R2 objects', baseline.referencedR2Objects]] },
            { title: 'Missing R2 objects', count: baseline.missingR2Objects, meta: [['Risky review objects', baseline.riskyReviewObjects], ['Delete candidates', baseline.deleteCandidates], ['Unknown blocked', baseline.unknownBlocked]] },
            { title: 'R2 objects', count: baseline.r2Objects, meta: [['Classified for retention', baseline.safeClassifiedObjects], ['Total size', formatBytes(baseline.totalBytes)]] },
            { title: 'Protected owner accounts', count: baseline.protectedOwnerAccounts, meta: [['Recorded', baseline.generatedAt]] },
        ], (item) => ({
            title: item.title,
            badge: { label: String(item.count), variant: 'user' },
            copy: 'Historical count; current value not verified.',
            meta: item.meta,
        })));
        container.appendChild(history);

        const buckets = readinessSection('Historical bucket inventory', 'Bindings, object counts and classifications below describe the recorded baseline, not current availability.');
        buckets.appendChild(readinessCards(baseline.buckets, (bucket) => ({
            title: bucket.label,
            badge: { label: 'Historical', variant: 'legacy' },
            copy: bucket.status,
            meta: [['Objects', bucket.objects], ['Size', formatBytes(bucket.bytes)], ['Recorded binding', bucket.binding || 'Not bound']],
        })));
        buckets.appendChild(readinessCards(baseline.classifications, (item) => ({
            title: readableToken(item.label),
            badge: { label: String(item.count), variant: 'user' },
            copy: 'Historical classification; no current inventory verification.',
        })));
        container.appendChild(buckets);
        container.appendChild(readinessSection('Evidence limits', 'Tenant isolation, runtime access-switch readiness, ownership backfill readiness, confirmed legacy reset readiness, and legal erasure completion remain unclaimed. Guarded tools remain in Advanced Diagnostics.'));
    }

    async function renderTenantAssets({ restoreFocus = false } = {}) {
        const container = byId('tenantAssetCenter');
        if (!container) return;
        clear(container);
        container.appendChild(el('div', 'admin-state', 'Loading storage health evidence...'));
        const { res, report } = await evidenceDomain.loadDomainReport();
        clear(container);
        renderStorageHealthSummary(container, report, res, renderTenantAssets);

        const advanced = el('details', 'admin-advanced-disclosure glass glass-card reveal visible');
        const summary = el('summary', 'admin-advanced-disclosure__summary');
        const summaryText = el('span');
        summaryText.append(
            el('strong', null, 'Show Advanced Diagnostics'),
            el('span', null, 'Legacy evidence, backfill dry-runs, access-switch diagnostics and reset safety limits remain available here.'),
        );
        summary.append(summaryText, badge('Advanced / Archive', 'legacy'));
        const advancedBody = el('div', 'admin-advanced-disclosure__body admin-control-stack');
        advanced.append(summary, advancedBody);
        container.appendChild(advanced);

        evidenceDomain.renderTenantAssetOverview(advancedBody, report, renderTenantAssets);
        executionDomain.renderTenantIsolationExecution(advancedBody);
        evidenceDomain.renderTenantBlockedActions(advancedBody);
        if (!res.ok) {
            evidenceDomain.renderEndpointUnavailable(advancedBody, res);
        }
        if (restoreFocus && document.activeElement === document.body && container.getClientRects().length) {
            byId('tenantAssetEvidenceRefresh')?.focus();
        }
    }

    function bind() {
        manualReviewDomain.bind();
    }

    return {
        bind,
        renderTenantAssets,
        loadTenantAssetManualReviewQueue: manualReviewDomain.loadTenantAssetManualReviewQueue,
        exportTenantAssetManualReviewEvidenceJson: manualReviewDomain.exportTenantAssetManualReviewEvidenceJson,
        exportLegacyMediaResetDryRunJson: executionDomain.exportLegacyMediaResetDryRunJson,
    };
}
