// Already dispatched Canvas reasoning/Voice attempts retain their reservation
// pending authoritative outcome. Voice's immutable usage identity survives
// deletion of the private conversation. Ordinary generation expiry is unchanged.
export const CANVAS_MODEL_RESERVATION_HELD_SQL=`(
 member_ai_usage_attempts_v2.billing_status='reserved'
 AND member_ai_usage_attempts_v2.reservation_released_at IS NULL
 AND member_ai_usage_attempts_v2.provider_outcome IN ('dispatched','unknown','succeeded')
 AND (EXISTS(SELECT 1 FROM canvas_agent_steps cs JOIN canvas_agent_runs cr ON cr.id=cs.run_id
   WHERE cs.usage_attempt_id=member_ai_usage_attempts_v2.id AND cr.user_id=member_ai_usage_attempts_v2.user_id
     AND cs.kind IN ('plan','evaluate'))
 OR COALESCE(json_extract(member_ai_usage_attempts_v2.metadata_json,'$.canvas_voice.version')=1
  AND json_extract(member_ai_usage_attempts_v2.metadata_json,'$.canvas_voice.pricing.model')='grok-voice-3.0',0))
)`;
