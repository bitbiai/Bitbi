// A single range is streamed directly from R2. Multi-range/unknown/malformed
// Range fields are ignored (full 200); valid but unsatisfiable ranges get 416.
export function parseVideoRange(value, size) {
  if (!value || value.length > 256 || !/^bytes=/i.test(value) || value.includes(',')) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? BigInt(match[1]) : null;
  const end = match[2] ? BigInt(match[2]) : null;
  const total = BigInt(size);
  if (total === 0n || (start !== null && (start >= total || (end !== null && end < start))) || (start === null && end === 0n)) return { unsatisfiable: true };
  const offset = start === null ? (end >= total ? 0n : total - end) : start;
  const last = start === null || end === null || end >= total ? total - 1n : end;
  return { offset: Number(offset), length: Number(last - offset + 1n) };
}

export async function publicVideoResponse(request, bucket, key, headersForObject) {
  const rangeHeader = request.method === 'GET' ? request.headers.get('Range') : null;
  let metadata, range;
  if (rangeHeader) {
    metadata = await bucket.head(key);
    if (!metadata) return null;
    const ifRange = request.headers.get('If-Range');
    const date = ifRange && !ifRange.startsWith('"') && !ifRange.startsWith('W/') ? Date.parse(ifRange) : NaN;
    const matches = !ifRange || ifRange === metadata.httpEtag
      || (Number.isFinite(date) && metadata.uploaded && Math.floor(metadata.uploaded.getTime() / 1000) <= Math.floor(date / 1000));
    range = matches ? parseVideoRange(rangeHeader, metadata.size) : null;
    if (range?.unsatisfiable) {
      const headers = new Headers({ 'Content-Range': `bytes */${metadata.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      return new Response(null, { status: 416, headers });
    }
  }
  // Pin a partial read to the metadata generation. Never combine stale total
  // size/ETag with bytes from a concurrently replaced object or buffer its body.
  const object = await bucket.get(key, range ? { range, onlyIf: { etagMatches: metadata.etag } } : undefined);
  if (!object) return null;
  if (!('body' in object)) return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  const headers = headersForObject(object);
  headers.set('Accept-Ranges', 'bytes');
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  if (range) {
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
    headers.set('Content-Length', String(range.length));
  }
  return new Response(request.method === 'HEAD' ? null : object.body, { status: range ? 206 : 200, headers });
}
