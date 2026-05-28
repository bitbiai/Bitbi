import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE_URL = String(process.env.AUTH_WORKER_BASE_URL || "").replace(/\/+$/, "");
const SECRET = String(process.env.HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET
  || process.env.HOMEPAGE_HERO_PROCESSOR_SECRET
  || process.env.MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET
  || "");
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const PROCESS_HOMEPAGE_HERO = process.env.PROCESS_HOMEPAGE_HERO !== "0" && process.env.PROCESS_HOMEPAGE_HERO !== "false";
const PROCESS_HOMEPAGE_SOURCE_POSTERS = process.env.PROCESS_HOMEPAGE_SOURCE_POSTERS !== "0" && process.env.PROCESS_HOMEPAGE_SOURCE_POSTERS !== "false";
const PROCESS_MEMVID_STREAM_PREVIEWS = process.env.PROCESS_MEMVID_STREAM_PREVIEWS === "1" || process.env.PROCESS_MEMVID_STREAM_PREVIEWS === "true";
const REPAIR_MEMVID_STREAM_DOWNLOADS = process.env.REPAIR_MEMVID_STREAM_DOWNLOADS === "1" || process.env.REPAIR_MEMVID_STREAM_DOWNLOADS === "true";
const JOB_LIMIT = Math.max(1, Math.min(8, Number.parseInt(process.env.JOB_LIMIT || "1", 10) || 1));
const WORK_DIR = process.env.WORK_DIR || tmpdir();
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_BIN || "ffprobe";
const STREAM_ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || process.env.STREAM_ACCOUNT_ID || "");
const STREAM_API_TOKEN = String(process.env.CLOUDFLARE_STREAM_API_TOKEN || process.env.STREAM_API_TOKEN || "");
const STREAM_DOWNLOAD_POLL_INTERVAL_MS = Math.max(1000, Math.min(30000, Number.parseInt(process.env.STREAM_DOWNLOAD_POLL_INTERVAL_MS || "5000", 10) || 5000));
const STREAM_DOWNLOAD_MAX_WAIT_MS = Math.max(30000, Math.min(900000, Number.parseInt(process.env.STREAM_DOWNLOAD_MAX_WAIT_MS || "300000", 10) || 300000));
const ENCODER_PRESETS = new Set(["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower"]);

function assertConfig() {
  if (!BASE_URL) throw new Error("AUTH_WORKER_BASE_URL is required.");
  if (!SECRET) throw new Error("HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET is required.");
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${SECRET}`,
    ...extra,
  };
}

async function requestJson(pathname, init = {}) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) {
    const error = new Error(body?.error || `HTTP ${res.status}`);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body;
}

function run(command, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stderr });
        return;
      }
      const error = new Error(`${command} exited with ${code}`);
      error.stderr = stderr;
      reject(error);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeProcessorErrorCode(value, fallback = "cloudflare_stream_preview_failed") {
  const normalized = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .slice(0, 80);
  return normalized || fallback;
}

async function probeVideo(filePath) {
  try {
    const output = await new Promise((resolve, reject) => {
      const args = [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,duration",
        "-of", "json",
        filePath,
      ];
      const child = spawn(FFPROBE_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr || `ffprobe exited with ${code}`));
      });
    });
    const parsed = JSON.parse(output);
    const stream = parsed.streams?.[0] || {};
    const [fpsNumerator, fpsDenominator] = String(stream.r_frame_rate || "24/1").split("/").map(Number);
    return {
      width: Number(stream.width) || null,
      height: Number(stream.height) || null,
      duration_seconds: Number(stream.duration) || null,
      fps: fpsDenominator ? Math.round((fpsNumerator / fpsDenominator) * 100) / 100 : 24,
    };
  } catch {
    return {
      width: null,
      height: null,
      duration_seconds: 6,
      fps: 24,
    };
  }
}

async function claimJobs() {
  const body = await requestJson("/api/internal/homepage/hero-videos/jobs/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: JOB_LIMIT }),
  });
  return Array.isArray(body?.data?.jobs) ? body.data.jobs : [];
}

async function claimSourcePosterJobs() {
  const body = await requestJson("/api/internal/homepage/hero-videos/source-posters/jobs/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: JOB_LIMIT }),
  });
  return Array.isArray(body?.data?.jobs) ? body.data.jobs : [];
}

async function claimMemvidPreviewJobs() {
  const body = await requestJson("/api/internal/memvid-stream-previews/jobs/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: JOB_LIMIT, repair_downloads: REPAIR_MEMVID_STREAM_DOWNLOADS }),
  });
  return Array.isArray(body?.data?.jobs) ? body.data.jobs : [];
}

async function downloadSource(job, sourcePath) {
  const res = await fetch(`${BASE_URL}${job.source.url}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Source download failed with HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.byteLength) throw new Error("Source download was empty.");
  await writeFile(sourcePath, bytes);
}

function clampNumber(value, { fallback, min, max, integer = true }) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.max(min, Math.min(max, parsed));
  return integer ? Math.round(clamped) : clamped;
}

function normalizeHeroPreset(raw = {}) {
  const preset = raw && typeof raw === "object" ? raw : {};
  const encoderPreset = String(preset.encoderPreset || "slow").toLowerCase();
  return {
    name: String(preset.name || "hero_desktop_mp4_720p_v1").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80),
    maxWidth: clampNumber(preset.maxWidth, { fallback: 720, min: 320, max: 1080 }),
    fps: clampNumber(preset.fps, { fallback: 24, min: 12, max: 30 }),
    durationSeconds: clampNumber(
      preset.durationSeconds ?? preset.maxDurationSeconds,
      { fallback: 8, min: 3, max: 12 }
    ),
    audio: preset.audio === true,
    crf: clampNumber(preset.crf, { fallback: 30, min: 24, max: 36 }),
    encoderPreset: ENCODER_PRESETS.has(encoderPreset) ? encoderPreset : "slow",
    posterWidth: clampNumber(preset.posterWidth, { fallback: 640, min: 320, max: 1080 }),
  };
}

async function convertJob(job, dir) {
  const input = path.join(dir, "source");
  const output = path.join(dir, "hero.mp4");
  const poster = path.join(dir, "poster.webp");
  const preset = normalizeHeroPreset(job.preset);
  await downloadSource(job, input);

  const videoFilter = `scale='min(${preset.maxWidth},iw)':-2,fps=${preset.fps}`;
  await run(FFMPEG_BIN, [
    "-y",
    "-i", input,
    ...(preset.audio ? [] : ["-an"]),
    "-vf", videoFilter,
    "-c:v", "libx264",
    "-preset", preset.encoderPreset,
    "-crf", String(preset.crf),
    "-movflags", "+faststart",
    "-t", String(preset.durationSeconds),
    output,
  ], { cwd: dir });

  await run(FFMPEG_BIN, [
    "-y",
    "-i", input,
    "-vf", `thumbnail,scale=${preset.posterWidth}:-2`,
    "-frames:v", "1",
    poster,
  ], { cwd: dir });

  return {
    input,
    output,
    poster,
    metadata: {
      ...(await probeVideo(output)),
      preset,
    },
  };
}

async function convertSourcePosterJob(job, dir) {
  const input = path.join(dir, "source");
  const poster = path.join(dir, "source-poster.webp");
  await downloadSource(job, input);
  const posterWidth = clampNumber(job.preset?.posterWidth, { fallback: 640, min: 320, max: 1080 });
  await run(FFMPEG_BIN, [
    "-y",
    "-i", input,
    "-vf", `thumbnail,scale=${posterWidth}:-2`,
    "-frames:v", "1",
    poster,
  ], { cwd: dir });
  return {
    poster,
  };
}

async function convertMemvidPreviewJob(job, dir) {
  const input = path.join(dir, "source");
  const output = path.join(dir, "preview.mp4");
  await downloadSource(job, input);
  const maxDuration = Math.max(1, Math.min(8, Number(job.preset?.maxDurationSeconds || 5) || 5));
  await run(FFMPEG_BIN, [
    "-y",
    "-i", input,
    "-an",
    "-vf", "scale='min(720,iw)':-2,fps=24",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "31",
    "-movflags", "+faststart",
    "-t", String(maxDuration),
    output,
  ], { cwd: dir });
  return {
    output,
    metadata: await probeVideo(output),
  };
}

async function uploadPreviewToStream(filePath, job) {
  if (!STREAM_ACCOUNT_ID || !STREAM_API_TOKEN) {
    throw new Error("Cloudflare Stream account/token is required for Memvid previews.");
  }
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "video/mp4" }), `${job.asset_id || job.id}-preview.mp4`);
  form.append("meta", JSON.stringify({
    name: `BITBI Memvid preview ${job.asset_id || job.id}`,
    bitbi_preview_job_id: job.id,
  }));
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(STREAM_ACCOUNT_ID)}/stream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STREAM_API_TOKEN}`,
    },
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    throw new Error(body?.errors?.[0]?.message || `Cloudflare Stream upload failed with HTTP ${res.status}`);
  }
  const uid = body?.result?.uid;
  if (!uid) throw new Error("Cloudflare Stream upload did not return a UID.");
  return {
    uid,
    metadata: body.result,
  };
}

function extractStreamDownloadState(body = {}) {
  const result = body?.result || {};
  const entry = result.default || result.downloads?.default || result;
  return {
    status: String(entry?.status || "").toLowerCase(),
    url: entry?.url || null,
    percent_complete: entry?.percentComplete ?? entry?.pctComplete ?? entry?.percent_complete ?? null,
    raw: entry,
  };
}

function cloudflareApiDetails(body = {}) {
  const parts = [];
  for (const field of ["errors", "messages"]) {
    const rows = Array.isArray(body?.[field]) ? body[field] : [];
    for (const row of rows.slice(0, 3)) {
      const code = String(row?.code || "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 40);
      const message = String(row?.message || "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, 180);
      if (code || message) parts.push(`${field}.${code || "message"}: ${message || "no message"}`);
    }
  }
  return parts.join("; ");
}

function makeCloudflareRequestError({
  phase,
  action,
  status,
  body,
  fallback,
  code = "cloudflare_stream_download_request_failed",
}) {
  const details = cloudflareApiDetails(body);
  const message = [
    `${phase}: ${fallback}`,
    status ? `HTTP ${status}` : null,
    details || null,
  ].filter(Boolean).join(" - ");
  const error = new Error(message);
  error.code = code;
  error.phase = phase;
  error.action = action;
  error.status = status;
  error.body = body;
  return error;
}

function requireStreamApiConfig(phase, { accountId, apiToken }) {
  if (!accountId || !apiToken) {
    const error = new Error("Cloudflare Stream account/token is required for MP4 download preparation.");
    error.code = "cloudflare_stream_not_configured";
    error.phase = phase;
    throw error;
  }
}

function extractStreamVideoState(body = {}) {
  const result = body?.result || body || {};
  const statusObject = result.status && typeof result.status === "object" ? result.status : {};
  const state = String(
    statusObject.state
      || statusObject.status
      || result.state
      || (typeof result.status === "string" ? result.status : "")
      || result.processingStatus
      || ""
  ).toLowerCase();
  const ready = result.readyToStream === true
    || result.ready_to_stream === true
    || ["ready", "complete", "completed", "finished", "success"].includes(state);
  return {
    status: ready ? "ready" : state,
    ready,
    failed: ["failed", "error"].includes(state),
    percent_complete: statusObject.pctComplete
      ?? statusObject.percentComplete
      ?? result.pctComplete
      ?? result.percentComplete
      ?? null,
    raw: result,
  };
}

async function streamVideoRequest(uid, {
  fetchImpl = fetch,
  accountId = STREAM_ACCOUNT_ID,
  apiToken = STREAM_API_TOKEN,
} = {}) {
  requireStreamApiConfig("stream_status_poll", { accountId, apiToken });
  const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/stream/${encodeURIComponent(uid)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    throw makeCloudflareRequestError({
      phase: "stream_status_poll",
      action: "GET /stream/{uid}",
      status: res.status,
      body,
      fallback: "Cloudflare Stream video status request failed.",
    });
  }
  return body || {};
}

async function streamDownloadsRequest(uid, {
  method = "GET",
  fetchImpl = fetch,
  accountId = STREAM_ACCOUNT_ID,
  apiToken = STREAM_API_TOKEN,
} = {}) {
  requireStreamApiConfig(method === "POST" ? "download_create" : "download_poll", { accountId, apiToken });
  const headers = {
    Authorization: `Bearer ${apiToken}`,
  };
  if (method !== "POST") {
    headers.Accept = "application/json";
  }
  const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/stream/${encodeURIComponent(uid)}/downloads`, {
    method,
    headers,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    throw makeCloudflareRequestError({
      phase: method === "POST" ? "download_create" : "download_poll",
      action: `${method} /stream/{uid}/downloads`,
      status: res.status,
      body,
      fallback: `Cloudflare Stream downloads ${method} failed.`,
    });
  }
  return body || {};
}

export async function ensureStreamVideoReady(uid, {
  fetchImpl = fetch,
  accountId = STREAM_ACCOUNT_ID,
  apiToken = STREAM_API_TOKEN,
  pollIntervalMs = STREAM_DOWNLOAD_POLL_INTERVAL_MS,
  maxWaitMs = STREAM_DOWNLOAD_MAX_WAIT_MS,
  sleepImpl = sleep,
} = {}) {
  if (!uid) {
    const error = new Error("Cloudflare Stream UID is required for video readiness polling.");
    error.code = "cloudflare_stream_uid_required";
    error.phase = "stream_status_poll";
    throw error;
  }
  let lastState = null;
  const maxPolls = Math.max(1, Math.ceil(maxWaitMs / Math.max(1, pollIntervalMs)) + 1);
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const state = extractStreamVideoState(
      await streamVideoRequest(uid, { fetchImpl, accountId, apiToken })
    );
    lastState = state;
    if (state.ready) return state;
    if (state.failed) {
      const error = new Error(`stream_status_poll: Cloudflare Stream video processing failed with status ${state.status || "failed"}.`);
      error.code = "cloudflare_stream_download_failed";
      error.phase = "stream_status_poll";
      error.streamState = state;
      throw error;
    }
    if (attempt === maxPolls - 1) break;
    await sleepImpl(pollIntervalMs);
  }
  const error = new Error(`stream_status_poll: Cloudflare Stream video was not ready before the timeout. Last status: ${lastState?.status || "unknown"}.`);
  error.code = "cloudflare_stream_video_not_ready";
  error.phase = "stream_status_poll";
  error.streamState = lastState;
  throw error;
}

export async function ensureStreamDownloadReady(uid, {
  fetchImpl = fetch,
  accountId = STREAM_ACCOUNT_ID,
  apiToken = STREAM_API_TOKEN,
  pollIntervalMs = STREAM_DOWNLOAD_POLL_INTERVAL_MS,
  maxWaitMs = STREAM_DOWNLOAD_MAX_WAIT_MS,
  sleepImpl = sleep,
} = {}) {
  if (!uid) {
    const error = new Error("Cloudflare Stream UID is required for MP4 download preparation.");
    error.code = "cloudflare_stream_uid_required";
    error.phase = "download_create";
    throw error;
  }

  let streamState = await ensureStreamVideoReady(uid, {
    fetchImpl,
    accountId,
    apiToken,
    pollIntervalMs,
    maxWaitMs,
    sleepImpl,
  });

  let downloadCreateAccepted = false;
  let lastCreateError = null;
  const maxCreateAttempts = Math.max(1, Math.ceil(maxWaitMs / Math.max(1, pollIntervalMs)) + 1);
  for (let attempt = 0; attempt < maxCreateAttempts; attempt += 1) {
    try {
      await streamDownloadsRequest(uid, { method: "POST", fetchImpl, accountId, apiToken });
      downloadCreateAccepted = true;
      break;
    } catch (error) {
      lastCreateError = error;
      try {
        const stateAfterPostFailure = extractStreamDownloadState(
          await streamDownloadsRequest(uid, { method: "GET", fetchImpl, accountId, apiToken })
        );
        if (stateAfterPostFailure.status) {
          downloadCreateAccepted = true;
          break;
        }
      } catch {}
      if (error.status === 400) {
        streamState = await ensureStreamVideoReady(uid, {
          fetchImpl,
          accountId,
          apiToken,
          pollIntervalMs,
          maxWaitMs,
          sleepImpl,
        });
        if (attempt === maxCreateAttempts - 1) break;
        await sleepImpl(pollIntervalMs);
        continue;
      }
      error.code = error.code || "cloudflare_stream_download_request_failed";
      error.phase = error.phase || "download_create";
      throw error;
    }
  }
  if (!downloadCreateAccepted) {
    const error = lastCreateError || new Error("download_create: Cloudflare Stream MP4 download creation did not succeed.");
    error.code = lastCreateError?.code || "cloudflare_stream_download_request_failed";
    error.phase = lastCreateError?.phase || "download_create";
    throw error;
  }

  let lastState = null;
  const maxPolls = Math.max(1, Math.ceil(maxWaitMs / Math.max(1, pollIntervalMs)) + 1);
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const body = await streamDownloadsRequest(uid, { method: "GET", fetchImpl, accountId, apiToken });
    const state = extractStreamDownloadState(body);
    lastState = state;
    if (state.status === "ready" && state.url) {
      return {
        status: "ready",
        url: state.url,
        percent_complete: state.percent_complete,
        stream_status: streamState?.status || null,
        stream_percent_complete: streamState?.percent_complete ?? null,
        raw: state.raw,
      };
    }
    if (state.status === "failed" || state.status === "error") {
      const error = new Error("download_poll: Cloudflare Stream MP4 download generation failed.");
      error.code = "cloudflare_stream_download_failed";
      error.phase = "download_poll";
      error.downloadState = state;
      throw error;
    }
    if (attempt === maxPolls - 1) break;
    await sleepImpl(pollIntervalMs);
  }
  const error = new Error(`download_poll: Cloudflare Stream MP4 download was not ready before the timeout. Last status: ${lastState?.status || "unknown"}.`);
  error.code = "cloudflare_stream_download_not_ready";
  error.phase = "download_poll";
  error.downloadState = lastState;
  throw error;
}

async function completeJob(job, result) {
  const form = new FormData();
  const videoBytes = await readFile(result.output);
  const posterBytes = await readFile(result.poster);
  form.append("file", new Blob([videoBytes], { type: "video/mp4" }), "hero.mp4");
  form.append("poster", new Blob([posterBytes], { type: "image/webp" }), "poster.webp");
  form.append("width", String(result.metadata.width || ""));
  form.append("height", String(result.metadata.height || ""));
  form.append("duration_seconds", String(result.metadata.duration_seconds || 6));
  form.append("fps", String(result.metadata.fps || 24));
  if (job.source?.fingerprint) form.append("source_fingerprint", job.source.fingerprint);
  form.append("metadata_json", JSON.stringify({
    processor: "services/homepage-ffmpeg-processor",
    preset: result.metadata.preset || normalizeHeroPreset(job.preset),
  }));

  const res = await fetch(`${BASE_URL}${job.completion.url}`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `Completion failed with HTTP ${res.status}`);
  return body;
}

async function failJob(job, error) {
  await requestJson(job.completion.failure_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      error_code: "external_ffmpeg_failed",
      error_message: String(error?.message || error || "ffmpeg failed").slice(0, 240),
    }),
  }).catch((callbackError) => {
    console.error(`Failed to report job failure for ${job.id}:`, callbackError.message);
  });
}

async function completeSourcePosterJob(job, result) {
  const form = new FormData();
  const posterBytes = await readFile(result.poster);
  form.append("poster", new Blob([posterBytes], { type: "image/webp" }), "poster.webp");
  if (job.source?.fingerprint) form.append("source_fingerprint", job.source.fingerprint);
  const res = await fetch(`${BASE_URL}${job.completion.url}`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `Source poster completion failed with HTTP ${res.status}`);
  return body;
}

async function failSourcePosterJob(job, error) {
  await requestJson(job.completion.failure_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      error_code: "source_poster_external_ffmpeg_failed",
      error_message: String(error?.message || error || "source poster ffmpeg failed").slice(0, 240),
    }),
  }).catch((callbackError) => {
    console.error(`Failed to report source-poster job failure for ${job.id}:`, callbackError.message);
  });
}

async function completeMemvidPreviewJob(job, result, streamResult) {
  const download = streamResult.download || {};
  return requestJson(job.completion.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stream_uid: streamResult.uid,
      preview_duration_seconds: Math.min(
        Number(job.preset?.maxDurationSeconds || 5) || 5,
        Number(result.metadata.duration_seconds || job.preset?.maxDurationSeconds || 5) || 5
      ),
      max_loop_count: Math.min(3, Number(job.preset?.maxLoopCount || 3) || 3),
      source_fingerprint: job.source?.fingerprint || null,
      provider_metadata: {
        stream_status: download.stream_status || streamResult.metadata?.status || null,
        uploaded: streamResult.metadata?.uploaded || null,
        download_status: download.status || null,
        download_url: download.url || null,
        download_percent_complete: download.percent_complete ?? null,
        cloudflare_stream_video_status: download.stream_status || null,
        cloudflare_stream_video_percent_complete: download.stream_percent_complete ?? null,
        cloudflare_stream_download_status: download.status || null,
        cloudflare_stream_download_url: download.url || null,
        cloudflare_stream_download_percent_complete: download.percent_complete ?? null,
        cloudflare_stream_download_checked_at: new Date().toISOString(),
      },
    }),
  });
}

async function failMemvidPreviewJob(job, error) {
  await requestJson(job.completion.failure_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      error_code: sanitizeProcessorErrorCode(error?.code),
      error_message: String(error?.message || error || "Stream preview failed").slice(0, 240),
    }),
  }).catch((callbackError) => {
    console.error(`Failed to report Stream preview failure for ${job.id}:`, callbackError.message);
  });
}

async function processJob(job) {
  console.log(`Processing homepage hero derivative job ${job.id} (${job.slot})`);
  if (DRY_RUN) {
    console.log(JSON.stringify({ dryRun: true, job }, null, 2));
    return;
  }
  await mkdir(WORK_DIR, { recursive: true });
  const dir = await mkdtemp(path.join(WORK_DIR, `bitbi-hero-${job.id}-`));
  try {
    const result = await convertJob(job, dir);
    await completeJob(job, result);
    console.log(`Completed homepage hero derivative job ${job.id}`);
  } catch (error) {
    console.error(`Failed homepage hero derivative job ${job.id}:`, error.message);
    await failJob(job, error);
    process.exitCode = 1;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function processSourcePosterJob(job) {
  console.log(`Processing homepage hero source-poster job ${job.id}`);
  if (DRY_RUN) {
    console.log(JSON.stringify({ dryRun: true, sourcePosterJob: job }, null, 2));
    return;
  }
  await mkdir(WORK_DIR, { recursive: true });
  const dir = await mkdtemp(path.join(WORK_DIR, `bitbi-hero-source-poster-${job.id}-`));
  try {
    const result = await convertSourcePosterJob(job, dir);
    await completeSourcePosterJob(job, result);
    console.log(`Completed homepage hero source-poster job ${job.id}`);
  } catch (error) {
    console.error(`Failed homepage hero source-poster job ${job.id}:`, error.message);
    await failSourcePosterJob(job, error);
    process.exitCode = 1;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function processMemvidPreviewJob(job) {
  console.log(`Processing Memvid Stream preview job ${job.id} (${job.asset_id})`);
  if (DRY_RUN) {
    console.log(JSON.stringify({ dryRun: true, streamPreviewJob: job }, null, 2));
    return;
  }
  if (job.repair_download && job.stream_uid) {
    try {
      const download = await ensureStreamDownloadReady(job.stream_uid);
      await completeMemvidPreviewJob(job, { metadata: {} }, {
        uid: job.stream_uid,
        metadata: { status: "ready", uploaded: null },
        download,
      });
      console.log(`Repaired Memvid Stream download metadata for job ${job.id}`);
    } catch (error) {
      console.error(`Failed Memvid Stream download repair for ${job.id}:`, error.message);
      await failMemvidPreviewJob(job, error);
      process.exitCode = 1;
    }
    return;
  }
  await mkdir(WORK_DIR, { recursive: true });
  const dir = await mkdtemp(path.join(WORK_DIR, `bitbi-memvid-preview-${job.id}-`));
  try {
    const result = await convertMemvidPreviewJob(job, dir);
    const streamResult = await uploadPreviewToStream(result.output, job);
    streamResult.download = await ensureStreamDownloadReady(streamResult.uid);
    await completeMemvidPreviewJob(job, result, streamResult);
    console.log(`Completed Memvid Stream preview job ${job.id}`);
  } catch (error) {
    console.error(`Failed Memvid Stream preview job ${job.id}:`, error.message);
    await failMemvidPreviewJob(job, error);
    process.exitCode = 1;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  assertConfig();
  if (PROCESS_HOMEPAGE_HERO) {
    const jobs = await claimJobs();
    if (!jobs.length) {
      console.log("No homepage hero derivative jobs available.");
    }
    for (const job of jobs) {
      await processJob(job);
    }
  }
  if (PROCESS_HOMEPAGE_SOURCE_POSTERS) {
    const sourcePosterJobs = await claimSourcePosterJobs();
    if (!sourcePosterJobs.length) {
      console.log("No homepage hero source-poster jobs available.");
    }
    for (const job of sourcePosterJobs) {
      await processSourcePosterJob(job);
    }
  }
  if (PROCESS_MEMVID_STREAM_PREVIEWS) {
    const previewJobs = await claimMemvidPreviewJobs();
    for (const job of previewJobs) {
      await processMemvidPreviewJob(job);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
