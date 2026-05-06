import fs from "node:fs";
import path from "node:path";

export const SITE_ROOT_FILES = ["index.html", "pricing.html", "robots.txt", "sitemap.xml", "_worker.js"];
export const SITE_ROOT_DIRS = ["assets", "css", "fonts", "js", "account", "admin", "legal", "generate-lab", "de"];
const SOURCE_SCAN_ROOTS = ["index.html", "pricing.html", "admin", "account", "legal", "generate-lab", "de", "js", "_worker.js", "CLAUDE.md"];
const TEXT_EXTENSIONS = new Set([".html", ".js", ".mjs", ".css", ".md"]);
const MANUAL_TOKEN_PATTERNS = [
  "Keep this token aligned",
  "Admin Release Token Checklist",
  "**Cache busting**: All CSS/JS `<link>`/`<script>` tags use `?v=YYYYMMDD`",
  "Bump the `../../shared/auth-api.js?v=...` import and `ADMIN_AI_UI_VERSION` together",
];

function walkFiles(rootDir, relativePath = "") {
  const abs = path.join(rootDir, relativePath);
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryRelative = path.join(relativePath, entry.name);
    if (entry.name === "node_modules" || entry.name === "_site" || entry.name === ".wrangler") {
      continue;
    }
    if (entryRelative.startsWith(`js${path.sep}vendor${path.sep}`)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...walkFiles(rootDir, entryRelative));
      continue;
    }
    files.push(entryRelative);
  }
  return files;
}

function isTextFile(relativePath) {
  return TEXT_EXTENSIONS.has(path.extname(relativePath));
}

export function loadAssetVersionManifest(repoRoot) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, "config/release-compat.json"), "utf8"));
}

export function collectAssetVersionSourceFiles(repoRoot) {
  const files = [];
  for (const entry of SOURCE_SCAN_ROOTS) {
    const abs = path.join(repoRoot, entry);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const file of walkFiles(repoRoot, entry)) {
        if (isTextFile(file)) files.push(file);
      }
      continue;
    }
    if (isTextFile(entry)) files.push(entry);
  }
  return files.sort();
}

export function extractAssetVersionTokens(source) {
  const matches = [];
  const pattern = /\?v=([A-Za-z0-9_.:-]+)/g;
  let match = pattern.exec(source);
  while (match) {
    matches.push(match[1]);
    match = pattern.exec(source);
  }
  return matches;
}

export function validateAssetVersionSources({ files, placeholder }) {
  const issues = [];
  let placeholderHits = 0;

  for (const [relativePath, source] of Object.entries(files)) {
    const tokens = extractAssetVersionTokens(source);
    for (const token of tokens) {
      if (token !== placeholder) {
        issues.push(
          `${relativePath} still uses hardcoded asset version token "${token}" instead of "${placeholder}".`
        );
      } else {
        placeholderHits += 1;
      }
    }
    for (const pattern of MANUAL_TOKEN_PATTERNS) {
      if (source.includes(pattern)) {
        issues.push(`${relativePath} still contains manual asset-version choreography text: "${pattern}".`);
      }
    }
  }

  if (placeholderHits === 0) {
    issues.push(`No source asset references use the "${placeholder}" placeholder.`);
  }

  return issues;
}

export function generateAssetVersionToken(env = process.env) {
  if (env.ASSET_VERSION) return env.ASSET_VERSION;
  if (env.GITHUB_SHA) {
    const sha = env.GITHUB_SHA.slice(0, 12);
    const runId = String(env.GITHUB_RUN_ID || "").trim();
    if (!runId) return sha;
    const runAttempt = String(env.GITHUB_RUN_ATTEMPT || "1").trim() || "1";
    return `${sha}-${runId}-${runAttempt}`;
  }
  return `local-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyPath(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyPath(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function replacePlaceholderInTree(rootDir, placeholder, versionToken) {
  const files = walkFiles(rootDir).filter(isTextFile);
  for (const relativePath of files) {
    const abs = path.join(rootDir, relativePath);
    const source = fs.readFileSync(abs, "utf8");
    const next = source.split(placeholder).join(versionToken);
    if (next !== source) {
      fs.writeFileSync(abs, next);
    }
  }
}

export function buildStaticSite(repoRoot, { outDir, placeholder, versionToken }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  ensureDir(outDir);

  for (const file of SITE_ROOT_FILES) {
    const src = path.join(repoRoot, file);
    if (fs.existsSync(src)) {
      copyPath(src, path.join(outDir, file));
    }
  }

  for (const dir of SITE_ROOT_DIRS) {
    const src = path.join(repoRoot, dir);
    if (fs.existsSync(src)) {
      copyPath(src, path.join(outDir, dir));
    }
  }

  replacePlaceholderInTree(outDir, placeholder, versionToken);

  const unresolved = [];
  for (const relativePath of walkFiles(outDir).filter(isTextFile)) {
    const source = fs.readFileSync(path.join(outDir, relativePath), "utf8");
    if (source.includes(placeholder)) {
      unresolved.push(relativePath);
    }
  }
  if (unresolved.length > 0) {
    throw new Error(`Build output still contains unresolved asset version placeholder in: ${unresolved.join(", ")}`);
  }
}
