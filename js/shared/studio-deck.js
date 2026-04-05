/* ============================================================
   BITBI — Studio Saved-Images deck + modal
   Reuses the gallery's proven mobile-deck layout, touch-swipe
   handling, dot navigation, and modal/lightbox pattern.
   ============================================================ */

import { setupFocusTrap } from './focus-trap.js';

/* ── Modal (injected once per page) ── */
let modal = null;
let focusTrapCleanup = null;

function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'studioImageModal';
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Image preview');
    modal.innerHTML =
        '<div class="modal-content">' +
            '<div class="modal-card">' +
                '<a class="modal-action modal-action--left studio-modal__open" href="#" target="_blank" rel="noopener noreferrer" aria-label="Open full size image" title="Open full size">' +
                    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
                '</a>' +
                '<button type="button" class="modal-action modal-action--right modal-close" aria-label="Close preview" title="Close">' +
                    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
                '</button>' +
                '<div class="studio-modal__image modal-image"></div>' +
                '<div class="modal-body">' +
                    '<h3 class="studio-modal__title modal-title"></h3>' +
                '</div>' +
            '</div>' +
        '</div>';
    document.body.appendChild(modal);

    /* Close handlers — same pattern as gallery modal */
    modal.querySelector('.modal-close').addEventListener('click', closeStudioModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeStudioModal(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) closeStudioModal();
    });
    return modal;
}

function openStudioModal(imgSrc, title) {
    const m = ensureModal();
    const imgContainer = m.querySelector('.studio-modal__image');
    imgContainer.style.background = '#0D1B2A';
    imgContainer.innerHTML = '';

    const img = new Image();
    img.src = imgSrc;
    img.alt = title || 'Saved image';
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block';
    img.onerror = function () { this.onerror = null; this.alt = 'Image could not be loaded'; };
    imgContainer.appendChild(img);

    m.querySelector('.studio-modal__title').textContent = title || '';

    /* Open-full link */
    const openLink = m.querySelector('.studio-modal__open');
    openLink.href = imgSrc;
    openLink.hidden = false;
    openLink.onclick = (e) => {
        e.stopPropagation();
        window.open(imgSrc, '_blank', 'noopener,noreferrer');
        e.preventDefault();
    };

    m.classList.add('active');
    document.body.style.overflow = 'hidden';
    focusTrapCleanup = setupFocusTrap(m);
}

function closeStudioModal() {
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = '';
    if (focusTrapCleanup) { focusTrapCleanup(); focusTrapCleanup = null; }
}


/* ── Mobile Deck ── */

/**
 * Attach deck behaviour to a studio image grid.
 *
 * @param {HTMLElement} grid   — the .studio__image-grid element
 * @param {object}      opts   — { onItemClick(item, imgEl) }  (optional)
 * @returns {{ refresh(): void, destroy(): void }}
 */
export function initStudioDeck(grid) {
    const mql = window.matchMedia('(max-width: 639px)');
    let active = 0;
    let isDeck = false;
    let dotsEl = null;
    let swipeLock = false;

    /* ── Helpers ── */
    function getCards() {
        return Array.from(grid.children).filter(
            c => c.style.display !== 'none'
              && c.classList.contains('studio__image-item'),
        );
    }

    /* ── Layout (mirrors gallery.js galLayout) ── */
    function layout(skipAnim) {
        const all = getCards();
        const n = all.length;
        all.forEach((c, i) => {
            const d = i - active;
            c.style.transition = skipAnim ? 'none' : '';
            if (d === 0) {
                c.style.transform = 'scale(0.90)';
                c.style.opacity = '1';
                c.style.zIndex = String(n);
                c.style.pointerEvents = '';
            } else if (d === 1) {
                c.style.transform = 'translateX(24px) scale(0.86)';
                c.style.opacity = '0.55';
                c.style.zIndex = String(n - 1);
                c.style.pointerEvents = 'none';
            } else if (d === 2) {
                c.style.transform = 'translateX(42px) scale(0.82)';
                c.style.opacity = '0.3';
                c.style.zIndex = String(n - 2);
                c.style.pointerEvents = 'none';
            } else {
                c.style.transform = d < 0 ? 'translateX(-30px) scale(0.82)' : 'translateX(50px) scale(0.80)';
                c.style.opacity = '0';
                c.style.zIndex = '0';
                c.style.pointerEvents = 'none';
            }
        });
    }

    /* ── Dots (mirrors galBuildDots / galSyncDots) ── */
    function buildDots() {
        if (dotsEl) dotsEl.remove();
        const all = getCards();
        if (all.length <= 1) { dotsEl = null; return; }
        dotsEl = document.createElement('div');
        dotsEl.className = 'studio-deck-dots';
        dotsEl.setAttribute('role', 'tablist');
        dotsEl.setAttribute('aria-label', 'Saved image cards');
        all.forEach((_, i) => {
            const d = document.createElement('button');
            d.type = 'button';
            d.className = 'studio-deck-dot' + (i === active ? ' active' : '');
            d.setAttribute('role', 'tab');
            d.setAttribute('aria-selected', i === active ? 'true' : 'false');
            d.setAttribute('aria-label', `Show image ${i + 1}`);
            d.addEventListener('click', () => { active = i; layout(); syncDots(); });
            dotsEl.appendChild(d);
        });
        grid.after(dotsEl);
    }

    function syncDots() {
        if (!dotsEl) return;
        const dots = dotsEl.querySelectorAll('.studio-deck-dot');
        const all = getCards();
        if (dots.length !== all.length) { buildDots(); return; }
        dots.forEach((d, i) => {
            d.classList.toggle('active', i === active);
            d.setAttribute('aria-selected', i === active ? 'true' : 'false');
        });
    }

    function renderDeck() {
        const cards = getCards();
        active = Math.min(active, Math.max(0, cards.length - 1));
        layout(true);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                getCards().forEach(c => { c.style.transition = ''; });
            });
        });
        buildDots();
    }

    /* ── Engage / Disengage ── */
    function engage() {
        if (isDeck) return;
        isDeck = true;
        active = 0;
        grid.classList.add('studio-deck');
        renderDeck();
    }

    function disengage() {
        if (!isDeck) return;
        isDeck = false;
        grid.classList.remove('studio-deck');
        Array.from(grid.children).forEach(c => {
            c.style.transform = '';
            c.style.opacity = '';
            c.style.zIndex = '';
            c.style.pointerEvents = '';
            c.style.transition = '';
        });
        if (dotsEl) { dotsEl.remove(); dotsEl = null; }
    }

    /* ── Touch handling (mirrors gallery.js touch events) ── */
    let sx, sy, st, tracking, decided, horiz;

    grid.addEventListener('touchstart', e => {
        if (!isDeck) return;
        const t = e.touches[0];
        sx = t.clientX; sy = t.clientY; st = Date.now();
        tracking = true; decided = false; horiz = false;
        swipeLock = false;
        const c = getCards()[active];
        if (c) c.style.transition = 'none';
    }, { passive: true });

    grid.addEventListener('touchmove', e => {
        if (!tracking || !isDeck) return;
        const t = e.touches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        if (!decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
            decided = true;
            horiz = Math.abs(dx) > Math.abs(dy);
            if (!horiz) {
                tracking = false;
                const c = getCards()[active];
                if (c) c.style.transition = '';
                return;
            }
        }
        if (horiz) {
            e.preventDefault();
            const c = getCards()[active];
            if (c) {
                let adj = dx;
                const all = getCards();
                const atBoundary = (active === 0 && dx > 0) || (active >= all.length - 1 && dx < 0);
                if (atBoundary) adj *= 0.25;
                c.style.transform = `translateX(${adj}px) scale(0.90)`;
            }
        }
    }, { passive: false });

    grid.addEventListener('touchend', e => {
        if (!tracking || !isDeck) return;
        tracking = false;
        if (!horiz || !decided) { layout(); return; }
        const dx = e.changedTouches[0].clientX - sx;
        const v = Math.abs(dx) / Math.max(Date.now() - st, 1);
        const all = getCards();
        if ((Math.abs(dx) > 40 || v > 0.3) && Math.abs(dx) > 15) {
            swipeLock = true;
            if (dx < 0 && active < all.length - 1) active++;
            else if (dx > 0 && active > 0) active--;
        }
        layout();
        syncDots();
    }, { passive: true });

    grid.addEventListener('touchcancel', () => {
        if (!tracking || !isDeck) return;
        tracking = false;
        layout();
    }, { passive: true });

    /* Block click after swipe */
    grid.addEventListener('click', e => {
        if (swipeLock) { e.stopPropagation(); e.preventDefault(); swipeLock = false; }
    }, true);

    /* ── Item click → modal ── */
    grid.addEventListener('click', e => {
        const item = e.target.closest('.studio__image-item');
        if (!item) return;
        /* Don't open modal when clicking delete or in selection mode */
        if (e.target.closest('.studio__image-delete')) return;
        if (e.target.closest('.studio__image-check')) return;
        if (grid.dataset.selectMode) return;
        const img = item.querySelector('img');
        if (!img) return;
        openStudioModal(img.src, item.title || img.alt || 'Saved image');
    });

    /* ── Watch for DOM changes (re-render deck on loadGallery) ── */
    const observer = new MutationObserver(() => {
        if (isDeck) renderDeck();
    });
    observer.observe(grid, { childList: true });

    /* ── Media query ── */
    mql.addEventListener('change', e => {
        if (e.matches) engage(); else disengage();
    });
    if (mql.matches) engage();

    return {
        refresh() { if (isDeck) renderDeck(); },
        destroy() {
            observer.disconnect();
            disengage();
        },
    };
}
