import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createReleasePlanFromRepo,
  formatReleasePlan,
  formatReleaseUsage,
  parseReleaseCliArgs,
} from "./lib/release-plan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

try {
  const options = parseReleaseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(formatReleaseUsage("npm run release:plan --"));
    process.exit(0);
  }

  const plan = createReleasePlanFromRepo(repoRoot, options);
  if (!options.jsonOnly) {
    console.log(formatReleasePlan(plan));
    console.log("\nJSON plan:");
  }
  console.log(JSON.stringify(plan, null, 2));
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
