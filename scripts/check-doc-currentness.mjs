#!/usr/bin/env node

import { scanDocCurrentness } from "./lib/doc-currentness.mjs";

const repoRoot = process.cwd();
const result = scanDocCurrentness(repoRoot);

console.log(`Doc currentness check: release latest auth migration is ${result.latest}`);
console.log(`Doc currentness check: scanned ${result.scannedDocs.length} current source-of-truth document(s).`);
if (result.markdownInventory?.length) {
  console.log(`Doc currentness check: inventoried ${result.markdownInventory.length} first-party Markdown file(s).`);
  for (const [category, count] of Object.entries(result.categoryCounts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`- ${category}: ${count}`);
  }
}

if (result.violations.length > 0) {
  console.error("Doc currentness check failed.");
  for (const violation of result.violations) {
    const location = violation.line ? `${violation.file}:${violation.line}` : violation.file;
    console.error(`- ${location} [${violation.rule}] ${violation.message}`);
    if (violation.excerpt) {
      console.error(`  ${violation.excerpt}`);
    }
  }
  process.exit(1);
}

console.log("Doc currentness check passed.");
