import { json } from "../lib/response.js";
import { requireUser } from "../lib/session.js";
import {
  BillingError,
  billingErrorResponse,
  billingStorageUnavailableResponse,
  getMemberCreditsDashboard,
  isBillingStorageUnavailableError,
} from "../lib/billing.js";
import {
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

function creditsErrorResponse(error, { correlationId = null, userId = null } = {}) {
  if (error instanceof BillingError) {
    return json(billingErrorResponse(error), { status: error.status });
  }
  if (isBillingStorageUnavailableError(error)) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "account-credits",
      event: "member_credits_dashboard_unavailable",
      level: "error",
      correlationId,
      user_id: userId,
      code: "billing_storage_unavailable",
      ...getErrorFields(error),
    });
    return json(billingStorageUnavailableResponse(), { status: 503 });
  }
  throw error;
}

export async function handleAccountCredits(ctx) {
  const { request, env, pathname, method, url, correlationId } = ctx;
  if (pathname !== "/api/account/credits-dashboard" || method !== "GET") return null;

  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  try {
    const dashboard = await getMemberCreditsDashboard({
      env,
      userId: session.user.id,
      limit: url.searchParams.get("limit"),
      applyDailyTopUp: true,
    });
    return json({ ok: true, dashboard });
  } catch (error) {
    return creditsErrorResponse(error, {
      correlationId,
      userId: session.user.id,
    });
  }
}
