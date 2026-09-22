import { GPT_IMAGE_25_AGGREGATE_BYTES, GPT_IMAGE_25_IMAGE_BYTES, image25Base64, image25Error, image25Mime, readImage25Bytes } from '../../../shared/gpt-image-25.mjs';
import { GPT_IMAGE_25_MAX_REFERENCE_IMAGES } from '../../../../js/shared/gpt-image-25-contract.mjs';

// Browser requests retain compact owner-scoped asset identities. Only this
// boundary reads originals; cookie URLs and public substitutes never reach AI.
export async function resolveImage25Sources(env, userId, sources = []) {
  if (!Array.isArray(sources) || sources.length > GPT_IMAGE_25_MAX_REFERENCE_IMAGES) throw image25Error('too_many_references', 'Select at most 16 reference images.');
  const images = [], identities = [], sourceRefs = []; let aggregateBytes = 0;
  for (const source of sources) {
    if (source?.source_type !== 'saved_asset' || typeof source.asset_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(source.asset_id)) throw image25Error('reference_invalid', 'Choose an owned image from Assets Manager.');
    const row = await env.DB.prepare('SELECT id, r2_key, size_bytes FROM ai_images WHERE id = ? AND user_id = ? LIMIT 1').bind(source.asset_id, userId).first();
    if (!row) throw image25Error('reference_not_found', 'Reference image is unavailable.', 404);
    const object = await env.USER_IMAGES.get(row.r2_key);
    if (!object) throw image25Error('reference_not_found', 'Reference image is unavailable.', 404);
    const declaredSize = Math.max(Number(row.size_bytes || 0), Number(object.size || 0));
    if (declaredSize > GPT_IMAGE_25_IMAGE_BYTES || aggregateBytes + declaredSize > GPT_IMAGE_25_AGGREGATE_BYTES) throw image25Error('references_too_large', 'References must be at most 10 MB each and 16 MB combined.', 413);
    const bytes = await readImage25Bytes(object, Math.min(GPT_IMAGE_25_IMAGE_BYTES, GPT_IMAGE_25_AGGREGATE_BYTES - aggregateBytes));
    aggregateBytes += bytes.byteLength;
    const declared = (object.httpMetadata?.contentType || '').split(';')[0].trim().toLowerCase();
    const mime = image25Mime(bytes, declared);
    if (!env.IMAGES?.info) throw image25Error('images_binding_unavailable', 'Reference image inspection is unavailable.', 503);
    let info; try { info = await env.IMAGES.info(bytes); } catch { throw image25Error('reference_invalid', 'Reference image could not be decoded.'); }
    const width = Number(info?.width), height = Number(info?.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 40_000_000) throw image25Error('reference_dimensions_invalid', 'Reference dimensions exceed the application image limits.');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    if (source.content_hash && source.content_hash !== hash) throw image25Error('reference_changed', 'An accepted reference image changed. Create a new request.', 409);
    identities.push({ source_type: 'saved_asset', asset_id: row.id, content_hash: hash });
    sourceRefs.push({ source_type: 'saved_asset', asset_id: row.id, r2_key: row.r2_key, content_hash: hash });
    images.push(`data:${mime};base64,${image25Base64(bytes)}`);
  }
  return { images, identities, sourceRefs, aggregateBytes, referenceImageCount: images.length, operation: images.length ? 'edit' : 'generate' };
}
