const { test, expect } = require('@playwright/test');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1.js');
const { createAuthTestEnv } = require('./helpers/auth-worker-harness.js');

for(const name of ['fallback','manual','model','fable','unknown','resolved','revoked','isolation','deleted'])test(`Canvas proactive incident ${name} preserves authority and durable delivery`,async()=>{
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  try{
    const {canvasIncidentCase}=await import('./helpers/canvas-incident-control.mjs');
    expect((await canvasIncidentCase({...createAuthTestEnv(),DB},name)).case).toBe(name);
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  }finally{DB.close();}
});

for (const [name,file,method] of [
  ['project deletion preserves committed results and immutable source identities','canvas-project-lifecycle-control.mjs','canvasProjectLifecycleCase'],
  ['notifications preserve ownership, explicit acknowledgements and real operation states','canvas-notifications-control.mjs','canvasNotificationsCase'],
]) test(`Canvas reliability ${name}`,async()=>{
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  try{
    const helper=await import(`./helpers/${file}`);
    const result=await helper[method]({...createAuthTestEnv(),DB});
    expect(result).toEqual(method==='canvasProjectLifecycleCase'
      ?{foreignKeyCountercontrol:true,committedDeletion:true,redactedHistory:true,duplicateDeletion:true,lateWorkFenced:true,lateGraphWritesFenced:6,cleanupFailureBoundaries:3,completedGenerationReplayed:true}
      :{ownerIsolation:true,baseline:true,explicitReadIds:true,arrivalPreserved:true,clientDeduplicated:true,canonicalOnly:true,posterTruth:true,deletedProjectNotice:true});
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  }finally{DB.close();}
});

test('Canvas reliability populated notification migration preserves old receipts without fabricated reads',async()=>{
  const fs=require('node:fs'),path=require('node:path'),DB=new SqliteD1Database();
  applyAuthMigrations(DB,{through:'0112_canvas_assistant_models_and_scheduling.sql'});
  try{
    const {seedCanvasNotificationsMigration,verifyCanvasNotificationsMigration}=await import('./helpers/canvas-notifications-control.mjs');
    const env={...createAuthTestEnv(),DB},snapshot=await seedCanvasNotificationsMigration(env);
    DB.exec(fs.readFileSync(path.join(process.cwd(),'workers/auth/migrations/0113_canvas_notifications_and_lifecycle.sql'),'utf8'));
    // The current inbox projection joins the additive incident schema; the
    // historical 0113 source/receipt assertions below remain unchanged.
    DB.exec(fs.readFileSync(path.join(process.cwd(),'workers/auth/migrations/0114_canvas_incident_explanations.sql'),'utf8'));
    expect(await verifyCanvasNotificationsMigration(env,snapshot)).toEqual({originalRowsPreserved:2,oldResolvedRead:true,oldUnresolvedUnread:true,readWrites:0});
    const changed=structuredClone(snapshot);changed.rows[0].input_json='{"forged":true}';
    await expect(verifyCanvasNotificationsMigration(env,changed)).rejects.toThrow('preserves original generation evidence');
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  }finally{DB.close();}
});
