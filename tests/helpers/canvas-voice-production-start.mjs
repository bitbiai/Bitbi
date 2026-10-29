import assert from 'node:assert/strict';
import {ensureConversation} from '../../workers/auth/src/lib/canvas-agent-conversation.js';
import {recordCanvasVoiceUserTurn,recordCanvasVoiceReply,readCanvasVoiceContext} from '../../workers/auth/src/lib/canvas-voice-conversation.js';
import {recordVoiceDecisionPresentation} from '../../workers/auth/src/lib/canvas-voice-decisions.js';
import {createCanvasVoiceToolDispatcher} from '../../workers/auth/src/lib/canvas-voice-tools.js';
import {sha256Hex} from '../../workers/auth/src/lib/tokens.js';

// Functional film fixture: final ASR and completed playback are synthetic here.
// The independent native/browser journey proves their real Owner/audio gates.
// Decisions, immutable receipts, start admission and production are real callers.
export async function startCanvasFilmThroughVoice(f){
  await ensureConversation(f.env,f.project,f.owner);
  const sessionId=(await sha256Hex('spoken-film:'+f.project)).slice(0,32),scope={sessionId,projectId:f.project,userId:f.owner};
  await f.db.prepare(`INSERT INTO canvas_voice_sessions(id,project_id,user_id,auth_session_id,state,conversation_revision,brief_revision,project_revision,settings_json,created_at,expires_at)
    VALUES(?,?,?,?,'active',0,0,0,?,?,?)`).bind(sessionId,f.project,f.owner,f.owner,JSON.stringify({tools:{canvas:{enabled:true}}}),new Date().toISOString(),new Date(Date.now()+600000).toISOString()).run();
  let confirmedPresentation=null;
  const dispatch=createCanvasVoiceToolDispatcher(f.env,scope,{canUsePresentation:async proof=>Boolean(confirmedPresentation&&proof.key===confirmedPresentation.key&&proof.promptHash===confirmedPresentation.promptHash),
    conversationRevision:args=>args.expectedConversationRevision});
  const turn=(id,text)=>recordCanvasVoiceUserTurn(f.env,scope,{itemId:id,text});
  const call=async(name,args,id,source)=>{
    const result=await dispatch({name,arguments:args,callId:id,turn:{turnId:source.turnId}});assert.equal(result.ok,true,JSON.stringify(result));return result.data;
  };
  const idea=await turn('film_idea','Create a 12 second funny cartoon film of a dachshund at a pool with background music, in 16:9.');
  const context=await readCanvasVoiceContext(f.env,scope);
  await call('canvas_update_brief',{expectedConversationRevision:context.conversationRevision,expectedBriefRevision:context.briefRevision,expectedProjectRevision:context.projectRevision,
    updates:[{field:'story',value:'A funny dachshund at the pool, three editable scenes with background music.',provenance:'user_stated'},{field:'style',value:'Cartoon',provenance:'user_stated'}],
    questions:[],format:{aspectRatio:'16:9',resolution:null,provenance:'user_stated'},duration:{choice:'explicit',targetDurationSeconds:12}},'film_brief',idea);
  await call('canvas_prepare_next_step',{},'film_prepare',idea);
  const budget=await turn('film_budget','At most 10000 credits.');
  const proposed=await call('canvas_decision',{},'film_budget_decision',budget);
  assert.equal(proposed.executed,false);assert(proposed.spokenPrompt.includes('10000'));assert(proposed.presentation);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_agent_runs WHERE project_id=?').bind(f.project).first()).n,0,'Speaking a cap alone never starts production');
  const reply=await recordCanvasVoiceReply(f.env,scope,{turnId:budget.turnId,responseId:'film_terms_response',text:proposed.spokenPrompt,interrupted:false});
  confirmedPresentation=await recordVoiceDecisionPresentation(f.env,scope,{...proposed.presentation,responseId:'film_terms_response',itemId:'film_terms_audio',audioMs:8000,conversationRevision:reply.conversationRevision});
  const assent=await turn('film_assent','Yes, start now.');
  const accepted=await call('canvas_decision',{},'film_start',assent);assert.equal(accepted.executed,true);assert(accepted.runId);
  const replay=await call('canvas_decision',{},'film_start_replay',assent);assert.equal(replay.runId,accepted.runId);
  const rows=(await f.db.prepare('SELECT id,budget_credits FROM canvas_agent_runs WHERE project_id=?').bind(f.project).all()).results;
  assert.deepEqual(rows.map(row=>({...row})),[{id:accepted.runId,budget_credits:10000}],'Replayed spoken assent starts the one original production');
  return {run:{id:accepted.runId}};
}
