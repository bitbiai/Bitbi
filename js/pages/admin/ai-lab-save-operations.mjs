// @ts-check

// Shared save execution and fallback policy. This module has no browser/UI
// imports: the actual dialog and Node contract tests use these same operations.

const SAVE_REFERENCE_FALLBACK_CODES = new Set([
  'INVALID_SAVE_REFERENCE',
  'SAVE_REFERENCE_EXPIRED',
  'SAVE_REFERENCE_UNAVAILABLE',
]);

/**
 * @param {{ saveReference?: string | null, imageData?: string | null, prompt?: string, model?: string, steps?: number, seed?: number }} payload
 * @param {{ apiAiSaveImage: Function, folderId: string | null }} options
 */
export async function saveImageIntentWithFallback(payload, options) {
  let response = await options.apiAiSaveImage(
    payload.saveReference
      ? { saveReference: payload.saveReference }
      : payload.imageData,
    payload.prompt,
    payload.model,
    payload.steps,
    payload.seed,
    options.folderId,
  );

  if (
    !response.ok &&
    payload.saveReference &&
    payload.imageData &&
    SAVE_REFERENCE_FALLBACK_CODES.has(response.code)
  ) {
    response = await options.apiAiSaveImage(
      payload.imageData,
      payload.prompt,
      payload.model,
      payload.steps,
      payload.seed,
      options.folderId,
    );
  }

  return response;
}

// These endpoints do not expose a shared receipt/idempotency lookup. A network or
// server failure may follow persistence; retain the attempt and require inspection
// instead of automatically creating a second asset.
function saveFailure(response, fallback) {
  const knownRejected = [400, 401, 403, 413, 422, 429].includes(response?.status);
  return { ok: false, error: response?.error || fallback, uncertain: !knownRejected };
}

/**
 * @param {object} params
 * @param {any} params.intent
 * @param {string} params.title
 * @param {string | null} params.folderId
 * @param {(arg0: any, ...rest: any[]) => Promise<any>} params.apiAiSaveImage
 * @param {(payload: any) => Promise<any>} params.apiAiSaveAudio
 * @param {(payload: any) => Promise<any>} params.apiAdminAiSaveTextAsset
 */
export async function saveAdminAiLabIntent({
  intent,
  title,
  folderId,
  apiAiSaveImage,
  apiAiSaveAudio,
  apiAdminAiSaveTextAsset,
}) {
  if (intent.type === 'image') {
    const response = await saveImageIntentWithFallback(intent.payload, {
      apiAiSaveImage,
      folderId,
    });
    if (!response.ok) {
      return saveFailure(response, 'Image save failed.');
    }

    return {
      ok: true,
      statusMessage: 'Image saved to the shared folder structure.',
      toastMessage: 'Image saved.',
    };
  }

  const payload = { ...intent.payload };

  const response = intent.sourceModule === 'music'
    ? await apiAiSaveAudio({
      title,
      folder_id: folderId,
      ...payload,
    })
    : await apiAdminAiSaveTextAsset({
      title,
      folderId,
      sourceModule: intent.sourceModule,
      data: payload,
    });

  if (!response.ok) {
    return saveFailure(response, 'Save failed.');
  }

  if (intent.sourceModule === 'music') {
    return {
      ok: true,
      statusMessage: 'Audio saved to the shared folder structure.',
      toastMessage: 'Audio saved.',
    };
  }

  if (intent.sourceModule === 'video') {
    return {
      ok: true,
      statusMessage: 'Video asset saved to the shared folder structure.',
      toastMessage: 'Video asset saved.',
    };
  }

  return {
    ok: true,
    statusMessage: 'Text asset saved to the shared folder structure.',
    toastMessage: 'Text asset saved.',
  };
}
