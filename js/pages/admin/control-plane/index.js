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
    badge,
    byId,
    capabilityProbe,
    clear,
    el,
    renderCards,
} from './core.js?v=__ASSET_VERSION__';
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
        ]);
    }

    function renderSecurity() {
        const container = byId('controlSecurity');
        if (!container) return;
        renderCards(container, [
            {
                title: 'Route Policy Registry',
                badge: { label: 'Repo checked', variant: 'active' },
                copy: 'High-risk auth-worker routes are registered and checked by npm run check:route-policies.',
                meta: [['Scope', 'Review/CI metadata, not a live dashboard signal']],
            },
            {
                title: 'Fail-Closed Limiters',
                badge: { label: 'Sensitive routes', variant: 'active' },
                copy: 'Auth, admin, AI, billing, lifecycle, and webhook mutation paths use fail-closed rate limiting where implemented.',
                meta: [['Live verification', 'Required in staging/production']],
            },
            {
                title: 'Admin MFA',
                badge: { label: 'Production gated', variant: 'active' },
                copy: 'Admin access is centrally MFA-gated in production and backed by durable failed-attempt state.',
                meta: [['Secrets', 'Managed by deployment configuration only']],
            },
            {
                title: 'Service Auth / Replay',
                badge: { label: 'HMAC + nonce', variant: 'active' },
                copy: 'Auth-to-AI service calls use HMAC authentication and Durable Object replay protection.',
                meta: [['Secret values', 'Never shown in this UI']],
            },
            {
                title: 'Production Readiness',
                badge: { label: 'Blocked', variant: 'disabled' },
                copy: 'This UI reflects repo/runtime API state. It does not prove live Cloudflare resources, migrations, WAF, headers, or Stripe endpoint readiness.',
                meta: [['Required checks', 'Staging verification and live prereq validation']],
            },
        ]);
    }

    function renderSettings() {
        const container = byId('adminSettingsPanel');
        if (!container) return;
        renderCards(container, [
            {
                title: 'Admin Settings',
                badge: { label: 'Deployment-owned', variant: 'legacy' },
                copy: 'No safe backend admin settings API exists for mutable deployment configuration. Secrets and production flags stay in Cloudflare/deployment workflows.',
            },
            {
                title: 'Local UI Preferences',
                badge: { label: 'Future', variant: 'user' },
                copy: 'Table density and saved filters can be added later as local-only preferences without backend mutation.',
            },
        ]);
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
