// Klein/Dev: validated BITBI subset; opaque Cloudflare multipart schemas do
// not establish a broader official range. Max: UI presets within the existing
// bounded provider contract, not an exhaustive list of its continuous sizes.
export const MULTIPART_IMAGE_DIMENSIONS = Object.freeze([256, 512, 768, 1024]);
export const FLUX_MAX_DIMENSION_PRESETS = Object.freeze([256, 512, 768, 1024, 1280, 1536, 1792, 2048]);
export function imageDimensionChoices(modelId, retainedValue) {
    if (['@cf/black-forest-labs/flux-2-klein-9b', '@cf/black-forest-labs/flux-2-dev'].includes(modelId)) return MULTIPART_IMAGE_DIMENSIONS;
    if (modelId === 'black-forest-labs/flux-2-max') {
        const value = Number(retainedValue);
        return Number.isInteger(value) && value >= 64 && value <= 2048
            ? [...new Set([...FLUX_MAX_DIMENSION_PRESETS, value])].sort((a, b) => a - b)
            : FLUX_MAX_DIMENSION_PRESETS;
    }
    return [];
}
export function normalizeMultipartImageDimensions({ width, height } = {}) {
    const supplied = value => value !== undefined && value !== null && value !== '';
    if (supplied(width) !== supplied(height)) throw new Error('width and height must be provided together.');
    if (!supplied(width)) return { width: 1024, height: 1024 };
    const values = { width: Number(width), height: Number(height) };
    for (const [name, value] of Object.entries(values)) {
        if (!MULTIPART_IMAGE_DIMENSIONS.includes(value)) throw new Error(`${name} must be one of ${MULTIPART_IMAGE_DIMENSIONS.join(', ')}.`);
    }
    return values;
}
