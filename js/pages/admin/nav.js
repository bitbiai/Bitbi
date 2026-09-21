// Inline SVG follows the existing admin icon pattern; destinations stay real links.
const SECTION_ICONS = {
    dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-3.87',
    orgs: 'M4 21V3h12v18 M16 9h4v12 M8 7h4 M8 11h4 M8 15h4 M8 21v-2h4v2',
    billing: 'M3 5h18v14H3z M3 10h18 M6 15h3',
    'billing-events': 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 7h6 M9 11h6 M9 15h3',
    'model-pricing': 'M3 5h18v14H3z M3 10h18 M7 15h3 M16 13v4 M14 15h4',
    'model-status': 'M3 12h4l3-8 4 16 3-8h4',
    'ai-lab': 'M9 3h6 M10 3v6l-6 10a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3 M8 15h8',
    'fable-data-center': 'M3 4h18v13H9l-6 4z M7 8h10 M7 12h6',
    newsfeed: 'M4 3h16v18H4z M8 7h8 M8 11h8 M8 15h3 M14 15h2 M8 18h8',
    'news-feed-agent': 'M4 4h10v16H4z M8 8h3 M8 12h2 M15 6l3-3 3 3-8 8-4 1 1-4z',
    'homepage-hero-videos': 'M3 5h18v14H3z M10 9l5 3-5 3z',
    'ai-usage': 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
    'ai-budget-switches': 'M3 6h18 M3 12h18 M3 18h18 M8 3v6 M16 9v6 M10 15v6',
    'object-storage': 'M3 6h6l2 3h10v11H3z M3 6V4h6l2 2h10v3',
    lifecycle: 'M4 9a8 8 0 1 1 0 7 M4 3v6h6 M12 7v5l3 2',
    activity: 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5',
    operations: 'M3 5h18v12H3z M8 21h8 M12 17v4 M6 11h3l2-3 3 6 2-3h2',
    'tenant-assets': 'M12 3l8 4v6c0 4-8 8-8 8s-8-4-8-8V7z M8 12l3 3 5-6',
    security: 'M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3',
    'live-billing': 'M3 5h18v14H3z M3 9h18 M13 14l2 2 4-4',
};
function addSectionIcons() {
    for (const link of document.querySelectorAll('#adminNav a[data-section]')) {
        const path = SECTION_ICONS[link.dataset.section];
        if (!path || link.querySelector('svg')) continue;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('admin-nav__icon');
        for (const [key, value] of Object.entries({ viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', 'stroke-width':'1.5', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true', focusable:'false' })) svg.setAttribute(key,value);
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        shape.setAttribute('d', path); svg.append(shape); link.prepend(svg);
    }
}

function setAdminNavGroupExpanded(group, expanded) {
    const toggle = group.querySelector('.admin-nav__group-toggle');
    if (!toggle) return;
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    group.classList.toggle('admin-nav__group--expanded', expanded);
}

export function createAdminNav() {
    let offsetObserver = null;
    let offsetFrame = 0;

    function syncOffset() {
        const siteNav = document.querySelector('header .site-nav');
        if (!siteNav) return;

        const navHeight = Math.ceil(siteNav.getBoundingClientRect().height);
        if (navHeight > 0 && document.documentElement.style.getPropertyValue('--admin-nav-top-offset') !== `${navHeight}px`) {
            document.documentElement.style.setProperty('--admin-nav-top-offset', `${navHeight}px`);
        }
    }

    function scheduleOffset() {
        if (offsetFrame) return;
        offsetFrame = requestAnimationFrame(() => { offsetFrame = 0; syncOffset(); });
    }

    function bindOffset() {
        syncOffset();

        const siteNav = document.querySelector('header .site-nav');
        if (siteNav && 'ResizeObserver' in window) {
            offsetObserver?.disconnect?.();
            offsetObserver = new ResizeObserver(scheduleOffset);
            offsetObserver.observe(siteNav);
        }

        window.addEventListener('resize', scheduleOffset);
        window.visualViewport?.addEventListener?.('resize', scheduleOffset);
    }

    const mobile = () => window.matchMedia('(max-width: 899px)').matches;
    const nav = () => document.getElementById('adminNav');
    const toggle = () => document.getElementById('adminNavToggle');
    function setOpen(open, restore = false) {
        nav()?.classList.toggle('admin-nav--open', open);
        toggle()?.setAttribute('aria-expanded', String(open));
        if (restore) toggle()?.focus();
    }
    function filterSections() {
        const query = document.getElementById('adminNavSearch')?.value.trim().toLowerCase() || '';
        let matches = 0;
        nav()?.querySelectorAll('.admin-nav__group').forEach(group => {
            let groupMatches = 0;
            for (const link of group.querySelectorAll('a[data-section]')) {
                link.hidden = !!query && !link.textContent.toLowerCase().includes(query);
                if (!link.hidden) groupMatches += 1;
            }
            group.hidden = groupMatches === 0;
            matches += groupMatches;
            if (query && groupMatches) setAdminNavGroupExpanded(group, true);
        });
        const empty = document.getElementById('adminNavSearchEmpty');
        if (empty) empty.hidden = !query || matches > 0;
    }
    function clearSearch() {
        const search = document.getElementById('adminNavSearch');
        if (search?.value) { search.value = ''; filterSections(); }
    }
    function bind() {
        addSectionIcons();
        const search = document.getElementById('adminNavSearch');
        search?.addEventListener('input', filterSections);
        search?.addEventListener('keydown', event => {
            if (event.key === 'Escape' && search.value) { event.preventDefault(); event.stopPropagation(); clearSearch(); }
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                const target = nav()?.querySelector('.admin-nav__group:not([hidden]) a:not([hidden])');
                const group = target?.closest('.admin-nav__group');
                if (group) setAdminNavGroupExpanded(group, true);
                target?.focus();
            }
        });
        document.addEventListener('pointerdown', event => {
            if (mobile() && !nav()?.contains(event.target) && !toggle()?.contains(event.target)) setOpen(false);
        });
        toggle()?.addEventListener('click', () => setOpen(toggle().getAttribute('aria-expanded') !== 'true'));
        document.querySelectorAll('.admin-nav__group-toggle').forEach(button => {
            button.addEventListener('click', () => setAdminNavGroupExpanded(button.closest('.admin-nav__group'), button.getAttribute('aria-expanded') !== 'true'));
        });
        nav()?.addEventListener('click', event => {
            if (event.target.closest('a') && mobile()) setOpen(false);
        });
        nav()?.addEventListener('keydown', event => {
            if (event.key === 'Escape' && mobile()) { event.preventDefault(); setOpen(false, true); return; }
            const group = event.target.closest('.admin-nav__group');
            const button = group?.querySelector('.admin-nav__group-toggle');
            if (!button) return;
            if (event.key === 'Escape') {
                event.preventDefault(); setAdminNavGroupExpanded(group, false); button.focus();
            } else if (event.target === button && event.key === 'ArrowDown') {
                event.preventDefault(); setAdminNavGroupExpanded(group, true); group.querySelector('a:not([hidden])')?.focus();
            } else if (event.target === button && ['Home','End'].includes(event.key)) {
                event.preventDefault();
                const buttons = [...nav().querySelectorAll('.admin-nav__group:not([hidden]) .admin-nav__group-toggle')];
                buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus();
            }
        });
        window.addEventListener('resize', () => { if (!mobile()) setOpen(false); });
    }
    function syncActiveSection(sectionName) {
        clearSearch();
        document.querySelectorAll('.admin-nav__link').forEach(link => {
            const active = link.dataset.section === sectionName;
            link.classList.toggle('admin-nav__link--active', active);
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
        const active = Array.from(document.querySelectorAll('.admin-nav__link')).find(link => link.dataset.section === sectionName);
        const group = active?.closest('.admin-nav__group');
        if (group) setAdminNavGroupExpanded(group, true);
        document.querySelectorAll('.admin-nav__group').forEach(item => item.classList.toggle('admin-nav__group--active', item === group));
    }
    return { bind, bindOffset, syncActiveSection };
}
