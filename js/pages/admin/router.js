const SECTION_DOM_IDS = {
    dashboard: 'sectionDashboard',
    security: 'sectionSecurity',
    orgs: 'sectionOrgs',
    billing: 'sectionBilling',
    'live-billing': 'sectionLiveBilling',
    'billing-events': 'sectionBillingEvents',
    'ai-usage': 'sectionAiUsage',
    'ai-budget-switches': 'sectionAiBudgetSwitches',
    lifecycle: 'sectionLifecycle',
    operations: 'sectionOperations',
    'object-storage': 'sectionObjectStorage',
    'tenant-assets': 'sectionTenantAssets',
    readiness: 'sectionReadiness',
    users: 'sectionUsers',
    content: 'sectionContent',
    media: 'sectionMedia',
    access: 'sectionAccess',
    'ai-lab': 'sectionAiLab',
    'homepage-hero-videos': 'sectionHomepageHeroVideos',
    activity: 'sectionActivity',
    settings: 'sectionSettings',
};

const SECTION_META = {
    dashboard: { title: 'Command Center', desc: 'System overview, readiness, and control-plane entrypoints' },
    security: { title: 'Security & Policy', desc: 'Route policy, MFA, service auth, and fail-closed guardrails' },
    orgs: { title: 'Organizations', desc: 'Organization, tenant, and membership inspection' },
    billing: { title: 'Billing & Credits', desc: 'Plans, entitlements, balances, and safe manual credit grants' },
    'live-billing': { title: 'Live Billing', desc: 'Redacted readiness, evidence, and operator go/no-go cockpit' },
    'billing-events': { title: 'Billing Events', desc: 'Provider events, operator review queue, and read-only reconciliation' },
    'ai-usage': { title: 'AI Usage', desc: 'Org-scoped usage attempts, reservations, replay, and cleanup' },
    'ai-budget-switches': { title: 'AI Budget Switches', desc: 'App-level controls layered under Cloudflare master kill switches' },
    lifecycle: { title: 'Data Lifecycle', desc: 'Export, deletion planning, archive, and retention operations' },
    operations: { title: 'Operations', desc: 'Operator timeline, triage, async AI video diagnostics, and review queues' },
    'object-storage': { title: 'R2 Object Storage', desc: 'Live admin drive for configured Cloudflare R2 buckets, protected by Admin/MFA/audit controls' },
    'tenant-assets': { title: 'Tenant Assets', desc: 'Cross-domain ownership inventory, evidence gaps, and storage safety' },
    readiness: { title: 'Readiness', desc: 'Release, migration, Cloudflare, and staging verification checklist' },
    users: { title: 'User Management', desc: 'Manage users, roles, and sessions' },
    content: { title: 'Content Reference', desc: 'Read-only codebase content definitions, not live system queries' },
    media: { title: 'Media Reference', desc: 'Read-only codebase media inventory, not live R2 listing' },
    access: { title: 'Access Reference', desc: 'Read-only codebase access map, not live authorization proof' },
    'ai-lab': { title: 'AI Lab', desc: 'Admin-only AI tests, previews, and model comparisons' },
    'homepage-hero-videos': { title: 'Homepage Hero Videos', desc: 'Operator-managed optimized hero video slots for the public homepage' },
    activity: { title: 'Activity', desc: 'Audit trail and admin actions' },
    settings: { title: 'Admin Settings', desc: 'Safe settings boundaries and deployment-owned configuration' },
};

const SECTION_ALIASES = {
    'platform-budget-caps': { section: 'ai-budget-switches', panel: 'platformBudgetCapsPanel' },
    'budget-reconciliation': { section: 'ai-budget-switches', panel: 'platformBudgetReconciliationPanel' },
    'budget-repair': { section: 'ai-budget-switches', panel: 'platformBudgetReconciliationPanel' },
    'repair-evidence-report': { section: 'ai-budget-switches', panel: 'platformBudgetRepairReportPanel' },
    'evidence-archives': { section: 'ai-budget-switches', panel: 'platformBudgetEvidenceArchivesPanel' },
    timeline: { section: 'operations', panel: null },
    triage: { section: 'operations', panel: null },
};

function createSectionRefs() {
    return Object.fromEntries(
        Object.entries(SECTION_DOM_IDS).map(([key, id]) => [key, document.getElementById(id)]),
    );
}

function resolveSectionRoute(name) {
    const routeName = name || 'dashboard';
    const alias = SECTION_ALIASES[routeName];
    if (alias) return alias;
    return { section: routeName, panel: null };
}

function focusAdminPanelTarget(panelId) {
    if (!panelId) return;
    window.requestAnimationFrame(() => {
        const panel = document.getElementById(panelId);
        if (!panel) return;
        panel.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
}

export function createAdminRouter({
    heroTitle,
    heroDesc,
    nav,
    loadSection,
}) {
    const sections = createSectionRefs();
    let pendingPanelTarget = null;
    let currentSection = 'dashboard';

    function showSection(routeName) {
        const route = resolveSectionRoute(routeName);
        let name = route.section;
        pendingPanelTarget = route.panel;
        if (!sections[name]) name = 'dashboard';
        currentSection = name;

        for (const [key, el] of Object.entries(sections)) {
            if (el) el.style.display = key === name ? '' : 'none';
        }

        nav?.syncActiveSection?.(name);

        const meta = SECTION_META[name];
        if (meta) {
            if (heroTitle) heroTitle.textContent = meta.title;
            if (heroDesc) heroDesc.textContent = meta.desc;
        }

        Promise.resolve(loadSection?.(name)).finally(() => {
            const panelTarget = pendingPanelTarget;
            pendingPanelTarget = null;
            focusAdminPanelTarget(panelTarget);
        });
    }

    function bind() {
        function onHashChange() {
            const hash = location.hash.replace('#', '') || 'dashboard';
            showSection(hash);
        }

        window.addEventListener('hashchange', onHashChange);

        document.querySelectorAll('.admin-quick-link[data-nav]').forEach(link => {
            if (link.dataset.routerBound === '1') return;
            link.dataset.routerBound = '1';
            link.addEventListener('click', (event) => {
                event.preventDefault();
                location.hash = link.dataset.nav;
            });
        });

        document.querySelectorAll('[data-admin-panel-target]').forEach(link => {
            if (link.dataset.panelTargetBound === '1') return;
            link.dataset.panelTargetBound = '1';
            link.addEventListener('click', () => {
                const panelTarget = link.dataset.adminPanelTarget || null;
                pendingPanelTarget = panelTarget;
                const linkHash = (link.getAttribute('href') || '').replace('#', '');
                if (linkHash && linkHash === (location.hash || '').replace('#', '')) {
                    focusAdminPanelTarget(panelTarget);
                }
            });
        });

        onHashChange();
    }

    return {
        bind,
        getCurrentSection: () => currentSection,
        showSection,
    };
}
