/* ============================================================
   BITBI — Video gallery (Memvids) rendering + modal player
   Mirrors gallery.js pattern for the Video Creations section
   ============================================================ */

import { setupFocusTrap } from '../../shared/focus-trap.js';
import { createStarButton } from '../../shared/favorites.js';
import { initMobileCardDeck } from '../../shared/studio-deck.js?v=__ASSET_VERSION__';

const MEMVIDS_LIMIT = 60;

let focusTrapCleanup = null;

export function initVideoGallery() {
    const container = document.getElementById('videoExplore');
    if (!container) return;

    let memvidsPromise = null;

    /* Replace the teaser placeholder with a live grid */
    container.innerHTML = '';

    const grid = document.createElement('div');
    grid.id = 'videoGrid';
    grid.className = 'grid-video';
    container.appendChild(grid);
    const deck = initMobileCardDeck(grid, {
        cardClass: 'video-card',
        dotsLabel: 'Video cards',
        itemLabel: 'video',
        deckClass: 'vid-deck',
        dotsClass: 'vid-deck-dots',
        dotClass: 'vid-deck-dot',
    });

    /* ── Modal ── */
    const modal = buildVideoModal();
    document.body.appendChild(modal.root);

    function renderState(message) {
        const el = document.createElement('div');
        el.className = 'video-empty-state';
        el.textContent = message;
        grid.appendChild(el);
    }

    async function fetchMemvids() {
        if (memvidsPromise) return memvidsPromise;
        memvidsPromise = (async () => {
            try {
                const res = await fetch(`/api/gallery/memvids?limit=${MEMVIDS_LIMIT}`, {
                    credentials: 'same-origin',
                });
                const data = await res.json().catch(() => null);
                if (!res.ok) {
                    throw new Error(data?.error || `Error ${res.status}`);
                }
                return Array.isArray(data?.data?.items) ? data.data.items : [];
            } catch (error) {
                console.warn('memvids:', error);
                throw error;
            } finally {
                memvidsPromise = null;
            }
        })();
        return memvidsPromise;
    }

    function buildVideoCard(item) {
        const card = document.createElement('div');
        card.className = 'video-card';
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', item.title || 'Video');

        const inner = document.createElement('div');
        inner.className = 'video-card__inner rounded-xl overflow-hidden relative';

        /* Poster area — generated thumbnail or gradient fallback */
        const poster = document.createElement('div');
        poster.className = 'video-card__poster';

        if (item.poster) {
            const img = document.createElement('img');
            img.className = 'video-card__preview';
            img.src = item.poster.url;
            img.alt = item.title || 'Video thumbnail';
            img.loading = 'lazy';
            img.decoding = 'async';
            if (item.poster.w) img.width = item.poster.w;
            if (item.poster.h) img.height = item.poster.h;
            poster.appendChild(img);
        }

        const playIcon = document.createElement('div');
        playIcon.className = 'video-card__play';
        playIcon.setAttribute('aria-hidden', 'true');
        playIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        poster.appendChild(playIcon);

        const star = createStarButton('video', item.id, {
            title: item.title || 'Video',
            thumb_url: item.poster?.url || '',
        });
        star.style.cssText = 'position:absolute;top:8px;right:8px';
        poster.appendChild(star);

        inner.appendChild(poster);

        /* Info overlay */
        const info = document.createElement('div');
        info.className = 'video-card__info';

        const title = document.createElement('h4');
        title.className = 'video-card__title';
        title.textContent = item.title || 'Memvids';
        info.appendChild(title);

        const caption = document.createElement('p');
        caption.className = 'video-card__caption';
        caption.textContent = item.caption || '';
        info.appendChild(caption);

        inner.appendChild(info);
        card.appendChild(inner);

        card.addEventListener('click', () => openVideoModal(item));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openVideoModal(item);
            }
        });

        return card;
    }

    async function render() {
        grid.innerHTML = '';
        renderState('Loading Memvids\u2026');

        let items;
        try {
            items = await fetchMemvids();
        } catch {
            grid.innerHTML = '';
            renderState('Could not load Memvids right now.');
            return;
        }

        grid.innerHTML = '';

        if (!items.length) {
            renderState('No Memvids published yet.');
            return;
        }

        items.forEach((item) => {
            grid.appendChild(buildVideoCard(item));
        });
    }

    /* ── Video Modal ── */
    function buildVideoModal() {
        const overlay = document.createElement('div');
        overlay.id = 'videoModal';
        overlay.className = 'modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'videoModalTitle');

        const content = document.createElement('div');
        content.className = 'modal-content';

        const card = document.createElement('div');
        card.className = 'modal-card modal-card--video';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'modal-action modal-action--right video-modal-close';
        closeBtn.setAttribute('aria-label', 'Close video modal');
        closeBtn.title = 'Close';
        closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

        const favoriteSlot = document.createElement('div');
        favoriteSlot.className = 'video-modal__favorite';

        const videoWrap = document.createElement('div');
        videoWrap.id = 'videoModalPlayer';
        videoWrap.className = 'video-modal__player';

        const body = document.createElement('div');
        body.className = 'modal-body';

        const titleEl = document.createElement('h3');
        titleEl.id = 'videoModalTitle';
        titleEl.className = 'modal-title';

        const captionEl = document.createElement('p');
        captionEl.id = 'videoModalCaption';
        captionEl.className = 'modal-caption';

        body.appendChild(titleEl);
        body.appendChild(captionEl);

        card.appendChild(closeBtn);
        card.appendChild(favoriteSlot);
        card.appendChild(videoWrap);
        card.appendChild(body);
        content.appendChild(card);
        overlay.appendChild(content);

        closeBtn.addEventListener('click', closeVideoModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeVideoModal();
        });

        return { root: overlay, favoriteSlot, videoWrap, titleEl, captionEl };
    }

    function openVideoModal(item) {
        const video = document.createElement('video');
        video.controls = true;
        video.autoplay = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.style.cssText = 'width:100%;max-height:70vh;display:block;border-radius:8px;background:#000';
        video.src = item.file.url;

        const star = createStarButton('video', item.id, {
            title: item.title || 'Video',
            thumb_url: item.poster?.url || '',
        });
        star.classList.add('video-modal__fav');

        modal.favoriteSlot.innerHTML = '';
        modal.favoriteSlot.appendChild(star);
        modal.videoWrap.innerHTML = '';
        modal.videoWrap.appendChild(video);
        modal.titleEl.textContent = item.title || 'Memvids';
        modal.captionEl.textContent = item.caption || '';

        modal.root.classList.add('active');
        document.body.style.overflow = 'hidden';
        focusTrapCleanup = setupFocusTrap(modal.root);
    }

    function closeVideoModal() {
        /* Pause video before removing */
        const video = modal.videoWrap.querySelector('video');
        if (video) {
            video.pause();
            video.removeAttribute('src');
            video.load();
        }

        modal.favoriteSlot.innerHTML = '';
        modal.root.classList.remove('active');
        document.body.style.overflow = '';
        if (focusTrapCleanup) { focusTrapCleanup(); focusTrapCleanup = null; }
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.root.classList.contains('active')) closeVideoModal();
    });

    window.addEventListener('pagehide', () => {
        deck.destroy();
    }, { once: true });

    render();
}
