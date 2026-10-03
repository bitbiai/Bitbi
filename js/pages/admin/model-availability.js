import { apiAdminModelAvailability, apiAdminModelAvailabilityChange } from '../../shared/auth-api.js?v=__ASSET_VERSION__';
const AREA={generation:'Generation Lab',canvas:'Canvas',main:'Main website'};
const TYPE={image:'Image',video:'Video',music:'Music',text:'Text',chat:'Website assistant'};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
export function createModelAvailability() {
    const root=el('section','model-availability');root.setAttribute('aria-label','Model availability');
    let models=[],query='',type='',controller=null,disposed=false;
    const pending=new Set();
    const header=el('div','model-availability__header'),intro=el('div');
    intro.append(el('p','model-availability__eyebrow','USER ACCESS'),el('h2','','Model availability'),el('p','model-availability__description','Choose where each model can be used. Changes save immediately. Existing results and Admin Lab access are preserved.'));
    const refresh=el('button','btn-action','Refresh availability');refresh.type='button';refresh.addEventListener('click',()=>void load());header.append(intro,refresh);
    const status=el('p','model-availability__status','Loading availability…');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const filters=el('div','model-availability__filters'),search=el('input'),media=el('select'),count=el('span','model-availability__count');
    search.type='search';search.placeholder='Find model or provider';search.setAttribute('aria-label','Find model or provider');
    search.addEventListener('input',()=>{query=search.value.toLowerCase();render();});
    media.setAttribute('aria-label','Model type');for(const [value,label] of [['','All types'],...Object.entries(TYPE)]){const option=el('option','',label);option.value=value;media.append(option);}
    media.addEventListener('change',()=>{type=media.value;render();});filters.append(search,media,count);
    const list=el('div','model-availability__list');root.append(header,status,filters,list);
    function notice(text,error=false){status.textContent=text;status.dataset.error=String(error);}
    function render(focus) {
        const rows=models.filter(m=>(!query||`${m.label} ${m.id} ${m.vendor}`.toLowerCase().includes(query))&&(!type||m.mediaType===type));
        count.textContent=`${rows.length} of ${models.length} models`;list.replaceChildren();
        for(const mediaType of Object.keys(TYPE)) {
            const group=rows.filter(m=>m.mediaType===mediaType);if(!group.length)continue;
            const section=el('section','model-availability__group');section.append(el('h3','',TYPE[mediaType]));
            for(const model of group) {
                const row=el('article','model-availability__row');row.dataset.availabilityModel=model.id;
                const identity=el('div','model-availability__identity');identity.append(el('strong','',model.label),el('span','',model.vendor),el('code','',model.id));row.append(identity);
                for(const [area,label] of Object.entries(AREA)) {
                    const cell=el('div','model-availability__area'),state=model.switches[area];cell.append(el('span','model-availability__area-name',label));
                    if(!state){cell.append(el('span','model-availability__na','Not applicable'));row.append(cell);continue;}
                    const key=`${model.id}:${area}`,saving=pending.has(key),button=el('button','model-availability__switch');
                    button.type='button';button.dataset.area=area;button.dataset.key=key;button.setAttribute('role','switch');button.setAttribute('aria-label',`${model.label} — ${label}`);button.setAttribute('aria-checked',String(state.enabled));
                    button.disabled=saving||state.revision===null;button.setAttribute('aria-busy',String(saving));button.append(el('span','model-availability__track'),el('span','',saving?'Saving…':state.enabled?'On':'Off'));
                    button.addEventListener('click',()=>void save(model,area));cell.append(button);
                    if(state.blockers?.length){const detail=el('details','model-availability__blockers');detail.append(el('summary','',state.enabled?'Prerequisite missing':'Activation prerequisites'));for(const reason of state.blockers)detail.append(el('p','',reason));cell.append(detail);}
                    row.append(cell);
                }
                section.append(row);
            }
            list.append(section);
        }
        if(!rows.length)list.append(el('p','','No matching models.'));
        if(focus)list.querySelector(`[data-key="${CSS.escape(focus)}"]`)?.focus();
    }
    async function load() {
        controller?.abort();const active=controller=new AbortController();refresh.disabled=true;
        const result=await apiAdminModelAvailability({signal:active.signal,timeoutMs:15000});
        if(disposed||active.signal.aborted)return;refresh.disabled=false;
        if(result.ok&&Array.isArray(result.data?.data?.models)){models=result.data.data.models.map(incoming=>{const current=models.find(m=>m.id===incoming.id);for(const [area,state] of Object.entries(incoming.switches)){if(current?.switches[area]?.revision>state.revision)incoming.switches[area]=current.switches[area];}return incoming;});notice('Saved server state. Main has one designated model; prices, readiness and account permissions still apply.');render();}
        else{models=[];render();notice([401,403,428].includes(result.status)?'Admin access or MFA could not be confirmed.':'Availability could not be loaded. Refresh before changing access.',true);}
    }
    async function save(model,area) {
        const key=`${model.id}:${area}`,state=model.switches[area];if(pending.has(key))return;
        pending.add(key);render(key);notice(`Saving ${model.label} for ${AREA[area]}…`);
        const result=await apiAdminModelAvailabilityChange({modelId:model.id,area,enabled:!state.enabled,revision:state.revision},{timeoutMs:15000});
        pending.delete(key);if(disposed)return;
        const saved=result.data?.data;
        if(result.ok&&saved?.modelId===model.id&&saved.area===area&&typeof saved.enabled==='boolean'&&Number.isSafeInteger(saved.revision)) {
            const latest=models.find(m=>m.id===model.id);if(latest&&latest.switches[area].revision<=saved.revision)latest.switches[area]={...state,enabled:saved.enabled,revision:saved.revision};
            render(key);notice(`${model.label} — ${AREA[area]} ${saved.enabled?'on':'off'}. Saved.`);
        }else {
            await load();render(key);notice(result.data?.code==='assistant_activation_blocked'?'Main remains off. Confirm access, pricing, terms, approved budget and real EN/DE acceptance first.':result.status===409?'Another edit was saved. Current state has been reloaded; choose again.':'The change was not confirmed. Current state was reloaded; no automatic retry was sent.',true);
        }
    }
    return {root,load,destroy(){disposed=true;controller?.abort();root.remove();}};
}
