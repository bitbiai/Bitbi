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
  "js/pages/index/video-create.js", "js/pages/index/soundlab-create.js", "js/pages/index/studio.js",
  "js/shared/member-generation-client.js", "js/shared/member-generation-status.js",

  "css/pages/pricing.css",
  "de/pricing.html",
  "pricing.html",
]);

// These exact member-workspace files own smoke/locale and authenticated save
// behavior, not the decorative homepage media or its native decoder matrix.
// Registry, shared runtime and unknown neighboring files retain ordinary impact.
const GENERATE_LAB_UI_FILES = new Set([
  "generate-lab/index.html", "de/generate-lab/index.html",
  "css/pages/generate-lab.css", "js/pages/generate-lab/main.js",
]);

const CANVAS_UI_FILES = new Set([
  "canvas/index.html", "de/canvas/index.html",
  "css/pages/canvas.css", "js/pages/canvas/main.js", "js/pages/canvas/api.js",
  "js/pages/canvas/full-video.js", "js/pages/canvas/workflow.js", "js/pages/canvas/video-frame.js", "js/pages/canvas/video-input.js",
]);

// Closed Canvas generation/provider/storage integration scope. Unknown runtime/billing inputs
// continue through ordinary impact selection; chat and native D1 are exercised.
const CANVAS_TEXT_FILES = new Set([
  'scripts/check-route-policies.mjs','scripts/test-homepage-ffmpeg-processor.mjs',
  'services/homepage-ffmpeg-processor/Dockerfile','workers/auth/src/lib/asset-storage-quota.js',

  'workers/auth/src/lib/private-video-references.js', 'workers/auth/src/routes/private-video-references.js',
  'workers/auth/migrations/0093_add_private_video_references.sql',
  'services/homepage-ffmpeg-processor/video-reference.mjs','services/homepage-ffmpeg-processor/video-reference.test.mjs',
  'tests/fixtures/media/h3-overrun.mp4','tests/fixtures/media/h3-prepared.mp4',

  'tests/helpers/h3-model-controls.cjs',
  'tests/fixtures/media/h3-reference.mp4', 'tests/fixtures/media/h3-frame.png',
  'tests/helpers/q2-runtime/linux-hosted.mjs',
  // H3 reuses Canvas/member durable jobs, central pricing and owned media inputs.
  'js/shared/minimax-h3.mjs', 'js/shared/h3-reference-controls.js',
  'js/shared/member-generation-client.js', 'js/shared/locale.js',
  'workers/auth/src/lib/ai-usage-policy.js',
  'workers/auth/src/lib/h3-reference-metadata.js',
  'workers/auth/src/lib/minimax-h3-callback.js',
  'workers/ai/src/routes/video-task.js',
  'workers/auth/src/lib/grok-video-output.js',
  'workers/auth/wrangler.jsonc',
  'tests/helpers/q2-runtime/control.mjs',
  'workers/auth/src/index.js',
  'workers/ai/src/lib/invoke-ai-video.js',
  'workers/auth/src/lib/ai-video-jobs.js',
  'workers/auth/migrations/0092_pin_video_source_inputs.sql',
  'js/pages/generate-lab/grok-video-controls.js',
  'js/pages/generate-lab/model-help.js',
  'js/shared/grok-imagine-video-15-preview-pricing.mjs',
  'js/shared/grok-imagine-video-pricing.mjs',
  'js/shared/member-model-exposure.mjs',
  'js/shared/canvas-video-input.mjs',
  'js/pages/canvas/video-input.js',

  // Generate Lab role accounting and existing thumbnail/preview consumers; native
  // Canvas/member tests cover the shared D1/R2 leases and deletion boundaries.
  'admin/index.html',
  'js/pages/admin/private-media-service.js',
  'js/shared/auth-api.js',
  'workers/auth/src/routes/ai/quota.js',
  'workers/auth/src/routes/ai/music-generate.js',
  'workers/auth/src/routes/ai/video-generate.js',
  'workers/auth/src/routes/private-media-service.js',
  'workers/auth/src/routes/homepage-hero-videos.js',
  'workers/auth/src/routes/canvas-video-processing.js',
  'workers/auth/src/lib/media-preview-jobs.js',
  'workers/auth/src/lib/memvid-stream-preview-dispatch.js',
  'workers/auth/src/lib/memvid-stream-preview-jobs.js',
  'workers/auth/src/lib/memvid-stream-upload-receipts.js',
  'workers/auth/src/lib/member-generation-posters.js',
  'workers/auth/src/lib/private-media-service.js',
  'workers/auth/src/lib/private-media-smoke.js',
  'workers/auth/src/lib/canvas-video-processing.js',
  'workers/auth/migrations/0091_separate_thumbnail_processing.sql',
  'workers/media/src/index.js',
  'workers/media/wrangler.jsonc',
  'services/homepage-ffmpeg-processor/processor.mjs',
  'services/homepage-ffmpeg-processor/private-media-runner.mjs',
  'services/homepage-ffmpeg-processor/private-media-runner.test.mjs',
  'tests/helpers/private-media-control.mjs',
  'tests/helpers/member-generation-control.mjs',
  'tests/member-generation-runtime.mjs',
  'js/pages/canvas/api.js',
  'js/pages/canvas/full-video.js',
  'js/pages/canvas/workflow.js',
  'js/pages/admin/ai-lab.js',
  'js/pages/generate-lab/main.js',
  'js/pages/generate-lab/model-registry.js',
  'js/shared/ai-image-models.mjs',
  'js/shared/ai-model-pricing.mjs',
  'js/shared/grok-imagine-image-2-pricing.mjs',
  'workers/ai/src/lib/invoke-ai.js',
  'workers/auth/src/lib/admin-ai-image-credit-pricing.js',
  'workers/auth/src/lib/admin-ai-video-sources.js',
  'workers/auth/src/lib/ai-text-assets.js',
  'workers/auth/src/lib/canvas-media-storage.js',
  'workers/auth/src/lib/canvas-video-input.js',
  'workers/auth/src/lib/canvas-video-output.js',
  'workers/auth/src/lib/ai-cost-operations.js', 'scripts/test-ai-cost-policy.mjs',
  'workers/auth/src/lib/member-generation-jobs.js',
  'workers/auth/src/lib/member-generation-storage.js',
  'workers/auth/src/lib/r2-cleanup.js',
  'workers/auth/src/routes/ai/assets-read.js',
  'workers/auth/src/routes/ai/folders-read.js',
  'workers/auth/src/routes/ai/images-write.js',
  'workers/auth/src/routes/ai/lifecycle.js',
  'workers/auth/migrations/0090_add_canvas_private_outputs.sql',
  'workers/auth/src/app/route-policy.js',
  'config/release-compat.json',
  'workers/auth/src/routes/admin.js',
  'tests/helpers/auth-worker-harness.js',
  'tests/helpers/canvas-processing-control.mjs', 'tests/helpers/canvas-video-control.mjs',
  'tests/q2-lifecycle.spec.js',
  'tests/auth-admin.spec.js',
  'tests/helpers/private-media-ui.js', 'tests/helpers/grok-image-controls.cjs',
  'tests/smoke.spec.js',
  'playwright.config.js',
  'js/pages/canvas/main.js', 'js/shared/canvas-model-contract.mjs', 'js/shared/help-menu.js',
  'js/shared/grok-text-contract.mjs', 'js/shared/admin-ai-contract.mjs',
  'workers/shared/grok-chat-contract.mjs', 'workers/shared/chat-model-contract.mjs',
  'workers/ai/src/lib/grok-chat.js', 'workers/ai/src/routes/text.js',
  'workers/auth/src/routes/canvas.js', 'workers/auth/src/routes/ai/text-generate.js',
  'workers/auth/src/routes/admin-ai.js', 'tests/workers.spec.js',
  'tests/grok-chat-workers.spec.js', 'tests/canvas.spec.js', 'tests/oma2-q1-canvas.spec.js',
  'tests/helpers/q2-runtime/canvas.mjs', 'tests/helpers/q2-runtime/environment.mjs', 'scripts/test-q2-runtime-launcher.mjs',

  'tests/q4-runtime-stream.mjs',
  'tests/helpers/q2-runtime/linux-hosted.mjs',
  'tests/helpers/q2-runtime/linux-runtime-child.mjs',
  'tests/helpers/q2-runtime/linux-bootstrap.py',
  'tests/helpers/q2-runtime/runner.mjs',
]);

const AUTH_SHARED_PATTERNS = [
  /(?:^|\/)auth(?:-|\/|\.)/,
  /(?:^|\/)session(?:-|\/|\.)/,
  /(?:^|\/)wallet(?:-|\/|\.)/,
];

const HOMEPAGE_CORE_TEST_FILES = new Set([
  "tests/audio-player.spec.js",
  "tests/canvas.spec.js",
  "tests/oma2-q1-canvas.spec.js",
  "tests/locale.spec.js",
  "tests/smoke.spec.js",
]);

// These homepage-only consumers do not own shared Auth/Admin behavior.
// Functional coverage runs in Linux Chromium/WebKit; native output is separate.
const HOMEPAGE_FUNCTIONAL_FILES = new Set([
  'css/components/news-pulse.css', 'js/shared/news-pulse.js',
  'tests/homepage-carousel-focused.spec.js', 'tests/homepage-creation-stream-anchor.spec.js',
  'tests/homepage-hero-state.spec.js', 'tests/homepage-media-loading.spec.js',
]);
const HOMEPAGE_MEDIA_FILES = new Set([
  'tests/homepage-hero-playback.spec.js', 'tests/homepage-native-control.spec.js',
  'tests/helpers/homepage-hero-native-probe.js', 'playwright.homepage.config.js',
  'playwright.homepage-webkit.config.js',
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
  "playwright.homepage-performance.config.js",
  "playwright.homepage-linux-diagnostic.config.js",
  "scripts/diagnose-homepage-linux-media.mjs",
  "tests/homepage-performance-contract.spec.js",
]);

const ASSETS_MANAGER_PAGE_FILES = new Set([
  "account/assets-manager.html",
  "css/account/assets-manager.css",
  "de/account/assets-manager.html",
  "js/pages/assets-manager/main.js",
]);

const ASSETS_MANAGER_SHARED_FILES = new Set([
  "js/shared/auth-api.js", "js/shared/locale.js",
  "js/shared/member-generation-client.js", "js/shared/member-generation-status.js",

  "js/shared/help-menu.js",
  "js/shared/saved-assets-browser.js",
  "js/shared/storage-format.js",
]);

const AUTH_TEST_FILES = new Set([
  "tests/oma2-q1-member.spec.js",
  "tests/oma2-q3-newsfeed.spec.js",
  "tests/oma2-q3-model-status.spec.js",
  "tests/auth-admin.spec.js",
  "tests/wallet-nav.spec.js",
  "tests/oma2-q3-shell.spec.js",
  "tests/oma2-q3-workflows.spec.js",
  "tests/oma2-q3-context.spec.js",
  "tests/oma2-q3-media.spec.js",
  "tests/oma2-q3-ai.spec.js",
  "tests/oma2-q3-ai-compare-view.spec.js",
  "tests/oma2-q3-registration.spec.js",
  "tests/oma2-q3-auth-lifecycle.spec.js",
]);

const WORKER_TEST_PREFIXES = [
  "tests/helpers/q2-runtime/",
  "tests/member-generation.cases.js",
  "tests/member-generation-runtime.mjs",
  "tests/fixtures/media/member-video-poster.webp",
  "tests/fixtures/media/member-image.png",
  "tests/helpers/member-generation-control.mjs",
  "tests/helpers/canvas-video-control.mjs", "tests/helpers/canvas-processing-control.mjs",
  "tests/q4-",
  "tests/helpers/q4-",
  "tests/fable-chat-",
  "tests/helpers/auth-worker-harness.js",
  "tests/helpers/sqlite-d1.js",
  "tests/workers.spec.js",
  "tests/admin-ai-save-operations.spec.js",
  "tests/admin-model-status.spec.js", "tests/admin-model-status-runtime.mjs",
];

// These exact release-only inputs are exercised by the always-required release
// contract tests and native static-host runtime check. Unknown automation is broad.
const RELEASE_TOOLING_FILES = new Set([
  '.github/workflows/static.yml', '.github/workflows/ui-fast-deploy.yml',
  'scripts/lib/ci-test-selection.mjs', 'scripts/select-ci-tests.mjs',
  'scripts/test-ci-test-selection.mjs', 'scripts/test-release-compat.mjs', 'scripts/pages-candidate.mjs',
  'scripts/lib/release-plan.mjs', 'scripts/test-release-plan.mjs',
  'scripts/check-static-deploy-safety.mjs', 'scripts/release-apply.mjs', 'scripts/frontend-release.mjs',
  'scripts/lib/backend-continuation.mjs', 'scripts/lib/backend-publication.mjs', 'scripts/lib/media-publication.mjs',
  'scripts/test-pages-candidate.mjs', 'scripts/test-pages-workflow.mjs', 'scripts/test-static-deploy-safety.mjs',
  'scripts/lib/frontend-hosting.mjs', 'scripts/lib/frontend-source.mjs', 'scripts/test-frontend-hosting.mjs',
  'scripts/test-frontend-review.mjs', 'scripts/lib/fast-deploy-paths.mjs',
  'scripts/lib/homepage-test-selection.mjs', 'scripts/check-homepage-selection.mjs', 'scripts/test-homepage-selection.mjs',
]);

// Reviewed Admin-reader production surface and its release-only follow-up.
// This is a closed path set, not a generic scripts/workflow exemption. Any
// additional runtime, dependency, security or unknown input uses normal impact.
const ADMIN_READER_PRODUCTION = new Set([
  'admin/index.html', 'css/admin/newsfeed.css', 'js/pages/admin/main.js',
  'js/pages/admin/newsfeed.js', 'js/pages/admin/router.js',
]);
const ADMIN_READER_VALIDATION = new Set([
  '.github/workflows/static.yml', 'playwright.config.js', 'playwright.carousel.config.js',
  'playwright.admin-release.config.js', 'scripts/lib/ci-test-selection.mjs',
  'scripts/select-ci-tests.mjs', 'scripts/pages-candidate.mjs',
  'scripts/test-ci-test-selection.mjs', 'scripts/test-pages-candidate.mjs',
  'scripts/test-pages-workflow.mjs', 'scripts/lib/release-plan.mjs',
  'scripts/test-release-plan.mjs', 'tests/oma2-q3-newsfeed.spec.js',
  'tests/fixtures/media/test-video-loading.mp4', 'tests/helpers/homepage-media-server.mjs',
  'tests/homepage-hero-playback.spec.js',
]);

// Member storage/card domain: real route security + durable queue tests and the
// shared card/picker browser path. Unknown inputs still use ordinary impact.
const MEMBER_ASSET_PRODUCTION = new Set([
  'account/assets-manager.html', 'de/account/assets-manager.html',
  'css/account/assets-manager.css', 'js/shared/saved-assets-browser.js',
  'workers/auth/src/lib/asset-names.js', 'workers/auth/src/lib/ai-text-assets.js',
  'workers/auth/src/lib/member-generation-jobs.js',
  'workers/auth/src/routes/ai/files-read.js', 'workers/auth/src/routes/ai/images-write.js',
  'workers/auth/src/routes/ai/video-generate.js', 'workers/auth/src/routes/ai/music-generate.js',
]);
const MEMBER_ASSET_VALIDATION = new Set([
  'js/shared/mobile-media-grid-overlay.js', // existing detail export consumed by shared audio cards

  'playwright.assets.config.js', 'tests/assets-manager-focused.spec.js',
  'tests/auth-admin.spec.js', 'tests/locale.spec.js', // existing targeted Assets neighbors in this domain
  'tests/member-generation.cases.js', 'tests/member-generation-runtime.mjs',
  'tests/helpers/member-generation-control.mjs', 'tests/helpers/auth-worker-harness.js', 'scripts/lib/release-plan.mjs',
  'scripts/test-q2-runtime.mjs', 'scripts/test-q2-runtime-launcher.mjs',
  'tests/helpers/q2-runtime/runner.mjs', 'tests/helpers/q2-runtime/linux-hosted.mjs',
  'tests/helpers/q2-runtime/linux-bootstrap.py', 'tests/helpers/q2-runtime/linux-runtime-child.mjs',
]);

// The shared public detail window has its own bounded browser/HTTP contract.
// This does not classify homepage controllers or arbitrary shared files as narrow.
const PUBLIC_MEDIA_DETAIL_FILES = new Set([
  'js/pages/index/public-media-detail-panel.js', 'js/pages/index/video-gallery.js',
  'css/pages/index.css', 'js/shared/locale.js',
  'tests/public-media-dialog.spec.js', 'playwright.public-media.config.js',
  'tests/fixtures/media/detail-original.mp4', 'tests/workers.spec.js', 'tests/smoke.spec.js',
  'scripts/lib/release-plan.mjs', 'config/release-compat.json',
]);

// Informational workspace/help changes have a bounded, build-bound browser check.
// Model contracts, pricing, shared runtime and unknown files remain outside it.
const WORKSPACE_HELP_FILES = new Set([
  'generate-lab/index.html', 'de/generate-lab/index.html', 'css/pages/generate-lab.css',
  'js/pages/generate-lab/main.js', 'js/pages/generate-lab/model-help.js',
  'js/shared/help-menu.js', 'js/shared/locale.js', 'tests/smoke.spec.js', 'tests/locale.spec.js',
  'playwright.workspace.config.js', 'scripts/lib/release-plan.mjs',
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
  if (['scripts/test-q2-runtime.mjs', 'scripts/test-q2-runtime-launcher.mjs'].includes(file)) return true;
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

// Read-only Admin observations: real guarded route/native SQL plus both UI engines.
// Unknown/shared generation, billing, identity or registry inputs cannot use this scope.
const ADMIN_STATUS_FILES = new Set([
  'admin/index.html','css/admin/model-status.css','js/pages/admin/model-status.js',
  'js/pages/admin/main.js','js/pages/admin/router.js','js/shared/auth-api.js',
  'workers/auth/src/lib/admin-model-status.js','workers/auth/src/routes/admin-ai.js',
  'workers/auth/src/app/route-policy.js','tests/admin-model-status.spec.js',
  'tests/oma2-q3-model-status.spec.js','tests/admin-model-status-runtime.mjs',
  'playwright.model-status.config.js','playwright.config.js','playwright.workers.config.js',
  'scripts/lib/release-plan.mjs', 'config/release-compat.json',
  'tests/helpers/q2-runtime/runner.mjs','tests/helpers/q2-runtime/linux-hosted.mjs',
  'tests/helpers/q2-runtime/linux-bootstrap.py','scripts/test-q2-runtime-launcher.mjs',
  'tests/helpers/q2-runtime/linux-runtime-child.mjs','tests/helpers/q2-runtime/test_linux_bootstrap.py',
]);

export function selectCiTests(files, { forceFull = false, forceReason = "explicit full regression" } = {}) {
  const changedFiles = normalizeFiles(files);
  const selection = {
    files: changedFiles,
    policy: "impact-v1",
    adminRelease: false,
    docsOnly: false,
    homepage: false,
    homepageMedia: false,
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
      homepageMedia: [],
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

  if (!forceFull && changedFiles.some(file => ADMIN_READER_PRODUCTION.has(file))
      && changedFiles.every(file => isDocumentation(file) || ADMIN_READER_PRODUCTION.has(file) || ADMIN_READER_VALIDATION.has(file))) {
    selection.policy = 'admin-reader-v1';
    selection.adminRelease = true;
    selection.auth = true;
    selection.static = true;
    selection.runtime = true;
    selection.reasons.auth.push('Reviewed Admin-reader scope: both engines, News/navigation/session/MFA and short homepage smoke; release orchestration checks remain mandatory');
    selection.reasons.static.push('Complete unpublished Admin production inputs; same tested artifact must be published');
    return selection;
  }

  if (!forceFull && changedFiles.some(file => MEMBER_ASSET_PRODUCTION.has(file))
      && changedFiles.every(file => isDocumentation(file) || MEMBER_ASSET_PRODUCTION.has(file)
        || MEMBER_ASSET_VALIDATION.has(file) || RELEASE_TOOLING_FILES.has(file))) {
    selection.policy = 'member-assets-v1';
    selection.memberAssets = true;
    selection.assets = selection.static = selection.runtime = true;
    selection.workers = changedFiles.some(file => file.startsWith('workers/') || file.includes('member-generation') || file.includes('q2-runtime') || file === 'tests/helpers/auth-worker-harness.js');
    selection.reasons.assets.push('Shared cards, owner actions/picker and durable client in Chromium/WebKit; same candidate build');
    if (selection.workers) selection.reasons.workers.push('Affected image/video/music/storage routes including access/credit failures, durable jobs and native member-generation suite; no unrelated Auth/Admin or Q4 suite');
    return selection;
  }

  if (!forceFull && changedFiles.includes('js/pages/index/public-media-detail-panel.js')
      && changedFiles.every(file => isDocumentation(file) || PUBLIC_MEDIA_DETAIL_FILES.has(file) || RELEASE_TOOLING_FILES.has(file))) {
    selection.policy = 'public-media-detail-v1';
    selection.publicMedia = true;
    selection.auth = selection.static = selection.runtime = true;
    selection.reasons.auth.push('Public detail window: Chromium/WebKit original download, metadata, controls/comments and targeted file authorization; no generation or decorative hero changes');
    return selection;
  }

  if (!forceFull && changedFiles.includes('js/pages/generate-lab/model-help.js')
      && changedFiles.every(file => isDocumentation(file) || WORKSPACE_HELP_FILES.has(file) || RELEASE_TOOLING_FILES.has(file))) {
    selection.policy = 'workspace-help-v1';
    selection.workspaceHelp = true;
    selection.auth = selection.static = selection.runtime = true;
    selection.reasons.auth.push('Workspace model/form/credit guidance, session recovery, Help keyboard/touch and EN/DE registry parity in Chromium/WebKit; no provider or pricing changes');
    return selection;
  }

  if (!forceFull && changedFiles.some(file=>['workers/auth/src/lib/admin-model-status.js','js/pages/admin/model-status.js','css/admin/model-status.css','tests/oma2-q3-model-status.spec.js','tests/admin-model-status.spec.js'].includes(file))
      && changedFiles.every(file => isDocumentation(file) || ADMIN_STATUS_FILES.has(file) || RELEASE_TOOLING_FILES.has(file))) {
    selection.policy = 'admin-model-status-v1';
    selection.modelStatus = true;
    selection.auth = selection.static = selection.runtime = true;
    selection.workers = changedFiles.some(file=>file.startsWith('workers/') || file.includes('q2-runtime') || file==='tests/admin-model-status.spec.js' || file==='tests/admin-model-status-runtime.mjs' || file==='playwright.workers.config.js');
    selection.reasons.auth.push('Read-only Admin model status: Chromium/WebKit, EN/DE, navigation/session denial, stale data, cleanup and build identity');
    if(selection.workers) selection.reasons.workers.push('Model status catalog/evidence/query tests and native guarded Admin/MFA/D1 route; no inference, generation or accounting changes');
    return selection;
  }

  // Exact actor/SDK lifecycle inputs. Processor, Auth, bindings, dependencies
  // and unknown Worker paths keep their existing broader integration coverage.
  const mediaLifecycleFiles = new Set(['workers/media/src/index.js','scripts/test-private-media-lifecycle.mjs']);
  if (!forceFull && changedFiles.some(file=>mediaLifecycleFiles.has(file))
      && changedFiles.every(file=>isDocumentation(file)||mediaLifecycleFiles.has(file)||RELEASE_TOOLING_FILES.has(file))) {
    selection.mediaLifecycle = true;
    selection.workers = selection.static = selection.runtime = true;
    selection.reasons.workers.push('Pinned container SDK lifecycle, busy/queued work protection and tested Linux processor image; no changed Auth or browser inputs');
    selection.reasons.static.push('Release/build contracts and native frontend routing; exact candidate identity remains required');
    return selection;
  }

  if (!forceFull && (changedFiles.some(f=>['js/shared/grok-text-contract.mjs','workers/ai/src/routes/text.js','js/shared/canvas-video-input.mjs','workers/auth/src/lib/private-video-references.js'].includes(f))
      || ['js/shared/canvas-model-contract.mjs','workers/auth/src/routes/canvas.js','js/pages/canvas/main.js'].every(f=>changedFiles.includes(f))
      || ['js/pages/generate-lab/main.js','workers/auth/src/routes/ai/quota.js','workers/auth/src/lib/member-generation-jobs.js'].every(f=>changedFiles.includes(f)))
      && changedFiles.every(f=>isDocumentation(f)||CANVAS_TEXT_FILES.has(f)||RELEASE_TOOLING_FILES.has(f))) {
    selection.canvasText = true;
    selection.workers = selection.auth = selection.static = selection.runtime = true;
    selection.reasons.workers.push('Canvas/Generate Lab provider and role accounting, Grok/chat compatibility, billing and replay; native D1/R2 storage, thumbnail/backend leases and Stream receipts, plus the tested Linux FFmpeg image');
    selection.reasons.auth.push('Both Canvas suites and tagged Admin/Generate Lab model controls on tested build in Chromium/WebKit; persisted inputs, estimates, output and explicit saving');
    selection.reasons.static.push('Exact candidate, release contracts, native frontend routing and security checks');
    return selection;
  }

  let documentationCount = 0;
  for (const file of changedFiles) {
    if (['frontend/index.mjs','frontend/wrangler.jsonc'].includes(file) || RELEASE_TOOLING_FILES.has(file)) {
      addReason(selection,'static',file,'covered by release contracts, build and native frontend HTTP/routing/privacy checks');
      continue;
    }
    if (file === 'config/static-hosting.json') {
      addReason(selection,'static',file,'changes frontend hosting runtime or authority');
      selectFullRegression(selection,file,'changes frontend hosting and requires native routing plus full candidate acceptance');
      continue;
    }
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

    if(file==='scripts/check-worker-dependency-audits.mjs'||/^workers\/media\/package(?:-lock)?\.json$/.test(file)) {
      addReason(selection,'workerDependencies',file,'changes isolated Worker package audit/installation');
      addReason(selection,'workers',file,'requires Worker integration and installed dependency validation');
      continue;
    }
    if (['scripts/private-media-image.mjs','services/homepage-ffmpeg-processor/Dockerfile','services/homepage-ffmpeg-processor/container-server.mjs','services/homepage-ffmpeg-processor/private-media-runner.mjs','services/homepage-ffmpeg-processor/private-media-runner.test.mjs','tests/helpers/private-media-control.mjs','scripts/check-route-policies.mjs','services/homepage-ffmpeg-processor/canvas-full-video.mjs','services/homepage-ffmpeg-processor/canvas-full-video.test.mjs','.github/workflows/memvid-stream-preview-processor.yml','services/homepage-ffmpeg-processor/processor.mjs','scripts/test-homepage-ffmpeg-processor.mjs','config/release-compat.json'].includes(file)) {
      addReason(selection,'workers',file,'changes Auth/processor runtime or its required deployment contract');
      addReason(selection,'auth',file,'requires affected media/auth integration; release and processor checks are mandatory');
      continue;
    }
    if (file.startsWith(".github/workflows/")) {
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
      addReason(selection, "homepage", file, "executes model parity through the existing homepage core command");
      addReason(selection, "memberModels", file, "changes the member model exposure contract, overlay, or its focused parity coverage");
      addReason(selection, "static", file, "changes a GitHub Pages member model exposure surface");
      continue;
    }

    if (HOMEPAGE_FUNCTIONAL_FILES.has(file) || HOMEPAGE_MEDIA_FILES.has(file)) {
      addReason(selection, 'homepage', file, 'homepage functional and core coverage; no unrelated Auth/Admin ownership');
      if (HOMEPAGE_MEDIA_FILES.has(file)) addReason(selection, 'homepageMedia', file, 'native media contract or its execution configuration');
      if (isStaticSource(file)) addReason(selection, 'static', file, 'homepage source');
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
    if (file === "playwright.q3-integration.config.js") {
      addReason(selection, "workers", file, "changes the native Admin save import check");
      addReason(selection, "auth", file, "changes the Admin MFA and save integration matrix");
      continue;
    }
    if (file === "playwright.config.js") {
      addReason(selection, "homepage", file, "changes frontend browser test execution");
      addReason(selection, "assets", file, "changes Assets Manager browser test execution");
      addReason(selection, "auth", file, "changes auth/admin browser test execution");
      continue;
    }

    if (file === "tests/assets-manager-focused.spec.js" || file === "playwright.assets.config.js") {
      addReason(selection, "assets", file, "changes focused Assets Manager regression coverage");
      continue;
    }
    if (HOMEPAGE_CORE_TEST_FILES.has(file)) {
      addReason(selection, "homepage", file, "changes homepage/frontend core regression coverage");
      continue;
    }
    if (isWorkerTest(file)) {
      addReason(selection,'workers',file,'changes Worker regression coverage or its isolated harness');
      if(file.includes('auth') || file==='tests/workers.spec.js') addReason(selection,'auth',file,'covers authenticated Worker behavior');
      continue;
    }
    if (file === "tests/fixtures/media/canvas-end-frame.mp4") {
      addReason(selection, "homepage", file, "executes Canvas native frame export in the existing core browser caller");
      addReason(selection, "workers", file, "executes Canvas owned-video and native runtime integration");
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

    if (["js/shared/canvas-model-contract.mjs", "js/shared/canvas-video-input.mjs"].includes(file)) {
      addReason(selection, "homepage", file, "executes Canvas model/inspector coverage through homepage core");
      addReason(selection, "auth", file, "changes authenticated model and credit contracts");
      addReason(selection, "workers", file, "is imported by Auth Canvas and member text generation");
      addReason(selection, "static", file, "changes the Canvas frontend model contract");
      continue;
    }

    if (CANVAS_UI_FILES.has(file)) {
      if (file === "js/pages/canvas/api.js") addReason(selection, "auth", file, "changes the authenticated Canvas API client; Canvas core exercises its effects");
      addReason(selection, "homepage", file, "executes Canvas workspace and save coordination coverage in the existing homepage core command");
      addReason(selection, "static", file, "changes a Canvas frontend source");
      continue;
    }

    if (GENERATE_LAB_UI_FILES.has(file)) {
      addReason(selection, "homepage", file, "executes Generate Lab model, reference, layout and locale coverage in the existing homepage core command");
      addReason(selection, "auth", file, "executes Generate Lab pricing, save identity and Assets handoff coverage in the existing auth command");
      addReason(selection, "static", file, "changes a Generate Lab frontend source");
      continue;
    }

    if (isStaticSource(file)) {
      if (!hasPrefix(file, AUTH_FRONTEND_PREFIXES) && !AUTH_FRONTEND_FILES.has(file))
        addReason(selection, 'homepageMedia', file, 'homepage/shared runtime may affect native media');
      addReason(selection, "static", file, "changes a GitHub Pages source or asset");
      if (AUTH_FRONTEND_FILES.has(file)
        || hasPrefix(file, AUTH_FRONTEND_PREFIXES)
        || AUTH_SHARED_PATTERNS.some((pattern) => pattern.test(file))) {
        addReason(selection, "auth", file, "changes an auth/admin/member frontend surface");
      } else {
        addReason(selection, "homepage", file, "changes a homepage or shared frontend surface");
      }

      if (["css/pages/pricing.css", "de/pricing.html", "pricing.html"].includes(file) || file.startsWith("js/pages/pricing/")) {
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
  if (selection.carousel) addReason(selection, 'homepageMedia', '<carousel>', 'connected media/layout acceptance');
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
  const suites = ["homepage", "homepageMedia", "memberModels", "carousel", "assets", "workers", "auth", "dependencies"]
    .filter((suite) => selection[suite]);
  return [
    `Changed files: ${selection.files.length}`,
    `Selected suites: ${suites.length > 0 ? suites.join(", ") : "none"}`,
    `Docs only: ${selection.docsOnly ? "yes" : "no"}`,
    `Static deploy input: ${selection.static ? "yes" : "no"}`,
    `Full regression: ${selection.full ? "yes" : "no"}`,
    `Acceptance policy: ${selection.policy}`,
  ].join("\n");
}

// Existing Worker job also tests the exact deployable Linux image when any of
// its inputs change. Unrelated worker-only releases do not build a container.
export function requiresPrivateMediaImage(files) {
  return files.some(f=>f.startsWith('workers/media/')||f.startsWith('services/homepage-ffmpeg-processor/')||f==='scripts/private-media-image.mjs');
}
