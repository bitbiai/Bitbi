/* ============================================================
   BITBI — Homepage category carousel
   Keeps Gallery / Video / Sound as isolated section modules
   while presenting them as a single staged carousel surface.
   ============================================================ */

const CATEGORY_ORDER = ['gallery', 'video', 'sound'];
const HOME_CATEGORY_NAV_STATE_KEY = 'bitbi:pending-home-category';
const DESKTOP_HOVER_MEDIA = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';
const TABLET_DESKTOP_LAYOUT_MEDIA = [
    '(min-width: 768px) and (max-width: 1023px) and (min-height: 700px)',
    '(min-width: 1024px) and (hover: none) and (pointer: coarse) and (min-height: 700px)',
].join(', ');
const STAGED_LAYOUT_MEDIA = `${DESKTOP_HOVER_MEDIA}, ${TABLET_DESKTOP_LAYOUT_MEDIA}`;

const CATEGORY_META = {
    gallery: {
        hash: '#gallery',
        label: 'AI Creations Gallery',
    },
    video: {
        hash: '#video-creations',
        label: 'Video Creations',
    },
    sound: {
        hash: '#soundlab',
        label: 'Sound Lab',
    },
};

const TRANSITION_MS = 560;
const LAYOUT_PREPARE_TIMEOUT_MS = 160;

function resolveCategoryFromHash(hash) {
    return CATEGORY_ORDER.find((key) => CATEGORY_META[key].hash === hash) || null;
}

function getPendingCategoryHash() {
    const pendingHash = window.sessionStorage?.getItem(HOME_CATEGORY_NAV_STATE_KEY) || '';
    return resolveCategoryFromHash(pendingHash) ? pendingHash : '';
}

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

function unbindMediaQueryChange(query, listener) {
    if (!query) return;
    if (typeof query.removeEventListener === 'function') {
        query.removeEventListener('change', listener);
        return;
    }
    if (typeof query.removeListener === 'function') {
        query.removeListener(listener);
    }
}

function setPanelInert(panel, inert) {
    if (!panel) return;
    if (inert) {
        panel.setAttribute('inert', '');
        return;
    }
    panel.removeAttribute('inert');
}

function shouldHonorInitialCategoryHash() {
    if (resolveCategoryFromHash(window.location.hash)) {
        const pendingHash = getPendingCategoryHash();
        if (pendingHash === window.location.hash) return true;
        const navEntry = performance.getEntriesByType?.('navigation')?.[0];
        return navEntry?.type !== 'reload';
    }
    if (!getPendingCategoryHash()) return false;
    const navEntry = performance.getEntriesByType?.('navigation')?.[0];
    return navEntry?.type !== 'reload';
}

function supportsStagedCategoryMotion() {
    if (typeof window.CSS?.supports !== 'function') return false;
    return window.CSS.supports('perspective', '1px')
        && window.CSS.supports('transform', 'translate3d(0, 0, 0) rotateY(1deg) scale(1)')
        && window.CSS.supports('transition', 'transform 1ms linear');
}

export function initCategoryCarousel() {
    const stage = document.getElementById('homeCategories');
    const viewport = stage?.querySelector('.home-categories__viewport');
    const navbar = document.getElementById('navbar');
    const stagedLayoutQuery = window.matchMedia?.(STAGED_LAYOUT_MEDIA);
    const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const categoryLinks = new Map(
        CATEGORY_ORDER.map((key) => [key, Array.from(document.querySelectorAll(`[data-category-link="${key}"]`))]),
    );

    if (!stage || !viewport) return;

    const panels = new Map(
        Array.from(stage.querySelectorAll('[data-category-panel]'))
            .map((panel) => [panel.dataset.categoryPanel, panel]),
    );

    if (panels.size !== CATEGORY_ORDER.length) return;

    let activeCategory = resolveCategoryFromHash(window.location.hash)
        || resolveCategoryFromHash(getPendingCategoryHash())
        || 'video';
    let isTransitioning = false;
    let pendingCategory = null;
    let transitionTimer = 0;
    let transitionSeq = 0;
    let scrollFrame = 0;
    let contentAlignmentFrame = 0;
    let stagedLayoutEnabled = false;
    let transitionEndCleanup = null;
    let queuedSwitch = null;
    let activeTransition = null;
    let activationFrame = 0;
    let postTransitionFrame = 0;
    let destroyed = false;
    const layoutWaits = new Set();
    const frameWaits = new Set();
    const stagedMotionSupported = supportsStagedCategoryMotion();

    function syncMotionEngine() {
        stage.dataset.motionEngine = stagedMotionSupported && !reducedMotionQuery?.matches
            ? 'standard'
            : 'instant';
    }

    syncMotionEngine();

    function getPanel(category) {
        return panels.get(category) || null;
    }

    function clearPanelState(panel) {
        if (!panel) return;
        panel.classList.remove(
            'is-active',
            'is-before',
            'is-after',
            'is-far-before',
            'is-far-after',
            'is-transition-current',
            'is-transition-next',
            'is-from-left',
            'is-from-right',
            'is-leave-left',
            'is-leave-right',
            'is-enter-active',
            'is-layout-preparing',
        );
    }

    function syncVisibleReveals(panel) {
        panel?.querySelectorAll('.reveal').forEach((el) => {
            el.classList.add('visible');
        });
    }

    function getStageAlignmentDelta() {
        const navBottom = navbar?.getBoundingClientRect().bottom || 0;
        const stageTop = stage.getBoundingClientRect().top;
        return stageTop - navBottom;
    }

    function easeInOutCubic(value) {
        if (value < 0.5) return 4 * value * value * value;
        return 1 - Math.pow(-2 * value + 2, 3) / 2;
    }

    function stopStageAlignmentAnimation() {
        if (!scrollFrame) return;
        window.cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
    }

    function stopContentAlignmentWatch() {
        if (!contentAlignmentFrame) return;
        window.cancelAnimationFrame(contentAlignmentFrame);
        contentAlignmentFrame = 0;
    }

    function stopTransitionEndWatch() {
        if (!transitionEndCleanup) return;
        transitionEndCleanup();
        transitionEndCleanup = null;
    }

    function alignStageToHeaderEdge() {
        stopStageAlignmentAnimation();
        const alignmentDelta = getStageAlignmentDelta();
        if (Math.abs(alignmentDelta) <= 1) return;
        window.scrollBy({ top: alignmentDelta, behavior: 'auto' });
    }

    function startContentAlignmentWatch(durationMs = 900) {
        stopContentAlignmentWatch();
        const stopAt = performance.now() + durationMs;
        const step = () => {
            if (destroyed || !stagedLayoutEnabled) {
                contentAlignmentFrame = 0;
                return;
            }
            alignStageToHeaderEdge();
            if (Math.abs(getStageAlignmentDelta()) <= 1 || performance.now() >= stopAt) {
                contentAlignmentFrame = 0;
                return;
            }
            contentAlignmentFrame = window.requestAnimationFrame(step);
        };
        contentAlignmentFrame = window.requestAnimationFrame(step);
    }

    function animateStageAlignment() {
        stopStageAlignmentAnimation();

        const initialDelta = getStageAlignmentDelta();
        const startTime = performance.now();

        const step = (now) => {
            if (destroyed || !stagedLayoutEnabled) {
                scrollFrame = 0;
                return;
            }
            const progress = Math.min(1, (now - startTime) / TRANSITION_MS);
            const eased = easeInOutCubic(progress);
            const desiredDelta = Math.abs(initialDelta) <= 1
                ? 0
                : initialDelta * (1 - eased);
            const currentDelta = getStageAlignmentDelta();
            const correctionDelta = progress >= 1
                ? currentDelta
                : currentDelta - desiredDelta;

            if (Math.abs(correctionDelta) > 0.5) {
                window.scrollBy({
                    top: correctionDelta,
                    behavior: 'auto',
                });
            }

            if (progress < 1) {
                scrollFrame = window.requestAnimationFrame(step);
                return;
            }

            scrollFrame = 0;
        };

        step(startTime + (1000 / 60));
        if (scrollFrame) return;
        scrollFrame = window.requestAnimationFrame(step);
    }

    function alignStageForSameCategory() {
        animateStageAlignment();
    }

    function dispatchCategoryDeactivating(nextCategory) {
        document.dispatchEvent(new CustomEvent('bitbi:homepage-category-deactivating', {
            detail: {
                category: activeCategory,
                nextCategory,
                stageMode: stage.dataset.stageMode || '',
            },
        }));
    }

    function applyCategoryState() {
        panels.forEach((panel, key) => {
            const isActive = key === activeCategory;
            clearPanelState(panel);
            if (isActive) panel.classList.add('is-active');
            panel.setAttribute('aria-hidden', String(!isActive));
            setPanelInert(panel, !isActive);
        });
        stage.dataset.activeCategory = activeCategory;
        syncVisibleReveals(getPanel(activeCategory));
        if (activationFrame) window.cancelAnimationFrame(activationFrame);
        activationFrame = window.requestAnimationFrame(() => {
            activationFrame = 0;
            if (destroyed) return;
            document.dispatchEvent(new CustomEvent('bitbi:homepage-category-activated', {
                detail: {
                    category: activeCategory,
                    stageMode: stage.dataset.stageMode || '',
                },
            }));
        });
    }

    function waitForAnimationFrame(count = 1) {
        const safeCount = Math.max(1, Number(count) || 1);
        return new Promise((resolve) => {
            let remaining = safeCount;
            let frame = 0;
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                if (frame) window.cancelAnimationFrame(frame);
                frameWaits.delete(wait);
                resolve();
            };
            const wait = { finish };
            frameWaits.add(wait);
            const step = () => {
                frame = 0;
                remaining -= 1;
                if (remaining <= 0) {
                    finish();
                    return;
                }
                frame = window.requestAnimationFrame(step);
            };
            frame = window.requestAnimationFrame(step);
        });
    }

    function withTimeout(promise, ms = LAYOUT_PREPARE_TIMEOUT_MS) {
        return new Promise((resolve) => {
            let settled = false;
            let timer = 0;
            const finish = () => {
                if (settled) return;
                settled = true;
                if (timer) window.clearTimeout(timer);
                layoutWaits.delete(wait);
                resolve();
            };
            const wait = { finish };
            layoutWaits.add(wait);
            timer = window.setTimeout(finish, ms);
            Promise.resolve(promise)
                .catch((error) => {
                    console.warn('category layout preparation:', error);
                })
                .then(finish);
        });
    }

    function settlePendingWaits() {
        Array.from(layoutWaits).forEach((wait) => wait.finish());
        Array.from(frameWaits).forEach((wait) => wait.finish());
    }

    async function requestCategoryLayout(category, panel, phase = 'before-transition') {
        const requestSeq = transitionSeq;
        const pending = [];
        const detail = {
            category,
            panel,
            stageMode: stage.dataset.stageMode || '',
            phase,
            waitUntil(promise) {
                if (!promise || typeof promise.then !== 'function') return;
                pending.push(Promise.resolve(promise));
            },
        };
        document.dispatchEvent(new CustomEvent('bitbi:homepage-category-layout-request', { detail }));
        const requiresSettledFrames = pending.length > 0;
        await withTimeout(Promise.allSettled(pending), LAYOUT_PREPARE_TIMEOUT_MS);
        if (destroyed || requestSeq !== transitionSeq) return;
        if (requiresSettledFrames) await waitForAnimationFrame(2);
    }

    function updateCategoryLinkState() {
        if (!stagedLayoutEnabled) {
            categoryLinks.forEach((links) => {
                links.forEach((link) => {
                    link.classList.remove('is-active-category');
                    link.removeAttribute('aria-current');
                });
            });
            return;
        }

        const highlightedCategory = queuedSwitch?.nextCategory || pendingCategory || activeCategory;
        categoryLinks.forEach((links, key) => {
            const isActive = key === highlightedCategory;
            links.forEach((link) => {
                link.classList.toggle('is-active-category', isActive);
                if (isActive) {
                    link.setAttribute('aria-current', 'location');
                    return;
                }
                link.removeAttribute('aria-current');
            });
        });
    }

    function clearCategoryHash() {
        if (!resolveCategoryFromHash(window.location.hash)) return;
        window.history.replaceState(
            window.history.state,
            '',
            `${window.location.pathname}${window.location.search}`,
        );
    }

    function clearTransitionPanelState() {
        panels.forEach((panel) => {
            panel.classList.remove(
                'is-transition-current',
                'is-transition-next',
                'is-from-left',
                'is-from-right',
                'is-leave-left',
                'is-leave-right',
                'is-enter-active',
                'is-layout-preparing',
            );
        });
    }

    function cancelTransitionWork({ clearQueued = false } = {}) {
        transitionSeq += 1;
        stopStageAlignmentAnimation();
        stopContentAlignmentWatch();
        stopTransitionEndWatch();
        window.clearTimeout(transitionTimer);
        transitionTimer = 0;
        if (activationFrame) {
            window.cancelAnimationFrame(activationFrame);
            activationFrame = 0;
        }
        if (postTransitionFrame) {
            window.cancelAnimationFrame(postTransitionFrame);
            postTransitionFrame = 0;
        }
        settlePendingWaits();
        isTransitioning = false;
        pendingCategory = null;
        activeTransition = null;
        if (clearQueued) queuedSwitch = null;
        stage.classList.remove('is-transitioning');
        clearTransitionPanelState();
        viewport.style.height = '';
        viewport.style.minHeight = '';
    }

    function setStackedStageState() {
        const latestSwitch = queuedSwitch || activeTransition;
        if (latestSwitch?.nextCategory) activeCategory = latestSwitch.nextCategory;
        const shouldClearHash = !!latestSwitch?.clearHash;
        const shouldAlignStage = !!latestSwitch?.alignStage;
        cancelTransitionWork({ clearQueued: true });
        stagedLayoutEnabled = false;
        document.body.classList.remove('home-categories-desktop-stage');
        stage.classList.remove('is-ready', 'is-transitioning');
        stage.dataset.stageMode = 'stacked';
        viewport.style.height = '';
        viewport.style.minHeight = '';

        panels.forEach((panel) => {
            clearPanelState(panel);
            panel.setAttribute('aria-hidden', 'false');
            setPanelInert(panel, false);
        });

        stage.dataset.activeCategory = activeCategory;
        updateCategoryLinkState();
        if (shouldClearHash) clearCategoryHash();
        if (shouldAlignStage) alignStageToHeaderEdge();
    }

    function setStagedLayoutState() {
        cancelTransitionWork({ clearQueued: true });
        stagedLayoutEnabled = true;
        document.body.classList.add('home-categories-desktop-stage');
        stage.classList.add('is-ready');
        stage.classList.remove('is-transitioning');
        stage.dataset.stageMode = 'desktop';
        const hashCategory = resolveCategoryFromHash(window.location.hash);
        activeCategory = hashCategory || activeCategory || 'video';
        viewport.style.height = '';
        viewport.style.minHeight = '';
        applyCategoryState();
        updateCategoryLinkState();
        if (hashCategory || activeCategory !== 'video') {
            startContentAlignmentWatch();
        }
    }

    function syncStageMode() {
        if (destroyed) return;
        const shouldUseStagedLayout = !!stagedLayoutQuery?.matches;
        if (shouldUseStagedLayout) {
            setStagedLayoutState();
            return;
        }
        setStackedStageState();
    }

    function finishTransition(nextCategory, expectedSeq) {
        if (expectedSeq !== transitionSeq) return;
        stopTransitionEndWatch();
        window.clearTimeout(transitionTimer);
        transitionTimer = 0;
        activeCategory = nextCategory;
        pendingCategory = null;
        activeTransition = null;
        applyCategoryState();
        isTransitioning = false;
        stage.classList.remove('is-transitioning');
        updateCategoryLinkState();
        if (postTransitionFrame) window.cancelAnimationFrame(postTransitionFrame);
        postTransitionFrame = window.requestAnimationFrame(() => {
            postTransitionFrame = 0;
            if (destroyed || expectedSeq !== transitionSeq) return;
            viewport.style.height = '';
            viewport.style.minHeight = '';
            runQueuedSwitchIfNeeded();
        });
    }

    function scheduleTransitionFinish(nextCategory, panelsToWatch, expectedSeq) {
        stopTransitionEndWatch();
        let finished = false;
        const complete = () => {
            if (finished || expectedSeq !== transitionSeq) return;
            finished = true;
            finishTransition(nextCategory, expectedSeq);
        };
        const handleTransitionEnd = (event) => {
            if (event.target !== panelsToWatch.current && event.target !== panelsToWatch.next) return;
            if (event.propertyName && event.propertyName !== 'transform') return;
            complete();
        };
        [panelsToWatch.current, panelsToWatch.next].forEach((panel) => {
            panel?.addEventListener('transitionend', handleTransitionEnd);
        });
        transitionTimer = window.setTimeout(complete, TRANSITION_MS + 80);
        transitionEndCleanup = () => {
            [panelsToWatch.current, panelsToWatch.next].forEach((panel) => {
                panel?.removeEventListener('transitionend', handleTransitionEnd);
            });
            window.clearTimeout(transitionTimer);
            transitionTimer = 0;
        };
    }

    function queueLatestSwitch(nextCategory, options) {
        queuedSwitch = {
            nextCategory,
            alignStage: !!options.alignStage,
            clearHash: !!options.clearHash,
        };
        updateCategoryLinkState();
    }

    function runQueuedSwitchIfNeeded() {
        const nextSwitch = queuedSwitch;
        queuedSwitch = null;
        if (!nextSwitch || destroyed || !stagedLayoutEnabled) return false;
        setActiveCategory(nextSwitch.nextCategory, nextSwitch);
        return true;
    }

    function setActiveCategory(nextCategory, { alignStage = false, clearHash = false } = {}) {
        if (destroyed || !CATEGORY_META[nextCategory]) {
            return;
        }

        syncMotionEngine();

        if (!stagedLayoutEnabled) {
            activeCategory = nextCategory;
            stage.dataset.activeCategory = nextCategory;
            if (clearHash) clearCategoryHash();
            return;
        }

        if (isTransitioning) {
            queueLatestSwitch(nextCategory, { alignStage, clearHash });
            return;
        }

        if (nextCategory === activeCategory) {
            if (clearHash) clearCategoryHash();
            pendingCategory = null;
            updateCategoryLinkState();
            if (alignStage) {
                if (reducedMotionQuery?.matches || !stagedMotionSupported || !stage.classList.contains('is-ready')) {
                    alignStageToHeaderEdge();
                } else {
                    alignStageForSameCategory();
                }
            }
            return;
        }

        const prefersReducedMotion = !!reducedMotionQuery?.matches;
        const currentPanel = getPanel(activeCategory);
        const nextPanel = getPanel(nextCategory);

        if (!currentPanel || !nextPanel || prefersReducedMotion || !stagedMotionSupported || !stage.classList.contains('is-ready')) {
            dispatchCategoryDeactivating(nextCategory);
            activeCategory = nextCategory;
            pendingCategory = null;
            applyCategoryState();
            updateCategoryLinkState();
            if (clearHash) clearCategoryHash();
            if (alignStage) {
                alignStageToHeaderEdge();
            }
            return;
        }

        const currentIndex = CATEGORY_ORDER.indexOf(activeCategory);
        const nextIndex = CATEGORY_ORDER.indexOf(nextCategory);
        const nextFromLeft = nextIndex < currentIndex;

        dispatchCategoryDeactivating(nextCategory);
        const thisTransitionSeq = ++transitionSeq;
        isTransitioning = true;
        pendingCategory = nextCategory;
        activeTransition = {
            nextCategory,
            alignStage: !!alignStage,
            clearHash: !!clearHash,
            seq: thisTransitionSeq,
        };
        stage.classList.add('is-transitioning');
        updateCategoryLinkState();

        panels.forEach((panel) => {
            clearPanelState(panel);
            panel.setAttribute('aria-hidden', 'true');
            setPanelInert(panel, true);
        });

        currentPanel.classList.add('is-transition-current');

        nextPanel.classList.add(
            'is-transition-next',
            'is-layout-preparing',
            nextFromLeft ? 'is-from-left' : 'is-from-right',
        );

        const currentHeight = currentPanel.offsetHeight;

        viewport.style.height = `${currentHeight}px`;

        if (clearHash) clearCategoryHash();

        requestCategoryLayout(nextCategory, nextPanel).then(() => {
            if (!isTransitioning || pendingCategory !== nextCategory || thisTransitionSeq !== transitionSeq) {
                return;
            }
            nextPanel.classList.remove('is-layout-preparing');
            const nextHeight = nextPanel.offsetHeight;
            currentPanel.classList.add(nextFromLeft ? 'is-leave-right' : 'is-leave-left');
            nextPanel.classList.add('is-enter-active');
            viewport.style.height = `${nextHeight}px`;
            if (alignStage) {
                animateStageAlignment();
            }
            scheduleTransitionFinish(nextCategory, {
                current: currentPanel,
                next: nextPanel,
            }, thisTransitionSeq);
        });
    }

    function handleCategoryClick(event) {
        const anchor = event.target.closest('a[data-category-link]');
        if (!anchor) return;
        if (!stagedLayoutEnabled) return;

        const nextCategory = anchor.dataset.categoryLink;
        if (!nextCategory) return;

        event.preventDefault();
        setActiveCategory(nextCategory, { alignStage: true, clearHash: true });
    }

    function handleCategoryHashChange() {
        if (!stagedLayoutEnabled) return;
        const nextCategory = resolveCategoryFromHash(window.location.hash);
        if (!nextCategory) return;
        setActiveCategory(nextCategory, { alignStage: true });
    }

    const alignActiveCategoryAfterContentReady = () => {
        if (destroyed || !stagedLayoutEnabled) return;
        startContentAlignmentWatch();
    };

    function handleCategoryContentReady(event) {
        if (event?.detail?.category !== activeCategory) return;
        alignActiveCategoryAfterContentReady();
    }

    function handleReducedMotionChange() {
        syncMotionEngine();
        if (!reducedMotionQuery?.matches || !isTransitioning) return;
        const latestSwitch = queuedSwitch || activeTransition;
        if (!latestSwitch?.nextCategory) return;
        queuedSwitch = null;
        cancelTransitionWork({ clearQueued: true });
        activeCategory = latestSwitch.nextCategory;
        applyCategoryState();
        updateCategoryLinkState();
        if (latestSwitch.clearHash) clearCategoryHash();
        if (latestSwitch.alignStage) alignStageToHeaderEdge();
    }

    function handlePageHide(event) {
        const latestSwitch = queuedSwitch || activeTransition;
        if (latestSwitch?.nextCategory) activeCategory = latestSwitch.nextCategory;
        cancelTransitionWork({ clearQueued: true });
        if (event.persisted) {
            if (stagedLayoutEnabled) {
                applyCategoryState();
                updateCategoryLinkState();
            }
            return;
        }
        destroyed = true;
        document.removeEventListener('click', handleCategoryClick, true);
        window.removeEventListener('hashchange', handleCategoryHashChange);
        document.removeEventListener('bitbi:homepage-category-content-ready', handleCategoryContentReady);
        unbindMediaQueryChange(stagedLayoutQuery, syncStageMode);
        unbindMediaQueryChange(reducedMotionQuery, handleReducedMotionChange);
    }

    document.addEventListener('click', handleCategoryClick, true);
    window.addEventListener('hashchange', handleCategoryHashChange);
    document.addEventListener('bitbi:homepage-category-content-ready', handleCategoryContentReady);

    bindMediaQueryChange(stagedLayoutQuery, syncStageMode);
    bindMediaQueryChange(reducedMotionQuery, handleReducedMotionChange);
    window.addEventListener('pagehide', handlePageHide);
    syncStageMode();

    if (activeCategory === 'sound' && document.querySelector('#soundLabTracks .snd-card--memtrack')) {
        alignActiveCategoryAfterContentReady();
    }

    if (shouldHonorInitialCategoryHash()) {
        const initialCategoryHash = resolveCategoryFromHash(window.location.hash)
            ? window.location.hash
            : getPendingCategoryHash();
        const initialCategory = resolveCategoryFromHash(initialCategoryHash);
        const shouldPrimeDeferredAlignment = initialCategoryHash === getPendingCategoryHash();
        let initialAlignmentFrame = 0;
        let initialAlignmentTimer = 0;
        let initialAlignmentObserver = null;
        let initialQueueFrame = 0;
        let initialQueueTimer = 0;
        let finalizePendingTimer = 0;

        const isInitialCategoryCurrent = () => (
            activeCategory === initialCategory
            && (!pendingCategory || pendingCategory === initialCategory)
            && (!queuedSwitch || queuedSwitch.nextCategory === initialCategory)
        );

        const alignInitialCategory = () => {
            if (destroyed || !initialCategory) return false;
            if (!isInitialCategoryCurrent()) {
                stopInitialAlignmentWork();
                return false;
            }
            if (stagedLayoutEnabled) alignStageToHeaderEdge();
            return true;
        };

        const stopInitialAlignmentWatch = () => {
            if (initialAlignmentFrame) {
                window.cancelAnimationFrame(initialAlignmentFrame);
                initialAlignmentFrame = 0;
            }
            if (initialAlignmentTimer) {
                window.clearTimeout(initialAlignmentTimer);
                initialAlignmentTimer = 0;
            }
            if (initialAlignmentObserver) {
                initialAlignmentObserver.disconnect();
                initialAlignmentObserver = null;
            }
        };

        const stopInitialAlignmentWork = () => {
            stopInitialAlignmentWatch();
            if (initialQueueFrame) {
                window.cancelAnimationFrame(initialQueueFrame);
                initialQueueFrame = 0;
            }
            if (initialQueueTimer) {
                window.clearTimeout(initialQueueTimer);
                initialQueueTimer = 0;
            }
            if (finalizePendingTimer) {
                window.clearTimeout(finalizePendingTimer);
                finalizePendingTimer = 0;
            }
        };

        const startInitialAlignmentObserver = () => {
            if (destroyed || typeof window.ResizeObserver !== 'function' || initialAlignmentObserver) return;
            const observedElements = [
                document.body,
                navbar,
                document.querySelector('.hero--homepage'),
                viewport,
            ].filter(Boolean);
            if (!observedElements.length) return;
            initialAlignmentObserver = new window.ResizeObserver(() => {
                if (destroyed || !stagedLayoutEnabled) return;
                alignInitialCategory();
            });
            observedElements.forEach((element) => {
                initialAlignmentObserver.observe(element);
            });
        };

        const startInitialAlignmentWatch = () => {
            if (destroyed || !initialCategory) return;
            stopInitialAlignmentWatch();
            if (!isInitialCategoryCurrent()) {
                stopInitialAlignmentWork();
                return;
            }
            startInitialAlignmentObserver();

            let stableFrames = 0;
            const minWatchUntil = performance.now() + 1800;
            const step = () => {
                if (destroyed) {
                    stopInitialAlignmentWatch();
                    return;
                }
                if (!stagedLayoutEnabled) {
                    stableFrames = 0;
                    initialAlignmentFrame = window.requestAnimationFrame(step);
                    return;
                }

                if (!alignInitialCategory()) return;
                const delta = Math.abs(getStageAlignmentDelta());
                stableFrames = delta <= 1 ? stableFrames + 1 : 0;

                if (stableFrames >= 6 && performance.now() >= minWatchUntil) {
                    stopInitialAlignmentWatch();
                    return;
                }

                initialAlignmentFrame = window.requestAnimationFrame(step);
            };

            initialAlignmentFrame = window.requestAnimationFrame(step);
            initialAlignmentTimer = window.setTimeout(() => {
                stopInitialAlignmentWatch();
            }, 4200);
        };

        const queueInitialAlignment = () => {
            if (destroyed) return;
            if (!alignInitialCategory()) return;
            initialQueueFrame = window.requestAnimationFrame(() => {
                initialQueueFrame = window.requestAnimationFrame(() => {
                    initialQueueFrame = 0;
                    if (destroyed) return;
                    if (!alignInitialCategory()) return;
                    startInitialAlignmentWatch();
                });
            });
            initialQueueTimer = window.setTimeout(() => {
                initialQueueTimer = 0;
                startInitialAlignmentWatch();
            }, 120);
        };
        const handleInitialAuthUiReady = () => {
            if (destroyed || !initialCategory || !stagedLayoutEnabled || !isInitialCategoryCurrent()) return;
            startInitialAlignmentWatch();
        };
        const finalizePendingHash = () => {
            if (!shouldPrimeDeferredAlignment) return;
            window.sessionStorage?.removeItem(HOME_CATEGORY_NAV_STATE_KEY);
        };
        const schedulePendingHashFinalization = () => {
            if (!shouldPrimeDeferredAlignment) return;
            window.clearTimeout(finalizePendingTimer);
            finalizePendingTimer = window.setTimeout(() => {
                finalizePendingTimer = 0;
                if (!destroyed) finalizePendingHash();
            }, 360);
        };
        const handleInitialLoad = () => {
            queueInitialAlignment();
            if (shouldPrimeDeferredAlignment) {
                schedulePendingHashFinalization();
                return;
            }
            finalizePendingHash();
        };

        document.addEventListener('bitbi:homepage-auth-ui-ready', handleInitialAuthUiReady, { once: true });
        document.fonts?.ready?.then(() => {
            if (!destroyed) startInitialAlignmentWatch();
        }).catch(() => {});
        window.addEventListener('pagehide', stopInitialAlignmentWork, { once: true });

        if (document.readyState === 'complete') {
            queueInitialAlignment();
            if (shouldPrimeDeferredAlignment) {
                schedulePendingHashFinalization();
            }
        } else {
            window.addEventListener('load', handleInitialLoad, { once: true });
        }
    }
}
