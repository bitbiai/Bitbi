const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_WIDTH = 230;
const NODE_HEIGHT = 126;

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function capabilityForType(type) {
    if (type === 'text_generation' || type === 'text_prompt' || type === 'note') return 'text';
    if (type === 'image_generation') return 'image';
    if (type === 'video_generation') return 'video';
    if (type === 'music_generation') return 'music';
    return 'asset';
}

function nodeSummary(node, models, copy) {
    const model = models.find((item) => item.id === node.model_id);
    const prompt = String(node.config?.prompt || node.content?.prompt || node.content?.text || '').trim();
    if (prompt) return prompt;
    if (node.type === 'asset_reference' && node.asset_id) return copy.assetSelected;
    if (node.output?.text) return node.output.text;
    return model?.description || copy.emptyNode;
}

function edgePath(source, target) {
    const x1 = Number(source.x) + NODE_WIDTH;
    const y1 = Number(source.y) + 59;
    const x2 = Number(target.x);
    const y2 = Number(target.y) + 59;
    const bend = Math.max(70, Math.abs(x2 - x1) * .42);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

export function createCanvasGraph({ nodesRoot, edgesRoot, emptyState, copy, onSelect, onMoveEnd, onPort }) {
    let data = { nodes: [], edges: [], models: [], selected: null, connectionSourceId: null };
    let dragging = null;

    function drawEdges() {
        edgesRoot.replaceChildren();
        const defs = document.createElementNS(SVG_NS, 'defs');
        const marker = document.createElementNS(SVG_NS, 'marker');
        marker.setAttribute('id', 'canvasArrow');
        marker.setAttribute('markerWidth', '9');
        marker.setAttribute('markerHeight', '9');
        marker.setAttribute('refX', '7');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        const arrow = document.createElementNS(SVG_NS, 'path');
        arrow.setAttribute('d', 'M0,0 L0,6 L8,3 z');
        arrow.setAttribute('fill', '#5c99a6');
        marker.append(arrow);
        defs.append(marker);
        edgesRoot.append(defs);

        for (const edge of data.edges) {
            const source = data.nodes.find((node) => node.id === edge.source_node_id);
            const target = data.nodes.find((node) => node.id === edge.target_node_id);
            if (!source || !target) continue;
            const d = edgePath(source, target);
            const group = document.createElementNS(SVG_NS, 'g');
            group.setAttribute('data-edge-id', edge.id);
            const hit = document.createElementNS(SVG_NS, 'path');
            hit.setAttribute('d', d);
            hit.setAttribute('class', 'canvas-edge-hit');
            hit.setAttribute('tabindex', '0');
            hit.setAttribute('role', 'button');
            hit.setAttribute('aria-label', `${copy.connection}: ${source.title || copy.nodeTypes[source.type]} → ${target.title || copy.nodeTypes[target.type]}`);
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', d);
            path.setAttribute('class', `canvas-edge${data.selected?.kind === 'edge' && data.selected.id === edge.id ? ' is-selected' : ''}`);
            path.setAttribute('marker-end', 'url(#canvasArrow)');
            const select = (event) => { event.stopPropagation(); onSelect('edge', edge.id); };
            hit.addEventListener('click', select);
            hit.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(event); }
            });
            group.append(hit, path);
            edgesRoot.append(group);
        }
    }

    function createPort(node, direction) {
        const button = element('button', `canvas-node__port canvas-node__port--${direction}`);
        button.type = 'button';
        button.dataset.port = direction;
        button.setAttribute('aria-label', direction === 'out' ? copy.startConnection : copy.finishConnection);
        button.addEventListener('pointerdown', (event) => event.stopPropagation());
        button.addEventListener('click', (event) => { event.stopPropagation(); onPort(node.id, direction); });
        return button;
    }

    function createNode(node) {
        const card = element('article', 'canvas-node');
        card.dataset.nodeId = node.id;
        card.dataset.capability = capabilityForType(node.type);
        card.tabIndex = 0;
        card.setAttribute('role', 'group');
        card.setAttribute('aria-label', `${copy.nodeTypes[node.type] || node.type}: ${node.title || copy.untitled}`);
        if (data.selected?.kind === 'node' && data.selected.id === node.id) card.classList.add('is-selected');
        if (data.connectionSourceId === node.id) card.classList.add('is-source');
        card.style.transform = `translate3d(${Number(node.x)}px, ${Number(node.y)}px, 0)`;

        const head = element('div', 'canvas-node__head');
        const type = element('div', 'canvas-node__type');
        type.append(element('span', 'canvas-node__mark'), element('span', '', node.title || copy.nodeTypes[node.type] || node.type));
        const latestRun = data.runs?.find((run) => run.node_id === node.id);
        const status = element('span', 'canvas-node__status', latestRun?.status || (node.output ? copy.completed : copy.ready));
        head.append(type, status);
        const body = element('div', 'canvas-node__body');
        body.append(element('p', '', nodeSummary(node, data.models, copy)));
        const model = data.models.find((item) => item.id === node.model_id);
        const meta = element('div', 'canvas-node__meta');
        meta.append(element('span', '', model?.label || copy.noModel), element('span', '', `${Math.round(Number(node.x))}, ${Math.round(Number(node.y))}`));
        body.append(meta);
        card.append(head, body, createPort(node, 'in'), createPort(node, 'out'));

        card.addEventListener('click', (event) => {
            if (event.target.closest?.('[data-port]')) return;
            onSelect('node', node.id);
        });
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect('node', node.id); }
        });
        head.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            onSelect('node', node.id);
            head.setPointerCapture(event.pointerId);
            dragging = {
                node,
                card,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                x: Number(node.x),
                y: Number(node.y),
            };
        });
        head.addEventListener('pointermove', (event) => {
            if (!dragging || dragging.pointerId !== event.pointerId) return;
            const nextX = Math.max(0, Math.min(2170, dragging.x + event.clientX - dragging.startX));
            const nextY = Math.max(0, Math.min(1450, dragging.y + event.clientY - dragging.startY));
            node.x = Math.round(nextX * 100) / 100;
            node.y = Math.round(nextY * 100) / 100;
            dragging.card.style.transform = `translate3d(${node.x}px, ${node.y}px, 0)`;
            drawEdges();
        });
        const finishDrag = (event) => {
            if (!dragging || dragging.pointerId !== event.pointerId) return;
            const moved = dragging.node;
            dragging = null;
            onMoveEnd(moved);
        };
        head.addEventListener('pointerup', finishDrag);
        head.addEventListener('pointercancel', finishDrag);
        return card;
    }

    function render(next) {
        data = next;
        nodesRoot.replaceChildren(...data.nodes.map(createNode));
        emptyState.hidden = data.nodes.length > 0;
        drawEdges();
    }

    return { render, redrawEdges: drawEdges };
}
