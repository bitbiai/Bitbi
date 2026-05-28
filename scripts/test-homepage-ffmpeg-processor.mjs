import assert from "node:assert/strict";
import { ensureStreamDownloadReady } from "../services/homepage-ffmpeg-processor/processor.mjs";

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

async function testDownloadReadyPolling() {
  const calls = [];
  const responses = [
    jsonResponse({ success: true, result: { default: { status: "queued" } } }),
    jsonResponse({ success: true, result: { default: { status: "processing", percentComplete: 40 } } }),
    jsonResponse({ success: true, result: { default: { status: "ready", percentComplete: 100, url: "https://customer-test.cloudflarestream.com/streamuid/downloads/default.mp4" } } }),
  ];
  const result = await ensureStreamDownloadReady("streamuid", {
    accountId: "account",
    apiToken: "token",
    pollIntervalMs: 1,
    maxWaitMs: 5,
    sleepImpl: async () => {},
    fetchImpl: async (_url, init = {}) => {
      calls.push(init.method || "GET");
      return responses.shift();
    },
  });
  assert.deepEqual(calls, ["POST", "GET", "GET"]);
  assert.equal(result.status, "ready");
  assert.equal(result.url, "https://customer-test.cloudflarestream.com/streamuid/downloads/default.mp4");
  assert.equal(result.percent_complete, 100);
}

async function testAlreadyInProgressPostFailureContinuesWithGetState() {
  const calls = [];
  const responses = [
    jsonResponse({ success: false, errors: [{ message: "download already in progress" }] }, { status: 409 }),
    jsonResponse({ success: true, result: { default: { status: "processing", percentComplete: 20 } } }),
    jsonResponse({ success: true, result: { default: { status: "ready", url: "https://videodelivery.net/streamuid/downloads/default.mp4" } } }),
  ];
  const result = await ensureStreamDownloadReady("streamuid", {
    accountId: "account",
    apiToken: "token",
    pollIntervalMs: 1,
    maxWaitMs: 5,
    sleepImpl: async () => {},
    fetchImpl: async (_url, init = {}) => {
      calls.push(init.method || "GET");
      return responses.shift();
    },
  });
  assert.deepEqual(calls, ["POST", "GET", "GET"]);
  assert.equal(result.url, "https://videodelivery.net/streamuid/downloads/default.mp4");
}

async function testDownloadTimeoutUsesSanitizedCode() {
  await assert.rejects(
    () => ensureStreamDownloadReady("streamuid", {
      accountId: "account",
      apiToken: "token",
      pollIntervalMs: 1,
      maxWaitMs: 1,
      sleepImpl: async () => {},
      fetchImpl: async () => jsonResponse({ success: true, result: { default: { status: "processing", percentComplete: 50 } } }),
    }),
    (error) => {
      assert.equal(error.code, "cloudflare_stream_download_not_ready");
      assert.equal(error.downloadState.status, "processing");
      return true;
    }
  );
}

await testDownloadReadyPolling();
await testAlreadyInProgressPostFailureContinuesWithGetState();
await testDownloadTimeoutUsesSanitizedCode();

console.log("homepage ffmpeg processor tests passed");
