import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROUTE_POLICIES,
  getRoutePolicy,
  validateRoutePolicies,
} from "../workers/auth/src/app/route-policy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ROUTE_POLICY_MARKER = /route-policy:\s*([a-z0-9_.-]+)/i;
const METHOD_COMPARISON = /\bmethod\s*===\s*["'](POST|PUT|PATCH|DELETE)["']/;
const MAX_SAFE_DIAGNOSTIC_INPUT_LENGTH = 1000;
const MAX_SAFE_DIAGNOSTIC_OUTPUT_LENGTH = 240;
const SENSITIVE_DIAGNOSTIC_PATTERNS = [
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_=-]+\b/g,
  /\bwhsec_[A-Za-z0-9_=-]+\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
  /\b(?:session|cookie|token|secret|password|authorization)\s*[:=]\s*["']?[^"',\s;]+/gi,
  /\b(?:Stripe-Signature|Set-Cookie|Cookie)\s*:\s*[^,\s;]+/gi,
  /\b(?:mfa|totp|recovery[_-]?code)\s*[:=]\s*["']?[^"',\s;]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:[A-Za-z0-9_-]+\/){2,}[A-Za-z0-9_.-]+\b/g,
];

const MUTATING_DISPATCH_FILES = [
  "workers/auth/src/index.js",
  "workers/auth/src/routes/admin.js",
  "workers/auth/src/routes/admin-billing.js",
  "workers/auth/src/routes/admin-orgs.js",
  "workers/auth/src/routes/admin-r2-explorer.js",
  "workers/auth/src/routes/admin-storage.js",
  "workers/auth/src/routes/admin-tenant-assets.js",
  "workers/auth/src/routes/admin-data-lifecycle.js",
  "workers/auth/src/routes/admin-ai.js",
  "workers/auth/src/routes/admin-fable-chat.js",
  "workers/auth/src/routes/admin-fable-chat-data.js",
  "workers/auth/src/routes/admin-news-pulse.js",
  "workers/auth/src/routes/admin-mfa.js",
  "workers/auth/src/routes/homepage-hero-videos.js",
  "workers/auth/src/routes/video-gallery.js",
  "workers/auth/src/routes/media-comments.js",
  "workers/auth/src/routes/media-interactions.js",
  "workers/auth/src/routes/ai.js",
  "workers/auth/src/routes/canvas.js",
  "workers/auth/src/routes/orgs.js",
];

const REQUIRED_LOOKUPS = [
  ["GET", "/api/admin/fable-chat/conversations", "admin.fable-chat.conversations.list"],
  ["POST", "/api/admin/fable-chat/conversations", "admin.fable-chat.conversations.create"],
  ["GET", "/api/admin/fable-chat/conversations/fbc_0123456789abcdef0123456789abcdef", "admin.fable-chat.conversations.read"],
  ["PATCH", "/api/admin/fable-chat/conversations/fbc_0123456789abcdef0123456789abcdef", "admin.fable-chat.conversations.rename"],
  ["DELETE", "/api/admin/fable-chat/conversations/fbc_0123456789abcdef0123456789abcdef", "admin.fable-chat.conversations.delete"],
  ["POST", "/api/admin/fable-chat/conversations/fbc_0123456789abcdef0123456789abcdef/messages", "admin.fable-chat.messages.send"],
  ["GET", "/api/admin/fable-chat/conversations/fbc_0123456789abcdef0123456789abcdef/settings", "admin.fable-chat.conversations.settings.read"],
  ["PATCH", "/api/admin/fable-chat/conversations/fbc_0123456789abcdef0123456789abcdef/settings", "admin.fable-chat.conversations.settings.update"],
  ["POST", "/api/admin/fable-chat/conversations/fbc_0123456789abcdef0123456789abcdef/messages/stream", "admin.fable-chat.messages.stream"],
  ["GET", "/api/admin/fable-chat-data/overview", "admin.fable-chat-data.overview"],
  ["GET", "/api/admin/fable-chat-data/conversations", "admin.fable-chat-data.conversations.list"],
  ["GET", "/api/admin/fable-chat-data/conversations/fbc_0123456789abcdef0123456789abcdef", "admin.fable-chat-data.conversations.read"],
  ["GET", "/api/admin/fable-chat-data/conversations/fbc_0123456789abcdef0123456789abcdef/transcript", "admin.fable-chat-data.transcript.list"],
  ["GET", "/api/admin/fable-chat-data/conversations/fbc_0123456789abcdef0123456789abcdef/attempts", "admin.fable-chat-data.attempts.list"],
  ["GET", "/api/admin/fable-chat-data/conversations/fbc_0123456789abcdef0123456789abcdef/checkpoints", "admin.fable-chat-data.checkpoints.list"],
  ["GET", "/api/admin/fable-chat-data/conversations/fbc_0123456789abcdef0123456789abcdef/web-search", "admin.fable-chat-data.web-search.read"],
  ["GET", "/api/admin/fable-chat-data/conversations/fbc_0123456789abcdef0123456789abcdef/usage", "admin.fable-chat-data.usage.list"],
  ["PATCH", "/api/admin/fable-chat-data/conversations/fbc_0123456789abcdef0123456789abcdef", "admin.fable-chat-data.conversation.update"],
  ["PATCH", "/api/admin/fable-chat-data/conversations/fbc_0123456789abcdef0123456789abcdef/messages/fbm_0123456789abcdef0123456789abcdef", "admin.fable-chat-data.message.update"],
  ["POST", "/api/admin/fable-chat-data/conversations/fbc_0123456789abcdef0123456789abcdef/turns/fbt_0123456789abcdef0123456789abcdef/delete", "admin.fable-chat-data.turn.delete"],
  ["POST", "/api/admin/fable-chat-data/conversations/fbc_0123456789abcdef0123456789abcdef/turns/fbt_0123456789abcdef0123456789abcdef/restore", "admin.fable-chat-data.turn.restore"],
  ["POST", "/api/admin/fable-chat-data/conversations/fbc_0123456789abcdef0123456789abcdef/checkpoints/fbk_0123456789abcdef0123456789abcdef/invalidate", "admin.fable-chat-data.checkpoint.invalidate"],
  ["POST", "/api/admin/fable-chat-data/conversations/fbc_0123456789abcdef0123456789abcdef/checkpoints/fbk_0123456789abcdef0123456789abcdef/reveal", "admin.fable-chat-data.checkpoint.reveal"],
  ["GET", "/api/admin/fable-chat-data/conversations/fbc_0123456789abcdef0123456789abcdef/records/turn/fbt_0123456789abcdef0123456789abcdef", "admin.fable-chat-data.records.read"],
  ["POST", "/api/admin/fable-chat-data/conversations/fbc_0123456789abcdef0123456789abcdef/purge", "admin.fable-chat-data.conversation.purge"],
  ["POST", "/api/admin/ai/video-jobs", "admin.ai.video-jobs.create"],
  ["POST", "/api/admin/ai/video-jobs/job-123/recover", "admin.ai.video-jobs.recover"],
  ["GET", "/api/admin/ai/video-jobs/poison", "admin.ai.video-jobs.poison.list"],
  ["GET", "/api/admin/ai/video-jobs/poison/poison-123", "admin.ai.video-jobs.poison.read"],
  ["GET", "/api/admin/ai/video-jobs/failed", "admin.ai.video-jobs.failed.list"],
  ["GET", "/api/admin/ai/video-jobs/failed/job-123", "admin.ai.video-jobs.failed.read"],
  ["GET", "/api/admin/ai/usage-attempts", "admin.ai.usage-attempts.list"],
  ["POST", "/api/admin/ai/usage-attempts/cleanup-expired", "admin.ai.usage-attempts.cleanup-expired"],
  ["GET", "/api/admin/ai/usage-attempts/aua_123", "admin.ai.usage-attempts.read"],
  ["GET", "/api/admin/ai/video-jobs/job-123", "admin.ai.video-jobs.status"],
  ["GET", "/api/admin/ai/video-jobs/job-123/output", "admin.ai.video-jobs.output"],
  ["POST", "/api/admin/ai/test-video", "admin.ai.test-video-debug"],
  ["GET", "/api/admin/homepage/hero-videos/derivatives", "admin.homepage.hero-videos.derivatives.list"],
  ["GET", "/api/admin/homepage/hero-videos/derivatives/hhvd_1234567890abcdef", "admin.homepage.hero-videos.derivatives.detail"],
  ["GET", "/api/admin/data-lifecycle/requests", "admin.data-lifecycle.requests.list"],
  ["POST", "/api/admin/data-lifecycle/requests", "admin.data-lifecycle.requests.create"],
  ["GET", "/api/admin/data-lifecycle/requests/dlr_123", "admin.data-lifecycle.requests.read"],
  ["POST", "/api/admin/data-lifecycle/requests/dlr_123/plan", "admin.data-lifecycle.requests.plan"],
  ["POST", "/api/admin/data-lifecycle/requests/dlr_123/approve", "admin.data-lifecycle.requests.approve"],
  ["POST", "/api/admin/data-lifecycle/requests/dlr_123/generate-export", "admin.data-lifecycle.requests.generate-export"],
  ["POST", "/api/admin/data-lifecycle/requests/dlr_123/execute-safe", "admin.data-lifecycle.requests.execute-safe"],
  ["GET", "/api/admin/data-lifecycle/requests/dlr_123/export", "admin.data-lifecycle.requests.export.read"],
  ["GET", "/api/admin/data-lifecycle/exports", "admin.data-lifecycle.exports.list"],
  ["POST", "/api/admin/data-lifecycle/exports/cleanup-expired", "admin.data-lifecycle.exports.cleanup-expired"],
  ["GET", "/api/admin/data-lifecycle/exports/dla_123", "admin.data-lifecycle.exports.read"],
  ["GET", "/api/admin/users/user_123/storage/reconciliation", "admin.users.storage.reconciliation"],
  ["GET", "/api/admin/r2/buckets", "admin.r2.buckets.list"],
  ["GET", "/api/admin/r2/objects", "admin.r2.objects.list"],
  ["GET", "/api/admin/r2/objects/detail", "admin.r2.objects.detail"],
  ["GET", "/api/admin/r2/objects/file", "admin.r2.objects.file"],
  ["POST", "/api/admin/r2/objects/upload", "admin.r2.objects.upload"],
  ["POST", "/api/admin/r2/folders", "admin.r2.folders.create"],
  ["POST", "/api/admin/r2/objects/copy", "admin.r2.objects.copy"],
  ["POST", "/api/admin/r2/objects/move", "admin.r2.objects.move"],
  ["POST", "/api/admin/r2/objects/delete", "admin.r2.objects.delete"],
  ["GET", "/api/admin/tenant-assets/folders-images/evidence", "admin.tenant-assets.folders-images.evidence.read"],
  ["GET", "/api/admin/tenant-assets/folders-images/evidence/export", "admin.tenant-assets.folders-images.evidence.export"],
  ["GET", "/api/admin/tenant-assets/domains/evidence", "admin.tenant-assets.domains.evidence.read"],
  ["POST", "/api/admin/tenant-assets/folders-images/manual-review/import", "admin.tenant-assets.folders-images.manual-review.import"],
  ["GET", "/api/admin/tenant-assets/folders-images/manual-review/items", "admin.tenant-assets.folders-images.manual-review.items.list"],
  ["GET", "/api/admin/tenant-assets/folders-images/manual-review/items/ta_mri_123", "admin.tenant-assets.folders-images.manual-review.items.read"],
  ["GET", "/api/admin/tenant-assets/folders-images/manual-review/items/ta_mri_123/events", "admin.tenant-assets.folders-images.manual-review.items.events"],
  ["POST", "/api/admin/tenant-assets/folders-images/manual-review/items/ta_mri_123/status", "admin.tenant-assets.folders-images.manual-review.items.status.update"],
  ["GET", "/api/admin/tenant-assets/folders-images/manual-review/evidence", "admin.tenant-assets.folders-images.manual-review.evidence.read"],
  ["GET", "/api/admin/tenant-assets/folders-images/manual-review/evidence/export", "admin.tenant-assets.folders-images.manual-review.evidence.export"],
  ["GET", "/api/admin/tenant-assets/manual-review/post-cleanup/dry-run", "admin.tenant-assets.manual-review.post-cleanup.dry-run"],
  ["GET", "/api/admin/tenant-assets/manual-review/post-cleanup/evidence", "admin.tenant-assets.manual-review.post-cleanup.evidence"],
  ["POST", "/api/admin/tenant-assets/manual-review/post-cleanup/supersede", "admin.tenant-assets.manual-review.post-cleanup.supersede"],
  ["GET", "/api/orgs", "orgs.list"],
  ["POST", "/api/orgs", "orgs.create"],
  ["GET", "/api/orgs/org_0123456789abcdef0123456789abcdef", "orgs.read"],
  ["GET", "/api/orgs/org_0123456789abcdef0123456789abcdef/members", "orgs.members.list"],
  ["POST", "/api/orgs/org_0123456789abcdef0123456789abcdef/members", "orgs.members.add"],
  ["GET", "/api/orgs/org_0123456789abcdef0123456789abcdef/entitlements", "orgs.entitlements.read"],
  ["GET", "/api/orgs/org_0123456789abcdef0123456789abcdef/billing", "orgs.billing.read"],
  ["GET", "/api/orgs/org_0123456789abcdef0123456789abcdef/usage", "orgs.usage.read"],
  ["POST", "/api/orgs/org_0123456789abcdef0123456789abcdef/billing/checkout/credit-pack", "orgs.billing.checkout.credit-pack"],
  ["POST", "/api/account/billing/portal", "account.billing.portal.create"],
  ["GET", "/api/orgs/org_0123456789abcdef0123456789abcdef/organization-dashboard", "orgs.organization-dashboard.read"],
  ["GET", "/api/admin/orgs", "admin.orgs.list"],
  ["GET", "/api/admin/orgs/org_0123456789abcdef0123456789abcdef", "admin.orgs.read"],
  ["GET", "/api/admin/orgs/org_0123456789abcdef0123456789abcdef/user-access", "admin.orgs.user-access.list"],
  ["PUT", "/api/admin/orgs/org_0123456789abcdef0123456789abcdef/users/user_0123456789abcdef", "admin.orgs.users.assign"],
  ["DELETE", "/api/admin/orgs/org_0123456789abcdef0123456789abcdef/users/user_0123456789abcdef", "admin.orgs.users.remove"],
  ["GET", "/api/admin/billing/plans", "admin.billing.plans.list"],
  ["GET", "/api/admin/orgs/org_0123456789abcdef0123456789abcdef/billing", "admin.orgs.billing.read"],
  ["POST", "/api/admin/orgs/org_0123456789abcdef0123456789abcdef/credits/grant", "admin.orgs.credits.grant"],
  ["GET", "/api/admin/billing/live-readiness/status", "admin.billing.live-readiness.status"],
  ["GET", "/api/admin/billing/events", "admin.billing.events.list"],
  ["GET", "/api/admin/billing/events/bpe_0123456789abcdef0123456789abcdef", "admin.billing.events.read"],
  ["GET", "/api/admin/billing/reconciliation", "admin.billing.reconciliation.read"],
  ["GET", "/api/admin/billing/reviews", "admin.billing.reviews.list"],
  ["GET", "/api/admin/billing/reviews/bpe_0123456789abcdef0123456789abcdef", "admin.billing.reviews.read"],
  ["POST", "/api/admin/billing/reviews/bpe_0123456789abcdef0123456789abcdef/resolution", "admin.billing.reviews.resolve"],
  ["POST", "/api/billing/webhooks/test", "billing.webhooks.test"],
  ["POST", "/api/billing/webhooks/stripe", "billing.webhooks.stripe"],
  ["POST", "/api/ai/generate-text", "ai.generate-text"],
  ["GET", "/api/account/canvas/models", "account.canvas.models.read"],
  ["GET", "/api/account/canvas/projects", "account.canvas.projects.read"],
  ["POST", "/api/account/canvas/projects", "account.canvas.projects.create"],
  ["GET", "/api/account/canvas/projects/11111111111111111111111111111111", "account.canvas.project.read"],
  ["PATCH", "/api/account/canvas/projects/11111111111111111111111111111111", "account.canvas.project.update"],
  ["DELETE", "/api/account/canvas/projects/11111111111111111111111111111111", "account.canvas.project.delete"],
  ["POST", "/api/account/canvas/projects/11111111111111111111111111111111/nodes", "account.canvas.nodes.create"],
  ["PATCH", "/api/account/canvas/projects/11111111111111111111111111111111/nodes/22222222222222222222222222222222", "account.canvas.node.update"],
  ["DELETE", "/api/account/canvas/projects/11111111111111111111111111111111/nodes/22222222222222222222222222222222", "account.canvas.node.delete"],
  ["POST", "/api/account/canvas/projects/11111111111111111111111111111111/edges", "account.canvas.edges.create"],
  ["PATCH", "/api/account/canvas/projects/11111111111111111111111111111111/edges/33333333333333333333333333333333", "account.canvas.edge.update"],
  ["DELETE", "/api/account/canvas/projects/11111111111111111111111111111111/edges/33333333333333333333333333333333", "account.canvas.edge.delete"],
  ["POST", "/api/account/canvas/projects/11111111111111111111111111111111/nodes/22222222222222222222222222222222/run", "account.canvas.node.run"],
  ["GET", "/api/account/canvas/projects/11111111111111111111111111111111/runs", "account.canvas.runs.read"],
  ["GET", "/api/account/canvas/projects/11111111111111111111111111111111/nodes/22222222222222222222222222222222/runs", "account.canvas.node.runs.read"],
  ["POST", "/api/account/canvas/projects/11111111111111111111111111111111/nodes/22222222222222222222222222222222/asset-reference", "account.canvas.node.asset-reference"],
];

const HIGH_RISK_ADMIN_MUTATION_EXPECTATIONS = [
  {
    id: "admin.users.role.update",
    requiredNoteFragments: ["same-origin JSON", "audit logging", "single target-state overwrite"],
  },
  {
    id: "admin.users.status.update",
    requiredNoteFragments: ["same-origin JSON", "audit logging", "single target-state overwrite"],
  },
  {
    id: "admin.users.sessions.revoke",
    requiredNoteFragments: ["confirm=true", "confirmation=revoke_sessions", "audit logging"],
  },
  {
    id: "admin.users.delete",
    requiredNoteFragments: ["confirm=true", "confirmation=delete_user", "audit logging"],
  },
  {
    id: "admin.users.storage.asset.rename",
    requiredNoteFragments: ["same-origin JSON", "audit logging", "no raw R2 key"],
  },
  {
    id: "admin.users.storage.asset.move",
    requiredNoteFragments: ["same-origin JSON", "audit logging", "no raw R2 key"],
  },
  {
    id: "admin.users.storage.asset.visibility",
    requiredNoteFragments: ["same-origin JSON", "audit logging", "no raw R2 key"],
  },
  {
    id: "admin.users.storage.asset.delete",
    requiredNoteFragments: ["Idempotency-Key", "confirm=true", "confirmation=delete_user_asset", "audit logging", "never accepts raw R2 keys"],
  },
  {
    id: "admin.users.storage.folder.rename",
    requiredNoteFragments: ["same-origin JSON", "audit logging"],
  },
  {
    id: "admin.users.storage.folder.delete",
    requiredNoteFragments: ["Idempotency-Key", "confirm=true", "confirmation=delete_user_folder", "audit logging", "scoped to the selected user"],
  },
  {
    id: "admin.r2.objects.upload",
    requiredNoteFragments: ["Idempotency-Key", "bounded operator reason", "allowlisted bucket", "audit logging"],
  },
  {
    id: "admin.r2.objects.move",
    requiredNoteFragments: ["Idempotency-Key", "copy-before-delete", "DB-linked/app-managed R2 keys are blocked", "audit logging"],
  },
  {
    id: "admin.r2.objects.delete",
    requiredNoteFragments: ["Idempotency-Key", "confirm=true", "confirmation=DELETE R2 OBJECTS", "DB-linked/app-managed R2 objects are blocked", "audit logging"],
  },
  {
    id: "admin.data-lifecycle.requests.create",
    requiredNoteFragments: ["Idempotency-Key", "audit logging", "no export/delete execution"],
  },
  {
    id: "admin.data-lifecycle.requests.plan",
    requiredNoteFragments: ["Idempotency-Key", "audit logging"],
  },
  {
    id: "admin.data-lifecycle.requests.approve",
    requiredNoteFragments: ["Idempotency-Key", "confirm=true", "audit logging"],
  },
  {
    id: "admin.data-lifecycle.requests.generate-export",
    requiredNoteFragments: ["Idempotency-Key", "confirm=true", "bounded archive output", "raw private R2 key redaction"],
  },
  {
    id: "admin.data-lifecycle.requests.execute-safe",
    requiredNoteFragments: ["Idempotency-Key", "dryRun=false", "confirm=true", "approved plan state"],
  },
  {
    id: "admin.data-lifecycle.exports.cleanup-expired",
    requiredNoteFragments: ["Idempotency-Key", "confirm=true", "approved data-exports/ prefix validation"],
  },
  {
    id: "admin.orgs.credits.grant",
    requiredNoteFragments: ["Idempotency-Key", "admin-only manual grant"],
  },
  {
    id: "admin.orgs.users.assign",
    requiredNoteFragments: ["Idempotency-Key", "organization_memberships", "Admin AI organization-context guards"],
  },
  {
    id: "admin.orgs.users.remove",
    requiredNoteFragments: ["Idempotency-Key", "final owner/admin protection", "Admin AI organization-context guards"],
  },
  {
    id: "admin.users.credits.grant",
    requiredNoteFragments: ["Idempotency-Key", "admin-only manual grant"],
  },
  {
    id: "admin.billing.reviews.resolve",
    requiredNoteFragments: ["Idempotency-Key", "does not call Stripe", "credit accounts"],
  },
  {
    id: "admin.tenant-assets.folders-images.manual-review.import",
    requiredNoteFragments: ["Idempotency-Key", "confirm=true"],
  },
  {
    id: "admin.tenant-assets.folders-images.manual-review.items.status.update",
    requiredNoteFragments: ["Idempotency-Key", "confirm=true"],
  },
  {
    id: "admin.tenant-assets.manual-review.post-cleanup.supersede",
    requiredNoteFragments: ["Idempotency-Key", "confirm=true", "SUPERSEDE STALE REVIEW ITEMS", "Dry-run is default"],
  },
  {
    id: "admin.tenant-assets.legacy-media-reset.execute",
    requiredNoteFragments: [
      "ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION",
      "Idempotency-Key",
      "confirm=true",
    ],
  },
];

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function redactSensitiveDiagnosticText(value) {
  let output = value;
  for (const pattern of SENSITIVE_DIAGNOSTIC_PATTERNS) {
    output = output.replace(pattern, "[redacted]");
  }
  return output;
}

function renderSafeRoutePolicyIssue(issue, index) {
  if (typeof issue !== "string" || issue.length === 0 || issue.length > MAX_SAFE_DIAGNOSTIC_INPUT_LENGTH) {
    return `route policy issue #${index + 1}`;
  }
  const normalized = issue
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!normalized) return `route policy issue #${index + 1}`;

  const redacted = redactSensitiveDiagnosticText(normalized);
  if (redacted.length <= MAX_SAFE_DIAGNOSTIC_OUTPUT_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_SAFE_DIAGNOSTIC_OUTPUT_LENGTH - 1)}…`;
}

function policyMap() {
  return new Map(ROUTE_POLICIES.map((entry) => [entry.id, entry]));
}

function getMarkerForLine(lines, lineIndex) {
  const start = Math.max(0, lineIndex - 8);
  const window = lines.slice(start, lineIndex + 1).join("\n");
  const matches = [...window.matchAll(new RegExp(ROUTE_POLICY_MARKER, "gi"))];
  return matches.at(-1)?.[1] || null;
}

function scanMutatingDispatchMarkers(issues) {
  const byId = policyMap();
  const seenMutatingMarkers = new Set();

  for (const relativePath of MUTATING_DISPATCH_FILES) {
    const source = readRepoFile(relativePath);
    const lines = source.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const method = line.match(METHOD_COMPARISON)?.[1];
      if (!method) continue;

      const marker = getMarkerForLine(lines, index);
      const location = `${relativePath}:${index + 1}`;
      if (!marker) {
        issues.push(`${location}: mutating route branch is missing a route-policy marker.`);
        continue;
      }

      const entry = byId.get(marker);
      if (!entry) {
        issues.push(`${location}: route-policy marker "${marker}" is not registered.`);
        continue;
      }
      if (entry.method !== method) {
        issues.push(`${location}: route-policy "${marker}" declares ${entry.method}, but branch checks ${method}.`);
      }
      seenMutatingMarkers.add(marker);
    }
  }

  for (const entry of ROUTE_POLICIES) {
    if (!MUTATING_METHODS.has(entry.method)) continue;
    if (!seenMutatingMarkers.has(entry.id)) {
      issues.push(`${entry.id}: mutating registered policy is not tied to a route-policy marker in the dispatcher files.`);
    }
  }
}

function checkPolicySemantics(issues) {
  for (const entry of ROUTE_POLICIES) {
    if (MUTATING_METHODS.has(entry.method) && entry.csrf !== "same-origin-required" && entry.csrf !== "not-browser-facing") {
      issues.push(`${entry.id}: mutating route must require same-origin CSRF or be explicitly non-browser-facing.`);
    }
    if (entry.body?.kind !== "none" && !entry.body?.maxBytesName) {
      issues.push(`${entry.id}: body-parsing route is missing maxBytesName.`);
    }
    if (entry.path.startsWith("/api/admin/") && (entry.auth !== "admin" || entry.mfa === "none")) {
      issues.push(`${entry.id}: admin route must declare admin auth and MFA policy.`);
    }
    if (entry.path.includes("/internal/") && entry.csrf !== "not-browser-facing") {
      issues.push(`${entry.id}: internal routes must be marked not-browser-facing.`);
    }
    if (entry.sensitivity === "high" && entry.rateLimit?.id && entry.rateLimit.failClosed !== true) {
      issues.push(`${entry.id}: high-sensitivity rate limit must be fail-closed.`);
    }
    if (entry.debugGate && !entry.rateLimit?.id) {
      issues.push(`${entry.id}: debug-gated route must still declare a rate limit.`);
    }
  }
}

function checkHighRiskAdminMutationExpectations(issues) {
  const byId = policyMap();
  for (const expectation of HIGH_RISK_ADMIN_MUTATION_EXPECTATIONS) {
    const entry = byId.get(expectation.id);
    if (!entry) {
      issues.push(`${expectation.id}: high-risk admin mutation policy is missing.`);
      continue;
    }
    if (entry.auth !== "admin" || entry.mfa === "none") {
      issues.push(`${expectation.id}: high-risk admin mutation must require admin auth and MFA.`);
    }
    if (entry.csrf !== "same-origin-required") {
      issues.push(`${expectation.id}: high-risk admin mutation must require same-origin CSRF.`);
    }
    if (entry.rateLimit?.failClosed !== true) {
      issues.push(`${expectation.id}: high-risk admin mutation rate limit must fail closed.`);
    }
    if (!entry.audit?.event) {
      issues.push(`${expectation.id}: high-risk admin mutation must declare an audit event.`);
    }
    const notes = String(entry.notes || "");
    for (const fragment of expectation.requiredNoteFragments || []) {
      if (!notes.includes(fragment)) {
        issues.push(`${expectation.id}: high-risk admin mutation notes must mention ${JSON.stringify(fragment)}.`);
      }
    }
  }
}

function checkLookupExamples(issues) {
  for (const [method, pathname, expectedId] of REQUIRED_LOOKUPS) {
    const entry = getRoutePolicy(method, pathname);
    if (entry?.id !== expectedId) {
      issues.push(`${method} ${pathname}: expected policy ${expectedId}, got ${entry?.id || "none"}.`);
    }
  }
}

const issues = [
  ...validateRoutePolicies(),
];
scanMutatingDispatchMarkers(issues);
checkPolicySemantics(issues);
checkHighRiskAdminMutationExpectations(issues);
checkLookupExamples(issues);

if (issues.length > 0) {
  const safeDiagnostics = issues.map((issue, index) => `- ${renderSafeRoutePolicyIssue(issue, index)}`);
  console.error(["Route policy guard failed:", ...safeDiagnostics].join("\n"));
  process.exit(1);
}

console.log(`Route policy guard passed for ${ROUTE_POLICIES.length} registered auth-worker route policies.`);
