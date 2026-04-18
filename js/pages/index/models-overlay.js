/* ============================================================
   BITBI — Models overlay for homepage
   Presents the AI model catalog around the hero image.
   ============================================================ */

import { setupFocusTrap } from '../../shared/focus-trap.js';

/* ── Model catalog (presentation-layer extract) ──
   Source of truth: js/shared/admin-ai-contract.mjs REGISTRY.
   Only display-safe fields are kept here to avoid importing
   the full contract (validation, limits, etc.) into the
   client bundle. Keep in sync with admin-ai-contract.mjs. */
const MODEL_CATALOG = [
    {
        category: 'Text Generation',
        side: 'left',
        models: [
            { name: 'Llama 3.1 8B Instruct', vendor: 'Meta' },
            { name: 'Llama 3.3 70B Instruct', vendor: 'Meta' },
            { name: 'Gemma 4 26B A4B', vendor: 'Google' },
            { name: 'GPT OSS 20B', vendor: 'OpenAI' },
            { name: 'GPT OSS 120B', vendor: 'OpenAI' },
        ],
    },
    {
        category: 'Embeddings',
        side: 'left',
        models: [
            { name: 'BGE M3', vendor: 'BAAI' },
            { name: 'EmbeddingGemma 300M', vendor: 'Google' },
        ],
    },
    {
        category: 'Image Generation',
        side: 'right',
        models: [
            { name: 'FLUX.1 Schnell', vendor: 'Black Forest Labs' },
            { name: 'FLUX.2 Klein 9B', vendor: 'Black Forest Labs' },
            { name: 'FLUX.2 Dev', vendor: 'Black Forest Labs' },
        ],
    },
    {
        category: 'Music',
        side: 'right',
        models: [
            { name: 'Music 2.6', vendor: 'MiniMax' },
        ],
    },
];

let overlayEl = null;
let focusTrapCleanup = null;
let isOpen = false;

function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'models-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'AI Models');
    overlay.setAttribute('aria-hidden', 'true');

    const backdrop = document.createElement('div');
    backdrop.className = 'models-overlay__backdrop';
    overlay.appendChild(backdrop);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'models-overlay__close';
    close.setAttribute('aria-label', 'Close models');
    close.innerHTML = '&times;';
    overlay.appendChild(close);

    const layout = document.createElement('div');
    layout.className = 'models-overlay__layout';

    const left = document.createElement('div');
    left.className = 'models-overlay__col models-overlay__col--left';

    const right = document.createElement('div');
    right.className = 'models-overlay__col models-overlay__col--right';

    let cardIndex = 0;
    for (const group of MODEL_CATALOG) {
        const section = document.createElement('div');
        section.className = 'models-overlay__group';
        section.style.setProperty('--group-delay', `${cardIndex * 60}ms`);

        const heading = document.createElement('h3');
        heading.className = 'models-overlay__category';
        heading.textContent = group.category;
        section.appendChild(heading);

        const list = document.createElement('ul');
        list.className = 'models-overlay__list';

        for (const m of group.models) {
            const li = document.createElement('li');
            li.className = 'models-overlay__card';
            li.style.setProperty('--card-delay', `${cardIndex * 60 + 80}ms`);

            const name = document.createElement('span');
            name.className = 'models-overlay__name';
            name.textContent = m.name;

            const vendor = document.createElement('span');
            vendor.className = 'models-overlay__vendor';
            vendor.textContent = m.vendor;

            li.appendChild(name);
            li.appendChild(vendor);
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

function open() {
    if (isOpen) return;
    isOpen = true;

    if (!overlayEl) {
        overlayEl = buildOverlay();
        document.body.appendChild(overlayEl);

        overlayEl.addEventListener('click', close);
    }

    overlayEl.setAttribute('aria-hidden', 'false');
    /* Force reflow before adding active class so entrance animation triggers */
    void overlayEl.offsetHeight;
    overlayEl.classList.add('is-active');
    document.body.style.overflow = 'hidden';
    focusTrapCleanup = setupFocusTrap(overlayEl);
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
}

function handleKey(e) {
    if (e.key === 'Escape' && isOpen) close();
}

function closeMobileNav() {
    const closeBtn = document.getElementById('mobileNavClose');
    if (closeBtn) closeBtn.click();
}

function handleTrigger(e, isMobile) {
    e.preventDefault();
    if (isMobile) {
        closeMobileNav();
        /* Small delay so mobile panel closes before overlay opens */
        setTimeout(() => { open(); }, 120);
    } else {
        if (isOpen) close();
        else open();
    }
}

export function initModelsOverlay() {
    /* Desktop nav triggers */
    document.querySelectorAll('.site-nav__link--inert').forEach(trigger => {
        trigger.style.cursor = 'pointer';
        trigger.addEventListener('click', (e) => handleTrigger(e, false));
        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') handleTrigger(e, false);
        });
    });

    /* Mobile nav triggers */
    document.querySelectorAll('.mobile-nav__link--inert').forEach(trigger => {
        trigger.style.cursor = 'pointer';
        trigger.addEventListener('click', (e) => handleTrigger(e, true));
    });

    document.addEventListener('keydown', handleKey);
}
