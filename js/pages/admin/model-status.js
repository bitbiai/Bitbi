import { apiAdminModelStatus } from '../../shared/auth-api.js?v=__ASSET_VERSION__';

const COPY = {
 en: { description:'Observed outcomes, execution paths and processing — without test generations.', title:'Model status', refresh:'Refresh', updated:'Observed', search:'Find a model or provider', all:'All types', any:'All states', successful:'Recently successful', degraded:'Limited', unavailable:'Unavailable', unknown:'No current data', disabled:'Disabled', source_stale:'Stored observations are stale; a source could not be read.', loading:'Loading observations…', empty:'No models match these filters.', stale:'Status is not current. Refresh to load observations; models are not tested.', denied:'Admin access or MFA could not be confirmed. Reload the admin area to sign in again.', partial:'Some sources could not be read. Their missing evidence is not an outage.', scope:'Available in', member:'Members', admin:'Admin', chat:'Admin chat', config:'Registry release', enabled:'Listed', runtime:'Runtime switches and account permission are not implied by registry membership.', last:'Last confirmed completion', none:'Not recorded', details:'Evidence & execution', processing:'BITBI processing', active:'In progress', stored:'Retained assets', previewFailed:'Preview retry exhausted', coverFailed:'Cover failed', previewPending:'Video previews pending', coverPending:'Cover not complete', failed:'Failed jobs', unknownJobs:'Outcome unclear', sample:'Bounded sample from the last 24 hours; not total traffic. Up to 100 attempts per state. Old successes expire.', attribution:'Attempts without a current model identity', coverage:'Coverage limits', limits:'Chat turn history, organization-metered Admin image attempts, independent Gateway logs, and Admin media-to-storage correlation are not connected. Unknown failure causes and cache coverage remain unknown. No inference or retries are triggered here.', provider:'Official Cloudflare component notices', providerLimit:'Supplementary service notices, not proof of a specific model or account. Other provider feeds are not connected.', vendor:'Manufacturer', execution:'Execution label', pending:'Pending', completed:'Confirmed completions', technical:'Technical failures', other:'Input/account/unknown errors', cache:'Provider-cache evidence', operation:'Path', not_observed:'Not observed', storage_finalizing:'Storage being finalized', storedState:'Stored', preview_pending:'Stored; preview pending', processing_problem:'Processing problem', result_received:'Provider result received', unconfirmed:'Not confirmed', configuration_disabled:'Not released in the current registry.', no_recent_evidence:'No fresh, attributable completion.', repeated_technical_failures:'Repeated technical failures on the path below; cause may require investigation.', recent_completed_result:'A recorded completion is available. See the path and storage scope below.', asset_retained_preview_pending:'The asset is retained; preview completion is still pending.', unclassified_or_input_account_problem:'Errors exist, but do not establish a model outage.', source:'Source', operational:'No incident reported', degraded_performance:'Degraded performance', partial_outage:'Partial outage', major_outage:'Major outage', under_maintenance:'Maintenance', not_recorded:'Not recorded', hit:'Cache hit; not a fresh provider check' },
 de: { description:'Beobachtete Ergebnisse, Ausführungswege und Verarbeitung – ohne Testgenerierungen.', title:'Modellstatus', refresh:'Aktualisieren', updated:'Beobachtet', search:'Modell oder Anbieter suchen', all:'Alle Medientypen', any:'Alle Zustände', successful:'Zuletzt erfolgreich', degraded:'Eingeschränkt', unavailable:'Nicht verfügbar', unknown:'Keine aktuellen Daten', disabled:'Deaktiviert', source_stale:'Gespeicherte Beobachtungen sind veraltet; eine Quelle ist nicht erreichbar.', loading:'Beobachtungen werden geladen…', empty:'Keine Modelle für diese Filter.', stale:'Status nicht aktuell. Aktualisieren lädt Beobachtungen; Modelle werden nicht getestet.', denied:'Adminzugang oder MFA konnten nicht bestätigt werden. Adminbereich zur erneuten Anmeldung neu laden.', partial:'Einige Quellen konnten nicht gelesen werden. Fehlende Nachweise bedeuten keinen Ausfall.', scope:'Verfügbar für', member:'Mitglieder', admin:'Admin', chat:'Admin-Chat', config:'Registry-Freigabe', enabled:'Aufgeführt', runtime:'Registry-Zugehörigkeit bestätigt weder Laufzeitschalter noch Kontoberechtigung.', last:'Letzter bestätigter Abschluss', none:'Nicht erfasst', details:'Nachweise und Ausführung', processing:'BITBI-Verarbeitung', active:'In Bearbeitung', stored:'Erhaltene Assets', previewFailed:'Vorschauwiederholung erschöpft', coverFailed:'Cover fehlgeschlagen', previewPending:'Videovorschau ausstehend', coverPending:'Cover nicht abgeschlossen', failed:'Fehlgeschlagene Aufträge', unknownJobs:'Ausgang ungeklärt', sample:'Begrenzte Stichprobe der letzten 24 Stunden, kein Gesamtverkehr. Bis zu 100 Aufträge je Zustand. Alte Erfolge verfallen.', attribution:'Aufträge ohne aktuelle Modellzuordnung', coverage:'Grenzen der Datenbasis', limits:'Chatverlauf, organisationsbezogene Admin-Bildaufrufe, unabhängige Gateway-Logs und die Speicherzuordnung von Admin-Medien sind nicht angebunden. Ungeklärte Fehlerursachen und Cache-Abdeckung bleiben unbekannt. Hier werden weder Inferenz noch Wiederholungen ausgelöst.', provider:'Offizielle Cloudflare-Komponentenmeldungen', providerLimit:'Ergänzende Dienstmeldungen, kein Nachweis für ein bestimmtes Modell oder Konto. Weitere Anbieterfeeds sind nicht angebunden.', vendor:'Hersteller', execution:'Ausführungszuordnung', pending:'Ausstehend', completed:'Bestätigte Abschlüsse', technical:'Technische Fehler', other:'Eingabe-/Konto-/ungeklärte Fehler', cache:'Anbieter-Cache-Nachweis', operation:'Ausführungsweg', not_observed:'Nicht beobachtet', storage_finalizing:'Speicherung wird abgeschlossen', storedState:'Gespeichert', preview_pending:'Gespeichert; Vorschau ausstehend', processing_problem:'Verarbeitungsproblem', result_received:'Anbieterergebnis empfangen', unconfirmed:'Nicht bestätigt', configuration_disabled:'In der aktuellen Registry nicht freigeschaltet.', no_recent_evidence:'Kein frischer, zuordenbarer Abschluss.', repeated_technical_failures:'Wiederholte technische Fehler im unten genannten Weg; Ursache gegebenenfalls noch zu klären.', recent_completed_result:'Ein Abschluss ist dokumentiert. Ausführungsweg und Speicherbezug stehen in den Details.', asset_retained_preview_pending:'Das Asset ist erhalten; die Vorschau ist noch ausstehend.', unclassified_or_input_account_problem:'Fehler liegen vor, belegen aber keinen Modellausfall.', source:'Quelle', operational:'Kein Vorfall gemeldet', degraded_performance:'Eingeschränkte Leistung', partial_outage:'Teilausfall', major_outage:'Ausfall', under_maintenance:'Wartung', not_recorded:'Nicht erfasst', hit:'Cachetreffer; keine neue Anbieterprüfung' },
};
const SYMBOL={successful:'✓',degraded:'!',unavailable:'×',unknown:'○',disabled:'−'};
const TYPES={en:{image:'Image',video:'Video',music:'Music',text:'Text',chat:'Chat',embeddings:'Embeddings'},de:{image:'Bild',video:'Video',music:'Musik',text:'Text',chat:'Chat',embeddings:'Embeddings'}};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
export function createAdminModelStatus() {
 const root=document.getElementById('sectionModelStatus');
 let locale='en', data=null, controller=null, life=null, expiry=null, busy=false, stale=false;
 let search='', type='', state='';
 const t=key=>COPY[locale][key]||key;
 const shownState=m=>m.state==='disabled'?'disabled':stale?'unknown':m.state;
 const date=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString(locale==='de'?'de-DE':'en-GB'):t('none');
 function dispose(){controller?.abort();life?.abort();clearTimeout(expiry);data=null;busy=false;root.replaceChildren();}
 function badge(value){return el('span',`model-status__badge is-${value}`,`${SYMBOL[value]||'○'} ${t(value)}`);}
 function field(dl,label,value){dl.append(el('dt','',label),el('dd','',value));}
 function renderRows(list,summary) {
  const models=data?.models||[];
  summary.replaceChildren(...['successful','degraded','unavailable','unknown'].map(key=>{const box=el('div','model-status__count');box.append(el('strong','',models.filter(m=>shownState(m)===key).length),el('span','',t(key)));return box;}));
  const rows=models.filter(m=>(!search||`${m.label} ${m.vendor} ${m.id}`.toLowerCase().includes(search.toLowerCase()))&&(!type||m.mediaTypes.includes(type))&&(!state||shownState(m)===state));
  list.replaceChildren();
  if(!rows.length)list.append(el('p','model-status__muted',t('empty')));
  for(const model of rows){
   const details=el('details','model-status__model');details.dataset.modelId=model.id;
   const head=el('summary','model-status__row');const identity=el('div','model-status__identity');
   identity.append(el('strong','',model.label),el('span','model-status__muted',`${model.mediaTypes.map(m=>TYPES[locale][m]||m).join(' · ')} · ${model.vendor} · ${model.execution==='Not verified'?t('none'):model.execution}`));
   const evidence=el('div','model-status__evidence');evidence.append(badge(shownState(model)),el('span','model-status__muted',`${t('last')}: ${date(model.lastSuccess)}`));
   head.append(identity,evidence,el('span','model-status__reason',stale?t('stale'):t(model.reason)));details.append(head);
   const body=el('div','model-status__detail');const info=el('dl','model-status__metadata');
   field(info,'ID',model.id);field(info,t('execution'),model.execution);field(info,t('scope'),model.scopes.map(t).join(', '));
   field(info,t('config'),model.configuration.map(c=>`${t(c.scope)}: ${c.enabled?t('enabled'):t('disabled')}`).join(' · '));body.append(info,el('p','model-status__muted',t('runtime')));
   for(const path of model.paths){const p=el('div','model-status__path');p.append(el('h4','',`${t('operation')}: ${path.source} · ${path.operation}`),badge(stale?'unknown':path.state));
    const dl=el('dl','model-status__metadata');field(dl,t('last'),date(path.lastSuccess));field(dl,t('source'),path.source==='member'?'member_ai_usage_attempts_v2 + member_generation_jobs':'admin_ai_usage_attempts_v2');
    field(dl,t('execution'),t(path.execution));field(dl,t('completed'),path.completed);field(dl,t('technical'),path.technicalFailures);field(dl,t('other'),path.otherFailures);field(dl,t('pending'),path.pending);field(dl,t('cache'),t(path.cache));field(dl,t('processing'),`${t(path.providerOutcome)} · ${t(path.assetOutcome==='stored'?'storedState':path.assetOutcome)}`);p.append(dl);body.append(p);
   }
   details.append(body);list.append(details);
  }
 }
 function render(){
  life?.abort();life=new AbortController();root.replaceChildren();
  document.getElementById('adminHeroTitle').textContent=t('title');document.getElementById('adminHeroDesc').textContent=t('description');
  document.querySelector('[data-section="model-status"]').textContent=t('title');root.lang=locale;root.setAttribute('aria-label',t('title'));
  const listen=(n,event,fn)=>n.addEventListener(event,fn,{signal:life.signal});
  const header=el('div','model-status__header'),titles=el('div');titles.append(el('p','model-status__muted',`${t('updated')}: ${date(data?.evidenceObservedAt||data?.observedAt)}`));
  const tools=el('div','model-status__tools');
  for(const language of ['en','de']){const b=el('button','btn-action',language.toUpperCase());b.type='button';b.dataset.language=language;b.setAttribute('aria-pressed',String(locale===language));listen(b,'click',()=>{locale=language;render();root.querySelector(`[data-language="${language}"]`)?.focus();});tools.append(b);}
  const refresh=el('button','btn-action',t('refresh'));refresh.type='button';refresh.dataset.action='refresh';refresh.disabled=busy;listen(refresh,'click',loadData);tools.append(refresh);header.append(titles,tools);root.append(header);
  const notice=el('p','model-status__notice',busy?t('loading'):stale?t('stale'):data?.sources.some(s=>!s.available)?t('partial'):'');notice.setAttribute('role','status');if(!notice.textContent)notice.hidden=true;root.append(notice);
  if(!data)return;
  const summary=el('div','model-status__summary'),filters=el('div','model-status__filters'),list=el('div','model-status__list');
  const input=el('input');input.type='search';input.placeholder=t('search');input.setAttribute('aria-label',t('search'));input.value=search;listen(input,'input',()=>{search=input.value;renderRows(list,summary);});filters.append(input);
  for(const [kind,label,values]of [['type','all',[...new Set(data.models.flatMap(m=>m.mediaTypes))]],['state','any',Object.keys(SYMBOL)]]){
   const select=el('select');select.setAttribute('aria-label',t(label));const blank=el('option','',t(label));blank.value='';select.append(blank);
   for(const key of values){const o=el('option','',kind==='type'?(TYPES[locale][key]||key):t(key));o.value=key;select.append(o);}select.value=kind==='type'?type:state;
   listen(select,'change',()=>{if(kind==='type')type=select.value;else state=select.value;renderRows(list,summary);});filters.append(select);
  }
  root.append(summary,filters,list);renderRows(list,summary);
  const pipeline=el('section','model-status__system');pipeline.append(el('h3','',t('processing')));const counts=el('div','model-status__pipeline');
  for(const [key,value]of Object.entries(data.pipeline)){const item=el('div');item.append(el('strong','',value),el('span','',t(key==='unknown'?'unknownJobs':key)));counts.append(item);}pipeline.append(counts,el('p','model-status__muted',t('sample')));root.append(pipeline);
  const providers=el('details','model-status__system');providers.append(el('summary','',t('provider')),el('p','model-status__muted',t('providerLimit')));
  providers.append(el('p','',`${t('updated')}: ${date(data.provider.observedAt)}${data.provider.stale?' · '+t('stale'):''}`));
  for(const c of data.provider.components)providers.append(el('p','',`${c.name}: ${data.provider.stale?t('unknown'):t(c.state)}`));
  const link=el('a','',t('source'));link.href='https://www.cloudflarestatus.com/api';link.target='_blank';link.rel='noopener noreferrer';providers.append(link);root.append(providers);
  const limits=el('details','model-status__system');limits.append(el('summary','',t('coverage')),el('p','model-status__muted',t('limits')),el('p','',`${t('attribution')}: ${data.unattributed}`));
  for(const source of data.sources)limits.append(el('p','',`${source.name}: ${source.available?'✓':'○'} ${source.available?t('updated'):t('unknown')}${source.truncated?' · ≥100/state':''}`));root.append(limits);
 }
 async function loadData(){
  if(busy)return;const restoreFocus=document.activeElement?.dataset.action==='refresh';busy=true;controller=new AbortController();render();
  const active=controller;const result=await apiAdminModelStatus({signal:active.signal,timeoutMs:15000});
  if(active.signal.aborted||controller!==active)return;busy=false;
  if([401,403,428].includes(result.status)){dispose();root.append(el('p','model-status__notice',t('denied')));return;}
  if(result.ok&&Array.isArray(result.data?.data?.models)&&Array.isArray(result.data.data.sources)&&Array.isArray(result.data.data.provider?.components)&&result.data.data.pipeline){data=result.data.data;stale=data.stale===true;clearTimeout(expiry);expiry=setTimeout(()=>{stale=true;render();},Math.max(0,Date.parse(data.observedAt)+data.freshForSeconds*1000-Date.now()));}
  else stale=true;
  render();if(restoreFocus)root.querySelector('[data-action="refresh"]')?.focus();
 }
 return {load:loadData,hide:dispose,destroy:dispose};
}
