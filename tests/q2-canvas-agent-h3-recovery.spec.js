const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');
const fs=require('node:fs'),path=require('node:path');
for(const name of ['late','operator','duplicate','cancelled','expired','edited','missing-storage','wrong-owner','unknown','binding','concurrent','crash',
  'readiness-operator','readiness-stale-control','readiness-cancelled','readiness-expired','readiness-edited'])test(`Canvas H3 settled late receipt ${name}`,async()=>{
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  const media=Object.fromEntries([['videoBase64','canvas-end-frame.mp4'],['imageBase64','h3-frame.png'],['musicBase64','member-music.mp3']].map(([key,file])=>[key,fs.readFileSync(path.join(__dirname,'fixtures/media',file)).toString('base64')]));
  try{const {canvasH3RecoveryCase}=await import('./helpers/canvas-agent-h3-recovery-control.mjs');
    expect((await canvasH3RecoveryCase({...createAuthTestEnv(),DB},name,media)).submissions).toBe(1);
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  }finally{DB.close();}
});
