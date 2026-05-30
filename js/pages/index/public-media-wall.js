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

function getAvailableInlineWidth(element) {
    const ownWidth = element?.getBoundingClientRect?.().width || 0;
    const parentWidth = element?.parentElement?.getBoundingClientRect?.().width || 0;
    if (ownWidth > 0 && parentWidth > 0) return Math.min(ownWidth, parentWidth);
    return ownWidth || parentWidth || 0;
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

    const gridWidth = getAvailableInlineWidth(grid);
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
    const capacity = gridWidth
        ? Math.max(1, Math.floor((gridWidth + gap) / (targetColumnWidth + gap)))
        : 1;
    const columnCount = itemCount > 0 ? Math.min(itemCount, capacity) : capacity;
    const resolvedWidth = gridWidth && columnCount > 0
        ? Math.max(targetColumnWidth, Math.floor(((gridWidth - (gap * (columnCount - 1))) / columnCount) * 1000) / 1000)
        : targetColumnWidth;
    return {
        gridWidth,
        gapPx: gap,
        baseWidthPx: targetColumnWidth,
        targetWidthPx: targetColumnWidth,
        resolvedWidthPx: resolvedWidth,
        capacity,
        columnCount,
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
    delete grid.dataset.mediaWallReady;
    delete grid.dataset.mediaWallColumnCount;
    delete grid.dataset.mediaWallBaseWidth;
    delete grid.dataset.mediaWallResolvedWidth;
    delete grid.dataset.mediaWallGap;
    delete grid.dataset.mediaWallCapacity;
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

export function renderFixedMediaWallColumns(grid, cards, {
    countProperty,
    targetWidthProperty,
    fallbackColumnWidth = 216,
    aspectProperty,
    fallbackAspectRatio = 1,
    estimatedExtraHeight = 0,
} = {}) {
    if (!grid) return 1;
    const safeCards = Array.isArray(cards) ? cards : [];
    grid.dataset.mediaWallReady = 'false';
    grid.dataset.publicMediaWallReady = 'false';
    const metrics = calculateFixedMediaWallMetrics(grid, {
        targetWidthProperty,
        fallbackColumnWidth,
        itemCount: safeCards.length,
    });
    const { columnCount, baseWidthPx, resolvedWidthPx: resolvedWidth, gapPx, capacity } = metrics;
    const baseWidthValue = toPixelString(baseWidthPx);
    const resolvedWidthPx = toPixelString(resolvedWidth);
    if (countProperty) {
        grid.style.setProperty(countProperty, String(columnCount));
    }
    grid.style.setProperty('--bitbi-public-media-wall-base-column-width', baseWidthValue);
    grid.style.setProperty('--bitbi-public-media-wall-resolved-column-width', resolvedWidthPx);
    grid.style.gridTemplateColumns = `repeat(${columnCount}, ${resolvedWidthPx})`;

    if (!safeCards.length) {
        grid.replaceChildren();
        grid.dataset.mediaWallReady = 'true';
        grid.dataset.mediaWallBaseWidth = String(baseWidthPx);
        grid.dataset.mediaWallResolvedWidth = String(resolvedWidth);
        grid.dataset.mediaWallGap = String(gapPx);
        grid.dataset.mediaWallColumnCount = String(columnCount);
        grid.dataset.mediaWallCapacity = String(capacity);
        grid.dataset.publicMediaWallReady = 'true';
        grid.dataset.publicMediaWallWidthPx = String(resolvedWidth);
        grid.dataset.publicMediaWallColumnCount = String(columnCount);
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
    grid.dataset.mediaWallReady = 'true';
    grid.dataset.mediaWallBaseWidth = String(baseWidthPx);
    grid.dataset.mediaWallResolvedWidth = String(resolvedWidth);
    grid.dataset.mediaWallGap = String(gapPx);
    grid.dataset.mediaWallColumnCount = String(columnCount);
    grid.dataset.mediaWallCapacity = String(capacity);
    grid.dataset.publicMediaWallReady = 'true';
    grid.dataset.publicMediaWallWidthPx = String(resolvedWidth);
    grid.dataset.publicMediaWallColumnCount = String(columnCount);
    return columnCount;
}
