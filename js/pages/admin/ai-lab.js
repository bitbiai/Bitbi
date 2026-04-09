import {
    apiAdminAiCompare,
    apiAdminAiModels,
    apiAdminAiTestEmbeddings,
    apiAdminAiTestImage,
    apiAdminAiTestText,
} from '../../shared/auth-api.js';

const STORAGE_KEY = 'bitbi_admin_ai_lab_state_v1';
const MODES = ['models', 'text', 'image', 'embeddings', 'compare'];
const HISTORY_LIMIT = 6;

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
        width: 1024,
        height: 1024,
        steps: 4,
        seed: '',
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

function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
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
        forms: mergeForms(persisted?.forms),
        history: mergeHistory(persisted?.history),
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
        requestSeq: {
            models: 0,
            text: 0,
            image: 0,
            embeddings: 0,
            compare: 0,
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
            debug: document.getElementById('aiTextDebug'),
            raw: document.getElementById('aiTextRaw'),
            copyRaw: document.getElementById('aiTextCopyRaw'),
        },
        image: {
            preset: document.getElementById('aiImagePreset'),
            model: document.getElementById('aiImageModel'),
            sampleSelect: document.getElementById('aiImageSampleSelect'),
            prompt: document.getElementById('aiImagePrompt'),
            promptCount: document.getElementById('aiImagePromptCount'),
            width: document.getElementById('aiImageWidth'),
            height: document.getElementById('aiImageHeight'),
            steps: document.getElementById('aiImageSteps'),
            seed: document.getElementById('aiImageSeed'),
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
            debug: document.getElementById('aiImageDebug'),
            raw: document.getElementById('aiImageRaw'),
            copyRaw: document.getElementById('aiImageCopyRaw'),
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
            bLabel: document.getElementById('aiCompareBLabel'),
            bMeta: document.getElementById('aiCompareBMeta'),
            bText: document.getElementById('aiCompareBText'),
            bUsage: document.getElementById('aiCompareBUsage'),
            bError: document.getElementById('aiCompareBError'),
            bCopy: document.getElementById('aiCompareBCopy'),
            debug: document.getElementById('aiCompareDebug'),
            raw: document.getElementById('aiCompareRaw'),
            copyRaw: document.getElementById('aiCompareCopyRaw'),
        },
    };

    function persistState() {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    activeMode: state.activeMode,
                    forms: state.forms,
                    history: state.history,
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
        refs.image.width.value = state.forms.image.width;
        refs.image.height.value = state.forms.image.height;
        refs.image.steps.value = state.forms.image.steps;
        refs.image.seed.value = state.forms.image.seed;

        refs.embeddings.input.value = state.forms.embeddings.input;

        refs.compare.system.value = state.forms.compare.system;
        refs.compare.prompt.value = state.forms.compare.prompt;
        refs.compare.maxTokens.value = state.forms.compare.maxTokens;
        refs.compare.temperature.value = state.forms.compare.temperature;

        populateSelects();
        updateCounters();
        renderHistories();
    }

    function updateCounters() {
        updateCounter(refs.text.system, refs.text.systemCount, 1200);
        updateCounter(refs.text.prompt, refs.text.promptCount, 4000);
        updateCounter(refs.image.prompt, refs.image.promptCount, 2048);
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
    }

    function renderResetLabel() {
        const label = state.activeMode === 'models' ? 'Refresh View' : 'Reset Current Form';
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

        refs.text.output.textContent = outputText;
        refs.text.copy.hidden = !outputText;

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

        if (result.status === 'error') {
            setResultState(
                refs.text.state,
                'error',
                response
                    ? `${result.error || 'Text request failed.'} Previous result preserved.`
                    : result.error || 'Text request failed.'
            );
            return;
        }

        setResultState(refs.text.state, 'success', 'Text response ready.');
    }

    function renderImageResult() {
        const result = state.results.image;
        const response = result?.raw || null;
        const payload = response?.result || {};

        refs.image.preview.innerHTML = '<div class="admin-ai__empty">Run an image test to see the preview.</div>';
        refs.image.download.hidden = true;

        if (payload.imageBase64) {
            const img = document.createElement('img');
            img.className = 'admin-ai__image';
            img.src = `data:${payload.mimeType || 'image/png'};base64,${payload.imageBase64}`;
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
            { label: 'Mime', value: payload.mimeType },
            { label: 'Steps', value: payload.steps },
            { label: 'Seed', value: payload.seed },
            {
                label: 'Requested Size',
                value: payload.requestedSize
                    ? `${payload.requestedSize.width}×${payload.requestedSize.height}`
                    : null,
            },
            {
                label: 'Applied Size',
                value: payload.appliedSize
                    ? `${payload.appliedSize.width}×${payload.appliedSize.height}`
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

        if (result.status === 'error') {
            setResultState(
                refs.image.state,
                'error',
                response
                    ? `${result.error || 'Image request failed.'} Previous result preserved.`
                    : result.error || 'Image request failed.'
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
        const firstVector = Array.isArray(payload.vectors?.[0]) ? payload.vectors[0] : [];
        const preview = firstVector.slice(0, 8).map((value) => Number(value).toFixed(4)).join(', ');

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

        if (result.status === 'error') {
            setResultState(
                refs.embeddings.state,
                'error',
                response
                    ? `${result.error || 'Embeddings request failed.'} Previous result preserved.`
                    : result.error || 'Embeddings request failed.'
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

    function renderCompareCard(cardRefs, entry) {
        cardRefs.error.hidden = true;
        cardRefs.usage.hidden = true;
        cardRefs.copy.hidden = true;
        cardRefs.text.textContent = '';

        if (!entry) {
            cardRefs.label.textContent = 'Waiting for run';
            cardRefs.meta.textContent = '';
            cardRefs.error.textContent = '';
            return;
        }

        cardRefs.label.textContent = entry.model?.label || entry.model?.id || 'Model';
        cardRefs.meta.textContent = [
            entry.model?.id || '',
            entry.model?.vendor || '',
            typeof entry.elapsedMs === 'number' ? formatElapsed(entry.elapsedMs) : '',
        ]
            .filter(Boolean)
            .join(' · ');

        if (!entry.ok) {
            cardRefs.error.hidden = false;
            cardRefs.error.textContent = entry.error || 'Model run failed.';
            return;
        }

        cardRefs.text.textContent = entry.text || '';
        cardRefs.copy.hidden = !entry.text;

        if (isObject(entry.usage)) {
            cardRefs.usage.hidden = false;
            cardRefs.usage.textContent = Object.entries(entry.usage)
                .map(([key, value]) => `${key}: ${formatValue(value)}`)
                .join(' · ');
        }
    }

    function renderCompareResult() {
        const result = state.results.compare;
        const response = result?.raw || null;
        const entries = Array.isArray(response?.result?.results) ? response.result.results : [];

        renderMeta(refs.compare.meta, response ? [
            { label: 'Elapsed', value: formatElapsed(response.elapsedMs) },
            { label: 'Received', value: formatTime(result?.receivedAt) },
            { label: 'Models', value: entries.length },
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
            },
            entries[0] || null
        );
        renderCompareCard(
            {
                label: refs.compare.bLabel,
                meta: refs.compare.bMeta,
                text: refs.compare.bText,
                usage: refs.compare.bUsage,
                error: refs.compare.bError,
                copy: refs.compare.bCopy,
            },
            entries[1] || null
        );

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

        if (result.status === 'error') {
            setResultState(
                refs.compare.state,
                'error',
                response
                    ? `${result.error || 'Compare request failed.'} Previous result preserved.`
                    : result.error || 'Compare request failed.'
            );
            return;
        }

        setResultState(refs.compare.state, 'success', 'Compare response ready.');
    }

    function renderAll() {
        setMode(state.activeMode);
        renderCatalogMeta();
        renderModelsPanel();
        renderTextResult();
        renderImageResult();
        renderEmbeddingsResult();
        renderCompareResult();
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
        controller.abort();
        state.controllers[task] = null;
        state.results[task] = {
            status: 'aborted',
            error: 'Request cancelled.',
            raw: previous.raw,
            debugRaw: previous.raw,
            receivedAt: previous.receivedAt,
        };

        const busyLabels = {
            text: ['Running...', 'Run Text Test'],
            image: ['Generating...', 'Run Image Test'],
            embeddings: ['Running...', 'Run Embeddings'],
            compare: ['Comparing...', 'Run Compare'],
        };
        const [busyText, idleText] = busyLabels[task];
        setTaskBusy(task, false, busyText, idleText);
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
            state.catalog.error = res.error || 'Model catalog unavailable.';
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
        state.controllers.text?.abort();
        const controller = new AbortController();
        const previous = getRetainedResult('text');
        state.controllers.text = controller;
        state.results.text = {
            status: 'loading',
            raw: previous.raw,
            debugRaw: previous.raw,
            receivedAt: previous.receivedAt,
        };
        setTaskBusy('text', true, 'Running...', 'Run Text Test');
        setStatus('Running text test...', 'loading');
        renderTextResult();

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
        setTaskBusy('text', false, 'Running...', 'Run Text Test');

        if (res.aborted) return;
        if (!res.ok) {
            state.results.text = {
                status: 'error',
                error: res.error,
                raw: previous.raw,
                debugRaw: res.data || previous.raw,
                receivedAt: previous.receivedAt,
            };
            setStatus(res.error || 'Text test failed.', 'error');
            renderTextResult();
            return;
        }

        state.results.text = {
            status: 'success',
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
        state.controllers.image?.abort();
        const controller = new AbortController();
        const previous = getRetainedResult('image');
        state.controllers.image = controller;
        state.results.image = {
            status: 'loading',
            raw: previous.raw,
            debugRaw: previous.raw,
            receivedAt: previous.receivedAt,
        };
        setTaskBusy('image', true, 'Generating...', 'Run Image Test');
        setStatus('Generating image...', 'loading');
        renderImageResult();

        const payload = {
            preset: state.forms.image.preset || undefined,
            model: state.forms.image.model || undefined,
            prompt: state.forms.image.prompt,
            width: Number(state.forms.image.width),
            height: Number(state.forms.image.height),
            steps: Number(state.forms.image.steps),
        };
        if (state.forms.image.seed !== '') {
            payload.seed = Number(state.forms.image.seed);
        }

        const res = await apiAdminAiTestImage(payload, {
            signal: controller.signal,
        });
        if (seq !== state.requestSeq.image) return;
        if (state.controllers.image === controller) {
            state.controllers.image = null;
        }
        setTaskBusy('image', false, 'Generating...', 'Run Image Test');

        if (res.aborted) return;
        if (!res.ok) {
            state.results.image = {
                status: 'error',
                error: res.error,
                raw: previous.raw,
                debugRaw: res.data || previous.raw,
                receivedAt: previous.receivedAt,
            };
            setStatus(res.error || 'Image test failed.', 'error');
            renderImageResult();
            return;
        }

        state.results.image = {
            status: 'success',
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
        state.controllers.embeddings?.abort();
        const controller = new AbortController();
        const previous = getRetainedResult('embeddings');
        state.controllers.embeddings = controller;
        state.results.embeddings = {
            status: 'loading',
            raw: previous.raw,
            debugRaw: previous.raw,
            receivedAt: previous.receivedAt,
        };
        setTaskBusy('embeddings', true, 'Running...', 'Run Embeddings');
        setStatus('Generating embeddings...', 'loading');
        renderEmbeddingsResult();

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
        setTaskBusy('embeddings', false, 'Running...', 'Run Embeddings');

        if (res.aborted) return;
        if (!res.ok) {
            state.results.embeddings = {
                status: 'error',
                error: res.error,
                raw: previous.raw,
                debugRaw: res.data || previous.raw,
                receivedAt: previous.receivedAt,
            };
            setStatus(res.error || 'Embeddings test failed.', 'error');
            renderEmbeddingsResult();
            return;
        }

        state.results.embeddings = {
            status: 'success',
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
        state.controllers.compare?.abort();
        const controller = new AbortController();
        const previous = getRetainedResult('compare');
        state.controllers.compare = controller;
        state.results.compare = {
            status: 'loading',
            raw: previous.raw,
            debugRaw: previous.raw,
            receivedAt: previous.receivedAt,
        };
        setTaskBusy('compare', true, 'Comparing...', 'Run Compare');
        setStatus('Running model comparison...', 'loading');
        renderCompareResult();

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
        setTaskBusy('compare', false, 'Comparing...', 'Run Compare');

        if (res.aborted) return;
        if (!res.ok) {
            state.results.compare = {
                status: 'error',
                error: res.error,
                raw: previous.raw,
                debugRaw: res.data || previous.raw,
                receivedAt: previous.receivedAt,
            };
            setStatus(res.error || 'Compare request failed.', 'error');
            renderCompareResult();
            return;
        }

        state.results.compare = {
            status: 'success',
            raw: res.data,
            debugRaw: res.data,
            receivedAt: new Date(),
        };
        setStatus('Compare request completed.', 'success');
        renderCompareResult();
    }

    function resetCurrentForm() {
        if (state.activeMode === 'models') {
            renderModelsPanel();
            setStatus('Model catalog view refreshed.', 'success');
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
        refs.text.copyRaw.addEventListener('click', () => {
            copyText(safeJson(state.results.text?.debugRaw || state.results.text?.raw), showToast, 'Raw JSON copied.');
        });
        refs.image.download.addEventListener('click', downloadImageResult);
        refs.image.copyRaw.addEventListener('click', () => {
            copyText(safeJson(state.results.image?.debugRaw || state.results.image?.raw), showToast, 'Raw JSON copied.');
        });
        refs.embeddings.copyRaw.addEventListener('click', () => {
            copyText(safeJson(state.results.embeddings?.debugRaw || state.results.embeddings?.raw), showToast, 'Raw JSON copied.');
        });
        refs.compare.copyRaw.addEventListener('click', () => {
            copyText(safeJson(state.results.compare?.debugRaw || state.results.compare?.raw), showToast, 'Raw JSON copied.');
        });
        refs.compare.aCopy.addEventListener('click', () => {
            copyText(state.results.compare?.raw?.result?.results?.[0]?.text || '', showToast, 'Compare output copied.');
        });
        refs.compare.bCopy.addEventListener('click', () => {
            copyText(state.results.compare?.raw?.result?.results?.[1]?.text || '', showToast, 'Compare output copied.');
        });
    }

    return {
        init() {
            if (state.initialized) return;
            state.initialized = true;
            bindEvents();
            syncFormInputs();
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
