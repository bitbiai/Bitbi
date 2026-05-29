import { nowIso } from "./tokens.js";

const DISPATCH_STATE_SETTING_KEY = "memvid_stream_preview_dispatch_state";
const TRUE_VALUES = new Set(["true", "1", "on", "enabled", "yes"]);
const FALSE_VALUES = new Set(["false", "0", "off", "disabled", "no"]);
const DEFAULT_THRESHOLD = 3;
const DEFAULT_COOLDOWN_SECONDS = 600;
const DEFAULT_JOB_LIMIT = 5;

function parseBooleanFlag(value, defaultValue = false) {
  if (value === undefined || value === null || String(value).trim() === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return defaultValue;
}

function clampInteger(value, { fallback, min, max }) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseJson(raw) {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function missingSettingsTable(error) {
  return /no such table:\s*app_settings/i.test(String(error?.message || error));
}

function normalizeDispatchReason(value, fallback = "Memvid Stream preview processor dispatch.") {
  return String(value || fallback)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || fallback;
}

function readDispatchConfig(env = {}) {
  return {
    autoDispatchEnabled: parseBooleanFlag(env.ENABLE_MEMVID_STREAM_PREVIEW_AUTO_DISPATCH, false),
    threshold: clampInteger(env.MEMVID_STREAM_PREVIEW_AUTO_DISPATCH_THRESHOLD, {
      fallback: DEFAULT_THRESHOLD,
      min: 1,
      max: 50,
    }),
    cooldownSeconds: clampInteger(env.MEMVID_STREAM_PREVIEW_AUTO_DISPATCH_COOLDOWN_SECONDS, {
      fallback: DEFAULT_COOLDOWN_SECONDS,
      min: 60,
      max: 86_400,
    }),
    jobLimit: clampInteger(env.MEMVID_STREAM_PREVIEW_AUTO_DISPATCH_JOB_LIMIT, {
      fallback: DEFAULT_JOB_LIMIT,
      min: 1,
      max: 8,
    }),
  };
}

async function readDispatchState(env) {
  if (!env?.DB) return { storageAvailable: false, state: {} };
  try {
    const row = await env.DB.prepare(
      "SELECT key, value_json, updated_at, updated_by_user_id, reason FROM app_settings WHERE key = ? LIMIT 1"
    ).bind(DISPATCH_STATE_SETTING_KEY).first();
    return {
      storageAvailable: true,
      state: parseJson(row?.value_json),
      row,
    };
  } catch (error) {
    if (missingSettingsTable(error)) return { storageAvailable: false, state: {} };
    throw error;
  }
}

async function writeDispatchState(env, state, reason = "") {
  if (!env?.DB) return { storageAvailable: false };
  const updatedAt = nowIso();
  try {
    await env.DB.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at, updated_by_user_id, reason)
       VALUES (?, ?, ?, NULL, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at,
         reason = excluded.reason`
    ).bind(
      DISPATCH_STATE_SETTING_KEY,
      JSON.stringify(state),
      updatedAt,
      reason || null
    ).run();
    return { storageAvailable: true, updatedAt };
  } catch (error) {
    if (missingSettingsTable(error)) return { storageAvailable: false };
    throw error;
  }
}

export function getMemvidStreamPreviewProcessorDispatchStatus(env) {
  const config = readDispatchConfig(env);
  const explicitProvider = String(env?.MEMVID_STREAM_PREVIEW_DISPATCH_PROVIDER || "").trim().toLowerCase();
  const token = String(env?.GITHUB_ACTIONS_DISPATCH_TOKEN || "").trim();
  const legacyRepository = String(env?.GITHUB_REPOSITORY || "").trim();
  const [legacyOwner, legacyRepo] = legacyRepository.split("/");
  const owner = String(env?.GITHUB_ACTIONS_DISPATCH_OWNER || legacyOwner || "").trim();
  const repo = String(env?.GITHUB_ACTIONS_DISPATCH_REPO || legacyRepo || "").trim();
  const workflowFile = String(
    env?.GITHUB_ACTIONS_DISPATCH_WORKFLOW
      || env?.GITHUB_MEMVID_STREAM_WORKFLOW_FILE
      || "memvid-stream-preview-processor.yml"
  ).trim();
  const ref = String(
    env?.GITHUB_ACTIONS_DISPATCH_REF
      || env?.GITHUB_MEMVID_STREAM_WORKFLOW_REF
      || env?.GITHUB_REF_NAME
      || "main"
  ).trim();
  const provider = explicitProvider || (token || owner || repo ? "github_actions" : "");
  const missing = [];
  if (provider && provider !== "github_actions") missing.push("MEMVID_STREAM_PREVIEW_DISPATCH_PROVIDER");
  if (!provider) missing.push("MEMVID_STREAM_PREVIEW_DISPATCH_PROVIDER");
  if (!token) missing.push("GITHUB_ACTIONS_DISPATCH_TOKEN");
  if (!owner) missing.push("GITHUB_ACTIONS_DISPATCH_OWNER");
  if (!repo) missing.push("GITHUB_ACTIONS_DISPATCH_REPO");
  if (!workflowFile) missing.push("GITHUB_ACTIONS_DISPATCH_WORKFLOW");
  if (!ref) missing.push("GITHUB_ACTIONS_DISPATCH_REF");
  return {
    provider: provider || null,
    configured: provider === "github_actions" && missing.length === 0,
    missing,
    repository_configured: Boolean(owner && repo),
    owner_configured: Boolean(owner),
    repo_configured: Boolean(repo),
    workflow_file: workflowFile || null,
    ref: ref || null,
    auto_dispatch_enabled: config.autoDispatchEnabled,
    threshold: config.threshold,
    cooldown_seconds: config.cooldownSeconds,
    job_limit: config.jobLimit,
  };
}

async function dispatchGitHubActionsWorkflow(env, {
  jobLimit = DEFAULT_JOB_LIMIT,
  repairDownloads = true,
  dryRun = false,
  dispatchReason = "Memvid Stream preview processor dispatch.",
} = {}) {
  const status = getMemvidStreamPreviewProcessorDispatchStatus(env);
  if (!status.configured) {
    return {
      configured: false,
      attempted: false,
      succeeded: false,
      started: false,
      provider: status.provider,
      missing: status.missing,
      message: "Automatic processor dispatch is not configured. Configure GitHub Actions dispatch or run the processor manually.",
      warning: "Automatic processor dispatch is not configured. Configure GitHub Actions dispatch or run the processor manually.",
    };
  }
  const owner = String(env?.GITHUB_ACTIONS_DISPATCH_OWNER || String(env?.GITHUB_REPOSITORY || "").split("/")[0] || "").trim();
  const repo = String(env?.GITHUB_ACTIONS_DISPATCH_REPO || String(env?.GITHUB_REPOSITORY || "").split("/")[1] || "").trim();
  if (!owner || !repo) {
    return {
      configured: false,
      attempted: false,
      succeeded: false,
      started: false,
      provider: "github_actions",
      missing: ["GITHUB_ACTIONS_DISPATCH_OWNER", "GITHUB_ACTIONS_DISPATCH_REPO"],
      message: "GitHub Actions dispatch repository is invalid.",
      warning: "Processor dispatch repository is invalid.",
    };
  }
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(status.workflow_file)}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${String(env.GITHUB_ACTIONS_DISPATCH_TOKEN || "").trim()}`,
        "Content-Type": "application/json",
        "User-Agent": "bitbi-auth-worker",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: status.ref,
        inputs: {
          job_limit: String(clampInteger(jobLimit, { fallback: status.job_limit, min: 1, max: 8 })),
          max_runs: "1",
          repair_downloads: repairDownloads ? "true" : "false",
          dry_run: dryRun ? "true" : "false",
          dispatch_reason: normalizeDispatchReason(dispatchReason),
        },
      }),
    });
  } catch {
    return {
      configured: true,
      attempted: true,
      succeeded: false,
      started: false,
      provider: "github_actions",
      message: "Processor dispatch request failed before GitHub accepted it.",
      warning: "Processor dispatch request failed before GitHub accepted it.",
    };
  }
  if (!res.ok) {
    const statusMessages = {
      401: "GitHub Actions dispatch was rejected. Check the dispatch token permissions.",
      403: "GitHub Actions dispatch was forbidden. Check the dispatch token permissions.",
      404: "GitHub Actions workflow or repository was not found.",
      422: "GitHub Actions dispatch rejected the configured ref or workflow inputs.",
    };
    const message = statusMessages[res.status] || `GitHub Actions dispatch failed with HTTP ${res.status}.`;
    return {
      configured: true,
      attempted: true,
      succeeded: false,
      started: false,
      provider: "github_actions",
      status: res.status,
      message,
      warning: message,
    };
  }
  return {
    configured: true,
    attempted: true,
    succeeded: true,
    started: true,
    provider: "github_actions",
    message: "Processor dispatch started.",
    workflow_file: status.workflow_file,
    ref: status.ref,
  };
}

function buildSkipResult(status, skippedReason, stateInfo = {}) {
  return {
    configured: status.configured,
    attempted: false,
    succeeded: false,
    started: false,
    provider: status.provider,
    dispatch_configured: status.configured,
    dispatch_attempted: false,
    dispatch_succeeded: false,
    dispatch_provider: status.provider,
    dispatch_message: skippedReason,
    dispatch_skipped_reason: skippedReason,
    auto_dispatch_enabled: status.auto_dispatch_enabled,
    threshold: status.threshold,
    cooldown_seconds: status.cooldown_seconds,
    ...stateInfo,
  };
}

export async function maybeDispatchMemvidStreamPreviewProcessor(env, options = {}) {
  const status = getMemvidStreamPreviewProcessorDispatchStatus(env);
  const stateInfo = await readDispatchState(env);
  const state = stateInfo.state || {};
  const now = new Date(nowIso());
  const reason = String(options.reason || options.dispatchReason || "admin_manual");
  const force = options.force === true;
  const queuedTotal = Math.max(0, Number(options.queuedNewCount || 0) || 0)
    + Math.max(0, Number(options.queuedRepairCount || 0) || 0);
  const lastDispatchAt = state.last_dispatch_at || null;
  const lastTime = Date.parse(lastDispatchAt || "");
  const cooldownMs = status.cooldown_seconds * 1000;
  const nextDispatchAfter = Number.isFinite(lastTime) && lastTime > 0
    ? new Date(lastTime + cooldownMs).toISOString()
    : null;
  const cooldownActive = !force
    && Number.isFinite(lastTime)
    && lastTime > 0
    && Date.now() < lastTime + cooldownMs;

  if (!force && !status.auto_dispatch_enabled) {
    return buildSkipResult(status, "auto_dispatch_disabled", { last_dispatch_at: lastDispatchAt, next_dispatch_after: nextDispatchAfter });
  }
  if (!force && reason === "publish_threshold" && queuedTotal < status.threshold) {
    return buildSkipResult(status, "below_dispatch_threshold", { last_dispatch_at: lastDispatchAt, next_dispatch_after: nextDispatchAfter });
  }
  if (!force && queuedTotal <= 0) {
    return buildSkipResult(status, "no_backlog", { last_dispatch_at: lastDispatchAt, next_dispatch_after: nextDispatchAfter });
  }
  if (cooldownActive) {
    return buildSkipResult(status, "dispatch_cooldown_active", { last_dispatch_at: lastDispatchAt, next_dispatch_after: nextDispatchAfter });
  }

  const dispatch = await dispatchGitHubActionsWorkflow(env, {
    jobLimit: options.jobLimit || status.job_limit,
    repairDownloads: options.repairDownloads !== false,
    dryRun: options.dryRun === true,
    dispatchReason: normalizeDispatchReason(options.dispatchReason || reason),
  });
  if (dispatch.attempted !== true) {
    return {
      ...dispatch,
      dispatch_configured: dispatch.configured === true,
      dispatch_attempted: false,
      dispatch_succeeded: false,
      dispatch_provider: dispatch.provider || status.provider || null,
      dispatch_message: dispatch.message || dispatch.warning || null,
      auto_dispatch_enabled: status.auto_dispatch_enabled,
      threshold: status.threshold,
      cooldown_seconds: status.cooldown_seconds,
      last_dispatch_at: lastDispatchAt,
      next_dispatch_after: nextDispatchAfter,
      dispatch_skipped_reason: dispatch.configured === false ? "dispatch_not_configured" : null,
    };
  }
  const dispatchAt = now.toISOString();
  const nextAfter = new Date(now.getTime() + cooldownMs).toISOString();
  const nextState = {
    last_dispatch_at: dispatchAt,
    last_dispatch_reason: reason,
    last_dispatch_provider: dispatch.provider || status.provider || null,
    last_dispatch_status: dispatch.succeeded ? "succeeded" : "failed",
    last_dispatch_message: dispatch.message || dispatch.warning || null,
    dispatch_in_flight_until: dispatch.succeeded
      ? new Date(now.getTime() + Math.min(cooldownMs, 15 * 60_000)).toISOString()
      : null,
  };
  await writeDispatchState(env, nextState, `memvid_stream_preview:${reason}`);
  return {
    ...dispatch,
    dispatch_configured: dispatch.configured === true,
    dispatch_attempted: dispatch.attempted === true,
    dispatch_succeeded: dispatch.succeeded === true,
    dispatch_provider: dispatch.provider || status.provider || null,
    dispatch_message: dispatch.message || dispatch.warning || null,
    auto_dispatch_enabled: status.auto_dispatch_enabled,
    threshold: status.threshold,
    cooldown_seconds: status.cooldown_seconds,
    last_dispatch_at: dispatchAt,
    next_dispatch_after: nextAfter,
    dispatch_skipped_reason: null,
  };
}

export async function getMemvidStreamPreviewDispatchState(env) {
  const status = getMemvidStreamPreviewProcessorDispatchStatus(env);
  const stateInfo = await readDispatchState(env);
  const lastDispatchAt = stateInfo.state?.last_dispatch_at || null;
  const lastTime = Date.parse(lastDispatchAt || "");
  return {
    ...status,
    storage_available: stateInfo.storageAvailable,
    last_dispatch_at: lastDispatchAt,
    last_dispatch_reason: stateInfo.state?.last_dispatch_reason || null,
    last_dispatch_provider: stateInfo.state?.last_dispatch_provider || null,
    last_dispatch_status: stateInfo.state?.last_dispatch_status || null,
    last_dispatch_message: stateInfo.state?.last_dispatch_message || null,
    dispatch_in_flight_until: stateInfo.state?.dispatch_in_flight_until || null,
    next_dispatch_after: Number.isFinite(lastTime) && lastTime > 0
      ? new Date(lastTime + status.cooldown_seconds * 1000).toISOString()
      : null,
  };
}
