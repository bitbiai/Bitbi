// Only already dispatched Canvas reasoning attempts retain their reservation
// pending authoritative outcome. Ordinary generation expiry is unchanged.
export const CANVAS_MODEL_RESERVATION_HELD_SQL=`(
 member_ai_usage_attempts_v2.billing_status='reserved'
 AND member_ai_usage_attempts_v2.reservation_released_at IS NULL
 AND member_ai_usage_attempts_v2.provider_outcome IN ('dispatched','unknown','succeeded')
 AND EXISTS(SELECT 1 FROM canvas_agent_steps cs JOIN canvas_agent_runs cr ON cr.id=cs.run_id
   WHERE cs.usage_attempt_id=member_ai_usage_attempts_v2.id AND cr.user_id=member_ai_usage_attempts_v2.user_id
     AND cs.kind IN ('plan','evaluate'))
)`;
