const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');
for(const name of ['late','evaluate','lease','cancel','manual','newer','failed','rejected','ambiguous','callback-guards','normalization-recovery','bounded-review','legacy']) {
  test(`Canvas durable model operation ${name}`,async()=>{
    const DB=new SqliteD1Database();applyAuthMigrations(DB);
    try {
      const {canvasModelOperationCase}=await import('./helpers/canvas-agent-model-operation-cases.mjs');
      const result=await canvasModelOperationCase({...createAuthTestEnv(),DB},name);
      expect(result.case).toBe(name);expect(result.providerCalls).toBe(name==='evaluate'?2:1);
      expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    } finally {DB.close();}
  });
}
