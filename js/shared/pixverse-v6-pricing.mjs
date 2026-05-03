export const PIXVERSE_V6_MODEL_ID = "pixverse/v6";
export const PIXVERSE_V6_MODEL_LABEL = "PixVerse V6";

export const PIXVERSE_V6_PROVIDER_CREDITS_PER_SECOND = Object.freeze({
  "360p": Object.freeze({ noAudio: 5, withAudio: 7 }),
  "540p": Object.freeze({ noAudio: 7, withAudio: 9 }),
  "720p": Object.freeze({ noAudio: 9, withAudio: 12 }),
  "1080p": Object.freeze({ noAudio: 18, withAudio: 23 }),
});

export const PIXVERSE_V6_QUALITIES = Object.freeze(Object.keys(PIXVERSE_V6_PROVIDER_CREDITS_PER_SECOND));
export const PIXVERSE_V6_ASPECT_RATIOS = Object.freeze(["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"]);
export const PIXVERSE_V6_MIN_DURATION = 1;
export const PIXVERSE_V6_MAX_DURATION = 15;
export const PIXVERSE_V6_MAX_PROMPT_LENGTH = 2048;
export const PIXVERSE_V6_MAX_NEGATIVE_PROMPT_LENGTH = 2048;
export const PIXVERSE_V6_MAX_SEED = 2147483647;

export function isPixverseV6Quality(value) {
  return Object.prototype.hasOwnProperty.call(PIXVERSE_V6_PROVIDER_CREDITS_PER_SECOND, value);
}

export function isPixverseV6AspectRatio(value) {
  return PIXVERSE_V6_ASPECT_RATIOS.includes(value);
}

export function calculatePixverseV6MemberCredits({ duration, quality, generateAudio }) {
  const qualityRates = PIXVERSE_V6_PROVIDER_CREDITS_PER_SECOND[quality];
  if (!qualityRates) {
    throw new Error("Unsupported PixVerse V6 quality.");
  }

  if (!Number.isInteger(duration) || duration < PIXVERSE_V6_MIN_DURATION || duration > PIXVERSE_V6_MAX_DURATION) {
    throw new Error("Unsupported PixVerse V6 duration.");
  }

  const providerCreditsPerSecond = generateAudio ? qualityRates.withAudio : qualityRates.noAudio;
  const providerCredits = providerCreditsPerSecond * duration;

  // Conservative Bitbi pricing basis:
  // - PixVerse: USD 1 = 200 provider credits
  // - FX basis: EUR 1 = USD 1.1702
  // - Bitbi cheapest user credit pack: 12,000 credits = EUR 19.99
  // - 20% markup over provider cost
  //
  // Exact integer-safe formula:
  // ceil(providerCredits * 36000000 / 11696149)
  return Math.ceil((providerCredits * 36000000) / 11696149);
}
