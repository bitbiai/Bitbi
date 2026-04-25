/* ============================================================
   BITBI — Contact form handler
   ============================================================ */

export function initContact() {
    const section = document.getElementById('contact');
    const form = document.getElementById('contactForm');
    const trigger = document.getElementById('contactDrawerTrigger');
    const panel = document.getElementById('contactDrawerPanel');
    const drawer = section?.classList.contains('contact-drawer')
        ? section
        : section?.querySelector('.contact-drawer');
    const footer = document.querySelector('.site-footer');
    const panelInner = panel?.querySelector('.contact-drawer__panel-inner');
    if (!form) return;

    let isOpen = false;

    function setCollapsedState(collapsed) {
        if (!panelInner) return;
        if (collapsed) {
            panelInner.setAttribute('inert', '');
            return;
        }
        panelInner.removeAttribute('inert');
    }

    function clearFooterSpacer() {
        document.documentElement.style.removeProperty('--contact-drawer-footer-spacer');
    }

    function getDefaultFooterSpacer() {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        if (window.matchMedia?.('(min-width: 1024px)').matches) {
            return Math.max(192, viewportHeight * 0.36);
        }
        return Math.max(128, viewportHeight * 0.24);
    }

    function syncFooterSpacer(buffer = 24) {
        if (!section || !footer) return;
        const nav = document.getElementById('navbar');
        const navBottom = nav?.getBoundingClientRect().bottom || 0;
        const scrollAnchor = getScrollAnchor();
        const delta = Math.max(0, (scrollAnchor || section).getBoundingClientRect().top - navBottom);
        const spacer = Math.max(getDefaultFooterSpacer(), delta + buffer);
        document.documentElement.style.setProperty('--contact-drawer-footer-spacer', `${Math.ceil(spacer)}px`);
    }

    function setOpen(nextOpen, { focusTrigger = false } = {}) {
        if (!trigger || !panel || !drawer) return;
        isOpen = !!nextOpen;
        drawer.classList.toggle('is-open', isOpen);
        document.body.classList.toggle('contact-drawer-open', isOpen);
        if (isOpen) {
            syncFooterSpacer();
        } else {
            clearFooterSpacer();
        }
        trigger.setAttribute('aria-expanded', String(isOpen));
        panel.setAttribute('aria-hidden', String(!isOpen));
        setCollapsedState(!isOpen);

        if (!isOpen && focusTrigger && panel.contains(document.activeElement)) {
            trigger.focus({ preventScroll: true });
        }
    }

    function getScrollAnchor() {
        if (!section) return null;
        return section.previousElementSibling?.classList.contains('section-divider')
            ? section.previousElementSibling
            : section;
    }

    function scrollSectionIntoView(behavior = 'auto') {
        if (!section) return;
        const scrollAnchor = getScrollAnchor();
        const nav = document.getElementById('navbar');
        if (!scrollAnchor || !nav) {
            section.scrollIntoView({
                behavior,
                block: 'start',
            });
            return;
        }

        const targetTop = window.scrollY + scrollAnchor.getBoundingClientRect().top - nav.getBoundingClientRect().bottom;
        window.scrollTo({
            top: Math.max(0, targetTop),
            behavior,
        });
    }

    function getAnchorAlignmentDelta() {
        const scrollAnchor = getScrollAnchor();
        const nav = document.getElementById('navbar');
        if (!scrollAnchor || !nav) return 0;
        return scrollAnchor.getBoundingClientRect().top - nav.getBoundingClientRect().bottom;
    }

    function stabilizeContactAlignment() {
        const started = performance.now();
        const step = () => {
            if (!isOpen) return;
            const delta = getAnchorAlignmentDelta();
            if (Math.abs(delta) > 2) {
                syncFooterSpacer(48);
                scrollSectionIntoView('auto');
            }
            if (performance.now() - started < 1200) {
                requestAnimationFrame(step);
            }
        };
        requestAnimationFrame(step);
    }

    function getPreferredScrollBehavior() {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    }

    function openForContactAnchor({ behavior = 'auto' } = {}) {
        if (!trigger || !panel || !drawer) return;
        setOpen(true);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                scrollSectionIntoView(behavior);
                stabilizeContactAlignment();
            });
        });
    }

    if (trigger && panel && drawer && panelInner) {
        setOpen(false);

        trigger.addEventListener('click', () => {
            setOpen(!isOpen);
        });

        document.querySelectorAll('a[href="#contact"]').forEach((anchor) => {
            anchor.addEventListener('click', (event) => {
                event.preventDefault();
                openForContactAnchor({ behavior: getPreferredScrollBehavior() });
            });
        });

        window.addEventListener('hashchange', () => {
            if (window.location.hash === '#contact') {
                openForContactAnchor({ behavior: 'auto' });
            }
        });

        if (window.location.hash === '#contact') {
            openForContactAnchor({ behavior: 'auto' });
        }
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Sending...';
        try {
            const res = await fetch('https://contact.bitbi.ai/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(10000),
                body: JSON.stringify({
                    name: form.name.value,
                    email: form.email.value,
                    subject: form.subject.value,
                    message: form.message.value,
                    website: form.website.value
                })
            });
            if (!res.ok) throw new Error('Failed');
            btn.textContent = 'Sent!';
            form.reset();
            setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
        } catch {
            btn.textContent = 'Error - try again';
            btn.disabled = false;
            setTimeout(() => { btn.textContent = orig; }, 3000);
        }
    });
}
