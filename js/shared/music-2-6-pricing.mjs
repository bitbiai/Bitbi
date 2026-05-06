export const MINIMAX_MUSIC_2_6_MODEL_ID = "minimax/music-2.6";
export const MINIMAX_MUSIC_2_6_MODEL_LABEL = "MiniMax Music 2.6";
export const MINIMAX_MUSIC_2_6_BASE_CREDITS = 150;
export const MINIMAX_MUSIC_2_6_WITH_SEPARATE_LYRICS_CREDITS = 160;

export function normalizeMinimaxMusic26PricingInput(params = {}) {
  const separateLyricsGeneration =
    params.separateLyricsGeneration === true ||
    params.generateLyrics === true ||
    params.separateLyrics === true;
  return { separateLyricsGeneration };
}

export function calculateMinimaxMusic26CreditCost(params = {}) {
  const normalized = normalizeMinimaxMusic26PricingInput(params);
  const credits = normalized.separateLyricsGeneration
    ? MINIMAX_MUSIC_2_6_WITH_SEPARATE_LYRICS_CREDITS
    : MINIMAX_MUSIC_2_6_BASE_CREDITS;
  return {
    modelId: MINIMAX_MUSIC_2_6_MODEL_ID,
    credits,
    providerCostUsd: null,
    normalized,
    formula: {
      pricingVersion: "minimax-music-2.6-v1",
      billingMode: "fixed_member_credit_schedule",
      baseCredits: MINIMAX_MUSIC_2_6_BASE_CREDITS,
      separateLyricsCredits: MINIMAX_MUSIC_2_6_WITH_SEPARATE_LYRICS_CREDITS,
    },
  };
}
