import {conversationRow,createConversationTurn} from '../../workers/auth/src/lib/canvas-agent-conversation.js';
import {quoteCanvasVoiceSession,admitCanvasVoiceSession,finishCanvasVoiceSession} from '../../workers/auth/src/lib/canvas-voice-accounting.js';
import {CANVAS_AGENT_POLICY_VERSION} from '../../workers/shared/canvas-agent/manifest.mjs';
const check=(value,message)=>{if(!value)throw new Error(message);};
// Exercise the real text planner's cost-read -> atomic step-admission gap. The
// interleaved Voice admission uses its normal service and real local D1 tables.
// No synthetic provider execution, changed retry policy or fake completed row.
export async function canvasVoiceAllowanceCase(env,scope){
 const {userId,projectId,sessionId,authSessionId}=scope,DB=env.DB;
 const scoped={...env,CANVAS_AGENT_ENABLED:'true',ENABLE_GROK_4_7:'true',CLOUDFLARE_ACCOUNT_ID:'0'.repeat(32),H3_CLOUDFLARE_API_TOKEN:'synthetic-not-live',AI_SERVICE_AUTH_SECRET:'synthetic-voice-allowance-secret',
  AI_VIDEO_JOBS_QUEUE:{async send(){throw new Error('Rejected text admission must not queue paid work');}},PRIVATE_MEDIA_PROCESSOR:{async fetch(){throw new Error('No media processing');}},
  AI_LAB:{async fetch(request){check(request.method==='GET'&&new URL(request.url).pathname==='/internal/ai/canvas-agent/readiness','Only synthetic signed readiness is allowed');
   return Response.json({ok:true,protocolVersion:1,transport:'cloudflare-background',model:'xai/grok-4.7',available:true,accountAccess:'unverified',dialogueVersion:2,policyVersion:CANVAS_AGENT_POLICY_VERSION});}}};
 const project=await DB.prepare('SELECT * FROM canvas_projects WHERE id=?').bind(projectId).first(),input={text:'A gentle cat walks across a garden, about 45 seconds.',locale:'en',expectedConversationRevision:0,expectedBriefRevision:0};
 let calibration=true,cost=null,admitted=false,quote;
 const statements=new WeakMap();
 scoped.DB={prepare(sql){const prepared=DB.prepare(sql);const bind=prepared.bind.bind(prepared);prepared.bind=(...args)=>{const result=bind(...args);statements.set(result,{sql,args});return result;};return prepared;},
  async batch(batch){const step=batch.map(item=>statements.get(item)).find(item=>item?.sql.includes('INSERT INTO canvas_agent_steps'));
   if(step){if(calibration){cost=step.args[3];throw Object.assign(new Error('synthetic_quote_observed'),{code:'synthetic_quote_observed'});}
    check(step.args[3]===cost,'Calibration observes the same effective text admission input');
    await admitCanvasVoiceSession(env,{userId,projectId,authSessionId,input:{requestId:sessionId,quoteId:quote.id,capCredits:quote.capCredits,consent:true,
     maxDurationSeconds:30,settingsRevision:0,expectedConversationRevision:0,expectedBriefRevision:0,expectedProjectRevision:0},idempotencyKey:sessionId});admitted=true;
   }return DB.batch(batch);}};
 await DB.prepare('UPDATE canvas_agent_conversations SET allowance_credits=10000 WHERE project_id=?').bind(projectId).run();
 try{await createConversationTurn(scoped,{project},await conversationRow(env,projectId,userId),input,'voice-text-calibration');throw new Error('Quote probe did not intercept actual text admission');}
 catch(error){check(error.code==='synthetic_quote_observed','Only the precise pre-write probe is expected');}
 check(Number.isSafeInteger(cost)&&cost>0,'Actual text caller provides a positive maximum allocation');
 await DB.prepare('UPDATE canvas_agent_conversations SET allowance_credits=? WHERE project_id=?').bind(cost+26,projectId).run();
 quote=await quoteCanvasVoiceSession(env,{userId,projectId,input:{maxDurationSeconds:30,settingsRevision:0,expectedConversationRevision:0,expectedBriefRevision:0,expectedProjectRevision:0}});
 calibration=false;
 try{await createConversationTurn(scoped,{project},await conversationRow(env,projectId,userId),input,'voice-text-interleaved');throw new Error('Combined allowance was bypassed');}
 catch(error){check(String(error).includes('canvas_agent_budget_exceeded'),'Atomic text step rejects one-credit combined overrun');}
 check(admitted&&(await DB.prepare('SELECT COUNT(*) AS n FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id WHERE r.project_id=?').bind(projectId).first()).n===0,'Rejected text transaction rolls back completely after independent Voice reservation');
 await finishCanvasVoiceSession(env,scope,{outcome:'not_submitted',code:'synthetic_before_dispatch'});
}
