const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const ONE_PX_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';
const ASSET_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;
const TEST_MP4_BYTES = fs.readFileSync(path.join(__dirname, 'fixtures/media/test-video.mp4'));
const RELEASE_COMPAT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config/release-compat.json'), 'utf8'));
const CURRENT_AUTH_MIGRATION = RELEASE_COMPAT.release.schemaCheckpoints.auth.latest;
const MOBILE_CHROME_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1';

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

async function fulfillTestMp4(route, bytes = TEST_MP4_BYTES) {
  const rangeHeader = route.request().headers().range || '';
  const rangeMatch = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
  const headers = {
    'Accept-Ranges': 'bytes',
    'Content-Type': 'video/mp4',
    'Content-Disposition': 'inline; filename="pixverse-preview.mp4"',
  };

  if (rangeMatch) {
    const start = Number.parseInt(rangeMatch[1], 10);
    const requestedEnd = rangeMatch[2] ? Number.parseInt(rangeMatch[2], 10) : bytes.length - 1;
    const end = Math.min(requestedEnd, bytes.length - 1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= bytes.length) {
      await route.fulfill({
        status: 416,
        headers: {
          ...headers,
          'Content-Range': `bytes */${bytes.length}`,
        },
        body: Buffer.alloc(0),
      });
      return;
    }
    const body = bytes.subarray(start, end + 1);
    await route.fulfill({
      status: 206,
      headers: {
        ...headers,
        'Content-Length': String(body.length),
        'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
      },
      body,
    });
    return;
  }

  await route.fulfill({
    status: 200,
    headers: {
      ...headers,
      'Content-Length': String(bytes.length),
    },
    body: bytes,
  });
}

async function waitForVideoMediaState(videoLocator) {
  return videoLocator.evaluate((video) => new Promise((resolve) => {
    const events = [];
    const watchedEvents = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'error', 'stalled', 'suspend', 'abort'];
    let timeoutId = 0;

    const snapshot = () => ({
      events,
      currentSrc: video.currentSrc,
      src: video.getAttribute('src') || '',
      controls: video.controls,
      playsInline: video.playsInline,
      playsInlineAttr: video.getAttribute('playsinline'),
      webkitPlaysInlineAttr: video.getAttribute('webkit-playsinline'),
      preload: video.preload,
      poster: video.getAttribute('poster') || '',
      readyState: video.readyState,
      networkState: video.networkState,
      error: video.error ? {
        code: video.error.code,
        message: video.error.message || '',
      } : null,
    });

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      watchedEvents.forEach((eventName) => video.removeEventListener(eventName, onEvent));
    };

    const finish = () => {
      cleanup();
      resolve(snapshot());
    };

    function onEvent(event) {
      events.push(event.type);
      if (event.type === 'loadedmetadata' || event.type === 'canplay' || event.type === 'error') {
        finish();
      }
    }

    watchedEvents.forEach((eventName) => video.addEventListener(eventName, onEvent));
    timeoutId = window.setTimeout(finish, 6000);

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA || video.error) {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        events.push('already-have-metadata');
      }
      finish();
      return;
    }
    video.load();
  }));
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

  function storageUsage() {
    const hasAssets = assetMap.size > 0;
    const fallback = folderPayload.storageUsage || null;
    const isUnlimited = fallback?.isUnlimited === true;
    const limitBytes = isUnlimited
      ? null
      : (Number(fallback?.limitBytes) > 0
        ? Number(fallback.limitBytes)
        : ASSET_STORAGE_LIMIT_BYTES);
    const usedBytes = hasAssets
      ? Array.from(assetMap.values()).reduce((sum, asset) => (
        sum + Number(asset.size_bytes || 0) + Number(asset.poster_size_bytes || 0)
      ), 0)
      : Number(fallback?.usedBytes || 0);
    return {
      usedBytes,
      limitBytes,
      remainingBytes: isUnlimited ? null : Math.max(0, limitBytes - usedBytes),
      isUnlimited,
    };
  }

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
        storageUsage: storageUsage(),
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
        storageUsage: storageUsage(),
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
    setAssetVisibility(id, visibility) {
      const asset = assetMap.get(id);
      if (!asset || !['image', 'sound', 'audio', 'video'].includes(String(asset.asset_type || ''))) return null;
      asset.visibility = visibility;
      asset.is_public = visibility === 'public';
      asset.published_at = visibility === 'public'
        ? (asset.published_at || '2026-04-12T12:00:00.000Z')
        : null;
      return cloneJson(asset);
    },
    setImageVisibility(id, visibility) {
      const asset = assetMap.get(id);
      if (!asset || asset.asset_type !== 'image') return null;
      return this.setAssetVisibility(id, visibility);
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
      {
        name: 'video_happyhorse_1_0_t2v',
        task: 'video',
        label: 'HappyHorse 1.0 T2V',
        model: 'alibaba/hh1-t2v',
        description: 'Admin HappyHorse video preset',
      },
      {
        name: 'video_seedance_2_fast',
        task: 'video',
        label: 'Seedance 2.0 Fast',
        model: 'bytedance/seedance-2.0-fast',
        description: 'Admin Seedance 2.0 Fast preset with operator-approved video pricing.',
      },
      {
        name: 'video_seedance_2',
        task: 'video',
        label: 'Seedance 2.0',
        model: 'bytedance/seedance-2.0',
        description: 'Admin Seedance 2.0 preset with operator-approved video pricing.',
      },
      {
        name: 'video_grok_imagine',
        task: 'video',
        label: 'Grok Imagine Video',
        model: 'xai/grok-imagine-video',
        description: 'Admin xAI Grok Imagine Video preset through Cloudflare AI Gateway Unified Billing.',
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
        {
          id: 'black-forest-labs/flux-2-max',
          task: 'image',
          label: 'FLUX.2 Max',
          vendor: 'Black Forest Labs',
          providerLabel: 'Cloudflare AI Gateway',
          description: 'Admin-only FLUX.2 Max image generation and editing via Cloudflare AI Gateway.',
          capabilities: {
            supportsSeed: true,
            supportsSteps: false,
            supportsDimensions: true,
            supportsGuidance: false,
            supportsStructuredPrompt: false,
            supportsReferenceImages: true,
            supportsQuality: false,
            supportsSize: false,
            supportsOutputFormat: true,
            supportsBackground: false,
            supportsTransparentBackground: false,
            supportsSafetyTolerance: true,
            maxReferenceImages: 8,
            maxSteps: null,
            defaultSteps: null,
            minDimension: 64,
            maxDimension: 2048,
            maxPixels: 4194304,
            minGuidance: null,
            maxGuidance: null,
            defaultGuidance: null,
            minSafetyTolerance: 0,
            maxSafetyTolerance: 5,
            defaultSafetyTolerance: 2,
            outputFormatOptions: ['jpeg', 'png', 'webp'],
            defaultOutputFormat: 'jpeg',
            defaultSize: { width: 1024, height: 1024 },
            proxied: true,
          },
        },
        {
          id: 'openai/gpt-image-2',
          task: 'image',
          label: 'GPT Image 2',
          vendor: 'OpenAI',
          providerLabel: 'OpenAI via Cloudflare AI Gateway',
          description: 'OpenAI image generation and editing via Cloudflare AI Gateway.',
          capabilities: {
            supportsSeed: false,
            supportsSteps: false,
            supportsDimensions: false,
            supportsGuidance: false,
            supportsStructuredPrompt: false,
            supportsReferenceImages: true,
            supportsQuality: true,
            supportsSize: true,
            supportsOutputFormat: true,
            supportsBackground: true,
            supportsTransparentBackground: false,
            maxReferenceImages: 16,
            maxSteps: null,
            defaultSteps: null,
            minGuidance: null,
            maxGuidance: null,
            defaultGuidance: null,
            qualityOptions: ['low', 'medium', 'high', 'auto'],
            sizeOptions: ['1024x1024', '1024x1536', '1536x1024', 'auto'],
            outputFormatOptions: ['png', 'webp', 'jpeg'],
            backgroundOptions: ['auto', 'opaque'],
            defaultQuality: 'medium',
            defaultSize: '1024x1024',
            defaultOutputFormat: 'png',
            defaultBackground: 'auto',
            proxied: true,
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
        {
          id: 'alibaba/hh1-t2v',
          task: 'video',
          label: 'HappyHorse 1.0 T2V',
          vendor: 'Alibaba',
          description: 'Cloudflare Workers AI HappyHorse text-to-video generation for admin testing.',
          capabilities: {
            supportsImageInput: false,
            supportsEndImage: false,
            supportsNegativePrompt: false,
            supportsSeed: true,
            supportsAudioToggle: false,
            supportsWatermark: true,
            supportsPromptlessImageMode: false,
            resolutionField: 'resolution',
            aspectRatioMode: 'always',
            maxPromptLength: 2500,
            maxNegativePromptLength: null,
            minDuration: 3,
            maxDuration: 15,
            aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
            qualityOptions: [],
            resolutionOptions: ['720P', '1080P'],
            defaultDuration: 5,
            defaultAspectRatio: '16:9',
            defaultQuality: null,
            defaultResolution: '720P',
            defaultGenerateAudio: false,
            defaultWatermark: false,
            defaultPreset: 'video_happyhorse_1_0_t2v',
          },
        },
        {
          id: 'bytedance/seedance-2.0-fast',
          task: 'video',
          label: 'Seedance 2.0 Fast',
          vendor: 'ByteDance',
          providerLabel: 'Cloudflare AI Gateway',
          description: 'Admin-only Cloudflare/AI Gateway Seedance 2.0 Fast video generation with operator-approved pricing.',
          capabilities: {
            supportsImageInput: false,
            supportsEndImage: false,
            supportsNegativePrompt: false,
            supportsSeed: false,
            supportsAudioToggle: false,
            supportsWatermark: false,
            supportsPromptlessImageMode: false,
            resolutionField: 'resolution',
            aspectRatioMode: 'always',
            maxPromptLength: 5000,
            maxNegativePromptLength: null,
            minDuration: 4,
            maxDuration: 12,
            aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
            qualityOptions: [],
            resolutionOptions: ['480p', '720p'],
            defaultDuration: 5,
            defaultAspectRatio: '16:9',
            defaultQuality: null,
            defaultResolution: '720p',
            defaultGenerateAudio: false,
            defaultWatermark: false,
            defaultPreset: 'video_seedance_2_fast',
            adminOnly: true,
            pricingRequired: false,
            costDiscoveryEnabled: false,
            costDiscoveryFlag: null,
            generationEnabled: true,
            unavailableCode: null,
            unavailableMessage: null,
          },
        },
        {
          id: 'bytedance/seedance-2.0',
          task: 'video',
          label: 'Seedance 2.0',
          vendor: 'ByteDance',
          providerLabel: 'Cloudflare AI Gateway',
          description: 'Admin-only Cloudflare/AI Gateway Seedance 2.0 video generation with operator-approved pricing.',
          capabilities: {
            supportsImageInput: false,
            supportsEndImage: false,
            supportsNegativePrompt: false,
            supportsSeed: false,
            supportsAudioToggle: false,
            supportsWatermark: false,
            supportsPromptlessImageMode: false,
            resolutionField: 'resolution',
            aspectRatioMode: 'always',
            maxPromptLength: 5000,
            maxNegativePromptLength: null,
            minDuration: 4,
            maxDuration: 12,
            aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
            qualityOptions: [],
            resolutionOptions: ['720p', '1080p'],
            defaultDuration: 5,
            defaultAspectRatio: '16:9',
            defaultQuality: null,
            defaultResolution: '720p',
            defaultGenerateAudio: false,
            defaultWatermark: false,
            defaultPreset: 'video_seedance_2',
            adminOnly: true,
            pricingRequired: false,
            costDiscoveryEnabled: false,
            costDiscoveryFlag: null,
            generationEnabled: true,
            unavailableCode: null,
            unavailableMessage: null,
          },
        },
        {
          id: 'xai/grok-imagine-video',
          task: 'video',
          label: 'Grok Imagine Video',
          vendor: 'xAI',
          providerLabel: 'Cloudflare AI Gateway',
          description: 'Admin-only xAI Grok Imagine Video via Cloudflare AI Gateway Unified Billing and platform admin lab budget controls.',
          capabilities: {
            supportsImageInput: false,
            supportsReferenceImages: false,
            maxReferenceImages: 0,
            supportsEndImage: false,
            supportsNegativePrompt: false,
            supportsSeed: false,
            supportsAudioToggle: false,
            supportsWatermark: false,
            supportsPromptlessImageMode: false,
            resolutionField: 'resolution',
            aspectRatioMode: 'always',
            maxPromptLength: 5000,
            maxNegativePromptLength: null,
            minDuration: 1,
            maxDuration: 15,
            aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
            qualityOptions: [],
            resolutionOptions: ['480p', '720p'],
            sizeOptions: ['848x480', '1696x960', '1280x720', '1920x1080'],
            supportedOperations: ['generate'],
            defaultDuration: 5,
            defaultAspectRatio: '16:9',
            defaultQuality: null,
            defaultResolution: '720p',
            defaultGenerateAudio: false,
            defaultWatermark: false,
            defaultPreset: 'video_grok_imagine',
            adminOnly: true,
            pricingRequired: false,
            costDiscoveryEnabled: false,
            costDiscoveryFlag: null,
            generationEnabled: true,
            unavailableCode: null,
            unavailableMessage: null,
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
  const saveAudioRequests = captures.saveAudioRequests || [];
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
      [
        '@cf/black-forest-labs/flux-1-schnell',
        '@cf/black-forest-labs/flux-2-klein-9b',
        'black-forest-labs/flux-2-max',
        undefined,
      ].includes(body.model) &&
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
    const selectedModelId = body.model
      || (body.preset === 'video_vidu_q3_pro'
        ? 'vidu/q3-pro'
        : body.preset === 'video_happyhorse_1_0_t2v'
          ? 'alibaba/hh1-t2v'
          : 'pixverse/v6');
    const selectedModel = catalog.models.video.find((entry) => entry.id === selectedModelId) || catalog.models.video[0];
    const isVidu = selectedModel.id === 'vidu/q3-pro';
    const isHappyHorse = selectedModel.id === 'alibaba/hh1-t2v';
    return {
      selectedModel,
      preset: body.preset || (isVidu ? 'video_vidu_q3_pro' : isHappyHorse ? 'video_happyhorse_1_0_t2v' : 'video_studio'),
      result: isHappyHorse ? {
        videoUrl: 'https://example.com/generated-video.mp4',
        prompt: body.prompt || null,
        duration: body.duration ?? 5,
        aspect_ratio: body.ratio || '16:9',
        ratio: body.ratio || '16:9',
        quality: null,
        resolution: body.resolution || '720P',
        seed: body.seed ?? null,
        generate_audio: false,
        watermark: body.watermark === true,
        hasImageInput: false,
        hasEndImageInput: false,
        workflow: 'text_to_video',
      } : isVidu ? {
        videoUrl: 'https://example.com/generated-video.mp4',
        prompt: body.prompt || null,
        duration: body.duration ?? 5,
        aspect_ratio: body.start_image || body.end_image ? null : (body.aspect_ratio || '16:9'),
        ratio: null,
        quality: null,
        resolution: body.resolution || '720p',
        seed: null,
        generate_audio: body.audio !== false,
        watermark: null,
        hasImageInput: !!body.start_image,
        hasEndImageInput: !!body.end_image,
        workflow: body.end_image ? 'start_end_to_video' : body.start_image ? 'image_to_video' : 'text_to_video',
      } : {
        videoUrl: 'https://example.com/generated-video.mp4',
        prompt: body.prompt,
        duration: body.duration ?? 5,
        aspect_ratio: body.aspect_ratio || '16:9',
        ratio: null,
        quality: body.quality || '720p',
        resolution: null,
        seed: body.seed ?? null,
        generate_audio: body.generate_audio !== false,
        watermark: null,
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
    const selectedModelId = body.model
      || (body.preset === 'video_vidu_q3_pro'
        ? 'vidu/q3-pro'
        : body.preset === 'video_happyhorse_1_0_t2v'
          ? 'alibaba/hh1-t2v'
          : 'pixverse/v6');
    const selectedModel = catalog.models.video.find((entry) => entry.id === selectedModelId) || catalog.models.video[0];
    const mock = buildMockVideoResult(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        task: 'video',
        model: selectedModel,
        preset: mock.preset,
        result: mock.result,
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
    if (route.request().method() === 'PATCH' && /\/api\/ai\/text-assets\/[^/]+\/publication$/.test(new URL(route.request().url()).pathname)) {
      const assetId = route.request().url().split('/').slice(-2, -1)[0];
      const body = route.request().postDataJSON();
      const updated = assetStore.setAssetVisibility(assetId, body.visibility);
      if (!updated) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'Asset not found.' }),
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
    if (typeof options.deleteTextAssetHandler === 'function') {
      const handled = await options.deleteTextAssetHandler(route, assetId, assetStore);
      if (handled !== false) return;
    }
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
      size_bytes: Number(captures.savedImageSizeBytes || body.size_bytes || 1024),
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

  await page.route('**/api/ai/audio/save', async (route) => {
    const body = route.request().postDataJSON();
    saveAudioRequests.push(body);
    const id = `audio-${saveAudioRequests.length}`;
    assetStore.addAsset({
      id,
      asset_type: 'audio',
      folder_id: body.folder_id || null,
      title: body.title || body.prompt || 'Saved audio',
      file_name: `${id}.mp3`,
      source_module: 'music',
      mime_type: body.mimeType || 'audio/mpeg',
      size_bytes: body.sizeBytes || 1024,
      preview_text: body.prompt || 'Saved audio',
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
          folder_id: body.folder_id || null,
          title: body.title || body.prompt || 'Saved audio',
          file_name: `${id}.mp3`,
          source_module: 'music',
          mime_type: body.mimeType || 'audio/mpeg',
          size_bytes: body.sizeBytes || 1024,
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

async function expectAuthContextRemoved(page) {
  await expect(page.locator('#authContextPanel')).toHaveCount(0);
  await expect(page.locator('#authContextBody')).toHaveCount(0);
}

async function mockAdminControlPlane(page, captures = {}) {
  captures.creditGrantRequests = captures.creditGrantRequests || [];
  captures.userCreditGrantRequests = captures.userCreditGrantRequests || [];
  captures.aiCleanupRequests = captures.aiCleanupRequests || [];
  captures.storageRequests = captures.storageRequests || [];
  captures.billingReviewResolutionRequests = captures.billingReviewResolutionRequests || [];
  captures.aiBudgetSwitchUpdateRequests = captures.aiBudgetSwitchUpdateRequests || [];
  captures.platformBudgetCapUpdateRequests = captures.platformBudgetCapUpdateRequests || [];
  captures.platformBudgetRepairRequests = captures.platformBudgetRepairRequests || [];
  captures.platformBudgetRepairReportExportRequests = captures.platformBudgetRepairReportExportRequests || [];
  captures.platformBudgetEvidenceArchiveCreateRequests = captures.platformBudgetEvidenceArchiveCreateRequests || [];
  captures.platformBudgetEvidenceArchiveDownloadRequests = captures.platformBudgetEvidenceArchiveDownloadRequests || [];
  captures.platformBudgetEvidenceArchiveExpireRequests = captures.platformBudgetEvidenceArchiveExpireRequests || [];
  captures.platformBudgetEvidenceArchiveCleanupRequests = captures.platformBudgetEvidenceArchiveCleanupRequests || [];
  captures.tenantReviewEvidenceExportRequests = captures.tenantReviewEvidenceExportRequests || [];
  captures.tenantReviewPostCleanupDryRunRequests = captures.tenantReviewPostCleanupDryRunRequests || [];
  captures.tenantReviewPostCleanupEvidenceExportRequests = captures.tenantReviewPostCleanupEvidenceExportRequests || [];
  captures.tenantReviewPostCleanupSupersedeRequests = captures.tenantReviewPostCleanupSupersedeRequests || [];
  captures.tenantAssetDomainEvidenceRequests = captures.tenantAssetDomainEvidenceRequests || [];
  captures.tenantBackfillDryRunRequests = captures.tenantBackfillDryRunRequests || [];
  captures.tenantBackfillExecuteRequests = captures.tenantBackfillExecuteRequests || [];
  captures.tenantAccessSwitchStatusRequests = captures.tenantAccessSwitchStatusRequests || [];
  captures.tenantAccessSwitchShadowRequests = captures.tenantAccessSwitchShadowRequests || [];
  captures.tenantIsolationEvidenceExportRequests = captures.tenantIsolationEvidenceExportRequests || [];
  captures.tenantLegacyResetStatusRequests = captures.tenantLegacyResetStatusRequests || [];
  captures.legacyResetDryRunExportRequests = captures.legacyResetDryRunExportRequests || [];
  captures.tenantReviewStatusUpdateRequests = captures.tenantReviewStatusUpdateRequests || [];
  captures.lifecyclePlanRequests = captures.lifecyclePlanRequests || [];
  captures.lifecycleApproveRequests = captures.lifecycleApproveRequests || [];
  captures.lifecycleExecuteSafeRequests = captures.lifecycleExecuteSafeRequests || [];
  captures.lifecycleCompleteRequests = captures.lifecycleCompleteRequests || [];
  captures.lifecycleRejectRequests = captures.lifecycleRejectRequests || [];
  captures.lifecycleCloseRequests = captures.lifecycleCloseRequests || [];
  captures.lifecycleGenerateExportRequests = captures.lifecycleGenerateExportRequests || [];
  captures.lifecycleRequestExportRequests = captures.lifecycleRequestExportRequests || [];
  captures.lifecycleEvidenceRequests = captures.lifecycleEvidenceRequests || [];
  captures.registrationStatusRequests = captures.registrationStatusRequests || [];
  captures.registrationStatusUpdates = captures.registrationStatusUpdates || [];
  captures.adminActivityRequests = captures.adminActivityRequests || [];
  captures.userActivityRequests = captures.userActivityRequests || [];
  captures.latestAvatarRequests = captures.latestAvatarRequests || [];
  const budgetSwitches = captures.aiBudgetSwitches || [
    {
      switchKey: 'ENABLE_ADMIN_AI_TEXT_BUDGET',
      flagName: 'ENABLE_ADMIN_AI_TEXT_BUDGET',
      label: 'Admin Text Budget',
      description: 'Allows Admin Text test provider calls with budget metadata and durable metadata-only attempts.',
      category: 'admin_lab',
      budgetScope: 'platform_admin_lab_budget',
      operationIds: ['admin.text.test'],
      ownerDomain: 'admin-ai',
      riskLevel: 'medium',
      recommendedOperatorNote: 'Cloudflare master flag must also be enabled.',
      relatedRoutes: ['POST /api/admin/ai/test-text'],
      liveCapStatus: 'cap_enforced',
      liveCapFuturePhase: 'Phase 4.17 platform_admin_lab_budget cap foundation',
      masterFlagStatus: 'enabled',
      masterConfigured: true,
      masterEnabled: true,
      appSwitchStatus: 'disabled',
      appSwitchEnabled: false,
      appSwitchAvailable: true,
      effectiveEnabled: false,
      disabledReason: 'admin_switch_disabled',
      updatedAt: '2026-05-16T10:00:00.000Z',
      updatedBy: { email: 'operator@example.com' },
      reason: 'Initial disabled state for control-plane test',
    },
    {
      switchKey: 'ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET',
      flagName: 'ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET',
      label: 'Admin Live-Agent Budget',
      description: 'Allows Admin Live-Agent streaming provider calls with durable metadata-only stream attempts.',
      category: 'admin_lab',
      budgetScope: 'platform_admin_lab_budget',
      operationIds: ['admin.live_agent'],
      ownerDomain: 'admin-ai',
      riskLevel: 'high',
      recommendedOperatorNote: 'Platform admin lab budget caps must also allow the request.',
      relatedRoutes: ['POST /api/admin/ai/live-agent'],
      liveCapStatus: 'cap_enforced',
      liveCapFuturePhase: 'Phase 4.17 platform_admin_lab_budget cap foundation',
      masterFlagStatus: 'missing',
      masterConfigured: false,
      masterEnabled: false,
      appSwitchStatus: 'enabled',
      appSwitchEnabled: true,
      appSwitchAvailable: true,
      effectiveEnabled: false,
      disabledReason: 'cloudflare_master_disabled',
      updatedAt: '2026-05-16T10:05:00.000Z',
      updatedBy: { email: 'operator@example.com' },
      reason: 'App switch alone cannot override Cloudflare master',
    },
  ];
  function budgetSwitchPayload() {
    return {
      ok: true,
      summary: {
        totalSwitches: budgetSwitches.length,
        masterEnabledCount: budgetSwitches.filter((entry) => entry.masterEnabled).length,
        appEnabledCount: budgetSwitches.filter((entry) => entry.appSwitchEnabled).length,
        effectiveEnabledCount: budgetSwitches.filter((entry) => entry.effectiveEnabled).length,
        disabledByMasterCount: budgetSwitches.filter((entry) => !entry.masterEnabled).length,
        disabledByAppCount: budgetSwitches.filter((entry) => entry.masterEnabled && !entry.appSwitchEnabled).length,
        unknownOrUnavailableCount: 0,
        d1SwitchStoreAvailable: true,
        liveBudgetCapsStatus: 'platform_admin_lab_budget_foundation',
      },
      switches: budgetSwitches,
    };
  }
  const adminUsers = captures.adminUsers || [
    {
      id: 'user_member',
      email: 'member@example.com',
      role: 'user',
      status: 'active',
      created_at: '2026-04-18T11:05:00.000Z',
      updated_at: '2026-04-18T11:05:00.000Z',
    },
    {
      id: 'user_empty',
      email: 'empty@example.com',
      role: 'user',
      status: 'active',
      created_at: '2026-04-19T11:05:00.000Z',
      updated_at: '2026-04-19T11:05:00.000Z',
    },
  ];
  const defaultStorageUsage = {
    usedBytes: Math.round(14.5 * 1024 * 1024),
    limitBytes: 50 * 1024 * 1024,
    remainingBytes: 50 * 1024 * 1024 - Math.round(14.5 * 1024 * 1024),
    isUnlimited: false,
  };
  const userStoragePayloads = captures.userStoragePayloads || {
    user_member: {
      ok: true,
      data: {
        user: adminUsers.find((user) => user.id === 'user_member'),
        storageUsage: defaultStorageUsage,
        summary: {
          assetCount: 2,
          folderCount: 1,
          unfolderedCount: 1,
          unfolderedSizeBytes: 512,
          totalAssetBytes: Math.round(14.5 * 1024 * 1024),
        },
        folders: [
          {
            id: 'f100cafe',
            name: 'Launches',
            slug: 'launches',
            status: 'active',
            created_at: '2026-04-10T09:00:00.000Z',
            file_count: 1,
            size_bytes: 1048576,
          },
        ],
        assets: [
          {
            id: 'a100cafe',
            asset_type: 'image',
            folder_id: 'f100cafe',
            title: 'Launch Key Visual',
            prompt: 'Launch Key Visual',
            mime_type: 'image/png',
            size_bytes: 1048576,
            visibility: 'private',
            is_public: false,
            created_at: '2026-04-10T12:00:00.000Z',
            file_url: '/api/admin/users/user_member/assets/a100cafe/file',
          },
          {
            id: 'b200cafe',
            asset_type: 'text',
            folder_id: null,
            title: 'Release Notes',
            file_name: 'release-notes.txt',
            source_module: 'text',
            mime_type: 'text/plain',
            size_bytes: 512,
            preview_text: 'Notes',
            visibility: 'public',
            is_public: true,
            created_at: '2026-04-09T12:00:00.000Z',
            file_url: '/api/admin/users/user_member/assets/b200cafe/file',
          },
        ],
        next_cursor: null,
        has_more: false,
        applied_limit: 100,
      },
    },
    user_empty: {
      ok: true,
      data: {
        user: adminUsers.find((user) => user.id === 'user_empty'),
        storageUsage: {
          usedBytes: 0,
          limitBytes: 50 * 1024 * 1024,
          remainingBytes: 50 * 1024 * 1024,
          isUnlimited: false,
        },
        summary: {
          assetCount: 0,
          folderCount: 0,
          unfolderedCount: 0,
          unfolderedSizeBytes: 0,
          totalAssetBytes: 0,
        },
        folders: [],
        assets: [],
        next_cursor: null,
        has_more: false,
        applied_limit: 100,
      },
    },
  };

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
  captures.orgAccessRequests = captures.orgAccessRequests || [];
  captures.orgAccessUsers = captures.orgAccessUsers || [
    {
      userId: 'user_owner',
      email: 'owner@example.com',
      accountRole: 'user',
      accountStatus: 'active',
      assigned: true,
      membership: { role: 'owner', status: 'active' },
    },
    {
      userId: 'user_member',
      email: 'member@example.com',
      accountRole: 'user',
      accountStatus: 'active',
      assigned: true,
      membership: { role: 'member', status: 'active' },
    },
    {
      userId: 'user_empty',
      email: 'empty@example.com',
      accountRole: 'user',
      accountStatus: 'active',
      assigned: false,
      membership: null,
    },
    {
      userId: 'user_error',
      email: 'error@example.com',
      accountRole: 'user',
      accountStatus: 'active',
      assigned: false,
      membership: null,
    },
  ];

  await page.route('**/api/admin/orgs?*', async (route) => {
    await fulfillJson(route, orgList);
  });
  await page.route('**/api/admin/orgs', async (route) => {
    await fulfillJson(route, orgList);
  });
  await page.route('**/api/admin/users?*', async (route) => {
    await fulfillJson(route, {
      ok: true,
      users: adminUsers,
      next_cursor: null,
    });
  });
  const adminActivityEntries = captures.adminActivityEntries || Array.from({ length: 12 }, (_, index) => ({
    id: `admin-log-${index + 1}`,
    created_at: new Date(Date.UTC(2026, 4, 18, 12, 0 - index, 0)).toISOString(),
    admin_user_id: 'admin_control_user',
    admin_email: 'admin@example.com',
    action: index % 2 === 0 ? 'change_role' : 'revoke_sessions',
    target_user_id: index % 2 === 0 ? 'user_member' : 'user_empty',
    target_email: index % 2 === 0 ? 'member@example.com' : 'empty@example.com',
    meta_json: JSON.stringify(index % 2 === 0 ? { role: 'admin' } : { revokedSessions: 2 }),
  }));
  const userActivityEntries = captures.userActivityEntries || [
    {
      id: 'user-log-1',
      created_at: '2026-05-18T11:55:00.000Z',
      user_id: 'user_member',
      user_email: 'member@example.com',
      action: 'login',
      meta_json: '{}',
    },
    {
      id: 'user-log-2',
      created_at: '2026-05-18T11:50:00.000Z',
      user_id: 'user_empty',
      user_email: 'empty@example.com',
      action: 'update_profile',
      meta_json: JSON.stringify({ fields: ['displayName'] }),
    },
  ];
  await page.route(/\/api\/admin\/activity(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    captures.adminActivityRequests.push(url.searchParams.toString());
    const cursor = url.searchParams.get('cursor');
    await fulfillJson(route, {
      ok: true,
      entries: cursor === 'admin-page-2'
        ? [{
            id: 'admin-log-13',
            created_at: '2026-05-18T11:35:00.000Z',
            admin_user_id: 'admin_control_user',
            admin_email: 'admin@example.com',
            action: 'change_status',
            target_user_id: 'user_member',
            target_email: 'member@example.com',
            meta_json: JSON.stringify({ status: 'active' }),
          }]
        : adminActivityEntries,
      nextCursor: cursor === 'admin-page-2' ? null : 'admin-page-2',
      counts: {
        change_role: 6,
        change_status: 1,
        revoke_sessions: 6,
        delete_user: 0,
      },
    });
  });
  await page.route(/\/api\/admin\/user-activity(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    captures.userActivityRequests.push(url.searchParams.toString());
    await fulfillJson(route, {
      ok: true,
      entries: userActivityEntries,
      nextCursor: null,
      counts: {},
    });
  });
  await page.route('**/api/admin/avatars/latest', async (route) => {
    captures.latestAvatarRequests.push(route.request().url());
    await fulfillJson(route, {
      ok: true,
      avatars: captures.latestAvatars || [
        {
          userId: 'user_member',
          email: 'member@example.com',
          displayName: 'Member Example',
          updatedAt: '2026-05-18T11:45:00.000Z',
        },
      ],
    });
  });
  await page.route(/\/api\/admin\/avatars\/(?!latest$)[^/?]+$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
    });
  });
  let registrationAvailability = captures.registrationAvailability || {
    enabled: true,
    effectiveStatus: 'registrations_enabled',
    maintenanceMessage: 'Registrations are temporarily disabled due to maintenance work. Please try again later.',
    settingPresent: false,
    storageAvailable: true,
    updatedAt: null,
    updatedByUserId: null,
    reason: null,
  };
  await page.route('**/api/admin/registration/status', async (route) => {
    const request = route.request();
    captures.registrationStatusRequests.push({ method: request.method(), url: request.url() });
    if (request.method() === 'GET') {
      await fulfillJson(route, { ok: true, registration: registrationAvailability });
      return;
    }
    const body = request.postDataJSON();
    const idempotencyKey = request.headers()['idempotency-key'] || null;
    captures.registrationStatusUpdates.push({ body, idempotencyKey });
    registrationAvailability = {
      ...registrationAvailability,
      enabled: body.enabled !== false,
      effectiveStatus: body.enabled === false ? 'registrations_disabled_for_maintenance' : 'registrations_enabled',
      settingPresent: true,
      updatedAt: '2026-05-19T20:30:00.000Z',
      updatedByUserId: 'admin_control_user',
      reason: body.reason || null,
      maintenanceMessage: body.maintenanceMessage || registrationAvailability.maintenanceMessage,
    };
    await fulfillJson(route, {
      ok: true,
      registration: registrationAvailability,
      message: registrationAvailability.enabled
        ? 'New user registrations are enabled.'
        : 'New user registrations are disabled for maintenance.',
    });
  });
  await page.route('**/api/admin/readiness/status', async (route) => {
    await fulfillJson(route, {
      ok: true,
      version: 'omega-p1-readiness-dashboard-v4',
      generatedAt: '2026-05-18T10:00:00.000Z',
      releaseTruth: {
        source: 'config/release-compat.json',
        latestAuthMigration: CURRENT_AUTH_MIGRATION,
        migrationDirectory: 'workers/auth/migrations',
        databaseName: 'bitbi-auth-db',
        staticDeploySeparateFromWorkers: true,
        repoTruthIsLiveDeployProof: false,
        deployVerificationRequired: true,
        deployUnits: ['auth Worker', 'AI Worker', 'contact Worker', 'static Pages'],
      },
      liveEvidenceState: {
        status: 'live_evidence_pending',
        repoSupported: true,
        deployPendingUntilOperatorProof: true,
        liveEvidenceCollectedByRepoAlone: false,
        latestExpectedManifestFields: ['git commit SHA', 'deploy units', 'rollback placeholders'],
        pendingChecks: ['remote auth D1 migration verification', 'admin readiness status live result'],
        rejectedOrFailedEvidence: [],
        caveat: 'Mocked static admin test; live evidence remains pending.',
      },
      cutoverEvidence: {
        outputDirectory: 'docs/production-readiness/evidence/',
        commands: [
          'npm run release:cutover-evidence',
          'npm run release:cutover-evidence:markdown',
          'npm run readiness:live-readonly -- --static-url https://bitbi.ai --auth-worker-url https://bitbi.ai',
          'npm run readiness:dossier',
          'npm run cloudflare:resource-model',
          'npm run release:rollback-drill',
        ],
        safeToRunLocally: true,
        browserExecutesCommands: false,
        noDeployOrMigration: true,
      },
      productionExecution: {
        status: 'blocked',
        repoSupported: true,
        deployPending: true,
        liveEvidencePending: true,
        productionReadiness: 'blocked',
        repoTruthIsLiveProof: false,
        noBrowserDeploy: true,
        noBrowserMigration: true,
        noBrowserRollback: true,
      },
      cloudflareResourceModel: {
        status: 'repo_declared_live_verification_required',
        command: 'npm run cloudflare:resource-model',
        markdownCommand: 'npm run cloudflare:resource-model:markdown',
        repoDeclaredResources: ['Workers', 'D1', 'R2', 'Queues', 'Durable Objects', 'Service bindings', 'Cron triggers'],
        dashboardManagedRequirements: ['WAF/rate limits', 'alerts', 'custom domains/certificates'],
        liveVerificationRequired: true,
        cloudflareApiCallsMade: false,
        secretValuesExposed: false,
      },
      readinessDossier: {
        status: 'local_only_available',
        command: 'npm run readiness:dossier',
        markdownCommand: 'npm run readiness:dossier:markdown',
        outputFormats: ['json', 'markdown'],
        productionReadiness: 'blocked',
        liveBillingReadiness: 'blocked',
        defaultLiveCalls: false,
      },
      postDeployVerification: {
        status: 'pending_operator_opt_in',
        command: 'npm run readiness:live-readonly -- --static-url https://bitbi.ai --auth-worker-url https://bitbi.ai',
        getOnlyByDefault: true,
        adminCookieRequiredForAdminPanels: true,
        adminCookieValueRendered: false,
        checks: ['public health', 'security headers', 'admin readiness', 'billing evidence', 'operations timeline'],
      },
      rollbackDrill: {
        status: 'template_available_not_executed',
        command: 'npm run release:rollback-drill',
        rollbackExecuted: false,
        ownerPlaceholder: 'TBD operator',
        requiredEvidence: ['previous commit', 'previous Worker deploy IDs', 'previous static deploy ID', 'post-rollback smoke checks'],
      },
      releaseCandidate: {
        status: 'repo_supported_ci_pending_live_evidence_pending',
        productionReadiness: 'blocked',
        liveBillingReadiness: 'blocked',
        releaseCandidateUse: 'code_merge_or_deploy_preparation_only',
        ciStatus: 'unknown_until_operator_runs_matrix',
        commands: [
          'npm run rc:check',
          'npm run release:rc',
          'npm run release:rc:markdown',
          'npm run readiness:dossier:markdown',
          'npm run release:rollback-drill',
          'npm run release:plan',
        ],
        checklist: [
          'clean worktree',
          'all audits pass',
          'full test matrix pass',
          'release plan reviewed',
          'cutover evidence generated',
          'readiness dossier generated',
          'rollback drill generated',
          'live read-only evidence pending or attached',
          'blocked claims acknowledged',
        ],
        waveMatrix: [
          'Core readiness gates are repo-supported; evidence blockers remain visible',
          'Security, cost, Admin, lifecycle, tenant asset, and release controls are repo-supported; live/manual evidence remains pending where applicable',
          'Release candidate framework is local-only and does not prove production readiness',
        ],
        dangerousActionsOffered: false,
        browserExecutesCommands: false,
      },
      blockedClaims: [
        { label: 'Production readiness', status: 'blocked' },
        { label: 'Live billing readiness', status: 'blocked' },
        { label: 'Tenant isolation', status: 'not_claimed' },
        { label: 'Ownership backfill readiness', status: 'blocked' },
        { label: 'Access-switch readiness', status: 'blocked' },
        { label: 'Confirmed legacy media reset readiness', status: 'blocked' },
        { label: 'Confirmed media deletion/reset', status: 'not_approved' },
      ],
      hardeningStatus: [
        { label: 'Main release readiness gate', status: 'implemented_repo_supported' },
        { label: 'Confirmed legacy reset gate', status: 'implemented_default_off' },
        { label: 'Sanitized legacy reset dry-run evidence', status: 'pending_blocking' },
        { label: 'Manual-review idempotency evidence', status: 'pending_blocking' },
        { label: 'Active documentation drift cleanup', status: 'implemented_repo_supported' },
        { label: 'Security and cost hardening', status: 'implemented_repo_supported' },
        { label: 'Release, canary, billing, and admin mutation hardening', status: 'implemented_repo_supported' },
        { label: 'Admin, data, observability, and scale hardening', status: 'implemented_repo_supported' },
        { label: 'Admin Readiness & Evidence Dashboard', status: 'implemented_repo_supported' },
        { label: 'Live evidence and cutover tooling', status: 'implemented_repo_supported' },
        { label: 'Tenant asset and storage evidence expansion', status: 'implemented_repo_supported' },
        { label: 'Billing evidence and control plane', status: 'implemented_repo_supported' },
        { label: 'Production execution framework', status: 'implemented_repo_supported' },
        { label: 'Release candidate consolidation', status: 'implemented_repo_supported_go_no_go_blocked' },
      ],
      runtimeSafetyGates: [
        {
          label: 'ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION',
          expected: 'off',
          enabled: false,
          status: 'disabled_default_off',
          rawValueExposed: false,
        },
        { label: 'Fetch Metadata CSRF hardening', status: 'implemented' },
        { label: 'AI Worker caller-policy enforcement', status: 'implemented' },
        { label: 'Admin AI legacy/unclassified provider path', status: 'blocked_or_classified' },
        { label: 'R2/private key redaction', status: 'implemented' },
        { label: 'High-risk admin mutation confirmations', status: 'implemented_for_covered_routes' },
        { label: 'Data lifecycle confirmation/idempotency guardrails', status: 'implemented_for_covered_routes' },
      ],
      evidenceStatuses: [
        { label: 'Legacy reset sanitized dry-run evidence', status: 'pending_sanitized_evidence_required' },
        { label: 'Manual-review idempotency evidence', status: 'pending_replay_conflict_status_success' },
        { label: 'Production readiness evidence', status: 'pending_operator_live_evidence' },
        { label: 'Live billing canary evidence', status: 'pending_operator_live_evidence' },
        { label: 'Billing evidence/control plane', status: 'implemented_repo_supported' },
        { label: 'Billing safety local tests', status: 'implemented_repo_supported' },
        { label: 'Readiness/canary local-only safety contract', status: 'implemented_repo_supported' },
        { label: 'AI budget/platform evidence', status: 'implemented_selected_scopes_live_evidence_pending' },
        { label: 'Cloudflare resource model', status: 'repo_validated_live_verification_required' },
        { label: 'Production readiness dossier', status: 'local_only_available_blocked_verdict' },
        { label: 'Rollback drill evidence', status: 'template_available_pending_operator_fill' },
        { label: 'Release Candidate Go/No-Go manifest', status: 'implemented_repo_supported_local_only_blocked_verdict' },
        { label: 'Final RC validation matrix', status: 'implemented_plan_only_by_default' },
      ],
    });
  });
  await page.route('**/api/admin/tenant-assets/domains/evidence', async (route) => {
    captures.tenantAssetDomainEvidenceRequests.push({ url: route.request().url() });
    await fulfillJson(route, {
      ok: true,
      report: {
        reportVersion: 'tenant-asset-domain-evidence-v1',
        generatedAt: '2026-05-18T11:00:00.000Z',
        source: 'repo_registry_plus_local_d1_read_only',
        noBackfill: true,
        noAccessSwitch: true,
        tenantIsolationClaimed: false,
        productionReadiness: 'blocked',
        liveBillingReadiness: 'blocked',
        blockedClaims: [
          'tenant isolation is not claimed',
          'ownership backfill readiness remains blocked',
          'access-switch readiness remains blocked',
          'confirmed legacy media reset readiness remains blocked',
        ],
        domains: [
          {
            id: 'ai_folders',
            label: 'AI folders',
            currentStatus: 'implemented_but_evidence_pending',
            ownershipMetadataSupport: 'yes_new_rows_only',
            runtimeAccessCheckSource: 'legacy_user_id',
            manualReviewSupport: 'yes',
            resetSupport: 'dry_run_and_gated_executor_limited',
            quotaStorageAccountingSupport: 'indirect_folder_rollup',
            adminVisibilitySupport: 'yes',
            deletionResetRisk: 'high',
          },
          {
            id: 'ai_images',
            label: 'AI images',
            currentStatus: 'implemented_but_evidence_pending',
            ownershipMetadataSupport: 'yes_new_rows_only',
            runtimeAccessCheckSource: 'legacy_user_id',
            manualReviewSupport: 'yes',
            resetSupport: 'dry_run_and_gated_executor_limited',
            quotaStorageAccountingSupport: 'yes_size_bytes',
            adminVisibilitySupport: 'yes',
            deletionResetRisk: 'high',
          },
          {
            id: 'ai_text_assets',
            label: 'AI text assets',
            currentStatus: 'deferred',
            ownershipMetadataSupport: 'no',
            runtimeAccessCheckSource: 'legacy_user_id',
            manualReviewSupport: 'no',
            resetSupport: 'deferred_existing_delete_paths_only',
            quotaStorageAccountingSupport: 'yes_size_bytes',
            adminVisibilitySupport: 'yes_assets_manager',
            deletionResetRisk: 'high',
          },
          {
            id: 'public_gallery_memtracks',
            label: 'Public gallery references: Memtracks',
            currentStatus: 'deferred',
            ownershipMetadataSupport: 'no',
            runtimeAccessCheckSource: 'public_visibility_state',
            manualReviewSupport: 'no',
            resetSupport: 'blocked',
            quotaStorageAccountingSupport: 'partial',
            adminVisibilitySupport: 'partial',
            deletionResetRisk: 'blocked',
          },
          {
            id: 'r2_user_images',
            label: 'R2 USER_IMAGES object family',
            currentStatus: 'evidence_pending',
            ownershipMetadataSupport: 'partial_parent_only',
            runtimeAccessCheckSource: 'D1 parent lookup',
            manualReviewSupport: 'partial',
            resetSupport: 'blocked_without_parent_evidence',
            quotaStorageAccountingSupport: 'partial_d1_bytes_only',
            adminVisibilitySupport: 'redacted_only',
            deletionResetRisk: 'blocked',
          },
        ],
        limitations: ['No live R2 listing.', 'No backfill/access-switch/reset approval.'],
      },
    });
  });
  await page.route(/\/api\/admin\/tenant-assets\/ownership-backfill\/dry-run(?:\?.*)?$/, async (route) => {
    captures.tenantBackfillDryRunRequests.push({ url: route.request().url() });
    await fulfillJson(route, {
      ok: true,
      report: captures.tenantBackfillDryRunReport || {
        reportVersion: 'tenant-isolation-ownership-backfill-v1',
        generatedAt: '2026-05-19T12:00:00.000Z',
        source: 'local_d1_read_only',
        productionReadiness: 'blocked',
        tenantIsolationClaimed: false,
        ownershipBackfillReadiness: 'blocked_until_operator_evidence_review',
        backfillPerformed: false,
        d1Mutated: false,
        r2LiveListed: false,
        r2ObjectsMutated: false,
        postCleanupRebaseline: {
          status: 'post_cleanup_evidence_collected',
          oldCountsSuperseded: true,
          liveEvidenceRequired: false,
        },
        requiredExecutionConfirmation: 'BACKFILL OWNERSHIP',
        summary: {
          totalCandidates: 3,
          safeCandidates: 1,
          classifications: {
            safe_to_backfill: 1,
            needs_manual_review: 1,
            blocked_public_unsafe: 1,
            blocked_missing_evidence: 0,
            already_owned: 3,
          },
        },
        candidates: [
          { domain: 'ai_images', assetId: 'image-private', classification: 'safe_to_backfill', reason: 'private_image_legacy_user_can_seed_personal_owner' },
          { domain: 'ai_folders', assetId: 'folder-missing', classification: 'needs_manual_review', reason: 'folder_candidate_requires_manual_review' },
          { domain: 'ai_images', assetId: 'image-public', classification: 'blocked_public_unsafe', reason: 'public_gallery_reference_requires_review' },
        ],
        warnings: ['Dry-run only: no ownership metadata was written.'],
      },
    });
  });
  await page.route('**/api/admin/tenant-assets/ownership-backfill/execute', async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    captures.tenantBackfillExecuteRequests.push({
      body,
      idempotencyKey: request.headers()['idempotency-key'],
    });
    await fulfillJson(route, {
      ok: true,
      backfill: {
        dryRun: body.dryRun !== false,
        executionMode: body.dryRun === false ? 'safe_rows_only' : 'dry_run_only',
        rowsConsidered: 2,
        rowsWritten: body.dryRun === false ? 2 : 0,
        rowsBlocked: 2,
        accessChecksChanged: false,
        r2LiveListed: false,
        r2ObjectsMutated: false,
        tenantIsolationClaimed: false,
        postCleanupRebaseline: {
          status: body.dryRun === false ? 'post_cleanup_evidence_pending' : 'post_cleanup_evidence_collected',
          oldCountsSuperseded: true,
        },
        productionReadiness: 'blocked',
      },
    });
  });
  await page.route('**/api/admin/tenant-assets/access-switch/status', async (route) => {
    captures.tenantAccessSwitchStatusRequests.push({ url: route.request().url() });
    await fulfillJson(route, {
      ok: true,
      status: {
        reportVersion: 'tenant-isolation-access-switch-status-v1',
        generatedAt: '2026-05-19T12:01:00.000Z',
        currentMode: 'off',
        sourceOfTruth: 'legacy_user_id_runtime_access_checks',
        runtimeSwitchRepoSupported: false,
        liveSwitchEnabled: false,
        tenantIsolationClaimed: false,
        postCleanupRebaseline: {
          status: 'post_cleanup_evidence_pending',
          oldCountsSuperseded: true,
        },
        productionReadiness: 'blocked',
        mismatchCounts: { unsafe: 2, manualReview: 1, metadataMissing: 3 },
        disabledActions: {
          enforced: 'Enforced access-switch is blocked in static mock.',
        },
      },
    });
  });
  await page.route(/\/api\/admin\/tenant-assets\/access-switch\/shadow-diagnostics(?:\?.*)?$/, async (route) => {
    captures.tenantAccessSwitchShadowRequests.push({ url: route.request().url() });
    await fulfillJson(route, {
      ok: true,
      report: {
        reportVersion: 'tenant-isolation-access-switch-shadow-v1',
        generatedAt: '2026-05-19T12:02:00.000Z',
        currentMode: 'off',
        runtimeBehaviorChanged: false,
        accessChecksChanged: false,
        r2LiveListed: false,
        r2ObjectsMutated: false,
        tenantIsolationClaimed: false,
        postCleanupRebaseline: {
          status: 'post_cleanup_evidence_collected',
          oldCountsSuperseded: true,
        },
        productionReadiness: 'blocked',
        summary: {
          mismatchCount: 3,
          foldersWithNullOwnershipMetadata: 1,
          imagesWithNullOwnershipMetadata: 2,
          enforcedModeAllowed: false,
        },
        samples: [
          { domain: 'ai_images', mismatchType: 'metadata_missing', reason: 'ownership_metadata_missing' },
        ],
      },
    });
  });
  await page.route('**/api/admin/tenant-assets/legacy-media-reset/status', async (route) => {
    captures.tenantLegacyResetStatusRequests.push({ url: route.request().url() });
    await fulfillJson(route, {
      ok: true,
      status: {
        reportVersion: 'tenant-isolation-legacy-media-reset-status-v1',
        generatedAt: '2026-05-19T12:03:00.000Z',
        dryRunAvailable: true,
        confirmedExecutionGate: {
          name: 'ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION',
          enabled: false,
          valueExposed: false,
        },
        sanitizedEvidenceStatus: 'pending_blocking',
        confirmedReadiness: 'blocked',
        dangerousOperationsApproved: false,
        productionReadiness: 'blocked',
        tenantIsolationClaimed: false,
        postCleanupRebaseline: {
          status: 'post_cleanup_evidence_pending',
          oldCountsSuperseded: true,
        },
      },
    });
  });
  await page.route(/\/api\/admin\/tenant-assets\/(ownership-backfill\/evidence|access-switch\/evidence|legacy-media-reset\/evidence|tenant-isolation\/evidence)(?:\?.*)?$/, async (route) => {
    captures.tenantIsolationEvidenceExportRequests.push({ url: route.request().url() });
    const url = new URL(route.request().url());
    const format = url.searchParams.get('format') || 'json';
    const contentType = format === 'html' ? 'text/html' : format === 'markdown' ? 'text/markdown' : 'application/json';
    await route.fulfill({
      status: 200,
      contentType,
      headers: {
        'content-disposition': `attachment; filename="tenant-isolation-static.${format === 'markdown' ? 'md' : format}"`,
      },
      body: format === 'json'
        ? JSON.stringify({ ok: true, tenantIsolationClaimed: false, productionReadiness: 'blocked' })
        : 'Tenant Isolation Execution Evidence\nTenant isolation claimed: no\nProduction readiness: blocked\n',
    });
  });
  await page.route('**/api/admin/users/*/storage/reconciliation', async (route) => {
    const match = new URL(route.request().url()).pathname.match(/^\/api\/admin\/users\/([^/]+)\/storage\/reconciliation$/);
    const userId = match ? decodeURIComponent(match[1]) : 'unknown';
    await fulfillJson(route, {
      ok: true,
      data: {
        user: adminUsers.find((user) => user.id === userId) || { id: userId, email: `${userId}@example.com` },
        reconciliation: {
          ok: false,
          mode: 'dry_run_read_only',
          source: 'local_d1_metadata_only',
          generatedAt: '2026-05-18T11:05:00.000Z',
          userId,
          recordedUsageBytes: defaultStorageUsage.usedBytes,
          knownAssetBytes: defaultStorageUsage.usedBytes - 512,
          deltaBytes: 512,
          assetCountsByType: { image: 1, text: 1 },
          missingByteMetadataCount: 0,
          visibilityCounts: { public: 1, private: 1 },
          foldersCount: 1,
          orphanMetadataCount: 0,
          quotaAvailable: true,
          recommendation: 'needs_review',
          noR2Listing: true,
          noR2Mutation: true,
          d1Mutated: false,
          tenantIsolationClaimed: false,
          limitations: ['D1 metadata only.'],
        },
      },
    });
  });
  await page.route('**/api/admin/users/*/storage**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/storage/reconciliation')) {
      const match = pathname.match(/^\/api\/admin\/users\/([^/]+)\/storage\/reconciliation$/);
      const userId = match ? decodeURIComponent(match[1]) : 'unknown';
      await fulfillJson(route, {
        ok: true,
        data: {
          user: adminUsers.find((user) => user.id === userId) || { id: userId, email: `${userId}@example.com` },
          reconciliation: {
            ok: false,
            mode: 'dry_run_read_only',
            source: 'local_d1_metadata_only',
            generatedAt: '2026-05-18T11:05:00.000Z',
            userId,
            recordedUsageBytes: defaultStorageUsage.usedBytes,
            knownAssetBytes: defaultStorageUsage.usedBytes - 512,
            deltaBytes: 512,
            assetCountsByType: { image: 1, text: 1 },
            missingByteMetadataCount: 0,
            visibilityCounts: { public: 1, private: 1 },
            foldersCount: 1,
            orphanMetadataCount: 0,
            quotaAvailable: true,
            recommendation: 'needs_review',
            noR2Listing: true,
            noR2Mutation: true,
            d1Mutated: false,
            tenantIsolationClaimed: false,
            limitations: ['D1 metadata only.'],
          },
        },
      });
      return;
    }
    const match = pathname.match(/^\/api\/admin\/users\/([^/]+)\/storage$/);
    const userId = match ? decodeURIComponent(match[1]) : '';
    const payload = userStoragePayloads[userId];
    await fulfillJson(route, payload || { ok: false, error: 'User not found.' }, payload ? 200 : 404);
  });
  await page.route('**/api/admin/users/*/assets/*/**', async (route) => {
    const request = route.request();
    captures.storageRequests.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      idempotencyKey: request.headers()['idempotency-key'] || null,
      body: request.postData() ? request.postDataJSON() : null,
    });
    await fulfillJson(route, { ok: true, data: { updated: true } });
  });
  await page.route('**/api/admin/users/*/assets/*', async (route) => {
    const request = route.request();
    captures.storageRequests.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      idempotencyKey: request.headers()['idempotency-key'] || null,
      body: request.postData() ? request.postDataJSON() : null,
    });
    await fulfillJson(route, { ok: true, data: { deleted: 1 } });
  });
  await page.route('**/api/admin/users/*/folders/*', async (route) => {
    const request = route.request();
    captures.storageRequests.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      idempotencyKey: request.headers()['idempotency-key'] || null,
      body: request.postData() ? request.postDataJSON() : null,
    });
    await fulfillJson(route, { ok: true, data: { updated: true } });
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
  await page.route('**/api/admin/orgs/org_control_1234567890/user-access**', async (route) => {
    const url = new URL(route.request().url());
    const search = (url.searchParams.get('search') || '').toLowerCase();
    const users = search
      ? captures.orgAccessUsers.filter((user) => user.email.toLowerCase().includes(search))
      : captures.orgAccessUsers;
    await fulfillJson(route, {
      ok: true,
      users,
    });
  });
  await page.route('**/api/admin/orgs/org_control_1234567890/users/*', async (route) => {
    const request = route.request();
    const userId = decodeURIComponent(new URL(request.url()).pathname.split('/').pop());
    const idempotencyKey = request.headers()['idempotency-key'] || null;
    captures.orgAccessRequests.push({
      method: request.method(),
      userId,
      idempotencyKey,
      body: request.postData() ? request.postDataJSON() : null,
    });
    if (!idempotencyKey) {
      await fulfillJson(route, { ok: false, error: 'A valid Idempotency-Key header is required.' }, 428);
      return;
    }
    if (userId === 'user_error') {
      await fulfillJson(route, { ok: false, error: 'Organization access update failed.' }, 503);
      return;
    }
    const target = captures.orgAccessUsers.find((user) => user.userId === userId);
    if (!target) {
      await fulfillJson(route, { ok: false, error: 'User not found.' }, 404);
      return;
    }
    if (request.method() === 'PUT') {
      target.assigned = true;
      target.membership = { role: 'member', status: 'active' };
      await fulfillJson(route, { ok: true, reused: false, access: target }, 201);
      return;
    }
    if (request.method() === 'DELETE') {
      target.assigned = false;
      target.membership = { role: target.membership?.role || 'member', status: 'removed' };
      await fulfillJson(route, { ok: true, reused: false, access: target });
      return;
    }
    await route.fallback();
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

  await page.route('**/api/admin/billing/evidence/status', async (route) => {
    await fulfillJson(route, {
      ok: true,
      version: 'omega-p1-wave7-billing-evidence-v1',
      generatedAt: '2026-05-18T16:00:00.000Z',
      source: 'worker_env_and_static_catalog_only',
      productionReadiness: 'blocked',
      liveBillingReadiness: 'blocked',
      boundedResponse: true,
      redactedResponse: true,
      stripeCallsMade: false,
      checkoutSessionCreated: false,
      webhookMutationPerformed: false,
      d1MutationPerformed: false,
      creditMutationPerformed: false,
      config: {
        flags: {
          liveCreditPacks: { name: 'ENABLE_LIVE_STRIPE_CREDIT_PACKS', present: true, enabled: false, status: 'disabled_or_non_true', valueExposed: false },
          liveSubscriptions: { name: 'ENABLE_LIVE_STRIPE_SUBSCRIPTIONS', present: false, enabled: false, status: 'missing', valueExposed: false },
        },
        stripeMode: { name: 'STRIPE_MODE', present: true, mode: 'test', status: 'testmode_configured', valueExposed: true },
        secrets: {
          liveSecretKey: { name: 'STRIPE_LIVE_SECRET_KEY', present: true, status: 'present_shape_ok', shape: 'expected_prefix_present', valueExposed: false },
          liveWebhookSecret: { name: 'STRIPE_LIVE_WEBHOOK_SECRET', present: true, status: 'present_shape_ok', shape: 'expected_prefix_present', valueExposed: false },
        },
        priceIds: {
          liveSubscriptionPriceId: { name: 'STRIPE_LIVE_SUBSCRIPTION_PRICE_ID', present: true, status: 'present_shape_ok', safeSuffix: 'ro_123456', valueExposed: false },
        },
        urls: {
          liveCreditPackSuccess: { name: 'STRIPE_LIVE_CHECKOUT_SUCCESS_URL', present: true, status: 'present_https', origin: 'https://bitbi.ai', pathname: '/pricing.html', queryPresent: true, valueExposed: false },
          liveCreditPackCancel: { name: 'STRIPE_LIVE_CHECKOUT_CANCEL_URL', present: true, status: 'present_https', origin: 'https://bitbi.ai', pathname: '/pricing.html', queryPresent: true, valueExposed: false },
          liveSubscriptionSuccess: { name: 'STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL', present: false, status: 'missing', valueExposed: false },
          liveSubscriptionCancel: { name: 'STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL', present: false, status: 'missing', valueExposed: false },
        },
      },
      creditPacks: {
        status: 'missing_or_pending',
        configuredCount: 2,
        checkoutCanary: 'pending_operator_evidence',
        noCreditBeforeWebhook: true,
        activePacks: [
          { id: 'live_credits_5000', name: '5000 Credit Pack', credits: 5000, amountCents: 999, currency: 'eur', displayPrice: '9,99 €', active: true },
          { id: 'live_credits_12000', name: '12000 Credit Pack', credits: 12000, amountCents: 1999, currency: 'eur', displayPrice: '19,99 €', active: true },
        ],
      },
      subscription: {
        status: 'missing_or_pending',
        checkoutCanary: 'pending_operator_evidence',
        invoicePaidEvidence: 'pending_operator_evidence',
        plan: {
          id: 'bitbi_pro_monthly',
          name: 'BITBI Pro',
          amountCents: 999,
          currency: 'eur',
          interval: 'month',
          allowanceCredits: 6000,
          rolloverPolicy: 'subscription_bucket_top_up_no_automatic_rollover_claim',
        },
      },
      failClosedFacts: [
        'Checkout creation does not grant credits.',
        'Verified webhook or paid invoice event is required before credit grant.',
        'Live billing readiness remains blocked until operator canary evidence is attached and reviewed.',
      ],
      evidenceRequired: [
        { id: 'live_credit_pack_checkout_canary', status: 'pending_operator_evidence' },
        { id: 'live_subscription_checkout_canary', status: 'pending_operator_evidence' },
        { id: 'verified_webhook_receipt', status: 'pending_operator_evidence' },
        { id: 'duplicate_webhook_idempotency', status: 'pending_operator_evidence' },
        { id: 'wrong_price_id_rejection', status: 'pending_operator_evidence' },
        { id: 'invoice_paid_subscription_credit_grant', status: 'pending_operator_evidence' },
      ],
      dangerousActionsOffered: [],
    });
  });

  await page.route('**/api/admin/operations/timeline**', async (route) => {
    const url = new URL(route.request().url());
    captures.operatorTimelineRequests = captures.operatorTimelineRequests || [];
    captures.operatorTimelineRequests.push(url.searchParams.toString());
    await fulfillJson(route, {
      ok: true,
      version: 'omega-p1-wave8-operator-timeline-v1',
      generatedAt: '2026-05-19T09:00:00.000Z',
      source: 'local_d1_read_only_aggregate',
      readOnly: true,
      boundedResponse: true,
      redactedResponse: true,
      externalCallsMade: false,
      stripeCallsMade: false,
      providerCallsMade: false,
      d1MutationPerformed: false,
      r2ListingPerformed: false,
      r2MutationPerformed: false,
      creditMutationPerformed: false,
      appliedFilters: {
        source: url.searchParams.get('source') || null,
        severity: url.searchParams.get('severity') || null,
        status: url.searchParams.get('status') || null,
        attentionRequired: url.searchParams.get('attentionRequired') || null,
        limit: 25,
        offset: 0,
      },
      events: [
        {
          id: 'billing:bpe_static_payment_failed',
          timestamp: '2026-05-19T08:55:00.000Z',
          source: 'billing',
          domain: 'billing',
          type: 'invoice.payment_failed',
          category: 'billing_provider_event',
          severity: 'high',
          attentionRequired: true,
          status: 'failed',
          title: 'Billing event: invoice.payment_failed',
          summary: 'Live billing lifecycle event requires operator review. Raw payload and signatures are not exposed.',
          actor: null,
          related: { billingEventId: 'bpe_static_payment_failed', providerMode: 'live' },
          evidenceTarget: { label: 'Open Billing Events', href: '#billing-events', kind: 'admin_panel' },
          recommendedAction: { label: 'Open Billing Reviews', href: '#billing-events', kind: 'admin_panel' },
          dangerousActionWarning: 'No reset execution, ownership backfill, access switch, deploy, remote migration, Stripe action, provider call, refund, subscription mutation, or credit mutation is available from this timeline.',
        },
        {
          id: 'tenant_review:tamr_static_public_unsafe',
          timestamp: '2026-05-19T08:45:00.000Z',
          source: 'tenant_review',
          domain: 'tenant_assets',
          type: 'public_unsafe',
          category: 'tenant_asset_manual_review',
          severity: 'critical',
          attentionRequired: true,
          status: 'blocked_public_unsafe',
          title: 'Tenant review: public unsafe',
          summary: 'Manual review blocks future access switch/backfill claims.',
          actor: null,
          related: { reviewItemId: 'tamr_static_public_unsafe', evidenceSourcePath: 'docs/tenant-assets/evidence/static.md' },
          evidenceTarget: { label: 'Open Manual Review Queue', href: '#operations', kind: 'admin_panel' },
          recommendedAction: { label: 'Open Manual Review Queue', href: '#operations', kind: 'admin_panel' },
        },
        {
          id: 'ai_budget:pbra_static_review',
          timestamp: '2026-05-19T08:35:00.000Z',
          source: 'ai_budget',
          domain: 'admin_ai',
          type: 'review_only',
          category: 'platform_budget_repair',
          severity: 'medium',
          attentionRequired: true,
          status: 'pending_review',
          title: 'Platform budget repair: review only',
          summary: 'Repair evidence is review-only until an admin-approved existing workflow is used.',
          actor: { userId: 'admin_static', email: 'admin@example.com' },
          related: { repairActionId: 'pbra_static_review' },
          evidenceTarget: { label: 'Open AI Budget Evidence', href: '#ai-budget-switches', kind: 'admin_panel' },
          recommendedAction: { label: 'Open AI Budget Evidence', href: '#ai-budget-switches', kind: 'admin_panel' },
        },
        {
          id: 'readiness:live_billing_readiness_blocked',
          timestamp: '2026-05-19T08:30:00.000Z',
          source: 'readiness',
          domain: 'billing',
          type: 'blocked_claim',
          category: 'billing_readiness_claim',
          severity: 'high',
          attentionRequired: true,
          status: 'blocked',
          title: 'Live billing readiness remains blocked',
          summary: 'Stripe credit packs and BITBI Pro require operator canary evidence before readiness claims.',
          actor: null,
          related: {},
          evidenceTarget: { label: 'Open Billing Evidence Center', href: '#billing-events', kind: 'admin_panel' },
          recommendedAction: { label: 'Open Billing Evidence Center', href: '#billing-events', kind: 'admin_panel' },
        },
      ],
      hasMore: false,
      nextOffset: null,
      totalAvailable: 4,
      blockedClaims: [
        { id: 'production_readiness', label: 'Production readiness', status: 'blocked' },
        { id: 'live_billing_readiness', label: 'Live billing readiness', status: 'blocked' },
        { id: 'tenant_isolation', label: 'Tenant isolation', status: 'not_claimed' },
      ],
      archiveVisibility: {
        status: 'metadata_only_no_r2_listing',
        policy: {
          retentionDays: 90,
          retentionCutoff: '2026-02-18T09:00:00.000Z',
          liveR2Listed: false,
          archivesDeleted: false,
        },
        counts: {
          adminAuditHot: 2,
          userActivityHot: 1,
          dataExportArchives: 1,
          platformBudgetEvidenceArchives: 1,
        },
      },
      safeNextActions: [
        'Open the related Admin panel.',
        'Run local evidence index or readiness commands outside the browser.',
      ],
      dangerousActionsOffered: [],
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

  await page.route('**/api/admin/users/user_member/billing', async (route) => {
    await fulfillJson(route, {
      ok: true,
      billing: {
        userId: 'user_member',
        email: 'member@example.com',
        role: 'user',
        status: 'active',
        creditBalance: 9,
        dailyCreditAllowance: 10,
        balance: {
          current: 9,
          available: 9,
          dailyAllowance: 10,
          lifetimeIncoming: 18,
          lifetimeDailyTopUps: 8,
          lifetimeManualGrants: 10,
          lifetimeConsumed: 9,
        },
        dailyTopUp: null,
        transactions: [
          {
            id: 'mcl_admin_member_usage',
            type: 'usage_charge',
            entryType: 'consume',
            source: 'member_image_generation',
            featureKey: 'ai.image.generate',
            amount: -1,
            balanceAfter: 9,
            createdAt: '2026-05-01T12:00:00.000Z',
            description: 'Image generation charge for flux-1-schnell',
            usage: {
              id: 'ue_admin_member_usage',
              model: 'flux-1-schnell',
              action: 'member.image.generate',
              route: '/api/ai/generate-image',
              pricingSource: 'org_image_credit_catalog',
              quantity: 1,
              creditsDelta: -1,
              status: 'succeeded',
            },
          },
          {
            id: 'mcl_admin_member_grant',
            type: 'manual_grant',
            entryType: 'grant',
            source: 'manual_admin_grant',
            amount: 10,
            balanceAfter: 10,
            createdAt: '2026-05-01T11:00:00.000Z',
            description: 'Manual admin credit grant',
            reason: 'Support credit',
            createdByEmail: 'admin@bitbi.ai',
          },
        ],
      },
    });
  });

  await page.route('**/api/admin/users/user_empty/billing', async (route) => {
    await fulfillJson(route, {
      ok: true,
      billing: {
        userId: 'user_empty',
        email: 'empty@example.com',
        role: 'user',
        status: 'active',
        creditBalance: 0,
        dailyCreditAllowance: 10,
        balance: {
          current: 0,
          available: 0,
          dailyAllowance: 10,
          lifetimeIncoming: 0,
          lifetimeDailyTopUps: 0,
          lifetimeManualGrants: 0,
          lifetimeConsumed: 0,
        },
        dailyTopUp: null,
        transactions: [],
      },
    });
  });

  await page.route('**/api/admin/users/user_member/credits/grant', async (route) => {
    captures.userCreditGrantRequests.push({
      idempotencyKey: route.request().headers()['idempotency-key'],
      body: route.request().postDataJSON(),
    });
    await fulfillJson(route, {
      ok: true,
      reused: false,
      ledgerEntry: {
        userId: 'user_member',
        amount: route.request().postDataJSON().amount,
        balanceAfter: 34,
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

  const billingReconciliationPayload = {
    ok: true,
    generatedAt: '2026-05-15T12:00:00.000Z',
    source: 'local_d1_only',
    verdict: 'blocked',
    productionReadiness: 'blocked',
    liveBillingReadiness: 'blocked',
    summary: {
      scanLimit: 500,
      criticalItems: 2,
      warningItems: 1,
      reviews: {
        blocked: 1,
        needsReview: 1,
        resolved: 0,
        dismissed: 0,
        staleUnresolved: 0,
      },
      checkouts: {
        completedWithoutLedger: 1,
        ledgerLinkedWithoutBillingEvent: 0,
        organizationLiveCreditPackByStatus: { completed: 1 },
      },
      creditLedger: {
        negativeBalances: 0,
        usageEventsMissingLedger: 0,
      },
      subscriptions: {
        activeWithoutTopUpMarker: 0,
      },
    },
    sections: [
      {
        id: 'billing_reviews',
        title: 'Billing Reviews',
        severity: 'critical',
        summary: { blocked: 1, needsReview: 1 },
        items: [
          {
            id: 'reviews_blocked_unresolved',
            severity: 'critical',
            title: 'Unresolved blocked billing review events exist.',
            detail: 'Blocked live Stripe dispute events prevent live billing readiness claims until human review is complete.',
            count: 1,
            refs: {
              id: 'bpe_review_2',
              providerEventId: 'evt_review_dispute_1',
              eventType: 'charge.dispute.created',
              paymentMethodId: 'pm_card_should_not_render',
              stripeSignature: 'Stripe-Signature should-not-render',
            },
          },
        ],
      },
      {
        id: 'checkout_sessions',
        title: 'Checkout Sessions',
        severity: 'critical',
        summary: { completedWithoutLedger: 1 },
        items: [
          {
            id: 'checkouts_completed_without_ledger',
            severity: 'critical',
            title: 'Completed live credit-pack checkout sessions without linked ledger entries.',
            detail: 'Completed checkout sessions without local credit ledger links may indicate ungranted credits or an incomplete webhook path.',
            count: 1,
            refs: {
              id: 'bcs_reconciliation_1',
              checkoutSessionId: 'cs_live_reconciliation_1',
              secretValue: 'sk_live_should_not_render',
              cardLast4: '4242',
            },
          },
        ],
      },
    ],
    notes: [
      'This report is read-only.',
      'It uses local D1 state only.',
      'It does not call Stripe.',
      'It does not reconcile automatically.',
      'Operator review is required.',
    ],
  };

  await page.route('**/api/admin/billing/reconciliation', async (route) => {
    if (captures.billingReconciliationUnavailable) {
      await fulfillJson(route, { ok: false, error: 'Billing reconciliation unavailable.' }, 503);
      return;
    }
    await fulfillJson(route, billingReconciliationPayload);
  });

  const billingReviews = [
    {
      id: 'bpe_review_1',
      billingEventId: 'bpe_review_1',
      actionId: 'bea_review_1',
      providerEventId: 'evt_review_failure_1',
      provider: 'stripe',
      providerMode: 'live',
      eventType: 'invoice.payment_failed',
      receivedAt: '2026-05-12T08:00:00.000Z',
      processingStatus: 'planned',
      actionStatus: 'deferred',
      reviewState: 'needs_review',
      reviewReason: 'Live invoice payment failed.',
      recommendedAction: 'Review the member subscription and contact the customer before any manual account decision.',
      sideEffectsEnabled: false,
      operatorReviewOnly: true,
      safeIdentifiers: {
        providerEventId: 'evt_review_failure_1',
        invoiceId: 'in_review_failure_1',
        customerId: 'cus_review_1',
        subscriptionId: 'sub_review_1',
        rawPayload: 'should-not-render',
        stripeSignature: 'Stripe-Signature should-not-render',
      },
    },
    {
      id: 'bpe_review_2',
      billingEventId: 'bpe_review_2',
      actionId: 'bea_review_2',
      providerEventId: 'evt_review_dispute_1',
      provider: 'stripe',
      providerMode: 'live',
      eventType: 'charge.dispute.created',
      receivedAt: '2026-05-12T09:00:00.000Z',
      processingStatus: 'planned',
      actionStatus: 'deferred',
      reviewState: 'blocked',
      reviewReason: 'Live charge dispute opened.',
      recommendedAction: 'Block billing readiness claims until a human accounting/legal review is complete.',
      sideEffectsEnabled: false,
      operatorReviewOnly: true,
      safeIdentifiers: {
        providerEventId: 'evt_review_dispute_1',
        chargeId: 'ch_review_1',
        disputeId: 'du_review_1',
        customerId: 'cus_review_1',
        cardLast4: '4242',
        paymentMethodId: 'pm_card_visa',
        secretValue: 'sk_live_should_not_render',
      },
      warning: 'Blocked billing lifecycle event: operator review is required before any billing or account readiness claim.',
    },
  ];

  function reviewDetail(review) {
    return {
      ok: true,
      livePaymentProviderEnabled: false,
      review: {
        ...review,
        actionSummary: {
          eventType: review.eventType,
          providerMode: review.providerMode,
          sideEffectsEnabled: false,
          operatorReviewOnly: true,
          reviewState: review.reviewState,
          reviewReason: review.reviewReason,
          recommendedAction: review.recommendedAction,
          safeIdentifiers: review.safeIdentifiers,
          creditMutation: 'none',
          creditsGranted: 0,
          creditsReversed: 0,
          persistedCheckoutState: {
            status: 'needs_review',
            hasLedgerEntry: false,
            raw_payload: 'should-not-render',
          },
          rawPayload: 'should-not-render',
          stripeSignature: 'Stripe-Signature should-not-render',
        },
      },
    };
  }

  await page.route('**/api/admin/billing/reviews?*', async (route) => {
    const url = new URL(route.request().url());
    const state = url.searchParams.get('review_state');
    const filtered = state
      ? billingReviews.filter((review) => review.reviewState === state)
      : billingReviews;
    await fulfillJson(route, {
      ok: true,
      livePaymentProviderEnabled: false,
      reviews: filtered,
      nextCursor: null,
    });
  });
  await page.route('**/api/admin/billing/reviews', async (route) => {
    await fulfillJson(route, {
      ok: true,
      livePaymentProviderEnabled: false,
      reviews: billingReviews,
      nextCursor: null,
    });
  });
  await page.route('**/api/admin/billing/reviews/bpe_review_1/resolution', async (route) => {
    captures.billingReviewResolutionRequests.push({
      method: route.request().method(),
      path: new URL(route.request().url()).pathname,
      idempotencyKey: route.request().headers()['idempotency-key'],
      body: route.request().postDataJSON(),
    });
    await wait(80);
    const body = route.request().postDataJSON();
    billingReviews[0] = {
      ...billingReviews[0],
      reviewState: body.resolution_status,
      resolutionStatus: body.resolution_status,
      resolutionNote: body.resolution_note,
      resolvedAt: '2026-05-12T10:00:00.000Z',
    };
    await fulfillJson(route, {
      ok: true,
      reused: false,
      sideEffectsEnabled: false,
      review: reviewDetail(billingReviews[0]).review,
    });
  });
  await page.route('**/api/admin/billing/reviews/bpe_review_1', async (route) => {
    await fulfillJson(route, reviewDetail(billingReviews[0]));
  });
  await page.route('**/api/admin/billing/reviews/bpe_review_2', async (route) => {
    await fulfillJson(route, reviewDetail(billingReviews[1]));
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

  await page.route('**/api/admin/ai/budget-switches', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await fulfillJson(route, budgetSwitchPayload());
  });
  await page.route('**/api/admin/ai/budget-switches/*', async (route) => {
    const request = route.request();
    if (request.method() !== 'PATCH') {
      await route.fallback();
      return;
    }
    const switchKey = decodeURIComponent(new URL(request.url()).pathname.split('/').pop() || '');
    const entry = budgetSwitches.find((item) => item.switchKey === switchKey);
    if (!entry) {
      await fulfillJson(route, { ok: false, code: 'admin_ai_budget_switch_not_found' }, 404);
      return;
    }
    const body = request.postDataJSON();
    captures.aiBudgetSwitchUpdateRequests.push({
      idempotencyKey: request.headers()['idempotency-key'],
      switchKey,
      body,
    });
    entry.appSwitchEnabled = body.enabled === true;
    entry.appSwitchStatus = entry.appSwitchEnabled ? 'enabled' : 'disabled';
    entry.effectiveEnabled = entry.masterEnabled === true && entry.appSwitchEnabled === true;
    entry.disabledReason = entry.effectiveEnabled
      ? null
      : (entry.masterEnabled ? 'admin_switch_disabled' : 'cloudflare_master_disabled');
    entry.reason = body.reason;
    entry.updatedAt = '2026-05-16T11:00:00.000Z';
    await fulfillJson(route, {
      ok: true,
      switch: entry,
      event: {
        id: 'budsw_static_1',
        replayed: false,
        createdAt: entry.updatedAt,
      },
    });
  });

  const platformBudgetCaps = captures.platformBudgetCaps || {
    budgetScope: 'platform_admin_lab_budget',
    liveBudgetCapsStatus: 'platform_admin_lab_budget_foundation',
    capEnforced: true,
    generatedAt: '2026-05-16T11:30:00.000Z',
    windows: [
      {
        windowType: 'daily',
        windowValue: '2026-05-16',
        usedUnits: 12,
        remainingUnits: 88,
        capStatus: 'available',
        limit: {
          id: 'pbl_static_daily',
          budgetScope: 'platform_admin_lab_budget',
          windowType: 'daily',
          limitUnits: 100,
          mode: 'enforce',
          status: 'active',
          reason: 'Static test daily cap',
          updatedAt: '2026-05-16T11:00:00.000Z',
        },
      },
      {
        windowType: 'monthly',
        windowValue: '2026-05',
        usedUnits: 30,
        remainingUnits: 970,
        capStatus: 'available',
        limit: {
          id: 'pbl_static_monthly',
          budgetScope: 'platform_admin_lab_budget',
          windowType: 'monthly',
          limitUnits: 1000,
          mode: 'enforce',
          status: 'active',
          reason: 'Static test monthly cap',
          updatedAt: '2026-05-16T11:00:00.000Z',
        },
      },
    ],
    operationUsage: [
      { operationKey: 'admin.text.test', usedUnits: 12, eventCount: 2 },
    ],
  };
  await page.route('**/api/admin/ai/platform-budget-caps', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await fulfillJson(route, { ok: true, ...platformBudgetCaps });
  });
  await page.route('**/api/admin/ai/platform-budget-caps/*', async (route) => {
    const request = route.request();
    if (request.method() !== 'PATCH') {
      await route.fallback();
      return;
    }
    const budgetScope = decodeURIComponent(new URL(request.url()).pathname.split('/').pop() || '');
    const body = request.postDataJSON();
    captures.platformBudgetCapUpdateRequests.push({
      idempotencyKey: request.headers()['idempotency-key'],
      budgetScope,
      body,
    });
    const item = platformBudgetCaps.windows.find((entry) => entry.windowType === body.window_type);
    if (item) {
      item.limit.limitUnits = body.limit_units;
      item.limit.reason = body.reason;
      item.limit.updatedAt = '2026-05-16T11:45:00.000Z';
      item.remainingUnits = Math.max(0, body.limit_units - item.usedUnits);
    }
    await fulfillJson(route, {
      ok: true,
      limit: item?.limit || null,
      event: {
        id: 'pble_static_1',
        replayed: false,
        createdAt: '2026-05-16T11:45:00.000Z',
      },
    });
  });
  await page.route('**/api/admin/ai/platform-budget-usage', async (route) => {
    await fulfillJson(route, {
      ok: true,
      usage: {
        budgetScope: platformBudgetCaps.budgetScope,
        operationUsage: platformBudgetCaps.operationUsage,
        recentEvents: [],
      },
    });
  });
  await page.route('**/api/admin/ai/platform-budget-reconciliation?*', async (route) => {
    await fulfillJson(route, {
      ok: true,
      reconciliation: {
        ok: true,
        generatedAt: '2026-05-16T11:50:00.000Z',
        source: 'local_d1_read_only',
        budgetScope: 'platform_admin_lab_budget',
        verdict: 'needs_operator_review',
        productionReadiness: 'blocked',
        liveBillingReadiness: 'blocked',
        runtimeMutation: false,
        repairApplied: false,
        summary: {
          issueCount: 2,
          criticalIssueCount: 0,
          warningIssueCount: 2,
          repairCandidateCount: 2,
          notCheckableCount: 0,
          missingUsageEventCount: 1,
          duplicateUsageEventCount: 1,
          orphanUsageEventCount: 0,
          failedSourceUsageCount: 0,
          windowMismatchCount: 0,
          invalidUsageUnitCount: 0,
          capStatusIssueCount: 0,
        },
        repairCandidates: [
          {
            candidateId: 'pbr_missing_admin_usage_event_att_static_1',
            issueType: 'missing_admin_usage_event',
            severity: 'warning',
            budgetScope: 'platform_admin_lab_budget',
            operationKey: 'admin.text.test',
            sourceAttemptId: 'att_static_1',
            sourceJobId: null,
            usageEventIds: [],
            proposedAction: 'create_missing_usage_event',
            actionSafety: 'admin_approved_idempotent_executor',
            futureRepairExecutorRequired: false,
            phase419Executable: true,
            reviewOnly: false,
            repairEndpoint: '/api/admin/ai/platform-budget-reconciliation/repair',
            proposedUnits: 1,
            reason: 'Successful admin AI attempt has no matching platform budget usage event.',
          },
          {
            candidateId: 'pbr_duplicate_attempt_usage_event_att_static_2',
            issueType: 'duplicate_attempt_usage_event',
            severity: 'critical',
            budgetScope: 'platform_admin_lab_budget',
            operationKey: 'admin.music.test',
            sourceAttemptId: 'att_static_2',
            usageEventIds: ['pbu_static_1', 'pbu_static_2'],
            proposedAction: 'mark_duplicate_usage_event_review',
            actionSafety: 'dry_run_or_review_only',
            futureRepairExecutorRequired: true,
            phase419Executable: false,
            reviewOnly: true,
            repairEndpoint: '/api/admin/ai/platform-budget-reconciliation/repair',
            proposedUnits: 2,
            reason: 'Multiple recorded platform budget usage events point at the same source.',
          },
        ],
      },
    });
  });
  await page.route('**/api/admin/ai/platform-budget-reconciliation/repair', async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    captures.platformBudgetRepairRequests.push({
      idempotencyKey: request.headers()['idempotency-key'],
      body,
    });
    await fulfillJson(route, {
      ok: true,
      repair: {
        ok: true,
        dryRun: body.dryRun !== false,
        repairApplied: body.dryRun === false && body.requestedAction === 'create_missing_usage_event',
        reviewRecorded: body.dryRun === false && body.requestedAction !== 'create_missing_usage_event',
        plan: body.dryRun !== false ? {
          candidate: {
            candidateId: body.candidateId,
            candidateType: body.candidateType,
            budgetScope: body.budgetScope,
          },
          result: {
            actionStatus: 'dry_run_planned',
          },
        } : undefined,
        action: body.dryRun === false ? {
          id: 'pbra_static_1',
          budgetScope: body.budgetScope,
          candidateId: body.candidateId,
          candidateType: body.candidateType,
          requestedAction: body.requestedAction,
          actionStatus: body.requestedAction === 'create_missing_usage_event' ? 'applied' : 'review_recorded',
          createdUsageEventId: body.requestedAction === 'create_missing_usage_event' ? 'pbu_repair_static_1' : null,
          idempotencyKeyPresent: true,
        } : null,
      },
    });
  });
  await page.route('**/api/admin/ai/platform-budget-repair-actions?*', async (route) => {
    await fulfillJson(route, {
      ok: true,
      repairActions: [],
    });
  });
  await page.route('**/api/admin/ai/platform-budget-repair-report?*', async (route) => {
    await fulfillJson(route, {
      ok: true,
      report: {
        ok: true,
        available: true,
        version: 'platform-budget-repair-report-v1',
        reportId: 'pbr_report_static',
        generatedAt: '2026-05-16T12:10:00.000Z',
        source: 'local_d1_read_only',
        budgetScope: 'platform_admin_lab_budget',
        productionReadiness: 'blocked',
        liveBillingReadiness: 'blocked',
        repairExecution: 'manual_admin_approved_only',
        automaticRepair: false,
        scheduledRepair: false,
        runtimeMutation: false,
        providerCalls: false,
        stripeCalls: false,
        creditMutation: false,
        summary: {
          totalRepairActions: 3,
          executableRepairsApplied: 1,
          dryRunsPerformed: 1,
          reviewOnlyActionsRecorded: 1,
          failedRepairAttempts: 1,
          idempotencyConflictCount: 0,
          recentRepairCount: 3,
          createdUsageEventCount: 1,
          unresolvedRepairCandidatesCount: 2,
          criticalReconciliationIssueCount: 0,
          lastRepairTimestamp: '2026-05-16T12:05:00.000Z',
          lastDryRunTimestamp: '2026-05-16T12:04:00.000Z',
        },
        sections: {
          repairActionStatusRollup: [
            { key: 'applied', count: 1, createdUsageEventCount: 1, lastActionAt: '2026-05-16T12:05:00.000Z' },
            { key: 'review_recorded', count: 1, createdUsageEventCount: 0, lastActionAt: '2026-05-16T12:03:00.000Z' },
            { key: 'failed', count: 1, createdUsageEventCount: 0, lastActionAt: '2026-05-16T12:02:00.000Z' },
          ],
          repairActionTypeRollup: [
            { key: 'missing_admin_usage_event:create_missing_usage_event', count: 1, createdUsageEventCount: 1, lastActionAt: '2026-05-16T12:05:00.000Z' },
            { key: 'duplicate_attempt_usage_event:mark_duplicate_usage_event_review', count: 1, createdUsageEventCount: 0, lastActionAt: '2026-05-16T12:03:00.000Z' },
          ],
          recentRepairActions: [],
          createdUsageEventEvidence: [],
          reviewOnlyActionEvidence: [],
        },
      },
    });
  });
  await page.route('**/api/admin/ai/platform-budget-repair-report/export?*', async (route) => {
    captures.platformBudgetRepairReportExportRequests.push({
      url: route.request().url(),
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'content-disposition': 'attachment; filename="platform-budget-repair-report-static.json"',
      },
      body: JSON.stringify({
        source: 'local_d1_read_only',
        budgetScope: 'platform_admin_lab_budget',
        automaticRepair: false,
        summary: { totalRepairActions: 3 },
      }),
    });
  });
  await page.route(/\/api\/admin\/tenant-assets\/legacy-media-reset\/dry-run\/export(?:\?.*)?$/, async (route) => {
    captures.legacyResetDryRunExportRequests.push({ url: route.request().url() });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'content-disposition': 'attachment; filename="legacy-media-reset-dry-run-static.json"',
      },
      body: JSON.stringify({
        ok: true,
        dryRun: true,
        execution: false,
        noDeletionOccurred: true,
        rawIdempotencyKeyPresent: false,
        privateR2KeysExposed: false,
      }),
    });
  });
  const evidenceArchives = captures.platformBudgetEvidenceArchives || [
    {
      id: 'pbea_static_1',
      budgetScope: 'platform_admin_lab_budget',
      archiveType: 'repair_report',
      archiveStatus: 'created',
      contentType: 'application/json; charset=utf-8',
      format: 'json',
      sha256: 'safehash',
      sizeBytes: 720,
      filters: { limit: 50 },
      summary: {
        totalRepairActions: 3,
        createdUsageEventCount: 1,
      },
      idempotencyKeyPresent: true,
      reason: 'Static evidence archive',
      createdByEmail: 'admin@example.com',
      createdAt: '2026-05-16T12:20:00.000Z',
      updatedAt: '2026-05-16T12:20:00.000Z',
      expiresAt: '2026-08-14T12:20:00.000Z',
      storage: {
        private: true,
        bucketBinding: 'AUDIT_ARCHIVE',
        prefix: 'platform-budget-evidence/',
        internalKeyIncluded: false,
      },
    },
  ];
  await page.route('**/api/admin/ai/platform-budget-evidence-archives/cleanup-expired', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.fallback();
      return;
    }
    captures.platformBudgetEvidenceArchiveCleanupRequests.push({
      idempotencyKey: request.headers()['idempotency-key'],
      body: request.postDataJSON(),
    });
    await fulfillJson(route, {
      ok: true,
      cleanup: {
        ok: true,
        budgetScope: 'platform_admin_lab_budget',
        scannedCount: 1,
        deletedCount: 1,
        failedCount: 0,
        results: [{ id: 'pbea_static_expired', status: 'deleted', internalKeyIncluded: false }],
      },
    });
  });
  await page.route('**/api/admin/ai/platform-budget-evidence-archives/*/download', async (route) => {
    captures.platformBudgetEvidenceArchiveDownloadRequests.push({
      url: route.request().url(),
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'content-disposition': 'attachment; filename="platform-budget-evidence-static.json"',
      },
      body: JSON.stringify({
        archive: {
          id: 'pbea_static_1',
          budgetScope: 'platform_admin_lab_budget',
          providerCalls: false,
          stripeCalls: false,
        },
      }),
    });
  });
  await page.route('**/api/admin/ai/platform-budget-evidence-archives/*/expire', async (route) => {
    const request = route.request();
    captures.platformBudgetEvidenceArchiveExpireRequests.push({
      idempotencyKey: request.headers()['idempotency-key'],
      body: request.postDataJSON(),
    });
    await fulfillJson(route, {
      ok: true,
      archive: {
        ...evidenceArchives[0],
        archiveStatus: 'expired',
      },
      expired: true,
    });
  });
  await page.route(/\/api\/admin\/ai\/platform-budget-evidence-archives(?:\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await fulfillJson(route, {
        ok: true,
        available: true,
        budgetScope: 'platform_admin_lab_budget',
        appliedLimit: 25,
        archives: evidenceArchives,
      });
      return;
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      captures.platformBudgetEvidenceArchiveCreateRequests.push({
        idempotencyKey: request.headers()['idempotency-key'],
        body,
      });
      const created = {
        ...evidenceArchives[0],
        id: 'pbea_static_created',
        archiveType: body.archiveType,
        format: body.format,
        reason: body.reason,
        createdAt: '2026-05-16T12:30:00.000Z',
        updatedAt: '2026-05-16T12:30:00.000Z',
      };
      evidenceArchives.unshift(created);
      await fulfillJson(route, {
        ok: true,
        archive: created,
        replayed: false,
      });
      return;
    }
    await route.fallback();
  });

  const tenantReviewItems = captures.tenantReviewItems || [
    {
      id: 'ta_mri_static_pending_1',
      assetDomain: 'ai_images',
      assetId: 'img_static_1',
      issueCategory: 'metadata_missing',
      reviewStatus: 'pending_review',
      severity: 'warning',
      priority: 'medium',
      evidenceSourcePath: 'current_evidence_report',
      safeNotes: 'Existing row has no ownership metadata; classify before any backfill or access switch.',
      createdAt: '2026-05-17T13:00:00.000Z',
      updatedAt: '2026-05-17T13:00:00.000Z',
      reviewedAt: null,
    },
    {
      id: 'ta_mri_static_public_1',
      assetDomain: 'public_gallery',
      assetId: 'img_static_public_1',
      issueCategory: 'public_unsafe',
      reviewStatus: 'blocked_public_unsafe',
      severity: 'critical',
      priority: 'high',
      evidenceSourcePath: 'current_evidence_report',
      safeNotes: 'Public/gallery attribution and visibility must be reviewed before any ownership access switch.',
      createdAt: '2026-05-17T13:01:00.000Z',
      updatedAt: '2026-05-17T13:01:00.000Z',
      reviewedAt: null,
    },
    {
      id: 'ta_mri_static_derivative_1',
      assetDomain: 'derivative',
      assetId: 'img_static_derivative_1',
      issueCategory: 'derivative_risk',
      reviewStatus: 'blocked_derivative_risk',
      severity: 'warning',
      priority: 'medium',
      evidenceSourcePath: 'current_evidence_report',
      safeNotes: 'Parent image ownership must be reviewed before derivative/poster/thumb inheritance.',
      createdAt: '2026-05-17T13:02:00.000Z',
      updatedAt: '2026-05-17T13:02:00.000Z',
      reviewedAt: null,
    },
  ];
  const tenantReviewEvents = captures.tenantReviewEvents || [
    {
      id: 'ta_mre_static_created_1',
      reviewItemId: 'ta_mri_static_pending_1',
      eventType: 'created',
      oldStatus: null,
      newStatus: 'pending_review',
      actorUserIdPresent: true,
      actorEmailPresent: false,
      reasonPresent: true,
      idempotencyKeyStoredAsHash: true,
      requestHashStored: true,
      eventMetadataSummary: { source: 'static_test', rawPrompt: '[redacted]' },
      createdAt: '2026-05-17T13:00:00.000Z',
    },
    {
      id: 'ta_mre_static_created_2',
      reviewItemId: 'ta_mri_static_public_1',
      eventType: 'created',
      oldStatus: null,
      newStatus: 'blocked_public_unsafe',
      actorUserIdPresent: true,
      actorEmailPresent: false,
      reasonPresent: true,
      idempotencyKeyStoredAsHash: true,
      requestHashStored: true,
      eventMetadataSummary: { source: 'static_test' },
      createdAt: '2026-05-17T13:01:00.000Z',
    },
  ];

  function tenantReviewRollup(items, key, values) {
    return values.reduce((acc, value) => {
      acc[value] = items.filter((item) => item[key] === value).length;
      return acc;
    }, {});
  }

  function tenantReviewEvidenceReport() {
    const statusChangedEvents = tenantReviewEvents.filter((event) => event.eventType === 'status_changed');
    const deferredEvents = tenantReviewEvents.filter((event) => event.eventType === 'deferred');
    const rejectedEvents = tenantReviewEvents.filter((event) => event.eventType === 'rejected');
    const supersededEvents = tenantReviewEvents.filter((event) => event.eventType === 'superseded');
    const statusEvents = statusChangedEvents.concat(deferredEvents, rejectedEvents, supersededEvents);
    return {
      ok: true,
      report: {
        ok: true,
        available: true,
        reportVersion: 'tenant-asset-manual-review-queue-report-v1',
        generatedAt: '2026-05-17T13:10:00.000Z',
        source: 'local_d1_read_only',
        domain: 'folders_images_manual_review',
        runtimeBehaviorChanged: false,
        accessChecksChanged: false,
        tenantIsolationClaimed: false,
        backfillPerformed: false,
        sourceAssetRowsMutated: false,
        reviewStatusesChanged: statusEvents.length > 0,
        r2LiveListed: false,
        productionReadiness: 'blocked',
        summary: {
          totalReviewItems: tenantReviewItems.length,
          totalEvents: tenantReviewEvents.length,
          createdEventsCount: tenantReviewEvents.filter((event) => event.eventType === 'created').length,
          statusChangedEventsCount: statusChangedEvents.length,
          deferredEventsCount: deferredEvents.length,
          rejectedEventsCount: rejectedEvents.length,
          supersededEventsCount: supersededEvents.length,
          terminalApprovedCount: tenantReviewItems.filter((item) => String(item.reviewStatus || '').startsWith('approved_')).length,
          terminalBlockedCount: tenantReviewItems.filter((item) => String(item.reviewStatus || '').startsWith('blocked_')).length,
          mostRecentImportTimestamp: '2026-05-17T13:02:00.000Z',
          latestStatusUpdateTimestamp: statusEvents.map((event) => event.createdAt).sort().at(-1) || null,
          reviewStatusRollup: tenantReviewRollup(tenantReviewItems, 'reviewStatus', [
            'pending_review',
            'review_in_progress',
            'approved_personal_user_asset',
            'approved_organization_asset',
            'approved_legacy_unclassified',
            'approved_platform_admin_test_asset',
            'blocked_public_unsafe',
            'blocked_derivative_risk',
            'blocked_relationship_conflict',
            'blocked_missing_evidence',
            'needs_legal_privacy_review',
            'deferred',
            'rejected',
            'superseded',
          ]),
          issueCategoryRollup: tenantReviewRollup(tenantReviewItems, 'issueCategory', [
            'metadata_missing',
            'public_unsafe',
            'derivative_risk',
            'dual_read_unsafe',
            'manual_review_needed',
            'relationship_review',
            'safe_observe_only',
          ]),
          severityRollup: tenantReviewRollup(tenantReviewItems, 'severity', ['info', 'warning', 'critical']),
          priorityRollup: tenantReviewRollup(tenantReviewItems, 'priority', ['low', 'medium', 'high', 'urgent']),
          sourceEvidencePaths: [{ evidenceSourcePath: 'current_evidence_report', count: tenantReviewItems.length }],
          statusWorkflowAvailable: true,
          accessSwitchReady: false,
          backfillReady: false,
          tenantIsolationClaimed: false,
        },
        items: tenantReviewItems,
      },
    };
  }

  function tenantReviewPostCleanupReport() {
    const safeItem = tenantReviewItems.find((item) => item.id === 'ta_mri_static_pending_1');
    const activeItems = tenantReviewItems.filter((item) => item.id !== 'ta_mri_static_pending_1');
    return {
      ok: true,
      report: {
        ok: true,
        available: true,
        reportVersion: 'tenant-asset-manual-review-post-cleanup-v1',
        generatedAt: '2026-05-19T20:00:00.000Z',
        source: 'local_d1_read_only_post_cleanup_classifier',
        sourceEndpoint: '/api/admin/tenant-assets/manual-review/post-cleanup/dry-run',
        dryRun: true,
        domain: 'folders_images_manual_review_post_cleanup',
        postCleanupEvidencePath: 'docs/tenant-assets/evidence/2026-05-19-post-cleanup-rebaseline/',
        runtimeBehaviorChanged: false,
        accessChecksChanged: false,
        tenantIsolationClaimed: false,
        backfillPerformed: false,
        sourceAssetRowsMutated: false,
        reviewRowsMutated: false,
        d1Mutated: false,
        r2LiveListed: false,
        r2Mutated: false,
        productionReadiness: 'blocked',
        summary: {
          totalReviewItems: tenantReviewItems.length,
          scannedReviewItems: tenantReviewItems.length,
          activeCurrentItems: activeItems.length,
          supersededCandidates: safeItem ? 1 : 0,
          assetMissingCandidates: 0,
          ownerMetadataResolvedCandidates: safeItem ? 1 : 0,
          manualCleanupSupersededCandidates: 0,
          stillBlockedPublicUnsafe: tenantReviewItems.filter((item) => item.reviewStatus === 'blocked_public_unsafe').length,
          stillBlockedDerivativeRisk: tenantReviewItems.filter((item) => item.reviewStatus === 'blocked_derivative_risk').length,
          stillBlocked: activeItems.length,
          stillPendingManualReview: 0,
          stillDeferred: 0,
          unknownRequiresManualReview: 0,
          eventsCount: tenantReviewEvents.length,
          totalEvents: tenantReviewEvents.length,
          latestImportAt: '2026-05-17T13:02:00.000Z',
          latestStatusAt: tenantReviewEvents.map((event) => event.createdAt).sort().at(-1) || null,
          postCleanupEvidencePath: 'docs/tenant-assets/evidence/2026-05-19-post-cleanup-rebaseline/',
          tenantIsolationClaimed: false,
          accessSwitchReadiness: 'blocked',
          backfillReadiness: 'blocked',
          resetReadiness: 'blocked',
          d1Mutated: false,
          r2Mutated: false,
          categoryCounts: {
            active_current_review: 0,
            superseded_asset_missing: 0,
            superseded_after_manual_media_cleanup: 0,
            superseded_by_owner_metadata_present: safeItem ? 1 : 0,
            still_blocked_public_unsafe: tenantReviewItems.filter((item) => item.reviewStatus === 'blocked_public_unsafe').length,
            still_blocked_derivative_risk: tenantReviewItems.filter((item) => item.reviewStatus === 'blocked_derivative_risk').length,
            still_pending_manual_review: 0,
            still_deferred: 0,
            needs_legal_privacy_review: 0,
            unknown_requires_manual_review: 0,
          },
        },
        categoryCounts: {
          superseded_by_owner_metadata_present: safeItem ? 1 : 0,
          still_blocked_public_unsafe: tenantReviewItems.filter((item) => item.reviewStatus === 'blocked_public_unsafe').length,
          still_blocked_derivative_risk: tenantReviewItems.filter((item) => item.reviewStatus === 'blocked_derivative_risk').length,
        },
        safeSampleItems: safeItem ? [{
          ...safeItem,
          classification: 'superseded_by_owner_metadata_present',
          reason: 'current_source_asset_has_owner_metadata',
          supersessionEligible: true,
          sourceAsset: {
            sourceTable: 'ai_images',
            assetExists: true,
            ownershipMetadataPresent: true,
            publicReference: false,
            derivativeReference: false,
          },
        }] : [],
        activeSampleItems: activeItems.map((item) => ({
          ...item,
          classification: item.issueCategory === 'public_unsafe' ? 'still_blocked_public_unsafe' : 'still_blocked_derivative_risk',
          reason: 'current_blocker_still_present',
          supersessionEligible: false,
        })),
        blockedClaims: ['tenant_isolation', 'access_switch_readiness', 'ownership_backfill_readiness', 'confirmed_legacy_media_reset_readiness'],
        recommendedNextAction: 'Export this dry-run evidence, review safe candidates, then optionally run guarded supersession with exact confirmation.',
      },
    };
  }

  function filteredTenantReviewItems(url) {
    const params = url.searchParams;
    return tenantReviewItems.filter((item) => (
      (!params.get('reviewStatus') || item.reviewStatus === params.get('reviewStatus')) &&
      (!params.get('issueCategory') || item.issueCategory === params.get('issueCategory')) &&
      (!params.get('severity') || item.severity === params.get('severity')) &&
      (!params.get('priority') || item.priority === params.get('priority')) &&
      (!params.get('assetDomain') || item.assetDomain === params.get('assetDomain'))
    ));
  }

  await page.route(/\/api\/admin\/tenant-assets\/folders-images\/manual-review\/evidence\/export(?:\?.*)?$/, async (route) => {
    captures.tenantReviewEvidenceExportRequests.push({ url: route.request().url() });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'content-disposition': 'attachment; filename="tenant-asset-manual-review-evidence-static.json"',
      },
      body: JSON.stringify(tenantReviewEvidenceReport().report),
    });
  });
  await page.route(/\/api\/admin\/tenant-assets\/manual-review\/post-cleanup\/dry-run(?:\?.*)?$/, async (route) => {
    captures.tenantReviewPostCleanupDryRunRequests.push({ url: route.request().url() });
    await fulfillJson(route, tenantReviewPostCleanupReport());
  });
  await page.route(/\/api\/admin\/tenant-assets\/manual-review\/post-cleanup\/evidence(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    captures.tenantReviewPostCleanupEvidenceExportRequests.push({ url: route.request().url() });
    const format = url.searchParams.get('format') || 'json';
    const contentType = format === 'markdown' ? 'text/markdown' : format === 'html' ? 'text/html' : 'application/json';
    const extension = format === 'markdown' ? 'md' : format;
    await route.fulfill({
      status: 200,
      contentType,
      headers: {
        'content-disposition': `attachment; filename="tenant-asset-manual-review-post-cleanup-static.${extension}"`,
      },
      body: format === 'json'
        ? JSON.stringify(tenantReviewPostCleanupReport().report)
        : 'Manual Review Queue Post-Cleanup Supersession Evidence',
    });
  });
  await page.route(/\/api\/admin\/tenant-assets\/manual-review\/post-cleanup\/supersede$/, async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    captures.tenantReviewPostCleanupSupersedeRequests.push({
      idempotencyKey: request.headers()['idempotency-key'],
      body,
    });
    const safeItem = tenantReviewItems.find((item) => item.id === 'ta_mri_static_pending_1');
    if (!body.dryRun && safeItem) {
      const oldStatus = safeItem.reviewStatus;
      safeItem.reviewStatus = 'superseded';
      safeItem.reviewedAt = '2026-05-19T20:05:00.000Z';
      safeItem.updatedAt = '2026-05-19T20:05:00.000Z';
      tenantReviewEvents.push({
        id: 'ta_mre_static_superseded_1',
        reviewItemId: safeItem.id,
        eventType: 'superseded',
        oldStatus,
        newStatus: 'superseded',
        actorUserIdPresent: true,
        actorEmailPresent: false,
        reasonPresent: true,
        idempotencyKeyStoredAsHash: true,
        requestHashStored: true,
        eventMetadataSummary: { source: 'post_cleanup_supersession' },
        createdAt: '2026-05-19T20:05:00.000Z',
      });
    }
    await fulfillJson(route, {
      ok: true,
      supersession: {
        reportVersion: 'tenant-asset-manual-review-post-cleanup-supersede-v1',
        dryRun: body.dryRun !== false,
        rowsConsidered: safeItem ? 1 : 0,
        rowsSuperseded: body.dryRun === false && safeItem ? 1 : 0,
        rowsSkipped: Math.max(0, tenantReviewItems.length - 1),
        skippedByReason: { still_blocked_public_unsafe: 1, still_blocked_derivative_risk: 1 },
        eventRowsCreated: body.dryRun === false && safeItem ? 1 : 0,
        idempotency: { required: true, storedAs: 'sha256', replayed: false },
        d1Mutated: body.dryRun === false,
        r2Mutated: false,
        tenantIsolationClaimed: false,
      },
    });
  });
  await page.route(/\/api\/admin\/tenant-assets\/folders-images\/manual-review\/evidence(?:\?.*)?$/, async (route) => {
    await fulfillJson(route, tenantReviewEvidenceReport());
  });
  await page.route(/\/api\/admin\/tenant-assets\/folders-images\/manual-review\/items\/[^/]+\/status$/, async (route) => {
    const request = route.request();
    const itemId = decodeURIComponent(new URL(request.url()).pathname.split('/').at(-2) || '');
    const item = tenantReviewItems.find((entry) => entry.id === itemId);
    const body = request.postDataJSON();
    captures.tenantReviewStatusUpdateRequests.push({
      idempotencyKey: request.headers()['idempotency-key'],
      itemId,
      body,
    });
    if (!item) {
      await fulfillJson(route, { ok: false, code: 'tenant_asset_manual_review_item_not_found' }, 404);
      return;
    }
    const oldStatus = item.reviewStatus;
    item.reviewStatus = body.newStatus;
    item.reviewedAt = '2026-05-17T13:12:00.000Z';
    item.updatedAt = '2026-05-17T13:12:00.000Z';
    const event = {
      id: 'ta_mre_static_status_1',
      reviewItemId: item.id,
      eventType: body.newStatus === 'deferred' ? 'deferred' : body.newStatus === 'rejected' ? 'rejected' : 'status_changed',
      oldStatus,
      newStatus: body.newStatus,
      actorUserIdPresent: true,
      actorEmailPresent: false,
      reasonPresent: true,
      idempotencyKeyStoredAsHash: true,
      requestHashStored: true,
      eventMetadataSummary: { source: 'admin_control_plane', secretToken: '[redacted]' },
      createdAt: '2026-05-17T13:12:00.000Z',
    };
    tenantReviewEvents.push(event);
    await fulfillJson(route, {
      ok: true,
      statusUpdate: {
        reportVersion: 'tenant-asset-manual-review-status-v1',
        itemId: item.id,
        previousStatus: oldStatus,
        newStatus: body.newStatus,
        eventType: event.eventType,
        idempotency: { required: true, storedAs: 'sha256', replayed: false },
        item,
        event,
        noBackfill: true,
        noAccessSwitch: true,
        noSourceAssetMutation: true,
        noR2Operation: true,
        runtimeBehaviorChanged: false,
        accessChecksChanged: false,
        tenantIsolationClaimed: false,
        backfillPerformed: false,
        sourceAssetRowsMutated: false,
        ownershipMetadataUpdated: false,
        r2LiveListed: false,
        productionReadiness: 'blocked',
      },
    });
  });
  await page.route(/\/api\/admin\/tenant-assets\/folders-images\/manual-review\/items\/[^/]+\/events(?:\?.*)?$/, async (route) => {
    const itemId = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2) || '');
    await fulfillJson(route, {
      ok: true,
      reviewItemId: itemId,
      available: true,
      events: tenantReviewEvents.filter((event) => event.reviewItemId === itemId),
      limit: 25,
    });
  });
  await page.route(/\/api\/admin\/tenant-assets\/folders-images\/manual-review\/items\/[^/]+(?:\?.*)?$/, async (route) => {
    const itemId = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() || '');
    const item = tenantReviewItems.find((entry) => entry.id === itemId);
    if (!item) {
      await fulfillJson(route, { ok: false, code: 'tenant_asset_manual_review_item_not_found' }, 404);
      return;
    }
    await fulfillJson(route, {
      ok: true,
      item: {
        ...item,
        events: tenantReviewEvents.filter((event) => event.reviewItemId === item.id),
      },
    });
  });
  await page.route(/\/api\/admin\/tenant-assets\/folders-images\/manual-review\/items(?:\?.*)?$/, async (route) => {
    const items = filteredTenantReviewItems(new URL(route.request().url()));
    await fulfillJson(route, {
      ok: true,
      available: true,
      total: items.length,
      limit: 25,
      offset: 0,
      items,
      runtimeBehaviorChanged: false,
      accessChecksChanged: false,
      backfillPerformed: false,
      sourceAssetRowsMutated: false,
      reviewStatusesChanged: false,
      r2LiveListed: false,
    });
  });

  const lifecycleRequests = captures.lifecycleRequests || [
    {
      id: 'dlr_control_delete',
      type: 'delete',
      status: 'submitted',
      subjectUserId: 'user_member',
      dryRun: true,
      reason: 'Admin initiated GDPR/data erasure workflow from Admin user deletion. This intentionally long reason verifies the lifecycle detail overlay renders narrative legal context as a readable block instead of a cramped label/value row.',
      requestedByAdminId: 'admin_control',
      approvalRequired: true,
      createdAt: '2026-04-22T09:00:00.000Z',
      updatedAt: '2026-04-22T09:00:00.000Z',
      expiresAt: '2026-05-22T09:00:00.000Z',
    },
    {
      id: 'dlr_control_1',
      type: 'export',
      status: 'archive_generated',
      subjectUserId: 'user_member',
      dryRun: true,
      reason: 'Support export request',
      requestedByAdminId: 'admin_control',
      approvalRequired: true,
      createdAt: '2026-04-22T09:10:00.000Z',
      updatedAt: '2026-04-22T09:10:00.000Z',
      expiresAt: '2026-05-22T09:10:00.000Z',
    },
  ];
  const lifecycleItemsByRequest = {
    dlr_control_delete: [],
    dlr_control_1: [{
      id: 'dli_control_export_0001',
      resourceType: 'user',
      resourceId: 'user_member',
      tableName: 'users',
      action: 'export',
      status: 'planned',
      summary: { email: 'member@example.com', role: 'user', status: 'active' },
    }],
  };
  function lifecycleDetailPayload(requestId) {
    const request = lifecycleRequests.find((entry) => entry.id === requestId);
    return request ? { ok: true, request, items: lifecycleItemsByRequest[requestId] || [] } : null;
  }
  await page.route(/\/api\/admin\/data-lifecycle\/requests\/[^/]+\/evidence(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const requestId = decodeURIComponent(url.pathname.split('/').at(-2) || '');
    const format = url.searchParams.get('format') || 'json';
    captures.lifecycleEvidenceRequests.push({ requestId, format });
    if (format === 'html') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Data Lifecycle Evidence Packet</title><p>PDF-friendly storage: use browser print or Save as PDF.</p>',
      });
      return;
    }
    if (format === 'markdown') {
      await route.fulfill({
        status: 200,
        contentType: 'text/markdown',
        body: '# BITBI Data Lifecycle Evidence Packet\n\nNo legal completion claim.\n',
      });
      return;
    }
    await fulfillJson(route, {
      ok: true,
      evidence: {
        title: 'BITBI Data Lifecycle Evidence Packet',
        request: { id: requestId, status: lifecycleRequests.find((entry) => entry.id === requestId)?.status || 'submitted' },
        planSummary: { itemCount: (lifecycleItemsByRequest[requestId] || []).length },
        redaction: { privateR2KeysRendered: false },
      },
    });
  });
  await page.route(/\/api\/admin\/data-lifecycle\/requests\/[^/]+\/plan$/, async (route) => {
    const request = route.request();
    const requestId = decodeURIComponent(new URL(request.url()).pathname.split('/').at(-2) || '');
    captures.lifecyclePlanRequests.push({ requestId, idempotencyKey: request.headers()['idempotency-key'] });
    const row = lifecycleRequests.find((entry) => entry.id === requestId);
    if (row) {
      row.status = 'planned';
      row.updatedAt = '2026-04-22T09:20:00.000Z';
      lifecycleItemsByRequest[requestId] = [
        {
          id: 'dli_control_delete_0001',
          resourceType: 'user',
          resourceId: 'user_member',
          tableName: 'users',
          action: 'anonymize',
          status: 'planned',
          summary: { email: 'member@example.com', role: 'user', status: 'active' },
        },
        {
          id: 'dli_control_delete_0002',
          resourceType: 'session',
          tableName: 'sessions',
          action: 'revoke',
          status: 'planned',
          summary: { count: 1 },
        },
        {
          id: 'dli_control_delete_0003',
          resourceType: 'admin_audit_log',
          tableName: 'admin_audit_log',
          action: 'retain_or_anonymize',
          status: 'planned',
          summary: { count: 1 },
        },
      ];
      await fulfillJson(route, { ok: true, request: row, items: lifecycleItemsByRequest[requestId] });
      return;
    }
    await fulfillJson(route, { ok: false, code: 'request_not_found' }, 404);
  });
  await page.route(/\/api\/admin\/data-lifecycle\/requests\/[^/]+\/approve$/, async (route) => {
    const request = route.request();
    const requestId = decodeURIComponent(new URL(request.url()).pathname.split('/').at(-2) || '');
    captures.lifecycleApproveRequests.push({
      requestId,
      idempotencyKey: request.headers()['idempotency-key'],
      body: request.postDataJSON(),
    });
    const row = lifecycleRequests.find((entry) => entry.id === requestId);
    if (row) {
      row.status = 'approved';
      row.approvedAt = '2026-04-22T09:25:00.000Z';
      row.updatedAt = '2026-04-22T09:25:00.000Z';
      await fulfillJson(route, { ok: true, request: row });
      return;
    }
    await fulfillJson(route, { ok: false, code: 'request_not_found' }, 404);
  });
  await page.route(/\/api\/admin\/data-lifecycle\/requests\/[^/]+\/execute-safe$/, async (route) => {
    const request = route.request();
    const requestId = decodeURIComponent(new URL(request.url()).pathname.split('/').at(-2) || '');
    const body = request.postDataJSON();
    captures.lifecycleExecuteSafeRequests.push({
      requestId,
      idempotencyKey: request.headers()['idempotency-key'],
      body,
    });
    const row = lifecycleRequests.find((entry) => entry.id === requestId);
    if (row && body.dryRun === false) {
      row.status = 'safe_actions_completed';
      row.evidenceStatus = 'safe_actions_completed_evidence_available';
      row.updatedAt = '2026-04-22T09:30:00.000Z';
      for (const item of lifecycleItemsByRequest[requestId] || []) {
        if (item.tableName === 'sessions') item.status = 'completed';
      }
    }
    await fulfillJson(route, {
      ok: true,
      request: row,
      dryRun: body.dryRun !== false,
      destructiveActionsDisabled: true,
      actions: [{ tableName: 'sessions', action: 'revoke', status: body.dryRun === false ? 'completed' : 'would_execute' }],
    });
  });
  await page.route(/\/api\/admin\/data-lifecycle\/requests\/[^/]+\/complete$/, async (route) => {
    const request = route.request();
    const requestId = decodeURIComponent(new URL(request.url()).pathname.split('/').at(-2) || '');
    const body = request.postDataJSON();
    captures.lifecycleCompleteRequests.push({
      requestId,
      idempotencyKey: request.headers()['idempotency-key'],
      body,
    });
    const row = lifecycleRequests.find((entry) => entry.id === requestId);
    if (row) {
      row.status = 'completed_with_retention';
      row.finalStatus = 'completed_with_retention';
      row.evidenceStatus = 'complete_with_retention_evidence_recorded';
      row.completedAt = '2026-04-22T09:35:00.000Z';
      row.completedByUserId = 'admin_control';
      row.completionNote = body.completionNote;
      row.retainedCategories = ['admin_audit_user_activity_security', 'billing_credit_ledger', 'legal_compliance_retention', 'provider_webhook_evidence'];
      row.completionSummary = {
        finalStatus: row.finalStatus,
        retainedCategories: row.retainedCategories,
        categoryMatrix: [
          { id: 'auth_session_token_profile', label: 'Auth/session/token/profile', result: 'deleted', itemCount: 1 },
          { id: 'admin_audit_user_activity_security', label: 'Audit/activity/security', result: 'retained', itemCount: 1, retainedByPolicy: true },
        ],
      };
    }
    await fulfillJson(route, { ok: true, request: row, completion: row?.completionSummary || {} });
  });
  await page.route(/\/api\/admin\/data-lifecycle\/requests\/[^/]+\/reject$/, async (route) => {
    const request = route.request();
    const requestId = decodeURIComponent(new URL(request.url()).pathname.split('/').at(-2) || '');
    const body = request.postDataJSON();
    captures.lifecycleRejectRequests.push({
      requestId,
      idempotencyKey: request.headers()['idempotency-key'],
      body,
    });
    const row = lifecycleRequests.find((entry) => entry.id === requestId);
    if (row) {
      row.status = 'rejected';
      row.finalStatus = 'rejected';
      row.evidenceStatus = 'rejected_no_execution';
      row.rejectionReason = body.reason;
    }
    await fulfillJson(route, { ok: true, request: row, executesDataDeletion: false });
  });
  await page.route(/\/api\/admin\/data-lifecycle\/requests\/[^/]+\/close$/, async (route) => {
    const request = route.request();
    const requestId = decodeURIComponent(new URL(request.url()).pathname.split('/').at(-2) || '');
    const body = request.postDataJSON();
    captures.lifecycleCloseRequests.push({
      requestId,
      idempotencyKey: request.headers()['idempotency-key'],
      body,
    });
    const row = lifecycleRequests.find((entry) => entry.id === requestId);
    if (row) {
      row.status = body.finalStatus || 'closed';
      row.finalStatus = row.status;
      row.evidenceStatus = row.status === 'blocked_requires_legal_review' ? 'blocked_requires_legal_review' : 'closed_no_execution';
      row.closureReason = body.reason;
    }
    await fulfillJson(route, { ok: true, request: row, executesDataDeletion: false });
  });
  await page.route(/\/api\/admin\/data-lifecycle\/requests\/[^/]+\/generate-export$/, async (route) => {
    const request = route.request();
    const requestId = decodeURIComponent(new URL(request.url()).pathname.split('/').at(-2) || '');
    captures.lifecycleGenerateExportRequests.push({
      requestId,
      idempotencyKey: request.headers()['idempotency-key'],
      body: request.postDataJSON(),
    });
    await fulfillJson(route, { ok: true, archive: { id: 'dla_control_1', requestId, status: 'ready' } }, 201);
  });
  await page.route(/\/api\/admin\/data-lifecycle\/requests\/[^/]+\/export$/, async (route) => {
    const requestId = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2) || '');
    captures.lifecycleRequestExportRequests.push({ requestId });
    await fulfillJson(route, { ok: true, archive: { id: 'dla_control_1', requestId, status: 'ready' } });
  });
  await page.route(/\/api\/admin\/data-lifecycle\/requests\/[^/]+$/, async (route) => {
    const requestId = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() || '');
    const detail = lifecycleDetailPayload(requestId);
    if (!detail) {
      await fulfillJson(route, { ok: false, code: 'request_not_found' }, 404);
      return;
    }
    await fulfillJson(route, detail);
  });
  await page.route('**/api/admin/data-lifecycle/requests?*', async (route) => {
    await fulfillJson(route, {
      ok: true,
      requests: lifecycleRequests,
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

async function mockAuthenticatedAssetsManager(page, requests = [], options = {}) {
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
  const creditBalance = typeof options.creditBalance === 'number' ? options.creditBalance : 10;
  const userRole = options.userRole || 'user';

  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        loggedIn: true,
        user: {
          id: 'studio-user-1',
          email: 'studio@example.com',
          role: userRole,
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
          isAdmin: userRole === 'admin',
          creditBalance,
          dailyCreditAllowance: 10,
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
    if (typeof options.getAssetsHandler === 'function') {
      const handled = await options.getAssetsHandler(route, url, assetStore);
      if (handled !== false) return;
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
      size_bytes: Number(options.savedImageSizeBytes || body.size_bytes || 1024),
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

  await page.route('**/api/ai/text-assets/**', async (route) => {
    if (route.request().method() === 'PATCH' && /\/api\/ai\/text-assets\/[^/]+\/publication$/.test(new URL(route.request().url()).pathname)) {
      const assetId = route.request().url().split('/').slice(-2, -1)[0];
      const body = route.request().postDataJSON();
      const updated = assetStore.setAssetVisibility(assetId, body.visibility);
      if (!updated) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'Asset not found.' }),
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
    if (route.request().method() !== 'DELETE') {
      await route.fallback();
      return;
    }
    const assetId = route.request().url().split('/').pop();
    if (typeof options.deleteTextAssetHandler === 'function') {
      const handled = await options.deleteTextAssetHandler(route, assetId, assetStore);
      if (handled !== false) return;
    }
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
        billing: {
          credits_charged: 1,
          balance_after: Math.max(0, 10 - requests.length),
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
  linkedWallet = null,
  profilePatchStatus = 200,
  profilePatchBody = { ok: true },
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
        status: profilePatchStatus,
        contentType: 'application/json',
        body: JSON.stringify(profilePatchBody),
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

  await page.route('**/api/wallet/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        authenticated: true,
        linked_wallet: linkedWallet,
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
    const multipartBody = route.request().postData() || '';
    const filename = multipartBody.match(/filename="([^"]+)"/)?.[1] || null;
    const fileMimeType = multipartBody.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim() || null;
    avatarRequests.push({
      type: 'upload',
      contentType,
      filename,
      fileMimeType,
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
  await page.route('**/api/admin/orgs?*', async (route) => {
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
      session_id: 'cs_live_pricing_5000',
      mode: 'live',
      credit_pack: {
        id: route.request().postDataJSON().pack_id,
        credits: route.request().postDataJSON().pack_id === 'live_credits_12000' ? 12000 : 5000,
        amountCents: route.request().postDataJSON().pack_id === 'live_credits_12000' ? 1999 : 999,
        currency: 'eur',
      },
    }, 201);
  });
  await page.route('**/api/account/billing/checkout/live-credit-pack', async (route) => {
    checkoutRequests.push({
      body: route.request().postDataJSON(),
      idempotencyKey: route.request().headers()['idempotency-key'] || '',
      url: route.request().url(),
    });
    await fulfillJson(route, {
      ok: true,
      reused: false,
      checkout_url: checkoutUrl,
      session_id: 'cs_live_pricing_5000',
      mode: 'live',
      checkout_scope: 'member',
      authorization_scope: 'member',
      credit_pack: {
        id: route.request().postDataJSON().pack_id,
        credits: route.request().postDataJSON().pack_id === 'live_credits_12000' ? 12000 : 5000,
        amountCents: route.request().postDataJSON().pack_id === 'live_credits_12000' ? 1999 : 999,
        currency: 'eur',
      },
    }, 201);
  });
  await page.route('**/api/account/billing/checkout/live-credit-pack', async (route) => {
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
      checkout_scope: 'member',
      authorization_scope: 'member',
      credit_pack: {
        id: route.request().postDataJSON().pack_id,
        credits: route.request().postDataJSON().pack_id === 'live_credits_12000' ? 12000 : 5000,
        amountCents: route.request().postDataJSON().pack_id === 'live_credits_12000' ? 1999 : 999,
        currency: 'eur',
      },
    }, 201);
  });
  await page.route('**/api/account/billing/checkout/subscription', async (route) => {
    checkoutRequests.push({
      body: route.request().postDataJSON(),
      idempotencyKey: route.request().headers()['idempotency-key'] || '',
      url: route.request().url(),
    });
    await fulfillJson(route, {
      ok: true,
      reused: false,
      checkout_url: checkoutUrl,
      session_id: 'cs_live_subscription_pricing',
      mode: 'live',
      checkout_scope: 'member_subscription',
      authorization_scope: 'member',
      subscription_plan: {
        id: 'bitbi_pro_monthly',
        name: 'BITBI Pro',
        amountCents: 999,
        currency: 'eur',
      },
    }, 201);
  });

  return { checkoutRequests };
}

function creditLedgerIso(monthOffset, day, hour = 12, minute = 0) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + monthOffset, day, hour, minute).toISOString();
}

function makeCreditLedgerRows({ prefix, label, monthOffset, count, startBalance = 100 }) {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: `${prefix}_${number}`,
      type: number % 2 ? 'usage_charge' : 'manual_grant',
      entryType: number % 2 ? 'consume' : 'grant',
      source: number % 2 ? 'member_ai_image_generate' : 'manual_admin_grant',
      featureKey: 'ai.image.generate',
      amount: number % 2 ? -1 : 2,
      balanceAfter: startBalance - number,
      createdAt: creditLedgerIso(monthOffset, 24 - number, 12, number),
      description: `${label} ${number}`,
      usage: number % 2 ? {
        model: 'flux-1-schnell',
        action: 'image_generation',
        pricingSource: 'org_image_credit_catalog',
      } : undefined,
      createdByEmail: number % 2 ? undefined : 'admin@bitbi.ai',
    };
  });
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
  memberDashboard = null,
  checkoutRequests = [],
  subscriptionManageRequests = [],
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
  const defaultMemberDashboard = memberDashboard || {
    account: {
      userId: `${role}-credits-user`,
      email,
      role,
      status: 'active',
    },
    balance: {
      current: 10,
      available: 10,
      dailyAllowance: 10,
      lifetimeIncoming: 17,
      lifetimeDailyTopUps: 7,
      lifetimeManualGrants: 10,
      lifetimeConsumed: 1,
    },
    dailyTopUp: {
      dayStart: '2026-05-01T00:00:00.000Z',
      grantedCredits: 7,
      reused: false,
      dailyAllowance: 10,
    },
    liveCheckout: {
      enabled: true,
      configured: true,
      mode: 'live',
    },
    packs: [
      { id: 'live_credits_5000', name: '5000 Credit Pack', credits: 5000, amountCents: 999, currency: 'eur', displayPrice: '9,99 €' },
      { id: 'live_credits_12000', name: '12000 Credit Pack', credits: 12000, amountCents: 1999, currency: 'eur', displayPrice: '19,99 €' },
    ],
    purchaseHistory: [],
    transactions: [{
      id: 'mcl_member_usage',
      type: 'usage_charge',
      entryType: 'consume',
      source: 'member_ai_image_generate',
      featureKey: 'ai.image.generate',
      amount: -1,
      balanceAfter: 9,
      createdAt: '2026-05-01T12:10:00.000Z',
      description: 'Image generation charge for flux-1-schnell',
      usage: {
        id: 'ue_member_usage',
        featureKey: 'ai.image.generate',
        quantity: 1,
        creditsDelta: -1,
        status: 'succeeded',
        model: 'flux-1-schnell',
        action: 'image_generation',
        pricingSource: 'org_image_credit_catalog',
      },
    }, {
      id: 'mcl_member_grant',
      type: 'manual_grant',
      entryType: 'grant',
      source: 'manual_admin_grant',
      amount: 10,
      balanceAfter: 10,
      createdAt: '2026-05-01T11:00:00.000Z',
      description: 'Member support adjustment',
      createdByEmail: 'admin@bitbi.ai',
    }, {
      id: 'mcl_member_topup',
      type: 'daily_top_up',
      entryType: 'grant',
      source: 'daily_member_top_up',
      amount: 7,
      balanceAfter: 10,
      createdAt: '2026-05-01T00:00:00.000Z',
      description: 'Daily member credit top-up to 10 credits',
    }],
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
  await page.route('**/api/account/credits-dashboard*', async (route) => {
    await fulfillJson(route, { ok: true, dashboard: defaultMemberDashboard });
  });
  await page.route('**/api/account/billing/subscription/cancel', async (route) => {
    subscriptionManageRequests.push({
      action: 'cancel',
      body: route.request().postDataJSON(),
      idempotencyKey: route.request().headers()['idempotency-key'] || '',
    });
    defaultMemberDashboard.hasActiveSubscription = true;
    defaultMemberDashboard.cancelAtPeriodEnd = true;
    defaultMemberDashboard.canCancelSubscription = false;
    defaultMemberDashboard.canReactivateSubscription = true;
    if (defaultMemberDashboard.subscription) {
      defaultMemberDashboard.subscription.cancelAtPeriodEnd = true;
      defaultMemberDashboard.subscription.canCancelSubscription = false;
      defaultMemberDashboard.subscription.canReactivateSubscription = true;
    }
    await fulfillJson(route, {
      ok: true,
      action: 'cancel',
      reused: false,
      subscription: {
        providerSubscriptionId: 'sub_member_pro_mock',
        status: 'active',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: defaultMemberDashboard.subscriptionPeriodEnd || '2026-06-01T00:00:00.000Z',
      },
    });
  });
  await page.route('**/api/account/billing/subscription/reactivate', async (route) => {
    subscriptionManageRequests.push({
      action: 'reactivate',
      body: route.request().postDataJSON(),
      idempotencyKey: route.request().headers()['idempotency-key'] || '',
    });
    defaultMemberDashboard.hasActiveSubscription = true;
    defaultMemberDashboard.cancelAtPeriodEnd = false;
    defaultMemberDashboard.canCancelSubscription = true;
    defaultMemberDashboard.canReactivateSubscription = false;
    if (defaultMemberDashboard.subscription) {
      defaultMemberDashboard.subscription.cancelAtPeriodEnd = false;
      defaultMemberDashboard.subscription.canCancelSubscription = true;
      defaultMemberDashboard.subscription.canReactivateSubscription = false;
    }
    await fulfillJson(route, {
      ok: true,
      action: 'reactivate',
      reused: false,
      subscription: {
        providerSubscriptionId: 'sub_member_pro_mock',
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: defaultMemberDashboard.subscriptionPeriodEnd || '2026-06-01T00:00:00.000Z',
      },
    });
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

  return { checkoutRequests, subscriptionManageRequests };
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
    await expectAuthContextRemoved(page);
    await expect(form.locator('input[name="email"]')).toBeVisible();
    await expect(form.locator('input[name="password"]')).toBeVisible();
    await expect(form.locator('a[href="/account/forgot-password.html"]')).toHaveText('Forgot password?');
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

  test('shows clear registration-disabled message in English signup modal', async ({ page }) => {
    await page.route('**/api/register', async (route) => {
      await fulfillJson(route, {
        ok: false,
        code: 'registration_temporarily_disabled',
        error: 'Registrations are temporarily disabled due to maintenance work. Please try again later.',
      }, 403);
    });

    await page.locator('.site-nav__cta').click();
    await page.locator('[data-tab="register"]').click();
    const form = page.locator('#authRegisterForm');
    await form.locator('input[name="email"]').fill('new-user@example.com');
    await form.locator('input[name="password"]').fill('password123');
    await form.getByRole('button', { name: /create account/i }).click();
    await expect(page.locator('#authRegisterMsg')).toHaveText('Registrations are temporarily disabled due to maintenance work. Please try again later.');
  });

  test('shows clear registration-disabled message in German signup modal', async ({ page }) => {
    await page.route('**/api/register', async (route) => {
      await fulfillJson(route, {
        ok: false,
        code: 'registration_temporarily_disabled',
        error: 'Registrations are temporarily disabled due to maintenance work. Please try again later.',
      }, 403);
    });
    await page.goto('/de/');
    await expect(page.locator('.site-nav__cta')).toBeVisible({ timeout: 10_000 });

    await page.locator('.site-nav__cta').click();
    await page.locator('[data-tab="register"]').click();
    const form = page.locator('#authRegisterForm');
    await form.locator('input[name="email"]').fill('neue-person@example.com');
    await form.locator('input[name="password"]').fill('password123');
    await form.getByRole('button', { name: /konto erstellen/i }).click();
    await expect(page.locator('#authRegisterMsg')).toHaveText('Registrierungen sind wegen Wartungsarbeiten vorübergehend deaktiviert. Bitte versuche es später erneut.');
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
    const trust = page.locator('#accountRecoveryTrust');
    await expect(trust.locator('summary')).toContainText('Account recovery is private');
    await expect(trust.locator('.auth-page__disclosure-body')).not.toBeVisible();
    await expect.poll(() => trust.evaluate((element) => element.hasAttribute('open'))).toBe(false);
    await trust.locator('summary').click();
    await expect.poll(() => trust.evaluate((element) => element.hasAttribute('open'))).toBe(true);
    await expect(trust.locator('.auth-page__disclosure-body')).toContainText('same success message whether or not an email exists');
    await expect(page.locator('#accountRecoveryNext')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Return to the signed-in workspace');

    await page.locator('#bitbiHelpTrigger').click();
    const recoveryHelp = page.locator('[data-help-section="recovery"]');
    await recoveryHelp.locator('summary.help-menu__section-toggle').click();
    const afterRecovery = recoveryHelp.locator('.help-menu__item').filter({ hasText: 'After recovery' });
    await expect(afterRecovery.locator('summary')).toContainText('After recovery');
    await expect(afterRecovery.locator('.help-menu__item-body')).not.toBeVisible();
    await afterRecovery.locator('summary').click();
    await expect(afterRecovery.locator('.help-menu__item-body')).toBeVisible();
    await expect(afterRecovery.locator('.help-menu__item-body')).toContainText('Password reset only repairs access');
    await expect(afterRecovery.locator('a[href="/account/profile.html?returnContext=recovery&source=help-recovery#profileCompletionCard"]')).toHaveText('Open Profile');
    await expect(afterRecovery.locator('a[href="/account/credits.html?scope=member&source=help-recovery"]')).toHaveText('Review Credits');
  });

  test('reset password page loads with state containers', async ({ page }) => {
    const response = await page.goto('/account/reset-password.html');
    expect(response.status()).toBe(200);
    // Without a valid token, both state containers should exist in the DOM
    await expect(page.locator('#loadingState')).toBeAttached();
    await expect(page.locator('#invalidState')).toBeAttached();
    await expect(page.locator('#resetSecurityTrust')).toBeAttached();
    await expect(page.locator('#resetRecoveryContinuity')).toContainText('Use the newest reset email');
    await expect(page.locator('#resetRecoveryContinuity a[href="/account/assets-manager.html?source=reset-password&recent=1#generate-lab-recent"]')).toHaveText('Open Assets Manager');
    await expect(page.locator('#successState [data-auth-entry="login"]')).toHaveText('Sign in again');
  });

  test('reset password failure uses safe recovery copy instead of raw backend errors', async ({ page }) => {
    await page.route('**/api/reset-password/validate**', async (route) => {
      await route.fulfill({ status: 200, json: { valid: true } });
    });
    await page.route(/\/api\/reset-password$/, async (route) => {
      await route.fulfill({
        status: 500,
        json: { ok: false, error: 'raw reset backend token failure' },
      });
    });

    const response = await page.goto('/account/reset-password?token=valid-reset-token');
    expect(response.status()).toBe(200);
    await expect(page.locator('#formState')).toBeVisible({ timeout: 10_000 });
    await page.locator('#passwordInput').fill('new-password-123');
    await page.locator('#confirmInput').fill('new-password-123');
    await page.locator('#resetForm').getByRole('button', { name: 'Change Password' }).click();

    await expect(page.locator('#formMsg')).toContainText('Could not change the password.');
    await expect(page.locator('#formMsg')).not.toContainText('raw reset backend');
    await expect(page.locator('#resetRecoveryContinuity')).toContainText('Request new link');
  });

  test('verify email page loads with state containers', async ({ page }) => {
    const response = await page.goto('/account/verify-email.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#loadingState')).toBeAttached();
    await expect(page.locator('#invalidState')).toBeAttached();
    await expect(page.locator('#invalidState')).toContainText('Email confirmation is checked by the backend account record');
    await expect(page.locator('#verifyRecoveryContinuity')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Verification continuity');
    await expect(page.locator('body')).not.toContainText('Email status protects account-bound work');
    await expect(page.locator('#successState [data-auth-entry="login"]')).toHaveText('Sign in');
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
    await expect(page.locator('#deniedState')).toContainText('Sign in to open your profile');
    await expect(page.locator('#deniedState [data-auth-entry="login"]')).toHaveText('Sign in');
    await expect(page.locator('#deniedState [data-auth-message-key="authRecovery.profileMessage"]')).toHaveCount(2);
    await page.locator('#deniedState [data-auth-entry="login"]').first().click();
    await expect(page.locator('.auth-modal__overlay.active')).toBeVisible();
    await expect(page.locator('#authLoginMsg')).toContainText('Sign in to continue to your profile. Create an account if you are new to BITBI.');
    await expectAuthContextRemoved(page);
    await expect(page.locator('#authLoginForm input[name="email"]')).toBeVisible();
    await expect(page.locator('#authLoginForm a[href="/account/forgot-password.html"]')).toHaveText('Forgot password?');
    await page.keyboard.press('Escape');
    await expect(page.locator('#deniedState a[href="/account/forgot-password.html?source=profile"]')).toHaveText('Reset password');
    await expect(page.locator('#deniedState')).toContainText('complete email verification after sign-in');
    await expect(page.locator('#profileCompletionCard')).toBeAttached();
    await expect(page.locator('#profileSecurityCard')).toHaveCount(0);
    await expect(page.locator('#profileContent')).not.toBeVisible();
  });

  test('profile page shows session-expired recovery when account API returns 401', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await fulfillJson(route, { ok: false, error: 'raw session backend detail' }, 401);
    });
    await page.route('**/api/profile', async (route) => {
      await fulfillJson(route, { ok: false, error: 'raw profile backend detail' }, 401);
    });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#deniedState')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#deniedState')).toContainText('Session expired. Sign in again.');
    await expect(page.locator('#deniedState')).toContainText('Your profile stayed private because this request was not authorized.');
    await expect(page.locator('#deniedState [data-auth-entry="login"]')).toHaveText('Sign in again');
    await expect(page.locator('#deniedState')).not.toContainText('raw profile backend');
  });

  test('assets manager page shows denied state without auth', async ({ page }) => {
    const response = await page.goto('/account/assets-manager.html');
    expect(response.status()).toBe(200);
    // JS calls /api/me → 404 on local server → shows denied state
    await expect(page.locator('#deniedState')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('#deniedState')).toContainText('Sign in to open Assets Manager');
    await expect(page.locator('#deniedState [data-auth-entry="login"]')).toHaveText('Sign in');
    await expect(page.locator('#deniedState [data-auth-message-key="authRecovery.assetsMessage"]')).toHaveCount(2);
    await page.locator('#deniedState [data-auth-entry="login"]').first().click();
    await expect(page.locator('.auth-modal__overlay.active')).toBeVisible();
    await expect(page.locator('#authLoginMsg')).toContainText('Sign in to open your private Assets Manager. Create an account before saving outputs.');
    await expectAuthContextRemoved(page);
    await expect(page.locator('#authLoginForm input[name="email"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#deniedState a[href="/account/forgot-password.html?source=assets-manager"]')).toHaveText('Reset password');
    await expect(page.locator('#studioContent')).not.toBeVisible();
  });

  test('assets manager page shows session-expired recovery when account API returns 403', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await fulfillJson(route, { ok: false, error: 'raw forbidden asset detail' }, 403);
    });

    const response = await page.goto('/account/assets-manager.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#deniedState')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#deniedState')).toContainText('Session expired. Sign in again.');
    await expect(page.locator('#deniedState')).toContainText('Assets Manager could not load private library data');
    await expect(page.locator('#deniedState [data-auth-entry="login"]')).toHaveText('Sign in again');
    await expect(page.locator('#deniedState')).not.toContainText('raw forbidden');
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
    await expect(page.locator('#adminMfaNotice')).toContainText('Admin access cannot be bypassed from this page.');
    await expect(page.locator('#adminMfaSetupBtn')).toBeFocused();
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
    await expect(page.locator('#adminMfaNotice')).toContainText('cannot bypass MFA');
    await expect(page.locator('#adminMfaVerifyCode')).toBeFocused();
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

  test('desktop shared header places no-avatar account controls in the right header package', async ({
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

    await expect(page.locator('.site-nav__mood')).toBeHidden();
    await expect(page.locator('.site-nav__links .auth-nav__profile-link')).toHaveCount(0);
    await expect(page.locator('.site-nav__actions .auth-nav__profile-link')).toBeVisible();
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

  test('removes Pricing from shared headers while keeping member/admin nav intact', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await fulfillJson(route, { loggedIn: false, user: null });
    });
    await page.goto('/');
    await expect(page.locator('.site-nav__links').getByRole('link', { name: 'Pricing' })).toHaveCount(0);
    await expect
      .poll(() => page.locator('.site-nav__links > a').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Gallery', 'Video', 'Sound Lab']);

    await page.unroute('**/api/me');
    await mockAuthenticatedHeader(page, { role: 'user', email: 'member-pricing@bitbi.ai' });
    await page.goto('/');
    await expect(page.locator('.site-nav__links').getByRole('link', { name: 'Pricing' })).toHaveCount(0);

    await page.unroute('**/api/me');
    await mockAuthenticatedHeader(page, { role: 'admin', email: 'admin-pricing@bitbi.ai' });
    await page.goto('/');
    await expect(page.locator('.site-nav__links').getByRole('link', { name: 'Pricing' })).toHaveCount(0);
    await expect
      .poll(() => page.locator('.site-nav__links > a').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Gallery', 'Video', 'Sound Lab']);
    await expect(page.locator('.site-nav__actions .auth-nav__profile-link')).toBeVisible();
    await expect(page.locator('.site-nav__actions .auth-nav__admin-link')).toBeVisible();

    await page.unroute('**/api/me');
    await page.route('**/api/me', async (route) => {
      await fulfillJson(route, { loggedIn: false, user: null });
    });
    await page.goto('/de/');
    await expect(page.locator('.site-nav__links').getByRole('link', { name: 'Preise' })).toHaveCount(0);
    await expect
      .poll(() => page.locator('.site-nav__links > a').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Galerie', 'Video', 'Sound Lab']);
  });

  test('removes the public Pricing link from English and German mobile menus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/me', async (route) => {
      await fulfillJson(route, { loggedIn: false, user: null });
    });

    await page.goto('/');
    await page.locator('#mobileMenuBtn').click();
    const mobileExplore = page.locator('#mobileNav .mobile-nav__section[aria-label="Explore"]');
    await expect(mobileExplore.getByRole('link', { name: 'Pricing' })).toHaveCount(0);
    await expect(mobileExplore).toContainText('Gallery');

    await page.goto('/de/');
    await page.locator('#mobileMenuBtn').click();
    const mobileExploreDe = page.locator('#mobileNav .mobile-nav__section[aria-label="Entdecken"]');
    await expect(mobileExploreDe.getByRole('link', { name: 'Preise' })).toHaveCount(0);
    await expect(mobileExploreDe).toContainText('Galerie');
  });

  test('keeps direct Pricing access public for logged-out and member visitors', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await fulfillJson(route, { loggedIn: false, user: null });
    });
    await page.goto('/pricing.html');
    await expect(page.locator('.pricing-hero__title')).toHaveText('BITBI Credits & Pro');
    await expect(page.locator('.pricing-hero__subtitle')).toHaveText('Flexible credits for image, video, music, and asset generation.');
    await expect(page.locator('.pricing-hero__link')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Choose BITBI Pro for a monthly creative allowance');
    await expect(page.locator('main')).not.toContainText('Start creating');
    await expect(page.locator('main')).not.toContainText('Choose credits');
    await expect(page.locator('main')).not.toContainText('Compare options');
    await expect(page.locator('.pricing-card')).toHaveCount(4);
    await expect(page.locator('.pricing-card__title')).toHaveText(['Free Account', 'BITBI Pro', 'Starter Credits', 'Creator Credits']);
    await expect(page.locator('[data-pricing-auth-entry="register"]')).toHaveText('Create account');
    await expect(page.locator('[data-subscription-checkout="bitbi_pro_monthly"]')).toHaveText('Create account to buy');
    await expect(page.locator('[data-pricing-pack="live_credits_5000"]')).toHaveText('Create account to buy');
    await expect(page.locator('#pricingDecision')).toHaveCount(0);
    await expect(page.locator('#pricingJourney')).toHaveCount(0);
    await expect(page.locator('#pricingContinuity')).toHaveCount(0);
    await expect(page.locator('#pricingAccountEntry')).toHaveCount(0);

    await page.unroute('**/api/me');
    await mockPricingAccount(page, { role: 'user', email: 'member-pricing@bitbi.ai' });
    await page.goto('/pricing.html');
    await expect(page.locator('.pricing-card')).toHaveCount(4);
    await expect(page.locator('[data-pricing-account-link="profile"]')).toHaveAttribute('href', '/account/profile.html');
    await expect(page.locator('[data-subscription-checkout="bitbi_pro_monthly"]')).toHaveText('BITBI Pro selected');
    await expect(page.locator('[data-pricing-pack="live_credits_12000"]')).toHaveText('Select pack');
    await expect(page.locator('#pricingOrgSelect')).toHaveCount(0);
    await expect(page.locator('.pricing-org__state')).toContainText('member account');
    await expect(page.locator('.pricing-org__state')).toContainText('No organization setup');
    await expect(page.locator('#pricingAccountEntry')).toHaveCount(0);
  });

  test('logged-out Pricing CTA opens registration instead of Stripe checkout', async ({ page }) => {
    let checkoutRequests = 0;
    await page.route('**/api/me', async (route) => {
      await fulfillJson(route, { loggedIn: false, user: null });
    });
    await page.route('**/api/account/billing/checkout/live-credit-pack', async (route) => {
      checkoutRequests += 1;
      await fulfillJson(route, { ok: false, error: 'unexpected checkout request' }, 500);
    });
    await page.goto('/pricing.html');
    await page.locator('[data-pricing-auth-entry="register"]').click();
    await expect(page.locator('.auth-modal__overlay')).toHaveClass(/active/);
    await expect(page.locator('.auth-modal__tab[data-tab="register"]')).toHaveClass(/active/);
    await expect(page.locator('#authRegisterMsg')).toHaveText('Create a free BITBI account to continue.');
    await expectAuthContextRemoved(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.auth-modal__overlay')).not.toHaveClass(/active/);
    await page.locator('[data-pricing-pack="live_credits_5000"]').click();
    await expect(page.locator('.auth-modal__overlay')).toHaveClass(/active/);
    await expect(page.locator('.auth-modal__tab[data-tab="register"]')).toHaveClass(/active/);
    await expect(page.locator('#authRegisterForm')).toHaveClass(/active/);
    await expect(page.locator('#authRegisterMsg')).toHaveText('Create an account or sign in to buy credits.');
    await expectAuthContextRemoved(page);
    await expect(page.locator('#authRegisterForm input[name="email"]')).toBeVisible();
    const pendingPack = await page.evaluate(() => sessionStorage.getItem('bitbi_pending_credit_pack'));
    expect(pendingPack).toBe('live_credits_5000');
    expect(checkoutRequests).toBe(0);
  });

  test('German logged-out Pricing CTA opens registration with localized copy instead of checkout', async ({ page }) => {
    let checkoutRequests = 0;
    await page.route('**/api/me', async (route) => {
      await fulfillJson(route, { loggedIn: false, user: null });
    });
    await page.route('**/api/account/billing/checkout/live-credit-pack', async (route) => {
      checkoutRequests += 1;
      await fulfillJson(route, { ok: false, error: 'unexpected checkout request' }, 500);
    });
    await page.goto('/de/pricing.html');
    await page.locator('[data-pricing-auth-entry="register"]').click();
    await expect(page.locator('.auth-modal__overlay')).toHaveClass(/active/);
    await expect(page.locator('.auth-modal__tab[data-tab="register"]')).toHaveClass(/active/);
    await expect(page.locator('#authRegisterMsg')).toHaveText('Erstellen Sie ein kostenloses BITBI-Konto, um fortzufahren.');
    await expectAuthContextRemoved(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.auth-modal__overlay')).not.toHaveClass(/active/);
    await page.locator('[data-pricing-pack="live_credits_5000"]').click();
    await expect(page.locator('.auth-modal__overlay')).toHaveClass(/active/);
    await expect(page.locator('.auth-modal__tab[data-tab="register"]')).toHaveClass(/active/);
    await expect(page.locator('#authRegisterForm')).toHaveClass(/active/);
    await expect(page.locator('#authRegisterMsg')).toHaveText('Erstelle ein Konto oder melde dich an, um Credits zu kaufen.');
    await expectAuthContextRemoved(page);
    await expect(page.locator('#authRegisterForm input[name="email"]')).toBeVisible();
    const pendingPack = await page.evaluate(() => sessionStorage.getItem('bitbi_pending_credit_pack'));
    expect(pendingPack).toBe('live_credits_5000');
    expect(checkoutRequests).toBe(0);
  });

  test('renders the live credit-pack tiers without stale Testmode pricing copy', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockPricingAccount(page);
    const response = await page.goto('/pricing.html');
    expect(response.status()).toBe(200);

    await expect(page.locator('.pricing-hero__title')).toHaveText('BITBI Credits & Pro');
    await expect(page.locator('.pricing-hero__subtitle')).toHaveText('Flexible credits for image, video, music, and asset generation.');
    await expect(page.locator('.pricing-hero__link')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Choose BITBI Pro for a monthly creative allowance');
    await expect(page.locator('main')).not.toContainText('Start creating');
    await expect(page.locator('main')).not.toContainText('Choose credits');
    await expect(page.locator('main')).not.toContainText('Compare options');
    await expect(page.locator('body')).not.toContainText(/Test ?mode/i);
    await expect(page.locator('.pricing-card')).toHaveCount(4);
    await expect(page.locator('.pricing-card__title')).toHaveText(['Free Account', 'BITBI Pro', 'Starter Credits', 'Creator Credits']);
    await expect(page.locator('.pricing-card').nth(0)).toContainText('0 €');
    await expect(page.locator('.pricing-card').nth(0)).toContainText('No paid credits included');
    await expect(page.locator('.pricing-card').nth(1)).toContainText('9,99 €');
    await expect(page.locator('.pricing-card').nth(1)).toContainText('/ month');
    await expect(page.locator('.pricing-card').nth(2)).toContainText('9.99 €');
    await expect(page.locator('.pricing-card').nth(3)).toContainText('19.99 €');
    await expect(page.locator('.pricing-card').nth(3)).toContainText('Best value');
    await expect(page.locator('.pricing-legal')).toContainText('I accept the BITBI Terms.');
    await expect(page.locator('.pricing-legal')).toContainText('immediate provision of the credits');
    await expect(page.locator('.pricing-legal a[href="/legal/terms.html"]')).toHaveAttribute('rel', /noopener/);
    const pricingTitles = await page.locator('.pricing-card__title').evaluateAll((nodes) =>
      nodes.map((node) => node.textContent.trim()),
    );
    expect(pricingTitles.some((title) => /10,?000 Credits/i.test(title))).toBe(false);
    await expect(page.locator('[data-subscription-checkout="bitbi_pro_monthly"]')).toHaveText('BITBI Pro selected');
    await expect(page.locator('[data-pricing-pack="live_credits_5000"]')).toHaveText('Select pack');
    await expect(page.locator('[data-pricing-pack="live_credits_12000"]')).toHaveText('Select pack');
    await expect(page.locator('#pricingBillingState')).toHaveCount(0);
    await expect(page.locator('#pricingDecision')).toHaveCount(0);
    await expect(page.locator('#pricingGuide')).toHaveCount(0);
    await expect(page.locator('#pricingJourney')).toHaveCount(0);
    await expect(page.locator('#pricingContinuity')).toHaveCount(0);
    await expect(page.locator('#pricingAccountEntry')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Pick the option that fits today');
    await expect(page.locator('main')).not.toContainText('From pricing to the workspace');
    await expect(page.locator('main')).not.toContainText('From plan choice to the next prompt');
    await expect(page.locator('main')).not.toContainText('Your member path is ready');
    await expect(page.locator('.pricing-faq')).toContainText('Can I cancel BITBI Pro?');
    await expect(page.locator('.pricing-faq')).toContainText('Are credits transferable?');
    await expect(page.locator('.pricing-faq')).toContainText('Is checkout secure?');
    await expect(page.locator('.pricing-legal')).toContainText('Secure payment continues on pay.bitbi.ai.');
    await expect(page.locator('.pricing-org__state')).toContainText('not tokens, currency, crypto, or transferable value');
    await expect(page.locator('body')).not.toContainText('/api/admin');

    const pricingSpacing = await page.evaluate(() => {
      const header = document.querySelector('.site-nav__bar')?.getBoundingClientRect();
      const hero = document.querySelector('.pricing-hero')?.getBoundingClientRect();
      const title = document.querySelector('.pricing-hero__title')?.getBoundingClientRect();
      const subtitle = document.querySelector('.pricing-hero__subtitle')?.getBoundingClientRect();
      const priceOffsets = Array.from(document.querySelectorAll('.pricing-card__price')).map((node) => {
        const value = node.querySelector('.pricing-card__price-value')?.getBoundingClientRect();
        const box = node.getBoundingClientRect();
        return value ? value.top - box.top : 0;
      });
      return {
        heroHeight: hero?.height || 0,
        titleHeaderGap: title && header ? title.top - header.bottom : 999,
        subtitleGap: title && subtitle ? subtitle.top - title.bottom : 999,
        priceOffsets,
      };
    });
    expect(pricingSpacing.heroHeight).toBeGreaterThanOrEqual(145);
    expect(pricingSpacing.heroHeight).toBeLessThanOrEqual(260);
    expect(pricingSpacing.titleHeaderGap).toBeGreaterThanOrEqual(0);
    expect(pricingSpacing.titleHeaderGap).toBeLessThanOrEqual(90);
    expect(pricingSpacing.subtitleGap).toBeLessThanOrEqual(16);
    expect(pricingSpacing.priceOffsets.every((offset) => offset < -1)).toBe(true);

    const layoutMetrics = await page.locator('.pricing-card').evaluateAll((cards) => cards.map((card) => ({
      width: card.getBoundingClientRect().width,
      top: Math.round(card.getBoundingClientRect().top),
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    })));
    expect(layoutMetrics.every((entry) => entry.width >= 240)).toBe(true);
    expect(new Set(layoutMetrics.map((entry) => entry.top)).size).toBe(1);
    expect(layoutMetrics.every((entry) => entry.scrollWidth <= entry.viewportWidth + 1)).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[data-pricing-auth-entry="register"], [data-pricing-account-link="profile"]')).toBeVisible();
    await expect(page.locator('[data-subscription-checkout="bitbi_pro_monthly"]')).toBeVisible();
    await expect(page.locator('[data-pricing-pack="live_credits_5000"]')).toBeVisible();
    await expect(page.locator('[data-pricing-pack="live_credits_12000"]')).toBeVisible();
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(mobileOverflow).toBeLessThanOrEqual(1);
  });

  test('logged-in Pricing checkout requires both legal confirmations before live checkout', async ({ page }) => {
    await page.route('https://pay.bitbi.ai/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Stripe Checkout</title><main>Stripe-hosted checkout</main>',
      });
    });
    const { checkoutRequests } = await mockPricingAccount(page, {
      role: 'user',
      email: 'member-pricing@bitbi.ai',
      checkoutUrl: 'https://pay.bitbi.ai/c/pay/cs_live_pricing_5000',
    });
    await page.goto('/pricing.html');
    await page.locator('[data-pricing-pack="live_credits_12000"]').click();

    await page.locator('.pricing-legal__checkout').click();
    await expect(page.locator('.pricing-result--error')).toContainText('Please accept the Terms');
    expect(checkoutRequests).toHaveLength(0);

    await page.locator('.pricing-legal__check').nth(0).locator('input').check();
    await page.locator('.pricing-legal__checkout').click();
    await expect(page.locator('.pricing-result--error')).toContainText('Please accept the Terms');
    expect(checkoutRequests).toHaveLength(0);

    await page.locator('.pricing-legal__check').nth(1).locator('input').check();
    await page.locator('.pricing-legal__checkout').click();
    await expect.poll(() => checkoutRequests.length).toBe(1);
    expect(checkoutRequests[0].body).toEqual(expect.objectContaining({
      pack_id: 'live_credits_12000',
      terms_accepted: true,
      terms_version: '2026-05-05',
      immediate_delivery_accepted: true,
    }));
    expect(checkoutRequests[0].url).toContain('/api/account/billing/checkout/live-credit-pack');
    expect(checkoutRequests[0].idempotencyKey).toMatch(/^pricing-member-live:/);
    await expect(page).toHaveURL('https://pay.bitbi.ai/c/pay/cs_live_pricing_5000');
  });

  test('Pricing success and cancel return states render without granting credits client-side', async ({ page }) => {
    await mockPricingAccount(page);
    await page.goto('/pricing?checkout=success');
    await expect(page.locator('.pricing-return--success')).toContainText('Payment successful');
    await expect(page.locator('.pricing-return--success')).toContainText('back on BITBI');
    await expect(page.locator('.pricing-return--success a[href="/account/credits.html"]')).toContainText('View credits');

    await page.goto('/pricing?checkout=cancel');
    await expect(page.locator('.pricing-return--cancel')).toContainText('Checkout was cancelled');
    await expect(page.locator('.pricing-return--cancel')).toContainText('You have not been charged');
  });
});

test.describe('AI model credit pricing registry', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
  });

  test('Generate Lab frontend estimates match the shared AI model pricing dispatcher', async ({ page }) => {
    await mockAuthenticatedAssetsManager(page);

    for (const path of ['/generate-lab/', '/de/generate-lab/']) {
      const response = await page.goto(path);
      expect(response.status()).toBe(200);

      const result = await page.evaluate(async () => {
        const registry = await import('/js/pages/generate-lab/model-registry.js?v=pricing-sync-test');
        const pricing = await import('/js/shared/ai-model-pricing.mjs?v=pricing-sync-test');
        const cases = [
          {
            mediaType: 'image',
            modelId: '@cf/black-forest-labs/flux-1-schnell',
            params: { width: 1024, height: 1024, steps: 4 },
          },
          {
            mediaType: 'image',
            modelId: '@cf/black-forest-labs/flux-2-klein-9b',
            params: { width: 2048, height: 1024 },
          },
          {
            mediaType: 'image',
            modelId: 'openai/gpt-image-2',
            params: {
              quality: 'high',
              size: '1536x1024',
              outputFormat: 'png',
              background: 'auto',
              referenceImageCount: 2,
            },
          },
          {
            mediaType: 'video',
            modelId: 'pixverse/v6',
            params: { duration: 5, quality: '720p', generateAudio: true },
          },
          {
            mediaType: 'video',
            modelId: 'alibaba/hh1-t2v',
            params: { duration: 6, resolution: '1080P', ratio: '9:16', watermark: false },
          },
          {
            mediaType: 'music',
            modelId: 'minimax/music-2.6',
            params: { generateLyrics: true },
          },
        ];

        return {
          comparisons: cases.map((entry) => ({
            modelId: entry.modelId,
            frontendCredits: registry.calculateGenerateLabCredits(entry.modelId, entry.params),
            sharedCredits: pricing.calculateAiModelCreditCost(entry).credits,
          })),
          hasHappyHorseInGenerateLab: registry.getGenerateLabModels()
            .some((model) => model.id === 'alibaba/hh1-t2v'),
        };
      });

      for (const row of result.comparisons) {
        expect(row.frontendCredits, `${path} ${row.modelId}`).toBe(row.sharedCredits);
      }
      expect(result.hasHappyHorseInGenerateLab).toBe(true);
    }
  });
});

test.describe('Credits dashboard live credit packs', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
  });

  test('keeps direct Credits access gated for unauthenticated users and falls back to member credits without owner org access', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await fulfillJson(route, { loggedIn: false, user: null });
    });
    await page.goto('/account/credits.html');
    await expect(page.locator('#creditsDenied')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#creditsDenied')).toContainText('Sign in to review credits');
    await expect(page.locator('#creditsDenied [data-auth-entry="login"]')).toHaveText('Sign in');
    await expect(page.locator('#creditsDenied [data-auth-message-key="authRecovery.creditsMessage"]')).toHaveCount(2);
    await page.locator('#creditsDenied [data-auth-entry="login"]').first().click();
    await expect(page.locator('.auth-modal__overlay.active')).toBeVisible();
    await expect(page.locator('#authLoginMsg')).toContainText('Sign in to review credits and BITBI Pro context. Create an account before generating or saving.');
    await expectAuthContextRemoved(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#creditsDenied a[href="/account/forgot-password.html?source=credits"]')).toHaveText('Reset password');
    await expect(page.locator('#creditsDenied')).toContainText('Profile verification guidance');
    await expect(page.locator('#creditsDenied a[href="/account/profile.html?returnContext=credits#profileCompletionCard"]')).toHaveText('Profile recovery');
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
    await expect(page.locator('#creditsDashboard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#creditsEyebrow')).toHaveCount(0);
    await expect(page.locator('#creditsAccountContext')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Member account');
    await expect(page.locator('main')).not.toContainText('Personal credits');
    await expect(page.locator('[data-checkout-pack]')).toHaveCount(2);
  });

  test('Credits scrubs unsafe return context without rendering workspace hint panels', async ({ page }) => {
    await mockCreditsAccount(page, {
      role: 'user',
      email: 'post-auth-credits@example.com',
      organizations: [],
    });

    await page.goto('/account/credits?scope=member&source=pricing&returnTo=https%3A%2F%2Fevil.example%2Fcredits%3Ftoken%3Draw-credit&token=raw-credit');
    await expect(page.locator('#creditsDashboard')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('[data-auth-post-hint]')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('You are signed in to Credits');
    await expect(page.locator('main')).not.toContainText('Opened from Pricing.');
    await expect(page.locator('main')).not.toContainText('raw return URLs');
    expect(page.url()).not.toContain('returnTo=');
    expect(page.url()).not.toContain('raw-credit');
  });

  test('Credits page shows session-expired recovery without exposing backend errors', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await fulfillJson(route, { ok: false, error: 'raw credits session detail' }, 401);
    });

    await page.goto('/account/credits.html');
    await expect(page.locator('#creditsDenied')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#creditsDenied')).toContainText('Session expired. Sign in again.');
    await expect(page.locator('#creditsDenied')).toContainText('No credit balance or checkout state is assumed until the backend reloads it.');
    await expect(page.locator('#creditsDenied [data-auth-entry="login"]')).toHaveText('Sign in again');
    await expect(page.locator('#creditsDenied')).not.toContainText('raw credits');
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
    await expect(page.locator('#creditsLegalBlock')).toContainText('Secure payment continues on pay.bitbi.ai.');
    const creditsShellWidth = await page.locator('.credits-shell').evaluate((node) =>
      Math.round(node.getBoundingClientRect().width)
    );
    expect(creditsShellWidth).toBeGreaterThan(1100);

    const cardWidths = await page.locator('.credits-pack').evaluateAll((cards) =>
      cards.map((card) => card.getBoundingClientRect().width)
    );
    expect(cardWidths.every((width) => width >= 240)).toBe(true);

    await page.locator('[data-checkout-pack="live_credits_5000"]').click();
    await expect(page.locator('.credits-legal__error')).toContainText('Please accept the terms');
    expect(checkoutRequests).toHaveLength(0);

    await page.locator('#creditsTermsAccepted').check();
    await page.locator('#creditsImmediateDeliveryAccepted').check();
    await page.locator('[data-checkout-pack="live_credits_5000"]').click();
    await expect(page).toHaveURL(/\/account\/credits(?:\.html)?\?checkout=success$/);
    expect(checkoutRequests).toHaveLength(1);
    expect(checkoutRequests[0].body).toEqual(expect.objectContaining({
      pack_id: 'live_credits_5000',
      terms_accepted: true,
      terms_version: '2026-05-05',
      immediate_delivery_accepted: true,
    }));
    expect(checkoutRequests[0].body.accepted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(checkoutRequests[0].idempotencyKey).toMatch(/^credits-live:org_credits_/);
  });

  test('renders member Credits page with equal summaries, membership history, and compact ledger accordion', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const currentRows = makeCreditLedgerRows({
      prefix: 'current_member_activity',
      label: 'Current month activity',
      monthOffset: 0,
      count: 7,
      startBalance: 80,
    });
    const previousRows = makeCreditLedgerRows({
      prefix: 'previous_member_activity',
      label: 'Previous month activity',
      monthOffset: -1,
      count: 6,
      startBalance: 70,
    });
    const olderRows = makeCreditLedgerRows({
      prefix: 'older_member_activity',
      label: 'Older month activity',
      monthOffset: -2,
      count: 1,
      startBalance: 60,
    });
    await mockCreditsAccount(page, {
      email: 'member-credits@example.com',
      organizations: [],
      memberDashboard: {
        account: {
          userId: 'member-credits-user',
          email: 'member-credits@example.com',
          role: 'user',
          status: 'active',
        },
        balance: {
          current: 10,
          available: 10,
          totalCredits: 10300,
          subscriptionCredits: 6000,
          legacyOrBonusCredits: 300,
          purchasedCredits: 4000,
          dailyAllowance: 10,
          lifetimeIncoming: 17,
          lifetimeDailyTopUps: 7,
          lifetimeManualGrants: 10,
          lifetimeConsumed: 1,
        },
        dailyTopUp: {
          dayStart: creditLedgerIso(0, 1, 0, 0),
          grantedCredits: 7,
          reused: false,
          dailyAllowance: 10,
        },
        liveCheckout: {
          enabled: true,
          configured: true,
          mode: 'live',
        },
        subscriptionStatus: 'active',
        subscriptionPeriodStart: '2026-05-01T00:00:00.000Z',
        subscriptionPeriodEnd: '2026-06-01T00:00:00.000Z',
        nextTopUpAt: '2026-06-01T00:00:00.000Z',
        nextRenewalDate: '2026-06-01T00:00:00.000Z',
        activeUntil: '2026-06-01T00:00:00.000Z',
        cancelAtPeriodEnd: false,
        canCancelSubscription: true,
        canReactivateSubscription: false,
        storageLimitBytes: 5 * 1024 * 1024 * 1024,
        hasActiveSubscription: true,
        packs: [
          { id: 'live_credits_5000', name: '5000 Credit Pack', credits: 5000, amountCents: 999, currency: 'eur', displayPrice: '9,99 €' },
          { id: 'live_credits_12000', name: '12000 Credit Pack', credits: 12000, amountCents: 1999, currency: 'eur', displayPrice: '19,99 €' },
        ],
        purchaseHistory: [{
          createdAt: creditLedgerIso(0, 2, 10, 0),
          creditPack: { id: 'live_credits_5000', amountCents: 999, currency: 'eur' },
          status: 'paid',
          authorizationScope: 'member',
        }],
        transactions: [
          ...currentRows,
          ...previousRows,
          ...olderRows,
        ],
      },
    });
    const response = await page.goto('/account/credits.html?scope=member');
    expect(response.status()).toBe(200);
    await expect(page.locator('#creditsDashboard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.credits-hero__glow')).toHaveCount(0);
    await expect(page.locator('.credits-hero.hero.hero--compact')).toBeVisible();
    await expect(page.locator('#creditsTitle')).toHaveClass(/legal-hero__title/);
    await expect(page.locator('#creditsEyebrow')).toHaveCount(0);
    await expect(page.locator('#creditsReturnState')).toHaveCount(0);
    await expect(page.locator('#creditsWorkspacePriority')).toHaveCount(0);
    await expect(page.locator('.credits-workspace-nav:not(.credits-workspace-nav__link)')).toHaveCount(0);
    await expect(page.locator('.credits-onboarding')).toHaveCount(0);
    await expect(page.locator('#creditsContinuityPanel')).toHaveCount(0);
    await expect(page.locator('#creditsPostActionGuide')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Workspace priority');
    await expect(page.locator('main')).not.toContainText('Member workspace');
    await expect(page.locator('main')).not.toContainText('First-run guide');
    await expect(page.locator('main')).not.toContainText('Credit and storage context');
    await expect(page.locator('main')).not.toContainText('After pricing');
    await page.locator('#bitbiHelpTrigger').click();
    const creditsHelp = page.locator('#bitbiHelpPanel [data-help-section="credits"]');
    await expect(creditsHelp.locator('.help-menu__section-title')).toHaveText('Credits & Pro');
    await creditsHelp.locator('summary.help-menu__section-toggle').click();
    const generateLabHelp = creditsHelp.locator('.help-menu__item').filter({ hasText: 'Before Generate Lab' });
    await generateLabHelp.locator('summary.help-menu__item-summary').click();
    await expect(generateLabHelp.locator('.help-menu__item-body')).toContainText('Credits are account-bound and consumed by generation');
    await expect(generateLabHelp.getByRole('link', { name: 'Open Generate Lab' })).toHaveAttribute(
      'href',
      '/generate-lab/?source=help-credits&step=create',
    );
    await page.getByRole('button', { name: 'Close help menu' }).click();
    await expect(page.locator('#creditsAccountContext')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Member account');
    await expect(page.locator('main')).not.toContainText('Personal credits');
    await expect(page.locator('main')).not.toContainText('Daily top-up: 7 credits granted today.');
    await expect(page.locator('.credits-overview-grid')).toBeVisible();
    await expect(page.locator('#creditsWorkGrid')).toHaveClass(/credits-work-grid--member/);
    await expect(page.locator('.credits-history-grid')).toHaveCount(0);
    const summaryCards = page.locator('#creditsSummaryGrid .credits-card');
    await expect(summaryCards).toHaveCount(4);
    const firstSummaryCard = summaryCards.first();
    const firstSummaryRadius = await firstSummaryCard.evaluate((card) =>
      window.getComputedStyle(card).borderRadius
    );
    expect(parseFloat(firstSummaryRadius)).toBeGreaterThanOrEqual(14);
    await expect(summaryCards.nth(0)).toContainText('Total available');
    await expect(summaryCards.nth(0)).toContainText('10,300 credits');
    await expect(summaryCards.nth(1)).toContainText('Subscription credits');
    await expect(summaryCards.nth(1)).toContainText('6,000 credits');
    await expect(summaryCards.nth(2)).toContainText('Purchased credits');
    await expect(summaryCards.nth(2)).toContainText('4,000 credits');
    await expect(summaryCards.nth(3)).toContainText('Legacy / bonus credits');
    await expect(summaryCards.nth(3)).toContainText('300 credits');
    await expect(page.locator('#creditsSubscriptionSection')).toBeVisible();
    await expect(page.locator('#creditsSubscriptionSection')).toContainText('BITBI Pro');
    await expect(page.locator('#creditsSubscriptionSection')).toContainText('Active');
    await expect(page.locator('#creditsSubscriptionSection')).toContainText('Next renewal');
    await expect(page.locator('#creditsSubscriptionSection')).toContainText('5 GB');
    await expect(page.locator('[data-subscription-action="cancel"]')).toHaveText('Cancel subscription');
    await expect(page.locator('#creditsSummaryGrid')).not.toContainText('Daily top-up target');
    await expect(page.locator('#creditsSummaryGrid')).not.toContainText('Daily top-ups');
    await expect(page.locator('#creditsSummaryGrid')).not.toContainText('Manual grants');
    await expect(page.locator('#creditsSummaryGrid')).not.toContainText('Incoming credits');
    const summaryLayout = await summaryCards.evaluateAll((cards) => cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        height: Math.round(rect.height),
        width: Math.round(rect.width),
      };
    }));
    expect(summaryLayout).toHaveLength(4);
    expect(Math.abs(summaryLayout[0].top - summaryLayout[1].top)).toBeLessThanOrEqual(2);
    expect(summaryLayout[1].left).toBeGreaterThan(summaryLayout[0].left);
    expect(Math.abs(summaryLayout[2].top - summaryLayout[0].top)).toBeLessThanOrEqual(2);
    expect(summaryLayout[2].left).toBeGreaterThan(summaryLayout[1].left);
    expect(Math.abs(summaryLayout[3].top - summaryLayout[0].top)).toBeLessThanOrEqual(2);
    expect(summaryLayout[3].left).toBeGreaterThan(summaryLayout[2].left);
    expect(Math.abs(summaryLayout[0].height - summaryLayout[1].height)).toBeLessThanOrEqual(6);
    expect(Math.abs(summaryLayout[0].height - summaryLayout[2].height)).toBeLessThanOrEqual(6);
    expect(Math.abs(summaryLayout[0].height - summaryLayout[3].height)).toBeLessThanOrEqual(6);
    expect(summaryLayout.every((card) => card.width >= 170)).toBe(true);

    const workLayout = await page.evaluate(() => {
      const subscription = document.getElementById('creditsSubscriptionSection')?.getBoundingClientRect();
      const packs = document.getElementById('creditsPacksSection')?.getBoundingClientRect();
      return subscription && packs ? {
        subscriptionTop: Math.round(subscription.top),
        subscriptionLeft: Math.round(subscription.left),
        packsTop: Math.round(packs.top),
        packsLeft: Math.round(packs.left),
      } : null;
    });
    expect(workLayout).not.toBeNull();
    expect(workLayout.packsTop).toBeGreaterThan(workLayout.subscriptionTop);
    expect(Math.abs(workLayout.subscriptionLeft - workLayout.packsLeft)).toBeLessThanOrEqual(3);

    await expect(page.locator('#creditsSubscriptionSection #creditsPurchasesSection')).toBeVisible();
    await expect(page.locator('#creditsPurchasesSection')).toContainText('live_credits_5000');
    await expect(page.locator('#creditsPurchasesSection')).toContainText('paid');
    const membershipLayout = await page.evaluate(() => {
      const body = document.getElementById('creditsSubscriptionBody')?.getBoundingClientRect();
      const purchases = document.getElementById('creditsPurchasesSection')?.getBoundingClientRect();
      return body && purchases ? {
        bodyTop: Math.round(body.top),
        bodyLeft: Math.round(body.left),
        bodyWidth: Math.round(body.width),
        purchasesTop: Math.round(purchases.top),
        purchasesLeft: Math.round(purchases.left),
        purchasesWidth: Math.round(purchases.width),
      } : null;
    });
    expect(membershipLayout).not.toBeNull();
    expect(Math.abs(membershipLayout.bodyTop - membershipLayout.purchasesTop)).toBeLessThanOrEqual(4);
    expect(membershipLayout.purchasesLeft).toBeGreaterThan(membershipLayout.bodyLeft);
    expect(Math.abs(membershipLayout.bodyWidth - membershipLayout.purchasesWidth)).toBeLessThanOrEqual(14);

    const ledgerLayout = await page.evaluate(() => {
      const shell = document.querySelector('.credits-shell')?.getBoundingClientRect();
      const ledger = document.getElementById('creditsLedgerSection')?.getBoundingClientRect();
      return shell && ledger ? {
        centerDelta: Math.abs(Math.round((shell.left + shell.right) / 2) - Math.round((ledger.left + ledger.right) / 2)),
        width: Math.round(ledger.width),
      } : null;
    });
    expect(ledgerLayout).not.toBeNull();
    expect(ledgerLayout.centerDelta).toBeLessThanOrEqual(4);
    expect(ledgerLayout.width).toBeLessThanOrEqual(1024);
    const directLedgerRows = page.locator('#creditsLedgerBody .credits-ledger-list--direct > .credits-ledger-item');
    await expect(directLedgerRows).toHaveCount(5);
    await expect(directLedgerRows.first().locator('.credits-ledger-item__summary')).toContainText('USAGE_CHARGE');
    await expect(directLedgerRows.first().locator('.credits-ledger-item__summary')).toContainText('Current month activity 1');
    await expect(directLedgerRows.first().locator('.credits-ledger-item__summary')).toContainText('-1 credits');
    await expect(directLedgerRows.nth(4).locator('.credits-ledger-item__summary')).toContainText('Current month activity 5');
    await expect(page.locator('#creditsLedgerBody .credits-ledger-list--direct')).not.toContainText('Current month activity 6');
    await expect(directLedgerRows.first().locator('.credits-ledger-item__fields')).toBeHidden();
    await directLedgerRows.first().locator('summary').click();
    await expect(directLedgerRows.first().locator('.credits-ledger-item__fields')).toBeVisible();
    await expect(directLedgerRows.first().locator('.credits-ledger-item__fields')).toContainText('org_image_credit_catalog');
    await directLedgerRows.first().locator('summary').click();
    await expect(directLedgerRows.first().locator('.credits-ledger-item__fields')).toBeHidden();
    await expect(page.locator('#creditsLedgerBody .credits-ledger-more > summary')).toHaveText('Show 9 more actions');
    await page.locator('#creditsLedgerBody .credits-ledger-more > summary').click();
    await expect(page.locator('#creditsLedgerBody .credits-ledger-more__items')).toContainText('Current month activity 6');
    await expect(page.locator('#creditsLedgerBody .credits-ledger-more__items')).toContainText('Previous month activity 6');
    await expect(page.locator('#creditsLedgerBody .credits-ledger-more__items')).toContainText('Older month activity 1');
    await expect(page.locator('#creditsOrgPickerWrap')).toHaveCount(0);
    await expect(page.locator('#creditsDashboard')).not.toContainText('Switch organization');
    await expect(page.locator('#creditsPackGrid [data-checkout-pack]')).toHaveCount(2);
    await expect(page.locator('#creditsPurchasesSection')).toBeVisible();
    await expect(page.locator('.credits-back-link')).toHaveText('Back to Profile');
    await expect(page.locator('.credits-back-link')).toHaveAttribute('href', '/account/profile.html');

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileSummaryLayout = await summaryCards.evaluateAll((cards) => cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
      };
    }));
    expect(mobileSummaryLayout[1].top).toBeGreaterThan(mobileSummaryLayout[0].top);
    expect(mobileSummaryLayout.every((card) => Math.abs(card.left - mobileSummaryLayout[0].left) <= 2)).toBe(true);
    expect(mobileSummaryLayout.every((card) => card.width >= 320)).toBe(true);
    const mobileWorkLayout = await page.evaluate(() => {
      const subscription = document.getElementById('creditsSubscriptionSection')?.getBoundingClientRect();
      const packs = document.getElementById('creditsPacksSection')?.getBoundingClientRect();
      return subscription && packs ? {
        subscriptionTop: Math.round(subscription.top),
        packsTop: Math.round(packs.top),
        leftDelta: Math.abs(Math.round(subscription.left) - Math.round(packs.left)),
      } : null;
    });
    expect(mobileWorkLayout).not.toBeNull();
    expect(mobileWorkLayout.packsTop).toBeGreaterThan(mobileWorkLayout.subscriptionTop);
    expect(mobileWorkLayout.leftDelta).toBeLessThanOrEqual(2);
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(mobileOverflow).toBeLessThanOrEqual(1);
  });

  test('member Credits remains focused and usable on mobile after explainer removal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCreditsAccount(page, { organizations: [] });
    const response = await page.goto('/account/credits.html?scope=member');
    expect(response.status()).toBe(200);
    await expect(page.locator('#creditsDashboard')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#creditsWorkspacePriority')).toHaveCount(0);
    await expect(page.locator('.credits-onboarding')).toHaveCount(0);
    await expect(page.locator('#creditsContinuityPanel')).toHaveCount(0);
    await expect(page.locator('#creditsPostActionGuide')).toHaveCount(0);
    await expect(page.locator('#creditsSummaryGrid .credits-card')).toHaveCount(4);
    await expect(page.locator('#creditsPacksSection')).toBeVisible();
    await expect(page.locator('#creditsLedgerBody')).toBeVisible();
    const hasDocumentOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasDocumentOverflow).toBe(false);
  });

  test('renders German member Credits summary and ledger expansion labels', async ({ page }) => {
    const currentRows = makeCreditLedgerRows({
      prefix: 'de_current_member_activity',
      label: 'Aktuelle Monatsaktivität',
      monthOffset: 0,
      count: 6,
      startBalance: 80,
    });
    await mockCreditsAccount(page, {
      email: 'mitglied-credits@example.com',
      organizations: [],
      memberDashboard: {
        account: {
          userId: 'mitglied-credits-user',
          email: 'mitglied-credits@example.com',
          role: 'user',
          status: 'active',
        },
        balance: {
          current: 10,
          available: 10,
          totalCredits: 10300,
          subscriptionCredits: 6000,
          legacyOrBonusCredits: 300,
          purchasedCredits: 4000,
          dailyAllowance: 10,
          lifetimeIncoming: 17,
          lifetimeDailyTopUps: 7,
          lifetimeManualGrants: 10,
          lifetimeConsumed: 1,
        },
        dailyTopUp: null,
        liveCheckout: { enabled: true, configured: true, mode: 'live' },
        subscriptionStatus: 'active',
        subscriptionPeriodStart: '2026-05-01T00:00:00.000Z',
        subscriptionPeriodEnd: '2026-06-01T00:00:00.000Z',
        nextTopUpAt: '2026-06-01T00:00:00.000Z',
        nextRenewalDate: '2026-06-01T00:00:00.000Z',
        activeUntil: '2026-06-01T00:00:00.000Z',
        cancelAtPeriodEnd: false,
        canCancelSubscription: true,
        canReactivateSubscription: false,
        storageLimitBytes: 5 * 1024 * 1024 * 1024,
        hasActiveSubscription: true,
        packs: [
          { id: 'live_credits_5000', name: '5000 Credit Pack', credits: 5000, amountCents: 999, currency: 'eur', displayPrice: '9,99 €' },
          { id: 'live_credits_12000', name: '12000 Credit Pack', credits: 12000, amountCents: 1999, currency: 'eur', displayPrice: '19,99 €' },
        ],
        purchaseHistory: [],
        transactions: currentRows,
      },
    });

    const response = await page.goto('/de/account/credits.html?scope=member');
    expect(response.status()).toBe(200);
    await expect(page.locator('#creditsDashboard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#creditsEyebrow')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Mitglieder-Credits');
    await expect(page.locator('#creditsAccountContext')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Mitgliedskonto');
    await expect(page.locator('main')).not.toContainText('Persönliche Credits');
    await expect(page.locator('#creditsSummaryGrid .credits-card')).toHaveCount(4);
    await expect(page.locator('#creditsSummaryGrid')).toContainText('Gesamt verfügbar');
    await expect(page.locator('#creditsSummaryGrid')).toContainText('10.300 Credits');
    await expect(page.locator('#creditsSummaryGrid')).toContainText('Abo-Credits');
    await expect(page.locator('#creditsSummaryGrid')).toContainText('6.000 Credits');
    await expect(page.locator('#creditsSummaryGrid')).toContainText('Gekaufte Credits');
    await expect(page.locator('#creditsSummaryGrid')).toContainText('4.000 Credits');
    await expect(page.locator('#creditsSummaryGrid')).toContainText('Legacy-/Bonus-Credits');
    await expect(page.locator('#creditsWorkspacePriority')).toHaveCount(0);
    await expect(page.locator('.credits-onboarding')).toHaveCount(0);
    await expect(page.locator('#creditsContinuityPanel')).toHaveCount(0);
    await expect(page.locator('#creditsPostActionGuide')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Arbeitsbereich-Priorität');
    await expect(page.locator('main')).not.toContainText('Mitglieder-Arbeitsbereich');
    await expect(page.locator('main')).not.toContainText('Erste Schritte');
    await expect(page.locator('main')).not.toContainText('Credit- und Speicherkontext');
    await expect(page.locator('main')).not.toContainText('Nach Pricing');
    await expect(page.locator('#creditsSubscriptionSection')).toContainText('BITBI Pro');
    await expect(page.locator('#creditsSubscriptionSection')).toContainText('Nächste Verlängerung');
    await expect(page.locator('#creditsSubscriptionSection')).toContainText('Aktiv');
    await expect(page.locator('#creditsSubscriptionSection')).toContainText('Speicherlimit');
    await expect(page.locator('#creditsSubscriptionSection')).toContainText('5 GB');
    await expect(page.locator('[data-subscription-action="cancel"]')).toHaveText('Abo kündigen');
    await expect(page.locator('#creditsSummaryGrid')).not.toContainText('Tägliches Aufladeziel');
    await expect(page.locator('#creditsSummaryGrid')).not.toContainText('Tägliche Aufladungen');
    await expect(page.locator('#creditsSummaryGrid')).not.toContainText('Manuelle Gutschriften');
    await expect(page.locator('#creditsSummaryGrid')).not.toContainText('Eingehende Credits');
    await expect(page.locator('#creditsLegalBlock')).toContainText('Die sichere Zahlung wird auf pay.bitbi.ai fortgesetzt.');
    await expect(page.locator('#creditsSubscriptionSection #creditsPurchasesSection')).toBeVisible();
    await expect(page.locator('.credits-history-grid')).toHaveCount(0);
    const directLedgerRows = page.locator('#creditsLedgerBody .credits-ledger-list--direct > .credits-ledger-item');
    await expect(directLedgerRows).toHaveCount(5);
    await expect(directLedgerRows.first().locator('.credits-ledger-item__summary')).toContainText('USAGE_CHARGE');
    await expect(directLedgerRows.first().locator('.credits-ledger-item__summary')).toContainText('Aktuelle Monatsaktivität 1');
    await expect(page.locator('#creditsLedgerBody .credits-ledger-more > summary')).toHaveText('1 weitere Aktion anzeigen');
    await page.locator('#creditsLedgerBody .credits-ledger-more > summary').click();
    await expect(page.locator('#creditsLedgerBody .credits-ledger-more__items')).toContainText('Aktuelle Monatsaktivität 6');
    await expect(page.locator('.credits-back-link')).toHaveText('Zurück zum Profil');
    await expect(page.locator('.credits-back-link')).toHaveAttribute('href', '/de/account/profile.html');
  });

  test('member Credits page cancels and reactivates an active subscription with confirmation', async ({ page }) => {
    const memberDashboard = {
      account: { userId: 'member-sub-ui', email: 'member-sub-ui@example.com', role: 'user', status: 'active' },
      balance: {
        current: 10000,
        available: 10000,
        totalCredits: 10000,
        subscriptionCredits: 6000,
        legacyOrBonusCredits: 0,
        purchasedCredits: 4000,
        lifetimeConsumed: 0,
      },
      dailyTopUp: null,
      liveCheckout: { enabled: true, configured: true, mode: 'live' },
      subscriptionStatus: 'active',
      subscriptionPeriodStart: '2026-05-01T00:00:00.000Z',
      subscriptionPeriodEnd: '2026-06-01T00:00:00.000Z',
      nextRenewalDate: '2026-06-01T00:00:00.000Z',
      activeUntil: '2026-06-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      canCancelSubscription: true,
      canReactivateSubscription: false,
      storageLimitBytes: 5 * 1024 * 1024 * 1024,
      hasActiveSubscription: true,
      packs: [],
      purchaseHistory: [],
      transactions: [],
    };
    const { subscriptionManageRequests } = await mockCreditsAccount(page, {
      email: 'member-sub-ui@example.com',
      organizations: [],
      memberDashboard,
    });

    await page.goto('/account/credits.html?scope=member');
    await expect(page.locator('[data-subscription-action="cancel"]')).toBeVisible({ timeout: 10_000 });
    const cancelAction = page.locator('[data-subscription-action="cancel"]');
    await cancelAction.click();
    await expect(page.locator('#creditsSubscriptionDialog')).toBeVisible();
    await expect(page.locator('#creditsSubscriptionDialog')).toHaveAttribute('aria-describedby', 'creditsSubscriptionDialogBody');
    await expect(page.locator('#creditsSubscriptionDialogTitle')).toHaveText('Cancel subscription at period end?');
    await expect(page.locator('#creditsSubscriptionDialogBody')).toContainText('remains active');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('creditsSubscriptionDialogCancel');
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('creditsSubscriptionDialogConfirm');
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('creditsSubscriptionDialogCancel');
    await page.keyboard.press('Escape');
    await expect(page.locator('#creditsSubscriptionDialog')).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-subscription-action'))).toBe('cancel');
    await cancelAction.click();
    await expect(page.locator('#creditsSubscriptionDialog')).toBeVisible();
    await page.locator('#creditsSubscriptionDialogConfirm').click();
    await expect(page.locator('#creditsSubscriptionFeedback')).toContainText('Cancellation scheduled');
    await expect(page.locator('#creditsSubscriptionSection')).toContainText('Cancels at period end');
    await expect(page.locator('[data-subscription-action="reactivate"]')).toHaveText('Reactivate subscription');
    expect(subscriptionManageRequests).toHaveLength(1);
    expect(subscriptionManageRequests[0]).toEqual(expect.objectContaining({
      action: 'cancel',
      body: { confirmed: true },
    }));
    expect(subscriptionManageRequests[0].idempotencyKey).toMatch(/^member-subscription:cancel:/);

    const reactivateAction = page.locator('[data-subscription-action="reactivate"]');
    await reactivateAction.click();
    await expect(page.locator('#creditsSubscriptionDialogTitle')).toHaveText('Reactivate subscription?');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('creditsSubscriptionDialogConfirm');
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('creditsSubscriptionDialogCancel');
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('creditsSubscriptionDialogConfirm');
    await page.keyboard.press('Escape');
    await expect(page.locator('#creditsSubscriptionDialog')).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-subscription-action'))).toBe('reactivate');
    await reactivateAction.click();
    await expect(page.locator('#creditsSubscriptionDialogTitle')).toHaveText('Reactivate subscription?');
    await page.locator('#creditsSubscriptionDialogConfirm').click();
    await expect(page.locator('#creditsSubscriptionFeedback')).toContainText('Subscription reactivated');
    await expect(page.locator('[data-subscription-action="cancel"]')).toHaveText('Cancel subscription');
    expect(subscriptionManageRequests).toHaveLength(2);
    expect(subscriptionManageRequests[1].action).toBe('reactivate');
    expect(subscriptionManageRequests[1].idempotencyKey).toMatch(/^member-subscription:reactivate:/);
  });

  test('member Credits page hides subscription management actions for no or ended subscriptions', async ({ page }) => {
    await mockCreditsAccount(page, {
      email: 'member-no-sub-ui@example.com',
      organizations: [],
      memberDashboard: {
        account: { userId: 'member-no-sub-ui', email: 'member-no-sub-ui@example.com', role: 'user', status: 'active' },
        balance: { totalCredits: 4000, subscriptionCredits: 0, purchasedCredits: 4000, legacyOrBonusCredits: 0, lifetimeConsumed: 0 },
        dailyTopUp: null,
        liveCheckout: { enabled: true, configured: true, mode: 'live' },
        subscriptionStatus: 'none',
        hasActiveSubscription: false,
        cancelAtPeriodEnd: false,
        canCancelSubscription: false,
        canReactivateSubscription: false,
        storageLimitBytes: 50 * 1024 * 1024,
        packs: [],
        purchaseHistory: [],
        transactions: [],
      },
    });
    await page.goto('/account/credits.html?scope=member');
    await expect(page.locator('#creditsSubscriptionSection')).toContainText('No active subscription');
    await expect(page.locator('[data-subscription-action]')).toHaveCount(0);
    await expect(page.locator('#creditsSubscriptionSection .btn')).toContainText('View plans');

    await page.unroute('**/api/account/credits-dashboard*');
    await page.route('**/api/account/credits-dashboard*', async (route) => {
      await fulfillJson(route, {
        ok: true,
        dashboard: {
          account: { userId: 'member-ended-sub-ui', email: 'member-ended-sub-ui@example.com', role: 'user', status: 'active' },
          balance: { totalCredits: 2000, subscriptionCredits: 0, purchasedCredits: 2000, legacyOrBonusCredits: 0, lifetimeConsumed: 0 },
          dailyTopUp: null,
          liveCheckout: { enabled: true, configured: true, mode: 'live' },
          subscriptionStatus: 'canceled',
          subscriptionPeriodEnd: '2026-04-01T00:00:00.000Z',
          hasActiveSubscription: false,
          cancelAtPeriodEnd: false,
          canCancelSubscription: false,
          canReactivateSubscription: false,
          storageLimitBytes: 50 * 1024 * 1024,
          packs: [],
          purchaseHistory: [],
          transactions: [],
        },
      });
    });
    await page.goto('/account/credits.html?scope=member');
    await expect(page.locator('#creditsSubscriptionSection')).toContainText('Ended');
    await expect(page.locator('[data-subscription-action]')).toHaveCount(0);
  });

  test('organization Credits view keeps organization switching only when multiple eligible organizations exist', async ({ page }) => {
    await mockCreditsAccount(page, {
      organizations: [
        {
          id: 'org_credits_primary_1234567890abcdef',
          name: 'Primary Credits Org',
          slug: 'primary-credits-org',
          role: 'owner',
          status: 'active',
        },
        {
          id: 'org_credits_second_1234567890abcdef',
          name: 'Second Credits Org',
          slug: 'second-credits-org',
          role: 'owner',
          status: 'active',
        },
      ],
    });

    const response = await page.goto('/account/credits.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#creditsDashboard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#creditsOrgPickerWrap')).toBeVisible();
    await expect(page.locator('#creditsOrgPickerWrap')).toContainText('Switch organization');
    await expect(page.locator('#creditsOrgPicker option')).toHaveCount(3);
  });

  test('suppresses checkout return panel and has no mobile document overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCreditsAccount(page);
    await page.goto('/account/credits?checkout=cancel');
    await expect(page.locator('#creditsReturnState')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Checkout was cancelled');
    await expect(page.locator('main')).not.toContainText('No balance change was made here');
    await expect(page.locator('#creditsDashboard')).toBeVisible({ timeout: 10_000 });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(mobileOverflow).toBeLessThanOrEqual(1);
  });

  test('suppresses pricing and checkout return panels without overclaiming grants', async ({ page }) => {
    await mockCreditsAccount(page, { organizations: [] });

    await page.goto('/account/credits?scope=member&source=pricing&checkout=success');
    await expect(page).toHaveURL(/checkout=success/);
    await expect(page.locator('#creditsDashboard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#creditsReturnState')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Check your verified balance below');
    await expect(page.locator('main')).not.toContainText('Credits appear here after backend-confirmed payment');
    await expect(page.locator('main')).not.toContainText('Credits granted');
    await expect(page.getByRole('link', { name: 'Check verified balance' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Open Generate Lab' })).toHaveCount(0);
    await expect(page.locator('a[href*="source=credits-return"]')).toHaveCount(0);

    await page.goto('/account/credits?scope=member&checkout=error');
    await expect(page.locator('#creditsDashboard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#creditsReturnState')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Checkout needs another try');
    await expect(page.locator('main')).not.toContainText('No credit grant is shown until the backend confirms payment.');
    await expect(page.getByRole('link', { name: 'Review pricing' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Review profile checklist' })).toHaveCount(0);

    await page.goto('/account/credits?scope=member&source=pricing');
    await expect(page.locator('#creditsDashboard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#creditsReturnState')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Confirm credits before the next action');
    await expect(page.locator('main')).not.toContainText('BITBI Pro context');
    await expect(page.getByRole('link', { name: 'View saved assets' })).toHaveCount(0);

    await page.goto('/de/account/credits?scope=member&source=pricing&checkout=success');
    await expect(page.locator('#creditsDashboard')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#creditsReturnState')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Verifiziertes Guthaben unten prüfen');
    await expect(page.locator('main')).not.toContainText('backend-bestätigter Zahlung');
    await expect(page.getByRole('link', { name: 'Verifiziertes Guthaben prüfen' })).toHaveCount(0);
    await expect(page.locator('a[href*="source=credits-return"]')).toHaveCount(0);
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
    await expect(page.locator('#galleryPagination .browse-pagination__toggle')).toBeVisible();
    await expect(page.locator('#galleryPagination .browse-pagination__btn')).toBeHidden();
    await page.locator('#galleryPagination .browse-pagination__toggle').click();
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

test.describe('Assets Manager (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
  });

  test('account Assets Manager focuses on saved assets and does not expose image generation controls', async ({
    page,
  }) => {
    const requests = [];
    await mockAuthenticatedAssetsManager(page, requests);

    const response = await page.goto('/account/assets-manager.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('.legal-hero__title')).toHaveText('Assets Manager');
    await expect(page.locator('#studioSavedAssetsCard')).toBeVisible();
    await expect(page.locator('.assets-manager__workspace-nav')).toHaveCount(0);
    await expect(page.locator('#assetsWorkspacePriority')).toHaveCount(0);
    await expect(page.locator('.assets-manager__first-run')).toHaveCount(0);
    await expect(page.locator('.assets-manager__overview')).toHaveCount(0);
    await expect(page.locator('.assets-manager__storage-panel')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Storage status' })).toHaveCount(0);
    await expect(page.locator('#studioStorageInsight')).toHaveCount(0);
    await expect(page.locator('#studioViewContext')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('First saved asset?');
    await expect(page.locator('main')).not.toContainText('Workspace priority');
    await expect(page.locator('main')).not.toContainText('Storage status');
    await expect(page.locator('main')).not.toContainText('Library view');
    await expect(page.locator('main')).not.toContainText('Private first');
    await expect(page.locator('main')).not.toContainText('Actions stay grouped');
    await expect(page.locator('main')).not.toContainText('Storage is separate from credits');
    await expect(page.locator('#studioViewRefresh')).toHaveText('Refresh latest');
    await expect(page.locator('#studioViewShowAll')).toHaveText('Show all assets');

    await page.locator('#bitbiHelpTrigger').click();
    const assetsHelp = page.locator('#bitbiHelpPanel [data-help-section="assets"]');
    await expect(assetsHelp.locator('.help-menu__section-title')).toHaveText('Assets Manager');
    await assetsHelp.locator('summary.help-menu__section-toggle').click();
    await expect(assetsHelp).toHaveAttribute('open', '');
    const savedOutputHelp = assetsHelp.locator('.help-menu__item').filter({ hasText: 'Find saved output' });
    await expect(savedOutputHelp.locator('summary')).toContainText('Saved Generate Lab output appears in Assets Manager');
    await expect(savedOutputHelp.locator('.help-menu__item-body')).toBeHidden();
    await savedOutputHelp.locator('summary.help-menu__item-summary').click();
    await expect(savedOutputHelp.locator('.help-menu__item-body')).toContainText('refresh the library or show all assets');
    await expect(savedOutputHelp.getByRole('link', { name: 'Open Assets Manager' })).toHaveAttribute(
      'href',
      '/account/assets-manager.html?source=help-assets&recent=1#generate-lab-recent',
    );
    const storageHelp = assetsHelp.locator('.help-menu__item').filter({ hasText: 'Storage is separate from credits' });
    await storageHelp.locator('summary.help-menu__item-summary').click();
    await expect(storageHelp.locator('.help-menu__item-body')).toContainText('backend confirmation');
    await expect(storageHelp.getByRole('link', { name: 'Review Credits' })).toHaveAttribute(
      'href',
      '/account/credits.html?source=help-assets',
    );
    await expect(assetsHelp.locator('.help-menu__item').filter({ hasText: 'Private until published' })).toContainText('Saved media stays private');
    await expect(assetsHelp.locator('.help-menu__item').filter({ hasText: 'Mobile asset actions' })).toContainText('folder and selection tools stay grouped');
    await page.getByRole('button', { name: 'Close help menu' }).click();
    await expect(page.locator('#bitbiHelpMenu')).not.toHaveClass(/is-open/);

    await expect(page.locator('#studioFolderGrid')).toBeVisible();
    await expect(page.locator('#studioFolderGrid .studio__folder-card').first()).toContainText('Open all assets');
    await expect(page.locator('#studioFolderGrid .studio__folder-card').nth(1)).toContainText('Open assets without folder');
    await expect(page.locator('#studioImageGrid')).toHaveCount(1);
    await expect(page.locator('#studioPrompt')).toHaveCount(0);
    await expect(page.locator('#studioModel')).toHaveCount(0);
    await expect(page.locator('#studioGenerate')).toHaveCount(0);
    await expect(page.locator('#studioPreview')).toHaveCount(0);
    await expect(page.locator('#studioSaveBar')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open All Assets, 0 assets' }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Your saved library is empty' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start creating' })).toHaveAttribute('href', '/#gallery');
    expect(requests).toEqual([]);
    await page.locator('#studioViewRefresh').click();
    await expect(page.locator('#studioListStatus')).toContainText('Latest assets refreshed');
    await expect(page.locator('#studioGalleryMsg')).not.toContainText('Latest assets refreshed');
    const refreshMessageCount = await page.locator('body').evaluate((body) => (
      (body.innerText.match(/Latest assets refreshed/g) || []).length
    ));
    expect(refreshMessageCount).toBe(1);
  });

  test('account Assets Manager surfaces Generate Lab handoff recovery and can dismiss the handoff', async ({
    page,
  }) => {
    await mockAuthenticatedAssetsManager(page);

    const response = await page.goto('/account/assets-manager.html?source=generate-lab&recent=1#generate-lab-recent');
    expect(response.status()).toBe(200);
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    const banner = page.locator('#assetsHandoffBanner');
    await expect(banner).toBeVisible();
    await expect(page.locator('#assetsHandoffTitle')).toBeFocused();
    await expect(banner).toContainText('Looking for your latest creation?');
    await expect(banner.getByRole('link', { name: 'Back to Generate Lab' })).toHaveAttribute('href', '/generate-lab/');
    await expect(banner.getByRole('button', { name: 'Show all assets' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your recent creation is not visible yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create another output' })).toHaveAttribute('href', '/generate-lab/');
    await expect(page.locator('#studioViewContext')).toHaveCount(0);
    await expect(page.locator('#studioViewGenerateLab')).toHaveCount(0);
    await expect(page.locator('#studioViewCredits')).toHaveCount(0);
    await expect(page.locator('#studioViewRefresh')).toHaveText('Refresh latest');
    await expect(page.locator('#studioViewShowAll')).toHaveText('Show all assets');
    await expect(page.locator('#studioListStatus')).toContainText('No recent output is visible yet');
    await expect(page.locator('#studioImageGrid')).toBeVisible();
    await expect(page.locator('#studioFolderGrid')).toBeHidden();

    await banner.getByRole('button', { name: 'Show all assets' }).click();
    await expect(page.locator('#assetsHandoffStatus')).toContainText('Showing all saved assets');

    await banner.getByRole('button', { name: 'Refresh assets' }).click();
    await expect(page.locator('#assetsHandoffStatus')).toContainText('Saved assets refreshed');

    await banner.getByRole('button', { name: 'Hide this note' }).click();
    await expect(banner).toBeHidden();
    const url = new URL(page.url());
    expect(url.searchParams.has('source')).toBe(false);
    expect(url.searchParams.has('recent')).toBe(false);
    expect(url.hash).toBe('');
  });

  test('German account Assets Manager keeps Generate Lab handoff parity', async ({
    page,
  }) => {
    await mockAuthenticatedAssetsManager(page);

    const response = await page.goto('/de/account/assets-manager.html?source=generate-lab&recent=1#generate-lab-recent');
    expect(response.status()).toBe(200);
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    const banner = page.locator('#assetsHandoffBanner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Suchen Sie Ihre neueste Erstellung?');
    await expect(banner.getByRole('link', { name: 'Zurück zu Generate Lab' })).toHaveAttribute('href', '/de/generate-lab/');
    await expect(banner.getByRole('button', { name: 'Alle Assets anzeigen' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ihre neueste Erstellung ist noch nicht sichtbar' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Weiteres Ergebnis erstellen' })).toHaveAttribute('href', '/de/generate-lab/');
    await expect(page.locator('#studioViewContext')).toHaveCount(0);
    await expect(page.locator('#studioViewGenerateLab')).toHaveCount(0);
    await expect(page.locator('#studioListStatus')).toContainText('noch kein aktuelles Ergebnis sichtbar');
  });

  test('account Assets Manager clears folder filters from the Generate Lab handoff', async ({
    page,
  }) => {
    await mockAuthenticatedAssetsManager(page, [], {
      folderPayload: {
        folders: [
          { id: 'folder-launches', name: 'Launches', slug: 'launches', created_at: '2026-04-10T09:00:00.000Z' },
        ],
        counts: {
          'folder-launches': 1,
        },
        unfolderedCount: 1,
      },
      assetsPayload: {
        all: [
          {
            id: 'recent-launch-poster',
            asset_type: 'image',
            folder_id: 'folder-launches',
            title: 'Recent Launch Poster',
            preview_text: 'Recent Launch Poster',
            created_at: '2026-04-10T12:05:00.000Z',
            file_url: '/api/ai/images/recent-launch-poster/file',
          },
          {
            id: 'recent-loose-note',
            asset_type: 'text',
            folder_id: null,
            title: 'Recent Loose Note',
            file_name: 'recent-loose-note.txt',
            source_module: 'compare',
            mime_type: 'text/plain; charset=utf-8',
            preview_text: 'A recent note outside folders.',
            created_at: '2026-04-10T12:04:00.000Z',
            file_url: '/api/ai/text-assets/recent-loose-note/file',
          },
        ],
        folders: {
          'folder-launches': [
            {
              id: 'recent-launch-poster',
              asset_type: 'image',
              folder_id: 'folder-launches',
              title: 'Recent Launch Poster',
              preview_text: 'Recent Launch Poster',
              created_at: '2026-04-10T12:05:00.000Z',
              file_url: '/api/ai/images/recent-launch-poster/file',
            },
          ],
        },
        unfoldered: [
          {
            id: 'recent-loose-note',
            asset_type: 'text',
            folder_id: null,
            title: 'Recent Loose Note',
            file_name: 'recent-loose-note.txt',
            source_module: 'compare',
            mime_type: 'text/plain; charset=utf-8',
            preview_text: 'A recent note outside folders.',
            created_at: '2026-04-10T12:04:00.000Z',
            file_url: '/api/ai/text-assets/recent-loose-note/file',
          },
        ],
      },
    });

    await page.goto('/account/assets-manager.html?source=generate-lab&recent=1#generate-lab-recent');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(2);
    await expect(page.locator('#studioListStatus')).toContainText('Showing 2 assets, newest first');

    await page.locator('#studioGalleryFilter').selectOption('folder-launches');
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(1);
    await expect(page.locator('#studioListStatus')).toContainText('Showing 1 asset in "Launches"');
    await expect(page.locator('#studioViewContext')).toHaveCount(0);

    await page.locator('#assetsHandoffShowAll').click();
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(2);
    await expect(page.locator('#studioListStatus')).toContainText('Showing 2 assets, newest first');
    await expect(page.locator('#studioGalleryFilter')).toHaveValue('__all__');
  });

  test('account Assets Manager keeps empty folder recovery without a Folder detail panel', async ({
    page,
  }) => {
    await mockAuthenticatedAssetsManager(page, [], {
      folderPayload: {
        folders: [
          { id: 'folder-empty', name: 'Empty Project', slug: 'empty-project', created_at: '2026-04-10T09:00:00.000Z' },
        ],
        counts: {
          'folder-empty': 0,
        },
        unfolderedCount: 1,
      },
      assetsPayload: {
        all: [
          {
            id: 'loose-handoff-note',
            asset_type: 'text',
            folder_id: null,
            title: 'Loose handoff note',
            file_name: 'loose-handoff-note.txt',
            source_module: 'compare',
            mime_type: 'text/plain; charset=utf-8',
            preview_text: 'A recent save outside folders.',
            created_at: '2026-04-10T12:04:00.000Z',
            file_url: '/api/ai/text-assets/loose-handoff-note/file',
          },
        ],
        unfoldered: [
          {
            id: 'loose-handoff-note',
            asset_type: 'text',
            folder_id: null,
            title: 'Loose handoff note',
            file_name: 'loose-handoff-note.txt',
            source_module: 'compare',
            mime_type: 'text/plain; charset=utf-8',
            preview_text: 'A recent save outside folders.',
            created_at: '2026-04-10T12:04:00.000Z',
            file_url: '/api/ai/text-assets/loose-handoff-note/file',
          },
        ],
        folders: {
          'folder-empty': [],
        },
      },
    });

    await page.goto('/account/assets-manager.html?source=generate-lab&recent=1#generate-lab-recent');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });
    await page.selectOption('#studioGalleryFilter', 'folder-empty');

    await expect(page.locator('#studioFolderDetail')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Folder detail');

    await expect(page.getByRole('heading', { name: 'No assets in "Empty Project" yet' })).toBeVisible();
    await expect(page.locator('#studioImageGrid')).toContainText('If you just saved from Generate Lab, show all assets');
    await expect(page.locator('#studioListStatus')).toContainText('Folder "Empty Project" is empty');
    await expect(page.locator('#studioImageGrid').getByRole('button', { name: 'Show all assets' })).toBeVisible();
    await expect(page.locator('#studioImageGrid').getByRole('button', { name: 'Folder overview' })).toBeVisible();
    await expect(page.locator('#studioImageGrid').getByRole('link', { name: 'Create in Generate Lab' })).toHaveAttribute(
      'href',
      '/generate-lab/?source=assets-manager',
    );

    await page.locator('#studioImageGrid').getByRole('button', { name: 'Folder overview' }).click();
    await expect(page.locator('#studioFolderGrid')).toBeVisible();
    await expect(page.locator('#studioFolderDetail')).toHaveCount(0);
  });

  test('German account Assets Manager keeps empty folder recovery without Ordnerdetail panel', async ({
    page,
  }) => {
    await mockAuthenticatedAssetsManager(page, [], {
      folderPayload: {
        folders: [
          { id: 'folder-leer', name: 'Leerer Ordner', slug: 'leerer-ordner', created_at: '2026-04-10T09:00:00.000Z' },
        ],
        counts: {
          'folder-leer': 0,
        },
        unfolderedCount: 0,
      },
      assetsPayload: {
        all: [],
        unfoldered: [],
        folders: {
          'folder-leer': [],
        },
      },
    });

    await page.goto('/de/account/assets-manager.html?source=generate-lab&recent=1#generate-lab-recent');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });
    await page.selectOption('#studioGalleryFilter', 'folder-leer');

    await expect(page.locator('#studioFolderDetail')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Ordnerdetail');
    await expect(page.getByRole('heading', { name: 'Noch keine Assets in „Leerer Ordner“' })).toBeVisible();
    await expect(page.locator('#studioImageGrid')).toContainText('Wenn Sie gerade aus Generate Lab gespeichert haben');
    await expect(page.locator('#studioImageGrid').getByRole('button', { name: 'Alle Assets anzeigen' })).toBeVisible();
    await expect(page.locator('#studioImageGrid').getByRole('button', { name: 'Ordnerübersicht' })).toBeVisible();
    await expect(page.locator('#studioImageGrid').getByRole('link', { name: 'In Generate Lab erstellen' })).toHaveAttribute(
      'href',
      '/de/generate-lab/?source=assets-manager',
    );
  });

  test('account Assets Manager explains Generate Lab handoff load failures without private data', async ({
    page,
  }) => {
    await mockAuthenticatedAssetsManager(page, [], {
      getAssetsHandler: async (route) => {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'Temporary library outage.' }),
        });
      },
    });

    await page.goto('/account/assets-manager.html?source=generate-lab&recent=1#generate-lab-recent');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Could not reload your saved output' })).toBeVisible();
    await expect(page.locator('#studioListStatus')).toContainText('Generate Lab handoff could not reload saved assets');
    await expect(page.locator('#studioViewContext')).toHaveCount(0);
    await expect(page.locator('#studioImageGrid')).not.toContainText('saved-image-one');
    await expect(page.getByRole('link', { name: 'Create another output' })).toHaveAttribute('href', '/generate-lab/');
    await expect(page.locator('#assetsHandoffBanner')).toContainText('Looking for your latest creation?');
  });

  test('German account Assets Manager shows storage usage directly left of the private-by-default status', async ({
    page,
  }) => {
    const usedBytes = Math.floor(14.5 * 1024 * 1024);
    await mockAuthenticatedAssetsManager(page, [], {
      folderPayload: {
        folders: [],
        counts: {},
        unfolderedCount: 0,
        storageUsage: {
          usedBytes,
          limitBytes: ASSET_STORAGE_LIMIT_BYTES,
          remainingBytes: ASSET_STORAGE_LIMIT_BYTES - usedBytes,
        },
      },
    });

    const response = await page.goto('/de/account/assets-manager.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    const usage = page.locator('#studioStorageUsage');
    const status = page.locator('.assets-manager__status-pill');
    await expect(usage).toHaveText('14,5 MB / 50 MB');
    await expect(usage).toHaveAttribute('aria-label', /Verwendeter Speicher im Assets Manager: 14,5 MB \/ 50 MB/);
    await expect(page.locator('#studioStorageInsight')).toHaveCount(0);
    await expect(status).toHaveText('Standardmäßig privat');
    const directlyBeforeStatus = await usage.evaluate((node) =>
      node.nextElementSibling?.classList.contains('assets-manager__status-pill')
    );
    expect(directlyBeforeStatus).toBe(true);

    const boxes = await Promise.all([
      usage.boundingBox(),
      status.boundingBox(),
    ]);
    expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(boxes[1].x + 1);
    expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThanOrEqual(8);
  });

  test('admin account Assets Manager shows unlimited storage usage left of the private-by-default status', async ({
    page,
  }) => {
    const usedBytes = Math.round(124.8 * 1024 * 1024);
    await mockAuthenticatedAssetsManager(page, [], {
      userRole: 'admin',
      folderPayload: {
        folders: [],
        counts: {},
        unfolderedCount: 0,
        storageUsage: {
          usedBytes,
          limitBytes: null,
          remainingBytes: null,
          isUnlimited: true,
        },
      },
    });

    const response = await page.goto('/account/assets-manager.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    const usage = page.locator('#studioStorageUsage');
    const status = page.locator('.assets-manager__status-pill');
    await expect(usage).toHaveText('124,8 MB / ∞');
    await expect(usage).toHaveAttribute('aria-label', /Used storage in Assets Manager: 124,8 MB \/ ∞/);
    await expect(page.locator('#studioStorageInsight')).toHaveCount(0);
    await expect(status).toHaveText('Private by default');
    const directlyBeforeStatus = await usage.evaluate((node) =>
      node.nextElementSibling?.classList.contains('assets-manager__status-pill')
    );
    expect(directlyBeforeStatus).toBe(true);

    const boxes = await Promise.all([
      usage.boundingBox(),
      status.boundingBox(),
    ]);
    expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(boxes[1].x + 1);
    expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThanOrEqual(8);
  });

  test('account Assets Manager refreshes storage usage after image save and delete', async ({
    page,
  }) => {
    await mockAuthenticatedAssetsManager(page, [], {
      savedImageSizeBytes: Math.floor(14.5 * 1024 * 1024),
    });

    const response = await page.goto('/account/assets-manager.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#studioStorageUsage')).toHaveText('0 MB / 50 MB');

    await page.evaluate(async (base64) => {
      const { apiAiSaveImage } = await import('/js/shared/auth-api.js');
      const result = await apiAiSaveImage(
        { imageData: `data:image/png;base64,${base64}` },
        'Storage indicator upload',
        '@cf/black-forest-labs/flux-1-schnell',
        4,
        null,
        null,
      );
      if (!result.ok) throw new Error(result.error || 'save failed');
    }, ONE_PX_PNG_BASE64);

    await expect(page.locator('#studioStorageUsage')).toHaveText('14,5 MB / 50 MB');

    await page.locator('#studioGalleryFilter').selectOption('__all__');
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(1);
    await page.locator('#studioImageGrid .studio__image-item').hover();
    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.locator('#studioImageGrid .studio__image-delete').click();

    await expect(page.locator('#studioStorageUsage')).toHaveText('0 MB / 50 MB');
    await expect(page.locator('.assets-manager__status-pill')).toHaveText('Private by default');
  });

  test('shared image generation API sends valid idempotency keys without changing request bodies', async ({
    page,
  }) => {
    const imageRequests = [];
    const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/;

    await page.route('**/api/ai/generate-image', async (route) => {
      imageRequests.push({
        body: route.request().postDataJSON(),
        idempotencyKey: route.request().headers()['idempotency-key'] || '',
      });
      await fulfillJson(route, {
        ok: true,
        data: {
          imageBase64: ONE_PX_PNG_BASE64,
          mimeType: 'image/png',
          saveReference: 'frontend-idempotency-reference',
        },
        billing: {
          credits_charged: 1,
          balance_after: 9,
        },
      });
    });

    const response = await page.goto('/');
    expect(response.status()).toBe(200);
    const results = await page.evaluate(async () => {
      const { apiAiGenerateImage } = await import('/js/shared/auth-api.js');
      const first = await apiAiGenerateImage(
        'First browser image request',
        4,
        123,
        '@cf/black-forest-labs/flux-1-schnell',
      );
      const second = await apiAiGenerateImage({
        prompt: 'Second browser image request',
        model: 'openai/gpt-image-2',
        quality: 'medium',
        size: '1024x1024',
      });
      const retry = await apiAiGenerateImage(
        'Retry browser image request',
        4,
        456,
        '@cf/black-forest-labs/flux-1-schnell',
        { headers: { 'Idempotency-Key': 'frontend-image-retry-123' } },
      );
      return [first.ok, second.ok, retry.ok];
    });

    expect(results).toEqual([true, true, true]);
    expect(imageRequests).toHaveLength(3);
    expect(imageRequests[0].idempotencyKey).toMatch(keyPattern);
    expect(imageRequests[1].idempotencyKey).toMatch(keyPattern);
    expect(imageRequests[0].idempotencyKey).not.toBe(imageRequests[1].idempotencyKey);
    expect(imageRequests[2].idempotencyKey).toBe('frontend-image-retry-123');
    expect(imageRequests[0].idempotencyKey).not.toContain('First browser image request');
    expect(imageRequests[1].idempotencyKey).not.toContain('Second browser image request');
    expect(imageRequests[0].body).toEqual(expect.objectContaining({
      prompt: 'First browser image request',
      steps: 4,
      seed: 123,
      model: '@cf/black-forest-labs/flux-1-schnell',
    }));
    expect(imageRequests[1].body).toEqual(expect.objectContaining({
      prompt: 'Second browser image request',
      model: 'openai/gpt-image-2',
      quality: 'medium',
      size: '1024x1024',
    }));
  });

  test('shared generation APIs apply the 600 second timeout to image, music, and video requests', async ({
    page,
  }) => {
    const seenPaths = [];
    await page.addInitScript(() => {
      window.__bitbiGenerationTimeoutDelays = [];
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (fn, delay, ...args) => {
        if (delay === 600000) {
          window.__bitbiGenerationTimeoutDelays.push(delay);
        }
        return nativeSetTimeout(fn, delay, ...args);
      };
    });

    await page.route('**/api/ai/generate-image', async (route) => {
      seenPaths.push('/api/ai/generate-image');
      await fulfillJson(route, {
        ok: true,
        data: {
          imageBase64: ONE_PX_PNG_BASE64,
          mimeType: 'image/png',
          saveReference: 'timeout-image-reference',
        },
      });
    });
    await page.route('**/api/ai/generate-music', async (route) => {
      seenPaths.push('/api/ai/generate-music');
      await fulfillJson(route, {
        ok: true,
        data: {
          audioUrl: 'https://example.com/generated-audio.mp3',
          saveReference: 'timeout-music-reference',
        },
      });
    });
    await page.route('**/api/ai/generate-video', async (route) => {
      seenPaths.push('/api/ai/generate-video');
      await fulfillJson(route, {
        ok: true,
        data: {
          videoUrl: 'https://example.com/generated-video.mp4',
          saveReference: 'timeout-video-reference',
        },
      });
    });

    const response = await page.goto('/');
    expect(response.status()).toBe(200);
    const results = await page.evaluate(async () => {
      const {
        apiAiGenerateImage,
        apiAiGenerateMusic,
        apiAiGenerateVideo,
      } = await import('/js/shared/auth-api.js');
      const image = await apiAiGenerateImage({
        prompt: 'timeout image wrapper',
        model: '@cf/black-forest-labs/flux-1-schnell',
      });
      const music = await apiAiGenerateMusic({
        prompt: 'timeout music wrapper',
        model: '@cf/meta/musicgen-small',
      });
      const video = await apiAiGenerateVideo({
        prompt: 'timeout video wrapper',
        model: '@cf/bytedance/stable-video-diffusion-img2vid',
      });
      return {
        ok: [image.ok, music.ok, video.ok],
        delays: window.__bitbiGenerationTimeoutDelays,
      };
    });

    expect(results.ok).toEqual([true, true, true]);
    expect(results.delays.filter((delay) => delay === 600000)).toHaveLength(3);
    expect(seenPaths).toEqual([
      '/api/ai/generate-image',
      '/api/ai/generate-music',
      '/api/ai/generate-video',
    ]);
  });

  test('homepage create studio offers FLUX.2 Klein while keeping FLUX.1 Schnell as default', async ({
    page,
  }) => {
    const requests = [];
    await mockAuthenticatedAssetsManager(page, requests);

    const response = await page.goto('/');
    expect(response.status()).toBe(200);
    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Gallery' }).click();
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', 'gallery');
    await expect(page.locator('.gallery-mode__btn[data-mode="create"]')).toBeVisible({ timeout: 10_000 });

    await page.locator('.gallery-mode__btn[data-mode="create"]').click();
    await expect(page.locator('#galleryStudio')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#galleryStudio .creator-create__panel')).toHaveCount(2);
    await expect(page.locator('#galleryCreateTitle')).toHaveText('FLUX.1 Schnell');
    await expect(page.locator('#galleryStudio .creator-create__preview .creator-create__empty'))
      .toContainText('Your generated image will appear here.');
    await expect(page.locator('#galStudioModel')).toHaveValue('@cf/black-forest-labs/flux-1-schnell');
    await expect(page.locator('#galStudioModel option')).toHaveCount(2);
    await expect(page.locator('#galStudioModel')).toContainText('FLUX.1 Schnell');
    await expect(page.locator('#galStudioModel')).toContainText('FLUX.2 Klein 9B');
    await expect(page.locator('#galStudioModel')).not.toContainText('FLUX.2 Dev');
    await expect(page.locator('#galleryStudio .studio__quota')).toContainText('10 credits available');
    await expect(page.locator('#galleryStudio .studio__quota')).not.toContainText('generations');
    await expect(page.locator('#galStudioCreditEstimate')).toHaveText('1 credit');
    await expect(page.locator('#galStudioGenerate')).toHaveText('Generate · 1 credit');
    await expect(page.locator('#galStudioGenerate')).toHaveAttribute('aria-label', /estimated cost 1 credit/i);
    await expect(page.locator('#galleryStudio .creator-create__select').first())
      .not.toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.setViewportSize({ width: 390, height: 844 });
    const galleryMobileLayout = await page.locator('#galleryStudio .creator-create__panel').evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: window.innerWidth };
    }));
    expect(galleryMobileLayout.every((rect) => rect.left >= 0 && rect.right <= rect.viewportWidth + 1 && rect.width > 0)).toBe(true);

    await page.locator('#galStudioPrompt').fill('homepage legacy model request');
    await page.locator('#galStudioGenerate').click();
    await expect(page.locator('#galStudioPreview img')).toBeVisible();
    await expect(page.locator('#galleryStudio .studio__quota')).toContainText('9 credits available');

    expect(requests.at(-1)).toEqual(expect.objectContaining({
      prompt: 'homepage legacy model request',
      model: '@cf/black-forest-labs/flux-1-schnell',
    }));

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/de/');
    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Galerie' }).click();
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', 'gallery');
    await page.locator('.gallery-mode__btn[data-mode="create"]').click();
    await expect(page.locator('#galleryStudio')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#galStudioModel')).toHaveValue('@cf/black-forest-labs/flux-1-schnell');
    await expect(page.locator('#galStudioModel option')).toHaveText(['FLUX.1 Schnell', 'FLUX.2 Klein 9B']);
    await expect(page.locator('#galStudioModel')).not.toContainText('FLUX.2 Dev');
    await page.selectOption('#galStudioModel', '@cf/black-forest-labs/flux-2-klein-9b');
    await expect(page.locator('#galleryCreateTitle')).toHaveText('FLUX.2 Klein 9B');
    await expect(page.locator('#galStudioCreditEstimate')).toHaveText('10 Credits');
    await expect(page.locator('#galStudioGenerate')).toHaveText('Generieren · 10 Credits');
  });

  test('homepage create studio disables unsupported FLUX.2 Klein controls and omits unsupported payload fields', async ({
    page,
  }) => {
    const requests = [];
    await mockAuthenticatedAssetsManager(page, requests);

    const response = await page.goto('/');
    expect(response.status()).toBe(200);
    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Gallery' }).click();
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', 'gallery');
    await page.locator('.gallery-mode__btn[data-mode="create"]').click();
    await expect(page.locator('#galleryStudio')).toBeVisible({ timeout: 10_000 });

    await page.selectOption('#galStudioModel', '@cf/black-forest-labs/flux-2-klein-9b');
    await expect(page.locator('#galleryCreateTitle')).toHaveText('FLUX.2 Klein 9B');
    await expect(page.locator('#galStudioCreditEstimate')).toHaveText('10 credits');
    await expect(page.locator('#galStudioGenerate')).toHaveText('Generate · 10 credits');

    const flux2CapabilityState = await page.locator('#galleryStudio').evaluate((studio) => {
      const steps = studio.querySelector('#galStudioSteps');
      const seed = studio.querySelector('#galStudioSeed');
      const randomize = studio.querySelector('#galStudioRandomize');
      return {
        stepsDisabled: steps.disabled,
        stepsHidden: steps.closest('.creator-create__field').hidden,
        seedDisabled: seed.disabled,
        seedHidden: seed.closest('.creator-create__field').hidden,
        randomizeDisabled: randomize.disabled,
      };
    });
    expect(flux2CapabilityState).toEqual({
      stepsDisabled: true,
      stepsHidden: true,
      seedDisabled: true,
      seedHidden: true,
      randomizeDisabled: true,
    });

    await page.locator('#galStudioPrompt').fill('homepage flux2 klein request');
    await page.locator('#galStudioGenerate').click();
    await expect(page.locator('#galStudioPreview img')).toBeVisible();
    expect(requests.at(-1)).toEqual(expect.objectContaining({
      prompt: 'homepage flux2 klein request',
      model: '@cf/black-forest-labs/flux-2-klein-9b',
    }));
    expect(requests.at(-1)).not.toHaveProperty('steps');
    expect(requests.at(-1)).not.toHaveProperty('seed');

    await page.selectOption('#galStudioModel', '@cf/black-forest-labs/flux-1-schnell');
    await expect(page.locator('#galleryCreateTitle')).toHaveText('FLUX.1 Schnell');
    await expect(page.locator('#galStudioCreditEstimate')).toHaveText('1 credit');
    const flux1CapabilityState = await page.locator('#galleryStudio').evaluate((studio) => {
      const steps = studio.querySelector('#galStudioSteps');
      const seed = studio.querySelector('#galStudioSeed');
      const randomize = studio.querySelector('#galStudioRandomize');
      return {
        stepsDisabled: steps.disabled,
        stepsHidden: steps.closest('.creator-create__field').hidden,
        seedDisabled: seed.disabled,
        seedHidden: seed.closest('.creator-create__field').hidden,
        randomizeDisabled: randomize.disabled,
      };
    });
    expect(flux1CapabilityState).toEqual({
      stepsDisabled: false,
      stepsHidden: false,
      seedDisabled: false,
      seedHidden: false,
      randomizeDisabled: false,
    });
  });

  test('homepage create studio sends a fresh idempotency key for each image generation click', async ({
    page,
  }) => {
    const requests = [];
    const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/;

    await mockAuthenticatedAssetsManager(page, []);
    await page.unroute('**/api/ai/generate-image');
    await page.route('**/api/ai/generate-image', async (route) => {
      const body = route.request().postDataJSON();
      requests.push({
        body,
        idempotencyKey: route.request().headers()['idempotency-key'] || '',
      });
      await fulfillJson(route, {
        ok: true,
        data: {
          imageBase64: ONE_PX_PNG_BASE64,
          mimeType: 'image/png',
          prompt: body.prompt,
          model: body.model || '@cf/black-forest-labs/flux-1-schnell',
          steps: body.steps ?? 4,
          seed: body.seed ?? null,
          saveReference: `homepage-click-${requests.length}`,
        },
        billing: {
          credits_charged: 1,
          balance_after: Math.max(0, 10 - requests.length),
        },
      });
    });

    const response = await page.goto('/');
    expect(response.status()).toBe(200);
    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Gallery' }).click();
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', 'gallery');
    await page.locator('.gallery-mode__btn[data-mode="create"]').click();
    await expect(page.locator('#galleryStudio')).toBeVisible({ timeout: 10_000 });

    await page.locator('#galStudioPrompt').fill('homepage idempotency request one');
    await page.locator('#galStudioGenerate').click();
    await expect(page.locator('#galStudioPreview img')).toBeVisible();

    await page.locator('#galStudioPrompt').fill('homepage idempotency request two');
    await page.locator('#galStudioGenerate').click();
    await expect.poll(() => requests.length).toBe(2);

    expect(requests[0].idempotencyKey).toMatch(keyPattern);
    expect(requests[1].idempotencyKey).toMatch(keyPattern);
    expect(requests[0].idempotencyKey).not.toBe(requests[1].idempotencyKey);
    expect(requests[0].body).toEqual(expect.objectContaining({
      prompt: 'homepage idempotency request one',
      model: '@cf/black-forest-labs/flux-1-schnell',
    }));
    expect(requests[1].body).toEqual(expect.objectContaining({
      prompt: 'homepage idempotency request two',
      model: '@cf/black-forest-labs/flux-1-schnell',
    }));
  });

  test('homepage Sound Lab Create opens MiniMax music generation with live credit pricing', async ({
    page,
  }) => {
    const musicRequests = [];
    const assetStore = createSavedAssetsStore({ folders: [], counts: {}, unfolderedCount: 0 }, {
      all: [],
      unfoldered: [],
      folders: {},
    });
    await mockAuthenticatedAssetsManager(page, [], { assetStore });
    await page.route('**/api/ai/generate-music', async (route) => {
      const body = route.request().postDataJSON();
      musicRequests.push({
        body,
        idempotencyKey: route.request().headers()['idempotency-key'],
      });
      const savedAsset = {
        id: 'soundlab-track-1',
        asset_type: 'sound',
        folder_id: null,
        title: 'Homepage Sound Lab Track',
        file_name: 'homepage-sound-lab-track.mp3',
        source_module: 'music',
        mime_type: 'audio/mpeg',
        size_bytes: 4096,
        preview_text: body.prompt,
        created_at: '2026-04-10T12:09:00.000Z',
        file_url: '/api/ai/text-assets/soundlab-track-1/file',
      };
      assetStore.addAsset(savedAsset);
      setTimeout(() => {
        assetStore.addAsset({
          ...savedAsset,
          poster_url: '/api/ai/text-assets/soundlab-track-1/poster',
          poster_width: 320,
          poster_height: 320,
        });
      }, 250);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            prompt: body.prompt,
            mode: body.instrumental ? 'instrumental' : 'vocals',
            lyricsMode: body.generateLyrics ? 'custom' : 'auto',
            model: { id: 'minimax/music-2.6', label: 'Music 2.6', vendor: 'MiniMax' },
            mimeType: 'audio/mpeg',
            audioUrl: '/api/ai/text-assets/soundlab-track-1/file',
            lyricsPreview: body.generateLyrics ? '[Verse]\nGenerated lyrics' : null,
            asset: {
              id: 'soundlab-track-1',
              title: 'Homepage Sound Lab Track',
              source_module: 'music',
              mime_type: 'audio/mpeg',
              file_url: '/api/ai/text-assets/soundlab-track-1/file',
            },
          },
          billing: {
            credits_charged: body.generateLyrics ? 160 : 150,
            balance_after: body.generateLyrics ? 840 : 850,
          },
        }),
      });
    });

    const response = await page.goto('/');
    expect(response.status()).toBe(200);
    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Sound Lab' }).click();
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', 'sound');

    const createButton = page.locator('#soundlab .video-mode__btn[data-sound-mode="create"]');
    await expect(createButton).toBeVisible({ timeout: 10_000 });
    await expect(createButton).not.toContainText('Soon');
    await expect(createButton).not.toHaveClass(/video-mode__btn--soon/);

    await createButton.click();
    await expect(page.locator('#soundLabCreate')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#soundLabExplore')).toBeHidden();
    await expect(page.locator('#soundLabCreate .creator-create__panel')).toHaveCount(2);
    await expect(page.locator('#soundCreateTitle')).toHaveText('Music 2.6');
    await expect(page.locator('#soundLabCreate .creator-create__preview .creator-create__empty'))
      .toContainText('Your generated music will appear here.');
    await expect(page.locator('#soundLabCreate .sound-create__info')).toHaveText('Music generation can take up to 2 minutes.');
    await expect(page.locator('#soundMusicCreditEstimate')).toHaveText('150 credits');
    await expect(page.locator('#soundMusicGenerate')).toHaveText('Generate Music — 150 Credits');
    await expect(page.locator('#soundLabCreate .creator-create__toggle')).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 844 });
    const soundMobileLayout = await page.locator('#soundLabCreate .creator-create__panel').evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: window.innerWidth };
    }));
    expect(soundMobileLayout.every((rect) => rect.left >= 0 && rect.right <= rect.viewportWidth + 1 && rect.width > 0)).toBe(true);

    await page.locator('#soundMusicGenerateLyrics').check();
    await expect(page.locator('#soundMusicCreditEstimate')).toHaveText('160 credits');
    await expect(page.locator('#soundMusicGenerate')).toHaveText('Generate Music — 160 Credits');
    await page.locator('#soundMusicGenerateLyrics').uncheck();
    await expect(page.locator('#soundMusicCreditEstimate')).toHaveText('150 credits');
    await expect(page.locator('#soundMusicGenerate')).toHaveText('Generate Music — 150 Credits');

    await page.locator('#soundMusicPrompt').fill('A glossy synth pop track for late night coding.');
    await page.locator('#soundMusicGenerate').click();
    await expect(page.locator('#soundMusicPreview audio')).toBeVisible();
    const generatedAudioSrc = await page.locator('#soundMusicPreview audio').getAttribute('src');
    await page.locator('#soundMusicPreview audio').evaluate((audio) => {
      audio.currentTime = 42;
      audio.dispatchEvent(new Event('seeking'));
      audio.dispatchEvent(new Event('timeupdate'));
    });
    await expect
      .poll(() => page.locator('#soundMusicPreview audio').evaluate((audio) => audio.currentTime))
      .toBe(42);
    await expect(page.locator('#soundMusicPreview audio')).toHaveAttribute('src', generatedAudioSrc);
    await expect(page.locator('#soundMusicPreview .sound-create__cover'))
      .toHaveAttribute('data-cover-state', 'fallback');
    await expect(page.locator('#soundMusicPreview .sound-create__cover img')).toHaveCount(0);
    await expect(page.locator('#soundMusicPreview .sound-create__cover-play')).toBeVisible();
    await expect(page.locator('#soundMusicPreview .sound-create__cover img'))
      .toHaveAttribute('src', '/api/ai/text-assets/soundlab-track-1/poster');
    await expect(page.locator('#soundMusicPreview .sound-create__cover'))
      .toHaveAttribute('data-cover-state', 'ready');
    await expect(page.locator('#soundMusicPreview .sound-create__cover-play')).toBeVisible();
    await expect(page.locator('#soundMusicMsg')).toContainText('Music generated and saved.');
    await expect(page.locator('#soundLabCreate .studio__quota')).toContainText('850 credits available');

    expect(musicRequests).toHaveLength(1);
    expect(musicRequests[0].idempotencyKey).toMatch(/^soundlab-music-/);
    expect(musicRequests[0].body).toEqual(expect.objectContaining({
      prompt: 'A glossy synth pop track for late night coding.',
      instrumental: false,
      generateLyrics: false,
    }));
    expect(musicRequests[0].body.price).toBeUndefined();
    expect(musicRequests[0].body.credits).toBeUndefined();
  });

  test('homepage hero-linked models list omits unreleased internal models from the public overlay', async ({
    page,
  }) => {
    const response = await page.goto('/');
    expect(response.status()).toBe(200);

    await page.locator('[data-models-link="desktop"]').click();
    const overlay = page.locator('.models-overlay');
    await expect(overlay).toHaveClass(/is-active/);
    await expect(overlay).toContainText('FLUX.1 Schnell');
    const fluxKleinCard = overlay.locator('.models-overlay__card').filter({ hasText: 'FLUX.2 Klein 9B' });
    await expect(fluxKleinCard.locator('.models-overlay__status')).toHaveText('LIVE');
    const gptImageCard = overlay.locator('.models-overlay__card').filter({ hasText: 'GPT Image 2' });
    await expect(gptImageCard.locator('.models-overlay__status')).toHaveText('LIVE');
    const musicCard = overlay.locator('.models-overlay__card').filter({ hasText: 'Music 2.6' });
    await expect(musicCard.locator('.models-overlay__status')).toHaveText('LIVE');
    const videoCard = overlay.locator('.models-overlay__card').filter({ hasText: 'PixVerse V6' });
    await expect(videoCard.locator('.models-overlay__status')).toHaveText('LIVE');
    await expect(overlay.locator('.models-overlay__card').filter({ hasText: 'Vidu Q3 Pro' })).toHaveCount(0);
    const seedanceFastCard = overlay.locator('.models-overlay__card').filter({ hasText: 'Seedance 2.0 Fast' });
    await expect(seedanceFastCard.locator('.models-overlay__status')).toHaveText('LIVE');
    const publicModelNames = await overlay.locator('.models-overlay__name').evaluateAll((nodes) => (
      nodes.map((node) => node.textContent?.trim() || '')
    ));
    expect(publicModelNames).toContain('Seedance 2.0 Fast');
    expect(publicModelNames).not.toContain('Seedance 2.0');
    const happyHorseCard = overlay.locator('.models-overlay__card').filter({ hasText: 'HappyHorse 1.0 T2V' });
    await expect(happyHorseCard.locator('.models-overlay__status')).toHaveText('LIVE');
    await expect(overlay.locator('.models-overlay__status').first()).toContainText('LIVE');
    await expect.poll(() => overlay.locator('.models-overlay__status').evaluateAll((nodes) =>
      nodes.map((node) => node.textContent?.trim() || ''),
    )).not.toContain('Included');
    await expect(overlay).not.toContainText('FLUX.2 Dev');
  });

  test('homepage Video Create exposes PixVerse V6 with dynamic credit estimates', async ({ page }) => {
    const videoRequests = [];
    await mockAuthenticatedAssetsManager(page, [], { creditBalance: 1200 });
    await page.route('**/api/ai/generate-video', async (route) => {
      const body = route.request().postDataJSON();
      videoRequests.push({
        body,
        idempotencyKey: route.request().headers()['idempotency-key'],
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            prompt: body.prompt,
            model: { id: 'pixverse/v6', label: 'PixVerse V6', vendor: 'PixVerse' },
            duration: body.duration,
            aspect_ratio: body.aspect_ratio,
            quality: body.quality,
            generate_audio: body.generate_audio,
            mimeType: 'video/mp4',
            videoUrl: '/api/ai/text-assets/abc12001/file',
            asset: {
              id: 'abc12001',
              title: 'Homepage PixVerse Video',
              source_module: 'video',
              mime_type: 'video/mp4',
              file_url: '/api/ai/text-assets/abc12001/file',
            },
          },
          billing: {
            credits_charged: body.generate_audio ? 708 : 555,
            balance_after: 292,
          },
        }),
      });
    });
    await page.route('**/api/ai/text-assets/abc12001/file', async (route) => {
      await fulfillTestMp4(route);
    });

    const response = await page.goto('/');
    expect(response.status()).toBe(200);
    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Video' }).click();
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', 'video');

    const createButton = page.locator('#video-creations .video-mode__btn[data-video-mode="create"]');
    await expect(createButton).toBeVisible({ timeout: 10_000 });
    await expect(createButton).not.toContainText('Soon');
    await expect(createButton).not.toHaveClass(/video-mode__btn--soon/);

    await createButton.click();
    await expect(page.locator('#videoCreate')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#videoExplore')).toBeHidden();
    await expect(page.locator('#videoCreateTitle')).toHaveText('PixVerse V6');
    await expect(page.locator('#videoCreditEstimate')).toHaveText('185 credits');
    await expect(page.locator('#videoCreditBalance')).toContainText('1200 credits available');
    await expect(page.locator('#videoGenerate')).toHaveText('Generate Video');
    await expect(page.locator('#videoReferenceImage')).toHaveCount(1);
    await expect(page.locator('.video-create__upload')).toBeVisible();
    const referenceInputChrome = await page.locator('#videoReferenceImage').evaluate((node) => {
      const style = window.getComputedStyle(node);
      return {
        clipPath: style.clipPath,
        width: style.width,
        height: style.height,
        position: style.position,
      };
    });
    expect(referenceInputChrome).toEqual(expect.objectContaining({
      clipPath: 'inset(50%)',
      width: '1px',
      height: '1px',
      position: 'absolute',
    }));
    await expect(page.locator('#videoPreview .video-create__empty')).toContainText('Your generated video will appear here.');

    await page.locator('#videoDuration').selectOption('10');
    await expect(page.locator('#videoCreditEstimate')).toHaveText('370 credits');
    await page.locator('#videoQuality').selectOption('1080p');
    await expect(page.locator('#videoCreditEstimate')).toHaveText('708 credits');
    await page.locator('#videoGenerateAudio').uncheck();
    await expect(page.locator('#videoCreditEstimate')).toHaveText('555 credits');
    await expect(page.locator('#videoGenerate')).toHaveAttribute('aria-label', 'Generate PixVerse V6 video for 555 credits');
    await expect(page.locator('.video-create__select').first()).not.toHaveCSS('background-color', 'rgb(255, 255, 255)');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#videoCreate')).toBeVisible();
    const mobileLayout = await page.locator('#videoCreate .video-create__panel').evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: window.innerWidth };
    }));
    expect(mobileLayout.every((rect) => rect.left >= 0 && rect.right <= rect.viewportWidth + 1 && rect.width > 0)).toBe(true);
    const referenceImageInput = page.locator('#videoReferenceImage');
    await referenceImageInput.setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
    });
    const referenceThumb = page.locator('#videoReferenceThumb img');
    await expect(referenceThumb).toBeVisible();
    await expect(referenceThumb).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(page.locator('#videoReferencePreview')).toHaveText('reference.png');
    await expect(page.locator('#videoReferenceRemove')).toBeVisible();
    await page.locator('#videoReferenceRemove').click();
    await expect(referenceThumb).toHaveCount(0);
    await expect(page.locator('#videoReferenceThumb')).toBeHidden();
    await expect(page.locator('#videoReferencePreview')).toHaveText('Optional image-to-video reference');
    await referenceImageInput.setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
    });
    await expect(page.locator('#videoReferenceThumb img')).toBeVisible();

    await page.locator('#videoPrompt').fill('A dramatic product reveal in a luminous glass studio.');
    await page.locator('#videoGenerate').click();
    const videoPreview = page.locator('#videoPreview');
    const generatedVideo = page.locator('#videoPreview video.video-create__player');
    await expect(generatedVideo).toBeVisible();
    await expect(generatedVideo).toHaveAttribute('src', '/api/ai/text-assets/abc12001/file');
    await expect(videoPreview).toBeInViewport();
    await expect(videoPreview).toBeFocused();
    await expect(page.locator('#videoMsg')).toContainText('Video generated and saved.');
    const mobilePlayerLayout = await generatedVideo.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        viewportWidth: window.innerWidth,
        maxWidth: style.maxWidth,
        height: style.height,
        playsInline: node.playsInline,
        playsInlineAttr: node.getAttribute('playsinline'),
      };
    });
    expect(mobilePlayerLayout.left).toBeGreaterThanOrEqual(0);
    expect(mobilePlayerLayout.right).toBeLessThanOrEqual(mobilePlayerLayout.viewportWidth + 1);
    expect(mobilePlayerLayout.width).toBeGreaterThan(0);
    expect(mobilePlayerLayout.maxWidth).toBe('100%');
    expect(parseFloat(mobilePlayerLayout.height)).toBeGreaterThan(0);
    expect(mobilePlayerLayout.playsInline).toBe(true);
    expect(mobilePlayerLayout.playsInlineAttr).not.toBeNull();

    expect(videoRequests).toHaveLength(1);
    expect(videoRequests[0].idempotencyKey).toMatch(/^video-pixverse-/);
    expect(videoRequests[0].body).toEqual(expect.objectContaining({
      prompt: 'A dramatic product reveal in a luminous glass studio.',
      duration: 10,
      quality: '1080p',
      aspect_ratio: '16:9',
      generate_audio: false,
    }));
    expect(videoRequests[0].body.image_input).toMatch(/^data:image\/png;base64,/);
    expect(videoRequests[0].body.price).toBeUndefined();
    expect(videoRequests[0].body.credits).toBeUndefined();
  });

  test('homepage mobile PixVerse preview loads playable saved MP4 media', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: MOBILE_CHROME_USER_AGENT,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const videoRequests = [];
    await mockAuthenticatedAssetsManager(page, [], { creditBalance: 1200 });
    await page.route('**/api/public/news-pulse**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], updated_at: '2026-05-09T00:00:00.000Z' }),
      });
    });
    await page.route('**/api/ai/generate-video', async (route) => {
      const body = route.request().postDataJSON();
      videoRequests.push({
        kind: 'generate',
        body,
        idempotencyKey: route.request().headers()['idempotency-key'],
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            prompt: body.prompt,
            model: { id: 'pixverse/v6', label: 'PixVerse V6', vendor: 'PixVerse' },
            duration: body.duration,
            aspect_ratio: body.aspect_ratio,
            quality: body.quality,
            generate_audio: body.generate_audio,
            mimeType: 'video/mp4',
            videoUrl: '/api/ai/text-assets/abc123ef/file',
            asset: {
              id: 'abc123ef',
              title: 'Homepage PixVerse Video',
              source_module: 'video',
              mime_type: 'video/mp4',
              file_url: '/api/ai/text-assets/abc123ef/file',
            },
          },
          billing: {
            credits_charged: 185,
            balance_after: 1015,
          },
        }),
      });
    });
    await page.route('**/api/ai/text-assets/abc123ef/file', async (route) => {
      videoRequests.push({
        kind: 'media',
        method: route.request().method(),
        range: route.request().headers().range || '',
      });
      await fulfillTestMp4(route);
    });

    try {
      const response = await page.goto('/');
      expect(response.status()).toBe(200);
      const createButton = page.locator('#video-creations .video-mode__btn[data-video-mode="create"]');
      await expect(createButton).toBeVisible({ timeout: 10_000 });
      await createButton.click();
      await expect(page.locator('#videoCreate')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('#videoPreview')).toBeVisible();
      await expect(page.locator('.video-create__panel--preview')).toBeVisible();
      await expect(page.locator('#videoGenerate')).toBeEnabled();

      const activeState = await page.evaluate(() => {
        const selectors = [
          '#videoCreate',
          '#videoPreview',
          '.video-create__shell',
          '.video-create__panel--preview',
          '#videoGenerate',
        ];
        return selectors.map((selector) => {
          const node = document.querySelector(selector);
          const rect = node?.getBoundingClientRect();
          const blockedByAncestor = [];
          for (let el = node; el; el = el.parentElement) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none') blockedByAncestor.push(`${el.id || el.className || el.tagName}:display:none`);
            if (style.visibility === 'hidden') blockedByAncestor.push(`${el.id || el.className || el.tagName}:visibility:hidden`);
            if (style.pointerEvents === 'none') blockedByAncestor.push(`${el.id || el.className || el.tagName}:pointer-events:none`);
            if (el.hasAttribute('inert')) blockedByAncestor.push(`${el.id || el.className || el.tagName}:inert`);
            if (el.getAttribute('aria-hidden') === 'true') blockedByAncestor.push(`${el.id || el.className || el.tagName}:aria-hidden`);
          }
          return {
            selector,
            exists: Boolean(node),
            width: rect?.width || 0,
            height: rect?.height || 0,
            blockedByAncestor,
          };
        });
      });
      expect(activeState.every((entry) => entry.exists && entry.width > 0 && entry.height > 0)).toBe(true);
      expect(activeState.flatMap((entry) => entry.blockedByAncestor)).toEqual([]);

      await page.locator('#videoPrompt').fill('A compact mobile PixVerse playback diagnostic.');
      const generationResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith('/api/ai/generate-video') && response.request().method() === 'POST'
      );
      await page.locator('#videoGenerate').click();
      const generationResponse = await generationResponsePromise;
      expect(generationResponse.ok()).toBe(true);

      const videoPreview = page.locator('#videoPreview');
      const generatedVideo = page.locator('#videoPreview video.video-create__player');
      await expect(generatedVideo).toBeVisible({ timeout: 10_000 });
      await expect(generatedVideo).toHaveAttribute('src', '/api/ai/text-assets/abc123ef/file');
      await expect(videoPreview).toBeInViewport();

      const mediaState = await waitForVideoMediaState(generatedVideo);
      expect(mediaState.error).toBeNull();
      expect(mediaState.currentSrc).toContain('/api/ai/text-assets/abc123ef/file');
      expect(mediaState.controls).toBe(true);
      expect(mediaState.playsInline).toBe(true);
      expect(mediaState.playsInlineAttr).not.toBeNull();
      expect(mediaState.webkitPlaysInlineAttr).not.toBeNull();
      expect(mediaState.readyState).toBeGreaterThanOrEqual(1);
      expect(mediaState.events.some((eventName) => eventName === 'loadedmetadata' || eventName === 'already-have-metadata')).toBe(true);
      expect(videoRequests.some((entry) => entry.kind === 'generate')).toBe(true);
      expect(videoRequests.some((entry) => entry.kind === 'media' && entry.method === 'GET')).toBe(true);
    } finally {
      await context.close();
    }
  });

  for (const scenario of [
    {
      locale: 'English',
      path: '/',
      assetId: 'abc123bb',
      prompt: 'A mobile PixVerse WebM compatibility diagnostic.',
      fallbackText: 'Video generated and saved, but this mobile browser cannot preview this video format.',
      openVideoText: 'Open video in new tab',
      assetsText: 'Open in Assets Manager',
      successText: 'Video generated and saved.',
    },
    {
      locale: 'German',
      path: '/de/',
      assetId: 'abc123bd',
      prompt: 'Eine mobile PixVerse-WebM-Kompatibilitätsprüfung.',
      fallbackText: 'Das Video wurde generiert und gespeichert, aber dieser mobile Browser kann dieses Videoformat nicht als Vorschau abspielen.',
      openVideoText: 'Video in neuem Tab öffnen',
      assetsText: 'Assets Manager öffnen',
      successText: 'Video generiert und gespeichert.',
    },
  ]) {
    test(`homepage mobile PixVerse preview keeps saved result visible for unsupported WebM media (${scenario.locale})`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        userAgent: MOBILE_CHROME_USER_AGENT,
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalCanPlayType = HTMLMediaElement.prototype.canPlayType;
        HTMLMediaElement.prototype.canPlayType = function canPlayType(type) {
          if (String(type || '').toLowerCase().includes('video/webm')) return '';
          return originalCanPlayType.call(this, type);
        };
      });
      await mockAuthenticatedAssetsManager(page, [], { creditBalance: 1200 });
      await page.route('**/api/public/news-pulse**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], updated_at: '2026-05-09T00:00:00.000Z' }),
        });
      });
      await page.route('**/api/ai/generate-video', async (route) => {
        const body = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            data: {
              prompt: body.prompt,
              model: { id: 'pixverse/v6', label: 'PixVerse V6', vendor: 'PixVerse' },
              duration: body.duration,
              aspect_ratio: body.aspect_ratio,
              quality: body.quality,
              generate_audio: body.generate_audio,
              mimeType: 'video/webm',
              videoUrl: `/api/ai/text-assets/${scenario.assetId}/file`,
              asset: {
                id: scenario.assetId,
                title: 'Homepage PixVerse WebM Video',
                source_module: 'video',
                mime_type: 'video/webm',
                file_url: `/api/ai/text-assets/${scenario.assetId}/file`,
              },
            },
            billing: {
              credits_charged: 185,
              balance_after: 1015,
            },
          }),
        });
      });
      await page.route(`**/api/ai/text-assets/${scenario.assetId}/file`, async (route) => {
        await route.fulfill({
          status: 200,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Type': 'video/webm',
            'Content-Disposition': 'inline; filename="pixverse-preview.webm"',
            'Content-Length': '4',
          },
          body: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
        });
      });

      try {
        const response = await page.goto(scenario.path);
        expect(response.status()).toBe(200);
        const createButton = page.locator('#video-creations .video-mode__btn[data-video-mode="create"]');
        await expect(createButton).toBeVisible({ timeout: 10_000 });
        await createButton.click();
        await expect(page.locator('#videoCreate')).toBeVisible({ timeout: 10_000 });

        await page.locator('#videoPrompt').fill(scenario.prompt);
        const generationResponsePromise = page.waitForResponse((response) =>
          response.url().endsWith('/api/ai/generate-video') && response.request().method() === 'POST'
        );
        await page.locator('#videoGenerate').click();
        const generationResponse = await generationResponsePromise;
        expect(generationResponse.ok()).toBe(true);

        const generatedVideo = page.locator('#videoPreview video.video-create__player');
        await expect(generatedVideo).toBeVisible({ timeout: 10_000 });
        await expect(generatedVideo).toHaveAttribute('src', `/api/ai/text-assets/${scenario.assetId}/file`);
        await expect(generatedVideo).toHaveAttribute('data-mime-type', 'video/webm');
        await expect(page.locator('#videoPreview .video-create__playback-fallback')).toBeVisible();
        await expect(page.locator('#videoPreview .video-create__playback-fallback')).toContainText(scenario.fallbackText);
        await expect(page.locator('#videoPreview').getByRole('link', { name: scenario.openVideoText }))
          .toHaveAttribute('href', `/api/ai/text-assets/${scenario.assetId}/file`);
        await expect(page.locator('#videoPreview').getByRole('link', { name: scenario.assetsText })).toBeVisible();
        await expect(page.locator('#videoMsg')).toContainText(scenario.successText);
        await expect(page.locator('#videoMsg')).not.toContainText(/failed|fehlgeschlagen/i);
      } finally {
        await context.close();
      }
    });
  }

  test('German homepage mobile Video Create renders PixVerse V6 results in a reachable preview', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockAuthenticatedAssetsManager(page, [], { creditBalance: 1200 });
    await page.route('**/api/public/news-pulse**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], updated_at: '2026-05-09T00:00:00.000Z' }),
      });
    });
    await page.route('**/api/ai/generate-video', async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            prompt: body.prompt,
            model: { id: 'pixverse/v6', label: 'PixVerse V6', vendor: 'PixVerse' },
            duration: body.duration,
            aspect_ratio: body.aspect_ratio,
            quality: body.quality,
            generate_audio: body.generate_audio,
            mimeType: 'video/mp4',
            videoUrl: '/api/ai/text-assets/abc123de/file',
            asset: {
              id: 'abc123de',
              title: 'Homepage PixVerse Video DE',
              source_module: 'video',
              mime_type: 'video/mp4',
              file_url: '/api/ai/text-assets/abc123de/file',
            },
          },
          billing: {
            credits_charged: 185,
            balance_after: 1015,
          },
        }),
      });
    });
    await page.route('**/api/ai/text-assets/abc123de/file', async (route) => {
      await fulfillTestMp4(route);
    });

    const response = await page.goto('/de/');
    expect(response.status()).toBe(200);
    const createButton = page.locator('#video-creations .video-mode__btn[data-video-mode="create"]');
    await expect(createButton).toBeVisible({ timeout: 10_000 });
    await createButton.click();
    await expect(page.locator('#videoCreate')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#videoPreview')).toBeVisible();

    await page.locator('#videoPrompt').fill('Eine ruhige Kamerafahrt durch ein leuchtendes Studio.');
    const generationResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/api/ai/generate-video') && response.request().method() === 'POST'
    );
    await page.locator('#videoGenerate').click();
    const generationResponse = await generationResponsePromise;
    expect(generationResponse.ok()).toBe(true);

    const videoPreview = page.locator('#videoPreview');
    const generatedVideo = page.locator('#videoPreview video.video-create__player');
    await expect(generatedVideo).toBeVisible({ timeout: 10_000 });
    await expect(generatedVideo).toHaveAttribute('src', '/api/ai/text-assets/abc123de/file');
    await expect(videoPreview).toBeInViewport();
    await expect(videoPreview).toBeFocused();
    const mediaState = await waitForVideoMediaState(generatedVideo);
    expect(mediaState.error).toBeNull();
    expect(mediaState.readyState).toBeGreaterThanOrEqual(1);
    expect(mediaState.events.some((eventName) => eventName === 'loadedmetadata' || eventName === 'already-have-metadata')).toBe(true);
    await expect(page.locator('#videoMsg')).toContainText('Video generiert und gespeichert.');
  });

  test('homepage create studio recovers button state and shows errors when generate/save requests abort', async ({
    page,
  }) => {
    const requests = [];
    await mockAuthenticatedAssetsManager(page, requests);

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

    await expect(page.locator('#galStudioGenerate')).toHaveText('Generate · 1 credit');
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

  test('homepage create studio saves fresh generations by reference instead of re-uploading the full image', async ({
    page,
  }) => {
    const requests = [];
    const saveImageRequests = [];
    await mockAuthenticatedAssetsManager(page, requests, {
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

  test('legacy account manager path redirects to the Assets Manager without old branding', async ({
    page,
  }) => {
    await mockAuthenticatedAssetsManager(page, []);

    const response = await page.goto('/account/image-studio.html');
    expect(response.status()).toBe(200);
    await expect(page).toHaveURL(/\/account\/assets-manager(?:\.html)?/);
    await expect(page.locator('.legal-hero__title')).toHaveText('Assets Manager');
    await expect(page.locator('body')).not.toContainText('Image Studio');
  });

  test('account Assets Manager shows mixed saved assets inside the shared folder world', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__studioOpenCalls = [];
      window.open = (...args) => {
        window.__studioOpenCalls.push(args);
        return null;
      };
    });

    await mockAuthenticatedAssetsManager(page, [], {
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
            poster_url: '/api/ai/text-assets/snd-1/poster',
            poster_width: 320,
            poster_height: 320,
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
              poster_url: '/api/ai/text-assets/snd-1/poster',
              poster_width: 320,
              poster_height: 320,
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
              poster_status: 'pending',
              poster_retryable: true,
              poster_message: 'Poster preview is being prepared.',
            },
          ],
        },
      },
    });

    await page.goto('/account/assets-manager.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Saved Assets' })).toBeVisible();

    await page.getByRole('button', { name: 'Open All Assets, 4 assets' }).press('Enter');
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(4);
    await expect(page.locator('.studio__image-item--text')).toContainText('COMPARE');
    await expect(page.locator('.studio__image-item--text')).toContainText('AI Lab Compare Notes');
    await expect(page.locator('.studio__image-item--text')).toContainText('Model A leaned cinematic');
    await expect(page.locator('.studio__image-item--sound')).toContainText('Launch Atmosphere');
    await expect(page.locator('.studio__asset-audio')).toHaveCount(1);
    await expect(page.locator('#studioImageGrid [data-asset-id="snd-1"] .studio__asset-cover-bg')).toHaveCount(1);
    await expect(page.locator('#studioImageGrid [data-asset-id="snd-1"] .studio__asset-preview')).toHaveCount(0);
    await expect(page.locator('#studioImageGrid [data-asset-id="snd-1"]')).not.toContainText('A short ambient loop saved');
    await expect(page.locator('.studio__image-item--video')).toContainText('Launch Walkthrough');
    await expect(page.locator('#studioImageGrid .studio__asset-open')).toHaveCount(0);
    await expect(page.locator('#studioImageGrid [data-asset-id="vid-1"] .studio__asset-preview')).toHaveCount(0);
    await expect(page.locator('#studioImageGrid [data-asset-id="vid-1"] .studio__asset-video-trigger')).toHaveCount(1);
    await expect(page.locator('#studioImageGrid [data-asset-id="vid-1"]')).toContainText('Poster preview pending');
    await expect(page.locator('#studioImageGrid [data-asset-id="vid-1"]')).toContainText('Poster preview is being prepared.');

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
    await expect(page.locator('#studioImageModal .studio-modal__metadata')).toContainText('Video asset');
    await expect(page.locator('#studioImageModal .studio-modal__metadata')).toContainText('Launches');
    await expect(page.locator('#studioImageModal .studio-modal__metadata')).toContainText('launch-walkthrough.mp4');
    await page.locator('#studioImageModal .modal-close').click();
  });

  test('account Assets Manager exposes load more for saved assets and appends the next page', async ({
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

    await mockAuthenticatedAssetsManager(page, [], {
      assetsPayload: {
        all: manyAssets,
      },
    });

    await page.goto('/account/assets-manager.html');
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

  test('mobile account Assets Manager opens saved assets in the shared media grid with grouped dots', async ({
    page,
  }) => {
    const manyAssets = Array.from({ length: 14 }, (_, index) => ({
      id: `mobile-asset-${index + 1}`,
      asset_type: 'image',
      folder_id: null,
      title: `Mobile Asset ${index + 1}`,
      prompt: `Mobile Asset ${index + 1}`,
      preview_text: `Mobile Asset ${index + 1}`,
      model: '@cf/black-forest-labs/flux-1-schnell',
      steps: 4,
      seed: index + 1,
      created_at: new Date(Date.UTC(2026, 3, 30, 12, index, 0)).toISOString(),
      file_url: `/api/ai/images/mobile-asset-${index + 1}/file`,
      original_url: `/api/ai/images/mobile-asset-${index + 1}/file`,
      thumb_url: `/api/ai/images/mobile-asset-${index + 1}/thumb`,
      medium_url: `/api/ai/images/mobile-asset-${index + 1}/medium`,
    }));

    await page.setViewportSize({ width: 390, height: 844 });
    await mockAuthenticatedAssetsManager(page, [], {
      assetsPayload: {
        all: manyAssets,
      },
    });

    await page.goto('/account/assets-manager.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });
    await page.locator('#studioFolderGrid .studio__folder-card').first().click();

    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(14);
    await expect(page.locator('.studio__mobile-grid-trigger')).toBeVisible();
    await expect(page.locator('.studio__mobile-grid-trigger')).toHaveText('All 14 saved assets are displayed.');
    await page.locator('#studioMobileActionsToggle').click();
    await expect(page.locator('#studioMobileActionsMenu')).toContainText('Folder and selection tools stay here on phones.');
    await expect(page.locator('#studioMobileActionsMenu').getByRole('button', { name: 'Create folder' })).toBeVisible();
    await expect(page.locator('#studioMobileActionsMenu').getByRole('button', { name: 'Delete folder' })).toBeVisible();
    await expect(page.locator('#studioMobileActionsMenu').getByRole('button', { name: 'Select assets' })).toBeVisible();
    await page.locator('#studioMobileActionsMenu').getByRole('button', { name: 'Select assets' }).click();
    await expect(page.locator('#studioSelectionGuide')).toBeVisible();
    await expect(page.locator('#studioSelectionGuide')).toContainText('On phones, selected count and bulk actions stay directly below this guide.');
    await expect(page.locator('#studioBulkBar')).toBeVisible();
    await expect(page.locator('#studioBulkCount')).toHaveText('0 selected');
    const firstCard = page.locator('#studioImageGrid .studio__image-item').first();
    await firstCard.focus();
    await expect(firstCard).toBeFocused();
    await page.keyboard.press('Space');
    await expect(firstCard).toHaveAttribute('aria-pressed', 'true');
    await expect(firstCard).toHaveAttribute('aria-label', /Select Mobile Asset \d+/);
    await expect(page.locator('#studioBulkCount')).toHaveText('1 selected');
    await expect(page.locator('#studioSelectionGuideStatus')).toContainText('1 selected');
    const mobileBulkLayout = await page.locator('#studioBulkBar .studio__bulk-btn:visible').evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        height: rect.height,
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth,
      };
    }));
    expect(mobileBulkLayout).toHaveLength(4);
    expect(mobileBulkLayout.every((rect) => rect.height >= 42 && rect.left >= 0 && rect.right <= rect.viewportWidth + 1)).toBe(true);
    await page.locator('#studioBulkMove').click();
    await expect(page.locator('#studioBulkMoveForm')).toBeVisible();
    await expect(page.locator('#studioBulkMoveSummary')).toContainText('Move 1 selected to assets without a folder');
    await page.locator('#studioBulkMoveConfirm').click();
    await expect(page.locator('#studioActionResult')).toContainText('Move confirmed');
    await expect(page.locator('#studioActionResult').getByRole('button', { name: 'Open assets without folder' })).toBeVisible();
    await expect(page.locator('#studioActionResult').getByRole('button', { name: 'Show all assets' })).toBeVisible();
    const resultActionLayout = await page.locator('#studioActionResultActions .studio__action-result-action:visible').evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        height: rect.height,
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth,
      };
    }));
    expect(resultActionLayout.length).toBeGreaterThanOrEqual(2);
    expect(resultActionLayout.every((rect) => rect.height >= 42 && rect.left >= 0 && rect.right <= rect.viewportWidth + 1)).toBe(true);
    await expect(page.locator('#studioImageGrid .studio__image-item').first().getByRole('button', { name: /Preview Mobile Asset \d+/ })).toBeVisible();
    await expect(page.locator('#studioImageGrid .studio__image-item').first().getByRole('button', { name: 'Publish' })).toBeVisible();
    await expect(page.locator('#studioImageGrid .studio__image-item').first().getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect
      .poll(() => page.locator('#studioImageGrid .studio__image-overlay').first().evaluate((node) => getComputedStyle(node).opacity))
      .toBe('1');

    const visibleDots = page.locator('.studio-deck-dots:visible .studio-deck-dot');
    await expect(visibleDots).toHaveCount(5);
    await expect.poll(() => visibleDots.count()).toBeLessThan(manyAssets.length);

    await page.locator('.studio__mobile-grid-trigger').click();
    await expect(page.locator('.mobile-media-grid-overlay--assets')).toBeVisible();
    await expect(page.locator('.mobile-media-grid-overlay__item')).toHaveCount(14);

    await page.locator('.mobile-media-grid-overlay__item').first().click();
    await expect(page.locator('.mobile-media-grid-overlay')).toHaveCount(0);
    await expect(page.locator('#studioImageModal')).toHaveClass(/active/);
    await expect(page.locator('#studioImageModal .studio-modal__title')).toContainText('Mobile Asset');
    await expect(page.locator('#studioImageModal .studio-modal__text-open')).toHaveText('Open original');
    await expect(page.locator('#studioImageModal .studio-modal__text-close')).toHaveText('Close preview');
    const modalActionLayout = await page.locator('#studioImageModal .studio-modal__footer-actions > *:visible').evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        height: rect.height,
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth,
      };
    }));
    expect(modalActionLayout).toHaveLength(2);
    expect(modalActionLayout.every((rect) => rect.height >= 42 && rect.left >= 0 && rect.right <= rect.viewportWidth + 1)).toBe(true);
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(mobileOverflow).toBeLessThanOrEqual(1);
  });

  test('German mobile account Assets Manager localizes the saved-assets grid trigger', async ({
    page,
  }) => {
    const assets = Array.from({ length: 3 }, (_, index) => ({
      id: `de-mobile-asset-${index + 1}`,
      asset_type: 'image',
      folder_id: null,
      title: `Mobiles Asset ${index + 1}`,
      prompt: `Mobiles Asset ${index + 1}`,
      preview_text: `Mobiles Asset ${index + 1}`,
      model: '@cf/black-forest-labs/flux-1-schnell',
      steps: 4,
      seed: index + 1,
      created_at: new Date(Date.UTC(2026, 3, 30, 12, index, 0)).toISOString(),
      file_url: `/api/ai/images/de-mobile-asset-${index + 1}/file`,
      original_url: `/api/ai/images/de-mobile-asset-${index + 1}/file`,
      thumb_url: `/api/ai/images/de-mobile-asset-${index + 1}/thumb`,
      medium_url: `/api/ai/images/de-mobile-asset-${index + 1}/medium`,
    }));

    await page.setViewportSize({ width: 390, height: 844 });
    await mockAuthenticatedAssetsManager(page, [], {
      assetsPayload: {
        all: assets,
      },
    });

    await page.goto('/de/account/assets-manager.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });
    await page.locator('#studioFolderGrid .studio__folder-card').first().click();

    await expect(page.locator('.studio__mobile-grid-trigger')).toBeVisible();
    await expect(page.locator('.studio__mobile-grid-trigger')).toHaveText('Alle 3 gespeicherten Assets werden angezeigt.');
    await page.locator('#studioMobileActionsToggle').click();
    await expect(page.locator('#studioMobileActionsMenu')).toContainText('Ordner- und Auswahlwerkzeuge bleiben auf Smartphones hier.');
    await expect(page.locator('#studioMobileActionsMenu').getByRole('button', { name: 'Ordner erstellen' })).toBeVisible();
    await page.locator('#studioMobileActionsMenu').getByRole('button', { name: 'Assets auswählen' }).click();
    await expect(page.locator('#studioSelectionGuide')).toBeVisible();
    await expect(page.locator('#studioSelectionGuide')).toContainText('Auf Smartphones bleiben ausgewählte Anzahl und Bulk-Aktionen direkt unter dieser Hilfe sichtbar.');
    await page.locator('#studioBulkCancel').click();
    await page.locator('.studio__mobile-grid-trigger').click();
    await expect(page.locator('.mobile-media-grid-overlay--assets')).toBeVisible();
    await expect(page.locator('.mobile-media-grid-overlay__close')).toHaveText('Schließen');
    await page.locator('.mobile-media-grid-overlay__item').first().click();
    await expect(page.locator('#studioImageModal')).toHaveClass(/active/);
    await expect(page.locator('#studioImageModal .studio-modal__title')).toContainText('Mobiles Asset 3');
    await expect(page.locator('#studioImageModal .studio-modal__eyebrow')).toHaveText('Asset-Details');
    await expect(page.locator('#studioImageModal .studio-modal__metadata')).toContainText('Typ');
    await expect(page.locator('#studioImageModal .studio-modal__metadata')).toContainText('Bild');
    await expect(page.locator('#studioImageModal .studio-modal__metadata')).toContainText('Kein Ordner');
    await expect(page.locator('#studioImageModal .studio-modal__metadata')).toContainText('Alle gespeicherten Assets');
    await expect(page.locator('#studioImageModal .studio-modal__status')).toContainText('Private URLs, interne IDs und Provider-Payloads bleiben ausgeblendet');
    await expect(page.locator('#studioImageModal .studio-modal__text-open')).toHaveText('Original öffnen');
    await expect(page.locator('#studioImageModal .studio-modal__text-close')).toHaveText('Vorschau schließen');
  });

  test('account Assets Manager keeps saved-assets type badges compact on desktop and mobile', async ({
    page,
  }) => {
    await mockAuthenticatedAssetsManager(page, [], {
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

    await page.goto('/account/assets-manager.html');
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

  test('account Assets Manager keeps mobile file cards solid and limits sound playback animation to the active card', async ({
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
    await mockAuthenticatedAssetsManager(page, [], {
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

    await page.goto('/account/assets-manager.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#studioFolderGrid .studio__folder-card').first().click();
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(4);
    await expect(page.locator('#studioImageGrid .studio__asset-open')).toHaveCount(0);
    await expect(page.locator('#studioImageGrid [data-asset-id="txt-mobile-1"]').getByRole('button', { name: 'Open file Launch Notes' })).toBeVisible();

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
    await expect(page.locator('#studioImageGrid [data-asset-id="snd-mobile-1"] .studio__asset-preview')).toHaveCount(0);
    await expect(page.locator('#studioImageGrid [data-asset-id="snd-mobile-1"]')).not.toContainText('A slow gold-tinted synth loop');

    const soundCardStructure = await page.locator('#studioImageGrid [data-asset-id="snd-mobile-1"]').evaluate((card) => {
      const indicator = card.querySelector('.studio__asset-play-indicator');
      return {
        indicatorNextClass: indicator?.nextElementSibling?.className || '',
      };
    });
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

  test('account Assets Manager lets the owner publish and unpublish a saved image into Mempics', async ({
    page,
  }) => {
    await mockAuthenticatedAssetsManager(page, [], {
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

    await page.goto('/account/assets-manager.html');
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

  test('Saved Assets lets the owner publish and unpublish a saved music track into Memtracks', async ({
    page,
  }) => {
    await mockAuthenticatedAssetsManager(page, [], {
      folderPayload: {
        folders: [],
        counts: {},
        unfolderedCount: 1,
      },
      assetsPayload: {
        all: [
          {
            id: 'snd-publish-1',
            asset_type: 'sound',
            folder_id: null,
            title: 'Member beat',
            file_name: 'member-beat.mp3',
            source_module: 'music',
            mime_type: 'audio/mpeg',
            size_bytes: 320000,
            preview_text: 'This prompt text should not be rendered between title and player.',
            created_at: '2026-04-10T12:00:00.000Z',
            visibility: 'private',
            is_public: false,
            published_at: null,
            file_url: '/api/ai/text-assets/snd-publish-1/file',
            poster_url: '/api/ai/text-assets/snd-publish-1/poster',
            poster_width: 320,
            poster_height: 320,
          },
        ],
      },
    });

    await page.goto('/account/assets-manager.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#studioFolderGrid .studio__folder-card').first().click();
    const card = page.locator('#studioImageGrid [data-asset-id="snd-publish-1"]');
    await expect(card.locator('.studio__asset-cover-bg')).toHaveCount(1);
    await expect(card.locator('.studio__asset-preview')).toHaveCount(0);
    await expect(card.locator('.studio__asset-meta')).toHaveCount(0);
    await expect(card).not.toContainText('This prompt text should not be rendered');
    await expect(card).not.toContainText('member-beat.mp3');
    await expect(card).not.toContainText('320000');
    await expect(card).not.toContainText('10.04.2026');
    await expect(card.locator('.studio__asset-audio')).toBeVisible();
    await expect(card.locator('.studio__asset-badge--sound')).toHaveText('SOUND');
    await expect(card.locator('.studio__asset-badge--sound')).toHaveCSS('position', 'absolute');
    await expect(card.locator('.studio__image-visibility')).toHaveText('Private');
    await expect(card.locator('.studio__image-visibility')).toHaveCSS('position', 'absolute');
    const soundBadgeBox = await card.locator('.studio__asset-badge--sound').boundingBox();
    const visibilityBox = await card.locator('.studio__image-visibility').boundingBox();
    const cardBox = await card.boundingBox();
    expect(soundBadgeBox?.x).toBeLessThan(visibilityBox?.x || 0);
    expect(visibilityBox?.width || 0).toBeLessThan((cardBox?.width || 0) / 2);

    await card.getByRole('button', { name: 'Publish' }).click();
    await expect(card.locator('.studio__image-visibility')).toHaveText('Public');
    await expect(card.locator('.studio__image-visibility')).toHaveCSS('position', 'absolute');
    await expect
      .poll(async () => {
        const box = await card.locator('.studio__image-visibility').boundingBox();
        return Math.round(box?.width || 0);
      })
      .toBeLessThan(100);
    await expect(card.locator('.studio__image-publish')).toHaveText('Unpublish');
    await expect(page.locator('#studioGalleryMsg')).toContainText('Track published to Memtracks.');

    await card.getByRole('button', { name: 'Unpublish' }).click();
    await expect(card.locator('.studio__image-visibility')).toHaveText('Private');
    await expect(card.locator('.studio__image-publish')).toHaveText('Publish');
    await expect(page.locator('#studioGalleryMsg')).toContainText('Track removed from Memtracks.');
  });

  test('account Assets Manager moves and deletes mixed saved assets with one shared selection flow', async ({
    page,
  }) => {
    await mockAuthenticatedAssetsManager(page, [], {
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

    await page.goto('/account/assets-manager.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#studioFolderGrid .studio__folder-card').first().click();
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(3);

    await page.locator('#studioSelectBtn').click();
    await expect(page.locator('#studioSelectionGuide')).toBeVisible();
    await expect(page.locator('#studioSelectionGuide')).toContainText('Selection mode active');
    await expect(page.locator('#studioSelectionGuideStatus')).toContainText('0 selected');
    await page.locator('#studioImageGrid .studio__image-item').nth(0).click();
    await page.locator('#studioImageGrid .studio__image-item').nth(1).click();
    await page.locator('#studioImageGrid .studio__image-item').nth(2).click();
    await expect(page.locator('#studioBulkCount')).toHaveText('3 selected');
    await expect(page.locator('#studioSelectionGuideStatus')).toContainText('3 selected');

    await page.locator('#studioBulkMove').click();
    await expect(page.locator('#studioBulkMoveForm')).toContainText('Move selected assets');
    await expect(page.locator('#studioBulkMoveForm')).toContainText('selected assets stay selected');
    await expect(page.locator('#studioBulkMoveSummary')).toContainText('Move 3 selected to "Assets without folder"');
    await page.selectOption('#studioBulkMoveSelect', 'folder-research');
    await expect(page.locator('#studioBulkMoveSummary')).toContainText('Move 3 selected to "Research"');
    await expect(page.locator('#studioBulkMoveSummary')).toContainText('backend saves the move');
    await page.locator('#studioBulkMoveConfirm').click();
    await expect(page.locator('#studioGalleryMsg')).toContainText('3 assets moved.');
    await expect(page.locator('#studioActionResult')).toBeVisible();
    await expect(page.locator('#studioActionResult')).toContainText('Move confirmed');
    await expect(page.locator('#studioActionResult')).toContainText('Changed your mind? Move assets back from the target folder');
    await expect(page.locator('#studioActionResult').getByRole('button', { name: 'Open Research' })).toBeVisible();
    await expect(page.locator('#studioActionResult').getByRole('button', { name: 'Show all assets' })).toBeVisible();
    await expect(page.locator('#studioSelectionGuide')).toBeHidden();

    await page.locator('#studioFolderBackBtn').click();
    await page.locator('#studioFolderGrid .studio__folder-card').nth(3).click();
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(3);

    await page.locator('#studioSelectBtn').click();
    await page.locator('.studio__image-item--text').click();
    await page.locator('.studio__image-item--sound').click();
    await expect(page.locator('#studioBulkCount')).toHaveText('2 selected');
    await expect(page.locator('#studioSelectionGuideStatus')).toContainText('2 selected');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#studioBulkDelete').click();
    await expect(page.locator('#studioGalleryMsg')).toContainText('2 assets deleted.');
    await expect(page.locator('#studioActionResult')).toContainText('Delete confirmed');
    await expect(page.locator('#studioActionResult')).toContainText('Deleted items cannot be restored from this workspace');
    await expect(page.locator('#studioActionResult')).not.toContainText('Undo');
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(1);
    await expect(page.locator('#studioImageGrid')).toContainText('Shared Poster');
  });

  test('account Assets Manager gives precise feedback for hero-linked video delete blocks', async ({
    page,
  }) => {
    await mockAuthenticatedAssetsManager(page, [], {
      folderPayload: {
        folders: [],
        counts: {},
        unfolderedCount: 1,
      },
      assetsPayload: {
        all: [{
          id: 'hero-used-video',
          asset_type: 'video',
          folder_id: null,
          title: 'Assigned Hero Source',
          file_name: 'assigned-hero-source.mp4',
          source_module: 'video',
          mime_type: 'video/mp4',
          size_bytes: 4096000,
          created_at: '2026-04-10T12:00:00.000Z',
          file_url: '/api/ai/text-assets/hero-used-video/file',
          poster_status: 'pending',
          poster_retryable: true,
          poster_message: 'Poster preview is being prepared.',
        }],
        unfoldered: [{
          id: 'hero-used-video',
          asset_type: 'video',
          folder_id: null,
          title: 'Assigned Hero Source',
          file_name: 'assigned-hero-source.mp4',
          source_module: 'video',
          mime_type: 'video/mp4',
          size_bytes: 4096000,
          created_at: '2026-04-10T12:00:00.000Z',
          file_url: '/api/ai/text-assets/hero-used-video/file',
          poster_status: 'pending',
          poster_retryable: true,
          poster_message: 'Poster preview is being prepared.',
        }],
        folders: {},
      },
      deleteTextAssetHandler: async (route) => {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            code: 'hero_source_in_use',
            error: 'This video is currently assigned to a Homepage Hero slot. Remove or replace it in Homepage Hero Videos before deleting.',
          }),
        });
      },
    });

    await page.goto('/account/assets-manager.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Open All Assets, 1 asset' }).click();
    await expect(page.locator('#studioImageGrid [data-asset-id="hero-used-video"]')).toContainText('Poster preview pending');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#studioImageGrid [data-asset-id="hero-used-video"] .studio__image-delete--inline').click();
    await expect(page.locator('#studioActionResult')).toContainText('Homepage Hero video is in use');
    await expect(page.locator('#studioActionResult')).toContainText('Remove or replace it in Homepage Hero Videos before deleting.');
    await expect(page.locator('#studioImageGrid [data-asset-id="hero-used-video"]')).toHaveCount(1);
  });

  test('account Assets Manager keeps selection and recovery guidance when bulk move fails', async ({
    page,
  }) => {
    await mockAuthenticatedAssetsManager(page, [], {
      folderPayload: {
        folders: [
          { id: 'folder-source', name: 'Source', slug: 'source', created_at: '2026-04-10T09:00:00.000Z' },
          { id: 'folder-target', name: 'Target', slug: 'target', created_at: '2026-04-09T09:00:00.000Z' },
        ],
      },
      assetsPayload: {
        all: [
          {
            id: 'img-recover-1',
            asset_type: 'image',
            folder_id: null,
            title: 'Recoverable Poster',
            preview_text: 'Recoverable Poster',
            model: '@cf/black-forest-labs/flux-1-schnell',
            steps: 4,
            seed: 17,
            created_at: '2026-04-10T12:00:00.000Z',
            file_url: '/api/ai/images/img-recover-1/file',
            original_url: '/api/ai/images/img-recover-1/file',
          },
        ],
      },
    });
    await page.route('**/api/ai/assets/bulk-move', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'raw backend failure should stay hidden' }),
      });
    });

    await page.goto('/account/assets-manager.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#studioFolderGrid .studio__folder-card').first().click();
    await page.locator('#studioSelectBtn').click();
    await page.locator('#studioImageGrid [data-asset-id="img-recover-1"]').click();
    await expect(page.locator('#studioBulkCount')).toHaveText('1 selected');

    await page.locator('#studioBulkMove').click();
    await page.selectOption('#studioBulkMoveSelect', 'folder-target');
    await page.locator('#studioBulkMoveConfirm').click();

    await expect(page.locator('#studioGalleryMsg')).toContainText('Move could not be saved');
    await expect(page.locator('#studioGalleryMsg')).not.toContainText('raw backend failure');
    await expect(page.locator('#studioActionResult')).toContainText('Move not saved');
    await expect(page.locator('#studioActionResult')).toContainText('The selection stayed active');
    await expect(page.locator('#studioActionResult')).not.toContainText('raw backend failure');
    await expect(page.locator('#studioActionResult').getByRole('button', { name: 'Continue selection' })).toBeVisible();
    await expect(page.locator('#studioBulkCount')).toHaveText('1 selected');
    await expect(page.locator('#studioBulkMoveForm')).toBeVisible();
    await expect(page.locator('#studioSelectionGuideStatus')).toContainText('1 selected');
  });

  test('account Assets Manager gates rename to exactly one selection and renames folders plus saved assets safely', async ({
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
    await mockAuthenticatedAssetsManager(page, [], {
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

    await page.goto('/account/assets-manager.html');
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
    await expect(page.locator('#studioActionResult')).toContainText('Rename confirmed');
    await expect(page.locator('#studioActionResult')).toContainText('Rename it again');
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
    await expect(page.locator('#studioActionResult')).toContainText('Rename confirmed');
    await expect(page.locator('#studioActionResult')).toContainText('no instant undo');
    await expect(page.locator('#studioImageGrid [data-asset-id="txt-rename-1"]')).toContainText('Release Notes');
    await expect(page.locator('#studioImageGrid [data-asset-id="txt-rename-1"] .studio__asset-meta')).toContainText('release-notes.txt');

    await page.locator('#studioImageGrid [data-asset-id="img-rename-1"]').click();
    await expect(page.locator('#studioBulkCount')).toHaveText('2 selected');
    await expect(page.locator('#studioBulkRename')).toBeDisabled();
  });

  test('account Assets Manager grid requests thumbs only and uses medium/original for detail fallback', async ({
    page,
  }) => {
    const imageRequests = [];
    await mockAuthenticatedAssetsManager(page, [], {
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

    await page.goto('/account/assets-manager.html');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#studioFolderGrid .studio__folder-card').nth(1).click();
    await expect(page.locator('#studioImageGrid .studio__image-item')).toHaveCount(2);
    await expect(page.locator('#studioImageGrid .studio__image-item img')).toHaveCount(1);
    await expect(page.locator('.studio__image-preview-badge')).toContainText('Preview pending');
    await expect(page.locator('#studioImageGrid .studio__image-item img').first()).toHaveAttribute('src', /\/api\/ai\/images\/img-ready\/thumb$/);

    const readyCard = page.locator('#studioImageGrid .studio__image-item').first();
    await expect(readyCard).toHaveAttribute('role', 'button');
    await expect(readyCard).toHaveAttribute('aria-label', 'Preview Ready Preview');
    await readyCard.focus();
    await expect(readyCard).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#studioImageModal')).toHaveClass(/active/);
    await expect(page.locator('#studioImageModal .studio-modal__image img')).toHaveAttribute('src', /\/api\/ai\/images\/img-ready\/medium$/);
    await expect(page.locator('#studioImageModal .studio-modal__open')).toHaveAttribute('href', '/api/ai/images/img-ready/file');
    await expect(page.locator('#studioImageModal .studio-modal__eyebrow')).toHaveText('Asset details');
    const modalMetadata = page.locator('#studioImageModal .studio-modal__metadata');
    await expect(modalMetadata).toContainText('Type');
    await expect(modalMetadata).toContainText('Image');
    await expect(modalMetadata).toContainText('Folder');
    await expect(modalMetadata).toContainText('No folder');
    await expect(modalMetadata).toContainText('Current view');
    await expect(modalMetadata).toContainText('Assets without folder');
    await expect(modalMetadata).toContainText('Visibility');
    await expect(modalMetadata).toContainText('Private');
    await expect(modalMetadata).toContainText('Created');
    await expect(modalMetadata).toContainText('10.04.2026');
    await expect(page.locator('#studioImageModal .studio-modal__status')).toContainText('Private URLs, internal IDs, and provider payloads are hidden');
    await expect(page.locator('#studioImageModal .studio-modal__text-open')).toHaveText('Open original');
    await expect(page.locator('#studioImageModal .studio-modal__text-close')).toHaveText('Close preview');
    await expect(page.locator('#studioImageModal .modal-body')).not.toContainText('img-ready');
    await expect(page.locator('#studioImageModal .modal-body')).not.toContainText('/api/ai');
    await page.locator('#studioImageModal .modal-close').click();
    await expect(readyCard).toBeFocused();

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
    await expect(page.locator('#profileAvatarCard #avatarRemoveBtn')).toHaveCount(0);
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
    const readAvatarMessageLayout = async () => page.locator('#profileAvatarCard').evaluate((card) => {
      const rectOf = (selector) => card.querySelector(selector)?.getBoundingClientRect();
      const overlaps = (first, second) => Boolean(
        first
        && second
        && first.left < second.right - 1
        && first.right > second.left + 1
        && first.top < second.bottom - 1
        && first.bottom > second.top + 1
      );
      const cardRect = card.getBoundingClientRect();
      const frame = rectOf('#avatarFrame');
      const actions = rectOf('.profile__avatar-actions');
      const hint = rectOf('.profile__hint');
      const message = rectOf('#avatarMsg');
      const messageNode = card.querySelector('#avatarMsg');
      const messageStyle = messageNode ? getComputedStyle(messageNode) : null;
      return {
        visible: Boolean(
          message
          && message.width > 40
          && message.height > 20
          && messageStyle
          && messageStyle.display !== 'none'
          && messageStyle.visibility !== 'hidden'
        ),
        insideCard: Boolean(
          message
          && message.left >= cardRect.left - 1
          && message.right <= cardRect.right + 1
          && message.top >= cardRect.top - 1
          && message.bottom <= cardRect.bottom + 1
        ),
        inMessageArea: messageStyle?.gridArea === 'message',
        rightOfAvatar: Boolean(message && frame && message.left > frame.right),
        noOverlap: Boolean(
          message
          && !overlaps(message, frame)
          && !overlaps(message, actions)
          && !overlaps(message, hint)
        ),
      };
    });

    const response = await page.goto('/account/profile.html');
    expect(response?.ok()).toBeTruthy();

    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#profileAvatarCard #avatarRemoveBtn')).toHaveCount(0);
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
    expect(await readAvatarMessageLayout()).toEqual({
      visible: true,
      insideCard: true,
      inMessageArea: true,
      rightOfAvatar: true,
      noOverlap: true,
    });
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

    await page.locator('#avatarChangeBtn').click();
    await expect(page.locator('#avatarSourceModal')).toHaveClass(/active/);
    const visibleMenuItems = page.locator('#avatarSourceModal .profile-avatar-modal__options > button:visible');
    await expect(visibleMenuItems).toHaveCount(4);
    await expect(visibleMenuItems.nth(0)).toContainText('Saved Assets');
    await expect(visibleMenuItems.nth(1)).toContainText('Upload from Device');
    await expect(visibleMenuItems.nth(2)).toContainText('Generate one');
    await expect(visibleMenuItems.nth(3)).toContainText('Remove');
    await page.locator('#avatarRemoveBtn').click();
    await expect(page.locator('#avatarSourceModal')).toBeHidden();
    await expect(page.locator('#avatarMsg')).toContainText('Photo removed.');
    expect(await readAvatarMessageLayout()).toEqual({
      visible: true,
      insideCard: true,
      inMessageArea: true,
      rightOfAvatar: true,
      noOverlap: true,
    });
    expect(avatarRequests).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'delete' })]));
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

  test('change photo chooser surfaces the Generate option without growing', async ({ page }) => {
    await mockAuthenticatedProfile(page, { role: 'user' });

    const response = await page.goto('/account/profile.html');
    expect(response?.ok()).toBeTruthy();

    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#avatarChangeBtn').click();
    await expect(page.locator('#avatarSourceModal')).toHaveClass(/active/);

    const optionCount = await page
      .locator('#avatarSourceModal .profile-avatar-modal__option:visible')
      .count();
    expect(optionCount).toBe(3);
    await expect(page.locator('#avatarChooseSavedAssets')).toBeVisible();
    await expect(page.locator('#avatarChooseUploadDevice')).toBeVisible();
    await expect(page.locator('#avatarChooseGenerate')).toBeVisible();
    await expect(page.locator('#profileAvatarCard #avatarRemoveBtn')).toHaveCount(0);
    await expect(page.locator('#avatarRemoveBtn')).toBeHidden();

    const cardWidth = await page
      .locator('#avatarSourceModal .modal-card')
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(cardWidth).toBeLessThanOrEqual(640);
  });

  test('clicking Generate one opens the compact AI overlay with no model/steps/size pickers', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, { role: 'user' });

    await page.route('**/api/ai/quota', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            isAdmin: false,
            creditBalance: 10,
            dailyCreditAllowance: 10,
          },
        }),
      });
    });

    const response = await page.goto('/account/profile.html');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#avatarChangeBtn').click();
    await expect(page.locator('#avatarSourceModal')).toHaveClass(/active/);

    await page.locator('#avatarChooseGenerate').click();

    await expect(page.locator('#avatarSourceModal')).toBeHidden();
    await expect(page.locator('#avatarGenerateModal')).toHaveClass(/active/);
    await expect(page.locator('#avatarGeneratePrompt')).toBeVisible();
    await expect(page.locator('#avatarGenerateBtn')).toBeVisible();
    await expect(page.locator('#avatarGenerateUseBtn')).toBeDisabled();

    await expect(page.locator('#avatarGenerateModal select')).toHaveCount(0);
    await expect(page.locator('#avatarGenerateModal input[type="number"]')).toHaveCount(0);
    await expect(page.locator('#avatarGenerateModal input[type="range"]')).toHaveCount(0);
    await expect(page.locator('#avatarGenerateModal [data-model-picker]')).toHaveCount(0);
    const overlayText = (await page.locator('#avatarGenerateModal').innerText()).toLowerCase();
    expect(overlayText).not.toContain('model');
    expect(overlayText).not.toContain('steps');
    expect(overlayText).not.toContain('seed');
    expect(overlayText).not.toContain('1024');
    expect(overlayText).not.toContain('resolution');

    await expect(page.locator('#avatarGenerateQuota')).toContainText('10 credits available');
  });

  test('avatar generate upload file metadata follows the actual blob MIME type', async ({
    page,
  }) => {
    await page.goto('/');

    const cases = await page.evaluate(async () => {
      const {
        createAvatarUploadFile,
      } = await import('/js/pages/profile/avatar-generate.js?v=__ASSET_VERSION__');

      return [
        new Blob(['png'], { type: 'image/png' }),
        new Blob(['webp'], { type: 'image/webp' }),
        new Blob(['unknown'], { type: '' }),
        new Blob(['octets'], { type: 'application/octet-stream' }),
      ].map((blob) => {
        const file = createAvatarUploadFile(blob);
        return {
          inputType: blob.type,
          name: file.name,
          type: file.type,
        };
      });
    });

    expect(cases).toEqual([
      { inputType: 'image/png', name: 'avatar.png', type: 'image/png' },
      { inputType: 'image/webp', name: 'avatar.webp', type: 'image/webp' },
      { inputType: '', name: 'avatar.png', type: 'image/png' },
      { inputType: 'application/octet-stream', name: 'avatar.png', type: 'image/png' },
    ]);
  });

  test('avatar generate keeps desktop encoding and uses thumb-sized mobile encoding', async ({
    page,
  }) => {
    await page.goto('/');

    const profiles = await page.evaluate(async () => {
      const {
        getAvatarUploadEncodingProfile,
      } = await import('/js/pages/profile/avatar-generate.js?v=__ASSET_VERSION__');

      return {
        desktop: getAvatarUploadEncodingProfile({ mobile: false }),
        mobile: getAvatarUploadEncodingProfile({ mobile: true }),
      };
    });

    expect(profiles).toEqual({
      desktop: { size: 512, quality: 0.9, variant: 'desktop' },
      mobile: { size: 320, quality: 0.82, variant: 'mobile-thumb' },
    });
  });

  test('avatar generate sends FLUX.1 Schnell with 4 steps and shows member credits', async ({
    page,
  }) => {
    const avatarRequests = [];
    await mockAuthenticatedProfile(page, {
      role: 'user',
      avatarRequests,
    });

    let creditBalance = 10;
    await page.route('**/api/ai/quota', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            isAdmin: false,
            creditBalance,
            dailyCreditAllowance: 10,
          },
        }),
      });
    });

    const generateRequests = [];
    await page.route('**/api/ai/generate-image', async (route) => {
      const body = route.request().postDataJSON();
      generateRequests.push(body);
      creditBalance = Math.max(0, creditBalance - 1);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            imageBase64: ONE_PX_PNG_BASE64,
            mimeType: 'image/png',
            prompt: body.prompt,
            model: body.model,
            steps: body.steps,
            seed: body.seed,
          },
          billing: {
            credits_charged: 1,
            balance_after: creditBalance,
          },
        }),
      });
    });

    const response = await page.goto('/account/profile.html');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#avatarChangeBtn').click();
    await page.locator('#avatarChooseGenerate').click();
    await expect(page.locator('#avatarGenerateModal')).toHaveClass(/active/);

    await page.locator('#avatarGeneratePrompt').fill('A friendly explorer with cyan glow');
    await page.locator('#avatarGenerateBtn').click();

    await expect(page.locator('#avatarGenerateUseBtn')).toBeEnabled();
    await expect(page.locator('#avatarGeneratePreview img')).toBeVisible();

    expect(generateRequests).toHaveLength(1);
    expect(generateRequests[0]).toMatchObject({
      prompt: 'A friendly explorer with cyan glow',
      model: '@cf/black-forest-labs/flux-1-schnell',
      steps: 4,
    });
    expect(typeof generateRequests[0].seed).toBe('number');

    await expect(page.locator('#avatarGenerateQuota')).toContainText('9 credits available');

    await page.locator('#avatarGenerateUseBtn').click();

    await expect(page.locator('#avatarGenerateModal')).toBeHidden();
    await expect(page.locator('#avatarMsg')).toContainText('Photo updated.');
    await expect(page.locator('#avatarImg')).toBeVisible();
    await expect(page.locator('.auth-nav__avatar-link')).toBeVisible();

    expect(generateRequests).toHaveLength(1);
    expect(avatarRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'upload',
          contentType: expect.stringContaining('multipart/form-data'),
        }),
      ])
    );
    expect(avatarRequests).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'saved_asset' }),
      ])
    );
  });

  test('generated avatar Use labels Safari WebP canvas fallback as PNG', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const originalToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function patchedToBlob(callback, type, quality) {
        const requestedType = type === 'image/webp' ? 'image/png' : type;
        return originalToBlob.call(this, callback, requestedType, quality);
      };
    });

    const avatarRequests = [];
    await mockAuthenticatedProfile(page, {
      role: 'user',
      avatarRequests,
    });

    await page.route('**/api/ai/quota', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            isAdmin: false,
            creditBalance: 10,
            dailyCreditAllowance: 10,
          },
        }),
      });
    });

    await page.route('**/api/ai/generate-image', async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            imageBase64: ONE_PX_PNG_BASE64,
            mimeType: 'image/png',
            prompt: body.prompt,
            model: body.model,
            steps: body.steps,
            seed: body.seed,
          },
          billing: {
            credits_charged: 1,
            balance_after: 9,
          },
        }),
      });
    });

    const response = await page.goto('/account/profile.html');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#avatarChangeBtn').click();
    await page.locator('#avatarChooseGenerate').click();
    await expect(page.locator('#avatarGenerateModal')).toHaveClass(/active/);

    await page.locator('#avatarGeneratePrompt').fill('A mobile Safari portrait');
    await page.locator('#avatarGenerateBtn').click();

    await expect(page.locator('#avatarGenerateUseBtn')).toBeEnabled();
    await page.locator('#avatarGenerateUseBtn').click();

    await expect(page.locator('#avatarGenerateModal')).toBeHidden();
    await expect(page.locator('#avatarMsg')).toContainText('Photo updated.');
    expect(avatarRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'upload',
          filename: 'avatar.png',
          fileMimeType: 'image/png',
        }),
      ])
    );
    expect(avatarRequests).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'upload',
          filename: 'avatar.webp',
          fileMimeType: 'image/webp',
        }),
      ])
    );
  });

  test('mobile generated avatar Use uploads the thumb-sized avatar encode', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.__avatarToBlobCalls = [];
      const originalToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function patchedToBlob(callback, type, quality) {
        window.__avatarToBlobCalls.push({
          width: this.width,
          height: this.height,
          type,
          quality,
        });
        return originalToBlob.call(this, callback, type, quality);
      };
    });

    const avatarRequests = [];
    await mockAuthenticatedProfile(page, {
      role: 'user',
      avatarRequests,
    });

    await page.route('**/api/ai/quota', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            isAdmin: false,
            creditBalance: 10,
            dailyCreditAllowance: 10,
          },
        }),
      });
    });

    await page.route('**/api/ai/generate-image', async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            imageBase64: ONE_PX_PNG_BASE64,
            mimeType: 'image/png',
            prompt: body.prompt,
            model: body.model,
            steps: body.steps,
            seed: body.seed,
          },
          billing: {
            credits_charged: 1,
            balance_after: 9,
          },
        }),
      });
    });

    const response = await page.goto('/account/profile.html');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#avatarChangeBtn').click();
    await page.locator('#avatarChooseGenerate').click();
    await expect(page.locator('#avatarGenerateModal')).toHaveClass(/active/);

    await page.locator('#avatarGeneratePrompt').fill('A small mobile portrait');
    await page.locator('#avatarGenerateBtn').click();

    await expect(page.locator('#avatarGenerateUseBtn')).toBeEnabled();
    await page.locator('#avatarGenerateUseBtn').click();

    await expect(page.locator('#avatarGenerateModal')).toBeHidden();
    await expect(page.locator('#avatarMsg')).toContainText('Photo updated.');

    const calls = await page.evaluate(() => window.__avatarToBlobCalls || []);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          width: 320,
          height: 320,
          type: 'image/webp',
          quality: 0.82,
        }),
      ])
    );
    expect(calls).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ width: 512, height: 512 }),
      ])
    );
    expect(avatarRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'upload',
          contentType: expect.stringContaining('multipart/form-data'),
        }),
      ])
    );
  });

  test('avatar generate surfaces an error when member credits are exhausted', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, { role: 'user' });

    await page.route('**/api/ai/quota', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            isAdmin: false,
            creditBalance: 0,
            dailyCreditAllowance: 10,
          },
        }),
      });
    });

    let generateCalled = 0;
    await page.route('**/api/ai/generate-image', async (route) => {
      generateCalled += 1;
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: 'Insufficient member credits.',
          code: 'insufficient_member_credits',
        }),
      });
    });

    const response = await page.goto('/account/profile.html');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#avatarChangeBtn').click();
    await page.locator('#avatarChooseGenerate').click();
    await expect(page.locator('#avatarGenerateModal')).toHaveClass(/active/);

    await expect(page.locator('#avatarGenerateQuota')).toContainText('0 credits available');

    await page.locator('#avatarGeneratePrompt').fill('Anything');
    await page.locator('#avatarGenerateBtn').click();

    await expect(page.locator('#avatarGenerateMsg')).toContainText(/credits/i);
    await expect(page.locator('#avatarGenerateUseBtn')).toBeDisabled();
    expect(generateCalled).toBeLessThanOrEqual(1);
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
          thumb_url: '/tests/fixtures/media/favorite-thumb.jpg',
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

  test('soundlab Memtrack favorites keep the tightened thumb_url guard and render viewer metadata inertly', async ({
    page,
  }) => {
    await page.route('**/api/gallery/memtracks/**/poster', async (route) => {
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
          item_id: 'bad-memtrack',
          title: 'Bad <b class="xss-soundlab">Track</b>',
          thumb_url: 'https://user:pass@pub.bitbi.ai/gallery/thumbs/blocked.webp',
          created_at: '2026-04-10T12:00:00.000Z',
        },
        {
          item_type: 'soundlab',
          item_id: 'tiny-hearts',
          title: 'Tiny Hearts',
          thumb_url: 'https://pub.bitbi.ai/sound-lab/thumbs/thumb-tiny.webp',
          created_at: '2026-04-10T11:58:00.000Z',
        },
        {
          item_type: 'soundlab',
          item_id: 'exclusive-track-01',
          title: 'Exclusive Track 01',
          thumb_url: 'https://pub.bitbi.ai/sound-lab/thumbs/thumb-bitbi.webp',
          created_at: '2026-04-10T11:57:00.000Z',
        },
        {
          item_type: 'soundlab',
          item_id: 'legacy-grok-favorite',
          title: 'Grok’s Groove Remix',
          thumb_url: '',
          created_at: '2026-04-10T11:56:00.000Z',
        },
        {
          item_type: 'soundlab',
          item_id: 'feedc0de',
          title: 'Published Member Track',
          thumb_url: '/api/gallery/memtracks/feedc0de/vpubposter/poster',
          created_at: '2026-04-10T11:59:00.000Z',
        },
      ],
    });

    const response = await page.goto('/account/profile.html');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });
    await page.locator('#profileFavoritesQuickLink').click();
    await expect(page.locator('#profileFavoritesOverlay')).toHaveClass(/is-open/);

    await expect(page.locator('[data-favorites-type="soundlab"] [data-fav-key="soundlab:bad-memtrack"] img')).toHaveCount(0);
    await expect(page.locator('[data-fav-key="soundlab:tiny-hearts"]')).toHaveCount(0);
    await expect(page.locator('[data-fav-key="soundlab:exclusive-track-01"]')).toHaveCount(0);
    await expect(page.locator('[data-fav-key="soundlab:legacy-grok-favorite"]')).toHaveCount(0);
    await expect(page.locator('[data-favorites-type="soundlab"]')).not.toContainText('Tiny Hearts');
    await expect(page.locator('[data-favorites-type="soundlab"]')).not.toContainText('Exclusive Track 01');
    await expect(page.locator('[data-favorites-type="soundlab"]')).not.toContainText('Grok’s Groove Remix');
    await expect(page.locator('[data-favorites-type="soundlab"] [data-fav-key="soundlab:feedc0de"] img')).toHaveAttribute('src', /\/api\/gallery\/memtracks\/feedc0de\/vpubposter\/poster$/);

    await page.locator('[data-fav-key="soundlab:bad-memtrack"]').click();
    await expect(page.locator('#favViewer')).not.toHaveClass(/active/);

    await page.locator('[data-fav-key="soundlab:feedc0de"]').click();
    await expect(page.locator('#favViewer')).toHaveClass(/active/);
    await expect(page.locator('#profileFavoritesOverlay')).toHaveClass(/is-open/);
    await expect(page.locator('#favViewer .xss-soundlab')).toHaveCount(0);
    await expect(page.locator('#favViewer #fvPlay')).toBeVisible();
    await expect(page.locator('#favViewer .fav-viewer__download')).toBeVisible();
    await expect(page.locator('#favViewer .fav-viewer__track-title')).toHaveText('Published Member Track');
    await expect(page.locator('#favViewer .fav-viewer__player-hero img')).toHaveAttribute('src', /\/api\/gallery\/memtracks\/feedc0de\/vpubposter\/poster$/);
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
    await expect(page.locator('#profileFavoritesSection')).toBeHidden();
    await page.locator('#profileFavoritesQuickLink').click();
    await expect(page.locator('#profileFavoritesOverlay')).toHaveClass(/is-open/);
    await expect(page.locator('#profileFavoritesSection')).toBeVisible();

    await expect(page.locator('.profile__favorites')).not.toContainText('AI Creations');
    await expect(page.locator('[data-favorites-type="video"] .favorites__group-label')).toHaveText('Memvids');
    await expect(page.locator('[data-favorites-type="mempics"] [data-fav-key="mempics:a1b2c3d4"] img')).toHaveAttribute('src', new RegExp(`/api/gallery/mempics/a1b2c3d4/${mempicVersion}/thumb$`));
    await expect(page.locator('[data-favorites-type="video"] [data-fav-key="video:bada55e1"] img')).toHaveAttribute('src', new RegExp(`/api/gallery/memvids/bada55e1/${memvidVersion}/poster$`));

    await page.locator('[data-fav-key="mempics:a1b2c3d4"]').click();
    await expect(page.locator('#profileFavoritesOverlay')).toHaveClass(/is-open/);
    await expect(page.locator('#favViewer .fav-viewer__image img')).toHaveAttribute('src', new RegExp(`/api/gallery/mempics/a1b2c3d4/${mempicVersion}/medium$`));
    await expect(page.locator('#favViewer .fav-viewer__full-link')).toHaveAttribute('href', new RegExp(`/api/gallery/mempics/a1b2c3d4/${mempicVersion}/file$`));
    await expect(page.locator('#favViewer .fav-viewer__download')).toHaveAttribute('href', new RegExp(`/api/gallery/mempics/a1b2c3d4/${mempicVersion}/file$`));
    await expect(page.locator('#favViewer .fav-viewer__nav--next')).toBeVisible();
    await expect(page.locator('#favViewer .fav-viewer__nav--prev')).toBeVisible();
    await page.locator('#favViewer .fav-viewer__nav--next').click();
    await expect(page.locator('#favViewer .fav-viewer__image video')).toHaveAttribute('src', new RegExp(`/api/gallery/memvids/bada55e1/${memvidVersion}/file$`));
    await expect(page.locator('#favViewer .fav-viewer__title')).toHaveText('Launch Walkthrough');
    await page.locator('#favViewerClose').click();
    await expect(page.locator('#profileFavoritesOverlay')).toHaveClass(/is-open/);

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
    await expect(page.locator('#profileEditState')).toContainText('Unsaved changes');
    await page.locator('#profileForm').getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.locator('#formMsg')).toContainText('Profile updated.');
    await expect(page.locator('#profileEditState')).toContainText('Saved.');
    await expect(page.locator('.auth-nav__identity-label')).toHaveText('Updated Header Name');
  });

  test('profile completion stays compact and wallet trust guidance moves to Help', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, {
      role: 'user',
      email: 'linked-wallet@example.com',
      displayName: 'Linked Wallet Member',
      hasAvatar: true,
      linkedWallet: {
        address: '0x1234567890abcdef1234567890abcdef12345678',
        short_address: '0x1234...5678',
        chain_id: 1,
        linked_at: '2026-04-02T10:00:00.000Z',
        last_login_at: '2026-04-03T10:00:00.000Z',
        is_primary: true,
      },
    });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#profileCompletionCard')).toBeVisible();
    await expect(page.locator('#profileCompletionCard')).toContainText('Checklist');
    await expect(page.locator('#profileCompletionStatus')).toContainText('5 of 5 account signals complete.');
    await expect(page.locator('#profileCompletionCard > #profileCompletionStatus')).toHaveCount(0);
    await expect(page.locator('#profileCompletionCard .profile__completion-title-row #profileCompletionStatus')).toBeVisible();
    await expect(page.locator('#completionSignedInStatus')).toContainText('Signed in');
    await expect(page.locator('#completionEmailStatus')).toContainText('Verified');
    await expect(page.locator('#completionProfileImageStatus')).toContainText('Set');
    await expect(page.locator('#completionDisplayNameStatus')).toContainText('Set');
    await expect(page.locator('#completionWalletStatus')).toContainText('Linked');
    await expect(page.locator('#profileCompletionCard .profile__completion-item')).toHaveCount(5);
    await expect(page.locator('#completionProfileLoadedStatus')).toHaveCount(0);
    await expect(page.locator('#completionRecoveryStatus')).toHaveCount(0);
    await expect(page.locator('#profileCompletionCard')).not.toContainText('Profile loaded');
    await expect(page.locator('#profileCompletionCard [data-state="complete"]')).toHaveCount(5);
    const completionLabels = await page.locator('#profileCompletionCard .profile__completion-label').allTextContents();
    expect(completionLabels).toEqual([
      'Signed in',
      'Email status',
      'Profile image',
      'Display name',
      'Wallet link',
    ]);
    const completionItems = await page.locator('#profileCompletionCard .profile__completion-item').evaluateAll((items) => (
      items.map((item) => item.getAttribute('data-completion-item'))
    ));
    expect(completionItems).toEqual(['signed-in', 'email', 'profile-image', 'display-name', 'wallet']);
    await expect(page.locator('#profileSecurityCard')).toHaveCount(0);
    await expect(page.locator('#walletTrustStatus')).toHaveCount(0);
    await expect(page.locator('#walletSectionCard')).toHaveCount(0);
    await expect(page.locator('#profileWalletContext')).toHaveCount(0);
    await expect(page.locator('#walletStatusRefreshBtn')).toHaveCount(0);
    await expect(page.locator('#profileHomeView')).not.toContainText('BITBI Account');
    await expect(page.locator('#profileWalletCardStatus')).toContainText('Linked');
    await page.locator('#profileWalletCard').click();
    await expect(page.locator('#walletWorkspace')).toBeVisible();
    await page.locator('[data-wallet-workspace-close="panel"]').click();
    await expect(page.locator('#walletWorkspace')).toBeHidden();

    await page.locator('#bitbiHelpTrigger').click();
    const profileHelp = page.locator('[data-help-section="profile"]');
    await profileHelp.locator('summary.help-menu__section-toggle').click();
    const walletHelp = profileHelp.locator('.help-menu__item').filter({ hasText: 'Wallet safety' });
    await expect(walletHelp.locator('summary')).toContainText('Wallet safety');
    await walletHelp.locator('summary').click();
    await expect(walletHelp).toContainText('identity hint, not custody');
    await expect(walletHelp).toContainText('seed phrases or private keys');
    await expect(walletHelp.locator('.help-menu__item-body')).toContainText('Profile, Credits, Generate Lab, and Assets Manager work without a wallet link');

  });

  test('profile strips unsafe return params without rendering workspace hint panels', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, {
      role: 'user',
      email: 'post-auth-profile@example.com',
      displayName: 'Post Auth Profile',
    });

    const response = await page.goto('/account/profile?source=credits&returnTo=https%3A%2F%2Fevil.example%2Fprivate%3Ftoken%3Draw-asset&token=raw-token');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('[data-auth-post-hint]')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('You are signed in to Profile');
    await expect(page.locator('main')).not.toContainText('Opened from Credits.');
    await expect(page.locator('main')).not.toContainText('raw return URLs');
    expect(page.url()).not.toContain('returnTo=');
    expect(page.url()).not.toContain('raw-token');

    const storageSnapshot = await page.evaluate(() => `${Object.values(sessionStorage).join('\n')}\n${Object.values(localStorage).join('\n')}`);
    expect(storageSnapshot).not.toContain('evil.example');
    expect(storageSnapshot).not.toContain('raw-token');
  });

  test('profile save failure keeps typed values and shows generic recovery guidance', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, {
      role: 'user',
      email: 'save-failure@example.com',
      displayName: 'Save Failure',
      profilePatchStatus: 500,
      profilePatchBody: { ok: false, error: 'raw internal profile update failure' },
    });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await page.locator('#displayName').fill('Retry Name');
    await expect(page.locator('#profileEditState')).toContainText('Unsaved changes');
    await page.locator('#profileForm').getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.locator('#formMsg')).toContainText('Could not save profile changes.');
    await expect(page.locator('#profileEditState')).toContainText('Save failed.');
    await expect(page.locator('#profileSaveRecovery')).toBeVisible();
    await expect(page.locator('#profileSaveRecovery')).toContainText('typed values are still in the form');
    await expect(page.locator('#displayName')).toHaveValue('Retry Name');
    await expect(page.locator('#formMsg')).not.toContainText('raw internal');
  });

  test('non-admin desktop profile uses three columns and opens Favorites from the action stack', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, { role: 'user' });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#profileStudioCard')).toBeVisible();
    await expect(page.locator('#profileWalletCard')).toBeVisible();
    await expect(page.locator('#profileStudioCard')).toContainText('Assets Manager');
    await expect(page.locator('#profileCreditsCard')).toBeVisible();
    await expect(page.locator('#profileCreditsCard')).toContainText('Credits');
    await expect(page.locator('#profileCreditsCard')).toHaveAttribute('href', '/account/credits.html?scope=member');
    await expect(page.locator('#profileFavoritesQuickLink')).toBeVisible();
    await expect(page.locator('#profileFavoritesQuickLink')).toContainText('Favorites');
    await expect(page.locator('#profileFavoritesQuickLink')).toHaveAttribute('href', '#profileFavoritesSection');
    await expect(page.locator('#profileStudioStack .profile__studio-card:visible')).toHaveCount(4);
    await expect(page.locator('#profileFavoritesOverlay')).not.toHaveClass(/is-open/);
    await expect(page.locator('#profileFavoritesSection')).toBeHidden();
    await expect(page.locator('#profileFavoritesSection')).toHaveAttribute('tabindex', '-1');
    await expect(page.locator('#memberControlCenter')).toHaveCount(0);
    await expect(page.locator('#profileWorkspacePriority')).toHaveCount(0);
    await expect(page.locator('#profileUsageTrustCard')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Member Control Center');
    await expect(page.locator('body')).not.toContainText('Workspace priority');
    await expect(page.locator('body')).not.toContainText('Usage trust');
    await expect(page.locator('#profileCompletionCard')).toBeVisible();
    await expect(page.locator('#profileCompletionCard')).toContainText('Checklist');
    await expect(page.locator('#profileCompletionCard .profile__completion-item')).toHaveCount(5);
    await expect(page.locator('#profileCompletionCard')).toContainText('Email status');
    await expect(page.locator('#profileCompletionCard')).toContainText('Profile image');
    await expect(page.locator('#profileCompletionCard')).toContainText('Display name');
    await expect(page.locator('#profileCompletionCard')).not.toContainText('Profile loaded');
    await expect(page.locator('#profileAvatarCard')).toHaveClass(/profile__avatar-card--compact/);
    await expect(page.locator('#avatarChangeBtn')).toBeVisible();
    await expect(page.locator('#profileAvatarCard')).toContainText('JPG, PNG or WebP. Max 2 MB.');
    await expect(page.locator('#profileAvatarAccountStack #profileAccountCard')).toBeVisible();
    await expect(page.locator('#profileAccountCard')).toContainText('Account Info');
    await expect(page.locator('#profileAccountCard')).toContainText('Display Name');
    await expect(page.locator('#profileAccountCard')).toContainText('Member Since');
    await expect(page.locator('#profileAccountCard')).toHaveClass(/profile__account-card--compact/);
    const overviewLayout = await page.locator('#profileContent').evaluate((node) => {
      const rectOf = (selector) => node.querySelector(selector)?.getBoundingClientRect();
      const avatar = rectOf('#profileAvatarCard');
      const account = rectOf('#profileAccountCard');
      const completion = rectOf('#profileCompletionCard');
      const settings = rectOf('.profile__settings-row');
      const studioStack = rectOf('#profileStudioStack');
      const assets = rectOf('#profileStudioCard');
      const favorites = rectOf('#profileFavoritesQuickLink');
      const wallet = rectOf('#profileWalletCard');
      const credits = rectOf('#profileCreditsCard');
      const heading = rectOf('#profileCompletionTitle');
      const completionStatus = rectOf('#profileCompletionStatus');
      const completionOrder = Array.from(node.querySelectorAll('#profileCompletionCard .profile__completion-item'))
        .map((item) => item.getAttribute('data-completion-item'));
      const actionHeights = [assets, favorites, wallet, credits]
        .filter(Boolean)
        .map((rect) => rect.height);
      const visualQuickLinks = [
        ['Assets Manager', assets],
        ['Favorites', favorites],
        ['Wallet', wallet],
        ['Credits', credits],
      ]
        .filter(([, rect]) => rect && rect.width > 0 && rect.height > 0)
        .sort((a, b) => a[1].top - b[1].top)
        .map(([label]) => label);
      const accountRows = Array.from(node.querySelectorAll('#profileAccountCard .profile__row'))
        .map((row) => row.getBoundingClientRect());
      const leftWidth = avatar?.width ?? 0;
      const centerWidth = settings?.width ?? 0;
      const rightWidth = studioStack?.width ?? 0;
      return {
        completionOrder,
        accountBelowAvatar: Boolean(avatar && account && account.top > avatar.bottom),
        completionBelowAccount: Boolean(account && completion && completion.top > account.bottom),
        avatarCompact: Boolean(avatar && avatar.height <= 112),
        actionCardsVertical: Boolean(
          assets
          && favorites
          && wallet
          && credits
          && favorites.top > assets.bottom
          && wallet.top > favorites.bottom
          && credits.top > wallet.bottom
          && Math.abs(favorites.left - assets.left) <= 4
          && Math.abs(wallet.left - assets.left) <= 4
          && Math.abs(credits.left - assets.left) <= 4,
        ),
        visualQuickLinks,
        threeColumns: Boolean(
          avatar
          && settings
          && studioStack
          && avatar.left < settings.left
          && settings.left < studioStack.left
          && Math.max(leftWidth, centerWidth, rightWidth) - Math.min(leftWidth, centerWidth, rightWidth) <= 28
        ),
        accountHeightCompact: Boolean(account && account.height <= 210),
        accountRowsReadable: accountRows.length === 5
          && accountRows.every((row, index) => index === 0 || row.top >= accountRows[index - 1].bottom - 1),
        summaryRightOfHeading: Boolean(heading && completionStatus && completionStatus.left > heading.right),
        summarySameHeadingRow: Boolean(
          heading
          && completionStatus
          && completionStatus.top < heading.bottom
          && completionStatus.bottom > heading.top,
        ),
        quickStackTopDelta: studioStack && avatar ? Math.abs(studioStack.top - avatar.top) : null,
        quickStackHeightDelta: studioStack && avatar && account ? Math.abs(studioStack.height - (account.bottom - avatar.top)) : null,
        actionHeightsBalanced: actionHeights.length === 4
          && Math.max(...actionHeights) - Math.min(...actionHeights) <= 6,
        actionCardsTouchSafe: actionHeights.length === 4 && Math.min(...actionHeights) >= 44,
      };
    });
    expect(overviewLayout.completionOrder).toEqual(['signed-in', 'email', 'profile-image', 'display-name', 'wallet']);
    expect(overviewLayout.accountBelowAvatar).toBe(true);
    expect(overviewLayout.completionBelowAccount).toBe(true);
    expect(overviewLayout.avatarCompact).toBe(true);
    expect(overviewLayout.actionCardsVertical).toBe(true);
    expect(overviewLayout.visualQuickLinks).toEqual(['Assets Manager', 'Favorites', 'Wallet', 'Credits']);
    expect(overviewLayout.threeColumns).toBe(true);
    expect(overviewLayout.accountHeightCompact).toBe(true);
    expect(overviewLayout.accountRowsReadable).toBe(true);
    expect(overviewLayout.summaryRightOfHeading).toBe(true);
    expect(overviewLayout.summarySameHeadingRow).toBe(true);
    expect(overviewLayout.quickStackTopDelta).not.toBeNull();
    expect(overviewLayout.quickStackTopDelta).toBeLessThanOrEqual(6);
    expect(overviewLayout.quickStackHeightDelta).not.toBeNull();
    expect(overviewLayout.quickStackHeightDelta).toBeLessThanOrEqual(8);
    expect(overviewLayout.actionHeightsBalanced).toBe(true);
    expect(overviewLayout.actionCardsTouchSafe).toBe(true);
    const settingsRow = page.locator('.profile__settings-row');
    await expect(settingsRow).toBeVisible();
    const settingsOrder = await settingsRow.locator(':scope > .profile__card').evaluateAll((cards) => (
      cards.map((card) => card.id || (card.classList.contains('profile__edit-card') ? 'profileEditCard' : 'unknown'))
    ));
    expect(settingsOrder).toEqual(['profileEditCard']);
    await expect(page.locator('#walletSectionCard')).toHaveCount(0);
    await expect(page.locator('#profileWalletContext')).toHaveCount(0);
    await expect(page.locator('#walletStatusRefreshBtn')).toHaveCount(0);
    await expect(settingsRow.locator('.profile__edit-card')).not.toContainText('BITBI Account');
    const settingsColumns = await settingsRow.evaluate((node) => getComputedStyle(node).gridTemplateColumns);
    expect(settingsColumns.split(' ').length).toBe(1);
    await expect(page.locator('#profileSecurityCard')).toHaveCount(0);
    await expect(page.locator('#walletTrustStatus')).toHaveCount(0);
    await expect(page.locator('#profileForm')).toBeVisible();
    const helperSpacing = await page.locator('#profileForm').evaluate((form) => {
      const gapFor = (controlSelector, helperSelector) => {
        const control = form.querySelector(controlSelector)?.getBoundingClientRect();
        const helper = form.querySelector(helperSelector)?.getBoundingClientRect();
        return control && helper ? helper.top - control.bottom : null;
      };
      return {
        displayName: gapFor('#displayName', '#displayNameHelp'),
        bio: gapFor('#bio', '#bioHelp'),
        website: gapFor('#website', '#websiteHelp'),
      };
    });
    expect(helperSpacing.displayName).not.toBeNull();
    expect(helperSpacing.bio).not.toBeNull();
    expect(helperSpacing.website).not.toBeNull();
    expect(Math.abs(helperSpacing.displayName - helperSpacing.bio)).toBeLessThanOrEqual(2);
    expect(Math.abs(helperSpacing.website - helperSpacing.bio)).toBeLessThanOrEqual(2);
    const layoutOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(layoutOverflow).toBe(false);
    await page.locator('#profileFavoritesQuickLink').click();
    await expect(page.locator('#profileFavoritesOverlay')).toHaveClass(/is-open/);
    await expect(page.locator('#profileFavoritesOverlayClose')).toBeVisible();
    await page.locator('#profileFavoritesOverlayClose').click();
    await expect(page.locator('#profileFavoritesOverlay')).not.toHaveClass(/is-open/);
    await expect(page.locator('#profileAdminAiLabCard')).toHaveCount(0);
    await expect(page.locator('#profileOrganizationCard')).toHaveCount(0);
    await expect(page.locator('#profileAiLabView')).toHaveCount(0);
  });

  test('Assets Manager strips unsafe return context without rendering workspace hint panels', async ({ page }) => {
    await mockAuthenticatedAssetsManager(page, [], { creditBalance: 1200 });

    await page.goto('/account/assets-manager?source=generate-lab&recent=1&returnTo=https%3A%2F%2Fevil.example%2Fasset%3Fasset_id%3Draw-asset&token=raw-asset#generate-lab-recent');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('[data-auth-post-hint]')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('You are signed in to Assets Manager');
    await expect(page.locator('main')).not.toContainText('Opened from Generate Lab.');
    await expect(page.locator('main')).not.toContainText('raw return URLs');
    expect(page.url()).not.toContain('returnTo=');
    expect(page.url()).not.toContain('raw-asset');
  });

  test('admin desktop profile shows the same compact Assets Manager + Favorites + Wallet + Credits stack as non-admin users', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, { role: 'admin', includeProfileAccountId: false });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#profileStudioCard')).toBeVisible();
    await expect(page.locator('#profileWalletCard')).toBeVisible();
    await expect(page.locator('#profileStudioCard')).toContainText('Assets Manager');
    await expect(page.locator('#profileWalletCard')).toContainText('Wallet');
    await expect(page.locator('#profileCreditsCard')).toBeVisible();
    await expect(page.locator('#profileCreditsCard')).toContainText('Credits');
    await expect(page.locator('#profileFavoritesQuickLink')).toBeVisible();
    await expect(page.locator('#profileFavoritesQuickLink')).toContainText('Favorites');
    await expect(page.locator('#profileFavoritesQuickLink')).toHaveAttribute('href', '#profileFavoritesSection');
    await expect(page.locator('#profileStudioStack .profile__studio-card:visible')).toHaveCount(4);
    const visualQuickLinks = await page.locator('#profileStudioStack').evaluate((node) => (
      Array.from(node.querySelectorAll('.profile__studio-card'))
        .map((card) => ({
          text: card.querySelector('.profile__studio-label')?.textContent?.trim(),
          rect: card.getBoundingClientRect(),
        }))
        .filter((item) => item.rect.width > 0 && item.rect.height > 0)
        .sort((a, b) => a.rect.top - b.rect.top)
        .map((item) => item.text)
    ));
    expect(visualQuickLinks).toEqual(['Assets Manager', 'Favorites', 'Wallet', 'Credits']);
    await expect(page.locator('#profileWalletContext')).toHaveCount(0);
    await expect(page.locator('#memberControlCenter')).toHaveCount(0);
    await expect(page.locator('#profileCompletionCard')).toBeVisible();
    await expect(page.locator('#profileSecurityCard')).toHaveCount(0);
    await expect(page.locator('#profileAdminAiLabCard')).toHaveCount(0);
    await expect(page.locator('#profileOrganizationCard')).toHaveCount(0);
    await expect(page.locator('#profileAiLabView')).toHaveCount(0);
    await expect(page.locator('#profileMobileAiLabLink')).toHaveCount(0);
    await expect(page.locator('#profileCreditsLink')).toHaveAttribute('href', '/account/credits.html?scope=member');
    await expect(page.locator('#profileOrganizationLink')).toHaveCount(0);
  });
});

test.describe('Profile page (authenticated mobile)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
  });

  test('signed-out mobile header keeps account creation under the header without raw return URLs', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await fulfillJson(route, { loggedIn: false, user: null });
    });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    const createCta = page.locator('#mobileHeaderCreateAccount');
    await expect(createCta).toBeVisible();
    await expect(createCta).toHaveText('Join for free');
    await expect(page.getByText('CREATE *FREE* ACCOUNT')).toHaveCount(0);

    await createCta.click();
    await expect(page.locator('.auth-modal__overlay.active')).toBeVisible();
    await expect(page.locator('.auth-modal__tab[data-tab="register"]')).toHaveClass(/active/);
    await expectAuthContextRemoved(page);
    await expect(page.locator('#authRegisterForm input[name="email"]')).toBeVisible();

    const sessionSnapshot = await page.evaluate(() => Object.values(sessionStorage).join('\n'));
    const localSnapshot = await page.evaluate(() => Object.values(localStorage).join('\n'));
    expect(`${sessionSnapshot}\n${localSnapshot}`).not.toContain('/account/profile.html');
    expect(`${sessionSnapshot}\n${localSnapshot}`).not.toContain('token=');

    await page.keyboard.press('Escape');
    await expect(page.locator('.auth-modal__overlay.active')).toHaveCount(0);
    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveClass(/open/);

    await expect(page.locator('#mobileNav').getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(page.locator('#mobileNav .auth-nav__mobile-continuity')).toHaveCount(0);
    await expect(page.locator('#mobileNav .auth-nav__mobile-workspace')).toHaveCount(0);
    await expect(page.locator('#mobileNav')).not.toContainText('Account workspace needs sign-in');
    await expect(page.locator('#mobileNav')).not.toContainText('Create Account');
    await expect(page.locator('#mobileNav')).not.toContainText('Reset password');
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
    await expect(page.locator('#mobileHeaderCreateAccount')).toHaveCount(0);

    const mobileAccountOrder = await page.locator('.auth-nav__mobile-account').evaluate((node) =>
      Array.from(node.children).map((child) => child.className),
    );
    expect(mobileAccountOrder).toEqual([
      'auth-nav__mobile-identity',
      'auth-nav__mobile-admin',
      'auth-nav__mobile-logout',
    ]);
    await expect(page.locator('.auth-nav__mobile-continuity')).toHaveCount(0);
    await expect(page.locator('.auth-nav__mobile-workspace')).toHaveCount(0);
    await expect(page.locator('#mobileNav')).not.toContainText('Signed in as mobile-header@example.com');
    await expect(page.locator('#mobileNav')).not.toContainText('Open Assets Manager');
  });

  test('mobile header keeps only compact signed-in controls when no avatar exists', async ({
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
    await expect(page.locator('.auth-nav__mobile-actions')).toBeVisible();
    await expect(page.locator('.auth-nav__mobile-logout')).toBeVisible();
    await expect(page.locator('.auth-nav__mobile-email')).toHaveCount(0);
    await expect(page.locator('.auth-nav__mobile-profile')).toHaveCount(0);
    await expect(page.locator('.auth-nav__mobile-continuity')).toHaveCount(0);
    await expect(page.locator('.auth-nav__mobile-workspace')).toHaveCount(0);
    await expect(page.locator('#mobileNav')).not.toContainText('Signed in as mobile-fallback@example.com');
    await expect(page.locator('#mobileNav')).not.toContainText('Open Assets Manager');
  });

  test('mobile avatar change menu keeps every action visible inside the viewport', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, {
      role: 'user',
      hasAvatar: true,
    });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#avatarChangeBtn')).toBeVisible();

    await page.locator('#avatarChangeBtn').click();
    await expect(page.locator('#avatarSourceModal')).toHaveClass(/active/);
    await expect(page.locator('#avatarSourceClose')).toBeVisible();
    await expect(page.locator('#avatarChooseSavedAssets')).toBeVisible();
    await expect(page.locator('#avatarChooseUploadDevice')).toBeVisible();
    await expect(page.locator('#avatarChooseGenerate')).toBeVisible();
    await expect(page.locator('#avatarRemoveBtn')).toBeVisible();

    const menuLayout = await page.locator('#avatarSourceModal').evaluate((modal) => {
      const selectors = [
        '#avatarSourceClose',
        '#avatarChooseSavedAssets',
        '#avatarChooseUploadDevice',
        '#avatarChooseGenerate',
        '#avatarRemoveBtn',
      ];
      const viewportHeight = window.innerHeight;
      const card = modal.querySelector('.modal-card')?.getBoundingClientRect();
      const content = modal.querySelector('.modal-content')?.getBoundingClientRect();
      const items = selectors.map((selector) => {
        const rect = modal.querySelector(selector)?.getBoundingClientRect();
        return {
          selector,
          top: rect?.top ?? -999,
          bottom: rect?.bottom ?? 9999,
          height: rect?.height ?? 0,
        };
      });
      return {
        viewportHeight,
        cardHeight: card?.height ?? 0,
        contentHeight: content?.height ?? 0,
        allInsideViewport: items.every((item) => item.top >= 0 && item.bottom <= viewportHeight),
        touchTargets: items.filter((item) => item.selector !== '#avatarSourceClose').every((item) => item.height >= 44),
        closeTarget: items.find((item) => item.selector === '#avatarSourceClose')?.height ?? 0,
      };
    });

    expect(menuLayout.cardHeight).toBeLessThanOrEqual(menuLayout.viewportHeight - 12);
    expect(menuLayout.contentHeight).toBeLessThanOrEqual(menuLayout.viewportHeight - 12);
    expect(menuLayout.allInsideViewport).toBe(true);
    expect(menuLayout.touchTargets).toBe(true);
    expect(menuLayout.closeTarget).toBeGreaterThanOrEqual(32);
  });

  test('admin mobile profile removes the top link bar and keeps the reordered profile sections', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, { role: 'admin' });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#profileTabBar')).toBeHidden();
    await expect(page.locator('#profileWalletWorkspaceBtn')).toBeHidden();
    await expect(page.locator('#profileTabBar .profile-tab-link:visible')).toHaveCount(0);
    await expect(page.locator('#profileFavoritesQuickLink')).toBeVisible();
    await expect(page.locator('#profileFavoritesQuickLink')).toHaveAttribute('href', '#profileFavoritesSection');
    await expect(page.locator('#walletSectionCard')).toHaveCount(0);
    await expect(page.locator('#profileWalletContext')).toHaveCount(0);
    await expect(page.locator('#walletStatusRefreshBtn')).toHaveCount(0);
    await expect(page.locator('.profile__favorites-back')).toBeHidden();
    await expect(page.locator('.profile__favorites-back')).toHaveAttribute('href', '#profileHero');
    await expect(page.locator('#profileMobileAiLabLink')).toHaveCount(0);
    await expect(page.locator('#profileAdminAiLabCard')).toHaveCount(0);
    await expect(page.locator('#profileAiLabView')).toHaveCount(0);

    const mobileOrder = await page.locator('#profileContent').evaluate((node) => {
      const rectOf = (selector) => node.querySelector(selector)?.getBoundingClientRect();
      const avatar = rectOf('#profileAvatarCard');
      const account = rectOf('#profileAccountCard');
      const quickLinks = rectOf('#profileStudioStack');
      const completion = rectOf('#profileCompletionCard');
      const settings = rectOf('.profile__edit-card');
      const favorites = rectOf('#profileFavoritesSection');
      const back = rectOf('.profile__favorites-back');
      const quickLinkRects = Array.from(node.querySelectorAll('#profileStudioStack .profile__studio-card'))
        .map((card) => card.getBoundingClientRect());
      return {
        requestedTopOrder: Boolean(
          avatar
          && account
          && quickLinks
          && completion
          && settings
          && avatar.top < account.top
          && account.top < quickLinks.top
          && quickLinks.top < completion.top
          && completion.top < settings.top
        ),
        favoritesHiddenInMainFlow: Boolean(favorites && favorites.width === 0 && favorites.height === 0),
        backHiddenInMainFlow: Boolean(back && back.width === 0 && back.height === 0),
        quickLinkCount: quickLinkRects.length,
        quickLinksVertical: quickLinkRects.length === 4
          && quickLinkRects.every((rect, index, list) => index === 0 || rect.top > list[index - 1].bottom),
      };
    });
    expect(mobileOrder.requestedTopOrder).toBe(true);
    expect(mobileOrder.favoritesHiddenInMainFlow).toBe(true);
    expect(mobileOrder.backHiddenInMainFlow).toBe(true);
    expect(mobileOrder.quickLinkCount).toBe(4);
    expect(mobileOrder.quickLinksVertical).toBe(true);

    await page.locator('#profileFavoritesQuickLink').click();
    await expect(page.locator('#profileHomeView')).toHaveClass(/profile-view--favorites-focused/);
    await expect(page.locator('#profileFavoritesSection')).toBeVisible();
    await expect(page.locator('.profile__favorites-back')).toBeVisible();
    await expect(page.locator('.profile-layout__main')).toBeHidden();
    const favoritesFocusLayout = await page.locator('#profileHomeView').evaluate((node) => {
      const favorites = node.querySelector('#profileFavoritesSection')?.getBoundingClientRect();
      const back = node.querySelector('.profile__favorites-back')?.getBoundingClientRect();
      return {
        backBelowFavorites: Boolean(back && favorites && back.top > favorites.top),
      };
    });
    expect(favoritesFocusLayout.backBelowFavorites).toBe(true);

    await page.locator('.profile__favorites-back').click();
    await expect(page.locator('#profileHomeView')).not.toHaveClass(/profile-view--favorites-focused/);
    await expect(page.locator('.profile-layout__main')).toBeVisible();

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasOverflow).toBe(false);
  });

  test('non-admin mobile profile removes top links and keeps four main quick-link cards', async ({
    page,
  }) => {
    await mockAuthenticatedProfile(page, { role: 'user' });

    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#profileContent')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#profileTabBar')).toBeHidden();
    await expect(page.locator('#profileWalletWorkspaceBtn')).toBeHidden();
    await expect(page.locator('#profileTabBar .profile-tab-link:visible')).toHaveCount(0);
    await expect(page.locator('#profileStudioStack .profile__studio-card')).toHaveCount(4);
    await expect(page.locator('#profileStudioStack .profile__studio-label')).toHaveText([
      'Assets Manager',
      'Wallet',
      'Credits',
      'Favorites',
    ]);
    await expect(page.locator('#profileFavoritesQuickLink')).toHaveAttribute('href', '#profileFavoritesSection');
    await expect(page.locator('#walletSectionCard')).toHaveCount(0);
    await expect(page.locator('#profileWalletContext')).toHaveCount(0);
    await expect(page.locator('#walletStatusRefreshBtn')).toHaveCount(0);
    await expect(page.locator('.profile__favorites-back')).toBeHidden();
    await page.locator('#profileFavoritesQuickLink').click();
    await expect(page.locator('#profileFavoritesSection')).toBeVisible();
    await expect(page.locator('.profile__favorites-back')).toBeVisible();
    await expect(page.locator('.profile-layout__main')).toBeHidden();
    await page.locator('.profile__favorites-back').click();
    await expect(page.locator('.profile-layout__main')).toBeVisible();
    await expect(page.locator('#memberControlCenter')).toHaveCount(0);
    await expect(page.locator('#profileCompletionCard')).toBeVisible();
    await expect(page.locator('#profileSecurityCard')).toHaveCount(0);
    await expect(page.locator('#profileMobileAiLabLink')).toHaveCount(0);
    await expect(page.locator('#profileAiLabView')).toHaveCount(0);
  });

  test('organization owner mobile profile keeps compact content without the top link bar', async ({
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
    await expect(page.locator('#profileTabBar')).toBeHidden();
    await expect(page.locator('#profileTabBar .profile-tab-link:visible')).toHaveCount(0);
    await expect(page.locator('#profileStudioStack .profile__studio-label')).toHaveText([
      'Assets Manager',
      'Wallet',
      'Credits',
      'Favorites',
    ]);
    await expect(page.locator('#profileCreditsLink')).toHaveAttribute('href', '/account/credits.html?scope=member');
    await expect(page.locator('#profileOrganizationLink')).toHaveCount(0);
    await expect(page.locator('#profileMobileAiLabLink')).toHaveCount(0);

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasOverflow).toBe(false);
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

  test('renders homepage hero video admin slots and sends guarded conversion assignments', async ({
    page,
  }) => {
    await mockAdminControlPlane(page, {});

    const slotOrder = ['right_top', 'right_bottom', 'left_top', 'left_bottom'];
    const slots = slotOrder.map((slot, index) => ({
      slot,
      enabled: false,
      display_order: (index + 1) * 10,
      derivative_id: null,
      source_type: null,
      source_asset_id: null,
      source_user_id: null,
      title: null,
      updated_at: null,
      derivative: null,
    }));
    const publicCandidates = [{
      source_type: 'public',
      source_asset_id: 'pub_memvid_hero_1',
      title: 'Published Hero Candidate',
      file_url: null,
      poster_url: '/api/gallery/memvids/pub_memvid_hero_1/vtest/poster',
      size_bytes: 2_100_000,
      duration_seconds: 7,
    }, {
      source_type: 'public',
      source_asset_id: 'pub_memvid_unsafe_preview',
      title: 'Unsafe Preview Candidate',
      file_url: 'javascript:alert(1)',
      poster_url: 'data:image/png;base64,unsafe',
      size_bytes: 1_100_000,
      duration_seconds: 4,
    }];
    const adminCandidates = [{
      source_type: 'admin_asset',
      source_asset_id: 'admin_hero_clip_1',
      title: 'Private Admin Clip',
      file_url: '/api/admin/users/admin-1/assets/admin_hero_clip_1/file',
      poster_url: null,
      poster_status: 'pending',
      poster_retryable: true,
      poster_message: 'Poster preview is being prepared.',
      size_bytes: 3_200_000,
      duration_seconds: 6,
    }];
    const derivativeRequests = [];
    const slotRequests = [];
    const posterRetryRequests = [];
    const streamRunRequests = [];
    const uploadRequests = [];
    let recentDerivatives = [];
    const featureStatus = {
      features: {
        homepage_hero_external_ffmpeg: {
          key: 'homepage_hero_external_ffmpeg',
          worker_enabled: true,
          admin_enabled: true,
          effective_enabled: true,
          provider_required: true,
          provider_configured: true,
          provider: { configured: true, missing: [] },
        },
        homepage_hero_manual_uploads: {
          key: 'homepage_hero_manual_uploads',
          worker_enabled: true,
          admin_enabled: true,
          effective_enabled: true,
          provider_required: false,
          provider_configured: true,
        },
        memvid_stream_previews: {
          key: 'memvid_stream_previews',
          worker_enabled: true,
          admin_enabled: true,
          effective_enabled: true,
          provider_required: true,
          provider_configured: true,
          provider: { configured: true, missing: [] },
        },
        memvid_stream_preview_autoplay: {
          key: 'memvid_stream_preview_autoplay',
          worker_enabled: true,
          admin_enabled: true,
          effective_enabled: true,
          provider_required: false,
          provider_configured: true,
        },
      },
    };
    const presetStatus = {
      preset: {
        format: 'mp4',
        codec: 'h264',
        maxWidth: 720,
        fps: 24,
        durationSeconds: 8,
        audio: false,
        crf: 30,
        encoderPreset: 'slow',
        posterWidth: 640,
      },
      warnings: [],
    };
    const derivative = {
      id: 'hhvd_static_admin_ui_1',
      slot: 'right_top',
      source_type: 'admin_asset',
      source_asset_id: 'admin_hero_clip_1',
      source_user_id: 'admin-1',
      source_title: 'Private Admin Clip',
      provider: 'external_ffmpeg',
      status: 'succeeded',
      version: 'v1-admin-ui',
      mime_type: 'video/mp4',
      poster_mime_type: 'image/webp',
      width: 720,
      height: 405,
      duration_seconds: 6,
      fps: 24,
      size_bytes: 1_700_000,
      poster_size_bytes: 18_000,
      original_size_bytes: 3_200_000,
      original_mime_type: 'video/mp4',
      target_preset: { maxWidth: 720, audio: 'removed' },
      error_message: null,
      created_at: '2026-05-28T10:00:00.000Z',
      updated_at: '2026-05-28T10:01:00.000Z',
      completed_at: '2026-05-28T10:01:00.000Z',
    };

    await page.route(/\/api\/admin\/homepage\/hero-videos$/, async (route) => {
      await fulfillJson(route, {
        ok: true,
        data: {
          slots,
          slot_order: slotOrder,
          target_preset: presetStatus.preset,
          preset_status: presetStatus,
          feature_status: featureStatus,
          manual_uploads_enabled: true,
          external_ffmpeg_enabled: true,
          stream_preview_summary: {
            feature_flags: {
              provider_configured: true,
            },
            status_counts: {
              queued: 2,
              ready: 2,
            },
            queued_count: 2,
            repair_count: 1,
            total_backlog_count: 3,
            ready_count: 2,
            ready_with_download_url: 1,
            ready_missing_download_url: 1,
            failed_count: 0,
            estimated_delivered_minutes: 0,
          },
          stream_preview_processor_dispatch: {
            configured: true,
            auto_dispatch_enabled: true,
            threshold: 3,
            last_dispatch_at: '2026-05-28T10:00:00.000Z',
            last_dispatch_reason: 'scheduled_catchup',
            last_dispatch_status: 'succeeded',
            last_dispatch_message: 'Processor dispatch started.',
          },
        },
      });
    });
    await page.route(/\/api\/admin\/homepage\/hero-videos\/candidates(?:\?.*)?$/, async (route) => {
      const url = new URL(route.request().url());
      await fulfillJson(route, {
        ok: true,
        data: {
          source: url.searchParams.get('source') || 'public',
          candidates: url.searchParams.get('source') === 'admin-assets' ? adminCandidates : publicCandidates,
          applied_limit: 24,
        },
      });
    });
    await page.route(/\/api\/admin\/homepage\/hero-videos\/derivatives(?:\?.*)?$/, async (route) => {
      if (route.request().method() === 'GET') {
        await fulfillJson(route, {
          ok: true,
          data: {
            derivatives: recentDerivatives,
          },
        });
        return;
      }
      derivativeRequests.push({
        idempotencyKey: route.request().headers()['idempotency-key'] || null,
        body: route.request().postDataJSON(),
      });
      recentDerivatives = [{ ...derivative, is_assigned: false, assigned_slot: null }];
      await fulfillJson(route, {
        ok: true,
        data: { derivative },
      }, 202);
    });
    await page.route(/\/api\/admin\/homepage\/hero-videos\/derivatives\/hhvd_static_admin_ui_1$/, async (route) => {
      await fulfillJson(route, {
        ok: true,
        data: {
          derivative: recentDerivatives.find((entry) => entry.id === derivative.id)
            || { ...derivative, is_assigned: false, assigned_slot: null },
        },
      });
    });
    await page.route(/\/api\/admin\/homepage\/hero-videos\/uploads\/admin_hero_clip_1\/poster\/retry$/, async (route) => {
      posterRetryRequests.push({
        idempotencyKey: route.request().headers()['idempotency-key'] || null,
        body: route.request().postDataJSON(),
      });
      await fulfillJson(route, {
        ok: true,
        data: {
          candidate: {
            ...adminCandidates[0],
            poster_status: 'pending',
            poster_message: 'Poster preview is queued for the external ffmpeg processor.',
          },
          poster_status: 'pending',
        },
      }, 202);
    });
    await page.route(/\/api\/admin\/homepage\/hero-videos\/memvid-stream-previews\/run$/, async (route) => {
      streamRunRequests.push({
        idempotencyKey: route.request().headers()['idempotency-key'] || null,
        body: route.request().postDataJSON(),
      });
      await fulfillJson(route, {
        ok: true,
        data: {
          queued_count: 3,
          repair_queued_count: 1,
          processor_dispatch_configured: true,
          processor_dispatch_started: true,
          feature_status: featureStatus,
          stream_preview_summary: {
            feature_flags: {
              provider_configured: true,
            },
            status_counts: {
              queued: 2,
              ready: 2,
            },
            queued_count: 2,
            repair_count: 1,
            total_backlog_count: 3,
            ready_count: 2,
            ready_with_download_url: 1,
            ready_missing_download_url: 1,
            failed_count: 0,
            estimated_delivered_minutes: 0,
          },
        },
      }, 202);
    });
    await page.route(/\/api\/admin\/homepage\/hero-videos\/slots\/[^/]+$/, async (route) => {
      const body = route.request().postDataJSON();
      slotRequests.push({
        idempotencyKey: route.request().headers()['idempotency-key'] || null,
        body,
      });
      slots[0] = {
        ...slots[0],
        enabled: body.enabled === true,
        derivative_id: derivative.id,
        source_type: derivative.source_type,
        source_asset_id: derivative.source_asset_id,
        source_user_id: derivative.source_user_id,
        title: derivative.source_title,
        updated_at: '2026-05-28T10:02:00.000Z',
        derivative,
      };
      recentDerivatives = recentDerivatives.map((entry) => entry.id === derivative.id
        ? { ...entry, is_assigned: true, assigned_slot: 'right_top' }
        : entry);
      await fulfillJson(route, {
        ok: true,
        data: {
          slot: slots[0],
          slots,
        },
      });
    });
    await page.route(/\/api\/admin\/homepage\/hero-videos\/uploads$/, async (route) => {
      uploadRequests.push(route.request().postDataBuffer().toString('latin1'));
      await fulfillJson(route, {
        ok: true,
        existing: false,
        data: {
          candidate: {
            source_type: 'admin_asset',
            source_asset_id: 'admin_uploaded_portrait_1',
            title: 'Manual Portrait Source',
            file_url: '/api/admin/users/admin-1/assets/admin_uploaded_portrait_1/file',
            poster_url: null,
            poster_status: 'pending',
            poster_retryable: true,
            size_bytes: TEST_MP4_BYTES.byteLength,
            duration_seconds: 5,
          },
        },
      }, 201);
    });
    await page.route(/\/api\/homepage\/hero-videos\/[^/]+\/[^/]+\/file$/, fulfillTestMp4);
    await page.route(/\/api\/homepage\/hero-videos\/[^/]+\/[^/]+\/poster$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
      });
    });
    await page.route(/\/api\/gallery\/memvids\/pub_memvid_hero_1\/vtest\/poster$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
      });
    });

    const response = await page.goto('/admin/index.html#homepage-hero-videos');
    expect(response.status()).toBe(200);
    await expect(page.locator('#sectionHomepageHeroVideos')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Homepage Hero Videos');
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Video Delivery Controls');
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Generate / repair Memvid previews');
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Hero Conversion Preset');
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Recent conversions');
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Queued previews');
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Total processor backlog');
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Last dispatch status');
    const topPanelLayout = await page.locator('#homepageHeroVideosAdmin .admin-hero-videos__ops').evaluate((ops) => {
      const cardForTitle = (title) => {
        const heading = [...ops.querySelectorAll('.admin-hero-videos__section-title')]
          .find((node) => node.textContent?.trim() === title);
        return heading?.closest('.admin-hero-videos__ops-card')?.getBoundingClientRect();
      };
      const headings = [...ops.querySelectorAll('.admin-hero-videos__section-title')]
        .map((node) => node.textContent?.trim());
      const controls = cardForTitle('Video Delivery Controls');
      const preset = cardForTitle('Hero Conversion Preset');
      const memvid = cardForTitle('Memvid Stream previews');
      return {
        headings,
        controls: controls ? { left: controls.left, top: controls.top, bottom: controls.bottom } : null,
        preset: preset ? { left: preset.left, top: preset.top, bottom: preset.bottom } : null,
        memvid: memvid ? { left: memvid.left, top: memvid.top, bottom: memvid.bottom } : null,
        actions: [...ops.querySelectorAll('[data-action]')].map((node) => node.getAttribute('data-action')),
      };
    });
    expect(topPanelLayout.headings.slice(0, 3)).toEqual([
      'Video Delivery Controls',
      'Hero Conversion Preset',
      'Memvid Stream previews',
    ]);
    expect(topPanelLayout.controls.left).toBeLessThan(topPanelLayout.memvid.left);
    expect(Math.abs(topPanelLayout.controls.left - topPanelLayout.preset.left)).toBeLessThan(2);
    expect(topPanelLayout.preset.top).toBeGreaterThan(topPanelLayout.controls.bottom);
    expect(Math.abs(topPanelLayout.memvid.top - topPanelLayout.controls.top)).toBeLessThan(2);
    expect(Math.abs(topPanelLayout.memvid.bottom - topPanelLayout.preset.bottom)).toBeLessThan(4);
    expect(topPanelLayout.actions).toEqual(expect.arrayContaining([
      'toggle-feature',
      'save-preset',
      'run-stream-preview-processing',
    ]));
    const lowerLayout = await page.locator('#homepageHeroVideosAdmin').evaluate((root) => {
      const ops = root.querySelector('.admin-hero-videos__ops')?.getBoundingClientRect();
      const candidate = root.querySelector('.admin-hero-videos__browser')?.getBoundingClientRect();
      const assignment = root.querySelector('.admin-hero-videos__assign')?.getBoundingClientRect();
      return {
        opsBottom: ops?.bottom ?? 0,
        candidateTop: candidate?.top ?? 0,
        assignmentTop: assignment?.top ?? 0,
      };
    });
    expect(lowerLayout.candidateTop).toBeGreaterThan(lowerLayout.opsBottom);
    expect(lowerLayout.assignmentTop).toBeGreaterThan(lowerLayout.opsBottom);
    await expect(page.locator('.admin-hero-videos__slot-card')).toHaveCount(4);
    await expect(page.getByRole('tab', { name: 'Published Videos' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Published Hero Candidate');
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Unsafe Preview Candidate');
    const displayFormat = page.locator('#homepageHeroVideosAdmin [data-field="upload-aspect-ratio"]');
    const thumbTimestamp = page.locator('#homepageHeroVideosAdmin [data-field="upload-poster-time"]');
    const uploadOptionsRow = page.locator('#homepageHeroVideosAdmin .admin-hero-videos__upload-options');
    await expect(displayFormat).toHaveValue('16:9');
    await expect(displayFormat.locator('option')).toHaveCount(3);
    expect(await displayFormat.locator('option').evaluateAll((options) => options.map((option) => ({
      value: option.value,
      text: option.textContent,
    })))).toEqual([
      { value: '9:16', text: 'Hochkant (9:16)' },
      { value: '1:1', text: 'Square (1:1)' },
      { value: '16:9', text: 'Landscape (16:9)' },
    ]);
    await expect(uploadOptionsRow).toBeVisible();
    await expect(thumbTimestamp).toHaveAttribute('type', 'number');
    await expect(thumbTimestamp).toHaveAttribute('min', '0');
    await expect(thumbTimestamp).toHaveAttribute('step', '0.1');
    await expect(thumbTimestamp).toHaveValue('1');
    await expect(uploadOptionsRow).toContainText('Display format');
    await expect(uploadOptionsRow).toContainText('Thumb timestamp');
    const uploadOptionsLayout = await uploadOptionsRow.evaluate((row) => {
      const format = row.querySelector('[data-field="upload-aspect-ratio"]')?.closest('label')?.getBoundingClientRect();
      const timestamp = row.querySelector('[data-field="upload-poster-time"]')?.closest('label')?.getBoundingClientRect();
      return {
        formatLeft: format?.left ?? 0,
        formatTop: format?.top ?? 0,
        timestampLeft: timestamp?.left ?? 0,
        timestampTop: timestamp?.top ?? 0,
      };
    });
    expect(uploadOptionsLayout.formatLeft).toBeLessThan(uploadOptionsLayout.timestampLeft);
    expect(Math.abs(uploadOptionsLayout.formatTop - uploadOptionsLayout.timestampTop)).toBeLessThan(2);
    const unsafePreview = await page.locator('.admin-hero-videos__candidate-card', { hasText: 'Unsafe Preview Candidate' }).evaluate((card) => ({
      videoSrc: card.querySelector('video')?.getAttribute('src') || '',
      imageSrc: card.querySelector('img')?.getAttribute('src') || '',
      emptyText: card.querySelector('.admin-hero-videos__preview-empty')?.textContent || '',
    }));
    expect(unsafePreview).toEqual({
      videoSrc: '',
      imageSrc: '',
      emptyText: 'No preview available',
    });

    await page.getByRole('tab', { name: 'Admin Assets' }).click();
    await expect(page.getByRole('tab', { name: 'Admin Assets' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Private Admin Clip');
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Poster preview is being prepared');
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Retry poster');

    await page.locator('#homepageHeroVideosAdmin [data-field="reason"]').fill('Operator-approved homepage hero conversion');
    await page.getByRole('button', { name: 'Generate / repair Memvid previews' }).click();
    await expect.poll(() => streamRunRequests.length).toBe(1);
    expect(streamRunRequests[0].idempotencyKey).toMatch(/^memvid-stream-preview-run-/);
    expect(streamRunRequests[0].body).toMatchObject({
      operator_reason: 'Operator-approved homepage hero conversion',
    });
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Preview processing started.');

    await page.locator('.admin-hero-videos__candidate-card').getByRole('button', { name: 'Retry poster' }).click();
    await expect.poll(() => posterRetryRequests.length).toBe(1);
    expect(posterRetryRequests[0].idempotencyKey).toMatch(/^homepage-hero-video-poster-/);
    expect(posterRetryRequests[0].body).toMatchObject({
      operator_reason: 'Operator-approved homepage hero conversion',
    });
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Poster preview queued for processor extraction.');

    await page.locator('.admin-hero-videos__candidate-card').getByRole('button', { name: 'Select' }).first().click();
    await page.getByRole('button', { name: 'Convert selected' }).click();
    await expect.poll(() => derivativeRequests.length).toBe(1);
    expect(derivativeRequests[0].idempotencyKey).toMatch(/^homepage-hero-video-convert-/);
    expect(derivativeRequests[0].body).toMatchObject({
      slot: 'right_top',
      source_type: 'admin_asset',
      source_asset_id: 'admin_hero_clip_1',
      operator_reason: 'Operator-approved homepage hero conversion',
    });
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Conversion job succeeded.');

    await page.getByRole('button', { name: 'Assign converted derivative' }).click();
    await expect.poll(() => slotRequests.length).toBe(1);
    expect(slotRequests[0].idempotencyKey).toMatch(/^homepage-hero-video-slot-/);
    expect(slotRequests[0].body).toMatchObject({
      enabled: true,
      derivative_id: 'hhvd_static_admin_ui_1',
      operator_reason: 'Operator-approved homepage hero conversion',
    });
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Slot assignment saved.');
    await expect(page.locator('.admin-hero-videos__slot-card[data-slot="right_top"]')).toContainText('Enabled');

    await displayFormat.selectOption('9:16');
    await thumbTimestamp.fill('0');
    await page.locator('#homepageHeroVideosAdmin [data-field="upload-title"]').fill('Manual Portrait Source');
    await page.evaluate(() => {
      if (window.__bitbiHeroVideoSeekSpyInstalled) return;
      let descriptorOwner = HTMLMediaElement.prototype;
      let descriptor = null;
      while (descriptorOwner && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(descriptorOwner, 'currentTime');
        descriptorOwner = Object.getPrototypeOf(descriptorOwner);
      }
      window.__bitbiHeroVideoSeekTimes = [];
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
        configurable: true,
        get() {
          return descriptor?.get ? descriptor.get.call(this) : 0;
        },
        set(value) {
          if (String(this.currentSrc || this.src || '').startsWith('blob:')) {
            window.__bitbiHeroVideoSeekTimes.push(Number(value));
          }
          if (descriptor?.set) descriptor.set.call(this, value);
        },
      });
      window.__bitbiHeroVideoSeekSpyInstalled = true;
    });
    await page.locator('#homepageHeroVideosAdmin [data-field="upload-file"]').setInputFiles({
      name: 'manual-portrait.mp4',
      mimeType: 'video/mp4',
      buffer: TEST_MP4_BYTES,
    });
    await expect(page.getByRole('button', { name: 'Upload source' })).toBeEnabled({ timeout: 10_000 });
    await thumbTimestamp.fill('0.4');
    await page.getByRole('button', { name: 'Upload source' }).click();
    await expect.poll(() => uploadRequests.length).toBe(1);
    const seekTimes = await page.evaluate(() => window.__bitbiHeroVideoSeekTimes || []);
    expect(seekTimes.some((value) => Math.abs(value - 0.4) < 0.05)).toBe(true);
    expect(uploadRequests[0]).toContain('aspect_ratio');
    expect(uploadRequests[0]).toContain('9:16');
    expect(uploadRequests[0]).toContain('poster_time_seconds');
    expect(uploadRequests[0]).toContain('0.4');
    await expect(displayFormat).toHaveValue('16:9');
    await expect(thumbTimestamp).toHaveValue('1');
  });

  test('homepage hero admin recovers completed unassigned derivatives after refresh', async ({
    page,
  }) => {
    await mockAdminControlPlane(page, {});

    const slotOrder = ['right_top', 'right_bottom', 'left_top', 'left_bottom'];
    let slots = slotOrder.map((slot, index) => ({
      slot,
      enabled: false,
      display_order: (index + 1) * 10,
      derivative_id: null,
      source_type: null,
      source_asset_id: null,
      source_user_id: null,
      title: null,
      updated_at: null,
      derivative: null,
    }));
    const derivative = {
      id: 'hhvd_recovered_static_ui_1',
      slot: 'right_top',
      source_type: 'admin_asset',
      source_asset_id: 'admin_hero_clip_recovered',
      source_user_id: 'admin-1',
      source_title: 'Recovered Admin Clip',
      provider: 'external_ffmpeg',
      status: 'succeeded',
      version: 'v1-recovered-ui',
      file_mime_type: 'video/mp4',
      poster_mime_type: 'image/webp',
      size_bytes: 1_400_000,
      poster_size_bytes: 16_000,
      original_size_bytes: 4_200_000,
      original_mime_type: 'video/mp4',
      target_preset: { format: 'mp4', codec: 'h264', maxWidth: 720, durationSeconds: 8 },
      created_at: '2026-05-28T11:00:00.000Z',
      updated_at: '2026-05-28T11:02:00.000Z',
      completed_at: '2026-05-28T11:02:00.000Z',
      assigned_slot: null,
      is_assigned: false,
    };
    const featureStatus = {
      features: {
        homepage_hero_external_ffmpeg: { effective_enabled: true, admin_enabled: true, worker_enabled: true, provider_configured: true },
        homepage_hero_manual_uploads: { effective_enabled: true, admin_enabled: true, worker_enabled: true, provider_configured: true },
        memvid_stream_previews: { effective_enabled: true, admin_enabled: true, worker_enabled: true, provider_configured: true, provider: { missing: [] } },
        memvid_stream_preview_autoplay: { effective_enabled: true, admin_enabled: true, worker_enabled: true, provider_configured: true },
      },
    };
    const presetStatus = {
      preset: { format: 'mp4', codec: 'h264', maxWidth: 720, fps: 24, durationSeconds: 8, audio: false, crf: 30, encoderPreset: 'slow', posterWidth: 640 },
      warnings: [],
    };
    const derivativeRequests = [];
    const slotRequests = [];

    await page.route(/\/api\/admin\/homepage\/hero-videos$/, async (route) => {
      await fulfillJson(route, {
        ok: true,
        data: {
          slots,
          slot_order: slotOrder,
          target_preset: presetStatus.preset,
          preset_status: presetStatus,
          feature_status: featureStatus,
          manual_uploads_enabled: true,
          external_ffmpeg_enabled: true,
          stream_preview_summary: { queued_count: 0, repair_count: 0, total_backlog_count: 0 },
          stream_preview_processor_dispatch: { configured: true },
        },
      });
    });
    await page.route(/\/api\/admin\/homepage\/hero-videos\/candidates(?:\?.*)?$/, async (route) => {
      await fulfillJson(route, {
        ok: true,
        data: {
          candidates: [],
        },
      });
    });
    await page.route(/\/api\/admin\/homepage\/hero-videos\/derivatives(?:\?.*)?$/, async (route) => {
      if (route.request().method() === 'POST') {
        derivativeRequests.push(route.request().postDataJSON());
      }
      await fulfillJson(route, {
        ok: true,
        data: {
          derivatives: [derivative],
        },
      });
    });
    await page.route(/\/api\/admin\/homepage\/hero-videos\/slots\/right_top$/, async (route) => {
      const body = route.request().postDataJSON();
      slotRequests.push(body);
      const assigned = { ...derivative, assigned_slot: 'right_top', is_assigned: true };
      slots = slots.map((slot) => slot.slot === 'right_top'
        ? {
            ...slot,
            enabled: true,
            derivative_id: assigned.id,
            source_type: assigned.source_type,
            source_asset_id: assigned.source_asset_id,
            source_user_id: assigned.source_user_id,
            title: assigned.source_title,
            derivative: assigned,
          }
        : slot);
      await fulfillJson(route, {
        ok: true,
        data: {
          slot: slots[0],
          slots,
        },
      });
    });

    const response = await page.goto('/admin/index.html#homepage-hero-videos');
    expect(response.status()).toBe(200);
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Recent conversions');
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Recovered Admin Clip');
    await expect(page.getByRole('button', { name: 'Assign this derivative' })).toBeEnabled();

    await page.locator('#homepageHeroVideosAdmin [data-field="reason"]').fill('Assign recovered completed derivative');
    await page.getByRole('button', { name: 'Assign this derivative' }).click();
    await expect.poll(() => slotRequests.length).toBe(1);
    expect(slotRequests[0]).toMatchObject({
      enabled: true,
      derivative_id: derivative.id,
      operator_reason: 'Assign recovered completed derivative',
    });
    expect(derivativeRequests).toHaveLength(0);
    await expect(page.locator('#homepageHeroVideosAdmin')).toContainText('Slot assignment saved.');
    await expect(page.locator('.admin-hero-videos__slot-card[data-slot="right_top"]')).toContainText('Enabled');
  });

  test('renders command center, tenant isolation execution, and major admin sections from existing APIs', async ({
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
    await expect(page.locator('#sectionDashboard')).toContainText('Next Safe Action');
    await expect(page.locator('#sectionDashboard')).toContainText('Safe now');
    await expect(page.locator('#sectionDashboard')).toContainText('Guarded mutation');
    await expect(page.locator('#sectionDashboard')).toContainText('Operator proof required');
    await expect(page.locator('#sectionDashboard')).toContainText('Blocked claims');
    await expect(page.locator('#sectionDashboard')).toContainText('Evidence-index success does not prove production readiness');
    await expect(page.locator('#adminWorkbench')).toContainText('Operator Tasks');
    await expect(page.locator('#adminWorkbench .admin-workbench-card')).toHaveCount(8);
    await expect(page.locator('#adminWorkbench')).toContainText('Release & Deploy Safety');
    await expect(page.locator('#adminWorkbench')).toContainText('Production Evidence');
    await expect(page.locator('#adminWorkbench')).toContainText('Billing Evidence');
    await expect(page.locator('#adminWorkbench')).toContainText('AI Budget Controls');
    await expect(page.locator('#adminWorkbench')).toContainText('Tenant Asset Safety');
    await expect(page.locator('#adminWorkbench')).toContainText('Data Lifecycle');
    await expect(page.locator('#adminWorkbench')).toContainText('Operations Triage');
    await expect(page.locator('#adminWorkbench')).toContainText('Reference Views');
    await expect(page.locator('#adminWorkbench')).toContainText('Read-only plus guarded mutation');
    await expect(page.locator('#adminWorkbench')).toContainText('Read-only reference');
    await expect(page.locator('#adminWorkbench')).toContainText('Tenant isolation, backfill readiness, access switch, and reset remain blocked/unclaimed.');
    await expect(page.locator('#adminWorkbench').getByRole('link', { name: 'Open Billing Evidence' })).toHaveAttribute('href', '#billing-events');
    await expect(page.locator('#adminWorkbench').getByRole('link', { name: 'Open AI Budget Controls' })).toHaveAttribute('href', '#ai-budget-switches');
    await expect(page.locator('#adminWorkbench').getByRole('link', { name: 'Open Data Lifecycle' })).toHaveAttribute('href', '#lifecycle');
    await expect(page.locator('#adminWorkbench').getByRole('link', { name: 'Open Operations Triage' })).toHaveAttribute('href', '#operations');
    await expect(page.locator('#adminWorkbench').getByRole('link', { name: 'Open Tenant Asset Safety' })).toHaveAttribute('href', '#tenant-assets');
    await expect(page.locator('#adminWorkbench').getByRole('link', { name: 'Open Release & Deploy Safety' })).toHaveAttribute('href', '#readiness');
    await expect(page.locator('#adminWorkbench').getByRole('link', { name: 'Open Reference Views' })).toHaveAttribute('href', '#content');
    await expect(page.locator('#statTotal')).toHaveText('12');

    await expect(page.locator('a.admin-nav__link[data-section="security"]')).toBeAttached();
    await expect(page.locator('a.admin-nav__link[data-section="orgs"]')).toBeAttached();
    await expect(page.locator('a.admin-nav__link[data-section="billing"]')).toBeAttached();
    await expect(page.locator('a.admin-nav__link[data-section="billing-events"]')).toBeAttached();
    await expect(page.locator('a.admin-nav__link[data-section="ai-usage"]')).toBeAttached();
    await expect(page.locator('a.admin-nav__link[data-section="ai-budget-switches"]')).toBeAttached();
    await expect(page.locator('a.admin-nav__link[data-section="lifecycle"]')).toBeAttached();
    await expect(page.locator('a.admin-nav__link[data-section="tenant-assets"]')).toBeAttached();
    await expect(page.locator('a.admin-nav__link[data-section="readiness"]')).toBeAttached();
    await expect(page.locator('a.admin-nav__link[data-section="content"]')).toHaveText('Content Reference');
    await expect(page.locator('a.admin-nav__link[data-section="media"]')).toHaveText('Media Reference');
    await expect(page.locator('a.admin-nav__link[data-section="access"]')).toHaveText('Access Reference');
    await expect(page.locator('.admin-nav__group-label')).toContainText([
      'Overview',
      'Users',
      'AI',
      'Finance',
      'Organization',
      'System',
      'Reference',
    ]);
    const missingInternalNavTargets = await page.locator('a.admin-nav__link[data-section]').evaluateAll((links) => links
      .filter((link) => (link.getAttribute('href') || '').startsWith('#'))
      .map((link) => link.dataset.section)
      .filter((section) => !document.getElementById(`section${section.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`)));
    expect(missingInternalNavTargets).toEqual([]);

    await expect(page.locator('#controlPlaneCapabilityGrid')).toContainText('Organizations / RBAC');
    await expect(page.locator('#controlPlaneCapabilityGrid')).toContainText('Billing / Credits');
    await expect(page.locator('#controlPlaneCapabilityGrid')).toContainText('AI Usage Attempts');
    await expect(page.locator('#controlPlaneCapabilityGrid')).toContainText('AI Budget Controls');
    await expect(page.locator('#controlPlaneCapabilityGrid')).toContainText('Tenant Asset Manual Review');
    await expect(page.getByRole('link', { name: 'Budget Controls' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tenant Assets' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Operations' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Content Reference' }).first()).toHaveAttribute('href', '#content');
    await expect(page.getByRole('link', { name: 'Media Reference' }).first()).toHaveAttribute('href', '#media');
    await expect(page.getByRole('link', { name: 'Access Reference' }).first()).toHaveAttribute('href', '#access');
    await expect(page.locator('#controlPlaneCapabilityGrid')).toContainText('Reference Views');
    await expect(page.locator('#controlPlaneCapabilityGrid')).toContainText('codebase-only context');
    await expect(page.locator('#adminPanel')).not.toContainText(/OMEGA|P0\/P1 Wave Matrix|P1 Wave|implementation package/);

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
    await expect(page.locator('#orgDetail')).toContainText('Organization user access');
    await expect(page.locator('#orgDetail')).toContainText('does not override tenant isolation, billing, AI budget safety, or Admin AI organization-context guards');
    const emptyAccessSwitch = page.getByRole('switch', { name: 'empty@example.com organization access for Control Plane Org' });
    await expect(emptyAccessSwitch).not.toBeChecked();
    await emptyAccessSwitch.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#orgDetail')).toContainText('empty@example.com assigned to Control Plane Org.');
    expect(captures.orgAccessRequests.at(-1)).toEqual(expect.objectContaining({
      method: 'PUT',
      userId: 'user_empty',
    }));
    expect(captures.orgAccessRequests.at(-1).idempotencyKey).toMatch(/^admin-org-assign-/);
    await expect(emptyAccessSwitch).toBeChecked();
    await emptyAccessSwitch.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#orgDetail')).toContainText('empty@example.com removed from Control Plane Org.');
    expect(captures.orgAccessRequests.at(-1)).toEqual(expect.objectContaining({
      method: 'DELETE',
      userId: 'user_empty',
    }));
    expect(captures.orgAccessRequests.at(-1).idempotencyKey).toMatch(/^admin-org-remove-/);
    await expect(emptyAccessSwitch).not.toBeChecked();
    const failingAccessSwitch = page.getByRole('switch', { name: 'error@example.com organization access for Control Plane Org' });
    await failingAccessSwitch.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#orgDetail')).toContainText('Backend dependency is unavailable or fail-closed.');
    await expect(failingAccessSwitch).not.toBeChecked();

    await clickAdminNavSection(page, 'billing');
    await expect(page.locator('#sectionBilling')).toContainText('Billing operator flow');
    await expect(page.locator('#sectionBilling')).toContainText('Manual grants are guarded');
    await expect(page.locator('#sectionBilling')).toContainText('generated Idempotency-Key');
    await expect(page.locator('#sectionBilling')).toContainText('Free');
    await expect(page.locator('#sectionBilling')).toContainText('ai.text.generate');
    await page.locator('#orgBillingSearch').fill('Control Plane Org');
    await page.locator('#orgBillingLookupForm').getByRole('button', { name: 'Find Billing' }).click();
    await expect(page.locator('#orgBillingDetail')).toContainText('Control Plane Org');
    await expect(page.locator('#orgBillingDetail')).toContainText('Credit balance');
    await expect(page.locator('#orgBillingDetail')).toContainText('125');
    await expect(page.locator('#orgBillingDetail')).not.toContainText('org_control_1234567890');

    await page.locator('#userBillingSearch').fill('member@example.com');
    await page.locator('#userBillingLookupForm').getByRole('button', { name: 'Find Billing' }).click();
    await expect(page.locator('#userBillingDetail')).toContainText('member@example.com');
    await expect(page.locator('#userBillingDetail')).toContainText('9');
    await expect(page.locator('#userBillingDetail')).not.toContainText('user_member');

    await page.locator('#creditGrantOrgSearch').fill('Control Plane Org');
    await page.locator('#creditGrantAmount').fill('50');
    await page.locator('#creditGrantForm').getByRole('button', { name: 'Grant Credits' }).click();
    expect(captures.creditGrantRequests).toHaveLength(0);

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#creditGrantReason').fill('Support adjustment for control-plane test');
    await page.locator('#creditGrantForm').getByRole('button', { name: 'Grant Credits' }).click();
    await expect(page.locator('#creditGrantResult')).toContainText('Credit grant recorded for Control Plane Org');
    expect(captures.creditGrantRequests).toHaveLength(1);
    expect(captures.creditGrantRequests[0].idempotencyKey).toMatch(/^admin-credit-grant-/);
    expect(captures.creditGrantRequests[0].body).toEqual({
      amount: 50,
      reason: 'Support adjustment for control-plane test',
    });

    await page.locator('#creditGrantUserSearch').fill('member@example.com');
    await page.locator('#userCreditGrantAmount').fill('25');
    await page.locator('#userCreditGrantForm').getByRole('button', { name: 'Grant User Credits' }).click();
    expect(captures.userCreditGrantRequests).toHaveLength(0);

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#userCreditGrantReason').fill('Member support adjustment for control-plane test');
    await page.locator('#userCreditGrantForm').getByRole('button', { name: 'Grant User Credits' }).click();
    await expect(page.locator('#userCreditGrantResult')).toContainText('User credit grant recorded for member@example.com');
    expect(captures.userCreditGrantRequests).toHaveLength(1);
    expect(captures.userCreditGrantRequests[0].idempotencyKey).toMatch(/^admin-user-credit-grant-/);
    expect(captures.userCreditGrantRequests[0].body).toEqual({
      amount: 25,
      reason: 'Member support adjustment for control-plane test',
    });

    await clickAdminNavSection(page, 'billing-events');
    await expect(page.locator('#sectionBillingEvents')).toContainText('Testmode only');
    await expect(page.locator('#sectionBillingEvents')).toContainText('Billing Evidence Center');
    await expect(page.locator('#billingEvidencePanel')).toContainText('Live Billing Readiness');
    await expect(page.locator('#billingEvidencePanel')).toContainText('BITBI Pro');
    await expect(page.locator('#billingEvidencePanel')).toContainText('Checkout creation does not grant credits');
    await expect(page.locator('#sectionBillingEvents')).toContainText('Billing Reconciliation');
    await expect(page.locator('#billingReconciliationPanel')).toContainText('Unresolved blocked billing review events exist.');
    await expect(page.locator('#sectionBillingEvents')).toContainText('Billing Review Queue');
    await expect(page.locator('#billingReviewsList')).toContainText('invoice.payment_failed');
    await expect(page.locator('#billingReviewsList')).toContainText('charge.dispute.created');
    await expect(page.locator('#billingEventsList')).toContainText('checkout.session.completed');
    await page.locator('#billingEventsList').getByRole('button', { name: 'Inspect' }).click();
    await expect(page.locator('#billingEventDetail')).toContainText('grant_credits');
    await expect(page.locator('#billingEventDetail')).not.toContainText('should-not-render');
    await expect(page.locator('#billingEventDetail')).not.toContainText('stripe_signature');
    await expect(page.locator('#billingEvidencePanel')).not.toContainText('sk_live_');
    await expect(page.locator('#billingEvidencePanel')).not.toContainText('whsec_');
    await expect(page.locator('#billingEvidencePanel')).not.toContainText('Stripe-Signature');

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

    await clickAdminNavSection(page, 'ai-budget-switches');
    const switchSection = page.locator('#sectionAiBudgetSwitches');
    await expect(switchSection).toContainText('AI Budget Switches');
    await expect(switchSection).toContainText('AI Budget Switches & Controls');
    await expect(switchSection).toContainText('Operator Control Map');
    await expect(switchSection).toContainText('Needs evidence');
    await expect(page.locator('.admin-control-panel-nav')).toContainText('Evidence Archives');
    await expect(switchSection).toContainText('Cloudflare master flag');
    await expect(switchSection).toContainText('Platform Budget Caps');
    await expect(switchSection).toContainText('not customer billing');
    await expect(switchSection).toContainText('No automatic repair');
    await expect(switchSection).toContainText('No Stripe action');
    await expect(page.locator('#aiBudgetSwitchesSummary')).toContainText('Cloudflare master flag enabled AND app switch enabled');
    await expect(page.locator('#aiBudgetSwitchesSummary')).toContainText('platform_admin_lab_budget_foundation');
    await expect(page.locator('#aiBudgetSwitchesList')).toContainText('Admin Text Budget');
    await expect(page.locator('#aiBudgetSwitchesList')).toContainText('Admin Live-Agent Budget');
    await expect(page.locator('#aiBudgetSwitchesList')).toContainText('missing');
    await expect(page.locator('#aiBudgetSwitchesList')).not.toContainText('sk_live_');
    await expect(page.locator('#platformBudgetCapsSummary')).toContainText('platform_admin_lab_budget');
    await expect(page.locator('#platformBudgetCapsList')).toContainText('daily');
    await expect(page.locator('#platformBudgetCapsList')).toContainText('admin.text.test');
    await expect(switchSection).toContainText('Budget Reconciliation');
    await expect(page.locator('#platformBudgetReconciliationSummary')).toContainText('needs_operator_review');
    await expect(page.locator('#platformBudgetReconciliationList')).toContainText('missing_admin_usage_event');
    await expect(page.locator('#platformBudgetReconciliationList')).toContainText('duplicate_attempt_usage_event');
    await expect(page.locator('#platformBudgetReconciliationList')).toContainText('Repairs are explicit and admin-approved only');
    await expect(page.locator('#platformBudgetReconciliationList')).toContainText('No provider, Stripe, credit, or customer billing action');
    await expect(page.locator('#platformBudgetReconciliationList').getByRole('button', { name: 'Dry Run' })).toHaveCount(1);
    await expect(page.locator('#platformBudgetReconciliationList').getByRole('button', { name: 'Apply Repair' })).toHaveCount(1);
    await expect(page.locator('#platformBudgetReconciliationList').getByRole('button', { name: 'Record Review' })).toHaveCount(1);
    await expect(page.locator('#platformBudgetReconciliationList').getByRole('button', { name: /delete|credit|stripe|provider|bulk/i })).toHaveCount(0);
    await expect(switchSection).toContainText('Repair Evidence Report');
    await expect(page.locator('#platformBudgetRepairReportSummary')).toContainText('Total repair actions');
    await expect(page.locator('#platformBudgetRepairReportSummary')).toContainText('3');
    await expect(page.locator('#platformBudgetRepairReportSummary')).toContainText('Automatic repair');
    await expect(page.locator('#platformBudgetRepairReportList')).toContainText('status:applied');
    await expect(page.locator('#platformBudgetRepairReportList')).toContainText('type:missing_admin_usage_event:create_missing_usage_event');
    await expect(page.locator('#platformBudgetRepairReportState')).toContainText('No repair is applied');
    await expect(page.locator('#platformBudgetRepairReportList')).toContainText('Reports and exports expose no raw prompts');
    await expect(page.locator('#platformBudgetRepairReportList')).not.toContainText('sk_live_');
    await expect(page.locator('#platformBudgetRepairReportList').getByRole('button', { name: /apply|delete|purge|credit|stripe|provider|bulk/i })).toHaveCount(0);
    const reportDownload = page.waitForEvent('download', { timeout: 3000 }).catch(() => null);
    await page.locator('#platformBudgetRepairReportExportJson').click();
    await expect.poll(() => captures.platformBudgetRepairReportExportRequests.length).toBe(1);
    expect(captures.platformBudgetRepairReportExportRequests[0].url).toContain('format=json');
    const downloadedReport = await reportDownload;
    if (downloadedReport) {
      await downloadedReport.cancel();
    }
    await expect(switchSection).toContainText('Evidence Archives');
    await expect(page.locator('#platformBudgetEvidenceArchivesSummary')).toContainText('AUDIT_ARCHIVE / platform-budget-evidence/');
    await expect(page.locator('#platformBudgetEvidenceArchivesList')).toContainText('pbea');
    await expect(page.locator('#platformBudgetEvidenceArchivesList')).toContainText('3 repairs; 1 usage events');
    await expect(page.locator('#platformBudgetEvidenceArchivesList')).toContainText('Archive metadata omits private R2 keys');
    await expect(page.locator('#platformBudgetEvidenceArchivesList')).not.toContainText('sk_live_');
    await expect(page.locator('#platformBudgetEvidenceArchivesList').getByRole('button', { name: /apply|repair|delete|credit|stripe|provider|cloudflare/i })).toHaveCount(0);
    await page.locator('#platformBudgetEvidenceArchiveReason').fill('Static evidence archive reason');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#platformBudgetEvidenceArchiveCreate').click();
    await expect.poll(() => captures.platformBudgetEvidenceArchiveCreateRequests.length).toBe(1);
    expect(captures.platformBudgetEvidenceArchiveCreateRequests[0].idempotencyKey).toMatch(/^platform-budget-evidence-archive-/);
    expect(captures.platformBudgetEvidenceArchiveCreateRequests[0].body).toMatchObject({
      budgetScope: 'platform_admin_lab_budget',
      format: 'json',
      archiveType: 'repair_report',
      reason: 'Static evidence archive reason',
    });
    const archiveDownload = page.waitForEvent('download', { timeout: 3000 }).catch(() => null);
    await page.locator('#platformBudgetEvidenceArchivesList').getByRole('button', { name: 'Download' }).first().click();
    await expect.poll(() => captures.platformBudgetEvidenceArchiveDownloadRequests.length).toBe(1);
    const downloadedArchive = await archiveDownload;
    if (downloadedArchive) {
      await downloadedArchive.cancel();
    }
    let repairDialogs = 0;
    const repairDialogHandler = (dialog) => {
      repairDialogs += 1;
      if (dialog.type() === 'prompt') {
        expect(dialog.message()).toContain('No provider, Stripe, credit, or source-row mutation');
        dialog.accept('Repair missing platform budget usage evidence for static test');
        return;
      }
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('No provider call, Stripe call, credit mutation, or source row update');
      dialog.accept();
    };
    page.on('dialog', repairDialogHandler);
    await page.locator('#platformBudgetReconciliationList').getByRole('button', { name: 'Apply Repair' }).click();
    page.off('dialog', repairDialogHandler);
    expect(repairDialogs).toBe(2);
    expect(captures.platformBudgetRepairRequests).toHaveLength(1);
    expect(captures.platformBudgetRepairRequests[0].idempotencyKey).toMatch(/^platform-budget-repair-/);
    expect(captures.platformBudgetRepairRequests[0].body).toEqual({
      budgetScope: 'platform_admin_lab_budget',
      candidateId: 'pbr_missing_admin_usage_event_att_static_1',
      candidateType: 'missing_admin_usage_event',
      requestedAction: 'create_missing_usage_event',
      dryRun: false,
      confirm: true,
      reason: 'Repair missing platform budget usage evidence for static test',
    });
    let budgetSwitchDialogs = 0;
    const budgetSwitchDialogHandler = (dialog) => {
      budgetSwitchDialogs += 1;
      if (dialog.type() === 'prompt') {
        expect(dialog.message()).toContain('Cloudflare master flag');
        dialog.accept('Enable admin text switch for static test');
        return;
      }
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('does not change Cloudflare variables');
      dialog.accept();
    };
    page.on('dialog', budgetSwitchDialogHandler);
    await page.locator('#aiBudgetSwitchesList').getByRole('button', { name: 'Enable' }).first().click();
    page.off('dialog', budgetSwitchDialogHandler);
    await expect(page.locator('#aiBudgetSwitchesState')).toContainText('Showing 2 allowed switches');
    expect(budgetSwitchDialogs).toBe(2);
    expect(captures.aiBudgetSwitchUpdateRequests).toHaveLength(1);
    expect(captures.aiBudgetSwitchUpdateRequests[0].switchKey).toBe('ENABLE_ADMIN_AI_TEXT_BUDGET');
    expect(captures.aiBudgetSwitchUpdateRequests[0].idempotencyKey).toMatch(/^ai-budget-switch-/);
    expect(captures.aiBudgetSwitchUpdateRequests[0].body).toEqual({
      enabled: true,
      reason: 'Enable admin text switch for static test',
    });

    let capDialogs = 0;
    const capDialogHandler = (dialog) => {
      capDialogs += 1;
      if (capDialogs === 1) {
        expect(dialog.message()).toContain('daily cap units');
        dialog.accept('125');
        return;
      }
      if (capDialogs === 2) {
        expect(dialog.message()).toContain('operator reason');
        dialog.accept('Raise daily platform admin lab cap for static test');
        return;
      }
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('does not change Stripe, Cloudflare, or customer billing');
      dialog.accept();
    };
    page.on('dialog', capDialogHandler);
    await page.locator('#platformBudgetCapsList').getByRole('button', { name: 'Update' }).first().click();
    page.off('dialog', capDialogHandler);
    expect(capDialogs).toBe(3);
    expect(captures.platformBudgetCapUpdateRequests).toHaveLength(1);
    expect(captures.platformBudgetCapUpdateRequests[0].budgetScope).toBe('platform_admin_lab_budget');
    expect(captures.platformBudgetCapUpdateRequests[0].idempotencyKey).toMatch(/^platform-budget-cap-/);
    expect(captures.platformBudgetCapUpdateRequests[0].body).toEqual({
      window_type: 'daily',
      limit_units: 125,
      reason: 'Raise daily platform admin lab cap for static test',
    });

    await clickAdminNavSection(page, 'lifecycle');
    await expect(page.locator('#sectionLifecycle')).toContainText('Privacy operations');
    await expect(page.locator('#sectionLifecycle')).toContainText('Next Safe Action');
    await expect(page.locator('#sectionLifecycle')).toContainText('No blanket completion');
    await expect(page.locator('#sectionLifecycle')).toContainText('archive_generated');
    await expect(page.locator('#sectionLifecycle')).toContainText('execute-only rather than dry-run');
    await expect(page.locator('#sectionLifecycle').getByRole('button', { name: /delete|execute/i })).toHaveCount(0);

    await clickAdminNavSection(page, 'operations');
    await expect(page.locator('#sectionOperations')).toContainText('Operator triage');
    await expect(page.locator('#sectionOperations')).toContainText('Next Safe Action');
    await expect(page.locator('#sectionOperations')).toContainText('Manual review is not backfill');
    await expect(page.locator('#sectionOperations')).toContainText('Operator Timeline / Triage');
    await expect(page.locator('#operatorTimelineState')).toContainText('Read-only redacted operator timeline');
    await expect(page.locator('#operatorTimelineSummary')).toContainText('metadata only no r2 listing');
    await expect(page.locator('#operatorTimelineList')).toContainText('Billing event: invoice.payment_failed');
    await expect(page.locator('#operatorTimelineList')).toContainText('Tenant review: public unsafe');
    await expect(page.locator('#operatorTimelineList')).toContainText('Live billing readiness remains blocked');
    await expect(page.locator('#operatorTimelineList')).toContainText('Open Billing Reviews');
    await expect(page.locator('#operatorTimelineList')).toContainText('Open AI Budget Evidence');
    await expect(page.locator('#operatorTimelineList')).not.toContainText('sk_live_');
    await expect(page.locator('#operatorTimelineList')).not.toContainText('Stripe-Signature');
    await expect(page.locator('#operatorTimelineFilter')).toContainText('Source');
    await expect(page.locator('#operatorTimelineFilter')).toContainText('Severity');
    await expect(page.locator('#operatorTimelineFilter')).toContainText('Attention');
    await page.locator('#operatorTimelineSourceFilter').selectOption('billing');
    await page.locator('#operatorTimelineSeverityFilter').selectOption('high');
    await page.locator('#operatorTimelineFilter').getByRole('button', { name: 'Apply Filters' }).click();
    await expect.poll(() => captures.operatorTimelineRequests?.some((query) => query.includes('source=billing') && query.includes('severity=high'))).toBe(true);
    await expect(page.locator('#sectionOperations')).toContainText('max_attempts');
    await expect(page.locator('#sectionOperations')).toContainText('provider_failed');
    await expect(page.locator('#sectionOperations')).toContainText('Tenant Asset Manual Review Queue');
    await expect(page.locator('#tenantReviewSummary')).toContainText('Access switch blocked');
    await expect(page.locator('#tenantReviewSummary')).toContainText('Backfill blocked');
    await expect(page.locator('#tenantReviewSummary')).toContainText('Review-state only');
    await expect(page.locator('#sectionOperations')).toContainText('Tenant review workflow');
    await expect(page.locator('#sectionOperations')).toContainText('Dry-run first');
    await expect(page.locator('#sectionOperations')).toContainText('No asset deletion');
    await expect(page.locator('#tenantReviewPostCleanupBanner')).toContainText('Post-cleanup evidence collected');
    await expect(page.locator('#tenantReviewPostCleanupBanner')).toContainText('Review queue still contains pre-cleanup rows');
    await expect(page.locator('#tenantReviewPostCleanupSummary')).toContainText('Active current');
    await expect(page.locator('#tenantReviewPostCleanupSummary')).toContainText('Superseded candidates');
    await expect(page.locator('#tenantReviewPostCleanupSummary')).toContainText('Still blocked');
    await expect(page.locator('#tenantReviewPostCleanupSummary')).toContainText('Still pending manual review');
    await expect(page.locator('#tenantReviewPostCleanupSummary')).toContainText('Deferred');
    await expect(page.locator('#tenantReviewPostCleanupSummary')).toContainText('Unknown/manual review required');
    await expect(page.getByRole('button', { name: 'Run post-cleanup supersession dry-run' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export supersession evidence JSON' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export supersession evidence Markdown' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export supersession evidence HTML/PDF-friendly' })).toBeVisible();
    await page.getByRole('button', { name: 'Supersede stale review items warning' }).click();
    await expect(page.locator('#tenantReviewSupersedeState')).toContainText('This does not delete assets');
    await expect(page.getByRole('button', { name: 'Supersede stale review items', exact: true })).toBeDisabled();
    await page.locator('#tenantReviewSupersedeConfirmation').fill('SUPERSEDE STALE REVIEW ITEMS');
    await expect(page.getByRole('button', { name: 'Supersede stale review items', exact: true })).toBeDisabled();
    await page.locator('#tenantReviewSupersedeReason').fill('Static post-cleanup supersession evidence dry-run');
    await expect(page.getByRole('button', { name: 'Supersede stale review items', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Supersede stale review items', exact: true }).click();
    await expect.poll(() => captures.tenantReviewPostCleanupSupersedeRequests.length).toBe(1);
    expect(captures.tenantReviewPostCleanupSupersedeRequests[0].idempotencyKey).toMatch(/^tenant-review-supersede-/);
    expect(captures.tenantReviewPostCleanupSupersedeRequests[0].body).toMatchObject({
      dryRun: true,
      confirm: true,
      confirmation: 'SUPERSEDE STALE REVIEW ITEMS',
      reason: 'Static post-cleanup supersession evidence dry-run',
      batchLimit: 25,
    });
    await expect(page.locator('#tenantReviewSupersedeState')).toContainText('Supersession executor dry-run completed');
    await expect(page.locator('#tenantReviewList')).toContainText('metadata missing');
    await expect(page.locator('#tenantReviewList')).toContainText('public unsafe');
    await expect(page.locator('#tenantReviewList')).toContainText('derivative risk');
    await expect(page.locator('#tenantReviewDetail')).toContainText('Review Status Update');
    await expect(page.locator('#tenantReviewDetail')).not.toContainText('should-not-render');
    await expect(page.locator('#sectionOperations').getByRole('button', { name: /backfill|access switch|r2|delete|provider|stripe|credit/i })).toHaveCount(0);
    const tenantEvidenceDownload = page.waitForEvent('download', { timeout: 3000 }).catch(() => null);
    await page.locator('#tenantReviewExportJson').click();
    await expect.poll(() => captures.tenantReviewEvidenceExportRequests.length).toBe(1);
    const downloadedTenantEvidence = await tenantEvidenceDownload;
    if (downloadedTenantEvidence) {
      await downloadedTenantEvidence.cancel();
    }
    await page.locator('#tenantReviewStatusReason').fill('Move metadata-missing item into review for static test');
    await page.locator('#tenantReviewStatusConfirm').check();
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('does not backfill ownership');
      dialog.accept();
    });
    await page.locator('#tenantReviewStatusForm').getByRole('button', { name: 'Update Review Status' }).click();
    await expect(page.locator('#tenantReviewState')).toContainText('Manual-review status updated');
    expect(captures.tenantReviewStatusUpdateRequests).toHaveLength(1);
    expect(captures.tenantReviewStatusUpdateRequests[0].idempotencyKey).toMatch(/^tenant-review-status-/);
    expect(captures.tenantReviewStatusUpdateRequests[0].body).toMatchObject({
      newStatus: 'review_in_progress',
      reason: 'Move metadata-missing item into review for static test',
      confirm: true,
      metadata: {
        source: 'admin_control_plane',
        phase: '6.18',
      },
    });
    await expect(page.locator('#tenantReviewSummary')).toContainText('Status changes');
    await expect(page.locator('#tenantReviewDetail')).toContainText('review in progress');

    await clickAdminNavSection(page, 'tenant-assets');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Tenant Asset Center');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Tenant Asset Domain Matrix');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Next Safe Action');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Review D1 metadata evidence and manual-review dry-runs first');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Do not execute tenant changes here');
    await expect(page.locator('#sectionTenantAssets')).toContainText('AI folders');
    await expect(page.locator('#sectionTenantAssets')).toContainText('AI text assets');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Public gallery references: Memtracks');
    await expect(page.locator('#sectionTenantAssets')).toContainText('R2 USER_IMAGES object family');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Ownership backfill');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Access switch');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Confirmed legacy reset');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Live R2 listing/deletion');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Reconciliation dry-run');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Tenant Isolation Execution');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Dangerous operations');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Post-cleanup evidence pending');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Old owner-map, manual-review, and reset counts are stale after manual media cleanup');
    await expect(page.locator('#sectionTenantAssets')).toContainText('No production readiness claim');
    await expect(page.locator('#sectionTenantAssets')).toContainText('Tenant isolation not claimed');
    await page.getByRole('button', { name: 'Ownership Backfill danger explanation' }).click();
    let dangerDialog = page.getByRole('dialog', { name: /Ownership Backfill danger explanation/i });
    await expect(dangerDialog).toContainText('What changes');
    await expect(dangerDialog).toContainText('BACKFILL OWNERSHIP');
    await expect(dangerDialog).toContainText('Affected domains');
    await dangerDialog.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Runtime Access-Switch danger explanation' }).click();
    dangerDialog = page.getByRole('dialog', { name: /Runtime Access-Switch danger explanation/i });
    await expect(dangerDialog).toContainText('which ownership signal runtime reads use');
    await expect(dangerDialog).toContainText('ENABLE ACCESS SWITCH');
    await dangerDialog.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Legacy Media Reset danger explanation' }).click();
    dangerDialog = page.getByRole('dialog', { name: /Legacy Media Reset danger explanation/i });
    await expect(dangerDialog).toContainText('CONFIRMED LEGACY MEDIA RESET');
    await expect(dangerDialog).toContainText('retire public references');
    await dangerDialog.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Run Backfill Dry-run' }).click();
    await expect(page.locator('#tenantIsolationBackfillState')).toContainText('Post-cleanup dry-run loaded');
    await expect(page.locator('#sectionTenantAssets')).toContainText('post cleanup evidence collected');
    await expect(page.locator('#sectionTenantAssets')).toContainText('safe to backfill');
    await expect(page.locator('#tenantBackfillExactCandidate')).toContainText('Exact candidate asset ID');
    await expect(page.locator('#tenantBackfillExactCandidate')).toContainText('image-private');
    await expect(page.getByRole('button', { name: 'Write Safe Ownership Metadata' })).toBeDisabled();
    await page.locator('#tenantBackfillReason').fill('Static tenant isolation backfill evidence test');
    await page.locator('#tenantBackfillConfirmation').fill('BACKFILL OWNERSHIP');
    await page.getByRole('button', { name: 'Execute Endpoint Dry-run' }).click();
    await expect.poll(() => captures.tenantBackfillExecuteRequests.length).toBe(1);
    expect(captures.tenantBackfillExecuteRequests[0].idempotencyKey).toMatch(/^tenant-ownership-backfill-/);
    expect(captures.tenantBackfillExecuteRequests[0].body).toEqual({
      dryRun: true,
      confirm: true,
      confirmation: 'BACKFILL OWNERSHIP',
      reason: 'Static tenant isolation backfill evidence test',
      domains: ['ai_images'],
      batchLimit: 1,
      candidateAssetIds: ['image-private'],
    });
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('image-private');
      expect(dialog.message()).toContain('does not switch access checks');
      dialog.accept();
    });
    await page.getByRole('button', { name: 'Write Safe Ownership Metadata' }).click();
    await expect.poll(() => captures.tenantBackfillExecuteRequests.length).toBe(2);
    expect(captures.tenantBackfillExecuteRequests[1].body.dryRun).toBe(false);
    expect(captures.tenantBackfillExecuteRequests[1].body.domains).toEqual(['ai_images']);
    expect(captures.tenantBackfillExecuteRequests[1].body.domains).not.toContain('ai_folders');
    expect(captures.tenantBackfillExecuteRequests[1].body.batchLimit).toBe(1);
    expect(captures.tenantBackfillExecuteRequests[1].body.candidateAssetIds).toEqual(['image-private']);
    await page.getByRole('button', { name: 'Run Shadow Diagnostics' }).click();
    await expect(page.locator('#tenantIsolationAccessState')).toContainText('Post-cleanup shadow diagnostics completed');
    await expect(page.getByRole('button', { name: 'Enable Enforced Access-Switch' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Confirmed Execute Reset' })).toBeDisabled();
    await expect(page.locator('#tenantIsolationResetState')).toContainText('Post-cleanup sanitized evidence remains pending');
    await expect(page.locator('#sectionTenantAssets')).toContainText('gate disabled');
    await page.getByRole('button', { name: 'Export Combined Markdown' }).click();
    await expect.poll(() => captures.tenantIsolationEvidenceExportRequests.some((entry) => entry.url.includes('tenant-isolation/evidence') && entry.url.includes('format=markdown'))).toBe(true);
    await expect(page.locator('#sectionTenantAssets').getByRole('button', { name: /list live r2|delete live|enable live billing|deploy|remote migration/i })).toHaveCount(0);
    expect(captures.tenantAssetDomainEvidenceRequests).toHaveLength(1);

    await clickAdminNavSection(page, 'readiness');
    await expect(page.locator('#sectionReadiness')).toContainText('Readiness & Evidence Dashboard');
    await expect(page.locator('#sectionReadiness')).toContainText('Release evidence workflow');
    await expect(page.locator('#sectionReadiness')).toContainText('Next Safe Action');
    await expect(page.locator('#sectionReadiness')).toContainText('Keep claims blocked');
    await expect(page.locator('#sectionReadiness')).toContainText(CURRENT_AUTH_MIGRATION);
    await expect(page.locator('#sectionReadiness')).toContainText('Production readiness');
    await expect(page.locator('#sectionReadiness')).toContainText('Confirmed legacy media reset readiness');
    await expect(page.locator('#sectionReadiness')).toContainText('Admin, data, observability, and scale hardening');
    await expect(page.locator('#sectionReadiness')).toContainText('ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION');
    await expect(page.locator('#sectionReadiness')).toContainText('Legacy reset sanitized dry-run evidence');
    await expect(page.locator('#sectionReadiness')).toContainText('Command Center');
    await expect(page.locator('#sectionReadiness').getByRole('button', { name: /enable legacy reset|confirmed reset|ownership backfill|access-switch|live billing enablement/i })).toHaveCount(0);

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

  test('Tenant ownership backfill execution stays disabled without one exact ai_images candidate', async ({
    page,
  }) => {
    const captures = {
      tenantBackfillDryRunReport: {
        reportVersion: 'tenant-isolation-ownership-backfill-v1',
        generatedAt: '2026-05-19T12:10:00.000Z',
        source: 'local_d1_read_only',
        productionReadiness: 'blocked',
        tenantIsolationClaimed: false,
        ownershipBackfillReadiness: 'blocked_until_operator_evidence_review',
        backfillPerformed: false,
        d1Mutated: false,
        r2LiveListed: false,
        r2ObjectsMutated: false,
        postCleanupRebaseline: {
          status: 'post_cleanup_evidence_collected',
          oldCountsSuperseded: true,
          liveEvidenceRequired: false,
        },
        requiredExecutionConfirmation: 'BACKFILL OWNERSHIP',
        summary: {
          totalCandidates: 2,
          safeCandidates: 1,
          classifications: {
            safe_to_backfill: 1,
            needs_manual_review: 0,
            blocked_public_unsafe: 1,
            blocked_missing_evidence: 0,
            already_owned: 0,
          },
        },
        candidates: [
          { domain: 'ai_folders', assetId: 'folder-only', classification: 'safe_to_backfill', reason: 'folder_candidate_is_not_current_exact_evidence' },
          { domain: 'ai_images', assetId: 'image-public', classification: 'blocked_public_unsafe', reason: 'public_gallery_reference_requires_review' },
        ],
        warnings: ['Dry-run only: no ownership metadata was written.'],
      },
    };
    await mockAdminControlPlane(page, captures);

    const response = await page.goto('/admin/index.html#tenant-assets');
    expect(response.status()).toBe(200);
    await expect(page.locator('#sectionTenantAssets')).toBeVisible();
    await page.getByRole('button', { name: 'Run Backfill Dry-run' }).click();
    await expect(page.locator('#tenantBackfillExactCandidate')).toContainText('No exact safe ai_images candidate ID is available');
    await expect(page.getByRole('button', { name: 'Execute Endpoint Dry-run' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Write Safe Ownership Metadata' })).toBeDisabled();

    await page.locator('#tenantBackfillReason').fill('Static blocked exact-candidate test');
    await page.locator('#tenantBackfillConfirmation').fill('BACKFILL OWNERSHIP');
    await expect(page.getByRole('button', { name: 'Execute Endpoint Dry-run' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Write Safe Ownership Metadata' })).toBeDisabled();
    expect(captures.tenantBackfillExecuteRequests).toHaveLength(0);
  });

  test('Tenant danger explanation modal traps focus and returns to the invoker', async ({
    page,
  }) => {
    await mockAdminControlPlane(page, {});

    const response = await page.goto('/admin/index.html#tenant-assets');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sectionTenantAssets')).toBeVisible();

    const dangerButton = page.getByRole('button', { name: 'Ownership Backfill danger explanation' });
    await dangerButton.click();
    const dialog = page.getByRole('dialog', { name: /Ownership Backfill danger explanation/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(dangerButton).toBeFocused();
  });

  test('Admin router preserves cold deep links, hero metadata, and Workbench navigation', async ({
    page,
  }) => {
    const captures = {};
    await mockAdminControlPlane(page, captures);

    const response = await page.goto('/admin/index.html#readiness');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sectionReadiness')).toBeVisible();
    await expect(page.locator('#adminHeroTitle')).toHaveText('Readiness');
    await expect(page.locator('#adminHeroDesc')).toHaveText('Release, migration, Cloudflare, and staging verification checklist');

    await page.goto('/admin/index.html#tenant-assets');
    await expect(page.locator('#sectionTenantAssets')).toBeVisible();
    await expect(page.locator('#adminHeroTitle')).toHaveText('Tenant Assets');
    await expect(page.locator('#adminHeroDesc')).toHaveText('Cross-domain ownership inventory, evidence gaps, and storage safety');

    await page.goto('/admin/index.html#users');
    await expect(page.locator('#sectionUsers')).toBeVisible();
    await expect(page.locator('#adminHeroTitle')).toHaveText('User Management');

    await page.goto('/admin/index.html#activity');
    await expect(page.locator('#sectionActivity')).toBeVisible();
    await expect(page.locator('#adminHeroTitle')).toHaveText('Activity');

    await page.goto('/admin/index.html#settings');
    await expect(page.locator('#sectionSettings')).toBeVisible();
    await expect(page.locator('#adminHeroTitle')).toHaveText('Admin Settings');

    await page.goto('/admin/index.html#content');
    await expect(page.locator('#sectionContent')).toBeVisible();
    await expect(page.locator('#adminHeroTitle')).toHaveText('Content Reference');

    await page.goto('/admin/index.html#media');
    await expect(page.locator('#sectionMedia')).toBeVisible();
    await expect(page.locator('#adminHeroTitle')).toHaveText('Media Reference');

    await page.goto('/admin/index.html#access');
    await expect(page.locator('#sectionAccess')).toBeVisible();
    await expect(page.locator('#adminHeroTitle')).toHaveText('Access Reference');

    await page.goto('/admin/index.html#dashboard');
    await expect(page.locator('#sectionDashboard')).toBeVisible();
    await page.locator('#adminWorkbench').getByRole('link', { name: 'Open Release & Deploy Safety' }).click();
    await expect(page).toHaveURL(/#readiness$/);
    await expect(page.locator('#sectionReadiness')).toBeVisible();
    await expect(page.locator('#adminHeroTitle')).toHaveText('Readiness');

    await clickAdminNavSection(page, 'dashboard');
    await expect(page.locator('#sectionDashboard')).toBeVisible();
    await page.locator('#adminWorkbench').getByRole('link', { name: 'Open Tenant Asset Safety' }).click();
    await expect(page).toHaveURL(/#tenant-assets$/);
    await expect(page.locator('#sectionTenantAssets')).toBeVisible();
    await expect(page.locator('#adminHeroTitle')).toHaveText('Tenant Assets');

    await clickAdminNavSection(page, 'dashboard');
    await page.locator('#adminWorkbench').getByRole('link', { name: 'Open Reference Views' }).click();
    await expect(page).toHaveURL(/#content$/);
    await expect(page.locator('#sectionContent')).toBeVisible();
    await expect(page.locator('#adminHeroTitle')).toHaveText('Content Reference');

    await clickAdminNavSection(page, 'dashboard');
    await page.getByRole('link', { name: 'Media Reference' }).first().click();
    await expect(page).toHaveURL(/#media$/);
    await expect(page.locator('#sectionMedia')).toBeVisible();
  });

  test('Activity module keeps admin and user logs searchable, expandable, and paginated', async ({
    page,
  }) => {
    const captures = {};
    await mockAdminControlPlane(page, captures);

    const response = await page.goto('/admin/index.html#activity');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sectionActivity')).toBeVisible();

    await expect(page.locator('.admin-activity-mode')).toHaveText(['Admin Logs', 'User Logs']);
    await expect(page.locator('#activityTitle')).toHaveText('Admin Audit Log');
    await expect(page.locator('#activitySearch')).toBeVisible();
    await expect(page.locator('#activityTbody tr')).toHaveCount(10);
    await expect(page.locator('#activityTbodyMore tr')).toHaveCount(2);
    await expect(page.locator('#activityExpand')).toBeVisible();
    await expect(page.locator('#activityExpandLabel')).toContainText('Show 2 more entries');
    await expect(page.locator('#activityLoadMoreBtn')).toBeVisible();
    await expect(page.locator('#activitySummary')).toContainText('Role changes');
    await expect(page.locator('#securitySummary')).toContainText('Sessions revoked');

    await page.locator('#activityExpandBtn').click();
    await expect(page.locator('#activityExpandBtn')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#activityExpandLabel')).toHaveText('Hide older entries');
    await page.locator('#activityLoadMoreBtn').click();
    await expect.poll(() => captures.adminActivityRequests.some((query) => query.includes('cursor=admin-page-2'))).toBe(true);
    await expect(page.locator('#activityTbodyMore tr')).toHaveCount(3);

    await page.locator('#activitySearch').fill('member');
    await expect.poll(() => captures.adminActivityRequests.some((query) => query.includes('search=member'))).toBe(true);

    await page.getByRole('button', { name: 'User Logs' }).click();
    await expect(page.locator('#activityTitle')).toHaveText('User Activity Log');
    await expect(page.locator('#activityThead th')).toHaveText(['Time', 'User', 'Event', 'Details']);
    await expect(page.locator('#activitySummaryArea')).toBeHidden();
    await expect(page.locator('#activityTbody')).toContainText('member@example.com');
    await expect.poll(() => captures.userActivityRequests.length).toBeGreaterThan(0);
  });

  test('Reference views remain read-only codebase references for content, media, and access', async ({
    page,
  }) => {
    const captures = {};
    await mockAdminControlPlane(page, captures);

    const response = await page.goto('/admin/index.html#content');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sectionContent')).toBeVisible();
    await expect(page.locator('#sectionContent')).toContainText(/Reference view.*reflects codebase definitions, not live system queries/);
    await expect(page.locator('#contentGallery')).toContainText('items total');
    await expect(page.locator('#contentSoundlab')).toContainText('Sound Lab Explore reads public music from Memtracks.');

    await page.goto('/admin/index.html#media');
    await expect(page.locator('#sectionMedia')).toBeVisible();
    await expect(page.locator('#sectionMedia')).toContainText(/Reference view.*reflects codebase definitions, not live system queries/);
    await expect(page.locator('#mediaGallery')).toContainText('Public items');
    await expect(page.locator('#mediaAudio')).toContainText('Legacy bundled Free tracks are removed from the active Sound Lab UI.');

    await page.goto('/admin/index.html#access');
    await expect(page.locator('#sectionAccess')).toBeVisible();
    await expect(page.locator('#sectionAccess')).toContainText(/Reference view.*reflects codebase definitions, not live system queries/);
    await expect(page.locator('#accessGating')).toContainText('Sound Lab category gates');
    await expect(page.locator('#accessRoles')).toContainText('Admin');
    await expect(page.locator('#accessMap')).toContainText('Assets Manager');
  });

  test('Avatar dropdown and lightbox remain isolated from user management behavior', async ({
    page,
  }) => {
    const captures = {};
    await mockAdminControlPlane(page, captures);

    const response = await page.goto('/admin/index.html#users');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sectionUsers')).toBeVisible();

    await page.locator('#avatarToggle').click();
    await expect(page.locator('#avatarDropdown')).toHaveClass(/admin-avatars--open/);
    await expect.poll(() => captures.latestAvatarRequests.length).toBe(1);
    await expect(page.locator('#avatarGrid .admin-avatars__item')).toHaveCount(1);

    const avatarItem = page.locator('#avatarGrid .admin-avatars__item').first();
    await avatarItem.click();
    await expect(page.locator('#avatarLightbox')).toHaveClass(/admin-lightbox--visible/);
    await expect(page.locator('#lightboxName')).toHaveText('Member Example');
    await expect(page.locator('#lightboxEmail')).toHaveText('member@example.com');
    await expect(page.locator('#avatarLightboxClose')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#avatarLightboxClose')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#avatarLightbox')).not.toHaveClass(/admin-lightbox--visible/);
    await expect(avatarItem).toBeFocused();
  });

  test('Data Lifecycle request detail overlay supports guarded workflow actions and evidence export', async ({
    page,
  }) => {
    const captures = {};
    await mockAdminControlPlane(page, captures);

    const response = await page.goto('/admin/index.html#lifecycle');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sectionLifecycle')).toBeVisible();

    const deleteRow = page.locator('#lifecycleRequests tr', { hasText: 'delete' }).first();
    await expect(deleteRow).toContainText('submitted');
    const lifecycleOpenButton = deleteRow.getByRole('button', { name: 'Open' });
    await lifecycleOpenButton.click();

    const dialog = page.getByRole('dialog', { name: 'Data Lifecycle Request Detail' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.admin-lifecycle-detail__header').getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await expect(dialog).toContainText('Subject Snapshot');
    await expect(dialog).toContainText('Current Lifecycle State');
    await expect(dialog).toContainText('Generate Plan');
    await expect(dialog).toContainText('Approval');
    await expect(dialog).toContainText('Execute Safe');
    await expect(dialog).toContainText('Completion / Legal Outcome');
    await expect(dialog).toContainText('Reject / Close');
    await expect(dialog).toContainText('Export Evidence');
    await expect(dialog).toContainText('Category Matrix');
    await expect(dialog).toContainText('no legal completion claim');
    await expect(dialog.getByRole('button', { name: 'Mark Completed' })).toBeDisabled();
    const rejectClosePanel = dialog.locator('.admin-lifecycle-detail__panel', { hasText: 'Reject / Close' });
    await expect(rejectClosePanel.getByRole('button', { name: 'Reject' })).toBeEnabled();
    await expect(rejectClosePanel.getByRole('button', { name: 'Close' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Execute Safe', exact: true })).toBeDisabled();
    const reasonBlock = dialog.locator('.admin-lifecycle-text-block', { hasText: 'Reason' }).first();
    await expect(reasonBlock).toBeVisible();
    await expect(reasonBlock).toContainText('readable block');
    await expect.poll(async () => {
      const box = await reasonBlock.boundingBox();
      return Math.round(box?.width || 0);
    }).toBeGreaterThan(260);

    await dialog.getByRole('button', { name: 'Generate Plan' }).click();
    await expect.poll(() => captures.lifecyclePlanRequests.length).toBe(1);
    await expect(dialog).toContainText('Retained policy categories');
    await expect(dialog).toContainText('admin_audit_log');
    await expect(dialog.getByRole('button', { name: 'Approve' })).toBeEnabled();

    await dialog.getByRole('button', { name: 'Approve' }).click();
    await expect(dialog.locator('.admin-state')).toContainText('Approval acknowledgement is required.');
    await dialog.getByLabel(/approval does not complete legal\/GDPR erasure/i).check();
    await dialog.getByPlaceholder('Approval note / review reason').fill('Reviewed plan for static lifecycle overlay test');
    await dialog.getByRole('button', { name: 'Approve' }).click();
    await expect.poll(() => captures.lifecycleApproveRequests.length).toBe(1);
    expect(captures.lifecycleApproveRequests[0].body).toMatchObject({
      confirm: true,
      reason: 'Reviewed plan for static lifecycle overlay test',
    });
    expect(captures.lifecycleApproveRequests[0].idempotencyKey).toMatch(/^data-lifecycle-approve-/);

    await dialog.getByRole('button', { name: 'Execute Safe Dry-run' }).click();
    await expect.poll(() => captures.lifecycleExecuteSafeRequests.length).toBe(1);
    expect(captures.lifecycleExecuteSafeRequests[0].body).toMatchObject({ dryRun: true });
    await dialog.getByLabel(/safe execution is limited/i).check();
    await dialog.getByRole('button', { name: 'Execute Safe', exact: true }).click();
    await expect.poll(() => captures.lifecycleExecuteSafeRequests.length).toBe(2);
    expect(captures.lifecycleExecuteSafeRequests[1].body).toMatchObject({ dryRun: false, confirm: true });
    expect(captures.lifecycleExecuteSafeRequests[1].idempotencyKey).toMatch(/^data-lifecycle-execute-safe-/);
    await expect(dialog.getByRole('button', { name: 'Mark Completed' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Mark Completed' }).click();
    await expect(dialog.locator('.admin-state')).toContainText('Completion acknowledgement is required.');
    await dialog.getByLabel(/final evidence marker/i).check();
    await dialog.getByPlaceholder('Completion note / evidence review summary').fill('Evidence reviewed; retained categories remain under policy.');
    await dialog.getByRole('button', { name: 'Mark Completed' }).click();
    await expect.poll(() => captures.lifecycleCompleteRequests.length).toBe(1);
    expect(captures.lifecycleCompleteRequests[0].body).toMatchObject({
      confirm: true,
      completionNote: 'Evidence reviewed; retained categories remain under policy.',
    });
    expect(captures.lifecycleCompleteRequests[0].idempotencyKey).toMatch(/^data-lifecycle-complete-/);
    await expect(dialog).toContainText('completed with retention');
    await expect(dialog.locator('.admin-lifecycle-detail__panel', { hasText: 'Reject / Close' }).getByRole('button', { name: 'Reject' })).toBeDisabled();
    await expect(dialog.locator('.admin-lifecycle-detail__panel', { hasText: 'Reject / Close' }).getByRole('button', { name: 'Close' })).toBeDisabled();

    const jsonDownload = page.waitForEvent('download', { timeout: 3000 }).catch(() => null);
    await dialog.getByRole('button', { name: 'Export Evidence JSON' }).click();
    await expect.poll(() => captures.lifecycleEvidenceRequests.some((entry) => entry.format === 'json')).toBe(true);
    const downloadedJson = await jsonDownload;
    if (downloadedJson) {
      await downloadedJson.cancel();
    }

    await dialog.getByRole('button', { name: 'Export Evidence Markdown' }).click();
    await expect.poll(() => captures.lifecycleEvidenceRequests.some((entry) => entry.format === 'markdown')).toBe(true);
    await dialog.getByRole('button', { name: 'Open PDF-friendly HTML' }).click();
    await expect.poll(() => captures.lifecycleEvidenceRequests.some((entry) => entry.format === 'html')).toBe(true);

    await dialog.locator('.admin-lifecycle-detail__header').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(lifecycleOpenButton).toBeFocused();
    await expect(page.locator('a[href*="/de/admin"]')).toHaveCount(0);
  });

  test('budget control aliases expose operator panels and keyboard help without replacing grouped nav', async ({
    page,
  }) => {
    await mockAdminControlPlane(page, {});

    const response = await page.goto('/admin/index.html#platform-budget-caps');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    const aiBudgetLink = page.locator('a.admin-nav__link[data-section="ai-budget-switches"]');
    const aiGroup = page.locator('.admin-nav__group:has(a[data-section="ai-budget-switches"])');
    await expect(aiBudgetLink).toHaveClass(/admin-nav__link--active/);
    await expect(aiGroup).toHaveClass(/admin-nav__group--active/);
    await expect(aiGroup).toHaveClass(/admin-nav__group--expanded/);
    await expect(page.locator('#sectionAiBudgetSwitches')).toBeVisible();
    await expect(page.locator('#sectionAiBudgetSwitches')).toContainText('AI cost controls');
    await expect(page.locator('#sectionAiBudgetSwitches')).toContainText('Next Safe Action');
    await expect(page.locator('#sectionAiBudgetSwitches')).toContainText('Switch and archive writes are guarded');
    await expect(page.locator('#platformBudgetCapsPanel')).toBeVisible();
    await expect(page.locator('#platformBudgetCapsPanel')).toContainText('not customer billing');
    await expect(page.locator('#platformBudgetCapsPanel')).toContainText('Cap required');

    await page.getByRole('button', { name: 'Platform Budget Caps help' }).focus();
    await expect(page.locator('#platformBudgetCapsHelp')).toBeVisible();
    await expect(page.locator('#platformBudgetCapsHelp')).toContainText('not customer billing');

    await page.locator('.admin-control-panel-nav__link[href="#repair-evidence-report"]').click();
    await expect(page).toHaveURL(/#repair-evidence-report$/);
    await expect(aiBudgetLink).toHaveClass(/admin-nav__link--active/);
    await expect(page.locator('#platformBudgetRepairReportPanel')).toBeVisible();
    await expect(page.locator('#platformBudgetRepairReportPanel')).toContainText('Read-only');
    await expect(page.locator('#platformBudgetRepairReportPanel')).toContainText('No automatic repair');

    await page.setViewportSize({ width: 390, height: 820 });
    await expect(page.locator('.admin-control-panel-nav__link[href="#evidence-archives"]')).toBeVisible();
    await expect(page.locator('#platformBudgetEvidenceArchivesPanel')).toContainText('No provider call');
  });

  test('operator timeline triage renders safe filters and no dangerous controls', async ({ page }) => {
    const captures = {};
    await installClipboardSpy(page);
    await mockAdminControlPlane(page, captures);

    const response = await page.goto('/admin/index.html#operations');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    const operations = page.locator('#sectionOperations');
    await expect(operations).toBeVisible();
    await expect(operations).toContainText('Operator Timeline / Triage');
    await expect(page.locator('#operatorTimelineFilter')).toContainText('Source');
    await expect(page.locator('#operatorTimelineFilter')).toContainText('Severity');
    await expect(page.locator('#operatorTimelineFilter')).toContainText('Status');
    await expect(page.locator('#operatorTimelineFilter')).toContainText('Attention');
    await expect(page.locator('#operatorTimelineList')).toContainText('Open Billing Reviews');
    await expect(page.locator('#operatorTimelineList')).toContainText('Open Tenant Asset Center');
    await expect(page.locator('#operatorTimelineList')).toContainText('Copy event ID');
    await expect(page.locator('#operatorTimelineList')).not.toContainText('sk_live_');
    await expect(page.locator('#operatorTimelineList')).not.toContainText('Stripe-Signature');
    await expect(operations.getByRole('button', { name: /enable|execute|deploy|migration|refund|checkout|subscription|backfill|access switch|stripe|provider|credit|delete|reset/i })).toHaveCount(0);
    await expect(page.locator('a[href*="/de/admin"]')).toHaveCount(0);

    await page.locator('#operatorTimelineCopyEvidenceIndex').click();
    await expect.poll(() => readClipboardValue(page)).toContain('npm run evidence:index');
    await page.locator('#operatorTimelineCopyRunbook').click();
    await expect.poll(() => readClipboardValue(page)).toContain('docs/runbooks/OPERATOR_TRIAGE_RUNBOOK.md');
  });

  test('readiness evidence dashboard renders blocked claims, safe exports, and copy-only commands', async ({
    page,
  }) => {
    const captures = {};
    await installClipboardSpy(page);
    await mockAdminControlPlane(page, captures);

    const response = await page.goto('/admin/index.html#readiness');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    const readiness = page.locator('#sectionReadiness');
    await expect(readiness).toBeVisible();
    await expect(readiness).toContainText('Current Release Truth');
    await expect(readiness).toContainText(CURRENT_AUTH_MIGRATION);
    await expect(readiness).toContainText('not live deploy proof');
    await expect(readiness).toContainText('Repo evidence only');
    await expect(readiness).toContainText('Live Evidence State');
    await expect(readiness).toContainText('live evidence pending');
    await expect(readiness).toContainText('Release cutover manifest');
    await expect(readiness).toContainText('admin readiness status live result');
    await expect(readiness).toContainText('npm run release:cutover-evidence');
    await expect(readiness).toContainText('npm run readiness:live-readonly');
    await expect(readiness).toContainText('Production Execution Framework');
    await expect(readiness).toContainText('Production Execution State');
    await expect(readiness).toContainText('Cloudflare Resource Model');
    await expect(readiness).toContainText('Readiness Dossier');
    await expect(readiness).toContainText('Post-Deploy Read-Only Verification');
    await expect(readiness).toContainText('Rollback Drill');
    await expect(readiness).toContainText('Release Candidate / Go-No-Go');
    await expect(readiness).toContainText('Release Candidate Status');
    await expect(readiness).toContainText('Readiness Matrix');
    await expect(readiness).toContainText('Final RC Commands');
    await expect(readiness).toContainText('Go/No-Go Checklist');
    await expect(readiness).toContainText('repo-supported');
    await expect(readiness).toContainText('deploy-pending');
    await expect(readiness).toContainText('live-evidence-pending');
    await expect(readiness).toContainText('npm run rc:check');
    await expect(readiness).toContainText('npm run release:rc:markdown');
    await expect(readiness).toContainText('npm run readiness:dossier');
    await expect(readiness).toContainText('npm run cloudflare:resource-model');
    await expect(readiness).toContainText('npm run release:rollback-drill');
    await expect(readiness).toContainText('Blocked Claims');
    await expect(readiness).toContainText('Production readiness');
    await expect(readiness).toContainText('Live billing readiness');
    await expect(readiness).toContainText('Tenant isolation');
    await expect(readiness).toContainText('Confirmed legacy reset gate');
    await expect(readiness).toContainText('Sanitized legacy reset dry-run evidence');
    await expect(readiness).toContainText('Manual-review idempotency evidence');
    await expect(readiness).toContainText('Security and cost hardening');
    await expect(readiness).toContainText('Release, canary, billing, and admin mutation hardening');
    await expect(readiness).toContainText('Admin, data, observability, and scale hardening');
    await expect(readiness).toContainText('Live evidence and cutover tooling');
    await expect(readiness).toContainText('Billing evidence and control plane');
    await expect(readiness).toContainText('Production execution framework');
    await expect(readiness).toContainText('Release candidate consolidation');
    await expect(readiness).not.toContainText('P0/P1 Wave Matrix');
    await expect(readiness).not.toContainText('P1 Wave');
    await expect(readiness).toContainText('Runtime Safety Gates');
    await expect(readiness).toContainText('disabled default off');
    await expect(readiness).toContainText('Fetch Metadata CSRF hardening');
    await expect(readiness).toContainText('Evidence Center');
    await expect(readiness).toContainText('Manual Review Idempotency Evidence');
    await expect(readiness).toContainText('Production Readiness Evidence');
    await expect(readiness).toContainText('Live Billing Evidence');
    await expect(readiness).toContainText('Billing evidence/control plane');
    await expect(readiness).toContainText('Production readiness dossier');
    await expect(readiness).toContainText('Rollback drill evidence');
    await expect(readiness).toContainText('Release Candidate Go/No-Go manifest');
    await expect(readiness).toContainText('Final RC validation matrix');
    await expect(readiness).toContainText('Command Center');
    await expect(readiness).toContainText('npm run check:js');
    await expect(readiness).toContainText('npm run test:tenant-assets');
    await expect(readiness.getByRole('button', { name: /enable legacy reset|confirmed reset|ownership backfill|access-check switch|live billing enablement|run commands/i })).toHaveCount(0);
    await expect(readiness.getByRole('button', { name: /deploy now|run remote migration|execute rollback|enable live billing|call stripe|enable reset|run backfill|switch tenant access/i })).toHaveCount(0);
    await expect(page.locator('a[href*="/de/admin"]')).toHaveCount(0);

    await readiness.getByRole('button', { name: /^Copy resource model$/ }).click();
    await expect.poll(() => readClipboardValue(page)).toBe('npm run cloudflare:resource-model');
    await readiness.getByRole('button', { name: 'Copy resource model Markdown' }).click();
    await expect.poll(() => readClipboardValue(page)).toBe('npm run cloudflare:resource-model:markdown');
    await readiness.getByRole('button', { name: 'Copy dossier JSON' }).click();
    await expect.poll(() => readClipboardValue(page)).toBe('npm run readiness:dossier');
    await readiness.getByRole('button', { name: 'Copy dossier Markdown' }).click();
    await expect.poll(() => readClipboardValue(page)).toBe('npm run readiness:dossier:markdown');
    await readiness.getByRole('button', { name: 'Copy live-read-only command' }).click();
    await expect.poll(() => readClipboardValue(page)).toContain('npm run readiness:live-readonly');
    await readiness.getByRole('button', { name: 'Copy rollback drill command' }).click();
    await expect.poll(() => readClipboardValue(page)).toBe('npm run release:rollback-drill');
    await readiness.getByRole('button', { name: 'Copy RC check' }).click();
    await expect.poll(() => readClipboardValue(page)).toBe('npm run rc:check');
    await readiness.getByRole('button', { name: 'Copy RC manifest Markdown' }).click();
    await expect.poll(() => readClipboardValue(page)).toBe('npm run release:rc:markdown');
    await readiness.getByRole('button', { name: 'Copy RC dossier Markdown' }).click();
    await expect.poll(() => readClipboardValue(page)).toBe('npm run readiness:dossier:markdown');
    await readiness.getByRole('button', { name: 'Copy release plan' }).click();
    await expect.poll(() => readClipboardValue(page)).toBe('npm run release:plan');

    await readiness.getByRole('button', { name: 'Copy commands' }).first().click();
    await expect.poll(() => readClipboardValue(page)).toContain('npm run check:js');
    await expect.poll(() => readClipboardValue(page)).toContain('npm run release:plan');

    await readiness.getByRole('button', { name: 'Copy cutover commands' }).click();
    await expect.poll(() => readClipboardValue(page)).toContain('npm run release:cutover-evidence');
    await expect.poll(() => readClipboardValue(page)).toContain('npm run readiness:live-readonly');

    await readiness.getByRole('button', { name: 'Copy evidence save path' }).click();
    await expect.poll(() => readClipboardValue(page)).toBe('docs/production-readiness/evidence/');

    await readiness.getByRole('button', { name: 'Copy template path' }).first().click();
    await expect.poll(() => readClipboardValue(page)).toBe('docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md');

    await readiness.getByRole('button', { name: 'Download dry-run report' }).click();
    await expect.poll(() => captures.legacyResetDryRunExportRequests.length).toBe(1);
    await readiness.getByRole('button', { name: 'Export manual-review evidence' }).click();
    await expect.poll(() => captures.tenantReviewEvidenceExportRequests.length).toBe(1);
  });

  test('renders billing evidence center with blocked status, safe actions, and no dangerous controls', async ({
    page,
  }) => {
    await installClipboardSpy(page);
    await mockAdminControlPlane(page);

    const response = await page.goto('/admin/index.html#billing-events');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    const center = page.locator('#billingEvidencePanel');
    await expect(page.locator('#sectionBillingEvents')).toContainText('Billing evidence');
    await expect(page.locator('#sectionBillingEvents')).toContainText('Next Safe Action');
    await expect(page.locator('#sectionBillingEvents')).toContainText('This page never calls Stripe or adjusts credits');
    await expect(page.locator('#billingEvidenceState')).toContainText('Production readiness and live billing readiness remain BLOCKED');
    await expect(center).toContainText('Live Billing Readiness');
    await expect(center).toContainText('Credit Packs');
    await expect(center).toContainText('5000 Credit Pack');
    await expect(center).toContainText('12000 Credit Pack');
    await expect(center).toContainText('BITBI Pro Subscription');
    await expect(center).toContainText('6000');
    await expect(center).toContainText('Webhook Evidence');
    await expect(center).toContainText('/api/billing/webhooks/stripe/live');
    await expect(center).toContainText('Refund / Dispute / Failure Review');
    await expect(center).toContainText('Automatic clawback');
    await expect(center).toContainText('Reconciliation');
    await expect(center).toContainText('checkout without grant');
    await expect(center).toContainText('Verified webhook or paid invoice event is required before credit grant');
    await expect(center).not.toContainText('sk_live_');
    await expect(center).not.toContainText('whsec_');
    await expect(center).not.toContainText('Stripe-Signature');

    await expect(center.getByRole('link', { name: 'Open Billing Reviews' })).toBeVisible();
    await expect(center.getByRole('link', { name: 'Open Billing Reconciliation' })).toBeVisible();
    await expect(center.getByRole('button', { name: 'Copy billing evidence checklist path' })).toBeVisible();
    await expect(center.getByRole('button', { name: 'Copy billing validation commands' })).toBeVisible();
    await expect(center.getByRole('button', { name: /enable live|call stripe|create checkout|issue refund|mutate subscription|clawback|reveal|edit secret/i })).toHaveCount(0);
    await expect(page.locator('#sectionBillingEvents').getByRole('button', { name: /enable live|call stripe live|create live checkout|issue refunds|mutate subscriptions|claw back credits|edit secret values/i })).toHaveCount(0);

    await center.getByRole('button', { name: 'Copy billing evidence checklist path' }).click();
    await expect.poll(() => readClipboardValue(page)).toBe('docs/production-readiness/EVIDENCE_TEMPLATE.md');
    await center.getByRole('button', { name: 'Copy billing validation commands' }).click();
    await expect.poll(() => readClipboardValue(page)).toContain('npm run billing:canary-evidence');
  });

  test('renders billing review queue safely and records manual resolutions only', async ({
    page,
  }) => {
    const captures = {};
    await mockAdminControlPlane(page, captures);

    const response = await page.goto('/admin/index.html#billing-events');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sectionBillingEvents')).toBeVisible();
    await expect(page.locator('#sectionBillingEvents')).toContainText(/operator review only/i);
    await expect(page.locator('#sectionBillingEvents')).toContainText(/does not adjust credits/i);
    await expect(page.locator('#billingReviewsState')).toContainText('Showing 2 sanitized billing review events');

    const reviewList = page.locator('#billingReviewsList');
    await expect(reviewList).toContainText('invoice.payment_failed');
    await expect(reviewList).toContainText('needs review');
    await expect(reviewList).toContainText('evt_review');
    await expect(reviewList).toContainText('charge.dispute.created');
    await expect(reviewList).toContainText('blocked');
    await expect(reviewList).not.toContainText('should-not-render');
    await expect(reviewList).not.toContainText('sk_live_should_not_render');
    await expect(reviewList).not.toContainText('pm_card_visa');
    await expect(reviewList).not.toContainText('4242');

    await page.locator('#billingReviewsList').getByRole('button', { name: 'Inspect Review' }).nth(1).click();
    const reviewDetail = page.locator('#billingReviewDetail');
    await expect(reviewDetail).toContainText('Blocked billing lifecycle event');
    await expect(reviewDetail).toContainText('du_review_1');
    await expect(reviewDetail).toContainText('Side effects enabled');
    await expect(reviewDetail).toContainText('No');
    await expect(reviewDetail).not.toContainText('should-not-render');
    await expect(reviewDetail).not.toContainText('Stripe-Signature');
    await expect(reviewDetail).not.toContainText('sk_live_should_not_render');
    await expect(reviewDetail).not.toContainText('pm_card_visa');
    await expect(reviewDetail).not.toContainText('4242');
    await expect(page.locator('#sectionBillingEvents').getByRole('button', { name: /refund|reverse credits|clawback|cancel subscription|chargeback action/i })).toHaveCount(0);

    await page.locator('#billingReviewsList').getByRole('button', { name: 'Inspect Review' }).first().click();
    await expect(reviewDetail).toContainText('invoice.payment_failed');
    await expect(reviewDetail).toContainText('Resolution records operator review metadata only');
    await expect(reviewDetail).toContainText('does not perform payment, credit, account, or Stripe remediation');
    await reviewDetail.getByRole('button', { name: 'Mark Resolved' }).click();
    await expect(page.locator('#billingReviewResolutionState')).toContainText('Resolution note and confirmation are required.');
    expect(captures.billingReviewResolutionRequests).toHaveLength(0);

    await page.locator('#billingReviewResolutionNote').fill('Reviewed invoice failure with support. No automatic credit or Stripe action was taken.');
    await reviewDetail.getByRole('button', { name: 'Mark Dismissed' }).click();
    await expect(page.locator('#billingReviewResolutionState')).toContainText('Resolution note and confirmation are required.');
    expect(captures.billingReviewResolutionRequests).toHaveLength(0);

    await page.locator('#billingReviewResolutionConfirm').check();
    await reviewDetail.getByRole('button', { name: 'Mark Resolved' }).evaluate((button) => {
      button.click();
      button.click();
    });
    await expect(reviewDetail).toContainText('resolved');
    expect(captures.billingReviewResolutionRequests).toHaveLength(1);
    expect(captures.billingReviewResolutionRequests[0]).toMatchObject({
      method: 'POST',
      path: '/api/admin/billing/reviews/bpe_review_1/resolution',
      body: {
        resolution_status: 'resolved',
        resolution_note: 'Reviewed invoice failure with support. No automatic credit or Stripe action was taken.',
      },
    });
    expect(captures.billingReviewResolutionRequests[0].idempotencyKey).toMatch(/^billing-review-resolution-/);
  });

  test('renders billing reconciliation report as a read-only local-only operator view', async ({
    page,
  }) => {
    await mockAdminControlPlane(page);

    const response = await page.goto('/admin/index.html#billing-events');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sectionBillingEvents')).toContainText('Billing Reconciliation');
    await expect(page.locator('#sectionBillingEvents')).toContainText('Local D1 only');
    await expect(page.locator('#sectionBillingEvents')).toContainText('Live billing blocked');
    await expect(page.locator('#billingReconciliationState')).toContainText('Verdict remains BLOCKED');

    const panel = page.locator('#billingReconciliationPanel');
    await expect(panel).toContainText('2 critical');
    await expect(panel).toContainText('Unresolved blocked billing review events exist.');
    await expect(panel).toContainText('Completed live credit-pack checkout sessions without linked ledger entries.');
    await expect(panel).toContainText('Read-only operator report');
    await expect(panel).toContainText('no Stripe API calls');
    await expect(panel).toContainText('no automatic remediation');
    await expect(panel).not.toContainText('Stripe-Signature');
    await expect(panel).not.toContainText('sk_live_should_not_render');
    await expect(panel).not.toContainText('pm_card_should_not_render');
    await expect(panel).not.toContainText('4242');
    await expect(page.locator('#sectionBillingEvents').getByRole('button', { name: /fix|remediate|refund|reverse credits|clawback|cancel subscription|retry payment|call stripe|chargeback action/i })).toHaveCount(0);
  });

  test('renders billing reconciliation unavailable state safely', async ({
    page,
  }) => {
    await mockAdminControlPlane(page, { billingReconciliationUnavailable: true });

    const response = await page.goto('/admin/index.html#billing-events');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#billingReconciliationPanel')).toContainText('Backend dependency is unavailable or fail-closed');
    await expect(page.locator('#billingReconciliationPanel')).not.toContainText('Production ready');
    await expect(page.locator('#sectionBillingEvents').getByRole('button', { name: /fix|remediate|refund|reverse credits|clawback|cancel subscription|retry payment|call stripe/i })).toHaveCount(0);
  });

  test('renders billing review unavailable state without unsafe fallback actions', async ({
    page,
  }) => {
    await mockAdminControlPlane(page);
    await page.route('**/api/admin/billing/reviews?*', async (route) => {
      await fulfillJson(route, { ok: false, error: 'Limiter backend unavailable' }, 503);
    });
    await page.route('**/api/admin/billing/reviews', async (route) => {
      await fulfillJson(route, { ok: false, error: 'Limiter backend unavailable' }, 503);
    });

    const response = await page.goto('/admin/index.html#billing-events');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#billingReviewsList')).toContainText('Backend dependency is unavailable or fail-closed');
    await expect(page.locator('#billingReviewsList')).not.toContainText('Production ready');
    await expect(page.locator('#sectionBillingEvents').getByRole('button', { name: /refund|reverse credits|clawback|cancel subscription|chargeback action/i })).toHaveCount(0);
  });

  test('keeps control-plane cards, badges, nav, and tables legible across viewports', async ({
    page,
  }) => {
    await mockAdminControlPlane(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin/index.html');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#controlPlaneCapabilityGrid .admin-control-card')).toHaveCount(10);
    const managementShellWidth = await page.locator('.admin-management-shell').evaluate((node) =>
      Math.round(node.getBoundingClientRect().width)
    );
    expect(managementShellWidth).toBeGreaterThan(1100);

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
    await expect(page.locator('#sectionReadiness')).toContainText('Current Release Truth');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/index.html#orgs');
    await expect(page.locator('#sectionOrgs')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#orgsList .admin-table-wrap')).toBeVisible();
    const mobileHasDocumentOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(mobileHasDocumentOverflow).toBe(false);
  });

  test('Admin Users replaces Credits with Info and routes to credit or usage details', async ({
    page,
  }) => {
    const captures = {};
    await mockAdminControlPlane(page, captures);

    const response = await page.goto('/admin/index.html#users');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sectionUsers')).toBeVisible();
    await expect(page.locator('#searchForm')).toBeVisible();
    await expect(page.locator('#userLoadMoreBtn')).toBeHidden();
    await expect(page.locator('#userTbody tr')).toHaveCount(2);
    await expect(page.locator('#userPagination')).toContainText('Showing all 2 users.');

    const memberRow = page.locator('#userTbody tr', { hasText: 'member@example.com' });
    await expect(memberRow).toContainText('user_member');
    await expect(memberRow.getByRole('button', { name: 'Copy user ID user_member' })).toBeVisible();
    await expect(memberRow.getByRole('button', { name: 'Info' })).toBeVisible();
    await expect(memberRow.getByRole('button', { name: 'Credits' })).toHaveCount(0);
    await expect(memberRow.getByRole('button', { name: 'Make Admin' })).toBeVisible();
    await expect(memberRow.getByRole('button', { name: 'Disable' })).toBeVisible();
    await expect(memberRow.getByRole('button', { name: 'Revoke Sessions' })).toBeVisible();
    await expect(memberRow.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(memberRow.getByRole('button', { name: 'Delete' })).toHaveAttribute('title', 'Delete this user with explicit confirmation.');

    const memberInfoButton = memberRow.getByRole('button', { name: 'Info' });
    await memberInfoButton.click();
    await expect(page.locator('#userInfoModal')).toBeVisible();
    await expect(page.locator('#userInfoModal')).toContainText('member@example.com');
    await expect(page.locator('#userInfoModal')).toContainText('user_member');
    await expect(page.locator('#userInfoModal [data-info-action="credits"]')).toContainText('Credits');
    await expect(page.locator('#userInfoModal [data-info-action="usage"]')).toContainText('Usage');
    await expect(page.locator('#userInfoModal [data-info-action="credits"]')).toBeFocused();

    await page.locator('#userInfoModal [data-info-action="credits"]').click();
    await expect(page.locator('#userInfoModal')).toBeHidden();
    await expect(page.locator('#userCreditModal')).toBeVisible();
    await expect(page.locator('#userCreditModal .admin-credit-modal__close')).toBeFocused();
    await expect(page.locator('#userCreditModal')).toContainText('member@example.com');
    await expect(page.locator('#userCreditModal')).toContainText('user_member');
    await expect(page.locator('#userCreditModal')).toContainText('Current balance');
    await expect(page.locator('#userCreditModal')).toContainText('9 credits');
    await expect(page.locator('#userCreditModal')).toContainText('Image generation charge for flux-1-schnell');
    await expect(page.locator('#userCreditModal')).toContainText('org_image_credit_catalog');
    await expect(page.locator('#userCreditModal').getByRole('button', { name: 'Copy user ID user_member' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#userCreditModal')).toBeHidden();
    await expect(memberInfoButton).toBeFocused();

    await memberInfoButton.click();
    await page.locator('#userInfoModal [data-info-action="usage"]').click();
    await expect(page.locator('#userInfoModal')).toBeHidden();
    await expect(page.locator('#userStorageModal')).toBeVisible();
    await expect(page.locator('#userStorageModal .admin-credit-modal__close')).toBeFocused();
    await expect(page.locator('#userStorageModal')).toContainText('member@example.com');
    await expect(page.locator('#userStorageModal')).toContainText('14,5 MB / 50 MB');
    await expect(page.locator('#userStorageModal')).toContainText('Storage mutation safety');
    await expect(page.locator('#userStorageModal')).toContainText('Mutation controls below are scoped to this selected user');
    await expect(page.locator('#userStorageModal')).toContainText('generated Idempotency-Key');
    await expect(page.locator('#userStorageModal')).toContainText('raw private R2 keys');
    await expect(page.locator('#userStorageModal')).toContainText('Launches');
    await expect(page.locator('#userStorageModal')).toContainText('Launch Key Visual');
    await expect(page.locator('#userStorageModal')).toContainText('Release Notes');
    await expect(page.locator('#userStorageModal')).toContainText('a100cafe');
    await expect(page.locator('#userStorageModal').getByRole('button', { name: 'Rename' }).first()).toBeVisible();
    await expect(page.locator('#userStorageModal').getByRole('button', { name: 'Delete' }).first()).toBeVisible();
    await expect(page.locator('#userStorageModal')).toContainText('Folder delete requires browser confirmation, an operator reason, and a generated Idempotency-Key');
    await expect(page.locator('#userStorageModal')).toContainText('Asset rename, move, visibility, and delete actions apply only to this selected user');
    await expect(page.locator('#userStorageModal')).toContainText('Storage reconciliation dry-run');
    await expect(page.locator('#userStorageModal')).toContainText('Storage usage is calculated from active Assets Manager files owned by this user.');
    await page.locator('#userStorageModal').getByRole('button', { name: 'Run D1 metadata reconciliation' }).click();
    await expect(page.locator('#userStorageModal')).toContainText('D1 metadata only');
    await expect(page.locator('#userStorageModal')).toContainText('needs_review');
    await expect(page.locator('#userStorageModal')).toContainText('No live R2 listing');

    const deleteDialogs = [];
    const deleteDialogHandler = (dialog) => {
      deleteDialogs.push(dialog.type());
      if (dialog.type() === 'prompt') {
        dialog.accept('Delete selected test asset after admin storage review');
        return;
      }
      expect(dialog.message()).toContain('does not list live R2');
      expect(dialog.message()).toContain('generated Idempotency-Key');
      dialog.accept();
    };
    page.on('dialog', deleteDialogHandler);
    await page.locator('#userStorageModal tr', { hasText: 'Launch Key Visual' }).getByRole('button', { name: 'Delete' }).click();
    page.off('dialog', deleteDialogHandler);
    expect(deleteDialogs).toEqual(['confirm', 'prompt']);
    const deleteRequest = captures.storageRequests.find((request) => request.method === 'DELETE' && request.path.endsWith('/assets/a100cafe'));
    expect(deleteRequest).toEqual(expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^admin-storage-asset-delete-/),
      body: expect.objectContaining({
        confirm: true,
        confirmation: 'delete_user_asset',
        reason: 'Delete selected test asset after admin storage review',
        targetUserId: 'user_member',
        assetId: 'a100cafe',
      }),
    }));
    const storageModalText = await page.locator('#userStorageModal').innerText();
    expect(storageModalText).not.toContain('USER_IMAGES/');
    expect(storageModalText).not.toContain('r2://');

    const folderDeleteDialogs = [];
    const folderDeleteHandler = (dialog) => {
      folderDeleteDialogs.push(dialog.type());
      if (dialog.type() === 'prompt') {
        dialog.accept('Delete selected folder after admin storage review');
        return;
      }
      expect(dialog.message()).toContain('generated Idempotency-Key');
      expect(dialog.message()).toContain('does not list live R2');
      dialog.accept();
    };
    page.on('dialog', folderDeleteHandler);
    const foldersSection = page.locator('#userStorageModal .admin-usage-modal__section', { hasText: 'Folders' });
    await foldersSection.locator('tr', { hasText: 'Launches' }).getByRole('button', { name: 'Delete' }).click();
    page.off('dialog', folderDeleteHandler);
    expect(folderDeleteDialogs).toEqual(['confirm', 'prompt']);
    const folderDeleteRequest = captures.storageRequests.find((request) => request.method === 'DELETE' && request.path.endsWith('/folders/f100cafe'));
    expect(folderDeleteRequest).toEqual(expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^admin-storage-folder-delete-/),
      body: expect.objectContaining({
        confirm: true,
        confirmation: 'delete_user_folder',
        reason: 'Delete selected folder after admin storage review',
        targetUserId: 'user_member',
        folderId: 'f100cafe',
      }),
    }));
    await expect(page.locator('#userStorageModal').getByRole('link', { name: 'Open' }).first()).toHaveAttribute('href', '/api/admin/users/user_member/assets/a100cafe/file');
    await page.keyboard.press('Escape');
    await expect(page.locator('#userStorageModal')).toBeHidden();
    await expect(memberInfoButton).toBeFocused();

    const emptyRow = page.locator('#userTbody tr', { hasText: 'empty@example.com' });
    await emptyRow.getByRole('button', { name: 'Info' }).click();
    await page.locator('#userInfoModal [data-info-action="credits"]').click();
    await expect(page.locator('#userInfoModal')).toBeHidden();
    await expect(page.locator('#userCreditModal')).toBeVisible();
    await expect(page.locator('#userCreditModal')).toContainText('empty@example.com');
    await expect(page.locator('#userCreditModal')).toContainText('No member credit transactions yet.');
  });

  test('Admin Users registration availability switch updates new-account creation only', async ({
    page,
  }) => {
    const captures = {};
    await mockAdminControlPlane(page, captures);

    const response = await page.goto('/admin/index.html#users');
    expect(response.status()).toBe(200);
    await expect(page.locator('#sectionUsers')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#registrationAvailabilityPanel')).toBeVisible();
    await expect(page.locator('#registrationAvailabilityStatusText')).toHaveText('Registrations enabled');
    await expect(page.locator('#registrationAvailabilityPanel')).toContainText('This only affects creation of new accounts. Existing users, admins, sessions, MFA, password reset, and profile/account access remain available.');
    await expect(page.locator('#registrationAvailabilityPanel')).toContainText('Saving uses a generated Idempotency-Key');
    await expect(page.locator('#registrationAvailabilityMessageText')).toContainText('Registrations are temporarily disabled due to maintenance work');

    await page.locator('#registrationEnabledToggle').setChecked(false);
    await page.locator('#registrationAvailabilitySaveBtn').click();
    await expect(page.locator('#registrationAvailabilityState')).toContainText('A reason is required when disabling new registrations.');
    await expect(page.locator('#registrationAvailabilityReason')).toBeFocused();
    expect(captures.registrationStatusUpdates).toHaveLength(0);

    await page.locator('#registrationAvailabilityReason').fill('SaaS buildout maintenance window');
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('Disable new user registrations');
      expect(dialog.message()).toContain('Existing users will still be able to sign in.');
      dialog.accept();
    });
    await page.locator('#registrationAvailabilitySaveBtn').click();
    await expect.poll(() => captures.registrationStatusUpdates.length).toBe(1);
    expect(captures.registrationStatusUpdates[0].idempotencyKey).toMatch(/^registration-availability-/);
    expect(captures.registrationStatusUpdates[0].body).toMatchObject({
      enabled: false,
      reason: 'SaaS buildout maintenance window',
      maintenanceMessage: 'Registrations are temporarily disabled due to maintenance work. Please try again later.',
    });
    await expect(page.locator('#registrationAvailabilityStatusText')).toHaveText('Registrations disabled for maintenance');
    await expect(page.locator('#registrationAvailabilityState')).toContainText('disabled');

    await page.locator('#registrationEnabledToggle').setChecked(true);
    await page.locator('#registrationAvailabilityReason').fill('Maintenance complete');
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('Enable new user registrations');
      dialog.accept();
    });
    await page.locator('#registrationAvailabilitySaveBtn').click();
    await expect.poll(() => captures.registrationStatusUpdates.length).toBe(2);
    expect(captures.registrationStatusUpdates[1].body).toMatchObject({
      enabled: true,
      reason: 'Maintenance complete',
    });
    await expect(page.locator('#registrationAvailabilityStatusText')).toHaveText('Registrations enabled');
    await expect(page.locator('#userTbody tr')).toHaveCount(2);
  });

  test('Admin Users delete requires visible confirmation, sends explicit body, and removes the row', async ({
    page,
  }) => {
    const adminUsers = [
      {
        id: 'user_member',
        email: 'member@example.com',
        role: 'user',
        status: 'active',
        created_at: '2026-04-18T11:05:00.000Z',
        updated_at: '2026-04-18T11:05:00.000Z',
      },
      {
        id: 'user_empty',
        email: 'empty@example.com',
        role: 'user',
        status: 'active',
        created_at: '2026-04-19T11:05:00.000Z',
        updated_at: '2026-04-19T11:05:00.000Z',
      },
    ];
    const captures = { adminUsers, userDeleteRequests: [] };
    await mockAdminControlPlane(page, captures);
    await page.route('**/api/admin/users/user_member', async (route) => {
      const request = route.request();
      captures.userDeleteRequests.push({
        method: request.method(),
        contentType: request.headers()['content-type'] || '',
        body: request.postData() ? request.postDataJSON() : null,
      });
      adminUsers.splice(adminUsers.findIndex((user) => user.id === 'user_member'), 1);
      await fulfillJson(route, {
        ok: true,
        deletedUserId: 'user_member',
        deletionMode: 'operational_delete',
        operationalDelete: {
          completed: true,
          deletedUserId: 'user_member',
          deletionMode: 'operational_anonymized_delete',
          deletionScope: {
            accountDeletedOrAnonymized: true,
            loginDisabled: true,
            sessionsDeleted: true,
            tokensDeleted: true,
            profileDeleted: true,
            aiAssetsDeleted: { images: 0, textAssets: 0, folders: 0, cleanupObjectsQueued: 0 },
            avatarCleanup: 'best_effort_completed',
            retainedPolicyRecords: ['admin_audit_log', 'billing_ledger_and_provider_evidence_if_present'],
          },
        },
        dataErasureWorkflow: {
          started: false,
          status: 'not_requested',
          executesImmediately: false,
        },
        deletionScope: {
          accountDeletedOrAnonymized: true,
          loginDisabled: true,
          sessionsDeleted: true,
          tokensDeleted: true,
          profileDeleted: true,
          aiAssetsDeleted: { images: 0, textAssets: 0, folders: 0, cleanupObjectsQueued: 0 },
          avatarCleanup: 'best_effort_completed',
          retainedPolicyRecords: ['admin_audit_log', 'billing_ledger_and_provider_evidence_if_present'],
        },
      });
    });

    await page.goto('/admin/index.html#users');
    await expect(page.locator('#sectionUsers')).toBeVisible({ timeout: 10_000 });
    const memberRow = page.locator('#userTbody tr', { hasText: 'member@example.com' });

    await memberRow.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.locator('[data-testid="admin-delete-user-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Delete operational account only');
    await expect(dialog).toContainText('Also start Data Erasure / GDPR workflow');
    await expect(dialog).toContainText('Email');
    await expect(dialog).toContainText('member@example.com');
    await expect(dialog).toContainText('User ID');
    await expect(dialog).toContainText('user_member');
    await expect(dialog).toContainText('Audit, billing, legal, provider, and retention-governed records may remain');
    await expect(dialog).toContainText('Confirmation required');
    await expect(dialog).toContainText('exact confirmation matches');
    await expect(dialog.locator('[data-testid="admin-delete-confirm-input"]')).toBeFocused();
    await expect(dialog.locator('[data-testid="admin-delete-submit"]')).toBeDisabled();
    await dialog.locator('[data-testid="admin-delete-confirm-input"]').fill('member@example.com');
    await expect(dialog.locator('[data-testid="admin-delete-submit"]')).toBeEnabled();
    await dialog.locator('[data-testid="admin-delete-submit"]').focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Cancel user deletion' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.locator('[data-testid="admin-delete-submit"]')).toBeFocused();
    await dialog.locator('[data-testid="admin-delete-submit"]').click();
    await expect.poll(() => captures.userDeleteRequests.length).toBe(1);

    expect(captures.userDeleteRequests[0]).toEqual(expect.objectContaining({
      method: 'DELETE',
      contentType: expect.stringContaining('application/json'),
      body: {
        confirm: true,
        confirmation: 'delete_user',
      },
    }));
    expect(captures.userDeleteRequests[0].body.startDataErasureWorkflow).toBeUndefined();
    await expect(page.locator('#userTbody tr', { hasText: 'member@example.com' })).toHaveCount(0);
    await expect(page.locator('.admin-toast__item').last()).toContainText('User deleted');
    await expect(page.locator('.admin-toast__item').last()).toContainText('Operational deletion completed');
    await expect(page.locator('.admin-toast__item').last()).toContainText('Data Erasure workflow was not requested');
  });

  test('Admin Users delete can also start a Data Erasure workflow with second acknowledgement', async ({
    page,
  }) => {
    const captures = { userDeleteRequests: [] };
    await mockAdminControlPlane(page, captures);
    await page.route('**/api/admin/users/user_member', async (route) => {
      const request = route.request();
      captures.userDeleteRequests.push({
        method: request.method(),
        body: request.postData() ? request.postDataJSON() : null,
      });
      await fulfillJson(route, {
        ok: true,
        deletedUserId: 'user_member',
        deletionMode: 'operational_delete_with_erasure_workflow',
        operationalDelete: {
          completed: true,
          deletedUserId: 'user_member',
          deletionScope: {
            accountDeletedOrAnonymized: true,
            loginDisabled: true,
          },
        },
        dataErasureWorkflow: {
          started: true,
          status: 'pending_review',
          requestStatus: 'submitted',
          requestId: 'dlr_delete_user_modal',
          requestType: 'delete',
          requiresApproval: true,
          executesImmediately: false,
          evidenceRequired: true,
        },
      });
    });

    await page.goto('/admin/index.html#users');
    await expect(page.locator('#sectionUsers')).toBeVisible({ timeout: 10_000 });
    await page.locator('#userTbody tr', { hasText: 'member@example.com' }).getByRole('button', { name: 'Delete' }).click();
    const dialog = page.locator('[data-testid="admin-delete-user-dialog"]');
    await dialog.locator('[data-testid="admin-delete-confirm-input"]').fill('member@example.com');
    await dialog.locator('[data-testid="admin-delete-erasure-checkbox"]').check();
    await expect(dialog).toContainText('This creates a formal data-erasure workflow');
    await expect(dialog.locator('[data-testid="admin-delete-erasure-ack"]')).toBeFocused();
    await expect(dialog.locator('[data-testid="admin-delete-submit"]')).toBeDisabled();
    await dialog.locator('[data-testid="admin-delete-erasure-ack"]').fill('ERASURE WORKFLOW');
    await expect(dialog.locator('[data-testid="admin-delete-submit"]')).toBeEnabled();
    await dialog.locator('[data-testid="admin-delete-submit"]').click();

    await expect.poll(() => captures.userDeleteRequests.length).toBe(1);
    expect(captures.userDeleteRequests[0].body).toMatchObject({
      confirm: true,
      confirmation: 'delete_user',
      startDataErasureWorkflow: true,
      dataErasureWorkflow: {
        reason: 'Admin initiated GDPR/data erasure workflow from Admin user deletion.',
        requestSource: 'admin_delete_user_modal',
        acknowledgement: 'ERASURE WORKFLOW',
      },
    });
    const toast = page.locator('.admin-toast__item').last();
    await expect(toast).toContainText('Operational deletion completed');
    await expect(toast).toContainText('Data Erasure workflow dlr_delete_user_modal started');
    await expect.poll(() => new URL(page.url()).hash).toBe('#lifecycle');
  });

  test('Admin Users delete displays backend confirmation-required code and status', async ({
    page,
  }) => {
    await mockAdminControlPlane(page, {});
    await page.route('**/api/admin/users/user_member', async (route) => {
      await fulfillJson(route, {
        ok: false,
        error: 'Explicit confirmation is required before permanently deleting a user.',
        code: 'admin_delete_user_confirmation_required',
        required: { confirm: true, confirmation: 'delete_user' },
      }, 409);
    });

    await page.goto('/admin/index.html#users');
    await expect(page.locator('#sectionUsers')).toBeVisible({ timeout: 10_000 });
    await page.locator('#userTbody tr', { hasText: 'member@example.com' }).getByRole('button', { name: 'Delete' }).click();
    const dialog = page.locator('[data-testid="admin-delete-user-dialog"]');
    await dialog.locator('[data-testid="admin-delete-confirm-input"]').fill('member@example.com');
    await dialog.locator('[data-testid="admin-delete-submit"]').click();
    const toast = page.locator('.admin-toast__item').last();
    await expect(toast).toContainText('Explicit confirmation is required before permanently deleting a user.');
    await expect(toast).toContainText('code: admin_delete_user_confirmation_required');
    await expect(toast).toContainText('status: 409');
  });

  test('Admin Users delete displays backend lifecycle failure code and keeps the row', async ({
    page,
  }) => {
    await mockAdminControlPlane(page, {});
    await page.route('**/api/admin/users/user_member', async (route) => {
      await fulfillJson(route, {
        ok: false,
        error: 'Failed to delete user-owned operational assets safely.',
        code: 'admin_delete_user_lifecycle_failed',
        branch: 'user_delete_failed_dependency',
        dataErasureWorkflow: {
          started: true,
          status: 'pending_review',
          requestId: 'dlr_partial_failure',
          executesImmediately: false,
          evidenceRequired: true,
        },
        dependencySummary: {
          blockingCategories: ['billing_ledger'],
          safeCounts: { member_credit_ledger: 1 },
        },
      }, 500);
    });

    await page.goto('/admin/index.html#users');
    await expect(page.locator('#sectionUsers')).toBeVisible({ timeout: 10_000 });
    const memberRow = page.locator('#userTbody tr', { hasText: 'member@example.com' });
    await memberRow.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.locator('[data-testid="admin-delete-user-dialog"]');
    await dialog.locator('[data-testid="admin-delete-confirm-input"]').fill('member@example.com');
    await dialog.locator('[data-testid="admin-delete-submit"]').click();
    const toast = page.locator('.admin-toast__item').last();
    await expect(toast).toContainText('Failed to delete user-owned operational assets safely.');
    await expect(toast).toContainText('code: admin_delete_user_lifecycle_failed');
    await expect(toast).toContainText('branch: user_delete_failed_dependency');
    await expect(toast).toContainText('workflow: dlr_partial_failure/pending_review');
    await expect(toast).toContainText('Dependencies: billing_ledger');
    await expect(toast).toContainText('status: 500');
    await expect(memberRow).toHaveCount(1);
  });

  test('Admin Users delete explains retention dependency failures as backend policy blockers', async ({
    page,
  }) => {
    await mockAdminControlPlane(page, {});
    await page.route('**/api/admin/users/user_member', async (route) => {
      await fulfillJson(route, {
        ok: false,
        error: 'User deletion is blocked by retained policy-controlled records.',
        code: 'admin_delete_user_retention_dependency_blocked',
        branch: 'retention_dependency_blocked',
        dependencySummary: {
          blockingCategories: ['billing_ledger', 'data_lifecycle_records'],
          safeCounts: { member_credit_ledger: 1, data_lifecycle_requests: 1 },
        },
      }, 409);
    });

    await page.goto('/admin/index.html#users');
    await expect(page.locator('#sectionUsers')).toBeVisible({ timeout: 10_000 });
    const memberRow = page.locator('#userTbody tr', { hasText: 'member@example.com' });
    await memberRow.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.locator('[data-testid="admin-delete-user-dialog"]');
    await dialog.locator('[data-testid="admin-delete-confirm-input"]').fill('member@example.com');
    await dialog.locator('[data-testid="admin-delete-submit"]').click();
    const toast = page.locator('.admin-toast__item').last();
    await expect(toast).toContainText('User deletion is blocked by retained policy-controlled records.');
    await expect(toast).toContainText('code: admin_delete_user_retention_dependency_blocked');
    await expect(toast).toContainText('branch: retention_dependency_blocked');
    await expect(toast).toContainText('Dependencies: billing_ledger, data_lifecycle_records');
    await expect(toast).toContainText('backend policy/schema dependency');
    await expect(memberRow).toHaveCount(1);
  });

  test('Admin Users disables self-delete for the signed-in admin account', async ({
    page,
  }) => {
    await mockAdminControlPlane(page, {
      adminUsers: [
        {
          id: 'admin-1',
          email: 'admin@bitbi.ai',
          role: 'admin',
          status: 'active',
          created_at: '2026-04-18T11:05:00.000Z',
          updated_at: '2026-04-18T11:05:00.000Z',
        },
        {
          id: 'user_member',
          email: 'member@example.com',
          role: 'user',
          status: 'active',
          created_at: '2026-04-19T11:05:00.000Z',
          updated_at: '2026-04-19T11:05:00.000Z',
        },
      ],
    });

    await page.goto('/admin/index.html#users');
    await expect(page.locator('#sectionUsers')).toBeVisible({ timeout: 10_000 });
    const adminRow = page.locator('#userTbody tr', { hasText: 'admin@bitbi.ai' });
    await expect(adminRow.getByRole('button', { name: 'Self-delete blocked' })).toBeDisabled();
    await expect(page.locator('#userTbody tr', { hasText: 'member@example.com' }).getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  test('Admin Users usage overlay shows unlimited storage for selected admin users', async ({
    page,
  }) => {
    const adminUsers = [
      {
        id: 'admin_usage',
        email: 'storage-admin@example.com',
        role: 'admin',
        status: 'active',
        created_at: '2026-04-20T11:05:00.000Z',
        updated_at: '2026-04-20T11:05:00.000Z',
      },
    ];
    await mockAdminControlPlane(page, {
      adminUsers,
      userStoragePayloads: {
        admin_usage: {
          ok: true,
          data: {
            user: adminUsers[0],
            storageUsage: {
              usedBytes: Math.round(124.8 * 1024 * 1024),
              limitBytes: null,
              remainingBytes: null,
              isUnlimited: true,
            },
            summary: {
              assetCount: 1,
              folderCount: 0,
              unfolderedCount: 1,
              unfolderedSizeBytes: Math.round(124.8 * 1024 * 1024),
              totalAssetBytes: Math.round(124.8 * 1024 * 1024),
            },
            folders: [],
            assets: [
              {
                id: 'ad00cafe',
                asset_type: 'video',
                folder_id: null,
                title: 'Admin Archive Render',
                file_name: 'admin-archive-render.mp4',
                source_module: 'video',
                mime_type: 'video/mp4',
                size_bytes: Math.round(124.8 * 1024 * 1024),
                visibility: 'private',
                is_public: false,
                created_at: '2026-04-20T12:00:00.000Z',
                file_url: '/api/admin/users/admin_usage/assets/ad00cafe/file',
              },
            ],
            next_cursor: null,
            has_more: false,
            applied_limit: 100,
          },
        },
      },
    });

    const response = await page.goto('/admin/index.html#users');
    expect(response.status()).toBe(200);
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    const adminRow = page.locator('#userTbody tr', { hasText: 'storage-admin@example.com' });
    await adminRow.getByRole('button', { name: 'Info' }).click();
    await page.locator('#userInfoModal [data-info-action="usage"]').click();
    await expect(page.locator('#userInfoModal')).toBeHidden();
    await expect(page.locator('#userStorageModal')).toBeVisible();
    await expect(page.locator('#userStorageModal')).toContainText('124,8 MB / ∞');
    await expect(page.locator('#userStorageModal')).toContainText('unlimited Assets Manager storage');
    await expect(page.locator('#userStorageModal')).toContainText('Admin Archive Render');
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

  test('desktop Admin header aligns with public header insets without changing header nav content', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          loggedIn: true,
          user: {
            id: 'admin-1',
            email: 'admin@bitbi.ai',
            role: 'admin',
          },
        }),
      });
    });

    await page.goto('/admin/index.html#dashboard');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('header .auth-nav__logout')).toBeVisible();
    await expect(page.locator('header .site-nav__mood')).toBeVisible();

    const navItems = await page.locator('#navbar .site-nav__links > a').evaluateAll((links) => (
      links.map((link) => ({
        text: link.textContent.trim(),
        href: link.getAttribute('href'),
      }))
    ));
    expect(navItems).toEqual([
      { text: 'Gallery', href: '/#gallery' },
      { text: 'Video', href: '/#video-creations' },
      { text: 'Sound Lab', href: '/#soundlab' },
      { text: 'Profile', href: '/account/profile.html' },
      { text: 'Admin', href: '/admin/' },
    ]);

    const metrics = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          width: box.width,
        };
      };
      const insetProbe = document.createElement('div');
      insetProbe.style.cssText = [
        'position: fixed',
        'inset-block-start: 0',
        'inset-inline-start: var(--bitbi-public-header-inset)',
        'inline-size: 0',
        'block-size: 0',
        'pointer-events: none',
      ].join(';');
      document.body.appendChild(insetProbe);
      const publicHeaderInset = insetProbe.getBoundingClientRect().left;
      insetProbe.remove();
      const mood = document.querySelector('#navbar .site-nav__mood');
      return {
        viewportWidth: window.innerWidth,
        publicHeaderInset,
        logo: rect('#navbar .site-nav__logo'),
        links: rect('#navbar .site-nav__links'),
        actions: rect('#navbar .site-nav__actions'),
        moodDisplay: mood ? window.getComputedStyle(mood).display : null,
        documentScrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(Math.abs(metrics.logo.left - metrics.publicHeaderInset)).toBeLessThanOrEqual(2);
    expect(Math.abs((metrics.viewportWidth - metrics.actions.right) - metrics.publicHeaderInset)).toBeLessThanOrEqual(2);
    expect(Math.abs((metrics.links.left + metrics.links.width / 2) - metrics.viewportWidth / 2)).toBeLessThanOrEqual(3);
    expect(metrics.links.left).toBeGreaterThan(metrics.logo.right);
    expect(metrics.links.right).toBeLessThan(metrics.actions.left);
    expect(metrics.moodDisplay).not.toBe('none');
    expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  });

  test('cold load with no hash keeps every nav group collapsed while Dashboard content is visible', async ({ page }) => {
    await page.goto('/admin/index.html');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    // Dashboard content must be visible even though the Overview dropdown is collapsed.
    await expect(page.locator('#sectionDashboard')).toBeVisible();

    const overviewToggle = page.locator('.admin-nav__group:has(a[data-section="dashboard"]) > .admin-nav__group-toggle');
    const usersToggle = page.locator('.admin-nav__group:has(a[data-section="users"]) > .admin-nav__group-toggle');
    const aiToggle = page.locator('.admin-nav__group:has(a[data-section="ai-lab"]) > .admin-nav__group-toggle');
    const systemToggle = page.locator('.admin-nav__group:has(a[data-section="settings"]) > .admin-nav__group-toggle');
    const referenceToggle = page.locator('.admin-nav__group:has(a[data-section="content"]) > .admin-nav__group-toggle');

    await expect(overviewToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(usersToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(aiToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(systemToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(referenceToggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('opening one nav group collapses any previously open group (single-open accordion)', async ({ page }) => {
    await page.goto('/admin/index.html#dashboard');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    const usersToggle = page.locator('.admin-nav__group:has(a[data-section="users"]) > .admin-nav__group-toggle');
    const aiToggle = page.locator('.admin-nav__group:has(a[data-section="ai-lab"]) > .admin-nav__group-toggle');
    const systemToggle = page.locator('.admin-nav__group:has(a[data-section="settings"]) > .admin-nav__group-toggle');

    await usersToggle.click();
    await expect(usersToggle).toHaveAttribute('aria-expanded', 'true');

    await aiToggle.click();
    await expect(aiToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(usersToggle).toHaveAttribute('aria-expanded', 'false');

    await systemToggle.click();
    await expect(systemToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(aiToggle).toHaveAttribute('aria-expanded', 'false');

    // Clicking the currently open group toggles it closed.
    await systemToggle.click();
    await expect(systemToggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('nav accordion supports keyboard expansion, child focus, and Escape collapse', async ({ page }) => {
    await page.goto('/admin/index.html#dashboard');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    const usersGroup = page.locator('.admin-nav__group:has(a[data-section="users"])');
    const usersToggle = usersGroup.locator('> .admin-nav__group-toggle');
    const usersLink = usersGroup.locator('a[data-section="users"]');

    await usersToggle.focus();
    await page.keyboard.press('ArrowDown');
    await expect(usersToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(usersLink).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(usersToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(usersToggle).toBeFocused();

    await page.keyboard.press('End');
    const referenceToggle = page.locator('.admin-nav__group:has(a[data-section="content"]) > .admin-nav__group-toggle');
    await expect(referenceToggle).toBeFocused();
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

  test('cold deep link to #content auto-expands the Reference group on load', async ({ page }) => {
    await page.goto('/admin/index.html#content');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sectionContent')).toBeVisible();

    const referenceGroup = page.locator('.admin-nav__group:has(a[data-section="content"])');
    const referenceToggle = referenceGroup.locator('> .admin-nav__group-toggle');
    await expect(referenceToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(referenceGroup).toHaveClass(/admin-nav__group--expanded/);
    await expect(referenceGroup).toHaveClass(/admin-nav__group--active/);
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
    await expect(page.locator('link[href*="css/account/assets-manager.css?v="]')).toHaveCount(1);
    await expect(page.locator('script[src*="js/pages/admin/main.js?v="]')).toHaveCount(1);
    await expect(page.locator('#adminHeroTitle')).toHaveText('AI Lab');
    await expect(page.locator('#sectionAiLab')).toBeVisible();
    await expect(page.locator('#aiModelsText')).toContainText('GPT OSS 20B');
    await expect(page.locator('#aiModelsText')).toContainText('Gemma 4 26B A4B');
    await expect(page.locator('#aiModelsImage')).toContainText('FLUX.1 Schnell');
    await expect(page.locator('#aiModelsImage')).toContainText('FLUX.2 Klein 9B');
    await expect(page.locator('#aiModelsImage')).toContainText('FLUX.2 Dev');
    await expect(page.locator('#aiModelsImage')).toContainText('FLUX.2 Max');
    await expect(page.locator('#aiModelsImage')).toContainText('GPT Image 2');
    await expect(page.locator('#aiModelsImage')).toContainText('OpenAI via Cloudflare AI Gateway');
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
    await expect(page.locator('#aiImageModel option')).toHaveCount(6);
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

    await page.selectOption('#aiImageModel', 'black-forest-labs/flux-2-max');
    await expect(page.locator('#aiImageRun')).toContainText(/Run image test · \d+ credits?/);
    await expect(page.locator('#aiImageOrganizationState')).toContainText('charges');
    await expect(page.locator('#aiImageOrganizationState')).not.toContainText('No admin image-test credit charge');

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
    await page.selectOption('#aiImageModel', 'black-forest-labs/flux-2-max');
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

  test('FLUX.2 Max cleans stale image state and sends only supported charged fields', async ({ page }) => {
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
      ],
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        'bitbi_admin_ai_lab_state_v1',
        JSON.stringify({
          activeMode: 'image',
          forms: {
            image: {
              preset: 'image_fast',
              model: 'black-forest-labs/flux-2-max',
              prompt: 'Stale state should not leak unsupported fields.',
              promptMode: 'structured',
              structuredPrompt: '{"legacy":true}',
              width: 1024,
              height: 1024,
              steps: 4,
              seed: '77',
              guidance: 7.5,
              quality: 'high',
              size: '1024x1024',
              outputFormat: 'webp',
              background: 'auto',
              safetyTolerance: 4,
              referenceImages: [],
              referenceImageDimensions: [],
              organizationId: '',
            },
          },
        }),
      );
    });

    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await clickAiLabMode(page, 'image');
    await expect(page.locator('#aiImageModel')).toHaveValue('black-forest-labs/flux-2-max');
    await expect(page.locator('#aiImageStepsField')).toBeHidden();
    await expect(page.locator('#aiImageGuidanceField')).toBeHidden();
    await expect(page.locator('#aiImagePromptModeField')).toBeHidden();
    await expect(page.locator('#aiImageQualityField')).toBeHidden();
    await expect(page.locator('#aiImageSizeField')).toBeHidden();
    await expect(page.locator('#aiImageBackgroundField')).toBeHidden();
    await expect(page.locator('#aiImageOrganizationState')).not.toContainText('No admin image-test credit charge');

    await page.locator('#aiImageRun').click();
    await expect(page.locator('#aiImageState')).toContainText('Image response ready.');
    expect(imageTestRequests).toHaveLength(1);
    expect(imageTestRequests[0]).toEqual(expect.objectContaining({
      model: 'black-forest-labs/flux-2-max',
      prompt: 'Stale state should not leak unsupported fields.',
      width: 1024,
      height: 1024,
      seed: 77,
      outputFormat: 'webp',
      safetyTolerance: 4,
      organization_id: 'org_11111111111111111111111111111111',
    }));
    for (const unsupportedKey of ['steps', 'guidance', 'structuredPrompt', 'quality', 'size', 'background']) {
      expect(imageTestRequests[0]).not.toHaveProperty(unsupportedKey);
    }
  });

  test('Music AI card validates, posts the expected payload, and renders success plus error states beside Live Agent', async ({
    page,
  }) => {
    const musicRequests = [];
    const saveAudioRequests = [];
    await page.unroute('**/api/ai/audio/save');
    await page.route('**/api/ai/audio/save', async (route) => {
      saveAudioRequests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            id: 'audio-saved-from-url',
            source_module: 'music',
            mime_type: 'audio/mpeg',
            size_bytes: 15,
          },
        }),
      });
    });
    await page.route('https://ai-gateway-outputs-test.cloudflarestorage.com/provider-outputs/music-admin-test.mp3?X-Amz-Signature=mock', async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'audio/mpeg',
          'content-length': '16',
        },
        body: 'mock-mp3-bytes!!',
      });
    });
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
            audioUrl: 'https://ai-gateway-outputs-test.cloudflarestorage.com/provider-outputs/music-admin-test.mp3?X-Amz-Signature=mock',
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
    await expect(page.locator('#aiMusicSave')).toBeVisible();
    await expect(page.locator('#aiMusicPreview')).toContainText(
      'Save copies the audio through Bitbi',
    );
    await expect(page.locator('#aiMusicState')).toContainText('Music response ready.');
    await expect(page.locator('#aiMusicLyricsOutput')).toContainText('Hold the light inside the circuit');
    await page.locator('#aiMusicSave').click();
    await expect(page.locator('#aiLabSaveModal')).toBeVisible();
    await page.locator('#aiLabSaveInput').fill('Warm Electronic Pop');
    await page.locator('#aiLabSaveConfirm').click();
    await expect(page.locator('#aiLabSaveModal')).toBeHidden();
    expect(saveAudioRequests).toHaveLength(1);
    expect(saveAudioRequests[0]).toEqual(expect.objectContaining({
      title: 'Warm Electronic Pop',
      prompt: 'Warm electronic pop with a wide chorus.',
      mimeType: 'audio/mpeg',
      sizeBytes: 702144,
      audioUrl: 'https://ai-gateway-outputs-test.cloudflarestorage.com/provider-outputs/music-admin-test.mp3?X-Amz-Signature=mock',
      audioBase64: null,
    }));
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
    await expect(page.locator('#aiVideoPreview')).toContainText(
      'protected async job output',
    );
    await expect(page.locator('#aiVideoSave')).toBeVisible();
    await page.locator('#aiVideoSave').click();
    await expect(page.locator('#aiLabSaveModal')).toBeVisible();
    await page.locator('#aiLabSaveInput').fill('Saved Video Output');
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
      title: 'Saved Video Output',
      sourceModule: 'video',
      folderId: 'folder-launches',
    }));
    expect(saveTextAssetRequests[4].data).toEqual(expect.objectContaining({
      videoJobId: expect.stringMatching(/^mock-video-job-/),
      prompt: 'Save this video output',
      model: expect.objectContaining({ id: expect.any(String) }),
    }));
    expect(saveTextAssetRequests[4].data.videoUrl).toBeUndefined();
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

  test('uses the 600 second default timeout for slow Video AI requests without breaking abort handling', async ({
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

    await expect(page.locator('#aiVideoState')).toContainText('Video request timed out after 600 s.');
    await expect(page.locator('#aiVideoState')).not.toContainText('cancelled');
    await expect(page.locator('#aiLabStatus')).toContainText('Video request timed out after 600 s.');
    await expect(page.locator('#aiVideoRun')).toBeEnabled();
    await expect(page.locator('#aiVideoCancel')).toBeDisabled();

    await wait(750);
    await expect(page.locator('#aiVideoState')).toContainText('Video request timed out after 600 s.');
    await expect(page.locator('#aiVideoPreview video')).toHaveCount(0);
    await expect(page.locator('#aiVideoSave')).toBeHidden();
  });

  test('pauses Video AI status polling on rate limits and can resume the saved async job', async ({
    page,
  }) => {
    const catalog = createMockAiCatalog();
    let statusMode = 'rate_limited';

    await page.addInitScript(() => {
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (fn, delay, ...args) => {
        const nextDelay = typeof delay === 'number' && delay > 1000 && delay < 60_000 ? 30 : delay;
        return nativeSetTimeout(fn, nextDelay, ...args);
      };
    });

    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.unroute('**/api/admin/ai/video-jobs');
    await page.unroute('**/api/admin/ai/video-jobs/*');
    await page.route('**/api/admin/ai/video-jobs/rate-limit-job', async (route) => {
      if (statusMode === 'rate_limited') {
        await route.fulfill({
          status: 429,
          headers: { 'retry-after': '2' },
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            error: 'Too many requests. Please try again later.',
            code: 'rate_limited',
            retryAfterSeconds: 2,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          job: {
            jobId: 'rate-limit-job',
            status: 'succeeded',
            provider: 'workers-ai',
            model: catalog.models.video[0].id,
            createdAt: '2026-05-29T00:00:00.000Z',
            updatedAt: '2026-05-29T00:01:00.000Z',
            completedAt: '2026-05-29T00:01:00.000Z',
            statusUrl: '/api/admin/ai/video-jobs/rate-limit-job',
            outputUrl: '/api/admin/ai/video-jobs/rate-limit-job/output',
          },
        }),
      });
    });
    await page.route('**/api/admin/ai/video-jobs/rate-limit-job/output', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from([0, 0, 0, 0]),
      });
    });
    await page.route('**/api/admin/ai/video-jobs', async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          existing: false,
          job: {
            jobId: 'rate-limit-job',
            status: 'queued',
            provider: 'workers-ai',
            model: catalog.models.video[0].id,
            createdAt: '2026-05-29T00:00:00.000Z',
            updatedAt: '2026-05-29T00:00:00.000Z',
            completedAt: null,
            statusUrl: '/api/admin/ai/video-jobs/rate-limit-job',
          },
        }),
      });
    });

    await clickAiLabMode(page, 'video');
    await page.locator('#aiVideoPrompt').fill('Long Seedance style job');
    await page.locator('#aiVideoRun').click();

    await expect(page.locator('#aiVideoState')).toContainText('Status polling is rate limited');
    await expect(page.locator('#aiVideoState')).toContainText('video job is still running');
    await expect(page.locator('#aiVideoState')).not.toContainText('Video generation failed');
    await expect(page.locator('#aiVideoResumeJob')).toBeVisible();

    statusMode = 'succeeded';
    await page.locator('#aiVideoResumeJob').click();
    await expect(page.locator('#aiLabStatus')).toContainText('Video generation completed.');
    await expect(page.locator('#aiVideoDownload')).toBeVisible();
  });

  test('imports a provider response through the Admin Video AI recovery console and displays the protected job output', async ({
    page,
  }) => {
    let recoverRequest = null;

    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.unroute('**/api/admin/ai/video-jobs');
    await page.unroute('**/api/admin/ai/video-jobs/*');
    await page.route('**/api/admin/ai/video-jobs/recovery-job/recover', async (route) => {
      recoverRequest = {
        body: route.request().postDataJSON(),
        idempotencyKey: route.request().headers()['idempotency-key'],
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          job: {
            jobId: 'recovery-job',
            status: 'succeeded',
            provider: 'workers-ai',
            model: 'bytedance/seedance-2.0',
            createdAt: '2026-05-29T00:00:00.000Z',
            updatedAt: '2026-05-29T00:01:00.000Z',
            completedAt: '2026-05-29T00:01:00.000Z',
            statusUrl: '/api/admin/ai/video-jobs/recovery-job',
            outputUrl: '/api/admin/ai/video-jobs/recovery-job/output',
          },
          recovery: {
            previous_status: 'failed',
            recovered_url_host: 'provider.example.com',
          },
        }),
      });
    });
    await page.route('**/api/admin/ai/video-jobs/recovery-job/output', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from([0, 0, 0, 0]),
      });
    });

    await clickAiLabMode(page, 'video');
    await page.locator('#aiVideoRecovery summary').click();
    await page.locator('#aiVideoRecoveryJobId').fill('recovery-job');
    await page.locator('#aiVideoRecoveryRaw').fill(JSON.stringify({
      state: 'Completed',
      result: {
        video: 'https://provider.example.com/out.mp4?token=secret',
      },
    }));
    await page.locator('#aiVideoRecoveryReason').fill('Seedance completed after frontend rate limiting.');
    await page.locator('#aiVideoRecoveryImport').click();

    await expect(page.locator('#aiVideoRecoveryState')).toContainText('Recovered provider video imported and stored.');
    await expect(page.locator('#aiLabStatus')).toContainText('Recovered provider video imported and stored.');
    await expect(page.locator('#aiVideoDownload')).toBeVisible();
    await expect.poll(() => recoverRequest).toMatchObject({
      body: {
        providerResponseRaw: expect.stringContaining('provider.example.com'),
        operatorReason: 'Seedance completed after frontend rate limiting.',
      },
      idempotencyKey: expect.stringMatching(/^admin-video-recover:recovery-job:/),
    });
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

  test('shows the admin-only Video AI model cards in the admin AI Lab', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await clickAiLabMode(page, 'video');
    await expect(page.locator('#aiVideoCardPixverse')).toBeVisible();
    await expect(page.locator('#aiVideoCardVidu')).toBeVisible();
    await expect(page.locator('#aiVideoCardVidu')).toContainText('vidu/q3-pro');
    await expect(page.locator('#aiVideoCardHappyHorse')).toBeVisible();
    await expect(page.locator('#aiVideoCardHappyHorse')).toContainText('alibaba/hh1-t2v');
    await expect(page.locator('#aiVideoCardSeedanceFast')).toBeVisible();
    await expect(page.locator('#aiVideoCardSeedanceFast')).toContainText('bytedance/seedance-2.0-fast');
    await expect(page.locator('#aiVideoCardSeedance')).toBeVisible();
    await expect(page.locator('#aiVideoCardSeedance')).toContainText('bytedance/seedance-2.0');
    await expect(page.locator('#aiVideoCardGrokImagine')).toBeVisible();
    await expect(page.locator('#aiVideoCardGrokImagine')).toContainText('xai/grok-imagine-video');
  });

  test('Seedance Video AI models show priced admin-only estimates and keep payloads bounded', async ({
    page,
  }) => {
    const requests = [];
    let statusPolls = 0;

    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.unroute('**/api/admin/ai/video-jobs');
    await page.route('**/api/admin/ai/video-jobs/vidjob_seedance_priced_*', async (route) => {
      statusPolls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          job: {
            jobId: 'vidjob_seedance_priced',
            status: 'succeeded',
            provider: 'workers-ai',
            model: requests.at(-1)?.model || 'bytedance/seedance-2.0-fast',
            createdAt: '2026-05-25T00:00:00.000Z',
            updatedAt: '2026-05-25T00:00:01.000Z',
            completedAt: '2026-05-25T00:00:01.000Z',
            outputUrl: '/api/admin/ai/video-jobs/vidjob_seedance_priced/output',
          },
        }),
      });
    });
    await page.route('**/api/admin/ai/video-jobs', async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          existing: false,
          job: {
            jobId: `vidjob_seedance_priced_${requests.length}`,
            status: 'queued',
            provider: 'workers-ai',
            model: requests.at(-1)?.model || 'bytedance/seedance-2.0-fast',
            createdAt: '2026-05-25T00:00:00.000Z',
            updatedAt: '2026-05-25T00:00:00.000Z',
            completedAt: null,
            statusUrl: `/api/admin/ai/video-jobs/vidjob_seedance_priced_${requests.length}`,
            budgetPolicy: {
              seedance_pricing: {
                status: 'operator_approved_admin_pricing',
                pricing_configured: true,
                credit_debit: false,
                estimated_credits: 4,
              },
            },
          },
        }),
      });
    });

    await clickAiLabMode(page, 'video');
    await page.locator('#aiVideoCardSeedanceFast').click();
    await expect(page.locator('#aiVideoModelBadge')).toContainText('bytedance/seedance-2.0-fast');
    await expect(page.locator('#aiVideoNegativePromptField')).toBeHidden();
    await expect(page.locator('#aiVideoImageField')).toBeHidden();
    await expect(page.locator('#aiVideoStartImageField')).toBeHidden();
    await expect(page.locator('#aiVideoEndImageField')).toBeHidden();
    await expect(page.locator('#aiVideoResolutionField')).toBeVisible();
    await expect(page.locator('#aiVideoSeedField')).toBeHidden();
    await expect(page.locator('label:has(#aiVideoGenerateAudio)')).toBeHidden();
    await expect(page.locator('#aiVideoDuration')).toHaveAttribute('min', '4');
    await expect(page.locator('#aiVideoDuration')).toHaveAttribute('max', '12');
    await expect(page.locator('#aiVideoState')).toContainText('Estimated credits:');
    await expect(page.locator('#aiVideoState')).not.toContainText('Cost discovery');
    await expect(page.locator('#aiVideoRun')).toContainText('credit');
    await expect(page.locator('#aiVideoInlineError')).toBeEmpty();
    await expect(page.locator('#aiVideoResolution option:not([hidden])')).toHaveText(['480p', '720p']);
    await expect(page.locator('#aiVideoResolution option[value="1080p"]')).toHaveAttribute('disabled', '');
    await expect(page.locator('#aiVideoResolution option[value="1080p"]')).toHaveAttribute('hidden', '');

    await page.locator('#aiVideoPrompt').fill('A fast Seedance smoke test');
    await page.locator('#aiVideoResolution').selectOption('480p');
    await expect(page.locator('#aiVideoRun')).toBeEnabled();
    const fast480Label = await page.locator('#aiVideoRun').textContent();
    await page.locator('#aiVideoRun').click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toMatchObject({
      preset: 'video_seedance_2_fast',
      model: 'bytedance/seedance-2.0-fast',
      prompt: 'A fast Seedance smoke test',
      duration: 5,
      aspect_ratio: '16:9',
      resolution: '480p',
    });
    expect(requests[0].negative_prompt).toBeUndefined();
    expect(requests[0].seed).toBeUndefined();
    expect(requests[0].image_input).toBeUndefined();
    expect(requests[0].audio).toBeUndefined();
    expect(requests[0].generate_audio).toBeUndefined();
    await expect.poll(() => statusPolls).toBeGreaterThan(0);

    await page.locator('#aiVideoCardSeedance').click();
    await expect(page.locator('#aiVideoModelBadge')).toContainText('bytedance/seedance-2.0');
    await expect(page.locator('#aiVideoDuration')).toHaveAttribute('min', '4');
    await expect(page.locator('#aiVideoDuration')).toHaveAttribute('max', '12');
    await expect(page.locator('#aiVideoResolutionField')).toBeVisible();
    await page.locator('#aiVideoResolution').selectOption('720p');
    await page.locator('#aiVideoPrompt').fill('A standard Seedance smoke test');
    await expect(page.locator('#aiVideoRun')).toBeEnabled();
    const standard720Label = await page.locator('#aiVideoRun').textContent();
    expect(standard720Label).not.toBe(fast480Label);
    await page.locator('#aiVideoRun').click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1]).toMatchObject({
      preset: 'video_seedance_2',
      model: 'bytedance/seedance-2.0',
      prompt: 'A standard Seedance smoke test',
      duration: 5,
      aspect_ratio: '16:9',
      resolution: '720p',
    });
    expect(JSON.stringify(requests)).not.toContain('credits');
    expect(JSON.stringify(requests)).not.toContain('negative_prompt');

    await page.locator('#aiVideoCardPixverse').click();
    await expect(page.locator('#aiVideoModelBadge')).toContainText('pixverse/v6');
    await expect(page.locator('#aiVideoRun')).toBeEnabled();
    await expect(page.locator('#aiVideoImageField')).toBeVisible();
    await expect(page.locator('#aiVideoNegativePromptField')).toBeVisible();
    await expect(page.locator('#aiVideoSeedField')).toBeVisible();
    await expect(page.locator('label:has(#aiVideoGenerateAudio)')).toBeVisible();
  });

  test('Grok Imagine Video shows only supported controls and sends a sanitized async payload', async ({
    page,
  }) => {
    const requests = [];
    let statusPolls = 0;

    await page.addInitScript(() => {
      const staleState = {
        forms: {
          video: {
            model: 'xai/grok-imagine-video',
            preset: 'video_grok_imagine',
            prompt: 'stale grok prompt',
            negativePrompt: 'stale negative prompt',
            imageInput: 'data:image/png;base64,AAAA',
            startImageInput: 'data:image/png;base64,BBBB',
            endImageInput: 'data:image/png;base64,CCCC',
            duration: 5,
            aspectRatio: '16:9',
            quality: '1080p',
            resolution: '720p',
            seed: '123',
            generateAudio: true,
          },
        },
      };
      localStorage.setItem('bitbi_admin_ai_lab_state_v1', JSON.stringify(staleState));
    });

    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.unroute('**/api/admin/ai/video-jobs');
    await page.route('**/api/admin/ai/video-jobs/vidjob_grok_*', async (route) => {
      statusPolls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          job: {
            jobId: 'vidjob_grok',
            status: 'succeeded',
            provider: 'xai',
            model: 'xai/grok-imagine-video',
            createdAt: '2026-05-31T00:00:00.000Z',
            updatedAt: '2026-05-31T00:00:01.000Z',
            completedAt: '2026-05-31T00:00:01.000Z',
            outputUrl: '/api/admin/ai/video-jobs/vidjob_grok/output',
          },
        }),
      });
    });
    await page.route('**/api/admin/ai/video-jobs/vidjob_grok/output', async (route) => {
      await fulfillTestMp4(route);
    });
    await page.route('**/api/admin/ai/video-jobs', async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          existing: false,
          job: {
            jobId: `vidjob_grok_${requests.length}`,
            status: 'queued',
            provider: 'xai',
            model: 'xai/grok-imagine-video',
            createdAt: '2026-05-31T00:00:00.000Z',
            updatedAt: '2026-05-31T00:00:00.000Z',
            completedAt: null,
            statusUrl: `/api/admin/ai/video-jobs/vidjob_grok_${requests.length}`,
            budgetPolicy: {
              grok_imagine_pricing: {
                status: 'operator_approved_admin_pricing',
                pricing_configured: true,
                credit_debit: false,
                estimated_credits: 10,
              },
            },
          },
        }),
      });
    });

    await clickAiLabMode(page, 'video');
    await page.locator('#aiVideoCardGrokImagine').click();
    await expect(page.locator('#aiVideoModelBadge')).toContainText('xai/grok-imagine-video');
    await expect(page.locator('#aiVideoModelDesc')).toContainText('Unified Billing');
    await expect(page.locator('#aiVideoNegativePromptField')).toBeHidden();
    await expect(page.locator('#aiVideoImageField')).toBeHidden();
    await expect(page.locator('#aiVideoStartImageField')).toBeHidden();
    await expect(page.locator('#aiVideoEndImageField')).toBeHidden();
    await expect(page.locator('#aiVideoResolutionField')).toBeVisible();
    await expect(page.locator('#aiVideoQualityField')).toBeHidden();
    await expect(page.locator('#aiVideoSeedField')).toBeHidden();
    await expect(page.locator('label:has(#aiVideoGenerateAudio)')).toBeHidden();
    await expect(page.locator('label:has(#aiVideoMinimalMode)')).toBeHidden();
    await expect(page.locator('#aiVideoDuration')).toHaveAttribute('min', '1');
    await expect(page.locator('#aiVideoDuration')).toHaveAttribute('max', '15');
    await expect(page.locator('#aiVideoState')).toContainText('Estimated credits:');
    await expect(page.locator('#aiVideoRun')).toContainText('credit');
    await expect(page.locator('#aiVideoInlineError')).toBeEmpty();
    await expect(page.locator('#aiVideoResolution option:not([hidden])')).toHaveText(['480p', '720p']);
    await expect(page.locator('#aiVideoResolution option[value="1080p"]')).toHaveAttribute('disabled', '');
      await expect.poll(async () => page.locator('#aiVideoAspectRatio option:not([hidden])').allTextContents()).toEqual(
        expect.arrayContaining(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']),
      );
      await expect(page.locator('#aiVideoAspectRatio option[value="21:9"]')).toHaveAttribute('disabled', '');
      await expect(page.locator('#aiVideoAspectRatio option[value="21:9"]')).toHaveAttribute('hidden', '');

    await page.locator('#aiVideoPrompt').fill('A Grok Imagine smoke test');
    await page.locator('#aiVideoResolution').selectOption('480p');
    await page.locator('#aiVideoRun').click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual({
      preset: 'video_grok_imagine',
      model: 'xai/grok-imagine-video',
      duration: 5,
      prompt: 'A Grok Imagine smoke test',
      _operation: 'generate',
      aspect_ratio: '16:9',
      resolution: '480p',
    });
    for (const unsupported of [
      'quality',
      'seed',
      'negative_prompt',
      'generate_audio',
      'audio',
      'watermark',
      'image_input',
      'start_image',
      'end_image',
      'ratio',
      'gateway_mode',
      'minimal_mode',
    ]) {
      expect(requests[0][unsupported]).toBeUndefined();
    }
    await expect.poll(() => statusPolls).toBeGreaterThan(0);
    await expect(page.locator('#aiVideoPreview video')).toHaveCount(1);
    await expect(page.locator('#aiVideoMeta')).toContainText('Text-to-Video');
  });

  test('HappyHorse 1.0 T2V sends only supported Cloudflare fields and shows admin cost metadata', async ({
    page,
  }) => {
    const catalog = createMockAiCatalog();
    const happyHorseModel = catalog.models.video.find((entry) => entry.id === 'alibaba/hh1-t2v');
    const requests = [];

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
            jobId: `happyhorse-job-${requests.length}`,
            status: 'succeeded',
            provider: 'workers-ai',
            model: happyHorseModel.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            statusUrl: `/api/admin/ai/video-jobs/happyhorse-job-${requests.length}`,
            outputUrl: 'https://example.com/generated-video.mp4',
          },
        }),
      });
    });

    await clickAiLabMode(page, 'video');
    await page.locator('#aiVideoCardHappyHorse').click();

    await expect(page.locator('#aiVideoModelBadge')).toContainText('alibaba/hh1-t2v');
    await expect(page.locator('#aiVideoNegativePromptField')).toBeHidden();
    await expect(page.locator('#aiVideoImageField')).toBeHidden();
    await expect(page.locator('#aiVideoStartImageField')).toBeHidden();
    await expect(page.locator('#aiVideoEndImageField')).toBeHidden();
    await expect(page.locator('#aiVideoResolutionField')).toBeVisible();
    await expect(page.locator('#aiVideoSeedField')).toBeVisible();
    await expect(page.locator('label:has(#aiVideoMinimalMode)')).toBeHidden();
    await expect(page.locator('#aiVideoAudioLabel')).toHaveText('Watermark');
    await expect(page.locator('#aiVideoDuration')).toHaveAttribute('min', '3');
    await expect(page.locator('#aiVideoDuration')).toHaveAttribute('max', '15');

    await page.locator('#aiVideoPrompt').fill('A cinematic camera push through a rain-lit market at night');
    await page.locator('#aiVideoDuration').fill('10');
    await page.selectOption('#aiVideoAspectRatio', '3:4');
    await page.selectOption('#aiVideoResolution', '1080P');
    await page.locator('#aiVideoSeed').fill('12345');
    await page.locator('#aiVideoGenerateAudio').check();
    await page.locator('#aiVideoRun').click();

    await expect(page.locator('#aiVideoPreview video')).toHaveCount(1);
    await expect(page.locator('#aiVideoMeta')).toContainText('Watermark');
    await expect(page.locator('#aiVideoMeta')).toContainText('Estimated Provider Cost');
    await expect(page.locator('#aiVideoMeta')).toContainText('Future Member Credits');
    await expect(page.locator('#aiVideoMeta')).toContainText('Admin Credits Charged');

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      preset: 'video_happyhorse_1_0_t2v',
      model: 'alibaba/hh1-t2v',
      prompt: 'A cinematic camera push through a rain-lit market at night',
      duration: 10,
      ratio: '3:4',
      resolution: '1080P',
      seed: 12345,
      watermark: true,
    });
    expect(requests[0].aspect_ratio).toBeUndefined();
    expect(requests[0].quality).toBeUndefined();
    expect(requests[0].audio).toBeUndefined();
    expect(requests[0].generate_audio).toBeUndefined();
    expect(requests[0].negative_prompt).toBeUndefined();
    expect(requests[0].image_input).toBeUndefined();
    expect(requests[0].start_image).toBeUndefined();
    expect(requests[0].end_image).toBeUndefined();
    expect(requests[0].minimal_mode).toBeUndefined();
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

    // Select FLUX.2 Max — image dimensions, seed, output format, safety, and 8 refs are enabled; unsupported controls stay hidden/disabled.
    await page.selectOption('#aiImageModel', 'black-forest-labs/flux-2-max');
    await expect(page.locator('#aiImageWidthField')).toBeVisible();
    await expect(page.locator('#aiImageHeightField')).toBeVisible();
    await expect(page.locator('#aiImageSeedField')).not.toHaveClass(/admin-ai__field--disabled/);
    await expect(page.locator('#aiImageStepsField')).toBeHidden();
    await expect(page.locator('#aiImageGuidanceField')).toBeHidden();
    await expect(page.locator('#aiImagePromptModeField')).toBeHidden();
    await expect(page.locator('#aiImageQualityField')).toBeHidden();
    await expect(page.locator('#aiImageSizeField')).toBeHidden();
    await expect(page.locator('#aiImageBackgroundField')).toBeHidden();
    await expect(page.locator('#aiImageQuality')).toBeDisabled();
    await expect(page.locator('#aiImageSize')).toBeDisabled();
    await expect(page.locator('#aiImageBackground')).toBeDisabled();
    await expect(page.locator('#aiImageOutputFormatField')).toBeVisible();
    await expect(page.locator('#aiImageSafetyField')).toBeVisible();
    await expect(page.locator('#aiImageRefSection')).not.toHaveClass(/admin-ai__ref-images--disabled/);
    await expect(page.locator('#aiImageRefCount')).toHaveText('0 / 8');
    await expect(page.locator('#aiImageOutputFormat')).toHaveValue('jpeg');
    await expect(page.locator('#aiImageSafetyTolerance')).toHaveValue('2');
    await expect(page.locator('#aiImageWidth')).toHaveAttribute('min', '64');
    await expect(page.locator('#aiImageWidth')).toHaveAttribute('max', '2048');
  });

  test('shows GPT Image 2 controls, 16 reference slots, and credit preview', async ({ page }) => {
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
    await page.route('**/api/admin/orgs**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/admin/orgs') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            organizations: [{ id: 'org_11111111111111111111111111111111', name: 'First Billing Org' }],
          }),
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, billing: { creditBalance: 500 } }),
      });
    });

    await page.goto('/admin/index.html#ai-lab');
    await clickAiLabMode(page, 'image');
    await page.selectOption('#aiImageModel', 'openai/gpt-image-2');

    await expect(page.locator('#aiImageGptControls')).toBeVisible();
    await expect(page.locator('#aiImageWidthField')).toBeHidden();
    await expect(page.locator('#aiImageHeightField')).toBeHidden();
    await expect(page.locator('#aiImageStepsField')).toBeHidden();
    await expect(page.locator('#aiImageSeedField')).toBeHidden();
    await expect(page.locator('#aiImageGuidanceField')).toBeHidden();
    await expect(page.locator('#aiImagePromptModeField')).toBeHidden();
    await expect(page.locator('#aiImageRefSection')).not.toHaveClass(/admin-ai__ref-images--disabled/);
    await expect(page.locator('#aiImageRefCount')).toHaveText('0 / 16');
    await expect(page.locator('.admin-ai__ref-slot[data-ref-index="15"]')).toBeVisible();
    await expect(page.locator('#aiImageBackground')).not.toContainText('transparent');
    await expect(page.locator('#aiImageGptCostHint')).toContainText('Estimated credits: 50');

    await page.selectOption('#aiImageQuality', 'high');
    await page.selectOption('#aiImageSize', '1536x1024');
    await expect(page.locator('#aiImageGptCostHint')).toContainText('Estimated credits: 150');

    await page.selectOption('#aiImageSize', 'auto');
    await expect(page.locator('#aiImageGptCostHint')).toContainText('Estimated credits: 200');
    await expect(page.locator('#aiImageGptCostHint')).toContainText('Auto settings are charged at the safe upper-bound credit price.');
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
// Sound Lab public browsing — logged-out state
// ---------------------------------------------------------------------------

test.describe('Sound Lab public browsing', () => {
  test('Sound Lab shows public tracks without locked Free or Exclusive category cards when logged out', async ({ page }) => {
    await page.route(/\/api\/gallery\/memtracks(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                id: 'feedc0de',
                slug: 'memtrack-feedc0de',
                title: 'Public Member Track',
                category: 'memtracks',
                file: { url: '/api/gallery/memtracks/feedc0de/vpub/file' },
                poster: { url: '/api/gallery/memtracks/feedc0de/vpub/poster', w: 320, h: 320 },
              },
            ],
            has_more: false,
            next_cursor: null,
            applied_limit: 60,
          },
        }),
      });
    });

    await page.goto('/');
    // Wait for auth UI to resolve before checking logged-out public content.
    await expect(page.locator('.site-nav__cta')).toBeVisible({
      timeout: 10_000,
    });
    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Sound Lab' }).click();
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', 'sound');

    await expect(page.locator('#soundlab .snd-filter-btn')).toHaveCount(0);
    await expect(page.locator('#soundLabTracks .locked-area')).toHaveCount(0);
    await expect(page.locator('#soundLabTracks .snd-card--memtrack').first()).toBeVisible();
  });
});
