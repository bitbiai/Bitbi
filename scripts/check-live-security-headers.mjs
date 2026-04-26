import { runSecurityHeadersCli } from "./lib/operational-readiness.mjs";

process.exitCode = await runSecurityHeadersCli();
