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

export function buildSessionCookie(token, isSecure) {
  const parts = [
    `bitbi_session=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=2592000",
  ];

  if (isSecure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function buildExpiredSessionCookie(isSecure) {
  const parts = [
    "bitbi_session=",
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (isSecure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}
