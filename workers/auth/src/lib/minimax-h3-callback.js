import { H3_MODEL, parseH3Task } from '../../../../js/shared/minimax-h3.mjs';
import { readBodyBytesLimited } from '../../../../js/shared/request-body.mjs';
import { getAiSaveReferenceSigningSecret, getAiSaveReferenceSigningSecretCandidates } from './security-secrets.js';
import { nowIso } from './tokens.js';

// Provider completion receipts use the existing accepted jobs and queues. No
// polling URL, new credentials, scheduler, or second inference identity exists.
const active = ['queued','starting','provider_pending','polling','processing','ingesting','outcome_unknown'];
const fail = (code, status=409) => { throw Object.assign(new Error(code), {code,status}); };
const encode = new TextEncoder();
async function sign(secret, payload) {
    const key=await crypto.subtle.importKey('raw',encode.encode(`h3-callback:${secret}`),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encode.encode(payload))),b=>b.toString(16).padStart(2,'0')).join('');
}
async function find(env,kind,id) {
    if(!['member','admin'].includes(kind)||!/^[a-zA-Z0-9_-]{1,160}$/.test(id))fail('h3_callback_identity',403);
    const job=await env.DB.prepare(`SELECT * FROM ${kind==='member'?'member_generation_jobs':'ai_video_jobs_v2'} WHERE id=?`).bind(id).first();
    if(!job||!active.includes(job.status)||job.error_code==='generation_asset_removed')fail('h3_job_inactive',410);
    if(kind==='member') {
        const object=await env.USER_IMAGES.get(job.input_r2_key);
        if(!object)fail('h3_input_missing',410);
        const body=await new Response(object.body).json();job.model=body.model;
    }
    if(job.model!==H3_MODEL)fail('h3_callback_identity',403);
    return job;
}
export async function prepareH3Callback(env,{kind,id,userId}) {
    const job=await find(env,kind,id);
    if(job.user_id!==userId)fail('h3_callback_identity',403);
    const payload=JSON.stringify(['v1',kind,id,userId,job.created_at]);
    const token=`${btoa(payload).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')}.${await sign(getAiSaveReferenceSigningSecret(env),payload)}`;
    return `https://bitbi.ai/api/internal/ai/h3-callback/${token}`;
}
export function h3MemberReceipt(job) {
    const receipts=JSON.parse(job.provider_receipts_json||'{}');
    return receipts['ai-0'] && receipts['h3-task']?.task ? {task:receipts['h3-task'].task} : null;
}
export async function storedH3MemberTask(env,job) {
    if(job.media_type!=='video')return null;
    const direct=h3MemberReceipt(job);if(direct)return direct;
    const receipt=JSON.parse(job.provider_receipts_json||'{}')['ai-0'];
    const expected=`users/${job.user_id}/generation-jobs/${job.id}/provider-ai-0.json`;
    if(receipt?.key!==expected)return null;
    const stored=await env.USER_IMAGES.get(expected);if(!stored)return null;
    const encoded=await new Response(stored.body).json();
    return encoded.kind==='json'&&encoded.value?.task?.model==='MiniMax-H3'?encoded.value:null;
}
export function h3ProviderResult(raw) {
    const task=parseH3Task(raw);
    return {status:task.pending?'provider_pending':task.failed?'failed':'succeeded',providerTaskId:task.taskId,
        providerState:task.state,videoUrl:task.videoUrl,outputSeconds:task.outputSeconds,resolution:task.resolution,duration:task.duration,retryAfterSeconds:60};
}
export async function handleH3Callback({env,request},token) {
    const headers={'Cache-Control':'private, no-store'};
    try {
        if(request.method!=='POST')fail('method_not_allowed',405);
        if(token.length>1600)fail('h3_callback_identity',403);
        const [encoded,sig,extra]=token.split('.');
        if(extra||!/^[a-f0-9]{64}$/.test(sig||''))fail('h3_callback_identity',403);
        const payload=atob(encoded.replaceAll('-','+').replaceAll('_','/'));
        let valid=false;
        for(const {secret} of getAiSaveReferenceSigningSecretCandidates(env)) {
            const expected=await sign(secret,payload);let difference=0;
            for(let i=0;i<64;i++)difference|=expected.charCodeAt(i)^sig.charCodeAt(i);
            if(difference===0)valid=true;
        }
        if(!valid)fail('h3_callback_identity',403);
        const fields=JSON.parse(payload),[version,kind,id,userId,created]=fields;
        if(!Array.isArray(fields)||fields.length!==5||version!=='v1')fail('h3_callback_identity',403);
        const job=await find(env,kind,id);
        if(job.user_id!==userId||job.created_at!==created)fail('h3_callback_identity',403);
        const body=JSON.parse(new TextDecoder().decode(await readBodyBytesLimited(request,{maxBytes:16_384})));
        // Official H3 callback verification, still protected by this job's HMAC.
        if(typeof body.challenge==='string'&&body.challenge.length<=1024) return Response.json({challenge:body.challenge},{headers});
        const parsed=parseH3Task(body);
        const task={id:parsed.taskId,model:'MiniMax-H3',status:parsed.state,resolution:parsed.resolution,duration:parsed.duration,
            ...(parsed.videoUrl?{content:{url:parsed.videoUrl}}:{}),usage:{output_seconds:parsed.outputSeconds}};
        if(kind==='member') {
            const receipts=JSON.parse(job.provider_receipts_json||'{}'),previous=(await storedH3MemberTask(env,job))?.task;
            if(!receipts['ai-0']?.fingerprint)fail('h3_dispatch_not_recorded');
            if(previous && previous.id!==task.id)fail('h3_task_identity');
            if(previous?.status==='running' && task.status==='queued')return Response.json({ok:true},{headers});
            if(previous && ['succeeded','failed','cancelled'].includes(previous.status)) {
                if(previous.status!==task.status||previous.content?.url!==task.content?.url||previous.resolution!==task.resolution||previous.usage?.output_seconds!==task.usage?.output_seconds)fail('h3_terminal_conflict');
            } else {
                receipts['h3-task']={kind:'h3-task',task};
                const updated=await env.DB.prepare(`UPDATE member_generation_jobs SET provider_receipts_json=?
                    WHERE id=? AND user_id=? AND provider_receipts_json=? AND status IN ('queued','processing','ingesting','outcome_unknown') AND (error_code IS NULL OR error_code!='generation_asset_removed')`)
                    .bind(JSON.stringify(receipts),id,userId,job.provider_receipts_json).run();
                if(!updated.meta?.changes)fail('h3_receipt_conflict');
            }
            if(!parsed.pending) {
                await env.DB.prepare("UPDATE member_generation_jobs SET status='queued',next_attempt_at=?,updated_at=? WHERE id=? AND status='outcome_unknown' AND error_code!='generation_result_requires_credit_review'")
                    .bind(nowIso(),nowIso(),id).run();
                await env.AI_VIDEO_JOBS_QUEUE.send({type:'member_generation.process',job_id:id});
            }
        } else {
            if(!job.dispatch_token)fail('h3_dispatch_not_recorded');
            const previous=JSON.parse(job.provider_result_json||'{}');
            if(previous.providerTaskId && previous.providerTaskId!==parsed.taskId)fail('h3_task_identity');
            const result=h3ProviderResult({task});
            if(previous.providerState==='running' && parsed.state==='queued')return Response.json({ok:true},{headers});
            if(['succeeded','failed'].includes(previous.status)) {
                if(previous.status!==result.status||previous.videoUrl!==result.videoUrl||previous.outputSeconds!==result.outputSeconds||previous.resolution!==result.resolution)fail('h3_terminal_conflict');
            } else {
                const updated=await env.DB.prepare(`UPDATE ai_video_jobs_v2 SET provider_result_json=?,provider_task_id=?,provider_state=?,
                    provider_outcome=CASE WHEN ?='succeeded' THEN 'succeeded' WHEN ?='failed' THEN 'failed' ELSE provider_outcome END, next_attempt_at=CASE WHEN ? THEN ? ELSE next_attempt_at END
                    WHERE id=? AND user_id=? AND dispatch_token=? AND provider_result_json=? AND status IN ('queued','starting','provider_pending','polling','processing','ingesting')`)
                    .bind(JSON.stringify(result),parsed.taskId,parsed.state,result.status,result.status,parsed.pending?0:1,nowIso(),id,userId,job.dispatch_token,job.provider_result_json).run();
                if(!updated.meta?.changes)fail('h3_receipt_conflict');
            }
            if(!parsed.pending)await env.AI_VIDEO_JOBS_QUEUE.send({type:'ai_video_job.process',schema_version:1,job_id:id,user_id:userId,correlation_id:null});
        }
        return Response.json({ok:true},{headers});
    } catch(error) {return Response.json({ok:false,code:error.code||'h3_callback_rejected'},{status:error.status||400,headers});}
}
