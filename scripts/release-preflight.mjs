import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatReleasePlan,
  formatReleaseUsage,
  parseReleaseCliArgs,
  runReleasePreflight,
} from "./lib/release-plan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

try {
  const options = parseReleaseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(formatReleaseUsage("npm run release:preflight --"));
    process.exit(0);
  }

  const result = runReleasePreflight(repoRoot, options);
  console.log(formatReleasePlan(result.plan));

  if (!result.ok) {
    console.error("\nRelease preflight failed:");
    for (const issue of result.issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log("\nRelease preflight passed.");
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
