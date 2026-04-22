// @ts-check

/**
 * @typedef {'loading' | 'success' | 'error' | 'aborted' | 'timeout'} AdminAiTaskStatus
 */

/**
 * @typedef {object} AdminAiRetainedResult
 * @property {any | null} raw
 * @property {Date | null} receivedAt
 */

/**
 * @typedef {object} AdminAiTaskResultState
 * @property {AdminAiTaskStatus} status
 * @property {string | null | undefined} [error]
 * @property {string | null} errorCode
 * @property {any | null} raw
 * @property {any | null} debugRaw
 * @property {Date | null} receivedAt
 */

/**
 * @param {unknown} value
 */
export function normalizeAdminAiCode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

/**
 * @param {{ code?: unknown, data?: { code?: unknown } } | null | undefined} result
 */
export function getApiCode(result) {
  return normalizeAdminAiCode(result?.code || result?.data?.code);
}

/**
 * @param {{ errorCode?: unknown, raw?: { code?: unknown } } | null | undefined} result
 */
export function getResultCode(result) {
  return normalizeAdminAiCode(result?.errorCode || result?.raw?.code);
}

/**
 * @param {{ warnings?: unknown } | null | undefined} result
 */
export function getWarnings(result) {
  return Array.isArray(result?.warnings) ? result.warnings : [];
}

/**
 * @param {{ raw?: any, receivedAt?: Date | null } | null | undefined} current
 * @returns {AdminAiRetainedResult}
 */
export function getRetainedResult(current) {
  return {
    raw: current?.raw || null,
    receivedAt: current?.receivedAt || null,
  };
}

/**
 * @param {AdminAiRetainedResult | null | undefined} previous
 * @returns {AdminAiTaskResultState}
 */
export function createLoadingTaskResult(previous) {
  return {
    status: "loading",
    errorCode: null,
    raw: previous?.raw || null,
    debugRaw: previous?.raw || null,
    receivedAt: previous?.receivedAt || null,
  };
}

/**
 * @param {AdminAiRetainedResult | null | undefined} previous
 * @param {string} [error]
 * @returns {AdminAiTaskResultState}
 */
export function createAbortedTaskResult(previous, error = "Request cancelled.") {
  return {
    status: "aborted",
    error,
    errorCode: "request_aborted",
    raw: previous?.raw || null,
    debugRaw: previous?.raw || null,
    receivedAt: previous?.receivedAt || null,
  };
}

/**
 * @param {AdminAiRetainedResult | null | undefined} previous
 * @param {string} error
 * @returns {AdminAiTaskResultState}
 */
export function createTimeoutTaskResult(previous, error) {
  return {
    status: "timeout",
    error,
    errorCode: "request_timeout",
    raw: previous?.raw || null,
    debugRaw: previous?.raw || null,
    receivedAt: previous?.receivedAt || null,
  };
}

/**
 * @param {object} params
 * @param {AdminAiRetainedResult | null | undefined} params.previous
 * @param {string | undefined | null} params.error
 * @param {string | undefined | null} params.errorCode
 * @param {any} [params.debugRaw]
 * @returns {AdminAiTaskResultState}
 */
export function createErrorTaskResult({ previous, error, errorCode, debugRaw }) {
  const fallbackDebugRaw = previous?.raw || null;
  return {
    status: "error",
    error: error || null,
    errorCode: errorCode || null,
    raw: previous?.raw || null,
    debugRaw: debugRaw === undefined ? fallbackDebugRaw : debugRaw,
    receivedAt: previous?.receivedAt || null,
  };
}

/**
 * @param {any} raw
 * @param {string | null | undefined} [errorCode]
 * @returns {AdminAiTaskResultState}
 */
export function createSuccessTaskResult(raw, errorCode = null) {
  return {
    status: "success",
    errorCode: errorCode || null,
    raw,
    debugRaw: raw,
    receivedAt: new Date(),
  };
}
