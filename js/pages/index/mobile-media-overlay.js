import { setupFocusTrap } from '../../shared/focus-trap.js';

const MOBILE_MEDIA_QUERY = '(max-width: 639px)';

let activeOverlay = null;
let focusTrapCleanup = null;
let previousBodyOverflow = '';

export function isMobileMediaGridEnabled() {
    return window.matchMedia?.(MOBILE_MEDIA_QUERY).matches === true;
}

export function getMobileMediaGridQuery() {
    return window.matchMedia?.(MOBILE_MEDIA_QUERY) || null;
}

export function syncMobileMediaTrigger(button, {
    enabled = true,
    label = 'Open media grid',
} = {}) {
    if (!button) return;
    const active = !!enabled && isMobileMediaGridEnabled();
    button.disabled = !active;
    button.classList.toggle('browse-pagination__status--trigger', active);
    button.setAttribute('aria-label', active ? label : button.textContent.trim() || label);
}

function createTextElement(tagName, className, text) {
    const el = document.createElement(tagName);
    if (className) el.className = className;
    el.textContent = text || '';
    return el;
}

function closeMobileMediaGrid() {
    if (!activeOverlay) return;
    activeOverlay.remove();
    activeOverlay = null;
    document.body.style.overflow = previousBodyOverflow;
    previousBodyOverflow = '';
    if (focusTrapCleanup) {
        focusTrapCleanup();
        focusTrapCleanup = null;
    }
}

function handleOverlayKeydown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeMobileMediaGrid();
}

export function openMobileMediaGrid({
    title,
    items = [],
    emptyText = 'No media available.',
    className = '',
    renderItem,
} = {}) {
    if (!isMobileMediaGridEnabled()) return;
    closeMobileMediaGrid();

    const overlay = document.createElement('div');
    overlay.className = `mobile-media-grid-overlay${className ? ` ${className}` : ''}`;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title || 'Media grid');

    const shell = document.createElement('div');
    shell.className = 'mobile-media-grid-overlay__shell';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mobile-media-grid-overlay__close';
    close.setAttribute('aria-label', 'Close media grid');
    close.textContent = 'Close';
    close.addEventListener('click', closeMobileMediaGrid);

    const heading = createTextElement('h3', 'mobile-media-grid-overlay__title', title || 'Media');
    const grid = document.createElement('div');
    grid.className = 'mobile-media-grid-overlay__grid';

    const safeItems = Array.isArray(items) ? items : [];
    if (!safeItems.length || typeof renderItem !== 'function') {
        grid.appendChild(createTextElement('p', 'mobile-media-grid-overlay__empty', emptyText));
    } else {
        safeItems.forEach((item, index) => {
            const node = renderItem(item, index);
            if (node instanceof HTMLElement) {
                grid.appendChild(node);
            }
        });
    }

    shell.append(close, heading, grid);
    overlay.appendChild(shell);
    overlay.addEventListener('keydown', handleOverlayKeydown);
    document.body.appendChild(overlay);

    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    activeOverlay = overlay;
    focusTrapCleanup = setupFocusTrap(overlay);
}

