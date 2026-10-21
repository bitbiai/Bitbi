import { canvasPlanningEvidence } from '../../workers/auth/src/lib/canvas-agent-execution-failure.js';
import { readmitCanvasPlanning } from '../../workers/auth/src/lib/canvas-agent-planning-recovery.js';
import { syncCanvasProjectIncidents } from '../../workers/auth/src/lib/canvas-agent-incidents.js';
import { canvasAgentModelOperationFixture } from './canvas-agent-model-operation-control.mjs';
import worker from '../../workers/auth/src/index.js';
import { claimCanvasAgent,agentTransition,requeueCanvasAgents,releaseCanvasAgentUndispatched } from '../../workers/auth/src/lib/canvas-agent-store.js';
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

export const CANVAS_MODEL_CASES=['late','evaluate','lease','cancel','manual','newer','failed','rejected','ambiguous','callback-guards','normalization-recovery','bounded-review','legacy','policy-legacy','policy-late'];
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
    if(name==='policy-legacy') {
        const step=await f.db.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='plan'").bind(f.runId).first();
        const source=JSON.parse(step.input_json);delete source.payload.policy;
        // Historical queued work did not have an instruction pin. It has no
        // provider receipt, so a new release cannot spend under a new prompt.
        await rejected(()=>f.db.prepare('UPDATE canvas_agent_steps SET input_json=? WHERE id=?').bind(JSON.stringify(source),step.id).run(),'canvas_agent_step_immutable');
        // Construct historical fixture state before any dispatch; production
        // mutations remain subject to the immutable-step trigger above.
        const removed=await f.db.prepare("DELETE FROM canvas_agent_steps WHERE id=? AND status='ready' AND usage_attempt_id IS NULL").bind(step.id).run();
        check(removed.meta.changes===1,'Only the unstarted fixture step is replaced');
        await f.db.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,input_json,allocation_credits,created_at,updated_at)
            VALUES(?,?,?,'plan',?,?,?,?)`).bind(step.id,step.run_id,step.step_key,JSON.stringify(source),step.allocation_credits,step.created_at,step.updated_at).run();
        await f.deliver();
        const blocked=await rawRun(f);
        check(blocked.status==='review_required'&&blocked.error_code==='canvas_agent_policy_review_required','Unpinned old work requires explicit review');
        check(f.calls.length===0&&!await f.operation()&&await debits(f)===0,'Legacy policy review cannot dispatch or charge');
        check((await f.db.prepare('SELECT COUNT(*) AS n FROM member_ai_usage_attempts_v2 WHERE user_id=?').bind(f.owner).first()).n===0,'Policy gate precedes even wallet reservation');
        return {case:name,providerCalls:0,debits:0};
    }
    await f.deliver();check(f.calls.length===1,'Exactly one initial provider dispatch');
    const original=await f.operation(),initial=await attempt(f);
    check(original.usage_attempt_id===initial.id&&original.dispatch_token===initial.dispatch_token,'Persisted provider identity binds the existing reservation');
    check(await debits(f)===0&&await nodes(f)===0,'An accepted dispatch is neither a charge nor a completed graph');
    if(name==='policy-late') {
        const policy=JSON.parse(original.context_json).policy;
        check(policy.phase==='planning'&&JSON.parse((await rawRun(f)).policy_json).sha256===policy.sha256,'Run and accepted operation retain the same effective policy');
        const service=f.env.AI_LAB;let preparations=0;
        f.env.AI_LAB={fetch(request){
            if(new URL(request.url).pathname.endsWith('/prepare')){preparations++;return Response.json({ok:false,code:'canvas_agent_policy_changed',outcome:'not_submitted'},{status:409});}
            return service.fetch(request);
        }};
        // Calibrate the changed-policy boundary before observing accepted work.
        check((await f.env.AI_LAB.fetch(new Request('https://bitbi-ai.internal/internal/ai/canvas-agent/prepare'))).status===409,'The replacement release denies old new-preparation requests');
        check((await f.complete()).status===200,'Original completion survives the changed preparation policy');
        await f.observe();await f.deliver();
        check((await f.operation()).context_json===original.context_json,'A release cannot rewrite accepted policy identity');
        check(preparations===1&&f.calls.length===1&&await debits(f)===1&&await nodes(f)>0,'Reconciliation uses existing receipt, never re-prepares or re-dispatches');
        check((await f.complete()).status===200,'Duplicate historical completion remains safe');await f.observe();
        check(await debits(f)===1,'Historical completion settles exactly once');
        return {case:name,providerCalls:1,debits:1};
    }
    if(name==='lease')check((await rawRun(f)).lease_token==='replacement-model-lease','A stale consumer cannot clear a newer lease');
    if(name==='evaluate') {
        check((await f.complete()).status===200,'Planning callback precedes evaluation fixture');
        await f.observe();await f.deliver();f.advance(11_000);
        const step=await f.db.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='evaluate'").bind(f.runId).first();
        const input=JSON.parse(step.input_json),sample=input.samples[0];
        const payload={version:1,model:'xai/grok-4.7',requestId:step.id,brief:input.brief,policy:input.policy,privacyUser:'cau_'+'a'.repeat(64),promptCacheKey:'cap_'+'b'.repeat(64),
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

export const CANVAS_LOCAL_RECOVERY_CASES=['fresh','resume','transient','bounded','unknown','guards','diagnostics','stored'];
export async function canvasLocalRecoveryCase(base,name){
    check(CANVAS_LOCAL_RECOVERY_CASES.includes(name),'Known local recovery case');
    const f=await canvasAgentModelOperationFixture(base,{scope:'local-'+name,
        ...(name==='unknown'?{providerResponse(){throw Object.assign(new TypeError('Synthetic ambiguous response'),{code:'generation_timeout'});}}:{})});
    const run=()=>f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(f.runId).first();
    let injections=0;
    if(!['fresh','unknown','stored'].includes(name)){
        // Lost local write acknowledgement, after the reservation was linked,
        // before preparation or any provider call. The real D1 write still runs.
        const DB=f.env.DB,raw=new WeakMap();
        const wrap=(statement,sql)=>{
            const proxy=new Proxy(statement,{get(target,key){
                if(key==='bind')return (...args)=>wrap(target.bind(...args),sql);
                if(key==='run')return async()=>{
                    const result=await target.run();
                    if(injections<(name==='bounded'?3:1)&&sql.startsWith('UPDATE canvas_agent_steps SET usage_attempt_id=')){
                        injections++;
                        if(name==='diagnostics')await DB.prepare('SELECT missing_synthetic_column FROM canvas_agent_runs').all();
                        if(['transient','bounded'].includes(name))throw Object.assign(new Error('SQLITE_BUSY'),{code:'SQLITE_BUSY'});
                        throw new TypeError('Synthetic private prompt and callback must not appear in diagnostics');
                    }return result;
                };
                const value=target[key];return typeof value==='function'?value.bind(target):value;
            }});raw.set(proxy,statement);return proxy;
        };
        f.env.DB={prepare:sql=>wrap(DB.prepare(sql),sql),batch:rows=>DB.batch(rows.map(row=>raw.get(row)||row))};
    }
    await f.deliver({duplicates:1});
    if(name==='stored'){
        const plan={version:1,title:'Native settings',continuity:'One editable scene',nodes:[{key:'clip',title:'Garden',type:'video_generation',modelId:'bytedance/seedance-2.5',prompt:'A duck crossing a garden',config:{duration:13,resolution:'720p',generateAudio:false,watermark:false},dependencies:[]}],updates:[],
            assembly:{clips:[{key:'clip',trim:{start:0.2,duration:11.7},transition:{preset:'none'}}],targetDurationSeconds:12,toleranceSeconds:0.5,musicKey:null}};
        const completion={result:{id:'synthetic-native-plan',object:'chat.completion',model:'grok-4.7',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(plan)}}],usage:{prompt_tokens:120,completion_tokens:200,total_tokens:320}}};
        check((await f.complete(completion)).ok,'Original signed stored completion');
        await f.observe();const original=await canvasPlanningEvidence(f.env,await run());
        check(original.step.status==='completed'&&original.attempts[0].billing_status==='finalized','Normal receipt settlement precedes recovery');
        // Historical preflight failure fixture, with real immutable signed receipt,
        // proposal and debit. No live state or receipt is rewritten by recovery.
        await f.db.prepare("UPDATE canvas_agent_runs SET status='blocked',phase='planning',error_code='canvas_agent_plan_correction_exhausted',repair_attempts=2,cause_json=? WHERE id=?")
            .bind(JSON.stringify({issues:[{code:'canvas_agent_trim_outside_planned_source',nodeKey:'clip'}]}),f.runId).run();
        const failed=await run(),before=JSON.stringify({step:original.step,operation:original.operation,attempt:original.attempts[0]});
        await f.db.prepare("UPDATE canvas_agent_runs SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(f.runId).run();
        check((await control(f,'resume','expired-stored')).status===409,'Stored result cannot renew expired authority');
        await f.db.prepare('UPDATE canvas_agent_runs SET expires_at=? WHERE id=?').bind(failed.expires_at,f.runId).run();
        await f.db.prepare('UPDATE canvas_projects SET revision=revision+1 WHERE id=?').bind(f.project).run();
        check((await control(f,'resume','edited-stored')).status===409,'Stored answer cannot overwrite a newer creative revision');
        await f.db.prepare('UPDATE canvas_projects SET revision=revision-1 WHERE id=?').bind(f.project).run();
        await f.db.prepare("UPDATE canvas_agent_runs SET status='cancelled' WHERE id=?").bind(f.runId).run();
        check((await control(f,'resume','cancelled-stored')).status===409,'Cancelled production stays closed even with a reusable answer');
        await f.db.prepare("UPDATE canvas_agent_runs SET status='blocked' WHERE id=?").bind(f.runId).run();
        check((await f.observe()).allowedActions.includes('resume'),'Normal Resume exposes validated stored-answer continuation');
        const raced=await Promise.all([1,2].map(()=>readmitCanvasPlanning(f.env,failed,{requestKey:'stored-once'})));
        check(raced.every(r=>r.kind==='stored_plan'&&r.newInferenceCalls===0&&r.newCharges===0),'Concurrent recovery reuses one paid answer');
        check((await control(f,'resume','stored-once')).ok,'Lost response is acknowledged through normal control identity');
        const retained=await canvasPlanningEvidence(f.env,await run());
        check(before===JSON.stringify({step:retained.step,operation:retained.operation,attempt:retained.attempts[0]}),'Original receipt, tariff, response, usage and step remain intact');
        await f.deliver();const active=await run();
        check(active.status==='running'&&active.repair_attempts===2,'Existing production applies graph without resetting correction history');
        const node=await f.db.prepare("SELECT config_json FROM canvas_nodes WHERE project_id=? AND type='video_generation'").bind(f.project).first(),config=JSON.parse(node.config_json);
        check(config.seedance25.duration===13&&config.seedance25.generate_audio===false,'Editable node preserves exact native generation intent');
        check(f.calls.length===1&&await debits(f)===1,'No new inference or charge for interpretation or duplicate wake');
        check((await f.db.prepare("SELECT COUNT(*) AS n FROM canvas_agent_steps WHERE run_id=? AND kind='plan'").bind(f.runId).first()).n===1,'No replacement planning step');
        check((await f.complete()).status===409,'A different late answer cannot replace the original immutable response');
        check((await f.complete(completion)).ok,'Late duplicate original receipt remains safe');await f.observe();
        check(f.calls.length===1&&await debits(f)===1,'Late receipt cannot charge or plan again');
        return {case:name,providerCalls:1};
    }
    if(name==='fresh'){
        check(f.calls.length===1,'Ordinary fresh approved production dispatches once');
        check((await f.complete()).ok,'Signed original callback is accepted');await f.observe();await f.deliver();
        check((await run()).status==='running','Ordinary fresh production applies its editable graph');
        check((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=?').bind(f.project).first()).n>0,'Real Canvas nodes persist');
        return {case:name,providerCalls:1};
    }
    const failed=await run(),evidence=await canvasPlanningEvidence(f.env,failed);
    if(name==='unknown'){
        check(evidence.certainty==='unknown'&&failed.status==='review_required','Ambiguous accepted dispatch stays protected');
        await readmitCanvasPlanning(f.env,failed,{requestKey:'forbidden-unknown'}).then(()=>{throw Error('Unknown must not readmit');},e=>check(e.code==='canvas_agent_readmission_not_safe','Specific unknown admission refusal'));
        await f.deliver();check(f.calls.length===1,'Unknown cannot repeat provider inference');return {case:name,providerCalls:1};
    }
    check(evidence.certainty==='not_dispatched'&&f.calls.length===0,'Durable usage positively proves no dispatch');
    const cause=JSON.parse(failed.cause_json);
    check(cause.execution.stage==='reservation_link'&&cause.execution.reference.startsWith('canvas-execution-'),'Original stage and safe reference survive catch');
    check(!failed.cause_json.includes('private prompt')&&!failed.cause_json.includes('callback'),'No raw exception content enters persisted public diagnostics');
    if(name==='diagnostics'){
        check(cause.execution.category==='database'&&failed.status==='blocked'&&cause.recovery==='readmission','Native SQL error is not an invented provider outcome');
        return {case:name,providerCalls:0};
    }
    if(name==='bounded'){
        await f.deliver();await f.deliver();await f.deliver();
        const exhausted=await run(),steps=(await f.db.prepare("SELECT input_json FROM canvas_agent_steps WHERE run_id=? AND kind='plan' ORDER BY rowid").bind(f.runId).all()).results;
        check(exhausted.status==='blocked'&&steps.length===3&&JSON.parse(steps[2].input_json).readmission.ordinal===2,'Two local readmissions exhaust the automatic bound');
        check(!(await f.observe()).allowedActions.includes('resume')&&f.calls.length===0,'Exhaustion cannot loop through Resume or dispatch paid inference');
        return {case:name,providerCalls:0};
    }
    if(name==='transient'){
        check(cause.execution.transient&&cause.recovery==='local_retry','Only classified transient local failures get bounded automatic continuation');
        await f.deliver();check(f.calls.length===1,'Next durable wake re-admits once without a user action');
    }else{
        check(failed.status==='blocked','Deterministic local exception does not loop automatically');
        await releaseCanvasAgentUndispatched(f.env,f.runId);
        const released=await f.db.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=?').bind(evidence.attempts[0].id).first();
        check(released.billing_status==='released'&&!released.dispatch_token,'Old undispatched reservation is released');
        if(name==='guards'){
            await f.db.prepare("UPDATE canvas_agent_runs SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(f.runId).run();
            check((await f.request(`${f.route}/${f.runId}/control`,'POST',{action:'resume'},{'Idempotency-Key':'expired-resume'})).status===409,'Expired authority cannot re-admit');
            await f.db.prepare('UPDATE canvas_agent_runs SET expires_at=? WHERE id=?').bind(failed.expires_at,f.runId).run();
            const edited=await f.request(f.projectPath+'/nodes','POST',{type:'note',title:'Manual change',content:{text:'Keep it'},config:{}});
            check(edited.ok,'Manual change persists');
            const response=await f.request(`${f.route}/${f.runId}/control`,'POST',{action:'resume'},{'Idempotency-Key':'stale-resume'});
            check(response.status===409&&f.calls.length===0,'Changed graph cannot be overwritten by local recovery');
            check((await f.request(`${f.route}/${f.runId}/control`,'POST',{action:'cancel'},{'Idempotency-Key':'cancel-local'})).ok,'Cancellation remains available');
            check((await f.request(`${f.route}/${f.runId}/control`,'POST',{action:'resume'},{'Idempotency-Key':'cancelled-resume'})).status===409,'Cancellation cannot be laundered into readmission');
            return {case:name,providerCalls:0};
        }
        // Automatic explanation is informational. It must not dispatch, alter
        // creative state, or claim that a null operation proves no dispatch.
        const revision=(await f.db.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(f.project).first()).revision;
        await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner,allowInference:false});
        await syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner,allowInference:false});
        const incidents=(await f.db.prepare('SELECT context_json FROM canvas_agent_incidents WHERE project_id=?').bind(f.project).all()).results;
        check(incidents.length===1&&JSON.parse(incidents[0].context_json).operation.dispatchCertainty==='not_dispatched','One incident contains exact usage evidence');
        check(f.calls.length===0&&(await f.db.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(f.project).first()).revision===revision,'Explanation cannot execute or change the creative revision');
        const raced=await Promise.all([1,2].map(()=>readmitCanvasPlanning(f.env,failed,{requestKey:'local-resume-once'})));
        check(raced[0].stepId===raced[1].stepId,'Concurrent readmission acknowledges one durable successor');
        const resume=()=>f.request(`${f.route}/${f.runId}/control`,'POST',{action:'resume'},{'Idempotency-Key':'local-resume-once'});
        check((await resume()).ok&&(await resume()).ok,'Authenticated Resume and its exact replay succeed');
        await f.deliver();check(f.calls.length===1,'Resumption dispatches only the previously undispatched film request');
        check(JSON.stringify(await f.db.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=?').bind(released.id).first())===JSON.stringify(released),'Released original attempt is immutable during re-admission');
    }
    const steps=(await f.db.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='plan' ORDER BY rowid").bind(f.runId).all()).results;
    check(steps.length===2&&JSON.parse(steps[1].input_json).readmission.sourceStepId===steps[0].id,'One linked local attempt preserves original history');
    check(steps[1].usage_attempt_id!==steps[0].usage_attempt_id,'Readmission uses a fresh reservation, never resurrects a released one');
    check(JSON.stringify(JSON.parse(steps[0].input_json).payload)===JSON.stringify(JSON.parse(steps[1].input_json).payload),'Creative input, accepted policy and request identity remain unchanged');
    check((await f.complete()).ok,'Original accepted provider result is stored');await f.observe();await f.deliver();
    check((await run()).status==='running','Recovered original production applies its editable graph');
    check((await f.db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n===1,'One provider operation settles exactly once');
    check((await f.complete()).ok,'Duplicate receipt remains idempotent');await f.observe();
    check(f.calls.length===1&&(await f.db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n===1,'No duplicate inference or debit');
    return {case:name,providerCalls:1};
}
