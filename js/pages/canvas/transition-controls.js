import {TRANSITIONS,transitionSettings} from '../../shared/canvas-transitions.mjs?v=__ASSET_VERSION__';
import {canvasClipIdentity,canvasNodeMediaKind,exportMusicSettings,sameCanvasClip} from '../../shared/canvas-export.mjs?v=__ASSET_VERSION__';
import {canvasApi} from './api.js?v=__ASSET_VERSION__';

export function transitionControls({parent,edge,nodes,projectId,german,signal,onSaved,flush}) {
    const source=nodes.find(n=>n.id===edge.source_node_id),target=nodes.find(n=>n.id===edge.target_node_id);
    if([source,target].some(n=>canvasNodeMediaKind(n)!=='video'))return;
    const fieldset=document.createElement('fieldset');fieldset.className='canvas-transition-controls';
    const legend=document.createElement('legend');legend.textContent=german?'Videoübergang · Export':'Video transition · export';fieldset.append(legend);
    const field=(label,element)=>{const wrap=document.createElement('label');wrap.className='canvas-field';wrap.append(document.createTextNode(label),element);fieldset.append(wrap);return wrap;};
    const select=document.createElement('select');select.className='canvas-select';
    const groups=german?{none:'Schnitt',dissolve:'Überblendungen',blur:'Unschärfe',motion:'Zoom & Schwenk',light:'Licht'}:{none:'Cut',dissolve:'Dissolves',blur:'Blurs',motion:'Zoom & pan',light:'Lights'};
    for(const [key,label] of Object.entries(groups)){const group=document.createElement('optgroup');group.label=label;for(const effect of TRANSITIONS.filter(t=>t.group===key)){const o=document.createElement('option');o.value=effect.id;o.textContent=german?effect.de:effect.en;group.append(o);}select.append(group);}
    field(german?'Effekt':'Effect',select);
    const duration=document.createElement('input');duration.type='number';duration.className='canvas-input';duration.min='.1';duration.max='2';duration.step='.05';
    const durationField=field(german?'Überlappung (Sekunden)':'Overlap (seconds)',duration);
    const strength=document.createElement('input');strength.type='number';strength.className='canvas-input';const strengthField=field(german?'Intensität':'Intensity',strength);
    const explanation=document.createElement('p');explanation.className='canvas-muted';explanation.textContent=german?'Nur für dieses benachbarte Clip-Paar im Export. Die Überlappung verkürzt das Video; beide Originaltöne werden mit ergänzenden linearen Lautstärken überblendet. Sanft zusammenführen bleibt an anderen Schnitten wirksam.':'Only for this adjacent clip pair in the export. Overlap shortens the video; source audio uses complementary linear crossfades. Smooth joins remains active at other cuts.';
    const status=document.createElement('p');status.setAttribute('role','status');status.className='canvas-muted';
    const preview=document.createElement('button');preview.type='button';preview.className='canvas-button';preview.textContent=german?'Übergangsvorschau erstellen':'Preview transition';
    const output=document.createElement('div');output.className='canvas-transition-preview';fieldset.append(explanation,status,preview,output);parent.append(fieldset);
    let saved=transitionSettings(edge.config?.transition),pending=false,key=null,job=null,timer=null,reads=0,revision=0;
    function invalidate(){revision++;clearTimeout(timer);output.querySelector('video')?.pause();output.replaceChildren();key=null;job=null;reads=0;}
    function paint(){select.value=saved.preset;duration.value=String(saved.duration||.5);const preset=TRANSITIONS.find(p=>p.id===saved.preset);durationField.hidden=preset.id==='none';strengthField.hidden=!preset.parameter;if(preset.parameter){strength.min=String(preset.min);strength.max=String(preset.max);strength.step=preset.min<1?'.01':'1';strength.value=String(saved.strength??preset.default);}preview.disabled=pending||saved.preset==='none';select.disabled=duration.disabled=strength.disabled=pending;}
    async function save(changedPreset=false){
        if(pending)return;let next;
        try{const preset=TRANSITIONS.find(p=>p.id===select.value);next=transitionSettings({preset:preset.id,...(preset.id!=='none'?{duration:Number(duration.value)}:{}),...(preset.parameter?{strength:changedPreset?preset.default:Number(strength.value)}:{})});}
        catch{paint();status.textContent=german?'Ungültige Einstellung. Letzter gespeicherter Wert bleibt aktiv.':'Invalid setting. The last saved value remains active.';return;}
        const config={...edge.config,transition:next};pending=true;invalidate();paint();status.textContent=german?'Wird gespeichert…':'Saving…';
        const result=await canvasApi.updateEdge(projectId,edge.id,{config});if(signal.aborted)return;
        pending=false;if(result.ok){saved=next;Object.assign(edge,result.data.edge);onSaved();status.textContent=german?'Gespeichert':'Saved';}else status.textContent=result.error|| (german?'Nicht gespeichert':'Not saved');paint();
    }
    select.addEventListener('change',()=>void save(true),{signal});duration.addEventListener('change',()=>void save(),{signal});strength.addEventListener('change',()=>void save(),{signal});
    async function render(result,version){
        if(signal.aborted||revision!==version)return;
        const current=result.data?.preview;if(!result.ok||current?.status==='failed'){pending=false;paint();status.textContent=result.error||current?.error_code||(german?'Vorschau fehlgeschlagen.':'Preview failed.');return;}
        job=current?.id;
        if(current?.asset?.file_url){pending=false;paint();const video=document.createElement('video');video.controls=true;video.preload='metadata';video.src=current.asset.file_url;video.setAttribute('aria-label',german?'Übergangsvorschau':'Transition preview');output.replaceChildren(video);status.textContent=(german?'Vorschau · ':'Preview · ')+Number(current.duration).toFixed(2)+' s';return;}
        if(++reads>=120){pending=false;paint();status.textContent=german?'Vorschau verarbeitet noch. Erneut prüfen.':'Preview is still processing. Check again.';return;}
        timer=setTimeout(async()=>render(await canvasApi.seamPreview(projectId,target.output?.runId||{nodeId:target.id},job,signal),version),5000);
    }
    preview.addEventListener('click',async()=>{
        if(pending||!await flush())return;pending=true;paint();status.textContent=german?'Vorschau wird vorbereitet…':'Preparing preview…';const version=revision;
        const anchor=target.output?.runId||{nodeId:target.id};
        if(job){void render(await canvasApi.seamPreview(projectId,anchor,job,signal),version);return;}
        const view=await canvasApi.fullVideo(projectId,anchor,false,signal);if(signal.aborted||version!==revision)return;
        const clips=[source,target].map(n=>view.data?.availableClips?.find(c=>c.nodeId===n.id));
        if(!view.ok||clips.some(c=>!c)||clips[1].includedSources?.some(parent=>sameCanvasClip(parent,clips[0]))){pending=false;paint();status.textContent=german?'Kein eigenständiger Exportübergang: Eine Ausgabe fehlt oder ist bereits im Folgeclip enthalten.':'No independent export boundary: an output is missing or already included in the following clip.';return;}
        key||=crypto.randomUUID();const result=await canvasApi.fullVideo(projectId,anchor,true,signal,{orderedClips:clips.map(canvasClipIdentity),smoothJoins:false,preview:{seamIndex:0},backgroundMusic:exportMusicSettings(target.config?.backgroundMusic)},key);void render(result,version);
    },{signal});
    signal.addEventListener('abort',invalidate,{once:true});paint();
}
