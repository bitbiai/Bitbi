import assert from "node:assert/strict";
import {
  convertJob,
  convertSourcePosterJob,
  createWebpPoster,
  detectFfmpegWebpEncoderFromOutput,
  detectFfmpegWebpEncoderNameFromOutput,
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

async function testFfmpegWebpEncoderDetection() {
  assert.equal(detectFfmpegWebpEncoderFromOutput(" V..... libwebp             libwebp WebP image (codec webp)"), true);
  assert.equal(detectFfmpegWebpEncoderFromOutput(" V..... libx264             libx264 H.264 / AVC"), false);
  assert.equal(detectFfmpegWebpEncoderNameFromOutput([
    " V..... libwebp_anim        libwebp animated WebP image (codec webp)",
    " V..... libwebp             libwebp WebP image (codec webp)",
  ].join("\n")), "libwebp");
}

async function testPosterUsesFfmpegWebpWhenAvailable() {
  const calls = [];
  const result = await createWebpPoster({
    input: "/tmp/input.mp4",
    poster: "/tmp/poster.webp",
    posterWidth: 640,
    dir: "/tmp",
    ffmpegBin: "ffmpeg-test",
    cwebpBin: "cwebp-test",
    capabilities: { ffmpegWebpEncoderAvailable: true, cwebpAvailable: false },
    runImpl: async (command, args) => {
      calls.push({ command, args });
      return { stdout: "", stderr: "" };
    },
  });
  assert.equal(result.encoder, "ffmpeg_webp");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "ffmpeg-test");
  assert(calls[0].args.includes("/tmp/poster.webp"));
  assert(calls[0].args.includes("-c:v"));
  assert(calls[0].args.includes("libwebp"));
}

async function testPosterFallsBackToPngPlusCwebp() {
  const calls = [];
  const result = await createWebpPoster({
    input: "/tmp/input.mp4",
    poster: "/tmp/poster.webp",
    posterWidth: 640,
    dir: "/tmp",
    ffmpegBin: "ffmpeg-test",
    cwebpBin: "cwebp-test",
    capabilities: { ffmpegWebpEncoderAvailable: false, cwebpAvailable: true },
    runImpl: async (command, args) => {
      calls.push({ command, args });
      return { stdout: "", stderr: "" };
    },
  });
  assert.equal(result.encoder, "cwebp");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, "ffmpeg-test");
  assert(calls[0].args.includes("-update"));
  assert(calls[0].args.includes("-c:v"));
  assert(calls[0].args.includes("png"));
  assert(calls[0].args.includes("/tmp/poster.png"));
  assert.equal(calls[1].command, "cwebp-test");
  assert.deepEqual(calls[1].args.slice(0, 2), ["-q", "82"]);
  assert(calls[1].args.includes("/tmp/poster.webp"));
}

async function testPosterFailsClearlyWithoutWebpEncoder() {
  await assert.rejects(
    () => createWebpPoster({
      input: "/tmp/input.mp4",
      poster: "/tmp/poster.webp",
      posterWidth: 640,
      dir: "/tmp",
      capabilities: { ffmpegWebpEncoderAvailable: false, cwebpAvailable: false },
      runImpl: async () => {
        throw new Error("run should not be called");
      },
    }),
    (error) => {
      assert.equal(error.code, "webp_poster_encoder_unavailable");
      assert.equal(error.message, "No WebP poster encoder available. Install cwebp or build ffmpeg with WebP encoder support.");
      return true;
    }
  );
}

async function testHeroAndSourcePosterJobsUseSharedPosterFallback() {
  const heroPosterCalls = [];
  const hero = await convertJob({ id: "hero-job", source: {}, preset: { posterWidth: 720 } }, "/tmp/hero-dir", {
    downloadSourceImpl: async (job, destination) => {
      assert.equal(job.id, "hero-job");
      assert.equal(destination, "/tmp/hero-dir/source");
    },
    runImpl: async (command, args) => {
      assert.equal(command, "ffmpeg");
      assert(args.some((arg) => String(arg).endsWith("/hero.mp4")));
      return { stdout: "", stderr: "" };
    },
    createWebpPosterImpl: async (params) => {
      heroPosterCalls.push(params);
      return { poster: params.poster, encoder: "cwebp" };
    },
    probeVideoImpl: async () => ({ width: 720, height: 406, duration_seconds: 8, fps: 24 }),
  });
  assert.equal(hero.poster, "/tmp/hero-dir/poster.webp");
  assert.equal(hero.metadata.poster_encoder, "cwebp");
  assert.equal(heroPosterCalls[0].posterWidth, 720);

  const sourcePosterCalls = [];
  const sourcePoster = await convertSourcePosterJob({ id: "source-poster-job", source: {}, preset: { posterWidth: 480 } }, "/tmp/source-dir", {
    downloadSourceImpl: async (job, destination) => {
      assert.equal(job.id, "source-poster-job");
      assert.equal(destination, "/tmp/source-dir/source");
    },
    createWebpPosterImpl: async (params) => {
      sourcePosterCalls.push(params);
      return { poster: params.poster, encoder: "cwebp" };
    },
  });
  assert.equal(sourcePoster.poster, "/tmp/source-dir/source-poster.webp");
  assert.equal(sourcePoster.poster_encoder, "cwebp");
  assert.equal(sourcePosterCalls[0].posterWidth, 480);
}

async function testPosterProcessErrorsIncludeStderrDiagnostics() {
  await assert.rejects(
    () => createWebpPoster({
      input: "/tmp/input.mp4",
      poster: "/tmp/poster.webp",
      posterWidth: 640,
      dir: "/tmp",
      capabilities: { ffmpegWebpEncoderAvailable: false, cwebpAvailable: true },
      runImpl: async (command) => {
        const error = new Error(`${command} exited with 8: Encoder not found`);
        error.stderr = "Default encoder for format webp is probably disabled. Encoder not found.";
        throw error;
      },
    }),
    (error) => {
      assert(error.message.includes("Encoder not found"));
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
await testFfmpegWebpEncoderDetection();
await testPosterUsesFfmpegWebpWhenAvailable();
await testPosterFallsBackToPngPlusCwebp();
await testPosterFailsClearlyWithoutWebpEncoder();
await testHeroAndSourcePosterJobsUseSharedPosterFallback();
await testPosterProcessErrorsIncludeStderrDiagnostics();

console.log("homepage ffmpeg processor tests passed");
