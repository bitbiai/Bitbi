import {canvasApi} from './api.js?v=__ASSET_VERSION__';
import {canvasNotificationText,CANVAS_CLIENT_NOTIFICATION_CODES} from '../../shared/canvas-notification-contract.mjs?v=__ASSET_VERSION__';
import {getAuthState} from '../../shared/auth-state.js?v=__ASSET_VERSION__';

const node=(tag,className='',text='')=>{const value=document.createElement(tag);value.className=className;value.textContent=text;return value;};
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9:_-]{1,240}$/.test(value);
const safeCode=value=>typeof value==='string'&&/^[a-z0-9_]{1,100}$/.test(value);
const diagnostic=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value);
let center=null;
const listeners=new Set();
export function observeCanvasLocalNotices(listener){listeners.add(listener);return()=>listeners.delete(listener);}
export function canvasLocalErrorNotices(projectId){return projectId?center?.localErrors(projectId)||[]:[];}
export function retireCanvasLocalExplanations(projectId,sourceIds=null){center?.retireExplanations(projectId,sourceIds);}
const localError=item=>(item.errorCode||item.details?.errorCode||item.body?.errorCode)&& !['request_aborted','canvas_session_unconfirmed'].includes(item.errorCode||item.details?.errorCode||item.body?.errorCode)
    || ['canvas_save_failed','canvas_request_failed','request_failed','network_error','request_timeout','canvas_connection_interrupted','canvas_action_failed','canvas_project_delete_unconfirmed','canvas_export_failed','canvas_export_observation_interrupted','canvas_cleanup_pending'].includes(item.code);
function changed(){for(const listener of listeners)listener();}
export function canvasNotice(text,details={}){center?.publish({text,...details});}
export function refreshCanvasNotifications(){center?.refresh();}
export function resolveCanvasNotice(key){center?.resolve(key);}
const copyFor=german=>german?{
    title:'Meldungen',close:'Meldungen schließen',empty:'Noch keine Meldungen.',read:'Alle als gelesen markieren',remove:'Meldung löschen',clear:'Alle Meldungen löschen',confirm:'Alle bisherigen Canvas-Meldungen für dein Konto in allen Projekten löschen? Projekte, Medien und Produktionsverlauf bleiben erhalten.',cancel:'Abbrechen',pending:'Löschen noch nicht bestätigt. Wird bei Verbindung erneut abgeglichen.',failed:'Änderung noch nicht bestätigt. Bitte erneut versuchen.',more:'Ältere Meldungen laden',refresh:'Aktualisieren',
    loading:'Meldungen werden geladen …',offline:'Verbindung unterbrochen. Gespeicherte Meldungen werden automatisch abgeglichen.',local:'Nur auf diesem Gerät · Speicherung noch nicht bestätigt',
    unread:'Ungelesene Meldungen',readFailed:'Gelesen-Markierung noch nicht bestätigt. Erneut versuchen.',reported:'Vom Browser gemeldet',details:'Details',project:'Projekt',open:'Projekt öffnen',unknown:'Canvas-Meldung',validation:'Prüfung',field:'Feld',providerOutcome:'Anbieterergebnis',outcomes:{completed:'Antwort gespeichert',not_submitted:'nicht versandt',unknown:'unbestätigt',rejected:'abgelehnt'},
}: {title:'Notifications',close:'Close notifications',empty:'No notifications yet.',read:'Mark all as read',remove:'Delete notification',clear:'Delete all notifications',confirm:'Delete all existing Canvas notifications for your account across projects? Projects, media and production history are kept.',cancel:'Cancel',pending:'Deletion not yet confirmed. It will reconcile when connected.',failed:'Change not yet confirmed. Please retry.',more:'Load older notifications',refresh:'Refresh',
    loading:'Loading notifications …',offline:'Connection interrupted. Saved notifications will reconnect automatically.',local:'On this device · storage not yet confirmed',
    unread:'Unread notifications',readFailed:'Read acknowledgement is not confirmed. Please retry.',reported:'Reported by this browser',details:'Details',project:'Project',open:'Open project',unknown:'Canvas notification',validation:'Validation',field:'Field',providerOutcome:'Provider outcome',outcomes:{completed:'response saved',not_submitted:'not submitted',unknown:'unconfirmed',rejected:'rejected'}};

// Account-owned inbox. Opening/reading never replays the operation described by
// an item. Local delivery retries retain their immutable request identity.
export function createCanvasNotifications({button,panel,german,getProject=()=>null,openProject=()=>{}}){
    const copy=copyFor(german),items=new Map(),pending=new Map(),presented=new Set(),rows=new Map(),dedup=new Map(),deletedProjects=new Set(),explainedRequests=new Set(),mutations=new Map();
    let actor=getAuthState().sessionConfirmed&&getAuthState().loggedIn?getAuthState().user?.id||null:null;
    let viewer=null,epoch=0,controller=null,timer=null,reading=false,catchUp=false,acknowledging=false,active=false,suspended=false,failures=0,cursor=null,unread=0,total=0,revision=0,mutationClock=0,readTimer=null,readBlocked=false;
    const badge=node('span','canvas-notifications__badge','!');badge.hidden=true;badge.setAttribute('aria-hidden','true');button.append(badge);
    const heading=node('h2','',copy.title);heading.id='canvasNotificationsTitle';panel.setAttribute('aria-labelledby',heading.id);panel.setAttribute('role','dialog');
    const close=node('button','canvas-button canvas-button--compact',copy.close);close.type='button';
    const head=node('div','canvas-notifications__head');head.append(heading,close);
    const status=node('p','canvas-muted');status.setAttribute('role','status');
    const list=node('ol','canvas-notifications__list');list.setAttribute('aria-label',copy.title);
    const empty=node('p','canvas-muted',copy.empty),actions=node('div','canvas-notifications__actions');
    const clear=node('button','canvas-button',copy.clear);clear.type='button';
    const confirmation=node('div','canvas-notifications__confirmation');confirmation.hidden=true;confirmation.setAttribute('role','group');confirmation.setAttribute('aria-label',copy.clear);
    const yes=node('button','canvas-button',copy.clear),cancel=node('button','canvas-button',copy.cancel);yes.type=cancel.type='button';confirmation.append(node('p','',copy.confirm),yes,cancel);
    const mark=node('button','canvas-button',copy.read),more=node('button','canvas-button',copy.more),refresh=node('button','canvas-button',copy.refresh);
    for(const value of [mark,more,refresh])value.type='button';actions.append(mark,clear,more,refresh);panel.append(head,status,confirmation,list,empty,actions);
    const observer=new IntersectionObserver(entries=>{
        if(panel.hidden||document.visibilityState==='hidden'||suspended)return;
        for(const entry of entries){const id=entry.target.dataset.notificationId;
            if(entry.isIntersecting&&entry.intersectionRect.height>=Math.min(120,entry.boundingClientRect.height)*.5)presented.add(id);else presented.delete(id);
        }
        queueRead();
    },{root:list,threshold:[0,.1,.5,1]});
    function queueRead(){
        clearTimeout(readTimer);
        if(!panel.hidden&&!suspended&&!readBlocked&&!acknowledging&&document.visibilityState!=='hidden'&&[...presented].some(id=>items.has(id)&&!items.get(id).readAt))readTimer=setTimeout(()=>void acknowledge(),650);
    }
    function updateRead(){
        mark.disabled=acknowledging||unread+[...items.values()].filter(item=>item.local&&!item.readAt).length===0;
        clear.disabled=acknowledging||total+items.size===0;yes.disabled=acknowledging;
        for(const entry of rows.values())if(entry.remove)entry.remove.disabled=acknowledging;
    }
    function counts(data){
        if(Number.isSafeInteger(data.inboxRevision)&&data.inboxRevision<revision)return;
        if(Number.isSafeInteger(data.inboxRevision))revision=Math.max(revision,data.inboxRevision);
        if(Number.isSafeInteger(data.unreadCount))unread=Math.max(0,data.unreadCount);
        if(Number.isSafeInteger(data.totalCount))total=Math.max(0,data.totalCount);
    }
    function paint(){
        const localUnread=[...items.values()].filter(value=>value.local&&!value.readAt).length;
        badge.hidden=Math.max(0,unread)+localUnread===0;button.setAttribute('aria-label',`${copy.title}${badge.hidden?'':` · ${copy.unread}`}`);
        observer.disconnect();presented.clear();let next=list.firstElementChild;const retained=new Set();
        const values=[...items.values()].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||b.id.localeCompare(a.id));
        for(const item of values){
            retained.add(item.id);const signature=JSON.stringify([item.localText,item.code,item.details,item.projectTitle,item.projectDeleted,item.local,item.createdAt,item.diagnosticRef,item.status,item.stage]);
            let entry=rows.get(item.id);if(!entry){entry={row:node('li','canvas-notifications__item'),signature:null};rows.set(item.id,entry);}
            const row=entry.row;row.dataset.notificationId=item.id;row.dataset.code=safeCode(item.code)?item.code:'';row.dataset.unread=String(!item.readAt);row.dataset.severity=item.severity||'info';
            if(signature!==entry.signature){entry.signature=signature;row.replaceChildren();
            const text=node('p','canvas-notifications__text',item.localText||canvasNotificationText(item,german)||copy.unknown);row.append(text);
            const date=new Date(item.createdAt),meta=node('p','canvas-muted');
            if(Number.isFinite(date.getTime())){const time=node('time','',date.toLocaleString(german?'de':'en',{dateStyle:'short',timeStyle:'short'}));time.dateTime=date.toISOString();meta.append(time);}
            if(item.projectTitle)meta.append(document.createTextNode(` · ${String(item.projectTitle).slice(0,120)}`));row.append(meta);
            if(item.local)row.append(node('p','canvas-notifications__local',copy.local));
            else if(item.confirmed===false)row.append(node('p','canvas-notifications__local',copy.reported));
            const details=[safeCode(item.errorCode||item.details?.errorCode)?item.errorCode||item.details.errorCode:null,safeCode(item.code)?item.code:null,diagnostic(item.diagnosticRef)?item.diagnosticRef:null,Number.isSafeInteger(item.status)&&item.status>0?`HTTP ${item.status}`:null].filter(Boolean);
            // The server validates the full schema path. The browser renders
            // only its bounded public diagnostic, never the private policy.
            const validation=item.details?.validationDiagnostic,outcome=item.details?.providerOutcome;
            if(validation?.version===1&&['json','schema','semantic','size'].includes(validation.category)&&safeCode(validation.reason)&&typeof validation.path==='string'&&validation.path.length<=180&&/^(?:plan|evaluation)(?:\.[A-Za-z][A-Za-z0-9]*|\[[0-9]{1,2}\])*$/.test(validation.path))details.push(`${copy.validation}: ${validation.category}/${validation.reason}`,`${copy.field}: ${validation.path}`);
            if(Object.hasOwn(copy.outcomes,outcome||''))details.push(`${copy.providerOutcome}: ${copy.outcomes[outcome]}`);
            if(details.length){const disclosure=node('details');disclosure.append(node('summary','',copy.details),node('code','',details.join(' · ')));row.append(disclosure);}
            const remove=node('button','canvas-button canvas-button--compact',copy.remove);remove.type='button';remove.addEventListener('click',()=>void removeItems([item]));entry.remove=remove;row.append(remove);
            if(identifier(item.projectId)&&item.projectDeleted!==true){const open=node('button','canvas-button canvas-button--compact',copy.open);open.type='button';open.addEventListener('click',()=>{hide();void openProject(item.projectId);});row.append(open);}
            }
            if(row!==next)list.insertBefore(row,next);next=row.nextElementSibling;if(!panel.hidden&&document.visibilityState!=='hidden')observer.observe(row);
        }
        for(const [id,entry]of rows)if(!retained.has(id)){entry.row.remove();rows.delete(id);}
        empty.hidden=values.length>0;more.hidden=!cursor;more.disabled=reading;refresh.disabled=reading;updateRead();
    }
    function storePending(){const owner=viewer||actor;if(!owner)return;try{sessionStorage.setItem(`bitbi:canvas-notification-mutations:${owner}`,JSON.stringify([...mutations.values()]));sessionStorage.setItem(`bitbi:canvas-notifications:${owner}`,JSON.stringify([...pending.values()].map(value=>({body:value.body,createdAt:value.createdAt,readAt:value.readAt||null,savedId:value.savedId||null,localOnly:value.localOnly===true})).slice(-60)));}catch{}}
    function restorePending(){try{const removed=JSON.parse(sessionStorage.getItem(`bitbi:canvas-notification-mutations:${viewer}`)||'[]');for(const value of Array.isArray(removed)?removed.slice(-60):[])if(identifier(value?.requestId)&&Array.isArray(value.ids)&&value.ids.every(identifier)&&Array.isArray(value.clientRequestIds)&&value.clientRequestIds.every(identifier))mutations.set(value.requestId,value);const saved=JSON.parse(sessionStorage.getItem(`bitbi:canvas-notifications:${viewer}`)||'[]');for(const value of Array.isArray(saved)?saved.slice(-60):[]){const source=value?.body;if(!identifier(source?.requestId)||!CANVAS_CLIENT_NOTIFICATION_CODES.includes(source?.code))continue;const body={requestId:source.requestId,code:source.code,...(identifier(source.projectId)?{projectId:source.projectId}:{}),...(diagnostic(source.diagnosticRef)?{diagnosticRef:source.diagnosticRef}:{}),...(/^[a-z][a-z0-9_]{1,100}$/.test(source.errorCode||'')?{errorCode:source.errorCode}:{}),...(Number.isSafeInteger(source.status)&&source.status>=0&&source.status<=599?{status:source.status}:{})};const item={id:`local:${body.requestId}`,source:'client',kind:'client',severity:'warning',code:body.code,projectId:body.projectId||null,createdAt:value.createdAt,readAt:value.readAt,local:true,ownerId:viewer,savedId:identifier(value.savedId)?value.savedId:null,localOnly:value.localOnly===true,body};if(![...mutations.values()].some(value=>value.kind!=='read'&&value.clientRequestIds.includes(body.requestId))){pending.set(body.requestId,item);items.set(item.id,item);}}}catch{}}
    function reset(){epoch++;controller?.abort();controller=null;reading=false;catchUp=false;acknowledging=false;clearTimeout(timer);clearTimeout(readTimer);viewer=null;cursor=null;unread=total=revision=mutationClock=0;readBlocked=false;mutations.clear();items.clear();pending.clear();presented.clear();dedup.clear();deletedProjects.clear();explainedRequests.clear();hide();paint();changed();}
    function hide(){clearTimeout(readTimer);confirmation.hidden=true;panel.hidden=true;button.setAttribute('aria-expanded','false');presented.clear();observer.disconnect();}
    function show(){panel.hidden=false;button.setAttribute('aria-expanded','true');paint();close.focus({preventScroll:true});void observe();}
    function schedule(){clearTimeout(timer);if(!active||suspended||document.visibilityState==='hidden')return;timer=setTimeout(()=>void observe(),failures?Math.min(60000,3000*2**Math.min(failures,4)):panel.hidden?30000:10000);}
    async function deliver(){
        if(!viewer||!active||suspended)return;
        const current=epoch,actor=viewer;
        for(const [key,item]of pending){
            if(item.ownerId!==viewer||item.localOnly||!pending.has(key))continue;
            const response=await canvasApi.notificationClient(item.body);
            if(epoch!==current||actor!==viewer||suspended)return;
            if(!response.ok){if([401,403].includes(response.status)){reset();active=false;return;}if([400,404,409,422].includes(response.status)){item.localOnly=true;storePending();continue;}return;}
            if(response.data?.viewerId===viewer&&response.data.deleted){pending.delete(key);items.delete(item.id);storePending();continue;}
            if(!pending.has(key))continue;
            const saved=response.data?.item;if(!saved||!identifier(saved.id)||response.data.viewerId!==viewer)return;
            item.savedId=saved.id;storePending();
            // Transfer only this item's explicit offline acknowledgement. A new
            // arrival or a merely displayed item is never marked read here.
            if(item.readAt&&!saved.readAt){
                const acknowledgement=await canvasApi.notificationRead([saved.id]);
                if(epoch!==current||actor!==viewer||suspended)return;
                if(!acknowledgement.ok||acknowledgement.data?.viewerId!==viewer||!acknowledgement.data.readIds?.includes(saved.id)){status.textContent=copy.readFailed;return;}
                saved.readAt=item.readAt;counts(acknowledgement.data);
            }
            pending.delete(key);items.delete(item.id);if(!saved.readAt&&!items.has(saved.id))unread++;items.set(saved.id,{...saved,localKey:item.localKey,localExplanationRequestId:key});storePending();changed();
        }
    }
    async function observe(older=false){
        if(!active||suspended||document.visibilityState==='hidden')return;
        if(reading){catchUp=true;return;}
        reading=true;clearTimeout(timer);const current=epoch;
        if(mutations.size&&viewer&&!acknowledging){
            await flushMutations();
            if(current!==epoch)return;
            if(mutations.size||!active||suspended||document.visibilityState==='hidden'){reading=false;schedule();return;}
        }
        const clock=mutationClock,request=new AbortController();controller=request;
        const response=await canvasApi.notifications(older?cursor:null,request.signal);
        if(current!==epoch||request.signal.aborted)return;
        controller=null;
        if(clock!==mutationClock){reading=false;void observe();return;}
        if(response.ok&&identifier(response.data?.viewerId)&&Array.isArray(response.data.items)){
            const data=response.data;if(actor&&actor!==data.viewerId){reset();active=false;return;}if(viewer&&viewer!==data.viewerId){reset();active=true;void observe();return;}
            if(!viewer){viewer=data.viewerId;for(const [key,item]of pending)if(item.ownerId!==viewer){pending.delete(key);items.delete(item.id);}restorePending();}
            if(Number.isSafeInteger(data.inboxRevision)&&data.inboxRevision<revision){reading=false;schedule();return;}
            if(data.inboxRevision>revision){cursor=null;for(const [id,item]of items)if(!item.local)items.delete(id);if(older){counts(data);cursor=null;reading=false;void observe();return;}}
            counts(data);
            for(const item of data.items)if(identifier(item?.id)&&['event','action','export','run','client','lifecycle','conversation','decision','immediate'].includes(item.source)){
                // The canonical tombstone retires every confirmed operational
                // projection, including rows retained from older inbox pages.
                // Browser reports and the deletion receipt remain readable.
                const deleted=item.source==='lifecycle'&&item.code==='canvas_project_deleted'&&item.confirmed===true&&identifier(item.projectId);
                if(deleted){deletedProjects.add(item.projectId);for(const [id,prior]of items)if(prior.projectId===item.projectId){
                    if(prior.source==='client'){prior.projectDeleted=true;continue;}
                    if(prior.confirmed===true&&!(prior.source==='lifecycle'&&prior.code==='canvas_project_deleted')){items.delete(id);presented.delete(id);}
                }}
                if(deletedProjects.has(item.projectId)&&item.confirmed===true&&item.source!=='client'&&!deleted)continue;
                // Mutable operation projections replace their former outcome;
                // immutable event history and other pages remain independent.
                if([...pending.values()].some(value=>value.savedId===item.id&&value.readAt))continue;
                const field={export:'exportId',action:'actionId',run:'runId',conversation:'turnId',decision:'decisionId',immediate:'intentId'}[item.source],operation=field&&item.details?.[field];
                if(identifier(operation))for(const [id,prior]of items)if(id!==item.id&&prior.source===item.source&&prior.projectId===item.projectId&&prior.details?.[field]===operation){items.delete(id);presented.delete(id);}
                const previous=items.get(item.id);
                items.set(item.id,{...item,...(previous?.localKey?{localKey:previous.localKey}:{}),...(previous?.localExplanationRequestId?{localExplanationRequestId:previous.localExplanationRequestId}:{})});
            }
            if(older||!cursor)cursor=data.nextCursor||null;failures=0;status.textContent=mutations.size?copy.pending:'';
            if(!mutations.size)await deliver();if(current!==epoch)return;
        }else if([401,403].includes(response.status)){reset();active=false;status.textContent=copy.offline;return;}
        else{failures++;status.textContent=copy.offline;publish({text:copy.offline,code:'canvas_connection_interrupted',errorCode:response.code,status:response.status,diagnosticRef:response.diagnosticRef,projectId:null,key:'notification-connection',localOnly:true});}
        reading=false;paint();changed();if(catchUp){catchUp=false;void observe();}else schedule();
    }
    async function acknowledge(all=false){
        if(acknowledging||panel.hidden||suspended||document.visibilityState==='hidden')return;
        if(all){
            if(![...mutations.values()].some(value=>value.kind==='read')){const requestId=crypto.randomUUID();mutations.set(requestId,{kind:'read',requestId,ids:[],clientRequestIds:[],all:true});}
            for(const item of items.values())if(item.local)item.readAt=new Date().toISOString();
            storePending();await flushMutations();if(!mutations.size)void observe();return;
        }
        const current=epoch,displayed=[...presented].map(id=>items.get(id)).filter(item=>item&&!item.readAt);
        const remote=displayed.filter(item=>!item.local).slice(0,100);acknowledging=true;mutationClock++;updateRead();
        if(remote.length){const result=await canvasApi.notificationRead(remote.map(item=>item.id));if(epoch!==current)return;
            if(!result.ok||result.data?.viewerId!==viewer||!Array.isArray(result.data.readIds)){acknowledging=false;readBlocked=true;status.textContent=copy.readFailed;updateRead();return;}
            const acknowledged=new Set(result.data.readIds);
            for(const item of remote){
                if(acknowledged.has(item.id)){if(items.has(item.id))items.get(item.id).readAt=new Date().toISOString();}
                else{items.delete(item.id);presented.delete(item.id);}
            }
            counts(result.data);
        }
        for(const item of displayed.filter(item=>item.local))item.readAt=new Date().toISOString();
        storePending();mutationClock++;acknowledging=false;paint();broadcast();void observe();
    }
    async function removeItems(selection,all=false){
        if(acknowledging)return;
        if(mutations.size>=60){status.textContent=copy.pending;return;}
        const body={kind:'delete',requestId:crypto.randomUUID(),ids:all?[]:selection.filter(item=>!item.local).map(item=>item.id),
            clientRequestIds:selection.filter(item=>item.local).map(item=>item.body.requestId),...(all?{all:true}:{})};
        // Persist the immutable removal before a potentially ambiguous response.
        // No pending delivery can race its local alias back into the inbox.
        mutations.set(body.requestId,body);
        for(const item of selection.filter(item=>item.local)){items.delete(item.id);pending.delete(item.body.requestId);}
        confirmation.hidden=true;storePending();await flushMutations();paint();if(!panel.hidden&&!panel.contains(document.activeElement))close.focus({preventScroll:true});if(!mutations.size)void observe();else schedule();
    }
    async function flushMutations(){
        if(acknowledging||!viewer)return;
        acknowledging=true;mutationClock++;updateRead();const current=epoch;
        for(const [key,body]of mutations){
            const {kind,...input}=body;const result=await (kind==='read'?canvasApi.notificationRead({requestId:input.requestId,all:true}):canvasApi.notificationDelete(input));if(epoch!==current)return;
            if(!result.ok||result.data?.viewerId!==viewer||!Array.isArray(result.data[kind==='read'?'readIds':'deletedIds'])){status.textContent=kind==='read'?copy.readFailed:copy.pending;acknowledging=false;updateRead();return;}
            if(body.all){for(const [id,item]of items)if(!item.local)items.delete(id);cursor=null;}
            else for(const id of result.data.deletedIds)items.delete(id);
            mutations.delete(key);counts(result.data);storePending();broadcast();
        }
        status.textContent='';mutationClock++;acknowledging=false;paint();
    }
    let channel=null;
    try{channel=new BroadcastChannel('bitbi:canvas-inbox');channel.onmessage=event=>{if(event.data?.viewer===viewer){readBlocked=false;void observe();}};}catch{/* Poll/visibility refresh also reconciles other devices. */}
    function broadcast(){channel?.postMessage({viewer});}
    function publish({text='',code='canvas_client_notice',projectId=getProject()?.id||null,projectTitle=null,diagnosticRef,errorCode,status,kind='client',key,localOnly=false}={}){
        if(!text&&!safeCode(code))return;
        if(key&&dedup.has(key))return;
        const actualError=errorCode||(!CANVAS_CLIENT_NOTIFICATION_CODES.includes(code)?code:null);
        const requestId=crypto.randomUUID(),body={requestId,code:CANVAS_CLIENT_NOTIFICATION_CODES.includes(code)?code:'canvas_client_notice',...(identifier(projectId)?{projectId}:{}),...(diagnostic(diagnosticRef)?{diagnosticRef}:{}),...(/^[a-z][a-z0-9_]{1,100}$/.test(actualError||'')?{errorCode:actualError}:{}),...(Number.isSafeInteger(status)&&status>=0&&status<=599?{status}:{})};
        if(key){dedup.set(key,requestId);if(dedup.size>1000)dedup.delete(dedup.keys().next().value);}
        const ownerId=actor||viewer;const item={id:`local:${requestId}`,ownerId,localOnly,source:'client',kind,code:body.code,severity:'info',projectId:body.projectId||null,projectTitle:projectTitle||(getProject()?.id===projectId?getProject()?.title:null),createdAt:new Date().toISOString(),readAt:null,local:true,localKey:key||null,localText:String(text).slice(0,2000),...(body.errorCode?{errorCode:body.errorCode}:{}),body};
        items.set(item.id,item);if(ownerId)pending.set(requestId,item);storePending();paint();changed();if(active&&!localOnly)void observe();
    }
    button.addEventListener('click',()=>panel.hidden?show():hide());close.addEventListener('click',()=>{hide();button.focus({preventScroll:true});});
    // An acknowledgement can disable its focused button, and WebKit may move
    // focus to the document. Escape still closes the open workspace menu.
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!panel.hidden){event.preventDefault();event.stopPropagation();hide();button.focus({preventScroll:true});}});
    mark.addEventListener('click',()=>{readBlocked=false;void acknowledge(true);});
    clear.addEventListener('click',()=>{confirmation.hidden=false;cancel.focus({preventScroll:true});});cancel.addEventListener('click',()=>{confirmation.hidden=true;clear.focus({preventScroll:true});});yes.addEventListener('click',()=>void removeItems([...items.values()],true));more.addEventListener('click',()=>void observe(true));refresh.addEventListener('click',()=>{readBlocked=false;void observe();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){clearTimeout(timer);clearTimeout(readTimer);presented.clear();observer.disconnect();}else{paint();void observe();}});
    window.addEventListener('online',()=>{failures=0;readBlocked=false;void observe();});window.addEventListener('offline',()=>{status.textContent=copy.offline;});
    // Navigation may cancel WebKit reads before pagehide; do not persist that
    // expected abort as an outage. A declined navigation keeps normal polling.
    window.addEventListener('beforeunload',()=>{controller?.abort();reading=false;schedule();});
    window.addEventListener('pagehide',()=>{suspended=true;controller?.abort();reading=false;clearTimeout(timer);clearTimeout(readTimer);presented.clear();observer.disconnect();});
    window.addEventListener('pageshow',()=>{suspended=false;paint();void observe();});
    document.addEventListener('bitbi:auth-change',event=>{const auth=event.detail||getAuthState();if(auth.sessionConfirmed){const next=auth.loggedIn?auth.user?.id||null:null;if(!next||actor&&actor!==next||viewer&&viewer!==next){reset();active=Boolean(next);}actor=next;if(active)void observe();}});
    hide();paint();center={publish,resolve:key=>dedup.delete(key),refresh:()=>void observe(),
        retireExplanations(projectId,sourceIds){for(const item of items.values())if(item.projectId===projectId&&(!sourceIds||sourceIds.has(item.savedId||item.id)))explainedRequests.add(item.body?.requestId||item.localExplanationRequestId);},
        localErrors(projectId){return [...items.values()].filter(item=>item.projectId===projectId&&!deletedProjects.has(projectId)&&!explainedRequests.has(item.body?.requestId||item.localExplanationRequestId)&&(item.local||item.localExplanationRequestId)&&localError(item)).slice(-30).map(item=>({
            requestId:item.body?.requestId||item.localExplanationRequestId,sourceNotificationId:item.savedId||(!item.local?item.id:null),code:item.code,createdAt:item.createdAt,local:!item.savedId&&item.local===true,
        }));},
        start(){active=true;status.textContent=copy.loading;void observe();},stop(){active=false;reset();}};return center;
}
