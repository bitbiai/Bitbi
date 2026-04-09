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
    if (modelId === '@cf/black-forest-labs/flux-1-schnell') {
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

  test('AI folder delete keeps durable cleanup entries when inline blob deletion fails', async () => {
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
    expect(env.DB.state.r2CleanupQueue.map((row) => row.r2_key).sort()).toEqual([
      'users/artist-3/folders/archive/aa11.png',
      'users/artist-3/folders/archive/bb22.png',
    ]);
    expect(env.USER_IMAGES.objects.has('users/artist-3/folders/archive/aa11.png')).toBe(true);
    expect(env.USER_IMAGES.objects.has('users/artist-3/folders/archive/bb22.png')).toBe(true);
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
