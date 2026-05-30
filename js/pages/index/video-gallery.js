/* ============================================================
   BITBI — Video gallery (Memvids) rendering + modal player
   Mirrors gallery.js pattern for the Video Creations section
   ============================================================ */

import { setupFocusTrap } from '../../shared/focus-trap.js';
import { createStarButton } from '../../shared/favorites.js';
import {
    MAX_MOBILE_DECK_DOTS,
    initMobileCardDeck,
} from '../../shared/studio-deck.js?v=__ASSET_VERSION__';
import {
    getMobileMediaGridQuery,
    openMobileMediaGrid,
    syncMobileMediaTrigger,
} from './mobile-media-overlay.js?v=__ASSET_VERSION__';
import { syncCategoryGhostModels } from './category-ghost-models.js?v=__ASSET_VERSION__';
import {
    fetchPublicMemvidsPage,
    getPublicMemvidIdentity,
    orderPublicMemvidItems,
} from './public-memvids.js?v=__ASSET_VERSION__';
import {
    calculateFixedMediaWallMetrics,
    clearFixedMediaWallLayout,
    renderFixedMediaWallColumns,
} from './public-media-wall.js?v=__ASSET_VERSION__';
import { localeText } from '../../shared/locale.js?v=__ASSET_VERSION__';

const MEMVIDS_LIMIT = 60;
const DESKTOP_HOVER_MEDIA = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';
const TABLET_DESKTOP_LAYOUT_MEDIA = [
    '(min-width: 768px) and (max-width: 1023px) and (min-height: 700px)',
    '(min-width: 1024px) and (hover: none) and (pointer: coarse) and (min-height: 700px)',
].join(', ');
const PUBLIC_WIDE_LAYOUT_MEDIA = `${DESKTOP_HOVER_MEDIA}, ${TABLET_DESKTOP_LAYOUT_MEDIA}`;
const PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT = 60;
const PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT = 100;
const PUBLIC_EXPLORE_MIN_PREFETCH_PAGE_SIZE = 20;
const WIDE_COLUMN_FALLBACK_PX = 270;
// Small non-zero intent delay avoids accidental Stream minute usage across dense grids.
const HOVER_PREVIEW_DELAY_MS = 100;

let focusTrapCleanup = null;

export function initVideoGallery() {
    const container = document.getElementById('videoExplore');
    const $pagination = document.getElementById('videoPagination');
    if (!container) return;

    const publicWideLayoutQuery = window.matchMedia?.(PUBLIC_WIDE_LAYOUT_MEDIA);
    const desktopHoverQuery = window.matchMedia?.(DESKTOP_HOVER_MEDIA);
    const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const mobileMediaQuery = getMobileMediaGridQuery();
    const memvidsState = {
        items: [],
        nextCursor: null,
        hasMore: false,
        loaded: false,
        loadingMore: false,
    };
    let memvidsVisibleLimit = PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT;
    let memvidsObserver = null;
    let memvidsResizeObserver = null;
    let memvidsStageObserver = null;
    let memvidsResizeFrame = 0;
    let memvidsResizeSettledTimer = 0;
    let activeHoverPreview = null;

    /* Replace the teaser placeholder with a live grid */
    container.innerHTML = '';

    const grid = document.createElement('div');
    grid.id = 'videoGrid';
    grid.className = 'grid-video';
    container.appendChild(grid);
    const deck = initMobileCardDeck(grid, {
        cardClass: 'video-card',
        dotsLabel: localeText('browse.videoCards'),
        itemLabel: localeText('browse.videoItem'),
        deckClass: 'vid-deck',
        dotsClass: 'vid-deck-dots',
        dotClass: 'vid-deck-dot',
        maxDots: MAX_MOBILE_DECK_DOTS,
        dotTargetMode: 'proportional',
    });

    const $paginationStatus = document.createElement('button');
    $paginationStatus.type = 'button';
    $paginationStatus.className = 'browse-pagination__status';
    const $drawerToggle = document.createElement('button');
    $drawerToggle.type = 'button';
    $drawerToggle.className = 'browse-pagination__toggle';
    $drawerToggle.setAttribute('aria-controls', 'videoGrid');
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

    function getVisibleMemvidsCount() {
        return Math.min(memvidsVisibleLimit, memvidsState.items.length, PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT);
    }

    function syncWideColumnCount(itemCount = 0) {
        return getWideLayoutMetrics(itemCount).columnCount;
    }

    function getWideLayoutMetrics(itemCount = 0) {
        return calculateFixedMediaWallMetrics(grid, {
            targetWidthProperty: '--bitbi-public-video-active-column-width',
            fallbackColumnWidth: WIDE_COLUMN_FALLBACK_PX,
            itemCount,
        });
    }

    function syncMemvidsWideLimitForLayout() {
        const previousColumnCount = grid.style.getPropertyValue('--bitbi-public-video-column-count');
        const visibleCount = getVisibleMemvidsCount();
        const nextMetrics = isPublicWideLayoutEnabled()
            ? getWideLayoutMetrics(visibleCount)
            : { columnCount: 1, resolvedWidthPx: 0 };
        const nextColumnCount = nextMetrics.columnCount;
        const columnCountChanged = isPublicWideLayoutEnabled()
            && !!previousColumnCount
            && previousColumnCount !== String(nextColumnCount);
        const previousAvailableWidth = Number(grid.dataset.mediaWallAvailableWidth) || 0;
        const availableWidthBecameReady = isPublicWideLayoutEnabled()
            && nextMetrics.availableWidthPx > 0
            && previousAvailableWidth <= 0;
        const previousResolvedWidth = Number(grid.dataset.mediaWallResolvedWidth) || 0;
        const resolvedWidthChanged = isPublicWideLayoutEnabled()
            && previousResolvedWidth > 0
            && Math.abs(previousResolvedWidth - nextMetrics.resolvedWidthPx) > 0.1;
        if (!isPublicWideLayoutEnabled() || !memvidsState.loaded) return;
        if (!columnCountChanged && !resolvedWidthChanged && !availableWidthBecameReady) return;
        render();
    }

    function scheduleMemvidsWideLimitSync() {
        window.clearTimeout(memvidsResizeSettledTimer);
        memvidsResizeSettledTimer = window.setTimeout(syncMemvidsWideLimitForLayout, 90);
        if (memvidsResizeFrame) return;
        memvidsResizeFrame = window.requestAnimationFrame(() => {
            memvidsResizeFrame = 0;
            syncMemvidsWideLimitForLayout();
        });
    }

    function handleMemvidsCategoryActivation(event) {
        if (event?.detail?.category !== 'video') return;
        scheduleMemvidsWideLimitSync();
        [120, 240, 480, 900, 1400].forEach((delay) => {
            window.setTimeout(scheduleMemvidsWideLimitSync, delay);
        });
    }

    function canRevealMoreMemvids() {
        const visibleCount = getVisibleMemvidsCount();
        return visibleCount < PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT
            && (memvidsState.items.length > visibleCount || memvidsState.hasMore);
    }

    function resetMemvidsWideWindow() {
        memvidsVisibleLimit = PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT;
    }

    /* ── Modal ── */
    const modal = buildVideoModal();
    document.body.appendChild(modal.root);

    function renderState(message) {
        const el = document.createElement('div');
        el.className = 'video-empty-state';
        el.textContent = message;
        grid.appendChild(el);
    }

    function getMemvidIdentity(item) {
        return getPublicMemvidIdentity(item);
    }

    function isSafeCloudflareStreamPlaybackUrl(value) {
        if (!value) return false;
        try {
            const url = new URL(value, window.location.origin);
            if (url.protocol !== 'https:') return false;
            return url.hostname === 'videodelivery.net'
                || url.hostname === 'iframe.videodelivery.net'
                || url.hostname.endsWith('.videodelivery.net')
                || url.hostname === 'cloudflarestream.com'
                || url.hostname.endsWith('.cloudflarestream.com');
        } catch {
            return false;
        }
    }

    function normalizeStreamPreviewUid(value) {
        const uid = String(value || '').trim();
        return /^[A-Za-z0-9_-]{8,128}$/.test(uid) ? uid : '';
    }

    function getMemvidHoverPreview(item) {
        const preview = item?.stream_preview;
        if (!preview || preview.provider !== 'cloudflare_stream') return null;
        if (preview.autoplay_enabled === false) return null;
        const uid = normalizeStreamPreviewUid(preview.uid);
        if (!uid) return null;
        const playback = preview.playback || {};
        const src = isSafeCloudflareStreamPlaybackUrl(playback.mp4_url)
            ? playback.mp4_url
            : isSafeCloudflareStreamPlaybackUrl(playback.hls_url)
            ? playback.hls_url
            : `https://videodelivery.net/${encodeURIComponent(uid)}/manifest/video.m3u8`;
        const fallbackSrc = src !== playback.hls_url && isSafeCloudflareStreamPlaybackUrl(playback.hls_url)
            ? playback.hls_url
            : '';
        const maxLoopCount = Math.max(1, Math.min(3, Number(preview.max_loop_count || 3) || 3));
        return {
            uid,
            src,
            fallbackSrc,
            maxLoopCount,
            durationSeconds: Math.max(1, Number(preview.preview_duration_seconds || 5) || 5),
        };
    }

    function canUseHoverPreview() {
        return !!desktopHoverQuery?.matches && !reducedMotionQuery?.matches;
    }

    function isMouseHoverPointer(event) {
        return event?.pointerType === 'mouse';
    }

    function resetHoverPreviewVideo(video) {
        if (!video) return;
        video.pause();
        try { video.currentTime = 0; } catch { /* Some browsers disallow seeking before metadata. */ }
        video.removeAttribute('src');
        delete video.dataset.previewSrc;
        try { video.load(); } catch { /* noop */ }
    }

    function stopActiveHoverPreview(card = null) {
        if (!activeHoverPreview) return;
        if (card && activeHoverPreview.card !== card) return;
        const { card: activeCard, video, timerId, endedHandler, errorHandler, readyHandler } = activeHoverPreview;
        window.clearTimeout(timerId);
        activeCard.classList.remove('video-card--hover-preview-active');
        if (video && endedHandler) {
            video.removeEventListener('ended', endedHandler);
        }
        if (video && errorHandler) {
            video.removeEventListener('error', errorHandler);
        }
        if (video && readyHandler) {
            video.removeEventListener('loadeddata', readyHandler);
            video.removeEventListener('canplay', readyHandler);
            video.removeEventListener('playing', readyHandler);
        }
        resetHoverPreviewVideo(video);
        video?.remove();
        activeHoverPreview = null;
    }

    function ensureHoverPreviewVideo(card, posterUrl = '') {
        const poster = card.querySelector('.video-card__poster');
        if (!poster) return null;
        let video = poster.querySelector('.video-card__hover-preview');
        if (!video) {
            video = document.createElement('video');
            video.className = 'video-card__hover-preview';
            video.setAttribute('aria-hidden', 'true');
            video.setAttribute('playsinline', '');
            video.tabIndex = -1;
            video.preload = 'none';
            video.controls = false;
            video.disablePictureInPicture = true;
            const playIcon = poster.querySelector('.video-card__play');
            poster.insertBefore(video, playIcon || null);
        }
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.preload = 'none';
        if (posterUrl) video.poster = posterUrl;
        return video;
    }

    function recordHoverPreviewStart(item, preview) {
        const id = getMemvidIdentity(item);
        if (!id || !preview?.uid) return;
        const url = `/api/gallery/memvids/${encodeURIComponent(id)}/stream-preview/hover-start`;
        const payload = JSON.stringify({
            provider: 'cloudflare_stream',
            uid: preview.uid,
            loop_count: preview.maxLoopCount,
            preview_duration_seconds: preview.durationSeconds,
        });
        try {
            if (navigator.sendBeacon) {
                const blob = new Blob([payload], { type: 'application/json' });
                navigator.sendBeacon(url, blob);
                return;
            }
        } catch { /* Fall through to fetch. */ }
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            keepalive: true,
            body: payload,
        }).catch(() => {});
    }

    function startHoverPreview(card, item, preview, posterUrl = '') {
        if (!activeHoverPreview || activeHoverPreview.card !== card || !preview?.src) return;
        if (!canUseHoverPreview()) {
            stopActiveHoverPreview(card);
            return;
        }

        const video = ensureHoverPreviewVideo(card, posterUrl);
        if (!video) {
            stopActiveHoverPreview(card);
            return;
        }
        let loopCount = 0;
        let startRecorded = false;
        const revealPreview = () => {
            if (!activeHoverPreview || activeHoverPreview.card !== card || activeHoverPreview.video !== video) return;
            card.classList.add('video-card--hover-preview-active');
            if (!startRecorded) {
                startRecorded = true;
                recordHoverPreviewStart(item, preview);
            }
        };
        const endedHandler = () => {
            loopCount += 1;
            video.dataset.loopCount = String(loopCount);
            if (loopCount >= preview.maxLoopCount) {
                stopActiveHoverPreview(card);
                return;
            }
            try { video.currentTime = 0; } catch { /* noop */ }
            const replay = video.play();
            if (replay && typeof replay.catch === 'function') replay.catch(() => stopActiveHoverPreview(card));
        };
        let fallbackAttempted = false;
        const errorHandler = () => {
            if (fallbackAttempted || !preview.fallbackSrc || video.src === preview.fallbackSrc) {
                stopActiveHoverPreview(card);
                return;
            }
            fallbackAttempted = true;
            video.src = preview.fallbackSrc;
            video.dataset.previewSrc = preview.fallbackSrc;
            const fallbackPlay = video.play();
            if (fallbackPlay && typeof fallbackPlay.catch === 'function') {
                fallbackPlay.catch(() => stopActiveHoverPreview(card));
            }
        };
        video.addEventListener('ended', endedHandler);
        video.addEventListener('error', errorHandler);
        video.addEventListener('loadeddata', revealPreview);
        video.addEventListener('canplay', revealPreview);
        video.addEventListener('playing', revealPreview);
        video.src = preview.src;
        video.dataset.previewSrc = preview.src;
        video.dataset.previewProvider = 'cloudflare_stream';
        video.dataset.maxLoopCount = String(preview.maxLoopCount);
        activeHoverPreview.video = video;
        activeHoverPreview.endedHandler = endedHandler;
        activeHoverPreview.errorHandler = errorHandler;
        activeHoverPreview.readyHandler = revealPreview;
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
                if (activeHoverPreview?.video === video) stopActiveHoverPreview(card);
            });
        }
    }

    function scheduleHoverPreview(card, item, preview, posterUrl = '') {
        if (!canUseHoverPreview() || !preview?.src) return;
        if (activeHoverPreview?.card && activeHoverPreview.card !== card) {
            stopActiveHoverPreview();
        }
        if (activeHoverPreview?.card === card) {
            stopActiveHoverPreview(card);
        }
        const timerId = window.setTimeout(() => {
            startHoverPreview(card, item, preview, posterUrl);
        }, HOVER_PREVIEW_DELAY_MS);
        activeHoverPreview = { card, video: null, timerId, endedHandler: null, errorHandler: null, readyHandler: null };
    }

    function bindHoverPreview(card, item) {
        const preview = getMemvidHoverPreview(item);
        if (!preview) return;
        const posterUrl = item?.poster?.url || '';

        card.addEventListener('pointerenter', (event) => {
            if (!isMouseHoverPointer(event)) return;
            scheduleHoverPreview(card, item, preview, posterUrl);
        });
        card.addEventListener('pointerleave', () => {
            stopActiveHoverPreview(card);
        });
        card.addEventListener('pointercancel', () => {
            stopActiveHoverPreview(card);
        });
        card.addEventListener('blur', () => {
            stopActiveHoverPreview(card);
        });
    }

    function getMemvidDimensions(item) {
        const width = Number(item?.poster?.w || item?.preview?.w || item?.width || item?.video_width);
        const height = Number(item?.poster?.h || item?.preview?.h || item?.height || item?.video_height);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            return { width: 16, height: 9 };
        }
        return { width, height };
    }

    function getMemvidAspectMeta(item) {
        const { width, height } = getMemvidDimensions(item);
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

    function normalizeMemvidText(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function getMemvidPromptTexts(item) {
        const promptCandidates = [
            item?.prompt,
            item?.generation_prompt,
            item?.input_prompt,
            item?.source_prompt,
            item?.description,
            item?.generation_description,
            item?.prompt_description,
            item?.raw_prompt,
            item?.raw_description,
            item?.raw_prompt_description,
            item?.preview_text,
            item?.metadata?.prompt,
            item?.metadata?.generation_prompt,
            item?.metadata?.input_prompt,
            item?.metadata?.source_prompt,
            item?.metadata?.description,
            item?.metadata?.generation_description,
            item?.metadata?.prompt_description,
            item?.metadata?.raw_prompt,
            item?.metadata?.raw_description,
            item?.metadata?.raw_prompt_description,
            item?.metadata?.preview_text,
        ];
        return promptCandidates.map(normalizeMemvidText).filter(Boolean);
    }

    function memvidTextMatchesPrompt(text, prompts) {
        const normalizedText = normalizeMemvidText(text).toLowerCase();
        if (!normalizedText) return false;
        const promptTexts = Array.isArray(prompts) ? prompts : [prompts];
        return promptTexts.some((prompt) => normalizeMemvidText(prompt).toLowerCase() === normalizedText);
    }

    function isMemvidPromptSource(value) {
        return [
            'prompt',
            'generation_prompt',
            'input_prompt',
            'source_prompt',
            'description',
            'generation_description',
            'prompt_description',
        ].includes(normalizeMemvidText(value).toLowerCase());
    }

    function getMemvidDisplayTitle(item) {
        const title = normalizeMemvidText(item?.display_title || item?.asset_title || item?.name || item?.title);
        if (!title || title.toLowerCase() === 'memvids') return '';
        const source = normalizeMemvidText(item?.title_source || item?.titleSource).toLowerCase();
        if (isMemvidPromptSource(source) || item?.title_is_prompt === true || item?.is_prompt_title === true) return '';
        if (memvidTextMatchesPrompt(title, getMemvidPromptTexts(item))) return '';
        return title;
    }

    function getMemvidDisplayCaption(item) {
        const caption = normalizeMemvidText(item?.caption);
        if (!caption) return '';
        const source = normalizeMemvidText(item?.caption_source || item?.captionSource).toLowerCase();
        if (isMemvidPromptSource(source) || item?.caption_is_prompt === true || item?.is_prompt_caption === true) return '';
        if (memvidTextMatchesPrompt(caption, getMemvidPromptTexts(item))) return '';
        return caption;
    }

    function mergeMemvidsItems(items, { replace = false } = {}) {
        const nextItems = replace ? [] : memvidsState.items.slice();
        const seen = new Set(nextItems.map(getMemvidIdentity).filter(Boolean));
        (Array.isArray(items) ? items : []).forEach((item) => {
            const identity = getMemvidIdentity(item);
            if (identity && seen.has(identity)) return;
            if (identity) seen.add(identity);
            nextItems.push(item);
        });
        memvidsState.items = orderPublicMemvidItems(nextItems);
    }

    function openMemvidsOverlay() {
        openMobileMediaGrid({
            title: 'Memvids',
            items: memvidsState.items.slice(0, getVisibleMemvidsCount()),
            emptyText: localeText('browse.noMemvids'),
            className: 'mobile-media-grid-overlay--video',
            renderItem(item, index, { openDetail } = {}) {
                const displayTitle = getMemvidDisplayTitle(item);
                const safeTitle = displayTitle || `Memvid ${index + 1}`;
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'mobile-media-grid-overlay__item mobile-media-grid-overlay__item--video';
                button.setAttribute('aria-label', displayTitle || localeText('browse.showMemvid', { count: index + 1 }));

                const poster = item.poster?.url || '';
                if (poster) {
                    const img = new Image();
                    img.src = poster;
                    img.alt = '';
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    button.appendChild(img);
                } else {
                    const fallback = document.createElement('span');
                    fallback.className = 'mobile-media-grid-overlay__fallback';
                    fallback.textContent = '\u25b6';
                    button.appendChild(fallback);
                }

                const label = document.createElement('span');
                label.className = 'mobile-media-grid-overlay__item-label';
                label.textContent = safeTitle;
                button.appendChild(label);

                button.addEventListener('click', () => {
                    if (typeof openDetail === 'function') {
                        openDetail({
                            title: safeTitle,
                            className: 'mobile-media-detail-overlay--video',
                            renderContent() {
                                const wrap = document.createElement('div');
                                wrap.className = 'mobile-media-detail-overlay__media mobile-media-detail-overlay__media--video';
                                const video = document.createElement('video');
                                video.controls = true;
                                video.autoplay = true;
                                video.playsInline = true;
                                video.preload = 'auto';
                                video.src = item.file?.url || '';
                                if (item.poster?.url) video.poster = item.poster.url;
                                wrap.appendChild(video);
                                return {
                                    node: wrap,
                                    cleanup() {
                                        video.pause();
                                        video.removeAttribute('src');
                                        try { video.load(); } catch (_) { /* noop */ }
                                    },
                                };
                            },
                        });
                        return;
                    }
                    deck.setActive?.(index);
                    grid.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
                });
                return button;
            },
        });
    }

    function updateMemvidsPagination(errorMessage = '') {
        if (!$pagination) return;
        if (errorMessage) {
            $pagination.style.display = '';
            $paginationStatus.textContent = errorMessage;
            syncMobileMediaTrigger($paginationStatus, { enabled: false, label: localeText('browse.openMemvidsGrid') });
            $drawerToggle.hidden = true;
            $drawerToggle.textContent = '';
            $loadMore.hidden = true;
            $loadMore.textContent = '';
            $loadMore.disabled = false;
            $scrollSentinel.hidden = true;
            syncMemvidsScrollLoading();
            return;
        }
        if (!memvidsState.items.length) {
            $pagination.style.display = 'none';
            syncMobileMediaTrigger($paginationStatus, { enabled: false, label: localeText('browse.openMemvidsGrid') });
            $scrollSentinel.hidden = true;
            syncMemvidsScrollLoading();
            return;
        }
        const visibleCount = getVisibleMemvidsCount();
        const canRevealMore = canRevealMoreMemvids();
        const useUnderfilledLoadMore = canRevealMore
            && memvidsState.hasMore
            && memvidsState.items.length < PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT
            && memvidsState.items.length < PUBLIC_EXPLORE_MIN_PREFETCH_PAGE_SIZE;
        const showDrawerToggle = canRevealMore && !useUnderfilledLoadMore;
        const showLoadMore = useUnderfilledLoadMore;
        $pagination.style.display = '';
        if (canRevealMore) {
            $paginationStatus.textContent = localeText('browse.showingMemvidsComplete', { count: visibleCount });
        } else if (memvidsState.hasMore) {
            $paginationStatus.textContent = localeText('browse.showingMemvidsComplete', { count: visibleCount });
        } else {
            $paginationStatus.textContent = localeText('browse.showingAllMemvidsComplete', { count: visibleCount });
        }
        syncMobileMediaTrigger($paginationStatus, {
            enabled: memvidsState.items.length > 0,
            label: localeText('browse.openMemvidsGrid'),
        });
        $drawerToggle.hidden = !showDrawerToggle;
        $drawerToggle.textContent = showDrawerToggle
            ? (memvidsState.loadingMore ? localeText('browse.loading') : localeText('browse.showMore'))
            : '';
        $drawerToggle.disabled = memvidsState.loadingMore;
        $drawerToggle.setAttribute('aria-expanded', 'false');
        $loadMore.hidden = !showLoadMore;
        $loadMore.disabled = memvidsState.loadingMore;
        $loadMore.textContent = showLoadMore
            ? (memvidsState.loadingMore ? localeText('browse.loading') : localeText('browse.loadMore'))
            : '';
        $scrollSentinel.hidden = true;
        syncMemvidsScrollLoading();
    }

    async function fetchMemvids(cursor = null, limit = MEMVIDS_LIMIT) {
        try {
            const safeLimit = Math.max(1, Math.min(MEMVIDS_LIMIT, Number(limit) || MEMVIDS_LIMIT));
            return await fetchPublicMemvidsPage({ limit: safeLimit, cursor });
        } catch (error) {
            console.warn('memvids:', error);
            throw error;
        }
    }

    async function ensureMemvidsLoaded() {
        if (memvidsState.loaded) return;
        const page = await fetchMemvids(null, PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT);
        mergeMemvidsItems(page.items, { replace: true });
        if (memvidsState.items.length > PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT) {
            memvidsState.items = memvidsState.items.slice(0, PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT);
        }
        memvidsState.nextCursor = page.nextCursor;
        memvidsState.hasMore = page.hasMore;
        if ((page.items?.length || 0) >= PUBLIC_EXPLORE_MIN_PREFETCH_PAGE_SIZE) {
            await loadMemvidsUntilVisible(PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT);
        }
        memvidsState.loaded = true;
        resetMemvidsWideWindow();
    }

    async function fetchNextMemvidsPage({ updateUi = true, limit = MEMVIDS_LIMIT } = {}) {
        if (!memvidsState.hasMore || memvidsState.loadingMore || memvidsState.items.length >= PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT) return false;
        memvidsState.loadingMore = true;
        if (updateUi) updateMemvidsPagination();
        try {
            const remaining = Math.max(1, PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT - memvidsState.items.length);
            const page = await fetchMemvids(memvidsState.nextCursor, Math.min(limit, remaining));
            const beforeCount = memvidsState.items.length;
            mergeMemvidsItems(page.items);
            if (memvidsState.items.length > PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT) {
                memvidsState.items = memvidsState.items.slice(0, PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT);
            }
            memvidsState.nextCursor = page.nextCursor;
            memvidsState.hasMore = page.hasMore;
            return memvidsState.items.length > beforeCount;
        } finally {
            memvidsState.loadingMore = false;
            if (updateUi) updateMemvidsPagination();
        }
    }

    async function loadMemvidsUntilVisible(targetCount, { updateUi = false } = {}) {
        const safeTarget = Math.min(PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT, Math.max(0, Number(targetCount) || 0));
        while (memvidsState.items.length < safeTarget && memvidsState.hasMore) {
            const beforeCount = memvidsState.items.length;
            const fetched = await fetchNextMemvidsPage({
                updateUi,
                limit: safeTarget - beforeCount,
            });
            if (!fetched || memvidsState.items.length <= beforeCount) break;
        }
    }

    async function revealNextMemvidsBatch() {
        return loadMoreMemvids();
    }

    function shouldUseMemvidsScrollLoading() {
        return false;
    }

    function maybeRevealMemvidsFromScroll() {
        return undefined;
    }

    function handleMemvidsProgressiveScroll() {
        maybeRevealMemvidsFromScroll();
    }

    function handleMemvidsIntersection(entries) {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        maybeRevealMemvidsFromScroll();
    }

    function disconnectMemvidsObserver() {
        if (!memvidsObserver) return;
        memvidsObserver.disconnect();
        memvidsObserver = null;
    }

    function syncMemvidsScrollLoading() {
        window.removeEventListener('scroll', handleMemvidsProgressiveScroll);
        disconnectMemvidsObserver();
    }

    function buildVideoCard(item) {
        const card = document.createElement('div');
        card.className = 'video-card';
        const itemIdentity = getMemvidIdentity(item);
        if (itemIdentity) card.dataset.videoItemId = itemIdentity;
        const aspectMeta = getMemvidAspectMeta(item);
        const publisher = item.publisher || null;
        const publisherDisplayName = normalizeMemvidText(publisher?.display_name);
        const displayCaption = getMemvidDisplayCaption(item);
        const safeLabel = publisherDisplayName || 'Video';
        card.classList.add(`video-card--${aspectMeta.orientation}`);
        card.dataset.videoAspect = aspectMeta.orientation;
        card.style.setProperty('--video-item-aspect', aspectMeta.ratio);
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', safeLabel);

        const inner = document.createElement('div');
        inner.className = 'video-card__inner rounded-xl overflow-hidden relative';

        /* Poster area — generated thumbnail or gradient fallback */
        const poster = document.createElement('div');
        poster.className = 'video-card__poster';

        if (item.poster) {
            const img = document.createElement('img');
            img.className = 'video-card__preview';
            img.src = item.poster.url;
            img.alt = 'Video thumbnail';
            img.loading = 'lazy';
            img.decoding = 'async';
            if (item.poster.w) img.width = item.poster.w;
            if (item.poster.h) img.height = item.poster.h;
            poster.appendChild(img);
        } else {
            const fallback = document.createElement('div');
            fallback.className = 'video-card__poster-state';
            fallback.setAttribute('aria-hidden', 'true');
            const title = document.createElement('strong');
            title.textContent = localeText('browse.videoPosterPending');
            const hint = document.createElement('span');
            hint.textContent = localeText('browse.videoPosterPendingHint');
            fallback.append(title, hint);
            poster.appendChild(fallback);
        }

        const playIcon = document.createElement('div');
        playIcon.className = 'video-card__play';
        playIcon.setAttribute('aria-hidden', 'true');
        playIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        poster.appendChild(playIcon);

        const star = createStarButton('video', item.id, {
            title: publisherDisplayName || 'Video',
            thumb_url: item.poster?.url || '',
        });
        star.style.cssText = 'position:absolute;top:8px;right:8px';
        poster.appendChild(star);

        inner.appendChild(poster);

        /* Info overlay */
        const info = document.createElement('div');
        info.className = 'video-card__info';

        const publisherRow = document.createElement('div');
        publisherRow.className = 'public-media-meta__identity public-media-meta__identity--video';
        if (publisher?.avatar?.url) {
            const avatar = document.createElement('img');
            avatar.className = 'public-media-meta__avatar';
            avatar.src = publisher.avatar.url;
            avatar.alt = '';
            avatar.loading = 'lazy';
            avatar.decoding = 'async';
            avatar.onerror = () => avatar.remove();
            publisherRow.appendChild(avatar);
        }

        const publisherName = document.createElement('h4');
        publisherName.className = 'video-card__title';
        publisherName.textContent = publisherDisplayName || 'Memvids';
        publisherRow.appendChild(publisherName);
        info.appendChild(publisherRow);

        if (displayCaption) {
            const caption = document.createElement('p');
            caption.className = 'video-card__caption';
            caption.textContent = displayCaption;
            info.appendChild(caption);
        }

        inner.appendChild(info);
        card.appendChild(inner);

        bindHoverPreview(card, item);

        card.addEventListener('click', () => {
            stopActiveHoverPreview(card);
            openVideoModal(item);
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                stopActiveHoverPreview(card);
                openVideoModal(item);
            }
        });

        return card;
    }

    function renderVideoCards(items) {
        const cards = items.map(buildVideoCard);
        if (!isPublicWideLayoutEnabled()) {
            clearFixedMediaWallLayout(grid, {
                countProperty: '--bitbi-public-video-column-count',
            });
            grid.append(...cards);
            return;
        }
        renderFixedMediaWallColumns(grid, cards, {
            countProperty: '--bitbi-public-video-column-count',
            targetWidthProperty: '--bitbi-public-video-active-column-width',
            fallbackColumnWidth: WIDE_COLUMN_FALLBACK_PX,
            aspectProperty: '--video-item-aspect',
            fallbackAspectRatio: 1.778,
            estimatedExtraHeight: 74,
        });
    }

    async function render() {
        stopActiveHoverPreview();
        grid.innerHTML = '';
        renderState(localeText('browse.loadingMemvids'));
        updateMemvidsPagination();

        let items;
        try {
            await ensureMemvidsLoaded();
            items = memvidsState.items.slice(0, getVisibleMemvidsCount());
        } catch {
            grid.innerHTML = '';
            renderState(localeText('browse.memvidsLoadFailed'));
            syncCategoryGhostModels('video', []);
            updateMemvidsPagination(localeText('browse.memvidsLoadFailed'));
            return;
        }

        grid.innerHTML = '';

        if (!items.length) {
            renderState(localeText('browse.noMemvids'));
            syncCategoryGhostModels('video', []);
            updateMemvidsPagination();
            return;
        }

        renderVideoCards(items);
        syncCategoryGhostModels('video', items);
        updateMemvidsPagination();
        scheduleMemvidsWideLimitSync();
    }

    async function loadMoreMemvids() {
        let errorMessage = '';
        try {
            if (!canRevealMoreMemvids()) return;
            await loadMemvidsUntilVisible(PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT, { updateUi: true });
            memvidsVisibleLimit = Math.min(PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT, Math.max(memvidsVisibleLimit, memvidsState.items.length));
            await render();
        } catch (error) {
            errorMessage = localeText('browse.memvidsLoadMoreFailed');
            console.warn('memvids load more:', error);
        } finally {
            updateMemvidsPagination(errorMessage);
        }
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
        closeBtn.setAttribute('aria-label', localeText('browse.closeVideoModal'));
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
        const displayTitle = getMemvidDisplayTitle(item);
        const displayCaption = getMemvidDisplayCaption(item);
        const video = document.createElement('video');
        video.controls = true;
        video.autoplay = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.style.cssText = 'width:100%;max-height:70vh;display:block;border-radius:8px;background:#000';
        video.src = item.file.url;

        const star = createStarButton('video', item.id, {
            title: displayTitle || 'Video',
            thumb_url: item.poster?.url || '',
        });
        star.classList.add('video-modal__fav');

        modal.favoriteSlot.innerHTML = '';
        modal.favoriteSlot.appendChild(star);
        modal.videoWrap.innerHTML = '';
        modal.videoWrap.appendChild(video);
        modal.titleEl.textContent = displayTitle || 'Memvids';
        modal.captionEl.textContent = displayCaption;

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
        stopActiveHoverPreview();
        deck.destroy();
        if (memvidsResizeObserver) { memvidsResizeObserver.disconnect(); memvidsResizeObserver = null; }
        if (memvidsStageObserver) { memvidsStageObserver.disconnect(); memvidsStageObserver = null; }
        document.removeEventListener('bitbi:homepage-category-activated', handleMemvidsCategoryActivation);
        window.removeEventListener('resize', scheduleMemvidsWideLimitSync);
        window.removeEventListener('scroll', handleMemvidsProgressiveScroll);
        window.clearTimeout(memvidsResizeSettledTimer);
        window.cancelAnimationFrame(memvidsResizeFrame);
        disconnectMemvidsObserver();
    }, { once: true });

    $loadMore?.addEventListener('click', () => {
        loadMoreMemvids();
    });
    $paginationStatus.addEventListener('click', openMemvidsOverlay);

    $drawerToggle?.addEventListener('click', () => {
        const previousScrollY = window.scrollY;
        revealNextMemvidsBatch();
        try {
            $drawerToggle.focus({ preventScroll: true });
        } catch {
            $drawerToggle.focus();
        }
        window.requestAnimationFrame(() => {
            if (window.scrollY + 1 < previousScrollY) {
                window.scrollTo({ top: previousScrollY, behavior: 'auto' });
            }
        });
    });

    bindMediaQueryChange(publicWideLayoutQuery, () => {
        stopActiveHoverPreview();
        render();
    });
    bindMediaQueryChange(desktopHoverQuery, () => {
        stopActiveHoverPreview();
    });
    bindMediaQueryChange(reducedMotionQuery, () => {
        stopActiveHoverPreview();
    });
    bindMediaQueryChange(mobileMediaQuery, () => {
        updateMemvidsPagination();
    });

    if ('ResizeObserver' in window) {
        memvidsResizeObserver = new ResizeObserver(scheduleMemvidsWideLimitSync);
        memvidsResizeObserver.observe(grid);
        if (grid.parentElement) memvidsResizeObserver.observe(grid.parentElement);
    } else {
        window.addEventListener('resize', scheduleMemvidsWideLimitSync, { passive: true });
    }
    const categoryStage = document.getElementById('homeCategories');
    if (categoryStage && 'MutationObserver' in window) {
        memvidsStageObserver = new MutationObserver(scheduleMemvidsWideLimitSync);
        memvidsStageObserver.observe(categoryStage, {
            attributes: true,
            attributeFilter: ['class', 'data-active-category', 'data-stage-mode'],
        });
    }
    document.addEventListener('bitbi:homepage-category-activated', handleMemvidsCategoryActivation);
    document.fonts?.ready?.then(scheduleMemvidsWideLimitSync).catch(() => {});

    render();
}
