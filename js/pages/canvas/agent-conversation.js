import { canvasRequest } from './api.js?v=__ASSET_VERSION__';
import { canvasConversationCopy } from './agent-conversation-copy.js?v=__ASSET_VERSION__';
import { CANVAS_AGENT_LIMITS } from '../../shared/canvas-agent-contract.mjs?v=__ASSET_VERSION__';

const create = (tag, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
const button = (text, action, primary = false) => { const node = create('button', `canvas-button${primary ? ' canvas-button--primary' : ''}`, text); node.type = 'button'; node.addEventListener('click', action); return node; };
const field = (text, input) => { const label = create('label', 'canvas-field'); label.append(create('span', '', text), input); return label; };
const count = value => Number.isSafeInteger(value) && value >= 0;
const string = value => typeof value === 'string' ? value : '';
const terminal = new Set(['completed', 'cancelled', 'taken_over', 'manual_takeover']);
const displayValue = value => Array.isArray(value) ? value.filter(item => typeof item === 'string').join(' · ') : string(value);

// This view sends member input and explicit decisions only. The server supplies
// every accepted message, creative brief and allowance; no transcript is trusted
// from the browser or production events.
export function createCanvasAgentConversation({ root, german, flush, getRun, canProduce, onRun }) {
    const copy = canvasConversationCopy(german);
    let projectId = null, epoch = 0, visible = false, busy = false, snapshot = null, availability = null;
    let pending = null, timer = null, controller = null, closed = false, transcriptKey = '', briefKey = '', draftDirty = false;
    const section = create('section', 'canvas-agent__conversation'); section.setAttribute('aria-label', copy.conversation);
    const welcome = create('p', 'canvas-agent__welcome', copy.welcome);
    const transcript = create('ol', 'canvas-agent__messages'); transcript.setAttribute('aria-label', copy.conversation); transcript.setAttribute('aria-live', 'polite'); transcript.setAttribute('aria-relevant', 'additions text');
    const notice = create('p', 'canvas-agent__notice', copy.loading); notice.setAttribute('role', 'status');
    const recovery = button(copy.check, () => void replay());
    const reload = button(copy.reconnect, () => void observe());
    const composer = create('form', 'canvas-agent__composer');
    const input = create('textarea', 'canvas-textarea'); input.name = 'message'; input.rows = 4; input.maxLength = 6000; input.placeholder = copy.placeholder;
    const send = create('button', 'canvas-button canvas-button--primary', copy.send); send.type = 'submit';
    composer.append(field(copy.message, input), send);
    const shortcuts = create('div', 'canvas-agent__actions');
    const delegate = button(copy.delegateDuration, () => void control('delegate_duration'));
    const prepare = button(copy.prepare, () => void control('skip_questions'));
    const save = button(copy.save, () => void control('save', { draft: input.value }));
    const cancel = button(copy.cancel, () => void control('cancel'));
    const resume = button(copy.resume, () => void control('resume'));
    shortcuts.append(delegate, prepare, save, cancel, resume);

    const allowance = create('section', 'canvas-agent__allowance'); allowance.setAttribute('aria-label', copy.allowanceTitle);
    const allowanceSummary = create('dl', 'canvas-agent__summary');
    const allowanceLedger = create('dl', 'canvas-agent__summary canvas-agent__briefing-cost'); allowanceLedger.setAttribute('aria-label', copy.allowanceTitle);
    const allowanceCap = create('input', 'canvas-input'); allowanceCap.type = 'number'; allowanceCap.name = 'briefingBudget'; allowanceCap.min = '1'; allowanceCap.step = '1'; allowanceCap.inputMode = 'numeric';
    const allowanceApprove = button(copy.allowanceApprove, () => void authorizeAllowance(), true);
    allowance.append(create('h4', '', copy.allowanceTitle), create('p', 'canvas-muted', copy.allowanceHint), allowanceSummary, field(copy.allowanceCap, allowanceCap), allowanceApprove);

    const brief = create('section', 'canvas-agent__brief'); brief.setAttribute('aria-label', copy.briefTitle);
    const briefContent = create('dl', 'canvas-agent__brief-fields'), questions = create('ul', 'canvas-agent__questions');
    const revision = create('p', 'canvas-muted');
    const correct = button(copy.correct, () => { notify(copy.correctHint); input.focus(); });
    brief.append(create('h4', '', copy.briefTitle), briefContent, questions, revision, correct);
    const production = create('form', 'canvas-agent__production-approval'); production.noValidate = true;
    const cap = create('input', 'canvas-input'); cap.type = 'number'; cap.name = 'budget'; cap.min = '1'; cap.max = String(CANVAS_AGENT_LIMITS.maxBudgetCredits); cap.step = '1'; cap.inputMode = 'numeric';
    const approval = create('input'); approval.type = 'checkbox'; approval.name = 'authorize';
    const approvalField = field(copy.productionApprove, approval); approvalField.classList.add('canvas-agent__check');
    const produce = create('button', 'canvas-button canvas-button--primary', copy.productionStart); produce.type = 'submit';
    const productionNote = create('p', 'canvas-muted');
    production.append(create('h4', '', copy.productionTitle), create('p', 'canvas-muted', copy.productionHint), field(copy.productionBudget, cap), approvalField, produce, productionNote);
    const privacy = create('details', 'canvas-disclosure'); privacy.append(create('summary', '', copy.privacy));
    const clear = button(copy.clear, () => { confirmation.hidden = false; clearConfirm.focus(); });
    const confirmation = create('div', 'canvas-agent__clear'); confirmation.hidden = true;
    const clearConfirm = button(copy.clearConfirm, () => void control('clear'));
    const clearBack = button(copy.clearBack, () => { confirmation.hidden = true; clear.focus(); });
    confirmation.append(create('p', '', copy.clearHint), clearConfirm, clearBack); privacy.append(clear, confirmation);
    section.append(welcome, transcript, notice, recovery, reload, composer, shortcuts, allowance, allowanceLedger, brief, production, privacy); root.append(section);

    function path(suffix = '') { return `/projects/${encodeURIComponent(projectId)}/agent/conversation${suffix}`; }
    function storageKey() { return `bitbi:canvas-conversation-request:${projectId}`; }
    function notify(text) { notice.textContent = text; notice.hidden = !text; }
    function remember() {
        // Only an unconfirmed immutable request is retained for safe replay. It
        // is removed after acknowledgement; this is never accepted chat history.
        try { if (pending) sessionStorage.setItem(storageKey(), JSON.stringify(pending)); else sessionStorage.removeItem(storageKey()); } catch { /* Saved server turns survive without browser storage. */ }
    }
    async function fingerprint(value) { const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))); return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
    function valid(value) { return value && count(value.revision) && count(value.briefRevision) && Array.isArray(value.messages) && value.brief && typeof value.brief === 'object'; }
    function accept(data) {
        if (data?.availability) availability = data.availability;
        const next = data?.conversation;
        if (!valid(next) || (snapshot && next.revision < snapshot.revision)) return false;
        if (snapshot && next.briefRevision !== snapshot.briefRevision) approval.checked = false;
        snapshot = next;
        if (!draftDirty && !pending) input.value = string(snapshot.draft);
        const suggested = snapshot.allowance?.suggestedAllowanceCredits || snapshot.suggestedAllowanceCredits || data.suggestedAllowanceCredits;
        if (!allowanceCap.value && count(suggested)) allowanceCap.value = String(suggested);
        return true;
    }
    function item(list, label, value) { list.append(create('dt', '', label), create('dd', '', String(value))); }
    function renderTranscript() {
        const messages = snapshot?.messages || [], key = JSON.stringify(messages);
        welcome.hidden = messages.length > 0 || Boolean(snapshot?.brief?.fields?.story?.value);
        if (key === transcriptKey) return;
        transcriptKey = key;
        transcript.replaceChildren();
        for (const message of messages) {
            if (!message || !['user', 'assistant', 'system'].includes(message.role) || typeof message.text !== 'string') continue;
            const row = create('li', `canvas-agent__message canvas-agent__message--${message.role}`); row.dataset.messageId = string(message.id); row.dataset.status = string(message.status);
            row.append(create('strong', '', message.role === 'user' ? copy.you : message.role === 'assistant' ? copy.assistant : copy.system), create('p', '', message.text));
            if (message.status !== 'completed') row.append(create('span', 'canvas-muted', message.status === 'pending' ? copy.pending : message.status === 'review_required' ? copy.unknown : message.status === 'cancelled' ? copy.cancelled : copy.failed));
            transcript.append(row);
        }
    }
    function renderBrief() {
        const value = snapshot?.brief, key = JSON.stringify(value || null);
        if (key === briefKey) return;
        briefKey = key; briefContent.replaceChildren(); questions.replaceChildren();
        for (const [name, entry] of Object.entries(value?.fields || {})) {
            if (!copy.fields[name] && name !== 'delegatedChoices') continue;
            const text = displayValue(entry?.value); if (!text) continue;
            const detail = create('dd'); detail.append(create('span', '', text));
            const origin = copy.provenance[entry.provenance]; if (origin) detail.append(create('small', 'canvas-muted', origin));
            briefContent.append(create('dt', '', copy.fields[name] || copy.delegatedChoices), detail);
        }
        const duration = value?.duration;
        if (duration?.targetDurationSeconds > 0) item(briefContent, copy.fields.duration, `${duration.targetDurationSeconds} s`);
        else if (duration?.choice === 'delegated') item(briefContent, copy.fields.duration, copy.delegatedDuration);
        else if (duration?.asked) item(briefContent, copy.fields.duration, copy.durationNeeded);
        if (!briefContent.children.length) briefContent.append(create('dd', 'canvas-muted', copy.briefEmpty));
        for (const question of Array.isArray(value?.openQuestions) ? value.openQuestions : []) if (typeof question === 'string') questions.append(create('li', '', question));
        questions.hidden = !questions.children.length; questions.setAttribute('aria-label', copy.openQuestions);
        revision.textContent = snapshot ? `${copy.revisions}: ${snapshot.briefRevision}` : '';
    }
    function render() {
        section.hidden = !projectId;
        const paused = snapshot?.state !== 'active', waiting = Boolean(snapshot?.pendingTurnId), review = snapshot?.messages.some(message => message.status === 'review_required');
        const blocked = busy || Boolean(pending) || !snapshot;
        composer.setAttribute('aria-busy', String(busy));
        input.disabled = blocked || paused || waiting;
        send.disabled = blocked || paused || waiting || review || availability?.available !== true;
        send.textContent = busy ? copy.sending : copy.send;
        recovery.hidden = !pending; recovery.disabled = busy;
        reload.hidden = Boolean(snapshot) && !waiting && !pending && !review; reload.disabled = busy;
        for (const node of [delegate, prepare, save, cancel, resume, clear, clearConfirm]) node.disabled = blocked;
        save.disabled = blocked || waiting; cancel.hidden = snapshot?.state === 'cancelled'; resume.hidden = !snapshot || snapshot.state === 'active';
        delegate.hidden = !snapshot?.brief?.duration?.asked || Boolean(snapshot?.brief?.duration?.choice); delegate.disabled ||= waiting || paused;
        prepare.disabled ||= waiting || paused; correct.disabled = blocked;
        const a = snapshot?.allowance;
        allowance.hidden = !snapshot || (count(a?.remainingCredits) && a.remainingCredits > 0 && !snapshot?.allowanceRequired);
        allowanceApprove.disabled = blocked || paused || waiting || availability?.available !== true;
        allowanceCap.disabled = allowanceApprove.disabled;
        allowanceSummary.replaceChildren();
        if (count(a?.committedCredits)) item(allowanceSummary, copy.allowanceSpent, a.committedCredits);
        if (count(a?.remainingCredits)) item(allowanceSummary, copy.allowanceRemaining, a.remainingCredits);
        if (count(a?.nextReplyMaxCredits)) item(allowanceSummary, copy.quote, a.nextReplyMaxCredits);
        allowanceLedger.replaceChildren(); allowanceLedger.hidden = !(a?.capCredits > 0);
        if (!allowanceLedger.hidden) {
            item(allowanceLedger, copy.allowanceCap, a.capCredits);
            item(allowanceLedger, copy.allowanceSpent, a.committedCredits);
            item(allowanceLedger, copy.allowanceRemaining, a.remainingCredits);
        }
        const active = getRun() && !terminal.has(getRun().status), duration = snapshot?.brief?.duration;
        const ready = Boolean(snapshot?.brief?.fields?.story?.value) && (duration?.choice === 'delegated' || duration?.targetDurationSeconds > 0);
        production.hidden = !snapshot || !Object.keys(snapshot.brief.fields || {}).length;
        cap.disabled = approval.disabled = produce.disabled = blocked || waiting || review || paused || active || !canProduce() || !ready || availability?.available !== true;
        productionNote.textContent = !canProduce() ? copy.unknown : active ? copy.productionBusy : ready ? '' : copy.productionMissing;
        renderTranscript(); renderBrief();
    }
    function failure(response) {
        if (response.code === 'model_pricing_stale') { approval.checked = false; notify(copy.allowanceStale); }
        else if (/revision|changed|stale/.test(response.code || '')) { approval.checked = false; notify(copy.stale); }
        else if (response.code === 'canvas_agent_budget_exceeded') notify(copy.projectBudgetBlocked);
        else if (/allowance|briefing_budget/.test(response.code || '')) { snapshot.allowanceRequired = true; notify(copy.allowanceRequired); }
        else if (/duration/.test(response.code || '')) notify(copy.durationNeeded);
        else if (/pending|unknown|review/.test(response.code || '')) notify(copy.unknown);
        else notify(copy.unavailable);
    }
    async function sendRequest(suffix, body, tariffRevision) {
        if (busy || pending || !projectId) return;
        busy = true; render(); const current = epoch;
        try {
            const request = { suffix, body, key: crypto.randomUUID(), ...(count(tariffRevision) ? { tariffRevision } : {}) };
            request.fingerprint = await fingerprint({ suffix, body, tariffRevision: request.tariffRevision });
            if (current !== epoch) return;
            pending = request; remember();
        } finally { if (current === epoch) { busy = false; render(); } }
        if (current === epoch) await replay();
    }
    async function replay() {
        if (busy || !pending || !projectId) return;
        busy = true; clearTimeout(timer); controller?.abort(); render(); const request = pending, current = epoch;
        try {
            if (await fingerprint({ suffix: request.suffix, body: request.body, tariffRevision: request.tariffRevision }) !== request.fingerprint) { notify(copy.unsent); return; }
            const response = await canvasRequest(path(request.suffix), { method: 'POST', body: request.body, idempotencyKey: request.key, tariffRevision: request.tariffRevision, timeoutMs: 30000 });
            if (current !== epoch) return;
            if (response.ok) {
                if (request.suffix === '/start') {
                    if (!response.data?.run || !/^[a-f0-9]{32}$/.test(response.data.run.id || '') || response.data.run.projectId !== projectId || response.data.run.requestKey !== request.key) { notify(copy.unsent); return; }
                    onRun(response.data.run); approval.checked = false;
                } else if (!accept(response.data)) { notify(copy.unsent); return; }
                pending = null; remember();
                if (request.suffix === '/messages') { input.value = ''; draftDirty = false; notify(snapshot?.pendingTurnId ? copy.pending : ''); }
                else if (request.suffix === '/allowance') notify(copy.allowanceAccepted);
                else if (request.body.action === 'save') { draftDirty = false; notify(copy.saved); }
                else if (request.body.action === 'clear') { input.value = ''; draftDirty = false; confirmation.hidden = true; notify(copy.cleared); }
                else if (request.body.action === 'cancel') notify(copy.cancelled);
                else notify('');
            } else if (response.status === 0 || response.status >= 500) notify(copy.unsent);
            else { pending = null; remember(); failure(response); if (/revision|changed|stale/.test(response.code || '')) await observe(true); }
        } finally { if (current === epoch) { busy = false; render(); schedule(); } }
    }
    async function sendMessage(event) {
        event.preventDefault(); if (send.disabled || !snapshot) return;
        const text = input.value.trim(); if (!text) { input.focus(); return; }
        if (!(snapshot.allowance?.remainingCredits > 0)) { notify(copy.allowanceRequired); allowance.hidden = false; allowanceCap.focus(); return; }
        await sendRequest('/messages', { text, locale: german ? 'de' : 'en', expectedConversationRevision: snapshot.revision, expectedBriefRevision: snapshot.briefRevision }, snapshot.allowance?.tariffRevision);
    }
    async function authorizeAllowance() {
        const capCredits = Number(allowanceCap.value);
        if (!Number.isSafeInteger(capCredits) || capCredits < 1 || capCredits > CANVAS_AGENT_LIMITS.maxBudgetCredits) { notify(copy.allowanceInvalid); allowanceCap.focus(); return; }
        if (!snapshot) return;
        await sendRequest('/allowance', { capCredits, expectedConversationRevision: snapshot.revision }, snapshot.allowance?.tariffRevision);
    }
    async function control(action, extra = {}) {
        if (!snapshot) return;
        await sendRequest('/control', { action, expectedConversationRevision: snapshot.revision, locale:german?'de':'en', ...extra });
    }
    async function start(event) {
        event.preventDefault(); if (produce.disabled || !snapshot) return;
        const budgetCredits = Number(cap.value);
        if (!Number.isSafeInteger(budgetCredits) || budgetCredits < 1 || budgetCredits > CANVAS_AGENT_LIMITS.maxBudgetCredits || !approval.checked) { notify(copy.productionApprove); (!cap.value ? cap : approval).focus(); return; }
        const approved = { conversation: snapshot.revision, brief: snapshot.briefRevision }, current = epoch;
        busy = true; render();
        let body;
        try {
            if (!await flush() || current !== epoch) return;
            const response = await canvasRequest(`/projects/${encodeURIComponent(projectId)}`, { timeoutMs: 15000 });
            if (current !== epoch) return;
            if (!response.ok || !count(response.data?.project?.revision)) { notify(copy.unavailable); return; }
            if (snapshot.revision !== approved.conversation || snapshot.briefRevision !== approved.brief) { approval.checked = false; notify(copy.stale); return; }
            body = { expectedConversationRevision: approved.conversation, expectedBriefRevision: approved.brief, expectedRevision: response.data.project.revision, budgetCredits, locale: german ? 'de' : 'en', authorized: true };
        } finally { if (current === epoch) { busy = false; render(); } }
        if (body && current === epoch) await sendRequest('/start', body, snapshot.allowance?.tariffRevision);
    }
    function schedule() { clearTimeout(timer); if (visible && !closed && projectId && (snapshot?.pendingTurnId || pending)) timer = setTimeout(() => void observe(), 4000); }
    async function observe(force = false) {
        if (!projectId || closed || (busy && !force)) return;
        controller?.abort(); const observation = new AbortController(), current = epoch; controller = observation;
        const response = await canvasRequest(path(), { signal: observation.signal, timeoutMs: 15000 });
        if (current !== epoch || observation.signal.aborted) return;
        if (response.ok && accept(response.data)) {
            if (!pending && !busy) notify(snapshot.pendingTurnId ? copy.pending : '');
        } else if (!snapshot) notify(copy.unavailable);
        render(); schedule();
    }
    composer.addEventListener('submit', event => void sendMessage(event));
    production.addEventListener('submit', event => void start(event));
    input.addEventListener('input', () => { draftDirty = true; });
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (!send.disabled) composer.requestSubmit(); } });
    cap.addEventListener('input', () => { approval.checked = false; });
    window.addEventListener('pagehide', () => { closed = true; clearTimeout(timer); controller?.abort(); });
    render();
    return {
        refresh: render,
        focus() { input.focus(); },
        setVisible(value) { const changed = visible !== value; visible = value; if (visible && changed) void observe(); else if (!visible) { clearTimeout(timer); controller?.abort(); } },
        projectChanged(id) {
            if (id === projectId) return;
            epoch++; projectId = id; snapshot = null; availability = null; pending = null; busy = false; transcriptKey = briefKey = ''; draftDirty = false;
            controller?.abort(); clearTimeout(timer); input.value = ''; allowanceCap.value = ''; cap.value = ''; approval.checked = false; confirmation.hidden = true;
            try { const saved = JSON.parse(sessionStorage.getItem(storageKey()) || 'null'); if (saved && ['/messages', '/allowance', '/control', '/start'].includes(saved.suffix) && saved.body && typeof saved.key === 'string' && typeof saved.fingerprint === 'string') pending = saved; } catch { /* The server remains authoritative. */ }
            notify(pending ? copy.unsent : copy.loading); render(); if (visible) void observe();
        },
    };
}
