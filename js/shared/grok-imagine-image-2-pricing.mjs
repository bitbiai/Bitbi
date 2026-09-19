import { creditsForProviderCostUsd, requiredSellPriceUsdForProviderCost, creditValueUsd, effectiveProfitMarginForCredits } from './model-credit-pricing.mjs';

// Reviewed 2026-09-19. Cloudflare's model schema restricts this route to 1k/2k.
// https://developers.cloudflare.com/ai/models/xai/grok-imagine-image-2.0/
// https://docs.x.ai/developers/models/grok-imagine-image-2.0
// https://developers.cloudflare.com/ai-gateway/features/unified-billing/
// Provider rates are passed through; include the 5% Unified credit funding fee.
export const GROK_IMAGE_2 = Object.freeze({
  id: 'xai/grok-imagine-image-2.0', label: 'Grok Imagine Image 2.0', vendor: 'xAI',
  qualityOptions: Object.freeze(['low','medium']), resolutionOptions: Object.freeze(['1k','2k']),
  aspectRatioOptions: Object.freeze(['1:1','3:4','4:3','9:16','16:9','2:3','3:2','9:19.5','19.5:9','9:20','20:9','1:2','2:1','auto']),
  responseFormatOptions: Object.freeze(['url','b64_json']), maxReferenceImages: 5,
  defaultQuality:'low',defaultResolution:'1k',defaultAspectRatio:'auto',defaultResponseFormat:'b64_json',
});
export function normalizeGrokImage2(settings={}) {
  const option=(value,options,fallback,name)=>{
    const result=value ?? fallback;
    if(!options.includes(result))throw new Error(`Unsupported Grok Imagine Image 2.0 ${name}.`);
    return result;
  };
  if(settings.n != null)throw new Error('Grok Imagine Image 2.0 returns exactly one image; n is unsupported.');
  const images=settings.images ?? settings.source_images ?? settings.sourceImages ?? settings.referenceImages ?? [];
  if(!Array.isArray(images) || images.length>5)throw new Error('At most five reference images are supported.');
  const count=Number(settings.referenceImageCount ?? settings.sourceImagesCount ?? images.length);
  if(!Number.isInteger(count)||count<0||count>5)throw new Error('Invalid reference image count.');
  return {
    quality:option(settings.quality,GROK_IMAGE_2.qualityOptions,GROK_IMAGE_2.defaultQuality,'quality'),
    resolution:option(settings.resolution ?? settings.size,GROK_IMAGE_2.resolutionOptions,GROK_IMAGE_2.defaultResolution,'resolution'),
    aspect_ratio:option(settings.aspect_ratio ?? settings.aspectRatio,GROK_IMAGE_2.aspectRatioOptions,GROK_IMAGE_2.defaultAspectRatio,'aspect ratio'),
    response_format:option(settings.response_format ?? settings.responseFormat,GROK_IMAGE_2.responseFormatOptions,GROK_IMAGE_2.defaultResponseFormat,'response format'),
    inputImageCount:count + (settings.image||settings.source_image||settings.sourceImage ? 1:0) + (settings.mask||settings.source_mask||settings.sourceMask ? 1:0),
  };
}
export function calculateGrokImage2CreditCost(settings={}) {
  const normalized=normalizeGrokImage2(settings);
  const outputCostUsd=({low:{'1k':.04,'2k':.06},medium:{'1k':.06,'2k':.08}})[normalized.quality][normalized.resolution];
  const providerCostUsd=(outputCostUsd+.01*normalized.inputImageCount)*1.05;
  const credits=creditsForProviderCostUsd(providerCostUsd);
  return {modelId:GROK_IMAGE_2.id,credits,providerCostUsd,internalCostUsd:null,normalized,
    minimumSellPriceUsd:requiredSellPriceUsdForProviderCost(providerCostUsd),chargedValueUsd:creditValueUsd(credits),
    effectiveProfitMargin:effectiveProfitMarginForCredits(providerCostUsd,credits),
    formula:{pricingVersion:'grok-imagine-image-2.0-v1',outputCostUsd,inputCostUsd:.01,fundingMultiplier:1.05,
      pricingSource:'xai_model_rates_cloudflare_unified_billing',rounding:'central BITBI credit pricing'}};
}
