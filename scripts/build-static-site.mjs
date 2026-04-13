import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStaticSite,
  generateAssetVersionToken,
  loadAssetVersionManifest,
} from "./lib/asset-version.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const manifest = loadAssetVersionManifest(repoRoot);
const placeholder = manifest.assetVersion.placeholder;
const versionToken = generateAssetVersionToken();
const outDir = path.join(repoRoot, "_site");

buildStaticSite(repoRoot, {
  outDir,
  placeholder,
  versionToken,
});

console.log(`Static site built to ${path.relative(repoRoot, outDir)} with asset version ${versionToken}.`);
