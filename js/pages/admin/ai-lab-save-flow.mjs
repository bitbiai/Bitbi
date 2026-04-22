// @ts-check

import {
  buildCompareSaveIntent,
  buildEmbeddingsSaveIntent,
  buildImageSaveIntent,
  buildLiveAgentSaveIntent,
  buildMusicSaveIntent,
  buildTextSaveIntent,
  buildVideoSaveIntent,
} from './ai-lab-save-intents.mjs?v=__ASSET_VERSION__';

const SAVE_REFERENCE_FALLBACK_CODES = new Set([
  'INVALID_SAVE_REFERENCE',
  'SAVE_REFERENCE_EXPIRED',
  'SAVE_REFERENCE_UNAVAILABLE',
]);

/**
 * @typedef {object} SaveIntentContext
 * @property {Record<string, any>} results
 * @property {Record<string, any>} forms
 * @property {Array<{ role: string, content: string }>} liveAgentMessages
 * @property {HTMLElement | null} liveAgentTranscriptRoot
 * @property {string} liveAgentSystem
 * @property {string} liveAgentModel
 * @property {(entries: any[]) => any} buildCompareDiff
 * @property {(result: any) => string[]} getWarnings
 */

/**
 * @param {Date | null | undefined} value
 */
function toIso(value) {
  return value instanceof Date ? value.toISOString() : null;
}

/**
 * @param {string} task
 * @param {SaveIntentContext} context
 */
export function buildAdminAiLabSaveIntent(task, context) {
  switch (task) {
  case 'text':
    return buildTextSaveIntent({
      response: context.results.text?.raw,
      prompt: context.forms.text.prompt,
      system: context.forms.text.system,
      warnings: context.getWarnings(context.results.text?.raw),
      receivedAt: toIso(context.results.text?.receivedAt),
    });
  case 'image':
    return buildImageSaveIntent({
      response: context.results.image?.raw,
      prompt: context.forms.image.prompt,
      fallbackModel: context.forms.image.model,
    });
  case 'embeddings':
    return buildEmbeddingsSaveIntent({
      response: context.results.embeddings?.raw,
      input: context.forms.embeddings.input,
      warnings: context.getWarnings(context.results.embeddings?.raw),
      receivedAt: toIso(context.results.embeddings?.receivedAt),
    });
  case 'compare': {
    const response = context.results.compare?.raw;
    const results = Array.isArray(response?.result?.results) ? response.result.results : [];
    const diff = context.buildCompareDiff(results);
    return buildCompareSaveIntent({
      response,
      prompt: context.forms.compare.prompt,
      system: context.forms.compare.system,
      warnings: context.getWarnings(response),
      diffSummary: diff.available ? diff : null,
      receivedAt: toIso(context.results.compare?.receivedAt),
    });
  }
  case 'live-agent':
    return buildLiveAgentSaveIntent({
      messages: context.liveAgentMessages,
      transcriptRoot: context.liveAgentTranscriptRoot,
      system: context.liveAgentSystem,
      model: context.liveAgentModel,
      receivedAt: new Date().toISOString(),
    });
  case 'music':
    return buildMusicSaveIntent({
      response: context.results.music?.raw,
      prompt: context.forms.music.prompt,
      warnings: context.getWarnings(context.results.music?.raw),
      receivedAt: toIso(context.results.music?.receivedAt),
    });
  case 'video':
    return buildVideoSaveIntent({
      response: context.results.video?.raw,
      prompt: context.forms.video.prompt,
      warnings: context.getWarnings(context.results.video?.raw),
      receivedAt: toIso(context.results.video?.receivedAt),
    });
  default:
    return null;
  }
}

/**
 * @param {string} task
 */
export function getSaveIntentUnavailableMessage(task) {
  if (task === 'music') {
    return 'This audio result can be previewed or downloaded, but remote URL saves are disabled for security.';
  }
  if (task === 'video') {
    return 'Video save is disabled until a trusted Bitbi video-ingest contract exists.';
  }
  return 'Nothing available to save yet.';
}

/**
 * @param {HTMLElement | null | undefined} previewRoot
 */
function captureVideoPosterBase64(previewRoot) {
  const videoEl = previewRoot?.querySelector?.('video');
  if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight || videoEl.dataset.corsDisabled === '1') {
    return null;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    canvas.getContext('2d')?.drawImage(videoEl, 0, 0);
    return canvas.toDataURL('image/webp', 0.82);
  } catch {
    return null;
  }
}

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

/**
 * @param {object} params
 * @param {any} params.intent
 * @param {string} params.title
 * @param {string | null} params.folderId
 * @param {HTMLElement | null | undefined} params.videoPreviewRoot
 * @param {(arg0: any, ...rest: any[]) => Promise<any>} params.apiAiSaveImage
 * @param {(payload: any) => Promise<any>} params.apiAiSaveAudio
 * @param {(payload: any) => Promise<any>} params.apiAdminAiSaveTextAsset
 */
export async function saveAdminAiLabIntent({
  intent,
  title,
  folderId,
  videoPreviewRoot,
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
      return { ok: false, error: response.error || 'Image save failed.' };
    }

    return {
      ok: true,
      statusMessage: 'Image saved to the shared folder structure.',
      toastMessage: 'Image saved.',
    };
  }

  if (intent.sourceModule === 'video') {
    const posterBase64 = captureVideoPosterBase64(videoPreviewRoot);
    if (posterBase64) {
      intent.payload.posterBase64 = posterBase64;
    }
  }

  const response = intent.sourceModule === 'music'
    ? await apiAiSaveAudio({
      title,
      folder_id: folderId,
      ...intent.payload,
    })
    : await apiAdminAiSaveTextAsset({
      title,
      folderId,
      sourceModule: intent.sourceModule,
      data: intent.payload,
    });

  if (!response.ok) {
    return { ok: false, error: response.error || 'Save failed.' };
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

/**
 * @param {object} deps
 * @param {Record<string, any>} deps.state
 * @param {Record<string, any>} deps.refs
 * @param {((message: string, tone?: string) => void) | undefined} deps.showToast
 * @param {string} deps.liveAgentModel
 * @param {() => Array<{ role: string, content: string }>} deps.getLiveAgentMessages
 * @param {(entries: any[]) => any} deps.buildCompareDiff
 * @param {(result: any) => string[]} deps.getWarnings
 * @param {(tone: string, message: string) => void} deps.setSaveState
 * @param {(element: Element, tone: string, message: string) => void} deps.setResultState
 * @param {() => void} deps.renderSaveFolderOptions
 * @param {(message: string, tone?: string) => void} deps.setStatus
 * @param {() => Promise<void>} deps.refreshSavedAssetsBrowser
 * @param {() => Promise<any>} deps.apiAiGetFolders
 * @param {Function} deps.apiAiSaveImage
 * @param {(payload: any) => Promise<any>} deps.apiAiSaveAudio
 * @param {(payload: any) => Promise<any>} deps.apiAdminAiSaveTextAsset
 */
export function createAdminAiLabSaveFlow(deps) {
  function renderSaveModal() {
    const modal = deps.refs.saveModal.root;
    const isOpen = !!deps.state.save.open;
    modal.hidden = !isOpen;
    modal.setAttribute('aria-hidden', String(!isOpen));
    if (!isOpen) return;

    const intent = deps.state.save.intent;
    const isImage = intent?.type === 'image';

    deps.refs.saveModal.title.textContent = intent?.modalTitle || 'Save Asset';
    deps.refs.saveModal.desc.textContent = intent?.description || 'Save the current AI Lab result.';
    deps.refs.saveModal.titleField.hidden = isImage;
    deps.refs.saveModal.input.value = deps.state.save.title || '';
    deps.refs.saveModal.input.disabled = deps.state.save.saving || isImage;
    deps.refs.saveModal.folder.disabled = deps.state.save.saving;
    deps.refs.saveModal.note.textContent = deps.state.save.note || '';
    deps.refs.saveModal.confirm.disabled = deps.state.save.saving;
    deps.refs.saveModal.confirm.textContent = deps.state.save.saving
      ? 'Saving...'
      : (intent?.confirmLabel || 'Save');
    deps.setResultState(
      deps.refs.saveModal.state,
      deps.state.save.stateTone,
      deps.state.save.stateMessage,
    );
    deps.renderSaveFolderOptions();
  }

  function closeSaveModal() {
    if (!deps.state.save.open || deps.state.save.saving) return;
    deps.state.save.open = false;
    deps.state.save.task = null;
    deps.state.save.type = null;
    deps.state.save.intent = null;
    deps.state.save.saving = false;
    deps.state.save.title = '';
    deps.state.save.folderId = '';
    deps.state.save.note = '';
    deps.setSaveState('neutral', 'Ready to save.');
    renderSaveModal();
  }

  async function loadSaveFolders() {
    const result = await deps.apiAiGetFolders();
    deps.state.save.folders = Array.isArray(result?.folders) ? result.folders : [];
  }

  function getSaveIntent(task) {
    return buildAdminAiLabSaveIntent(task, {
      results: deps.state.results,
      forms: deps.state.forms,
      liveAgentMessages: deps.getLiveAgentMessages(),
      liveAgentTranscriptRoot: deps.refs.liveAgent.transcript,
      liveAgentSystem: deps.refs.liveAgent.system.value || '',
      liveAgentModel: deps.liveAgentModel,
      buildCompareDiff: deps.buildCompareDiff,
      getWarnings: deps.getWarnings,
    });
  }

  async function openSaveModal(task) {
    const intent = getSaveIntent(task);
    if (!intent) {
      const unavailableMessage = getSaveIntentUnavailableMessage(task);
      deps.setStatus(unavailableMessage, 'error');
      if (deps.showToast) deps.showToast(unavailableMessage, 'error');
      return;
    }

    deps.state.save.open = true;
    deps.state.save.task = task;
    deps.state.save.type = intent.type;
    deps.state.save.intent = intent;
    deps.state.save.saving = false;
    deps.state.save.title = intent.defaultTitle || '';
    deps.state.save.folderId = '';
    deps.state.save.note = intent.note || '';
    deps.setSaveState('loading', 'Loading folders...');
    renderSaveModal();

    try {
      await loadSaveFolders();
      deps.setSaveState('neutral', 'Choose a folder and confirm the save.');
    } catch {
      deps.state.save.folders = [];
      deps.setSaveState('error', 'Folder list unavailable. You can still save to Assets.');
    }

    renderSaveModal();
    if (intent.type === 'image') {
      deps.refs.saveModal.folder.focus();
    } else {
      deps.refs.saveModal.input.focus();
      deps.refs.saveModal.input.select();
    }
  }

  async function confirmSaveModal() {
    const intent = deps.state.save.intent;
    if (!deps.state.save.open || !intent || deps.state.save.saving) return;

    if (intent.type !== 'image' && !(deps.state.save.title || '').trim()) {
      deps.setSaveState('error', 'Title is required.');
      renderSaveModal();
      return;
    }

    deps.state.save.saving = true;
    deps.setSaveState('loading', 'Saving asset...');
    renderSaveModal();

    try {
      const saveResult = await saveAdminAiLabIntent({
        intent,
        title: deps.state.save.title,
        folderId: deps.state.save.folderId || null,
        videoPreviewRoot: deps.refs.video?.preview,
        apiAiSaveImage: deps.apiAiSaveImage,
        apiAiSaveAudio: deps.apiAiSaveAudio,
        apiAdminAiSaveTextAsset: deps.apiAdminAiSaveTextAsset,
      });

      if (!saveResult.ok) {
        deps.setSaveState('error', saveResult.error || 'Save failed.');
        deps.state.save.saving = false;
        renderSaveModal();
        return;
      }

      deps.state.save.saving = false;
      closeSaveModal();
      await deps.refreshSavedAssetsBrowser();
      deps.setStatus(saveResult.statusMessage, 'success');
      if (deps.showToast) deps.showToast(saveResult.toastMessage);
    } catch {
      deps.setSaveState('error', 'Save failed. Please try again.');
      deps.state.save.saving = false;
      renderSaveModal();
    }
  }

  return {
    renderSaveModal,
    closeSaveModal,
    openSaveModal,
    confirmSaveModal,
  };
}
