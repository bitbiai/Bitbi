/* ============================================================
   BITBI - Homepage category ghost model names
   ============================================================ */

const CATEGORY_PANEL_SELECTORS = {
    gallery: '#gallery',
    video: '#video-creations',
    sound: '#soundlab',
};

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
    ['openai/gpt-image-2', 'GPT Image 2'],
    ['gpt-image-2', 'GPT Image 2'],
    ['pixverse/v6', 'PixVerse V6'],
    ['pixverse/v4.5', 'PixVerse V4.5'],
    ['alibaba/hh1-t2v', 'HappyHorse 1.0 T2V'],
    ['bytedance/seedance-2.0-fast', 'Seedance 2.0 Fast'],
    ['bytedance/seedance-2.0', 'Seedance 2.0'],
    ['minimax/music-2.6', 'Music 2.6'],
    ['music-2.6', 'Music 2.6'],
]);

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

function collectModelNames(items) {
    const seen = new Set();
    const names = [];
    (Array.isArray(items) ? items : []).forEach((item) => {
        readItemModelLabels(item).forEach((name) => {
            const key = name.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            names.push(name);
        });
    });
    return names;
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
    const names = collectModelNames(items).slice(0, 6);
    root.replaceChildren();
    root.hidden = names.length === 0;
    if (!names.length) return names;

    names.forEach((name, index) => {
        const el = document.createElement('span');
        el.className = 'category-ghost-models__name';
        el.dataset.ghostSide = index % 2 === 0 ? 'left' : 'right';
        el.dataset.modelName = name;
        el.style.setProperty('--ghost-index', String(index));
        el.style.setProperty('--ghost-delay', `${index * 1.35}s`);
        el.style.setProperty('--ghost-top', `${18 + ((index * 23) % 54)}%`);
        el.textContent = name;
        root.appendChild(el);
    });

    return names;
}
