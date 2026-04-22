import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLiveRuntimeCanaryPlan,
  runLiveRuntimeCanaryPlan,
} from "./lib/live-runtime-canary.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const plan = createLiveRuntimeCanaryPlan({
  repoRoot,
  env: process.env,
});

if (!plan.enabled) {
  console.log(
    "Live runtime canary skipped. Set BITBI_LIVE_ENABLE=1 to run deployed checks. " +
      "Optional read-only suites accept BITBI_LIVE_MEMBER_SESSION or BITBI_LIVE_MEMBER_COOKIE, " +
      "plus BITBI_LIVE_ADMIN_SESSION or BITBI_LIVE_ADMIN_COOKIE."
  );
  process.exit(0);
}

const result = await runLiveRuntimeCanaryPlan(plan);

if (result.failed.length > 0) {
  console.error("Live runtime canary failed:");
  for (const failure of result.failed) {
    console.error(`- [${failure.suite}] ${failure.id}: ${failure.message}`);
  }
  process.exit(1);
}

console.log(
  `Live runtime canary passed. ` +
    `${result.passed.length} checks passed, ${result.skipped.length} suite(s) skipped.`
);
