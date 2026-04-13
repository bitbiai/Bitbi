export const LEGACY_SESSION_COOKIE_NAME = "bitbi_session";
export const SECURE_SESSION_COOKIE_NAME = "__Host-bitbi_session";

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) continue;
    cookies[rawName] = rawValue.join("=");
  }

  return cookies;
}

export function getSessionTokenFromCookies(cookies) {
  return cookies?.[SECURE_SESSION_COOKIE_NAME] || cookies?.[LEGACY_SESSION_COOKIE_NAME] || null;
}

function buildCookie(name, value, isSecure, maxAge) {
  const parts = [
    `${name}=${value}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];

  if (isSecure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function buildSessionCookie(token, isSecure) {
  const cookieName = isSecure ? SECURE_SESSION_COOKIE_NAME : LEGACY_SESSION_COOKIE_NAME;
  return buildCookie(cookieName, token, isSecure, 2592000);
}

export function buildExpiredSessionCookies(isSecure) {
  const names = [LEGACY_SESSION_COOKIE_NAME];
  if (isSecure) {
    names.unshift(SECURE_SESSION_COOKIE_NAME);
  }
  return names.map((name) => buildCookie(name, "", isSecure, 0));
}
