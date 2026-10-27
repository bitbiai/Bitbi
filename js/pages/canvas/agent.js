import { canvasRequest } from './api.js?v=__ASSET_VERSION__';
import { canvasAgentCopy } from './agent-copy.js?v=__ASSET_VERSION__';
import { createCanvasAgentActivity } from './agent-live.js?v=__ASSET_VERSION__';
import { createCanvasAgentConversation } from './agent-conversation.js?v=__ASSET_VERSION__';
import {canvasNotice,refreshCanvasNotifications,resolveCanvasNotice} from './notifications.js?v=__ASSET_VERSION__';
import {canvasMediaPolicyError} from '../../shared/canvas-notification-contract.mjs?v=__ASSET_VERSION__';

const TERMINAL = new Set(['completed', 'cancelled', 'taken_over', 'manual_takeover']);
const WAITING = new Set(['clarification_required', 'paused', 'blocked', 'failed', 'review_required', 'budget_required']);
const identifier = value => encodeURIComponent(String(value || ''));
const create = (tag, className = '', text = '') => {
    const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
};
const button = (text, action) => {
    const node = create('button', 'canvas-button', text); node.type = 'button'; node.addEventListener('click', action); return node;
};
const finite = value => typeof value === 'number' && Number.isFinite(value);

// The final player accepts only the existing same-origin private media routes.
// Provider URLs and protocol-relative URLs never become navigation or media URLs.
function privateMediaUrl(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
    try { const url = new URL(value, location.origin); return url.origin === location.origin && /^\/api\/(ai|account\/canvas)\//.test(url.pathname) ? url.href : null; }
    catch { return null; }
}

export function createCanvasAgentPanel({ root, german, getState, flush, newProject, openProject, refreshProject=openProject, showResult }) {
    const copy = canvasAgentCopy(german);
    let projectId = null, run = null, availability = null, busy = false, visible = false, stopped = false;
    let epoch = 0, timer = null, controller = null, pendingStart = null;
    let eventCursor=0,stream=null,streamRun=null,pendingBudget=null,catchingUp=false;
    const controlKeys = new Map();
    const projectHint = create('div', 'canvas-agent__project'); projectHint.append(create('p', 'canvas-muted', copy.projectRequired), button(copy.newProject, newProject));
    const availabilityNote = create('p', 'canvas-agent__notice', copy.checking); availabilityNote.setAttribute('role', 'status');
    const availabilityDetails=create('details','canvas-disclosure'),availabilityCode=create('p','canvas-muted');
    availabilityDetails.append(create('summary','',copy.details),availabilityCode);availabilityDetails.hidden=true;
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
    const retryBudget=button(copy.budgetRetry,()=>void sendBudget());
    const revise = button(copy.newBrief, () => conversation.focus());
    actions.append(...Object.values(controls), inspect, refresh, retryStart, retryBudget, revise);
    const stopHint = create('p', 'canvas-muted', copy.stopHint);
    const details = create('details', 'canvas-disclosure'); details.append(create('summary', '', copy.details));
    const evidence = create('dl', 'canvas-agent__summary'); details.append(evidence);
    const live=create('div','canvas-agent__live');
    const activity=createCanvasAgentActivity({parent:live,copy,privateMediaUrl,decideBudget:(decision,request)=>void decideBudget(decision,request)});
    status.append(phase, counts, media, actions, note, summary, live, stopHint, details);
    const help = create('details', 'canvas-disclosure'); help.append(create('summary', '', copy.inspect), create('p', 'canvas-muted', copy.editHint));
    const conversationRoot = create('div','canvas-agent__mount');
    root.append(projectHint, conversationRoot);
    const conversation = createCanvasAgentConversation({root:conversationRoot,german,flush,getRun:()=>run,getProjectRevision:()=>getState().project?.revision??null,canProduce:()=>!modelHeld(),canControl:action=>!busy&&canControl(action),onControl:control,onEffect:applyConversationEffect,onRun:next=>{acceptRun(next);clearStart();message('');render();schedule();}});

    conversation.appendProduction(status);
    conversation.appendDetails(availabilityNote,availabilityDetails,help);
    const panelHead=root.closest('.canvas-agent')?.querySelector('.canvas-panel__head');
    function placeHelp(){const trigger=document.getElementById('bitbiHelpTrigger'),home=document.getElementById('bitbiHelpMenu');if(!trigger||!home)return;if(visible&&panelHead)panelHead.append(trigger);else if(trigger.parentNode!==home)home.prepend(trigger);}
    async function applyConversationEffect(effect){
        const id=projectId,current=epoch;if(!id||!await flush()||current!==epoch)return;
        // A later manual/chat export belongs to the normal inspector. The
        // original production result remains an immutable historical version.
        if(effect.kind==='show_result'){if(effect.targetId&&showResult)await showResult(id,effect.targetId);else message(copy.unavailable);return;}
        if(effect.kind==='refresh'){await refreshProject(id);if(current===epoch)void observe();return;}
        await openProject(id);if(current!==epoch)return;
        if(effect.kind==='show_project'||effect.kind==='focus_node'){
            const toggle=document.getElementById('canvasAgentToggle');if(toggle?.getAttribute('aria-expanded')==='true')toggle.click();
            const graph=document.getElementById('canvasGraphToggle');if(graph&&getComputedStyle(graph).display!=='none'&&graph.getAttribute('aria-pressed')!=='true')graph.click();
            if(effect.kind==='focus_node'){const node=document.querySelector(`[data-node-id="${CSS.escape(effect.targetId)}"]`);node?.click();node?.focus({preventScroll:true});}
        }
    }

    function message(text,result={}) {const key=`agent-connection:${projectId}`;if(!text)resolveCanvasNotice(key);else canvasNotice(text,{code:text===copy.connection?'canvas_connection_interrupted':'canvas_client_notice',projectId,errorCode:result.code,status:result.status,diagnosticRef:result.diagnosticRef,...(text===copy.connection?{key}:{})}); }
    function validRun(value) { return value && /^[a-f0-9]{32}$/.test(value.id || '') && value.projectId===projectId && typeof value.status==='string'; }
    function summaryItem(container, label, value) { container.append(create('dt', '', label), create('dd', '', value)); }
    function modelPending() {
        if (['not_dispatched', 'pending', 'unknown', 'completed', 'rejected', 'failed'].includes(run?.modelOperation?.outcome)) return ['pending', 'unknown'].includes(run.modelOperation.outcome);
        // Older saved runs may predate the durable operation projection. An
        // uncertain accepted request never becomes a fresh paid resume action.
        return /provider.*(timeout|unknown|review)/.test(run?.errorCode || '');
    }
    function modelHeld() {
        return modelPending() || run?.modelOperation?.outcome === 'failed' || ['review_required', 'billing_review', 'settlement_review'].includes(run?.modelOperation?.recovery);
    }
    function canControl(action) {
        if (!run || TERMINAL.has(run.status) || run.status === 'clarification_required') return false;
        if (action === 'resume' && modelHeld()) return false;
        if (Object.hasOwn(run, 'allowedActions')) return Array.isArray(run.allowedActions) && run.allowedActions.includes(action);
        if (action === 'pause') return !WAITING.has(run.status);
        if (action === 'resume') return run.status === 'paused';
        return action === 'cancel' || action === 'takeover';
    }
    function render() {
        const canStart = availability?.available === true;
        availabilityNote.hidden = canStart;
        availabilityNote.textContent = availability === null ? copy.checking : availability?.code === 'grok_47_unverified' ? copy.unavailableModel : copy.unavailable;
        availabilityDetails.hidden=canStart||!availability?.code;
        availabilityCode.textContent=availability?.code ? `${copy.reason}: ${availability.code}` : '';
        projectHint.hidden = Boolean(projectId);
        conversation.refresh();
        status.hidden = !run && !pendingStart?.uncertain;
        refresh.hidden = !run && !pendingStart?.uncertain;
        retryStart.hidden = !pendingStart?.uncertain || !pendingStart?.body;
        retryStart.disabled = busy;
        retryBudget.hidden=!pendingBudget?.uncertain;retryBudget.disabled=busy;
        retryBudget.textContent=pendingBudget?`${copy.budgetRetry} (${pendingBudget.body.proposedCapCredits})`:copy.budgetRetry;
        revise.disabled=busy||Boolean(pendingBudget);
        for (const node of Object.values(controls)) node.disabled = busy;
        inspect.disabled = busy || !projectId;
        if (!run) {
            phase.textContent = pendingStart?.uncertain ? copy.connection : '';
            counts.textContent = ''; summary.replaceChildren(); evidence.replaceChildren(); media.replaceChildren(); note.textContent = '';
            for (const node of Object.values(controls)) node.hidden = true;
            revise.hidden = true; stopHint.hidden = true; details.hidden = true; activity.render(null);return;
        }
        const terminal = TERMINAL.has(run.status), waiting = WAITING.has(run.status);
        phase.textContent = copy.phases[terminal||waiting?run.status:run.phase] || copy.phases[run.status] || copy.failed;
        const operation = run.modelOperation;
        const uncertain = modelPending();
        if (!terminal && operation?.recovery === 'settlement_review') phase.textContent = copy.phases.settlement_review;
        else if (!terminal && operation?.recovery === 'receipt_ready') phase.textContent = copy.modelReceived;
        else if (!terminal && operation?.recovery === 'review_required' && operation.outcome !== 'unknown') phase.textContent = copy.modelNeedsReview;
        else if (!terminal && uncertain) phase.textContent = operation?.outcome === 'pending' ? copy.modelPending : copy.modelUnknown;
        else if (!terminal && operation?.outcome === 'rejected') phase.textContent = copy.modelRejected;
        else if (!terminal && operation?.outcome === 'failed') phase.textContent = copy.modelFailed;
        if ((modelHeld() || operation?.recovery === 'receipt_ready') && run.status === 'paused') phase.textContent = `${copy.phases.paused} · ${phase.textContent}`;
        counts.textContent = Number.isInteger(run.completed) && Number.isInteger(run.total) && run.total > 0 && run.completed >= 0 && run.completed <= run.total
            ? `${run.completed} / ${run.total} ${copy.progress}` : '';
        const mediaProgress=run.mediaProgress;
        if(mediaProgress&&['waiting','generating','saved','blocked'].every(key=>Number.isSafeInteger(mediaProgress[key])&&mediaProgress[key]>=0))counts.textContent=['waiting','generating','saved','blocked'].map(key=>`${mediaProgress[key]} ${copy.mediaProgress[key]}`).join(' · ');
        summary.replaceChildren();
        const currentPhase = copy.phases[run.phase] || copy.phases[operation?.kind === 'plan' ? 'planning' : operation?.kind === 'evaluate' ? 'evaluating' : ''];
        if(Number.isSafeInteger(run.imageConcurrency?.project)&&run.imageConcurrency.project>0)summaryItem(summary,copy.imageCapacity,run.imageConcurrency.verified?String(run.imageConcurrency.project):copy.capacityUnverified);
        if (currentPhase) summaryItem(summary, copy.currentPhase, currentPhase);
        if (finite(run.targetDurationSeconds)) summaryItem(summary, copy.target, `${run.targetDurationSeconds} s`);
        if (finite(run.budgetCredits)) summaryItem(summary, copy.budgetSummary, String(run.budgetCredits));
        for (const [key, label] of [['chargedCredits', copy.charged], ['reservedCredits', copy.reserved]]) if (finite(run[key])) summaryItem(summary, label, String(run[key]));
        if(finite(run.committedCredits))summaryItem(summary,copy.committed,String(run.committedCredits));
        if(finite(run.remainingCredits))summaryItem(summary,copy.remaining,String(run.remainingCredits));
        const measuredDuration=run.result?.measuredDurationSeconds??run.result?.durationSeconds;
        if (finite(measuredDuration)) summaryItem(summary, copy.durationMeasured, `${measuredDuration} s`);
        const fileUrl = privateMediaUrl(run.result?.fileUrl);
        const complete = run.status === 'completed' && run.result?.assetId && fileUrl;
        if (run.status === 'completed' && !complete) phase.textContent = copy.failed;
        if (run.status === 'taken_over') phase.textContent = copy.phases.manual_takeover;
        note.textContent = terminal ? copy.editHint : waiting ? '' : copy.background;
        note.hidden=!note.textContent;
        if (complete) {
            let video = media.querySelector('video');
            if (!video) { video = create('video'); video.controls = true; video.preload = 'metadata'; video.setAttribute('aria-label', copy.preview); media.append(video); }
            if (video.src !== fileUrl) video.src = fileUrl;
            const poster = privateMediaUrl(run.result.previewUrl); if (poster) video.poster = poster; else video.removeAttribute('poster');
        } else media.replaceChildren();
        for (const [action, node] of Object.entries(controls)) node.hidden = !canControl(action);
        revise.hidden = !terminal || modelHeld();
        stopHint.hidden = terminal;
        details.hidden = false; evidence.replaceChildren();
        if(finite(run.allocatedCredits))summaryItem(evidence,copy.allocated,String(run.allocatedCredits));
        activity.render(run,{busy,decisionPending:Boolean(pendingBudget)});
        summaryItem(evidence, copy.requestId, run.id || '—');
        if (finite(run.pendingOutcomeCredits)) summaryItem(evidence, copy.pendingCost, String(run.pendingOutcomeCredits));
        if (typeof operation?.operationId === 'string') summaryItem(evidence, copy.operationId, operation.operationId);
        if(run.result?.technicalValidation==='processor_measured')summaryItem(evidence,copy.technical,copy.measured);
        if(run.result?.visualReview==='sampled_frames'&&run.result?.evaluation) {
            summaryItem(evidence,copy.visual,copy.sampled);
            if(typeof run.result.evaluation.confidence==='string')summaryItem(evidence,copy.confidence,german?({low:'Niedrig',medium:'Mittel',high:'Hoch'}[run.result.evaluation.confidence]||run.result.evaluation.confidence):run.result.evaluation.confidence);
            for(const issue of (Array.isArray(run.result.evaluation.issues)?run.result.evaluation.issues:[]).slice(0,8))if(typeof issue.reason==='string')summaryItem(evidence,`${copy.reviewIssue}: ${getState().nodes?.find(node=>node.id===issue.nodeId)?.title||String(issue.nodeId||'').slice(0,8)}`,issue.reason.slice(0,800));
        }
    }
    function error(result) {
        const policyError=canvasMediaPolicyError(result.code,german);
        if(policyError){message(policyError,result);return;}
        if (['model_pricing_stale', 'canvas_project_revision_conflict', 'project_revision_conflict', 'canvas_agent_project_changed', 'canvas_agent_tariff_changed','canvas_agent_budget_request_stale','canvas_agent_budget_request_conflict','canvas_agent_budget_request_changed','canvas_agent_budget_decision_conflict'].includes(result.code)) { message(copy.stale,result); }
        else if (result.code==='canvas_agent_budget_exceeded' || result.code==='canvas_agent_budget_required') { message(copy.budgetRequired,result); }
        else if (result.code==='canvas_agent_duration_invalid') message(copy.invalidDuration,result);
        else if (result.code==='canvas_agent_review_required') message(copy.blockedProvider,result);
        else if (['canvas_agent_model_unavailable','canvas_agent_disabled','canvas_agent_infrastructure_unavailable','model_area_disabled'].includes(result.code)) { availability={available:false,code:result.code};message(copy.unavailable,result); }
        else message(copy.connection,result);
    }
    async function fingerprint(body) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
        return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    function storageKey() { return `bitbi:canvas-agent-start:${projectId}`; }
    function clearStart() { pendingStart = null; try { sessionStorage.removeItem(storageKey()); } catch { /* No persistence dependency. */ } }
    function budgetStorageKey(){return `bitbi:canvas-agent-budget:${projectId}`;}
    function rememberBudget(){try{if(pendingBudget)sessionStorage.setItem(budgetStorageKey(),JSON.stringify(pendingBudget));else sessionStorage.removeItem(budgetStorageKey());}catch{/* The server owns authorization. */}}
    function closeStream(){stream?.close();stream=null;streamRun=null;}
    function acceptRun(next){
        if(run?.id!==next.id||run?.status!==next.status||run?.phase!==next.phase||run?.errorCode!==next.errorCode)refreshCanvasNotifications();
        if(run?.id!==next.id){eventCursor=0;activity.reset();closeStream();}
        run=next;
        if(pendingBudget&&pendingBudget.runId!==run.id){pendingBudget=null;rememberBudget();}
    }
    function acceptEvents(data){
        activity.appendEvents(data?.events);
        if(Number.isSafeInteger(data?.eventCursor)&&data.eventCursor>=eventCursor)eventCursor=data.eventCursor;
    }
    function connectEvents(){
        if(!visible||stopped||catchingUp||!run||TERMINAL.has(run.status)||typeof EventSource!=='function'){closeStream();return;}
        if(stream&&streamRun===run.id)return;
        closeStream();const current=epoch,id=run.id;
        const source=new EventSource(`/api/account/canvas/projects/${identifier(projectId)}/agent/${identifier(id)}/events?afterEvent=${eventCursor}`,{withCredentials:true});stream=source;streamRun=id;
        source.addEventListener('canvas_event',event=>{
            if(current!==epoch||stream!==source)return;
            let value;try{value=JSON.parse(event.data);}catch{return;}
            const seq=value?.seq??value?.id;if(!Number.isSafeInteger(seq)||seq<1)return;
            activity.appendEvents([value]);eventCursor=Math.max(eventCursor,seq);
        });
        source.onerror=()=>{if(stream===source)closeStream();};
    }
    async function decideBudget(decision,request){
        if(busy||pendingBudget||!run||TERMINAL.has(run.status)||!['accept','decline'].includes(decision)||JSON.stringify(request)!==JSON.stringify(run.budgetRequest))return;
        const current=epoch,id=run.id;busy=true;controller?.abort();clearTimeout(timer);render();
        try{
            // A local edit must reach the server before an initial cap decision.
            // Keep the displayed revision: a newer saved project must reject it,
            // never silently rebase the user's authorization onto another plan.
            if(!await flush()){message(copy.saving);return;}
            if(current!==epoch||run?.id!==id)return;
            if(JSON.stringify(request)!==JSON.stringify(run.budgetRequest)){message(copy.stale);return;}
            const body={requestId:request.id,requestRevision:request.revision,decision,proposedCapCredits:request.proposedCapCredits,expectedRevision:request.projectRevision};
            const pending={runId:id,body,tariffRevision:request.tariffRevision,key:crypto.randomUUID(),uncertain:false};
            pendingBudget=pending;pending.fingerprint=await fingerprint({body,tariffRevision:request.tariffRevision});
            if(current!==epoch||pendingBudget!==pending)return;rememberBudget();
        }finally{busy=false;render();schedule();}
        await sendBudget();
    }
    async function sendBudget(){
        if(busy||!pendingBudget||!run||pendingBudget.runId!==run.id||!projectId)return;
        const pending=pendingBudget,current=epoch;
        busy=true;controller?.abort();clearTimeout(timer);render();message('');
        try{
            if(await fingerprint({body:pending.body,tariffRevision:pending.tariffRevision})!==pending.fingerprint){message(copy.budgetDecisionInvalid);return;}
            const response=await canvasRequest(`/projects/${identifier(projectId)}/agent/${identifier(pending.runId)}/budget`,{method:'POST',body:pending.body,idempotencyKey:pending.key,tariffRevision:pending.tariffRevision,timeoutMs:30000});
            if(current!==epoch)return;
            if(response.ok&&validRun(response.data?.run)&&response.data.run.id===pending.runId){acceptRun(response.data.run);pendingBudget=null;rememberBudget();message(pending.body.decision==='accept'?copy.budgetAccepted:copy.budgetDeclined);}
            else if(response.status===0||response.status>=500||response.ok){pending.uncertain=true;rememberBudget();message(copy.budgetDecisionPending);}
            else{pendingBudget=null;rememberBudget();error(response);}
        }finally{busy=false;render();schedule();}
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
            if (response.ok && validRun(response.data?.run) && response.data.run.requestKey===pending.key) { acceptRun(response.data.run); clearStart();  message(''); }
            else if (response.status > 0 && response.status < 500 && !response.ok) { clearStart(); error(response); }
            else message(copy.connection);
            schedule();
        } finally { busy=false; render(); }
    }
    async function control(action) {
        if (busy || !run?.id || !projectId || !canControl(action)) return;
        busy = true; controller?.abort(); clearTimeout(timer); message(''); render(); const current = epoch, id = run.id;
        const identity = `${id}:${action}:${run.status}`;
        if (!controlKeys.has(identity)) controlKeys.set(identity, crypto.randomUUID());
        try {
            const response = await canvasRequest(`/projects/${identifier(projectId)}/agent/${identifier(id)}/control`, { method: 'POST', body: { action }, idempotencyKey: controlKeys.get(identity), timeoutMs: 30000 });
            if (current !== epoch) return;
            if (response.ok && validRun(response.data?.run) && response.data.run.id === id) { acceptRun(response.data.run); if (action === 'takeover') await view(); }
            else error(response);
            schedule();
        } finally { busy = false; render(); }
    }
    async function view() {
        const id=projectId,current=epoch;
        if (!id || !await flush() || current !== epoch) return;
        await openProject(id);
    }
    function schedule(delay=4000,catchup=false,connect=true) {
        clearTimeout(timer);
        catchingUp=catchup;if(connect)connectEvents();
        if (!visible || stopped || !projectId || (run && TERMINAL.has(run.status)&&!catchup)) return;
        timer = setTimeout(() => void observe(), delay);
    }
    async function observe() {
        if (stopped || busy) { schedule(); return; }
        controller?.abort(); controller = new AbortController(); const current = epoch, observation=controller;
        const response = await canvasRequest(projectId ? `/projects/${identifier(projectId)}/agent?afterEvent=${eventCursor}` : '/agent/capabilities', { signal: observation.signal, timeoutMs: 15000 });
        if (current !== epoch || stopped || observation.signal.aborted) return;
        if (response.ok) {
            availability = response.data?.availability || { available: false };
            if (validRun(response.data?.run)) {
                acceptRun(response.data.run);acceptEvents(response.data);
                if (!pendingStart || run.requestKey === pendingStart.key) clearStart();
            }
            if (!pendingStart?.uncertain) message('');
        } else {
            if (availability === null) availability = { available: false };
            if (run || pendingStart?.uncertain) message(copy.connection);
        }
        render(); schedule(response.ok&&response.data?.hasMore?100:4000,Boolean(response.ok&&response.data?.hasMore));
    }
    // WebKit can reject navigation-cancelled reads before pagehide. Mark only
    // this observer's read as cancelled. Close SSE without opening a new stream
    // during unload; a declined navigation resumes reads and SSE on the timer.
    window.addEventListener('beforeunload', () => { controller?.abort();closeStream();schedule(4000,false,false); });
    window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); controller?.abort();closeStream(); });
    window.addEventListener('pageshow',()=>{stopped=false;placeHelp();if(visible)void observe();});
    render();
    return {
        stopVoice() { conversation.stopVoice(); },
        setVisible(value) { const changed = visible !== value; visible = value;placeHelp(); conversation.setVisible(value); if (visible && changed) void observe(); else if (!visible){clearTimeout(timer);closeStream();} },
        projectChanged() {
            const id = getState().project?.id || null; if (id === projectId) return;
            epoch += 1; projectId = id; run = null; pendingStart = null; pendingBudget=null; catchingUp=false; availability = null;eventCursor=0;activity.reset();closeStream();
            try {
                const stored = JSON.parse(sessionStorage.getItem(storageKey()) || 'null');
                if (stored?.key && stored?.fingerprint && stored?.body) pendingStart = {...stored,uncertain:true};
                const decision=JSON.parse(sessionStorage.getItem(budgetStorageKey())||'null');if(decision?.key&&decision?.fingerprint&&decision?.body&&decision?.runId)pendingBudget={...decision,uncertain:true};
            } catch { /* Server status recovery still works without browser storage. */ }
            conversation.projectChanged(id); message(''); clearTimeout(timer); controller?.abort(); render();
            if (visible) void observe();
        },
    };
}
