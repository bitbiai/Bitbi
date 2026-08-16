/*
 * Narrow file ownership for the direct-main Pages fast path.
 *
 * The workflow path filters are intentionally duplicated by GitHub Actions
 * configuration. Keep them aligned with FAST_DEPLOY_WORKFLOW_PATHS and cover
 * that alignment in scripts/test-ci-test-selection.mjs.
 */

export const MEMBER_MODEL_FAST_DEPLOY_PATHS = Object.freeze([
  "js/shared/member-model-exposure.mjs",
  "js/shared/models-overlay.js",
  "tests/locale.spec.js",
  "tests/smoke.spec.js",
]);

export const FAST_DEPLOY_WORKFLOW_PATHS = Object.freeze([
  "index.html",
  "de/index.html",
  "css/pages/index.css",
  "css/base/**",
  "css/components/**",
  "js/pages/index/**",
  "assets/images/**",
  "assets/favicons/**",
  "fonts/**",
  ...MEMBER_MODEL_FAST_DEPLOY_PATHS,
]);

const FAST_DEPLOY_PREFIXES = Object.freeze(
  FAST_DEPLOY_WORKFLOW_PATHS
    .filter((entry) => entry.endsWith("/**"))
    .map((entry) => entry.slice(0, -2)),
);

const FAST_DEPLOY_EXACT_PATHS = new Set(
  FAST_DEPLOY_WORKFLOW_PATHS.filter((entry) => !entry.endsWith("/**")),
);

const MEMBER_MODEL_FAST_DEPLOY_PATH_SET = new Set(MEMBER_MODEL_FAST_DEPLOY_PATHS);

export function isFastDeploySafePath(file) {
  const normalized = String(file || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  return FAST_DEPLOY_EXACT_PATHS.has(normalized)
    || FAST_DEPLOY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function isMemberModelFastDeployPath(file) {
  const normalized = String(file || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  return MEMBER_MODEL_FAST_DEPLOY_PATH_SET.has(normalized);
}
