/* ============================================================
   BITBI — Gallery rendering and modal with focus trap
   ============================================================ */

import { setupFocusTrap } from '../../shared/focus-trap.js';
import { createStarButton } from '../../shared/favorites.js';
import {
    getMobileMediaGridQuery,
    openMobileMediaGrid,
    syncMobileMediaTrigger,
} from './mobile-media-overlay.js?v=__ASSET_VERSION__';


const MEMPICS_CATEGORY = 'mempics';
const MEMPICS_LIMIT = 60;
const DESKTOP_PUBLIC_DRAWER_MEDIA = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';
const DESKTOP_VISIBLE_MEMPICS = 5;

let focusTrapCleanup = null;

export function initGallery() {
    const grid = document.getElementById('galleryGrid');
    const modal = document.getElementById('galleryModal');
    const $pagination = document.getElementById('galleryPagination');
    if (!grid || !modal) return;
    let renderSeq = 0;
    let mempicsPromise = null;
    const desktopDrawerQuery = window.matchMedia?.(DESKTOP_PUBLIC_DRAWER_MEDIA);
    const mempicsState = {
        items: [],
        nextCursor: null,
        hasMore: false,
        loaded: false,
        loadingMore: false,
    };
    let currentFilter = MEMPICS_CATEGORY;
    let mempicsDrawerExpanded = false;

    const mobileMediaQuery = getMobileMediaGridQuery();
    const $paginationStatus = document.createElement('button');
    $paginationStatus.type = 'button';
    $paginationStatus.className = 'browse-pagination__status';
    const $drawerToggle = document.createElement('button');
    $drawerToggle.type = 'button';
    $drawerToggle.className = 'browse-pagination__toggle';
    $drawerToggle.setAttribute('aria-controls', 'galleryGrid');
    const $loadMore = document.createElement('button');
    $loadMore.type = 'button';
    $loadMore.className = 'browse-pagination__btn';
    $loadMore.textContent = 'Load More';
    $pagination?.append($paginationStatus, $drawerToggle, $loadMore);

    function bindMediaQueryChange(query, listener) {
        if (!query) return;
        if (typeof query.addEventListener === 'function') {
            query.addEventListener('change', listener);
            return;
        }
        if (typeof query.addListener === 'function') {
            query.addListener(listener);
        }
    }

    function isDesktopDrawerEnabled() {
        return !!desktopDrawerQuery?.matches;
    }

    function hasCollapsedMempics() {
        return isDesktopDrawerEnabled()
            && mempicsState.items.length > DESKTOP_VISIBLE_MEMPICS;
    }

    function getVisibleMempicsCount() {
        if (!hasCollapsedMempics() || mempicsDrawerExpanded) {
            return mempicsState.items.length;
        }
        return DESKTOP_VISIBLE_MEMPICS;
    }

    function getRenderedMempicsCards() {
        return Array.from(grid.querySelectorAll('.gallery-item:not(.locked-area)'));
    }

    function syncMempicsDrawerVisibility() {
        const hideOverflow = currentFilter === MEMPICS_CATEGORY
            && hasCollapsedMempics()
            && !mempicsDrawerExpanded;
        getRenderedMempicsCards().forEach((card, index) => {
            card.hidden = hideOverflow && index >= DESKTOP_VISIBLE_MEMPICS;
        });
    }

    function renderGalleryState(message) {
        const empty = document.createElement('div');
        empty.className = 'gallery-empty-state';
        empty.textContent = message;
        grid.appendChild(empty);
    }

    function openMempicsOverlay() {
        openMobileMediaGrid({
            title: 'Mempics',
            items: mempicsState.items,
            emptyText: 'No Mempics published yet.',
            className: 'mobile-media-grid-overlay--gallery',
            renderItem(item, index, { openDetail } = {}) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'mobile-media-grid-overlay__item mobile-media-grid-overlay__item--image';
                button.setAttribute('aria-label', item.title || `Show Mempic ${index + 1}`);

                const img = new Image();
                img.src = item.thumb?.url || item.preview?.url || '';
                img.alt = '';
                img.loading = 'lazy';
                img.decoding = 'async';
                button.appendChild(img);

                const label = document.createElement('span');
                label.className = 'mobile-media-grid-overlay__item-label';
                label.textContent = item.publisher?.display_name || item.title || `Mempic ${index + 1}`;
                button.appendChild(label);

                button.addEventListener('click', () => {
                    if (typeof openDetail === 'function') {
                        openDetail({
                            title: item.title || `Mempic ${index + 1}`,
                            className: 'mobile-media-detail-overlay--gallery',
                            renderContent() {
                                const wrap = document.createElement('div');
                                wrap.className = 'mobile-media-detail-overlay__media mobile-media-detail-overlay__media--image';
                                const img = new Image();
                                img.src = item.preview?.url || item.thumb?.url || '';
                                img.alt = item.title || `Mempic ${index + 1}`;
                                img.width = Number(item.preview?.w || item.thumb?.w) || 800;
                                img.height = Number(item.preview?.h || item.thumb?.h) || 800;
                                img.decoding = 'async';
                                wrap.appendChild(img);
                                return wrap;
                            },
                        });
                        return;
                    }
                    galActive = index;
                    galLayout();
                    galSyncDots();
                    grid.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
                });
                return button;
            },
        });
    }

    function updateMempicsPagination(filter, errorMessage = '') {
        if (!$pagination) return;
        if (filter !== MEMPICS_CATEGORY) {
            $pagination.style.display = 'none';
            return;
        }
        if (errorMessage) {
            $pagination.style.display = '';
            $paginationStatus.textContent = errorMessage;
            syncMobileMediaTrigger($paginationStatus, { enabled: false, label: 'Open Mempics grid' });
            $drawerToggle.hidden = true;
            $drawerToggle.textContent = '';
            $loadMore.hidden = true;
            $loadMore.textContent = '';
            $loadMore.disabled = false;
            return;
        }
        if (!mempicsState.items.length) {
            $pagination.style.display = 'none';
            syncMobileMediaTrigger($paginationStatus, { enabled: false, label: 'Open Mempics grid' });
            return;
        }
        const drawerAvailable = hasCollapsedMempics();
        const visibleCount = getVisibleMempicsCount();
        const showDrawerToggle = drawerAvailable;
        const showLoadMore = mempicsState.hasMore;
        $pagination.style.display = '';
        if (drawerAvailable && !mempicsDrawerExpanded) {
            $paginationStatus.textContent = `Showing all ${visibleCount} Mempics`;
        } else if (mempicsState.hasMore) {
            $paginationStatus.textContent = `Showing ${visibleCount} Mempics.`;
        } else {
            $paginationStatus.textContent = `Showing all ${visibleCount} Mempics.`;
        }
        syncMobileMediaTrigger($paginationStatus, {
            enabled: mempicsState.items.length > 0,
            label: 'Open all Mempics in a grid',
        });
        $drawerToggle.hidden = !showDrawerToggle;
        $drawerToggle.textContent = showDrawerToggle
            ? (mempicsDrawerExpanded ? 'Show Less' : 'Show More')
            : '';
        $drawerToggle.setAttribute('aria-expanded', String(showDrawerToggle && mempicsDrawerExpanded));
        $loadMore.hidden = !showLoadMore;
        $loadMore.disabled = mempicsState.loadingMore;
        $loadMore.textContent = showLoadMore
            ? (mempicsState.loadingMore ? 'Loading...' : 'Load More')
            : '';
    }

    async function fetchMempics(cursor = null) {
        if (mempicsPromise) return mempicsPromise;
        mempicsPromise = (async () => {
            try {
                const params = new URLSearchParams();
                params.set('limit', String(MEMPICS_LIMIT));
                if (cursor) params.set('cursor', cursor);
                const res = await fetch(`/api/gallery/mempics?${params}`, {
                    credentials: 'same-origin',
                });
                const data = await res.json().catch(() => null);
                if (!res.ok) {
                    throw new Error(data?.error || `Error ${res.status}`);
                }
                return {
                    items: (Array.isArray(data?.data?.items) ? data.data.items : [])
                        .map((item) => ({ ...item, favoriteType: 'mempics' })),
                    nextCursor: typeof data?.data?.next_cursor === 'string' ? data.data.next_cursor : null,
                    hasMore: data?.data?.has_more === true,
                };
            } catch (error) {
                console.warn('mempics:', error);
                throw error;
            } finally {
                mempicsPromise = null;
            }
        })();
        return mempicsPromise;
    }

    async function ensureMempicsLoaded() {
        if (mempicsState.loaded) return;
        const page = await fetchMempics();
        mempicsState.items = page.items;
        mempicsState.nextCursor = page.nextCursor;
        mempicsState.hasMore = page.hasMore;
        mempicsState.loaded = true;
    }

    async function loadMoreMempics() {
        if (!mempicsState.hasMore || mempicsState.loadingMore) return;
        mempicsState.loadingMore = true;
        updateMempicsPagination(MEMPICS_CATEGORY);
        let errorMessage = '';
        try {
            const page = await fetchMempics(mempicsState.nextCursor);
            mempicsState.items = mempicsState.items.concat(page.items);
            mempicsState.nextCursor = page.nextCursor;
            mempicsState.hasMore = page.hasMore;
            render(MEMPICS_CATEGORY);
        } catch (error) {
            errorMessage = 'Could not load more Mempics right now.';
            console.warn('mempics load more:', error);
        } finally {
            mempicsState.loadingMore = false;
            updateMempicsPagination(MEMPICS_CATEGORY, errorMessage);
        }
    }

    function buildGalleryCard(item) {
        const publisher = item.publisher || null;
        const publisherName = typeof publisher?.display_name === 'string'
            ? publisher.display_name.trim()
            : '';
        const suppressGenericMempicsTitle = item.favoriteType === 'mempics'
            && String(item.title || '').trim().toLowerCase() === 'mempics';
        const visibleTitle = publisherName || (suppressGenericMempicsTitle ? '' : String(item.title || '').trim());
        const card = document.createElement('div');
        card.className = 'gallery-item';
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', visibleTitle || item.title || 'Image');

        const inner = document.createElement('div');
        inner.className = 'gallery-inner rounded-xl overflow-hidden relative';
        inner.style.border = '1px solid rgba(255,255,255,0.04)';

        const img = new Image();
        img.src = item.thumb.url;
        img.alt = item.title;
        img.width = item.thumb.w;
        img.height = item.thumb.h;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.style.cssText = 'width:100%;display:block;object-fit:cover';
        img.onerror = function() {
            this.onerror = null;
            this.style.display = 'none';
            inner.style.background = '#0D1B2A';
            inner.style.minHeight = '200px';
        };
        inner.appendChild(img);

        const overlay = document.createElement('div');
        overlay.className = 'gallery-overlay';
        overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:flex-end;padding:20px;z-index:1';

        const copy = document.createElement('div');
        copy.className = 'public-media-meta';

        const publisherRow = document.createElement('div');
        publisherRow.className = 'public-media-meta__identity';
        if (publisher?.avatar?.url) {
            const avatar = new Image();
            avatar.className = 'public-media-meta__avatar';
            avatar.src = publisher.avatar.url;
            avatar.alt = '';
            avatar.loading = 'lazy';
            avatar.decoding = 'async';
            avatar.onerror = () => avatar.remove();
            publisherRow.appendChild(avatar);
        }

        if (visibleTitle) {
            const title = document.createElement('h4');
            title.className = 'public-media-meta__title';
            title.textContent = visibleTitle;
            publisherRow.appendChild(title);
        }
        if (publisherRow.childElementCount) {
            copy.appendChild(publisherRow);
        }

        if (item.caption) {
            const caption = document.createElement('p');
            caption.className = 'public-media-meta__caption';
            caption.textContent = item.caption;
            copy.appendChild(caption);
        }

        const cta = document.createElement('span');
        cta.className = 'public-media-meta__cta';
        cta.textContent = 'View Full →';
        copy.appendChild(cta);

        overlay.appendChild(copy);
        inner.appendChild(overlay);

        if (item.favoriteType !== false) {
            const star = createStarButton(item.favoriteType || 'gallery', item.id, {
                title: item.title,
                thumb_url: item.thumb.url,
            });
            star.style.cssText = 'position:absolute;top:8px;right:8px';
            inner.appendChild(star);
        }

        card.appendChild(inner);
        card.addEventListener('click', () => openModal(item));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openModal(item);
            }
        });
        return card;
    }

    async function render(filter) {
        currentFilter = filter;
        const seq = ++renderSeq;
        updateMempicsPagination(filter);
        grid.innerHTML = '';

        let list = [];
        if (filter === MEMPICS_CATEGORY) {
            renderGalleryState('Loading Mempics…');
            try {
                await ensureMempicsLoaded();
                list = mempicsState.items.slice();
            } catch {
                if (seq !== renderSeq) return;
                Array.from(grid.querySelectorAll('.gallery-empty-state')).forEach((node) => node.remove());
                renderGalleryState('Could not load Mempics right now.');
                updateMempicsPagination(filter, 'Could not load Mempics right now.');
                return;
            }
            if (seq !== renderSeq) return;
            Array.from(grid.querySelectorAll('.gallery-empty-state')).forEach((node) => node.remove());
        }

        if (!list.length) {
            renderGalleryState('No Mempics published yet.');
            updateMempicsPagination(filter);
            return;
        }

        list.forEach((item) => {
            const card = buildGalleryCard(item);
            grid.appendChild(card);
        });
        syncMempicsDrawerVisibility();
        updateMempicsPagination(filter);
    }

    render(MEMPICS_CATEGORY);
    $loadMore?.addEventListener('click', () => {
        loadMoreMempics();
    });
    $paginationStatus.addEventListener('click', openMempicsOverlay);

    $drawerToggle?.addEventListener('click', () => {
        const nextExpanded = !mempicsDrawerExpanded;
        const previousScrollY = nextExpanded ? window.scrollY : 0;
        mempicsDrawerExpanded = nextExpanded;
        syncMempicsDrawerVisibility();
        updateMempicsPagination(currentFilter);
        try {
            $drawerToggle.focus({ preventScroll: true });
        } catch {
            $drawerToggle.focus();
        }
        if (!nextExpanded) return;
        window.requestAnimationFrame(() => {
            if (window.scrollY + 1 < previousScrollY) {
                window.scrollTo({ top: previousScrollY, behavior: 'auto' });
            }
        });
    });

    function openModal(item) {
        const mi = document.getElementById('modalImage');
        const fullLink = document.getElementById('modalFullLink');
        mi.style.background = '#0D1B2A';
        const modalImg = new Image();
        modalImg.src = item.preview.url;
        modalImg.alt = item.title;
        modalImg.width = item.preview.w;
        modalImg.height = item.preview.h;
        modalImg.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block';
        modalImg.onerror = function() {
            this.onerror = null;
            this.alt = 'Image could not be loaded';
        };
        mi.innerHTML = '';
        mi.appendChild(modalImg);
        document.getElementById('modalTitle').textContent = item.title;
        document.getElementById('modalCaption').textContent = item.caption;

        /* Show open-full link only for public items with a full variant */
        if (fullLink) {
            if (item.full && item.full.url) {
                fullLink.href = item.full.url;
                fullLink.hidden = false;
                fullLink.setAttribute('tabindex', '0');
                fullLink.onclick = (e) => {
                    e.stopPropagation();
                    window.open(item.full.url, '_blank', 'noopener,noreferrer');
                    e.preventDefault();
                };
            } else {
                fullLink.href = '#';
                fullLink.hidden = true;
                fullLink.setAttribute('tabindex', '-1');
                fullLink.onclick = null;
            }
        }

        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        focusTrapCleanup = setupFocusTrap(modal);
    }

    function closeModal() {
        const fullLink = document.getElementById('modalFullLink');
        if (fullLink) {
            fullLink.href = '#';
            fullLink.hidden = true;
            fullLink.setAttribute('tabindex', '-1');
            fullLink.onclick = null;
        }
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        if (focusTrapCleanup) { focusTrapCleanup(); focusTrapCleanup = null; }
    }

    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
    });

    /* ── Mobile Gallery Deck ── */

    const galMql = window.matchMedia('(max-width: 639px)');
    let galActive = 0;
    let galIsDeck = false;
    let galDotsEl = null;
    let galSwipeLock = false;
    let galGridObserver = null;

    function galGetCards() {
        return Array.from(grid.children).filter(c => c.style.display !== 'none' && c.tagName !== 'BUTTON');
    }

    function galLayout(skipAnim) {

        const all = galGetCards();
        const n = all.length;
        all.forEach((c, i) => {
            const d = i - galActive;
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

    function galBuildDots() {
        if (galDotsEl) galDotsEl.remove();
        const all = galGetCards();
        if (all.length <= 1) { galDotsEl = null; return; }
        galDotsEl = document.createElement('div');
        galDotsEl.className = 'gal-deck-dots';
        galDotsEl.setAttribute('role', 'tablist');
        galDotsEl.setAttribute('aria-label', 'Gallery cards');
        all.forEach((_, i) => {
            const d = document.createElement('button');
            d.type = 'button';
            d.className = 'gal-deck-dot' + (i === galActive ? ' active' : '');
            d.setAttribute('role', 'tab');
            d.setAttribute('aria-selected', i === galActive ? 'true' : 'false');
            d.setAttribute('aria-label', `Show card ${i + 1}`);
            d.addEventListener('click', () => { galActive = i; galLayout(); galSyncDots(); });
            galDotsEl.appendChild(d);
        });
        grid.after(galDotsEl);
    }

    function galSyncDots() {
        if (!galDotsEl) return;
        const dots = galDotsEl.querySelectorAll('.gal-deck-dot');
        const all = galGetCards();
        if (dots.length !== all.length) { galBuildDots(); return; }
        dots.forEach((d, i) => {
            d.classList.toggle('active', i === galActive);
            d.setAttribute('aria-selected', i === galActive ? 'true' : 'false');
        });
    }

    function galRenderDeck() {
        const cards = galGetCards();
        galActive = Math.min(galActive, Math.max(0, cards.length - 1));
        galLayout(true);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                galGetCards().forEach(c => { c.style.transition = ''; });
            });
        });
        galBuildDots();
    }

    bindMediaQueryChange(desktopDrawerQuery, () => {
        if (!isDesktopDrawerEnabled()) {
            mempicsDrawerExpanded = false;
        }
        render(currentFilter);
    });
    bindMediaQueryChange(mobileMediaQuery, () => {
        updateMempicsPagination(currentFilter);
    });

    function galEngage() {
        if (galIsDeck) return;
        galIsDeck = true;
        galActive = 0;
        grid.classList.add('gal-deck');
        render(MEMPICS_CATEGORY);
        galRenderDeck();
    }

    function galDisengage() {
        if (!galIsDeck) return;
        galIsDeck = false;
        grid.classList.remove('gal-deck');
        Array.from(grid.children).forEach(c => {
            c.style.transform = '';
            c.style.opacity = '';
            c.style.zIndex = '';
            c.style.pointerEvents = '';
            c.style.transition = '';
        });
        if (galDotsEl) { galDotsEl.remove(); galDotsEl = null; }
        render(MEMPICS_CATEGORY);
    }

    /* Touch handling */
    let gsx, gsy, gst, gTracking, gDecided, gHoriz;

    grid.addEventListener('touchstart', e => {
        if (!galIsDeck) return;
        const t = e.touches[0];
        gsx = t.clientX; gsy = t.clientY; gst = Date.now();
        gTracking = true; gDecided = false; gHoriz = false;
        galSwipeLock = false;
        const c = galGetCards()[galActive];
        if (c) c.style.transition = 'none';

    }, { passive: true });

    grid.addEventListener('touchmove', e => {
        if (!gTracking || !galIsDeck) return;
        const t = e.touches[0];
        const dx = t.clientX - gsx, dy = t.clientY - gsy;
        if (!gDecided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
            gDecided = true;
            gHoriz = Math.abs(dx) > Math.abs(dy);
            if (!gHoriz) {
                gTracking = false;
                const c = galGetCards()[galActive];
                if (c) c.style.transition = '';
                return;
            }
        }
        if (gHoriz) {
            e.preventDefault();
            const c = galGetCards()[galActive];
            if (c) {
                let adj = dx;
                const all = galGetCards();
                const atBoundary = (galActive === 0 && dx > 0) || (galActive >= all.length - 1 && dx < 0);
                if (atBoundary) adj *= 0.25;
                c.style.transform = `translateX(${adj}px) scale(0.90)`;

            }
        }
    }, { passive: false });

    grid.addEventListener('touchend', e => {
        if (!gTracking || !galIsDeck) return;
        gTracking = false;
        if (!gHoriz || !gDecided) {
            galLayout();
            return;
        }
        const dx = e.changedTouches[0].clientX - gsx;
        const v = Math.abs(dx) / Math.max(Date.now() - gst, 1);
        const all = galGetCards();
        const prevActive = galActive;
        if ((Math.abs(dx) > 40 || v > 0.3) && Math.abs(dx) > 15) {
            galSwipeLock = true;
            if (dx < 0 && galActive < all.length - 1) galActive++;
            else if (dx > 0 && galActive > 0) galActive--;
        }

        galLayout();
        galSyncDots();
    }, { passive: true });

    grid.addEventListener('touchcancel', () => {
        if (!gTracking || !galIsDeck) return;
        gTracking = false;
        galLayout();
    }, { passive: true });

    /* Block click after swipe */
    grid.addEventListener('click', e => {
        if (galSwipeLock) { e.stopPropagation(); e.preventDefault(); galSwipeLock = false; }
    }, true);

    /* Watch for DOM changes from public Mempics rendering */
    galGridObserver = new MutationObserver(() => {

        if (galIsDeck) galRenderDeck();
    });
    galGridObserver.observe(grid, { childList: true });

    galMql.addEventListener('change', e => {
        if (e.matches) galEngage();
        else galDisengage();
    });

    if (galMql.matches) galEngage();

    window.addEventListener('pagehide', () => {
        if (galGridObserver) { galGridObserver.disconnect(); galGridObserver = null; }
    });
}
