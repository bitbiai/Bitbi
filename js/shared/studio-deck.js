/* ============================================================
   BITBI — Saved Assets deck + modal
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
    modal.setAttribute('aria-label', 'Asset preview');
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

function applyModalOpenState() {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    focusTrapCleanup = setupFocusTrap(modal);
}

function resetStudioModalContent() {
    const m = ensureModal();
    const mediaContainer = m.querySelector('.studio-modal__image');
    const openLink = m.querySelector('.studio-modal__open');
    const playingVideo = mediaContainer.querySelector('video');
    if (playingVideo) {
        playingVideo.pause();
        playingVideo.removeAttribute('src');
        playingVideo.load();
    }
    mediaContainer.innerHTML = '';
    mediaContainer.style.background = '#0D1B2A';
    m.classList.remove('studio-modal--video');
    openLink.hidden = false;
    openLink.removeAttribute('hidden');
    openLink.onclick = null;
    return m;
}

export function openStudioImageModal(imgSrc, title, originalUrl = imgSrc) {
    const m = ensureModal();
    const imgContainer = resetStudioModalContent().querySelector('.studio-modal__image');
    m.setAttribute('aria-label', 'Image preview');

    const img = new Image();
    img.src = imgSrc;
    img.alt = title || 'Saved image';
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block';
    img.onerror = function () { this.onerror = null; this.alt = 'Image could not be loaded'; };
    imgContainer.appendChild(img);

    m.querySelector('.studio-modal__title').textContent = title || '';

    /* Open-full link */
    const openLink = m.querySelector('.studio-modal__open');
    openLink.href = originalUrl || imgSrc;
    openLink.hidden = false;
    openLink.onclick = (e) => {
        e.stopPropagation();
        window.open(originalUrl || imgSrc, '_blank', 'noopener,noreferrer');
        e.preventDefault();
    };

    applyModalOpenState();
}

export function openStudioVideoModal({
    videoUrl,
    title,
    posterUrl = '',
} = {}) {
    if (!videoUrl) return;
    const m = ensureModal();
    const mediaContainer = resetStudioModalContent().querySelector('.studio-modal__image');
    const openLink = m.querySelector('.studio-modal__open');
    m.classList.add('studio-modal--video');
    m.setAttribute('aria-label', 'Video preview');
    mediaContainer.style.background = '#000';

    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.className = 'studio-modal__video';
    video.src = videoUrl;
    if (posterUrl) {
        video.poster = posterUrl;
    }
    video.setAttribute('webkit-playsinline', 'true');
    mediaContainer.appendChild(video);

    m.querySelector('.studio-modal__title').textContent = title || 'Saved video';
    openLink.hidden = true;
    openLink.setAttribute('hidden', '');

    applyModalOpenState();
}

function closeStudioModal() {
    if (!modal) return;
    resetStudioModalContent();
    modal.classList.remove('active');
    document.body.style.overflow = '';
    if (focusTrapCleanup) { focusTrapCleanup(); focusTrapCleanup = null; }
}


/* ── Generic Mobile Deck ── */

/**
 * Internal deck factory — shared by image and folder decks.
 * All touch-swipe logic, layout transforms, dot navigation,
 * and engage/disengage lifecycle lives here.
 *
 * @param {HTMLElement} grid
 * @param {object}      opts
 * @param {string}      opts.cardClass  — CSS class that identifies deck cards
 * @param {string}      opts.dotsLabel  — aria-label for dot nav container
 * @param {string}      opts.itemLabel  — label for individual dot buttons
 * @param {Function}    [opts.onClick]  — optional grid click handler (bubbling phase)
 * @returns {{ refresh(): void, destroy(): void, setVisible(v: boolean): void }}
 */
function _createDeck(grid, {
    cardClass,
    dotsLabel,
    itemLabel,
    onClick,
    hideBehind,
    deckClass = 'studio-deck',
    dotsClass = 'studio-deck-dots',
    dotClass = 'studio-deck-dot',
}) {
    const mql = window.matchMedia('(max-width: 639px)');
    let active = 0;
    let isDeck = false;
    let dotsEl = null;
    let swipeLock = false;

    /* ── Helpers ── */
    function getCards() {
        return Array.from(grid.children).filter(
            c => c.style.display !== 'none'
              && c.classList.contains(cardClass),
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
                c.style.opacity = hideBehind ? '0' : '0.55';
                c.style.zIndex = String(n - 1);
                c.style.pointerEvents = 'none';
            } else if (d === 2) {
                c.style.transform = 'translateX(42px) scale(0.82)';
                c.style.opacity = hideBehind ? '0' : '0.3';
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
        dotsEl = null;
        if (grid.offsetParent === null) return;
        const all = getCards();
        if (all.length <= 1) return;
        dotsEl = document.createElement('div');
        dotsEl.className = dotsClass;
        dotsEl.setAttribute('role', 'tablist');
        dotsEl.setAttribute('aria-label', dotsLabel);
        all.forEach((_, i) => {
            const d = document.createElement('button');
            d.type = 'button';
            d.className = dotClass + (i === active ? ' active' : '');
            d.setAttribute('role', 'tab');
            d.setAttribute('aria-selected', i === active ? 'true' : 'false');
            d.setAttribute('aria-label', `Show ${itemLabel} ${i + 1}`);
            d.addEventListener('click', () => { active = i; layout(); syncDots(); });
            dotsEl.appendChild(d);
        });
        grid.after(dotsEl);
    }

    function syncDots() {
        if (!dotsEl) return;
        const dots = dotsEl.querySelectorAll(`.${dotClass}`);
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
        grid.classList.add(deckClass);
        renderDeck();
    }

    function disengage() {
        if (!isDeck) return;
        isDeck = false;
        grid.classList.remove(deckClass);
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

    /* Optional click handler */
    if (onClick) {
        grid.addEventListener('click', e => onClick(e));
    }

    /* ── Watch for DOM changes (re-render deck on content rebuild) ── */
    const observer = new MutationObserver(() => {
        if (isDeck) renderDeck();
    });
    observer.observe(grid, { childList: true });

    /* ── Media query ── */
    const handleMediaChange = (e) => {
        if (e.matches) engage(); else disengage();
    };
    mql.addEventListener('change', handleMediaChange);
    if (mql.matches) engage();

    return {
        refresh() { if (isDeck) renderDeck(); },
        setActive(index) {
            const cards = getCards();
            if (!cards.length) return;
            active = Math.min(Math.max(Number(index) || 0, 0), cards.length - 1);
            layout();
            syncDots();
        },
        destroy() {
            observer.disconnect();
            mql.removeEventListener('change', handleMediaChange);
            disengage();
        },
        setVisible(visible) {
            if (dotsEl) dotsEl.style.display = visible ? '' : 'none';
        },
    };
}


/* ── Mobile Deck — Image grid ── */

/**
 * Attach deck behaviour to a studio image grid.
 *
 * @param {HTMLElement} grid   — the .studio__image-grid element
 * @returns {{ refresh(): void, destroy(): void, setVisible(v: boolean): void }}
 */
export function initStudioDeck(grid) {
    return _createDeck(grid, {
        cardClass: 'studio__image-item',
        dotsLabel: 'Saved image cards',
        itemLabel: 'image',
        onClick(e) {
            const item = e.target.closest('.studio__image-item');
            if (!item) return;
            if (item.dataset.assetType && item.dataset.assetType !== 'image') return;
            if (e.target.closest('a')) return;
            if (e.target.closest('button') && !e.target.closest('.studio__image-delete')) return;
            if (e.target.closest('audio')) return;
            /* Don't open modal when clicking delete or in selection mode */
            if (e.target.closest('.studio__image-delete')) return;
            if (e.target.closest('.studio__image-check')) return;
            if (grid.dataset.selectMode) return;
            const previewUrl = item.dataset.previewUrl || item.dataset.originalUrl;
            const originalUrl = item.dataset.originalUrl || previewUrl;
            const img = item.querySelector('img');
            const title = item.title || img?.alt || 'Saved image';
            if (!previewUrl) return;
            openStudioImageModal(previewUrl, title, originalUrl);
        },
    });
}


/* ── Mobile Deck — Folder grid ── */

/**
 * Attach deck behaviour to the studio folder grid (mobile only).
 * Folder cards keep their own click handlers (from showFolderView);
 * the swipeLock capturing handler blocks accidental clicks after swipe.
 *
 * @param {HTMLElement} grid   — the .studio__folder-grid element
 * @returns {{ refresh(): void, destroy(): void, setVisible(v: boolean): void }}
 */
export function initStudioFolderDeck(grid) {
    return _createDeck(grid, {
        cardClass: 'studio__folder-card',
        dotsLabel: 'Folder cards',
        itemLabel: 'folder',
        hideBehind: true,
    });
}

/**
 * Attach the shared mobile card-deck behaviour to any card grid.
 * Used by homepage sections that need the same swipe stack pattern.
 *
 * @param {HTMLElement} grid
 * @param {object} options
 * @returns {{ refresh(): void, destroy(): void, setVisible(v: boolean): void }}
 */
export function initMobileCardDeck(grid, options) {
    return _createDeck(grid, options);
}
