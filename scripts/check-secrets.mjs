import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepoForSecrets } from "./lib/quality-gates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const violations = scanRepoForSecrets(repoRoot);

if (violations.length > 0) {
  console.error("Potential committed secrets found:");
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line}: ${violation.rule}`);
  }
  process.exit(1);
}

console.log("Secret leakage guard passed.");
