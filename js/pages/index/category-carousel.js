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

function resolveCategoryFromHash(hash) {
    return CATEGORY_ORDER.find((key) => CATEGORY_META[key].hash === hash) || null;
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

    if (!stage || !viewport || !prevButton || !nextButton) return;

    const panels = new Map(
        Array.from(stage.querySelectorAll('[data-category-panel]'))
            .map((panel) => [panel.dataset.categoryPanel, panel]),
    );

    if (panels.size !== CATEGORY_ORDER.length) return;

    let activeCategory = resolveCategoryFromHash(window.location.hash) || 'video';
    let isTransitioning = false;
    let transitionTimer = 0;

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

    function syncHashForCategory(category) {
        const nextHash = CATEGORY_META[category]?.hash;
        if (nextHash && window.location.hash !== nextHash) {
            window.history.replaceState(window.history.state, '', nextHash);
        }
    }

    function finishTransition(nextCategory) {
        window.clearTimeout(transitionTimer);
        transitionTimer = 0;
        isTransitioning = false;
        stage.classList.remove('is-transitioning');
        activeCategory = nextCategory;
        applyCategoryState();
        requestAnimationFrame(() => {
            viewport.style.height = '';
        });
    }

    function setActiveCategory(nextCategory, { syncHash = false } = {}) {
        if (!CATEGORY_META[nextCategory] || nextCategory === activeCategory) {
            if (syncHash) syncHashForCategory(nextCategory || activeCategory);
            return;
        }

        if (isTransitioning) return;

        const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const currentPanel = getPanel(activeCategory);
        const nextPanel = getPanel(nextCategory);

        if (!currentPanel || !nextPanel || prefersReducedMotion || !stage.classList.contains('is-ready')) {
            activeCategory = nextCategory;
            applyCategoryState();
            if (syncHash) syncHashForCategory(nextCategory);
            return;
        }

        const currentIndex = CATEGORY_ORDER.indexOf(activeCategory);
        const nextIndex = CATEGORY_ORDER.indexOf(nextCategory);
        const nextFromLeft = nextIndex < currentIndex;

        isTransitioning = true;
        stage.classList.add('is-transitioning');
        updateArrowState();

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

        if (syncHash) syncHashForCategory(nextCategory);

        requestAnimationFrame(() => {
            currentPanel.classList.add(nextFromLeft ? 'is-leave-right' : 'is-leave-left');
            nextPanel.classList.add('is-enter-active');
            viewport.style.height = `${nextHeight}px`;
        });

        transitionTimer = window.setTimeout(() => {
            finishTransition(nextCategory);
        }, TRANSITION_MS + 50);
    }

    function move(delta) {
        const currentIndex = CATEGORY_ORDER.indexOf(activeCategory);
        const nextCategory = CATEGORY_ORDER[currentIndex + delta];
        if (!nextCategory) return;
        setActiveCategory(nextCategory, { syncHash: true });
    }

    prevButton.addEventListener('click', () => move(-1));
    nextButton.addEventListener('click', () => move(1));

    document.addEventListener('click', (event) => {
        const anchor = event.target.closest('a[href^="#"]');
        if (!anchor) return;

        const href = anchor.getAttribute('href');
        const nextCategory = resolveCategoryFromHash(href);
        if (!nextCategory) return;

        setActiveCategory(nextCategory, { syncHash: true });
    }, true);

    window.addEventListener('hashchange', () => {
        const nextCategory = resolveCategoryFromHash(window.location.hash);
        if (!nextCategory) return;
        setActiveCategory(nextCategory);
    });

    stage.classList.add('is-ready');
    applyCategoryState();
}
