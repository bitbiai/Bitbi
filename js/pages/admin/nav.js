function setAdminNavGroupExpanded(group, expanded) {
    const toggle = group.querySelector('.admin-nav__group-toggle');
    if (!toggle) return;
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    group.classList.toggle('admin-nav__group--expanded', expanded);
}

export function createAdminNav() {
    let offsetObserver = null;
    let pendingLinkCollapseGroup = null;

    function syncOffset() {
        const siteNav = document.querySelector('header .site-nav');
        if (!siteNav) return;

        const navHeight = Math.ceil(siteNav.getBoundingClientRect().height);
        if (navHeight > 0) {
            document.documentElement.style.setProperty('--admin-nav-top-offset', `${navHeight}px`);
        }
    }

    function bindOffset() {
        syncOffset();

        const siteNav = document.querySelector('header .site-nav');
        if (siteNav && 'ResizeObserver' in window) {
            offsetObserver?.disconnect?.();
            offsetObserver = new ResizeObserver(() => syncOffset());
            offsetObserver.observe(siteNav);
        }

        window.addEventListener('resize', syncOffset);
        window.visualViewport?.addEventListener?.('resize', syncOffset);
    }

    function bindGroups() {
        const groups = document.querySelectorAll('.admin-nav__group');
        groups.forEach((group) => {
            const toggle = group.querySelector('.admin-nav__group-toggle');
            if (!toggle || toggle.dataset.bound === '1') return;
            toggle.dataset.bound = '1';
            const initiallyExpanded = toggle.getAttribute('aria-expanded') === 'true';
            group.classList.toggle('admin-nav__group--expanded', initiallyExpanded);
            toggle.addEventListener('click', () => {
                const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
                if (!isExpanded) {
                    groups.forEach((other) => {
                        if (other !== group) setAdminNavGroupExpanded(other, false);
                    });
                }
                setAdminNavGroupExpanded(group, !isExpanded);
            });
        });
    }

    function bindLinkCollapse() {
        document.querySelectorAll('.admin-nav__group-items .admin-nav__link').forEach((link) => {
            if (link.dataset.collapseBound === '1') return;
            link.dataset.collapseBound = '1';
            link.addEventListener('click', () => {
                const group = link.closest('.admin-nav__group');
                if (!group) return;
                const linkHash = link.getAttribute('href') || '';
                const currentHash = location.hash || '#dashboard';
                if (linkHash === currentHash) {
                    setAdminNavGroupExpanded(group, false);
                    return;
                }
                pendingLinkCollapseGroup = group;
            });
        });
    }

    function syncActiveSection(sectionName) {
        document.querySelectorAll('.admin-nav__link').forEach(link => {
            const isActive = link.dataset.section === sectionName;
            link.classList.toggle('admin-nav__link--active', isActive);
        });

        const activeLink = document.querySelector(`.admin-nav__link[data-section="${sectionName}"]`);
        const activeGroup = activeLink?.closest('.admin-nav__group');
        const allGroups = document.querySelectorAll('.admin-nav__group');
        allGroups.forEach((group) => {
            group.classList.toggle('admin-nav__group--active', group === activeGroup);
        });
        allGroups.forEach((group) => {
            if (group !== activeGroup) setAdminNavGroupExpanded(group, false);
        });

        if (!activeGroup) {
            pendingLinkCollapseGroup = null;
            return;
        }

        const collapseAfterClick = pendingLinkCollapseGroup === activeGroup;
        pendingLinkCollapseGroup = null;
        const shouldExpand = sectionName !== 'dashboard' && !collapseAfterClick;
        setAdminNavGroupExpanded(activeGroup, shouldExpand);
    }

    function bind() {
        bindGroups();
        bindLinkCollapse();
    }

    return {
        bind,
        bindOffset,
        syncActiveSection,
    };
}
