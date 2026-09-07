// @ts-check

import { focusElementSafely, restoreFocusSafely, trapFocusWithin } from './ui.js?v=__ASSET_VERSION__';
import { saveAdminAiLabIntent } from './ai-lab-save-operations.mjs?v=__ASSET_VERSION__';

// Preserve the existing exports for browser consumers while keeping the
// browser-free contract entrypoint independent of the dialog's focus helpers.
export { saveAdminAiLabIntent, saveImageIntentWithFallback } from './ai-lab-save-operations.mjs?v=__ASSET_VERSION__';

import {
  buildCompareSaveIntent,
  buildEmbeddingsSaveIntent,
  buildImageSaveIntent,
  buildLiveAgentSaveIntent,
  buildMusicSaveIntent,
  buildTextSaveIntent,
  buildVideoSaveIntent,
} from './ai-lab-save-intents.mjs?v=__ASSET_VERSION__';

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
      prompt: (context.results.text?.input || {}).prompt,
      system: (context.results.text?.input || {}).system,
      warnings: context.getWarnings(context.results.text?.raw),
      receivedAt: toIso(context.results.text?.receivedAt),
    });
  case 'image':
    return buildImageSaveIntent({
      response: context.results.image?.raw,
      prompt: (context.results.image?.input || {}).prompt,
      fallbackModel: (context.results.image?.input || {}).model,
    });
  case 'embeddings':
    return buildEmbeddingsSaveIntent({
      response: context.results.embeddings?.raw,
      input: (context.results.embeddings?.input || {}).input,
      warnings: context.getWarnings(context.results.embeddings?.raw),
      receivedAt: toIso(context.results.embeddings?.receivedAt),
    });
  case 'compare': {
    const response = context.results.compare?.raw;
    const results = Array.isArray(response?.result?.results) ? response.result.results : [];
    const diff = context.buildCompareDiff(results);
    return buildCompareSaveIntent({
      response,
      prompt: (context.results.compare?.input || {}).prompt,
      system: (context.results.compare?.input || {}).system,
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
      prompt: (context.results.music?.input || {}).prompt,
      warnings: context.getWarnings(context.results.music?.raw),
      receivedAt: toIso(context.results.music?.receivedAt),
    });
  case 'video':
    return buildVideoSaveIntent({
      response: context.results.video?.raw,
      prompt: (context.results.video?.input || {}).prompt,
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
    return 'Generate audio before saving it.';
  }
  if (task === 'video') {
    return 'Generate a completed video job before saving it.';
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
  let dialogVersion = 0;
  let returnFocus = null;
  // Keep settled/unknown attempts by their generated result for this in-memory
  // session. Close/reopen must not silently turn an uncertain save into a new one.
  const attempts = new WeakMap();
  let currentAttempt = null;
  let transcriptIdentity = { messages: null, length: -1, key: {} };
  const newCopy = document.createElement('button');
  newCopy.type = 'button';
  newCopy.id = 'aiLabSaveNewCopy';
  newCopy.className = 'btn-action';
  newCopy.textContent = 'Save another copy';
  newCopy.hidden = true;
  deps.refs.saveModal.confirm.insertAdjacentElement('afterend', newCopy);
  newCopy.addEventListener('click', () => {
    if (deps.state.save.saving || currentAttempt?.status !== 'success') return;
    // This is a deliberate new copy, not a retry of the completed operation.
    // Keep its completed record until a new save is actually confirmed.
    currentAttempt = null;
    deps.setSaveState('neutral', 'Creating a separate copy of this generated result. Choose its title and folder.');
    renderSaveModal();
    focusElementSafely(deps.state.save.intent?.type === 'image' ? deps.refs.saveModal.folder : deps.refs.saveModal.input);
  });

  deps.refs.saveModal.root.addEventListener('keydown', event => {
    if (!deps.state.save.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSaveModal();
    } else trapFocusWithin(deps.refs.saveModal.root, event);
  });
  deps.refs.saveModal.state.setAttribute('role', 'status');
  deps.refs.saveModal.state.setAttribute('aria-live', 'polite');
  function renderSaveModal() {
    const modal = deps.refs.saveModal.root;
    const isOpen = !!deps.state.save.open;
    modal.hidden = !isOpen;
    modal.setAttribute('aria-hidden', String(!isOpen));
    if (!isOpen) return;

    newCopy.hidden = currentAttempt?.status !== 'success';
    const intent = deps.state.save.intent;
    const isImage = intent?.type === 'image';

    deps.refs.saveModal.title.textContent = intent?.modalTitle || 'Save Asset';
    deps.refs.saveModal.desc.textContent = intent?.description || 'Save the current AI Lab result.';
    deps.refs.saveModal.titleField.hidden = isImage;
    deps.refs.saveModal.input.value = deps.state.save.title || '';
    deps.refs.saveModal.input.disabled = deps.state.save.saving || !!currentAttempt || isImage;
    deps.refs.saveModal.folder.disabled = deps.state.save.saving || !!currentAttempt;
    deps.refs.saveModal.note.textContent = deps.state.save.note || '';
    deps.refs.saveModal.confirm.disabled = deps.state.save.saving || ['unknown', 'success'].includes(currentAttempt?.status);
    deps.refs.saveModal.confirm.textContent = deps.state.save.saving
      ? 'Saving...'
      : (currentAttempt?.status === 'unknown' ? 'Verify saved assets first' : currentAttempt?.status === 'success' ? 'Already saved' : currentAttempt?.status === 'rejected' ? 'Retry this save' : (intent?.confirmLabel || 'Save'));
    deps.setResultState(
      deps.refs.saveModal.state,
      deps.state.save.stateTone,
      deps.state.save.stateMessage,
    );
    deps.renderSaveFolderOptions();
  }

  function closeSaveModal() {
    if (!deps.state.save.open || deps.state.save.saving) return;
    dialogVersion += 1;
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
    restoreFocusSafely(returnFocus);
    returnFocus = null;
  }

  async function loadSaveFolders() {
    const result = await deps.apiAiGetFolders();
    if (result?.ok === false) throw new Error('Folders unavailable');
    return Array.isArray(result?.folders) ? result.folders : [];
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
    if (deps.state.save.saving) return;
    const intent = getSaveIntent(task);
    if (!intent) {
      const unavailableMessage = getSaveIntentUnavailableMessage(task);
      deps.setStatus(unavailableMessage, 'error');
      if (deps.showToast) deps.showToast(unavailableMessage, 'error');
      return;
    }

    const version = ++dialogVersion;
    const messages = task === 'live-agent' ? deps.getLiveAgentMessages() : null;
    if (messages && (transcriptIdentity.messages !== messages || transcriptIdentity.length !== messages.length)) {
      transcriptIdentity = { messages, length: messages.length, key: {} };
    }
    const resultIdentity = task === 'live-agent' ? transcriptIdentity.key : deps.state.results[task]?.raw;
    currentAttempt = resultIdentity && typeof resultIdentity === 'object' ? attempts.get(resultIdentity) || null : null;
    const snapshot = currentAttempt?.intent || structuredClone(intent);
    if (!currentAttempt && snapshot.sourceModule === 'video') {
      const posterBase64 = captureVideoPosterBase64(deps.refs.video?.preview);
      if (posterBase64) snapshot.payload.posterBase64 = posterBase64;
    }
    if (!deps.state.save.open) {
      // WebKit pointer activation does not necessarily focus the clicked button.
      returnFocus = deps.refs[task === 'live-agent' ? 'liveAgent' : task]?.save || document.activeElement;
    }
    deps.state.save.resultIdentity = resultIdentity;
    deps.state.save.open = true;
    deps.state.save.task = task;
    deps.state.save.type = intent.type;
    deps.state.save.intent = snapshot;
    deps.state.save.saving = false;
    deps.state.save.title = currentAttempt?.title || snapshot.defaultTitle || '';
    deps.state.save.folderId = currentAttempt?.folderId || '';
    deps.state.save.note = snapshot.note || '';
    deps.setSaveState('loading', 'Loading folders...');
    renderSaveModal();

    focusElementSafely(intent.type === 'image' ? deps.refs.saveModal.folder : deps.refs.saveModal.input);
    try {
      const folders = await loadSaveFolders();
      if (version !== dialogVersion || !deps.state.save.open) return;
      deps.state.save.folders = folders;
      deps.setSaveState(currentAttempt?.status === 'unknown' ? 'error' : 'neutral',
        currentAttempt?.status === 'unknown' ? 'Save outcome is unknown. Inspect saved assets before creating another copy.' :
        currentAttempt?.status === 'success' ? 'This result was already saved.' :
        currentAttempt?.status === 'rejected' ? 'The previous save was rejected. Retry keeps its original title, folder and generated inputs.' :
        'Choose a folder and confirm the save.');
    } catch {
      if (version !== dialogVersion || !deps.state.save.open) return;
      deps.state.save.folders = [];
      deps.setSaveState('error', currentAttempt?.status === 'unknown'
        ? 'Save outcome is unknown. Folder list unavailable; inspect saved assets before creating another copy.'
        : 'Folder list unavailable. You can still save to Assets.');
    }
    renderSaveModal();
  }

  async function confirmSaveModal() {
    const intent = deps.state.save.intent;
    if (!deps.state.save.open || !intent || deps.state.save.saving || ['unknown', 'success'].includes(currentAttempt?.status)) return;

    if (intent.type !== 'image' && !(deps.state.save.title || '').trim()) {
      deps.setSaveState('error', 'Title is required.');
      renderSaveModal();
      return;
    }

    const version = dialogVersion;
    const attempt = currentAttempt || {
      intent: structuredClone(intent), title: deps.state.save.title,
      folderId: deps.state.save.folderId || null, status: 'pending',
    };
    currentAttempt = attempt;
    if (deps.state.save.resultIdentity && typeof deps.state.save.resultIdentity === 'object') {
      attempts.set(deps.state.save.resultIdentity, attempt);
    }
    attempt.status = 'pending';
    deps.state.save.saving = true;
    deps.setSaveState('loading', 'Saving asset...');
    renderSaveModal();

    try {
      const saveResult = await saveAdminAiLabIntent({
        intent: attempt.intent,
        title: attempt.title,
        folderId: attempt.folderId,
        apiAiSaveImage: deps.apiAiSaveImage,
        apiAiSaveAudio: deps.apiAiSaveAudio,
        apiAdminAiSaveTextAsset: deps.apiAdminAiSaveTextAsset,
      });

      if (version !== dialogVersion) return;
      if (!saveResult.ok) {
        attempt.status = saveResult.uncertain ? 'unknown' : 'rejected';
        deps.setSaveState('error', saveResult.uncertain
          ? `${saveResult.error || 'Save failed.'} Outcome unknown. Inspect saved assets before creating another copy.`
          : `${saveResult.error || 'Save rejected.'} Retry keeps this original save intent.`);
        deps.state.save.saving = false;
        renderSaveModal();
        return;
      }

      attempt.status = 'success';
      deps.state.save.saving = false;
      closeSaveModal();
      deps.setStatus(saveResult.statusMessage, 'success');
      if (deps.showToast) deps.showToast(saveResult.toastMessage);
      // A failed follow-up read must not turn confirmed persistence into a failed save.
      try { await deps.refreshSavedAssetsBrowser(); } catch { /* Refresh is independently retryable. */ }
    } catch {
      if (version !== dialogVersion) return;
      attempt.status = 'unknown';
      deps.setSaveState('error', 'Save outcome is unknown. Inspect saved assets before creating another copy.');
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
