/* ============================================================
   BITBI — Generate Lab model registry
   Frontend-only registry for member-facing generation tools.
   Server-side routes remain the source of truth for validation,
   billing, rate limits, and persistence.
   ============================================================ */

import {
    DEFAULT_AI_IMAGE_MODEL,
    getGenerateLabAiImageModelOptions,
    getAiImageModelConfig,
} from '../../shared/ai-image-models.mjs?v=__ASSET_VERSION__';
import {
    GPT_IMAGE_2_MODEL_ID,
    calculateGptImage2CreditCost,
} from '../../shared/gpt-image-2-pricing.mjs?v=__ASSET_VERSION__';
import {
    calculatePixverseV6MemberCredits,
    PIXVERSE_V6_ASPECT_RATIOS,
    PIXVERSE_V6_MAX_DURATION,
    PIXVERSE_V6_MIN_DURATION,
    PIXVERSE_V6_MODEL_ID,
    PIXVERSE_V6_MODEL_LABEL,
    PIXVERSE_V6_QUALITIES,
} from '../../shared/pixverse-v6-pricing.mjs?v=__ASSET_VERSION__';

export const GENERATE_LAB_MEDIA_TYPES = Object.freeze([
    Object.freeze({
        id: 'image',
        label: 'Images',
        noun: 'image',
        promptLabel: 'Describe your image',
        promptPlaceholder: 'A luminous glass sculpture in a rain-soaked cyberpunk gallery, cinematic lighting, high detail...',
        promptHelp: 'Describe the subject, setting, style, mood, and lighting.',
        emptyTitle: 'Your generated image will appear here.',
        emptyCopy: 'Tune the prompt and image controls, then create a new private result.',
    }),
    Object.freeze({
        id: 'video',
        label: 'Video',
        noun: 'video',
        promptLabel: 'Describe your video',
        promptPlaceholder: 'A cinematic neon city street at night, slow camera push-in, rain reflections, dramatic lighting...',
        promptHelp: 'Describe the action, camera movement, style, mood, and lighting.',
        emptyTitle: 'Your generated video will appear here.',
        emptyCopy: 'PixVerse saves member videos into Assets Manager when generation succeeds.',
    }),
    Object.freeze({
        id: 'music',
        label: 'Music',
        noun: 'track',
        promptLabel: 'Describe your track',
        promptPlaceholder: 'Dreamy synthwave with warm analog bass, airy female vocal hooks, nocturnal city mood...',
        promptHelp: 'Use style, mood, structure, instruments, tempo, and vocal direction.',
        emptyTitle: 'Your generated track will appear here.',
        emptyCopy: 'Music generation can take up to 2 minutes and saves into Assets Manager.',
    }),
]);

export const MUSIC_26_MODEL_ID = 'minimax/music-2.6';
export const MUSIC_BASE_CREDITS = 150;
export const MUSIC_GENERATED_LYRICS_CREDITS = 160;

const imageModels = getGenerateLabAiImageModelOptions().map((model) => {
    const config = getAiImageModelConfig(model.id);
    const credits = Math.max(1, Math.ceil(Number(config?.estimatedCredits || model.estimatedCredits || 1)));
    if (config?.requestMode === 'gpt-image-2' || model.id === GPT_IMAGE_2_MODEL_ID) {
        return Object.freeze({
            id: model.id,
            displayName: model.label,
            mediaType: 'image',
            provider: 'OpenAI',
            route: '/api/ai/generate-image',
            outputType: 'image',
            status: 'NEW',
            summary: 'OpenAI image generation and editing via Cloudflare AI Gateway.',
            capabilities: Object.freeze([
                'Text to image',
                'Image edit',
                'Multi-reference',
                'PNG / WebP / JPEG',
                'Savable to Assets Manager',
            ]),
            controls: Object.freeze({
                supportsSteps: false,
                supportsSeed: false,
                supportsQuality: true,
                supportsSize: true,
                supportsOutputFormat: true,
                supportsBackground: true,
                supportsReferenceImages: true,
                maxReferenceImages: 16,
            }),
            defaults: Object.freeze({
                model: model.id,
                quality: config?.defaultQuality || 'medium',
                size: config?.defaultSize || '1024x1024',
                outputFormat: config?.defaultOutputFormat || 'png',
                background: config?.defaultBackground || 'auto',
                referenceImages: Object.freeze([]),
            }),
            options: Object.freeze({
                quality: Object.freeze([...(config?.qualityOptions || ['low', 'medium', 'high', 'auto'])]),
                size: Object.freeze([...(config?.sizeOptions || ['1024x1024', '1024x1536', '1536x1024', 'auto'])]),
                outputFormat: Object.freeze([...(config?.outputFormatOptions || ['png', 'webp', 'jpeg'])]),
                background: Object.freeze([...(config?.backgroundOptions || ['auto', 'opaque'])]),
            }),
            estimateCredits: (values = {}) => calculateGptImage2CreditCost(values).credits,
        });
    }
    return Object.freeze({
        id: model.id,
        displayName: model.label,
        mediaType: 'image',
        provider: 'Cloudflare Workers AI',
        route: '/api/ai/generate-image',
        outputType: 'image',
        status: 'LIVE',
        summary: 'Fast member image generation for visual ideation and saved assets.',
        capabilities: Object.freeze([
            'Prompt-to-image',
            config?.supportsSteps ? 'Step control' : 'Default steps',
            config?.supportsSeed ? 'Optional seed' : 'Random seed',
            'Savable to Assets Manager',
        ]),
        controls: Object.freeze({
            supportsSteps: config?.supportsSteps === true,
            supportsSeed: config?.supportsSeed === true,
        }),
        defaults: Object.freeze({
            model: model.id,
            steps: 4,
            seed: '',
        }),
        estimateCredits: () => credits,
    });
});

const pixverseV6Model = Object.freeze({
    id: PIXVERSE_V6_MODEL_ID,
    displayName: PIXVERSE_V6_MODEL_LABEL,
    mediaType: 'video',
    provider: 'Workers AI via AI Gateway',
    route: '/api/ai/generate-video',
    outputType: 'video',
    status: 'LIVE',
    summary: 'Text-to-video and image-to-video generation with duration, quality, aspect, seed, and audio controls.',
    capabilities: Object.freeze([
        'Text-to-video',
        'Optional image-to-video reference',
        `${PIXVERSE_V6_MIN_DURATION}-${PIXVERSE_V6_MAX_DURATION} second duration`,
        `${PIXVERSE_V6_QUALITIES.join(', ')} quality`,
        'Auto-saved video asset',
    ]),
    defaults: Object.freeze({
        duration: 5,
        aspectRatio: PIXVERSE_V6_ASPECT_RATIOS[0],
        quality: '720p',
        generateAudio: true,
        negativePrompt: '',
        seed: '',
    }),
    estimateCredits: ({ duration, quality, generateAudio }) => calculatePixverseV6MemberCredits({
        duration,
        quality,
        generateAudio,
    }),
});

const music26Model = Object.freeze({
    id: MUSIC_26_MODEL_ID,
    displayName: 'MiniMax Music 2.6',
    mediaType: 'music',
    provider: 'MiniMax',
    route: '/api/ai/generate-music',
    outputType: 'audio',
    status: 'LIVE',
    summary: 'Member music generation with optional manual lyrics, instrumental mode, and generated lyrics.',
    capabilities: Object.freeze([
        'Prompt-to-music',
        'Optional manual lyrics',
        'Instrumental mode',
        'Generated lyrics option',
        'Auto-saved audio asset with cover workflow',
    ]),
    defaults: Object.freeze({
        instrumental: false,
        generateLyrics: false,
        lyrics: '',
    }),
    estimateCredits: ({ generateLyrics }) => generateLyrics ? MUSIC_GENERATED_LYRICS_CREDITS : MUSIC_BASE_CREDITS,
});

const models = Object.freeze([
    ...imageModels,
    pixverseV6Model,
    music26Model,
]);

const mediaTypesById = new Map(GENERATE_LAB_MEDIA_TYPES.map((type) => [type.id, type]));
const modelsById = new Map(models.map((model) => [model.id, model]));

export function getGenerateLabMediaType(mediaType) {
    return mediaTypesById.get(mediaType) || GENERATE_LAB_MEDIA_TYPES[0];
}

export function getGenerateLabModels() {
    return models;
}

export function getGenerateLabModelsByMediaType(mediaType) {
    return models.filter((model) => model.mediaType === mediaType);
}

export function getGenerateLabModel(modelId) {
    return modelsById.get(modelId) || models[0];
}

export function getDefaultGenerateLabModel(mediaType) {
    return getGenerateLabModelsByMediaType(mediaType)[0] || getGenerateLabModel(DEFAULT_AI_IMAGE_MODEL);
}

export function calculateGenerateLabCredits(modelId, values = {}) {
    const model = getGenerateLabModel(modelId);
    return model.estimateCredits(values);
}
