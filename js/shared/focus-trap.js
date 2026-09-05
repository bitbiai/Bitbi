/* ============================================================
   BITBI — Shared modal focus trap
   ============================================================ */

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]';
const activeTraps = [];

function isAvailable(element) {
    return element.isConnected
        && !element.matches(':disabled')
        && !element.closest('[inert], [aria-hidden="true"]')
        && element.getClientRects().length > 0
        && !['hidden', 'collapse'].includes(getComputedStyle(element).visibility);
}

export function setupFocusTrap(container) {
    const trigger = document.activeElement;
    const trap = {};
    activeTraps.push(trap);
    let disposed = false;
    let addedTabIndex = false;
    const focusable = () => [...container.querySelectorAll(FOCUSABLE)]
        .filter(element => element.tabIndex >= 0 && isAvailable(element));

    function focusContainer() {
        if (!container.hasAttribute('tabindex')) {
            container.setAttribute('tabindex', '-1');
            addedTabIndex = true;
        }
        container.focus();
    }

    const initial = focusable()[0];
    if (initial) initial.focus();
    else focusContainer();

    function handler(event) {
        if (event.key !== 'Tab' || activeTraps.at(-1) !== trap) return;
        const elements = focusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (!first) {
            event.preventDefault();
            focusContainer();
        } else if (!container.contains(document.activeElement) || !isAvailable(document.activeElement)) {
            // A pending action may disable/remove the focused control.
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
    // Capture also contains Tab after a dynamic control is removed. Only the
    // newest trap handles nested dialogs, even when they stop propagation.
    document.addEventListener('keydown', handler, true);
    return () => {
        if (disposed) return;
        disposed = true;
        const wasActive = activeTraps.at(-1) === trap;
        activeTraps.splice(activeTraps.indexOf(trap), 1);
        document.removeEventListener('keydown', handler, true);
        if (addedTabIndex && container.getAttribute('tabindex') === '-1') container.removeAttribute('tabindex');
        if (wasActive && trigger && isAvailable(trigger) && typeof trigger.focus === 'function') trigger.focus();
    };
}
