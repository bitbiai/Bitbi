export const DEFAULT_AI_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

export const AI_IMAGE_MODELS = Object.freeze([
    Object.freeze({
        id: '@cf/black-forest-labs/flux-1-schnell',
        label: 'FLUX.1 Schnell',
        requestMode: 'json',
        supportsSteps: true,
        supportsSeed: true,
    }),
    Object.freeze({
        id: '@cf/black-forest-labs/flux-2-klein-9b',
        label: 'FLUX.2 Klein 9B',
        requestMode: 'multipart',
        supportsSteps: false,
        supportsSeed: false,
        multipartDefaults: Object.freeze({
            width: 1024,
            height: 1024,
        }),
    }),
    Object.freeze({
        id: '@cf/black-forest-labs/flux-2-dev',
        label: 'FLUX.2 Dev',
        requestMode: 'multipart',
        supportsSteps: false,
        supportsSeed: false,
        multipartDefaults: Object.freeze({
            width: 1024,
            height: 1024,
        }),
    }),
]);

const AI_IMAGE_MODEL_MAP = new Map(AI_IMAGE_MODELS.map((model) => [model.id, model]));

export function getAiImageModelOptions() {
    return AI_IMAGE_MODELS.map(({ id, label }) => ({ id, label }));
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
    isSupportedAiImageModel,
    resolveAiImageModel,
};
