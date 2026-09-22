import { setupFocusTrap } from '../../shared/focus-trap.js?v=__ASSET_VERSION__';

// Canvas owns only the dialog/session; folders, pagination and every card come
// from the same browser as Generate Lab. No asset is assigned while browsing.
export function createCanvasAssetPicker({ german, onApply }) {
    const overlay = document.getElementById('canvasAssetsOverlay');
    const shell = overlay.querySelector('.generate-lab-assets-overlay__shell');
    const body = overlay.querySelector('.generate-lab-assets-overlay__body');
    const closeButton = document.getElementById('canvasAssetsClose');
    const refs = Object.fromEntries(Object.entries({ root: 'Root', galleryFilter: 'Filter', folderGrid: 'FolderGrid',
        folderBack: 'FolderBack', folderBackBtn: 'FolderBackBtn', assetGrid: 'Grid', galleryMsg: 'Message',
        pickerActions: 'PickerActions', pickerCount: 'PickerCount', pickerApply: 'PickerApply', pickerCancel: 'PickerCancel',
    }).map(([key, suffix]) => [key, document.getElementById(`canvasAssets${suffix}`)]));
    const failed = german ? 'Das Asset konnte nicht zugewiesen werden. Bitte erneut versuchen.' : 'The asset could not be assigned. Please try again.';
    let browser, initialization, target, releaseFocus, background = [], applying = false;

    function close(force = false) {
        if (applying && !force) return;
        target = null;
        browser?.endPickerMode();
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('generate-lab-assets-open');
        for (const [element, inert] of background) element.inert = inert;
        background = [];
        releaseFocus?.(); releaseFocus = null;
        // Assignment rerenders the Inspector, replacing the original trigger.
        document.getElementById('canvasImageReferencesChoose')?.focus();
        document.getElementById('canvasAssetChoose')?.focus();
    }

    function busy(value) {
        applying = value;
        body.inert = value;
        closeButton.disabled = refs.pickerCancel.disabled = value;
        overlay.setAttribute('aria-busy', String(value));
    }

    function error(message) {
        refs.galleryMsg.textContent = message || failed;
        refs.galleryMsg.className = 'studio__msg studio__msg--error';
    }

    async function initialize() {
        const { createSavedAssetsBrowser } = await import('../../shared/saved-assets-browser.js?v=__ASSET_VERSION__');
        browser = createSavedAssetsBrowser({ refs });
        await browser.init();
        return browser;
    }

    async function open(context) {
        if (target || applying || !context.isCurrent()) return;
        target = context;
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('generate-lab-assets-open');
        background = [...document.body.children].filter(element => element !== overlay).map(element => [element, element.inert]);
        for (const [element] of background) element.inert = true;
        releaseFocus = setupFocusTrap(shell);
        closeButton.focus();
        refs.galleryMsg.textContent = german ? 'Assets werden geladen…' : 'Loading assets…';
        refs.galleryMsg.className = 'studio__msg studio__msg--info';
        try {
            initialization ||= initialize();
            await initialization;
            if (target !== context || !context.isCurrent()) return;
            await browser.startPickerMode({ max: context.max || 1, ...(context.references ? { mediaType: 'image', isAssetCompatible: asset => asset.asset_type === 'image' } : {}), initialView: 'folders', fetchFailedMessage: failed,
                onCancel: () => close(),
                onApply: async (assets) => {
                    if (applying || target !== context || !context.isCurrent()) { invalidate(); return false; }
                    busy(true);
                    try {
                        const applied = await onApply(context, context.references ? assets : assets[0]);
                        if (!applied && target === context) error(failed);
                        return applied === true && target === context && context.isCurrent();
                    } catch { if (target === context) error(failed); return false; }
                    finally { busy(false); }
                },
                onApplied: () => { if (target === context) close(); },
            });
        } catch { if (target === context) error(failed); }
    }

    function invalidate() { if (target && !target.isCurrent()) close(true); }
    closeButton.addEventListener('click', () => close());
    overlay.querySelector('[data-canvas-assets-close]').addEventListener('click', () => close());
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        if (['Delete', 'Backspace'].includes(event.key)) event.stopPropagation();
    });
    window.addEventListener('pagehide', () => close(true));
    return { open, invalidate, isOpen: () => !overlay.hidden };
}
