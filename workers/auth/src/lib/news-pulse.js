import { sha256Hex } from "./tokens.js";

export const NEWS_PULSE_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=1800";
export const NEWS_PULSE_MAX_ITEMS = 8;
const NEWS_PULSE_SOURCE_LIMIT = 5;
const NEWS_PULSE_FETCH_TIMEOUT_MS = 5000;
const NEWS_PULSE_MAX_SOURCE_BYTES = 250000;
const NEWS_PULSE_RETENTION_DAYS = 30;
const NEWS_PULSE_ALLOWED_VISUAL_TYPES = new Set(["generated", "icon", "none"]);
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
