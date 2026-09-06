import { loadAdminModule } from '../module-loader.js?v=__ASSET_VERSION__';
/* ============================================================
   BITBI — Admin Control Plane
   Safe frontend-only surfaces for implemented admin APIs.
   ============================================================ */

import {
    apiAdminAiBudgetSwitches,
    apiAdminAiUsageAttempts,
    apiAdminBillingEvents,
    apiAdminBillingLiveReadinessStatus,
    apiAdminBillingPlans,
    apiAdminDataLifecycleArchives,
    apiAdminDataLifecycleRequests,
    apiAdminOrganizations,
    apiAdminR2Buckets,
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
    renderAdminWorkbench,
} from './guidance.js?v=__ASSET_VERSION__';
export function createAdminControlPlane({ showToast, formatDate }) {
    const loaded = new Set();

    function notify(message, type = 'success') {
        if (typeof showToast === 'function') showToast(message, type);
    }

    const domainContext = { notify, formatDate };
    const domains = new Map();
    const imports = new Map();
    const groups = { orgs:'billing', billing:'billing', 'live-billing':'billing', 'billing-events':'billing', 'ai-usage':'budget', 'ai-budget-switches':'budget', lifecycle:'lifecycle', operations:'operations', 'tenant-assets':'tenant', 'object-storage':'storage' };
    const factories = {
        billing: () => loadAdminModule(new URL('./billing.js?v=__ASSET_VERSION__', import.meta.url)).then(m => () => m.createBillingDomain(domainContext)),
        budget: () => loadAdminModule(new URL('./ai-budget.js?v=__ASSET_VERSION__', import.meta.url)).then(m => () => m.createAiBudgetDomain(domainContext)),
        lifecycle: () => loadAdminModule(new URL('./lifecycle.js?v=__ASSET_VERSION__', import.meta.url)).then(m => () => m.createLifecycleDomain(domainContext)),
        tenant: () => loadAdminModule(new URL('./tenant-assets.js?v=__ASSET_VERSION__', import.meta.url)).then(m => () => m.createTenantAssetsDomain(domainContext)),
        storage: () => loadAdminModule(new URL('./object-storage.js?v=__ASSET_VERSION__', import.meta.url)).then(m => () => m.createObjectStorageDomain(domainContext)),
        operations: () => loadAdminModule(new URL('./operations.js?v=__ASSET_VERSION__', import.meta.url)).then(m => () => m.createOperationsDomain({ ...domainContext,
            loadTenantAssetManualReviewQueue: async () => (await domain('tenant')).loadTenantAssetManualReviewQueue(),
        })),
    };
    async function domain(key, isCurrent = () => true) {
        if (domains.has(key)) return domains.get(key);
        if (!imports.has(key)) imports.set(key, factories[key]().catch(error => { imports.delete(key); throw error; }));
        const factory = await imports.get(key);
        if (!isCurrent()) return null;
        if (!domains.has(key)) { const instance = factory(); instance.bind?.(); domains.set(key, instance); }
        return domains.get(key);
    }

    async function loadCommandCenter(isCurrent) {
        const container = byId('controlPlaneCapabilityGrid');
        if (!container) return;
        clear(container);
        container.appendChild(el('div', 'admin-state', 'Checking implemented admin capabilities...'));

        const probes = await Promise.all([
            capabilityProbe('Organizations', () => apiAdminOrganizations({ limit: 1 })),
            capabilityProbe('Billing plans', () => apiAdminBillingPlans()),
            capabilityProbe('Live billing', () => apiAdminBillingLiveReadinessStatus()),
            capabilityProbe('Billing events', () => apiAdminBillingEvents({ limit: 1 })),
            capabilityProbe('AI usage attempts', () => apiAdminAiUsageAttempts({ limit: 1 })),
            capabilityProbe('AI budget controls', () => apiAdminAiBudgetSwitches()),
            capabilityProbe('Data lifecycle', () => apiAdminDataLifecycleRequests({ limit: 1 })),
            capabilityProbe('Export archives', () => apiAdminDataLifecycleArchives({ limit: 1 })),
            capabilityProbe('Tenant asset manual review', () => apiAdminTenantAssetManualReviewEvidence({ limit: 1, includeItems: false })),
            capabilityProbe('R2 Object Storage', () => apiAdminR2Buckets()),
        ]);
        if (!isCurrent() || !container.isConnected) return;
        renderAdminWorkbench(probes);

        renderCards(container, [
            {
                title: 'Security & Policy',
                badge: { label: 'Implemented in repository', variant: 'user' },
                copy: 'Route policy, body parser, secret scan, fail-closed limiter, MFA, service auth, and replay protections are implemented. This card does not verify current CI, deployment or live availability.',
                href: '#security',
                cta: 'Review posture',
            },
            {
                title: 'Organizations / RBAC',
                badge: { label: probes[0].status, variant: probes[0].variant },
                copy: 'Inspect organizations, active memberships, roles, and guarded user-assignment switches when the admin API responds. This is not live tenant isolation proof.',
                href: '#orgs',
            },
            {
                title: 'Billing / Credits',
                badge: { label: probes[1].status, variant: probes[1].variant },
                copy: 'Review plan entitlements, organization and member credit balances, and perform confirmed manual credit grants. Live payment activation remains disabled.',
                href: '#billing',
            },
            {
                title: 'Live Billing Command Center',
                badge: { label: probes[2].status, variant: probes[2].variant },
                copy: 'Review redacted live Stripe readiness, customer portal support, evidence checklist, and safe operator next steps. This UI does not activate live payments.',
                href: '#live-billing',
                cta: 'Open cockpit',
            },
            {
                title: 'Billing Events / Stripe',
                badge: { label: probes[3].status, variant: probes[3].variant },
                copy: 'Inspect sanitized provider events, operator-only live Stripe review records, and read-only local reconciliation signals. Automated remediation, credit clawback, and Stripe actions remain disabled.',
                href: '#billing-events',
            },
            {
                title: 'AI Usage Attempts',
                badge: { label: probes[4].status, variant: probes[4].variant },
                copy: 'Inspect org-scoped image/text usage attempts, reservations, replay status, and cleanup dry-runs.',
                href: '#ai-usage',
            },
            {
                title: 'AI Budget Controls',
                badge: { label: probes[5].status, variant: probes[5].variant },
                copy: 'Operate Cloudflare-master plus D1 app switches, platform_admin_lab_budget caps, reconciliation, repair evidence, and sanitized archives. This is not live billing readiness.',
                href: '#ai-budget-switches',
                cta: 'Open controls',
            },
            {
                title: 'Data Lifecycle',
                badge: { label: probes[6].status, variant: probes[6].variant },
                copy: 'Inspect export/deletion/anonymization requests and private export archive metadata. Irreversible deletion remains unavailable in this UI.',
                href: '#lifecycle',
            },
            {
                title: 'Storage Health / Asset Integrity',
                badge: { label: probes[8].status, variant: probes[8].variant },
                copy: 'Review domain evidence and the dated historical D1/R2 baseline. Current storage integrity is not verified by this API probe. Legacy diagnostics remain behind Advanced.',
                href: '#tenant-assets',
                cta: 'Open health',
            },
            {
                title: 'R2 Object Storage',
                badge: { label: probes[9].status, variant: probes[9].variant },
                copy: 'Browse and manage configured Worker-bound R2 buckets with Admin/MFA, idempotency, audit logging, and app-managed object safeguards.',
                href: '#object-storage',
                cta: 'Open drive',
            },
        ]);
    }

    function renderSecurity() {
        renderSecurityPosturePanel({ container: byId('controlSecurity'), renderCards });
    }

    function bind() {}

    function leave(previous, next) {
        if (groups[previous] === groups[next]) return;
        const previousDomain = domains.get(groups[previous]);
        if (previousDomain?.needsReload?.()) loaded.delete(previous);
        previousDomain?.setActive?.(false);
        previousDomain?.hide?.();
    }

    async function load(sectionName, { context, isCurrent = () => true } = {}) {
        if (!CONTROL_SECTIONS.has(sectionName)) return;
        if (sectionName === 'dashboard') { await loadCommandCenter(isCurrent); return; }
        if (sectionName === 'security') { renderSecurity(); return; }
        const active = await domain(groups[sectionName], isCurrent);
        if (!active || !isCurrent()) return;
        active.setActive?.(true);
        if (active.needsRefresh?.(sectionName)) loaded.delete(sectionName);
        const loaders = { orgs:'loadOrgs', billing:'loadBillingPlans', 'live-billing':'loadLiveBillingCommandCenter', 'billing-events':'loadBillingEventsPanel', 'ai-usage':'loadAiAttempts', 'ai-budget-switches':'loadAiBudgetSwitchesPanel', lifecycle:'loadLifecycle', operations:'loadOperations', 'object-storage':'loadObjectStorage', 'tenant-assets':'renderTenantAssets' };
        if (!loaded.has(sectionName)) {
            await active[loaders[sectionName]]();
            if (!isCurrent()) return;
            loaded.add(sectionName);
        }
        if (context && isCurrent()) await active.activateContext?.({ ...context, section: sectionName });
    }

    return { bind, load, leave, sections: CONTROL_SECTIONS };
}
