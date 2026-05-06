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
import { getCurrentLocale } from '../../shared/locale.js?v=__ASSET_VERSION__';

const LOCALE = getCurrentLocale();
const DE = LOCALE === 'de';

export const GENERATE_LAB_MEDIA_TYPES = Object.freeze([
    Object.freeze({
        id: 'image',
        label: DE ? 'Bilder' : 'Images',
        noun: DE ? 'Bild' : 'image',
        promptLabel: DE ? 'Beschreiben Sie Ihr Bild' : 'Describe your image',
        promptPlaceholder: DE ? 'Eine leuchtende Glasskulptur in einer regennassen Cyberpunk-Galerie, cineastisches Licht, hohe Detailtiefe...' : 'A luminous glass sculpture in a rain-soaked cyberpunk gallery, cinematic lighting, high detail...',
        promptHelp: DE ? 'Beschreiben Sie Motiv, Umgebung, Stil, Stimmung und Licht.' : 'Describe the subject, setting, style, mood, and lighting.',
        emptyTitle: DE ? 'Ihr generiertes Bild erscheint hier.' : 'Your generated image will appear here.',
        emptyCopy: DE ? 'Passen Sie Prompt und Bildeinstellungen an und erstellen Sie ein neues privates Ergebnis.' : 'Tune the prompt and image controls, then create a new private result.',
    }),
    Object.freeze({
        id: 'video',
        label: 'Video',
        noun: 'video',
        promptLabel: DE ? 'Beschreiben Sie Ihr Video' : 'Describe your video',
        promptPlaceholder: DE ? 'Eine cineastische Neon-Stadtstraße bei Nacht, langsame Kamerafahrt, Regenreflexionen, dramatisches Licht...' : 'A cinematic neon city street at night, slow camera push-in, rain reflections, dramatic lighting...',
        promptHelp: DE ? 'Beschreiben Sie Handlung, Kamerabewegung, Stil, Stimmung und Licht.' : 'Describe the action, camera movement, style, mood, and lighting.',
        emptyTitle: DE ? 'Ihr generiertes Video erscheint hier.' : 'Your generated video will appear here.',
        emptyCopy: DE ? 'PixVerse speichert erfolgreiche Mitgliedervideos im Assets Manager.' : 'PixVerse saves member videos into Assets Manager when generation succeeds.',
    }),
    Object.freeze({
        id: 'music',
        label: DE ? 'Musik' : 'Music',
        noun: DE ? 'Track' : 'track',
        promptLabel: DE ? 'Beschreiben Sie Ihren Track' : 'Describe your track',
        promptPlaceholder: DE ? 'Träumerischer Synthwave mit warmem Analogbass, luftigen Vocal-Hooks, nächtlicher City-Stimmung...' : 'Dreamy synthwave with warm analog bass, airy female vocal hooks, nocturnal city mood...',
        promptHelp: DE ? 'Nutzen Sie Stil, Stimmung, Struktur, Instrumente, Tempo und Vocal-Richtung.' : 'Use style, mood, structure, instruments, tempo, and vocal direction.',
        emptyTitle: DE ? 'Ihr generierter Track erscheint hier.' : 'Your generated track will appear here.',
        emptyCopy: DE ? 'Musikgenerierung kann bis zu 2 Minuten dauern und speichert in den Assets Manager.' : 'Music generation can take up to 2 minutes and saves into Assets Manager.',
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
            status: DE ? 'NEU' : 'NEW',
            summary: DE ? 'OpenAI-Bildgenerierung und -Bearbeitung über Cloudflare AI Gateway.' : 'OpenAI image generation and editing via Cloudflare AI Gateway.',
            capabilities: Object.freeze([
                DE ? 'Text zu Bild' : 'Text to image',
                DE ? 'Bildbearbeitung' : 'Image edit',
                DE ? 'Mehrere Referenzen' : 'Multi-reference',
                'PNG / WebP / JPEG',
                DE ? 'Speicherbar im Assets Manager' : 'Savable to Assets Manager',
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
        summary: DE ? 'Schnelle Bildgenerierung für visuelle Ideen und gespeicherte Assets.' : 'Fast member image generation for visual ideation and saved assets.',
        capabilities: Object.freeze([
            DE ? 'Prompt zu Bild' : 'Prompt-to-image',
            config?.supportsSteps ? (DE ? 'Step-Steuerung' : 'Step control') : (DE ? 'Standard-Steps' : 'Default steps'),
            config?.supportsSeed ? (DE ? 'Optionaler Seed' : 'Optional seed') : (DE ? 'Zufälliger Seed' : 'Random seed'),
            DE ? 'Speicherbar im Assets Manager' : 'Savable to Assets Manager',
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
    summary: DE ? 'Text-zu-Video und Bild-zu-Video mit Dauer, Qualität, Format, Seed und Audio-Steuerung.' : 'Text-to-video and image-to-video generation with duration, quality, aspect, seed, and audio controls.',
    capabilities: Object.freeze([
        DE ? 'Text zu Video' : 'Text-to-video',
        DE ? 'Optionale Bild-zu-Video-Referenz' : 'Optional image-to-video reference',
        DE ? `${PIXVERSE_V6_MIN_DURATION}-${PIXVERSE_V6_MAX_DURATION} Sekunden Dauer` : `${PIXVERSE_V6_MIN_DURATION}-${PIXVERSE_V6_MAX_DURATION} second duration`,
        DE ? `${PIXVERSE_V6_QUALITIES.join(', ')} Qualität` : `${PIXVERSE_V6_QUALITIES.join(', ')} quality`,
        DE ? 'Automatisch gespeichertes Video-Asset' : 'Auto-saved video asset',
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
    summary: DE ? 'Musikgenerierung für Mitglieder mit optionalen eigenen Lyrics, Instrumentalmodus und generierten Lyrics.' : 'Member music generation with optional manual lyrics, instrumental mode, and generated lyrics.',
    capabilities: Object.freeze([
        DE ? 'Prompt zu Musik' : 'Prompt-to-music',
        DE ? 'Optionale eigene Lyrics' : 'Optional manual lyrics',
        DE ? 'Instrumentalmodus' : 'Instrumental mode',
        DE ? 'Generierte Lyrics' : 'Generated lyrics option',
        DE ? 'Automatisch gespeichertes Audio-Asset mit Cover-Workflow' : 'Auto-saved audio asset with cover workflow',
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
