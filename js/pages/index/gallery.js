/* ============================================================
   BITBI — Gallery rendering and modal with focus trap
   ============================================================ */

import { setupFocusTrap } from '../../shared/focus-trap.js';
import {
    MAX_MOBILE_DECK_DOTS,
    getMobileDeckActiveDotIndex,
    getMobileDeckDotTargets,
} from '../../shared/studio-deck.js?v=__ASSET_VERSION__';
import {
    getMobileMediaGridItemAspectRatio,
    getMobileMediaGridQuery,
    isMobileMediaGridEnabled,
    openMobileMediaDetailView,
    openMobileMediaGrid,
    syncMobileMediaTrigger,
} from './mobile-media-overlay.js?v=__ASSET_VERSION__';
import { syncCategoryGhostModels } from './category-ghost-models.js?v=__ASSET_VERSION__';
import { orderPublicExploreItems } from './explore-order.js?v=__ASSET_VERSION__';
import {
    calculateFixedMediaWallMetrics,
    clearFixedMediaWallLayout,
    renderFixedMediaWallColumns,
} from './public-media-wall.js?v=__ASSET_VERSION__';
import { createPublicMediaDetailPanel } from './public-media-detail-panel.js?v=__ASSET_VERSION__';
import { localeText } from '../../shared/locale.js?v=__ASSET_VERSION__';


const MEMPICS_CATEGORY = 'mempics';
const MEMPICS_PAGE_LIMIT = 60;
const DESKTOP_HOVER_MEDIA = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';
const TABLET_DESKTOP_LAYOUT_MEDIA = [
    '(min-width: 768px) and (max-width: 1023px) and (min-height: 700px)',
    '(min-width: 1024px) and (hover: none) and (pointer: coarse) and (min-height: 700px)',
].join(', ');
const PUBLIC_WIDE_LAYOUT_MEDIA = `${DESKTOP_HOVER_MEDIA}, ${TABLET_DESKTOP_LAYOUT_MEDIA}`;
const PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT = 60;
const PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT = 100;
const PUBLIC_EXPLORE_MIN_PREFETCH_PAGE_SIZE = 20;
const WIDE_COLUMN_FALLBACK_PX = 297;

let focusTrapCleanup = null;
let galleryDetailPanel = null;

export function initGallery() {
    const grid = document.getElementById('galleryGrid');
    const modal = document.getElementById('galleryModal');
    const $pagination = document.getElementById('galleryPagination');
    if (!grid || !modal) return;
    let renderSeq = 0;
    let mempicsPromise = null;
    const publicWideLayoutQuery = window.matchMedia?.(PUBLIC_WIDE_LAYOUT_MEDIA);
    const mempicsState = {
        items: [],
        nextCursor: null,
        hasMore: false,
        loaded: false,
        loadingMore: false,
    };
    let currentFilter = MEMPICS_CATEGORY;
    let mempicsVisibleLimit = PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT;
    let mempicsObserver = null;
    let mempicsResizeObserver = null;
    let mempicsResizeFrame = 0;
    let mempicsBreakpointRenderFrame = 0;
    let renderedMempicsCards = [];
    let renderedMempicsContentSignature = '';
    let suppressNextGalleryCardClick = false;

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
    $loadMore.textContent = localeText('browse.loadMore');
    const $scrollSentinel = document.createElement('div');
    $scrollSentinel.className = 'browse-pagination__sentinel';
    $scrollSentinel.setAttribute('aria-hidden', 'true');
    $scrollSentinel.hidden = true;
    $pagination?.append($paginationStatus, $drawerToggle, $loadMore, $scrollSentinel);

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

    function isPublicWideLayoutEnabled() {
        return !!publicWideLayoutQuery?.matches;
    }

    function getVisibleMempicsCount() {
        return Math.min(mempicsVisibleLimit, mempicsState.items.length, PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT);
    }

    function syncWideColumnCount(itemCount = 0) {
        return getWideLayoutMetrics(itemCount).columnCount;
    }

    function getWideLayoutMetrics(itemCount = 0) {
        return calculateFixedMediaWallMetrics(grid, {
            targetWidthProperty: '--bitbi-public-gallery-active-column-width',
            fallbackColumnWidth: WIDE_COLUMN_FALLBACK_PX,
            itemCount,
        });
    }

    function isMempicsLayoutActive() {
        const stage = grid.closest('#homeCategories');
        return !stage
            || stage.dataset.stageMode !== 'desktop'
            || (!stage.classList.contains('is-transitioning')
                && stage.dataset.activeCategory === 'gallery');
    }

    function syncMempicsWideLimitForLayout() {
        if (!isPublicWideLayoutEnabled()
            || !isMempicsLayoutActive()
            || currentFilter !== MEMPICS_CATEGORY
            || !mempicsState.loaded) return;
        reflowMempicsFromCache();
    }

    function scheduleMempicsWideLimitSync() {
        if (mempicsResizeFrame) return;
        mempicsResizeFrame = window.requestAnimationFrame(() => {
            mempicsResizeFrame = 0;
            syncMempicsWideLimitForLayout();
        });
    }

    function scheduleMempicsBreakpointRender() {
        if (mempicsBreakpointRenderFrame || !mempicsState.loaded) return;
        mempicsBreakpointRenderFrame = window.requestAnimationFrame(() => {
            mempicsBreakpointRenderFrame = 0;
            render(currentFilter).then(() => {
                if (galIsDeck) galRenderDeck();
            });
        });
    }

    function canRevealMoreMempics() {
        const visibleCount = getVisibleMempicsCount();
        return currentFilter === MEMPICS_CATEGORY
            && visibleCount < PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT
            && (mempicsState.items.length > visibleCount || mempicsState.hasMore);
    }

    function resetMempicsWideWindow() {
        mempicsVisibleLimit = PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT;
    }

    function getMempicIdentity(item) {
        return String(item?.id || item?.slug || item?.thumb?.url || item?.preview?.url || '').trim();
    }

    function getMempicsContentSignature(items) {
        return JSON.stringify((Array.isArray(items) ? items : []).map((item) => [
            getMempicIdentity(item),
            item?.thumb?.url || '',
            Number(item?.thumb?.w || item?.preview?.w) || 0,
            Number(item?.thumb?.h || item?.preview?.h) || 0,
            item?.title || '',
            item?.caption || '',
            item?.publisher?.display_name || '',
            item?.publisher?.avatar?.url || '',
            item?.publicCollection || '',
        ]));
    }

    function getMempicDimensions(item) {
        const width = Number(item?.thumb?.w || item?.preview?.w);
        const height = Number(item?.thumb?.h || item?.preview?.h);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            return { width: 4, height: 3 };
        }
        return { width, height };
    }

    function getMempicAspectMeta(item) {
        const { width, height } = getMempicDimensions(item);
        const rawRatio = width / height;
        const displayRatio = Math.min(1.78, Math.max(0.66, rawRatio));
        const orientation = rawRatio < 0.9
            ? 'portrait'
            : rawRatio > 1.1
                ? 'landscape'
                : 'square';
        return {
            orientation,
            ratio: displayRatio.toFixed(3),
        };
    }

    function getMempicOverlayAspectRatio(item) {
        return getMobileMediaGridItemAspectRatio(
            item?.preview?.w || item?.full?.w || item?.thumb?.w,
            item?.preview?.h || item?.full?.h || item?.thumb?.h,
            1,
        );
    }

    function mergeMempicsItems(items, { replace = false } = {}) {
        const nextItems = replace ? [] : mempicsState.items.slice();
        const seen = new Set(nextItems.map(getMempicIdentity).filter(Boolean));
        (Array.isArray(items) ? items : []).forEach((item) => {
            const identity = getMempicIdentity(item);
            if (identity && seen.has(identity)) return;
            if (identity) seen.add(identity);
            nextItems.push(item);
        });
        mempicsState.items = orderPublicExploreItems(nextItems, getMempicIdentity);
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
            items: mempicsState.items.slice(0, getVisibleMempicsCount()),
            emptyText: localeText('browse.noMempics'),
            className: 'mobile-media-grid-overlay--gallery',
            renderItem(item, index, { openDetail } = {}) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'mobile-media-grid-overlay__item mobile-media-grid-overlay__item--image';
                button.setAttribute('aria-label', item.title || localeText('browse.showMempic', { count: index + 1 }));
                button.style.setProperty('--mobile-media-grid-item-aspect', getMempicOverlayAspectRatio(item));

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
                        openMempicMobileDetail(item, { openDetail, title: item.title || `Mempic ${index + 1}` });
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

    function renderMempicMobileDetailContent(item, title = '') {
        const content = document.createElement('div');
        content.className = 'mobile-media-detail-overlay__content mobile-media-detail-overlay__content--public';

        const media = document.createElement('div');
        media.className = 'mobile-media-detail-overlay__media mobile-media-detail-overlay__media--image';
        const img = new Image();
        img.src = item.preview?.url || item.full?.url || item.thumb?.url || '';
        img.alt = item.title || title || 'Mempic';
        img.width = Number(item.preview?.w || item.full?.w || item.thumb?.w) || 800;
        img.height = Number(item.preview?.h || item.full?.h || item.thumb?.h) || 800;
        img.decoding = 'async';
        media.appendChild(img);

        const details = document.createElement('div');
        details.className = 'mobile-media-detail-overlay__details';
        const panel = createPublicMediaDetailPanel({
            item,
            collection: 'mempics',
            onCommentCountChange(count) {
                item.comment_count = count;
            },
        });
        details.appendChild(panel.root);
        content.append(media, details);
        return {
            node: content,
            cleanup() {
                panel.destroy();
            },
        };
    }

    function openMempicMobileDetail(item, { openDetail = null, title = '' } = {}) {
        const detailOptions = {
            title: title || item.title || localeText('browse.mediaDetails'),
            className: 'mobile-media-detail-overlay--gallery mobile-media-detail-overlay--media-first',
            openOriginalUrl: item.full?.url || item.preview?.url || '',
            openOriginalLabel: localeText('browse.openMediaInNewWindow'),
            hideTitle: true,
            hideOpenOriginal: true,
            renderContent() {
                return renderMempicMobileDetailContent(item, title);
            },
        };
        if (typeof openDetail === 'function') {
            openDetail(detailOptions);
            return true;
        }
        return openMobileMediaDetailView(detailOptions);
    }

    function updateMempicsPagination(filter, errorMessage = '') {
        if (!$pagination) return;
        if (filter !== MEMPICS_CATEGORY) {
            $pagination.style.display = 'none';
            syncMempicsScrollLoading();
            return;
        }
        if (errorMessage) {
            $pagination.style.display = '';
            $paginationStatus.textContent = errorMessage;
            syncMobileMediaTrigger($paginationStatus, { enabled: false, label: localeText('browse.openMempicsGrid') });
            $drawerToggle.hidden = true;
            $drawerToggle.textContent = '';
            $loadMore.hidden = true;
            $loadMore.textContent = '';
            $loadMore.disabled = false;
            $scrollSentinel.hidden = true;
            syncMempicsScrollLoading();
            return;
        }
        if (!mempicsState.items.length) {
            $pagination.style.display = 'none';
            syncMobileMediaTrigger($paginationStatus, { enabled: false, label: localeText('browse.openMempicsGrid') });
            $scrollSentinel.hidden = true;
            syncMempicsScrollLoading();
            return;
        }
        const visibleCount = getVisibleMempicsCount();
        const canRevealMore = canRevealMoreMempics();
        const showDrawerToggle = canRevealMore;
        $pagination.style.display = '';
        if (canRevealMore) {
            $paginationStatus.textContent = localeText('browse.showingMempicsComplete', { count: visibleCount });
        } else if (mempicsState.hasMore) {
            $paginationStatus.textContent = localeText('browse.showingMempicsComplete', { count: visibleCount });
        } else {
            $paginationStatus.textContent = localeText('browse.showingAllMempicsComplete', { count: visibleCount });
        }
        syncMobileMediaTrigger($paginationStatus, {
            enabled: mempicsState.items.length > 0,
            label: localeText('browse.openMempicsGrid'),
        });
        $drawerToggle.hidden = !showDrawerToggle;
        $drawerToggle.textContent = showDrawerToggle
            ? (mempicsState.loadingMore ? localeText('browse.loading') : localeText('browse.showMore'))
            : '';
        $drawerToggle.disabled = mempicsState.loadingMore;
        $drawerToggle.setAttribute('aria-expanded', 'false');
        $loadMore.hidden = true;
        $loadMore.disabled = mempicsState.loadingMore;
        $loadMore.textContent = '';
        $scrollSentinel.hidden = true;
        syncMempicsScrollLoading();
    }

    async function fetchMempics(cursor = null, limit = MEMPICS_PAGE_LIMIT) {
        if (mempicsPromise) return mempicsPromise;
        mempicsPromise = (async () => {
            try {
                const params = new URLSearchParams();
                const safeLimit = Math.max(1, Math.min(MEMPICS_PAGE_LIMIT, Number(limit) || MEMPICS_PAGE_LIMIT));
                params.set('limit', String(safeLimit));
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
                        .map((item) => ({ ...item, publicCollection: 'mempics' })),
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

    async function fetchAndMergeNextMempicsPage({ updateUi = true, limit = MEMPICS_PAGE_LIMIT } = {}) {
        if (!mempicsState.hasMore || mempicsState.loadingMore || mempicsState.items.length >= PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT) return false;
        mempicsState.loadingMore = true;
        if (updateUi) updateMempicsPagination(MEMPICS_CATEGORY);
        try {
            const remaining = Math.max(1, PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT - mempicsState.items.length);
            const page = await fetchMempics(mempicsState.nextCursor, Math.min(limit, remaining));
            const beforeCount = mempicsState.items.length;
            mergeMempicsItems(page.items);
            if (mempicsState.items.length > PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT) {
                mempicsState.items = mempicsState.items.slice(0, PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT);
            }
            mempicsState.nextCursor = page.nextCursor;
            mempicsState.hasMore = page.hasMore;
            return mempicsState.items.length > beforeCount;
        } finally {
            mempicsState.loadingMore = false;
            if (updateUi) updateMempicsPagination(MEMPICS_CATEGORY);
        }
    }

    async function loadMempicsUntilVisible(targetCount, { updateUi = false } = {}) {
        const safeTarget = Math.min(PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT, Math.max(0, Number(targetCount) || 0));
        while (mempicsState.items.length < safeTarget && mempicsState.hasMore) {
            const beforeCount = mempicsState.items.length;
            const fetched = await fetchAndMergeNextMempicsPage({
                updateUi,
                limit: safeTarget - beforeCount,
            });
            if (!fetched || mempicsState.items.length <= beforeCount) break;
        }
    }

    async function ensureMempicsLoaded() {
        if (mempicsState.loaded) return;
        const page = await fetchMempics(null, PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT);
        mergeMempicsItems(page.items, { replace: true });
        if (mempicsState.items.length > PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT) {
            mempicsState.items = mempicsState.items.slice(0, PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT);
        }
        mempicsState.nextCursor = page.nextCursor;
        mempicsState.hasMore = page.hasMore;
        if ((page.items?.length || 0) >= PUBLIC_EXPLORE_MIN_PREFETCH_PAGE_SIZE) {
            await loadMempicsUntilVisible(PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT);
        }
        mempicsState.loaded = true;
        resetMempicsWideWindow();
    }

    async function fetchNextMempicsPage() {
        return fetchAndMergeNextMempicsPage({ updateUi: true });
    }

    async function loadMoreMempics() {
        let errorMessage = '';
        try {
            if (!canRevealMoreMempics()) return;
            await loadMempicsUntilVisible(PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT, { updateUi: true });
            mempicsVisibleLimit = Math.min(PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT, Math.max(mempicsVisibleLimit, mempicsState.items.length));
            await render(MEMPICS_CATEGORY);
        } catch (error) {
            errorMessage = localeText('browse.mempicsLoadMoreFailed');
            console.warn('mempics load more:', error);
        } finally {
            updateMempicsPagination(MEMPICS_CATEGORY, errorMessage);
        }
    }

    async function revealNextMempicsBatch() {
        return loadMoreMempics();
    }

    function shouldUseScrollLoading() {
        return false;
    }

    function maybeRevealMempicsFromScroll() {
        return undefined;
    }

    function handleMempicsProgressiveScroll() {
        maybeRevealMempicsFromScroll();
    }

    function handleMempicsIntersection(entries) {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        maybeRevealMempicsFromScroll();
    }

    function disconnectMempicsObserver() {
        if (!mempicsObserver) return;
        mempicsObserver.disconnect();
        mempicsObserver = null;
    }

    function syncMempicsScrollLoading() {
        window.removeEventListener('scroll', handleMempicsProgressiveScroll);
        disconnectMempicsObserver();
    }

    function buildGalleryCard(item) {
        const publisher = item.publisher || null;
        const publisherName = typeof publisher?.display_name === 'string'
            ? publisher.display_name.trim()
            : '';
        const suppressGenericMempicsTitle = item.publicCollection === 'mempics'
            && String(item.title || '').trim().toLowerCase() === 'mempics';
        const visibleTitle = publisherName || (suppressGenericMempicsTitle ? '' : String(item.title || '').trim());
        const card = document.createElement('div');
        card.className = 'gallery-item';
        const itemIdentity = getMempicIdentity(item);
        if (itemIdentity) card.dataset.galleryItemId = itemIdentity;
        const aspectMeta = getMempicAspectMeta(item);
        card.classList.add(`gallery-item--${aspectMeta.orientation}`);
        card.dataset.galleryAspect = aspectMeta.orientation;
        card.style.setProperty('--gallery-item-aspect', aspectMeta.ratio);
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', visibleTitle || item.title || 'Image');

        const inner = document.createElement('div');
        inner.className = 'gallery-inner rounded-xl overflow-hidden relative';
        inner.style.border = '1px solid rgba(255,255,255,0.04)';

        const img = new Image();
        img.className = 'gallery-item__media';
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
        cta.textContent = localeText('browse.viewFull');
        copy.appendChild(cta);

        overlay.appendChild(copy);
        inner.appendChild(overlay);

        card.appendChild(inner);
        card.addEventListener('click', () => {
            if (suppressNextGalleryCardClick) {
                suppressNextGalleryCardClick = false;
                return;
            }
            if (isMobileMediaGridEnabled()) {
                openMempicMobileDetail(item);
                return;
            }
            openModal(item);
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (isMobileMediaGridEnabled()) {
                    openMempicMobileDetail(item);
                    return;
                }
                openModal(item);
            }
        });
        return card;
    }

    function renderGalleryCards(items, contentSignature) {
        const cards = items.map(buildGalleryCard);
        renderedMempicsCards = cards;
        renderedMempicsContentSignature = contentSignature;
        if (!isPublicWideLayoutEnabled()) {
            clearFixedMediaWallLayout(grid, {
                countProperty: '--bitbi-public-gallery-column-count',
            });
            grid.append(...cards);
            return;
        }
        renderFixedMediaWallColumns(grid, cards, {
            countProperty: '--bitbi-public-gallery-column-count',
            targetWidthProperty: '--bitbi-public-gallery-active-column-width',
            fallbackColumnWidth: WIDE_COLUMN_FALLBACK_PX,
            aspectProperty: '--gallery-item-aspect',
            fallbackAspectRatio: 1.333,
            contentSignature,
        });
    }

    function reflowMempicsFromCache() {
        if (!isPublicWideLayoutEnabled() || currentFilter !== MEMPICS_CATEGORY || !mempicsState.loaded) return false;
        const items = mempicsState.items.slice(0, getVisibleMempicsCount());
        const contentSignature = getMempicsContentSignature(items);
        const cardsAreReusable = contentSignature === renderedMempicsContentSignature
            && renderedMempicsCards.length === items.length
            && renderedMempicsCards.every((card) => grid.contains(card));
        if (!cardsAreReusable) {
            return render(MEMPICS_CATEGORY).then(() => true);
        }
        const previousRenderToken = grid.dataset.mediaWallRenderToken || '';
        renderFixedMediaWallColumns(grid, renderedMempicsCards, {
            countProperty: '--bitbi-public-gallery-column-count',
            targetWidthProperty: '--bitbi-public-gallery-active-column-width',
            fallbackColumnWidth: WIDE_COLUMN_FALLBACK_PX,
            aspectProperty: '--gallery-item-aspect',
            fallbackAspectRatio: 1.333,
            contentSignature,
        });
        return (grid.dataset.mediaWallRenderToken || '') !== previousRenderToken;
    }

    async function render(filter) {
        currentFilter = filter;
        const seq = ++renderSeq;
        updateMempicsPagination(filter);
        grid.innerHTML = '';
        renderedMempicsCards = [];
        renderedMempicsContentSignature = '';

        let list = [];
        if (filter === MEMPICS_CATEGORY) {
            renderGalleryState(localeText('browse.loadingMempics'));
            try {
                await ensureMempicsLoaded();
                list = mempicsState.items.slice(0, getVisibleMempicsCount());
            } catch {
                if (seq !== renderSeq) return;
                Array.from(grid.querySelectorAll('.gallery-empty-state')).forEach((node) => node.remove());
                renderGalleryState(localeText('browse.mempicsLoadFailed'));
                syncCategoryGhostModels('gallery', []);
                updateMempicsPagination(filter, localeText('browse.mempicsLoadFailed'));
                return;
            }
            if (seq !== renderSeq) return;
            Array.from(grid.querySelectorAll('.gallery-empty-state')).forEach((node) => node.remove());
        }

        if (!list.length) {
            renderGalleryState(localeText('browse.noMempics'));
            syncCategoryGhostModels('gallery', []);
            updateMempicsPagination(filter);
            return;
        }

        renderGalleryCards(list, getMempicsContentSignature(list));
        syncCategoryGhostModels('gallery', list);
        updateMempicsPagination(filter);
        scheduleMempicsWideLimitSync();
    }

    render(MEMPICS_CATEGORY);
    $loadMore?.addEventListener('click', () => {
        loadMoreMempics();
    });
    $paginationStatus.addEventListener('click', openMempicsOverlay);

    $drawerToggle?.addEventListener('click', () => {
        const previousScrollY = window.scrollY;
        revealNextMempicsBatch();
        window.requestAnimationFrame(() => {
            if (window.scrollY + 1 < previousScrollY) {
                window.scrollTo({ top: previousScrollY, behavior: 'auto' });
            }
        });
    });

    function openModal(item) {
        const mi = document.getElementById('modalImage');
        const fullLink = document.getElementById('modalFullLink');
        const content = modal.querySelector('.modal-content');
        const card = modal.querySelector('.modal-card');
        let detailSlot = modal.querySelector('.public-media-detail-slot');
        if (!detailSlot) {
            detailSlot = document.createElement('div');
            detailSlot.className = 'public-media-detail-slot';
            card?.appendChild(detailSlot);
        }
        if (galleryDetailPanel) {
            galleryDetailPanel.destroy();
            galleryDetailPanel = null;
        }
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
        content?.classList.add('modal-content--public-detail');
        card?.classList.add('modal-card--public-detail');
        modal.setAttribute('aria-label', item.title || localeText('browse.mediaDetails'));
        modal.removeAttribute('aria-labelledby');
        galleryDetailPanel = createPublicMediaDetailPanel({
            item,
            collection: 'mempics',
            onCommentCountChange(count) {
                item.comment_count = count;
            },
        });
        detailSlot.appendChild(galleryDetailPanel.root);

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
        const content = modal.querySelector('.modal-content');
        const card = modal.querySelector('.modal-card');
        if (galleryDetailPanel) {
            galleryDetailPanel.destroy();
            galleryDetailPanel = null;
        }
        if (fullLink) {
            fullLink.href = '#';
            fullLink.hidden = true;
            fullLink.setAttribute('tabindex', '-1');
            fullLink.onclick = null;
        }
        content?.classList.remove('modal-content--public-detail');
        card?.classList.remove('modal-card--public-detail');
        modal.removeAttribute('aria-label');
        modal.setAttribute('aria-labelledby', 'modalTitle');
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        suppressNextGalleryCardClick = true;
        window.setTimeout(() => {
            suppressNextGalleryCardClick = false;
        }, 400);
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
        const targets = getMobileDeckDotTargets(all.length, MAX_MOBILE_DECK_DOTS);
        if (targets.length <= 1) { galDotsEl = null; return; }
        const activeDot = getMobileDeckActiveDotIndex(galActive, targets);
        galDotsEl = document.createElement('div');
        galDotsEl.className = 'gal-deck-dots';
        galDotsEl.setAttribute('role', 'tablist');
        galDotsEl.setAttribute('aria-label', localeText('browse.galleryCards'));
        targets.forEach((target, i) => {
            const d = document.createElement('button');
            d.type = 'button';
            d.className = 'gal-deck-dot' + (i === activeDot ? ' active' : '');
            d.setAttribute('role', 'tab');
            d.setAttribute('aria-selected', i === activeDot ? 'true' : 'false');
            d.setAttribute('aria-label', `Show card ${target + 1}`);
            d.dataset.targetIndex = String(target);
            d.addEventListener('click', () => { galActive = target; galLayout(); galSyncDots(); });
            galDotsEl.appendChild(d);
        });
        grid.after(galDotsEl);
    }

    function galSyncDots() {
        if (!galDotsEl) return;
        const dots = galDotsEl.querySelectorAll('.gal-deck-dot');
        const all = galGetCards();
        const targets = getMobileDeckDotTargets(all.length, MAX_MOBILE_DECK_DOTS);
        if (dots.length !== targets.length) { galBuildDots(); return; }
        const activeDot = getMobileDeckActiveDotIndex(galActive, targets);
        dots.forEach((d, i) => {
            d.classList.toggle('active', i === activeDot);
            d.setAttribute('aria-selected', i === activeDot ? 'true' : 'false');
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

    bindMediaQueryChange(publicWideLayoutQuery, () => {
        scheduleMempicsBreakpointRender();
    });
    bindMediaQueryChange(mobileMediaQuery, () => {
        updateMempicsPagination(currentFilter);
    });

    if ('ResizeObserver' in window) {
        mempicsResizeObserver = new ResizeObserver(scheduleMempicsWideLimitSync);
        mempicsResizeObserver.observe(grid);
        if (grid.parentElement) mempicsResizeObserver.observe(grid.parentElement);
    } else {
        window.addEventListener('resize', scheduleMempicsWideLimitSync, { passive: true });
    }
    const handleMempicsCategoryActivation = (event) => {
        if (event?.detail?.category !== 'gallery') return;
        scheduleMempicsWideLimitSync();
    };
    const handleMempicsCategoryLayoutRequest = (event) => {
        if (event?.detail?.category !== 'gallery') return;
        if (!isPublicWideLayoutEnabled() || currentFilter !== MEMPICS_CATEGORY || !mempicsState.loaded) return;
        const preparation = reflowMempicsFromCache();
        if (preparation && typeof preparation.then === 'function') {
            event.detail.waitUntil?.(preparation);
        } else if (preparation === true) {
            event.detail.waitUntil?.(Promise.resolve());
        }
    };
    document.addEventListener('bitbi:homepage-category-activated', handleMempicsCategoryActivation);
    document.addEventListener('bitbi:homepage-category-layout-request', handleMempicsCategoryLayoutRequest);
    document.fonts?.ready?.then(scheduleMempicsWideLimitSync).catch(() => {});

    function galEngage() {
        if (galIsDeck) return;
        galIsDeck = true;
        galActive = 0;
        grid.classList.add('gal-deck');
        if (mempicsState.loaded) {
            scheduleMempicsBreakpointRender();
        } else {
            galRenderDeck();
        }
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
        scheduleMempicsBreakpointRender();
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

    window.addEventListener('pagehide', (event) => {
        if (event.persisted) return;
        if (galGridObserver) { galGridObserver.disconnect(); galGridObserver = null; }
        if (mempicsResizeObserver) { mempicsResizeObserver.disconnect(); mempicsResizeObserver = null; }
        document.removeEventListener('bitbi:homepage-category-activated', handleMempicsCategoryActivation);
        document.removeEventListener('bitbi:homepage-category-layout-request', handleMempicsCategoryLayoutRequest);
        window.removeEventListener('resize', scheduleMempicsWideLimitSync);
        window.removeEventListener('scroll', handleMempicsProgressiveScroll);
        window.cancelAnimationFrame(mempicsResizeFrame);
        window.cancelAnimationFrame(mempicsBreakpointRenderFrame);
        disconnectMempicsObserver();
    });
}
