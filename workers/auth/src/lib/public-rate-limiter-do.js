import {
  clearDurableRateLimitState,
  getDurableObjectBaseClass,
  handleDurableRateLimitRequest,
} from "../../../../js/shared/durable-rate-limit-do.mjs";
import { handleAssistantBudgetRequest, runAssistantBudgetAlarm } from "./website-assistant-budget.js";
import { CanvasVoiceOwner } from './canvas-voice-owner.js';

const DurableObjectBase = getDurableObjectBaseClass();

export class AuthPublicRateLimiterDurableObject extends DurableObjectBase {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.voice = null;
  }

  async fetch(request) {
    if (new URL(request.url).pathname.startsWith('/canvas-voice/')) {
      this.voice ||= new CanvasVoiceOwner(this.state, this.env);
      return this.voice.fetch(request);
    }
    if (new URL(request.url).pathname.startsWith("/assistant/")) {
      return handleAssistantBudgetRequest(this.state, request);
    }
    return handleDurableRateLimitRequest(this.state, request);
  }

  async alarm() {
    if (this.voice || await this.state.storage.get('canvas-voice-owner:v1')) {
      this.voice ||= new CanvasVoiceOwner(this.state, this.env);
      if (await this.voice.alarm()) return;
    }
    if (await runAssistantBudgetAlarm(this.state)) return;
    await clearDurableRateLimitState(this.state);
  }
}
