const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');
for(const name of ['late-stop','confirmation-replay','claim-race','dependent-failure','immediate-scope','immediate-duration-current'])test(`Canvas conversational action recovery ${name} preserves original authority and receipts`,async()=>{
 const DB=new SqliteD1Database();applyAuthMigrations(DB);
 try{
  const {canvasActionRecoveryCase}=await import('./helpers/canvas-agent-action-recovery-control.mjs');
  expect((await canvasActionRecoveryCase({...createAuthTestEnv(),DB},name)).case).toBe(name);
  expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
 }finally{DB.close();}
});
