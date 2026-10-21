// Presentation only. The same mounted assistant and graph keep their state;
// neither creative saves nor conversation/production observers belong here.
export function createCanvasAgentWorkspace({ app, panels, compact, german, onChange }) {
    const panel = panels.agent.panel, layout = panel.parentElement;
    const handle = document.getElementById('canvasAgentResize');
    const toggle = document.getElementById('canvasAgentExpand');
    const icon = toggle.querySelector('path');
    const key = 'bitbi:canvas-agent-width:v1', lifetime = new AbortController();
    let preferred = null, expanded = false, visible = false, projects = true, drag = null, frame = null, resizeFrame = null;
    try {
        const value = Number(localStorage.getItem(key));
        if (Number.isFinite(value) && value >= 280 && value <= 20000) preferred = value;
    } catch { /* Local preferences are optional, never a Canvas dependency. */ }
    const bounds = () => {
        const left = projects ? panels.projects.panel.offsetWidth : 0;
        const max = Math.max(280, Math.floor(layout.clientWidth - left - 360));
        return { min: Math.min(320, max), max };
    };
    const width = () => {
        const { min, max } = bounds();
        return Math.round(Math.min(max, Math.max(min, preferred ?? (innerWidth > 1200 ? 390 : 320))));
    };
    function paint() {
        const { min, max } = bounds(), value = width();
        app.style.setProperty('--canvas-agent-width', `${value}px`);
        app.dataset.agentExpanded = String(expanded && !compact.matches && visible);
        handle.hidden = !visible || compact.matches || expanded;
        toggle.hidden = compact.matches;
        handle.setAttribute('aria-valuemin', String(min));
        handle.setAttribute('aria-valuemax', String(max));
        handle.setAttribute('aria-valuenow', String(value));
        handle.setAttribute('aria-valuetext', `${value} ${german ? 'Pixel' : 'pixels'}`);
        const label = expanded ? german ? 'Zur Seitenleiste zurück' : 'Restore sidebar' : german ? 'Arbeitsfläche ausfüllen' : 'Expand workspace';
        toggle.title = label; toggle.setAttribute('aria-label', label);
        toggle.setAttribute('aria-expanded', String(expanded));
        icon.setAttribute('d', expanded ? 'M9 3v6H3 M15 3v6h6 M9 21v-6H3 M15 21v-6h6' : 'M9 3H3v6 M15 3h6v6 M3 15v6h6 M21 15v6h-6');
    }
    function remember() {
        try { localStorage.setItem(key, String(preferred)); } catch { /* Keep the in-memory width. */ }
    }
    function applyDrag() {
        frame = null;
        if (!drag) return;
        const { min, max } = bounds();
        preferred = Math.min(max, Math.max(min, drag.width + (drag.x - drag.latestX) / drag.scale));
        paint();
    }
    function finish(commit = true) {
        if (!drag) return;
        cancelAnimationFrame(frame); frame = null;
        if (commit) applyDrag(); else preferred = drag.preferred;
        const pointer = drag.pointer; drag = null;
        app.classList.remove('is-agent-resizing');
        if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
        if (commit) remember();
        paint();
    }
    const listen = (target, type, fn) => target.addEventListener(type, fn, { signal: lifetime.signal });
    listen(handle, 'pointerdown', event => {
        if (event.button !== 0 || !event.isPrimary || handle.hidden) return;
        event.preventDefault(); event.stopPropagation();
        handle.focus({ preventScroll: true });
        drag = { pointer: event.pointerId, x: event.clientX, latestX: event.clientX, width: width(), preferred, scale: layout.getBoundingClientRect().width / layout.offsetWidth || 1 };
        handle.setPointerCapture(event.pointerId); app.classList.add('is-agent-resizing');
    });
    listen(handle, 'pointermove', event => {
        if (event.pointerId !== drag?.pointer) return;
        drag.latestX = event.clientX;
        if (frame === null) frame = requestAnimationFrame(applyDrag);
    });
    listen(handle, 'pointerup', event => { if (event.pointerId === drag?.pointer) finish(); });
    listen(handle, 'pointercancel', () => finish(false));
    listen(handle, 'lostpointercapture', () => finish());
    listen(handle, 'keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const { min, max } = bounds(), delta = event.shiftKey ? 48 : 16;
        preferred = event.key === 'Home' ? min : event.key === 'End' ? max : Math.min(max, Math.max(min, width() + (event.key === 'ArrowLeft' ? delta : -delta)));
        paint(); remember();
    });
    listen(toggle, 'click', () => { finish(); expanded = !expanded; onChange(); });
    listen(window, 'blur', () => finish());
    listen(window, 'pagehide', event => {
        finish();
        cancelAnimationFrame(resizeFrame); resizeFrame = null;
        if (!event.persisted) { observer.disconnect(); lifetime.abort(); }
    });
    // Do not write grid geometry during resize delivery: descendants (including
    // the transcript/footer) have their own observers in the same rendering cycle.
    const observer = new ResizeObserver(() => {
        if (resizeFrame !== null) return;
        resizeFrame = requestAnimationFrame(() => { resizeFrame = null; finish(); paint(); });
    });
    observer.observe(layout);
    return {
        get expanded() { return expanded && !compact.matches; },
        collapse() { finish(); expanded = false; },
        focusToggle() { toggle.focus({ preventScroll: true }); },
        sync(state) {
            visible = state.visible; projects = state.projects;
            if (!visible || compact.matches) { finish(); expanded = false; }
            paint();
        },
    };
}
