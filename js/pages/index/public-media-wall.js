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

export function syncFixedMediaWallColumnCount(grid, {
    countProperty,
    targetWidthProperty,
    fallbackColumnWidth = 216,
    itemCount = 0,
} = {}) {
    if (!grid || typeof window.getComputedStyle !== 'function') return 1;
    const current = Number.parseInt(grid.style.getPropertyValue(countProperty), 10);
    const rect = grid.getBoundingClientRect();
    if (!rect.width) {
        return Number.isFinite(current) && current > 0 ? current : 1;
    }

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
    const capacity = Math.max(1, Math.floor((rect.width + gap) / (targetColumnWidth + gap)));
    const nextColumnCount = itemCount > 0 ? Math.min(itemCount, capacity) : capacity;
    if (countProperty && grid.style.getPropertyValue(countProperty) !== String(nextColumnCount)) {
        grid.style.setProperty(countProperty, String(nextColumnCount));
    }
    return nextColumnCount;
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
    const safeCards = Array.isArray(cards) ? cards : [];
    const columnCount = syncFixedMediaWallColumnCount(grid, {
        countProperty,
        targetWidthProperty,
        fallbackColumnWidth,
        itemCount: safeCards.length,
    });

    if (!safeCards.length) {
        grid.replaceChildren();
        return columnCount;
    }

    const style = window.getComputedStyle(grid);
    const targetColumnWidth = parseCssLengthToPixels(
        style.getPropertyValue(targetWidthProperty),
        fallbackColumnWidth,
        grid,
    );
    const columns = Array.from({ length: columnCount }, () => {
        const node = document.createElement('div');
        node.className = 'public-media-wall__column';
        return { node, estimatedHeight: 0 };
    });

    safeCards.forEach((card) => {
        const targetColumn = columns.reduce((shortest, candidate) => (
            candidate.estimatedHeight < shortest.estimatedHeight ? candidate : shortest
        ), columns[0]);
        targetColumn.node.appendChild(card);
        const aspectRatio = readCardAspectRatio(card, aspectProperty, fallbackAspectRatio);
        targetColumn.estimatedHeight += (targetColumnWidth / aspectRatio) + estimatedExtraHeight;
    });

    grid.replaceChildren(...columns.map((column) => column.node));
    return columnCount;
}
