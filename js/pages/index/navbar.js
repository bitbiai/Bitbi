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

    const backdrop = document.getElementById('frozenBackdrop');
    let open = false;
    let removeFocusTrap = null;

    function captureBackdrop() {
        if (!backdrop) return;
        const heroCanvas = document.getElementById('heroCanvas');
        if (!heroCanvas) return;
        try {
            const w = heroCanvas.width || window.innerWidth;
            const h = heroCanvas.height || window.innerHeight;

            /* Composite canvas: hero particles + frozen binary rain */
            const comp = document.createElement('canvas');
            comp.width = w;
            comp.height = h;
            const ctx = comp.getContext('2d');

            /* Layer 1 — hero particles & nebulae */
            ctx.drawImage(heroCanvas, 0, 0, w, h);

            /* Layer 2 — frozen binary rain (larger, denser than page version) */
            const fontSize = 13;
            ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
            const colWidth = 24;
            const colCount = Math.floor(w / colWidth);
            for (let i = 0; i < colCount; i++) {
                const x = (i + 0.3) * colWidth;
                const a = 0.04 + Math.random() * 0.06;
                ctx.fillStyle = `rgba(0,240,255,${a})`;
                let y = fontSize + Math.random() * fontSize * 3;
                while (y < h + fontSize) {
                    ctx.fillText(Math.random() > 0.5 ? '1' : '0', x, y);
                    y += fontSize * 1.15;
                }
            }

            const dataUrl = comp.toDataURL('image/jpeg', 0.85);
            backdrop.style.backgroundImage = [
                'linear-gradient(rgba(10,10,10,0.30), rgba(10,10,10,0.30))',
                'radial-gradient(ellipse at 15% 20%, rgba(0,240,255,0.08), transparent 50%)',
                'radial-gradient(ellipse at 85% 80%, rgba(255,179,0,0.09), transparent 45%)',
                'radial-gradient(ellipse at 50% 50%, rgba(200,50,200,0.05), transparent 40%)',
                'linear-gradient(180deg, rgba(10,10,10,0.7) 0%, rgba(13,27,42,0.35) 40%, rgba(13,27,42,0.2) 60%, rgba(10,10,10,0.7) 100%)',
                `url(${dataUrl})`
            ].join(', ');
        } catch (_) { /* canvas tainted or unavailable — backdrop stays empty */ }
    }

    function clearBackdrop() {
        if (!backdrop) return;
        backdrop.style.backgroundImage = '';
    }

    function toggle(force) {
        open = force !== undefined ? force : !open;

        if (open) captureBackdrop();

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
            clearBackdrop();
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
