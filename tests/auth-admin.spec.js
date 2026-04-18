const { test, expect } = require('@playwright/test');

const ONE_PX_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';

function createSvgUpload(width, height) {
  return {
    name: `ref-${width}x${height}.svg`,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#111827"/></svg>`,
      'utf8',
    ),
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSavedAssetsStore(folderPayload = {}, assetsPayload = {}) {
  const folders = cloneJson(folderPayload.folders || []);
  const assetMap = new Map();
  const seedAssets = []
    .concat(assetsPayload.all || [])
    .concat(assetsPayload.unfoldered || [])
    .concat(...Object.values(assetsPayload.folders || {}));

  seedAssets.forEach((asset) => {
    assetMap.set(asset.id, cloneJson(asset));
  });

  function listAssets({ folderId = null, onlyUnfoldered = false } = {}) {
    let assets = Array.from(assetMap.values());
    if (onlyUnfoldered) {
      assets = assets.filter((asset) => !asset.folder_id);
    } else if (folderId) {
      assets = assets.filter((asset) => asset.folder_id === folderId);
    }
    return assets
      .slice()
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }

  function counts() {
    const folderCounts = {};
    let unfolderedCount = 0;
    for (const asset of assetMap.values()) {
      if (asset.folder_id) {
        folderCounts[asset.folder_id] = (folderCounts[asset.folder_id] || 0) + 1;
      } else {
        unfolderedCount += 1;
      }
    }
    return { folderCounts, unfolderedCount };
  }

  return {
    getFolderPayload() {
      const { folderCounts, unfolderedCount } = counts();
      return {
        folders: cloneJson(folders),
        counts: folderCounts,
        unfolderedCount,
      };
    },
    list(url) {
      const folderId = url.searchParams.get('folder_id') || null;
      const onlyUnfoldered = url.searchParams.get('only_unfoldered') === '1';
      return listAssets({ folderId, onlyUnfoldered });
    },
    getAsset(id) {
      const asset = assetMap.get(id);
      return asset ? cloneJson(asset) : null;
    },
    addAsset(asset) {
      assetMap.set(asset.id, cloneJson(asset));
    },
    setImageVisibility(id, visibility) {
      const asset = assetMap.get(id);
      if (!asset || asset.asset_type !== 'image') return null;
      asset.visibility = visibility;
      asset.is_public = visibility === 'public';
      asset.published_at = visibility === 'public'
        ? (asset.published_at || '2026-04-12T12:00:00.000Z')
        : null;
      return cloneJson(asset);
    },
    moveAssets(ids, folderId) {
      ids.forEach((id) => {
        const asset = assetMap.get(id);
        if (!asset) return;
        asset.folder_id = folderId || null;
      });
    },
    deleteAssets(ids) {
      ids.forEach((id) => assetMap.delete(id));
    },
  };
}

function createMockAiCatalog() {
  return {
    ok: true,
    task: 'models',
    presets: [
      {
        name: 'fast',
        task: 'text',
        label: 'Fast Text',
        model: '@cf/meta/llama-3.1-8b-instruct-fast',
        description: 'Fast text preset',
      },
      {
        name: 'balanced',
        task: 'text',
        label: 'Balanced Text',
        model: '@cf/openai/gpt-oss-20b',
        description: 'Balanced text preset',
      },
      {
        name: 'image_fast',
        task: 'image',
        label: 'Fast Image',
        model: '@cf/black-forest-labs/flux-1-schnell',
        description: 'Fast image preset',
      },
      {
        name: 'embedding_default',
        task: 'embeddings',
        label: 'Default Embeddings',
        model: '@cf/baai/bge-m3',
        description: 'Default embeddings preset',
      },
      {
        name: 'music_studio',
        task: 'music',
        label: 'Music Studio',
        model: 'minimax/music-2.6',
        description: 'Admin music preset',
      },
      {
        name: 'video_studio',
        task: 'video',
        label: 'Video Studio',
        model: 'pixverse/v6',
        description: 'Admin video preset',
      },
    ],
    models: {
      text: [
        {
          id: '@cf/meta/llama-3.1-8b-instruct-fast',
          task: 'text',
          label: 'Llama 3.1 8B Instruct Fast',
          vendor: 'Meta',
          description: 'Fast text model',
        },
        {
          id: '@cf/openai/gpt-oss-20b',
          task: 'text',
          label: 'GPT OSS 20B',
          vendor: 'OpenAI',
          description: 'Balanced text model',
        },
        {
          id: '@cf/google/gemma-4-26b-a4b-it',
          task: 'text',
          label: 'Gemma 4 26B A4B',
          vendor: 'Google',
          description: 'Balanced conversational text model',
        },
      ],
      image: [
        {
          id: '@cf/black-forest-labs/flux-1-schnell',
          task: 'image',
          label: 'FLUX.1 Schnell',
          vendor: 'Black Forest Labs',
          description: 'Fast image model',
          capabilities: {
            supportsSeed: true,
            supportsSteps: true,
            supportsDimensions: false,
            supportsGuidance: false,
            supportsStructuredPrompt: false,
            supportsReferenceImages: false,
            maxReferenceImages: 0,
            maxSteps: 8,
            defaultSteps: 4,
            minGuidance: null,
            maxGuidance: null,
            defaultGuidance: null,
          },
        },
        {
          id: '@cf/black-forest-labs/flux-2-klein-9b',
          task: 'image',
          label: 'FLUX.2 Klein 9B',
          vendor: 'Black Forest Labs',
          description: 'Multipart image model for admin experiments',
          capabilities: {
            supportsSeed: false,
            supportsSteps: false,
            supportsDimensions: true,
            supportsGuidance: false,
            supportsStructuredPrompt: false,
            supportsReferenceImages: false,
            maxReferenceImages: 0,
            maxSteps: null,
            defaultSteps: null,
            minGuidance: null,
            maxGuidance: null,
            defaultGuidance: null,
          },
        },
        {
          id: '@cf/black-forest-labs/flux-2-dev',
          task: 'image',
          label: 'FLUX.2 Dev',
          vendor: 'Black Forest Labs',
          description: 'Higher-capability multipart image model for admin experiments',
          capabilities: {
            supportsSeed: true,
            supportsSteps: true,
            supportsDimensions: true,
            supportsGuidance: true,
            supportsStructuredPrompt: true,
            supportsReferenceImages: true,
            maxReferenceImages: 4,
            maxSteps: 50,
            defaultSteps: 20,
            minGuidance: 1,
            maxGuidance: 20,
            defaultGuidance: 7.5,
          },
        },
      ],
      embeddings: [
        {
          id: '@cf/baai/bge-m3',
          task: 'embeddings',
          label: 'BGE M3',
          vendor: 'BAAI',
          description: 'Default embeddings model',
        },
      ],
      music: [
        {
          id: 'minimax/music-2.6',
          task: 'music',
          label: 'Music 2.6',
          vendor: 'MiniMax',
          description: 'Prompt-based music generation with vocal and instrumental controls.',
        },
      ],
      video: [
        {
          id: 'pixverse/v6',
          task: 'video',
          label: 'Pixverse V6',
          vendor: 'Pixverse',
          description: 'Prompt-driven video generation for admin testing.',
        },
      ],
    },
    future: {
      speech: {
        enabled: false,
        note: 'Speech support is scaffold-only in v1.',
      },
    },
  };
}

async function seedCookieConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'bitbi_cookie_consent',
      JSON.stringify({
        v: '1',
        ts: Date.now(),
        necessary: true,
        analytics: false,
        marketing: false,
      }),
    );
  });
}

async function setAiLabTimeouts(page, overrides) {
  await page.addInitScript((config) => {
    window.BITBI_ADMIN_AI_LAB_TIMEOUTS = config;
  }, overrides);
}

async function installClipboardSpy(page) {
  await page.addInitScript(() => {
    window.__bitbiClipboard = { value: '' };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__bitbiClipboard.value = String(text);
        },
        readText: async () => window.__bitbiClipboard.value,
      },
    });
  });
}

async function readClipboardValue(page) {
  return page.evaluate(() => window.__bitbiClipboard?.value || '');
}

async function mockAdminAiLab(page, captures = {}) {
  const catalog = createMockAiCatalog();
  const saveTextAssetRequests = captures.saveTextAssetRequests || [];
  const saveImageRequests = captures.saveImageRequests || [];
  const assetStore = captures.assetStore || createSavedAssetsStore(
    captures.folderPayload || {
      folders: [
        { id: 'folder-launches', name: 'Launches', slug: 'launches', created_at: '2026-04-10T09:00:00.000Z' },
        { id: 'folder-research', name: 'Research', slug: 'research', created_at: '2026-04-09T09:00:00.000Z' },
      ],
    },
    captures.assetsPayload || {
      all: [
        {
          id: 'img-asset-1',
          asset_type: 'image',
          folder_id: 'folder-launches',
          title: 'Launch Key Visual',
          preview_text: 'Launch Key Visual',
          model: '@cf/black-forest-labs/flux-1-schnell',
          steps: 4,
          seed: 123,
          created_at: '2026-04-10T12:00:00.000Z',
          file_url: '/api/ai/images/img-asset-1/file',
          original_url: '/api/ai/images/img-asset-1/file',
          thumb_url: '/api/ai/images/img-asset-1/thumb',
          medium_url: '/api/ai/images/img-asset-1/medium',
        },
        {
          id: 'txt-asset-1',
          asset_type: 'text',
          folder_id: 'folder-research',
          title: 'Embeddings Summary',
          file_name: 'embeddings-summary.txt',
          source_module: 'embeddings',
          mime_type: 'text/plain; charset=utf-8',
          size_bytes: 512,
          preview_text: 'Dimensionality check and clustering notes.',
          created_at: '2026-04-10T11:30:00.000Z',
          file_url: '/api/ai/text-assets/txt-asset-1/file',
        },
        {
          id: 'snd-asset-1',
          asset_type: 'sound',
          folder_id: null,
          title: 'Sound Concept Loop',
          file_name: 'sound-concept-loop.mp3',
          source_module: 'text',
          mime_type: 'audio/mpeg',
          size_bytes: 204800,
          preview_text: 'Short atmospheric loop saved into the shared asset browser.',
          created_at: '2026-04-10T11:00:00.000Z',
          file_url: '/api/ai/text-assets/snd-asset-1/file',
        },
      ],
    },
  );

  await page.route('**/api/admin/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        user: {
          id: 'admin-1',
          email: 'admin@bitbi.ai',
          role: 'admin',
        },
      }),
    });
  });

  await page.route('**/api/admin/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        stats: {
          totalUsers: 12,
          activeUsers: 10,
          admins: 2,
          verifiedUsers: 11,
          disabledUsers: 2,
          recentRegistrations: 3,
        },
      }),
    });
  });

  await page.route('**/api/admin/ai/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(catalog),
    });
  });

  await page.route('**/api/admin/ai/test-text', async (route) => {
    const body = route.request().postDataJSON();
    if (body.prompt === 'force error') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: 'Prompt rejected by mock.',
        }),
      });
      return;
    }

    if (body.prompt === 'force coded error') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          code: 'model_not_allowed',
          error: 'Model "@cf/not-allowlisted/model" is not allowlisted for task "text".',
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        task: 'text',
        model: catalog.models.text[1],
        preset: body.preset || 'balanced',
        result: {
          text: 'Mocked text output from admin AI Lab.',
          usage: {
            total_tokens: 42,
          },
          maxTokens: body.maxTokens,
          temperature: body.temperature,
        },
        elapsedMs: 123,
        warnings: ['Mock text warning'],
      }),
    });
  });

  await page.route('**/api/admin/ai/test-image', async (route) => {
    const body = route.request().postDataJSON();
    const selectedModel =
      catalog.models.image.find((entry) => entry.id === body.model) ||
      catalog.models.image.find((entry) => entry.id === '@cf/black-forest-labs/flux-1-schnell') ||
      catalog.models.image[0];
    const usesLegacyControls = selectedModel.id === '@cf/black-forest-labs/flux-1-schnell';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        task: 'image',
        model: selectedModel,
        preset: body.preset || 'image_fast',
        result: {
          imageBase64: ONE_PX_PNG_BASE64,
          mimeType: 'image/png',
          steps: usesLegacyControls ? body.steps ?? 4 : null,
          seed: usesLegacyControls ? body.seed ?? 12345 : null,
          requestedSize:
            body.width && body.height
              ? { width: body.width, height: body.height }
              : null,
          appliedSize:
            !usesLegacyControls && body.width && body.height
              ? { width: body.width, height: body.height }
              : null,
        },
        elapsedMs: 456,
        warnings: body.model && body.model !== '@cf/black-forest-labs/flux-1-schnell'
          ? ['Explicit model overrides the default image preset.']
          : ['Mock image warning'],
      }),
    });
  });

  await page.route('**/api/admin/ai/test-embeddings', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        task: 'embeddings',
        model: catalog.models.embeddings[0],
        preset: 'embedding_default',
        result: {
          vectors: [
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
          ],
          dimensions: 3,
          count: 2,
          shape: [2, 3],
          pooling: null,
        },
        elapsedMs: 88,
      }),
    });
  });

  await page.route('**/api/admin/ai/test-music', async (route) => {
    const body = route.request().postDataJSON();
    if (body.prompt === 'force music error') {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          code: 'upstream_error',
          error: 'Music generation failed',
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        task: 'music',
        model: catalog.models.music[0],
        preset: body.preset || 'music_studio',
        result: {
          prompt: body.prompt,
          mode: body.mode || 'vocals',
          lyricsMode: body.lyricsMode || 'custom',
          bpm: body.bpm ?? null,
          key: body.key || null,
          mimeType: 'audio/mpeg',
          audioUrl: 'https://example.com/generated-track.mp3',
          audioBase64: null,
          durationMs: 25364,
          sampleRate: 44100,
          channels: 2,
          bitrate: 256000,
          sizeBytes: 813651,
          providerStatus: 2,
          lyricsPreview: body.mode === 'instrumental'
            ? null
            : (body.lyricsMode === 'auto'
              ? '[Verse]\nGenerated automatic lyrics for the test harness.'
              : body.lyrics),
        },
        traceId: 'mock-music-trace',
        elapsedMs: 512,
      }),
    });
  });

  await page.route('**/api/admin/ai/test-video', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        task: 'video',
        model: catalog.models.video[0],
        preset: body.preset || 'video_studio',
        result: {
          videoUrl: 'https://example.com/generated-video.mp4',
          prompt: body.prompt,
          duration: body.duration ?? 5,
          aspect_ratio: body.aspect_ratio || '16:9',
          quality: body.quality || '720p',
          seed: body.seed ?? null,
          generate_audio: body.generate_audio !== false,
          hasImageInput: !!body.image_input,
        },
        elapsedMs: 645,
        warnings: ['Mock video warning'],
      }),
    });
  });

  await page.route('**/api/admin/ai/compare', async (route) => {
    const body = route.request().postDataJSON();
    if (body.prompt === 'identical compare output') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          task: 'compare',
          models: catalog.models.text,
          result: {
            results: [
              {
                ok: true,
                model: catalog.models.text[0],
                text: 'BITBI keeps the compare output deliberately aligned for contract testing.',
                usage: { total_tokens: 13 },
                elapsedMs: 101,
              },
              {
                ok: true,
                model: catalog.models.text[1],
                text: 'BITBI keeps the compare output deliberately aligned for contract testing.',
                usage: { total_tokens: 14 },
                elapsedMs: 111,
              },
            ],
            maxTokens: 250,
            temperature: 0.7,
          },
          elapsedMs: 240,
        }),
      });
      return;
    }

    if (body.prompt === 'partial compare failure') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          task: 'compare',
          code: 'partial_success',
          models: catalog.models.text,
          result: {
            results: [
              {
                ok: true,
                model: catalog.models.text[0],
                text: 'BITBI keeps one model output available while the other fails.',
                usage: { total_tokens: 12 },
                elapsedMs: 119,
              },
              {
                ok: false,
                model: catalog.models.text[1],
                code: 'upstream_error',
                error: 'Mock compare upstream failure.',
              },
            ],
            maxTokens: 250,
            temperature: 0.7,
          },
          elapsedMs: 260,
          warnings: ['One or more model runs failed during comparison.'],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        task: 'compare',
        models: catalog.models.text,
        result: {
          results: [
            {
              ok: true,
              model: catalog.models.text[0],
              text: 'BITBI blends AI imagery with a premium admin control surface. It feels precise and cinematic.',
              usage: { total_tokens: 11 },
              elapsedMs: 111,
            },
            {
              ok: true,
              model: catalog.models.text[1],
              text: 'BITBI blends AI imagery with a premium admin control surface. It feels agile and technical.',
              usage: { total_tokens: 17 },
              elapsedMs: 123,
            },
          ],
          maxTokens: 250,
          temperature: 0.7,
        },
        elapsedMs: 222,
        warnings: ['Mock compare warning'],
      }),
    });
  });

  await page.route('**/api/ai/folders', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: assetStore.getFolderPayload(),
      }),
    });
  });

  await page.route('**/api/ai/assets**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/ai/assets' || route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: { assets: assetStore.list(url) },
      }),
    });
  });

  await page.route('**/api/ai/assets/bulk-move', async (route) => {
    const body = route.request().postDataJSON();
    assetStore.moveAssets(body.asset_ids || [], body.folder_id || null);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: { moved: Array.isArray(body.asset_ids) ? body.asset_ids.length : 0 },
      }),
    });
  });

  await page.route('**/api/ai/assets/bulk-delete', async (route) => {
    const body = route.request().postDataJSON();
    assetStore.deleteAssets(body.asset_ids || []);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: { deleted: Array.isArray(body.asset_ids) ? body.asset_ids.length : 0 },
      }),
    });
  });

  await page.route('**/api/ai/text-assets/*/file', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const assetId = path.split('/').slice(-2, -1)[0];
    const asset = assetStore.getAsset(assetId);
    const contentType = asset?.mime_type || 'text/plain; charset=utf-8';
    await route.fulfill({
      status: 200,
      contentType,
      body: contentType.startsWith('audio/')
        ? 'mock-audio'
        : contentType.startsWith('video/')
          ? Buffer.from('mock-video')
          : 'Saved AI Lab text asset.',
    });
  });

  await page.route(/\/api\/ai\/images\/[^/]+\/(thumb|medium|file)$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
    });
  });

  await page.route('**/api/ai/images/**', async (route) => {
    const method = route.request().method();
    if (method === 'PATCH' && /\/api\/ai\/images\/[^/]+\/publication$/.test(new URL(route.request().url()).pathname)) {
      const imageId = route.request().url().split('/').slice(-2, -1)[0];
      const body = route.request().postDataJSON();
      const updated = assetStore.setImageVisibility(imageId, body.visibility);
      if (!updated) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'Image not found.' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            id: updated.id,
            visibility: updated.visibility,
            is_public: updated.is_public,
            published_at: updated.published_at,
          },
        }),
      });
      return;
    }
    if (method !== 'DELETE') {
      await route.fallback();
      return;
    }
    const imageId = route.request().url().split('/').pop();
    assetStore.deleteAssets([imageId]);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route('**/api/ai/text-assets/*', async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.fallback();
      return;
    }
    const assetId = route.request().url().split('/').pop();
    assetStore.deleteAssets([assetId]);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route('**/api/admin/ai/save-text-asset', async (route) => {
    const body = route.request().postDataJSON();
    saveTextAssetRequests.push(body);
    const id = `txt-${saveTextAssetRequests.length}`;
    const title = body.title;
    const slug = String(title || 'asset').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'asset';
    const isVideo = body.sourceModule === 'video';
    assetStore.addAsset({
      id,
      asset_type: isVideo ? 'video' : 'text',
      folder_id: body.folderId || null,
      title,
      file_name: `${slug}.${isVideo ? 'mp4' : 'txt'}`,
      source_module: body.sourceModule,
      mime_type: isVideo ? 'video/mp4' : 'text/plain; charset=utf-8',
      size_bytes: isVideo ? 8192 : 420,
      preview_text: body.data?.prompt || 'Saved from admin AI Lab.',
      created_at: '2026-04-10T12:00:00.000Z',
      file_url: `/api/ai/text-assets/${id}/file`,
    });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          id,
          folder_id: body.folderId || null,
          title,
          file_name: `${slug}.${isVideo ? 'mp4' : 'txt'}`,
          source_module: body.sourceModule,
          mime_type: isVideo ? 'video/mp4' : 'text/plain; charset=utf-8',
          size_bytes: isVideo ? 8192 : 420,
          preview_text: body.data?.prompt || 'Saved from admin AI Lab.',
          created_at: '2026-04-10T12:00:00.000Z',
        },
      }),
    });
  });

  await page.route('**/api/ai/images/save', async (route) => {
    const body = route.request().postDataJSON();
    saveImageRequests.push(body);
    const id = `img-${saveImageRequests.length}`;
    assetStore.addAsset({
      id,
      asset_type: 'image',
      folder_id: body.folder_id || null,
      title: body.prompt,
      preview_text: body.prompt,
      model: body.model,
      steps: body.steps ?? null,
      seed: body.seed ?? null,
      created_at: '2026-04-10T12:00:00.000Z',
      file_url: `/api/ai/images/${id}/file`,
      original_url: `/api/ai/images/${id}/file`,
    });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          id,
          folder_id: body.folder_id || null,
          prompt: body.prompt,
          model: body.model,
          steps: body.steps ?? null,
          seed: body.seed ?? null,
          created_at: '2026-04-10T12:00:00.000Z',
        },
      }),
    });
  });
}

async function mockAuthenticatedImageStudio(page, requests = [], options = {}) {
  const folderPayload = options.folderPayload || {
    folders: [],
    counts: {},
    unfolderedCount: 0,
  };
  const assetsPayload = options.assetsPayload || {
    all: [],
    unfoldered: [],
    folders: {},
  };
  const imageRequests = options.imageRequests || [];
  const assetStore = options.assetStore || createSavedAssetsStore(folderPayload, assetsPayload);

  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        loggedIn: true,
        user: {
          id: 'studio-user-1',
          email: 'studio@example.com',
          role: 'user',
        },
      }),
    });
  });

  await page.route('**/api/favorites', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        favorites: [],
      }),
    });
  });

  await page.route('**/api/ai/quota', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          isAdmin: false,
          dailyLimit: 10,
          usedToday: 0,
          remainingToday: 10,
        },
      }),
    });
  });

  await page.route('**/api/ai/folders', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: assetStore.getFolderPayload(),
      }),
    });
  });

  await page.route('**/api/ai/assets**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/ai/assets' || route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: { assets: assetStore.list(url) },
      }),
    });
  });

  await page.route('**/api/ai/assets/bulk-move', async (route) => {
    const body = route.request().postDataJSON();
    assetStore.moveAssets(body.asset_ids || [], body.folder_id || null);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: { moved: Array.isArray(body.asset_ids) ? body.asset_ids.length : 0 },
      }),
    });
  });

  await page.route('**/api/ai/assets/bulk-delete', async (route) => {
    const body = route.request().postDataJSON();
    assetStore.deleteAssets(body.asset_ids || []);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: { deleted: Array.isArray(body.asset_ids) ? body.asset_ids.length : 0 },
      }),
    });
  });

  await page.route('**/api/ai/text-assets/*/file', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const assetId = path.split('/').slice(-2, -1)[0];
    const asset = assetStore.getAsset(assetId);
    await route.fulfill({
      status: 200,
      contentType: asset?.mime_type || 'text/plain; charset=utf-8',
      body: asset?.mime_type?.startsWith('audio/')
        ? 'mock-audio'
        : asset?.mime_type?.startsWith('video/')
          ? Buffer.from('mock-video')
          : 'Saved AI Lab text asset.',
    });
  });

  await page.route(/\/api\/ai\/images\/[^/]+\/(thumb|medium|file)$/, async (route) => {
    imageRequests.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
    });
  });

  await page.route('**/api/ai/images/**', async (route) => {
    const method = route.request().method();
    if (method === 'PATCH' && /\/api\/ai\/images\/[^/]+\/publication$/.test(new URL(route.request().url()).pathname)) {
      const imageId = route.request().url().split('/').slice(-2, -1)[0];
      const body = route.request().postDataJSON();
      const updated = assetStore.setImageVisibility(imageId, body.visibility);
      if (!updated) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'Image not found.' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            id: updated.id,
            visibility: updated.visibility,
            is_public: updated.is_public,
            published_at: updated.published_at,
          },
        }),
      });
      return;
    }
    if (method !== 'DELETE') {
      await route.fallback();
      return;
    }
    const imageId = route.request().url().split('/').pop();
    assetStore.deleteAssets([imageId]);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route('**/api/ai/text-assets/*', async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.fallback();
      return;
    }
    const assetId = route.request().url().split('/').pop();
    assetStore.deleteAssets([assetId]);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route('**/api/ai/generate-image', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);

    const selectedModel = body.model || '@cf/black-forest-labs/flux-1-schnell';
    const keepsLegacySteps = selectedModel === '@cf/black-forest-labs/flux-1-schnell';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          imageBase64: ONE_PX_PNG_BASE64,
          mimeType: 'image/png',
          prompt: body.prompt,
          model: selectedModel,
          steps: keepsLegacySteps ? body.steps ?? 4 : null,
          seed: keepsLegacySteps ? body.seed ?? null : null,
        },
      }),
    });
  });
}

async function mockAuthenticatedProfile(page, {
  role = 'user',
  email = `${role}@bitbi.ai`,
  displayName = role === 'admin' ? 'Admin User' : 'Member User',
  hasAvatar = false,
  favoritesPayload = [],
  folderPayload = { folders: [], counts: {}, unfolderedCount: 0 },
  assetsPayload = { all: [], unfoldered: [], folders: {} },
  imageRequests = [],
  avatarRequests = [],
  initialAvatar = hasAvatar,
} = {}) {
  const assetStore = createSavedAssetsStore(folderPayload, assetsPayload);
  const avatarState = {
    hasAvatar: initialAvatar,
    sourceImageId: null,
  };

  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        loggedIn: true,
        user: {
          id: `${role}-profile-user`,
          email,
          role,
          display_name: hasAvatar ? displayName : '',
          has_avatar: hasAvatar,
          avatar_url: hasAvatar ? '/api/profile/avatar' : null,
        },
      }),
    });
  });

  await page.route('**/api/profile', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profile: {
          display_name: displayName,
          bio: '',
          website: '',
          youtube_url: '',
        },
        account: {
          id: `${role}-profile-user`,
          email,
          role,
          email_verified: true,
          verification_method: 'email',
          created_at: '2026-04-01T10:00:00.000Z',
        },
      }),
    });
  });

  await page.route('**/api/profile/avatar**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      if (!avatarState.hasAvatar) {
        await route.fulfill({ status: 404, body: '' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
      });
      return;
    }

    if (method === 'DELETE') {
      avatarState.hasAvatar = false;
      avatarState.sourceImageId = null;
      avatarRequests.push({ type: 'delete' });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: 'Avatar removed.' }),
      });
      return;
    }

    const contentType = route.request().headers()['content-type'] || '';
    if (contentType.includes('application/json')) {
      const body = route.request().postDataJSON();
      avatarState.hasAvatar = true;
      avatarState.sourceImageId = body?.source_image_id || null;
      avatarRequests.push({ type: 'saved_asset', body });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: 'Avatar updated.', source: 'saved_assets' }),
      });
      return;
    }

    avatarState.hasAvatar = true;
    avatarState.sourceImageId = null;
    avatarRequests.push({
      type: 'upload',
      contentType,
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: 'Avatar uploaded.' }),
    });
  });

  await page.route('**/api/favorites', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        favorites: favoritesPayload,
      }),
    });
  });

  await page.route('**/api/ai/folders', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: assetStore.getFolderPayload(),
      }),
    });
  });

  await page.route(/\/api\/ai\/images\/[^/]+\/(thumb|medium|file)$/, async (route) => {
    const url = new URL(route.request().url());
    const [, imageId, variant] = url.pathname.match(/^\/api\/ai\/images\/([^/]+)\/(thumb|medium|file)$/) || [];
    imageRequests.push(url.pathname);

    const asset = assetStore.getAsset(imageId);
    if (!asset || asset.asset_type !== 'image') {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Image not found.' }),
      });
      return;
    }

    if (variant === 'thumb' && !asset.thumb_url) {
      assetStore.addAsset({
        ...asset,
        thumb_url: `/api/ai/images/${imageId}/thumb`,
        medium_url: asset.medium_url || `/api/ai/images/${imageId}/medium`,
        derivatives_status: 'ready',
      });
    }

    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
    });
  });

  await page.route('**/api/ai/images**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/ai/images' || route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          images: assetStore.list(url).filter((asset) => asset.asset_type === 'image'),
        },
      }),
    });
  });

  return { assetStore, avatarRequests, imageRequests };
}

async function mockAuthenticatedHeader(page, {
  role = 'user',
  email = 'member@bitbi.ai',
  displayName = '',
  hasAvatar = false,
} = {}) {
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        loggedIn: true,
        user: {
          id: `${role}-header-user`,
          email,
          role,
          display_name: hasAvatar ? displayName : '',
          has_avatar: hasAvatar,
          avatar_url: hasAvatar ? '/api/profile/avatar' : null,
        },
      }),
    });
  });

  await page.route('**/api/favorites', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        favorites: [],
      }),
    });
  });

  await page.route('**/api/profile/avatar**', async (route) => {
    if (!hasAvatar) {
      await route.fulfill({ status: 404, body: '' });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
    });
  });
}

// ---------------------------------------------------------------------------
// Auth modal
// ---------------------------------------------------------------------------

test.describe('Auth modal', () => {
  test.beforeEach(async ({ page }) => {
    // Pre-set cookie consent to prevent banner overlaying interactive elements
    await page.addInitScript(() => {
      localStorage.setItem(
        'bitbi_cookie_consent',
        JSON.stringify({
          v: '1',
          ts: Date.now(),
          necessary: true,
          analytics: false,
          marketing: false,
        }),
      );
    });
    await page.goto('/');
    // Wait for auth state to resolve (API 404 → logged-out → button renders)
    await expect(page.locator('.site-nav__cta')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('sign-in button is present in desktop navigation', async ({ page }) => {
    await expect(page.locator('.site-nav__cta')).toHaveText('Sign In');
  });

  test('opens and shows login form with expected fields', async ({ page }) => {
    await page.locator('.site-nav__cta').click();

    await expect(page.locator('.auth-modal__overlay')).toBeVisible();

    const form = page.locator('#authLoginForm');
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="email"]')).toBeVisible();
    await expect(form.locator('input[name="password"]')).toBeVisible();
    await expect(
      form.getByRole('button', { name: 'Sign In', exact: true }),
    ).toBeVisible();
  });

  test('can switch to register form', async ({ page }) => {
    await page.locator('.site-nav__cta').click();
    await expect(page.locator('.auth-modal__overlay')).toBeVisible();

    await page.locator('[data-tab="register"]').click();

    const form = page.locator('#authRegisterForm');
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="email"]')).toBeVisible();
    await expect(form.locator('input[name="password"]')).toBeVisible();
    await expect(
      form.getByRole('button', { name: /create account/i }),
    ).toBeVisible();
  });

  test('closes on Escape key', async ({ page }) => {
    await page.locator('.site-nav__cta').click();
    const overlay = page.locator('.auth-modal__overlay');
    // Overlay uses opacity transition, so check the .active class, not CSS visibility
    await expect(overlay).toHaveClass(/active/);

    await page.keyboard.press('Escape');
    await expect(overlay).not.toHaveClass(/active/);
  });
});

// ---------------------------------------------------------------------------
// Auth flow pages
// ---------------------------------------------------------------------------

test.describe('Auth flow pages', () => {
  test('forgot password page loads with form', async ({ page }) => {
    const response = await page.goto('/account/forgot-password.html');
    expect(response.status()).toBe(200);
    const form = page.locator('#forgotForm');
    await expect(form).toBeAttached();
    await expect(form.locator('input[type="email"]')).toBeAttached();
    await expect(form.locator('button[type="submit"]')).toBeAttached();
  });

  test('reset password page loads with state containers', async ({ page }) => {
    const response = await page.goto('/account/reset-password.html');
    expect(response.status()).toBe(200);
    // Without a valid token, both state containers should exist in the DOM
    await expect(page.locator('#loadingState')).toBeAttached();
    await expect(page.locator('#invalidState')).toBeAttached();
  });

  test('verify email page loads with state containers', async ({ page }) => {
    const response = await page.goto('/account/verify-email.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#loadingState')).toBeAttached();
    await expect(page.locator('#invalidState')).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// Account pages — unauthenticated behavior
// ---------------------------------------------------------------------------

test.describe('Account pages (unauthenticated)', () => {
  test('profile page shows denied state without auth', async ({ page }) => {
    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    // JS calls /api/profile → 404 on local server → shows denied state
    await expect(page.locator('#deniedState')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('#profileContent')).not.toBeVisible();
  });

  test('image studio page shows denied state without auth', async ({ page }) => {
    const response = await page.goto('/account/image-studio.html');
    expect(response.status()).toBe(200);
    // JS calls /api/me → 404 on local server → shows denied state
    await expect(page.locator('#deniedState')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('#studioContent')).not.toBeVisible();
  });

  test('admin page shows access-denied state without auth', async ({ page }) => {
    const response = await page.goto('/admin/index.html');
    expect(response.status()).toBe(200);
    // JS calls /api/admin/me → 404 on local server → shows denied panel
    await expect(page.locator('#adminDenied')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('#adminPanel')).not.toBeVisible();
  });
});

test.describe('Global header auth identity', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
  });

  test('desktop homepage shows avatar and display name in place of mood/profile link when an avatar exists', async ({
    page,
  }) => {
    await mockAuthenticatedHeader(page, {
      email: 'header@example.com',
      displayName: 'Header Name',
      hasAvatar: true,
    });

    const response = await page.goto('/');
    expect(response.status()).toBe(200);

    await expect(page.locator('.auth-nav__avatar-link')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.auth-nav__identity-label')).toHaveText('Header Name');
    await expect(page.locator('.site-nav__mood')).toBeHidden();
    await expect(page.locator('.site-nav__links .auth-nav__profile-link')).toHaveCount(0);
  });

  test('desktop shared header keeps the legacy mood/email/profile layout when no avatar exists', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, {
      role: 'user',
      email: 'fallback@example.com',
      displayName: 'Display Only',
      hasAvatar: false,
    });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('.site-nav__mood')).toBeVisible();
    await expect(page.locator('.site-nav__links .auth-nav__profile-link')).toBeVisible();
    await expect(page.locator('.auth-nav__avatar-link')).toHaveCount(0);
    await expect(page.locator('.auth-nav__email')).toHaveText('fallback@example.com');
  });
});

test.describe('Image Studio (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
  });

  test('account Image Studio keeps the public model selector restricted to FLUX.1 Schnell', async ({
    page,
  }) => {
    const requests = [];
    await mockAuthenticatedImageStudio(page, requests);

    const response = await page.goto('/account/image-studio.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#studioModel')).toHaveValue('@cf/black-forest-labs/flux-1-schnell');
    await expect(page.locator('#studioModel option')).toHaveCount(1);
    await expect(page.locator('#studioModel')).toContainText('FLUX.1 Schnell');
    await expect(page.locator('#studioModel')).not.toContainText('FLUX.2 Klein 9B');
    await expect(page.locator('#studioModel')).not.toContainText('FLUX.2 Dev');

    await page.locator('#studioPrompt').fill('legacy model request');
    await page.locator('#studioGenerate').click();
    await expect(page.locator('#studioPreview img')).toBeVisible();

    expect(requests).toEqual([
      expect.objectContaining({
        prompt: 'legacy model request',
        model: '@cf/black-forest-labs/flux-1-schnell',
      }),
    ]);
  });

  test('homepage create studio keeps the public model selector restricted to FLUX.1 Schnell', async ({
    page,
  }) => {
    const requests = [];
    await mockAuthenticatedImageStudio(page, requests);

    const response = await page.goto('/');
    expect(response.status()).toBe(200);
    await expect(page.locator('.gallery-mode__btn[data-mode="create"]')).toBeVisible({ timeout: 10_000 });

    await page.locator('.gallery-mode__btn[data-mode="create"]').click();
    await expect(page.locator('#galleryStudio')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#galStudioModel')).toHaveValue('@cf/black-forest-labs/flux-1-schnell');
    await expect(page.locator('#galStudioModel option')).toHaveCount(1);
    await expect(page.locator('#galStudioModel')).toContainText('FLUX.1 Schnell');
    await expect(page.locator('#galStudioModel')).not.toContainText('FLUX.2 Klein 9B');
    await expect(page.locator('#galStudioModel')).not.toContainText('FLUX.2 Dev');

    await page.locator('#galStudioPrompt').fill('homepage legacy model request');
    await page.locator('#galStudioGenerate').click();
    await expect(page.locator('#galStudioPreview img')).toBeVisible();

    expect(requests.at(-1)).toEqual(expect.objectContaining({
      prompt: 'homepage legacy model request',
      model: '@cf/black-forest-labs/flux-1-schnell',
    }));
  });

  test('account Image Studio shows mixed saved assets inside the shared folder world', async ({
    page,
  }) => {
    await mockAuthenticatedImageStudio(page, [], {
      folderPayload: {
        folders: [
          { id: 'folder-launches', name: 'Launches', slug: 'launches', created_at: '2026-04-10T09:00:00.000Z' },
        ],
        counts: {
          'folder-launches': 2,
        },
        unfolderedCount: 1,
      },
      assetsPayload: {
        all: [
          {
            id: 'img-1',
            asset_type: 'image',
            folder_id: 'folder-launches',
            title: 'Launch poster',
            preview_text: 'Launch poster',
            model: '@cf/black-forest-labs/flux-1-schnell',
            steps: 4,
            seed: 123,
            created_at: '2026-04-10T12:00:00.000Z',
            file_url: '/api/ai/images/img-1/file',
          },
          {
            id: 'txt-1',
            asset_type: 'text',
            folder_id: 'folder-launches',
            title: 'AI Lab Compare Notes',
            file_name: 'ai-lab-compare-notes.txt',
            source_module: 'compare',
            mime_type: 'text/plain; charset=utf-8',
            size_bytes: 420,
            preview_text: 'Model A leaned cinematic while Model B stayed more technical.',
            created_at: '2026-04-10T12:05:00.000Z',
            file_url: '/api/ai/text-assets/txt-1/file',
          },
          {
            id: 'snd-1',
            asset_type: 'sound',
            folder_id: 'folder-launches',
            title: 'Launch Atmosphere',
            file_name: 'launch-atmosphere.mp3',
            source_module: 'text',
            mime_type: 'audio/mpeg',
            size_bytes: 102400,
            preview_text: 'A short ambient loop saved into the shared folder browser.',
            created_at: '2026-04-10T12:06:00.000Z',
            file_url: '/api/ai/text-assets/snd-1/file',
          },
          {
            id: 'vid-1',
            asset_type: 'video',
            folder_id: 'folder-launches',
            title: 'Launch Walkthrough',
            file_name: 'launch-walkthrough.mp4',
            source_module: 'video',
            mime_type: 'video/mp4',
            size_bytes: 4096000,
            preview_text: 'A cinematic walkthrough of the launch scene stored in owned R2.',
            created_at: '2026-04-10T12:07:00.000Z',
            file_url: '/api/ai/text-assets/vid-1/file',
          },
        ],
        unfoldered: [],
        folders: {
          'folder-launches': [
            {
              id: 'img-1',
              asset_type: 'image',
              folder_id: 'folder-launches',
              title: 'Launch poster',
              preview_text: 'Launch poster',
              model: '@cf/black-forest-labs/flux-1-schnell',
              steps: 4,
              seed: 123,
              created_at: '2026-04-10T12:00:00.000Z',
              file_url: '/api/ai/images/img-1/file',
            },
            {
              id: 'txt-1',
              asset_type: 'text',
              folder_id: 'folder-launches',
              title: 'AI Lab Compare Notes',
              file_name: 'ai-lab-compare-notes.txt',
              source_module: 'compare',
              mime_type: 'text/plain; charset=utf-8',
              size_bytes: 420,
              preview_text: 'Model A leaned cinematic while Model B stayed more technical.',
              created_at: '2026-04-10T12:05:00.000Z',
              file_url: '/api/ai/text-assets/txt-1/file',
            },
            {
              id: 'snd-1',
              asset_type: 'sound',
              folder_id: 'folder-launches',
              title: 'Launch Atmosphere',
              file_name: 'launch-atmosphere.mp3',
              source_module: 'text',
              mime_type: 'audio/mpeg',
              size_bytes: 102400,
              preview_text: 'A short ambient loop saved into the shared folder browser.',
              created_at: '2026-04-10T12:06:00.000Z',
              file_url: '/api/ai/text-assets/snd-1/file',
            },
            {
              id: 'vid-1',
              asset_type: 'video',
              folder_id: 'folder-launches',
              title: 'Launch Walkthrough',
              file_name: 'launch-walkthrough.mp4',
              source_module: 'video',
              mime_type: 'video/mp4',
              size_bytes: 4096000,
              preview_text: 'A cinematic walkthrough of the launch scene stored in owned R2.',
              created_at: '2026-04-10T12:07:00.000Z',
              file_url: '/api/ai/text-assets/vid-1/file',
            },
          ],
        },
      },
    });

    await page.goto('/account/image-studio.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Saved Assets' })).toBeVisible();

    await page.locator('#studioFolderGrid .studio__folder-card').first().click();
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(4);
    await expect(page.locator('.studio__image-item--text')).toContainText('COMPARE');
    await expect(page.locator('.studio__image-item--text')).toContainText('AI Lab Compare Notes');
    await expect(page.locator('.studio__image-item--text')).toContainText('Model A leaned cinematic');
    await expect(page.locator('.studio__image-item--sound')).toContainText('Launch Atmosphere');
    await expect(page.locator('.studio__asset-audio')).toHaveCount(1);
    await expect(page.locator('.studio__image-item--video')).toContainText('Launch Walkthrough');
    await expect(page.locator('.studio__asset-video')).toHaveCount(1);
    await expect(page.locator('.studio__asset-video')).toHaveAttribute('src', /\/api\/ai\/text-assets\/vid-1\/file$/);
    await expect(page.locator('.studio__asset-open').first()).toHaveAttribute('href', /\/api\/ai\/text-assets\//);
  });

  test('account Image Studio lets the owner publish and unpublish a saved image into Mempics', async ({
    page,
  }) => {
    await mockAuthenticatedImageStudio(page, [], {
      folderPayload: {
        folders: [],
        counts: {},
        unfolderedCount: 1,
      },
      assetsPayload: {
        all: [
          {
            id: 'img-publish-1',
            asset_type: 'image',
            folder_id: null,
            title: 'Member sunset',
            preview_text: 'Member sunset',
            model: '@cf/black-forest-labs/flux-1-schnell',
            steps: 4,
            seed: 123,
            created_at: '2026-04-10T12:00:00.000Z',
            visibility: 'private',
            is_public: false,
            published_at: null,
            file_url: '/api/ai/images/img-publish-1/file',
            original_url: '/api/ai/images/img-publish-1/file',
            thumb_url: '/api/ai/images/img-publish-1/thumb',
            medium_url: '/api/ai/images/img-publish-1/medium',
            thumb_width: 320,
            thumb_height: 320,
            medium_width: 1280,
            medium_height: 1280,
            derivatives_status: 'ready',
          },
        ],
      },
    });

    await page.goto('/account/image-studio.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#studioFolderGrid .studio__folder-card').first().click();
    const card = page.locator('#studioImageGrid [data-asset-id="img-publish-1"]');
    await expect(card.locator('.studio__image-visibility')).toHaveText('Private');

    await card.hover();
    await card.getByRole('button', { name: 'Publish' }).click();
    await expect(card.locator('.studio__image-visibility')).toHaveText('Public');
    await expect(card.locator('.studio__image-publish')).toHaveText('Unpublish');
    await expect(page.locator('#studioGalleryMsg')).toContainText('Image published to Mempics.');

    await card.hover();
    await card.getByRole('button', { name: 'Unpublish' }).click();
    await expect(card.locator('.studio__image-visibility')).toHaveText('Private');
    await expect(card.locator('.studio__image-publish')).toHaveText('Publish');
    await expect(page.locator('#studioGalleryMsg')).toContainText('Image removed from Mempics.');
  });

  test('account Image Studio moves and deletes mixed saved assets with one shared selection flow', async ({
    page,
  }) => {
    await mockAuthenticatedImageStudio(page, [], {
      folderPayload: {
        folders: [
          { id: 'folder-launches', name: 'Launches', slug: 'launches', created_at: '2026-04-10T09:00:00.000Z' },
          { id: 'folder-research', name: 'Research', slug: 'research', created_at: '2026-04-09T09:00:00.000Z' },
        ],
      },
      assetsPayload: {
        all: [
          {
            id: 'img-move-1',
            asset_type: 'image',
            folder_id: null,
            title: 'Shared Poster',
            preview_text: 'Shared Poster',
            model: '@cf/black-forest-labs/flux-1-schnell',
            steps: 4,
            seed: 9,
            created_at: '2026-04-10T12:00:00.000Z',
            file_url: '/api/ai/images/img-move-1/file',
            original_url: '/api/ai/images/img-move-1/file',
          },
          {
            id: 'txt-move-1',
            asset_type: 'text',
            folder_id: null,
            title: 'Prompt Notes',
            file_name: 'prompt-notes.txt',
            source_module: 'text',
            mime_type: 'text/plain; charset=utf-8',
            size_bytes: 320,
            preview_text: 'Text notes that should move with the image and sound cards.',
            created_at: '2026-04-10T11:59:00.000Z',
            file_url: '/api/ai/text-assets/txt-move-1/file',
          },
          {
            id: 'snd-move-1',
            asset_type: 'sound',
            folder_id: null,
            title: 'Concept Loop',
            file_name: 'concept-loop.mp3',
            source_module: 'text',
            mime_type: 'audio/mpeg',
            size_bytes: 204800,
            preview_text: 'Audio loop that should move and delete inside the same selection flow.',
            created_at: '2026-04-10T11:58:00.000Z',
            file_url: '/api/ai/text-assets/snd-move-1/file',
          },
        ],
      },
    });

    await page.goto('/account/image-studio.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#studioFolderGrid .studio__folder-card').first().click();
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(3);

    await page.locator('#studioSelectBtn').click();
    await page.locator('#studioImageGrid .studio__image-item').nth(0).click();
    await page.locator('#studioImageGrid .studio__image-item').nth(1).click();
    await page.locator('#studioImageGrid .studio__image-item').nth(2).click();
    await expect(page.locator('#studioBulkCount')).toHaveText('3 selected');

    await page.locator('#studioBulkMove').click();
    await page.selectOption('#studioBulkMoveSelect', 'folder-research');
    await page.locator('#studioBulkMoveConfirm').click();
    await expect(page.locator('#studioGalleryMsg')).toContainText('3 assets moved.');

    await page.locator('#studioFolderBackBtn').click();
    await page.locator('#studioFolderGrid .studio__folder-card').nth(3).click();
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(3);

    await page.locator('#studioSelectBtn').click();
    await page.locator('.studio__image-item--text').click();
    await page.locator('.studio__image-item--sound').click();
    await expect(page.locator('#studioBulkCount')).toHaveText('2 selected');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#studioBulkDelete').click();
    await expect(page.locator('#studioGalleryMsg')).toContainText('2 assets deleted.');
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(1);
    await expect(page.locator('#studioImageGrid')).toContainText('Shared Poster');
  });

  test('account Image Studio grid requests thumbs only and uses medium/original for detail fallback', async ({
    page,
  }) => {
    const imageRequests = [];
    await mockAuthenticatedImageStudio(page, [], {
      imageRequests,
      folderPayload: {
        folders: [],
        counts: {},
        unfolderedCount: 2,
      },
      assetsPayload: {
        all: [
          {
            id: 'img-ready',
            asset_type: 'image',
            folder_id: null,
            title: 'Ready Preview',
            preview_text: 'Ready Preview',
            model: '@cf/black-forest-labs/flux-1-schnell',
            steps: 4,
            seed: 123,
            created_at: '2026-04-10T12:00:00.000Z',
            file_url: '/api/ai/images/img-ready/file',
            original_url: '/api/ai/images/img-ready/file',
            thumb_url: '/api/ai/images/img-ready/thumb',
            medium_url: '/api/ai/images/img-ready/medium',
            derivatives_status: 'ready',
          },
          {
            id: 'img-pending',
            asset_type: 'image',
            folder_id: null,
            title: 'Pending Preview',
            preview_text: 'Pending Preview',
            model: '@cf/black-forest-labs/flux-1-schnell',
            steps: 4,
            seed: 456,
            created_at: '2026-04-10T11:59:00.000Z',
            file_url: '/api/ai/images/img-pending/file',
            original_url: '/api/ai/images/img-pending/file',
            thumb_url: null,
            medium_url: null,
            derivatives_status: 'pending',
          },
        ],
        unfoldered: [
          {
            id: 'img-ready',
            asset_type: 'image',
            folder_id: null,
            title: 'Ready Preview',
            preview_text: 'Ready Preview',
            model: '@cf/black-forest-labs/flux-1-schnell',
            steps: 4,
            seed: 123,
            created_at: '2026-04-10T12:00:00.000Z',
            file_url: '/api/ai/images/img-ready/file',
            original_url: '/api/ai/images/img-ready/file',
            thumb_url: '/api/ai/images/img-ready/thumb',
            medium_url: '/api/ai/images/img-ready/medium',
            derivatives_status: 'ready',
          },
          {
            id: 'img-pending',
            asset_type: 'image',
            folder_id: null,
            title: 'Pending Preview',
            preview_text: 'Pending Preview',
            model: '@cf/black-forest-labs/flux-1-schnell',
            steps: 4,
            seed: 456,
            created_at: '2026-04-10T11:59:00.000Z',
            file_url: '/api/ai/images/img-pending/file',
            original_url: '/api/ai/images/img-pending/file',
            thumb_url: null,
            medium_url: null,
            derivatives_status: 'pending',
          },
        ],
        folders: {},
      },
    });

    await page.goto('/account/image-studio.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#studioFolderGrid .studio__folder-card').nth(1).click();
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(2);
    await expect(page.locator('#studioImageGrid .studio__image-item img')).toHaveCount(1);
    await expect(page.locator('.studio__image-preview-badge')).toContainText('Preview pending');
    await expect(page.locator('#studioImageGrid .studio__image-item img').first()).toHaveAttribute('src', /\/api\/ai\/images\/img-ready\/thumb$/);

    await page.locator('#studioImageGrid .studio__image-item').first().click();
    await expect(page.locator('#studioImageModal')).toHaveClass(/active/);
    await expect(page.locator('#studioImageModal .studio-modal__image img')).toHaveAttribute('src', /\/api\/ai\/images\/img-ready\/medium$/);
    await expect(page.locator('#studioImageModal .studio-modal__open')).toHaveAttribute('href', '/api/ai/images/img-ready/file');
    await page.locator('#studioImageModal .modal-close').click();

    expect(imageRequests).toContain('/api/ai/images/img-ready/thumb');
    expect(imageRequests).toContain('/api/ai/images/img-ready/medium');
    expect(imageRequests).not.toContain('/api/ai/images/img-ready/file');
    expect(imageRequests).not.toContain('/api/ai/images/img-pending/file');
  });
});

test.describe('Profile page (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
  });

  test('change photo opens the chooser before any local file picker', async ({ page }) => {
    await mockAuthenticatedProfile(page, { role: 'user' });

    let fileChooserOpened = false;
    page.on('filechooser', () => {
      fileChooserOpened = true;
    });

    const response = await page.goto('/account/profile.html');
    expect(response?.ok()).toBeTruthy();

    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });
    await page.locator('#avatarChangeBtn').click();

    await expect(page.locator('#avatarSourceModal')).toHaveClass(/active/);
    await expect(page.locator('#avatarChooseSavedAssets')).toBeVisible();
    await expect(page.locator('#avatarChooseUploadDevice')).toBeVisible();

    await page.waitForTimeout(150);
    expect(fileChooserOpened).toBe(false);
  });

  test('upload from device keeps the existing avatar upload flow', async ({ page }) => {
    const avatarRequests = [];
    await mockAuthenticatedProfile(page, {
      role: 'user',
      avatarRequests,
    });

    const response = await page.goto('/account/profile.html');
    expect(response?.ok()).toBeTruthy();

    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });
    await page.locator('#avatarChangeBtn').click();

    const chooser = page.waitForEvent('filechooser');
    await page.locator('#avatarChooseUploadDevice').click();
    const fileChooser = await chooser;

    await fileChooser.setFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
    });

    await expect(page.locator('#avatarMsg')).toContainText('Photo updated.');
    await expect(page.locator('#avatarImg')).toBeVisible();
    await expect(page.locator('.auth-nav__avatar-link')).toBeVisible();
    await expect(page.locator('.site-nav__mood')).toBeHidden();
    await expect(page.locator('.site-nav__links .auth-nav__profile-link')).toHaveCount(0);
    expect(avatarRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'upload',
          contentType: expect.stringContaining('multipart/form-data'),
        }),
      ])
    );
  });

  test('saved assets picker stays image-only and uses thumb derivatives for avatar selection', async ({
    page,
  }) => {
    const imageRequests = [];
    const avatarRequests = [];
    await mockAuthenticatedProfile(page, {
      role: 'user',
      imageRequests,
      avatarRequests,
      folderPayload: {
        folders: [
          {
            id: 'folder-portraits',
            name: 'Portraits',
            slug: 'portraits',
            created_at: '2026-04-10T09:00:00.000Z',
          },
        ],
        counts: { 'folder-portraits': 1 },
        unfolderedCount: 1,
      },
      assetsPayload: {
        all: [
          {
            id: 'img-ready',
            asset_type: 'image',
            folder_id: 'folder-portraits',
            title: 'Ready Portrait',
            preview_text: 'Ready Portrait',
            model: '@cf/black-forest-labs/flux-1-schnell',
            steps: 4,
            seed: 111,
            created_at: '2026-04-10T12:00:00.000Z',
            file_url: '/api/ai/images/img-ready/file',
            original_url: '/api/ai/images/img-ready/file',
            thumb_url: '/api/ai/images/img-ready/thumb',
            medium_url: '/api/ai/images/img-ready/medium',
            derivatives_status: 'ready',
          },
          {
            id: 'img-pending',
            asset_type: 'image',
            folder_id: null,
            title: 'Pending Portrait',
            preview_text: 'Pending Portrait',
            model: '@cf/black-forest-labs/flux-1-schnell',
            steps: 4,
            seed: 222,
            created_at: '2026-04-10T11:30:00.000Z',
            file_url: '/api/ai/images/img-pending/file',
            original_url: '/api/ai/images/img-pending/file',
            thumb_url: null,
            medium_url: null,
            derivatives_status: 'pending',
          },
          {
            id: 'txt-hidden',
            asset_type: 'text',
            folder_id: 'folder-portraits',
            title: 'Hidden Text Asset',
            file_name: 'hidden.txt',
            source_module: 'text',
            mime_type: 'text/plain; charset=utf-8',
            size_bytes: 128,
            preview_text: 'This should not appear.',
            created_at: '2026-04-10T11:00:00.000Z',
            file_url: '/api/ai/text-assets/txt-hidden/file',
          },
          {
            id: 'snd-hidden',
            asset_type: 'sound',
            folder_id: null,
            title: 'Hidden Audio Asset',
            file_name: 'hidden.mp3',
            source_module: 'text',
            mime_type: 'audio/mpeg',
            size_bytes: 256,
            preview_text: 'This should not appear either.',
            created_at: '2026-04-10T10:30:00.000Z',
            file_url: '/api/ai/text-assets/snd-hidden/file',
          },
        ],
      },
    });

    const response = await page.goto('/account/profile.html');
    expect(response?.ok()).toBeTruthy();

    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });
    await page.locator('#avatarChangeBtn').click();
    await page.locator('#avatarChooseSavedAssets').click();

    await expect(page.locator('#avatarAssetsModal')).toHaveClass(/active/);
    await expect(page.locator('#avatarAssetsGrid .profile-avatar-picker__asset')).toHaveCount(2);
    await expect(page.locator('#avatarAssetsGrid')).toContainText('Ready Portrait');
    await expect(page.locator('#avatarAssetsGrid')).toContainText('Pending Portrait');
    await expect(page.locator('#avatarAssetsGrid')).not.toContainText('Hidden Text Asset');
    await expect(page.locator('#avatarAssetsGrid')).not.toContainText('Hidden Audio Asset');
    await expect(page.locator('#avatarAssetsGrid img')).toHaveCount(1);

    await page.locator('#avatarAssetsGrid .profile-avatar-picker__asset[data-asset-id="img-ready"]').click();

    await expect(page.locator('#avatarAssetsModal')).toBeHidden();
    await expect(page.locator('#avatarMsg')).toContainText('Photo updated.');
    await expect(page.locator('#avatarImg')).toBeVisible();

    expect(avatarRequests).toContainEqual({
      type: 'saved_asset',
      body: { source_image_id: 'img-ready' },
    });
    expect(imageRequests).toContain('/api/ai/images/img-ready/thumb');
    expect(imageRequests).not.toContain('/api/ai/images/img-ready/file');
  });

  test('favorites render malicious metadata inertly and keep valid viewer/remove behavior', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, {
      role: 'user',
      favoritesPayload: [
        {
          item_type: 'gallery',
          item_id: 'bad-gallery',
          title: 'Bad <b class="xss-favorite">Title</b>',
          thumb_url: 'javascript:alert(1)',
          created_at: '2026-04-10T12:00:00.000Z',
        },
        {
          item_type: 'gallery',
          item_id: 'good-gallery',
          title: 'Safe Preview',
          thumb_url: '/assets/images/1.jpg',
          created_at: '2026-04-10T11:59:00.000Z',
        },
      ],
    });

    const response = await page.goto('/account/profile.html');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('[data-favorites-type="gallery"] [data-fav-key="gallery:bad-gallery"] img')).toHaveCount(0);
    await expect(page.locator('[data-favorites-type="gallery"] [data-fav-key="gallery:good-gallery"] img')).toHaveAttribute('src', /\/assets\/images\/1\.jpg$/);

    await page.locator('[data-fav-key="gallery:bad-gallery"]').click();
    await expect(page.locator('#favViewer')).toHaveClass(/active/);
    await expect(page.locator('#favViewer .xss-favorite')).toHaveCount(0);
    await expect(page.locator('#favViewer .fav-viewer__title')).toHaveText('Bad <b class="xss-favorite">Title</b>');
    await expect(page.locator('#favViewer .fav-viewer__image img')).toHaveCount(0);
    await page.locator('#favViewerClose').click();

    await page.locator('[data-fav-key="gallery:good-gallery"]').click();
    await expect(page.locator('#favViewer .fav-viewer__title')).toHaveText('Safe Preview');
    await expect(page.locator('#favViewer .fav-viewer__image img')).toHaveAttribute('src', /\/assets\/images\/1\.jpg$/);

    await page.locator('#favViewer .fav-viewer__fav-star').click();
    await expect(page.locator('[data-fav-key="gallery:good-gallery"]')).toHaveCount(0);
    await expect(page.locator('[data-fav-key="gallery:bad-gallery"]')).toHaveCount(1);
  });

  test('soundlab favorites keep the tightened thumb_url guard and render viewer metadata inertly', async ({
    page,
  }) => {
    await page.route('**/api/soundlab-thumbs/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
      });
    });

    await mockAuthenticatedProfile(page, {
      role: 'user',
      favoritesPayload: [
        {
          item_type: 'soundlab',
          item_id: 'cosmic-sea',
          title: 'Bad <b class="xss-soundlab">Track</b>',
          thumb_url: 'https://user:pass@pub.bitbi.ai/sound-lab/thumbs/thumb-cosmic.webp',
          created_at: '2026-04-10T12:00:00.000Z',
        },
        {
          item_type: 'soundlab',
          item_id: 'grok',
          title: "Grok's Groove Remix",
          thumb_url: '/api/soundlab-thumbs/thumb-bitbi',
          created_at: '2026-04-10T11:59:00.000Z',
        },
      ],
    });

    const response = await page.goto('/account/profile.html');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('[data-favorites-type="soundlab"] [data-fav-key="soundlab:cosmic-sea"] img')).toHaveCount(0);
    await expect(page.locator('[data-favorites-type="soundlab"] [data-fav-key="soundlab:grok"] img')).toHaveAttribute('src', /\/api\/soundlab-thumbs\/thumb-bitbi$/);

    await page.locator('[data-fav-key="soundlab:cosmic-sea"]').click();
    await expect(page.locator('#favViewer')).toHaveClass(/active/);
    await expect(page.locator('#favViewer .xss-soundlab')).toHaveCount(0);
    await expect(page.locator('#favViewer #fvPlay')).toBeVisible();
    await expect(page.locator('#favViewer .fav-viewer__track-title')).toHaveText('Bad <b class="xss-soundlab">Track</b>');
    await expect(page.locator('#favViewer .fav-viewer__player-hero img')).toHaveCount(0);
    await page.locator('#favViewerClose').click();

    await page.locator('[data-fav-key="soundlab:grok"]').click();
    await expect(page.locator('#favViewer #fvPlay')).toBeVisible();
    await expect(page.locator('#favViewer .fav-viewer__track-title')).toHaveText("Grok's Groove Remix");
    await expect(page.locator('#favViewer .fav-viewer__player-hero img')).toHaveAttribute('src', /\/api\/soundlab-thumbs\/thumb-bitbi$/);
  });

  test('profile save updates the header label from email to display name when an avatar is present', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, {
      role: 'user',
      email: 'header-update@example.com',
      displayName: '',
      hasAvatar: true,
    });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('.auth-nav__identity-label')).toHaveText('header-update@example.com');

    await page.locator('#displayName').fill('Updated Header Name');
    await page.locator('#profileForm').getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.locator('#formMsg')).toContainText('Profile updated.');
    await expect(page.locator('.auth-nav__identity-label')).toHaveText('Updated Header Name');
  });

  test('non-admin profile shows only the AI Studio card in the profile action stack', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, { role: 'user' });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#profileStudioCard')).toBeVisible();
    await expect(page.locator('#profileStudioStack')).toHaveAttribute('data-has-admin-lab', 'false');
    await expect(page.locator('#profileAdminAiLabCard')).toBeHidden();
    await expect(page.locator('#profileMobileAiLabLink')).toBeHidden();
    await expect(page.locator('#profileStudioCard')).toContainText('AI Studio');

    await page.goto('/account/profile.html#ai-lab');
    await expect(page.locator('#profileHomeView')).toBeVisible();
    await expect(page.locator('#profileAiLabView')).toBeHidden();
    await expect(page.locator('#profileHeroTitle')).toHaveText('My Profile');
    await expect(page.locator('#profileHeroDesc')).toHaveText('View and manage your account');
    await expect(page).toHaveURL(/\/account\/profile(?:\.html)?$/);
  });

  test('admin profile keeps AI Lab inside the Profile shell without exposing admin hero or nav chrome', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, { role: 'admin' });
    await mockAdminAiLab(page);

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#profileStudioStack')).toHaveAttribute('data-has-admin-lab', 'true');
    await expect(page.locator('#profileStudioCard')).toBeVisible();
    await expect(page.locator('#profileAdminAiLabCard')).toBeVisible();
    await expect(page.locator('#profileMobileAiLabLink')).toBeHidden();
    await expect(page.locator('#profileAdminAiLabCard')).toContainText('AI Lab');

    const studioBox = await page.locator('#profileStudioCard').boundingBox();
    const labBox = await page.locator('#profileAdminAiLabCard').boundingBox();
    expect(studioBox).not.toBeNull();
    expect(labBox).not.toBeNull();
    expect(Math.abs(studioBox.x - labBox.x)).toBeLessThanOrEqual(2);
    expect(labBox.y).toBeGreaterThan(studioBox.y + studioBox.height - 1);

    await page.locator('#profileAdminAiLabCard').click();
    await expect(page).toHaveURL(/\/account\/profile(?:\.html)?#ai-lab$/);
    await expect(page.locator('#profileHeroLabel')).toHaveText('Profile / AI Lab');
    await expect(page.locator('#profileHeroTitle')).toHaveText('AI Lab');
    await expect(page.locator('#profileHeroDesc')).toHaveText(
      'Admin-only testing surface, kept inside your Profile workspace.',
    );
    await expect(page.locator('#profileHomeView')).toBeHidden();
    await expect(page.locator('#profileAiLabView')).toBeVisible();
    await expect(page.locator('#sectionAiLab')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#adminHeroTitle')).toHaveCount(0);
    await expect(page.locator('#adminNav')).toHaveCount(0);
    await expect(page.locator('a.admin-nav__link[data-section="ai-lab"]')).toHaveCount(0);
    await expect(page.locator('.admin-quick-link[data-nav="ai-lab"]')).toHaveCount(0);
    await expect(page.locator('#summaryName')).toBeHidden();

    await page.locator('#aiLabRefreshModels').click();
    await expect(page.locator('#aiModelsText')).toContainText('GPT OSS 20B');
    await page.getByRole('button', { name: 'Text' }).click();
    await expect(page.locator('#aiTextPreset option')).toHaveCount(2);
    await page.locator('#aiTextPrompt').fill('profile ai lab smoke');
    await page.locator('#aiTextRun').click();
    await expect(page.locator('#aiTextOutput')).toContainText('Mocked text output from admin AI Lab.');

    await page.locator('#profileAiLabBack').click();
    await expect(page).toHaveURL(/\/account\/profile(?:\.html)?$/);
    await expect(page.locator('#profileHeroLabel')).toHaveText('Member');
    await expect(page.locator('#profileHeroTitle')).toHaveText('My Profile');
    await expect(page.locator('#profileHeroDesc')).toHaveText('View and manage your account');
    await expect(page.locator('#profileAiLabView')).toBeHidden();
    await expect(page.locator('#profileHomeView')).toBeVisible();
  });
});

test.describe('Profile page (authenticated mobile)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
  });

  test('mobile header shows avatar with email fallback and removes the mobile profile link when an avatar exists', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, {
      role: 'admin',
      email: 'mobile-header@example.com',
      displayName: '',
      hasAvatar: true,
    });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('.auth-nav__mobile-inline')).toBeVisible();
    await expect(page.locator('.auth-nav__mobile-inline-label')).toHaveText('mobile-header@example.com');

    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveClass(/open/);
    await expect(page.locator('.auth-nav__mobile-account')).toBeVisible();
    await expect(page.locator('.auth-nav__mobile-identity')).toBeVisible();
    await expect(page.locator('.auth-nav__mobile-identity-label')).toHaveText('mobile-header@example.com');
    await expect(page.locator('.auth-nav__mobile-admin')).toBeVisible();
    await expect(page.locator('.auth-nav__mobile-logout')).toBeVisible();
    await expect(page.locator('.auth-nav__mobile-profile')).toHaveCount(0);

    const mobileAccountOrder = await page.locator('.auth-nav__mobile-account').evaluate((node) =>
      Array.from(node.children).map((child) => child.className),
    );
    expect(mobileAccountOrder).toEqual([
      'auth-nav__mobile-identity',
      'auth-nav__mobile-admin',
      'auth-nav__mobile-logout',
    ]);
  });

  test('mobile header keeps the legacy menu/profile layout when no avatar exists', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, {
      role: 'user',
      email: 'mobile-fallback@example.com',
      displayName: 'Mobile Fallback',
      hasAvatar: false,
    });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('.auth-nav__mobile-inline')).toHaveCount(0);

    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveClass(/open/);
    await expect(page.locator('.auth-nav__mobile-email')).toHaveText('mobile-fallback@example.com');
    await expect(page.locator('.auth-nav__mobile-profile')).toBeVisible();
  });

  test('admin mobile profile shows AI Lab beside Studio and hides the lower AI cards', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, { role: 'admin' });
    await mockAdminAiLab(page);

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#profileTabBar')).toBeVisible();
    await expect(page.locator('#profileWalletWorkspaceBtn')).toBeVisible();
    await expect(page.locator('#profileStudioStack')).toBeHidden();
    await expect(page.locator('#profileStudioCard')).toBeHidden();
    await expect(page.locator('#profileAdminAiLabCard')).toBeHidden();
    await expect(page.locator('#profileMobileAiLabLink')).toBeVisible();
    await expect(page.locator('#profileTabBar .profile-tab-link:visible')).toHaveText(['Wallet', 'Studio', 'AI Lab']);

    const tabBarOverflow = await page.locator('#profileTabBar').evaluate(
      (node) => node.scrollWidth > node.clientWidth + 1,
    );
    expect(tabBarOverflow).toBe(false);

    await page.locator('#profileMobileAiLabLink').click();
    await expect(page).toHaveURL(/\/account\/profile(?:\.html)?#ai-lab$/);
    await expect(page.locator('#profileHeroTitle')).toHaveText('AI Lab');
    await expect(page.locator('#profileHomeView')).toBeHidden();
    await expect(page.locator('#profileAiLabView')).toBeVisible();
    await expect(page.locator('#sectionAiLab')).toBeVisible({ timeout: 10_000 });

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasOverflow).toBe(false);

    await page.locator('#profileAiLabBack').click();
    await expect(page).toHaveURL(/\/account\/profile(?:\.html)?$/);
    await expect(page.locator('#profileHomeView')).toBeVisible();
    await expect(page.locator('#profileAiLabView')).toBeHidden();
    await expect(page.locator('#profileMobileAiLabLink')).toBeVisible();
  });

  test('non-admin mobile profile keeps only Studio in the top row and rejects AI Lab state', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, { role: 'user' });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#profileTabBar')).toBeVisible();
    await expect(page.locator('#profileWalletWorkspaceBtn')).toBeVisible();
    await expect(page.locator('#profileStudioStack')).toBeHidden();
    await expect(page.locator('#profileMobileAiLabLink')).toBeHidden();
    await expect(page.locator('#profileTabBar .profile-tab-link:visible')).toHaveText(['Wallet', 'Studio']);

    await page.goto('/account/profile.html#ai-lab');
    await expect(page.locator('#profileHomeView')).toBeVisible();
    await expect(page.locator('#profileAiLabView')).toBeHidden();
    await expect(page.locator('#profileHeroTitle')).toHaveText('My Profile');
    await expect(page).toHaveURL(/\/account\/profile(?:\.html)?$/);
  });
});

// ---------------------------------------------------------------------------
// Admin AI Lab
// ---------------------------------------------------------------------------

test.describe('Admin AI Lab', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
    await installClipboardSpy(page);
    await mockAdminAiLab(page);
  });

  test('admin sub-navigation stays visible below the main header while scrolling', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#adminNav')).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 1200));
    await wait(150);

    const headerBox = await page.locator('header .site-nav').boundingBox();
    const navBox = await page.locator('#adminNav').boundingBox();

    expect(headerBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    const headerBottom = headerBox.y + headerBox.height;
    expect(navBox.y).toBeGreaterThanOrEqual(headerBottom - 1);
    expect(Math.abs(navBox.y - headerBottom)).toBeLessThanOrEqual(2);
  });

  test('loads the admin AI Lab section and runs all task panels', async ({
    page,
  }) => {
    const response = await page.goto('/admin/index.html#ai-lab');
    expect(response.status()).toBe(200);

    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('link[href*="css/admin/admin.css?v="]')).toHaveCount(1);
    await expect(page.locator('link[href*="css/account/image-studio.css?v="]')).toHaveCount(1);
    await expect(page.locator('script[src*="js/pages/admin/main.js?v="]')).toHaveCount(1);
    await expect(page.locator('#adminHeroTitle')).toHaveText('AI Lab');
    await expect(page.locator('#sectionAiLab')).toBeVisible();
    await expect(page.locator('#aiModelsText')).toContainText('GPT OSS 20B');
    await expect(page.locator('#aiModelsText')).toContainText('Gemma 4 26B A4B');
    await expect(page.locator('#aiModelsImage')).toContainText('FLUX.1 Schnell');
    await expect(page.locator('#aiModelsImage')).toContainText('FLUX.2 Klein 9B');
    await expect(page.locator('#aiModelsImage')).toContainText('FLUX.2 Dev');
    await expect(page.locator('#aiModelsMusic')).toContainText('Music 2.6');

    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.selectOption('#aiTextSampleSelect', 'release-notes');
    await page.locator('#aiTextSample').click();
    await expect(page.locator('#aiTextPrompt')).toHaveValue(
      /Turn this feature idea into 5 concise release notes/,
    );
    await page.locator('#aiTextRun').click();
    await expect(page.locator('#aiTextOutput')).toContainText(
      'Mocked text output from admin AI Lab.',
    );
    await expect(page.locator('#aiTextMeta')).toContainText('Model Label');
    await expect(page.locator('#aiTextMeta')).toContainText('@cf/openai/gpt-oss-20b');
    await expect(page.locator('#aiTextMeta')).toContainText('Received');

    await page.getByRole('button', { name: 'Image' }).click();
    await page.selectOption('#aiImageSampleSelect', 'editorial-portrait');
    await page.locator('#aiImageSample').click();
    await expect(page.locator('#aiImagePrompt')).toHaveValue(
      /An editorial portrait of a digital artist/,
    );
    await expect(page.locator('#aiImageModel option')).toHaveCount(4);
    await page.selectOption('#aiImageModel', '@cf/black-forest-labs/flux-2-dev');
    await page.locator('#aiImageRun').click();
    await expect(page.locator('#aiImagePreview img')).toBeVisible();
    await expect(page.locator('#aiImageMeta')).toContainText('image/png');
    await expect(page.locator('#aiImageMeta')).toContainText('FLUX.2 Dev');
    await expect(page.locator('#aiImageMeta')).toContainText('@cf/black-forest-labs/flux-2-dev');
    await expect(page.locator('#aiImageDownload')).toBeVisible();
    await expect(page.locator('#aiLabSavedAssets')).toBeVisible();
    await expect(page.locator('#aiLabSavedAssets .studio__folder-card')).toHaveCount(4);
    await page.locator('#aiLabSavedAssets .studio__folder-card').first().click();
    await expect(page.locator('#aiLabAssetsGrid .studio__image-item')).toHaveCount(3);
    await expect(page.locator('#aiLabAssetsGrid')).toContainText('Embeddings Summary');
    await expect(page.locator('#aiLabAssetsGrid')).toContainText('Sound Concept Loop');
    await expect(page.locator('#aiLabAssetsGrid .studio__asset-audio')).toHaveCount(1);
    const imageDownload = page.waitForEvent('download');
    await page.locator('#aiImageDownload').click();
    await expect((await imageDownload).suggestedFilename()).toContain('ai-lab-image');

    await page.getByRole('button', { name: 'Embeddings' }).click();
    await page.selectOption('#aiEmbeddingsSampleSelect', 'taxonomy');
    await page.locator('#aiEmbeddingsSample').click();
    await expect(page.locator('#aiEmbeddingsInput')).toHaveValue(
      /cyberpunk neon skyline/,
    );
    await page.locator('#aiEmbeddingsRun').click();
    await expect(page.locator('#aiEmbeddingsSummary')).toContainText(
      '2 vectors returned.',
    );
    await expect(page.locator('#aiEmbeddingsPreview')).toContainText('0.1000');
    await expect(page.locator('#aiEmbeddingsMeta')).toContainText('Shape');

    await page.getByRole('button', { name: 'Compare' }).click();
    await expect(page.locator('#aiCompareModelA')).toContainText('Gemma 4 26B A4B');
    await page.selectOption('#aiCompareSampleSelect', 'hero-intro');
    await page.locator('#aiCompareSample').click();
    await expect(page.locator('#aiComparePrompt')).toHaveValue(
      /Write a 2-sentence homepage intro/,
    );
    await page.locator('#aiCompareRun').click();
    await expect(page.locator('#aiCompareAText')).toContainText(
      'It feels precise and cinematic.',
    );
    await expect(page.locator('#aiCompareBText')).toContainText(
      'It feels agile and technical.',
    );
    await expect(page.locator('#aiCompareAMeta')).toContainText('Meta');
    await expect(page.locator('#aiCompareBMeta')).toContainText('OpenAI');
    await expect(page.locator('#aiCompareDiff')).toBeVisible();
    await expect(page.locator('#aiCompareDiff')).toContainText('Outputs differ');
    await expect(page.locator('#aiCompareDiff')).toContainText(
      'BITBI blends AI imagery with a premium admin control surface.',
    );
    await expect(page.locator('#aiCompareDiff')).toContainText(
      'It feels precise and cinematic.',
    );
    await expect(page.locator('#aiCompareDiff')).toContainText(
      'It feels agile and technical.',
    );

    await page.getByRole('button', { name: 'Music AI' }).click();
    await expect(page.locator('#aiMusicTitle')).toHaveText('Music AI');
    await page.locator('#aiMusicPrompt').fill('Dark synthwave with a slow pulse and distant vocals.');
    await page.locator('#aiMusicLyrics').fill('[Verse]\nDrive through the static night\n\n[Chorus]\nKeep the signal in sight');
    await page.locator('#aiMusicBpm').fill('118');
    await page.selectOption('#aiMusicKey', 'A Minor');
    await page.locator('#aiMusicRun').click();
    await expect(page.locator('#aiMusicPreview audio')).toBeVisible();
    await expect(page.locator('#aiMusicMeta')).toContainText('Music 2.6');
    await expect(page.locator('#aiMusicMeta')).toContainText('A Minor');
    await expect(page.locator('#aiMusicLyricsOutput')).toContainText('Drive through the static night');
    await expect(page.locator('#aiMusicDownload')).toBeVisible();

    await page.locator('a.admin-nav__link[data-section="dashboard"]').click();
    await expect(page.locator('#adminHeroTitle')).toHaveText('Dashboard');
    await expect(page.locator('#statTotal')).toHaveText('12');
  });

  test('Music AI card validates, posts the expected payload, and renders success plus error states beside Live Agent', async ({
    page,
  }) => {
    const musicRequests = [];
    await page.unroute('**/api/admin/ai/test-music');
    await page.route('**/api/admin/ai/test-music', async (route) => {
      const body = route.request().postDataJSON();
      musicRequests.push(body);
      if (body.prompt === 'force music error') {
        await route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            code: 'upstream_error',
            error: 'Music generation failed',
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          task: 'music',
          model: createMockAiCatalog().models.music[0],
          preset: body.preset || 'music_studio',
          result: {
            prompt: body.prompt,
            mode: body.mode,
            lyricsMode: body.lyricsMode,
            bpm: body.bpm ?? null,
            key: body.key || null,
            mimeType: 'audio/mpeg',
            audioUrl: 'https://example.com/music-admin-test.mp3',
            audioBase64: null,
            durationMs: 22400,
            sampleRate: 44100,
            channels: 2,
            bitrate: 256000,
            sizeBytes: 702144,
            providerStatus: 2,
            lyricsPreview: body.lyricsMode === 'auto'
              ? '[Chorus]\nGenerated lyrics from the mock route.'
              : body.lyrics,
          },
          traceId: 'music-ui-trace',
          elapsedMs: 600,
        }),
      });
    });

    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Music AI' }).click();
    await expect(page.locator('#aiLabPanelMusic')).toBeVisible();
    await expect(page.locator('#aiMusicTitle')).toBeVisible();

    await page.locator('#aiMusicRun').click();
    await expect(page.locator('#aiMusicInlineError')).toContainText('Prompt is required');
    expect(musicRequests).toHaveLength(0);

    await page.locator('#aiMusicPrompt').fill('Warm electronic pop with a wide chorus.');
    await page.locator('#aiMusicLyrics').fill('[Verse]\nHold the light inside the circuit');
    await page.locator('#aiMusicBpm').fill('124');
    await page.selectOption('#aiMusicKey', 'C Major');
    await page.locator('#aiMusicRun').click();

    await expect(page.locator('#aiMusicPreview audio')).toBeVisible();
    await expect(page.locator('#aiMusicState')).toContainText('Music response ready.');
    await expect(page.locator('#aiMusicLyricsOutput')).toContainText('Hold the light inside the circuit');
    expect(musicRequests[0]).toEqual(expect.objectContaining({
      preset: 'music_studio',
      prompt: 'Warm electronic pop with a wide chorus.',
      mode: 'vocals',
      lyricsMode: 'custom',
      lyrics: '[Verse]\nHold the light inside the circuit',
      bpm: 124,
      key: 'C Major',
    }));

    await page.selectOption('#aiMusicLyricsMode', 'auto');
    await expect(page.locator('#aiMusicLyricsField')).toBeHidden();
    await page.locator('#aiMusicPrompt').fill('force music error');
    await page.locator('#aiMusicRun').click();
    await expect(page.locator('#aiLabStatus')).toContainText('Music generation failed');
    await expect(page.locator('#aiMusicState')).toContainText('Previous result preserved.');

    await page.selectOption('#aiMusicMode', 'instrumental');
    await expect(page.locator('#aiMusicLyricsMode')).toBeDisabled();
    await expect(page.locator('#aiMusicLyricsField')).toBeHidden();
  });

  test('accepts sub-512 FLUX.2 Dev reference images and rejects 512x512 images before submit', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Image' }).click();
    await page.selectOption('#aiImageModel', '@cf/black-forest-labs/flux-2-dev');

    await page.locator('#aiImageRef0').setInputFiles(createSvgUpload(511, 511));
    await expect(page.locator('#aiImageRefCount')).toHaveText('1 / 4');
    await expect(
      page.locator('.admin-ai__ref-slot[data-ref-index="0"] .admin-ai__ref-preview'),
    ).toBeVisible();

    await page.locator('#aiImageRef1').setInputFiles(createSvgUpload(512, 512));
    await expect(page.locator('#aiImageRefCount')).toHaveText('1 / 4');
    await expect(page.locator('#aiLabStatus')).toContainText(
      'Reference image 2 must be smaller than 512x512 for FLUX.2 Dev. Received 512x512.',
    );
    await expect(
      page.locator('.admin-ai__ref-slot[data-ref-index="1"] .admin-ai__ref-add'),
    ).toBeVisible();
  });

  test('reference-image slots stay empty until selection and reset cleanly after removal', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Image' }).click();
    await page.selectOption('#aiImageModel', '@cf/black-forest-labs/flux-2-dev');
    await expect(page.locator('#aiImageRefCount')).toHaveText('0 / 4');

    for (let i = 0; i < 4; i++) {
      await expect(
        page.locator(`.admin-ai__ref-slot[data-ref-index="${i}"] .admin-ai__ref-preview`),
      ).toBeHidden();
      await expect(
        page.locator(`.admin-ai__ref-slot[data-ref-index="${i}"] .admin-ai__ref-remove`),
      ).toBeHidden();
      await expect(
        page.locator(`.admin-ai__ref-slot[data-ref-index="${i}"] .admin-ai__ref-add`),
      ).toBeVisible();
    }

    const chooser = page.waitForEvent('filechooser');
    await page.locator('.admin-ai__ref-slot[data-ref-index="0"] .admin-ai__ref-add').click();
    const fileChooser = await chooser;
    const chooserInput = await fileChooser.element();
    expect(await chooserInput.getAttribute('id')).toBe('aiImageRef0');

    await fileChooser.setFiles(createSvgUpload(64, 64));

    await expect(page.locator('#aiImageRefCount')).toHaveText('1 / 4');
    await expect(
      page.locator('.admin-ai__ref-slot[data-ref-index="0"] .admin-ai__ref-preview'),
    ).toBeVisible();
    await expect(
      page.locator('.admin-ai__ref-slot[data-ref-index="0"] .admin-ai__ref-remove'),
    ).toBeVisible();
    await expect(
      page.locator('.admin-ai__ref-slot[data-ref-index="0"] .admin-ai__ref-add'),
    ).toBeHidden();
    await expect(
      page.locator('.admin-ai__ref-slot[data-ref-index="0"] .admin-ai__ref-thumb'),
    ).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);

    await page.locator('.admin-ai__ref-slot[data-ref-index="0"] .admin-ai__ref-remove').click();

    await expect(page.locator('#aiImageRefCount')).toHaveText('0 / 4');
    await expect(
      page.locator('.admin-ai__ref-slot[data-ref-index="0"] .admin-ai__ref-preview'),
    ).toBeHidden();
    await expect(
      page.locator('.admin-ai__ref-slot[data-ref-index="0"] .admin-ai__ref-remove'),
    ).toBeHidden();
    await expect(
      page.locator('.admin-ai__ref-slot[data-ref-index="0"] .admin-ai__ref-add'),
    ).toBeVisible();
  });

  test('saves text, embeddings, compare, live-agent, and video outputs into shared folders', async ({
    page,
  }) => {
    const catalog = createMockAiCatalog();
    const saveTextAssetRequests = [];
    await page.unroute('**/api/admin/ai/save-text-asset');
    await page.route('**/api/admin/ai/save-text-asset', async (route) => {
      const body = route.request().postDataJSON();
      saveTextAssetRequests.push(body);
      const isVideo = body.sourceModule === 'video';
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            id: `txt-${saveTextAssetRequests.length}`,
            folder_id: body.folderId || null,
            title: body.title,
            file_name: isVideo ? 'saved.mp4' : 'saved.txt',
            source_module: body.sourceModule,
            mime_type: isVideo ? 'video/mp4' : 'text/plain; charset=utf-8',
            size_bytes: isVideo ? 8192 : 420,
            preview_text: body.data?.prompt || 'Saved from admin AI Lab.',
            created_at: '2026-04-10T12:00:00.000Z',
          },
        }),
      });
    });
    await page.unroute('**/api/admin/ai/test-text');
    await page.route('**/api/admin/ai/test-text', async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          task: 'text',
          model: catalog.models.text[1],
          preset: body.preset || 'balanced',
          result: {
            text: 'Mocked text output from admin AI Lab.',
            usage: {
              total_tokens: 42,
              prompt_tokens_details: {
                cached_tokens: 6,
                audio_tokens: 0,
              },
            },
            maxTokens: body.maxTokens,
            temperature: body.temperature,
          },
          elapsedMs: 123,
          warnings: ['Mock text warning'],
        }),
      });
    });
    await page.unroute('**/api/admin/ai/compare');
    await page.route('**/api/admin/ai/compare', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          task: 'compare',
          models: catalog.models.text,
          result: {
            results: [
              {
                ok: true,
                model: catalog.models.text[0],
                text: 'BITBI blends AI imagery with a premium admin control surface. It feels precise and cinematic.',
                usage: {
                  total_tokens: 11,
                  completion_tokens_details: {
                    reasoning_tokens: 4,
                  },
                },
                elapsedMs: 111,
              },
              {
                ok: true,
                model: catalog.models.text[1],
                text: 'BITBI blends AI imagery with a premium admin control surface. It feels agile and technical.',
                usage: {
                  total_tokens: 17,
                  prompt_tokens_details: {
                    cached_tokens: 2,
                  },
                },
                elapsedMs: 123,
              },
            ],
            maxTokens: 250,
            temperature: 0.7,
          },
          elapsedMs: 222,
          warnings: ['Mock compare warning'],
        }),
      });
    });

    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.locator('#aiTextPrompt').fill('Save this text output');
    await page.locator('#aiTextRun').click();
    await page.locator('#aiTextSave').click();
    await expect(page.locator('#aiLabSaveModal')).toBeVisible();
    await page.selectOption('#aiLabSaveFolder', 'folder-launches');
    await page.locator('#aiLabSaveConfirm').click();
    await expect(page.locator('#aiLabSaveModal')).toBeHidden();

    await page.getByRole('button', { name: 'Embeddings' }).click();
    await page.locator('#aiEmbeddingsInput').fill('first vector\nsecond vector');
    await page.locator('#aiEmbeddingsRun').click();
    await page.locator('#aiEmbeddingsSave').click();
    await page.locator('#aiLabSaveInput').fill('Embedding Snapshot');
    await page.selectOption('#aiLabSaveFolder', 'folder-research');
    await page.locator('#aiLabSaveConfirm').click();

    await page.getByRole('button', { name: 'Compare' }).click();
    await page.locator('#aiCompareRun').click();
    await page.locator('#aiCompareSave').click();
    await page.locator('#aiLabSaveInput').fill('Compare Session');
    await page.selectOption('#aiLabSaveFolder', 'folder-launches');
    await page.locator('#aiLabSaveConfirm').click();

    await page.getByRole('button', { name: 'Live Agent' }).click();
    await page.route('**/api/admin/ai/live-agent', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"choices":[{"delta":{"content":"Hello from the live agent."}}]}\n\ndata: [DONE]\n\n',
      });
    });
    await page.locator('#aiLiveAgentInput').fill('Summarize this transcript');
    await page.locator('#aiLiveAgentSend').click();
    await expect(page.locator('#aiLiveAgentTranscript')).toContainText('Hello from the live agent.');
    await page.locator('#aiLiveAgentSave').click();
    await expect(page.locator('#aiLabSaveModal')).toBeVisible();
    await page.locator('#aiLabSaveInput').fill('Live Agent Transcript');
    await page.selectOption('#aiLabSaveFolder', 'folder-research');
    await page.locator('#aiLabSaveConfirm').click();

    await page.getByRole('button', { name: 'Video AI' }).click();
    await page.locator('#aiVideoPrompt').fill('Save this video output');
    await page.locator('#aiVideoRun').click();
    await expect(page.locator('#aiVideoSave')).toBeVisible();
    await page.locator('#aiVideoSave').click();
    await expect(page.locator('#aiLabSaveModal')).toBeVisible();
    await page.locator('#aiLabSaveInput').fill('Video Save');
    await page.selectOption('#aiLabSaveFolder', 'folder-launches');
    await page.locator('#aiLabSaveConfirm').click();
    await expect(page.locator('#aiLabSaveModal')).toBeHidden();

    expect(saveTextAssetRequests).toHaveLength(5);
    expect(saveTextAssetRequests[0]).toEqual(expect.objectContaining({
      sourceModule: 'text',
      folderId: 'folder-launches',
    }));
    expect(saveTextAssetRequests[0].data).toEqual(expect.objectContaining({
      prompt: 'Save this text output',
      output: 'Mocked text output from admin AI Lab.',
    }));
    expect(saveTextAssetRequests[0].data.usage.prompt_tokens_details).toEqual({
      cached_tokens: 6,
      audio_tokens: 0,
    });
    expect(saveTextAssetRequests[1]).toEqual(expect.objectContaining({
      title: 'Embedding Snapshot',
      sourceModule: 'embeddings',
      folderId: 'folder-research',
    }));
    expect(saveTextAssetRequests[1].data).toEqual(expect.objectContaining({
      inputItems: ['first vector', 'second vector'],
    }));
    expect(saveTextAssetRequests[2]).toEqual(expect.objectContaining({
      title: 'Compare Session',
      sourceModule: 'compare',
      folderId: 'folder-launches',
    }));
    expect(saveTextAssetRequests[2].data.results).toHaveLength(2);
    expect(saveTextAssetRequests[2].data.results[0].usage.completion_tokens_details).toEqual({
      reasoning_tokens: 4,
    });
    expect(saveTextAssetRequests[2].data.results[1].usage.prompt_tokens_details).toEqual({
      cached_tokens: 2,
    });
    expect(saveTextAssetRequests[3]).toEqual(expect.objectContaining({
      title: 'Live Agent Transcript',
      sourceModule: 'live_agent',
      folderId: 'folder-research',
    }));
    expect(saveTextAssetRequests[3].data.transcript.length).toBeGreaterThanOrEqual(2);
    expect(saveTextAssetRequests[4]).toEqual(expect.objectContaining({
      title: 'Video Save',
      sourceModule: 'video',
      folderId: 'folder-launches',
    }));
    expect(saveTextAssetRequests[4].data).toEqual(expect.objectContaining({
      videoUrl: 'https://example.com/generated-video.mp4',
      prompt: 'Save this video output',
      duration: 5,
      aspect_ratio: '16:9',
      quality: '720p',
      generate_audio: true,
      hasImageInput: false,
    }));

    await expect(page.locator('#aiLabStatus')).toContainText('Video asset saved to the shared folder structure.');
  });

  test('reuses the existing image save flow for AI Lab image results', async ({
    page,
  }) => {
    const saveImageRequests = [];
    await page.unroute('**/api/ai/images/save');
    await page.route('**/api/ai/images/save', async (route) => {
      const body = route.request().postDataJSON();
      saveImageRequests.push(body);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            id: 'img-1',
            folder_id: body.folder_id || null,
            prompt: body.prompt,
            model: body.model,
            steps: body.steps ?? null,
            seed: body.seed ?? null,
            created_at: '2026-04-10T12:00:00.000Z',
          },
        }),
      });
    });

    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Image' }).click();
    await page.locator('#aiImagePrompt').fill('Save this generated image');
    await page.locator('#aiImageRun').click();
    await page.locator('#aiImageSave').click();
    await expect(page.locator('#aiLabSaveTitleField')).toBeHidden();
    await page.selectOption('#aiLabSaveFolder', 'folder-launches');
    await page.locator('#aiLabSaveConfirm').click();
    await expect(page.locator('#aiLabSaveModal')).toBeHidden();

    expect(saveImageRequests).toHaveLength(1);
    expect(saveImageRequests[0]).toEqual(expect.objectContaining({
      folder_id: 'folder-launches',
      prompt: 'Save this generated image',
      model: '@cf/black-forest-labs/flux-1-schnell',
      steps: 4,
      seed: 12345,
    }));
    expect(saveImageRequests[0].imageData).toMatch(/^data:image\/png;base64,/);
  });

  test('persists last-used form values and surfaces backend errors', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#aiModelsText')).toContainText('GPT OSS 20B');

    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.locator('#aiTextPrompt').fill('Persist me');
    await page.locator('#aiTextRun').click();
    await expect(page.locator('#aiTextOutput')).toContainText(
      'Mocked text output from admin AI Lab.',
    );
    await page.reload();

    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(page.locator('#aiTextPrompt')).toHaveValue('Persist me');
    await expect(page.locator('#aiTextPromptHistory')).toContainText('Persist me');

    await page.locator('#aiTextHistoryClear').click();
    await expect(page.locator('#aiTextPromptHistory')).toContainText(
      'Recent text prompts will appear here.',
    );

    await page.locator('#aiTextPrompt').fill('force error');
    await page.locator('#aiTextRun').click();
    await expect(page.locator('#aiLabStatus')).toContainText(
      'Prompt rejected by mock.',
    );
    await expect(page.locator('#aiTextState')).toContainText(
      'Prompt rejected by mock.',
    );
  });

  test('uses stable coded admin AI errors without losing readable fallback messages', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.locator('#aiTextPrompt').fill('force coded error');
    await page.locator('#aiTextRun').click();
    await expect(page.locator('#aiLabStatus')).toContainText(
      'Selected model is not allowlisted for this AI Lab task.',
    );
    await expect(page.locator('#aiTextState')).toContainText('not allowlisted');

    await page.locator('#aiTextPrompt').fill('force error');
    await page.locator('#aiTextRun').click();
    await expect(page.locator('#aiLabStatus')).toContainText('Prompt rejected by mock.');
    await expect(page.locator('#aiTextState')).toContainText('Prompt rejected by mock.');
  });

  test('filters compare output and supports full-copy plus diff-only copy actions', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await page.locator('#aiCompareRun').click();
    await expect(page.locator('#aiCompareAText')).toContainText(
      'BITBI blends AI imagery with a premium admin control surface.',
    );
    await expect(page.locator('#aiCompareBText')).toContainText(
      'BITBI blends AI imagery with a premium admin control surface.',
    );
    await expect(page.locator('#aiCompareDiff')).toContainText('Shared Phrasing');

    await page.locator('#aiCompareOnlyDifferences').check();
    await expect(page.locator('#aiCompareMeta')).toContainText('Only differences');
    await expect(page.locator('#aiCompareAText')).not.toContainText(
      'BITBI blends AI imagery with a premium admin control surface.',
    );
    await expect(page.locator('#aiCompareBText')).not.toContainText(
      'BITBI blends AI imagery with a premium admin control surface.',
    );
    await expect(page.locator('#aiCompareAText')).toContainText(
      'It feels precise and cinematic.',
    );
    await expect(page.locator('#aiCompareBText')).toContainText(
      'It feels agile and technical.',
    );
    await expect(page.locator('#aiCompareDiff')).toContainText(
      'Only differences view enabled',
    );
    await expect(page.locator('#aiCompareDiff')).not.toContainText('Shared Phrasing');
    await expect(page.locator('#aiCompareACopyDiff')).toBeVisible();
    await expect(page.locator('#aiCompareBCopyDiff')).toBeVisible();

    await page.locator('#aiCompareACopy').click();
    await expect.poll(() => readClipboardValue(page)).toContain(
      'BITBI blends AI imagery with a premium admin control surface.',
    );

    await page.locator('#aiCompareACopyDiff').click();
    await expect.poll(() => readClipboardValue(page)).toBe(
      'It feels precise and cinematic.',
    );

    await page.locator('#aiCompareBCopyDiff').click();
    await expect.poll(() => readClipboardValue(page)).toBe(
      'It feels agile and technical.',
    );

    await page.reload();
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.locator('#aiCompareOnlyDifferences')).toBeChecked();

    await page.locator('#aiCompareRun').click();
    await expect(page.locator('#aiCompareAText')).toContainText(
      'It feels precise and cinematic.',
    );
    await page.locator('#aiCompareOnlyDifferences').uncheck();
    await expect(page.locator('#aiCompareMeta')).toContainText('Full outputs');
    await expect(page.locator('#aiCompareAText')).toContainText(
      'BITBI blends AI imagery with a premium admin control surface.',
    );
    await expect(page.locator('#aiCompareACopyDiff')).toBeHidden();
    await page.locator('#aiCompareACopy').click();
    await expect.poll(() => readClipboardValue(page)).toContain(
      'BITBI blends AI imagery with a premium admin control surface.',
    );
  });

  test('keeps diff-only copy stable for identical and partial-success compare states', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await page.locator('#aiComparePrompt').fill('identical compare output');
    await page.locator('#aiCompareRun').click();
    await page.locator('#aiCompareOnlyDifferences').check();
    await expect(page.locator('#aiCompareAText')).toContainText(
      'No unique phrasing detected in difference-only view.',
    );
    await expect(page.locator('#aiCompareACopyDiff')).toBeVisible();
    await expect(page.locator('#aiCompareACopyDiff')).toBeDisabled();

    await page.locator('#aiComparePrompt').fill('partial compare failure');
    await page.locator('#aiCompareRun').click();
    await expect(page.locator('#aiCompareState')).toContainText('partial success');
    await expect(page.locator('#aiCompareAError')).toBeHidden();
    await expect(page.locator('#aiCompareBError')).toContainText('Mock compare upstream failure.');
    await expect(page.locator('#aiCompareDiff')).toContainText(
      'Difference aid becomes available when both compare outputs succeed.',
    );
    await expect(page.locator('#aiCompareACopyDiff')).toBeVisible();
    await expect(page.locator('#aiCompareACopyDiff')).toBeDisabled();
    await expect(page.locator('#aiCompareBCopyDiff')).toBeHidden();
  });

  test('cancels an in-flight text request without overwriting the previous result', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.locator('#aiTextPrompt').fill('Fast success');
    await page.locator('#aiTextRun').click();
    await expect(page.locator('#aiTextOutput')).toContainText(
      'Mocked text output from admin AI Lab.',
    );

    await page.unroute('**/api/admin/ai/test-text');
    await page.route('**/api/admin/ai/test-text', async (route) => {
      await wait(900);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          task: 'text',
          model: {
            id: '@cf/meta/llama-3.1-8b-instruct-fast',
            task: 'text',
            label: 'Llama 3.1 8B Instruct Fast',
            vendor: 'Meta',
          },
          preset: 'fast',
          result: {
            text: 'Slow response that should never replace the cancelled state.',
            usage: {
              total_tokens: 99,
            },
            maxTokens: 300,
            temperature: 0.7,
          },
          elapsedMs: 999,
        }),
      });
    });

    await page.locator('#aiTextPrompt').fill('Cancel this slow request');
    await page.locator('#aiTextRun').click();
    await expect(page.locator('#aiTextCancel')).toBeEnabled();
    await expect(page.locator('#aiTextState')).toContainText('Running text test');

    await page.locator('#aiTextCancel').click();
    await expect(page.locator('#aiLabStatus')).toContainText('Text request cancelled.');
    await expect(page.locator('#aiTextState')).toContainText('Text request cancelled.');
    await expect(page.locator('#aiTextOutput')).toContainText(
      'Mocked text output from admin AI Lab.',
    );

    await wait(1000);
    await expect(page.locator('#aiTextState')).toContainText('Text request cancelled.');
    await expect(page.locator('#aiTextOutput')).not.toContainText(
      'Slow response that should never replace the cancelled state.',
    );
  });

  test('times out slow AI Lab requests with a distinct timeout state', async ({
    page,
  }) => {
    const catalog = createMockAiCatalog();
    await setAiLabTimeouts(page, {
      text: 180,
      image: 180,
      embeddings: 180,
      compare: 180,
    });

    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.unroute('**/api/admin/ai/test-text');
    await page.route('**/api/admin/ai/test-text', async (route) => {
      await wait(700);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          task: 'text',
          model: catalog.models.text[1],
          preset: 'balanced',
          result: {
            text: 'Slow text response.',
            usage: { total_tokens: 40 },
            maxTokens: 300,
            temperature: 0.7,
          },
          elapsedMs: 800,
        }),
      });
    });
    await page.locator('#aiTextPrompt').fill('timeout text');
    await page.locator('#aiTextRun').click();
    await expect(page.locator('#aiTextState')).toContainText('timed out');
    await expect(page.locator('#aiTextState')).not.toContainText('cancelled');
    await expect(page.locator('#aiTextRun')).toBeEnabled();
    await expect(page.locator('#aiTextCancel')).toBeDisabled();

    await page.getByRole('button', { name: 'Image' }).click();
    await page.unroute('**/api/admin/ai/test-image');
    await page.route('**/api/admin/ai/test-image', async (route) => {
      await wait(700);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          task: 'image',
          model: catalog.models.image[0],
          preset: 'image_fast',
          result: {
            imageBase64: ONE_PX_PNG_BASE64,
            mimeType: 'image/png',
            steps: 4,
            seed: 12345,
            requestedSize: { width: 1024, height: 1024 },
            appliedSize: null,
          },
          elapsedMs: 800,
        }),
      });
    });
    await page.locator('#aiImagePrompt').fill('timeout image');
    await page.locator('#aiImageRun').click();
    await expect(page.locator('#aiImageState')).toContainText('timed out');
    await expect(page.locator('#aiImageRun')).toBeEnabled();
    await expect(page.locator('#aiImageCancel')).toBeDisabled();

    await page.getByRole('button', { name: 'Embeddings' }).click();
    await page.unroute('**/api/admin/ai/test-embeddings');
    await page.route('**/api/admin/ai/test-embeddings', async (route) => {
      await wait(700);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          task: 'embeddings',
          model: catalog.models.embeddings[0],
          preset: 'embedding_default',
          result: {
            vectors: [[0.1, 0.2, 0.3]],
            dimensions: 3,
            count: 1,
            shape: [1, 3],
            pooling: null,
          },
          elapsedMs: 800,
        }),
      });
    });
    await page.locator('#aiEmbeddingsInput').fill('timeout embeddings');
    await page.locator('#aiEmbeddingsRun').click();
    await expect(page.locator('#aiEmbeddingsState')).toContainText('timed out');
    await expect(page.locator('#aiEmbeddingsRun')).toBeEnabled();
    await expect(page.locator('#aiEmbeddingsCancel')).toBeDisabled();

    await page.getByRole('button', { name: 'Compare' }).click();
    await page.unroute('**/api/admin/ai/compare');
    await page.route('**/api/admin/ai/compare', async (route) => {
      await wait(700);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          task: 'compare',
          models: catalog.models.text,
          result: {
            results: [
              {
                ok: true,
                model: catalog.models.text[0],
                text: 'Slow compare A.',
                usage: { total_tokens: 12 },
                elapsedMs: 400,
              },
              {
                ok: true,
                model: catalog.models.text[1],
                text: 'Slow compare B.',
                usage: { total_tokens: 14 },
                elapsedMs: 420,
              },
            ],
            maxTokens: 250,
            temperature: 0.7,
          },
          elapsedMs: 900,
        }),
      });
    });
    await page.locator('#aiComparePrompt').fill('timeout compare');
    await page.locator('#aiCompareRun').click();
    await expect(page.locator('#aiCompareState')).toContainText('timed out');
    await expect(page.locator('#aiCompareState')).not.toContainText('cancelled');
    await expect(page.locator('#aiLabStatus')).toContainText('timed out');
    await expect(page.locator('#aiCompareRun')).toBeEnabled();
    await expect(page.locator('#aiCompareCancel')).toBeDisabled();

    await wait(750);
    await expect(page.locator('#aiCompareState')).toContainText('timed out');
    await expect(page.locator('#aiCompareAText')).not.toContainText('Slow compare A.');
    await expect(page.locator('#aiCompareBText')).not.toContainText('Slow compare B.');
  });

  test('uses the 480 second default timeout for slow Video AI requests without breaking abort handling', async ({
    page,
  }) => {
    const catalog = createMockAiCatalog();
    await page.addInitScript(() => {
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (fn, delay, ...args) => {
        const nextDelay = typeof delay === 'number' && delay > 1000 ? 180 : delay;
        return nativeSetTimeout(fn, nextDelay, ...args);
      };
    });

    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Video AI' }).click();
    await page.unroute('**/api/admin/ai/test-video');
    await page.route('**/api/admin/ai/test-video', async (route) => {
      const body = route.request().postDataJSON();
      await wait(700);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          task: 'video',
          model: catalog.models.video[0],
          preset: body.preset || 'video_studio',
          result: {
            videoUrl: 'https://example.com/slow-generated-video.mp4',
            prompt: body.prompt,
            duration: body.duration ?? 5,
            aspect_ratio: body.aspect_ratio || '16:9',
            quality: body.quality || '720p',
            seed: body.seed ?? null,
            generate_audio: body.generate_audio !== false,
            hasImageInput: !!body.image_input,
          },
          elapsedMs: 800,
        }),
      });
    });

    await page.locator('#aiVideoPrompt').fill('timeout video');
    await page.locator('#aiVideoRun').click();

    await expect(page.locator('#aiVideoState')).toContainText('Video request timed out after 480 s.');
    await expect(page.locator('#aiVideoState')).not.toContainText('cancelled');
    await expect(page.locator('#aiLabStatus')).toContainText('Video request timed out after 480 s.');
    await expect(page.locator('#aiVideoRun')).toBeEnabled();
    await expect(page.locator('#aiVideoCancel')).toBeDisabled();

    await wait(750);
    await expect(page.locator('#aiVideoState')).toContainText('Video request timed out after 480 s.');
    await expect(page.locator('#aiVideoPreview video')).toHaveCount(0);
    await expect(page.locator('#aiVideoSave')).toBeHidden();
  });

  test('keeps the Video AI image input preview in a designed empty state before selection, after clear, and after load failure', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Video AI' }).click();
    await expect(page.locator('#aiVideoImagePreview')).toBeVisible();
    await expect(page.locator('#aiVideoImagePreview')).toHaveAttribute('data-state', 'empty');
    await expect(page.locator('#aiVideoImageEmpty')).toContainText('Optional image input preview');
    await expect(page.locator('#aiVideoImageEmpty')).toContainText('No reference image selected.');
    await expect(page.locator('#aiVideoImageThumb')).toBeHidden();
    await expect(page.locator('#aiVideoImageClear')).toBeHidden();

    await page.locator('#aiVideoImageFile').setInputFiles({
      name: 'video-input.png',
      mimeType: 'image/png',
      buffer: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
    });
    await expect(page.locator('#aiVideoImagePreview')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('#aiVideoImageThumb')).toBeVisible();
    await expect(page.locator('#aiVideoImageClear')).toBeVisible();

    await page.locator('#aiVideoImageClear').click();
    await expect(page.locator('#aiVideoImagePreview')).toHaveAttribute('data-state', 'empty');
    await expect(page.locator('#aiVideoImageEmpty')).toContainText('No reference image selected.');
    await expect(page.locator('#aiVideoImageThumb')).toBeHidden();
    await expect(page.locator('#aiVideoImageClear')).toBeHidden();

    await page.locator('#aiVideoImageFile').setInputFiles({
      name: 'broken-preview.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not-a-real-png', 'utf8'),
    });
    await expect(page.locator('#aiVideoInlineError')).toContainText(
      'Selected image preview could not be loaded. Choose another image.',
    );
    await expect(page.locator('#aiVideoImagePreview')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#aiVideoImageEmpty')).toContainText('Preview unavailable.');
    await expect(page.locator('#aiVideoImageThumb')).toBeHidden();
    await expect(page.locator('#aiVideoImageClear')).toBeHidden();
  });

  test('Live Agent section appears after Compare and shows the chat UI', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    // Mode buttons: Live Agent after Compare, Music AI after Live Agent
    const modes = page.locator('[data-ai-mode]');
    const labels = await modes.allTextContents();
    const compareIdx = labels.indexOf('Compare');
    const liveAgentIdx = labels.indexOf('Live Agent');
    const musicIdx = labels.indexOf('Music AI');
    expect(compareIdx).toBeGreaterThanOrEqual(0);
    expect(liveAgentIdx).toBe(compareIdx + 1);
    expect(musicIdx).toBe(liveAgentIdx + 1);

    // Switch to Live Agent — only Live Agent card visible
    await page.getByRole('button', { name: 'Live Agent' }).click();
    await expect(page.locator('#aiLabPanelLiveAgent')).toBeVisible();
    await expect(page.locator('#aiLabPanelMusic')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Live Agent' })).toBeVisible();
    await expect(page.locator('#aiLiveAgentSystem')).toBeVisible();
    await expect(page.locator('#aiLiveAgentInput')).toBeVisible();
    await expect(page.locator('#aiLiveAgentSend')).toBeVisible();
    await expect(page.locator('#aiLiveAgentSend')).toBeEnabled();
    await expect(page.locator('#aiLiveAgentCancel')).toBeDisabled();
    await expect(page.locator('#aiLiveAgentState')).toContainText('Ready');

    // Switch to Music AI — only Music AI card visible
    await page.getByRole('button', { name: 'Music AI' }).click();
    await expect(page.locator('#aiLabPanelMusic')).toBeVisible();
    await expect(page.locator('#aiLabPanelLiveAgent')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Music AI' })).toBeVisible();
    await expect(page.locator('#aiMusicPrompt')).toBeVisible();
    await expect(page.locator('#aiMusicRun')).toBeVisible();
  });

  test('Live Agent system and input fields start single-line and autosize with content', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Live Agent' }).click();
    await expect(page.locator('#aiLabPanelLiveAgent')).toBeVisible();

    const system = page.locator('#aiLiveAgentSystem');
    const input = page.locator('#aiLiveAgentInput');

    await expect(system).toHaveAttribute('rows', '1');
    await expect(input).toHaveAttribute('rows', '1');

    const systemInitial = await system.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    const inputInitial = await input.evaluate((el) => Math.round(el.getBoundingClientRect().height));

    await system.fill('Line one\nLine two\nLine three');
    await input.fill('First line\nSecond line\nThird line');

    const systemExpanded = await system.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    const inputExpanded = await input.evaluate((el) => Math.round(el.getBoundingClientRect().height));

    expect(systemExpanded).toBeGreaterThan(systemInitial);
    expect(inputExpanded).toBeGreaterThan(inputInitial);

    await system.fill('Short');
    await input.fill('Short');

    const systemShrunk = await system.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    const inputShrunk = await input.evaluate((el) => Math.round(el.getBoundingClientRect().height));

    expect(systemShrunk).toBeLessThan(systemExpanded);
    expect(inputShrunk).toBeLessThan(inputExpanded);
    expect(systemShrunk).toBeLessThanOrEqual(systemInitial + 2);
    expect(inputShrunk).toBeLessThanOrEqual(inputInitial + 2);
  });

  test('Live Agent rejects empty user input', async ({ page }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Live Agent' }).click();
    await expect(page.locator('#aiLabPanelLiveAgent')).toBeVisible();

    // Send with empty input
    await page.locator('#aiLiveAgentSend').click();
    await expect(page.locator('#aiLiveAgentState')).toContainText(
      'Enter a message before sending',
    );
    // No bubbles in transcript
    await expect(
      page.locator('.admin-ai__chat-msg'),
    ).toHaveCount(0);
  });

  test('Live Agent clear resets conversation', async ({ page }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Live Agent' }).click();

    // Mock a streaming response
    await page.route('**/api/admin/ai/live-agent', async (route) => {
      const body = 'data: {"response":"Hello"}\n\ndata: [DONE]\n\n';
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        body,
      });
    });

    await page.locator('#aiLiveAgentInput').fill('Hi there');
    await page.locator('#aiLiveAgentSend').click();
    await expect(page.locator('.admin-ai__chat-msg')).toHaveCount(2);

    // Clear
    await page.locator('#aiLiveAgentClear').click();
    await expect(page.locator('.admin-ai__chat-msg')).toHaveCount(0);
    await expect(page.locator('#aiLiveAgentState')).toContainText('Ready');
  });
});

// ---------------------------------------------------------------------------
// AI Lab Image panel: capability-driven controls
// ---------------------------------------------------------------------------

test.describe('AI Lab Image capability controls', () => {
  test('disables advanced controls for non-supporting models and enables them for flux-2-dev', async ({
    page,
  }) => {
    await seedCookieConsent(page);
    await page.route('**/api/admin/me', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, loggedIn: true, user: { id: 'a1', email: 'admin@bitbi.ai', role: 'admin' } }),
      });
    });
    await page.route('**/api/admin/ai/models', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(createMockAiCatalog()),
      });
    });

    await page.goto('/admin/index.html#ai-lab');
    await page.getByRole('button', { name: 'Image' }).click();
    await expect(page.locator('#aiImageModel')).toBeVisible();

    // Default model (preset) — guidance, prompt mode, ref images should be disabled
    await page.selectOption('#aiImageModel', '');
    await expect(page.locator('#aiImageGuidanceField')).toHaveClass(/admin-ai__field--disabled/);
    await expect(page.locator('#aiImagePromptModeField')).toHaveClass(/admin-ai__field--disabled/);
    await expect(page.locator('#aiImageRefSection')).toHaveClass(/admin-ai__ref-images--disabled/);

    // Select flux-2-dev — all controls should become enabled
    await page.selectOption('#aiImageModel', '@cf/black-forest-labs/flux-2-dev');
    await expect(page.locator('#aiImageGuidanceField')).not.toHaveClass(/admin-ai__field--disabled/);
    await expect(page.locator('#aiImagePromptModeField')).not.toHaveClass(/admin-ai__field--disabled/);
    await expect(page.locator('#aiImageRefSection')).not.toHaveClass(/admin-ai__ref-images--disabled/);
    await expect(page.locator('#aiImageStepsField')).not.toHaveClass(/admin-ai__field--disabled/);
    await expect(page.locator('#aiImageSeedField')).not.toHaveClass(/admin-ai__field--disabled/);

    // Steps max should be 50 for flux-2-dev
    const stepsMax = await page.locator('#aiImageSteps').getAttribute('max');
    expect(stepsMax).toBe('50');

    // Select klein — guidance still disabled, steps/seed disabled
    await page.selectOption('#aiImageModel', '@cf/black-forest-labs/flux-2-klein-9b');
    await expect(page.locator('#aiImageGuidanceField')).toHaveClass(/admin-ai__field--disabled/);
    await expect(page.locator('#aiImageStepsField')).toHaveClass(/admin-ai__field--disabled/);
    await expect(page.locator('#aiImageSeedField')).toHaveClass(/admin-ai__field--disabled/);
  });

  test('prompt mode selector toggles between standard and structured prompt fields', async ({
    page,
  }) => {
    await seedCookieConsent(page);
    await page.route('**/api/admin/me', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, loggedIn: true, user: { id: 'a1', email: 'admin@bitbi.ai', role: 'admin' } }),
      });
    });
    await page.route('**/api/admin/ai/models', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(createMockAiCatalog()),
      });
    });

    await page.goto('/admin/index.html#ai-lab');
    await page.getByRole('button', { name: 'Image' }).click();
    await page.selectOption('#aiImageModel', '@cf/black-forest-labs/flux-2-dev');

    // Standard mode is default
    await expect(page.locator('#aiImageStandardPromptField')).toBeVisible();
    await expect(page.locator('#aiImageStructuredPromptField')).toBeHidden();

    // Switch to structured
    await page.selectOption('#aiImagePromptMode', 'structured');
    await expect(page.locator('#aiImageStandardPromptField')).toBeHidden();
    await expect(page.locator('#aiImageStructuredPromptField')).toBeVisible();

    // Enter invalid JSON and check validation
    await page.locator('#aiImageStructuredPrompt').fill('not json {{{');
    await page.locator('#aiImageStructuredPrompt').dispatchEvent('input');
    await expect(page.locator('#aiImageStructuredPromptError')).toBeVisible();

    // Enter valid JSON and check validation clears
    await page.locator('#aiImageStructuredPrompt').fill('{"key": "value"}');
    await page.locator('#aiImageStructuredPrompt').dispatchEvent('input');
    await expect(page.locator('#aiImageStructuredPromptError')).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// Regression: auth modal form injection timing (Safari autofill fix)
// Documented in CLAUDE.md as intentional — forms must NOT be pre-rendered.
// ---------------------------------------------------------------------------

test.describe('Regression: auth modal form injection', () => {
  test('login/register forms are not in DOM before modal opens', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'bitbi_cookie_consent',
        JSON.stringify({
          v: '1',
          ts: Date.now(),
          necessary: true,
          analytics: false,
          marketing: false,
        }),
      );
    });
    await page.goto('/');
    await expect(page.locator('.site-nav__cta')).toBeVisible({
      timeout: 10_000,
    });

    // Before modal opens — no form elements in the DOM
    await expect(page.locator('#authLoginForm')).not.toBeAttached();
    await expect(page.locator('#authRegisterForm')).not.toBeAttached();

    // After opening — forms are injected
    await page.locator('.site-nav__cta').click();
    await expect(page.locator('#authLoginForm')).toBeAttached();
    await expect(page.locator('#authRegisterForm')).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// Locked sections — logged-out state
// ---------------------------------------------------------------------------

test.describe('Locked sections', () => {
  test('auth-gated content is locked when logged out', async ({ page }) => {
    await page.goto('/');
    // Wait for auth to resolve and locked-sections to update
    await expect(page.locator('.site-nav__cta')).toBeVisible({
      timeout: 10_000,
    });

    const locked = page.locator('[data-locked="true"]');
    await expect(locked.first()).toBeAttached({ timeout: 5_000 });
    expect(await locked.count()).toBeGreaterThan(0);
  });
});
