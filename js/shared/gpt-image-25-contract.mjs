// Cloudflare adapter schema verified 2026-09-22. Defaults and bounds below
// are application policy, not undocumented provider limits or prices.
export const GPT_IMAGE_25_MODEL_IDS = Object.freeze([
  'openai/gpt-image-2.5-sunburst',
  'openai/gpt-image-2.5-flare',
]);
export const GPT_IMAGE_25_QUALITY_OPTIONS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max', 'auto']);
export const GPT_IMAGE_25_SIZE_OPTIONS = Object.freeze(['1024x1024', '1024x1536', '1536x1024', 'auto']);
export const GPT_IMAGE_25_BACKGROUND_OPTIONS = Object.freeze(['transparent', 'opaque', 'auto']);
export const GPT_IMAGE_25_OUTPUT_FORMAT_OPTIONS = Object.freeze(['png', 'webp', 'jpeg']);
export const GPT_IMAGE_25_MAX_REFERENCE_IMAGES = 16;
export const GPT_IMAGE_25_MAX_PROMPT_LENGTH = 32_000;
export const GPT_IMAGE_25_MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
export const GPT_IMAGE_25_MAX_AGGREGATE_REFERENCE_BYTES = 16 * 1024 * 1024;
// Set only when Cloudflare-effective factory tariffs and account routing are verified.
export const GPT_IMAGE_25_GENERATION_ENABLED = true;
export const GPT_IMAGE_25_MODELS = Object.freeze(GPT_IMAGE_25_MODEL_IDS.map((id, index) => Object.freeze({
  id, label: index === 0 ? 'GPT Image 2.5 Sunburst' : 'GPT Image 2.5 Flare',
  generationEnabled: GPT_IMAGE_25_GENERATION_ENABLED, pricingRequired: !GPT_IMAGE_25_GENERATION_ENABLED,
  vendor: 'OpenAI', provider: 'OpenAI', providerLabel: 'OpenAI via Cloudflare AI Gateway',
  requestMode: 'gpt-image-2.5', inputFormat: 'gpt-image-2.5', task: 'image', proxied: true,
  supportsSteps: false, supportsSeed: false, supportsDimensions: false,
  supportsGuidance: false, supportsStructuredPrompt: false,
  supportsReferenceImages: true, maxReferenceImages: GPT_IMAGE_25_MAX_REFERENCE_IMAGES,
  maxPromptLength: GPT_IMAGE_25_MAX_PROMPT_LENGTH,
  supportsQuality: true, supportsSize: true, supportsBackground: true,
  supportsOutputFormat: true, supportsTransparentBackground: true,
  qualityOptions: GPT_IMAGE_25_QUALITY_OPTIONS, sizeOptions: GPT_IMAGE_25_SIZE_OPTIONS,
  backgroundOptions: GPT_IMAGE_25_BACKGROUND_OPTIONS, outputFormatOptions: GPT_IMAGE_25_OUTPUT_FORMAT_OPTIONS,
  defaultQuality: 'medium', defaultSize: '1024x1024', defaultBackground: 'auto',
  defaultOutputFormat: 'png', defaultMimeType: 'image/png',
  description: 'Image generation with transparent PNG/WebP and automatic settings. Editing accepts up to 16 ordered references but awaits verified reference pricing.',
})));

export function isGptImage25Model(modelId) { return GPT_IMAGE_25_MODEL_IDS.includes(modelId); }
function invalid(message) { return Object.assign(new Error(message), { status: 400, code: 'validation_error' }); }
function option(value, values, fallback, name) {
  const selected = value === undefined || value === null || value === '' ? fallback : value;
  if (typeof selected !== 'string' || !values.includes(selected)) throw invalid(`Invalid ${name}. Allowed: ${values.join(', ')}.`);
  return selected;
}
export function normalizeGptImage25Options(input = {}, { requirePrompt = false } = {}) {
  const quality = option(input.quality, GPT_IMAGE_25_QUALITY_OPTIONS, 'medium', 'quality');
  const size = option(input.size, GPT_IMAGE_25_SIZE_OPTIONS, '1024x1024', 'size');
  const background = option(input.background, GPT_IMAGE_25_BACKGROUND_OPTIONS, 'auto', 'background');
  const outputFormat = option(input.outputFormat ?? input.output_format, GPT_IMAGE_25_OUTPUT_FORMAT_OPTIONS, 'png', 'outputFormat');
  if (background === 'transparent' && outputFormat === 'jpeg') throw invalid('Transparent background requires PNG or WebP.');
  const refs = input.source_images ?? input.referenceImages ?? input.images;
  if (refs !== undefined && !Array.isArray(refs)) throw invalid('Reference images must be an ordered array.');
  const referenceImageCount = refs?.length ?? input.referenceImageCount ?? 0;
  if (typeof referenceImageCount !== 'number' || !Number.isInteger(referenceImageCount) || referenceImageCount < 0 || referenceImageCount > GPT_IMAGE_25_MAX_REFERENCE_IMAGES) throw invalid('Use between 0 and 16 reference images.');
  if (refs && input.referenceImageCount !== undefined && input.referenceImageCount !== refs.length) throw invalid('Reference image count does not match the selected references.');
  const operation = referenceImageCount > 0 ? 'edit' : 'generate';
  if (input.operation !== undefined && input.operation !== operation) throw invalid('Operation does not match the selected reference images.');
  const normalized = { quality, size, background, outputFormat, referenceImageCount, operation };
  if (requirePrompt || input.prompt !== undefined) {
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > GPT_IMAGE_25_MAX_PROMPT_LENGTH) throw invalid(`Prompt must contain 1–${GPT_IMAGE_25_MAX_PROMPT_LENGTH} characters.`);
    normalized.prompt = input.prompt.trim();
  }
  return normalized;
}
