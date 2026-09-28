import { canvasApi } from './api.js?v=__ASSET_VERSION__';
import { createMusicPreview } from './music-preview.js?v=__ASSET_VERSION__';

export function renderCanvasFullVideo({section,output,projectId,german,signal,video,music=[],settings,onSettings=()=>{},flush=async()=>true}) {
    if (!output.runId) return;
    const copy=german?{
        create:'Gesamtes Video erstellen',retry:'Verarbeitung wiederholen',queued:'Gesamtvideo wartet auf Verarbeitung.',processing:'Gesamtvideo wird zusammengefügt.',
        preview_pending:'Video gespeichert. Vorschau wird erstellt.',ready:'Gesamtvideo bereit.',failed:'Verarbeitung fehlgeschlagen.',
        unavailable:'Gesamtvideo nicht verfügbar. Quellen oder Herkunft prüfen.',download:'Gesamtvideo herunterladen',poster:'Vorschau wird erstellt.',posterFailed:'Video verfügbar. Vorschau konnte nicht erstellt werden.',
        refresh:'Status aktualisieren',again:'Gesamtes Video erneut erstellen',music:'Musik als Hintergrund hinzufügen',volume:'Musiklautstärke',save:'Gesamtvideo in Assets speichern',saved:'Diese Version ist in Assets gespeichert.',ambiguous:'Genau eine fertige Musikquelle nur für den Export verbinden.',savingFailed:'Canvas-Einstellungen konnten nicht gespeichert werden.',
    }:{create:'Create full video',retry:'Retry processing',queued:'Full video is queued.',processing:'Joining full video.',preview_pending:'Video stored. Preparing preview.',ready:'Full video ready.',failed:'Processing failed.',unavailable:'Full video unavailable. Check sources and provenance.',download:'Download full video',poster:'Preparing preview.',posterFailed:'Video available. Preview could not be created.',refresh:'Refresh status',again:'Create full video again',music:'Add music as background',volume:'Music volume',save:'Save full video to Assets',saved:'This version is saved to Assets.',ambiguous:'Connect exactly one completed music source for export only.',savingFailed:'Canvas settings could not be saved.'};
    const block=document.createElement('div');block.className='canvas-full-video';section.append(block);
    const auditionCopy=german?{start:'Vorschau mit Musik',pause:'Vorschau pausieren',label:'Vorschau · noch nicht übernommen',create:'Gesamtes Video mit Hintergrundmusik erstellen',back:'Zurück zum erstellten Video',missing:'Musikvorschau nicht verfügbar: Für diese Version fehlt das vollständige Video ohne Hintergrundmusik. Das erstellte Video bleibt verfügbar.',error:'Die Musikvorschau konnte nicht abgespielt werden. Das erstellte Video bleibt verfügbar.',loading:'Musikvorschau wird geladen.',track:'Hintergrundmusik',choose:'Musik auswählen'}:{start:'Preview with music',pause:'Pause preview',label:'Preview · not exported',create:'Create full video with background music',back:'Return to completed video',missing:'Music preview unavailable: this version has no complete video without background music. The completed video remains available.',error:'Music preview could not play. The completed video remains available.',loading:'Loading music preview.',track:'Background music',choose:'Choose music'};
    const controls=document.createElement('div'),message=document.createElement('p'),preview=document.createElement('div');
    message.setAttribute('role','status');message.setAttribute('aria-label',german?'Exportstatus':'Export status');block.append(controls,message,preview);
    let selected={enabled:settings?.enabled===true,gain:Number.isFinite(settings?.gain)?Math.max(0,Math.min(1,settings.gain)):1,...(settings?.musicAssetId?{musicAssetId:settings.musicAssetId}:{})};
    const tracks=music.filter(m=>m.kind==='audio_asset'&&m.assetId);
    const chosen=()=>selected.musicAssetId?tracks.find(m=>m.assetId===selected.musicAssetId):(music.length===1?tracks[0]:null);
    let audition=null,auditionState='idle',completed=null,previewMode=false;
    const previewButton=document.createElement('button'),returnButton=document.createElement('button'),previewStatus=document.createElement('p'),previewNote=document.createElement('p');
    previewNote.className='canvas-muted';previewNote.textContent=german?'Herunterladen und Speichern verwenden die zuletzt erstellte Version.':'Download and Save use the last completed export.';
    previewButton.type=returnButton.type='button';previewButton.className=returnButton.className='canvas-button';
    returnButton.textContent=auditionCopy.back;previewStatus.className='canvas-muted';previewStatus.setAttribute('role','status');previewStatus.setAttribute('aria-label',german?'Musikvorschau':'Music preview');
    const updateButtons=()=>{
        previewButton.hidden=!tracks.length&&!selected.enabled;
        previewButton.textContent=['playing','loading'].includes(auditionState)?auditionCopy.pause:auditionCopy.start;
        previewButton.disabled=!chosen()||!selected.enabled||!completed?.preview_base?.file_url;
        returnButton.hidden=!previewMode;
        previewNote.hidden=!previewMode;
        if(auditionState==='idle')previewStatus.textContent=completed?.asset && tracks.length && !completed.preview_base?auditionCopy.missing:'';
        createButton.textContent=selected.enabled?auditionCopy.create:completed?copy.again:copy.create;
    };
    const restore=()=>{previewMode=false;audition?.reset();auditionState='idle';if(resultVideo&&completed?.asset){resultVideo.src=completed.asset.file_url;resultVideo.load();}updateButtons();};
    const startPreview=()=>{
        if(!chosen() || !completed?.preview_base || !selected.enabled || !resultVideo)return;
        video.pause();previewMode=true;void audition.start({baseUrl:completed.preview_base.file_url,musicUrl:chosen().fileUrl||`/api/ai/text-assets/${chosen().assetId}/file`,gain:selected.gain});updateButtons();
    };
    previewButton.addEventListener('click',()=>['playing','loading'].includes(auditionState)?audition.pause():startPreview(),{signal});
    returnButton.addEventListener('click',restore,{signal});
    if(music.length || selected.enabled) {
        const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=selected.enabled;check.disabled=!tracks.length&&!selected.enabled;
        label.className='canvas-field';
        label.append(check,document.createTextNode(copy.music));controls.append(label);
        const volume=document.createElement('label'),slider=document.createElement('input'),value=document.createElement('output');
        slider.type='range';slider.min='0';slider.max='100';slider.step='1';slider.value=String(Math.round(selected.gain*100));
        volume.className='canvas-field';slider.setAttribute('aria-valuetext',`${slider.value}%`);
        value.textContent=`${slider.value}%`;volume.append(document.createTextNode(copy.volume+' '),slider,value);controls.append(volume);
        const change=()=>{selected={...selected,enabled:check.checked,gain:Number(slider.value)/100};value.textContent=`${slider.value}%`;slider.setAttribute('aria-valuetext',value.textContent);audition?.setGain(selected.gain);if(!selected.enabled&&previewMode)restore();onSettings(selected);updateButtons();};
        check.addEventListener('change',change,{signal});slider.addEventListener('input',change,{signal});
        if(music.length>1) {
            const label=document.createElement('label'),select=document.createElement('select');label.className='canvas-field';label.append(document.createTextNode(auditionCopy.track),select);
            const empty=document.createElement('option');empty.value='';empty.textContent=auditionCopy.choose;select.append(empty);
            for(const track of tracks){const option=document.createElement('option');option.value=track.assetId;option.textContent=track.sourceTitle;select.append(option);}select.value=selected.musicAssetId||'';
            select.addEventListener('change',()=>{const playing=['playing','loading'].includes(auditionState);if(select.value)selected.musicAssetId=select.value;else delete selected.musicAssetId;audition?.pause();onSettings(selected);if(previewMode&&chosen()&&playing)startPreview();else if(!chosen())restore();updateButtons();},{signal});controls.append(label);
        }
        if(!tracks.length){const warning=document.createElement('p');warning.textContent=copy.ambiguous;controls.append(warning);}
        const help=document.createElement('p');help.className='canvas-muted';help.textContent=german?'100% = Originalpegel der Musik vor dem Übersteuerungsschutz. Der Videoton bleibt erhalten. Die Vorschau ändert kein gespeichertes Video und kann etwas anders klingen als der Export.':'100% = original music level before peak protection. Original video sound is retained. Preview does not change a saved video and may sound slightly different from the export.';controls.append(help);
    }
    const createButton=document.createElement('button');createButton.type='button';createButton.className='canvas-button canvas-button--primary';createButton.textContent=copy.create;createButton.hidden=true;controls.append(createButton);
    createButton.addEventListener('click',()=>void update(true),{signal});
    controls.append(previewButton,returnButton,previewStatus,previewNote);updateButtons();
    const posterStatus=document.createElement('p');posterStatus.className='canvas-muted';section.append(posterStatus);
    let timer,reads=0,busy=false,resultVideo=null,previous=null,posterRetry=null,requestKey=null,requestSettings=null;
    const originalId=output.assetId||output.asset?.id;
    signal.addEventListener('abort',()=>{clearTimeout(timer);resultVideo?.pause();},{once:true});
    async function update(create=false) {
        if(signal.aborted||busy)return;busy=true;clearTimeout(timer);
        createButton.disabled=true;
        if(create) {
            if(selected.enabled && !chosen()){message.textContent=copy.ambiguous;busy=false;createButton.disabled=false;return;}
            if(!await flush()){message.textContent=copy.savingFailed;busy=false;createButton.disabled=false;return;}
            if(signal.aborted)return;
            if(!requestKey){requestKey=crypto.randomUUID();requestSettings={...selected};}
        }
        const result=await canvasApi.fullVideo(projectId,output.runId,create,signal,{backgroundMusic:requestSettings||selected},requestKey);
        if(signal.aborted)return;
        busy=false;
        if(create && (result.ok || (result.status>=400 && result.status<500))){requestKey=null;requestSettings=null;}
        createButton.disabled=false;
        const status=result.data?.export;
        const signature=JSON.stringify([result.ok,result.code,result.data]);
        if(signature!==previous) {
        previous=signature;
        const fragment=document.createDocumentFragment();
        if(!result.ok) {
            message.textContent=`${copy.unavailable} (${result.code})`;
        } else if(result.data.eligible) {
            message.textContent=status?(copy[status.status]||copy.failed):'';
            createButton.hidden=false;createButton.textContent=status?copy.again:copy.create;
            createButton.disabled=['queued','processing'].includes(status?.status);
            const current=result.data.current||status;
            if(current?.asset && current.storage==='assets')message.textContent+=' '+copy.saved;
            if(current?.asset) {
                if(completed?.id!==current.id && previewMode)restore();
                completed=current;
                if(!resultVideo) {
                    resultVideo=document.createElement('video');resultVideo.controls=true;resultVideo.preload='metadata';
                    // Metadata must not move Save between pointer-down and up.
                    // Existing object-fit:contain preserves every source ratio.
                    resultVideo.style.aspectRatio='16 / 9';resultVideo.style.display='block';
                    audition=createMusicPreview({video:resultVideo,signal,onState:state=>{auditionState=state;previewStatus.textContent=state==='loading'?auditionCopy.loading:state==='error'?auditionCopy.error:previewMode?auditionCopy.label:'';updateButtons();}});
                    resultVideo.addEventListener('play',()=>video.pause(),{signal});
                    video.addEventListener('play',()=>{if(previewMode)audition.pause();resultVideo.pause();},{signal});
                }
                if(!previewMode && resultVideo.getAttribute('src')!==current.asset.file_url){resultVideo.src=current.asset.file_url;resultVideo.removeAttribute('poster');}
                if(current.asset.poster_url)resultVideo.poster=current.asset.poster_url;
                fragment.append(resultVideo);
                const link=document.createElement('a');link.href=current.asset.file_url+'?download=1';link.textContent=copy.download;link.download='canvas-full-video.mp4';fragment.append(link);
                if(current.storage==='canvas') {
                    const save=document.createElement('button');save.type='button';save.className='canvas-button';save.textContent=copy.save;
                    save.addEventListener('click',async()=>{save.disabled=true;const saved=await canvasApi.fullVideo(projectId,output.runId,true,signal,{saveExportId:current.id});if(signal.aborted)return;if(saved.ok){message.textContent=copy.saved;void update();}else{message.textContent=copy.unavailable;save.disabled=false;}},{signal});fragment.append(save);
                }
                preview.replaceChildren(fragment);
            }
            updateButtons();
        }
        // Only the processing section changes; form drafts/selection stay intact.
        }
        if(originalId && !output.previewUrl) {
            const project=await canvasApi.getProject(projectId,signal);
            if(signal.aborted)return;
            const current=project.data?.runs?.find(r=>r.id===output.runId)?.output;
            if(current?.previewUrl) {output.previewUrl=current.previewUrl;video.poster=current.previewUrl;posterStatus.textContent='';}
            else {
              posterStatus.textContent=current?.posterStatus==='failed'?copy.posterFailed:copy.poster;
              if(current?.posterStatus==='failed' && !posterRetry) {
                posterRetry=document.createElement('button');posterRetry.type='button';posterRetry.className='canvas-btn';posterRetry.textContent=copy.retry;
                posterRetry.addEventListener('click',async()=>{posterRetry.disabled=true;const retry=await canvasApi.retryPoster(originalId,signal);if(signal.aborted)return;if(retry.ok){posterRetry.remove();posterRetry=null;reads=0;void update();}else{posterStatus.textContent=copy.posterFailed;posterRetry.disabled=false;}},{signal});section.append(posterRetry);
              }
            }
        }
        if(++reads<120 && (!output.previewUrl || ['queued','processing','preview_pending'].includes(status?.status)))timer=setTimeout(()=>void update(),5000);
    }
    const refresh=document.createElement('button');refresh.type='button';refresh.className='canvas-btn';refresh.textContent=copy.refresh;
    refresh.addEventListener('click',()=>{reads=0;void update();},{signal});section.append(refresh);
    void update();
}
