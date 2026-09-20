import { readBodyBytesLimited } from '../../../../js/shared/request-body.mjs';
import { getAiSaveReferenceSigningSecret, getAiSaveReferenceSigningSecretCandidates } from './security-secrets.js';
import { generationExecution } from './member-generation-jobs.js';
import { putNewManagedR2Object, processR2CleanupQueue } from './r2-cleanup.js';
import { nowIso } from './tokens.js';

// ZDR output is a single immutable, job-owned upload, never a public asset or
// a client-selected destination. Existing job receipts retain/clean these bytes.
const models = new Set(['xai/grok-imagine-video', 'xai/grok-imagine-video-1.5-preview']);
const encoder = new TextEncoder();
const active = new Set(['queued','starting','provider_pending','polling','processing','ingesting','outcome_unknown']);
const fail = (code, status = 409) => { throw Object.assign(new Error(code), {code, status}); };
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
const fingerprint = job => `grok-private-output:${job.id}:${job.model}`;
function outputKey(job, kind) {
  return kind === 'member' ? `users/${job.user_id}/generation-jobs/${job.id}/download-video`
    : `users/${job.user_id}/video-jobs/${job.id}/provider-output.mp4`;
}
async function signature(secret, payload) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(`grok-video-output:${secret}`), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(payload)));
}
async function findJob(env, id, kind) {
  if (!['member','admin'].includes(kind) || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)) fail('invalid_video_output_token',403);
  const row = await env.DB.prepare(`SELECT * FROM ${kind === 'member' ? 'member_generation_jobs' : 'ai_video_jobs_v2'} WHERE id=?`).bind(id).first();
  if (!row || !active.has(row.status) || (kind === 'admin' && !models.has(row.model))) fail('video_output_job_inactive',410);
  // Member jobs keep their canonical model in the accepted input, not a model column.
  if (kind === 'member') {
    const input = await env.USER_IMAGES.get(row.input_r2_key);
    if (!input) fail('video_output_input_missing',410);
    const body = await new Response(input.body).json(); row.model = body.model;
    if (row.media_type !== 'video' || !models.has(row.model)) fail('video_output_job_inactive',410);
  }
  return row;
}
function registered(job, kind) {
  const key = outputKey(job,kind);
  if (kind === 'admin') return job.output_r2_key === key;
  const receipt = JSON.parse(job.provider_receipts_json)['download-video'];
  return receipt?.key === key && receipt.fingerprint === fingerprint(job) && receipt.source === 'provider-upload';
}
export async function prepareGrokVideoOutput(env, userId, jobId, model) {
  if (!models.has(model)) return null;
  if (!jobId) fail('durable_video_job_required');
  const execution = generationExecution(env), kind = execution ? 'member' : 'admin';
  const job = await findJob(env,jobId,kind);
  if (job.user_id !== userId || job.model !== model) fail('video_output_identity_mismatch',403);
  const key = outputKey(job,kind);
  if (!registered(job,kind)) {
    let change;
    if (kind === 'member') {
      await execution.assertClaim();
      const receipts = JSON.parse(job.provider_receipts_json);
      if (receipts['download-video']) fail('video_output_identity_mismatch');
      receipts['download-video'] = {key,kind:'download',fingerprint:fingerprint(job),source:'provider-upload'};
      change = await env.DB.prepare(`UPDATE member_generation_jobs SET provider_receipts_json=? WHERE id=? AND processing_token=? AND locked_until>? AND provider_receipts_json=?`)
        .bind(JSON.stringify(receipts),jobId,execution.job.processing_token,nowIso(),job.provider_receipts_json).run();
    } else {
      change = await env.DB.prepare(`UPDATE ai_video_jobs_v2 SET output_r2_key=? WHERE id=? AND user_id=? AND output_r2_key IS NULL AND processing_token IS NOT NULL AND locked_until>? AND status IN ('starting','provider_pending','polling','processing','ingesting')`)
        .bind(key,jobId,userId,nowIso()).run();
    }
    if (!change.meta?.changes) fail('video_output_claim_lost');
  }
  const payload = JSON.stringify(['v1',kind,jobId,userId,model,job.created_at]);
  const token = `${btoa(payload).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')}.${await signature(getAiSaveReferenceSigningSecret(env),payload)}`;
  return {upload_url:`https://bitbi.ai/api/internal/ai/video-output/${token}`};
}
export async function readGrokVideoOutput(env, job) {
  const key = `users/${job.user_id}/video-jobs/${job.id}/provider-output.mp4`;
  if (!models.has(job.model) || job.output_r2_key !== key) return null;
  const object = await env.USER_IMAGES.get(key);
  if (!object) fail('video_output_not_received',503);
  return {key,body:new Uint8Array(await new Response(object.body).arrayBuffer()),contentType:'video/mp4',sizeBytes:object.size};
}
export async function handleGrokVideoOutput(ctx, token) {
  const {env,request} = ctx;
  let key;
  try {
    if (request.method !== 'PUT') fail('method_not_allowed',405);
    if (token.length > 1800) fail('invalid_video_output_token',403);
    const [encoded, sig, extra] = token.split('.');
    if (extra || !/^[a-f0-9]{64}$/.test(sig || '')) fail('invalid_video_output_token',403);
    const payload = atob(encoded.replaceAll('-','+').replaceAll('_','/'));
    let valid = false;
    for (const candidate of getAiSaveReferenceSigningSecretCandidates(env)) {
      const expected = await signature(candidate.secret,payload);
      let mismatch = 0; for(let i=0;i<64;i++) mismatch |= expected.charCodeAt(i)^sig.charCodeAt(i);
      if (mismatch === 0) valid = true;
    }
    if (!valid) fail('invalid_video_output_token',403);
    const fields = JSON.parse(payload), [version,kind,id,userId,model,created] = fields;
    if (!Array.isArray(fields) || fields.length !== 6 || version !== 'v1') fail('invalid_video_output_token',403);
    const assertCurrent = async () => {
      const job = await findJob(env,id,kind);
      if (job.user_id !== userId || job.model !== model || job.created_at !== created || !registered(job,kind)) fail('video_output_identity_mismatch',403);
      return job;
    };
    const job = await assertCurrent(); key = outputKey(job,kind);
    const type = request.headers.get('content-type')?.split(';')[0];
    if (!['video/mp4','application/octet-stream'].includes(type)) fail('unsupported_media_type',415);
    const body = await readBodyBytesLimited(request,{maxBytes:80*1024*1024});
    if (body.length < 12 || new TextDecoder().decode(body.subarray(4,8)) !== 'ftyp') fail('invalid_video_output',415);
    const digest = hex(await crypto.subtle.digest('SHA-256',body));
    await assertCurrent();
    try {
      await putNewManagedR2Object(env,key,body,{httpMetadata:{contentType:'video/mp4'},customMetadata:{sha256:digest}});
    } catch (error) {
      const existing = await env.USER_IMAGES.head(key);
      if (existing?.customMetadata?.sha256 !== digest || existing.size !== body.length) throw error;
    }
    await assertCurrent();
    return new Response(null,{status:200,headers:{'Cache-Control':'private, no-store'}});
  } catch (error) {
    // A deletion/retirement during PUT cannot resurrect a reference. Requeue
    // this exact key for the existing managed, live-reference-fenced cleanup.
    if (key) {
      await env.DB.prepare("INSERT INTO r2_cleanup_queue(r2_key,status,created_at) VALUES(?,'q2_pending',?)").bind(key,nowIso()).run();
      await processR2CleanupQueue(env,{keys:[key]});
    }
    return Response.json({ok:false,code:error.code || 'video_output_rejected'},{status:error.status || 409,headers:{'Cache-Control':'private, no-store'}});
  }
}
