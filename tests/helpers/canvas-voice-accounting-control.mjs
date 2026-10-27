import {sha256Hex} from '../../workers/auth/src/lib/tokens.js';
import {ensureConversation,conversationCosts} from '../../workers/auth/src/lib/canvas-agent-conversation.js';
import {grantMemberCredits} from '../../workers/auth/src/lib/billing.js';
import {getModelTariff} from '../../workers/auth/src/lib/model-tariffs.js';
import {releaseExpiredAiDispatch} from '../../workers/auth/src/lib/ai-dispatch-state.js';
import {canvasVoiceSettings} from '../../js/shared/canvas-voice-settings.mjs';
import {saveCanvasVoiceSettings} from '../../workers/auth/src/lib/canvas-voice-settings.js';
import {quoteCanvasVoiceSession,admitCanvasVoiceSession,readOwnedCanvasVoiceSession,dispatchCanvasVoiceSession,acceptCanvasVoiceSession,
 activateCanvasVoiceSession,recordCanvasVoiceExposure,finishCanvasVoiceSession} from '../../workers/auth/src/lib/canvas-voice-accounting.js';
import {canvasVoiceAllowanceCase} from './canvas-voice-allowance-control.mjs';
import {canvasVoiceResumptionCase} from './canvas-voice-resumption-control.mjs';
import {markMemberAiUsageAttemptProviderRunning} from '../../workers/auth/src/lib/member-ai-usage-attempts.js';

const check=(value,message)=>{if(!value)throw new Error(message);};
async function reject(fn,code){try{await fn();}catch(error){check(!code||error.code===code||String(error).includes(code),`Expected ${code}, got ${error.code||String(error)}`);return;}throw new Error(`Expected ${code||'rejection'}`);}
function interruptedSessionProjection(env,state){
 let failed=false;const DB=env.DB;
 return {failed:()=>failed,env:{...env,DB:{prepare(sql){const prepared=DB.prepare(sql),bind=prepared.bind.bind(prepared);prepared.bind=(...args)=>{
  const result=bind(...args);if(!failed&&sql.includes(`UPDATE canvas_voice_sessions SET state='${state}'`))result.run=async()=>{failed=true;throw Object.assign(new Error('synthetic_session_projection_interrupted'),{code:'synthetic_session_projection_interrupted'});};
  return result;};return prepared;},batch:DB.batch.bind(DB)}}};
}
export const CANVAS_VOICE_ACCOUNTING_CASES=['settlement','manual','guard','unknown','concurrency','deleted','allowance','late','lostack','resumption','authexpired','authrevoked'];
export async function canvasVoiceAccountingCase(env,name){
 const DB=env.DB,userId='voice-account-'+name,projectId=(await sha256Hex(userId)).slice(0,32),sessionId=(await sha256Hex(userId+'-session')).slice(0,32),scope={userId,projectId,sessionId};
 const now=new Date().toISOString();
 await DB.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,?,?,'user','active',?)").bind(userId,userId+'@example.invalid','synthetic',now,now).run();
 const authSessionId='voice-auth-'+name;
 await DB.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)').bind(authSessionId,userId,'synthetic-'+name,now,new Date(Date.now()+3600000).toISOString(),now).run();
 await DB.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,'Voice accounting fixture','en',?,?)").bind(projectId,userId,now,now).run();
 await ensureConversation(env,projectId,userId);
 await grantMemberCredits({env,userId,amount:1000,idempotencyKey:'synthetic-voice-fund-'+name,source:'synthetic_fixture'});
 const tariff=await getModelTariff(env);
 await DB.prepare('UPDATE canvas_agent_conversations SET allowance_credits=100,allowance_tariff=? WHERE project_id=?').bind(tariff.revision,projectId).run();
 if(name==='allowance'){await canvasVoiceAllowanceCase(env,{...scope,authSessionId});return {case:name,providerCalls:0};}
 if(name==='resumption'){await canvasVoiceResumptionCase(env,{...scope,authSessionId});return {case:name,providerCalls:0};}
 let settingsRevision=0;
 if(name==='manual'){
  const settings=canvasVoiceSettings({turn_detection:{type:null},audio:{input:{format:{type:'audio/pcmu',rate:8000}}}});
  settingsRevision=(await saveCanvasVoiceSettings(env,userId,projectId,{settings,expectedRevision:0},'manual-settings-fixture')).revision;
 }
 const input={maxDurationSeconds:30,settingsRevision,expectedConversationRevision:0,expectedBriefRevision:0,expectedProjectRevision:0};
 const quote=await quoteCanvasVoiceSession(env,{userId,projectId,input});
 check(quote.creditsPerBlock===9&&quote.capCredits===(name==='manual'?54:27),'Existing FX and twenty-percent margin produce pinned block quote');
 const body={...input,requestId:sessionId,quoteId:quote.id,capCredits:quote.capCredits,consent:true};
 const admit=()=>admitCanvasVoiceSession(env,{userId,projectId,authSessionId,input:body,idempotencyKey:sessionId});
 if(name==='guard'){
  await reject(()=>admitCanvasVoiceSession(env,{userId,projectId,authSessionId,input:{...body,consent:false},idempotencyKey:sessionId}),'canvas_voice_consent_required');
  await reject(()=>admitCanvasVoiceSession(env,{userId,projectId,authSessionId,input:{...body,capCredits:1},idempotencyKey:sessionId}),'canvas_voice_quote_changed');
  await reject(()=>admitCanvasVoiceSession(env,{userId:'foreign',projectId,authSessionId,input:body,idempotencyKey:sessionId}),'canvas_project_not_found');
  await reject(()=>admitCanvasVoiceSession(env,{userId,projectId,authSessionId:'unknown-login',input:body,idempotencyKey:sessionId}),'canvas_voice_auth_session_required');
  await reject(()=>admitCanvasVoiceSession(env,{userId,projectId,authSessionId,input:{...body,authSessionId},idempotencyKey:sessionId}),'canvas_voice_consent_required');
  await DB.prepare('UPDATE canvas_agent_conversations SET revision=1 WHERE project_id=?').bind(projectId).run();
  await reject(admit,'canvas_agent_conversation_changed');
  check((await DB.prepare('SELECT COUNT(*) AS n FROM member_ai_usage_attempts_v2 WHERE user_id=?').bind(userId).first()).n===0,'Rejected consent/owner/revision does not reserve or dispatch');
  return {case:name,providerCalls:0};
 }
 if(name==='concurrency'){
  const other=(await sha256Hex(userId+'-other')).slice(0,32),otherBody={...body,requestId:other};
  const results=await Promise.allSettled([admit(),admitCanvasVoiceSession(env,{userId,projectId,authSessionId,input:otherBody,idempotencyKey:other})]);
  check(results.filter(result=>result.status==='fulfilled').length===1,'Atomic user/session admission admits only one concurrent reservation');
  const one=results.find(result=>result.status==='fulfilled').value.session.id;
  const oneScope={...scope,sessionId:one};
  await DB.prepare('UPDATE canvas_agent_conversations SET allowance_credits=26,revision=revision+1 WHERE project_id=?').bind(projectId).run();
  await reject(()=>dispatchCanvasVoiceSession(env,oneScope),'canvas_voice_authority_changed');
  check((await conversationCosts(env,projectId)).reserved===27,'Text allowance includes exactly one Voice reservation');
  const interrupted=interruptedSessionProjection(env,'rejected');
  await reject(()=>finishCanvasVoiceSession(interrupted.env,oneScope,{outcome:'not_submitted',code:'synthetic_before_dispatch'}),'synthetic_session_projection_interrupted');
  check(interrupted.failed()&&(await DB.prepare('SELECT billing_status FROM member_ai_usage_attempts_v2 WHERE idempotency_key=?').bind('canvas-voice-'+one).first()).billing_status==='released','Release committed before failed session projection');
  check((await finishCanvasVoiceSession(env,oneScope,{outcome:'not_submitted',code:'synthetic_before_dispatch'})).replay,'Released replay reconciles the same session');
  check((await DB.prepare('SELECT state FROM canvas_voice_sessions WHERE id=?').bind(one).first()).state==='rejected','Released projection no longer strands the per-user slot');
  check((await conversationCosts(env,projectId)).committed===0,'Confirmed undispatched release restores conversation headroom');
  const next=(await sha256Hex(userId+'-after-release')).slice(0,32),nextInput={...input,maxDurationSeconds:10,expectedConversationRevision:1};
  const nextQuote=await quoteCanvasVoiceSession(env,{userId,projectId,input:nextInput});
  await admitCanvasVoiceSession(env,{userId,projectId,authSessionId,input:{...nextInput,requestId:next,quoteId:nextQuote.id,capCredits:nextQuote.capCredits,consent:true},idempotencyKey:next});
  await finishCanvasVoiceSession(env,{...scope,sessionId:next},{outcome:'not_submitted',code:'synthetic_next_admission'});
  check((await DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(userId).first()).n===0,'Repaired released slot permits new authorized admission without any debit');
  return {case:name,providerCalls:0};
 }
 await admit();
 check((await admit()).replay,'Admission replay returns original session without another wallet reservation');
 if(name==='authexpired'){
  await DB.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(authSessionId).run();
  await reject(()=>dispatchCanvasVoiceSession(env,scope),'canvas_voice_authority_changed');
  const row=await DB.prepare('SELECT usage_attempt_id FROM canvas_voice_sessions WHERE id=?').bind(sessionId).first();
  await reject(()=>markMemberAiUsageAttemptProviderRunning(env,row.usage_attempt_id),'canvas_voice_authority_changed');
  await finishCanvasVoiceSession(env,scope,{outcome:'not_submitted',code:'synthetic_login_expired'});
  check((await conversationCosts(env,projectId)).committed===0,'Expired original login prevents real and forged internal dispatch and permits only confirmed undispatched release');
  return {case:name,providerCalls:0};
 }
 const dispatched=await dispatchCanvasVoiceSession(env,scope);
 await reject(()=>dispatchCanvasVoiceSession(env,scope),'canvas_voice_outcome_unknown');
 await acceptCanvasVoiceSession(env,scope,{providerIdentity:null});await activateCanvasVoiceSession(env,scope);
 const exposure={elapsedMs:10001,inputSamples:name==='manual'?80001:24000,outputSamples:name==='manual'?240000:24000,inputRate:name==='manual'?8000:24000,outputRate:24000};
 const measured=await recordCanvasVoiceExposure(env,scope,exposure);
 check(measured.startedBlocks===(name==='manual'?3:2),'Started blocks count server duration or audio IN plus OUT, never client playback');
 await reject(()=>recordCanvasVoiceExposure(env,scope,{...exposure,elapsedMs:0}),'canvas_voice_exposure_invalid');
 if(name==='authrevoked'){
  await DB.prepare('DELETE FROM sessions WHERE id=?').bind(authSessionId).run();
  await reject(()=>readOwnedCanvasVoiceSession(env,scope),'canvas_voice_authority_changed');
  await reject(()=>recordCanvasVoiceExposure(env,scope,exposure),'canvas_voice_authority_changed');
 }
 if(name==='unknown'){
  await finishCanvasVoiceSession(env,scope,{outcome:'unknown',exposure,code:'synthetic_lost_provider'});
  await DB.prepare("UPDATE member_ai_usage_attempts_v2 SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(dispatched.usageAttemptId).run();
  check(await releaseExpiredAiDispatch(env,'member_ai_usage_attempts_v2',dispatched.usageAttemptId)===0,'Unknown Voice holds its original wallet reservation after expiry');
  await DB.prepare('UPDATE canvas_projects SET deleted_at=? WHERE id=?').bind(now,projectId).run();
  check((await DB.prepare('SELECT COUNT(*) AS n FROM canvas_voice_sessions WHERE id=?').bind(sessionId).first()).n===0,'Project deletion removes private Voice session data');
  check(await releaseExpiredAiDispatch(env,'member_ai_usage_attempts_v2',dispatched.usageAttemptId)===0,'Deletion cannot erase unknown cost provenance or release its commitment');
  check((await conversationCosts(env,projectId)).pending===27,'Unknown remains committed once after deletion');
  await reject(()=>finishCanvasVoiceSession(env,scope,{outcome:'not_submitted',code:'synthetic_false_release'}),'canvas_voice_outcome_unknown');
 }else{
  if(name==='late')await finishCanvasVoiceSession(env,scope,{outcome:'unknown',exposure,code:'synthetic_close_pending'});
  if(name==='deleted'){
   await DB.prepare('UPDATE canvas_projects SET deleted_at=? WHERE id=?').bind(now,projectId).run();
   await reject(()=>readOwnedCanvasVoiceSession(env,scope),'canvas_voice_session_unavailable');
  }
  if(name==='lostack'){
   let failed=false;
   const interrupted={...env,DB:{prepare(sql){const prepared=DB.prepare(sql),bind=prepared.bind.bind(prepared);prepared.bind=(...args)=>{const result=bind(...args);
    if(!failed&&sql.includes("SET status = 'succeeded'")&&sql.includes("billing_status = 'finalized'"))result.run=async()=>{failed=true;throw Object.assign(new Error('synthetic_final_projection_interrupted'),{code:'synthetic_final_projection_interrupted'});};
    return result;};return prepared;},batch:DB.batch.bind(DB)}};
   await reject(()=>finishCanvasVoiceSession(interrupted,scope,{outcome:'completed',exposure,code:'synthetic_clean_close'}),'synthetic_final_projection_interrupted');
   check(failed&&(await DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(userId).first()).n===1,'Original debit persisted before interrupted attempt projection');
   const terminal=interruptedSessionProjection(env,'completed');
   await reject(()=>finishCanvasVoiceSession(terminal.env,scope,{outcome:'completed',exposure,code:'synthetic_clean_close'}),'synthetic_session_projection_interrupted');
   check(terminal.failed()&&(await DB.prepare('SELECT billing_status FROM member_ai_usage_attempts_v2 WHERE id=?').bind(dispatched.usageAttemptId).first()).billing_status==='finalized','Debit and usage finalized before second failure at session projection');
  }
  const completed=await finishCanvasVoiceSession(env,scope,{outcome:'completed',exposure,code:'synthetic_clean_close'});
  check(completed.chargedCredits===(name==='manual'?27:18),'One final debit uses started units and releases unused maximum reservation');
  check((await finishCanvasVoiceSession(env,scope,{outcome:'completed',exposure,code:'synthetic_clean_close'})).replay,'Lost completion acknowledgement cannot debit again');
  const costs=await conversationCosts(env,projectId);
  check(costs.charged===completed.chargedCredits&&costs.reserved===0&&costs.committed===completed.chargedCredits,'Conversation budget derives actual ledger without double counting');
  check((await DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(userId).first()).n===1,'Exactly one existing credit ledger debit');
  if(name==='lostack'){
   check((await DB.prepare('SELECT state FROM canvas_voice_sessions WHERE id=?').bind(sessionId).first()).state==='completed','Terminal replay repairs the original completed state');
   const next=(await sha256Hex(userId+'-after-projection')).slice(0,32),nextQuote=await quoteCanvasVoiceSession(env,{userId,projectId,input});
   await admitCanvasVoiceSession(env,{userId,projectId,authSessionId,input:{...body,requestId:next,quoteId:nextQuote.id},idempotencyKey:next});
   await finishCanvasVoiceSession(env,{...scope,sessionId:next},{outcome:'not_submitted',code:'synthetic_next_admission'});
   check((await DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(userId).first()).n===1,'Repaired slot permits fresh authorized admission with no duplicate debit');
  }
  await reject(()=>DB.prepare("UPDATE member_ai_usage_attempts_v2 SET metadata_json=json_set(metadata_json,'$.canvas_voice.pricing.maxCredits',1) WHERE id=?").bind(dispatched.usageAttemptId).run(),'canvas_voice_usage_immutable');
 }
 check((await DB.prepare('PRAGMA foreign_key_check').all()).results.length===0,'Native accounting preserves foreign key relations');
 return {case:name,providerCalls:0};
}
