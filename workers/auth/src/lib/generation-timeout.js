import {
  BITBI_GENERATION_TIMEOUT_MS,
  BITBI_GENERATION_TIMEOUT_SECONDS,
} from "../../../../js/shared/generation-timeout.mjs";

export {
  BITBI_GENERATION_TIMEOUT_MS,
  BITBI_GENERATION_TIMEOUT_SECONDS,
};

export function createGenerationTimeoutError(message = `Generation timed out after ${BITBI_GENERATION_TIMEOUT_SECONDS} seconds.`) {
  const error = new Error(message);
  error.name = "GenerationTimeoutError";
  error.status = 504;
  error.code = "generation_timeout";
  return error;
}

export function isGenerationTimeoutError(error) {
  return error?.name === "GenerationTimeoutError" || error?.code === "generation_timeout";
}

function cancelUnusedBody(value) {
  const body = value instanceof Response ? value.body : value instanceof ReadableStream ? value : null;
  if (!body || body.locked) return;
  try {
    Promise.resolve(body.cancel()).catch(() => {});
  } catch {}
}

export async function runWithGenerationTimeout(task, {
  timeoutMs = BITBI_GENERATION_TIMEOUT_MS,
  signal,
  onLateResult,
  onLateError,
} = {}) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;
    let abandoned = false;
    let timeoutId;
    const finish = (complete, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onCallerAbort);
      complete(value);
    };
    const abort = (reason) => {
      if (settled) return;
      abandoned = true;
      finish(reject, reason);
      controller.abort(reason);
    };
    const onCallerAbort = () => abort(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    signal?.addEventListener("abort", onCallerAbort, { once: true });
    timeoutId = setTimeout(() => abort(createGenerationTimeoutError()), timeoutMs);
    Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return task(controller.signal);
    }).then((value) => {
      if (abandoned) {
        cancelUnusedBody(value);
        return typeof onLateResult === "function" ? onLateResult(value) : undefined;
      }
      else finish(resolve, value);
    }, (error) => {
      if (abandoned && typeof onLateError === "function") return onLateError(error);
      finish(reject, error);
    }).catch(() => {
      // Evidence delivery can fail after request termination. The durable
      // unknown receipt remains blocked; never turn evidence failure into retry.
    });
  });
}

export async function fetchWithGenerationTimeout(fetcher, input, init = undefined, {
  timeoutMs = BITBI_GENERATION_TIMEOUT_MS,
  consumeResponse,
} = {}) {
  if (typeof fetcher !== "function") {
    const error = new Error("Fetch is unavailable.");
    error.status = 503;
    error.code = "fetch_unavailable";
    throw error;
  }

  const callerSignal = init?.signal === null
    ? undefined
    : init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return runWithGenerationTimeout(async (signal) => {
    // The deadline ends at headers by default, while native fetch caller
    // cancellation must remain attached to a returned streaming body.
    const transportSignal = callerSignal ? AbortSignal.any([signal, callerSignal]) : signal;
    const options = { ...(init || {}), signal: transportSignal };
    const response = await (input instanceof Request
      ? fetcher(new Request(input, options))
      : fetcher(input, options));
    if (signal.aborted) {
      cancelUnusedBody(response);
      throw signal.reason;
    }
    // Streaming callers own the body after headers. Finite consumers can opt in
    // to keeping the same deadline through body validation and consumption.
    if (typeof consumeResponse !== "function") return response;
    const onAbort = () => cancelUnusedBody(response);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await consumeResponse(response, signal);
    } catch (error) {
      cancelUnusedBody(response);
      throw error;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }, { timeoutMs, signal: callerSignal });
}

// Finite JSON bodies stay under the caller/deadline signal. Owning the reader
// lets cancellation release it even when a mock/transport ignores fetch abort.
export async function readGenerationResponseJson(response, signal) {
  const reader = response?.body?.getReader?.();
  if (!reader) return response.json();
  const decoder = new TextDecoder();
  const parts = [];
  const abort = () => { Promise.resolve(reader.cancel(signal?.reason)).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) { abort(); throw signal.reason; }
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw signal.reason;
      if (done) break;
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(""));
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
