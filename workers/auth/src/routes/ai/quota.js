import { json } from "../../lib/response.js";
import { requireUser } from "../../lib/session.js";
import {
  MEMBER_DAILY_CREDIT_ALLOWANCE,
  getMemberCreditBalance,
  topUpMemberDailyCredits,
} from "../../lib/billing.js";

function quotaUnavailableResponse() {
  return json(
    { ok: false, error: "Service temporarily unavailable. Please try again later." },
    { status: 503 }
  );
}

export async function handleQuota(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  if (session.user.role === "admin") {
    return json({ ok: true, data: { isAdmin: true } });
  }

  let topUp;
  let creditBalance;
  try {
    topUp = await topUpMemberDailyCredits({
      env,
      userId: session.user.id,
    });
    creditBalance = await getMemberCreditBalance(env, session.user.id);
  } catch (e) {
    if (String(e).includes("no such table")) return quotaUnavailableResponse();
    throw e;
  }

  return json({
    ok: true,
    data: {
      isAdmin: false,
      creditBalance,
      dailyCreditAllowance: MEMBER_DAILY_CREDIT_ALLOWANCE,
      dailyTopUp: {
        dayStart: topUp.dayStart,
        grantedCredits: topUp.grantedCredits,
        reused: topUp.reused,
      },
    },
  });
}
