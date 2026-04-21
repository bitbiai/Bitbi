function normalizePart(value) {
  return value == null ? "" : String(value);
}

function toEpochToken(value) {
  const timestamp = Date.parse(normalizePart(value));
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "0";
  }
  return timestamp.toString(36);
}

function hashToBase36(value) {
  let hash = 2166136261;
  const input = normalizePart(value);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

function buildVersionToken(parts) {
  const normalized = parts.map(normalizePart);
  return `v${toEpochToken(normalized[0])}-${hashToBase36(normalized.join("|"))}`;
}

function encodeSegment(value) {
  return encodeURIComponent(normalizePart(value));
}

function buildPublicMediaUrl(category, itemId, version, variant) {
  return `/api/gallery/${category}/${encodeSegment(itemId)}/${encodeSegment(version)}/${variant}`;
}

function toPathname(value) {
  const input = normalizePart(value).trim();
  if (!input) return "";
  if (input.startsWith("/")) return input;
  try {
    return new URL(input).pathname;
  } catch {
    return "";
  }
}

function parseVersionedPath(category, value, variantsPattern) {
  const pathname = toPathname(value);
  if (!pathname) return null;
  const match = pathname.match(new RegExp(`^/api/gallery/${category}/([^/]+)/([^/]+)/(${variantsPattern})$`));
  if (!match) return null;
  return {
    itemId: decodeURIComponent(match[1]),
    version: decodeURIComponent(match[2]),
    variant: match[3],
  };
}

export function buildPublicMempicVersion(row = {}) {
  return buildVersionToken([
    row.published_at || row.created_at || "",
    row.r2_key || "",
    row.thumb_key || "",
    row.medium_key || "",
    row.derivatives_version || "",
    row.derivatives_ready_at || "",
  ]);
}

export function buildPublicMemvidVersion(row = {}) {
  return buildVersionToken([
    row.published_at || row.created_at || "",
    row.r2_key || "",
    row.poster_r2_key || "",
    row.created_at || "",
    row.mime_type || "",
  ]);
}

export function buildPublicMempicUrl(itemId, version, variant) {
  return buildPublicMediaUrl("mempics", itemId, version, variant);
}

export function buildPublicMemvidUrl(itemId, version, variant) {
  return buildPublicMediaUrl("memvids", itemId, version, variant);
}

export function getPublicMempicVersionFromUrl(value) {
  return parseVersionedPath("mempics", value, "thumb|medium|file")?.version || "";
}

export function getPublicMemvidVersionFromUrl(value) {
  return parseVersionedPath("memvids", value, "poster|file")?.version || "";
}
