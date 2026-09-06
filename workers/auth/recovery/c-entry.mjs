// PRIVATE C-RESTRICTED CANDIDATE. Local preparation only; not deployment approval.
// Post-0082/0083 recovery entry. Old invocation drain and queue retention are separate.
import actualWorker from './b-index.js';
import { createRestrictedRecoveryEntry } from './restriction-adapter.mjs';
export {
  AuthPublicRateLimiterDurableObject,
  getAllowedOrigins,
  normalizeConfiguredAppOrigin,
} from './b-index.js';
export default createRestrictedRecoveryEntry(actualWorker);
