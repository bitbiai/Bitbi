import {canvasVoiceSettings} from '../../js/shared/canvas-voice-settings.mjs';
import {saveCanvasVoiceSettings} from '../../workers/auth/src/lib/canvas-voice-settings.js';
import {quoteCanvasVoiceSession,admitCanvasVoiceSession,readOwnedCanvasVoiceSession,dispatchCanvasVoiceSession,
 acceptCanvasVoiceSession,activateCanvasVoiceSession,finishCanvasVoiceSession} from '../../workers/auth/src/lib/canvas-voice-accounting.js';
import {findCanvasVoiceResumption,recordCanvasVoiceProviderConversation} from '../../workers/auth/src/lib/canvas-voice-resumption.js';
import {sha256Hex} from '../../workers/auth/src/lib/tokens.js';
const check=(value,message)=>{if(!value)throw new Error(message);};
async function reject(fn,code){try{await fn();}catch(error){check(error.code===code||String(error).includes(code),`Expected ${code}, got ${error.code||error}`);return;}throw new Error(`Expected ${code}`);}
export async function canvasVoiceResumptionCase(env,scope){
 const {userId,projectId,authSessionId}=scope,settings=canvasVoiceSettings({resumption:{enabled:true}});
 const config=await saveCanvasVoiceSettings(env,userId,projectId,{settings,expectedRevision:0},'synthetic-resumption-opt-in');
 const input={maxDurationSeconds:10,settingsRevision:config.revision,expectedConversationRevision:0,expectedBriefRevision:0,expectedProjectRevision:0};
 async function quote(){return quoteCanvasVoiceSession(env,{userId,projectId,input});}
 async function admit(q,sessionId){return admitCanvasVoiceSession(env,{userId,projectId,authSessionId,input:{...input,requestId:sessionId,quoteId:q.id,capCredits:q.capCredits,consent:true},idempotencyKey:sessionId});}
 const initial=await quote();check(initial.resumption.enabled&&!initial.resumption.resuming,'First opt-in begins a new bounded conversation');
 await admit(initial,scope.sessionId);
 await reject(()=>recordCanvasVoiceProviderConversation(env,scope,'conversation-resume-fixture'),'canvas_voice_provider_identity_invalid');
 await dispatchCanvasVoiceSession(env,scope);await acceptCanvasVoiceSession(env,scope,{providerIdentity:null});
 await recordCanvasVoiceProviderConversation(env,scope,'conversation-resume-fixture');
 await recordCanvasVoiceProviderConversation(env,scope,'conversation-resume-fixture');
 await reject(()=>recordCanvasVoiceProviderConversation(env,{...scope,userId:'foreign'},'conversation-resume-fixture'),'canvas_voice_provider_identity_invalid');
 await reject(()=>recordCanvasVoiceProviderConversation(env,scope,'conversation-other'),'canvas_voice_provider_identity_invalid');
 await activateCanvasVoiceSession(env,scope);
 const exposure={elapsedMs:1,inputSamples:0,outputSamples:0,inputRate:24000,outputRate:24000};
 await finishCanvasVoiceSession(env,scope,{outcome:'completed',exposure,code:'synthetic_clean_close'});
 check((await findCanvasVoiceResumption(env,scope,settings))?.sessionId===scope.sessionId,'Only settled owned opt-in retains a server reference');
 check(await findCanvasVoiceResumption(env,{...scope,userId:'foreign'},settings)===null,'No foreign history lookup');
 check(await findCanvasVoiceResumption(env,{...scope,projectId:'f'.repeat(32)},settings)===null,'No cross-project provider context');
 check(await findCanvasVoiceResumption(env,scope,canvasVoiceSettings())===null,'Opt-out does not resume provider history');
 check(await findCanvasVoiceResumption(env,scope,settings,Date.now()+1800001)===null,'Thirty-minute expiry suppresses the retained reference without rewriting historical receipt');
 const resumed=await quote();check(resumed.resumption.resuming&&resumed.resumption.expiresAt,'Quote explicitly announces bounded provider-history continuation');
 check(!JSON.stringify(resumed).includes('conversation-resume-fixture'),'Provider identity never goes to browser');
 await reject(()=>env.DB.prepare('UPDATE canvas_voice_quotes SET resume_conversation_id=? WHERE id=?').bind('forged',resumed.id).run(),'canvas_voice_quote_immutable');
 const nextScope={...scope,sessionId:(await sha256Hex(userId+'-resumed')).slice(0,32)};
 await admit(resumed,nextScope.sessionId);
 const pinned=await readOwnedCanvasVoiceSession(env,nextScope);
 check(pinned.resume_session_id===scope.sessionId&&pinned.resume_conversation_id==='conversation-resume-fixture','Admission pins only the quote-owned provider conversation');
 await dispatchCanvasVoiceSession(env,nextScope);await acceptCanvasVoiceSession(env,nextScope,{providerIdentity:null});
 await reject(()=>recordCanvasVoiceProviderConversation(env,nextScope,'silent-new-conversation'),'canvas_voice_provider_identity_invalid');
 await recordCanvasVoiceProviderConversation(env,nextScope,'conversation-resume-fixture');await activateCanvasVoiceSession(env,nextScope);
 await finishCanvasVoiceSession(env,nextScope,{outcome:'unknown',exposure,code:'synthetic_lost_provider'});
 check(await findCanvasVoiceResumption(env,scope,settings)===null,'Unknown continuation cannot branch from its settled ancestor');
 const again=await quote(),forbidden=(await sha256Hex(userId+'-forbidden')).slice(0,32);
 await reject(()=>admit(again,forbidden),'canvas_voice_admission_denied');
 check((await env.DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(userId).first()).n===1,'Resume reserves independently; unknown neither repeats the original debit nor releases exposure');
}
