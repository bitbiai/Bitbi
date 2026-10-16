// Presentation of persisted production evidence. Generated text is always data.
const create=(tag,className='',text='')=>{const node=document.createElement(tag);node.className=className;node.textContent=text;return node;};
const number=value=>typeof value==='number'&&Number.isFinite(value);
const text=value=>typeof value==='string'?value.slice(0,12000):'';
const item=(list,label,value)=>list.append(create('dt','',label),create('dd','',String(value)));

export function createCanvasAgentActivity({parent,copy,privateMediaUrl,decideBudget}) {
    const action=create('p','canvas-agent__current'),cause=create('section','canvas-agent__cause');
    const causeTitle=create('h4'),causeText=create('p'),causeNext=create('p'),existing=create('p','canvas-muted');
    cause.append(causeTitle,causeText,causeNext,existing);
    const budget=create('section','canvas-agent__budget');budget.setAttribute('aria-label',copy.budgetDecision);
    const budgetTitle=create('h4','',copy.budgetDecision),budgetReason=create('p'),budgetAmounts=create('dl','canvas-agent__summary'),budgetAction=create('p'),budgetHint=create('p','canvas-muted',copy.budgetDecisionHint),buttons=create('div','canvas-agent__actions');
    const accept=create('button','canvas-button canvas-button--primary',copy.acceptBudget),decline=create('button','canvas-button',copy.declineBudget);
    accept.type=decline.type='button';buttons.append(accept,decline);budget.append(budgetTitle,budgetReason,budgetAction,budgetAmounts,budgetHint,buttons);
    let snapshot=null;
    accept.addEventListener('click',()=>{if(snapshot&&!accept.disabled)decideBudget('accept',structuredClone(snapshot));});
    decline.addEventListener('click',()=>{if(snapshot&&!decline.disabled)decideBudget('decline',structuredClone(snapshot));});
    const plan=create('section','canvas-agent__plan');plan.setAttribute('aria-label',copy.storyboard);
    const planTitle=create('h4','',copy.storyboard),planStatus=create('p','canvas-muted'),planSummary=create('p'),shots=create('ol'),planNotes=create('ul');
    plan.append(planTitle,planStatus,planSummary,shots,planNotes);
    const partial=create('section','canvas-agent__partial');partial.setAttribute('aria-label',copy.partialOutputs);partial.append(create('h4','',copy.partialOutputs));
    const partialCards=create('div','canvas-agent__partial-cards');partial.append(partialCards);
    const activity=create('section','canvas-agent__activity');activity.setAttribute('aria-label',copy.activity);
    const summaryStatus=create('p','canvas-muted'),events=create('ol','canvas-agent__events');events.tabIndex=0;events.setAttribute('role','log');events.setAttribute('aria-live','polite');events.setAttribute('aria-relevant','additions');events.setAttribute('aria-label',copy.activity);
    activity.append(create('h4','',copy.activity),summaryStatus,events);parent.append(action,cause,budget,plan,partial,activity);
    const seen=new Set(),outputs=new Map();let planKey='';
    function addOutput(output) {
        if(!output||!['image','video','audio','text'].includes(output.type))return;
        const url=privateMediaUrl(output.fileUrl),identity=output.assetId||output.id||output.nodeId||url;
        const key=identity?JSON.stringify([identity,url,output.version||null,output.type==='text'?text(output.text):null]):'';
        if(!key||outputs.has(key)||outputs.size>=60)return;
        if(output.type!=='text'&&!url)return;
        const figure=create('figure','canvas-agent__partial-card');figure.append(create('figcaption','',text(output.title)||copy.partialOutput));
        if(output.type==='text')figure.append(create('p','',text(output.text)));
        else {
            const media=create(output.type==='image'?'img':output.type);media.src=url;
            if(output.type==='image'){media.alt=text(output.title)||copy.partialOutput;media.loading='lazy';media.decoding='async';}
            else {media.controls=true;media.preload='none';media.setAttribute('aria-label',text(output.title)||copy.partialOutput);if(output.type==='video'){const poster=privateMediaUrl(output.previewUrl);if(poster)media.poster=poster;}}
            figure.append(media);
        }
        outputs.set(key,figure);partialCards.append(figure);partial.hidden=false;
    }
    function appendEvents(values) {
        for(const event of Array.isArray(values)?values:[]) {
            const seq=event?.seq??event?.id;
            if(!Number.isSafeInteger(seq)||seq<1||seen.has(seq)||!['action','decision_summary','provider_summary','media','error'].includes(event.type))continue;
            if(event.type==='provider_summary'&&(event.source!=='provider'||event.delivery!=='completed'))continue;
            seen.add(seq);
            const row=create('li');row.dataset.eventId=String(seq);
            const label=event.type==='provider_summary'?copy.providerSummary:event.type==='decision_summary'?copy.assistantExplanation:event.type==='error'?copy.eventIssue:copy.toolEvent;
            row.append(create('strong','',label));
            const who=[text(event.model),text(event.tool)].filter(Boolean).join(' · ');if(who)row.append(create('span','canvas-muted',who));
            if(text(event.text))row.append(create('p','',text(event.text)));
            const at=new Date(event.at||event.createdAt);if(Number.isFinite(at.getTime())){const time=create('time','canvas-muted',at.toLocaleTimeString(document.documentElement.lang,{hour:'2-digit',minute:'2-digit',second:'2-digit'}));time.dateTime=at.toISOString();row.append(time);}
            const later=[...events.children].find(node=>Number(node.dataset.eventId)>seq);events.insertBefore(row,later||null);addOutput(event.media);
        }
    }
    function render(run,{busy=false,decisionPending=false}={}) {
        action.hidden=!run?.currentAction;
        const current=run?.currentAction;
        action.textContent=current?[copy.phases[current.phase]||copy.currentAction,...[current.summary||current.text,current.model,current.tool].map(text).filter(Boolean)].join(' · '):'';
        cause.hidden=!run?.cause;
        const issue=run?.cause;
        causeTitle.textContent=issue?copy.cause:'';causeText.textContent=issue?text(issue.summary)||copy.causes[issue.code]||`${copy.eventIssue}: ${text(issue.code)}`:'';
        if(issue?.step)causeText.textContent+=` (${text(issue.step)})`;
        const stopped=['completed','cancelled','taken_over','manual_takeover'].includes(run?.status)||(run?.status==='paused'&&issue?.recovery==='automatic');
        causeNext.textContent=issue?copy.recovery[stopped?'manual':issue.recovery]||'':'';existing.textContent=text(issue?.existingWorkSummary)||(issue&&(run?.proposedPlan||run?.partialOutputs?.length)?copy.existingWork:'');
        const request=run?.budgetRequest;
        const valid=request?.status==='pending'&&typeof request.id==='string'&&[request.revision,request.projectRevision,request.tariffRevision].every(value=>Number.isSafeInteger(value)&&value>=0)
            &&[request.currentCapCredits,request.additionalCredits,request.proposedCapCredits].every(value=>Number.isSafeInteger(value)&&value>=0)
            &&request.additionalCredits>0&&request.currentCapCredits+request.additionalCredits===request.proposedCapCredits;
        snapshot=valid?structuredClone(request):null;budget.hidden=!request||request.status!=='pending';
        budgetReason.textContent=text(request?.reason)||copy.causes[request?.reasonCode]||copy.budgetReason;
        budgetAction.textContent=[text(request?.action),text(request?.model)].filter(Boolean).join(' · ');
        budgetAmounts.replaceChildren();
        if(valid){item(budgetAmounts,copy.currentCap,request.currentCapCredits);item(budgetAmounts,copy.additionalCap,request.additionalCredits);item(budgetAmounts,copy.newCap,request.proposedCapCredits);}
        budgetHint.textContent=valid?decisionPending?copy.budgetDecisionPending:copy.budgetDecisionHint:copy.budgetDecisionInvalid;
        accept.disabled=decline.disabled=busy||decisionPending||!valid||['completed','cancelled','taken_over','manual_takeover'].includes(run?.status);
        const proposed=run?.proposedPlan,key=JSON.stringify(proposed||null);plan.hidden=!proposed;
        if(key!==planKey){
            planKey=key;shots.replaceChildren();planNotes.replaceChildren();
            planTitle.textContent=proposed?.title?`${copy.storyboard}: ${text(proposed.title)}`:copy.storyboard;
            planStatus.textContent=proposed?copy.planStates[proposed.status]||copy.planStates.proposed:'';
            planSummary.textContent=text(proposed?.summary);
            for(const shot of (Array.isArray(proposed?.shots)?proposed.shots:[]).slice(0,60)){
                const row=create('li');row.append(create('strong','',text(shot.title)||copy.shot),create('p','',text(shot.description)));
                const settings=[text(shot.model),number(shot.durationSeconds)?`${shot.durationSeconds} s`:null].filter(Boolean);if(settings.length)row.append(create('p','canvas-muted',settings.join(' · ')));shots.append(row);
            }
            for(const value of [proposed?.audioTreatment,proposed?.continuity,...(Array.isArray(proposed?.validation?.repairs)?proposed.validation.repairs:Array.isArray(proposed?.repairs)?proposed.repairs:[]),...(Array.isArray(proposed?.validation?.issues)?proposed.validation.issues:Array.isArray(proposed?.issues)?proposed.issues:[])]){
                const description=typeof value==='string'?text(value):text(value?.summary||value?.message||value?.code);if(description)planNotes.append(create('li','',description));
            }
        }
        for(const output of Array.isArray(run?.partialOutputs)?run.partialOutputs:[])addOutput(output);
        partial.hidden=outputs.size===0;
        summaryStatus.textContent=run?.reasoningSummaryDelivery==='completion_only'||run?.summarySupport?.mode==='completed'?copy.summariesCompletionOnly:run?.summarySupport?.status==='unavailable'?copy.summariesUnavailable:copy.summariesHonest;
        activity.hidden=!run;plan.hidden=!proposed;
    }
    return {render,appendEvents,reset(){seen.clear();outputs.clear();events.replaceChildren();partialCards.replaceChildren();planKey='';snapshot=null;render(null);}};
}
