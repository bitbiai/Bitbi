import {
  clearDurableRateLimitState,
  getDurableObjectBaseClass,
  handleDurableNonceReplayRequest,
} from "../../../../js/shared/durable-rate-limit-do.mjs";

const DurableObjectBase = getDurableObjectBaseClass();

export class AiServiceAuthReplayDurableObject extends DurableObjectBase {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    return handleDurableNonceReplayRequest(this.state, request);
  }

  async alarm() {
    await clearDurableRateLimitState(this.state);
  }
}
