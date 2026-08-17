import {
  GROK_4_6_MODEL_ID,
  GROK_IMAGE_MIME_TYPES,
  GROK_MAX_IMAGE_BYTES,
  GROK_MAX_IMAGE_DIMENSION,
  GROK_PENDING_ATTACHMENT_RETENTION_SECONDS,
} from "../../../shared/grok-chat-contract.mjs";
import { FableChatError, normalizeFableChatConversationId } from "./fable-chat.js";
import { nowIso, randomTokenHex, sha256Hex } from "./tokens.js";

const ATTACHMENT_ID_PATTERN = /^fba_[a-f0-9]{32}$/;
const EXTENSION_BY_MIME = Object.freeze({
  "image/png": new Set(["png"]),
  "image/jpeg": new Set(["jpg", "jpeg"]),
  "image/webp": new Set(["webp"]),
});

function attachmentId(value) {
  const normalized = String(value || "").trim();
  if (!ATTACHMENT_ID_PATTERN.test(normalized)) {
    throw new FableChatError("Attachment ID is invalid.", { code: "validation_error" });
  }
  return normalized;
}

function bytesMimeType(bytes) {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function normalizedDimension(value) {
  const number = Math.round(Number(value));
  return Number.isInteger(number) && number >= 1 && number <= GROK_MAX_IMAGE_DIMENSION
    ? number : null;
}

async function normalizedImage(env, file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new FableChatError("An image file is required.", { code: "validation_error" });
  }
  const name = String(file.name || "");
  const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  const claimedMime = String(file.type || "").toLowerCase();
  if (!GROK_IMAGE_MIME_TYPES.includes(claimedMime)
    || !EXTENSION_BY_MIME[claimedMime]?.has(extension)) {
    throw new FableChatError("The image type or extension is not supported.", {
      code: "validation_error",
    });
  }
  if (Number(file.size) < 1 || Number(file.size) > GROK_MAX_IMAGE_BYTES) {
    throw new FableChatError("The image is too large.", {
      status: 413,
      code: "grok_attachment_too_large",
    });
  }
  const input = new Uint8Array(await file.arrayBuffer());
  if (input.byteLength !== Number(file.size) || bytesMimeType(input) !== claimedMime) {
    throw new FableChatError("The image signature does not match its type.", {
      code: "validation_error",
    });
  }
  if (!env?.IMAGES || typeof env.IMAGES.info !== "function" || typeof env.IMAGES.input !== "function") {
    throw new FableChatError("Private image processing is unavailable.", {
      status: 503,
      code: "grok_attachment_processing_unavailable",
    });
  }
  let sourceInfo;
  try {
    sourceInfo = await env.IMAGES.info(input);
  } catch {
    throw new FableChatError("The image is malformed.", { code: "validation_error" });
  }
  if (!normalizedDimension(sourceInfo?.width) || !normalizedDimension(sourceInfo?.height)) {
    throw new FableChatError("The image dimensions are not supported.", {
      code: "validation_error",
    });
  }
  let transformed;
  try {
    transformed = await env.IMAGES.input(input)
      .transform({
        width: GROK_MAX_IMAGE_DIMENSION,
        height: GROK_MAX_IMAGE_DIMENSION,
        fit: "scale-down",
      })
      .output({ format: "image/webp", quality: 90 });
  } catch {
    throw new FableChatError("The image could not be normalized safely.", {
      code: "validation_error",
    });
  }
  let response;
  if (typeof transformed?.response === "function") response = transformed.response();
  else if (typeof transformed?.arrayBuffer === "function") response = transformed;
  else if (typeof transformed?.image === "function") {
    response = new Response(transformed.image(), { headers: { "content-type": "image/webp" } });
  } else {
    throw new FableChatError("Private image processing is unavailable.", {
      status: 503,
      code: "grok_attachment_processing_unavailable",
    });
  }
  const output = new Uint8Array(await response.arrayBuffer());
  if (output.byteLength < 1 || output.byteLength > GROK_MAX_IMAGE_BYTES
    || bytesMimeType(output) !== "image/webp") {
    throw new FableChatError("The normalized image is invalid.", { code: "validation_error" });
  }
  let outputInfo;
  try {
    outputInfo = await env.IMAGES.info(output);
  } catch {
    throw new FableChatError("The normalized image is invalid.", { code: "validation_error" });
  }
  const width = normalizedDimension(outputInfo?.width);
  const height = normalizedDimension(outputInfo?.height);
  if (!width || !height) {
    throw new FableChatError("The normalized image dimensions are invalid.", {
      code: "validation_error",
    });
  }
  return { bytes: output, mimeType: "image/webp", width, height };
}

async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function assertGrokConversation(env, adminUserId, conversationId) {
  const id = normalizeFableChatConversationId(conversationId);
  const conversation = await env.DB.prepare(
    `SELECT id FROM fable_chat_conversations
      WHERE id = ? AND admin_user_id = ? AND model_id = ? AND deleted_at IS NULL LIMIT 1`
  ).bind(id, adminUserId, GROK_4_6_MODEL_ID).first();
  if (!conversation) {
    throw new FableChatError("Conversation not found.", { status: 404, code: "not_found" });
  }
  return id;
}

export async function createGrokChatAttachment(env, adminUserId, conversationId, file) {
  const id = await assertGrokConversation(env, adminUserId, conversationId);
  if (!env?.USER_IMAGES || typeof env.USER_IMAGES.put !== "function") {
    throw new FableChatError("Private image storage is unavailable.", {
      status: 503,
      code: "grok_attachment_storage_unavailable",
    });
  }
  const image = await normalizedImage(env, file);
  const attachment = `fba_${randomTokenHex(16)}`;
  const ownerHash = await sha256Hex(`van-ark-chat-owner\n${adminUserId}`);
  const key = `van-ark-chat/${ownerHash}/${id}/${attachment}.webp`;
  const sha256 = await sha256Bytes(image.bytes);
  const createdAt = nowIso();
  const expiresAt = new Date(
    Date.now() + GROK_PENDING_ATTACHMENT_RETENTION_SECONDS * 1_000
  ).toISOString();
  await env.USER_IMAGES.put(key, image.bytes, {
    httpMetadata: { contentType: image.mimeType },
    customMetadata: { purpose: "van-ark-chat-attachment", attachment_id: attachment },
  });
  try {
    await env.DB.prepare(
      `INSERT INTO fable_chat_attachments (
         id, conversation_id, message_id, admin_user_id, model_id, r2_key, sha256,
         mime_type, byte_size, width, height, state, created_at, expires_at
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).bind(
      attachment,
      id,
      adminUserId,
      GROK_4_6_MODEL_ID,
      key,
      sha256,
      image.mimeType,
      image.bytes.byteLength,
      image.width,
      image.height,
      createdAt,
      expiresAt
    ).run();
  } catch (error) {
    try {
      await env.USER_IMAGES.delete(key);
    } catch {
      // The caller receives the persistence failure; scheduled storage auditing handles rare orphans.
    }
    throw error;
  }
  return {
    id: attachment,
    mimeType: image.mimeType,
    byteSize: image.bytes.byteLength,
    width: image.width,
    height: image.height,
    state: "pending",
    createdAt,
    expiresAt,
    previewUrl: `/api/admin/chat/conversations/${id}/attachments/${attachment}`,
  };
}

async function readOwnedAttachment(env, adminUserId, conversationId, rawAttachmentId) {
  const id = await assertGrokConversation(env, adminUserId, conversationId);
  const attachment = attachmentId(rawAttachmentId);
  const row = await env.DB.prepare(
    `SELECT id, r2_key, sha256, mime_type, byte_size, state, created_at, expires_at
       FROM fable_chat_attachments
      WHERE id = ? AND conversation_id = ? AND admin_user_id = ? AND model_id = ?
        AND state IN ('pending', 'attached') AND deleted_at IS NULL LIMIT 1`
  ).bind(attachment, id, adminUserId, GROK_4_6_MODEL_ID).first();
  if (!row) throw new FableChatError("Attachment not found.", { status: 404, code: "not_found" });
  return row;
}

export async function getGrokChatAttachmentResponse(env, adminUserId, conversationId, rawAttachmentId) {
  const row = await readOwnedAttachment(env, adminUserId, conversationId, rawAttachmentId);
  if (!env?.USER_IMAGES || typeof env.USER_IMAGES.get !== "function") {
    throw new FableChatError("Private image storage is unavailable.", {
      status: 503,
      code: "grok_attachment_storage_unavailable",
    });
  }
  const object = await env.USER_IMAGES.get(row.r2_key);
  if (!object) throw new FableChatError("Attachment not found.", { status: 404, code: "not_found" });
  const bytes = await object.arrayBuffer();
  const digest = await sha256Bytes(bytes);
  if (bytes.byteLength !== Number(row.byte_size) || digest !== row.sha256) {
    throw new FableChatError("The attachment failed integrity validation.", {
      status: 503,
      code: "grok_attachment_integrity_failed",
    });
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": row.mime_type,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function deletePendingGrokChatAttachment(
  env,
  adminUserId,
  conversationId,
  rawAttachmentId
) {
  const row = await readOwnedAttachment(env, adminUserId, conversationId, rawAttachmentId);
  if (row.state !== "pending") {
    throw new FableChatError("An attachment already used by a message cannot be removed here.", {
      status: 409,
      code: "grok_attachment_already_attached",
    });
  }
  const deletedAt = nowIso();
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO r2_cleanup_queue (r2_key, status, created_at)
       SELECT r2_key, 'pending', ? FROM fable_chat_attachments
        WHERE id = ? AND conversation_id = ? AND admin_user_id = ?
          AND state = 'pending' AND deleted_at IS NULL`
    ).bind(deletedAt, row.id, normalizeFableChatConversationId(conversationId), adminUserId),
    env.DB.prepare(
      `UPDATE fable_chat_attachments SET state = 'deleted', deleted_at = ?
        WHERE id = ? AND conversation_id = ? AND admin_user_id = ?
          AND state = 'pending' AND deleted_at IS NULL`
    ).bind(deletedAt, row.id, normalizeFableChatConversationId(conversationId), adminUserId),
  ]);
  return Number(results?.[1]?.meta?.changes || 0) > 0;
}

export async function cleanupExpiredGrokChatAttachments(env, { limit = 50, now = nowIso() } = {}) {
  const appliedLimit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 50)));
  const rows = await env.DB.prepare(
    `SELECT id FROM fable_chat_attachments
      WHERE state IN ('pending', 'attached') AND deleted_at IS NULL AND expires_at <= ?
      ORDER BY expires_at ASC, id ASC LIMIT ?`
  ).bind(now, appliedLimit).all();
  let deleted = 0;
  for (const row of rows?.results || []) {
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO r2_cleanup_queue (r2_key, status, created_at)
         SELECT r2_key, 'pending', ? FROM fable_chat_attachments
          WHERE id = ? AND state IN ('pending', 'attached') AND deleted_at IS NULL`
      ).bind(now, row.id),
      env.DB.prepare(
        `UPDATE fable_chat_attachments SET state = 'deleted', deleted_at = ?
          WHERE id = ? AND state IN ('pending', 'attached') AND deleted_at IS NULL`
      ).bind(now, row.id),
    ]);
    deleted += Number(results?.[1]?.meta?.changes || 0);
  }
  return { scanned: (rows?.results || []).length, deleted };
}
