// The menu owns presentation/focus only. Actions use the editor's existing commands.
export function createCanvasGraphActions({ viewport, german, run }) {
    const menu = document.createElement('div');
    menu.className = 'canvas-node-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', german ? 'Node-Aktionen' : 'Node actions');
    menu.hidden = true;
    document.body.append(menu);
    let current = null;
    const labels = german
        ? { inspect: 'Im Inspector bearbeiten', focus: 'Node in die Mitte holen', connect: 'Von hier verbinden', delete: 'Node löschen…' }
        : { inspect: 'Edit in Inspector', focus: 'Center this node', connect: 'Connect from here', delete: 'Delete node…' };
    const buttons = Object.entries(labels).map(([action, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'canvas-node-menu__item';
        button.setAttribute('role', 'menuitem');
        button.tabIndex = -1;
        button.textContent = label;
        button.dataset.action = action;
        button.addEventListener('click', () => {
            const target = current;
            close(true);
            if (target) run(action, target.id);
        });
        menu.append(button);
        return button;
    });
    function close(restore = false) {
        if (!current) return;
        const anchor = current.anchor;
        anchor?.setAttribute('aria-expanded', 'false');
        current = null;
        menu.hidden = true;
        if (restore && anchor?.isConnected) anchor.focus({ preventScroll: true });
    }
    function open({ id, anchor, clientX, clientY }) {
        close();
        if (viewport.closest('[inert], [hidden]')) return;
        current = { id, anchor };
        anchor?.setAttribute('aria-expanded', 'true');
        menu.hidden = false;
        const rect = anchor?.getBoundingClientRect();
        const x = Number.isFinite(clientX) ? clientX : rect?.left || 8;
        const y = Number.isFinite(clientY) ? clientY : rect?.bottom || 8;
        menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + 'px';
        buttons[0].focus({ preventScroll: true });
    }
    menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
        if (event.key === 'Tab') { close(true); return; }
        const index = buttons.indexOf(document.activeElement);
        const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); buttons[next].focus(); }
    });
    const outside = event => { if (!menu.contains(event.target) && !current?.anchor?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('scroll', event => { if (event.target !== menu && !menu.contains(event.target)) close(); }, true);
    window.addEventListener('resize', () => close());
    window.addEventListener('pagehide', () => close());
    return { open, close };
}
