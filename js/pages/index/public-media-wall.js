/* ============================================================
   BITBI — Fixed-width public media wall helpers
   ============================================================ */

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
    const panelInner = panel?.querySelector?.(':scope > .section__inner') || null;
    const sectionInner = grid.closest?.('.section__inner') || null;
    const exploreWrapper = grid.closest?.('#galleryExplore, #videoExplore') || null;
    const stableContainers = [
        panelInner,
        sectionInner,
        exploreWrapper?.parentElement || null,
        exploreWrapper,
        grid.parentElement,
    ].filter(Boolean);

    const widths = [];
    for (const container of stableContainers) {
        const style = window.getComputedStyle(container);
        const rect = container.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0) {
            continue;
        }
        const clampedWidth = finiteViewportWidth > 0
            ? Math.min(rect.width, finiteViewportWidth)
            : rect.width;
        if (clampedWidth > 0) widths.push(clampedWidth);
    }

    if (widths.length) return Math.min(...widths);

    const ownWidth = grid.getBoundingClientRect?.().width || 0;
    if (ownWidth <= 0) return 0;
    return finiteViewportWidth > 0 ? Math.min(ownWidth, finiteViewportWidth) : ownWidth;
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
    const computedValue = window.getComputedStyle?.(card)?.getPropertyValue(aspectProperty);
    const ratio = Number.parseFloat(inlineValue || computedValue);
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

function visibleRects(nodes) {
    return nodes
        .filter((node) => node?.offsetParent !== null)
        .map((node) => node.getBoundingClientRect());
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
    const cardRects = visibleRects(cards);
    const columnRects = visibleRects(Array.from(grid.querySelectorAll('.public-media-wall__column')));
    const cardsReady = !cards.length
        || (cardRects.length === cards.length && cardRects.every((rect) => Math.abs(rect.width - expectedWidth) <= 2));
    const columnsReady = !cards.length
        || (columnRects.length === currentMetrics.columnCount && columnRects.every((rect) => Math.abs(rect.width - expectedWidth) <= 2));
    return {
        ready: cardsReady && columnsReady,
        stale: false,
        currentMetrics,
    };
}

function scheduleReadyValidation(grid, cards, options, token, correctionAttempt) {
    const safeCards = Array.isArray(cards) ? cards : [];
    let retryScheduled = false;
    const validate = () => {
        if (grid.dataset.mediaWallRenderToken !== token) return;
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
        if (validation.stale && correctionAttempt < 2) {
            renderFixedMediaWallColumns(grid, safeCards, {
                ...options,
                correctionAttempt: correctionAttempt + 1,
            });
            return;
        }
        if (validation.ready) {
            storeLayoutMetrics(grid, {
                ...validation.currentMetrics,
                itemCount: safeCards.length,
            });
            setReadyState(grid, true);
            return;
        }
        setReadyState(grid, false);
        if (correctionAttempt < 2 && !retryScheduled) {
            retryScheduled = true;
            window.setTimeout(validate, 120);
        }
    };

    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(validate);
    });
    window.setTimeout(validate, 180);
}

export function renderFixedMediaWallColumns(grid, cards, {
    countProperty,
    targetWidthProperty,
    fallbackColumnWidth = 216,
    aspectProperty,
    fallbackAspectRatio = 1,
    estimatedExtraHeight = 0,
    correctionAttempt = 0,
} = {}) {
    if (!grid) return 1;
    const safeCards = Array.isArray(cards) ? cards : [];
    const renderToken = String((Number(grid.dataset.mediaWallRenderToken) || 0) + 1);
    grid.dataset.mediaWallRenderToken = renderToken;
    setReadyState(grid, false);
    const metrics = calculateFixedMediaWallMetrics(grid, {
        targetWidthProperty,
        fallbackColumnWidth,
        itemCount: safeCards.length,
    });
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
        }, renderToken, correctionAttempt);
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
    }, renderToken, correctionAttempt);
    return columnCount;
}
