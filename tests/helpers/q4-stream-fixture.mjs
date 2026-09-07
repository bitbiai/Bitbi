import assert from 'node:assert/strict';

export const STREAM_SECRET = 'q4-stream-processor-synthetic-not-a-production-secret';
export const STREAM_UID = '0123456789abcdef0123456789abcdef';
export const STREAM_DOWNLOAD = `https://customer-fixture.cloudflarestream.com/${STREAM_UID}/downloads/default.mp4`;
export async function seedStreamJob(db, number = 1) {
  const hex = number.toString(16).padStart(16, '0'), id = `msp_${hex}`;
  const user = `q4-stream-user-${hex}`, asset = `q4-stream-asset-${hex}`, key = `users/${user}/preview.mp4`;
  const now = new Date().toISOString(), fingerprint = hex.repeat(4);
  await db.prepare(`INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at)
    VALUES (?,?,'synthetic-unused',?,'admin','active',?)`).bind(user, `${user}@example.invalid`, now, now).run();
  await db.prepare(`INSERT INTO ai_text_assets(id,user_id,title,file_name,mime_type,size_bytes,source_module,r2_key,created_at,visibility)
    VALUES (?,?,'Synthetic video','preview.mp4','video/mp4',3,'video',?,?,'public')`).bind(asset, user, key, now).run();
  await db.prepare(`INSERT INTO memvid_stream_previews(id,asset_id,user_id,source_r2_key,source_fingerprint,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'queued',?,?)`).bind(id, asset, user, key, fingerprint, now, now).run();
  return { id, asset, user, key, fingerprint };
}
export function streamApi(fetch) {
  return async (path, body, secret = STREAM_SECRET) => {
    const response = await fetch(`https://bitbi.ai/api/internal/memvid-stream-previews/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.91' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
}
export async function claimStream(api) {
  const r = await api('jobs/claim', { receipt_protocol: 2, limit: 1, repair_downloads: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data.jobs[0];
}
export function completionBody(job, uid = STREAM_UID) {
  return { claim_token: job.claim_token, stream_uid: uid, source_fingerprint: job.source.fingerprint,
    provider_metadata: { download_status: 'ready', download_url: `https://customer-fixture.cloudflarestream.com/${uid}/downloads/default.mp4` } };
}
