export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isValidEmail(email) {
  if (typeof email !== "string") return false;

  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254) return false;

  for (const char of trimmed) {
    if (char !== char.trim()) return false;
  }

  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0 || atIndex !== trimmed.lastIndexOf("@") || atIndex === trimmed.length - 1) {
    return false;
  }

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (!local || !domain) return false;
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return false;
  }

  return domain.split(".").every(Boolean);
}

export async function readJsonBody(request) {
  try {
    const ct = request.headers.get("Content-Type") || "";
    if (!ct.includes("application/json")) return null;
    return await request.json();
  } catch {
    return null;
  }
}

export function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}
