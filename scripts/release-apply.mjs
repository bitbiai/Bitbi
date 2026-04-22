import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatReleasePlan,
  formatReleaseUsage,
  parseReleaseCliArgs,
  runReleaseApply,
} from "./lib/release-plan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

try {
  const options = parseReleaseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(formatReleaseUsage("npm run release:apply --"));
    process.exit(0);
  }

  const result = runReleaseApply(repoRoot, options);
  console.log(formatReleasePlan(result.plan));

  if (!result.ok) {
    console.error("\nRelease apply failed:");
    for (const issue of result.issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  if (result.dryRun) {
    console.log("\nDry run only. Planned worker-side commands:");
    if (result.executions.length === 0) {
      console.log("- No worker-side commands would run.");
    } else {
      for (const execution of result.executions) {
        console.log(`- ${execution.pretty}`);
      }
    }
    console.log("\nNothing was executed. Re-run with --execute to apply worker-side steps.");
    process.exit(0);
  }

  console.log("\nRelease apply completed.");
  if (result.plan.remainingManualSteps.length > 0) {
    console.log("Remaining manual steps:");
    for (const step of result.plan.remainingManualSteps) {
      console.log(`- ${step}`);
    }
  }
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
