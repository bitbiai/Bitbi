import {
    apiAiGetFolders,
    apiAiSaveImage,
    apiAdminAiCompare,
    apiAdminAiLiveAgent,
    apiAdminAiModels,
    apiAdminAiSaveTextAsset,
    apiAdminAiTestEmbeddings,
    apiAdminAiTestImage,
    apiAdminAiTestText,
} from '../../shared/auth-api.js?v=20260412-wave15';
import { createSavedAssetsBrowser } from '../../shared/saved-assets-browser.js?v=20260412-wave15';

const STORAGE_KEY = 'bitbi_admin_ai_lab_state_v1';
const MODES = ['models', 'text', 'image', 'embeddings', 'compare', 'live-agent'];
const HISTORY_LIMIT = 6;
// Keep this token aligned with admin/index.html, js/pages/admin/main.js, and the admin release-token checklist in CLAUDE.md.
const ADMIN_AI_UI_VERSION = '20260412-wave15';
const DEFAULT_REQUEST_TIMEOUTS = {
    text: 20_000,
    image: 45_000,
    embeddings: 15_000,
    compare: 30_000,
};
const FLUX_2_DEV_MODEL_ID = '@cf/black-forest-labs/flux-2-dev';
const FLUX_2_DEV_REFERENCE_IMAGE_MAX_DIMENSION_EXCLUSIVE = 512;
const TASK_UI = {
    text: {
        label: 'Text',
        busyText: 'Running...',
        idleText: 'Run Text Test',
    },
    image: {
        label: 'Image',
        busyText: 'Generating...',
        idleText: 'Run Image Test',
    },
    embeddings: {
        label: 'Embeddings',
        busyText: 'Running...',
        idleText: 'Run Embeddings',
    },
    compare: {
        label: 'Compare',
        busyText: 'Comparing...',
        idleText: 'Run Compare',
    },
};
const ADMIN_AI_CODE_MESSAGES = {
    unauthorized: 'Admin session required. Sign in again to continue.',
    forbidden: 'Admin privileges required to use the AI Lab.',
    rate_limited: 'Too many admin AI requests are in flight. Please wait and retry.',
    model_not_allowed: 'Selected model is not allowlisted for this AI Lab task.',
    duplicate_models: 'Choose two different compare models to continue.',
    upstream_error: 'The AI worker could not complete the request cleanly.',
    internal_error: 'The AI Lab encountered an internal error.',
    bad_request: 'The request format was invalid.',
    validation_error: 'Review the request values and try again.',
    not_found: 'The requested AI Lab route was not found.',
    request_aborted: 'Request cancelled.',
    request_timeout: 'The request took too long and was cancelled.',
    network_error: 'Network error. Please try again.',
};

const DEFAULT_FORMS = {
    text: {
        preset: 'balanced',
        model: '',
        system: 'You are a concise assistant.',
        prompt: '',
        maxTokens: 300,
        temperature: 0.7,
    },
    image: {
        preset: 'image_fast',
        model: '',
        prompt: '',
        promptMode: 'standard',
        structuredPrompt: '',
        width: 1024,
        height: 1024,
        steps: 4,
        seed: '',
        guidance: '',
        referenceImages: [],
    },
    embeddings: {
        preset: 'embedding_default',
        model: '',
        input: '',
    },
    compare: {
        modelA: '@cf/meta/llama-3.1-8b-instruct-fast',
        modelB: '@cf/openai/gpt-oss-20b',
        system: 'You are concise.',
        prompt: '',
        maxTokens: 250,
        temperature: 0.7,
    },
};

const DEFAULT_PREFERENCES = {
    compareOnlyDifferences: false,
};

const LIVE_AGENT_MODEL = {
    id: '@cf/google/gemma-4-26b-a4b-it',
    label: 'Gemma 4 26B A4B',
    vendor: 'Google',
};

const SAMPLE_LIBRARY = {
    text: [
        {
            id: 'summary',
            label: 'Portfolio Summary',
            system: 'You are a concise assistant for a creative technology portfolio.',
            prompt: 'Write a short admin-ready summary of BITBI in 4 bullet points.',
        },
        {
            id: 'release-notes',
            label: 'Release Notes',
            system: 'You are a product editor. Be concrete and efficient.',
            prompt: 'Turn this feature idea into 5 concise release notes for an admin changelog: new AI lab worker, admin-only routing, safer compare mode, additive rollout, no public exposure.',
        },
        {
            id: 'landing-copy',
            label: 'Landing Copy',
            system: 'You are a sharp marketing writer who avoids hype.',
            prompt: 'Write a compact hero paragraph for an experimental AI art and audio portfolio that feels premium and technical.',
        },
    ],
    image: [
        {
            id: 'neon-city',
            label: 'Neon City',
            prompt: 'A cinematic futuristic city at night, rain-slick streets, neon reflections, sharp detail.',
        },
        {
            id: 'editorial-portrait',
            label: 'Editorial Portrait',
            prompt: 'An editorial portrait of a digital artist in a minimal studio, dramatic side light, clean composition, premium magazine photography.',
        },
        {
            id: 'abstract-cover',
            label: 'Abstract Cover',
            prompt: 'An abstract cover image with liquid chrome shapes, cyan highlights, dark background, elegant composition, high contrast.',
        },
    ],
    embeddings: [
        {
            id: 'portfolio-lines',
            label: 'Portfolio Lines',
            input: 'BITBI is an experimental AI art portfolio.\nThe site includes visuals, sound, and admin tools.',
        },
        {
            id: 'taxonomy',
            label: 'Tag Taxonomy',
            input: 'cyberpunk neon skyline\nminimal editorial portrait\nabstract chrome sculpture\nambient synth soundtrack',
        },
        {
            id: 'content-snippets',
            label: 'Content Snippets',
            input: 'Admin-only AI lab for safe experimentation.\nPublic production routes remain isolated.\nCompare allowlisted models with bounded limits.',
        },
    ],
    compare: [
        {
            id: 'tagline',
            label: 'Tagline',
            system: 'You are concise.',
            prompt: 'Write a short landing page tagline for an experimental AI art portfolio.',
        },
        {
            id: 'hero-intro',
            label: 'Hero Intro',
            system: 'You are a concise copywriter with strong visual language.',
            prompt: 'Write a 2-sentence homepage intro for a premium creative technology portfolio that blends AI imagery, audio, and experiments.',
        },
        {
            id: 'art-direction',
            label: 'Art Direction',
            system: 'You are an art director. Be specific and compact.',
            prompt: 'Describe the visual direction for a futuristic portfolio homepage in 6 short bullets.',
        },
    ],
};

function cloneDefaultForms() {
    return JSON.parse(JSON.stringify(DEFAULT_FORMS));
}

function cloneDefaultHistory() {
    return {
        text: [],
        image: [],
        embeddings: [],
        compare: [],
    };
}

function cloneDefaultPreferences() {
    return {
        ...DEFAULT_PREFERENCES,
    };
}

function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function resolveRequestTimeouts(overrides) {
    const resolved = { ...DEFAULT_REQUEST_TIMEOUTS };
    if (!isObject(overrides)) return resolved;

    for (const [task, fallback] of Object.entries(DEFAULT_REQUEST_TIMEOUTS)) {
        const candidate = Number(overrides[task]);
        if (Number.isFinite(candidate) && candidate >= 100) {
            resolved[task] = Math.round(candidate);
        } else {
            resolved[task] = fallback;
        }
    }

    return resolved;
}

function loadPersisted() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        return isObject(data) ? data : null;
    } catch {
        return null;
    }
}

function mergeForms(savedForms) {
    const merged = cloneDefaultForms();
    if (!isObject(savedForms)) return merged;

    for (const [mode, defaults] of Object.entries(merged)) {
        const saved = savedForms[mode];
        if (!isObject(saved)) continue;
        for (const key of Object.keys(defaults)) {
            if (saved[key] !== undefined && saved[key] !== null) {
                merged[mode][key] = saved[key];
            }
        }
    }

    return merged;
}

function mergeHistory(savedHistory) {
    const merged = cloneDefaultHistory();
    if (!isObject(savedHistory)) return merged;

    for (const key of Object.keys(merged)) {
        const values = Array.isArray(savedHistory[key]) ? savedHistory[key] : [];
        merged[key] = values
            .filter((value) => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean)
            .filter((value, index, list) => list.indexOf(value) === index)
            .slice(0, HISTORY_LIMIT);
    }

    return merged;
}

function mergePreferences(savedPreferences) {
    const merged = cloneDefaultPreferences();
    if (!isObject(savedPreferences)) return merged;

    if (typeof savedPreferences.compareOnlyDifferences === 'boolean') {
        merged.compareOnlyDifferences = savedPreferences.compareOnlyDifferences;
    }

    return merged;
}

function formatTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(date);
}

function formatElapsed(elapsedMs) {
    if (typeof elapsedMs !== 'number' || Number.isNaN(elapsedMs)) return '—';
    if (elapsedMs < 1000) return `${elapsedMs} ms`;
    return `${(elapsedMs / 1000).toFixed(2)} s`;
}

function formatTimeoutDuration(timeoutMs) {
    if (typeof timeoutMs !== 'number' || Number.isNaN(timeoutMs)) return 'the configured limit';
    if (timeoutMs < 1000) return `${timeoutMs} ms`;
    const seconds = timeoutMs / 1000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}

function normalizeCode(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return normalized || null;
}

function getApiCode(result) {
    return normalizeCode(result?.code || result?.data?.code);
}

function getResultCode(result) {
    return normalizeCode(result?.errorCode || result?.raw?.code);
}

function describeAdminAiError(task, error, code) {
    const normalizedCode = normalizeCode(code);
    const message = String(error || '').trim();

    if (!normalizedCode) {
        return message || `${TASK_UI[task].label} request failed.`;
    }

    switch (normalizedCode) {
    case 'model_not_allowed':
        return message
            ? `${ADMIN_AI_CODE_MESSAGES.model_not_allowed} ${message}`
            : ADMIN_AI_CODE_MESSAGES.model_not_allowed;
    case 'duplicate_models':
        return ADMIN_AI_CODE_MESSAGES.duplicate_models;
    case 'unauthorized':
    case 'forbidden':
    case 'rate_limited':
    case 'upstream_error':
    case 'internal_error':
    case 'bad_request':
    case 'validation_error':
    case 'not_found':
    case 'network_error':
        return message || ADMIN_AI_CODE_MESSAGES[normalizedCode];
    case 'request_timeout':
        return message || ADMIN_AI_CODE_MESSAGES.request_timeout;
    case 'request_aborted':
        return message || ADMIN_AI_CODE_MESSAGES.request_aborted;
    default:
        return message || `${TASK_UI[task].label} request failed.`;
    }
}

function describeCatalogError(error, code) {
    const normalizedCode = normalizeCode(code);
    const message = String(error || '').trim();

    if (!normalizedCode) {
        return message || 'Model catalog unavailable.';
    }

    switch (normalizedCode) {
    case 'unauthorized':
    case 'forbidden':
    case 'rate_limited':
    case 'upstream_error':
    case 'internal_error':
    case 'bad_request':
    case 'validation_error':
    case 'network_error':
    case 'not_found':
        return message || ADMIN_AI_CODE_MESSAGES[normalizedCode] || 'Model catalog unavailable.';
    default:
        return message || 'Model catalog unavailable.';
    }
}

function formatValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

function safeJson(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function truncateText(value, maxLength = 88) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1)}…`;
}

function normalizeCompareText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueCaseInsensitive(items) {
    const seen = new Set();
    return items.filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function splitCompareChunks(value) {
    const text = String(value || '');
    const chunks = text
        .split(/\n+/)
        .flatMap((line) => line.split(/(?<=[.!?])\s+/))
        .map((chunk) => normalizeCompareText(chunk))
        .filter(Boolean);

    return uniqueCaseInsensitive(chunks);
}

function buildCompareDiff(entries) {
    const a = entries?.[0];
    const b = entries?.[1];
    if (!a?.ok || !b?.ok || !a.text || !b.text) {
        return {
            available: false,
            message: 'Difference aid becomes available when both compare outputs succeed.',
        };
    }

    const textA = normalizeCompareText(a.text);
    const textB = normalizeCompareText(b.text);
    const chunksA = splitCompareChunks(a.text);
    const chunksB = splitCompareChunks(b.text);
    const chunkSetB = new Set(chunksB.map((chunk) => chunk.toLowerCase()));
    const chunkSetA = new Set(chunksA.map((chunk) => chunk.toLowerCase()));
    const shared = chunksA.filter((chunk) => chunkSetB.has(chunk.toLowerCase())).slice(0, 4);
    const onlyA = chunksA.filter((chunk) => !chunkSetB.has(chunk.toLowerCase())).slice(0, 4);
    const onlyB = chunksB.filter((chunk) => !chunkSetA.has(chunk.toLowerCase())).slice(0, 4);

    return {
        available: true,
        identical: !!textA && textA === textB,
        charCountA: textA.length,
        charCountB: textB.length,
        shared,
        onlyA,
        onlyB,
    };
}

function slugify(value, fallback = 'result') {
    const slug = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return slug || fallback;
}

function mimeToExtension(mimeType) {
    if (!mimeType) return 'png';
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
    if (mimeType.includes('webp')) return 'webp';
    if (mimeType.includes('gif')) return 'gif';
    return 'bin';
}

function findSample(task, sampleId) {
    return (SAMPLE_LIBRARY[task] || []).find((sample) => sample.id === sampleId) || SAMPLE_LIBRARY[task]?.[0] || null;
}

function setOptions(selectEl, items, placeholder) {
    const current = selectEl.value;
    selectEl.innerHTML = '';

    for (const item of items) {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        selectEl.appendChild(option);
    }

    if (current && items.some((item) => item.value === current)) {
        selectEl.value = current;
    } else if (placeholder) {
        selectEl.value = '';
    }
}

function setText(el, value) {
    el.textContent = value || '';
}

function setBadge(el, text, variant) {
    el.className = `badge badge--${variant}`;
    el.textContent = text;
}

async function copyText(text, showToast, successMessage) {
    if (!text) return;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'absolute';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }
        if (showToast) showToast(successMessage || 'Copied.');
    } catch {
        if (showToast) showToast('Copy failed.', 'error');
    }
}

function getWarnings(result) {
    return Array.isArray(result?.warnings) ? result.warnings : [];
}

function getCatalogModels(catalog, task) {
    return Array.isArray(catalog?.models?.[task]) ? catalog.models[task] : [];
}

function getCatalogPresets(catalog, task) {
    const presets = Array.isArray(catalog?.presets) ? catalog.presets : [];
    return presets.filter((preset) => preset.task === task);
}

function getModelInfo(catalog, task, modelId) {
    return getCatalogModels(catalog, task).find((model) => model.id === modelId) || null;
}

function getModelLabel(catalog, task, modelId) {
    if (!modelId) return 'Preset default';
    const model = getModelInfo(catalog, task, modelId);
    return model ? `${model.label} (${model.id})` : modelId;
}

function buildSaveTitle(seed, fallback) {
    const cleaned = String(seed || '')
        .replace(/\s+/g, ' ')
        .replace(/[\x00-\x1f\x7f]/g, '')
        .trim()
        .slice(0, 120);
    return cleaned || fallback;
}

export function createAdminAiLab({ showToast } = {}) {
    const root = document.getElementById('sectionAiLab');
    if (!root) {
        return {
            init() {},
            show() {},
        };
    }

    const persisted = loadPersisted();

    const state = {
        initialized: false,
        activeMode:
            MODES.includes(persisted?.activeMode) && persisted.activeMode !== 'dashboard'
                ? persisted.activeMode
                : 'models',
        timeouts: resolveRequestTimeouts(globalThis?.BITBI_ADMIN_AI_LAB_TIMEOUTS),
        uiVersion: ADMIN_AI_UI_VERSION,
        forms: mergeForms(persisted?.forms),
        history: mergeHistory(persisted?.history),
        preferences: mergePreferences(persisted?.preferences),
        catalog: {
            status: 'idle',
            data: null,
            error: '',
            loadedAt: null,
        },
        results: {
            text: null,
            image: null,
            embeddings: null,
            compare: null,
        },
        controllers: {
            models: null,
            text: null,
            image: null,
            embeddings: null,
            compare: null,
        },
        timers: {
            text: null,
            image: null,
            embeddings: null,
            compare: null,
        },
        requestSeq: {
            models: 0,
            text: 0,
            image: 0,
            embeddings: 0,
            compare: 0,
        },
        save: {
            open: false,
            task: null,
            type: null,
            intent: null,
            saving: false,
            title: '',
            folderId: '',
            folders: [],
            stateTone: 'neutral',
            stateMessage: 'Ready to save.',
            note: '',
        },
    };

    const refs = {
        status: document.getElementById('aiLabStatus'),
        catalogStamp: document.getElementById('aiLabCatalogStamp'),
        catalogSummary: document.getElementById('aiLabCatalogSummary'),
        refreshBtn: document.getElementById('aiLabRefreshModels'),
        resetBtn: document.getElementById('aiLabResetForm'),
        modeButtons: Array.from(root.querySelectorAll('[data-ai-mode]')),
        panels: {
            models: document.getElementById('aiLabPanelModels'),
            text: document.getElementById('aiLabPanelText'),
            image: document.getElementById('aiLabPanelImage'),
            embeddings: document.getElementById('aiLabPanelEmbeddings'),
            compare: document.getElementById('aiLabPanelCompare'),
            'live-agent': document.getElementById('aiLabPanelLiveAgent'),
        },
        models: {
            presets: document.getElementById('aiModelsPresets'),
            text: document.getElementById('aiModelsText'),
            image: document.getElementById('aiModelsImage'),
            embeddings: document.getElementById('aiModelsEmbeddings'),
            future: document.getElementById('aiModelsFuture'),
        },
        text: {
            preset: document.getElementById('aiTextPreset'),
            model: document.getElementById('aiTextModel'),
            sampleSelect: document.getElementById('aiTextSampleSelect'),
            system: document.getElementById('aiTextSystem'),
            systemCount: document.getElementById('aiTextSystemCount'),
            prompt: document.getElementById('aiTextPrompt'),
            promptCount: document.getElementById('aiTextPromptCount'),
            maxTokens: document.getElementById('aiTextMaxTokens'),
            temperature: document.getElementById('aiTextTemperature'),
            run: document.getElementById('aiTextRun'),
            cancel: document.getElementById('aiTextCancel'),
            sample: document.getElementById('aiTextSample'),
            history: document.getElementById('aiTextPromptHistory'),
            clearHistory: document.getElementById('aiTextHistoryClear'),
            state: document.getElementById('aiTextState'),
            output: document.getElementById('aiTextOutput'),
            meta: document.getElementById('aiTextMeta'),
            warnings: document.getElementById('aiTextWarnings'),
            usage: document.getElementById('aiTextUsage'),
            copy: document.getElementById('aiTextCopy'),
            save: document.getElementById('aiTextSave'),
            debug: document.getElementById('aiTextDebug'),
            raw: document.getElementById('aiTextRaw'),
            copyRaw: document.getElementById('aiTextCopyRaw'),
        },
        image: {
            preset: document.getElementById('aiImagePreset'),
            model: document.getElementById('aiImageModel'),
            sampleSelect: document.getElementById('aiImageSampleSelect'),
            promptMode: document.getElementById('aiImagePromptMode'),
            promptModeField: document.getElementById('aiImagePromptModeField'),
            promptModeHint: document.getElementById('aiImagePromptModeHint'),
            standardPromptField: document.getElementById('aiImageStandardPromptField'),
            prompt: document.getElementById('aiImagePrompt'),
            promptCount: document.getElementById('aiImagePromptCount'),
            structuredPromptField: document.getElementById('aiImageStructuredPromptField'),
            structuredPrompt: document.getElementById('aiImageStructuredPrompt'),
            structuredPromptCount: document.getElementById('aiImageStructuredPromptCount'),
            structuredPromptError: document.getElementById('aiImageStructuredPromptError'),
            width: document.getElementById('aiImageWidth'),
            height: document.getElementById('aiImageHeight'),
            stepsField: document.getElementById('aiImageStepsField'),
            steps: document.getElementById('aiImageSteps'),
            stepsHint: document.getElementById('aiImageStepsHint'),
            seedField: document.getElementById('aiImageSeedField'),
            seed: document.getElementById('aiImageSeed'),
            seedHint: document.getElementById('aiImageSeedHint'),
            guidanceField: document.getElementById('aiImageGuidanceField'),
            guidance: document.getElementById('aiImageGuidance'),
            guidanceHint: document.getElementById('aiImageGuidanceHint'),
            refSection: document.getElementById('aiImageRefSection'),
            refGrid: document.getElementById('aiImageRefGrid'),
            refCount: document.getElementById('aiImageRefCount'),
            refHint: document.getElementById('aiImageRefHint'),
            run: document.getElementById('aiImageRun'),
            cancel: document.getElementById('aiImageCancel'),
            sample: document.getElementById('aiImageSample'),
            history: document.getElementById('aiImagePromptHistory'),
            clearHistory: document.getElementById('aiImageHistoryClear'),
            state: document.getElementById('aiImageState'),
            preview: document.getElementById('aiImagePreview'),
            meta: document.getElementById('aiImageMeta'),
            warnings: document.getElementById('aiImageWarnings'),
            download: document.getElementById('aiImageDownload'),
            save: document.getElementById('aiImageSave'),
            debug: document.getElementById('aiImageDebug'),
            raw: document.getElementById('aiImageRaw'),
            copyRaw: document.getElementById('aiImageCopyRaw'),
        },
        savedAssets: {
            root: document.getElementById('aiLabSavedAssets'),
            galleryFilter: document.getElementById('aiLabAssetsGalleryFilter'),
            folderGrid: document.getElementById('aiLabAssetsFolderGrid'),
            folderBack: document.getElementById('aiLabAssetsFolderBack'),
            folderBackBtn: document.getElementById('aiLabAssetsFolderBackBtn'),
            assetGrid: document.getElementById('aiLabAssetsGrid'),
            galleryMsg: document.getElementById('aiLabAssetsMsg'),
            newFolderBtn: document.getElementById('aiLabAssetsNewFolderBtn'),
            deleteFolderBtn: document.getElementById('aiLabAssetsDeleteFolderBtn'),
            newFolderForm: document.getElementById('aiLabAssetsNewFolderForm'),
            newFolderInput: document.getElementById('aiLabAssetsNewFolderInput'),
            newFolderSave: document.getElementById('aiLabAssetsNewFolderSave'),
            newFolderCancel: document.getElementById('aiLabAssetsNewFolderCancel'),
            deleteFolderForm: document.getElementById('aiLabAssetsDeleteFolderForm'),
            deleteFolderSelect: document.getElementById('aiLabAssetsDeleteFolderSelect'),
            deleteFolderConfirm: document.getElementById('aiLabAssetsDeleteFolderConfirm'),
            deleteFolderCancel: document.getElementById('aiLabAssetsDeleteFolderCancel'),
            selectBtn: document.getElementById('aiLabAssetsSelectBtn'),
            mobileActionsToggle: document.getElementById('aiLabAssetsMobileActionsToggle'),
            mobileActionsMenu: document.getElementById('aiLabAssetsMobileActionsMenu'),
            bulkBar: document.getElementById('aiLabAssetsBulkBar'),
            bulkCount: document.getElementById('aiLabAssetsBulkCount'),
            bulkMove: document.getElementById('aiLabAssetsBulkMove'),
            bulkDelete: document.getElementById('aiLabAssetsBulkDelete'),
            bulkCancel: document.getElementById('aiLabAssetsBulkCancel'),
            bulkMoveForm: document.getElementById('aiLabAssetsBulkMoveForm'),
            bulkMoveSelect: document.getElementById('aiLabAssetsBulkMoveSelect'),
            bulkMoveConfirm: document.getElementById('aiLabAssetsBulkMoveConfirm'),
            bulkMoveCancel: document.getElementById('aiLabAssetsBulkMoveCancel'),
        },
        embeddings: {
            preset: document.getElementById('aiEmbeddingsPreset'),
            model: document.getElementById('aiEmbeddingsModel'),
            sampleSelect: document.getElementById('aiEmbeddingsSampleSelect'),
            input: document.getElementById('aiEmbeddingsInput'),
            inputCount: document.getElementById('aiEmbeddingsInputCount'),
            run: document.getElementById('aiEmbeddingsRun'),
            cancel: document.getElementById('aiEmbeddingsCancel'),
            sample: document.getElementById('aiEmbeddingsSample'),
            history: document.getElementById('aiEmbeddingsPromptHistory'),
            clearHistory: document.getElementById('aiEmbeddingsHistoryClear'),
            state: document.getElementById('aiEmbeddingsState'),
            summary: document.getElementById('aiEmbeddingsSummary'),
            preview: document.getElementById('aiEmbeddingsPreview'),
            meta: document.getElementById('aiEmbeddingsMeta'),
            warnings: document.getElementById('aiEmbeddingsWarnings'),
            save: document.getElementById('aiEmbeddingsSave'),
            debug: document.getElementById('aiEmbeddingsDebug'),
            raw: document.getElementById('aiEmbeddingsRaw'),
            copyRaw: document.getElementById('aiEmbeddingsCopyRaw'),
        },
        compare: {
            modelA: document.getElementById('aiCompareModelA'),
            modelB: document.getElementById('aiCompareModelB'),
            swap: document.getElementById('aiCompareSwap'),
            sampleSelect: document.getElementById('aiCompareSampleSelect'),
            system: document.getElementById('aiCompareSystem'),
            systemCount: document.getElementById('aiCompareSystemCount'),
            prompt: document.getElementById('aiComparePrompt'),
            promptCount: document.getElementById('aiComparePromptCount'),
            maxTokens: document.getElementById('aiCompareMaxTokens'),
            temperature: document.getElementById('aiCompareTemperature'),
            run: document.getElementById('aiCompareRun'),
            cancel: document.getElementById('aiCompareCancel'),
            sample: document.getElementById('aiCompareSample'),
            history: document.getElementById('aiComparePromptHistory'),
            clearHistory: document.getElementById('aiCompareHistoryClear'),
            state: document.getElementById('aiCompareState'),
            meta: document.getElementById('aiCompareMeta'),
            warnings: document.getElementById('aiCompareWarnings'),
            cardA: document.getElementById('aiCompareCardA'),
            cardB: document.getElementById('aiCompareCardB'),
            aLabel: document.getElementById('aiCompareALabel'),
            aMeta: document.getElementById('aiCompareAMeta'),
            aText: document.getElementById('aiCompareAText'),
            aUsage: document.getElementById('aiCompareAUsage'),
            aError: document.getElementById('aiCompareAError'),
            aCopy: document.getElementById('aiCompareACopy'),
            aCopyDiff: document.getElementById('aiCompareACopyDiff'),
            bLabel: document.getElementById('aiCompareBLabel'),
            bMeta: document.getElementById('aiCompareBMeta'),
            bText: document.getElementById('aiCompareBText'),
            bUsage: document.getElementById('aiCompareBUsage'),
            bError: document.getElementById('aiCompareBError'),
            bCopy: document.getElementById('aiCompareBCopy'),
            bCopyDiff: document.getElementById('aiCompareBCopyDiff'),
            onlyDifferences: document.getElementById('aiCompareOnlyDifferences'),
            diff: document.getElementById('aiCompareDiff'),
            save: document.getElementById('aiCompareSave'),
            debug: document.getElementById('aiCompareDebug'),
            raw: document.getElementById('aiCompareRaw'),
            copyRaw: document.getElementById('aiCompareCopyRaw'),
        },
        liveAgent: {
            system: document.getElementById('aiLiveAgentSystem'),
            systemCount: document.getElementById('aiLiveAgentSystemCount'),
            transcript: document.getElementById('aiLiveAgentTranscript'),
            input: document.getElementById('aiLiveAgentInput'),
            send: document.getElementById('aiLiveAgentSend'),
            cancel: document.getElementById('aiLiveAgentCancel'),
            clear: document.getElementById('aiLiveAgentClear'),
            save: document.getElementById('aiLiveAgentSave'),
            state: document.getElementById('aiLiveAgentState'),
        },
        saveModal: {
            root: document.getElementById('aiLabSaveModal'),
            closeButtons: Array.from(root.querySelectorAll('[data-ai-save-close]')),
            title: document.getElementById('aiLabSaveTitle'),
            desc: document.getElementById('aiLabSaveDesc'),
            state: document.getElementById('aiLabSaveState'),
            titleField: document.getElementById('aiLabSaveTitleField'),
            input: document.getElementById('aiLabSaveInput'),
            folder: document.getElementById('aiLabSaveFolder'),
            note: document.getElementById('aiLabSaveNote'),
            confirm: document.getElementById('aiLabSaveConfirm'),
            cancel: document.getElementById('aiLabSaveCancel'),
        },
    };

    const savedAssetsBrowser = createSavedAssetsBrowser({
        refs: refs.savedAssets,
        emptyStateMessage: 'No saved assets yet. Save an image or AI Lab result to populate your folders.',
        foldersUnavailableMessage: 'Could not load folders. Showing all saved assets.',
    });

    async function refreshSavedAssetsBrowser() {
        try {
            await savedAssetsBrowser.refresh();
        } catch (error) {
            console.warn('AI Lab saved assets refresh failed:', error);
        }
    }

    function showSavedAssetsBrowser() {
        savedAssetsBrowser.show().catch((error) => {
            console.warn('AI Lab saved assets load failed:', error);
        });
    }

    function persistState() {
        try {
            const formsToStore = JSON.parse(JSON.stringify(state.forms));
            formsToStore.image.referenceImages = [];
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    activeMode: state.activeMode,
                    uiVersion: state.uiVersion,
                    forms: formsToStore,
                    history: state.history,
                    preferences: state.preferences,
                })
            );
        } catch {
            // Storage can be unavailable in private mode or test contexts.
        }
    }

    function hasCatalog() {
        return !!state.catalog.data;
    }

    function setStatus(message, tone = 'neutral') {
        refs.status.className = `admin-ai__status admin-ai__status--${tone}`;
        refs.status.textContent = message;
    }

    function setResultState(element, tone, message) {
        element.className = `admin-ai__result-state admin-ai__result-state--${tone}`;
        element.textContent = message;
    }

    function setTaskBusy(task, isBusy, busyText, idleText) {
        const buttonRefs = refs[task];
        if (!buttonRefs?.run || !buttonRefs?.cancel) return;
        buttonRefs.run.disabled = !!isBusy;
        buttonRefs.run.textContent = isBusy ? busyText : idleText;
        buttonRefs.cancel.disabled = !isBusy;
    }

    function clearTaskTimer(task, controller = null) {
        const timerEntry = state.timers[task];
        if (!timerEntry) return;
        if (controller && timerEntry.controller !== controller) return;

        clearTimeout(timerEntry.id);
        state.timers[task] = null;
    }

    function startTaskTimer(task, controller) {
        const timeoutMs = state.timeouts[task];
        if (!timeoutMs) return;

        clearTaskTimer(task);
        state.timers[task] = {
            controller,
            id: setTimeout(() => {
                if (state.controllers[task] !== controller || state.results[task]?.status !== 'loading') {
                    return;
                }

                const config = TASK_UI[task];
                const previous = getRetainedResult(task);
                clearTaskTimer(task, controller);
                controller.abort();
                if (state.controllers[task] === controller) {
                    state.controllers[task] = null;
                }

        state.results[task] = {
            status: 'timeout',
            error: `${config.label} request timed out after ${formatTimeoutDuration(timeoutMs)}.`,
            errorCode: 'request_timeout',
            raw: previous.raw,
            debugRaw: previous.raw,
            receivedAt: previous.receivedAt,
        };
                setTaskBusy(task, false, config.busyText, config.idleText);
                setStatus(
                    `${config.label} request timed out after ${formatTimeoutDuration(timeoutMs)}. Retry with the current inputs when ready.`,
                    'timeout'
                );
                renderAll();
            }, timeoutMs),
        };
    }

    function updateCounter(inputEl, outputEl, maxLength, formatter) {
        const value = inputEl.value || '';
        if (formatter) {
            outputEl.textContent = formatter(value);
            return;
        }
        outputEl.textContent = `${value.length} / ${maxLength}`;
    }

    function getRetainedResult(task) {
        const current = state.results[task];
        return {
            raw: current?.raw || null,
            receivedAt: current?.receivedAt || null,
        };
    }

    function renderWarnings(container, warnings) {
        container.innerHTML = '';
        if (!warnings || warnings.length === 0) {
            container.hidden = true;
            return;
        }

        const list = document.createElement('ul');
        list.className = 'admin-ai__warning-list';
        warnings.forEach((warning) => {
            const item = document.createElement('li');
            item.textContent = warning;
            list.appendChild(item);
        });
        container.appendChild(list);
        container.hidden = false;
    }

    function renderMeta(container, entries) {
        container.innerHTML = '';

        entries
            .filter((entry) => entry && entry.value !== undefined && entry.value !== null && entry.value !== '')
            .forEach((entry) => {
                const row = document.createElement('div');
                row.className = 'admin-ai__meta-row';

                const label = document.createElement('span');
                label.className = 'admin-ai__meta-label';
                label.textContent = entry.label;

                const value = document.createElement('span');
                value.className = 'admin-ai__meta-value';
                value.textContent = formatValue(entry.value);

                row.append(label, value);
                container.appendChild(row);
            });
    }

    function renderUsage(container, usage) {
        container.innerHTML = '';
        if (!isObject(usage)) {
            container.hidden = true;
            return;
        }

        const title = document.createElement('div');
        title.className = 'admin-ai__mini-title';
        title.textContent = 'Usage';
        container.appendChild(title);

        const list = document.createElement('div');
        list.className = 'admin-ai__usage-list';
        for (const [key, value] of Object.entries(usage)) {
            const chip = document.createElement('div');
            chip.className = 'admin-ai__usage-chip';
            chip.textContent = `${key}: ${formatValue(value)}`;
            list.appendChild(chip);
        }
        container.appendChild(list);
        container.hidden = false;
    }

    function renderDebug(detailsEl, preEl, rawData) {
        if (!rawData) {
            detailsEl.hidden = true;
            detailsEl.open = false;
            preEl.textContent = '';
            return;
        }
        detailsEl.hidden = false;
        preEl.textContent = safeJson(rawData);
    }

    function populateSampleSelect(selectEl, task) {
        const samples = SAMPLE_LIBRARY[task] || [];
        const current = selectEl.value;
        selectEl.innerHTML = '';

        samples.forEach((sample) => {
            const option = document.createElement('option');
            option.value = sample.id;
            option.textContent = sample.label;
            selectEl.appendChild(option);
        });

        if (current && samples.some((sample) => sample.id === current)) {
            selectEl.value = current;
        } else if (samples[0]) {
            selectEl.value = samples[0].id;
        }
    }

    function addHistoryEntry(task, value) {
        const entry = String(value || '').trim();
        if (!entry) return;

        const next = [entry]
            .concat(state.history[task].filter((item) => item !== entry))
            .slice(0, HISTORY_LIMIT);

        state.history[task] = next;
        persistState();
        renderHistories();
    }

    function clearHistory(task, label) {
        state.history[task] = [];
        persistState();
        renderHistories();
        setStatus(`${label} history cleared.`, 'success');
    }

    function renderHistory(container, clearButton, items, emptyText, onSelect) {
        container.innerHTML = '';
        clearButton.hidden = items.length === 0;

        if (items.length === 0) {
            const empty = document.createElement('span');
            empty.className = 'admin-ai__history-empty';
            empty.textContent = emptyText;
            container.appendChild(empty);
            return;
        }

        items.forEach((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'admin-ai__history-item';
            button.textContent = truncateText(item);
            button.title = item;
            button.addEventListener('click', () => onSelect(item));
            container.appendChild(button);
        });
    }

    function renderHistories() {
        renderHistory(
            refs.text.history,
            refs.text.clearHistory,
            state.history.text,
            'Recent text prompts will appear here.',
            (value) => {
                state.forms.text.prompt = value;
                syncFormInputs();
                persistState();
            }
        );
        renderHistory(
            refs.image.history,
            refs.image.clearHistory,
            state.history.image,
            'Recent image prompts will appear here.',
            (value) => {
                state.forms.image.prompt = value;
                syncFormInputs();
                persistState();
            }
        );
        renderHistory(
            refs.embeddings.history,
            refs.embeddings.clearHistory,
            state.history.embeddings,
            'Recent embedding inputs will appear here.',
            (value) => {
                state.forms.embeddings.input = value;
                syncFormInputs();
                persistState();
            }
        );
        renderHistory(
            refs.compare.history,
            refs.compare.clearHistory,
            state.history.compare,
            'Recent compare prompts will appear here.',
            (value) => {
                state.forms.compare.prompt = value;
                syncFormInputs();
                persistState();
            }
        );
    }

    function setSaveState(tone, message) {
        state.save.stateTone = tone;
        state.save.stateMessage = message;
    }

    function renderSaveFolderOptions() {
        const current = state.save.folderId || '';
        refs.saveModal.folder.innerHTML = '<option value="">Assets</option>';
        state.save.folders.forEach((folder) => {
            const option = document.createElement('option');
            option.value = folder.id;
            option.textContent = folder.name;
            refs.saveModal.folder.appendChild(option);
        });
        refs.saveModal.folder.value = current;
    }

    function renderSaveModal() {
        const modal = refs.saveModal.root;
        const isOpen = !!state.save.open;
        modal.hidden = !isOpen;
        modal.setAttribute('aria-hidden', String(!isOpen));
        if (!isOpen) return;

        const intent = state.save.intent;
        const isImage = intent?.type === 'image';

        refs.saveModal.title.textContent = intent?.modalTitle || 'Save Asset';
        refs.saveModal.desc.textContent = intent?.description || 'Save the current AI Lab result.';
        refs.saveModal.titleField.hidden = isImage;
        refs.saveModal.input.value = state.save.title || '';
        refs.saveModal.input.disabled = state.save.saving || isImage;
        refs.saveModal.folder.disabled = state.save.saving;
        refs.saveModal.note.textContent = state.save.note || '';
        refs.saveModal.confirm.disabled = state.save.saving;
        refs.saveModal.confirm.textContent = state.save.saving
            ? 'Saving...'
            : (intent?.confirmLabel || 'Save');
        setResultState(refs.saveModal.state, state.save.stateTone, state.save.stateMessage);
        renderSaveFolderOptions();
    }

    function closeSaveModal() {
        if (!state.save.open) return;
        if (state.save.saving) return;
        state.save.open = false;
        state.save.task = null;
        state.save.type = null;
        state.save.intent = null;
        state.save.saving = false;
        state.save.title = '';
        state.save.folderId = '';
        state.save.note = '';
        setSaveState('neutral', 'Ready to save.');
        renderSaveModal();
    }

    async function loadSaveFolders() {
        const result = await apiAiGetFolders();
        state.save.folders = Array.isArray(result?.folders) ? result.folders : [];
    }

    function getTextSaveIntent() {
        const response = state.results.text?.raw;
        const result = response?.result;
        if (!result?.text) return null;
        return {
            type: 'text',
            sourceModule: 'text',
            modalTitle: 'Save Text Result',
            description: 'Save the current text run as a UTF-8 .txt file in your existing Image Studio folder structure.',
            confirmLabel: 'Save Text',
            defaultTitle: buildSaveTitle(state.forms.text.prompt, 'AI Lab Text'),
            note: 'The auth worker serializes the final .txt server-side and stores it beside your images.',
            payload: {
                preset: response?.preset || null,
                model: response?.model || null,
                system: state.forms.text.system || '',
                prompt: state.forms.text.prompt || '',
                output: result.text,
                maxTokens: result.maxTokens,
                temperature: result.temperature,
                usage: result.usage || null,
                warnings: getWarnings(response),
                elapsedMs: response?.elapsedMs || null,
                receivedAt: state.results.text?.receivedAt instanceof Date
                    ? state.results.text.receivedAt.toISOString()
                    : null,
            },
        };
    }

    function getImageSaveIntent() {
        const response = state.results.image?.raw;
        const result = response?.result;
        if (!result?.imageBase64) return null;
        return {
            type: 'image',
            modalTitle: 'Save Image',
            description: 'Save the current image with the same folder logic and backend path used by the existing Image Studio.',
            confirmLabel: 'Save Image',
            defaultTitle: buildSaveTitle(state.forms.image.prompt, 'AI Lab Image'),
            note: 'The existing image save endpoint generates the final filename automatically. Only the folder selection is required here.',
            payload: {
                imageData: `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`,
                prompt: response?.prompt || state.forms.image.prompt || '',
                model: response?.model?.id || state.forms.image.model || '',
                steps: result.steps,
                seed: result.seed,
                guidance: result.guidance,
            },
        };
    }

    function getEmbeddingsSaveIntent() {
        const response = state.results.embeddings?.raw;
        const result = response?.result;
        if (!Array.isArray(result?.vectors) || result.vectors.length === 0) return null;
        const inputItems = (state.forms.embeddings.input || '')
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter(Boolean);
        return {
            type: 'text',
            sourceModule: 'embeddings',
            modalTitle: 'Save Embeddings Result',
            description: 'Save the current embeddings run as a structured .txt file in your existing folder structure.',
            confirmLabel: 'Save Embeddings',
            defaultTitle: buildSaveTitle(inputItems[0] || 'AI Lab Embeddings', 'AI Lab Embeddings'),
            note: 'Vectors are serialized server-side into a plain-text file with bounded metadata and the recorded vector output.',
            payload: {
                preset: response?.preset || null,
                model: response?.model || null,
                inputItems,
                vectors: result.vectors,
                dimensions: result.dimensions,
                count: result.count,
                shape: Array.isArray(result.shape) ? result.shape : null,
                pooling: result.pooling || null,
                warnings: getWarnings(response),
                elapsedMs: response?.elapsedMs || null,
                receivedAt: state.results.embeddings?.receivedAt instanceof Date
                    ? state.results.embeddings.receivedAt.toISOString()
                    : null,
            },
        };
    }

    function getCompareSaveIntent() {
        const response = state.results.compare?.raw;
        const results = Array.isArray(response?.result?.results) ? response.result.results : [];
        if (results.length === 0) return null;
        const diff = buildCompareDiff(results);
        return {
            type: 'text',
            sourceModule: 'compare',
            modalTitle: 'Save Compare Result',
            description: 'Save the current compare run as a structured .txt file with both model outputs and the existing difference aid summary.',
            confirmLabel: 'Save Compare',
            defaultTitle: buildSaveTitle(state.forms.compare.prompt, 'AI Lab Compare'),
            note: 'The saved file includes the shared prompt, per-model outputs, warnings, and the compare difference summary.',
            payload: {
                prompt: state.forms.compare.prompt || '',
                system: state.forms.compare.system || '',
                maxTokens: response?.result?.maxTokens || null,
                temperature: response?.result?.temperature || null,
                elapsedMs: response?.elapsedMs || null,
                receivedAt: state.results.compare?.receivedAt instanceof Date
                    ? state.results.compare.receivedAt.toISOString()
                    : null,
                warnings: getWarnings(response),
                diffSummary: diff.available ? diff : null,
                results,
            },
        };
    }

    function getLiveAgentSaveIntent() {
        if (!Array.isArray(liveAgentState.messages) || liveAgentState.messages.length === 0) return null;
        const lastAssistant = [...liveAgentState.messages].reverse().find((entry) => entry.role === 'assistant');
        const lastUser = [...liveAgentState.messages].reverse().find((entry) => entry.role === 'user');
        return {
            type: 'text',
            sourceModule: 'live_agent',
            modalTitle: 'Save Live Agent Transcript',
            description: 'Save the current live-agent transcript as a structured .txt file in your existing folder structure.',
            confirmLabel: 'Save Transcript',
            defaultTitle: buildSaveTitle(lastUser?.content || 'AI Lab Live Agent', 'AI Lab Live Agent'),
            note: 'The transcript is serialized server-side as plain text with the system prompt, ordered messages, and final assistant response.',
            payload: {
                model: LIVE_AGENT_MODEL,
                system: refs.liveAgent.system.value || '',
                transcript: liveAgentState.messages.map((entry) => ({
                    role: entry.role,
                    content: entry.content,
                })),
                finalResponse: lastAssistant?.content || '',
                receivedAt: new Date().toISOString(),
            },
        };
    }

    function getSaveIntent(task) {
        switch (task) {
        case 'text':
            return getTextSaveIntent();
        case 'image':
            return getImageSaveIntent();
        case 'embeddings':
            return getEmbeddingsSaveIntent();
        case 'compare':
            return getCompareSaveIntent();
        case 'live-agent':
            return getLiveAgentSaveIntent();
        default:
            return null;
        }
    }

    async function openSaveModal(task) {
        const intent = getSaveIntent(task);
        if (!intent) {
            if (showToast) showToast('Nothing available to save yet.', 'error');
            return;
        }

        state.save.open = true;
        state.save.task = task;
        state.save.type = intent.type;
        state.save.intent = intent;
        state.save.saving = false;
        state.save.title = intent.defaultTitle || '';
        state.save.folderId = '';
        state.save.note = intent.note || '';
        setSaveState('loading', 'Loading folders...');
        renderSaveModal();

        try {
            await loadSaveFolders();
            setSaveState('neutral', 'Choose a folder and confirm the save.');
        } catch {
            state.save.folders = [];
            setSaveState('error', 'Folder list unavailable. You can still save to Assets.');
        }

        renderSaveModal();
        if (intent.type === 'image') {
            refs.saveModal.folder.focus();
        } else {
            refs.saveModal.input.focus();
            refs.saveModal.input.select();
        }
    }

    async function confirmSaveModal() {
        const intent = state.save.intent;
        if (!state.save.open || !intent || state.save.saving) return;

        if (intent.type !== 'image' && !(state.save.title || '').trim()) {
            setSaveState('error', 'Title is required.');
            renderSaveModal();
            return;
        }

        state.save.saving = true;
        setSaveState('loading', 'Saving asset...');
        renderSaveModal();

        try {
            if (intent.type === 'image') {
                const res = await apiAiSaveImage(
                    intent.payload.imageData,
                    intent.payload.prompt,
                    intent.payload.model,
                    intent.payload.steps,
                    intent.payload.seed,
                    state.save.folderId || null,
                );

                if (!res.ok) {
                    setSaveState('error', res.error || 'Image save failed.');
                    state.save.saving = false;
                    renderSaveModal();
                    return;
                }

                state.save.saving = false;
                closeSaveModal();
                await refreshSavedAssetsBrowser();
                setStatus('Image saved to the shared folder structure.', 'success');
                if (showToast) showToast('Image saved.');
                return;
            }

            const res = await apiAdminAiSaveTextAsset({
                title: state.save.title,
                folderId: state.save.folderId || null,
                sourceModule: intent.sourceModule,
                data: intent.payload,
            });

            if (!res.ok) {
                setSaveState('error', res.error || 'Save failed.');
                state.save.saving = false;
                renderSaveModal();
                return;
            }

            state.save.saving = false;
            closeSaveModal();
            await refreshSavedAssetsBrowser();
            setStatus('Text asset saved to the shared folder structure.', 'success');
            if (showToast) showToast('Text asset saved.');
        } catch {
            setSaveState('error', 'Save failed. Please try again.');
            state.save.saving = false;
            renderSaveModal();
        }
    }

    function downloadImageResult() {
        const response = state.results.image?.raw;
        const payload = response?.result;
        if (!payload?.imageBase64) {
            if (showToast) showToast('No image available to download.', 'error');
            return;
        }

        const mimeType = payload.mimeType || 'image/png';
        const extension = mimeToExtension(mimeType);
        const dateStamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = [
            'ai-lab',
            'image',
            slugify(response?.preset || 'preset'),
            slugify(response?.model?.label || response?.model?.id || 'model'),
            slugify(state.forms.image.prompt || 'prompt'),
            dateStamp,
        ].join('-') + `.${extension}`;

        const bytes = Uint8Array.from(atob(payload.imageBase64), (char) => char.charCodeAt(0));
        const blob = new Blob([bytes], { type: mimeType });
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
        if (showToast) showToast('Image download started.');
    }

    function renderCatalogList(container, items, emptyMessage) {
        container.innerHTML = '';
        if (!items || items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'admin-shell__empty';
            empty.innerHTML = `<span class="admin-shell__empty-icon" aria-hidden="true">&#9888;</span><span>${emptyMessage}</span>`;
            container.appendChild(empty);
            return;
        }

        const list = document.createElement('div');
        list.className = 'admin-inventory';
        items.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'admin-inventory__row admin-ai__catalog-row';

            const main = document.createElement('div');
            main.className = 'admin-ai__catalog-main';

            const name = document.createElement('div');
            name.className = 'admin-inventory__name';
            name.textContent = item.label || item.name || item.id;

            const desc = document.createElement('div');
            desc.className = 'admin-ai__catalog-desc';
            desc.textContent = item.description || item.id || '';

            main.append(name, desc);

            const meta = document.createElement('div');
            meta.className = 'admin-ai__catalog-meta';
            meta.innerHTML = '';

            const code = document.createElement('code');
            code.className = 'admin-ai__catalog-code';
            code.textContent = item.model || item.id || '';

            const vendor = document.createElement('span');
            vendor.className = 'admin-inventory__meta';
            vendor.textContent = item.vendor || item.task || '';

            meta.append(code, vendor);
            row.append(main, meta);
            list.appendChild(row);
        });
        container.appendChild(list);
    }

    function getSelectedImageModelCapabilities() {
        const modelId = state.forms.image.model;
        if (!modelId || !hasCatalog()) {
            return {
                supportsSeed: true,
                supportsSteps: true,
                supportsDimensions: false,
                supportsGuidance: false,
                supportsStructuredPrompt: false,
                supportsReferenceImages: false,
                maxReferenceImages: 0,
                maxSteps: 8,
                defaultSteps: 4,
                minGuidance: null,
                maxGuidance: null,
                defaultGuidance: null,
            };
        }
        const model = getModelInfo(state.catalog.data, 'image', modelId);
        if (!model?.capabilities) {
            return {
                supportsSeed: true,
                supportsSteps: true,
                supportsDimensions: false,
                supportsGuidance: false,
                supportsStructuredPrompt: false,
                supportsReferenceImages: false,
                maxReferenceImages: 0,
                maxSteps: 8,
                defaultSteps: 4,
                minGuidance: null,
                maxGuidance: null,
                defaultGuidance: null,
            };
        }
        return model.capabilities;
    }

    function setFieldDisabled(fieldEl, inputEl, isDisabled, hintEl, hintText) {
        if (fieldEl) {
            fieldEl.classList.toggle('admin-ai__field--disabled', isDisabled);
        }
        if (inputEl) {
            inputEl.disabled = isDisabled;
        }
        if (hintEl) {
            hintEl.hidden = !isDisabled;
            if (isDisabled && hintText) hintEl.textContent = hintText;
        }
    }

    function updateImageCapabilityControls() {
        const caps = getSelectedImageModelCapabilities();

        setFieldDisabled(
            refs.image.stepsField,
            refs.image.steps,
            !caps.supportsSteps,
            refs.image.stepsHint,
            'Not supported by this model.'
        );
        if (caps.supportsSteps && caps.maxSteps) {
            refs.image.steps.max = caps.maxSteps;
        } else {
            refs.image.steps.max = 8;
        }

        setFieldDisabled(
            refs.image.seedField,
            refs.image.seed,
            !caps.supportsSeed,
            refs.image.seedHint,
            'Not supported by this model.'
        );

        setFieldDisabled(
            refs.image.guidanceField,
            refs.image.guidance,
            !caps.supportsGuidance,
            refs.image.guidanceHint,
            'Not supported by this model.'
        );

        const promptModeDisabled = !caps.supportsStructuredPrompt;
        setFieldDisabled(
            refs.image.promptModeField,
            refs.image.promptMode,
            promptModeDisabled,
            refs.image.promptModeHint,
            'Current model does not support structured prompts.'
        );
        if (promptModeDisabled && state.forms.image.promptMode === 'structured') {
            state.forms.image.promptMode = 'standard';
            refs.image.promptMode.value = 'standard';
        }
        updateImagePromptMode();

        const refDisabled = !caps.supportsReferenceImages;
        refs.image.refSection.classList.toggle('admin-ai__ref-images--disabled', refDisabled);
        refs.image.refHint.hidden = !refDisabled;
        if (refDisabled) {
            refs.image.refHint.textContent = 'Current model does not support reference images.';
        }
        const maxRef = caps.maxReferenceImages || 4;
        refs.image.refCount.textContent = `${state.forms.image.referenceImages.length} / ${maxRef}`;
        updateRefSlots();
    }

    function updateImagePromptMode() {
        const isStructured = state.forms.image.promptMode === 'structured';
        refs.image.standardPromptField.hidden = isStructured;
        refs.image.structuredPromptField.hidden = !isStructured;
        refs.image.structuredPromptError.hidden = true;
    }

    function validateStructuredPrompt() {
        const value = (state.forms.image.structuredPrompt || '').trim();
        if (!value) {
            refs.image.structuredPromptError.hidden = true;
            return true;
        }
        try {
            const parsed = JSON.parse(value);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                refs.image.structuredPromptError.textContent = 'Must be a JSON object (not array or primitive).';
                refs.image.structuredPromptError.hidden = false;
                return false;
            }
            refs.image.structuredPromptError.hidden = true;
            return true;
        } catch (error) {
            refs.image.structuredPromptError.textContent = `Invalid JSON: ${error.message}`;
            refs.image.structuredPromptError.hidden = false;
            return false;
        }
    }

    function fileToDataUri(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file.'));
            reader.readAsDataURL(file);
        });
    }

    function loadImageDimensions(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                resolve({
                    width: Number(img.naturalWidth || img.width || 0),
                    height: Number(img.naturalHeight || img.height || 0),
                });
            };
            img.onerror = () => reject(new Error('Failed to inspect image dimensions.'));
            img.src = src;
        });
    }

    async function loadFileImageDimensions(file) {
        const objectUrl = URL.createObjectURL(file);
        try {
            return await loadImageDimensions(objectUrl);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    function getFlux2DevReferenceImageError(dimensions, index) {
        const width = Number(dimensions?.width);
        const height = Number(dimensions?.height);
        const label = typeof index === 'number' ? `Reference image ${index + 1}` : 'Reference image';
        if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
            return `${label} dimensions could not be read.`;
        }
        if (
            width >= FLUX_2_DEV_REFERENCE_IMAGE_MAX_DIMENSION_EXCLUSIVE ||
            height >= FLUX_2_DEV_REFERENCE_IMAGE_MAX_DIMENSION_EXCLUSIVE
        ) {
            return `${label} must be smaller than 512x512 for FLUX.2 Dev. Received ${width}x${height}.`;
        }
        return '';
    }

    async function validateFlux2DevReferenceImagesClient(referenceImages) {
        if (state.forms.image.model !== FLUX_2_DEV_MODEL_ID || !Array.isArray(referenceImages) || referenceImages.length === 0) {
            return '';
        }

        for (let i = 0; i < referenceImages.length; i++) {
            const dataUri = referenceImages[i];
            if (!dataUri) continue;
            try {
                const dimensions = await loadImageDimensions(dataUri);
                const error = getFlux2DevReferenceImageError(dimensions, i);
                if (error) return error;
            } catch {
                return `Reference image ${i + 1} dimensions could not be read.`;
            }
        }

        return '';
    }

    function updateRefSlots() {
        const caps = getSelectedImageModelCapabilities();
        const maxRef = caps.maxReferenceImages || 4;
        const disabled = !caps.supportsReferenceImages;
        const images = state.forms.image.referenceImages;

        refs.image.refCount.textContent = `${images.length} / ${maxRef}`;

        for (let i = 0; i < 4; i++) {
            const slot = refs.image.refGrid.querySelector(`.admin-ai__ref-slot[data-ref-index="${i}"]`);
            if (!slot) continue;
            const addBtn = slot.querySelector('.admin-ai__ref-add');
            const preview = slot.querySelector('.admin-ai__ref-preview');
            const thumb = preview?.querySelector('.admin-ai__ref-thumb');

            if (images[i]) {
                addBtn.hidden = true;
                preview.hidden = false;
                if (thumb) thumb.src = images[i];
            } else {
                addBtn.hidden = false;
                preview.hidden = true;
                if (thumb) thumb.src = '';
                addBtn.disabled = disabled || images.length >= maxRef;
            }
        }
    }

    async function handleRefFileSelect(index, file) {
        if (!file || !file.type.startsWith('image/')) return;
        const caps = getSelectedImageModelCapabilities();
        const maxRef = caps.maxReferenceImages || 4;
        if (state.forms.image.referenceImages.length >= maxRef) return;

        try {
            if (state.forms.image.model === FLUX_2_DEV_MODEL_ID) {
                const dimensions = await loadFileImageDimensions(file);
                const error = getFlux2DevReferenceImageError(dimensions, index);
                if (error) {
                    setStatus(error, 'error');
                    if (showToast) showToast(error, 'error');
                    return;
                }
            }

            const dataUri = await fileToDataUri(file);
            if (state.forms.image.referenceImages.length < maxRef) {
                state.forms.image.referenceImages[index] = dataUri;
                updateRefSlots();
                persistState();
            }
        } catch {
            setStatus('Failed to read the image file.', 'error');
            if (showToast) showToast('Failed to read the image file.', 'error');
        }
    }

    function removeRefImage(index) {
        state.forms.image.referenceImages.splice(index, 1);
        updateRefSlots();
        persistState();
    }

    function normalizeFormSelections() {
        if (!hasCatalog()) return;

        const textPresets = getCatalogPresets(state.catalog.data, 'text').map((item) => item.name);
        const imagePresets = getCatalogPresets(state.catalog.data, 'image').map((item) => item.name);
        const embeddingPresets = getCatalogPresets(state.catalog.data, 'embeddings').map((item) => item.name);

        if (!textPresets.includes(state.forms.text.preset)) state.forms.text.preset = textPresets[0] || 'balanced';
        if (!imagePresets.includes(state.forms.image.preset)) state.forms.image.preset = imagePresets[0] || 'image_fast';
        if (!embeddingPresets.includes(state.forms.embeddings.preset)) {
            state.forms.embeddings.preset = embeddingPresets[0] || 'embedding_default';
        }

        const textIds = getCatalogModels(state.catalog.data, 'text').map((item) => item.id);
        const imageIds = getCatalogModels(state.catalog.data, 'image').map((item) => item.id);
        const embeddingIds = getCatalogModels(state.catalog.data, 'embeddings').map((item) => item.id);

        if (state.forms.text.model && !textIds.includes(state.forms.text.model)) state.forms.text.model = '';
        if (state.forms.image.model && !imageIds.includes(state.forms.image.model)) state.forms.image.model = '';
        if (state.forms.embeddings.model && !embeddingIds.includes(state.forms.embeddings.model)) {
            state.forms.embeddings.model = '';
        }

        if (!textIds.includes(state.forms.compare.modelA)) state.forms.compare.modelA = textIds[0] || '';
        if (!textIds.includes(state.forms.compare.modelB)) {
            state.forms.compare.modelB = textIds.find((id) => id !== state.forms.compare.modelA) || textIds[0] || '';
        }
        if (state.forms.compare.modelA === state.forms.compare.modelB) {
            state.forms.compare.modelB = textIds.find((id) => id !== state.forms.compare.modelA) || state.forms.compare.modelB;
        }
    }

    function populateSelects() {
        const catalog = state.catalog.data;

        const readyPlaceholder = [{ value: '', label: 'Use preset default' }];
        const loadingPreset = [{ value: '', label: 'Loading presets...' }];
        const loadingModel = [{ value: '', label: 'Loading models...' }];

        if (!catalog) {
            setOptions(refs.text.preset, loadingPreset);
            setOptions(refs.image.preset, loadingPreset);
            setOptions(refs.embeddings.preset, loadingPreset);
            setOptions(refs.text.model, loadingModel);
            setOptions(refs.image.model, loadingModel);
            setOptions(refs.embeddings.model, loadingModel);
            setOptions(refs.compare.modelA, loadingModel);
            setOptions(refs.compare.modelB, loadingModel);
            return;
        }

        normalizeFormSelections();

        setOptions(
            refs.text.preset,
            getCatalogPresets(catalog, 'text').map((preset) => ({
                value: preset.name,
                label: preset.label || preset.name,
            }))
        );
        refs.text.preset.value = state.forms.text.preset;

        setOptions(
            refs.image.preset,
            getCatalogPresets(catalog, 'image').map((preset) => ({
                value: preset.name,
                label: preset.label || preset.name,
            }))
        );
        refs.image.preset.value = state.forms.image.preset;

        setOptions(
            refs.embeddings.preset,
            getCatalogPresets(catalog, 'embeddings').map((preset) => ({
                value: preset.name,
                label: preset.label || preset.name,
            }))
        );
        refs.embeddings.preset.value = state.forms.embeddings.preset;

        setOptions(
            refs.text.model,
            readyPlaceholder.concat(
                getCatalogModels(catalog, 'text').map((model) => ({
                    value: model.id,
                    label: model.label || model.id,
                }))
            )
        );
        refs.text.model.value = state.forms.text.model || '';

        setOptions(
            refs.image.model,
            readyPlaceholder.concat(
                getCatalogModels(catalog, 'image').map((model) => ({
                    value: model.id,
                    label: model.label || model.id,
                }))
            )
        );
        refs.image.model.value = state.forms.image.model || '';

        setOptions(
            refs.embeddings.model,
            readyPlaceholder.concat(
                getCatalogModels(catalog, 'embeddings').map((model) => ({
                    value: model.id,
                    label: model.label || model.id,
                }))
            )
        );
        refs.embeddings.model.value = state.forms.embeddings.model || '';

        const textModelOptions = getCatalogModels(catalog, 'text').map((model) => ({
            value: model.id,
            label: model.label || model.id,
        }));
        setOptions(refs.compare.modelA, textModelOptions);
        setOptions(refs.compare.modelB, textModelOptions);
        refs.compare.modelA.value = state.forms.compare.modelA;
        refs.compare.modelB.value = state.forms.compare.modelB;
    }

    function syncFormInputs() {
        populateSampleSelect(refs.text.sampleSelect, 'text');
        populateSampleSelect(refs.image.sampleSelect, 'image');
        populateSampleSelect(refs.embeddings.sampleSelect, 'embeddings');
        populateSampleSelect(refs.compare.sampleSelect, 'compare');

        refs.text.system.value = state.forms.text.system;
        refs.text.prompt.value = state.forms.text.prompt;
        refs.text.maxTokens.value = state.forms.text.maxTokens;
        refs.text.temperature.value = state.forms.text.temperature;

        refs.image.prompt.value = state.forms.image.prompt;
        refs.image.promptMode.value = state.forms.image.promptMode || 'standard';
        refs.image.structuredPrompt.value = state.forms.image.structuredPrompt || '';
        refs.image.width.value = state.forms.image.width;
        refs.image.height.value = state.forms.image.height;
        refs.image.steps.value = state.forms.image.steps;
        refs.image.seed.value = state.forms.image.seed;
        refs.image.guidance.value = state.forms.image.guidance;

        refs.embeddings.input.value = state.forms.embeddings.input;

        refs.compare.system.value = state.forms.compare.system;
        refs.compare.prompt.value = state.forms.compare.prompt;
        refs.compare.maxTokens.value = state.forms.compare.maxTokens;
        refs.compare.temperature.value = state.forms.compare.temperature;
        refs.compare.onlyDifferences.checked = state.preferences.compareOnlyDifferences;

        populateSelects();
        updateCounters();
        updateImageCapabilityControls();
        renderHistories();
    }

    function updateCounters() {
        updateCounter(refs.text.system, refs.text.systemCount, 1200);
        updateCounter(refs.text.prompt, refs.text.promptCount, 4000);
        updateCounter(refs.image.prompt, refs.image.promptCount, 2048);
        updateCounter(refs.image.structuredPrompt, refs.image.structuredPromptCount, 8192);
        updateCounter(refs.embeddings.input, refs.embeddings.inputCount, 8000, (value) => {
            const lines = value
                .split(/\r?\n/)
                .map((entry) => entry.trim())
                .filter(Boolean).length;
            return `${lines} item${lines === 1 ? '' : 's'} / ${value.length} chars`;
        });
        updateCounter(refs.compare.system, refs.compare.systemCount, 1200);
        updateCounter(refs.compare.prompt, refs.compare.promptCount, 4000);
    }

    function setMode(mode) {
        if (!MODES.includes(mode)) mode = 'text';
        state.activeMode = mode;
        refs.modeButtons.forEach((button) => {
            const isActive = button.dataset.aiMode === mode;
            button.classList.toggle('admin-ai__mode--active', isActive);
            button.setAttribute('aria-selected', String(isActive));
        });

        Object.entries(refs.panels).forEach(([key, panel]) => {
            panel.hidden = key !== mode;
        });

        persistState();
        renderResetLabel();

        if (mode === 'image') {
            showSavedAssetsBrowser();
        }
    }

    function renderResetLabel() {
        let label;
        if (state.activeMode === 'models') label = 'Refresh View';
        else if (state.activeMode === 'live-agent') label = 'Reset Chat';
        else label = 'Reset Current Form';
        refs.resetBtn.textContent = label;
    }

    function renderCatalogMeta() {
        if (!state.catalog.data) {
            setText(refs.catalogStamp, '');
            setText(refs.catalogSummary, '');
            return;
        }

        const textCount = getCatalogModels(state.catalog.data, 'text').length;
        const imageCount = getCatalogModels(state.catalog.data, 'image').length;
        const embeddingCount = getCatalogModels(state.catalog.data, 'embeddings').length;
        setText(refs.catalogStamp, `Catalog loaded: ${formatTime(state.catalog.loadedAt)}`);
        setText(refs.catalogSummary, `${textCount} text · ${imageCount} image · ${embeddingCount} embeddings`);
    }

    function renderModelsPanel() {
        if (!state.catalog.data) {
            const loadingMessage =
                state.catalog.status === 'error'
                    ? state.catalog.error || 'Model catalog unavailable.'
                    : 'Loading model catalog...';
            renderCatalogList(refs.models.presets, [], loadingMessage);
            renderCatalogList(refs.models.text, [], loadingMessage);
            renderCatalogList(refs.models.image, [], loadingMessage);
            renderCatalogList(refs.models.embeddings, [], loadingMessage);
            renderCatalogList(refs.models.future, [], 'Speech scaffolding not loaded.');
            return;
        }

        renderCatalogList(
            refs.models.presets,
            state.catalog.data.presets || [],
            'No presets returned by the AI lab.'
        );
        renderCatalogList(
            refs.models.text,
            getCatalogModels(state.catalog.data, 'text'),
            'No text models allowlisted.'
        );
        renderCatalogList(
            refs.models.image,
            getCatalogModels(state.catalog.data, 'image'),
            'No image models allowlisted.'
        );
        renderCatalogList(
            refs.models.embeddings,
            getCatalogModels(state.catalog.data, 'embeddings'),
            'No embeddings models allowlisted.'
        );

        const futureItems = [];
        if (isObject(state.catalog.data.future?.speech)) {
            futureItems.push({
                label: state.catalog.data.future.speech.enabled ? 'Speech enabled' : 'Speech scaffold only',
                description: state.catalog.data.future.speech.note || 'Future speech support.',
                id: state.catalog.data.future.speech.enabled ? 'Enabled' : 'Pending',
                vendor: 'Future',
            });
        }
        renderCatalogList(refs.models.future, futureItems, 'No future scaffolding notes.');
    }

    function renderTextResult() {
        const result = state.results.text;
        const response = result?.raw || null;
        const outputText = response?.result?.text || '';
        const resultCode = getResultCode(result);

        refs.text.output.textContent = outputText;
        refs.text.copy.hidden = !outputText;
        refs.text.save.hidden = !outputText;

        renderMeta(refs.text.meta, response ? [
            { label: 'Preset', value: response.preset || 'Preset default' },
            { label: 'Model Label', value: response.model?.label },
            { label: 'Model ID', value: response.model?.id },
            { label: 'Vendor', value: response.model?.vendor },
            { label: 'Elapsed', value: formatElapsed(response.elapsedMs) },
            { label: 'Received', value: formatTime(result?.receivedAt) },
            { label: 'Temperature', value: response.result?.temperature },
            { label: 'Max Tokens', value: response.result?.maxTokens },
        ] : []);
        renderWarnings(refs.text.warnings, response ? getWarnings(response) : []);
        renderUsage(refs.text.usage, response?.result?.usage || null);
        renderDebug(refs.text.debug, refs.text.raw, result?.debugRaw || response);

        if (!result) {
            setResultState(refs.text.state, 'neutral', 'No text run yet.');
            return;
        }

        if (result.status === 'loading') {
            setResultState(
                refs.text.state,
                'loading',
                response ? 'Running text test. Previous result shown below.' : 'Running text test...'
            );
            return;
        }

        if (result.status === 'aborted') {
            setResultState(
                refs.text.state,
                'aborted',
                response ? 'Text request cancelled. Previous result preserved.' : 'Text request cancelled.'
            );
            return;
        }

        if (result.status === 'timeout') {
            setResultState(
                refs.text.state,
                'timeout',
                response
                    ? `${result.error || 'Text request timed out.'} Previous result preserved.`
                    : result.error || 'Text request timed out.'
            );
            return;
        }

        if (result.status === 'error') {
            setResultState(
                refs.text.state,
                'error',
                response
                    ? `${describeAdminAiError('text', result.error, resultCode)} Previous result preserved.`
                    : describeAdminAiError('text', result.error, resultCode)
            );
            return;
        }

        setResultState(refs.text.state, 'success', 'Text response ready.');
    }

    function renderImageResult() {
        const result = state.results.image;
        const response = result?.raw || null;
        const imgPayload = response?.result || {};
        const resultCode = getResultCode(result);

        refs.image.preview.innerHTML = '<div class="admin-ai__empty">Run an image test to see the preview.</div>';
        refs.image.download.hidden = true;
        refs.image.save.hidden = !imgPayload.imageBase64;

        if (imgPayload.imageBase64) {
            const img = document.createElement('img');
            img.className = 'admin-ai__image';
            img.src = `data:${imgPayload.mimeType || 'image/png'};base64,${imgPayload.imageBase64}`;
            img.alt = state.forms.image.prompt || 'AI Lab image result';
            refs.image.preview.innerHTML = '';
            refs.image.preview.appendChild(img);
            refs.image.download.hidden = false;
        } else if (result?.status === 'loading' && !response) {
            refs.image.preview.innerHTML = '<div class="admin-ai__loading"><div class="admin-ai__spinner"></div><span>Waiting for image output...</span></div>';
        } else if (response) {
            refs.image.preview.innerHTML = '<div class="admin-ai__empty">No image base64 returned by the worker.</div>';
        }

        renderMeta(refs.image.meta, response ? [
            { label: 'Preset', value: response.preset || 'Preset default' },
            { label: 'Model Label', value: response.model?.label },
            { label: 'Model ID', value: response.model?.id },
            { label: 'Vendor', value: response.model?.vendor },
            { label: 'Elapsed', value: formatElapsed(response.elapsedMs) },
            { label: 'Received', value: formatTime(result?.receivedAt) },
            { label: 'Mime', value: imgPayload.mimeType },
            { label: 'Prompt Mode', value: imgPayload.promptMode || 'standard' },
            { label: 'Steps', value: imgPayload.steps },
            { label: 'Seed', value: imgPayload.seed },
            { label: 'Guidance', value: imgPayload.guidance },
            { label: 'Ref Images', value: imgPayload.referenceImageCount || null },
            {
                label: 'Requested Size',
                value: imgPayload.requestedSize
                    ? `${imgPayload.requestedSize.width}×${imgPayload.requestedSize.height}`
                    : null,
            },
            {
                label: 'Applied Size',
                value: imgPayload.appliedSize
                    ? `${imgPayload.appliedSize.width}×${imgPayload.appliedSize.height}`
                    : null,
            },
        ] : []);
        renderWarnings(refs.image.warnings, response ? getWarnings(response) : []);
        renderDebug(refs.image.debug, refs.image.raw, result?.debugRaw || response);

        if (!result) {
            setResultState(refs.image.state, 'neutral', 'No image run yet.');
            return;
        }

        if (result.status === 'loading') {
            setResultState(
                refs.image.state,
                'loading',
                response ? 'Generating image. Previous result shown below.' : 'Generating image...'
            );
            return;
        }

        if (result.status === 'aborted') {
            setResultState(
                refs.image.state,
                'aborted',
                response ? 'Image request cancelled. Previous result preserved.' : 'Image request cancelled.'
            );
            return;
        }

        if (result.status === 'timeout') {
            setResultState(
                refs.image.state,
                'timeout',
                response
                    ? `${result.error || 'Image request timed out.'} Previous result preserved.`
                    : result.error || 'Image request timed out.'
            );
            return;
        }

        if (result.status === 'error') {
            setResultState(
                refs.image.state,
                'error',
                response
                    ? `${describeAdminAiError('image', result.error, resultCode)} Previous result preserved.`
                    : describeAdminAiError('image', result.error, resultCode)
            );
            if (!response) {
                refs.image.preview.innerHTML = '<div class="admin-ai__empty">Image generation failed.</div>';
            }
            return;
        }

        setResultState(refs.image.state, 'success', 'Image response ready.');
    }

    function renderEmbeddingsResult() {
        const result = state.results.embeddings;
        const response = result?.raw || null;
        const payload = response?.result || {};
        const resultCode = getResultCode(result);
        const firstVector = Array.isArray(payload.vectors?.[0]) ? payload.vectors[0] : [];
        const preview = firstVector.slice(0, 8).map((value) => Number(value).toFixed(4)).join(', ');
        refs.embeddings.save.hidden = !Array.isArray(payload.vectors) || payload.vectors.length === 0;

        refs.embeddings.summary.textContent = response
            ? `${payload.count || 0} vector${payload.count === 1 ? '' : 's'} returned.`
            : 'Run an embeddings test to inspect the response.';
        refs.embeddings.preview.textContent = preview
            ? `First vector preview: [${preview}${firstVector.length > 8 ? ', …' : ''}]`
            : '';

        renderMeta(refs.embeddings.meta, response ? [
            { label: 'Preset', value: response.preset || 'Preset default' },
            { label: 'Model Label', value: response.model?.label },
            { label: 'Model ID', value: response.model?.id },
            { label: 'Vendor', value: response.model?.vendor },
            { label: 'Elapsed', value: formatElapsed(response.elapsedMs) },
            { label: 'Received', value: formatTime(result?.receivedAt) },
            { label: 'Vectors', value: payload.count },
            { label: 'Dimensions', value: payload.dimensions },
            { label: 'Shape', value: Array.isArray(payload.shape) ? payload.shape.join(' × ') : null },
            { label: 'Pooling', value: payload.pooling },
        ] : []);
        renderWarnings(refs.embeddings.warnings, response ? getWarnings(response) : []);
        renderDebug(refs.embeddings.debug, refs.embeddings.raw, result?.debugRaw || response);

        if (!result) {
            setResultState(refs.embeddings.state, 'neutral', 'No embeddings run yet.');
            return;
        }

        if (result.status === 'loading') {
            setResultState(
                refs.embeddings.state,
                'loading',
                response ? 'Generating embeddings. Previous result shown below.' : 'Generating embeddings...'
            );
            if (!response) refs.embeddings.summary.textContent = 'Waiting for vector response...';
            return;
        }

        if (result.status === 'aborted') {
            setResultState(
                refs.embeddings.state,
                'aborted',
                response ? 'Embeddings request cancelled. Previous result preserved.' : 'Embeddings request cancelled.'
            );
            return;
        }

        if (result.status === 'timeout') {
            setResultState(
                refs.embeddings.state,
                'timeout',
                response
                    ? `${result.error || 'Embeddings request timed out.'} Previous result preserved.`
                    : result.error || 'Embeddings request timed out.'
            );
            return;
        }

        if (result.status === 'error') {
            setResultState(
                refs.embeddings.state,
                'error',
                response
                    ? `${describeAdminAiError('embeddings', result.error, resultCode)} Previous result preserved.`
                    : describeAdminAiError('embeddings', result.error, resultCode)
            );
            if (!response) {
                refs.embeddings.summary.textContent = 'No embeddings response available.';
            }
            return;
        }

        setResultState(refs.embeddings.state, 'success', 'Embeddings response ready.');
        if (!preview) {
            refs.embeddings.preview.textContent = 'No vector preview available.';
        }
    }

    function getCompareCardText(entry, diff, side) {
        const originalText = entry?.text || '';
        if (!state.preferences.compareOnlyDifferences) {
            return originalText;
        }

        if (!entry?.ok || !originalText || !diff?.available) {
            return originalText;
        }

        const uniqueChunks = side === 'a' ? diff.onlyA : diff.onlyB;
        if (uniqueChunks.length > 0) {
            return uniqueChunks.join('\n\n');
        }

        if (diff.identical) {
            return 'No unique phrasing detected in difference-only view. Both outputs normalize to the same text.';
        }

        return 'No unique phrasing detected for this model in difference-only view.';
    }

    function getCompareDifferenceView(entry, diff, side) {
        const originalText = entry?.text || '';
        const emptyCopyMessage = diff?.available
            ? 'No distinctive compare text available to copy.'
            : 'Difference-only copy requires two successful compare outputs.';

        if (!state.preferences.compareOnlyDifferences) {
            return {
                displayText: originalText,
                copyText: '',
                showCopyButton: false,
                copyDisabled: true,
                copyTitle: 'Enable Show Only Differences to copy distinctive text only.',
            };
        }

        if (!entry?.ok || !originalText) {
            return {
                displayText: originalText,
                copyText: '',
                showCopyButton: false,
                copyDisabled: true,
                copyTitle: emptyCopyMessage,
            };
        }

        if (!diff?.available) {
            return {
                displayText: originalText,
                copyText: '',
                showCopyButton: true,
                copyDisabled: true,
                copyTitle: emptyCopyMessage,
            };
        }

        const uniqueChunks = side === 'a' ? diff.onlyA : diff.onlyB;
        if (uniqueChunks.length > 0) {
            const copyText = uniqueChunks.join('\n\n');
            return {
                displayText: copyText,
                copyText,
                showCopyButton: true,
                copyDisabled: false,
                copyTitle: 'Copy only the distinctive compare text.',
            };
        }

        return {
            displayText: getCompareCardText(entry, diff, side),
            copyText: '',
            showCopyButton: true,
            copyDisabled: true,
            copyTitle: emptyCopyMessage,
        };
    }

    function renderCompareCard(cardRefs, entry, options = {}) {
        cardRefs.error.hidden = true;
        cardRefs.usage.hidden = true;
        cardRefs.copy.hidden = true;
        if (cardRefs.copyDiff) {
            cardRefs.copyDiff.hidden = true;
            cardRefs.copyDiff.disabled = true;
            cardRefs.copyDiff.title = '';
        }
        cardRefs.text.textContent = '';

        if (!entry) {
            cardRefs.label.textContent = 'Waiting for run';
            cardRefs.meta.textContent = '';
            cardRefs.error.textContent = '';
            return;
        }

        cardRefs.label.textContent = entry.model?.label || entry.model?.id || 'Model';
        const displayText = options.displayText ?? entry.text ?? '';
        cardRefs.meta.textContent = [
            entry.model?.id || '',
            entry.model?.vendor || '',
            typeof entry.elapsedMs === 'number' ? formatElapsed(entry.elapsedMs) : '',
            entry.text ? `${normalizeCompareText(entry.text).length} chars` : '',
            options.onlyDifferences ? 'differences only' : '',
        ]
            .filter(Boolean)
            .join(' · ');

        if (!entry.ok) {
            cardRefs.error.hidden = false;
            cardRefs.error.textContent = entry.error || 'Model run failed.';
            return;
        }

        cardRefs.text.textContent = displayText;
        cardRefs.copy.hidden = !entry.text;
        if (cardRefs.copyDiff) {
            cardRefs.copyDiff.hidden = !options.copyDiff?.visible;
            cardRefs.copyDiff.disabled = !!options.copyDiff?.disabled;
            cardRefs.copyDiff.title = options.copyDiff?.title || '';
        }

        if (isObject(entry.usage)) {
            cardRefs.usage.hidden = false;
            cardRefs.usage.textContent = Object.entries(entry.usage)
                .map(([key, value]) => `${key}: ${formatValue(value)}`)
                .join(' · ');
        }
    }

    function renderCompareSummaryChip(container, text, variant = '') {
        const chip = document.createElement('div');
        chip.className = `admin-ai__compare-summary-chip${variant ? ` admin-ai__compare-summary-chip--${variant}` : ''}`;
        chip.textContent = text;
        container.appendChild(chip);
    }

    function appendCompareDiffBlock(parent, title, items, emptyText) {
        const block = document.createElement('div');
        block.className = 'admin-ai__diff-block';

        const label = document.createElement('div');
        label.className = 'admin-ai__mini-title';
        label.textContent = title;
        block.appendChild(label);

        const list = document.createElement('div');
        list.className = 'admin-ai__diff-list';

        if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'admin-ai__diff-empty';
            empty.textContent = emptyText;
            list.appendChild(empty);
        } else {
            items.forEach((item) => {
                const row = document.createElement('div');
                row.className = 'admin-ai__diff-item';
                row.textContent = truncateText(item, 220);
                row.title = item;
                list.appendChild(row);
            });
        }

        block.appendChild(list);
        parent.appendChild(block);
    }

    function renderCompareDiff(entries) {
        refs.compare.diff.innerHTML = '';

        if (!entries || entries.length === 0) {
            refs.compare.diff.hidden = true;
            return;
        }

        refs.compare.diff.hidden = false;

        const diff = buildCompareDiff(entries);
        const head = document.createElement('div');
        head.className = 'admin-ai__compare-diff-head';

        const title = document.createElement('div');
        title.className = 'admin-ai__mini-title';
        title.textContent = 'Difference Aid';
        head.appendChild(title);

        if (!diff.available) {
            const note = document.createElement('div');
            note.className = 'admin-ai__diff-note';
            note.textContent = diff.message;
            head.appendChild(note);
            refs.compare.diff.appendChild(head);
            return;
        }

        const summary = document.createElement('div');
        summary.className = 'admin-ai__compare-summary';
        renderCompareSummaryChip(summary, diff.identical ? 'Outputs are identical' : 'Outputs differ', diff.identical ? 'identical' : 'different');
        if (state.preferences.compareOnlyDifferences) {
            renderCompareSummaryChip(summary, 'Only differences view enabled', 'different');
        }
        renderCompareSummaryChip(summary, `Model A: ${diff.charCountA} chars`);
        renderCompareSummaryChip(summary, `Model B: ${diff.charCountB} chars`);
        renderCompareSummaryChip(summary, `${diff.shared.length} shared chunk${diff.shared.length === 1 ? '' : 's'}`);
        renderCompareSummaryChip(summary, `${diff.onlyA.length + diff.onlyB.length} distinctive chunk${diff.onlyA.length + diff.onlyB.length === 1 ? '' : 's'}`);
        head.appendChild(summary);
        refs.compare.diff.appendChild(head);

        const grid = document.createElement('div');
        grid.className = 'admin-ai__diff-grid';
        if (!state.preferences.compareOnlyDifferences) {
            appendCompareDiffBlock(
                grid,
                'Shared Phrasing',
                diff.shared,
                diff.identical ? 'The two outputs normalize to the same text.' : 'No identical sentence-level chunks were found.'
            );
        }
        appendCompareDiffBlock(grid, 'Model A Distinctive', diff.onlyA, 'No unique phrasing detected for model A.');
        appendCompareDiffBlock(grid, 'Model B Distinctive', diff.onlyB, 'No unique phrasing detected for model B.');
        refs.compare.diff.appendChild(grid);
    }

    function renderCompareResult() {
        const result = state.results.compare;
        const response = result?.raw || null;
        const entries = Array.isArray(response?.result?.results) ? response.result.results : [];
        const resultCode = getResultCode(result);
        const diff = buildCompareDiff(entries);
        const viewA = getCompareDifferenceView(entries[0] || null, diff, 'a');
        const viewB = getCompareDifferenceView(entries[1] || null, diff, 'b');
        refs.compare.save.hidden = entries.length === 0;

        renderMeta(refs.compare.meta, response ? [
            { label: 'Elapsed', value: formatElapsed(response.elapsedMs) },
            { label: 'Received', value: formatTime(result?.receivedAt) },
            { label: 'Models', value: entries.length },
            { label: 'Succeeded', value: entries.filter((entry) => entry?.ok).length },
            { label: 'Failed', value: entries.filter((entry) => !entry?.ok).length },
            { label: 'View', value: state.preferences.compareOnlyDifferences ? 'Only differences' : 'Full outputs' },
            { label: 'Temperature', value: response.result?.temperature },
            { label: 'Max Tokens', value: response.result?.maxTokens },
        ] : []);
        renderWarnings(refs.compare.warnings, response ? getWarnings(response) : []);
        renderDebug(refs.compare.debug, refs.compare.raw, result?.debugRaw || response);
        renderCompareCard(
            {
                label: refs.compare.aLabel,
                meta: refs.compare.aMeta,
                text: refs.compare.aText,
                usage: refs.compare.aUsage,
                error: refs.compare.aError,
                copy: refs.compare.aCopy,
                copyDiff: refs.compare.aCopyDiff,
            },
            entries[0] || null,
            {
                displayText: viewA.displayText,
                onlyDifferences: state.preferences.compareOnlyDifferences && diff.available && !!entries[0]?.ok,
                copyDiff: {
                    visible: viewA.showCopyButton,
                    disabled: viewA.copyDisabled,
                    title: viewA.copyTitle,
                },
            }
        );
        renderCompareCard(
            {
                label: refs.compare.bLabel,
                meta: refs.compare.bMeta,
                text: refs.compare.bText,
                usage: refs.compare.bUsage,
                error: refs.compare.bError,
                copy: refs.compare.bCopy,
                copyDiff: refs.compare.bCopyDiff,
            },
            entries[1] || null,
            {
                displayText: viewB.displayText,
                onlyDifferences: state.preferences.compareOnlyDifferences && diff.available && !!entries[1]?.ok,
                copyDiff: {
                    visible: viewB.showCopyButton,
                    disabled: viewB.copyDisabled,
                    title: viewB.copyTitle,
                },
            }
        );
        renderCompareDiff(entries);

        if (!result) {
            setResultState(refs.compare.state, 'neutral', 'No compare run yet.');
            return;
        }

        if (result.status === 'loading') {
            setResultState(
                refs.compare.state,
                'loading',
                response ? 'Running model comparison. Previous result shown below.' : 'Running model comparison...'
            );
            return;
        }

        if (result.status === 'aborted') {
            setResultState(
                refs.compare.state,
                'aborted',
                response ? 'Compare request cancelled. Previous result preserved.' : 'Compare request cancelled.'
            );
            return;
        }

        if (result.status === 'timeout') {
            setResultState(
                refs.compare.state,
                'timeout',
                response
                    ? `${result.error || 'Compare request timed out.'} Previous result preserved.`
                    : result.error || 'Compare request timed out.'
            );
            return;
        }

        if (result.status === 'error') {
            setResultState(
                refs.compare.state,
                'error',
                response
                    ? `${describeAdminAiError('compare', result.error, resultCode)} Previous result preserved.`
                    : describeAdminAiError('compare', result.error, resultCode)
            );
            return;
        }

        setResultState(
            refs.compare.state,
            'success',
            response?.code === 'partial_success'
                ? 'Compare response ready with partial success. Review warnings and per-model errors.'
                : 'Compare response ready.'
        );
    }

    function renderAll() {
        setMode(state.activeMode);
        renderCatalogMeta();
        renderModelsPanel();
        renderTextResult();
        renderImageResult();
        renderEmbeddingsResult();
        renderCompareResult();
        renderSaveModal();
    }

    function setCatalogButtonsDisabled(isDisabled) {
        const noCatalog = !hasCatalog() && isDisabled;
        refs.text.run.disabled = noCatalog || state.results.text?.status === 'loading';
        refs.text.cancel.disabled = state.results.text?.status !== 'loading';
        refs.image.run.disabled = noCatalog || state.results.image?.status === 'loading';
        refs.image.cancel.disabled = state.results.image?.status !== 'loading';
        refs.embeddings.run.disabled = noCatalog || state.results.embeddings?.status === 'loading';
        refs.embeddings.cancel.disabled = state.results.embeddings?.status !== 'loading';
        refs.compare.run.disabled = noCatalog || state.results.compare?.status === 'loading';
        refs.compare.cancel.disabled = state.results.compare?.status !== 'loading';
    }

    function cancelTask(task, label) {
        const controller = state.controllers[task];
        if (!controller || state.results[task]?.status !== 'loading') return;

        const previous = getRetainedResult(task);
        clearTaskTimer(task, controller);
        controller.abort();
        state.controllers[task] = null;
        state.results[task] = {
            status: 'aborted',
            error: 'Request cancelled.',
            errorCode: 'request_aborted',
            raw: previous.raw,
            debugRaw: previous.raw,
            receivedAt: previous.receivedAt,
        };

        const config = TASK_UI[task];
        setTaskBusy(task, false, config.busyText, config.idleText);
        setStatus(`${label} request cancelled.`, 'aborted');
        renderAll();
    }

    async function refreshCatalog(forceStatus) {
        const seq = ++state.requestSeq.models;
        state.controllers.models?.abort();
        state.controllers.models = new AbortController();
        state.catalog.status = 'loading';
        state.catalog.error = '';
        setStatus(forceStatus || 'Loading AI model catalog...', 'loading');
        renderCatalogMeta();
        setCatalogButtonsDisabled(true);
        renderModelsPanel();

        const res = await apiAdminAiModels({ signal: state.controllers.models.signal });
        if (seq !== state.requestSeq.models) return;
        if (res.aborted) return;

        if (!res.ok) {
            state.catalog.status = 'error';
            state.catalog.error = describeCatalogError(res.error || 'Model catalog unavailable.', getApiCode(res));
            setStatus(state.catalog.error, 'error');
            setCatalogButtonsDisabled(false);
            renderModelsPanel();
            return;
        }

        state.catalog.status = 'ready';
        state.catalog.data = res.data || null;
        state.catalog.loadedAt = new Date();
        normalizeFormSelections();
        populateSelects();
        persistState();
        setCatalogButtonsDisabled(false);
        setStatus('AI model catalog loaded.', 'success');
        renderAll();
    }

    async function runText() {
        if (!hasCatalog()) {
            setStatus('Load the model catalog before running a text test.', 'error');
            return;
        }

        addHistoryEntry('text', state.forms.text.prompt);

        const seq = ++state.requestSeq.text;
        clearTaskTimer('text');
        state.controllers.text?.abort();
        const controller = new AbortController();
        const previous = getRetainedResult('text');
        state.controllers.text = controller;
        state.results.text = {
            status: 'loading',
            errorCode: null,
            raw: previous.raw,
            debugRaw: previous.raw,
            receivedAt: previous.receivedAt,
        };
        setTaskBusy('text', true, TASK_UI.text.busyText, TASK_UI.text.idleText);
        setStatus('Running text test...', 'loading');
        renderTextResult();
        startTaskTimer('text', controller);

        const payload = {
            preset: state.forms.text.preset || undefined,
            model: state.forms.text.model || undefined,
            system: state.forms.text.system || undefined,
            prompt: state.forms.text.prompt,
            maxTokens: Number(state.forms.text.maxTokens),
            temperature: Number(state.forms.text.temperature),
        };

        const res = await apiAdminAiTestText(payload, {
            signal: controller.signal,
        });
        if (seq !== state.requestSeq.text) return;
        if (state.controllers.text === controller) {
            state.controllers.text = null;
        }
        clearTaskTimer('text', controller);
        setTaskBusy('text', false, TASK_UI.text.busyText, TASK_UI.text.idleText);

        if (res.aborted) return;
        if (!res.ok) {
            const errorCode = getApiCode(res);
            state.results.text = {
                status: 'error',
                error: res.error,
                errorCode,
                raw: previous.raw,
                debugRaw: res.data || previous.raw,
                receivedAt: previous.receivedAt,
            };
            setStatus(describeAdminAiError('text', res.error, errorCode), 'error');
            renderTextResult();
            return;
        }

        state.results.text = {
            status: 'success',
            errorCode: getApiCode(res),
            raw: res.data,
            debugRaw: res.data,
            receivedAt: new Date(),
        };
        setStatus('Text test completed.', 'success');
        renderTextResult();
    }

    async function runImage() {
        if (!hasCatalog()) {
            setStatus('Load the model catalog before running an image test.', 'error');
            return;
        }

        addHistoryEntry('image', state.forms.image.prompt);

        const seq = ++state.requestSeq.image;
        clearTaskTimer('image');
        state.controllers.image?.abort();
        const controller = new AbortController();
        const previous = getRetainedResult('image');
        state.controllers.image = controller;
        state.results.image = {
            status: 'loading',
            errorCode: null,
            raw: previous.raw,
            debugRaw: previous.raw,
            receivedAt: previous.receivedAt,
        };
        setTaskBusy('image', true, TASK_UI.image.busyText, TASK_UI.image.idleText);
        setStatus('Generating image...', 'loading');
        renderImageResult();
        startTaskTimer('image', controller);

        if (state.forms.image.promptMode === 'structured') {
            if (!validateStructuredPrompt()) {
                setTaskBusy('image', false, TASK_UI.image.busyText, TASK_UI.image.idleText);
                clearTaskTimer('image', controller);
                state.controllers.image = null;
                state.results.image = previous.raw ? {
                    status: 'error',
                    error: 'Structured prompt contains invalid JSON. Fix and retry.',
                    errorCode: 'validation_error',
                    raw: previous.raw,
                    debugRaw: previous.raw,
                    receivedAt: previous.receivedAt,
                } : {
                    status: 'error',
                    error: 'Structured prompt contains invalid JSON. Fix and retry.',
                    errorCode: 'validation_error',
                    raw: null,
                    debugRaw: null,
                    receivedAt: null,
                };
                setStatus('Structured prompt contains invalid JSON.', 'error');
                renderImageResult();
                return;
            }
        }

        const caps = getSelectedImageModelCapabilities();
        const payload = {
            preset: state.forms.image.preset || undefined,
            model: state.forms.image.model || undefined,
            prompt: state.forms.image.prompt,
            width: Number(state.forms.image.width),
            height: Number(state.forms.image.height),
            steps: Number(state.forms.image.steps) || undefined,
        };
        if (state.forms.image.seed !== '') {
            payload.seed = Number(state.forms.image.seed);
        }
        if (caps.supportsGuidance && state.forms.image.guidance !== '') {
            payload.guidance = Number(state.forms.image.guidance);
        }
        if (caps.supportsStructuredPrompt && state.forms.image.promptMode === 'structured') {
            const spValue = (state.forms.image.structuredPrompt || '').trim();
            if (spValue) {
                payload.structuredPrompt = spValue;
            }
        }
        if (caps.supportsReferenceImages && state.forms.image.referenceImages.length > 0) {
            payload.referenceImages = state.forms.image.referenceImages.filter(Boolean);
        }

        const referenceImageError = await validateFlux2DevReferenceImagesClient(payload.referenceImages || []);
        if (referenceImageError) {
            setTaskBusy('image', false, TASK_UI.image.busyText, TASK_UI.image.idleText);
            clearTaskTimer('image', controller);
            state.controllers.image = null;
            state.results.image = previous.raw ? {
                status: 'error',
                error: referenceImageError,
                errorCode: 'validation_error',
                raw: previous.raw,
                debugRaw: previous.raw,
                receivedAt: previous.receivedAt,
            } : {
                status: 'error',
                error: referenceImageError,
                errorCode: 'validation_error',
                raw: null,
                debugRaw: null,
                receivedAt: null,
            };
            setStatus(referenceImageError, 'error');
            renderImageResult();
            return;
        }

        const res = await apiAdminAiTestImage(payload, {
            signal: controller.signal,
        });
        if (seq !== state.requestSeq.image) return;
        if (state.controllers.image === controller) {
            state.controllers.image = null;
        }
        clearTaskTimer('image', controller);
        setTaskBusy('image', false, TASK_UI.image.busyText, TASK_UI.image.idleText);

        if (res.aborted) return;
        if (!res.ok) {
            const errorCode = getApiCode(res);
            state.results.image = {
                status: 'error',
                error: res.error,
                errorCode,
                raw: previous.raw,
                debugRaw: res.data || previous.raw,
                receivedAt: previous.receivedAt,
            };
            setStatus(describeAdminAiError('image', res.error, errorCode), 'error');
            renderImageResult();
            return;
        }

        state.results.image = {
            status: 'success',
            errorCode: getApiCode(res),
            raw: res.data,
            debugRaw: res.data,
            receivedAt: new Date(),
        };
        setStatus('Image test completed.', 'success');
        renderImageResult();
    }

    async function runEmbeddings() {
        if (!hasCatalog()) {
            setStatus('Load the model catalog before running embeddings.', 'error');
            return;
        }

        addHistoryEntry('embeddings', state.forms.embeddings.input);

        const seq = ++state.requestSeq.embeddings;
        clearTaskTimer('embeddings');
        state.controllers.embeddings?.abort();
        const controller = new AbortController();
        const previous = getRetainedResult('embeddings');
        state.controllers.embeddings = controller;
        state.results.embeddings = {
            status: 'loading',
            errorCode: null,
            raw: previous.raw,
            debugRaw: previous.raw,
            receivedAt: previous.receivedAt,
        };
        setTaskBusy('embeddings', true, TASK_UI.embeddings.busyText, TASK_UI.embeddings.idleText);
        setStatus('Generating embeddings...', 'loading');
        renderEmbeddingsResult();
        startTaskTimer('embeddings', controller);

        const input = state.forms.embeddings.input
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter(Boolean);

        const payload = {
            preset: state.forms.embeddings.preset || undefined,
            model: state.forms.embeddings.model || undefined,
            input,
        };

        const res = await apiAdminAiTestEmbeddings(payload, {
            signal: controller.signal,
        });
        if (seq !== state.requestSeq.embeddings) return;
        if (state.controllers.embeddings === controller) {
            state.controllers.embeddings = null;
        }
        clearTaskTimer('embeddings', controller);
        setTaskBusy('embeddings', false, TASK_UI.embeddings.busyText, TASK_UI.embeddings.idleText);

        if (res.aborted) return;
        if (!res.ok) {
            const errorCode = getApiCode(res);
            state.results.embeddings = {
                status: 'error',
                error: res.error,
                errorCode,
                raw: previous.raw,
                debugRaw: res.data || previous.raw,
                receivedAt: previous.receivedAt,
            };
            setStatus(describeAdminAiError('embeddings', res.error, errorCode), 'error');
            renderEmbeddingsResult();
            return;
        }

        state.results.embeddings = {
            status: 'success',
            errorCode: getApiCode(res),
            raw: res.data,
            debugRaw: res.data,
            receivedAt: new Date(),
        };
        setStatus('Embeddings test completed.', 'success');
        renderEmbeddingsResult();
    }

    async function runCompare() {
        if (!hasCatalog()) {
            setStatus('Load the model catalog before running compare.', 'error');
            return;
        }

        if (!state.forms.compare.modelA || !state.forms.compare.modelB) {
            setStatus('Select two compare models before running.', 'error');
            return;
        }

        if (state.forms.compare.modelA === state.forms.compare.modelB) {
            setStatus('Choose two different models for compare mode.', 'error');
            return;
        }

        addHistoryEntry('compare', state.forms.compare.prompt);

        const seq = ++state.requestSeq.compare;
        clearTaskTimer('compare');
        state.controllers.compare?.abort();
        const controller = new AbortController();
        const previous = getRetainedResult('compare');
        state.controllers.compare = controller;
        state.results.compare = {
            status: 'loading',
            errorCode: null,
            raw: previous.raw,
            debugRaw: previous.raw,
            receivedAt: previous.receivedAt,
        };
        setTaskBusy('compare', true, TASK_UI.compare.busyText, TASK_UI.compare.idleText);
        setStatus('Running model comparison...', 'loading');
        renderCompareResult();
        startTaskTimer('compare', controller);

        const payload = {
            models: [state.forms.compare.modelA, state.forms.compare.modelB],
            system: state.forms.compare.system || undefined,
            prompt: state.forms.compare.prompt,
            maxTokens: Number(state.forms.compare.maxTokens),
            temperature: Number(state.forms.compare.temperature),
        };

        const res = await apiAdminAiCompare(payload, {
            signal: controller.signal,
        });
        if (seq !== state.requestSeq.compare) return;
        if (state.controllers.compare === controller) {
            state.controllers.compare = null;
        }
        clearTaskTimer('compare', controller);
        setTaskBusy('compare', false, TASK_UI.compare.busyText, TASK_UI.compare.idleText);

        if (res.aborted) return;
        if (!res.ok) {
            const errorCode = getApiCode(res);
            state.results.compare = {
                status: 'error',
                error: res.error,
                errorCode,
                raw: previous.raw,
                debugRaw: res.data || previous.raw,
                receivedAt: previous.receivedAt,
            };
            setStatus(describeAdminAiError('compare', res.error, errorCode), 'error');
            renderCompareResult();
            return;
        }

        const successCode = getApiCode(res);
        state.results.compare = {
            status: 'success',
            errorCode: successCode,
            raw: res.data,
            debugRaw: res.data,
            receivedAt: new Date(),
        };
        setStatus(
            successCode === 'partial_success'
                ? 'Compare request completed with partial success. Review warnings and per-model errors.'
                : 'Compare request completed.',
            'success'
        );
        renderCompareResult();
    }

    function resetCurrentForm() {
        if (state.activeMode === 'models') {
            renderModelsPanel();
            setStatus('Model catalog view refreshed.', 'success');
            return;
        }

        if (state.activeMode === 'live-agent') {
            liveAgentClear();
            refs.liveAgent.system.value = 'You are a helpful, concise assistant for an admin testing surface. Answer clearly and stay on topic.';
            liveAgentUpdateSystemCount();
            setStatus('Live Agent chat reset.', 'success');
            return;
        }

        const labels = {
            text: 'Text',
            image: 'Image',
            embeddings: 'Embeddings',
            compare: 'Compare',
        };
        if (state.results[state.activeMode]?.status === 'loading') {
            cancelTask(state.activeMode, labels[state.activeMode]);
        }

        const defaults = cloneDefaultForms();
        state.forms[state.activeMode] = defaults[state.activeMode];
        state.results[state.activeMode] = null;
        syncFormInputs();
        renderAll();
        persistState();
        setStatus(`${state.activeMode} form reset.`, 'success');
    }

    function copyCompareDifferences(side) {
        const response = state.results.compare?.raw;
        const entries = Array.isArray(response?.result?.results) ? response.result.results : [];
        const diff = buildCompareDiff(entries);
        const entry = entries[side === 'a' ? 0 : 1] || null;
        const view = getCompareDifferenceView(entry, diff, side);

        if (!view.copyText) {
            if (showToast) showToast(view.copyTitle || 'No distinctive compare text available to copy.', 'error');
            return;
        }

        copyText(view.copyText, showToast, 'Compare differences copied.');
    }

    /* ── Live Agent chat ── */

    const liveAgentState = {
        messages: [],   // { role, content } — the full conversation
        controller: null,
        busy: false,
    };

    function liveAgentSetBusy(busy) {
        liveAgentState.busy = busy;
        refs.liveAgent.send.disabled = busy;
        refs.liveAgent.send.textContent = busy ? 'Sending...' : 'Send';
        refs.liveAgent.cancel.disabled = !busy;
        refs.liveAgent.input.disabled = busy;
        refs.liveAgent.save.disabled = busy || liveAgentState.messages.length === 0;
    }

    function syncLiveAgentSaveButton() {
        refs.liveAgent.save.disabled = liveAgentState.busy || liveAgentState.messages.length === 0;
    }

    function liveAgentAppendBubble(role, content) {
        const el = document.createElement('div');
        el.className = `admin-ai__chat-msg admin-ai__chat-msg--${role}`;
        const roleLabel = document.createElement('span');
        roleLabel.className = 'admin-ai__chat-role';
        roleLabel.textContent = role;
        el.appendChild(roleLabel);
        const textNode = document.createElement('span');
        textNode.textContent = content;
        el.appendChild(textNode);
        refs.liveAgent.transcript.appendChild(el);
        refs.liveAgent.transcript.scrollTop = refs.liveAgent.transcript.scrollHeight;
        syncLiveAgentSaveButton();
        return el;
    }

    function liveAgentSetState(tone, message) {
        setResultState(refs.liveAgent.state, tone, message);
    }

    function liveAgentUpdateSystemCount() {
        const val = refs.liveAgent.system.value || '';
        refs.liveAgent.systemCount.textContent = `${val.length} / 1200`;
    }

    function resizeLiveAgentTextarea(textarea) {
        if (!textarea) return;

        const baseHeight = Number(textarea.dataset.baseHeight || 0);
        textarea.style.height = 'auto';
        const nextHeight = Math.max(textarea.scrollHeight, baseHeight);
        textarea.style.height = `${nextHeight}px`;
    }

    function initLiveAgentTextareaAutosize(textarea) {
        if (!textarea || textarea.dataset.autosizeBound === 'true') return;

        const initialHeight = Math.ceil(textarea.getBoundingClientRect().height);
        if (initialHeight > 0) {
            textarea.dataset.baseHeight = String(initialHeight);
        }

        textarea.addEventListener('input', () => resizeLiveAgentTextarea(textarea));
        textarea.dataset.autosizeBound = 'true';
    }

    async function liveAgentSend() {
        const userText = (refs.liveAgent.input.value || '').trim();
        if (!userText) {
            liveAgentSetState('error', 'Enter a message before sending.');
            return;
        }

        // Build messages array: optional system + conversation history + new user message
        const system = (refs.liveAgent.system.value || '').trim();
        const outMessages = [];
        if (system) {
            outMessages.push({ role: 'system', content: system });
        }
        for (const msg of liveAgentState.messages) {
            outMessages.push({ role: msg.role, content: msg.content });
        }
        outMessages.push({ role: 'user', content: userText });

        // Persist user message locally and render
        liveAgentState.messages.push({ role: 'user', content: userText });
        liveAgentAppendBubble('user', userText);
        refs.liveAgent.input.value = '';
        resizeLiveAgentTextarea(refs.liveAgent.input);
        liveAgentSetBusy(true);
        liveAgentSetState('loading', 'Waiting for response...');

        const controller = new AbortController();
        liveAgentState.controller = controller;

        const res = await apiAdminAiLiveAgent({ messages: outMessages }, { signal: controller.signal });
        if (controller !== liveAgentState.controller) return;

        if (res.aborted) {
            liveAgentSetBusy(false);
            liveAgentSetState('aborted', 'Request cancelled.');
            return;
        }

        if (!res.ok) {
            liveAgentSetBusy(false);
            const code = res.code || '';
            liveAgentSetState('error', ADMIN_AI_CODE_MESSAGES[code] || res.error || 'Live agent request failed.');
            return;
        }

        if (res.stream && res.body) {
            // Stream SSE response
            const assistantBubble = liveAgentAppendBubble('assistant', '');
            const textSpan = assistantBubble.querySelector('span:last-child');
            assistantBubble.classList.add('admin-ai__chat-msg--streaming');
            let fullText = '';

            try {
                const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += value;

                    // Parse SSE lines
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;
                        try {
                            const parsed = JSON.parse(data);
                            const chunk = parsed.choices?.[0]?.delta?.content || '';
                            if (chunk) {
                                fullText += chunk;
                                textSpan.textContent = fullText;
                                refs.liveAgent.transcript.scrollTop = refs.liveAgent.transcript.scrollHeight;
                            }
                        } catch {
                            // Non-JSON SSE line, skip
                        }
                    }
                }
            } catch (e) {
                if (e?.name !== 'AbortError') {
                    liveAgentSetState('error', 'Stream interrupted.');
                }
            }

            assistantBubble.classList.remove('admin-ai__chat-msg--streaming');
            if (fullText) {
                liveAgentState.messages.push({ role: 'assistant', content: fullText });
                liveAgentSetState('success', 'Response received.');
                syncLiveAgentSaveButton();
            } else {
                liveAgentSetState('error', 'Model returned empty response.');
            }
        } else {
            // Non-streaming fallback
            const text = res.data?.result?.text || res.data?.response || '';
            if (text) {
                liveAgentAppendBubble('assistant', text);
                liveAgentState.messages.push({ role: 'assistant', content: text });
                liveAgentSetState('success', 'Response received.');
                syncLiveAgentSaveButton();
            } else {
                liveAgentSetState('error', 'Model returned empty response.');
            }
        }

        liveAgentState.controller = null;
        liveAgentSetBusy(false);
    }

    function liveAgentCancel() {
        if (liveAgentState.controller) {
            liveAgentState.controller.abort();
            liveAgentState.controller = null;
        }
        liveAgentSetBusy(false);
        liveAgentSetState('aborted', 'Request cancelled.');
    }

    function liveAgentClear() {
        liveAgentCancel();
        liveAgentState.messages = [];
        refs.liveAgent.transcript.innerHTML = '';
        liveAgentSetState('neutral', 'Ready.');
        syncLiveAgentSaveButton();
    }

    function attachFieldSync(ref, mode, field, parser) {
        const eventName = ref.tagName === 'SELECT' ? 'change' : 'input';
        ref.addEventListener(eventName, () => {
            state.forms[mode][field] = parser ? parser(ref.value) : ref.value;
            persistState();
            updateCounters();
        });
    }

    function bindEvents() {
        refs.modeButtons.forEach((button) => {
            button.addEventListener('click', () => setMode(button.dataset.aiMode));
        });

        refs.refreshBtn.addEventListener('click', () => refreshCatalog('Refreshing AI model catalog...'));
        refs.resetBtn.addEventListener('click', resetCurrentForm);

        attachFieldSync(refs.text.preset, 'text', 'preset');
        attachFieldSync(refs.text.model, 'text', 'model');
        attachFieldSync(refs.text.system, 'text', 'system');
        attachFieldSync(refs.text.prompt, 'text', 'prompt');
        attachFieldSync(refs.text.maxTokens, 'text', 'maxTokens', (value) => value === '' ? '' : Number(value));
        attachFieldSync(refs.text.temperature, 'text', 'temperature', (value) => value === '' ? '' : Number(value));

        attachFieldSync(refs.image.preset, 'image', 'preset');
        attachFieldSync(refs.image.model, 'image', 'model');
        attachFieldSync(refs.image.prompt, 'image', 'prompt');
        attachFieldSync(refs.image.width, 'image', 'width', (value) => value === '' ? '' : Number(value));
        attachFieldSync(refs.image.height, 'image', 'height', (value) => value === '' ? '' : Number(value));
        attachFieldSync(refs.image.steps, 'image', 'steps', (value) => value === '' ? '' : Number(value));
        attachFieldSync(refs.image.seed, 'image', 'seed');
        attachFieldSync(refs.image.guidance, 'image', 'guidance', (value) => value === '' ? '' : Number(value));
        attachFieldSync(refs.image.structuredPrompt, 'image', 'structuredPrompt');

        refs.image.model.addEventListener('change', () => {
            updateImageCapabilityControls();
        });

        refs.image.promptMode.addEventListener('change', () => {
            state.forms.image.promptMode = refs.image.promptMode.value;
            persistState();
            updateImagePromptMode();
        });

        refs.image.structuredPrompt.addEventListener('input', () => {
            validateStructuredPrompt();
        });

        for (let i = 0; i < 4; i++) {
            const addBtn = refs.image.refGrid.querySelector(`.admin-ai__ref-add[data-ref-index="${i}"]`);
            const fileInput = document.getElementById(`aiImageRef${i}`);
            const removeBtn = refs.image.refGrid.querySelector(`.admin-ai__ref-remove[data-ref-index="${i}"]`);

            if (addBtn && fileInput) {
                addBtn.addEventListener('click', () => fileInput.click());
                fileInput.addEventListener('change', () => {
                    if (fileInput.files?.[0]) {
                        handleRefFileSelect(i, fileInput.files[0]);
                        fileInput.value = '';
                    }
                });
            }
            if (removeBtn) {
                removeBtn.addEventListener('click', () => removeRefImage(i));
            }
        }

        attachFieldSync(refs.embeddings.preset, 'embeddings', 'preset');
        attachFieldSync(refs.embeddings.model, 'embeddings', 'model');
        attachFieldSync(refs.embeddings.input, 'embeddings', 'input');

        attachFieldSync(refs.compare.modelA, 'compare', 'modelA');
        attachFieldSync(refs.compare.modelB, 'compare', 'modelB');
        attachFieldSync(refs.compare.system, 'compare', 'system');
        attachFieldSync(refs.compare.prompt, 'compare', 'prompt');
        attachFieldSync(refs.compare.maxTokens, 'compare', 'maxTokens', (value) => value === '' ? '' : Number(value));
        attachFieldSync(refs.compare.temperature, 'compare', 'temperature', (value) => value === '' ? '' : Number(value));

        refs.text.sample.addEventListener('click', () => {
            const sample = findSample('text', refs.text.sampleSelect.value);
            if (!sample) return;
            state.forms.text.system = sample.system || '';
            state.forms.text.prompt = sample.prompt || '';
            syncFormInputs();
            persistState();
        });
        refs.image.sample.addEventListener('click', () => {
            const sample = findSample('image', refs.image.sampleSelect.value);
            if (!sample) return;
            state.forms.image.prompt = sample.prompt || '';
            syncFormInputs();
            persistState();
        });
        refs.embeddings.sample.addEventListener('click', () => {
            const sample = findSample('embeddings', refs.embeddings.sampleSelect.value);
            if (!sample) return;
            state.forms.embeddings.input = sample.input || '';
            syncFormInputs();
            persistState();
        });
        refs.compare.sample.addEventListener('click', () => {
            const sample = findSample('compare', refs.compare.sampleSelect.value);
            if (!sample) return;
            state.forms.compare.system = sample.system || '';
            state.forms.compare.prompt = sample.prompt || '';
            syncFormInputs();
            persistState();
        });
        refs.compare.onlyDifferences.addEventListener('change', () => {
            state.preferences.compareOnlyDifferences = refs.compare.onlyDifferences.checked;
            persistState();
            renderCompareResult();
        });
        refs.compare.swap.addEventListener('click', () => {
            const current = state.forms.compare.modelA;
            state.forms.compare.modelA = state.forms.compare.modelB;
            state.forms.compare.modelB = current;
            syncFormInputs();
            persistState();
        });

        refs.text.run.addEventListener('click', runText);
        refs.text.cancel.addEventListener('click', () => cancelTask('text', 'Text'));
        refs.image.run.addEventListener('click', runImage);
        refs.image.cancel.addEventListener('click', () => cancelTask('image', 'Image'));
        refs.embeddings.run.addEventListener('click', runEmbeddings);
        refs.embeddings.cancel.addEventListener('click', () => cancelTask('embeddings', 'Embeddings'));
        refs.compare.run.addEventListener('click', runCompare);
        refs.compare.cancel.addEventListener('click', () => cancelTask('compare', 'Compare'));

        refs.text.clearHistory.addEventListener('click', () => clearHistory('text', 'Text'));
        refs.image.clearHistory.addEventListener('click', () => clearHistory('image', 'Image'));
        refs.embeddings.clearHistory.addEventListener('click', () => clearHistory('embeddings', 'Embeddings'));
        refs.compare.clearHistory.addEventListener('click', () => clearHistory('compare', 'Compare'));

        refs.text.copy.addEventListener('click', () => {
            copyText(state.results.text?.raw?.result?.text || '', showToast, 'Text output copied.');
        });
        refs.text.save.addEventListener('click', () => openSaveModal('text'));
        refs.text.copyRaw.addEventListener('click', () => {
            copyText(safeJson(state.results.text?.debugRaw || state.results.text?.raw), showToast, 'Raw JSON copied.');
        });
        refs.image.download.addEventListener('click', downloadImageResult);
        refs.image.save.addEventListener('click', () => openSaveModal('image'));
        refs.image.copyRaw.addEventListener('click', () => {
            copyText(safeJson(state.results.image?.debugRaw || state.results.image?.raw), showToast, 'Raw JSON copied.');
        });
        refs.embeddings.save.addEventListener('click', () => openSaveModal('embeddings'));
        refs.embeddings.copyRaw.addEventListener('click', () => {
            copyText(safeJson(state.results.embeddings?.debugRaw || state.results.embeddings?.raw), showToast, 'Raw JSON copied.');
        });
        refs.compare.save.addEventListener('click', () => openSaveModal('compare'));
        refs.compare.copyRaw.addEventListener('click', () => {
            copyText(safeJson(state.results.compare?.debugRaw || state.results.compare?.raw), showToast, 'Raw JSON copied.');
        });
        refs.compare.aCopy.addEventListener('click', () => {
            copyText(state.results.compare?.raw?.result?.results?.[0]?.text || '', showToast, 'Compare output copied.');
        });
        refs.compare.bCopy.addEventListener('click', () => {
            copyText(state.results.compare?.raw?.result?.results?.[1]?.text || '', showToast, 'Compare output copied.');
        });
        refs.compare.aCopyDiff.addEventListener('click', () => copyCompareDifferences('a'));
        refs.compare.bCopyDiff.addEventListener('click', () => copyCompareDifferences('b'));
        refs.saveModal.input.addEventListener('input', () => {
            state.save.title = refs.saveModal.input.value;
        });
        refs.saveModal.folder.addEventListener('change', () => {
            state.save.folderId = refs.saveModal.folder.value;
        });
        refs.saveModal.confirm.addEventListener('click', confirmSaveModal);
        refs.saveModal.closeButtons.forEach((button) => {
            button.addEventListener('click', closeSaveModal);
        });

        /* Live Agent */
        refs.liveAgent.send.addEventListener('click', liveAgentSend);
        refs.liveAgent.cancel.addEventListener('click', liveAgentCancel);
        refs.liveAgent.clear.addEventListener('click', liveAgentClear);
        refs.liveAgent.save.addEventListener('click', () => openSaveModal('live-agent'));
        refs.liveAgent.system.addEventListener('input', liveAgentUpdateSystemCount);
        refs.liveAgent.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !liveAgentState.busy) {
                e.preventDefault();
                liveAgentSend();
            }
        });
        refs.saveModal.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !state.save.saving && state.save.intent?.type !== 'image') {
                e.preventDefault();
                confirmSaveModal();
            }
        });
        initLiveAgentTextareaAutosize(refs.liveAgent.system);
        initLiveAgentTextareaAutosize(refs.liveAgent.input);
    }

    return {
        init() {
            if (state.initialized) return;
            state.initialized = true;
            bindEvents();
            syncFormInputs();
            liveAgentUpdateSystemCount();
            syncLiveAgentSaveButton();
            renderAll();
        },

        show() {
            this.init();
            setMode(state.activeMode);
            if (state.catalog.status === 'idle') {
                refreshCatalog();
            } else {
                renderAll();
            }
        },
    };
}
