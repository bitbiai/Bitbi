import assert from "node:assert/strict";
import {
  ensureStreamDownloadReady,
  ensureStreamVideoReady,
} from "../services/homepage-ffmpeg-processor/processor.mjs";

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

async function testDownloadReadyPolling() {
  const calls = [];
  const downloadStates = [
    jsonResponse({ success: true, result: { default: { status: "processing", percentComplete: 40 } } }),
    jsonResponse({ success: true, result: { default: { status: "ready", percentComplete: 100, url: "https://customer-test.cloudflarestream.com/streamuid/downloads/default.mp4" } } }),
  ];
  const result = await ensureStreamDownloadReady("streamuid", {
    accountId: "account",
    apiToken: "token",
    pollIntervalMs: 1,
    maxWaitMs: 5,
    sleepImpl: async () => {},
    fetchImpl: async (url, init = {}) => {
      const method = init.method || "GET";
      const pathname = new URL(url).pathname;
      calls.push(`${method} ${pathname.endsWith("/downloads") ? "downloads" : "stream"}`);
      if (method === "GET" && !pathname.endsWith("/downloads")) {
        return jsonResponse({ success: true, result: { status: { state: "ready", pctComplete: 100 }, readyToStream: true } });
      }
      if (method === "POST") {
        assert.equal(init.body, undefined);
        assert.equal(Object.keys(init.headers || {}).some((key) => key.toLowerCase() === "content-type"), false);
        assert.equal(Object.keys(init.headers || {}).sort().join(","), "Authorization");
        return jsonResponse({ success: true, result: {} });
      }
      return downloadStates.shift();
    },
  });
  assert.deepEqual(calls, ["GET stream", "POST downloads", "GET downloads", "GET downloads"]);
  assert.equal(result.status, "ready");
  assert.equal(result.url, "https://customer-test.cloudflarestream.com/streamuid/downloads/default.mp4");
  assert.equal(result.percent_complete, 100);
  assert.equal(result.stream_status, "ready");
}

async function testAlreadyInProgressPostFailureContinuesWithGetState() {
  const calls = [];
  const downloadStates = [
    jsonResponse({ success: true, result: { default: { status: "processing", percentComplete: 20 } } }),
    jsonResponse({ success: true, result: { default: { status: "ready", url: "https://videodelivery.net/streamuid/downloads/default.mp4" } } }),
  ];
  const result = await ensureStreamDownloadReady("streamuid", {
    accountId: "account",
    apiToken: "token",
    pollIntervalMs: 1,
    maxWaitMs: 5,
    sleepImpl: async () => {},
    fetchImpl: async (url, init = {}) => {
      const method = init.method || "GET";
      const pathname = new URL(url).pathname;
      calls.push(`${method} ${pathname.endsWith("/downloads") ? "downloads" : "stream"}`);
      if (method === "GET" && !pathname.endsWith("/downloads")) {
        return jsonResponse({ success: true, result: { status: { state: "ready" }, readyToStream: true } });
      }
      if (method === "POST") {
        return jsonResponse({ success: false, errors: [{ message: "download already in progress" }] }, { status: 409 });
      }
      return downloadStates.shift();
    },
  });
  assert.deepEqual(calls, ["GET stream", "POST downloads", "GET downloads", "GET downloads"]);
  assert.equal(result.url, "https://videodelivery.net/streamuid/downloads/default.mp4");
}

async function testDownloadsPost400WaitsForStreamReadyAndRetries() {
  const calls = [];
  const streamStates = [
    { state: "processing", pctComplete: 60 },
    { state: "ready", pctComplete: 100 },
    { state: "processing", pctComplete: 90 },
    { state: "ready", pctComplete: 100 },
  ];
  let postAttempts = 0;
  const result = await ensureStreamDownloadReady("streamuid", {
    accountId: "account",
    apiToken: "token",
    pollIntervalMs: 1,
    maxWaitMs: 10,
    sleepImpl: async () => {},
    fetchImpl: async (url, init = {}) => {
      const method = init.method || "GET";
      const pathname = new URL(url).pathname;
      calls.push(`${method} ${pathname.endsWith("/downloads") ? "downloads" : "stream"}`);
      if (method === "GET" && !pathname.endsWith("/downloads")) {
        const status = streamStates.shift() || { state: "ready", pctComplete: 100 };
        return jsonResponse({ success: true, result: { status, readyToStream: status.state === "ready" } });
      }
      if (method === "POST") {
        postAttempts += 1;
        assert.equal(init.body, undefined);
        assert.equal(Object.keys(init.headers || {}).some((key) => key.toLowerCase() === "content-type"), false);
        assert.equal(Object.keys(init.headers || {}).sort().join(","), "Authorization");
        if (postAttempts === 1) {
          return jsonResponse({
            success: false,
            errors: [{ code: 1002, message: "Bad Request: video is not ready" }],
            messages: [{ code: 2001, message: "try again after processing" }],
          }, { status: 400 });
        }
        return jsonResponse({ success: true, result: {} });
      }
      if (postAttempts === 1) {
        return jsonResponse({ success: true, result: {} });
      }
      return jsonResponse({ success: true, result: { default: { status: "ready", percentComplete: 100, url: "https://customer-test.cloudflarestream.com/streamuid/downloads/default.mp4" } } });
    },
  });
  assert.equal(postAttempts, 2);
  assert(calls.indexOf("GET stream") < calls.indexOf("POST downloads"));
  assert.equal(result.url, "https://customer-test.cloudflarestream.com/streamuid/downloads/default.mp4");
}

async function testDownloadTimeoutUsesSanitizedCode() {
  await assert.rejects(
    () => ensureStreamDownloadReady("streamuid", {
      accountId: "account",
      apiToken: "token",
      pollIntervalMs: 1,
      maxWaitMs: 1,
      sleepImpl: async () => {},
      fetchImpl: async (url) => {
        const pathname = new URL(url).pathname;
        if (!pathname.endsWith("/downloads")) {
          return jsonResponse({ success: true, result: { status: { state: "ready" }, readyToStream: true } });
        }
        return jsonResponse({ success: true, result: { default: { status: "processing", percentComplete: 50 } } });
      },
    }),
    (error) => {
      assert.equal(error.code, "cloudflare_stream_download_not_ready");
      assert.equal(error.phase, "download_poll");
      assert.equal(error.downloadState.status, "processing");
      return true;
    }
  );
}

async function testStreamVideoTimeoutUsesDistinctCode() {
  await assert.rejects(
    () => ensureStreamVideoReady("streamuid", {
      accountId: "account",
      apiToken: "token",
      pollIntervalMs: 1,
      maxWaitMs: 1,
      sleepImpl: async () => {},
      fetchImpl: async () => jsonResponse({ success: true, result: { status: { state: "processing", pctComplete: 40 } } }),
    }),
    (error) => {
      assert.equal(error.code, "cloudflare_stream_video_not_ready");
      assert.equal(error.phase, "stream_status_poll");
      assert.equal(error.streamState.status, "processing");
      return true;
    }
  );
}

async function testCloudflareErrorDetailsAreSanitizedWithPhase() {
  await assert.rejects(
    () => ensureStreamDownloadReady("streamuid", {
      accountId: "account",
      apiToken: "super-secret-test-token",
      pollIntervalMs: 1,
      maxWaitMs: 5,
      sleepImpl: async () => {},
      fetchImpl: async (url, init = {}) => {
        const method = init.method || "GET";
        const pathname = new URL(url).pathname;
        if (method === "GET" && !pathname.endsWith("/downloads")) {
          return jsonResponse({ success: true, result: { status: { state: "ready" }, readyToStream: true } });
        }
        if (method === "POST") {
          return jsonResponse({
            success: false,
            errors: [{ code: 9101, message: "invalid download request" }],
            messages: [{ code: 9202, message: "wait until video ready" }],
          }, { status: 403 });
        }
        return jsonResponse({ success: false, errors: [{ code: 9404, message: "not found" }] }, { status: 404 });
      },
    }),
    (error) => {
      assert.equal(error.code, "cloudflare_stream_download_request_failed");
      assert.equal(error.phase, "download_create");
      assert(error.message.includes("download_create"));
      assert(error.message.includes("9101"));
      assert(error.message.includes("invalid download request"));
      assert(error.message.includes("9202"));
      assert(!error.message.includes("super-secret-test-token"));
      return true;
    }
  );
}

await testDownloadReadyPolling();
await testAlreadyInProgressPostFailureContinuesWithGetState();
await testDownloadsPost400WaitsForStreamReadyAndRetries();
await testDownloadTimeoutUsesSanitizedCode();
await testStreamVideoTimeoutUsesDistinctCode();
await testCloudflareErrorDetailsAreSanitizedWithPhase();

console.log("homepage ffmpeg processor tests passed");
