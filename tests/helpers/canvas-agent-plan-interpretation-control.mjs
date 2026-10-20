import { canvasAgentModelOperationFixture } from './canvas-agent-model-operation-control.mjs';
import { freshCanvasAgentPlan } from './canvas-agent-control.mjs';
import { reconcileCanvasAgentModelOperations } from '../../workers/auth/src/lib/canvas-agent-model-operations.js';
import {syncCanvasProjectIncidents} from '../../workers/auth/src/lib/canvas-agent-incidents.js';
import { previewCanvasPlanInterpretation, applyCanvasPlanInterpretation, readValidCanvasPlanInterpretation,
    readCanvasCompletedInvalidPlan, deriveCanvasTerminalTransition } from '../../workers/auth/src/lib/canvas-agent-plan-interpretation.js';
const check=(value,message)=>{if(!value)throw new Error(message);};
const equal=(a,b,message)=>check(JSON.stringify(a)===JSON.stringify(b),message);
async function rejected(fn,code){try{await fn();}catch(error){check([error,error.cause,error.cause?.cause].some(value=>String(value?.code||'').includes(code)||String(value?.message||'').includes(code)),`Expected ${code}; got ${error.code||error.message}`);return;}throw new Error(`Missing ${code}`);}
async function fixture(env,scope){
    const f=await canvasAgentModelOperationFixture(env,{scope:'interpret-'+scope}),plan=freshCanvasAgentPlan();
    plan.assembly.clips.at(-1).transition={preset:'dissolve',duration:.5};
    if(scope.startsWith('preflight')){
        plan.nodes.push({key:'reference',type:'image_generation',title:'Reference image',modelId:'xai/grok-imagine-image-2.0',prompt:'An ordinary reference image.',config:{outputFormat:'jpeg'},dependencies:[]},
            {key:'score',type:'music_generation',title:'Background score',modelId:'elevenlabs/music-v2',prompt:'An instrumental score.',
                config:{musicLengthMs:12000,seedance25:{duration:-1,resolution:'720p',aspect_ratio:'16:9',workflow:'generate',fps:24,camera_fixed:false,watermark:false,use_virtual_avatar:false,generate_audio:false,seed:1,output_format:'mp4'}},dependencies:[]});
    }
    await f.deliver({duplicates:1});check(f.calls.length===1,'Only the original planning request is submitted');
    const completionBody={result:{id:'synthetic-plan-result',object:'chat.completion',model:'grok-4.7',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(plan)}}],
        usage:{prompt_tokens:120,completion_tokens:200,total_tokens:320}}};
    check((await f.complete(completionBody)).ok,'Original authenticated invalid completion is stored');
    await f.atClock(()=>reconcileCanvasAgentModelOperations(f.env,{runId:f.runId}));
    const op=await f.operation(),step=await f.db.prepare('SELECT * FROM canvas_agent_steps WHERE id=?').bind(op.step_id).first();
    check(op.state==='completed'&&step.status==='rejected','Application rejection remains a completed paid provider result');
    // Sanitized historical projection, after real dispatch, callback, signed
    // normalization and settlement. Current executor may now interpret this same
    // answer automatically; the operator must also recover already blocked rows.
    if(!['active','preflight'].includes(scope))await f.db.prepare("UPDATE canvas_agent_runs SET status='blocked',phase='planning',error_code='canvas_agent_plan_invalid',lease_token=NULL,lease_until=NULL WHERE id=?").bind(f.runId).run();
    const ids={userId:f.owner,projectId:f.project,runId:f.runId,stepId:step.id,operationId:op.id,usageAttemptId:op.usage_attempt_id};
    const run=()=>f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(f.runId).first();
    const ledger=async()=>(await f.db.prepare('SELECT * FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).all()).results;
    const preview=()=>f.atClock(()=>previewCanvasPlanInterpretation(f.env,ids));
    const apply=(input,env=f.env)=>f.atClock(()=>applyCanvasPlanInterpretation(env,{...ids,reviewDigest:input.reviewDigest,actor:'synthetic-owner',authorizationRef:'synthetic-interpretation-approval'}));
    return {...f,op,step,ids,run,ledger,preview,apply,plan,completionBody};
}
export async function canvasPlanInterpretationCase(env,name){
    if(name==='preflight'){
        const historical=await fixture(env,'preflight-operator');
        await rejected(()=>historical.preview(),'canvas_agent_plan_interpretation_preflight_blocked');
        check(historical.calls.length===1&&(await historical.run()).status==='blocked','Operator interpretation cannot silently authorize a new correction');
        const f=await fixture(env,name),original=await f.operation(),ledger=await f.ledger();
        await f.deliver({duplicates:2});
        const repaired=await f.run(),steps=(await f.db.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='plan' ORDER BY rowid").bind(f.runId).all()).results;
        check(repaired.phase==='repairing'&&repaired.repair_attempts===1&&steps.length===2,'Active authorization admits exactly one bounded correction');
        const repair=JSON.parse(steps[1].input_json).payload.repair;
        check(repair.issues.some(i=>i.field==='plan.assembly.clips[2].transition.preset')&&repair.issues.some(i=>i.nodeKey==='reference')&&repair.issues.some(i=>i.nodeKey==='score'),'Correction receives the terminal join and both real model-setting failures');
        equal(repair.previousPlan.nodes,f.plan.nodes,'Unsupported settings remain in original evidence for an explicit correction');
        check((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=?').bind(f.project).first()).n===0,'No graph is applied before a fully valid correction');
        equal(await f.ledger(),ledger,'Queued correction does not rewrite or duplicate the original debit');
        equal(await f.db.prepare('SELECT * FROM canvas_agent_model_operations WHERE id=?').bind(original.id).first(),original,'Original invalid response remains immutable');
        await f.deliver({duplicates:2});
        check(f.calls.length===2,'Only one separately identified correction is submitted alongside the original request');
        const accepted=await f.db.prepare('SELECT request_id,step_id,usage_attempt_id,provider_run_id FROM canvas_agent_model_operations WHERE run_id=? AND step_id=?').bind(f.runId,steps[1].id).first();
        check(accepted.request_id===JSON.parse(steps[1].input_json).payload.requestId&&accepted.request_id!==original.request_id
            &&accepted.usage_attempt_id!==original.usage_attempt_id&&accepted.provider_run_id===f.calls[1].id,'New correction has its own accepted request, step, usage and provider identity');
        check((await f.run()).repair_attempts===1,'Duplicate delivery cannot create a second correction attempt');
        return {case:name,newPlanningCalls:1,correctionAttempts:1,originalDebitPreserved:true};
    }
    if(name==='active'){
        const f=await fixture(env,name),original=await f.operation(),ledger=await f.ledger();
        await f.db.prepare("INSERT INTO canvas_agent_events(run_id,event_key,type,payload_json,created_at) VALUES(?,'synthetic-invalid-plan','error',?,?)")
            .bind(f.runId,JSON.stringify({code:'canvas_agent_plan_invalid',phase:'planning',tool:'production.reconcile'}),await f.atClock(()=>new Date().toISOString())).run();
        await f.atClock(()=>syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner,allowInference:false}));
        const initial=await f.db.prepare('SELECT * FROM canvas_agent_incidents WHERE project_id=?').bind(f.project).first();
        check(JSON.parse(initial.initial_context_json).operation.id===original.id,'Incident initially binds the original completed invalid operation');
        await f.deliver({duplicates:1});const run=await f.run();
        check(run.status==='running',`Current production interprets the completed invalid plan: ${run.status}/${run.error_code}`);
        const proposal=await f.db.prepare('SELECT * FROM canvas_agent_proposals WHERE step_id=?').bind(f.step.id).first();
        check(JSON.parse(proposal.interpretation_json).allowNewReasoning===1,'Existing production retains its original bounded correction authority');
        check((await f.complete(f.completionBody)).ok,'A late duplicate original receipt remains acknowledged');
        equal(await f.operation(),original,'Late delivery does not rewrite accepted provider evidence');
        equal(await f.ledger(),ledger,'Automatic interpretation and late callback cannot debit twice');
        check(f.calls.length===1&&run.repair_attempts===0,'Deterministic correction needs no new inference or paid repair attempt');
        const nodes=(await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=? AND deleted_at IS NULL').bind(f.project).first()).n;
        check(nodes===4,'Derived production retains ordinary editable nodes and assembly');
        await f.atClock(()=>syncCanvasProjectIncidents(f.env,{projectId:f.project,userId:f.owner,allowInference:false}));
        const updated=await f.db.prepare('SELECT * FROM canvas_agent_incidents WHERE id=?').bind(initial.id).first(),context=JSON.parse(updated.context_json);
        check(updated.state==='resolved'&&context.operation.id===original.id&&context.validation.reason==='terminal_transition','Real graph progress resolves the incident while retaining original operation and diagnosis');
        return {case:name,newPlanningCalls:0,nodes,originalDebitPreserved:true};
    }
    if(name==='guards'){
        for(const scenario of ['cancelled','expired','taken_over','edited','foreign','invalid-plan']){
            const f=await fixture(env,name+'-'+scenario),before=await f.ledger();
            if(scenario==='cancelled'||scenario==='taken_over')await f.db.prepare('UPDATE canvas_agent_runs SET status=? WHERE id=?').bind(scenario,f.runId).run();
            if(scenario==='expired'){const run=await f.run(),now=await f.atClock(()=>Date.now());f.advance(Date.parse(run.expires_at)-now+1);}
            if(scenario==='edited')await f.db.prepare('UPDATE canvas_projects SET revision=revision+1 WHERE id=?').bind(f.project).run();
            if(scenario==='foreign')await rejected(()=>previewCanvasPlanInterpretation(f.env,{...f.ids,userId:'foreign-member'}),'canvas_agent_plan_interpretation_evidence_invalid');
            else if(scenario==='invalid-plan'){
                const bad=structuredClone(f.plan);bad.nodes[0].dependencies=[{key:'missing',role:'first_frame'}];
                await rejected(()=>deriveCanvasTerminalTransition(bad,JSON.parse(f.op.context_json)),'canvas_agent_plan_interpretation_not_applicable');
                const unsafe=structuredClone(f.plan);unsafe.assembly.musicKey='missing';
                await rejected(()=>deriveCanvasTerminalTransition(unsafe,JSON.parse(f.op.context_json)),'canvas_agent_plan_invalid');
            }else await rejected(()=>f.preview(),'canvas_agent_plan_interpretation_authority_changed');
            equal(await f.ledger(),before,'Rejected review preserves original debit');check(f.calls.length===1,'Rejected interpretation never resubmits planning');
            check((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_agent_proposals WHERE run_id=?').bind(f.runId).first()).n===0,'No unsafe derived proposal is written');
        }
        return {case:name,guardCases:6,newPlanningCalls:0};
    }
    const f=await fixture(env,name),beforeLedger=await f.ledger(),original=await f.operation(),originalStep=await f.db.prepare('SELECT * FROM canvas_agent_steps WHERE id=?').bind(f.step.id).first();
    const view=await f.preview();check(view.newInferenceCalls===0&&view.newCharges===0&&view.diagnostic.reason==='terminal_transition','Dry run exposes exact invariant without writes');
    check((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_agent_proposals WHERE run_id=?').bind(f.runId).first()).n===0,'Dry run cannot create a proposal');
    const verified=await readCanvasCompletedInvalidPlan(f.env,await f.run(),f.step);check(verified.diagnostic.reason==='terminal_transition','Verified correction reader uses original stored evidence');
    if(name==='crash'){
        let lost=false;const wrapped=new Proxy(f.db,{get(target,key){if(key==='batch')return async statements=>{const result=await target.batch(statements);if(!lost){lost=true;throw new Error('synthetic-lost-commit-ack');}return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
        await rejected(()=>f.apply(view,{...f.env,DB:wrapped}),'synthetic-lost-commit-ack');check(lost,'Lost response occurs after real atomic commit');
    }else{
        const approval={...f.ids,reviewDigest:view.reviewDigest,actor:'synthetic-owner',authorizationRef:'synthetic-interpretation-approval'};
        const concurrent=await f.atClock(()=>Promise.all([applyCanvasPlanInterpretation(f.env,approval),applyCanvasPlanInterpretation(f.env,approval)]));check(concurrent.every(row=>row.replay),'Concurrent review observes one immutable interpretation');
    }
    const replay=await f.apply(view);check(replay.replay&&replay.newCharges===0,'Repeated recovery reuses original interpretation');
    const run=await f.run(),derived=await readValidCanvasPlanInterpretation(f.env,run,f.step);
    check(derived.assembly.clips.at(-1).transition.preset==='none'&&derived.nodes.length===f.plan.nodes.length,'Only the inert outgoing final join is removed');
    equal(derived.assembly.clips.slice(0,-1),f.plan.assembly.clips.slice(0,-1),'Every genuine scene join stays intact');
    equal(await f.operation(),original,'Original terminal provider evidence is immutable');
    equal(await f.db.prepare('SELECT * FROM canvas_agent_steps WHERE id=?').bind(f.step.id).first(),originalStep,'Rejected original step is not rewritten as success');
    equal(await f.ledger(),beforeLedger,'Interpretation has no second debit or reservation');
    const proposal=await f.db.prepare('SELECT * FROM canvas_agent_proposals WHERE step_id=?').bind(f.step.id).first();
    check(JSON.parse(proposal.interpretation_json).authority.allowNewReasoning===false,'Operator recovery cannot authorize new paid planning');
    await rejected(()=>f.db.prepare("UPDATE canvas_agent_proposals SET interpretation_json='{}' WHERE step_id=?").bind(f.step.id).run(),'canvas_agent_interpretation_immutable');
    check(f.calls.length===1,'No provider resubmission during recovery');
    // One actual production delivery applies the derived plan through ordinary
    // preflight and guarded graph services; no generated final UI state is used.
    await f.deliver({duplicates:1});const progressed=await f.run();
    check(progressed.status==='running',`Stored plan must apply, got ${progressed.status}/${progressed.error_code}`);
    const nodeCount=(await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=? AND deleted_at IS NULL').bind(f.project).first()).n;
    check(nodeCount===4&&f.calls.length===1,'Three ordinary editable video nodes and assembly anchor exist without reinference');
    return {case:name,newPlanningCalls:0,nodes:nodeCount,originalDebitPreserved:true};
}
