const { test, expect } = require('@playwright/test');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1.js');
const { createAuthTestEnv } = require('./helpers/auth-worker-harness.js');

test('Canvas agent provider fixtures match only the configured HTTPS account endpoint', async () => {
  const { isCanvasAgentProviderEndpoint } = await import('./helpers/canvas-agent-control.mjs');
  const accountId = 'a'.repeat(32);
  const pathname = `/client/v4/accounts/${accountId}/ai/run`;
  const endpoint = `https://api.cloudflare.com${pathname}`;
  for (const url of [endpoint, new URL(endpoint), `https://API.CLOUDFLARE.COM${pathname}`, `https://api.cloudflare.com:443${pathname}`]) {
    expect(isCanvasAgentProviderEndpoint(url, accountId), String(url)).toBe(true);
  }
  for (const url of [
    `https://api.cloudflare.com.attacker.invalid${pathname}`,
    `https://not-api.cloudflare.com${pathname}`,
    `https://api.cloudflare.com@attacker.invalid${pathname}`,
    `https://attacker@api.cloudflare.com${pathname}`,
    `https://user:secret@api.cloudflare.com${pathname}`,
    `https://attacker.invalid/api.cloudflare.com${pathname}`,
    `https://attacker.invalid/?next=${endpoint}`,
    `http://api.cloudflare.com${pathname}`,
    `https://api.cloudflare.com:8443${pathname}`,
    `https://api.cloudflare.com/client/v4/accounts/${'b'.repeat(32)}/ai/run`,
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run-extra`,
    `${endpoint}/`, `${endpoint}?next=https://attacker.invalid`, `${endpoint}#api.cloudflare.com`,
    pathname, '//api.cloudflare.com' + pathname, 'https://[api.cloudflare.com', 'not a URL', '', null, {},
  ]) {
    expect(isCanvasAgentProviderEndpoint(url, accountId), String(url)).toBe(false);
  }
  expect(isCanvasAgentProviderEndpoint(endpoint, undefined)).toBe(false);
  expect(isCanvasAgentProviderEndpoint(endpoint, accountId + '/ai/run')).toBe(false);
});

for (const [name, method, expected] of [
  ['atomic budget and revocable project execution authority', 'canvasAgentAuthorityCase', { atomicAllocations: 1, existingUsageAttempts: 2, providerSubmissions: 0, walletDebits: 0, manualEditPaused: true }],
  ['duration clarification, explicit delegation, historical replay, controls and manual takeover', 'canvasAgentApiCase', { missingDurationBlocked:true,explicitDelegation:true,historicalReplayPreserved:true,starts: 2, duplicateStarts: 1, providerCalls: 0, foreignDenied: true, manualTakeover: true }],
  ['comic and realism profiles obey hard capability and pricing gates', 'canvasAgentCapabilityCase', { profiles: 2, unavailableRejected: true, unsupportedRejected: true, paidCalls: 0 }],
]) test(`Canvas agent ${name}`, async () => {
  const DB = new SqliteD1Database(); applyAuthMigrations(DB);
  try {
    const controls = await import('./helpers/canvas-agent-control.mjs');
    expect(await controls[method]({ ...createAuthTestEnv(), DB })).toEqual(expected);
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally { DB.close(); }
});

for (const method of ['canvasAssemblyCase', 'canvasInspectionCase', 'canvasAssemblyRetentionCase']) test(`Canvas native control ${method}`, async () => {
  const fs = require('node:fs'), path = require('node:path'), DB = new SqliteD1Database(); applyAuthMigrations(DB);
  const media = Object.fromEntries([['videoBase64','canvas-end-frame.mp4'], ['imageBase64','h3-frame.png'], ['musicBase64','member-music.mp3']].map(([key,name]) => [key, fs.readFileSync(path.join(__dirname,'fixtures/media',name)).toString('base64')]));
  try {
    const controls = await import('./helpers/canvas-assembly-control.mjs');
    expect((await controls[method]({ ...createAuthTestEnv(), DB },media)).providerCalls).toBe(0);
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally { DB.close(); }
});

test('Canvas assembly retention migration preserves historical export dispositions', async () => {
  const fs=require('node:fs'),path=require('node:path'),DB=new SqliteD1Database();
  applyAuthMigrations(DB,{through:'0107_canvas_agent_autonomy.sql'});
  try {
    const {seedCanvasAssemblyRetentionMigration,verifyCanvasAssemblyRetentionMigration}=await import('./helpers/canvas-assembly-control.mjs');
    const {verifyCanvasAssemblyRetentionSchema}=await import('../scripts/lib/canvas-export-readiness.mjs');
    const env={...createAuthTestEnv(),DB},seed=await seedCanvasAssemblyRetentionMigration(env);
    await expect(verifyCanvasAssemblyRetentionSchema(async sql=>(await DB.prepare(sql).all()).results)).rejects.toThrow('retention must preserve');
    DB.exec(fs.readFileSync(path.join(process.cwd(),'workers/auth/migrations/0108_canvas_creative_export_retention.sql'),'utf8'));
    expect(await verifyCanvasAssemblyRetentionMigration(env,seed)).toEqual({historicalRowsUnchanged:2,excludedInputs:6,providerCalls:0});
    await verifyCanvasAssemblyRetentionSchema(async sql=>(await DB.prepare(sql).all()).results);
    const definition=(await DB.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='canvas_assembly_export_preserve'").first()).sql;
    for(const [before,after]of [["'$.version'","'$.VERSION'"],["'saved'","'SAVED'"],["'saved'","' saved '"],['IN (7,8)','IN (7,8,9)'],["state='canvas'","state='CANVAS'"]]) {
      const changed=definition.replace(before,after);expect(changed).not.toBe(definition);
      await expect(verifyCanvasAssemblyRetentionSchema(async()=>[{sql:changed}])).rejects.toThrow('retention must preserve');
    }
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally {DB.close();}
});

test('Canvas timing contract and broken-case controls are discovered by the Worker suite', () => {
  const { execFileSync } = require('node:child_process');
  const result = execFileSync(process.execPath, ['--test', 'tests/canvas-assembly.test.mjs'], { cwd: process.cwd(), encoding: 'utf8' });
  expect(result).toContain('# fail 0');
});

test('Canvas agent creates and durably executes three ordinary generation nodes once', async () => {
  const fs = require('node:fs'), path = require('node:path'), DB = new SqliteD1Database(); applyAuthMigrations(DB);
  const media = Object.fromEntries([['videoBase64','canvas-end-frame.mp4'], ['imageBase64','h3-frame.png'], ['musicBase64','member-music.mp3']].map(([key,name]) => [key, fs.readFileSync(path.join(__dirname,'fixtures/media',name)).toString('base64')]));
  try {
    const { canvasAgentDispatchCase } = await import('./helpers/canvas-agent-control.mjs');
    expect(await canvasAgentDispatchCase({ ...createAuthTestEnv(), DB }, media)).toEqual({ plannerCalls: 1, generationCalls: 3, persistedNodes: 3, exportJobs: 0, finalValidation: 'inspection_pending' });
  } finally { DB.close(); }
});

test('Canvas conversational briefing completes a measured two-minute film from thirteen fresh editable shots', async () => {
  test.setTimeout(90000);
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
  const DB = new SqliteD1Database(); applyAuthMigrations(DB); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-agent-film-'));
  const RealDate=Date;let clock=RealDate.parse('2030-01-01T00:05:00.000Z');
  try {
    global.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
    const { canvasAudioFixture } = await import('./helpers/canvas-audio-control.mjs');
    const { finishCanvasAgentFixture, freshCanvasAgentPlan, isCanvasAgentProviderEndpoint } = await import('./helpers/canvas-agent-control.mjs');
    const { attachCanvasConversation } = await import('./helpers/canvas-agent-conversation-control.mjs');
    const { processCanvasExports, inspectClip } = await import('../services/homepage-ffmpeg-processor/canvas-full-video.mjs');
    const { processCanvasInspections } = await import('../services/homepage-ffmpeg-processor/canvas-media-inspection.mjs');
    const video = path.join(dir, 'source.mp4');
    execFileSync('ffmpeg', ['-v','error','-nostdin','-f','lavfi','-i','testsrc2=size=160x90:rate=24:duration=10','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',video]);
    const b64 = name => fs.readFileSync(path.join(__dirname,'fixtures/media',name)).toString('base64');
    const f = await canvasAudioFixture({ ...createAuthTestEnv(), DB }, { scope: 'agent-two-minute', videoBase64: fs.readFileSync(video).toString('base64'), imageBase64: b64('h3-frame.png'), musicBase64: b64('member-music.mp3') });
    // This fixture crosses a real one-hour generation window. Keep its normal
    // authenticated result-reading session valid for the simulated production.
    await DB.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').bind(new Date(clock+3*3600000).toISOString(),f.owner).run();
    const basePlan = freshCanvasAgentPlan(), node = basePlan.nodes[0];
    const nodes = Array.from({ length: 13 }, (_, index) => ({ ...structuredClone(node), key: `scene${index + 1}`, title: `Scene ${index + 1}`, prompt: `Shot ${index + 1}: ${basePlan.nodes[index % 3].prompt}`, config: { ...node.config, duration: 10 } }));
    // 12 full10s shots +6s final trim -12 half-second overlaps =120s.
    const plan = { ...basePlan, nodes, assembly: { ...basePlan.assembly, targetDurationSeconds: 120,
      clips: nodes.map((node,index) => ({ key: node.key, trim: { start: 0, duration: index === 12 ? 6 : 10 }, transition: index === 12 ? { preset: 'none' } : { preset: 'fade', duration: .5 } })) } };
    const beforeFetch = f.env.__TEST_FETCH;
    f.env.__TEST_FETCH = async (url, init) => {
      const response = await beforeFetch(url, init);
      if (!isCanvasAgentProviderEndpoint(url, f.env.CLOUDFLARE_ACCOUNT_ID)) return response;
      const body = await response.json(); body.result.result.task.duration = 10; body.result.result.task.usage.output_seconds = 10;
      return Response.json(body);
    };
    const processingOptions = { baseUrl: 'https://bitbi.ai', limit: 1, authHeaders: headers => ({ Authorization: 'Bearer synthetic-audio-processor', ...headers }),
      requestJson: async (url, init = {}) => { const response = await f.request(url, init.method || 'GET', init.body, { Authorization: 'Bearer synthetic-audio-processor', ...init.headers }); const body = await response.json(); expect(response.ok, JSON.stringify(body)).toBe(true); return body; },
      fetchImpl: (url, init) => f.request(url.pathname + url.search, 'GET', null, init.headers) };
    const processor = async () => { await processCanvasInspections(processingOptions); await processCanvasExports(processingOptions); };
    // Start at a fixed point INSIDE the limiter's hourly window. Using the
    // current minute could accidentally cross a boundary and conceal the 13th
    // request's real admission limit. Keep existing limits and accepted costs.
    const conversation=await attachCanvasConversation(f,{scope:'two-minute-briefing'});
    await conversation.approve(3000);
    let brief=await conversation.exchange('I want a film about Amish people constructing a house in a small town. A neighboring pool has ducks. After the house is complete, visitors arrive to celebrate.',{
      text:'We can tell that as a construction story ending with a welcoming celebration.',fields:{story:'Amish builders construct a small-town house; ducks swim in the neighboring pool; visitors celebrate after completion.',setting:'A small town, with the same house and pool in fixed positions.',style:'realistic documentary'}});
    expect(brief.brief.duration.asked).toBe(true);expect(brief.brief.duration.choice).toBeNull();
    const premature=await conversation.start({budgetCredits:10000});expect(premature.response.status).toBe(400);
    expect((await premature.response.json()).code).toBe('canvas_agent_duration_required');expect(f.calls).toHaveLength(0);
    brief=await conversation.exchange('Roughly two minutes, please.',{text:'The film target is about two minutes, with the house, duck pool and visiting guests kept consistent.',intent:'ready'});
    expect(brief.brief.duration.targetDurationSeconds).toBe(120);
    const authorized=await conversation.start({budgetCredits:10000}),admitted=await conversation.data(authorized.response);
    expect(conversation.calls).toHaveLength(2);conversation.restore();
    let finished,waitedRun=null,waits=0;
    const worker=(await import('../workers/auth/src/index.js')).default;
    try {
      finished = await finishCanvasAgentFixture({ f, processor, targetSeconds: 120, planOverride: plan, budgetCredits: 10000, admittedRunId:admitted.run.id,beforeTurn: async(turn,{runId}) => {
        const run=await DB.prepare('SELECT status,phase,next_attempt_at FROM canvas_agent_runs WHERE id=?').bind(runId).first();
        if(run.phase!=='waiting_limit'){clock+=60000;return;}
        waits++;
        const retryAt=Date.parse(run.next_attempt_at);
        expect(retryAt).toBeGreaterThan(clock);expect(f.calls).toHaveLength(12);
        const pending=await DB.prepare("SELECT id,idempotency_key,usage_attempt_id,output_json FROM canvas_runs WHERE project_id=? AND error_code='canvas_agent_admission_wait'").bind(f.project).first();
        expect(pending).toBeTruthy();expect(pending.usage_attempt_id).toBeNull();waitedRun=pending;
        expect((await DB.prepare('SELECT COUNT(*) AS n FROM member_generation_jobs WHERE canvas_run_id=?').bind(pending.id).first()).n).toBe(0);
        const debits=(await DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n;
        await worker.queue({queue:'bitbi-ai-video-jobs',messages:[0,1].map(()=>({body:{type:'canvas_agent.process',run_id:runId},attempts:1,ack(){},retry(){throw new Error('Waiting duplicate delivery must acknowledge');}}))},f.env,{waitUntil(){throw new Error('No browser or detached recovery');}});
        expect(f.calls).toHaveLength(12);
        expect((await DB.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n).toBe(debits);
        expect((await DB.prepare('SELECT id FROM canvas_runs WHERE idempotency_key=? AND user_id=?').bind(pending.idempotency_key,f.owner).first()).id).toBe(pending.id);
        clock=retryAt+1;
      } });
    } finally { global.Date = RealDate; }
    expect(waits).toBe(1);expect(waitedRun).toBeTruthy();
    const resumed=(await DB.prepare('SELECT id,status FROM canvas_runs WHERE idempotency_key=? AND user_id=?').bind(waitedRun.idempotency_key,f.owner).all()).results;
    expect(resumed).toEqual([{id:waitedRun.id,status:'completed'}]);
    expect(finished.generationCalls).toBe(13); expect(finished.plannerCalls).toBe(1);
    expect(finished.output.recipe.videos).toHaveLength(13); expect(finished.output.recipe.transitions).toHaveLength(12);
    const file = path.join(dir, 'complete.mp4'); fs.writeFileSync(file, Buffer.from(await (await f.request(finished.output.asset.file_url)).arrayBuffer()));
    const measured = await inspectClip(file); expect(measured.videoDuration).toBe(120);
    execFileSync('ffmpeg', ['-v','error','-xerror','-i',file,'-f','null','-']);
    const reopened = await f.readProject(); expect(reopened.project.assembly.clips.map(clip => clip.nodeId)).toEqual(finished.order);
    expect(reopened.nodes.filter(node => finished.order.includes(node.id))).toHaveLength(13);
    expect(f.calls).toHaveLength(13);
  } finally { global.Date=RealDate;DB.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const evaluationRejectCount of [1, 2]) test(`Canvas sampled review creates one explicit variant and ${evaluationRejectCount === 1 ? 'accepts the revision' : 'stops at its quality limit'}`, async () => {
  test.setTimeout(60000);
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
  const DB = new SqliteD1Database(); applyAuthMigrations(DB); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-agent-repair-'));
  try {
    const { canvasAudioFixture } = await import('./helpers/canvas-audio-control.mjs');
    const { finishCanvasAgentFixture, freshCanvasAgentPlan } = await import('./helpers/canvas-agent-control.mjs');
    const { processCanvasExports } = await import('../services/homepage-ffmpeg-processor/canvas-full-video.mjs');
    const { processCanvasInspections } = await import('../services/homepage-ffmpeg-processor/canvas-media-inspection.mjs');
    const video = path.join(dir, 'source.mp4');
    execFileSync('ffmpeg', ['-v','error','-nostdin','-f','lavfi','-i','testsrc2=size=160x90:rate=24:duration=4','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',video]);
    const b64 = name => fs.readFileSync(path.join(__dirname,'fixtures/media',name)).toString('base64');
    const f = await canvasAudioFixture({ ...createAuthTestEnv(), DB }, { scope: 'agent-repair-'+evaluationRejectCount, videoBase64: fs.readFileSync(video).toString('base64'), imageBase64: b64('h3-frame.png'), musicBase64: b64('member-music.mp3') });
    const options = { baseUrl: 'https://bitbi.ai', limit: 1, authHeaders: headers => ({ Authorization: 'Bearer synthetic-audio-processor', ...headers }),
      requestJson: async (url, init = {}) => { const response = await f.request(url, init.method || 'GET', init.body, { Authorization: 'Bearer synthetic-audio-processor', ...init.headers }); const body = await response.json(); expect(response.ok, JSON.stringify(body)).toBe(true); return body; },
      fetchImpl: (url, init) => f.request(url.pathname + url.search, 'GET', null, init.headers) };
    const processor = async () => { await processCanvasInspections(options); await processCanvasExports(options); };
    const finished = await finishCanvasAgentFixture({ f, processor, targetSeconds: 12, planOverride: freshCanvasAgentPlan(), evaluationRejectCount });
    expect(finished.generationCalls).toBe(4); expect(finished.plannerCalls).toBe(2); expect(finished.evaluationCalls).toBe(2);
    const variants = (await DB.prepare('SELECT node_id,COUNT(*) AS n FROM canvas_runs WHERE node_id IN (?,?,?) GROUP BY node_id ORDER BY n').bind(...finished.order).all()).results;
    expect(variants.map(row => row.n)).toEqual([1,1,2]);
    expect(finished.status).toBe(evaluationRejectCount === 1 ? 'completed' : 'review_required');
    if (evaluationRejectCount === 1) expect(finished.output.duration).toBe(12);
    else expect((await DB.prepare('SELECT COUNT(*) AS n FROM canvas_video_processing WHERE project_id=?').bind(f.project).first()).n).toBe(0);
  } finally { DB.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Canvas accepted late completion is saved after cancellation without overwriting manual edits', async () => {
  const fs = require('node:fs'), path = require('node:path'), DB = new SqliteD1Database(); applyAuthMigrations(DB);
  const media = Object.fromEntries([['videoBase64','canvas-end-frame.mp4'], ['imageBase64','h3-frame.png'], ['musicBase64','member-music.mp3']].map(([key,name]) => [key, fs.readFileSync(path.join(__dirname,'fixtures/media',name)).toString('base64')]));
  try {
    const { canvasAgentLateCompletionCase } = await import('./helpers/canvas-agent-control.mjs');
    expect(await canvasAgentLateCompletionCase({ ...createAuthTestEnv(), DB }, media)).toEqual({ providerCalls: 3, cancelled: true, manualChoicePreserved: true, historicalAssetSaved: true, ordinaryEdgeFenced:true,musicEdgeSafe:true });
  } finally { DB.close(); }
});

test('Canvas generic provider429 remains uncertain and is never retried as an internal admission wait', async()=>{
  const fs=require('node:fs'),path=require('node:path'),DB=new SqliteD1Database();applyAuthMigrations(DB);
  const media=Object.fromEntries([['videoBase64','canvas-end-frame.mp4'],['imageBase64','h3-frame.png'],['musicBase64','member-music.mp3']].map(([key,name])=>[key,fs.readFileSync(path.join(__dirname,'fixtures/media',name)).toString('base64')]));
  try {
    const {canvasAgentUnknownProviderCase}=await import('./helpers/canvas-agent-control.mjs');
    expect(await canvasAgentUnknownProviderCase({...createAuthTestEnv(),DB},media)).toEqual({providerCalls:1,reviewRequired:true,reservationRetained:true});
  } finally {DB.close();}
});

test('Canvas manual generation takeover excludes invalid requests and pending/completed replays', async () => {
  const fs = require('node:fs'), path = require('node:path'), DB = new SqliteD1Database(); applyAuthMigrations(DB);
  const media = Object.fromEntries([['videoBase64','canvas-end-frame.mp4'], ['imageBase64','h3-frame.png'], ['musicBase64','member-music.mp3']].map(([key,name]) => [key, fs.readFileSync(path.join(__dirname,'fixtures/media',name)).toString('base64')]));
  try {
    const { canvasAgentManualTakeoverCase } = await import('./helpers/canvas-agent-control.mjs');
    expect(await canvasAgentManualTakeoverCase({ ...createAuthTestEnv(), DB },media)).toEqual({ invalidRequestsReadOnly:true,newRunPaused:true,pendingRecoveryReadOnly:true,completedReplayReadOnly:true,providerCalls:1 });
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally { DB.close(); }
});
