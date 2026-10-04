const paths = {
    image: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'm3 16 5-5 4 4 3-3 6 6', 'M8 7h.01'],
    video: ['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'm10 8 6 4-6 4Z'],
    audio: ['M9 18V5l12-2v13', 'M9 5v4l12-2', 'M9 18a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3Z', 'M21 16a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3Z'],
    asset: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'M14 2v6h6'],
};

export function canvasMediaIcon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of Object.entries({ class: 'canvas-node__icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', 'data-media-icon': kind })) svg.setAttribute(name, value);
    for (const d of paths[kind] || paths.asset) {
        const path = document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', d); svg.append(path);
    }
    return svg;
}
