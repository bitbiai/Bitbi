const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');
for(const name of ['late','evaluate','lease','cancel','manual','newer','failed','rejected','ambiguous','callback-guards','normalization-recovery','bounded-review','legacy','policy-legacy','policy-late']) {
  test(`Canvas durable model operation ${name}`,async()=>{
    const DB=new SqliteD1Database();applyAuthMigrations(DB);
    try {
      const {canvasModelOperationCase}=await import('./helpers/canvas-agent-model-operation-cases.mjs');
      const result=await canvasModelOperationCase({...createAuthTestEnv(),DB},name);
      expect(result.case).toBe(name);expect(result.providerCalls).toBe(name==='evaluate'?2:name==='policy-legacy'?0:1);
      expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    } finally {DB.close();}
  });
}

for(const name of ['fresh','resume','transient','bounded','unknown','guards','diagnostics','stored'])test(`Canvas local planning recovery ${name}`,async()=>{
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  try{
    const {canvasLocalRecoveryCase}=await import('./helpers/canvas-agent-model-operation-cases.mjs');
    expect((await canvasLocalRecoveryCase({...createAuthTestEnv(),DB},name)).case).toBe(name);
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  }finally{DB.close();}
});
