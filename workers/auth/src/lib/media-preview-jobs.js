// Lease the existing public preview records. Processing still uses the shared
// FFmpeg runner; no additional queue, provider or storage format.
import { nowIso, randomTokenHex } from './tokens.js';
import {getVideoDeliveryFeatureStatus,VIDEO_DELIVERY_FEATURE_KEYS as KEYS} from './video-delivery-settings.js';
export async function publicPreviewCapabilities(env) {
  const {features}=await getVideoDeliveryFeatureStatus(env);
  return {hero:features[KEYS.HERO_EXTERNAL_FFMPEG]?.effective_enabled===true,stream:features[KEYS.MEMVID_STREAM_PREVIEWS]?.effective_enabled===true};
}
const lease = () => new Date(Date.now() + 30 * 60_000).toISOString();
export async function claimHeroPreview(env, row, backend) {
  const token = randomTokenHex(16), now = nowIso();
  const result = await env.DB.prepare(`UPDATE homepage_hero_video_derivatives
    SET status='processing',processing_token=?,locked_until=?,attempt_count=attempt_count+1,
      processing_started_at=COALESCE(processing_started_at,?),updated_at=?
    WHERE id=? AND processing_backend=? AND attempt_count<8
      AND (status='queued' OR (status='processing' AND locked_until<=?))`)
    .bind(token,lease(),now,now,row.id,backend,now).run();
  return result.meta?.changes ? {...row,status:'processing',processing_token:token,updated_at:now} : null;
}
export async function claimHeroPoster(env, row, backend) {
  const token=randomTokenHex(16), now=nowIso();
  const result=await env.DB.prepare(`UPDATE homepage_hero_video_uploads
    SET poster_processing_token=?,poster_locked_until=?,poster_attempt_count=poster_attempt_count+1
    WHERE id=? AND processing_backend=? AND poster_attempt_count<8
      AND (poster_locked_until IS NULL OR poster_locked_until<=?)
      AND EXISTS(SELECT 1 FROM ai_text_assets WHERE id=homepage_hero_video_uploads.asset_id
        AND user_id=homepage_hero_video_uploads.user_id AND poster_r2_key IS NULL)`)
    .bind(token,lease(),row.upload_id,backend,now).run();
  return result.meta?.changes ? {...row,public_poster_token:token} : null;
}
export async function ownsPublicPreview(env,{kind,id,backend,token}) {
  if(token!==null && !/^[a-f0-9]{32}$/.test(token||''))return false;
  if(token===null && backend!=='github')return false;
  const table=kind==='poster'?'homepage_hero_video_uploads':'homepage_hero_video_derivatives';
  const prefix=kind==='poster'?'poster_':'';
  const key=kind==='poster'?'asset_id':'id';
  return Boolean(await env.DB.prepare(`SELECT id FROM ${table} WHERE ${key}=? AND processing_backend=?
    AND ${prefix}processing_token IS ? AND ${prefix}locked_until>?`)
    .bind(id,backend,token,nowIso()).first());
}
export async function duePublicPreviews(env,backend) {
  const now=nowIso(),capabilities=await publicPreviewCapabilities(env);
  const row=await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM homepage_hero_video_derivatives WHERE ? AND processing_backend=?
      AND provider='external_ffmpeg' AND attempt_count<8 AND source_r2_key IS NOT NULL
      AND (status='queued' OR (status='processing' AND locked_until<=?))) +
    (SELECT COUNT(*) FROM homepage_hero_video_uploads u JOIN ai_text_assets a ON a.id=u.asset_id AND a.user_id=u.user_id
      WHERE ? AND u.processing_backend=? AND u.poster_attempt_count<8 AND a.poster_r2_key IS NULL AND a.r2_key IS NOT NULL
      AND (u.poster_locked_until IS NULL OR u.poster_locked_until<=?)
      AND COALESCE(json_extract(a.metadata_json,'$.homepage_hero_source.poster_status'),'') NOT IN ('ready','failed')) +
    (SELECT COUNT(*) FROM memvid_stream_previews p JOIN ai_text_assets a ON a.id=p.asset_id AND a.user_id=p.user_id
      LEFT JOIN memvid_stream_upload_receipts r ON r.job_id=p.id
      WHERE ? AND p.processing_backend=? AND a.visibility='public' AND a.r2_key=p.source_r2_key
      AND ((r.job_id IS NULL AND p.status='queued') OR (r.retired_at IS NULL AND r.claim_expires_at<=?
        AND r.phase IN ('prepared','received') AND p.status IN ('processing','uploading','ready')))) AS count`)
    .bind(Number(capabilities.hero),backend,now,Number(capabilities.hero),backend,now,Number(capabilities.stream),backend,now).first();
  return Number(row?.count||0);
}

// Existing cron recovery makes exhausted leases visible and manually retryable.
// Completed output and a poster installed by another legitimate path stay intact.
export async function recoverPublicPreviews(env) {
  const now=nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE homepage_hero_video_derivatives SET status='failed',error_code='preview_attempts_exhausted',
      error_message='Preview processing needs an explicit retry.',locked_until=NULL,updated_at=?
      WHERE status='processing' AND attempt_count>=8 AND locked_until<=?`).bind(now,now),
    env.DB.prepare(`UPDATE ai_text_assets SET metadata_json=json_set(COALESCE(metadata_json,'{}'),
      '$.homepage_hero_source.poster_status','failed','$.homepage_hero_source.poster_retryable',json('true'),
      '$.homepage_hero_source.poster_error_code','preview_attempts_exhausted')
      WHERE poster_r2_key IS NULL AND EXISTS(SELECT 1 FROM homepage_hero_video_uploads u
        WHERE u.asset_id=ai_text_assets.id AND u.user_id=ai_text_assets.user_id
          AND u.poster_attempt_count>=8 AND u.poster_locked_until<=?)`).bind(now),
    env.DB.prepare(`UPDATE homepage_hero_video_uploads SET poster_locked_until=NULL
      WHERE poster_attempt_count>=8 AND poster_locked_until<=?`).bind(now),
  ]);
}
