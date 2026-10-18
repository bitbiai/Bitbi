const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');

for(const name of ['ledger','accept','decline','stale','budget-stop','lost-lease','proposal','stopped','missing-plan','late-proposal','summary']) {
  test(`Canvas autonomous project ${name}`,async()=>{
    const DB=new SqliteD1Database();applyAuthMigrations(DB);
    try {
      const {canvasAgentAutonomyCase}=await import('./helpers/canvas-agent-autonomy-control.mjs');
      const result=await canvasAgentAutonomyCase({...createAuthTestEnv(),DB},name);
      expect(result.case).toBe(name);
      expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    } finally {DB.close();}
  });
}

test('Canvas autonomy forward migration exposes stopped paid plans without resuming or changing their charge',async()=>{
  const fs=require('node:fs'),path=require('node:path'),DB=new SqliteD1Database();
  applyAuthMigrations(DB,{through:'0106_canvas_agent_model_operations.sql'});
  try {
    const {seedCanvasAgentStoppedMigration}=await import('./helpers/canvas-agent-autonomy-control.mjs');
    const f=await seedCanvasAgentStoppedMigration({...createAuthTestEnv(),DB});
    // A plan-shaped receipt alone is not a completed paid result.
    const incomplete=await f.allocate(await f.createRun('incomplete',3000),'plan',127);
    await DB.prepare('UPDATE canvas_agent_steps SET receipt_json=? WHERE id=?').bind(JSON.stringify(f.receipt),incomplete.id).run();
    DB.exec(fs.readFileSync(path.join(process.cwd(),'workers/auth/migrations/0107_canvas_agent_autonomy.sql'),'utf8'));
    const after=await DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(f.runId).first();
    for(const [key,value] of Object.entries(f.before))expect(after[key]).toEqual(value);
    expect(after).toMatchObject({status:'taken_over',plan_json:null,actions:0});
    const proposal=await DB.prepare('SELECT * FROM canvas_agent_proposals WHERE step_id=?').bind(f.stepId).first();
    expect(JSON.parse(proposal.plan_json)).toEqual(f.receipt.plan);
    expect(await DB.prepare('SELECT * FROM canvas_agent_proposals WHERE step_id=?').bind(incomplete.id).first()).toBeNull();
    expect(await DB.prepare('SELECT * FROM canvas_agent_steps WHERE id=?').bind(f.stepId).first()).toEqual(f.beforeStep);
    expect(await DB.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=?').bind(f.beforeAttempt.id).first()).toEqual(f.beforeAttempt);
    expect((await DB.prepare('SELECT * FROM member_credit_ledger WHERE user_id=? ORDER BY id').bind(f.owner).all()).results).toEqual(f.beforeLedger);
    expect((await DB.prepare('PRAGMA table_info(canvas_agent_runs)').all()).results.some(row=>row.name==='purpose')).toBe(false);
    expect((await DB.prepare('SELECT COUNT(*) AS n FROM canvas_nodes WHERE project_id=?').bind(f.project).first()).n).toBe(0);
    const costs=await DB.prepare('SELECT charged,reserved,committed,allocation_credits FROM canvas_agent_step_costs WHERE step_id=?').bind(f.stepId).first();
    expect({...costs}).toEqual({charged:78,reserved:0,committed:78,allocation_credits:127});
    expect(f.messages).toEqual([]);expect(f.unexpected).toEqual([]);
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally {DB.close();}
});
