import {canvasApi} from './api.js?v=__ASSET_VERSION__';
import {canvasNotificationText,CANVAS_CLIENT_NOTIFICATION_CODES} from '../../shared/canvas-notification-contract.mjs?v=__ASSET_VERSION__';
import {getAuthState} from '../../shared/auth-state.js?v=__ASSET_VERSION__';

const node=(tag,className='',text='')=>{const value=document.createElement(tag);value.className=className;value.textContent=text;return value;};
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9:_-]{1,240}$/.test(value);
const safeCode=value=>typeof value==='string'&&/^[a-z0-9_]{1,100}$/.test(value);
const diagnostic=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value);
let center=null;
export function canvasNotice(text,details={}){center?.publish({text,...details});}
export function refreshCanvasNotifications(){center?.refresh();}
export function resolveCanvasNotice(key){center?.resolve(key);}
const copyFor=german=>german?{
    title:'Meldungen',close:'Meldungen schließen',empty:'Noch keine Meldungen.',read:'Angezeigte als gelesen markieren',more:'Ältere Meldungen laden',refresh:'Aktualisieren',
    loading:'Meldungen werden geladen …',offline:'Verbindung unterbrochen. Gespeicherte Meldungen werden automatisch abgeglichen.',local:'Nur auf diesem Gerät · Speicherung noch nicht bestätigt',
    unread:'Ungelesene Meldungen',readFailed:'Gelesen-Markierung noch nicht bestätigt. Erneut versuchen.',reported:'Vom Browser gemeldet',details:'Details',project:'Projekt',open:'Projekt öffnen',unknown:'Canvas-Meldung',
}: {title:'Notifications',close:'Close notifications',empty:'No notifications yet.',read:'Mark displayed as read',more:'Load older notifications',refresh:'Refresh',
    loading:'Loading notifications …',offline:'Connection interrupted. Saved notifications will reconnect automatically.',local:'On this device · storage not yet confirmed',
    unread:'Unread notifications',readFailed:'Read acknowledgement is not confirmed. Please retry.',reported:'Reported by this browser',details:'Details',project:'Project',open:'Open project',unknown:'Canvas notification'};

// Account-owned inbox. Opening/reading never replays the operation described by
// an item. Local delivery retries retain their immutable request identity.
export function createCanvasNotifications({button,panel,german,getProject=()=>null,openProject=()=>{}}){
    const copy=copyFor(german),items=new Map(),pending=new Map(),presented=new Set(),rows=new Map(),dedup=new Map(),deletedProjects=new Set();
    let actor=getAuthState().sessionConfirmed&&getAuthState().loggedIn?getAuthState().user?.id||null:null;
    let viewer=null,epoch=0,controller=null,timer=null,reading=false,catchUp=false,acknowledging=false,active=false,suspended=false,failures=0,cursor=null,unread=0;
    const badge=node('span','canvas-notifications__badge','!');badge.hidden=true;badge.setAttribute('aria-hidden','true');button.append(badge);
    const heading=node('h2','',copy.title);heading.id='canvasNotificationsTitle';panel.setAttribute('aria-labelledby',heading.id);panel.setAttribute('role','dialog');
    const close=node('button','canvas-button canvas-button--compact',copy.close);close.type='button';
    const head=node('div','canvas-notifications__head');head.append(heading,close);
    const status=node('p','canvas-muted');status.setAttribute('role','status');
    const list=node('ol','canvas-notifications__list');list.setAttribute('aria-label',copy.title);
    const empty=node('p','canvas-muted',copy.empty),actions=node('div','canvas-notifications__actions');
    const mark=node('button','canvas-button',copy.read),more=node('button','canvas-button',copy.more),refresh=node('button','canvas-button',copy.refresh);
    for(const value of [mark,more,refresh])value.type='button';actions.append(mark,more,refresh);panel.append(head,status,list,empty,actions);
    const observer=new IntersectionObserver(entries=>{if(panel.hidden||document.visibilityState==='hidden')return;for(const entry of entries)if(entry.isIntersecting)presented.add(entry.target.dataset.notificationId);updateRead();},{root:list,threshold:0.1});
    function updateRead(){mark.disabled=acknowledging||![...presented].some(id=>items.has(id)&&!items.get(id).readAt);}
    function paint(){
        const localUnread=[...items.values()].filter(value=>value.local&&!value.readAt).length;
        const knownUnread=[...items.values()].filter(value=>!value.local&&!value.readAt).length;
        badge.hidden=Math.max(0,unread,knownUnread)+localUnread===0;button.setAttribute('aria-label',`${copy.title}${badge.hidden?'':` · ${copy.unread}`}`);
        observer.disconnect();let next=list.firstElementChild;const retained=new Set();
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
            if(details.length){const disclosure=node('details');disclosure.append(node('summary','',copy.details),node('code','',details.join(' · ')));row.append(disclosure);}
            if(identifier(item.projectId)&&item.projectDeleted!==true){const open=node('button','canvas-button canvas-button--compact',copy.open);open.type='button';open.addEventListener('click',()=>{hide();void openProject(item.projectId);});row.append(open);}
            }
            if(row!==next)list.insertBefore(row,next);next=row.nextElementSibling;observer.observe(row);
        }
        for(const [id,entry]of rows)if(!retained.has(id)){entry.row.remove();rows.delete(id);}
        empty.hidden=values.length>0;more.hidden=!cursor;more.disabled=reading;refresh.disabled=reading;updateRead();
    }
    function storePending(){if(!viewer)return;try{sessionStorage.setItem(`bitbi:canvas-notifications:${viewer}`,JSON.stringify([...pending.values()].map(value=>({body:value.body,createdAt:value.createdAt,readAt:value.readAt||null,savedId:value.savedId||null,localOnly:value.localOnly===true})).slice(-60)));}catch{}}
    function restorePending(){try{const saved=JSON.parse(sessionStorage.getItem(`bitbi:canvas-notifications:${viewer}`)||'[]');for(const value of Array.isArray(saved)?saved.slice(-60):[]){const source=value?.body;if(!identifier(source?.requestId)||!CANVAS_CLIENT_NOTIFICATION_CODES.includes(source?.code))continue;const body={requestId:source.requestId,code:source.code,...(identifier(source.projectId)?{projectId:source.projectId}:{}),...(diagnostic(source.diagnosticRef)?{diagnosticRef:source.diagnosticRef}:{}),...(/^[a-z][a-z0-9_]{1,100}$/.test(source.errorCode||'')?{errorCode:source.errorCode}:{}),...(Number.isSafeInteger(source.status)&&source.status>=0&&source.status<=599?{status:source.status}:{})};const item={id:`local:${body.requestId}`,source:'client',kind:'client',severity:'warning',code:body.code,projectId:body.projectId||null,createdAt:value.createdAt,readAt:value.readAt,local:true,ownerId:viewer,savedId:identifier(value.savedId)?value.savedId:null,localOnly:value.localOnly===true,body};pending.set(body.requestId,item);items.set(item.id,item);}}catch{}}
    function reset(){epoch++;controller?.abort();controller=null;reading=false;catchUp=false;acknowledging=false;clearTimeout(timer);viewer=null;cursor=null;unread=0;items.clear();pending.clear();presented.clear();dedup.clear();deletedProjects.clear();hide();paint();}
    function hide(){panel.hidden=true;button.setAttribute('aria-expanded','false');presented.clear();observer.disconnect();}
    function show(){panel.hidden=false;button.setAttribute('aria-expanded','true');paint();close.focus({preventScroll:true});void observe();}
    function schedule(){clearTimeout(timer);if(!active||suspended||document.visibilityState==='hidden')return;timer=setTimeout(()=>void observe(),failures?Math.min(60000,3000*2**Math.min(failures,4)):panel.hidden?30000:10000);}
    async function deliver(){
        if(!viewer||!active||suspended)return;
        const current=epoch,actor=viewer;
        for(const [key,item]of pending){
            if(item.ownerId!==viewer||item.localOnly)continue;
            const response=await canvasApi.notificationClient(item.body);
            if(epoch!==current||actor!==viewer||suspended)return;
            if(!response.ok){if([401,403].includes(response.status)){reset();active=false;return;}if([400,404,409,422].includes(response.status)){item.localOnly=true;storePending();continue;}return;}
            const saved=response.data?.item;if(!saved||!identifier(saved.id)||response.data.viewerId!==viewer)return;
            item.savedId=saved.id;storePending();
            // Transfer only this item's explicit offline acknowledgement. A new
            // arrival or a merely displayed item is never marked read here.
            if(item.readAt&&!saved.readAt){
                const acknowledgement=await canvasApi.notificationRead([saved.id]);
                if(epoch!==current||actor!==viewer||suspended)return;
                if(!acknowledgement.ok||acknowledgement.data?.viewerId!==viewer||!acknowledgement.data.readIds?.includes(saved.id)){status.textContent=copy.readFailed;return;}
                saved.readAt=item.readAt;unread=acknowledgement.data.unreadCount;
            }
            pending.delete(key);items.delete(item.id);items.set(saved.id,{...saved,localKey:item.localKey});storePending();
        }
    }
    async function observe(older=false){
        if(!active||suspended||document.visibilityState==='hidden')return;
        if(reading){catchUp=true;return;}
        reading=true;clearTimeout(timer);const current=epoch,request=new AbortController();controller=request;
        const response=await canvasApi.notifications(older?cursor:null,request.signal);
        if(current!==epoch||request.signal.aborted)return;
        controller=null;
        if(response.ok&&identifier(response.data?.viewerId)&&Array.isArray(response.data.items)){
            const data=response.data;if(viewer&&viewer!==data.viewerId){reset();active=true;void observe();return;}
            if(!viewer){viewer=data.viewerId;for(const [key,item]of pending)if(item.ownerId!==viewer){pending.delete(key);items.delete(item.id);}restorePending();}
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
                items.set(item.id,{...item,...(items.get(item.id)?.localKey?{localKey:items.get(item.id).localKey}:{})});
            }
            cursor=data.nextCursor||null;unread=Number.isSafeInteger(data.unreadCount)?Math.max(0,data.unreadCount):0;failures=0;dedup.delete('notification-connection');status.textContent='';
            await deliver();if(current!==epoch)return;
        }else if([401,403].includes(response.status)){reset();active=false;status.textContent=copy.offline;return;}
        else{failures++;status.textContent=copy.offline;publish({text:copy.offline,code:'canvas_connection_interrupted',errorCode:response.code,status:response.status,diagnosticRef:response.diagnosticRef,projectId:null,key:'notification-connection',localOnly:true});}
        reading=false;paint();if(catchUp){catchUp=false;void observe();}else schedule();
    }
    async function acknowledge(){
        if(acknowledging||panel.hidden)return;const current=epoch,displayed=[...presented].map(id=>items.get(id)).filter(item=>item&&!item.readAt);
        const remote=displayed.filter(item=>!item.local).slice(0,100);acknowledging=true;updateRead();
        if(remote.length){const result=await canvasApi.notificationRead(remote.map(item=>item.id));if(epoch!==current)return;
            if(!result.ok||result.data?.viewerId!==viewer||!Array.isArray(result.data.readIds)){acknowledging=false;status.textContent=copy.readFailed;if(!result.ok)publish({text:copy.offline,code:'canvas_connection_interrupted',projectId:null,key:'notification-connection',localOnly:true});updateRead();return;}
            const acknowledged=new Set(result.data.readIds);
            for(const item of remote){
                if(acknowledged.has(item.id)){if(items.has(item.id))items.get(item.id).readAt=new Date().toISOString();}
                // Successful owner-scoped readback omits sources that no
                // longer exist (for example a cleared failed conversation).
                // Remove only requested old identities, never later arrivals.
                else{items.delete(item.id);presented.delete(item.id);}
            }
            unread=Number.isSafeInteger(result.data.unreadCount)?result.data.unreadCount:Math.max(0,unread-acknowledged.size);
        }
        for(const item of displayed.filter(item=>item.local)){item.readAt=new Date().toISOString();}storePending();acknowledging=false;paint();void observe();
    }
    function publish({text='',code='canvas_client_notice',projectId=getProject()?.id||null,projectTitle=null,diagnosticRef,errorCode,status,kind='client',key,localOnly=false}={}){
        if(!text&&!safeCode(code))return;
        if(key&&dedup.has(key))return;
        const actualError=errorCode||(!CANVAS_CLIENT_NOTIFICATION_CODES.includes(code)?code:null);
        const requestId=crypto.randomUUID(),body={requestId,code:CANVAS_CLIENT_NOTIFICATION_CODES.includes(code)?code:'canvas_client_notice',...(identifier(projectId)?{projectId}:{}),...(diagnostic(diagnosticRef)?{diagnosticRef}:{}),...(/^[a-z][a-z0-9_]{1,100}$/.test(actualError||'')?{errorCode:actualError}:{}),...(Number.isSafeInteger(status)&&status>=0&&status<=599?{status}:{})};
        if(key){dedup.set(key,requestId);if(dedup.size>1000)dedup.delete(dedup.keys().next().value);}
        const ownerId=actor||viewer;const item={id:`local:${requestId}`,ownerId,localOnly,source:'client',kind,code:body.code,severity:'info',projectId:body.projectId||null,projectTitle:projectTitle||(getProject()?.id===projectId?getProject()?.title:null),createdAt:new Date().toISOString(),readAt:null,local:true,localKey:key||null,localText:String(text).slice(0,2000),...(body.errorCode?{errorCode:body.errorCode}:{}),body};
        items.set(item.id,item);if(ownerId)pending.set(requestId,item);storePending();paint();if(active&&!localOnly)void observe();
    }
    button.addEventListener('click',()=>panel.hidden?show():hide());close.addEventListener('click',()=>{hide();button.focus({preventScroll:true});});
    panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hide();button.focus({preventScroll:true});}});
    mark.addEventListener('click',()=>void acknowledge());more.addEventListener('click',()=>void observe(true));refresh.addEventListener('click',()=>void observe());
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){clearTimeout(timer);observer.disconnect();}else{paint();void observe();}});
    window.addEventListener('online',()=>{failures=0;void observe();});window.addEventListener('offline',()=>{status.textContent=copy.offline;});
    window.addEventListener('pagehide',()=>{suspended=true;controller?.abort();reading=false;clearTimeout(timer);observer.disconnect();});
    window.addEventListener('pageshow',()=>{suspended=false;paint();void observe();});
    document.addEventListener('bitbi:auth-change',event=>{const auth=event.detail||getAuthState();if(auth.sessionConfirmed){const next=auth.loggedIn?auth.user?.id||null:null;if(!next||actor&&actor!==next||viewer&&viewer!==next){reset();active=Boolean(next);}actor=next;if(active)void observe();}});
    hide();paint();center={publish,resolve:key=>dedup.delete(key),refresh:()=>void observe(),start(){active=true;status.textContent=copy.loading;void observe();},stop(){active=false;reset();}};return center;
}
