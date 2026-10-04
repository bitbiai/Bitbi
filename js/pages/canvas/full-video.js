import { clipSequence } from './merge-clips.js?v=__ASSET_VERSION__';
import { canvasApi } from './api.js?v=__ASSET_VERSION__';
import { createMusicPreview } from './music-preview.js?v=__ASSET_VERSION__';
import { hasAudioEffects } from '../../shared/canvas-audio.mjs?v=__ASSET_VERSION__';
import {smoothJoinControls} from './smooth-joins.js?v=__ASSET_VERSION__';
import {smoothJoinResultText} from '../../shared/canvas-smooth-joins.mjs?v=__ASSET_VERSION__';
import {audioFitResultText} from '../../shared/canvas-audio-fit.mjs?v=__ASSET_VERSION__';
import {canvasDisclosure} from './inspector-disclosure.js?v=__ASSET_VERSION__';

export function renderCanvasFullVideo({section,output,projectId,german,signal,video,music=[],sound,readSmooth=()=>false,writeSmooth=()=>{},flush=async()=>true,getGraph}) {
    const anchor=output.runId || (output.nodeId?{nodeId:output.nodeId}:null);
    if (!anchor) return;
    const copy=german?{
        create:'Gesamtes Video erstellen',retry:'Verarbeitung wiederholen',queued:'Gesamtvideo wartet auf Verarbeitung.',processing:'Gesamtvideo wird zusammengefügt.',
        preview_pending:'Video gespeichert. Vorschau wird erstellt.',ready:'Gesamtvideo bereit.',failed:'Verarbeitung fehlgeschlagen.',
        unavailable:'Gesamtvideo nicht verfügbar. Quellen oder Herkunft prüfen.',download:'Gesamtvideo herunterladen',poster:'Vorschau wird erstellt.',posterFailed:'Video verfügbar. Vorschau konnte nicht erstellt werden.',
        refresh:'Status aktualisieren',again:'Gesamtes Video erneut erstellen',music:'Musik als Hintergrund hinzufügen',volume:'Musiklautstärke',save:'Gesamtvideo in Assets speichern',saved:'Diese Version ist in Assets gespeichert.',ambiguous:'Genau eine fertige Musikquelle nur für den Export verbinden.',savingFailed:'Canvas-Einstellungen konnten nicht gespeichert werden.',
    }:{create:'Create full video',retry:'Retry processing',queued:'Full video is queued.',processing:'Joining full video.',preview_pending:'Video stored. Preparing preview.',ready:'Full video ready.',failed:'Processing failed.',unavailable:'Full video unavailable. Check sources and provenance.',download:'Download full video',poster:'Preparing preview.',posterFailed:'Video available. Preview could not be created.',refresh:'Refresh status',again:'Create full video again',music:'Add music as background',volume:'Music volume',save:'Save full video to Assets',saved:'This version is saved to Assets.',ambiguous:'Connect exactly one completed music source for export only.',savingFailed:'Canvas settings could not be saved.'};
    const block=document.createElement('div');block.className='canvas-full-video';section.append(block);
    const auditionCopy=german?{start:'Vorschau mit Musik',pause:'Vorschau pausieren',label:'Vorschau · noch nicht übernommen',create:'Gesamtes Video mit Hintergrundmusik erstellen',back:'Zurück zum erstellten Video',missing:'Musikvorschau nicht verfügbar: Für diese Version fehlt das vollständige Video ohne Hintergrundmusik. Das erstellte Video bleibt verfügbar.',error:'Die Musikvorschau konnte nicht abgespielt werden. Das erstellte Video bleibt verfügbar.',loading:'Musikvorschau wird geladen.',track:'Hintergrundmusik',choose:'Musik auswählen'}:{start:'Preview with music',pause:'Pause preview',label:'Preview · not exported',create:'Create full video with background music',back:'Return to completed video',missing:'Music preview unavailable: this version has no complete video without background music. The completed video remains available.',error:'Music preview could not play. The completed video remains available.',loading:'Loading music preview.',track:'Background music',choose:'Choose music'};
    const controls=document.createElement('div'),message=document.createElement('p'),preview=document.createElement('div');
    const fitHelp=document.createElement('p');fitHelp.className='canvas-muted';
    fitHelp.textContent=german?'Originalton wird automatisch auf die Bilddauer gekürzt oder mit Stille ergänzt. Quelldateien bleiben unverändert.':'Original audio is automatically trimmed or padded with silence to fit the picture. Source files remain unchanged.';
    controls.append(fitHelp);
    message.setAttribute('role','status');message.setAttribute('aria-label',german?'Exportstatus':'Export status');block.append(controls,message,preview);
    let selected={...sound.music},joins;
    const tracks=music.filter(m=>m.kind==='audio_asset'&&m.assetId);
    const chosen=()=>selected.musicAssetId?tracks.find(m=>m.assetId===selected.musicAssetId):(music.length===1?tracks[0]:null);
    let audition=null,auditionState='idle',completed=null,previewMode=false;
    const previewButton=document.createElement('button'),returnButton=document.createElement('button'),previewStatus=document.createElement('p'),previewNote=document.createElement('p');
    previewNote.className='canvas-muted';previewNote.textContent=german?'Herunterladen und Speichern verwenden die zuletzt erstellte Version.':'Download and Save use the last completed export.';
    previewButton.type=returnButton.type='button';previewButton.className=returnButton.className='canvas-button';
    returnButton.textContent=auditionCopy.back;previewStatus.className='canvas-muted';previewStatus.setAttribute('role','status');previewStatus.setAttribute('aria-label',german?'Musikvorschau':'Music preview');
    const legacyAudioMessage=german?'Für die Vorschau der neuen Originalton-Einstellungen dieses ältere Gesamtvideo erneut erstellen. Die gespeicherte Version bleibt unverändert.':'Create this older full video again to preview the new original-audio settings. The saved version stays unchanged.';
    const clipAudio=clip=>{
        const node=getGraph().nodes.find(node=>clip.runId?node.output?.runId===clip.runId:node.id===clip.nodeId);
        const assetId=node?.type==='asset_reference'?node.asset_id:node?.output?.assetId||node?.output?.asset?.id;
        const version=node?.type==='asset_reference'?node.content?.asset?.sourceVersion:node?.output?.sourceVersion;
        return node&&assetId===clip.assetId&&version===clip.version?node.config?.originalAudio:clip.originalAudio;
    };
    const needsAudioTimeline=()=>Boolean(completed&&!completed.audio_timeline?.length &&
        (completed.recipe?.videos||[{runId:output.runId,nodeId:output.nodeId,assetId:output.assetId,version:output.sourceVersion}]).some(clip=>hasAudioEffects(clipAudio(clip))));
    const updateButtons=()=>{
        previewButton.hidden=false;
        previewButton.textContent=['playing','loading'].includes(auditionState)?auditionCopy.pause:selected.enabled?auditionCopy.start:(german?'Toneinstellungen vorhören':'Preview sound settings');
        previewButton.disabled=Boolean(selected.enabled&&!chosen())||!completed?.preview_base?.file_url||needsAudioTimeline();
        returnButton.hidden=!previewMode;
        previewNote.hidden=!previewMode;
        if(needsAudioTimeline())previewStatus.textContent=legacyAudioMessage;
        else if(auditionState==='idle')previewStatus.textContent=tracks.length && selected.enabled && !completed?.preview_base
            ? completed?.asset ? auditionCopy.missing : german ? 'Musikvorschau erst nach Erstellung eines vollständigen Videos verfügbar.' : 'Music preview is available after a full video has been created.' : '';
        createButton.textContent=selected.enabled?auditionCopy.create:completed?copy.again:copy.create;
    };
    const restore=()=>{previewMode=false;audition?.reset();auditionState='idle';if(resultVideo&&completed?.asset){resultVideo.src=completed.asset.file_url;resultVideo.load();}updateButtons();};
    const previewTimeline=()=>{
        return completed?.audio_timeline?.map((segment,index)=>({...segment,originalAudio:clipAudio(completed.recipe.videos[index])}));
    };
    const startPreview=()=>{
        if(needsAudioTimeline() || selected.enabled&&!chosen() || !completed?.preview_base || !resultVideo)return;
        video.pause();previewMode=true;void audition.start({baseUrl:completed.preview_base.file_url,
            musicUrl:selected.enabled?(chosen().fileUrl||`/api/ai/text-assets/${chosen().assetId}/file`):null,
            gain:selected.gain,music:selected,timeline:previewTimeline()});updateButtons();
    };
    previewButton.addEventListener('click',()=>['playing','loading'].includes(auditionState)?audition.pause():startPreview(),{signal});
    returnButton.addEventListener('click',restore,{signal});
    sound.details.addEventListener('canvas:sound-change',()=>{
        const previous=selected;selected={...sound.music};audition?.setGain(selected.enabled?selected.gain:0);
        joins?.sync();
        if(needsAudioTimeline()){if(previewMode)restore();else updateButtons();return;}
        audition?.setAudio({music:selected,timeline:previewTimeline()});
        if(previewMode && (auditionState==='loading'||!resultVideo?.paused) && selected.enabled && (!previous.enabled || previous.musicAssetId!==selected.musicAssetId))startPreview();else updateButtons();
    },{signal});
    const createButton=document.createElement('button');createButton.type='button';createButton.className='canvas-button canvas-button--primary';createButton.textContent=copy.create;createButton.hidden=true;
    let sequenceBlocked=true;
    const nodeId=output.nodeId||getGraph().nodes.find(node=>node.output?.runId===output.runId)?.id||output.runId;
    const mergeSettings=canvasDisclosure([projectId,nodeId,'merge'],german?'Clips zusammenfügen':'Merge clips','canvas-merge-settings');
    controls.append(mergeSettings);
    const sequence=clipSequence(mergeSettings,anchor,german,signal,()=>{createButton.disabled=sequenceBlocked||!sequence.valid;joins?.sync();},getGraph);
    joins=smoothJoinControls({parent:mergeSettings,german,signal,projectId,anchor,read:readSmooth,write:writeSmooth,flush,sequence,settings:()=>({...selected}),getGraph,pause:()=>{video.pause();resultVideo?.pause();audition?.pause();}});
    video.addEventListener('play',()=>joins.pause(),{signal});
    controls.append(createButton);
    createButton.addEventListener('click',()=>void update(true),{signal});
    sound.previewControls.append(previewButton,returnButton,previewStatus,previewNote);updateButtons();
    const posterStatus=document.createElement('p');posterStatus.className='canvas-muted';section.append(posterStatus);
    let timer,reads=0,busy=false,resultVideo=null,previous=null,posterRetry=null,requestKey=null,requestSettings=null,requestSequence,requestMode,requestSmooth;
    const originalId=output.assetId||output.asset?.id;
    signal.addEventListener('abort',()=>{clearTimeout(timer);resultVideo?.pause();},{once:true});
    async function update(create=false) {
        if(signal.aborted||busy)return;busy=true;clearTimeout(timer);
        createButton.disabled=true;
        if(create) {
            if(!sequence.valid){busy=false;return;}
            if(selected.enabled && !chosen()){message.textContent=copy.ambiguous;busy=false;createButton.disabled=false;return;}
            if(!await flush()){message.textContent=copy.savingFailed;busy=false;createButton.disabled=false;return;}
            if(signal.aborted)return;
            if(!sequence.valid){busy=false;message.textContent=copy.unavailable;return;}
            if(!requestKey){requestKey=crypto.randomUUID();requestSettings={...selected};requestSequence=sequence.value;requestMode=sequence.mode;requestSmooth=joins.enabled;}
        }
        sequence.lock(true);
        const result=await canvasApi.fullVideo(projectId,anchor,create,signal,{backgroundMusic:requestSettings||selected,smoothJoins:requestSmooth??joins.enabled,...(requestSequence?{orderedClips:requestSequence,...(requestMode==='chain'?{mergeMode:'chain'}:{})}:{})},requestKey);
        if(signal.aborted)return;
        busy=false;
        if(create && (result.ok || (result.status>=400 && result.status<500))){requestKey=null;requestSettings=null;requestSequence=undefined;requestMode=undefined;requestSmooth=undefined;}
        sequence.lock(Boolean(requestKey));
        joins.lock(Boolean(requestKey));
        createButton.disabled=!sequence.valid;
        const status=result.data?.export;
        if(result.ok)sequence.update(result.data);
        else if(create && ['canvas_selection_changed','video_source_changed'].includes(result.code))sequence.invalidate();
        const signature=JSON.stringify([result.ok,result.code,result.data]);
        if(signature!==previous) {
        previous=signature;
        const fragment=document.createDocumentFragment();
        if(!result.ok) {
            const changed=['canvas_selection_changed','video_source_changed'].includes(result.code);
            message.textContent=`${changed?(german?'Eine ausgewählte Ausgabe wurde gelöscht oder ersetzt. Status aktualisieren und Clips erneut auswählen.':'A selected output was deleted or replaced. Refresh status and choose the clips again.'):copy.unavailable} (${result.code})`;
        } else if(result.data.eligible || status || result.data.current) {
            message.textContent=status?(copy[status.status]||copy.failed):'';
            if(status?.seam_result)message.textContent+=' '+smoothJoinResultText(status.seam_result,german);
            if(status?.audio_timeline)message.textContent+=' '+audioFitResultText(status.audio_timeline,german);
            if(status?.error_code==='canvas_audio_tail_exceeds_video')message.textContent+=' '+(german?'Diesen älteren Auftrag durch einen neuen Export ersetzen. Der Originalton wird jetzt automatisch an die Bilddauer angepasst.':'Create a new export to replace this older failed job. Original audio now fits the picture duration automatically.');
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
                    resultVideo.addEventListener('loadedmetadata',()=>sound.setExportDuration(resultVideo.duration),{signal});
                    audition=createMusicPreview({video:resultVideo,signal,onState:state=>{auditionState=state;previewStatus.textContent=state==='loading'?auditionCopy.loading:state==='error'?auditionCopy.error:previewMode?auditionCopy.label:'';updateButtons();}});
                    resultVideo.addEventListener('play',()=>{video.pause();joins.pause();},{signal});
                    video.addEventListener('play',()=>{if(previewMode)audition.pause();resultVideo.pause();joins.pause();},{signal});
                }
                if(!previewMode && resultVideo.getAttribute('src')!==current.asset.file_url){resultVideo.src=current.asset.file_url;resultVideo.removeAttribute('poster');}
                if(current.asset.poster_url)resultVideo.poster=current.asset.poster_url;
                fragment.append(resultVideo);
                const link=document.createElement('a');link.href=current.asset.file_url+'?download=1';link.textContent=copy.download;link.download='canvas-full-video.mp4';fragment.append(link);
                if(current.storage==='canvas') {
                    const save=document.createElement('button');save.type='button';save.className='canvas-button';save.textContent=copy.save;
                    save.addEventListener('click',async()=>{save.disabled=true;const saved=await canvasApi.fullVideo(projectId,anchor,true,signal,{saveExportId:current.id});if(signal.aborted)return;if(saved.ok){message.textContent=copy.saved;void update();}else{message.textContent=copy.unavailable;save.disabled=false;}},{signal});fragment.append(save);
                }
                preview.replaceChildren(fragment);
            }
            updateButtons();
        }
        // Only the processing section changes; form drafts/selection stay intact.
        }
        if(result.ok){sequenceBlocked=['queued','processing'].includes(status?.status);sequence.lock(sequenceBlocked||Boolean(requestKey));createButton.hidden=!result.data.eligible&&!sequence.available;createButton.disabled=!sequence.valid||sequenceBlocked;}
        if(output.runId && originalId && !output.previewUrl) {
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
        if(++reads<120 && (output.runId&&!output.previewUrl || ['queued','processing','preview_pending'].includes(status?.status)))timer=setTimeout(()=>void update(),5000);
    }
    const refresh=document.createElement('button');refresh.type='button';refresh.className='canvas-btn';refresh.textContent=copy.refresh;
    refresh.addEventListener('click',()=>{reads=0;void update();},{signal});section.append(refresh);
    void update();
}
