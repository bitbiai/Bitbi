/* ============================================================
   BITBI — Shared models overlay
   Reusable across the homepage and any page that mounts
   the shared site header.
   ============================================================ */

import {
    ADMIN_AI_MUSIC_MODEL_ID,
    ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID,
    ADMIN_AI_VIDEO_MODEL_ID,
    HAPPYHORSE_T2V_MODEL_LABEL,
    listAdminAiCatalog,
} from './admin-ai-contract.mjs?v=__ASSET_VERSION__';
import { getGenerateLabAiImageModelOptions } from './ai-image-models.mjs?v=__ASSET_VERSION__';
import { setupFocusTrap } from './focus-trap.js';
import { getCurrentLocale, localeText } from './locale.js?v=__ASSET_VERSION__';

const MODEL_GROUPS = [
    { task: 'image', categoryKey: 'models.imageGeneration', side: 'left' },
    { task: 'music', categoryKey: 'models.musicGeneration', side: 'right' },
    { task: 'video', categoryKey: 'models.videoGeneration', side: 'right' },
];

const USER_LIVE_MODELS = {
    image: getGenerateLabAiImageModelOptions(),
    music: [
        { id: ADMIN_AI_MUSIC_MODEL_ID, label: 'Music 2.6' },
    ],
    video: [
        { id: ADMIN_AI_VIDEO_MODEL_ID, label: 'PixVerse V6' },
        { id: ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID, label: HAPPYHORSE_T2V_MODEL_LABEL },
    ],
};

export const HOMEPAGE_MODELS_OVERLAY_EXCLUDED_MODEL_IDS = Object.freeze([
    '@cf/black-forest-labs/flux-2-dev',
]);

const STATUS_LABEL_KEYS = {
    included: 'models.included',
    live: 'models.live',
    'requires-credits': 'models.requiresCredits',
    'coming-soon': 'models.comingSoon',
};

function statusLabelForAvailability(availability) {
    return localeText(STATUS_LABEL_KEYS[availability] || 'models.comingSoon');
}

function buildCatalogSignature({ excludeModelIds = [] } = {}) {
    return JSON.stringify({
        locale: getCurrentLocale(),
        excludeModelIds: [...excludeModelIds].sort(),
    });
}

function buildModelCatalog({ excludeModelIds = [] } = {}) {
    const catalog = listAdminAiCatalog();
    const modelsByTask = catalog?.models || {};
    const excludedIds = new Set(excludeModelIds);

    return MODEL_GROUPS.map(({ task, categoryKey, side }) => ({
        category: localeText(categoryKey),
        side,
        models: (() => {
            const adminModels = Array.isArray(modelsByTask[task]) ? modelsByTask[task] : [];
            const liveModels = Array.isArray(USER_LIVE_MODELS[task]) ? USER_LIVE_MODELS[task] : [];
            const liveById = new Map(liveModels.filter((model) => model?.id).map((model) => [model.id, model]));
            const renderedLiveIds = new Set();
            const entries = [];

            for (const model of adminModels) {
                if (!model?.id || excludedIds.has(model.id)) continue;
                const liveModel = liveById.get(model.id);
                entries.push({
                    name: liveModel?.label || model.label || model.id,
                    vendor: model.vendor || liveModel?.vendor || '',
                    availability: liveModel ? 'live' : 'coming-soon',
                });
                if (liveModel) renderedLiveIds.add(model.id);
            }

            for (const model of liveModels) {
                if (!model?.id || renderedLiveIds.has(model.id) || excludedIds.has(model.id)) continue;
                entries.push({
                    name: model.label || model.id,
                    vendor: model.vendor || '',
                    availability: 'live',
                });
            }

            return entries.filter((model) => model.name);
        })(),
    })).filter((group) => group.models.length > 0);
}

let overlayEl = null;
let focusTrapCleanup = null;
let isOpen = false;
let didBindGlobals = false;
let modelCatalog = null;
let modelCatalogSignature = '';

function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'models-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', localeText('models.dialogLabel'));
    overlay.setAttribute('aria-hidden', 'true');

    const backdrop = document.createElement('div');
    backdrop.className = 'models-overlay__backdrop';
    overlay.appendChild(backdrop);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'models-overlay__close';
    close.setAttribute('aria-label', localeText('models.close'));
    close.innerHTML = '&times;';
    overlay.appendChild(close);

    const layout = document.createElement('div');
    layout.className = 'models-overlay__layout';

    const left = document.createElement('div');
    left.className = 'models-overlay__col models-overlay__col--left';

    const right = document.createElement('div');
    right.className = 'models-overlay__col models-overlay__col--right';

    let cardIndex = 0;
    for (const group of modelCatalog || buildModelCatalog()) {
        const section = document.createElement('div');
        section.className = 'models-overlay__group';
        section.style.setProperty('--group-delay', `${cardIndex * 60}ms`);

        const heading = document.createElement('h3');
        heading.className = 'models-overlay__category';
        heading.textContent = group.category;
        section.appendChild(heading);

        const list = document.createElement('ul');
        list.className = 'models-overlay__list';

        for (const model of group.models) {
            const li = document.createElement('li');
            li.className = 'models-overlay__card';
            li.style.setProperty('--card-delay', `${cardIndex * 60 + 80}ms`);
            li.dataset.modelAvailability = model.availability;

            const name = document.createElement('span');
            name.className = 'models-overlay__name';
            name.textContent = model.name;

            const meta = document.createElement('span');
            meta.className = 'models-overlay__meta';

            const vendor = document.createElement('span');
            vendor.className = 'models-overlay__vendor';
            vendor.textContent = model.vendor;

            const status = document.createElement('span');
            status.className = `models-overlay__status models-overlay__status--${model.availability}`;
            status.textContent = model.statusLabel || statusLabelForAvailability(model.availability);

            li.appendChild(name);
            meta.appendChild(vendor);
            meta.appendChild(status);
            li.appendChild(meta);
            list.appendChild(li);
            cardIndex++;
        }

        section.appendChild(list);

        if (group.side === 'left') left.appendChild(section);
        else right.appendChild(section);
    }

    layout.appendChild(left);
    layout.appendChild(right);
    overlay.appendChild(layout);

    return overlay;
}

function ensureOverlay() {
    if (overlayEl) return overlayEl;

    overlayEl = buildOverlay();
    document.body.appendChild(overlayEl);
    overlayEl.addEventListener('click', close);
    return overlayEl;
}

function configureCatalog(options = {}) {
    const signature = buildCatalogSignature(options);
    if (signature === modelCatalogSignature && modelCatalog) return;

    if (isOpen) close();
    overlayEl?.remove();
    overlayEl = null;
    modelCatalog = buildModelCatalog(options);
    modelCatalogSignature = signature;
}

function open() {
    if (isOpen) return;
    isOpen = true;

    const overlay = ensureOverlay();
    overlay.setAttribute('aria-hidden', 'false');

    /* Force reflow before adding active class so entrance animation triggers. */
    void overlay.offsetHeight;
    overlay.classList.add('is-active');
    document.body.style.overflow = 'hidden';
    focusTrapCleanup = setupFocusTrap(overlay);
}

function close() {
    if (!isOpen) return;
    isOpen = false;

    if (overlayEl) {
        overlayEl.classList.remove('is-active');
        overlayEl.setAttribute('aria-hidden', 'true');
    }

    document.body.style.overflow = '';
    if (focusTrapCleanup) {
        focusTrapCleanup();
        focusTrapCleanup = null;
    }

    if (window.location.hash === '#models') {
        history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
}

function handleKey(event) {
    if (event.key === 'Escape' && isOpen) close();
}

function closeMobileNav() {
    const closeBtn = document.getElementById('mobileNavClose');
    if (closeBtn) closeBtn.click();
}

function handleTrigger(event, isMobile) {
    event.preventDefault();

    if (isMobile) {
        closeMobileNav();
        /* Small delay so the mobile panel closes before the overlay opens. */
        setTimeout(() => { open(); }, 120);
        return;
    }

    if (isOpen) close();
    else open();
}

function bindTrigger(trigger) {
    if (!trigger || trigger.dataset.modelsOverlayBound === 'true') return;

    const isMobile = trigger.dataset.modelsLink === 'mobile';
    trigger.dataset.modelsOverlayBound = 'true';
    trigger.addEventListener('click', (event) => handleTrigger(event, isMobile));
}

function syncModelsHash() {
    if (window.location.hash === '#models') {
        open();
    } else if (isOpen) {
        close();
    }
}

export function initModelsOverlay(root = document, { excludeModelIds = [] } = {}) {
    configureCatalog({ excludeModelIds });
    root.querySelectorAll('[data-models-link]').forEach(bindTrigger);

    if (didBindGlobals) return;
    didBindGlobals = true;

    document.addEventListener('keydown', handleKey);
    window.addEventListener('hashchange', syncModelsHash);

    if (window.location.hash === '#models') {
        requestAnimationFrame(syncModelsHash);
    }
}
