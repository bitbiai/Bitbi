import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FAST_DEPLOY_WORKFLOW_PATHS,
  isFastDeploySafePath,
} from "./lib/fast-deploy-paths.mjs";
import { selectCiTests } from "./lib/ci-test-selection.mjs";

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
  assert.equal(result.homepage, false);
  assert.equal(result.workers, false);
  assert.equal(result.auth, false);
  assert.equal(result.full, false);
}

{
  const result = selection(["js/shared/models-overlay.js"]);
  assert.equal(result.memberModels, true);
  assert.equal(result.static, true);
  assert.equal(result.homepage, false);
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
  assert.equal(result.full, true);
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
  assert.equal(result.auth, true);
  assert.equal(result.homepage, false);
  assert.equal(result.carousel, false);
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
  assert.equal(result.carousel, true);
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
  "tests/homepage-media-loading.spec.js",
  "tests/homepage-performance-contract.spec.js",
]) {
  const result = selection([file]);
  assert.equal(result.homepage, true, `${file} must select early homepage acceptance`);
  assert.equal(result.carousel, true);
  assert.equal(result.full, false);
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
  assert.equal(result.full, true);
  assert.equal(result.runtime, true);
  assert.equal(result.carousel, true);
  assert.equal(result.assets, true);
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
  assert(workflow.includes("npm run test:assets-manager"));
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
  const workflowPaths = (workflow, key) => {
    const match = workflow.match(new RegExp(`^    ${key}:\\n((?:      - "[^"]+"\\n)+)`, "m"));
    assert(match, `expected ${key} block`);
    return [...match[1].matchAll(/^      - "([^"]+)"$/gm)].map((entry) => entry[1]);
  };
  assert.deepEqual(workflowPaths(fastWorkflow, "paths"), FAST_DEPLOY_WORKFLOW_PATHS);
  assert.deepEqual(workflowPaths(staticWorkflow, "paths-ignore"), FAST_DEPLOY_WORKFLOW_PATHS);
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
