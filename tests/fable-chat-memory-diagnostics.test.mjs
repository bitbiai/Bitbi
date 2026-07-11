import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  FABLE_CHAT_LITE_MEMORY_SUMMARY_MAX_TOKENS,
  FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION,
  FABLE_CHAT_MEMORY_REJECTION_CATEGORIES,
  FABLE_CHAT_STANDARD_MEMORY_SUMMARY_MAX_TOKENS,
  normalizeFableChatMemorySummary,
} from "../workers/shared/fable-chat-memory-contract.mjs";
import {
  invokeFableChatMemory,
  validateFableChatMemoryProviderResult,
} from "../workers/ai/src/lib/invoke-ai.js";
import {
  validateFableChatMemoryBody,
} from "../workers/ai/src/lib/validate.js";
import {
  handleFableChatMemory,
} from "../workers/ai/src/routes/fable-chat-memory.js";
import {
  buildFableChatMemoryCompactionFingerprintInput,
  classifyFableChatMemoryProviderFailure,
  resolveFableChatMemoryDiagnosticCategory,
} from "../workers/auth/src/lib/fable-chat-memory.js";

const FIXED_MODEL_ID = "@cf/qwen/qwen3-30b-a3b-fp8";

function summary(overrides = {}) {
  return {
    version: 1,
    language: "en",
    facts: [],
    preferences: [],
    entities: [],
    dates_locations_numbers: [],
    decisions_commitments: [],
    open_items: [],
    constraints: [],
    corrections_uncertainties: [],
    sources: [],
    ...overrides,
  };
}

function providerResult({ choice = {}, usage = null } = {}) {
  return {
    model: FIXED_MODEL_ID,
    choices: [{
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: JSON.stringify(summary()),
        reasoning_content: "[]",
        refusal: null,
      },
      ...choice,
    }],
    usage: usage || { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
  };
}

function rejectionCategory(raw, profile = "standard") {
  try {
    validateFableChatMemoryProviderResult(raw, { profile, startedAt: Date.now() });
  } catch (error) {
    return {
      category: error.rejectionCategory,
      code: error.code,
      diagnostic: error.memoryDiagnostic,
    };
  }
  assert.fail("Expected provider result rejection.");
}

function memoryRequestBody(diagnosticVersion = FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION) {
  return {
    profile: "standard",
    memoryContractVersion: 1,
    promptVersion: 1,
    diagnosticVersion,
    previousSummaryProfile: null,
    previousSummary: null,
    sourceTurns: [{
      turnId: `fbt_${"1".repeat(32)}`,
      turnOrder: 0,
      user: {
        id: `fbm_${"2".repeat(32)}`,
        role: "user",
        text: "Synthetic source data.",
      },
      assistant: {
        id: `fbm_${"3".repeat(32)}`,
        role: "assistant",
        text: "Synthetic assistant data.",
        sources: [],
      },
    }],
  };
}

test("Qwen memory validator emits the complete allowlisted diagnostic matrix", () => {
  const valid = providerResult();
  const validChoice = valid.choices[0];
  const validMessage = validChoice.message;
  const cases = new Map([
    ["missing_choice", { ...valid, choices: [] }],
    ["missing_finish_reason", providerResult({ choice: { finish_reason: undefined } })],
    ["invalid_finish_reason", providerResult({ choice: { finish_reason: "content_filter" } })],
    ["provider_length_truncation", providerResult({ choice: { finish_reason: "length" } })],
    ["missing_content", providerResult({ choice: { message: { role: "assistant" } } })],
    ["empty_content", providerResult({ choice: { message: { ...validMessage, content: "  " } } })],
    ["reasoning_content_present", providerResult({ choice: {
      message: { ...validMessage, reasoning_content: "private-marker" },
    } })],
    ["reasoning_present", providerResult({ choice: {
      message: { ...validMessage, reasoning: "private-marker" },
    } })],
    ["think_tag_present", providerResult({ choice: {
      message: { ...validMessage, content: `<think>private-marker</think>${validMessage.content}` },
    } })],
    ["refusal_present", providerResult({ choice: {
      message: { ...validMessage, refusal: "private-marker" },
    } })],
    ["json_parse_failed", providerResult({ choice: {
      message: { ...validMessage, content: "private-marker-not-json" },
    } })],
    ["json_not_object", providerResult({ choice: {
      message: { ...validMessage, content: "[]" },
    } })],
    ["schema_invalid", providerResult({ choice: {
      message: { ...validMessage, content: JSON.stringify({ ...summary(), extra: true }) },
    } })],
    ["unsupported_summary_version", providerResult({ choice: {
      message: { ...validMessage, content: JSON.stringify(summary({ version: 2 })) },
    } })],
    ["invalid_source_shape", providerResult({ choice: {
      message: { ...validMessage, content: JSON.stringify(summary({ sources: ["invalid"] })) },
    } })],
    ["unsafe_source_url", providerResult({ choice: {
      message: {
        ...validMessage,
        content: JSON.stringify(summary({ sources: [{ title: "Safe title", url: "http://example.com" }] })),
      },
    } })],
    ["summary_limit_exceeded", providerResult({ choice: {
      message: {
        ...validMessage,
        content: JSON.stringify(summary({
          facts: Array.from({ length: 24 }, (_, index) => `${index}-${"x".repeat(590)}`),
        })),
      },
    } })],
  ]);

  for (const [expected, raw] of cases) {
    const rejected = rejectionCategory(raw);
    assert.equal(rejected.category, expected);
    assert.ok(FABLE_CHAT_MEMORY_REJECTION_CATEGORIES.includes(rejected.category));
    assert.equal(rejected.diagnostic.rejection_category, expected);
    assert.equal(rejected.diagnostic.model_id, FIXED_MODEL_ID);
    assert.equal(JSON.stringify(rejected.diagnostic).includes("private-marker"), false);
  }
  assert.equal(resolveFableChatMemoryDiagnosticCategory("invalid_model_identity"), "invalid_model_identity");
  assert.equal(
    resolveFableChatMemoryDiagnosticCategory("not-allowlisted-private-data"),
    "unknown_invalid_provider_result"
  );
  assert.deepEqual(
    rejectionCategory({ choices: [] }).diagnostic.provider_usage,
    {}
  );
});

test("strict summary schema and Standard/Lite limits remain unchanged", () => {
  assert.equal(FABLE_CHAT_STANDARD_MEMORY_SUMMARY_MAX_TOKENS, 1_500);
  assert.equal(FABLE_CHAT_LITE_MEMORY_SUMMARY_MAX_TOKENS, 800);
  assert.deepEqual(normalizeFableChatMemorySummary(summary(), { mode: "standard" }).summary, summary());
  assert.throws(
    () => normalizeFableChatMemorySummary("not-json", { mode: "standard" }),
    (error) => error.rejectionCategory === "json_parse_failed"
  );
});

test("Qwen request configuration remains fixed while diagnostics change", async () => {
  const calls = [];
  const output = await invokeFableChatMemory({
    AI_GATEWAY_ID: "default",
    AI: {
      async run(...args) {
        calls.push(args);
        return providerResult();
      },
    },
  }, {
    profile: "standard",
    sourcePayload: JSON.stringify({ previousSummary: null, sourceTurns: [] }),
    correlationId: "configuration-regression",
  });
  assert.equal(output.finishReason, "stop");
  assert.equal(calls.length, 1);
  const [modelId, payload, options] = calls[0];
  assert.equal(modelId, FIXED_MODEL_ID);
  assert.deepEqual({
    max_tokens: payload.max_tokens,
    temperature: payload.temperature,
    top_p: payload.top_p,
    top_k: payload.top_k,
    response_format: payload.response_format,
    stream: payload.stream,
    tools: payload.tools,
  }, {
    max_tokens: 2_048,
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    response_format: { type: "json_object" },
    stream: false,
    tools: undefined,
  });
  assert.equal(options.gateway.id, "default");
  assert.equal(options.gateway.skipCache, true);
  assert.equal(options.gateway.collectLog, false);
});

test("AI validation accepts legacy diagnostics during rollout and rejects unsupported versions", () => {
  assert.equal(validateFableChatMemoryBody(memoryRequestBody(1)).diagnosticVersion, 1);
  assert.equal(
    validateFableChatMemoryBody(memoryRequestBody(FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION)).diagnosticVersion,
    FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION
  );
  assert.throws(() => validateFableChatMemoryBody(memoryRequestBody(3)), /not supported/i);
});

test("diagnostic version changes only the immutable compaction fingerprint input", () => {
  const common = {
    profile: "standard",
    current: null,
    sourceBaseProfile: null,
    previous: null,
    previousSummary: null,
    sourceTurns: [{ turnId: "synthetic-turn" }],
  };
  const legacy = buildFableChatMemoryCompactionFingerprintInput({
    ...common,
    diagnosticVersion: 1,
  });
  const current = buildFableChatMemoryCompactionFingerprintInput(common);
  assert.equal(legacy.diagnostic_version, 1);
  assert.equal(current.diagnostic_version, 2);
  assert.notEqual(JSON.stringify(legacy), JSON.stringify(current));
  assert.deepEqual(
    { ...current, diagnostic_version: 1 },
    legacy
  );

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY,
        input_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT
      );
      CREATE UNIQUE INDEX checkpoint_fingerprint ON checkpoints(input_fingerprint);
    `);
    const legacyFingerprint = JSON.stringify(legacy);
    const currentFingerprint = JSON.stringify(current);
    database.prepare(
      "INSERT INTO checkpoints (id, input_fingerprint, status, error_code) VALUES (?, ?, ?, ?)"
    ).run("legacy-attempt", legacyFingerprint, "unknown", "upstream_error");
    database.prepare(
      "INSERT INTO checkpoints (id, input_fingerprint, status, error_code) VALUES (?, ?, ?, ?)"
    ).run("diagnostic-attempt", currentFingerprint, "pending", null);
    assert.throws(() => database.prepare(
      "INSERT INTO checkpoints (id, input_fingerprint, status, error_code) VALUES (?, ?, ?, ?)"
    ).run("duplicate-attempt", currentFingerprint, "pending", null), /UNIQUE/);
    assert.deepEqual(
      { ...database.prepare("SELECT status, error_code FROM checkpoints WHERE id = ?")
        .get("legacy-attempt") },
      { status: "unknown", error_code: "upstream_error" }
    );
  } finally {
    database.close();
  }
});

test("Auth preserves only allowlisted diagnostics for durable checkpoint state", () => {
  assert.deepEqual(
    classifyFableChatMemoryProviderFailure(502, {
      code: "upstream_error",
      diagnosticCategory: "summary_limit_exceeded",
    }),
    {
      state: "unknown",
      errorCode: "summary_limit_exceeded",
      rejectionCategory: "summary_limit_exceeded",
    }
  );
  assert.deepEqual(
    classifyFableChatMemoryProviderFailure(502, {
      code: "upstream_error",
      diagnosticCategory: "private-provider-output-marker",
    }),
    {
      state: "unknown",
      errorCode: "unknown_invalid_provider_result",
      rejectionCategory: "unknown_invalid_provider_result",
    }
  );
});

test("AI route keeps the error generic while logging only content-free diagnostics", async () => {
  const privateMarker = "never-log-provider-text-marker";
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const response = await handleFableChatMemory({
      request: new Request("https://bitbi-ai.internal/internal/ai/fable-chat/memory", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-ray": "safe-ray-id" },
        body: JSON.stringify(memoryRequestBody()),
      }),
      env: {
        AI_GATEWAY_ID: "default",
        AI: {
          async run() {
            return providerResult({ choice: {
              message: {
                role: "assistant",
                content: privateMarker,
                reasoning_content: "[]",
                refusal: null,
              },
            } });
          },
        },
      },
      correlationId: "diagnostic-correlation-id",
      pathname: "/internal/ai/fable-chat/memory",
      method: "POST",
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.deepEqual(body, {
      ok: false,
      error: "Fable memory compaction failed",
      code: "upstream_error",
      diagnosticCategory: "json_parse_failed",
    });
    const serializedLogs = logged.join("\n");
    assert.match(serializedLogs, /fable_chat_memory_provider_rejected/);
    assert.match(serializedLogs, /json_parse_failed/);
    assert.match(serializedLogs, /diagnostic-correlation-id/);
    assert.doesNotMatch(serializedLogs, new RegExp(privateMarker));
    assert.doesNotMatch(serializedLogs, /Synthetic source data/);
    assert.doesNotMatch(serializedLogs, /Synthetic assistant data/);
  } finally {
    console.error = originalError;
  }
});
