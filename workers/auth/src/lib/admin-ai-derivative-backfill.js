import { json } from "./response.js";
import {
  AI_IMAGE_DERIVATIVE_VERSION,
  enqueueAiImageDerivativeJob,
  listAiImagesNeedingDerivativeWork,
} from "./ai-image-derivatives.js";
import {
  getErrorFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../js/shared/worker-observability.mjs";
import { AdminAiValidationError as InputError } from "../../../../js/shared/admin-ai-contract.mjs";

function inputErrorResponse(error, correlationId = null) {
  return withCorrelationId(json(
    {
      ok: false,
      error: error.message,
      code: error.code || "validation_error",
    },
    { status: error.status || 400 }
  ), correlationId);
}

function ensureObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError("JSON body must be an object.", 400, "bad_request");
  }
  return value;
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

function validateImageDerivativeBackfillPayload(body) {
  const input = body == null ? {} : ensureObject(body);
  if (
    input.includeFailed !== undefined &&
    input.includeFailed !== null &&
    typeof input.includeFailed !== "boolean"
  ) {
    throw new InputError("includeFailed must be a boolean.", 400, "validation_error");
  }
  return {
    limit: optionalInteger(input.limit, "limit", 1, 100, 50),
    cursor: optionalString(input.cursor, "cursor", 200),
    includeFailed: input.includeFailed !== false,
  };
}

export async function handleAdminAiDerivativeBackfillRequest({
  env,
  body,
  adminUser,
  correlationId,
}) {
  try {
    const input = validateImageDerivativeBackfillPayload(body);
    const page = await listAiImagesNeedingDerivativeWork(env, {
      limit: input.limit,
      cursor: input.cursor,
      includeFailed: input.includeFailed,
      targetVersion: AI_IMAGE_DERIVATIVE_VERSION,
    });

    let enqueued = 0;
    for (const row of page.rows) {
      await enqueueAiImageDerivativeJob(env, {
        imageId: row.id,
        userId: row.user_id,
        originalKey: row.r2_key,
        derivativesVersion: AI_IMAGE_DERIVATIVE_VERSION,
        correlationId,
        trigger: "backfill",
      });
      enqueued += 1;
    }

    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-backfill",
      event: "admin_ai_derivative_backfill_enqueued",
      correlationId,
      admin_user_id: adminUser.id,
      scanned: page.rows.length,
      enqueued,
      has_more: page.hasMore,
      derivatives_version: AI_IMAGE_DERIVATIVE_VERSION,
    });

    return withCorrelationId(json({
      ok: true,
      data: {
        scanned: page.rows.length,
        enqueued,
        has_more: page.hasMore,
        next_cursor: page.nextCursor,
        derivatives_version: AI_IMAGE_DERIVATIVE_VERSION,
      },
    }), correlationId);
  } catch (error) {
    if (error instanceof InputError) return inputErrorResponse(error, correlationId);
    if (String(error?.message || error).includes("Invalid cursor.")) {
      return withCorrelationId(
        json({ ok: false, error: "Invalid cursor.", code: "validation_error" }, { status: 400 }),
        correlationId
      );
    }
    logDiagnostic({
      service: "bitbi-auth",
      component: "admin-ai-backfill",
      event: "admin_ai_derivative_backfill_failed",
      level: "error",
      correlationId,
      admin_user_id: adminUser.id,
      ...getErrorFields(error),
    });
    return withCorrelationId(json(
      {
        ok: false,
        error: "Derivative backfill enqueue failed.",
        code: "derivative_backfill_failed",
      },
      { status: 503 }
    ), correlationId);
  }
}
