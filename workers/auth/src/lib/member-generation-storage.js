import { nowIso, sha256Hex } from './tokens.js';
import { putNewManagedR2Object } from './r2-cleanup.js';
import { generationExecution } from './member-generation-jobs.js';

// Stable primary asset identities permit ingest retries after a committed INSERT
// whose response was lost. Different attempts retain different R2 staging keys.
export async function existingGenerationAsset(env, userId, mediaType) {
  const execution = generationExecution(env);
  if (!execution) return null;
  await execution.assertClaim();
  if (execution.user.id !== userId || execution.job.media_type !== mediaType) throw new Error('generation_asset_owner_mismatch');
  const table = mediaType === 'image' ? 'ai_images' : 'ai_text_assets';
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).bind(execution.job.id,userId).first();
  if (!row) return null;
  return { id: row.id, title: row.title || null, folder_id: row.folder_id || null,
    prompt: row.prompt || null, model: row.model || null, steps: row.steps ?? null, seed: row.seed ?? null,
    mime_type: row.mime_type || null, size_bytes: row.size_bytes, source_module: row.source_module || null,
    created_at: row.created_at, derivatives_status: row.derivatives_status || null,
    file_url: `/api/ai/${mediaType==='image'?'images':'text-assets'}/${row.id}/file`,
    poster_url: row.poster_r2_key ? `/api/ai/text-assets/${row.id}/poster` : null };
}

export function generationStorageReservation(env) {
  const job = generationExecution(env)?.job;
  return job ? { id:job.id, token:job.processing_token } : null;
}

// Downloads are replayable reads, unlike paid inference. Preserve their bytes
// before final asset insertion so an expired provider URL cannot destroy a
// successfully ingested result after a database interruption.
export async function cacheGenerationDownload(env,label,url,download) {
  const execution=generationExecution(env);
  if(!execution) return download();
  await execution.assertClaim();
  const job=execution.job, name=`download-${label}`, fingerprint=await sha256Hex(url);
  const row=await env.DB.prepare('SELECT provider_receipts_json FROM member_generation_jobs WHERE id=?').bind(job.id).first();
  const receipts=JSON.parse(row.provider_receipts_json);
  let receipt=receipts[name];
  if(receipt && receipt.fingerprint!==fingerprint) throw new Error('generation_download_identity_mismatch');
  if(!receipt) {
    receipt={key:`users/${job.user_id}/generation-jobs/${job.id}/${name}`,fingerprint,kind:'download'};
    receipts[name]=receipt;
    const written=await env.DB.prepare(`UPDATE member_generation_jobs SET provider_receipts_json=?
      WHERE id=? AND processing_token=? AND locked_until>? AND provider_receipts_json=?`).bind(JSON.stringify(receipts),job.id,job.processing_token,nowIso(),row.provider_receipts_json).run();
    if(!written.meta?.changes) throw new Error('generation_claim_lost');
  }
  const stored=await env.USER_IMAGES.get(receipt.key);
  if(stored) {
    const body=new Uint8Array(await new Response(stored.body).arrayBuffer());
    return {body,contentType:stored.httpMetadata.contentType,sizeBytes:body.byteLength};
  }
  const result=await download();
  await execution.assertClaim();
  await putNewManagedR2Object(env,receipt.key,result.body,{httpMetadata:{contentType:result.contentType}});
  await execution.assertClaim();
  return result;
}
