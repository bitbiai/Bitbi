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
    users: 'sectionUsers',
    'ai-lab': 'sectionAiLab',
    'news-feed-agent': 'sectionNewsFeedAgent',
    'homepage-hero-videos': 'sectionHomepageHeroVideos',
    activity: 'sectionActivity',
};

const SECTION_META = {
    dashboard: { title: 'Workspace', desc: 'People, creative work and operations — with the evidence behind each decision.' },
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
    'tenant-assets': { title: 'Storage Integrity', desc: 'Compact storage health, D1/R2 integrity, and advanced legacy diagnostics' },
    users: { title: 'User Management', desc: 'Manage users, roles, and sessions' },
    'ai-lab': { title: 'AI Lab', desc: 'Admin-only AI tests, previews, and model comparisons' },
    'news-feed-agent': { title: 'News Feed Agent', desc: 'News Pulse visibility, active items, and irreversible cleanup' },
    'homepage-hero-videos': { title: 'Homepage Hero Videos', desc: 'Operator-managed optimized hero video slots for the public homepage' },
    activity: { title: 'Activity', desc: 'Audit trail and admin actions' },
};

const SECTION_ALIASES = {
    'registration-settings': { section: 'users', panel: 'registrationAvailabilityPanel' },
    'fable-data-center': { section: 'ai-lab', panel: 'fableDataCard' },
    'platform-budget-caps': { section: 'ai-budget-switches', panel: 'platformBudgetCapsPanel' },
    'budget-reconciliation': { section: 'ai-budget-switches', panel: 'platformBudgetReconciliationPanel' },
    'budget-repair': { section: 'ai-budget-switches', panel: 'platformBudgetReconciliationPanel' },
    'repair-evidence-report': { section: 'ai-budget-switches', panel: 'platformBudgetRepairReportPanel' },
    'evidence-archives': { section: 'ai-budget-switches', panel: 'platformBudgetEvidenceArchivesPanel' },
    timeline: { section: 'operations', panel: null },
    triage: { section: 'operations', panel: null },
    'storage-health': { section: 'tenant-assets', panel: null },
    'asset-integrity': { section: 'tenant-assets', panel: null },
    readiness: { section: 'dashboard', panel: null },
    'system-status': { section: 'dashboard', panel: null },
    'operational-status': { section: 'dashboard', panel: null },
    settings: { section: 'dashboard', panel: null },
    content: { section: 'dashboard', panel: null },
    media: { section: 'dashboard', panel: null },
    access: { section: 'dashboard', panel: null },
    reference: { section: 'dashboard', panel: null },
    'help-archive': { section: 'dashboard', panel: null },
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

// Each navigation owns its completion. Context IDs live only in this page's memory.
export function createAdminRouter({ heroTitle, heroDesc, nav, loadSection, leaveSection }) {
    const sections = createSectionRefs();
    const status = document.getElementById('adminSectionState');
    let generation = 0;
    let currentSection = null;
    let pendingNavigation = null;

    function renderState(message, failed = false, retry) {
        if (!status) return;
        status.replaceChildren();
        status.hidden = !message;
        status.dataset.state = failed ? 'error' : 'loading';
        status.setAttribute('role', failed ? 'alert' : 'status');
        status.append(document.createTextNode(message));
        if (retry) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn-action';
            button.textContent = 'Try again';
            button.addEventListener('click', retry, { once: true });
            status.append(button);
        }
    }

    async function showSection(routeName, options = {}) {
        const token = ++generation;
        if (routeName === 'credits' || routeName === 'organization') {
            location.assign(`/account/${routeName}.html`);
            return;
        }
        const route = resolveSectionRoute(routeName);
        const name = route.section;
        const previous = currentSection;
        currentSection = name;
        leaveSection?.(previous, name);
        const known = Object.hasOwn(sections, name) && sections[name];
        for (const [key, section] of Object.entries(sections)) {
            if (section) { section.hidden = key !== name; section.style.display = key === name ? '' : 'none'; }
        }
        nav?.syncActiveSection?.(routeName === 'fable-data-center' ? routeName : name);
        const meta = SECTION_META[name];
        if (heroTitle) heroTitle.textContent = meta?.title || 'Section unavailable';
        if (heroDesc) heroDesc.textContent = meta?.desc || 'This link does not identify an available admin section. Choose a task from the navigation.';
        if (!known) { renderState('Unknown admin destination. Choose an available section.', true); return; }
        const panelTarget = options.panel || route.panel;
        const focusedAtStart = document.activeElement;
        sections[name].dataset.loadState = 'loading';
        renderState('Loading ' + meta.title + '…');
        try {
            await loadSection?.(name, { context: options.context, isCurrent: () => token === generation, panel: panelTarget });
            if (token !== generation) return;
            sections[name].dataset.loadState = 'ready';
            renderState('');
            window.requestAnimationFrame(() => {
                if (token !== generation) return;
                // A user who has already started working keeps their input focus.
                if (document.activeElement !== focusedAtStart && document.activeElement !== document.body) return;
                const panel = panelTarget ? document.getElementById(panelTarget) : heroTitle;
                if (!panel || (panelTarget && !sections[name].contains(panel))) return;
                panel.tabIndex = -1;
                panel.focus({ preventScroll: true });
                (panelTarget ? panel : panel.closest('header') || panel).scrollIntoView({ block: 'start', behavior: 'auto' });
            });
        } catch {
            if (token !== generation) return;
            sections[name].dataset.loadState = 'failed';
            renderState('This section could not be loaded. Other admin tasks remain available.', true, () => showSection(routeName, options));
        }
    }

    function navigate(section, options = {}) {
        if ((location.hash.slice(1) || 'dashboard') === section) return showSection(section, options);
        pendingNavigation = { section, options };
        location.hash = section;
    }

    function bind() {
        function onHashChange() {
            const hash = location.hash.slice(1) || 'dashboard';
            const options = pendingNavigation?.section === hash ? pendingNavigation.options : {};
            pendingNavigation = null;
            void showSection(hash, options);
        }
        window.addEventListener('hashchange', onHashChange);
        document.addEventListener('click', event => {
            const link = event.target.closest?.('a[data-nav], a[data-admin-panel-target]');
            if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const url = new URL(link.href, location.href);
            // Account links remain real links; data-nav does not redefine their destination.
            if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return;
            event.preventDefault();
            navigate(url.hash.slice(1), { panel: link.dataset.adminPanelTarget });
        });
        onHashChange();
    }
    return { bind, navigate, showSection, stop: () => { generation += 1; pendingNavigation = null; }, getCurrentSection: () => currentSection };
}
