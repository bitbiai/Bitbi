// Convenience recognition only. The authenticated server resolves the current
// decision, revisions and tariff before any phrase may authorize expenditure.
const deSmall=['null','eins','zwei','drei','vier','fünf','sechs','sieben','acht','neun','zehn','elf','zwölf','dreizehn','vierzehn','fünfzehn','sechzehn','siebzehn','achtzehn','neunzehn'];
const deTens=['zwanzig','dreißig','vierzig','fünfzig','sechzig','siebzig','achtzig','neunzig'];
const enSmall=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const enTens=['twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
function spokenHundreds(value,locale){
  if(locale==='de'){
    if(value==='ein'||value==='eine')return 1;
    if(deSmall.includes(value))return deSmall.indexOf(value);
    if(deTens.includes(value))return 20+10*deTens.indexOf(value);
    const tens=value.match(/^(.+)und(.+)$/u);
    if(tens&&deTens.includes(tens[2])){const n=spokenHundreds(tens[1],'de');if(n>0&&n<10)return n+20+10*deTens.indexOf(tens[2]);}
    const hundreds=value.match(/^(.*?)hundert(.*)$/u);
    if(hundreds){const n=hundreds[1]?spokenHundreds(hundreds[1],'de'):1,r=hundreds[2]?spokenHundreds(hundreds[2],'de'):0;if(n>0&&n<10&&Number.isInteger(r)&&r>=0&&r<100)return n*100+r;}
  }else{
    if(enSmall.includes(value))return enSmall.indexOf(value);
    if(enTens.includes(value))return 20+10*enTens.indexOf(value);
    const tens=value.match(/^(\w+) (\w+)$/u);
    if(tens&&enTens.includes(tens[1])){const n=enSmall.indexOf(tens[2]);if(n>0&&n<10)return 20+10*enTens.indexOf(tens[1])+n;}
    const hundreds=value.match(/^(\w+) hundred(?: (?:and )?(.+))?$/u);
    if(hundreds){const n=enSmall.indexOf(hundreds[1]),r=hundreds[2]?spokenHundreds(hundreds[2],'en'):0;if(n>0&&n<10&&Number.isInteger(r)&&r>=0&&r<100)return n*100+r;}
  }
  return null;
}
function spokenCredits(value,locale){
  if(!/^[a-zäöüß -]+$/u.test(value))return null;
  const word=locale==='de'?value.replace(/[ -]/g,''):value.replace(/-/g,' ').replace(/\s+/g,' ').trim();
  const delimiter=locale==='de'?'tausend':' thousand';
  if(!word.includes(delimiter))return spokenHundreds(word,locale);
  const parts=word.split(delimiter);if(parts.length!==2)return null;
  const n=parts[0]?spokenHundreds(parts[0],locale):locale==='de'?1:null;
  const rest=locale==='de'?parts[1]:parts[1].replace(/^ (?:and )?/u,'');
  const r=rest?spokenHundreds(rest,locale):0;
  return n>0&&n<=100&&Number.isInteger(r)&&r>=0&&r<1000?n*1000+r:null;
}
export function canvasConversationDecisionIntent(text,{locale='en',budgetAsked=false}={}) {
  if(typeof text!=='string'||text.length>240)return null;
  const value=text.normalize('NFKC').trim().toLowerCase().replace(/[.!]+$/u,'').trim();
  if(/["“”«»‘’`\n\r]/u.test(value))return null;
  if(/^(?:ja(?:,?\s+(?:starte(?:\s+jetzt)?|bitte(?:\s+starten)?|leg\s+los))?|(?:okay|ok),?\s+leg\s+los|yes(?:,?\s+(?:start(?:\s+now)?|please(?:\s+start)?))?|(?:okay|ok),?\s+(?:go\s+ahead|start))$/u.test(value))return {kind:'accept'};
  if(/^(?:nein(?:,?\s+(?:nicht\s+starten|noch\s+nicht(?:\s+starten)?))?|no(?:,?\s+(?:do\s+not\s+start(?:\s+yet)?|not\s+yet))?)$/u.test(value))return {kind:'decline'};
  let start=false,amount=value,allowance=false;
  const conversation=amount.match(/^(?:(?:mein\s+)?gesprächsbudget(?:\s+(?:ist|beträgt))?\s*:?\s*|(?:my\s+)?(?:briefing|conversation)\s+(?:budget|allowance)(?:\s+is)?\s*:?\s*)(.+)$/u);
  if(conversation){allowance=true;amount=conversation[1];}
  const explicit=amount.match(/^(?:(?:bitte\s+)?starte(?:\s+(?:den\s+film|die\s+produktion))?(?:\s+jetzt)?\s+mit\s+maximal\s+|(?:please\s+)?start(?:\s+(?:the\s+film|production))?(?:\s+now)?\s+with\s+(?:at\s+most|a\s+maximum\s+of)\s+)(.+)$/u);
  if(explicit){start=true;amount=explicit[1];}
  else amount=amount.replace(/^(?:(?:mein\s+)?(?:projektbudget|projektlimit|budget)(?:\s+(?:ist|beträgt))?\s*:?\s*|(?:maximal|höchstens)\s+|(?:my\s+)?(?:project\s+(?:budget|limit|cap)|budget)(?:\s+is)?\s*:?\s*|(?:at\s+most|up\s+to|maximum(?:\s+of)?)\s+)/u,'');
  const credits=/\s*credits?$/u.test(amount);
  if(credits)amount=amount.replace(/\s*credits?$/u,'');
  if(!credits&&!budgetAsked)return null;
  const group=locale==='de'?'[.]':',';
  const numeric=new RegExp(`^(?:[1-9]\\d{0,5}|[1-9]\\d{0,2}(?:${group}\\d{3})+|[1-9]\\d{0,2}(?: \\d{3})+)$`,'u').test(amount);
  const capCredits=numeric?Number(amount.replace(/[., ]/g,'')):(spokenCredits(amount,locale)??spokenCredits(amount,locale==='de'?'en':'de'));
  if(capCredits===null)return null;
  if(!Number.isSafeInteger(capCredits)||capCredits<1||capCredits>100000)return {kind:'invalid_cap'};
  return allowance?{kind:'allowance_cap',capCredits}:{kind:'cap',capCredits,explicitStart:start};
}
export function canvasConversationBudgetClarification(text){
  if(typeof text!=='string'||text.length>240||/["“”«»‘’`\n\r]/u.test(text))return false;
  if(!/(?:credits?|budget|allowance|limit|cap|euros?|dollars?|€|\$)/iu.test(text)
    ||/(?:\b(?:film|video|story|geschichte|sagt|says|hypothetical|hypothetisch|if|wenn)\b)/iu.test(text))return false;
  // Clarify an unparseable monetary reply, not every conversation mentioning
  // money. Ordinary requests to explain, propose or decline an existing limit
  // still use the signed dialogue/action path and its explicit consent guards.
  return /^(?:(?:(?:mein\s+)?(?:projektbudget|projektlimit|gesprächsbudget|budget|limit)|(?:my\s+)?(?:(?:project|briefing|conversation)\s+)?(?:budget|allowance|limit|cap))(?:\s+(?:ist|beträgt|is))?\s*:?\s*)?(?:(?:noch|zusätzlich|weitere|vielleicht|maximal|höchstens|additional|another|maybe|up\s+to|at\s+most)\s+)?[€$]?\s*\d/iu.test(text.normalize('NFKC').trim());
}
