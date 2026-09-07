const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Real browser-free product entrypoint: no copied helper, UI stub, module-type
// override or provider access. The existing Worker regression remains in place.
const loadOperations = () => import(pathToFileURL(
  path.join(process.cwd(), 'js/pages/admin/ai-lab-save-operations.mjs'),
).href);
const imagePayload = () => ({
  saveReference: 'reference-A', imageData: 'data:image/png;base64,QUFB',
  prompt: 'Original prompt A', model: 'original-model-A', steps: 4, seed: 7,
});
const imageArguments = (payload, source) => [source, payload.prompt, payload.model, payload.steps, payload.seed, 'original-folder-A'];

for (const code of ['INVALID_SAVE_REFERENCE', 'SAVE_REFERENCE_EXPIRED', 'SAVE_REFERENCE_UNAVAILABLE']) {
  test(`admin AI image save falls back exactly once for ${code} with the original arguments`, async () => {
    const { saveImageIntentWithFallback } = await loadOperations();
    const payload = imagePayload(); const original = structuredClone(payload); const calls = [];
    const success = { ok: true, data: { id: 'saved-image-A' } };
    const response = await saveImageIntentWithFallback(payload, {
      folderId: 'original-folder-A',
      apiAiSaveImage: async (...args) => {
        calls.push(args);
        return calls.length === 1 ? { ok: false, code } : success;
      },
    });
    expect(typeof document).toBe('undefined');
    expect(response).toBe(success);
    expect(calls).toEqual([
      imageArguments(original, { saveReference: original.saveReference }),
      imageArguments(original, original.imageData),
    ]);
    expect(payload).toEqual(original);
  });
}

test('admin AI image save never retries a successful or unrelated unconfirmed response', async () => {
  const { saveImageIntentWithFallback } = await loadOperations();
  for (const first of [
    { ok: true, data: { id: 'saved-reference-A' } },
    { ok: false, code: 'network_error' },
    { ok: false, code: 'internal_error', status: 500 },
    { ok: false, code: 'unauthorized', status: 401 },
    { ok: false, code: 'forbidden', status: 403 },
    { ok: false, code: 'rate_limited', status: 429 },
    { ok: false, code: 'save_reference_expired' },
    { ok: false, error: 'Unknown outcome' },
  ]) {
    await test.step(first.code || (first.ok ? 'confirmed success' : 'no compatibility code'), async () => {
      const calls = []; const payload = imagePayload();
      const response = await saveImageIntentWithFallback(payload, {
        folderId: 'original-folder-A', apiAiSaveImage: async (...args) => { calls.push(args); return first; },
      });
      expect(response).toBe(first);
      expect(calls).toEqual([imageArguments(payload, { saveReference: payload.saveReference })]);
    });
  }
});

test('admin AI image save preserves missing-source guards and does not recurse after fallback failure', async () => {
  const { saveImageIntentWithFallback } = await loadOperations();
  const fallbackFailure = { ok: false, code: 'SAVE_REFERENCE_EXPIRED', error: 'Still unavailable' };
  for (const kind of ['without-inline-image', 'without-reference', 'fallback-fails']) {
    await test.step(kind, async () => {
      const payload = imagePayload(); const calls = [];
      if (kind === 'without-inline-image') delete payload.imageData;
      if (kind === 'without-reference') delete payload.saveReference;
      const result = await saveImageIntentWithFallback(payload, {
        folderId: 'original-folder-A', apiAiSaveImage: async (...args) => { calls.push(args); return fallbackFailure; },
      });
      expect(result).toBe(fallbackFailure);
      expect(calls).toEqual(kind === 'fallback-fails'
        ? [imageArguments(payload, { saveReference: payload.saveReference }), imageArguments(payload, payload.imageData)]
        : [imageArguments(payload, payload.saveReference ? { saveReference: payload.saveReference } : payload.imageData)]);
    });
  }
  let calls = 0;
  await expect(saveImageIntentWithFallback(imagePayload(), {
    folderId: 'original-folder-A', apiAiSaveImage: async () => { calls += 1; throw new Error('Response lost'); },
  })).rejects.toThrow('Response lost');
  expect(calls).toBe(1);
});

test('admin AI saves route the original title, folder and generated data to the correct endpoint', async () => {
  const { saveAdminAiLabIntent } = await loadOperations();
  for (const sourceModule of ['text', 'embeddings', 'compare', 'live-agent', 'video', 'music']) {
    await test.step(sourceModule, async () => {
      const generated = { prompt: 'Generated prompt A', output: 'Generated result A', model: 'Model A' };
      const intent = { type: 'text', sourceModule, payload: structuredClone(generated) };
      const calls = [];
      const result = await saveAdminAiLabIntent({
        intent, title: 'Editable filename A', folderId: 'original-folder-A',
        apiAiSaveImage: async () => { throw new Error('Image endpoint must not be called'); },
        apiAiSaveAudio: async body => { calls.push({ kind: 'audio', body }); return { ok: true }; },
        apiAdminAiSaveTextAsset: async body => { calls.push({ kind: 'asset', body }); return { ok: true }; },
      });
      expect(result.ok).toBe(true);
      expect(calls).toEqual(sourceModule === 'music'
        ? [{ kind: 'audio', body: { title: 'Editable filename A', folder_id: 'original-folder-A', ...generated } }]
        : [{ kind: 'asset', body: { title: 'Editable filename A', folderId: 'original-folder-A', sourceModule, data: generated } }]);
      expect(intent.payload).toEqual(generated);
    });
  }
});

test('admin AI save results distinguish a confirmed rejection from unknown persistence', async () => {
  const { saveAdminAiLabIntent } = await loadOperations();
  for (const type of ['image', 'text', 'audio']) {
    for (const status of [400, 401, 403, 413, 422, 429, 500, 503, undefined]) {
      await test.step(`${type} ${status || 'network failure'}`, async () => {
        let calls = 0;
        const reject = async () => { calls += 1; return { ok: false, status, error: 'Original failure' }; };
        const intent = type === 'image'
          ? { type: 'image', payload: imagePayload() }
          : { type: 'text', sourceModule: type === 'audio' ? 'music' : 'text', payload: { prompt: 'Prompt A', output: 'A' } };
        const result = await saveAdminAiLabIntent({
          intent, title: 'Original filename', folderId: 'original-folder-A',
          apiAiSaveImage: reject, apiAiSaveAudio: reject, apiAdminAiSaveTextAsset: reject,
        });
        expect(result).toEqual({ ok: false, error: 'Original failure', uncertain: ![400, 401, 403, 413, 422, 429].includes(status) });
        expect(calls).toBe(1);
      });
    }
  }
});
