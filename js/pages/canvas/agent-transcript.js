const create = (tag, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
const string = value => typeof value === 'string' ? value : '';

// Message IDs own their DOM. Polling never replaces unchanged text nodes or a
// selected paragraph. Scroll position belongs to the reader, not the observer.
export function createCanvasTranscript({ viewport, list, welcome, newest, copy, content = list }) {
    const rows = new Map(); let follow = true, anchor = null, initial = true, adjusting = false, adjustedPosition = 0, frame = null;
    const nearBottom = () => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 40;
    function capture() {
        const top = viewport.getBoundingClientRect().top;
        const row = [...list.children].find(node => node.getBoundingClientRect().bottom > top + 2);
        return row ? { id: row.dataset.messageId, offset: row.getBoundingClientRect().top - top } : null;
    }
    function restore(saved) {
        const row = saved && rows.get(saved.id)?.row;
        if (row) viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - saved.offset;
    }
    function settle(saved = anchor, bottom = follow) {
        if (!viewport.clientHeight) return;
        adjusting = true;
        if (bottom) viewport.scrollTop = viewport.scrollHeight;
        else restore(saved);
        adjustedPosition = viewport.scrollTop;
        anchor = capture();
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => { adjusting = false; });
    }
    viewport.addEventListener('scroll', () => {
        if (adjusting && Math.abs(viewport.scrollTop-adjustedPosition)<1) return;
        follow = nearBottom(); anchor = capture();
        if (follow) newest.hidden = true;
    }, { passive: true });
    newest.addEventListener('click', () => { follow = true; newest.hidden = true; settle(null, true); viewport.focus({ preventScroll: true }); });
    const observer = new ResizeObserver(() => { if (!adjusting) settle(); });
    function watch() { observer.observe(viewport); observer.observe(content); }
    watch();
    function stateText(message) {
        const stage = message.delivery?.stage || message.stage;
        if (stage === 'sending') return copy.sending;
        if (copy.delivery[stage]) return copy.delivery[stage] + (message.delivery?.recovery === 'operator' ? ` ${message.delivery.canObserve === false ? copy.operatorStopped : copy.operatorReview}` : '');
        // Older projections have no dispatch evidence. A generic review label
        // must not invent a provider acceptance or present system copy as Grok.
        return message.status === 'pending' ? copy.pending : message.status === 'review_required' ? copy.review : message.status === 'cancelled' ? copy.cancelled : copy.failed;
    }
    function render(messages, { offline = false, delayed = false } = {}) {
        const values = (Array.isArray(messages) ? messages : []).filter(message => message && typeof message.id === 'string' && ['user', 'assistant', 'system'].includes(message.role));
        const previous = [...rows.keys()], ids = new Set(), saved = capture(), bottom = initial || follow;
        let cursor = list.firstElementChild, appended = false;
        for (const message of values) {
            if (ids.has(message.id)) continue; ids.add(message.id);
            const completed = message.status === 'completed', system = message.role === 'system' || message.delivery?.source === 'system' || message.source === 'system' || !completed;
            const kind = system ? 'system' : message.role;
            let entry = rows.get(message.id);
            if (!entry) {
                const row = create('li'), label = create('span'), text = create('p'), diagnostic = create('details', 'canvas-agent__diagnostic');
                const diagnosticTitle = create('summary', '', copy.messageDetails), stageText = create('p'), diagnosticCode=create('p','canvas-muted');
                const bee = create('span', 'canvas-agent__bee'); bee.setAttribute('aria-hidden', 'true');
                for (const part of ['wing', 'wing', 'body']) bee.append(create('span', `canvas-agent__bee-${part}`));
                const reference = create('code'), copyButton = create('button', 'canvas-button canvas-button--compact', copy.copyReference);
                copyButton.type = 'button';
                copyButton.addEventListener('click', async () => {
                    try { await navigator.clipboard.writeText(reference.textContent); copyButton.textContent = copy.referenceCopied; }
                    catch { const selection = window.getSelection(), range = document.createRange(); range.selectNodeContents(reference); selection.removeAllRanges(); selection.addRange(range); copyButton.textContent = copy.referenceSelected; }
                });
                diagnostic.append(diagnosticTitle, stageText,diagnosticCode, reference, copyButton); row.append(label, bee, text, diagnostic);
                entry = { row, label, text, bee, diagnostic, stageText,diagnosticCode, reference, copyButton, key: null }; rows.set(message.id, entry);
                appended ||= previous.length > 0 && values.findIndex(value => value.id === message.id) > values.findIndex(value => value.id === previous.at(-1));
            }
            const reference = string(message.delivery?.diagnosticReference || message.diagnosticReference);
            const safeReference = !completed && /^[A-Za-z0-9._:-]{8,160}$/.test(reference) ? reference : '';
            const ordinaryPending = !completed && ['sending', 'queued', 'preparing', 'dispatching', 'provider_pending', 'receipt_pending'].includes(message.delivery?.stage) && message.delivery?.recovery !== 'operator';
            const thinking = ordinaryPending && !offline;
            const detail = completed ? '' : stateText(message);
            const text = completed ? string(message.text) : ordinaryPending ? offline ? copy.connectionRetry : delayed ? copy.waitLonger : copy.waitMoment : detail;
            const errorCode=string(message.delivery?.code||message.code),safeCode=/^[a-z0-9_]{1,90}$/.test(errorCode)?errorCode:'';
            const key = JSON.stringify([kind, message.status, text, safeReference, detail, thinking,safeCode]);
            if (entry.key !== null && kind === 'assistant' && entry.text.textContent !== text && entry.row.getBoundingClientRect().top >= viewport.getBoundingClientRect().bottom) appended = true;
            if (key !== entry.key) {
                entry.key = key; entry.row.className = `canvas-agent__message canvas-agent__message--${kind}${thinking ? ' canvas-agent__thinking' : ''}`;
                entry.row.dataset.messageId = message.id; entry.row.dataset.status = string(message.status); entry.row.dataset.kind = kind;
                entry.row.setAttribute('aria-busy', String(thinking)); entry.bee.hidden = !thinking;
                entry.label.className = system && !ordinaryPending ? 'canvas-agent__system-label' : 'canvas-sr-only';
                entry.label.textContent = system ? copy.requestStatus : kind === 'user' ? copy.you : copy.assistant;
                if (entry.text.textContent !== text) entry.text.textContent = text;
                entry.diagnostic.hidden = completed || !(safeReference || detail); entry.reference.textContent = safeReference;
                entry.reference.hidden = entry.copyButton.hidden = !safeReference;
                if (entry.stageText.textContent !== detail) entry.stageText.textContent = detail;
                entry.diagnosticCode.hidden=!safeCode;entry.diagnosticCode.textContent=safeCode;
                entry.copyButton.textContent = copy.copyReference;
            }
            if (entry.row !== cursor) list.insertBefore(entry.row, cursor);
            cursor = entry.row.nextElementSibling;
        }
        for (const [id, entry] of rows) if (!ids.has(id)) { entry.row.remove(); rows.delete(id); }
        welcome.hidden = values.length > 0;
        if (appended && !bottom) newest.hidden = false;
        if (bottom) newest.hidden = true;
        settle(saved, bottom); initial = false;
    }
    return { render, show() { watch(); settle(); }, changed() { if (!follow) newest.hidden=false;settle(); }, bottom() {follow=true;newest.hidden=true;settle(null,true);}, reset() { for (const entry of rows.values()) entry.row.remove(); rows.clear(); initial = follow = true; anchor = null; newest.hidden = true; }, stop() { observer.disconnect(); cancelAnimationFrame(frame); } };
}
