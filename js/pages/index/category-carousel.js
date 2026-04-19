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
    let heightFrame = 0;

    function getPanel(category) {
        return panels.get(category) || null;
    }

    function syncVisibleReveals(panel) {
        panel?.querySelectorAll('.reveal').forEach((el) => {
            el.classList.add('visible');
        });
    }

    function syncViewportHeight() {
        const activePanel = getPanel(activeCategory);
        if (!activePanel) return;
        const nextHeight = activePanel.offsetHeight;
        if (nextHeight > 0) {
            viewport.style.height = `${nextHeight}px`;
        }
    }

    function scheduleViewportHeightSync() {
        if (heightFrame) cancelAnimationFrame(heightFrame);
        heightFrame = requestAnimationFrame(() => {
            heightFrame = 0;
            syncViewportHeight();
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
            prevButton.disabled = false;
            prevButton.setAttribute('aria-label', `Show ${CATEGORY_META[prevTarget].label}`);
            prevButton.title = `Show ${CATEGORY_META[prevTarget].label}`;
        } else {
            prevButton.hidden = true;
            prevButton.disabled = true;
            prevButton.removeAttribute('title');
        }

        if (nextTarget) {
            nextButton.hidden = false;
            nextButton.disabled = false;
            nextButton.setAttribute('aria-label', `Show ${CATEGORY_META[nextTarget].label}`);
            nextButton.title = `Show ${CATEGORY_META[nextTarget].label}`;
        } else {
            nextButton.hidden = true;
            nextButton.disabled = true;
            nextButton.removeAttribute('title');
        }
    }

    function applyCategoryState() {
        const activeIndex = CATEGORY_ORDER.indexOf(activeCategory);

        panels.forEach((panel, key) => {
            const panelIndex = CATEGORY_ORDER.indexOf(key);
            const delta = panelIndex - activeIndex;
            const isActive = delta === 0;

            panel.classList.remove('is-before', 'is-active', 'is-after', 'is-far-before', 'is-far-after');
            if (isActive) {
                panel.classList.add('is-active');
            } else if (delta === -1) {
                panel.classList.add('is-before');
            } else if (delta === 1) {
                panel.classList.add('is-after');
            } else if (delta < 0) {
                panel.classList.add('is-far-before');
            } else {
                panel.classList.add('is-far-after');
            }

            panel.setAttribute('aria-hidden', String(!isActive));
            setPanelInert(panel, !isActive);
        });

        stage.dataset.activeCategory = activeCategory;
        syncVisibleReveals(getPanel(activeCategory));
        updateArrowState();
        scheduleViewportHeightSync();
    }

    function setActiveCategory(nextCategory, { syncHash = false } = {}) {
        if (!CATEGORY_META[nextCategory] || nextCategory === activeCategory) {
            if (syncHash) {
                const nextHash = CATEGORY_META[nextCategory || activeCategory]?.hash;
                if (nextHash && window.location.hash !== nextHash) {
                    window.history.replaceState(window.history.state, '', nextHash);
                }
            }
            return;
        }

        activeCategory = nextCategory;
        applyCategoryState();

        if (syncHash) {
            const nextHash = CATEGORY_META[nextCategory].hash;
            if (window.location.hash !== nextHash) {
                window.history.replaceState(window.history.state, '', nextHash);
            }
        }
    }

    function move(delta) {
        const currentIndex = CATEGORY_ORDER.indexOf(activeCategory);
        const nextCategory = CATEGORY_ORDER[currentIndex + delta];
        if (!nextCategory) return;
        setActiveCategory(nextCategory, { syncHash: true });
    }

    const resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            scheduleViewportHeightSync();
        })
        : null;

    panels.forEach((panel) => {
        resizeObserver?.observe(panel);
    });

    window.addEventListener('resize', scheduleViewportHeightSync);

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

    applyCategoryState();
    syncViewportHeight();
    stage.classList.add('is-ready');
}
