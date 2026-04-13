import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadReleaseCompatibilityContext,
  validateReleaseCompatibility,
} from "./lib/release-compat.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const context = loadReleaseCompatibilityContext(repoRoot);
const issues = validateReleaseCompatibility(context);

if (issues.length > 0) {
  console.error("Release compatibility validation failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Release compatibility validation passed.");
