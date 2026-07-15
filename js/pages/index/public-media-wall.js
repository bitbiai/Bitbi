/* ============================================================
   BITBI — Fixed-width public media wall helpers
   ============================================================ */

const MEDIA_WALL_LAYOUT_STATE = new WeakMap();
const MEDIA_WALL_SETTLED_VERIFICATION_DELAY_MS = 680;

export function parseCssLengthToPixels(value, fallback, basisElement = document.documentElement) {
    const text = String(value || '').trim();
    const parsed = Number.parseFloat(text);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    if (text.endsWith('rem')) {
        const rootStyle = window.getComputedStyle?.(document.documentElement);
        const rootSize = Number.parseFloat(rootStyle?.fontSize);
        return parsed * (Number.isFinite(rootSize) && rootSize > 0 ? rootSize : 16);
    }
    if (text.endsWith('em')) {
        const basisStyle = window.getComputedStyle?.(basisElement);
        const basisSize = Number.parseFloat(basisStyle?.fontSize);
        return parsed * (Number.isFinite(basisSize) && basisSize > 0 ? basisSize : 16);
    }
    return parsed;
}

function toPixelString(value) {
    const rounded = Math.floor((Number(value) || 0) * 1000) / 1000;
    return `${rounded}px`;
}

export function getStableMediaWallAvailableWidth(grid) {
    if (!grid || typeof window.getComputedStyle !== 'function') return 0;
    const gridStyle = window.getComputedStyle(grid);
    if (gridStyle.display === 'none' || gridStyle.visibility === 'hidden') return 0;

    const viewportWidth = Math.min(
        window.innerWidth || Number.POSITIVE_INFINITY,
        document.documentElement?.clientWidth || Number.POSITIVE_INFINITY,
    );
    const finiteViewportWidth = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
    const panel = grid.closest?.('.home-categories__panel');
    const exploreWrapper = grid.closest?.('#galleryExplore, #videoExplore, #soundLabExplore') || null;
    const panelInner = panel?.querySelector?.(':scope > .section__inner') || null;
    const sectionInner = grid.closest?.('.section__inner') || null;
    const stableContainers = [
        exploreWrapper,
        grid.parentElement,
        sectionInner,
        panel,
        panelInner,
    ].filter(Boolean);

    const widths = [];
    for (const container of stableContainers) {
        const style = window.getComputedStyle(container);
        if (style.display === 'none' || style.visibility === 'hidden') {
            continue;
        }
        const clientWidth = Number(container.clientWidth) || 0;
        const offsetWidth = Number(container.offsetWidth) || 0;
        const computedWidth = Number.parseFloat(style.width) || 0;
        const hasLayoutBox = container.getClientRects?.().length > 0;
        const paddingWidth = (Number.parseFloat(style.paddingInlineStart) || 0)
            + (Number.parseFloat(style.paddingInlineEnd) || 0);
        const layoutWidth = clientWidth > 0
            ? clientWidth
            : offsetWidth > 0
                ? offsetWidth
                : hasLayoutBox && computedWidth > 0
                    ? computedWidth + (style.boxSizing === 'content-box' ? paddingWidth : 0)
                    : 0;
        if (layoutWidth <= 0) {
            continue;
        }
        if (finiteViewportWidth > 0 && layoutWidth > finiteViewportWidth + 1) {
            continue;
        }
        widths.push(layoutWidth);
    }

    if (widths.length) return Math.min(...widths);
    return 0;
}

function lockNodeToWidth(node, widthPx) {
    if (!node) return;
    node.style.setProperty('box-sizing', 'border-box');
    node.style.setProperty('width', widthPx);
    node.style.setProperty('inline-size', widthPx);
    node.style.setProperty('min-width', widthPx);
    node.style.setProperty('max-width', widthPx);
    node.style.setProperty('min-inline-size', widthPx);
    node.style.setProperty('max-inline-size', widthPx);
    node.style.setProperty('flex-basis', widthPx);
}

function lockCardToColumn(card) {
    if (!card) return;
    card.style.setProperty('box-sizing', 'border-box');
    card.style.setProperty('width', '100%');
    card.style.setProperty('inline-size', '100%');
    card.style.setProperty('max-inline-size', '100%');
    card.style.setProperty('min-inline-size', '0');
}

export function calculateFixedMediaWallMetrics(grid, {
    targetWidthProperty,
    fallbackColumnWidth = 216,
    itemCount = 0,
} = {}) {
    const fallbackWidth = Number(fallbackColumnWidth) > 0 ? Number(fallbackColumnWidth) : 216;
    if (!grid || typeof window.getComputedStyle !== 'function') {
        return {
            gridWidth: 0,
            gapPx: 10,
            baseWidthPx: fallbackWidth,
            targetWidthPx: fallbackWidth,
            resolvedWidthPx: fallbackWidth,
            capacity: 1,
            columnCount: 1,
        };
    }

    const availableWidth = getStableMediaWallAvailableWidth(grid);
    const style = window.getComputedStyle(grid);
    const gap = parseCssLengthToPixels(
        style.columnGap || style.gap || style.getPropertyValue('--bitbi-public-media-gap'),
        10,
        grid,
    );
    const targetColumnWidth = parseCssLengthToPixels(
        style.getPropertyValue(targetWidthProperty),
        fallbackColumnWidth,
        grid,
    );
    const capacity = availableWidth
        ? Math.max(1, Math.floor((availableWidth + gap) / (targetColumnWidth + gap)))
        : 1;
    const columnCount = itemCount > 0 ? Math.min(itemCount, capacity) : capacity;
    const resolvedWidth = availableWidth && columnCount > 0
        ? Math.max(targetColumnWidth, Math.floor(((availableWidth - (gap * (columnCount - 1))) / columnCount) * 1000) / 1000)
        : targetColumnWidth;
    return {
        gridWidth: availableWidth,
        availableWidthPx: availableWidth,
        gapPx: gap,
        baseWidthPx: targetColumnWidth,
        targetWidthPx: targetColumnWidth,
        resolvedWidthPx: resolvedWidth,
        capacity,
        columnCount,
        itemCount: Number(itemCount) || 0,
    };
}

export function syncFixedMediaWallColumnCount(grid, options = {}) {
    return calculateFixedMediaWallMetrics(grid, options).columnCount;
}

export function clearFixedMediaWallLayout(grid, {
    countProperty,
} = {}) {
    if (!grid) return;
    const state = MEDIA_WALL_LAYOUT_STATE.get(grid);
    if (state) {
        if (state.validationTimer) window.clearTimeout(state.validationTimer);
        if (state.validationFrame) window.cancelAnimationFrame(state.validationFrame);
        if (state.validationNestedFrame) window.cancelAnimationFrame(state.validationNestedFrame);
        MEDIA_WALL_LAYOUT_STATE.delete(grid);
    }
    if (countProperty) grid.style.removeProperty(countProperty);
    grid.style.removeProperty('--bitbi-public-media-wall-base-column-width');
    grid.style.removeProperty('--bitbi-public-media-wall-resolved-column-width');
    grid.style.gridTemplateColumns = '';
    delete grid.dataset.mediaWallAvailableWidth;
    delete grid.dataset.mediaWallReady;
    delete grid.dataset.mediaWallColumnCount;
    delete grid.dataset.mediaWallBaseWidth;
    delete grid.dataset.mediaWallResolvedWidth;
    delete grid.dataset.mediaWallGap;
    delete grid.dataset.mediaWallCapacity;
    delete grid.dataset.mediaWallItemCount;
    delete grid.dataset.mediaWallRenderToken;
    delete grid.dataset.publicMediaWallReady;
    delete grid.dataset.publicMediaWallWidthPx;
    delete grid.dataset.publicMediaWallColumnCount;
}

function readCardAspectRatio(card, aspectProperty, fallbackRatio) {
    const inlineValue = card?.style?.getPropertyValue(aspectProperty);
    const inlineRatio = Number.parseFloat(inlineValue);
    if (Number.isFinite(inlineRatio) && inlineRatio > 0) return inlineRatio;
    const computedValue = window.getComputedStyle?.(card)?.getPropertyValue(aspectProperty);
    const ratio = Number.parseFloat(computedValue);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : fallbackRatio;
}

function setReadyState(grid, ready) {
    const value = ready ? 'true' : 'false';
    grid.dataset.mediaWallReady = value;
    grid.dataset.publicMediaWallReady = value;
}

function storeLayoutMetrics(grid, metrics) {
    grid.dataset.mediaWallAvailableWidth = String(metrics.availableWidthPx || metrics.gridWidth || 0);
    grid.dataset.mediaWallBaseWidth = String(metrics.baseWidthPx);
    grid.dataset.mediaWallResolvedWidth = String(metrics.resolvedWidthPx);
    grid.dataset.mediaWallGap = String(metrics.gapPx);
    grid.dataset.mediaWallColumnCount = String(metrics.columnCount);
    grid.dataset.mediaWallCapacity = String(metrics.capacity);
    grid.dataset.mediaWallItemCount = String(metrics.itemCount || 0);
    grid.dataset.publicMediaWallWidthPx = String(metrics.resolvedWidthPx);
    grid.dataset.publicMediaWallColumnCount = String(metrics.columnCount);
}

function metricsChanged(previous, next) {
    const differs = (key, tolerance) => (
        Math.abs((Number(previous?.[key]) || 0) - (Number(next?.[key]) || 0)) > tolerance
    );
    return differs('availableWidthPx', 0.5)
        || differs('gapPx', 0.1)
        || differs('baseWidthPx', 0.1)
        || differs('resolvedWidthPx', 1)
        || Number(previous?.itemCount || 0) !== Number(next?.itemCount || 0)
        || Number(previous?.capacity || 0) !== Number(next?.capacity || 0)
        || Number(previous?.columnCount || 0) !== Number(next?.columnCount || 0);
}

function visibleLayoutWidths(nodes) {
    return nodes
        .filter((node) => node?.offsetParent !== null)
        .map((node) => Number(node.clientWidth) || Number(node.offsetWidth) || 0)
        .filter((width) => width > 0);
}

function validateRenderedLayout(grid, cards, metrics, {
    targetWidthProperty,
    fallbackColumnWidth,
} = {}) {
    const currentMetrics = calculateFixedMediaWallMetrics(grid, {
        targetWidthProperty,
        fallbackColumnWidth,
        itemCount: cards.length,
    });
    if (!currentMetrics.availableWidthPx) {
        return { ready: false, stale: false, currentMetrics };
    }
    if (metricsChanged(metrics, currentMetrics)) {
        return { ready: false, stale: true, currentMetrics };
    }

    const stage = grid.closest?.('#homeCategories');
    if (stage?.classList.contains('is-transitioning')) {
        return { ready: false, stale: false, currentMetrics };
    }

    const expectedWidth = currentMetrics.resolvedWidthPx;
    const cardWidths = visibleLayoutWidths(cards);
    const columnWidths = visibleLayoutWidths(Array.from(grid.querySelectorAll('.public-media-wall__column')));
    const cardsReady = !cards.length
        || (cardWidths.length === cards.length && cardWidths.every((width) => Math.abs(width - expectedWidth) <= 2));
    const columnsReady = !cards.length
        || (columnWidths.length === currentMetrics.columnCount && columnWidths.every((width) => Math.abs(width - expectedWidth) <= 2));
    return {
        ready: cardsReady && columnsReady,
        stale: false,
        currentMetrics,
    };
}

function cancelReadyValidation(state) {
    if (!state) return;
    if (state.validationTimer) window.clearTimeout(state.validationTimer);
    if (state.validationFrame) window.cancelAnimationFrame(state.validationFrame);
    if (state.validationNestedFrame) window.cancelAnimationFrame(state.validationNestedFrame);
    state.validationTimer = 0;
    state.validationFrame = 0;
    state.validationNestedFrame = 0;
}

function scheduleReadyValidation(grid, cards, options, token, correctionAttempt, state) {
    const safeCards = Array.isArray(cards) ? cards : [];
    let validationFinished = false;
    let delayedVerificationUsed = false;

    const isCurrent = () => (
        !validationFinished
        && MEDIA_WALL_LAYOUT_STATE.get(grid) === state
        && grid.dataset.mediaWallRenderToken === token
    );

    const finish = (ready) => {
        if (!isCurrent()) return;
        validationFinished = true;
        cancelReadyValidation(state);
        state.ready = ready === true;
        setReadyState(grid, state.ready);
    };

    const scheduleDelayedVerification = () => {
        if (!isCurrent() || delayedVerificationUsed) {
            finish(false);
            return;
        }
        delayedVerificationUsed = true;
        state.validationTimer = window.setTimeout(() => {
            state.validationTimer = 0;
            validate();
        }, MEDIA_WALL_SETTLED_VERIFICATION_DELAY_MS);
    };

    const validate = () => {
        if (!isCurrent()) return;
        const storedMetrics = {
            availableWidthPx: Number(grid.dataset.mediaWallAvailableWidth) || 0,
            gapPx: Number(grid.dataset.mediaWallGap) || 0,
            baseWidthPx: Number(grid.dataset.mediaWallBaseWidth) || 0,
            resolvedWidthPx: Number(grid.dataset.mediaWallResolvedWidth) || 0,
            itemCount: Number(grid.dataset.mediaWallItemCount) || safeCards.length,
            capacity: Number(grid.dataset.mediaWallCapacity) || 1,
            columnCount: Number(grid.dataset.mediaWallColumnCount) || 1,
        };
        const validation = validateRenderedLayout(grid, safeCards, storedMetrics, options);
        if (!validation.currentMetrics.availableWidthPx) {
            finish(false);
            return;
        }
        if (validation.stale && correctionAttempt < 1) {
            validationFinished = true;
            cancelReadyValidation(state);
            renderFixedMediaWallColumns(grid, safeCards, {
                ...options,
                correctionAttempt: correctionAttempt + 1,
                forceLayout: true,
            });
            return;
        }
        if (validation.stale) {
            finish(false);
            return;
        }
        if (validation.ready) {
            storeLayoutMetrics(grid, {
                ...validation.currentMetrics,
                itemCount: safeCards.length,
            });
            finish(true);
            return;
        }
        setReadyState(grid, false);
        scheduleDelayedVerification();
    };

    const runInitialValidation = () => {
        if (!isCurrent()) return;
        cancelReadyValidation(state);
        validate();
    };
    state.validationFrame = window.requestAnimationFrame(() => {
        state.validationFrame = 0;
        state.validationNestedFrame = window.requestAnimationFrame(() => {
            state.validationNestedFrame = 0;
            runInitialValidation();
        });
    });
}

function normalizedMetricSignature(value, precision = 10) {
    const numeric = Number(value) || 0;
    return Math.round(numeric * precision) / precision;
}

function createLayoutSignature(metrics, {
    contentSignature = '',
    countProperty = '',
    targetWidthProperty = '',
    aspectProperty = '',
    fallbackAspectRatio = 1,
    estimatedExtraHeight = 0,
} = {}) {
    return JSON.stringify([
        String(contentSignature || ''),
        String(countProperty || ''),
        String(targetWidthProperty || ''),
        String(aspectProperty || ''),
        normalizedMetricSignature(metrics.availableWidthPx),
        normalizedMetricSignature(metrics.gapPx),
        normalizedMetricSignature(metrics.baseWidthPx),
        normalizedMetricSignature(metrics.resolvedWidthPx),
        Number(metrics.capacity) || 0,
        Number(metrics.columnCount) || 0,
        Number(metrics.itemCount) || 0,
        normalizedMetricSignature(fallbackAspectRatio, 1000),
        normalizedMetricSignature(estimatedExtraHeight, 1000),
    ]);
}

function sameCardSequence(previousCards, nextCards) {
    return Array.isArray(previousCards)
        && previousCards.length === nextCards.length
        && previousCards.every((card, index) => card === nextCards[index]);
}

function hasActiveValidation(state) {
    return !!(
        state?.validationTimer
        || state?.validationFrame
        || state?.validationNestedFrame
    );
}

function clearStoredLayoutMetrics(grid, countProperty) {
    if (countProperty) grid.style.removeProperty(countProperty);
    grid.style.removeProperty('--bitbi-public-media-wall-base-column-width');
    grid.style.removeProperty('--bitbi-public-media-wall-resolved-column-width');
    grid.style.gridTemplateColumns = '';
    delete grid.dataset.mediaWallAvailableWidth;
    delete grid.dataset.mediaWallColumnCount;
    delete grid.dataset.mediaWallBaseWidth;
    delete grid.dataset.mediaWallResolvedWidth;
    delete grid.dataset.mediaWallGap;
    delete grid.dataset.mediaWallCapacity;
    delete grid.dataset.mediaWallItemCount;
    delete grid.dataset.publicMediaWallWidthPx;
    delete grid.dataset.publicMediaWallColumnCount;
}

export function renderFixedMediaWallColumns(grid, cards, {
    countProperty,
    targetWidthProperty,
    fallbackColumnWidth = 216,
    aspectProperty,
    fallbackAspectRatio = 1,
    estimatedExtraHeight = 0,
    correctionAttempt = 0,
    contentSignature = '',
    forceLayout = false,
} = {}) {
    if (!grid) return 1;
    const safeCards = Array.isArray(cards) ? cards : [];
    const metrics = calculateFixedMediaWallMetrics(grid, {
        targetWidthProperty,
        fallbackColumnWidth,
        itemCount: safeCards.length,
    });
    const previousState = MEDIA_WALL_LAYOUT_STATE.get(grid);
    if (!metrics.availableWidthPx) {
        const cardsAlreadyMounted = safeCards.every((card) => grid.contains(card));
        const sameCards = sameCardSequence(previousState?.cards, safeCards);
        if (previousState?.ready && sameCards && cardsAlreadyMounted) {
            return previousState.columnCount || metrics.columnCount;
        }
        cancelReadyValidation(previousState);
        if (!sameCards || !cardsAlreadyMounted) {
            grid.replaceChildren(...safeCards);
        }
        clearStoredLayoutMetrics(grid, countProperty);
        const pendingState = {
            layoutSignature: '',
            contentSignature: String(contentSignature || ''),
            cards: safeCards.slice(),
            columnCount: previousState?.columnCount || metrics.columnCount,
            ready: false,
            pending: true,
            validationTimer: 0,
            validationFrame: 0,
            validationNestedFrame: 0,
        };
        MEDIA_WALL_LAYOUT_STATE.set(grid, pendingState);
        setReadyState(grid, false);
        return pendingState.columnCount;
    }
    const layoutSignature = createLayoutSignature(metrics, {
        contentSignature,
        countProperty,
        targetWidthProperty,
        aspectProperty,
        fallbackAspectRatio,
        estimatedExtraHeight,
    });
    const columnStructureIntact = !safeCards.length
        || grid.querySelectorAll(':scope > .public-media-wall__column').length === previousState?.columnCount;
    if (!forceLayout
        && previousState?.layoutSignature === layoutSignature
        && sameCardSequence(previousState.cards, safeCards)
        && safeCards.every((card) => grid.contains(card))
        && columnStructureIntact) {
        if (!previousState.ready && !hasActiveValidation(previousState)) {
            scheduleReadyValidation(grid, safeCards, {
                countProperty,
                targetWidthProperty,
                fallbackColumnWidth,
                aspectProperty,
                fallbackAspectRatio,
                estimatedExtraHeight,
                contentSignature,
            }, grid.dataset.mediaWallRenderToken || '0', correctionAttempt, previousState);
        }
        return previousState.columnCount || metrics.columnCount;
    }

    cancelReadyValidation(previousState);
    const renderToken = String((Number(grid.dataset.mediaWallRenderToken) || 0) + 1);
    const state = {
        layoutSignature,
        contentSignature: String(contentSignature || ''),
        cards: safeCards.slice(),
        columnCount: metrics.columnCount,
        ready: false,
        pending: false,
        validationTimer: 0,
        validationFrame: 0,
        validationNestedFrame: 0,
    };
    MEDIA_WALL_LAYOUT_STATE.set(grid, state);
    grid.dataset.mediaWallRenderToken = renderToken;
    setReadyState(grid, false);
    const { columnCount, baseWidthPx, resolvedWidthPx: resolvedWidth } = metrics;

    const baseWidthValue = toPixelString(baseWidthPx);
    const resolvedWidthPx = toPixelString(resolvedWidth);
    if (countProperty) {
        grid.style.setProperty(countProperty, String(columnCount));
    }
    grid.style.setProperty('--bitbi-public-media-wall-base-column-width', baseWidthValue);
    grid.style.setProperty('--bitbi-public-media-wall-resolved-column-width', resolvedWidthPx);
    grid.style.gridTemplateColumns = `repeat(${columnCount}, ${resolvedWidthPx})`;
    storeLayoutMetrics(grid, {
        ...metrics,
        itemCount: safeCards.length,
    });

    if (!safeCards.length) {
        grid.replaceChildren();
        scheduleReadyValidation(grid, safeCards, {
            countProperty,
            targetWidthProperty,
            fallbackColumnWidth,
            aspectProperty,
            fallbackAspectRatio,
            estimatedExtraHeight,
            contentSignature,
        }, renderToken, correctionAttempt, state);
        return columnCount;
    }

    const columns = Array.from({ length: columnCount }, () => {
        const node = document.createElement('div');
        node.className = 'public-media-wall__column';
        lockNodeToWidth(node, resolvedWidthPx);
        return { node, estimatedHeight: 0 };
    });

    safeCards.forEach((card) => {
        const targetColumn = columns.reduce((shortest, candidate) => (
            candidate.estimatedHeight < shortest.estimatedHeight ? candidate : shortest
        ), columns[0]);
        lockCardToColumn(card);
        targetColumn.node.appendChild(card);
        const aspectRatio = readCardAspectRatio(card, aspectProperty, fallbackAspectRatio);
        targetColumn.estimatedHeight += (resolvedWidth / aspectRatio) + estimatedExtraHeight;
    });

    grid.replaceChildren(...columns.map((column) => column.node));
    scheduleReadyValidation(grid, safeCards, {
        countProperty,
        targetWidthProperty,
        fallbackColumnWidth,
        aspectProperty,
        fallbackAspectRatio,
        estimatedExtraHeight,
        contentSignature,
    }, renderToken, correctionAttempt, state);
    return columnCount;
}
