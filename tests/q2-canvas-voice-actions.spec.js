const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');
for(const name of ['start','interrupted','stale','ambiguous','replay','action','foreign','malformed','text-handoff','lost-ack','intervening','decline','action-lost-ack','terminal-save','terminal-cancel','terminal-clear','revoked'])test(`Canvas Voice guarded decision/action ${name}`,async()=>{
 const DB=new SqliteD1Database();applyAuthMigrations(DB);
 try{const {canvasVoiceActionCase}=await import('./helpers/canvas-voice-actions-control.mjs');
  expect(await canvasVoiceActionCase({...createAuthTestEnv(),DB},name)).toEqual({case:name,productions:['start','replay','action','text-handoff','lost-ack','action-lost-ack','terminal-save','terminal-cancel','terminal-clear'].includes(name)?1:0,providerCalls:0});
 }finally{DB.close();}
});
