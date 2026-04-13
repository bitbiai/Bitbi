import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectAssetVersionSourceFiles,
  loadAssetVersionManifest,
  validateAssetVersionSources,
} from "./lib/asset-version.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const manifest = loadAssetVersionManifest(repoRoot);
const placeholder = manifest.assetVersion.placeholder;
const files = Object.fromEntries(
  collectAssetVersionSourceFiles(repoRoot).map((relativePath) => [
    relativePath,
    fs.readFileSync(path.join(repoRoot, relativePath), "utf8"),
  ])
);

const issues = validateAssetVersionSources({ files, placeholder });
if (issues.length > 0) {
  console.error("Asset version validation failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Asset version validation passed.");
