/* ============================================================
   BITBI — Admin Control Plane / Tenant Assets Composer
   Root composition for tenant asset evidence, manual review, and guarded execution subdomains.
   ============================================================ */

import {
    byId,
    clear,
    el,
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

    async function renderTenantAssets() {
        const container = byId('tenantAssetCenter');
        if (!container) return;
        clear(container);
        container.appendChild(el('div', 'admin-state', 'Loading tenant asset domain evidence...'));
        const { res, report } = await evidenceDomain.loadDomainReport();
        clear(container);
        evidenceDomain.renderTenantAssetOverview(container, report, renderTenantAssets);
        executionDomain.renderTenantIsolationExecution(container);
        evidenceDomain.renderTenantBlockedActions(container);
        if (!res.ok) {
            evidenceDomain.renderEndpointUnavailable(container, res);
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
