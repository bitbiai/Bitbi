import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  FABLE_CHAT_LITE_MEMORY_SUMMARY_MAX_TOKENS,
  FABLE_CHAT_LITE_MEMORY_ACCEPTANCE_CEILING,
  FABLE_CHAT_LITE_MEMORY_CHUNK_MAX_TOKENS,
  FABLE_CHAT_LITE_MEMORY_CHUNK_MIN_TOKENS,
  FABLE_CHAT_LITE_MEMORY_CHUNK_TARGET_TOKENS,
  FABLE_CHAT_LITE_MEMORY_COMPACTION_SOFT_TARGET_TOKENS,
  FABLE_CHAT_LITE_MEMORY_MAX_SOURCE_ESTIMATED_TOKENS,
  FABLE_CHAT_LITE_MEMORY_PLAN_VERSION,
  FABLE_CHAT_LITE_MEMORY_PLANNING_CEILING,
  FABLE_CHAT_MEMORY_BASE_SOFT_TARGETS,
  FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION,
  FABLE_CHAT_MEMORY_MINIMUM_VIABLE_TARGETS,
  FABLE_CHAT_MEMORY_REJECTION_CATEGORIES,
  FABLE_CHAT_MEMORY_SAFETY_MARGINS,
  FABLE_CHAT_STANDARD_MEMORY_SUMMARY_MAX_TOKENS,
  FABLE_CHAT_STANDARD_MEMORY_ACCEPTANCE_CEILING,
  FABLE_CHAT_STANDARD_MEMORY_PLANNING_CEILING,
  buildFableChatHiddenMemoryInstruction,
  buildFableChatMemorySummarizerSystemPrompt,
  buildFableChatMemoryProviderSourcePayload,
  buildFableChatMemorySourceCatalog,
  estimateFableChatMemoryCanonicalSummaryTokens,
  isFableChatMemorySummarySizeAccepted,
  normalizeFableChatMemoryProviderSummary,
  normalizeFableChatMemorySummary,
  planFableChatMemorySummaryBudget,
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

function providerSourceSummary(overrides = {}) {
  const { sources: _sources, ...base } = summary();
  return { ...base, source_ids: [], ...overrides };
}

function summaryInEstimatedRange(minimum, maximum, profile = "standard") {
  for (let count = 1; count <= 48; count += 1) {
    for (let length = 1; length <= 590; length += 1) {
      const facts = Array.from(
        { length: count },
        (_, index) => `${index}-${"x".repeat(length)}`
      );
      const durable = summary({ facts, sources: [] });
      const normalized = normalizeFableChatMemorySummary(durable, { mode: profile });
      const estimated = normalized.estimatedTokens;
      if (estimated >= minimum && estimated <= maximum) {
        return { durable: normalized.summary, provider: providerSourceSummary({ facts }), estimated };
      }
    }
  }
  throw new Error(`Unable to construct a summary between ${minimum} and ${maximum}.`);
}

function rejectionCategoryForVersion(raw, options = {}) {
  try {
    validateFableChatMemoryProviderResult(raw, {
      profile: "standard",
      startedAt: Date.now(),
      ...options,
    });
  } catch (error) {
    return {
      category: error.rejectionCategory,
      code: error.code,
      diagnostic: error.memoryDiagnostic,
    };
  }
  assert.fail("Expected provider result rejection.");
}

function rejectionCategory(raw, profile = "standard") {
  return rejectionCategoryForVersion(raw, { profile });
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

test("planning and final acceptance ceilings remain independently strict", () => {
  assert.equal(FABLE_CHAT_STANDARD_MEMORY_PLANNING_CEILING, 1_500);
  assert.equal(FABLE_CHAT_STANDARD_MEMORY_ACCEPTANCE_CEILING, 2_048);
  assert.equal(FABLE_CHAT_STANDARD_MEMORY_SUMMARY_MAX_TOKENS, 2_048);
  assert.equal(FABLE_CHAT_LITE_MEMORY_PLANNING_CEILING, 800);
  assert.equal(FABLE_CHAT_LITE_MEMORY_ACCEPTANCE_CEILING, 1_000);
  assert.equal(FABLE_CHAT_LITE_MEMORY_SUMMARY_MAX_TOKENS, 1_000);
  assert.equal(isFableChatMemorySummarySizeAccepted("standard", 1_608), true);
  assert.equal(isFableChatMemorySummarySizeAccepted("standard", 2_048), true);
  assert.equal(isFableChatMemorySummarySizeAccepted("standard", 2_049), false);
  assert.equal(isFableChatMemorySummarySizeAccepted("lite", 1_000), true);
  assert.equal(isFableChatMemorySummarySizeAccepted("lite", 1_001), false);
  assert.deepEqual(normalizeFableChatMemorySummary(summary(), { mode: "standard" }).summary, summary());
  assert.throws(
    () => normalizeFableChatMemorySummary("not-json", { mode: "standard" }),
    (error) => error.rejectionCategory === "json_parse_failed"
  );
});

test("Lite plan v2 uses the smaller complete-turn budget without changing Standard", () => {
  assert.equal(FABLE_CHAT_LITE_MEMORY_PLAN_VERSION, 2);
  assert.equal(FABLE_CHAT_LITE_MEMORY_CHUNK_TARGET_TOKENS, 2_500);
  assert.equal(FABLE_CHAT_LITE_MEMORY_CHUNK_MIN_TOKENS, 1_500);
  assert.equal(FABLE_CHAT_LITE_MEMORY_CHUNK_MAX_TOKENS, 3_000);
  assert.equal(FABLE_CHAT_LITE_MEMORY_MAX_SOURCE_ESTIMATED_TOKENS, 6_500);
  assert.equal(FABLE_CHAT_LITE_MEMORY_COMPACTION_SOFT_TARGET_TOKENS, 360);

  const standard = planFableChatMemorySummaryBudget("standard", []);
  const standardWithLiteVersion = planFableChatMemorySummaryBudget("standard", [], {
    litePlanVersion: FABLE_CHAT_LITE_MEMORY_PLAN_VERSION,
  });
  assert.deepEqual(standardWithLiteVersion, standard);
  assert.equal(standard.profileBaseSoftTarget, 1_100);
  assert.equal(standard.acceptanceCeiling, 2_048);

  const legacyLite = planFableChatMemorySummaryBudget("lite", [], { litePlanVersion: 1 });
  const currentLite = planFableChatMemorySummaryBudget("lite", [], {
    litePlanVersion: FABLE_CHAT_LITE_MEMORY_PLAN_VERSION,
  });
  assert.equal(legacyLite.profileBaseSoftTarget, 500);
  assert.equal(currentLite.profileBaseSoftTarget, 360);
  assert.equal(currentLite.acceptanceCeiling, 1_000);
  assert.ok(currentLite.effectiveSoftTarget <= 360);
  assert.match(buildFableChatMemorySummarizerSystemPrompt("lite", {
    sourceIdContract: true,
    effectiveSoftTarget: currentLite.effectiveSoftTarget,
    litePlanVersion: FABLE_CHAT_LITE_MEMORY_PLAN_VERSION,
  }), /exceptionally concise/);

  const validated = validateFableChatMemoryBody({
    ...memoryRequestBody(),
    profile: "lite",
    litePlanVersion: FABLE_CHAT_LITE_MEMORY_PLAN_VERSION,
  });
  assert.equal(validated.litePlanVersion, 2);
  assert.equal(validated.memoryBudgetPlan.profileBaseSoftTarget, 360);
  assert.ok(validated.estimatedInputTokens <= FABLE_CHAT_LITE_MEMORY_MAX_SOURCE_ESTIMATED_TOKENS);
  assert.throws(() => validateFableChatMemoryBody({
    ...memoryRequestBody(),
    litePlanVersion: FABLE_CHAT_LITE_MEMORY_PLAN_VERSION,
  }), /Lite memory plan is not supported/i);
});

test("source catalog is deterministic, bounded, deduplicated, and excludes unsafe input", () => {
  const cloudflare = { title: "Cloudflare", url: "https://www.cloudflare.com" };
  const docs = { title: "Workers docs", url: "https://developers.cloudflare.com/workers/" };
  const input = {
    previousSummary: summary({ sources: [cloudflare] }),
    sourceTurns: [{
      assistant: {
        sources: [
          { title: "Duplicate title is not authoritative", url: "https://www.cloudflare.com/" },
          docs,
          { title: "Unsafe", url: "http://example.com/" },
          { title: "Credential URL", url: "https://user:password@example.com/" },
        ],
      },
    }],
  };
  const first = buildFableChatMemorySourceCatalog(input);
  const second = buildFableChatMemorySourceCatalog(input);
  assert.deepEqual(first.entries, second.entries);
  assert.deepEqual(first.entries, [
    { id: "src_001", title: "Cloudflare", url: "https://www.cloudflare.com/" },
    { id: "src_002", title: "Workers docs", url: "https://developers.cloudflare.com/workers/" },
  ]);
  assert.equal(JSON.stringify(first.entries).includes("http://example.com"), false);
  assert.equal(JSON.stringify(first.entries).includes("password"), false);

  const bounded = buildFableChatMemorySourceCatalog({
    sourceTurns: [{
      assistant: {
        sources: Array.from({ length: 20 }, (_, index) => ({
          title: `Source ${index}`,
          url: `https://example.com/source-${index}`,
        })),
      },
    }],
  });
  assert.equal(bounded.entries.length, 16);
  assert.equal(bounded.entries.at(-1).id, "src_016");

  const provider = buildFableChatMemoryProviderSourcePayload(input);
  const parsed = JSON.parse(provider.sourcePayload);
  assert.deepEqual(parsed.previousSummary.source_ids, ["src_001"]);
  assert.equal(Object.hasOwn(parsed.previousSummary, "sources"), false);
  assert.deepEqual(parsed.sourceTurns[0].assistant.source_ids, ["src_001", "src_002"]);
  assert.equal(Object.hasOwn(parsed.sourceTurns[0].assistant, "sources"), false);
  assert.deepEqual(parsed.sourceCatalog, first.entries);
});

test("dynamic Standard and Lite targets reserve identical estimator overhead", () => {
  assert.equal(FABLE_CHAT_MEMORY_BASE_SOFT_TARGETS.standard, 1_100);
  assert.equal(FABLE_CHAT_MEMORY_BASE_SOFT_TARGETS.lite, 500);
  assert.equal(FABLE_CHAT_MEMORY_SAFETY_MARGINS.standard, 150);
  assert.equal(FABLE_CHAT_MEMORY_SAFETY_MARGINS.lite, 100);
  assert.equal(FABLE_CHAT_MEMORY_MINIMUM_VIABLE_TARGETS.standard, 400);
  assert.equal(FABLE_CHAT_MEMORY_MINIMUM_VIABLE_TARGETS.lite, 240);

  const elevenSources = Array.from({ length: 11 }, (_, index) => ({
    id: `src_${String(index + 1).padStart(3, "0")}`,
    title: `Reference ${index + 1}`,
    url: `https://example.com/reference-${index + 1}/${"path".repeat(20)}`,
  }));
  for (const profile of ["standard", "lite"]) {
    const plan = planFableChatMemorySummaryBudget(profile, elevenSources);
    const emptyDurable = normalizeFableChatMemorySummary(
      summary({ language: "", sources: [] }),
      { mode: profile }
    ).summary;
    const withSources = normalizeFableChatMemorySummary(summary({
      language: "",
      sources: plan.sourceCatalog.map(({ title, url }) => ({ title, url })),
    }), { mode: profile }).summary;
    assert.equal(
      plan.fixedSchemaOverhead,
      estimateFableChatMemoryCanonicalSummaryTokens(emptyDurable)
    );
    assert.equal(
      plan.sourceOverheadEstimate,
      estimateFableChatMemoryCanonicalSummaryTokens(withSources)
        - estimateFableChatMemoryCanonicalSummaryTokens(emptyDurable)
    );
    assert.equal(
      plan.availableNonSourceBudget,
      plan.planningCeiling
        - plan.fixedSchemaOverhead
        - plan.sourceOverheadEstimate
        - plan.safetyMargin
    );
    assert.equal(
      plan.effectiveSoftTarget,
      Math.min(plan.profileBaseSoftTarget, plan.availableNonSourceBudget)
    );
    assert.ok(plan.effectiveSoftTarget >= plan.minimumViableTarget);
    assert.ok(plan.effectiveSoftTarget < plan.planningCeiling);
    assert.equal(
      plan.effectiveSoftTarget,
      planFableChatMemorySummaryBudget(profile, elevenSources).effectiveSoftTarget
    );
    assert.ok(plan.acceptanceCeiling > plan.planningCeiling);
  }
});

test("large hidden-memory sources are trimmed deterministically without mutating citations", () => {
  const originalSources = Array.from({ length: 16 }, (_, index) => ({
    title: `Large source ${index}`,
    url: `https://example.com/${index}/${"x".repeat(1_800)}`,
  }));
  const sourceTurns = [{ assistant: { sources: originalSources.map((source) => ({ ...source })) } }];
  const before = structuredClone(sourceTurns);
  const first = buildFableChatMemoryProviderSourcePayload({
    mode: "standard",
    dynamicBudget: true,
    sourceTurns,
  });
  const second = buildFableChatMemoryProviderSourcePayload({
    mode: "standard",
    dynamicBudget: true,
    sourceTurns,
  });
  assert.deepEqual(sourceTurns, before);
  assert.deepEqual(first.sourceCatalog, second.sourceCatalog);
  assert.ok(first.sourceCatalog.length < 16);
  assert.ok(first.budgetPlan.effectiveSoftTarget >= 400);
  assert.ok(first.budgetPlan.safetyMargin >= 150);
  assert.deepEqual(
    first.sourceCatalog.map((entry) => entry.id),
    Array.from(
      { length: first.sourceCatalog.length },
      (_, index) => `src_${String(index + 1).padStart(3, "0")}`
    )
  );
});

test("provider source IDs resolve only through the server catalog", () => {
  const sourceCatalog = [
    { id: "src_001", title: "Cloudflare", url: "https://www.cloudflare.com/" },
    { id: "src_002", title: "Workers docs", url: "https://developers.cloudflare.com/workers/" },
  ];
  const normalized = normalizeFableChatMemoryProviderSummary(providerSourceSummary({
    source_ids: ["src_001", "src_999", "src_001", "src_002"],
  }), { mode: "standard", sourceCatalog });
  assert.deepEqual(normalized.summary.sources, [
    { title: "Cloudflare", url: "https://www.cloudflare.com/" },
    { title: "Workers docs", url: "https://developers.cloudflare.com/workers/" },
  ]);
  assert.deepEqual(normalized.sourceDiagnostics, {
    source_catalog_count: 2,
    returned_source_id_count: 4,
    resolved_source_id_count: 2,
    unknown_source_id_count: 1,
    duplicate_source_id_count: 1,
    malformed_source_id_count: 0,
    source_id_shape_valid: true,
  });

  const allUnknown = normalizeFableChatMemoryProviderSummary(providerSourceSummary({
    source_ids: ["src_998", "src_999"],
  }), { mode: "lite", sourceCatalog });
  assert.deepEqual(allUnknown.summary.sources, []);
  assert.equal(allUnknown.sourceDiagnostics.unknown_source_id_count, 2);

  const empty = normalizeFableChatMemoryProviderSummary(providerSourceSummary(), {
    mode: "lite",
    sourceCatalog: [],
  });
  assert.deepEqual(empty.summary.sources, []);
  assert.equal(empty.sourceDiagnostics.source_id_shape_valid, true);
});

test("malformed IDs and provider-generated source objects remain rejected", () => {
  assert.throws(
    () => normalizeFableChatMemoryProviderSummary(providerSourceSummary({
      source_ids: ["not-a-server-source-id"],
    }), { mode: "standard", sourceCatalog: [] }),
    (error) => error.rejectionCategory === "invalid_source_shape"
      && error.sourceDiagnostics.malformed_source_id_count === 1
      && error.sourceDiagnostics.source_id_shape_valid === false
  );
  assert.throws(
    () => normalizeFableChatMemoryProviderSummary({
      ...summary({ sources: [{ title: "Invented", url: "https://attacker.example/" }] }),
    }, { mode: "standard", sourceCatalog: [] }),
    (error) => error.rejectionCategory === "schema_invalid"
  );
});

test("version 5 accepts bounded Standard and Lite summaries and rejects oversized output", () => {
  for (const profile of ["standard", "lite"]) {
    const plan = planFableChatMemorySummaryBudget(profile, []);
    const valid = providerResult({ choice: {
      message: {
        role: "assistant",
        content: JSON.stringify(providerSourceSummary({
          facts: ["One durable fact."],
          source_ids: [],
        })),
        reasoning_content: "[]",
        refusal: null,
      },
    } });
    const accepted = validateFableChatMemoryProviderResult(valid, {
      profile,
      diagnosticVersion: 5,
      sourceCatalog: [],
      memoryBudgetPlan: plan,
    });
    assert.ok(accepted.estimatedTokens <= plan.acceptanceCeiling);
    assert.equal(accepted.sourceDiagnostics.final_limit_exceeded, false);
    assert.equal(
      accepted.sourceDiagnostics.final_estimated_summary_size,
      accepted.estimatedTokens
    );
  }

  const plan = planFableChatMemorySummaryBudget("standard", []);
  const oversized = providerResult({ choice: {
    message: {
      role: "assistant",
      content: JSON.stringify(providerSourceSummary({
        facts: Array.from({ length: 24 }, (_, index) => `${index}-${"x".repeat(590)}`),
      })),
      reasoning_content: "[]",
      refusal: null,
    },
  } });
  const rejected = rejectionCategoryForVersion(oversized, {
    profile: "standard",
    diagnosticVersion: 5,
    sourceCatalog: [],
    memoryBudgetPlan: plan,
  });
  assert.equal(rejected.category, "summary_limit_exceeded");
  assert.equal(rejected.diagnostic.final_limit_exceeded, true);
  assert.ok(rejected.diagnostic.final_estimated_summary_size > 2_048);

  const overflowTolerance = summaryInEstimatedRange(1_600, 1_620);
  const tolerated = validateFableChatMemoryProviderResult(providerResult({ choice: {
    message: {
      role: "assistant",
      content: JSON.stringify(overflowTolerance.provider),
      reasoning_content: "[]",
      refusal: null,
    },
  } }), {
    profile: "standard",
    diagnosticVersion: 5,
    sourceCatalog: [],
    memoryBudgetPlan: plan,
  });
  assert.equal(tolerated.estimatedTokens, overflowTolerance.estimated);
  assert.ok(tolerated.estimatedTokens > 1_500);
  assert.ok(tolerated.estimatedTokens <= 2_048);
  assert.match(
    buildFableChatHiddenMemoryInstruction("standard", 1, tolerated.canonical),
    /van_ark_hidden_memory/
  );

  const liteOverflowTolerance = summaryInEstimatedRange(850, 900, "lite");
  assert.ok(liteOverflowTolerance.estimated > 800);
  assert.ok(liteOverflowTolerance.estimated <= 1_000);
  assert.match(
    buildFableChatHiddenMemoryInstruction(
      "lite",
      1,
      JSON.stringify(liteOverflowTolerance.durable)
    ),
    /van_ark_hidden_memory/
  );

  const legacyRejected = rejectionCategoryForVersion(providerResult({ choice: {
    message: {
      role: "assistant",
      content: JSON.stringify(overflowTolerance.provider),
      reasoning_content: "[]",
      refusal: null,
    },
  } }), {
    profile: "standard",
    diagnosticVersion: 4,
    sourceCatalog: [],
    memoryBudgetPlan: plan,
  });
  assert.equal(legacyRejected.category, "summary_limit_exceeded");
});

test("Qwen request configuration remains fixed while diagnostics change", async () => {
  const calls = [];
  const providerSource = buildFableChatMemoryProviderSourcePayload({
    mode: "standard",
    dynamicBudget: true,
    previousSummary: null,
    sourceTurns: [{
      turnId: "synthetic-turn",
      user: { id: "synthetic-user", role: "user", text: "Synthetic" },
      assistant: {
        id: "synthetic-assistant",
        role: "assistant",
        text: "Synthetic",
        sources: [{ title: "Cloudflare", url: "https://www.cloudflare.com/" }],
      },
    }],
  });
  const output = await invokeFableChatMemory({
    AI_GATEWAY_ID: "default",
    AI: {
      async run(...args) {
        calls.push(args);
        return providerResult({ choice: {
          message: {
            role: "assistant",
            content: JSON.stringify(providerSourceSummary({ source_ids: ["src_001"] })),
            reasoning_content: "[]",
            refusal: null,
          },
        } });
      },
    },
  }, {
    profile: "standard",
    diagnosticVersion: FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION,
    sourcePayload: providerSource.sourcePayload,
    sourceCatalog: providerSource.sourceCatalog,
    memoryBudgetPlan: providerSource.budgetPlan,
    correlationId: "configuration-regression",
  });
  assert.equal(output.finishReason, "stop");
  assert.deepEqual(JSON.parse(output.canonicalSummary).sources, [{
    title: "Cloudflare",
    url: "https://www.cloudflare.com/",
  }]);
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
  assert.match(payload.messages[0].content, /"source_ids":\[\]/);
  assert.doesNotMatch(payload.messages[0].content, /"sources":\[\]/);
  assert.match(payload.messages[1].content, /sourceCatalog/);
  assert.match(payload.messages[1].content, /src_001/);
  assert.match(
    payload.messages[1].content,
    new RegExp(String(providerSource.budgetPlan.effectiveSoftTarget))
  );
});

test("AI validation accepts legacy diagnostics during rollout and rejects unsupported versions", () => {
  assert.equal(validateFableChatMemoryBody(memoryRequestBody(1)).diagnosticVersion, 1);
  assert.equal(validateFableChatMemoryBody(memoryRequestBody(2)).diagnosticVersion, 2);
  const versionThree = validateFableChatMemoryBody(memoryRequestBody(3));
  assert.equal(versionThree.diagnosticVersion, 3);
  assert.equal(versionThree.memoryBudgetPlan, null);
  const versionFour = validateFableChatMemoryBody(memoryRequestBody(4));
  assert.equal(versionFour.diagnosticVersion, 4);
  assert.equal(versionFour.memoryBudgetPlan.planningCeiling, 1_500);
  const current = validateFableChatMemoryBody(
    memoryRequestBody(FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION)
  );
  assert.equal(current.diagnosticVersion, FABLE_CHAT_MEMORY_DIAGNOSTIC_VERSION);
  assert.equal(current.memoryBudgetPlan.planningCeiling, 1_500);
  assert.equal(current.memoryBudgetPlan.acceptanceCeiling, 2_048);
  assert.equal(current.memoryBudgetPlan.profileBaseSoftTarget, 1_100);
  assert.ok(current.memoryBudgetPlan.effectiveSoftTarget <= 1_100);
  assert.throws(() => validateFableChatMemoryBody(memoryRequestBody(6)), /not supported/i);
});

test("diagnostic version changes only the immutable compaction fingerprint input", () => {
  const common = {
    profile: "standard",
    current: null,
    sourceBaseProfile: null,
    previous: null,
    previousSummary: null,
    sourceTurns: [{ turnId: "synthetic-turn" }],
    summaryPlan: planFableChatMemorySummaryBudget("standard", []),
  };
  const legacy = buildFableChatMemoryCompactionFingerprintInput({
    ...common,
    diagnosticVersion: 4,
  });
  const current = buildFableChatMemoryCompactionFingerprintInput(common);
  assert.equal(legacy.diagnostic_version, 4);
  assert.equal(current.diagnostic_version, 5);
  assert.notEqual(JSON.stringify(legacy), JSON.stringify(current));
  assert.equal(Object.hasOwn(legacy, "planning_ceiling"), false);
  assert.equal(current.planning_ceiling, 1_500);
  assert.equal(current.base_soft_target, 1_100);
  assert.equal(current.acceptance_ceiling, 2_048);
  assert.equal(current.safety_margin, 150);
  assert.equal(current.minimum_viable_target, 400);

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

test("Lite plan v2 leaves a prior truncation attempt immutable and permits one new fingerprint", () => {
  const common = {
    profile: "lite",
    current: null,
    sourceBaseProfile: null,
    previous: null,
    previousSummary: null,
    sourceTurns: [{ turnId: "synthetic-lite-turn" }],
  };
  const legacy = buildFableChatMemoryCompactionFingerprintInput({
    ...common,
    litePlanVersion: 1,
    summaryPlan: planFableChatMemorySummaryBudget("lite", [], { litePlanVersion: 1 }),
  });
  const current = buildFableChatMemoryCompactionFingerprintInput({
    ...common,
    litePlanVersion: FABLE_CHAT_LITE_MEMORY_PLAN_VERSION,
    summaryPlan: planFableChatMemorySummaryBudget("lite", [], {
      litePlanVersion: FABLE_CHAT_LITE_MEMORY_PLAN_VERSION,
    }),
  });
  assert.equal(legacy.lite_plan_version, 1);
  assert.equal(current.lite_plan_version, 2);
  assert.equal(current.base_soft_target, 360);
  assert.notEqual(JSON.stringify(legacy), JSON.stringify(current));

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY,
        input_fingerprint TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        error_code TEXT
      );
    `);
    const legacyFingerprint = JSON.stringify(legacy);
    const currentFingerprint = JSON.stringify(current);
    database.prepare(
      "INSERT INTO checkpoints (id, input_fingerprint, status, error_code) VALUES (?, ?, ?, ?)"
    ).run("lite-v1", legacyFingerprint, "unknown", "provider_length_truncation");
    database.prepare(
      "INSERT INTO checkpoints (id, input_fingerprint, status, error_code) VALUES (?, ?, ?, ?)"
    ).run("lite-v2", currentFingerprint, "pending", null);
    assert.throws(() => database.prepare(
      "INSERT INTO checkpoints (id, input_fingerprint, status, error_code) VALUES (?, ?, ?, ?)"
    ).run("lite-v2-duplicate", currentFingerprint, "pending", null), /UNIQUE/);
    assert.deepEqual(
      { ...database.prepare("SELECT status, error_code FROM checkpoints WHERE id = 'lite-v1'").get() },
      { status: "unknown", error_code: "provider_length_truncation" }
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
  const privateSourceTitle = "never-log-source-title";
  const privateSourceUrl = "https://never-log-source.example/private";
  const requestBody = memoryRequestBody();
  requestBody.sourceTurns[0].assistant.sources = [{
    title: privateSourceTitle,
    url: privateSourceUrl,
  }];
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const response = await handleFableChatMemory({
      request: new Request("https://bitbi-ai.internal/internal/ai/fable-chat/memory", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-ray": "safe-ray-id" },
        body: JSON.stringify(requestBody),
      }),
      env: {
        AI_GATEWAY_ID: "default",
        AI: {
          async run() {
            return providerResult({ choice: {
              message: {
                role: "assistant",
                content: JSON.stringify(providerSourceSummary({
                  source_ids: [privateMarker],
                })),
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
      diagnosticCategory: "invalid_source_shape",
    });
    const serializedLogs = logged.join("\n");
    assert.match(serializedLogs, /fable_chat_memory_provider_rejected/);
    assert.match(serializedLogs, /invalid_source_shape/);
    assert.match(serializedLogs, /malformed_source_id_count/);
    assert.match(serializedLogs, /planning_ceiling/);
    assert.match(serializedLogs, /base_soft_target/);
    assert.match(serializedLogs, /acceptance_ceiling/);
    assert.match(serializedLogs, /fixed_schema_overhead/);
    assert.match(serializedLogs, /source_overhead_estimate/);
    assert.match(serializedLogs, /safety_margin/);
    assert.match(serializedLogs, /effective_summary_target/);
    assert.match(serializedLogs, /effective_soft_target/);
    assert.match(serializedLogs, /diagnostic-correlation-id/);
    assert.doesNotMatch(serializedLogs, new RegExp(privateMarker));
    assert.doesNotMatch(serializedLogs, new RegExp(privateSourceTitle));
    assert.doesNotMatch(serializedLogs, new RegExp(privateSourceUrl));
    assert.doesNotMatch(serializedLogs, /Synthetic source data/);
    assert.doesNotMatch(serializedLogs, /Synthetic assistant data/);
  } finally {
    console.error = originalError;
  }
});
