import { sha256Hex } from "./tokens.js";

export const NEWS_PULSE_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=1800";
export const NEWS_PULSE_MAX_ITEMS = 8;
const NEWS_PULSE_SOURCE_LIMIT = 5;
const NEWS_PULSE_FETCH_TIMEOUT_MS = 5000;
const NEWS_PULSE_MAX_SOURCE_BYTES = 250000;
const NEWS_PULSE_RETENTION_DAYS = 30;
const NEWS_PULSE_ALLOWED_VISUAL_TYPES = new Set(["generated", "icon", "none"]);
const OPENCLAW_MAX_ITEMS_PER_REQUEST = 8;
const OPENCLAW_EXTERNAL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,96}$/;
const NEWS_PULSE_RELEVANCE_TERMS = [
  "ai",
  "artificial intelligence",
  "creative ai",
  "generative",
  "image generation",
  "video generation",
  "music generation",
  "audio generation",
  "model",
  "multimodal",
  "creator",
  "creative technology",
  "ki",
  "künstliche intelligenz",
  "generativ",
];

const SEED_UPDATED_AT = "2026-05-09T00:00:00.000Z";

const FALLBACK_ITEMS = Object.freeze({
  en: Object.freeze([
    Object.freeze({
      id: "seed-openai-news",
      title: "OpenAI newsroom updates",
      summary: "Official OpenAI updates are tracked for model, API, and creative workflow changes relevant to Bitbi creators.",
      source: "OpenAI",
      url: "https://openai.com/news/",
      category: "AI",
      published_at: SEED_UPDATED_AT,
      visual_type: "icon",
      visual_url: null,
    }),
    Object.freeze({
      id: "seed-google-ai-blog",
      title: "Google AI product and research updates",
      summary: "Google AI updates are tracked for Gemini, media generation, and developer tooling changes across creative technology.",
      source: "Google AI",
      url: "https://blog.google/technology/ai/",
      category: "AI",
      published_at: SEED_UPDATED_AT,
      visual_type: "icon",
      visual_url: null,
    }),
    Object.freeze({
      id: "seed-adobe-newsroom",
      title: "Adobe creative AI updates",
      summary: "Adobe creative tooling updates are tracked for Firefly, production workflows, image generation, and creator features.",
      source: "Adobe Newsroom",
      url: "https://news.adobe.com/",
      category: "Creative Tech",
      published_at: SEED_UPDATED_AT,
      visual_type: "icon",
      visual_url: null,
    }),
  ]),
  de: Object.freeze([
    Object.freeze({
      id: "seed-openai-news-de",
      title: "OpenAI-Newsroom-Updates",
      summary: "Offizielle OpenAI-Updates werden für Modell-, API- und Kreativ-Workflow-Änderungen verfolgt, die für Bitbi-Creators relevant sind.",
      source: "OpenAI",
      url: "https://openai.com/news/",
      category: "KI",
      published_at: SEED_UPDATED_AT,
      visual_type: "icon",
      visual_url: null,
    }),
    Object.freeze({
      id: "seed-google-ai-blog-de",
      title: "Google-AI Produkt- und Forschungsupdates",
      summary: "Google-AI-Updates werden für Gemini, Mediengenerierung und Entwicklerwerkzeuge im Creative-Tech-Bereich verfolgt.",
      source: "Google AI",
      url: "https://blog.google/technology/ai/",
      category: "KI",
      published_at: SEED_UPDATED_AT,
      visual_type: "icon",
      visual_url: null,
    }),
    Object.freeze({
      id: "seed-adobe-newsroom-de",
      title: "Adobe Creative-AI-Updates",
      summary: "Adobe-Updates werden für Firefly, Produktionsworkflows, Bildgenerierung und Creator-Funktionen verfolgt.",
      source: "Adobe Newsroom",
      url: "https://news.adobe.com/",
      category: "Creative Tech",
      published_at: SEED_UPDATED_AT,
      visual_type: "icon",
      visual_url: null,
    }),
  ]),
});

export class OpenClawNewsPulseValidationError extends Error {
  constructor(message, { status = 400, code = "openclaw_ingest_validation_error", field = null } = {}) {
    super(message);
    this.name = "OpenClawNewsPulseValidationError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export function normalizeNewsPulseLocale(value) {
  const locale = String(value || "").trim().toLowerCase();
  return locale === "de" || locale.startsWith("de-") ? "de" : "en";
}

function isMissingNewsPulseTable(error) {
  return String(error?.message || error).includes("no such table") &&
    String(error?.message || error).includes("news_pulse_items");
}

function clampText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function normalizeSourceUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function normalizeVisualUrl(value) {
  const href = normalizeSourceUrl(value);
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.hostname === "bitbi.ai" || url.hostname === "pub.bitbi.ai" ? href : null;
  } catch {
    return null;
  }
}

function normalizeIsoDate(value, fallback = SEED_UPDATED_AT) {
  const date = new Date(value || fallback);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function normalizeVisualType(value) {
  const normalized = String(value || "icon").trim().toLowerCase();
  return NEWS_PULSE_ALLOWED_VISUAL_TYPES.has(normalized) ? normalized : "icon";
}

function validationError(message, field = null) {
  return new OpenClawNewsPulseValidationError(message, { field });
}

function cleanPlainText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRequiredOpenClawText(value, { field, maxLength }) {
  const text = cleanPlainText(value);
  if (!text) throw validationError(`${field} is required.`, field);
  if (/[<>]/.test(text)) throw validationError(`${field} must not contain HTML.`, field);
  if (text.length > maxLength) throw validationError(`${field} is too long.`, field);
  return text;
}

function normalizeOptionalOpenClawText(value, { field, maxLength, fallback = "" }) {
  const text = cleanPlainText(value || fallback);
  if (!text) return "";
  if (/[<>]/.test(text)) throw validationError(`${field} must not contain HTML.`, field);
  if (text.length > maxLength) throw validationError(`${field} is too long.`, field);
  return text;
}

function normalizeOpenClawUrl(value, field) {
  const href = normalizeSourceUrl(value);
  if (!href) throw validationError(`${field} must be a valid HTTPS URL without credentials.`, field);
  return href;
}

function normalizeOpenClawVisualUrl(value) {
  if (value == null || value === "") return null;
  const href = normalizeVisualUrl(value);
  if (!href) {
    throw validationError("visual_url must be an HTTPS bitbi.ai or pub.bitbi.ai URL.", "visual_url");
  }
  return href;
}

function normalizeOpenClawPublishedAt(value, now) {
  if (value == null || value === "") return normalizeIsoDate(now, now);
  if (typeof value !== "string") {
    throw validationError("published_at must be a valid ISO timestamp.", "published_at");
  }
  const date = new Date(value.trim());
  if (Number.isNaN(date.getTime())) {
    throw validationError("published_at must be a valid ISO timestamp.", "published_at");
  }
  return date.toISOString();
}

function normalizeOpenClawVisualType(value) {
  const normalized = String(value || "icon").trim().toLowerCase();
  if (!NEWS_PULSE_ALLOWED_VISUAL_TYPES.has(normalized)) {
    throw validationError("visual_type is not supported.", "visual_type");
  }
  return normalized;
}

function normalizeOpenClawExternalId(value) {
  if (value == null || value === "") return "";
  const externalId = cleanPlainText(value);
  if (!OPENCLAW_EXTERNAL_ID_PATTERN.test(externalId)) {
    throw validationError("external_id contains unsupported characters.", "external_id");
  }
  return externalId;
}

function normalizeOpenClawTags(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw validationError("tags must be an array.", "tags");
  if (value.length > 8) throw validationError("tags may contain at most 8 entries.", "tags");
  return value.map((entry) => {
    const tag = normalizeOptionalOpenClawText(entry, { field: "tags", maxLength: 32 });
    if (!tag) throw validationError("tags must not contain empty entries.", "tags");
    return tag;
  });
}

function normalizeOpenClawAgent(value) {
  const agent = cleanPlainText(value).toLowerCase();
  if (!/^[a-z0-9._:-]{2,64}$/.test(agent)) {
    throw validationError("agent is invalid.", "agent");
  }
  return agent;
}

export async function buildOpenClawNewsPulseId({ locale, external_id: externalId, url }) {
  const key = externalId
    ? `openclaw:${normalizeNewsPulseLocale(locale)}:external:${externalId}`
    : `openclaw:${normalizeNewsPulseLocale(locale)}:url:${url}`;
  const hash = await sha256Hex(key);
  return `openclaw_${normalizeNewsPulseLocale(locale)}_${hash.slice(0, 32)}`;
}

export async function normalizeOpenClawNewsPulseItem(item, {
  locale = "en",
  agent = "openclaw",
  now = new Date().toISOString(),
} = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw validationError("Each item must be an object.", "items");
  }
  const normalizedLocale = normalizeNewsPulseLocale(locale);
  const normalizedAgent = normalizeOpenClawAgent(agent);
  const title = normalizeRequiredOpenClawText(item.title, { field: "title", maxLength: 160 });
  const summary = normalizeRequiredOpenClawText(item.summary, { field: "summary", maxLength: 240 });
  const source = normalizeRequiredOpenClawText(item.source, { field: "source", maxLength: 80 });
  const url = normalizeOpenClawUrl(item.url, "url");
  const category = normalizeOptionalOpenClawText(item.category, {
    field: "category",
    maxLength: 48,
    fallback: normalizedLocale === "de" ? "KI" : "AI",
  });
  const publishedAt = normalizeOpenClawPublishedAt(item.published_at, now);
  const visualType = normalizeOpenClawVisualType(item.visual_type);
  const visualUrl = normalizeOpenClawVisualUrl(item.visual_url);
  const externalId = normalizeOpenClawExternalId(item.external_id);
  normalizeOpenClawTags(item.tags);
  const id = await buildOpenClawNewsPulseId({ locale: normalizedLocale, external_id: externalId, url });
  const contentHash = await sha256Hex(JSON.stringify({
    locale: normalizedLocale,
    title,
    summary,
    source,
    url,
    category,
    published_at: publishedAt,
    visual_type: visualType,
    visual_url: visualUrl,
    external_id: externalId || null,
  }));
  const createdAt = normalizeIsoDate(now, new Date().toISOString());
  return {
    id,
    locale: normalizedLocale,
    title,
    summary,
    source,
    url,
    category,
    published_at: publishedAt,
    visual_type: visualType,
    visual_url: visualUrl,
    source_key: `openclaw:${normalizedAgent}`,
    content_hash: contentHash,
    expires_at: new Date(Date.parse(createdAt) + NEWS_PULSE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    created_at: createdAt,
    updated_at: createdAt,
  };
}

export async function ingestOpenClawNewsPulseItems(env, payload, {
  agent = "openclaw",
  now = new Date().toISOString(),
  dryRun = false,
} = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw validationError("Payload must be a JSON object.", "payload");
  }
  const locale = normalizeNewsPulseLocale(payload.locale);
  if (!Array.isArray(payload.items)) {
    throw validationError("items must be an array.", "items");
  }
  if (payload.items.length > OPENCLAW_MAX_ITEMS_PER_REQUEST) {
    throw validationError(`items may contain at most ${OPENCLAW_MAX_ITEMS_PER_REQUEST} entries.`, "items");
  }
  const normalizedItems = [];
  for (const item of payload.items) {
    normalizedItems.push(await normalizeOpenClawNewsPulseItem(item, { locale, agent, now }));
  }
  if (!dryRun && !env?.DB) {
    throw new OpenClawNewsPulseValidationError("News Pulse storage is not configured.", {
      status: 503,
      code: "openclaw_ingest_not_configured",
    });
  }
  if (!dryRun) {
    for (const item of normalizedItems) {
      await storeNewsPulseItem(env, item);
    }
  }
  return {
    stored_count: dryRun ? 0 : normalizedItems.length,
    skipped_count: 0,
    dry_run: Boolean(dryRun),
    items: normalizedItems.map((item) => ({
      id: item.id,
      locale: item.locale,
      title: item.title,
      url: item.url,
    })),
  };
}

function normalizeNewsPulseItem(row, locale) {
  const url = normalizeSourceUrl(row?.url);
  const title = clampText(row?.title, 160);
  const summary = clampText(row?.summary, 240);
  const source = clampText(row?.source, 80);
  if (!url || !title || !summary || !source) return null;
  return {
    id: clampText(row?.id || `${locale}-${url}`, 96),
    title,
    summary,
    source,
    url,
    category: clampText(row?.category || (locale === "de" ? "KI" : "AI"), 48),
    published_at: normalizeIsoDate(row?.published_at),
    visual_type: normalizeVisualType(row?.visual_type),
    visual_url: row?.visual_url ? normalizeVisualUrl(row.visual_url) : null,
  };
}

function fallbackItems(locale) {
  return FALLBACK_ITEMS[locale].map((item) => ({ ...item }));
}

export async function getNewsPulseItems(env, locale, { now = new Date().toISOString() } = {}) {
  const normalizedLocale = normalizeNewsPulseLocale(locale);
  if (!env?.DB) {
    return {
      items: fallbackItems(normalizedLocale),
      updated_at: now,
      source: "fallback",
    };
  }

  try {
    const result = await env.DB.prepare(
      `SELECT id, title, summary, source, url, category, published_at, visual_type, visual_url, updated_at
       FROM news_pulse_items
       WHERE locale = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY published_at DESC, updated_at DESC
       LIMIT ?`
    ).bind(normalizedLocale, now, NEWS_PULSE_MAX_ITEMS).all();
    const items = (result?.results || [])
      .map((row) => normalizeNewsPulseItem(row, normalizedLocale))
      .filter(Boolean);
    if (items.length > 0) {
      const updatedAt = (result.results || [])
        .map((row) => normalizeIsoDate(row.updated_at, now))
        .sort()
        .at(-1) || now;
      return { items, updated_at: updatedAt, source: "cache" };
    }
  } catch (error) {
    if (!isMissingNewsPulseTable(error)) throw error;
  }

  return {
    items: fallbackItems(normalizedLocale),
    updated_at: now,
    source: "fallback",
  };
}

function parseConfiguredSources(value) {
  if (!value) return [];
  let candidates = [];
  const raw = String(value).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) candidates = parsed;
  } catch {
    candidates = raw.split(/[\n,]+/);
  }
  const seen = new Set();
  const sources = [];
  for (const entry of candidates) {
    const url = normalizeSourceUrl(typeof entry === "object" && entry ? entry.url : entry);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({
      url,
      locale: normalizeNewsPulseLocale(typeof entry === "object" && entry ? entry.locale : "en"),
    });
    if (sources.length >= NEWS_PULSE_SOURCE_LIMIT) break;
  }
  return sources;
}

function stripMarkup(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function getTagText(block, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}\\s*>`, "i");
  const match = block.match(pattern);
  return match ? stripMarkup(match[1]) : "";
}

function parseFeedText(text, sourceUrl) {
  const trimmed = String(text || "").slice(0, NEWS_PULSE_MAX_SOURCE_BYTES).trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed?.items)) {
      return parsed.items.map((item) => ({
        title: item?.title,
        summary: item?.summary || item?.content_text || stripMarkup(item?.content_html),
        source: parsed?.title || new URL(sourceUrl).hostname,
        url: item?.url || item?.external_url,
        published_at: item?.date_published || item?.date_modified,
        category: "AI",
      }));
    }
  } catch {
    /* Not JSON feed. Try RSS/Atom below. */
  }

  const blocks = [...trimmed.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)]
    .map((match) => match[2])
    .slice(0, NEWS_PULSE_MAX_ITEMS * 2);
  return blocks.map((block) => {
    const linkHref = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i)?.[1];
    return {
      title: getTagText(block, "title"),
      summary: getTagText(block, "description") || getTagText(block, "summary"),
      source: new URL(sourceUrl).hostname,
      url: getTagText(block, "link") || linkHref,
      published_at: getTagText(block, "pubDate") || getTagText(block, "updated") || getTagText(block, "published"),
      category: "AI",
    };
  });
}

function isRelevantPulseItem(item) {
  const text = `${item?.title || ""} ${item?.summary || ""} ${item?.category || ""}`.toLowerCase();
  return NEWS_PULSE_RELEVANCE_TERMS.some((term) => text.includes(term));
}

async function fetchTextWithTimeout(fetcher, url) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), NEWS_PULSE_FETCH_TIMEOUT_MS)
    : null;
  try {
    const response = await fetcher(url, {
      headers: { accept: "application/feed+json, application/json, application/rss+xml, application/atom+xml, text/xml;q=0.8" },
      signal: controller?.signal,
    });
    if (!response?.ok) return "";
    return String(await response.text()).slice(0, NEWS_PULSE_MAX_SOURCE_BYTES);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function normalizeFetchedItem(item, sourceUrl, now, locale = "en") {
  const url = normalizeSourceUrl(item?.url);
  const title = clampText(item?.title, 160);
  const summary = clampText(item?.summary || title, 240);
  const source = clampText(item?.source || new URL(sourceUrl).hostname, 80);
  if (!url || !title || !summary || !source) return null;
  const hash = await sha256Hex(url);
  return {
    id: `pulse_${normalizeNewsPulseLocale(locale)}_${hash.slice(0, 32)}`,
    locale: normalizeNewsPulseLocale(locale),
    title,
    summary,
    source,
    url,
    category: clampText(item?.category || "AI", 48),
    published_at: normalizeIsoDate(item?.published_at, now),
    visual_type: "icon",
    visual_url: null,
    source_key: sourceUrl,
    content_hash: hash,
    expires_at: new Date(Date.parse(now) + NEWS_PULSE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    created_at: now,
    updated_at: now,
  };
}

async function storeNewsPulseItem(env, item) {
  await env.DB.prepare(
    `INSERT INTO news_pulse_items (
       id, locale, title, summary, source, url, category, published_at, visual_type, visual_url,
       status, source_key, content_hash, expires_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       summary = excluded.summary,
       source = excluded.source,
       url = excluded.url,
       category = excluded.category,
       published_at = excluded.published_at,
       visual_type = excluded.visual_type,
       visual_url = excluded.visual_url,
       status = 'active',
       source_key = excluded.source_key,
       content_hash = excluded.content_hash,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`
  ).bind(
    item.id,
    item.locale,
    item.title,
    item.summary,
    item.source,
    item.url,
    item.category,
    item.published_at,
    item.visual_type,
    item.visual_url,
    item.source_key,
    item.content_hash,
    item.expires_at,
    item.created_at,
    item.updated_at
  ).run();
}

export async function cleanupNewsPulseItems(env, { now = new Date().toISOString() } = {}) {
  if (!env?.DB) return { deletedCount: 0 };
  try {
    const result = await env.DB.prepare(
      "DELETE FROM news_pulse_items WHERE expires_at IS NOT NULL AND expires_at < ?"
    ).bind(now).run();
    return { deletedCount: Number(result?.meta?.changes || 0) };
  } catch (error) {
    if (isMissingNewsPulseTable(error)) return { deletedCount: 0, skipped: true };
    throw error;
  }
}

export async function refreshNewsPulse({ env, now = new Date().toISOString() } = {}) {
  const cleanup = await cleanupNewsPulseItems(env, { now });
  const sources = parseConfiguredSources(env?.NEWS_PULSE_SOURCE_URLS);
  if (!env?.DB || cleanup.skipped || sources.length === 0) {
    return {
      skipped: true,
      reason: cleanup.skipped ? "table_missing" : (sources.length === 0 ? "source_config_missing" : "db_missing"),
      deletedCount: cleanup.deletedCount || 0,
      storedCount: 0,
    };
  }

  const fetcher = env.__TEST_FETCH || fetch;
  const byUrl = new Map();
  for (const { url: sourceUrl, locale } of sources) {
    const text = await fetchTextWithTimeout(fetcher, sourceUrl);
    const parsedItems = parseFeedText(text, sourceUrl);
    for (const parsedItem of parsedItems) {
      if (!isRelevantPulseItem(parsedItem)) continue;
      const normalized = await normalizeFetchedItem(parsedItem, sourceUrl, now, locale);
      if (!normalized) continue;
      const dedupeKey = `${normalized.locale}:${normalized.url}`;
      if (!byUrl.has(dedupeKey)) byUrl.set(dedupeKey, normalized);
    }
  }

  const items = [...byUrl.values()]
    .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
    .slice(0, NEWS_PULSE_MAX_ITEMS);
  for (const item of items) {
    await storeNewsPulseItem(env, item);
  }

  return {
    skipped: false,
    deletedCount: cleanup.deletedCount || 0,
    storedCount: items.length,
    sourceCount: sources.length,
  };
}
