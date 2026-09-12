import { enqueueAiImageDerivativeJob, AI_IMAGE_DERIVATIVE_VERSION } from './ai-image-derivatives.js';
import { nowIso, randomTokenHex, sha256Hex } from './tokens.js';
import { json } from './response.js';
import { putNewManagedR2Object } from './r2-cleanup.js';
import { requireUser } from './session.js';
import { generateMemberMusicCover } from './member-music-cover.js';
import { maybeDispatchMemvidStreamPreviewProcessor } from './memvid-stream-preview-dispatch.js';

export const MEMBER_GENERATION_MESSAGE = 'member_generation.process';
const LEASE_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;
const runnable = new Set(['queued', 'processing', 'ingesting']);
const executions = new WeakMap();

function safeCode(code) { return /^[a-z][a-z0-9_]{0,79}$/i.test(String(code||'')) ? String(code) : 'generation_execution_failed'; }
function jobError(code) { code=safeCode(code); return Object.assign(new Error(code), { code }); }
export function generationExecution(env) { return executions.get(env) || null; }
export function generationUser(ctx) { return generationExecution(ctx.env)?.user || null; }

function publicJob(row) {
  return { id: row.id, media_type: row.media_type, status: row.asset_id && row.status === 'ingesting' ? 'preview_pending' : row.status,
    asset_id: row.error_code === 'generation_asset_removed' ? null : row.asset_id || null, error_code: row.error_code || null,
    created_at: row.created_at, updated_at: row.updated_at };
}

// Called only after the existing route has validated the input, role, price and
// credit reservation. The browser never supplies an execution context or owner.
export async function acceptMemberGeneration(ctx, { usagePolicy, body, mediaType }) {
  if (generationExecution(ctx.env) || usagePolicy.mode !== 'member') return null;
  const { env, request } = ctx;
  if (!request.headers.get('Prefer')?.split(',').some(value => value.trim() === 'respond-async')) return null;
  if (!env.AI_VIDEO_JOBS_QUEUE?.send) throw jobError('generation_queue_unavailable');
  const attempt = usagePolicy.attempt;
  const existing = await env.DB.prepare('SELECT * FROM member_generation_jobs WHERE usage_attempt_id = ? AND user_id = ?')
    .bind(attempt.id, attempt.userId).first();
  if (existing) return json({ ok: true, data: { job: publicJob(existing) } }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  if (!['reserved', 'retryable'].includes(usagePolicy.attemptKind)
    && !(usagePolicy.attemptKind === 'in_progress' && attempt.providerOutcome === 'not_dispatched' && attempt.billingStatus === 'reserved')) return null;
  const id = randomTokenHex(16), now = nowIso();
  const inputKey = `users/${attempt.userId}/generation-jobs/${id}/input.json`;
  const key = request.headers.get('Idempotency-Key');
  // Retain the validated input privately, including references that would
  // otherwise disappear with the page. No session cookie/header is persisted.
  await putNewManagedR2Object(env, inputKey, JSON.stringify(body), { httpMetadata: { contentType: 'application/json' } });
  await env.DB.prepare(`INSERT OR IGNORE INTO member_generation_jobs
    (id,user_id,usage_attempt_id,media_type,request_key,input_r2_key,next_attempt_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(id, attempt.userId, attempt.id, mediaType, key, inputKey, now, now, now).run();
  const row = await env.DB.prepare('SELECT * FROM member_generation_jobs WHERE usage_attempt_id = ? AND user_id = ?')
    .bind(attempt.id, attempt.userId).first();
  if (!row) throw jobError('generation_acceptance_not_confirmed');
  if (row.id !== id) await env.USER_IMAGES.delete(inputKey);
  try { await env.AI_VIDEO_JOBS_QUEUE.send({ type: MEMBER_GENERATION_MESSAGE, job_id: row.id }); }
  catch { /* The scheduled outbox repair reads this durable queued row. */ }
  return json({ ok: true, data: { job: publicJob(row) } }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
}

export async function readMemberGenerationJobs(ctx, id = null) {
  const session = await requireUser(ctx.request, ctx.env);
  if (session instanceof Response) return session;
  if (!id) {
    const rows = await ctx.env.DB.prepare('SELECT * FROM member_generation_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .bind(session.user.id).all();
    return json({ ok: true, data: { jobs: (rows.results || []).map(publicJob), limit: 50 } }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const row = await ctx.env.DB.prepare('SELECT * FROM member_generation_jobs WHERE id = ? AND user_id = ?').bind(id, session.user.id).first();
  if (!row) return json({ ok: false, code: 'not_found' }, { status: 404 });
  let result = null;
  if (row.result_r2_key && row.error_code !== 'generation_asset_removed') {
    const stored = await ctx.env.USER_IMAGES.get(row.result_r2_key);
    if (stored) result = await new Response(stored.body).json();
    if (result?.data?.asset && row.media_type !== 'image') {
      const asset = await ctx.env.DB.prepare('SELECT poster_r2_key FROM ai_text_assets WHERE id=? AND user_id=?').bind(row.asset_id,row.user_id).first();
      if (asset?.poster_r2_key) {
        result.data.asset.poster_url = `/api/ai/text-assets/${row.asset_id}/poster`;
        if(row.media_type==='video') result.data.posterUrl=result.data.asset.poster_url;
      }
    }
  }
  return json({ ok: true, data: { job: publicJob(row), result } }, { headers: { 'Cache-Control': 'no-store' } });
}

async function assertClaim(env, job) {
  const row = await env.DB.prepare(`SELECT id FROM member_generation_jobs
    WHERE id = ? AND processing_token = ? AND locked_until > ? AND status IN ('processing','ingesting')`)
    .bind(job.id, job.processing_token, nowIso()).first();
  if (!row) throw jobError('generation_claim_lost');
}

// Checkpoints only provider calls belonging to this member request. An intent
// without a receipt is never permission to submit the paid call again.
async function providerCall(env, job, name, fingerprint, call) {
  await assertClaim(env, job);
  const row = await env.DB.prepare('SELECT provider_receipts_json FROM member_generation_jobs WHERE id = ?').bind(job.id).first();
  const receipts = JSON.parse(row.provider_receipts_json);
  let receipt = receipts[name];
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) throw jobError('generation_provider_identity_mismatch');
    const object = await env.USER_IMAGES.get(receipt.key);
    if (!object) throw jobError('generation_provider_outcome_unknown');
    const stored = await new Response(object.body).json();
    return decodeProviderResult(stored);
  }
  receipt = { key: `users/${job.user_id}/generation-jobs/${job.id}/provider-${name}.json`, fingerprint };
  receipts[name] = receipt;
  const intent = await env.DB.prepare(`UPDATE member_generation_jobs SET provider_receipts_json = ?
    WHERE id = ? AND processing_token = ? AND locked_until > ? AND provider_receipts_json = ?`)
    .bind(JSON.stringify(receipts), job.id, job.processing_token, nowIso(), row.provider_receipts_json).run();
  if (!intent.meta?.changes) throw jobError('generation_claim_lost');
  const result = await call();
  const stored = await encodeProviderResult(result);
  // The intent owns this immutable receipt even if the execution's lease ends
  // while receiving the result. A later consumer may read it, never re-dispatch.
  const written = await putNewManagedR2Object(env, receipt.key, JSON.stringify(stored), {
    onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/json' },
  });
  if (!written) throw jobError('generation_receipt_conflict');
  await assertClaim(env, job);
  return decodeProviderResult(stored);
}

async function encodeProviderResult(value) {
  if (value instanceof Response || value instanceof ReadableStream || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const response = value instanceof Response ? value : new Response(value);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 24 * 1024 * 1024) throw jobError('generation_receipt_too_large');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return { kind: value instanceof Response ? 'response' : 'bytes', body: btoa(binary), status: response.status, contentType: response.headers.get('Content-Type'), providerOutcome: response.headers.get('x-bitbi-provider-outcome') };
  }
  const text = JSON.stringify(value);
  if (!text || text.length > 32 * 1024 * 1024) throw jobError('generation_receipt_invalid');
  return { kind: 'json', value };
}
function decodeProviderResult(value) {
  if (value.kind === 'json') return value.value;
  const bytes = Uint8Array.from(atob(value.body), c => c.charCodeAt(0));
  return value.kind === 'response' ? new Response(bytes, { status: value.status, headers: { 'Content-Type': value.contentType || 'application/octet-stream', ...(['failed','succeeded'].includes(value.providerOutcome) ? {'x-bitbi-provider-outcome':value.providerOutcome} : {}) } }) : bytes;
}

async function writeResult(env,job,key,result) {
  await assertClaim(env,job);
  if (await env.DB.prepare('SELECT r2_key FROM r2_object_tombstones WHERE r2_key=?').bind(key).first()) throw jobError('generation_result_retired');
  await env.USER_IMAGES.put(key,JSON.stringify(result),{httpMetadata:{contentType:'application/json'}});
  await assertClaim(env,job);
}

export async function processMemberGeneration(env, body, execute) {
  const job = await env.DB.prepare('SELECT * FROM member_generation_jobs WHERE id = ?').bind(body.job_id).first();
  if (!job || !runnable.has(job.status)) return { status: 'ignored' };
  const now = nowIso();
  if (job.next_attempt_at > now || (job.locked_until && job.locked_until > now)) return { status: 'retry', delaySeconds: 60 };
  if (job.attempt_count >= MAX_ATTEMPTS) {
    await env.DB.prepare(`UPDATE member_generation_jobs SET status='failed',error_code='generation_retry_exhausted',locked_until=NULL,updated_at=?
      WHERE id=? AND status IN ('queued','processing','ingesting') AND attempt_count>=? AND (locked_until IS NULL OR locked_until<=?)`)
      .bind(now,job.id,MAX_ATTEMPTS,now).run();
    return {status:'failed'};
  }
  const token = randomTokenHex(16);
  const claim = await env.DB.prepare(`UPDATE member_generation_jobs SET status='processing', processing_token=?, locked_until=?, attempt_count=attempt_count+1, updated_at=?
    WHERE id=? AND status IN ('queued','processing','ingesting') AND (locked_until IS NULL OR locked_until <= ?)`)
    .bind(token, new Date(Date.now()+LEASE_MS).toISOString(), now, job.id, now).run();
  if (!claim.meta?.changes) return { status: 'retry', delaySeconds: 60 };
  job.processing_token = token;
  const user = await env.DB.prepare("SELECT id,email,role,status FROM users WHERE id=? AND status='active'").bind(job.user_id).first();
  if (!user) {
    await env.DB.prepare("UPDATE member_generation_jobs SET status='failed',error_code='generation_owner_unavailable',locked_until=NULL WHERE id=? AND processing_token=?").bind(job.id,token).run();
    return { status:'failed' };
  }
  const scoped = { ...env };
  const execution = { job, user, assertClaim: () => assertClaim(env,job) };
  executions.set(scoped, execution);
  let calls = 0;
  if (env.AI) scoped.AI = { run: async (...args) => providerCall(env,job,`ai-${calls++}`,await sha256Hex(JSON.stringify(args.slice(0,2))),()=>env.AI.run(...args)) };
  if (env.AI_LAB) scoped.AI_LAB = { fetch: async (...args) => { const request = new Request(...args); return providerCall(env,job,`service-${calls++}`,await sha256Hex(request.url+':'+await request.clone().text()),()=>env.AI_LAB.fetch(request)); } };
  try {
    const input = await env.USER_IMAGES.get(job.input_r2_key);
    if (!input) throw jobError('generation_input_missing');
    const bodyInput = await new Response(input.body).json();
    let result;
    const resultKey = job.result_r2_key || `users/${job.user_id}/generation-jobs/${job.id}/result.json`;
    if (job.result_r2_key) {
      const stored = await env.USER_IMAGES.get(job.result_r2_key);
      if (!stored) throw jobError('generation_result_missing');
      result = await new Response(stored.body).json();
    } else {
      const request = new Request(`https://bitbi.ai/api/ai/generate-${job.media_type}`, { method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key':job.request_key}, body:JSON.stringify(bodyInput) });
      const response = await execute({ env:scoped, request, pathname:new URL(request.url).pathname, method:'POST', correlationId:null });
      await assertClaim(env,job);
      result = await response.json();
      if (!response.ok || result.ok === false) throw jobError(result.code || 'generation_execution_failed');
      await writeResult(env,job,resultKey,result);
      await env.DB.prepare(`UPDATE member_generation_jobs SET status='ingesting',result_r2_key=?,asset_id=?,updated_at=? WHERE id=? AND processing_token=? AND locked_until>?`)
        .bind(resultKey,result.data?.asset?.id||null,nowIso(),job.id,token,nowIso()).run();
      job.result_r2_key = resultKey;
    }
    // Persisted generation result is the boundary: follow-up retries do not run
    // the generation route (or charge) again.
    if (job.media_type === 'image') {
      const data = result.data;
      const request = new Request('https://bitbi.ai/api/ai/images/save', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        prompt:data.prompt || bodyInput.prompt, model:data.model, steps:data.steps, seed:data.seed,
        imageData:`data:${data.mimeType || 'image/png'};base64,${data.imageBase64}`, folder_id:bodyInput.folder_id,
      })});
      const response = await execute({env:scoped,request,pathname:new URL(request.url).pathname,method:'POST',correlationId:null});
      const saved = await response.json();
      if (!response.ok || !saved.ok) throw jobError(saved.code || 'generation_image_save_failed');
      result.data.asset = saved.data;
      if(saved.data.derivatives_enqueued!==true && saved.data.derivatives_status!=='ready') {
        const image=await env.DB.prepare('SELECT r2_key FROM ai_images WHERE id=? AND user_id=?').bind(job.id,job.user_id).first();
        if(!image?.r2_key)throw jobError('generation_image_missing');
        await enqueueAiImageDerivativeJob(env,{imageId:job.id,userId:job.user_id,originalKey:image.r2_key,
          derivativesVersion:AI_IMAGE_DERIVATIVE_VERSION,trigger:'generation_resume'});
        result.data.asset.derivatives_enqueued=true;
      }
    }
    if (job.media_type === 'music') {
      scoped.AI = {run:async (...args)=>providerCall(env,job,'music-cover',await sha256Hex(JSON.stringify(args.slice(0,2))),()=>env.AI.run(...args))};
      await generateMemberMusicCover({env:scoped,userId:job.user_id,assetId:result.data.asset.id,
        attemptId:job.usage_attempt_id,styleInput:bodyInput.prompt});
      const asset = await env.DB.prepare('SELECT poster_r2_key FROM ai_text_assets WHERE id=? AND user_id=?').bind(result.data.asset.id,job.user_id).first();
      if (!asset?.poster_r2_key) throw jobError('generation_music_cover_pending');
      result.data.asset.poster_url = `/api/ai/text-assets/${result.data.asset.id}/poster`;
    }
    await assertClaim(env,job);
    await writeResult(env,job,resultKey,result);
    const asset = result.data?.asset;
    const needsPoster = job.media_type==='video' && !asset?.poster_url;
    await env.DB.prepare(`UPDATE member_generation_jobs SET status=?,result_r2_key=?,asset_id=?,locked_until=NULL,error_code=NULL,updated_at=?,completed_at=? WHERE id=? AND processing_token=? AND locked_until>?`)
      .bind(needsPoster?'preview_pending':'succeeded',resultKey,asset?.id||null,nowIso(),needsPoster?null:nowIso(),job.id,token,nowIso()).run();
    return {status:'succeeded'};
  } catch (error) {
    if (error.code === 'generation_claim_lost') return {status:'ignored'};
    const usage = await env.DB.prepare('SELECT provider_outcome,billing_status FROM member_ai_usage_attempts_v2 WHERE id=?').bind(job.usage_attempt_id).first();
    const unknown = usage?.provider_outcome === 'unknown' || /outcome_unknown|dispatch_not_claimed/.test(error.code || '');
    const closed = usage?.provider_outcome === 'failed' || usage?.billing_status === 'released';
    const retry = !unknown && !closed && job.attempt_count+1 < MAX_ATTEMPTS;
    const status=unknown?'outcome_unknown':retry?(job.result_r2_key?'ingesting':'queued'):'failed';
    await env.DB.prepare(`UPDATE member_generation_jobs SET status=?,error_code=?,locked_until=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND processing_token=?`)
      .bind(status, safeCode(error.code),new Date(Date.now()+60_000).toISOString(),nowIso(),job.id,token).run();
    return {status:retry?'retry':status,delaySeconds:60};
  } finally { executions.delete(scoped); }
}

export async function requeueMemberGenerations(env) {
  // A killed processor may never send /fail. Surface exhaustion after its lease
  // expires so the owner can retry only the missing preview.
  await env.DB.prepare(`UPDATE member_generation_jobs SET error_code='preview_retry_exhausted',locked_until=NULL,updated_at=?
    WHERE media_type='video' AND status='preview_pending' AND attempt_count>=16 AND (locked_until IS NULL OR locked_until<=?)`)
    .bind(nowIso(),nowIso()).run();
  const rows = await env.DB.prepare(`SELECT id FROM member_generation_jobs WHERE status IN ('queued','processing','ingesting')
    AND next_attempt_at <= ? AND (locked_until IS NULL OR locked_until <= ?) ORDER BY next_attempt_at LIMIT 25`).bind(nowIso(),nowIso()).all();
  for (const row of rows.results || []) await env.AI_VIDEO_JOBS_QUEUE.send({type:MEMBER_GENERATION_MESSAGE,job_id:row.id});
  const backlog = await env.DB.prepare(`SELECT COUNT(*) AS count FROM member_generation_jobs WHERE media_type='video'
    AND status='preview_pending' AND attempt_count<16 AND next_attempt_at<=? AND (locked_until IS NULL OR locked_until<=?)`).bind(nowIso(),nowIso()).first();
  if (backlog?.count) await maybeDispatchMemvidStreamPreviewProcessor(env, {
    reason:'member_video_posters',dispatchReason:'Member video poster catch-up.',queuedNewCount:backlog.count,memberGenerationPosters:true,
  });
  return rows.results?.length || 0;
}
