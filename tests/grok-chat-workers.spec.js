const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  MockDurableRateLimiterNamespace,
  MockQueueProducer,
  createExecutionContext,
  loadWorker,
  nowIso,
} = require('./helpers/auth-worker-harness');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1');

const moduleAt = (relative) => import(pathToFileURL(path.join(process.cwd(), relative)).href);

function sse(events, splitAt = null) {
  const body = events.map(([event, data]) => (
    event ? `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`
      : `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`
  )).join('');
  const bytes = new TextEncoder().encode(body);
  return new ReadableStream({
    start(controller) {
      if (splitAt && splitAt > 0 && splitAt < bytes.length) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
      } else {
        controller.enqueue(bytes);
      }
      controller.close();
    },
  });
}

function providerTextStream({ text = 'Hello from Grok.', reasoning = 'Short reasoning.' } = {}) {
  return sse([
    [null, {
      id: 'chatcmpl_test',
      model: 'xai/grok-4.6',
      choices: [{ index: 0, delta: { reasoning_content: reasoning }, finish_reason: null }],
    }],
    [null, {
      id: 'chatcmpl_test',
      model: 'xai/grok-4.6',
      citations: [{ title: 'Cloudflare', url: 'https://developers.cloudflare.com/ai/' }],
      output_files: [
        { id: 'file_synthetic_1', filename: 'result.json' },
        { id: '../unsafe', filename: 'ignored.txt' },
      ],
      choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }],
    }],
    [null, {
      choices: [],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 8,
        total_tokens: 28,
        prompt_tokens_details: { cached_tokens: 5, image_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 3 },
        num_sources_used: 1,
        cost_in_usd_ticks: '17',
      },
    }],
    [null, '[DONE]'],
  ], 71);
}

function providerToolStream() {
  return sse([
    [null, {
      id: 'chatcmpl_tool',
      model: 'xai/grok-4.6',
      choices: [{
        index: 0,
        delta: { tool_calls: [{
          index: 0,
          id: 'call_calc1',
          type: 'function',
          function: { name: 'calculator', arguments: '{"operation":"add",' },
        }] },
        finish_reason: null,
      }],
    }],
    [null, {
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: '"a":2,"b":3}' } }] },
        finish_reason: 'tool_calls',
      }],
    }],
    [null, { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }],
    [null, '[DONE]'],
  ]);
}

function providerParallelToolStream({ unknown = false } = {}) {
  return sse([
    [null, {
      id: 'chatcmpl_parallel_tool',
      model: 'xai/grok-4.6',
      choices: [{
        index: 0,
        delta: { tool_calls: [
          {
            index: 0,
            id: 'call_calc_a',
            type: 'function',
            function: {
              name: unknown ? 'unregistered_tool' : 'calculator',
              arguments: '{"operation":"multiply","a":3,"b":4}',
            },
          },
          {
            index: 1,
            id: 'call_calc_b',
            type: 'function',
            function: { name: 'calculator', arguments: '{"operation":"subtract","a":9,"b":2}' },
          },
        ] },
        finish_reason: 'tool_calls',
      }],
    }],
    [null, { choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }],
    [null, '[DONE]'],
  ]);
}

function internalCompletionStream() {
  const text = 'Grok integration reply.';
  return sse([
    ['accepted', { ok: true }],
    ['thinking_delta', { text: 'Synthetic reasoning.' }],
    ['text_delta', { text }],
    ['complete_internal', {
      text,
      reasoningSummary: 'Synthetic reasoning.',
      providerState: {
        version: 1,
        formatVersion: 'openai-chat-completions-state-v1',
        messages: [{ role: 'assistant', content: text, reasoning_content: 'Synthetic reasoning.' }],
        citations: [{ title: 'Cloudflare', url: 'https://developers.cloudflare.com/ai/' }],
        outputFiles: [],
        responseId: 'chatcmpl_synthetic',
        systemFingerprint: 'fp_synthetic',
        serviceTier: 'default',
      },
      providerBlocks: null,
      sources: [{ title: 'Cloudflare', url: 'https://developers.cloudflare.com/ai/' }],
      usage: {
        input_tokens: 20,
        output_tokens: 8,
        cache_read_input_tokens: 5,
        output_tokens_details: { thinking_tokens: 3 },
        provider: {
          prompt_tokens: 20,
          completion_tokens: 8,
          total_tokens: 28,
          cached_tokens: 5,
          image_tokens: 0,
          reasoning_tokens: 3,
          sources_used: 1,
          cost_in_usd_ticks: '17',
        },
      },
      responseModel: 'xai/grok-4.6',
      stopReason: 'stop',
      stopSequence: null,
      webSearchRequestCount: 0,
      webSearchExecutedRequestCount: 0,
      webSearchResultCount: 0,
      webSearchReceivedResultCount: 0,
      webSearchAcceptedResultCount: 0,
      webSearchQuarantinedInvalidUrlCount: 0,
      webFetchRequestCount: 0,
      webFetchResultCount: 0,
      webFetchErrorResultCount: 0,
      durationMs: 25,
    }],
  ]);
}

async function createAuthEnv() {
  const DB = new SqliteD1Database();
  applyAuthMigrations(DB);
  const providerCalls = [];
  const objects = new Map();
  const env = {
    APP_BASE_URL: 'https://bitbi.ai',
    APP_ALLOWED_ORIGINS: 'https://bitbi.ai,https://van-ark.com',
    BITBI_ENV: 'production',
    SESSION_SECRET: 'test-session-secret-v1-32-characters',
    SESSION_HASH_SECRET: 'test-session-hash-secret-v1-32chars',
    PAGINATION_SIGNING_SECRET: 'test-pagination-signing-secret-v1-32chars',
    ADMIN_MFA_ENCRYPTION_KEY: 'test-admin-mfa-encryption-key-v1-32chars',
    ADMIN_MFA_PROOF_SECRET: 'test-admin-mfa-proof-secret-v1-32chars',
    ADMIN_MFA_RECOVERY_HASH_SECRET: 'test-admin-mfa-recovery-hash-secret-v1',
    AI_SAVE_REFERENCE_SIGNING_SECRET: 'test-ai-save-reference-signing-secret-v1',
    AI_SERVICE_AUTH_SECRET: 'test-ai-service-auth-secret-v1-32chars',
    ENABLE_ADMIN_AI_TEXT_BUDGET: 'true',
    ENABLE_GROK_4_6: 'true',
    DB,
    PUBLIC_RATE_LIMITER: new MockDurableRateLimiterNamespace(),
    ACTIVITY_INGEST_QUEUE: new MockQueueProducer(),
    USER_IMAGES: {
      async put(key, bytes) { objects.set(key, new Uint8Array(bytes)); },
      async get(key) {
        const value = objects.get(key);
        return value ? { arrayBuffer: async () => value.slice().buffer } : null;
      },
      async delete(key) { objects.delete(key); },
    },
    IMAGES: {},
    AI_LAB: {
      async fetch(request) {
        const body = await request.clone().json();
        providerCalls.push({ url: request.url, body });
        if (new URL(request.url).pathname === '/internal/ai/chat/stream') {
          return new Response(internalCompletionStream(), {
            status: 200,
            headers: { 'content-type': 'text/event-stream; charset=utf-8' },
          });
        }
        return new Response(JSON.stringify({ ok: false, code: 'unexpected_test_route' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  };
  const timestamp = nowIso();
  DB.exec(`
    INSERT INTO admin_runtime_budget_switches (
      switch_key, enabled, reason, metadata_json, created_at, updated_at
    ) VALUES ('ENABLE_ADMIN_AI_TEXT_BUDGET', 1, 'test', '{}', '${timestamp}', '${timestamp}');
    INSERT INTO platform_budget_limits (
      id, budget_scope, window_type, limit_units, mode, status, starts_at, ends_at,
      reason, metadata_json, created_at, updated_at
    ) VALUES
      ('pbl_grok_daily', 'platform_admin_lab_budget', 'daily', 10000, 'enforce', 'active', NULL, NULL, 'test', '{}', '${timestamp}', '${timestamp}'),
      ('pbl_grok_monthly', 'platform_admin_lab_budget', 'monthly', 10000, 'enforce', 'active', NULL, NULL, 'test', '{}', '${timestamp}', '${timestamp}');
  `);
  return { env, DB, providerCalls, objects };
}

async function seedAdmin(env) {
  const timestamp = nowIso();
  const id = 'admin-grok-test';
  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, created_at, status, role, updated_at, email_verified_at)
     VALUES (?, 'grok-admin@example.test', 'unused', ?, 'active', 'admin', ?, ?)`
  ).bind(id, timestamp, timestamp, timestamp).run();
  const sessionModule = await moduleAt('workers/auth/src/lib/session.js');
  const mfaModule = await moduleAt('workers/auth/src/lib/admin-mfa.js');
  const session = await sessionModule.createSession(env, id);
  await env.DB.prepare(
    `INSERT INTO admin_mfa_credentials (
       admin_user_id, secret_ciphertext, secret_iv, enabled_at, created_at, updated_at
     ) VALUES (?, 'unused', 'unused', ?, ?, ?)`
  ).bind(id, timestamp, timestamp, timestamp).run();
  const proof = await mfaModule.encodeAdminMfaProofToken(env, {
    userId: id,
    sessionId: session.sessionId,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  return {
    id,
    cookie: `__Host-bitbi_session=${session.sessionToken}; __Host-bitbi_admin_mfa=${proof}`,
  };
}

async function callAuth(worker, env, pathname, { method = 'GET', cookie, body, key } = {}) {
  const headers = new Headers({ cookie: cookie || '' });
  if (!['GET', 'HEAD'].includes(method)) {
    headers.set('origin', 'https://van-ark.com');
    headers.set('sec-fetch-site', 'same-origin');
  }
  if (body !== undefined) headers.set('content-type', 'application/json; charset=utf-8');
  if (key) headers.set('idempotency-key', key);
  const execution = createExecutionContext();
  const response = await worker.fetch(new Request(`https://van-ark.com${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, execution.execCtx);
  await execution.flush();
  return response;
}

test.describe('Provider-neutral Grok chat', () => {
  test('server registry allowlists exactly Fable and Grok and feature-gates Grok', async () => {
    const contract = await moduleAt('workers/shared/chat-model-contract.mjs');
    expect(contract.CHAT_MODEL_IDS).toEqual(['anthropic/claude-fable-5', 'xai/grok-4.6']);
    expect(contract.listPublicChatModels({ ENABLE_GROK_4_6: 'false' })[1].enabled).toBe(false);
    expect(contract.listPublicChatModels({ ENABLE_GROK_4_6: 'true' })[1].enabled).toBe(true);
    expect(() => contract.normalizeChatModelId('xai/another-model')).toThrow(/not supported/);
  });

  test('validates documented reasoning, tier, sampling, search, and strict schema combinations', async () => {
    const contract = await moduleAt('workers/shared/grok-chat-contract.mjs');
    expect(contract.normalizeGrokProviderSettings({ reasoningEffort: 'high' }).maxCompletionTokens)
      .toBe(32768);
    expect(() => contract.normalizeGrokProviderSettings({ reasoningEffort: 'xhigh' })).toThrow();
    expect(() => contract.normalizeGrokProviderSettings({ serviceTier: 'priority' })).toThrow();
    expect(() => contract.normalizeGrokProviderSettings({ temperature: 0.2, topP: 0.9 })).toThrow();
    const strict = contract.normalizeGrokProviderSettings({
      responseFormat: {
        type: 'json_schema',
        jsonSchema: {
          name: 'result',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { answer: { type: 'string' } },
            required: ['answer'],
          },
        },
      },
      webSearch: { mode: 'auto', maxResults: 3, fromDate: '2026-01-01' },
    });
    expect(strict.responseFormat.jsonSchema.strict).toBe(true);
    expect(strict.webSearch).toMatchObject({ mode: 'auto', maxResults: 3 });
    const strictSchema = (schema) => contract.normalizeGrokProviderSettings({
      responseFormat: { type: 'json_schema', jsonSchema: { name: 'result', schema } },
    });
    expect(() => strictSchema({
      type: 'object', additionalProperties: false,
      properties: { answer: { type: 'string', pattern: '(a+)+$' } }, required: ['answer'],
    })).toThrow(/pattern is not supported/);
    expect(() => strictSchema({ type: 'number', minimum: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => strictSchema({ $ref: '#/$defs/missing' })).toThrow(/unresolved reference/);
    expect(() => strictSchema({
      $ref: '#/$defs/node',
      $defs: { node: { $ref: '#/$defs/node' } },
    })).toThrow(/Recursive JSON schemas/);
    expect(() => contract.validateGrokStructuredOutput('1', { type: 'json_object' }))
      .toThrow(/not an object/);
  });

  test('reserves bounded continuation, replay, image, and search budget before provider execution', async () => {
    const budget = await moduleAt('workers/auth/src/lib/fable-chat-budget.js');
    const enabled = budget.deriveGrokChatBudgetUnits({
      estimatedInputTokens: 32_768,
      maxCompletionTokens: 8_192,
      imageCount: 1,
      webSearchEnabled: true,
      toolChoice: 'auto',
    });
    const disabled = budget.deriveGrokChatBudgetUnits({
      estimatedInputTokens: 32_768,
      maxCompletionTokens: 8_192,
      imageCount: 1,
      webSearchEnabled: true,
      toolChoice: 'none',
    });
    expect(enabled).toMatchObject({
      inputUnits: 1, outputUnits: 1, imageUnits: 4, webSearchUnits: 4,
      continuationRounds: 4, maximumToolOutputReplayUnits: 4,
      toolContinuationUnits: 56, units: 66,
    });
    expect(disabled).toMatchObject({ continuationRounds: 0, toolContinuationUnits: 0, units: 10 });
  });

  test('routes Grok web search through Responses while preserving normal Grok chat', async () => {
    const grok = await moduleAt('workers/ai/src/lib/grok-chat.js');
    const contract = await moduleAt('workers/shared/grok-chat-contract.mjs');
    const streamConsumer = await moduleAt('workers/auth/src/lib/fable-chat-stream.js');
    const input = grok.validateGrokChatInput({
      model: 'xai/grok-4.6',
      messages: [
        { role: 'system', content: contract.GROK_BASE_SYSTEM_PROMPT },
        { role: 'assistant', content: 'Earlier visible answer.' },
        { role: 'user', content: 'Hello.' },
      ],
      settings: contract.normalizeGrokProviderSettings({ reasoningEffort: 'low' }),
      promptCacheKey: `gpc_${'a'.repeat(64)}`,
      privacyUser: `vau_${'b'.repeat(64)}`,
      contextFormatVersion: 'openai-chat-completions-v1',
    });
    const requests = [];
    const env = { AI: { async run(model, payload, options) {
      requests.push({ model, payload, options });
      if (model === grok.GROK_SEARCH_MODEL_ID) {
        return {
          id: 'resp_search_test',
          status: 'completed',
          output: [{ type: 'web_search_call', id: 'search_call_test', status: 'completed' }, {
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'output_text',
              text: 'Search answer.',
              annotations: [{
                type: 'url_citation',
                title: 'Cloudflare Web Search',
                url: 'https://developers.cloudflare.com/ai-gateway/usage/web-search/',
              }],
            }],
          }],
          usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
        };
      }
      return providerTextStream({ text: 'Normal answer.', reasoning: '' });
    } } };

    const normal = await streamConsumer.consumeInternalFableChatStream(
      grok.createInternalGrokChatStream(env, input)
    );
    expect(requests[0].model).toBe('xai/grok-4.6');
    expect(requests[0].payload).toMatchObject({
      reasoning_effort: 'low',
      stream: true,
      stream_options: { include_usage: true },
      prompt_cache_key: input.promptCacheKey,
      user: input.privacyUser,
    });
    expect(normal.responseModel).toBe('xai/grok-4.6');

    const searchInput = grok.validateGrokChatInput({
      ...input,
      settings: {
        reasoningEffort: 'high',
        responseFormat: { type: 'json_object' },
        webSearch: { mode: 'on', maxResults: 20, fromDate: '2026-01-01', toDate: '2026-08-17' },
        toolChoice: 'required',
        parallelToolCalls: true,
        temperature: 0.2,
        seed: 7,
      },
    });
    const search = await streamConsumer.consumeInternalFableChatStream(
      grok.createInternalGrokChatStream(env, searchInput)
    );
    const searchRequest = requests[1];
    expect(searchRequest.model).toBe('xai/grok-4.20-multi-agent-0309');
    expect(searchRequest.payload).toMatchObject({
      input: expect.any(Array),
      tools: [{ type: 'web_search' }],
      max_turns: 2,
    });
    expect(searchRequest.payload.input.map((message) => message.role))
      .toEqual(['system', 'assistant', 'user']);
    expect(JSON.stringify(searchRequest.payload.input)).not.toContain('You are Grok 4.6');
    for (const field of [
      'search_parameters', 'parallel_tool_calls', 'tool_choice', 'stream_options',
      'prompt_cache_key', 'max_completion_tokens', 'temperature', 'top_p', 'seed',
      'response_format', 'reasoning_effort', 'n', 'service_tier', 'messages', 'stream',
    ]) expect(searchRequest.payload[field]).toBeUndefined();
    expect(searchRequest.options.gateway.metadata).toMatchObject({
      model_id: 'xai/grok-4.20-multi-agent-0309',
      surface: 'van-ark-chat-responses',
    });
    expect(grok.GROK_SEARCH_MODEL_LABEL).toBe('Grok 4.20 Multi-Agent · Web Search');
    expect(search).toMatchObject({
      text: 'Search answer.',
      responseModel: 'xai/grok-4.20-multi-agent-0309',
      webSearchRequestCount: 1,
      webSearchExecutedRequestCount: 1,
      webSearchReceivedResultCount: 1,
    });
    expect(search.sources).toEqual([{
      title: 'Cloudflare Web Search',
      url: 'https://developers.cloudflare.com/ai-gateway/usage/web-search/',
      source: 'developers.cloudflare.com',
    }]);
  });

  test('AI chat route validates the stripped Auth payload instead of the caller-policy wrapper', async () => {
    const route = await moduleAt('workers/ai/src/routes/chat.js');
    const contract = await moduleAt('workers/shared/grok-chat-contract.mjs');
    let providerCalls = 0;
    const response = await route.handleChat({
      request: new Request('https://bitbi-ai.internal/internal/ai/chat/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'xai/grok-4.6',
          messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'x' }],
          settings: contract.defaultGrokProviderSettings(),
          promptCacheKey: `gpc_${'a'.repeat(64)}`,
          privacyUser: `vau_${'b'.repeat(64)}`,
          contextFormatVersion: 'openai-chat-completions-v1',
          __bitbi_ai_caller_policy: { version: 'shape-only' },
        }),
      }),
      env: {
        ENABLE_GROK_4_6: 'true',
        AI: {
          async run() {
            providerCalls += 1;
            return providerTextStream({ text: 'x', reasoning: '' });
          },
        },
      },
      correlationId: 'grok-auth-ai-contract-test',
      pathname: '/internal/ai/chat/stream',
      method: 'POST',
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(providerCalls).toBe(1);
  });

  test('accepts only private bounded image data URLs in the provider payload', async () => {
    const grok = await moduleAt('workers/ai/src/lib/grok-chat.js');
    const privateImage = 'data:image/webp;base64,UklGRgAAAABXRUJQ';
    const input = grok.validateGrokChatInput({
      model: 'xai/grok-4.6',
      messages: [
        { role: 'system', content: 'System.' },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: privateImage, detail: 'auto' } },
          { type: 'text', text: 'Describe this image.' },
        ] },
      ],
      settings: {},
      promptCacheKey: `gpc_${'3'.repeat(64)}`,
      privacyUser: `vau_${'4'.repeat(64)}`,
      contextFormatVersion: 'openai-chat-completions-v1',
    });
    expect(grok.buildGrokProviderPayload(input).messages.at(-1).content[0].image_url.url)
      .toBe(privateImage);
    expect(() => grok.validateGrokChatInput({
      ...input,
      messages: [
        { role: 'system', content: 'System.' },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: 'https://private.example/image.png' } },
          { type: 'text', text: 'Describe this image.' },
        ] },
      ],
    })).toThrow(/private supported image data URL/);
    const sixMegabytes = `data:image/webp;base64,${'A'.repeat(8 * 1024 * 1024)}`;
    expect(() => grok.validateGrokChatInput({
      ...input,
      messages: [
        { role: 'system', content: 'System.' },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: sixMegabytes } },
          { type: 'image_url', image_url: { url: sixMegabytes } },
          { type: 'text', text: 'Describe these images.' },
        ] },
      ],
    })).toThrow(/too much image data/);
  });

  test('parses fragmented streamed text, reasoning, citations, output files, cached usage, and raw cost ticks', async () => {
    const parser = await moduleAt('workers/ai/src/lib/openai-chat-stream.js');
    const reasoning = [];
    const text = [];
    const result = await parser.consumeOpenAiChatCompletionStream(providerTextStream(), {
      onReasoningDelta: (value) => reasoning.push(value),
      onTextDelta: (value) => text.push(value),
    });
    expect(text.join('')).toBe('Hello from Grok.');
    expect(reasoning.join('')).toBe('Short reasoning.');
    expect(result.citations[0].url).toBe('https://developers.cloudflare.com/ai/');
    expect(result.outputFiles).toEqual([{ id: 'file_synthetic_1', name: 'result.json' }]);
    expect(result.usage.provider).toMatchObject({ cached_tokens: 5, reasoning_tokens: 3 });
    expect(result.usage.provider.cost_in_usd_ticks).toBe('17');
  });

  test('reassembles fragmented function arguments and completes the server tool continuation loop', async () => {
    const grok = await moduleAt('workers/ai/src/lib/grok-chat.js');
    const streamConsumer = await moduleAt('workers/auth/src/lib/fable-chat-stream.js');
    const requests = [];
    const env = {
      ENABLE_GROK_4_6: 'true',
      AI: {
        async run(model, payload, options) {
          requests.push({ model, payload, options });
          return requests.length === 1 ? providerToolStream() : providerTextStream({
            text: 'The result is 5.',
            reasoning: '',
          });
        },
      },
    };
    const input = grok.validateGrokChatInput({
      model: 'xai/grok-4.6',
      messages: [{ role: 'system', content: 'System.' }, { role: 'user', content: 'Add 2 and 3.' }],
      settings: { toolChoice: 'required' },
      promptCacheKey: `gpc_${'c'.repeat(64)}`,
      privacyUser: `vau_${'d'.repeat(64)}`,
      contextFormatVersion: 'openai-chat-completions-v1',
    });
    const complete = await streamConsumer.consumeInternalFableChatStream(
      grok.createInternalGrokChatStream(env, input)
    );
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.model === 'xai/grok-4.6')).toBe(true);
    expect(requests[0].payload.tool_choice).toBe('required');
    expect(requests[1].payload.tool_choice).toBe('auto');
    expect(requests[1].payload.messages.at(-1)).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_calc1',
    });
    expect(JSON.parse(requests[1].payload.messages.at(-1).content).result).toBe(5);
    expect(complete.text).toBe('The result is 5.');
    expect(complete.providerState.messages).toHaveLength(3);
  });

  test('executes parallel registered tools and rejects an unknown tool without continuation', async () => {
    const grok = await moduleAt('workers/ai/src/lib/grok-chat.js');
    const streamConsumer = await moduleAt('workers/auth/src/lib/fable-chat-stream.js');
    const input = grok.validateGrokChatInput({
      model: 'xai/grok-4.6',
      messages: [{ role: 'system', content: 'System.' }, { role: 'user', content: 'Calculate.' }],
      settings: { parallelToolCalls: true },
      promptCacheKey: `gpc_${'e'.repeat(64)}`,
      privacyUser: `vau_${'f'.repeat(64)}`,
      contextFormatVersion: 'openai-chat-completions-v1',
    });
    const calls = [];
    const env = { AI: { async run(_model, payload) {
      calls.push(payload);
      return calls.length === 1
        ? providerParallelToolStream()
        : providerTextStream({ text: 'The results are 12 and 7.', reasoning: '' });
    } } };
    const complete = await streamConsumer.consumeInternalFableChatStream(
      grok.createInternalGrokChatStream(env, input)
    );
    expect(calls).toHaveLength(2);
    expect(calls[1].messages.slice(-2).map((message) => JSON.parse(message.content).result))
      .toEqual([12, 7]);
    expect(complete.text).toBe('The results are 12 and 7.');

    let unknownCalls = 0;
    const unknownEnv = { AI: { async run() {
      unknownCalls += 1;
      return providerParallelToolStream({ unknown: true });
    } } };
    await expect(streamConsumer.consumeInternalFableChatStream(
      grok.createInternalGrokChatStream(unknownEnv, input)
    )).rejects.toMatchObject({ code: 'provider_tool_unknown', outcome: 'failed' });
    expect(unknownCalls).toBe(1);
  });

  test('validates strict structured output once and never issues a hidden repair request', async () => {
    const grok = await moduleAt('workers/ai/src/lib/grok-chat.js');
    const streamConsumer = await moduleAt('workers/auth/src/lib/fable-chat-stream.js');
    let calls = 0;
    const input = grok.validateGrokChatInput({
      model: 'xai/grok-4.6',
      messages: [{ role: 'system', content: 'System.' }, { role: 'user', content: 'Return JSON.' }],
      settings: { responseFormat: {
        type: 'json_schema',
        jsonSchema: {
          name: 'answer',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { answer: { type: 'string' } },
            required: ['answer'],
          },
        },
      } },
      promptCacheKey: `gpc_${'1'.repeat(64)}`,
      privacyUser: `vau_${'2'.repeat(64)}`,
      contextFormatVersion: 'openai-chat-completions-v1',
    });
    const env = { AI: { async run() {
      calls += 1;
      return providerTextStream({ text: '{"wrong":true}', reasoning: '' });
    } } };
    await expect(streamConsumer.consumeInternalFableChatStream(
      grok.createInternalGrokChatStream(env, input)
    )).rejects.toMatchObject({ code: 'provider_structured_output_invalid', outcome: 'failed' });
    expect(calls).toBe(1);
  });

  test('rejects malformed, premature, empty, and unsupported multiple-choice streams', async () => {
    const parser = await moduleAt('workers/ai/src/lib/openai-chat-stream.js');
    await expect(parser.consumeOpenAiChatCompletionStream(sse([[null, '{bad json}']])))
      .rejects.toMatchObject({ code: 'provider_stream_malformed' });
    await expect(parser.consumeOpenAiChatCompletionStream(sse([[null, {
      choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }]]))).rejects.toMatchObject({ code: 'provider_upstream_eof_before_message_stop' });
    await expect(parser.consumeOpenAiChatCompletionStream(sse([
      [null, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }],
      [null, { choices: [], usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 } }],
      [null, '[DONE]'],
    ]))).rejects.toMatchObject({ code: 'provider_empty_response' });
    await expect(parser.consumeOpenAiChatCompletionStream(sse([
      [null, { choices: [{ index: 0, delta: {} }, { index: 1, delta: {} }] }],
      [null, '[DONE]'],
    ]))).rejects.toMatchObject({ code: 'provider_stream_malformed' });
  });

  test('classifies stream reader rejection as an ambiguous interrupted outcome', async () => {
    const parser = await moduleAt('workers/ai/src/lib/openai-chat-stream.js');
    const rejected = new ReadableStream({
      pull(controller) { controller.error(new Error('synthetic reader failure')); },
    });
    await expect(parser.consumeOpenAiChatCompletionStream(rejected))
      .rejects.toMatchObject({ code: 'provider_stream_interrupted', definitive: false });
  });

  test('aborts the in-flight Workers AI request when the normalized stream is canceled', async () => {
    const grok = await moduleAt('workers/ai/src/lib/grok-chat.js');
    let providerSignal = null;
    const neverEnding = new ReadableStream({ pull() {} });
    const input = grok.validateGrokChatInput({
      model: 'xai/grok-4.6',
      messages: [{ role: 'system', content: 'System.' }, { role: 'user', content: 'Wait.' }],
      settings: {},
      promptCacheKey: `gpc_${'9'.repeat(64)}`,
      privacyUser: `vau_${'8'.repeat(64)}`,
      contextFormatVersion: 'openai-chat-completions-v1',
    });
    const normalized = grok.createInternalGrokChatStream({ AI: { async run(_model, _payload, options) {
      providerSignal = options.signal;
      return neverEnding;
    } } }, input);
    const reader = normalized.getReader();
    await reader.read();
    await reader.cancel('synthetic client cancellation');
    await expect.poll(() => providerSignal?.aborted).toBe(true);
  });

  test('migration preserves Fable defaults, permits only exact Grok, and keeps foreign keys valid', async () => {
    const DB = new SqliteD1Database();
    try {
      applyAuthMigrations(DB);
      const timestamp = nowIso();
      DB.exec(`INSERT INTO users (
        id, email, password_hash, created_at, status, role, updated_at, email_verified_at
      ) VALUES ('migration-admin', 'migration@example.test', 'unused', '${timestamp}',
        'active', 'admin', '${timestamp}', '${timestamp}')`);
      DB.database.prepare(
        `INSERT INTO fable_chat_conversations (
          id, admin_user_id, title, title_source, created_at, updated_at, settings_updated_at
        ) VALUES (?, ?, 'Fable', 'automatic', ?, ?, ?)`
      ).run('fbc_11111111111111111111111111111111', 'migration-admin', timestamp, timestamp, timestamp);
      expect(DB.database.prepare(
        'SELECT model_id FROM fable_chat_conversations WHERE id = ?'
      ).get('fbc_11111111111111111111111111111111').model_id).toBe('anthropic/claude-fable-5');
      DB.database.prepare(
        `INSERT INTO fable_chat_conversations (
          id, admin_user_id, model_id, title, title_source, provider_settings_json,
          created_at, updated_at, settings_updated_at
        ) VALUES (?, ?, ?, 'Grok', 'automatic', '{}', ?, ?, ?)`
      ).run(
        'fbc_22222222222222222222222222222222',
        'migration-admin',
        'xai/grok-4.6',
        timestamp,
        timestamp,
        timestamp
      );
      expect(() => DB.database.prepare(
        `INSERT INTO fable_chat_conversations (
          id, admin_user_id, model_id, title, title_source, created_at, updated_at, settings_updated_at
        ) VALUES (?, ?, ?, 'Bad', 'automatic', ?, ?, ?)`
      ).run(
        'fbc_33333333333333333333333333333333',
        'migration-admin',
        'xai/not-allowed',
        timestamp,
        timestamp,
        timestamp
      )).toThrow();
      expect(DB.database.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'fable_chat_provider_messages'"
      ).get().sql).toContain("CHECK (model_id = 'anthropic/claude-fable-5')");
      expect(DB.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      DB.close();
    }
  });

  test('migration 0080 preserves a populated Fable foreign-key graph and every durable key', () => {
    const DB = new SqliteD1Database();
    const tables = [
      'fable_chat_conversations', 'fable_chat_messages', 'fable_chat_turns',
      'fable_chat_provider_messages', 'fable_chat_memory_checkpoints',
      'fable_chat_admin_message_revisions', 'fable_chat_admin_turn_revisions',
      'fable_chat_memory_checkpoint_invalidations',
    ];
    try {
      applyAuthMigrations(DB, { through: '0079_add_fable_prompt_cache_ttl.sql' });
      const at = '2026-08-17T00:00:00.000Z';
      DB.database.prepare(
        `INSERT INTO users (id, email, password_hash, created_at, status, role, updated_at)
         VALUES ('populated-admin', 'populated@example.test', 'unused', ?, 'active', 'admin', ?)`
      ).run(at, at);
      DB.database.prepare(
        `INSERT INTO fable_chat_conversations (
           id, admin_user_id, title, title_source, turn_count, prompt_cache_ttl,
           created_at, updated_at, settings_updated_at
         ) VALUES ('fbc_50000000000000000000000000000001', 'populated-admin',
           'Preserved title', 'manual', 1, '1h', ?, ?, ?)`
      ).run(at, at, at);
      const insertMessage = DB.database.prepare(
        `INSERT INTO fable_chat_messages (
           id, conversation_id, message_group_id, admin_user_id, turn_order, role, role_order,
           content, state, model_id, metadata_json, created_at, updated_at, reasoning_summary,
           citations_json
         ) VALUES (?, 'fbc_50000000000000000000000000000001', 'fbg_preserved',
           'populated-admin', 0, ?, ?, ?, 'succeeded', ?, '{}', ?, ?, ?, ?)`
      );
      insertMessage.run(
        'fbm_50000000000000000000000000000001', 'user', 0, 'Preserved user', null,
        at, at, null, '[]'
      );
      insertMessage.run(
        'fbm_50000000000000000000000000000002', 'assistant', 1, 'Preserved assistant',
        'anthropic/claude-fable-5', at, at, 'Preserved summary',
        '[{"title":"Source","url":"https://example.com/"}]'
      );
      DB.database.prepare(
        `INSERT INTO fable_chat_turns (
           id, conversation_id, admin_user_id, idempotency_key_hash, request_fingerprint,
           user_message_id, assistant_message_id, status, model_id, usage_json,
           gateway_metadata_json, prompt_cache_ttl, created_at, updated_at, completed_at, expires_at
         ) VALUES ('fbt_50000000000000000000000000000001',
           'fbc_50000000000000000000000000000001', 'populated-admin',
           'preserved-key-hash', 'preserved-fingerprint',
           'fbm_50000000000000000000000000000001',
           'fbm_50000000000000000000000000000002', 'succeeded',
           'anthropic/claude-fable-5', '{"input_tokens":7}', '{}', '1h', ?, ?, ?, ?)`
      ).run(at, at, at, '2026-08-18T00:00:00.000Z');
      DB.database.prepare(
        `INSERT INTO fable_chat_provider_messages (
           message_id, conversation_id, admin_user_id, model_id, content_blocks_json,
           serialized_bytes, format_version, created_at
         ) VALUES ('fbm_50000000000000000000000000000002',
           'fbc_50000000000000000000000000000001', 'populated-admin',
           'anthropic/claude-fable-5', '[{"type":"text","text":"Preserved assistant"}]',
           48, 'anthropic-content-v2', ?)`
      ).run(at);
      DB.database.prepare(
        `INSERT INTO fable_chat_memory_checkpoints (
           id, conversation_id, admin_user_id, profile, summary_version, status,
           hidden_summary_content, coverage_turn_order, input_fingerprint,
           created_at, updated_at, completed_at, expires_at
         ) VALUES ('fbk_50000000000000000000000000000001',
           'fbc_50000000000000000000000000000001', 'populated-admin', 'standard', 1,
           'pending', 'Preserved hidden memory', 0, 'preserved-memory-fingerprint', ?, ?, ?, ?)`
      ).run(at, at, at, '2026-09-17T00:00:00.000Z');
      DB.database.prepare(
        `INSERT INTO fable_chat_admin_message_revisions (
           id, conversation_id, admin_user_id, message_id, turn_id, revision_number,
           content, actor_admin_user_id, reason, created_at
         ) VALUES ('fbr_50000000000000000000000000000001',
           'fbc_50000000000000000000000000000001', 'populated-admin',
           'fbm_50000000000000000000000000000002',
           'fbt_50000000000000000000000000000001', 1, 'Preserved revision',
           'populated-admin', 'Synthetic migration fixture', ?)`
      ).run(at);
      DB.database.prepare(
        `INSERT INTO fable_chat_admin_turn_revisions (
           id, conversation_id, admin_user_id, turn_id, revision_number, action,
           actor_admin_user_id, reason, created_at
         ) VALUES ('fbd_50000000000000000000000000000001',
           'fbc_50000000000000000000000000000001', 'populated-admin',
           'fbt_50000000000000000000000000000001', 1, 'restore', 'populated-admin',
           'Synthetic migration fixture', ?)`
      ).run(at);
      DB.database.prepare(
        `INSERT INTO fable_chat_memory_checkpoint_invalidations (
           checkpoint_id, conversation_id, admin_user_id, actor_admin_user_id,
           invalidated_at, reason, mutation_version
         ) VALUES ('fbk_50000000000000000000000000000001',
           'fbc_50000000000000000000000000000001', 'populated-admin', 'populated-admin',
           ?, 'Synthetic migration fixture', 1)`
      ).run(at);
      const before = Object.fromEntries(tables.map((table) => [
        table, DB.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      ]));
      DB.exec(fs.readFileSync(
        path.join(process.cwd(), 'workers/auth/migrations/0080_add_provider_neutral_chat_and_grok_4_6.sql'),
        'utf8'
      ));
      const after = Object.fromEntries(tables.map((table) => [
        table, DB.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      ]));
      expect(after).toEqual(before);
      expect(DB.database.prepare(
        'SELECT model_id, title, prompt_cache_ttl FROM fable_chat_conversations'
      ).get()).toEqual({
        model_id: 'anthropic/claude-fable-5', title: 'Preserved title', prompt_cache_ttl: '1h',
      });
      expect(DB.database.prepare(
        'SELECT idempotency_key_hash, request_fingerprint, model_id FROM fable_chat_turns'
      ).get()).toEqual({
        idempotency_key_hash: 'preserved-key-hash',
        request_fingerprint: 'preserved-fingerprint',
        model_id: 'anthropic/claude-fable-5',
      });
      expect(DB.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      for (const index of [
        'idx_fable_chat_conversations_admin_updated',
        'idx_fable_chat_messages_conversation_turn',
        'idx_fable_chat_turns_conversation_created',
        'idx_fable_chat_provider_messages_owner',
      ]) {
        expect(DB.database.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?"
        ).get(index)?.name).toBe(index);
      }
    } finally {
      DB.close();
    }
  });

  test('normalizes private uploads, enforces ownership, and exposes no permanent object URL', async () => {
    const { env, DB, objects } = await createAuthEnv();
    const worker = await loadWorker('workers/auth/src/index.js');
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
    ]);
    let transformed = false;
    env.IMAGES = {
      async info() { return { width: 2, height: 2 }; },
      input() {
        return {
          transform() {
            transformed = true;
            return { output() { return { response: () => new Response(webp) }; } };
          },
        };
      },
    };
    try {
      const admin = await seedAdmin(env);
      const created = await callAuth(worker, env, '/api/admin/chat/conversations', {
        method: 'POST',
        cookie: admin.cookie,
        body: { model: 'xai/grok-4.6', settings: {} },
      });
      const conversation = (await created.json()).conversation;
      const attachments = await moduleAt('workers/auth/src/lib/grok-chat-attachments.js');
      const png = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x00,
      ]);
      const file = new File([png], 'synthetic.png', { type: 'image/png' });
      const stored = await attachments.createGrokChatAttachment(
        env, admin.id, conversation.id, file
      );
      expect(transformed).toBe(true);
      expect(stored).toMatchObject({ mimeType: 'image/webp', state: 'pending' });
      expect(stored.previewUrl).toBe(
        `/api/admin/chat/conversations/${conversation.id}/attachments/${stored.id}`
      );
      expect(stored.previewUrl).not.toMatch(/^https?:/);
      expect(objects.size).toBe(1);
      const preview = await attachments.getGrokChatAttachmentResponse(
        env, admin.id, conversation.id, stored.id
      );
      expect(preview.headers.get('cache-control')).toBe('no-store');
      expect(preview.headers.get('x-content-type-options')).toBe('nosniff');
      const objectKey = [...objects.keys()][0];
      objects.set(objectKey, new Uint8Array(webp.map((byte, index) => index === 15 ? byte ^ 1 : byte)));
      await expect(attachments.getGrokChatAttachmentResponse(
        env, admin.id, conversation.id, stored.id
      )).rejects.toMatchObject({ status: 503, code: 'grok_attachment_integrity_failed' });
      const context = await moduleAt('workers/auth/src/lib/grok-chat-context.js');
      await expect(context.buildGrokChatModelContext(env, {
        adminUserId: admin.id,
        conversationId: conversation.id,
        currentMessage: 'Inspect the synthetic image.',
        attachmentIds: [stored.id],
      })).rejects.toMatchObject({ status: 503, code: 'grok_attachment_integrity_failed' });
      await expect(attachments.getGrokChatAttachmentResponse(
        env, 'another-admin', conversation.id, stored.id
      )).rejects.toMatchObject({ status: 404, code: 'not_found' });
      const deleted = await attachments.deletePendingGrokChatAttachment(
        env, admin.id, conversation.id, stored.id
      );
      expect(deleted).toBe(true);
      expect(DB.database.prepare(
        'SELECT state, deleted_at FROM fable_chat_attachments WHERE id = ?'
      ).get(stored.id)).toMatchObject({ state: 'deleted' });
      await expect(attachments.createGrokChatAttachment(
        env,
        admin.id,
        conversation.id,
        new File([png], 'synthetic.svg', { type: 'image/svg+xml' })
      )).rejects.toMatchObject({ code: 'validation_error' });
    } finally {
      DB.close();
    }
  });

  test('creates immutable model conversations and completes Grok through the shared authenticated stream', async () => {
    const { env, DB, providerCalls } = await createAuthEnv();
    const worker = await loadWorker('workers/auth/src/index.js');
    try {
      const admin = await seedAdmin(env);
      const models = await callAuth(worker, env, '/api/admin/chat/models', { cookie: admin.cookie });
      expect(models.status).toBe(200);
      expect((await models.json()).models.map((model) => model.id)).toEqual([
        'anthropic/claude-fable-5',
        'xai/grok-4.6',
      ]);
      const legacyDefault = await callAuth(worker, env, '/api/admin/chat/conversations', {
        method: 'POST', cookie: admin.cookie, body: {},
      });
      expect(legacyDefault.status).toBe(201);
      expect((await legacyDefault.json()).conversation.model).toBe('anthropic/claude-fable-5');
      const created = await callAuth(worker, env, '/api/admin/chat/conversations', {
        method: 'POST',
        cookie: admin.cookie,
        body: { model: 'xai/grok-4.6', settings: { reasoningEffort: 'medium' } },
      });
      expect(created.status).toBe(201);
      const conversation = (await created.json()).conversation;
      expect(conversation.model).toBe('xai/grok-4.6');
      const modelMutation = await callAuth(
        worker,
        env,
        `/api/admin/chat/conversations/${conversation.id}/settings`,
        { method: 'PATCH', cookie: admin.cookie, body: { model: 'anthropic/claude-fable-5' } }
      );
      expect(modelMutation.status).toBe(400);
      const response = await callAuth(
        worker,
        env,
        `/api/admin/chat/conversations/${conversation.id}/messages/stream`,
        {
          method: 'POST',
          cookie: admin.cookie,
          key: 'grok-shared-stream-key-0001',
          body: { message: 'Synthetic hello.', attachments: [] },
        }
      );
      expect(response.status).toBe(200);
      const responseText = await response.text();
      expect(responseText).toContain('event: final');
      expect(responseText).toContain('Grok integration reply.');
      expect(providerCalls).toHaveLength(1);
      expect(providerCalls[0].url).toBe('https://bitbi-ai.internal/internal/ai/chat/stream');
      expect(providerCalls[0].body).toMatchObject({
        model: 'xai/grok-4.6',
        __bitbi_ai_caller_policy: {
          operation_id: 'admin.chat.send',
          model_id: 'xai/grok-4.6',
        },
      });
      const turn = DB.database.prepare(
        'SELECT model_id, status, usage_json FROM fable_chat_turns WHERE conversation_id = ?'
      ).get(conversation.id);
      expect(turn.model_id).toBe('xai/grok-4.6');
      expect(turn.status).toBe('succeeded');
      expect(JSON.parse(turn.usage_json).provider.cost_in_usd_ticks).toBe('17');
      expect(DB.database.prepare(
        'SELECT model_id, format_version FROM fable_chat_provider_states'
      ).get()).toEqual({
        model_id: 'xai/grok-4.6',
        format_version: 'openai-chat-completions-state-v1',
      });
      expect(DB.database.prepare(
        "SELECT COUNT(*) AS count FROM fable_chat_provider_messages WHERE model_id = 'xai/grok-4.6'"
      ).get().count).toBe(0);
      expect(DB.database.prepare(
        "SELECT COUNT(*) AS count FROM platform_budget_usage_events WHERE operation_key = 'admin.chat.send'"
      ).get().count).toBe(1);
    } finally {
      DB.close();
    }
  });

  test('keeps Grok conversations unavailable through the backward-compatible Fable alias', async () => {
    const { env, DB } = await createAuthEnv();
    const worker = await loadWorker('workers/auth/src/index.js');
    try {
      const admin = await seedAdmin(env);
      const fableResponse = await callAuth(worker, env, '/api/admin/chat/conversations', {
        method: 'POST', cookie: admin.cookie, body: {},
      });
      const grokResponse = await callAuth(worker, env, '/api/admin/chat/conversations', {
        method: 'POST', cookie: admin.cookie, body: { model: 'xai/grok-4.6', settings: {} },
      });
      const fable = (await fableResponse.json()).conversation;
      const grok = (await grokResponse.json()).conversation;
      const neutralList = await callAuth(worker, env, '/api/admin/chat/conversations', {
        cookie: admin.cookie,
      });
      expect((await neutralList.json()).conversations.map((entry) => entry.id).sort())
        .toEqual([fable.id, grok.id].sort());
      const legacyList = await callAuth(worker, env, '/api/admin/fable-chat/conversations', {
        cookie: admin.cookie,
      });
      expect((await legacyList.json()).conversations.map((entry) => entry.id)).toEqual([fable.id]);
      for (const suffix of ['', '/settings']) {
        const response = await callAuth(
          worker,
          env,
          `/api/admin/fable-chat/conversations/${grok.id}${suffix}`,
          { cookie: admin.cookie }
        );
        expect(response.status).toBe(404);
      }
      const send = await callAuth(
        worker,
        env,
        `/api/admin/fable-chat/conversations/${grok.id}/messages`,
        {
          method: 'POST', cookie: admin.cookie, key: 'legacy-grok-isolation-0001',
          body: { message: 'Must not route through the Fable alias.' },
        }
      );
      expect(send.status).toBe(404);
      const adminData = await moduleAt('workers/auth/src/lib/fable-chat-admin-data.js');
      await expect(adminData.mutateFableChatAdminConversation(env, {
        actorAdminUserId: admin.id,
        conversationId: grok.id,
        operation: 'settings',
        body: { expectedRevision: 0, reason: 'Synthetic validation', effort: 'high' },
        idempotencyKey: 'grok-admin-settings-reject-0001',
      })).rejects.toMatchObject({ status: 409, code: 'unsupported_operation' });
    } finally {
      DB.close();
    }
  });

  test('keeps an ambiguous Grok outcome non-retryable and never duplicates provider execution', async () => {
    const { env, DB } = await createAuthEnv();
    const worker = await loadWorker('workers/auth/src/index.js');
    let providerCalls = 0;
    env.AI_LAB = {
      async fetch() {
        providerCalls += 1;
        return new Response(sse([['accepted', { ok: true }]]), {
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8' },
        });
      },
    };
    try {
      const unauthenticated = await callAuth(worker, env, '/api/admin/chat/models');
      expect(unauthenticated.status).toBe(401);
      const admin = await seedAdmin(env);
      const created = await callAuth(worker, env, '/api/admin/chat/conversations', {
        method: 'POST',
        cookie: admin.cookie,
        body: { model: 'xai/grok-4.6', settings: {} },
      });
      const conversation = (await created.json()).conversation;
      const pathname = `/api/admin/chat/conversations/${conversation.id}/messages/stream`;
      const options = {
        method: 'POST',
        cookie: admin.cookie,
        key: 'grok-ambiguous-stream-key-0001',
        body: { message: 'Synthetic ambiguous turn.', attachments: [] },
      };
      const first = await callAuth(worker, env, pathname, options);
      expect(first.status).toBe(200);
      expect(await first.text()).toContain('fable_chat_provider_outcome_unknown');
      expect(DB.database.prepare(
        'SELECT status FROM fable_chat_turns WHERE conversation_id = ?'
      ).get(conversation.id).status).toBe('unknown');
      const second = await callAuth(worker, env, pathname, options);
      expect(second.status).toBe(409);
      expect(await second.text()).toContain('fable_chat_provider_outcome_unknown');
      expect(providerCalls).toBe(1);
    } finally {
      DB.close();
    }
  });

  test('feature flag hides and rejects Grok without affecting neutral Fable creation', async () => {
    const { env, DB } = await createAuthEnv();
    env.ENABLE_GROK_4_6 = 'false';
    const worker = await loadWorker('workers/auth/src/index.js');
    try {
      const admin = await seedAdmin(env);
      const models = await callAuth(worker, env, '/api/admin/chat/models', { cookie: admin.cookie });
      expect((await models.json()).models.map((model) => model.id)).toEqual([
        'anthropic/claude-fable-5',
      ]);
      const rejected = await callAuth(worker, env, '/api/admin/chat/conversations', {
        method: 'POST', cookie: admin.cookie, body: { model: 'xai/grok-4.6', settings: {} },
      });
      expect(rejected.status).toBe(503);
      expect((await rejected.json()).code).toBe('chat_model_disabled');
      const fable = await callAuth(worker, env, '/api/admin/chat/conversations', {
        method: 'POST', cookie: admin.cookie, body: {},
      });
      expect(fable.status).toBe(201);
    } finally {
      DB.close();
    }
  });

  test('isolates Grok context, cache identity, and provider format from Fable conversations', async () => {
    const { env, DB } = await createAuthEnv();
    const worker = await loadWorker('workers/auth/src/index.js');
    try {
      const admin = await seedAdmin(env);
      const make = async (model) => {
        const response = await callAuth(worker, env, '/api/admin/chat/conversations', {
          method: 'POST', cookie: admin.cookie, body: { model, settings: {} },
        });
        return (await response.json()).conversation;
      };
      const fable = await make('anthropic/claude-fable-5');
      const firstGrok = await make('xai/grok-4.6');
      const secondGrok = await make('xai/grok-4.6');
      const contextModule = await moduleAt('workers/auth/src/lib/grok-chat-context.js');
      const memorySelection = {
        mode: 'standard', contractVersion: 1, checkpointId: null,
        checkpointVersion: 0, coverageTurnOrder: -1, summary: null,
      };
      const build = (conversation) => contextModule.buildGrokChatModelContext(env, {
        adminUserId: admin.id,
        conversationId: conversation.id,
        currentMessage: 'Synthetic isolated context.',
        settings: conversation.settings,
        memorySelection,
        attachmentIds: [],
      });
      const first = await build(firstGrok);
      const second = await build(secondGrok);
      expect(first.model).toBe('xai/grok-4.6');
      expect(first.context.contextFormatVersion).toBe('openai-chat-completions-v1');
      expect(first.messages.map((message) => message.role)).toEqual(['system', 'user']);
      expect(first.messages.every((message) => !Array.isArray(message.content))).toBe(true);
      expect(first.promptCacheKey).not.toBe(second.promptCacheKey);
      expect(first.privacyUser).toBe(second.privacyUser);
      await expect(build(fable)).rejects.toMatchObject({ status: 404, code: 'not_found' });
    } finally {
      DB.close();
    }
  });

  test('request fingerprint is stable and rotates with schema, provider settings, and image identity', async () => {
    const turns = await moduleAt('workers/auth/src/lib/grok-chat-turn.js');
    const contract = await moduleAt('workers/shared/grok-chat-contract.mjs');
    const baseSettings = {
      model: 'xai/grok-4.6',
      systemPresetId: 'general',
      systemPresetVersion: 1,
      memoryMode: 'standard',
      adminRevisionVersion: 0,
      providerSettings: contract.normalizeGrokProviderSettings({}),
    };
    const input = {
      conversationId: 'fbc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      message: 'Hello',
      settings: baseSettings,
      memorySelection: { mode: 'standard', contractVersion: 1, coverageTurnOrder: -1 },
      attachmentIdentities: [{
        id: 'fba_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        sha256: 'c'.repeat(64),
        mimeType: 'image/webp',
        byteSize: 10,
        width: 1,
        height: 1,
      }],
    };
    const first = await turns.buildGrokChatRequestFingerprint(input);
    expect(await turns.buildGrokChatRequestFingerprint(input)).toBe(first);
    expect(await turns.buildGrokChatRequestFingerprint({
      ...input,
      attachmentIdentities: [{ ...input.attachmentIdentities[0], sha256: 'd'.repeat(64) }],
    })).not.toBe(first);
    expect(await turns.buildGrokChatRequestFingerprint({
      ...input,
      settings: {
        ...baseSettings,
        providerSettings: contract.normalizeGrokProviderSettings({ responseFormat: {
          type: 'json_schema',
          jsonSchema: {
            name: 'answer',
            schema: {
              type: 'object', additionalProperties: false,
              properties: { value: { type: 'string' } }, required: ['value'],
            },
          },
        } }),
      },
    })).not.toBe(first);
  });
});
