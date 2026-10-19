import {canvasApi} from './api.js?v=__ASSET_VERSION__';
import {exportRequest} from './export-request.js?v=__ASSET_VERSION__';

// Observation never owns rendering. Reconnect with GET and the original request
// identity; only an explicit Retry can replay a submission with that same key.
export function exportObserver({projectId,anchor,signal,onState,onResult,needsObservation=()=>false}) {
    const journal=exportRequest(projectId,anchor);
    const state={busy:false,known:false,job:null,pending:journal.read(),paused:false,reconnecting:false,canRetry:false,reads:0};
    let timer,controller,epoch=0,failures=0,retryRead=false,suspended=false;
    const active=()=>['queued','processing'].includes(state.job?.status);
    const visible=()=>!suspended&&document.visibilityState!=='hidden'&&navigator.onLine!==false;
    const waiting=()=>Boolean(state.pending)||active()||state.job?.status==='preview_pending'||state.job?.status!=='failed'&&needsObservation();
    const emit=()=>{if(!signal.aborted)onState(state);};
    const clearPending=key=>{if(journal.read()?.key===key)journal.clear();state.pending=journal.read();};
    const schedule=()=>{
        clearTimeout(timer);
        if(signal.aborted||!visible()||state.paused&&!retryRead||!retryRead&&!waiting())return;
        // Slow down long exports without abandoning them. HTTP failures use
        // bounded backoff; neither path creates or retries a render request.
        const delay=failures?Math.min(60000,5000*2**Math.min(failures-1,4)):state.pending||state.job?.processing?.blocked||state.reads>=120?30000:5000;
        timer=setTimeout(()=>void observe(),delay);
    };
    async function observe({submission=null,restart=false}={}) {
        if(signal.aborted||state.busy&&!restart)return;
        if(restart)controller?.abort();
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
            retryRead=!result.ok&&(result.status===0||[408,429].includes(result.status)||result.status>=500);
            failures=retryRead?failures+1:0;
            state.paused=!result.ok;state.reconnecting=retryRead;
            if(result.ok){
                const next=result.data?.export||null;
                if(next?.id!==state.job?.id)state.reads=0;
                state.job=next;
            }
            await onResult(result,{signal:requestSignal,current});
        }catch{
            if(current()){state.known=false;state.paused=true;state.reconnecting=true;retryRead=true;failures++;}
        }finally{
            if(current()){
                state.busy=false;
                if(state.known)state.reads++;
                schedule();
                // Automatic reads and manual refresh both release request state;
                // the accepted backend job alone determines whether Create is safe.
                emit();
            }
        }
    }
    const reconnect=()=>{if(visible()&&(retryRead||!state.paused&&waiting()))void observe();};
    window.addEventListener('online',reconnect,{signal});
    window.addEventListener('offline',()=>clearTimeout(timer),{signal});
    document.addEventListener('visibilitychange',()=>{if(visible())reconnect();else clearTimeout(timer);},{signal});
    window.addEventListener('pagehide',()=>{suspended=true;clearTimeout(timer);},{signal});
    window.addEventListener('pageshow',()=>{suspended=false;reconnect();},{signal});
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
