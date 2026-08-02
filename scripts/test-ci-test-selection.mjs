import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectCiTests } from "./lib/ci-test-selection.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function selection(files, options) {
  return selectCiTests(files, options);
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
  assert(workflow.includes("npm run check:worker-dependency-audits"));
}

{
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/ui-fast-deploy.yml"), "utf8");
  assert(workflow.includes("node scripts/select-ci-tests.mjs"));
  assert(workflow.includes("needs.guard.outputs.carousel == 'true'"));
  assert(workflow.includes("npm run test:homepage-core"));
  assert(workflow.includes("npm run test:homepage-carousel"));
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
