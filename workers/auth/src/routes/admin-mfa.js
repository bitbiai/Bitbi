import { readJsonBody } from "../lib/request.js";
import { json } from "../lib/response.js";
import { requireAdmin } from "../lib/session.js";
import {
  AdminMfaError,
  adminMfaErrorResponse,
  appendCookies,
  buildAdminMfaStatusPayload,
  createAdminMfaSetup,
  disableAdminMfa,
  enableAdminMfa,
  logAdminMfaDiagnostic,
  logAdminMfaUnhandledFailure,
  regenerateAdminMfaRecoveryCodes,
  verifyAdminMfa,
} from "../lib/admin-mfa.js";
import { withCorrelationId } from "../../../../js/shared/worker-observability.mjs";

function badJsonResponse(correlationId) {
  return withCorrelationId(
    json({ ok: false, error: "Invalid JSON body.", code: "bad_request" }, { status: 400 }),
    correlationId
  );
}

export async function handleAdminMfa(ctx) {
  const { request, env, pathname, method, isSecure, correlationId } = ctx;
  if (!pathname.startsWith("/api/admin/mfa/")) {
    return null;
  }

  const admin = await requireAdmin(request, env, {
    isSecure,
    correlationId,
    allowMfaBootstrap: true,
  });
  if (admin instanceof Response) {
    return admin;
  }

  function correlated(response) {
    return withCorrelationId(response, correlationId);
  }

  if (pathname === "/api/admin/mfa/status" && method === "GET") {
    return correlated(json({
      ok: true,
      mfa: buildAdminMfaStatusPayload(admin.adminMfa || {}),
    }));
  }

  if (pathname === "/api/admin/mfa/setup" && method === "POST") {
    try {
      const setup = await createAdminMfaSetup(env, admin.user);
      logAdminMfaDiagnostic({
        request,
        correlationId,
        adminUserId: admin.user.id,
        event: "admin_mfa_setup_created",
        level: "info",
        setupPending: true,
        recoveryCodesRemaining: setup.recoveryCodes.length,
      });
      return correlated(json({
        ok: true,
        mfa: {
          enrolled: false,
          verified: false,
          setupPending: true,
          recoveryCodesRemaining: setup.recoveryCodes.length,
          proofExpiresAt: null,
          method: "totp",
        },
        setup: {
          secret: setup.secret,
          otpauthUri: setup.otpauthUri,
          recoveryCodes: setup.recoveryCodes,
        },
      }));
    } catch (error) {
      if (error instanceof AdminMfaError) {
        logAdminMfaDiagnostic({
          request,
          correlationId,
          adminUserId: admin.user.id,
          event: "admin_mfa_setup_failed",
          level: error.status >= 500 ? "error" : "warn",
          failureReason: error.reason,
          status: error.status,
        });
        return adminMfaErrorResponse(error, correlationId);
      }
      logAdminMfaUnhandledFailure(request, correlationId, admin.user.id, error);
      return withCorrelationId(
        json({ ok: false, error: "Service temporarily unavailable. Please try again later.", code: "ADMIN_MFA_UNAVAILABLE" }, { status: 503 }),
        correlationId
      );
    }
  }

  if (pathname === "/api/admin/mfa/enable" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body) return badJsonResponse(correlationId);
    try {
      const enabled = await enableAdminMfa(env, admin, body, { isSecure });
      logAdminMfaDiagnostic({
        request,
        correlationId,
        adminUserId: admin.user.id,
        event: "admin_mfa_enabled",
        level: "info",
        verificationMethod: "totp",
        status: 200,
        recoveryCodesRemaining: enabled.status.recoveryCodesRemaining,
      });
      return correlated(appendCookies(json({
        ok: true,
        message: "Admin MFA enabled.",
        mfa: enabled.status,
      }), enabled.proof.cookies));
    } catch (error) {
      if (error instanceof AdminMfaError) {
        logAdminMfaDiagnostic({
          request,
          correlationId,
          adminUserId: admin.user.id,
          event: "admin_mfa_enable_failed",
          level: error.status >= 500 ? "error" : "warn",
          failureReason: error.reason,
          status: error.status,
        });
        return adminMfaErrorResponse(error, correlationId);
      }
      logAdminMfaUnhandledFailure(request, correlationId, admin.user.id, error);
      return withCorrelationId(
        json({ ok: false, error: "Service temporarily unavailable. Please try again later.", code: "ADMIN_MFA_UNAVAILABLE" }, { status: 503 }),
        correlationId
      );
    }
  }

  if (pathname === "/api/admin/mfa/verify" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body) return badJsonResponse(correlationId);
    try {
      const verified = await verifyAdminMfa(env, admin, body, { isSecure });
      logAdminMfaDiagnostic({
        request,
        correlationId,
        adminUserId: admin.user.id,
        event: verified.verificationMethod === "recovery_code"
          ? "admin_mfa_recovery_code_used"
          : "admin_mfa_verified",
        level: "info",
        verificationMethod: verified.verificationMethod,
        status: 200,
        recoveryCodesRemaining: verified.status.recoveryCodesRemaining,
      });
      return correlated(appendCookies(json({
        ok: true,
        message: "Admin MFA verified.",
        mfa: verified.status,
      }), verified.proof.cookies));
    } catch (error) {
      if (error instanceof AdminMfaError) {
        logAdminMfaDiagnostic({
          request,
          correlationId,
          adminUserId: admin.user.id,
          event: error.code === "ADMIN_MFA_INVALID_RECOVERY_CODE"
            ? "admin_mfa_recovery_code_failed"
            : "admin_mfa_verify_failed",
          level: error.status >= 500 ? "error" : "warn",
          failureReason: error.reason,
          verificationMethod: error.code === "ADMIN_MFA_INVALID_RECOVERY_CODE" ? "recovery_code" : "totp",
          status: error.status,
        });
        return adminMfaErrorResponse(error, correlationId);
      }
      logAdminMfaUnhandledFailure(request, correlationId, admin.user.id, error);
      return withCorrelationId(
        json({ ok: false, error: "Service temporarily unavailable. Please try again later.", code: "ADMIN_MFA_UNAVAILABLE" }, { status: 503 }),
        correlationId
      );
    }
  }

  if (pathname === "/api/admin/mfa/disable" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body) return badJsonResponse(correlationId);
    try {
      const disabled = await disableAdminMfa(env, admin, body, { isSecure });
      logAdminMfaDiagnostic({
        request,
        correlationId,
        adminUserId: admin.user.id,
        event: "admin_mfa_disabled",
        level: "warn",
        status: 200,
      });
      return correlated(appendCookies(json({
        ok: true,
        message: "Admin MFA disabled.",
      }), disabled.clearCookies));
    } catch (error) {
      if (error instanceof AdminMfaError) {
        logAdminMfaDiagnostic({
          request,
          correlationId,
          adminUserId: admin.user.id,
          event: "admin_mfa_disable_failed",
          level: error.status >= 500 ? "error" : "warn",
          failureReason: error.reason,
          status: error.status,
        });
        return adminMfaErrorResponse(error, correlationId);
      }
      logAdminMfaUnhandledFailure(request, correlationId, admin.user.id, error);
      return withCorrelationId(
        json({ ok: false, error: "Service temporarily unavailable. Please try again later.", code: "ADMIN_MFA_UNAVAILABLE" }, { status: 503 }),
        correlationId
      );
    }
  }

  if (pathname === "/api/admin/mfa/recovery-codes/regenerate" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body) return badJsonResponse(correlationId);
    try {
      const regenerated = await regenerateAdminMfaRecoveryCodes(env, admin, body, { isSecure });
      logAdminMfaDiagnostic({
        request,
        correlationId,
        adminUserId: admin.user.id,
        event: "admin_mfa_recovery_codes_regenerated",
        level: "warn",
        verificationMethod: regenerated.verificationMethod,
        status: 200,
        recoveryCodesRemaining: regenerated.status.recoveryCodesRemaining,
      });
      return correlated(appendCookies(json({
        ok: true,
        message: "Recovery codes regenerated.",
        mfa: regenerated.status,
        recoveryCodes: regenerated.recoveryCodes,
      }), regenerated.proof.cookies));
    } catch (error) {
      if (error instanceof AdminMfaError) {
        logAdminMfaDiagnostic({
          request,
          correlationId,
          adminUserId: admin.user.id,
          event: error.code === "ADMIN_MFA_INVALID_RECOVERY_CODE"
            ? "admin_mfa_recovery_code_failed"
            : "admin_mfa_recovery_codes_regenerate_failed",
          level: error.status >= 500 ? "error" : "warn",
          failureReason: error.reason,
          status: error.status,
        });
        return adminMfaErrorResponse(error, correlationId);
      }
      logAdminMfaUnhandledFailure(request, correlationId, admin.user.id, error);
      return withCorrelationId(
        json({ ok: false, error: "Service temporarily unavailable. Please try again later.", code: "ADMIN_MFA_UNAVAILABLE" }, { status: 503 }),
        correlationId
      );
    }
  }

  return null;
}
