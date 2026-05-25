/* ============================================================
   BITBI — Video gallery (Memvids) rendering + modal player
   Mirrors gallery.js pattern for the Video Creations section
   ============================================================ */

import { setupFocusTrap } from '../../shared/focus-trap.js';
import { createStarButton } from '../../shared/favorites.js';
import { initMobileCardDeck } from '../../shared/studio-deck.js?v=__ASSET_VERSION__';
import {
    getMobileMediaGridQuery,
    openMobileMediaGrid,
    syncMobileMediaTrigger,
} from './mobile-media-overlay.js?v=__ASSET_VERSION__';
import { orderPublicExploreItems } from './explore-order.js?v=__ASSET_VERSION__';
import { localeText } from '../../shared/locale.js?v=__ASSET_VERSION__';

const MEMVIDS_LIMIT = 60;
const DESKTOP_PUBLIC_DRAWER_MEDIA = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';
const DESKTOP_INITIAL_MEMVIDS = 10;
const DESKTOP_MEMVIDS_BATCH = 20;
const DESKTOP_SCROLL_PRELOAD_PX = 720;

let focusTrapCleanup = null;

export function initVideoGallery() {
    const container = document.getElementById('videoExplore');
    const $pagination = document.getElementById('videoPagination');
    if (!container) return;

    let memvidsPromise = null;
    const desktopDrawerQuery = window.matchMedia?.(DESKTOP_PUBLIC_DRAWER_MEDIA);
    const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const mobileMediaQuery = getMobileMediaGridQuery();
    const memvidsState = {
        items: [],
        nextCursor: null,
        hasMore: false,
        loaded: false,
        loadingMore: false,
    };
    let memvidsProgressiveMode = false;
    let memvidsVisibleLimit = DESKTOP_INITIAL_MEMVIDS;
    let memvidsRevealPromise = null;
    let memvidsObserver = null;
    let memvidsUserScrolledSinceBatch = false;
    let memvidsScrollBatchSettling = false;
    let memvidsScrollBatchSettlingTimer = 0;
    let memvidsLastRevealScrollY = Number.NaN;
    let memvidsScrollSentinelNeedsReset = false;
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

    function isDesktopDrawerEnabled() {
        return !!desktopDrawerQuery?.matches;
    }

    function getVisibleMemvidsCount() {
        if (!isDesktopDrawerEnabled()) return memvidsState.items.length;
        return Math.min(memvidsVisibleLimit, memvidsState.items.length);
    }

    function canRevealMoreMemvids() {
        return isDesktopDrawerEnabled()
            && (
                memvidsState.items.length > getVisibleMemvidsCount()
                || (memvidsState.items.length >= DESKTOP_INITIAL_MEMVIDS && memvidsState.hasMore)
            );
    }

    function resetMemvidsDesktopWindow() {
        memvidsProgressiveMode = false;
        memvidsVisibleLimit = isDesktopDrawerEnabled()
            ? DESKTOP_INITIAL_MEMVIDS
            : memvidsState.items.length;
        memvidsUserScrolledSinceBatch = false;
        memvidsScrollBatchSettling = false;
        memvidsLastRevealScrollY = Number.NaN;
        memvidsScrollSentinelNeedsReset = false;
        window.clearTimeout(memvidsScrollBatchSettlingTimer);
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
        return String(item?.id || item?.slug || item?.poster?.url || item?.file?.url || '').trim();
    }

    function resolvePublicMemvidFileUrl(value) {
        const raw = typeof value === 'string' ? value.trim() : '';
        if (!raw) return '';
        try {
            const url = new URL(raw, window.location.origin);
            if (url.origin !== window.location.origin) return '';
            if (!url.pathname.startsWith('/api/gallery/memvids/')) return '';
            if (!url.pathname.endsWith('/file')) return '';
            return `${url.pathname}${url.search}`;
        } catch {
            return '';
        }
    }

    function getMemvidHoverPreviewSrc(item) {
        return resolvePublicMemvidFileUrl(item?.file?.url);
    }

    function canUseHoverPreview() {
        return !!desktopDrawerQuery?.matches && !reducedMotionQuery?.matches;
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
        const { card: activeCard, video } = activeHoverPreview;
        activeCard.classList.remove('video-card--hover-preview-active');
        resetHoverPreviewVideo(video);
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
        video.preload = 'metadata';
        if (posterUrl) video.poster = posterUrl;
        return video;
    }

    function startHoverPreview(card, previewSrc, posterUrl = '') {
        if (!canUseHoverPreview() || !previewSrc) return;
        if (activeHoverPreview?.card && activeHoverPreview.card !== card) {
            stopActiveHoverPreview();
        }

        const video = ensureHoverPreviewVideo(card, posterUrl);
        if (!video) return;
        if (video.dataset.previewSrc !== previewSrc) {
            resetHoverPreviewVideo(video);
            video.src = previewSrc;
            video.dataset.previewSrc = previewSrc;
        }

        activeHoverPreview = { card, video };
        card.classList.add('video-card--hover-preview-active');
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
                if (activeHoverPreview?.video === video) {
                    stopActiveHoverPreview(card);
                }
            });
        }
    }

    function bindHoverPreview(card, item) {
        const previewSrc = getMemvidHoverPreviewSrc(item);
        if (!previewSrc) return;
        const posterUrl = item?.poster?.url || '';

        card.addEventListener('pointerenter', (event) => {
            if (event.pointerType && event.pointerType !== 'mouse') return;
            startHoverPreview(card, previewSrc, posterUrl);
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
        memvidsState.items = orderPublicExploreItems(nextItems, getMemvidIdentity);
    }

    function openMemvidsOverlay() {
        openMobileMediaGrid({
            title: 'Memvids',
            items: memvidsState.items,
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
        const showDrawerToggle = isDesktopDrawerEnabled() && canRevealMore && !memvidsProgressiveMode;
        const showLoadMore = memvidsState.hasMore && (
            !isDesktopDrawerEnabled()
            || (!showDrawerToggle && !memvidsProgressiveMode && memvidsState.items.length < DESKTOP_INITIAL_MEMVIDS)
        );
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
            ? localeText('browse.showMore')
            : '';
        $drawerToggle.disabled = memvidsState.loadingMore;
        $drawerToggle.setAttribute('aria-expanded', String(showDrawerToggle && memvidsProgressiveMode));
        $loadMore.hidden = !showLoadMore;
        $loadMore.disabled = memvidsState.loadingMore;
        $loadMore.textContent = showLoadMore
            ? (memvidsState.loadingMore ? localeText('browse.loading') : localeText('browse.loadMore'))
            : '';
        $scrollSentinel.hidden = !(isDesktopDrawerEnabled() && memvidsProgressiveMode && canRevealMore);
        syncMemvidsScrollLoading();
    }

    async function fetchMemvids(cursor = null) {
        if (memvidsPromise) return memvidsPromise;
        memvidsPromise = (async () => {
            try {
                const params = new URLSearchParams();
                params.set('limit', String(MEMVIDS_LIMIT));
                if (cursor) params.set('cursor', cursor);
                const res = await fetch(`/api/gallery/memvids?${params}`, {
                    credentials: 'same-origin',
                });
                const data = await res.json().catch(() => null);
                if (!res.ok) {
                    throw new Error(data?.error || `Error ${res.status}`);
                }
                return {
                    items: Array.isArray(data?.data?.items) ? data.data.items : [],
                    nextCursor: typeof data?.data?.next_cursor === 'string' ? data.data.next_cursor : null,
                    hasMore: data?.data?.has_more === true,
                };
            } catch (error) {
                console.warn('memvids:', error);
                throw error;
            } finally {
                memvidsPromise = null;
            }
        })();
        return memvidsPromise;
    }

    async function ensureMemvidsLoaded() {
        if (memvidsState.loaded) return;
        const page = await fetchMemvids();
        mergeMemvidsItems(page.items, { replace: true });
        memvidsState.nextCursor = page.nextCursor;
        memvidsState.hasMore = page.hasMore;
        memvidsState.loaded = true;
        resetMemvidsDesktopWindow();
    }

    async function fetchNextMemvidsPage() {
        if (!memvidsState.hasMore || memvidsState.loadingMore) return false;
        memvidsState.loadingMore = true;
        updateMemvidsPagination();
        try {
            const page = await fetchMemvids(memvidsState.nextCursor);
            mergeMemvidsItems(page.items);
            memvidsState.nextCursor = page.nextCursor;
            memvidsState.hasMore = page.hasMore;
            return true;
        } finally {
            memvidsState.loadingMore = false;
            updateMemvidsPagination();
        }
    }

    async function revealNextMemvidsBatch() {
        if (!isDesktopDrawerEnabled()) return;
        if (!canRevealMoreMemvids()) return;
        if (memvidsRevealPromise) return memvidsRevealPromise;
        memvidsProgressiveMode = true;
        const nextLimit = memvidsVisibleLimit + DESKTOP_MEMVIDS_BATCH;
        memvidsRevealPromise = (async () => {
            let errorMessage = '';
            try {
                if (nextLimit > memvidsState.items.length && memvidsState.hasMore) {
                    await fetchNextMemvidsPage();
                }
                memvidsVisibleLimit = Math.min(nextLimit, memvidsState.items.length);
                await render();
            } catch (error) {
                errorMessage = localeText('browse.memvidsLoadMoreFailed');
                console.warn('memvids reveal more:', error);
            } finally {
                memvidsUserScrolledSinceBatch = false;
                memvidsScrollBatchSettling = true;
                window.clearTimeout(memvidsScrollBatchSettlingTimer);
                memvidsScrollBatchSettlingTimer = window.setTimeout(() => {
                    memvidsScrollBatchSettling = false;
                }, 180);
                memvidsRevealPromise = null;
                updateMemvidsPagination(errorMessage);
            }
        })();
        return memvidsRevealPromise;
    }

    function shouldUseMemvidsScrollLoading() {
        return isDesktopDrawerEnabled()
            && memvidsProgressiveMode
            && canRevealMoreMemvids();
    }

    function maybeRevealMemvidsFromScroll() {
        if (memvidsScrollBatchSettling) return;
        if (!memvidsUserScrolledSinceBatch || !shouldUseMemvidsScrollLoading()) return;
        const rect = $scrollSentinel.getBoundingClientRect();
        const sentinelIsNear = rect.top <= window.innerHeight + DESKTOP_SCROLL_PRELOAD_PX;
        if (memvidsScrollSentinelNeedsReset) {
            if (!sentinelIsNear) memvidsScrollSentinelNeedsReset = false;
            return;
        }
        if (!sentinelIsNear) return;
        const scrollY = Math.round(window.scrollY || document.documentElement.scrollTop || 0);
        if (Object.is(scrollY, memvidsLastRevealScrollY)) return;
        memvidsLastRevealScrollY = scrollY;
        memvidsScrollSentinelNeedsReset = true;
        revealNextMemvidsBatch();
    }

    function handleMemvidsProgressiveScroll() {
        if (memvidsScrollBatchSettling) return;
        memvidsUserScrolledSinceBatch = true;
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
        const active = shouldUseMemvidsScrollLoading();
        window.removeEventListener('scroll', handleMemvidsProgressiveScroll);
        disconnectMemvidsObserver();
        if (!active) return;
        window.addEventListener('scroll', handleMemvidsProgressiveScroll, { passive: true });
        if ('IntersectionObserver' in window) {
            memvidsObserver = new IntersectionObserver(handleMemvidsIntersection, {
                rootMargin: `${DESKTOP_SCROLL_PRELOAD_PX}px 0px`,
            });
            memvidsObserver.observe($scrollSentinel);
        }
    }

    function buildVideoCard(item) {
        const card = document.createElement('div');
        card.className = 'video-card';
        const itemIdentity = getMemvidIdentity(item);
        if (itemIdentity) card.dataset.videoItemId = itemIdentity;
        const aspectMeta = getMemvidAspectMeta(item);
        const publisher = item.publisher || null;
        const publisherDisplayName = normalizeMemvidText(publisher?.display_name);
        const displayTitle = getMemvidDisplayTitle(item);
        const displayCaption = getMemvidDisplayCaption(item);
        const safeLabel = publisherDisplayName || displayTitle || 'Video';
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
            img.alt = displayTitle || 'Video thumbnail';
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
            title: displayTitle || publisherDisplayName || 'Video',
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
        publisherName.textContent = publisherDisplayName || displayTitle || 'Memvids';
        publisherRow.appendChild(publisherName);
        info.appendChild(publisherRow);

        if (displayTitle && publisherDisplayName) {
            const subtitle = document.createElement('p');
            subtitle.className = 'video-card__subtitle';
            subtitle.textContent = displayTitle;
            info.appendChild(subtitle);
        }

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
            updateMemvidsPagination(localeText('browse.memvidsLoadFailed'));
            return;
        }

        grid.innerHTML = '';

        if (!items.length) {
            renderState(localeText('browse.noMemvids'));
            updateMemvidsPagination();
            return;
        }

        items.forEach((item) => {
            const card = buildVideoCard(item);
            grid.appendChild(card);
        });
        updateMemvidsPagination();
    }

    async function loadMoreMemvids() {
        let errorMessage = '';
        try {
            const loaded = await fetchNextMemvidsPage();
            if (!loaded) return;
            if (!isDesktopDrawerEnabled()) {
                memvidsVisibleLimit = memvidsState.items.length;
            }
            render();
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
        window.removeEventListener('scroll', handleMemvidsProgressiveScroll);
        window.clearTimeout(memvidsScrollBatchSettlingTimer);
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

    bindMediaQueryChange(desktopDrawerQuery, () => {
        stopActiveHoverPreview();
        resetMemvidsDesktopWindow();
        render();
    });
    bindMediaQueryChange(reducedMotionQuery, () => {
        stopActiveHoverPreview();
    });
    bindMediaQueryChange(mobileMediaQuery, () => {
        updateMemvidsPagination();
    });

    render();
}
