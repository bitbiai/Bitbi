import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyPricingStaticRegions } from "./lib/pricing-static-html.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
applyPricingStaticRegions(repoRoot);
console.log("Pricing pages refreshed from the live credit pack catalog.");
