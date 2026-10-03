import { inspectOwnedTimeReference } from './h3-reference-metadata.js';

const review = () => Object.assign(new Error('Stored Seedance output needs duration/format review; no additional generation was started.'), { code: 'generation_result_requires_credit_review', status: 409 });
// Custom BITBI billable quantity approved by the owner. This is a measurement
// of the saved output, not invented provider usage or caller-supplied metadata.
export async function seedance25StoredOutputSeconds(env, key, format) {
    if (!key || !['mp4', 'mov'].includes(format)) throw review();
    const head = await env.USER_IMAGES.head(key);
    const mime = head?.httpMetadata?.contentType;
    if (!head?.etag || head.size <= 0 || head.size > 80_000_000 || mime !== (format === 'mov' ? 'video/quicktime' : 'video/mp4')) throw review();
    const object = await env.USER_IMAGES.get(key, { onlyIf: { etagMatches: head.etag } });
    if (!object?.body) throw review();
    try {
        const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
        if (bytes.byteLength !== head.size) throw review();
        const result = inspectOwnedTimeReference(bytes, 'video', mime);
        if (!Number.isFinite(result.duration) || result.duration <= 0 || result.duration > 30) throw review();
        return result.duration;
    } catch { throw review(); }
}
