import {sha256Hex} from '../../workers/auth/src/lib/tokens.js';
import {ensureConversation,conversationRow} from '../../workers/auth/src/lib/canvas-agent-conversation.js';
import {readCanvasVoiceSettings,saveCanvasVoiceSettings} from '../../workers/auth/src/lib/canvas-voice-settings.js';
import {recordCanvasVoiceUserTurn,readCanvasVoiceContext} from '../../workers/auth/src/lib/canvas-voice-conversation.js';
const check=(value,message)=>{if(!value)throw new Error(message);};
async function reject(fn,code){try{await fn();}catch(error){check(error.code===code,`Expected ${code}, received ${error.code||'unclassified'}`);return;}throw new Error(`Expected ${code}`);}
async function sqlReject(fn,code){try{await fn();}catch(error){check(String(error.message).includes(code),`Expected SQL invariant ${code}`);return;}throw new Error(`Expected SQL invariant ${code}`);}
async function seed(env,name){
 const userId='voice-settings-'+name,projectId=(await sha256Hex(userId)).slice(0,32),now=new Date().toISOString();
 await env.DB.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,?,?,'user','active',?)").bind(userId,userId+'@example.invalid','synthetic',now,now).run();
 await env.DB.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,'Voice settings fixture','de',?,?)").bind(projectId,userId,now,now).run();
 await ensureConversation(env,projectId,userId);return {userId,projectId,now};
}
async function protectedState(env,projectId,userId){
 const state={project:await env.DB.prepare('SELECT * FROM canvas_projects WHERE id=?').bind(projectId).first(),conversation:await conversationRow(env,projectId,userId),user:await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first()};
 for(const table of ['member_credit_ledger','member_credit_buckets'])state[table]=(await env.DB.prepare(`SELECT * FROM ${table} WHERE user_id=? ORDER BY id`).bind(userId).all()).results;
 state.nodes=(await env.DB.prepare('SELECT * FROM canvas_nodes WHERE project_id=? ORDER BY id').bind(projectId).all()).results;
 for(const table of ['canvas_agent_runs','canvas_agent_steps','canvas_agent_model_operations','member_ai_usage_attempts_v2','canvas_nodes','canvas_agent_conversation_decisions'])state[table]=(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
 return JSON.stringify(state);
}
export const CANVAS_VOICE_SETTINGS_CASES=['persistence','replay','concurrency','ownership','validation','lifecycle'];
export async function canvasVoiceSettingsCase(env,name){
 const {userId,projectId,now}=await seed(env,name),before=await protectedState(env,projectId,userId);
 const body={settings:{voice:'ara',preferences:{language:'de'},audio:{output:{speed:1.2}},tools:{canvas:{enabled:true}}},expectedRevision:0};
 if(name==='persistence'){
  const defaults=await readCanvasVoiceSettings(env,userId,projectId);check(defaults.revision===0&&defaults.settings.voice==='eve'&&defaults.settings.tools.canvas.enabled,'Fresh guarded Canvas defaults are read without writes');
  check((await env.DB.prepare('SELECT COUNT(*) AS n FROM canvas_voice_settings WHERE project_id=?').bind(projectId).first()).n===0,'GET does not persist a default or start a session');
  const saved=await saveCanvasVoiceSettings(env,userId,projectId,body,'save-settings-1');check(saved.revision===1&&saved.restartRequired,'Save records a distinct configuration revision');
  const reopened=await readCanvasVoiceSettings({...env},userId,projectId);check(reopened.settings.voice==='ara'&&reopened.settings.preferences.language==='de'&&reopened.settings.audio.output.speed===1.2,'Server state survives a fresh caller');
  const advanced=await saveCanvasVoiceSettings(env,userId,projectId,{expectedRevision:1,settings:{...reopened.settings,resumption:{enabled:true},
   audio:{...reopened.settings.audio,input:{...reopened.settings.audio.input,format:{type:'audio/opus',rate:24000},transport:'binary'},
    output:{...reopened.settings.audio.output,format:{type:'audio/opus',rate:24000},transport:'binary'}}}},'save-native-codecs');
  check(advanced.revision===2&&advanced.settings.audio.input.format.type==='audio/opus'&&advanced.settings.audio.output.transport==='binary'&&advanced.settings.resumption.enabled,
   'Actual capability validation and D1 persistence accept verified raw Opus and explicit provider-history opt-in');
  const other=await seed(env,name+'-second');check((await readCanvasVoiceSettings(env,other.userId,other.projectId)).settings.voice==='eve','Another project/account receives its own defaults');
 }else if(name==='replay'){
  await saveCanvasVoiceSettings(env,userId,projectId,body,'save-settings-1');
  check((await saveCanvasVoiceSettings(env,userId,projectId,body,'save-settings-1')).revision===1,'Lost acknowledgement reuses the durable write');
  await reject(()=>saveCanvasVoiceSettings(env,userId,projectId,{...body,settings:{voice:'leo'}},'save-settings-1'),'idempotency_conflict');
  await reject(()=>saveCanvasVoiceSettings(env,userId,projectId,body,'save-settings-2'),'canvas_voice_settings_changed');
  check((await env.DB.prepare('SELECT COUNT(*) AS n FROM canvas_voice_setting_writes WHERE project_id=?').bind(projectId).first()).n===1,'Rejected stale save creates no durable write');
 }else if(name==='concurrency'){
  const same=await Promise.all([0,1].map(()=>saveCanvasVoiceSettings(env,userId,projectId,body,'save-settings-1')));check(same.every(v=>v.revision===1),'Concurrent same-key save is idempotent');
  const changed={...body,expectedRevision:1},competing=await Promise.allSettled(['save-settings-2','save-settings-3'].map(key=>saveCanvasVoiceSettings(env,userId,projectId,changed,key)));
  check(competing.filter(v=>v.status==='fulfilled').length===1&&competing.find(v=>v.status==='rejected')?.reason.code==='canvas_voice_settings_changed','Different concurrent edits require current revision');
  check((await readCanvasVoiceSettings(env,userId,projectId)).revision===2,'Only one concurrent revision advances');
 }else if(name==='ownership'){
  await reject(()=>readCanvasVoiceSettings(env,'foreign-user',projectId),'canvas_project_not_found');
  await reject(()=>saveCanvasVoiceSettings(env,'foreign-user',projectId,body,'save-settings-1'),'canvas_project_not_found');
  await sqlReject(()=>env.DB.prepare('INSERT INTO canvas_voice_settings(project_id,user_id,settings_json,updated_at) VALUES(?,?,?,?)').bind(projectId,'foreign-user','{}',now).run(),'canvas_voice_owner_invalid');
  await saveCanvasVoiceSettings(env,userId,projectId,body,'save-settings-1');
  await sqlReject(()=>env.DB.prepare('UPDATE canvas_voice_settings SET user_id=? WHERE project_id=?').bind('foreign-user',projectId).run(),'canvas_voice_identity_immutable');
 }else if(name==='validation'){
  await reject(()=>saveCanvasVoiceSettings(env,userId,projectId,{...body,settings:{tools:{web_search:{enabled:true}}}},'save-settings-1'),'canvas_voice_setting_unavailable');
  await reject(()=>saveCanvasVoiceSettings(env,userId,projectId,{...body,settings:{voice:'foreign-custom-voice'}},'save-settings-1'),'canvas_voice_setting_unavailable');
  await reject(()=>saveCanvasVoiceSettings(env,userId,projectId,{...body,settings:{tools:{mcp:{enabled:true,servers:[{resourceId:'outside',allowed_tools:['charge']}]}}}},'save-settings-1'),'canvas_voice_setting_unavailable');
  await reject(()=>saveCanvasVoiceSettings(env,userId,projectId,{...body,settings:{budget:1000}},'save-settings-1'),'canvas_voice_settings_invalid');
  await reject(()=>saveCanvasVoiceSettings(env,userId,projectId,{...body,userId:'forged'},'save-settings-1'),'canvas_voice_settings_invalid');
 }else if(name==='lifecycle'){
  await saveCanvasVoiceSettings(env,userId,projectId,body,'save-settings-1');
  const sessionId=(await sha256Hex('session-'+projectId)).slice(0,32),scope={userId,projectId,sessionId};
  const expires=new Date(Date.now()+600000).toISOString(),loginId='voice-settings-login-'+projectId;
  await env.DB.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)').bind(loginId,userId,'synthetic-voice-settings',now,expires).run();
  await env.DB.prepare(`INSERT INTO canvas_voice_sessions(id,project_id,user_id,state,conversation_revision,brief_revision,project_revision,created_at,expires_at,auth_session_id) VALUES(?,?,?,'active',0,0,0,?,?,?)`).bind(sessionId,projectId,userId,now,expires,loginId).run();
  await recordCanvasVoiceUserTurn(env,scope,{itemId:'before-delete',text:'Ein Katzenvideo.'});
  await env.DB.prepare('INSERT INTO canvas_voice_calls(session_id,call_id,input_json,result_json,created_at) VALUES(?,?,?,?,?)').bind(sessionId,'retained-call','{}','{}',now).run();
  const foreign=await seed(env,name+'-foreign');
  await sqlReject(()=>env.DB.prepare(`INSERT INTO canvas_voice_sessions(id,project_id,user_id,request_key,state,conversation_revision,brief_revision,project_revision,created_at,expires_at) VALUES(?,?,?,'foreign','active',0,0,0,?,?)`).bind('f'.repeat(32),projectId,foreign.userId,now,new Date(Date.now()+600000).toISOString()).run(),'canvas_voice_admission_stopped');
  await env.DB.prepare('UPDATE canvas_projects SET deleted_at=? WHERE id=?').bind(now,projectId).run();
  for(const [table,key]of [['canvas_voice_settings','project_id'],['canvas_voice_setting_writes','project_id'],['canvas_voice_sessions','project_id'],['canvas_voice_turns','session_id'],['canvas_voice_calls','session_id']])check((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${key}=?`).bind(key==='project_id'?projectId:sessionId).first()).n===0,'Project deletion clears '+table);
  await reject(()=>readCanvasVoiceSettings(env,userId,projectId),'canvas_project_not_found');
  await reject(()=>readCanvasVoiceContext(env,scope),'canvas_voice_session_unavailable');
  check((await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id=?').bind(userId).first()).n===1,'Deleting project does not delete account');
 }
 if(name!=='lifecycle')check(await protectedState(env,projectId,userId)===before,'Settings neither mutate creative/accounting state nor grant production authority');
 check((await env.DB.prepare('PRAGMA foreign_key_check').all()).results.length===0,'Voice settings leave valid foreign keys');
 return {case:name,providerCalls:0};
}
export async function seedCanvasVoiceMigration(env){
 const owner=await seed(env,'migration');
 await env.DB.prepare(`INSERT INTO member_credit_ledger(id,user_id,amount,balance_after,entry_type,source,idempotency_key,created_at,metadata_json) VALUES(?,?,250,250,'grant','synthetic','existing-payment',?,'{"payment":"original-synthetic"}')`).bind('voice-migration-ledger',owner.userId,owner.now).run();
 await env.DB.prepare(`INSERT INTO member_credit_buckets(id,user_id,bucket_type,balance,source,created_at,updated_at) VALUES(?,?,'purchased',250,'synthetic',?,?)`).bind('voice-migration-bucket',owner.userId,owner.now,owner.now).run();
 await env.DB.prepare(`INSERT INTO canvas_nodes(id,project_id,user_id,type,title,x,y,content_json,created_at,updated_at) VALUES(?,?,?,'note','Keep this manual note',25,40,'{"text":"Original manual content"}',?,?)`).bind((await sha256Hex('voice-migration-node')).slice(0,32),owner.projectId,owner.userId,owner.now,owner.now).run();
 const snapshot=await protectedState(env,owner.projectId,owner.userId);
 return {...owner,snapshot};
}
export async function verifyCanvasVoiceMigration(env,input){
 check(await protectedState(env,input.projectId,input.userId)===input.snapshot,'0119 preserves existing project, account, conversation and paid identities');
 check((await readCanvasVoiceSettings(env,input.userId,input.projectId)).revision===0,'Existing project gains default Voice preferences only on read');
 for(const table of ['canvas_voice_sessions','canvas_voice_settings','canvas_voice_turns','canvas_voice_calls','canvas_voice_setting_writes'])check((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n===0,'Migration creates no sessions, transcripts, settings or authority');
 check((await env.DB.prepare('PRAGMA foreign_key_check').all()).results.length===0,'Populated migration keeps valid foreign keys');return {preserved:true};
}
