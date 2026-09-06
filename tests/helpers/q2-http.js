const http = require('node:http');

// Local transport adapter for the real Worker entrypoint. It supplies the
// synthetic deployment's logical HTTPS URL; this is not a TLS/workerd test.
// Fixed loopback port lets the external test sandbox deny every other socket.
async function startWorkerHttp(worker, env, { origin = 'https://bitbi.ai' } = {}) {
  const background = new Set();
  const context = {
    waitUntil(promise) {
      const tracked = Promise.resolve(promise);
      background.add(tracked);
      tracked.finally(() => background.delete(tracked)).catch(() => {});
    },
  };
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 262144) throw new Error('Synthetic HTTP fixture body too large');
        chunks.push(chunk);
      }
      const request = new Request(new URL(incoming.url, origin), {
        method: incoming.method,
        headers: incoming.headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      const response = await worker.fetch(request, env, context);
      outgoing.statusCode = response.status;
      for (const [name, value] of response.headers) {
        if (name !== 'set-cookie') outgoing.setHeader(name, value);
      }
      const cookies = response.headers.getSetCookie();
      if (cookies.length) outgoing.setHeader('Set-Cookie', cookies);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.statusCode = 500;
      outgoing.end(JSON.stringify({ fixtureError: String(error.message) }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(18788, '127.0.0.1', resolve);
  });
  return {
    request(path, { method = 'GET', headers = {}, body } = {}) {
      return new Promise((resolve, reject) => {
        // Each fixture can close/reopen this port. Do not reuse an idle socket
        // from an earlier synthetic server incarnation.
        const request = http.request({ hostname: '127.0.0.1', port: 18788, path, method, headers, agent: false }, (incoming) => {
          const chunks = [];
          incoming.on('data', (chunk) => chunks.push(chunk));
          incoming.on('error', reject);
          incoming.on('end', () => {
            const responseHeaders = new Headers();
            for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
              responseHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
            }
            const response = new Response(
              [204, 205, 304].includes(incoming.statusCode) ? null : Buffer.concat(chunks),
              { status: incoming.statusCode, headers: responseHeaders },
            );
            response.rawHeaders = incoming.rawHeaders;
            resolve(response);
          });
        });
        request.on('error', reject);
        request.end(body);
      });
    },
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await Promise.all([...background]);
    },
  };
}

module.exports = { startWorkerHttp };
