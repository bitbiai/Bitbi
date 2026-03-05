/* ============================================================
   BITBI — Navbar scroll handler & mobile toggle
   ============================================================ */

export function initNavbar() {
    const nav = document.getElementById('navbar');
    if (!nav) return;

    let ticking = false;
    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(() => {
                nav.classList.toggle('glass-nav', window.scrollY > 60);
                ticking = false;
            });
            ticking = true;
        }
    });
}

export function initMobileNav() {
    const btn = document.getElementById('mobileMenuBtn');
    const panel = document.getElementById('mobileNav');
    const bar1 = document.getElementById('bar1');
    const bar2 = document.getElementById('bar2');
    const bar3 = document.getElementById('bar3');
    if (!btn || !panel) return;

    let open = false;

    function toggle(force) {
        open = force !== undefined ? force : !open;
        panel.classList.toggle('open', open);
        if (bar1) bar1.style.transform = open ? 'rotate(45deg) translateY(7px)' : '';
        if (bar2) bar2.style.opacity = open ? '0' : '1';
        if (bar3) {
            bar3.style.transform = open ? 'rotate(-45deg) translateY(-7px)' : '';
            bar3.style.width = open ? '24px' : '16px';
        }
        document.body.style.overflow = open ? 'hidden' : '';

        if (open) {
            panel.setAttribute('aria-hidden', 'false');
        } else {
            panel.setAttribute('aria-hidden', 'true');
        }
    }

    btn.addEventListener('click', () => toggle());
    panel.querySelectorAll('.mobile-nav__link, .mobile-nav__cta').forEach(link => {
        link.addEventListener('click', () => toggle(false));
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && open) toggle(false);
    });
}
