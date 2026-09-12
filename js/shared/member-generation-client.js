import { localeText } from './locale.js?v=__ASSET_VERSION__';

// Only opaque request identity and a digest are retained; jobs/results live on
// the server. A lost acceptance response must reuse the same paid operation.
const intents = new Map();
const sleep = (ms,signal) => new Promise(resolve=>{
    const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};
    const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});
    if(signal?.aborted) done();
});
async function intent(request,kind,body,options) {
    const me=await request('GET','/me',undefined,{signal:options.signal});
    const owner=me.data?.user?.id;
    if(!me.ok || !owner) return {error:me.ok ? {ok:false,status:401,error:localeText('generation.signIn')} : me};
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([owner,kind,body])));
    const name='bitbi-generation:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    let key=intents.get(name);
    try {key ||= localStorage.getItem(name);} catch {}
    if(!key || !/^[a-f0-9-]{36}$/.test(key)) key=crypto.randomUUID();
    intents.set(name,key);
    try {localStorage.setItem(name,key);} catch {}
    return {key,clear(){intents.delete(name);try{localStorage.removeItem(name);}catch{}}};
}
export async function runMemberGeneration(request,kind,body,options={}) {
    if(options.durable!==true) return request('POST',`/ai/generate-${kind}`,body,options);
    const current=await intent(request,kind,body,options);
    if(current.error) return current.error;
    const accepted=await request('POST',`/ai/generate-${kind}`,body,{...options,headers:{...options.headers,'Idempotency-Key':current.key,Prefer:'respond-async'}});
    const job=accepted.data?.data?.job;
    if(!accepted.ok || accepted.status!==202 || !job?.id) return accepted;
    window.dispatchEvent(new CustomEvent('bitbi:generation-accepted',{detail:{id:job.id}}));
    options.onAccepted?.(job);
    const observer=new AbortController();
    const stop=()=>observer.abort();
    window.addEventListener('pagehide',stop,{once:true});options.signal?.addEventListener('abort',stop,{once:true});
    const deadline=Date.now()+10*60_000; // observation limit only; never cancels the backend job
    try {
        while(!observer.signal.aborted && Date.now()<deadline) {
            const state=await request('GET',`/ai/generation-jobs/${encodeURIComponent(job.id)}`,undefined,{signal:observer.signal});
            if(!state.ok) return state;
            const data=state.data?.data;
            if(data?.result?.ok && (data.job.status==='succeeded'||data.job.status==='preview_pending')) {
                current.clear();
                return {ok:true,status:200,data:{...data.result,data:{...data.result.data,generationJob:data.job}}};
            }
            if(['failed','outcome_unknown'].includes(data?.job?.status)) return {ok:false,job:data.job,code:data.job.error_code,error:localeText('generation.attention')};
            await sleep(2000,observer.signal);
        }
        return {ok:false,pending:true,job,code:'generation_pending',error:localeText('generation.accepted')};
    } finally {window.removeEventListener('pagehide',stop);options.signal?.removeEventListener('abort',stop);observer.abort();}
}
