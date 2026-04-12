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

const ONE_PIXEL_PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uUAAAAASUVORK5CYII=';

async function readMultipartFields(multipart) {
  const response = new Response(multipart.body, {
    headers: {
      'content-type': multipart.contentType,
    },
  });
  const formData = await response.formData();
  return Object.fromEntries(Array.from(formData.entries(), ([key, value]) => [key, String(value)]));
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
      const fields = await readMultipartFields(capturedPayload.multipart);
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
          steps: 5,
          seed: 9876,
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
          steps: null,
          seed: null,
          requestedSize: { width: 768, height: 768 },
          appliedSize: { width: 768, height: 768 },
        }),
      }));
      expect(capturedModelId).toBe('@cf/black-forest-labs/flux-2-dev');
      expect(capturedPayload).toEqual(expect.objectContaining({
        multipart: expect.objectContaining({
          contentType: expect.stringContaining('multipart/form-data'),
          body: expect.anything(),
        }),
      }));
      const fields = await readMultipartFields(capturedPayload.multipart);
      expect(fields).toEqual({
        prompt: 'Admin Dev image experiment.',
        width: '768',
        height: '768',
      });
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
    expect(setCookie).toContain('bitbi_session=');
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
      user: { email: 'member@example.com', role: 'user' },
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
    expect(logoutRes.headers.get('Set-Cookie')).toContain('Max-Age=0');
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

  test('AI assets bulk move updates mixed image and file assets in one shared folder flow', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
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

    const token = await seedSession(env, 'bulk-move-user');
    const moveRes = await authWorker.fetch(
      authJsonRequest('/api/ai/assets/bulk-move', 'PATCH', {
        asset_ids: ['1ab100cd', 'abc100ef', 'abd100aa'],
        folder_id: 'f01daaab',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(moveRes.status).toBe(200);
    await expect(moveRes.json()).resolves.toMatchObject({
      ok: true,
      data: { moved: 3 },
    });
    expect(env.DB.state.aiImages.find((row) => row.id === '1ab100cd').folder_id).toBe('f01daaab');
    expect(env.DB.state.aiTextAssets.find((row) => row.id === 'abc100ef').folder_id).toBe('f01daaab');
    expect(env.DB.state.aiTextAssets.find((row) => row.id === 'abd100aa').folder_id).toBe('f01daaab');
  });

  test('AI assets bulk delete removes mixed image and file assets with shared cleanup', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
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

    const token = await seedSession(env, 'bulk-delete-user');
    const deleteRes = await authWorker.fetch(
      authJsonRequest('/api/ai/assets/bulk-delete', 'POST', {
        asset_ids: ['1ab100cd', 'abc100ef', 'abd100aa'],
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(deleteRes.status).toBe(200);
    await expect(deleteRes.json()).resolves.toMatchObject({
      ok: true,
      data: { deleted: 3 },
    });
    expect(env.DB.state.aiImages).toHaveLength(0);
    expect(env.DB.state.aiTextAssets).toHaveLength(0);
    expect(env.DB.state.r2CleanupQueue).toHaveLength(0);
    expect(env.USER_IMAGES.objects.size).toBe(0);
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

  test('AI generate: failed model runs do not permanently consume quota', async () => {
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
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'Image generation failed: model failure',
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
