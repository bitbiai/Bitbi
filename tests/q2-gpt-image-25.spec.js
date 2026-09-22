const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const fixture = fs.readFileSync('tests/fixtures/media/member-image.png');
const dataUri = `data:image/png;base64,${fixture.toString('base64')}`;

test('GPT Image 2.5 adapter forwards every enum and preserves Completed PNG bytes', async () => {
  const contract = await import('../js/shared/gpt-image-25-contract.mjs');
  const { callImage25Provider, image25Output } = await import('../workers/shared/gpt-image-25.mjs');
  const { invokeImage } = await import('../workers/ai/src/lib/invoke-ai.js');
  const { validateImageBody } = await import('../workers/ai/src/lib/validate.js');
  for (const model of contract.GPT_IMAGE_25_MODELS) {
    for (const quality of contract.GPT_IMAGE_25_QUALITY_OPTIONS) {
      let called;
      const env = { AI: { run: async (...args) => { called = args; return { state: 'Completed', result: { image: dataUri } }; } } };
      const input = { model: model.id, prompt: 'synthetic', quality, size: 'auto', background: 'transparent', outputFormat: 'png', referenceImages: Array(16).fill(dataUri) };
      const output = await invokeImage(env, model, validateImageBody(input));
      expect(called[0]).toBe(model.id);
      expect(called[1]).toMatchObject({ quality, size: 'auto', background: 'transparent', output_format: 'png', images: Array(16).fill(dataUri) });
      expect(called[2].gateway).toMatchObject({ collectLog: false, skipCache: true });
      expect(output.imageBase64).toBe(fixture.toString('base64'));
    }
    for (const size of contract.GPT_IMAGE_25_SIZE_OPTIONS) for (const background of contract.GPT_IMAGE_25_BACKGROUND_OPTIONS) for (const outputFormat of contract.GPT_IMAGE_25_OUTPUT_FORMAT_OPTIONS) {
      if (background === 'transparent' && outputFormat === 'jpeg') expect(() => contract.normalizeGptImage25Options({ size, background, outputFormat })).toThrow();
      else {
        const original = outputFormat === 'png' ? fixture : fs.readFileSync(`tests/fixtures/media/${outputFormat === 'jpeg' ? 'favorite-thumb.jpg' : 'member-video-poster.webp'}`);
        let sent;
        const env = { AI: { run: async (_model, payload) => { sent = payload; return { state: 'Completed', result: { image: `data:image/${outputFormat};base64,${original.toString('base64')}` } }; } } };
        const result = await invokeImage(env, model, validateImageBody({ model: model.id, prompt: 'Synthetic enum forwarding', size, background, outputFormat }));
        expect(sent).toMatchObject({ size, background, output_format: outputFormat });
        expect(result.imageBase64).toBe(original.toString('base64'));
        expect(result.mimeType).toBe(`image/${outputFormat}`);
      }
    }
  }
  expect(() => contract.normalizeGptImage25Options({ source_images: Array(17).fill({}) })).toThrow();
  const raw = await callImage25Provider({ run: async () => Response.json({ success: true, result: { state: 'Completed', result: { image: dataUri } } }) }, contract.GPT_IMAGE_25_MODEL_IDS[0], {});
  expect((await image25Output(raw)).base64).toBe(fixture.toString('base64'));
  const direct = await callImage25Provider({ run: async () => Response.json({ state: 'Completed', result: { image: dataUri } }) }, contract.GPT_IMAGE_25_MODEL_IDS[0], {});
  expect(direct.state).toBe('Completed');
  expect((await image25Output(direct)).base64).toBe(fixture.toString('base64'));
});

test('GPT Image 2.5 owned references enforce identity, decoding, order and bounded aggregate', async () => {
  const { resolveImage25Sources } = await import('../workers/auth/src/lib/gpt-image-25-sources.js');
  const sources = Array.from({ length: 16 }, (_, i) => ({ source_type: 'saved_asset', asset_id: `asset-${i}` }));
  const env = { DB: { prepare: () => ({ bind: (id, owner) => ({ first: async () => owner === 'owner' ? { id, r2_key: `owned/${id}`, size_bytes: fixture.length } : null }) }) }, USER_IMAGES: { get: async () => ({ body: new Response(fixture).body, size: fixture.length, httpMetadata: { contentType: 'image/png' } }) }, IMAGES: { info: async () => ({ width: 1, height: 1 }) } };
  const resolved = await resolveImage25Sources(env, 'owner', sources);
  expect(resolved.identities.map(source => source.asset_id)).toEqual(sources.map(source => source.asset_id));
  expect(resolved.sourceRefs.every(source => source.r2_key.startsWith('owned/'))).toBe(true);
  expect(resolved.referenceImageCount).toBe(16);
  await expect(resolveImage25Sources(env, 'foreign', sources)).rejects.toMatchObject({ code: 'reference_not_found' });
  await expect(resolveImage25Sources(env, 'owner', [...sources, sources[0]])).rejects.toMatchObject({ code: 'too_many_references' });
  await expect(resolveImage25Sources(env, 'owner', [{ ...sources[0], content_hash: 'changed' }])).rejects.toMatchObject({ code: 'reference_changed' });
  env.USER_IMAGES.get = async () => ({ size: 11 * 1024 * 1024 });
  await expect(resolveImage25Sources(env, 'owner', sources)).rejects.toMatchObject({ status: 413 });
});

test('GPT Image 2.5 errors retain safe diagnostics and never classify ambiguous HTTP failures as rejection', async () => {
  const { callImage25Provider, image25Output } = await import('../workers/shared/gpt-image-25.mjs');
  for (const [status, code, noInference] of [[400, 3003, true], [400, 9999, false], [403, 10000, false], [500, 3003, false]]) {
    const ai = { run: async () => Response.json({ success: false, errors: [{ code, message: 'private prompt data:image/png;base64,secret https://signed.example/path?secret' }] }, { status, headers: { 'cf-ai-req-id': 'request_12345' } }) };
    let error; try { await callImage25Provider(ai, 'openai/gpt-image-2.5-flare', {}); } catch (caught) { error = caught; }
    expect(error.providerDiagnostic).toMatchObject({ code, status, noInference, requestId: 'request_12345' });
    expect(JSON.stringify(error)).not.toContain('private prompt');
    expect(error.message).not.toContain('secret');
  }
  let fetches = 0;
  for (const image of ['https://127.0.0.1/private', 'https://localhost/private', 'https://u:p@example.com/x']) await expect(image25Output({ image }, { fetcher: () => { fetches++; } })).rejects.toMatchObject({ code: 'image_output_invalid' });
  expect(fetches).toBe(0);
  await expect(image25Output({ state: 'Running', result: { image: dataUri } })).rejects.toMatchObject({ code: 'generation_provider_outcome_unknown' });
  for (const state of ['Running', '', null]) {
    const response = await callImage25Provider({ run: async () => Response.json({ state, result: { image: dataUri } }) }, 'openai/gpt-image-2.5-flare', {});
    expect(response.state).toBe(state);
    await expect(image25Output(response)).rejects.toMatchObject({ code: 'generation_provider_outcome_unknown' });
  }
});

test('GPT Image 2.5 cancels stalled provider output bodies at the existing deadline', async () => {
  const { image25Output } = await import('../workers/shared/gpt-image-25.mjs');
  const { runWithGenerationTimeout } = await import('../workers/ai/src/lib/generation-timeout.js');
  let cancelled = false;
  const fetcher = async (_url, { signal, redirect }) => {
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(redirect).toBe('error');
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'image/png' } });
  };
  await expect(runWithGenerationTimeout(signal => image25Output({ image: 'https://provider.example/image.png' }, { fetcher, signal }), { timeoutMs: 25 })).rejects.toMatchObject({ code: 'generation_timeout' });
  expect(cancelled).toBe(true);
});

test('GPT Image 2.5 temporary result rejects undecodable content before storage and billing', async () => {
  const { createAiGeneratedSaveReferenceFromBase64 } = await import('../workers/auth/src/routes/ai/generated-image-save-reference.js');
  let writes = 0;
  const env = { USER_IMAGES: { put: async () => { writes++; } }, IMAGES: { info: async () => { throw new Error('synthetic decoder rejected'); } } };
  await expect(createAiGeneratedSaveReferenceFromBase64(env, { userId: 'owner', imageBase64: fixture.toString('base64'), mimeType: 'image/png', generationMetadata: { model: 'openai/gpt-image-2.5-flare' } })).rejects.toMatchObject({ code: 'image_output_invalid' });
  expect(writes).toBe(0);
});
