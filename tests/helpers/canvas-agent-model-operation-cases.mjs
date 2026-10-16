import { canvasAgentModelOperationFixture } from './canvas-agent-model-operation-control.mjs';
import worker from '../../workers/auth/src/index.js';
import { claimCanvasAgent,agentTransition,requeueCanvasAgents } from '../../workers/auth/src/lib/canvas-agent-store.js';
import { executeCanvasAgentModel } from '../../workers/auth/src/lib/canvas-agent-planning.js';
import { reconcileCanvasAgentModelOperations } from '../../workers/auth/src/lib/canvas-agent-model-operations.js';
import { releaseExpiredAiDispatch,claimAiDispatch,markAiDispatchUnknown } from '../../workers/auth/src/lib/ai-dispatch-state.js';
import { beginMemberAiUsageAttempt } from '../../workers/auth/src/lib/member-ai-usage-attempts.js';
const check=(value,message)=>{if(!value)throw new Error(message);};
async function rejected(operation,code){try{await operation();}catch(error){check([error.code,error.message].some(value=>String(value||'').split(/[^a-z0-9_]+/i).includes(code)),`Expected ${code}`);return;}throw new Error(`Missing rejection ${code}`);}
const rawRun=f=>f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(f.runId).first();
const attempt=async f=>f.db.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=?').bind((await f.operation()).usage_attempt_id).first();
const debits=async f=>(await f.db.prepare("SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0").bind(f.owner).first()).n;
const nodes=async f=>(await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=?').bind(f.project).first()).n;
async function control(f,action,key){return f.request(`${f.route}/${f.runId}/control`,'POST',{action},{'Idempotency-Key':key});}

export const CANVAS_MODEL_CASES=['late','evaluate','lease','cancel','manual','newer','failed','rejected','ambiguous','callback-guards','normalization-recovery','bounded-review','legacy'];
export async function canvasModelOperationCase(base,name) {
    check(CANVAS_MODEL_CASES.includes(name),'Known durable model case');
    const options={scope:'receipt-'+name};
    if(name==='ambiguous')options.providerResponse=()=>{throw Object.assign(new Error('synthetic network loss'),{code:'generation_timeout'});};
    if(name==='rejected')options.providerResponse=()=>Response.json({success:false,errors:[{code:5004,message:'synthetic private provider prose'}]},{status:400});
    if(name==='lease')options.providerResponse=async({id})=>{
        await base.DB.prepare('UPDATE canvas_agent_runs SET lease_token=?,lease_until=? WHERE id=?').bind('replacement-model-lease',new Date(Date.now()+15*60_000).toISOString(),f.runId).run();
        return Response.json({success:true,result:{id,state:'Queued'}});
    };
    const f=await canvasAgentModelOperationFixture(base,options);
    await f.deliver();check(f.calls.length===1,'Exactly one initial provider dispatch');
    const original=await f.operation(),initial=await attempt(f);
    check(original.usage_attempt_id===initial.id&&original.dispatch_token===initial.dispatch_token,'Persisted provider identity binds the existing reservation');
    check(await debits(f)===0&&await nodes(f)===0,'An accepted dispatch is neither a charge nor a completed graph');
    if(name==='lease')check((await rawRun(f)).lease_token==='replacement-model-lease','A stale consumer cannot clear a newer lease');
    if(name==='evaluate') {
        check((await f.complete()).status===200,'Planning callback precedes evaluation fixture');
        await f.observe();await f.deliver();f.advance(11_000);
        const step=await f.db.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='evaluate'").bind(f.runId).first();
        const input=JSON.parse(step.input_json),sample=input.samples[0];
        const payload={version:1,model:'xai/grok-4.7',requestId:step.id,brief:input.brief,privacyUser:'cau_'+'a'.repeat(64),promptCacheKey:'cap_'+'b'.repeat(64),
            frames:[{nodeId:sample.nodeId,timeSeconds:1,requirement:sample.requirement,imageData:'data:image/jpeg;base64,/9j/2Q=='}]};
        await f.atClock(async()=>{const run=await claimCanvasAgent(f.env,f.runId);check(run,'Real durable evaluation lease acquired');
            await agentTransition(f.env,run,{phase:'evaluating'});
            check(await executeCanvasAgentModel(f.env,run,step,{id:f.owner,role:'user',status:'active'},payload)===null,'Evaluation returns a durable pending identity');
            await f.db.prepare('UPDATE canvas_agent_runs SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').bind(f.runId,run.lease_token).run();});
        check(f.calls.length===2,'One plan and one evaluation dispatch');
        const op=await f.operation();check(op.kind==='evaluate'&&!op.context_json.includes('imageData'),'Validation context retains no image payload');
        f.advance(181_000);check((await f.observe()).modelOperation.outcome==='pending','Evaluation also outlives the old request deadline');
        const call=f.calls[1],evaluation={accepted:true,issues:[],confidence:'medium',samplingLimit:'Only selected frames were reviewed.'};
        const body={id:call.id,state:'Completed',model:'xai/grok-4.7',result:{id:'synthetic-evaluation-result',object:'chat.completion',model:'grok-4.7',
            choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(evaluation)}}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}}};
        check((await f.request(call.body.options.webhookUrl,'POST',body)).status===200,'Evaluation callback uses its original dispatch');
        await f.observe();check((await f.db.prepare('SELECT status FROM canvas_agent_steps WHERE id=?').bind(step.id).first()).status==='completed','Evaluation receipt is durably settled');
        check((await f.request(call.body.options.webhookUrl,'POST',body)).status===200,'Duplicate evaluation callback is safe');
        await f.observe();check(f.calls.length===2&&await debits(f)===2,'Plan and evaluation each charge only once');
        return {case:name,providerCalls:2,debits:2};
    }
    if(name==='rejected') {
        check(original.state==='rejected'&&initial.provider_outcome==='failed'&&initial.billing_status==='released','Documented pre-inference rejection releases once');
        await f.deliver();check(f.calls.length===1,'Rejection cannot dispatch again');
        return {case:name,providerCalls:1,debits:0};
    }
    if(name==='legacy') {
        // Restore only the historical *fixture* shape: no background operation,
        // accepted step with input hash and an already expired unknown attempt.
        await f.db.prepare('DELETE FROM canvas_agent_model_operations WHERE id=?').bind(original.id).run();
        await f.db.prepare("UPDATE member_ai_usage_attempts_v2 SET provider_outcome='unknown',expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(initial.id).run();
        await f.db.prepare("UPDATE canvas_agent_runs SET status='blocked',error_code='canvas_agent_provider_timeout',lease_token=NULL,lease_until=NULL WHERE id=?").bind(f.runId).run();
        const before=await f.db.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=?').bind(initial.id).first();
        const viewed=await f.observe();check(viewed.status==='review_required'&&viewed.modelOperation.outcome==='unknown','The supported observation path classifies the historical unknown accurately');
        check(await releaseExpiredAiDispatch(f.env,'member_ai_usage_attempts_v2',initial.id)===0,'Historical model reservation remains held without new authorization');
        check(JSON.stringify(await f.db.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=?').bind(initial.id).first())===JSON.stringify(before),'Historical classification never resets billing evidence');
        check((await control(f,'resume','legacy-resume-denied')).status===409,'Unknown historical request cannot resume');
        check((await control(f,'pause','legacy-pause-denied')).status===409,'Pause cannot launder unknown into a resumable request');
        await f.deliver();check(f.calls.length===1&&await debits(f)===0,'Historical reconciliation performs no provider call or debit');
        return {case:name,providerCalls:1,debits:0};
    }
    if(name==='callback-guards') {
        const callback=f.calls[0].body.options.webhookUrl;
        const bad=callback.slice(0,-1)+(callback.endsWith('0')?'1':'0');
        check((await f.request(bad,'POST',{})).status===403,'Wrong callback capability is rejected');
        check((await f.complete({id:'wrong-provider-identity'})).status===409,'Provider run identity cannot change');
        check((await f.complete({model:'outside/arbitrary-model'})).status===400,'Foreign model cannot supply a completion');
        check((await f.request(callback,'POST',{})).status===400,'Malformed authenticated callback is not fabricated success');
        const logs=[],previous=console.error;
        try {console.error=(...values)=>logs.push(values.join(' '));
            for(const method of ['GET','POST','DELETE']){
                const response=await worker.fetch(new Request(callback,{method}),{...f.env,SESSION_HASH_SECRET:''},{waitUntil(){}});
                check(response.status===503,'Missing required configuration calibrates actual request diagnostics');
            }
        } finally {console.error=previous;}
        check(logs.length===3&&logs.every(line=>line.includes('/api/internal/ai/canvas-agent-result/:token')&&!line.includes(callback.split('/').at(-1))),'Every method redacts the callback capability from real diagnostics');
        await rejected(()=>f.db.prepare("UPDATE canvas_agent_model_operations SET input_digest='changed' WHERE id=?").bind(original.id).run(),'canvas_agent_model_identity_immutable');
        check((await f.operation()).input_digest===original.input_digest,'The rejected mutation preserves the original immutable input');
        let permittedRejected=false;
        try {await rejected(()=>f.db.prepare('UPDATE canvas_agent_model_operations SET input_digest=? WHERE id=?').bind(original.input_digest,original.id).run(),'canvas_agent_model_identity_immutable');}
        catch(error){permittedRejected=error.message==='Missing rejection canvas_agent_model_identity_immutable';}
        check(permittedRejected,'An allowed unchanged write cannot satisfy the rejection guard');
        let unrelatedRejected=false;
        try {await rejected(()=>f.db.prepare("UPDATE canvas_agent_model_operations SET nonexistent_fixture_column='changed' WHERE id=?").bind(original.id).run(),'canvas_agent_model_identity_immutable');}
        catch(error){unrelatedRejected=error.message==='Expected canvas_agent_model_identity_immutable';}
        check(unrelatedRejected,'An unrelated SQLite error cannot satisfy the immutable identity guard');
        check((await f.operation()).input_digest===original.input_digest,'SQL guard controls leave the original input intact');
        check((await f.complete()).status===200,'Known valid callback calibrates the rejection controls');
        const response=(await f.operation()).response_json;
        check((await f.complete()).status===200,'Identical terminal callback replay is acknowledged');
        check((await f.complete({state:'Failed',error:{code:'5006'}})).status===409,'Conflicting later terminal outcome cannot overwrite success');
        check((await f.operation()).response_json===response,'The first terminal receipt is immutable');
        await f.observe();check(await debits(f)===1,'Only one terminal result settles');
        return {case:name,providerCalls:1,debits:1};
    }
    if(name==='failed') {
        check((await f.complete({state:'Failed',error:{code:'5006',message:'Do not store this private provider prose'}})).status===200,'Authenticated late failure is retained');
        const viewed=await f.observe(),usage=await attempt(f),op=await f.operation();
        check(viewed.status==='review_required'&&viewed.modelOperation.outcome==='failed'&&viewed.modelOperation.recovery==='billing_review','Known failure is distinct from waiting for a result');
        check(usage.billing_status==='reserved'&&!usage.reservation_released_at&&await debits(f)===0,'Failure without cost proof cannot fabricate a refund or debit');
        check(!op.response_json.includes('private provider prose')&&JSON.parse(op.receipt_json).outcome==='failed','Private error prose is stripped; failure evidence is retained');
        await f.deliver();check(f.calls.length===1&&await nodes(f)===0,'Failure cannot resume creative work or replay inference');
        return {case:name,providerCalls:1,debits:0};
    }
    if(name==='normalization-recovery'||name==='bounded-review') {
        check((await f.complete()).status===200,'Completion stored before normalization');
        const originalService=f.env.AI_LAB,receipt=(await f.operation()).response_json;
        let normalizations=0;
        f.env.AI_LAB={fetch(request){if(new URL(request.url).pathname.endsWith('/normalize')){normalizations++;return Response.json({ok:false,code:'synthetic_service_unavailable',outcome:'unknown'},{status:503});}return originalService.fetch(request);}};
        const count=name==='bounded-review'?8:1;
        for(let i=0;i<count;i++){f.advance(61_000);await f.observe();}
        if(name==='bounded-review') {
            const viewed=await f.observe();check(normalizations===5&&viewed.status==='review_required','Normalization/storage recovery has exactly five bounded attempts');
            f.env.AI_LAB=originalService;f.advance(61_000);await f.observe();
            check(await debits(f)===0&&(await f.operation()).response_json===receipt,'Exhausted review retains original result without invisible work');
            return {case:name,providerCalls:1,debits:0};
        }
        f.env.AI_LAB=originalService;f.advance(61_000);await f.observe();
        check(await debits(f)===1&&(await f.operation()).response_json===receipt,'Process recovery settles the immutable original receipt');
        await f.deliver();check(f.calls.length===1&&await nodes(f)>0,'Recovered receipt creates editable graph without another model call');
        return {case:name,providerCalls:1,debits:1};
    }
    if(name==='cancel')check((await control(f,'cancel','cancel-original-model')).status===200,'Cancel accepts the original run');
    if(name==='manual') {
        const edited=await f.request(f.projectPath+'/nodes','POST',{type:'note',title:'Manual choice',content:{text:'Keep this unrelated manual work'},config:{}});
        check(edited.ok,'Ordinary manual edit succeeds while a model request is pending');
    }
    if(name==='ambiguous') {
        const viewed=await f.observe();check(viewed.status==='review_required'&&viewed.modelOperation.outcome==='unknown','Ambiguous submission is accurately review-required');
        check((await control(f,'resume','unknown-resume-denied')).status===409,'An uncertain submission cannot be resumed as a new request');
    } else if(name==='late'||name==='newer') {
        f.advance(181_000);
        const beyondOldDeadline=await f.observe();
        check(beyondOldDeadline.status==='planning'&&beyondOldDeadline.phase==='planning'&&beyondOldDeadline.modelOperation.outcome==='pending','A genuine background operation remains pending beyond the old 180-second request deadline');
        check(beyondOldDeadline.reservedCredits===initial.credit_cost&&beyondOldDeadline.chargedCredits===0,'Reserved and charged costs remain distinct');
        await f.expire();
        check((await f.observe()).status==='review_required','A missing external receipt reaches bounded review');
        check(await f.atClock(()=>releaseExpiredAiDispatch(f.env,'member_ai_usage_attempts_v2',initial.id))===0,'Expiry never releases an unresolved Canvas reasoning reservation');
        const balance=(await f.db.prepare('SELECT balance_after FROM member_credit_ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').bind(f.owner).first()).balance_after;
        const unavailable=await f.atClock(()=>beginMemberAiUsageAttempt({env:f.env,userId:f.owner,featureKey:initial.feature_key,operationKey:'member.text.generate',route:'/synthetic',
            idempotencyKey:'held-balance-'+name,requestFingerprint:'held-balance-'+name,creditCost:balance-initial.credit_cost+1})).then(()=>false,error=>error.code==='insufficient_member_credits');
        check(unavailable,'Parallel admission still subtracts the expired-but-held reservation');
        const ordinary=await f.atClock(()=>beginMemberAiUsageAttempt({env:f.env,userId:f.owner,featureKey:initial.feature_key,operationKey:'member.text.generate',route:'/synthetic',
            idempotencyKey:'ordinary-expiry-'+name,requestFingerprint:'ordinary-expiry-'+name,creditCost:1}));
        const ordinaryToken=await f.atClock(()=>claimAiDispatch(f.env,'member_ai_usage_attempts_v2',ordinary.attempt.id));
        await f.atClock(()=>markAiDispatchUnknown(f.env,'member_ai_usage_attempts_v2',ordinary.attempt.id,{dispatchToken:ordinaryToken}));
        await f.db.prepare("UPDATE member_ai_usage_attempts_v2 SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(ordinary.attempt.id).run();
        check(await f.atClock(()=>releaseExpiredAiDispatch(f.env,'member_ai_usage_attempts_v2',ordinary.attempt.id))===1,'The narrow model hold does not change ordinary unknown reservation expiry');
        await f.atClock(()=>requeueCanvasAgents(f.env));
    }
    let newer=null;
    if(name==='newer')newer=(await f.data(await f.request(f.route,'POST',f.input,{'Idempotency-Key':'explicit-newer-production'}))).run.id;
    check((await f.complete()).status===200,'Late success is accepted using the original callback capability');
    if(newer)await f.atClock(()=>reconcileCanvasAgentModelOperations(f.env,{runId:f.runId}));else await f.observe();
    check(await debits(f)===1&&f.calls.length===1,'Late evidence settles once without replay');
    check((await attempt(f)).billing_status==='finalized'&&(await f.operation()).input_digest===original.input_digest,'Original reservation and immutable inputs own settlement');
    if(name==='cancel')check((await rawRun(f)).status==='cancelled'&&await nodes(f)===0,'Late success cannot resurrect cancellation');
    else if(name==='manual') {
        const viewed=await f.observe();check(viewed.status==='paused'&&!viewed.allowedActions.includes('resume')&&await nodes(f)===1,'Late success cannot overwrite a newer manual revision');
    } else if(name==='newer') {
        check((await rawRun(f)).status==='review_required'&&await nodes(f)===0,'Old success does not race the newer active production');
        check((await f.db.prepare('SELECT status FROM canvas_agent_runs WHERE id=?').bind(newer).first()).status==='queued','Newer run remains authoritative');
    } else {
        if(name==='lease')f.advance(15*60_000+1);
        await f.deliver();check((await rawRun(f)).status==='running'&&await nodes(f)>0,'Original completed plan resumes into ordinary editable Canvas nodes');
    }
    check((await f.complete()).status===200,'Repeated original completion is safe after settlement');
    await f.atClock(()=>reconcileCanvasAgentModelOperations(f.env,{runId:f.runId}));
    check(await debits(f)===1&&f.calls.length===1,'Duplicate terminal events cannot duplicate charges or paid work');
    return {case:name,providerCalls:1,debits:1};
}
