/* ============================================================
   BITBI — Homepage category carousel
   Keeps Gallery / Video / Sound as isolated section modules
   while presenting them as a single staged carousel surface.
   ============================================================ */

const CATEGORY_ORDER = ['gallery', 'video', 'sound'];

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
const DESKTOP_STAGE_MEDIA = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';

function resolveCategoryFromHash(hash) {
    return CATEGORY_ORDER.find((key) => CATEGORY_META[key].hash === hash) || null;
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

export function initCategoryCarousel() {
    const stage = document.getElementById('homeCategories');
    const viewport = stage?.querySelector('.home-categories__viewport');
    const prevButton = stage?.querySelector('[data-category-nav="prev"]');
    const nextButton = stage?.querySelector('[data-category-nav="next"]');
    const navbar = document.getElementById('navbar');
    const desktopStageQuery = window.matchMedia?.(DESKTOP_STAGE_MEDIA);
    const categoryLinks = new Map(
        CATEGORY_ORDER.map((key) => [key, Array.from(document.querySelectorAll(`[data-category-link="${key}"]`))]),
    );

    if (!stage || !viewport || !prevButton || !nextButton) return;

    const panels = new Map(
        Array.from(stage.querySelectorAll('[data-category-panel]'))
            .map((panel) => [panel.dataset.categoryPanel, panel]),
    );

    if (panels.size !== CATEGORY_ORDER.length) return;

    let activeCategory = resolveCategoryFromHash(window.location.hash) || 'video';
    let isTransitioning = false;
    let pendingCategory = null;
    let transitionTimer = 0;
    let scrollFrame = 0;
    let desktopStageEnabled = false;

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
        );
    }

    function syncVisibleReveals(panel) {
        panel?.querySelectorAll('.reveal').forEach((el) => {
            el.classList.add('visible');
        });
    }

    function updateArrowState() {
        if (!desktopStageEnabled) {
            prevButton.hidden = true;
            prevButton.disabled = true;
            prevButton.removeAttribute('title');
            nextButton.hidden = true;
            nextButton.disabled = true;
            nextButton.removeAttribute('title');
            return;
        }

        const prevTarget = activeCategory === 'video'
            ? 'gallery'
            : activeCategory === 'sound'
                ? 'video'
                : null;
        const nextTarget = activeCategory === 'video'
            ? 'sound'
            : activeCategory === 'gallery'
                ? 'video'
                : null;

        if (prevTarget) {
            prevButton.hidden = false;
            prevButton.disabled = isTransitioning;
            prevButton.setAttribute('aria-label', `Show ${CATEGORY_META[prevTarget].label}`);
            prevButton.title = `Show ${CATEGORY_META[prevTarget].label}`;
        } else {
            prevButton.hidden = true;
            prevButton.disabled = true;
            prevButton.removeAttribute('title');
        }

        if (nextTarget) {
            nextButton.hidden = false;
            nextButton.disabled = isTransitioning;
            nextButton.setAttribute('aria-label', `Show ${CATEGORY_META[nextTarget].label}`);
            nextButton.title = `Show ${CATEGORY_META[nextTarget].label}`;
        } else {
            nextButton.hidden = true;
            nextButton.disabled = true;
            nextButton.removeAttribute('title');
        }
    }

    function getStageAlignmentDelta() {
        const navBottom = navbar?.getBoundingClientRect().bottom || 0;
        const stageTop = viewport.getBoundingClientRect().top;
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

    function alignStageToHeaderEdge() {
        stopStageAlignmentAnimation();
        const alignmentDelta = getStageAlignmentDelta();
        if (Math.abs(alignmentDelta) <= 1) return;
        window.scrollBy({ top: alignmentDelta, behavior: 'auto' });
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
        updateArrowState();
    }

    function updateCategoryLinkState() {
        if (!desktopStageEnabled) {
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
        window.clearTimeout(transitionTimer);
        transitionTimer = 0;
        isTransitioning = false;
        pendingCategory = null;
        desktopStageEnabled = false;
        stage.classList.remove('is-ready', 'is-transitioning');
        stage.dataset.stageMode = 'stacked';
        viewport.style.height = '';

        panels.forEach((panel) => {
            clearPanelState(panel);
            panel.setAttribute('aria-hidden', 'false');
            setPanelInert(panel, false);
        });

        stage.dataset.activeCategory = activeCategory;
        updateArrowState();
        updateCategoryLinkState();
    }

    function setDesktopStageState() {
        desktopStageEnabled = true;
        stage.classList.add('is-ready');
        stage.classList.remove('is-transitioning');
        stage.dataset.stageMode = 'desktop';
        activeCategory = resolveCategoryFromHash(window.location.hash) || activeCategory || 'video';
        viewport.style.height = '';
        applyCategoryState();
        updateCategoryLinkState();
    }

    function syncStageMode() {
        const shouldUseDesktopStage = !!desktopStageQuery?.matches;
        if (shouldUseDesktopStage) {
            setDesktopStageState();
            return;
        }
        setStackedStageState();
    }

    function finishTransition(nextCategory) {
        window.clearTimeout(transitionTimer);
        transitionTimer = 0;
        activeCategory = nextCategory;
        pendingCategory = null;
        applyCategoryState();
        isTransitioning = false;
        stage.classList.remove('is-transitioning');
        updateArrowState();
        updateCategoryLinkState();
        requestAnimationFrame(() => {
            viewport.style.height = '';
        });
    }

    function setActiveCategory(nextCategory, { alignStage = false, clearHash = false } = {}) {
        if (!CATEGORY_META[nextCategory]) {
            return;
        }

        if (!desktopStageEnabled) {
            activeCategory = nextCategory;
            stage.dataset.activeCategory = nextCategory;
            if (clearHash) clearCategoryHash();
            return;
        }

        if (isTransitioning) return;

        if (nextCategory === activeCategory) {
            if (clearHash) clearCategoryHash();
            pendingCategory = null;
            updateCategoryLinkState();
            if (alignStage) {
                const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                if (prefersReducedMotion || !stage.classList.contains('is-ready')) {
                    alignStageToHeaderEdge();
                } else {
                    animateStageAlignment();
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
            if (alignStage) alignStageToHeaderEdge();
            return;
        }

        const currentIndex = CATEGORY_ORDER.indexOf(activeCategory);
        const nextIndex = CATEGORY_ORDER.indexOf(nextCategory);
        const nextFromLeft = nextIndex < currentIndex;

        isTransitioning = true;
        pendingCategory = nextCategory;
        stage.classList.add('is-transitioning');
        updateArrowState();
        updateCategoryLinkState();

        panels.forEach((panel) => {
            clearPanelState(panel);
            panel.setAttribute('aria-hidden', 'true');
            setPanelInert(panel, true);
        });

        currentPanel.classList.add('is-transition-current');
        currentPanel.setAttribute('aria-hidden', 'false');

        nextPanel.classList.add('is-transition-next', nextFromLeft ? 'is-from-left' : 'is-from-right');
        nextPanel.setAttribute('aria-hidden', 'false');

        const currentHeight = currentPanel.offsetHeight;
        const nextHeight = nextPanel.offsetHeight;

        viewport.style.height = `${currentHeight}px`;

        if (clearHash) clearCategoryHash();

        requestAnimationFrame(() => {
            currentPanel.classList.add(nextFromLeft ? 'is-leave-right' : 'is-leave-left');
            nextPanel.classList.add('is-enter-active');
            viewport.style.height = `${nextHeight}px`;
            if (alignStage) {
                animateStageAlignment();
            }
        });

        transitionTimer = window.setTimeout(() => {
            finishTransition(nextCategory);
        }, TRANSITION_MS + 50);
    }

    function move(delta) {
        const currentIndex = CATEGORY_ORDER.indexOf(activeCategory);
        const nextCategory = CATEGORY_ORDER[currentIndex + delta];
        if (!nextCategory) return;
        setActiveCategory(nextCategory, { alignStage: true, clearHash: true });
    }

    prevButton.addEventListener('click', () => {
        if (!desktopStageEnabled) return;
        move(-1);
    });
    nextButton.addEventListener('click', () => {
        if (!desktopStageEnabled) return;
        move(1);
    });

    document.addEventListener('click', (event) => {
        const anchor = event.target.closest('a[data-category-link]');
        if (!anchor) return;
        if (!desktopStageEnabled) return;

        const nextCategory = anchor.dataset.categoryLink;
        if (!nextCategory) return;

        event.preventDefault();
        setActiveCategory(nextCategory, { alignStage: true, clearHash: true });
    }, true);

    window.addEventListener('hashchange', () => {
        if (!desktopStageEnabled) return;
        const nextCategory = resolveCategoryFromHash(window.location.hash);
        if (!nextCategory) return;
        setActiveCategory(nextCategory, { alignStage: true });
    });

    bindMediaQueryChange(desktopStageQuery, syncStageMode);
    syncStageMode();
}
