import {
  clearDurableRateLimitState,
  getDurableObjectBaseClass,
  handleDurableRateLimitRequest,
} from "../../../../js/shared/durable-rate-limit-do.mjs";

const DurableObjectBase = getDurableObjectBaseClass();

export class AuthPublicRateLimiterDurableObject extends DurableObjectBase {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    return handleDurableRateLimitRequest(this.state, request);
  }

  async alarm() {
    await clearDurableRateLimitState(this.state);
  }
}
