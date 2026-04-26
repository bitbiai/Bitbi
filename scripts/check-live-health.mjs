import { runLiveHealthCli } from "./lib/operational-readiness.mjs";

process.exitCode = await runLiveHealthCli();
