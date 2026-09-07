const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1');
const load = name => import(pathToFileURL(path.join(process.cwd(),name)).href);
async function fixture(options = {}) {
  const DB = new SqliteD1Database();
  applyAuthMigrations(DB,{through:'0083_add_r2_cleanup_reference_fence.sql'});
  const migration = path.join(process.cwd(),'workers/auth/migrations/0086_add_fable_memory_source_revision.sql');
  if (fs.existsSync(migration)) DB.exec(fs.readFileSync(migration,'utf8'));
  const helpers = await load('tests/helpers/q4-memory-fixture.mjs');
  const value = await helpers.createMemoryFixture(DB,options);
  return { ...value, DB, helpers,
    memory: await load('workers/auth/src/lib/fable-chat-memory.js'),
    fable: await load('workers/auth/src/lib/fable-chat.js') };
}
async function maintain(f) { return f.memory.maintainFableChatMemory(f.ctx,f.helpers.memoryActor,f.conversationId); }
async function select(f) { return f.memory.getFableChatMemorySelection(f.env,f.helpers.memoryActor.id,f.conversationId,'standard'); }
async function context(f, memorySelection = null) { return f.fable.buildFableChatModelContext(f.env,{adminUserId:f.helpers.memoryActor.id,conversationId:f.conversationId,currentMessage:'The next real context request',memorySelection}); }
function checkpoint(f) { return f.DB.database.prepare('SELECT * FROM fable_chat_memory_checkpoints ORDER BY summary_version DESC LIMIT 1').get(); }
function interceptOnce(DB,predicate,action) {
  const original = DB.prepare.bind(DB); let fired=false;
  DB.prepare = sql => {
    const make = statement => {
      const bind = statement.bind.bind(statement); statement.bind=(...args)=>make(bind(...args));
      const run=statement.run.bind(statement); statement.run=async()=>{
        if (!fired && predicate(sql,statement.bindings)) {fired=true;await action();}
        return run();
      }; return statement;
    };return make(original(sql));
  };
  return ()=>fired;
}
test('FM01 a source edit after candidate read cannot claim or dispatch that stale candidate',async()=>{
  const f=await fixture();try {
    const fired=interceptOnce(f.DB,sql=>sql.includes('INSERT INTO fable_chat_memory_checkpoints'),()=>f.edit());
    await maintain(f);expect(fired()).toBe(true);expect(f.calls).toHaveLength(0);
    expect(f.DB.database.prepare("SELECT COUNT(*) AS n FROM fable_chat_memory_checkpoints WHERE status IN ('pending','running','succeeded')").get().n).toBe(0);
    expect((await select(f)).checkpointId).toBeNull();
  }finally{f.DB.close();}
});
test('FM01 provider success after prefix edit is discarded while incurred usage and budget remain',async()=>{
  let f;f=await fixture({provider:async body=>{await f.edit();return f.helpers.memoryResult(body.profile);}});
  try {await maintain(f);expect(f.calls).toHaveLength(1);const c=checkpoint(f);
    expect(c.status).not.toBe('succeeded');expect(c.hidden_summary_content).toBeNull();
    expect(c.provider_cost_usd_micros).toBe(Math.round(f.helpers.providerCost*1e6));
    expect(JSON.parse(c.usage_json)).toMatchObject(f.helpers.providerUsage);
    const b=f.DB.database.prepare('SELECT * FROM platform_budget_usage_events WHERE source_attempt_id=?').get(c.id);
    expect(b.units).toBeGreaterThan(0);expect(b.status).toBe('recorded');
    expect(JSON.parse(b.metadata_json)).toMatchObject({...f.helpers.providerUsage,provider_cost_usd:f.helpers.providerCost});
    expect((await select(f)).checkpointId).toBeNull();
    const next=await context(f);expect(next.system).not.toContain('Q4 synthetic summary');expect(JSON.stringify(next.messages)).toContain('CURRENT EDITED PREFIX');
  }finally{f.DB.close();}
});
test('FM01 actual following-turn context rechecks a selected checkpoint after a transcript edit',async()=>{
  const f=await fixture();try{await maintain(f);const old=await select(f);expect(old.checkpointId).toBeTruthy();await f.edit();
    const next=await context(f,old);expect(next.system).not.toContain('Q4 synthetic summary');
    expect(next.memorySelection.checkpointId).toBeNull();expect(JSON.stringify(next.messages)).toContain('CURRENT EDITED PREFIX');
  }finally{f.DB.close();}
});
test('FM01 appending an uncovered complete turn preserves the valid prefix and bounded context',async()=>{
  const f=await fixture();try{await maintain(f);const old=await select(f);expect(old.checkpointId).toBeTruthy();
    await f.helpers.seedMemoryTurn(f.DB,f.conversationId,3,{text:'New complete uncovered turn'});
    const next=await context(f,old);expect(next.memorySelection.checkpointId).toBe(old.checkpointId);
    expect(next.system).toContain('Q4 synthetic summary');expect(JSON.stringify(next.messages)).toContain('New complete uncovered turn');
    expect(next.context.estimatedInputTokens).toBeLessThanOrEqual(next.context.effectiveInputTokenLimit);
  }finally{f.DB.close();}
});

function deferred() { let resolve; const promise=new Promise(r=>{resolve=r;});return {promise,resolve}; }
function budget(f,id) { return JSON.parse(f.DB.database.prepare('SELECT metadata_json FROM platform_budget_usage_events WHERE source_attempt_id=?').get(id).metadata_json); }
function interceptReadAfter(DB,predicate,action) {
  const original=DB.prepare.bind(DB);let fired=false;
  DB.prepare=sql=>{ const wrap=statement=>{
    const bind=statement.bind.bind(statement);statement.bind=(...args)=>wrap(bind(...args));
    const first=statement.first.bind(statement);statement.first=async()=>{
      const row=await first();if(!fired&&predicate(sql)){fired=true;await action();}return row;
    };return statement;
  };return wrap(original(sql));};return()=>fired;
}
test('FM01 edit between claim and RUNNING prevents provider dispatch with persisted failed claim',async()=>{
  const f=await fixture();try{
    const fired=interceptOnce(f.DB,sql=>sql.includes("SET status = 'running'"),()=>f.edit());
    await maintain(f);expect(fired()).toBe(true);expect(f.calls).toHaveLength(0);
    expect(checkpoint(f).status).toBe('failed');expect((await select(f)).checkpointId).toBeNull();
  }finally{f.DB.close();}
});
test('FM01 concurrent maintenance claims one provider intent and restart does not repeat it',async()=>{
  const entered=deferred(),release=deferred();const f=await fixture({provider:async body=>{entered.resolve();await release.promise;return f.helpers.memoryResult(body.profile);}});
  try{const first=maintain(f);await entered.promise;await maintain(f);expect(f.calls).toHaveLength(1);release.resolve();await first;
    expect(checkpoint(f).status).toBe('succeeded');await maintain(f);expect(f.calls).toHaveLength(1);
    expect(f.DB.database.prepare('SELECT COUNT(*) AS n FROM platform_budget_usage_events').get().n).toBe(1);
  }finally{release.resolve();f.DB.close();}
});
test('FM01 covered delete during provider result invalidates memory without erasing provider cost',async()=>{
  let f;f=await fixture({provider:async body=>{await f.deleteTurn();return f.helpers.memoryResult(body.profile);}});
  try{await maintain(f);const c=checkpoint(f);expect(c.status).toBe('failed');expect(c.hidden_summary_content).toBeNull();
    expect(budget(f,c.id).provider_cost_usd).toBe(f.helpers.providerCost);
    const next=await context(f);expect(next.memorySelection.checkpointId).toBeNull();expect(JSON.stringify(next.messages)).not.toContain('original-user-0');
    expect(next.context.estimatedInputTokens).toBeLessThanOrEqual(next.context.effectiveInputTokenLimit);
  }finally{f.DB.close();}
});
test('FM01 uncovered edit changes global revision but retains the valid covered prefix',async()=>{
  const f=await fixture();try{await maintain(f);const old=await select(f);expect(old.coverageTurnOrder).toBe(1);
    await f.edit(2);const next=await context(f,old);expect(next.memorySelection.checkpointId).toBe(old.checkpointId);
    expect(JSON.stringify(next.messages)).toContain('CURRENT EDITED PREFIX');expect(next.system).toContain('Q4 synthetic summary');
  }finally{f.DB.close();}
});
test('FM01 expired running result preserves consumption without activating or redispatching it',async()=>{
  const entered=deferred(),release=deferred();const f=await fixture({provider:async body=>{entered.resolve();await release.promise;return f.helpers.memoryResult(body.profile);}});
  try{const first=maintain(f);await entered.promise;f.DB.database.prepare("UPDATE fable_chat_memory_checkpoints SET expires_at='2000-01-01T00:00:00.000Z'").run();
    await maintain(f);expect(checkpoint(f).status).toBe('unknown');expect(f.calls).toHaveLength(1);release.resolve();await first;
    const c=checkpoint(f);expect(c.status).toBe('unknown');expect(c.hidden_summary_content).toBeNull();expect(JSON.parse(c.usage_json)).toMatchObject(f.helpers.providerUsage);
    expect(budget(f,c.id).provider_cost_usd).toBe(f.helpers.providerCost);await maintain(f);expect(f.calls).toHaveLength(1);
  }finally{release.resolve();f.DB.close();}
});
test('FM01 failed final batch rolls back checkpoint usage atomically and retains known provider cost in budget evidence',async()=>{
  const f=await fixture();try{
    f.DB.exec("CREATE TRIGGER q4_memory_fail_summary BEFORE UPDATE OF hidden_summary_content ON fable_chat_memory_checkpoints BEGIN SELECT RAISE(ABORT,'synthetic finalization failure'); END;");
    await maintain(f);const c=checkpoint(f);expect(c.status).toBe('unknown');expect(c.hidden_summary_content).toBeNull();expect(c.usage_json).toBe('{}');expect(c.provider_cost_usd_micros).toBeNull();
    expect(budget(f,c.id)).toMatchObject({...f.helpers.providerUsage,provider_cost_usd:f.helpers.providerCost});
    f.DB.exec('DROP TRIGGER q4_memory_fail_summary');await maintain(f);expect(f.calls).toHaveLength(1);expect((await select(f)).checkpointId).toBeNull();
  }finally{f.DB.close();}
});
test('FM01 budget outcome write failure does not replace validated cost with zero',async()=>{
  const f=await fixture();try{
    const fired=interceptOnce(f.DB,sql=>sql.includes('SET metadata_json = json_patch'),async()=>{throw new Error('synthetic first budget outcome write failure');});
    await maintain(f);expect(fired()).toBe(true);const c=checkpoint(f);expect(c.status).toBe('succeeded');
    expect(budget(f,c.id)).toMatchObject({...f.helpers.providerUsage,provider_cost_usd:f.helpers.providerCost,final_state:'succeeded'});
    await maintain(f);expect(f.calls).toHaveLength(1);
  }finally{f.DB.close();}
});
test('FM01 owner and exact selected checkpoint are revalidated rather than trusting supplied summary',async()=>{
  const f=await fixture();try{await maintain(f);const selected=await select(f);
    const foreign=await f.memory.revalidateFableChatMemorySelection(f.env,'q4-other-owner',f.conversationId,'standard',selected);expect(foreign.checkpointId).toBeNull();
    const forged=await context(f,{...selected,checkpointId:'fbk_'+f.helpers.fixedHex(90000),summary:'UNTRUSTED SUMMARY'});
    expect(forged.memorySelection.checkpointId).toBeNull();expect(forged.system).not.toContain('UNTRUSTED SUMMARY');
    const modified=await context(f,{...selected,summary:'UNTRUSTED SUMMARY',coverageTurnOrder:99999});
    expect(modified.memorySelection.summary).toBe(selected.summary);expect(modified.memorySelection.coverageTurnOrder).toBe(selected.coverageTurnOrder);
  }finally{f.DB.close();}
});
test('FM01 edit during final selected-checkpoint read rejects mixed context then fresh request uses raw data',async()=>{
  const f=await fixture();try{await maintain(f);const old=await select(f);
    const fired=interceptReadAfter(f.DB,sql=>sql.includes('SELECT m.id, m.profile')&&sql.includes('source_admin_revision_version'),()=>f.edit());
    await expect(context(f,old)).rejects.toMatchObject({status:409,code:'fable_chat_settings_conflict'});expect(fired()).toBe(true);
    const next=await context(f);expect(next.memorySelection.checkpointId).toBeNull();expect(JSON.stringify(next.messages)).toContain('CURRENT EDITED PREFIX');
  }finally{f.DB.close();}
});
test('FM01 actual Grok following-turn context rejects a superseded memory checkpoint',async()=>{
  const f=await fixture({model:'xai/grok-4.6'});try{await maintain(f);const old=await select(f);expect(old.checkpointId).toBeTruthy();await f.edit();
    const grok=await load('workers/auth/src/lib/grok-chat-context.js');
    const next=await grok.buildGrokChatModelContext(f.env,{adminUserId:f.helpers.memoryActor.id,conversationId:f.conversationId,currentMessage:'Actual Grok next context',memorySelection:old});
    expect(next.memorySelection.checkpointId).toBeNull();expect(JSON.stringify(next.messages)).toContain('CURRENT EDITED PREFIX');expect(JSON.stringify(next.messages)).not.toContain('Q4 synthetic summary');
  }finally{f.DB.close();}
});
test('FM01 legacy unbound checkpoint remains stored but cannot suppress raw context or trigger duplicate paid work',async()=>{
  const f=await fixture();try{await maintain(f);const c=checkpoint(f);
    // Rebuild this synthetic row in the pre-0086 shape, then apply the real additive migration to populated data.
    f.DB.exec('DROP TRIGGER fable_chat_memory_source_revision_immutable');f.DB.exec('ALTER TABLE fable_chat_memory_checkpoints DROP COLUMN source_admin_revision_version');
    f.DB.exec(fs.readFileSync('workers/auth/migrations/0086_add_fable_memory_source_revision.sql','utf8'));
    expect(checkpoint(f).source_admin_revision_version).toBeNull();const next=await context(f);
    expect(next.memorySelection.checkpointId).toBeNull();expect(JSON.stringify(next.messages)).toContain('original-user-0');
    const admin=await load('workers/auth/src/lib/fable-chat-admin-data.js');expect((await admin.listFableChatAdminCheckpoints(f.env,f.conversationId)).checkpoints[0].validForContext).toBe(false);
    expect(checkpoint(f).hidden_summary_content).toBe(c.hidden_summary_content);expect(budget(f,c.id).provider_cost_usd).toBe(f.helpers.providerCost);
    expect(()=>f.DB.database.prepare('UPDATE fable_chat_memory_checkpoints SET source_admin_revision_version=0 WHERE id=?').run(c.id)).toThrow('Memory source revision is immutable');
    expect(f.DB.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);await maintain(f);expect(f.calls).toHaveLength(1);
  }finally{f.DB.close();}
});

test('FM01 Admin checkpoint validity matches actual bound, stale and retained legacy selection',async()=>{
  const f=await fixture();try{const admin=await load('workers/auth/src/lib/fable-chat-admin-data.js');await maintain(f);
    expect((await admin.listFableChatAdminCheckpoints(f.env,f.conversationId)).checkpoints[0].validForContext).toBe(true);
    await f.edit();expect((await admin.listFableChatAdminCheckpoints(f.env,f.conversationId)).checkpoints[0].validForContext).toBe(false);
  }finally{f.DB.close();}
});
test('FM01 lite profile observes the same covered revision and actual bounded next context',async()=>{
  let edited=false,f;f=await fixture({mode:'lite',tailText:'lite-tail '+ 'x'.repeat(3980),provider:async body=>{if(body.profile==='lite'&&!edited){edited=true;await f.edit();}return f.helpers.memoryResult(body.profile);}});
  try{await maintain(f);expect(edited).toBe(true);
    const lite=f.DB.database.prepare("SELECT * FROM fable_chat_memory_checkpoints WHERE profile='lite' ORDER BY summary_version DESC LIMIT 1").get();
    expect(lite.status).toBe('failed');expect(lite.hidden_summary_content).toBeNull();expect(budget(f,lite.id).provider_cost_usd).toBe(f.helpers.providerCost);
    const next=await context(f);expect(next.memorySelection.mode).toBe('lite');expect(next.memorySelection.checkpointId).toBeNull();
    expect(JSON.stringify(next.messages)).toContain('CURRENT EDITED PREFIX');expect(next.context.estimatedInputTokens).toBeLessThanOrEqual(next.context.effectiveInputTokenLimit);
  }finally{f.DB.close();}
});
test('FM01 delete then restore does not resurrect an old summary even when source bytes match again',async()=>{
  const f=await fixture();try{await maintain(f);const selected=await select(f);await f.deleteTurn();
    const admin=await load('workers/auth/src/lib/fable-chat-admin-data.js');
    await admin.reviseFableChatAdminTurn(f.env,{actorAdminUserId:f.helpers.memoryActor.id,conversationId:f.conversationId,turnId:f.turns[0].turnId,action:'restore',body:{expectedRevision:1,expectedTurnRevision:1,reason:'Q4 synthetic restore'},idempotencyKey:'q4-restore-prefix-0001'});
    const next=await context(f,selected);expect(next.memorySelection.checkpointId).toBeNull();expect(JSON.stringify(next.messages)).toContain('original-user-0');
    expect(checkpoint(f).hidden_summary_content).toBe(selected.summary);expect(f.calls).toHaveLength(1);
  }finally{f.DB.close();}
});

test('FM01 stale-state write failure still preserves known provider consumption in both durable records',async()=>{
  let f;f=await fixture({provider:async body=>{await f.edit();return f.helpers.memoryResult(body.profile);}});
  try{
    const fired=interceptOnce(f.DB,(sql,args)=>sql.includes('SET status = ?, error_code')&&args[1]==='memory_source_stale',async()=>{throw new Error('synthetic stale outcome state write failure');});
    await maintain(f);expect(fired()).toBe(true);const c=checkpoint(f);expect(c.status).toBe('unknown');expect(c.hidden_summary_content).toBeNull();
    expect(JSON.parse(c.usage_json)).toMatchObject(f.helpers.providerUsage);expect(c.provider_cost_usd_micros).toBe(Math.round(f.helpers.providerCost*1e6));
    expect(budget(f,c.id)).toMatchObject({...f.helpers.providerUsage,provider_cost_usd:f.helpers.providerCost});
  }finally{f.DB.close();}
});
async function buildThreeCheckpointChain(f) {
  await maintain(f); const first=await select(f);
  for(let order=3;order<5;order+=1) await f.helpers.seedMemoryTurn(f.DB,f.conversationId,order);
  await maintain(f); const second=await select(f);
  for(let order=5;order<7;order+=1) await f.helpers.seedMemoryTurn(f.DB,f.conversationId,order);
  await maintain(f); const third=await select(f);
  expect(new Set([first.checkpointId,second.checkpointId,third.checkpointId]).size).toBe(3);
  return {first,second,third};
}
async function invalidateCheckpoint(f,id) {
  const admin=await load('workers/auth/src/lib/fable-chat-admin-data.js');
  return admin.invalidateFableChatAdminCheckpoint(f.env,{actorAdminUserId:f.helpers.memoryActor.id,conversationId:f.conversationId,checkpointId:id,
    body:{expectedRevision:0,reason:'Q4 synthetic ancestor invalidation'},idempotencyKey:'q4-memory-invalidate-ancestor-0001'});
}
test('FM01 explicit ancestor invalidation excludes its full derived chain from the next context',async()=>{
  const f=await fixture();try{const {first,third}=await buildThreeCheckpointChain(f);await invalidateCheckpoint(f,first.checkpointId);
    const next=await context(f,third);expect(next.memorySelection.checkpointId).toBeNull();expect(next.system).not.toContain('Q4 synthetic summary');
    expect(next.context.estimatedInputTokens).toBeLessThanOrEqual(next.context.effectiveInputTokenLimit);
    const admin=await load('workers/auth/src/lib/fable-chat-admin-data.js');expect((await admin.listFableChatAdminCheckpoints(f.env,f.conversationId)).checkpoints.every(row=>!row.validForContext)).toBe(true);
  }finally{f.DB.close();}
});

test('FM01 ancestor invalidation after candidate read prevents a descendant dispatch',async()=>{
  const f=await fixture();try{const {first}=await buildThreeCheckpointChain(f);
    for(let order=7;order<9;order+=1) await f.helpers.seedMemoryTurn(f.DB,f.conversationId,order);
    const fired=interceptOnce(f.DB,sql=>sql.includes('INSERT INTO fable_chat_memory_checkpoints'),()=>invalidateCheckpoint(f,first.checkpointId));
    await maintain(f);expect(fired()).toBe(true);expect(f.calls).toHaveLength(3);
    expect(f.DB.database.prepare('SELECT COUNT(*) AS n FROM fable_chat_memory_checkpoints').get().n).toBe(3);
    expect((await select(f)).checkpointId).toBeNull();
  }finally{f.DB.close();}
});
