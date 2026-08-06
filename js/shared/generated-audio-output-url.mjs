import { ELEVENLABS_MUSIC_V2_MODEL_ID } from "./elevenlabs-music-v2-pricing.mjs";

const GATEWAY_OUTPUT_HOST_PATTERN =
  /^ai-gateway-outputs(?:-[a-z0-9-]{1,80})?\.cloudflarestorage\.com$/;
const GATEWAY_OUTPUT_PATH_PREFIX = "/provider-outputs/";
const ELEVENLABS_EXAMPLE_HOST = "examples.aig.cloudflare.com";
const ELEVENLABS_EXAMPLE_PATH_PREFIX = `/${ELEVENLABS_MUSIC_V2_MODEL_ID}/`;
export const MAX_GENERATED_AUDIO_URL_LENGTH = 4_096;

/**
 * Accept only Cloudflare-controlled output locations documented or already
 * used by BITBI. The returned URL may still be temporary and must be copied
 * server-side before it is treated as a saved asset.
 */
export function getTrustedGeneratedAudioOutputUrl(value) {
  const input = String(value || "");
  if (input.length > MAX_GENERATED_AUDIO_URL_LENGTH) return null;
  const raw = input.trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || (parsed.port && parsed.port !== "443")
    || parsed.hash
  ) {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const gatewayOutput = GATEWAY_OUTPUT_HOST_PATTERN.test(hostname)
    && parsed.pathname.startsWith(GATEWAY_OUTPUT_PATH_PREFIX);
  const documentedElevenLabsOutput = hostname === ELEVENLABS_EXAMPLE_HOST
    && parsed.pathname.startsWith(ELEVENLABS_EXAMPLE_PATH_PREFIX);

  return gatewayOutput || documentedElevenLabsOutput ? parsed : null;
}

export function isTrustedGeneratedAudioOutputUrl(value) {
  return getTrustedGeneratedAudioOutputUrl(value) !== null;
}
