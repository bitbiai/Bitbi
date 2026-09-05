/* Homepage cards keep their layout while hidden media waits for a useful view. */
const PREFETCH_MARGIN_PX = 400;

export function createCardMediaLoader(grid, category) {
    const panel = grid.closest('[data-category-panel]');
    const stage = grid.closest('#homeCategories');
    const deckQuery = window.matchMedia('(max-width: 639px)');
    const sources = new WeakMap();
    const pending = new Set();
    const nearby = new Set();
    let cards = [];
    let active = 0;
    let gridNearby = false;
    let frame = 0;
    let destroyed = false;
    let categorySettling = false;
    let stableScrollFrames = 0;
    let previousScrollY = 0;
    let settleDeadline = 0;

    function canLoadCategory() {
        // Switching to stacked tablet layout cancels category motion without
        // another activation event, even when the mobile-deck query stays off.
        if (stage?.dataset.stageMode !== 'desktop') categorySettling = false;
        // Automatic stage alignment can sweep past the entire incoming wall.
        // Wait for activation before loading the rows passed during that move.
        return !categorySettling && panel?.getAttribute('aria-hidden') !== 'true';
    }

    function loadCard(card) {
        if (!pending.delete(card)) return;
        card.querySelectorAll('img').forEach((img) => {
            const url = sources.get(img);
            if (!url) return;
            sources.delete(img);
            // Visibility is gated here, so nearby/deck prefetch need not wait
            // for the browser's separate native lazy-loading threshold.
            img.loading = 'eager';
            img.src = url;
        });
        observer?.unobserve(card);
        nearby.delete(card);
    }

    function isNearby(element) {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
            && rect.bottom >= -PREFETCH_MARGIN_PX
            && rect.top <= window.innerHeight + PREFETCH_MARGIN_PX;
    }

    function loadNearby() {
        if (destroyed || !canLoadCategory()) return;
        if (deckQuery.matches) {
            if (observer ? !gridNearby : !isNearby(grid)) return;
            // Keep the previous card, three visible layers and the next swipe
            // ready. Opacity-hidden distant cards never receive a URL.
            cards.slice(Math.max(0, active - 1), active + 4).forEach(loadCard);
            return;
        }
        if (observer) nearby.forEach(loadCard);
        else pending.forEach((card) => { if (isNearby(card)) loadCard(card); });
    }

    const observer = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.target === grid) gridNearby = entry.isIntersecting;
                else if (entry.isIntersecting) nearby.add(entry.target);
                else nearby.delete(entry.target);
            });
            loadNearby();
        }, { rootMargin: `${PREFETCH_MARGIN_PX}px` })
        : null;

    function observePending() {
        observer?.disconnect();
        nearby.clear();
        gridNearby = false;
        if (deckQuery.matches) observer?.observe(grid);
        else pending.forEach((card) => observer?.observe(card));
        if (!observer) loadNearby();
    }

    function scheduleRefresh() {
        if (destroyed || frame) return;
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            if (deckQuery.matches) categorySettling = false;
            if (categorySettling && panel?.getAttribute('aria-hidden') !== 'true') {
                const scrollY = window.scrollY;
                stableScrollFrames = Math.abs(scrollY - previousScrollY) < 1 ? stableScrollFrames + 1 : 0;
                previousScrollY = scrollY;
                if (stableScrollFrames < 3 && performance.now() < settleDeadline) {
                    scheduleRefresh();
                    return;
                }
                categorySettling = false;
            }
            observePending();
        });
    }

    function handleCategory(event) {
        if (event.detail?.category !== category) return;
        // Native smooth scrolling may outlast the panel's CSS transition.
        categorySettling = !deckQuery.matches;
        stableScrollFrames = 0;
        previousScrollY = window.scrollY;
        settleDeadline = performance.now() + 1000;
        if (event.type === 'bitbi:homepage-category-layout-request' && !deckQuery.matches) {
            const columns = Number(grid.dataset.mediaWallColumnCount || grid.dataset.soundWallCapacity) || 4;
            // Warm the first two rows while the requested panel is prepared.
            // These are ready when category navigation aligns it to the top.
            cards.slice(0, columns * 2).forEach(loadCard);
        }
        // A panel can keep identical geometry while aria-hidden changes.
        // Reobserve pending cards for fresh entries after layout preparation.
        scheduleRefresh();
    }

    function handleFocus(event) {
        const card = cards.find((candidate) => candidate.contains(event.target));
        if (card) loadCard(card);
    }

    deckQuery.addEventListener('change', scheduleRefresh);
    document.addEventListener('bitbi:homepage-category-layout-request', handleCategory);
    document.addEventListener('bitbi:homepage-category-activated', handleCategory);
    grid.addEventListener('focusin', handleFocus);
    if (!observer) {
        window.addEventListener('scroll', scheduleRefresh, { passive: true });
        window.addEventListener('resize', scheduleRefresh, { passive: true });
    }
    window.addEventListener('pagehide', (event) => {
        if (event.persisted) return;
        destroyed = true;
        window.cancelAnimationFrame(frame);
        observer?.disconnect();
        pending.clear();
        nearby.clear();
        cards = [];
        deckQuery.removeEventListener('change', scheduleRefresh);
        document.removeEventListener('bitbi:homepage-category-layout-request', handleCategory);
        document.removeEventListener('bitbi:homepage-category-activated', handleCategory);
        grid.removeEventListener('focusin', handleFocus);
        window.removeEventListener('scroll', scheduleRefresh);
        window.removeEventListener('resize', scheduleRefresh);
    });

    return {
        defer(img, url) {
            if (url) sources.set(img, url);
        },
        setCards(nextCards) {
            cards = nextCards;
            pending.clear();
            cards.forEach((card) => {
                if (Array.from(card.querySelectorAll('img')).some((img) => sources.has(img))) pending.add(card);
            });
            observePending();
        },
        setActive(index) {
            active = index;
            loadNearby();
        },
    };
}
