import {
    apiAiGetFolders,
    apiAiSaveAudio,
    apiAiSaveImage,
    apiAdminAiCompare,
    apiAdminAiLiveAgent,
    apiAdminAiModels,
    apiAdminAiSaveTextAsset,
    apiAdminAiTestEmbeddings,
    apiAdminAiTestImage,
    apiAdminAiTestMusic,
    apiAdminAiTestText,
    apiAdminAiTestVideo,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    ADMIN_AI_DEFAULT_COMPARE_MODELS,
    ADMIN_AI_DEFAULT_PRESETS,
    ADMIN_AI_IMAGE_CAPABILITY_FALLBACK,
    ADMIN_AI_LIMITS,
    ADMIN_AI_LIVE_AGENT_MODEL,
    ADMIN_AI_MUSIC_KEYS,
    ADMIN_AI_VIDEO_MODEL_ID,
    ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID,
    FLUX_2_DEV_MODEL_ID,
    FLUX_2_DEV_REFERENCE_IMAGE_MAX_DIMENSION_EXCLUSIVE,
    getAdminAiVideoModelSpec,
} from '../../shared/admin-ai-contract.mjs?v=__ASSET_VERSION__';
import { createSavedAssetsBrowser } from '../../shared/saved-assets-browser.js?v=__ASSET_VERSION__';
import {
    buildCompareSaveIntent,
    buildEmbeddingsSaveIntent,
    buildImageSaveIntent,
    buildLiveAgentSaveIntent,
    buildMusicSaveIntent,
    buildTextSaveIntent,
    buildVideoSaveIntent,
} from './ai-lab-save-intents.mjs?v=__ASSET_VERSION__';

const STORAGE_KEY = 'bitbi_admin_ai_lab_state_v1';
const MODES = ['models', 'text', 'image', 'embeddings', 'compare', 'live-agent', 'music', 'video'];
const HISTORY_LIMIT = 6;
const ADMIN_AI_UI_VERSION = '__ASSET_VERSION__';
const DEFAULT_REQUEST_TIMEOUTS = {
    text: 20_000,
    image: 180_000,
    embeddings: 15_000,
    music: 320_000,
    video: 480_000,
    compare: 30_000,
};
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
    music: {
        label: 'Music',
        busyText: 'Generating...',
        idleText: 'Generate Music',
    },
    video: {
        label: 'Video',
        busyText: 'Generating...',
        idleText: 'Generate Video',
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
        preset: ADMIN_AI_DEFAULT_PRESETS.text,
        model: '',
        system: 'You are a concise assistant.',
        prompt: '',
        maxTokens: 300,
        temperature: 0.7,
    },
    image: {
        preset: ADMIN_AI_DEFAULT_PRESETS.image,
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
        preset: ADMIN_AI_DEFAULT_PRESETS.embeddings,
        model: '',
        input: '',
    },
    music: {
        preset: ADMIN_AI_DEFAULT_PRESETS.music,
        model: '',
        prompt: '',
        mode: 'vocals',
        lyricsMode: 'custom',
        lyrics: '',
        bpm: '',
        key: '',
    },
    video: {
        preset: ADMIN_AI_DEFAULT_PRESETS.video,
        model: ADMIN_AI_VIDEO_MODEL_ID,
        prompt: '',
        negativePrompt: '',
        imageInput: null,
        startImageInput: null,
        endImageInput: null,
        duration: 5,
        aspectRatio: '16:9',
        quality: '720p',
        resolution: '720p',
        seed: '',
        generateAudio: true,
    },
    compare: {
        modelA: ADMIN_AI_DEFAULT_COMPARE_MODELS.modelA,
        modelB: ADMIN_AI_DEFAULT_COMPARE_MODELS.modelB,
        system: 'You are concise.',
        prompt: '',
        maxTokens: 250,
        temperature: 0.7,
    },
};

const DEFAULT_PREFERENCES = {
    compareOnlyDifferences: false,
};

const VIDEO_IMAGE_EMPTY_STATES = {
    imageInput: {
        empty: {
            title: 'No reference image selected.',
            hint: 'Upload a PNG, JPEG, or WebP to guide motion in image-to-video mode.',
        },
        loading: {
            title: 'Preparing preview.',
            hint: 'Verifying the selected image before image-to-video generation.',
        },
        error: {
            title: 'Preview unavailable.',
            hint: 'Choose a different PNG, JPEG, or WebP reference image.',
        },
    },
    startImageInput: {
        empty: {
            title: 'No start frame selected.',
            hint: 'Upload a PNG, JPEG, or WebP to drive image-to-video or start/end-frame generation.',
        },
        loading: {
            title: 'Preparing start frame preview.',
            hint: 'Verifying the selected start frame before generation.',
        },
        error: {
            title: 'Preview unavailable.',
            hint: 'Choose a different PNG, JPEG, or WebP start frame.',
        },
    },
    endImageInput: {
        empty: {
            title: 'No end frame selected.',
            hint: 'Optional end frame for start/end-frame-to-video. Requires a selected start frame.',
        },
        loading: {
            title: 'Preparing end frame preview.',
            hint: 'Verifying the selected end frame before generation.',
        },
        error: {
            title: 'Preview unavailable.',
            hint: 'Choose a different PNG, JPEG, or WebP end frame.',
        },
    },
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

function formatDuration(durationMs) {
    if (typeof durationMs !== 'number' || Number.isNaN(durationMs) || durationMs <= 0) return '—';
    const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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
    if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('flac')) return 'flac';
    if (mimeType.includes('ogg')) return 'ogg';
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
            music: null,
            video: null,
            compare: null,
        },
        controllers: {
            models: null,
            text: null,
            image: null,
            embeddings: null,
            music: null,
            video: null,
            compare: null,
        },
        timers: {
            text: null,
            image: null,
            embeddings: null,
            music: null,
            video: null,
            compare: null,
        },
        requestSeq: {
            models: 0,
            text: 0,
            image: 0,
            embeddings: 0,
            music: 0,
            video: 0,
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
            music: document.getElementById('aiLabPanelMusic'),
            video: document.getElementById('aiLabPanelVideo'),
        },
        models: {
            presets: document.getElementById('aiModelsPresets'),
            text: document.getElementById('aiModelsText'),
            image: document.getElementById('aiModelsImage'),
            embeddings: document.getElementById('aiModelsEmbeddings'),
            music: document.getElementById('aiModelsMusic'),
            video: document.getElementById('aiModelsVideo'),
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
        music: {
            prompt: document.getElementById('aiMusicPrompt'),
            promptCount: document.getElementById('aiMusicPromptCount'),
            mode: document.getElementById('aiMusicMode'),
            lyricsMode: document.getElementById('aiMusicLyricsMode'),
            lyricsModeField: document.getElementById('aiMusicLyricsModeField'),
            lyricsField: document.getElementById('aiMusicLyricsField'),
            lyrics: document.getElementById('aiMusicLyrics'),
            lyricsCount: document.getElementById('aiMusicLyricsCount'),
            lyricsHint: document.getElementById('aiMusicLyricsHint'),
            bpm: document.getElementById('aiMusicBpm'),
            key: document.getElementById('aiMusicKey'),
            inlineError: document.getElementById('aiMusicInlineError'),
            run: document.getElementById('aiMusicRun'),
            cancel: document.getElementById('aiMusicCancel'),
            reset: document.getElementById('aiMusicReset'),
            state: document.getElementById('aiMusicState'),
            preview: document.getElementById('aiMusicPreview'),
            meta: document.getElementById('aiMusicMeta'),
            warnings: document.getElementById('aiMusicWarnings'),
            save: document.getElementById('aiMusicSave'),
            download: document.getElementById('aiMusicDownload'),
            lyricsPanel: document.getElementById('aiMusicLyricsPanel'),
            lyricsOutput: document.getElementById('aiMusicLyricsOutput'),
            debug: document.getElementById('aiMusicDebug'),
            raw: document.getElementById('aiMusicRaw'),
            copyRaw: document.getElementById('aiMusicCopyRaw'),
        },
        video: {
            modelBadge: document.getElementById('aiVideoModelBadge'),
            modelDesc: document.getElementById('aiVideoModelDesc'),
            modelCards: Array.from(root.querySelectorAll('[data-ai-video-model]')),
            prompt: document.getElementById('aiVideoPrompt'),
            promptCount: document.getElementById('aiVideoPromptCount'),
            negativePromptField: document.getElementById('aiVideoNegativePromptField'),
            negativePrompt: document.getElementById('aiVideoNegativePrompt'),
            negativePromptCount: document.getElementById('aiVideoNegativePromptCount'),
            imageField: document.getElementById('aiVideoImageField'),
            imageFile: document.getElementById('aiVideoImageFile'),
            imagePreview: document.getElementById('aiVideoImagePreview'),
            imageEmpty: document.getElementById('aiVideoImageEmpty'),
            imageThumb: document.getElementById('aiVideoImageThumb'),
            imageClear: document.getElementById('aiVideoImageClear'),
            startImageField: document.getElementById('aiVideoStartImageField'),
            startImageFile: document.getElementById('aiVideoStartImageFile'),
            startImagePreview: document.getElementById('aiVideoStartImagePreview'),
            startImageEmpty: document.getElementById('aiVideoStartImageEmpty'),
            startImageThumb: document.getElementById('aiVideoStartImageThumb'),
            startImageClear: document.getElementById('aiVideoStartImageClear'),
            endImageField: document.getElementById('aiVideoEndImageField'),
            endImageFile: document.getElementById('aiVideoEndImageFile'),
            endImagePreview: document.getElementById('aiVideoEndImagePreview'),
            endImageEmpty: document.getElementById('aiVideoEndImageEmpty'),
            endImageThumb: document.getElementById('aiVideoEndImageThumb'),
            endImageClear: document.getElementById('aiVideoEndImageClear'),
            durationField: document.getElementById('aiVideoDurationField'),
            duration: document.getElementById('aiVideoDuration'),
            aspectRatioField: document.getElementById('aiVideoAspectRatioField'),
            aspectRatio: document.getElementById('aiVideoAspectRatio'),
            aspectRatioHint: document.getElementById('aiVideoAspectRatioHint'),
            qualityField: document.getElementById('aiVideoQualityField'),
            qualityLabel: document.getElementById('aiVideoQualityLabel'),
            quality: document.getElementById('aiVideoQuality'),
            resolutionField: document.getElementById('aiVideoResolutionField'),
            resolution: document.getElementById('aiVideoResolution'),
            seedField: document.getElementById('aiVideoSeedField'),
            seed: document.getElementById('aiVideoSeed'),
            audioLabel: document.getElementById('aiVideoAudioLabel'),
            generateAudio: document.getElementById('aiVideoGenerateAudio'),
            inlineError: document.getElementById('aiVideoInlineError'),
            run: document.getElementById('aiVideoRun'),
            cancel: document.getElementById('aiVideoCancel'),
            reset: document.getElementById('aiVideoReset'),
            state: document.getElementById('aiVideoState'),
            preview: document.getElementById('aiVideoPreview'),
            meta: document.getElementById('aiVideoMeta'),
            warnings: document.getElementById('aiVideoWarnings'),
            save: document.getElementById('aiVideoSave'),
            download: document.getElementById('aiVideoDownload'),
            debug: document.getElementById('aiVideoDebug'),
            raw: document.getElementById('aiVideoRaw'),
            copyRaw: document.getElementById('aiVideoCopyRaw'),
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

    let videoImagePreviewSeq = {
        imageInput: 0,
        startImageInput: 0,
        endImageInput: 0,
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

    function getVideoModelSummary(modelId = ADMIN_AI_VIDEO_MODEL_ID) {
        const spec = getAdminAiVideoModelSpec(modelId);
        const catalogModel = hasCatalog() ? getModelInfo(state.catalog.data, 'video', spec.id) : null;
        return {
            id: spec.id,
            label: catalogModel?.label || spec.label || spec.id,
            vendor: catalogModel?.vendor || spec.vendor || '',
            description: catalogModel?.description || spec.description || '',
            capabilities: catalogModel?.capabilities || null,
            spec,
        };
    }

    function getSelectedVideoModelId() {
        return getAdminAiVideoModelSpec(state.forms.video.model || ADMIN_AI_VIDEO_MODEL_ID).id;
    }

    function getSelectedVideoModelSpec() {
        return getAdminAiVideoModelSpec(getSelectedVideoModelId());
    }

    function normalizeVideoFormForModel(modelId = getSelectedVideoModelId()) {
        const spec = getAdminAiVideoModelSpec(modelId);
        state.forms.video.model = spec.id;
        state.forms.video.preset = spec.defaultPreset || state.forms.video.preset || ADMIN_AI_DEFAULT_PRESETS.video;

        const duration = Number(state.forms.video.duration);
        state.forms.video.duration = Number.isFinite(duration)
            ? Math.min(Math.max(Math.round(duration), spec.minDuration || 1), spec.maxDuration || 16)
            : (spec.defaultDuration || 5);

        if (!Array.isArray(spec.allowedAspectRatios) || !spec.allowedAspectRatios.includes(state.forms.video.aspectRatio)) {
            state.forms.video.aspectRatio = spec.defaultAspectRatio || '16:9';
        }

        if (spec.resolutionField === 'quality') {
            if (!Array.isArray(spec.allowedQualities) || !spec.allowedQualities.includes(state.forms.video.quality)) {
                state.forms.video.quality = spec.defaultQuality || '720p';
            }
        } else if (!Array.isArray(spec.allowedResolutions) || !spec.allowedResolutions.includes(state.forms.video.resolution)) {
            state.forms.video.resolution = spec.defaultResolution || '720p';
        }

        if (typeof state.forms.video.generateAudio !== 'boolean') {
            state.forms.video.generateAudio = spec.defaultGenerateAudio !== false;
        }

        return spec;
    }

    function setVideoModel(modelId, { persist = true } = {}) {
        normalizeVideoFormForModel(modelId);
        syncFormInputs();
        renderVideoResult();
        if (persist) persistState();
    }

    function formatVideoWorkflow(workflow, payload = null) {
        const normalized = workflow
            || (payload?.hasEndImageInput
                ? 'start_end_to_video'
                : payload?.hasImageInput
                    ? 'image_to_video'
                    : 'text_to_video');
        switch (normalized) {
        case 'start_end_to_video':
            return 'Start/End-Frame-to-Video';
        case 'image_to_video':
            return 'Image-to-Video';
        default:
            return 'Text-to-Video';
        }
    }

    function getVideoImageRefs(key) {
        switch (key) {
        case 'startImageInput':
            return {
                file: refs.video.startImageFile,
                preview: refs.video.startImagePreview,
                empty: refs.video.startImageEmpty,
                thumb: refs.video.startImageThumb,
                clear: refs.video.startImageClear,
            };
        case 'endImageInput':
            return {
                file: refs.video.endImageFile,
                preview: refs.video.endImagePreview,
                empty: refs.video.endImageEmpty,
                thumb: refs.video.endImageThumb,
                clear: refs.video.endImageClear,
            };
        default:
            return {
                file: refs.video.imageFile,
                preview: refs.video.imagePreview,
                empty: refs.video.imageEmpty,
                thumb: refs.video.imageThumb,
                clear: refs.video.imageClear,
            };
        }
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
        if (task === 'music') {
            syncMusicFieldState();
        }
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

    function populateMusicKeySelect() {
        setOptions(
            refs.music.key,
            [{ value: '', label: 'No preference' }].concat(
                ADMIN_AI_MUSIC_KEYS.map((entry) => ({
                    value: entry,
                    label: entry,
                }))
            )
        );
        refs.music.key.value = state.forms.music.key || '';
    }

    function setMusicInlineError(message = '') {
        refs.music.inlineError.textContent = message;
        refs.music.inlineError.hidden = !message;
    }

    function syncMusicFieldState() {
        const isBusy = state.results.music?.status === 'loading';
        const isInstrumental = state.forms.music.mode === 'instrumental';
        const usesCustomLyrics = !isInstrumental && state.forms.music.lyricsMode === 'custom';

        refs.music.prompt.disabled = isBusy;
        refs.music.mode.disabled = isBusy;
        refs.music.bpm.disabled = isBusy;
        refs.music.key.disabled = isBusy;
        refs.music.reset.disabled = isBusy;

        refs.music.lyricsMode.disabled = isBusy || isInstrumental;
        refs.music.lyricsModeField.classList.toggle('admin-ai__field--disabled', isInstrumental);
        refs.music.lyricsField.hidden = !usesCustomLyrics;
        refs.music.lyrics.disabled = isBusy || !usesCustomLyrics;
    }

    function getMusicAudioSource(payload) {
        if (!payload) return '';
        if (payload.audioBase64) {
            return `data:${payload.mimeType || 'audio/mpeg'};base64,${payload.audioBase64}`;
        }
        if (payload.audioUrl) {
            return payload.audioUrl;
        }
        return '';
    }

    function setVideoInlineError(message = '') {
        if (!refs.video.inlineError) return;
        refs.video.inlineError.textContent = message;
        refs.video.inlineError.hidden = !message;
    }

    function updateVideoImageEmptyState(key = 'imageInput', variant = 'empty') {
        const imageRefs = getVideoImageRefs(key);
        const preview = imageRefs.preview;
        const empty = imageRefs.empty;
        if (!preview || !empty) return;

        const next = VIDEO_IMAGE_EMPTY_STATES[key]?.[variant] || VIDEO_IMAGE_EMPTY_STATES[key]?.empty;
        const title = empty.querySelector('.admin-ai__video-image-empty-title');
        const hint = empty.querySelector('.admin-ai__video-image-empty-hint');

        preview.dataset.state = variant;
        empty.hidden = false;
        if (title) title.textContent = next.title;
        if (hint) hint.textContent = next.hint;
    }

    function resetVideoImageThumb(key = 'imageInput') {
        const imageRefs = getVideoImageRefs(key);
        if (!imageRefs.thumb) return;
        imageRefs.thumb.onload = null;
        imageRefs.thumb.onerror = null;
        imageRefs.thumb.hidden = true;
        imageRefs.thumb.removeAttribute('src');
    }

    function renderVideoImageSelection(key = 'imageInput', source, variant = 'empty') {
        const imageRefs = getVideoImageRefs(key);
        if (!imageRefs.preview) return;

        const value = typeof source === 'string' ? source.trim() : '';
        if (!value) {
            videoImagePreviewSeq[key] += 1;
            resetVideoImageThumb(key);
            if (imageRefs.clear) imageRefs.clear.hidden = true;
            updateVideoImageEmptyState(key, variant);
            return;
        }

        const requestId = ++videoImagePreviewSeq[key];
        const label = key === 'endImageInput' ? 'end frame' : key === 'startImageInput' ? 'start frame' : 'image';
        resetVideoImageThumb(key);
        updateVideoImageEmptyState(key, 'loading');
        if (imageRefs.clear) imageRefs.clear.hidden = false;

        imageRefs.thumb.onload = () => {
            if (requestId !== videoImagePreviewSeq[key]) return;
            imageRefs.preview.dataset.state = 'ready';
            if (imageRefs.empty) imageRefs.empty.hidden = true;
            imageRefs.thumb.hidden = false;
            if (imageRefs.clear) imageRefs.clear.hidden = false;
        };
        imageRefs.thumb.onerror = () => {
            if (requestId !== videoImagePreviewSeq[key]) return;
            state.forms.video[key] = null;
            if (imageRefs.file) imageRefs.file.value = '';
            if (imageRefs.clear) imageRefs.clear.hidden = true;
            setVideoInlineError(`Selected ${label} preview could not be loaded. Choose another image.`);
            resetVideoImageThumb(key);
            updateVideoImageEmptyState(key, 'error');
            persistState();
        };
        imageRefs.thumb.src = value;
    }

    function syncVideoFieldState() {
        if (!refs.video.prompt) return;
        const spec = getSelectedVideoModelSpec();
        const modelSummary = getVideoModelSummary(spec.id);
        const isBusy = state.results.video?.status === 'loading';
        const usesViduFrameWorkflow = spec.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID
            && (!!state.forms.video.startImageInput || !!state.forms.video.endImageInput);

        if (refs.video.modelBadge) refs.video.modelBadge.textContent = modelSummary.id;
        if (refs.video.modelDesc) refs.video.modelDesc.textContent = modelSummary.description || spec.description || '';
        refs.video.modelCards.forEach((button) => {
            const isActive = button.dataset.aiVideoModel === spec.id;
            button.classList.toggle('admin-ai__video-model-card--active', isActive);
            button.setAttribute('aria-selected', String(isActive));
            button.disabled = isBusy;
        });

        refs.video.prompt.maxLength = spec.maxPromptLength || ADMIN_AI_LIMITS.video.maxPromptLength;
        refs.video.prompt.placeholder = spec.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID
            ? (usesViduFrameWorkflow
                ? 'Optional — add a text prompt to steer motion between the selected frames.'
                : 'Describe the scene, motion, and visual style for text-to-video.')
            : 'Describe the scene, motion, camera movement, and visual style.';
        refs.video.prompt.disabled = isBusy;
        refs.video.negativePrompt.maxLength = spec.maxNegativePromptLength || ADMIN_AI_LIMITS.video.maxNegativePromptLength;
        refs.video.negativePromptField.hidden = !spec.supportsNegativePrompt;
        refs.video.negativePrompt.disabled = isBusy || !spec.supportsNegativePrompt;

        refs.video.imageField.hidden = spec.id !== ADMIN_AI_VIDEO_MODEL_ID;
        refs.video.imageFile.disabled = isBusy || spec.id !== ADMIN_AI_VIDEO_MODEL_ID;

        refs.video.startImageField.hidden = spec.id !== ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID;
        refs.video.startImageFile.disabled = isBusy || spec.id !== ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID;
        refs.video.endImageField.hidden = spec.id !== ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID;
        refs.video.endImageFile.disabled = isBusy || spec.id !== ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID;

        refs.video.duration.min = spec.minDuration || 1;
        refs.video.duration.max = spec.maxDuration || 16;
        refs.video.duration.disabled = isBusy;

        setFieldDisabled(
            refs.video.aspectRatioField,
            refs.video.aspectRatio,
            isBusy || (spec.aspectRatioMode === 'text_only' && usesViduFrameWorkflow),
            refs.video.aspectRatioHint,
            usesViduFrameWorkflow
                ? 'Available only for text-to-video when no start or end frame is selected.'
                : 'Not supported by this model.'
        );

        refs.video.qualityField.hidden = spec.resolutionField !== 'quality';
        refs.video.quality.disabled = isBusy || spec.resolutionField !== 'quality';
        if (refs.video.qualityLabel) refs.video.qualityLabel.textContent = 'Quality';

        refs.video.resolutionField.hidden = spec.resolutionField !== 'resolution';
        refs.video.resolution.disabled = isBusy || spec.resolutionField !== 'resolution';

        refs.video.seedField.hidden = !spec.supportsSeed;
        refs.video.seed.disabled = isBusy || !spec.supportsSeed;

        refs.video.generateAudio.disabled = isBusy || !spec.supportsAudioToggle;
        if (refs.video.audioLabel) {
            refs.video.audioLabel.textContent = spec.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID
                ? 'Enable Audio'
                : 'Generate Audio';
        }
        refs.video.reset.disabled = isBusy;
        if (refs.video.imageClear) refs.video.imageClear.disabled = isBusy;
        if (refs.video.startImageClear) refs.video.startImageClear.disabled = isBusy;
        if (refs.video.endImageClear) refs.video.endImageClear.disabled = isBusy;
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
        return buildTextSaveIntent({
            response,
            prompt: state.forms.text.prompt,
            system: state.forms.text.system,
            warnings: getWarnings(response),
            receivedAt: state.results.text?.receivedAt instanceof Date
                ? state.results.text.receivedAt.toISOString()
                : null,
        });
    }

    function getImageSaveIntent() {
        const response = state.results.image?.raw;
        return buildImageSaveIntent({
            response,
            prompt: state.forms.image.prompt,
            fallbackModel: state.forms.image.model,
        });
    }

    function getEmbeddingsSaveIntent() {
        const response = state.results.embeddings?.raw;
        return buildEmbeddingsSaveIntent({
            response,
            input: state.forms.embeddings.input,
            warnings: getWarnings(response),
            receivedAt: state.results.embeddings?.receivedAt instanceof Date
                ? state.results.embeddings.receivedAt.toISOString()
                : null,
        });
    }

    function getCompareSaveIntent() {
        const response = state.results.compare?.raw;
        const results = Array.isArray(response?.result?.results) ? response.result.results : [];
        const diff = buildCompareDiff(results);
        return buildCompareSaveIntent({
            response,
            prompt: state.forms.compare.prompt,
            system: state.forms.compare.system,
            warnings: getWarnings(response),
            diffSummary: diff.available ? diff : null,
            receivedAt: state.results.compare?.receivedAt instanceof Date
                ? state.results.compare.receivedAt.toISOString()
                : null,
        });
    }

    function getLiveAgentSaveIntent() {
        return buildLiveAgentSaveIntent({
            messages: liveAgentState.messages,
            transcriptRoot: refs.liveAgent.transcript,
            system: refs.liveAgent.system.value || '',
            model: ADMIN_AI_LIVE_AGENT_MODEL,
            receivedAt: new Date().toISOString(),
        });
    }

    function getMusicSaveIntent() {
        const response = state.results.music?.raw;
        return buildMusicSaveIntent({
            response,
            prompt: state.forms.music.prompt,
            warnings: getWarnings(response),
            receivedAt: state.results.music?.receivedAt instanceof Date
                ? state.results.music.receivedAt.toISOString()
                : null,
        });
    }

    function getVideoSaveIntent() {
        const response = state.results.video?.raw;
        return buildVideoSaveIntent({
            response,
            prompt: state.forms.video.prompt,
            warnings: getWarnings(response),
            receivedAt: state.results.video?.receivedAt instanceof Date
                ? state.results.video.receivedAt.toISOString()
                : null,
        });
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
        case 'music':
            return getMusicSaveIntent();
        case 'video':
            return getVideoSaveIntent();
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

            if (intent.sourceModule === 'video') {
                const videoEl = refs.video?.preview?.querySelector('video');
                if (videoEl && videoEl.videoWidth && videoEl.videoHeight && videoEl.dataset.corsDisabled !== '1') {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = videoEl.videoWidth;
                        canvas.height = videoEl.videoHeight;
                        canvas.getContext('2d').drawImage(videoEl, 0, 0);
                        intent.payload.posterBase64 = canvas.toDataURL('image/webp', 0.82);
                    } catch {
                        // CORS-tainted canvas — poster unavailable
                    }
                }
            }

            let res;
            if (intent.sourceModule === 'music') {
                res = await apiAiSaveAudio({
                    title: state.save.title,
                    folder_id: state.save.folderId || null,
                    ...intent.payload,
                });
            } else {
                res = await apiAdminAiSaveTextAsset({
                    title: state.save.title,
                    folderId: state.save.folderId || null,
                    sourceModule: intent.sourceModule,
                    data: intent.payload,
                });
            }

            if (!res.ok) {
                setSaveState('error', res.error || 'Save failed.');
                state.save.saving = false;
                renderSaveModal();
                return;
            }

            state.save.saving = false;
            closeSaveModal();
            await refreshSavedAssetsBrowser();
            let statusMessage = 'Text asset saved to the shared folder structure.';
            let toastMessage = 'Text asset saved.';
            if (intent.sourceModule === 'music') {
                statusMessage = 'Audio saved to the shared folder structure.';
                toastMessage = 'Audio saved.';
            } else if (intent.sourceModule === 'video') {
                statusMessage = 'Video asset saved to the shared folder structure.';
                toastMessage = 'Video asset saved.';
            }
            setStatus(statusMessage, 'success');
            if (showToast) showToast(toastMessage);
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
            return ADMIN_AI_IMAGE_CAPABILITY_FALLBACK;
        }
        const model = getModelInfo(state.catalog.data, 'image', modelId);
        if (!model?.capabilities) {
            return ADMIN_AI_IMAGE_CAPABILITY_FALLBACK;
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
        const maxRef = caps.maxReferenceImages || ADMIN_AI_LIMITS.image.maxReferenceImages;
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
        const maxRef = caps.maxReferenceImages || ADMIN_AI_LIMITS.image.maxReferenceImages;
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
        const maxRef = caps.maxReferenceImages || ADMIN_AI_LIMITS.image.maxReferenceImages;
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
        const musicPresets = getCatalogPresets(state.catalog.data, 'music').map((item) => item.name);

        if (!textPresets.includes(state.forms.text.preset)) state.forms.text.preset = textPresets[0] || ADMIN_AI_DEFAULT_PRESETS.text;
        if (!imagePresets.includes(state.forms.image.preset)) state.forms.image.preset = imagePresets[0] || ADMIN_AI_DEFAULT_PRESETS.image;
        if (!embeddingPresets.includes(state.forms.embeddings.preset)) {
            state.forms.embeddings.preset = embeddingPresets[0] || ADMIN_AI_DEFAULT_PRESETS.embeddings;
        }
        if (!musicPresets.includes(state.forms.music.preset)) {
            state.forms.music.preset = musicPresets[0] || ADMIN_AI_DEFAULT_PRESETS.music;
        }

        const textIds = getCatalogModels(state.catalog.data, 'text').map((item) => item.id);
        const imageIds = getCatalogModels(state.catalog.data, 'image').map((item) => item.id);
        const embeddingIds = getCatalogModels(state.catalog.data, 'embeddings').map((item) => item.id);
        const musicIds = getCatalogModels(state.catalog.data, 'music').map((item) => item.id);
        const videoIds = getCatalogModels(state.catalog.data, 'video').map((item) => item.id);

        if (state.forms.text.model && !textIds.includes(state.forms.text.model)) state.forms.text.model = '';
        if (state.forms.image.model && !imageIds.includes(state.forms.image.model)) state.forms.image.model = '';
        if (state.forms.embeddings.model && !embeddingIds.includes(state.forms.embeddings.model)) {
            state.forms.embeddings.model = '';
        }
        if (state.forms.music.model && !musicIds.includes(state.forms.music.model)) {
            state.forms.music.model = '';
        }
        if (state.forms.video.model && videoIds.length > 0 && !videoIds.includes(state.forms.video.model)) {
            state.forms.video.model = videoIds[0];
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
            populateMusicKeySelect();
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
        populateMusicKeySelect();
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

        refs.music.prompt.value = state.forms.music.prompt;
        refs.music.mode.value = state.forms.music.mode;
        refs.music.lyricsMode.value = state.forms.music.lyricsMode;
        refs.music.lyrics.value = state.forms.music.lyrics;
        refs.music.bpm.value = state.forms.music.bpm;

        if (refs.video.prompt) {
            normalizeVideoFormForModel();
            refs.video.prompt.value = state.forms.video.prompt;
            refs.video.negativePrompt.value = state.forms.video.negativePrompt;
            refs.video.duration.value = state.forms.video.duration;
            refs.video.aspectRatio.value = state.forms.video.aspectRatio;
            refs.video.quality.value = state.forms.video.quality;
            refs.video.resolution.value = state.forms.video.resolution;
            refs.video.seed.value = state.forms.video.seed;
            refs.video.generateAudio.checked = state.forms.video.generateAudio;
            renderVideoImageSelection('imageInput', state.forms.video.imageInput);
            renderVideoImageSelection('startImageInput', state.forms.video.startImageInput);
            renderVideoImageSelection('endImageInput', state.forms.video.endImageInput);
        }

        refs.compare.system.value = state.forms.compare.system;
        refs.compare.prompt.value = state.forms.compare.prompt;
        refs.compare.maxTokens.value = state.forms.compare.maxTokens;
        refs.compare.temperature.value = state.forms.compare.temperature;
        refs.compare.onlyDifferences.checked = state.preferences.compareOnlyDifferences;

        populateSelects();
        updateCounters();
        updateImageCapabilityControls();
        syncMusicFieldState();
        syncVideoFieldState();
        renderHistories();
    }

    function updateCounters() {
        updateCounter(refs.text.system, refs.text.systemCount, 1200);
        updateCounter(refs.text.prompt, refs.text.promptCount, 4000);
        updateCounter(refs.image.prompt, refs.image.promptCount, 2048);
        updateCounter(
            refs.image.structuredPrompt,
            refs.image.structuredPromptCount,
            ADMIN_AI_LIMITS.image.maxStructuredPromptLength
        );
        updateCounter(refs.embeddings.input, refs.embeddings.inputCount, 8000, (value) => {
            const lines = value
                .split(/\r?\n/)
                .map((entry) => entry.trim())
                .filter(Boolean).length;
            return `${lines} item${lines === 1 ? '' : 's'} / ${value.length} chars`;
        });
        updateCounter(refs.music.prompt, refs.music.promptCount, ADMIN_AI_LIMITS.music.maxPromptLength);
        updateCounter(refs.music.lyrics, refs.music.lyricsCount, ADMIN_AI_LIMITS.music.maxLyricsLength);
        if (refs.video.prompt) {
            const videoSpec = getSelectedVideoModelSpec();
            updateCounter(
                refs.video.prompt,
                refs.video.promptCount,
                videoSpec.maxPromptLength || ADMIN_AI_LIMITS.video.maxPromptLength
            );
            updateCounter(
                refs.video.negativePrompt,
                refs.video.negativePromptCount,
                videoSpec.maxNegativePromptLength || ADMIN_AI_LIMITS.video.maxNegativePromptLength
            );
        }
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
            if (panel) panel.hidden = key !== mode;
        });

        persistState();
        renderResetLabel();

        const showAssets = mode === 'image' || mode === 'music' || mode === 'video';
        if (refs.savedAssets.root) {
            refs.savedAssets.root.hidden = !showAssets;
        }
        if (showAssets) {
            showSavedAssetsBrowser();
        }
    }

    function renderResetLabel() {
        let label;
        if (state.activeMode === 'models') label = 'Refresh View';
        else if (state.activeMode === 'live-agent') label = 'Reset Chat';
        else if (state.activeMode === 'music') label = 'Reset Music Form';
        else if (state.activeMode === 'video') label = 'Reset Video Form';
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
        const musicCount = getCatalogModels(state.catalog.data, 'music').length;
        const videoCount = getCatalogModels(state.catalog.data, 'video').length;
        setText(refs.catalogStamp, `Catalog loaded: ${formatTime(state.catalog.loadedAt)}`);
        setText(refs.catalogSummary, `${textCount} text · ${imageCount} image · ${embeddingCount} embeddings · ${musicCount} music · ${videoCount} video`);
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
            renderCatalogList(refs.models.music, [], loadingMessage);
            if (refs.models.video) renderCatalogList(refs.models.video, [], loadingMessage);
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
        renderCatalogList(
            refs.models.music,
            getCatalogModels(state.catalog.data, 'music'),
            'No music models allowlisted.'
        );
        if (refs.models.video) {
            renderCatalogList(
                refs.models.video,
                getCatalogModels(state.catalog.data, 'video'),
                'No video models allowlisted.'
            );
        }

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

    function renderMusicEmptyState() {
        refs.music.preview.innerHTML = `
            <div class="admin-ai__music-empty">
                <div class="admin-ai__music-empty-icon" aria-hidden="true"></div>
                <div class="admin-ai__music-empty-copy">
                    <strong>Studio standing by.</strong>
                    <span>Generate a vocal or instrumental track to inspect the audio, metadata, and lyric output here.</span>
                </div>
            </div>
        `;
    }

    function renderMusicPreview(payload, result) {
        const audioSource = getMusicAudioSource(payload);
        refs.music.download.hidden = !audioSource;
        refs.music.save.hidden = !audioSource;

        if (!audioSource) {
            if (result?.status === 'loading' && !payload) {
                refs.music.preview.innerHTML = '<div class="admin-ai__loading"><div class="admin-ai__spinner"></div><span>Waiting for music output...</span></div>';
            } else if (result?.status === 'error' && !payload) {
                refs.music.preview.innerHTML = '<div class="admin-ai__empty">Music generation failed before any audio result was returned.</div>';
            } else if (payload) {
                refs.music.preview.innerHTML = '<div class="admin-ai__empty">The worker completed, but no playable audio payload was returned.</div>';
            } else {
                renderMusicEmptyState();
            }
            return;
        }

        refs.music.preview.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'admin-ai__music-player';

        const head = document.createElement('div');
        head.className = 'admin-ai__music-player-head';

        const title = document.createElement('h4');
        title.className = 'admin-ai__music-player-title';
        title.textContent = payload.mode === 'instrumental' ? 'Generated Instrumental' : 'Generated Song';

        const note = document.createElement('div');
        note.className = 'admin-ai__music-player-note';
        note.textContent = payload.audioUrl
            ? 'Streaming from a temporary provider URL. Download while it is still available.'
            : 'Inline audio buffer ready for preview and download.';

        head.append(title, note);

        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'metadata';
        audio.src = audioSource;

        wrapper.append(head, audio);
        refs.music.preview.appendChild(wrapper);
    }

    function renderMusicResult() {
        const result = state.results.music;
        const response = result?.raw || null;
        const payload = response?.result || null;
        const resultCode = getResultCode(result);

        renderMusicPreview(payload, result);
        renderMeta(refs.music.meta, response ? [
            { label: 'Preset', value: response.preset || 'Preset default' },
            { label: 'Model Label', value: response.model?.label },
            { label: 'Model ID', value: response.model?.id },
            { label: 'Vendor', value: response.model?.vendor },
            { label: 'Elapsed', value: formatElapsed(response.elapsedMs) },
            { label: 'Received', value: formatTime(result?.receivedAt) },
            { label: 'Mode', value: payload?.mode === 'instrumental' ? 'Instrumental' : 'Song / Vocals' },
            {
                label: 'Lyrics',
                value: payload?.mode === 'instrumental'
                    ? 'Not used'
                    : payload?.lyricsMode === 'auto'
                        ? 'Auto lyrics'
                        : 'Custom lyrics',
            },
            { label: 'BPM', value: payload?.bpm },
            { label: 'Key', value: payload?.key },
            { label: 'Duration', value: payload?.durationMs ? formatDuration(payload.durationMs) : null },
            { label: 'Sample Rate', value: payload?.sampleRate ? `${payload.sampleRate} Hz` : null },
            { label: 'Channels', value: payload?.channels },
            { label: 'Bitrate', value: payload?.bitrate ? `${payload.bitrate} bps` : null },
            { label: 'Size', value: payload?.sizeBytes ? formatBytes(payload.sizeBytes) : null },
            {
                label: 'Output',
                value: payload?.audioBase64 ? 'Inline audio buffer' : payload?.audioUrl ? 'Provider URL' : null,
            },
            { label: 'Provider Status', value: payload?.providerStatus },
            { label: 'Trace ID', value: response.traceId },
        ] : []);
        renderWarnings(refs.music.warnings, response ? getWarnings(response) : []);
        renderDebug(refs.music.debug, refs.music.raw, result?.debugRaw || response);

        refs.music.lyricsPanel.hidden = !payload?.lyricsPreview;
        refs.music.lyricsOutput.textContent = payload?.lyricsPreview || '';

        if (!result) {
            setResultState(refs.music.state, 'neutral', 'No music generation yet.');
            syncMusicFieldState();
            return;
        }

        if (result.status === 'loading') {
            setResultState(
                refs.music.state,
                'loading',
                response ? 'Generating music. Previous result shown below.' : 'Generating music...'
            );
            syncMusicFieldState();
            return;
        }

        if (result.status === 'aborted') {
            setResultState(
                refs.music.state,
                'aborted',
                response ? 'Music request cancelled. Previous result preserved.' : 'Music request cancelled.'
            );
            syncMusicFieldState();
            return;
        }

        if (result.status === 'timeout') {
            setResultState(
                refs.music.state,
                'timeout',
                response
                    ? `${result.error || 'Music request timed out.'} Previous result preserved.`
                    : result.error || 'Music request timed out.'
            );
            syncMusicFieldState();
            return;
        }

        if (result.status === 'error') {
            setResultState(
                refs.music.state,
                'error',
                response
                    ? `${describeAdminAiError('music', result.error, resultCode)} Previous result preserved.`
                    : describeAdminAiError('music', result.error, resultCode)
            );
            syncMusicFieldState();
            return;
        }

        setResultState(refs.music.state, 'success', 'Music response ready.');
        syncMusicFieldState();
    }

    function validateMusicForm() {
        const prompt = (state.forms.music.prompt || '').trim();
        if (!prompt) {
            return 'Prompt is required before generating music.';
        }

        if (state.forms.music.mode !== 'instrumental' && state.forms.music.lyricsMode === 'custom' && !(state.forms.music.lyrics || '').trim()) {
            return 'Custom lyrics are required when vocal mode uses custom lyrics.';
        }

        return '';
    }

    function resetMusicForm(showSuccess = true) {
        if (state.results.music?.status === 'loading') {
            cancelTask('music', 'Music');
        }

        state.forms.music = cloneDefaultForms().music;
        state.results.music = null;
        setMusicInlineError('');
        syncFormInputs();
        renderMusicResult();
        persistState();
        if (showSuccess) {
            setStatus('Music AI console cleared.', 'success');
        }
    }

    function downloadMusicResult() {
        const response = state.results.music?.raw;
        const payload = response?.result;
        const audioSource = getMusicAudioSource(payload);
        if (!audioSource) {
            if (showToast) showToast('No audio available to download.', 'error');
            return;
        }

        const extension = mimeToExtension(payload?.mimeType || 'audio/mpeg');
        const dateStamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = [
            'ai-lab',
            'music',
            slugify(payload?.mode || 'track'),
            slugify(state.forms.music.prompt || 'prompt'),
            dateStamp,
        ].join('-') + `.${extension}`;

        const link = document.createElement('a');
        if (payload?.audioBase64) {
            const bytes = Uint8Array.from(atob(payload.audioBase64), (char) => char.charCodeAt(0));
            const blob = new Blob([bytes], { type: payload.mimeType || 'audio/mpeg' });
            const href = URL.createObjectURL(blob);
            link.href = href;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(href), 1000);
        } else {
            link.href = payload.audioUrl;
            link.download = filename;
            link.target = '_blank';
            link.rel = 'noopener';
            document.body.appendChild(link);
            link.click();
            link.remove();
        }

        if (showToast) showToast('Music download started.');
    }

    function renderVideoEmptyState() {
        if (!refs.video.preview) return;
        refs.video.preview.innerHTML = `
            <div class="admin-ai__video-empty">
                <div class="admin-ai__video-empty-icon" aria-hidden="true"></div>
                <div class="admin-ai__video-empty-copy">
                    <strong>Studio standing by.</strong>
                    <span>Generate a video to inspect the output, metadata, and playback here.</span>
                </div>
            </div>
        `;
    }

    async function loadVideoBlob(url) {
        try {
            const res = await fetch(url);
            if (res.ok) return URL.createObjectURL(await res.blob());
        } catch { /* CORS or network — try proxy */ }

        try {
            const res = await fetch('/api/admin/ai/proxy-video', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            if (res.ok) return URL.createObjectURL(await res.blob());
        } catch { /* proxy unavailable */ }

        return null;
    }

    function revokePreviewBlobUrl() {
        if (state._previewBlobUrl) {
            URL.revokeObjectURL(state._previewBlobUrl);
            state._previewBlobUrl = null;
        }
    }

    function renderVideoPreview(payload, result) {
        if (!refs.video.preview) return;
        const videoUrl = payload?.videoUrl || null;
        refs.video.download.hidden = !videoUrl;
        refs.video.save.hidden = !videoUrl;

        revokePreviewBlobUrl();

        if (!videoUrl) {
            if (result?.status === 'loading' && !payload) {
                refs.video.preview.innerHTML = '<div class="admin-ai__loading"><div class="admin-ai__spinner"></div><span>Waiting for video output...</span></div>';
            } else if (result?.status === 'error' && !payload) {
                refs.video.preview.innerHTML = '<div class="admin-ai__empty">Video generation failed before any result was returned.</div>';
            } else if (payload) {
                refs.video.preview.innerHTML = '<div class="admin-ai__empty">The worker completed, but no playable video URL was returned.</div>';
            } else {
                renderVideoEmptyState();
            }
            return;
        }

        refs.video.preview.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'admin-ai__video-player';

        const head = document.createElement('div');
        head.className = 'admin-ai__video-player-head';

        const title = document.createElement('h4');
        title.className = 'admin-ai__video-player-title';
        const workflowLabel = formatVideoWorkflow(payload?.workflow, payload);
        title.textContent = workflowLabel === 'Text-to-Video'
            ? 'Generated Video'
            : `Generated Video (${workflowLabel})`;

        const note = document.createElement('div');
        note.className = 'admin-ai__video-player-note';
        note.textContent = 'Loading video preview\u2026';

        head.append(title, note);

        const video = document.createElement('video');
        video.controls = true;
        video.preload = 'auto';
        video.crossOrigin = 'anonymous';
        video.className = 'admin-ai__video-el';

        wrapper.append(head, video);
        refs.video.preview.appendChild(wrapper);

        loadVideoBlob(videoUrl).then(blobUrl => {
            if (blobUrl) {
                state._previewBlobUrl = blobUrl;
                video.src = blobUrl;
                note.textContent = 'Preview loaded. Use Save or Download to keep.';
            } else {
                video.crossOrigin = '';
                video.dataset.corsDisabled = '1';
                video.src = videoUrl;
                note.textContent = 'Streaming from provider URL. Poster capture may be unavailable.';
            }
        });
    }

    function renderVideoResult() {
        if (!refs.video.preview) return;
        const result = state.results.video;
        const response = result?.raw || null;
        const payload = response?.result || null;
        const resultCode = getResultCode(result);

        renderVideoPreview(payload, result);
        renderMeta(refs.video.meta, response ? [
            { label: 'Preset', value: response.preset || 'Preset default' },
            { label: 'Model Label', value: response.model?.label },
            { label: 'Model ID', value: response.model?.id },
            { label: 'Vendor', value: response.model?.vendor },
            { label: 'Elapsed', value: formatElapsed(response.elapsedMs) },
            { label: 'Received', value: formatTime(result?.receivedAt) },
            { label: 'Workflow', value: formatVideoWorkflow(payload?.workflow, payload) },
            { label: 'Duration', value: payload?.duration ? `${payload.duration} s` : null },
            { label: 'Aspect Ratio', value: payload?.aspect_ratio },
            { label: 'Quality', value: payload?.quality },
            { label: 'Resolution', value: payload?.resolution },
            { label: 'Seed', value: payload?.seed },
            {
                label: 'Audio',
                value: payload?.generate_audio === false ? 'Disabled' : payload?.generate_audio === true ? 'Enabled' : null,
            },
            {
                label: 'Reference Start',
                value: payload?.hasImageInput ? 'Yes' : payload?.workflow && payload?.workflow !== 'text_to_video' ? 'No' : null,
            },
            { label: 'Reference End', value: payload?.hasEndImageInput ? 'Yes' : null },
        ] : []);
        renderWarnings(refs.video.warnings, response ? getWarnings(response) : []);
        renderDebug(refs.video.debug, refs.video.raw, result?.debugRaw || response);

        if (!result) {
            setResultState(refs.video.state, 'neutral', 'No video generation yet.');
            syncVideoFieldState();
            return;
        }

        if (result.status === 'loading') {
            setResultState(
                refs.video.state,
                'loading',
                response ? 'Generating video. Previous result shown below.' : 'Generating video...'
            );
            syncVideoFieldState();
            return;
        }

        if (result.status === 'aborted') {
            setResultState(
                refs.video.state,
                'aborted',
                response ? 'Video request cancelled. Previous result preserved.' : 'Video request cancelled.'
            );
            syncVideoFieldState();
            return;
        }

        if (result.status === 'timeout') {
            setResultState(
                refs.video.state,
                'timeout',
                response
                    ? `${result.error || 'Video request timed out.'} Previous result preserved.`
                    : result.error || 'Video request timed out.'
            );
            syncVideoFieldState();
            return;
        }

        if (result.status === 'error') {
            setResultState(
                refs.video.state,
                'error',
                response
                    ? `${describeAdminAiError('video', result.error, resultCode)} Previous result preserved.`
                    : describeAdminAiError('video', result.error, resultCode)
            );
            syncVideoFieldState();
            return;
        }

        setResultState(refs.video.state, 'success', 'Video response ready.');
        syncVideoFieldState();
    }

    function validateVideoForm() {
        const spec = getSelectedVideoModelSpec();
        const prompt = (state.forms.video.prompt || '').trim();
        if (spec.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID) {
            const hasStartImage = !!state.forms.video.startImageInput;
            const hasEndImage = !!state.forms.video.endImageInput;
            if (hasEndImage && !hasStartImage) {
                return 'End frame requires a start frame before generating video.';
            }
            if (!prompt && !hasStartImage) {
                return 'Prompt or start frame is required before generating video.';
            }
            return '';
        }
        if (!prompt) {
            return 'Prompt is required before generating video.';
        }
        return '';
    }

    function resetVideoForm(showSuccess = true) {
        if (state.results.video?.status === 'loading') {
            cancelTask('video', 'Video');
        }

        state.forms.video = cloneDefaultForms().video;
        state.results.video = null;
        setVideoInlineError('');
        refs.video.imageFile.value = '';
        if (refs.video.startImageFile) refs.video.startImageFile.value = '';
        if (refs.video.endImageFile) refs.video.endImageFile.value = '';
        renderVideoImageSelection('imageInput', null);
        renderVideoImageSelection('startImageInput', null);
        renderVideoImageSelection('endImageInput', null);
        syncFormInputs();
        renderVideoResult();
        persistState();
        if (showSuccess) {
            setStatus('Video AI console cleared.', 'success');
        }
    }

    function downloadVideoResult() {
        const response = state.results.video?.raw;
        const payload = response?.result;
        const videoUrl = payload?.videoUrl;
        if (!videoUrl) {
            if (showToast) showToast('No video available to download.', 'error');
            return;
        }

        const dateStamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = [
            'ai-lab',
            'video',
            slugify(payload?.prompt || state.forms.video.prompt || payload?.workflow || 'video'),
            dateStamp,
        ].join('-') + '.mp4';

        const link = document.createElement('a');
        link.href = state._previewBlobUrl || videoUrl;
        link.download = filename;
        link.target = '_blank';
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();

        if (showToast) showToast('Video download started.');
    }

    function handleVideoImageFileSelection(formKey, inputEl, previewKey, label) {
        const file = inputEl?.files?.[0];
        if (!file) return;

        if (file.size > ADMIN_AI_LIMITS.video.maxImageInputBytes) {
            setVideoInlineError(`Image file exceeds ${ADMIN_AI_LIMITS.video.maxImageInputBytes / (1024 * 1024)} MB limit.`);
            inputEl.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            state.forms.video[formKey] = reader.result;
            setVideoInlineError(formKey === 'endImageInput' && !state.forms.video.startImageInput
                ? 'End frame requires a start frame before generating video.'
                : '');
            renderVideoImageSelection(previewKey, reader.result);
            syncVideoFieldState();
            persistState();
        };
        reader.onerror = () => {
            state.forms.video[formKey] = null;
            inputEl.value = '';
            setVideoInlineError(`Could not read the ${label} file.`);
            renderVideoImageSelection(previewKey, null, 'error');
            syncVideoFieldState();
            persistState();
        };
        reader.readAsDataURL(file);
    }

    function handleVideoImageFile() {
        handleVideoImageFileSelection('imageInput', refs.video.imageFile, 'imageInput', 'image');
    }

    function handleVideoStartImageFile() {
        handleVideoImageFileSelection('startImageInput', refs.video.startImageFile, 'startImageInput', 'start frame');
    }

    function handleVideoEndImageFile() {
        handleVideoImageFileSelection('endImageInput', refs.video.endImageFile, 'endImageInput', 'end frame');
    }

    function clearVideoImageSelection(formKey, inputEl, previewKey) {
        state.forms.video[formKey] = null;
        if (inputEl) inputEl.value = '';
        if (formKey === 'startImageInput' && state.forms.video.endImageInput) {
            state.forms.video.endImageInput = null;
            if (refs.video.endImageFile) refs.video.endImageFile.value = '';
            renderVideoImageSelection('endImageInput', null);
        }
        setVideoInlineError('');
        renderVideoImageSelection(previewKey, null);
        syncVideoFieldState();
        persistState();
    }

    function clearVideoImage() {
        clearVideoImageSelection('imageInput', refs.video.imageFile, 'imageInput');
    }

    function clearVideoStartImage() {
        clearVideoImageSelection('startImageInput', refs.video.startImageFile, 'startImageInput');
    }

    function clearVideoEndImage() {
        clearVideoImageSelection('endImageInput', refs.video.endImageFile, 'endImageInput');
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
        renderMusicResult();
        renderVideoResult();
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
        refs.music.run.disabled = noCatalog || state.results.music?.status === 'loading';
        refs.music.cancel.disabled = state.results.music?.status !== 'loading';
        if (refs.video.run) {
            refs.video.run.disabled = noCatalog || state.results.video?.status === 'loading';
            refs.video.cancel.disabled = state.results.video?.status !== 'loading';
        }
        refs.compare.run.disabled = noCatalog || state.results.compare?.status === 'loading';
        refs.compare.cancel.disabled = state.results.compare?.status !== 'loading';
        syncMusicFieldState();
        syncVideoFieldState();
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

    async function runMusic() {
        if (!hasCatalog()) {
            setStatus('Load the model catalog before generating music.', 'error');
            return;
        }

        const validationError = validateMusicForm();
        if (validationError) {
            const previous = getRetainedResult('music');
            state.results.music = previous.raw ? {
                status: 'error',
                error: validationError,
                errorCode: 'validation_error',
                raw: previous.raw,
                debugRaw: previous.raw,
                receivedAt: previous.receivedAt,
            } : {
                status: 'error',
                error: validationError,
                errorCode: 'validation_error',
                raw: null,
                debugRaw: null,
                receivedAt: null,
            };
            setMusicInlineError(validationError);
            setStatus(validationError, 'error');
            renderMusicResult();
            return;
        }

        setMusicInlineError('');
        const seq = ++state.requestSeq.music;
        clearTaskTimer('music');
        state.controllers.music?.abort();
        const controller = new AbortController();
        const previous = getRetainedResult('music');
        state.controllers.music = controller;
        state.results.music = {
            status: 'loading',
            errorCode: null,
            raw: previous.raw,
            debugRaw: previous.raw,
            receivedAt: previous.receivedAt,
        };
        setTaskBusy('music', true, TASK_UI.music.busyText, TASK_UI.music.idleText);
        setStatus('Generating music...', 'loading');
        renderMusicResult();
        startTaskTimer('music', controller);

        const payload = {
            preset: state.forms.music.preset || undefined,
            model: state.forms.music.model || undefined,
            prompt: (state.forms.music.prompt || '').trim(),
            mode: state.forms.music.mode,
            lyricsMode: state.forms.music.mode === 'instrumental' ? 'auto' : state.forms.music.lyricsMode,
        };
        if (state.forms.music.mode !== 'instrumental' && state.forms.music.lyricsMode === 'custom') {
            payload.lyrics = (state.forms.music.lyrics || '').trim();
        }
        if (state.forms.music.bpm !== '') {
            payload.bpm = Number(state.forms.music.bpm);
        }
        if (state.forms.music.key) {
            payload.key = state.forms.music.key;
        }

        const res = await apiAdminAiTestMusic(payload, {
            signal: controller.signal,
        });
        if (seq !== state.requestSeq.music) return;
        if (state.controllers.music === controller) {
            state.controllers.music = null;
        }
        clearTaskTimer('music', controller);
        setTaskBusy('music', false, TASK_UI.music.busyText, TASK_UI.music.idleText);

        if (res.aborted) return;
        if (!res.ok) {
            const errorCode = getApiCode(res);
            state.results.music = {
                status: 'error',
                error: res.error,
                errorCode,
                raw: previous.raw,
                debugRaw: res.data || previous.raw,
                receivedAt: previous.receivedAt,
            };
            setStatus(describeAdminAiError('music', res.error, errorCode), 'error');
            renderMusicResult();
            return;
        }

        state.results.music = {
            status: 'success',
            errorCode: getApiCode(res),
            raw: res.data,
            debugRaw: res.data,
            receivedAt: new Date(),
        };
        setStatus('Music generation completed.', 'success');
        renderMusicResult();
    }

    async function runVideo() {
        if (!hasCatalog()) {
            setStatus('Load the model catalog before generating video.', 'error');
            return;
        }

        const validationError = validateVideoForm();
        if (validationError) {
            const previous = getRetainedResult('video');
            state.results.video = previous.raw ? {
                status: 'error',
                error: validationError,
                errorCode: 'validation_error',
                raw: previous.raw,
                debugRaw: previous.raw,
                receivedAt: previous.receivedAt,
            } : {
                status: 'error',
                error: validationError,
                errorCode: 'validation_error',
                raw: null,
                debugRaw: null,
                receivedAt: null,
            };
            setVideoInlineError(validationError);
            setStatus(validationError, 'error');
            renderVideoResult();
            return;
        }

        setVideoInlineError('');
        const seq = ++state.requestSeq.video;
        clearTaskTimer('video');
        state.controllers.video?.abort();
        const controller = new AbortController();
        const previous = getRetainedResult('video');
        state.controllers.video = controller;
        state.results.video = {
            status: 'loading',
            errorCode: null,
            raw: previous.raw,
            debugRaw: previous.raw,
            receivedAt: previous.receivedAt,
        };
        setTaskBusy('video', true, TASK_UI.video.busyText, TASK_UI.video.idleText);
        setStatus('Generating video...', 'loading');
        renderVideoResult();
        startTaskTimer('video', controller);

        const videoSpec = getSelectedVideoModelSpec();
        const prompt = (state.forms.video.prompt || '').trim();
        const payload = {
            preset: videoSpec.defaultPreset || state.forms.video.preset || undefined,
            model: videoSpec.id,
            duration: Number(state.forms.video.duration),
        };

        if (videoSpec.id === ADMIN_AI_VIDEO_VIDU_Q3_PRO_MODEL_ID) {
            payload.resolution = state.forms.video.resolution;
            payload.audio = state.forms.video.generateAudio;
            if (prompt) {
                payload.prompt = prompt;
            }
            if (state.forms.video.startImageInput) {
                payload.start_image = state.forms.video.startImageInput;
            }
            if (state.forms.video.endImageInput) {
                payload.end_image = state.forms.video.endImageInput;
            }
            if (!state.forms.video.startImageInput && !state.forms.video.endImageInput) {
                payload.aspect_ratio = state.forms.video.aspectRatio;
            }
        } else {
            payload.prompt = prompt;
            payload.aspect_ratio = state.forms.video.aspectRatio;
            payload.quality = state.forms.video.quality;
            payload.generate_audio = state.forms.video.generateAudio;
            const negativePrompt = (state.forms.video.negativePrompt || '').trim();
            if (negativePrompt) {
                payload.negative_prompt = negativePrompt;
            }
            if (state.forms.video.seed !== '' && state.forms.video.seed !== null && state.forms.video.seed !== undefined) {
                payload.seed = Number(state.forms.video.seed);
            }
            if (state.forms.video.imageInput) {
                payload.image_input = state.forms.video.imageInput;
            }
        }

        const res = await apiAdminAiTestVideo(payload, {
            signal: controller.signal,
        });
        if (seq !== state.requestSeq.video) return;
        if (state.controllers.video === controller) {
            state.controllers.video = null;
        }
        clearTaskTimer('video', controller);
        setTaskBusy('video', false, TASK_UI.video.busyText, TASK_UI.video.idleText);

        if (res.aborted) return;
        if (!res.ok) {
            const errorCode = getApiCode(res);
            state.results.video = {
                status: 'error',
                error: res.error,
                errorCode,
                raw: previous.raw,
                debugRaw: res.data || previous.raw,
                receivedAt: previous.receivedAt,
            };
            setStatus(describeAdminAiError('video', res.error, errorCode), 'error');
            renderVideoResult();
            return;
        }

        state.results.video = {
            status: 'success',
            errorCode: getApiCode(res),
            raw: res.data,
            debugRaw: res.data,
            receivedAt: new Date(),
        };
        setStatus('Video generation completed.', 'success');
        renderVideoResult();
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

        if (state.activeMode === 'music') {
            resetMusicForm(true);
            setStatus('Music form reset.', 'success');
            return;
        }

        if (state.activeMode === 'video') {
            resetVideoForm(true);
            setStatus('Video form reset.', 'success');
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

        attachFieldSync(refs.music.prompt, 'music', 'prompt');
        attachFieldSync(refs.music.mode, 'music', 'mode');
        attachFieldSync(refs.music.lyricsMode, 'music', 'lyricsMode');
        attachFieldSync(refs.music.lyrics, 'music', 'lyrics');
        attachFieldSync(refs.music.bpm, 'music', 'bpm', (value) => value === '' ? '' : Number(value));
        attachFieldSync(refs.music.key, 'music', 'key');

        refs.music.prompt.addEventListener('input', () => setMusicInlineError(''));
        refs.music.mode.addEventListener('change', () => {
            setMusicInlineError('');
            syncMusicFieldState();
        });
        refs.music.lyricsMode.addEventListener('change', () => {
            setMusicInlineError('');
            syncMusicFieldState();
        });
        refs.music.lyrics.addEventListener('input', () => setMusicInlineError(''));

        if (refs.video.prompt) {
            attachFieldSync(refs.video.prompt, 'video', 'prompt');
            attachFieldSync(refs.video.negativePrompt, 'video', 'negativePrompt');
            attachFieldSync(refs.video.duration, 'video', 'duration', (value) => value === '' ? '' : Number(value));
            attachFieldSync(refs.video.aspectRatio, 'video', 'aspectRatio');
            attachFieldSync(refs.video.quality, 'video', 'quality');
            attachFieldSync(refs.video.resolution, 'video', 'resolution');
            attachFieldSync(refs.video.seed, 'video', 'seed');
            refs.video.generateAudio.addEventListener('change', () => {
                state.forms.video.generateAudio = refs.video.generateAudio.checked;
                persistState();
            });
            refs.video.prompt.addEventListener('input', () => setVideoInlineError(''));
            refs.video.imageFile?.addEventListener('change', handleVideoImageFile);
            refs.video.imageClear?.addEventListener('click', clearVideoImage);
            refs.video.startImageFile?.addEventListener('change', handleVideoStartImageFile);
            refs.video.startImageClear?.addEventListener('click', clearVideoStartImage);
            refs.video.endImageFile?.addEventListener('change', handleVideoEndImageFile);
            refs.video.endImageClear?.addEventListener('click', clearVideoEndImage);
            refs.video.modelCards.forEach((button) => {
                button.addEventListener('click', () => {
                    if (button.disabled) return;
                    setVideoInlineError('');
                    setVideoModel(button.dataset.aiVideoModel);
                });
            });
        }

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
        refs.music.run.addEventListener('click', runMusic);
        refs.music.cancel.addEventListener('click', () => cancelTask('music', 'Music'));
        refs.music.reset.addEventListener('click', () => resetMusicForm());
        if (refs.video.run) {
            refs.video.run.addEventListener('click', runVideo);
            refs.video.cancel.addEventListener('click', () => cancelTask('video', 'Video'));
            refs.video.reset.addEventListener('click', () => resetVideoForm());
        }
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
        refs.music.save.addEventListener('click', () => openSaveModal('music'));
        refs.music.download.addEventListener('click', downloadMusicResult);
        refs.music.copyRaw.addEventListener('click', () => {
            copyText(safeJson(state.results.music?.debugRaw || state.results.music?.raw), showToast, 'Raw JSON copied.');
        });
        if (refs.video.save) {
            refs.video.save.addEventListener('click', () => openSaveModal('video'));
            refs.video.download.addEventListener('click', downloadVideoResult);
            refs.video.copyRaw.addEventListener('click', () => {
                copyText(safeJson(state.results.video?.debugRaw || state.results.video?.raw), showToast, 'Raw JSON copied.');
            });
        }
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
