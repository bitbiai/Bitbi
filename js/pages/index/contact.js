/* ============================================================
   BITBI — Contact form handler
   ============================================================ */

export function initContact() {
    const section = document.getElementById('contact');
    const form = document.getElementById('contactForm');
    const trigger = document.getElementById('contactDrawerTrigger');
    const panel = document.getElementById('contactDrawerPanel');
    const drawer = section?.querySelector('.contact-drawer');
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

    function setOpen(nextOpen, { focusTrigger = false } = {}) {
        if (!trigger || !panel || !drawer) return;
        isOpen = !!nextOpen;
        drawer.classList.toggle('is-open', isOpen);
        document.body.classList.toggle('contact-drawer-open', isOpen);
        trigger.setAttribute('aria-expanded', String(isOpen));
        panel.setAttribute('aria-hidden', String(!isOpen));
        setCollapsedState(!isOpen);

        if (!isOpen && focusTrigger && panel.contains(document.activeElement)) {
            trigger.focus({ preventScroll: true });
        }
    }

    function scrollSectionIntoView(behavior = 'auto') {
        if (!section) return;
        section.scrollIntoView({
            behavior,
            block: 'start',
        });
    }

    function getPreferredScrollBehavior() {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    }

    function openForContactAnchor({ behavior = 'auto' } = {}) {
        if (!trigger || !panel || !drawer) return;
        setOpen(true);
        requestAnimationFrame(() => {
            scrollSectionIntoView(behavior);
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
