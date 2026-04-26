import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOperationalReadinessCli } from "./lib/operational-readiness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

process.exitCode = runOperationalReadinessCli({ repoRoot });
