import { json } from "../lib/response.js";
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
import { withCorrelationId } from "../../../../js/shared/worker-observability.mjs";

const TENANT_ASSET_EVIDENCE_RATE_LIMIT = "admin-tenant-asset-evidence-ip";

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

  return null;
}
