import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE_URL = String(process.env.AUTH_WORKER_BASE_URL || "").replace(/\/+$/, "");
const SECRET = String(process.env.HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET
  || process.env.HOMEPAGE_HERO_PROCESSOR_SECRET
  || process.env.MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET
  || "");
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const PROCESS_HOMEPAGE_HERO = process.env.PROCESS_HOMEPAGE_HERO !== "0" && process.env.PROCESS_HOMEPAGE_HERO !== "false";
const PROCESS_MEMVID_STREAM_PREVIEWS = process.env.PROCESS_MEMVID_STREAM_PREVIEWS === "1" || process.env.PROCESS_MEMVID_STREAM_PREVIEWS === "true";
const JOB_LIMIT = Math.max(1, Math.min(4, Number.parseInt(process.env.JOB_LIMIT || "1", 10) || 1));
const WORK_DIR = process.env.WORK_DIR || tmpdir();
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_BIN || "ffprobe";
const STREAM_ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || process.env.STREAM_ACCOUNT_ID || "");
const STREAM_API_TOKEN = String(process.env.CLOUDFLARE_STREAM_API_TOKEN || process.env.STREAM_API_TOKEN || "");
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

async function claimMemvidPreviewJobs() {
  const body = await requestJson("/api/internal/memvid-stream-previews/jobs/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: JOB_LIMIT }),
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

async function completeMemvidPreviewJob(job, result, streamResult) {
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
        stream_status: streamResult.metadata?.status || null,
        uploaded: streamResult.metadata?.uploaded || null,
      },
    }),
  });
}

async function failMemvidPreviewJob(job, error) {
  await requestJson(job.completion.failure_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      error_code: "cloudflare_stream_preview_failed",
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

async function processMemvidPreviewJob(job) {
  console.log(`Processing Memvid Stream preview job ${job.id} (${job.asset_id})`);
  if (DRY_RUN) {
    console.log(JSON.stringify({ dryRun: true, streamPreviewJob: job }, null, 2));
    return;
  }
  await mkdir(WORK_DIR, { recursive: true });
  const dir = await mkdtemp(path.join(WORK_DIR, `bitbi-memvid-preview-${job.id}-`));
  try {
    const result = await convertMemvidPreviewJob(job, dir);
    const streamResult = await uploadPreviewToStream(result.output, job);
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
  if (PROCESS_MEMVID_STREAM_PREVIEWS) {
    const previewJobs = await claimMemvidPreviewJobs();
    for (const job of previewJobs) {
      await processMemvidPreviewJob(job);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
