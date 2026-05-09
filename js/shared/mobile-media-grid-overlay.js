import { setupFocusTrap } from './focus-trap.js';
import { localeText } from './locale.js?v=__ASSET_VERSION__';

const MOBILE_MEDIA_QUERY = '(max-width: 639px)';

let activeOverlay = null;
let activeDetailOverlay = null;
let focusTrapCleanup = null;
let detailFocusTrapCleanup = null;
let detailContentCleanup = null;
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
    closeMobileMediaDetail();
    activeOverlay.remove();
    activeOverlay = null;
    document.body.style.overflow = previousBodyOverflow;
    previousBodyOverflow = '';
    if (focusTrapCleanup) {
        focusTrapCleanup();
        focusTrapCleanup = null;
    }
}

function closeMobileMediaDetail() {
    if (!activeDetailOverlay) return;
    if (typeof detailContentCleanup === 'function') {
        try {
            detailContentCleanup();
        } catch (error) {
            console.warn('mobile media detail cleanup:', error);
        }
    }
    detailContentCleanup = null;
    if (detailFocusTrapCleanup) {
        detailFocusTrapCleanup();
        detailFocusTrapCleanup = null;
    }
    activeDetailOverlay.remove();
    activeDetailOverlay = null;
    activeOverlay?.classList.remove('has-detail');
    activeOverlay?.querySelector('.mobile-media-grid-overlay__close')?.focus();
}

function handleOverlayKeydown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (activeDetailOverlay) {
        closeMobileMediaDetail();
        return;
    }
    closeMobileMediaGrid();
}

function openMobileMediaDetail({
    title = 'Media detail',
    className = '',
    renderContent,
} = {}) {
    if (!activeOverlay || typeof renderContent !== 'function') return;
    closeMobileMediaDetail();

    const detail = document.createElement('div');
    detail.className = `mobile-media-detail-overlay${className ? ` ${className}` : ''}`;
    detail.setAttribute('role', 'dialog');
    detail.setAttribute('aria-modal', 'true');
    detail.setAttribute('aria-label', title);

    const shell = document.createElement('div');
    shell.className = 'mobile-media-detail-overlay__shell';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mobile-media-detail-overlay__close';
    close.setAttribute('aria-label', localeText('browse.backToMediaGrid'));
    close.textContent = localeText('browse.back');
    close.addEventListener('click', closeMobileMediaDetail);

    const heading = createTextElement('h3', 'mobile-media-detail-overlay__title', title);
    const body = document.createElement('div');
    body.className = 'mobile-media-detail-overlay__body';

    const rendered = renderContent({
        closeDetail: closeMobileMediaDetail,
        closeGrid: closeMobileMediaGrid,
    });
    const node = rendered?.node || rendered;
    if (node instanceof HTMLElement) {
        body.appendChild(node);
    }
    if (typeof rendered?.cleanup === 'function') {
        detailContentCleanup = rendered.cleanup;
    }

    shell.append(close, heading, body);
    detail.appendChild(shell);
    detail.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') event.stopPropagation();
    });

    activeOverlay.appendChild(detail);
    activeOverlay.classList.add('has-detail');
    activeDetailOverlay = detail;
    detailFocusTrapCleanup = setupFocusTrap(detail);
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
    close.setAttribute('aria-label', localeText('browse.closeMediaGrid'));
    close.textContent = localeText('browse.close');
    close.addEventListener('click', closeMobileMediaGrid);

    const heading = createTextElement('h3', 'mobile-media-grid-overlay__title', title || 'Media');
    const grid = document.createElement('div');
    grid.className = 'mobile-media-grid-overlay__grid';

    const safeItems = Array.isArray(items) ? items : [];
    if (!safeItems.length || typeof renderItem !== 'function') {
        grid.appendChild(createTextElement('p', 'mobile-media-grid-overlay__empty', emptyText));
    } else {
        safeItems.forEach((item, index) => {
            const node = renderItem(item, index, {
                openDetail: openMobileMediaDetail,
                closeGrid: closeMobileMediaGrid,
            });
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
