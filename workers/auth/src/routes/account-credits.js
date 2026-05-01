import { json } from "../lib/response.js";
import { requireUser } from "../lib/session.js";
import {
  BillingError,
  billingErrorResponse,
  getMemberCreditsDashboard,
} from "../lib/billing.js";

function creditsErrorResponse(error) {
  if (error instanceof BillingError) {
    return json(billingErrorResponse(error), { status: error.status });
  }
  throw error;
}

export async function handleAccountCredits(ctx) {
  const { request, env, pathname, method, url } = ctx;
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
    return creditsErrorResponse(error);
  }
}
