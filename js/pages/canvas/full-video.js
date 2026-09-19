import { canvasApi } from './api.js?v=__ASSET_VERSION__';

export function renderCanvasFullVideo({section,output,projectId,german,signal,video}) {
    if (!output.runId) return;
    const copy=german?{
        create:'Gesamtes Video erstellen',retry:'Verarbeitung wiederholen',queued:'Gesamtvideo wartet auf Verarbeitung.',processing:'Gesamtvideo wird zusammengefügt.',
        preview_pending:'Video gespeichert. Vorschau wird erstellt.',ready:'Gesamtvideo bereit.',failed:'Verarbeitung fehlgeschlagen.',
        unavailable:'Gesamtvideo nicht verfügbar. Quellen oder Herkunft prüfen.',download:'Gesamtvideo herunterladen',poster:'Vorschau wird erstellt.',posterFailed:'Video verfügbar. Vorschau konnte nicht erstellt werden.',
        refresh:'Status aktualisieren',
    }:{create:'Create full video',retry:'Retry processing',queued:'Full video is queued.',processing:'Joining full video.',preview_pending:'Video saved. Preparing preview.',ready:'Full video ready.',failed:'Processing failed.',unavailable:'Full video unavailable. Check sources and provenance.',download:'Download full video',poster:'Preparing preview.',posterFailed:'Video available. Preview could not be created.',refresh:'Refresh status'};
    const block=document.createElement('div');block.className='canvas-full-video';section.append(block);
    const posterStatus=document.createElement('p');posterStatus.className='canvas-muted';section.append(posterStatus);
    let timer,reads=0,busy=false,resultVideo=null,previous=null,posterRetry=null;
    const originalId=output.assetId||output.asset?.id;
    signal.addEventListener('abort',()=>{clearTimeout(timer);resultVideo?.pause();},{once:true});
    async function update(create=false) {
        if(signal.aborted||busy)return;busy=true;clearTimeout(timer);
        const result=await canvasApi.fullVideo(projectId,output.runId,create,signal);
        if(signal.aborted)return;
        busy=false;
        const status=result.data?.export;
        const signature=JSON.stringify([result.ok,result.code,result.data]);
        if(signature!==previous) {
        previous=signature;
        const fragment=document.createDocumentFragment();
        if(!result.ok) {
            const message=document.createElement('p');message.textContent=`${copy.unavailable} (${result.code})`;fragment.append(message);
        } else if(result.data.eligible) {
            if(status) {const label=document.createElement('p');label.setAttribute('role','status');label.textContent=copy[status.status]||copy.failed;fragment.append(label);}
            if(!status || status.status==='failed') {
                const button=document.createElement('button');button.type='button';button.className='canvas-button canvas-button--primary';button.textContent=status?copy.retry:copy.create;
                button.addEventListener('click',()=>{button.disabled=true;void update(true);},{signal});fragment.append(button);
            }
            if(status?.asset) {
                if(!resultVideo) {resultVideo=document.createElement('video');resultVideo.controls=true;resultVideo.preload='metadata';}
                if(resultVideo.getAttribute('src')!==status.asset.file_url)resultVideo.src=status.asset.file_url;
                if(status.asset.poster_url)resultVideo.poster=status.asset.poster_url;
                fragment.append(resultVideo);
                const link=document.createElement('a');link.href=status.asset.file_url+'?download=1';link.textContent=copy.download;link.download='canvas-full-video.mp4';fragment.append(link);
            }
        }
        // Only the processing section changes; form drafts/selection stay intact.
        block.replaceChildren(fragment);
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
