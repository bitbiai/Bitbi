import process from "node:process";
import { isFastDeploySafePath } from "./lib/fast-deploy-paths.mjs";

const files = process.argv.slice(2).map((file) => String(file || "").trim()).filter(Boolean);
const blocked = files.filter((file) => !isFastDeploySafePath(file));

if (blocked.length > 0) {
  console.error(blocked.join("\n"));
  process.exit(1);
}
