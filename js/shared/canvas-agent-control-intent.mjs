// Emergency/local controls are a convenience before inference, not the natural
// language action engine. Ambiguous instructions continue through strict proposals.
export function detectCanvasDirectControl(text) {
  const value=String(text||'').normalize('NFKC').trim().toLowerCase().replace(/[.!?]+$/u,'').trim();
  if(value.length>160)return null;
  if(/^(?:bitte\s+)?(?:mach(?:e)?\s+mit\s+dem\s+gespeicherten\s+(?:stand|entwurf)\s+weiter|setze\s+(?:das\s+)?(?:briefing|gespräch)\s+fort|(?:gespräch|briefing)\s+fortsetzen)(?:\s+bitte)?$/u.test(value)
    ||/^(?:please\s+)?(?:continue|resume)\s+(?:(?:the|my)\s+)?(?:saved\s+(?:draft|conversation)|briefing|conversation)(?:\s+please)?$/u.test(value))return 'brief_resume';
  if(/^(?:bitte\s+)?(?:speichere?\s+(?:den\s+)?(?:entwurf|gesprächsstand)|(?:entwurf|gespräch)\s+speichern)(?:[,;:]?\s+ich\s+mache\s+später\s+weiter)?$/u.test(value)
    ||/^(?:please\s+)?save\s+(?:(?:the|my)\s+)?(?:draft|briefing|conversation)(?:\s+for\s+later)?$/u.test(value))return 'brief_save';
  if(/^(?:bitte\s+)?(?:beende?\s+(?:das\s+)?(?:briefing|gespräch)|(?:briefing|gespräch)\s+(?:beenden|abbrechen))$/u.test(value)
    ||/^(?:please\s+)?(?:end|cancel|stop)\s+(?:the\s+)?(?:briefing|conversation)$/u.test(value))return 'brief_cancel';
  if(/^(?:bitte\s+)?(?:pause|pausiere|pausier|stoppe|stopp|stop|halt)(?:\s+(?:bitte|jetzt|please|now))?(?:\s+(?:die\s+)?(?:produktion|production|film|video))?(?:\s+(?:bitte|jetzt|please|now))?$/u.test(value)
    ||/^(?:please\s+)?(?:pause|stop|halt)\s+(?:the\s+)?(?:production|film|video)(?:\s+(?:please|now))?$/u.test(value))return 'production_pause';
  if(/^(?:bitte\s+)?(?:produktion\s+abbrechen|brich\s+(?:die\s+)?produktion\s+ab|cancel\s+(?:the\s+)?production)(?:\s+(?:bitte|jetzt|please|now))?$/u.test(value))return 'production_cancel';
  if(/^(?:wie\s+(?:weit|läuft)\s+(?:ist\s+)?(?:die\s+)?produktion|wie\s+weit\s+bist\s+du|produktionsstatus|production\s+status|how\s+(?:far\s+along\s+are\s+you|is\s+(?:the\s+)?production))(?:\s+(?:jetzt|now))?$/u.test(value))return 'status';
  if(/^(?:bitte\s+)?(?:produktion\s+fortsetzen|setze\s+(?:die\s+)?produktion\s+fort|mach\s+mit\s+der\s+produktion\s+weiter|resume\s+(?:the\s+)?production|continue\s+(?:the\s+)?production)(?:\s+(?:bitte|jetzt|please|now))?$/u.test(value))return 'production_resume';
  if(/^(?:ich\s+übernehme(?:\s+manuell)?|manuell\s+übernehmen|take\s+over(?:\s+manually)?|manual\s+takeover)$/u.test(value))return 'production_takeover';
  if(/^(?:status|wie\s+ist\s+der\s+stand|was\s+ist\s+der\s+stand|how\s+is\s+it\s+going|what(?:'s|\s+is)\s+the\s+status)$/u.test(value))return 'status';
  return null;
}
export function canvasImmediateStartRequested(text) {
  const value=String(text||'').normalize('NFKC').toLowerCase();
  if(value.length>6000||/["“”«»]|(?:^|\s)(?:system|assistant|developer)\s*:/u.test(value)||/\b(?:nicht|not|never|don't|kein(?:en)?\s+film)\b/u.test(value))return false;
  return /^(?:(?:bitte|keine weiteren fragen[,;:]?|ohne weitere fragen[,;:]?)\s+)*(?:mach|mache|erstell|erstelle|produzier|produziere|starte)\b[\s\S]{0,70}\b(?:film|video|produktion)\b[\s\S]{0,30}\b(?:jetzt|sofort)\b/u.test(value)
    ||/^(?:(?:please|no more questions[,;:]?|can you|could you)\s+)*(?:start|make|create|produce)\b[\s\S]{0,70}\b(?:film|video|production)\b[\s\S]{0,30}\bnow\b/u.test(value);
}
