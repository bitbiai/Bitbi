import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanDomSinksAgainstBaseline } from "./lib/quality-gates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const baselinePath = path.join(repoRoot, "config/dom-sink-baseline.json");

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const violations = scanDomSinksAgainstBaseline(repoRoot, baseline);

if (violations.length > 0) {
  console.error("Unreviewed DOM sink usage found:");
  for (const violation of violations) {
    console.error(
      `- ${violation.file}: ${violation.sink} count ${violation.count} exceeds baseline ${violation.allowed}`
    );
  }
  console.error("Use textContent, setAttribute, DOM node construction, or update the baseline only after review.");
  process.exit(1);
}

console.log("DOM sink baseline guard passed.");
