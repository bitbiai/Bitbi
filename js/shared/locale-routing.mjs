const DACH_COUNTRIES = new Set(["DE", "AT", "CH"]);
const LOCALE_COOKIE_NAME = "bitbi_locale";
const LOCALES = new Set(["en", "de"]);
const DOCUMENT_EXTENSIONS = new Set(["", ".html"]);
const STATIC_FILE_EXTENSIONS = new Set([
  ".avif",
  ".css",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".map",
  ".mjs",
  ".mp3",
  ".mp4",
  ".ogg",
  ".otf",
  ".png",
  ".svg",
  ".txt",
  ".wasm",
  ".webm",
  ".webmanifest",
  ".webp",
  ".woff",
  ".woff2",
  ".xml",
]);

const ROOT_FILE_EXCLUSIONS = new Set([
  "/favicon.ico",
  "/manifest.json",
  "/robots.txt",
  "/sitemap.xml",
]);

const STATIC_PREFIXES = [
  "/api/",
  "/assets/",
  "/css/",
  "/fonts/",
  "/js/",
  "/test-results/",
  "/playwright-report/",
  "/_site/",
];

const SPECIAL_DE_PATHS = new Map([
  ["/", "/de/"],
  ["/index.html", "/de/"],
  ["/pricing", "/de/pricing.html"],
  ["/pricing.html", "/de/pricing.html"],
  ["/generate-lab", "/de/generate-lab/"],
  ["/generate-lab/", "/de/generate-lab/"],
  ["/legal/privacy.html", "/de/legal/datenschutz.html"],
  ["/legal/datenschutz.html", "/de/legal/datenschutz.html"],
  ["/legal/imprint.html", "/de/legal/imprint.html"],
  ["/legal/terms.html", "/de/legal/terms.html"],
]);

const SPECIAL_EN_PATHS = new Map([
  ["/de/", "/"],
  ["/de/index.html", "/"],
  ["/de/pricing", "/pricing.html"],
  ["/de/pricing.html", "/pricing.html"],
  ["/de/generate-lab", "/generate-lab/"],
  ["/de/generate-lab/", "/generate-lab/"],
  ["/de/legal/datenschutz.html", "/legal/privacy.html"],
  ["/de/legal/privacy.html", "/legal/privacy.html"],
  ["/de/legal/imprint.html", "/legal/imprint.html"],
  ["/de/legal/terms.html", "/legal/terms.html"],
]);

function extensionFor(pathname) {
  const lastSegment = pathname.split("/").pop() || "";
  const dotIndex = lastSegment.lastIndexOf(".");
  return dotIndex === -1 ? "" : lastSegment.slice(dotIndex).toLowerCase();
}

function normalizePathname(pathname) {
  if (typeof pathname !== "string" || !pathname) return "/";
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return path.replace(/\/{2,}/g, "/");
}

export function normalizeLocale(value) {
  const locale = String(value || "").trim().toLowerCase();
  return LOCALES.has(locale) ? locale : "";
}

export function parseCookies(cookieHeader = "") {
  const cookies = new Map();
  for (const part of String(cookieHeader || "").split(";")) {
    const [rawName, ...rawValue] = part.split("=");
    const name = rawName?.trim();
    if (!name) continue;
    cookies.set(name, rawValue.join("=").trim());
  }
  return cookies;
}

export function getLocaleCookie(cookieHeader = "") {
  return normalizeLocale(parseCookies(cookieHeader).get(LOCALE_COOKIE_NAME));
}

export function isDachCountry(countryCode) {
  return DACH_COUNTRIES.has(String(countryCode || "").trim().toUpperCase());
}

export function getCountryCode(headers = {}) {
  const get = typeof headers.get === "function"
    ? (name) => headers.get(name)
    : (name) => headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
  return String(
    get("CF-IPCountry") ||
    get("x-vercel-ip-country") ||
    get("x-nf-country") ||
    "",
  ).trim().toUpperCase();
}

export function isGermanPath(pathname) {
  return normalizePathname(pathname).startsWith("/de/");
}

export function isDocumentRoute(pathname) {
  const path = normalizePathname(pathname);
  if (ROOT_FILE_EXCLUSIONS.has(path)) return false;
  if (STATIC_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  const ext = extensionFor(path);
  if (STATIC_FILE_EXTENSIONS.has(ext) && !DOCUMENT_EXTENSIONS.has(ext)) return false;
  return DOCUMENT_EXTENSIONS.has(ext);
}

export function toGermanPath(pathname) {
  const path = normalizePathname(pathname);
  if (path.startsWith("/de/")) return path;
  if (SPECIAL_DE_PATHS.has(path)) return SPECIAL_DE_PATHS.get(path);
  if (path.startsWith("/account/")) return `/de${path}`;
  if (path.startsWith("/admin/")) return `/de${path}`;
  if (path === "/admin") return "/de/admin/";
  return `/de${path}`;
}

export function toEnglishPath(pathname) {
  const path = normalizePathname(pathname);
  if (!path.startsWith("/de/")) return path;
  if (SPECIAL_EN_PATHS.has(path)) return SPECIAL_EN_PATHS.get(path);
  return path.slice(3) || "/";
}

export function mapLocalizedPath(pathname, locale) {
  return normalizeLocale(locale) === "de" ? toGermanPath(pathname) : toEnglishPath(pathname);
}

export function withSearch(pathname, search = "") {
  return `${pathname}${search || ""}`;
}

export function getLocalizedUrl(urlLike, locale) {
  const url = new URL(urlLike, "https://bitbi.ai");
  url.pathname = mapLocalizedPath(url.pathname, locale);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function shouldGeoRedirect(requestLike) {
  const method = String(requestLike?.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  const url = new URL(requestLike.url || "https://bitbi.ai/");
  if (!isDocumentRoute(url.pathname)) return false;
  if (isGermanPath(url.pathname)) return false;
  if (getLocaleCookie(requestLike.headers?.get?.("Cookie") || requestLike.headers?.cookie || "")) return false;
  return isDachCountry(getCountryCode(requestLike.headers || {}));
}

export function getGeoRedirectLocation(requestLike) {
  if (!shouldGeoRedirect(requestLike)) return "";
  const url = new URL(requestLike.url || "https://bitbi.ai/");
  url.pathname = toGermanPath(url.pathname);
  return url.toString();
}

export const LOCALE_ROUTING_VARY = "Cookie, CF-IPCountry, x-vercel-ip-country, x-nf-country";
