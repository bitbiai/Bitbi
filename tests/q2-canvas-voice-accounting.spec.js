const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');
for(const name of ['settlement','manual','guard','unknown','concurrency','deleted','allowance','late','lostack','resumption','authexpired','authrevoked','continuity'])test(`Canvas Voice accounting ${name}`,async()=>{
 const DB=new SqliteD1Database();applyAuthMigrations(DB);
 try{const {canvasVoiceAccountingCase}=await import('./helpers/canvas-voice-accounting-control.mjs');
  expect(await canvasVoiceAccountingCase({...createAuthTestEnv(),DB},name)).toEqual({case:name,providerCalls:0});
 }finally{DB.close();}
});
