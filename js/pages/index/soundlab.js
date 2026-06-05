/* ============================================================
   BITBI - Sound Lab: public Memtracks playback
   ============================================================ */

import { setupFocusTrap } from '../../shared/focus-trap.js';
import { formatTime } from '../../shared/format-time.js';
import { createStarButton } from '../../shared/favorites.js';
import {
    MAX_MOBILE_DECK_DOTS,
    getMobileDeckActiveDotIndex,
    getMobileDeckDotTargets,
} from '../../shared/studio-deck.js?v=__ASSET_VERSION__';
import {
    getMobileMediaGridQuery,
    openMobileMediaGrid,
    syncMobileMediaTrigger,
} from './mobile-media-overlay.js?v=__ASSET_VERSION__';
import { syncCategoryGhostModels } from './category-ghost-models.js?v=__ASSET_VERSION__';
import {
    initGlobalAudioManager,
    getGlobalAudioState,
    subscribeGlobalAudioState,
    playGlobalTrack,
    pauseGlobalAudio,
    resumeGlobalAudio,
    seekGlobalAudio,
} from '../../shared/audio/audio-manager.js?v=__ASSET_VERSION__';
import { localeText } from '../../shared/locale.js?v=__ASSET_VERSION__';
import {
    getStableMediaWallAvailableWidth,
    parseCssLengthToPixels,
} from './public-media-wall.js?v=__ASSET_VERSION__';
import { createPublicMediaDetailPanel } from './public-media-detail-panel.js?v=__ASSET_VERSION__';

const MEMTRACKS_PAGE_LIMIT = 60;
const PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT = 60;
const PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT = 100;
const DESKTOP_SOUND_LAYOUT_MEDIA = '(min-width: 640px)';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getSeekTimeFromPointer(control, event, duration) {
    const rect = control.getBoundingClientRect();
    const ratio = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0;
    return duration * ratio;
}

function stopControlEvent(event) {
    event.stopPropagation();
}

export function initSoundLab(revealObserver) {
    const ctn = document.getElementById('soundLabTracks');
    if (!ctn || ctn.dataset.soundlabReady === 'true') return;
    ctn.dataset.soundlabReady = 'true';

    const plEl = document.getElementById('playlistPlayer');
    if (plEl) {
        plEl.hidden = true;
        plEl.style.display = 'none';
        plEl.replaceChildren();
    }

    initGlobalAudioManager();

    let currentState = getGlobalAudioState();
    let syncDeck = null;
    let memtrackWidthFrame = 0;
    let memtrackWidthValidationToken = 0;
    let memtrackResizeObserver = null;
    let memtrackStageObserver = null;
    let memtrackModal = null;
    let memtrackFocusTrapCleanup = null;
    let memtrackDetailPanel = null;
    let memtrackModalAudioUnsubscribe = null;
    const mobileMediaQuery = getMobileMediaGridQuery();
    const desktopSoundLayoutQuery = window.matchMedia?.(DESKTOP_SOUND_LAYOUT_MEDIA);
    const memtracksState = {
        items: [],
        loaded: false,
        loading: false,
        nextCursor: null,
        hasMore: false,
        error: '',
        loadingMore: false,
        visibleLimit: PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT,
    };

    const statusEl = document.createElement('div');
    statusEl.className = 'snd-memtracks-status';
    statusEl.hidden = true;
    const paginationEl = document.createElement('div');
    paginationEl.className = 'browse-pagination snd-memtracks-pagination';
    paginationEl.hidden = true;
    const paginationStatus = document.createElement('button');
    paginationStatus.type = 'button';
    paginationStatus.className = 'browse-pagination__status';
    const paginationMore = document.createElement('button');
    paginationMore.type = 'button';
    paginationMore.className = 'browse-pagination__toggle snd-memtracks-more';
    paginationMore.textContent = localeText('browse.showMore');
    paginationMore.hidden = true;
    paginationEl.append(paginationStatus, paginationMore);
    ctn.after(paginationEl, statusEl);

    function toPixelString(value) {
        const rounded = Math.floor((Number(value) || 0) * 1000) / 1000;
        return `${rounded}px`;
    }

    function getMemtrackWidthMetrics() {
        const isDesktopLayout = !!desktopSoundLayoutQuery?.matches;
        if (!isDesktopLayout || typeof window.getComputedStyle !== 'function') {
            return {
                isDesktopLayout,
                baseWidthPx: 363,
                gapPx: 3,
                columnCount: 1,
                resolvedWidthPx: 363,
                widthValue: 'var(--bitbi-public-sound-card-width)',
            };
        }
        const availableWidth = getStableMediaWallAvailableWidth(ctn);
        const style = window.getComputedStyle(ctn);
        const target = parseCssLengthToPixels(
            style.getPropertyValue('--bitbi-public-sound-card-width'),
            363,
            ctn,
        );
        const gap = parseCssLengthToPixels(
            style.getPropertyValue('--bitbi-public-sound-gap') || style.columnGap || style.gap,
            3,
            ctn,
        );
        const itemCount = Array.from(ctn.children)
            .filter((card) => card.classList.contains('snd-card--memtrack'))
            .length;
        const capacity = availableWidth
            ? Math.max(1, Math.floor((availableWidth + gap) / (target + gap)))
            : 1;
        const columnCount = itemCount > 0 ? Math.min(itemCount, capacity) : capacity;
        const resolvedWidth = availableWidth && columnCount > 0
            ? Math.max(target, Math.floor(((availableWidth - (gap * (columnCount - 1))) / columnCount) * 1000) / 1000)
            : target;
        return {
            isDesktopLayout,
            availableWidthPx: availableWidth,
            baseWidthPx: target,
            gapPx: gap,
            capacity,
            columnCount,
            resolvedWidthPx: resolvedWidth,
            widthValue: toPixelString(resolvedWidth),
        };
    }

    function lockMemtrackCardWidth(card, widthValue) {
        if (!card) return;
        card.style.setProperty('box-sizing', 'border-box');
        card.style.setProperty('width', widthValue);
        card.style.setProperty('inline-size', widthValue);
        card.style.setProperty('min-width', widthValue);
        card.style.setProperty('max-width', widthValue);
        card.style.setProperty('min-inline-size', widthValue);
        card.style.setProperty('max-inline-size', widthValue);
        card.style.setProperty('flex-basis', widthValue);
        card.style.setProperty('justify-self', 'start');
        card.style.setProperty('align-self', 'start');
    }

    function getVisibleMemtrackCards() {
        return Array.from(ctn.children)
            .filter((card) => card.classList.contains('snd-card--memtrack'));
    }

    function storeMemtrackWidthMetrics(metrics) {
        ctn.dataset.soundWallAvailableWidth = String(metrics.availableWidthPx || 0);
        ctn.dataset.soundWallBaseWidth = String(metrics.baseWidthPx);
        ctn.dataset.soundWallResolvedWidth = String(metrics.resolvedWidthPx);
        ctn.dataset.soundWallGap = String(metrics.gapPx);
        ctn.dataset.soundWallColumnCount = String(metrics.columnCount);
        ctn.dataset.soundWallCapacity = String(metrics.capacity);
        ctn.dataset.soundCardWidthPx = String(metrics.resolvedWidthPx);
    }

    function validateMemtrackWidthMetrics(metrics) {
        const current = getMemtrackWidthMetrics();
        const differs = (key, tolerance) => (
            Math.abs((Number(metrics?.[key]) || 0) - (Number(current?.[key]) || 0)) > tolerance
        );
        if (!current.isDesktopLayout || !current.availableWidthPx) {
            return { ready: false, stale: false, current };
        }
        if (differs('availableWidthPx', 0.5)
            || differs('gapPx', 0.1)
            || differs('baseWidthPx', 0.1)
            || differs('resolvedWidthPx', 1)
            || Number(metrics?.capacity || 0) !== Number(current.capacity || 0)
            || Number(metrics?.columnCount || 0) !== Number(current.columnCount || 0)) {
            return { ready: false, stale: true, current };
        }
        const stage = ctn.closest?.('#homeCategories');
        if (stage?.classList.contains('is-transitioning')) {
            return { ready: false, stale: false, current };
        }
        const cards = getVisibleMemtrackCards();
        const cardRects = cards
            .filter((card) => card.offsetParent !== null)
            .map((card) => card.getBoundingClientRect());
        const cardsReady = !cards.length
            || (cardRects.length === cards.length && cardRects.every((rect) => Math.abs(rect.width - current.resolvedWidthPx) <= 2));
        return { ready: cardsReady, stale: false, current };
    }

    function scheduleMemtrackWidthReadyValidation(metrics, token, correctionAttempt = 0) {
        let validationAttempts = 0;
        const validate = () => {
            if (memtrackWidthValidationToken !== token) return;
            validationAttempts += 1;
            const result = validateMemtrackWidthMetrics(metrics);
            if (result.stale && correctionAttempt < 2) {
                syncMemtrackCardWidths(correctionAttempt + 1);
                return;
            }
            if (result.ready) {
                storeMemtrackWidthMetrics(result.current);
                ctn.dataset.soundWallReady = 'true';
                ctn.dataset.soundWidthReady = 'true';
                return;
            }
            ctn.dataset.soundWallReady = 'false';
            ctn.dataset.soundWidthReady = 'false';
            if (validationAttempts < 10) {
                window.setTimeout(validate, 120);
            }
        };
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(validate);
        });
        window.setTimeout(validate, 180);
    }

    function syncMemtrackCardWidths(correctionAttempt = 0) {
        const {
            isDesktopLayout,
            availableWidthPx,
            baseWidthPx,
            gapPx,
            capacity,
            columnCount,
            resolvedWidthPx,
            widthValue,
        } = getMemtrackWidthMetrics();
        ctn.dataset.soundWallReady = 'false';
        ctn.dataset.soundWidthReady = 'false';
        memtrackWidthValidationToken += 1;
        const validationToken = memtrackWidthValidationToken;
        if (isDesktopLayout) {
            ctn.style.gridTemplateColumns = `repeat(${columnCount}, ${widthValue})`;
            ctn.style.setProperty('--bitbi-public-sound-card-resolved-width', widthValue);
            storeMemtrackWidthMetrics({
                availableWidthPx,
                baseWidthPx,
                gapPx,
                capacity,
                columnCount,
                resolvedWidthPx,
            });
        } else {
            ctn.style.gridTemplateColumns = '';
            ctn.style.removeProperty('--bitbi-public-sound-card-resolved-width');
            delete ctn.dataset.soundWallAvailableWidth;
            delete ctn.dataset.soundWallReady;
            delete ctn.dataset.soundWallBaseWidth;
            delete ctn.dataset.soundWallResolvedWidth;
            delete ctn.dataset.soundWallGap;
            delete ctn.dataset.soundWallColumnCount;
            delete ctn.dataset.soundWallCapacity;
            delete ctn.dataset.soundWidthReady;
            delete ctn.dataset.soundCardWidthPx;
        }
        getVisibleMemtrackCards().forEach((card) => lockMemtrackCardWidth(card, widthValue));
        if (isDesktopLayout) {
            scheduleMemtrackWidthReadyValidation({
                availableWidthPx,
                baseWidthPx,
                gapPx,
                capacity,
                columnCount,
                resolvedWidthPx,
            }, validationToken, correctionAttempt);
        }
    }

    function scheduleMemtrackWidthSync() {
        if (memtrackWidthFrame) return;
        memtrackWidthFrame = window.requestAnimationFrame(() => {
            memtrackWidthFrame = 0;
            syncMemtrackCardWidths();
        });
    }

    function handleMemtracksCategoryLayoutRequest(event) {
        if (event?.detail?.category !== 'sound') return;
        if (!desktopSoundLayoutQuery?.matches || !memtracksState.loaded) return;
        syncMemtrackCardWidths();
        event.detail.waitUntil?.(new Promise((resolve) => {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(resolve);
            });
        }));
    }

    function getMemtrackTrack(item) {
        if (!item?.id || !item?.file?.url) return null;
        return {
            id: `memtrack:${item.id}`,
            slug: item.slug || `memtrack-${item.id}`,
            title: item.title || 'Memtrack',
            src: item.file.url,
            sourceUrl: item.file.url,
            artwork: item.poster?.url || '',
            artworkUrl: item.poster?.url || '',
            access: 'public',
            collection: 'memtracks',
            originLabel: 'Sound Lab',
            crossOrigin: '',
            durationSeconds: item.duration_seconds,
        };
    }

    function buildMemtrackModal() {
        const overlay = document.createElement('div');
        overlay.id = 'memtrackModal';
        overlay.className = 'modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        const content = document.createElement('div');
        content.className = 'modal-content';

        const card = document.createElement('div');
        card.className = 'modal-card modal-card--sound modal-card--public-detail';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'modal-action modal-action--right memtrack-modal-close';
        closeBtn.setAttribute('aria-label', localeText('browse.closeMediaDetails'));
        closeBtn.title = localeText('browse.close');
        closeBtn.textContent = '×';

        const media = document.createElement('div');
        media.className = 'memtrack-modal__media';

        const detailSlot = document.createElement('div');
        detailSlot.className = 'public-media-detail-slot';

        card.append(closeBtn, media, detailSlot);
        content.appendChild(card);
        overlay.appendChild(content);
        closeBtn.addEventListener('click', closeMemtrackModal);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeMemtrackModal();
        });
        return { root: overlay, media, detailSlot };
    }

    function syncMemtrackModalControls({ track, item, playButton, status, fill, progress }) {
        return (state = getGlobalAudioState()) => {
            const isActive = state.trackId === track.id;
            const isPlaying = isActive && state.status === 'playing';
            const duration = Number(state.duration || item.duration_seconds || 0);
            const currentTime = isActive ? Number(state.currentTime || 0) : 0;
            const percent = isActive && duration > 0 ? clamp((currentTime / duration) * 100, 0, 100) : 0;
            playButton.textContent = isPlaying ? localeText('browse.pauseTrack') : localeText('browse.playTrack');
            playButton.setAttribute('aria-label', isPlaying
                ? localeText('browse.pause', { title: item.title || 'Memtrack' })
                : localeText('browse.play', { title: item.title || 'Memtrack' }));
            status.textContent = isActive && duration > 0
                ? `${isPlaying ? localeText('browse.playing') : localeText('browse.paused')} · ${formatTime(currentTime)} / ${formatTime(duration)}`
                : localeText('browse.readyToPlay');
            fill.style.width = `${percent}%`;
            progress.disabled = !isActive || duration <= 0;
        };
    }

    function renderMemtrackModalMedia(item) {
        const track = getMemtrackTrack(item);
        const media = document.createElement('div');
        media.className = 'memtrack-modal__player';
        const poster = item.poster?.url || '';
        if (poster) {
            const cover = new Image();
            cover.className = 'memtrack-modal__cover';
            cover.src = poster;
            cover.alt = item.title || 'Memtrack';
            cover.loading = 'lazy';
            cover.decoding = 'async';
            media.appendChild(cover);
        } else {
            const fallback = document.createElement('div');
            fallback.className = 'memtrack-modal__cover memtrack-modal__cover--fallback';
            fallback.setAttribute('aria-hidden', 'true');
            fallback.textContent = '\u266B';
            media.appendChild(fallback);
        }

        const controls = document.createElement('div');
        controls.className = 'memtrack-modal__controls';
        const playButton = document.createElement('button');
        playButton.type = 'button';
        playButton.className = 'memtrack-modal__play';
        playButton.textContent = localeText('browse.playTrack');
        const status = document.createElement('p');
        status.className = 'memtrack-modal__status';
        status.textContent = localeText('browse.readyToPlay');
        const progress = document.createElement('button');
        progress.type = 'button';
        progress.className = 'memtrack-modal__progress';
        progress.setAttribute('aria-label', localeText('browse.seekTrack'));
        const fill = document.createElement('span');
        fill.className = 'memtrack-modal__progress-fill';
        progress.appendChild(fill);
        controls.append(playButton, status, progress);
        media.appendChild(controls);

        if (track) {
            const sync = syncMemtrackModalControls({ track, item, playButton, status, fill, progress });
            memtrackModalAudioUnsubscribe = subscribeGlobalAudioState(sync);
            sync(getGlobalAudioState());
            playButton.addEventListener('click', async () => {
                const state = getGlobalAudioState();
                if (state.trackId === track.id && state.status === 'playing') {
                    pauseGlobalAudio();
                    return;
                }
                if (state.trackId === track.id) {
                    await resumeGlobalAudio(true);
                    return;
                }
                playGlobalTrack(track);
            });
            progress.addEventListener('click', (event) => {
                const state = getGlobalAudioState();
                if (state.trackId !== track.id || !state.duration) return;
                seekGlobalAudio(getSeekTimeFromPointer(progress, event, state.duration));
            });
        } else {
            playButton.disabled = true;
            progress.disabled = true;
        }
        return media;
    }

    function openMemtrackModal(item) {
        if (!memtrackModal) {
            memtrackModal = buildMemtrackModal();
            document.body.appendChild(memtrackModal.root);
        }
        closeMemtrackModal({ keepShell: true });
        memtrackModal.media.replaceChildren();
        memtrackModal.media.appendChild(renderMemtrackModalMedia(item));
        if (memtrackDetailPanel) {
            memtrackDetailPanel.destroy();
            memtrackDetailPanel = null;
        }
        memtrackModal.root.setAttribute('aria-label', item.title || localeText('browse.memtrackDetails'));
        memtrackDetailPanel = createPublicMediaDetailPanel({
            item,
            collection: 'memtracks',
            onCommentCountChange(count) {
                item.comment_count = count;
            },
        });
        memtrackModal.detailSlot.appendChild(memtrackDetailPanel.root);
        memtrackModal.root.classList.add('active');
        document.body.style.overflow = 'hidden';
        memtrackFocusTrapCleanup = setupFocusTrap(memtrackModal.root);
    }

    function closeMemtrackModal(options = {}) {
        if (memtrackModalAudioUnsubscribe) {
            memtrackModalAudioUnsubscribe();
            memtrackModalAudioUnsubscribe = null;
        }
        if (memtrackDetailPanel) {
            memtrackDetailPanel.destroy();
            memtrackDetailPanel = null;
        }
        if (memtrackFocusTrapCleanup) {
            memtrackFocusTrapCleanup();
            memtrackFocusTrapCleanup = null;
        }
        if (!memtrackModal) return;
        memtrackModal.media.replaceChildren();
        memtrackModal.root.classList.remove('active');
        if (!options.keepShell) {
            document.body.style.overflow = '';
        }
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && memtrackModal?.root.classList.contains('active')) {
            closeMemtrackModal();
        }
    });

    function getCurrentMemtrackIndex(state = currentState) {
        return memtracksState.items.findIndex(item => state.trackId === `memtrack:${item.id}`);
    }

    function getVisibleMemtrackCount() {
        return Math.min(memtracksState.visibleLimit, memtracksState.items.length, PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT);
    }

    function getVisibleMemtracks() {
        return memtracksState.items.slice(0, getVisibleMemtrackCount());
    }

    function canRevealMoreMemtracks() {
        const visibleCount = getVisibleMemtrackCount();
        return visibleCount < PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT
            && (memtracksState.items.length > visibleCount || memtracksState.hasMore);
    }

    function syncStatus() {
        const show = memtracksState.loading || memtracksState.error || (memtracksState.loaded && !memtracksState.items.length);
        statusEl.hidden = !show;
        if (memtracksState.loading) {
            statusEl.textContent = localeText('browse.loadingTracks');
        } else if (memtracksState.error) {
            statusEl.textContent = memtracksState.error;
        } else if (memtracksState.loaded && !memtracksState.items.length) {
            statusEl.textContent = localeText('browse.noTracks');
        } else {
            statusEl.textContent = '';
        }
    }

    function openMemtracksOverlay() {
        openMobileMediaGrid({
            title: 'Memtracks',
            items: getVisibleMemtracks(),
            emptyText: localeText('browse.noTracks'),
            className: 'mobile-media-grid-overlay--sound',
            renderItem(item, index, { openDetail } = {}) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'mobile-media-grid-overlay__item mobile-media-grid-overlay__item--sound';
                button.setAttribute('aria-label', localeText('browse.play', { title: item.title || `Memtrack ${index + 1}` }));

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
                    fallback.textContent = '\u266b';
                    button.appendChild(fallback);
                }

                const label = document.createElement('span');
                label.className = 'mobile-media-grid-overlay__item-label';
                label.textContent = item.title || `Memtrack ${index + 1}`;
                button.appendChild(label);

                button.addEventListener('click', () => {
                    const track = getMemtrackTrack(item);
                    if (!track) return;
                    if (typeof openDetail === 'function') {
                        playGlobalTrack(track);
                        openDetail({
                            title: item.title || `Memtrack ${index + 1}`,
                            className: 'mobile-media-detail-overlay--sound',
                            renderContent() {
                                const panel = document.createElement('div');
                                panel.className = 'mobile-media-detail-overlay__sound';

                                const poster = item.poster?.url || '';
                                if (poster) {
                                    const cover = new Image();
                                    cover.className = 'mobile-media-detail-overlay__sound-cover';
                                    cover.src = poster;
                                    cover.alt = '';
                                    cover.loading = 'lazy';
                                    cover.decoding = 'async';
                                    panel.appendChild(cover);
                                }

                                const content = document.createElement('div');
                                content.className = 'mobile-media-detail-overlay__sound-content';
                                const title = document.createElement('h4');
                                title.className = 'mobile-media-detail-overlay__sound-title';
                                title.textContent = item.title || `Memtrack ${index + 1}`;
                                const status = document.createElement('p');
                                status.className = 'mobile-media-detail-overlay__sound-status';
                                status.textContent = localeText('browse.loading');
                                const controls = document.createElement('div');
                                controls.className = 'mobile-media-detail-overlay__sound-controls';
                                const play = document.createElement('button');
                                play.type = 'button';
                                play.className = 'mobile-media-detail-overlay__sound-play';
                                play.setAttribute('aria-label', `Pause ${item.title || 'Memtrack'}`);
                                play.textContent = '\u275A\u275A';
                                const progress = document.createElement('button');
                                progress.type = 'button';
                                progress.className = 'mobile-media-detail-overlay__sound-progress';
                                progress.setAttribute('aria-label', 'Seek within track');
                                const fill = document.createElement('span');
                                fill.className = 'mobile-media-detail-overlay__sound-progress-fill';
                                progress.appendChild(fill);
                                controls.append(play, progress);
                                content.append(title, status, controls);
                                panel.appendChild(content);

                                const sync = (state) => {
                                    const isActive = state.trackId === track.id;
                                    const isPlaying = isActive && state.status === 'playing';
                                    const duration = Number(state.duration) || 0;
                                    const currentTime = Number(state.currentTime) || 0;
                                    const percent = isActive && duration > 0
                                        ? Math.min(100, (currentTime / duration) * 100)
                                        : 0;
                                    play.textContent = isPlaying ? '\u275A\u275A' : '\u25B6';
                                    play.setAttribute('aria-label', `${isPlaying ? 'Pause' : 'Play'} ${item.title || 'Memtrack'}`);
                                    status.textContent = isActive && duration > 0
                                        ? `${isPlaying ? 'Playing' : 'Paused'} \u2022 ${formatTime(currentTime)} / ${formatTime(duration)}`
                                        : (isActive ? `${isPlaying ? 'Playing' : 'Paused'} \u2022 0:00` : 'Ready');
                                    fill.style.width = `${percent}%`;
                                    progress.disabled = !isActive || duration <= 0;
                                };
                                const unsubscribeDetail = subscribeGlobalAudioState(sync);

                                play.addEventListener('click', async () => {
                                    const state = getGlobalAudioState();
                                    if (state.trackId === track.id && state.status === 'playing') {
                                        pauseGlobalAudio();
                                        return;
                                    }
                                    if (state.trackId === track.id) {
                                        await resumeGlobalAudio(true);
                                        return;
                                    }
                                    playGlobalTrack(track);
                                });
                                progress.addEventListener('click', (event) => {
                                    const state = getGlobalAudioState();
                                    if (state.trackId !== track.id || !state.duration) return;
                                    seekGlobalAudio(getSeekTimeFromPointer(progress, event, state.duration));
                                });

                                return {
                                    node: panel,
                                    cleanup: unsubscribeDetail,
                                };
                            },
                        });
                        return;
                    }
                    playGlobalTrack(track);
                });
                return button;
            },
        });
    }

    function syncMemtracksPagination() {
        const hasItems = memtracksState.items.length > 0;
        paginationEl.hidden = !hasItems;
        if (!hasItems) {
            paginationStatus.textContent = '';
            syncMobileMediaTrigger(paginationStatus, { enabled: false, label: localeText('browse.openMemtracksGrid') });
            paginationMore.hidden = true;
            paginationMore.disabled = false;
            paginationMore.textContent = '';
            return;
        }
        const visibleCount = getVisibleMemtrackCount();
        const canRevealMore = canRevealMoreMemtracks();
        if (canRevealMore || memtracksState.hasMore) {
            paginationStatus.textContent = localeText('browse.showingMemtracksComplete', { count: visibleCount });
        } else {
            paginationStatus.textContent = localeText('browse.showingAllMemtracksComplete', { count: visibleCount });
        }
        syncMobileMediaTrigger(paginationStatus, {
            enabled: hasItems,
            label: localeText('browse.openMemtracksGrid'),
        });
        paginationMore.hidden = !canRevealMore;
        paginationMore.disabled = memtracksState.loadingMore;
        paginationMore.textContent = canRevealMore
            ? (memtracksState.loadingMore ? localeText('browse.loading') : localeText('browse.showMore'))
            : '';
    }

    function renderMemtrackCard(row, item, state = currentState) {
        const track = getMemtrackTrack(item);
        if (!track) return;
        const isActive = state.trackId === track.id;
        const isPlaying = isActive && state.status === 'playing';
        const progress = isActive && state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;
        const timeText = isActive && state.duration > 0
            ? `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`
            : '0:00';

        row.style.borderColor = isActive ? 'rgba(0,240,255,0.2)' : 'rgba(255,255,255,0.06)';
        row.style.background = isActive ? 'rgba(0,240,255,0.04)' : 'rgba(13,27,42,0.45)';
        row.querySelector('.snd-prog').style.width = `${progress}%`;
        row.querySelector('.snd-time').textContent = timeText;
        row.querySelector('.pi').style.display = isPlaying ? 'none' : '';
        row.querySelector('.pa').style.display = isPlaying ? '' : 'none';
        row.querySelectorAll('.eq-bar').forEach(bar => {
            bar.style.animationPlayState = isPlaying ? 'running' : 'paused';
        });
    }

    function renderMemtrackRows(state = currentState) {
        ctn.querySelectorAll('.snd-card--memtrack').forEach((row) => {
            const item = memtracksState.items.find(entry => String(entry.id) === row.dataset.memtrackId);
            if (item) renderMemtrackCard(row, item, state);
        });
    }

    function createMemtrackCard(item) {
        const card = document.createElement('div');
        card.className = 'reveal snd-card snd-card--memtrack';
        card.style.cssText = 'position:relative;background:rgba(13,27,42,0.45);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:hidden;transition:border-color 0.3s,background-color 0.3s;box-sizing:border-box;width:var(--bitbi-public-sound-card-width);inline-size:var(--bitbi-public-sound-card-width);min-width:var(--bitbi-public-sound-card-width);max-width:var(--bitbi-public-sound-card-width);min-inline-size:var(--bitbi-public-sound-card-width);max-inline-size:var(--bitbi-public-sound-card-width);flex:0 0 var(--bitbi-public-sound-card-width);justify-self:start;align-self:start';
        card.dataset.memtrackId = String(item.id || '');
        const publisher = item.publisher || null;
        const publisherName = typeof publisher?.display_name === 'string'
            ? publisher.display_name.trim()
            : '';
        const createPublisherInfo = () => {
            if (!publisherName && !publisher?.avatar?.url) return null;
            const info = document.createElement('div');
            info.className = 'video-card__info snd-hero__info';

            const publisherRow = document.createElement('div');
            publisherRow.className = 'public-media-meta__identity public-media-meta__identity--video public-media-meta__identity--sound';
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
            if (publisherName) {
                const name = document.createElement('h4');
                name.className = 'video-card__title snd-publisher-name';
                name.textContent = publisherName;
                publisherRow.appendChild(name);
            }
            info.appendChild(publisherRow);
            return info;
        };

        const hero = document.createElement('div');
        hero.className = 'snd-hero';
        const posterUrl = item.poster?.url || '';
        if (posterUrl) {
            const img = document.createElement('img');
            img.src = posterUrl;
            img.alt = item.title || 'Memtrack';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.width = Number(item.poster?.w) || 600;
            img.height = Number(item.poster?.h) || 180;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
            hero.appendChild(img);
        } else {
            const fallback = document.createElement('div');
            fallback.className = 'snd-memtrack-fallback';
            fallback.setAttribute('aria-hidden', 'true');
            fallback.textContent = '\u266B';
            hero.appendChild(fallback);
        }

        const veil = document.createElement('div');
        veil.style.cssText = 'position:absolute;inset:0;background:linear-gradient(to top,rgba(13,27,42,0.72),transparent)';
        hero.appendChild(veil);

        const star = createStarButton('soundlab', String(item.id || ''), {
            title: item.title || 'Memtrack',
            thumb_url: posterUrl || item.file?.url || '',
        });
        star.style.cssText = 'position:absolute;top:8px;right:8px';
        star.addEventListener('click', stopControlEvent);
        hero.appendChild(star);
        const publisherInfo = createPublisherInfo();
        if (publisherInfo) hero.appendChild(publisherInfo);

        const row = document.createElement('div');
        row.className = 'snd-player-row';
        row.style.cssText = 'display:flex;align-items:center;gap:14px;padding:16px 20px';

        const playButton = document.createElement('button');
        playButton.type = 'button';
        playButton.className = 'snd-play snd-memtrack-play';
        playButton.setAttribute('aria-label', localeText('browse.play', { title: item.title || 'Memtrack' }));
        playButton.style.cssText = 'width:40px;height:40px;border-radius:50%;background:rgba(0,240,255,0.07);border:1px solid rgba(0,240,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background 0.2s';
        const playIcon = document.createElement('span');
        playIcon.className = 'pi';
        playIcon.setAttribute('aria-hidden', 'true');
        playIcon.textContent = '\u25B6';
        playIcon.style.cssText = 'color:#00F0FF;font-size:14px;line-height:1;padding-left:2px';
        const pauseIcon = document.createElement('span');
        pauseIcon.className = 'pa';
        pauseIcon.setAttribute('aria-hidden', 'true');
        pauseIcon.textContent = '\u275A\u275A';
        pauseIcon.style.cssText = 'display:none;color:#00F0FF;font-size:13px;line-height:1';
        playButton.append(playIcon, pauseIcon);

        const metaWrap = document.createElement('div');
        metaWrap.style.cssText = 'flex:1;min-width:0';
        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px';
        const titleStack = document.createElement('div');
        titleStack.className = 'snd-title-stack';
        const title = document.createElement('h4');
        title.className = 'snd-title';
        title.textContent = item.title || 'Memtrack';
        titleStack.appendChild(title);
        const time = document.createElement('span');
        time.className = 'snd-time';
        time.style.cssText = "font-size:10px;font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,0.2);flex-shrink:0";
        time.textContent = '0:00';
        titleRow.append(titleStack, time);

        const bar = document.createElement('div');
        bar.className = 'snd-bar';
        bar.style.cssText = 'position:relative;height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;cursor:pointer';
        const progress = document.createElement('div');
        progress.className = 'snd-prog';
        progress.style.cssText = 'position:absolute;left:0;top:0;height:100%;width:0%;background:linear-gradient(90deg,#00F0FF,#FFB300);border-radius:2px;transition:width 0.1s linear';
        bar.appendChild(progress);
        metaWrap.append(titleRow, bar);

        const eq = document.createElement('div');
        eq.className = 'eq-wrap';
        eq.style.cssText = 'display:flex;align-items:flex-end;gap:2px;height:32px;flex-shrink:0';
        ['eqBar1 0.8s 6px', 'eqBar2 0.6s 12px', 'eqBar3 0.7s 4px', 'eqBar1 0.9s 8px', 'eqBar2 0.55s 10px'].forEach((entry) => {
            const [name, duration, height] = entry.split(' ');
            const barEl = document.createElement('div');
            barEl.className = 'eq-bar';
            barEl.style.cssText = `animation:${name} ${duration} ease-in-out infinite paused;height:${height}`;
            eq.appendChild(barEl);
        });

        row.append(playButton, metaWrap, eq);
        card.append(hero, row);

        const playItem = async (event) => {
            event?.stopPropagation();
            const track = getMemtrackTrack(item);
            if (!track) return;
            if (currentState.trackId === track.id && currentState.status === 'playing') {
                pauseGlobalAudio();
                return;
            }
            if (currentState.trackId === track.id) {
                await resumeGlobalAudio(true);
                return;
            }
            playGlobalTrack(track);
        };

        playButton.addEventListener('click', playItem);
        hero.setAttribute('role', 'button');
        hero.tabIndex = 0;
        hero.setAttribute('aria-label', localeText('browse.openMemtrackDetails', { title: item.title || 'Memtrack' }));
        hero.addEventListener('click', (event) => {
            event.stopPropagation();
            openMemtrackModal(item);
        });
        hero.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openMemtrackModal(item);
        });
        row.addEventListener('click', stopControlEvent);
        bar.addEventListener('pointerdown', stopControlEvent);
        bar.addEventListener('click', (event) => {
            event.stopPropagation();
            event.preventDefault();
            const track = getMemtrackTrack(item);
            const activeState = getGlobalAudioState();
            if (!track || activeState.trackId !== track.id || !activeState.duration) return;
            seekGlobalAudio(getSeekTimeFromPointer(bar, event, activeState.duration));
        });

        return card;
    }

    function getMemtrackIdentity(item) {
        return String(item?.id || item?.slug || item?.file?.url || '').trim();
    }

    function mergeMemtracksItems(items, { replace = false } = {}) {
        const nextItems = replace ? [] : memtracksState.items.slice();
        const seen = new Set(nextItems.map(getMemtrackIdentity).filter(Boolean));
        (Array.isArray(items) ? items : []).forEach((item) => {
            const identity = getMemtrackIdentity(item);
            if (identity && seen.has(identity)) return;
            if (identity) seen.add(identity);
            nextItems.push(item);
        });
        memtracksState.items = nextItems.slice(0, PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT);
    }

    async function fetchMemtracks(cursor = null, limit = MEMTRACKS_PAGE_LIMIT) {
        const safeLimit = Math.max(1, Math.min(MEMTRACKS_PAGE_LIMIT, Number(limit) || MEMTRACKS_PAGE_LIMIT));
        const params = new URLSearchParams({ limit: String(safeLimit) });
        if (cursor) params.set('cursor', cursor);
        const res = await fetch(`/api/gallery/memtracks?${params}`, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.ok) {
            throw new Error(body?.error || 'Published tracks unavailable.');
        }
        return body.data || {};
    }

    async function fetchAndMergeNextMemtracksPage({ updateUi = true, limit = MEMTRACKS_PAGE_LIMIT } = {}) {
        if (!memtracksState.hasMore || memtracksState.loadingMore || memtracksState.items.length >= PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT) return false;
        memtracksState.loadingMore = true;
        if (updateUi) syncMemtracksPagination();
        try {
            const remaining = Math.max(1, PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT - memtracksState.items.length);
            const page = await fetchMemtracks(memtracksState.nextCursor, Math.min(limit, remaining));
            const beforeCount = memtracksState.items.length;
            mergeMemtracksItems(Array.isArray(page.items) ? page.items : []);
            memtracksState.nextCursor = page.next_cursor || null;
            memtracksState.hasMore = !!page.has_more;
            return memtracksState.items.length > beforeCount;
        } finally {
            memtracksState.loadingMore = false;
            if (updateUi) syncMemtracksPagination();
        }
    }

    async function loadMemtracksUntilVisible(targetCount, { updateUi = false } = {}) {
        const safeTarget = Math.min(PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT, Math.max(0, Number(targetCount) || 0));
        while (memtracksState.items.length < safeTarget && memtracksState.hasMore) {
            const beforeCount = memtracksState.items.length;
            const fetched = await fetchAndMergeNextMemtracksPage({
                updateUi,
                limit: safeTarget - beforeCount,
            });
            if (!fetched || memtracksState.items.length <= beforeCount) break;
        }
    }

    function renderVisibleMemtracks() {
        const visibleItems = getVisibleMemtracks();
        ctn.replaceChildren();
        visibleItems.forEach((item) => {
            const card = createMemtrackCard(item);
            ctn.appendChild(card);
            if (revealObserver) revealObserver.observe(card);
        });
        syncMemtrackCardWidths();
        syncCategoryGhostModels('sound', visibleItems);
        renderMemtrackRows(currentState);
        ctn.dispatchEvent(new CustomEvent('snd:tracks-refresh'));
        document.dispatchEvent(new CustomEvent('bitbi:homepage-category-content-ready', {
            detail: { category: 'sound' },
        }));
        syncMemtracksPagination();
    }

    async function loadMemtracks() {
        if (memtracksState.loaded || memtracksState.loading) return;
        memtracksState.loading = true;
        syncStatus();
        try {
            const page = await fetchMemtracks(null, PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT);
            mergeMemtracksItems(Array.isArray(page.items) ? page.items : [], { replace: true });
            memtracksState.nextCursor = page.next_cursor || null;
            memtracksState.hasMore = !!page.has_more;
            await loadMemtracksUntilVisible(PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT);
            memtracksState.error = '';
            memtracksState.loaded = true;
            memtracksState.visibleLimit = PUBLIC_EXPLORE_INITIAL_VISIBLE_LIMIT;
            renderVisibleMemtracks();
        } catch (error) {
            console.warn('soundLab memtracks:', error);
            memtracksState.error = 'Could not load published tracks right now.';
            memtracksState.loaded = true;
            syncCategoryGhostModels('sound', []);
        } finally {
            memtracksState.loading = false;
            syncStatus();
            syncMemtracksPagination();
        }
    }

    async function loadMoreMemtracks() {
        if (!canRevealMoreMemtracks()) return;
        try {
            await loadMemtracksUntilVisible(PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT, { updateUi: true });
            memtracksState.visibleLimit = Math.min(
                PUBLIC_EXPLORE_MAX_VISIBLE_LIMIT,
                Math.max(memtracksState.visibleLimit, memtracksState.items.length),
            );
            renderVisibleMemtracks();
        } catch (error) {
            console.warn('soundLab memtracks load more:', error);
            memtracksState.error = localeText('browse.memtracksLoadMoreFailed');
            syncStatus();
            syncMemtracksPagination();
        }
    }

    function renderFromState(nextState) {
        currentState = nextState;
        renderMemtrackRows(nextState);
        const currentIdx = getCurrentMemtrackIndex(nextState);
        if (syncDeck && currentIdx >= 0) {
            syncDeck(currentIdx);
        }
    }

    function initSndDeck() {
        const mql = window.matchMedia('(max-width: 639px)');
        let deckActive = 0;
        let isDeck = false;
        let dotsEl = null;
        let swipeLock = false;
        let tracking = false;
        let decided = false;
        let horizontal = false;
        let sx = 0;
        let sy = 0;
        let st = 0;

        function getCards() {
            return Array.from(ctn.children).filter(card => card.classList.contains('snd-card--memtrack'));
        }

        function layout(skipAnim = false) {
            const cards = getCards();
            const n = cards.length;
            cards.forEach((card, i) => {
                const d = i - deckActive;
                card.style.transition = skipAnim ? 'none' : '';
                if (d === 0) {
                    card.style.transform = 'scale(0.90)';
                    card.style.opacity = '1';
                    card.style.zIndex = String(n);
                    card.style.pointerEvents = '';
                } else if (d === 1) {
                    card.style.transform = 'translateX(24px) scale(0.86)';
                    card.style.opacity = '0.55';
                    card.style.zIndex = String(n - 1);
                    card.style.pointerEvents = 'none';
                } else if (d === 2) {
                    card.style.transform = 'translateX(42px) scale(0.82)';
                    card.style.opacity = '0.3';
                    card.style.zIndex = String(n - 2);
                    card.style.pointerEvents = 'none';
                } else {
                    card.style.transform = d < 0 ? 'translateX(-30px) scale(0.82)' : 'translateX(50px) scale(0.80)';
                    card.style.opacity = '0';
                    card.style.zIndex = '0';
                    card.style.pointerEvents = 'none';
                }
            });
        }

        function syncDots() {
            if (!dotsEl) return;
            const cards = getCards();
            const dots = dotsEl.querySelectorAll('.snd-deck-dot');
            const targets = getMobileDeckDotTargets(cards.length, MAX_MOBILE_DECK_DOTS);
            if (dots.length !== targets.length) {
                buildDots();
                return;
            }
            const activeDot = getMobileDeckActiveDotIndex(deckActive, targets);
            dots.forEach((dot, i) => {
                dot.classList.toggle('active', i === activeDot);
                dot.setAttribute('aria-selected', i === activeDot ? 'true' : 'false');
            });
        }

        function buildDots() {
            if (dotsEl) dotsEl.remove();
            const cards = getCards();
            const targets = getMobileDeckDotTargets(cards.length, MAX_MOBILE_DECK_DOTS);
            if (targets.length <= 1) {
                dotsEl = null;
                return;
            }
            const activeDot = getMobileDeckActiveDotIndex(deckActive, targets);
            dotsEl = document.createElement('div');
            dotsEl.className = 'snd-deck-dots';
            dotsEl.setAttribute('role', 'tablist');
            dotsEl.setAttribute('aria-label', localeText('browse.soundLabTracks'));
            targets.forEach((target, i) => {
                const dot = document.createElement('button');
                dot.type = 'button';
                dot.className = `snd-deck-dot${i === activeDot ? ' active' : ''}`;
                dot.setAttribute('role', 'tab');
                dot.setAttribute('aria-selected', i === activeDot ? 'true' : 'false');
                dot.setAttribute('aria-label', `Show track ${target + 1}`);
                dot.dataset.targetIndex = String(target);
                dot.addEventListener('click', () => {
                    deckActive = target;
                    layout();
                    syncDots();
                });
                dotsEl.appendChild(dot);
            });
            ctn.after(dotsEl);
        }

        function refreshDeck(skipAnim = true) {
            const cards = getCards();
            if (deckActive >= cards.length) deckActive = 0;
            if (!isDeck) {
                cards.forEach((card) => {
                    card.style.transform = '';
                    card.style.opacity = '';
                    card.style.zIndex = '';
                    card.style.pointerEvents = '';
                    card.style.transition = '';
                });
                return;
            }
            layout(skipAnim);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    getCards().forEach(card => { card.style.transition = ''; });
                });
            });
            buildDots();
        }

        function engage() {
            if (isDeck) return;
            isDeck = true;
            const currentIdx = getCurrentMemtrackIndex();
            deckActive = currentIdx >= 0 ? currentIdx : 0;
            ctn.classList.add('snd-deck');
            refreshDeck(true);
        }

        function disengage() {
            if (!isDeck) return;
            isDeck = false;
            ctn.classList.remove('snd-deck');
            if (dotsEl) {
                dotsEl.remove();
                dotsEl = null;
            }
            refreshDeck(false);
        }

        ctn.addEventListener('touchstart', (event) => {
            if (!isDeck) return;
            const touch = event.touches[0];
            sx = touch.clientX;
            sy = touch.clientY;
            st = Date.now();
            tracking = true;
            decided = false;
            horizontal = false;
            swipeLock = false;
            const card = getCards()[deckActive];
            if (card) card.style.transition = 'none';
        }, { passive: true });

        ctn.addEventListener('touchmove', (event) => {
            if (!tracking || !isDeck) return;
            const touch = event.touches[0];
            const dx = touch.clientX - sx;
            const dy = touch.clientY - sy;
            if (!decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
                decided = true;
                horizontal = Math.abs(dx) > Math.abs(dy);
                if (!horizontal) {
                    tracking = false;
                    const card = getCards()[deckActive];
                    if (card) card.style.transition = '';
                    return;
                }
            }
            if (!horizontal) return;
            event.preventDefault();
            const card = getCards()[deckActive];
            if (!card) return;
            let adjusted = dx;
            const n = getCards().length;
            const atBoundary = (deckActive === 0 && dx > 0) || (deckActive >= n - 1 && dx < 0);
            if (atBoundary) adjusted *= 0.25;
            card.style.transform = `translateX(${adjusted}px) scale(0.90)`;
        }, { passive: false });

        ctn.addEventListener('touchend', (event) => {
            if (!tracking || !isDeck) return;
            tracking = false;
            if (!horizontal || !decided) {
                layout();
                return;
            }
            const dx = event.changedTouches[0].clientX - sx;
            const velocity = Math.abs(dx) / Math.max(Date.now() - st, 1);
            const n = getCards().length;
            if ((Math.abs(dx) > 40 || velocity > 0.3) && Math.abs(dx) > 15) {
                swipeLock = true;
                if (dx < 0 && deckActive < n - 1) deckActive++;
                else if (dx > 0 && deckActive > 0) deckActive--;
            }
            layout();
            syncDots();
        }, { passive: true });

        ctn.addEventListener('touchcancel', () => {
            if (!tracking || !isDeck) return;
            tracking = false;
            layout();
        }, { passive: true });

        ctn.addEventListener('click', (event) => {
            if (!swipeLock) return;
            event.stopPropagation();
            event.preventDefault();
            swipeLock = false;
        }, true);

        new MutationObserver(() => {
            if (isDeck) refreshDeck(true);
        }).observe(ctn, { childList: true });

        ctn.addEventListener('snd:tracks-refresh', () => {
            if (isDeck) refreshDeck(true);
        });

        mql.addEventListener('change', event => {
            if (event.matches) engage();
            else disengage();
        });

        if (mql.matches) engage();

        return function syncDeckToTrack(index) {
            if (!isDeck) return;
            const cards = getCards();
            if (index < 0 || index >= cards.length || index === deckActive) return;
            deckActive = index;
            layout();
            syncDots();
        };
    }

    syncDeck = initSndDeck();
    ctn.addEventListener('snd:tracks-refresh', scheduleMemtrackWidthSync);
    document.addEventListener('bitbi:homepage-category-layout-request', handleMemtracksCategoryLayoutRequest);
    if (typeof ResizeObserver === 'function') {
        memtrackResizeObserver = new ResizeObserver(scheduleMemtrackWidthSync);
        memtrackResizeObserver.observe(ctn);
    } else {
        window.addEventListener('resize', scheduleMemtrackWidthSync, { passive: true });
    }
    const categoryStage = document.getElementById('homeCategories');
    if (categoryStage && 'MutationObserver' in window) {
        memtrackStageObserver = new MutationObserver(scheduleMemtrackWidthSync);
        memtrackStageObserver.observe(categoryStage, {
            attributes: true,
            attributeFilter: ['class', 'data-active-category', 'data-stage-mode'],
        });
    }
    if (desktopSoundLayoutQuery) {
        if (typeof desktopSoundLayoutQuery.addEventListener === 'function') {
            desktopSoundLayoutQuery.addEventListener('change', scheduleMemtrackWidthSync);
        } else if (typeof desktopSoundLayoutQuery.addListener === 'function') {
            desktopSoundLayoutQuery.addListener(scheduleMemtrackWidthSync);
        }
    }
    document.fonts?.ready?.then(scheduleMemtrackWidthSync).catch(() => {});
    window.addEventListener('pagehide', () => {
        closeMemtrackModal();
        if (memtrackResizeObserver) { memtrackResizeObserver.disconnect(); memtrackResizeObserver = null; }
        if (memtrackStageObserver) { memtrackStageObserver.disconnect(); memtrackStageObserver = null; }
        window.removeEventListener('resize', scheduleMemtrackWidthSync);
        document.removeEventListener('bitbi:homepage-category-layout-request', handleMemtracksCategoryLayoutRequest);
        window.cancelAnimationFrame(memtrackWidthFrame);
    }, { once: true });
    paginationStatus.addEventListener('click', openMemtracksOverlay);
    paginationMore.addEventListener('click', loadMoreMemtracks);
    if (mobileMediaQuery) {
        const syncMobileTrigger = () => syncMemtracksPagination();
        if (typeof mobileMediaQuery.addEventListener === 'function') {
            mobileMediaQuery.addEventListener('change', syncMobileTrigger);
        } else if (typeof mobileMediaQuery.addListener === 'function') {
            mobileMediaQuery.addListener(syncMobileTrigger);
        }
    }
    subscribeGlobalAudioState(renderFromState);
    loadMemtracks();

    document.addEventListener('bitbi:audio-ended', (event) => {
        const endedIdx = memtracksState.items.findIndex(item => `memtrack:${item.id}` === event.detail?.trackId);
        if (endedIdx === -1 || endedIdx >= memtracksState.items.length - 1) return;
        const nextTrack = getMemtrackTrack(memtracksState.items[endedIdx + 1]);
        if (nextTrack) playGlobalTrack(nextTrack);
    });
}
