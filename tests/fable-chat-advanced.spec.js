const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
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
    contextFormatVersion: 'native-anthropic-turns-v3',
    webSearchEnabled: false,
    webSearchMaxUses: 3,
    webSearchContractVersion: 2,
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

function webSearchProviderEvents({ stopReason = 'end_turn', includeToolUse = true } = {}) {
  const toolId = 'srvtoolu_search123456';
  const events = [{
    event: 'message_start',
    data: {
      type: 'message_start',
      message: { model: 'claude-fable-5', usage: { input_tokens: 10_567 } },
    },
  }];
  let index = 0;
  if (includeToolUse) {
    events.push(
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index,
          content_block: { type: 'server_tool_use', id: toolId, name: 'web_search' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: '{"query":"current Cloudflare title"}' },
        },
      },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
    );
    index += 1;
  }
  events.push(
    {
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: toolId,
          caller: { type: 'direct' },
          content: [{
            type: 'web_search_result',
            url: 'https://www.cloudflare.com/',
            title: 'Cloudflare',
            encrypted_content: 'encrypted-result-content',
            page_age: null,
          }],
        },
      },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
  );
  index += 1;
  events.push(
    {
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '', citations: [] },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: 'Cloudflare builds for the agent era.' },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index,
        delta: {
          type: 'citations_delta',
          citation: {
            type: 'web_search_result_location',
            url: 'https://www.cloudflare.com/',
            title: 'Cloudflare',
            encrypted_index: 'encrypted-citation-index',
            cited_text: 'Build for the agent era',
          },
        },
      },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
    {
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: 265 },
      },
    },
    { event: 'message_stop', data: { type: 'message_stop' } },
  );
  return events;
}

function countedWebSearchProviderEvents(count) {
  const events = [{
    event: 'message_start',
    data: {
      type: 'message_start',
      message: { model: 'claude-fable-5', usage: { input_tokens: 100 } },
    },
  }];
  let index = 0;
  for (let search = 0; search < count; search += 1) {
    const toolId = `srvtoolu_countedsearch${String(search).padStart(3, '0')}`;
    events.push(
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index,
          content_block: { type: 'server_tool_use', id: toolId, name: 'web_search' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: `{"query":"query ${search}"}` },
        },
      },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
    );
    index += 1;
    events.push(
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index,
          content_block: {
            type: 'web_search_tool_result',
            tool_use_id: toolId,
            content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' },
          },
        },
      },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
    );
    index += 1;
  }
  events.push(
    {
      event: 'content_block_start',
      data: { type: 'content_block_start', index, content_block: { type: 'text', text: 'Done.' } },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
    {
      event: 'message_delta',
      data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    },
    { event: 'message_stop', data: { type: 'message_stop' } },
  );
  return events;
}

test.describe('Advanced Fable chat contract', () => {
  test('Web search effort limits are exact and independently validated through the provider payload', async () => {
    const contract = await import(moduleUrl('workers/shared/fable-chat-contract.mjs'));
    const auth = await import(moduleUrl('workers/auth/src/lib/fable-chat.js'));
    const ai = await import(moduleUrl('workers/ai/src/lib/validate.js'));
    const route = await import(moduleUrl('workers/ai/src/routes/fable-chat.js'));
    const budget = await import(moduleUrl('workers/auth/src/lib/fable-chat-budget.js'));

    expect(contract.FABLE_CHAT_DEFAULT_WEB_SEARCH_ENABLED).toBe(false);
    expect(contract.FABLE_CHAT_WEB_SEARCH_MAX_USES_BY_EFFORT).toEqual({
      medium: 1, high: 3, xhigh: 5, max: 10,
    });
    expect(auth.validateUpdateFableChatSettingsBody({ webSearchEnabled: true }))
      .toEqual({ webSearchEnabled: true });
    expect(() => auth.validateUpdateFableChatSettingsBody({ webSearchEnabled: 'yes' })).toThrow();
    expect(() => auth.validateUpdateFableChatSettingsBody({ tools: [] })).toThrow();
    for (const field of ['webSearchMaxUses', 'max_uses', 'tools']) {
      expect(() => auth.validateSendFableChatBody({ message: 'Hello', [field]: 1 })).toThrow();
    }
    expect(() => ai.validateFableChatBody(validAiBody(undefined, { tools: [] }))).toThrow();
    const legacyAiBody = validAiBody(undefined, { webSearchContractVersion: 1 });
    delete legacyAiBody.webSearchMaxUses;
    expect(ai.validateFableChatBody(legacyAiBody)).toMatchObject({
      webSearchMaxUses: 1,
      webSearchContractVersion: 1,
    });

    const maxTokensByEffort = { medium: 8_192, high: 16_384, xhigh: 32_768, max: 32_768 };
    for (const [effort, maxUses] of Object.entries(contract.FABLE_CHAT_WEB_SEARCH_MAX_USES_BY_EFFORT)) {
      const body = validAiBody(undefined, {
        effort,
        maxTokens: maxTokensByEffort[effort],
        webSearchEnabled: true,
        webSearchMaxUses: maxUses,
      });
      expect(ai.validateFableChatBody(body)).toMatchObject({ effort, webSearchMaxUses: maxUses });
      expect(() => ai.validateFableChatBody({ ...body, webSearchMaxUses: maxUses + 1 })).toThrow();
      expect(budget.deriveFableChatBudgetUnits({
        effort,
        estimatedInputTokens: 1,
        webSearchEnabled: true,
      }).webSearchUnits).toBe(maxUses * budget.FABLE_CHAT_WEB_SEARCH_SURCHARGE_UNITS);
      const calls = [];
      const response = await route.handleFableChat({
        request: new Request('https://bitbi-ai.internal/internal/ai/fable-chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        env: { AI: { run: async (...args) => {
          calls.push(args);
          return {
            content: [{ type: 'text', text: 'No search required.' }],
            model: 'claude-fable-5',
            stop_reason: 'end_turn',
            usage: { input_tokens: 2, output_tokens: 3 },
          };
        } } },
        correlationId: `effort-search-${effort}`,
        pathname: '/internal/ai/fable-chat',
        method: 'POST',
      });
      expect(response.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0][1].tools).toEqual([{
        type: 'web_search_20250305', name: 'web_search', max_uses: maxUses,
      }]);
    }
  });

  test('stream parser accepts each effort boundary and rejects the next search count', async () => {
    const streamModule = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    for (const [maxUses, rejectedCount] of [[1, 2], [3, 4], [5, 6], [10, 11]]) {
      const accepted = await streamModule.consumeAnthropicMessageStream(
        byteStream([encodeSseEvents(countedWebSearchProviderEvents(maxUses))]),
        {},
        { maxWebSearchUses: maxUses }
      );
      expect(accepted).toMatchObject({
        webSearchRequestCount: maxUses,
        webSearchResultCount: maxUses,
      });
      await expect(streamModule.consumeAnthropicMessageStream(
        byteStream([encodeSseEvents(countedWebSearchProviderEvents(rejectedCount))]),
        {},
        { maxWebSearchUses: maxUses }
      )).rejects.toMatchObject({ code: 'provider_web_search_limit_exceeded' });
    }
  });

  test('native Web search accepts the empty citation stream placeholder and persists bounded sources', async () => {
    const streamModule = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const bytes = encodeSseEvents(webSearchProviderEvents(), { crlf: true, comment: true });
    const statuses = [];
    const result = await streamModule.consumeAnthropicMessageStream(
      byteStream([bytes.slice(0, 17), bytes.slice(17, 63), bytes.slice(63)]),
      { onWebSearchStarted: () => statuses.push('search') }
    );
    expect(statuses).toEqual(['search']);
    expect(result).toMatchObject({
      text: 'Cloudflare builds for the agent era.',
      webSearchRequestCount: 1,
      webSearchResultCount: 1,
      sources: [{ url: 'https://www.cloudflare.com/', title: 'Cloudflare' }],
    });
    expect(result.providerBlocks[0]).toMatchObject({
      type: 'server_tool_use',
      name: 'web_search',
      input: { query: 'current Cloudflare title' },
    });
    expect(result.providerBlocks[1].content[0].encrypted_content)
      .toBe('encrypted-result-content');
    expect(result.providerBlocks[2].citations[0].encrypted_index)
      .toBe('encrypted-citation-index');
    expect(JSON.stringify(result.sources)).not.toContain('encrypted');
  });

  test('search-result context is conservatively estimated without mutating private blocks or cache order', async () => {
    const context = await import(moduleUrl('workers/auth/src/lib/fable-chat-context.js'));
    const toolId = 'srvtoolu_contextsearch1';
    const providerBlocks = [
      { type: 'server_tool_use', id: toolId, name: 'web_search', input: { query: 'current data' } },
      {
        type: 'web_search_tool_result',
        tool_use_id: toolId,
        content: [{
          type: 'web_search_result',
          url: 'https://example.com/source',
          title: 'Source',
          encrypted_content: 'x'.repeat(8_192),
          page_age: null,
        }],
      },
      { type: 'text', text: 'Cited answer' },
    ];
    const textOnly = context.estimateFableChatInputTokens({
      system: 'System',
      messages: [{ role: 'user', content: 'Question' }, { role: 'assistant', content: 'Answer' }],
    });
    const withSearch = context.estimateFableChatInputTokens({
      system: 'System',
      messages: [{ role: 'user', content: 'Question' }, { role: 'assistant', content: providerBlocks }],
    });
    expect(withSearch.estimatedInputTokens).toBeGreaterThan(textOnly.estimatedInputTokens + 4_000);

    const selected = context.selectFableChatModelContext({
      system: 'System '.repeat(700),
      priorTurnsNewestFirst: [{ userContent: 'Question', assistantProviderBlocks: providerBlocks }],
      currentMessage: 'Follow up',
      effectiveInputTokenLimit: 30_000,
      totalPriorTurns: 1,
    });
    const storedResult = selected.messages[1].content[1];
    expect(storedResult.content[0].encrypted_content).toBe('x'.repeat(8_192));
    expect(selected.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(selected.messages.at(-1).content).toBe('Follow up');
    expect(JSON.stringify(selected.messages.at(-1))).not.toContain('cache_control');

    const omitted = context.selectFableChatModelContext({
      system: 'System',
      priorTurnsNewestFirst: [{ userContent: 'Question', assistantProviderBlocks: providerBlocks }],
      currentMessage: 'Short follow up',
      effectiveInputTokenLimit: 1_000,
      totalPriorTurns: 1,
    });
    expect(omitted.messages).toEqual([{ role: 'user', content: 'Short follow up' }]);
    expect(omitted.context).toMatchObject({ includedTurns: 0, omittedTurns: 1 });
  });

  test('pause_turn resumes once with the same logical search and normalizes only one browser status', async () => {
    const aiStream = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const authStream = await import(moduleUrl('workers/auth/src/lib/fable-chat-stream.js'));
    const pausedEvents = [
      {
        event: 'message_start',
        data: { type: 'message_start', message: { model: 'claude-fable-5', usage: {} } },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'server_tool_use',
            id: 'srvtoolu_search123456',
            name: 'web_search',
          },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"query":"current Cloudflare title"}' },
        },
      },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
      {
        event: 'message_delta',
        data: { type: 'message_delta', delta: { stop_reason: 'pause_turn' }, usage: {} },
      },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ];
    const paused = encodeSseEvents(pausedEvents);
    const continuation = encodeSseEvents(webSearchProviderEvents({ includeToolUse: false }));
    let continuationCalls = 0;
    const internal = aiStream.createInternalFableChatStream(byteStream([paused]), {
      continueAfterPause: async () => {
        continuationCalls += 1;
        return byteStream([continuation]);
      },
    });
    let searchStatuses = 0;
    const complete = await authStream.consumeInternalFableChatStream(internal, {
      onWebSearchStarted: () => { searchStatuses += 1; },
    });
    expect(continuationCalls).toBe(1);
    expect(searchStatuses).toBe(1);
    expect(complete.webSearchRequestCount).toBe(1);
    expect(complete.sources).toEqual([
      expect.objectContaining({ url: 'https://www.cloudflare.com/' }),
    ]);
  });

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
      expect(ai.validateFableChatBody(validAiBody(undefined, {
        effort,
        maxTokens,
        webSearchMaxUses: contract.getFableChatWebSearchMaxUses(effort),
      })))
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
      expect(estimate.estimatorVersion).toBe('utf8-conservative-v2');
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
      estimatorVersion: 'utf8-conservative-v2',
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

  test('prompt-cache stable prefixes are deterministic and independent of the current user message', async () => {
    const context = await import(moduleUrl('workers/auth/src/lib/fable-chat-context.js'));
    const providerBlocks = [
      { type: 'thinking', thinking: 'Summary', signature: 'opaque-cache-signature' },
      { type: 'text', text: `Stable answer ${'a'.repeat(4_500)}` },
    ];
    const select = (currentMessage) => context.selectFableChatModelContext({
      system: 'Trusted deterministic system',
      priorTurnsNewestFirst: [{
        userContent: `Stable question ${'q'.repeat(2_000)}`,
        assistantProviderBlocks: providerBlocks,
      }],
      currentMessage,
      effectiveInputTokenLimit: 20_000,
      totalPriorTurns: 1,
    });
    const first = select('Current message one');
    const second = select('Different current message two');
    const stableHash = (selection) => createHash('sha256')
      .update(JSON.stringify({ system: selection.system, messages: selection.messages.slice(0, -1) }))
      .digest('hex');

    expect(stableHash(first)).toBe(stableHash(second));
    expect(first.context.cacheBreakpoint).toEqual(second.context.cacheBreakpoint);
    expect(first.messages.at(-1)).toEqual({ role: 'user', content: 'Current message one' });
    expect(JSON.stringify(first.messages.at(-1))).not.toContain('cache_control');
    expect(providerBlocks[0].signature).toBe('opaque-cache-signature');
    expect(providerBlocks[1].cache_control).toBeUndefined();
  });

  test('prompt caching retains the prior stable breakpoint beyond the 20-block lookback', async () => {
    const context = await import(moduleUrl('workers/auth/src/lib/fable-chat-context.js'));
    const ai = await import(moduleUrl('workers/ai/src/lib/validate.js'));
    const searchBlocks = [];
    for (let index = 0; index < 10; index += 1) {
      const toolId = `srvtoolu_cache_search_${String(index).padStart(2, '0')}`;
      searchBlocks.push(
        {
          type: 'server_tool_use',
          id: toolId,
          name: 'web_search',
          input: { query: `public query ${index}` },
        },
        {
          type: 'web_search_tool_result',
          tool_use_id: toolId,
          content: [{
            type: 'web_search_result',
            url: `https://example.com/source-${index}`,
            title: `Source ${index}`,
            encrypted_content: `opaque-result-${index}`,
            page_age: null,
          }],
          caller: { type: 'direct' },
        },
      );
    }
    searchBlocks.push(
      { type: 'text', text: 'Search synthesis preface.' },
      { type: 'text', text: `Search synthesis ${'s'.repeat(3_000)}` },
    );
    const selected = context.selectFableChatModelContext({
      system: 'Trusted system',
      priorTurnsNewestFirst: [
        { userContent: 'Search-heavy follow-up', assistantProviderBlocks: searchBlocks },
        { userContent: 'Earlier stable question', assistantContent: `Earlier stable answer ${'e'.repeat(5_000)}` },
      ],
      currentMessage: 'Current message remains uncached',
      effectiveInputTokenLimit: 96_000,
      totalPriorTurns: 2,
    });
    const cacheLocations = selected.context.cacheBreakpoint.locations;

    expect(cacheLocations).toHaveLength(2);
    expect(cacheLocations[0]).toEqual({ messageIndex: 1, blockIndex: 0 });
    expect(cacheLocations[1]).toEqual({ messageIndex: 3, blockIndex: 21 });
    expect(selected.messages[1].content[0].cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });
    expect(selected.messages[3].content[21].cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });
    expect(ai.validateFableChatBody(validAiBody(selected.messages))).toMatchObject({
      messages: selected.messages,
    });

    const overMarked = JSON.parse(JSON.stringify(selected.messages));
    overMarked[3].content[20].cache_control = { type: 'ephemeral', ttl: '5m' };
    expect(() => ai.validateFableChatBody(validAiBody(overMarked))).toThrow(
      /At most 2 server-owned prompt-cache breakpoints/
    );
  });

  test('provider cache identity changes only for inference-affecting conversation settings', async () => {
    const route = await import(moduleUrl('workers/ai/src/routes/fable-chat.js'));
    const messages = [
      { role: 'user', content: `Stable question ${'q'.repeat(2_000)}` },
      {
        role: 'assistant',
        content: [{
          type: 'text',
          text: `Stable answer ${'a'.repeat(3_000)}`,
          cache_control: { type: 'ephemeral', ttl: '5m' },
        }],
      },
      { role: 'user', content: 'Current message' },
    ];
    const capturePayload = async (overrides = {}) => {
      const calls = [];
      const body = validAiBody(messages, overrides);
      const response = await route.handleFableChat({
        request: new Request('https://bitbi-ai.internal/internal/ai/fable-chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        env: { AI: { run: async (...args) => {
          calls.push(args);
          return {
            content: [{ type: 'text', text: 'Bounded response.' }],
            model: 'claude-fable-5',
            stop_reason: 'end_turn',
            usage: { input_tokens: 2, output_tokens: 3 },
          };
        } } },
        correlationId: 'cache-identity-test',
        pathname: '/internal/ai/fable-chat',
        method: 'POST',
      });
      expect(response.status).toBe(200);
      expect(calls).toHaveLength(1);
      return calls[0][1];
    };
    const identity = (payload) => createHash('sha256').update(JSON.stringify({
      tools: payload.tools || null,
      system: payload.system,
      messages: payload.messages,
      output_config: payload.output_config,
      thinking: payload.thinking,
    })).digest('hex');
    const baseline = await capturePayload();
    const searchEnabled = await capturePayload({ webSearchEnabled: true });
    const mediumSearch = await capturePayload({
      effort: 'medium',
      maxTokens: 8_192,
      webSearchEnabled: true,
      webSearchMaxUses: 1,
    });
    const codingPreset = await capturePayload({ systemPresetId: 'coding' });
    const summarizedThinking = await capturePayload({ thinkingDisplay: 'summarized' });

    expect(searchEnabled.tools).toEqual([{
      type: 'web_search_20250305', name: 'web_search', max_uses: 3,
    }]);
    expect(mediumSearch.tools).toEqual([{
      type: 'web_search_20250305', name: 'web_search', max_uses: 1,
    }]);
    for (const changed of [searchEnabled, mediumSearch, codingPreset, summarizedThinking]) {
      expect(identity(changed)).not.toBe(identity(baseline));
    }
    expect(identity(mediumSearch)).not.toBe(identity(searchEnabled));
    expect(baseline.messages).toEqual(searchEnabled.messages);
    expect(baseline.messages).toEqual(codingPreset.messages);
    expect(baseline.messages).toEqual(summarizedThinking.messages);
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

    expect(streamModule.sanitizeAnthropicContentBlocks([
      {
        type: 'server_tool_use',
        id: 'srvtoolu_errorsearch1',
        name: 'web_search',
        input: { query: 'current data' },
      },
      {
        type: 'web_search_tool_result',
        tool_use_id: 'srvtoolu_errorsearch1',
        content: { type: 'web_search_tool_result_error', error_code: 'unavailable' },
      },
      { type: 'text', text: 'Search was unavailable.' },
    ])).toHaveLength(3);
    expect(() => streamModule.extractAnthropicVisibleResult([
      {
        type: 'server_tool_use',
        id: 'srvtoolu_searchlimit1',
        name: 'web_search',
        input: { query: 'one' },
      },
      {
        type: 'server_tool_use',
        id: 'srvtoolu_searchlimit2',
        name: 'web_search',
        input: { query: 'two' },
      },
      { type: 'text', text: 'Too many.' },
    ])).toThrow(/web-search (?:limit|blocks)/i);
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

  test('migrations 0071 and 0072 preserve legacy one-search defaults and accept effort limits', () => {
    const DB = new SqliteD1Database();
    try {
      applyAuthMigrations(DB, { through: '0070_add_fable_chat_advanced_inference.sql' });
      const now = '2026-07-11T00:00:00.000Z';
      DB.exec(`
        INSERT INTO users (id, email, password_hash, created_at, status, role, updated_at)
        VALUES ('web-admin', 'web-admin@example.com', 'unused', '${now}', 'active', 'admin', '${now}');
        INSERT INTO fable_chat_conversations (
          id, admin_user_id, title, title_source, turn_count, created_at, updated_at
        ) VALUES (
          'fbc_10000000000000000000000000000001', 'web-admin', 'Existing', 'manual', 1, '${now}', '${now}'
        );
        INSERT INTO fable_chat_messages (
          id, conversation_id, message_group_id, admin_user_id, turn_order, role, role_order,
          content, state, metadata_json, created_at, updated_at
        ) VALUES (
          'fbm_10000000000000000000000000000001', 'fbc_10000000000000000000000000000001',
          'fbg_existing', 'web-admin', 0, 'user', 0, 'Existing message', 'failed', '{}', '${now}', '${now}'
        );
        INSERT INTO fable_chat_turns (
          id, conversation_id, admin_user_id, idempotency_key_hash, request_fingerprint,
          user_message_id, status, usage_json, gateway_metadata_json, created_at, updated_at, expires_at
        ) VALUES (
          'fbt_10000000000000000000000000000001', 'fbc_10000000000000000000000000000001',
          'web-admin', 'hash-existing', 'fingerprint-existing', 'fbm_10000000000000000000000000000001',
          'failed', '{}', '{}', '${now}', '${now}', '${now}'
        );
      `);
      DB.exec(fs.readFileSync(
        path.join(process.cwd(), 'workers/auth/migrations/0071_add_fable_chat_web_search.sql'),
        'utf8'
      ));
      expect(DB.database.prepare(
        'SELECT web_search_enabled FROM fable_chat_conversations WHERE admin_user_id = ?'
      ).get('web-admin').web_search_enabled).toBe(0);
      expect(DB.database.prepare(
        'SELECT web_search_enabled, web_search_tool_version, web_search_max_uses FROM fable_chat_turns'
      ).get()).toMatchObject({
        web_search_enabled: 0,
        web_search_tool_version: 'web_search_20250305',
        web_search_max_uses: 1,
      });
      expect(DB.database.prepare(
        'SELECT citations_json, content FROM fable_chat_messages'
      ).get()).toEqual({ citations_json: '[]', content: 'Existing message' });

      DB.exec(fs.readFileSync(
        path.join(process.cwd(), 'workers/auth/migrations/0072_add_fable_web_search_effort_limits.sql'),
        'utf8'
      ));
      expect(DB.database.prepare(
        `SELECT web_search_effective_max_uses, web_search_effective_contract_version,
                web_search_executed_request_count, web_search_executed_result_count
           FROM fable_chat_turns`
      ).get()).toEqual({
        web_search_effective_max_uses: 1,
        web_search_effective_contract_version: 1,
        web_search_executed_request_count: 0,
        web_search_executed_result_count: 0,
      });
      for (const maxUses of [1, 3, 5, 10]) {
        DB.database.prepare(
          `UPDATE fable_chat_turns
              SET web_search_effective_max_uses = ?,
                  web_search_executed_request_count = ?,
                  web_search_executed_result_count = ?`
        ).run(maxUses, maxUses, maxUses);
        expect(DB.database.prepare(
          `SELECT web_search_effective_max_uses, web_search_executed_request_count,
                  web_search_executed_result_count FROM fable_chat_turns`
        ).get()).toEqual({
          web_search_effective_max_uses: maxUses,
          web_search_executed_request_count: maxUses,
          web_search_executed_result_count: maxUses,
        });
      }
    } finally {
      DB.close();
    }
  });
});
