import { logDiagnostic } from "../../../../js/shared/worker-observability.mjs";

export const NEWS_PULSE_VISUAL_MODEL_ID = "@cf/black-forest-labs/flux-1-schnell";
export const NEWS_PULSE_VISUAL_OBJECT_PREFIX = "news-pulse/thumbs/";
export const NEWS_PULSE_VISUAL_ROUTE_PREFIX = "/api/public/news-pulse/thumbs/";
export const NEWS_PULSE_VISUAL_MAX_ATTEMPTS = 3;
export const NEWS_PULSE_VISUAL_BATCH_LIMIT = 2;
export const NEWS_PULSE_VISUAL_THUMB_SIZE = 256;
export const NEWS_PULSE_VISUAL_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

const COMPONENT = "news-pulse-visuals";
const DEFAULT_GENERATED_IMAGE_MIME_TYPE = "image/png";
const THUMB_MIME_TYPE = "image/webp";
const MAX_ERROR_LENGTH = 240;
const MAX_PROMPT_LENGTH = 420;

const DISALLOWED_PROMPT_PATTERN = /\b(logo|logos|trademark|brand mark|wordmark|watermark|readable text|letters?|words?|typography|headline|caption|copyrighted|copyright|character|celebrity|portrait|likeness|face|person|people|human|politician|candidate|campaign|election|vote|propaganda|persuasion|sexual|explicit|nude|nudity|porn|gore|disney|marvel|pokemon|nintendo|star wars|mickey|batman|superman)\b/i;

const STRIPPED_BRAND_TERMS = [
  "adobe",
  "amazon",
  "anthropic",
  "apple",
  "deepmind",
  "facebook",
  "gemini",
  "google",
  "meta",
  "microsoft",
  "nvidia",
  "openai",
  "runway",
  "stability",
  "xai",
];

function cleanText(value, maxLength = 240) {
  return String(value ?? "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function stripBrandTerms(value, source = "") {
  let text = cleanText(value, 320);
  const sourceTerms = cleanText(source, 120)
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 3);
  for (const term of new Set([...STRIPPED_BRAND_TERMS, ...sourceTerms])) {
    text = text.replace(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
  }
  return text.replace(/\s+/g, " ").trim();
}

function isValidSourceUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function classifyVisualTheme(item = {}) {
  const text = `${item.category || ""} ${item.title || ""} ${item.summary || ""}`.toLowerCase();
  if (/\b(video|film|motion|animation|bewegtbild|kamera|clip)\b/.test(text)) return "AI video creation signal";
  if (/\b(audio|music|sound|song|voice|musik|stimme|klang)\b/.test(text)) return "AI sound design signal";
  if (/\b(image|photo|visual|art|design|bild|foto|kunst|firefly)\b/.test(text)) return "AI visual creation signal";
  if (/\b(agent|workflow|automation|tool|workspace|creator|kreativ|arbeitsablauf)\b/.test(text)) return "creative AI workflow signal";
  if (/\b(model|multimodal|llm|language|reasoning|frontier|modell|sprachmodell)\b/.test(text)) return "AI model update signal";
  if (/\b(policy|safety|regulation|gesetz|sicherheit|governance)\b/.test(text)) return "AI governance signal";
  return "AI and creative technology signal";
}

export function sanitizeNewsPulseVisualPromptHint(value, item = {}) {
  const cleaned = stripBrandTerms(value, item.source);
  if (!cleaned || DISALLOWED_PROMPT_PATTERN.test(cleaned)) return "";
  return cleaned.slice(0, 180);
}

export function buildSafeNewsPulseVisualPrompt(item = {}) {
  const hint = sanitizeNewsPulseVisualPromptHint(item.visual_prompt, item);
  const theme = hint || classifyVisualTheme(item);
  const prompt = [
    "abstract futuristic AI editorial thumbnail",
    theme,
    "dark neon cyber aesthetic",
    "no logos",
    "no readable text",
    "no brand trademarks",
    "no people",
    "no political campaign imagery",
    "clean square composition",
    "high contrast",
    "suitable as a small news thumbnail",
  ].join(", ");
  return cleanText(prompt, MAX_PROMPT_LENGTH);
}

export function buildNewsPulseVisualObjectKey(itemId) {
  const safeId = String(itemId || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 128);
  if (!safeId) return null;
  return `${NEWS_PULSE_VISUAL_OBJECT_PREFIX}${safeId}.webp`;
}

export function isNewsPulseVisualObjectKey(key) {
  const value = String(key || "");
  return value.startsWith(NEWS_PULSE_VISUAL_OBJECT_PREFIX) &&
    value.endsWith(".webp") &&
    !value.includes("..") &&
    !value.includes("\\") &&
    !value.slice(NEWS_PULSE_VISUAL_OBJECT_PREFIX.length).includes("/");
}

export function getNewsPulseVisualThumbUrl(itemId) {
  return `${NEWS_PULSE_VISUAL_ROUTE_PREFIX}${encodeURIComponent(String(itemId || ""))}`;
}

function sanitizeVisualError(error) {
  const raw = cleanText(error?.message || String(error || "News Pulse thumbnail generation failed."), MAX_ERROR_LENGTH);
  if (!raw || /\b(prompt|secret|token|credential|authorization|api key|bearer)\b/i.test(raw)) {
    return "News Pulse thumbnail generation failed.";
  }
  return raw;
}

function isMissingNewsPulseVisualSchema(error) {
  const message = String(error?.message || error);
  return message.includes("no such table") && message.includes("news_pulse_items") ||
    message.includes("no such column") && message.includes("visual_");
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
      mimeType: DEFAULT_GENERATED_IMAGE_MIME_TYPE,
    };
  }
  return null;
}

async function toArrayBuffer(value) {
  if (value == null) return null;
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.byteLength === value.byteLength
      ? value.buffer
      : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (typeof value.arrayBuffer === "function") {
    try {
      return await value.arrayBuffer();
    } catch {
      return null;
    }
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

async function extractGeneratedImageBytes(result) {
  const candidates = [];
  if (result && typeof result === "object" && !ArrayBuffer.isView(result) && !(result instanceof ArrayBuffer)) {
    if (result.image != null) candidates.push(result.image);
    if (Array.isArray(result.images) && result.images.length > 0) candidates.push(result.images[0]);
    if (result.data != null) candidates.push(result.data);
    if (result.output != null) candidates.push(result.output);
  }
  candidates.push(result);

  for (const candidate of candidates) {
    const parsed = parseBase64Image(candidate);
    if (parsed?.bytes?.byteLength) return parsed;

    const buffer = await toArrayBuffer(candidate);
    if (buffer?.byteLength) {
      return {
        bytes: new Uint8Array(buffer),
        mimeType: DEFAULT_GENERATED_IMAGE_MIME_TYPE,
      };
    }
  }
  return null;
}

async function renderNewsPulseThumb(env, imageBytes) {
  if (!env?.IMAGES || typeof env.IMAGES.input !== "function") {
    throw new Error("Images binding is unavailable.");
  }
  const transformResult = await env.IMAGES.input(imageBytes)
    .transform({
      width: NEWS_PULSE_VISUAL_THUMB_SIZE,
      height: NEWS_PULSE_VISUAL_THUMB_SIZE,
      fit: "scale-down",
    })
    .output({
      format: THUMB_MIME_TYPE,
      quality: 82,
    });

  let response;
  if (typeof transformResult.response === "function") {
    response = transformResult.response();
  } else if (typeof transformResult.arrayBuffer === "function") {
    response = transformResult;
  } else if (typeof transformResult.image === "function") {
    response = new Response(transformResult.image(), {
      headers: {
        "content-type": typeof transformResult.contentType === "function"
          ? transformResult.contentType()
          : THUMB_MIME_TYPE,
      },
    });
  } else {
    throw new Error("Images transform returned an invalid thumbnail result.");
  }

  const buffer = await toArrayBuffer(response);
  if (!buffer?.byteLength) throw new Error("Images transform returned an empty thumbnail.");
  return {
    bytes: new Uint8Array(buffer),
    mimeType: response.headers?.get("content-type") || THUMB_MIME_TYPE,
  };
}

function safeBatchLimit(limit) {
  return Math.min(Math.max(Number(limit) || NEWS_PULSE_VISUAL_BATCH_LIMIT, 1), 4);
}

async function listNewsPulseVisualCandidates(env, {
  now,
  limit = NEWS_PULSE_VISUAL_BATCH_LIMIT,
  maxAttempts = NEWS_PULSE_VISUAL_MAX_ATTEMPTS,
} = {}) {
  const result = await env.DB.prepare(
    `SELECT id, locale, title, summary, source, url, category, published_at, visual_prompt, visual_status, visual_attempts, expires_at, updated_at
     FROM news_pulse_items
     WHERE status = 'active'
       AND (expires_at IS NULL OR expires_at > ?)
       AND (visual_status = 'missing' OR visual_status = 'failed')
       AND COALESCE(visual_attempts, 0) < ?
     ORDER BY published_at DESC, updated_at DESC
     LIMIT ?`
  ).bind(now, maxAttempts, safeBatchLimit(limit)).all();
  return result?.results || [];
}

async function acquireNewsPulseVisual(env, item, {
  now,
  maxAttempts = NEWS_PULSE_VISUAL_MAX_ATTEMPTS,
} = {}) {
  const result = await env.DB.prepare(
    `UPDATE news_pulse_items
     SET visual_status = 'pending',
         visual_error = NULL,
         visual_attempts = COALESCE(visual_attempts, 0) + 1,
         visual_updated_at = ?
     WHERE id = ?
       AND status = 'active'
       AND (expires_at IS NULL OR expires_at > ?)
       AND (visual_status = 'missing' OR visual_status = 'failed')
       AND COALESCE(visual_attempts, 0) < ?`
  ).bind(now, item.id, now, maxAttempts).run();
  return Number(result?.meta?.changes || 0) > 0;
}

async function markNewsPulseVisualReady(env, item, { prompt, objectKey, thumbUrl, now }) {
  await env.DB.prepare(
    `UPDATE news_pulse_items
     SET visual_type = 'generated',
         visual_url = ?,
         visual_prompt = ?,
         visual_status = 'ready',
         visual_object_key = ?,
         visual_thumb_url = ?,
         visual_generated_at = ?,
         visual_error = NULL,
         visual_updated_at = ?
     WHERE id = ? AND visual_status = 'pending'`
  ).bind(thumbUrl, prompt, objectKey, thumbUrl, now, now, item.id).run();
}

async function markNewsPulseVisualFailed(env, item, { error, now }) {
  await env.DB.prepare(
    `UPDATE news_pulse_items
     SET visual_status = 'failed',
         visual_error = ?,
         visual_updated_at = ?
     WHERE id = ? AND visual_status = 'pending'`
  ).bind(sanitizeVisualError(error), now, item.id).run();
}

async function markNewsPulseVisualSkipped(env, item, { reason, now }) {
  await env.DB.prepare(
    `UPDATE news_pulse_items
     SET visual_status = 'skipped',
         visual_error = ?,
         visual_updated_at = ?
     WHERE id = ? AND (visual_status = 'missing' OR visual_status = 'failed' OR visual_status = 'pending')`
  ).bind(cleanText(reason, MAX_ERROR_LENGTH), now, item.id).run();
}

async function generateNewsPulseVisualForItem(env, item, { now, correlationId = null } = {}) {
  if (!item?.id || !cleanText(item.title, 160) || !isValidSourceUrl(item.url)) {
    await markNewsPulseVisualSkipped(env, item, { reason: "missing_valid_title_or_source_url", now });
    return { status: "skipped", reason: "invalid_item" };
  }

  const objectKey = buildNewsPulseVisualObjectKey(item.id);
  if (!objectKey) {
    await markNewsPulseVisualSkipped(env, item, { reason: "invalid_item_id", now });
    return { status: "skipped", reason: "invalid_item_id" };
  }

  const prompt = buildSafeNewsPulseVisualPrompt(item);
  let thumb;
  try {
    const result = await env.AI.run(NEWS_PULSE_VISUAL_MODEL_ID, { prompt, num_steps: 4 });
    const generated = await extractGeneratedImageBytes(result);
    if (!generated?.bytes?.byteLength) throw new Error("Image generation returned no bytes.");
    thumb = await renderNewsPulseThumb(env, generated.bytes);
  } catch (error) {
    await markNewsPulseVisualFailed(env, item, { error, now });
    logDiagnostic({
      service: "bitbi-auth",
      component: COMPONENT,
      event: "news_pulse_visual_generation_failed",
      level: "warn",
      correlationId,
      item_id: item.id,
      model: NEWS_PULSE_VISUAL_MODEL_ID,
      error: sanitizeVisualError(error),
    });
    return { status: "failed", reason: "generation_failed" };
  }

  try {
    await env.USER_IMAGES.put(objectKey, thumb.bytes, {
      httpMetadata: {
        contentType: thumb.mimeType || THUMB_MIME_TYPE,
      },
      customMetadata: {
        feature: "news-pulse",
        item_id: String(item.id).slice(0, 128),
      },
    });
  } catch (error) {
    await markNewsPulseVisualFailed(env, item, { error, now });
    logDiagnostic({
      service: "bitbi-auth",
      component: COMPONENT,
      event: "news_pulse_visual_store_failed",
      level: "warn",
      correlationId,
      item_id: item.id,
      error: sanitizeVisualError(error),
    });
    return { status: "failed", reason: "store_failed" };
  }

  try {
    await markNewsPulseVisualReady(env, item, {
      prompt,
      objectKey,
      thumbUrl: getNewsPulseVisualThumbUrl(item.id),
      now,
    });
  } catch (error) {
    try {
      await env.USER_IMAGES.delete(objectKey);
    } catch {
      // Best effort only; a later successful generation overwrites the deterministic key.
    }
    await markNewsPulseVisualFailed(env, item, { error, now });
    throw error;
  }

  logDiagnostic({
    service: "bitbi-auth",
    component: COMPONENT,
    event: "news_pulse_visual_ready",
    correlationId,
    item_id: item.id,
    object_key: objectKey,
    model: NEWS_PULSE_VISUAL_MODEL_ID,
  });
  return { status: "ready", objectKey };
}

export async function processNewsPulseVisualBackfill({
  env,
  now = new Date().toISOString(),
  limit = NEWS_PULSE_VISUAL_BATCH_LIMIT,
  correlationId = null,
} = {}) {
  if (!env?.DB || !env?.AI || typeof env.AI.run !== "function" || !env?.USER_IMAGES || !env?.IMAGES) {
    return {
      skipped: true,
      reason: "bindings_missing",
      scannedCount: 0,
      readyCount: 0,
      failedCount: 0,
      skippedCount: 0,
    };
  }

  let rows;
  try {
    rows = await listNewsPulseVisualCandidates(env, { now, limit });
  } catch (error) {
    if (isMissingNewsPulseVisualSchema(error)) {
      return {
        skipped: true,
        reason: "schema_missing",
        scannedCount: 0,
        readyCount: 0,
        failedCount: 0,
        skippedCount: 0,
      };
    }
    throw error;
  }

  let readyCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  for (const row of rows) {
    let acquired = false;
    try {
      acquired = await acquireNewsPulseVisual(env, row, { now });
      if (!acquired) {
        skippedCount += 1;
        continue;
      }
      const result = await generateNewsPulseVisualForItem(env, row, { now, correlationId });
      if (result.status === "ready") readyCount += 1;
      else if (result.status === "failed") failedCount += 1;
      else skippedCount += 1;
    } catch (error) {
      failedCount += 1;
      if (acquired) {
        try {
          await markNewsPulseVisualFailed(env, row, { error, now });
        } catch {
          // Preserve scheduled cleanup progress even if status recording fails.
        }
      }
      logDiagnostic({
        service: "bitbi-auth",
        component: COMPONENT,
        event: "news_pulse_visual_item_failed",
        level: "warn",
        correlationId,
        item_id: row?.id || null,
        error: sanitizeVisualError(error),
      });
    }
  }

  return {
    skipped: false,
    scannedCount: rows.length,
    readyCount,
    failedCount,
    skippedCount,
  };
}
