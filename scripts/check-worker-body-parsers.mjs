import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SCAN_DIRS = [
  "workers/auth/src",
  "workers/ai/src",
  "workers/contact/src",
];

const FORBIDDEN_PATTERN = /\brequest\.(json|formData|text|arrayBuffer)\s*\(/g;

function walkFiles(dir) {
  const absolute = path.join(repoRoot, dir);
  const out = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(path.relative(repoRoot, child)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(path.relative(repoRoot, child).replace(/\\/g, "/"));
    }
  }
  return out;
}

const violations = [];
for (const file of SCAN_DIRS.flatMap(walkFiles)) {
  const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
  for (const match of source.matchAll(FORBIDDEN_PATTERN)) {
    const before = source.slice(0, match.index);
    const line = before.split("\n").length;
    violations.push(`${file}:${line}: direct ${match[0]} usage; use bounded request-body helpers first`);
  }
}

if (violations.length > 0) {
  console.error("Unsafe direct Worker body parser calls found:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Worker body parser guard passed.");
