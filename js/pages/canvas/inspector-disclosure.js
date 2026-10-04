// UI preferences only: never part of a generation/export recipe or a saved graph.
const openSections = new Map();
const runErrors = new WeakMap();
export function inspectorRunError(node, message) {
    if (message !== undefined) runErrors.set(node, message);
    return runErrors.get(node) || '';
}
export function rememberCanvasDisclosures(root) {
    for (const details of root.querySelectorAll('details[data-canvas-disclosure]')) {
        openSections.delete(details.dataset.canvasDisclosure);
        openSections.set(details.dataset.canvasDisclosure, details.open);
    }
    while (openSections.size > 200) openSections.delete(openSections.keys().next().value);
}

export function canvasDisclosure(key, label, className) {
    const details = document.createElement('details');
    details.className = `canvas-disclosure ${className}`;
    details.dataset.canvasDisclosure = JSON.stringify(key);
    details.open = openSections.get(details.dataset.canvasDisclosure) === true;
    const summary = document.createElement('summary');
    summary.textContent = label;
    details.append(summary);
    return details;
}

// The API's selected output survives failed reruns and history pagination. A
// queued/failed run or a node/asset identity alone is not a successful result.
export function hasCompletedMedia(node) {
    const kind = { image_generation: 'image', video_generation: 'video', music_generation: 'audio' }[node.type];
    const output = node.output;
    return Boolean(kind && output?.kind === kind && (kind === 'image' ? output.asset?.preview_url : output.asset?.file_url));
}
