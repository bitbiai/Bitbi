import { nowIso, randomTokenHex, sha256Hex } from './tokens.js';
import { IMAGE_GENERATION_LEGACY_REVIEW } from './image-generation-legacy-review.js';

const MAX_CAPACITY=15, LEASE_MS=15*60_000;
const PROVIDERS=new Set(['workers-ai','openai','black-forest-labs','xai','google','bytedance']);
const positive=value=>Number.isInteger(value)&&value>=1&&value<=MAX_CAPACITY;
const fail=code=>Object.assign(new Error(code),{code});

// Concurrency is not a documented requests/minute allowance. An operator may
// configure a reviewed account allocation, with an expiry and evidence reference.
// Missing, malformed or expired evidence never silently grants extra capacity.
export function imageGenerationCapacity(env) {
  const fallback={version:1,revision:'conservative-1',global:1,user:1,project:1,providers:{},verified:false,reason:'image_capacity_unverified'};
  try {
    const value=JSON.parse(env.IMAGE_GENERATION_CAPACITY_JSON||'null');
    if(!value||value.version!==1||!positive(value.global)||!positive(value.user)||!positive(value.project)
      ||!/^[-a-zA-Z0-9_:.]{1,100}$/.test(value.revision||'')||!/^[-a-zA-Z0-9_:/\.]{1,200}$/.test(value.reviewRef||'')
      ||!Number.isFinite(Date.parse(value.verifiedUntil))||Date.parse(value.verifiedUntil)<=Date.now()
      ||!value.providers||Array.isArray(value.providers)||typeof value.providers!=='object'
      ||Object.entries(value.providers).some(([key,limit])=>!PROVIDERS.has(key)||!positive(limit)))return fallback;
    return {...value,verified:true,reason:null};
  } catch {return fallback;}
}
export function imageGenerationProvider(modelId) {
  if(typeof modelId!=='string')throw fail('image_generation_model_missing');
  if(modelId.startsWith('@cf/'))return 'workers-ai';
  const provider=modelId.split('/')[0];
  // Unknown providers remain one shared conservative bucket, never a new slot
  // namespace that a requested model name could use to bypass account limits.
  return PROVIDERS.has(provider)?provider:'workers-ai';
}

export async function registerImageGenerationSlot(env,{usagePolicy,userId,modelId,jobId=null,canvasRunId=null}) {
  const usageId=usagePolicy.attempt?.id||null,scope=usageId?usagePolicy.mode:'admin';
  if(!['member','organization','admin'].includes(scope))throw fail('image_generation_owner_mismatch');
  const id=usageId?`${scope}:${usageId}`:`admin:${randomTokenHex(16)}`;
  const canvas=canvasRunId?await env.DB.prepare('SELECT project_id FROM canvas_runs WHERE id=? AND user_id=?').bind(canvasRunId,userId).first():null;
  if(canvasRunId&&!canvas)throw fail('image_generation_owner_mismatch');
  const now=nowIso(),policy=imageGenerationCapacity(env),provider=imageGenerationProvider(modelId);
  await env.DB.prepare(`INSERT OR IGNORE INTO image_generation_slots
    (id,usage_id,usage_scope,user_id,project_id,job_id,provider_key,model_id,policy_revision,lease_until,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,usageId,scope,userId,canvas?.project_id||null,jobId,provider,modelId,policy.revision,new Date(Date.now()+LEASE_MS).toISOString(),now,now).run();
  let row=await env.DB.prepare('SELECT * FROM image_generation_slots WHERE id=?').bind(id).first();
  if(row?.job_id===null&&jobId&&row.state==='waiting'&&row.user_id===userId) {
    await env.DB.prepare(`UPDATE image_generation_slots SET job_id=? WHERE id=? AND job_id IS NULL AND state='waiting' AND dispatched_at IS NULL
      AND EXISTS(SELECT 1 FROM member_generation_jobs j WHERE j.id=? AND j.usage_attempt_id=image_generation_slots.usage_id AND j.user_id=image_generation_slots.user_id)`)
      .bind(jobId,id,jobId).run();
    row=await env.DB.prepare('SELECT * FROM image_generation_slots WHERE id=?').bind(id).first();
  }
  if(!row||row.user_id!==userId||row.model_id!==modelId||row.project_id!==(canvas?.project_id||null)||row.job_id!==jobId)throw fail('image_generation_identity_mismatch');
  await env.DB.prepare("UPDATE image_generation_slots SET lease_until=? WHERE id=? AND state='waiting'").bind(new Date(Date.now()+LEASE_MS).toISOString(),id).run();
  return row;
}

// Expired *undispatched* claims are safe to reuse. A provider intent has no
// expiry: unknown acceptance retains its capacity until an original receipt
// proves a terminal response. Waiting is independent of paid retry counters.
async function recoverSlots(env,now) {
  await env.DB.prepare(`UPDATE image_generation_slots SET state=CASE WHEN dispatched_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM member_ai_usage_attempts_v2 u WHERE u.id=image_generation_slots.usage_id AND u.provider_outcome IN ('dispatched','unknown'))
    THEN 'waiting' ELSE 'unknown' END,token=NULL,updated_at=?
    WHERE state='active' AND lease_until<=?`).bind(now,now).run();
  await env.DB.prepare(`UPDATE image_generation_slots SET state='finished',finished_at=?,updated_at=?
    WHERE state IN ('waiting','unknown') AND usage_scope='member' AND EXISTS(
      SELECT 1 FROM member_ai_usage_attempts_v2 u WHERE u.id=image_generation_slots.usage_id
      AND ((u.provider_outcome='not_dispatched' AND u.billing_status='released')
        OR u.provider_outcome='succeeded'))`).bind(now,now).run();
}

const active="state IN ('active','unknown')";
const legacySource=`SELECT 'member' AS scope,u.id,u.created_at,COALESCE(json_extract(u.metadata_json,'$.image_request.model_id'),u.result_model) AS model_id,
  u.provider_outcome,u.user_id,json_extract(u.metadata_json,'$.canvas_agent.project_id') AS project_id FROM member_ai_usage_attempts_v2 u
  WHERE u.operation_key='member.image.generate' AND u.provider_outcome IN ('dispatched','unknown')
  AND NOT EXISTS(SELECT 1 FROM image_generation_slots s WHERE s.id='member:'||u.id)
  UNION ALL SELECT 'organization' AS scope,u.id,u.created_at,COALESCE(json_extract(u.metadata_json,'$.image_request.model_id'),u.result_model) AS model_id,
  u.provider_outcome,u.user_id,NULL AS project_id FROM ai_usage_attempts_v2 u
  WHERE u.operation_key='member.image.generate' AND u.provider_outcome IN ('dispatched','unknown')
  AND NOT EXISTS(SELECT 1 FROM image_generation_slots s WHERE s.id='organization:'||u.id)`;
export const imageGenerationLegacyReviewFingerprint=({scope,id,createdAt,modelId})=>
  sha256Hex(JSON.stringify(['image-generation-legacy-review-v1',scope,id,createdAt,modelId??null]));

async function reviewedLegacyUnknown(env) {
  let review;
  try {
    review=env.IMAGE_GENERATION_LEGACY_REVIEW_JSON===undefined?IMAGE_GENERATION_LEGACY_REVIEW:JSON.parse(env.IMAGE_GENERATION_LEGACY_REVIEW_JSON);
    if(!review||review.version!==1||!/^[-a-zA-Z0-9_:/\.]{1,200}$/.test(review.reviewRef||'')
      ||!Number.isFinite(Date.parse(review.reviewedAt))||Date.parse(review.reviewedAt)>Date.now()
      ||!Array.isArray(review.unknown)||review.unknown.length>256||new Set(review.unknown).size!==review.unknown.length
      ||review.unknown.some(hash=>typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))
      ||Object.keys(review).some(key=>!['version','reviewRef','reviewedAt','unknown'].includes(key)))return [];
  } catch {return [];}
  if(!review.unknown.length)return [];
  const rows=(await env.DB.prepare(`SELECT scope,id,created_at,model_id FROM (${legacySource})
    WHERE provider_outcome='unknown' AND created_at<=? ORDER BY created_at,scope,id LIMIT 256`)
    .bind(review.reviewedAt).all()).results;
  const hashes=new Set(review.unknown),reviewed=[];
  for(const row of rows)if(hashes.has(await imageGenerationLegacyReviewFingerprint({scope:row.scope,id:row.id,createdAt:row.created_at,modelId:row.model_id})))
    reviewed.push([row.scope,row.id,row.created_at,row.model_id]);
  return reviewed;
}
// A release-reviewed historical financial ambiguity is not asserted to be
// active physical work. Exempt only its exact reviewed identity; never release
// money, rewrite its outcome, or permit generation replay. Any dispatched row,
// new unknown, or changed tuple still participates in every account gate.
const legacy=`SELECT * FROM (${legacySource}) u WHERE u.provider_outcome='dispatched' OR NOT EXISTS(
  SELECT 1 FROM json_each(?) r WHERE json_extract(r.value,'$[0]')=u.scope AND json_extract(r.value,'$[1]')=u.id
    AND json_extract(r.value,'$[2]')=u.created_at AND json_extract(r.value,'$[3]') IS u.model_id)`;
export async function acquireImageGenerationSlot(env,slot,{receiptReplay=false}={}) {
  if(receiptReplay)return {replay:true,id:slot.id}; // The immutable receipt, never a new provider request.
  const policy=imageGenerationCapacity(env),now=nowIso();
  await recoverSlots(env,now);
  const original=await env.DB.prepare('SELECT state,dispatched_at FROM image_generation_slots WHERE id=?').bind(slot.id).first();
  // A retry of this same dispatched identity is not capacity waiting. Only an
  // original durable receipt may cross the replay boundary above.
  if(original?.state==='unknown'||original?.dispatched_at)throw fail('generation_provider_outcome_unknown');
  const reviewed=await reviewedLegacyUnknown(env);
  const token=randomTokenHex(16),leaseUntil=new Date(Date.now()+LEASE_MS).toISOString();
  // Serialized D1 statement: limits and fair candidate selection are evaluated
  // with the grant, not in a racy count-then-write. Eligible users/projects with
  // fewer in-flight operations run first; oldest last admission breaks ties.
  const grant=await env.DB.prepare(`WITH legacy AS (${legacy}) UPDATE image_generation_slots SET state='active',token=?,lease_until=?,policy_revision=?,updated_at=?
    WHERE id=? AND state='waiting'
    AND (SELECT COUNT(*) FROM image_generation_slots WHERE ${active})+(SELECT COUNT(*) FROM legacy)<?
    AND id=(SELECT w.id FROM image_generation_slots w
      WHERE w.state='waiting' AND (w.job_id IS NOT NULL OR w.lease_until>?)
      AND EXISTS(SELECT 1 FROM users WHERE id=w.user_id AND status='active')
      AND (w.usage_scope!='member' OR EXISTS(SELECT 1 FROM member_ai_usage_attempts_v2 u
        WHERE u.id=w.usage_id AND u.provider_outcome='not_dispatched' AND u.billing_status='reserved'
        AND (json_extract(u.metadata_json,'$.canvas_agent.run_id') IS NULL OR EXISTS(
          SELECT 1 FROM canvas_agent_runs r JOIN canvas_projects p ON p.id=w.project_id
          WHERE r.id=json_extract(u.metadata_json,'$.canvas_agent.run_id') AND r.status='running'
          AND r.expected_revision=p.revision AND p.deleted_at IS NULL AND r.expires_at>?))))
      AND (SELECT COUNT(*) FROM image_generation_slots a WHERE a.${active} AND a.provider_key=w.provider_key)+(SELECT COUNT(*) FROM legacy)<COALESCE((SELECT value FROM json_each(?) WHERE key=w.provider_key),1)
      AND (SELECT COUNT(*) FROM image_generation_slots a WHERE a.${active} AND a.user_id=w.user_id)+(SELECT COUNT(*) FROM legacy WHERE user_id=w.user_id)<?
      AND (SELECT COUNT(*) FROM image_generation_slots a WHERE a.${active} AND COALESCE(a.project_id,a.user_id)=COALESCE(w.project_id,w.user_id))
        +(SELECT COUNT(*) FROM legacy WHERE COALESCE(project_id,user_id)=COALESCE(w.project_id,w.user_id))<?
      ORDER BY (SELECT COUNT(*) FROM image_generation_slots a WHERE a.${active} AND a.user_id=w.user_id),
        (SELECT COUNT(*) FROM image_generation_slots a WHERE a.${active} AND COALESCE(a.project_id,a.user_id)=COALESCE(w.project_id,w.user_id)),
        COALESCE((SELECT MAX(a.dispatched_at) FROM image_generation_slots a WHERE a.user_id=w.user_id),''),w.created_at,w.rowid LIMIT 1)`)
    .bind(JSON.stringify(reviewed),token,leaseUntil,policy.revision,now,slot.id,policy.global,now,now,JSON.stringify(policy.providers),policy.user,policy.project).run();
  return grant.meta?.changes===1?{id:slot.id,token,dispatched:false,finished:false,policy}:null;
}

export async function dispatchImageGenerationSlot(env,claim) {
  if(claim.replay)return;
  const now=nowIso(),changed=await env.DB.prepare(`UPDATE image_generation_slots SET dispatched_at=?,updated_at=?
    WHERE id=? AND token=? AND state='active' AND dispatched_at IS NULL AND lease_until>?`).bind(now,now,claim.id,claim.token,now).run();
  if(changed.meta?.changes!==1)throw fail('image_generation_capacity_claim_lost');
  claim.dispatched=true;
}
export async function finishImageGenerationSlot(env,claim,{confirmed=false}={}) {
  if(!claim||claim.finished)return;
  if(claim.replay) {
    if(confirmed){const now=nowIso();await env.DB.prepare("UPDATE image_generation_slots SET state='finished',finished_at=?,updated_at=? WHERE id=? AND state IN ('active','unknown')").bind(now,now,claim.id).run();}
    return;
  }
  const state=confirmed?'finished':claim.dispatched?'unknown':'waiting',now=nowIso();
  // A terminal receipt can safely free a timed-out original claim; an older
  // undispatched worker must never release a successor's replacement lease.
  await env.DB.prepare(`UPDATE image_generation_slots SET state=?,finished_at=?,updated_at=?
    WHERE id=? AND ((token=? AND state='active') OR (?=1 AND state='unknown' AND dispatched_at IS NOT NULL))`)
    .bind(state,state==='finished'?now:null,now,claim.id,claim.token,confirmed?1:0).run();
  claim.finished=true;
}
