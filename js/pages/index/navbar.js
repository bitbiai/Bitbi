/* ============================================================
   BITBI — Navbar scroll handler & mobile toggle
   ============================================================ */

import { setupFocusTrap } from '../../shared/focus-trap.js';

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
    let removeFocusTrap = null;

    function toggle(force) {
        open = force !== undefined ? force : !open;
        panel.classList.toggle('open', open);
        btn.setAttribute('aria-expanded', String(open));
        if (bar1) bar1.style.transform = open ? 'rotate(45deg) translateY(7px)' : '';
        if (bar2) bar2.style.opacity = open ? '0' : '1';
        if (bar3) {
            bar3.style.transform = open ? 'rotate(-45deg) translateY(-7px)' : '';
            bar3.style.width = open ? '24px' : '16px';
        }
        document.body.style.overflow = open ? 'hidden' : '';
        document.documentElement.classList.toggle('menu-open', open);

        if (open) {
            panel.setAttribute('aria-hidden', 'false');
            removeFocusTrap = setupFocusTrap(panel);
        } else {
            panel.setAttribute('aria-hidden', 'true');
            if (removeFocusTrap) { removeFocusTrap(); removeFocusTrap = null; }
            btn.focus();
        }
    }

    btn.addEventListener('click', () => toggle());

    const closeBtn = document.getElementById('mobileNavClose');
    if (closeBtn) closeBtn.addEventListener('click', () => toggle(false));

    // Event delegation for all clickable items in the panel
    panel.addEventListener('click', (e) => {
        const link = e.target.closest('.mobile-nav__link, .mobile-nav__link--primary');
        if (link) {
            toggle(false);
            return;
        }

        const cookieBtn = e.target.closest('#mobileOpenCookieSettings');
        if (cookieBtn) {
            toggle(false);
            const footerCookieBtn = document.getElementById('openCookieSettings');
            if (footerCookieBtn) footerCookieBtn.click();
            return;
        }

        const cta = e.target.closest('.mobile-nav__cta');
        if (cta) {
            toggle(false);
        }
    });

    // Escape key closes
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && open) toggle(false);
    });

}
