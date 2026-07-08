import { json } from "../lib/response.js";
import { requireUser } from "../lib/session.js";
import { BODY_LIMITS, readJsonBodyOrResponse } from "../lib/request.js";
import { enforceSensitiveUserRateLimit } from "../lib/sensitive-write-limit.js";
import { nowIso, randomTokenHex } from "../lib/tokens.js";
import { getErrorFields, logDiagnostic, withCorrelationId } from "../../../../js/shared/worker-observability.mjs";
import {
  getCanvasModel,
  getCanvasModelForRole,
  listCanvasModels,
  listCanvasModelsForRole,
} from "../../../../js/shared/canvas-model-contract.mjs";
import { ORG_ROLE_RANK, listUserOrganizations, requireOrgRole } from "../lib/orgs.js";
import { handleGenerateImage, handleSaveImage } from "./ai/images-write.js";
import { handleGenerateMusic } from "./ai/music-generate.js";
import { handleGenerateText } from "./ai/text-generate.js";
import { handleGenerateVideo } from "./ai/video-generate.js";

const PROJECT_LIMIT = 50;
const RUN_LIMIT = 40;
const MAX_NODES_PER_PROJECT = 120;
const MAX_EDGES_PER_PROJECT = 300;
const MAX_PROJECT_TITLE = 120;
const MAX_NODE_TITLE = 120;
const MAX_EDGE_LABEL = 80;
const MAX_NODE_JSON_BYTES = 24 * 1024;
const MAX_OUTPUT_JSON_BYTES = 96 * 1024;
const MAX_POSITION = 100_000;
const MAX_CONNECTED_IMAGE_BYTES = 10 * 1024 * 1024;
const CONNECTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ID_PATTERN = /^[a-f0-9]{32}$/;
const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const NODE_TYPES = new Set([
  "text_prompt",
  "text_generation",
  "image_generation",
  "video_generation",
  "music_generation",
  "asset_reference",
  "output_result",
  "note",
]);
const GENERATION_NODE_CAPABILITY = Object.freeze({
  text_generation: "text",
  image_generation: "image",
  video_generation: "video",
  music_generation: "music",
});
const CANVAS_DATA_KINDS = Object.freeze({
  TEXT: "text",
  PROMPT: "prompt",
  IMAGE_ASSET: "image_asset",
  IMAGE_REFERENCE: "image_reference",
  VIDEO_ASSET: "video_asset",
  VIDEO_REFERENCE: "video_reference",
  AUDIO_ASSET: "audio_asset",
  JSON: "json",
  NONE: "none",
});

function respond(ctx, body, init) {
  return withCorrelationId(json(body, init), ctx.correlationId || null);
}

function safeJsonParse(value, fallback) {
  if (typeof value !== "string" || !value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeId(value, label = "Resource") {
  const id = String(value || "").trim().toLowerCase();
  if (!ID_PATTERN.test(id)) {
    const error = new Error(`${label} ID is invalid.`);
    error.status = 400;
    error.code = "invalid_id";
    throw error;
  }
  return id;
}

function normalizeText(value, { field, max, required = false } = {}) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if ((required && !text) || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    const error = new Error(`${field} must be ${required ? `1-${max}` : `at most ${max}`} safe characters.`);
    error.status = 400;
    error.code = `invalid_${field.toLowerCase().replace(/\s+/g, "_")}`;
    throw error;
  }
  return text;
}

function normalizeLocale(value) {
  const locale = String(value || "en").trim().toLowerCase();
  return locale === "de" ? "de" : "en";
}

function normalizeNumber(value, { field, fallback = 0, min = -MAX_POSITION, max = MAX_POSITION } = {}) {
  const number = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    const error = new Error(`${field} is invalid.`);
    error.status = 400;
    error.code = `invalid_${field}`;
    throw error;
  }
  return Math.round(number * 100) / 100;
}

function normalizeJsonObject(value, { field, maxBytes = MAX_NODE_JSON_BYTES } = {}) {
  const object = value === undefined || value === null ? {} : value;
  if (!object || typeof object !== "object" || Array.isArray(object)) {
    const error = new Error(`${field} must be an object.`);
    error.status = 400;
    error.code = `invalid_${field}`;
    throw error;
  }
  let encoded;
  try {
    encoded = JSON.stringify(object);
  } catch {
    encoded = "";
  }
  if (!encoded || new TextEncoder().encode(encoded).byteLength > maxBytes) {
    const error = new Error(`${field} is too large.`);
    error.status = 413;
    error.code = `${field}_too_large`;
    throw error;
  }
  return { value: object, encoded };
}

function normalizeRunOrganizationId(body) {
  const allowed = new Set(["organization_id", "organizationId"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    const error = new Error("Unsupported Canvas run option.");
    error.status = 400;
    error.code = "unsupported_option";
    throw error;
  }
  const snake = String(body.organization_id || "").trim();
  const camel = String(body.organizationId || "").trim();
  if (snake && camel && snake !== camel) {
    const error = new Error("Organization context is inconsistent.");
    error.status = 400;
    error.code = "organization_context_mismatch";
    throw error;
  }
  return snake || camel || null;
}

function projectRecord(row) {
  return {
    id: row.id,
    title: row.title,
    locale: row.locale || "en",
    thumbnail_asset_id: row.thumbnail_asset_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function nodeRecord(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    type: row.type,
    title: row.title || null,
    x: Number(row.x || 0),
    y: Number(row.y || 0),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    model_id: row.model_id || null,
    config: safeJsonParse(row.config_json, {}),
    content: safeJsonParse(row.content_json, {}),
    output: safeJsonParse(row.output_json, null),
    asset_id: row.asset_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function edgeRecord(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    source_node_id: row.source_node_id,
    target_node_id: row.target_node_id,
    label: row.label || null,
    config: safeJsonParse(row.config_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function runRecord(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    node_id: row.node_id,
    model_id: row.model_id,
    operation_type: row.operation_type,
    status: row.status,
    input: safeJsonParse(row.input_json, {}),
    output: safeJsonParse(row.output_json, null),
    asset_id: row.asset_id || null,
    error_code: row.error_code || null,
    error_message: row.error_message || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at || null,
  };
}

async function requireProject(env, userId, projectId) {
  return env.DB.prepare(
    `SELECT id, user_id, title, locale, thumbnail_asset_id, created_at, updated_at
     FROM canvas_projects
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL
     LIMIT 1`
  ).bind(projectId, userId).first();
}

async function requireNode(env, userId, projectId, nodeId) {
  return env.DB.prepare(
    `SELECT id, project_id, user_id, type, title, x, y, width, height, model_id,
            config_json, content_json, output_json, asset_id, created_at, updated_at
     FROM canvas_nodes
     WHERE id = ? AND project_id = ? AND user_id = ? AND deleted_at IS NULL
     LIMIT 1`
  ).bind(nodeId, projectId, userId).first();
}

async function enforceWriteLimit(ctx, userId, { run = false } = {}) {
  return enforceSensitiveUserRateLimit(ctx, {
    scope: run ? "canvas-run-user" : "canvas-write-user",
    userId,
    maxRequests: run ? 40 : 180,
    windowMs: run ? 60 * 60_000 : 10 * 60_000,
    component: run ? "canvas-run" : "canvas-write",
  });
}

async function readBody(ctx) {
  const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.smallJson });
  if (parsed.response) return { response: withCorrelationId(parsed.response, ctx.correlationId || null), body: null };
  return { response: null, body: parsed.body || {} };
}

async function assertAssetOwnership(env, userId, assetId) {
  const safeId = String(assetId || "").trim();
  if (!ASSET_ID_PATTERN.test(safeId)) {
    const error = new Error("Asset ID is invalid.");
    error.status = 400;
    error.code = "invalid_asset_id";
    throw error;
  }
  const image = await env.DB.prepare(
    "SELECT id, 'image' AS asset_type FROM ai_images WHERE id = ? AND user_id = ? LIMIT 1"
  ).bind(safeId, userId).first();
  if (image) return {
    id: safeId,
    asset_type: "image",
    mime_type: "image/*",
    file_url: `/api/ai/images/${safeId}/file`,
    preview_url: `/api/ai/images/${safeId}/medium`,
  };
  const file = await env.DB.prepare(
    "SELECT id, source_module, mime_type FROM ai_text_assets WHERE id = ? AND user_id = ? LIMIT 1"
  ).bind(safeId, userId).first();
  if (file) {
    const moduleType = String(file.source_module || "file").toLowerCase();
    const mimeType = String(file.mime_type || "").toLowerCase();
    const assetType = moduleType === "music" || moduleType === "audio" || mimeType.startsWith("audio/")
      ? "audio"
      : moduleType === "video" || mimeType.startsWith("video/")
        ? "video"
        : "file";
    return {
      id: safeId,
      asset_type: assetType,
      mime_type: file.mime_type || null,
      file_url: `/api/ai/text-assets/${safeId}/file`,
      preview_url: `/api/ai/text-assets/${safeId}/poster`,
    };
  }
  const error = new Error("Asset not found.");
  error.status = 404;
  error.code = "asset_not_found";
  throw error;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function loadOwnedImageDataUri(env, userId, assetId) {
  const row = await env.DB.prepare(
    "SELECT id, r2_key, size_bytes FROM ai_images WHERE id = ? AND user_id = ? LIMIT 1"
  ).bind(assetId, userId).first();
  if (!row) return null;
  if (Number(row.size_bytes || 0) > MAX_CONNECTED_IMAGE_BYTES) {
    throw Object.assign(new Error("Connected image exceeds the 10 MB workflow input limit."), { status: 413, code: "connected_image_too_large" });
  }
  const object = await env.USER_IMAGES?.get?.(row.r2_key);
  if (!object) throw Object.assign(new Error("Connected image is unavailable in Assets Manager."), { status: 409, code: "connected_image_unavailable" });
  if (Number(object.size || 0) > MAX_CONNECTED_IMAGE_BYTES) {
    throw Object.assign(new Error("Connected image exceeds the 10 MB workflow input limit."), { status: 413, code: "connected_image_too_large" });
  }
  const mimeType = String(object.httpMetadata?.contentType || "").split(";")[0].trim().toLowerCase();
  if (!CONNECTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw Object.assign(new Error("Connected asset must be a PNG, JPEG, or WebP image."), { status: 400, code: "connected_image_type_unsupported" });
  }
  const buffer = typeof object.arrayBuffer === "function"
    ? await object.arrayBuffer()
    : await new Response(object.body).arrayBuffer();
  if (buffer.byteLength > MAX_CONNECTED_IMAGE_BYTES) {
    throw Object.assign(new Error("Connected image exceeds the 10 MB workflow input limit."), { status: 413, code: "connected_image_too_large" });
  }
  return `data:${mimeType};base64,${bytesToBase64(new Uint8Array(buffer))}`;
}

async function applyConnectedMediaInputs(env, userId, model, resolution, body) {
  const imageAssetIds = [...new Set(resolution.imageReferences.map((input) => input.assetId).filter(Boolean))];
  if (!imageAssetIds.length) return body;
  if (model.capability === "video" && model.controls?.supportsImageInput) {
    const image = await loadOwnedImageDataUri(env, userId, imageAssetIds[0]);
    if (image) body.image_input = image;
  }
  if (model.capability === "image" && model.controls?.supportsReferenceImages) {
    const maxReferences = Math.max(1, Math.min(Number(model.controls.maxReferenceImages || 1), 4));
    const references = [];
    for (const assetId of imageAssetIds.slice(0, maxReferences)) {
      const image = await loadOwnedImageDataUri(env, userId, assetId);
      if (image) references.push(image);
    }
    if (references.length) body.referenceImages = references;
  }
  return body;
}

function storedGenerationInput(body) {
  const safe = { ...body };
  if (safe.image_input) {
    delete safe.image_input;
    safe.has_connected_image_input = true;
  }
  if (Array.isArray(safe.referenceImages)) {
    const count = safe.referenceImages.length;
    delete safe.referenceImages;
    safe.connected_reference_image_count = count;
  }
  return safe;
}

async function listProjects(ctx, userId) {
  const rows = await ctx.env.DB.prepare(
    `SELECT id, title, locale, thumbnail_asset_id, created_at, updated_at
     FROM canvas_projects
     WHERE user_id = ? AND deleted_at IS NULL
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`
  ).bind(userId, PROJECT_LIMIT).all();
  return respond(ctx, { ok: true, data: { projects: (rows.results || []).map(projectRecord), applied_limit: PROJECT_LIMIT } });
}

async function createProject(ctx, userId) {
  const limited = await enforceWriteLimit(ctx, userId);
  if (limited) return limited;
  const parsed = await readBody(ctx);
  if (parsed.response) return parsed.response;
  const count = await ctx.env.DB.prepare("SELECT COUNT(*) AS count FROM canvas_projects WHERE user_id = ? AND deleted_at IS NULL").bind(userId).first();
  if (Number(count?.count || 0) >= PROJECT_LIMIT) return respond(ctx, { ok: false, error: `Canvas supports up to ${PROJECT_LIMIT} active projects per account.`, code: "project_limit_reached" }, { status: 409 });
  const title = normalizeText(parsed.body.title || "Untitled Canvas", { field: "Project title", max: MAX_PROJECT_TITLE, required: true });
  const id = randomTokenHex(16);
  const now = nowIso();
  const locale = normalizeLocale(parsed.body.locale);
  await ctx.env.DB.prepare(
    `INSERT INTO canvas_projects (id, user_id, title, locale, thumbnail_asset_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)`
  ).bind(id, userId, title, locale, now, now).run();
  return respond(ctx, { ok: true, data: { project: { id, title, locale, thumbnail_asset_id: null, created_at: now, updated_at: now } } }, { status: 201 });
}

async function getProject(ctx, userId, projectId) {
  const project = await requireProject(ctx.env, userId, projectId);
  if (!project) return respond(ctx, { ok: false, error: "Canvas project not found.", code: "project_not_found" }, { status: 404 });
  const [nodes, edges, runs] = await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `SELECT id, project_id, type, title, x, y, width, height, model_id, config_json,
              content_json, output_json, asset_id, created_at, updated_at
       FROM canvas_nodes
       WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL
       ORDER BY created_at, id`
    ).bind(projectId, userId),
    ctx.env.DB.prepare(
      `SELECT id, project_id, source_node_id, target_node_id, label, config_json, created_at, updated_at
       FROM canvas_edges
       WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL
       ORDER BY created_at, id`
    ).bind(projectId, userId),
    ctx.env.DB.prepare(
      `SELECT id, project_id, node_id, model_id, operation_type, status, input_json, output_json,
              asset_id, error_code, error_message, created_at, updated_at, completed_at
       FROM canvas_runs
       WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    ).bind(projectId, userId, RUN_LIMIT),
  ]);
  return respond(ctx, {
    ok: true,
    data: {
      project: projectRecord(project),
      nodes: (nodes.results || []).map(nodeRecord),
      edges: (edges.results || []).map(edgeRecord),
      runs: (runs.results || []).map(runRecord),
    },
  });
}

async function updateProject(ctx, userId, projectId) {
  const limited = await enforceWriteLimit(ctx, userId);
  if (limited) return limited;
  const project = await requireProject(ctx.env, userId, projectId);
  if (!project) return respond(ctx, { ok: false, error: "Canvas project not found.", code: "project_not_found" }, { status: 404 });
  const parsed = await readBody(ctx);
  if (parsed.response) return parsed.response;
  const title = Object.prototype.hasOwnProperty.call(parsed.body, "title")
    ? normalizeText(parsed.body.title, { field: "Project title", max: MAX_PROJECT_TITLE, required: true })
    : project.title;
  let thumbnailAssetId = project.thumbnail_asset_id || null;
  if (Object.prototype.hasOwnProperty.call(parsed.body, "thumbnail_asset_id")) {
    thumbnailAssetId = parsed.body.thumbnail_asset_id ? (await assertAssetOwnership(ctx.env, userId, parsed.body.thumbnail_asset_id)).id : null;
  }
  const now = nowIso();
  await ctx.env.DB.prepare(
    `UPDATE canvas_projects SET title = ?, thumbnail_asset_id = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
  ).bind(title, thumbnailAssetId, now, projectId, userId).run();
  return respond(ctx, { ok: true, data: { project: { ...projectRecord(project), title, thumbnail_asset_id: thumbnailAssetId, updated_at: now } } });
}

async function deleteProject(ctx, userId, projectId) {
  const limited = await enforceWriteLimit(ctx, userId);
  if (limited) return limited;
  const project = await requireProject(ctx.env, userId, projectId);
  if (!project) return respond(ctx, { ok: false, error: "Canvas project not found.", code: "project_not_found" }, { status: 404 });
  const now = nowIso();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("UPDATE canvas_projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(now, now, projectId, userId),
    ctx.env.DB.prepare("UPDATE canvas_nodes SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL").bind(now, now, projectId, userId),
    ctx.env.DB.prepare("UPDATE canvas_edges SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL").bind(now, now, projectId, userId),
    ctx.env.DB.prepare("UPDATE canvas_runs SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL").bind(now, now, projectId, userId),
  ]);
  return respond(ctx, { ok: true, data: { id: projectId, deleted: true, assets_deleted: false } });
}

async function createNode(ctx, userId, projectId) {
  const limited = await enforceWriteLimit(ctx, userId);
  if (limited) return limited;
  if (!await requireProject(ctx.env, userId, projectId)) return respond(ctx, { ok: false, error: "Canvas project not found.", code: "project_not_found" }, { status: 404 });
  const count = await ctx.env.DB.prepare("SELECT COUNT(*) AS count FROM canvas_nodes WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL").bind(projectId, userId).first();
  if (Number(count?.count || 0) >= MAX_NODES_PER_PROJECT) return respond(ctx, { ok: false, error: `A Canvas project supports up to ${MAX_NODES_PER_PROJECT} active nodes.`, code: "node_limit_reached" }, { status: 409 });
  const parsed = await readBody(ctx);
  if (parsed.response) return parsed.response;
  const type = String(parsed.body.type || "").trim();
  if (!NODE_TYPES.has(type)) return respond(ctx, { ok: false, error: "Unsupported Canvas node type.", code: "invalid_node_type" }, { status: 400 });
  const title = normalizeText(parsed.body.title || "", { field: "Node title", max: MAX_NODE_TITLE });
  const x = normalizeNumber(parsed.body.x, { field: "x", fallback: 80 });
  const y = normalizeNumber(parsed.body.y, { field: "y", fallback: 80 });
  const config = normalizeJsonObject(parsed.body.config, { field: "config" });
  const content = normalizeJsonObject(parsed.body.content, { field: "content" });
  const modelId = parsed.body.model_id ? String(parsed.body.model_id).trim() : null;
  const expectedCapability = GENERATION_NODE_CAPABILITY[type];
  if (modelId) {
    const model = getCanvasModel(modelId);
    if (!model || (expectedCapability && model.capability !== expectedCapability)) {
      return respond(ctx, { ok: false, error: "Model does not match this node type.", code: "invalid_model" }, { status: 400 });
    }
  }
  let assetId = null;
  if (parsed.body.asset_id) assetId = (await assertAssetOwnership(ctx.env, userId, parsed.body.asset_id)).id;
  const id = randomTokenHex(16);
  const now = nowIso();
  await ctx.env.DB.prepare(
    `INSERT INTO canvas_nodes (
       id, project_id, user_id, type, title, x, y, width, height, model_id,
       config_json, content_json, output_json, asset_id, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?, ?, NULL)`
  ).bind(id, projectId, userId, type, title || null, x, y, modelId, config.encoded, content.encoded, assetId, now, now).run();
  await ctx.env.DB.prepare("UPDATE canvas_projects SET updated_at = ? WHERE id = ? AND user_id = ?").bind(now, projectId, userId).run();
  return respond(ctx, { ok: true, data: { node: nodeRecord({ id, project_id: projectId, type, title, x, y, width: null, height: null, model_id: modelId, config_json: config.encoded, content_json: content.encoded, output_json: null, asset_id: assetId, created_at: now, updated_at: now }) } }, { status: 201 });
}

async function updateNode(ctx, userId, projectId, nodeId) {
  const limited = await enforceWriteLimit(ctx, userId);
  if (limited) return limited;
  const current = await requireNode(ctx.env, userId, projectId, nodeId);
  if (!current) return respond(ctx, { ok: false, error: "Canvas node not found.", code: "node_not_found" }, { status: 404 });
  const parsed = await readBody(ctx);
  if (parsed.response) return parsed.response;
  const title = Object.prototype.hasOwnProperty.call(parsed.body, "title") ? normalizeText(parsed.body.title, { field: "Node title", max: MAX_NODE_TITLE }) : (current.title || "");
  const x = Object.prototype.hasOwnProperty.call(parsed.body, "x") ? normalizeNumber(parsed.body.x, { field: "x" }) : Number(current.x);
  const y = Object.prototype.hasOwnProperty.call(parsed.body, "y") ? normalizeNumber(parsed.body.y, { field: "y" }) : Number(current.y);
  const width = Object.prototype.hasOwnProperty.call(parsed.body, "width") ? normalizeNumber(parsed.body.width, { field: "width", min: 160, max: 1200 }) : current.width;
  const height = Object.prototype.hasOwnProperty.call(parsed.body, "height") ? normalizeNumber(parsed.body.height, { field: "height", min: 100, max: 1200 }) : current.height;
  const config = Object.prototype.hasOwnProperty.call(parsed.body, "config") ? normalizeJsonObject(parsed.body.config, { field: "config" }) : { encoded: current.config_json };
  const content = Object.prototype.hasOwnProperty.call(parsed.body, "content") ? normalizeJsonObject(parsed.body.content, { field: "content" }) : { encoded: current.content_json };
  const modelId = Object.prototype.hasOwnProperty.call(parsed.body, "model_id") ? (String(parsed.body.model_id || "").trim() || null) : current.model_id;
  const expectedCapability = GENERATION_NODE_CAPABILITY[current.type];
  if (modelId) {
    const model = getCanvasModel(modelId);
    if (!model || (expectedCapability && model.capability !== expectedCapability)) return respond(ctx, { ok: false, error: "Model does not match this node type.", code: "invalid_model" }, { status: 400 });
  }
  let assetId = current.asset_id || null;
  if (Object.prototype.hasOwnProperty.call(parsed.body, "asset_id")) assetId = parsed.body.asset_id ? (await assertAssetOwnership(ctx.env, userId, parsed.body.asset_id)).id : null;
  const now = nowIso();
  await ctx.env.DB.prepare(
    `UPDATE canvas_nodes
     SET title = ?, x = ?, y = ?, width = ?, height = ?, model_id = ?, config_json = ?, content_json = ?, asset_id = ?, updated_at = ?
     WHERE id = ? AND project_id = ? AND user_id = ? AND deleted_at IS NULL`
  ).bind(title || null, x, y, width, height, modelId, config.encoded, content.encoded, assetId, now, nodeId, projectId, userId).run();
  await ctx.env.DB.prepare("UPDATE canvas_projects SET updated_at = ? WHERE id = ? AND user_id = ?").bind(now, projectId, userId).run();
  return respond(ctx, { ok: true, data: { node: nodeRecord({ ...current, title, x, y, width, height, model_id: modelId, config_json: config.encoded, content_json: content.encoded, asset_id: assetId, updated_at: now }) } });
}

async function deleteNode(ctx, userId, projectId, nodeId) {
  const limited = await enforceWriteLimit(ctx, userId);
  if (limited) return limited;
  const node = await requireNode(ctx.env, userId, projectId, nodeId);
  if (!node) return respond(ctx, { ok: false, error: "Canvas node not found.", code: "node_not_found" }, { status: 404 });
  const now = nowIso();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("UPDATE canvas_nodes SET deleted_at = ?, updated_at = ? WHERE id = ? AND project_id = ? AND user_id = ?").bind(now, now, nodeId, projectId, userId),
    ctx.env.DB.prepare("UPDATE canvas_edges SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL AND (source_node_id = ? OR target_node_id = ?)").bind(now, now, projectId, userId, nodeId, nodeId),
    ctx.env.DB.prepare("UPDATE canvas_projects SET updated_at = ? WHERE id = ? AND user_id = ?").bind(now, projectId, userId),
  ]);
  return respond(ctx, { ok: true, data: { id: nodeId, deleted: true, asset_deleted: false } });
}

async function createEdge(ctx, userId, projectId) {
  const limited = await enforceWriteLimit(ctx, userId);
  if (limited) return limited;
  if (!await requireProject(ctx.env, userId, projectId)) return respond(ctx, { ok: false, error: "Canvas project not found.", code: "project_not_found" }, { status: 404 });
  const count = await ctx.env.DB.prepare("SELECT COUNT(*) AS count FROM canvas_edges WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL").bind(projectId, userId).first();
  if (Number(count?.count || 0) >= MAX_EDGES_PER_PROJECT) return respond(ctx, { ok: false, error: `A Canvas project supports up to ${MAX_EDGES_PER_PROJECT} active connections.`, code: "edge_limit_reached" }, { status: 409 });
  const parsed = await readBody(ctx);
  if (parsed.response) return parsed.response;
  const sourceNodeId = normalizeId(parsed.body.source_node_id, "Source node");
  const targetNodeId = normalizeId(parsed.body.target_node_id, "Target node");
  if (sourceNodeId === targetNodeId) return respond(ctx, { ok: false, error: "A node cannot connect to itself.", code: "invalid_edge" }, { status: 400 });
  const [source, target] = await Promise.all([
    requireNode(ctx.env, userId, projectId, sourceNodeId),
    requireNode(ctx.env, userId, projectId, targetNodeId),
  ]);
  if (!source || !target) return respond(ctx, { ok: false, error: "Edge nodes must belong to this Canvas project.", code: "node_not_found" }, { status: 404 });
  const label = normalizeText(parsed.body.label || "", { field: "Edge label", max: MAX_EDGE_LABEL });
  const config = normalizeJsonObject(parsed.body.config, { field: "config" });
  const id = randomTokenHex(16);
  const now = nowIso();
  try {
    await ctx.env.DB.prepare(
      `INSERT INTO canvas_edges (id, project_id, user_id, source_node_id, target_node_id, label, config_json, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).bind(id, projectId, userId, sourceNodeId, targetNodeId, label || null, config.encoded, now, now).run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) return respond(ctx, { ok: false, error: "These nodes are already connected.", code: "edge_exists" }, { status: 409 });
    throw error;
  }
  await ctx.env.DB.prepare("UPDATE canvas_projects SET updated_at = ? WHERE id = ? AND user_id = ?").bind(now, projectId, userId).run();
  return respond(ctx, { ok: true, data: { edge: edgeRecord({ id, project_id: projectId, source_node_id: sourceNodeId, target_node_id: targetNodeId, label, config_json: config.encoded, created_at: now, updated_at: now }) } }, { status: 201 });
}

async function updateEdge(ctx, userId, projectId, edgeId) {
  const limited = await enforceWriteLimit(ctx, userId);
  if (limited) return limited;
  const edge = await ctx.env.DB.prepare(
    `SELECT id, project_id, source_node_id, target_node_id, label, config_json, created_at, updated_at
     FROM canvas_edges WHERE id = ? AND project_id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`
  ).bind(edgeId, projectId, userId).first();
  if (!edge) return respond(ctx, { ok: false, error: "Canvas edge not found.", code: "edge_not_found" }, { status: 404 });
  const parsed = await readBody(ctx);
  if (parsed.response) return parsed.response;
  const label = Object.prototype.hasOwnProperty.call(parsed.body, "label") ? normalizeText(parsed.body.label, { field: "Edge label", max: MAX_EDGE_LABEL }) : edge.label;
  const config = Object.prototype.hasOwnProperty.call(parsed.body, "config") ? normalizeJsonObject(parsed.body.config, { field: "config" }) : { encoded: edge.config_json };
  const now = nowIso();
  await ctx.env.DB.prepare("UPDATE canvas_edges SET label = ?, config_json = ?, updated_at = ? WHERE id = ? AND project_id = ? AND user_id = ? AND deleted_at IS NULL").bind(label || null, config.encoded, now, edgeId, projectId, userId).run();
  return respond(ctx, { ok: true, data: { edge: edgeRecord({ ...edge, label, config_json: config.encoded, updated_at: now }) } });
}

async function deleteEdge(ctx, userId, projectId, edgeId) {
  const limited = await enforceWriteLimit(ctx, userId);
  if (limited) return limited;
  const edge = await ctx.env.DB.prepare("SELECT id FROM canvas_edges WHERE id = ? AND project_id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1").bind(edgeId, projectId, userId).first();
  if (!edge) return respond(ctx, { ok: false, error: "Canvas edge not found.", code: "edge_not_found" }, { status: 404 });
  const now = nowIso();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("UPDATE canvas_edges SET deleted_at = ?, updated_at = ? WHERE id = ? AND project_id = ? AND user_id = ?").bind(now, now, edgeId, projectId, userId),
    ctx.env.DB.prepare("UPDATE canvas_projects SET updated_at = ? WHERE id = ? AND user_id = ?").bind(now, projectId, userId),
  ]);
  return respond(ctx, { ok: true, data: { id: edgeId, deleted: true } });
}

function defaultModelForCapability(capability, role) {
  return listCanvasModelsForRole(role).find((model) => model.capability === capability && model.runnable) || null;
}

async function canvasOrganizationContext(env, user) {
  const organizations = (await listUserOrganizations(env, { userId: user.id, limit: 100 }))
    .filter((organization) => (ORG_ROLE_RANK[organization.role] || 0) >= ORG_ROLE_RANK.member)
    .map((organization) => ({ id: organization.id, name: organization.name, role: organization.role }));
  return {
    organizations,
    selectedOrganizationId: organizations.length === 1 ? organizations[0].id : null,
  };
}

async function connectedInputs(env, userId, projectId, nodeId) {
  const rows = await env.DB.prepare(
    `SELECT edges.id AS edge_id, edges.created_at AS edge_created_at,
            nodes.id, nodes.type, nodes.title, nodes.model_id,
            nodes.content_json, nodes.output_json, nodes.asset_id
     FROM canvas_edges edges
     JOIN canvas_nodes nodes ON nodes.id = edges.source_node_id
                            AND nodes.project_id = edges.project_id
                            AND nodes.user_id = edges.user_id
     WHERE edges.project_id = ? AND edges.user_id = ? AND edges.target_node_id = ?
       AND edges.deleted_at IS NULL AND nodes.deleted_at IS NULL
     ORDER BY edges.created_at, edges.id`
  ).bind(projectId, userId, nodeId).all();
  return rows.results || [];
}

function expectedOutputKindForNode(type) {
  if (type === "text_prompt") return CANVAS_DATA_KINDS.PROMPT;
  if (type === "text_generation" || type === "note") return CANVAS_DATA_KINDS.TEXT;
  if (type === "image_generation") return CANVAS_DATA_KINDS.IMAGE_ASSET;
  if (type === "video_generation") return CANVAS_DATA_KINDS.VIDEO_ASSET;
  if (type === "music_generation") return CANVAS_DATA_KINDS.AUDIO_ASSET;
  return CANVAS_DATA_KINDS.NONE;
}

function assetKind(asset) {
  if (asset?.asset_type === "image" || String(asset?.mime_type || "").startsWith("image/")) return CANVAS_DATA_KINDS.IMAGE_ASSET;
  if (asset?.asset_type === "video" || String(asset?.mime_type || "").startsWith("video/")) return CANVAS_DATA_KINDS.VIDEO_ASSET;
  if (asset?.asset_type === "audio" || String(asset?.mime_type || "").startsWith("audio/")) return CANVAS_DATA_KINDS.AUDIO_ASSET;
  return CANVAS_DATA_KINDS.JSON;
}

function compatibilityForInput(targetNode, model, kind) {
  if (kind === CANVAS_DATA_KINDS.TEXT || kind === CANVAS_DATA_KINDS.PROMPT) {
    return { compatible: true, inputKind: CANVAS_DATA_KINDS.PROMPT, reason: null };
  }
  if (kind === CANVAS_DATA_KINDS.IMAGE_ASSET || kind === CANVAS_DATA_KINDS.IMAGE_REFERENCE) {
    if (targetNode.type === "image_generation" && model.controls?.supportsReferenceImages) {
      return { compatible: true, inputKind: CANVAS_DATA_KINDS.IMAGE_REFERENCE, reason: null };
    }
    if (targetNode.type === "video_generation" && model.controls?.supportsImageInput) {
      return { compatible: true, inputKind: CANVAS_DATA_KINDS.IMAGE_REFERENCE, reason: null };
    }
    return { compatible: false, inputKind: CANVAS_DATA_KINDS.IMAGE_REFERENCE, reason: `${model.label} does not support image input in Canvas.` };
  }
  if (kind === CANVAS_DATA_KINDS.VIDEO_ASSET || kind === CANVAS_DATA_KINDS.VIDEO_REFERENCE) {
    if (targetNode.type === "video_generation" && model.controls?.supportsVideoInput) {
      return { compatible: true, inputKind: CANVAS_DATA_KINDS.VIDEO_REFERENCE, reason: null };
    }
    return { compatible: false, inputKind: CANVAS_DATA_KINDS.VIDEO_REFERENCE, reason: `${model.label} does not support video input, continuation, or extension in Canvas.` };
  }
  if (kind === CANVAS_DATA_KINDS.AUDIO_ASSET) {
    return { compatible: false, inputKind: CANVAS_DATA_KINDS.AUDIO_ASSET, reason: `${model.label} does not accept an audio asset input in Canvas.` };
  }
  if (kind === CANVAS_DATA_KINDS.JSON) {
    return { compatible: false, inputKind: CANVAS_DATA_KINDS.JSON, reason: `${model.label} does not accept JSON workflow input.` };
  }
  return { compatible: false, inputKind: CANVAS_DATA_KINDS.NONE, reason: "The connected source has no usable output." };
}

async function sourceValue(env, userId, input) {
  const content = safeJsonParse(input.content_json, {});
  const output = safeJsonParse(input.output_json, null);
  const base = {
    edgeId: input.edge_id,
    sourceNodeId: input.id,
    sourceTitle: input.title || input.type,
    sourceType: input.type,
  };
  if (input.type === "text_prompt") {
    const text = String(content.prompt || content.text || "").trim();
    return text ? { ...base, kind: CANVAS_DATA_KINDS.PROMPT, text } : { ...base, kind: CANVAS_DATA_KINDS.NONE, expectedKind: CANVAS_DATA_KINDS.PROMPT };
  }
  if (input.type === "note") {
    const text = String(content.text || content.prompt || "").trim();
    return text ? { ...base, kind: CANVAS_DATA_KINDS.TEXT, text } : { ...base, kind: CANVAS_DATA_KINDS.NONE, expectedKind: CANVAS_DATA_KINDS.TEXT };
  }
  if (output?.kind === "text" && String(output.text || "").trim()) {
    return { ...base, kind: CANVAS_DATA_KINDS.TEXT, text: String(output.text).trim(), runId: output.runId || null };
  }
  const outputAssetId = input.asset_id || output?.assetId || output?.asset?.id || null;
  if (outputAssetId) {
    const asset = await assertAssetOwnership(env, userId, outputAssetId);
    return {
      ...base,
      kind: assetKind(asset),
      assetId: asset.id,
      assetType: asset.asset_type,
      mimeType: asset.mime_type || output?.mimeType || null,
      previewUrl: asset.preview_url || null,
      fileUrl: asset.file_url || null,
      runId: output?.runId || null,
    };
  }
  if (output?.kind === "json") return { ...base, kind: CANVAS_DATA_KINDS.JSON, json: output.json || null, runId: output.runId || null };
  return { ...base, kind: CANVAS_DATA_KINDS.NONE, expectedKind: expectedOutputKindForNode(input.type) };
}

async function resolveCanvasNodeInputs(env, userId, projectId, node, model) {
  const rows = await connectedInputs(env, userId, projectId, node.id);
  const config = safeJsonParse(node.config_json, {});
  const content = safeJsonParse(node.content_json, {});
  const directPrompt = String(config.prompt || content.prompt || content.text || "").trim();
  const sources = [];
  for (const row of rows) {
    const value = await sourceValue(env, userId, row);
    const kindForCompatibility = value.kind === CANVAS_DATA_KINDS.NONE ? value.expectedKind : value.kind;
    const compatibility = compatibilityForInput(node, model, kindForCompatibility);
    const status = value.kind === CANVAS_DATA_KINDS.NONE
      ? (compatibility.compatible ? "unresolved" : "incompatible")
      : (compatibility.compatible ? "compatible" : "incompatible");
    sources.push({ ...value, inputKind: compatibility.inputKind, status, reason: status === "unresolved" ? "Run the upstream node first." : compatibility.reason });
  }
  const compatible = sources.filter((source) => source.status === "compatible");
  const connectedPrompt = compatible
    .filter((source) => source.inputKind === CANVAS_DATA_KINDS.PROMPT && source.text)
    .map((source) => source.text)
    .join("\n\n")
    .trim();
  return {
    sources,
    incompatible: sources.filter((source) => source.status === "incompatible"),
    unresolved: sources.filter((source) => source.status === "unresolved"),
    directPrompt,
    connectedPrompt,
    effectivePrompt: directPrompt || connectedPrompt,
    promptSource: directPrompt ? "direct" : (connectedPrompt ? "connected" : "none"),
    imageReferences: compatible.filter((source) => source.inputKind === CANVAS_DATA_KINDS.IMAGE_REFERENCE),
    videoReferences: compatible.filter((source) => source.inputKind === CANVAS_DATA_KINDS.VIDEO_REFERENCE),
  };
}

function buildGenerationBody(node, model, resolution) {
  const config = safeJsonParse(node.config_json, {});
  if (resolution.incompatible.length) {
    const input = resolution.incompatible[0];
    const error = new Error(`${input.sourceTitle}: ${input.reason}`);
    error.status = 409;
    error.code = "canvas_input_incompatible";
    throw error;
  }
  if (resolution.unresolved.length) {
    const input = resolution.unresolved[0];
    const error = new Error(`${input.sourceTitle}: Run the upstream node first.`);
    error.status = 409;
    error.code = "canvas_upstream_output_required";
    throw error;
  }
  const prompt = resolution.effectivePrompt;
  if (!prompt) {
    const error = new Error("Add a prompt to this node or connect a Text Prompt node before running.");
    error.status = 400;
    error.code = "prompt_required";
    throw error;
  }
  const maxPromptLength = Math.max(1, Number(model.controls?.maxPromptLength || (model.capability === "text" ? MAX_NODE_JSON_BYTES / 2 : 5000)));
  if (prompt.length > maxPromptLength) {
    const error = new Error(`Prompt must be at most ${maxPromptLength} characters for this model.`);
    error.status = 400;
    error.code = "prompt_too_long";
    throw error;
  }
  const body = { model: model.id, prompt };
  if (model.capability === "text") {
    if (config.systemPrompt) body.system_prompt = config.systemPrompt;
    if (Array.isArray(config.messages)) body.messages = config.messages;
    if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens;
    if (config.temperature !== undefined) body.temperature = config.temperature;
  } else if (model.capability === "image") {
    for (const field of ["steps", "seed", "width", "height", "quality", "size", "outputFormat", "background", "safetyTolerance"]) {
      if (config[field] !== undefined && config[field] !== "") body[field] = config[field];
    }
  } else if (model.capability === "video") {
    body.duration = config.duration || model.controls?.duration?.default || 5;
    if (model.controls?.resolutionField === "quality") body.quality = config.quality || model.controls.defaultQuality || "720p";
    else body.resolution = config.resolution || model.controls.defaultResolution || "720p";
    if (model.id === "alibaba/hh1-t2v") body.ratio = config.aspectRatio || model.controls.defaultAspectRatio || "16:9";
    else body.aspect_ratio = config.aspectRatio || model.controls.defaultAspectRatio || "16:9";
    if (model.controls?.supportsNegativePrompt && config.negativePrompt) body.negative_prompt = config.negativePrompt;
    if (model.controls?.supportsSeed && config.seed !== undefined && config.seed !== "") body.seed = config.seed;
    if (model.controls?.supportsAudioToggle) body.generate_audio = config.generateAudio !== false;
    if (model.controls?.supportsWatermark) body.watermark = config.watermark === true;
  } else if (model.capability === "music") {
    body.instrumental = config.instrumental === true;
    body.generateLyrics = config.generateLyrics === true;
    if (config.lyrics) body.lyrics = config.lyrics;
  }
  return body;
}

function delegatedRequest(ctx, path, body, idempotencyKey) {
  const headers = new Headers(ctx.request.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("Idempotency-Key", idempotencyKey);
  headers.delete("content-length");
  return new Request(new URL(path, ctx.request.url), { method: "POST", headers, body: JSON.stringify(body) });
}

async function callGenerationHandler(ctx, model, body, idempotencyKey) {
  const handlers = {
    text: ["/api/ai/generate-text", handleGenerateText],
    image: ["/api/ai/generate-image", handleGenerateImage],
    video: ["/api/ai/generate-video", handleGenerateVideo],
    music: ["/api/ai/generate-music", handleGenerateMusic],
  };
  const target = handlers[model.capability];
  if (!target) throw Object.assign(new Error("Canvas node is not runnable."), { status: 400, code: "node_not_runnable" });
  const request = delegatedRequest(ctx, target[0], body, idempotencyKey);
  let usageAttemptId = null;
  const response = await target[1]({
    ...ctx,
    request,
    pathname: target[0],
    method: "POST",
    canvasMemberContext: true,
    captureCanvasUsageAttemptId(value) {
      usageAttemptId = typeof value === "string" && value ? value : null;
    },
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  return { response, payload, usageAttemptId };
}

async function saveGeneratedImage(ctx, body, generated) {
  const saveReference = generated?.data?.saveReference;
  if (!saveReference) throw Object.assign(new Error("Generated image could not be prepared for Assets Manager."), { status: 502, code: "image_save_reference_missing" });
  const request = delegatedRequest(ctx, "/api/ai/images/save", {
    save_reference: saveReference,
    prompt: body.prompt,
    model: body.model,
    steps: generated.data.steps ?? body.steps ?? null,
    seed: generated.data.seed ?? body.seed ?? null,
  }, `canvas-save-${randomTokenHex(16)}`);
  const response = await handleSaveImage({ ...ctx, request, pathname: "/api/ai/images/save", method: "POST" });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || !payload?.ok || !payload?.data?.id) {
    throw Object.assign(new Error(payload?.error || "Generated image could not be saved to Assets Manager."), {
      status: response.status || 500,
      code: payload?.code || "image_save_failed",
    });
  }
  return payload.data;
}

function safeRunOutput(model, payload, imageAsset = null, { runId, createdAt } = {}) {
  if (model.capability === "text") {
    return {
      kind: "text",
      text: String(payload.text || "").slice(0, 64_000),
      assetId: null,
      assetType: null,
      mimeType: "text/plain; charset=utf-8",
      previewUrl: null,
      modelId: payload.model?.id || model.id,
      runId,
      createdAt,
      model: payload.model || { id: model.id },
      billing: payload.billing || null,
    };
  }
  if (model.capability === "image") {
    const asset = { id: imageAsset.id, asset_type: "image", mime_type: "image/*", file_url: `/api/ai/images/${imageAsset.id}/file`, preview_url: `/api/ai/images/${imageAsset.id}/medium` };
    return { kind: "image", assetId: asset.id, assetType: "image", mimeType: asset.mime_type, previewUrl: asset.preview_url, fileUrl: asset.file_url, modelId: model.id, runId, createdAt, asset, model: model.id, billing: payload.billing || null };
  }
  const data = payload.data || {};
  const asset = data.asset || null;
  const kind = model.capability === "music" ? "audio" : "video";
  const safeAsset = asset ? {
    id: asset.id,
    asset_type: kind,
    file_url: asset.file_url || data.audioUrl || data.videoUrl || null,
    preview_url: asset.poster_url || data.posterUrl || null,
    mime_type: asset.mime_type || data.mimeType || null,
  } : null;
  return {
    kind,
    assetId: safeAsset?.id || null,
    assetType: kind,
    mimeType: safeAsset?.mime_type || null,
    previewUrl: safeAsset?.preview_url || null,
    fileUrl: safeAsset?.file_url || null,
    modelId: data.model?.id || model.id,
    runId,
    createdAt,
    asset: safeAsset,
    model: data.model || { id: model.id },
    billing: payload.billing || null,
  };
}

async function runNode(ctx, session, projectId, nodeId) {
  const userId = session.user.id;
  const limited = await enforceWriteLimit(ctx, userId, { run: true });
  if (limited) return limited;
  if (!await requireProject(ctx.env, userId, projectId)) return respond(ctx, { ok: false, error: "Canvas project not found.", code: "project_not_found" }, { status: 404 });
  const node = await requireNode(ctx.env, userId, projectId, nodeId);
  if (!node) return respond(ctx, { ok: false, error: "Canvas node not found.", code: "node_not_found" }, { status: 404 });
  const capability = GENERATION_NODE_CAPABILITY[node.type];
  if (!capability) return respond(ctx, { ok: false, error: "Select a generation node to run.", code: "node_not_runnable" }, { status: 400 });
  const model = getCanvasModelForRole(node.model_id, session.user.role) || defaultModelForCapability(capability, session.user.role);
  if (!model || model.capability !== capability) return respond(ctx, { ok: false, error: "Choose a model for this node.", code: "model_required" }, { status: 400 });
  if (!model.runnable) return respond(ctx, { ok: false, error: model.disabledReason || "Model is not runnable in Canvas.", code: "model_not_runnable" }, { status: 409 });
  const idempotencyKey = String(ctx.request.headers.get("Idempotency-Key") || "").trim();
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) return respond(ctx, { ok: false, error: "A valid Idempotency-Key header is required.", code: "idempotency_key_required" }, { status: 428 });
  const parsed = await readBody(ctx);
  if (parsed.response) return parsed.response;
  const requestedOrganizationId = normalizeRunOrganizationId(parsed.body);
  let organizationId = requestedOrganizationId;
  if (organizationId) {
    await requireOrgRole(ctx.env, { organizationId, userId, minRole: "member" });
  } else if (model.requiresOrganization) {
    const organizationContext = await canvasOrganizationContext(ctx.env, session.user);
    organizationId = organizationContext.selectedOrganizationId;
    if (!organizationId) {
      const error = new Error(organizationContext.organizations.length > 1
        ? "Select an organization for this model."
        : "An active organization membership is required for this model.");
      error.status = 409;
      error.code = organizationContext.organizations.length > 1 ? "organization_selection_required" : "organization_required";
      throw error;
    }
  }
  const resolution = await resolveCanvasNodeInputs(ctx.env, userId, projectId, node, model);
  let generationBody;
  try { generationBody = buildGenerationBody(node, model, resolution); } catch (error) { return respond(ctx, { ok: false, error: error.message, code: error.code || "validation_error" }, { status: error.status || 400 }); }
  await applyConnectedMediaInputs(ctx.env, userId, model, resolution, generationBody);
  const requestInput = {
    node_id: nodeId,
    model_id: model.id,
    capability,
    generation: storedGenerationInput(generationBody),
    organization_id: model.requiresOrganization ? organizationId : null,
    prompt_source: resolution.promptSource,
    connected_node_ids: resolution.sources.map((input) => input.sourceNodeId),
    connected_asset_ids: resolution.sources.map((input) => input.assetId).filter(Boolean),
    connected_input_kinds: resolution.sources.map((input) => input.inputKind),
  };
  const inputJson = stableJson(requestInput);
  if (new TextEncoder().encode(inputJson).byteLength > MAX_NODE_JSON_BYTES) {
    return respond(ctx, { ok: false, error: "Canvas run input is too large.", code: "run_input_too_large" }, { status: 413 });
  }
  let existing = await ctx.env.DB.prepare(
    `SELECT id, project_id, node_id, model_id, operation_type, status, input_json, output_json, asset_id,
            error_code, error_message, created_at, updated_at, completed_at
     FROM canvas_runs WHERE user_id = ? AND idempotency_key = ? AND deleted_at IS NULL LIMIT 1`
  ).bind(userId, idempotencyKey).first();
  if (existing && existing.input_json !== inputJson) return respond(ctx, { ok: false, error: "Idempotency-Key conflicts with another Canvas run.", code: "idempotency_conflict" }, { status: 409 });
  if (existing?.status === "completed") return respond(ctx, { ok: true, data: { run: runRecord(existing), idempotent_replay: true } });
  if (existing?.status === "failed") return respond(ctx, { ok: false, error: existing.error_message || "Canvas run failed.", code: existing.error_code || "canvas_run_failed", data: { run: runRecord(existing), idempotent_replay: true } }, { status: 409 });
  if (existing?.status === "queued" || existing?.status === "running") {
    return respond(ctx, {
      ok: false,
      error: "This Canvas run is already in progress.",
      code: "canvas_run_in_progress",
      data: { run: runRecord(existing), idempotent_replay: true },
    }, { status: 409 });
  }
  let runId = existing?.id || randomTokenHex(16);
  const now = nowIso();
  if (!existing) {
    try {
      await ctx.env.DB.prepare(
        `INSERT INTO canvas_runs (id, project_id, node_id, user_id, model_id, operation_type, idempotency_key, status,
          input_json, output_json, asset_id, usage_attempt_id, error_code, error_message, created_at, updated_at, completed_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL)`
      ).bind(runId, projectId, nodeId, userId, model.id, `canvas.${capability}.generate`, idempotencyKey, inputJson, now, now).run();
    } catch (error) {
      if (!String(error).includes("UNIQUE")) throw error;
      existing = await ctx.env.DB.prepare(
        `SELECT id, project_id, node_id, model_id, operation_type, status, input_json, output_json, asset_id,
                error_code, error_message, created_at, updated_at, completed_at
         FROM canvas_runs WHERE user_id = ? AND idempotency_key = ? AND deleted_at IS NULL LIMIT 1`
      ).bind(userId, idempotencyKey).first();
      if (!existing || existing.input_json !== inputJson) {
        return respond(ctx, { ok: false, error: "Idempotency-Key conflicts with another Canvas run.", code: "idempotency_conflict" }, { status: 409 });
      }
      if (existing.status === "completed") return respond(ctx, { ok: true, data: { run: runRecord(existing), idempotent_replay: true } });
      runId = existing.id;
      return respond(ctx, {
        ok: false,
        error: "This Canvas run is already in progress.",
        code: "canvas_run_in_progress",
        data: { run: runRecord(existing), idempotent_replay: true },
      }, { status: 409 });
    }
  }
  await ctx.env.DB.prepare("UPDATE canvas_runs SET status = 'running', updated_at = ? WHERE id = ? AND user_id = ? AND status IN ('queued', 'running')").bind(nowIso(), runId, userId).run();

  let capturedUsageAttemptId = null;
  try {
    const delegated = await callGenerationHandler(ctx, model, generationBody, idempotencyKey);
    capturedUsageAttemptId = delegated.usageAttemptId;
    if (!delegated.response.ok || !delegated.payload?.ok) {
      if (["idempotency_in_progress", "request_in_progress"].includes(delegated.payload?.code)) {
        return respond(ctx, {
          ok: false,
          error: delegated.payload?.error || "This Canvas run is already in progress.",
          code: "canvas_run_in_progress",
          data: { run_id: runId },
        }, { status: 409 });
      }
      const error = new Error(delegated.payload?.error || "Canvas generation failed.");
      error.status = delegated.response.status || 502;
      error.code = delegated.payload?.code || "generation_failed";
      throw error;
    }
    const imageAsset = model.capability === "image" ? await saveGeneratedImage(ctx, generationBody, delegated.payload) : null;
    const completedAt = nowIso();
    const output = safeRunOutput(model, delegated.payload, imageAsset, { runId, createdAt: completedAt });
    if ((model.capability === "video" || model.capability === "music")) {
      if (!output.asset?.id) {
        throw Object.assign(new Error("Generated media was not persisted to Assets Manager."), {
          status: 502,
          code: "persisted_asset_missing",
        });
      }
      output.asset = await assertAssetOwnership(ctx.env, userId, output.asset.id);
      output.assetId = output.asset.id;
      output.assetType = output.asset.asset_type;
      output.mimeType = output.asset.mime_type || output.mimeType;
      output.previewUrl = output.asset.preview_url || null;
      output.fileUrl = output.asset.file_url || null;
    }
    const outputState = normalizeJsonObject(output, { field: "output", maxBytes: MAX_OUTPUT_JSON_BYTES });
    const assetId = imageAsset?.id || output.asset?.id || null;
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        `UPDATE canvas_runs SET status = 'completed', output_json = ?, asset_id = ?, usage_attempt_id = ?, error_code = NULL,
                error_message = NULL, updated_at = ?, completed_at = ?
         WHERE id = ? AND project_id = ? AND node_id = ? AND user_id = ? AND deleted_at IS NULL`
      ).bind(outputState.encoded, assetId, capturedUsageAttemptId, completedAt, completedAt, runId, projectId, nodeId, userId),
      ctx.env.DB.prepare(
        `UPDATE canvas_nodes SET output_json = ?, asset_id = ?, updated_at = ?
         WHERE id = ? AND project_id = ? AND user_id = ? AND deleted_at IS NULL`
      ).bind(outputState.encoded, assetId, completedAt, nodeId, projectId, userId),
      ctx.env.DB.prepare("UPDATE canvas_projects SET thumbnail_asset_id = COALESCE(thumbnail_asset_id, ?), updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(assetId, completedAt, projectId, userId),
    ]);
    return respond(ctx, { ok: true, data: { run: runRecord({ id: runId, project_id: projectId, node_id: nodeId, model_id: model.id, operation_type: `canvas.${capability}.generate`, status: "completed", input_json: inputJson, output_json: outputState.encoded, asset_id: assetId, error_code: null, error_message: null, created_at: existing?.created_at || now, updated_at: completedAt, completed_at: completedAt }), idempotent_replay: false } });
  } catch (error) {
    const failedAt = nowIso();
    const code = String(error.code || "canvas_run_failed").slice(0, 80);
    const message = error.code ? String(error.message || "Canvas run failed.").slice(0, 300) : "Canvas run failed.";
    await ctx.env.DB.prepare(
      `UPDATE canvas_runs SET status = 'failed', usage_attempt_id = ?, error_code = ?, error_message = ?, updated_at = ?, completed_at = ?
       WHERE id = ? AND project_id = ? AND node_id = ? AND user_id = ? AND deleted_at IS NULL`
    ).bind(capturedUsageAttemptId, code, message, failedAt, failedAt, runId, projectId, nodeId, userId).run();
    return respond(ctx, { ok: false, error: message, code, data: { run_id: runId } }, { status: error.status || 500 });
  }
}

async function listRuns(ctx, userId, projectId, nodeId = null) {
  if (!await requireProject(ctx.env, userId, projectId)) return respond(ctx, { ok: false, error: "Canvas project not found.", code: "project_not_found" }, { status: 404 });
  const query = nodeId
    ? `SELECT id, project_id, node_id, model_id, operation_type, status, input_json, output_json, asset_id,
              error_code, error_message, created_at, updated_at, completed_at
       FROM canvas_runs WHERE project_id = ? AND node_id = ? AND user_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT ?`
    : `SELECT id, project_id, node_id, model_id, operation_type, status, input_json, output_json, asset_id,
              error_code, error_message, created_at, updated_at, completed_at
       FROM canvas_runs WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT ?`;
  const rows = nodeId
    ? await ctx.env.DB.prepare(query).bind(projectId, nodeId, userId, RUN_LIMIT).all()
    : await ctx.env.DB.prepare(query).bind(projectId, userId, RUN_LIMIT).all();
  return respond(ctx, { ok: true, data: { runs: (rows.results || []).map(runRecord), applied_limit: RUN_LIMIT } });
}

async function setAssetReference(ctx, userId, projectId, nodeId) {
  const limited = await enforceWriteLimit(ctx, userId);
  if (limited) return limited;
  const node = await requireNode(ctx.env, userId, projectId, nodeId);
  if (!node) return respond(ctx, { ok: false, error: "Canvas node not found.", code: "node_not_found" }, { status: 404 });
  if (node.type !== "asset_reference") return respond(ctx, { ok: false, error: "Asset references can only be assigned to Asset Reference nodes.", code: "invalid_node_type" }, { status: 400 });
  const parsed = await readBody(ctx);
  if (parsed.response) return parsed.response;
  const asset = await assertAssetOwnership(ctx.env, userId, parsed.body.asset_id);
  const content = normalizeJsonObject({ asset }, { field: "content" });
  const now = nowIso();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("UPDATE canvas_nodes SET asset_id = ?, content_json = ?, updated_at = ? WHERE id = ? AND project_id = ? AND user_id = ? AND deleted_at IS NULL").bind(asset.id, content.encoded, now, nodeId, projectId, userId),
    ctx.env.DB.prepare("UPDATE canvas_projects SET updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(now, projectId, userId),
  ]);
  return respond(ctx, { ok: true, data: { node_id: nodeId, asset } });
}

export async function handleCanvas(ctx) {
  const session = await requireUser(ctx.request, ctx.env);
  if (session instanceof Response) return session;
  const userId = session.user.id;
  const { pathname, method } = ctx;
  try {
    if (pathname === "/api/account/canvas/models" && method === "GET") {
      const organizationContext = await canvasOrganizationContext(ctx.env, session.user);
      return respond(ctx, {
        ok: true,
        data: {
          models: listCanvasModelsForRole(session.user.role),
          access: {
            role: session.user.role,
            is_admin: session.user.role === "admin",
          },
          organizations: organizationContext.organizations,
          selected_organization_id: organizationContext.selectedOrganizationId,
        },
      });
    }
    if (pathname === "/api/account/canvas/projects" && method === "GET") return await listProjects(ctx, userId);
    // route-policy: account.canvas.projects.create
    if (pathname === "/api/account/canvas/projects" && method === "POST") return await createProject(ctx, userId);

    const projectMatch = pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})$/);
    if (projectMatch && method === "GET") return await getProject(ctx, userId, projectMatch[1]);
    // route-policy: account.canvas.project.update
    if (projectMatch && method === "PATCH") return await updateProject(ctx, userId, projectMatch[1]);
    // route-policy: account.canvas.project.delete
    if (projectMatch && method === "DELETE") return await deleteProject(ctx, userId, projectMatch[1]);

    const nodesMatch = pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/nodes$/);
    // route-policy: account.canvas.nodes.create
    if (nodesMatch && method === "POST") return await createNode(ctx, userId, nodesMatch[1]);
    const nodeMatch = pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/nodes\/([a-f0-9]{32})$/);
    // route-policy: account.canvas.node.update
    if (nodeMatch && method === "PATCH") return await updateNode(ctx, userId, nodeMatch[1], nodeMatch[2]);
    // route-policy: account.canvas.node.delete
    if (nodeMatch && method === "DELETE") return await deleteNode(ctx, userId, nodeMatch[1], nodeMatch[2]);

    const edgesMatch = pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/edges$/);
    // route-policy: account.canvas.edges.create
    if (edgesMatch && method === "POST") return await createEdge(ctx, userId, edgesMatch[1]);
    const edgeMatch = pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/edges\/([a-f0-9]{32})$/);
    // route-policy: account.canvas.edge.update
    if (edgeMatch && method === "PATCH") return await updateEdge(ctx, userId, edgeMatch[1], edgeMatch[2]);
    // route-policy: account.canvas.edge.delete
    if (edgeMatch && method === "DELETE") return await deleteEdge(ctx, userId, edgeMatch[1], edgeMatch[2]);

    const runMatch = pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/nodes\/([a-f0-9]{32})\/run$/);
    // route-policy: account.canvas.node.run
    if (runMatch && method === "POST") return await runNode(ctx, session, runMatch[1], runMatch[2]);
    const assetMatch = pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/nodes\/([a-f0-9]{32})\/asset-reference$/);
    // route-policy: account.canvas.node.asset-reference
    if (assetMatch && method === "POST") return await setAssetReference(ctx, userId, assetMatch[1], assetMatch[2]);
    const nodeRunsMatch = pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/nodes\/([a-f0-9]{32})\/runs$/);
    if (nodeRunsMatch && method === "GET") return await listRuns(ctx, userId, nodeRunsMatch[1], nodeRunsMatch[2]);
    const runsMatch = pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/runs$/);
    if (runsMatch && method === "GET") return await listRuns(ctx, userId, runsMatch[1]);
  } catch (error) {
    const status = Number(error.status || 500);
    if (status >= 500) {
      logDiagnostic({
        service: "bitbi-auth",
        component: "canvas",
        event: "canvas_request_failed",
        level: "error",
        correlationId: ctx.correlationId || null,
        status,
        request_method: method,
        request_path: pathname,
        ...getErrorFields(error, { includeMessage: false }),
      });
    }
    return respond(ctx, {
      ok: false,
      error: status < 500 ? (error.message || "Canvas request failed.") : "Canvas request failed.",
      code: status < 500 ? (error.code || "canvas_request_failed") : "canvas_request_failed",
    }, { status });
  }
  return null;
}
