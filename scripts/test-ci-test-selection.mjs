import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FAST_DEPLOY_WORKFLOW_PATHS,
  isFastDeploySafePath,
} from "./lib/fast-deploy-paths.mjs";
import { selectCiTests } from "./lib/ci-test-selection.mjs";
import { requiredJobs } from "./pages-candidate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

for (const file of ["tests/q4-stream-receipts.spec.js", "tests/q4-runtime-memory.mjs", "tests/helpers/q4-video-control.mjs"]) {
  const selected = selectCiTests([file]);
  assert.equal(selected.workers, true, `${file} must reach the real Worker/native command`);
  assert.equal(selected.full, false);
}

for (const file of ['playwright.homepage-linux-diagnostic.config.js', 'scripts/diagnose-homepage-linux-media.mjs']) {
  assert.equal(selectCiTests([file]).carousel, true, `${file} must retain Linux and macOS media coverage`);
}

function selection(files, options) {
  return selectCiTests(files, options);
}

for (const file of ['scripts/test-q2-runtime.mjs', 'scripts/test-q2-runtime-launcher.mjs']) {
  const result = selection([file]);
  assert.equal(result.workers, true, file);
  assert.equal(result.full, false, file);
  assert.equal(result.homepage, false, file);
  assert.equal(result.static, false, file);
}
assert.equal(selection(['scripts/test-q2-runtime-launcher-unknown.mjs']).full, true);

{
  for (const area of ["shell", "workflows", "context", "media", "ai", "ai-compare-view", "registration", "auth-lifecycle"]) {
    const result = selection([`tests/oma2-q3-${area}.spec.js`]);
    assert.equal(result.auth, true);
    assert.equal(result.full, false);
  }
  const scripts = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts;
  assert.match(scripts["test:auth"], /tests\/oma2-q3-/);
  assert.match(scripts["test:q3-integration"], /playwright\.workers\.config\.js/);
  assert.match(scripts["test:q3-integration"], /tests\/workers\.spec\.js tests\/admin-ai-save-operations\.spec\.js/);
  assert.match(scripts["test:q3-integration"], /playwright\.q3-integration\.config\.js/);
  assert.equal(selection(["tests/admin-ai-save-operations.spec.js"]).workers, true);
  const integration = selection(["playwright.q3-integration.config.js"]);
  assert.equal(integration.workers, true);
  assert.equal(integration.auth, true);
  assert.equal(integration.full, false);
  assert.equal(selection([".githooks/pre-push"]).full, true);
}

{
  const result = selection(["js/pages/index/category-carousel.js"]);
  assert.equal(result.homepage, true);
  assert.equal(result.carousel, true);
  assert.equal(result.assets, false);
  assert.equal(result.static, true);
  assert.equal(result.workers, false);
  assert.equal(result.auth, false);
  assert.equal(result.dependencies, false);
  assert.equal(result.full, false);
}

{
  const result = selection(["css/pages/index.css"]);
  assert.equal(result.homepage, true);
  assert.equal(result.carousel, true);
  assert.equal(result.assets, false);
  assert.equal(result.static, true);
  assert.equal(result.full, false);
}

{
  const result = selection(["js/shared/member-model-exposure.mjs"]);
  assert.equal(result.memberModels, true);
  assert.equal(result.static, true);
  assert.equal(result.homepage, true);
  assert.equal(result.workers, false);
  assert.equal(result.auth, false);
  assert.equal(result.full, false);
}

{
  const result = selection(["js/shared/models-overlay.js"]);
  assert.equal(result.memberModels, true);
  assert.equal(result.static, true);
  assert.equal(result.homepage, true);
  assert.equal(result.full, false);
}

{
  const result = selection([
    "js/shared/member-model-exposure.mjs",
    "workers/auth/src/index.js",
  ]);
  assert.equal(result.memberModels, true);
  assert.equal(result.workers, true);
  assert.equal(result.auth, true);
  assert.equal(result.full, false);
}

{
  const result = selection([
    "js/shared/models-overlay.js",
    "config/release-compat.json",
  ]);
  assert.equal(result.memberModels, true);
  assert.equal(result.workers, true);
  assert.equal(result.auth, true);
  assert.equal(result.full, false);
}

{
  assert.equal(isFastDeploySafePath("js/shared/member-model-exposure.mjs"), true);
  assert.equal(isFastDeploySafePath("js/shared/models-overlay.js"), true);
  assert.equal(isFastDeploySafePath("workers/auth/src/index.js"), false);
  assert.equal(isFastDeploySafePath("js/shared/ai-image-models.mjs"), false);
  assert.equal(isFastDeploySafePath("js/shared/ai-model-pricing.mjs"), false);
  assert.equal(isFastDeploySafePath("js/shared/unrelated-ui-helper.js"), false);
  assert.equal(isFastDeploySafePath(".github/workflows/ui-fast-deploy.yml"), false);
  assert.equal(isFastDeploySafePath("package.json"), false);
  assert.equal(
    ["js/shared/member-model-exposure.mjs", "workers/auth/src/index.js"].every(isFastDeploySafePath),
    false,
  );
  assert.equal(
    ["js/shared/models-overlay.js", "config/release-compat.json"].every(isFastDeploySafePath),
    false,
  );
  assert.equal(
    ["js/shared/models-overlay.js", "js/shared/ai-model-pricing.mjs"].every(isFastDeploySafePath),
    false,
  );
}

{
  const result = selection(["workers/contact/src/index.js"]);
  assert.equal(result.workers, true);
  assert.equal(result.auth, false);
  assert.equal(result.homepage, false);
  assert.equal(result.carousel, false);
  assert.equal(result.assets, false);
  assert.equal(result.static, false);
}

{
  const result = selection(["workers/auth/src/routes/admin.js"]);
  assert.equal(result.workers, true);
  assert.equal(result.auth, true);
  assert.equal(result.homepage, false);
  assert.equal(result.carousel, false);
}

{
  const result = selection(["js/shared/request-body.mjs"]);
  assert.equal(result.workers, true);
  assert.equal(result.auth, true);
  assert.equal(result.homepage, true);
  assert.equal(result.carousel, false);
  assert.equal(result.static, true);
}

{
  const result = selection(["admin/index.html", "js/pages/admin/main.js"]);
  assert.equal(result.auth, true);
  assert.equal(result.assets, false);
  assert.equal(result.carousel, false);
  assert.equal(result.static, true);
  assert.equal(result.workers, false);
}

{
  const result = selection(["pricing.html", "de/pricing.html", "js/pages/pricing/main.js"]);
  assert.equal(result.auth, true);
  assert.equal(result.static, true);
  assert.equal(result.homepage, true);
  assert.equal(result.carousel, false);
}

{
  const result = selection([
    "account/assets-manager.html",
    "css/account/assets-manager.css",
    "de/account/assets-manager.html",
    "js/pages/assets-manager/main.js",
    "js/shared/help-menu.js",
    "js/shared/saved-assets-browser.js",
    "tests/auth-admin.spec.js",
    "tests/locale.spec.js",
  ]);
  assert.equal(result.assets, true);
  assert.equal(result.homepage, true);
  assert.equal(result.auth, true);
  assert.equal(result.carousel, false);
  assert.equal(result.static, true);
  assert.equal(result.full, false);
}

{
  const result = selection(["account/assets-manager.html", "css/account/assets-manager.css"]);
  assert.equal(result.assets, true);
  assert.equal(result.homepage, false);
  assert.equal(result.auth, false);
  assert.equal(result.carousel, false);
}

{
  const result = selection(["js/shared/saved-assets-browser.js"]);
  assert.equal(result.assets, true);
  assert.equal(result.auth, false);
  assert.equal(result.homepage, false);
  assert.equal(result.carousel, false);
  assert.equal(result.memberAssets, true);
}

{
  const result = selection(["js/shared/help-menu.js"]);
  assert.equal(result.assets, true);
  assert.equal(result.auth, true);
  assert.equal(result.homepage, true);
  assert.equal(result.carousel, false);
}

{
  const result = selection(["package.json", "package-lock.json"]);
  assert.equal(result.dependencies, true);
  assert.equal(result.workerDependencies, false);
  assert.equal(result.runtime, false);
  assert.equal(result.carousel, false);
  assert.equal(result.assets, false);
  assert.equal(result.full, false);
}

{
  const result = selection(["workers/ai/package.json", "workers/ai/package-lock.json"]);
  assert.equal(result.dependencies, true);
  assert.equal(result.workerDependencies, true);
  assert.equal(result.workers, true);
  assert.equal(result.auth, false);
}

{
  const result = selection(["docs/audits/README.md", "README.md"]);
  assert.equal(result.docsOnly, true);
  assert.equal(result.runtime, false);
  assert.equal(result.carousel, false);
  assert.equal(result.assets, false);
  assert.equal(result.dependencies, false);
  assert.equal(result.static, false);
}

{
  const result = selection(["docs/audits/README.md", "index.html"]);
  assert.equal(result.docsOnly, false);
  assert.equal(result.homepage, true);
  assert.equal(result.carousel, true);
  assert.equal(result.static, true);
}

{
  const result = selection(["tests/homepage-carousel-focused.spec.js"]);
  assert.equal(result.homepage, true);
  assert.equal(result.carousel, false);
  assert.equal(result.assets, false);
  assert.equal(result.static, false);
}

{
  const result = selection(["playwright.carousel.config.js"]);
  assert.equal(result.homepage, true);
  assert.equal(result.carousel, true);
  assert.equal(result.assets, false);
  assert.equal(result.full, false);
}

for (const file of [
  "playwright.homepage.config.js",
  "playwright.homepage-performance.config.js",
  "playwright.homepage-webkit.config.js",
  "tests/homepage-creation-stream-anchor.spec.js",
  "tests/homepage-hero-playback.spec.js",
  "tests/homepage-hero-state.spec.js",
  "tests/helpers/homepage-hero-native-probe.js",
  "tests/homepage-media-loading.spec.js",
  "tests/homepage-performance-contract.spec.js",
]) {
  const result = selection([file]);
  assert.equal(result.homepage, true, `${file} must select early homepage acceptance`);
  assert.equal(result.carousel, ["playwright.homepage-performance.config.js","tests/homepage-performance-contract.spec.js"].includes(file));
  assert.equal(result.full, false);
}

{
  const files = ['css/components/news-pulse.css', 'js/shared/news-pulse.js',
    'tests/homepage-carousel-focused.spec.js', 'tests/locale.spec.js',
    'tests/homepage-hero-playback.spec.js', 'tests/homepage-hero-state.spec.js',
    'tests/helpers/homepage-hero-native-probe.js', 'docs/runbooks/REGRESSION_REGISTER.md',
    'scripts/lib/ci-test-selection.mjs', 'scripts/test-ci-test-selection.mjs'];
  const result = selection(files), jobs = requiredJobs(result);
  assert.equal(result.full, false); assert.equal(result.workers, false);
  assert(jobs['homepage-webkit-media'].includes('Run required native WebKit media with private HOME and loopback only'));
  assert(jobs['homepage-validation']); assert(jobs['browser-validation']);
  assert.equal(selection([...files,'tests/helpers/homepage-unknown-probe.js']).full, true);
  assert.equal(selection([...files,'workers/auth/src/routes/auth.js']).workers, true);
}

{
  // This existing suite is not in either short homepage configuration. Its
  // isolated edits must retain the complete static regression that executes it.
  const result = selection(["tests/homepage-performance.spec.js"]);
  assert.equal(result.full, true);
  assert.equal(result.homepage, true);
  assert.equal(result.carousel, true);
}

{
  const result = selection(["tests/assets-manager-focused.spec.js"]);
  assert.equal(result.assets, true);
  assert.equal(result.homepage, false);
  assert.equal(result.carousel, false);
  assert.equal(result.auth, false);
}

{
  const result = selection(["tests/auth-admin.spec.js"]);
  assert.equal(result.auth, true);
  assert.equal(result.workers, false);
  assert.equal(result.carousel, false);
}

{
  const result = selection(["scripts/build-static-site.mjs"]);
  assert.equal(result.full, true);
  assert.equal(result.static, true);
}

{
  const result = selection(["infrastructure/example.tf"]);
  assert.equal(result.full, true);
  assert.equal(result.homepage, true);
  assert.equal(result.workers, true);
  assert.equal(result.auth, true);
  assert.equal(result.dependencies, true);
  assert.equal(result.carousel, true);
  assert.equal(result.assets, true);
  assert.equal(result.static, false);
}

{
  const result = selection([".github/workflows/static.yml"]);
  assert.equal(result.full, false);
  assert.equal(result.static, true);
  assert.equal(result.workers, false);
  assert.equal(result.carousel, false);
  assert.equal(result.assets, false);
}

{
  const result = selection([]);
  assert.equal(result.full, true);
  assert.equal(result.runtime, true);
}

{
  const result = selection(["docs/README.md"], { forceFull: true });
  assert.equal(result.docsOnly, false);
  assert.equal(result.full, true);
  assert.equal(result.homepage, true);
  assert.equal(result.carousel, true);
  assert.equal(result.assets, true);
  assert.equal(result.auth, true);
  assert.equal(result.workers, true);
}

{
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/static.yml"), "utf8");
  assert(workflow.includes("node scripts/select-ci-tests.mjs"));
  assert(workflow.includes("needs.release-compatibility.outputs.workers == 'true'"));
  assert(workflow.includes("needs.release-compatibility.outputs.homepage == 'true'"));
  assert(workflow.includes("needs.release-compatibility.outputs.carousel == 'true'"));
  assert(workflow.includes("needs.release-compatibility.outputs.assets == 'true'"));
  assert(workflow.includes("needs.release-compatibility.outputs.auth == 'true'"));
  assert(workflow.includes("npm run test:homepage-core"));
  assert(workflow.includes("npm run test:static -- --config playwright.assets.config.js"));
  assert(workflow.includes("npm run test:homepage-carousel"));
  assert(workflow.includes("steps.static_safety.outputs.static_deploy_required == 'true'"));
  assert(workflow.includes("npm run check:worker-dependency-audits -- --install"));
  const fullWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/full-regression.yml"), "utf8");
  assert(fullWorkflow.includes("npm run check:worker-dependency-audits -- --install"));
}

{
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/ui-fast-deploy.yml"), "utf8");
  assert(workflow.includes("node scripts/select-ci-tests.mjs"));
  assert(workflow.includes("needs.guard.outputs.carousel == 'true'"));
  assert(workflow.includes("needs.guard.outputs.member_models == 'true'"));
  assert(workflow.includes("npm run test:homepage-core"));
  assert(workflow.includes("npm run test:homepage-carousel"));
  assert(workflow.includes("Run focused member model exposure tests"));
  assert(!workflow.includes("npm run test:static"));
  assert(!workflow.includes("npm run test:workers"));
  assert(!workflow.includes("npm run release:preflight"));
}

{
  const fastWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/ui-fast-deploy.yml"), "utf8");
  const staticWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/static.yml"), "utf8");
  const { yaml } = await import('../node_modules/playwright-core/lib/utilsBundle.js');
  const normalEvents=yaml.parse(staticWorkflow).on, fastEvents=yaml.parse(fastWorkflow).on;
  assert.deepEqual(normalEvents.push,{branches:['main']},'Normal candidate path owns every automatic static publication');
  assert(!fastEvents.push,'Legacy fast writer is manual-only');
  assert(fastEvents.workflow_dispatch,'Keep the explicitly guarded transition path');

  assert(!fastWorkflow.includes("full-regression.yml"));
}

{
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert(packageJson.scripts["test:homepage-core"]);
  assert.equal(
    packageJson.scripts["test:homepage"],
    "npm run test:homepage-core && npm run test:homepage-carousel",
  );
  assert(packageJson.scripts["test:assets-manager"].includes("tests/assets-manager-focused.spec.js"));
}

{
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/full-regression.yml"), "utf8");
  assert(workflow.includes("schedule:"));
  assert(workflow.includes("release:"));
  assert(workflow.includes('branches: ["release/**"]'));
  assert(workflow.includes("npm run test:static"));
  assert(workflow.includes("npm run test:homepage-carousel"));
  assert(workflow.includes("npm run test:workers"));
  assert(!workflow.includes("actions/deploy-pages"));
}

console.log("CI test selection fixtures passed.");

// The actual additive Newsfeed delivery reaches the existing test:auth caller.
{
 const files=['admin/index.html','css/admin/newsfeed.css','js/pages/admin/main.js','js/pages/admin/newsfeed.js','js/pages/admin/router.js','tests/oma2-q3-newsfeed.spec.js'];
 const result=selectCiTests(files);
 assert.equal(result.auth,true); assert.equal(result.static,true); assert.equal(result.full,false);
 assert.equal(result.workers,false); assert.equal(result.homepage,false);
 assert.equal(selectCiTests([...files,'tests/unknown-feature.spec.js']).full,true);
}

// Bounded production scope, including its carried unpublished validation work.
const adminDelivery=[
 'admin/index.html','css/admin/newsfeed.css','js/pages/admin/main.js','js/pages/admin/newsfeed.js','js/pages/admin/router.js',
 'tests/oma2-q3-newsfeed.spec.js','.github/workflows/static.yml','playwright.config.js','playwright.carousel.config.js',
 'playwright.admin-release.config.js','scripts/lib/ci-test-selection.mjs','scripts/select-ci-tests.mjs',
 'scripts/pages-candidate.mjs','scripts/test-ci-test-selection.mjs','scripts/test-pages-candidate.mjs','scripts/test-pages-workflow.mjs',
 'scripts/lib/release-plan.mjs','tests/helpers/homepage-media-server.mjs','tests/homepage-hero-playback.spec.js','tests/fixtures/media/test-video-loading.mp4',
];
const scoped=selection(adminDelivery);
assert.equal(scoped.policy,'admin-reader-v1');assert(scoped.adminRelease&&scoped.auth&&scoped.static);
for(const key of ['full','workers','homepage','carousel','assets','dependencies'])assert.equal(scoped[key],false,key);
for(const input of ['js/shared/auth.js','workers/auth/src/index.js','workers/auth/migrations/0087_example.sql','js/pages/index/latest-models-video-module.js','css/pages/index.css','scripts/unknown.mjs','tests/unknown.spec.js','package-lock.json','config/release-compat.json']) {
 const broad=selection([...adminDelivery,input]);assert.equal(broad.adminRelease,false,input);
 assert(broad.full||broad.workers||broad.homepage||broad.dependencies,input);
}
assert.equal(selection(adminDelivery,{forceFull:true}).full,true);
assert.equal(selection(adminDelivery,{forceFull:true}).adminRelease,false);

const loggingFiles=['frontend/index.mjs','frontend/wrangler.jsonc','scripts/lib/frontend-hosting.mjs',
 'scripts/test-frontend-hosting.mjs','scripts/test-frontend-review.mjs','docs/runbooks/STATIC_HOSTING_MIGRATION.md',
 'docs/runbooks/REGRESSION_REGISTER.md','.github/workflows/static.yml','scripts/lib/ci-test-selection.mjs',
 'scripts/pages-candidate.mjs','scripts/test-ci-test-selection.mjs','scripts/test-pages-candidate.mjs'];
for(const files of [loggingFiles,['frontend/index.mjs'],['frontend/wrangler.jsonc']]) {
 const selected=selection(files);assert(selected.static);
 for(const key of ['full','workers','auth','homepage','carousel','assets','dependencies'])assert.equal(selected[key],false,key);
}
assert(selection(loggingFiles,{forceFull:true}).full);
for(const file of ['config/static-hosting.json','scripts/unknown.mjs','.github/workflows/unknown.yml','unknown.config'])assert(selection([...loggingFiles,file]).full,file);
for(const [file,impact] of [['workers/auth/src/index.js','workers'],['js/shared/auth.js','auth'],['js/pages/index/latest-models-video-module.js','homepage'],['js/pages/index/category-carousel.js','carousel'],['workers/contact/package-lock.json','workerDependencies']])assert(selection([...loggingFiles,file])[impact],file);
for(const file of ['frontend/index.mjs','frontend/wrangler.jsonc','config/static-hosting.json'])assert(!isFastDeploySafePath(file));

// Generation/Auth clients are covered by the existing account/assets/browser
// commands, not decorative decoder/performance tests. Unknown input stays broad.
const generationChange=['workers/auth/src/lib/member-generation-storage.js',
 'workers/auth/migrations/0087_add_member_generation_jobs.sql','config/release-compat.json',
 '.github/workflows/memvid-stream-preview-processor.yml','services/homepage-ffmpeg-processor/processor.mjs',
 'js/shared/auth-api.js','js/shared/locale.js','js/shared/member-generation-client.js',
 'js/shared/member-generation-status.js','js/pages/index/video-create.js','js/pages/generate-lab/main.js',
 'tests/helpers/q2-runtime/environment.mjs','tests/helpers/q2-runtime/linux-hosted.mjs','tests/helpers/q2-runtime/runner.mjs',
 'tests/member-generation.cases.js','tests/member-generation-runtime.mjs','tests/fixtures/media/member-image.png',
 'tests/fixtures/media/member-video-poster.webp','tests/oma2-q1-member.spec.js'];
const generation=selection(generationChange);
for(const key of ['workers','auth','assets','static','homepage'])assert.equal(generation[key],true,key);
for(const key of ['homepageMedia','carousel','full'])assert.equal(generation[key],false,key);
assert.equal(selection([...generationChange,'unknown-runtime.js']).full,true);
assert.equal(selection([...generationChange,'js/pages/index/latest-models-video-module.js']).homepage,true);
assert.equal(selection([...generationChange,'js/pages/index/category-carousel.js']).carousel,true);
assert.equal(selection(generationChange,{forceFull:true}).full,true);
const memberCommands=JSON.parse(fs.readFileSync(path.join(repoRoot,'package.json'))).scripts;
assert.match(memberCommands['test:auth'],/tests\/oma2-q1-member.spec.js/);
assert.match(memberCommands['test:auth'],/tests\/locale.spec.js/);
assert.match(fs.readFileSync(path.join(repoRoot,'tests/workers.spec.js'),'utf8'),/require\("\.\/member-generation.cases.js"\)/);

// Release contract fixture edits execute in the required release job, not the decorative matrix.
{
  const selected = selectCiTests(["scripts/test-release-compat.mjs", "workers/auth/wrangler.jsonc"]);
  assert.equal(selected.workers, true);
  assert.equal(selected.full, false);
  assert.equal(selected.homepage, false);
}

// Complete member cards + naming delta uses its real bounded consumers.
const memberFiles=['css/account/assets-manager.css','js/shared/saved-assets-browser.js',
 'workers/auth/src/lib/asset-names.js','workers/auth/src/routes/ai/video-generate.js',
 'workers/auth/src/routes/ai/music-generate.js','workers/auth/src/routes/ai/images-write.js',
 'workers/auth/src/routes/ai/files-read.js','workers/auth/src/lib/ai-text-assets.js',
 'tests/helpers/auth-worker-harness.js','tests/member-generation-runtime.mjs',
 'tests/member-generation.cases.js','tests/helpers/member-generation-control.mjs',
 'tests/assets-manager-focused.spec.js','playwright.assets.config.js','.github/workflows/static.yml'];
const member=selection(memberFiles);
assert.equal(member.policy,'member-assets-v1');
for(const key of ['assets','workers','static'])assert.equal(member[key],true,key);
for(const key of ['auth','full','homepage','carousel'])assert.equal(member[key],false,key);
for(const extra of ['unknown-root.js','workers/auth/src/lib/session.js','workers/auth/src/lib/member-generation-storage.js','workers/auth/src/lib/credit-ledger.js','js/pages/index/gallery.js','package.json']) {
 const result=selection([...memberFiles,extra]);
 assert.notEqual(result.policy,'member-assets-v1',extra);
 assert(result.full||result.auth||result.homepage||result.dependencies,extra);
}
assert.equal(selection(memberFiles,{forceFull:true}).full,true);

const musicCards = selection(['tests/auth-admin.spec.js','tests/locale.spec.js','playwright.assets.config.js','account/assets-manager.html','de/account/assets-manager.html','js/shared/saved-assets-browser.js','css/account/assets-manager.css','js/shared/mobile-media-grid-overlay.js','tests/assets-manager-focused.spec.js','scripts/lib/ci-test-selection.mjs','scripts/test-ci-test-selection.mjs']);
assert.equal(musicCards.assets,true);assert.equal(musicCards.workers,false);assert.equal(musicCards.full,false);
const sharedOverlay = selection(['js/shared/mobile-media-grid-overlay.js']);
assert.equal(sharedOverlay.policy,'impact-v1');assert.equal(sharedOverlay.homepage,true);assert.equal(sharedOverlay.auth,true,'Standalone shared overlay changes retain their ordinary impact');

// Shared public dialog: targeted browsers plus the real file route, not hero stress.
const publicDetailFiles = ['js/pages/index/public-media-detail-panel.js','js/pages/index/video-gallery.js',
 'css/pages/index.css','js/shared/locale.js','tests/public-media-dialog.spec.js',
 'tests/fixtures/media/detail-original.mp4','tests/workers.spec.js','playwright.public-media.config.js',
 'scripts/lib/release-plan.mjs','.github/workflows/static.yml','scripts/pages-candidate.mjs'];
const publicDetail=selection(publicDetailFiles);
assert.equal(publicDetail.publicMedia,true);
assert.equal(publicDetail.auth,true);
assert.equal(publicDetail.static,true);
for(const key of ['workers','homepage','carousel','full'])assert.equal(publicDetail[key],false,key);
for(const file of ['js/pages/index/category-carousel.js','workers/auth/src/routes/video-gallery.js','js/shared/auth-api.js','unknown-input.mjs']) {
 const impact=selection([...publicDetailFiles,file]);
 assert.notEqual(impact.publicMedia,true,file);
 assert(impact.workers || impact.homepage || impact.full,file);
}
assert.equal(selection(['css/pages/index.css']).homepage,true);
assert.equal(selection(['js/pages/index/video-gallery.js']).carousel,true);

// Generate Lab layout/controllers need its existing smoke/locale and authenticated
// save/Assets tests. They do not own decorative homepage playback or Worker code.
const canvasUiFiles = ['canvas/index.html', 'de/canvas/index.html',
 'css/pages/canvas.css', 'js/pages/canvas/main.js'];
for (const files of [...canvasUiFiles.map(file => [file]), ['tests/canvas.spec.js'], ['tests/oma2-q1-canvas.spec.js'], canvasUiFiles]) {
 const result = selection(files);
 assert.equal(result.policy, 'impact-v1');
 assert.equal(result.homepage, true, `${files}: real Canvas browser caller`);
 for (const key of ['homepageMedia', 'carousel', 'workers', 'assets', 'auth', 'full']) assert.equal(result[key], false, `${files}: ${key}`);
 assert(requiredJobs(result)['browser-validation'].includes('Run selected homepage core tests'));
}
for (const [file, impact] of [['js/pages/canvas/state.js', 'homepageMedia'], ['js/pages/canvas/api.js', 'auth'],
 ['js/shared/auth-api.js', 'assets'], ['workers/auth/src/routes/canvas.js', 'workers'],
 ['js/shared/member-model-exposure.mjs', 'memberModels'], ['unknown-canvas-runtime.mjs', 'full']]) {
 assert(selection([...canvasUiFiles, file])[impact], file);
}
assert(selection(canvasUiFiles, {forceFull: true}).full);

const generateLabUiFiles = ['generate-lab/index.html', 'de/generate-lab/index.html',
 'css/pages/generate-lab.css', 'js/pages/generate-lab/main.js'];
for (const files of [...generateLabUiFiles.map(file => [file]), [...generateLabUiFiles,
 'tests/smoke.spec.js', 'tests/locale.spec.js', 'scripts/lib/ci-test-selection.mjs',
 'scripts/test-ci-test-selection.mjs', 'docs/runbooks/REGRESSION_REGISTER.md']]) {
 const result = selection(files);
 assert.equal(result.policy, 'impact-v1');
 for (const key of ['homepage', 'auth', 'static', 'runtime']) assert.equal(result[key], true, `${files}: ${key}`);
 for (const key of ['homepageMedia', 'carousel', 'workers', 'assets', 'full', 'dependencies']) assert.equal(result[key], false, `${files}: ${key}`);
 assert.notEqual(result.workspaceHelp, true);
 const jobs = requiredJobs(result);
 assert(jobs['homepage-validation']);
 assert(jobs['browser-validation'].includes('Run selected homepage core tests'));
 assert(jobs['browser-validation'].includes('Run selected auth and admin tests'));
 assert.equal(jobs['homepage-webkit-media'], undefined);
 assert.equal(jobs['worker-validation'], undefined);
}
for (const [file, impact] of [
 ['js/pages/generate-lab/model-registry.js', 'homepageMedia'],
 ['js/shared/auth-api.js', 'assets'], ['js/shared/admin-ai-contract.mjs', 'workers'],
 ['js/pages/index/category-carousel.js', 'carousel'],
 ['workers/auth/src/index.js', 'workers'], ['unknown-runtime.mjs', 'full'],
]) assert(selection([...generateLabUiFiles, file])[impact], file);
assert.equal(selection(generateLabUiFiles, {forceFull: true}).full, true);

const workspaceFiles = ['generate-lab/index.html','de/generate-lab/index.html','css/pages/generate-lab.css',
 'js/pages/generate-lab/main.js','js/pages/generate-lab/model-help.js','js/shared/help-menu.js','js/shared/locale.js',
 'tests/smoke.spec.js','tests/locale.spec.js','playwright.workspace.config.js',
 'scripts/lib/release-plan.mjs','.github/workflows/static.yml','scripts/pages-candidate.mjs'];
const workspaceHelp = selection(workspaceFiles);
assert.equal(workspaceHelp.workspaceHelp,true);
assert.equal(workspaceHelp.auth,true);
for(const key of ['workers','homepage','carousel','full','assets'])assert.equal(workspaceHelp[key],false,key);
for(const file of ['js/shared/auth-api.js','js/shared/ai-image-models.mjs','js/pages/generate-lab/model-registry.js','workers/auth/src/index.js','unknown.mjs']) {
 assert.notEqual(selection([...workspaceFiles,file]).workspaceHelp,true,file);
}
assert.notEqual(selectCiTests(workspaceFiles,{forceFull:true}).workspaceHelp,true);

const statusFiles=['workers/auth/src/lib/admin-model-status.js','workers/auth/src/routes/admin-ai.js','workers/auth/src/app/route-policy.js',
 'admin/index.html','js/pages/admin/model-status.js','js/shared/auth-api.js','css/admin/model-status.css',
 'tests/oma2-q3-model-status.spec.js','tests/admin-model-status.spec.js','tests/admin-model-status-runtime.mjs','playwright.model-status.config.js',
 'scripts/lib/ci-test-selection.mjs','scripts/lib/release-plan.mjs','.github/workflows/static.yml','tests/helpers/q2-runtime/linux-bootstrap.py',
 'tests/helpers/q2-runtime/linux-runtime-child.mjs','tests/helpers/q2-runtime/test_linux_bootstrap.py','scripts/test-q2-runtime-launcher.mjs'];
const statusSelection=selection(statusFiles);
assert.equal(statusSelection.modelStatus,true);assert.equal(statusSelection.auth,true);assert.equal(statusSelection.workers,true);
for(const key of ['full','homepage','carousel','assets'])assert.equal(statusSelection[key],false,key);
for(const file of ['workers/auth/src/lib/ai-usage-policy.js','workers/auth/src/lib/session.js','workers/auth/src/lib/billing.js','js/shared/admin-ai-contract.mjs','unknown-root.js','workers/auth/src/lib/member-generation-jobs.js'])assert.notEqual(selection([...statusFiles,file]).modelStatus,true,file);
assert.equal(selection(['tests/admin-model-status.spec.js']).workers,true);
assert.equal(selection(['tests/oma2-q3-model-status.spec.js']).auth,true);
assert.notEqual(selectCiTests(statusFiles,{forceFull:true}).modelStatus,true);

// Exact consumer ownership, not a general shared-code exemption or release profile.
const layoutFiles=['css/components/news-pulse.css','js/shared/news-pulse.js','tests/homepage-carousel-focused.spec.js','tests/smoke.spec.js'];
const layoutSelection=selection(layoutFiles);
assert.equal(layoutSelection.policy,'impact-v1'); assert(layoutSelection.homepage);
for(const key of ['auth','memberModels','carousel','homepageMedia','workers','full'])assert.equal(layoutSelection[key],false,key);
assert(!requiredJobs(layoutSelection)['homepage-webkit-media']);
const mediaSelection=selection([...layoutFiles,'tests/homepage-hero-playback.spec.js','tests/homepage-hero-state.spec.js']);
assert(mediaSelection.homepageMedia);assert(requiredJobs(mediaSelection)['homepage-webkit-media']);
for(const [file,key] of [['js/pages/index/latest-models-video-module.js','homepageMedia'],['js/shared/auth.js','auth'],['js/shared/member-model-exposure.mjs','memberModels'],['js/pages/index/category-carousel.js','carousel'],['workers/auth/src/index.js','workers'],['tests/unknown-news.spec.js','full'],['.github/workflows/unknown.yml','full']])assert(selection([...layoutFiles,file])[key],file);

// This specific contract is consumed by Canvas + Auth, not decorative media.
for (const files of [['js/shared/canvas-model-contract.mjs'], ['js/shared/canvas-model-contract.mjs', 'js/pages/canvas/main.js', 'workers/auth/src/routes/canvas.js', 'workers/ai/src/lib/invoke-ai.js', 'scripts/lib/ci-test-selection.mjs', 'scripts/lib/release-plan.mjs', 'scripts/test-release-plan.mjs']]) {
 const result = selection(files);
 for (const key of ['homepage', 'auth', 'workers', 'static']) assert.equal(result[key], true, key);
 for (const key of ['homepageMedia', 'carousel', 'full']) assert.equal(result[key], false, key);
 assert(requiredJobs(result)['browser-validation'].includes('Run selected homepage core tests'));
}
assert(selection(['js/shared/canvas-model-contract.mjs', 'js/pages/index/latest-models-video-module.js']).homepageMedia);
assert(selection(['js/shared/canvas-model-contract.mjs', 'unknown-runtime.mjs']).full);

for (const file of ['scripts/lib/release-plan.mjs', 'scripts/test-release-plan.mjs']) {
 const result = selection([file]); assert(result.static); assert.equal(result.full, false);
}
assert(selection(['scripts/lib/unknown-release-policy.mjs']).full);

for (const file of ['js/pages/canvas/api.js', 'js/pages/canvas/video-frame.js', 'js/pages/canvas/video-input.js', 'js/pages/canvas/workflow.js', 'js/shared/canvas-video-input.mjs', 'tests/fixtures/media/canvas-end-frame.mp4', 'tests/helpers/canvas-video-control.mjs']) {
 const result = selection([file]);
 assert.equal(result.full, false, file); assert.equal(result.homepageMedia, false, file); assert.equal(result.carousel, false, file);
 if (!file.includes('/helpers/')) assert(result.homepage, file);
 if (file.includes('/helpers/') || file.includes('/shared/') || file.endsWith('.mp4')) assert(result.workers, file);
}
assert(selection(['js/shared/canvas-video-input.mjs', 'unknown-video-adapter.mjs']).full);
assert(selection(['js/pages/canvas/video-frame.js', 'js/pages/index/latest-models-video-module.js']).homepageMedia);

{
 const selection=selectCiTests(['js/pages/canvas/full-video.js','workers/auth/src/routes/canvas-video-processing.js',
 'services/homepage-ffmpeg-processor/canvas-full-video.mjs','services/homepage-ffmpeg-processor/canvas-full-video.test.mjs',
 'scripts/lib/backend-publication.mjs','scripts/lib/backend-continuation.mjs','scripts/release-apply.mjs','scripts/check-static-deploy-safety.mjs','scripts/check-route-policies.mjs','tests/helpers/canvas-processing-control.mjs']);
 assert.equal(selection.workers,true);assert.equal(selection.auth,true);assert.equal(selection.homepage,true);
 assert.equal(selection.static,true);assert.equal(selection.full,false);assert.equal(selection.homepageMedia,false);
 assert.equal(selectCiTests(['services/homepage-ffmpeg-processor/unknown.mjs']).full,true);
}

{
 const files=['workers/media/src/index.js','workers/media/package-lock.json','scripts/private-media-image.mjs','tests/helpers/private-media-control.mjs','js/pages/admin/private-media-service.js'];
 const selected=selectCiTests(files);assert.equal(selected.workers,true);assert.equal(selected.auth,true);assert.equal(selected.full,false);
 assert.equal(selected.homepage,false);assert.equal(selected.carousel,false);
 const jobs=requiredJobs({...selected,files});assert(jobs['worker-validation'].includes('Build and test private media Linux image'));assert(jobs['worker-validation'].includes('Preserve tested private media image'));
 assert(selectCiTests([...files,'scripts/unknown-media-authority.mjs']).full);
}
