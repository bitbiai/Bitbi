import { canvasAgentEnvironment, canvasAgentSession, canvasAgentUsageMetadata } from '../../workers/auth/src/lib/canvas-agent-authority.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { beginMemberAiUsageAttempt, markMemberAiUsageAttemptProviderRunning } from '../../workers/auth/src/lib/member-ai-usage-attempts.js';
import { topUpMemberDailyCredits, grantMemberCredits } from '../../workers/auth/src/lib/billing.js';
import worker from '../../workers/auth/src/index.js';
import { getModelTariff } from '../../workers/auth/src/lib/model-tariffs.js';

const check = (value, message) => { if (!value) throw new Error(message); };

export function isCanvasAgentProviderEndpoint(value, accountId) {
  if (typeof value !== 'string' && !(value instanceof URL)) return false;
  if (typeof accountId !== 'string' || !/^[a-f0-9]{32}$/.test(accountId)) return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://api.cloudflare.com'
      && url.username === '' && url.password === ''
      && url.pathname === `/client/v4/accounts/${accountId}/ai/run`
      && url.search === '' && url.hash === '';
  } catch { return false; }
}

async function rejected(operation, fragment) {
  try { await operation(); } catch (error) {
    const details = [error, error?.cause, error?.cause?.cause].map(item => `${item?.code || ''} ${item?.message || item || ''}`).join('\n');
    check(details.includes(fragment), `Expected ${fragment}; got ${details}`);
    return;
  }
  throw new Error(`Expected rejection: ${fragment}`);
}

// Executes against native D1 and the actual production authority/accounting
// helpers. No browser identity, provider call or paid service is used.
export async function canvasAgentAuthorityCase(env) {
  const db = env.DB, owner = 'canvas-agent-authority-member', now = new Date().toISOString();
  const id = async suffix => (await sha256Hex(owner + suffix)).slice(0, 32);
  const project = await id('project'), run = await id('run'), step = await id('step'), modelId = 'xai/grok-4.7';
  await db.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,?,?,'user','active',?)").bind(owner, owner + '@example.invalid', 'synthetic', now, now).run();
  await topUpMemberDailyCredits({ env, userId: owner });
  await grantMemberCredits({ env, userId: owner, amount: 1000, createdByUserId: owner, idempotencyKey: 'agent-authority-credits' });
  await db.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,'Authority fixture','en',?,?)").bind(project, owner, now, now).run();
  await db.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,expected_revision,budget_credits,next_attempt_at,created_at,updated_at,expires_at)
    VALUES(?,?,?,?,'{}','planning',0,10,?,?,?,?)`).bind(run, project, owner, run, now, now, now, new Date(Date.now() + 3600000).toISOString()).run();
  const allocate = (stepId, key, credits) => db.prepare(`INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,input_json,allocation_credits,created_at,updated_at)
    VALUES(?,?,?,'plan',?,?,?,?)`).bind(stepId, run, key, JSON.stringify({ modelId }), credits, now, now).run();
  const competing = await Promise.allSettled([allocate(step, 'plan', 6), allocate(await id('loser'), 'other', 6)]);
  check(competing.filter(result => result.status === 'fulfilled').length === 1, 'Exactly one concurrent allocation must fit the cap');
  check(competing.filter(result => result.status === 'rejected').every(result => String(result.reason).includes('canvas_agent_budget_exceeded')), 'Cap rejection must come from the real atomic trigger');
  const winning = await db.prepare('SELECT * FROM canvas_agent_steps WHERE run_id=?').bind(run).first();
  check(winning.allocation_credits === 6, 'Winning allocation preserved without wallet debit');
  check((await db.prepare("SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0").bind(owner).first()).n === 0, 'Allocation is not a second credit charge');
  await rejected(() => db.prepare('UPDATE canvas_agent_steps SET allocation_credits=9 WHERE id=?').bind(winning.id).run(), 'canvas_agent_step_immutable');
  await db.prepare('UPDATE canvas_agent_runs SET lease_token=?,lease_until=? WHERE id=?').bind('synthetic-live-lease',new Date(Date.now()+600000).toISOString(),run).run();
  const authority = { runId: run, stepId: winning.id, projectId: project, userId: owner, leaseToken: 'synthetic-live-lease' };
  const scoped = canvasAgentEnvironment(env, authority), request = new Request(`https://bitbi.ai/api/account/canvas/projects/${project}/agent`);
  check((await canvasAgentSession(request, scoped))?.user.id === owner, 'Actual in-process project authority succeeds');
  check((await canvasAgentSession(request, Object.create(scoped)))?.user.id === owner, 'Inherited execution scope remains recognized');
  await rejected(() => canvasAgentSession(request, canvasAgentEnvironment(env, { ...authority, leaseToken: 'stale-lease' })), 'canvas_agent_authority_revoked');
  const forged = new Request(request, { headers: { 'X-Canvas-Agent-Authority': JSON.stringify(authority) } });
  check(await canvasAgentSession(forged, env) === null, 'A serialized/browser authority must never authenticate');
  await rejected(() => canvasAgentSession(new Request(`https://bitbi.ai/api/account/canvas/projects/${'a'.repeat(32)}/nodes/${'b'.repeat(32)}/run`), scoped), 'canvas_agent_authority_revoked');
  await rejected(() => canvasAgentSession(new Request('https://bitbi.ai/api/admin/users'), scoped), 'canvas_agent_authority_revoked');
  await rejected(() => canvasAgentUsageMetadata(scoped, request, { userId: owner, modelId, credits: 7 }), 'canvas_agent_authority_revoked');
  await rejected(() => canvasAgentUsageMetadata(scoped, request, { userId: owner, modelId: 'xai/grok-4.6', credits: 6 }), 'canvas_agent_authority_revoked');
  const metadata = await canvasAgentUsageMetadata(scoped, request, { userId: owner, modelId, credits: 6 });
  const attemptInput = { env: scoped, userId: owner, featureKey: 'ai_text', operationKey: 'member.text.generate', route: new URL(request.url).pathname,
    idempotencyKey: 'agent-authority-paid-identity', requestFingerprint: 'a'.repeat(64), creditCost: 6, metadata };
  const reservation = await beginMemberAiUsageAttempt(attemptInput);
  check(reservation.kind === 'reserved', 'Existing member gateway reserves once');
  const repeated = await beginMemberAiUsageAttempt(attemptInput);
  check(repeated.attempt.id === reservation.attempt.id, 'Exact duplicate uses the original member usage identity');
  await db.prepare('UPDATE canvas_agent_steps SET usage_attempt_id=? WHERE id=?').bind(reservation.attempt.id,winning.id).run();
  const acceptedStep = await id('accepted-step'); await allocate(acceptedStep,'accepted',4);
  const acceptedEnv = canvasAgentEnvironment(env,{...authority,stepId:acceptedStep});
  const acceptedMetadata = await canvasAgentUsageMetadata(acceptedEnv,request,{userId:owner,modelId,credits:4});
  const accepted = await beginMemberAiUsageAttempt({...attemptInput,env:acceptedEnv,idempotencyKey:'agent-authority-accepted-paid-identity',requestFingerprint:'b'.repeat(64),creditCost:4,metadata:acceptedMetadata});
  await db.prepare('UPDATE canvas_agent_steps SET usage_attempt_id=? WHERE id=?').bind(accepted.attempt.id,acceptedStep).run();
  await markMemberAiUsageAttemptProviderRunning(acceptedEnv,accepted.attempt.id);
  await db.prepare("UPDATE canvas_agent_runs SET status='cancelled' WHERE id=?").bind(run).run();
  await rejected(() => canvasAgentSession(request, scoped), 'canvas_agent_authority_revoked');
  await rejected(() => markMemberAiUsageAttemptProviderRunning(scoped, reservation.attempt.id), 'canvas_agent_authority_revoked');
  check((await db.prepare('SELECT provider_outcome FROM member_ai_usage_attempts_v2 WHERE id=?').bind(reservation.attempt.id).first()).provider_outcome === 'not_dispatched', 'Cancellation fences provider dispatch before any accepted work');
  const {releaseCanvasAgentUndispatched}=await import('../../workers/auth/src/lib/canvas-agent-store.js');
  await releaseCanvasAgentUndispatched(env,run); await releaseCanvasAgentUndispatched(env,run);
  const stopped=await db.prepare('SELECT billing_status,reservation_released_at FROM member_ai_usage_attempts_v2 WHERE id=?').bind(reservation.attempt.id).first();
  const committed=await db.prepare('SELECT provider_outcome,billing_status,reservation_released_at FROM member_ai_usage_attempts_v2 WHERE id=?').bind(accepted.attempt.id).first();
  check(stopped.billing_status==='released'&&stopped.reservation_released_at,'Repeated cancellation releases an undispatched reservation once');
  check(committed.provider_outcome==='dispatched'&&committed.billing_status==='reserved'&&!committed.reservation_released_at,'Cancellation cannot refund accepted or uncertain provider work');
  await db.prepare("UPDATE canvas_agent_runs SET status='planning' WHERE id=?").bind(run).run();
  await db.prepare("UPDATE canvas_projects SET revision=revision+1 WHERE id=?").bind(project).run();
  const paused = await db.prepare('SELECT status,error_code FROM canvas_agent_runs WHERE id=?').bind(run).first();
  check(paused.status === 'paused' && paused.error_code === 'canvas_agent_project_changed', 'Manual revision automatically pauses old execution');
  await rejected(() => canvasAgentSession(request, scoped), 'canvas_agent_authority_revoked');
  const staleId = await id('stale');
  await rejected(() => allocate(staleId, 'stale', 1), 'canvas_agent_budget_exceeded');
  return { atomicAllocations: 1, existingUsageAttempts: 2, providerSubmissions: 0, walletDebits: 0, manualEditPaused: true };
}

export async function canvasAgentApiCase(base) {
  const db = base.DB, owner = 'canvas-agent-api-member', foreign = 'canvas-agent-api-other', now = new Date().toISOString();
  const project = (await sha256Hex(owner + '-project')).slice(0, 32), messages = [], providerCalls = [], waits = [];
  const env = { ...base, CANVAS_AGENT_ENABLED: 'true', ENABLE_GROK_4_7: 'true',
    AI_SERVICE_AUTH_SECRET: 'canvas-agent-native-synthetic-only',
    CLOUDFLARE_ACCOUNT_ID:'0'.repeat(32),H3_CLOUDFLARE_API_TOKEN:'synthetic-workers-ai-read',
    AI_VIDEO_JOBS_QUEUE: { async send(body) { messages.push(body); } },
    PRIVATE_MEDIA_PROCESSOR: { async fetch() { throw new Error('Unexpected processor request before production'); } },
    AI_LAB: { async fetch(request) {
      if (new URL(request.url).pathname === '/internal/ai/canvas-agent/readiness') {
        const ai = (await import('../../workers/ai/src/index.js')).default;
        return ai.fetch(request, { ENABLE_GROK_4_7: 'true', AI_SERVICE_AUTH_SECRET: 'canvas-agent-native-synthetic-only',
          SERVICE_AUTH_REPLAY: base.SERVICE_AUTH_REPLAY || base.PUBLIC_RATE_LIMITER,
          AI: { run() { throw new Error('Readiness cannot perform inference'); } } }, { waitUntil() {} });
      }
      providerCalls.push(new URL(request.url).pathname); throw new Error('Unexpected provider request before queue delivery');
    } },
  };
  for (const user of [owner, foreign]) {
    await db.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,?,?,'user','active',?)").bind(user, user + '@example.invalid', 'synthetic', now, now).run();
    await db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
      .bind(user, user, await sha256Hex(`${user}:${env.SESSION_HASH_SECRET}`), now, new Date(Date.now() + 3600000).toISOString(), now).run();
  }
  await topUpMemberDailyCredits({ env, userId: owner });
  await grantMemberCredits({ env, userId: owner, amount: 10000, createdByUserId: owner, idempotencyKey: 'agent-api-credits' });
  await db.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,'Agent API fixture','de',?,?)").bind(project, owner, now, now).run();
  const route = `/api/account/canvas/projects/${project}/agent`, revision = (await getModelTariff(env)).revision;
  let requestNumber = 0;
  const request = (path, body, key, user = owner, tariff = revision) => worker.fetch(new Request('https://bitbi.ai' + path, {
    method: body ? 'POST' : 'GET', headers: { Origin: 'https://bitbi.ai', Cookie: `__Host-bitbi_session=${user}`,
      'Content-Type': 'application/json', 'CF-Connecting-IP': `192.0.2.${++requestNumber}`, 'X-Bitbi-Tariff-Revision': String(tariff), ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env, { waitUntil(promise) { waits.push(promise); } });
  const bodyOf = async (response, status) => { const body = await response.json(); check(response.status === status, `Agent API expected ${status}, got ${response.status}/${body.code}`); return body; };
  const brief = 'A comic film about building a house next to a pool with ducks.';
  await bodyOf(await request(route, { brief, expectedRevision: 0, locale: 'de' }, 'agent-api-no-consent'), 400);
  check(messages.length === 0 && providerCalls.length === 0, 'Missing credit consent cannot queue or run inference');
  const missingInput={brief,expectedRevision:0,budgetCredits:10000,locale:'de'};
  const missing=await bodyOf(await request(route,missingInput,'agent-api-missing-duration'),202);
  check(missing.data.run.status==='clarification_required'&&missing.data.run.clarification.field==='duration','Omitted duration asks before any planning authority');
  check(messages.length===0&&providerCalls.length===0,'Missing duration never queues inference or media');
  check((await bodyOf(await request(route,missingInput,'agent-api-missing-duration'),200)).data.run.id===missing.data.run.id,'Clarification replay retains the original identity');
  const historicalId=(await sha256Hex(owner+'-historical')).slice(0,32);
  await db.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,expected_revision,target_seconds,budget_credits,next_attempt_at,created_at,updated_at,expires_at)
    VALUES(?,?,?,?,?,'completed',0,NULL,10000,?,?,?,?)`).bind(historicalId,project,owner,'agent-api-historical-duration',JSON.stringify(missingInput),now,now,now,new Date(Date.now()+3600000).toISOString()).run();
  const historical=await bodyOf(await request(route,missingInput,'agent-api-historical-duration'),200);
  check(historical.data.run.id===historicalId&&historical.data.run.status==='completed'&&historical.data.idempotentReplay===true&&messages.length===0,'Historically accepted automatic input remains replayable without reinterpretation or paid resubmission');
  const automatic = await bodyOf(await request(route, { ...missingInput,durationChoice:'delegated' }, 'agent-api-delegated-duration'), 202);
  check(automatic.data.run.status==='queued'&&automatic.data.run.targetDurationSeconds===null,'An explicit duration delegation can authorize a creative target');
  check(messages.length===1&&providerCalls.length===0,'Start only wakes durable work, without browser-bound inference');
  check((await db.prepare('SELECT COUNT(*) AS n FROM member_ai_usage_attempts_v2 WHERE user_id=?').bind(owner).first()).n === 0, 'Start allocation is not a wallet reservation or charge');
  await bodyOf(await request(`${route}/${automatic.data.run.id}/control`,{action:'takeover'},'agent-api-auto-takeover'),200);
  await bodyOf(await request(route, undefined, undefined, foreign), 404);
  const input = { brief, targetDurationSeconds: 12, expectedRevision: 0, budgetCredits: 10000, locale: 'de' };
  const started = await bodyOf(await request(route, input, 'agent-api-start'), 202), run = started.data.run;
  check(run.status === 'queued' && run.targetDurationSeconds === 12, 'Supplied duration starts without another clarification');
  check(messages.length === 2 && messages[1].type === 'canvas_agent.process' && messages[1].run_id === run.id, 'One existing-queue wake identity per new run');
  const duplicate = await bodyOf(await request(route, input, 'agent-api-start'), 200);
  check(duplicate.data.run.id === run.id && messages.length === 2, 'Duplicate start preserves run and wake identity');
  await bodyOf(await request(route, { ...input, brief: 'Changed input' }, 'agent-api-start'), 409);
  await bodyOf(await request(route, input, 'agent-api-other-start'), 409);
  const control = `${route}/${run.id}/control`;
  await bodyOf(await request(control, { action: 'pause' }, 'agent-api-pause', foreign), 404);
  check((await bodyOf(await request(control, { action: 'pause' }, 'agent-api-pause'), 200)).data.run.status === 'paused', 'Pause is durable');
  check((await bodyOf(await request(control, { action: 'pause' }, 'agent-api-pause'), 200)).data.idempotentReplay === true, 'Duplicate control is replay safe');
  check((await bodyOf(await request(control, { action: 'resume' }, 'agent-api-resume'), 200)).data.run.status === 'queued', 'Resume retains the original request');
  await db.prepare('UPDATE canvas_projects SET revision=revision+1 WHERE id=?').bind(project).run();
  check((await bodyOf(await request(route), 200)).data.run.status === 'paused', 'Reopen observes manual edit pause');
  await bodyOf(await request(control, { action: 'resume' }, 'agent-api-stale-resume'), 409);
  check((await bodyOf(await request(control, { action: 'takeover' }, 'agent-api-takeover'), 200)).data.run.status === 'taken_over', 'Manual takeover revokes execution');
  check(providerCalls.length === 0, 'Editing, reopening and controls cannot submit generation');
  await Promise.all(waits);
  return { missingDurationBlocked:true,explicitDelegation:true,historicalReplayPreserved:true,starts: 2, duplicateStarts: 1, providerCalls: 0, foreignDenied: true, manualTakeover: true };
}

// Reuses an owned media fixture while exercising the real signed AI Worker,
// member credit gateway, durable queue, guarded graph writes and export routes.
// processor is a caller-owned real FFmpeg executor; no browser drives the run.
export async function finishCanvasAgentFixture({ f, processor, targetSeconds = 16, order = f.order, generate = false, planOverride = null, stopAtExport = false, stopBeforeEvaluation = false, budgetCredits = 5000, beforeTurn = () => {}, legacyProjectionGap = false, evaluationRejectCount = 0, expectedTerminal = null,deliverGeneration=null, admittedRunId=null }) {
  const aiWorker = (await import('../../workers/ai/src/index.js')).default;
  const plannerCalls = [], evaluationCalls = [], callbacks = [], providerBaseline = f.calls.length;
  const oldAiLab = f.env.AI_LAB,oldProviderFetch=f.env.__TEST_FETCH; let rejectedNode = null;
  f.env.CANVAS_AGENT_ENABLED = 'true'; f.env.ENABLE_GROK_4_7 = 'true';
  f.env.AI_SERVICE_AUTH_SECRET = 'synthetic-canvas-agent-service-secret';
  f.env.CLOUDFLARE_ACCOUNT_ID||='0'.repeat(32);f.env.H3_CLOUDFLARE_API_TOKEN||='synthetic-workers-ai-read';
  f.env.PRIVATE_MEDIA_PROCESSOR ||= { async fetch() { return Response.json({ ok: true }); } };
  const plan = planOverride || { version: 1, title: 'Editable synthetic production', continuity: 'The same house and pool remain in place. Source colors are controlled test media.',
    nodes: [], updates: generate ? [{ nodeId: f.nodes[0], prompt: 'A red house beside the pool, stable composition.', config: {} }] : [],
    assembly: { clips: order.map(id => ({ key: `existing:${id}`, trim: { start: 0, duration: targetSeconds / order.length }, transition: { preset: 'none' } })),
      musicKey: null, targetDurationSeconds: targetSeconds, toleranceSeconds: .5, backgroundMusic: { enabled: false, gain: 1 }, smoothJoins: false } };
  const providerResponse=async(model,input,options)=>{
        check(model === 'xai/grok-4.7', 'Actual planner model'); check(options.gateway.collectLog === false && options.gateway.skipCache === true, 'Private planner gateway');
        check(input.messages.length === 2 && !input.tools, 'Canvas planner never gets administrator tools');
        const evaluation = input.response_format.json_schema.name === 'bitbi_canvas_evaluation_v1';
        (evaluation ? evaluationCalls : plannerCalls).push(input);
        let content = plan;
        if (evaluation) {
          const context = JSON.parse(input.messages[1].content[0].text);
          rejectedNode = context.frames[0].nodeId;
          const accepted = evaluationCalls.length > evaluationRejectCount;
          content = { accepted, issues: accepted ? [] : [{ nodeId: rejectedNode, reason: 'The sampled house geometry does not match the intended continuity.' }], confidence: 'medium', samplingLimit: 'Only selected still frames were reviewed; this does not establish motion or unseen content.' };
        } else if (plannerCalls.length > 1) {
          const context = JSON.parse(input.messages[1].content), existing = context.currentProject.nodes.find(node => node.id === rejectedNode);
          check(existing, 'Targeted repair reads the current existing node');
          content = { ...plan, nodes: [], updates: [{ nodeId: rejectedNode, prompt: 'Intentional variant: ' + (existing.content.prompt || existing.config.prompt), config: {} }],
            assembly: { ...plan.assembly, clips: context.currentProject.assembly.clips.map(({nodeId,trim,transition}) => ({key:`existing:${nodeId}`,trim,transition})) } };
        }
        return { id: evaluation ? 'synthetic-agent-evaluation' : 'synthetic-agent-plan', object: 'chat.completion', model: 'grok-4.7', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }], usage: { prompt_tokens: 120, completion_tokens: 200, total_tokens: 320 } };
  };
  f.env.AI_LAB = { async fetch(request) {
    return aiWorker.fetch(request, { ENABLE_GROK_4_7: 'true', AI_SERVICE_AUTH_SECRET: f.env.AI_SERVICE_AUTH_SECRET,
      SERVICE_AUTH_REPLAY: f.env.SERVICE_AUTH_REPLAY || f.env.PUBLIC_RATE_LIMITER,
      AI: {run(){throw new Error('Canvas background preparation/normalization cannot dispatch through AI.run');}} },
      {waitUntil(){throw new Error('Canvas model result must not rely on detached inference');}});
  } };
  f.env.__TEST_FETCH=async(url,init)=>{
    const body=isCanvasAgentProviderEndpoint(url,f.env.CLOUDFLARE_ACCOUNT_ID)&&init?.body?JSON.parse(init.body):null;
    if(body?.model!=='xai/grok-4.7')return oldProviderFetch(url,init);
    check(String(url)===`https://api.cloudflare.com/client/v4/accounts/${f.env.CLOUDFLARE_ACCOUNT_ID}/ai/run`&&init.method==='POST','Exact existing REST provider endpoint');
    check(body.options.background===true&&body.options.webhookUrl.startsWith('https://bitbi.ai/api/internal/ai/canvas-agent-result/'),'Durable signed callback');
    const headers=new Headers(init.headers);
    check(headers.get('cf-aig-collect-log')==='false'&&headers.get('cf-aig-max-attempts')==='1','Private single-attempt REST model transport');
    const response=await providerResponse(body.model,body.input,{gateway:{collectLog:headers.get('cf-aig-collect-log')!=='false',skipCache:headers.get('cf-aig-skip-cache')==='true'}});
    const id='synthetic-'+(plannerCalls.length+evaluationCalls.length);
    callbacks.push({url:body.options.webhookUrl,body:{id,state:'Completed',model:body.model,provider:'xai',result:response,error:null}});
    return Response.json({success:true,result:{id,state:'Queued'},errors:[],messages:[]});
  };
  try {
  const before = await f.readProject(), revision = (await getModelTariff(f.env)).revision;
  let runId=admittedRunId;
  if(runId) {
    const admitted=await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=? AND project_id=? AND user_id=?').bind(runId,f.project,f.owner).first();
    check(admitted?.status==='queued'&&admitted.expected_revision===before.project.revision&&admitted.target_seconds===targetSeconds,
      'Conversational handoff must already have admitted this exact project, revision and duration');
    check(admitted.budget_credits===budgetCredits,'Conversational handoff retains the explicitly authorized production cap');
  } else {
    const response = await f.request(f.projectPath + '/agent', 'POST', { brief: `Create this ${targetSeconds} second film with editable sources.`, targetDurationSeconds: targetSeconds,
      expectedRevision: before.project.revision, budgetCredits }, { 'Idempotency-Key': 'native-agent-production-start', 'X-Bitbi-Tariff-Revision': String(revision) });
    const started = await response.json(); check(response.status === 202, `Agent production admission: ${response.status}/${started.code}`);
    runId = started.data.run.id;
  }
  const expectedOrder = planOverride ? await Promise.all(plan.assembly.clips.map(async clip => clip.key.startsWith('existing:') ? clip.key.slice(9) : (await sha256Hex(`canvas-agent-node:${runId}:0:${clip.key}`)).slice(0,32))) : order;
  const exportEndpoint = `${f.projectPath}/nodes/${expectedOrder.at(-1)}/full-video`;
  const expectedGeneration = planOverride ? plan.nodes.filter(node => node.type !== 'note').length + (plan.updates?.length || 0) : generate ? 1 : 0;
  let current;
  for (let turn = 0; turn < Math.min(180, expectedGeneration * 4 + 24); turn++) {
    await beforeTurn(turn,{runId});
    // Advance only the durable wake timestamp; the run still uses the real lease
    // and queue handler. This represents each scheduled wake without wall waits.
    await f.db.prepare("UPDATE canvas_agent_runs SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(runId).run();
    const message = { type: 'canvas_agent.process', run_id: runId }, acknowledgements = [];
    await worker.queue({ queue: 'bitbi-ai-video-jobs', messages: [0, 1].map(() => ({ body: message, attempts: 1, ack() { acknowledgements.push('ack'); }, retry() { throw new Error('Unexpected agent queue retry'); } })) }, f.env, { waitUntil() { throw new Error('Agent must not detach work'); } });
    check(acknowledgements.length === 2, 'Duplicate queue deliveries acknowledged');
    // The originating queue invocation has ended. Deliver through the actual
    // public callback route, then let a separate durable wake consume it.
    for(const callback of callbacks.splice(0)) {
      const url=new URL(callback.url);
      check(url.origin==='https://bitbi.ai','Model result callback stays on the owned origin');
      const accepted=await f.request(url.pathname,'POST',callback.body);
      const receipt=await accepted.json();
      check(accepted.status===200&&receipt.ok===true,'Background result is durably acknowledged');
      const duplicate=await f.request(url.pathname,'POST',callback.body);
      check(duplicate.status===200&&(await duplicate.json()).ok===true,'Duplicate model callback preserves one receipt');
    }
    for (let i = f.messages.length - 1; i >= 0; i--) if (f.messages[i].type === 'canvas_agent.process') f.messages.splice(i, 1);
    if (f.messages.some(message => message.job_id)) {
      if(deliverGeneration)await deliverGeneration(f);
      else await f.deliver({ attachmentGap: legacyProjectionGap && f.calls.length === providerBaseline });
    }
    current = await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(runId).first();
    if (expectedTerminal && current.status === expectedTerminal) break;
    if (evaluationRejectCount > 1 && current.error_code === 'canvas_agent_quality_review_required') break;
    if (stopBeforeEvaluation && current.phase === 'evaluating') break;
    if (current.status === 'exporting' && stopAtExport) {
      const exported = await f.db.prepare('SELECT id FROM canvas_video_processing WHERE project_id=?').bind(f.project).first();
      if (exported) break;
    }
    if ((current.status === 'exporting' || current.phase === 'evaluating') && processor) await processor();
    if (current.status === 'completed') break;
    if(!['running','exporting','planning','queued'].includes(current.status)) {
      const failed=(await f.db.prepare('SELECT status,error_code,error_message FROM canvas_runs WHERE project_id=? AND error_code IS NOT NULL').bind(f.project).all()).results;
      check(false,`Agent production blocked: ${current.status}/${current.error_code}; node failures: ${JSON.stringify(failed)}`);
    }
  }
  check(current.status === (expectedTerminal || (evaluationRejectCount > 1 ? 'review_required' : stopBeforeEvaluation ? 'running' : stopAtExport ? 'exporting' : 'completed')), `Agent did not reach bounded target state: ${current.status}`);
  check(plannerCalls.length === (evaluationRejectCount ? 2 : 1), 'Only explicitly authorized planning/repair rounds occur');
  check(f.calls.length - providerBaseline === (expectedTerminal ? 1 : expectedGeneration + (evaluationRejectCount ? 1 : 0)), `Only planned generation/variant is submitted: ${f.calls.length - providerBaseline}/${expectedGeneration}`);
  const after = await f.readProject();
  check(JSON.stringify(after.project.assembly.clips.map(clip => clip.nodeId)) === JSON.stringify(expectedOrder), 'Real persisted assembly matches the plan');
  check(after.nodes.some(node => node.type === 'note' && node.content.text === plan.continuity), 'Creative continuity is an ordinary editable note');
  const output = (await f.data(await f.request(exportEndpoint))).current;
  if (!expectedTerminal && !stopAtExport && !stopBeforeEvaluation && evaluationRejectCount < 2) check(output?.storage === 'assets' && output.duration === targetSeconds, 'Agent final video is persistently saved and measured');
  return { runId, status: current.status, output, order: expectedOrder, plannerCalls: plannerCalls.length, evaluationCalls: evaluationCalls.length, generationCalls: f.calls.length - providerBaseline };
  } finally {f.env.AI_LAB = oldAiLab;f.env.__TEST_FETCH=oldProviderFetch;}
}

export function freshCanvasAgentPlan() {
  const nodes = Array.from({ length: 3 }, (_, index) => ({ key: `shot${index + 1}`, type: 'video_generation', title: `New shot ${index + 1}`, modelId: 'minimax/h3',
    prompt: ['Builders raise the red house beside the duck pool.', 'The same house is completed with ducks swimming next door.', 'Visitors celebrate beside the completed house and pool.'][index],
    config: { duration: 4, resolution: '768P', aspectRatio: 'adaptive' }, dependencies: [] }));
  return { version: 1, title: 'House construction story', continuity: 'Keep the same house and pool positions across the three shots.', nodes,
    assembly: { clips: nodes.map(node => ({ key: node.key, trim: { start: 0, duration: 4 }, transition: { preset: 'none' } })), musicKey: null, targetDurationSeconds: 12,
      toleranceSeconds: .5, backgroundMusic: { enabled: false, gain: 1 }, smoothJoins: false } };
}
export async function canvasAgentDispatchCase(env, media) {
  const { canvasAudioFixture } = await import('./canvas-audio-control.mjs');
  const f = await canvasAudioFixture(env, { ...media, scope: 'agent-dispatch' });
  const result = await finishCanvasAgentFixture({ f, targetSeconds: 12, planOverride: freshCanvasAgentPlan(), stopBeforeEvaluation: true, legacyProjectionGap: true });
  const steps = (await f.db.prepare("SELECT status,node_id FROM canvas_agent_steps WHERE run_id=? AND kind='node'").bind(result.runId).all()).results;
  check(steps.length === 3 && steps.every(step => step.status === 'completed'), 'All three ordinary generation jobs completed and saved');
  check((await f.readProject()).nodes.filter(node => result.order.includes(node.id)).every(node => node.output?.assetId), 'Fresh editable nodes retain their actual saved source outputs');
  check((await f.db.prepare("SELECT COUNT(*) AS n FROM canvas_video_processing WHERE project_id=?").bind(f.project).first()).n === 0, 'Export waits for bounded visual evaluation');
  check((await f.db.prepare("SELECT COUNT(*) AS n FROM member_ai_usage_attempts_v2 WHERE user_id=?").bind(f.owner).first()).n === 4, 'Existing accounting has one plan plus three generations');
  // Reproduce a crash after the immutable response and debit commit but before
  // the step acknowledgement. The original usage identity must settle/replay,
  // even though no browser or old in-memory policy object survives.
  const { executeCanvasAgentModel } = await import('../../workers/auth/src/lib/canvas-agent-planning.js');
  const planStep = await f.db.prepare("SELECT * FROM canvas_agent_steps WHERE run_id=? AND kind='plan'").bind(result.runId).first();
  const planUsage = await f.db.prepare('SELECT credit_cost,idempotency_key FROM member_ai_usage_attempts_v2 WHERE id=?').bind(planStep.usage_attempt_id).first();
  const planDebit = await f.db.prepare('SELECT -amount AS credits FROM member_credit_ledger WHERE user_id=? AND idempotency_key=? AND amount<0').bind(f.owner,planUsage.idempotency_key).first();
  check(planDebit.credits > 0 && planDebit.credits < planUsage.credit_cost, 'Verified actual text tokens settle below the conservative allocation');
  const debitCount = (await f.db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n;
  await f.db.prepare("UPDATE canvas_agent_runs SET status='planning',lease_token='recovery-lease',lease_until=? WHERE id=?").bind(new Date(Date.now()+600000).toISOString(),result.runId).run();
  await f.db.prepare("UPDATE canvas_agent_steps SET status='accepted' WHERE id=?").bind(planStep.id).run();
  await f.db.prepare("UPDATE member_ai_usage_attempts_v2 SET status='finalizing',billing_status='reserved',result_status='none' WHERE id=?").bind(planStep.usage_attempt_id).run();
  const run = await f.db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(result.runId).first(), user = await f.db.prepare('SELECT id,role,status FROM users WHERE id=?').bind(f.owner).first();
  const forbidden = f.env.AI_LAB; f.env.AI_LAB = { fetch() { throw new Error('Stored receipt recovery must never invoke inference'); } };
  const recovered = await executeCanvasAgentModel(f.env,run,{...planStep,status:'accepted'},user);
  check(recovered.plan.title === freshCanvasAgentPlan().title, 'Persisted completed plan survives a process restart');
  check((await f.db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n === debitCount, 'Committed debit is not charged twice');
  const requestReceipt=JSON.parse(planStep.receipt_json).request;
  const restored=await executeCanvasAgentModel(f.env,run,{...planStep,status:'accepted',receipt_json:JSON.stringify({request:requestReceipt})},user);
  check(restored.plan.title===freshCanvasAgentPlan().title,'The immutable model operation restores a missing step acknowledgement without inference');
  check((await f.db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(f.owner).first()).n===debitCount,'Operation recovery cannot charge the original attempt again');
  await rejected(() => executeCanvasAgentModel(f.env,run,{...planStep,status:'accepted',receipt_json:JSON.stringify({request:{...requestReceipt,inputDigest:'f'.repeat(64)}})},user), 'canvas_agent_model_input_changed');
  f.env.AI_LAB = forbidden;
  await f.db.prepare("UPDATE canvas_agent_runs SET status='running',lease_token=NULL,lease_until=NULL WHERE id=?").bind(result.runId).run();
  return { plannerCalls: 1, generationCalls: 3, persistedNodes: 3, exportJobs: 0, finalValidation: 'inspection_pending' };
}

export async function canvasAgentCapabilityCase(env) {
  const { canvasAgentCapabilities } = await import('../../workers/auth/src/lib/canvas-agent-capabilities.js');
  const { prepareCanvasAgentGraph } = await import('../../workers/auth/src/lib/canvas-agent-graph.js');
  const { canvasAgentProject } = await import('../../workers/auth/src/routes/canvas-agent.js');
  const { canvasAgentProfiles } = await import('../fixtures/canvas-agent-profiles.mjs');
  const { modelAreaKey } = await import('../../js/shared/model-area-contract.mjs');
  const { prepareCanvasAgentPriceInput,canvasAgentDependencyKind } = await import('../../workers/auth/src/lib/canvas-agent-price-input.js');
  const { getCanvasModelForRole } = await import('../../js/shared/canvas-model-contract.mjs');
  const { quoteModelTariff } = await import('../../workers/auth/src/lib/model-tariffs.js');
  const assetDependency=(id,kind,role)=>({dep:{key:`existing:${id}`,role},source:{key:`existing:${id}`,id,type:'asset_reference',config:{}},row:{id,type:'asset_reference',content_json:JSON.stringify({asset:{asset_type:kind}}),output_json:null}});
  const videoReference=assetDependency('a'.repeat(32),'video','reference_video');
  check(canvasAgentDependencyKind(videoReference.source,[videoReference.row])==='video','Imported video kind comes from current authoritative metadata');
  const seedance=getCanvasModelForRole('bytedance/seedance-2.5','member');
  const seedanceInput=await prepareCanvasAgentPriceInput({node:{modelId:seedance.id,type:'video_generation',prompt:'Continue the existing shot.',config:{seedance25:{duration:5,resolution:'720p'}}},model:seedance,dependencies:[videoReference],existingNodes:[videoReference.row]});
  const nativeVideoInput={duration:5,resolution:'720p',references:[{role:'reference_video',source:{source_type:'saved_asset',asset_id:'owned-fixture-reference'}}]};
  const plannedQuote=await quoteModelTariff(env,{modelId:seedance.id,input:seedanceInput});
  const nativeQuote=await quoteModelTariff(env,{modelId:seedance.id,input:nativeVideoInput});
  const noVideoQuote=await quoteModelTariff(env,{modelId:seedance.id,input:{duration:5,resolution:'720p'}});
  check(plannedQuote.credits===nativeQuote.credits&&plannedQuote.credits>noVideoQuote.credits,'Planned imported reference video reserves the same higher tier as ordinary execution');
  const images=Array.from({length:5},(_,i)=>assetDependency(String(i+1).repeat(32),'image','reference_image'));
  const imageModel=getCanvasModelForRole('openai/gpt-image-2','member'),imageNode={modelId:imageModel.id,type:'image_generation',prompt:'Consistent building references.',config:{}};
  const imageInput=await prepareCanvasAgentPriceInput({node:imageNode,model:imageModel,dependencies:images.slice(0,2),existingNodes:images.map(item=>item.row)});
  check(imageInput.referenceImageCount===2,'Imported image references count toward the pre-generation allocation');
  await rejected(()=>prepareCanvasAgentPriceInput({node:imageNode,model:imageModel,dependencies:images,existingNodes:images.map(item=>item.row)}),'canvas_agent_reference_limit');
  const flux=getCanvasModelForRole('black-forest-labs/flux-2-max','member');
  const fluxInput=await prepareCanvasAgentPriceInput({node:{...imageNode,modelId:flux.id},model:flux,dependencies:images.slice(0,2),existingNodes:images.map(item=>item.row)});
  check(JSON.stringify(fluxInput.inputImageMegapixels)==='[32,32]','Every planned image gets its own conservative native input megapixel bound');
  const fluxQuote=await quoteModelTariff(env,{modelId:flux.id,input:fluxInput});
  const nativeFluxQuote=await quoteModelTariff(env,{modelId:flux.id,input:{inputImageMegapixels:[32,32]}});
  const missingFluxReferences=await quoteModelTariff(env,{modelId:flux.id,input:{}});
  check(fluxQuote.credits>=nativeFluxQuote.credits&&fluxQuote.credits>missingFluxReferences.credits,'Planned Flux input references cannot be priced as a text-only image request');
  const h3=getCanvasModelForRole('minimax/h3','member');
  const continued=await prepareCanvasAgentPriceInput({node:{type:'video_generation',modelId:h3.id,prompt:'Continue this shot.',config:{duration:4,aspectRatio:'adaptive'}},model:h3,dependencies:[{...videoReference,dep:{...videoReference.dep,method:'last_frame'}}],existingNodes:[videoReference.row]});
  check(continued.references.length===1&&continued.references[0].role==='first_frame','Ordinary continuation pricing uses the prepared image role');
  await rejected(()=>prepareCanvasAgentPriceInput({node:{type:'video_generation',modelId:h3.id,prompt:'Edit this shot.',config:{duration:4,aspectRatio:'adaptive'}},model:h3,dependencies:[{...videoReference,dep:{...videoReference.dep,method:'edit'}}],existingNodes:[videoReference.row]}),'canvas_agent_reference_unsupported');
  await rejected(()=>prepareCanvasAgentPriceInput({node:{type:'video_generation',modelId:seedance.id,prompt:'Continue this shot.',config:{}},model:seedance,dependencies:[{...videoReference,dep:{...videoReference.dep,method:'last_frame'}}],existingNodes:[videoReference.row]}),'canvas_agent_reference_unsupported');
  const owner = 'canvas-agent-capability-member', now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,?,?,'user','active',?)").bind(owner,owner+'@example.invalid','synthetic',now,now).run();
  const inventory = await canvasAgentCapabilities(env);
  check(inventory.models.every(model => Number.isSafeInteger(model.pricing.defaultCredits) && model.pricing.defaultCredits > 0), 'Inventory advertises only priced eligible models');
  check(inventory.models.every(model => model.suitability.status === 'provisional' && !('score' in model.suitability)), 'Creative expectations are not invented benchmark scores');
  let cases = 0;
  for (const profile of canvasAgentProfiles) {
    const project = (await sha256Hex(profile.id)).slice(0,32), runId = (await sha256Hex('run-'+profile.id)).slice(0,32);
    await env.DB.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,'Profile','en',?,?)").bind(project,owner,now,now).run();
    await env.DB.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,expected_revision,budget_credits,target_seconds,tolerance_seconds,lease_token,lease_until,next_attempt_at,created_at,updated_at,expires_at)
      VALUES(?,?,?,?,?,'planning',0,10000,12,.5,'profile-lease',?,?,?,?,?)`).bind(runId,project,owner,runId,JSON.stringify({brief:profile.brief}),new Date(Date.now()+600000).toISOString(),now,now,now,new Date(Date.now()+3600000).toISOString()).run();
    const run = await env.DB.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(runId).first(), view = await canvasAgentProject(env,owner,project);
    const eligible = profile.provisionalCandidates.filter(id => inventory.models.some(model => model.id === id && model.capability === 'video'));
    check(eligible.includes('minimax/h3'), 'Known positive capability fixture');
    const plan = freshCanvasAgentPlan(); plan.continuity = profile.continuity.join('; '); plan.nodes.forEach(node => { node.prompt = profile.style + ': ' + node.prompt; });
    const ordinaryAudio={enabled:false,gain:.4,fadeIn:.2,fadeOut:.3};
    plan.nodes[0].config.originalAudio=ordinaryAudio;
    const textModel=inventory.models.find(model=>model.capability==='text'&&!model.controls.reasoningEffort);
    check(textModel,'Known positive ordinary one-shot text capability');
    const textNode={key:'creativeNotes',type:'text_generation',modelId:textModel.id,title:'Editable creative notes',prompt:'Describe the house.',config:{textPurpose:'video_prompt',maxTokens:128,temperature:.7},dependencies:[]};
    plan.nodes.push(textNode);
    // Existing IDs are schema-valid regardless of medium. The authoritative
    // source kind must fail before even quoting newly planned media.
    const existingId='e'.repeat(32),existingKey=`existing:${existingId}`;
    const noAdmissionEnv={...env,DB:{prepare(){throw new Error('Invalid assembly reached a quote/allocation');},batch(){throw new Error('Invalid assembly mutated the graph');}}};
    for(const [type,assetType,asMusic] of [['note',null,false],['asset_reference','image',false],['video_generation',null,true]]){
      const current={...view,nodes:[{id:existingId,type,model_id:null,config_json:'{}',content_json:JSON.stringify(assetType?{asset:{asset_type:assetType}}:{}),output_json:null}]};
      const broken={...plan,assembly:{...plan.assembly,...(asMusic?{musicKey:existingKey}:{clips:plan.assembly.clips.map((clip,index)=>index?clip:{...clip,key:existingKey})})}};
      await rejected(()=>prepareCanvasAgentGraph(noAdmissionEnv,run,current,inventory,broken),asMusic?'canvas_agent_assembly_music_invalid':'canvas_agent_assembly_clip_invalid');
    }
    for (const [broken, code] of [
      [{ ...plan, nodes: plan.nodes.map(node => ({ ...node, modelId: 'outside/arbitrary-generator' })) }, 'canvas_agent_model_ineligible'],
      [{ ...plan, nodes: plan.nodes.map(node => ({ ...node, modelId: 'google/gemini-omni-flash' })) }, 'canvas_agent_model_ineligible'],
      [{ ...plan, nodes: plan.nodes.map(node => ({ ...node, config: { ...node.config, duration: 16 } })) }, 'canvas_agent_duration_unsupported'],
      [{ ...plan, assembly: { ...plan.assembly, targetDurationSeconds: 181 } }, 'canvas_agent_plan_invalid'],
      ...['maxTokens','temperature','reasoningEffort','textPurpose'].map(field=>[{...plan,nodes:plan.nodes.map((node,index)=>index?node:{...node,config:{...node.config,[field]:({maxTokens:128,temperature:.7,reasoningEffort:'medium',textPurpose:'video_prompt'})[field]}})},'canvas_agent_parameter_unsupported']),
      [{...plan,nodes:plan.nodes.map(node=>node===textNode?{...node,config:{...node.config,originalAudio:ordinaryAudio}}:node)},'canvas_agent_parameter_unsupported'],
      [{...plan,nodes:plan.nodes.map(node=>node===textNode?{...node,config:{...node.config,reasoningEffort:'high'}}:node)},'canvas_agent_parameter_unsupported'],
    ]) {
      await rejected(() => prepareCanvasAgentGraph(env,run,view,inventory,broken),code);
      check((await canvasAgentProject(env,owner,project)).nodes.length === 0, 'Broken plans have no partial graph writes');
    }
    const key = modelAreaKey('minimax/h3','canvas');
    await env.DB.prepare('INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?)').bind(key,JSON.stringify({version:1,revision:1,enabled:false,history:[]}),now).run();
    const disabled = await canvasAgentCapabilities(env);
    check(!disabled.models.some(model => model.id === 'minimax/h3'), 'Unavailable model is removed from real server inventory');
    await rejected(() => prepareCanvasAgentGraph(env,run,view,disabled,plan),'canvas_agent_model_ineligible');
    await env.DB.prepare('DELETE FROM app_settings WHERE key=?').bind(key).run();
    await prepareCanvasAgentGraph(env,run,view,inventory,plan);
    const stored = await canvasAgentProject(env,owner,project);
    check(stored.nodes.filter(node => node.type === 'video_generation').length === 3 && stored.nodes.every(node => !node.asset_id), 'Eligible creative plan creates editable ungenerated nodes only');
    check(stored.nodes.some(node=>node.type==='video_generation'&&JSON.parse(node.config_json).originalAudio?.gain===.4),'Supported ordinary source sound remains editable');
    const storedText=JSON.parse(stored.nodes.find(node=>node.type==='text_generation').config_json);
    check(storedText.maxTokens===128&&storedText.temperature===.7&&storedText.textPurpose==='video_prompt','Supported ordinary text controls remain in the saved node');
    check((await env.DB.prepare('SELECT COUNT(*) AS n FROM member_ai_usage_attempts_v2 WHERE user_id=?').bind(owner).first()).n === 0, 'Graph validation and editing never submits paid work');
    cases++;
  }
  return { profiles: cases, unavailableRejected: true, unsupportedRejected: true, paidCalls: 0 };
}

export async function canvasAgentLateCompletionCase(env, media) {
  const { canvasAudioFixture } = await import('./canvas-audio-control.mjs');
  const f = await canvasAudioFixture(env, { ...media, scope: 'agent-late-completion' }), originalFetch = f.env.__TEST_FETCH;
  let editedNode = null;
  f.env.__TEST_FETCH = async (url, init) => {
    const response = await originalFetch(url, init);
    if (!isCanvasAgentProviderEndpoint(url, f.env.CLOUDFLARE_ACCOUNT_ID)) return response;
    check(!editedNode, 'Only one external generation was accepted before cancellation');
    const step = await f.db.prepare("SELECT s.node_id,s.run_id FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id WHERE r.project_id=? AND s.kind='node' ORDER BY s.rowid LIMIT 1").bind(f.project).first();
    editedNode = step.node_id;
    const node = await f.db.prepare('SELECT config_json FROM canvas_nodes WHERE id=?').bind(editedNode).first();
    await f.data(await f.request(`${f.projectPath}/nodes/${editedNode}`, 'PATCH', { config: { ...JSON.parse(node.config_json), prompt: 'Manual takeover choice.' } }));
    await f.data(await f.request(`${f.projectPath}/agent/${step.run_id}/control`, 'POST', { action: 'cancel' }, { 'Idempotency-Key': 'late-completion-cancel' }));
    return response;
  };
  const finished = await finishCanvasAgentFixture({ f, targetSeconds: 12, planOverride: freshCanvasAgentPlan(), expectedTerminal: 'cancelled' });
  const node = (await f.readProject()).nodes.find(node => node.id === editedNode);
  check(node.config.prompt === 'Manual takeover choice.' && !node.output, 'Late pixels never overwrite a newer manual choice');
  const result = await f.db.prepare('SELECT r.asset_id,r.status,m.state FROM canvas_runs r JOIN canvas_media_outputs m ON m.run_id=r.id WHERE r.node_id=? ORDER BY r.created_at DESC LIMIT 1').bind(editedNode).first();
  check(result.status === 'completed' && result.asset_id && result.state === 'saved', 'Already accepted output remains a permanent historical asset after cancellation');
  check((await f.request(`/api/ai/text-assets/${result.asset_id}/file`)).ok, 'Historical legitimate result is still privately playable');
  check(f.calls.length === 1 && finished.status === 'cancelled', 'Cancellation starts no remaining work');
  // These ordinary manual jobs have no agent run whose paused status could
  // accidentally hide a missing creative-revision fence.
  for(const music of [false,true]) {
    const ordinary=await canvasAudioFixture(env,{...media,scope:'ordinary-late-edge-'+music});
    const target=(await ordinary.data(await ordinary.request(ordinary.projectPath+'/nodes','POST',{type:'video_generation',model_id:'minimax/h3',title:'Manual late result',config:{prompt:'Ordinary manual generation.',duration:4,resolution:'768P',aspectRatio:'16:9'}}))).node;
    const source=music?ordinary.music:(await ordinary.data(await ordinary.request(ordinary.projectPath+'/nodes','POST',{type:'note',title:'New reference',content:{text:'A newly connected instruction.'}}))).node;
    const revision=(await ordinary.db.prepare('SELECT creative_revision FROM canvas_nodes WHERE id=?').bind(target.id).first()).creative_revision;
    const before=ordinary.env.__TEST_FETCH;
    ordinary.env.__TEST_FETCH=async(url,init)=>{
      const response=await before(url,init);
      if(isCanvasAgentProviderEndpoint(url,ordinary.env.CLOUDFLARE_ACCOUNT_ID))await ordinary.data(await ordinary.request(ordinary.projectPath+'/edges','POST',{source_node_id:source.id,target_node_id:target.id,...(music?{config:{purpose:'export_background_music'}}:{})}));
      return response;
    };
    const tariff=(await getModelTariff(ordinary.env)).revision;
    const started=await ordinary.request(`${ordinary.projectPath}/nodes/${target.id}/run`,'POST',{}, {'Idempotency-Key':'ordinary-late-edge-'+music,'X-Bitbi-Tariff-Revision':String(tariff)});
    check(started.status===202,'Normal manual node execution accepted'); await ordinary.deliver();
    const stored=await ordinary.db.prepare('SELECT creative_revision,output_json FROM canvas_nodes WHERE id=?').bind(target.id).first();
    check(stored.creative_revision===revision+(music?0:1),'Only generation dependencies invalidate effective settings');
    check(Boolean(stored.output_json)===music,'Late ordinary output attaches only when generation inputs stayed unchanged');
    check(ordinary.calls.length===1,'Editing a connection does not initiate another paid generation');
  }
  return { providerCalls: 3, cancelled: true, manualChoicePreserved: true, historicalAssetSaved: true, ordinaryEdgeFenced:true,musicEdgeSafe:true };
}

export async function canvasAgentUnknownProviderCase(env,media) {
  const {canvasAudioFixture}=await import('./canvas-audio-control.mjs');
  const f=await canvasAudioFixture(env,{...media,scope:'agent-unknown-provider'});
  f.env.__TEST_FETCH=async(url,init)=>{
    check(isCanvasAgentProviderEndpoint(url,f.env.CLOUDFLARE_ACCOUNT_ID),'Unknown provider fixture must not download a nonexistent result');
    f.calls.push(JSON.parse(init.body));
    // A provider HTTP429 is not the trusted internal pre-admission marker.
    return new Response('{}',{status:429,headers:{'Content-Type':'application/json'}});
  };
  for (const origin of ['https://api.cloudflare.com@attacker.invalid', 'https://api.cloudflare.com:8443']) {
    await rejected(() => f.env.__TEST_FETCH(`${origin}/client/v4/accounts/${f.env.CLOUDFLARE_ACCOUNT_ID}/ai/run`, {
      method: 'POST', body: JSON.stringify({ model: 'minimax/h3' }),
    }), 'Unknown provider fixture must not download a nonexistent result');
  }
  check(f.calls.length === 0, 'Unexpected fixture URLs cannot become accepted provider submissions');
  const finished=await finishCanvasAgentFixture({f,targetSeconds:12,planOverride:freshCanvasAgentPlan(),expectedTerminal:'review_required',deliverGeneration:async()=>{
    const index=f.messages.findIndex(message=>message.job_id),body=f.messages.splice(index,1)[0],waits=[];
    await worker.queue({queue:'bitbi-ai-video-jobs',messages:[{body,attempts:1,ack(){},retry(){throw new Error('Ambiguous provider work cannot be resubmitted');}}]},f.env,{waitUntil(p){waits.push(p);}});
    await Promise.all(waits);
  }});
  const jobs=(await f.db.prepare('SELECT id,status,usage_attempt_id FROM member_generation_jobs WHERE user_id=?').bind(f.owner).all()).results;
  check(jobs.length===1,'Uncertain provider acceptance keeps the one original durable job');
  const attempt=await f.db.prepare('SELECT provider_outcome,billing_status,reservation_released_at FROM member_ai_usage_attempts_v2 WHERE id=?').bind(jobs[0].usage_attempt_id).first();
  check(attempt.provider_outcome==='unknown'&&attempt.billing_status==='reserved'&&!attempt.reservation_released_at,'A generic provider429 does not release an uncertain committed reservation');
  await worker.queue({queue:'bitbi-ai-video-jobs',messages:[0,1].map(()=>({body:{type:'canvas_agent.process',run_id:finished.runId},attempts:1,ack(){},retry(){throw new Error('Review state must not retry');}}))},f.env,{waitUntil(){throw new Error('Review state must not detach work');}});
  check(f.calls.length===1,'Duplicate recovery wakes never repeat uncertain paid work');
  return {providerCalls:1,reviewRequired:true,reservationRetained:true};
}

// Calibrates the ordinary manual-run boundary against real migrations/triggers:
// rejection and recovery are read-only; an explicitly new generation pauses AI.
export async function canvasAgentManualTakeoverCase(env, media) {
  const { canvasAudioFixture } = await import('./canvas-audio-control.mjs');
  const f = await canvasAudioFixture(env, { ...media, scope: 'agent-manual-takeover' });
  const node = (await f.data(await f.request(f.projectPath + '/nodes', 'POST', {
    type: 'video_generation', model_id: 'minimax/h3', title: 'Manual generation',
    config: { prompt: 'A manual creative choice.', duration: 4, resolution: '768P', aspectRatio: '16:9' },
  }))).node;
  const revision = (await f.db.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(f.project).first()).revision;
  const agentId = (await sha256Hex(f.owner + ':active-agent')).slice(0,32), now = new Date().toISOString();
  await f.db.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,expected_revision,budget_credits,next_attempt_at,created_at,updated_at,expires_at)
    VALUES(?,?,?,?,'{}','queued',?,100,?,?,?,?)`).bind(agentId,f.project,f.owner,agentId,revision,now,now,now,new Date(Date.now()+3600000).toISOString()).run();
  const state = () => f.db.prepare('SELECT p.revision,a.status FROM canvas_projects p JOIN canvas_agent_runs a ON a.project_id=p.id WHERE a.id=?').bind(agentId).first();
  const endpoint = `${f.projectPath}/nodes/${node.id}/run`, key = 'agent-manual-takeover-generation';
  const headers = { 'Idempotency-Key': key, 'X-Bitbi-Tariff-Revision': String((await getModelTariff(f.env)).revision) };
  check((await f.request(endpoint,'POST',{})).status===428,'Missing manual idempotency key is rejected');
  check((await f.request(`${f.projectPath}/nodes/${'0'.repeat(32)}/run`,'POST',{},headers)).status===404,'Missing manual node is rejected');
  check((await f.request(endpoint,'POST','{',headers)).status===400,'Malformed manual body is rejected');
  check(JSON.stringify(await state())===JSON.stringify({revision,status:'queued'}),'Invalid manual requests cannot pause production or change the project');
  check((await f.request(endpoint,'POST',{},headers)).status===202,'New ordinary manual generation is durably admitted');
  check(JSON.stringify(await state())===JSON.stringify({revision:revision+1,status:'paused'}),'New manual generation pauses the active agent before provider dispatch');
  check(f.calls.length===0,'Takeover happens before the queued provider is invoked');
  const receipt = await f.db.prepare('SELECT id,usage_attempt_id,output_json FROM canvas_runs WHERE user_id=? AND idempotency_key=?').bind(f.owner,key).first();
  // A newer production has now deliberately adopted the current project.
  await f.db.prepare("UPDATE canvas_agent_runs SET status='queued',expected_revision=?,error_code=NULL WHERE id=?").bind(revision+1,agentId).run();
  check((await f.request(endpoint,'POST',{},headers)).status===202,'Pending result recovery retains the original manual run');
  check(JSON.stringify(await state())===JSON.stringify({revision:revision+1,status:'queued'}),'Pending status/storage recovery cannot take over a newer production');
  const repeated = await f.db.prepare('SELECT id,usage_attempt_id,output_json FROM canvas_runs WHERE user_id=? AND idempotency_key=?').bind(f.owner,key).first();
  check(JSON.stringify(repeated)===JSON.stringify(receipt),'Pending recovery preserves the exact original job and billing receipt');
  await f.deliver();
  const completed = await f.request(endpoint,'POST',{},headers);
  check(completed.status===200 && (await completed.json()).data.idempotent_replay===true,'Completed manual generation replays its stored output');
  check(JSON.stringify(await state())===JSON.stringify({revision:revision+1,status:'queued'}),'Completed replay remains read-only for the current agent');
  check(f.calls.length===1,'All retries and replays use one synthetic provider invocation');
  return { invalidRequestsReadOnly:true,newRunPaused:true,pendingRecoveryReadOnly:true,completedReplayReadOnly:true,providerCalls:1 };
}
