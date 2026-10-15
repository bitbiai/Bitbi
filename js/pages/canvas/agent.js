import { canvasRequest } from './api.js?v=__ASSET_VERSION__';
import { canvasAgentCopy } from './agent-copy.js?v=__ASSET_VERSION__';
import { CANVAS_AGENT_LIMITS, resolveCanvasAgentDuration } from '../../shared/canvas-agent-contract.mjs?v=__ASSET_VERSION__';

const TERMINAL = new Set(['completed', 'cancelled', 'taken_over', 'manual_takeover']);
const WAITING = new Set(['clarification_required', 'paused', 'blocked', 'failed', 'review_required', 'budget_required']);
const identifier = value => encodeURIComponent(String(value || ''));
const create = (tag, className = '', text = '') => {
    const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
};
const button = (text, action) => {
    const node = create('button', 'canvas-button', text); node.type = 'button'; node.addEventListener('click', action); return node;
};
const field = (text, input) => { const label = create('label', 'canvas-field'); label.append(create('span', '', text), input); return label; };
const finite = value => typeof value === 'number' && Number.isFinite(value);

// The final player accepts only the existing same-origin private media routes.
// Provider URLs and protocol-relative URLs never become navigation or media URLs.
function privateMediaUrl(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
    try { const url = new URL(value, location.origin); return url.origin === location.origin && /^\/api\/(ai|account\/canvas)\//.test(url.pathname) ? url.href : null; }
    catch { return null; }
}

export function createCanvasAgentPanel({ root, german, getState, flush, newProject, openProject }) {
    const copy = canvasAgentCopy(german);
    let projectId = null, run = null, availability = null, busy = false, visible = false, stopped = false;
    let epoch = 0, timer = null, controller = null, pendingStart = null, durationAsked = false, revising = false;
    const controlKeys = new Map();
    const intro = create('p', 'canvas-muted', copy.intro);
    const projectHint = create('div', 'canvas-agent__project'); projectHint.append(create('p', 'canvas-muted', copy.projectRequired), button(copy.newProject, newProject));
    const availabilityNote = create('p', 'canvas-agent__notice', copy.checking); availabilityNote.setAttribute('role', 'status');
    const availabilityDetails=create('details','canvas-disclosure'),availabilityCode=create('p','canvas-muted');
    availabilityDetails.append(create('summary','',copy.details),availabilityCode);availabilityDetails.hidden=true;
    const form = create('form', 'canvas-agent__form'); form.noValidate = true;
    const fields = create('fieldset');
    const brief = create('textarea', 'canvas-textarea'); brief.name = 'brief'; brief.maxLength = 12000; brief.rows = 5; brief.placeholder = copy.placeholder;
    const duration = create('input', 'canvas-input'); duration.type = 'number'; duration.name = 'duration'; duration.min = String(CANVAS_AGENT_LIMITS.minDuration); duration.max = String(CANVAS_AGENT_LIMITS.maxDuration); duration.step = '1'; duration.inputMode = 'numeric';
    const durationHint = create('p', 'canvas-muted', copy.durationHint); durationHint.id = 'canvasAgentDurationHint'; duration.setAttribute('aria-describedby', durationHint.id);
    const delegation = create('input'); delegation.type = 'checkbox'; delegation.name = 'delegateDuration';
    const delegationField = field(copy.delegate, delegation); delegationField.classList.add('canvas-agent__check'); delegationField.hidden = true;
    delegation.addEventListener('change', () => {
        duration.disabled = delegation.checked;
        if (delegation.checked) { duration.value = ''; durationHint.textContent = `${copy.target}: ${resolveCanvasAgentDuration({durationChoice:'delegated',durationAsked:true}).targetDurationSeconds} s`; }
        else durationHint.textContent = copy.durationRequired;
    });
    const cap = create('input', 'canvas-input'); cap.type = 'number'; cap.name = 'budget'; cap.min = '1'; cap.max = String(CANVAS_AGENT_LIMITS.maxBudgetCredits); cap.step = '1'; cap.inputMode = 'numeric';
    const capHint = create('p', 'canvas-muted', copy.budgetHint); capHint.id = 'canvasAgentBudgetHint'; cap.setAttribute('aria-describedby', capHint.id);
    const approval = create('input'); approval.type = 'checkbox'; approval.name = 'authorize';
    const approvalField = field(copy.approve, approval); approvalField.classList.add('canvas-agent__check');
    const feedback = create('p', 'canvas-agent__notice'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite'); feedback.hidden = true;
    const start = create('button', 'canvas-button canvas-button--primary', copy.start); start.type = 'submit';
    fields.append(field(copy.brief, brief), field(copy.duration, duration), durationHint, delegationField, field(copy.budget, cap), capHint, approvalField, start);
    form.append(fields, feedback);
    const status = create('section', 'canvas-agent__production'); status.setAttribute('aria-label', copy.status); status.hidden = true;
    const phase = create('h3'); phase.setAttribute('role', 'status');
    const counts = create('p', 'canvas-agent__counts');
    const summary = create('dl', 'canvas-agent__summary');
    const note = create('p', 'canvas-muted');
    const media = create('div', 'canvas-agent__media');
    const actions = create('div', 'canvas-agent__actions');
    const inspect = button(copy.view, () => void view());
    const controls = Object.fromEntries(['pause', 'resume', 'cancel', 'takeover'].map(action => [action, button(copy[action], () => void control(action))]));
    const refresh = button(copy.check, () => void observe());
    const retryStart = button(copy.retryStart, () => void resendStart());
    const revise = button(copy.newBrief, () => {
        revising = true; brief.value = ''; approval.checked = false; pendingStart = null;
        duration.value = getState().project?.assembly?.target?.seconds ?? run?.targetDurationSeconds ?? '';
        delegation.checked = false; duration.disabled = false; render(); brief.focus();
    });
    actions.append(...Object.values(controls), inspect, refresh, retryStart, revise);
    const stopHint = create('p', 'canvas-muted', copy.stopHint);
    const details = create('details', 'canvas-disclosure'); details.append(create('summary', '', copy.details));
    const evidence = create('dl', 'canvas-agent__summary'); details.append(evidence);
    status.append(phase, counts, summary, note, media, actions, stopHint, details);
    const help = create('details', 'canvas-disclosure'); help.append(create('summary', '', copy.inspect), create('p', 'canvas-muted', copy.editHint));
    root.append(intro, availabilityNote, availabilityDetails, projectHint, form, status, help);

    function message(text) { feedback.textContent = text; feedback.hidden = !text; }
    function validRun(value) { return value && /^[a-f0-9]{32}$/.test(value.id || '') && value.projectId===projectId && typeof value.status==='string'; }
    function summaryItem(container, label, value) { container.append(create('dt', '', label), create('dd', '', value)); }
    function render() {
        const canStart = availability?.available === true;
        availabilityNote.hidden = canStart;
        availabilityNote.textContent = availability === null ? copy.checking : availability?.code === 'grok_47_unverified' ? copy.unavailableModel : copy.unavailable;
        availabilityDetails.hidden=canStart||!availability?.code;
        availabilityCode.textContent=availability?.code ? `${copy.reason}: ${availability.code}` : '';
        projectHint.hidden = Boolean(projectId);
        form.hidden = !projectId || Boolean(run && !revising && !['clarification_required', 'budget_required'].includes(run.status));
        fields.disabled = busy || !canStart || Boolean(pendingStart?.uncertain);
        start.textContent = run && revising ? copy.revise : copy.start;
        delegationField.hidden = !durationAsked;
        status.hidden = !run && !pendingStart?.uncertain;
        refresh.hidden = !run && !pendingStart?.uncertain;
        retryStart.hidden = !pendingStart?.uncertain || !pendingStart?.body;
        retryStart.disabled = busy;
        for (const node of Object.values(controls)) node.disabled = busy;
        inspect.disabled = busy || !projectId;
        if (!run) {
            phase.textContent = pendingStart?.uncertain ? copy.connection : '';
            counts.textContent = ''; summary.replaceChildren(); evidence.replaceChildren(); media.replaceChildren(); note.textContent = '';
            for (const node of Object.values(controls)) node.hidden = true;
            revise.hidden = true; stopHint.hidden = true; details.hidden = true; return;
        }
        const terminal = TERMINAL.has(run.status), waiting = WAITING.has(run.status);
        phase.textContent = copy.phases[terminal||waiting?run.status:run.phase] || copy.phases[run.status] || copy.failed;
        counts.textContent = Number.isInteger(run.completed) && Number.isInteger(run.total) && run.total > 0 && run.completed >= 0 && run.completed <= run.total
            ? `${run.completed} / ${run.total} ${copy.progress}` : '';
        summary.replaceChildren();
        if (finite(run.targetDurationSeconds)) summaryItem(summary, copy.target, `${run.targetDurationSeconds} s`);
        if (finite(run.toleranceSeconds)) summaryItem(summary, copy.tolerance, `± ${run.toleranceSeconds} s`);
        if (finite(run.budgetCredits)) summaryItem(summary, copy.budgetSummary, String(run.budgetCredits));
        if (finite(run.allocatedCredits)) summaryItem(summary, copy.allocated, String(run.allocatedCredits));
        const measuredDuration=run.result?.measuredDurationSeconds??run.result?.durationSeconds;
        if (finite(measuredDuration)) summaryItem(summary, copy.durationMeasured, `${measuredDuration} s`);
        const fileUrl = privateMediaUrl(run.result?.fileUrl);
        const complete = run.status === 'completed' && run.result?.assetId && fileUrl;
        if (run.status === 'completed' && !complete) phase.textContent = copy.failed;
        if (run.status === 'taken_over') phase.textContent = copy.phases.manual_takeover;
        note.textContent = complete ? copy.completion : waiting || (run.status === 'completed' && !complete) ? copy.failed : terminal ? copy.editHint : copy.background;
        if (!terminal && !waiting && run.phase === 'waiting_limit') note.textContent = copy.waitingLimit;
        if(waiting&&run.errorCode)note.textContent=run.errorCode==='canvas_agent_budget_exceeded'?copy.blockedBudget:run.errorCode==='canvas_agent_quality_review_required'?copy.blockedQuality:run.errorCode==='canvas_agent_project_changed'?copy.blockedProject:/provider.*(unknown|review)/.test(run.errorCode)?copy.blockedProvider:note.textContent;
        if (complete) {
            let video = media.querySelector('video');
            if (!video) { video = create('video'); video.controls = true; video.preload = 'metadata'; video.setAttribute('aria-label', copy.preview); media.append(video); }
            if (video.src !== fileUrl) video.src = fileUrl;
            const poster = privateMediaUrl(run.result.previewUrl); if (poster) video.poster = poster; else video.removeAttribute('poster');
        } else media.replaceChildren();
        controls.pause.hidden = terminal || waiting;
        controls.resume.hidden = run.status !== 'paused';
        controls.cancel.hidden = terminal || run.status === 'clarification_required';
        controls.takeover.hidden = terminal || run.status === 'clarification_required';
        revise.hidden = !terminal || revising;
        stopHint.hidden = terminal;
        details.hidden = false; evidence.replaceChildren();
        summaryItem(evidence, copy.requestId, run.id || '—');
        for(const [key,label]of [['chargedCredits',copy.charged],['reservedCredits',copy.reserved],['pendingOutcomeCredits',copy.pendingCost]])if(finite(run[key]))summaryItem(evidence,label,String(run[key]));
        if(run.result?.technicalValidation==='processor_measured')summaryItem(evidence,copy.technical,copy.measured);
        if(run.result?.visualReview==='sampled_frames'&&run.result?.evaluation) {
            summaryItem(evidence,copy.visual,copy.sampled);
            if(typeof run.result.evaluation.confidence==='string')summaryItem(evidence,copy.confidence,german?({low:'Niedrig',medium:'Mittel',high:'Hoch'}[run.result.evaluation.confidence]||run.result.evaluation.confidence):run.result.evaluation.confidence);
            for(const issue of (Array.isArray(run.result.evaluation.issues)?run.result.evaluation.issues:[]).slice(0,8))if(typeof issue.reason==='string')summaryItem(evidence,`${copy.reviewIssue}: ${getState().nodes?.find(node=>node.id===issue.nodeId)?.title||String(issue.nodeId||'').slice(0,8)}`,issue.reason.slice(0,800));
        }
        if (run.errorCode) summaryItem(evidence, copy.reason, String(run.errorCode));
        if (run.status === 'clarification_required') askDuration();
    }
    function askDuration() {
        durationAsked = true; delegationField.hidden = false;
        if (!delegation.checked) durationHint.textContent = copy.durationRequired;
        duration.setAttribute('aria-invalid', 'true');
    }
    function error(result) {
        if (['model_pricing_stale', 'canvas_project_revision_conflict', 'project_revision_conflict', 'canvas_agent_project_changed', 'canvas_agent_tariff_changed'].includes(result.code)) { approval.checked = false; message(copy.stale); }
        else if (result.code==='canvas_agent_budget_exceeded' || result.code==='canvas_agent_budget_required') { approval.checked=false;message(copy.budgetRequired); }
        else if (result.code==='canvas_agent_duration_invalid') message(copy.invalidDuration);
        else if (['canvas_agent_model_unavailable','canvas_agent_disabled','canvas_agent_infrastructure_unavailable','model_area_disabled'].includes(result.code)) { availability={available:false,code:result.code};message(copy.unavailable); }
        else message(copy.connection);
    }
    async function fingerprint(body) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
        return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    function storageKey() { return `bitbi:canvas-agent-start:${projectId}`; }
    function rememberStart() {
        try { sessionStorage.setItem(storageKey(), JSON.stringify({ key: pendingStart.key, fingerprint: pendingStart.fingerprint, body: pendingStart.body })); } catch { /* Server run remains authoritative. */ }
    }
    function clearStart() { pendingStart = null; try { sessionStorage.removeItem(storageKey()); } catch { /* No persistence dependency. */ } }
    async function submit(event) {
        event.preventDefault(); if (busy || !projectId || availability?.available !== true || pendingStart?.uncertain) return;
        const text = brief.value.trim(); if (!text) { message(copy.briefRequired); brief.focus(); return; }
        const requested = duration.value.trim();
        if (requested && (!Number.isSafeInteger(Number(requested)) || Number(requested) <= 0)) { message(copy.invalidDuration); duration.focus(); return; }
        const delegated = durationAsked && delegation.checked;
        let resolved;
        try { resolved = resolveCanvasAgentDuration({brief:text,targetDurationSeconds:requested || null,durationChoice:delegated?'delegated':'explicit',durationAsked}); }
        catch { message(copy.invalidDuration); duration.focus(); return; }
        if (!resolved) { askDuration(); message(copy.durationRequired); }
        const budget = Number(cap.value);
        if (resolved && (!Number.isSafeInteger(budget) || budget < 1 || budget > CANVAS_AGENT_LIMITS.maxBudgetCredits || !approval.checked)) { message(copy.budgetRequired); (!cap.value ? cap : approval).focus(); return; }
        busy = true; controller?.abort(); clearTimeout(timer); message(''); render();
        const current = epoch;
        try {
            if (!await flush()) { message(copy.saving); return; }
            if (current !== epoch) return;
            // Manual node/edge saves also advance the server project revision.
            // Read that revision without replacing any current editor objects.
            const project = await canvasRequest(`/projects/${identifier(projectId)}`, { timeoutMs:15000 });
            if (current !== epoch) return;
            if (!project.ok || !Number.isSafeInteger(project.data?.project?.revision)) { error(project); return; }
            const body = { brief: text, targetDurationSeconds: delegated ? null : resolved?.targetDurationSeconds || null, durationChoice: delegated ? 'delegated' : 'explicit', budgetCredits: resolved ? budget : null, expectedRevision: project.data.project.revision, locale: german ? 'de' : 'en' };
            const hash = await fingerprint(body);
            if (current !== epoch) return;
            let stored = null; try { stored = JSON.parse(sessionStorage.getItem(storageKey()) || 'null'); } catch { /* Optional recovery identity. */ }
            const key = stored?.fingerprint === hash && typeof stored.key === 'string' ? stored.key : crypto.randomUUID();
            pendingStart = { key, fingerprint: hash, body, uncertain: false }; rememberStart();
            const response = await canvasRequest(`/projects/${identifier(projectId)}/agent`, { method: 'POST', body, idempotencyKey: key, timeoutMs: 30000 });
            if (current !== epoch) return;
            if (response.ok && validRun(response.data?.run) && response.data.run.requestKey===key) {
                run = response.data.run; revising = false; clearStart(); approval.checked = false;
                if (run.status === 'clarification_required') { askDuration(); message(copy.durationRequired); }
                schedule();
            } else if (response.status === 0 || response.status >= 500 || response.ok) {
                pendingStart.uncertain = true; message(copy.connection); schedule();
            } else { clearStart(); error(response); }
        } finally { busy = false; render(); }
    }
    async function resendStart() {
        if (busy || !pendingStart?.uncertain || !pendingStart?.body || !projectId) return;
        busy = true; controller?.abort(); clearTimeout(timer); render(); const current = epoch, pending = pendingStart;
        try {
            // This repeats only the original idempotent start request. It never
            // creates a new key or changes the authorized immutable input.
            if (await fingerprint(pending.body) !== pending.fingerprint || current !== epoch) return;
            const response = await canvasRequest(`/projects/${identifier(projectId)}/agent`, { method:'POST', body:pending.body, idempotencyKey:pending.key, timeoutMs:30000 });
            if (current !== epoch) return;
            if (response.ok && validRun(response.data?.run) && response.data.run.requestKey===pending.key) { run=response.data.run; clearStart(); revising=false; approval.checked=false; message(''); }
            else if (response.status > 0 && response.status < 500 && !response.ok) { clearStart(); error(response); }
            else message(copy.connection);
            schedule();
        } finally { busy=false; render(); }
    }
    async function control(action) {
        if (busy || !run?.id || !projectId) return;
        busy = true; controller?.abort(); clearTimeout(timer); message(''); render(); const current = epoch, id = run.id;
        const identity = `${id}:${action}:${run.status}`;
        if (!controlKeys.has(identity)) controlKeys.set(identity, crypto.randomUUID());
        try {
            const response = await canvasRequest(`/projects/${identifier(projectId)}/agent/${identifier(id)}/control`, { method: 'POST', body: { action }, idempotencyKey: controlKeys.get(identity), timeoutMs: 30000 });
            if (current !== epoch) return;
            if (response.ok && validRun(response.data?.run) && response.data.run.id === id) { run = response.data.run; if (action === 'takeover') await view(); }
            else error(response);
            schedule();
        } finally { busy = false; render(); }
    }
    async function view() {
        const id=projectId,current=epoch;
        if (!id || !await flush() || current !== epoch) return;
        await openProject(id);
    }
    function schedule() {
        clearTimeout(timer);
        if (!visible || stopped || !projectId || (run && TERMINAL.has(run.status))) return;
        timer = setTimeout(() => void observe(), 4000);
    }
    async function observe() {
        if (stopped || busy) { schedule(); return; }
        controller?.abort(); controller = new AbortController(); const current = epoch, observation=controller;
        const response = await canvasRequest(projectId ? `/projects/${identifier(projectId)}/agent` : '/agent/capabilities', { signal: observation.signal, timeoutMs: 15000 });
        if (current !== epoch || stopped || observation.signal.aborted) return;
        if (response.ok) {
            availability = response.data?.availability || { available: false };
            if (validRun(response.data?.run)) {
                run = response.data.run;
                if (!brief.value && typeof run.brief === 'string' && ['clarification_required','budget_required'].includes(run.status)) brief.value=run.brief;
                if (!duration.value && finite(run.targetDurationSeconds) && run.status==='budget_required') duration.value=String(run.targetDurationSeconds);
                if (!pendingStart || run.requestKey === pendingStart.key) clearStart();
            }
            if (!pendingStart?.uncertain) message('');
        } else {
            if (availability === null) availability = { available: false };
            if (run || pendingStart?.uncertain) message(copy.connection);
        }
        render(); schedule();
    }
    form.addEventListener('submit', event => void submit(event));
    for (const input of [brief, duration, cap, delegation]) input.addEventListener('input', () => { approval.checked = false; });
    window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); controller?.abort(); });
    render();
    return {
        setVisible(value) { const changed = visible !== value; visible = value; if (visible && changed) void observe(); else if (!visible) clearTimeout(timer); },
        projectChanged() {
            const id = getState().project?.id || null; if (id === projectId) return;
            epoch += 1; projectId = id; run = null; pendingStart = null; revising = false; durationAsked = false; availability = null;
            try {
                const stored = JSON.parse(sessionStorage.getItem(storageKey()) || 'null');
                if (stored?.key && stored?.fingerprint && stored?.body) pendingStart = {...stored,uncertain:true};
            } catch { /* Server status recovery still works without browser storage. */ }
            brief.value = ''; duration.value = ''; duration.disabled = false; cap.value = ''; delegation.checked = false; approval.checked = false;
            durationHint.textContent = copy.durationHint; duration.removeAttribute('aria-invalid'); message(''); clearTimeout(timer); controller?.abort(); render();
            if (visible) void observe();
        },
    };
}
