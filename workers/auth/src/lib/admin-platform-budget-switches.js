import { json } from "./response.js";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["", "0", "false", "no", "off"]);
const SAFE_FLAG_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,95}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:@/-]{1,160}$/;

export class AdminPlatformBudgetSwitchError extends Error {
  constructor(message, { status = 503, fields = {} } = {}) {
    super(message);
    this.name = "AdminPlatformBudgetSwitchError";
    this.code = "admin_ai_budget_disabled";
    this.status = status;
    this.fields = Object.freeze({ ...fields });
  }
}

function safeString(value, maxLength = 160) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!text || !SAFE_ID_PATTERN.test(text)) return null;
  return text.slice(0, maxLength);
}

function safeFlagName(value) {
  const text = String(value || "").trim();
  return SAFE_FLAG_NAME_PATTERN.test(text) ? text : null;
}

export function normalizeBudgetSwitchValue(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  if (typeof value === "number") return value === 1;
  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return false;
}

export function isBudgetSwitchEnabled(env, flagName) {
  const safeFlag = safeFlagName(flagName);
  if (!safeFlag) return false;
  return normalizeBudgetSwitchValue(env?.[safeFlag]);
}

export function getBudgetSwitchState(env, flagName) {
  const safeFlag = safeFlagName(flagName);
  const configured = Boolean(
    safeFlag &&
    env &&
    Object.prototype.hasOwnProperty.call(env, safeFlag) &&
    String(env[safeFlag] ?? "").trim() !== ""
  );
  return Object.freeze({
    flagName: safeFlag,
    configured,
    enabled: safeFlag ? isBudgetSwitchEnabled(env, safeFlag) : false,
  });
}

function extractSwitchFields(planOrConfig = {}, options = {}) {
  const plan = planOrConfig || {};
  const killSwitch = plan.killSwitchPolicy || plan.killSwitch || {};
  const auditFields = plan.auditFields || plan.audit_fields || {};
  const summary = plan.summary || {};
  const flagName = safeFlagName(
    options.flagName ||
    plan.flagName ||
    plan.budget_switch_flag ||
    killSwitch.flagName ||
    plan.kill_switch_flag_name ||
    summary.kill_switch_flag_name ||
    auditFields.kill_switch_flag_name
  );
  return Object.freeze({
    flagName,
    operationId: safeString(
      options.operationId || plan.operationId || summary.operation_id || plan.operation_id || auditFields.operation_id,
      120
    ),
    budgetScope: safeString(
      options.budgetScope || plan.budgetScope || summary.budget_scope || plan.budget_scope || auditFields.budget_scope,
      120
    ),
    ownerDomain: safeString(
      options.ownerDomain || plan.ownerDomain || summary.owner_domain || plan.owner_domain || auditFields.owner_domain,
      120
    ),
    providerFamily: safeString(
      options.providerFamily || plan.providerFamily || summary.provider_family || plan.provider_family || auditFields.provider_family,
      80
    ),
    disabledBehavior: safeString(
      options.disabledBehavior || killSwitch.disabledBehavior || summary.kill_switch_disabled_behavior || "fail_closed",
      80
    ),
  });
}

function statusForDisabledBehavior(disabledBehavior) {
  if (disabledBehavior === "return_403") return 403;
  return 503;
}

export function budgetSwitchLogFields(planOrConfig = {}, options = {}) {
  const fields = extractSwitchFields(planOrConfig, options);
  return Object.freeze({
    budget_switch_flag: fields.flagName,
    operation_id: fields.operationId,
    budget_scope: fields.budgetScope,
    owner_domain: fields.ownerDomain,
    provider_family: fields.providerFamily,
    disabled_behavior: fields.disabledBehavior,
  });
}

export function assertBudgetSwitchEnabled(env, planOrConfig = {}, options = {}) {
  const fields = extractSwitchFields(planOrConfig, options);
  if (!fields.flagName || !isBudgetSwitchEnabled(env, fields.flagName)) {
    throw new AdminPlatformBudgetSwitchError(
      options.message || "Admin AI budget path is disabled.",
      {
        status: options.status || statusForDisabledBehavior(fields.disabledBehavior),
        fields,
      }
    );
  }
  return Object.freeze({
    ok: true,
    enabled: true,
    ...fields,
  });
}

export function budgetSwitchDisabledResponse(errorOrFields, options = {}) {
  const fields = errorOrFields instanceof AdminPlatformBudgetSwitchError
    ? errorOrFields.fields
    : extractSwitchFields(errorOrFields, options);
  const status = options.status || errorOrFields?.status || 503;
  return json({
    ok: false,
    error: options.message || "Admin AI budget path is disabled.",
    code: "admin_ai_budget_disabled",
    flag: fields.flagName || null,
    operation_id: fields.operationId || null,
    budget_scope: fields.budgetScope || null,
    owner_domain: fields.ownerDomain || null,
  }, { status });
}
