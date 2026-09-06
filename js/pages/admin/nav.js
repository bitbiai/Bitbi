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
    function bind() {
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
                event.preventDefault(); setAdminNavGroupExpanded(group, true); group.querySelector('a')?.focus();
            } else if (event.target === button && ['Home','End'].includes(event.key)) {
                event.preventDefault();
                const buttons = [...nav().querySelectorAll('.admin-nav__group-toggle')];
                buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus();
            }
        });
        window.addEventListener('resize', () => { if (!mobile()) setOpen(false); });
    }
    function syncActiveSection(sectionName) {
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
