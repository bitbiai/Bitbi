const STREAM_SELECTOR = '.hero__creation-stream';
const SVG_SELECTOR = '.hero__creation-stream-svg';
const CTA_SELECTOR = '.hero__lab-teaser';
const MODELS_MODULE_SELECTOR = '.latest-models-video-module';
const TOP_SLOT_SELECTOR = '[data-latest-models-slot="top"]';
const BOTTOM_SLOT_SELECTOR = '[data-latest-models-slot="bottom"]';
const EDGE_GLOW_PATH_SELECTOR = '.latest-models-video-module__edge-glow-path--core';
const STREAM_PATH_SELECTOR = [
    '.hero__creation-stream-halo',
    '.hero__creation-stream-strand',
    '.hero__creation-stream-highlight',
].join(',');
const ORIGIN_PARTICLE_SELECTOR = '.hero__creation-stream-particle';
const ORIGIN_FLARE_SELECTOR = '.hero__creation-stream-flare--origin';
const TOP_FLARE_SELECTOR = '.hero__creation-stream-flare--top';
const BOTTOM_FLARE_SELECTOR = '.hero__creation-stream-flare--bottom';
const TOP_FLARE_RAY_SELECTOR = '.hero__creation-stream-flare-ray--top';
const BOTTOM_FLARE_RAY_SELECTOR = '.hero__creation-stream-flare-ray--bottom';
const LEFT_STREAM_CLASS = 'hero__creation-stream--left';
const RIGHT_STREAM_CLASS = 'hero__creation-stream--right';
const VIEWBOX_WIDTH = 1440;

const NUMBER_RE = /-?\d+(?:\.\d+)?/g;

const PATH_JITTERS = [
    [-0.78, -0.18],
    [-0.42, 0.18],
    [-0.1, -0.34],
    [0.28, 0.05],
    [0.62, -0.08],
    [0.8, 0.28],
    [-0.64, 0.34],
    [-0.24, -0.02],
    [0.08, 0.26],
    [0.46, -0.28],
    [0.74, 0.08],
    [-0.86, 0.02],
];

const ORIGIN_PARTICLE_JITTERS = [
    [-0.72, -0.22],
    [-0.36, 0.14],
    [-0.02, -0.04],
    [0.34, 0.2],
    [0.7, -0.12],
    [-0.52, 0.3],
    [0.54, 0.28],
];

const ENDPOINT_ROLES = [
    ['halo--main', { y: 0.31, xOffset: 0.025 }],
    ['halo--upper', { y: 0.24, xOffset: 0.022 }],
    ['halo--lower', { y: 0.66, xOffset: 0.018 }],
    ['halo--violet', { y: 0.78, xOffset: 0.02 }],
    ['strand--core', { y: 0.31, xOffset: 0.018 }],
    ['strand--upper ', { y: 0.39, xOffset: 0.024 }],
    ['strand--cyan-a', { y: 0.24, xOffset: 0.018 }],
    ['strand--cyan-b', { y: 0.42, xOffset: 0.025 }],
    ['strand--cyan-c', { y: 0.47, xOffset: 0.02 }],
    ['strand--lower', { y: 0.62, xOffset: 0.018 }],
    ['strand--teal-low', { y: 0.72, xOffset: 0.02 }],
    ['strand--magenta ', { y: 0.67, xOffset: 0.022 }],
    ['strand--magenta-b', { y: 0.55, xOffset: 0.024 }],
    ['strand--violet ', { y: 0.8, xOffset: 0.022 }],
    ['strand--violet-bridge', { y: 0.56, xOffset: 0.028 }],
    ['strand--gold ', { y: 0.5, xOffset: 0.026 }],
    ['strand--gold-fine', { y: 0.58, xOffset: 0.025 }],
    ['strand--upper-fine', { y: 0.34, xOffset: 0.02 }],
    ['strand--thread', { y: 0.68, xOffset: 0.018 }],
    ['highlight--one', { y: 0.31, xOffset: 0.012 }],
    ['highlight--two', { y: 0.24, xOffset: 0.012 }],
    ['highlight--three', { y: 0.62, xOffset: 0.012 }],
    ['highlight--four', { y: 0.5, xOffset: 0.016 }],
    ['highlight--five', { y: 0.55, xOffset: 0.018 }],
    ['highlight--six', { y: 0.72, xOffset: 0.014 }],
    ['highlight--seven', { y: 0.56, xOffset: 0.016 }],
];

const DEFAULT_ENDPOINT_ROLES = [
    { y: 0.28, xOffset: 0.02 },
    { y: 0.36, xOffset: 0.025 },
    { y: 0.48, xOffset: 0.02 },
    { y: 0.6, xOffset: 0.018 },
    { y: 0.72, xOffset: 0.02 },
];

function getEndpointRole(path) {
    const className = ` ${path.getAttribute('class') || ''} `;
    const role = ENDPOINT_ROLES.find(([token]) => className.includes(token))?.[1];
    if (role) return role;

    return DEFAULT_ENDPOINT_ROLES[
        Math.abs(className.length) % DEFAULT_ENDPOINT_ROLES.length
    ];
}

function parseRoute(path) {
    const originalD = path.getAttribute('d') || '';
    const values = (originalD.match(NUMBER_RE) || []).map(Number.parseFloat);
    if (values.length < 14 || !values.every(Number.isFinite)) return null;

    const [
        startX,
        startY,
        firstControlX,
        firstControlY,
    ] = values;

    return {
        path,
        firstControlOffsetX: firstControlX - startX,
        firstControlOffsetY: firstControlY - startY,
        endpointRole: getEndpointRole(path),
    };
}

function formatCoordinate(value) {
    return Number.parseFloat(value.toFixed(2)).toString();
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getDistance(start, end) {
    return Math.hypot(end.x - start.x, end.y - start.y);
}

function getUnitVector(vector, fallback = { x: 1, y: 0 }) {
    const length = Math.hypot(vector.x, vector.y);
    if (!length) return fallback;

    return {
        x: vector.x / length,
        y: vector.y / length,
    };
}

function getSvgRect(svg, rect) {
    const svgRect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox?.baseVal;

    if (!viewBox || !svgRect.width || !svgRect.height || !rect.width || !rect.height) {
        return null;
    }

    const scaleX = viewBox.width / svgRect.width;
    const scaleY = viewBox.height / svgRect.height;

    const left = viewBox.x + ((rect.left - svgRect.left) * scaleX);
    const right = viewBox.x + ((rect.right - svgRect.left) * scaleX);
    const top = viewBox.y + ((rect.top - svgRect.top) * scaleY);
    const bottom = viewBox.y + ((rect.bottom - svgRect.top) * scaleY);

    return {
        left,
        right,
        top,
        bottom,
        width: right - left,
        height: bottom - top,
        centerX: left + ((right - left) / 2),
        centerY: top + ((bottom - top) / 2),
    };
}

function getOriginZone(svg, cta) {
    const ctaRect = getSvgRect(svg, cta.getBoundingClientRect());
    if (!ctaRect) return null;

    const safeLeft = ctaRect.left + (ctaRect.width * 0.24);
    const safeRight = ctaRect.right - (ctaRect.width * 0.24);
    const safeTop = ctaRect.top + (ctaRect.height * 0.36);
    const safeBottom = ctaRect.bottom - (ctaRect.height * 0.36);
    const left = Math.min(safeLeft, safeRight);
    const right = Math.max(safeLeft, safeRight);
    const top = Math.min(safeTop, safeBottom);
    const bottom = Math.max(safeTop, safeBottom);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);

    return {
        left,
        right,
        top,
        bottom,
        centerX: left + (width / 2),
        centerY: top + (height / 2),
        maxJitterX: Math.max(0, Math.min(18, width * 0.42)),
        maxJitterY: Math.max(0, Math.min(5.5, height * 0.48)),
    };
}

function getOriginPoint(zone, index, jitterSet = PATH_JITTERS) {
    const jitter = jitterSet[index % jitterSet.length];

    return {
        x: clamp(zone.centerX + (jitter[0] * zone.maxJitterX), zone.left, zone.right),
        y: clamp(zone.centerY + (jitter[1] * zone.maxJitterY), zone.top, zone.bottom),
    };
}

function getVideoStackRect(svg, topSlot, bottomSlot, module) {
    const topRect = topSlot ? getSvgRect(svg, topSlot.getBoundingClientRect()) : null;
    const bottomRect = bottomSlot ? getSvgRect(svg, bottomSlot.getBoundingClientRect()) : null;

    if (topRect && bottomRect) {
        const left = Math.min(topRect.left, bottomRect.left);
        const right = Math.max(topRect.right, bottomRect.right);
        const top = Math.min(topRect.top, bottomRect.top);
        const bottom = Math.max(topRect.bottom, bottomRect.bottom);

        return {
            left,
            right,
            top,
            bottom,
            width: right - left,
            height: bottom - top,
        };
    }

    return module ? getSvgRect(svg, module.getBoundingClientRect()) : null;
}

function getStreamSide(stream) {
    return stream?.dataset?.creationStreamSide === 'left' ? 'left' : 'right';
}

function getSideDirection(side) {
    return side === 'left' ? -1 : 1;
}

function getEdgeXFraction(y) {
    if (y <= 0.34) {
        const progress = y / 0.34;
        return 0.34 + ((0.04 - 0.34) * Math.sin((progress * Math.PI) / 2));
    }

    if (y <= 0.486) {
        const progress = (y - 0.34) / 0.146;
        return 0.04 + ((0.135 - 0.04) * progress);
    }

    if (y <= 0.76) {
        const progress = (y - 0.486) / 0.274;
        return 0.135 + ((0.03 - 0.135) * Math.sin((progress * Math.PI) / 2));
    }

    const progress = Math.min(1, (y - 0.76) / 0.24);
    return 0.03 + ((0.2 - 0.03) * (1 - Math.cos(progress * Math.PI)) / 2);
}

function getFallbackEndpointPoint(slotRect, role, side = 'right') {
    const y = clamp(role.y, 0.2, 0.82);
    const edgeX = side === 'left' ? 1 - getEdgeXFraction(y) : getEdgeXFraction(y);
    const offset = side === 'left' ? -role.xOffset : role.xOffset;

    return {
        x: slotRect.left + (slotRect.width * (edgeX + offset)),
        y: slotRect.top + (slotRect.height * y),
    };
}

function getPointInSvgSpace(sourceElement, sourcePoint, targetSvg) {
    if (typeof DOMPoint !== 'function') return null;

    const sourceMatrix = sourceElement.getScreenCTM?.();
    const targetMatrix = targetSvg.getScreenCTM?.();
    if (!sourceMatrix || !targetMatrix) return null;

    try {
        const screenPoint = new DOMPoint(sourcePoint.x, sourcePoint.y)
            .matrixTransform(sourceMatrix);

        return screenPoint.matrixTransform(targetMatrix.inverse());
    } catch {
        return null;
    }
}

function getEdgeGlowEndpointPoint(svg, edgeGlowPath, role) {
    if (!edgeGlowPath || typeof edgeGlowPath.getTotalLength !== 'function') {
        return null;
    }

    const edgeSvg = edgeGlowPath.ownerSVGElement;
    const viewBox = edgeSvg?.viewBox?.baseVal;
    if (!edgeSvg || !viewBox || !viewBox.height) return null;

    const targetY = viewBox.y + (viewBox.height * clamp(role.y, 0.2, 0.82));
    let totalLength = 0;

    try {
        totalLength = edgeGlowPath.getTotalLength();
    } catch {
        return null;
    }

    if (!Number.isFinite(totalLength) || totalLength <= 0) return null;

    let nearestPoint = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const samples = 96;

    for (let index = 0; index <= samples; index += 1) {
        const point = edgeGlowPath.getPointAtLength((totalLength * index) / samples);
        const distance = Math.abs(point.y - targetY);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestPoint = point;
        }
    }

    if (!nearestPoint) return null;

    return getPointInSvgSpace(edgeGlowPath, nearestPoint, svg);
}

function getEndpointPoint(svg, edgeGlowPath, slotRect, role, side = 'right') {
    return getEdgeGlowEndpointPoint(svg, edgeGlowPath, role)
        || getFallbackEndpointPoint(slotRect, role, side);
}

function getCurveMidPoint(origin, endpoint, role, sideDirection = 1) {
    const upperBranch = role.y < 0.5;
    const progress = upperBranch ? 0.58 : 0.62;
    const sag = upperBranch
        ? 54 + ((0.5 - role.y) * 90)
        : 18 + ((role.y - 0.5) * 42);

    return {
        x: origin.x + ((endpoint.x - origin.x) * progress) - (sideDirection * (upperBranch ? 4 : 16)),
        y: origin.y + ((endpoint.y - origin.y) * progress) + sag,
    };
}

function anchorPath(route, origin, endpoint, side = 'right') {
    const sideDirection = getSideDirection(side);
    const nextControlX = origin.x + (Math.abs(route.firstControlOffsetX) * sideDirection);
    const nextControlY = origin.y + route.firstControlOffsetY;
    const mid = getCurveMidPoint(origin, endpoint, route.endpointRole, sideDirection);
    const midTangent = getUnitVector({
        x: mid.x - origin.x,
        y: mid.y - origin.y,
    });
    const endpointTangent = getUnitVector({
        x: sideDirection,
        y: clamp((route.endpointRole.y - 0.5) * 1.8, -0.62, 0.62),
    });
    const originToMidDistance = getDistance(origin, mid);
    const secondControlDistance = clamp(originToMidDistance * 0.34, 72, 168);
    const secondControlX = mid.x - (midTangent.x * secondControlDistance);
    const secondControlY = mid.y - (midTangent.y * secondControlDistance);
    const endpointDistance = getDistance(mid, endpoint);
    const finalControlOneX = mid.x + (
        midTangent.x * clamp(endpointDistance * 0.42, 84, 190)
    );
    const finalControlOneY = mid.y + (
        midTangent.y * clamp(endpointDistance * 0.42, 84, 190)
    );
    const finalControlTwoX = endpoint.x - (
        endpointTangent.x * clamp(endpointDistance * 0.46, 88, 198)
    );
    const finalControlTwoY = endpoint.y - (
        endpointTangent.y * clamp(endpointDistance * 0.46, 88, 198)
    );
    const nextD = [
        'M',
        formatCoordinate(origin.x),
        formatCoordinate(origin.y),
        'C',
        formatCoordinate(nextControlX),
        formatCoordinate(nextControlY),
        formatCoordinate(secondControlX),
        formatCoordinate(secondControlY),
        formatCoordinate(mid.x),
        formatCoordinate(mid.y),
        'C',
        formatCoordinate(finalControlOneX),
        formatCoordinate(finalControlOneY),
        formatCoordinate(finalControlTwoX),
        formatCoordinate(finalControlTwoY),
        formatCoordinate(endpoint.x),
        formatCoordinate(endpoint.y),
    ].join(' ');

    route.path.setAttribute('d', nextD);
}

function rewriteUrlReference(value, idMap) {
    return value.replace(/url\(#([^)]+)\)/g, (match, id) => (
        idMap.has(id) ? `url(#${idMap.get(id)})` : match
    ));
}

function mirrorGradientX(element) {
    ['x1', 'x2'].forEach((attribute) => {
        const value = Number.parseFloat(element.getAttribute(attribute) || '');
        if (Number.isFinite(value)) {
            element.setAttribute(attribute, formatCoordinate(VIEWBOX_WIDTH - value));
        }
    });
}

function createMirroredLeftStream(sourceStream) {
    const clone = sourceStream.cloneNode(true);
    const idMap = new Map();

    clone.classList.remove(RIGHT_STREAM_CLASS);
    clone.classList.add(LEFT_STREAM_CLASS);
    clone.dataset.creationStreamSide = 'left';
    delete clone.dataset.creationStreamAnchored;

    clone.querySelectorAll('[id]').forEach((element) => {
        const id = element.getAttribute('id');
        if (!id) return;
        const nextId = `${id}Left`;
        idMap.set(id, nextId);
        element.setAttribute('id', nextId);
    });

    clone.querySelectorAll('linearGradient').forEach(mirrorGradientX);
    clone.querySelectorAll('*').forEach((element) => {
        ['stroke', 'fill', 'filter'].forEach((attribute) => {
            const value = element.getAttribute(attribute);
            if (value?.includes('url(#')) {
                element.setAttribute(attribute, rewriteUrlReference(value, idMap));
            }
        });
    });

    return clone;
}

function ensureLeftStream(root) {
    const hero = root.querySelector('#hero');
    if (!hero) return;
    const leftModule = hero.querySelector(`${MODELS_MODULE_SELECTOR}[data-latest-models-video-module-side="left"]`);
    const existingLeftStream = hero.querySelector(`${STREAM_SELECTOR}[data-creation-stream-side="left"]`);
    if (!leftModule || existingLeftStream) return;

    const rightStream = hero.querySelector(`${STREAM_SELECTOR}[data-creation-stream-side="right"]`)
        || hero.querySelector(STREAM_SELECTOR);
    if (!rightStream) return;

    const leftStream = createMirroredLeftStream(rightStream);
    rightStream.after(leftStream);
}

function getModuleForStream(root, side) {
    return root.querySelector(`${MODELS_MODULE_SELECTOR}[data-latest-models-video-module-side="${side}"]`)
        || (side === 'right' ? root.querySelector(MODELS_MODULE_SELECTOR) : null);
}

function anchorCircle(circle, origin) {
    circle.setAttribute('cx', formatCoordinate(origin.x));
    circle.setAttribute('cy', formatCoordinate(origin.y));
}

function anchorFlareRay(path, center, radius) {
    path.setAttribute('d', [
        'M',
        formatCoordinate(center.x - radius),
        formatCoordinate(center.y),
        'L',
        formatCoordinate(center.x + radius),
        formatCoordinate(center.y),
        'M',
        formatCoordinate(center.x),
        formatCoordinate(center.y - radius),
        'L',
        formatCoordinate(center.x),
        formatCoordinate(center.y + radius),
    ].join(' '));
}

export function initCreationStreamAnchor(root = document) {
    if (typeof window === 'undefined') return;

    ensureLeftStream(root);

    const streams = Array.from(root.querySelectorAll(STREAM_SELECTOR));
    const cta = root.querySelector(CTA_SELECTOR);
    if (!streams.length || !cta) return;

    const instances = streams.map((stream) => {
        const svg = stream.querySelector(SVG_SELECTOR);
        const side = getStreamSide(stream);
        const modelsModule = getModuleForStream(root, side);
        const topSlot = modelsModule?.querySelector(TOP_SLOT_SELECTOR);
        const bottomSlot = modelsModule?.querySelector(BOTTOM_SLOT_SELECTOR);
        const edgeGlowPath = modelsModule?.querySelector(EDGE_GLOW_PATH_SELECTOR);
        const routes = svg
            ? Array.from(svg.querySelectorAll(STREAM_PATH_SELECTOR)).map(parseRoute).filter(Boolean)
            : [];

        return {
            stream,
            svg,
            side,
            modelsModule,
            topSlot,
            bottomSlot,
            edgeGlowPath,
            routes,
            originFlare: svg?.querySelector(ORIGIN_FLARE_SELECTOR) || null,
            topFlare: svg?.querySelector(TOP_FLARE_SELECTOR) || null,
            bottomFlare: svg?.querySelector(BOTTOM_FLARE_SELECTOR) || null,
            topFlareRay: svg?.querySelector(TOP_FLARE_RAY_SELECTOR) || null,
            bottomFlareRay: svg?.querySelector(BOTTOM_FLARE_RAY_SELECTOR) || null,
            originParticles: svg
                ? Array.from(svg.querySelectorAll(ORIGIN_PARTICLE_SELECTOR)).filter((particle) => {
                    const cx = particle.cx?.baseVal?.value;
                    const cy = particle.cy?.baseVal?.value;
                    return Number.isFinite(cx) && Number.isFinite(cy) && cx <= 840 && cy >= 560;
                })
                : [],
        };
    }).filter((instance) => instance.svg && instance.routes.length);

    if (!instances.length) return;

    let frame = 0;

    const sync = () => {
        frame = 0;
        instances.forEach((instance) => {
            const zone = getOriginZone(instance.svg, cta);
            const videoStackRect = getVideoStackRect(
                instance.svg,
                instance.topSlot,
                instance.bottomSlot,
                instance.modelsModule,
            );
            if (!zone || !videoStackRect) return;

            instance.routes.forEach((route, index) => {
                anchorPath(
                    route,
                    getOriginPoint(zone, index),
                    getEndpointPoint(instance.svg, instance.edgeGlowPath, videoStackRect, route.endpointRole, instance.side),
                    instance.side,
                );
            });

            if (instance.originFlare) {
                anchorCircle(instance.originFlare, {
                    x: zone.centerX,
                    y: zone.centerY,
                });
            }

            instance.originParticles.forEach((particle, index) => {
                anchorCircle(particle, getOriginPoint(zone, index, ORIGIN_PARTICLE_JITTERS));
            });

            const topEndpoint = getEndpointPoint(instance.svg, instance.edgeGlowPath, videoStackRect, { y: 0.3, xOffset: 0.012 }, instance.side);
            const bottomEndpoint = getEndpointPoint(instance.svg, instance.edgeGlowPath, videoStackRect, { y: 0.66, xOffset: 0.012 }, instance.side);
            if (instance.topFlare) anchorCircle(instance.topFlare, topEndpoint);
            if (instance.bottomFlare) anchorCircle(instance.bottomFlare, bottomEndpoint);
            if (instance.topFlareRay) anchorFlareRay(instance.topFlareRay, topEndpoint, 18);
            if (instance.bottomFlareRay) anchorFlareRay(instance.bottomFlareRay, bottomEndpoint, 20);

            instance.stream.dataset.creationStreamAnchored = 'true';
        });
    };

    const schedule = () => {
        if (frame) return;
        frame = window.requestAnimationFrame(sync);
    };

    schedule();
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('orientationchange', schedule, { passive: true });
    window.addEventListener('load', schedule, { once: true, passive: true });
    window.addEventListener('pageshow', schedule, { passive: true });
    window.addEventListener('bitbi:homepage-hero-scale', schedule, { passive: true });

    if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(schedule);
        observer.observe(cta);
        instances.forEach((instance) => {
            observer.observe(instance.svg);
            observer.observe(instance.stream);
            if (instance.modelsModule) observer.observe(instance.modelsModule);
            if (instance.topSlot) observer.observe(instance.topSlot);
            if (instance.bottomSlot) observer.observe(instance.bottomSlot);
            if (instance.edgeGlowPath?.ownerSVGElement) observer.observe(instance.edgeGlowPath.ownerSVGElement);
        });
    }

    document.fonts?.ready?.then(schedule).catch(() => {});
}
