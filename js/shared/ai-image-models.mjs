export const DEFAULT_AI_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

export const AI_IMAGE_MODELS = Object.freeze([
    Object.freeze({
        id: '@cf/black-forest-labs/flux-1-schnell',
        label: 'FLUX.1 Schnell',
        requestMode: 'json',
        supportsSteps: true,
        supportsSeed: true,
        estimatedCredits: 1,
    }),
]);

const GENERATE_LAB_ONLY_AI_IMAGE_MODELS = Object.freeze([
    Object.freeze({
        id: '@cf/black-forest-labs/flux-2-klein-9b',
        label: 'FLUX.2 Klein 9B',
        requestMode: 'multipart',
        supportsSteps: false,
        supportsSeed: false,
        supportsDimensions: true,
        multipartDefaults: Object.freeze({
            width: 1024,
            height: 1024,
        }),
        estimatedCredits: 10,
    }),
]);

const SUPPORTED_AI_IMAGE_MODEL_CONFIGS = Object.freeze([
    ...AI_IMAGE_MODELS,
    ...GENERATE_LAB_ONLY_AI_IMAGE_MODELS,
]);

const AI_IMAGE_MODEL_MAP = new Map(SUPPORTED_AI_IMAGE_MODEL_CONFIGS.map((model) => [model.id, model]));

export function getAiImageModelOptions() {
    return AI_IMAGE_MODELS.map(({ id, label, estimatedCredits }) => ({ id, label, estimatedCredits }));
}

export function getGenerateLabAiImageModelOptions() {
    return SUPPORTED_AI_IMAGE_MODEL_CONFIGS.map(({ id, label, estimatedCredits }) => ({ id, label, estimatedCredits }));
}

export function getAiImageModelConfig(modelId) {
    if (typeof modelId !== 'string') return null;
    return AI_IMAGE_MODEL_MAP.get(modelId) || null;
}

export function isSupportedAiImageModel(modelId) {
    return !!getAiImageModelConfig(modelId);
}

export function resolveAiImageModel(modelId) {
    const trimmed = typeof modelId === 'string' ? modelId.trim() : '';
    if (!trimmed) {
        return getAiImageModelConfig(DEFAULT_AI_IMAGE_MODEL);
    }
    return getAiImageModelConfig(trimmed);
}

export default {
    AI_IMAGE_MODELS,
    DEFAULT_AI_IMAGE_MODEL,
    getAiImageModelConfig,
    getAiImageModelOptions,
    getGenerateLabAiImageModelOptions,
    isSupportedAiImageModel,
    resolveAiImageModel,
};
