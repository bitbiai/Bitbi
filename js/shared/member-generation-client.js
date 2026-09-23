import { localeText } from './locale.js?v=__ASSET_VERSION__';
import { getAuthState } from './auth-state.js';

// Only opaque request identity and a digest are retained; jobs/results live on
// the server. A lost acceptance response must reuse the same paid operation.
const intents = new Map();
let activeSubmission = null, sessionChanges = 0;

// Invalidate at the start of credential mutations, before a delayed /me can
// authorize work for the actor whose cookies are being replaced.
export function beginGenerationSessionChange() {
    sessionChanges++;
    activeSubmission?.abort();
    return () => { sessionChanges--; };
}

function preflightFailure(code, status) {
    return { ok:false, phase:'preflight', code, status, error:localeText(`generation.${code}`) };
}

async function verifySession(request, options, expectedOwner, expectedRole) {
    for (let attempt=0; attempt<2; attempt++) {
        if (options.signal.aborted) return {error:preflightFailure('sessionChanged')};
        options.onPreflight?.(attempt ? 'retrying' : 'checking');
        const me=await request('GET','/me',undefined,{signal:options.signal,timeoutMs:5000});
        if (options.signal.aborted) return {error:preflightFailure('sessionChanged')};
        if (me.status===401 || me.status===403 || (me.ok && me.data?.loggedIn===false)) {
            return {error:preflightFailure('sessionRequired',me.status===403 ? 403 : 401)};
        }
        const owner=me.data?.user?.id;
        if (me.ok && me.data?.ok!==false && me.data?.loggedIn===true && typeof owner==='string' && owner.trim()) {
            if ((expectedOwner && owner!==expectedOwner) || (expectedRole && me.data.user.role!==expectedRole)) return {error:preflightFailure('sessionChanged')};
            return {owner};
        }
        // Only transient read failures get one retry. Never retry admission,
        // authorization failures, malformed success, or an explicit cancellation.
        const transient=me.status>=500 || me.code==='network_error' || me.timeout===true;
        if (!transient || attempt===1) return {error:preflightFailure('sessionUnavailable',me.status)};
        await sleep(400,options.signal);
    }
}
const sleep = (ms,signal) => new Promise(resolve=>{
    const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};
    const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});
    if(signal?.aborted) done();
});
async function intent(owner,kind,body) {
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
    if(sessionChanges) return preflightFailure('sessionChanged');
    if(activeSubmission) return preflightFailure('submissionBusy');
    const controller=new AbortController(), original=options;
    activeSubmission=controller;
    const auth=getAuthState(), expectedOwner=options.expectedOwner || auth.user?.id;
    const stop=()=>controller.abort();
    const changed=event=>{
        const next=event.detail;
        if(!next?.loggedIn || next.user?.id!==expectedOwner || (auth.user?.role && next.user?.role!==auth.user.role)) stop();
    };
    document.addEventListener('bitbi:auth-change',changed);
    window.addEventListener('pagehide',stop);
    original.signal?.addEventListener('abort',stop,{once:true});
    if(original.signal?.aborted)stop();
    options={...options,signal:controller.signal};
    try {
        const verified=await verifySession(request,options,expectedOwner,auth.user?.role);
        if(verified.error)return verified.error;
        const current=await intent(verified.owner,kind,body);
        if(controller.signal.aborted || sessionChanges)return preflightFailure('sessionChanged');
        options.onPreflight?.('verified');
        if(controller.signal.aborted)return preflightFailure('sessionChanged');
        const accepted=await request('POST',`/ai/generate-${kind}`,body,{...options,headers:{...options.headers,'Idempotency-Key':current.key,Prefer:'respond-async'}});
        const job=accepted.data?.data?.job;
        if(!accepted.ok || accepted.status!==202 || !job?.id) return accepted;
        window.dispatchEvent(new CustomEvent('bitbi:generation-accepted',{detail:{id:job.id}}));
        if(!controller.signal.aborted)options.onAccepted?.(job);
        const result=await observeMemberGeneration(request,job,options);
        if(result.ok) current.clear();
        return result;
    } finally {
        document.removeEventListener('bitbi:auth-change',changed);
        window.removeEventListener('pagehide',stop);
        original.signal?.removeEventListener('abort',stop);
        activeSubmission=null;
    }
}

// Resuming observation never submits an inference request or changes its key.
export async function observeMemberGeneration(request,job,options={}) {
    let latest=job;
    const pending=()=>({ok:false,pending:true,job:latest,code:'generation_pending',error:localeText('generation.accepted')});
    const observer=new AbortController();
    const stop=()=>observer.abort();
    window.addEventListener('pagehide',stop,{once:true});options.signal?.addEventListener('abort',stop,{once:true});
    if(options.signal?.aborted)stop();
    const deadline=Date.now()+10*60_000; // observation limit only; never cancels the backend job
    try {
        while(!observer.signal.aborted && Date.now()<deadline) {
            const state=await request('GET',`/ai/generation-jobs/${encodeURIComponent(job.id)}`,undefined,{signal:observer.signal});
            if(!state.ok) return {...pending(),observationStatus:state.status};
            const data=state.data?.data;
            if(data?.job?.id!==job.id) return pending();
            latest={...latest,...data.job};options.onProgress?.(latest);
            if(data?.result?.ok && (data.job.status==='succeeded'||data.job.status==='preview_pending')) {
                return {ok:true,status:200,data:{...data.result,data:{...data.result.data,generationJob:data.job}}};
            }
            if(data?.job?.status==='outcome_unknown') return {...pending(),needsReview:true};
            if(data?.job?.status==='failed') return {ok:false,job:data.job,code:data.job.error_code,error:localeText('generation.attention')};
            await sleep(2000,observer.signal);
        }
        return pending();
    } catch { return pending();
    } finally {window.removeEventListener('pagehide',stop);options.signal?.removeEventListener('abort',stop);observer.abort();}
}
