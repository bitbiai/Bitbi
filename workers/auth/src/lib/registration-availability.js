import { nowIso } from "./tokens.js";

export const REGISTRATION_AVAILABILITY_SETTING_KEY = "registration.availability";
export const REGISTRATION_DISABLED_CODE = "registration_temporarily_disabled";
export const REGISTRATION_MAINTENANCE_MESSAGE =
  "Registrations are temporarily disabled due to maintenance work. Please try again later.";

const MAX_REASON_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 240;

export class RegistrationAvailabilityError extends Error {
  constructor(message, { status = 400, code = "registration_availability_error", fields = {} } = {}) {
    super(message);
    this.name = "RegistrationAvailabilityError";
    this.status = status;
    this.code = code;
    this.fields = Object.freeze({ ...fields });
  }
}

function hasMissingSettingsTableError(error) {
  return /no such table:\s*app_settings/i.test(String(error?.message || error));
}

function normalizeSafeText(value, { field = "text", maxLength = MAX_REASON_LENGTH, required = false } = {}) {
  const text = String(value || "").trim();
  if (!text) {
    if (required) {
      throw new RegistrationAvailabilityError("A reason is required for this registration setting change.", {
        code: "registration_availability_reason_required",
        fields: { field },
      });
    }
    return "";
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new RegistrationAvailabilityError("Registration setting text contains unsafe control characters.", {
      code: "registration_availability_text_invalid",
      fields: { field },
    });
  }
  return text.slice(0, maxLength);
}

function parseSettingValue(row) {
  if (!row?.value_json) return {};
  try {
    const parsed = JSON.parse(row.value_json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function buildStatus({
  enabled = true,
  settingPresent = false,
  storageAvailable = true,
  updatedAt = null,
  updatedByUserId = null,
  reason = "",
  maintenanceMessage = REGISTRATION_MAINTENANCE_MESSAGE,
} = {}) {
  const normalizedEnabled = enabled !== false;
  return {
    enabled: normalizedEnabled,
    effectiveStatus: normalizedEnabled ? "registrations_enabled" : "registrations_disabled_for_maintenance",
    maintenanceMessage: normalizeSafeText(maintenanceMessage, {
      field: "maintenanceMessage",
      maxLength: MAX_MESSAGE_LENGTH,
    }) || REGISTRATION_MAINTENANCE_MESSAGE,
    settingKey: REGISTRATION_AVAILABILITY_SETTING_KEY,
    settingPresent,
    storageAvailable,
    updatedAt,
    updatedByUserId: updatedByUserId || null,
    reason: reason || "",
    existingUsersUnaffected: true,
    existingLoginUnaffected: true,
    adminLoginUnaffected: true,
  };
}

export async function getRegistrationAvailability(env) {
  if (!env?.DB) {
    return buildStatus({ enabled: true, storageAvailable: false });
  }
  try {
    const row = await env.DB.prepare(
      `SELECT key, value_json, updated_at, updated_by_user_id, reason
         FROM app_settings
        WHERE key = ?
        LIMIT 1`
    ).bind(REGISTRATION_AVAILABILITY_SETTING_KEY).first();
    if (!row) {
      return buildStatus({ enabled: true, settingPresent: false });
    }
    const value = parseSettingValue(row);
    return buildStatus({
      enabled: value.enabled !== false,
      maintenanceMessage: value.maintenanceMessage || REGISTRATION_MAINTENANCE_MESSAGE,
      settingPresent: true,
      storageAvailable: true,
      updatedAt: row.updated_at || value.updatedAt || null,
      updatedByUserId: row.updated_by_user_id || null,
      reason: row.reason || value.reason || "",
    });
  } catch (error) {
    if (hasMissingSettingsTableError(error)) {
      return buildStatus({ enabled: true, settingPresent: false, storageAvailable: false });
    }
    throw error;
  }
}

export function registrationDisabledResponsePayload(status = {}) {
  return {
    ok: false,
    code: REGISTRATION_DISABLED_CODE,
    error: REGISTRATION_MAINTENANCE_MESSAGE,
    maintenanceMessage: status.maintenanceMessage || REGISTRATION_MAINTENANCE_MESSAGE,
    existingUsersUnaffected: true,
  };
}

export async function setRegistrationAvailability(env, {
  enabled,
  actorUserId = null,
  reason = "",
  maintenanceMessage = REGISTRATION_MAINTENANCE_MESSAGE,
} = {}) {
  if (!env?.DB) {
    throw new RegistrationAvailabilityError("Registration settings storage is unavailable.", {
      status: 503,
      code: "registration_settings_storage_unavailable",
    });
  }
  if (typeof enabled !== "boolean") {
    throw new RegistrationAvailabilityError("Registration availability must be enabled or disabled explicitly.", {
      code: "registration_availability_enabled_invalid",
      fields: { enabled: "boolean_required" },
    });
  }
  const safeReason = normalizeSafeText(reason, {
    field: "reason",
    required: enabled === false,
  });
  const safeMessage = normalizeSafeText(maintenanceMessage, {
    field: "maintenanceMessage",
    maxLength: MAX_MESSAGE_LENGTH,
  }) || REGISTRATION_MAINTENANCE_MESSAGE;
  const updatedAt = nowIso();
  const valueJson = JSON.stringify({
    enabled,
    maintenanceMessage: safeMessage,
    updatedAt,
  });
  try {
    await env.DB.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at, updated_by_user_id, reason)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at,
         updated_by_user_id = excluded.updated_by_user_id,
         reason = excluded.reason`
    ).bind(
      REGISTRATION_AVAILABILITY_SETTING_KEY,
      valueJson,
      updatedAt,
      actorUserId || null,
      safeReason || null
    ).run();
  } catch (error) {
    if (hasMissingSettingsTableError(error)) {
      throw new RegistrationAvailabilityError("Registration settings migration is not applied.", {
        status: 503,
        code: "registration_settings_migration_required",
      });
    }
    throw error;
  }
  return buildStatus({
    enabled,
    settingPresent: true,
    storageAvailable: true,
    updatedAt,
    updatedByUserId: actorUserId || null,
    reason: safeReason,
    maintenanceMessage: safeMessage,
  });
}
