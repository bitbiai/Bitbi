export const REMOTE_MEDIA_URL_POLICY_CODE = "remote_url_not_allowed";

function sanitizePathSegment(segment) {
  if (!segment) return "";
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }

  const safe = decoded.replace(/[^A-Za-z0-9._-]+/g, "");
  if (safe && safe.length <= 24) {
    return safe;
  }

  const extMatch = safe.match(/\.([A-Za-z0-9]{1,8})$/);
  if (extMatch) {
    return `[redacted].${extMatch[1].toLowerCase()}`;
  }

  return "[redacted]";
}

function sanitizePathname(pathname) {
  if (typeof pathname !== "string" || !pathname) return "/";

  const segments = pathname
    .split("/")
    .filter(Boolean)
    .slice(0, 4)
    .map(sanitizePathSegment)
    .filter(Boolean);

  if (segments.length === 0) return "/";
  return `/${segments.join("/")}`;
}

export function summarizeRemoteUrlForLogs(value) {
  try {
    const parsed = new URL(String(value));
    return {
      remote_url_scheme: parsed.protocol.replace(/:$/, "").toLowerCase() || null,
      remote_url_host: parsed.hostname.toLowerCase() || null,
      remote_url_port: parsed.port || null,
      remote_url_path: sanitizePathname(parsed.pathname),
      remote_url_has_query: parsed.search ? true : false,
      remote_url_has_credentials: parsed.username || parsed.password ? true : false,
    };
  } catch {
    return {
      remote_url_invalid: true,
    };
  }
}

export function attachRemoteMediaPolicyContext(error, value, { field, reason } = {}) {
  if (!error || typeof error !== "object") return error;
  error.remoteMediaPolicy = {
    remote_media_field: field || null,
    remote_media_reason: reason || "remote_media_url_rejected",
    ...summarizeRemoteUrlForLogs(value),
  };
  return error;
}

export function getRemoteMediaPolicyLogFields(error) {
  if (!error?.remoteMediaPolicy || typeof error.remoteMediaPolicy !== "object") {
    return {};
  }
  return { ...error.remoteMediaPolicy };
}

export function buildRemoteMediaUrlRejectedMessage(field, acceptedHint) {
  const prefix = field ? `${field} cannot be a remote URL.` : "Remote media URLs are not accepted.";
  const suffix = acceptedHint || "Provide inline media bytes or a Bitbi-managed asset reference instead.";
  return `${prefix} ${suffix}`;
}
