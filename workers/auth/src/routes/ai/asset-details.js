import { requireUser } from '../../lib/session.js';
import { json } from '../../lib/response.js';
import { BODY_LIMITS, readJsonBodyLimited } from '../../lib/request.js';
import { projectFileDetails } from '../../lib/asset-preview-details.js';

export async function handleAssetDetails(ctx, kind, id) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;
  const table = kind === 'images' ? 'ai_images' : 'ai_text_assets';
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=?
    AND NOT EXISTS(SELECT 1 FROM member_generation_unready_assets WHERE id=?)
    AND NOT EXISTS(SELECT 1 FROM canvas_asset_dispositions WHERE asset_id=? AND state<>'saved')`)
    .bind(id, session.user.id, id, id).first();
  const reply = (body, status = 200) => json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (!row) return reply({ ok: false, code: 'not_found' }, 404);
  if (kind !== 'images') return reply({ ok: true, details: projectFileDetails(row) });

  const details = { model: row.model || null, prompt: null, steps: row.steps ?? null, seed: row.seed ?? null,
    width: null, height: null, mimeType: null };
  // ai_images.prompt is a renameable title, never original input provenance.
  const jobs = await env.DB.prepare("SELECT input_r2_key FROM member_generation_jobs WHERE user_id=? AND asset_id=? AND media_type='image' LIMIT 2")
    .bind(session.user.id, id).all();
  if (jobs.results?.length === 1) {
    const input = await env.USER_IMAGES.get(jobs.results[0].input_r2_key);
    if (input && input.size <= BODY_LIMITS.aiGenerateImageJson) {
      try {
        const value = await readJsonBodyLimited(new Response(input.body, { headers: { 'Content-Type': 'application/json' } }), { maxBytes: BODY_LIMITS.aiGenerateImageJson });
        if (typeof value.prompt === 'string' && value.prompt.length <= 32768) details.prompt = value.prompt;
      } catch { /* Removed/invalid retained provenance remains unavailable. */ }
    } else await input?.body?.cancel();
  }
  const head = await env.USER_IMAGES.head(row.r2_key);
  const width = Number(head?.customMetadata?.original_width), height = Number(head?.customMetadata?.original_height);
  if (width > 0 && height > 0) {
    details.width = width; details.height = height; details.mimeType = head.customMetadata.original_mime || null;
  } else if (head && head.size <= 10 * 1024 * 1024 && env.IMAGES?.info) {
    // One owned original, only on explicit details expansion; no card-list probe.
    const original = await env.USER_IMAGES.get(row.r2_key);
    if (original) {
      try {
        const info = await env.IMAGES.info(original.body);
        details.width = Number(info.width) || null; details.height = Number(info.height) || null;
        details.mimeType = ['image/png', 'image/jpeg', 'image/webp'].includes(info.format) ? info.format
          : ({ png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp' })[info.format] || null;
      } catch { /* Technical properties cannot be inferred from a thumbnail. */ }
    }
  }
  return reply({ ok: true, details });
}
