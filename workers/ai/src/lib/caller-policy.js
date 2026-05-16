import {
  AI_CALLER_POLICY_BODY_KEY,
  AI_CALLER_POLICY_ENFORCEMENT_STATUSES,
  AiCallerPolicyError,
  buildAiCallerPolicyAuditSummary,
  validateAiCallerPolicy,
} from "../../../shared/ai-caller-policy.mjs";
import { errorResponse } from "./responses.js";

const BASELINE_STATUSES = Object.freeze([
  AI_CALLER_POLICY_ENFORCEMENT_STATUSES.GATEWAY_ENFORCED,
  AI_CALLER_POLICY_ENFORCEMENT_STATUSES.BUDGET_POLICY_ENFORCED,
  AI_CALLER_POLICY_ENFORCEMENT_STATUSES.BUDGET_METADATA_ONLY,
  AI_CALLER_POLICY_ENFORCEMENT_STATUSES.CALLER_ENFORCED,
  AI_CALLER_POLICY_ENFORCEMENT_STATUSES.BASELINE_ALLOWED,
  AI_CALLER_POLICY_ENFORCEMENT_STATUSES.EXPLICIT_UNMETERED,
]);

const REQUIRED_VIDEO_TASK_STATUSES = Object.freeze([
  AI_CALLER_POLICY_ENFORCEMENT_STATUSES.CALLER_ENFORCED,
  AI_CALLER_POLICY_ENFORCEMENT_STATUSES.BUDGET_POLICY_ENFORCED,
  AI_CALLER_POLICY_ENFORCEMENT_STATUSES.BUDGET_METADATA_ONLY,
]);

const INTERNAL_AI_CALLER_POLICY_RULES = Object.freeze({
  "/internal/ai/test-text": {
    required: false,
    baselineAllowed: true,
    allowedOperationIds: [
      "admin.text.test",
      "member.music.lyrics.generate",
      "org.text.generate",
      "internal.text.generate",
    ],
    allowedStatuses: BASELINE_STATUSES,
  },
  "/internal/ai/test-image": {
    required: false,
    baselineAllowed: true,
    allowedOperationIds: [
      "admin.image.test.charged",
      "admin.image.test.unmetered",
      "member.image.generate",
      "internal.image.generate",
    ],
    allowedStatuses: BASELINE_STATUSES,
  },
  "/internal/ai/test-embeddings": {
    required: false,
    baselineAllowed: true,
    allowedOperationIds: ["admin.embeddings.test", "internal.embeddings.generate"],
    allowedStatuses: BASELINE_STATUSES,
  },
  "/internal/ai/test-music": {
    required: false,
    baselineAllowed: true,
    allowedOperationIds: [
      "admin.music.test",
      "member.music.generate",
      "member.music.audio.generate",
      "internal.music.generate",
    ],
    allowedStatuses: BASELINE_STATUSES,
  },
  "/internal/ai/compare": {
    required: false,
    baselineAllowed: true,
    allowedOperationIds: ["admin.compare", "internal.compare"],
    allowedStatuses: BASELINE_STATUSES,
  },
  "/internal/ai/test-video": {
    required: false,
    baselineAllowed: true,
    allowedOperationIds: ["admin.video.sync_debug", "member.video.generate", "internal.video.generate"],
    allowedStatuses: BASELINE_STATUSES,
  },
  "/internal/ai/video-task/create": {
    required: true,
    baselineAllowed: false,
    allowedOperationIds: ["admin.video.task.create", "internal.video_task.create"],
    allowedStatuses: REQUIRED_VIDEO_TASK_STATUSES,
  },
  "/internal/ai/video-task/poll": {
    required: true,
    baselineAllowed: false,
    allowedOperationIds: ["admin.video.task.poll", "internal.video_task.poll"],
    allowedStatuses: REQUIRED_VIDEO_TASK_STATUSES,
  },
  "/internal/ai/live-agent": {
    required: true,
    baselineAllowed: false,
    allowedOperationIds: ["admin.live_agent", "internal.live_agent"],
    allowedStatuses: REQUIRED_VIDEO_TASK_STATUSES,
  },
});

function callerPolicyResponse(message, { status = 400, code = "ai_caller_policy_invalid" } = {}) {
  return errorResponse(message, { status, code });
}

async function readCallerPolicyFromRequest(request) {
  if (request.method === "GET" || request.method === "HEAD") return null;
  let body;
  try {
    body = await request.clone().json();
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return Object.prototype.hasOwnProperty.call(body, AI_CALLER_POLICY_BODY_KEY)
    ? body[AI_CALLER_POLICY_BODY_KEY]
    : null;
}

export async function evaluateInternalAiCallerPolicy(ctx) {
  const rule = INTERNAL_AI_CALLER_POLICY_RULES[ctx.pathname];
  if (!rule) {
    return {
      classification: "not_provider_cost",
      callerPolicy: null,
      audit: null,
      response: null,
    };
  }

  const rawPolicy = await readCallerPolicyFromRequest(ctx.request);
  if (!rawPolicy) {
    if (rule.required) {
      return {
        classification: "missing_policy",
        callerPolicy: null,
        audit: null,
        response: callerPolicyResponse("Caller policy is required for this internal AI route.", {
          status: 428,
          code: "ai_caller_policy_required",
        }),
      };
    }
    return {
      classification: "baseline_allowed",
      callerPolicy: null,
      audit: {
        policy_version: null,
        operation_id: null,
        enforcement_status: AI_CALLER_POLICY_ENFORCEMENT_STATUSES.BASELINE_ALLOWED,
        source_route: ctx.pathname,
        reason: "known_baseline_route_without_caller_policy",
      },
      response: null,
    };
  }

  try {
    const callerPolicy = validateAiCallerPolicy(rawPolicy, {
      required: true,
      allowedOperationIds: rule.allowedOperationIds,
      allowedStatuses: rule.allowedStatuses,
    });
    return {
      classification: callerPolicy.enforcement_status,
      callerPolicy,
      audit: buildAiCallerPolicyAuditSummary(callerPolicy),
      response: null,
    };
  } catch (error) {
    const status = error instanceof AiCallerPolicyError ? error.status : 400;
    const code = error instanceof AiCallerPolicyError ? error.code : "ai_caller_policy_invalid";
    return {
      classification: "invalid_policy",
      callerPolicy: null,
      audit: null,
      response: callerPolicyResponse("Caller policy is invalid for this internal AI route.", {
        status,
        code,
      }),
    };
  }
}

export function getInternalAiCallerPolicyRule(pathname) {
  return INTERNAL_AI_CALLER_POLICY_RULES[pathname] || null;
}
