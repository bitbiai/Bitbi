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

            /* Layer 2 — ambient glows baked into canvas (survive JPEG) */
            const addGlow = (gx, gy, gr, color) => {
                const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
                g.addColorStop(0, color);
                g.addColorStop(1, 'transparent');
                ctx.fillStyle = g;
                ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
            };
            addGlow(w * 0.15, h * 0.15, w * 0.55, 'rgba(0,240,255,0.07)');
            addGlow(w * 0.85, h * 0.75, w * 0.45, 'rgba(255,179,0,0.06)');
            addGlow(w * 0.50, h * 0.50, w * 0.70, 'rgba(200,50,200,0.035)');
            addGlow(w * 0.50, h * 0.30, w * 0.50, 'rgba(255,255,255,0.04)');

            /* Layer 3 — binary rain as vertical streak lines */
            let cx = 6;
            while (cx < w - 6) {
                if (Math.random() < 0.10) { cx += 14 + Math.random() * 20; continue; }
                const streakH = h * (0.25 + Math.random() * 0.55);
                const startY = Math.random() * (h - streakH * 0.3);
                const a = 0.06 + Math.random() * 0.14;
                const lineW = 1.5 + Math.random() * 1;
                const grad = ctx.createLinearGradient(cx, startY, cx, startY + streakH);
                grad.addColorStop(0, 'transparent');
                grad.addColorStop(0.15, `rgba(0,240,255,${a})`);
                grad.addColorStop(0.5, `rgba(0,240,255,${a * 1.2})`);
                grad.addColorStop(0.85, `rgba(0,240,255,${a * 0.7})`);
                grad.addColorStop(1, 'transparent');
                ctx.fillStyle = grad;
                ctx.fillRect(cx - lineW / 2, startY, lineW, streakH);
                cx += 12 + Math.random() * 16;
            }

            const dataUrl = comp.toDataURL('image/jpeg', 0.85);
            backdrop.style.backgroundImage = [
                'linear-gradient(rgba(10,10,10,0.22), rgba(10,10,10,0.22))',
                'linear-gradient(180deg, rgba(10,10,10,0.55) 0%, rgba(8,14,22,0.12) 30%, rgba(8,14,22,0.08) 60%, rgba(10,10,10,0.45) 100%)',
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
