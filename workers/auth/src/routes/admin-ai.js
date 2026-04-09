import { readJsonBody } from "../lib/request.js";
import { json } from "../lib/response.js";
import { isSharedRateLimited, getClientIp } from "../lib/rate-limit.js";
import { requireAdmin } from "../lib/session.js";

const AI_LAB_BASE_URL = "https://bitbi-ai.internal";

const LIMITS = {
  text: {
    promptMax: 4000,
    systemMax: 1200,
    maxTokens: 1200,
    defaultMaxTokens: 300,
    minTemperature: 0,
    maxTemperature: 2,
    defaultTemperature: 0.7,
  },
  image: {
    promptMax: 2048,
    minSteps: 1,
    maxSteps: 8,
    defaultSteps: 4,
    allowedDimensions: [256, 512, 768, 1024],
    maxPixels: 1024 * 1024,
    maxSeed: 2147483647,
  },
  embeddings: {
    maxBatchSize: 8,
    maxItemLength: 2000,
    maxTotalChars: 8000,
  },
  compare: {
    minModels: 2,
    maxModels: 3,
    promptMax: 4000,
    systemMax: 1200,
    maxTokens: 600,
    defaultMaxTokens: 250,
    minTemperature: 0,
    maxTemperature: 2,
    defaultTemperature: 0.7,
  },
};

class InputError extends Error {
  constructor(message, status = 400, code = "validation_error") {
    super(message);
    this.name = "InputError";
    this.status = status;
    this.code = code;
  }
}

function inputErrorResponse(error) {
  return json(
    {
      ok: false,
      error: error.message,
      code: error.code || "validation_error",
    },
    { status: error.status || 400 }
  );
}

function serviceUnavailableResponse() {
  return json(
    {
      ok: false,
      error: "AI lab service unavailable.",
      code: "upstream_error",
    },
    { status: 503 }
  );
}

function inferAdminAiErrorCode(status, message = "") {
  const normalized = String(message || "").toLowerCase();

  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 405) return "method_not_allowed";
  if (status === 429) return "rate_limited";
  if (normalized.includes("not allowlisted")) return "model_not_allowed";
  if (normalized.includes("duplicates")) return "duplicate_models";
  if (normalized.includes("invalid json")) return "bad_request";
  if (status >= 502) return "upstream_error";
  if (status >= 500) return "internal_error";
  if (status === 400) return "validation_error";
  return "bad_request";
}

async function withAdminAiCode(response) {
  if (!(response instanceof Response)) return response;

  let body;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  if (!body || typeof body !== "object") {
    return response;
  }

  const nextCode = body.ok
    ? (body.code || (
      body.task === "compare" &&
      Array.isArray(body.result?.results) &&
      body.result.results.some((entry) => entry && entry.ok === false)
        ? "partial_success"
        : null
    ))
    : (body.code || inferAdminAiErrorCode(response.status, body.error));

  if (!nextCode || body.code === nextCode) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.delete("content-length");

  return new Response(JSON.stringify({ ...body, code: nextCode }), {
    status: response.status,
    headers,
  });
}

function adminAiRateLimitResponse() {
  return json(
    {
      ok: false,
      error: "Too many requests. Please try again later.",
      code: "rate_limited",
    },
    { status: 429 }
  );
}

function ensureObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError("JSON body must be an object.", 400, "bad_request");
  }
  return value;
}

function requiredString(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new InputError(`${field} must be a string.`, 400, "validation_error");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new InputError(`${field} is required.`, 400, "validation_error");
  }
  if (trimmed.length > maxLength) {
    throw new InputError(`${field} must be at most ${maxLength} characters.`, 400, "validation_error");
  }
  return trimmed;
}

function optionalString(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new InputError(`${field} must be a string.`, 400, "validation_error");
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new InputError(`${field} must be at most ${maxLength} characters.`, 400, "validation_error");
  }
  return trimmed;
}

function optionalInteger(value, field, min, max, defaultValue = null) {
  if (value === undefined || value === null || value === "") return defaultValue;

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new InputError(`${field} must be an integer.`, 400, "validation_error");
  }
  if (parsed < min || parsed > max) {
    throw new InputError(`${field} must be between ${min} and ${max}.`, 400, "validation_error");
  }
  return parsed;
}

function optionalNumber(value, field, min, max, defaultValue = null) {
  if (value === undefined || value === null || value === "") return defaultValue;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new InputError(`${field} must be a number.`, 400, "validation_error");
  }
  if (parsed < min || parsed > max) {
    throw new InputError(`${field} must be between ${min} and ${max}.`, 400, "validation_error");
  }
  return parsed;
}

function optionalDimension(value, field) {
  if (value === undefined || value === null || value === "") return null;

  const parsed = optionalInteger(
    value,
    field,
    LIMITS.image.allowedDimensions[0],
    LIMITS.image.allowedDimensions[LIMITS.image.allowedDimensions.length - 1]
  );

  if (!LIMITS.image.allowedDimensions.includes(parsed)) {
    throw new InputError(
      `${field} must be one of ${LIMITS.image.allowedDimensions.join(", ")}.`,
      400,
      "validation_error"
    );
  }

  return parsed;
}

function normalizeStringArray(value, field, minItems, maxItems, maxItemLength) {
  const values = typeof value === "string" ? [value] : value;
  if (!Array.isArray(values)) {
    throw new InputError(`${field} must be a string or an array of strings.`, 400, "validation_error");
  }
  if (values.length < minItems) {
    throw new InputError(`${field} must contain at least ${minItems} item(s).`, 400, "validation_error");
  }
  if (values.length > maxItems) {
    throw new InputError(`${field} must contain at most ${maxItems} item(s).`, 400, "validation_error");
  }

  return values.map((entry, index) => requiredString(entry, `${field}[${index}]`, maxItemLength));
}

function validateTextPayload(body) {
  const input = ensureObject(body);

  return {
    preset: optionalString(input.preset, "preset", 64),
    model: optionalString(input.model, "model", 120),
    prompt: requiredString(input.prompt, "prompt", LIMITS.text.promptMax),
    system: optionalString(input.system, "system", LIMITS.text.systemMax),
    maxTokens: optionalInteger(
      input.maxTokens,
      "maxTokens",
      1,
      LIMITS.text.maxTokens,
      LIMITS.text.defaultMaxTokens
    ),
    temperature: optionalNumber(
      input.temperature,
      "temperature",
      LIMITS.text.minTemperature,
      LIMITS.text.maxTemperature,
      LIMITS.text.defaultTemperature
    ),
  };
}

function validateImagePayload(body) {
  const input = ensureObject(body);
  const width = optionalDimension(input.width, "width");
  const height = optionalDimension(input.height, "height");

  if ((width && !height) || (!width && height)) {
    throw new InputError("width and height must be provided together.", 400, "validation_error");
  }

  if (width && height && width * height > LIMITS.image.maxPixels) {
    throw new InputError(
      `Image dimensions exceed the ${LIMITS.image.maxPixels} pixel safety cap.`,
      400,
      "validation_error"
    );
  }

  return {
    preset: optionalString(input.preset, "preset", 64),
    model: optionalString(input.model, "model", 120),
    prompt: requiredString(input.prompt, "prompt", LIMITS.image.promptMax),
    width,
    height,
    steps: optionalInteger(
      input.steps,
      "steps",
      LIMITS.image.minSteps,
      LIMITS.image.maxSteps,
      LIMITS.image.defaultSteps
    ),
    seed: optionalInteger(input.seed, "seed", 0, LIMITS.image.maxSeed, null),
  };
}

function validateEmbeddingsPayload(body) {
  const input = ensureObject(body);
  const values = normalizeStringArray(
    input.input,
    "input",
    1,
    LIMITS.embeddings.maxBatchSize,
    LIMITS.embeddings.maxItemLength
  );
  const totalChars = values.reduce((sum, value) => sum + value.length, 0);

  if (totalChars > LIMITS.embeddings.maxTotalChars) {
    throw new InputError(
      `input exceeds the total ${LIMITS.embeddings.maxTotalChars} character cap.`,
      400,
      "validation_error"
    );
  }

  return {
    preset: optionalString(input.preset, "preset", 64),
    model: optionalString(input.model, "model", 120),
    input: values,
  };
}

function validateComparePayload(body) {
  const input = ensureObject(body);
  const models = normalizeStringArray(
    input.models,
    "models",
    LIMITS.compare.minModels,
    LIMITS.compare.maxModels,
    120
  );

  if (new Set(models).size !== models.length) {
    throw new InputError("models must not contain duplicates.", 400, "duplicate_models");
  }

  return {
    models,
    prompt: requiredString(input.prompt, "prompt", LIMITS.compare.promptMax),
    system: optionalString(input.system, "system", LIMITS.compare.systemMax),
    maxTokens: optionalInteger(
      input.maxTokens,
      "maxTokens",
      1,
      LIMITS.compare.maxTokens,
      LIMITS.compare.defaultMaxTokens
    ),
    temperature: optionalNumber(
      input.temperature,
      "temperature",
      LIMITS.compare.minTemperature,
      LIMITS.compare.maxTemperature,
      LIMITS.compare.defaultTemperature
    ),
  };
}

async function proxyToAiLab(env, path, init, adminUser) {
  if (!env.AI_LAB || typeof env.AI_LAB.fetch !== "function") {
    return serviceUnavailableResponse();
  }

  const headers = new Headers({
    accept: "application/json",
    "x-bitbi-admin-user-id": adminUser.id,
    "x-bitbi-admin-user-email": adminUser.email,
  });

  if (init.body !== undefined) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  let response;
  try {
    response = await env.AI_LAB.fetch(
      new Request(`${AI_LAB_BASE_URL}${path}`, {
        method: init.method,
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      })
    );
  } catch (error) {
    console.error("Admin AI proxy request failed", error);
    return serviceUnavailableResponse();
  }

  return withAdminAiCode(response);
}

async function rateLimitAdminAi(request, env, scope, maxRequests, windowMs) {
  const ip = getClientIp(request);
  if (await isSharedRateLimited(env, scope, ip, maxRequests, windowMs)) {
    return adminAiRateLimitResponse();
  }
  return null;
}

export async function handleAdminAI(ctx) {
  const { request, env, pathname, method } = ctx;

  if (!pathname.startsWith("/api/admin/ai/")) {
    return null;
  }

  const result = await requireAdmin(request, env);
  if (result instanceof Response) {
    return withAdminAiCode(result);
  }

  if (pathname === "/api/admin/ai/models" && method === "GET") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-models-ip", 60, 600_000);
    if (limited) return limited;
    return proxyToAiLab(env, "/internal/ai/models", { method: "GET" }, result.user);
  }

  if (pathname === "/api/admin/ai/test-text" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-text-ip", 30, 600_000);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) {
      return json({ ok: false, error: "Invalid JSON body.", code: "bad_request" }, { status: 400 });
    }

    try {
      return proxyToAiLab(
        env,
        "/internal/ai/test-text",
        { method: "POST", body: validateTextPayload(body) },
        result.user
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/test-image" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-image-ip", 10, 600_000);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) {
      return json({ ok: false, error: "Invalid JSON body.", code: "bad_request" }, { status: 400 });
    }

    try {
      return proxyToAiLab(
        env,
        "/internal/ai/test-image",
        { method: "POST", body: validateImagePayload(body) },
        result.user
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/test-embeddings" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-embeddings-ip", 20, 600_000);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) {
      return json({ ok: false, error: "Invalid JSON body.", code: "bad_request" }, { status: 400 });
    }

    try {
      return proxyToAiLab(
        env,
        "/internal/ai/test-embeddings",
        { method: "POST", body: validateEmbeddingsPayload(body) },
        result.user
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error);
      throw error;
    }
  }

  if (pathname === "/api/admin/ai/compare" && method === "POST") {
    const limited = await rateLimitAdminAi(request, env, "admin-ai-compare-ip", 15, 600_000);
    if (limited) return limited;

    const body = await readJsonBody(request);
    if (!body) {
      return json({ ok: false, error: "Invalid JSON body.", code: "bad_request" }, { status: 400 });
    }

    try {
      return proxyToAiLab(
        env,
        "/internal/ai/compare",
        { method: "POST", body: validateComparePayload(body) },
        result.user
      );
    } catch (error) {
      if (error instanceof InputError) return inputErrorResponse(error);
      throw error;
    }
  }

  if (pathname.startsWith("/api/admin/ai/")) {
    return json(
      {
        ok: false,
        error: "Not found",
        code: "not_found",
      },
      { status: 404 }
    );
  }

  return null;
}
