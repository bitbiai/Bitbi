// Test-only IO bridge: the unmodified processor CLI and its native fixture
// children stay inside the existing OS network boundary. No network fallback.
let sequence = 0;
const waiting = new Map();
process.on('message', reply => {
  const pending = waiting.get(reply.id); if (!pending) return;
  waiting.delete(reply.id);
  if (reply.error) pending.reject(new Error(reply.error));
  else pending.resolve(new Response(reply.body, { status: reply.status, headers: reply.headers }));
  if (!waiting.size) process.channel?.unref();
});
process.channel?.unref();
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  let body = init.body;
  if (body instanceof FormData) body = JSON.stringify({ meta: body.get('meta'), fileBytes: body.get('file')?.size });
  if (body !== undefined && typeof body !== 'string') throw new Error('Unreviewed processor fixture body');
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject }); process.channel?.ref();
    process.send({ id, url, method: init.method || 'GET', headers: Object.fromEntries(new Headers(init.headers)), body });
  });
};
