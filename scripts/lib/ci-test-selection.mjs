import path from "node:path";
import { isMemberModelFastDeployPath } from "./fast-deploy-paths.mjs";

const DOCUMENTATION_FILENAMES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
]);

const ROOT_STATIC_FILES = new Set([
  "404.html",
  "_worker.js",
  "index.html",
  "pricing.html",
  "robots.txt",
  "sitemap.xml",
]);

const STATIC_BUILD_RELATED_FILES = new Set([
  "scripts/build-static-site.mjs",
  "scripts/lib/asset-version.mjs",
  "scripts/test-asset-version.mjs",
  "scripts/validate-asset-version.mjs",
]);

// Keep this aligned with the shared Worker impact map in release-plan.mjs.
const SHARED_WORKER_FILE_MAP = new Map([
  ["workers/shared/ai-caller-policy.mjs", ["auth", "ai"]],
  ["workers/shared/fable-chat-contract.mjs", ["auth", "ai"]],
  ["workers/shared/fable-chat-memory-contract.mjs", ["auth", "ai"]],
  ["js/shared/admin-ai-contract.mjs", ["auth", "ai"]],
  ["js/shared/ai-image-models.mjs", ["auth"]],
  ["js/shared/durable-rate-limit-do.mjs", ["auth", "contact"]],
  ["js/shared/generation-timeout.mjs", ["auth", "ai"]],
  ["js/shared/public-media-contract.mjs", ["auth"]],
  ["js/shared/remote-media-policy.mjs", ["auth"]],
  ["js/shared/request-body.mjs", ["auth", "ai", "contact"]],
  ["js/shared/worker-observability.mjs", ["auth", "ai", "contact"]],
]);

const STATIC_PREFIXES = [
  "account/",
  "admin/",
  "assets/",
  "canvas/",
  "css/",
  "de/",
  "fonts/",
  "generate-lab/",
  "js/",
  "legal/",
];

const AUTH_FRONTEND_PREFIXES = [
  "account/",
  "admin/",
  "css/account/",
  "css/admin/",
  "de/account/",
  "js/pages/account/",
  "js/pages/admin/",
  "js/pages/pricing/",
];

const AUTH_FRONTEND_FILES = new Set([
  "css/pages/pricing.css",
  "de/pricing.html",
  "pricing.html",
]);

const AUTH_SHARED_PATTERNS = [
  /(?:^|\/)auth(?:-|\/|\.)/,
  /(?:^|\/)session(?:-|\/|\.)/,
  /(?:^|\/)wallet(?:-|\/|\.)/,
];

const HOMEPAGE_CORE_TEST_FILES = new Set([
  "tests/audio-player.spec.js",
  "tests/canvas.spec.js",
  "tests/locale.spec.js",
  "tests/smoke.spec.js",
]);

const CAROUSEL_FILES = new Set([
  "css/pages/index.css",
  "de/index.html",
  "index.html",
  "js/pages/index/category-carousel.js",
  "js/pages/index/category-ghost-models.js",
  "js/pages/index/explore-order.js",
  "js/pages/index/gallery.js",
  "js/pages/index/main.js",
  "js/pages/index/public-media-wall.js",
  "js/pages/index/soundlab.js",
  "js/pages/index/video-gallery.js",
  "playwright.carousel.config.js",
  "tests/homepage-carousel-focused.spec.js",
]);

const ASSETS_MANAGER_PAGE_FILES = new Set([
  "account/assets-manager.html",
  "css/account/assets-manager.css",
  "de/account/assets-manager.html",
  "js/pages/assets-manager/main.js",
]);

const ASSETS_MANAGER_SHARED_FILES = new Set([
  "js/shared/help-menu.js",
  "js/shared/saved-assets-browser.js",
  "js/shared/storage-format.js",
]);

const AUTH_TEST_FILES = new Set([
  "tests/auth-admin.spec.js",
  "tests/wallet-nav.spec.js",
]);

const WORKER_TEST_PREFIXES = [
  "tests/fable-chat-",
  "tests/helpers/auth-worker-harness.js",
  "tests/helpers/sqlite-d1.js",
  "tests/workers.spec.js",
];

const FULL_REGRESSION_PATHS = new Set([
  "scripts/lib/ci-test-selection.mjs",
  "scripts/select-ci-tests.mjs",
  "scripts/test-ci-test-selection.mjs",
]);

function normalizeFile(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

function normalizeFiles(files) {
  return [...new Set((files || []).map(normalizeFile).filter(Boolean))].sort();
}

function hasPrefix(file, prefixes) {
  return prefixes.some((prefix) => file === prefix.slice(0, -1) || file.startsWith(prefix));
}

function isDocumentation(file) {
  const basename = path.posix.basename(file);
  return file.startsWith("docs/")
    || file.startsWith("github-actions-stuck-evidence/")
    || file.startsWith(".github/ISSUE_TEMPLATE/")
    || file.startsWith(".github/PULL_REQUEST_TEMPLATE/")
    || DOCUMENTATION_FILENAMES.has(basename)
    || file.endsWith(".md");
}

function isStaticSource(file) {
  return ROOT_STATIC_FILES.has(file) || hasPrefix(file, STATIC_PREFIXES);
}

function isWorkerTest(file) {
  return WORKER_TEST_PREFIXES.some((entry) => (
    entry.endsWith("/") ? file.startsWith(entry) : file === entry || file.startsWith(entry)
  ));
}

function addReason(selection, suite, file, reason) {
  selection[suite] = true;
  selection.reasons[suite].push(`${file}: ${reason}`);
}

function selectFullRegression(selection, file, reason) {
  selection.full = true;
  selection.reasons.full.push(`${file || "<no changed files>"}: ${reason}`);
}

export function selectCiTests(files, { forceFull = false, forceReason = "explicit full regression" } = {}) {
  const changedFiles = normalizeFiles(files);
  const selection = {
    files: changedFiles,
    docsOnly: false,
    homepage: false,
    memberModels: false,
    carousel: false,
    assets: false,
    workers: false,
    auth: false,
    dependencies: false,
    workerDependencies: false,
    static: false,
    full: false,
    runtime: false,
    reasons: {
      homepage: [],
      memberModels: [],
      carousel: [],
      assets: [],
      workers: [],
      auth: [],
      dependencies: [],
      workerDependencies: [],
      static: [],
      full: [],
    },
  };

  if (forceFull) selectFullRegression(selection, "<forced>", forceReason);
  if (changedFiles.length === 0) {
    selectFullRegression(selection, "", "empty or unresolved diff fails closed");
  }

  let documentationCount = 0;
  for (const file of changedFiles) {
    if (isDocumentation(file)) {
      documentationCount += 1;
      continue;
    }

    if (file === "package.json" || file === "package-lock.json") {
      addReason(selection, "dependencies", file, "changes the root dependency or toolchain contract");
      continue;
    }

    const workerPackageMatch = file.match(/^workers\/(auth|contact|ai)\/package(?:-lock)?\.json$/);
    if (workerPackageMatch) {
      addReason(selection, "dependencies", file, "changes a Worker dependency graph");
      addReason(selection, "workerDependencies", file, "requires Worker-local dependency verification");
      addReason(selection, "workers", file, "changes the Worker toolchain used for validation and deploys");
      if (workerPackageMatch[1] === "auth") {
        addReason(selection, "auth", file, "changes the auth Worker toolchain");
      }
      continue;
    }

    if (file === ".nvmrc" || file === ".node-version") {
      addReason(selection, "dependencies", file, "changes the Node toolchain contract");
      continue;
    }

    if (STATIC_BUILD_RELATED_FILES.has(file)) {
      addReason(selection, "static", file, "changes the static build or asset-version pipeline");
      selectFullRegression(selection, file, "changes the generated Pages artifact");
      continue;
    }

    if (file.startsWith(".github/workflows/") || FULL_REGRESSION_PATHS.has(file)) {
      selectFullRegression(selection, file, "changes CI orchestration or its fail-closed selector");
      continue;
    }

    const sharedWorkerIds = SHARED_WORKER_FILE_MAP.get(file);
    if (sharedWorkerIds) {
      addReason(selection, "workers", file, `changes shared Worker code used by ${sharedWorkerIds.join(", ")}`);
      if (sharedWorkerIds.includes("auth")) {
        addReason(selection, "auth", file, "changes a shared auth Worker contract");
      }
    }

    if (isMemberModelFastDeployPath(file)) {
      addReason(selection, "memberModels", file, "changes the member model exposure contract, overlay, or its focused parity coverage");
      addReason(selection, "static", file, "changes a GitHub Pages member model exposure surface");
      continue;
    }

    if (CAROUSEL_FILES.has(file)) {
      addReason(selection, "homepage", file, "changes the public homepage surface or its regression coverage");
      addReason(selection, "carousel", file, "changes the staged carousel, its panels, or its browser matrix");
      if (isStaticSource(file)) {
        addReason(selection, "static", file, "changes a GitHub Pages carousel source");
      }
      continue;
    }
    if (file === "playwright.workers.config.js") {
      addReason(selection, "workers", file, "changes Worker test execution");
      continue;
    }
    if (file === "playwright.config.js") {
      addReason(selection, "homepage", file, "changes frontend browser test execution");
      addReason(selection, "assets", file, "changes Assets Manager browser test execution");
      addReason(selection, "auth", file, "changes auth/admin browser test execution");
      continue;
    }

    if (file === "tests/assets-manager-focused.spec.js") {
      addReason(selection, "assets", file, "changes focused Assets Manager regression coverage");
      continue;
    }
    if (HOMEPAGE_CORE_TEST_FILES.has(file)) {
      addReason(selection, "homepage", file, "changes homepage/frontend core regression coverage");
      continue;
    }
    if (file.startsWith("tests/fixtures/media/")) {
      addReason(selection, "homepage", file, "changes homepage media fixtures");
      addReason(selection, "carousel", file, "changes media fixtures used by the carousel matrix");
      continue;
    }
    if (AUTH_TEST_FILES.has(file)) {
      addReason(selection, "auth", file, "changes auth/admin regression coverage");
      continue;
    }
    if (isWorkerTest(file)) {
      addReason(selection, "workers", file, "changes Worker regression coverage or its harness");
      if (file.includes("auth") || file === "tests/workers.spec.js") {
        addReason(selection, "auth", file, "covers auth/admin Worker behavior");
      }
      continue;
    }

    if (file.startsWith("workers/")) {
      addReason(selection, "workers", file, "changes Worker runtime, configuration, migration, or shared code");
      if (file.startsWith("workers/auth/")) {
        addReason(selection, "auth", file, "changes auth/admin backend behavior");
      }
      continue;
    }

    if (file.startsWith("config/") || file.startsWith("scripts/")) {
      selectFullRegression(selection, file, "changes release, validation, or repository automation");
      continue;
    }

    if (ASSETS_MANAGER_PAGE_FILES.has(file)) {
      addReason(selection, "assets", file, "changes the Assets Manager page");
      addReason(selection, "static", file, "changes a GitHub Pages Assets Manager source");
      if (file === "js/pages/assets-manager/main.js") {
        addReason(selection, "auth", file, "changes authenticated Assets Manager behavior");
      }
      continue;
    }

    if (ASSETS_MANAGER_SHARED_FILES.has(file)) {
      addReason(selection, "assets", file, "changes shared Assets Manager behavior or guidance");
      addReason(selection, "auth", file, "changes member/admin frontend behavior");
      addReason(selection, "static", file, "changes a GitHub Pages shared frontend source");
      if (file === "js/shared/help-menu.js") {
        addReason(selection, "homepage", file, "changes shared Help Menu and locale-facing guidance");
      }
      continue;
    }

    if (isStaticSource(file)) {
      addReason(selection, "static", file, "changes a GitHub Pages source or asset");
      if (AUTH_FRONTEND_FILES.has(file)
        || hasPrefix(file, AUTH_FRONTEND_PREFIXES)
        || AUTH_SHARED_PATTERNS.some((pattern) => pattern.test(file))) {
        addReason(selection, "auth", file, "changes an auth/admin/member frontend surface");
      } else {
        addReason(selection, "homepage", file, "changes a homepage or shared frontend surface");
      }

      if (AUTH_FRONTEND_FILES.has(file) || file.startsWith("js/pages/pricing/")) {
        addReason(selection, "homepage", file, "changes public Pricing behavior or locale parity");
      }

      if (file.startsWith("css/base/")
        || file.startsWith("css/components/")
        || file.startsWith("js/shared/")) {
        addReason(selection, "homepage", file, "changes shared frontend behavior");
        addReason(selection, "auth", file, "changes shared auth/admin frontend behavior");
      }
      continue;
    }

    selectFullRegression(selection, file, "has no narrow test mapping");
  }

  selection.docsOnly = changedFiles.length > 0
    && documentationCount === changedFiles.length
    && !forceFull;

  if (selection.full) {
    selection.homepage = true;
    selection.carousel = true;
    selection.assets = true;
    selection.workers = true;
    selection.auth = true;
    selection.dependencies = true;
    selection.workerDependencies = true;
    selection.docsOnly = false;
  }
  selection.runtime = selection.homepage
    || selection.memberModels
    || selection.carousel
    || selection.assets
    || selection.workers
    || selection.auth;

  for (const key of Object.keys(selection.reasons)) {
    selection.reasons[key] = [...new Set(selection.reasons[key])].sort();
  }
  return selection;
}

export function formatCiTestSelection(selection) {
  const suites = ["homepage", "memberModels", "carousel", "assets", "workers", "auth", "dependencies"]
    .filter((suite) => selection[suite]);
  return [
    `Changed files: ${selection.files.length}`,
    `Selected suites: ${suites.length > 0 ? suites.join(", ") : "none"}`,
    `Docs only: ${selection.docsOnly ? "yes" : "no"}`,
    `Static deploy input: ${selection.static ? "yes" : "no"}`,
    `Full regression: ${selection.full ? "yes" : "no"}`,
  ].join("\n");
}
