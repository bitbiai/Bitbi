import {apiAiGetGenerationJobs,apiAiRetryGenerationPreview} from './auth-api.js?v=__ASSET_VERSION__';
import {localeText} from './locale.js?v=__ASSET_VERSION__';

export function createMemberGenerationStatus(root) {
    let request=null, sequence=0, panel=null;
    async function refresh() {
        request?.abort();const own=++sequence;request=new AbortController();
        const response=await apiAiGetGenerationJobs({signal:request.signal});
        if(own!==sequence || !root?.isConnected || request.signal.aborted) return;
        panel?.remove();panel=null;
        if(response.status===401 || response.status===403) return;
        const jobs=response.data?.data?.jobs;
        if(response.ok && Array.isArray(jobs) && !jobs.length) return;
        panel=document.createElement('details');panel.dataset.generationJobs='';
        const summary=document.createElement('summary');summary.textContent=localeText('generation.title');panel.append(summary);
        if(!response.ok || !Array.isArray(jobs)) {
            const message=document.createElement('p');message.textContent=localeText('generation.unavailable');panel.append(message);
        } else {
            const list=document.createElement('ul');
            for(const job of jobs) {
                const item=document.createElement('li');
                const valid=['queued','processing','ingesting','preview_pending','succeeded','failed','outcome_unknown'].includes(job.status);
                const status=localeText(`generation.${job.asset_id && job.error_code && ['preview_pending','failed','outcome_unknown'].includes(job.status)?'previewFailed':valid?job.status:'attention'}`);
                const date=new Date(job.created_at);
                item.textContent=`${Number.isNaN(date.valueOf())?'':date.toLocaleString()} · ${status} · ${String(job.id).slice(0,8)}`;
                if(job.error_code) item.append(document.createTextNode(` (${job.error_code})`));
                if(job.status==='preview_pending' && job.error_code==='preview_retry_exhausted') {
                    const retry=document.createElement('button');retry.type='button';retry.textContent=localeText('generation.retryPreview');
                    retry.addEventListener('click',async()=>{
                        retry.disabled=true;
                        const response=await apiAiRetryGenerationPreview(job.id,{signal:request.signal});
                        if(response.ok) {await refresh();panel?.querySelector('summary')?.focus();}
                        else {retry.disabled=false;retry.textContent=localeText('generation.retryFailed');}
                    });item.append(' ',retry);
                }
                list.append(item);
            }
            panel.append(list);
        }
        root.prepend(panel);
    }
    function destroy(){sequence++;request?.abort();panel?.remove();panel=null;}
    window.addEventListener('pagehide',destroy,{once:true});
    return {refresh,destroy};
}
