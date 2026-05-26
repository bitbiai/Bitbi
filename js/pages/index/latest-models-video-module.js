/* ============================================================
   BITBI - Homepage latest models video module
   Replaces the old static Models image with live Memvid previews.
   ============================================================ */

import {
    fetchPublicMemvidsPage,
    getPublicMemvidIdentity,
    resolvePublicMemvidFileUrl,
} from './public-memvids.js?v=__ASSET_VERSION__';

const DESKTOP_MODELS_VIDEO_MEDIA = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';
const REDUCED_MOTION_MEDIA = '(prefers-reduced-motion: reduce)';
const LATEST_MEMVID_LIMIT = 60;
const CYCLE_MS = 4000;
const BOTTOM_START_OFFSET_MS = 2000;
const TRANSITION_MS = 920;

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

function removeMediaQueryChange(query, listener) {
    if (!query) return;
    if (typeof query.removeEventListener === 'function') {
        query.removeEventListener('change', listener);
        return;
    }
    if (typeof query.removeListener === 'function') {
        query.removeListener(listener);
    }
}

function getPreviewItems(items) {
    return (Array.isArray(items) ? items : [])
        .map((item) => ({
            item,
            id: getPublicMemvidIdentity(item),
            src: resolvePublicMemvidFileUrl(item?.file?.url),
            poster: typeof item?.poster?.url === 'string' ? item.poster.url : '',
        }))
        .filter((entry) => entry.id && entry.src);
}

function createFallback() {
    const fallback = document.createElement('span');
    fallback.className = 'latest-models-video-module__fallback';
    fallback.setAttribute('aria-hidden', 'true');
    return fallback;
}

function createVideo(entry) {
    const video = document.createElement('video');
    video.className = 'latest-models-video-module__video';
    video.setAttribute('aria-hidden', 'true');
    video.setAttribute('playsinline', '');
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.controls = false;
    video.disablePictureInPicture = true;
    video.src = entry.src;
    if (entry.poster) video.poster = entry.poster;
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
    }
    return video;
}

function createFace(entry, side) {
    const face = document.createElement('span');
    face.className = `latest-models-video-module__face latest-models-video-module__face--${side}`;
    face.setAttribute('aria-hidden', 'true');
    face.appendChild(entry ? createVideo(entry) : createFallback());
    return face;
}

function clearSlot(slot) {
    slot.querySelectorAll('video').forEach((video) => {
        video.pause();
        video.removeAttribute('src');
        try { video.load(); } catch { /* noop */ }
    });
    slot.replaceChildren(createFallback());
    slot.classList.remove('is-turning', 'is-ready');
    slot.removeAttribute('data-active-video-id');
    slot.removeAttribute('data-active-index');
    slot.removeAttribute('data-transition-count');
}

function renderSettledSlot(slot, entry, index, transitionCount) {
    slot.querySelectorAll('video').forEach((video) => {
        video.pause();
        video.removeAttribute('src');
        try { video.load(); } catch { /* noop */ }
    });
    const cube = document.createElement('span');
    cube.className = 'latest-models-video-module__cube';
    cube.appendChild(createFace(entry, 'front'));
    slot.replaceChildren(cube);
    slot.classList.add('is-ready');
    slot.classList.remove('is-turning');
    slot.dataset.activeVideoId = entry?.id || '';
    slot.dataset.activeIndex = String(index);
    slot.dataset.transitionCount = String(transitionCount);
}

function makeSlotController(slot, entries, startIndex, { reducedMotion = false } = {}) {
    let index = startIndex % entries.length;
    let transitionCount = 0;
    let timer = 0;
    let transitionTimer = 0;
    let stopped = false;

    function stop() {
        stopped = true;
        window.clearTimeout(timer);
        window.clearTimeout(transitionTimer);
        clearSlot(slot);
    }

    function schedule(delay = CYCLE_MS) {
        window.clearTimeout(timer);
        if (stopped || entries.length < 2) return;
        timer = window.setTimeout(advance, delay);
    }

    function settle(nextIndex) {
        index = nextIndex;
        renderSettledSlot(slot, entries[index], index, transitionCount);
        schedule();
    }

    function advance() {
        if (stopped || entries.length < 2) return;
        const nextIndex = (index + 1) % entries.length;
        transitionCount += 1;

        if (reducedMotion) {
            slot.classList.add('is-reduced-transition');
            settle(nextIndex);
            return;
        }

        const cube = document.createElement('span');
        cube.className = 'latest-models-video-module__cube is-turning';
        cube.append(
            createFace(entries[index], 'front'),
            createFace(entries[nextIndex], 'right'),
        );
        slot.querySelectorAll('video').forEach((video) => {
            video.pause();
            video.removeAttribute('src');
            try { video.load(); } catch { /* noop */ }
        });
        slot.replaceChildren(cube);
        slot.classList.add('is-turning', 'is-ready');
        slot.dataset.activeVideoId = entries[nextIndex]?.id || '';
        slot.dataset.activeIndex = String(nextIndex);
        slot.dataset.transitionCount = String(transitionCount);
        window.clearTimeout(transitionTimer);
        transitionTimer = window.setTimeout(() => {
            if (!stopped) settle(nextIndex);
        }, TRANSITION_MS);
    }

    renderSettledSlot(slot, entries[index], index, transitionCount);

    return {
        schedule,
        stop,
    };
}

export function initLatestModelsVideoModule(root = document) {
    const button = root.querySelector('#hero .hero__models-cta[data-models-link="desktop"]');
    const module = button?.querySelector('[data-latest-models-video-module]');
    if (!button || !module) return;

    const desktopQuery = window.matchMedia?.(DESKTOP_MODELS_VIDEO_MEDIA);
    const reducedMotionQuery = window.matchMedia?.(REDUCED_MOTION_MEDIA);
    const slots = {
        top: module.querySelector('[data-latest-models-slot="top"]'),
        bottom: module.querySelector('[data-latest-models-slot="bottom"]'),
    };
    if (!slots.top || !slots.bottom) return;

    let controllers = [];
    let enabled = false;
    let loadToken = 0;

    function stop() {
        controllers.forEach((controller) => controller.stop());
        controllers = [];
        enabled = false;
    }

    async function start() {
        if (!desktopQuery?.matches) {
            stop();
            return;
        }
        if (enabled) return;
        enabled = true;
        const token = ++loadToken;
        module.dataset.videoModuleState = 'loading';
        try {
            const page = await fetchPublicMemvidsPage({ limit: LATEST_MEMVID_LIMIT });
            if (token !== loadToken || !desktopQuery.matches) return;
            const entries = getPreviewItems(page.items).slice(0, 8);
            if (!entries.length) {
                module.dataset.videoModuleState = 'fallback';
                clearSlot(slots.top);
                clearSlot(slots.bottom);
                return;
            }
            stop();
            enabled = true;
            module.dataset.videoModuleState = 'ready';
            const slotEntries = entries.length > 1 ? entries : [entries[0], entries[0]];
            const reducedMotion = !!reducedMotionQuery?.matches;
            const topController = makeSlotController(slots.top, slotEntries, 0, { reducedMotion });
            const bottomController = makeSlotController(slots.bottom, slotEntries, 1 % slotEntries.length, { reducedMotion });
            controllers = [topController, bottomController];
            topController.schedule(CYCLE_MS);
            bottomController.schedule(reducedMotion ? CYCLE_MS : BOTTOM_START_OFFSET_MS);
        } catch (error) {
            console.warn('latestModelsVideoModule:', error);
            if (token !== loadToken) return;
            module.dataset.videoModuleState = 'fallback';
            clearSlot(slots.top);
            clearSlot(slots.bottom);
        }
    }

    function sync() {
        loadToken += 1;
        stop();
        start();
    }

    bindMediaQueryChange(desktopQuery, sync);
    bindMediaQueryChange(reducedMotionQuery, sync);
    start();

    window.addEventListener('pagehide', () => {
        removeMediaQueryChange(desktopQuery, sync);
        removeMediaQueryChange(reducedMotionQuery, sync);
        loadToken += 1;
        stop();
    }, { once: true });
}
