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

function getCssColorAlpha(color) {
  const match = String(color || '').match(/rgba?\(([^)]+)\)/i);
  if (!match) return 1;
  const parts = match[1].split(',').map((part) => part.trim());
  if (parts.length < 4) return 1;
  const alpha = Number.parseFloat(parts[3]);
  return Number.isFinite(alpha) ? alpha : 1;
}

async function expectStudioModalClosed(page) {
  await expect
    .poll(() => page.evaluate(
      () => document.querySelector('#studioImageModal')?.classList.contains('active') ?? false,
    ))
    .toBe(false);
}

async function readSavedAssetBadgeMetrics(cardLocator) {
  return cardLocator.evaluate((card) => {
    const badge = card.querySelector('.studio__asset-badge');
    const badgeRect = badge?.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const styles = badge ? getComputedStyle(badge) : null;
    return {
      badgeWidth: badgeRect?.width ?? 0,
      cardWidth: cardRect.width,
      badgeDisplay: styles?.display || '',
      badgeAlignSelf: styles?.alignSelf || '',
      badgeWhiteSpace: styles?.whiteSpace || '',
    };
  });
}

function aiLabModeButton(page, mode, rootSelector = '#sectionAiLab') {
  return page.locator(`${rootSelector} .admin-ai__modes [data-ai-mode="${mode}"]`);
}

async function clickAiLabMode(page, mode, rootSelector = '#sectionAiLab') {
  await aiLabModeButton(page, mode, rootSelector).click();
}

async function clickAdminNavSection(page, sectionName) {
  // Admin nav groups are accordion-style and collapse-on-click — clicking a
  // child link auto-collapses the parent. This helper ensures the parent is
  // expanded before each click, regardless of prior nav state.
  await page.evaluate((name) => {
    const link = document.querySelector(`a.admin-nav__link[data-section="${name}"]`);
    const toggle = link?.closest('.admin-nav__group')?.querySelector('.admin-nav__group-toggle');
    if (toggle && toggle.getAttribute('aria-expanded') === 'false') {
      toggle.click();
    }
  }, sectionName);
  await page.locator(`a.admin-nav__link[data-section="${sectionName}"]`).click();
}

function createSavedAssetsStore(folderPayload = {}, assetsPayload = {}) {
  const folders = cloneJson(folderPayload.folders || []);
  const assetMap = new Map();
  const PAGE_LIMIT = 60;
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
      .sort((a, b) => (
        String(b.created_at || '').localeCompare(String(a.created_at || ''))
        || String(b.asset_type || '').localeCompare(String(a.asset_type || ''))
        || String(b.id || '').localeCompare(String(a.id || ''))
      ));
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
    page(url) {
      const folderId = url.searchParams.get('folder_id') || null;
      const onlyUnfoldered = url.searchParams.get('only_unfoldered') === '1';
      const cursor = url.searchParams.get('cursor') || null;
      const all = listAssets({ folderId, onlyUnfoldered });
      let filtered = all;

      if (cursor) {
        const [createdAt, assetType, id] = cursor.split('|');
        filtered = all.filter((asset) => (
          String(asset.created_at || '') < createdAt
          || (
            String(asset.created_at || '') === createdAt
            && (
              String(asset.asset_type || '') < assetType
              || (
                String(asset.asset_type || '') === assetType
                && String(asset.id || '') < id
              )
            )
          )
        ));
      }

      const slice = filtered.slice(0, PAGE_LIMIT + 1);
      const hasMore = slice.length > PAGE_LIMIT;
      const items = hasMore ? slice.slice(0, PAGE_LIMIT) : slice;
      const last = items[items.length - 1];

      return {
        assets: cloneJson(items),
        has_more: hasMore,
        next_cursor: hasMore && last
          ? `${last.created_at}|${last.asset_type || ''}|${last.id}`
          : null,
        applied_limit: PAGE_LIMIT,
      };
    },
    getAsset(id) {
      const asset = assetMap.get(id);
      return asset ? cloneJson(asset) : null;
    },
    addAsset(asset) {
      assetMap.set(asset.id, cloneJson(asset));
    },
    renameFolder(id, name) {
      const folder = folders.find((entry) => entry.id === id);
      if (!folder) return null;
      folder.name = name;
      folder.slug = String(name || 'folder')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'folder';
      return cloneJson(folder);
    },
    renameAsset(id, name) {
      const asset = assetMap.get(id);
      if (!asset) return null;
      asset.title = name;
      if (asset.asset_type !== 'image') {
        const extMatch = String(asset.file_name || '').match(/\.([^.]+)$/);
        const ext = extMatch ? extMatch[1] : (
          asset.mime_type?.startsWith('audio/')
            ? 'mp3'
            : asset.mime_type?.startsWith('video/')
              ? 'mp4'
              : 'txt'
        );
        const stem = String(name || 'asset')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 64) || 'asset';
        asset.file_name = `${stem}.${ext}`;
      } else {
        asset.prompt = name;
        asset.preview_text = name;
      }
      return cloneJson(asset);
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
      {
        name: 'video_vidu_q3_pro',
        task: 'video',
        label: 'Vidu Q3 Pro',
        model: 'vidu/q3-pro',
        description: 'Admin Vidu video preset',
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
          capabilities: {
            supportsImageInput: true,
            supportsEndImage: false,
            supportsNegativePrompt: true,
            supportsSeed: true,
            supportsAudioToggle: true,
            supportsPromptlessImageMode: false,
            resolutionField: 'quality',
            aspectRatioMode: 'always',
            maxPromptLength: 2048,
            maxNegativePromptLength: 2048,
            minDuration: 1,
            maxDuration: 15,
            aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9'],
            qualityOptions: ['360p', '540p', '720p', '1080p'],
            resolutionOptions: [],
            defaultDuration: 5,
            defaultAspectRatio: '16:9',
            defaultQuality: '720p',
            defaultResolution: null,
            defaultGenerateAudio: true,
            defaultPreset: 'video_studio',
          },
        },
        {
          id: 'vidu/q3-pro',
          task: 'video',
          label: 'Vidu Q3 Pro',
          vendor: 'Vidu',
          description: 'Text-to-video, image-to-video, and start/end-frame generation for admin testing.',
          capabilities: {
            supportsImageInput: true,
            supportsEndImage: true,
            supportsNegativePrompt: false,
            supportsSeed: false,
            supportsAudioToggle: true,
            supportsPromptlessImageMode: true,
            resolutionField: 'resolution',
            aspectRatioMode: 'text_only',
            maxPromptLength: 5000,
            maxNegativePromptLength: null,
            minDuration: 1,
            maxDuration: 16,
            aspectRatios: ['16:9', '9:16', '3:4', '4:3', '1:1'],
            qualityOptions: [],
            resolutionOptions: ['540p', '720p', '1080p'],
            defaultDuration: 5,
            defaultAspectRatio: '16:9',
            defaultQuality: null,
            defaultResolution: '720p',
            defaultGenerateAudio: true,
            defaultPreset: 'video_vidu_q3_pro',
          },
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
  const imageTestRequests = captures.imageTestRequests || [];
  const generatedImageSaveReference = captures.generateSaveReference || 'admin-generated-save-reference';
  const saveImageHandler = typeof captures.saveImageHandler === 'function'
    ? captures.saveImageHandler
    : null;
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
  const adminOrganizations = captures.adminOrganizations || [{
    id: 'org_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    name: 'Admin Image Billing Org',
    slug: 'admin-image-billing-org',
    status: 'active',
  }];
  const adminOrgBilling = captures.adminOrgBilling || Object.fromEntries(
    adminOrganizations.map((org) => [org.id, { organizationId: org.id, creditBalance: 100 }]),
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

  await page.route('**/api/admin/orgs**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/orgs') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          organizations: adminOrganizations,
        }),
      });
      return;
    }
    const billingMatch = url.pathname.match(/^\/api\/admin\/orgs\/([^/]+)\/billing$/);
    if (billingMatch) {
      const billing = adminOrgBilling[billingMatch[1]];
      if (!billing) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'Organization not found.' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          billing,
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/api/admin/ai/test-image', async (route) => {
    const body = route.request().postDataJSON();
    imageTestRequests.push(body);
    const idempotencyKey = route.request().headers()['idempotency-key'];
    if (
      ['@cf/black-forest-labs/flux-1-schnell', '@cf/black-forest-labs/flux-2-klein-9b', undefined].includes(body.model) &&
      (!body.organization_id || !idempotencyKey)
    ) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          code: body.organization_id ? 'idempotency_key_required' : 'organization_required',
          error: body.organization_id
            ? 'Charged admin image tests require organization context and idempotency.'
            : 'Select an organization before running this charged image test.',
        }),
      });
      return;
    }
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
          saveReference: generatedImageSaveReference,
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
        billing: body.organization_id ? {
          organization_id: body.organization_id,
          organization_name: adminOrganizations.find((org) => org.id === body.organization_id)?.name || null,
          credits_charged: selectedModel.id === '@cf/black-forest-labs/flux-2-klein-9b' ? 10 : 1,
          balance_before: 100,
          balance_after: selectedModel.id === '@cf/black-forest-labs/flux-2-klein-9b' ? 90 : 99,
          ledger_entry_id: 'cl_admin_image_mock',
          usage_event_id: 'ue_admin_image_mock',
          usage_attempt_id: 'aua_admin_image_mock',
          idempotent_replay: false,
        } : undefined,
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

  const videoJobs = new Map();
  let videoJobSeq = 0;
  function buildMockVideoResult(body) {
    const selectedModelId = body.model || (body.preset === 'video_vidu_q3_pro' ? 'vidu/q3-pro' : 'pixverse/v6');
    const selectedModel = catalog.models.video.find((entry) => entry.id === selectedModelId) || catalog.models.video[0];
    const isVidu = selectedModel.id === 'vidu/q3-pro';
    return {
      selectedModel,
      preset: body.preset || (isVidu ? 'video_vidu_q3_pro' : 'video_studio'),
      result: isVidu ? {
        videoUrl: 'https://example.com/generated-video.mp4',
        prompt: body.prompt || null,
        duration: body.duration ?? 5,
        aspect_ratio: body.start_image || body.end_image ? null : (body.aspect_ratio || '16:9'),
        quality: null,
        resolution: body.resolution || '720p',
        seed: null,
        generate_audio: body.audio !== false,
        hasImageInput: !!body.start_image,
        hasEndImageInput: !!body.end_image,
        workflow: body.end_image ? 'start_end_to_video' : body.start_image ? 'image_to_video' : 'text_to_video',
      } : {
        videoUrl: 'https://example.com/generated-video.mp4',
        prompt: body.prompt,
        duration: body.duration ?? 5,
        aspect_ratio: body.aspect_ratio || '16:9',
        quality: body.quality || '720p',
        resolution: null,
        seed: body.seed ?? null,
        generate_audio: body.generate_audio !== false,
        hasImageInput: !!body.image_input,
        hasEndImageInput: false,
        workflow: body.image_input ? 'image_to_video' : 'text_to_video',
      },
    };
  }

  await page.route('**/api/admin/ai/video-jobs', async (route) => {
    const body = route.request().postDataJSON();
    const jobId = `mock-video-job-${++videoJobSeq}`;
    const mock = buildMockVideoResult(body);
    const job = {
      jobId,
      status: 'succeeded',
      provider: mock.selectedModel.id === 'vidu/q3-pro' ? 'vidu' : 'workers-ai',
      model: mock.selectedModel.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      statusUrl: `/api/admin/ai/video-jobs/${jobId}`,
      outputUrl: mock.result.videoUrl,
      posterUrl: null,
      _mock: mock,
    };
    videoJobs.set(jobId, job);
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        existing: false,
        job,
      }),
    });
  });

  await page.route('**/api/admin/ai/video-jobs/*', async (route) => {
    const jobId = new URL(route.request().url()).pathname.split('/').pop();
    const job = videoJobs.get(jobId);
    await route.fulfill({
      status: job ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(job ? { ok: true, job } : { ok: false, error: 'Not found', code: 'not_found' }),
    });
  });

  await page.route('**/api/admin/ai/test-video', async (route) => {
    const body = route.request().postDataJSON();
    const selectedModelId = body.model || (body.preset === 'video_vidu_q3_pro' ? 'vidu/q3-pro' : 'pixverse/v6');
    const selectedModel = catalog.models.video.find((entry) => entry.id === selectedModelId) || catalog.models.video[0];
    const isVidu = selectedModel.id === 'vidu/q3-pro';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        task: 'video',
        model: selectedModel,
        preset: body.preset || (isVidu ? 'video_vidu_q3_pro' : 'video_studio'),
        result: isVidu ? {
          videoUrl: 'https://example.com/generated-video.mp4',
          prompt: body.prompt || null,
          duration: body.duration ?? 5,
          aspect_ratio: body.start_image || body.end_image ? null : (body.aspect_ratio || '16:9'),
          quality: null,
          resolution: body.resolution || '720p',
          seed: null,
          generate_audio: body.audio !== false,
          hasImageInput: !!body.start_image,
          hasEndImageInput: !!body.end_image,
          workflow: body.end_image ? 'start_end_to_video' : body.start_image ? 'image_to_video' : 'text_to_video',
        } : {
          videoUrl: 'https://example.com/generated-video.mp4',
          prompt: body.prompt,
          duration: body.duration ?? 5,
          aspect_ratio: body.aspect_ratio || '16:9',
          quality: body.quality || '720p',
          resolution: null,
          seed: body.seed ?? null,
          generate_audio: body.generate_audio !== false,
          hasImageInput: !!body.image_input,
          hasEndImageInput: false,
          workflow: body.image_input ? 'image_to_video' : 'text_to_video',
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

  await page.route('**/api/ai/folders/**', async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.fallback();
      return;
    }
    const pathname = new URL(route.request().url()).pathname;
    const folderId = pathname.split('/').filter(Boolean).pop();
    const body = route.request().postDataJSON();
    const renamed = assetStore.renameFolder(folderId, body.name);
    if (!renamed) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Folder not found.' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          id: renamed.id,
          name: renamed.name,
          slug: renamed.slug,
          unchanged: false,
        },
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
        data: assetStore.page(url),
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
    if (method === 'PATCH' && /\/api\/ai\/images\/[^/]+\/rename$/.test(new URL(route.request().url()).pathname)) {
      const imageId = route.request().url().split('/').slice(-2, -1)[0];
      const body = route.request().postDataJSON();
      const renamed = assetStore.renameAsset(imageId, body.name);
      if (!renamed) {
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
            id: renamed.id,
            title: renamed.title,
            prompt: renamed.prompt,
            unchanged: false,
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

  await page.route('**/api/ai/text-assets/**', async (route) => {
    if (route.request().method() === 'PATCH' && /\/api\/ai\/text-assets\/[^/]+\/rename$/.test(new URL(route.request().url()).pathname)) {
      const assetId = route.request().url().split('/').slice(-2, -1)[0];
      const body = route.request().postDataJSON();
      const renamed = assetStore.renameAsset(assetId, body.name);
      if (!renamed) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'Text asset not found.' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            id: renamed.id,
            title: renamed.title,
            file_name: renamed.file_name,
            unchanged: false,
          },
        }),
      });
      return;
    }
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
    if (saveImageHandler) {
      const handled = await saveImageHandler(route, body, assetStore, saveImageRequests);
      if (handled !== false) {
        return;
      }
    }
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

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockAdminControlPlane(page, captures = {}) {
  captures.creditGrantRequests = captures.creditGrantRequests || [];
  captures.aiCleanupRequests = captures.aiCleanupRequests || [];

  const orgList = {
    ok: true,
    organizations: [
      {
        id: 'org_control_1234567890',
        name: 'Control Plane Org',
        slug: 'control-plane-org',
        status: 'active',
        memberCount: 3,
        createdByEmail: 'owner@example.com',
        createdAt: '2026-04-18T10:00:00.000Z',
      },
    ],
  };

  await page.route('**/api/admin/orgs?*', async (route) => {
    await fulfillJson(route, orgList);
  });
  await page.route('**/api/admin/orgs', async (route) => {
    await fulfillJson(route, orgList);
  });
  await page.route('**/api/admin/orgs/org_control_1234567890', async (route) => {
    await fulfillJson(route, {
      ok: true,
      organization: {
        id: 'org_control_1234567890',
        name: 'Control Plane Org',
        slug: 'control-plane-org',
        status: 'active',
        createdByEmail: 'owner@example.com',
        createdAt: '2026-04-18T10:00:00.000Z',
      },
      members: [
        {
          userId: 'user_owner',
          email: 'owner@example.com',
          role: 'owner',
          status: 'active',
          createdAt: '2026-04-18T10:05:00.000Z',
        },
        {
          userId: 'user_member',
          email: 'member@example.com',
          role: 'member',
          status: 'active',
          createdAt: '2026-04-18T11:05:00.000Z',
        },
      ],
    });
  });

  await page.route('**/api/admin/billing/plans', async (route) => {
    await fulfillJson(route, {
      ok: true,
      livePaymentProviderEnabled: false,
      plans: [
        {
          code: 'free',
          name: 'Free',
          status: 'active',
          monthlyCreditGrant: 25,
          entitlements: [
            { featureKey: 'ai.image.generate' },
            { featureKey: 'ai.text.generate' },
          ],
        },
        {
          code: 'creator_test',
          name: 'Creator Test',
          status: 'active',
          monthlyCreditGrant: 500,
          entitlements: [
            { featureKey: 'ai.image.generate' },
            { featureKey: 'ai.text.generate' },
            { featureKey: 'ai.video.generate' },
          ],
        },
      ],
    });
  });

  await page.route('**/api/admin/orgs/org_control_1234567890/billing', async (route) => {
    await fulfillJson(route, {
      ok: true,
      billing: {
        organizationId: 'org_control_1234567890',
        planCode: 'free',
        creditBalance: 125,
        entitlements: [
          { featureKey: 'ai.image.generate' },
          { featureKey: 'ai.text.generate' },
        ],
      },
    });
  });

  await page.route('**/api/admin/orgs/org_control_1234567890/credits/grant', async (route) => {
    captures.creditGrantRequests.push({
      idempotencyKey: route.request().headers()['idempotency-key'],
      body: route.request().postDataJSON(),
    });
    await fulfillJson(route, {
      ok: true,
      reused: false,
      ledgerEntry: {
        amount: route.request().postDataJSON().amount,
        balanceAfter: 175,
      },
    }, 201);
  });

  const billingEventsPayload = {
    ok: true,
    livePaymentProviderEnabled: false,
    events: [
      {
        id: 'bpe_control_1',
        provider: 'stripe',
        providerMode: 'test',
        eventType: 'checkout.session.completed',
        processingStatus: 'completed',
        verificationStatus: 'verified',
        organizationId: 'org_control_1234567890',
        userId: 'user_owner',
        receivedAt: '2026-04-20T10:00:00.000Z',
        payloadSummary: {
          credit_pack_id: 'credits_5000',
          credits: 5000,
          raw_payload: 'should-not-render',
          payload_hash: 'internal-hash',
        },
      },
    ],
  };
  await page.route('**/api/admin/billing/events?*', async (route) => {
    await fulfillJson(route, billingEventsPayload);
  });
  await page.route('**/api/admin/billing/events', async (route) => {
    await fulfillJson(route, billingEventsPayload);
  });
  await page.route('**/api/admin/billing/events/bpe_control_1', async (route) => {
    await fulfillJson(route, {
      ok: true,
      livePaymentProviderEnabled: false,
      event: {
        ...billingEventsPayload.events[0],
        actions: [
          {
            actionType: 'grant_credits',
            status: 'completed',
            dryRun: false,
            summary: {
              credits: 5000,
              secret_value: 'hidden',
              stripe_signature: 'hidden',
            },
          },
        ],
      },
    });
  });

  const attemptsPayload = {
    ok: true,
    attempts: [
      {
        attemptId: 'aua_control_1',
        organizationId: 'org_control_1234567890',
        userId: 'user_member',
        feature: 'ai.text.generate',
        status: 'completed',
        providerStatus: 'succeeded',
        billingStatus: 'finalized',
        creditCost: 1,
        replay: { available: true, status: 'available' },
        updatedAt: '2026-04-21T10:00:00.000Z',
      },
    ],
  };
  await page.route('**/api/admin/ai/usage-attempts?*', async (route) => {
    await fulfillJson(route, attemptsPayload);
  });
  await page.route('**/api/admin/ai/usage-attempts', async (route) => {
    await fulfillJson(route, attemptsPayload);
  });
  await page.route('**/api/admin/ai/usage-attempts/aua_control_1', async (route) => {
    await fulfillJson(route, {
      ok: true,
      attempt: {
        ...attemptsPayload.attempts[0],
        route: '/api/ai/generate-text',
        operation: 'ai.text.generate',
        result: {
          model: '@cf/openai/gpt-oss-20b',
          promptLength: 128,
          replayTextLength: 220,
          idempotencyKeyHash: 'should-not-render',
          requestFingerprintHash: 'should-not-render',
        },
        error: null,
      },
    });
  });
  await page.route('**/api/admin/ai/usage-attempts/cleanup-expired', async (route) => {
    captures.aiCleanupRequests.push({
      idempotencyKey: route.request().headers()['idempotency-key'],
      body: route.request().postDataJSON(),
    });
    await fulfillJson(route, {
      ok: true,
      cleanup: {
        scannedCount: 3,
        expiredCount: 1,
        reservationsReleasedCount: 1,
        replayObjectsDeletedCount: 0,
        failedCount: 0,
      },
    });
  });

  await page.route('**/api/admin/data-lifecycle/requests?*', async (route) => {
    await fulfillJson(route, {
      ok: true,
      requests: [
        {
          id: 'dlr_control_1',
          type: 'export',
          status: 'archive_generated',
          subjectUserId: 'user_member',
          dryRun: true,
          createdAt: '2026-04-22T09:00:00.000Z',
          expiresAt: '2026-05-22T09:00:00.000Z',
        },
      ],
    });
  });
  await page.route('**/api/admin/data-lifecycle/exports?*', async (route) => {
    await fulfillJson(route, {
      ok: true,
      archives: [
        {
          id: 'dxa_control_1',
          status: 'available',
          subjectUserId: 'user_member',
          sizeBytes: 2048,
          createdAt: '2026-04-22T09:30:00.000Z',
          expiresAt: '2026-05-22T09:30:00.000Z',
        },
      ],
    });
  });

  await page.route('**/api/admin/ai/video-jobs/poison?*', async (route) => {
    await fulfillJson(route, {
      ok: true,
      poisonMessages: [
        {
          id: 'poison_control_1',
          jobId: 'video_job_1',
          reason: 'max_attempts',
          createdAt: '2026-04-23T08:00:00.000Z',
        },
      ],
    });
  });
  await page.route('**/api/admin/ai/video-jobs/failed?*', async (route) => {
    await fulfillJson(route, {
      ok: true,
      failedJobs: [
        {
          id: 'video_job_2',
          jobId: 'video_job_2',
          status: 'failed',
          errorCode: 'provider_failed',
          updatedAt: '2026-04-23T08:30:00.000Z',
        },
      ],
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
  const saveImageRequests = options.saveImageRequests || [];
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
        data: assetStore.page(url),
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

  await page.route('**/api/ai/images/save', async (route) => {
    const body = route.request().postDataJSON();
    saveImageRequests.push(body);
    if (typeof options.saveImageHandler === 'function') {
      const handled = await options.saveImageHandler(route, body, assetStore, saveImageRequests);
      if (handled !== false) {
        return;
      }
    }
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
      thumb_url: `/api/ai/images/${id}/thumb`,
      medium_url: `/api/ai/images/${id}/medium`,
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
          saveReference: options.generateSaveReference || 'generated-save-reference',
        },
      }),
    });
  });
}

async function mockAuthenticatedProfile(page, {
  role = 'user',
  email = `${role}@bitbi.ai`,
  displayName = role === 'admin' ? 'Admin User' : 'Member User',
  includeProfileAccountId = true,
  organizations = [],
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

    const account = {
      email,
      role,
      email_verified: true,
      verification_method: 'email',
      created_at: '2026-04-01T10:00:00.000Z',
    };
    if (includeProfileAccountId) account.id = `${role}-profile-user`;

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
        account,
      }),
    });
  });

  await page.route('**/api/orgs?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, organizations }),
    });
  });
  await page.route('**/api/orgs', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, organizations }),
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

async function mockPricingAccount(page, {
  role = 'admin',
  email = 'pricing-admin@bitbi.ai',
  organizations = [
    {
      id: 'org_pricing_1234567890abcdef1234567890ab',
      name: 'Pricing Test Org',
      slug: 'pricing-test-org',
      role: 'owner',
      status: 'active',
    },
  ],
  billing = {
    organizationId: 'org_pricing_1234567890abcdef1234567890ab',
    creditBalance: 1250,
    plan: { code: 'free', name: 'Free' },
  },
  checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_test_pricing_5000',
  checkoutRequests = [],
} = {}) {
  await page.route('**/api/me', async (route) => {
    await fulfillJson(route, {
      loggedIn: true,
      user: {
        id: `${role}-pricing-user`,
        email,
        role,
        display_name: role === 'admin' ? 'Pricing Admin' : 'Pricing Member',
        has_avatar: false,
        avatar_url: null,
      },
    });
  });

  await page.route('**/api/orgs?*', async (route) => {
    await fulfillJson(route, { ok: true, organizations });
  });
  await page.route('**/api/orgs', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, { ok: true, organizations });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/orgs/*/billing', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, { ok: true, billing });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/orgs/*/billing/checkout/credit-pack', async (route) => {
    checkoutRequests.push({
      body: route.request().postDataJSON(),
      idempotencyKey: route.request().headers()['idempotency-key'] || '',
      url: route.request().url(),
    });
    await fulfillJson(route, {
      ok: true,
      reused: false,
      checkout_url: checkoutUrl,
      session_id: 'cs_test_pricing_5000',
      mode: 'test',
      credit_pack: {
        id: route.request().postDataJSON().pack_id,
        credits: route.request().postDataJSON().pack_id === 'credits_10000' ? 10000 : 5000,
        amountCents: route.request().postDataJSON().pack_id === 'credits_10000' ? 8900 : 4900,
        currency: 'eur',
      },
    }, 201);
  });

  return { checkoutRequests };
}

async function mockCreditsAccount(page, {
  role = 'user',
  email = 'credits-owner@bitbi.ai',
  organizations = [
    {
      id: 'org_credits_1234567890abcdef123456789',
      name: 'Credits Org',
      slug: 'credits-org',
      role: 'owner',
      status: 'active',
    },
  ],
  dashboard = null,
  organizationDashboard = null,
  checkoutRequests = [],
  checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_live_credits_5000',
} = {}) {
  const defaultDashboard = dashboard || {
    organization: {
      id: organizations[0]?.id || 'org_credits_1234567890abcdef123456789',
      name: organizations[0]?.name || 'Credits Org',
      accessScope: role === 'admin' ? 'platform_admin' : 'org_owner',
    },
    balance: {
      current: 5000,
      available: 5000,
      reserved: 0,
      lifetimePurchasedLive: 5000,
      lifetimeManualGrants: 0,
      lifetimeConsumed: 0,
    },
    liveCheckout: {
      enabled: true,
      configured: true,
      mode: 'live',
      configNames: role === 'admin' ? ['ENABLE_LIVE_STRIPE_CREDIT_PACKS'] : undefined,
    },
    packs: [
      { id: 'live_credits_5000', name: '5000 Credit Pack', credits: 5000, amountCents: 999, currency: 'eur', displayPrice: '9,99 €' },
      { id: 'live_credits_12000', name: '12000 Credit Pack', credits: 12000, amountCents: 1999, currency: 'eur', displayPrice: '19,99 €' },
    ],
    purchaseHistory: [],
    recentLedger: [],
  };
  const defaultOrganizationDashboard = organizationDashboard || {
    ...defaultDashboard,
    access: {
      platformAdmin: role === 'admin',
      accessScope: role === 'admin' ? 'platform_admin' : 'org_owner',
      organizationRole: role === 'admin' ? 'none' : 'owner',
      canUseAdminImageTests: role === 'admin',
    },
    recentAdminImageTestDebits: [{
      id: 'cl_admin_image_mock',
      amount: -1,
      balanceAfter: 4999,
      entryType: 'consume',
      featureKey: 'ai.image.generate',
      source: 'admin_ai_image_test',
      createdByUserId: `${role}-credits-user`,
      createdAt: '2026-04-29T12:00:00.000Z',
    }],
    members: [{
      id: 'om_org_owner_mock',
      userId: `${role}-credits-user`,
      email,
      role: role === 'admin' ? 'owner' : 'owner',
      status: 'active',
      createdAt: '2026-04-28T10:00:00.000Z',
      updatedAt: '2026-04-28T10:00:00.000Z',
    }],
    warnings: role === 'admin' ? [{
      code: 'platform_admin_not_org_owner',
      message: 'You are platform admin, but you are not an owner of this organization. Credits belong to the organization.',
    }] : [],
  };

  await page.route('**/api/me', async (route) => {
    await fulfillJson(route, {
      loggedIn: true,
      user: {
        id: `${role}-credits-user`,
        email,
        role,
        display_name: role === 'admin' ? 'Credits Admin' : 'Credits Owner',
        has_avatar: false,
        avatar_url: null,
      },
    });
  });

  await page.route('**/api/admin/orgs?*', async (route) => {
    if (role !== 'admin') {
      await fulfillJson(route, { ok: false, error: 'Admin privileges required.' }, 403);
      return;
    }
    await fulfillJson(route, { ok: true, organizations });
  });

  await page.route('**/api/orgs?*', async (route) => {
    await fulfillJson(route, { ok: true, organizations });
  });
  await page.route('**/api/orgs', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, { ok: true, organizations });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/orgs/*/billing/credits-dashboard*', async (route) => {
    await fulfillJson(route, { ok: true, dashboard: defaultDashboard });
  });
  await page.route('**/api/orgs/*/organization-dashboard*', async (route) => {
    await fulfillJson(route, { ok: true, dashboard: defaultOrganizationDashboard });
  });
  await page.route('**/api/orgs/*/billing/checkout/live-credit-pack', async (route) => {
    checkoutRequests.push({
      body: route.request().postDataJSON(),
      idempotencyKey: route.request().headers()['idempotency-key'] || '',
      url: route.request().url(),
    });
    await fulfillJson(route, {
      ok: true,
      reused: false,
      checkout_url: checkoutUrl,
      session_id: 'cs_live_credits_5000',
      mode: 'live',
      authorization_scope: role === 'admin' ? 'platform_admin' : 'org_owner',
      credit_pack: {
        id: route.request().postDataJSON().pack_id,
        credits: route.request().postDataJSON().pack_id === 'live_credits_12000' ? 12000 : 5000,
        amountCents: route.request().postDataJSON().pack_id === 'live_credits_12000' ? 1999 : 999,
        currency: 'eur',
      },
    }, 201);
  });

  return { checkoutRequests };
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

  test('login form posts only email/password JSON without organization or admin preconditions', async ({ page }) => {
    let loginPayload = null;
    let loginContentType = '';
    await page.route('**/api/login', async (route) => {
      loginContentType = route.request().headers()['content-type'] || '';
      loginPayload = JSON.parse(route.request().postData() || '{}');
      await fulfillJson(route, {
        ok: true,
        message: 'Login successful.',
        user: {
          id: 'regular-login-user',
          email: 'regular@example.com',
          role: 'user',
          status: 'active',
        },
      });
    });

    await page.evaluate(() => {
      localStorage.setItem('bitbi.activeOrganizationId', 'org_static_login_should_not_be_sent');
    });
    await page.locator('.site-nav__cta').click();
    const form = page.locator('#authLoginForm');
    await form.locator('input[name="email"]').fill('regular@example.com');
    await form.locator('input[name="password"]').fill('password123');
    await form.getByRole('button', { name: 'Sign In', exact: true }).click();

    await expect.poll(() => loginPayload).toEqual({
      email: 'regular@example.com',
      password: 'password123',
    });
    expect(loginContentType).toContain('application/json');
    expect(loginPayload).not.toHaveProperty('organization_id');
    expect(loginPayload).not.toHaveProperty('organizationId');
    expect(loginPayload).not.toHaveProperty('activeOrganizationId');
    expect(loginPayload).not.toHaveProperty('admin');
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

test.describe('Admin MFA gate', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
  });

  test('admin page bootstraps MFA enrollment and unlocks the dashboard after setup is enabled', async ({ page }) => {
    const state = {
      phase: 'enrollment_required',
      setupSecret: 'JBSWY3DPEHPK3PXP',
      recoveryCodes: [
        'ABCD-EFGH-IJKL-MNOP-QRST',
        'UVWX-YZ12-3456-7890-ABCD',
      ],
    };

    await page.route('**/api/admin/me', async (route) => {
      if (state.phase === 'verified') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            user: {
              id: 'admin-mfa-1',
              email: 'admin@bitbi.ai',
              role: 'admin',
            },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: 'Admin MFA enrollment required.',
          code: 'admin_mfa_enrollment_required',
          user: {
            id: 'admin-mfa-1',
            email: 'admin@bitbi.ai',
            role: 'admin',
          },
          mfa: {
            enrolled: false,
            verified: false,
            setupPending: state.phase === 'setup_pending',
            method: 'totp',
            recoveryCodesRemaining: 0,
          },
        }),
      });
    });

    await page.route('**/api/admin/mfa/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          mfa: {
            enrolled: false,
            verified: false,
            setupPending: state.phase === 'setup_pending',
            method: 'totp',
            recoveryCodesRemaining: 0,
          },
        }),
      });
    });

    await page.route('**/api/admin/mfa/setup', async (route) => {
      state.phase = 'setup_pending';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          mfa: {
            enrolled: false,
            verified: false,
            setupPending: true,
            method: 'totp',
            recoveryCodesRemaining: state.recoveryCodes.length,
          },
          setup: {
            secret: state.setupSecret,
            otpauthUri: `otpauth://totp/BITBI:admin%40bitbi.ai?secret=${state.setupSecret}&issuer=BITBI`,
            recoveryCodes: state.recoveryCodes,
          },
        }),
      });
    });

    await page.route('**/api/admin/mfa/enable', async (route) => {
      const body = route.request().postDataJSON();
      expect(body).toEqual({ code: '123456' });
      state.phase = 'verified';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          message: 'Admin MFA enabled.',
          mfa: {
            enrolled: true,
            verified: true,
            setupPending: false,
            method: 'totp',
            recoveryCodesRemaining: 10,
            proofExpiresAt: '2026-04-22T14:00:00.000Z',
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

    await page.route('**/api/admin/avatars/latest', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, avatars: [] }),
      });
    });

    const response = await page.goto('/admin/index.html');
    expect(response.status()).toBe(200);

    await expect(page.locator('#adminMfaGate')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#adminMfaTitle')).toHaveText('Admin MFA Enrollment Required');
    await expect(page.locator('#adminMfaEnrollmentBlock')).toBeVisible();
    await expect(page.locator('#adminMfaVerifyBlock')).toBeHidden();

    await page.locator('#adminMfaSetupBtn').click();
    await expect(page.locator('#adminMfaSecret')).toHaveValue(state.setupSecret);
    await expect(page.locator('#adminMfaOtpAuthUri')).toHaveValue(/otpauth:\/\/totp\//);
    await expect(page.locator('#adminMfaRecoveryCodes')).toContainText(state.recoveryCodes[0]);

    await page.locator('#adminMfaEnableCode').fill('123456');
    await page.locator('#adminMfaEnableBtn').click();

    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#adminDenied')).toBeHidden();
  });

  test('admin page blocks on MFA verification until a current code is accepted, then unlocks the dashboard', async ({ page }) => {
    const state = {
      phase: 'mfa_required',
    };

    await page.route('**/api/admin/me', async (route) => {
      if (state.phase === 'verified') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            user: {
              id: 'admin-mfa-2',
              email: 'verified-admin@bitbi.ai',
              role: 'admin',
            },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: state.phase === 'invalid_or_expired'
            ? 'Admin MFA proof is invalid or expired.'
            : 'Admin MFA verification required.',
          code: state.phase === 'invalid_or_expired'
            ? 'admin_mfa_invalid_or_expired'
            : 'admin_mfa_required',
          user: {
            id: 'admin-mfa-2',
            email: 'verified-admin@bitbi.ai',
            role: 'admin',
          },
          mfa: {
            enrolled: true,
            verified: false,
            setupPending: false,
            method: 'totp',
            recoveryCodesRemaining: 9,
          },
        }),
      });
    });

    await page.route('**/api/admin/mfa/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          mfa: {
            enrolled: true,
            verified: false,
            setupPending: false,
            method: 'totp',
            recoveryCodesRemaining: 9,
          },
        }),
      });
    });

    await page.route('**/api/admin/mfa/verify', async (route) => {
      const body = route.request().postDataJSON();
      expect(body).toEqual({ code: '654321' });
      state.phase = 'verified';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          message: 'Admin MFA verified.',
          mfa: {
            enrolled: true,
            verified: true,
            setupPending: false,
            method: 'totp',
            recoveryCodesRemaining: 9,
            proofExpiresAt: '2026-04-22T15:00:00.000Z',
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

    await page.route('**/api/admin/avatars/latest', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, avatars: [] }),
      });
    });

    const response = await page.goto('/admin/index.html');
    expect(response.status()).toBe(200);

    await expect(page.locator('#adminMfaGate')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#adminMfaTitle')).toHaveText('Admin MFA Verification Required');
    await expect(page.locator('#adminMfaEnrollmentBlock')).toBeHidden();
    await expect(page.locator('#adminMfaVerifyBlock')).toBeVisible();

    await page.locator('#adminMfaVerifyCode').fill('654321');
    await page.locator('#adminMfaVerifyBtn').click();

    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#adminDenied')).toBeHidden();
  });
});

test.describe('Admin users pagination', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
  });

  test('admin users table loads more results with the current cursor', async ({ page }) => {
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

    await page.route('**/api/admin/users**', async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      const payload = cursor === 'users-page-2'
        ? {
            ok: true,
            users: [
              {
                id: 'user-3',
                email: 'user-3@example.com',
                role: 'user',
                status: 'active',
                created_at: '2026-04-10T10:00:00.000Z',
                updated_at: '2026-04-10T10:00:00.000Z',
                email_verified_at: '2026-04-10T10:00:00.000Z',
                verification_method: 'email_verified',
              },
            ],
            next_cursor: null,
            has_more: false,
            applied_limit: 50,
          }
        : {
            ok: true,
            users: [
              {
                id: 'user-1',
                email: 'user-1@example.com',
                role: 'user',
                status: 'active',
                created_at: '2026-04-12T10:00:00.000Z',
                updated_at: '2026-04-12T10:00:00.000Z',
                email_verified_at: '2026-04-12T10:00:00.000Z',
                verification_method: 'email_verified',
              },
              {
                id: 'user-2',
                email: 'user-2@example.com',
                role: 'user',
                status: 'active',
                created_at: '2026-04-11T10:00:00.000Z',
                updated_at: '2026-04-11T10:00:00.000Z',
                email_verified_at: '2026-04-11T10:00:00.000Z',
                verification_method: 'email_verified',
              },
            ],
            next_cursor: 'users-page-2',
            has_more: true,
            applied_limit: 50,
          };

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    });

    await page.route('**/api/admin/stats', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          stats: {
            totalUsers: 3,
            activeUsers: 3,
            admins: 1,
            verifiedUsers: 3,
            disabledUsers: 0,
            recentRegistrations: 3,
          },
        }),
      });
    });

    await page.route('**/api/admin/avatars/latest', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, avatars: [] }),
      });
    });

    const response = await page.goto('/admin/index.html#users');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#userTbody tr')).toHaveCount(2);
    await expect(page.locator('#userPagination')).toContainText('Showing 2 users.');
    await page.locator('#userLoadMoreBtn').click();
    await expect(page.locator('#userTbody tr')).toHaveCount(3);
    await expect(page.locator('#userPagination')).toContainText('Showing all 3 users.');
    await expect(page.locator('#userLoadMoreBtn')).toBeHidden();
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

  test('desktop homepage auth pill remains clickable at the far edge of the visible control', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, {
      role: 'user',
      email: 'header@example.com',
      displayName: 'Header Name',
      hasAvatar: true,
    });

    const response = await page.goto('/');
    expect(response.status()).toBe(200);

    const pill = page.locator('.auth-nav__identity');
    await expect(pill).toBeVisible({ timeout: 10_000 });

    const box = await pill.boundingBox();
    expect(box).toBeTruthy();

    await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
    await expect(page).toHaveURL(/\/account\/profile(?:\.html)?$/);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });
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

  test('desktop shared-header auth pill remains clickable at the far edge of the visible control', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, {
      role: 'user',
      email: 'shared-header@example.com',
      displayName: 'Shared Header',
      hasAvatar: true,
    });

    const response = await page.goto('/legal/imprint.html');
    expect(response.status()).toBe(200);

    const pill = page.locator('.auth-nav__identity');
    await expect(pill).toBeVisible({ timeout: 10_000 });

    const box = await pill.boundingBox();
    expect(box).toBeTruthy();

    await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
    await expect(page).toHaveURL(/\/account\/profile(?:\.html)?$/);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Pricing credit-pack rollout', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
  });

  test('shows the Pricing header link only for authenticated admins', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await fulfillJson(route, { loggedIn: false, user: null });
    });
    await page.goto('/');
    await expect(page.locator('.auth-nav__pricing-link')).toHaveCount(0);

    await page.unroute('**/api/me');
    await mockAuthenticatedHeader(page, { role: 'user', email: 'member-pricing@bitbi.ai' });
    await page.goto('/');
    await expect(page.locator('.auth-nav__pricing-link')).toHaveCount(0);

    await page.unroute('**/api/me');
    await mockAuthenticatedHeader(page, { role: 'admin', email: 'admin-pricing@bitbi.ai' });
    await page.goto('/');
    const pricingLink = page.locator('.site-nav__links .auth-nav__pricing-link');
    await expect(pricingLink).toBeVisible({ timeout: 10_000 });
    await expect(pricingLink).toHaveAttribute('href', '/pricing.html');
    await expect
      .poll(() => page.locator('.site-nav__links > a').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Pricing', 'Gallery', 'Video', 'Sound Lab', 'Profile', 'Admin']);
  });

  test('keeps direct Pricing access admin-gated', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await fulfillJson(route, { loggedIn: false, user: null });
    });
    await page.goto('/pricing.html');
    await expect(page.locator('[data-pricing-access="denied"]')).toContainText('Admin access required');
    await expect(page.locator('.pricing-card')).toHaveCount(0);

    await page.unroute('**/api/me');
    await mockPricingAccount(page, { role: 'user', email: 'member-pricing@bitbi.ai' });
    await page.goto('/pricing.html');
    await expect(page.locator('[data-pricing-access="denied"]')).toContainText('admin-only');
    await expect(page.locator('.pricing-card')).toHaveCount(0);
  });

  test('renders the live credit-pack tiers without stale Testmode pricing copy', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockPricingAccount(page);
    const response = await page.goto('/pricing.html');
    expect(response.status()).toBe(200);

    await expect(page.locator('.pricing-hero__title')).toHaveText('Credits for BITBI AI');
    await expect(page.locator('body')).not.toContainText(/Test ?mode/i);
    await expect(page.locator('.pricing-card')).toHaveCount(3);
    await expect(page.locator('.pricing-card__title')).toHaveText(['Free', '5,000 credits', '12,000 credits']);
    await expect(page.locator('.pricing-card').nth(0)).toContainText('10 free image generations per UTC day');
    await expect(page.locator('.pricing-card').nth(1)).toContainText('9,99 €');
    await expect(page.locator('.pricing-card').nth(2)).toContainText('19,99 €');
    const pricingTitles = await page.locator('.pricing-card__title').evaluateAll((nodes) =>
      nodes.map((node) => node.textContent.trim()),
    );
    expect(pricingTitles.some((title) => /10,?000 Credits/i.test(title))).toBe(false);
    await expect(page.locator('[data-pricing-pack="live_credits_5000"]')).toHaveAttribute('href', '/account/credits.html');
    await expect(page.locator('[data-pricing-pack="live_credits_12000"]')).toHaveAttribute('href', '/account/credits.html');
    await expect(page.locator('#pricingOrgSelect')).toHaveCount(0);
    await expect(page.locator('#pricingBillingState')).toHaveCount(0);
    await expect(page.locator('.pricing-result')).toContainText('Credits dashboard');

    const layoutMetrics = await page.locator('.pricing-card').evaluateAll((cards) => cards.map((card) => ({
      width: card.getBoundingClientRect().width,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    })));
    expect(layoutMetrics.every((entry) => entry.width >= 280)).toBe(true);
    expect(layoutMetrics.every((entry) => entry.scrollWidth <= entry.viewportWidth + 1)).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(mobileOverflow).toBeLessThanOrEqual(1);
  });

  test('paid Pricing CTAs route to the gated Credits dashboard without creating checkout directly', async ({ page }) => {
    const { checkoutRequests } = await mockPricingAccount(page, {
      checkoutUrl: '/pricing?checkout=success',
    });
    await page.goto('/pricing.html');

    await expect(page.locator('[data-pricing-pack="live_credits_5000"]')).toHaveAttribute('href', '/account/credits.html');
    await expect(page.locator('[data-pricing-pack="live_credits_12000"]')).toHaveAttribute('href', '/account/credits.html');
    expect(checkoutRequests).toHaveLength(0);
  });
});

test.describe('Credits dashboard live credit packs', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
  });

  test('keeps direct Credits access gated for unauthenticated users and organization admins', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await fulfillJson(route, { loggedIn: false, user: null });
    });
    await page.goto('/account/credits.html');
    await expect(page.locator('#creditsDenied')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-checkout-pack]')).toHaveCount(0);

    await page.unroute('**/api/me');
    await mockCreditsAccount(page, {
      role: 'user',
      email: 'org-admin-credits@bitbi.ai',
      organizations: [{
        id: 'org_credits_admin_1234567890abcdef12',
        name: 'Admin Only Org',
        slug: 'admin-only-org',
        role: 'admin',
        status: 'active',
      }],
    });
    await page.goto('/account/credits.html');
    await expect(page.locator('#creditsDenied')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-checkout-pack]')).toHaveCount(0);
  });

  test('renders owner credits dashboard, live packs, and safe checkout initiation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { checkoutRequests } = await mockCreditsAccount(page, {
      checkoutUrl: '/account/credits?checkout=success',
    });
    const response = await page.goto('/account/credits.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#creditsDashboard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#creditsOrgName')).toContainText('Credits Org');
    await expect(page.locator('#creditsAccessScope')).toContainText('organization owner');
    await expect(page.locator('#creditsPackGrid [data-checkout-pack]')).toHaveCount(2);
    await expect(page.locator('.credits-pack').nth(0)).toContainText('9,99 €');
    await expect(page.locator('.credits-pack').nth(1)).toContainText('19,99 €');

    const cardWidths = await page.locator('.credits-pack').evaluateAll((cards) =>
      cards.map((card) => card.getBoundingClientRect().width)
    );
    expect(cardWidths.every((width) => width >= 240)).toBe(true);

    await page.locator('[data-checkout-pack="live_credits_5000"]').click();
    await expect(page).toHaveURL(/\/account\/credits(?:\.html)?\?checkout=success$/);
    expect(checkoutRequests).toHaveLength(1);
    expect(checkoutRequests[0].body).toEqual({ pack_id: 'live_credits_5000' });
    expect(checkoutRequests[0].idempotencyKey).toMatch(/^credits-live:org_credits_/);
  });

  test('renders cancel state and has no mobile document overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCreditsAccount(page);
    await page.goto('/account/credits?checkout=cancel');
    await expect(page.locator('#creditsReturnState')).toContainText('Checkout was cancelled');
    await expect(page.locator('#creditsDashboard')).toBeVisible({ timeout: 10_000 });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(mobileOverflow).toBeLessThanOrEqual(1);
  });

  test('renders Organization dashboard for eligible owner and auto-selects the only owned org', async ({ page }) => {
    await mockCreditsAccount(page, {
      organizations: [{
        id: 'org_bitbi_owner_1234567890abcdef1234',
        name: 'BITBI',
        slug: 'bitbi',
        role: 'owner',
        status: 'active',
      }],
      dashboard: {
        organization: {
          id: 'org_bitbi_owner_1234567890abcdef1234',
          name: 'BITBI',
          accessScope: 'org_owner',
        },
        balance: {
          current: 5000,
          available: 5000,
          reserved: 0,
          lifetimePurchasedLive: 5000,
          lifetimeManualGrants: 0,
          lifetimeConsumed: 1,
        },
        liveCheckout: { enabled: true, configured: true, mode: 'live' },
        packs: [],
        purchaseHistory: [],
        recentLedger: [{
          id: 'cl_seed',
          amount: 5000,
          balanceAfter: 5000,
          entryType: 'grant',
          source: 'stripe_live_checkout',
          createdAt: '2026-04-29T10:00:00.000Z',
        }],
      },
      organizationDashboard: {
        organization: {
          id: 'org_bitbi_owner_1234567890abcdef1234',
          name: 'BITBI',
          accessScope: 'org_owner',
        },
        access: {
          platformAdmin: false,
          accessScope: 'org_owner',
          organizationRole: 'owner',
          canUseAdminImageTests: false,
        },
        balance: {
          current: 5000,
          available: 5000,
          reserved: 0,
          lifetimePurchasedLive: 5000,
          lifetimeManualGrants: 0,
          lifetimeConsumed: 1,
        },
        liveCheckout: { enabled: true, configured: true, mode: 'live' },
        packs: [],
        purchaseHistory: [],
        recentLedger: [{
          id: 'cl_seed',
          amount: 5000,
          balanceAfter: 5000,
          entryType: 'grant',
          source: 'stripe_live_checkout',
          createdAt: '2026-04-29T10:00:00.000Z',
        }],
        recentAdminImageTestDebits: [{
          id: 'cl_admin_image',
          amount: -1,
          balanceAfter: 4999,
          entryType: 'consume',
          source: 'admin_ai_image_test',
          createdAt: '2026-04-29T10:05:00.000Z',
        }],
        members: [{
          id: 'om_bitbi_owner',
          userId: 'user-credits-user',
          email: 'credits-owner@bitbi.ai',
          role: 'owner',
          status: 'active',
          createdAt: '2026-04-28T10:00:00.000Z',
        }],
        warnings: [],
      },
    });
    const response = await page.goto('/account/organization.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#organizationDashboard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#organizationName')).toHaveText('BITBI');
    await expect(page.locator('#organizationAccess')).toContainText('Organization role: owner');
    await expect(page.locator('#organizationSummaryGrid')).toContainText('5,000 credits');
    await expect(page.locator('#organizationAdminDebitsBody')).toContainText('admin_ai_image_test');
    await expect(page.locator('#organizationPickerWrap')).toBeHidden();
  });

  test('Organization page shows a selector for platform admins with multiple eligible organizations', async ({ page }) => {
    await mockCreditsAccount(page, {
      role: 'admin',
      email: 'admin@bitbi.ai',
      organizations: [
        {
          id: 'org_admin_select_1234567890abcdef123',
          name: 'BITBI',
          slug: 'bitbi',
          status: 'active',
        },
        {
          id: 'org_admin_select_abcdef1234567890ab',
          name: 'Second Org',
          slug: 'second-org',
          status: 'active',
        },
      ],
    });
    await page.goto('/account/organization.html');
    await expect(page.locator('#organizationDashboard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#organizationName')).toHaveText('Select an organization');
    await expect(page.locator('#organizationPickerWrap')).toBeVisible();
    await page.selectOption('#organizationPicker', 'org_admin_select_1234567890abcdef123');
    await expect(page.locator('#organizationName')).toContainText('BITBI');
  });
});

test.describe('Homepage public browse pagination', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
  });

  test('homepage exposes load more for public Mempics and Memvids', async ({ page }) => {
    const mempicsPages = {
      first: {
        ok: true,
        data: {
          items: [
            {
              id: 'mempic-1',
              title: 'Mempics',
              caption: 'Published by Ada on 2026-04-12.',
              category: 'mempics',
              thumb: { url: '/api/gallery/mempics/mempic-1/thumb', w: 320, h: 320 },
              preview: { url: '/api/gallery/mempics/mempic-1/medium', w: 1280, h: 1280 },
              full: { url: '/api/gallery/mempics/mempic-1/file' },
            },
            {
              id: 'mempic-2',
              title: 'Mempics',
              caption: 'Published by Ada on 2026-04-11.',
              category: 'mempics',
              thumb: { url: '/api/gallery/mempics/mempic-2/thumb', w: 320, h: 320 },
              preview: { url: '/api/gallery/mempics/mempic-2/medium', w: 1280, h: 1280 },
              full: { url: '/api/gallery/mempics/mempic-2/file' },
            },
          ],
          next_cursor: 'mempics-page-2',
          has_more: true,
          applied_limit: 60,
        },
      },
      second: {
        ok: true,
        data: {
          items: [
            {
              id: 'mempic-3',
              title: 'Mempics',
              caption: 'Published by Ada on 2026-04-10.',
              category: 'mempics',
              thumb: { url: '/api/gallery/mempics/mempic-3/thumb', w: 320, h: 320 },
              preview: { url: '/api/gallery/mempics/mempic-3/medium', w: 1280, h: 1280 },
              full: { url: '/api/gallery/mempics/mempic-3/file' },
            },
          ],
          next_cursor: null,
          has_more: false,
          applied_limit: 60,
        },
      },
    };

    const memvidPages = {
      first: {
        ok: true,
        data: {
          items: [
            {
              id: 'memvid-1',
              title: 'Memvid One',
              caption: 'Published by Ada on 2026-04-12.',
              file: { url: '/api/gallery/memvids/memvid-1/file' },
              poster: { url: '/api/gallery/memvids/memvid-1/poster', w: 1280, h: 720 },
            },
            {
              id: 'memvid-2',
              title: 'Memvid Two',
              caption: 'Published by Ada on 2026-04-11.',
              file: { url: '/api/gallery/memvids/memvid-2/file' },
              poster: { url: '/api/gallery/memvids/memvid-2/poster', w: 1280, h: 720 },
            },
          ],
          next_cursor: 'memvids-page-2',
          has_more: true,
          applied_limit: 60,
        },
      },
      second: {
        ok: true,
        data: {
          items: [
            {
              id: 'memvid-3',
              title: 'Memvid Three',
              caption: 'Published by Ada on 2026-04-10.',
              file: { url: '/api/gallery/memvids/memvid-3/file' },
              poster: { url: '/api/gallery/memvids/memvid-3/poster', w: 1280, h: 720 },
            },
          ],
          next_cursor: null,
          has_more: false,
          applied_limit: 60,
        },
      },
    };

    await page.route('**/api/gallery/mempics**', async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      const body = cursor === 'mempics-page-2' ? mempicsPages.second : mempicsPages.first;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });

    await page.route('**/api/gallery/memvids**', async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      const body = cursor === 'memvids-page-2' ? memvidPages.second : memvidPages.first;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });

    const response = await page.goto('/');
    expect(response.status()).toBe(200);

    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Gallery' }).click();
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', 'gallery');
    await expect(page.locator('#galleryGrid .gallery-item:visible')).toHaveCount(2);
    await expect(page.locator('#galleryPagination .browse-pagination__status')).toHaveText('Showing 2 Mempics.');
    await expect(page.locator('#galleryPagination .browse-pagination__toggle')).toBeHidden();
    await expect(page.locator('#galleryPagination .browse-pagination__btn')).toBeVisible();
    await page.locator('#galleryPagination .browse-pagination__btn').click();
    await expect(page.locator('#galleryGrid .gallery-item:visible')).toHaveCount(3);
    await expect(page.locator('#galleryPagination .browse-pagination__status')).toHaveText('Showing all 3 Mempics.');
    await expect(page.locator('#galleryPagination .browse-pagination__toggle')).toBeHidden();
    await expect(page.locator('#galleryPagination .browse-pagination__btn')).toBeHidden();

    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Video' }).click();
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', 'video');
    await expect(page.locator('#videoGrid .video-card')).toHaveCount(2);
    await expect(page.locator('#videoPagination .browse-pagination__status')).toHaveText('Showing 2 Memvids.');
    await expect(page.locator('#videoPagination .browse-pagination__toggle')).toBeHidden();
    await expect(page.locator('#videoPagination .browse-pagination__btn')).toBeVisible();
    await page.locator('#videoPagination .browse-pagination__btn').click();
    await expect(page.locator('#videoGrid .video-card')).toHaveCount(3);
    await expect(page.locator('#videoPagination .browse-pagination__status')).toHaveText('Showing all 3 Memvids.');
    await expect(page.locator('#videoPagination .browse-pagination__toggle')).toBeHidden();
    await expect(page.locator('#videoPagination .browse-pagination__btn')).toBeHidden();
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
    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Gallery' }).click();
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', 'gallery');
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

  test('homepage create studio recovers button state and shows errors when generate/save requests abort', async ({
    page,
  }) => {
    const requests = [];
    await mockAuthenticatedImageStudio(page, requests);

    await page.unroute('**/api/ai/generate-image');
    await page.route('**/api/ai/generate-image', async (route) => {
      await route.abort('failed');
    });

    const response = await page.goto('/');
    expect(response.status()).toBe(200);
    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Gallery' }).click();
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', 'gallery');
    await page.locator('.gallery-mode__btn[data-mode="create"]').click();
    await expect(page.locator('#galleryStudio')).toBeVisible({ timeout: 10_000 });

    await page.locator('#galStudioPrompt').fill('abort generate request');
    await page.locator('#galStudioGenerate').click();

    await expect(page.locator('#galStudioGenerate')).toHaveText('Generate');
    await expect(page.locator('#galStudioGenerate')).toBeEnabled();
    await expect(page.locator('#galStudioGenMsg')).toContainText(/network error|request cancelled|generation failed/i);

    await page.unroute('**/api/ai/generate-image');
    await page.route('**/api/ai/generate-image', async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            imageBase64: ONE_PX_PNG_BASE64,
            mimeType: 'image/png',
            prompt: body.prompt,
            model: body.model || '@cf/black-forest-labs/flux-1-schnell',
            steps: body.steps ?? 4,
            seed: body.seed ?? null,
          },
        }),
      });
    });

    await page.locator('#galStudioGenerate').click();
    await expect(page.locator('#galStudioPreview img')).toBeVisible();
    await expect(page.locator('#galStudioSaveBtn')).toBeEnabled();

    await page.unroute('**/api/ai/images/save');
    await page.route('**/api/ai/images/save', async (route) => {
      await route.abort('failed');
    });

    await page.locator('#galStudioSaveBtn').click();
    await expect(page.locator('#galStudioSaveBtn')).toHaveText('Save');
    await expect(page.locator('#galStudioSaveBtn')).toBeEnabled();
    await expect(page.locator('#galStudioGenMsg')).toContainText(/network error|request cancelled|save failed/i);
  });

  test('account Image Studio saves fresh generations by reference instead of re-uploading the full image', async ({
    page,
  }) => {
    const requests = [];
    const saveImageRequests = [];
    await mockAuthenticatedImageStudio(page, requests, {
      saveImageRequests,
      generateSaveReference: 'member-save-reference',
    });

    await page.goto('/account/image-studio.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#studioPrompt').fill('Reference-backed save');
    await page.locator('#studioGenerate').click();
    await expect(page.locator('#studioPreview img')).toBeVisible();
    await page.locator('#studioSaveBtn').click();

    expect(saveImageRequests).toHaveLength(1);
    expect(saveImageRequests[0]).toEqual(expect.objectContaining({
      save_reference: 'member-save-reference',
      prompt: 'Reference-backed save',
      model: '@cf/black-forest-labs/flux-1-schnell',
    }));
    expect(saveImageRequests[0].imageData).toBeUndefined();
    await expect(page.locator('#studioGenMsg')).toContainText('Image saved.');
  });

  test('homepage create studio saves fresh generations by reference instead of re-uploading the full image', async ({
    page,
  }) => {
    const requests = [];
    const saveImageRequests = [];
    await mockAuthenticatedImageStudio(page, requests, {
      saveImageRequests,
      generateSaveReference: 'homepage-save-reference',
    });

    const response = await page.goto('/');
    expect(response.status()).toBe(200);
    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Gallery' }).click();
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', 'gallery');
    await page.locator('.gallery-mode__btn[data-mode="create"]').click();
    await expect(page.locator('#galleryStudio')).toBeVisible({ timeout: 10_000 });

    await page.locator('#galStudioPrompt').fill('Homepage reference save');
    await page.locator('#galStudioGenerate').click();
    await expect(page.locator('#galStudioPreview img')).toBeVisible();
    await page.locator('#galStudioSaveBtn').click();

    expect(saveImageRequests).toHaveLength(1);
    expect(saveImageRequests[0]).toEqual(expect.objectContaining({
      save_reference: 'homepage-save-reference',
      prompt: 'Homepage reference save',
      model: '@cf/black-forest-labs/flux-1-schnell',
    }));
    expect(saveImageRequests[0].imageData).toBeUndefined();
    await expect(page.locator('#galStudioGenMsg')).toContainText('Image saved.');
  });

  test('account Image Studio falls back to the legacy upload path when a save reference expires', async ({
    page,
  }) => {
    const saveImageRequests = [];
    await mockAuthenticatedImageStudio(page, [], {
      saveImageRequests,
      generateSaveReference: 'expiring-save-reference',
      saveImageHandler: async (route, body) => {
        if (body.save_reference) {
          await route.fulfill({
            status: 410,
            contentType: 'application/json',
            body: JSON.stringify({
              ok: false,
              code: 'SAVE_REFERENCE_EXPIRED',
              error: 'Generated image reference expired. Please generate the image again.',
            }),
          });
          return true;
        }
        return false;
      },
    });

    await page.goto('/account/image-studio.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#studioPrompt').fill('Fallback upload save');
    await page.locator('#studioGenerate').click();
    await expect(page.locator('#studioPreview img')).toBeVisible();
    await page.locator('#studioSaveBtn').click();
    await expect(page.locator('#studioGenMsg')).toContainText('Image saved.');

    expect(saveImageRequests).toHaveLength(2);
    expect(saveImageRequests[0]).toEqual(expect.objectContaining({
      save_reference: 'expiring-save-reference',
      prompt: 'Fallback upload save',
    }));
    expect(saveImageRequests[0].imageData).toBeUndefined();
    expect(saveImageRequests[1]).toEqual(expect.objectContaining({
      prompt: 'Fallback upload save',
      model: '@cf/black-forest-labs/flux-1-schnell',
    }));
    expect(saveImageRequests[1].save_reference).toBeUndefined();
    expect(saveImageRequests[1].imageData).toMatch(/^data:image\/png;base64,/);
    await expect(page.locator('#studioGenMsg')).toContainText('Image saved.');
  });

  test('account Image Studio shows mixed saved assets inside the shared folder world', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__studioOpenCalls = [];
      window.open = (...args) => {
        window.__studioOpenCalls.push(args);
        return null;
      };
    });

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
    await expect(page.locator('#studioImageGrid .studio__asset-open')).toHaveCount(0);
    await expect(page.locator('#studioImageGrid [data-asset-id="vid-1"] .studio__asset-preview')).toHaveCount(0);
    await expect(page.locator('#studioImageGrid [data-asset-id="vid-1"] .studio__asset-video-trigger')).toHaveCount(1);

    const desktopVideoLayout = await page.locator('#studioImageGrid [data-asset-id="vid-1"]').evaluate((card) => {
      const title = card.querySelector('.studio__asset-title')?.getBoundingClientRect();
      const trigger = card.querySelector('.studio__asset-video-trigger')?.getBoundingClientRect();
      return {
        titleBottom: title?.bottom ?? 0,
        triggerTop: trigger?.top ?? 0,
      };
    });
    expect(desktopVideoLayout.titleBottom).toBeLessThanOrEqual(desktopVideoLayout.triggerTop + 1);

    await page.locator('#studioImageGrid [data-asset-id="txt-1"]').click();
    await expect.poll(() => page.evaluate(() => window.__studioOpenCalls.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__studioOpenCalls[0]?.[0] || '')).toMatch(/\/api\/ai\/text-assets\/txt-1\/file$/);

    await page.locator('#studioImageGrid [data-asset-id="snd-1"] .studio__asset-title').click();
    await expect.poll(() => page.evaluate(() => window.__studioOpenCalls.length)).toBe(1);
    await expectStudioModalClosed(page);

    await page.locator('#studioImageGrid [data-asset-id="vid-1"] .studio__asset-title').click();
    await expectStudioModalClosed(page);

    await page.locator('#studioImageGrid [data-asset-id="vid-1"] .studio__asset-video-trigger').click();
    await expect(page.locator('#studioImageModal')).toHaveClass(/active/);
    await expect(page.locator('#studioImageModal .studio-modal__video')).toHaveAttribute('src', /\/api\/ai\/text-assets\/vid-1\/file$/);
    await page.locator('#studioImageModal .modal-close').click();
  });

  test('account Image Studio exposes load more for saved assets and appends the next page', async ({
    page,
  }) => {
    const manyAssets = Array.from({ length: 61 }, (_, index) => ({
      id: `img-page-${index + 1}`,
      asset_type: 'image',
      folder_id: null,
      title: `Paged Asset ${index + 1}`,
      prompt: `Paged Asset ${index + 1}`,
      preview_text: `Paged Asset ${index + 1}`,
      model: '@cf/black-forest-labs/flux-1-schnell',
      steps: 4,
      seed: index + 1,
      created_at: new Date(Date.UTC(2026, 3, 30, 12, 0, 0) - (index * 60_000)).toISOString(),
      file_url: `/api/ai/images/img-page-${index + 1}/file`,
      original_url: `/api/ai/images/img-page-${index + 1}/file`,
      thumb_url: `/api/ai/images/img-page-${index + 1}/thumb`,
      medium_url: `/api/ai/images/img-page-${index + 1}/medium`,
    }));

    await mockAuthenticatedImageStudio(page, [], {
      assetsPayload: {
        all: manyAssets,
      },
    });

    await page.goto('/account/image-studio.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#studioFolderGrid .studio__folder-card').first().click();
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(60);
    await expect(page.locator('.studio__pagination')).toContainText('Showing 60 saved assets.');
    await expect(page.locator('.studio__pagination-btn')).toBeVisible();

    await page.locator('.studio__pagination-btn').click();
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(61);
    await expect(page.locator('.studio__pagination')).toContainText('Showing all 61 saved assets.');
    await expect(page.locator('.studio__pagination-btn')).toBeHidden();
  });

  test('account Image Studio keeps saved-assets type badges compact on desktop and mobile', async ({
    page,
  }) => {
    await mockAuthenticatedImageStudio(page, [], {
      folderPayload: {
        folders: [
          { id: 'folder-badges', name: 'Badge Lab', slug: 'badge-lab', created_at: '2026-04-10T09:00:00.000Z' },
        ],
        counts: {
          'folder-badges': 5,
        },
        unfolderedCount: 0,
      },
      assetsPayload: {
        all: [
          {
            id: 'compare-badge-1',
            asset_type: 'text',
            folder_id: 'folder-badges',
            title: 'Compare Notes',
            file_name: 'compare-notes.txt',
            source_module: 'compare',
            mime_type: 'text/plain; charset=utf-8',
            size_bytes: 321,
            preview_text: 'Compare badge layout check.',
            created_at: '2026-04-10T12:00:00.000Z',
            file_url: '/api/ai/text-assets/compare-badge-1/file',
          },
          {
            id: 'live-badge-1',
            asset_type: 'text',
            folder_id: 'folder-badges',
            title: 'Live Agent Transcript',
            file_name: 'live-agent-transcript.txt',
            source_module: 'live_agent',
            mime_type: 'text/plain; charset=utf-8',
            size_bytes: 654,
            preview_text: 'Live Agent badge layout check.',
            created_at: '2026-04-10T12:01:00.000Z',
            file_url: '/api/ai/text-assets/live-badge-1/file',
          },
          {
            id: 'text-badge-1',
            asset_type: 'text',
            folder_id: 'folder-badges',
            title: 'Plain Text Notes',
            file_name: 'plain-text-notes.txt',
            source_module: '',
            mime_type: 'text/plain; charset=utf-8',
            size_bytes: 777,
            preview_text: 'Plain text badge layout check.',
            created_at: '2026-04-10T12:02:00.000Z',
            file_url: '/api/ai/text-assets/text-badge-1/file',
          },
          {
            id: 'sound-badge-1',
            asset_type: 'sound',
            folder_id: 'folder-badges',
            title: 'Badge Loop',
            file_name: 'badge-loop.mp3',
            source_module: 'text',
            mime_type: 'audio/mpeg',
            size_bytes: 204800,
            preview_text: 'Sound badge layout check.',
            created_at: '2026-04-10T12:03:00.000Z',
            file_url: '/api/ai/text-assets/sound-badge-1/file',
          },
          {
            id: 'video-badge-1',
            asset_type: 'video',
            folder_id: 'folder-badges',
            title: 'Badge Walkthrough',
            file_name: 'badge-walkthrough.mp4',
            source_module: 'video',
            mime_type: 'video/mp4',
            size_bytes: 4096000,
            created_at: '2026-04-10T12:04:00.000Z',
            file_url: '/api/ai/text-assets/video-badge-1/file',
          },
        ],
        unfoldered: [],
        folders: {
          'folder-badges': [
            {
              id: 'compare-badge-1',
              asset_type: 'text',
              folder_id: 'folder-badges',
              title: 'Compare Notes',
              file_name: 'compare-notes.txt',
              source_module: 'compare',
              mime_type: 'text/plain; charset=utf-8',
              size_bytes: 321,
              preview_text: 'Compare badge layout check.',
              created_at: '2026-04-10T12:00:00.000Z',
              file_url: '/api/ai/text-assets/compare-badge-1/file',
            },
            {
              id: 'live-badge-1',
              asset_type: 'text',
              folder_id: 'folder-badges',
              title: 'Live Agent Transcript',
              file_name: 'live-agent-transcript.txt',
              source_module: 'live_agent',
              mime_type: 'text/plain; charset=utf-8',
              size_bytes: 654,
              preview_text: 'Live Agent badge layout check.',
              created_at: '2026-04-10T12:01:00.000Z',
              file_url: '/api/ai/text-assets/live-badge-1/file',
            },
            {
              id: 'text-badge-1',
              asset_type: 'text',
              folder_id: 'folder-badges',
              title: 'Plain Text Notes',
              file_name: 'plain-text-notes.txt',
              source_module: '',
              mime_type: 'text/plain; charset=utf-8',
              size_bytes: 777,
              preview_text: 'Plain text badge layout check.',
              created_at: '2026-04-10T12:02:00.000Z',
              file_url: '/api/ai/text-assets/text-badge-1/file',
            },
            {
              id: 'sound-badge-1',
              asset_type: 'sound',
              folder_id: 'folder-badges',
              title: 'Badge Loop',
              file_name: 'badge-loop.mp3',
              source_module: 'text',
              mime_type: 'audio/mpeg',
              size_bytes: 204800,
              preview_text: 'Sound badge layout check.',
              created_at: '2026-04-10T12:03:00.000Z',
              file_url: '/api/ai/text-assets/sound-badge-1/file',
            },
            {
              id: 'video-badge-1',
              asset_type: 'video',
              folder_id: 'folder-badges',
              title: 'Badge Walkthrough',
              file_name: 'badge-walkthrough.mp4',
              source_module: 'video',
              mime_type: 'video/mp4',
              size_bytes: 4096000,
              created_at: '2026-04-10T12:04:00.000Z',
              file_url: '/api/ai/text-assets/video-badge-1/file',
            },
          ],
        },
      },
    });

    await page.goto('/account/image-studio.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });
    await page.locator('#studioFolderGrid .studio__folder-card').first().click();
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(5);

    const assetIds = [
      'compare-badge-1',
      'live-badge-1',
      'text-badge-1',
      'sound-badge-1',
      'video-badge-1',
    ];

    for (const assetId of assetIds) {
      const metrics = await readSavedAssetBadgeMetrics(
        page.locator(`#studioImageGrid [data-asset-id="${assetId}"]`),
      );
      expect(['flex', 'inline-flex']).toContain(metrics.badgeDisplay);
      expect(metrics.badgeAlignSelf).toBe('flex-start');
      expect(metrics.badgeWhiteSpace).toBe('nowrap');
      expect(metrics.badgeWidth).toBeGreaterThan(0);
      expect(metrics.badgeWidth).toBeLessThan(metrics.cardWidth - 24);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(5);

    for (const assetId of assetIds) {
      const metrics = await readSavedAssetBadgeMetrics(
        page.locator(`#studioImageGrid [data-asset-id="${assetId}"]`),
      );
      expect(['flex', 'inline-flex']).toContain(metrics.badgeDisplay);
      expect(metrics.badgeAlignSelf).toBe('flex-start');
      expect(metrics.badgeWhiteSpace).toBe('nowrap');
      expect(metrics.badgeWidth).toBeGreaterThan(0);
      expect(metrics.badgeWidth).toBeLessThan(metrics.cardWidth - 24);
    }
  });

  test('account Image Studio keeps mobile file cards solid and limits sound playback animation to the active card', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.__studioOpenCalls = [];
      window.open = (...args) => {
        window.__studioOpenCalls.push(args);
        return null;
      };
    });
    await mockAuthenticatedImageStudio(page, [], {
      folderPayload: {
        folders: [
          { id: 'folder-mobile-cards', name: 'Mobile Cards', slug: 'mobile-cards', created_at: '2026-04-10T09:00:00.000Z' },
        ],
        counts: {
          'folder-mobile-cards': 4,
        },
        unfolderedCount: 0,
      },
      assetsPayload: {
        all: [
          {
            id: 'txt-mobile-1',
            asset_type: 'text',
            folder_id: 'folder-mobile-cards',
            title: 'Launch Notes',
            file_name: 'launch-notes.txt',
            source_module: 'compare',
            mime_type: 'text/plain; charset=utf-8',
            size_bytes: 512,
            preview_text: 'A concise release note summary for the mobile card stack.',
            created_at: '2026-04-10T12:05:00.000Z',
            file_url: '/api/ai/text-assets/txt-mobile-1/file',
          },
          {
            id: 'snd-mobile-1',
            asset_type: 'sound',
            folder_id: 'folder-mobile-cards',
            title: 'Signal Drift',
            file_name: 'signal-drift.mp3',
            source_module: 'text',
            mime_type: 'audio/mpeg',
            size_bytes: 204800,
            preview_text: 'A slow gold-tinted synth loop for the first mobile sound card.',
            created_at: '2026-04-10T12:06:00.000Z',
            file_url: '/api/ai/text-assets/snd-mobile-1/file',
          },
          {
            id: 'snd-mobile-2',
            asset_type: 'sound',
            folder_id: 'folder-mobile-cards',
            title: 'Orbit Pulse',
            file_name: 'orbit-pulse.mp3',
            source_module: 'text',
            mime_type: 'audio/mpeg',
            size_bytes: 198400,
            preview_text: 'A brighter loop used to prove only one card animates at a time.',
            created_at: '2026-04-10T12:07:00.000Z',
            file_url: '/api/ai/text-assets/snd-mobile-2/file',
          },
          {
            id: 'vid-mobile-1',
            asset_type: 'video',
            folder_id: 'folder-mobile-cards',
            title: 'Orbit Walkthrough',
            file_name: 'orbit-walkthrough.mp4',
            source_module: 'video',
            mime_type: 'video/mp4',
            size_bytes: 4096000,
            preview_text: 'This video description should stay hidden on the mobile card.',
            created_at: '2026-04-10T12:08:00.000Z',
            file_url: '/api/ai/text-assets/vid-mobile-1/file',
          },
        ],
        unfoldered: [],
        folders: {
          'folder-mobile-cards': [
            {
              id: 'txt-mobile-1',
              asset_type: 'text',
              folder_id: 'folder-mobile-cards',
              title: 'Launch Notes',
              file_name: 'launch-notes.txt',
              source_module: 'compare',
              mime_type: 'text/plain; charset=utf-8',
              size_bytes: 512,
              preview_text: 'A concise release note summary for the mobile card stack.',
              created_at: '2026-04-10T12:05:00.000Z',
              file_url: '/api/ai/text-assets/txt-mobile-1/file',
            },
            {
              id: 'snd-mobile-1',
              asset_type: 'sound',
              folder_id: 'folder-mobile-cards',
              title: 'Signal Drift',
              file_name: 'signal-drift.mp3',
              source_module: 'text',
              mime_type: 'audio/mpeg',
              size_bytes: 204800,
              preview_text: 'A slow gold-tinted synth loop for the first mobile sound card.',
              created_at: '2026-04-10T12:06:00.000Z',
              file_url: '/api/ai/text-assets/snd-mobile-1/file',
            },
            {
              id: 'snd-mobile-2',
              asset_type: 'sound',
              folder_id: 'folder-mobile-cards',
              title: 'Orbit Pulse',
              file_name: 'orbit-pulse.mp3',
              source_module: 'text',
              mime_type: 'audio/mpeg',
              size_bytes: 198400,
              preview_text: 'A brighter loop used to prove only one card animates at a time.',
              created_at: '2026-04-10T12:07:00.000Z',
              file_url: '/api/ai/text-assets/snd-mobile-2/file',
            },
            {
              id: 'vid-mobile-1',
              asset_type: 'video',
              folder_id: 'folder-mobile-cards',
              title: 'Orbit Walkthrough',
              file_name: 'orbit-walkthrough.mp4',
              source_module: 'video',
              mime_type: 'video/mp4',
              size_bytes: 4096000,
              preview_text: 'This video description should stay hidden on the mobile card.',
              created_at: '2026-04-10T12:08:00.000Z',
              file_url: '/api/ai/text-assets/vid-mobile-1/file',
            },
          ],
        },
      },
    });

    await page.goto('/account/image-studio.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#studioFolderGrid .studio__folder-card').first().click();
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(4);
    await expect(page.locator('#studioImageGrid .studio__asset-open')).toHaveCount(0);

    const textCardColor = await page.locator('#studioImageGrid [data-asset-id="txt-mobile-1"]').evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    const soundCardColor = await page.locator('#studioImageGrid [data-asset-id="snd-mobile-1"]').evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    const videoCardColor = await page.locator('#studioImageGrid [data-asset-id="vid-mobile-1"]').evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    expect(getCssColorAlpha(textCardColor)).toBeGreaterThan(0.9);
    expect(getCssColorAlpha(soundCardColor)).toBeGreaterThan(0.9);
    expect(getCssColorAlpha(videoCardColor)).toBeGreaterThan(0.9);

    await expect(page.locator('#studioImageGrid [data-asset-id="vid-mobile-1"] .studio__asset-preview')).toHaveCount(0);
    const soundPreviewDisplay = await page.locator('#studioImageGrid [data-asset-id="snd-mobile-1"] .studio__asset-preview').evaluate(
      (node) => getComputedStyle(node).display,
    );
    expect(soundPreviewDisplay).not.toBe('none');

    const soundCardStructure = await page.locator('#studioImageGrid [data-asset-id="snd-mobile-1"]').evaluate((card) => {
      const preview = card.querySelector('.studio__asset-preview');
      const indicator = card.querySelector('.studio__asset-play-indicator');
      return {
        previewNextClass: preview?.nextElementSibling?.className || '',
        indicatorNextClass: indicator?.nextElementSibling?.className || '',
      };
    });
    expect(soundCardStructure.previewNextClass).toContain('studio__asset-play-indicator');
    expect(soundCardStructure.indicatorNextClass).toContain('studio__asset-audio');

    const mobileVideoLayout = await page.locator('#studioImageGrid [data-asset-id="vid-mobile-1"]').evaluate((card) => {
      const title = card.querySelector('.studio__asset-title')?.getBoundingClientRect();
      const trigger = card.querySelector('.studio__asset-video-trigger')?.getBoundingClientRect();
      return {
        titleBottom: title?.bottom ?? 0,
        triggerTop: trigger?.top ?? 0,
      };
    });
    expect(mobileVideoLayout.titleBottom).toBeLessThanOrEqual(mobileVideoLayout.triggerTop + 1);

    const originalUrl = page.url();
    await page.locator('#studioImageGrid [data-asset-id="vid-mobile-1"] .studio__asset-title').click();
    await expectStudioModalClosed(page);
    await expect.poll(() => page.url()).toBe(originalUrl);

    await page.locator('#studioImageGrid [data-asset-id="vid-mobile-1"] .studio__asset-video-trigger').click();
    await expect(page.locator('#studioImageModal')).toHaveClass(/active/);
    await expect(page.locator('#studioImageModal .studio-modal__video')).toHaveAttribute(
      'src',
      /\/api\/ai\/text-assets\/vid-mobile-1\/file$/,
    );
    await expect.poll(() => page.url()).toBe(originalUrl);
    await expect.poll(() => page.evaluate(() => window.__studioOpenCalls.length)).toBe(0);
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    await page.locator('#studioImageModal .modal-close').click();

    await page.locator('#studioImageGrid [data-asset-id="txt-mobile-1"]').evaluate((node) => node.click());
    await expect.poll(() => page.evaluate(() => window.__studioOpenCalls.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__studioOpenCalls[0]?.[0] || '')).toMatch(
      /\/api\/ai\/text-assets\/txt-mobile-1\/file$/,
    );

    await page.locator('#studioImageGrid [data-asset-id="snd-mobile-2"] .studio__asset-title').evaluate((node) => node.click());
    await expect.poll(() => page.evaluate(() => window.__studioOpenCalls.length)).toBe(1);

    const firstIndicator = page.locator('#studioImageGrid [data-asset-id="snd-mobile-1"] .studio__asset-play-indicator');
    const secondIndicator = page.locator('#studioImageGrid [data-asset-id="snd-mobile-2"] .studio__asset-play-indicator');
    const firstAudio = page.locator('#studioImageGrid [data-asset-id="snd-mobile-1"] .studio__asset-audio');
    const secondAudio = page.locator('#studioImageGrid [data-asset-id="snd-mobile-2"] .studio__asset-audio');

    await expect(firstIndicator).toHaveAttribute('data-playing', 'false');
    await expect(secondIndicator).toHaveAttribute('data-playing', 'false');

    await firstAudio.evaluate((audio) => audio.dispatchEvent(new Event('play')));
    await expect(firstIndicator).toHaveAttribute('data-playing', 'true');
    await expect(secondIndicator).toHaveAttribute('data-playing', 'false');

    await secondAudio.evaluate((audio) => audio.dispatchEvent(new Event('play')));
    await expect(firstIndicator).toHaveAttribute('data-playing', 'false');
    await expect(secondIndicator).toHaveAttribute('data-playing', 'true');

    await secondAudio.evaluate((audio) => audio.dispatchEvent(new Event('pause')));
    await expect(firstIndicator).toHaveAttribute('data-playing', 'false');
    await expect(secondIndicator).toHaveAttribute('data-playing', 'false');

    await firstAudio.evaluate((audio) => audio.dispatchEvent(new Event('play')));
    await expect(firstIndicator).toHaveAttribute('data-playing', 'true');
    await expect(secondIndicator).toHaveAttribute('data-playing', 'false');

    await firstAudio.evaluate((audio) => audio.dispatchEvent(new Event('ended')));
    await expect(firstIndicator).toHaveAttribute('data-playing', 'false');
    await expect(secondIndicator).toHaveAttribute('data-playing', 'false');
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

  test('account Image Studio gates rename to exactly one selection and renames folders plus saved assets safely', async ({
    page,
  }) => {
    const folderPayload = {
      folders: [
        { id: 'folder-launches', name: 'Launches', slug: 'launches', created_at: '2026-04-10T09:00:00.000Z' },
        { id: 'folder-research', name: 'Research', slug: 'research', created_at: '2026-04-09T09:00:00.000Z' },
      ],
    };
    const assetsPayload = {
      all: [
        {
          id: 'img-rename-1',
          asset_type: 'image',
          folder_id: 'folder-launches',
          title: 'Shared Poster',
          preview_text: 'Shared Poster',
          prompt: 'Shared Poster',
          model: '@cf/black-forest-labs/flux-1-schnell',
          steps: 4,
          seed: 9,
          created_at: '2026-04-10T12:00:00.000Z',
          file_url: '/api/ai/images/img-rename-1/file',
          original_url: '/api/ai/images/img-rename-1/file',
        },
        {
          id: 'txt-rename-1',
          asset_type: 'text',
          folder_id: 'folder-launches',
          title: 'Prompt Notes',
          file_name: 'prompt-notes.txt',
          source_module: 'text',
          mime_type: 'text/plain; charset=utf-8',
          size_bytes: 320,
          preview_text: 'Notes that should keep loading after rename.',
          created_at: '2026-04-10T11:59:00.000Z',
          file_url: '/api/ai/text-assets/txt-rename-1/file',
        },
      ],
    };
    const assetStore = createSavedAssetsStore(folderPayload, assetsPayload);
    await mockAuthenticatedImageStudio(page, [], {
      folderPayload,
      assetsPayload,
      assetStore,
    });
    await page.route('**/api/ai/folders/folder-launches', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.fallback();
        return;
      }
      const body = route.request().postDataJSON();
      const renamed = assetStore.renameFolder('folder-launches', body.name);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            id: renamed.id,
            name: renamed.name,
            slug: renamed.slug,
            unchanged: false,
          },
        }),
      });
    });
    await page.route('**/api/ai/text-assets/txt-rename-1/rename', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.fallback();
        return;
      }
      const body = route.request().postDataJSON();
      const renamed = assetStore.renameAsset('txt-rename-1', body.name);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            id: renamed.id,
            title: renamed.title,
            file_name: renamed.file_name,
            unchanged: false,
          },
        }),
      });
    });

    await page.goto('/account/image-studio.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#studioSelectBtn').click();
    await expect(page.locator('#studioBulkRename')).toBeDisabled();
    await page.locator('#studioFolderGrid [data-folder-id="folder-launches"]').click();
    await expect(page.locator('#studioBulkCount')).toHaveText('1 selected');
    await expect(page.locator('#studioBulkRename')).toBeEnabled();
    await expect(page.locator('#studioBulkMove')).toBeHidden();
    await expect(page.locator('#studioBulkDelete')).toBeHidden();
    await page.locator('#studioBulkRename').click();
    await expect(page.locator('#studioRenameInput')).toHaveValue('Launches');
    await page.locator('#studioRenameInput').fill('Launch Vault');
    await page.locator('#studioRenameConfirm').click();
    await expect(page.locator('#studioGalleryMsg')).toContainText('Folder renamed.');
    await expect(page.locator('#studioFolderGrid [data-folder-id="folder-launches"] .studio__folder-card-name')).toHaveText('Launch Vault');

    await page.locator('#studioBulkCancel').click();
    await page.locator('#studioFolderGrid [data-folder-id="folder-launches"]').click();
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(2);

    await page.locator('#studioSelectBtn').click();
    await expect(page.locator('#studioBulkRename')).toBeDisabled();
    await page.locator('#studioImageGrid [data-asset-id="txt-rename-1"]').click();
    await expect(page.locator('#studioBulkCount')).toHaveText('1 selected');
    await expect(page.locator('#studioBulkRename')).toBeEnabled();
    await page.locator('#studioBulkRename').click();
    await expect(page.locator('#studioRenameInput')).toHaveValue('Prompt Notes');
    await page.locator('#studioRenameInput').fill('Release Notes');
    await page.locator('#studioRenameConfirm').click();
    await expect(page.locator('#studioGalleryMsg')).toContainText('Asset renamed.');
    await expect(page.locator('#studioImageGrid [data-asset-id="txt-rename-1"]')).toContainText('Release Notes');
    await expect(page.locator('#studioImageGrid [data-asset-id="txt-rename-1"] .studio__asset-meta')).toContainText('release-notes.txt');

    await page.locator('#studioImageGrid [data-asset-id="img-rename-1"]').click();
    await expect(page.locator('#studioBulkCount')).toHaveText('2 selected');
    await expect(page.locator('#studioBulkRename')).toBeDisabled();
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

  test('AI Creations favorites are completely omitted from the member favorites UI', async ({
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

    await expect(page.locator('[data-favorites-type="gallery"]')).toHaveCount(0);
    await expect(page.locator('[data-fav-key="gallery:bad-gallery"]')).toHaveCount(0);
    await expect(page.locator('[data-fav-key="gallery:good-gallery"]')).toHaveCount(0);
    await expect(page.locator('.profile__favorites')).not.toContainText('AI Creations');
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

  test('mempics and video favorites render in the profile sidebar and open the matching viewer surfaces', async ({
    page,
  }) => {
    const mempicVersion = 'vpubmempic';
    const memvidVersion = 'vpubmemvid';

    await page.route(/\/api\/gallery\/mempics\/[^/]+(?:\/[^/]+)?\/(thumb|medium|file)$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
      });
    });

    await page.route('**/api/gallery/memvids/**', async (route) => {
      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from('mock-video'),
      });
    });

    await mockAuthenticatedProfile(page, {
      role: 'user',
      favoritesPayload: [
        {
          item_type: 'mempics',
          item_id: 'a1b2c3d4',
          title: 'Mempics',
          thumb_url: `/api/gallery/mempics/a1b2c3d4/${mempicVersion}/thumb`,
          created_at: '2026-04-10T12:00:00.000Z',
        },
        {
          item_type: 'video',
          item_id: 'bada55e1',
          title: 'Launch Walkthrough',
          thumb_url: `/api/gallery/memvids/bada55e1/${memvidVersion}/poster`,
          created_at: '2026-04-10T11:59:00.000Z',
        },
      ],
    });

    const response = await page.goto('/account/profile.html');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('.profile__favorites')).not.toContainText('AI Creations');
    await expect(page.locator('[data-favorites-type="video"] .favorites__group-label')).toHaveText('Memvids');
    await expect(page.locator('[data-favorites-type="mempics"] [data-fav-key="mempics:a1b2c3d4"] img')).toHaveAttribute('src', new RegExp(`/api/gallery/mempics/a1b2c3d4/${mempicVersion}/thumb$`));
    await expect(page.locator('[data-favorites-type="video"] [data-fav-key="video:bada55e1"] img')).toHaveAttribute('src', new RegExp(`/api/gallery/memvids/bada55e1/${memvidVersion}/poster$`));

    await page.locator('[data-fav-key="mempics:a1b2c3d4"]').click();
    await expect(page.locator('#favViewer .fav-viewer__image img')).toHaveAttribute('src', new RegExp(`/api/gallery/mempics/a1b2c3d4/${mempicVersion}/medium$`));
    await expect(page.locator('#favViewer .fav-viewer__full-link')).toHaveAttribute('href', new RegExp(`/api/gallery/mempics/a1b2c3d4/${mempicVersion}/file$`));
    await page.locator('#favViewerClose').click();

    await page.locator('[data-fav-key="video:bada55e1"]').click();
    await expect(page.locator('#favViewer .fav-viewer__image video')).toHaveAttribute('src', new RegExp(`/api/gallery/memvids/bada55e1/${memvidVersion}/file$`));
    await expect(page.locator('#favViewer .fav-viewer__title')).toHaveText('Launch Walkthrough');

    await page.locator('#favViewer .fav-viewer__fav-star').click();
    await expect(page.locator('[data-fav-key="video:bada55e1"]')).toHaveCount(0);
    await expect(page.locator('[data-fav-key="mempics:a1b2c3d4"]')).toHaveCount(1);
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

  test('non-admin profile shows only Studio and Wallet cards in the profile action stack', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, { role: 'user' });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#profileStudioCard')).toBeVisible();
    await expect(page.locator('#profileWalletCard')).toBeVisible();
    await expect(page.locator('#profileStudioCard')).toContainText('AI Studio');
    await expect(page.locator('#profileAdminAiLabCard')).toHaveCount(0);
    await expect(page.locator('#profileCreditsCard')).toHaveCount(0);
    await expect(page.locator('#profileOrganizationCard')).toHaveCount(0);
    await expect(page.locator('#profileAiLabView')).toHaveCount(0);
  });

  test('admin profile shows the same simplified Studio + Wallet stack as non-admin users', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, { role: 'admin', includeProfileAccountId: false });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#profileStudioCard')).toBeVisible();
    await expect(page.locator('#profileWalletCard')).toBeVisible();
    await expect(page.locator('#profileStudioCard')).toContainText('AI Studio');
    await expect(page.locator('#profileWalletCard')).toContainText('Wallet');
    await expect(page.locator('#profileAdminAiLabCard')).toHaveCount(0);
    await expect(page.locator('#profileCreditsCard')).toHaveCount(0);
    await expect(page.locator('#profileOrganizationCard')).toHaveCount(0);
    await expect(page.locator('#profileAiLabView')).toHaveCount(0);
    await expect(page.locator('#profileMobileAiLabLink')).toHaveCount(0);
    await expect(page.locator('#profileCreditsLink')).toHaveCount(0);
    await expect(page.locator('#profileOrganizationLink')).toHaveCount(0);
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
    await expect(page.locator('.auth-nav__mobile-pricing')).toBeVisible();
    await expect(page.locator('.auth-nav__mobile-admin')).toBeVisible();
    await expect(page.locator('.auth-nav__mobile-logout')).toBeVisible();
    await expect(page.locator('.auth-nav__mobile-profile')).toHaveCount(0);

    const mobileAccountOrder = await page.locator('.auth-nav__mobile-account').evaluate((node) =>
      Array.from(node.children).map((child) => child.className),
    );
    expect(mobileAccountOrder).toEqual([
      'auth-nav__mobile-identity',
      'auth-nav__mobile-pricing',
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

  test('admin mobile profile shows the same simplified tab bar as non-admin users', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, { role: 'admin' });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#profileTabBar')).toBeVisible();
    await expect(page.locator('#profileWalletWorkspaceBtn')).toBeVisible();
    await expect(page.locator('#profileTabBar .profile-tab-link:visible')).toHaveText(['Wallet', 'Studio']);
    await expect(page.locator('#profileMobileAiLabLink')).toHaveCount(0);
    await expect(page.locator('#profileAdminAiLabCard')).toHaveCount(0);
    await expect(page.locator('#profileAiLabView')).toHaveCount(0);

    const tabBarOverflow = await page.locator('#profileTabBar').evaluate(
      (node) => node.scrollWidth > node.clientWidth + 1,
    );
    expect(tabBarOverflow).toBe(false);

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasOverflow).toBe(false);
  });

  test('non-admin mobile profile keeps only Studio in the tab bar', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, { role: 'user' });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#profileTabBar')).toBeVisible();
    await expect(page.locator('#profileWalletWorkspaceBtn')).toBeVisible();
    await expect(page.locator('#profileTabBar .profile-tab-link:visible')).toHaveText(['Wallet', 'Studio']);
    await expect(page.locator('#profileMobileAiLabLink')).toHaveCount(0);
    await expect(page.locator('#profileAiLabView')).toHaveCount(0);
  });

  test('organization owner mobile profile keeps the simplified Wallet + Studio tab bar', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, {
      role: 'user',
      includeProfileAccountId: false,
      organizations: [{
        id: 'org_profile_owner_1234567890abcdef12',
        name: 'Owner Profile Org',
        slug: 'owner-profile-org',
        role: 'owner',
        status: 'active',
      }],
    });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#profileTabBar .profile-tab-link:visible')).toHaveText(['Wallet', 'Studio']);
    await expect(page.locator('#profileCreditsLink')).toHaveCount(0);
    await expect(page.locator('#profileOrganizationLink')).toHaveCount(0);
    await expect(page.locator('#profileMobileAiLabLink')).toHaveCount(0);

    const tabBarOverflow = await page.locator('#profileTabBar').evaluate(
      (node) => node.scrollWidth > node.clientWidth + 1,
    );
    expect(tabBarOverflow).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Admin Control Plane
// ---------------------------------------------------------------------------

test.describe('Admin Control Plane', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
    await mockAdminAiLab(page);
  });

  test('renders command center and major admin sections from existing APIs', async ({
    page,
  }) => {
    const captures = {};
    await mockAdminControlPlane(page, captures);

    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
        consoleErrors.push(message.text());
      }
    });

    const response = await page.goto('/admin/index.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#controlPlaneTitle')).toContainText('Operate BITBI');
    await expect(page.locator('#sectionDashboard')).toContainText('Production blocked');
    await expect(page.locator('#sectionDashboard')).toContainText('Testmode only');
    await expect(page.locator('#statTotal')).toHaveText('12');

    await expect(page.locator('a.admin-nav__link[data-section="security"]')).toBeAttached();
    await expect(page.locator('a.admin-nav__link[data-section="orgs"]')).toBeAttached();
    await expect(page.locator('a.admin-nav__link[data-section="billing"]')).toBeAttached();
    await expect(page.locator('a.admin-nav__link[data-section="billing-events"]')).toBeAttached();
    await expect(page.locator('a.admin-nav__link[data-section="ai-usage"]')).toBeAttached();
    await expect(page.locator('a.admin-nav__link[data-section="lifecycle"]')).toBeAttached();
    await expect(page.locator('a.admin-nav__link[data-section="readiness"]')).toBeAttached();

    await expect(page.locator('#controlPlaneCapabilityGrid')).toContainText('Organizations / RBAC');
    await expect(page.locator('#controlPlaneCapabilityGrid')).toContainText('Billing / Credits');
    await expect(page.locator('#controlPlaneCapabilityGrid')).toContainText('AI Usage Attempts');

    await clickAdminNavSection(page, 'security');
    await expect(page).toHaveURL(/#security$/);
    await expect(page.locator('#sectionSecurity')).toContainText('Route Policy Registry');
    await expect(page.locator('#sectionSecurity')).toContainText('Secret values');

    await clickAdminNavSection(page, 'orgs');
    await expect(page).toHaveURL(/#orgs$/);
    await expect(page.locator('#sectionOrgs')).toContainText('Control Plane Org');
    await page.getByRole('button', { name: 'Inspect' }).first().click();
    await expect(page.locator('#orgDetail')).toContainText('owner@example.com');
    await expect(page.locator('#orgDetail')).toContainText('member@example.com');

    await clickAdminNavSection(page, 'billing');
    await expect(page.locator('#sectionBilling')).toContainText('Free');
    await expect(page.locator('#sectionBilling')).toContainText('ai.text.generate');
    await page.locator('#orgBillingId').fill('org_control_1234567890');
    await page.locator('#orgBillingLookupForm').getByRole('button', { name: 'Load Billing' }).click();
    await expect(page.locator('#orgBillingDetail')).toContainText('Credit balance');
    await expect(page.locator('#orgBillingDetail')).toContainText('125');

    await page.locator('#creditGrantOrgId').fill('org_control_1234567890');
    await page.locator('#creditGrantAmount').fill('50');
    await page.locator('#creditGrantForm').getByRole('button', { name: 'Grant Credits' }).click();
    expect(captures.creditGrantRequests).toHaveLength(0);

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#creditGrantReason').fill('Support adjustment for control-plane test');
    await page.locator('#creditGrantForm').getByRole('button', { name: 'Grant Credits' }).click();
    await expect(page.locator('#creditGrantResult')).toContainText('Credit grant recorded');
    expect(captures.creditGrantRequests).toHaveLength(1);
    expect(captures.creditGrantRequests[0].idempotencyKey).toMatch(/^admin-credit-grant-/);
    expect(captures.creditGrantRequests[0].body).toEqual({
      amount: 50,
      reason: 'Support adjustment for control-plane test',
    });

    await clickAdminNavSection(page, 'billing-events');
    await expect(page.locator('#sectionBillingEvents')).toContainText('Testmode only');
    await expect(page.locator('#billingEventsList')).toContainText('checkout.session.completed');
    await page.locator('#billingEventsList').getByRole('button', { name: 'Inspect' }).click();
    await expect(page.locator('#billingEventDetail')).toContainText('grant_credits');
    await expect(page.locator('#billingEventDetail')).not.toContainText('should-not-render');
    await expect(page.locator('#billingEventDetail')).not.toContainText('stripe_signature');

    await clickAdminNavSection(page, 'ai-usage');
    await expect(page.locator('#aiAttemptsList')).toContainText('AI Text');
    await page.locator('#aiAttemptsList').getByRole('button', { name: 'Inspect' }).click();
    await expect(page.locator('#aiAttemptDetail')).toContainText('/api/ai/generate-text');
    await expect(page.locator('#aiAttemptDetail')).not.toContainText('should-not-render');
    await page.locator('#aiCleanupForm').getByRole('button', { name: 'Run Cleanup' }).click();
    await expect(page.locator('#aiCleanupResult')).toContainText('scanned 3');
    expect(captures.aiCleanupRequests).toHaveLength(1);
    expect(captures.aiCleanupRequests[0].idempotencyKey).toMatch(/^ai-usage-cleanup-/);
    expect(captures.aiCleanupRequests[0].body.dry_run).toBe(true);

    await clickAdminNavSection(page, 'lifecycle');
    await expect(page.locator('#sectionLifecycle')).toContainText('archive_generated');
    await expect(page.locator('#sectionLifecycle')).toContainText('execute-only rather than dry-run');
    await expect(page.locator('#sectionLifecycle').getByRole('button', { name: /delete|execute/i })).toHaveCount(0);

    await clickAdminNavSection(page, 'operations');
    await expect(page.locator('#sectionOperations')).toContainText('max_attempts');
    await expect(page.locator('#sectionOperations')).toContainText('provider_failed');

    await clickAdminNavSection(page, 'readiness');
    await expect(page.locator('#sectionReadiness')).toContainText('Production Status');
    await expect(page.locator('#sectionReadiness')).toContainText('Blocked');

    await clickAdminNavSection(page, 'settings');
    await expect(page.locator('#sectionSettings')).toContainText('Deployment-owned');
    await expect(page.getByRole('button', { name: /enable live|activate live|customer portal|checkout/i })).toHaveCount(0);

    const renderedText = await page.locator('#adminPanel').innerText();
    expect(renderedText).not.toContain('whsec_');
    expect(renderedText).not.toContain('Stripe-Signature');
    expect(renderedText).not.toContain('idempotencyKeyHash');
    expect(renderedText).not.toContain('requestFingerprintHash');
    expect(consoleErrors).toEqual([]);
  });

  test('keeps control-plane cards, badges, nav, and tables legible across viewports', async ({
    page,
  }) => {
    await mockAdminControlPlane(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin/index.html');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#controlPlaneCapabilityGrid .admin-control-card')).toHaveCount(7);

    const dashboardCardWidths = await page.locator('#controlPlaneCapabilityGrid .admin-control-card').evaluateAll((cards) =>
      cards.map((card) => Math.round(card.getBoundingClientRect().width)),
    );
    expect(Math.min(...dashboardCardWidths)).toBeGreaterThan(300);

    const dashboardBadgeOverlaps = await page.locator('#controlPlaneCapabilityGrid .admin-control-card__top').evaluateAll((headers) =>
      headers.filter((header) => {
        const title = header.querySelector('.admin-section-title');
        const badge = header.querySelector('.badge');
        if (!title || !badge) return false;
        const a = title.getBoundingClientRect();
        const b = badge.getBoundingClientRect();
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      }).length,
    );
    expect(dashboardBadgeOverlaps).toBe(0);

    await clickAdminNavSection(page, 'security');
    await expect(page.locator('#sectionSecurity')).toBeVisible();
    const securityLabelMetrics = await page.locator('#sectionSecurity .admin-inventory__name').evaluateAll((labels) =>
      labels.map((label) => ({
        text: label.textContent.trim(),
        width: Math.round(label.getBoundingClientRect().width),
        height: Math.round(label.getBoundingClientRect().height),
      })),
    );
    for (const metric of securityLabelMetrics.filter((item) => item.text.length >= 5)) {
      expect(metric.width).toBeGreaterThan(45);
      expect(metric.height).toBeLessThan(40);
    }

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/admin/index.html#readiness');
    await expect(page.locator('#sectionReadiness')).toBeVisible({ timeout: 10_000 });
    const readinessNav = page.locator('a.admin-nav__link[data-section="readiness"]');
    await readinessNav.scrollIntoViewIfNeeded();
    await expect(readinessNav).toBeVisible();
    await readinessNav.click();
    await expect(page.locator('#sectionReadiness')).toContainText('Production Status');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/index.html#orgs');
    await expect(page.locator('#sectionOrgs')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#orgsList .admin-table-wrap')).toBeVisible();
    const mobileHasDocumentOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(mobileHasDocumentOverflow).toBe(false);
  });

  test('shows unavailable states when a backend capability is absent', async ({
    page,
  }) => {
    await page.route('**/api/admin/orgs?*', async (route) => {
      await fulfillJson(route, { ok: false, error: 'Not found' }, 404);
    });
    await page.route('**/api/admin/orgs', async (route) => {
      await fulfillJson(route, { ok: false, error: 'Not found' }, 404);
    });

    const response = await page.goto('/admin/index.html#orgs');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sectionOrgs')).toBeVisible();
    await expect(page.locator('#orgsList')).toContainText('Capability unavailable');
  });

  test('renders fail-closed backend states without fake success', async ({
    page,
  }) => {
    await page.route('**/api/admin/ai/usage-attempts?*', async (route) => {
      await fulfillJson(route, { ok: false, error: 'Limiter backend unavailable' }, 503);
    });
    await page.route('**/api/admin/ai/usage-attempts', async (route) => {
      await fulfillJson(route, { ok: false, error: 'Limiter backend unavailable' }, 503);
    });

    const response = await page.goto('/admin/index.html#ai-usage');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sectionAiUsage')).toBeVisible();
    await expect(page.locator('#aiAttemptsList')).toContainText('Backend dependency is unavailable or fail-closed');
    await expect(page.locator('#aiAttemptsList')).not.toContainText('Showing 1 sanitized attempts');
  });
});

// ---------------------------------------------------------------------------
// Admin nav accordion: cold-deep-link auto-expand vs. click-to-collapse
// ---------------------------------------------------------------------------

test.describe('Admin nav accordion behavior', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
    await mockAdminAiLab(page);
  });

  test('cold load with no hash auto-expands only the Overview group', async ({ page }) => {
    await page.goto('/admin/index.html');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    const overviewToggle = page.locator('.admin-nav__group:has(a[data-section="dashboard"]) > .admin-nav__group-toggle');
    const usersToggle = page.locator('.admin-nav__group:has(a[data-section="users"]) > .admin-nav__group-toggle');
    const aiToggle = page.locator('.admin-nav__group:has(a[data-section="ai-lab"]) > .admin-nav__group-toggle');
    const systemToggle = page.locator('.admin-nav__group:has(a[data-section="settings"]) > .admin-nav__group-toggle');

    await expect(overviewToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(usersToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(aiToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(systemToggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('cold deep link to #ai-lab auto-expands the AI group on load', async ({ page }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sectionAiLab')).toBeVisible();

    const aiGroup = page.locator('.admin-nav__group:has(a[data-section="ai-lab"])');
    const aiToggle = aiGroup.locator('> .admin-nav__group-toggle');
    await expect(aiToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(aiGroup).toHaveClass(/admin-nav__group--expanded/);
    await expect(aiGroup).toHaveClass(/admin-nav__group--active/);
  });

  test('cold deep link to #settings auto-expands the System group on load', async ({ page }) => {
    await page.goto('/admin/index.html#settings');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sectionSettings')).toBeVisible();

    const systemGroup = page.locator('.admin-nav__group:has(a[data-section="settings"])');
    const systemToggle = systemGroup.locator('> .admin-nav__group-toggle');
    await expect(systemToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(systemGroup).toHaveClass(/admin-nav__group--expanded/);
    await expect(systemGroup).toHaveClass(/admin-nav__group--active/);
  });

  test('clicking a child link collapses its parent group while keeping the active highlight', async ({ page }) => {
    await page.goto('/admin/index.html#dashboard');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    // ── AI: open heading manually, then click AI Lab child link ──
    const aiGroup = page.locator('.admin-nav__group:has(a[data-section="ai-lab"])');
    const aiToggle = aiGroup.locator('> .admin-nav__group-toggle');
    const aiLabLink = aiGroup.locator('a[data-section="ai-lab"]');

    await expect(aiToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(aiGroup).not.toHaveClass(/admin-nav__group--active/);

    await aiToggle.click();
    await expect(aiToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(aiGroup).toHaveClass(/admin-nav__group--expanded/);

    await aiLabLink.click();
    // Wait for navigation to settle: URL hash, visible section, and active link.
    await expect(page).toHaveURL(/#ai-lab$/);
    await expect(page.locator('#sectionAiLab')).toBeVisible();
    await expect(aiLabLink).toHaveClass(/admin-nav__link--active/);

    // After navigation settles, the parent group must be collapsed even
    // though it remains the active group.
    await expect(aiToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(aiGroup).not.toHaveClass(/admin-nav__group--expanded/);
    await expect(aiGroup).toHaveClass(/admin-nav__group--active/);

    // ── Users: open heading, click Users child link ──
    const usersGroup = page.locator('.admin-nav__group:has(a[data-section="users"])');
    const usersToggle = usersGroup.locator('> .admin-nav__group-toggle');
    const usersLink = usersGroup.locator('a[data-section="users"]');

    await usersToggle.click();
    await expect(usersToggle).toHaveAttribute('aria-expanded', 'true');

    await usersLink.click();
    await expect(page).toHaveURL(/#users$/);
    await expect(page.locator('#sectionUsers')).toBeVisible();
    await expect(usersLink).toHaveClass(/admin-nav__link--active/);

    await expect(usersToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(usersGroup).not.toHaveClass(/admin-nav__group--expanded/);
    await expect(usersGroup).toHaveClass(/admin-nav__group--active/);

    // AI is no longer the active group.
    await expect(aiGroup).not.toHaveClass(/admin-nav__group--active/);

    // ── System: open heading, click Settings child link ──
    const systemGroup = page.locator('.admin-nav__group:has(a[data-section="settings"])');
    const systemToggle = systemGroup.locator('> .admin-nav__group-toggle');
    const settingsLink = systemGroup.locator('a[data-section="settings"]');

    await systemToggle.click();
    await expect(systemToggle).toHaveAttribute('aria-expanded', 'true');

    await settingsLink.click();
    await expect(page).toHaveURL(/#settings$/);
    await expect(page.locator('#sectionSettings')).toBeVisible();
    await expect(settingsLink).toHaveClass(/admin-nav__link--active/);

    await expect(systemToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(systemGroup).not.toHaveClass(/admin-nav__group--expanded/);
    await expect(systemGroup).toHaveClass(/admin-nav__group--active/);

    // Users is no longer the active group.
    await expect(usersGroup).not.toHaveClass(/admin-nav__group--active/);
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

    await clickAiLabMode(page, 'text');
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

    await clickAiLabMode(page, 'image');
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

    await clickAiLabMode(page, 'embeddings');
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

    await clickAiLabMode(page, 'compare');
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

    await clickAiLabMode(page, 'music');
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

    await clickAdminNavSection(page, 'dashboard');
    await expect(page.locator('#adminHeroTitle')).toHaveText('Command Center');
    await expect(page.locator('#statTotal')).toHaveText('12');
  });

  test('shows admin image-test credit labels only inside AI Lab image controls', async ({ page }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await clickAiLabMode(page, 'image');

    await expect(page.locator('#aiImageRun')).toHaveText('Run image test · 1 credit');
    await expect(page.locator('#aiImageOrganization')).toBeVisible();
    await expect(page.locator('#aiImageOrganizationState')).toContainText('Selected organization: Admin Image Billing Org');
    await expect(page.locator('#aiImageOrganizationState')).toContainText('charges 1 credit');

    await page.selectOption('#aiImageModel', '@cf/black-forest-labs/flux-2-klein-9b');
    await expect(page.locator('#aiImageRun')).toHaveText('Run image test · 10 credits');
    await expect(page.locator('#aiImageOrganizationState')).toContainText('charges 10 credits');

    await page.selectOption('#aiImageModel', '@cf/black-forest-labs/flux-2-dev');
    await expect(page.locator('#aiImageRun')).toHaveText('Run Image Test');
  });

  test('blocks charged admin image tests until a platform admin selects an organization', async ({ page }) => {
    const imageTestRequests = [];
    await page.unroute('**/api/admin/orgs**');
    await page.unroute('**/api/admin/ai/test-image');
    await mockAdminAiLab(page, {
      imageTestRequests,
      adminOrganizations: [
        {
          id: 'org_11111111111111111111111111111111',
          name: 'First Billing Org',
          slug: 'first-billing-org',
          status: 'active',
        },
        {
          id: 'org_22222222222222222222222222222222',
          name: 'Second Billing Org',
          slug: 'second-billing-org',
          status: 'active',
        },
      ],
    });
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await clickAiLabMode(page, 'image');
    await expect(page.locator('#aiImageOrganizationState')).toContainText('Select an organization before running this charged image test.');

    await page.locator('#aiImageRun').click();
    await expect(page.locator('#aiImageState')).toContainText('Select an organization before running this charged image test.');
    expect(imageTestRequests).toHaveLength(0);

    await page.selectOption('#aiImageOrganization', 'org_11111111111111111111111111111111');
    await expect(page.locator('#aiImageOrganizationState')).toContainText('Selected organization: First Billing Org');
    await page.locator('#aiImageRun').click();
    await expect(page.locator('#aiImageState')).toContainText('Image response ready.');
    expect(imageTestRequests).toHaveLength(1);
    expect(imageTestRequests[0].organization_id).toBe('org_11111111111111111111111111111111');
    await expect(page.locator('#aiImageMeta')).toContainText('Charged Org');
    await expect(page.locator('#aiImageMeta')).toContainText('First Billing Org');
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

    await clickAiLabMode(page, 'music');
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
    await expect(page.locator('#aiMusicSave')).toBeHidden();
    await expect(page.locator('#aiMusicPreview')).toContainText(
      'Server-side save is disabled for security',
    );
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

    await clickAiLabMode(page, 'image');
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

    await clickAiLabMode(page, 'image');
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

    await clickAiLabMode(page, 'text');
    await page.locator('#aiTextPrompt').fill('Save this text output');
    await page.locator('#aiTextRun').click();
    await page.locator('#aiTextSave').click();
    await expect(page.locator('#aiLabSaveModal')).toBeVisible();
    await page.selectOption('#aiLabSaveFolder', 'folder-launches');
    await page.locator('#aiLabSaveConfirm').click();
    await expect(page.locator('#aiLabSaveModal')).toBeHidden();

    await clickAiLabMode(page, 'embeddings');
    await page.locator('#aiEmbeddingsInput').fill('first vector\nsecond vector');
    await page.locator('#aiEmbeddingsRun').click();
    await page.locator('#aiEmbeddingsSave').click();
    await page.locator('#aiLabSaveInput').fill('Embedding Snapshot');
    await page.selectOption('#aiLabSaveFolder', 'folder-research');
    await page.locator('#aiLabSaveConfirm').click();

    await clickAiLabMode(page, 'compare');
    await page.locator('#aiCompareRun').click();
    await page.locator('#aiCompareSave').click();
    await page.locator('#aiLabSaveInput').fill('Compare Session');
    await page.selectOption('#aiLabSaveFolder', 'folder-launches');
    await page.locator('#aiLabSaveConfirm').click();

    await clickAiLabMode(page, 'live-agent');
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

    await clickAiLabMode(page, 'video');
    await page.locator('#aiVideoPrompt').fill('Save this video output');
    await page.locator('#aiVideoRun').click();
    await expect(page.locator('#aiVideoSave')).toBeHidden();
    await expect(page.locator('#aiVideoPreview')).toContainText(
      'protected async job output',
    );

    expect(saveTextAssetRequests).toHaveLength(4);
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
    await expect(page.locator('#aiVideoPreview')).toContainText(
      'protected async job output',
    );
  });

  test('saves AI Lab image results by reference instead of re-uploading full image data on the normal path', async ({
    page,
  }) => {
    const saveImageRequests = [];
    await page.unroute('**/api/admin/ai/test-image');
    await page.route('**/api/admin/ai/test-image', async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          task: 'image',
          model: {
            id: '@cf/black-forest-labs/flux-1-schnell',
            task: 'image',
            label: 'FLUX.1 Schnell',
            vendor: 'Black Forest Labs',
          },
          preset: body.preset || 'image_fast',
          result: {
            imageBase64: ONE_PX_PNG_BASE64,
            saveReference: 'admin-lab-save-reference',
            mimeType: 'image/png',
            steps: body.steps ?? 4,
            seed: body.seed ?? 12345,
            requestedSize:
              body.width && body.height
                ? { width: body.width, height: body.height }
                : null,
            appliedSize: null,
          },
          elapsedMs: 456,
          warnings: ['Mock image warning'],
        }),
      });
    });
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

    await clickAiLabMode(page, 'image');
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
      save_reference: 'admin-lab-save-reference',
    }));
    expect(saveImageRequests[0].imageData).toBeUndefined();
  });

  test('falls back to the legacy image upload path when an AI Lab save reference expires', async ({
    page,
  }) => {
    const saveImageRequests = [];
    await page.unroute('**/api/admin/ai/test-image');
    await page.route('**/api/admin/ai/test-image', async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          task: 'image',
          model: {
            id: '@cf/black-forest-labs/flux-1-schnell',
            task: 'image',
            label: 'FLUX.1 Schnell',
            vendor: 'Black Forest Labs',
          },
          preset: body.preset || 'image_fast',
          result: {
            imageBase64: ONE_PX_PNG_BASE64,
            saveReference: 'expired-admin-lab-save-reference',
            mimeType: 'image/png',
            steps: body.steps ?? 4,
            seed: body.seed ?? 12345,
            requestedSize:
              body.width && body.height
                ? { width: body.width, height: body.height }
                : null,
            appliedSize: null,
          },
          elapsedMs: 456,
          warnings: ['Mock image warning'],
        }),
      });
    });
    await page.unroute('**/api/ai/images/save');
    await page.route('**/api/ai/images/save', async (route) => {
      const body = route.request().postDataJSON();
      saveImageRequests.push(body);
      if (body.save_reference) {
        await route.fulfill({
          status: 410,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            code: 'SAVE_REFERENCE_EXPIRED',
            error: 'Generated image reference expired. Please generate the image again.',
          }),
        });
        return;
      }
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

    await clickAiLabMode(page, 'image');
    await page.locator('#aiImagePrompt').fill('Fallback AI Lab image save');
    await page.locator('#aiImageRun').click();
    await page.locator('#aiImageSave').click();
    await expect(page.locator('#aiLabSaveTitleField')).toBeHidden();
    await page.selectOption('#aiLabSaveFolder', 'folder-launches');
    await page.locator('#aiLabSaveConfirm').click();
    await expect(page.locator('#aiLabSaveModal')).toBeHidden();

    expect(saveImageRequests).toHaveLength(2);
    expect(saveImageRequests[0]).toEqual(expect.objectContaining({
      folder_id: 'folder-launches',
      prompt: 'Fallback AI Lab image save',
      save_reference: 'expired-admin-lab-save-reference',
    }));
    expect(saveImageRequests[0].imageData).toBeUndefined();
    expect(saveImageRequests[1]).toEqual(expect.objectContaining({
      folder_id: 'folder-launches',
      prompt: 'Fallback AI Lab image save',
      model: '@cf/black-forest-labs/flux-1-schnell',
      steps: 4,
      seed: 12345,
    }));
    expect(saveImageRequests[1].save_reference).toBeUndefined();
    expect(saveImageRequests[1].imageData).toMatch(/^data:image\/png;base64,/);
  });

  test('persists last-used form values and surfaces backend errors', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#aiModelsText')).toContainText('GPT OSS 20B');

    await clickAiLabMode(page, 'text');
    await page.locator('#aiTextPrompt').fill('Persist me');
    await page.locator('#aiTextRun').click();
    await expect(page.locator('#aiTextOutput')).toContainText(
      'Mocked text output from admin AI Lab.',
    );
    await page.reload();

    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await clickAiLabMode(page, 'text');
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

    await clickAiLabMode(page, 'text');
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

    await clickAiLabMode(page, 'compare');
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
    await clickAiLabMode(page, 'compare');
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

    await clickAiLabMode(page, 'compare');
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

    await clickAiLabMode(page, 'text');
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

    await clickAiLabMode(page, 'text');
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

    await clickAiLabMode(page, 'image');
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

    await clickAiLabMode(page, 'embeddings');
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

    await clickAiLabMode(page, 'compare');
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

    await clickAiLabMode(page, 'video');
    await page.unroute('**/api/admin/ai/video-jobs');
    await page.route('**/api/admin/ai/video-jobs', async (route) => {
      const body = route.request().postDataJSON();
      await wait(700);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          existing: false,
          job: {
            jobId: 'slow-video-job',
            status: 'succeeded',
            provider: 'workers-ai',
            model: catalog.models.video[0].id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            statusUrl: '/api/admin/ai/video-jobs/slow-video-job',
            outputUrl: 'https://example.com/slow-generated-video.mp4',
          },
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

    await clickAiLabMode(page, 'video');
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

  test('shows the Vidu Q3 Pro video card in the admin AI Lab', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await clickAiLabMode(page, 'video');
    await expect(page.locator('#aiVideoCardPixverse')).toBeVisible();
    await expect(page.locator('#aiVideoCardVidu')).toBeVisible();
    await expect(page.locator('#aiVideoCardVidu')).toContainText('vidu/q3-pro');
  });

  test('Vidu Q3 Pro sends supported text-to-video and start/end-frame payloads and renders the shared video preview', async ({
    page,
  }) => {
    const catalog = createMockAiCatalog();
    const viduModel = catalog.models.video.find((entry) => entry.id === 'vidu/q3-pro');
    const requests = [];
    let syncVideoCalls = 0;

    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.unroute('**/api/admin/ai/test-video');
    await page.route('**/api/admin/ai/test-video', async (route) => {
      syncVideoCalls += 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'sync video route should not be used' }),
      });
    });
    await page.unroute('**/api/admin/ai/video-jobs');
    await page.route('**/api/admin/ai/video-jobs', async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      const workflow = body.end_image ? 'start_end_to_video' : body.start_image ? 'image_to_video' : 'text_to_video';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          existing: false,
          job: {
            jobId: `vidu-job-${requests.length}`,
            status: 'succeeded',
            provider: 'vidu',
            model: viduModel.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            statusUrl: `/api/admin/ai/video-jobs/vidu-job-${requests.length}`,
            outputUrl: 'https://example.com/generated-video.mp4',
            _workflow: workflow,
          },
        }),
      });
    });

    await clickAiLabMode(page, 'video');
    await page.locator('#aiVideoCardVidu').click();
    await expect(page.locator('#aiVideoModelBadge')).toContainText('vidu/q3-pro');
    await expect(page.locator('#aiVideoNegativePromptField')).toBeHidden();
    await expect(page.locator('#aiVideoStartImageField')).toBeVisible();
    await expect(page.locator('#aiVideoEndImageField')).toBeVisible();
    await expect(page.locator('#aiVideoResolutionField')).toBeVisible();
    await expect(page.locator('#aiVideoSeedField')).toBeHidden();

    await page.locator('#aiVideoPrompt').fill('Vertical neon city');
    await page.selectOption('#aiVideoAspectRatio', '9:16');
    await page.selectOption('#aiVideoResolution', '1080p');
    await page.locator('#aiVideoGenerateAudio').uncheck();
    await page.locator('#aiVideoRun').click();

    await expect(page.locator('#aiVideoPreview video')).toHaveCount(1);
    await expect(page.locator('#aiVideoMeta')).toContainText('Resolution');
    await expect(page.locator('#aiVideoMeta')).toContainText('Text-to-Video');

    expect(requests[0]).toMatchObject({
      preset: 'video_vidu_q3_pro',
      model: 'vidu/q3-pro',
      prompt: 'Vertical neon city',
      duration: 5,
      aspect_ratio: '9:16',
      resolution: '1080p',
      audio: false,
    });
    expect(requests[0].quality).toBeUndefined();
    expect(requests[0].seed).toBeUndefined();
    expect(requests[0].negative_prompt).toBeUndefined();

    await page.locator('#aiVideoPrompt').fill('');
    await page.locator('#aiVideoStartImageFile').setInputFiles({
      name: 'vidu-start.png',
      mimeType: 'image/png',
      buffer: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
    });
    await expect(page.locator('#aiVideoStartImagePreview')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('#aiVideoAspectRatio')).toBeDisabled();

    await page.locator('#aiVideoEndImageFile').setInputFiles({
      name: 'vidu-end.png',
      mimeType: 'image/png',
      buffer: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
    });
    await expect(page.locator('#aiVideoEndImagePreview')).toHaveAttribute('data-state', 'ready');
    await page.locator('#aiVideoRun').click();

    await expect(page.locator('#aiVideoMeta')).toContainText('Start/End-Frame-to-Video');
    expect(requests[1]).toMatchObject({
      preset: 'video_vidu_q3_pro',
      model: 'vidu/q3-pro',
      duration: 5,
      resolution: '1080p',
      audio: false,
    });
    expect(requests[1].prompt).toBeUndefined();
    expect(requests[1].start_image).toMatch(/^data:image\/png;base64,/);
    expect(requests[1].end_image).toMatch(/^data:image\/png;base64,/);
    expect(requests[1].aspect_ratio).toBeUndefined();
    expect(requests[1].quality).toBeUndefined();
    expect(requests[1].seed).toBeUndefined();
    expect(syncVideoCalls).toBe(0);
  });

  test('Vidu minimal mode exposes the checkbox and sends minimal_mode without logging raw video payloads', async ({
    page,
  }) => {
    const catalog = createMockAiCatalog();
    const viduModel = catalog.models.video.find((entry) => entry.id === 'vidu/q3-pro');
    const requests = [];
    const consoleMessages = [];

    page.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.unroute('**/api/admin/ai/video-jobs');
    await page.route('**/api/admin/ai/video-jobs', async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          existing: false,
          job: {
            jobId: 'vidu-minimal-job',
            status: 'succeeded',
            provider: 'vidu',
            model: viduModel.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            statusUrl: '/api/admin/ai/video-jobs/vidu-minimal-job',
            outputUrl: 'https://example.com/generated-video.mp4',
          },
        }),
      });
    });

    await clickAiLabMode(page, 'video');
    await page.locator('#aiVideoCardVidu').click();

    await expect(page.locator('#aiVideoMinimalMode')).toBeVisible();
    await expect(page.locator('label:has(#aiVideoMinimalMode)')).toContainText('Force Minimal Mode');
    await expect(page.locator('#aiVideoMinimalModeHint')).toBeHidden();

    await page.locator('#aiVideoPrompt').fill('Minimal mode deploy verification');
    await page.locator('#aiVideoMinimalMode').check();
    await expect(page.locator('#aiVideoMinimalModeHint')).toBeVisible();
    await expect(page.locator('#aiVideoMinimalModeHint')).toContainText(
      'backend will replace the payload with a fixed Vidu prompt + duration + resolution payload.'
    );
    await page.locator('#aiVideoRun').click();

    await expect(page.locator('#aiVideoPreview video')).toHaveCount(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      preset: 'video_vidu_q3_pro',
      model: 'vidu/q3-pro',
      prompt: 'Minimal mode deploy verification',
      duration: 5,
      aspect_ratio: '16:9',
      resolution: '720p',
      audio: true,
      minimal_mode: true,
    });
    expect(
      consoleMessages.some((message) => message.includes('[AI Lab] video-job outgoing payload'))
    ).toBe(false);
    expect(
      consoleMessages.some((message) => message.includes('Minimal mode deploy verification'))
    ).toBe(false);
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
    await clickAiLabMode(page, 'live-agent');
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
    await clickAiLabMode(page, 'music');
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
    await clickAiLabMode(page, 'live-agent');
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
    await clickAiLabMode(page, 'live-agent');
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
    await clickAiLabMode(page, 'live-agent');

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
    await clickAiLabMode(page, 'image');
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
    await clickAiLabMode(page, 'image');
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
