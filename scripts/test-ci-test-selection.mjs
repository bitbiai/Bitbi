import { releaseValidationSource } from './lib/release-validation-source.mjs';
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  FAST_DEPLOY_WORKFLOW_PATHS,
  isFastDeploySafePath,
} from "./lib/fast-deploy-paths.mjs";
import { selectCiTests, requiresPrivateMediaImage, isDurableImageTestChange, isFluxReviewTestChange, isCanvasCompletionRouteChange } from "./lib/ci-test-selection.mjs";
import { requiredJobs } from "./pages-candidate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

for (const file of ['config/website-assistant.json', 'workers/shared/website-assistant-knowledge.mjs', 'workers/shared/website-assistant-content.mjs',
  'js/shared/website-assistant-context.mjs', 'tests/website-assistant-runtime.mjs', 'workers/auth/src/lib/website-assistant-control.js', 'tests/website-assistant-control.test.mjs']) {
  const selected = selectCiTests([file]);
  assert.equal(selected.workers, true, `${file}: admission/knowledge must execute the Worker chain`);
  assert.equal(selected.homepage, true, `${file}: actual browser caller must exercise the public API contract`);
  assert.equal(selected.full, false, `${file}: no whole-platform regression for the closed assistant scope`);
}
for (const file of ['css/components/website-assistant.css', 'js/shared/website-assistant.js', 'tests/website-assistant.spec.js', 'js/pages/admin/website-assistant.js', 'css/admin/website-assistant.css', 'tests/admin-website-assistant.spec.js']) {
  const selected = selectCiTests([file]);
  assert.equal(selected.homepage, true);
  assert.equal(selected.workers, false, 'Cosmetic/isolated UI changes must not force backend acceptance');
}
const assistantCommands = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts;
assert.match(assistantCommands['test:homepage-core'], /tests\/website-assistant\.spec\.js/);
assert.match(assistantCommands['test:homepage-core'], /--project=webkit-assistant/);
assert.match(assistantCommands['test:homepage-core'], /tests\/admin-website-assistant\.spec\.js/);
assert.match(assistantCommands['test:workers'], /npm run test:website-assistant/);

for (const file of ["tests/q4-stream-receipts.spec.js", "tests/q4-runtime-memory.mjs", "tests/helpers/q4-video-control.mjs"]) {
  const selected = selectCiTests([file]);
  assert.equal(selected.workers, true, `${file} must reach the real Worker/native command`);
  assert.equal(selected.full, false);
}

function selection(files, options) {
  const selected = selectCiTests(files, options);
  assert.equal(Object.hasOwn(selected, 'homepageMedia'), false, 'Retired decorative selection is absent');
  assert.equal(Object.hasOwn(selected.reasons, 'homepageMedia'), false);
  assert.equal(requiredJobs(selected)['homepage-webkit-media'], undefined);
  return selected;
}

// Unknown validation configuration still executes the complete retained matrix.
for (const file of ['tests/appearance-runtime.mjs', 'tests/admin-model-status-runtime.mjs']) {
  const selected = selection(['workers/auth/src/routes/canvas.js', 'workers/auth/migrations/0099_seedance_25_custom_tariffs.sql', file]);
  assert(selected.canvasText && selected.workers && selected.auth, file);
  assert.equal(selected.full, false, file);
  assert(!selection(['css/pages/generate-lab.css', file]).canvasText, 'Fixture inclusion cannot invent a Canvas runtime anchor');
}

assert.equal(selection(['playwright.retired.config.js']).full, true);
assert.equal(selection(['playwright.config.js'], {forceFull: true}).full, true);

// Exercise the actual GitHub output writer: no retired flag survives either
// a narrow functional selection or the full retained acceptance matrix.
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bitbi-ci-selection-output-'));
try {
  for (const args of [['--file', 'playwright.homepage.config.js'], ['--file', 'playwright.retired.config.js']]) {
    const outputPath = path.join(outputDirectory, 'github-output');
    fs.writeFileSync(outputPath, '');
    const result = spawnSync(process.execPath, ['scripts/select-ci-tests.mjs', ...args, '--github-output'], {
      cwd: repoRoot, encoding: 'utf8', timeout: 10000,
      env: {...process.env, GITHUB_ACTIONS: 'false', GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: ''},
    });
    assert.equal(result.status, 0, result.stderr);
    const outputs = Object.fromEntries(fs.readFileSync(outputPath, 'utf8').trim().split('\n').map(line => {
      const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
    }));
    assert.equal(Object.hasOwn(outputs, 'homepage_media'), false);
    assert.equal(outputs.browser_repair, 'false', 'Ordinary selection cannot claim authenticated repair reuse');
    assert.equal(outputs.homepage, 'true');
    assert.equal(outputs.full, String(args[1].includes('retired')));
    if (outputs.full === 'true') for (const flag of ['workers', 'auth', 'assets', 'carousel']) assert.equal(outputs[flag], 'true');
  }
} finally {
  fs.rmSync(outputDirectory, {recursive: true, force: true});
}

{
  const file = 'js/shared/flux-2-max-identity.mjs';
  const selected = selection([file]);
  assert(selected.workers && selected.auth && selected.homepage && selected.static,
    'The identity leaf is consumed by Auth and the frontend catalog');
  assert(selected.reasons.workers.some(reason => reason.includes(file) && reason.includes('shared Worker code used by auth')));
  assert.equal(isFastDeploySafePath(file), false, 'Auth runtime cannot use frontend-only fast deployment');
}

{
  const files=['js/shared/wallet/wallet-visibility.js','js/shared/asset-preview-details.js','js/pages/generate-lab/main.js',
    'workers/auth/src/routes/ai/asset-details.js','workers/auth/src/routes/ai/images-write.js','workers/auth/src/lib/appearance-settings.js',
    'tests/asset-preview-details-runtime.mjs','tests/assets-manager-focused.spec.js','tests/oma2-q3-appearance.spec.js'];
  const result=selection(files);
  assert.equal(result.policy,'workspace-presentation-v1');
  for(const flag of ['appearance','memberAssets','workers','assets','auth','static','runtime'])assert.equal(result[flag],true,flag);
  for(const flag of ['full','homepage','carousel','canvasText'])assert(!result[flag],flag);
  assert.deepEqual(Object.keys(requiredJobs(result)),['release-compatibility','worker-validation','browser-validation']);
  const withStaging = selection([...files, 'tests/helpers/q2-runtime/linux-hosted.mjs', 'scripts/test-q2-runtime-launcher.mjs']);
  assert.equal(withStaging.policy, result.policy);
  assert.deepEqual(requiredJobs(withStaging), requiredJobs(result), 'Packaging repair retains all previously skipped acceptance');
  for (const file of ['tests/helpers/q2-runtime/linux-bootstrap.py', 'tests/helpers/q2-runtime/linux-isolation-contract.mjs'])
    assert.notEqual(selection([...files,file]).policy, result.policy, 'Changed isolation boundary is not a staging-list repair');
  for(const file of ['workers/auth/src/lib/session.js','workers/auth/src/lib/member-generation-jobs.js','workers/auth/src/lib/billing.js','package-lock.json','js/shared/wallet/wallet-state.js','unknown.js']) {
    assert.notEqual(selection([...files,file]).policy,'workspace-presentation-v1',file);
  }
  assert.notEqual(selection([...files,'tests/oma2-q1-member.spec.js']).policy,'workspace-presentation-v1','Multipurpose member spec requires source-bound changed test coverage');
  assert(selection(files,{forceFull:true}).full);
  const workflow=releaseValidationSource(repoRoot);
  assert(workflow.includes('CI_MEMBER_ASSETS: ${{ needs.release-compatibility.outputs.member_assets }}'));
  assert(workflow.includes('if [ "$CI_MEMBER_ASSETS" = \'true\' ]; then'));
  assert(workflow.includes('Q2_RUNTIME_ARTIFACTS="$Q2_RUNTIME_ARTIFACTS/member-generation" node scripts/test-q2-runtime.mjs --suite member-generation || exit $?'));
  assert(fs.readFileSync(path.join(repoRoot,'tests/member-generation-runtime.mjs'),'utf8').includes('await runAssetPreviewDetailsTests(f)'));
}

{
  const files = ['js/shared/image-dimensions.mjs', 'js/shared/generation-model-order.mjs', 'js/shared/asset-type-view.js',
    'js/shared/admin-ai-contract.mjs', 'js/shared/ai-image-models.mjs', 'js/shared/canvas-model-contract.mjs',
    'js/shared/studio-deck.js', 'js/shared/saved-assets-browser.js', 'js/shared/auth-api.js',
    'workers/auth/src/routes/ai/assets-read.js', 'workers/auth/src/routes/ai/images-write.js', 'workers/auth/src/routes/ai/helpers.js',
    'tests/helpers/q2-runtime/canvas.mjs', 'tests/assets-manager-focused.spec.js', 'tests/helpers/generation-selectors.cjs'];
  const result = selection(files);
  assert(result.canvasText && result.assets && result.auth && result.workers && result.static);
  assert(!result.full && !result.carousel);
  const jobs = requiredJobs(result); assert(jobs['browser-validation'] && jobs['worker-validation']);
  for (const file of ['workers/auth/src/lib/session.js', 'workers/auth/src/lib/billing.js', 'js/shared/unknown.js', 'package-lock.json']) {
    assert(!selection([...files, file]).canvasText, file);
  }
  assert(selection(files, { forceFull: true }).full);
}

{
  const flux=['workers/auth/src/lib/flux-schnell-provider.js','workers/auth/src/routes/ai/helpers.js','workers/auth/src/routes/ai/images-write.js',
    'workers/auth/src/lib/member-generation-jobs.js','js/shared/ai-image-models.mjs','js/shared/locale.js','js/shared/member-generation-client.js',
    'js/pages/generate-lab/main.js','tests/member-generation.cases.js','tests/member-generation-runtime.mjs','tests/helpers/member-generation-control.mjs','tests/oma2-q1-member.spec.js','tests/workers.spec.js'];
  const after=fs.readFileSync(path.join(repoRoot,'tests/oma2-q1-member.spec.js'),'utf8');
  const before=after.replace(/\/\/ FLUX review acceptance begin[^\n]*\n[\s\S]*?\/\/ FLUX review acceptance end\.\n/,'');
  const memberTestSources={before,after};
  assert(isFluxReviewTestChange(memberTestSources));
  assert(!isFluxReviewTestChange({before,after:after+'\n// unrelated fixture change'}));
  assert(!selection(flux).canvasText,'Missing multipurpose-spec source context fails closed');
  const result=selection(flux,{memberTestSources});
  assert(result.canvasText && result.workers && result.auth && result.static);
  assert(!result.full && !result.carousel);
  for(const file of ['workers/auth/src/lib/session.js','workers/auth/src/lib/billing.js','js/shared/unknown.js','package-lock.json'])assert(!selection([...flux,file],{memberTestSources}).canvasText,file);
  const workflow=releaseValidationSource(repoRoot);
  assert(workflow.includes("--grep 'durable member generation: flux-|default FLUX Schnell|Canvas"));
  assert(workflow.includes('tests/smoke.spec.js tests/oma2-q1-member.spec.js tests/oma2-q3-model-pricing.spec.js --project=chromium --project=webkit-canvas --project=webkit-pricing'));
}

for (const file of ['scripts/test-q2-runtime.mjs', 'scripts/test-q2-runtime-launcher.mjs',
  'scripts/setup-media-tools.sh', 'scripts/check-media-tools.mjs']) {
  const result = selection([file]);
  assert.equal(result.workers, true, file);
  assert.equal(result.full, false, file);
  assert.equal(result.homepage, false, file);
  assert.equal(result.static, false, file);
}
assert.equal(selection(['scripts/test-q2-runtime-launcher-unknown.mjs']).full, true);
for (const file of ['tests/helpers/model-help-contract.cjs', 'tests/helpers/generate-lab-session.cjs']) {
  const result = selection([file]);
  assert(result.homepage && !result.full && !result.workers);
  assert(selection(['tests/helpers/model-help-contract-unknown.cjs']).full);
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
  "tests/homepage-creation-stream-anchor.spec.js",
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
    'docs/runbooks/REGRESSION_REGISTER.md',
    'scripts/lib/ci-test-selection.mjs', 'scripts/test-ci-test-selection.mjs'];
  const result = selection(files), jobs = requiredJobs(result);
  assert.equal(result.full, false); assert.equal(result.workers, false);
  assert.equal(jobs['homepage-webkit-media'], undefined);
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
  const workflow = releaseValidationSource(repoRoot);
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
  assert(workflow.includes("npm run check:worker-dependency-audits"));
  const fullWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/full-regression.yml"), "utf8");
  assert(fullWorkflow.includes("npm run check:worker-dependency-audits -- --install"));
}

{
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/ui-fast-deploy.yml"), "utf8");
  assert(workflow.includes('Refuse the retired duplicate validation path'));
  assert(workflow.includes('exit 1'));
  assert(!workflow.includes('npm run test:'));
  assert(!workflow.includes('actions/deploy-pages'));

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
 'scripts/lib/release-plan.mjs','tests/helpers/homepage-media-server.mjs',
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
const mediaReuseTooling=['scripts/lib/media-activation-reuse.mjs','scripts/test-media-activation-reuse.mjs'];
for(const files of [loggingFiles,['frontend/index.mjs'],['frontend/wrangler.jsonc'],mediaReuseTooling]) {
 const selected=selection(files);assert(selected.static);
 for(const key of ['full','workers','auth','homepage','carousel','assets','dependencies'])assert.equal(selected[key],false,key);
}
assert(selection(loggingFiles,{forceFull:true}).full);
assert(selection(mediaReuseTooling,{forceFull:true}).full);
assert(selection([...mediaReuseTooling,'scripts/lib/unknown-media-reuse.mjs']).full);
assert(selection([...mediaReuseTooling,'workers/auth/src/lib/private-media-smoke.js']).workers);
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
for(const key of ['carousel','full'])assert.equal(generation[key],false,key);
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
 for (const key of ['carousel', 'workers', 'assets', 'auth', 'full']) assert.equal(result[key], false, `${files}: ${key}`);
 assert(requiredJobs(result)['browser-validation'].includes('Run selected homepage core tests'));
}
for (const [file, impact] of [['js/pages/canvas/state.js', 'homepage'], ['js/pages/canvas/api.js', 'auth'],
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
 for (const key of ['carousel', 'workers', 'assets', 'full', 'dependencies']) assert.equal(result[key], false, `${files}: ${key}`);
 assert.notEqual(result.workspaceHelp, true);
 const jobs = requiredJobs(result);
 assert(jobs['homepage-validation']);
 assert(jobs['browser-validation'].includes('Run selected homepage core tests'));
 assert(jobs['browser-validation'].includes('Run selected auth and admin tests'));
 assert.equal(jobs['homepage-webkit-media'], undefined);
 assert.equal(jobs['worker-validation'], undefined);
}
for (const [file, impact] of [
 ['js/pages/generate-lab/model-registry.js', 'homepage'],
 ['js/shared/auth-api.js', 'assets'], ['js/shared/admin-ai-contract.mjs', 'workers'],
 ['js/pages/index/category-carousel.js', 'carousel'],
 ['workers/auth/src/index.js', 'workers'], ['unknown-runtime.mjs', 'full'],
]) assert(selection([...generateLabUiFiles, file])[impact], file);
assert.equal(selection(generateLabUiFiles, {forceFull: true}).full, true);

// Mixed session-preflight + informational help correction: the entire unpublished
// runtime range needs core, Assets and Auth proof, not native homepage decoders.
const sessionPreflightFiles = [
 'js/pages/generate-lab/main.js', 'js/pages/generate-lab/model-help.js',
 'js/pages/index/studio.js', 'js/pages/index/soundlab-create.js', 'js/pages/index/video-create.js',
 'js/shared/auth-api.js', 'js/shared/locale.js', 'js/shared/member-generation-client.js',
 'tests/oma2-q1-member.spec.js', 'tests/oma2-q3-auth-lifecycle.spec.js',
 'tests/oma2-q3-media.spec.js', 'tests/oma2-q3-workflows.spec.js', 'tests/oma2-q3-shell.spec.js',
 'tests/oma2-q3-appearance.spec.js',
 'tests/oma2-q1-canvas.spec.js', 'tests/smoke.spec.js', 'tests/locale.spec.js', 'tests/auth-admin.spec.js',
 'scripts/lib/ci-test-selection.mjs', 'scripts/test-ci-test-selection.mjs',
 'docs/runbooks/REGRESSION_REGISTER.md',
];
const sessionPreflightSelection = selection(sessionPreflightFiles);
assert.equal(sessionPreflightSelection.policy, 'impact-v1');
for (const key of ['homepage', 'assets', 'auth', 'static', 'runtime']) assert.equal(sessionPreflightSelection[key], true, key);
for (const key of ['carousel', 'workers', 'full']) assert.equal(sessionPreflightSelection[key], false, key);
assert.deepEqual(requiredJobs(sessionPreflightSelection)['browser-validation'], [
 'Run selected homepage core tests', 'Run selected Assets Manager tests', 'Run selected auth and admin tests',
 'Confirm tested browser candidate bytes',
]);
assert.equal(requiredJobs(sessionPreflightSelection)['homepage-webkit-media'], undefined);
for (const file of ['js/pages/generate-lab/model-registry.js', 'js/pages/index/category-carousel.js', 'unknown-runtime.mjs']) {
 const result = selection([...sessionPreflightFiles, file]);
 assert(result.homepage || result.full, `${file}: retain functional/broad countercontrol`);
}

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
for(const key of ['auth','memberModels','carousel','workers','full'])assert.equal(layoutSelection[key],false,key);
assert(!requiredJobs(layoutSelection)['homepage-webkit-media']);
for(const [file,key] of [['js/pages/index/latest-models-video-module.js','homepage'],['js/shared/auth.js','auth'],['js/shared/member-model-exposure.mjs','memberModels'],['js/pages/index/category-carousel.js','carousel'],['workers/auth/src/index.js','workers'],['tests/unknown-news.spec.js','full'],['.github/workflows/unknown.yml','full']])assert(selection([...layoutFiles,file])[key],file);

// This specific contract is consumed by Canvas + Auth, not decorative media.
for (const files of [['js/shared/canvas-model-contract.mjs'], ['js/shared/canvas-model-contract.mjs', 'js/pages/canvas/main.js', 'workers/auth/src/routes/canvas.js', 'workers/ai/src/lib/invoke-ai.js', 'scripts/lib/ci-test-selection.mjs', 'scripts/lib/release-plan.mjs', 'scripts/test-release-plan.mjs']]) {
 const result = selection(files);
 for (const key of ['auth', 'workers', 'static']) assert.equal(result[key], true, key);
 assert.equal(result.homepage, files.length===1);
 for (const key of ['carousel', 'full']) assert.equal(result[key], false, key);
 assert(requiredJobs(result)['browser-validation'].includes(files.length===1?'Run selected homepage core tests':'Run selected auth and admin tests'));
}
assert(selection(['js/shared/canvas-model-contract.mjs', 'js/pages/index/latest-models-video-module.js']).homepage);
assert(selection(['js/shared/canvas-model-contract.mjs', 'unknown-runtime.mjs']).full);

for (const file of ['scripts/lib/release-plan.mjs', 'scripts/test-release-plan.mjs']) {
 const result = selection([file]); assert(result.static); assert.equal(result.full, false);
}
assert(selection(['scripts/lib/unknown-release-policy.mjs']).full);

for (const file of ['js/pages/canvas/api.js', 'js/pages/canvas/video-frame.js', 'js/pages/canvas/video-input.js', 'js/pages/canvas/workflow.js', 'js/shared/canvas-video-input.mjs', 'tests/fixtures/media/canvas-end-frame.mp4', 'tests/helpers/canvas-video-control.mjs']) {
 const result = selection([file]);
 assert.equal(result.full, false, file); assert.equal(result.carousel, false, file);
 if (file==='js/shared/canvas-video-input.mjs') {
   assert.equal(result.canvasText,true);assert.equal(result.homepage,false);assert(result.auth);
   assert(requiredJobs(result)['browser-validation'].includes('Run selected auth and admin tests'));
 } else if (!file.includes('/helpers/')) assert(result.homepage, file);
 if (file.includes('/helpers/') || file.includes('/shared/') || file.endsWith('.mp4')) assert(result.workers, file);
}
assert(selection(['js/shared/canvas-video-input.mjs', 'unknown-video-adapter.mjs']).full);
assert(selection(['js/pages/canvas/video-frame.js', 'js/pages/index/latest-models-video-module.js']).homepage);

{
 const selection=selectCiTests(['js/pages/canvas/full-video.js','workers/auth/src/routes/canvas-video-processing.js',
 'services/homepage-ffmpeg-processor/canvas-full-video.mjs','services/homepage-ffmpeg-processor/canvas-full-video.test.mjs',
 'scripts/lib/backend-publication.mjs','scripts/lib/backend-continuation.mjs','scripts/release-apply.mjs','scripts/check-static-deploy-safety.mjs','scripts/check-route-policies.mjs','tests/helpers/canvas-processing-control.mjs']);
 assert.equal(selection.workers,true);assert.equal(selection.auth,true);assert.equal(selection.canvasText,true);assert.equal(selection.homepage,false);
 assert.equal(selection.static,true);assert.equal(selection.full,false);
 assert.equal(selectCiTests(['services/homepage-ffmpeg-processor/unknown.mjs']).full,true);
}

{
 const files=['workers/auth/src/routes/canvas.js','js/shared/canvas-export.mjs','workers/auth/src/lib/canvas-export-recipes.js',
 'workers/auth/migrations/0096_canvas_export_versions.sql','workers/auth/src/routes/ai/assets-read.js',
 'services/homepage-ffmpeg-processor/canvas-full-video.mjs','services/homepage-ffmpeg-processor/canvas-full-video.test.mjs','scripts/lib/canvas-export-readiness.mjs'];
 const selected=selection(files);assert(selected.canvasText&&selected.workers&&selected.auth&&selected.assets);
 assert(!selected.full&&!selected.carousel);
 assert(requiredJobs(selected)['worker-validation'].includes('Build and test private media Linux image'));
 assert.notEqual(selection([...files,'workers/auth/src/lib/session.js']).canvasText,true);
 assert.notEqual(selection([...files,'services/homepage-ffmpeg-processor/unknown.mjs']).canvasText,true);
}

{
 const mergeFiles=['js/pages/canvas/main.js','js/pages/canvas/merge-clips.js','js/pages/canvas/full-video.js','js/shared/canvas-export.mjs','css/pages/canvas.css',
   'workers/auth/src/lib/canvas-merge-selection.js','workers/auth/src/lib/canvas-video-processing.js','workers/auth/src/routes/canvas-video-processing.js',
   'tests/helpers/canvas-processing-control.mjs','tests/canvas.spec.js','scripts/lib/ci-test-selection.mjs','scripts/test-ci-test-selection.mjs'];
 const merge=selection(mergeFiles);assert(merge.canvasText&&merge.workers&&merge.auth&&!merge.full&&!merge.homepage);
 assert.equal(requiresPrivateMediaImage(mergeFiles),false,'Graph admission/labels do not alter the crop processor or image');
 for(const extra of ['workers/auth/src/lib/session.js','workers/auth/src/lib/canvas-unknown.js'])assert(!selection([...mergeFiles,extra]).canvasText);
 const cropFiles=['js/pages/canvas/full-video.js','css/pages/canvas.css','workers/auth/src/routes/canvas-video-processing.js',
   'workers/auth/src/lib/canvas-video-processing.js','workers/auth/src/lib/canvas-export-recipes.js',
   'services/homepage-ffmpeg-processor/canvas-full-video.mjs','services/homepage-ffmpeg-processor/canvas-full-video.test.mjs',
   'tests/helpers/canvas-processing-control.mjs','tests/canvas.spec.js'];
 const crop=selection(cropFiles);assert(crop.canvasText&&crop.workers&&crop.auth&&!crop.full&&!crop.homepage);
 assert(requiredJobs(crop)['worker-validation'].includes('Build and test private media Linux image'));
 assert(requiredJobs(crop)['browser-validation'].includes('Run selected auth and admin tests'));
 for(const extra of ['workers/auth/src/lib/session.js','workers/auth/src/lib/billing.js','services/homepage-ffmpeg-processor/unknown.mjs'])assert(!selection([...cropFiles,extra]).canvasText);
 const files=['js/pages/canvas/full-video.js','js/pages/canvas/music-preview.js','js/pages/canvas/music-preview-worklet.js',
 'js/shared/canvas-export.mjs','workers/auth/src/lib/canvas-preview-base.js','workers/auth/migrations/0097_canvas_preview_base.sql',
 'tests/helpers/canvas-music-preview.cjs','tests/fixtures/media/canvas-preview.mp4','tests/fixtures/media/canvas-preview.webm','tests/fixtures/media/canvas-preview-loud.wav',
 'tests/fixtures/media/canvas-audition-native-input.json',
 'tests/helpers/homepage-media-server.mjs','services/homepage-ffmpeg-processor/canvas-full-video.mjs','scripts/lib/media-publication.mjs'];
 const selected=selection(files);assert(selected.canvasText&&selected.workers&&selected.auth&&selected.static);
 assert(!selected.full&&!selected.carousel);
 const jobs=requiredJobs(selected);assert(jobs['worker-validation'].includes('Build and test private media Linux image'));
 assert(jobs['browser-validation'].includes('Run selected auth and admin tests'));
 for(const file of ['workers/auth/src/lib/session.js','workers/auth/src/lib/billing.js','services/homepage-ffmpeg-processor/unknown.mjs'])assert(!selection([...files,file]).canvasText);
 const caller=fs.readFileSync(path.join(repoRoot,'tests/canvas.spec.js'),'utf8');assert(caller.includes("require('./helpers/canvas-music-preview.cjs')"));
}

{
 const files=['workers/media/src/index.js','workers/media/package-lock.json','scripts/private-media-image.mjs','tests/helpers/private-media-control.mjs','js/pages/admin/private-media-service.js'];
 const selected=selectCiTests(files);assert.equal(selected.workers,true);assert.equal(selected.auth,true);assert.equal(selected.full,false);
 assert.equal(selected.homepage,false);assert.equal(selected.carousel,false);
 const jobs=requiredJobs({...selected,files});assert(jobs['worker-validation'].includes('Build and test private media Linux image'));assert(jobs['worker-validation'].includes('Preserve tested private media image'));
 assert(selectCiTests([...files,'scripts/unknown-media-authority.mjs']).full);
}

{
 const files=['workers/media/src/index.js','scripts/test-private-media-lifecycle.mjs','.github/workflows/static.yml','scripts/lib/media-publication.mjs'];
 const selected=selection(files);
 assert.equal(selected.mediaLifecycle,true);
 for(const key of ['full','auth','homepage','assets'])assert.equal(selected[key],false,key);
 assert.equal(selected.workers,true);
 assert.deepEqual(requiredJobs(selected)['worker-validation'],['Run private media lifecycle tests','Build and test private media Linux image','Preserve tested private media image']);
 for(const file of ['workers/auth/src/index.js','workers/media/wrangler.jsonc','workers/media/package-lock.json','services/homepage-ffmpeg-processor/container-server.mjs','unknown-input.mjs'])assert.notEqual(selection([...files,file]).mediaLifecycle,true,file);
 assert.notEqual(selection(files,{forceFull:true}).mediaLifecycle,true);
}

{
  const files=['js/shared/grok-text-contract.mjs','js/shared/admin-ai-contract.mjs','workers/shared/grok-chat-contract.mjs','workers/shared/chat-model-contract.mjs','workers/ai/src/routes/text.js','workers/ai/src/lib/grok-chat.js','workers/auth/src/routes/canvas.js','workers/auth/src/routes/ai/text-generate.js','workers/auth/src/routes/admin-ai.js','js/pages/canvas/main.js','js/shared/canvas-model-contract.mjs','tests/workers.spec.js','tests/grok-chat-workers.spec.js','tests/canvas.spec.js','tests/helpers/q2-runtime/canvas.mjs','tests/helpers/q2-runtime/environment.mjs','.github/workflows/static.yml','scripts/lib/backend-publication.mjs'];
  const result=selection(files);assert.equal(result.canvasText,true);assert.equal(result.workers,true);assert.equal(result.auth,true);
  for(const key of ['full','homepage','carousel','assets'])assert.equal(result[key],false);
  for(const extra of ['workers/auth/src/lib/session.js','workers/auth/src/lib/member-credit-ledger.js','workers/ai/src/index.js','js/shared/auth.js','unknown-runtime.js'])assert.notEqual(selection([...files,extra]).canvasText,true);
  assert.notEqual(selection(files,{forceFull:true}).canvasText,true);
  const purposes=['js/pages/canvas/main.js','js/shared/canvas-model-contract.mjs','js/shared/help-menu.js','workers/auth/src/routes/canvas.js','tests/canvas.spec.js','tests/workers.spec.js','tests/helpers/q2-runtime/canvas.mjs','scripts/lib/ci-test-selection.mjs','scripts/test-ci-test-selection.mjs'];
  assert.equal(selection(purposes).canvasText,true);
  assert.notEqual(selection(['js/shared/help-menu.js']).canvasText,true);
  assert.notEqual(selection([...purposes,'js/shared/auth.js']).canvasText,true);
}

{
 const files=['js/pages/canvas/main.js','js/shared/canvas-model-contract.mjs','workers/auth/src/routes/canvas.js','js/shared/grok-imagine-image-2-pricing.mjs','workers/ai/src/lib/invoke-ai.js','workers/auth/src/lib/canvas-media-storage.js','workers/auth/migrations/0090_add_canvas_private_outputs.sql','tests/helpers/canvas-processing-control.mjs','tests/q2-lifecycle.spec.js','tests/auth-admin.spec.js','tests/smoke.spec.js','playwright.config.js'];
 const result=selection(files);assert.equal(result.canvasText,true);assert.equal(result.workers,true);assert.equal(result.auth,true);assert.equal(result.full,false);
 for(const extra of ['workers/auth/src/lib/session.js','workers/auth/migrations/0091_unknown.sql','workers/auth/src/lib/billing.js','unknown.js'])assert.notEqual(selection([...files,extra]).canvasText,true);
}

// Generate Lab role accounting + the existing shared media processor are one
// bounded integration, never the SDK-only shortcut or a whole-platform waiver.
{
 const files=['js/pages/generate-lab/main.js','workers/auth/src/routes/ai/quota.js','workers/auth/src/lib/member-generation-jobs.js',
 'js/shared/auth-api.js','admin/index.html','js/pages/admin/private-media-service.js',
 'workers/auth/src/lib/ai-cost-operations.js','scripts/test-ai-cost-policy.mjs','js/shared/help-menu.js',
 'js/shared/member-model-exposure.mjs','js/shared/grok-imagine-video-pricing.mjs','js/shared/grok-imagine-video-15-preview-pricing.mjs','workers/ai/src/lib/invoke-ai-video.js','workers/auth/src/lib/admin-ai-video-sources.js','workers/auth/src/lib/ai-video-jobs.js','workers/auth/migrations/0092_pin_video_source_inputs.sql',
 'js/pages/generate-lab/grok-video-controls.js','js/pages/generate-lab/model-help.js','js/pages/canvas/video-input.js','tests/canvas.spec.js',
 'workers/auth/migrations/0091_separate_thumbnail_processing.sql','workers/auth/src/lib/media-preview-jobs.js',
 'workers/auth/src/index.js','workers/auth/wrangler.jsonc','workers/auth/src/lib/grok-video-output.js','tests/helpers/q2-runtime/control.mjs',
 'workers/auth/src/routes/homepage-hero-videos.js','workers/auth/src/lib/memvid-stream-upload-receipts.js',
 'workers/media/src/index.js','workers/media/wrangler.jsonc','services/homepage-ffmpeg-processor/processor.mjs',
 'tests/helpers/private-media-control.mjs','tests/helpers/member-generation-control.mjs','tests/member-generation-runtime.mjs','tests/smoke.spec.js'];
 const selected=selection(files);assert.equal(selected.canvasText,true);assert.equal(selected.workers,true);assert.equal(selected.auth,true);
 for(const flag of ['full','homepage','carousel','mediaLifecycle'])assert(!selected[flag],flag);
 const jobs=requiredJobs({...selected,files})['worker-validation'];
 for(const name of ['Run worker route tests','Run private media lifecycle tests','Build and test private media Linux image','Preserve tested private media image'])assert(jobs.includes(name),name);
 for(const unknown of ['workers/auth/src/lib/session.js','workers/auth/src/lib/billing.js','workers/ai/src/index.js','workers/auth/migrations/0092_unknown.sql','unknown.js'])assert.notEqual(selection([...files,unknown]).canvasText,true,unknown);
 assert.notEqual(selection(files,{forceFull:true}).canvasText,true);
}

// H3 model/status integration uses the same actual Canvas/model + native callers.
{
 const files=['js/pages/generate-lab/main.js','js/pages/canvas/main.js','js/shared/canvas-model-contract.mjs','workers/auth/src/routes/canvas.js','js/shared/minimax-h3.mjs','js/shared/h3-reference-controls.js','js/shared/member-generation-client.js','js/shared/locale.js','workers/auth/src/lib/ai-usage-policy.js','workers/auth/src/lib/h3-reference-metadata.js','workers/auth/src/lib/minimax-h3-callback.js','workers/ai/src/routes/video-task.js','tests/helpers/h3-model-controls.cjs','tests/fixtures/media/h3-reference.mp4','tests/fixtures/media/h3-frame.png','tests/helpers/q2-runtime/linux-hosted.mjs'];
 const result=selection(files);assert.equal(result.canvasText,true);assert.equal(result.workers,true);assert.equal(result.auth,true);
 for(const flag of ['full','homepage','carousel'])assert.equal(result[flag],false,flag);
 for(const extra of ['workers/auth/src/lib/session.js','workers/auth/src/lib/billing.js','unknown-input.js'])assert.notEqual(selection([...files,extra]).canvasText,true);
}

// Connected-video adapter changes use the existing Canvas integration caller,
// even when the model catalog itself is unchanged. Unknown/shared inputs stay broad.
{
 const files=['js/pages/canvas/main.js','js/pages/canvas/workflow.js','js/pages/canvas/video-input.js','js/shared/canvas-video-input.mjs','workers/auth/src/lib/canvas-video-input.js','workers/auth/src/routes/canvas.js','tests/canvas.spec.js','tests/helpers/canvas-video-control.mjs','tests/helpers/q2-runtime/canvas.mjs','tests/helpers/q2-runtime/control.mjs','scripts/lib/ci-test-selection.mjs','scripts/test-ci-test-selection.mjs','docs/runbooks/REGRESSION_REGISTER.md'];
 const result=selection(files);assert.equal(result.canvasText,true);assert.equal(result.workers,true);assert.equal(result.auth,true);assert.equal(result.runtime,true);
 for(const flag of ['full','homepage','carousel'])assert.equal(result[flag],false,flag);
 for(const extra of ['workers/auth/src/lib/session.js','workers/auth/src/lib/billing.js','js/shared/auth.js','unknown-input.js'])assert.notEqual(selection([...files,extra]).canvasText,true);
 assert.notEqual(selection(files,{forceFull:true}).canvasText,true);
}

// Canvas's server adapter alone still needs the existing Canvas/Auth/native branch.
{
 const files=['workers/auth/src/routes/canvas.js','tests/workers.spec.js','tests/helpers/canvas-music-control.mjs','tests/helpers/q2-runtime/canvas.mjs','tests/helpers/q2-runtime/control.mjs','tests/helpers/q2-runtime/linux-hosted.mjs','scripts/test-q2-runtime-launcher.mjs','scripts/lib/ci-test-selection.mjs','scripts/test-ci-test-selection.mjs','docs/runbooks/REGRESSION_REGISTER.md'];
 const result=selection(files);assert.equal(result.canvasText,true);assert.equal(result.workers,true);assert.equal(result.auth,true);assert.equal(result.runtime,true);
 assert.equal(selection(['workers/auth/src/routes/canvas.js']).canvasText,true);
 assert.notEqual(selection(files,{forceFull:true}).canvasText,true);
 const browserRepair=[...files,'tests/smoke.spec.js','tests/helpers/gpt-image25-ui.cjs'];
 assert.equal(selection(browserRepair).canvasText,true);
 for(const extra of ['js/shared/auth.js','workers/auth/src/lib/billing.js','tests/helpers/unknown.js'])assert.notEqual(selection([...browserRepair,extra]).canvasText,true);
 for(const flag of ['full','homepage','carousel'])assert.equal(result[flag],false,flag);
 for(const extra of ['workers/auth/src/lib/session.js','workers/auth/src/lib/billing.js','unknown-input.js'])assert.notEqual(selection([...files,extra]).canvasText,true);
}

// H3 private reference preparation: real Canvas/worker/native and FFmpeg callers.
{
 const files=['workers/auth/src/lib/private-video-references.js','workers/auth/src/routes/private-video-references.js',
  'workers/auth/src/lib/h3-reference-metadata.js','workers/auth/src/lib/admin-ai-video-sources.js',
  'workers/auth/migrations/0093_add_private_video_references.sql','services/homepage-ffmpeg-processor/video-reference.mjs',
  'services/homepage-ffmpeg-processor/video-reference.test.mjs','services/homepage-ffmpeg-processor/Dockerfile','scripts/check-route-policies.mjs','scripts/test-homepage-ffmpeg-processor.mjs','workers/auth/src/lib/asset-storage-quota.js','tests/helpers/canvas-video-control.mjs','tests/helpers/q2-runtime/canvas.mjs'];
 const result=selection(files);assert.equal(result.canvasText,true);assert.equal(result.workers,true);assert.equal(result.auth,true);assert.equal(result.runtime,true);
 for(const extra of ['workers/auth/src/lib/session.js','workers/auth/src/lib/billing.js','workers/auth/migrations/0094_unknown.sql','unknown.js'])assert.notEqual(selection([...files,extra]).canvasText,true);
}

// H3 response/rejection settlement stays in its existing model/native path.
{
 const files=['workers/auth/src/lib/h3-provider-result.js','workers/auth/src/lib/member-generation-jobs.js',
  'workers/auth/src/lib/minimax-h3-callback.js','workers/auth/src/routes/ai/video-generate.js','workers/auth/src/lib/canvas-video-jobs.js',
  'js/pages/canvas/main.js','js/pages/canvas/video-input.js','tests/canvas.spec.js','tests/workers.spec.js',
  'tests/member-generation-runtime.mjs','tests/helpers/member-generation-control.mjs','scripts/lib/ci-test-selection.mjs','scripts/test-ci-test-selection.mjs'];
 const result=selection(files);assert.equal(result.canvasText,true);assert.equal(result.workers,true);assert.equal(result.auth,true);
 for(const flag of ['full','homepage','carousel'])assert.equal(result[flag],false,flag);
 assert.notEqual(result.mediaLifecycle,true);
 assert.equal(requiresPrivateMediaImage(files),false,'No changed media processor/container bytes');
 for(const extra of ['workers/auth/src/lib/session.js','workers/auth/src/lib/billing.js','unknown.js'])assert.notEqual(selection([...files,extra]).canvasText,true);
 assert.notEqual(selection(files,{forceFull:true}).canvasText,true);
}

// Canvas hosts the existing Assets picker; its complete frontend suites join
{
 const files=['workers/auth/src/routes/canvas.js','js/shared/member-music-contract.mjs','js/shared/member-music-controls.js',
  'js/shared/model-tariff.mjs','workers/auth/src/lib/model-tariffs.js','workers/auth/src/lib/request.js','workers/ai/src/routes/music.js',
  'workers/ai/src/lib/invoke-ai.js','workers/auth/src/lib/canvas-contributors.js','js/pages/canvas/graph.js','css/pages/canvas.css',
  'js/pages/assets-manager/main.js','js/shared/saved-assets-browser.js','tests/q2-member-music.spec.js',
  'tests/helpers/elevenlabs-member-control.mjs','tests/helpers/canvas-contributors-control.mjs','tests/fixtures/media/member-music.mp3','tests/fixtures/media/member-music.opus',
  'tests/q4-stream-receipts.spec.js','tests/q4-stream-selection.spec.js','tests/helpers/q4-video-jobs.js'];
 const result=selection(files);assert(result.canvasText&&result.workers&&result.auth&&result.assets&&result.runtime);
 assert(!result.full);assert.equal(requiresPrivateMediaImage(files),false);
 for(const extra of ['workers/auth/src/lib/billing.js','workers/auth/src/lib/session.js','workers/ai/src/index.js','unknown.js'])assert.notEqual(selection([...files,extra]).canvasText,true);
 const workflow=releaseValidationSource();
 for(const proof of ['tests/q2-member-music.spec.js','canvas-music-worker.json','canvas-music-adapter.json'])assert(workflow.includes(proof));
 const opusRepair=[...files,'tests/canvas.spec.js','tests/helpers/homepage-media-server.mjs'];
 const repaired=selection(opusRepair);assert(repaired.canvasText&&repaired.assets&&repaired.auth&&repaired.workers);
 assert(!repaired.full);assert.equal(requiresPrivateMediaImage(opusRepair),false);
 assert.notEqual(selection(['tests/helpers/homepage-media-server.mjs']).canvasText,true);
 assert.notEqual(selection([...opusRepair,'tests/helpers/unknown-http-server.mjs']).canvasText,true);
}

// Canvas hosts the existing Assets picker; its complete frontend suites join
// the existing shared-card caller, without generation or native-media jobs.
const canvasPickerFiles=['canvas/index.html','de/canvas/index.html','js/pages/canvas/main.js',
 'js/pages/canvas/asset-picker.js','css/pages/canvas.css','css/components/assets-picker.css',
 'generate-lab/index.html','de/generate-lab/index.html','css/pages/generate-lab.css',
 'js/shared/saved-assets-browser.js','tests/canvas.spec.js','playwright.assets.config.js',
 'scripts/lib/ci-test-selection.mjs','scripts/test-ci-test-selection.mjs'];
const canvasPickerSelection=selection(canvasPickerFiles);
assert.equal(canvasPickerSelection.policy,'member-assets-v1');
assert.equal(canvasPickerSelection.assets,true);assert.equal(canvasPickerSelection.static,true);
for(const flag of ['workers','auth','homepage','carousel','full'])assert.equal(canvasPickerSelection[flag],false,flag);
for(const extra of ['js/pages/canvas/api.js','js/pages/canvas/workflow.js','js/shared/canvas-model-contract.mjs','workers/auth/src/routes/canvas.js','unknown-picker.js'])assert.notEqual(selection([...canvasPickerFiles,extra]).policy,'member-assets-v1',extra);
const pickerFollowup=[...canvasPickerFiles,'tests/oma2-q1-member.spec.js'];
const memberBefore=fs.readFileSync(path.join(repoRoot,'tests/oma2-q1-member.spec.js'),'utf8');
const memberAfter=memberBefore.replace('expect(accepted).toBe(1);','expect(accepted).toBe(1); // case-body edit');
const memberTestSources={before:memberBefore,after:memberAfter};
assert(isDurableImageTestChange(memberTestSources));
assert.equal(selection(pickerFollowup,{memberTestSources}).policy,'member-assets-v1');
for(const flag of ['workers','auth','homepage','carousel','full'])assert.equal(selection(pickerFollowup,{memberTestSources})[flag],false,flag);
assert.notEqual(selection(pickerFollowup).policy,'member-assets-v1','Path names alone cannot narrow this multipurpose spec');
for(const after of [memberBefore,memberAfter.replace('creditBalance: 1000','creditBalance: 900'),memberAfter.replace('restored jobs, preview pending','renamed jobs, preview pending'),memberAfter+'\ntest("new checkout case",()=>{});',memberAfter.replace('// case-body edit','test("unselected case",()=>{});')]) {
 const sources={before:memberBefore,after};
 assert.equal(isDurableImageTestChange(sources),false);
 assert.notEqual(selection(pickerFollowup,{memberTestSources:sources}).policy,'member-assets-v1');
}
assert.equal(isDurableImageTestChange(null),false);
assert.notEqual(selection(pickerFollowup,{memberTestSources,forceFull:true}).policy,'member-assets-v1');
assert.equal(selection(['tests/oma2-q1-member.spec.js']).auth,true,'Standalone member/credit test edits retain their ordinary impact');
for(const extra of ['js/shared/auth-api.js','workers/auth/src/lib/credit-ledger.js','unknown-member.js'])assert.notEqual(selection([...pickerFollowup,extra],{memberTestSources}).policy,'member-assets-v1',extra);
const assetConfig=createRequire(import.meta.url)(path.join(repoRoot,'playwright.assets.config.js'));
for(const browserName of ['chromium','webkit']) {
 const project=assetConfig.projects.find(project=>project.name===`${browserName}-canvas`);
 assert.equal(project.use.browserName,browserName);
 assert.deepEqual(project.testMatch,['**/canvas.spec.js','**/oma2-q1-canvas.spec.js']);
 assert.equal(project.grep,undefined,'the existing Canvas contract is not hidden behind a picker-only filter');
 const memberProject=assetConfig.projects.find(project=>project.name===`${browserName}-jobs`);
 assert.equal(memberProject.use.browserName,browserName);
 assert.deepEqual(memberProject.testMatch,['**/oma2-q1-member.spec.js']);
 assert(memberProject.grep.test('durable generation en: accepted image is already saved without a browser save request'));
 assert(memberProject.grep.test('durable generation de: accepted image is already saved without a browser save request'));
}

// One central tariff surface includes real charging callers and native D1.
const pricingDelta=['js/pages/admin/model-pricing.js','js/shared/model-tariff.mjs','js/shared/model-pricing-catalog.mjs','js/shared/model-pricing-client.js','workers/auth/src/lib/model-tariffs.js','workers/auth/src/lib/ai-usage-policy.js','workers/auth/src/lib/ai-usage-attempts.js','workers/auth/src/lib/member-ai-usage-attempts.js','workers/auth/migrations/0094_model_pricing.sql','tests/model-pricing.spec.js','tests/model-pricing-runtime.mjs','tests/oma2-q3-model-pricing.spec.js','tests/helpers/model-pricing-control.mjs','tests/helpers/q2-runtime/linux-runtime-child.mjs','playwright.model-pricing.config.js','.github/workflows/static.yml','scripts/pages-candidate.mjs'];
const pricing=selection(pricingDelta);
assert.equal(pricing.policy,'model-pricing-v1');
for(const key of ['workers','auth','static','runtime'])assert.equal(pricing[key],true,key);
for(const key of ['homepage','carousel','full'])assert.equal(pricing[key],false,key);
assert.deepEqual(Object.keys(requiredJobs(pricing)),['release-compatibility','worker-validation','browser-validation']);
for(const neighbor of ['workers/auth/src/lib/session.js','workers/auth/src/lib/billing.js','workers/auth/src/lib/unknown-pricing.js','workers/media/src/index.js','js/pages/index/hero-controller.js'])assert.notEqual(selection([...pricingDelta,neighbor]).policy,'model-pricing-v1',neighbor);
assert.equal(selection(pricingDelta,{forceFull:true}).full,true);
// A browser-only refresh repair retains all existing pricing browser cases but
// does not repeat unchanged Worker/native acceptance. Unknown additions broaden.
const pricingClientDelta=['js/shared/model-pricing-client.js','tests/oma2-q3-model-pricing.spec.js','scripts/lib/ci-test-selection.mjs','scripts/test-ci-test-selection.mjs','docs/runbooks/REGRESSION_REGISTER.md'];
for(const files of [['js/shared/model-pricing-client.js'],pricingClientDelta]){
 const result=selection(files);assert.equal(result.policy,'model-pricing-v1');assert.equal(result.workers,false);
 for(const key of ['auth','static','runtime','modelPricing'])assert.equal(result[key],true);
 assert.deepEqual(Object.keys(requiredJobs(result)),['release-compatibility','browser-validation']);
 assert.equal(selection(files,{forceFull:true}).full,true);
}
for(const file of ['workers/auth/src/lib/model-tariffs.js','js/shared/model-tariff.mjs','tests/model-pricing-runtime.mjs','tests/model-pricing.spec.js','js/shared/auth-api.js','workers/auth/src/lib/session.js','unknown.js'])assert.equal(selection([...pricingClientDelta,file]).workers,true,file);

// Appearance spans every public/member/Admin host: never the Admin-reader path.
const appearanceDelta = [
  'index.html', 'de/index.html', 'pricing.html', 'de/pricing.html',
  ...['privacy','datenschutz','terms','imprint'].flatMap(name=>[`legal/${name}.html`,`de/legal/${name}.html`]),
  ...['assets-manager','credits','forgot-password','organization','profile-settings','profile','reset-password','verify-email'].flatMap(name=>[`account/${name}.html`,`de/account/${name}.html`]),
  'admin/index.html','canvas/index.html','de/canvas/index.html','generate-lab/index.html','de/generate-lab/index.html',
  'css/base/tokens.css','css/base/appearance.css','css/admin/appearance.css','js/shared/appearance.js','js/shared/appearance-contract.js','js/shared/auth-api.js',
  'js/pages/admin/appearance.js','js/pages/admin/main.js','js/pages/admin/router.js','js/pages/admin/nav.js',
  'workers/auth/src/lib/appearance-settings.js','workers/auth/src/routes/appearance.js','workers/auth/src/index.js','workers/auth/src/app/route-policy.js',
  'config/release-compat.json','tests/appearance.spec.js','tests/appearance-runtime.mjs','tests/oma2-q3-appearance.spec.js','tests/helpers/appearance.js','tests/auth-admin.spec.js',
  'playwright.config.js','playwright.workers.config.js','tests/helpers/q2-runtime/runner.mjs','tests/helpers/q2-runtime/linux-hosted.mjs','tests/helpers/q2-runtime/linux-runtime-child.mjs','tests/helpers/q2-runtime/linux-bootstrap.py',
  'scripts/test-q2-runtime-launcher.mjs','scripts/lib/ci-test-selection.mjs','scripts/select-ci-tests.mjs','scripts/test-ci-test-selection.mjs','scripts/pages-candidate.mjs','scripts/test-pages-candidate.mjs','.github/workflows/static.yml',
];
const appearanceSelection=selection(appearanceDelta);
assert.equal(appearanceSelection.policy,'appearance-v1');assert.equal(appearanceSelection.appearance,true);
for(const key of ['workers','auth','static','runtime'])assert.equal(appearanceSelection[key],true,key);
for(const key of ['adminRelease','homepage','carousel','assets','full'])assert.equal(appearanceSelection[key],false,key);
assert.deepEqual(Object.keys(requiredJobs(appearanceSelection)),['release-compatibility','worker-validation','browser-validation']);
assert.equal(requiresPrivateMediaImage(appearanceDelta),false);
for(const extra of ['workers/auth/src/lib/session.js','workers/auth/src/lib/billing.js','workers/auth/src/routes/canvas.js','js/pages/canvas/main.js','js/pages/generate-lab/main.js','js/shared/saved-assets-browser.js','css/pages/index.css','unknown-theme.js','scripts/new-theme-tool.mjs'])assert.notEqual(selection([...appearanceDelta,extra]).policy,'appearance-v1',extra);
assert.equal(selection(appearanceDelta,{forceFull:true}).full,true);
assert.notEqual(selection(['css/base/tokens.css','js/shared/auth-api.js']).policy,'appearance-v1','Shared inputs alone cannot claim the bounded cross-segment theme implementation');

// New image adapters extend the existing pricing admission path. Pending
// appearance bytes remain in the full unpublished delta and keep their cases.
const imagePricingDelta = [
  'js/shared/gpt-image-25-contract.mjs','js/shared/gpt-image-25-pricing.mjs',
  'js/shared/model-tariff.mjs','js/shared/ai-image-models.mjs',
  'workers/shared/gpt-image-25.mjs','workers/ai/src/index.js',
  'workers/ai/src/lib/invoke-ai.js','workers/ai/src/routes/image.js',
  'workers/auth/src/lib/gpt-image-25-sources.js','workers/auth/src/routes/canvas.js',
  'tests/q2-gpt-image-25.spec.js','tests/helpers/gpt-image25-ui.cjs',
  'tests/helpers/q2-runtime/canvas.mjs','tests/canvas.spec.js',
  'tests/smoke.spec.js','tests/auth-admin.spec.js',
];
for (const files of [imagePricingDelta,[...imagePricingDelta,...appearanceDelta]]) {
 const result=selection(files);
 assert.equal(result.policy,'model-pricing-v1');assert.equal(result.imageModels,true);
 assert.equal(result.appearance,files.includes('js/shared/appearance.js'));
 for(const key of ['workers','auth','runtime','static'])assert.equal(result[key],true);
 for(const key of ['full','carousel','canvasText'])assert(!result[key]);
 assert.equal(requiresPrivateMediaImage(files),false);
 for(const extra of ['workers/auth/src/lib/session.js','workers/auth/src/lib/member-credit-ledger.js','workers/ai/src/routes/unknown.js','js/shared/auth.js','unknown.js'])assert.notEqual(selection([...files,extra]).policy,'model-pricing-v1');
 assert.equal(selection(files,{forceFull:true}).full,true);
}

// Completed HTTPS output repair owns its actual queued native/image/browser callers.
const imageDeliveryDelta=['workers/auth/migrations/0095_retained_image_delivery.sql','config/release-compat.json','workers/shared/gpt-image-25.mjs','workers/auth/src/lib/image-delivery-recovery.js',
 'workers/auth/src/lib/member-generation-jobs.js','workers/auth/src/lib/ai-usage-policy.js','workers/auth/src/routes/ai/images-write.js',
 'js/pages/generate-lab/main.js','js/shared/member-generation-status.js','js/shared/locale.js',
 'tests/helpers/q2-runtime/canvas.mjs','tests/helpers/q2-runtime/control.mjs','tests/helpers/q2-runtime/environment.mjs',
 'tests/q2-gpt-image-25.spec.js','tests/smoke.spec.js','scripts/lib/ci-test-selection.mjs','scripts/test-ci-test-selection.mjs'];
const deliverySelection=selection(imageDeliveryDelta);
assert.equal(deliverySelection.policy,'model-pricing-v1');assert.equal(deliverySelection.imageModels,true);
for(const key of ['workers','auth','runtime','static'])assert.equal(deliverySelection[key],true,key);
for(const key of ['full','carousel','appearance'])assert.equal(Boolean(deliverySelection[key]),false,key);
assert.equal(requiresPrivateMediaImage(imageDeliveryDelta),false);
for(const file of ['workers/auth/src/lib/session.js','workers/auth/src/lib/billing.js','workers/ai/src/routes/unknown.js'])assert.notEqual(selection([...imageDeliveryDelta,file]).policy,'model-pricing-v1');

const omniDelta = ['workers/auth/src/routes/canvas.js','js/shared/gemini-omni-contract.mjs','js/shared/gemini-omni-pricing.mjs','workers/auth/src/lib/gemini-omni-readiness.js','workers/auth/src/lib/gemini-omni-media.js','workers/auth/src/routes/ai/reference-video-upload.js','js/shared/omni-reference-upload.js','js/pages/admin/gemini-omni-controls.js','js/pages/admin/model-status.js','js/shared/model-pricing-client.js','js/shared/models-overlay.js','tests/q2-gemini-omni.spec.js','tests/helpers/omni-model-controls.cjs','tests/model-pricing-runtime.mjs'];
assert.equal(selection(omniDelta).canvasText,true);
for (const neighbor of ['workers/auth/src/lib/session.js','workers/ai/src/routes/unknown.js','workers/ai/wrangler.jsonc'])assert.notEqual(selection([...omniDelta,neighbor]).canvasText,true,neighbor);
const omniWorkflow=releaseValidationSource(repoRoot);
assert(omniWorkflow.includes('tests/q2-gemini-omni.spec.js'));
assert(omniWorkflow.includes('Q2_RUNTIME_ARTIFACTS="$Q2_RUNTIME_ARTIFACTS/model-pricing" node scripts/test-q2-runtime.mjs --suite model-pricing'));
assert(omniWorkflow.includes('tests/oma2-q3-model-pricing.spec.js --project=chromium --project=webkit-canvas --project=webkit-pricing'));
console.log('Omni: existing native queue/pricing and dual-engine workspace callers; unknown auth/provider siblings remain outside the narrow selection.');

const areaFiles=["config/release-compat.json", "css/admin/model-status.css", "js/pages/admin/model-availability.js", "js/pages/admin/model-status.js", "js/pages/canvas/graph.js", "js/pages/canvas/main.js", "js/pages/canvas/workflow.js", "js/pages/generate-lab/main.js", "js/pages/generate-lab/model-registry.js", "js/shared/auth-api.js", "js/shared/model-area-contract.mjs", "js/shared/model-availability.js", "js/shared/model-pricing-client.js", "js/shared/models-overlay.js", "js/shared/website-assistant.js", "playwright.model-status.config.js", "tests/admin-model-status-runtime.mjs", "tests/admin-model-status.spec.js", "tests/canvas.spec.js", "tests/fixtures/model-availability.json", "tests/helpers/appearance.js", "tests/helpers/auth-worker-harness.js", "tests/helpers/member-generation-control.mjs", "tests/helpers/model-pricing-control.mjs", "tests/helpers/omni-model-controls.cjs", "tests/helpers/q2-runtime/control.mjs", "tests/helpers/q2-runtime/environment.mjs", "tests/oma2-q1-canvas.spec.js", "tests/oma2-q3-auth-lifecycle.spec.js", "tests/oma2-q3-media.spec.js", "tests/oma2-q3-model-pricing.spec.js", "tests/oma2-q3-model-status.spec.js", "tests/oma2-q3-workflows.spec.js", "tests/smoke.spec.js", "tests/website-assistant-provider.test.mjs", "tests/website-assistant-route.test.mjs", "workers/auth/migrations/0098_model_area_availability.sql", "workers/auth/src/app/route-policy.js", "workers/auth/src/lib/admin-ai-idempotency.js", "workers/auth/src/lib/ai-dispatch-state.js", "workers/auth/src/lib/ai-usage-attempts.js", "workers/auth/src/lib/ai-usage-policy.js", "workers/auth/src/lib/member-ai-usage-attempts.js", "workers/auth/src/lib/member-generation-jobs.js", "workers/auth/src/lib/model-availability.js", "workers/auth/src/lib/website-assistant-policy.js", "workers/auth/src/routes/admin-ai.js", "workers/auth/src/routes/canvas.js", "workers/auth/src/routes/model-pricing.js", "workers/auth/src/routes/website-assistant.js", "workers/shared/website-assistant-contract-version.mjs"];
areaFiles.push('scripts/test-q2-runtime-launcher.mjs','workers/auth/src/routes/admin.js','.github/workflows/static.yml','scripts/pages-candidate.mjs','scripts/test-pages-candidate.mjs','scripts/lib/release-plan.mjs','scripts/select-ci-tests.mjs');
const areaSelection=selection(areaFiles);assert.equal(areaSelection.modelAreas,true);assert.equal(areaSelection.modelStatus,true);assert.equal(areaSelection.workers,true);assert.equal(areaSelection.auth,true);assert.equal(areaSelection.full,false);
for(const neighbor of ['workers/auth/src/lib/session.js','workers/auth/src/lib/billing.js','workers/ai/src/routes/text.js','unmapped-feature.js'])assert.notEqual(selection([...areaFiles,neighbor]).modelAreas,true);
assert.notEqual(selectCiTests(areaFiles,{forceFull:true}).modelAreas,true);

const seedanceDelta=['js/pages/admin/video-input-controls.js','tests/fixtures/model-availability.json','tests/helpers/model-pricing-control.mjs','workers/auth/src/lib/model-provider-prices.js','js/shared/seedance-25-contract.mjs','js/shared/seedance-25-pricing.mjs','js/shared/seedance-25-controls.js','workers/auth/src/lib/seedance-25-output.js','workers/auth/migrations/0099_seedance_25_custom_tariffs.sql','tests/q2-seedance-25.spec.js','tests/helpers/seedance25-model-controls.cjs','tests/fixtures/media/seedance-output.mov',...omniDelta];
const seedanceSelection=selection(seedanceDelta);assert.equal(seedanceSelection.canvasText,true);assert.equal(seedanceSelection.workers,true);assert.equal(seedanceSelection.full,false);
assert.equal(selection([...seedanceDelta,'workers/shared/website-assistant-version.mjs']).canvasText,true,'Registry-derived corpus refresh retains actual selected knowledge and product execution');
assert.match(omniWorkflow,/PLAYWRIGHT_JSON_OUTPUT_NAME=test-results\/canvas-music-worker\.json[^\n]*tests\/q2-seedance-25\.spec\.js[^\n]*--retries=0/);
for(const neighbor of ['workers/auth/src/lib/session.js','workers/ai/src/routes/unknown.js'])assert.notEqual(selection([...seedanceDelta,neighbor]).canvasText,true);
console.log('Seedance: real durable Worker/native and workspace/pricing callers remain selected.');

{
  const after=fs.readFileSync(new URL('../workers/auth/src/routes/canvas.js',import.meta.url),'utf8');
  const before=after.replace('applyCanvasVideoInput, ownedCanvasVideo }','applyCanvasVideoInput }')
    .replace(/      \/\/ The browser-attach path[^\n]*\n      \/\/ queue completion[^\n]*\n      if \(model.capability === 'video'\) output.sourceVersion[^\n]*\n/,'');
  const sources={before,after};
  assert(isCanvasCompletionRouteChange(sources));
  const files=['workers/auth/src/routes/canvas.js','workers/auth/src/lib/canvas-merge-selection.js','js/shared/canvas-export.mjs','js/pages/canvas/merge-clips.js','js/pages/canvas/full-video.js','tests/canvas.spec.js','tests/helpers/canvas-completion-control.mjs','tests/helpers/canvas-completion-ui.cjs',...['canvas.mjs','control.mjs','environment.mjs','runner.mjs','linux-hosted.mjs','linux-runtime-child.mjs','linux-bootstrap.py'].map(file=>'tests/helpers/q2-runtime/'+file),'scripts/test-q2-runtime-launcher.mjs'];
  const selected=selectCiTests(files,{canvasRouteSources:sources});
  assert.equal(selected.canvasCompletion,true);assert.equal(selected.workers,true);assert.equal(selected.auth,true);
  assert.equal(requiresPrivateMediaImage(files),false);
  for(const canvasRouteSources of [null,{before,after:after+'\n// other route change'},{before,after:after.replace('80_000_000','1_000_000')}]) assert.notEqual(selectCiTests(files,{canvasRouteSources}).canvasCompletion,true);
  for(const extra of ['workers/auth/src/lib/billing.js','workers/auth/src/lib/canvas-video-processing.js','workers/media/src/index.js','js/pages/canvas/main.js']) assert.notEqual(selectCiTests([...files,extra],{canvasRouteSources:sources}).canvasCompletion,true);
  assert.notEqual(selectCiTests(files,{canvasRouteSources:sources,forceFull:true}).canvasCompletion,true);
}

// Focused asset/audio changes must execute the existing Worker and both browser
// callers. Unrelated provider/billing/unknown inputs may not inherit this scope.
{
 const files=['js/shared/canvas-audio.mjs','workers/auth/src/routes/canvas.js','workers/auth/src/lib/canvas-merge-selection.js','workers/auth/migrations/0100_canvas_asset_audio_exports.sql','services/homepage-ffmpeg-processor/canvas-full-video.mjs','js/shared/omni-reference-upload.js'];
 const selected=selectCiTests(files);assert.equal(selected.policy,'canvas-audio-v1');
 for(const key of ['canvasAudio','canvasText','workers','auth','static','runtime'])assert.equal(selected[key],true);
 for(const key of ['homepage','carousel','dependencies','full'])assert.equal(selected[key],false);
 for(const file of ['workers/auth/src/lib/billing.js','workers/ai/src/routes/video-task.js','workers/auth/src/lib/member-generation-jobs.js','unknown.js'])assert.notEqual(selectCiTests([...files,file]).canvasAudio,true);
 assert.notEqual(selectCiTests(files,{forceFull:true}).canvasAudio,true);
}
