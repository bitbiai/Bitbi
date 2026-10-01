import {
  clearDurableRateLimitState,
  getDurableObjectBaseClass,
  handleDurableRateLimitRequest,
} from "../../../../js/shared/durable-rate-limit-do.mjs";
import { handleAssistantBudgetRequest, runAssistantBudgetAlarm } from "./website-assistant-budget.js";

const DurableObjectBase = getDurableObjectBaseClass();

export class AuthPublicRateLimiterDurableObject extends DurableObjectBase {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    if (new URL(request.url).pathname.startsWith("/assistant/")) {
      return handleAssistantBudgetRequest(this.state, request);
    }
    return handleDurableRateLimitRequest(this.state, request);
  }

  async alarm() {
    if (await runAssistantBudgetAlarm(this.state)) return;
    await clearDurableRateLimitState(this.state);
  }
}
