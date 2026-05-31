/* ============================================================
   BITBI - Homepage category ghost model names
   ============================================================ */

const CATEGORY_PANEL_SELECTORS = {
    gallery: '#gallery',
    video: '#video-creations',
    sound: '#soundlab',
};

const GHOST_SLOT_ROTATION_MS = 3600;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const GHOST_SAFE_SLOTS = Object.freeze({
    left: Object.freeze([
        Object.freeze({
            id: 'left-high',
            inline: 'clamp(0.15rem, 1.15vw, 1.25rem)',
            top: '10%',
            driftX: '34px',
            driftY: '-14px',
            endX: '64px',
            endY: '8px',
            scale: '1.1',
            peak: '0.58',
            duration: '9.8s',
        }),
        Object.freeze({
            id: 'left-mid',
            inline: 'clamp(0.8rem, 2.8vw, 3.25rem)',
            top: '34%',
            driftX: '24px',
            driftY: '16px',
            endX: '54px',
            endY: '32px',
            scale: '1.07',
            peak: '0.5',
            duration: '10.6s',
        }),
        Object.freeze({
            id: 'left-low',
            inline: 'clamp(0.25rem, 4.2vw, 4.85rem)',
            top: '54%',
            driftX: '30px',
            driftY: '-7px',
            endX: '68px',
            endY: '14px',
            scale: '1.13',
            peak: '0.54',
            duration: '11.2s',
        }),
        Object.freeze({
            id: 'left-depth',
            inline: 'clamp(1.35rem, 3.5vw, 4rem)',
            top: '18%',
            driftX: '42px',
            driftY: '10px',
            endX: '76px',
            endY: '25px',
            scale: '1.16',
            peak: '0.46',
            duration: '12s',
        }),
    ]),
    right: Object.freeze([
        Object.freeze({
            id: 'right-high',
            inline: 'clamp(0.15rem, 1.25vw, 1.4rem)',
            top: '12%',
            driftX: '-36px',
            driftY: '-12px',
            endX: '-70px',
            endY: '9px',
            scale: '1.1',
            peak: '0.56',
            duration: '10s',
        }),
        Object.freeze({
            id: 'right-mid',
            inline: 'clamp(0.95rem, 2.95vw, 3.4rem)',
            top: '40%',
            driftX: '-24px',
            driftY: '15px',
            endX: '-58px',
            endY: '34px',
            scale: '1.08',
            peak: '0.5',
            duration: '10.9s',
        }),
        Object.freeze({
            id: 'right-low',
            inline: 'clamp(0.3rem, 4.3vw, 5rem)',
            top: '56%',
            driftX: '-32px',
            driftY: '-8px',
            endX: '-72px',
            endY: '16px',
            scale: '1.14',
            peak: '0.54',
            duration: '11.4s',
        }),
        Object.freeze({
            id: 'right-depth',
            inline: 'clamp(1.25rem, 3.4vw, 3.9rem)',
            top: '24%',
            driftX: '-44px',
            driftY: '9px',
            endX: '-78px',
            endY: '24px',
            scale: '1.16',
            peak: '0.48',
            duration: '12.2s',
        }),
    ]),
});

const ghostRotationTimers = new WeakMap();

const CATEGORY_CONFIG_FALLBACK_MODEL_NAMES = Object.freeze({
    gallery: Object.freeze([
        'FLUX.1 Schnell',
        'FLUX.2 Klein 9B',
        'FLUX.2 Max',
        'GPT Image 2',
    ]),
    video: Object.freeze([
        'PixVerse V6',
        'HappyHorse 1.0 T2V',
        'Seedance 2.0 Fast',
        'Grok Imagine Video',
    ]),
    sound: Object.freeze([
        'Music 2.6',
    ]),
});

const CATEGORY_KNOWN_MODEL_NAMES = Object.freeze({
    gallery: new Set([
        'FLUX.1 Schnell',
        'FLUX.2 Klein 9B',
        'FLUX.2 Dev',
        'FLUX.2 Max',
        'GPT Image 2',
    ]),
    video: new Set([
        'PixVerse V6',
        'PixVerse V4.5',
        'HappyHorse 1.0 T2V',
        'Seedance 2.0 Fast',
        'Grok Imagine Video',
    ]),
    sound: new Set([
        'Music 2.6',
        'MiniMax Music 2.6',
    ]),
});

const DISALLOWED_PUBLIC_MODEL_NAMES = new Set([
    'Seedance 2.0',
    'Vidu Q3 Pro',
]);

const MODEL_LABELS = new Map([
    ['@cf/black-forest-labs/flux-1-schnell', 'FLUX.1 Schnell'],
    ['black-forest-labs/flux-1-schnell', 'FLUX.1 Schnell'],
    ['flux-1-schnell', 'FLUX.1 Schnell'],
    ['@cf/black-forest-labs/flux-2-klein-9b', 'FLUX.2 Klein 9B'],
    ['black-forest-labs/flux-2-klein-9b', 'FLUX.2 Klein 9B'],
    ['flux-2-klein-9b', 'FLUX.2 Klein 9B'],
    ['@cf/black-forest-labs/flux-2-dev', 'FLUX.2 Dev'],
    ['black-forest-labs/flux-2-dev', 'FLUX.2 Dev'],
    ['flux-2-dev', 'FLUX.2 Dev'],
    ['black-forest-labs/flux-2-max', 'FLUX.2 Max'],
    ['flux-2-max', 'FLUX.2 Max'],
    ['openai/gpt-image-2', 'GPT Image 2'],
    ['gpt-image-2', 'GPT Image 2'],
    ['pixverse/v6', 'PixVerse V6'],
    ['pixverse/v4.5', 'PixVerse V4.5'],
    ['alibaba/hh1-t2v', 'HappyHorse 1.0 T2V'],
    ['bytedance/seedance-2.0-fast', 'Seedance 2.0 Fast'],
    ['xai/grok-imagine-video', 'Grok Imagine Video'],
    ['grok-imagine-video', 'Grok Imagine Video'],
    ['minimax/music-2.6', 'Music 2.6'],
    ['music-2.6', 'Music 2.6'],
]);

const ALL_KNOWN_MODEL_NAMES = new Set(
    Object.values(CATEGORY_KNOWN_MODEL_NAMES).flatMap((names) => [...names])
);

const DIRECT_MODEL_KEYS = [
    'modelLabel',
    'model_label',
    'modelName',
    'model_name',
    'modelDisplayName',
    'model_display_name',
    'modelId',
    'model_id',
    'model',
    'providerModel',
    'provider_model',
    'generatorModel',
    'generator_model',
    'aiModel',
    'ai_model',
    'sourceModel',
    'source_model',
];

const NESTED_MODEL_KEYS = [
    'label',
    'name',
    'displayName',
    'display_name',
    'modelLabel',
    'model_label',
    'modelName',
    'model_name',
    'id',
    'modelId',
    'model_id',
];

const NESTED_MODEL_CONTAINERS = [
    'metadata',
    'meta',
    'generation',
    'generationMeta',
    'generation_meta',
    'generationMetadata',
    'generation_metadata',
    'provider',
    'asset',
    'source',
];

const MODEL_STOP_WORDS = new Set([
    'image',
    'video',
    'audio',
    'sound',
    'music',
    'mempic',
    'mempics',
    'memvid',
    'memvids',
    'memtrack',
    'memtracks',
]);

function normalizeModelLabel(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw || MODEL_STOP_WORDS.has(raw.toLowerCase())) return '';
    const mapped = MODEL_LABELS.get(raw) || MODEL_LABELS.get(raw.toLowerCase());
    if (mapped) return mapped;
    if (raw.includes('/')) return '';
    if (raw.length > 48) return '';
    return raw;
}

function isCategoryAllowedModelName(category, name) {
    if (!name || DISALLOWED_PUBLIC_MODEL_NAMES.has(name)) return false;
    const categoryNames = CATEGORY_KNOWN_MODEL_NAMES[category];
    if (!categoryNames) return false;
    if (ALL_KNOWN_MODEL_NAMES.has(name)) return categoryNames.has(name);
    return true;
}

function readModelValue(value, out) {
    if (typeof value === 'string') {
        const label = normalizeModelLabel(value);
        if (label) out.push(label);
        return;
    }
    if (!value || typeof value !== 'object') return;
    NESTED_MODEL_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            readModelValue(value[key], out);
        }
    });
}

function readItemModelLabels(item) {
    const labels = [];
    if (!item || typeof item !== 'object') return labels;

    DIRECT_MODEL_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(item, key)) {
            readModelValue(item[key], labels);
        }
    });

    NESTED_MODEL_CONTAINERS.forEach((key) => {
        const container = item[key];
        if (!container || typeof container !== 'object') return;
        DIRECT_MODEL_KEYS.forEach((modelKey) => {
            if (Object.prototype.hasOwnProperty.call(container, modelKey)) {
                readModelValue(container[modelKey], labels);
            }
        });
        readModelValue(container.model, labels);
    });

    return labels;
}

function dedupeModelNames(names, category) {
    const seen = new Set();
    const deduped = [];
    (Array.isArray(names) ? names : []).forEach((name) => {
        if (!isCategoryAllowedModelName(category, name)) return;
        const key = name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(name);
    });
    return deduped;
}

function collectModelNames(category, items) {
    const names = [];
    (Array.isArray(items) ? items : []).forEach((item) => {
        readItemModelLabels(item).forEach((name) => {
            names.push(name);
        });
    });
    return dedupeModelNames(names, category);
}

function fallbackModelNames(category) {
    return dedupeModelNames(CATEGORY_CONFIG_FALLBACK_MODEL_NAMES[category] || [], category);
}

function hashGhostSeed(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function canAnimateGhostSlots() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return !window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function stopGhostRotation(root) {
    const timer = ghostRotationTimers.get(root);
    if (timer) {
        window.clearInterval(timer);
        ghostRotationTimers.delete(root);
    }
}

function pickGhostSlot(category, name, index, cycle, side) {
    const slots = GHOST_SAFE_SLOTS[side] || GHOST_SAFE_SLOTS.left;
    const seed = hashGhostSeed(`${category}:${name}:${index}`);
    return slots[(seed + cycle + index) % slots.length];
}

function applyGhostSlot(el, slot, cycle) {
    el.dataset.ghostSlot = slot.id;
    el.dataset.ghostCycle = String(cycle);
    el.style.setProperty('--ghost-inline', slot.inline);
    el.style.setProperty('--ghost-top', slot.top);
    el.style.setProperty('--ghost-drift-x', slot.driftX);
    el.style.setProperty('--ghost-drift-y', slot.driftY);
    el.style.setProperty('--ghost-end-x', slot.endX);
    el.style.setProperty('--ghost-end-y', slot.endY);
    el.style.setProperty('--ghost-scale', slot.scale);
    el.style.setProperty('--ghost-peak-opacity', slot.peak);
    el.style.setProperty('--ghost-duration', slot.duration);
}

function applyGhostSlots(root, category, cycle) {
    const nodes = Array.from(root.querySelectorAll('.category-ghost-models__name'));
    nodes.forEach((el, index) => {
        const side = el.dataset.ghostSide === 'right' ? 'right' : 'left';
        const slot = pickGhostSlot(category, el.dataset.modelName || el.textContent || '', index, cycle, side);
        applyGhostSlot(el, slot, cycle);
    });
    root.dataset.ghostCycle = String(cycle);
    root.dataset.ghostRotation = 'seeded-safe-slots';
}

function startGhostRotation(root, category) {
    stopGhostRotation(root);
    let cycle = 0;
    applyGhostSlots(root, category, cycle);
    if (!canAnimateGhostSlots()) return;
    const timer = window.setInterval(() => {
        cycle = (cycle + 1) % 997;
        applyGhostSlots(root, category, cycle);
    }, GHOST_SLOT_ROTATION_MS);
    ghostRotationTimers.set(root, timer);
}

function ensureGhostRoot(panel, category) {
    let root = panel.querySelector(`.category-ghost-models[data-ghost-category="${category}"]`);
    if (root) return root;
    root = document.createElement('div');
    root.className = 'category-ghost-models';
    root.dataset.ghostCategory = category;
    root.setAttribute('aria-hidden', 'true');
    panel.insertBefore(root, panel.firstElementChild);
    return root;
}

export function syncCategoryGhostModels(category, items) {
    const selector = CATEGORY_PANEL_SELECTORS[category];
    if (!selector) return [];
    const panel = document.querySelector(selector);
    if (!panel) return [];
    const root = ensureGhostRoot(panel, category);
    const collectedNames = collectModelNames(category, items);
    const source = collectedNames.length ? 'media-metadata' : 'category-config';
    const names = (collectedNames.length ? collectedNames : fallbackModelNames(category)).slice(0, 6);
    root.replaceChildren();
    root.hidden = names.length === 0;
    root.dataset.ghostSource = names.length ? source : 'none';
    if (!names.length) {
        stopGhostRotation(root);
        root.dataset.ghostRotation = 'none';
        root.dataset.ghostCycle = '0';
        return names;
    }

    names.forEach((name, index) => {
        const el = document.createElement('span');
        el.className = 'category-ghost-models__name';
        el.dataset.ghostSide = index % 2 === 0 ? 'left' : 'right';
        el.dataset.modelName = name;
        el.style.setProperty('--ghost-index', String(index));
        el.style.setProperty('--ghost-delay', `${-4.8 - (index * 1.45)}s`);
        el.textContent = name;
        root.appendChild(el);
    });

    startGhostRotation(root, category);
    return names;
}
