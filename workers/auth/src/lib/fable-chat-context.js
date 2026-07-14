import {
  FABLE_CHAT_CONTEXT_ESTIMATOR_VERSION,
  FABLE_CHAT_CONTEXT_FORMAT_VERSION,
  FABLE_CHAT_MAX_CITATIONS,
  FABLE_CHAT_MAX_CITATIONS_JSON_BYTES,
  FABLE_CHAT_MAX_CODE_EXECUTION_INPUT_CHARACTERS,
  FABLE_CHAT_MAX_CODE_EXECUTION_OUTPUT_FILES,
  FABLE_CHAT_MAX_CODE_EXECUTION_RESULT_CHARACTERS,
  FABLE_CHAT_MAX_PROVIDER_BLOCKS,
  FABLE_CHAT_MAX_PROVIDER_BLOCKS_JSON_BYTES,
  FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS,
  FABLE_CHAT_MAX_SEARCH_QUERY_CHARACTERS,
  FABLE_CHAT_MAX_SEARCH_RESULT_ENCRYPTED_CONTENT_BYTES,
  FABLE_CHAT_MAX_SEARCH_RESULT_ERROR_CODE_CHARACTERS,
  FABLE_CHAT_MAX_SEARCH_RESULT_TITLE_CHARACTERS,
  FABLE_CHAT_MAX_SOURCE_TITLE_CHARACTERS,
  FABLE_CHAT_MAX_SOURCE_URL_CHARACTERS,
  FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES,
  FABLE_CHAT_MAX_WEB_SEARCH_RESULTS,
  FABLE_CHAT_MAX_WEB_FETCH_DOCUMENT_DATA_BYTES,
  FABLE_CHAT_NATIVE_REPLAY_PROJECTION_VERSION,
  FABLE_CHAT_PROMPT_CACHE_MINIMUM_TOKENS,
  FABLE_CHAT_PROMPT_CACHE_LOOKBACK_BLOCKS,
  FABLE_CHAT_PROMPT_CACHE_MAX_BREAKPOINTS,
  FABLE_CHAT_PROMPT_CACHE_POLICY,
  FABLE_CHAT_PROMPT_CACHE_VERSION,
  FABLE_CHAT_WEB_SEARCH_TOOL_NAME,
  FABLE_CHAT_WEB_SEARCH_TOOL_TYPE,
  FABLE_CHAT_LEGACY_WEB_SEARCH_TOOL_TYPE,
  FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION,
  FABLE_CHAT_WEB_SEARCH_CODE_EXECUTION_CALLER,
  FABLE_CHAT_WEB_FETCH_ALLOWED_CALLERS,
  FABLE_CHAT_WEB_FETCH_ERROR_CODES,
  FABLE_CHAT_WEB_FETCH_MAX_CONTENT_TOKENS,
  FABLE_CHAT_WEB_FETCH_MAX_USES,
  FABLE_CHAT_WEB_FETCH_MAX_URL_CHARACTERS,
  FABLE_CHAT_WEB_FETCH_TOOL_NAME,
  FABLE_CHAT_WEB_FETCH_TOOL_TYPE,
  FABLE_CHAT_WEB_FETCH_USE_CACHE,
} from "../../../shared/fable-chat-contract.mjs";

const TEXT_ENCODER = new TextEncoder();
const DISALLOWED_CONTENT_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ESTIMATOR_MARGIN_MULTIPLIER = 1.12;
const ESTIMATOR_FIXED_MARGIN_TOKENS = 256;
const MESSAGE_OVERHEAD_TOKENS = 12;
const CONTENT_BLOCK_OVERHEAD_TOKENS = 8;
const TOOL_ID_PATTERN = /^srvtoolu_[A-Za-z0-9_-]{8,160}$/;
const SEARCH_ERROR_CODES = new Set([
  "too_many_requests",
  "invalid_tool_input",
  "max_uses_exceeded",
  "query_too_long",
  "request_too_large",
  "unavailable",
]);
const FETCH_ERROR_CODES = new Set(FABLE_CHAT_WEB_FETCH_ERROR_CODES);
const CODE_EXECUTION_TOOL_NAME = "code_execution";
const CODE_EXECUTION_ERROR_CODES = new Set([
  "invalid_tool_input",
  "unavailable",
  "too_many_requests",
  "execution_time_exceeded",
]);
const WEB_FETCH_SOURCE_TITLE_FALLBACK = "Fetched source";

export function utf8ByteLength(value) {
  return TEXT_ENCODER.encode(String(value || "")).byteLength;
}

export function estimateFableChatTextTokens(value) {
  const text = String(value || "");
  if (!text) return 0;
  const bytes = utf8ByteLength(text);
  const codePoints = Array.from(text).length;
  return Math.max(Math.ceil(bytes / 3), Math.ceil(codePoints / 2));
}

function assertSafeProviderText(value, field, maxCharacters) {
  if (typeof value !== "string" || value.length > maxCharacters) {
    throw new TypeError(`${field} is invalid.`);
  }
  if (DISALLOWED_CONTENT_CONTROL_PATTERN.test(value)) {
    throw new TypeError(`${field} contains unsupported control characters.`);
  }
  return value;
}

function assertOnlyProviderFields(value, allowed, field) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new TypeError(`${field} is invalid.`);
  }
}

function normalizeHttpsUrl(value, field) {
  const url = assertSafeProviderText(value, field, FABLE_CHAT_MAX_SOURCE_URL_CHARACTERS);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(`${field} is invalid.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new TypeError(`${field} is invalid.`);
  }
  return url;
}

function normalizePrivateCitation(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} is invalid.`);
  }
  if (value.type === "web_search_result_location") {
    assertOnlyProviderFields(
      value,
      ["type", "url", "title", "encrypted_index", "cited_text"],
      field
    );
    return {
      type: "web_search_result_location",
      url: normalizeHttpsUrl(value.url, `${field}.url`),
      title: assertSafeProviderText(
        value.title,
        `${field}.title`,
        FABLE_CHAT_MAX_SEARCH_RESULT_TITLE_CHARACTERS
      ),
      encrypted_index: assertSafeProviderText(
        value.encrypted_index,
        `${field}.encrypted_index`,
        FABLE_CHAT_MAX_SEARCH_RESULT_ENCRYPTED_CONTENT_BYTES
      ),
      cited_text: assertSafeProviderText(value.cited_text, `${field}.cited_text`, 2_048),
    };
  }
  if (value.type === "char_location") {
    assertOnlyProviderFields(value, [
      "type", "document_index", "document_title", "start_char_index", "end_char_index",
      "cited_text",
    ], field);
    if (!Number.isInteger(value.document_index) || value.document_index < 0
      || value.document_index >= FABLE_CHAT_MAX_CITATIONS
      || !Number.isInteger(value.start_char_index) || value.start_char_index < 0
      || !Number.isInteger(value.end_char_index) || value.end_char_index < value.start_char_index) {
      throw new TypeError(`${field} is invalid.`);
    }
    return {
      type: "char_location",
      document_index: value.document_index,
      document_title: assertSafeProviderText(
        value.document_title,
        `${field}.document_title`,
        FABLE_CHAT_MAX_SEARCH_RESULT_TITLE_CHARACTERS
      ),
      start_char_index: value.start_char_index,
      end_char_index: value.end_char_index,
      cited_text: assertSafeProviderText(value.cited_text, `${field}.cited_text`, 2_048),
    };
  }
  throw new TypeError(`${field} is invalid.`);
}

function normalizePrivateCitations(value, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)
    || (!allowEmpty && value.length === 0)
    || value.length > FABLE_CHAT_MAX_CITATIONS) {
    throw new TypeError(`${field} is invalid.`);
  }
  return value.map((citation, index) => normalizePrivateCitation(citation, `${field}[${index}]`));
}

function countDistinctPrivateCitationSources(blocks) {
  const sources = new Set();
  for (const block of blocks) {
    for (const citation of block.citations || []) {
      if (citation.type !== "web_search_result_location") continue;
      sources.add(new URL(citation.url).href);
    }
  }
  return sources.size;
}

function normalizeToolId(value, field) {
  const id = assertSafeProviderText(value, field, 180);
  if (!TOOL_ID_PATTERN.test(id)) throw new TypeError(`${field} is invalid.`);
  return id;
}

function normalizeServerToolCaller(value, field, {
  allowMissing = false,
  allowCodeExecution = true,
} = {}) {
  if (value === undefined && allowMissing) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} is invalid.`);
  }
  if (value.type === "direct") {
    assertOnlyProviderFields(value, ["type"], field);
    return { type: "direct" };
  }
  if (!allowCodeExecution || value.type !== FABLE_CHAT_WEB_SEARCH_CODE_EXECUTION_CALLER) {
    throw new TypeError(`${field} is invalid.`);
  }
  assertOnlyProviderFields(value, ["type", "tool_id"], field);
  return {
    type: FABLE_CHAT_WEB_SEARCH_CODE_EXECUTION_CALLER,
    tool_id: normalizeToolId(value.tool_id, `${field}.tool_id`),
  };
}

function normalizeCodeExecutionOutput(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} is invalid.`);
  }
  assertOnlyProviderFields(value, ["type", "file_id"], field);
  const fileId = assertSafeProviderText(value.file_id, `${field}.file_id`, 180);
  if (value.type !== "code_execution_output" || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
    throw new TypeError(`${field} is invalid.`);
  }
  return { type: "code_execution_output", file_id: fileId };
}

function normalizeCodeExecutionResultContent(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} is invalid.`);
  }
  if (value.type === "code_execution_tool_result_error") {
    assertOnlyProviderFields(value, ["type", "error_code"], field);
    if (!CODE_EXECUTION_ERROR_CODES.has(value.error_code)) {
      throw new TypeError(`${field} is invalid.`);
    }
    return { type: "code_execution_tool_result_error", error_code: value.error_code };
  }
  const encrypted = value.type === "encrypted_code_execution_result";
  if (!encrypted && value.type !== "code_execution_result") {
    throw new TypeError(`${field} is invalid.`);
  }
  assertOnlyProviderFields(
    value,
    encrypted
      ? ["type", "encrypted_stdout", "stderr", "return_code", "content"]
      : ["type", "stdout", "stderr", "return_code", "content"],
    field
  );
  if (!Number.isInteger(value.return_code)
    || value.return_code < -2_147_483_648
    || value.return_code > 2_147_483_647
    || !Array.isArray(value.content)
    || value.content.length > FABLE_CHAT_MAX_CODE_EXECUTION_OUTPUT_FILES) {
    throw new TypeError(`${field} is invalid.`);
  }
  const result = {
    type: value.type,
    stderr: assertSafeProviderText(
      value.stderr,
      `${field}.stderr`,
      FABLE_CHAT_MAX_CODE_EXECUTION_RESULT_CHARACTERS
    ),
    return_code: value.return_code,
    content: value.content.map((entry, index) => (
      normalizeCodeExecutionOutput(entry, `${field}.content[${index}]`)
    )),
  };
  if (encrypted) {
    result.encrypted_stdout = assertSafeProviderText(
      value.encrypted_stdout,
      `${field}.encrypted_stdout`,
      FABLE_CHAT_MAX_CODE_EXECUTION_RESULT_CHARACTERS
    );
    if (!result.encrypted_stdout) throw new TypeError(`${field} is invalid.`);
  } else {
    result.stdout = assertSafeProviderText(
      value.stdout,
      `${field}.stdout`,
      FABLE_CHAT_MAX_CODE_EXECUTION_RESULT_CHARACTERS
    );
  }
  return result;
}

function validateProviderBlockRelationships(blocks, { requireComplete = false } = {}) {
  const requests = new Map();
  const results = new Set();
  blocks.forEach((block, index) => {
    if (block.type === "server_tool_use") {
      if (requests.has(block.id)) throw new TypeError("Provider tool identifiers are invalid.");
      requests.set(block.id, { block, index });
      if (block.name === FABLE_CHAT_WEB_SEARCH_TOOL_NAME
        && block.caller?.type === FABLE_CHAT_WEB_SEARCH_CODE_EXECUTION_CALLER) {
        const parent = requests.get(block.caller.tool_id);
        if (!parent || parent.block.name !== CODE_EXECUTION_TOOL_NAME) {
          throw new TypeError("Provider web-search caller is invalid.");
        }
      }
      return;
    }
    if (!["web_search_tool_result", "web_fetch_tool_result", "code_execution_tool_result"]
      .includes(block.type)) return;
    if (results.has(block.tool_use_id)) throw new TypeError("Provider tool results are invalid.");
    results.add(block.tool_use_id);
    const request = requests.get(block.tool_use_id);
    const expectedName = block.type === "web_search_tool_result"
      ? FABLE_CHAT_WEB_SEARCH_TOOL_NAME
      : (block.type === "web_fetch_tool_result"
        ? FABLE_CHAT_WEB_FETCH_TOOL_NAME
        : CODE_EXECUTION_TOOL_NAME);
    if (!request || request.block.name !== expectedName || request.index >= index) {
      throw new TypeError("Provider tool lifecycle is invalid.");
    }
    if (block.type === "web_search_tool_result") {
      const requestCaller = request.block.caller || { type: "direct" };
      const resultCaller = block.caller || { type: "direct" };
      if (requestCaller.type !== resultCaller.type
        || requestCaller.tool_id !== resultCaller.tool_id) {
        throw new TypeError("Provider web-search caller is invalid.");
      }
    }
  });
  if (requireComplete) {
    for (const [id] of requests) {
      if (!results.has(id)) throw new TypeError("Provider tool lifecycle is incomplete.");
    }
  }
}

function normalizeSearchResult(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} is invalid.`);
  }
  assertOnlyProviderFields(
    value,
    ["type", "url", "title", "encrypted_content", "page_age"],
    field
  );
  if (value.type !== "web_search_result") throw new TypeError(`${field} is invalid.`);
  const pageAge = value.page_age == null
    ? null
    : assertSafeProviderText(value.page_age, `${field}.page_age`, 160);
  return {
    type: "web_search_result",
    url: normalizeHttpsUrl(value.url, `${field}.url`),
    title: assertSafeProviderText(
      value.title,
      `${field}.title`,
      FABLE_CHAT_MAX_SEARCH_RESULT_TITLE_CHARACTERS
    ),
    encrypted_content: assertSafeProviderText(
      value.encrypted_content,
      `${field}.encrypted_content`,
      FABLE_CHAT_MAX_SEARCH_RESULT_ENCRYPTED_CONTENT_BYTES
    ),
    page_age: pageAge,
  };
}

function normalizeSearchResultContent(value, field) {
  if (Array.isArray(value)) {
    if (value.length > FABLE_CHAT_MAX_WEB_SEARCH_RESULTS) {
      throw new TypeError(`${field} is invalid.`);
    }
    return value.map((result, index) => normalizeSearchResult(result, `${field}[${index}]`));
  }
  if (!value || typeof value !== "object") throw new TypeError(`${field} is invalid.`);
  assertOnlyProviderFields(value, ["type", "error_code"], field);
  const errorCode = assertSafeProviderText(
    value.error_code,
    `${field}.error_code`,
    FABLE_CHAT_MAX_SEARCH_RESULT_ERROR_CODE_CHARACTERS
  );
  if (value.type !== "web_search_tool_result_error" || !SEARCH_ERROR_CODES.has(errorCode)) {
    throw new TypeError(`${field} is invalid.`);
  }
  return { type: "web_search_tool_result_error", error_code: errorCode };
}

function normalizeFetchResultContent(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} is invalid.`);
  }
  if (value.type === "web_fetch_tool_result_error") {
    assertOnlyProviderFields(value, ["type", "error_code"], field);
    const errorCode = assertSafeProviderText(
      value.error_code,
      `${field}.error_code`,
      FABLE_CHAT_MAX_SEARCH_RESULT_ERROR_CODE_CHARACTERS
    );
    if (!FETCH_ERROR_CODES.has(errorCode)) throw new TypeError(`${field} is invalid.`);
    return { type: "web_fetch_tool_result_error", error_code: errorCode };
  }
  assertOnlyProviderFields(value, ["type", "url", "content", "retrieved_at"], field);
  if (value.type !== "web_fetch_result") throw new TypeError(`${field} is invalid.`);
  const document = value.content;
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new TypeError(`${field}.content is invalid.`);
  }
  assertOnlyProviderFields(document, ["type", "source", "title", "citations"], `${field}.content`);
  if (document.type !== "document") throw new TypeError(`${field}.content is invalid.`);
  const source = document.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError(`${field}.content.source is invalid.`);
  }
  assertOnlyProviderFields(source, ["type", "media_type", "data"], `${field}.content.source`);
  if (!["text", "base64"].includes(source.type)
    || (source.type === "text" && source.media_type !== "text/plain")
    || (source.type === "base64" && source.media_type !== "application/pdf")) {
    throw new TypeError(`${field}.content.source is invalid.`);
  }
  const data = assertSafeProviderText(
    source.data,
    `${field}.content.source.data`,
    FABLE_CHAT_MAX_WEB_FETCH_DOCUMENT_DATA_BYTES
  );
  if (!data || utf8ByteLength(data) > FABLE_CHAT_MAX_WEB_FETCH_DOCUMENT_DATA_BYTES
    || (source.type === "base64" && (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)))) {
    throw new TypeError(`${field}.content.source.data is invalid.`);
  }
  if (document.citations !== undefined) {
    if (!document.citations || typeof document.citations !== "object"
      || Array.isArray(document.citations)) {
      throw new TypeError(`${field}.content.citations is invalid.`);
    }
    assertOnlyProviderFields(document.citations, ["enabled"], `${field}.content.citations`);
    if (document.citations.enabled !== true) throw new TypeError(`${field}.content.citations is invalid.`);
  }
  const retrievedAt = assertSafeProviderText(value.retrieved_at, `${field}.retrieved_at`, 64);
  if (!Number.isFinite(Date.parse(retrievedAt))) throw new TypeError(`${field}.retrieved_at is invalid.`);
  return {
    type: "web_fetch_result",
    url: normalizeHttpsUrl(value.url, `${field}.url`),
    content: {
      type: "document",
      source: { type: source.type, media_type: source.media_type, data },
      ...(document.title == null ? {} : {
        title: assertSafeProviderText(
          document.title,
          `${field}.content.title`,
          FABLE_CHAT_MAX_SEARCH_RESULT_TITLE_CHARACTERS
        ),
      }),
      ...(document.citations === undefined ? {} : { citations: { enabled: true } }),
    },
    retrieved_at: retrievedAt,
  };
}

export function normalizeFableChatProviderBlocks(value, {
  allowEmptyThinking = true,
  requireCompleteToolLifecycle = false,
} = {}) {
  let blocks = value;
  if (typeof blocks === "string") {
    try {
      blocks = JSON.parse(blocks);
    } catch {
      throw new TypeError("Provider content blocks are invalid.");
    }
  }
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > FABLE_CHAT_MAX_PROVIDER_BLOCKS) {
    throw new TypeError("Provider content blocks are invalid.");
  }

  const normalized = blocks.map((block, index) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      throw new TypeError(`Provider content block ${index} is invalid.`);
    }
    if (block.type === "text") {
      assertOnlyProviderFields(block, ["type", "text", "citations"], `Provider text block ${index}`);
      const text = assertSafeProviderText(block.text, `Provider text block ${index}`, 524_288);
      return {
        type: "text",
        text,
        ...(block.citations === undefined
          ? {}
          : {
            // Preserve the valid Anthropic empty citation placeholder accepted by the stream parser.
            citations: normalizePrivateCitations(
              block.citations,
              `Provider text citations ${index}`,
              { allowEmpty: true }
            ),
          }),
      };
    }
    if (block.type === "thinking") {
      if (Object.keys(block).some((key) => !["type", "thinking", "signature"].includes(key))) {
        throw new TypeError(`Provider thinking block ${index} is invalid.`);
      }
      const thinking = assertSafeProviderText(
        block.thinking,
        `Provider thinking block ${index}`,
        FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS
      );
      if (!allowEmptyThinking && !thinking) {
        throw new TypeError(`Provider thinking block ${index} is invalid.`);
      }
      const signature = assertSafeProviderText(
        block.signature,
        `Provider thinking signature ${index}`,
        FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES
      );
      if (!signature || utf8ByteLength(signature) > FABLE_CHAT_MAX_THINKING_SIGNATURE_BYTES) {
        throw new TypeError(`Provider thinking signature ${index} is invalid.`);
      }
      return { type: "thinking", thinking, signature };
    }
    if (block.type === "server_tool_use") {
      assertOnlyProviderFields(
        block,
        ["type", "id", "name", "input", "caller"],
        `Provider server tool block ${index}`
      );
      if (![
        FABLE_CHAT_WEB_SEARCH_TOOL_NAME,
        FABLE_CHAT_WEB_FETCH_TOOL_NAME,
        CODE_EXECUTION_TOOL_NAME,
      ].includes(block.name)) {
        throw new TypeError(`Provider server tool block ${index} is invalid.`);
      }
      if (!block.input || typeof block.input !== "object" || Array.isArray(block.input)) {
        throw new TypeError(`Provider server tool block ${index} is invalid.`);
      }
      const isSearch = block.name === FABLE_CHAT_WEB_SEARCH_TOOL_NAME;
      const isCodeExecution = block.name === CODE_EXECUTION_TOOL_NAME;
      assertOnlyProviderFields(
        block.input,
        isSearch ? ["query"] : (isCodeExecution ? ["code"] : ["url"]),
        `Provider server tool input ${index}`
      );
      const input = isSearch
        ? {
            query: assertSafeProviderText(
              block.input.query,
              `Provider server tool query ${index}`,
              FABLE_CHAT_MAX_SEARCH_QUERY_CHARACTERS
            ),
          }
        : isCodeExecution
          ? {
              code: assertSafeProviderText(
                block.input.code,
                `Provider code-execution input ${index}`,
                FABLE_CHAT_MAX_CODE_EXECUTION_INPUT_CHARACTERS
              ),
            }
          : (() => {
            const url = normalizeHttpsUrl(block.input.url, `Provider server tool URL ${index}`);
            if (url.length > FABLE_CHAT_WEB_FETCH_MAX_URL_CHARACTERS) {
              throw new TypeError(`Provider server tool URL ${index} is invalid.`);
            }
            return { url };
          })();
      if (isCodeExecution && !input.code) {
        throw new TypeError(`Provider code-execution input ${index} is invalid.`);
      }
      const caller = normalizeServerToolCaller(
        block.caller,
        `Provider server tool caller ${index}`,
        { allowMissing: true, allowCodeExecution: isSearch }
      );
      return {
        type: "server_tool_use",
        id: normalizeToolId(block.id, `Provider server tool id ${index}`),
        name: block.name,
        input,
        ...(caller ? { caller } : {}),
      };
    }
    if (block.type === "web_search_tool_result") {
      assertOnlyProviderFields(
        block,
        ["type", "tool_use_id", "content", "caller"],
        `Provider search result block ${index}`
      );
      const caller = normalizeServerToolCaller(
        block.caller,
        `Provider search result caller ${index}`,
        { allowMissing: true }
      );
      return {
        type: "web_search_tool_result",
        tool_use_id: normalizeToolId(block.tool_use_id, `Provider search result id ${index}`),
        content: normalizeSearchResultContent(block.content, `Provider search result content ${index}`),
        ...(caller ? { caller } : {}),
      };
    }
    if (block.type === "web_fetch_tool_result") {
      assertOnlyProviderFields(
        block,
        ["type", "tool_use_id", "content", "caller"],
        `Provider Web Fetch result block ${index}`
      );
      let caller;
      if (block.caller !== undefined) {
        if (!block.caller || typeof block.caller !== "object" || Array.isArray(block.caller)) {
          throw new TypeError(`Provider Web Fetch result caller ${index} is invalid.`);
        }
        assertOnlyProviderFields(block.caller, ["type"], `Provider Web Fetch result caller ${index}`);
        if (block.caller.type !== "direct") {
          throw new TypeError(`Provider Web Fetch result caller ${index} is invalid.`);
        }
        caller = { type: "direct" };
      }
      return {
        type: "web_fetch_tool_result",
        tool_use_id: normalizeToolId(block.tool_use_id, `Provider Web Fetch result id ${index}`),
        content: normalizeFetchResultContent(block.content, `Provider Web Fetch result content ${index}`),
        ...(caller ? { caller } : {}),
      };
    }
    if (block.type === "code_execution_tool_result") {
      assertOnlyProviderFields(
        block,
        ["type", "tool_use_id", "content"],
        `Provider code-execution result block ${index}`
      );
      return {
        type: "code_execution_tool_result",
        tool_use_id: normalizeToolId(
          block.tool_use_id,
          `Provider code-execution result id ${index}`
        ),
        content: normalizeCodeExecutionResultContent(
          block.content,
          `Provider code-execution result content ${index}`
        ),
      };
    }
    throw new TypeError(`Provider content block ${index} has an unsupported type.`);
  });

  validateProviderBlockRelationships(normalized, { requireComplete: requireCompleteToolLifecycle });
  const serialized = JSON.stringify(normalized);
  if (countDistinctPrivateCitationSources(normalized) > FABLE_CHAT_MAX_CITATIONS) {
    throw new TypeError("Provider citations exceed their safe limit.");
  }
  if (utf8ByteLength(serialized) > FABLE_CHAT_MAX_PROVIDER_BLOCKS_JSON_BYTES) {
    throw new TypeError("Provider content blocks are too large.");
  }
  return normalized;
}

export function extractFableChatCitations(blocks) {
  const normalizedBlocks = normalizeFableChatProviderBlocks(blocks);
  const fetchDocuments = normalizedBlocks
    .filter((block) => block.type === "web_fetch_tool_result"
      && block.content?.type === "web_fetch_result")
    .map((block) => ({
      url: block.content.url,
      title: block.content.content?.title || WEB_FETCH_SOURCE_TITLE_FALLBACK,
    }));
  const deduplicated = new Map();
  for (const block of normalizedBlocks) {
    if (block.type !== "text") continue;
    for (const citation of block.citations || []) {
      const resolved = citation.type === "char_location"
        ? fetchDocuments[citation.document_index]
        : citation;
      if (!resolved) throw new TypeError("Provider Web Fetch citation is invalid.");
      const key = new URL(resolved.url).href;
      if (deduplicated.has(key)) continue;
      deduplicated.set(key, {
        url: resolved.url,
        title: (resolved.title || WEB_FETCH_SOURCE_TITLE_FALLBACK)
          .slice(0, FABLE_CHAT_MAX_SOURCE_TITLE_CHARACTERS),
        type: "web_search_result_location",
      });
      if (deduplicated.size >= FABLE_CHAT_MAX_CITATIONS) break;
    }
    if (deduplicated.size >= FABLE_CHAT_MAX_CITATIONS) break;
  }
  const citations = [...deduplicated.values()];
  if (utf8ByteLength(JSON.stringify(citations)) > FABLE_CHAT_MAX_CITATIONS_JSON_BYTES) {
    throw new TypeError("Provider citations are too large.");
  }
  return citations;
}

export function countFableChatWebSearchBlocks(blocks) {
  const normalized = normalizeFableChatProviderBlocks(blocks);
  const requests = normalized.filter((block) => (
    block.type === "server_tool_use" && block.name === FABLE_CHAT_WEB_SEARCH_TOOL_NAME
  ));
  const requestIds = new Set(requests.map((block) => block.id));
  const allResults = normalized.filter((block) => block.type === "web_search_tool_result");
  const resultIds = new Set(allResults.map((block) => block.tool_use_id));
  if (
    requestIds.size !== requests.length
    || resultIds.size !== allResults.length
    || allResults.some((block) => !requestIds.has(block.tool_use_id))
    || requests.length !== allResults.length
  ) {
    throw new TypeError("Provider web-search blocks are inconsistent.");
  }
  return { requestCount: requests.length, resultCount: allResults.length };
}

export function countFableChatWebSearchSafeResults(blocks) {
  return normalizeFableChatProviderBlocks(blocks)
    .filter((block) => block.type === "web_search_tool_result" && Array.isArray(block.content))
    .reduce((count, block) => count + block.content.length, 0);
}

export function countFableChatWebFetchBlocks(blocks) {
  const normalized = normalizeFableChatProviderBlocks(blocks);
  const requests = normalized.filter((block) => (
    block.type === "server_tool_use" && block.name === FABLE_CHAT_WEB_FETCH_TOOL_NAME
  ));
  const requestIds = new Set(requests.map((block) => block.id));
  const results = normalized.filter((block) => block.type === "web_fetch_tool_result");
  const resultIds = new Set(results.map((block) => block.tool_use_id));
  if (requestIds.size !== requests.length
    || resultIds.size !== results.length
    || results.some((block) => !requestIds.has(block.tool_use_id))
    || requests.length !== results.length) {
    throw new TypeError("Provider Web Fetch blocks are inconsistent.");
  }
  return {
    requestCount: requests.length,
    resultCount: results.length,
    errorResultCount: results.filter(
      (block) => block.content?.type === "web_fetch_tool_result_error"
    ).length,
  };
}

function countFableChatCodeExecutionBlocks(blocks) {
  const normalized = normalizeFableChatProviderBlocks(blocks);
  const requests = normalized.filter((block) => (
    block.type === "server_tool_use" && block.name === CODE_EXECUTION_TOOL_NAME
  ));
  const results = normalized.filter((block) => block.type === "code_execution_tool_result");
  return { requestCount: requests.length, resultCount: results.length };
}

export function extractFableChatAssistantText(blocks) {
  return normalizeFableChatProviderBlocks(blocks)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

export function extractFableChatReasoningSummary(blocks) {
  const summary = normalizeFableChatProviderBlocks(blocks)
    .filter((block) => block.type === "thinking" && block.thinking)
    .map((block) => block.thinking)
    .join("\n\n")
    .trim();
  if (summary.length > FABLE_CHAT_MAX_REASONING_SUMMARY_CHARACTERS) {
    throw new TypeError("Provider reasoning summary is too large.");
  }
  return summary || null;
}

function estimateContentTokens(content) {
  return estimateContentTokenBreakdown(content).totalTokens;
}

function emptyTokenBreakdown() {
  return {
    visibleMessageTokens: 0,
    citationTokens: 0,
    thinkingSignatureTokens: 0,
    toolTokens: 0,
    protocolOverheadTokens: 0,
    totalTokens: 0,
  };
}

function estimateContentTokenBreakdown(content, { recordedThinkingTokens = null } = {}) {
  const breakdown = emptyTokenBreakdown();
  if (typeof content === "string") {
    breakdown.visibleMessageTokens = estimateFableChatTextTokens(content);
    breakdown.totalTokens = breakdown.visibleMessageTokens;
    return breakdown;
  }
  if (!Array.isArray(content)) throw new TypeError("Message content is invalid.");
  let fallbackThinkingTokens = 0;
  for (const block of content) {
    breakdown.protocolOverheadTokens += CONTENT_BLOCK_OVERHEAD_TOKENS;
    if (block?.type === "text") {
      breakdown.visibleMessageTokens += estimateFableChatTextTokens(block.text);
      if (block.citations) {
        breakdown.citationTokens += Math.ceil(
          utf8ByteLength(JSON.stringify(block.citations)) / 2
        );
      }
    } else if (block?.type === "thinking") {
      fallbackThinkingTokens += estimateFableChatTextTokens(block.thinking);
      fallbackThinkingTokens += Math.ceil(utf8ByteLength(block.signature) / 2);
    } else if (block?.type === "server_tool_use"
      || block?.type === "web_search_tool_result"
      || block?.type === "web_fetch_tool_result"
      || block?.type === "code_execution_tool_result") {
      breakdown.toolTokens += Math.ceil(utf8ByteLength(JSON.stringify(block)) / 2);
    } else {
      throw new TypeError("Message content block is invalid.");
    }
  }
  const authoritativeThinkingTokens = Number(recordedThinkingTokens);
  breakdown.thinkingSignatureTokens = Number.isFinite(authoritativeThinkingTokens)
    && authoritativeThinkingTokens > 0
    ? Math.floor(authoritativeThinkingTokens)
    : fallbackThinkingTokens;
  breakdown.totalTokens = breakdown.visibleMessageTokens
    + breakdown.citationTokens
    + breakdown.thinkingSignatureTokens
    + breakdown.toolTokens
    + breakdown.protocolOverheadTokens;
  return breakdown;
}

function normalizeReplaySources(value) {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const sources = new Map();
  for (const entry of parsed.slice(0, FABLE_CHAT_MAX_CITATIONS)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (entry.type !== "web_search_result_location") continue;
    if (typeof entry.url !== "string" || entry.url.length > FABLE_CHAT_MAX_SOURCE_URL_CHARACTERS) {
      continue;
    }
    let url;
    try {
      url = new URL(entry.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.username || url.password) continue;
    const title = typeof entry.title === "string"
      ? entry.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
        .slice(0, FABLE_CHAT_MAX_SOURCE_TITLE_CHARACTERS)
      : "";
    if (!sources.has(url.href)) {
      sources.set(url.href, { title: title || url.hostname, url: url.href });
    }
  }
  return [...sources.values()];
}

export function projectFableChatProviderReplay({
  providerBlocks,
  assistantContent,
  citations = [],
  pruneCompletedWebSearch = false,
  projectCompletedNativeTurn = false,
  recordedThinkingTokens = null,
}) {
  const normalized = normalizeFableChatProviderBlocks(providerBlocks);
  if (!pruneCompletedWebSearch && !projectCompletedNativeTurn) {
    return {
      blocks: normalized,
      prunedPairCount: 0,
      prunedWebFetchPairCount: 0,
      prunedEstimatedTokens: 0,
      projectedNativeTurn: false,
      projectionVersion: FABLE_CHAT_NATIVE_REPLAY_PROJECTION_VERSION,
    };
  }
  let counts;
  let fetchCounts;
  let codeExecutionCounts;
  try {
    counts = countFableChatWebSearchBlocks(normalized);
    fetchCounts = countFableChatWebFetchBlocks(normalized);
    codeExecutionCounts = countFableChatCodeExecutionBlocks(normalized);
  } catch {
    return {
      blocks: normalized,
      prunedPairCount: 0,
      prunedWebFetchPairCount: 0,
      prunedEstimatedTokens: 0,
      projectedNativeTurn: false,
      projectionVersion: FABLE_CHAT_NATIVE_REPLAY_PROJECTION_VERSION,
    };
  }
  if (counts.requestCount === 0
    && fetchCounts.requestCount === 0
    && codeExecutionCounts.requestCount === 0
    && !projectCompletedNativeTurn) {
    return {
      blocks: normalized,
      prunedPairCount: 0,
      prunedWebFetchPairCount: 0,
      prunedEstimatedTokens: 0,
      projectedNativeTurn: false,
      projectionVersion: FABLE_CHAT_NATIVE_REPLAY_PROJECTION_VERSION,
    };
  }
  const hasPrivateNativeReplay = normalized.some((block) => (
    block.type === "thinking"
    || block.type === "server_tool_use"
    || block.type === "web_search_tool_result"
    || block.type === "web_fetch_tool_result"
    || block.type === "code_execution_tool_result"
  ));
  if (counts.requestCount === 0 && fetchCounts.requestCount === 0 && !hasPrivateNativeReplay) {
    return {
      blocks: normalized,
      prunedPairCount: 0,
      prunedWebFetchPairCount: 0,
      prunedEstimatedTokens: 0,
      projectedNativeTurn: false,
      projectionVersion: FABLE_CHAT_NATIVE_REPLAY_PROJECTION_VERSION,
    };
  }

  const visibleAnswer = String(assistantContent || "").trim();
  const sources = normalizeReplaySources(citations);
  const sourceText = sources.length > 0
    ? `\n\nSources:\n${sources.map(({ title, url }) => `- ${title}: ${url}`).join("\n")}`
    : "";
  // A pruned native turn must be wholly text-only. Retaining a thinking/signature
  // block beside altered tool/text blocks violates Anthropic replay invariants.
  const projected = [{ type: "text", text: `${visibleAnswer}${sourceText}`.trim() }];
  const beforeTokens = estimateContentTokenBreakdown(normalized, {
    recordedThinkingTokens,
  }).totalTokens;
  const afterTokens = estimateContentTokens(projected);
  return {
    blocks: projected,
    prunedPairCount: counts.requestCount + fetchCounts.requestCount,
    prunedWebFetchPairCount: fetchCounts.requestCount,
    prunedEstimatedTokens: Math.max(0, beforeTokens - afterTokens),
    projectedNativeTurn: true,
    projectionVersion: FABLE_CHAT_NATIVE_REPLAY_PROJECTION_VERSION,
  };
}

export function estimateFableChatProviderTokenBreakdown({
  system,
  baseSystem = system,
  messages,
  messageMetadata = [],
  providerConfigurationTokens = 0,
}) {
  const baseSystemTokens = estimateFableChatTextTokens(baseSystem);
  const fullSystemTokens = estimateFableChatTextTokens(system);
  const breakdown = {
    systemTokens: Math.min(baseSystemTokens, fullSystemTokens),
    hiddenMemoryTokens: Math.max(0, fullSystemTokens - baseSystemTokens),
    providerConfigurationTokens: Math.max(
      0,
      Math.floor(Number(providerConfigurationTokens) || 0)
    ),
    visibleMessageTokens: 0,
    visibleUserTokens: 0,
    visibleAssistantTokens: 0,
    currentUserTokens: 0,
    citationTokens: 0,
    thinkingSignatureTokens: 0,
    toolTokens: 0,
    protocolOverheadTokens: MESSAGE_OVERHEAD_TOKENS,
    totalTokens: 0,
  };
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const metadata = messageMetadata[index] || {};
    const content = estimateContentTokenBreakdown(message.content, {
      recordedThinkingTokens: metadata.recordedThinkingTokens,
    });
    breakdown.visibleMessageTokens += content.visibleMessageTokens;
    if (message.role === "user") {
      breakdown.visibleUserTokens += content.visibleMessageTokens;
    } else if (message.role === "assistant") {
      breakdown.visibleAssistantTokens += content.visibleMessageTokens;
    }
    if (metadata.current === true) {
      breakdown.currentUserTokens += content.visibleMessageTokens;
    }
    breakdown.citationTokens += content.citationTokens;
    breakdown.thinkingSignatureTokens += content.thinkingSignatureTokens;
    breakdown.toolTokens += content.toolTokens;
    breakdown.protocolOverheadTokens += MESSAGE_OVERHEAD_TOKENS
      + content.protocolOverheadTokens;
  }
  breakdown.totalTokens = breakdown.systemTokens
    + breakdown.hiddenMemoryTokens
    + breakdown.providerConfigurationTokens
    + breakdown.visibleMessageTokens
    + breakdown.citationTokens
    + breakdown.thinkingSignatureTokens
    + breakdown.toolTokens
    + breakdown.protocolOverheadTokens;
  return breakdown;
}

export function estimateFableChatInputTokens({
  system,
  baseSystem = system,
  messages,
  messageMetadata = [],
  providerConfigurationTokens = 0,
}) {
  const breakdown = estimateFableChatProviderTokenBreakdown({
    system,
    baseSystem,
    messages,
    messageMetadata,
    providerConfigurationTokens,
  });
  return {
    rawTokens: breakdown.totalTokens,
    estimatedInputTokens: Math.ceil(breakdown.totalTokens * ESTIMATOR_MARGIN_MULTIPLIER)
      + ESTIMATOR_FIXED_MARGIN_TOKENS,
    estimatorVersion: FABLE_CHAT_CONTEXT_ESTIMATOR_VERSION,
    breakdown,
  };
}

export function estimateFableChatProviderConfigurationTokens({
  effort,
  thinkingDisplay,
  webSearchEnabled,
  webSearchMaxUses,
  webSearchContractVersion = FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION,
  webSearchAllowedCallers = ["direct"],
  webSearchEffectiveResponseInclusion = "full",
  webSearchDomainFilterMode = "none",
  webSearchActiveDomains = [],
  webSearchLocation = null,
  toolChoice = "auto",
  webFetchEnabled = false,
}) {
  const tools = [];
  if (webSearchEnabled === true) {
    const currentContract = Number(webSearchContractVersion)
      >= FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION;
    const searchTool = {
      type: currentContract
        ? FABLE_CHAT_WEB_SEARCH_TOOL_TYPE
        : FABLE_CHAT_LEGACY_WEB_SEARCH_TOOL_TYPE,
      name: FABLE_CHAT_WEB_SEARCH_TOOL_NAME,
      max_uses: Number(webSearchMaxUses),
      ...(currentContract ? {
        allowed_callers: [...webSearchAllowedCallers],
        response_inclusion: webSearchEffectiveResponseInclusion,
      } : {}),
    };
    if (currentContract && webSearchDomainFilterMode === "allowed") {
      searchTool.allowed_domains = [...webSearchActiveDomains];
    } else if (currentContract && webSearchDomainFilterMode === "blocked") {
      searchTool.blocked_domains = [...webSearchActiveDomains];
    }
    if (currentContract && webSearchLocation) {
      searchTool.user_location = { type: "approximate", ...webSearchLocation };
    }
    tools.push(searchTool);
  }
  if (webFetchEnabled === true) {
    tools.push({
      type: FABLE_CHAT_WEB_FETCH_TOOL_TYPE,
      name: FABLE_CHAT_WEB_FETCH_TOOL_NAME,
      max_uses: FABLE_CHAT_WEB_FETCH_MAX_USES,
      citations: { enabled: true },
      max_content_tokens: FABLE_CHAT_WEB_FETCH_MAX_CONTENT_TOKENS,
      allowed_callers: [...FABLE_CHAT_WEB_FETCH_ALLOWED_CALLERS],
      use_cache: FABLE_CHAT_WEB_FETCH_USE_CACHE,
    });
  }
  const configuration = {
    output_config: { effort },
    thinking: { type: "adaptive", display: thinkingDisplay },
    ...(tools.length > 0 ? { tools } : {}),
    ...(tools.length > 0 && Number(webSearchContractVersion)
      >= FABLE_CHAT_WEB_SEARCH_CONTRACT_VERSION
      ? { tool_choice: { type: toolChoice } }
      : {}),
  };
  return estimateFableChatTextTokens(JSON.stringify(configuration))
    + CONTENT_BLOCK_OVERHEAD_TOKENS;
}

function cloneMessage(message) {
  return {
    role: message.role,
    content: typeof message.content === "string"
      ? message.content
      : JSON.parse(JSON.stringify(message.content)),
  };
}

function findStableAssistantCacheCandidates(messages) {
  const candidates = [];
  let contentBlockPosition = 0;
  for (let messageIndex = 0; messageIndex < messages.length - 1; messageIndex += 1) {
    const message = messages[messageIndex];
    const content = typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : message.content;
    if (!Array.isArray(content)) continue;
    if (message.role === "assistant") {
      let blockIndex = -1;
      for (let index = content.length - 1; index >= 0; index -= 1) {
        if (content[index]?.type === "text") {
          blockIndex = index;
          break;
        }
      }
      if (blockIndex >= 0) {
        candidates.push({
          messageIndex,
          blockIndex,
          contentBlockPosition: contentBlockPosition + blockIndex,
        });
      }
    }
    contentBlockPosition += content.length;
  }
  return candidates;
}

function addCacheControlAt(messages, { messageIndex, blockIndex }) {
  const stableMessage = messages[messageIndex];
  const content = typeof stableMessage.content === "string"
    ? [{ type: "text", text: stableMessage.content }]
    : JSON.parse(JSON.stringify(stableMessage.content));
  content[blockIndex] = {
    ...content[blockIndex],
    cache_control: { type: "ephemeral", ttl: "5m" },
  };
  stableMessage.content = content;
}

function addCacheControlsToStableMessages({
  system,
  baseSystem = system,
  messages,
  messageMetadata = [],
  providerConfigurationTokens = 0,
}) {
  const candidates = findStableAssistantCacheCandidates(messages);
  const latest = candidates.at(-1);
  if (!latest) return [];

  const locations = [latest];
  const previous = candidates.at(-2);
  if (
    previous
    && latest.contentBlockPosition - previous.contentBlockPosition
      >= FABLE_CHAT_PROMPT_CACHE_LOOKBACK_BLOCKS
    && estimateFableChatCacheEligibilityTokens({
      system,
      baseSystem,
      messages: messages.slice(0, previous.messageIndex + 1),
      messageMetadata: messageMetadata.slice(0, previous.messageIndex + 1),
      providerConfigurationTokens,
    }) >= FABLE_CHAT_PROMPT_CACHE_MINIMUM_TOKENS
  ) {
    locations.unshift(previous);
  }

  const boundedLocations = locations.slice(-FABLE_CHAT_PROMPT_CACHE_MAX_BREAKPOINTS);
  for (const location of boundedLocations) addCacheControlAt(messages, location);
  return boundedLocations.map(({ messageIndex, blockIndex }) => ({ messageIndex, blockIndex }));
}

function textCharacterCount(system, messages) {
  let characters = String(system || "").length;
  for (const message of messages) {
    if (typeof message.content === "string") {
      characters += message.content.length;
      continue;
    }
    for (const block of message.content || []) {
      if (block.type === "text") characters += String(block.text || "").length;
      if (block.type === "thinking") characters += String(block.thinking || "").length;
      if (block.type === "server_tool_use"
        || block.type === "web_search_tool_result"
        || block.type === "web_fetch_tool_result"
        || block.type === "code_execution_tool_result") {
        characters += JSON.stringify(block).length;
      }
      if (block.type === "text" && block.citations) characters += JSON.stringify(block.citations).length;
    }
  }
  return characters;
}

export function estimateFableChatCacheEligibilityTokens({
  system,
  baseSystem = system,
  messages,
  messageMetadata = [],
  providerConfigurationTokens = 0,
}) {
  return estimateFableChatProviderTokenBreakdown({
    system,
    baseSystem,
    messages,
    messageMetadata,
    providerConfigurationTokens,
  }).totalTokens;
}

export function selectFableChatModelContext({
  system,
  baseSystem = system,
  priorTurnsNewestFirst,
  currentMessage,
  effectiveInputTokenLimit,
  totalPriorTurns,
  promptCachePolicy = FABLE_CHAT_PROMPT_CACHE_POLICY,
  promptCacheVersion = FABLE_CHAT_PROMPT_CACHE_VERSION,
  providerConfigurationTokens = 0,
}) {
  const current = { role: "user", content: currentMessage };
  const selectedNewestFirst = [];

  for (const turn of priorTurnsNewestFirst) {
    const assistantContent = turn.assistantProviderBlocks
      ? normalizeFableChatProviderBlocks(turn.assistantProviderBlocks)
      : String(turn.assistantContent || "");
    const candidateNewestFirst = [
      ...selectedNewestFirst,
      {
        user: { role: "user", content: String(turn.userContent || "") },
        assistant: { role: "assistant", content: assistantContent },
        turnOrder: Number(turn.turnOrder),
        recordedThinkingTokens: Number.isFinite(Number(turn.recordedThinkingTokens))
          ? Math.max(0, Math.floor(Number(turn.recordedThinkingTokens)))
          : null,
        projectedNativeTurn: turn.projectedNativeTurn === true,
        nativeReplayRemovedEstimatedTokens: Math.max(
          0,
          Number(turn.nativeReplayRemovedEstimatedTokens || 0)
        ),
        webReplayPrunedPairCount: Math.max(0, Number(turn.webReplayPrunedPairCount || 0)),
        webReplayPrunedWebFetchPairCount: Math.max(
          0,
          Number(turn.webReplayPrunedWebFetchPairCount || 0)
        ),
        webReplayPrunedWebFetchEstimatedTokens: Math.max(
          0,
          Number(turn.webReplayPrunedWebFetchEstimatedTokens || 0)
        ),
        webReplayPrunedEstimatedTokens: Math.max(
          0,
          Number(turn.webReplayPrunedEstimatedTokens || 0)
        ),
      },
    ];
    const candidateMessages = candidateNewestFirst
      .slice()
      .reverse()
      .flatMap((entry) => [cloneMessage(entry.user), cloneMessage(entry.assistant)]);
    candidateMessages.push(current);
    const candidateMetadata = candidateNewestFirst
      .slice()
      .reverse()
      .flatMap((entry) => [
        {},
        { recordedThinkingTokens: entry.recordedThinkingTokens },
      ]);
    candidateMetadata.push({ current: true });
    const estimate = estimateFableChatInputTokens({
      system,
      baseSystem,
      messages: candidateMessages,
      messageMetadata: candidateMetadata,
      providerConfigurationTokens,
    });
    if (estimate.estimatedInputTokens > effectiveInputTokenLimit) break;
    selectedNewestFirst.push(candidateNewestFirst.at(-1));
  }

  const selected = selectedNewestFirst.slice().reverse();
  const messages = selected.flatMap((entry) => [cloneMessage(entry.user), cloneMessage(entry.assistant)]);
  messages.push(current);
  const messageMetadata = selected.flatMap((entry) => [
    {},
    { recordedThinkingTokens: entry.recordedThinkingTokens },
  ]);
  messageMetadata.push({ current: true });

  const stablePrefixMessages = messages.slice(0, -1);
  const stablePrefixMetadata = messageMetadata.slice(0, -1);
  const stablePrefixBreakdown = estimateFableChatProviderTokenBreakdown({
    system,
    baseSystem,
    messages: stablePrefixMessages,
    messageMetadata: stablePrefixMetadata,
    providerConfigurationTokens,
  });
  const stablePrefixEstimate = stablePrefixMessages.length > 0
    ? stablePrefixBreakdown.totalTokens
    : 0;
  let cacheBreakpoint = {
    enabled: false,
    policy: promptCachePolicy,
    version: promptCacheVersion,
    estimatedPrefixTokens: stablePrefixEstimate,
    predictedCacheWriteTokens: stablePrefixEstimate,
    providerTokenBreakdown: stablePrefixBreakdown,
  };
  if (
    promptCachePolicy === FABLE_CHAT_PROMPT_CACHE_POLICY
    && promptCacheVersion === FABLE_CHAT_PROMPT_CACHE_VERSION
    && stablePrefixEstimate >= FABLE_CHAT_PROMPT_CACHE_MINIMUM_TOKENS
  ) {
    const locations = addCacheControlsToStableMessages({
      system,
      baseSystem,
      messages,
      messageMetadata,
      providerConfigurationTokens,
    });
    const latestLocation = locations.at(-1);
    if (latestLocation) {
      cacheBreakpoint = {
        ...cacheBreakpoint,
        enabled: true,
        ...latestLocation,
        locations,
      };
    }
  }

  const estimate = estimateFableChatInputTokens({
    system,
    baseSystem,
    messages,
    messageMetadata,
    providerConfigurationTokens,
  });
  if (estimate.estimatedInputTokens > effectiveInputTokenLimit) {
    throw new RangeError("The current message exceeds the Fable chat input budget.");
  }
  const includedTurns = selected.length;
  const omittedTurns = Math.max(0, Number(totalPriorTurns || 0) - includedTurns);
  const webReplayPrunedPairCount = selected.reduce(
    (total, entry) => total + entry.webReplayPrunedPairCount,
    0
  );
  const webReplayPrunedEstimatedTokens = selected.reduce(
    (total, entry) => total + entry.webReplayPrunedEstimatedTokens,
    0
  );
  const webReplayPrunedWebFetchPairCount = selected.reduce(
    (total, entry) => total + entry.webReplayPrunedWebFetchPairCount,
    0
  );
  const webReplayPrunedWebFetchEstimatedTokens = selected.reduce(
    (total, entry) => total + entry.webReplayPrunedWebFetchEstimatedTokens,
    0
  );
  const nativeReplayRemovedEstimatedTokens = selected.reduce(
    (total, entry) => total + entry.nativeReplayRemovedEstimatedTokens,
    0
  );
  const selectedTurnTokenBreakdown = selected.map((entry) => {
    const turnBreakdown = estimateFableChatProviderTokenBreakdown({
      system: "",
      messages: [entry.user, entry.assistant],
      messageMetadata: [{}, { recordedThinkingTokens: entry.recordedThinkingTokens }],
    });
    turnBreakdown.protocolOverheadTokens = Math.max(
      0,
      turnBreakdown.protocolOverheadTokens - MESSAGE_OVERHEAD_TOKENS
    );
    turnBreakdown.totalTokens = Math.max(
      0,
      turnBreakdown.totalTokens - MESSAGE_OVERHEAD_TOKENS
    );
    return {
      turnOrder: entry.turnOrder,
      projectedNativeTurn: entry.projectedNativeTurn,
      ...turnBreakdown,
    };
  });
  return {
    system,
    messages,
    context: {
      includedTurns,
      omittedTurns,
      olderTurnsOmitted: omittedTurns > 0,
      characterCount: textCharacterCount(system, messages),
      estimatedInputTokens: estimate.estimatedInputTokens,
      effectiveInputTokenLimit,
      estimatorVersion: FABLE_CHAT_CONTEXT_ESTIMATOR_VERSION,
      providerTokenBreakdown: estimate.breakdown,
      selectedTurnTokenBreakdown,
      predictedCacheWriteTokens: stablePrefixEstimate,
      nativeReplayProjectionVersion: FABLE_CHAT_NATIVE_REPLAY_PROJECTION_VERSION,
      projectedNativeTurnCount: selected.filter((entry) => entry.projectedNativeTurn).length,
      nativeReplayRemovedEstimatedTokens,
      contextFormatVersion: FABLE_CHAT_CONTEXT_FORMAT_VERSION,
      cacheBreakpoint,
      webReplayPrunedPairCount,
      webReplayPrunedEstimatedTokens,
      webReplayPrunedWebFetchPairCount,
      webReplayPrunedWebFetchEstimatedTokens,
    },
  };
}
