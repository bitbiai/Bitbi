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
const WEBKIT_LAYOUT_PREPARE_TIMEOUT_MS = 320;
const WEBKIT_SAFE_REVEAL_MS = 160;
const WEBKIT_FINAL_ALIGNMENT_TOLERANCE_PX = 2;

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

function isWebKitMotionEngine() {
    // Safari/WebKit needs a quieter staged-category transition path; keep this
    // centralized so Chromium's existing scroll/height choreography is unchanged.
    const ua = navigator.userAgent || '';
    const vendor = navigator.vendor || '';
    const isAppleVendor = /Apple/i.test(vendor);
    const isAppleTouchWebKit = /AppleWebKit/i.test(ua) && /\b(iPad|iPhone|iPod)\b/i.test(ua);
    const isChromiumFamily = /\b(?:Chrome|Chromium|CriOS|Edg|OPR|SamsungBrowser)\b/i.test(ua);
    if (isAppleTouchWebKit) return true;
    return isAppleVendor && !isChromiumFamily;
}

export function initCategoryCarousel() {
    const stage = document.getElementById('homeCategories');
    const viewport = stage?.querySelector('.home-categories__viewport');
    const navbar = document.getElementById('navbar');
    const stagedLayoutQuery = window.matchMedia?.(STAGED_LAYOUT_MEDIA);
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
    let webKitSwitchTimer = 0;
    let queuedWebKitSwitch = null;
    const webKitMotionMode = isWebKitMotionEngine();

    if (webKitMotionMode) {
        stage.classList.add('is-webkit-motion');
    }
    stage.dataset.motionEngine = webKitMotionMode ? 'webkit-safe' : 'standard';

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
            'is-webkit-preparing',
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

    function getWebKitStageTargetY() {
        const navBottom = navbar?.getBoundingClientRect().bottom || 0;
        const stageTop = stage.getBoundingClientRect().top;
        const rawTarget = (window.scrollY || window.pageYOffset || 0)
            + stageTop
            - navBottom;
        const maxScrollY = Math.max(
            0,
            document.documentElement.scrollHeight - window.innerHeight,
            document.body.scrollHeight - window.innerHeight,
        );
        return Math.min(Math.max(0, rawTarget), maxScrollY);
    }

    function alignWebKitStageToNavOnce({ force = false } = {}) {
        stopStageAlignmentAnimation();
        const targetY = getWebKitStageTargetY();
        if (!Number.isFinite(targetY)) return;
        const currentY = window.scrollY || window.pageYOffset || 0;
        if (!force && Math.abs(targetY - currentY) <= WEBKIT_FINAL_ALIGNMENT_TOLERANCE_PX) return;
        window.scrollTo({ top: targetY, behavior: 'auto' });
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

    function stopWebKitSwitchTimer() {
        if (!webKitSwitchTimer) return;
        window.clearTimeout(webKitSwitchTimer);
        webKitSwitchTimer = 0;
    }

    function clearWebKitSwitchState() {
        stopWebKitSwitchTimer();
        stage.classList.remove('is-webkit-switching', 'is-webkit-revealing');
        panels.forEach((panel) => {
            panel.classList.remove('is-webkit-preparing');
        });
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
            if (!stagedLayoutEnabled) {
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
        if (webKitMotionMode) {
            alignWebKitStageToNavOnce();
            scheduleWebKitStageVerification(activeCategory);
            return;
        }
        animateStageAlignment();
    }

    function scheduleWebKitStageVerification(category) {
        stopContentAlignmentWatch();
        const step = () => {
            if (!stagedLayoutEnabled || isTransitioning || activeCategory !== category) {
                contentAlignmentFrame = 0;
                return;
            }
            alignWebKitStageToNavOnce();
            contentAlignmentFrame = 0;
        };
        window.requestAnimationFrame(() => {
            contentAlignmentFrame = window.requestAnimationFrame(step);
        });
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
        window.requestAnimationFrame(() => {
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
            const step = () => {
                remaining -= 1;
                if (remaining <= 0) {
                    resolve();
                    return;
                }
                window.requestAnimationFrame(step);
            };
            window.requestAnimationFrame(step);
        });
    }

    function withTimeout(promise, ms = LAYOUT_PREPARE_TIMEOUT_MS) {
        return new Promise((resolve) => {
            let settled = false;
            const timer = window.setTimeout(() => {
                settled = true;
                resolve();
            }, ms);
            Promise.resolve(promise)
                .catch((error) => {
                    console.warn('category layout preparation:', error);
                })
                .then(() => {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timer);
                    resolve();
                });
        });
    }

    async function requestCategoryLayout(category, panel, phase = 'before-transition') {
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
        await withTimeout(Promise.allSettled(pending), webKitMotionMode ? WEBKIT_LAYOUT_PREPARE_TIMEOUT_MS : LAYOUT_PREPARE_TIMEOUT_MS);
        await waitForAnimationFrame(2);
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

        const highlightedCategory = pendingCategory || activeCategory;
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

    function setStackedStageState() {
        stopStageAlignmentAnimation();
        stopContentAlignmentWatch();
        stopTransitionEndWatch();
        clearWebKitSwitchState();
        window.clearTimeout(transitionTimer);
        transitionTimer = 0;
        isTransitioning = false;
        pendingCategory = null;
        queuedWebKitSwitch = null;
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
    }

    function setStagedLayoutState() {
        stopTransitionEndWatch();
        clearWebKitSwitchState();
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
            if (webKitMotionMode) {
                scheduleWebKitStageVerification(activeCategory);
            } else {
                startContentAlignmentWatch();
            }
        }
    }

    function syncStageMode() {
        const shouldUseStagedLayout = !!stagedLayoutQuery?.matches;
        if (shouldUseStagedLayout) {
            setStagedLayoutState();
            return;
        }
        setStackedStageState();
    }

    function finishTransition(nextCategory) {
        stopTransitionEndWatch();
        window.clearTimeout(transitionTimer);
        transitionTimer = 0;
        activeCategory = nextCategory;
        pendingCategory = null;
        applyCategoryState();
        isTransitioning = false;
        stage.classList.remove('is-transitioning');
        updateCategoryLinkState();
        requestAnimationFrame(() => {
            viewport.style.height = '';
            viewport.style.minHeight = '';
        });
    }

    function scheduleTransitionFinish(nextCategory, panelsToWatch, expectedSeq) {
        stopTransitionEndWatch();
        let finished = false;
        const complete = () => {
            if (finished || expectedSeq !== transitionSeq) return;
            finished = true;
            finishTransition(nextCategory);
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

    function queueLatestWebKitSwitch(nextCategory, options) {
        queuedWebKitSwitch = {
            nextCategory,
            alignStage: !!options.alignStage,
            clearHash: !!options.clearHash,
        };
        pendingCategory = nextCategory;
        updateCategoryLinkState();
    }

    function runQueuedWebKitSwitchIfNeeded() {
        const queuedSwitch = queuedWebKitSwitch;
        queuedWebKitSwitch = null;
        if (queuedSwitch && queuedSwitch.nextCategory !== activeCategory) {
            startWebKitSafeSwitch(queuedSwitch.nextCategory, queuedSwitch);
            return true;
        }
        if (queuedSwitch?.alignStage) {
            alignStageForSameCategory();
        }
        return false;
    }

    function finishWebKitSafeSwitch(nextCategory, expectedSeq) {
        if (expectedSeq !== transitionSeq) return;
        stage.classList.remove('is-webkit-switching');
        stage.classList.add('is-webkit-revealing');
        webKitSwitchTimer = window.setTimeout(() => {
            if (expectedSeq !== transitionSeq) return;
            webKitSwitchTimer = 0;
            stage.classList.remove('is-webkit-revealing');
            alignWebKitStageToNavOnce();
            isTransitioning = false;
            pendingCategory = null;
            updateCategoryLinkState();
            runQueuedWebKitSwitchIfNeeded();
        }, WEBKIT_SAFE_REVEAL_MS + 40);
    }

    async function startWebKitSafeSwitch(nextCategory, { alignStage = false, clearHash = false } = {}) {
        const nextPanel = getPanel(nextCategory);
        if (!nextPanel) return;
        if (isTransitioning) {
            queueLatestWebKitSwitch(nextCategory, { alignStage, clearHash });
            return;
        }

        const thisTransitionSeq = ++transitionSeq;
        isTransitioning = true;
        pendingCategory = nextCategory;
        stopStageAlignmentAnimation();
        stopContentAlignmentWatch();
        stopTransitionEndWatch();
        clearWebKitSwitchState();
        window.clearTimeout(transitionTimer);
        transitionTimer = 0;
        viewport.style.height = '';
        viewport.style.minHeight = '';
        stage.classList.remove('is-transitioning');
        stage.classList.add('is-webkit-switching');
        updateCategoryLinkState();

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
                'is-webkit-preparing',
            );
        });

        nextPanel.classList.add('is-webkit-preparing');
        nextPanel.setAttribute('aria-hidden', 'true');
        setPanelInert(nextPanel, true);

        if (clearHash) clearCategoryHash();

        await requestCategoryLayout(nextCategory, nextPanel, 'webkit-safe-switch');
        if (thisTransitionSeq !== transitionSeq || pendingCategory !== nextCategory) {
            nextPanel.classList.remove('is-webkit-preparing');
            nextPanel.setAttribute('aria-hidden', String(nextCategory !== activeCategory));
            setPanelInert(nextPanel, nextCategory !== activeCategory);
            stage.classList.remove('is-webkit-switching', 'is-webkit-revealing');
            isTransitioning = false;
            pendingCategory = null;
            viewport.style.height = '';
            viewport.style.minHeight = '';
            updateCategoryLinkState();
            runQueuedWebKitSwitchIfNeeded();
            return;
        }

        nextPanel.classList.remove('is-webkit-preparing');
        activeCategory = nextCategory;
        pendingCategory = null;
        applyCategoryState();
        updateCategoryLinkState();
        viewport.style.height = '';
        viewport.style.minHeight = '';
        if (alignStage) {
            alignWebKitStageToNavOnce({ force: true });
        }
        await waitForAnimationFrame(2);
        if (thisTransitionSeq !== transitionSeq || activeCategory !== nextCategory) return;
        alignWebKitStageToNavOnce();
        finishWebKitSafeSwitch(nextCategory, thisTransitionSeq);
    }

    function setActiveCategory(nextCategory, { alignStage = false, clearHash = false } = {}) {
        if (!CATEGORY_META[nextCategory]) {
            return;
        }

        if (!stagedLayoutEnabled) {
            activeCategory = nextCategory;
            stage.dataset.activeCategory = nextCategory;
            if (clearHash) clearCategoryHash();
            return;
        }

        if (isTransitioning) {
            if (webKitMotionMode) {
                queueLatestWebKitSwitch(nextCategory, { alignStage, clearHash });
            }
            return;
        }

        if (nextCategory === activeCategory) {
            if (clearHash) clearCategoryHash();
            pendingCategory = null;
            updateCategoryLinkState();
            if (alignStage) {
                const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                if (prefersReducedMotion || !stage.classList.contains('is-ready')) {
                    if (webKitMotionMode) {
                        alignWebKitStageToNavOnce();
                    } else {
                        alignStageToHeaderEdge();
                    }
                } else {
                    alignStageForSameCategory();
                }
            }
            return;
        }

        const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const currentPanel = getPanel(activeCategory);
        const nextPanel = getPanel(nextCategory);

        if (!currentPanel || !nextPanel || prefersReducedMotion || !stage.classList.contains('is-ready')) {
            activeCategory = nextCategory;
            pendingCategory = null;
            applyCategoryState();
            updateCategoryLinkState();
            if (clearHash) clearCategoryHash();
            if (alignStage) {
                if (webKitMotionMode) {
                    alignWebKitStageToNavOnce();
                } else {
                    alignStageToHeaderEdge();
                }
            }
            return;
        }

        if (webKitMotionMode) {
            startWebKitSafeSwitch(nextCategory, { alignStage, clearHash });
            return;
        }

        const currentIndex = CATEGORY_ORDER.indexOf(activeCategory);
        const nextIndex = CATEGORY_ORDER.indexOf(nextCategory);
        const nextFromLeft = nextIndex < currentIndex;

        isTransitioning = true;
        pendingCategory = nextCategory;
        stage.classList.add('is-transitioning');
        updateCategoryLinkState();

        panels.forEach((panel) => {
            clearPanelState(panel);
            panel.setAttribute('aria-hidden', 'true');
            setPanelInert(panel, true);
        });

        currentPanel.classList.add('is-transition-current');
        currentPanel.setAttribute('aria-hidden', 'false');

        nextPanel.classList.add(
            'is-transition-next',
            'is-layout-preparing',
            nextFromLeft ? 'is-from-left' : 'is-from-right',
        );
        nextPanel.setAttribute('aria-hidden', 'false');

        const currentHeight = currentPanel.offsetHeight;

        viewport.style.height = `${currentHeight}px`;

        if (clearHash) clearCategoryHash();

        const thisTransitionSeq = ++transitionSeq;
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

    document.addEventListener('click', (event) => {
        const anchor = event.target.closest('a[data-category-link]');
        if (!anchor) return;
        if (!stagedLayoutEnabled) return;

        const nextCategory = anchor.dataset.categoryLink;
        if (!nextCategory) return;

        event.preventDefault();
        setActiveCategory(nextCategory, { alignStage: true, clearHash: true });
    }, true);

    window.addEventListener('hashchange', () => {
        if (!stagedLayoutEnabled) return;
        const nextCategory = resolveCategoryFromHash(window.location.hash);
        if (!nextCategory) return;
        setActiveCategory(nextCategory, { alignStage: true });
    });

    const alignActiveCategoryAfterContentReady = () => {
        if (!stagedLayoutEnabled) return;
        if (webKitMotionMode) {
            scheduleWebKitStageVerification(activeCategory);
            return;
        }
        startContentAlignmentWatch();
    };

    document.addEventListener('bitbi:homepage-category-content-ready', (event) => {
        if (event?.detail?.category !== activeCategory) return;
        alignActiveCategoryAfterContentReady();
    });

    bindMediaQueryChange(stagedLayoutQuery, syncStageMode);
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

        const alignInitialCategory = () => {
            if (!initialCategory) return;
            if (stagedLayoutEnabled) {
                setActiveCategory(initialCategory, { alignStage: false });
                if (webKitMotionMode) {
                    alignWebKitStageToNavOnce();
                    return;
                }
                alignStageToHeaderEdge();
            }
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

        const startInitialAlignmentObserver = () => {
            if (typeof window.ResizeObserver !== 'function' || initialAlignmentObserver) return;
            const observedElements = [
                document.body,
                navbar,
                document.querySelector('.hero--homepage'),
                viewport,
            ].filter(Boolean);
            if (!observedElements.length) return;
            initialAlignmentObserver = new window.ResizeObserver(() => {
                if (!stagedLayoutEnabled) return;
                alignInitialCategory();
            });
            observedElements.forEach((element) => {
                initialAlignmentObserver.observe(element);
            });
        };

        const startInitialAlignmentWatch = () => {
            if (!initialCategory) return;
            stopInitialAlignmentWatch();
            startInitialAlignmentObserver();

            let stableFrames = 0;
            const minWatchUntil = performance.now() + 1800;
            const step = () => {
                if (!stagedLayoutEnabled) {
                    stableFrames = 0;
                    initialAlignmentFrame = window.requestAnimationFrame(step);
                    return;
                }

                alignInitialCategory();
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
            alignInitialCategory();
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    alignInitialCategory();
                    startInitialAlignmentWatch();
                });
            });
            window.setTimeout(startInitialAlignmentWatch, 120);
        };
        const handleInitialAuthUiReady = () => {
            if (!initialCategory || !stagedLayoutEnabled) return;
            startInitialAlignmentWatch();
        };
        const finalizePendingHash = () => {
            if (!shouldPrimeDeferredAlignment) return;
            window.sessionStorage?.removeItem(HOME_CATEGORY_NAV_STATE_KEY);
        };

        document.addEventListener('bitbi:homepage-auth-ui-ready', handleInitialAuthUiReady, { once: true });
        document.fonts?.ready?.then(() => {
            startInitialAlignmentWatch();
        }).catch(() => {});

        if (document.readyState === 'complete') {
            queueInitialAlignment();
            if (shouldPrimeDeferredAlignment) {
                window.setTimeout(finalizePendingHash, 360);
            }
            return;
        }

        window.addEventListener('load', () => {
            queueInitialAlignment();
            if (shouldPrimeDeferredAlignment) {
                window.setTimeout(finalizePendingHash, 360);
                return;
            }
            finalizePendingHash();
        }, { once: true });
    }
}
