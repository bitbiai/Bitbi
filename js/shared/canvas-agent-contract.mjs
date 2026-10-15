// Application admission, shared by the member UI and the server. No model
// prompt is responsible for obtaining duration or spending authorization.
export const CANVAS_AGENT_VERSION = 1;
export const CANVAS_AGENT_MODEL = 'xai/grok-4.7';
export const CANVAS_AGENT_LIMITS = Object.freeze({maxNodes:60,maxShots:48,maxActions:180,maxRounds:3,maxVariants:2,maxEvaluations:2,maxDuration:180,minDuration:3,toleranceSeconds:0.5,maxBudgetCredits:100000,concurrency:1});
export const CANVAS_AGENT_TERMINAL = new Set(['completed','cancelled','taken_over']);
const fail = code => { throw Object.assign(new Error(code), {code,status:400}); };
const words = {a:1,one:1,an:1,eine:1,einen:1,ein:1,zwei:2,two:2,drei:3,three:3,half:0.5,halb:0.5};
function briefDuration(text) {
    // Normalize German compound/adjectival units explicitly. Do not depend on
    // JavaScript's ASCII word boundary treating the umlaut in minütig as a break.
    text=text.replace(/\b(\d+(?:\.\d+)?|eine[nr]?|ein|zwei|drei|halb)[\s-]*(minütig|sekündig)(?:en|er|es|em|e)?\b/g,
        (_,amount,unit)=>`${amount} ${unit==='minütig'?'minuten':'sekunden'}`);
    const matches=[...text.matchAll(/\b(\d+(?:\.\d+)?|a|an|one|two|three|half|eine[nr]?|ein|zwei|drei|halb)[\s-]*(minutes?|mins?|minuten?|minute[nr]?|seconds?|secs?|sekunden?|sek)\b/g)];
    const groups=[];
    for(const match of matches) {
        const minute=/^min/.test(match[2]),previous=groups.at(-1),gap=previous&&text.slice(previous.end,match.index);
        const seconds=(words[match[1]]??Number(match[1]))*(minute?60:1);
        if(previous?.minute&&!minute&&/^\s*(?:(?:and|und)\s*)?$/.test(gap)) {previous.seconds+=seconds;previous.end=match.index+match[0].length;previous.minute=false;}
        else groups.push({start:match.index,end:match.index+match[0].length,seconds,minute});
    }
    const candidates=groups.filter(group=>{
        const before=text.slice(Math.max(0,group.start-60),group.start),after=text.slice(group.end,group.end+70);
        group.ambiguous=/\b(?:\d+(?:\.\d+)?|one|two|three|ein|eine|zwei|drei)\s*(?:or|oder|and|und|to|bis|[-–])\s*$/.test(before);
        group.target=/^\s*(?:[-–]?\s*(?:long|lang(?:en|er|es|em|e)?))?\s*(?:films?|movies?|videos?|kurzfilme?)\b/.test(after)
            ||/\b(?:film|movie|video|target duration|total duration|zieldauer|gesamtdauer)(?:\s+(?:of|is|should|be|last|lasting|von|ist|soll|dauern|beträgt)){0,4}\s*[:=]?\s*$/.test(before);
        const shotAfter=/^\s*(?:[-–]?\s*(?:long|lang(?:en|er|es|em|e)?))?\s*(?:(?:per|each|pro|je)\s+)?(?:shots?|clips?|scenes?|szenen?|einstellungen?)\b/.test(after);
        const shotBefore=/\b(?:shots?|clips?|scenes?|szenen?|einstellungen?)(?:\s+(?:of|lasting|last|each|every|je|von|mit|à|zu|dauert|dauern|alle)){0,4}\s*[:=]?\s*$/.test(before);
        const continuedShotList=!group.target&&/\b(?:shots?|clips?|scenes?|szenen?|einstellungen?)\b[^.;\n]*$/.test(before)&&!/\b(?:film|movie|video|zieldauer|gesamtdauer)\b[^.;\n]*$/.test(before);
        return !shotAfter&&!shotBefore&&!continuedShotList;
    });
    const targets=candidates.filter(group=>group.target),chosen=targets.length?targets:candidates;
    // Add only an adjacent minutes-and-seconds expression. Separate clip times,
    // alternatives and competing film targets cannot silently change the length.
    return chosen.length&&!chosen.some(group=>group.ambiguous)&&new Set(chosen.map(group=>group.seconds)).size===1?chosen[0].seconds:null;
}
export function resolveCanvasAgentDuration({brief='',targetDurationSeconds,durationChoice,durationAsked=false}={}) {
    if (targetDurationSeconds !== undefined && targetDurationSeconds !== null && targetDurationSeconds !== '') {
        const seconds=Number(targetDurationSeconds);
        if (!Number.isFinite(seconds)||seconds<CANVAS_AGENT_LIMITS.minDuration||seconds>CANVAS_AGENT_LIMITS.maxDuration) fail('canvas_agent_duration_invalid');
        return {targetDurationSeconds:Math.round(seconds*1000)/1000,durationChoice:'explicit'};
    }
    const text=String(brief).toLowerCase().replace(/,/g,'.');
    const seconds=briefDuration(text);
    if(seconds!==null)return resolveCanvasAgentDuration({targetDurationSeconds:seconds});
    if(durationChoice==='delegated'){
        if(!durationAsked)fail('canvas_agent_duration_clarification_required');
        return {targetDurationSeconds:60,durationChoice:'delegated'};
    }
    return null;
}
export function normalizeCanvasAgentStart(input,{durationAsked=false}={}) {
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['brief','targetDurationSeconds','durationChoice','budgetCredits','expectedRevision','locale'].includes(k)))fail('canvas_agent_input_invalid');
    const brief=String(input.brief||'').trim();
    if(!brief||brief.length>12000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(brief))fail('canvas_agent_brief_invalid');
    const duration=resolveCanvasAgentDuration({...input,brief,durationAsked});
    if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('canvas_agent_revision_required');
    if(!duration)return {brief,locale:input.locale==='de'?'de':'en',expectedRevision:input.expectedRevision,duration:null,budgetCredits:null};
    if(!Number.isSafeInteger(input.budgetCredits)||input.budgetCredits<1||input.budgetCredits>CANVAS_AGENT_LIMITS.maxBudgetCredits)fail('canvas_agent_budget_required');
    return {brief,locale:input.locale==='de'?'de':'en',expectedRevision:input.expectedRevision,duration,budgetCredits:input.budgetCredits};
}
