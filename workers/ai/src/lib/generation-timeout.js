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

export async function runWithGenerationTimeout(task, {
  timeoutMs = BITBI_GENERATION_TIMEOUT_MS,
} = {}) {
  let timeoutId = null;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(createGenerationTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function fetchWithGenerationTimeout(fetcher, input, init = undefined, {
  timeoutMs = BITBI_GENERATION_TIMEOUT_MS,
} = {}) {
  if (typeof fetcher !== "function") {
    const error = new Error("Fetch is unavailable.");
    error.status = 503;
    error.code = "fetch_unavailable";
    throw error;
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timeoutId = null;
  let timedOut = false;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      if (controller) controller.abort(createGenerationTimeoutError());
      reject(createGenerationTimeoutError());
    }, timeoutMs);
  });

  try {
    if (!controller) {
      return await runWithGenerationTimeout(() => fetcher(input, init), { timeoutMs });
    }
    const fetchPromise = input instanceof Request
      ? fetcher(new Request(input, { signal: controller.signal }))
      : fetcher(input, { ...(init || {}), signal: controller.signal });
    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (error) {
    if (timedOut || controller?.signal?.aborted || isGenerationTimeoutError(error) || error?.name === "AbortError") {
      throw createGenerationTimeoutError();
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
