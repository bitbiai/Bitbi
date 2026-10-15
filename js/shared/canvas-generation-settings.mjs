import { SEEDANCE_25_MODEL, seedance25Settings } from './seedance-25-contract.mjs';
import { OMNI_MODEL } from './gemini-omni-contract.mjs';
import { isGptImage25Model } from './gpt-image-25-contract.mjs';
import { getCanvasTextInstructions } from './canvas-model-contract.mjs';
import { GROK_4_6_MODEL_ID, GROK_DEFAULT_REASONING_EFFORT, getGrokMaxCompletionTokens } from './grok-text-contract.mjs';
import { elevenLabsMemberBody } from './member-music-contract.mjs';

// Shared projection of ordinary editable settings. Admission, ownership and
// private reference resolution remain server-side in the Canvas route.
export function canvasGenerationSettings(config, model, prompt) {
  const body = { model: model.id, prompt };
  if (model.capability === "text") {
    body.system_prompt = getCanvasTextInstructions(config);
    if (Array.isArray(config.messages) && config.messages.length) throw Object.assign(new Error("Canvas text nodes accept a prompt and system prompt, not a native message history."), { status: 400, code: "unsupported_option" });
    if (model.id === GROK_4_6_MODEL_ID) {
      body.reasoningEffort = config.reasoningEffort ?? GROK_DEFAULT_REASONING_EFFORT;
      body.max_tokens = getGrokMaxCompletionTokens(body.reasoningEffort);
    } else if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens;
    if (config.temperature !== undefined) body.temperature = config.temperature;
  } else if (model.capability === "image") {
    const c = model.controls || {};
    if (isGptImage25Model(model.id)) { body.source_images = config.source_images || []; body.referenceOrder = Array.isArray(config.referenceOrder) ? config.referenceOrder : []; }
    const fields = { steps: c.supportsSteps, seed: c.supportsSeed, width: c.supportsDimensions, height: c.supportsDimensions,
      quality: c.qualityOptions?.length, resolution:c.resolutionOptions?.length, aspectRatio:c.aspectRatioOptions?.length, size: c.sizeOptions?.length, outputFormat: c.outputFormatOptions?.length,
      background: c.backgroundOptions?.length, safetyTolerance: c.supportsSafetyTolerance };
    for (const [field, supported] of Object.entries(fields)) {
      if (supported && config[field] !== undefined && config[field] !== "") body[field] = config[field];
    }
  } else if (model.id === SEEDANCE_25_MODEL) {
    Object.assign(body,seedance25Settings(config.seedance25 || {}),{workflow:config.seedance25?.workflow || 'generate',referenceOrder:Array.isArray(config.seedance25Order)?config.seedance25Order:[]});
  } else if (model.capability === "video") {
    if(model.id===OMNI_MODEL)body.referenceOrder=Array.isArray(config.omniOrder)?config.omniOrder:[];
    else body.duration = config.duration || model.controls?.duration?.default || 5;
    if (model.id.startsWith('xai/grok-imagine-video') && config.size) body.size=config.size;
    if (model.controls?.resolutionField === "quality") body.quality = config.quality || model.controls.defaultQuality || "720p";
    else body.resolution = config.resolution || model.controls.defaultResolution || "720p";
    if (model.id === "alibaba/hh1-t2v") body.ratio = config.aspectRatio || model.controls.defaultAspectRatio || "16:9";
    else body.aspect_ratio = config.aspectRatio || model.controls.defaultAspectRatio || "16:9";
    if (model.controls?.supportsNegativePrompt && config.negativePrompt) body.negative_prompt = config.negativePrompt;
    if (model.controls?.supportsSeed && config.seed !== undefined && config.seed !== "") body.seed = config.seed;
    if (model.controls?.supportsAudioToggle) body.generate_audio = config.generateAudio !== false;
    if (model.controls?.supportsWatermark) body.watermark = config.watermark === true;
  } else if (model.capability === "music") {
    if (model.id === 'elevenlabs/music-v2') return elevenLabsMemberBody(config, prompt);
    body.instrumental = config.instrumental === true;
    body.generateLyrics = config.generateLyrics === true;
    if (config.lyrics) body.lyrics = config.lyrics;
  }
  return body;
}
