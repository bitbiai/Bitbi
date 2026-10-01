import path from "node:path";
import { checkWebsiteAssistantKnowledge } from './check-website-assistant-knowledge.mjs';
import './check-website-assistant-contract.mjs';
import { fileURLToPath } from "node:url";
import {
  buildStaticSite,
  generateAssetVersionToken,
  loadAssetVersionManifest,
} from "./lib/asset-version.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
checkWebsiteAssistantKnowledge();
if (process.exitCode) throw new Error('Public assistant knowledge/acceptance inputs require review before building.');
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
