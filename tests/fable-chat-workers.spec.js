const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const RELEASE_COMPAT = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config/release-compat.json'), 'utf8')
);
const CURRENT_AUTH_MIGRATION = RELEASE_COMPAT.release.schemaCheckpoints.auth.latest;

const {
  MockDurableRateLimiterNamespace,
  MockQueueProducer,
  createExecutionContext,
  loadWorker,
  nowIso,
} = require('./helpers/auth-worker-harness');
const {
  SqliteD1Database,
  applyAuthMigrations,
} = require('./helpers/sqlite-d1');

async function loadSessionModule() {
  const modulePath = pathToFileURL(
    path.join(process.cwd(), 'workers/auth/src/lib/session.js')
  ).href;
  return import(modulePath);
}

async function loadAdminMfaModule() {
  const modulePath = pathToFileURL(
    path.join(process.cwd(), 'workers/auth/src/lib/admin-mfa.js')
  ).href;
  return import(modulePath);
}

async function loadServiceAuthModule() {
  const modulePath = pathToFileURL(
    path.join(process.cwd(), 'js/shared/service-auth.mjs')
  ).href;
  return import(modulePath);
}

async function signedInternalAiJsonRequest(pathname, body, {
  secret = 'test-ai-service-auth-secret',
  method = 'POST',
  headers = {},
} = {}) {
  const { buildServiceAuthHeaders } = await loadServiceAuthModule();
  const bodyText = body === undefined ? '' : JSON.stringify(body);
  const serviceHeaders = await buildServiceAuthHeaders({
    secret,
    method,
    path: pathname,
    body: bodyText,
  });
  return new Request(`https://bitbi-ai.internal${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
      ...serviceHeaders,
    },
    body: body === undefined ? undefined : bodyText,
  });
}

async function createFableChatSqliteEnv({ provider = null, bitbiEnv = 'production' } = {}) {
  const DB = new SqliteD1Database();
  applyAuthMigrations(DB);
  const activityQueue = new MockQueueProducer();
  const providerCalls = [];
  const env = {
    APP_BASE_URL: 'https://bitbi.ai',
    APP_ALLOWED_ORIGINS: 'https://bitbi.ai,https://van-ark.com',
    BITBI_ENV: bitbiEnv,
    SESSION_SECRET: 'test-session-secret-v1-32-characters',
    SESSION_HASH_SECRET: 'test-session-hash-secret-v1-32chars',
    PAGINATION_SIGNING_SECRET: 'test-pagination-signing-secret-v1-32chars',
    ADMIN_MFA_ENCRYPTION_KEY: 'test-admin-mfa-encryption-key-v1-32chars',
    ADMIN_MFA_PROOF_SECRET: 'test-admin-mfa-proof-secret-v1-32chars',
    ADMIN_MFA_RECOVERY_HASH_SECRET: 'test-admin-mfa-recovery-hash-secret-v1',
    AI_SAVE_REFERENCE_SIGNING_SECRET: 'test-ai-save-reference-signing-secret-v1',
    AI_SERVICE_AUTH_SECRET: 'test-ai-service-auth-secret-v1-32chars',
    ENABLE_ADMIN_AI_TEXT_BUDGET: 'true',
    DB,
    PUBLIC_RATE_LIMITER: new MockDurableRateLimiterNamespace(),
    ACTIVITY_INGEST_QUEUE: activityQueue,
    AI_LAB: {
      async fetch(request) {
        const body = await request.clone().json();
        providerCalls.push({
          body,
          headers: Object.fromEntries(request.headers.entries()),
          url: request.url,
        });
        if (provider) return provider({ request, body, callNumber: providerCalls.length });
        return new Response(JSON.stringify({
          ok: true,
          task: 'fable-chat',
          model: { id: 'anthropic/claude-fable-5' },
          result: {
            text: `Assistant reply ${providerCalls.length}`,
            usage: { input_tokens: 10, output_tokens: 5 },
            responseModel: 'claude-fable-5',
            stopReason: 'end_turn',
            gatewayMetadata: { keySource: 'Unified' },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      },
    },
  };
  const now = nowIso();
  DB.exec(`
    INSERT INTO admin_runtime_budget_switches (
      switch_key, enabled, reason, metadata_json, created_at, updated_at,
      updated_by_user_id, updated_by_email
    ) VALUES (
      'ENABLE_ADMIN_AI_TEXT_BUDGET', 1, 'test', '{}', '${now}', '${now}', NULL, NULL
    );
    INSERT INTO platform_budget_limits (
      id, budget_scope, window_type, limit_units, mode, status, starts_at, ends_at,
      reason, metadata_json, created_at, updated_at, created_by_user_id, updated_by_user_id
    ) VALUES
      ('pbl_fable_daily', 'platform_admin_lab_budget', 'daily', 10000, 'enforce', 'active', NULL, NULL, 'test', '{}', '${now}', '${now}', NULL, NULL),
      ('pbl_fable_monthly', 'platform_admin_lab_budget', 'monthly', 10000, 'enforce', 'active', NULL, NULL, 'test', '{}', '${now}', '${now}', NULL, NULL);
  `);
  return { env, DB, activityQueue, providerCalls };
}

async function seedFableChatActor(env, {
  id,
  email,
  role = 'admin',
  withMfa = role === 'admin',
} = {}) {
  const createdAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO users (
       id, email, password_hash, created_at, status, role, updated_at, email_verified_at
     ) VALUES (?, ?, 'unused-test-hash', ?, 'active', ?, ?, ?)`
  ).bind(id, email, createdAt, role, createdAt, createdAt).run();
  const { createSession } = await loadSessionModule();
  const session = await createSession(env, id);
  const cookies = [`__Host-bitbi_session=${session.sessionToken}`];
  if (withMfa) {
    await env.DB.prepare(
      `INSERT INTO admin_mfa_credentials (
         admin_user_id, secret_ciphertext, secret_iv, pending_secret_ciphertext,
         pending_secret_iv, enabled_at, last_accepted_timestep, created_at, updated_at
       ) VALUES (?, 'not-read-for-proof', 'not-read-for-proof', NULL, NULL, ?, NULL, ?, ?)`
    ).bind(id, createdAt, createdAt, createdAt).run();
    const { encodeAdminMfaProofToken } = await loadAdminMfaModule();
    const proof = await encodeAdminMfaProofToken(env, {
      userId: id,
      sessionId: session.sessionId,
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    cookies.push(`__Host-bitbi_admin_mfa=${proof}`);
  }
  return {
    session,
    cookie: cookies.join('; '),
    sessionOnlyCookie: cookies[0],
  };
}

async function callFableAuthWorker(worker, env, pathValue, {
  method = 'GET',
  cookie = null,
  body = undefined,
  idempotencyKey = null,
  origin = 'https://van-ark.com',
  fetchSite = 'same-origin',
} = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('origin', origin);
    headers.set('sec-fetch-site', fetchSite);
  }
  if (body !== undefined) headers.set('content-type', 'application/json; charset=utf-8');
  if (idempotencyKey) headers.set('idempotency-key', idempotencyKey);
  const execution = createExecutionContext();
  const response = await worker.fetch(new Request(`https://van-ark.com${pathValue}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, execution.execCtx);
  await execution.flush();
  return response;
}

async function createFableConversationForTest(worker, env, cookie) {
  const response = await callFableAuthWorker(worker, env, '/api/admin/fable-chat/conversations', {
    method: 'POST',
    cookie,
    body: {},
  });
  expect(response.status).toBe(201);
  return (await response.json()).conversation;
}

test.describe('Private admin Fable chat', () => {
  test('migration is additive, ownership-indexed, fixed-model, and release compatible', () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'workers/auth/migrations/0069_add_admin_fable_chat.sql'),
      'utf8'
    );
    expect(CURRENT_AUTH_MIGRATION).toBe('0069_add_admin_fable_chat.sql');
    expect(migration).toContain('CREATE TABLE fable_chat_conversations');
    expect(migration).toContain('CREATE TABLE fable_chat_turns');
    expect(migration).toContain('CREATE TABLE fable_chat_messages');
    expect(migration).toContain("CHECK (model_id = 'anthropic/claude-fable-5')");
    expect(migration).toContain('idx_fable_chat_turns_conversation_idempotency');
    expect(migration).toContain('idx_fable_chat_turns_active_user_message');
    expect(migration).toContain('idx_fable_chat_turns_active_conversation');
    expect(migration).toContain('message_group_id TEXT NOT NULL');
    expect(migration).toContain('retry_of_turn_id TEXT');
    expect(migration).toContain("'unknown'");
    expect(migration).toContain('ON DELETE CASCADE');
    expect(migration).not.toMatch(/DROP\s+TABLE|DELETE\s+FROM|raw_idempotency/i);
  });

  test('strict origin allowlist accepts BITBI and van-ark while rejecting unrelated origins', async () => {
    const authModule = await import(pathToFileURL(
      path.join(process.cwd(), 'workers/auth/src/index.js')
    ).href);
    expect(authModule.getAllowedOrigins({
      APP_BASE_URL: 'https://bitbi.ai',
      APP_ALLOWED_ORIGINS: 'https://van-ark.com,https://bitbi.ai,https://van-ark.com',
    })).toEqual(['https://bitbi.ai', 'https://van-ark.com']);
    expect(authModule.normalizeConfiguredAppOrigin('https://van-ark.com/path')).toBeNull();
    expect(authModule.normalizeConfiguredAppOrigin('http://van-ark.com')).toBeNull();
    expect(authModule.normalizeConfiguredAppOrigin('https://user@van-ark.com')).toBeNull();
    expect(authModule.normalizeConfiguredAppOrigin('https://*.van-ark.com')).toBeNull();

    const { env, DB } = await createFableChatSqliteEnv();
    const worker = await loadWorker('workers/auth/src/index.js');
    try {
      const bitbi = await worker.fetch(new Request('https://bitbi.ai/api/logout', {
        method: 'POST',
        headers: { origin: 'https://bitbi.ai', 'sec-fetch-site': 'same-origin' },
      }), env, createExecutionContext().execCtx);
      expect(bitbi.status).toBe(200);
      const vanArk = await callFableAuthWorker(worker, env, '/api/logout', {
        method: 'POST',
      });
      expect(vanArk.status).toBe(200);
      const unrelated = await callFableAuthWorker(worker, env, '/api/logout', {
        method: 'POST',
        origin: 'https://example.com',
      });
      expect(unrelated.status).toBe(403);
      const crossSite = await callFableAuthWorker(worker, env, '/api/logout', {
        method: 'POST',
        fetchSite: 'cross-site',
      });
      expect(crossSite.status).toBe(403);
    } finally {
      DB.close();
    }
  });

  test('route enforces session, admin role, production MFA, and cross-owner non-disclosure', async () => {
    const { env, DB, providerCalls } = await createFableChatSqliteEnv();
    const worker = await loadWorker('workers/auth/src/index.js');
    try {
      const adminOne = await seedFableChatActor(env, {
        id: 'admin-fable-one',
        email: 'admin-one@example.com',
      });
      const adminTwo = await seedFableChatActor(env, {
        id: 'admin-fable-two',
        email: 'admin-two@example.com',
      });
      const member = await seedFableChatActor(env, {
        id: 'member-fable',
        email: 'member@example.com',
        role: 'user',
        withMfa: false,
      });

      const conversation = await createFableConversationForTest(worker, env, adminOne.cookie);
      expect(conversation.model).toBe('anthropic/claude-fable-5');
      const operations = [
        { path: '/api/admin/fable-chat/conversations' },
        { path: '/api/admin/fable-chat/conversations', method: 'POST', body: {} },
        { path: `/api/admin/fable-chat/conversations/${conversation.id}` },
        {
          path: `/api/admin/fable-chat/conversations/${conversation.id}`,
          method: 'PATCH',
          body: { title: 'No access' },
        },
        { path: `/api/admin/fable-chat/conversations/${conversation.id}`, method: 'DELETE' },
        {
          path: `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
          method: 'POST',
          body: { message: 'No access' },
          idempotencyKey: 'guarded-send-key-0001',
        },
      ];
      for (const operation of operations) {
        const unauthenticated = await callFableAuthWorker(worker, env, operation.path, operation);
        expect(unauthenticated.status).toBe(401);

        const nonAdmin = await callFableAuthWorker(worker, env, operation.path, {
          ...operation,
          cookie: member.cookie,
        });
        expect(nonAdmin.status).toBe(403);

        const mfaRequired = await callFableAuthWorker(worker, env, operation.path, {
          ...operation,
          cookie: adminOne.sessionOnlyCookie,
        });
        expect(mfaRequired.status).toBe(403);
        expect((await mfaRequired.json()).code).toBe('admin_mfa_required');
      }

      const foreignList = await callFableAuthWorker(
        worker,
        env,
        '/api/admin/fable-chat/conversations',
        { cookie: adminTwo.cookie }
      );
      expect((await foreignList.json()).conversations).toEqual([]);
      for (const operation of operations.slice(2)) {
        const foreign = await callFableAuthWorker(worker, env, operation.path, {
          ...operation,
          cookie: adminTwo.cookie,
          idempotencyKey: operation.idempotencyKey
            ? 'foreign-send-key-0001'
            : null,
        });
        expect(foreign.status).toBe(404);
      }

      const override = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          cookie: adminOne.cookie,
          idempotencyKey: 'fixed-model-override-1',
          body: { message: 'Hello', model: 'other/model' },
        }
      );
      expect(override.status).toBe(400);
      expect(providerCalls).toHaveLength(0);
    } finally {
      DB.close();
    }
  });

  test('stores native multi-turn history, bounds context, and replays idempotent results exactly once', async () => {
    const { env, DB, providerCalls, activityQueue } = await createFableChatSqliteEnv();
    const worker = await loadWorker('workers/auth/src/index.js');
    try {
      const admin = await seedFableChatActor(env, {
        id: 'admin-fable-chat',
        email: 'fable@example.com',
      });
      const conversation = await createFableConversationForTest(worker, env, admin.cookie);
      const first = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          cookie: admin.cookie,
          idempotencyKey: 'fable-send-key-0001',
          body: { message: 'Remember that the launch code name is Northstar.' },
        }
      );
      expect(first.status).toBe(200);
      expect(first.headers.get('cache-control')).toContain('no-store');
      const firstBody = await first.json();
      expect(firstBody.idempotentReplay).toBe(false);
      expect(firstBody.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
      expect(firstBody.conversation.title).toBe('Remember that the launch code name is Northstar.');
      expect(providerCalls).toHaveLength(1);
      expect(providerCalls[0].url).toBe('https://bitbi-ai.internal/internal/ai/fable-chat');
      expect(providerCalls[0].headers['x-bitbi-service-signature']).toBeTruthy();
      expect(providerCalls[0].body.messages).toEqual([
        { role: 'user', content: 'Remember that the launch code name is Northstar.' },
      ]);
      expect(providerCalls[0].body.maxTokens).toBe(2048);
      expect(providerCalls[0].body.model).toBeUndefined();
      expect(providerCalls[0].body.__bitbi_ai_caller_policy).toMatchObject({
        operation_id: 'admin.fable_chat.send',
        model_id: 'anthropic/claude-fable-5',
        idempotency_policy: 'required',
      });

      const replay = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          cookie: admin.cookie,
          idempotencyKey: 'fable-send-key-0001',
          body: { message: 'Remember that the launch code name is Northstar.' },
        }
      );
      expect(replay.status).toBe(200);
      expect((await replay.json()).idempotentReplay).toBe(true);
      expect(providerCalls).toHaveLength(1);

      const conflict = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          cookie: admin.cookie,
          idempotencyKey: 'fable-send-key-0001',
          body: { message: 'A different request' },
        }
      );
      expect(conflict.status).toBe(409);
      expect((await conflict.json()).code).toBe('idempotency_conflict');
      expect(providerCalls).toHaveLength(1);

      const second = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          cookie: admin.cookie,
          idempotencyKey: 'fable-send-key-0002',
          body: { message: 'What code name did I give you?' },
        }
      );
      expect(second.status).toBe(200);
      expect(providerCalls[1].body.messages).toEqual([
        { role: 'user', content: 'Remember that the launch code name is Northstar.' },
        { role: 'assistant', content: 'Assistant reply 1' },
        { role: 'user', content: 'What code name did I give you?' },
      ]);

      for (let index = 3; index <= 26; index += 1) {
        const response = await callFableAuthWorker(
          worker,
          env,
          `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
          {
            method: 'POST',
            cookie: admin.cookie,
            idempotencyKey: `fable-send-key-${String(index).padStart(4, '0')}`,
            body: { message: `Message ${String(index).padStart(2, '0')}` },
          }
        );
        expect(response.status).toBe(200);
      }
      expect(providerCalls).toHaveLength(26);
      const finalProviderMessages = providerCalls.at(-1).body.messages;
      expect(finalProviderMessages).toHaveLength(49);
      expect(finalProviderMessages[0].role).toBe('user');
      expect(finalProviderMessages.at(-1)).toEqual({ role: 'user', content: 'Message 26' });
      const finalResponse = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          cookie: admin.cookie,
          idempotencyKey: 'fable-send-key-0026',
          body: { message: 'Message 26' },
        }
      );
      expect((await finalResponse.json()).context).toEqual({
        olderTurnsOmitted: true,
        omittedTurns: 1,
      });

      const usageCount = DB.database.prepare(
        "SELECT COUNT(*) AS count FROM platform_budget_usage_events WHERE operation_key = 'admin.fable_chat.send'"
      ).get().count;
      expect(usageCount).toBe(26);
      const messageCounts = DB.database.prepare(
        'SELECT role, COUNT(*) AS count FROM fable_chat_messages GROUP BY role ORDER BY role'
      ).all();
      expect(Object.fromEntries(messageCounts.map((row) => [row.role, row.count]))).toEqual({
        assistant: 26,
        user: 26,
      });
      const newestMessages = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}?limit=3`,
        { cookie: admin.cookie }
      );
      const newestPage = await newestMessages.json();
      expect(newestPage.messages).toHaveLength(3);
      expect(newestPage.context).toEqual({
        includedTurns: 24,
        omittedTurns: 1,
        olderTurnsOmitted: true,
      });
      expect(newestPage.hasMore).toBe(true);
      expect(newestPage.nextCursor).toBeTruthy();
      const olderMessages = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}?limit=3&cursor=${encodeURIComponent(newestPage.nextCursor)}`,
        { cookie: admin.cookie }
      );
      const olderPage = await olderMessages.json();
      expect(olderPage.messages).toHaveLength(3);
      expect(new Set([
        ...newestPage.messages.map((message) => message.id),
        ...olderPage.messages.map((message) => message.id),
      ]).size).toBe(6);
      const auditText = JSON.stringify(activityQueue.messages);
      expect(auditText).not.toContain('Northstar');
      expect(auditText).not.toContain('Assistant reply');
      expect(auditText).not.toContain('fable-send-key');
    } finally {
      DB.close();
    }
  });

  test('concurrent same-key sends execute the provider and budget ledger exactly once', async () => {
    const { env, DB, providerCalls } = await createFableChatSqliteEnv({
      provider: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return new Response(JSON.stringify({
          ok: true,
          model: { id: 'anthropic/claude-fable-5' },
          result: { text: 'One durable reply', usage: { input_tokens: 4, output_tokens: 3 } },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const worker = await loadWorker('workers/auth/src/index.js');
    try {
      const admin = await seedFableChatActor(env, {
        id: 'admin-fable-concurrent',
        email: 'concurrent@example.com',
      });
      const conversation = await createFableConversationForTest(worker, env, admin.cookie);
      const send = () => callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          cookie: admin.cookie,
          idempotencyKey: 'concurrent-send-key-0001',
          body: { message: 'Execute this once.' },
        }
      );
      const responses = await Promise.all([send(), send()]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(providerCalls).toHaveLength(1);

      const replay = await send();
      expect(replay.status).toBe(200);
      expect((await replay.json()).idempotentReplay).toBe(true);
      expect(providerCalls).toHaveLength(1);
      expect(DB.database.prepare('SELECT COUNT(*) AS count FROM fable_chat_turns').get().count).toBe(1);
      expect(DB.database.prepare('SELECT COUNT(*) AS count FROM fable_chat_messages').get().count).toBe(2);
      expect(DB.database.prepare(
        "SELECT COUNT(*) AS count FROM platform_budget_usage_events WHERE operation_key = 'admin.fable_chat.send'"
      ).get().count).toBe(1);

      const distinctSends = await Promise.all([
        callFableAuthWorker(
          worker,
          env,
          `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
          {
            method: 'POST',
            cookie: admin.cookie,
            idempotencyKey: 'concurrent-distinct-key-0001',
            body: { message: 'First concurrent follow-up.' },
          }
        ),
        callFableAuthWorker(
          worker,
          env,
          `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
          {
            method: 'POST',
            cookie: admin.cookie,
            idempotencyKey: 'concurrent-distinct-key-0002',
            body: { message: 'Second concurrent follow-up.' },
          }
        ),
      ]);
      expect(distinctSends.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(providerCalls).toHaveLength(2);
      expect(DB.database.prepare('SELECT COUNT(*) AS count FROM fable_chat_turns').get().count).toBe(2);
      expect(DB.database.prepare('SELECT COUNT(*) AS count FROM fable_chat_messages').get().count).toBe(4);
      expect(DB.database.prepare(
        "SELECT COUNT(*) AS count FROM platform_budget_usage_events WHERE operation_key = 'admin.fable_chat.send'"
      ).get().count).toBe(2);
    } finally {
      DB.close();
    }
  });

  test('atomic budget admission allows only one concurrent provider call at the remaining cap', async () => {
    const { env, DB, providerCalls } = await createFableChatSqliteEnv({
      provider: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return new Response(JSON.stringify({
          ok: true,
          model: { id: 'anthropic/claude-fable-5' },
          result: { text: 'Admitted once', usage: { input_tokens: 4, output_tokens: 2 } },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    DB.database.exec(
      "UPDATE platform_budget_limits SET limit_units = 1 WHERE budget_scope = 'platform_admin_lab_budget'"
    );
    const worker = await loadWorker('workers/auth/src/index.js');
    try {
      const admin = await seedFableChatActor(env, {
        id: 'admin-fable-cap-race',
        email: 'cap-race@example.com',
      });
      const firstConversation = await createFableConversationForTest(worker, env, admin.cookie);
      const secondConversation = await createFableConversationForTest(worker, env, admin.cookie);
      const responses = await Promise.all([
        callFableAuthWorker(
          worker,
          env,
          `/api/admin/fable-chat/conversations/${firstConversation.id}/messages`,
          {
            method: 'POST',
            cookie: admin.cookie,
            idempotencyKey: 'cap-race-send-key-0001',
            body: { message: 'First cap contender.' },
          }
        ),
        callFableAuthWorker(
          worker,
          env,
          `/api/admin/fable-chat/conversations/${secondConversation.id}/messages`,
          {
            method: 'POST',
            cookie: admin.cookie,
            idempotencyKey: 'cap-race-send-key-0002',
            body: { message: 'Second cap contender.' },
          }
        ),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 429]);
      expect(providerCalls).toHaveLength(1);
      expect(DB.database.prepare(
        "SELECT COUNT(*) AS count FROM platform_budget_usage_events WHERE operation_key = 'admin.fable_chat.send'"
      ).get().count).toBe(1);
      expect(DB.database.prepare(
        "SELECT COUNT(*) AS count FROM fable_chat_turns WHERE status = 'failed'"
      ).get().count).toBe(1);
    } finally {
      DB.close();
    }
  });

  test('character budget keeps the newest complete turns without truncating messages', async () => {
    const assistantReplies = [];
    const { env, DB, providerCalls } = await createFableChatSqliteEnv({
      provider: async ({ callNumber }) => {
        const text = `Reply ${callNumber}: ${'x'.repeat(30_500)}`;
        assistantReplies.push(text);
        return new Response(JSON.stringify({
          ok: true,
          model: { id: 'anthropic/claude-fable-5' },
          result: { text, usage: { input_tokens: 100, output_tokens: 100 } },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const worker = await loadWorker('workers/auth/src/index.js');
    try {
      const admin = await seedFableChatActor(env, {
        id: 'admin-fable-character-limit',
        email: 'character-limit@example.com',
      });
      const conversation = await createFableConversationForTest(worker, env, admin.cookie);
      let finalBody = null;
      for (let index = 1; index <= 5; index += 1) {
        const response = await callFableAuthWorker(
          worker,
          env,
          `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
          {
            method: 'POST',
            cookie: admin.cookie,
            idempotencyKey: `character-budget-key-${String(index).padStart(4, '0')}`,
            body: { message: `Budget message ${index}` },
          }
        );
        expect(response.status).toBe(200);
        finalBody = await response.json();
      }
      const finalMessages = providerCalls.at(-1).body.messages;
      expect(finalMessages).toHaveLength(7);
      expect(finalMessages[0]).toEqual({ role: 'user', content: 'Budget message 2' });
      expect(finalMessages[1]).toEqual({ role: 'assistant', content: assistantReplies[1] });
      expect(finalMessages.at(-1)).toEqual({ role: 'user', content: 'Budget message 5' });
      expect(finalMessages.some((message) => message.content === 'Budget message 1')).toBe(false);
      expect(finalBody.context).toEqual({ olderTurnsOmitted: true, omittedTurns: 1 });
    } finally {
      DB.close();
    }
  });

  test('persists a definitive provider rejection and retries with a new key without duplicating the user message', async () => {
    const rawProviderDetail = 'provider-secret-detail-that-must-not-leak';
    const { env, DB, providerCalls, activityQueue } = await createFableChatSqliteEnv({
      provider: async ({ callNumber }) => {
        if (callNumber === 1) {
          return new Response(JSON.stringify({
            ok: false,
            error: rawProviderDetail,
            code: 'rate_limited',
          }), {
            status: 429,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({
          ok: true,
          model: { id: 'anthropic/claude-fable-5' },
          result: { text: 'Recovered reply', usage: { input_tokens: 4, output_tokens: 2 } },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const worker = await loadWorker('workers/auth/src/index.js');
    try {
      const admin = await seedFableChatActor(env, {
        id: 'admin-fable-retry',
        email: 'retry@example.com',
      });
      const conversation = await createFableConversationForTest(worker, env, admin.cookie);
      const failed = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          cookie: admin.cookie,
          idempotencyKey: 'fable-failure-key-0001',
          body: { message: 'Please retry this safely.' },
        }
      );
      expect(failed.status).toBe(429);
      const failedBody = await failed.json();
      expect(failedBody.code).toBe('fable_chat_turn_failed');
      expect(JSON.stringify(failedBody)).not.toContain(rawProviderDetail);
      expect(providerCalls).toHaveLength(1);

      const failedReplay = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          cookie: admin.cookie,
          idempotencyKey: 'fable-failure-key-0001',
          body: { message: 'Please retry this safely.' },
        }
      );
      expect(failedReplay.status).toBe(409);
      expect(providerCalls).toHaveLength(1);

      const retried = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          cookie: admin.cookie,
          idempotencyKey: 'fable-failure-key-0002',
          body: {
            message: 'Please retry this safely.',
            retry_message_id: failedBody.retryMessageId,
          },
        }
      );
      expect(retried.status).toBe(200);
      expect(providerCalls).toHaveLength(2);
      expect(providerCalls[1].body.messages).toEqual([
        { role: 'user', content: 'Please retry this safely.' },
      ]);
      expect(DB.database.prepare(
        "SELECT COUNT(*) AS count FROM fable_chat_messages WHERE role = 'user'"
      ).get().count).toBe(1);
      expect(DB.database.prepare(
        "SELECT COUNT(*) AS count FROM fable_chat_messages WHERE role = 'assistant'"
      ).get().count).toBe(1);
      expect(DB.database.prepare(
        "SELECT COUNT(*) AS count FROM fable_chat_turns WHERE status = 'failed'"
      ).get().count).toBe(1);
      expect(DB.database.prepare(
        "SELECT COUNT(*) AS count FROM fable_chat_turns WHERE status = 'succeeded'"
      ).get().count).toBe(1);
      const persistedFailure = DB.database.prepare(
        "SELECT error_code FROM fable_chat_turns WHERE status = 'failed' LIMIT 1"
      ).get();
      expect(persistedFailure.error_code).toBe('rate_limited');
      expect(DB.database.prepare(
        "SELECT COUNT(*) AS count FROM platform_budget_usage_events WHERE operation_key = 'admin.fable_chat.send'"
      ).get().count).toBe(2);
      expect(JSON.stringify(activityQueue.messages)).not.toContain(rawProviderDetail);
    } finally {
      DB.close();
    }
  });

  test('persists unknown provider outcomes without offering a duplicate-execution retry', async () => {
    const rawProviderDetail = 'ambiguous-provider-detail-that-must-not-leak';
    const { env, DB, providerCalls, activityQueue } = await createFableChatSqliteEnv({
      provider: async () => new Response(JSON.stringify({
        ok: false,
        error: rawProviderDetail,
        code: 'upstream_error',
      }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    });
    const worker = await loadWorker('workers/auth/src/index.js');
    try {
      const admin = await seedFableChatActor(env, {
        id: 'admin-fable-unknown',
        email: 'unknown@example.com',
      });
      const conversation = await createFableConversationForTest(worker, env, admin.cookie);
      const sendOptions = {
        method: 'POST',
        cookie: admin.cookie,
        idempotencyKey: 'fable-unknown-key-0001',
        body: { message: 'Do not execute this twice.' },
      };
      const unknown = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
        sendOptions
      );
      expect(unknown.status).toBe(503);
      const unknownBody = await unknown.json();
      expect(unknownBody).toMatchObject({
        code: 'fable_chat_provider_outcome_unknown',
        retryable: false,
        turn: { status: 'unknown' },
      });
      expect(unknownBody.retryMessageId).toBeUndefined();
      expect(JSON.stringify(unknownBody)).not.toContain(rawProviderDetail);

      const replay = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
        sendOptions
      );
      expect(replay.status).toBe(409);
      expect((await replay.json()).code).toBe('fable_chat_provider_outcome_unknown');
      expect(providerCalls).toHaveLength(1);

      const unknownMessage = DB.database.prepare(
        "SELECT id, state FROM fable_chat_messages WHERE role = 'user' LIMIT 1"
      ).get();
      expect(unknownMessage.state).toBe('unknown');
      const unsafeRetry = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          cookie: admin.cookie,
          idempotencyKey: 'fable-unknown-key-0002',
          body: {
            message: 'Do not execute this twice.',
            retry_message_id: unknownMessage.id,
          },
        }
      );
      expect(unsafeRetry.status).toBe(409);
      expect((await unsafeRetry.json()).code).toBe('fable_chat_retry_conflict');
      expect(providerCalls).toHaveLength(1);
      expect(DB.database.prepare(
        "SELECT COUNT(*) AS count FROM platform_budget_usage_events WHERE operation_key = 'admin.fable_chat.send'"
      ).get().count).toBe(1);
      expect(JSON.stringify(activityQueue.messages)).not.toContain(rawProviderDetail);
    } finally {
      DB.close();
    }
  });

  test('stale attempts become auditable unknown outcomes and active conversations cannot be deleted', async () => {
    const { env, DB, providerCalls, activityQueue } = await createFableChatSqliteEnv();
    const worker = await loadWorker('workers/auth/src/index.js');
    const fableChatModule = await import(pathToFileURL(
      path.join(process.cwd(), 'workers/auth/src/lib/fable-chat.js')
    ).href);
    try {
      const admin = await seedFableChatActor(env, {
        id: 'admin-fable-stale',
        email: 'stale@example.com',
      });
      const conversation = await createFableConversationForTest(worker, env, admin.cookie);
      const requestFingerprint = await fableChatModule.buildFableChatRequestFingerprint({
        conversationId: conversation.id,
        message: 'Stale pending content must not be logged.',
      });
      const pending = await fableChatModule.beginFableChatTurn(env, {
        adminUserId: 'admin-fable-stale',
        conversationId: conversation.id,
        idempotencyKey: 'stale-pending-key-0001',
        requestFingerprint,
        message: 'Stale pending content must not be logged.',
      });
      expect(pending.turn.status).toBe('pending');

      const activeDelete = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}`,
        { method: 'DELETE', cookie: admin.cookie }
      );
      expect(activeDelete.status).toBe(409);
      expect((await activeDelete.json()).code).toBe('fable_chat_message_in_progress');

      DB.database.prepare(
        "UPDATE fable_chat_turns SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?"
      ).run(pending.turn.id);
      const detail = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}`,
        { cookie: admin.cookie }
      );
      expect(detail.status).toBe(200);
      expect((await detail.json()).messages).toEqual([
        expect.objectContaining({ role: 'user', state: 'unknown' }),
      ]);
      expect(DB.database.prepare(
        'SELECT status FROM fable_chat_turns WHERE id = ?'
      ).get(pending.turn.id).status).toBe('unknown');

      const resumed = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}/messages`,
        {
          method: 'POST',
          cookie: admin.cookie,
          idempotencyKey: 'stale-followup-key-0001',
          body: { message: 'A new message after the unknown outcome.' },
        }
      );
      expect(resumed.status).toBe(200);
      expect(providerCalls).toHaveLength(1);

      const deleted = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${conversation.id}`,
        { method: 'DELETE', cookie: admin.cookie }
      );
      expect(deleted.status).toBe(200);
      const auditText = JSON.stringify(activityQueue.messages);
      expect(auditText).toContain('fable_chat_message_outcome_unknown');
      expect(auditText).not.toContain('Stale pending content');
    } finally {
      DB.close();
    }
  });

  test('conversation pagination, rename, and soft delete remain bounded and ownership scoped', async () => {
    const { env, DB } = await createFableChatSqliteEnv();
    const worker = await loadWorker('workers/auth/src/index.js');
    try {
      const admin = await seedFableChatActor(env, {
        id: 'admin-fable-list',
        email: 'list@example.com',
      });
      const otherAdmin = await seedFableChatActor(env, {
        id: 'admin-fable-list-other',
        email: 'list-other@example.com',
      });
      const first = await createFableConversationForTest(worker, env, admin.cookie);
      const second = await createFableConversationForTest(worker, env, admin.cookie);
      const third = await createFableConversationForTest(worker, env, admin.cookie);
      const foreign = await createFableConversationForTest(worker, env, otherAdmin.cookie);

      const list = await callFableAuthWorker(
        worker,
        env,
        '/api/admin/fable-chat/conversations?limit=2',
        { cookie: admin.cookie }
      );
      const page = await list.json();
      expect(page.conversations).toHaveLength(2);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBeTruthy();

      const nextList = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations?limit=2&cursor=${encodeURIComponent(page.nextCursor)}`,
        { cookie: admin.cookie }
      );
      const nextPage = await nextList.json();
      expect(nextPage.conversations).toHaveLength(1);
      expect(nextPage.hasMore).toBe(false);
      expect(new Set([
        ...page.conversations.map((conversation) => conversation.id),
        ...nextPage.conversations.map((conversation) => conversation.id),
      ])).toEqual(new Set([first.id, second.id, third.id]));

      const otherList = await callFableAuthWorker(
        worker,
        env,
        '/api/admin/fable-chat/conversations?limit=50',
        { cookie: otherAdmin.cookie }
      );
      expect((await otherList.json()).conversations.map((conversation) => conversation.id))
        .toEqual([foreign.id]);

      const renamed = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${first.id}`,
        { method: 'PATCH', cookie: admin.cookie, body: { title: 'Release planning' } }
      );
      expect(renamed.status).toBe(200);
      expect((await renamed.json()).conversation.title).toBe('Release planning');

      const deleted = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${first.id}`,
        { method: 'DELETE', cookie: admin.cookie }
      );
      expect(deleted.status).toBe(200);
      const afterDelete = await callFableAuthWorker(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${first.id}`,
        { cookie: admin.cookie }
      );
      expect(afterDelete.status).toBe(404);
      expect(DB.database.prepare(
        'SELECT deleted_at FROM fable_chat_conversations WHERE id = ?'
      ).get(first.id).deleted_at).toBeTruthy();
    } finally {
      DB.close();
    }
  });

  test('AI route preserves native roles, fixes Fable, and disables gateway cache and logging', async () => {
    const routeModule = await import(pathToFileURL(
      path.join(process.cwd(), 'workers/ai/src/routes/fable-chat.js')
    ).href);
    const calls = [];
    const response = await routeModule.handleFableChat({
      request: new Request('https://bitbi-ai.internal/internal/ai/fable-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          system: 'Trusted system prompt',
          messages: [
            { role: 'user', content: 'First' },
            { role: 'assistant', content: '  Second\n' },
            { role: 'user', content: 'Third' },
          ],
          maxTokens: 2048,
        }),
      }),
      env: {
        AI: {
          async run(...args) {
            calls.push(args);
            return {
              content: [
                { type: 'thinking', thinking: 'private' },
                { type: 'text', text: 'Final answer' },
              ],
              model: 'claude-fable-5',
              stop_reason: 'end_turn',
              usage: { input_tokens: 3, output_tokens: 2 },
              gatewayMetadata: { keySource: 'Unified', unsafe: 'drop' },
            };
          },
        },
      },
      correlationId: 'fable-route-test',
      pathname: '/internal/ai/fable-chat',
      method: 'POST',
    });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('anthropic/claude-fable-5');
    expect(calls[0][1]).toMatchObject({
      system: 'Trusted system prompt',
      messages: [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: '  Second\n' },
        { role: 'user', content: 'Third' },
      ],
      max_tokens: 2048,
    });
    expect(calls[0][2].gateway).toMatchObject({
      skipCache: true,
      collectLog: false,
    });
    const payload = await response.json();
    expect(payload.result.text).toBe('Final answer');
    expect(payload.result.gatewayMetadata).toEqual({ keySource: 'Unified' });
    expect(JSON.stringify(payload)).not.toContain('private');

    const rejected = await routeModule.handleFableChat({
      request: new Request('https://bitbi-ai.internal/internal/ai/fable-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'other/model',
          messages: [{ role: 'user', content: 'No override' }],
          maxTokens: 2048,
        }),
      }),
      env: { AI: { run: async () => ({}) } },
      correlationId: 'fable-route-reject',
      pathname: '/internal/ai/fable-chat',
      method: 'POST',
    });
    expect(rejected.status).toBe(400);

    const overHardLimit = await routeModule.handleFableChat({
      request: new Request('https://bitbi-ai.internal/internal/ai/fable-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Bound the output' }],
          maxTokens: 4097,
        }),
      }),
      env: { AI: { run: async () => ({}) } },
      correlationId: 'fable-route-hard-limit',
      pathname: '/internal/ai/fable-chat',
      method: 'POST',
    });
    expect(overHardLimit.status).toBe(400);
  });

  test('AI worker index requires service auth and the dedicated caller policy before Fable execution', async () => {
    const aiWorker = await loadWorker('workers/ai/src/index.js');
    const secret = 'fable-index-service-auth-secret';
    const runCalls = [];
    const env = {
      AI_SERVICE_AUTH_SECRET: secret,
      AI_GATEWAY_ID: 'fable-index-gateway',
      SERVICE_AUTH_REPLAY: new MockDurableRateLimiterNamespace(),
      AI: {
        async run(...args) {
          runCalls.push(args);
          return {
            content: [{ type: 'text', text: 'Signed Fable reply' }],
            model: 'claude-fable-5',
            stop_reason: 'end_turn',
            usage: { input_tokens: 3, output_tokens: 3 },
          };
        },
      },
    };
    const requestBody = {
      system: 'Trusted system prompt',
      messages: [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Second' },
        { role: 'user', content: 'Third' },
      ],
      maxTokens: 2048,
    };
    const unsigned = await aiWorker.fetch(
      new Request('https://bitbi-ai.internal/internal/ai/fable-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(unsigned.status).toBe(401);

    const missingPolicy = await aiWorker.fetch(
      await signedInternalAiJsonRequest('/internal/ai/fable-chat', requestBody, { secret }),
      env,
      createExecutionContext().execCtx
    );
    expect(missingPolicy.status).toBe(428);
    expect(runCalls).toHaveLength(0);

    const fingerprint = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const signed = await aiWorker.fetch(
      await signedInternalAiJsonRequest('/internal/ai/fable-chat', {
        ...requestBody,
        __bitbi_ai_caller_policy: {
          policy_version: 'ai-caller-policy-v1',
          operation_id: 'admin.fable_chat.send',
          budget_scope: 'platform_admin_lab_budget',
          enforcement_status: 'budget_metadata_only',
          caller_class: 'admin',
          owner_domain: 'admin-fable-chat',
          provider_family: 'ai_worker',
          model_id: 'anthropic/claude-fable-5',
          model_resolver_key: 'admin.fable_chat.fixed_model',
          idempotency_policy: 'required',
          source_route: '/api/admin/fable-chat/conversations/:id/messages',
          source_component: 'auth-worker-admin-fable-chat',
          budget_fingerprint: fingerprint,
          request_fingerprint: fingerprint,
          kill_switch_target: 'ENABLE_ADMIN_AI_TEXT_BUDGET',
          correlation_id: 'signed-fable-index-test',
          reason: 'admin_fable_chat_durable_result_replay',
        },
      }, { secret }),
      env,
      createExecutionContext().execCtx
    );
    expect(signed.status).toBe(200);
    expect(runCalls).toHaveLength(1);
    expect(runCalls[0][0]).toBe('anthropic/claude-fable-5');
    expect(runCalls[0][1].messages).toEqual(requestBody.messages);
    expect(JSON.stringify(runCalls[0][1])).not.toContain('__bitbi_ai_caller_policy');
  });
});
