const STREAM_SELECTOR = '.hero__creation-stream';
const SVG_SELECTOR = '.hero__creation-stream-svg';
const CTA_SELECTOR = '.hero__lab-teaser';
const MODELS_MODULE_SELECTOR = '.latest-models-video-module';
const TOP_SLOT_SELECTOR = '[data-latest-models-slot="top"]';
const BOTTOM_SLOT_SELECTOR = '[data-latest-models-slot="bottom"]';
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
        secondControlX,
        secondControlY,
        midX,
        midY,
        finalControlOneX,
        finalControlOneY,
        finalControlTwoX,
        finalControlTwoY,
        endX,
        endY,
    ] = values;

    return {
        path,
        firstControlOffsetX: firstControlX - startX,
        firstControlOffsetY: firstControlY - startY,
        secondControl: { x: secondControlX, y: secondControlY },
        mid: { x: midX, y: midY },
        finalControlOne: { x: finalControlOneX, y: finalControlOneY },
        finalControlTwoOffsetX: finalControlTwoX - endX,
        finalControlTwoOffsetY: finalControlTwoY - endY,
        originalEnd: { x: endX, y: endY },
        endpointRole: getEndpointRole(path),
    };
}

function formatCoordinate(value) {
    return Number.parseFloat(value.toFixed(2)).toString();
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
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

function getEndpointPoint(slotRect, role) {
    const y = clamp(role.y, 0.2, 0.82);
    const edgeX = getEdgeXFraction(y);

    return {
        x: slotRect.left + (slotRect.width * (edgeX + role.xOffset)),
        y: slotRect.top + (slotRect.height * y),
    };
}

function anchorPath(route, origin, endpoint) {
    const nextControlX = origin.x + route.firstControlOffsetX;
    const nextControlY = origin.y + route.firstControlOffsetY;
    const endpointDeltaX = endpoint.x - route.originalEnd.x;
    const endpointDeltaY = endpoint.y - route.originalEnd.y;
    const finalControlOneX = route.finalControlOne.x + (endpointDeltaX * 0.5);
    const finalControlOneY = route.finalControlOne.y + (endpointDeltaY * 0.5);
    const finalControlTwoX = endpoint.x + route.finalControlTwoOffsetX;
    const finalControlTwoY = endpoint.y + route.finalControlTwoOffsetY;
    const nextD = [
        'M',
        formatCoordinate(origin.x),
        formatCoordinate(origin.y),
        'C',
        formatCoordinate(nextControlX),
        formatCoordinate(nextControlY),
        formatCoordinate(route.secondControl.x),
        formatCoordinate(route.secondControl.y),
        formatCoordinate(route.mid.x),
        formatCoordinate(route.mid.y),
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

    const stream = root.querySelector(STREAM_SELECTOR);
    const svg = stream?.querySelector(SVG_SELECTOR);
    const cta = root.querySelector(CTA_SELECTOR);
    const modelsModule = root.querySelector(MODELS_MODULE_SELECTOR);
    const topSlot = root.querySelector(TOP_SLOT_SELECTOR);
    const bottomSlot = root.querySelector(BOTTOM_SLOT_SELECTOR);
    if (!stream || !svg || !cta) return;

    const routes = Array.from(svg.querySelectorAll(STREAM_PATH_SELECTOR))
        .map(parseRoute)
        .filter(Boolean);
    const originFlare = svg.querySelector(ORIGIN_FLARE_SELECTOR);
    const topFlare = svg.querySelector(TOP_FLARE_SELECTOR);
    const bottomFlare = svg.querySelector(BOTTOM_FLARE_SELECTOR);
    const topFlareRay = svg.querySelector(TOP_FLARE_RAY_SELECTOR);
    const bottomFlareRay = svg.querySelector(BOTTOM_FLARE_RAY_SELECTOR);
    const originParticles = Array.from(svg.querySelectorAll(ORIGIN_PARTICLE_SELECTOR))
        .filter((particle) => {
            const cx = particle.cx?.baseVal?.value;
            const cy = particle.cy?.baseVal?.value;
            return Number.isFinite(cx) && Number.isFinite(cy) && cx <= 840 && cy >= 560;
        });

    if (!routes.length) return;

    let frame = 0;

    const sync = () => {
        frame = 0;
        const zone = getOriginZone(svg, cta);
        const videoStackRect = getVideoStackRect(svg, topSlot, bottomSlot, modelsModule);
        if (!zone || !videoStackRect) return;

        routes.forEach((route, index) => {
            anchorPath(
                route,
                getOriginPoint(zone, index),
                getEndpointPoint(videoStackRect, route.endpointRole),
            );
        });

        if (originFlare) {
            anchorCircle(originFlare, {
                x: zone.centerX,
                y: zone.centerY,
            });
        }

        originParticles.forEach((particle, index) => {
            anchorCircle(particle, getOriginPoint(zone, index, ORIGIN_PARTICLE_JITTERS));
        });

        const topEndpoint = getEndpointPoint(videoStackRect, { y: 0.3, xOffset: 0.012 });
        const bottomEndpoint = getEndpointPoint(videoStackRect, { y: 0.66, xOffset: 0.012 });
        if (topFlare) anchorCircle(topFlare, topEndpoint);
        if (bottomFlare) anchorCircle(bottomFlare, bottomEndpoint);
        if (topFlareRay) anchorFlareRay(topFlareRay, topEndpoint, 18);
        if (bottomFlareRay) anchorFlareRay(bottomFlareRay, bottomEndpoint, 20);

        stream.dataset.creationStreamAnchored = 'true';
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

    if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(schedule);
        observer.observe(cta);
        observer.observe(svg);
        observer.observe(stream);
        if (modelsModule) observer.observe(modelsModule);
        if (topSlot) observer.observe(topSlot);
        if (bottomSlot) observer.observe(bottomSlot);
    }

    document.fonts?.ready?.then(schedule).catch(() => {});
}
