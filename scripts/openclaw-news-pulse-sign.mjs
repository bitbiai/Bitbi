#!/usr/bin/env node
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

function usage() {
  const name = basename(process.argv[1] || "openclaw-news-pulse-sign.mjs");
  console.error(`Usage: OPENCLAW_INGEST_SECRET=... node scripts/${name} payload.json [https://bitbi.ai/api/openclaw/news-pulse/ingest]`);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

const payloadPath = process.argv[2];
const endpoint = process.argv[3] || "https://bitbi.ai/api/openclaw/news-pulse/ingest";
const secret = String(process.env.OPENCLAW_INGEST_SECRET || "").trim();
const agent = String(process.env.OPENCLAW_AGENT || "openclaw-mac").trim();
const keyId = String(process.env.OPENCLAW_KEY_ID || "").trim();

if (!payloadPath || !secret) {
  usage();
  process.exit(1);
}

const url = new URL(endpoint);
if (url.protocol !== "https:") {
  console.error("OpenClaw ingest endpoint must use https:");
  process.exit(1);
}

const rawBody = readFileSync(payloadPath, "utf8");
const timestamp = new Date().toISOString();
const nonce = randomBytes(24).toString("hex");
const bodyHash = createHash("sha256").update(rawBody).digest("hex");
const canonical = [
  "POST",
  url.pathname,
  timestamp,
  nonce,
  bodyHash,
].join("\n");
const signature = createHmac("sha256", secret).update(canonical).digest("hex");

const headers = [
  ["Content-Type", "application/json"],
  ["X-OpenClaw-Agent", agent],
  ["X-OpenClaw-Timestamp", timestamp],
  ["X-OpenClaw-Nonce", nonce],
  ["X-OpenClaw-Signature", `sha256=${signature}`],
];
if (keyId) headers.push(["X-OpenClaw-Key-Id", keyId]);

console.log("Body SHA-256:", bodyHash);
console.log("Canonical string:");
console.log(canonical);
console.log("");
console.log("curl command:");
console.log([
  `curl -X POST ${shellQuote(url.href)}`,
  ...headers.map(([key, value]) => `  -H ${shellQuote(`${key}: ${value}`)}`),
  `  --data-binary @${shellQuote(payloadPath)}`,
].join(" \\\n"));
