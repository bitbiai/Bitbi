// Convenience recognition only. The authenticated server resolves the current
// decision, revisions and tariff before any phrase may authorize expenditure.
export function canvasConversationDecisionIntent(text,{locale='en',budgetAsked=false}={}) {
  if(typeof text!=='string'||text.length>240)return null;
  const value=text.normalize('NFKC').trim().toLowerCase().replace(/[.!]+$/u,'').trim();
  if(/["“”«»‘’`\n\r]/u.test(value))return null;
  if(/^(?:ja(?:,?\s+(?:starte(?:\s+jetzt)?|bitte(?:\s+starten)?|leg\s+los))?|(?:okay|ok),?\s+leg\s+los|yes(?:,?\s+(?:start(?:\s+now)?|please(?:\s+start)?))?|(?:okay|ok),?\s+(?:go\s+ahead|start))$/u.test(value))return {kind:'accept'};
  if(/^(?:nein(?:,?\s+(?:nicht\s+starten|noch\s+nicht))?|no(?:,?\s+(?:do\s+not\s+start|not\s+yet))?)$/u.test(value))return {kind:'decline'};
  let start=false,amount=value,allowance=false;
  const conversation=amount.match(/^(?:(?:mein\s+)?gesprächsbudget(?:\s+(?:ist|beträgt))?\s*:?\s*|(?:my\s+)?(?:briefing|conversation)\s+(?:budget|allowance)(?:\s+is)?\s*:?\s*)(.+)$/u);
  if(conversation){allowance=true;amount=conversation[1];}
  const explicit=amount.match(/^(?:(?:bitte\s+)?starte(?:\s+(?:den\s+film|die\s+produktion))?(?:\s+jetzt)?\s+mit\s+maximal\s+|(?:please\s+)?start(?:\s+(?:the\s+film|production))?(?:\s+now)?\s+with\s+(?:at\s+most|a\s+maximum\s+of)\s+)(.+)$/u);
  if(explicit){start=true;amount=explicit[1];}
  else amount=amount.replace(/^(?:(?:mein\s+)?(?:projekt)?budget(?:\s+(?:ist|beträgt))?\s*:?\s*|(?:maximal|höchstens)\s+|(?:my\s+)?(?:project\s+)?budget(?:\s+is)?\s*:?\s*|(?:at\s+most|up\s+to)\s+)/u,'');
  const credits=/\s*credits?$/u.test(amount);
  if(credits)amount=amount.replace(/\s*credits?$/u,'');
  if(!credits&&!budgetAsked)return null;
  const group=locale==='de'?'[.]':',';
  if(!new RegExp(`^(?:[1-9]\\d{0,5}|[1-9]\\d{0,2}(?:${group}\\d{3})+|[1-9]\\d{0,2}(?: \\d{3})+)$`,'u').test(amount))return null;
  const capCredits=Number(amount.replace(/[., ]/g,''));
  if(!Number.isSafeInteger(capCredits)||capCredits<1||capCredits>100000)return {kind:'invalid_cap'};
  return allowance?{kind:'allowance_cap',capCredits}:{kind:'cap',capCredits,explicitStart:start};
}
export function canvasConversationBudgetClarification(text){
  if(typeof text!=='string'||text.length>240||/["“”«»‘’`\n\r]/u.test(text))return false;
  if(!/(?:credits?|budget|allowance|euros?|dollars?|€|\$)/iu.test(text)
    ||/(?:\b(?:film|video|story|geschichte|sagt|says|hypothetical|hypothetisch|if|wenn)\b)/iu.test(text))return false;
  // Clarify an unparseable monetary reply, not every conversation mentioning
  // money. Ordinary requests to explain, propose or decline an existing limit
  // still use the signed dialogue/action path and its explicit consent guards.
  return /^(?:(?:(?:mein\s+)?(?:projektbudget|gesprächsbudget|budget)|(?:my\s+)?(?:(?:project|briefing|conversation)\s+)?(?:budget|allowance))(?:\s+(?:ist|beträgt|is))?\s*:?\s*)?(?:(?:noch|zusätzlich|weitere|vielleicht|maximal|höchstens|additional|another|maybe|up\s+to|at\s+most)\s+)?[€$]?\s*\d/iu.test(text.normalize('NFKC').trim());
}
