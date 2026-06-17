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

    const CLEAN_STORAGE_BASELINE = Object.freeze({
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
            { id: 'bitbi-public-media', label: 'bitbi-public-media', binding: null, status: 'Dashboard sichtbar, nicht im Auth Worker gebunden', objects: 0, bytes: 0 },
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

    function renderStorageHealthSummary(container, report, onRefresh) {
        const baseline = CLEAN_STORAGE_BASELINE;
        const isClean = baseline.missingR2Objects === 0
            && baseline.riskyReviewObjects === 0
            && baseline.deleteCandidates === 0
            && baseline.unknownBlocked === 0;
        const generated = baseline.generatedAt ? formatDate?.(baseline.generatedAt) || baseline.generatedAt : 'not reported';
        const hero = el('div', 'admin-control-hero admin-health-hero glass glass-card reveal visible');
        const copy = el('div');
        copy.append(el('p', 'admin-control-hero__eyebrow', 'Speicher-Integrität'));
        copy.append(el('h2', 'admin-control-hero__title', isClean ? 'Status: Sauber' : 'Status: Prüfung erforderlich'));
        copy.append(el('p', 'admin-control-hero__copy', 'Kompakte Tagesansicht nach der D1/R2-Baseline: aktive Metadaten und R2-Objekte sind zugeordnet, fehlende Objekte und Löschkandidaten stehen bei 0.'));
        const badges = el('div', 'admin-control-hero__badges');
        badges.append(
            badge(isClean ? 'Status sauber' : 'Prüfung erforderlich', isClean ? 'active' : 'legacy'),
            badge('Frontend-only summary', 'user'),
            badge(report?.source || baseline.source, 'legacy'),
        );
        hero.append(copy, badges);
        container.appendChild(hero);

        const metrics = readinessSection('Aktuelle Speicherlage', 'Nicht jedes R2-Objekt muss direkt in D1 referenziert sein. News Pulse, Audit-Archive und Systemobjekte werden bewusst behalten.');
        metrics.appendChild(readinessCards([
            {
                title: 'D1 -> R2 Referenzen',
                status: baseline.d1R2References,
                copy: 'Aktive D1-Felder mit R2-Bezug aus der letzten sauberen Cloud-Map-Baseline.',
                meta: [['D1 Tabellen', baseline.d1Tables], ['R2-referenzierte Objekte', baseline.referencedR2Objects]],
            },
            {
                title: 'Fehlende R2-Objekte',
                status: baseline.missingR2Objects,
                copy: 'D1-Referenzen, deren Objekt in der vollständigen R2-Inventur fehlt.',
                meta: [['Erwartung', '0'], ['Bewertung', baseline.missingR2Objects === 0 ? 'sauber' : 'prüfen']],
            },
            {
                title: 'Riskant / prüfen',
                status: baseline.riskyReviewObjects,
                copy: 'Unreferenzierte Objekte, die nicht sicher einer Haltekategorie zugeordnet sind.',
                meta: [['Unbekannt blockiert', baseline.unknownBlocked], ['Löschkandidaten', baseline.deleteCandidates]],
            },
            {
                title: 'R2 Objekte',
                status: baseline.r2Objects,
                copy: 'Gesamtobjekte in den bekannten BITBI Buckets inklusive sicher klassifizierter, nicht direkt D1-referenzierter Dateien.',
                meta: [['Sicher klassifiziert', baseline.safeClassifiedObjects], ['Gesamtgröße', formatBytes(baseline.totalBytes)]],
            },
            {
                title: 'Owner-Konten',
                status: baseline.protectedOwnerAccounts,
                copy: 'Geschützte aktive Owner-Konten aus der Baseline. Diese Ansicht löscht oder ändert keine Accountdaten.',
                meta: [['Baseline', generated], ['Quelle', 'BITBI Cloud Map / Audit Reports']],
            },
        ], (item) => ({
            title: item.title,
            badge: { label: String(item.status), variant: Number(item.status) === 0 && item.title !== 'Fehlende R2-Objekte' ? 'active' : item.title === 'Fehlende R2-Objekte' && Number(item.status) === 0 ? 'active' : 'user' },
            copy: item.copy,
            meta: item.meta,
        })));
        container.appendChild(metrics);

        const buckets = readinessSection('Bucket-Status', 'Konfigurierte Worker-Bindings bleiben klar getrennt von dashboard-sichtbaren Buckets.');
        buckets.appendChild(readinessCards(baseline.buckets, (bucket) => ({
            title: bucket.label,
            badge: { label: bucket.status, variant: bucket.binding ? 'active' : 'legacy' },
            copy: bucket.binding
                ? `${bucket.binding} ist im Auth Worker gebunden.`
                : 'Hinweis: Dashboard sichtbar, derzeit nicht im Auth Worker gebunden.',
            meta: [
                ['Objekte', bucket.objects],
                ['Bytes', formatBytes(bucket.bytes)],
                ['Binding', bucket.binding || 'nicht gebunden'],
            ],
        })));
        container.appendChild(buckets);

        const classifications = readinessSection('Klassifikation', 'Sicher klassifizierte R2-Objekte sind kein Problem, nur weil sie nicht direkt in D1 referenziert werden.');
        classifications.appendChild(readinessCards(baseline.classifications, (item) => ({
            title: readableToken(item.label),
            badge: { label: String(item.count), variant: item.group === 'current' ? 'active' : 'user' },
            copy: item.group === 'current'
                ? 'Aktuelle D1/R2-Beziehung ist gültig.'
                : 'Bewusst behaltene System-, News-, Avatar- oder Audit-Kategorie.',
            meta: [['Kategorie', item.id]],
        })));
        const actions = el('div', 'admin-control-chip-row');
        const refresh = el('button', 'btn-action', 'Status aktualisieren');
        refresh.type = 'button';
        refresh.addEventListener('click', () => { void onRefresh?.(); });
        actions.appendChild(refresh);
        classifications.appendChild(actions);
        container.appendChild(classifications);
    }

    async function renderTenantAssets() {
        const container = byId('tenantAssetCenter');
        if (!container) return;
        clear(container);
        container.appendChild(el('div', 'admin-state', 'Loading storage health evidence...'));
        const { res, report } = await evidenceDomain.loadDomainReport();
        clear(container);
        renderStorageHealthSummary(container, report, renderTenantAssets);

        const advanced = el('details', 'admin-advanced-disclosure glass glass-card reveal visible');
        const summary = el('summary', 'admin-advanced-disclosure__summary');
        const summaryText = el('span');
        summaryText.append(
            el('strong', null, 'Erweiterte Diagnose anzeigen'),
            el('span', null, 'Legacy evidence, Backfill-Dry-runs, Access-Switch-Diagnose und Reset-Sicherheitsgrenzen bleiben hier erhalten.'),
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
