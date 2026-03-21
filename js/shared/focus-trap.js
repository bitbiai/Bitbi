/* ============================================================
   BITBI — Shared focus-trap utility
   Traps Tab key within a container for modal accessibility.
   ============================================================ */

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function setupFocusTrap(container) {
    const trigger = document.activeElement;
    const focusable = () => [...container.querySelectorAll(FOCUSABLE)];
    focusable()[0]?.focus();

    function handler(e) {
        if (e.key !== 'Tab') return;
        const els = focusable();
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey) {
            if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
            if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    }

    container.addEventListener('keydown', handler);
    return () => {
        container.removeEventListener('keydown', handler);
        if (trigger && typeof trigger.focus === 'function') trigger.focus();
    };
}
