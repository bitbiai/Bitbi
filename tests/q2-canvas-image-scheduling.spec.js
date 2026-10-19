const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');
for(const name of ['parallel-fifteen','capacity-fairness','unknown-fence','manual-revision','stop-budget','capacity-wait','capacity-recovery','out-of-order','rate-admission','scope-limits','claim-recovery','legacy-cutover','organization-recovery'])test(`Canvas image durable scheduling ${name}`,async()=>{
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  try {
    const {canvasImageSchedulingCase}=await import('./helpers/canvas-image-scheduling-control.mjs');
    const result=await canvasImageSchedulingCase({...createAuthTestEnv(),DB},{name,imageBase64:fs.readFileSync(path.join(__dirname,'fixtures/media/member-image.png')).toString('base64')});
    expect(result).toBeTruthy();expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally {DB.close();}
});
