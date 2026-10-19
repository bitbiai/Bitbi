const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');
const fs=require('node:fs');
test('Canvas assistant migration preserves populated original planning and reviewed accounting',async()=>{
 const DB=new SqliteD1Database();applyAuthMigrations(DB,{through:'0111_canvas_agent_settlement_reviews.sql'});
 try{const env={...createAuthTestEnv(),DB};const {seedCanvasAssistantMigration,verifyCanvasAssistantMigration}=await import('./helpers/canvas-assistant-migration-control.mjs');
 const snapshot=await seedCanvasAssistantMigration(env);DB.exec(fs.readFileSync('workers/auth/migrations/0112_canvas_assistant_models_and_scheduling.sql','utf8'));
 expect(await verifyCanvasAssistantMigration(env,snapshot)).toEqual({historicalOperationPreserved:true,settlementReviewPreserved:true,originalDebit:94,originalFailures:5});
 }finally{DB.close();}
});
