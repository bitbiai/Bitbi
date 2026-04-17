const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const {
  createAuthTestEnv,
  createExecutionContext,
  loadWorker,
  nowIso,
  seedSession,
} = require('./helpers/auth-worker-harness');

async function loadAuthModules() {
  const passwordPath = pathToFileURL(path.join(process.cwd(), 'workers/auth/src/lib/passwords.js')).href;
  return import(passwordPath);
}

async function loadRequestModule() {
  const requestPath = pathToFileURL(path.join(process.cwd(), 'workers/auth/src/lib/request.js')).href;
  return import(requestPath);
}

async function loadObservabilityModule() {
  const observabilityPath = pathToFileURL(path.join(process.cwd(), 'js/shared/worker-observability.mjs')).href;
  return import(observabilityPath);
}

async function loadWalletTestModules() {
  const accounts = await import('viem/accounts');
  return {
    privateKeyToAccount: accounts.privateKeyToAccount,
  };
}

function buildTestSiweMessage(fields = {}) {
  const domain = String(fields.domain || '').trim();
  const address = String(fields.address || '').trim();
  const statement = String(fields.statement || '').trim();
  const uri = String(fields.uri || '').trim();
  const version = String(fields.version || '1').trim() || '1';
  const chainId = Number(fields.chainId);
  const nonce = String(fields.nonce || '').trim();
  const issuedAt = String(fields.issuedAt || '').trim();
  const expirationTime = String(fields.expirationTime || '').trim();

  const lines = [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
  ];

  if (statement) {
    lines.push(statement, '');
  }

  lines.push(
    `URI: ${uri}`,
    `Version: ${version}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`
  );

  if (expirationTime) {
    lines.push(`Expiration Time: ${expirationTime}`);
  }

  return lines.join('\n');
}

function authJsonRequest(pathname, method, body, headers = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) {
    requestHeaders.set('Content-Type', 'application/json');
  }
  return new Request(`https://bitbi.ai${pathname}`, {
    method,
    headers: requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function createContractUser({ id = 'admin-ai-user', role = 'admin' } = {}) {
  return {
    id,
    email: `${id}@example.com`,
    password_hash: 'unused',
    created_at: nowIso(),
    status: 'active',
    role,
    email_verified_at: nowIso(),
    verification_method: 'email_verified',
  };
}

function createAdminUser(id = 'admin-ai-user') {
  return createContractUser({ id, role: 'admin' });
}

function createAiLabRunStub() {
  return async (modelId, payload) => {
    if (
      modelId === '@cf/black-forest-labs/flux-1-schnell' ||
      modelId === '@cf/black-forest-labs/flux-2-klein-9b' ||
      modelId === '@cf/black-forest-labs/flux-2-dev'
    ) {
      return `data:image/png;base64,${ONE_PIXEL_PNG_DATA_URI.replace('data:image/png;base64,', '')}`;
    }

    if (
      modelId === '@cf/baai/bge-m3' ||
      modelId === '@cf/google/embeddinggemma-300m'
    ) {
      const input = Array.isArray(payload.text) ? payload.text : [payload.text];
      return {
        data: input.map((_, index) => ({
          embedding: [0.1 + index, 0.2 + index, 0.3 + index, 0.4 + index],
        })),
        shape: [input.length, 4],
        pooling: 'cls',
      };
    }

    if (modelId === 'minimax/music-2.6') {
      return {
        data: {
          audio: '494433040000000000',
          status: 2,
        },
        trace_id: 'stub-music-trace',
        extra_info: {
          music_duration: 24000,
          music_sample_rate: 44100,
          music_channel: 2,
          bitrate: 256000,
          music_size: 4096,
        },
      };
    }

    if (modelId === '@cf/google/gemma-4-26b-a4b-it' && payload.stream) {
      const sseBody = 'data: {"response":"Live "}\n\ndata: {"response":"agent "}\n\ndata: {"response":"response."}\n\ndata: [DONE]\n\n';
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseBody));
          controller.close();
        },
      });
    }

    return {
      response: `Stubbed output for ${modelId}`,
      usage: {
        prompt_tokens: 12,
        completion_tokens: 18,
        total_tokens: 30,
      },
    };
  };
}

function createAiLabServiceBinding(aiWorker, aiEnv) {
  return {
    async fetch(request) {
      return aiWorker.fetch(request, aiEnv, createExecutionContext().execCtx);
    },
  };
}

async function createAdminAiContractHarness(options = {}) {
  const authWorker = await loadWorker('workers/auth/src/index.js');
  const aiWorker = await loadWorker('workers/ai/src/index.js');
  const user = options.user || createAdminUser();
  const aiRun = options.aiRun || createAiLabRunStub();
  const env = createAuthTestEnv({
    users: [user],
    imagesBinding: options.imagesBinding,
  });
  env.AI_LAB = createAiLabServiceBinding(aiWorker, {
    AI: {
      async run(...args) {
        return aiRun(...args);
      },
    },
  });

  const authHeaders = {
    Origin: 'https://bitbi.ai',
    'CF-Connecting-IP': '203.0.113.25',
  };
  if (options.withSession !== false) {
    const token = await seedSession(env, user.id);
    authHeaders.Cookie = `bitbi_session=${token}`;
  }

  return {
    authWorker,
    env,
    authHeaders,
    user,
  };
}

function parseSessionCookie(setCookie) {
  return setCookie.split(';')[0];
}

async function createSignedWalletPayload({ challenge, privateKey }) {
  const { privateKeyToAccount } = await loadWalletTestModules();
  const account = privateKeyToAccount(privateKey);
  const message = buildTestSiweMessage({
    ...challenge,
    address: account.address,
  });
  const signature = await account.signMessage({ message });
  return {
    account,
    message,
    signature,
  };
}

const ONE_PIXEL_PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uUAAAAASUVORK5CYII=';
const ONE_PIXEL_PNG_BYTES = Buffer.from(
  ONE_PIXEL_PNG_DATA_URI.replace('data:image/png;base64,', ''),
  'base64'
);

test('worker observability helper builds stable structured events and correlation headers', async () => {
  const {
    BITBI_CORRELATION_HEADER,
    buildDiagnosticEvent,
    getErrorFields,
    withCorrelationId,
  } = await loadObservabilityModule();

  const error = new Error('provider exploded');
  error.code = 'upstream_error';
  error.status = 502;

  const event = buildDiagnosticEvent({
    service: 'bitbi-auth',
    component: 'ai-generate-image',
    event: 'ai_generate_failed',
    level: 'error',
    correlationId: 'corr-12345678',
    user_id: 'user-1',
    ...getErrorFields(error),
  });

  expect(event).toEqual(expect.objectContaining({
    service: 'bitbi-auth',
    component: 'ai-generate-image',
    event: 'ai_generate_failed',
    level: 'error',
    correlation_id: 'corr-12345678',
    user_id: 'user-1',
    error_message: 'provider exploded',
    error_code: 'upstream_error',
    error_status: 502,
  }));
  expect(typeof event.ts).toBe('string');

  const response = withCorrelationId(
    new Response(JSON.stringify({ ok: false }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }),
    'corr-12345678'
  );
  expect(response.headers.get(BITBI_CORRELATION_HEADER)).toBe('corr-12345678');
});

async function readMultipartEntries(multipart) {
  const response = new Response(multipart.body, {
    headers: {
      'content-type': multipart.contentType,
    },
  });
  const formData = await response.formData();
  return Array.from(formData.entries());
}

async function readMultipartFields(multipart) {
  const entries = await readMultipartEntries(multipart);
  return Object.fromEntries(
    entries
      .filter(([, value]) => typeof value === 'string')
      .map(([key, value]) => [key, String(value)])
  );
}

function decodeStoredTextBody(body) {
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(body));
  }
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  return String(body || '');
}

function makeFavorites(userId, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    user_id: userId,
    item_type: 'gallery',
    item_id: `item-${index + 1}`,
    title: `Favorite ${index + 1}`,
    thumb_url: `/thumb-${index + 1}.png`,
    created_at: nowIso(),
  }));
}

function quotaDayStart(ts = nowIso()) {
  return ts.slice(0, 10) + 'T00:00:00.000Z';
}

function createAiImageDerivativeMessage({
  imageId,
  userId,
  originalKey,
  derivativesVersion = 1,
  trigger = 'save',
} = {}) {
  return {
    schema_version: 1,
    type: 'ai_image_derivative.generate',
    image_id: imageId,
    user_id: userId,
    original_key: originalKey,
    derivatives_version: derivativesVersion,
    enqueued_at: nowIso(),
    correlation_id: `corr-${imageId}-${derivativesVersion}`,
    trigger,
  };
}

function createQueueBatch(messages, { attempts = 1 } = {}) {
  const states = messages.map(() => ({
    acked: false,
    retried: false,
    retryOptions: null,
  }));
  return {
    batch: {
      messages: messages.map((body, index) => ({
        body,
        attempts,
        ack() {
          states[index].acked = true;
        },
        retry(options) {
          states[index].retried = true;
          states[index].retryOptions = options || null;
        },
      })),
    },
    states,
  };
}

function makeConsumedQuotaUsage(userId, count, dayStart = quotaDayStart()) {
  return Array.from({ length: count }, (_, index) => {
    const createdAt = nowIso();
    return {
      id: `quota-${userId}-${index + 1}`,
      user_id: userId,
      day_start: dayStart,
      slot: index + 1,
      status: 'consumed',
      created_at: createdAt,
      expires_at: null,
      consumed_at: createdAt,
    };
  });
}

function makeActiveRateLimitCounter(scope, limiterKey, count, windowMs) {
  const nowMs = Date.now();
  const windowStartMs = nowMs - (nowMs % windowMs);
  return {
    scope,
    limiter_key: limiterKey,
    window_start_ms: windowStartMs,
    count,
    expires_at: new Date(windowStartMs + windowMs).toISOString(),
    updated_at: new Date(nowMs).toISOString(),
  };
}

test.describe('Wallet SIWE routes', () => {
  const walletPrivateKey = '0x59c6995e998f97a5a0044966f094538e2d7d7b6c8f4f7f22e9f11d8932ff9d14';
  const otherWalletPrivateKey = '0x8b3a350cf5c34c9194ca3a545d5cb4d0a27f9a9f1d3d3b5c9b5f6a6d7b8c9d10';

  function createWalletUser(id = 'wallet-user-1') {
    return {
      id,
      email: `${id}@example.com`,
      password_hash: 'unused',
      created_at: nowIso(),
      status: 'active',
      role: 'member',
      email_verified_at: nowIso(),
      verification_method: 'email_verified',
    };
  }

  test('issues login nonce challenge', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv();

    const response = await worker.fetch(
      authJsonRequest('/api/wallet/siwe/nonce', 'POST', { intent: 'login' }, {
        Origin: 'https://bitbi.ai',
        'CF-Connecting-IP': '203.0.113.45',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.challenge).toEqual(expect.objectContaining({
      intent: 'login',
      domain: 'bitbi.ai',
      uri: 'https://bitbi.ai',
      version: '1',
      chainId: 1,
      statement: 'Sign in to BITBI with your linked Ethereum wallet.',
    }));
    expect(typeof body.challenge.nonce).toBe('string');
    expect(env.DB.state.siweChallenges).toHaveLength(1);
    expect(env.DB.state.siweChallenges[0].intent).toBe('login');
  });

  test('link nonce requires auth', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv();

    const response = await worker.fetch(
      authJsonRequest('/api/wallet/siwe/nonce', 'POST', { intent: 'link' }, {
        Origin: 'https://bitbi.ai',
        'CF-Connecting-IP': '203.0.113.46',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(response.status).toBe(401);
  });

  test('links a wallet to the authenticated account', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const user = createWalletUser('wallet-link-user');
    const env = createAuthTestEnv({ users: [user] });
    const { execCtx, flush } = createExecutionContext();
    const sessionToken = await seedSession(env, user.id);
    const headers = {
      Origin: 'https://bitbi.ai',
      Cookie: `bitbi_session=${sessionToken}`,
      'CF-Connecting-IP': '203.0.113.47',
    };

    const nonceResponse = await worker.fetch(
      authJsonRequest('/api/wallet/siwe/nonce', 'POST', { intent: 'link' }, headers),
      env,
      execCtx
    );
    const nonceBody = await nonceResponse.json();
    const signedPayload = await createSignedWalletPayload({
      challenge: nonceBody.challenge,
      privateKey: walletPrivateKey,
    });

    const verifyResponse = await worker.fetch(
      authJsonRequest('/api/wallet/siwe/verify', 'POST', {
        intent: 'link',
        message: signedPayload.message,
        signature: signedPayload.signature,
      }, headers),
      env,
      execCtx
    );
    await flush();

    expect(verifyResponse.status).toBe(200);
    const verifyBody = await verifyResponse.json();
    expect(verifyBody.ok).toBe(true);
    expect(verifyBody.linked_wallet.address).toBe(signedPayload.account.address);
    expect(env.DB.state.linkedWallets).toHaveLength(1);
    expect(env.DB.state.linkedWallets[0].user_id).toBe(user.id);
    expect(env.DB.state.userActivityLog.some((row) => row.action === 'wallet_link')).toBe(true);
  });

  test('wallet login creates a normal app session', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const { privateKeyToAccount } = await loadWalletTestModules();
    const account = privateKeyToAccount(walletPrivateKey);
    const user = createWalletUser('wallet-login-user');
    const env = createAuthTestEnv({
      users: [user],
      linkedWallets: [{
        id: 'linked-wallet-1',
        user_id: user.id,
        address_normalized: account.address.toLowerCase(),
        address_display: account.address,
        chain_id: 1,
        is_primary: 1,
        linked_at: nowIso(),
        last_login_at: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      }],
    });
    const { execCtx, flush } = createExecutionContext();

    const nonceResponse = await worker.fetch(
      authJsonRequest('/api/wallet/siwe/nonce', 'POST', { intent: 'login' }, {
        Origin: 'https://bitbi.ai',
        'CF-Connecting-IP': '203.0.113.48',
      }),
      env,
      execCtx
    );
    const nonceBody = await nonceResponse.json();
    const signedPayload = await createSignedWalletPayload({
      challenge: nonceBody.challenge,
      privateKey: walletPrivateKey,
    });

    const verifyResponse = await worker.fetch(
      authJsonRequest('/api/wallet/siwe/verify', 'POST', {
        intent: 'login',
        message: signedPayload.message,
        signature: signedPayload.signature,
      }, {
        Origin: 'https://bitbi.ai',
        'CF-Connecting-IP': '203.0.113.48',
      }),
      env,
      execCtx
    );
    await flush();

    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.headers.get('set-cookie')).toContain('bitbi_session=');
    const verifyBody = await verifyResponse.json();
    expect(verifyBody.ok).toBe(true);
    expect(env.DB.state.sessions.length).toBe(1);
    expect(env.DB.state.linkedWallets[0].last_login_at).toBeTruthy();
    expect(env.DB.state.userActivityLog.some((row) => row.action === 'wallet_login')).toBe(true);
  });

  test('rejects nonce reuse', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const user = createWalletUser('wallet-reuse-user');
    const env = createAuthTestEnv({ users: [user] });
    const { execCtx } = createExecutionContext();
    const sessionToken = await seedSession(env, user.id);
    const headers = {
      Origin: 'https://bitbi.ai',
      Cookie: `bitbi_session=${sessionToken}`,
      'CF-Connecting-IP': '203.0.113.49',
    };

    const nonceResponse = await worker.fetch(
      authJsonRequest('/api/wallet/siwe/nonce', 'POST', { intent: 'link' }, headers),
      env,
      execCtx
    );
    const nonceBody = await nonceResponse.json();
    const signedPayload = await createSignedWalletPayload({
      challenge: nonceBody.challenge,
      privateKey: walletPrivateKey,
    });

    const payload = {
      intent: 'link',
      message: signedPayload.message,
      signature: signedPayload.signature,
    };

    const firstResponse = await worker.fetch(authJsonRequest('/api/wallet/siwe/verify', 'POST', payload, headers), env, execCtx);
    expect(firstResponse.status).toBe(200);

    const secondResponse = await worker.fetch(authJsonRequest('/api/wallet/siwe/verify', 'POST', payload, headers), env, execCtx);
    expect(secondResponse.status).toBe(409);
  });

  test('rejects expired nonce', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const user = createWalletUser('wallet-expired-user');
    const env = createAuthTestEnv({ users: [user] });
    const { execCtx } = createExecutionContext();
    const sessionToken = await seedSession(env, user.id);
    const headers = {
      Origin: 'https://bitbi.ai',
      Cookie: `bitbi_session=${sessionToken}`,
      'CF-Connecting-IP': '203.0.113.50',
    };

    const nonceResponse = await worker.fetch(
      authJsonRequest('/api/wallet/siwe/nonce', 'POST', { intent: 'link' }, headers),
      env,
      execCtx
    );
    const nonceBody = await nonceResponse.json();
    env.DB.state.siweChallenges[0].expires_at = '2000-01-01T00:00:00.000Z';
    const signedPayload = await createSignedWalletPayload({
      challenge: nonceBody.challenge,
      privateKey: walletPrivateKey,
    });

    const response = await worker.fetch(
      authJsonRequest('/api/wallet/siwe/verify', 'POST', {
        intent: 'link',
        message: signedPayload.message,
        signature: signedPayload.signature,
      }, headers),
      env,
      execCtx
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('expired');
  });

  test('rejects wrong domain', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const user = createWalletUser('wallet-domain-user');
    const env = createAuthTestEnv({ users: [user] });
    const { execCtx } = createExecutionContext();
    const sessionToken = await seedSession(env, user.id);
    const headers = {
      Origin: 'https://bitbi.ai',
      Cookie: `bitbi_session=${sessionToken}`,
      'CF-Connecting-IP': '203.0.113.51',
    };

    const nonceResponse = await worker.fetch(authJsonRequest('/api/wallet/siwe/nonce', 'POST', { intent: 'link' }, headers), env, execCtx);
    const nonceBody = await nonceResponse.json();
    const signedPayload = await createSignedWalletPayload({
      challenge: {
        ...nonceBody.challenge,
        domain: 'evil.example',
      },
      privateKey: walletPrivateKey,
    });

    const response = await worker.fetch(
      authJsonRequest('/api/wallet/siwe/verify', 'POST', {
        intent: 'link',
        message: signedPayload.message,
        signature: signedPayload.signature,
      }, headers),
      env,
      execCtx
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('domain');
  });

  test('rejects wrong uri', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const user = createWalletUser('wallet-uri-user');
    const env = createAuthTestEnv({ users: [user] });
    const { execCtx } = createExecutionContext();
    const sessionToken = await seedSession(env, user.id);
    const headers = {
      Origin: 'https://bitbi.ai',
      Cookie: `bitbi_session=${sessionToken}`,
      'CF-Connecting-IP': '203.0.113.52',
    };

    const nonceResponse = await worker.fetch(authJsonRequest('/api/wallet/siwe/nonce', 'POST', { intent: 'link' }, headers), env, execCtx);
    const nonceBody = await nonceResponse.json();
    const signedPayload = await createSignedWalletPayload({
      challenge: {
        ...nonceBody.challenge,
        uri: 'https://evil.example',
      },
      privateKey: walletPrivateKey,
    });

    const response = await worker.fetch(
      authJsonRequest('/api/wallet/siwe/verify', 'POST', {
        intent: 'link',
        message: signedPayload.message,
        signature: signedPayload.signature,
      }, headers),
      env,
      execCtx
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('URI');
  });

  test('rejects wrong chain', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const user = createWalletUser('wallet-chain-user');
    const env = createAuthTestEnv({ users: [user] });
    const { execCtx } = createExecutionContext();
    const sessionToken = await seedSession(env, user.id);
    const headers = {
      Origin: 'https://bitbi.ai',
      Cookie: `bitbi_session=${sessionToken}`,
      'CF-Connecting-IP': '203.0.113.53',
    };

    const nonceResponse = await worker.fetch(authJsonRequest('/api/wallet/siwe/nonce', 'POST', { intent: 'link' }, headers), env, execCtx);
    const nonceBody = await nonceResponse.json();
    const signedPayload = await createSignedWalletPayload({
      challenge: {
        ...nonceBody.challenge,
        chainId: 137,
      },
      privateKey: walletPrivateKey,
    });

    const response = await worker.fetch(
      authJsonRequest('/api/wallet/siwe/verify', 'POST', {
        intent: 'link',
        message: signedPayload.message,
        signature: signedPayload.signature,
      }, headers),
      env,
      execCtx
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Ethereum Mainnet');
  });

  test('rejects wrong intent', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const user = createWalletUser('wallet-intent-user');
    const env = createAuthTestEnv({ users: [user] });
    const { execCtx } = createExecutionContext();
    const sessionToken = await seedSession(env, user.id);
    const headers = {
      Origin: 'https://bitbi.ai',
      Cookie: `bitbi_session=${sessionToken}`,
      'CF-Connecting-IP': '203.0.113.54',
    };

    const nonceResponse = await worker.fetch(authJsonRequest('/api/wallet/siwe/nonce', 'POST', { intent: 'link' }, headers), env, execCtx);
    const nonceBody = await nonceResponse.json();
    const signedPayload = await createSignedWalletPayload({
      challenge: nonceBody.challenge,
      privateKey: walletPrivateKey,
    });

    const response = await worker.fetch(
      authJsonRequest('/api/wallet/siwe/verify', 'POST', {
        intent: 'login',
        message: signedPayload.message,
        signature: signedPayload.signature,
      }, headers),
      env,
      execCtx
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('requested action');
  });

  test('rejects invalid signature', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const user = createWalletUser('wallet-signature-user');
    const env = createAuthTestEnv({ users: [user] });
    const { execCtx } = createExecutionContext();
    const sessionToken = await seedSession(env, user.id);
    const headers = {
      Origin: 'https://bitbi.ai',
      Cookie: `bitbi_session=${sessionToken}`,
      'CF-Connecting-IP': '203.0.113.55',
    };

    const nonceResponse = await worker.fetch(authJsonRequest('/api/wallet/siwe/nonce', 'POST', { intent: 'link' }, headers), env, execCtx);
    const nonceBody = await nonceResponse.json();
    const signedPayload = await createSignedWalletPayload({
      challenge: nonceBody.challenge,
      privateKey: walletPrivateKey,
    });
    const otherSignedPayload = await createSignedWalletPayload({
      challenge: nonceBody.challenge,
      privateKey: otherWalletPrivateKey,
    });

    const response = await worker.fetch(
      authJsonRequest('/api/wallet/siwe/verify', 'POST', {
        intent: 'link',
        message: signedPayload.message,
        signature: otherSignedPayload.signature,
      }, headers),
      env,
      execCtx
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error).toContain('signature');
  });

  test('rejects linking a wallet already linked to another user', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const { privateKeyToAccount } = await loadWalletTestModules();
    const account = privateKeyToAccount(walletPrivateKey);
    const user = createWalletUser('wallet-link-conflict');
    const otherUser = createWalletUser('wallet-link-other');
    const env = createAuthTestEnv({
      users: [user, otherUser],
      linkedWallets: [{
        id: 'linked-wallet-conflict',
        user_id: otherUser.id,
        address_normalized: account.address.toLowerCase(),
        address_display: account.address,
        chain_id: 1,
        is_primary: 1,
        linked_at: nowIso(),
        last_login_at: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      }],
    });
    const { execCtx } = createExecutionContext();
    const sessionToken = await seedSession(env, user.id);
    const headers = {
      Origin: 'https://bitbi.ai',
      Cookie: `bitbi_session=${sessionToken}`,
      'CF-Connecting-IP': '203.0.113.56',
    };

    const nonceResponse = await worker.fetch(authJsonRequest('/api/wallet/siwe/nonce', 'POST', { intent: 'link' }, headers), env, execCtx);
    const nonceBody = await nonceResponse.json();
    const signedPayload = await createSignedWalletPayload({
      challenge: nonceBody.challenge,
      privateKey: walletPrivateKey,
    });

    const response = await worker.fetch(
      authJsonRequest('/api/wallet/siwe/verify', 'POST', {
        intent: 'link',
        message: signedPayload.message,
        signature: signedPayload.signature,
      }, headers),
      env,
      execCtx
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('cannot be linked');
  });

  test('unlinks the current wallet', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const { privateKeyToAccount } = await loadWalletTestModules();
    const account = privateKeyToAccount(walletPrivateKey);
    const user = createWalletUser('wallet-unlink-user');
    const env = createAuthTestEnv({
      users: [user],
      linkedWallets: [{
        id: 'linked-wallet-unlink',
        user_id: user.id,
        address_normalized: account.address.toLowerCase(),
        address_display: account.address,
        chain_id: 1,
        is_primary: 1,
        linked_at: nowIso(),
        last_login_at: nowIso(),
        created_at: nowIso(),
        updated_at: nowIso(),
      }],
    });
    const { execCtx, flush } = createExecutionContext();
    const sessionToken = await seedSession(env, user.id);

    const response = await worker.fetch(
      authJsonRequest('/api/wallet/unlink', 'POST', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${sessionToken}`,
        'CF-Connecting-IP': '203.0.113.57',
      }),
      env,
      execCtx
    );
    await flush();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.linked_wallet).toBe(null);
    expect(env.DB.state.linkedWallets).toHaveLength(0);
    expect(env.DB.state.userActivityLog.some((row) => row.action === 'wallet_unlink')).toBe(true);
  });
});

test.describe('Worker routes', () => {
  test('auth email validation uses bounded string checks', async () => {
    const { isValidEmail } = await loadRequestModule();

    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(42)).toBe(false);
    expect(isValidEmail('   ')).toBe(false);
    expect(isValidEmail(`${'a'.repeat(243)}@example.com`)).toBe(false);
    expect(isValidEmail('user name@example.com')).toBe(false);
    expect(isValidEmail('user@@example.com')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
    expect(isValidEmail('user@example')).toBe(false);
    expect(isValidEmail('user@.example.com')).toBe(false);
    expect(isValidEmail('user@example.com.')).toBe(false);
    expect(isValidEmail('user@example..com')).toBe(false);
    expect(isValidEmail(' user@example.com ')).toBe(true);
    expect(isValidEmail('user@example.com')).toBe(true);
  });

  test('profile update normalizes plain-text fields and keeps URL validation separate', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'profile-user',
          email: 'profile@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
    });

    const token = await seedSession(env, 'profile-user');
    const exec = createExecutionContext();
    const res = await authWorker.fetch(
      authJsonRequest('/api/profile', 'PATCH', {
        display_name: '  <b>Alice</b>  ',
        bio: 'Hello <i>world</i>\r\n\u0007',
        website: ' https://example.com ',
        youtube_url: ' https://youtube.com/@alice ',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      exec.execCtx
    );
    await exec.flush();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      profile: {
        display_name: 'bAlice/b',
        bio: 'Hello iworld/i',
        website: 'https://example.com',
        youtube_url: 'https://youtube.com/@alice',
      },
    });
    expect(env.DB.state.profiles).toContainEqual(expect.objectContaining({
      user_id: 'profile-user',
      display_name: 'bAlice/b',
      bio: 'Hello iworld/i',
      website: 'https://example.com',
      youtube_url: 'https://youtube.com/@alice',
    }));
  });

  test('profile update rejects non-https URL schemes instead of trying to sanitize them', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'profile-user-invalid-url',
          email: 'profile2@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
    });

    const token = await seedSession(env, 'profile-user-invalid-url');
    const res = await authWorker.fetch(
      authJsonRequest('/api/profile', 'PATCH', {
        website: 'data:text/html,hello',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'website must be a valid https:// URL.',
    });
    expect(env.DB.state.profiles).toHaveLength(0);
  });

  test.describe('avatar routes', () => {
    test('POST /api/profile/avatar still accepts multipart uploads from device', async () => {
      const authWorker = await loadWorker('workers/auth/src/index.js');
      const foreignThumbBytes = Buffer.from([9, 9, 9]);
      const env = createAuthTestEnv({
        users: [
          {
            id: 'avatar-upload-user',
            email: 'avatar-upload@example.com',
            password_hash: 'unused',
            created_at: nowIso(),
            status: 'active',
            role: 'user',
            email_verified_at: nowIso(),
            verification_method: 'email_verified',
          },
        ],
      });

      const token = await seedSession(env, 'avatar-upload-user');
      const formData = new FormData();
      formData.append(
        'avatar',
        new Blob([ONE_PIXEL_PNG_BYTES], { type: 'image/png' }),
        'avatar.png'
      );

      const exec = createExecutionContext();
      const res = await authWorker.fetch(
        new Request('https://bitbi.ai/api/profile/avatar', {
          method: 'POST',
          headers: {
            Origin: 'https://bitbi.ai',
            Cookie: `bitbi_session=${token}`,
            'CF-Connecting-IP': '203.0.113.41',
          },
          body: formData,
        }),
        env,
        exec.execCtx
      );
      await exec.flush();

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        ok: true,
        message: 'Avatar uploaded.',
      });

      const stored = env.PRIVATE_MEDIA.objects.get('avatars/avatar-upload-user');
      expect(stored).toBeTruthy();
      expect(stored.httpMetadata).toMatchObject({ contentType: 'image/png' });
      expect(Buffer.from(stored.body)).toEqual(ONE_PIXEL_PNG_BYTES);
      expect(env.DB.state.profiles.find((row) => row.user_id === 'avatar-upload-user')?.has_avatar).toBe(1);
    });

    test('saved asset avatar assignment copies the owned thumb instead of the original image', async () => {
      const authWorker = await loadWorker('workers/auth/src/index.js');
      const thumbBytes = Buffer.from([7, 8, 9, 10]);
      const originalBytes = Buffer.from([1, 2, 3, 4]);
      const originalKey = 'users/avatar-thumb-user/originals/ab11cd22.png';
      const thumbKey = 'users/avatar-thumb-user/derivatives/ab11cd22/v1/thumb.webp';
      const env = createAuthTestEnv({
        users: [
          {
            id: 'avatar-thumb-user',
            email: 'avatar-thumb@example.com',
            password_hash: 'unused',
            created_at: nowIso(),
            status: 'active',
            role: 'user',
            email_verified_at: nowIso(),
            verification_method: 'email_verified',
          },
        ],
        aiImages: [
          {
            id: 'ab11cd22',
            user_id: 'avatar-thumb-user',
            folder_id: null,
            r2_key: originalKey,
            thumb_key: thumbKey,
            thumb_mime_type: 'image/webp',
            derivatives_status: 'ready',
            prompt: 'portrait',
            model: '@cf/test-model',
            steps: 4,
            seed: null,
            created_at: nowIso(),
          },
        ],
        userImages: {
          [originalKey]: {
            body: originalBytes.buffer.slice(
              originalBytes.byteOffset,
              originalBytes.byteOffset + originalBytes.byteLength
            ),
            httpMetadata: { contentType: 'image/png' },
          },
          [thumbKey]: {
            body: thumbBytes.buffer.slice(
              thumbBytes.byteOffset,
              thumbBytes.byteOffset + thumbBytes.byteLength
            ),
            httpMetadata: { contentType: 'image/webp' },
          },
        },
      });

      const token = await seedSession(env, 'avatar-thumb-user');
      const exec = createExecutionContext();
      const res = await authWorker.fetch(
        authJsonRequest('/api/profile/avatar', 'POST', {
          source_image_id: 'ab11cd22',
        }, {
          Origin: 'https://bitbi.ai',
          Cookie: `bitbi_session=${token}`,
          'CF-Connecting-IP': '203.0.113.42',
        }),
        env,
        exec.execCtx
      );
      await exec.flush();

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        ok: true,
        message: 'Avatar updated.',
        source: 'saved_assets',
      });

      const stored = env.PRIVATE_MEDIA.objects.get('avatars/avatar-thumb-user');
      expect(stored).toBeTruthy();
      expect(stored.httpMetadata).toMatchObject({ contentType: 'image/webp' });
      expect(Buffer.from(stored.body)).toEqual(thumbBytes);
      expect(Buffer.from(stored.body)).not.toEqual(originalBytes);
      expect(env.DB.state.profiles.find((row) => row.user_id === 'avatar-thumb-user')?.has_avatar).toBe(1);
    });

    test('saved asset avatar assignment generates the thumb first when it is missing', async () => {
      const authWorker = await loadWorker('workers/auth/src/index.js');
      const originalKey = 'users/avatar-derivative-user/originals/deadbeef.png';
      const env = createAuthTestEnv({
        users: [
          {
            id: 'avatar-derivative-user',
            email: 'avatar-derivative@example.com',
            password_hash: 'unused',
            created_at: nowIso(),
            status: 'active',
            role: 'user',
            email_verified_at: nowIso(),
            verification_method: 'email_verified',
          },
        ],
        aiImages: [
          {
            id: 'deadbeef',
            user_id: 'avatar-derivative-user',
            folder_id: null,
            r2_key: originalKey,
            thumb_key: null,
            medium_key: null,
            derivatives_status: 'pending',
            prompt: 'portrait',
            model: '@cf/test-model',
            steps: 4,
            seed: null,
            created_at: nowIso(),
          },
        ],
        userImages: {
          [originalKey]: {
            body: ONE_PIXEL_PNG_BYTES.buffer.slice(
              ONE_PIXEL_PNG_BYTES.byteOffset,
              ONE_PIXEL_PNG_BYTES.byteOffset + ONE_PIXEL_PNG_BYTES.byteLength
            ),
            httpMetadata: { contentType: 'image/png' },
          },
        },
      });

      const token = await seedSession(env, 'avatar-derivative-user');
      const exec = createExecutionContext();
      const res = await authWorker.fetch(
        authJsonRequest('/api/profile/avatar', 'POST', {
          source_image_id: 'deadbeef',
        }, {
          Origin: 'https://bitbi.ai',
          Cookie: `bitbi_session=${token}`,
          'CF-Connecting-IP': '203.0.113.43',
        }),
        env,
        exec.execCtx
      );
      await exec.flush();

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        ok: true,
        message: 'Avatar updated.',
      });

      const imageRow = env.DB.state.aiImages.find((row) => row.id === 'deadbeef');
      expect(imageRow?.thumb_key).toBeTruthy();
      expect(imageRow?.derivatives_status).toBe('ready');
      expect(env.IMAGES.transformCalls.length).toBeGreaterThan(0);

      const generatedThumb = env.USER_IMAGES.objects.get(imageRow.thumb_key);
      const stored = env.PRIVATE_MEDIA.objects.get('avatars/avatar-derivative-user');
      expect(generatedThumb).toBeTruthy();
      expect(stored).toBeTruthy();
      expect(Buffer.from(stored.body)).toEqual(Buffer.from(generatedThumb.body));
      expect(stored.httpMetadata).toMatchObject({
        contentType: generatedThumb.httpMetadata.contentType,
      });
      expect(env.DB.state.profiles.find((row) => row.user_id === 'avatar-derivative-user')?.has_avatar).toBe(1);
    });

    test('saved asset avatar assignment never falls back to the original image when no thumb can be produced', async () => {
      const authWorker = await loadWorker('workers/auth/src/index.js');
      const env = createAuthTestEnv({
        users: [
          {
            id: 'avatar-no-thumb-user',
            email: 'avatar-no-thumb@example.com',
            password_hash: 'unused',
            created_at: nowIso(),
            status: 'active',
            role: 'user',
            email_verified_at: nowIso(),
            verification_method: 'email_verified',
          },
        ],
        aiImages: [
          {
            id: 'facefeed',
            user_id: 'avatar-no-thumb-user',
            folder_id: null,
            r2_key: 'users/avatar-no-thumb-user/originals/facefeed.png',
            thumb_key: null,
            medium_key: null,
            derivatives_status: 'pending',
            prompt: 'portrait',
            model: '@cf/test-model',
            steps: 4,
            seed: null,
            created_at: nowIso(),
          },
        ],
      });

      const token = await seedSession(env, 'avatar-no-thumb-user');
      const exec = createExecutionContext();
      const res = await authWorker.fetch(
        authJsonRequest('/api/profile/avatar', 'POST', {
          source_image_id: 'facefeed',
        }, {
          Origin: 'https://bitbi.ai',
          Cookie: `bitbi_session=${token}`,
          'CF-Connecting-IP': '203.0.113.44',
        }),
        env,
        exec.execCtx
      );
      await exec.flush();

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        ok: false,
        code: 'avatar_thumb_unavailable',
      });
      expect(env.PRIVATE_MEDIA.objects.has('avatars/avatar-no-thumb-user')).toBe(false);
      expect(env.DB.state.profiles.find((row) => row.user_id === 'avatar-no-thumb-user')).toBeUndefined();
    });

    test('saved asset avatar assignment does not reattempt derivative generation during cooldown after a failed attempt', async () => {
      const authWorker = await loadWorker('workers/auth/src/index.js');
      const env = createAuthTestEnv({
        users: [
          {
            id: 'avatar-cooldown-user',
            email: 'avatar-cooldown@example.com',
            password_hash: 'unused',
            created_at: nowIso(),
            status: 'active',
            role: 'user',
            email_verified_at: nowIso(),
            verification_method: 'email_verified',
          },
        ],
        aiImages: [
          {
            id: 'c001face',
            user_id: 'avatar-cooldown-user',
            folder_id: null,
            r2_key: 'users/avatar-cooldown-user/originals/c001face.png',
            thumb_key: null,
            medium_key: null,
            derivatives_status: 'failed',
            derivatives_attempted_at: nowIso(),
            prompt: 'portrait',
            model: '@cf/test-model',
            steps: 4,
            seed: null,
            created_at: nowIso(),
          },
        ],
      });

      const token = await seedSession(env, 'avatar-cooldown-user');
      const exec = createExecutionContext();
      const res = await authWorker.fetch(
        authJsonRequest('/api/profile/avatar', 'POST', {
          source_image_id: 'c001face',
        }, {
          Origin: 'https://bitbi.ai',
          Cookie: `bitbi_session=${token}`,
          'CF-Connecting-IP': '203.0.113.45',
        }),
        env,
        exec.execCtx
      );
      await exec.flush();

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        ok: false,
        code: 'avatar_thumb_unavailable',
      });
      expect(env.IMAGES.infoCalls).toHaveLength(0);
      expect(env.IMAGES.transformCalls).toHaveLength(0);
      expect(env.PRIVATE_MEDIA.objects.has('avatars/avatar-cooldown-user')).toBe(false);
    });

    test('saved asset avatar assignment enforces image ownership', async () => {
      const authWorker = await loadWorker('workers/auth/src/index.js');
      const foreignThumbBytes = Buffer.from([9, 9, 9]);
      const env = createAuthTestEnv({
        users: [
          {
            id: 'avatar-owner-user',
            email: 'avatar-owner@example.com',
            password_hash: 'unused',
            created_at: nowIso(),
            status: 'active',
            role: 'user',
            email_verified_at: nowIso(),
            verification_method: 'email_verified',
          },
          {
            id: 'avatar-other-user',
            email: 'avatar-other@example.com',
            password_hash: 'unused',
            created_at: nowIso(),
            status: 'active',
            role: 'user',
            email_verified_at: nowIso(),
            verification_method: 'email_verified',
          },
        ],
        aiImages: [
          {
            id: 'c0ffee42',
            user_id: 'avatar-other-user',
            folder_id: null,
            r2_key: 'users/avatar-other-user/originals/c0ffee42.png',
            thumb_key: 'users/avatar-other-user/derivatives/c0ffee42/v1/thumb.webp',
            thumb_mime_type: 'image/webp',
            derivatives_status: 'ready',
            prompt: 'portrait',
            model: '@cf/test-model',
            steps: 4,
            seed: null,
            created_at: nowIso(),
          },
        ],
        userImages: {
          'users/avatar-other-user/derivatives/c0ffee42/v1/thumb.webp': {
            body: foreignThumbBytes.buffer.slice(
              foreignThumbBytes.byteOffset,
              foreignThumbBytes.byteOffset + foreignThumbBytes.byteLength
            ),
            httpMetadata: { contentType: 'image/webp' },
          },
        },
      });

      const token = await seedSession(env, 'avatar-owner-user');
      const exec = createExecutionContext();
      const res = await authWorker.fetch(
        authJsonRequest('/api/profile/avatar', 'POST', {
          source_image_id: 'c0ffee42',
        }, {
          Origin: 'https://bitbi.ai',
          Cookie: `bitbi_session=${token}`,
          'CF-Connecting-IP': '203.0.113.45',
        }),
        env,
        exec.execCtx
      );
      await exec.flush();

      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toMatchObject({
        ok: false,
        error: 'Saved image not found.',
      });
      expect(env.PRIVATE_MEDIA.objects.has('avatars/avatar-owner-user')).toBe(false);
      expect(env.DB.state.profiles.find((row) => row.user_id === 'avatar-owner-user')).toBeUndefined();
    });

    test('DELETE /api/profile/avatar clears the cached avatar profile state', async () => {
      const authWorker = await loadWorker('workers/auth/src/index.js');
      const env = createAuthTestEnv({
        users: [createContractUser({ id: 'avatar-delete-user', role: 'user' })],
        profiles: [
          {
            user_id: 'avatar-delete-user',
            display_name: 'Avatar Delete',
            bio: '',
            website: '',
            youtube_url: '',
            has_avatar: 1,
            created_at: nowIso(),
            updated_at: nowIso(),
          },
        ],
        privateMedia: {
          'avatars/avatar-delete-user': {
            body: ONE_PIXEL_PNG_BYTES.buffer.slice(
              ONE_PIXEL_PNG_BYTES.byteOffset,
              ONE_PIXEL_PNG_BYTES.byteOffset + ONE_PIXEL_PNG_BYTES.byteLength
            ),
            httpMetadata: { contentType: 'image/png' },
          },
        },
      });

      const token = await seedSession(env, 'avatar-delete-user');
      const exec = createExecutionContext();
      const res = await authWorker.fetch(
        authJsonRequest('/api/profile/avatar', 'DELETE', undefined, {
          Origin: 'https://bitbi.ai',
          Cookie: `bitbi_session=${token}`,
        }),
        env,
        exec.execCtx
      );
      await exec.flush();

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        ok: true,
        message: 'Avatar removed.',
      });
      expect(env.PRIVATE_MEDIA.objects.has('avatars/avatar-delete-user')).toBe(false);
      expect(env.DB.state.profiles.find((row) => row.user_id === 'avatar-delete-user')?.has_avatar).toBe(0);
    });
  });

  test.describe('Admin AI contract routes', () => {
    test('GET /api/admin/ai/models returns the catalog shape used by the UI', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/models', 'GET', undefined, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        ok: true,
        task: 'models',
        models: {
          text: expect.any(Array),
          image: expect.any(Array),
          embeddings: expect.any(Array),
          music: expect.any(Array),
        },
        presets: expect.any(Array),
      });
      expect(body.models.text[0]).toEqual(expect.objectContaining({
        id: expect.any(String),
        task: 'text',
        label: expect.any(String),
        vendor: expect.any(String),
      }));
      expect(body.models.text.map((model) => model.id)).toEqual(expect.arrayContaining([
        '@cf/google/gemma-4-26b-a4b-it',
      ]));
      expect(body.models.image.map((model) => model.id)).toEqual(expect.arrayContaining([
        '@cf/black-forest-labs/flux-1-schnell',
        '@cf/black-forest-labs/flux-2-klein-9b',
        '@cf/black-forest-labs/flux-2-dev',
      ]));
      expect(body.models.music.map((model) => model.id)).toEqual(expect.arrayContaining([
        'minimax/music-2.6',
      ]));
      expect(body.presets[0]).toEqual(expect.objectContaining({
        name: expect.any(String),
        task: expect.any(String),
        model: expect.any(String),
      }));
    });

    test('POST /api/admin/ai/test-text returns the text response contract used by the UI', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-text', 'POST', {
          preset: 'balanced',
          prompt: 'Summarize the AI lab.',
          system: 'You are concise.',
          maxTokens: 280,
          temperature: 0.7,
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(expect.objectContaining({
        ok: true,
        task: 'text',
        model: expect.objectContaining({
          id: expect.any(String),
          task: 'text',
          label: expect.any(String),
          vendor: expect.any(String),
        }),
        result: expect.objectContaining({
          text: expect.any(String),
          usage: expect.any(Object),
          maxTokens: 280,
          temperature: 0.7,
        }),
        elapsedMs: expect.any(Number),
      }));
    });

    test('POST /api/admin/ai/test-image returns the image response contract used by the UI', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-image', 'POST', {
          preset: 'image_fast',
          prompt: 'A cinematic skyline.',
          width: 1024,
          height: 1024,
          steps: 4,
          seed: 12345,
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(expect.objectContaining({
        ok: true,
        task: 'image',
        model: expect.objectContaining({
          id: expect.any(String),
          task: 'image',
          label: expect.any(String),
          vendor: expect.any(String),
        }),
        result: expect.objectContaining({
          imageBase64: expect.any(String),
          mimeType: expect.any(String),
          steps: 4,
          seed: 12345,
          promptMode: 'standard',
          referenceImageCount: 0,
        }),
        elapsedMs: expect.any(Number),
      }));
      expect(body.result).toHaveProperty('requestedSize');
      expect(body.result).toHaveProperty('appliedSize');
    });

    test('POST /api/admin/ai/test-image allows FLUX.2 Klein 9B and uses the multipart AI path', async () => {
      let capturedModelId = null;
      let capturedPayload = null;
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness({
        aiRun: async (modelId, payload) => {
          capturedModelId = modelId;
          capturedPayload = payload;
          return { image: ONE_PIXEL_PNG_DATA_URI };
        },
      });

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-image', 'POST', {
          preset: 'image_fast',
          model: '@cf/black-forest-labs/flux-2-klein-9b',
          prompt: 'Admin Klein image experiment.',
          width: 1024,
          height: 1024,
          steps: 6,
          seed: 12345,
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(expect.objectContaining({
        ok: true,
        task: 'image',
        preset: 'image_fast',
        model: expect.objectContaining({
          id: '@cf/black-forest-labs/flux-2-klein-9b',
          task: 'image',
          label: 'FLUX.2 Klein 9B',
        }),
        result: expect.objectContaining({
          imageBase64: expect.any(String),
          steps: null,
          seed: null,
          requestedSize: { width: 1024, height: 1024 },
          appliedSize: { width: 1024, height: 1024 },
        }),
      }));
      expect(capturedModelId).toBe('@cf/black-forest-labs/flux-2-klein-9b');
      expect(capturedPayload).toEqual(expect.objectContaining({
        multipart: expect.objectContaining({
          contentType: expect.stringContaining('multipart/form-data'),
          body: expect.anything(),
        }),
      }));
      const entries = await readMultipartEntries(capturedPayload.multipart);
      expect(entries.map(([key]) => key)).toEqual(['prompt', 'width', 'height']);
      const fields = Object.fromEntries(
        entries.filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, String(value)])
      );
      expect(fields).toEqual({
        prompt: 'Admin Klein image experiment.',
        width: '1024',
        height: '1024',
      });
    });

    test('POST /api/admin/ai/test-image allows FLUX.2 Dev and uses the multipart AI path', async () => {
      let capturedModelId = null;
      let capturedPayload = null;
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness({
        aiRun: async (modelId, payload) => {
          capturedModelId = modelId;
          capturedPayload = payload;
          return { image: ONE_PIXEL_PNG_DATA_URI };
        },
      });

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-image', 'POST', {
          preset: 'image_fast',
          model: '@cf/black-forest-labs/flux-2-dev',
          prompt: 'Admin Dev image experiment.',
          width: 768,
          height: 768,
          steps: 20,
          seed: 9876,
          guidance: 7.5,
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(expect.objectContaining({
        ok: true,
        task: 'image',
        preset: 'image_fast',
        model: expect.objectContaining({
          id: '@cf/black-forest-labs/flux-2-dev',
          task: 'image',
          label: 'FLUX.2 Dev',
        }),
        result: expect.objectContaining({
          imageBase64: expect.any(String),
          steps: 20,
          seed: 9876,
          guidance: 7.5,
          promptMode: 'standard',
          requestedSize: { width: 768, height: 768 },
          appliedSize: { width: 768, height: 768 },
          referenceImageCount: 0,
        }),
      }));
      expect(capturedModelId).toBe('@cf/black-forest-labs/flux-2-dev');
      expect(capturedPayload).toEqual(expect.objectContaining({
        multipart: expect.objectContaining({
          contentType: expect.stringContaining('multipart/form-data'),
          body: expect.anything(),
        }),
      }));
      const entries = await readMultipartEntries(capturedPayload.multipart);
      expect(entries.map(([key]) => key)).toEqual(['prompt', 'width', 'height', 'steps', 'seed', 'guidance']);
      const fields = Object.fromEntries(
        entries.filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, String(value)])
      );
      expect(fields).toEqual({
        prompt: 'Admin Dev image experiment.',
        width: '768',
        height: '768',
        steps: '20',
        seed: '9876',
        guidance: '7.5',
      });
    });

    test('POST /api/admin/ai/test-image accepts structuredPrompt for FLUX.2 Dev', async () => {
      let capturedPayload = null;
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness({
        aiRun: async (_modelId, payload) => {
          capturedPayload = payload;
          return { image: ONE_PIXEL_PNG_DATA_URI };
        },
      });

      const structuredPrompt = JSON.stringify({ subject: 'cat', style: 'oil painting' });
      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-image', 'POST', {
          model: '@cf/black-forest-labs/flux-2-dev',
          prompt: 'fallback prompt',
          structuredPrompt,
          width: 1024,
          height: 1024,
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.promptMode).toBe('structured');
      const fields = await readMultipartFields(capturedPayload.multipart);
      expect(fields.prompt).toBe(structuredPrompt);
    });

    test('POST /api/admin/ai/test-image rejects invalid structuredPrompt JSON', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-image', 'POST', {
          model: '@cf/black-forest-labs/flux-2-dev',
          prompt: 'test',
          structuredPrompt: 'not valid json {{{',
          width: 1024,
          height: 1024,
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.code).toBe('validation_error');
      expect(body.error).toContain('invalid JSON');
    });

    test('POST /api/admin/ai/test-image rejects referenceImages exceeding max count', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();
      const fakeRef = 'data:image/png;base64,iVBOR';

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-image', 'POST', {
          model: '@cf/black-forest-labs/flux-2-dev',
          prompt: 'test',
          width: 1024,
          height: 1024,
          referenceImages: [fakeRef, fakeRef, fakeRef, fakeRef, fakeRef],
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.code).toBe('validation_error');
      expect(body.error).toContain('at most 4');
    });

    test('POST /api/admin/ai/test-image accepts FLUX.2 Dev reference images smaller than 512x512', async () => {
      let capturedPayload = null;
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness({
        imagesBinding: {
          originalInfo: { width: 511, height: 511, format: 'image/png' },
        },
        aiRun: async (_modelId, payload) => {
          capturedPayload = payload;
          return { image: ONE_PIXEL_PNG_DATA_URI };
        },
      });
      const validRef = 'data:image/png;base64,AAAA';

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-image', 'POST', {
          model: '@cf/black-forest-labs/flux-2-dev',
          prompt: 'test',
          width: 1024,
          height: 1024,
          referenceImages: [validRef, validRef],
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.result.referenceImageCount).toBe(2);
      expect(env.IMAGES.infoCalls).toHaveLength(2);
      expect(env.IMAGES.infoCalls[0]).toEqual(expect.objectContaining({
        width: 511,
        height: 511,
      }));
      expect(env.IMAGES.infoCalls[1]).toEqual(expect.objectContaining({
        width: 511,
        height: 511,
      }));
      expect(capturedPayload).toEqual(expect.objectContaining({
        multipart: expect.objectContaining({
          contentType: expect.stringContaining('multipart/form-data'),
          body: expect.anything(),
        }),
      }));
      const entries = await readMultipartEntries(capturedPayload.multipart);
      const fieldNames = entries.map(([key]) => key);
      expect(fieldNames).toEqual(['prompt', 'width', 'height', 'input_image_0', 'input_image_1']);
      expect(fieldNames).not.toContain('image');
      const imageEntries = entries.filter(([key]) => key.startsWith('input_image_'));
      expect(imageEntries).toHaveLength(2);
    });

    test('POST /api/admin/ai/test-image rejects FLUX.2 Dev reference images at 512x512', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness({
        imagesBinding: {
          originalInfo: { width: 512, height: 512, format: 'image/png' },
        },
      });
      const invalidRef = 'data:image/png;base64,AAAA';

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-image', 'POST', {
          model: '@cf/black-forest-labs/flux-2-dev',
          prompt: 'test',
          width: 1024,
          height: 1024,
          referenceImages: [invalidRef],
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.code).toBe('validation_error');
      expect(body.error).toContain('smaller than 512x512');
      expect(body.error).toContain('Received 512x512');
      expect(env.IMAGES.infoCalls).toHaveLength(1);
    });

    test('POST /api/admin/ai/test-image validates guidance range', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-image', 'POST', {
          model: '@cf/black-forest-labs/flux-2-dev',
          prompt: 'test',
          width: 1024,
          height: 1024,
          guidance: 999,
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.code).toBe('validation_error');
      expect(body.error).toContain('guidance');
    });

    test('POST /api/admin/ai/test-image accepts steps up to 50 for FLUX.2 Dev', async () => {
      let capturedPayload = null;
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness({
        aiRun: async (_modelId, payload) => {
          capturedPayload = payload;
          return { image: ONE_PIXEL_PNG_DATA_URI };
        },
      });

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-image', 'POST', {
          model: '@cf/black-forest-labs/flux-2-dev',
          prompt: 'High step test.',
          width: 1024,
          height: 1024,
          steps: 50,
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.steps).toBe(50);
      const fields = await readMultipartFields(capturedPayload.multipart);
      expect(fields.steps).toBe('50');
    });

    test('POST /api/admin/ai/test-image model catalog exposes capabilities for image models', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        new Request('https://bitbi.ai/api/admin/ai/models', {
          method: 'GET',
          headers: authHeaders,
        }),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      const imageModels = body.models?.image || [];
      const devModel = imageModels.find((m) => m.id === '@cf/black-forest-labs/flux-2-dev');
      expect(devModel).toBeDefined();
      expect(devModel.capabilities).toEqual(expect.objectContaining({
        supportsGuidance: true,
        supportsStructuredPrompt: true,
        supportsReferenceImages: true,
        maxReferenceImages: 4,
        supportsSteps: true,
        supportsSeed: true,
      }));

      const schnellModel = imageModels.find((m) => m.id === '@cf/black-forest-labs/flux-1-schnell');
      expect(schnellModel).toBeDefined();
      expect(schnellModel.capabilities).toEqual(expect.objectContaining({
        supportsGuidance: false,
        supportsStructuredPrompt: false,
        supportsReferenceImages: false,
        maxReferenceImages: 0,
      }));
    });

    test('POST /api/admin/ai/test-embeddings returns the embeddings response contract used by the UI', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-embeddings', 'POST', {
          preset: 'embedding_default',
          input: ['first snippet', 'second snippet'],
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(expect.objectContaining({
        ok: true,
        task: 'embeddings',
        model: expect.objectContaining({
          id: expect.any(String),
          task: 'embeddings',
          label: expect.any(String),
          vendor: expect.any(String),
        }),
        result: expect.objectContaining({
          vectors: expect.any(Array),
          dimensions: expect.any(Number),
          count: 2,
          shape: expect.any(Array),
        }),
        elapsedMs: expect.any(Number),
      }));
      expect(body.result.vectors[0]).toEqual(expect.any(Array));
    });

    test('POST /api/admin/ai/test-music returns the music response contract used by the UI', async () => {
      let capturedModelId = null;
      let capturedPayload = null;
      let capturedOptions = null;
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness({
        aiRun: async (modelId, payload, options) => {
          capturedModelId = modelId;
          capturedPayload = payload;
          capturedOptions = options;
          return {
            data: {
              audio: '494433040000000000',
              status: 2,
            },
            trace_id: 'music-contract-trace',
            extra_info: {
              music_duration: 25364,
              music_sample_rate: 44100,
              music_channel: 2,
              bitrate: 256000,
              music_size: 813651,
            },
            analysis_info: {
              lyrics: '[Verse]\nHold the skyline in tune',
            },
          };
        },
      });

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-music', 'POST', {
          prompt: 'Dark synthwave pulse with cinematic tension.',
          mode: 'vocals',
          lyricsMode: 'custom',
          lyrics: '[Verse]\nHold the skyline in tune',
          bpm: 118,
          key: 'A Minor',
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(expect.objectContaining({
        ok: true,
        task: 'music',
        model: expect.objectContaining({
          id: 'minimax/music-2.6',
          task: 'music',
          label: 'Music 2.6',
          vendor: 'MiniMax',
        }),
        preset: 'music_studio',
        traceId: 'music-contract-trace',
        result: expect.objectContaining({
          mode: 'vocals',
          lyricsMode: 'custom',
          bpm: 118,
          key: 'A Minor',
          mimeType: 'audio/mpeg',
          audioBase64: expect.any(String),
          providerStatus: 2,
          durationMs: 25364,
          sampleRate: 44100,
          channels: 2,
          bitrate: 256000,
          sizeBytes: 813651,
          lyricsPreview: '[Verse]\nHold the skyline in tune',
        }),
        elapsedMs: expect.any(Number),
      }));
      expect(capturedModelId).toBe('minimax/music-2.6');
      expect(capturedPayload).toEqual(expect.objectContaining({
        lyrics: '[Verse]\nHold the skyline in tune',
        lyrics_optimizer: false,
        is_instrumental: false,
        sample_rate: 44100,
        bitrate: 256000,
        format: 'mp3',
      }));
      expect(capturedPayload.stream).toBeUndefined();
      expect(capturedPayload.output_format).toBeUndefined();
      expect(capturedPayload.audio_setting).toBeUndefined();
      expect(capturedPayload.prompt).toContain('Dark synthwave pulse with cinematic tension.');
      expect(capturedPayload.prompt).toContain('Tempo target: 118 BPM.');
      expect(capturedPayload.prompt).toContain('Preferred key center: A Minor.');
      expect(capturedPayload.prompt).toContain('Lead vocals should remain present.');
      expect(capturedOptions).toEqual({ gateway: { id: 'default' } });
    });

    test('POST /api/admin/ai/test-music passes AI Gateway options for the proxied minimax model', async () => {
      let capturedOptions = null;
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness({
        aiRun: async (_modelId, _payload, options) => {
          capturedOptions = options;
          return {
            data: {
              audio: '494433040000000000',
              status: 2,
            },
            trace_id: 'gateway-test-trace',
          };
        },
      });

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-music', 'POST', {
          prompt: 'Gateway routing test.',
          mode: 'instrumental',
          lyricsMode: 'auto',
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      expect(capturedOptions).toEqual({ gateway: { id: 'default' } });
    });

    test('POST /api/admin/ai/test-music forwards only supported provider fields for instrumental auto mode', async () => {
      let capturedPayload = null;
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness({
        aiRun: async (_modelId, payload) => {
          capturedPayload = payload;
          return {
            data: {
              audio: 'https://example.com/generated-track.mp3',
              status: 2,
            },
            trace_id: 'music-url-trace',
          };
        },
      });

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-music', 'POST', {
          prompt: 'Cinematic ambient score with wide synth pads.',
          mode: 'instrumental',
          lyricsMode: 'auto',
          bpm: 92,
          key: 'E Minor',
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual(expect.objectContaining({
        ok: true,
        result: expect.objectContaining({
          audioUrl: 'https://example.com/generated-track.mp3',
          audioBase64: null,
        }),
      }));
      expect(capturedPayload).toEqual(expect.objectContaining({
        lyrics_optimizer: false,
        is_instrumental: true,
        sample_rate: 44100,
        bitrate: 256000,
        format: 'mp3',
      }));
      expect(capturedPayload.lyrics).toBeUndefined();
      expect(capturedPayload.bpm).toBeUndefined();
      expect(capturedPayload.key).toBeUndefined();
      expect(capturedPayload.stream).toBeUndefined();
      expect(capturedPayload.output_format).toBeUndefined();
      expect(capturedPayload.audio_setting).toBeUndefined();
      expect(capturedPayload.prompt).toContain('Tempo target: 92 BPM.');
      expect(capturedPayload.prompt).toContain('Preferred key center: E Minor.');
      expect(capturedPayload.prompt).toContain('Instrumental only. No vocals.');
    });

    test('POST /api/admin/ai/test-music accepts Cloudflare-style inline base64 audio output', async () => {
      const inlineAudio = 'UklGRiQAAABXQVZFZm10AA==';
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness({
        aiRun: async () => ({
          audio: inlineAudio,
        }),
      });

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-music', 'POST', {
          prompt: 'Warm electronic anthem.',
          mode: 'vocals',
          lyricsMode: 'custom',
          lyrics: '[Verse]\nWe hold the line',
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual(expect.objectContaining({
        ok: true,
        result: expect.objectContaining({
          audioBase64: inlineAudio,
          audioUrl: null,
          lyricsPreview: '[Verse]\nWe hold the line',
        }),
      }));
    });

    test('POST /api/admin/ai/test-music maps provider-declared failures to the upstream error contract', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness({
        aiRun: async () => ({
          trace_id: 'music-provider-error-trace',
          base_resp: {
            status_code: 40013,
            status_msg: 'lyrics_optimizer is invalid in this position',
          },
        }),
      });

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-music', 'POST', {
          prompt: 'Minimal house groove.',
          mode: 'vocals',
          lyricsMode: 'auto',
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(502);
      expect(res.headers.get('x-bitbi-correlation-id')).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
      await expect(res.json()).resolves.toEqual(expect.objectContaining({
        ok: false,
        code: 'upstream_error',
        error: 'Music generation failed',
      }));
    });

    test('POST /api/admin/ai/test-music validates vocal custom mode lyrics', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-music', 'POST', {
          prompt: 'Need a lyrical song.',
          mode: 'vocals',
          lyricsMode: 'custom',
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual(expect.objectContaining({
        ok: false,
        code: 'validation_error',
        error: expect.stringContaining('lyrics are required'),
      }));
    });

    test('POST /api/admin/ai/compare returns the compare response contract used by the UI', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/compare', 'POST', {
          models: [
            '@cf/meta/llama-3.1-8b-instruct-fast',
            '@cf/openai/gpt-oss-20b',
          ],
          prompt: 'Compare these models.',
          system: 'You are concise.',
          maxTokens: 250,
          temperature: 0.7,
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(expect.objectContaining({
        ok: true,
        task: 'compare',
        models: expect.any(Array),
        result: expect.objectContaining({
          results: expect.any(Array),
          maxTokens: 250,
          temperature: 0.7,
        }),
        elapsedMs: expect.any(Number),
      }));
      expect(body.result.results).toHaveLength(2);
      expect(body.result.results[0]).toEqual(expect.objectContaining({
        ok: expect.any(Boolean),
        model: expect.objectContaining({
          id: expect.any(String),
          task: 'text',
          label: expect.any(String),
          vendor: expect.any(String),
        }),
      }));
    });

    test('GET /api/admin/ai/models rejects unauthenticated requests with the error shape used by the UI', async () => {
      const { authWorker, env } = await createAdminAiContractHarness({ withSession: false });

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/models', 'GET', undefined, {
          Origin: 'https://bitbi.ai',
          'CF-Connecting-IP': '203.0.113.25',
        }),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual(expect.objectContaining({
        ok: false,
        code: 'unauthorized',
        error: expect.any(String),
      }));
    });

    test('GET /api/admin/ai/models rejects non-admin sessions with the same error contract', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness({
        user: createContractUser({ id: 'member-ai-user', role: 'user' }),
      });

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/models', 'GET', undefined, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual(expect.objectContaining({
        ok: false,
        code: 'forbidden',
        error: expect.any(String),
      }));
    });

    test('POST /api/admin/ai/test-text returns the bad_request code for invalid JSON bodies', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        new Request('https://bitbi.ai/api/admin/ai/test-text', {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
          },
          body: '{"prompt":',
        }),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual(expect.objectContaining({
        ok: false,
        code: 'bad_request',
        error: expect.any(String),
      }));
    });

    test('POST /api/admin/ai/test-image returns the validation_error code for bounded payload failures', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-image', 'POST', {
          prompt: 'Broken dimensions.',
          width: 1024,
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual(expect.objectContaining({
        ok: false,
        code: 'validation_error',
        error: expect.any(String),
      }));
    });

    test('POST /api/admin/ai/test-text returns a warning-bearing success shape when the explicit model overrides the preset', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-text', 'POST', {
          preset: 'balanced',
          model: '@cf/meta/llama-3.1-8b-instruct-fast',
          prompt: 'Summarize the AI lab.',
          system: 'You are concise.',
          maxTokens: 280,
          temperature: 0.7,
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(expect.objectContaining({
        ok: true,
        task: 'text',
        warnings: expect.any(Array),
        result: expect.objectContaining({
          text: expect.any(String),
        }),
      }));
      expect(body.warnings[0]).toContain('overrides preset');
    });

    test('POST /api/admin/ai/test-text returns the error shape used by the UI when the model is not allowlisted', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-text', 'POST', {
          model: '@cf/not-allowlisted/model',
          prompt: 'Summarize the AI lab.',
          maxTokens: 280,
          temperature: 0.7,
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual(expect.objectContaining({
        ok: false,
        code: 'model_not_allowed',
        error: expect.stringContaining('not allowlisted'),
      }));
    });

    test('POST /api/admin/ai/test-image sanitizes top-level upstream failures', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness({
        aiRun: async () => {
          throw new Error('sensitive provider detail');
        },
      });

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/test-image', 'POST', {
          model: '@cf/black-forest-labs/flux-1-schnell',
          prompt: 'Trigger an upstream failure.',
          steps: 4,
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(502);
      expect(res.headers.get('x-bitbi-correlation-id')).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
      await expect(res.json()).resolves.toEqual(expect.objectContaining({
        ok: false,
        code: 'upstream_error',
        error: 'Image generation failed',
      }));
    });

    test('POST /api/admin/ai/compare returns the validation error shape used by the UI for duplicate model selections', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/compare', 'POST', {
          models: [
            '@cf/openai/gpt-oss-20b',
            '@cf/openai/gpt-oss-20b',
          ],
          prompt: 'Compare these models.',
          system: 'You are concise.',
          maxTokens: 250,
          temperature: 0.7,
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual(expect.objectContaining({
        ok: false,
        code: 'duplicate_models',
        error: 'models must not contain duplicates.',
      }));
    });

    test('POST /api/admin/ai/compare returns a warning-bearing success shape when one model run fails', async () => {
      const baseAiRun = createAiLabRunStub();
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness({
        aiRun: async (modelId, payload) => {
          if (modelId === '@cf/openai/gpt-oss-20b') {
            throw new Error('Simulated compare failure.');
          }
          return baseAiRun(modelId, payload);
        },
      });

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/compare', 'POST', {
          models: [
            '@cf/meta/llama-3.1-8b-instruct-fast',
            '@cf/openai/gpt-oss-20b',
          ],
          prompt: 'Compare these models.',
          system: 'You are concise.',
          maxTokens: 250,
          temperature: 0.7,
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(expect.objectContaining({
        ok: true,
        task: 'compare',
        code: 'partial_success',
        warnings: expect.any(Array),
        result: expect.objectContaining({
          results: expect.any(Array),
        }),
      }));
      expect(body.warnings[0]).toContain('One or more model runs failed during comparison.');
      expect(body.result.results).toEqual(expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          text: expect.any(String),
        }),
        expect.objectContaining({
          ok: false,
          code: 'upstream_error',
          error: expect.any(String),
        }),
      ]));
    });

    test('POST /api/admin/ai/live-agent returns a streaming response for valid chat messages', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/live-agent', 'POST', {
          messages: [
            { role: 'system', content: 'You are a test assistant.' },
            { role: 'user', content: 'Hello' },
          ],
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      const contentType = res.headers.get('content-type') || '';
      expect(contentType).toContain('text/event-stream');
      const text = await res.text();
      expect(text).toContain('data:');
      expect(text).toContain('[DONE]');
    });

    test('POST /api/admin/ai/live-agent rejects requests without a user message', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/live-agent', 'POST', {
          messages: [
            { role: 'system', content: 'You are a test assistant.' },
          ],
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.code).toBe('validation_error');
      expect(body.error).toContain('user message');
    });

    test('POST /api/admin/ai/live-agent rejects unauthenticated requests', async () => {
      const { authWorker, env } = await createAdminAiContractHarness({ withSession: false });

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/live-agent', 'POST', {
          messages: [
            { role: 'user', content: 'Hello' },
          ],
        }, { Origin: 'https://bitbi.ai' }),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.ok).toBe(false);
    });

    test('POST /api/admin/ai/live-agent rejects empty messages array', async () => {
      const { authWorker, env, authHeaders } = await createAdminAiContractHarness();

      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/live-agent', 'POST', {
          messages: [],
        }, authHeaders),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.code).toBe('validation_error');
    });
  });

  test('auth happy path: login, me, logout', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const { hashPassword } = await loadAuthModules();
    const env = createAuthTestEnv({
      users: [
        {
          id: 'user-auth',
          email: 'member@example.com',
          password_hash: await hashPassword('password123', { PBKDF2_ITERATIONS: '100000' }),
          created_at: '2026-04-01T00:00:00.000Z',
          status: 'active',
          role: 'user',
          email_verified_at: '2026-04-01T00:10:00.000Z',
          verification_method: 'email_verified',
        },
      ],
      profiles: [
        {
          user_id: 'user-auth',
          display_name: 'Member Name',
          bio: '',
          website: '',
          youtube_url: '',
          created_at: '2026-04-01T00:00:00.000Z',
          updated_at: '2026-04-01T00:00:00.000Z',
        },
      ],
      privateMedia: {
        'avatars/user-auth': {
          body: ONE_PIXEL_PNG_BYTES.buffer.slice(
            ONE_PIXEL_PNG_BYTES.byteOffset,
            ONE_PIXEL_PNG_BYTES.byteOffset + ONE_PIXEL_PNG_BYTES.byteLength
          ),
          httpMetadata: { contentType: 'image/png' },
        },
      },
    });

    const loginCtx = createExecutionContext();
    const loginRes = await authWorker.fetch(
      authJsonRequest('/api/login', 'POST', {
        email: 'member@example.com',
        password: 'password123',
      }, { Origin: 'https://bitbi.ai', 'CF-Connecting-IP': '203.0.113.10' }),
      env,
      loginCtx.execCtx
    );
    await loginCtx.flush();

    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    expect(loginBody.ok).toBe(true);
    expect(loginBody.user.email).toBe('member@example.com');
    const setCookie = loginRes.headers.get('Set-Cookie');
    expect(setCookie).toContain('__Host-bitbi_session=');
    expect(setCookie).toContain('Secure');
    expect(env.DB.state.sessions).toHaveLength(1);

    const meRes = await authWorker.fetch(
      authJsonRequest('/api/me', 'GET', undefined, {
        Cookie: parseSessionCookie(setCookie),
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(meRes.status).toBe(200);
    await expect(meRes.json()).resolves.toMatchObject({
      loggedIn: true,
      user: {
        email: 'member@example.com',
        role: 'user',
        display_name: 'Member Name',
        has_avatar: true,
        avatar_url: '/api/profile/avatar',
      },
    });

    const logoutCtx = createExecutionContext();
    const logoutRes = await authWorker.fetch(
      authJsonRequest('/api/logout', 'POST', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: parseSessionCookie(setCookie),
        'CF-Connecting-IP': '203.0.113.10',
      }),
      env,
      logoutCtx.execCtx
    );
    await logoutCtx.flush();

    expect(logoutRes.status).toBe(200);
    const logoutCookies = logoutRes.headers.get('Set-Cookie');
    expect(logoutCookies).toContain('__Host-bitbi_session=');
    expect(logoutCookies).toContain('bitbi_session=');
    expect(logoutCookies).toContain('Max-Age=0');
    expect(env.DB.state.sessions).toHaveLength(0);

    const meAfterLogout = await authWorker.fetch(
      authJsonRequest('/api/me', 'GET', undefined, {
        Cookie: parseSessionCookie(setCookie),
      }),
      env,
      createExecutionContext().execCtx
    );
    await expect(meAfterLogout.json()).resolves.toMatchObject({
      loggedIn: false,
      user: null,
    });
  });

  test('/api/me accepts the legacy session cookie name for backward compatibility', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        createContractUser({
          id: 'legacy-cookie-user',
          email: 'legacy@example.com',
          role: 'user',
        }),
      ],
    });
    const token = await seedSession(env, 'legacy-cookie-user');

    const meRes = await authWorker.fetch(
      authJsonRequest('/api/me', 'GET', undefined, {
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(meRes.status).toBe(200);
    await expect(meRes.json()).resolves.toMatchObject({
      loggedIn: true,
      user: {
        id: 'legacy-cookie-user',
        email: 'legacy-cookie-user@example.com',
      },
    });
  });

  test('/api/me uses cached avatar state without probing R2 on the hot path', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'me-cached-user', role: 'user' })],
      profiles: [
        {
          user_id: 'me-cached-user',
          display_name: 'Cached Avatar',
          bio: '',
          website: '',
          youtube_url: '',
          has_avatar: 1,
          created_at: nowIso(),
          updated_at: nowIso(),
        },
      ],
    });

    const token = await seedSession(env, 'me-cached-user');
    const res = await authWorker.fetch(
      authJsonRequest('/api/me', 'GET', undefined, {
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      loggedIn: true,
      user: {
        display_name: 'Cached Avatar',
        has_avatar: true,
        avatar_url: '/api/profile/avatar',
      },
    });
    expect(env.PRIVATE_MEDIA.getCalls).toHaveLength(0);
    expect(env.PRIVATE_MEDIA.listCalls).toHaveLength(0);
  });

  test('/api/me falls back once for legacy avatar state and persists the cached profile flag', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'me-legacy-user', role: 'user' })],
      profiles: [
        {
          user_id: 'me-legacy-user',
          display_name: 'Legacy Avatar',
          bio: '',
          website: '',
          youtube_url: '',
          created_at: nowIso(),
          updated_at: nowIso(),
        },
      ],
      privateMedia: {
        'avatars/me-legacy-user': {
          body: ONE_PIXEL_PNG_BYTES.buffer.slice(
            ONE_PIXEL_PNG_BYTES.byteOffset,
            ONE_PIXEL_PNG_BYTES.byteOffset + ONE_PIXEL_PNG_BYTES.byteLength
          ),
          httpMetadata: { contentType: 'image/png' },
        },
      },
    });

    const token = await seedSession(env, 'me-legacy-user');
    const firstRes = await authWorker.fetch(
      authJsonRequest('/api/me', 'GET', undefined, {
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(firstRes.status).toBe(200);
    await expect(firstRes.json()).resolves.toMatchObject({
      loggedIn: true,
      user: {
        display_name: 'Legacy Avatar',
        has_avatar: true,
        avatar_url: '/api/profile/avatar',
      },
    });
    expect(env.PRIVATE_MEDIA.getCalls).toEqual(['avatars/me-legacy-user']);
    expect(env.PRIVATE_MEDIA.listCalls).toHaveLength(0);
    expect(env.DB.state.profiles.find((row) => row.user_id === 'me-legacy-user')?.has_avatar).toBe(1);

    env.PRIVATE_MEDIA.getCalls.length = 0;
    const secondRes = await authWorker.fetch(
      authJsonRequest('/api/me', 'GET', undefined, {
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(secondRes.status).toBe(200);
    expect(env.PRIVATE_MEDIA.getCalls).toHaveLength(0);
  });

  test('admin destructive path: delete user without AI-owned records', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'admin-1',
          email: 'admin@example.com',
          password_hash: 'unused',
          created_at: '2026-04-01T00:00:00.000Z',
          status: 'active',
          role: 'admin',
          email_verified_at: '2026-04-01T00:00:00.000Z',
          verification_method: 'email_verified',
        },
        {
          id: 'user-plain',
          email: 'user@example.com',
          password_hash: 'unused',
          created_at: '2026-04-01T00:00:00.000Z',
          status: 'active',
          role: 'user',
          email_verified_at: '2026-04-01T00:00:00.000Z',
          verification_method: 'email_verified',
        },
      ],
      profiles: [
        {
          user_id: 'user-plain',
          display_name: 'User Plain',
          bio: '',
          website: '',
          youtube_url: '',
          created_at: '2026-04-01T00:00:00.000Z',
          updated_at: '2026-04-01T00:00:00.000Z',
        },
      ],
    });

    const adminToken = await seedSession(env, 'admin-1');
    const exec = createExecutionContext();
    const res = await authWorker.fetch(
      authJsonRequest('/api/admin/users/user-plain', 'DELETE', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${adminToken}`,
        'CF-Connecting-IP': '203.0.113.11',
      }),
      env,
      exec.execCtx
    );
    await exec.flush();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      deletedUserId: 'user-plain',
    });
    expect(env.DB.state.users.some((user) => user.id === 'user-plain')).toBe(false);
    expect(env.DB.state.adminAuditLog).toHaveLength(1);
    expect(env.DB.state.adminAuditLog[0].action).toBe('delete_user');
  });

  test('favorites: adding a new favorite at 99 of 100 succeeds', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'fav-user-99',
          email: 'fav99@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      favorites: makeFavorites('fav-user-99', 99),
    });

    const token = await seedSession(env, 'fav-user-99');
    const res = await authWorker.fetch(
      authJsonRequest('/api/favorites', 'POST', {
        item_type: 'gallery',
        item_id: 'item-100',
        title: 'Favorite 100',
        thumb_url: '/thumb-100.png',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
    expect(env.DB.state.favorites).toHaveLength(100);
    expect(
      env.DB.state.favorites.some((row) => row.user_id === 'fav-user-99' && row.item_id === 'item-100')
    ).toBe(true);
  });

  test('favorites: re-adding an existing favorite at 100 of 100 is an idempotent no-op', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'fav-user-100-existing',
          email: 'fav100existing@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      favorites: makeFavorites('fav-user-100-existing', 100),
    });

    const token = await seedSession(env, 'fav-user-100-existing');
    const res = await authWorker.fetch(
      authJsonRequest('/api/favorites', 'POST', {
        item_type: 'gallery',
        item_id: 'item-100',
        title: 'Favorite 100',
        thumb_url: '/thumb-100.png',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
    expect(env.DB.state.favorites).toHaveLength(100);
    expect(
      env.DB.state.favorites.filter((row) => row.user_id === 'fav-user-100-existing' && row.item_id === 'item-100')
    ).toHaveLength(1);
  });

  test('favorites: adding a new favorite at 100 of 100 still fails', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'fav-user-100-new',
          email: 'fav100new@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      favorites: makeFavorites('fav-user-100-new', 100),
    });

    const token = await seedSession(env, 'fav-user-100-new');
    const res = await authWorker.fetch(
      authJsonRequest('/api/favorites', 'POST', {
        item_type: 'gallery',
        item_id: 'item-101',
        title: 'Favorite 101',
        thumb_url: '/thumb-101.png',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Favorites limit reached.',
    });
    expect(env.DB.state.favorites).toHaveLength(100);
    expect(
      env.DB.state.favorites.some((row) => row.user_id === 'fav-user-100-new' && row.item_id === 'item-101')
    ).toBe(false);
  });

  test('favorites: accepts and canonicalizes the current valid thumb_url forms', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'fav-valid-user', role: 'user' })],
    });

    const token = await seedSession(env, 'fav-valid-user');
    const validThumbUrls = [
      { input: '', stored: '' },
      { input: ' /assets/images/1.jpg ', stored: '/assets/images/1.jpg' },
      { input: ' /api/soundlab-thumbs/thumb-bitbi ', stored: '/api/soundlab-thumbs/thumb-bitbi' },
      {
        input: ' https://pub.bitbi.ai/gallery/thumbs/ai-creations/crystal-bitbi-b-orbit-480.webp ',
        stored: 'https://pub.bitbi.ai/gallery/thumbs/ai-creations/crystal-bitbi-b-orbit-480.webp',
      },
    ];

    for (const [index, { input }] of validThumbUrls.entries()) {
      const res = await authWorker.fetch(
        authJsonRequest('/api/favorites', 'POST', {
          item_type: 'gallery',
          item_id: `valid-thumb-${index}`,
          title: `Valid Favorite ${index}`,
          thumb_url: input,
        }, {
          Origin: 'https://bitbi.ai',
          Cookie: `bitbi_session=${token}`,
        }),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ ok: true });
    }

    expect(
      env.DB.state.favorites
        .filter((row) => row.user_id === 'fav-valid-user')
        .map((row) => row.thumb_url)
    ).toEqual(validThumbUrls.map(({ stored }) => stored));
  });

  test('favorites: rejects unsafe thumb_url forms', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'fav-invalid-user', role: 'user' })],
    });

    const token = await seedSession(env, 'fav-invalid-user');
    const invalidThumbUrls = [
      'http://pub.bitbi.ai/gallery/thumbs/test.webp',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'blob:https://bitbi.ai/1234',
      '//evil.example/thumb.png',
      'https://evil.example/thumb.png',
      'https://user:pass@pub.bitbi.ai/gallery/thumbs/test.webp',
      'https://pub.bitbi.ai',
      'https://pub.bitbi.ai/',
      '/assets/images/1.jpg?size=large',
      '/assets/images/1.jpg#hero',
      '/assets/images/\u0000thumb.png',
    ];

    for (const [index, thumbUrl] of invalidThumbUrls.entries()) {
      const res = await authWorker.fetch(
        authJsonRequest('/api/favorites', 'POST', {
          item_type: 'gallery',
          item_id: `invalid-thumb-${index}`,
          title: `Invalid Favorite ${index}`,
          thumb_url: thumbUrl,
        }, {
          Origin: 'https://bitbi.ai',
          Cookie: `bitbi_session=${token}`,
        }),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        ok: false,
        error: 'Invalid thumb_url.',
      });
    }

    expect(env.DB.state.favorites.filter((row) => row.user_id === 'fav-invalid-user')).toHaveLength(0);
  });

  test('shared limiter: login is blocked when the durable IP limit is already exhausted', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const { hashPassword } = await loadAuthModules();
    const env = createAuthTestEnv({
      users: [
        {
          id: 'limited-login-user',
          email: 'limited@example.com',
          password_hash: await hashPassword('password123', { PBKDF2_ITERATIONS: '100000' }),
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      rateLimitCounters: [
        makeActiveRateLimitCounter('auth-login-ip', '203.0.113.55', 10, 900_000),
      ],
    });

    const res = await authWorker.fetch(
      authJsonRequest('/api/login', 'POST', {
        email: 'limited@example.com',
        password: 'password123',
      }, {
        Origin: 'https://bitbi.ai',
        'CF-Connecting-IP': '203.0.113.55',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Too many requests. Please try again later.',
    });
  });

  test('shared limiter: forgot-password preserves generic success when the durable email limit is exhausted', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'forgot-user',
          email: 'forgot@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      rateLimitCounters: [
        makeActiveRateLimitCounter('auth-forgot-email', 'forgot@example.com', 3, 3_600_000),
      ],
    });

    const res = await authWorker.fetch(
      authJsonRequest('/api/forgot-password', 'POST', {
        email: 'forgot@example.com',
      }, {
        Origin: 'https://bitbi.ai',
        'CF-Connecting-IP': '203.0.113.56',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      message: 'If an account with this email exists, a reset link has been sent.',
    });
  });

  test('shared limiter: AI generation is blocked when the durable per-user rate limit is exhausted', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'ai-rate-user',
          email: 'airate@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      rateLimitCounters: [
        makeActiveRateLimitCounter('ai-generate-user', 'ai-rate-user', 20, 3_600_000),
      ],
      aiRun: async () => ({ image: ONE_PIXEL_PNG_DATA_URI }),
    });

    const token = await seedSession(env, 'ai-rate-user');
    const res = await authWorker.fetch(
      authJsonRequest('/api/ai/generate-image', 'POST', {
        prompt: 'blocked by shared limiter',
        steps: 4,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Too many requests. Please try again later.',
    });
  });

  test('shared limiter: reset-password validate is blocked when the durable IP limit is exhausted', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      rateLimitCounters: [
        makeActiveRateLimitCounter('auth-reset-validate-ip', '203.0.113.57', 10, 900_000),
      ],
    });

    const res = await authWorker.fetch(
      authJsonRequest('/api/reset-password/validate?token=fake-reset-token', 'GET', undefined, {
        Origin: 'https://bitbi.ai',
        'CF-Connecting-IP': '203.0.113.57',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Too many requests. Please try again later.',
    });
  });

  test('shared limiter: reset-password is blocked when the durable IP limit is exhausted', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      rateLimitCounters: [
        makeActiveRateLimitCounter('auth-reset-ip', '203.0.113.58', 5, 3_600_000),
      ],
    });

    const res = await authWorker.fetch(
      authJsonRequest('/api/reset-password', 'POST', {
        token: 'fake-reset-token',
        password: 'password123',
      }, {
        Origin: 'https://bitbi.ai',
        'CF-Connecting-IP': '203.0.113.58',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Too many requests. Please try again later.',
    });
  });

  test('shared limiter: verify-email is blocked when the durable IP limit is exhausted', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      rateLimitCounters: [
        makeActiveRateLimitCounter('auth-verify-ip', '203.0.113.59', 10, 900_000),
      ],
    });

    const res = await authWorker.fetch(
      authJsonRequest('/api/verify-email?token=fake-verify-token', 'GET', undefined, {
        Origin: 'https://bitbi.ai',
        'CF-Connecting-IP': '203.0.113.59',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Too many requests. Please try again later.',
    });
  });

  test('shared limiter: avatar upload is blocked when the durable IP limit is exhausted', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'avatar-rate-user', role: 'user' })],
      rateLimitCounters: [
        makeActiveRateLimitCounter('avatar-upload-ip', '203.0.113.60', 10, 3_600_000),
      ],
    });

    const token = await seedSession(env, 'avatar-rate-user');
    const res = await authWorker.fetch(
      authJsonRequest('/api/profile/avatar', 'POST', {
        source_image_id: 'deadbeef',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'CF-Connecting-IP': '203.0.113.60',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Too many requests. Please try again later.',
    });
  });

  test('shared limiter: favorites add is blocked when the durable IP limit is exhausted', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'fav-rate-user', role: 'user' })],
      rateLimitCounters: [
        makeActiveRateLimitCounter('favorites-add-ip', '203.0.113.61', 30, 60_000),
      ],
    });

    const token = await seedSession(env, 'fav-rate-user');
    const res = await authWorker.fetch(
      authJsonRequest('/api/favorites', 'POST', {
        item_type: 'gallery',
        item_id: 'rate-limited-favorite',
        title: 'Rate Limited Favorite',
        thumb_url: '/assets/images/1.jpg',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'CF-Connecting-IP': '203.0.113.61',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Too many requests. Please try again later.',
    });
    expect(env.DB.state.favorites.filter((row) => row.user_id === 'fav-rate-user')).toHaveLength(0);
  });

  test('request trust boundary: same-origin Referer is accepted for state-changing favorites add when Origin is absent', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'fav-referer-user', role: 'user' })],
    });

    const token = await seedSession(env, 'fav-referer-user');
    const res = await authWorker.fetch(
      authJsonRequest('/api/favorites', 'POST', {
        item_type: 'gallery',
        item_id: 'referer-favorite',
        title: 'Referer Favorite',
        thumb_url: '/assets/images/1.jpg',
      }, {
        Referer: 'https://bitbi.ai/account/profile.html',
        Cookie: `bitbi_session=${token}`,
        'CF-Connecting-IP': '203.0.113.62',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
    expect(
      env.DB.state.favorites.some((row) => row.user_id === 'fav-referer-user' && row.item_id === 'referer-favorite')
    ).toBe(true);
  });

  test('request trust boundary: foreign Origin is rejected for state-changing favorites add', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'fav-foreign-origin-user', role: 'user' })],
    });

    const token = await seedSession(env, 'fav-foreign-origin-user');
    const res = await authWorker.fetch(
      authJsonRequest('/api/favorites', 'POST', {
        item_type: 'gallery',
        item_id: 'foreign-origin-favorite',
        title: 'Foreign Origin Favorite',
        thumb_url: '/assets/images/1.jpg',
      }, {
        Origin: 'https://evil.example',
        Cookie: `bitbi_session=${token}`,
        'CF-Connecting-IP': '203.0.113.63',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Forbidden',
    });
    expect(env.DB.state.favorites.filter((row) => row.user_id === 'fav-foreign-origin-user')).toHaveLength(0);
  });

  test('request trust boundary: originless state-changing favorites add is rejected without same-origin Referer', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'fav-originless-user', role: 'user' })],
    });

    const token = await seedSession(env, 'fav-originless-user');
    const res = await authWorker.fetch(
      authJsonRequest('/api/favorites', 'POST', {
        item_type: 'gallery',
        item_id: 'originless-favorite',
        title: 'Originless Favorite',
        thumb_url: '/assets/images/1.jpg',
      }, {
        Cookie: `bitbi_session=${token}`,
        'CF-Connecting-IP': '203.0.113.64',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Forbidden',
    });
    expect(env.DB.state.favorites.filter((row) => row.user_id === 'fav-originless-user')).toHaveLength(0);
  });

  test('request trust boundary: verify-email remains allowed without Origin or Referer', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv();

    const res = await authWorker.fetch(
      authJsonRequest('/api/verify-email', 'GET'),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Token is missing.',
    });
  });

  test('AI generate: default model still uses the existing JSON path when no model is provided', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    let capturedModelId = null;
    let capturedPayload = null;
    const env = createAuthTestEnv({
      users: [
        {
          id: 'ai-default-user',
          email: 'default-image@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      aiRun: async (modelId, payload) => {
        capturedModelId = modelId;
        capturedPayload = payload;
        return { image: ONE_PIXEL_PNG_DATA_URI };
      },
    });

    const token = await seedSession(env, 'ai-default-user');
    const res = await authWorker.fetch(
      authJsonRequest('/api/ai/generate-image', 'POST', {
        prompt: 'default image path',
        steps: 6,
        seed: 12345,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      data: {
        model: '@cf/black-forest-labs/flux-1-schnell',
        steps: 6,
        seed: 12345,
      },
    });
    expect(capturedModelId).toBe('@cf/black-forest-labs/flux-1-schnell');
    expect(capturedPayload).toEqual({
      prompt: 'default image path',
      num_steps: 6,
      seed: 12345,
    });
  });

  test('AI generate: public route rejects FLUX.2 Klein 9B so it is not exposed outside admin AI Lab', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    let aiCalls = 0;
    const env = createAuthTestEnv({
      users: [
        {
          id: 'ai-klein-user',
          email: 'klein-image@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      aiRun: async () => {
        aiCalls += 1;
        return { image: ONE_PIXEL_PNG_DATA_URI };
      },
    });

    const token = await seedSession(env, 'ai-klein-user');
    const res = await authWorker.fetch(
      authJsonRequest('/api/ai/generate-image', 'POST', {
        prompt: 'public klein image attempt',
        model: '@cf/black-forest-labs/flux-2-klein-9b',
        steps: 8,
        seed: 42,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Unsupported image model.',
    });
    expect(aiCalls).toBe(0);
  });

  test('AI generate: public route rejects FLUX.2 Dev so it is not exposed outside admin AI Lab', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    let aiCalls = 0;
    const env = createAuthTestEnv({
      users: [
        {
          id: 'ai-dev-user',
          email: 'dev-image@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      aiRun: async () => {
        aiCalls += 1;
        return { image: ONE_PIXEL_PNG_DATA_URI };
      },
    });

    const token = await seedSession(env, 'ai-dev-user');
    const res = await authWorker.fetch(
      authJsonRequest('/api/ai/generate-image', 'POST', {
        prompt: 'public dev image attempt',
        model: '@cf/black-forest-labs/flux-2-dev',
        steps: 6,
        seed: 77,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Unsupported image model.',
    });
    expect(aiCalls).toBe(0);
  });

  test('AI generate: unsupported model IDs are rejected server-side before reaching Workers AI', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    let aiCalls = 0;
    const env = createAuthTestEnv({
      users: [
        {
          id: 'ai-invalid-model-user',
          email: 'invalid-model@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      aiRun: async () => {
        aiCalls += 1;
        return { image: ONE_PIXEL_PNG_DATA_URI };
      },
    });

    const token = await seedSession(env, 'ai-invalid-model-user');
    const res = await authWorker.fetch(
      authJsonRequest('/api/ai/generate-image', 'POST', {
        prompt: 'invalid model attempt',
        model: '@cf/not-allowlisted/model',
        steps: 4,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Unsupported image model.',
    });
    expect(aiCalls).toBe(0);
    expect(env.DB.state.aiGenerationLog.filter((row) => row.user_id === 'ai-invalid-model-user')).toHaveLength(0);
  });

  test('AI lifecycle: save image then delete image removes metadata and blob', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'artist-1',
          email: 'artist@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
    });

    const token = await seedSession(env, 'artist-1');
    const pngPixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uUAAAAASUVORK5CYII=';

    const saveRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/save', 'POST', {
        imageData: pngPixel,
        prompt: 'tiny test image',
        model: '@cf/test-model',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(saveRes.status).toBe(201);
    const saveBody = await saveRes.json();
    expect(saveBody.ok).toBe(true);
    const imageId = saveBody.data.id;
    const savedRow = env.DB.state.aiImages.find((row) => row.id === imageId);
    expect(savedRow).toBeTruthy();
    expect(env.USER_IMAGES.objects.has(savedRow.r2_key)).toBe(true);

    const deleteRes = await authWorker.fetch(
      authJsonRequest(`/api/ai/images/${imageId}`, 'DELETE', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(deleteRes.status).toBe(200);
    await expect(deleteRes.json()).resolves.toMatchObject({ ok: true });
    expect(env.DB.state.aiImages.some((row) => row.id === imageId)).toBe(false);
    expect(env.USER_IMAGES.objects.has(savedRow.r2_key)).toBe(false);
    expect(env.DB.state.r2CleanupQueue).toHaveLength(0);
  });

  test('AI save image enqueues a derivative job after the original and row are persisted', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'artist-queue-user', role: 'user' })],
    });

    const token = await seedSession(env, 'artist-queue-user');
    const saveRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/save', 'POST', {
        imageData: ONE_PIXEL_PNG_DATA_URI,
        prompt: 'queued derivative test',
        model: '@cf/test-model',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(saveRes.status).toBe(201);
    const saveBody = await saveRes.json();
    const imageId = saveBody.data.id;
    const savedRow = env.DB.state.aiImages.find((row) => row.id === imageId);
    expect(savedRow).toBeTruthy();
    expect(env.USER_IMAGES.objects.has(savedRow.r2_key)).toBe(true);
    expect(env.AI_IMAGE_DERIVATIVES_QUEUE.messages).toHaveLength(1);
    expect(env.AI_IMAGE_DERIVATIVES_QUEUE.messages[0]).toMatchObject({
      type: 'ai_image_derivative.generate',
      image_id: imageId,
      user_id: 'artist-queue-user',
      original_key: savedRow.r2_key,
      derivatives_version: 1,
      trigger: 'save',
    });
    expect(saveBody.data).toMatchObject({
      derivatives_status: 'pending',
      derivatives_version: 1,
      derivatives_enqueued: true,
    });
  });

  test('AI save image accepts a 1024x1024 image, inspects dimensions, and preserves the success shape', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'artist-sized-user', role: 'user' })],
      imagesBinding: {
        originalInfo: { width: 1024, height: 1024, format: 'image/png' },
      },
    });

    const token = await seedSession(env, 'artist-sized-user');
    const saveRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/save', 'POST', {
        imageData: ONE_PIXEL_PNG_DATA_URI,
        prompt: 'sized save image',
        model: '@cf/test-model',
        steps: 4,
        seed: 77,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(saveRes.status).toBe(201);
    const body = await saveRes.json();
    expect(body).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({
        id: expect.any(String),
        prompt: 'sized save image',
        model: '@cf/test-model',
        steps: 4,
        seed: 77,
        derivatives_status: 'pending',
        derivatives_version: 1,
      }),
    }));
    expect(env.IMAGES.infoCalls).toHaveLength(1);
    expect(env.IMAGES.infoCalls[0]).toEqual(expect.objectContaining({
      width: 1024,
      height: 1024,
    }));
    expect(env.USER_IMAGES.putCalls).toHaveLength(1);
    expect(env.AI_IMAGE_DERIVATIVES_QUEUE.messages).toHaveLength(1);
  });

  test('AI save image rejects payloads larger than 10 MB before storage or queueing', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'artist-large-user', role: 'user' })],
    });

    const token = await seedSession(env, 'artist-large-user');
    const bytes = Buffer.alloc((10 * 1024 * 1024) + 1, 0);
    bytes[0] = 0x89;
    bytes[1] = 0x50;
    bytes[2] = 0x4E;
    bytes[3] = 0x47;
    const imageData = `data:image/png;base64,${bytes.toString('base64')}`;

    const saveRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/save', 'POST', {
        imageData,
        prompt: 'too large image',
        model: '@cf/test-model',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(saveRes.status).toBe(400);
    await expect(saveRes.json()).resolves.toMatchObject({
      ok: false,
      error: 'Image data must be 10 MB or smaller.',
    });
    expect(env.IMAGES.infoCalls).toHaveLength(0);
    expect(env.USER_IMAGES.putCalls).toHaveLength(0);
    expect(env.AI_IMAGE_DERIVATIVES_QUEUE.messages).toHaveLength(0);
    expect(env.DB.state.aiImages).toHaveLength(0);
  });

  test('AI save image rejects oversized dimensions before storage or queueing', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'artist-oversize-user', role: 'user' })],
      imagesBinding: {
        originalInfo: { width: 1025, height: 1024, format: 'image/png' },
      },
    });

    const token = await seedSession(env, 'artist-oversize-user');
    const saveRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/save', 'POST', {
        imageData: ONE_PIXEL_PNG_DATA_URI,
        prompt: 'oversized dimensions',
        model: '@cf/test-model',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(saveRes.status).toBe(400);
    await expect(saveRes.json()).resolves.toMatchObject({
      ok: false,
      error: 'Saved image must be 1024x1024 pixels or smaller. Received 1025x1024.',
    });
    expect(env.IMAGES.infoCalls).toHaveLength(1);
    expect(env.USER_IMAGES.putCalls).toHaveLength(0);
    expect(env.AI_IMAGE_DERIVATIVES_QUEUE.messages).toHaveLength(0);
    expect(env.DB.state.aiImages).toHaveLength(0);
  });

  test('AI image derivative consumer is idempotent for duplicate jobs', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const originalKey = 'users/dup-user/folders/unsorted/original.png';
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'dup-user', role: 'user' })],
      aiImages: [
        {
          id: 'feedbeef',
          user_id: 'dup-user',
          folder_id: null,
          r2_key: originalKey,
          prompt: 'Duplicate queue image',
          model: '@cf/test-model',
          steps: 4,
          seed: 42,
          created_at: nowIso(),
        },
      ],
      userImages: {
        [originalKey]: {
          body: Buffer.from(ONE_PIXEL_PNG_DATA_URI.replace('data:image/png;base64,', ''), 'base64'),
          httpMetadata: { contentType: 'image/png' },
        },
      },
    });

    const body = createAiImageDerivativeMessage({
      imageId: 'feedbeef',
      userId: 'dup-user',
      originalKey,
      derivativesVersion: 1,
    });

    const firstBatch = createQueueBatch([body]);
    await authWorker.queue(firstBatch.batch, env, createExecutionContext().execCtx);
    expect(firstBatch.states[0]).toMatchObject({ acked: true, retried: false });

    const rowAfterFirstRun = env.DB.state.aiImages.find((row) => row.id === 'feedbeef');
    expect(rowAfterFirstRun).toMatchObject({
      derivatives_status: 'ready',
      derivatives_version: 1,
      thumb_key: 'users/dup-user/derivatives/v1/feedbeef/thumb.webp',
      medium_key: 'users/dup-user/derivatives/v1/feedbeef/medium.webp',
    });
    expect(env.USER_IMAGES.putCalls).toHaveLength(2);

    const secondBatch = createQueueBatch([body]);
    await authWorker.queue(secondBatch.batch, env, createExecutionContext().execCtx);
    expect(secondBatch.states[0]).toMatchObject({ acked: true, retried: false });
    expect(env.USER_IMAGES.putCalls).toHaveLength(2);
    expect(env.IMAGES.transformCalls).toHaveLength(2);
  });

  test('AI image derivative consumer ignores stale-version jobs when newer derivatives are already ready', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'stale-user', role: 'user' })],
      aiImages: [
        {
          id: 'deadbeef',
          user_id: 'stale-user',
          folder_id: null,
          r2_key: 'users/stale-user/folders/unsorted/original.png',
          prompt: 'Stale derivative image',
          model: '@cf/test-model',
          steps: 4,
          seed: 11,
          created_at: nowIso(),
          thumb_key: 'users/stale-user/derivatives/v2/deadbeef/thumb.webp',
          medium_key: 'users/stale-user/derivatives/v2/deadbeef/medium.webp',
          thumb_mime_type: 'image/webp',
          medium_mime_type: 'image/webp',
          thumb_width: 320,
          thumb_height: 240,
          medium_width: 1280,
          medium_height: 960,
          derivatives_status: 'ready',
          derivatives_version: 2,
        },
      ],
    });

    const staleBatch = createQueueBatch([
      createAiImageDerivativeMessage({
        imageId: 'deadbeef',
        userId: 'stale-user',
        originalKey: 'users/stale-user/folders/unsorted/original.png',
        derivativesVersion: 1,
      }),
    ]);
    await authWorker.queue(staleBatch.batch, env, createExecutionContext().execCtx);

    expect(staleBatch.states[0]).toMatchObject({ acked: true, retried: false });
    expect(env.USER_IMAGES.putCalls).toHaveLength(0);
    expect(env.IMAGES.transformCalls).toHaveLength(0);
    expect(env.DB.state.aiImages.find((row) => row.id === 'deadbeef')).toMatchObject({
      thumb_key: 'users/stale-user/derivatives/v2/deadbeef/thumb.webp',
      medium_key: 'users/stale-user/derivatives/v2/deadbeef/medium.webp',
      derivatives_status: 'ready',
      derivatives_version: 2,
    });
  });

  test('AI image derivative consumer marks status as failed when retries are exhausted', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const originalKey = 'users/exhaust-user/folders/unsorted/original.png';
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'exhaust-user', role: 'user' })],
      aiImages: [
        {
          id: 'exh00001',
          user_id: 'exhaust-user',
          folder_id: null,
          r2_key: originalKey,
          prompt: 'Retry exhaustion test',
          model: '@cf/test-model',
          steps: 4,
          seed: 99,
          created_at: nowIso(),
        },
      ],
      userImages: {
        [originalKey]: {
          body: Buffer.from(ONE_PIXEL_PNG_DATA_URI.replace('data:image/png;base64,', ''), 'base64'),
          httpMetadata: { contentType: 'image/png' },
        },
      },
      imagesBinding: {
        failResponseWith: new Error('Simulated transform failure'),
      },
    });

    const body = createAiImageDerivativeMessage({
      imageId: 'exh00001',
      userId: 'exhaust-user',
      originalKey,
      derivativesVersion: 1,
    });

    // Early attempt (attempts < 7): should retry, status stays pending
    const earlyBatch = createQueueBatch([body], { attempts: 3 });
    await authWorker.queue(earlyBatch.batch, env, createExecutionContext().execCtx);
    expect(earlyBatch.states[0]).toMatchObject({ acked: false, retried: true });
    expect(earlyBatch.states[0].retryOptions).toEqual({ delaySeconds: 120 });
    const rowAfterRetry = env.DB.state.aiImages.find((row) => row.id === 'exh00001');
    expect(rowAfterRetry.derivatives_status).toBe('pending');

    // Last attempt (attempts >= 7): should ack and mark failed
    const lastBatch = createQueueBatch([body], { attempts: 8 });
    await authWorker.queue(lastBatch.batch, env, createExecutionContext().execCtx);
    expect(lastBatch.states[0]).toMatchObject({ acked: true, retried: false });
    const rowAfterExhaustion = env.DB.state.aiImages.find((row) => row.id === 'exh00001');
    expect(rowAfterExhaustion.derivatives_status).toBe('failed');
    expect(rowAfterExhaustion.derivatives_error).toContain('retries exhausted');
  });

  test('AI image derivative consumer applies bounded retry backoff for transient failures', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const originalKey = 'users/backoff-user/folders/unsorted/original.png';
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'backoff-user', role: 'user' })],
      aiImages: [
        {
          id: 'ba110001',
          user_id: 'backoff-user',
          folder_id: null,
          r2_key: originalKey,
          prompt: 'Retry backoff test',
          model: '@cf/test-model',
          steps: 4,
          seed: 101,
          created_at: nowIso(),
        },
      ],
      userImages: {
        [originalKey]: {
          body: Buffer.from(ONE_PIXEL_PNG_DATA_URI.replace('data:image/png;base64,', ''), 'base64'),
          httpMetadata: { contentType: 'image/png' },
        },
      },
      imagesBinding: {
        failResponseWith: new Error('Transient transform failure'),
      },
    });

    const body = createAiImageDerivativeMessage({
      imageId: 'ba110001',
      userId: 'backoff-user',
      originalKey,
      derivativesVersion: 1,
    });

    const firstRetryBatch = createQueueBatch([body], { attempts: 1 });
    await authWorker.queue(firstRetryBatch.batch, env, createExecutionContext().execCtx);
    expect(firstRetryBatch.states[0]).toMatchObject({
      acked: false,
      retried: true,
      retryOptions: { delaySeconds: 30 },
    });

    const cappedRetryBatch = createQueueBatch([body], { attempts: 6 });
    await authWorker.queue(cappedRetryBatch.batch, env, createExecutionContext().execCtx);
    expect(cappedRetryBatch.states[0]).toMatchObject({
      acked: false,
      retried: true,
      retryOptions: { delaySeconds: 900 },
    });
  });

  [
    {
      label: 'text',
      sourceModule: 'text',
      title: 'Release Notes Draft',
      data: {
        preset: 'balanced',
        model: {
          id: '@cf/openai/gpt-oss-20b',
          label: 'GPT OSS 20B',
          vendor: 'OpenAI',
        },
        system: 'You are concise.',
        prompt: 'Summarize the release.',
        output: 'Release summary output.',
        maxTokens: 300,
        temperature: 0.7,
        usage: { total_tokens: 42 },
        warnings: ['Mock text warning'],
        elapsedMs: 123,
        receivedAt: nowIso(),
      },
      contains: ['Module: Text', 'Release summary output.'],
    },
    {
      label: 'embeddings',
      sourceModule: 'embeddings',
      title: 'Embedding Snapshot',
      data: {
        preset: 'embedding_default',
        model: {
          id: '@cf/baai/bge-m3',
          label: 'BGE M3',
          vendor: 'BAAI',
        },
        inputItems: ['alpha', 'beta'],
        vectors: [[0.1, 0.2], [0.3, 0.4]],
        dimensions: 2,
        count: 2,
        shape: [2, 2],
        pooling: 'cls',
        warnings: [],
        elapsedMs: 88,
        receivedAt: nowIso(),
      },
      contains: ['Module: Embeddings', 'Vectors:', 'alpha'],
    },
    {
      label: 'compare',
      sourceModule: 'compare',
      title: 'Compare Session',
      data: {
        prompt: 'Compare the outputs.',
        system: 'You are concise.',
        maxTokens: 250,
        temperature: 0.7,
        elapsedMs: 222,
        receivedAt: nowIso(),
        warnings: ['Mock compare warning'],
        diffSummary: {
          identical: false,
          shared: ['Shared lead sentence.'],
          onlyA: ['Cinematic phrasing.'],
          onlyB: ['Technical phrasing.'],
        },
        results: [
          {
            ok: true,
            model: {
              id: '@cf/meta/llama-3.1-8b-instruct-fast',
              label: 'Llama 3.1 8B Instruct Fast',
              vendor: 'Meta',
            },
            text: 'Model A output.',
            usage: { total_tokens: 11 },
            elapsedMs: 111,
          },
          {
            ok: true,
            model: {
              id: '@cf/google/gemma-4-26b-a4b-it',
              label: 'Gemma 4 26B A4B',
              vendor: 'Google',
            },
            text: 'Model B output.',
            usage: { total_tokens: 13 },
            elapsedMs: 123,
          },
        ],
      },
      contains: ['Module: Compare', 'Model A output.', 'Difference Aid:'],
    },
    {
      label: 'live agent',
      sourceModule: 'live_agent',
      title: 'Live Agent Transcript',
      data: {
        model: {
          id: '@cf/google/gemma-4-26b-a4b-it',
          label: 'Gemma 4 26B A4B',
          vendor: 'Google',
        },
        system: 'You are concise.',
        transcript: [
          { role: 'user', content: 'Hello agent.' },
          { role: 'assistant', content: 'Hello admin.' },
        ],
        finalResponse: 'Hello admin.',
        receivedAt: nowIso(),
        warnings: [],
      },
      contains: ['Module: Live Agent', '[USER] Hello agent.', 'Final Response:'],
    },
  ].forEach((scenario) => {
    test(`admin AI save-text-asset saves ${scenario.label} output as a shared folder text asset`, async () => {
      const authWorker = await loadWorker('workers/auth/src/index.js');
      const env = createAuthTestEnv({
        users: [createAdminUser('admin-save-user')],
        aiFolders: [
          {
            id: 'feed1234',
            user_id: 'admin-save-user',
            name: 'Research',
            slug: 'research',
            status: 'active',
            created_at: nowIso(),
          },
        ],
      });

      const token = await seedSession(env, 'admin-save-user');
      const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/save-text-asset', 'POST', {
          title: scenario.title,
          folderId: 'feed1234',
          sourceModule: scenario.sourceModule,
          data: scenario.data,
        }, {
          Origin: 'https://bitbi.ai',
          Cookie: `bitbi_session=${token}`,
          'CF-Connecting-IP': '203.0.113.30',
        }),
        env,
        createExecutionContext().execCtx
      );

      expect(res.status).toBe(201);
      await expect(res.json()).resolves.toMatchObject({
        ok: true,
        data: {
          folder_id: 'feed1234',
          source_module: scenario.sourceModule,
          file_name: expect.stringMatching(/\.txt$/),
        },
      });

      expect(env.DB.state.aiTextAssets).toHaveLength(1);
      const row = env.DB.state.aiTextAssets[0];
      expect(row.folder_id).toBe('feed1234');
      expect(row.source_module).toBe(scenario.sourceModule);
      expect(env.USER_IMAGES.objects.has(row.r2_key)).toBe(true);
      const object = env.USER_IMAGES.objects.get(row.r2_key);
      const text = decodeStoredTextBody(object.body);
      expect(text).toContain(`Title: ${scenario.title}`);
      for (const fragment of scenario.contains) {
        expect(text).toContain(fragment);
      }
    });
  });

  test('admin AI save-text-asset saves music output as a binary MP3 in the audio subdirectory', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createAdminUser('admin-save-music')],
      aiFolders: [
        {
          id: 'feed5678',
          user_id: 'admin-save-music',
          name: 'Tracks',
          slug: 'tracks',
          status: 'active',
          created_at: nowIso(),
        },
      ],
    });

    const fakeAudioBase64 = btoa('fake-mp3-binary-data');
    const token = await seedSession(env, 'admin-save-music');
    const res = await authWorker.fetch(
      authJsonRequest('/api/admin/ai/save-text-asset', 'POST', {
        title: 'Sunset Groove',
        folderId: 'feed5678',
        sourceModule: 'music',
        data: {
          audioBase64: fakeAudioBase64,
          mimeType: 'audio/mpeg',
          prompt: 'A chill lo-fi sunset groove.',
          model: { id: 'minimax/music-2.6', label: 'MiniMax Music' },
          mode: 'instrumental',
          bpm: 85,
          durationMs: 30000,
          sampleRate: 44100,
          channels: 2,
          bitrate: 128000,
          sizeBytes: 480000,
        },
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'CF-Connecting-IP': '203.0.113.40',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({
      ok: true,
      data: {
        folder_id: 'feed5678',
        source_module: 'music',
        mime_type: 'audio/mpeg',
        file_name: expect.stringMatching(/\.mp3$/),
      },
    });

    expect(env.DB.state.aiTextAssets).toHaveLength(1);
    const row = env.DB.state.aiTextAssets[0];
    expect(row.folder_id).toBe('feed5678');
    expect(row.source_module).toBe('music');
    expect(row.mime_type).toBe('audio/mpeg');
    expect(row.r2_key).toContain('/audio/');
    expect(row.r2_key).toMatch(/\.mp3$/);

    expect(env.USER_IMAGES.objects.has(row.r2_key)).toBe(true);
    const object = env.USER_IMAGES.objects.get(row.r2_key);
    expect(object.httpMetadata.contentType).toBe('audio/mpeg');

    const metadata = JSON.parse(row.metadata_json);
    expect(metadata.prompt).toBe('A chill lo-fi sunset groove.');
    expect(metadata.mode).toBe('instrumental');
    expect(metadata.bpm).toBe(85);
    expect(JSON.parse(metadata.audio)).toMatchObject({
      duration_ms: 30000,
      sample_rate: 44100,
      channels: 2,
    });
  });

  test('admin AI save-text-asset accepts nested usage details and flattens stored metadata safely', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createAdminUser('admin-nested-text')],
    });

    const token = await seedSession(env, 'admin-nested-text');
    const usage = {
      prompt_tokens: 14,
      completion_tokens: 28,
      total_tokens: 42,
      prompt_tokens_details: {
        cached_tokens: 6,
        audio_tokens: 0,
      },
      completion_tokens_details: {
        reasoning_tokens: 9,
      },
    };

    const res = await authWorker.fetch(
      authJsonRequest('/api/admin/ai/save-text-asset', 'POST', {
        title: 'Nested Usage Text Save',
        sourceModule: 'text',
        data: {
          prompt: 'Summarize the nested usage response.',
          output: 'Nested usage output saved successfully.',
          usage,
        },
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'CF-Connecting-IP': '203.0.113.32',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      data: {
        source_module: 'text',
      },
    });

    expect(env.DB.state.aiTextAssets).toHaveLength(1);
    const row = env.DB.state.aiTextAssets[0];
    const metadata = JSON.parse(row.metadata_json);
    expect(JSON.parse(metadata.usage)).toEqual(usage);

    const object = env.USER_IMAGES.objects.get(row.r2_key);
    const text = decodeStoredTextBody(object.body);
    expect(text).toContain('"prompt_tokens_details"');
    expect(text).toContain('"cached_tokens": 6');
    expect(text).toContain('"completion_tokens_details"');
    expect(text).toContain('"reasoning_tokens": 9');
  });

  test('admin AI save-text-asset accepts nested compare usage details', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createAdminUser('admin-nested-compare')],
    });

    const token = await seedSession(env, 'admin-nested-compare');
    const res = await authWorker.fetch(
      authJsonRequest('/api/admin/ai/save-text-asset', 'POST', {
        title: 'Nested Compare Save',
        sourceModule: 'compare',
        data: {
          prompt: 'Compare both outputs.',
          results: [
            {
              ok: true,
              model: {
                id: '@cf/meta/llama-3.1-8b-instruct-fast',
                label: 'Llama 3.1 8B Instruct Fast',
                vendor: 'Meta',
              },
              text: 'Model A output.',
              usage: {
                total_tokens: 11,
                completion_tokens_details: {
                  reasoning_tokens: 4,
                },
              },
              elapsedMs: 111,
            },
            {
              ok: true,
              model: {
                id: '@cf/openai/gpt-oss-20b',
                label: 'GPT OSS 20B',
                vendor: 'OpenAI',
              },
              text: 'Model B output.',
              usage: {
                total_tokens: 13,
                prompt_tokens_details: {
                  cached_tokens: 2,
                },
              },
              elapsedMs: 123,
            },
          ],
        },
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'CF-Connecting-IP': '203.0.113.33',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      data: {
        source_module: 'compare',
      },
    });

    expect(env.DB.state.aiTextAssets).toHaveLength(1);
    const row = env.DB.state.aiTextAssets[0];
    const object = env.USER_IMAGES.objects.get(row.r2_key);
    const text = decodeStoredTextBody(object.body);
    expect(text).toContain('"completion_tokens_details"');
    expect(text).toContain('"reasoning_tokens": 4');
    expect(text).toContain('"prompt_tokens_details"');
    expect(text).toContain('"cached_tokens": 2');
  });

  test('admin AI save-text-asset rejects saving into a foreign folder', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createAdminUser('admin-owner')],
      aiFolders: [
        {
          id: 'deadbeef',
          user_id: 'someone-else',
          name: 'Foreign',
          slug: 'foreign',
          status: 'active',
          created_at: nowIso(),
        },
      ],
    });

    const token = await seedSession(env, 'admin-owner');
    const res = await authWorker.fetch(
        authJsonRequest('/api/admin/ai/save-text-asset', 'POST', {
          title: 'Blocked Save',
          folderId: 'deadbeef',
          sourceModule: 'text',
        data: {
          prompt: 'Prompt',
          output: 'Output',
        },
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'CF-Connecting-IP': '203.0.113.31',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Folder not found.',
    });
    expect(env.DB.state.aiTextAssets).toHaveLength(0);
    expect(env.USER_IMAGES.objects.size).toBe(0);
  });

  test('member audio save endpoint stores MP3 in R2 for authenticated non-admin user', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'member-audio-save', role: 'user' })],
      aiFolders: [
        {
          id: 'af001234',
          user_id: 'member-audio-save',
          name: 'My Music',
          slug: 'my-music',
          status: 'active',
          created_at: nowIso(),
        },
      ],
    });

    const fakeAudioBase64 = btoa('fake-mp3-binary-data');
    const token = await seedSession(env, 'member-audio-save');
    const res = await authWorker.fetch(
      authJsonRequest('/api/ai/audio/save', 'POST', {
        title: 'My First Track',
        audioBase64: fakeAudioBase64,
        mimeType: 'audio/mpeg',
        prompt: 'A peaceful piano melody',
        folder_id: 'af001234',
        mode: 'instrumental',
        bpm: 90,
        durationMs: 25000,
        sampleRate: 44100,
        channels: 2,
        bitrate: 128000,
        sizeBytes: 400000,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'CF-Connecting-IP': '203.0.113.50',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({
      ok: true,
      data: {
        folder_id: 'af001234',
        source_module: 'music',
        mime_type: 'audio/mpeg',
        file_name: expect.stringMatching(/\.mp3$/),
      },
    });

    expect(env.DB.state.aiTextAssets).toHaveLength(1);
    const row = env.DB.state.aiTextAssets[0];
    expect(row.folder_id).toBe('af001234');
    expect(row.user_id).toBe('member-audio-save');
    expect(row.source_module).toBe('music');
    expect(row.mime_type).toBe('audio/mpeg');
    expect(row.r2_key).toContain('/audio/');
    expect(row.r2_key).toMatch(/\.mp3$/);

    expect(env.USER_IMAGES.objects.has(row.r2_key)).toBe(true);
    const object = env.USER_IMAGES.objects.get(row.r2_key);
    expect(object.httpMetadata.contentType).toBe('audio/mpeg');

    const metadata = JSON.parse(row.metadata_json);
    expect(metadata.prompt).toBe('A peaceful piano melody');
    expect(metadata.mode).toBe('instrumental');
    expect(metadata.bpm).toBe(90);
  });

  test('member audio save rejects unauthenticated requests', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({});

    const res = await authWorker.fetch(
      authJsonRequest('/api/ai/audio/save', 'POST', {
        title: 'No Auth',
        audioBase64: btoa('data'),
      }, {
        Origin: 'https://bitbi.ai',
        'CF-Connecting-IP': '203.0.113.51',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(401);
  });

  test('member audio save rejects missing title', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'member-audio-notitle', role: 'user' })],
    });

    const token = await seedSession(env, 'member-audio-notitle');
    const res = await authWorker.fetch(
      authJsonRequest('/api/ai/audio/save', 'POST', {
        audioBase64: btoa('data'),
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'CF-Connecting-IP': '203.0.113.52',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  test('AI assets route returns mixed image, text, and sound assets from the shared folder world', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'mixed-assets-user', role: 'user' })],
      aiFolders: [
        {
          id: 'f01da123',
          user_id: 'mixed-assets-user',
          name: 'Launches',
          slug: 'launches',
          status: 'active',
          created_at: nowIso(),
        },
      ],
      aiImages: [
        {
          id: '1ab100cd',
          user_id: 'mixed-assets-user',
          folder_id: 'f01da123',
          r2_key: 'users/mixed-assets-user/folders/launches/img100.png',
          prompt: 'Launch poster',
          model: '@cf/black-forest-labs/flux-1-schnell',
          steps: 4,
          seed: 123,
          created_at: '2026-04-10T12:00:00.000Z',
          thumb_key: 'users/mixed-assets-user/derivatives/v1/1ab100cd/thumb.webp',
          medium_key: 'users/mixed-assets-user/derivatives/v1/1ab100cd/medium.webp',
          thumb_mime_type: 'image/webp',
          medium_mime_type: 'image/webp',
          thumb_width: 320,
          thumb_height: 320,
          medium_width: 1280,
          medium_height: 1280,
          derivatives_status: 'ready',
          derivatives_version: 1,
        },
      ],
      aiTextAssets: [
        {
          id: 'abc100ef',
          user_id: 'mixed-assets-user',
          folder_id: 'f01da123',
          r2_key: 'users/mixed-assets-user/folders/launches/text/txt100.txt',
          title: 'Compare Notes',
          file_name: 'compare-notes.txt',
          source_module: 'compare',
          mime_type: 'text/plain; charset=utf-8',
          size_bytes: 222,
          preview_text: 'Model A felt cinematic while Model B stayed technical.',
          metadata_json: '{}',
          created_at: '2026-04-10T12:05:00.000Z',
        },
        {
          id: 'abd100aa',
          user_id: 'mixed-assets-user',
          folder_id: 'f01da123',
          r2_key: 'users/mixed-assets-user/folders/launches/text/snd100.mp3',
          title: 'Launch Loop',
          file_name: 'launch-loop.mp3',
          source_module: 'text',
          mime_type: 'audio/mpeg',
          size_bytes: 204800,
          preview_text: 'A short launch loop stored beside the shared assets.',
          metadata_json: '{}',
          created_at: '2026-04-10T12:06:00.000Z',
        },
      ],
      userImages: {
        'users/mixed-assets-user/folders/launches/text/txt100.txt': {
          body: new TextEncoder().encode('Compare Notes').buffer,
          httpMetadata: { contentType: 'text/plain; charset=utf-8' },
        },
        'users/mixed-assets-user/folders/launches/text/snd100.mp3': {
          body: new TextEncoder().encode('mock-audio').buffer,
          httpMetadata: { contentType: 'audio/mpeg' },
        },
        'users/mixed-assets-user/derivatives/v1/1ab100cd/thumb.webp': {
          body: new TextEncoder().encode('thumb').buffer,
          httpMetadata: { contentType: 'image/webp' },
        },
        'users/mixed-assets-user/derivatives/v1/1ab100cd/medium.webp': {
          body: new TextEncoder().encode('medium').buffer,
          httpMetadata: { contentType: 'image/webp' },
        },
      },
    });

    const token = await seedSession(env, 'mixed-assets-user');
    const listRes = await authWorker.fetch(
      authJsonRequest('/api/ai/assets?folder_id=f01da123', 'GET', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.ok).toBe(true);
    expect(listBody.data.assets).toEqual([
      expect.objectContaining({
        id: 'abd100aa',
        asset_type: 'sound',
        file_url: '/api/ai/text-assets/abd100aa/file',
      }),
      expect.objectContaining({
        id: 'abc100ef',
        asset_type: 'text',
        file_url: '/api/ai/text-assets/abc100ef/file',
      }),
      expect.objectContaining({
        id: '1ab100cd',
        asset_type: 'image',
        file_url: '/api/ai/images/1ab100cd/file',
        original_url: '/api/ai/images/1ab100cd/file',
        thumb_url: '/api/ai/images/1ab100cd/thumb',
        medium_url: '/api/ai/images/1ab100cd/medium',
        derivatives_status: 'ready',
        visibility: 'private',
        is_public: false,
        published_at: null,
      }),
    ]);

    const fileRes = await authWorker.fetch(
      authJsonRequest('/api/ai/text-assets/abc100ef/file', 'GET', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(fileRes.status).toBe(200);
    expect(await fileRes.text()).toBe('Compare Notes');
    expect(fileRes.headers.get('content-type')).toContain('text/plain');
  });

  test('owner can publish and unpublish their own saved image asset without changing ownership or folder state', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'mempic-owner', role: 'user' })],
      aiImages: [
        {
          id: 'abc123ef',
          user_id: 'mempic-owner',
          folder_id: 'fold1000',
          r2_key: 'users/mempic-owner/folders/launch/abc123ef.png',
          prompt: 'Private image',
          model: '@cf/test-model',
          steps: 4,
          seed: 7,
          created_at: '2026-04-10T10:00:00.000Z',
          visibility: 'private',
          published_at: null,
          derivatives_status: 'ready',
          derivatives_version: 1,
          thumb_key: 'users/mempic-owner/derivatives/v1/abc123ef/thumb.webp',
          medium_key: 'users/mempic-owner/derivatives/v1/abc123ef/medium.webp',
          thumb_mime_type: 'image/webp',
          medium_mime_type: 'image/webp',
          thumb_width: 320,
          thumb_height: 320,
          medium_width: 1280,
          medium_height: 1280,
        },
      ],
      userImages: {
        'users/mempic-owner/folders/launch/abc123ef.png': {
          body: ONE_PIXEL_PNG_BYTES.buffer.slice(0),
          httpMetadata: { contentType: 'image/png' },
        },
        'users/mempic-owner/derivatives/v1/abc123ef/thumb.webp': {
          body: new TextEncoder().encode('thumb').buffer,
          httpMetadata: { contentType: 'image/webp' },
        },
        'users/mempic-owner/derivatives/v1/abc123ef/medium.webp': {
          body: new TextEncoder().encode('medium').buffer,
          httpMetadata: { contentType: 'image/webp' },
        },
      },
    });

    const token = await seedSession(env, 'mempic-owner');

    const publishRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/abc123ef/publication', 'PATCH', {
        visibility: 'public',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(publishRes.status).toBe(200);
    await expect(publishRes.json()).resolves.toMatchObject({
      ok: true,
      data: {
        id: 'abc123ef',
        visibility: 'public',
        is_public: true,
        published_at: expect.any(String),
      },
    });
    expect(env.DB.state.aiImages[0]).toMatchObject({
      id: 'abc123ef',
      user_id: 'mempic-owner',
      folder_id: 'fold1000',
      visibility: 'public',
    });
    expect(typeof env.DB.state.aiImages[0].published_at).toBe('string');

    const publicFileRes = await authWorker.fetch(
      new Request('https://bitbi.ai/api/gallery/mempics/abc123ef/file'),
      env,
      createExecutionContext().execCtx
    );
    expect(publicFileRes.status).toBe(200);
    expect(publicFileRes.headers.get('cache-control')).toBe('no-store');

    const unpublishRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/abc123ef/publication', 'PATCH', {
        visibility: 'private',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(unpublishRes.status).toBe(200);
    await expect(unpublishRes.json()).resolves.toMatchObject({
      ok: true,
      data: {
        id: 'abc123ef',
        visibility: 'private',
        is_public: false,
        published_at: null,
      },
    });
    expect(env.DB.state.aiImages[0]).toMatchObject({
      id: 'abc123ef',
      user_id: 'mempic-owner',
      folder_id: 'fold1000',
      visibility: 'private',
      published_at: null,
    });

    const hiddenRes = await authWorker.fetch(
      new Request('https://bitbi.ai/api/gallery/mempics/abc123ef/file'),
      env,
      createExecutionContext().execCtx
    );
    expect(hiddenRes.status).toBe(404);
  });

  test('non-owner cannot publish or unpublish another user’s saved image asset', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        createContractUser({ id: 'mempic-owner', role: 'user' }),
        createContractUser({ id: 'mempic-other', role: 'user' }),
      ],
      aiImages: [
        {
          id: 'f00dbeef',
          user_id: 'mempic-owner',
          folder_id: null,
          r2_key: 'users/mempic-owner/folders/unsorted/f00dbeef.png',
          prompt: 'Owner image',
          model: '@cf/test-model',
          steps: 4,
          seed: 9,
          created_at: '2026-04-10T09:00:00.000Z',
          visibility: 'public',
          published_at: '2026-04-10T09:30:00.000Z',
        },
      ],
    });

    const token = await seedSession(env, 'mempic-other');

    const publishRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/f00dbeef/publication', 'PATCH', {
        visibility: 'public',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(publishRes.status).toBe(404);

    const unpublishRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/f00dbeef/publication', 'PATCH', {
        visibility: 'private',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(unpublishRes.status).toBe(404);
    expect(env.DB.state.aiImages[0]).toMatchObject({
      id: 'f00dbeef',
      user_id: 'mempic-owner',
      visibility: 'public',
      published_at: '2026-04-10T09:30:00.000Z',
    });
  });

  test('public Mempics listing returns only explicitly published ready images and exposes only safe public fields', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        createContractUser({ id: 'artist-a', role: 'user' }),
        createContractUser({ id: 'artist-b', role: 'user' }),
      ],
      profiles: [
        {
          user_id: 'artist-a',
          display_name: 'Ada Member',
          bio: '',
          website: '',
          youtube_url: '',
          created_at: '2026-04-01T00:00:00.000Z',
          updated_at: '2026-04-01T00:00:00.000Z',
        },
      ],
      aiImages: [
        {
          id: 'a1b2c3d4',
          user_id: 'artist-a',
          folder_id: 'foldpub1',
          r2_key: 'users/artist-a/folders/public/a1b2c3d4.png',
          prompt: 'Should stay private',
          model: '@cf/test-model',
          steps: 4,
          seed: 1,
          created_at: '2026-04-09T09:00:00.000Z',
          visibility: 'public',
          published_at: '2026-04-10T09:00:00.000Z',
          derivatives_status: 'ready',
          derivatives_version: 1,
          thumb_key: 'users/artist-a/derivatives/v1/a1b2c3d4/thumb.webp',
          medium_key: 'users/artist-a/derivatives/v1/a1b2c3d4/medium.webp',
          thumb_width: 320,
          thumb_height: 256,
          medium_width: 1280,
          medium_height: 1024,
        },
        {
          id: 'c0ffee12',
          user_id: 'artist-b',
          folder_id: null,
          r2_key: 'users/artist-b/folders/unsorted/c0ffee12.png',
          prompt: 'Should not show as file name',
          model: '@cf/test-model',
          steps: 4,
          seed: 9,
          created_at: '2026-04-08T08:00:00.000Z',
          visibility: 'public',
          published_at: '2026-04-08T09:00:00.000Z',
          derivatives_status: 'ready',
          derivatives_version: 1,
          thumb_key: 'users/artist-b/derivatives/v1/c0ffee12/thumb.webp',
          medium_key: 'users/artist-b/derivatives/v1/c0ffee12/medium.webp',
          thumb_width: 320,
          thumb_height: 320,
          medium_width: 1280,
          medium_height: 1280,
        },
        {
          id: '0f1e2d3c',
          user_id: 'artist-a',
          folder_id: null,
          r2_key: 'users/artist-a/folders/unsorted/0f1e2d3c.png',
          prompt: 'Private prompt',
          model: '@cf/test-model',
          steps: 4,
          seed: 2,
          created_at: '2026-04-10T10:00:00.000Z',
          visibility: 'private',
          published_at: null,
          derivatives_status: 'ready',
          derivatives_version: 1,
          thumb_key: 'users/artist-a/derivatives/v1/0f1e2d3c/thumb.webp',
          medium_key: 'users/artist-a/derivatives/v1/0f1e2d3c/medium.webp',
          thumb_width: 320,
          thumb_height: 320,
          medium_width: 1280,
          medium_height: 1280,
        },
        {
          id: 'bead5678',
          user_id: 'artist-b',
          folder_id: null,
          r2_key: 'users/artist-b/folders/unsorted/bead5678.png',
          prompt: 'Pending prompt',
          model: '@cf/test-model',
          steps: 4,
          seed: 3,
          created_at: '2026-04-11T10:00:00.000Z',
          visibility: 'public',
          published_at: '2026-04-11T11:00:00.000Z',
          derivatives_status: 'pending',
          derivatives_version: 1,
        },
      ],
    });

    const listRes = await authWorker.fetch(
      new Request('https://bitbi.ai/api/gallery/mempics?limit=10'),
      env,
      createExecutionContext().execCtx
    );

    expect(listRes.status).toBe(200);
    const body = await listRes.json();
    expect(body).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            id: 'a1b2c3d4',
            slug: 'mempic-a1b2c3d4',
            title: 'Mempics',
            caption: 'Published by Ada Member on 2026-04-10.',
            category: 'mempics',
            thumb: {
              url: '/api/gallery/mempics/a1b2c3d4/thumb',
              w: 320,
              h: 256,
            },
            preview: {
              url: '/api/gallery/mempics/a1b2c3d4/medium',
              w: 1280,
              h: 1024,
            },
            full: {
              url: '/api/gallery/mempics/a1b2c3d4/file',
            },
          },
          {
            id: 'c0ffee12',
            slug: 'mempic-c0ffee12',
            title: 'Mempics',
            caption: 'Published by a bitbi member on 2026-04-08.',
            category: 'mempics',
            thumb: {
              url: '/api/gallery/mempics/c0ffee12/thumb',
              w: 320,
              h: 320,
            },
            preview: {
              url: '/api/gallery/mempics/c0ffee12/medium',
              w: 1280,
              h: 1280,
            },
            full: {
              url: '/api/gallery/mempics/c0ffee12/file',
            },
          },
        ],
      },
    });
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items[0].prompt).toBeUndefined();
    expect(body.data.items[0].user_id).toBeUndefined();
    expect(body.data.items[0].folder_id).toBeUndefined();
    expect(body.data.items[0].r2_key).toBeUndefined();
    expect(body.data.items[1].prompt).toBeUndefined();
    expect(body.data.items[1].user_id).toBeUndefined();
    expect(body.data.items[1].folder_id).toBeUndefined();
    expect(body.data.items[1].r2_key).toBeUndefined();
  });

  function createSharedBulkMoveEnv() {
    return createAuthTestEnv({
      users: [createContractUser({ id: 'bulk-move-user', role: 'user' })],
      aiFolders: [
        {
          id: 'f01daaab',
          user_id: 'bulk-move-user',
          name: 'Research',
          slug: 'research',
          status: 'active',
          created_at: nowIso(),
        },
      ],
      aiImages: [
        {
          id: '1ab100cd',
          user_id: 'bulk-move-user',
          folder_id: null,
          r2_key: 'users/bulk-move-user/folders/unsorted/original.png',
          prompt: 'Shared poster',
          model: '@cf/test-model',
          steps: 4,
          seed: 1,
          created_at: nowIso(),
        },
      ],
      aiTextAssets: [
        {
          id: 'abc100ef',
          user_id: 'bulk-move-user',
          folder_id: null,
          r2_key: 'users/bulk-move-user/folders/unsorted/text.txt',
          title: 'Prompt Notes',
          file_name: 'prompt-notes.txt',
          source_module: 'text',
          mime_type: 'text/plain; charset=utf-8',
          size_bytes: 120,
          preview_text: 'Prompt notes',
          metadata_json: '{}',
          created_at: nowIso(),
        },
        {
          id: 'abd100aa',
          user_id: 'bulk-move-user',
          folder_id: null,
          r2_key: 'users/bulk-move-user/folders/unsorted/loop.mp3',
          title: 'Concept Loop',
          file_name: 'concept-loop.mp3',
          source_module: 'text',
          mime_type: 'audio/mpeg',
          size_bytes: 204800,
          preview_text: 'Concept loop',
          metadata_json: '{}',
          created_at: nowIso(),
        },
      ],
    });
  }

  function createSharedBulkDeleteEnv() {
    return createAuthTestEnv({
      users: [createContractUser({ id: 'bulk-delete-user', role: 'user' })],
      aiImages: [
        {
          id: '1ab100cd',
          user_id: 'bulk-delete-user',
          folder_id: null,
          r2_key: 'users/bulk-delete-user/folders/unsorted/original.png',
          prompt: 'Shared poster',
          model: '@cf/test-model',
          steps: 4,
          seed: 1,
          created_at: nowIso(),
          thumb_key: 'users/bulk-delete-user/derivatives/v1/1ab100cd/thumb.webp',
          medium_key: 'users/bulk-delete-user/derivatives/v1/1ab100cd/medium.webp',
          derivatives_status: 'ready',
          derivatives_version: 1,
        },
      ],
      aiTextAssets: [
        {
          id: 'abc100ef',
          user_id: 'bulk-delete-user',
          folder_id: null,
          r2_key: 'users/bulk-delete-user/folders/unsorted/text.txt',
          title: 'Prompt Notes',
          file_name: 'prompt-notes.txt',
          source_module: 'text',
          mime_type: 'text/plain; charset=utf-8',
          size_bytes: 120,
          preview_text: 'Prompt notes',
          metadata_json: '{}',
          created_at: nowIso(),
        },
        {
          id: 'abd100aa',
          user_id: 'bulk-delete-user',
          folder_id: null,
          r2_key: 'users/bulk-delete-user/folders/unsorted/loop.mp3',
          title: 'Concept Loop',
          file_name: 'concept-loop.mp3',
          source_module: 'text',
          mime_type: 'audio/mpeg',
          size_bytes: 204800,
          preview_text: 'Concept loop',
          metadata_json: '{}',
          created_at: nowIso(),
        },
      ],
      userImages: {
        'users/bulk-delete-user/folders/unsorted/original.png': {
          body: new TextEncoder().encode('original').buffer,
          httpMetadata: { contentType: 'image/png' },
        },
        'users/bulk-delete-user/derivatives/v1/1ab100cd/thumb.webp': {
          body: new TextEncoder().encode('thumb').buffer,
          httpMetadata: { contentType: 'image/webp' },
        },
        'users/bulk-delete-user/derivatives/v1/1ab100cd/medium.webp': {
          body: new TextEncoder().encode('medium').buffer,
          httpMetadata: { contentType: 'image/webp' },
        },
        'users/bulk-delete-user/folders/unsorted/text.txt': {
          body: new TextEncoder().encode('notes').buffer,
          httpMetadata: { contentType: 'text/plain; charset=utf-8' },
        },
        'users/bulk-delete-user/folders/unsorted/loop.mp3': {
          body: new TextEncoder().encode('audio').buffer,
          httpMetadata: { contentType: 'audio/mpeg' },
        },
      },
    });
  }

  async function runSharedBulkMoveRequest(assetIds, folderId = 'f01daaab') {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createSharedBulkMoveEnv();
    const token = await seedSession(env, 'bulk-move-user');
    const response = await authWorker.fetch(
      authJsonRequest('/api/ai/assets/bulk-move', 'PATCH', {
        asset_ids: assetIds,
        folder_id: folderId,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );
    return { env, response };
  }

  async function runSharedBulkDeleteRequest(assetIds) {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createSharedBulkDeleteEnv();
    const token = await seedSession(env, 'bulk-delete-user');
    const response = await authWorker.fetch(
      authJsonRequest('/api/ai/assets/bulk-delete', 'POST', {
        asset_ids: assetIds,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );
    return { env, response };
  }

  test('AI assets bulk move updates one image through the shared route', async () => {
    const { env, response } = await runSharedBulkMoveRequest(['1ab100cd']);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { moved: 1 },
    });
    expect(env.DB.state.aiImages.find((row) => row.id === '1ab100cd').folder_id).toBe('f01daaab');
    expect(env.DB.state.aiTextAssets.find((row) => row.id === 'abc100ef').folder_id).toBeNull();
    expect(env.DB.state.aiTextAssets.find((row) => row.id === 'abd100aa').folder_id).toBeNull();
  });

  test('AI assets bulk move updates one text asset through the shared route', async () => {
    const { env, response } = await runSharedBulkMoveRequest(['abc100ef']);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { moved: 1 },
    });
    expect(env.DB.state.aiImages.find((row) => row.id === '1ab100cd').folder_id).toBeNull();
    expect(env.DB.state.aiTextAssets.find((row) => row.id === 'abc100ef').folder_id).toBe('f01daaab');
    expect(env.DB.state.aiTextAssets.find((row) => row.id === 'abd100aa').folder_id).toBeNull();
  });

  test('AI assets bulk move updates mixed image and file assets in one shared folder flow', async () => {
    const { env, response } = await runSharedBulkMoveRequest(['1ab100cd', 'abc100ef', 'abd100aa']);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { moved: 3 },
    });
    expect(env.DB.state.aiImages.find((row) => row.id === '1ab100cd').folder_id).toBe('f01daaab');
    expect(env.DB.state.aiTextAssets.find((row) => row.id === 'abc100ef').folder_id).toBe('f01daaab');
    expect(env.DB.state.aiTextAssets.find((row) => row.id === 'abd100aa').folder_id).toBe('f01daaab');
  });

  test('AI assets bulk move rejects missing asset IDs in the shared route', async () => {
    const { env, response } = await runSharedBulkMoveRequest(['1ab100cd', 'ffff0000']);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'One or more assets not found.',
    });
    expect(env.DB.state.aiImages.find((row) => row.id === '1ab100cd').folder_id).toBeNull();
    expect(env.DB.state.aiTextAssets.find((row) => row.id === 'abc100ef').folder_id).toBeNull();
  });

  test('AI assets bulk delete removes one image through the shared route', async () => {
    const { env, response } = await runSharedBulkDeleteRequest(['1ab100cd']);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { deleted: 1 },
    });
    expect(env.DB.state.aiImages.find((row) => row.id === '1ab100cd')).toBeUndefined();
    expect(env.DB.state.aiTextAssets.find((row) => row.id === 'abc100ef')).toBeTruthy();
    expect(env.DB.state.aiTextAssets.find((row) => row.id === 'abd100aa')).toBeTruthy();
    expect(env.DB.state.r2CleanupQueue).toHaveLength(0);
    expect(env.USER_IMAGES.objects.size).toBe(2);
  });

  test('AI assets bulk delete removes one text asset through the shared route', async () => {
    const { env, response } = await runSharedBulkDeleteRequest(['abc100ef']);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { deleted: 1 },
    });
    expect(env.DB.state.aiImages.find((row) => row.id === '1ab100cd')).toBeTruthy();
    expect(env.DB.state.aiTextAssets.find((row) => row.id === 'abc100ef')).toBeUndefined();
    expect(env.DB.state.aiTextAssets.find((row) => row.id === 'abd100aa')).toBeTruthy();
    expect(env.DB.state.r2CleanupQueue).toHaveLength(0);
    expect(env.USER_IMAGES.objects.size).toBe(4);
  });

  test('AI assets bulk delete removes mixed image and file assets with shared cleanup', async () => {
    const { env, response } = await runSharedBulkDeleteRequest(['1ab100cd', 'abc100ef', 'abd100aa']);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { deleted: 3 },
    });
    expect(env.DB.state.aiImages).toHaveLength(0);
    expect(env.DB.state.aiTextAssets).toHaveLength(0);
    expect(env.DB.state.r2CleanupQueue).toHaveLength(0);
    expect(env.USER_IMAGES.objects.size).toBe(0);
  });

  test('AI assets bulk delete rejects missing asset IDs in the shared route', async () => {
    const { env, response } = await runSharedBulkDeleteRequest(['abc100ef', 'ffff0000']);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'One or more assets not found.',
    });
    expect(env.DB.state.aiImages.find((row) => row.id === '1ab100cd')).toBeTruthy();
    expect(env.DB.state.aiTextAssets.find((row) => row.id === 'abc100ef')).toBeTruthy();
    expect(env.DB.state.r2CleanupQueue).toHaveLength(0);
    expect(env.USER_IMAGES.objects.size).toBe(5);
  });

  test('AI image thumb and medium routes preserve auth and ownership checks', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        createContractUser({ id: 'owner-user', role: 'user' }),
        createContractUser({ id: 'other-user', role: 'user' }),
      ],
      aiImages: [
        {
          id: 'ab11cd22',
          user_id: 'owner-user',
          folder_id: null,
          r2_key: 'users/owner-user/folders/unsorted/original.png',
          prompt: 'Protected derivative image',
          model: '@cf/test-model',
          steps: 4,
          seed: 9,
          created_at: nowIso(),
          thumb_key: 'users/owner-user/derivatives/v1/ab11cd22/thumb.webp',
          medium_key: 'users/owner-user/derivatives/v1/ab11cd22/medium.webp',
          thumb_mime_type: 'image/webp',
          medium_mime_type: 'image/webp',
          derivatives_status: 'ready',
          derivatives_version: 1,
        },
      ],
      userImages: {
        'users/owner-user/derivatives/v1/ab11cd22/thumb.webp': {
          body: new TextEncoder().encode('thumb-bytes').buffer,
          httpMetadata: { contentType: 'image/webp' },
        },
        'users/owner-user/derivatives/v1/ab11cd22/medium.webp': {
          body: new TextEncoder().encode('medium-bytes').buffer,
          httpMetadata: { contentType: 'image/webp' },
        },
      },
    });

    const ownerToken = await seedSession(env, 'owner-user');
    const otherToken = await seedSession(env, 'other-user');

    const thumbRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/ab11cd22/thumb', 'GET', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${ownerToken}`,
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(thumbRes.status).toBe(200);
    expect(await thumbRes.text()).toBe('thumb-bytes');
    expect(thumbRes.headers.get('content-type')).toContain('image/webp');

    const mediumRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/ab11cd22/medium', 'GET', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${ownerToken}`,
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(mediumRes.status).toBe(200);
    expect(await mediumRes.text()).toBe('medium-bytes');

    const foreignRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/ab11cd22/thumb', 'GET', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${otherToken}`,
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(foreignRes.status).toBe(404);

    const anonRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/ab11cd22/thumb', 'GET', undefined, {
        Origin: 'https://bitbi.ai',
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(anonRes.status).toBe(401);
  });

  test('AI image thumb on-demand generates derivatives when queue pipeline has not delivered them', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const originalKey = 'users/0de0aabb/folders/unsorted/original.png';
    const env = createAuthTestEnv({
      users: [createContractUser({ id: '0de0aabb', role: 'user' })],
      aiImages: [
        {
          id: '0de00001',
          user_id: '0de0aabb',
          folder_id: null,
          r2_key: originalKey,
          prompt: 'On-demand derivative test',
          model: '@cf/test-model',
          steps: 4,
          seed: 77,
          created_at: nowIso(),
          // No thumb_key, no medium_key — derivatives not generated yet
        },
      ],
      userImages: {
        [originalKey]: {
          body: Buffer.from(ONE_PIXEL_PNG_DATA_URI.replace('data:image/png;base64,', ''), 'base64'),
          httpMetadata: { contentType: 'image/png' },
        },
      },
    });

    const token = await seedSession(env, '0de0aabb');

    // Request thumb — should trigger on-demand generation and serve the derivative
    const thumbRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/0de00001/thumb', 'GET', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(thumbRes.status).toBe(200);
    expect(thumbRes.headers.get('content-type')).toContain('image/webp');

    // Verify both derivatives were generated and persisted
    const row = env.DB.state.aiImages.find((r) => r.id === '0de00001');
    expect(row.derivatives_status).toBe('ready');
    expect(row.thumb_key).toBeTruthy();
    expect(row.medium_key).toBeTruthy();

    // Subsequent medium request should hit the fast path (already in R2)
    const mediumRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/0de00001/medium', 'GET', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(mediumRes.status).toBe(200);
    expect(mediumRes.headers.get('content-type')).toContain('image/webp');
  });

  test('AI image thumb on-demand fallback is cooled down after a failed inline generation attempt', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const originalKey = 'users/cooloff-user/folders/unsorted/original.png';
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'cooloff-user', role: 'user' })],
      aiImages: [
        {
          id: '0de00002',
          user_id: 'cooloff-user',
          folder_id: null,
          r2_key: originalKey,
          prompt: 'On-demand cooldown test',
          model: '@cf/test-model',
          steps: 4,
          seed: 12,
          created_at: nowIso(),
        },
      ],
      userImages: {
        [originalKey]: {
          body: Buffer.from(ONE_PIXEL_PNG_DATA_URI.replace('data:image/png;base64,', ''), 'base64'),
          httpMetadata: { contentType: 'image/png' },
        },
      },
      imagesBinding: {
        failResponseWith: new Error('Inline derivative transform failure'),
      },
    });

    const token = await seedSession(env, 'cooloff-user');
    const requestHeaders = {
      Origin: 'https://bitbi.ai',
      Cookie: `bitbi_session=${token}`,
    };

    const firstRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/0de00002/thumb', 'GET', undefined, requestHeaders),
      env,
      createExecutionContext().execCtx
    );
    expect(firstRes.status).toBe(404);
    await expect(firstRes.json()).resolves.toMatchObject({
      ok: false,
      error: 'Image preview not ready.',
    });
    expect(env.IMAGES.infoCalls).toHaveLength(1);

    const secondRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/0de00002/thumb', 'GET', undefined, requestHeaders),
      env,
      createExecutionContext().execCtx
    );
    expect(secondRes.status).toBe(404);
    await expect(secondRes.json()).resolves.toMatchObject({
      ok: false,
      error: 'Image preview not ready.',
    });
    expect(env.IMAGES.infoCalls).toHaveLength(1);

    const row = env.DB.state.aiImages.find((item) => item.id === '0de00002');
    expect(row.derivatives_status).toBe('failed');
    expect(row.derivatives_error).toContain('retries exhausted');
  });

  test('scheduled derivative recovery throttles recently attempted rows and skips failed or actively leased work', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const now = Date.now();
    const env = createAuthTestEnv({
      aiImages: [
        {
          id: 'sched-ready',
          user_id: 'recover-user',
          r2_key: 'users/recover-user/folders/unsorted/ready.png',
          created_at: nowIso(),
          thumb_key: 'users/recover-user/derivatives/v1/sched-ready/thumb.webp',
          medium_key: 'users/recover-user/derivatives/v1/sched-ready/medium.webp',
          derivatives_status: 'ready',
          derivatives_version: 1,
        },
        {
          id: 'sched-recent',
          user_id: 'recover-user',
          r2_key: 'users/recover-user/folders/unsorted/recent.png',
          created_at: nowIso(),
          derivatives_status: 'pending',
          derivatives_version: 1,
          derivatives_attempted_at: new Date(now - (5 * 60 * 1000)).toISOString(),
        },
        {
          id: 'sched-old',
          user_id: 'recover-user',
          r2_key: 'users/recover-user/folders/unsorted/old.png',
          created_at: nowIso(),
          derivatives_status: 'pending',
          derivatives_version: 1,
          derivatives_attempted_at: new Date(now - (60 * 60 * 1000)).toISOString(),
        },
        {
          id: 'sched-never',
          user_id: 'recover-user',
          r2_key: 'users/recover-user/folders/unsorted/never.png',
          created_at: nowIso(),
          derivatives_status: 'pending',
          derivatives_version: 1,
        },
        {
          id: 'sched-failed',
          user_id: 'recover-user',
          r2_key: 'users/recover-user/folders/unsorted/failed.png',
          created_at: nowIso(),
          derivatives_status: 'failed',
          derivatives_version: 1,
          derivatives_attempted_at: new Date(now - (2 * 60 * 60 * 1000)).toISOString(),
        },
        {
          id: 'sched-processing',
          user_id: 'recover-user',
          r2_key: 'users/recover-user/folders/unsorted/processing.png',
          created_at: nowIso(),
          derivatives_status: 'processing',
          derivatives_version: 1,
          derivatives_attempted_at: new Date(now - (60 * 60 * 1000)).toISOString(),
          derivatives_lease_expires_at: new Date(now + (10 * 60 * 1000)).toISOString(),
        },
      ],
    });

    await authWorker.scheduled({}, env, createExecutionContext().execCtx);

    expect(env.AI_IMAGE_DERIVATIVES_QUEUE.messages.map((message) => message.image_id).sort()).toEqual([
      'sched-never',
      'sched-old',
    ]);
  });

  test('scheduled R2 cleanup deletes successful keys and retries failed ones without dropping them', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      userImages: {
        'cleanup/good.webp': {
          body: new TextEncoder().encode('good').buffer,
        },
        'cleanup/bad.webp': {
          body: new TextEncoder().encode('bad').buffer,
          failDelete: true,
        },
      },
      r2CleanupQueue: [
        {
          id: 1,
          r2_key: 'cleanup/good.webp',
          status: 'pending',
          created_at: nowIso(),
          attempts: 0,
          last_attempt_at: null,
        },
        {
          id: 2,
          r2_key: 'cleanup/bad.webp',
          status: 'pending',
          created_at: nowIso(),
          attempts: 0,
          last_attempt_at: null,
        },
      ],
    });

    await authWorker.scheduled({}, env, createExecutionContext().execCtx);

    expect(env.USER_IMAGES.objects.has('cleanup/good.webp')).toBe(false);
    expect(env.USER_IMAGES.objects.has('cleanup/bad.webp')).toBe(true);
    expect(env.DB.state.r2CleanupQueue.find((row) => row.id === 1)).toBeUndefined();
    expect(env.DB.state.r2CleanupQueue.find((row) => row.id === 2)).toMatchObject({
      status: 'pending',
      attempts: 1,
    });
  });

  test('scheduled R2 cleanup dead-letters only entries that actually exhausted retries', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      r2CleanupQueue: [
        {
          id: 1,
          r2_key: 'cleanup/exhausted.webp',
          status: 'pending',
          created_at: nowIso(),
          attempts: 5,
          last_attempt_at: new Date(Date.now() - 60_000).toISOString(),
        },
        {
          id: 2,
          r2_key: 'cleanup/not-yet.webp',
          status: 'pending',
          created_at: nowIso(),
          attempts: 5,
          last_attempt_at: null,
        },
      ],
    });

    await authWorker.scheduled({}, env, createExecutionContext().execCtx);

    expect(env.DB.state.r2CleanupQueue.find((row) => row.id === 1)).toMatchObject({
      status: 'dead',
      attempts: 5,
    });
    expect(env.DB.state.r2CleanupQueue.find((row) => row.id === 2)).toMatchObject({
      status: 'pending',
      attempts: 5,
      last_attempt_at: null,
    });
  });

  test('IMAGES binding mock matches Cloudflare ImageTransformationResult contract', async () => {
    // Validates the shape that caused two successive live errors:
    // 1. .response() called on Promise → TypeError: .response is not a function
    // 2. Awaited Promise gave ImageTransformationResult (not Response) → "invalid result"
    // Correct: await .output() → ImageTransformationResult → .response() → Response
    const { MockImagesBinding } = require('./helpers/auth-worker-harness.js');
    const images = new MockImagesBinding();

    const inputBytes = new TextEncoder().encode('mock-image:512x512:image/png');
    const outputPromise = images.input(inputBytes)
      .transform({ width: 320, height: 320, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: 82 });

    // .output() returns a Promise (not a synchronous builder)
    expect(typeof outputPromise.then).toBe('function');

    // Awaiting gives an ImageTransformationResult, NOT a bare Response
    const transformResult = await outputPromise;
    expect(transformResult).not.toBeInstanceOf(Response);

    // ImageTransformationResult exposes .response(), .image(), .contentType()
    expect(typeof transformResult.response).toBe('function');
    expect(typeof transformResult.image).toBe('function');
    expect(typeof transformResult.contentType).toBe('function');

    // .response() returns a standard Response
    const response = transformResult.response();
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get('content-type')).toBe('image/webp');

    const body = await response.text();
    expect(body).toContain('mock-image:');
    expect(body).toContain('image/webp');

    // .contentType() returns the format string
    expect(transformResult.contentType()).toBe('image/webp');

    // .image() returns a ReadableStream
    const stream = transformResult.image();
    expect(typeof stream.getReader).toBe('function');

    // Transform call was tracked
    expect(images.transformCalls.length).toBe(1);
    expect(images.transformCalls[0].transforms[0].width).toBe(320);
  });

  test('admin AI derivative backfill only enqueues assets that still need current work', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [createAdminUser('admin-derivative-backfill')],
      aiImages: [
        {
          id: 'ready111',
          user_id: 'admin-derivative-backfill',
          folder_id: null,
          r2_key: 'users/admin-derivative-backfill/folders/unsorted/ready.png',
          prompt: 'Ready image',
          model: '@cf/test-model',
          steps: 4,
          seed: 1,
          created_at: '2026-04-10T12:05:00.000Z',
          thumb_key: 'users/admin-derivative-backfill/derivatives/v1/ready111/thumb.webp',
          medium_key: 'users/admin-derivative-backfill/derivatives/v1/ready111/medium.webp',
          derivatives_status: 'ready',
          derivatives_version: 1,
        },
        {
          id: 'older222',
          user_id: 'admin-derivative-backfill',
          folder_id: null,
          r2_key: 'users/admin-derivative-backfill/folders/unsorted/older.png',
          prompt: 'Older derivative set',
          model: '@cf/test-model',
          steps: 4,
          seed: 2,
          created_at: '2026-04-10T12:04:00.000Z',
          thumb_key: 'users/admin-derivative-backfill/derivatives/v0/older222/thumb.webp',
          medium_key: 'users/admin-derivative-backfill/derivatives/v0/older222/medium.webp',
          derivatives_status: 'ready',
          derivatives_version: 0,
        },
        {
          id: 'pending333',
          user_id: 'admin-derivative-backfill',
          folder_id: null,
          r2_key: 'users/admin-derivative-backfill/folders/unsorted/pending.png',
          prompt: 'Pending derivative set',
          model: '@cf/test-model',
          steps: 4,
          seed: 3,
          created_at: '2026-04-10T12:03:00.000Z',
          derivatives_status: 'pending',
          derivatives_version: 1,
        },
        {
          id: 'failed444',
          user_id: 'admin-derivative-backfill',
          folder_id: null,
          r2_key: 'users/admin-derivative-backfill/folders/unsorted/failed.png',
          prompt: 'Failed derivative set',
          model: '@cf/test-model',
          steps: 4,
          seed: 4,
          created_at: '2026-04-10T12:02:00.000Z',
          derivatives_status: 'failed',
          derivatives_version: 1,
        },
        {
          id: 'active555',
          user_id: 'admin-derivative-backfill',
          folder_id: null,
          r2_key: 'users/admin-derivative-backfill/folders/unsorted/processing.png',
          prompt: 'Active processing lease',
          model: '@cf/test-model',
          steps: 4,
          seed: 5,
          created_at: '2026-04-10T12:01:00.000Z',
          derivatives_status: 'processing',
          derivatives_version: 1,
          derivatives_lease_expires_at: '2099-01-01T00:00:00.000Z',
        },
      ],
    });

    const token = await seedSession(env, 'admin-derivative-backfill');
    const res = await authWorker.fetch(
      authJsonRequest('/api/admin/ai/image-derivatives/backfill', 'POST', {
        limit: 10,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'CF-Connecting-IP': '203.0.113.40',
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      data: {
        scanned: 3,
        enqueued: 3,
        derivatives_version: 1,
      },
    });
    expect(env.AI_IMAGE_DERIVATIVES_QUEUE.messages.map((message) => message.image_id)).toEqual([
      'older222',
      'pending333',
      'failed444',
    ]);
  });

  test('AI generate: concurrent near-limit requests do not exceed the daily cap', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    let firstRunStartedResolve;
    let releaseFirstRunResolve;
    const firstRunStarted = new Promise((resolve) => {
      firstRunStartedResolve = resolve;
    });
    const releaseFirstRun = new Promise((resolve) => {
      releaseFirstRunResolve = resolve;
    });
    let aiCalls = 0;

    const env = createAuthTestEnv({
      users: [
        {
          id: 'quota-user',
          email: 'quota@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      aiDailyQuotaUsage: makeConsumedQuotaUsage('quota-user', 9),
      aiRun: async () => {
        aiCalls += 1;
        if (aiCalls === 1) {
          firstRunStartedResolve();
          await releaseFirstRun;
        }
        return { image: ONE_PIXEL_PNG_DATA_URI };
      },
    });

    const token = await seedSession(env, 'quota-user');
    const requestHeaders = {
      Origin: 'https://bitbi.ai',
      Cookie: `bitbi_session=${token}`,
    };

    const firstPromise = authWorker.fetch(
      authJsonRequest('/api/ai/generate-image', 'POST', {
        prompt: 'first request',
        steps: 4,
      }, requestHeaders),
      env,
      createExecutionContext().execCtx
    );

    await firstRunStarted;

    const secondRes = await authWorker.fetch(
      authJsonRequest('/api/ai/generate-image', 'POST', {
        prompt: 'second request',
        steps: 4,
      }, requestHeaders),
      env,
      createExecutionContext().execCtx
    );

    expect(secondRes.status).toBe(429);
    await expect(secondRes.json()).resolves.toMatchObject({
      ok: false,
      code: 'DAILY_IMAGE_LIMIT_REACHED',
    });

    releaseFirstRunResolve();
    const firstRes = await firstPromise;

    expect(firstRes.status).toBe(200);
    await expect(firstRes.json()).resolves.toMatchObject({
      ok: true,
      data: { model: '@cf/black-forest-labs/flux-1-schnell' },
    });
    expect(env.DB.state.aiDailyQuotaUsage.filter((row) => row.user_id === 'quota-user')).toHaveLength(10);
    expect(
      env.DB.state.aiDailyQuotaUsage.filter((row) => row.user_id === 'quota-user' && row.status === 'reserved')
    ).toHaveLength(0);
    expect(env.DB.state.aiGenerationLog.filter((row) => row.user_id === 'quota-user')).toHaveLength(1);
  });

  test('AI generate: failed model runs return a sanitized top-level error and do not permanently consume quota', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'quota-fail-user',
          email: 'quota-fail@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      aiDailyQuotaUsage: makeConsumedQuotaUsage('quota-fail-user', 9),
      aiRun: async () => {
        throw new Error('model failure');
      },
    });

    const token = await seedSession(env, 'quota-fail-user');
    const res = await authWorker.fetch(
      authJsonRequest('/api/ai/generate-image', 'POST', {
        prompt: 'will fail',
        steps: 4,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(502);
    expect(res.headers.get('x-bitbi-correlation-id')).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Image generation failed.',
    });
    expect(env.DB.state.aiDailyQuotaUsage.filter((row) => row.user_id === 'quota-fail-user')).toHaveLength(9);
    expect(
      env.DB.state.aiDailyQuotaUsage.filter((row) => row.user_id === 'quota-fail-user' && row.status === 'reserved')
    ).toHaveLength(0);
    expect(env.DB.state.aiGenerationLog.filter((row) => row.user_id === 'quota-fail-user')).toHaveLength(0);
  });

  test('AI generate: admin users remain exempt from the daily quota', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'quota-admin',
          email: 'quota-admin@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'admin',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      aiDailyQuotaUsage: makeConsumedQuotaUsage('quota-admin', 10),
      aiRun: async () => ({ image: ONE_PIXEL_PNG_DATA_URI }),
    });

    const token = await seedSession(env, 'quota-admin');
    const res = await authWorker.fetch(
      authJsonRequest('/api/ai/generate-image', 'POST', {
        prompt: 'admin request',
        steps: 4,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      data: { model: '@cf/black-forest-labs/flux-1-schnell' },
    });
    expect(env.DB.state.aiDailyQuotaUsage.filter((row) => row.user_id === 'quota-admin')).toHaveLength(10);
    expect(env.DB.state.aiGenerationLog.filter((row) => row.user_id === 'quota-admin')).toHaveLength(1);
  });

  test('AI single delete keeps a durable cleanup entry when inline blob deletion fails', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'artist-2',
          email: 'artist2@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      aiImages: [
        {
          id: 'deadbeef',
          user_id: 'artist-2',
          folder_id: null,
          r2_key: 'users/artist-2/folders/unsorted/deadbeef.png',
          prompt: 'existing image',
          model: '@cf/test-model',
          steps: 4,
          seed: null,
          created_at: nowIso(),
        },
      ],
      userImages: {
        'users/artist-2/folders/unsorted/deadbeef.png': {
          body: new Uint8Array([1, 2, 3]).buffer,
          httpMetadata: { contentType: 'image/png' },
          failDelete: true,
        },
      },
    });

    const token = await seedSession(env, 'artist-2');
    const deleteRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/deadbeef', 'DELETE', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(deleteRes.status).toBe(200);
    await expect(deleteRes.json()).resolves.toMatchObject({ ok: true });
    expect(env.DB.state.aiImages).toHaveLength(0);
    expect(env.DB.state.r2CleanupQueue).toHaveLength(1);
    expect(env.DB.state.r2CleanupQueue[0].r2_key).toBe('users/artist-2/folders/unsorted/deadbeef.png');
    expect(env.USER_IMAGES.objects.has('users/artist-2/folders/unsorted/deadbeef.png')).toBe(true);
  });

  test('AI folder delete keeps durable cleanup entries when inline blob deletion fails for mixed assets', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'artist-3',
          email: 'artist3@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      aiFolders: [
        {
          id: 'abc123ef',
          user_id: 'artist-3',
          name: 'Archive',
          slug: 'archive',
          status: 'active',
          created_at: nowIso(),
        },
      ],
      aiImages: [
        {
          id: 'aa11',
          user_id: 'artist-3',
          folder_id: 'abc123ef',
          r2_key: 'users/artist-3/folders/archive/aa11.png',
          prompt: 'one',
          model: '@cf/test-model',
          steps: 4,
          seed: null,
          created_at: nowIso(),
        },
        {
          id: 'bb22',
          user_id: 'artist-3',
          folder_id: 'abc123ef',
          r2_key: 'users/artist-3/folders/archive/bb22.png',
          prompt: 'two',
          model: '@cf/test-model',
          steps: 4,
          seed: null,
          created_at: nowIso(),
        },
      ],
      aiTextAssets: [
        {
          id: 'txt33',
          user_id: 'artist-3',
          folder_id: 'abc123ef',
          r2_key: 'users/artist-3/folders/archive/text/txt33-notes.txt',
          title: 'Compare Notes',
          file_name: 'compare-notes.txt',
          source_module: 'compare',
          mime_type: 'text/plain; charset=utf-8',
          size_bytes: 320,
          preview_text: 'Compare notes preview',
          metadata_json: '{}',
          created_at: nowIso(),
        },
      ],
      userImages: {
        'users/artist-3/folders/archive/aa11.png': {
          body: new Uint8Array([1]).buffer,
          httpMetadata: { contentType: 'image/png' },
          failDelete: true,
        },
        'users/artist-3/folders/archive/bb22.png': {
          body: new Uint8Array([2]).buffer,
          httpMetadata: { contentType: 'image/png' },
          failDelete: true,
        },
        'users/artist-3/folders/archive/text/txt33-notes.txt': {
          body: new TextEncoder().encode('Compare notes').buffer,
          httpMetadata: { contentType: 'text/plain; charset=utf-8' },
          failDelete: true,
        },
      },
    });

    const token = await seedSession(env, 'artist-3');
    const deleteRes = await authWorker.fetch(
      authJsonRequest('/api/ai/folders/abc123ef', 'DELETE', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(deleteRes.status).toBe(200);
    await expect(deleteRes.json()).resolves.toMatchObject({ ok: true });
    expect(env.DB.state.aiFolders).toHaveLength(0);
    expect(env.DB.state.aiImages).toHaveLength(0);
    expect(env.DB.state.aiTextAssets).toHaveLength(0);
    expect(env.DB.state.r2CleanupQueue.map((row) => row.r2_key).sort()).toEqual([
      'users/artist-3/folders/archive/aa11.png',
      'users/artist-3/folders/archive/bb22.png',
      'users/artist-3/folders/archive/text/txt33-notes.txt',
    ]);
    expect(env.USER_IMAGES.objects.has('users/artist-3/folders/archive/aa11.png')).toBe(true);
    expect(env.USER_IMAGES.objects.has('users/artist-3/folders/archive/bb22.png')).toBe(true);
    expect(env.USER_IMAGES.objects.has('users/artist-3/folders/archive/text/txt33-notes.txt')).toBe(true);
  });

  test('contact worker: accepts allowed origin and rejects forbidden origin', async () => {
    const contactWorker = await loadWorker('workers/contact/src/index.js');
    const env = createAuthTestEnv();
    env.RESEND_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    const resendCalls = [];

    global.fetch = async (url, options = {}) => {
      resendCalls.push({ url: String(url), options });
      return new Response(JSON.stringify({ id: 'email-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const okRes = await contactWorker.fetch(
        new Request('https://contact.bitbi.ai/', {
          method: 'POST',
          headers: {
            Origin: 'https://bitbi.ai',
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '203.0.113.12',
          },
          body: JSON.stringify({
            name: 'Visitor',
            email: 'visitor@example.com',
            subject: 'Hello',
            message: 'Testing contact worker',
            website: '',
          }),
        }),
        env
      );

      expect(okRes.status).toBe(200);
      await expect(okRes.json()).resolves.toMatchObject({ ok: true });
      expect(resendCalls).toHaveLength(1);
      expect(resendCalls[0].url).toBe('https://api.resend.com/emails');

      const forbiddenRes = await contactWorker.fetch(
        new Request('https://contact.bitbi.ai/', {
          method: 'POST',
          headers: {
            Origin: 'https://evil.example',
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '203.0.113.13',
          },
          body: JSON.stringify({
            name: 'Bad',
            email: 'bad@example.com',
            subject: 'Blocked',
            message: 'Should not pass',
            website: '',
          }),
        }),
        env
      );

      expect(forbiddenRes.status).toBe(403);
      expect(await forbiddenRes.text()).toBe('Forbidden');
      expect(resendCalls).toHaveLength(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('contact worker: shared limiter blocks abusive submissions before mail send', async () => {
    const contactWorker = await loadWorker('workers/contact/src/index.js');
    const env = createAuthTestEnv({
      rateLimitCounters: [
        makeActiveRateLimitCounter('contact-submit-ip-burst', '203.0.113.77', 3, 10 * 60 * 1000),
      ],
    });
    env.RESEND_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    let resendCallCount = 0;

    global.fetch = async () => {
      resendCallCount += 1;
      return new Response(JSON.stringify({ id: 'email-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const res = await contactWorker.fetch(
        new Request('https://contact.bitbi.ai/', {
          method: 'POST',
          headers: {
            Origin: 'https://bitbi.ai',
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '203.0.113.77',
          },
          body: JSON.stringify({
            name: 'Visitor',
            email: 'visitor@example.com',
            subject: 'Hello',
            message: 'Testing limiter',
            website: '',
          }),
        }),
        env
      );

      expect(res.status).toBe(429);
      await expect(res.json()).resolves.toMatchObject({
        error: 'Too many requests. Please try again later.',
      });
      expect(resendCallCount).toBe(0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('contact worker: burst limiter allows three submissions and blocks the fourth', async () => {
    const contactWorker = await loadWorker('workers/contact/src/index.js');
    const env = createAuthTestEnv();
    env.RESEND_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    let resendCallCount = 0;

    global.fetch = async () => {
      resendCallCount += 1;
      return new Response(JSON.stringify({ id: `email-${resendCallCount}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const res = await contactWorker.fetch(
          new Request('https://contact.bitbi.ai/', {
            method: 'POST',
            headers: {
              Origin: 'https://bitbi.ai',
              'Content-Type': 'application/json',
              'CF-Connecting-IP': '203.0.113.88',
            },
            body: JSON.stringify({
              name: 'Visitor',
              email: 'visitor@example.com',
              subject: `Hello ${attempt}`,
              message: `Attempt ${attempt}`,
              website: '',
            }),
          }),
          env
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toMatchObject({ ok: true });
      }

      const blockedRes = await contactWorker.fetch(
        new Request('https://contact.bitbi.ai/', {
          method: 'POST',
          headers: {
            Origin: 'https://bitbi.ai',
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '203.0.113.88',
          },
          body: JSON.stringify({
            name: 'Visitor',
            email: 'visitor@example.com',
            subject: 'Hello 4',
            message: 'Attempt 4',
            website: '',
          }),
        }),
        env
      );

      expect(blockedRes.status).toBe(429);
      await expect(blockedRes.json()).resolves.toMatchObject({
        error: 'Too many requests. Please try again later.',
      });
      expect(resendCallCount).toBe(3);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('contact worker: upstream provider failures still return a stable 502', async () => {
    const contactWorker = await loadWorker('workers/contact/src/index.js');
    const env = createAuthTestEnv();
    env.RESEND_API_KEY = 'test-key';
    const originalFetch = global.fetch;

    global.fetch = async () => new Response('upstream failed', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

    try {
      const res = await contactWorker.fetch(
        new Request('https://contact.bitbi.ai/', {
          method: 'POST',
          headers: {
            Origin: 'https://bitbi.ai',
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '203.0.113.78',
          },
          body: JSON.stringify({
            name: 'Visitor',
            email: 'visitor@example.com',
            subject: 'Hello',
            message: 'Testing upstream failure',
            website: '',
          }),
        }),
        env
      );

      expect(res.status).toBe(502);
      await expect(res.json()).resolves.toMatchObject({
        error: 'Email send failed',
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('admin delete succeeds for AI-owning users and preserves retained activity history', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'admin-2',
          email: 'admin2@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'admin',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
        {
          id: 'feedface',
          email: 'creator@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      profiles: [
        {
          user_id: 'feedface',
          display_name: 'Creator',
          bio: '',
          website: '',
          youtube_url: '',
          created_at: nowIso(),
          updated_at: nowIso(),
        },
      ],
      favorites: [
        {
          id: 1,
          user_id: 'feedface',
          item_type: 'gallery',
          item_id: 'g-1',
          title: 'Favorite',
          thumb_url: '/thumb.png',
          created_at: nowIso(),
        },
      ],
      aiFolders: [
        {
          id: 'c0ffee12',
          user_id: 'feedface',
          name: 'Projects',
          slug: 'projects',
          status: 'active',
          created_at: nowIso(),
        },
      ],
      aiImages: [
        {
          id: 'ab12cd34',
          user_id: 'feedface',
          folder_id: 'c0ffee12',
          r2_key: 'users/feedface/folders/projects/ab12cd34.png',
          prompt: 'portrait',
          model: '@cf/test-model',
          steps: 4,
          seed: null,
          created_at: nowIso(),
        },
      ],
      aiGenerationLog: [
        {
          id: 'gen-1',
          user_id: 'feedface',
          created_at: nowIso(),
        },
      ],
      userActivityLog: [
        {
          id: 'activity-1',
          user_id: 'feedface',
          action: 'login',
          meta_json: JSON.stringify({ email: 'creator@example.com' }),
          ip_address: '203.0.113.20',
          created_at: nowIso(),
        },
      ],
      userImages: {
        'users/feedface/folders/projects/ab12cd34.png': {
          body: new Uint8Array([7, 8, 9]).buffer,
          httpMetadata: { contentType: 'image/png' },
          failDelete: true,
        },
      },
      privateMedia: {
        'avatars/feedface': {
          body: new Uint8Array([4, 5]).buffer,
          httpMetadata: { contentType: 'image/png' },
        },
      },
    });

    const adminToken = await seedSession(env, 'admin-2');
    const exec = createExecutionContext();
    const res = await authWorker.fetch(
      authJsonRequest('/api/admin/users/feedface', 'DELETE', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${adminToken}`,
        'CF-Connecting-IP': '203.0.113.14',
      }),
      env,
      exec.execCtx
    );
    await exec.flush();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      deletedUserId: 'feedface',
    });
    expect(env.DB.state.users.some((row) => row.id === 'feedface')).toBe(false);
    expect(env.DB.state.profiles.some((row) => row.user_id === 'feedface')).toBe(false);
    expect(env.DB.state.favorites.some((row) => row.user_id === 'feedface')).toBe(false);
    expect(env.DB.state.aiFolders.some((row) => row.user_id === 'feedface')).toBe(false);
    expect(env.DB.state.aiImages.some((row) => row.user_id === 'feedface')).toBe(false);
    expect(env.DB.state.aiGenerationLog.some((row) => row.user_id === 'feedface')).toBe(false);
    expect(env.DB.state.userActivityLog.some((row) => row.user_id === 'feedface')).toBe(true);
    expect(env.DB.state.r2CleanupQueue.map((row) => row.r2_key)).toEqual([
      'users/feedface/folders/projects/ab12cd34.png',
    ]);
    expect(env.USER_IMAGES.objects.has('users/feedface/folders/projects/ab12cd34.png')).toBe(true);
    expect(env.PRIVATE_MEDIA.objects.has('avatars/feedface')).toBe(false);
    expect(env.DB.state.adminAuditLog.at(-1).action).toBe('delete_user');
  });
});
