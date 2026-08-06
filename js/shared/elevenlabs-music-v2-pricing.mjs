import { BITBI_GENERATION_TIMEOUT_MS } from "./generation-timeout.mjs";

export const ELEVENLABS_MUSIC_V2_MODEL_ID = "elevenlabs/music-v2";
export const ELEVENLABS_MUSIC_V2_MODEL_LABEL = "ElevenLabs Music v2";
export const ELEVENLABS_MUSIC_V2_VENDOR = "ElevenLabs";

export const ELEVENLABS_MUSIC_V2_PRICE_USD_PER_OUTPUT_SECOND = 0.0025;
export const ELEVENLABS_MUSIC_V2_PRICE_NANO_USD_PER_OUTPUT_MILLISECOND = 2_500;

export const ELEVENLABS_MUSIC_V2_MIN_DURATION_MS = 3_000;
export const ELEVENLABS_MUSIC_V2_MAX_DURATION_MS = 600_000;
export const ELEVENLABS_MUSIC_V2_MAX_CHUNK_DURATION_MS = 120_000;
export const ELEVENLABS_MUSIC_V2_MAX_CHUNKS = 30;
export const ELEVENLABS_MUSIC_V2_MAX_PROMPT_LENGTH = 4_100;
export const ELEVENLABS_MUSIC_V2_MAX_PLAN_BYTES = 256 * 1024;
export const ELEVENLABS_MUSIC_V2_MIN_SEED = 0;
export const ELEVENLABS_MUSIC_V2_MAX_SEED = 4_294_967_295;
export const ELEVENLABS_MUSIC_V2_DEFAULT_OUTPUT_FORMAT = "auto";

// Keep a single generation deadline in the AI Worker, then give each outer
// relay enough room to deliver that terminal response. These are deliberately
// model-specific; the established timeout for every other model is unchanged.
export const ELEVENLABS_MUSIC_V2_AI_TIMEOUT_MS = BITBI_GENERATION_TIMEOUT_MS;
export const ELEVENLABS_MUSIC_V2_AUTH_PROXY_TIMEOUT_MS =
  ELEVENLABS_MUSIC_V2_AI_TIMEOUT_MS + 30_000;
export const ELEVENLABS_MUSIC_V2_BROWSER_TIMEOUT_MS =
  ELEVENLABS_MUSIC_V2_AUTH_PROXY_TIMEOUT_MS + 30_000;

// Cloudflare documents both URL and Base64 data-URI responses, so inline output
// cannot be treated as a small fallback. The largest advertised combination is
// 600 seconds at 320 kbps (24,000,000 nominal bytes). A 25 MiB ceiling covers
// that payload plus bounded container/C2PA overhead while remaining aligned with
// the protected Auth save path and the Worker isolate's finite memory budget.
export const ELEVENLABS_MUSIC_V2_MAX_INLINE_AUDIO_BYTES = 25 * 1024 * 1024;
export const ELEVENLABS_MUSIC_V2_MAX_INLINE_AUDIO_BASE64_LENGTH =
  Math.ceil(ELEVENLABS_MUSIC_V2_MAX_INLINE_AUDIO_BYTES / 3) * 4;

export const ELEVENLABS_MUSIC_V2_OUTPUT_FORMATS = Object.freeze([
  "auto",
  "mp3_48000_128",
  "mp3_48000_192",
  "mp3_48000_240",
  "mp3_48000_320",
  "mp3_22050_32",
  "mp3_24000_48",
  "mp3_44100_32",
  "mp3_44100_64",
  "mp3_44100_96",
  "mp3_44100_128",
  "mp3_44100_192",
  "opus_48000_32",
  "opus_48000_64",
  "opus_48000_96",
  "opus_48000_128",
  "opus_48000_192",
]);

export function getElevenLabsMusicV2OutputFormatInfo(outputFormat) {
  if (!ELEVENLABS_MUSIC_V2_OUTPUT_FORMATS.includes(outputFormat)) return null;
  if (outputFormat === "auto") {
    return {
      value: outputFormat,
      label: "Automatic / Recommended",
      codec: "mp3",
      mimeType: "audio/mpeg",
      extension: "mp3",
      c2paCompatible: true,
      resolvedFormat: "mp3_48000_192",
    };
  }

  const [codec, sampleRate, bitrate] = outputFormat.split("_");
  const isMp3 = codec === "mp3";
  const sampleRateKhz = Number(sampleRate) / 1000;
  return {
    value: outputFormat,
    label: `${isMp3 ? "MP3" : "Opus"} · ${sampleRateKhz} kHz · ${Number(bitrate)} kbps`,
    codec,
    mimeType: isMp3 ? "audio/mpeg" : "audio/ogg",
    extension: isMp3 ? "mp3" : "opus",
    c2paCompatible: isMp3,
    resolvedFormat: outputFormat,
  };
}

export function calculateElevenLabsMusicV2ProviderCost(durationMs) {
  const normalizedDurationMs = Number(durationMs);
  if (!Number.isSafeInteger(normalizedDurationMs) || normalizedDurationMs < 0) {
    return null;
  }
  const nanoUsd = normalizedDurationMs
    * ELEVENLABS_MUSIC_V2_PRICE_NANO_USD_PER_OUTPUT_MILLISECOND;
  return {
    durationMs: normalizedDurationMs,
    nanoUsd,
    providerCostUsd: nanoUsd / 1_000_000_000,
    priceUsdPerOutputSecond: ELEVENLABS_MUSIC_V2_PRICE_USD_PER_OUTPUT_SECOND,
  };
}
