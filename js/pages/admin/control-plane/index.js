/* ============================================================
   BITBI — Admin Control Plane
   Safe frontend-only surfaces for implemented admin APIs.
   ============================================================ */

import {
    apiAdminAiBudgetSwitches,
    apiAdminAiUsageAttempts,
    apiAdminBillingEvents,
    apiAdminBillingPlans,
    apiAdminDataLifecycleArchives,
    apiAdminDataLifecycleRequests,
    apiAdminOrganizations,
    apiAdminTenantAssetManualReviewEvidence,
} from '../../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    CONTROL_SECTIONS,
    byId,
    capabilityProbe,
    clear,
    el,
    renderCards,
} from './core.js?v=__ASSET_VERSION__';
import {
    renderSecurityPosturePanel,
} from '../security.js?v=__ASSET_VERSION__';
import {
    renderAdminSettingsPanel,
} from '../settings.js?v=__ASSET_VERSION__';
import {
    renderAdminWorkbench,
} from './guidance.js?v=__ASSET_VERSION__';
import {
    createAiBudgetDomain,
} from './ai-budget.js?v=__ASSET_VERSION__';
import {
    createBillingDomain,
} from './billing.js?v=__ASSET_VERSION__';
import {
    createLifecycleDomain,
} from './lifecycle.js?v=__ASSET_VERSION__';
import {
    createOperationsDomain,
} from './operations.js?v=__ASSET_VERSION__';
import {
    createReadinessDomain,
} from './readiness-domain.js?v=__ASSET_VERSION__';
import {
    createTenantAssetsDomain,
} from './tenant-assets.js?v=__ASSET_VERSION__';

export function createAdminControlPlane({ showToast, formatDate }) {
    const loaded = new Set();

    function notify(message, type = 'success') {
        if (typeof showToast === 'function') showToast(message, type);
    }

    const domainContext = { notify, formatDate };
    const billingDomain = createBillingDomain(domainContext);
    const aiBudgetDomain = createAiBudgetDomain(domainContext);
    const lifecycleDomain = createLifecycleDomain(domainContext);
    const tenantAssetsDomain = createTenantAssetsDomain(domainContext);
    const operationsDomain = createOperationsDomain({
        ...domainContext,
        loadTenantAssetManualReviewQueue: tenantAssetsDomain.loadTenantAssetManualReviewQueue,
    });
    const readinessDomain = createReadinessDomain({
        ...domainContext,
        exportLegacyMediaResetDryRunJson: tenantAssetsDomain.exportLegacyMediaResetDryRunJson,
        exportTenantAssetManualReviewEvidenceJson: tenantAssetsDomain.exportTenantAssetManualReviewEvidenceJson,
    });

    async function loadCommandCenter() {
        const container = byId('controlPlaneCapabilityGrid');
        if (!container) return;
        clear(container);
        container.appendChild(el('div', 'admin-state', 'Checking implemented admin capabilities...'));

        const probes = await Promise.all([
            capabilityProbe('Organizations', () => apiAdminOrganizations({ limit: 1 })),
            capabilityProbe('Billing plans', () => apiAdminBillingPlans()),
            capabilityProbe('Billing events', () => apiAdminBillingEvents({ limit: 1 })),
            capabilityProbe('AI usage attempts', () => apiAdminAiUsageAttempts({ limit: 1 })),
            capabilityProbe('AI budget controls', () => apiAdminAiBudgetSwitches()),
            capabilityProbe('Data lifecycle', () => apiAdminDataLifecycleRequests({ limit: 1 })),
            capabilityProbe('Export archives', () => apiAdminDataLifecycleArchives({ limit: 1 })),
            capabilityProbe('Tenant asset manual review', () => apiAdminTenantAssetManualReviewEvidence({ limit: 1, includeItems: false })),
        ]);
        renderAdminWorkbench(probes);

        renderCards(container, [
            {
                title: 'Security & Policy',
                badge: { label: 'Repo-enforced', variant: 'active' },
                copy: 'Route policy, body parser, secret scan, fail-closed limiter, MFA, service auth, and replay protections are implemented and validated by CI/preflight.',
                href: '#security',
                cta: 'Review posture',
            },
            {
                title: 'Organizations / RBAC',
                badge: { label: probes[0].status, variant: probes[0].variant },
                copy: 'Inspect organizations, active memberships, roles, and tenant-readiness boundaries when the admin API responds. This is not live tenant isolation proof.',
                href: '#orgs',
            },
            {
                title: 'Billing / Credits',
                badge: { label: probes[1].status, variant: probes[1].variant },
                copy: 'Review plan entitlements, organization and member credit balances, and perform confirmed manual credit grants. Live payment activation remains disabled.',
                href: '#billing',
            },
            {
                title: 'Billing Events / Stripe',
                badge: { label: probes[2].status, variant: probes[2].variant },
                copy: 'Inspect sanitized provider events, operator-only live Stripe review records, and read-only local reconciliation signals. Automated remediation, credit clawback, and Stripe actions remain disabled.',
                href: '#billing-events',
            },
            {
                title: 'AI Usage Attempts',
                badge: { label: probes[3].status, variant: probes[3].variant },
                copy: 'Inspect org-scoped image/text usage attempts, reservations, replay status, and cleanup dry-runs.',
                href: '#ai-usage',
            },
            {
                title: 'AI Budget Controls',
                badge: { label: probes[4].status, variant: probes[4].variant },
                copy: 'Operate Cloudflare-master plus D1 app switches, platform_admin_lab_budget caps, reconciliation, repair evidence, and sanitized archives. This is not live billing readiness.',
                href: '#ai-budget-switches',
                cta: 'Open controls',
            },
            {
                title: 'Data Lifecycle',
                badge: { label: probes[5].status, variant: probes[5].variant },
                copy: 'Inspect export/deletion/anonymization requests and private export archive metadata. Irreversible deletion remains unavailable in this UI.',
                href: '#lifecycle',
            },
            {
                title: 'Tenant Asset Manual Review',
                badge: { label: probes[7].status, variant: probes[7].variant },
                copy: 'Inspect AI folders/images manual-review queue evidence and record review-status decisions. Ownership backfill and access switching remain blocked.',
                href: '#operations',
                cta: 'Open queue',
            },
            {
                title: 'Operational Readiness',
                badge: { label: 'Production blocked', variant: 'disabled' },
                copy: 'Release preflight is green, but live Cloudflare validation, migration verification, and main-only operator evidence remain deployment prerequisites.',
                href: '#readiness',
            },
            {
                title: 'Reference Views',
                badge: { label: 'Read-only', variant: 'user' },
                copy: 'Open Content, Media, and Access Reference surfaces for codebase-only context. These views do not query live systems, list R2, or prove tenant authorization.',
                href: '#content',
                cta: 'Open references',
            },
        ]);
    }

    function renderSecurity() {
        renderSecurityPosturePanel({ container: byId('controlSecurity'), renderCards });
    }

    function renderSettings() {
        renderAdminSettingsPanel({ container: byId('adminSettingsPanel'), renderCards });
    }

    function bind() {
        billingDomain.bind();
        aiBudgetDomain.bind();
        lifecycleDomain.bind();
        operationsDomain.bind();
        tenantAssetsDomain.bind();
    }

    async function load(sectionName) {
        if (!CONTROL_SECTIONS.has(sectionName)) return;
        if (sectionName === 'dashboard') {
            await loadCommandCenter();
            return;
        }
        if (sectionName === 'security') {
            renderSecurity();
            return;
        }
        if (sectionName === 'readiness') {
            await readinessDomain.renderReadiness();
            return;
        }
        if (sectionName === 'settings') {
            renderSettings();
            return;
        }
        if (loaded.has(sectionName)) return;
        loaded.add(sectionName);
        if (sectionName === 'orgs') await billingDomain.loadOrgs();
        if (sectionName === 'billing') await billingDomain.loadBillingPlans();
        if (sectionName === 'billing-events') await billingDomain.loadBillingEventsPanel();
        if (sectionName === 'ai-usage') await aiBudgetDomain.loadAiAttempts();
        if (sectionName === 'ai-budget-switches') await aiBudgetDomain.loadAiBudgetSwitchesPanel();
        if (sectionName === 'lifecycle') await lifecycleDomain.loadLifecycle();
        if (sectionName === 'operations') await operationsDomain.loadOperations();
        if (sectionName === 'tenant-assets') await tenantAssetsDomain.renderTenantAssets();
    }

    return {
        bind,
        load,
        sections: CONTROL_SECTIONS,
    };
}
