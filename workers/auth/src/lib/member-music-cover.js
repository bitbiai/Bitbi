import { logDiagnostic, getErrorFields } from "../../../../js/shared/worker-observability.mjs";
import { processGeneratedMusicCoverPoster } from "./ai-text-assets.js";
import { randomTokenHex } from "./tokens.js";

export const MEMBER_MUSIC_COVER_MODEL_ID = "@cf/black-forest-labs/flux-1-schnell";
export const MEMBER_MUSIC_COVER_TEMP_PREFIX = "tmp/ai-generated/music-covers/";

const COMPONENT = "member-music-cover";
const DEFAULT_COVER_MIME_TYPE = "image/png";

function cleanPromptText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

export function buildMemberMusicCoverPrompt(styleInput) {
  const style = cleanPromptText(styleInput) || "atmospheric electronic music";
  return [
    "Square album cover artwork for a generated music track.",
    `Use this music style as the visual direction: ${style}`,
    "No words, no letters, no logos, no watermark.",
  ].join(" ");
}

function parseBase64Image(value) {
  if (typeof value !== "string" || !value) return null;
  const dataUriMatch = value.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  if (dataUriMatch) {
    return {
      bytes: Uint8Array.from(atob(dataUriMatch[2]), (ch) => ch.charCodeAt(0)),
      mimeType: dataUriMatch[1],
    };
  }
  if (value.length > 100 && /^[A-Za-z0-9+/\n\r]+=*$/.test(value.slice(0, 200))) {
    return {
      bytes: Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0)),
      mimeType: DEFAULT_COVER_MIME_TYPE,
    };
  }
  return null;
}

async function toArrayBuffer(value) {
  if (value == null) return null;
  if (value instanceof ArrayBuffer) return value;
  if (typeof value.arrayBuffer === "function") {
    try {
      return await value.arrayBuffer();
    } catch {
      return null;
    }
  }
  if (value.buffer instanceof ArrayBuffer && typeof value.byteLength === "number") {
    return value.buffer.byteLength === value.byteLength
      ? value.buffer
      : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (typeof value.getReader === "function") {
    try {
      return await new Response(value).arrayBuffer();
    } catch {
      return null;
    }
  }
  return null;
}

async function extractImageBytes(result) {
  const candidates = [];
  if (result && typeof result === "object" && !ArrayBuffer.isView(result) && !(result instanceof ArrayBuffer)) {
    if (result.image != null) candidates.push(result.image);
    if (Array.isArray(result.images) && result.images.length > 0) candidates.push(result.images[0]);
    if (result.data != null) candidates.push(result.data);
  }
  candidates.push(result);

  for (const candidate of candidates) {
    const parsed = parseBase64Image(candidate);
    if (parsed?.bytes?.byteLength) {
      return parsed;
    }

    const buffer = await toArrayBuffer(candidate);
    if (buffer?.byteLength) {
      return {
        bytes: new Uint8Array(buffer),
        mimeType: DEFAULT_COVER_MIME_TYPE,
      };
    }
  }
  return null;
}

function parseStoredMusicPrompt(row, fallback) {
  try {
    const metadata = JSON.parse(row?.metadata_json || "{}");
    return metadata?.prompt || fallback || "";
  } catch {
    return fallback || "";
  }
}

async function loadMusicAssetForCover(env, { userId, assetId }) {
  return env.DB.prepare(
    "SELECT id, user_id, source_module, poster_r2_key, metadata_json FROM ai_text_assets WHERE id = ? AND user_id = ? AND source_module = 'music'"
  ).bind(assetId, userId).first();
}

export async function generateMemberMusicCover({
  env,
  userId,
  assetId,
  styleInput,
  correlationId = null,
}) {
  if (!env?.AI || typeof env.AI.run !== "function") {
    logDiagnostic({
      service: "bitbi-auth",
      component: COMPONENT,
      event: "music_cover_ai_binding_missing",
      level: "warn",
      correlationId,
      user_id: userId,
      asset_id: assetId,
    });
    return null;
  }

  let row;
  try {
    row = await loadMusicAssetForCover(env, { userId, assetId });
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: COMPONENT,
      event: "music_cover_asset_lookup_failed",
      level: "warn",
      correlationId,
      user_id: userId,
      asset_id: assetId,
      ...getErrorFields(error),
    });
    return null;
  }

  if (!row || row.poster_r2_key) {
    return null;
  }

  const prompt = buildMemberMusicCoverPrompt(parseStoredMusicPrompt(row, styleInput));
  let image;
  try {
    const result = await env.AI.run(MEMBER_MUSIC_COVER_MODEL_ID, { prompt });
    image = await extractImageBytes(result);
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: COMPONENT,
      event: "music_cover_generation_failed",
      level: "warn",
      correlationId,
      user_id: userId,
      asset_id: assetId,
      model: MEMBER_MUSIC_COVER_MODEL_ID,
      ...getErrorFields(error),
    });
    return null;
  }

  if (!image?.bytes?.byteLength) {
    logDiagnostic({
      service: "bitbi-auth",
      component: COMPONENT,
      event: "music_cover_generation_empty",
      level: "warn",
      correlationId,
      user_id: userId,
      asset_id: assetId,
      model: MEMBER_MUSIC_COVER_MODEL_ID,
    });
    return null;
  }

  const tempKey = `${MEMBER_MUSIC_COVER_TEMP_PREFIX}${userId}/${assetId}-${randomTokenHex(8)}.png`;
  try {
    await env.USER_IMAGES.put(tempKey, image.bytes, {
      httpMetadata: { contentType: image.mimeType || DEFAULT_COVER_MIME_TYPE },
    });
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: COMPONENT,
      event: "music_cover_temp_store_failed",
      level: "warn",
      correlationId,
      user_id: userId,
      asset_id: assetId,
      ...getErrorFields(error),
    });
    return null;
  }

  const poster = await processGeneratedMusicCoverPoster(env, {
    userId,
    assetId,
    coverBytes: image.bytes,
  });
  if (!poster?.r2Key) {
    logDiagnostic({
      service: "bitbi-auth",
      component: COMPONENT,
      event: "music_cover_thumbnail_unavailable",
      level: "warn",
      correlationId,
      user_id: userId,
      asset_id: assetId,
      temp_key: tempKey,
    });
    return null;
  }

  try {
    await env.USER_IMAGES.delete(tempKey);
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: COMPONENT,
      event: "music_cover_temp_delete_failed",
      level: "warn",
      correlationId,
      user_id: userId,
      asset_id: assetId,
      temp_key: tempKey,
      ...getErrorFields(error),
    });
  }

  logDiagnostic({
    service: "bitbi-auth",
    component: COMPONENT,
    event: "music_cover_thumbnail_attached",
    correlationId,
    user_id: userId,
    asset_id: assetId,
    poster_key: poster.r2Key,
    model: MEMBER_MUSIC_COVER_MODEL_ID,
  });
  return poster;
}

export function scheduleMemberMusicCoverGeneration(ctx, options) {
  const promise = Promise.resolve().then(() => generateMemberMusicCover(options)).catch((error) => {
    logDiagnostic({
      service: "bitbi-auth",
      component: COMPONENT,
      event: "music_cover_background_failed",
      level: "warn",
      correlationId: options?.correlationId || null,
      user_id: options?.userId || null,
      asset_id: options?.assetId || null,
      ...getErrorFields(error),
    });
  });

  if (ctx?.execCtx && typeof ctx.execCtx.waitUntil === "function") {
    ctx.execCtx.waitUntil(promise);
  } else {
    void promise;
  }
}
