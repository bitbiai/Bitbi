-- Per-area policy guards: forward-only, no model activation or data rewrite.

CREATE TRIGGER model_area_member_ai_usage_attempts_v2_insert
BEFORE INSERT ON member_ai_usage_attempts_v2
WHEN NEW.provider_outcome = 'not_dispatched' AND NEW.billing_status = 'reserved'
 AND EXISTS (SELECT 1 FROM app_settings
   WHERE key = json_extract(NEW.metadata_json, '$.model_area.key')
   AND CASE WHEN json_valid(value_json) THEN (json_extract(value_json,'$.version')=1 AND json_type(value_json,'$.revision')='integer' AND json_extract(value_json,'$.revision')>=1 AND json_type(value_json,'$.history')='array' AND json_type(value_json,'$.enabled')='true') ELSE 0 END IS NOT 1)
BEGIN
 SELECT RAISE(ABORT, 'model_area_disabled');
END;

CREATE TRIGGER model_area_member_ai_usage_attempts_v2_update
BEFORE UPDATE ON member_ai_usage_attempts_v2
WHEN NEW.provider_outcome = 'not_dispatched' AND NEW.billing_status = 'reserved'
 AND EXISTS (SELECT 1 FROM app_settings
   WHERE key = json_extract(NEW.metadata_json, '$.model_area.key')
   AND CASE WHEN json_valid(value_json) THEN (json_extract(value_json,'$.version')=1 AND json_type(value_json,'$.revision')='integer' AND json_extract(value_json,'$.revision')>=1 AND json_type(value_json,'$.history')='array' AND json_type(value_json,'$.enabled')='true') ELSE 0 END IS NOT 1)
BEGIN
 SELECT RAISE(ABORT, 'model_area_disabled');
END;

CREATE TRIGGER model_area_ai_usage_attempts_v2_insert
BEFORE INSERT ON ai_usage_attempts_v2
WHEN NEW.provider_outcome = 'not_dispatched' AND NEW.billing_status = 'reserved'
 AND EXISTS (SELECT 1 FROM app_settings
   WHERE key = json_extract(NEW.metadata_json, '$.model_area.key')
   AND CASE WHEN json_valid(value_json) THEN (json_extract(value_json,'$.version')=1 AND json_type(value_json,'$.revision')='integer' AND json_extract(value_json,'$.revision')>=1 AND json_type(value_json,'$.history')='array' AND json_type(value_json,'$.enabled')='true') ELSE 0 END IS NOT 1)
BEGIN
 SELECT RAISE(ABORT, 'model_area_disabled');
END;

CREATE TRIGGER model_area_ai_usage_attempts_v2_update
BEFORE UPDATE ON ai_usage_attempts_v2
WHEN NEW.provider_outcome = 'not_dispatched' AND NEW.billing_status = 'reserved'
 AND EXISTS (SELECT 1 FROM app_settings
   WHERE key = json_extract(NEW.metadata_json, '$.model_area.key')
   AND CASE WHEN json_valid(value_json) THEN (json_extract(value_json,'$.version')=1 AND json_type(value_json,'$.revision')='integer' AND json_extract(value_json,'$.revision')>=1 AND json_type(value_json,'$.history')='array' AND json_type(value_json,'$.enabled')='true') ELSE 0 END IS NOT 1)
BEGIN
 SELECT RAISE(ABORT, 'model_area_disabled');
END;

CREATE TRIGGER model_area_admin_ai_usage_attempts_v2_insert
BEFORE INSERT ON admin_ai_usage_attempts_v2
WHEN NEW.provider_outcome = 'not_dispatched' AND NEW.status = 'pending'
 AND EXISTS (SELECT 1 FROM app_settings
   WHERE key = json_extract(NEW.metadata_json, '$.model_area.key')
   AND CASE WHEN json_valid(value_json) THEN (json_extract(value_json,'$.version')=1 AND json_type(value_json,'$.revision')='integer' AND json_extract(value_json,'$.revision')>=1 AND json_type(value_json,'$.history')='array' AND json_type(value_json,'$.enabled')='true') ELSE 0 END IS NOT 1)
BEGIN
 SELECT RAISE(ABORT, 'model_area_disabled');
END;

CREATE TRIGGER model_area_admin_ai_usage_attempts_v2_update
BEFORE UPDATE ON admin_ai_usage_attempts_v2
WHEN NEW.provider_outcome = 'not_dispatched' AND NEW.status = 'pending'
 AND EXISTS (SELECT 1 FROM app_settings
   WHERE key = json_extract(NEW.metadata_json, '$.model_area.key')
   AND CASE WHEN json_valid(value_json) THEN (json_extract(value_json,'$.version')=1 AND json_type(value_json,'$.revision')='integer' AND json_extract(value_json,'$.revision')>=1 AND json_type(value_json,'$.history')='array' AND json_type(value_json,'$.enabled')='true') ELSE 0 END IS NOT 1)
BEGIN
 SELECT RAISE(ABORT, 'model_area_disabled');
END;
