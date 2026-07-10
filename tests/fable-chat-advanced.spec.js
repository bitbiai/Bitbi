const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const {
  SqliteD1Database,
  applyAuthMigrations,
} = require('./helpers/sqlite-d1');

function moduleUrl(relativePath) {
  return pathToFileURL(path.join(process.cwd(), relativePath)).href;
}

function validAiBody(messages = [{ role: 'user', content: 'Hello' }], overrides = {}) {
  return {
    messages,
    effort: 'high',
    maxTokens: 16_384,
    systemPresetId: 'general',
    systemPresetVersion: 1,
    thinkingDisplay: 'omitted',
    promptCachePolicy: 'auto_5m',
    promptCacheVersion: 1,
    contextFormatVersion: 'native-anthropic-turns-v2',
    ...overrides,
  };
}

function byteStream(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function encodeSseEvents(events, { crlf = false, comment = false } = {}) {
  const newline = crlf ? '\r\n' : '\n';
  const prefix = comment ? `: provider ping${newline}${newline}` : '';
  const text = prefix + events.map(({ event, data }) => (
    `event: ${event}${newline}data: ${JSON.stringify(data)}${newline}${newline}`
  )).join('');
  return new TextEncoder().encode(text);
}

function splitBytesInsideEmoji(bytes) {
  const emoji = new TextEncoder().encode('🚀');
  let index = -1;
  for (let candidate = 0; candidate <= bytes.length - emoji.length; candidate += 1) {
    if (emoji.every((value, offset) => bytes[candidate + offset] === value)) {
      index = candidate;
      break;
    }
  }
  expect(index).toBeGreaterThan(0);
  return [
    bytes.slice(0, index + 1),
    bytes.slice(index + 1, index + 3),
    bytes.slice(index + 3),
  ];
}

function completeProviderEvents({ stopReason = 'end_turn' } = {}) {
  return [
    {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          model: 'claude-fable-5',
          usage: {
            input_tokens: 900,
            cache_creation_input_tokens: 700,
            unsafe_detail: 'drop',
          },
        },
      },
    },
    {
      event: 'ping',
      data: { type: 'ping' },
    },
    {
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: 'Plan ', signature: '' },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'carefully 🚀' },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'opaque-signature-v1' },
      },
    },
    {
      event: 'content_block_stop',
      data: { type: 'content_block_stop', index: 0 },
    },
    {
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text', text: 'Grüße ' },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'aus Berlin 🚀' },
      },
    },
    {
      event: 'content_block_stop',
      data: { type: 'content_block_stop', index: 1 },
    },
    {
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: {
          output_tokens: 42,
          cache_read_input_tokens: 640,
          output_tokens_details: { thinking_tokens: 17, unsafe: 'drop' },
        },
      },
    },
    {
      event: 'unknown_future_event',
      data: { type: 'unknown_future_event', bounded: true },
    },
    {
      event: 'message_stop',
      data: { type: 'message_stop' },
    },
  ];
}

test.describe('Advanced Fable chat contract', () => {
  test('effort mapping, high default, presets, and adaptive-only controls are exact', async () => {
    const contract = await import(moduleUrl('workers/shared/fable-chat-contract.mjs'));
    const auth = await import(moduleUrl('workers/auth/src/lib/fable-chat.js'));
    const ai = await import(moduleUrl('workers/ai/src/lib/validate.js'));

    expect(contract.FABLE_CHAT_DEFAULT_EFFORT).toBe('high');
    expect(contract.FABLE_CHAT_EFFORT_OUTPUT_TOKENS).toEqual({
      medium: 8_192,
      high: 16_384,
      xhigh: 32_768,
      max: 32_768,
    });
    expect(contract.FABLE_CHAT_SYSTEM_PRESET_IDS).toEqual([
      'general', 'coding', 'creative', 'precise',
    ]);
    expect(auth.validateCreateFableChatBody({})).toEqual({});
    expect(auth.validateUpdateFableChatSettingsBody({
      effort: 'max',
      systemPresetId: 'coding',
      summarizedThinking: true,
    })).toEqual({
      effort: 'max',
      systemPresetId: 'coding',
      thinkingDisplay: 'summarized',
    });

    for (const [effort, maxTokens] of Object.entries(
      contract.FABLE_CHAT_EFFORT_OUTPUT_TOKENS
    )) {
      expect(ai.validateFableChatBody(validAiBody(undefined, { effort, maxTokens })))
        .toMatchObject({ effort, maxTokens });
    }
    for (const effort of ['low', 'HIGH', '', 'arbitrary']) {
      expect(() => auth.validateCreateFableChatBody({ effort })).toThrow();
      expect(() => ai.validateFableChatBody(validAiBody(undefined, {
        effort,
        maxTokens: 16_384,
      }))).toThrow();
    }
    expect(() => ai.validateFableChatBody(validAiBody(undefined, {
      effort: 'medium',
      maxTokens: 16_384,
    }))).toThrow();

    for (const field of [
      'model', 'max_tokens', 'temperature', 'top_p', 'top_k', 'budget_tokens', 'thinking',
    ]) {
      expect(() => ai.validateFableChatBody(validAiBody(undefined, { [field]: 1 }))).toThrow();
    }
    for (const field of [
      'model', 'maxTokens', 'max_tokens', 'temperature', 'top_p', 'top_k', 'budget_tokens',
    ]) {
      expect(() => auth.validateSendFableChatBody({ message: 'Hello', [field]: 1 })).toThrow();
    }
  });

  test('server-owned preset prompts preserve the trusted base instruction', async () => {
    const contract = await import(moduleUrl('workers/shared/fable-chat-contract.mjs'));
    for (const presetId of contract.FABLE_CHAT_SYSTEM_PRESET_IDS) {
      const prompt = contract.buildFableChatSystemPrompt(presetId, 1);
      expect(prompt.startsWith(contract.FABLE_CHAT_BASE_SYSTEM_PROMPT)).toBe(true);
      expect(prompt).toContain(contract.FABLE_CHAT_SYSTEM_PRESETS[presetId].instruction);
    }
    expect(() => contract.buildFableChatSystemPrompt('browser-supplied', 1)).toThrow();
  });

  test('token estimates are deterministic, conservative labels rather than exact counts', async () => {
    const context = await import(moduleUrl('workers/auth/src/lib/fable-chat-context.js'));
    const samples = [
      'A concise English sentence.',
      'Eine längere deutsche Nachricht mit Umlauten: äöü ÄÖÜ ß.',
      'const answer = values.map((value) => value ** 2);',
      'Emoji and Unicode: 🚀 🧠 👩🏽‍💻 東京',
    ];
    const estimates = samples.map((content) => context.estimateFableChatInputTokens({
      system: 'Trusted system',
      messages: [{ role: 'user', content }],
    }));
    for (const estimate of estimates) {
      expect(estimate.estimatorVersion).toBe('utf8-conservative-v1');
      expect(estimate.estimatedInputTokens).toBeGreaterThan(estimate.rawTokens);
      expect(estimate.estimatedInputTokens).toBeGreaterThan(256);
    }
    expect(context.estimateFableChatInputTokens({
      system: 'Trusted system',
      messages: [{ role: 'user', content: samples[3] }],
    })).toEqual(estimates[3]);
  });

  test('context selects newest complete turns in chronological order and reports omissions', async () => {
    const context = await import(moduleUrl('workers/auth/src/lib/fable-chat-context.js'));
    const selected = context.selectFableChatModelContext({
      system: 'Trusted system',
      priorTurnsNewestFirst: [
        { userContent: 'new user', assistantContent: `new ${'n'.repeat(6_000)}` },
        { userContent: 'middle user', assistantContent: `middle ${'m'.repeat(6_000)}` },
        { userContent: 'old user', assistantContent: `old ${'o'.repeat(6_000)}` },
      ],
      currentMessage: 'current user',
      effectiveInputTokenLimit: 5_000,
      totalPriorTurns: 3,
    });
    expect(selected.messages.map(({ role }) => role)).toEqual(['user', 'assistant', 'user']);
    expect(selected.messages[0].content).toBe('new user');
    expect(selected.messages.at(-1)).toEqual({ role: 'user', content: 'current user' });
    expect(selected.context).toMatchObject({
      includedTurns: 1,
      omittedTurns: 2,
      olderTurnsOmitted: true,
      estimatorVersion: 'utf8-conservative-v1',
    });
    expect(selected.context.estimatedInputTokens).toBeLessThanOrEqual(5_000);
  });

  test('prompt caching marks only an eligible stable tail and preserves thinking signatures', async () => {
    const context = await import(moduleUrl('workers/auth/src/lib/fable-chat-context.js'));
    const signature = 'opaque-signature-never-rewritten';
    const providerBlocks = [
      { type: 'thinking', thinking: 'Summary only', signature },
      { type: 'text', text: `Stable assistant ${'x'.repeat(3_000)}` },
    ];
    const selected = context.selectFableChatModelContext({
      system: 'Trusted system',
      priorTurnsNewestFirst: [{
        userContent: `Stable user ${'u'.repeat(2_000)}`,
        assistantProviderBlocks: providerBlocks,
      }],
      currentMessage: 'Never cache this current message',
      effectiveInputTokenLimit: 20_000,
      totalPriorTurns: 1,
    });
    expect(selected.context.cacheBreakpoint.enabled).toBe(true);
    expect(selected.messages[1].content[0]).toEqual({
      type: 'thinking',
      thinking: 'Summary only',
      signature,
    });
    expect(selected.messages[1].content[1].cache_control).toEqual({
      type: 'ephemeral',
      ttl: '5m',
    });
    expect(selected.messages.at(-1)).toEqual({
      role: 'user',
      content: 'Never cache this current message',
    });
    expect(providerBlocks[1].cache_control).toBeUndefined();

    const short = context.selectFableChatModelContext({
      system: 'Trusted system',
      priorTurnsNewestFirst: [{ userContent: 'short', assistantContent: 'short reply' }],
      currentMessage: 'current',
      effectiveInputTokenLimit: 20_000,
      totalPriorTurns: 1,
    });
    expect(short.context.cacheBreakpoint.enabled).toBe(false);
    expect(JSON.stringify(short.messages)).not.toContain('cache_control');
  });

  test('stream parser handles fragmented UTF-8, CRLF, thinking, text, usage, and max-token completion', async () => {
    const streamModule = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const bytes = encodeSseEvents(completeProviderEvents({ stopReason: 'max_tokens' }), {
      crlf: true,
      comment: true,
    });
    const thinking = [];
    const text = [];
    let keepalives = 0;
    const result = await streamModule.consumeAnthropicMessageStream(
      byteStream(splitBytesInsideEmoji(bytes)),
      {
        onThinkingDelta: (delta) => thinking.push(delta),
        onTextDelta: (delta) => text.push(delta),
        onKeepalive: () => { keepalives += 1; },
      }
    );
    expect(thinking.join('')).toBe('Plan carefully 🚀');
    expect(text.join('')).toBe('Grüße aus Berlin 🚀');
    expect(keepalives).toBe(1);
    expect(result).toMatchObject({
      text: 'Grüße aus Berlin 🚀',
      reasoningSummary: 'Plan carefully 🚀',
      stopReason: 'max_tokens',
      responseModel: 'claude-fable-5',
      usage: {
        input_tokens: 900,
        output_tokens: 42,
        cache_creation_input_tokens: 700,
        cache_read_input_tokens: 640,
        output_tokens_details: { thinking_tokens: 17 },
      },
    });
    expect(result.providerBlocks[0].signature).toBe('opaque-signature-v1');
    expect(JSON.stringify(result.usage)).not.toContain('unsafe');
  });

  test('normalized internal stream never emits signatures and retains them only in final service data', async () => {
    const aiStream = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const authStream = await import(moduleUrl('workers/auth/src/lib/fable-chat-stream.js'));
    const providerStream = byteStream([
      encodeSseEvents(completeProviderEvents({ stopReason: 'refusal' })),
    ]);
    const internal = aiStream.createInternalFableChatStream(providerStream, { startedAt: Date.now() });
    const visibleThinking = [];
    const visibleText = [];
    const complete = await authStream.consumeInternalFableChatStream(internal, {
      onThinkingDelta: (delta) => visibleThinking.push(delta),
      onTextDelta: (delta) => visibleText.push(delta),
    });
    expect(visibleThinking.join('')).toBe('Plan carefully 🚀');
    expect(visibleText.join('')).toBe('Grüße aus Berlin 🚀');
    expect(complete.stopReason).toBe('refusal');
    expect(complete.providerBlocks[0].signature).toBe('opaque-signature-v1');

    const browserVisibleEvents = `${visibleThinking.join('')}${visibleText.join('')}`;
    expect(browserVisibleEvents).not.toContain('opaque-signature');
  });

  test('provider errors are definitive while malformed or interrupted streams remain ambiguous', async () => {
    const streamModule = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const providerError = encodeSseEvents([{
      event: 'error',
      data: { type: 'error', error: { type: 'overloaded_error', message: 'private' } },
    }]);
    await expect(streamModule.consumeAnthropicMessageStream(byteStream([providerError])))
      .rejects.toMatchObject({ code: 'provider_stream_error', definitive: true });

    const malformed = new TextEncoder().encode('event: message_start\ndata: {bad-json}\n\n');
    await expect(streamModule.consumeAnthropicMessageStream(byteStream([malformed])))
      .rejects.toMatchObject({ definitive: false });

    const incomplete = encodeSseEvents(completeProviderEvents().slice(0, -1));
    await expect(streamModule.consumeAnthropicMessageStream(byteStream([incomplete])))
      .rejects.toMatchObject({ definitive: false });

    const neverCompletes = new ReadableStream({ pull() {} });
    const iterator = streamModule.parseSseJsonEvents(neverCompletes, {
      idleTimeoutMs: 1_000,
      maxDurationMs: 5,
    });
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'provider_stream_timeout',
      definitive: false,
    });
  });

  test('migration 0070 preserves legacy text-only success, failure, unknown, and deletion state', () => {
    const DB = new SqliteD1Database();
    try {
      applyAuthMigrations(DB, { through: '0069_add_admin_fable_chat.sql' });
      const now = '2026-07-10T00:00:00.000Z';
      DB.database.prepare(
        `INSERT INTO users (
           id, email, password_hash, created_at, status, role, updated_at, email_verified_at
         ) VALUES (?, ?, 'unused', ?, 'active', 'admin', ?, ?)`
      ).run('legacy-admin', 'legacy@example.com', now, now, now);
      DB.exec(`
        INSERT INTO fable_chat_conversations (
          id, admin_user_id, title, title_source, turn_count, created_at, updated_at, deleted_at
        ) VALUES
          ('fbc_00000000000000000000000000000001', 'legacy-admin', 'Legacy live', 'manual', 3, '${now}', '${now}', NULL),
          ('fbc_00000000000000000000000000000002', 'legacy-admin', 'Legacy deleted', 'manual', 0, '${now}', '${now}', '${now}');
        INSERT INTO fable_chat_messages (
          id, conversation_id, message_group_id, admin_user_id, turn_order, role, role_order,
          content, state, model_id, metadata_json, created_at, updated_at
        ) VALUES
          ('fbm_00000000000000000000000000000001', 'fbc_00000000000000000000000000000001', 'fbg_success', 'legacy-admin', 0, 'user', 0, 'Legacy user', 'succeeded', NULL, '{}', '${now}', '${now}'),
          ('fbm_00000000000000000000000000000002', 'fbc_00000000000000000000000000000001', 'fbg_success', 'legacy-admin', 0, 'assistant', 1, 'Legacy assistant', 'succeeded', 'anthropic/claude-fable-5', '{}', '${now}', '${now}'),
          ('fbm_00000000000000000000000000000003', 'fbc_00000000000000000000000000000001', 'fbg_failed', 'legacy-admin', 1, 'user', 0, 'Failed user', 'failed', NULL, '{}', '${now}', '${now}'),
          ('fbm_00000000000000000000000000000004', 'fbc_00000000000000000000000000000001', 'fbg_unknown', 'legacy-admin', 2, 'user', 0, 'Unknown user', 'unknown', NULL, '{}', '${now}', '${now}');
        INSERT INTO fable_chat_turns (
          id, conversation_id, admin_user_id, idempotency_key_hash, request_fingerprint,
          user_message_id, assistant_message_id, status, context_included_turns,
          context_omitted_turns, context_character_count, usage_json, gateway_metadata_json,
          created_at, updated_at, completed_at, expires_at
        ) VALUES
          ('fbt_00000000000000000000000000000001', 'fbc_00000000000000000000000000000001', 'legacy-admin', 'hash-success', 'request-success', 'fbm_00000000000000000000000000000001', 'fbm_00000000000000000000000000000002', 'succeeded', 0, 0, 20, '{}', '{}', '${now}', '${now}', '${now}', '${now}'),
          ('fbt_00000000000000000000000000000002', 'fbc_00000000000000000000000000000001', 'legacy-admin', 'hash-failed', 'request-failed', 'fbm_00000000000000000000000000000003', NULL, 'failed', 0, 0, 10, '{}', '{}', '${now}', '${now}', '${now}', '${now}'),
          ('fbt_00000000000000000000000000000003', 'fbc_00000000000000000000000000000001', 'legacy-admin', 'hash-unknown', 'request-unknown', 'fbm_00000000000000000000000000000004', NULL, 'unknown', 0, 0, 10, '{}', '{}', '${now}', '${now}', '${now}', '${now}');
      `);

      DB.exec(fs.readFileSync(
        path.join(process.cwd(), 'workers/auth/migrations/0070_add_fable_chat_advanced_inference.sql'),
        'utf8'
      ));
      const conversation = DB.database.prepare(
        'SELECT * FROM fable_chat_conversations WHERE title = ?'
      ).get('Legacy live');
      expect(conversation).toMatchObject({
        effort: 'high',
        system_preset_id: 'general',
        thinking_display: 'omitted',
        prompt_cache_policy: 'auto_5m',
      });
      expect(conversation.title).toBe('Legacy live');
      expect(DB.database.prepare(
        'SELECT content FROM fable_chat_messages WHERE role = ?'
      ).get('assistant').content).toBe('Legacy assistant');
      expect(DB.database.prepare(
        'SELECT status FROM fable_chat_turns ORDER BY id'
      ).all().map(({ status }) => status)).toEqual(['succeeded', 'failed', 'unknown']);
      expect(DB.database.prepare(
        'SELECT deleted_at FROM fable_chat_conversations WHERE title = ?'
      ).get('Legacy deleted').deleted_at).toBe(now);
      expect(DB.database.prepare(
        'SELECT COUNT(*) AS count FROM fable_chat_provider_messages'
      ).get().count).toBe(0);
    } finally {
      DB.close();
    }
  });
});
