/* ============================================================
   BITBI — Mobile nav toggle
   Shared module — used by index.html and all subpages
   ============================================================ */

import { setupFocusTrap } from './focus-trap.js';


export function initMobileNav() {
    const btn = document.getElementById('mobileMenuBtn');
    const panel = document.getElementById('mobileNav');
    const bar1 = document.getElementById('bar1');
    const bar2 = document.getElementById('bar2');
    const bar3 = document.getElementById('bar3');
    if (!btn || !panel) return;

    const backdrop = document.getElementById('frozenBackdrop');
    const rainLayer = document.getElementById('frozenRainLayer');
    let open = false;
    let removeFocusTrap = null;
    let heroObjectUrl = null;
    let rainObjectUrl = null;
    let captureGen = 0;
    let settleTimer = null;
    let closeInteractionGuardUntil = 0;

    const CLOSE_INTERACTION_GUARD_MS = 420;

    panel.dataset.state = 'closed';

    function parseTransitionTimeList(value) {
        return String(value || '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => {
                if (part.endsWith('ms')) return Number.parseFloat(part);
                if (part.endsWith('s')) return Number.parseFloat(part) * 1000;
                const parsed = Number.parseFloat(part);
                return Number.isFinite(parsed) ? parsed : 0;
            });
    }

    function clearSettleTimer() {
        if (settleTimer !== null) {
            window.clearTimeout(settleTimer);
            settleTimer = null;
        }
    }

    function finalizePanelState(expectedOpen) {
        if (open !== expectedOpen) return;
        panel.dataset.state = expectedOpen ? 'open' : 'closed';
        clearSettleTimer();
    }

    function armCloseInteractionGuard() {
        closeInteractionGuardUntil = Date.now() + CLOSE_INTERACTION_GUARD_MS;
    }

    function shouldSuppressOutsideInteraction(event) {
        if (Date.now() > closeInteractionGuardUntil) return false;
        const target = event.target;
        if (!(target instanceof Element)) return true;
        if (panel.contains(target) || btn.contains(target)) return false;
        return true;
    }

    function suppressOutsideInteraction(event) {
        if (!shouldSuppressOutsideInteraction(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }
    }

    document.addEventListener('touchend', suppressOutsideInteraction, true);
    document.addEventListener('click', suppressOutsideInteraction, true);

    function schedulePanelStateSync(expectedOpen) {
        clearSettleTimer();

        const styles = window.getComputedStyle(panel);
        const durations = parseTransitionTimeList(styles.transitionDuration);
        const delays = parseTransitionTimeList(styles.transitionDelay);
        const total = durations.reduce((max, duration, index) => (
            Math.max(max, duration + (delays[index] || delays[0] || 0))
        ), 0);

        if (total <= 0) {
            requestAnimationFrame(() => finalizePanelState(expectedOpen));
            return;
        }

        settleTimer = window.setTimeout(() => finalizePanelState(expectedOpen), total + 50);
    }

    function captureBackdrop() {
        if (!backdrop) return;
        const heroCanvas = document.getElementById('heroCanvas');
        if (!heroCanvas) return;
        const gen = ++captureGen;
        try {
            const w = heroCanvas.width || window.innerWidth;
            const h = heroCanvas.height || window.innerHeight;

            /* ── Canvas 1: hero + subdued glows (will be CSS-blurred) ── */
            const comp = document.createElement('canvas');
            comp.width = w;
            comp.height = h;
            const ctx = comp.getContext('2d');

            /* Hero particles & nebulae */
            ctx.drawImage(heroCanvas, 0, 0, w, h);

            /* Ambient glows — reduced intensity so they don't dominate */
            const addGlow = (gx, gy, gr, color) => {
                const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
                g.addColorStop(0, color);
                g.addColorStop(1, 'transparent');
                ctx.fillStyle = g;
                ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
            };
            addGlow(w * 0.15, h * 0.15, w * 0.45, 'rgba(0,240,255,0.04)');
            addGlow(w * 0.85, h * 0.75, w * 0.35, 'rgba(255,179,0,0.035)');
            addGlow(w * 0.50, h * 0.50, w * 0.55, 'rgba(200,50,200,0.02)');
            addGlow(w * 0.50, h * 0.30, w * 0.40, 'rgba(255,255,255,0.025)');

            comp.toBlob((blob) => {
                if (gen !== captureGen || !blob) return;
                if (heroObjectUrl) URL.revokeObjectURL(heroObjectUrl);
                heroObjectUrl = URL.createObjectURL(blob);
                backdrop.style.backgroundImage = [
                    'linear-gradient(rgba(10,10,10,0.25), rgba(10,10,10,0.25))',
                    'linear-gradient(180deg, rgba(10,10,10,0.55) 0%, rgba(8,14,22,0.10) 30%, rgba(8,14,22,0.06) 60%, rgba(10,10,10,0.45) 100%)',
                    `url(${heroObjectUrl})`
                ].join(', ');
            }, 'image/jpeg', 0.85);

            /* ── Canvas 2: binary rain streaks only (separate, barely blurred) ── */
            if (!rainLayer) return;
            const rain = document.createElement('canvas');
            rain.width = w;
            rain.height = h;
            const rc = rain.getContext('2d');

            let cx = 8;
            while (cx < w - 8) {
                /* skip some columns for organic spacing */
                if (Math.random() < 0.12) { cx += 18 + Math.random() * 24; continue; }

                const streakH = h * (0.40 + Math.random() * 0.50);
                const startY  = Math.random() * (h - streakH * 0.5);
                const alpha   = 0.12 + Math.random() * 0.18;
                const lineW   = 1.2 + Math.random() * 0.8;

                /* main streak */
                const grad = rc.createLinearGradient(cx, startY, cx, startY + streakH);
                grad.addColorStop(0, 'transparent');
                grad.addColorStop(0.08, `rgba(0,240,255,${alpha * 0.5})`);
                grad.addColorStop(0.25, `rgba(0,240,255,${alpha})`);
                grad.addColorStop(0.55, `rgba(0,240,255,${alpha * 0.9})`);
                grad.addColorStop(0.80, `rgba(0,240,255,${alpha * 0.4})`);
                grad.addColorStop(1, 'transparent');
                rc.fillStyle = grad;
                rc.fillRect(cx - lineW / 2, startY, lineW, streakH);

                /* subtle glow halo around each streak for premium softness */
                const halo = rc.createLinearGradient(cx, startY, cx, startY + streakH);
                halo.addColorStop(0, 'transparent');
                halo.addColorStop(0.25, `rgba(0,240,255,${alpha * 0.12})`);
                halo.addColorStop(0.55, `rgba(0,240,255,${alpha * 0.10})`);
                halo.addColorStop(1, 'transparent');
                rc.fillStyle = halo;
                rc.fillRect(cx - 4, startY, 8, streakH);

                cx += 10 + Math.random() * 14;
            }

            rain.toBlob((blob) => {
                if (gen !== captureGen || !blob) return;
                if (rainObjectUrl) URL.revokeObjectURL(rainObjectUrl);
                rainObjectUrl = URL.createObjectURL(blob);
                rainLayer.style.backgroundImage = [
                    'linear-gradient(180deg, rgba(10,10,10,0.3) 0%, transparent 15%, transparent 85%, rgba(10,10,10,0.3) 100%)',
                    `url(${rainObjectUrl})`
                ].join(', ');
            }, 'image/png');

        } catch (_) { /* canvas tainted or unavailable — backdrop stays empty */ }
    }

    function clearBackdrop() {
        captureGen++;
        if (backdrop) backdrop.style.backgroundImage = '';
        if (rainLayer) rainLayer.style.backgroundImage = '';
        if (heroObjectUrl) { URL.revokeObjectURL(heroObjectUrl); heroObjectUrl = null; }
        if (rainObjectUrl) { URL.revokeObjectURL(rainObjectUrl); rainObjectUrl = null; }
    }

    const BAR_OFFSET_Y = '7px';

    function toggle(force) {
        const nextOpen = force !== undefined ? force : !open;
        if (nextOpen === open) return;
        open = nextOpen;

        if (open) captureBackdrop();
        if (!open) armCloseInteractionGuard();

        panel.dataset.state = open ? 'opening' : 'closing';
        panel.classList.toggle('open', open);
        schedulePanelStateSync(open);
        btn.setAttribute('aria-expanded', String(open));
        if (bar1) bar1.style.transform = open ? `rotate(45deg) translateY(${BAR_OFFSET_Y})` : '';
        if (bar2) bar2.style.opacity = open ? '0' : '1';
        if (bar3) {
            bar3.style.transform = open ? `rotate(-45deg) translateY(-${BAR_OFFSET_Y})` : '';
            bar3.style.width = open ? '24px' : '16px';
        }
        if (open) {
            document.body.style.overflow = 'hidden';
        } else {
            const authModal = document.querySelector('.auth-modal__overlay.active, .modal-overlay.active');
            if (!authModal) document.body.style.overflow = '';
        }
        document.documentElement.classList.toggle('menu-open', open);
        document.dispatchEvent(new CustomEvent('bitbi:mobile-nav-toggle', {
            detail: { open },
        }));

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

    panel.addEventListener('transitionend', (event) => {
        if (event.target !== panel || event.propertyName !== 'transform') return;
        finalizePanelState(open);
    });

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

    // Close menu when crossing into desktop width
    const desktopMQ = window.matchMedia('(min-width: 1024px)');
    desktopMQ.addEventListener('change', (e) => {
        if (e.matches && open) toggle(false);
    });

}
