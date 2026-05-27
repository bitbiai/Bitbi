const STREAM_SELECTOR = '.hero__creation-stream';
const SVG_SELECTOR = '.hero__creation-stream-svg';
const CTA_SELECTOR = '.hero__lab-teaser';
const STREAM_PATH_SELECTOR = [
    '.hero__creation-stream-halo',
    '.hero__creation-stream-strand',
    '.hero__creation-stream-highlight',
].join(',');
const ORIGIN_PARTICLE_SELECTOR = '.hero__creation-stream-particle';
const ORIGIN_FLARE_SELECTOR = '.hero__creation-stream-flare--origin';

const CUBIC_PATH_PREFIX_RE = /^\s*M\s*(-?\d+(?:\.\d+)?)\s*,?\s*(-?\d+(?:\.\d+)?)\s+C\s*(-?\d+(?:\.\d+)?)\s*,?\s*(-?\d+(?:\.\d+)?)(.*)$/i;

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

function parseRoute(path) {
    const originalD = path.getAttribute('d') || '';
    const match = originalD.match(CUBIC_PATH_PREFIX_RE);
    if (!match) return null;

    const startX = Number.parseFloat(match[1]);
    const startY = Number.parseFloat(match[2]);
    const controlX = Number.parseFloat(match[3]);
    const controlY = Number.parseFloat(match[4]);

    if (![startX, startY, controlX, controlY].every(Number.isFinite)) return null;

    return {
        path,
        firstControlOffsetX: controlX - startX,
        firstControlOffsetY: controlY - startY,
        suffix: match[5],
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

function anchorPath(route, origin) {
    const nextControlX = origin.x + route.firstControlOffsetX;
    const nextControlY = origin.y + route.firstControlOffsetY;
    const nextD = [
        'M',
        formatCoordinate(origin.x),
        formatCoordinate(origin.y),
        'C',
        formatCoordinate(nextControlX),
        formatCoordinate(nextControlY),
        route.suffix,
    ].join(' ');

    route.path.setAttribute('d', nextD);
}

function anchorCircle(circle, origin) {
    circle.setAttribute('cx', formatCoordinate(origin.x));
    circle.setAttribute('cy', formatCoordinate(origin.y));
}

export function initCreationStreamAnchor(root = document) {
    if (typeof window === 'undefined') return;

    const stream = root.querySelector(STREAM_SELECTOR);
    const svg = stream?.querySelector(SVG_SELECTOR);
    const cta = root.querySelector(CTA_SELECTOR);
    if (!stream || !svg || !cta) return;

    const routes = Array.from(svg.querySelectorAll(STREAM_PATH_SELECTOR))
        .map(parseRoute)
        .filter(Boolean);
    const originFlare = svg.querySelector(ORIGIN_FLARE_SELECTOR);
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
        if (!zone) return;

        routes.forEach((route, index) => {
            anchorPath(route, getOriginPoint(zone, index));
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
    }

    document.fonts?.ready?.then(schedule).catch(() => {});
}
