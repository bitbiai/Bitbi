import { canvasRequest } from './api.js?v=__ASSET_VERSION__';
import { createCanvasTranscript } from './agent-transcript.js?v=__ASSET_VERSION__';
import { createCanvasConversationActions } from './agent-conversation-actions.js?v=__ASSET_VERSION__';
import { canvasConversationCopy } from './agent-conversation-copy.js?v=__ASSET_VERSION__';
import { CANVAS_AGENT_LIMITS } from '../../shared/canvas-agent-contract.mjs?v=__ASSET_VERSION__';
import { detectCanvasDirectControl, canvasImmediateStartRequested } from '../../shared/canvas-agent-control-intent.mjs?v=__ASSET_VERSION__';
import {canvasConversationDecisionIntent} from '../../shared/canvas-conversation-decision-intent.mjs?v=__ASSET_VERSION__';

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
export function createCanvasAgentConversation({ root, german, flush, getRun, canProduce, onRun, canControl=()=>false, onControl=()=>{}, onEffect=()=>{} }) {
    const copy = canvasConversationCopy(german);
    let projectId = null, epoch = 0, visible = false, busy = false, snapshot = null, availability = null;
    let pending = null, timer = null, controller = null, closed = false, briefKey = '', draftDirty = false, activeTab = 'chat';
    let observationIdentity = null, observationStarted = 0, observationCount = 0, observationFailures = 0, reading = null, disconnected = false, catchUpRequested = false;
    let feedbackText = copy.loading;
    const section = create('section', 'canvas-agent__conversation'); section.setAttribute('aria-label', copy.conversation);
    const modelExclusions=create('details','canvas-disclosure'),modelExclusionList=create('ul');modelExclusions.append(create('summary','',copy.excludedModels),modelExclusionList);
    const modelHeader=create('div','canvas-agent__model-header'),modelSelect=create('select','canvas-input'),modelHint=create('p','canvas-muted',copy.modelHint);
    modelSelect.name='assistantModel';modelHint.id='canvasAssistantModelHint';modelSelect.setAttribute('aria-describedby',modelHint.id);
    modelSelect.addEventListener('change',()=>void chooseModel());modelHeader.append(field(copy.assistantModel,modelSelect),modelHint);
    const tabs = create('div', 'canvas-agent__tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', copy.workspace);
    const chatTab = button(copy.chatTab, () => selectTab('chat')), projectTab = button(copy.projectTab, () => selectTab('project'));
    const chatPane = create('div', 'canvas-agent__chat-pane'), projectPane = create('div', 'canvas-agent__project-pane');
    for (const [name, tab, pane] of [['chat',chatTab,chatPane],['project',projectTab,projectPane]]) {
        tab.id = `canvasAgent${name}Tab`; tab.setAttribute('role','tab'); tab.setAttribute('aria-controls', `canvasAgent${name}Pane`);
        pane.id = `canvasAgent${name}Pane`; pane.setAttribute('role','tabpanel'); pane.setAttribute('aria-labelledby', tab.id);
        tab.addEventListener('keydown', event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'chat' : event.key === 'End' ? 'project' : name === 'chat' ? 'project' : 'chat'; selectTab(next); (next === 'chat' ? chatTab : projectTab).focus(); } });
    }
    tabs.append(chatTab, projectTab);
    const viewport = create('div','canvas-agent__transcript'); viewport.tabIndex=0; viewport.setAttribute('aria-label',copy.conversation);
    const newest = button(copy.newMessages, () => {}); newest.classList.add('canvas-agent__new-messages'); newest.hidden=true;
    const welcome = create('p', 'canvas-agent__welcome', copy.welcome);
    const transcript = create('ol', 'canvas-agent__messages'); transcript.setAttribute('aria-label', copy.conversation); transcript.setAttribute('aria-live', 'polite'); transcript.setAttribute('aria-relevant', 'additions text');
    const notice = create('p', 'canvas-agent__notice', copy.loading); notice.setAttribute('role', 'status');
    const projectNotice = create('p','canvas-agent__notice'); projectNotice.setAttribute('role','status');projectNotice.hidden=true;
    const recovery = button(copy.check, () => void replay());
    const reload = button(copy.reconnect, () => void observe());
    const makeNow=button(copy.makeNow,()=>void immediateStart(),true);makeNow.classList.add('canvas-agent__make-now');
    const makeHint=create('p','canvas-agent__start-hint',copy.makeNowHint);makeHint.id='canvasAgentStartHint';makeNow.setAttribute('aria-describedby',makeHint.id);
    const composer = create('form', 'canvas-agent__composer');
    const input = create('textarea', 'canvas-textarea'); input.name = 'message'; input.rows = 1; input.maxLength = 6000; input.placeholder = copy.placeholder;
    const send = create('button', 'canvas-button canvas-button--primary', copy.send); send.type = 'submit';
    const messageField=field(copy.message,input); messageField.firstElementChild.classList.add('canvas-sr-only'); composer.append(messageField, send);
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
    const correct = button(copy.correct, () => { selectTab('chat'); notify(copy.correctHint); input.focus({preventScroll:true}); });
    const briefOverview=create('p','canvas-agent__brief-overview'),creativeDetails=create('details','canvas-disclosure');creativeDetails.append(create('summary','',copy.briefDetails),briefContent,questions,revision);
    brief.append(create('h4', '', copy.briefTitle),briefOverview,correct,creativeDetails);
    const production = create('form', 'canvas-agent__production-approval'); production.noValidate = true;
    const cap = create('input', 'canvas-input'); cap.type = 'number'; cap.name = 'budget'; cap.min = '1'; cap.max = String(CANVAS_AGENT_LIMITS.maxBudgetCredits); cap.step = '1'; cap.inputMode = 'numeric';
    const approval = create('input'); approval.type = 'checkbox'; approval.name = 'authorize';
    const approvalField = field(copy.productionApprove, approval); approvalField.classList.add('canvas-agent__check');
    const produce = create('button', 'canvas-button canvas-button--primary', copy.productionStart); produce.type = 'submit';
    const productionNote = create('p', 'canvas-muted');
    production.append(create('h4', '', copy.productionTitle), create('p', 'canvas-muted', copy.productionHint), field(copy.productionBudget, cap), approvalField, produce, productionNote);
    const privacy = create('details', 'canvas-disclosure canvas-agent__privacy'); privacy.append(create('summary', '', copy.privacy));
    const clear = button(copy.clear, () => { confirmation.hidden = false; clearConfirm.focus(); });
    const confirmation = create('div', 'canvas-agent__clear'); confirmation.hidden = true;
    const clearConfirm = button(copy.clearConfirm, () => void control('clear'));
    const clearBack = button(copy.clearBack, () => { confirmation.hidden = true; clear.focus(); });
    confirmation.append(create('p', '', copy.clearHint), clearConfirm, clearBack); privacy.append(clear, confirmation);
    const options=create('details','canvas-disclosure canvas-agent__briefing-options'); options.append(create('summary','',copy.briefingOptions),shortcuts);
    const budgetPrompt=button(copy.allowanceApprove,()=>{showAllowance();}); budgetPrompt.classList.add('canvas-agent__approval-prompt');
    const runBar=create('div','canvas-agent__chat-run'),runText=create('span');
    const runControls=Object.fromEntries([['pause',copy.runPause],['resume',copy.runResume],['cancel',copy.runCancel]].map(([action,label])=>[action,button(label,()=>{if(canControl(action))void onControl(action);})]));
    const runView=button(copy.runView,()=>{selectTab('project');productionArea.scrollTop=0;});runBar.append(runText,...Object.values(runControls),runView);
    const messageActions=create('div','canvas-agent__message-actions'); messageActions.append(makeNow,reload,recovery);
    const feedback=create('div','canvas-agent__chat-feedback'); feedback.append(notice,budgetPrompt);
    const footer=create('div','canvas-agent__chat-footer'); footer.append(runBar,feedback,composer,messageActions,makeHint);
    const content=create('div','canvas-agent__conversation-content'),decisions=create('div','canvas-agent__decisions'),immediateCard=create('section','canvas-agent__immediate');immediateCard.hidden=true;immediateCard.setAttribute('aria-label',copy.immediateTitle);
    const immediateTitle=create('h4'),immediateText=create('p'),immediateQuote=create('dl','canvas-agent__summary'),immediateHint=create('p','canvas-muted',copy.quoteHint);
    const immediateScope=create('details','canvas-disclosure canvas-agent__immediate-scope'),scopeTitle=create('summary'),scopeText=create('p');immediateScope.append(scopeTitle,scopeText);
    const approveImmediate=button(copy.approveFilm,()=>void immediateApprove(),true),cancelImmediate=button(copy.cancelIntent,()=>void immediateCancel());
    immediateCard.append(immediateTitle,immediateText,immediateScope,immediateQuote,immediateHint,approveImmediate,cancelImmediate);decisions.append(immediateCard);
    const decisionCard=create('section','canvas-agent__decision');decisionCard.setAttribute('aria-label',copy.decisionTitle);decisionCard.hidden=true;
    const decisionText=create('p'),decisionAmount=create('p','canvas-agent__decision-amount'),decisionApprove=button(copy.decisionApprove,()=>void decide('accept'),true),decisionDecline=button(copy.decisionDecline,()=>void decide('decline'));
    decisionCard.append(create('h4','',copy.decisionTitle),decisionText,decisionAmount,decisionApprove,decisionDecline);decisions.append(decisionCard);
    content.append(welcome,transcript,decisions);viewport.append(content);chatPane.append(viewport,newest,footer);
    const productionArea=create('div','canvas-agent__production-area'),manualProduction=create('details','canvas-disclosure canvas-agent__manual-production');manualProduction.append(create('summary','',copy.productionOptions),production);
    const advanced=create('details','canvas-disclosure canvas-agent__advanced'),finance=create('details','canvas-disclosure canvas-agent__finance');finance.append(create('summary','',copy.briefingFinance),allowance,allowanceLedger);
    advanced.append(create('summary','',copy.advanced),finance,options,modelExclusions,privacy);projectPane.append(projectNotice,brief,productionArea,manualProduction,advanced);
    section.append(modelHeader,tabs,chatPane,projectPane); root.append(section);
    const transcriptView=createCanvasTranscript({viewport,list:transcript,welcome,newest,copy,content});
    const footerObserver=new ResizeObserver(()=>chatPane.style.setProperty('--canvas-chat-footer-height',`${footer.getBoundingClientRect().height}px`));footerObserver.observe(footer);
    const actionView=createCanvasConversationActions({parent:decisions,copy,confirm:confirmAction,effect:onEffect,changed:()=>transcriptView.changed()});
    function selectTab(name) { activeTab=name; chatPane.hidden=name!=='chat';projectPane.hidden=name!=='project'; for(const [key,tab] of [['chat',chatTab],['project',projectTab]]){tab.setAttribute('aria-selected',String(key===name));tab.tabIndex=key===name?0:-1;} notify(feedbackText);if(name==='chat')transcriptView.show(); }
    selectTab('chat');

    function path(suffix = '') { return `/projects/${encodeURIComponent(projectId)}/agent/conversation${suffix}`; }
    function storageKey() { return `bitbi:canvas-conversation-request:${projectId}`; }
    function notify(text) { feedbackText=text;notice.textContent=activeTab==='chat'?text:'';projectNotice.textContent=activeTab==='project'?text:'';notice.hidden=!notice.textContent;projectNotice.hidden=!projectNotice.textContent; }
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
        if(data?.run?.projectId===projectId&&/^[a-f0-9]{32}$/.test(data.run.id||''))onRun(data.run);
        if (!draftDirty && !pending) { input.value = string(snapshot.draft); sizeComposer(); }
        const suggested = snapshot.allowance?.suggestedAllowanceCredits || snapshot.suggestedAllowanceCredits || data.suggestedAllowanceCredits;
        if (!allowanceCap.value && count(suggested)) allowanceCap.value = String(suggested);
        return true;
    }
    function item(list, label, value) { list.append(create('dt', '', label), create('dd', '', String(value))); }
    function renderBrief() {
        const value = snapshot?.brief, key = JSON.stringify(value || null);
        if (key === briefKey) return;
        briefKey = key; briefContent.replaceChildren(); questions.replaceChildren();
        briefOverview.textContent=[displayValue(value?.fields?.story?.value),value?.fields?.latestInstruction?.value?`${copy.fields.latestInstruction}: ${displayValue(value.fields.latestInstruction.value)}`:'',value?.duration?.targetDurationSeconds>0?`${value.duration.targetDurationSeconds} s`:'',displayValue(value?.fields?.style?.value),displayValue(value?.fields?.audio?.value)].filter(Boolean).join(' · ')||copy.briefEmpty;
        for (const [name, entry] of Object.entries(value?.fields || {})) {
            if (!copy.fields[name] && name !== 'delegatedChoices') continue;
            const raw = displayValue(entry?.value); if (!raw) continue;
            const text = name === 'delegatedChoices' && entry.provenance === 'delegated' && ['Choose reasonable defaults for optional creative details. This does not delegate duration or spending.','Choose suitable defaults for optional creative details; duration and spending remain separate.'].includes(raw) ? copy.optionalDelegation : raw;
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
        const paused = snapshot?.state !== 'active', waiting = Boolean(snapshot?.pendingTurnId);
        const review = typeof snapshot?.canSend === 'boolean' ? !snapshot.canSend && !paused : snapshot?.messages.some(message => message.status === 'review_required');
        const blocked = busy || Boolean(pending) || !snapshot;
        composer.setAttribute('aria-busy', String(busy));
        input.disabled = !snapshot || busy; input.readOnly = false;
        updateSendAdmission();
        send.textContent = busy ? copy.sending : copy.send;
        recovery.hidden = !pending; recovery.disabled = busy;
        reload.hidden = !snapshot; reload.disabled = busy;
        for (const node of [delegate, prepare, save, cancel, resume, clear, clearConfirm]) node.disabled = blocked;
        save.disabled = blocked; cancel.hidden = snapshot?.state === 'cancelled'; resume.hidden = !snapshot || snapshot.state === 'active';
        delegate.hidden = !snapshot?.brief?.duration?.asked || Boolean(snapshot?.brief?.duration?.choice); delegate.disabled ||= waiting || paused;
        prepare.disabled ||= waiting || paused; correct.disabled = blocked;
        const a = snapshot?.allowance;
        allowance.hidden = !snapshot || (count(a?.remainingCredits) && a.remainingCredits > 0 && !snapshot?.allowanceRequired);
        budgetPrompt.hidden = allowance.hidden || paused;
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
            if(count(a.reservedCredits))item(allowanceLedger,copy.allowanceReserved,a.reservedCredits);
            if(count(a.chargedCredits))item(allowanceLedger,copy.allowanceCharged,a.chargedCredits);
            item(allowanceLedger, copy.allowanceRemaining, a.remainingCredits);
        }
        const active = getRun() && !terminal.has(getRun().status), duration = snapshot?.brief?.duration;
        makeNow.disabled=blocked||Boolean(active)||availability?.available!==true;
        runBar.hidden=!getRun()||(!active&&!getRun().result);runText.textContent=active?copy.productionBusy:copy.runOverview;
        for(const [action,node]of Object.entries(runControls)){node.hidden=!canControl(action);node.disabled=!canControl(action);}
        const ready = Boolean(snapshot?.brief?.fields?.story?.value) && (duration?.choice === 'delegated' || duration?.targetDurationSeconds > 0);
        production.hidden = !snapshot || !Object.keys(snapshot.brief.fields || {}).length;
        manualProduction.hidden=production.hidden;
        cap.disabled = approval.disabled = produce.disabled = blocked || waiting || review || paused || active || !canProduce() || !ready || availability?.available !== true;
        productionNote.textContent = !canProduce() ? copy.unknown : active ? copy.productionBusy : ready ? '' : copy.productionMissing;
        const messages=[...(snapshot?.messages||[])], held=snapshot?.blockingOperation;
        if(held&&!messages.some(message=>message.delivery?.diagnosticReference===held.diagnosticReference))messages.push({id:`held:${held.diagnosticReference||held.turnId||'request'}`,role:'system',status:'review_required',delivery:{...held,source:'system'}});
        if (busy && pending?.suffix === '/messages') messages.push({id:'local:sending',role:'system',status:'pending',delivery:{stage:'sending',source:'system'}});
        section.dataset.motion = visible && !closed && document.visibilityState !== 'hidden' ? 'active' : 'paused';
        transcriptView.render(messages, {offline:disconnected,delayed:observationStarted>0&&Date.now()-observationStarted>45000}); renderBrief();renderImmediate();renderModelAndDecision();if(snapshot)actionView.render(snapshot.actions,{busy:blocked});
    }
    function updateSendAdmission(){
        const text=input.value.trim(),direct=detectCanvasDirectControl(text),immediate=canvasImmediateStartRequested(text);
        const localDecision=canvasConversationDecisionIntent(text,{locale:german?'de':'en',budgetAsked:snapshot?.pendingDecision?.kind==='production_budget'});
        const held=typeof snapshot?.canSend==='boolean'?!snapshot.canSend:snapshot?.messages.some(message=>message.status==='review_required');
        const blocked=busy||Boolean(pending)||!snapshot;
        send.disabled=blocked||(!direct&&(immediate&&!localDecision?Boolean(getRun()&&!terminal.has(getRun().status))||availability?.available!==true:snapshot?.state!=='active'||Boolean(snapshot?.pendingTurnId)||held||(!localDecision&&snapshot.allowance?.remainingCredits>0&&availability?.available!==true)));
    }
    let modelOptionsKey='';
    function renderModelAndDecision(){
        const selection=snapshot?.reasoningModel,models=selection?.eligibleModels||[],key=JSON.stringify(models.map(model=>[model.modelId,model.displayName,model.available,model.reason]));
        if(key!==modelOptionsKey){modelOptionsKey=key;modelSelect.replaceChildren();modelExclusionList.replaceChildren();for(const model of models){const option=create('option','',model.displayName+(model.available?'':` · ${copy.modelUnavailable}`));option.value=model.modelId;option.disabled=!model.available;if(!model.available){const reason=copy.modelReasons[/adapter/.test(model.reason)?'adapter':/pricing/.test(model.reason)?'pricing':/disabled|model_unavailable/.test(model.reason)?'disabled':/infrastructure/.test(model.reason)?'infrastructure':'provider'];option.title=reason;modelExclusionList.append(create('li','',`${model.displayName}: ${reason}`));}modelSelect.append(option);}}
        modelExclusions.hidden=!modelExclusionList.children.length;
        if(selection?.modelId)modelSelect.value=selection.modelId;
        modelSelect.disabled=busy||Boolean(pending)||!selection;modelHeader.hidden=!selection;
        const decision=snapshot?.pendingDecision;
        decisionCard.hidden=!decision||!['production_start','briefing_allowance'].includes(decision.kind);
        if(!decisionCard.hidden){decisionCard.dataset.state=decision.state;decisionText.textContent=decision.state==='stale'?copy.decisionStale:copy.decisionHint;
            decisionCard.querySelector('h4').textContent=decision.kind==='briefing_allowance'?copy.allowanceTitle:copy.decisionTitle;
            decisionApprove.textContent=decision.kind==='briefing_allowance'?copy.allowanceApprove:copy.decisionApprove;
            if(decision.kind==='briefing_allowance'&&decision.state!=='stale')decisionText.textContent=copy.allowanceHint;
            decisionAmount.textContent=`${decision.scope.capCredits} ${copy.credits} · ${selection?.displayName||decision.scope.modelId}`;
            decisionApprove.disabled=busy||Boolean(pending)||decision.state!=='pending';decisionDecline.disabled=decisionApprove.disabled;}
    }
    let immediateKey='';
    function renderImmediate(){
        const intent=snapshot?.immediateIntent,key=JSON.stringify(intent||null),changed=key!==immediateKey;immediateKey=key;
        immediateCard.hidden=!intent;
        if(!intent)return;
        immediateCard.dataset.state=intent.state;
        immediateTitle.textContent=copy.immediateTitle;
        immediateText.textContent=({waiting:copy.immediateWaiting,approval_required:copy.quoteReview,authorized:copy.immediateAuthorized,started:copy.immediateStarted,blocked:copy.immediateBlocked,cancelled:copy.immediateCancelled})[intent.state]||copy.immediateBlocked;
        const quote=intent.quote,validQuote=quote&&count(quote.proposedCapCredits)&&quote.proposedCapCredits>0&&count(quote.expectedRevision)&&count(quote.expectedBriefRevision)&&count(quote.tariffRevision);
        immediateQuote.hidden=!quote;immediateHint.hidden=!quote;
        if(changed){immediateQuote.replaceChildren();immediateScope.hidden=!quote;scopeText.textContent=typeof quote?.scope==='string'?quote.scope:string(quote?.scope?.brief);scopeTitle.textContent=copy.quoteScope+(quote?.scope?.targetDurationSeconds>0?` · ${quote.scope.targetDurationSeconds} s`:quote?.scope?.estimatedSeconds>0?` · ${copy.quoteDelegated}: ${quote.scope.estimatedSeconds} s`:'');
            if(quote){for(const [name,label]of [['proposedCapCredits',copy.productionBudget],['planningCredits',copy.quotePlanning],['estimatedMediaCredits',copy.quoteMedia],['evaluationCredits',copy.quoteEvaluation],['committedCredits',copy.quoteCommitted]])if(count(quote[name]))item(immediateQuote,label,name==='planningCredits'?quote[name]*Math.max(1,Math.min(3,Number(quote.scope?.includesPlanningAttempts)||1)):quote[name]);}transcriptView.changed();}
        approveImmediate.hidden=intent.state!=='approval_required';approveImmediate.disabled=busy||Boolean(pending)||!validQuote;
        cancelImmediate.hidden=['started','cancelled'].includes(intent.state);cancelImmediate.disabled=busy||Boolean(pending);
    }
    function showAllowance(){selectTab('chat');decisions.prepend(allowance);allowance.hidden=false;transcriptView.bottom();allowanceCap.focus({preventScroll:true});}
    function failure(response) {
        const stage=response.data?.delivery?.stage;
        if(copy.delivery[stage])notify(copy.delivery[stage]);
        else if (response.code === 'model_pricing_stale') { approval.checked = false; notify(copy.allowanceStale); }
        else if (/revision|changed|stale/.test(response.code || '')) { approval.checked = false; notify(copy.stale); }
        else if (response.code === 'canvas_agent_budget_exceeded') notify(copy.projectBudgetBlocked);
        else if (/allowance|briefing_budget/.test(response.code || '')) { snapshot.allowanceRequired = true; notify(copy.allowanceRequired);showAllowance(); }
        else if (/duration/.test(response.code || '')) notify(copy.durationNeeded);
        else if (/pending|unknown|review/.test(response.code || '')) notify(copy.review);
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
                    onRun(response.data.run); approval.checked = false; selectTab('project');
                } else if (!accept(response.data)) { notify(copy.unsent); return; }
                pending = null; remember();
                if (request.suffix === '/messages') { input.value = ''; draftDirty = false; sizeComposer();notify(''); }
                else if(request.suffix==='/immediate'){input.value='';draftDirty=false;sizeComposer();notify('');selectTab('chat');transcriptView.bottom();}
                else if(request.suffix.startsWith('/immediate/')){notify('');selectTab('chat');}
                else if (request.suffix === '/allowance') {selectTab('chat');notify(copy.allowanceAccepted);}
                else if (request.body.action === 'save') { draftDirty = false; notify(copy.saved); }
                else if (request.body.action === 'clear') { input.value = ''; draftDirty = false; confirmation.hidden = true; notify(copy.cleared); }
                else if (request.body.action === 'cancel') notify(copy.cancelled);
                else notify('');
            } else if (response.status === 0 || response.status >= 500) {selectTab('chat');notify(copy.unsent);}
            else { pending = null; remember(); failure(response); if (/revision|changed|stale/.test(response.code || '')) await observe(true); }
        } finally { if (current === epoch) { busy = false; render(); schedule(); } }
    }
    async function sendMessage(event) {
        event.preventDefault(); if (send.disabled || !snapshot) return;
        const text = input.value.trim(); if (!text) { input.focus(); return; }
        if(canvasImmediateStartRequested(text)&&!canvasConversationDecisionIntent(text,{locale:german?'de':'en'})){await immediateStart();return;}
        const direct=detectCanvasDirectControl(text);
        if(!direct){const current=epoch;busy=true;render();try{if(!await flush()||current!==epoch)return;}finally{if(current===epoch){busy=false;render();}}}
        await sendRequest('/messages', { text, locale: german ? 'de' : 'en', expectedConversationRevision: snapshot.revision, expectedBriefRevision: snapshot.briefRevision }, snapshot.allowance?.tariffRevision);
    }
    async function chooseModel(){
        const selection=snapshot?.reasoningModel,modelId=modelSelect.value;
        if(!selection||busy||pending||modelId===selection.modelId)return;
        await sendRequest('/model',{modelId,expectedConversationRevision:snapshot.revision,expectedModelRevision:selection.revision});
    }
    async function decide(decision){
        const current=snapshot?.pendingDecision;if(!current||decisionApprove.disabled||!await flush())return;
        await sendRequest('/decision',{decisionId:current.id,decisionRevision:current.revision,decision,expectedConversationRevision:snapshot.revision,expectedBriefRevision:snapshot.briefRevision},current.scope.tariffRevision);
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
    async function immediateStart(){
        if(makeNow.disabled||!snapshot)return;
        const text=input.value.trim(),current=epoch;busy=true;render();let body;
        try{
            if(!await flush()||current!==epoch)return;
            const response=await canvasRequest(`/projects/${encodeURIComponent(projectId)}`,{timeoutMs:15000});
            if(current!==epoch)return;
            if(!response.ok||!count(response.data?.project?.revision)){notify(copy.unavailable);return;}
            body={text,locale:german?'de':'en',expectedConversationRevision:snapshot.revision,expectedBriefRevision:snapshot.briefRevision,expectedRevision:response.data.project.revision,delegateCreative:true};
        }finally{if(current===epoch){busy=false;render();}}
        if(body&&current===epoch)await sendRequest('/immediate',body,snapshot.allowance?.tariffRevision);
    }
    async function immediateApprove(){
        const intent=snapshot?.immediateIntent,quote=intent?.quote;
        if(approveImmediate.disabled||!quote)return;
        if(!await flush())return;
        await sendRequest('/immediate/approve',{intentId:intent.id,intentRevision:intent.revision,capCredits:quote.proposedCapCredits,authorized:true,expectedRevision:quote.expectedRevision,expectedBriefRevision:quote.expectedBriefRevision},quote.tariffRevision);
    }
    async function immediateCancel(){const intent=snapshot?.immediateIntent;if(!intent||cancelImmediate.disabled)return;await sendRequest('/immediate/control',{intentId:intent.id,intentRevision:intent.revision,action:'cancel'});}
    async function confirmAction(action,decision){
        const value=action.confirmation;if(!value||busy||pending||!['accept','decline'].includes(decision))return;
        if(!await flush())return;
        const body={decision,expectedRevision:value.expectedRevision,expectedBriefRevision:value.expectedBriefRevision};
        for(const key of ['capCredits','tariffRevision','credits'])if(count(value[key]))body[key]=value[key];
        await sendRequest(`/actions/${encodeURIComponent(action.id)}/confirm`,body,value.tariffRevision);
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
            body = {text:german?`Starte jetzt mit maximal ${budgetCredits} Credits`:`Start now with at most ${budgetCredits} credits`,expectedConversationRevision:approved.conversation,expectedBriefRevision:approved.brief,locale:german?'de':'en'};
        } finally { if (current === epoch) { busy = false; render(); } }
        if (body && current === epoch) await sendRequest('/messages', body, snapshot.allowance?.tariffRevision);
    }
    function schedule() {
        clearTimeout(timer);
        const held=snapshot?.blockingOperation;
        const observed=snapshot?.messages.find(message=>message.delivery?.canObserve&&message.delivery.stage!=='completed');
        const legacyReview=snapshot?.messages.find(message=>message.status==='review_required'&&!message.delivery);
        const pendingReply=snapshot?.messages.find(message=>message.id===`${snapshot?.pendingTurnId}:reply`);
        // A saved turn is observable before a provider operation exists. Only
        // an explicit terminal/operator boundary ends normal pending activity.
        const pendingTurn=snapshot?.pendingTurnId&&!(pendingReply?.delivery?.recovery==='operator'&&pendingReply.delivery.canObserve===false)?snapshot.pendingTurnId:null;
        const intent=snapshot?.immediateIntent;
        const action=snapshot?.actions?.find(value=>['proposed','executing','pending'].includes(value.state));
        const identity=pending?.key||pendingTurn||(intent?.canObserve?intent.id:null)||(held?.canObserve?held.diagnosticReference:null)||observed?.id||action?.id||legacyReview?.id;
        if(!visible||closed||document.visibilityState==='hidden'||!projectId||(!identity&&!observationFailures))return;
        if(identity!==observationIdentity){observationIdentity=identity;observationStarted=Date.now();observationCount=0;}
        // Bound each HTTP read, not the logical turn. Late callbacks still arrive
        // after five minutes, and outages back off without abandoning the turn.
        const delay=observationFailures?Math.min(30000,2000*2**Math.min(observationFailures,4)):Math.min(10000,1200+observationCount++*600);
        timer=setTimeout(()=>void observe(),delay);
    }
    async function observe(force = false) {
        if (!projectId || closed || !visible || document.visibilityState==='hidden') return;
        if (reading) {catchUpRequested ||= force;return reading;}
        if (busy && !force) { schedule(); return; }
        clearTimeout(timer); const observation = new AbortController(), current = epoch; controller = observation;
        reading=(async()=>{
            const response = await canvasRequest(path(), { signal: observation.signal, timeoutMs: 15000 });
            if (current !== epoch || observation.signal.aborted) return;
            if (response.ok && accept(response.data)) {
                disconnected=false;observationFailures=0;
                if (!pending && !busy) notify(availability?.available!==true ? copy.unavailable : '');
            } else { disconnected=true;observationFailures++;notify(copy.connectionRetry); }
            render();
        })();
        try { await reading; } finally { if (controller===observation) {reading=null;controller=null;const again=catchUpRequested;catchUpRequested=false;if(again)void observe(true);else schedule();} }
    }
    composer.addEventListener('submit', event => void sendMessage(event));
    production.addEventListener('submit', event => void start(event));
    function sizeComposer(){input.style.height='auto';input.style.height=`${input.value?Math.min(96,Math.max(44,input.scrollHeight)):44}px`;}
    let composing=false;input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;});
    input.addEventListener('input', () => { draftDirty = true; sizeComposer();updateSendAdmission(); });
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composing && event.keyCode!==229) { event.preventDefault(); if (!send.disabled) composer.requestSubmit(); } });
    cap.addEventListener('input', () => { approval.checked = false; });
    function catchUp() { if (visible && !closed && document.visibilityState!=='hidden') {transcriptView.show();void observe(true);} render(); }
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){clearTimeout(timer);controller?.abort();}else catchUp();render();});
    window.addEventListener('online',()=>{disconnected=false;observationFailures=0;catchUp();});
    window.addEventListener('offline',()=>{disconnected=true;render();});
    window.addEventListener('pagehide', () => { closed = true; clearTimeout(timer); controller?.abort(); transcriptView.stop();footerObserver.disconnect(); });
    window.addEventListener('pageshow',()=>{closed=false;footerObserver.observe(footer);catchUp();});
    render();
    return {
        refresh: render,
        focus() { selectTab('chat');input.focus({preventScroll:true}); },
        appendProduction(...nodes){productionArea.append(...nodes);},
        appendDetails(...nodes) { advanced.append(...nodes); },
        setVisible(value) { const changed = visible !== value; visible = value; if (visible && changed) { observationIdentity=null;transcriptView.show();void observe(true); } else if (!visible) { clearTimeout(timer); controller?.abort(); }render(); },
        projectChanged(id) {
            if (id === projectId) return;
            epoch++; projectId = id; snapshot = null; availability = null; pending = null; busy = false; briefKey = '';immediateKey='';actionView.reset();finance.insertBefore(allowance,allowanceLedger); observationIdentity=null;observationStarted=0;observationCount=0;observationFailures=0;disconnected=false;transcriptView.reset();selectTab('chat'); draftDirty = false;
            controller?.abort(); clearTimeout(timer); input.value = ''; allowanceCap.value = ''; cap.value = ''; approval.checked = false; confirmation.hidden = true;
            try { const saved = JSON.parse(sessionStorage.getItem(storageKey()) || 'null'); if (saved && (['/messages','/allowance','/control','/start','/immediate','/immediate/approve','/immediate/control'].includes(saved.suffix)||/^\/actions\/[a-f0-9]{32}\/confirm$/.test(saved.suffix)) && saved.body && typeof saved.key === 'string' && typeof saved.fingerprint === 'string') pending = saved; } catch { /* The server remains authoritative. */ }
            notify(pending ? copy.unsent : copy.loading); render(); if (visible) void observe(true);
        },
    };
}
