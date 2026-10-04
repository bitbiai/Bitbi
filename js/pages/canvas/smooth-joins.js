import {canvasApi} from './api.js?v=__ASSET_VERSION__';
import {smoothJoinResultText} from '../../shared/canvas-smooth-joins.mjs?v=__ASSET_VERSION__';

export function smoothJoinControls({parent,german,signal,projectId,anchor,read,write,flush,sequence,settings,getGraph,pause}) {
    const box=document.createElement('div');box.className='canvas-smooth-joins';
    const label=document.createElement('label'),input=document.createElement('input'),help=document.createElement('p');
    input.type='checkbox';input.checked=read()===true;
    label.append(input,document.createTextNode(german?'Sanft zusammenführen':'Smooth joins'));
    help.textContent=german?'Reduziert kurze Ruckler zwischen zusammenhängenden Clips. Keine Überblendung.':'Reduces short jerks between continuation clips. No crossfade.';
    help.className='canvas-muted';help.id='smooth-help-'+crypto.randomUUID();input.setAttribute('aria-describedby',help.id);
    const button=document.createElement('button');button.type='button';button.className='canvas-button';button.textContent=german?'Übergang vergleichen':'Compare join';
    const seamLabel=document.createElement('label'),seam=document.createElement('select');seam.className='canvas-select';
    seamLabel.className='canvas-field';seamLabel.append(document.createTextNode(german?'Übergang für den Vergleich':'Join to compare'),seam);
    const status=document.createElement('p');status.className='canvas-muted';status.setAttribute('role','status');
    status.setAttribute('aria-label',german?'Übergangsvorschau':'Join preview');
    const comparison=document.createElement('div');comparison.hidden=true;
    box.append(label,help,seamLabel,button,status,comparison);parent.append(box);
    let version='',job=null,key=null,timer=null,reads=0,busy=false,locked=false,player=null;
    const signature=()=>JSON.stringify([input.checked,sequence.valid?sequence.value:null,sequence.mode,settings(),Number(seam.value),
        getGraph().nodes.map(n=>[n.id,n.config?.originalAudio,n.asset_id,n.output?.sourceVersion,n.content?.asset?.sourceVersion])]);
    const clear=()=>{clearTimeout(timer);player?.pause();comparison.replaceChildren();comparison.hidden=true;player=null;job=null;key=null;reads=0;};
    function sync() {
        const valid=sequence.valid,count=valid?sequence.value.length-1:0;
        if(seam.options.length!==count) {
            const selected=seam.value||'0';seam.replaceChildren();
            for(let i=0;i<count;i++){const option=document.createElement('option');option.value=String(i);option.textContent=`Clip ${i+1} → ${i+2}`;seam.append(option);}
            if(Number(selected)<count)seam.value=selected;
        }
        seamLabel.hidden=count<=1;
        const next=signature();if(next!==version){clear();status.textContent='';version=next;}
        input.disabled=locked;seam.disabled=busy||locked;
        button.disabled=!input.checked||!valid||busy||locked;
        button.hidden=!input.checked;
    }
    input.addEventListener('change',()=>{write(input.checked);sync();},{signal});
    seam.addEventListener('change',sync,{signal});
    document.addEventListener('canvas:merge-state',sync,{signal});
    const render=result=>{
        if(!result.asset||!result.preview_base)return;
        comparison.replaceChildren();comparison.hidden=false;
        const modes=document.createElement('div');modes.setAttribute('role','group');modes.setAttribute('aria-label',german?'Vorher und nachher':'Before and after');
        player=document.createElement('video');player.controls=true;player.preload='metadata';player.style.aspectRatio='16 / 9';
        player.setAttribute('aria-label',german?'Kurzer Übergangsvergleich':'Short join comparison');
        player.addEventListener('play',pause,{signal});
        const buttons=[];
        for(const [text,url] of [[german?'Vorher':'Before',result.preview_base.file_url],[german?'Nachher':'After',result.asset.file_url]]) {
            const tab=document.createElement('button');tab.type='button';tab.className='canvas-button';tab.textContent=text;buttons.push(tab);
            tab.addEventListener('click',()=>{
                const at=player.currentTime||0;player.pause();player.src=url;
                player.addEventListener('loadedmetadata',()=>{player.currentTime=Math.min(at,Math.max(0,player.duration-.01));},{once:true,signal});
                for(const other of buttons)other.setAttribute('aria-pressed',String(other===tab));
            },{signal});modes.append(tab);
        }
        buttons[0].setAttribute('aria-pressed','true');buttons[1].setAttribute('aria-pressed','false');player.src=result.preview_base.file_url;
        const note=document.createElement('p');note.className='canvas-muted';note.textContent=german?'Kurzer Vergleich mit den gewählten Toneinstellungen. Das Gesamtvideo bleibt unverändert.':'Short comparison with the selected sound settings. The full export remains unchanged.';
        comparison.append(modes,player,note);
    };
    async function update(create) {
        if(signal.aborted||busy||locked||!sequence.valid||!input.checked)return;
        sync();busy=true;button.disabled=true;
        if(create&&!await flush()){status.textContent=german?'Canvas-Einstellungen konnten nicht gespeichert werden.':'Canvas settings could not be saved.';busy=false;sync();return;}
        sync();const requestVersion=version;
        if(create&&!key)key=crypto.randomUUID();
        const body={backgroundMusic:settings(),orderedClips:sequence.value,...(sequence.mode==='chain'?{mergeMode:'chain'}:{}),smoothJoins:true,preview:{seamIndex:Number(seam.value)}};
        status.textContent=german?'Kurzer Übergang wird vorbereitet.':'Preparing the short join comparison.';
        const response=create?await canvasApi.fullVideo(projectId,anchor,true,signal,body,key):await canvasApi.seamPreview(projectId,anchor,job.id,signal);
        busy=false;if(signal.aborted||signature()!==requestVersion){sync();return;}
        if(!response.ok){status.textContent=(german?'Vergleich nicht verfügbar.':'Comparison unavailable.')+` (${response.code})`;if(response.status>=400&&response.status<500)key=null;sync();return;}
        job=response.data.preview;key=null;
        if(job?.asset){status.textContent=smoothJoinResultText(job.seam_result,german);render(job);}
        else if(job?.status==='failed')status.textContent=(german?'Verarbeitung fehlgeschlagen: ':'Processing failed: ')+(job.error_code||'canvas_processing_failed');
        else if(++reads<120)timer=setTimeout(()=>void update(false),5000);
        else status.textContent=german?'Die Verarbeitung läuft weiter. Vergleich erneut öffnen.':'Processing continues. Open the comparison again.';
        sync();
    }
    button.addEventListener('click',()=>void update(true),{signal});
    signal.addEventListener('abort',clear,{once:true});
    return {sync,lock(value){locked=value;sync();},pause(){player?.pause();},get enabled(){return input.checked;}};
}
