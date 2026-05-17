import { json } from "../lib/response.js";
import {
  BODY_LIMITS,
  readJsonBodyOrResponse,
} from "../lib/request.js";
import { requireAdmin } from "../lib/session.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
  sensitiveRateLimitOptions,
} from "../lib/rate-limit.js";
import {
  TENANT_ASSET_OWNERSHIP_EVIDENCE_EXPORT_ENDPOINT,
  TENANT_ASSET_OWNERSHIP_EVIDENCE_ENDPOINT,
  TenantAssetEvidenceReportError,
  buildTenantAssetOwnershipEvidenceReport,
  exportTenantAssetOwnershipEvidenceReportJson,
  exportTenantAssetOwnershipEvidenceReportMarkdown,
  tenantAssetEvidenceOptionsFromSearch,
} from "../lib/tenant-asset-evidence-report.js";
import {
  TENANT_ASSET_MANUAL_REVIEW_IMPORT_ENDPOINT,
  TenantAssetManualReviewImportError,
  importTenantAssetManualReviewItems,
  serializeManualReviewImportResult,
} from "../lib/tenant-asset-manual-review-import.js";
import {
  TENANT_ASSET_MANUAL_REVIEW_EVIDENCE_ENDPOINT,
  TENANT_ASSET_MANUAL_REVIEW_EVIDENCE_EXPORT_ENDPOINT,
  TENANT_ASSET_MANUAL_REVIEW_ITEMS_ENDPOINT,
  TenantAssetManualReviewQueueError,
  buildTenantAssetManualReviewEvidenceReport,
  exportTenantAssetManualReviewEvidenceReportJson,
  exportTenantAssetManualReviewEvidenceReportMarkdown,
  getTenantAssetManualReviewItem,
  listTenantAssetManualReviewEvents,
  listTenantAssetManualReviewItems,
  tenantAssetManualReviewEvidenceOptionsFromSearch,
  tenantAssetManualReviewQueueOptionsFromSearch,
} from "../lib/tenant-asset-manual-review-queue.js";
import {
  TENANT_ASSET_MANUAL_REVIEW_STATUS_ENDPOINT_SUFFIX,
  TenantAssetManualReviewStatusError,
  serializeManualReviewStatusUpdateResult,
  updateTenantAssetManualReviewStatus,
} from "../lib/tenant-asset-manual-review-status.js";
import {
  TENANT_ASSET_LEGACY_MEDIA_RESET_DRY_RUN_ENDPOINT,
  TENANT_ASSET_LEGACY_MEDIA_RESET_DRY_RUN_EXPORT_ENDPOINT,
  TenantAssetLegacyMediaResetError,
  buildLegacyMediaResetDryRunReport,
  exportLegacyMediaResetDryRunReportJson,
  exportLegacyMediaResetDryRunReportMarkdown,
  legacyMediaResetDryRunOptionsFromSearch,
  serializeLegacyMediaResetDryRunReport,
} from "../lib/tenant-asset-legacy-media-reset.js";
import { withCorrelationId } from "../../../../js/shared/worker-observability.mjs";

const TENANT_ASSET_EVIDENCE_RATE_LIMIT = "admin-tenant-asset-evidence-ip";
const TENANT_ASSET_MANUAL_REVIEW_IMPORT_RATE_LIMIT = "admin-tenant-asset-manual-review-import-ip";
const TENANT_ASSET_MANUAL_REVIEW_QUEUE_RATE_LIMIT = "admin-tenant-asset-manual-review-queue-ip";
const TENANT_ASSET_MANUAL_REVIEW_STATUS_RATE_LIMIT = "admin-tenant-asset-manual-review-status-ip";
const TENANT_ASSET_LEGACY_MEDIA_RESET_RATE_LIMIT = "admin-tenant-asset-legacy-media-reset-ip";

async function enforceTenantAssetEvidenceRateLimit(ctx) {
  const result = await evaluateSharedRateLimit(
    ctx.env,
    TENANT_ASSET_EVIDENCE_RATE_LIMIT,
    getClientIp(ctx.request),
    30,
    600_000,
    sensitiveRateLimitOptions({
      component: "admin-tenant-asset-evidence",
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (result.limited) return rateLimitResponse();
  return null;
}

async function enforceTenantAssetManualReviewImportRateLimit(ctx) {
  const result = await evaluateSharedRateLimit(
    ctx.env,
    TENANT_ASSET_MANUAL_REVIEW_IMPORT_RATE_LIMIT,
    getClientIp(ctx.request),
    10,
    900_000,
    sensitiveRateLimitOptions({
      component: "admin-tenant-asset-manual-review-import",
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (result.limited) return rateLimitResponse();
  return null;
}

async function enforceTenantAssetManualReviewQueueRateLimit(ctx) {
  const result = await evaluateSharedRateLimit(
    ctx.env,
    TENANT_ASSET_MANUAL_REVIEW_QUEUE_RATE_LIMIT,
    getClientIp(ctx.request),
    30,
    600_000,
    sensitiveRateLimitOptions({
      component: "admin-tenant-asset-manual-review-queue",
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (result.limited) return rateLimitResponse();
  return null;
}

async function enforceTenantAssetManualReviewStatusRateLimit(ctx) {
  const result = await evaluateSharedRateLimit(
    ctx.env,
    TENANT_ASSET_MANUAL_REVIEW_STATUS_RATE_LIMIT,
    getClientIp(ctx.request),
    10,
    900_000,
    sensitiveRateLimitOptions({
      component: "admin-tenant-asset-manual-review-status",
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (result.limited) return rateLimitResponse();
  return null;
}

async function enforceTenantAssetLegacyMediaResetRateLimit(ctx) {
  const result = await evaluateSharedRateLimit(
    ctx.env,
    TENANT_ASSET_LEGACY_MEDIA_RESET_RATE_LIMIT,
    getClientIp(ctx.request),
    20,
    600_000,
    sensitiveRateLimitOptions({
      component: "admin-tenant-asset-legacy-media-reset",
      correlationId: ctx.correlationId || null,
      requestInfo: ctx,
    })
  );
  if (result.unavailable) return rateLimitUnavailableResponse(ctx.correlationId || null);
  if (result.limited) return rateLimitResponse();
  return null;
}

function evidenceErrorResponse(error, correlationId) {
  if (error instanceof TenantAssetEvidenceReportError) {
    return withCorrelationId(json({
      ok: false,
      error: error.message,
      code: error.code,
      fields: error.fields,
    }, { status: error.status }), correlationId);
  }
  throw error;
}

function manualReviewImportErrorResponse(error, correlationId) {
  if (error instanceof TenantAssetManualReviewImportError) {
    return withCorrelationId(json({
      ok: false,
      error: error.message,
      code: error.code,
      fields: error.fields,
    }, { status: error.status }), correlationId);
  }
  throw error;
}

function manualReviewQueueErrorResponse(error, correlationId) {
  if (error instanceof TenantAssetManualReviewQueueError) {
    return withCorrelationId(json({
      ok: false,
      error: error.message,
      code: error.code,
      fields: error.fields,
    }, { status: error.status }), correlationId);
  }
  throw error;
}

function manualReviewStatusErrorResponse(error, correlationId) {
  if (error instanceof TenantAssetManualReviewStatusError) {
    return withCorrelationId(json({
      ok: false,
      error: error.message,
      code: error.code,
      fields: error.fields,
    }, { status: error.status }), correlationId);
  }
  throw error;
}

function legacyMediaResetErrorResponse(error, correlationId) {
  if (error instanceof TenantAssetLegacyMediaResetError) {
    return withCorrelationId(json({
      ok: false,
      error: error.message,
      code: error.code,
      fields: error.fields,
    }, { status: error.status }), correlationId);
  }
  throw error;
}

function decodePathSegment(value) {
  try {
    const decoded = decodeURIComponent(String(value || ""));
    if (!decoded || decoded.includes("/") || /[\u0000-\u001f\u007f]/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function evidenceExportResponse(report, { format, correlationId }) {
  const safeGenerated = String(report.generatedAt || new Date().toISOString())
    .replace(/[^0-9A-Za-z.-]/g, "-")
    .slice(0, 40);
  if (format === "markdown") {
    return withCorrelationId(new Response(exportTenantAssetOwnershipEvidenceReportMarkdown(report), {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "content-disposition": `attachment; filename="tenant-asset-ownership-evidence-${safeGenerated}.md"`,
      },
    }), correlationId);
  }
  return withCorrelationId(new Response(exportTenantAssetOwnershipEvidenceReportJson(report), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-disposition": `attachment; filename="tenant-asset-ownership-evidence-${safeGenerated}.json"`,
    },
  }), correlationId);
}

function manualReviewEvidenceExportResponse(report, { format, correlationId }) {
  const safeGenerated = String(report.generatedAt || new Date().toISOString())
    .replace(/[^0-9A-Za-z.-]/g, "-")
    .slice(0, 40);
  if (format === "markdown") {
    return withCorrelationId(new Response(exportTenantAssetManualReviewEvidenceReportMarkdown(report), {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "content-disposition": `attachment; filename="tenant-asset-manual-review-evidence-${safeGenerated}.md"`,
      },
    }), correlationId);
  }
  return withCorrelationId(new Response(exportTenantAssetManualReviewEvidenceReportJson(report), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-disposition": `attachment; filename="tenant-asset-manual-review-evidence-${safeGenerated}.json"`,
    },
  }), correlationId);
}

function legacyMediaResetExportResponse(report, { format, correlationId }) {
  const safeGenerated = String(report.generatedAt || new Date().toISOString())
    .replace(/[^0-9A-Za-z.-]/g, "-")
    .slice(0, 40);
  if (format === "markdown") {
    return withCorrelationId(new Response(exportLegacyMediaResetDryRunReportMarkdown(report), {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "content-disposition": `attachment; filename="tenant-asset-legacy-media-reset-dry-run-${safeGenerated}.md"`,
      },
    }), correlationId);
  }
  return withCorrelationId(new Response(exportLegacyMediaResetDryRunReportJson(report), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-disposition": `attachment; filename="tenant-asset-legacy-media-reset-dry-run-${safeGenerated}.json"`,
    },
  }), correlationId);
}

export async function handleAdminTenantAssets(ctx) {
  const { request, env, url, pathname, method, isSecure, correlationId } = ctx;
  if (!pathname.startsWith("/api/admin/tenant-assets/")) {
    return null;
  }

  const admin = await requireAdmin(request, env, { isSecure, correlationId });
  if (admin instanceof Response) return admin;

  if (
    (pathname === TENANT_ASSET_OWNERSHIP_EVIDENCE_ENDPOINT && method === "GET") ||
    (pathname === TENANT_ASSET_OWNERSHIP_EVIDENCE_EXPORT_ENDPOINT && method === "GET")
  ) {
    const limited = await enforceTenantAssetEvidenceRateLimit(ctx);
    if (limited) return limited;
    try {
      const isExport = pathname === TENANT_ASSET_OWNERSHIP_EVIDENCE_EXPORT_ENDPOINT;
      const options = tenantAssetEvidenceOptionsFromSearch(url.searchParams, {
        includeDetails: isExport ? true : undefined,
        format: isExport ? url.searchParams.get("format") || "json" : "json",
      });
      const report = await buildTenantAssetOwnershipEvidenceReport(env, {
        ...options,
        includeDetails: isExport ? true : options.includeDetails,
      });
      if (isExport) {
        return evidenceExportResponse(report, {
          format: options.format,
          correlationId,
        });
      }
      return withCorrelationId(json({ ok: true, report }), correlationId);
    } catch (error) {
      return evidenceErrorResponse(error, correlationId);
    }
  }

  if (
    (pathname === TENANT_ASSET_LEGACY_MEDIA_RESET_DRY_RUN_ENDPOINT && method === "GET") ||
    (pathname === TENANT_ASSET_LEGACY_MEDIA_RESET_DRY_RUN_EXPORT_ENDPOINT && method === "GET")
  ) {
    const limited = await enforceTenantAssetLegacyMediaResetRateLimit(ctx);
    if (limited) return limited;
    try {
      const isExport = pathname === TENANT_ASSET_LEGACY_MEDIA_RESET_DRY_RUN_EXPORT_ENDPOINT;
      const options = legacyMediaResetDryRunOptionsFromSearch(url.searchParams, {
        includeDetails: isExport ? true : undefined,
        format: isExport ? url.searchParams.get("format") || "json" : "json",
      });
      const report = await buildLegacyMediaResetDryRunReport(env, {
        ...options,
        includeDetails: isExport ? true : options.includeDetails,
      });
      if (isExport) {
        return legacyMediaResetExportResponse(report, {
          format: options.format,
          correlationId,
        });
      }
      return withCorrelationId(json({ ok: true, report: serializeLegacyMediaResetDryRunReport(report) }), correlationId);
    } catch (error) {
      return legacyMediaResetErrorResponse(error, correlationId);
    }
  }

  // POST /api/admin/tenant-assets/folders-images/manual-review/import
  // route-policy: admin.tenant-assets.folders-images.manual-review.import
  if (pathname === TENANT_ASSET_MANUAL_REVIEW_IMPORT_ENDPOINT && method === "POST") {
    const limited = await enforceTenantAssetManualReviewImportRateLimit(ctx);
    if (limited) return limited;
    const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
    if (parsed.response) return withCorrelationId(parsed.response, correlationId);
    try {
      const result = await importTenantAssetManualReviewItems(env, {
        request: parsed.body,
        adminUser: admin.user,
        idempotencyKey: request.headers.get("Idempotency-Key"),
      });
      return withCorrelationId(json({
        ok: true,
        import: serializeManualReviewImportResult(result),
      }), correlationId);
    } catch (error) {
      return manualReviewImportErrorResponse(error, correlationId);
    }
  }

  if (pathname === TENANT_ASSET_MANUAL_REVIEW_ITEMS_ENDPOINT && method === "GET") {
    const limited = await enforceTenantAssetManualReviewQueueRateLimit(ctx);
    if (limited) return limited;
    try {
      const items = await listTenantAssetManualReviewItems(env, tenantAssetManualReviewQueueOptionsFromSearch(url.searchParams));
      return withCorrelationId(json({ ok: true, ...items }), correlationId);
    } catch (error) {
      return manualReviewQueueErrorResponse(error, correlationId);
    }
  }

  const manualReviewItemStatusMatch = pathname.match(/^\/api\/admin\/tenant-assets\/folders-images\/manual-review\/items\/([^/]+)\/status$/);
  // POST /api/admin/tenant-assets/folders-images/manual-review/items/:id/status
  // route-policy: admin.tenant-assets.folders-images.manual-review.items.status.update
  if (manualReviewItemStatusMatch && method === "POST") {
    const limited = await enforceTenantAssetManualReviewStatusRateLimit(ctx);
    if (limited) return limited;
    const itemId = decodePathSegment(manualReviewItemStatusMatch[1]);
    if (!itemId) return withCorrelationId(json({ ok: false, error: "Not found.", code: "not_found" }, { status: 404 }), correlationId);
    const parsed = await readJsonBodyOrResponse(request, { maxBytes: BODY_LIMITS.smallJson });
    if (parsed.response) return withCorrelationId(parsed.response, correlationId);
    try {
      const result = await updateTenantAssetManualReviewStatus(env, {
        itemId,
        request: parsed.body,
        adminUser: admin.user,
        idempotencyKey: request.headers.get("Idempotency-Key"),
      });
      return withCorrelationId(json({
        ok: true,
        statusUpdate: serializeManualReviewStatusUpdateResult(result),
      }), correlationId);
    } catch (error) {
      return manualReviewStatusErrorResponse(error, correlationId);
    }
  }

  const manualReviewItemEventsMatch = pathname.match(/^\/api\/admin\/tenant-assets\/folders-images\/manual-review\/items\/([^/]+)\/events$/);
  if (manualReviewItemEventsMatch && method === "GET") {
    const limited = await enforceTenantAssetManualReviewQueueRateLimit(ctx);
    if (limited) return limited;
    try {
      const itemId = decodePathSegment(manualReviewItemEventsMatch[1]);
      if (!itemId) return withCorrelationId(json({ ok: false, error: "Not found.", code: "not_found" }, { status: 404 }), correlationId);
      const events = await listTenantAssetManualReviewEvents(env, {
        reviewItemId: itemId,
        limit: url.searchParams.get("limit"),
      });
      return withCorrelationId(json({ ok: true, reviewItemId: itemId, ...events }), correlationId);
    } catch (error) {
      return manualReviewQueueErrorResponse(error, correlationId);
    }
  }

  const manualReviewItemMatch = pathname.match(/^\/api\/admin\/tenant-assets\/folders-images\/manual-review\/items\/([^/]+)$/);
  if (manualReviewItemMatch && method === "GET") {
    const limited = await enforceTenantAssetManualReviewQueueRateLimit(ctx);
    if (limited) return limited;
    try {
      const itemId = decodePathSegment(manualReviewItemMatch[1]);
      if (!itemId) return withCorrelationId(json({ ok: false, error: "Not found.", code: "not_found" }, { status: 404 }), correlationId);
      const item = await getTenantAssetManualReviewItem(env, itemId, {
        includeEvents: url.searchParams.get("includeEvents") === "true" || url.searchParams.get("include_events") === "true",
      });
      if (!item) return withCorrelationId(json({ ok: false, error: "Not found.", code: "not_found" }, { status: 404 }), correlationId);
      return withCorrelationId(json({ ok: true, item }), correlationId);
    } catch (error) {
      return manualReviewQueueErrorResponse(error, correlationId);
    }
  }

  if (
    (pathname === TENANT_ASSET_MANUAL_REVIEW_EVIDENCE_ENDPOINT && method === "GET") ||
    (pathname === TENANT_ASSET_MANUAL_REVIEW_EVIDENCE_EXPORT_ENDPOINT && method === "GET")
  ) {
    const limited = await enforceTenantAssetManualReviewQueueRateLimit(ctx);
    if (limited) return limited;
    try {
      const isExport = pathname === TENANT_ASSET_MANUAL_REVIEW_EVIDENCE_EXPORT_ENDPOINT;
      const options = tenantAssetManualReviewEvidenceOptionsFromSearch(url.searchParams, {
        includeItems: isExport ? true : undefined,
        format: isExport ? url.searchParams.get("format") || "json" : "json",
      });
      const report = await buildTenantAssetManualReviewEvidenceReport(env, options);
      if (isExport) {
        return manualReviewEvidenceExportResponse(report, {
          format: options.format,
          correlationId,
        });
      }
      return withCorrelationId(json({ ok: true, report }), correlationId);
    } catch (error) {
      return manualReviewQueueErrorResponse(error, correlationId);
    }
  }

  return null;
}
