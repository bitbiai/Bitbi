import {canvasApi} from './api.js?v=__ASSET_VERSION__';
import {exportRequest} from './export-request.js?v=__ASSET_VERSION__';

// A paused observation is never a cancelled/failed backend job. Recovery reads
// the exact unresolved request before another new export can be submitted.
export function exportObserver({projectId,anchor,signal,onState,onResult,needsObservation=()=>false}) {
    const journal=exportRequest(projectId,anchor);
    const state={busy:false,known:false,job:null,pending:journal.read(),paused:false,canRetry:false,reads:0};
    let timer,controller,epoch=0;
    const active=()=>['queued','processing'].includes(state.job?.status);
    const emit=()=>{if(!signal.aborted)onState(state);};
    const clearPending=key=>{if(journal.read()?.key===key)journal.clear();state.pending=journal.read();};
    async function observe({submission=null,restart=false}={}) {
        if(signal.aborted||state.busy&&!restart)return;
        if(restart){controller?.abort();state.reads=0;}
        clearTimeout(timer);const revision=++epoch;controller=new AbortController();const requestSignal=controller.signal;
        const current=()=>!signal.aborted&&epoch===revision;
        const pending=submission||journal.read();state.pending=pending;state.busy=true;state.paused=false;emit();
        try{
            const result=await canvasApi.fullVideo(projectId,anchor,Boolean(submission),requestSignal,
                submission?.body||(pending?{lookupRequestKey:pending.key}:{}),submission?.key);
            // Even when the inspector closed, a confirmed acceptance resolves
            // its own journal entry. It cannot clear a newer request's identity.
            if(submission&&(result.ok||[400,401,403,404,422].includes(result.status)||['canvas_selection_changed','video_source_changed'].includes(result.code)))clearPending(submission.key);
            if(!current())return;
            if(!submission&&pending&&result.data?.submission?.found)clearPending(pending.key);
            state.known=result.ok&&!state.pending;
            state.canRetry=Boolean(state.pending&&result.ok&&result.data?.submission?.found===false);
            state.paused=!result.ok||Boolean(state.pending);
            if(result.ok){
                const next=result.data?.export||null;
                if(next?.id!==state.job?.id)state.reads=0;
                state.job=next;
            }
            await onResult(result,{signal:requestSignal,current});
        }catch{
            if(current()){state.known=false;state.paused=true;}
        }finally{
            if(current()){
                state.busy=false;
                if(state.known&&(active()||state.job?.status==='preview_pending'||needsObservation())){
                    if(++state.reads<120)timer=setTimeout(()=>void observe(),5000);
                    else state.paused=true;
                }
                // Automatic reads and manual refresh both release request state;
                // the accepted backend job alone determines whether Create is safe.
                emit();
            }
        }
    }
    signal.addEventListener('abort',()=>{epoch++;clearTimeout(timer);controller?.abort();},{once:true});
    return {
        state,
        refresh:()=>observe({restart:true}),
        submit(body){
            if(signal.aborted||state.busy||!state.known||active()||state.pending)return;
            const submission={key:crypto.randomUUID(),body:structuredClone(body)};
            journal.save(submission);state.reads=0;return observe({submission});
        },
        retry(){if(!state.pending||!state.canRetry||state.busy)return;return observe({submission:state.pending});},
    };
}
