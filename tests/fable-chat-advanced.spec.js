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

function currentWebSearchAiBody(overrides = {}) {
  return validAiBody(undefined, {
    webSearchEnabled: true,
    webSearchContractVersion: 3,
    webSearchCallerMode: 'direct',
    webSearchAllowedCallers: ['direct'],
    webSearchResponseInclusion: 'full',
    webSearchEffectiveResponseInclusion: 'full',
    webSearchDomainFilterMode: 'none',
    webSearchAllowedDomains: [],
    webSearchBlockedDomains: [],
    webSearchLocationEnabled: false,
    webSearchLocation: null,
    toolChoice: 'auto',
    ...overrides,
  });
}

function dynamicSearchProviderEvents({ includeNestedResults = false } = {}) {
  const codeId = 'srvtoolu_code12345678';
  const searchId = 'srvtoolu_search123456';
  const caller = { type: 'code_execution_20260120', tool_id: codeId };
  const events = [
    {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: { model: 'claude-fable-5', usage: { input_tokens: 100 } },
      },
    },
    {
      event: 'content_block_start',
      data: {
        type: 'content_block_start', index: 0,
        content_block: { type: 'server_tool_use', id: codeId, name: 'code_execution', input: {} },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta', index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"code":"synthetic filter"}' },
      },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
  ];
  let index = 1;
  if (includeNestedResults) {
    events.push(
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start', index,
          content_block: {
            type: 'server_tool_use', id: searchId, name: 'web_search', input: {}, caller,
          },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta', index,
          delta: { type: 'input_json_delta', partial_json: '{"query":"synthetic query"}' },
        },
      },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
    );
    index += 1;
    events.push(
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start', index,
          content_block: {
            type: 'web_search_tool_result', tool_use_id: searchId, caller,
            content: [{
              type: 'web_search_result', url: 'https://example.test/result',
              title: 'Synthetic result', encrypted_content: 'opaque-result', page_age: null,
            }],
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
      data: {
        type: 'content_block_start', index,
        content_block: {
          type: 'code_execution_tool_result', tool_use_id: codeId,
          content: {
            type: 'encrypted_code_execution_result', encrypted_stdout: 'opaque-code-result',
            stderr: '', return_code: 0, content: [],
          },
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
        type: 'content_block_start', index,
        content_block: { type: 'text', text: '', citations: [] },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta', index,
        delta: { type: 'text_delta', text: 'Synthetic answer.' },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta', index,
        delta: {
          type: 'citations_delta',
          citation: {
            type: 'web_search_result_location', url: 'https://example.test/result',
            title: null, encrypted_index: 'opaque-index', cited_text: 'synthetic excerpt',
          },
        },
      },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
    {
      event: 'message_delta',
      data: {
        type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 20, server_tool_use: { web_search_requests: 1 } },
      },
    },
    { event: 'message_stop', data: { type: 'message_stop' } },
  );
  return events;
}

function byteStream(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function delayedByteStream(entries) {
  return new ReadableStream({
    start(controller) {
      void (async () => {
        for (const { chunk, delayMs = 0 } of entries) {
          if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
          controller.enqueue(chunk);
        }
        controller.close();
      })();
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

function webFetchProviderEvents({
  stopReason = 'end_turn', includeToolUse = true, errorCode = null,
} = {}) {
  const toolId = 'srvtoolu_fetch1234567';
  const events = [{
    event: 'message_start',
    data: {
      type: 'message_start',
      message: { model: 'claude-fable-5', usage: { input_tokens: 120 } },
    },
  }];
  let index = 0;
  if (includeToolUse) {
    events.push(
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start', index,
          content_block: { type: 'server_tool_use', id: toolId, name: 'web_fetch' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta', index,
          delta: { type: 'input_json_delta', partial_json: '{"url":"https://example.test/page"}' },
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
        type: 'content_block_start', index,
        content_block: {
          type: 'web_fetch_tool_result', tool_use_id: toolId,
          content: errorCode ? {
            type: 'web_fetch_tool_result_error', error_code: errorCode,
          } : {
            type: 'web_fetch_result',
            url: 'https://example.test/page',
            content: {
              type: 'document',
              source: { type: 'text', media_type: 'text/plain', data: 'Synthetic public page body.' },
              title: 'Synthetic page',
              citations: { enabled: true },
            },
            retrieved_at: '2026-07-13T10:00:00Z',
          },
        },
      },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
  );
  index += 1;
  events.push(
    {
      event: 'content_block_start',
      data: { type: 'content_block_start', index, content_block: { type: 'text', text: '', citations: [] } },
    },
    {
      event: 'content_block_delta',
      data: { type: 'content_block_delta', index, delta: { type: 'text_delta', text: 'Fetch completed.' } },
    },
    ...(errorCode ? [] : [{
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta', index,
        delta: {
          type: 'citations_delta',
          citation: {
            type: 'char_location', document_index: 0, document_title: 'Synthetic page',
            start_char_index: 0, end_char_index: 9, cited_text: 'Synthetic',
          },
        },
      },
    }]),
    { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
    {
      event: 'message_delta',
      data: {
        type: 'message_delta', delta: { stop_reason: stopReason },
        usage: { output_tokens: 12, server_tool_use: { web_fetch_requests: 1 } },
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

function sequentialTextBlockProviderEvents(count, {
  leaveLastBlockOpen = false,
  duplicateIndex = false,
} = {}) {
  const events = [{
    event: 'message_start',
    data: { type: 'message_start', message: { model: 'claude-fable-5', usage: {} } },
  }];
  for (let index = 0; index < count; index += 1) {
    const providerIndex = duplicateIndex && index === count - 1 ? index - 1 : index;
    events.push({
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index: providerIndex,
        content_block: { type: 'text', text: `synthetic block ${index}` },
      },
    });
    if (!leaveLastBlockOpen || index !== count - 1) {
      events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: providerIndex } });
    }
  }
  events.push(
    {
      event: 'message_delta',
      data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: count } },
    },
    { event: 'message_stop', data: { type: 'message_stop' } },
  );
  return events;
}

function largeTerminalProviderEvents() {
  const events = [{
    event: 'message_start',
    data: { type: 'message_start', message: { model: 'claude-fable-5', usage: {} } },
  }];
  const text = 'München 🎵 — e\u0301';
  for (let index = 0; index < 10; index += 1) {
    const toolId = `srvtoolu_large_${String(index).padStart(8, '0')}`;
    events.push(
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start', index,
          content_block: { type: 'server_tool_use', id: toolId, name: 'web_search' },
        },
      },
      {
        event: 'content_block_delta',
        data: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: `{"query":"test-${index}"}` } },
      },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start', index: index + 10,
          content_block: {
            type: 'web_search_tool_result', tool_use_id: toolId, caller: { type: 'direct' },
            content: [{
              type: 'web_search_result', url: `https://example.test/${index}`,
              title: `Source ${index}`, encrypted_content: 'synthetic-encrypted', page_age: null,
            }],
          },
        },
      },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: index + 10 } },
    );
  }
  events.push(
    {
      event: 'content_block_start',
      data: {
        type: 'content_block_start', index: 20,
        content_block: { type: 'thinking', thinking: 'synthetic', signature: 'synthetic-signature' },
      },
    },
    {
      event: 'content_block_delta',
      data: { type: 'content_block_delta', index: 20, delta: { type: 'thinking_delta', thinking: ' detail' } },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 20 } },
  );
  for (let index = 21; index < 48; index += 1) {
    const citation = index < 31 ? [{
      type: 'web_search_result_location', url: `https://example.test/${index - 21}`,
      title: `Source ${index - 21}`, encrypted_index: 'synthetic-index', cited_text: 'synthetic text',
    }] : [];
    events.push(
      {
        event: 'content_block_start',
        data: { type: 'content_block_start', index, content_block: { type: 'text', text: '', citations: [] } },
      },
      {
        event: 'content_block_delta',
        data: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
      },
      ...citation.map((entry) => ({
        event: 'content_block_delta',
        data: { type: 'content_block_delta', index, delta: { type: 'citations_delta', citation: entry } },
      })),
      { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
    );
  }
  events.push(
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: {} } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  );
  return events;
}

function repeatedNativeCitationTerminalEvents({
  blockCount = 73,
  citation = null,
  sourceTitle = 'Synthetic source',
} = {}) {
  const events = [{
    event: 'message_start',
    data: { type: 'message_start', message: { model: 'claude-fable-5', usage: {} } },
  }];
  const toolId = 'srvtoolu_nativecitation0001';
  events.push(
    {
      event: 'content_block_start',
      data: {
        type: 'content_block_start', index: 0,
        content_block: { type: 'server_tool_use', id: toolId, name: 'web_search' },
      },
    },
    {
      event: 'content_block_delta',
      data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"synthetic"}' } },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    {
      event: 'content_block_start',
      data: {
        type: 'content_block_start', index: 1,
        content_block: {
          type: 'web_search_tool_result', tool_use_id: toolId, caller: { type: 'direct' },
          content: [{
            type: 'web_search_result', url: 'https://source.test/article', title: sourceTitle,
            encrypted_content: 'synthetic-encrypted', page_age: null,
          }],
        },
      },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } },
    {
      event: 'content_block_start',
      data: { type: 'content_block_start', index: 2, content_block: { type: 'thinking', thinking: 'synthetic', signature: 'synthetic-signature' } },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 2 } },
  );
  for (let index = 3; index < blockCount; index += 1) {
    events.push(
      {
        event: 'content_block_start',
        data: { type: 'content_block_start', index, content_block: { type: 'text', text: '', citations: [] } },
      },
      {
        event: 'content_block_delta',
        data: { type: 'content_block_delta', index, delta: { type: 'text_delta', text: `synthetic ${index}` } },
      },
      ...(citation ? [{
        event: 'content_block_delta',
        data: { type: 'content_block_delta', index, delta: { type: 'citations_delta', citation } },
      }] : []),
      { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
    );
  }
  events.push(
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: {} } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  );
  return events;
}

test.describe('Advanced Fable chat contract', () => {
  test('Web Fetch is default-off, independently server-owned, and composes without changing Search-only payloads', async () => {
    const contract = await import(moduleUrl('workers/shared/fable-chat-contract.mjs'));
    const auth = await import(moduleUrl('workers/auth/src/lib/fable-chat.js'));
    const ai = await import(moduleUrl('workers/ai/src/lib/validate.js'));
    const route = await import(moduleUrl('workers/ai/src/routes/fable-chat.js'));
    const expectedFetch = {
      type: 'web_fetch_20260318', name: 'web_fetch', max_uses: 2,
      citations: { enabled: true }, max_content_tokens: 8_000,
      allowed_callers: ['direct'], use_cache: true,
    };
    expect(contract.FABLE_CHAT_DEFAULT_WEB_FETCH_ENABLED).toBe(false);
    expect(auth.validateCreateFableChatBody({})).toEqual({});
    expect(auth.validateUpdateFableChatSettingsBody({ webFetchEnabled: true }))
      .toEqual({ webFetchEnabled: true });
    for (const value of ['yes', 1, null]) {
      expect(() => auth.validateUpdateFableChatSettingsBody({ webFetchEnabled: value })).toThrow();
    }
    for (const field of ['webFetchMaxUses', 'webFetchToolVersion', 'allowed_callers', 'tools']) {
      expect(() => auth.validateSendFableChatBody({ message: 'Hello', [field]: 1 })).toThrow();
    }
    const exactConfig = {
      webFetchEnabled: true,
      webFetchToolVersion: 'web_fetch_20260318',
      webFetchMaxUses: 2,
      webFetchMaxContentTokens: 8_000,
      webFetchAllowedCallers: ['direct'],
      webFetchUseCache: true,
      webFetchContractVersion: 1,
    };
    expect(ai.validateFableChatBody(validAiBody(undefined, exactConfig))).toMatchObject(exactConfig);
    for (const override of [
      { webFetchToolVersion: 'web_fetch_20250910' }, { webFetchMaxUses: 3 },
      { webFetchMaxContentTokens: 9_000 }, { webFetchAllowedCallers: ['code_execution_20250825'] },
      { webFetchUseCache: false }, { webFetchContractVersion: 2 },
    ]) {
      expect(() => ai.validateFableChatBody(validAiBody(undefined, { ...exactConfig, ...override })))
        .toThrow();
    }

    const capture = async (overrides) => {
      const calls = [];
      const response = await route.handleFableChat({
        request: new Request('https://bitbi-ai.internal/internal/ai/fable-chat', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validAiBody(undefined, overrides)),
        }),
        env: { AI: { run: async (...args) => {
          calls.push(args);
          return { content: [{ type: 'text', text: 'Synthetic.' }], stop_reason: 'end_turn', usage: {} };
        } } },
        correlationId: 'fetch-payload-test', pathname: '/internal/ai/fable-chat', method: 'POST',
      });
      expect(response.status).toBe(200);
      return calls[0][1];
    };
    const none = await capture({ webSearchEnabled: false, webFetchEnabled: false });
    const search = await capture({ webSearchEnabled: true, webFetchEnabled: false });
    const fetch = await capture({ webSearchEnabled: false, webFetchEnabled: true });
    const both = await capture({ webSearchEnabled: true, webFetchEnabled: true });
    expect(none.tools).toBeUndefined();
    expect(search.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]);
    expect(fetch.tools).toEqual([expectedFetch]);
    expect(both.tools).toEqual([search.tools[0], expectedFetch]);
  });

  test('Web Fetch streaming, tool errors, citations, and private result handling are strict', async () => {
    const aiStream = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const authStream = await import(moduleUrl('workers/auth/src/lib/fable-chat-stream.js'));
    const context = await import(moduleUrl('workers/auth/src/lib/fable-chat-context.js'));
    const statuses = [];
    const result = await aiStream.consumeAnthropicMessageStream(byteStream([
      encodeSseEvents(webFetchProviderEvents()),
    ]), { onWebFetchStarted: () => statuses.push('fetch') }, { maxWebFetchUses: 2 });
    expect(statuses).toEqual(['fetch']);
    expect(result).toMatchObject({
      text: 'Fetch completed.', webFetchRequestCount: 1, webFetchResultCount: 1,
      webFetchErrorResultCount: 0,
      sources: [{ url: 'https://example.test/page', title: 'Synthetic page' }],
      usage: { server_tool_use: { web_fetch_requests: 1 } },
    });
    expect(result.providerBlocks[1].content.content.source.data).toBe('Synthetic public page body.');
    expect(JSON.stringify(result.sources)).not.toContain('page body');
    expect(context.extractFableChatCitations(result.providerBlocks)).toEqual([
      { type: 'web_search_result_location', url: 'https://example.test/page', title: 'Synthetic page' },
    ]);

    const internal = aiStream.createInternalFableChatStream(byteStream([
      encodeSseEvents(webFetchProviderEvents()),
    ]), { maxWebFetchUses: 2 });
    let normalizedStatuses = 0;
    const complete = await authStream.consumeInternalFableChatStream(internal, {
      onWebFetchStarted: () => { normalizedStatuses += 1; },
    });
    expect(normalizedStatuses).toBe(1);
    expect(complete.webFetchRequestCount).toBe(1);
    expect(complete.aiTerminalWitness).toMatchObject({
      message_stop_seen: true, all_blocks_stopped: true,
      complete_internal_constructed: true, complete_internal_emitted: true,
    });

    for (const errorCode of [
      'invalid_tool_input', 'url_too_long', 'url_not_allowed', 'url_not_in_prior_context',
      'url_not_accessible', 'too_many_requests', 'unsupported_content_type',
      'max_uses_exceeded', 'unavailable',
    ]) {
      const failedFetch = await aiStream.consumeAnthropicMessageStream(byteStream([
        encodeSseEvents(webFetchProviderEvents({ errorCode })),
      ]), {}, { maxWebFetchUses: 2 });
      expect(failedFetch).toMatchObject({
        stopReason: 'end_turn', webFetchRequestCount: 1, webFetchResultCount: 1,
        webFetchErrorResultCount: 1,
      });
    }
    const serialized = JSON.stringify(complete.aiTerminalWitness);
    expect(serialized).not.toContain('example.test');
    expect(serialized).not.toContain('page body');
  });

  test('Web Fetch accepts bounded PDF documents and rejects unsafe provider URLs', async () => {
    const aiStream = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const pdfBlocks = [
      {
        type: 'server_tool_use', id: 'srvtoolu_pdf12345678', name: 'web_fetch',
        input: { url: 'https://example.test/document.pdf' },
      },
      {
        type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_pdf12345678',
        content: {
          type: 'web_fetch_result', url: 'https://example.test/document.pdf',
          content: {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQ=' },
            citations: { enabled: true },
          },
          retrieved_at: '2026-07-13T10:00:00Z',
        },
      },
      { type: 'text', text: 'Synthetic PDF result.', citations: [] },
    ];
    expect(aiStream.sanitizeAnthropicContentBlocks(pdfBlocks)[1])
      .toEqual(pdfBlocks[1]);
    expect(() => aiStream.sanitizeAnthropicContentBlocks([
      { ...pdfBlocks[0], input: { url: 'http://example.test/document.pdf' } },
    ])).toThrow();
    expect(() => aiStream.sanitizeAnthropicContentBlocks([
      {
        ...pdfBlocks[1],
        content: { ...pdfBlocks[1].content, url: 'file:///private/document.pdf' },
      },
    ])).toThrow();
  });

  test('Web Fetch pause_turn reuses the identical server-owned tool configuration', async () => {
    const route = await import(moduleUrl('workers/ai/src/routes/fable-chat.js'));
    const authStream = await import(moduleUrl('workers/auth/src/lib/fable-chat-stream.js'));
    const paused = webFetchProviderEvents().slice(0, 4);
    paused.push(
      { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'pause_turn' }, usage: {} } },
      { event: 'message_stop', data: { type: 'message_stop' } },
    );
    const calls = [];
    const streams = [
      byteStream([encodeSseEvents(paused)]),
      byteStream([encodeSseEvents(webFetchProviderEvents({ includeToolUse: false }))]),
    ];
    const response = await route.handleFableChat({
      request: new Request('https://bitbi-ai.internal/internal/ai/fable-chat/stream', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validAiBody(undefined, { webFetchEnabled: true })),
      }),
      env: { AI: { run: async (...args) => {
        calls.push(args);
        return streams.shift();
      } } },
      correlationId: 'fetch-pause-test', pathname: '/internal/ai/fable-chat/stream', method: 'POST',
    });
    expect(response.status).toBe(200);
    const complete = await authStream.consumeInternalFableChatStream(response.body);
    expect(calls).toHaveLength(2);
    expect(calls[1][1].tools).toEqual(calls[0][1].tools);
    expect(calls[1][1].messages.at(-1)).toEqual({
      role: 'assistant', content: complete.providerBlocks.slice(0, 1),
    });
    expect(complete).toMatchObject({
      webFetchRequestCount: 1, webFetchResultCount: 1, stopReason: 'end_turn',
    });
  });

  test('stale Web Fetch replay is projected only as a complete text-only turn', async () => {
    const aiStream = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const context = await import(moduleUrl('workers/auth/src/lib/fable-chat-context.js'));
    const result = await aiStream.consumeAnthropicMessageStream(byteStream([
      encodeSseEvents(webFetchProviderEvents()),
    ]), {}, { maxWebFetchUses: 2 });
    const unchanged = context.projectFableChatProviderReplay({
      providerBlocks: result.providerBlocks,
      assistantContent: result.text,
      citations: result.sources,
    });
    expect(unchanged.blocks).toEqual(result.providerBlocks);
    const projected = context.projectFableChatProviderReplay({
      providerBlocks: result.providerBlocks,
      assistantContent: result.text,
      citations: result.sources,
      pruneCompletedWebSearch: true,
    });
    expect(projected).toMatchObject({
      prunedPairCount: 1, prunedWebFetchPairCount: 1, projectedNativeTurn: true,
    });
    expect(projected.prunedEstimatedTokens).toBeGreaterThan(0);
    expect(projected.blocks).toEqual([{
      type: 'text',
      text: 'Fetch completed.\n\nSources:\n- Synthetic page: https://example.test/page',
    }]);
    expect(JSON.stringify(projected.blocks)).not.toContain('web_fetch');
    expect(JSON.stringify(projected.blocks)).not.toContain('page body');
    expect(result.providerBlocks[1].content.content.source.data).toBe('Synthetic public page body.');
  });
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

  test('Web Search 20260318 settings are server-owned and dynamic filtering remains private', async () => {
    const contract = await import(moduleUrl('workers/shared/fable-chat-contract.mjs'));
    const auth = await import(moduleUrl('workers/auth/src/lib/fable-chat.js'));
    const ai = await import(moduleUrl('workers/ai/src/lib/validate.js'));
    const route = await import(moduleUrl('workers/ai/src/routes/fable-chat.js'));
    const stream = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));

    expect(contract.FABLE_CHAT_WEB_SEARCH_TOOL_TYPE).toBe('web_search_20260318');
    expect(auth.validateUpdateFableChatSettingsBody({
      webSearchCallerMode: 'dynamic',
      webSearchResponseInclusion: 'excluded',
      webSearchDomainFilterMode: 'allowed',
      webSearchAllowedDomains: ['Docs.Example.com/*', 'docs.example.com/*'],
      webSearchBlockedDomains: ['ads.example.com'],
      webSearchLocationEnabled: true,
      webSearchLocation: { city: 'Berlin', country: 'DE', timezone: 'Europe/Berlin' },
      toolChoice: 'none',
    })).toMatchObject({
      webSearchCallerMode: 'dynamic',
      webSearchResponseInclusion: 'excluded',
      webSearchDomainFilterMode: 'allowed',
      webSearchAllowedDomains: ['docs.example.com/*'],
      webSearchBlockedDomains: ['ads.example.com'],
      webSearchLocationEnabled: true,
      toolChoice: 'none',
    });
    for (const invalidDomain of [
      'https://example.com', '*.example.com', 'ex*.com', 'example.com?query=1',
      'example.com:443', 'exаmple.com',
    ]) {
      expect(() => auth.validateUpdateFableChatSettingsBody({
        webSearchAllowedDomains: [invalidDomain],
      })).toThrow();
    }
    expect(() => auth.validateUpdateFableChatSettingsBody({
      webSearchLocationEnabled: true,
      webSearchLocation: { country: 'de' },
    })).toThrow();
    expect(() => auth.validateUpdateFableChatSettingsBody({ toolChoice: 'any' })).toThrow();
    expect(() => auth.validateUpdateFableChatSettingsBody({
      tools: [{ type: 'web_search_20260318' }],
    })).toThrow();

    const capture = async (body) => {
      const calls = [];
      const response = await route.handleFableChat({
        request: new Request('https://bitbi-ai.internal/internal/ai/fable-chat', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        env: { AI: { run: async (...args) => {
          calls.push(args);
          return {
            content: [{ type: 'text', text: 'Synthetic.' }],
            model: 'claude-fable-5', stop_reason: 'end_turn', usage: {},
          };
        } } },
        correlationId: 'search-20260318-payload',
        pathname: '/internal/ai/fable-chat', method: 'POST',
      });
      expect(response.status).toBe(200);
      expect(calls).toHaveLength(1);
      return calls[0][1];
    };

    const direct = await capture(currentWebSearchAiBody({
      webSearchResponseInclusion: 'excluded',
      webSearchEffectiveResponseInclusion: 'full',
    }));
    expect(direct.tools).toEqual([{
      type: 'web_search_20260318', name: 'web_search', max_uses: 3,
      allowed_callers: ['direct'], response_inclusion: 'full',
    }]);
    expect(direct.tool_choice).toEqual({ type: 'auto' });
    expect(direct.system).not.toContain('Approximate configured location:');

    const dynamic = await capture(currentWebSearchAiBody({
      webSearchCallerMode: 'dynamic',
      webSearchAllowedCallers: ['code_execution_20260120'],
      webSearchResponseInclusion: 'excluded',
      webSearchEffectiveResponseInclusion: 'excluded',
      webSearchDomainFilterMode: 'allowed',
      webSearchAllowedDomains: ['docs.example.com/*'],
      webSearchBlockedDomains: ['ads.example.com'],
      webSearchLocationEnabled: true,
      webSearchLocation: {
        city: 'Trossingen', region: 'Baden-Württemberg',
        country: 'DE', timezone: 'Europe/Berlin',
      },
    }));
    expect(dynamic.tools).toEqual([{
      type: 'web_search_20260318', name: 'web_search', max_uses: 3,
      allowed_callers: ['code_execution_20260120'], response_inclusion: 'excluded',
      allowed_domains: ['docs.example.com/*'],
      user_location: {
        type: 'approximate', city: 'Trossingen', region: 'Baden-Württemberg',
        country: 'DE', timezone: 'Europe/Berlin',
      },
    }]);
    expect(dynamic.system).toContain(
      'Approximate configured location: Trossingen, Baden-Württemberg, DE (Europe/Berlin). Use for local requests; do not ask again.'
    );
    expect(JSON.stringify(dynamic)).not.toContain('ads.example.com');
    expect(dynamic.tools).not.toContainEqual(expect.objectContaining({ type: 'code_execution_20260120' }));

    const clearedLocation = await capture(currentWebSearchAiBody({
      webSearchLocationEnabled: true,
      webSearchLocation: null,
    }));
    expect(clearedLocation.tools[0]).not.toHaveProperty('user_location');
    expect(clearedLocation.system).not.toContain('Approximate configured location:');

    const inactiveLocation = await capture(currentWebSearchAiBody({
      webSearchLocationEnabled: false,
      webSearchLocation: {
        city: 'Trossingen', region: 'Baden-Württemberg',
        country: 'DE', timezone: 'Europe/Berlin',
      },
    }));
    expect(inactiveLocation.tools[0]).not.toHaveProperty('user_location');
    expect(inactiveLocation.system).not.toContain('Approximate configured location:');

    const both = await capture(currentWebSearchAiBody({
      webSearchCallerMode: 'both',
      webSearchAllowedCallers: ['direct', 'code_execution_20260120'],
    }));
    expect(both.tools[0].allowed_callers).toEqual(['direct', 'code_execution_20260120']);

    const noTools = await capture(currentWebSearchAiBody({
      webSearchEnabled: false,
      webFetchEnabled: true,
      toolChoice: 'none',
    }));
    expect(noTools.tools).toEqual([expect.objectContaining({ type: 'web_fetch_20260318' })]);
    expect(noTools.tool_choice).toEqual({ type: 'none' });

    for (const override of [
      { webSearchAllowedCallers: ['direct'] },
      { webSearchEffectiveResponseInclusion: 'full' },
      { webSearchLocation: { city: 'Berlin', type: 'approximate' } },
      { toolChoice: 'tool' },
    ]) {
      expect(() => ai.validateFableChatBody(currentWebSearchAiBody({
        webSearchCallerMode: 'dynamic',
        webSearchAllowedCallers: ['code_execution_20260120'],
        webSearchResponseInclusion: 'excluded',
        webSearchEffectiveResponseInclusion: 'excluded',
        ...override,
      }))).toThrow();
    }

    const excluded = await stream.consumeAnthropicMessageStream(byteStream([
      encodeSseEvents(dynamicSearchProviderEvents()),
    ]), {}, {
      maxWebSearchUses: 3,
      allowDynamicSearch: true,
      allowExcludedSearchResults: true,
    });
    expect(excluded).toMatchObject({
      text: 'Synthetic answer.', webSearchRequestCount: 0,
      webSearchExecutedRequestCount: 1,
      codeExecutionRequestCount: 1, codeExecutionResultCount: 1,
      stopReason: 'end_turn',
    });
    expect(excluded.sources).toEqual([{
      type: 'web_search_result_location',
      url: 'https://example.test/result',
      title: 'Web source',
    }]);
    const full = await stream.consumeAnthropicMessageStream(byteStream([
      encodeSseEvents(dynamicSearchProviderEvents({ includeNestedResults: true })),
    ]), {}, {
      maxWebSearchUses: 3,
      allowDynamicSearch: true,
    });
    expect(full).toMatchObject({
      webSearchRequestCount: 1, webSearchResultCount: 1,
      webSearchExecutedRequestCount: 1,
    });
    await expect(stream.consumeAnthropicMessageStream(byteStream([
      encodeSseEvents(dynamicSearchProviderEvents({ includeNestedResults: true }).map((entry) => {
        if (entry.data?.content_block?.name !== 'web_search') return entry;
        return {
          ...entry,
          data: {
            ...entry.data,
            content_block: {
              ...entry.data.content_block,
              caller: { type: 'code_execution_20260120', tool_id: 'srvtoolu_wrong123456' },
            },
          },
        };
      })),
    ]), {}, {
      maxWebSearchUses: 3,
      allowDynamicSearch: true,
    })).rejects.toMatchObject({ code: 'provider_web_search_blocks_invalid' });
    expect(JSON.stringify(excluded.sources)).not.toContain('opaque');
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

  test('native Web-search citations deduplicate by safe source and finalize a valid 73-block terminal stream', async () => {
    const aiStream = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const aiValidation = await import(moduleUrl('workers/ai/src/lib/validate.js'));
    const authStream = await import(moduleUrl('workers/auth/src/lib/fable-chat-stream.js'));
    const context = await import(moduleUrl('workers/auth/src/lib/fable-chat-context.js'));
    const citation = {
      type: 'web_search_result_location',
      url: 'https://source.test/article',
      title: null,
      encrypted_index: 'synthetic-index',
      cited_text: 'synthetic cited text',
    };
    const internal = aiStream.createInternalFableChatStream(byteStream([
      encodeSseEvents(repeatedNativeCitationTerminalEvents({ citation })),
    ]));
    const complete = await authStream.consumeInternalFableChatStream(internal);

    expect(complete.providerBlocks).toHaveLength(73);
    expect(context.normalizeFableChatProviderBlocks(complete.providerBlocks)).toHaveLength(73);
    expect(complete.sources).toEqual([{
      type: 'web_search_result_location', url: 'https://source.test/article', title: 'Synthetic source',
    }]);
    expect(complete.providerBlocks.find((block) => block.type === 'text' && block.citations?.length)
      .citations[0].title).toBe('Synthetic source');
    expect(complete.aiTerminalWitness).toMatchObject({
      content_block_count: 73,
      stopped_content_block_count: 73,
      all_blocks_stopped: true,
      message_stop_seen: true,
      upstream_eof_seen: true,
      complete_internal_constructed: true,
      complete_internal_emitted: true,
    });
    expect(JSON.stringify(complete.aiTerminalWitness)).not.toContain('source.test');
    expect(JSON.stringify(complete.aiTerminalWitness)).not.toContain('synthetic-index');

    const replayCitation = complete.providerBlocks.find((block) => block.type === 'text' && block.citations?.length)
      .citations[0];
    expect(aiValidation.validateFableChatBody(validAiBody([
      { role: 'user', content: 'previous synthetic turn' },
      {
        role: 'assistant',
        content: Array.from({ length: 17 }, (_, index) => ({
          type: 'text', text: `replayed ${index}`, citations: [replayCitation],
        })),
      },
      { role: 'user', content: 'next synthetic turn' },
    ], { webSearchEnabled: true, webSearchMaxUses: 3 }))).toBeTruthy();

    const fallback = await aiStream.consumeAnthropicMessageStream(byteStream([encodeSseEvents(
      repeatedNativeCitationTerminalEvents({ citation, sourceTitle: '' }),
    )]));
    expect(fallback.sources[0].title).toBe('Web source');
  });

  test('native Web-search citation validation retains strict shape, field, title, URL, and source association checks', async () => {
    const aiStream = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const valid = {
      type: 'web_search_result_location',
      url: 'https://source.test/article',
      title: null,
      encrypted_index: 'synthetic-index',
      cited_text: 'synthetic cited text',
    };
    const invalidCitations = [
      { ...valid, type: 'search_result_location' },
      { ...valid, url: undefined },
      { ...valid, url: 'http://source.test/article' },
      { ...valid, url: 'not a url' },
      { ...valid, title: 'bad\u0000title' },
      { ...valid, title: 'x'.repeat(513) },
      { ...valid, unexpected: 'field' },
      { ...valid, url: 'https://unmatched.test/article' },
    ];
    for (const citation of invalidCitations) {
      await expect(aiStream.consumeAnthropicMessageStream(byteStream([encodeSseEvents(
        repeatedNativeCitationTerminalEvents({ blockCount: 4, citation }),
      )]))).rejects.toThrow();
    }
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

  test('stale replay projection removes only complete web-search pairs and preserves safe continuity', async () => {
    const context = await import(moduleUrl('workers/auth/src/lib/fable-chat-context.js'));
    const signature = 'opaque-signature-remains-byte-identical';
    const toolId = 'srvtoolu_stale_replay_001';
    const providerBlocks = [
      { type: 'thinking', thinking: 'Summary only', signature },
      { type: 'server_tool_use', id: toolId, name: 'web_search', input: { query: 'private query' } },
      {
        type: 'web_search_tool_result',
        tool_use_id: toolId,
        caller: { type: 'direct' },
        content: [{
          type: 'web_search_result',
          url: 'https://example.com/private-result',
          title: 'Private result',
          encrypted_content: 'opaque-encrypted-result',
          page_age: null,
        }],
      },
      {
        type: 'text',
        text: 'Visible answer',
        citations: [{
          type: 'web_search_result_location',
          url: 'https://example.com/source',
          title: 'Example source',
          encrypted_index: 'opaque-index',
          cited_text: 'Private cited text',
        }],
      },
    ];
    const projected = context.projectFableChatProviderReplay({
      providerBlocks,
      assistantContent: 'Visible answer',
      citations: [{
        type: 'web_search_result_location',
        title: 'Example source',
        url: 'https://example.com/source',
      }],
      pruneCompletedWebSearch: true,
    });

    expect(projected.prunedPairCount).toBe(1);
    expect(projected.prunedEstimatedTokens).toBeGreaterThan(0);
    expect(projected.blocks).toEqual([
      {
        type: 'text',
        text: 'Visible answer\n\nSources:\n- Example source: https://example.com/source',
      },
    ]);
    expect(JSON.stringify(projected.blocks)).not.toContain('server_tool_use');
    expect(JSON.stringify(projected.blocks)).not.toContain('web_search_tool_result');
    expect(JSON.stringify(projected.blocks)).not.toContain('opaque-encrypted-result');
    expect(JSON.stringify(projected.blocks)).not.toContain(signature);
    expect(JSON.stringify(projected.blocks)).not.toContain('thinking');
    expect(JSON.stringify(providerBlocks)).toContain('opaque-encrypted-result');
    expect(context.projectFableChatProviderReplay({
      providerBlocks,
      assistantContent: 'Visible answer',
      pruneCompletedWebSearch: false,
    }).blocks).toEqual(context.normalizeFableChatProviderBlocks(providerBlocks));

    const unmatched = providerBlocks.filter((block) => block.type !== 'web_search_tool_result');
    const preserved = context.projectFableChatProviderReplay({
      providerBlocks: unmatched,
      assistantContent: 'Visible answer',
      pruneCompletedWebSearch: true,
    });
    expect(preserved.prunedPairCount).toBe(0);
    expect(preserved.blocks).toEqual(context.normalizeFableChatProviderBlocks(unmatched));
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
      expect(estimate.estimatorVersion).toBe('provider-weighted-v3');
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
      estimatorVersion: 'provider-weighted-v3',
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

  test('provider-weighted estimation and cold projection remove only complete older native turns', async () => {
    const context = await import(moduleUrl('workers/auth/src/lib/fable-chat-context.js'));
    const memory = await import(moduleUrl('workers/auth/src/lib/fable-chat-memory.js'));
    const providerBlocks = [
      { type: 'thinking', thinking: '', signature: 'opaque-native-signature' },
      {
        type: 'text',
        text: 'Keep command npm test, ID svc_001, date 2026-07-13, and USD 42.00.',
      },
    ];
    const weighted = context.estimateFableChatInputTokens({
      system: 'Trusted system',
      messages: [
        { role: 'user', content: 'Preserve exact constraints.' },
        { role: 'assistant', content: providerBlocks },
      ],
      messageMetadata: [{}, { recordedThinkingTokens: 6_000 }],
    });
    expect(weighted.breakdown.thinkingSignatureTokens).toBe(6_000);
    expect(weighted.breakdown.visibleMessageTokens).toBeGreaterThan(0);
    expect(weighted.breakdown.visibleUserTokens).toBeGreaterThan(0);
    expect(weighted.breakdown.visibleAssistantTokens).toBeGreaterThan(0);
    expect(weighted.breakdown.protocolOverheadTokens).toBeGreaterThan(0);
    const withoutSearchConfiguration = context.estimateFableChatProviderConfigurationTokens({
      effort: 'max',
      thinkingDisplay: 'omitted',
      webSearchEnabled: false,
      webSearchMaxUses: 10,
    });
    const withSearchConfiguration = context.estimateFableChatProviderConfigurationTokens({
      effort: 'max',
      thinkingDisplay: 'omitted',
      webSearchEnabled: true,
      webSearchMaxUses: 10,
    });
    expect(withSearchConfiguration).toBeGreaterThan(withoutSearchConfiguration);

    const hot = context.projectFableChatProviderReplay({
      providerBlocks,
      assistantContent: providerBlocks[1].text,
    });
    expect(hot.blocks).toEqual(providerBlocks);
    const cold = context.projectFableChatProviderReplay({
      providerBlocks,
      assistantContent: providerBlocks[1].text,
      projectCompletedNativeTurn: true,
      recordedThinkingTokens: 6_000,
    });
    expect(cold.projectedNativeTurn).toBe(true);
    expect(cold.blocks).toEqual([{ type: 'text', text: providerBlocks[1].text }]);
    expect(cold.prunedEstimatedTokens).toBeGreaterThan(5_900);
    expect(JSON.stringify(cold.blocks)).not.toContain('thinking');
    expect(JSON.stringify(cold.blocks)).not.toContain('signature');
    expect(providerBlocks[0].signature).toBe('opaque-native-signature');

    const eligible = memory.evaluateFableChatStandardProviderTrigger({
      predictedCacheWriteTokens: 33_373,
      totalEnvelopeTokens: 56_313 + 32_768 + 4_096,
      selectedSourceTokens: 16_000,
      estimatedCompactionInputTokens: 12_000,
    });
    expect(eligible).toMatchObject({
      eligible: true,
      triggerReason: 'predicted_cold_cache_write',
      pressureEligible: true,
      savingsEligible: true,
      hysteresisEligible: true,
    });
    expect(eligible.expectedSavingsUsd).toBeGreaterThan(0.1);
    expect(memory.evaluateFableChatStandardProviderTrigger({
      predictedCacheWriteTokens: 17_999,
      totalEnvelopeTokens: 90_000,
      selectedSourceTokens: 16_000,
      estimatedCompactionInputTokens: 12_000,
    }).eligible).toBe(false);
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

  test('Fable provider idle policy is 300 seconds and valid ping, thinking, and search activity reset it', async () => {
    const contract = await import(moduleUrl('workers/shared/fable-chat-contract.mjs'));
    const streamModule = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const authStream = await import(moduleUrl('workers/auth/src/lib/fable-chat-stream.js'));
    expect(contract.FABLE_PROVIDER_STREAM_IDLE_TIMEOUT_MS).toBe(300_000);
    expect(authStream.FABLE_AUTH_INTERNAL_STREAM_IDLE_TIMEOUT_MS).toBe(330_000);
    expect(contract.FABLE_CHAT_GENERATION_TIMEOUT_MS).toBe(25 * 60_000);

    const completeEvents = completeProviderEvents();
    const thinkingResult = await streamModule.consumeAnthropicMessageStream(delayedByteStream([
      { chunk: encodeSseEvents(completeEvents.slice(0, 2)) },
      { chunk: encodeSseEvents(completeEvents.slice(2, 5)), delayMs: 20 },
      { chunk: encodeSseEvents(completeEvents.slice(5)), delayMs: 20 },
    ]), {}, { providerIdleTimeoutMs: 30 });
    expect(thinkingResult.stopReason).toBe('end_turn');

    const searchEvents = webSearchProviderEvents();
    const searchResult = await streamModule.consumeAnthropicMessageStream(delayedByteStream([
      { chunk: encodeSseEvents(searchEvents.slice(0, 2)) },
      { chunk: encodeSseEvents(searchEvents.slice(2)), delayMs: 20 },
    ]), {}, { providerIdleTimeoutMs: 30 });
    expect(searchResult.webSearchRequestCount).toBe(1);

    const deadStream = new ReadableStream({ pull() {} });
    await expect(streamModule.consumeAnthropicMessageStream(deadStream, {}, {
      providerIdleTimeoutMs: 5,
    })).rejects.toMatchObject({ code: 'provider_stream_idle_timeout', definitive: false });
  });

  test('terminal witnesses are bounded and never expose provider content', async () => {
    const aiStream = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const authStream = await import(moduleUrl('workers/auth/src/lib/fable-chat-stream.js'));
    const aiWitnesses = [];
    const authWitnesses = [];
    const internal = aiStream.createInternalFableChatStream(byteStream([
      encodeSseEvents(completeProviderEvents()),
    ]), {
      onTerminalWitness: (witness) => aiWitnesses.push(witness),
    });
    const complete = await authStream.consumeInternalFableChatStream(internal, {
      onTerminalWitness: (witness) => authWitnesses.push(witness),
    });

    expect(aiWitnesses).toHaveLength(1);
    expect(authWitnesses).toHaveLength(1);
    expect(complete.authTerminalWitness).toMatchObject({
      accepted_seen: true,
      complete_internal_seen: true,
      ai_response_body_ended: true,
    });
    expect(complete.aiTerminalWitness).toMatchObject({
      termination_phase: 'complete_internal',
      message_start_seen: true,
      message_stop_seen: true,
      all_blocks_stopped: true,
      complete_internal_emitted: true,
    });
    const diagnostics = JSON.stringify({ aiWitnesses, authWitnesses, complete: complete.aiTerminalWitness });
    expect(diagnostics).not.toContain('Grüße');
    expect(diagnostics).not.toContain('opaque-signature');
    expect(diagnostics).not.toContain('encrypted');

    const incomplete = aiStream.createInternalFableChatStream(byteStream([
      encodeSseEvents(completeProviderEvents().slice(0, -1)),
    ]));
    await expect(authStream.consumeInternalFableChatStream(incomplete)).rejects.toMatchObject({
      code: 'provider_upstream_eof_before_message_stop',
      outcome: 'unknown',
      terminalWitness: expect.objectContaining({
        accepted_seen: true,
        complete_internal_seen: false,
      }),
    });
  });

  test('stream boundary diagnostics distinguish reads, SSE parsing, and Web Search validation', async () => {
    const aiStream = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const authStream = await import(moduleUrl('workers/auth/src/lib/fable-chat-stream.js'));

    const consumeWithWitness = async (providerStream, options = {}) => {
      const witnesses = [];
      const internal = aiStream.createInternalFableChatStream(providerStream, {
        maxWebSearchUses: 3,
        onTerminalWitness: (witness) => witnesses.push(witness),
        ...options,
      });
      try {
        const complete = await authStream.consumeInternalFableChatStream(internal);
        return { complete, error: null, witness: witnesses[0] };
      } catch (error) {
        return { complete: null, error, witness: witnesses[0] };
      }
    };

    const delayedEvents = webSearchProviderEvents();
    const delayedResultIndex = delayedEvents.findIndex(
      ({ data }) => data?.content_block?.type === 'web_search_tool_result'
    );
    const accepted = await consumeWithWitness(delayedByteStream([
      { chunk: encodeSseEvents(delayedEvents.slice(0, delayedResultIndex)) },
      { chunk: encodeSseEvents(delayedEvents.slice(delayedResultIndex)), delayMs: 1 },
    ]));
    expect(accepted.error).toBeNull();
    expect(accepted.complete.webSearchResultCount).toBe(1);
    expect(accepted.witness).toMatchObject({
      termination_phase: 'complete_internal',
      stream_boundary_category: 'provider_web_search_result_accepted',
      last_read_lifecycle: 'read_done',
      read_done_seen: true,
      read_rejected_seen: false,
      last_sse_parse_lifecycle: 'sse_parse_succeeded',
      last_received_provider_event_type: 'message_stop',
      web_search_result_validation_lifecycle: 'validation_succeeded',
      web_search_result_validation_started_count: 1,
      web_search_result_validation_succeeded_count: 1,
      web_search_result_validation_failed_count: 0,
      web_search_result_rejection_category: 'none',
      complete_internal_emitted: true,
    });
    expect(accepted.witness.read_started_count).toBeGreaterThan(1);
    expect(accepted.witness.read_resolved_count).toBe(accepted.witness.read_started_count);
    expect(accepted.witness.provider_event_received_count).toBe(delayedEvents.length);
    expect(accepted.witness.sse_parse_succeeded_count).toBe(delayedEvents.length);

    const privateReaderMarker = 'private-reader-error-marker';
    let readerChunkSent = false;
    const rejectingStream = new ReadableStream({
      pull(controller) {
        if (!readerChunkSent) {
          readerChunkSent = true;
          controller.enqueue(encodeSseEvents(webSearchProviderEvents().slice(0, 4)));
          return;
        }
        throw new Error(privateReaderMarker);
      },
    });
    const rejectedRead = await consumeWithWitness(rejectingStream);
    expect(rejectedRead.error).toMatchObject({
      code: 'provider_stream_interrupted',
      outcome: 'unknown',
    });
    expect(rejectedRead.witness).toMatchObject({
      stream_boundary_category: 'provider_stream_read_rejected',
      last_read_lifecycle: 'read_rejected',
      read_rejected_seen: true,
      read_done_seen: false,
      complete_internal_emitted: false,
    });

    const unexpectedlyDone = await consumeWithWitness(byteStream([
      encodeSseEvents(webSearchProviderEvents().slice(0, 4)),
    ]));
    expect(unexpectedlyDone.error).toMatchObject({
      code: 'provider_upstream_eof_before_message_stop',
      outcome: 'unknown',
    });
    expect(unexpectedlyDone.witness).toMatchObject({
      stream_boundary_category: 'provider_stream_unexpected_done',
      last_read_lifecycle: 'read_done',
      read_done_seen: true,
      read_rejected_seen: false,
      complete_internal_emitted: false,
    });

    const invalidEvents = webSearchProviderEvents();
    const invalidResult = invalidEvents.find(
      ({ data }) => data?.content_block?.type === 'web_search_tool_result'
    );
    invalidResult.data.content_block.content[0] = {
      ...invalidResult.data.content_block.content[0],
      unsupported_private_field: 'private-shape-marker',
      title: 'private-title-marker',
      encrypted_content: 'private-result-marker',
    };
    const invalidSearchResult = await consumeWithWitness(byteStream([
      encodeSseEvents(invalidEvents),
    ]));
    expect(invalidSearchResult.error).toMatchObject({
      code: 'provider_invalid_web_search_structure',
      outcome: 'unknown',
    });
    expect(invalidSearchResult.witness).toMatchObject({
      stream_boundary_category: 'provider_web_search_result_invalid',
      last_received_provider_event_type: 'content_block_start',
      last_received_content_block_index: 1,
      last_received_block_type: 'web_search_tool_result',
      web_search_result_validation_lifecycle: 'validation_failed',
      web_search_result_validation_started_count: 1,
      web_search_result_validation_succeeded_count: 0,
      web_search_result_validation_failed_count: 1,
      web_search_result_rejection_category: 'invalid_result_shape',
      complete_internal_emitted: false,
    });

    const malformedSse = await consumeWithWitness(byteStream([
      new TextEncoder().encode('event: content_block_start\ndata: {private-raw-sse-marker}\n\n'),
    ]));
    expect(malformedSse.error).toMatchObject({
      code: 'provider_stream_interrupted',
      outcome: 'unknown',
    });
    expect(malformedSse.witness).toMatchObject({
      stream_boundary_category: 'provider_sse_parse_failed',
      last_sse_parse_lifecycle: 'sse_parse_failed',
      sse_parse_failed_count: 1,
      sse_parse_failure_category: 'malformed_json',
      complete_internal_emitted: false,
    });

    const diagnostics = JSON.stringify([
      accepted.witness,
      rejectedRead.witness,
      unexpectedlyDone.witness,
      invalidSearchResult.witness,
      malformedSse.witness,
    ]);
    for (const privateValue of [
      privateReaderMarker,
      'private-shape-marker',
      'private-title-marker',
      'private-result-marker',
      'private-raw-sse-marker',
    ]) {
      expect(diagnostics).not.toContain(privateValue);
    }
  });

  test('quarantines one invalid Web Search result URL and completes with safe results only', async () => {
    const aiStream = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const authStream = await import(moduleUrl('workers/auth/src/lib/fable-chat-stream.js'));
    const context = await import(moduleUrl('workers/auth/src/lib/fable-chat-context.js'));
    const invalidUrl = 'http://unsafe.invalid/private-result';
    const events = webSearchProviderEvents();
    const resultEvent = events.find(
      ({ data }) => data?.content_block?.type === 'web_search_tool_result'
    );
    const first = resultEvent.data.content_block.content[0];
    resultEvent.data.content_block.content = [
      first,
      {
        type: 'web_search_result',
        url: invalidUrl,
        title: 'Quarantined synthetic result',
        encrypted_content: 'quarantined-encrypted-content',
        page_age: null,
      },
      {
        type: 'web_search_result',
        url: 'https://example.test/second-safe-result',
        title: 'Second safe result',
        encrypted_content: 'second-safe-encrypted-content',
        page_age: null,
      },
    ];
    const textStopIndex = events.findIndex(({ data }) => (
      data?.type === 'content_block_stop' && data.index === 2
    ));
    events.splice(textStopIndex, 0, {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 2,
        delta: {
          type: 'citations_delta',
          citation: {
            type: 'web_search_result_location',
            url: 'https://example.test/second-safe-result',
            title: 'Second safe result',
            encrypted_index: 'second-safe-index',
            cited_text: 'second safe excerpt',
          },
        },
      },
    });

    const witnesses = [];
    const internal = aiStream.createInternalFableChatStream(byteStream([
      encodeSseEvents(events),
    ]), {
      maxWebSearchUses: 3,
      onTerminalWitness: (witness) => witnesses.push(witness),
    });
    const complete = await authStream.consumeInternalFableChatStream(internal);
    const privateSearchBlock = complete.providerBlocks.find(
      (block) => block.type === 'web_search_tool_result'
    );

    expect(complete).toMatchObject({
      stopReason: 'end_turn',
      webSearchReceivedResultCount: 3,
      webSearchAcceptedResultCount: 2,
      webSearchQuarantinedInvalidUrlCount: 1,
      webSearchRequestCount: 1,
      webSearchResultCount: 1,
    });
    expect(privateSearchBlock.content).toHaveLength(2);
    expect(complete.sources).toEqual([
      expect.objectContaining({ url: 'https://www.cloudflare.com/' }),
      expect.objectContaining({ url: 'https://example.test/second-safe-result' }),
    ]);
    expect(witnesses).toHaveLength(1);
    expect(witnesses[0]).toMatchObject({
      termination_phase: 'complete_internal',
      message_delta_seen: true,
      message_stop_seen: true,
      complete_internal_constructed: true,
      complete_internal_emitted: true,
      stream_boundary_category: 'provider_web_search_result_quarantined',
      web_search_received_result_count: 3,
      web_search_accepted_result_count: 2,
      web_search_quarantined_invalid_url_count: 1,
    });

    const projected = context.projectFableChatProviderReplay({
      providerBlocks: complete.providerBlocks,
      assistantContent: complete.text,
      citations: complete.sources,
      projectCompletedNativeTurn: true,
    });
    expect(projected.projectedNativeTurn).toBe(true);
    expect(projected.blocks).toHaveLength(1);
    const safeRepresentations = JSON.stringify({
      complete,
      witness: witnesses[0],
      projected: projected.blocks,
    });
    expect(safeRepresentations).not.toContain(invalidUrl);
    expect(safeRepresentations).not.toContain('quarantined-encrypted-content');

    const allInvalidEvents = webSearchProviderEvents();
    const allInvalidResult = allInvalidEvents.find(
      ({ data }) => data?.content_block?.type === 'web_search_tool_result'
    );
    allInvalidResult.data.content_block.content = [
      { ...first, url: 'http://unsafe.invalid/one' },
      { ...first, url: 'data:text/plain,unsafe' },
    ];
    const withoutCitations = allInvalidEvents.filter(
      ({ data }) => data?.delta?.type !== 'citations_delta'
    );
    const allInvalid = await aiStream.consumeAnthropicMessageStream(byteStream([
      encodeSseEvents(withoutCitations),
    ]), {}, { maxWebSearchUses: 3 });
    expect(allInvalid.text).toBe('Cloudflare builds for the agent era.');
    expect(allInvalid.webSearchAcceptedResultCount).toBe(0);
    expect(allInvalid.webSearchQuarantinedInvalidUrlCount).toBe(2);
    expect(allInvalid.sources).toEqual([]);

    const structurallyUnsafeEvents = webSearchProviderEvents();
    const structurallyUnsafeResult = structurallyUnsafeEvents.find(
      ({ data }) => data?.content_block?.type === 'web_search_tool_result'
    );
    structurallyUnsafeResult.data.content_block.content[0] = {
      ...first,
      url: 'http://unsafe.invalid/also-has-an-oversized-title',
      title: 'x'.repeat(513),
    };
    await expect(aiStream.consumeAnthropicMessageStream(byteStream([
      encodeSseEvents(structurallyUnsafeEvents),
    ]), {}, { maxWebSearchUses: 3 })).rejects.toMatchObject({
      code: 'provider_invalid_web_search_structure',
    });
  });

  test('a valid 48-block terminal stream with 10 searches and split Unicode constructs complete_internal once', async () => {
    const aiStream = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const authStream = await import(moduleUrl('workers/auth/src/lib/fable-chat-stream.js'));
    const context = await import(moduleUrl('workers/auth/src/lib/fable-chat-context.js'));
    const bytes = encodeSseEvents(largeTerminalProviderEvents());
    const chunks = [...bytes].map((byte) => Uint8Array.of(byte));
    const direct = await aiStream.consumeAnthropicMessageStream(byteStream(chunks), {}, {
      maxWebSearchUses: 10,
    });
    expect(direct.providerBlocks).toHaveLength(48);
    const internal = aiStream.createInternalFableChatStream(byteStream(chunks), {
      maxWebSearchUses: 10,
    });
    const complete = await authStream.consumeInternalFableChatStream(internal);

    expect(complete.providerBlocks).toHaveLength(48);
    expect(context.normalizeFableChatProviderBlocks(complete.providerBlocks)).toHaveLength(48);
    expect(complete.webSearchRequestCount).toBe(10);
    expect(complete.webSearchResultCount).toBe(10);
    expect(complete.text).toContain('München 🎵 — e\u0301');
    expect(complete.text).not.toContain('\uFFFD');
    expect(complete.aiTerminalWitness).toMatchObject({
      message_delta_seen: true,
      message_stop_seen: true,
      all_blocks_stopped: true,
      content_block_count: 48,
      stopped_content_block_count: 48,
      complete_internal_constructed: true,
      complete_internal_emitted: true,
    });

    const escapedSurrogate = new TextEncoder().encode([
      'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-fable-5","usage":{}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"\\ud83c\\udfb5"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join(''));
    const escapedResult = await aiStream.consumeAnthropicMessageStream(
      byteStream([...escapedSurrogate].map((byte) => Uint8Array.of(byte)))
    );
    expect(escapedResult.text).toBe('🎵');
  });

  test('uses the canonical 128-block ceiling without weakening stream lifecycle validation', async () => {
    const aiStream = await import(moduleUrl('workers/ai/src/lib/anthropic-stream.js'));
    const authStream = await import(moduleUrl('workers/auth/src/lib/fable-chat-stream.js'));
    const context = await import(moduleUrl('workers/auth/src/lib/fable-chat-context.js'));
    const contract = await import(moduleUrl('workers/shared/fable-chat-contract.mjs'));

    expect(contract.FABLE_CHAT_MAX_PROVIDER_BLOCKS).toBe(128);
    expect(contract.FABLE_CHAT_MAX_PROVIDER_STREAM_BYTES).toBe(4 * 1024 * 1024);
    expect(contract.FABLE_CHAT_MAX_PROVIDER_EVENT_BYTES).toBe((3 * 1024 * 1024) + (64 * 1024));
    expect(contract.FABLE_PROVIDER_STREAM_IDLE_TIMEOUT_MS).toBe(300_000);
    expect(authStream.FABLE_AUTH_INTERNAL_STREAM_IDLE_TIMEOUT_MS).toBe(330_000);

    for (const count of [64, 65, 128]) {
      const result = await aiStream.consumeAnthropicMessageStream(
        byteStream([encodeSseEvents(sequentialTextBlockProviderEvents(count))]),
      );
      expect(result.providerBlocks).toHaveLength(count);
      expect(context.normalizeFableChatProviderBlocks(result.providerBlocks)).toHaveLength(count);
    }

    await expect(aiStream.consumeAnthropicMessageStream(
      byteStream([encodeSseEvents(sequentialTextBlockProviderEvents(129))]),
    )).rejects.toMatchObject({ code: 'provider_invalid_block_lifecycle' });

    await expect(aiStream.consumeAnthropicMessageStream(
      byteStream([encodeSseEvents(sequentialTextBlockProviderEvents(128, { leaveLastBlockOpen: true }))]),
    )).rejects.toMatchObject({ code: 'provider_invalid_block_lifecycle' });

    await expect(aiStream.consumeAnthropicMessageStream(
      byteStream([encodeSseEvents(sequentialTextBlockProviderEvents(2, { duplicateIndex: true }))]),
    )).rejects.toMatchObject({ code: 'provider_invalid_block_lifecycle' });
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

  test('migration 0077 preserves existing Direct behavior and immutable prior turn contracts', () => {
    const DB = new SqliteD1Database();
    try {
      applyAuthMigrations(DB, { through: '0076_add_fable_chat_web_fetch.sql' });
      const now = '2026-07-14T00:00:00.000Z';
      DB.exec(`
        INSERT INTO users (id, email, password_hash, created_at, status, role, updated_at)
        VALUES ('search-upgrade-admin', 'upgrade@example.com', 'unused', '${now}', 'active', 'admin', '${now}');
        INSERT INTO fable_chat_conversations (
          id, admin_user_id, title, title_source, turn_count, web_search_enabled,
          created_at, updated_at
        ) VALUES (
          'fbc_20000000000000000000000000000001', 'search-upgrade-admin', 'Existing',
          'manual', 1, 1, '${now}', '${now}'
        );
        INSERT INTO fable_chat_messages (
          id, conversation_id, message_group_id, admin_user_id, turn_order, role, role_order,
          content, state, metadata_json, created_at, updated_at
        ) VALUES (
          'fbm_20000000000000000000000000000001',
          'fbc_20000000000000000000000000000001', 'fbg_upgrade', 'search-upgrade-admin',
          0, 'user', 0, 'Synthetic', 'failed', '{}', '${now}', '${now}'
        );
        INSERT INTO fable_chat_turns (
          id, conversation_id, admin_user_id, idempotency_key_hash, request_fingerprint,
          user_message_id, status, web_search_enabled, web_search_effective_max_uses,
          web_search_effective_contract_version, usage_json, gateway_metadata_json,
          created_at, updated_at, expires_at
        ) VALUES (
          'fbt_20000000000000000000000000000001',
          'fbc_20000000000000000000000000000001', 'search-upgrade-admin',
          'hash-upgrade', 'fingerprint-upgrade', 'fbm_20000000000000000000000000000001',
          'failed', 1, 3, 2, '{}', '{}', '${now}', '${now}', '${now}'
        );
      `);
      DB.exec(fs.readFileSync(
        path.join(process.cwd(), 'workers/auth/migrations/0077_upgrade_fable_web_search.sql'),
        'utf8'
      ));
      const conversation = DB.database.prepare(
        `SELECT web_search_enabled, web_search_settings_json, fable_tool_choice
           FROM fable_chat_conversations`
      ).get();
      expect(conversation.web_search_enabled).toBe(1);
      expect(JSON.parse(conversation.web_search_settings_json)).toEqual({
        toolVersion: 'web_search_20260318', contractVersion: 3, callerMode: 'direct',
        responseInclusion: 'full', domainFilterMode: 'none', allowedDomains: [],
        blockedDomains: [], locationEnabled: false, location: null,
      });
      expect(conversation.fable_tool_choice).toBe('auto');
      const turn = DB.database.prepare(
        `SELECT web_search_effective_contract_version, web_search_effective_settings_json,
                fable_tool_choice FROM fable_chat_turns`
      ).get();
      expect(turn.web_search_effective_contract_version).toBe(2);
      expect(JSON.parse(turn.web_search_effective_settings_json)).toMatchObject({
        toolVersion: 'web_search_20250305', contractVersion: 2, callerMode: 'direct',
        effectiveResponseInclusion: 'full',
      });
      expect(turn.fable_tool_choice).toBe('auto');
    } finally {
      DB.close();
    }
  });

  test('migration 0078 promotes the newest owner location without changing conversation activation', () => {
    const DB = new SqliteD1Database();
    try {
      applyAuthMigrations(DB, { through: '0077_upgrade_fable_web_search.sql' });
      const firstLocation = JSON.stringify({
        toolVersion: 'web_search_20260318', contractVersion: 3, callerMode: 'direct',
        responseInclusion: 'full', domainFilterMode: 'none', allowedDomains: [],
        blockedDomains: [], locationEnabled: true,
        location: { city: 'Trossingen', country: 'DE' },
      });
      const newestLocation = JSON.stringify({
        toolVersion: 'web_search_20260318', contractVersion: 3, callerMode: 'direct',
        responseInclusion: 'full', domainFilterMode: 'none', allowedDomains: [],
        blockedDomains: [], locationEnabled: false,
        location: {
          city: 'Freiburg', region: 'Baden-Württemberg',
          country: 'DE', timezone: 'Europe/Berlin',
        },
      });
      DB.database.prepare(
        `INSERT INTO users (id, email, password_hash, created_at, status, role, updated_at)
         VALUES (?, ?, 'unused', ?, 'active', 'admin', ?)`
      ).run('location-upgrade-admin', 'location-upgrade@example.com',
        '2026-07-14T08:00:00.000Z', '2026-07-14T08:00:00.000Z');
      for (const [id, json, updatedAt] of [
        ['fbc_30000000000000000000000000000001', firstLocation, '2026-07-14T08:01:00.000Z'],
        ['fbc_30000000000000000000000000000002', newestLocation, '2026-07-14T08:02:00.000Z'],
      ]) {
        DB.database.prepare(
          `INSERT INTO fable_chat_conversations (
             id, admin_user_id, title, title_source, turn_count,
             web_search_settings_json, created_at, updated_at, settings_updated_at
           ) VALUES (?, 'location-upgrade-admin', 'Existing', 'manual', 0, ?, ?, ?, ?)`
        ).run(id, json, updatedAt, updatedAt, updatedAt);
      }
      DB.exec(fs.readFileSync(
        path.join(process.cwd(), 'workers/auth/migrations/0078_add_fable_global_location.sql'),
        'utf8'
      ));
      expect(JSON.parse(DB.database.prepare(
        'SELECT web_search_location_json FROM fable_chat_user_settings WHERE admin_user_id = ?'
      ).get('location-upgrade-admin').web_search_location_json)).toEqual({
        city: 'Freiburg', region: 'Baden-Württemberg',
        country: 'DE', timezone: 'Europe/Berlin',
      });
      expect(DB.database.prepare(
        'SELECT web_search_settings_json FROM fable_chat_conversations WHERE id = ?'
      ).get('fbc_30000000000000000000000000000001').web_search_settings_json).toBe(firstLocation);
      expect(DB.database.prepare(
        'SELECT web_search_settings_json FROM fable_chat_conversations WHERE id = ?'
      ).get('fbc_30000000000000000000000000000002').web_search_settings_json).toBe(newestLocation);
    } finally {
      DB.close();
    }
  });
});
