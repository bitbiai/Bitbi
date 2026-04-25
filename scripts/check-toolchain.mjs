import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateToolchainFiles } from "./lib/quality-gates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const issues = validateToolchainFiles(repoRoot);

if (issues.length > 0) {
  console.error("Toolchain consistency check failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Toolchain consistency guard passed.");
