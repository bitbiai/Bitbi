/* ============================================================
   BITBI - Homepage latest models video module
   Replaces the old static Models image with live Memvid previews.
   ============================================================ */

import {
    fetchPublicMemvidsPage,
    getPublicMemvidIdentity,
    resolvePublicMemvidFileUrl,
} from './public-memvids.js?v=__ASSET_VERSION__';

const HERO_MODELS_VIDEO_MEDIA = [
    '(min-width: 1024px)',
    '(min-width: 768px) and (max-width: 1023px) and (min-height: 700px)',
].join(', ');
const REDUCED_MOTION_MEDIA = '(prefers-reduced-motion: reduce)';
const HOMEPAGE_HERO_VIDEO_SLOTS = ['right_top', 'right_bottom', 'left_top', 'left_bottom'];
const LATEST_MEMVID_LIMIT = 60;
const CYCLE_MS = 4000;
const BOTTOM_START_OFFSET_MS = 2000;
const TRANSITION_MS = 920;
const TRANSITION_FALLBACK_MS = TRANSITION_MS + 120;

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
        .map((item, originalIndex) => ({
            item,
            id: getPublicMemvidIdentity(item),
            src: resolvePublicMemvidFileUrl(item?.file?.url),
            poster: typeof item?.poster?.url === 'string' ? item.poster.url : '',
            sortTime: getItemSortTime(item),
            originalIndex,
        }))
        .filter((entry) => entry.id && entry.src)
        .sort((a, b) => {
            if (b.sortTime !== a.sortTime) return b.sortTime - a.sortTime;
            return a.originalIndex - b.originalIndex;
        });
}

function resolvePublicHeroVideoUrl(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    try {
        const url = new URL(raw, window.location.origin);
        if (url.origin !== window.location.origin) return '';
        if (!url.pathname.startsWith('/api/homepage/hero-videos/')) return '';
        if (!url.pathname.endsWith('/file')) return '';
        return `${url.pathname}${url.search}`;
    } catch {
        return '';
    }
}

function resolvePublicHeroPosterUrl(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    try {
        const url = new URL(raw, window.location.origin);
        if (url.origin !== window.location.origin) return '';
        if (!url.pathname.startsWith('/api/homepage/hero-videos/')) return '';
        if (!url.pathname.endsWith('/poster')) return '';
        return `${url.pathname}${url.search}`;
    } catch {
        return '';
    }
}

function getConfiguredHeroEntries(slots) {
    if (!Array.isArray(slots)) return null;
    const bySlot = new Map();
    slots.forEach((slot) => {
        const slotName = typeof slot?.slot === 'string' ? slot.slot : '';
        if (!HOMEPAGE_HERO_VIDEO_SLOTS.includes(slotName)) return;
        const src = resolvePublicHeroVideoUrl(slot?.file?.url);
        const poster = resolvePublicHeroPosterUrl(slot?.poster?.url);
        const version = typeof slot?.version === 'string' ? slot.version.trim() : '';
        if (!src || !poster || !version) return;
        bySlot.set(slotName, {
            item: slot,
            id: `homepage-hero-${slotName}-${version}`,
            src,
            poster,
            sortTime: 0,
            originalIndex: HOMEPAGE_HERO_VIDEO_SLOTS.indexOf(slotName),
            slot: slotName,
        });
    });
    if (!HOMEPAGE_HERO_VIDEO_SLOTS.every((slot) => bySlot.has(slot))) return null;
    return bySlot;
}

async function fetchConfiguredHomepageHeroVideos() {
    const res = await fetch('/api/homepage/hero-videos', {
        credentials: 'same-origin',
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return null;
    if (data?.data?.configured !== true) return null;
    return getConfiguredHeroEntries(data?.data?.slots);
}

function getItemSortTime(item) {
    const candidates = [
        item?.published_at,
        item?.created_at,
        item?.updated_at,
    ];
    for (const value of candidates) {
        const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
        if (Number.isFinite(time)) return time;
    }
    return 0;
}

function getModuleSide(module, index) {
    const side = module?.dataset?.latestModelsVideoModuleSide;
    if (side === 'left' || side === 'right') return side;
    return index === 0 ? 'right' : 'left';
}

function getEntriesForSide(entries, side) {
    const latestEntries = entries.slice(0, 5);
    const nextEntries = entries.slice(5, 10);
    const selected = side === 'left' ? nextEntries : latestEntries;
    return selected.length ? selected : latestEntries;
}

function getConfiguredEntryForSlot(configuredEntries, side, position) {
    const slot = `${side}_${position}`;
    return configuredEntries?.get?.(slot) || null;
}

function createFallback() {
    const fallback = document.createElement('span');
    fallback.className = 'latest-models-video-module__fallback';
    fallback.setAttribute('aria-hidden', 'true');
    return fallback;
}

function createVideo(entry, playing = true) {
    const video = document.createElement('video');
    video.className = 'latest-models-video-module__video';
    video.setAttribute('aria-hidden', 'true');
    video.setAttribute('playsinline', '');
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.autoplay = playing;
    video.playsInline = true;
    video.preload = 'metadata';
    video.controls = false;
    video.disablePictureInPicture = true;
    video.src = entry.src;
    if (entry.poster) video.poster = entry.poster;
    if (playing) playVideo(video);
    return video;
}

function createFace(entry, side, playing = true) {
    const face = document.createElement('span');
    face.className = `latest-models-video-module__face latest-models-video-module__face--${side}`;
    face.setAttribute('aria-hidden', 'true');
    face.appendChild(entry ? createVideo(entry, playing) : createFallback());
    return face;
}

function disposeVideos(root, preserveRoot = null) {
    root?.querySelectorAll?.('video')?.forEach((video) => {
        if (preserveRoot?.contains?.(video)) return;
        video.pause();
        video.removeAttribute('src');
        try { video.load(); } catch { /* noop */ }
    });
}

function setFaceSide(face, side) {
    face.classList.remove('latest-models-video-module__face--front', 'latest-models-video-module__face--right');
    face.classList.add(`latest-models-video-module__face--${side}`);
}

function playVideo(video) {
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
    }
}

function clearSlot(slot) {
    disposeVideos(slot);
    slot.replaceChildren(createFallback());
    slot.classList.remove('is-turning', 'is-ready', 'is-reduced-transition');
    slot.removeAttribute('data-active-video-id');
    slot.removeAttribute('data-active-index');
    slot.removeAttribute('data-transition-count');
    slot.removeAttribute('data-next-delay-ms');
}

function renderSettledSlot(slot, entry, index, transitionCount, preservedFace = null, playing = true) {
    const previousChildren = Array.from(slot.children);
    const face = preservedFace || createFace(entry, 'front', playing);
    setFaceSide(face, 'front');

    const cube = document.createElement('span');
    cube.className = 'latest-models-video-module__cube';
    cube.appendChild(face);
    previousChildren.forEach((node) => {
        if (node !== cube) disposeVideos(node, face);
    });
    slot.replaceChildren(cube);
    slot.classList.add('is-ready');
    slot.classList.remove('is-turning', 'is-reduced-transition');
    slot.dataset.activeVideoId = entry?.id || '';
    slot.dataset.activeIndex = String(index);
    slot.dataset.transitionCount = String(transitionCount);
}

function makeSlotController(slot, entries, startIndex, { reducedMotion = false, suspended = false } = {}) {
    let index = startIndex % entries.length;
    let transitionCount = 0;
    let timer = 0;
    let transitionTimer = 0;
    let stopped = false;
    let cycleDue = 0;
    let cycleRemaining = null;
    let transitionDue = 0;
    let transitionRemaining = 0;
    let finishTransition = null;
    const resumeVideos = new Set();

    function stop() {
        stopped = true;
        window.clearTimeout(timer);
        window.clearTimeout(transitionTimer);
        finishTransition = null;
        resumeVideos.clear();
        clearSlot(slot);
    }

    function schedule(delay = CYCLE_MS) {
        window.clearTimeout(timer);
        if (stopped || entries.length < 2) return;
        cycleRemaining = delay;
        slot.dataset.nextDelayMs = String(delay);
        if (suspended) return;
        cycleDue = performance.now() + delay;
        timer = window.setTimeout(advance, delay);
    }

    function setSuspended(nextSuspended) {
        if (stopped || suspended === nextSuspended) return;
        suspended = nextSuspended;
        const cube = slot.querySelector('.latest-models-video-module__cube');
        if (suspended) {
            if (timer) cycleRemaining = Math.max(0, cycleDue - performance.now());
            if (transitionTimer) transitionRemaining = Math.max(0, transitionDue - performance.now());
            window.clearTimeout(timer);
            window.clearTimeout(transitionTimer);
            timer = 0;
            transitionTimer = 0;
            if (cube && finishTransition) cube.style.animationPlayState = 'paused';
            slot.querySelectorAll('video').forEach((video) => {
                // Only resume playback that this lifecycle actually suspended.
                if (!video.paused) {
                    resumeVideos.add(video);
                    video.pause();
                }
            });
            return;
        }
        if (cube) cube.style.removeProperty('animation-play-state');
        resumeVideos.forEach((video) => {
            if (!slot.contains(video)) return;
            video.autoplay = true;
            playVideo(video);
        });
        resumeVideos.clear();
        if (finishTransition) {
            transitionDue = performance.now() + transitionRemaining;
            transitionTimer = window.setTimeout(finishTransition, transitionRemaining);
        } else if (cycleRemaining !== null) {
            schedule(cycleRemaining);
        }
    }

    function settle(nextIndex, incomingFace = null) {
        index = nextIndex;
        renderSettledSlot(slot, entries[index], index, transitionCount, incomingFace, !suspended);
        schedule();
    }

    function advance() {
        if (stopped || suspended || entries.length < 2) return;
        timer = 0;
        cycleRemaining = null;
        const nextIndex = (index + 1) % entries.length;
        transitionCount += 1;
        slot.removeAttribute('data-next-delay-ms');

        const previousChildren = Array.from(slot.children);
        const existingFrontFace = slot.querySelector(':scope > .latest-models-video-module__cube > .latest-models-video-module__face--front');
        const frontFace = existingFrontFace || createFace(entries[index], 'front');
        const incomingFace = createFace(entries[nextIndex], reducedMotion ? 'front' : 'right');

        if (reducedMotion) {
            slot.classList.add('is-reduced-transition');
            previousChildren.forEach((node) => disposeVideos(node, incomingFace));
            settle(nextIndex, incomingFace);
            return;
        }

        const cube = document.createElement('span');
        cube.className = 'latest-models-video-module__cube is-turning';
        setFaceSide(frontFace, 'front');
        setFaceSide(incomingFace, 'right');
        cube.append(
            frontFace,
            incomingFace,
        );
        previousChildren.forEach((node) => disposeVideos(node, frontFace));
        slot.replaceChildren(cube);
        slot.classList.add('is-turning', 'is-ready');
        slot.dataset.activeVideoId = entries[nextIndex]?.id || '';
        slot.dataset.activeIndex = String(nextIndex);
        slot.dataset.transitionCount = String(transitionCount);
        window.clearTimeout(transitionTimer);

        let didSettle = false;
        const finish = (event) => {
            if (event && event.target !== cube) return;
            if (didSettle || suspended) return;
            didSettle = true;
            cube.removeEventListener('animationend', finish);
            window.clearTimeout(transitionTimer);
            transitionTimer = 0;
            finishTransition = null;
            if (!stopped) settle(nextIndex, incomingFace);
        };
        cube.addEventListener('animationend', finish);
        finishTransition = finish;
        transitionRemaining = TRANSITION_FALLBACK_MS;
        transitionDue = performance.now() + transitionRemaining;
        transitionTimer = window.setTimeout(finish, TRANSITION_FALLBACK_MS);
    }

    renderSettledSlot(slot, entries[index], index, transitionCount, null, !suspended);
    if (suspended) slot.querySelectorAll('video').forEach((video) => resumeVideos.add(video));

    return {
        schedule,
        setSuspended,
        stop,
    };
}

export function initLatestModelsVideoModule(root = document) {
    const modules = Array.from(root.querySelectorAll('#hero .hero__models-cta [data-latest-models-video-module]'))
        .map((module, index) => ({
            module,
            side: getModuleSide(module, index),
            slots: {
                top: module.querySelector('[data-latest-models-slot="top"]'),
                bottom: module.querySelector('[data-latest-models-slot="bottom"]'),
            },
            controllers: [],
        }))
        .filter((entry) => entry.slots.top && entry.slots.bottom);
    if (!modules.length) return;

    const heroVisualQuery = window.matchMedia?.(HERO_MODELS_VIDEO_MEDIA);
    const reducedMotionQuery = window.matchMedia?.(REDUCED_MOTION_MEDIA);
    const hero = modules[0].module.closest('#hero');
    let enabled = false;
    let loadToken = 0;
    let pageHidden = false;
    let lastReducedMotion = !!reducedMotionQuery?.matches;
    let heroInView = isHeroInView();

    function isHeroInView() {
        const rect = hero?.getBoundingClientRect();
        return !rect || (rect.bottom > 0 && rect.top < window.innerHeight);
    }

    function isSuspended() {
        return pageHidden || document.hidden || !heroInView;
    }

    function syncPlayback() {
        const suspended = isSuspended();
        modules.forEach((entry) => {
            entry.controllers.forEach((controller) => controller.setSuspended(suspended));
        });
    }

    const observer = typeof IntersectionObserver === 'function' && hero
        ? new IntersectionObserver((entries) => {
            heroInView = entries[entries.length - 1].isIntersecting;
            syncPlayback();
        })
        : null;

    function stop() {
        modules.forEach((entry) => {
            entry.controllers.forEach((controller) => controller.stop());
            entry.controllers = [];
        });
        enabled = false;
    }

    function clearModule(entry) {
        clearSlot(entry.slots.top);
        clearSlot(entry.slots.bottom);
    }

    function startModule(entry, entries, reducedMotion) {
        if (!entries.length) {
            entry.module.dataset.videoModuleState = 'fallback';
            clearModule(entry);
            return;
        }

        entry.module.dataset.videoModuleState = 'ready';
        entry.module.dataset.latestModelsVideoPool = entry.side;
        const slotEntries = entries.length > 1 ? entries : [entries[0], entries[0]];
        const options = { reducedMotion, suspended: isSuspended() };
        const topController = makeSlotController(entry.slots.top, slotEntries, 0, options);
        const bottomController = makeSlotController(entry.slots.bottom, slotEntries, 1 % slotEntries.length, options);
        entry.controllers = [topController, bottomController];
        topController.schedule(CYCLE_MS);
        bottomController.schedule(BOTTOM_START_OFFSET_MS);
    }

    function startConfiguredModule(entry, configuredEntries, reducedMotion) {
        const topEntry = getConfiguredEntryForSlot(configuredEntries, entry.side, 'top');
        const bottomEntry = getConfiguredEntryForSlot(configuredEntries, entry.side, 'bottom');
        if (!topEntry || !bottomEntry) {
            entry.module.dataset.videoModuleState = 'fallback';
            clearModule(entry);
            return;
        }

        entry.module.dataset.videoModuleState = 'ready';
        entry.module.dataset.latestModelsVideoPool = `homepage-hero-${entry.side}`;
        const options = { reducedMotion, suspended: isSuspended() };
        const topController = makeSlotController(entry.slots.top, [topEntry], 0, options);
        const bottomController = makeSlotController(entry.slots.bottom, [bottomEntry], 0, options);
        entry.controllers = [topController, bottomController];
    }

    async function start() {
        if (!heroVisualQuery?.matches) {
            stop();
            return;
        }
        if (enabled) return;
        enabled = true;
        const token = ++loadToken;
        modules.forEach((entry) => {
            entry.module.dataset.videoModuleState = 'loading';
        });
        try {
            let configuredEntries = null;
            try {
                configuredEntries = await fetchConfiguredHomepageHeroVideos();
            } catch {
                configuredEntries = null;
            }
            if (token !== loadToken || !heroVisualQuery.matches) return;
            if (configuredEntries) {
                stop();
                enabled = true;
                const reducedMotion = !!reducedMotionQuery?.matches;
                modules.forEach((entry) => {
                    startConfiguredModule(entry, configuredEntries, reducedMotion);
                });
                return;
            }

            const page = await fetchPublicMemvidsPage({ limit: LATEST_MEMVID_LIMIT });
            if (token !== loadToken || !heroVisualQuery.matches) return;
            const entries = getPreviewItems(page.items);
            if (!entries.length) {
                modules.forEach((entry) => {
                    entry.module.dataset.videoModuleState = 'fallback';
                    clearModule(entry);
                });
                return;
            }
            stop();
            enabled = true;
            const reducedMotion = !!reducedMotionQuery?.matches;
            modules.forEach((entry) => {
                startModule(entry, getEntriesForSide(entries, entry.side), reducedMotion);
            });
        } catch (error) {
            console.warn('latestModelsVideoModule:', error);
            if (token !== loadToken) return;
            modules.forEach((entry) => {
                entry.module.dataset.videoModuleState = 'fallback';
                clearModule(entry);
            });
        }
    }

    function sync() {
        loadToken += 1;
        lastReducedMotion = !!reducedMotionQuery?.matches;
        stop();
        start();
    }

    function observe() {
        bindMediaQueryChange(heroVisualQuery, sync);
        bindMediaQueryChange(reducedMotionQuery, sync);
        document.addEventListener('visibilitychange', syncPlayback);
        if (observer) observer.observe(hero);
    }

    function disconnect() {
        removeMediaQueryChange(heroVisualQuery, sync);
        removeMediaQueryChange(reducedMotionQuery, sync);
        document.removeEventListener('visibilitychange', syncPlayback);
        observer?.disconnect();
    }

    function onPageHide(event) {
        pageHidden = true;
        syncPlayback();
        disconnect();
        // Keep existing decoders and playback positions when entering bfcache.
        if (event.persisted) return;
        loadToken += 1;
        stop();
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('pageshow', onPageShow);
    }

    function onPageShow() {
        if (!pageHidden) return;
        pageHidden = false;
        heroInView = isHeroInView();
        observe();
        if (!heroVisualQuery?.matches || lastReducedMotion !== !!reducedMotionQuery?.matches) {
            sync();
        } else {
            start();
            syncPlayback();
        }
    }

    observe();
    start();
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
}
