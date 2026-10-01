import { ASSISTANT_POLICY, ASSISTANT_MODELS, assistantReadiness } from './website-assistant-policy.js';
import { publicPageIds, knowledgeVersion, getSuggestions } from '../../../shared/website-assistant-knowledge.mjs';

export const ASSISTANT_BUDGET_OBJECT_NAME = 'website-assistant-budget-v1';
export const ASSISTANT_CONTROL_STORAGE_KEY = 'website-assistant-control:v1';
import { knowledgeArticles } from '../../../shared/website-assistant-content.mjs';

const fields = ['mode', 'model', 'outputTokens', 'tone', 'greeting', 'languages', 'pages', 'suggestionsEnabled', 'dailyRequests', 'requestsPerMinute', 'concurrentRequests', 'dailyUsdMicros', 'monthlyUsdMicros'];
const integer = (n, max) => Number.isSafeInteger(n) && n > 0 && n <= max;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const subset = (values, allowed) => Array.isArray(values) && values.length > 0 && new Set(values).size === values.length && values.every(value => allowed.includes(value));

export function assistantDefaultSettings(policy = ASSISTANT_POLICY) {
  return { mode: 'off', model: policy.model, outputTokens: policy.limits.outputTokens, tone: 'concise',
    greeting: { en: 'Ask about BITBI. Please do not share personal information.', de: 'Fragen Sie nach BITBI. Bitte teilen Sie keine persönlichen Informationen.' },
    languages: ['en', 'de'], pages: [...publicPageIds], suggestionsEnabled: true,
    dailyRequests: policy.limits.dailyRequests, requestsPerMinute: policy.limits.requestsPerMinute,
    concurrentRequests: policy.limits.concurrentRequests, dailyUsdMicros: null, monthlyUsdMicros: null };
}

export function validAssistantSettings(settings) {
  return exact(settings, fields) && ['off', 'admin', 'public'].includes(settings.mode) && Boolean(ASSISTANT_MODELS[settings.model]) &&
    integer(settings.outputTokens, 512) && ['concise', 'friendly', 'neutral'].includes(settings.tone) && exact(settings.greeting, ['en', 'de']) &&
    Object.values(settings.greeting).every(text => typeof text === 'string' && text.trim().length > 0 && text.length <= 240 && !/[<>\u0000-\u001f]/.test(text)) &&
    subset(settings.languages, ['en', 'de']) && subset(settings.pages, publicPageIds) && typeof settings.suggestionsEnabled === 'boolean' &&
    integer(settings.dailyRequests, 1000) && integer(settings.requestsPerMinute, 6) && integer(settings.concurrentRequests, 10) &&
    (settings.dailyUsdMicros === null || integer(settings.dailyUsdMicros, 100e6)) &&
    (settings.monthlyUsdMicros === null || integer(settings.monthlyUsdMicros, 1000e6)) &&
    (settings.dailyUsdMicros === null || settings.monthlyUsdMicros === null || settings.dailyUsdMicros <= settings.monthlyUsdMicros);
}

export function validateAssistantSettings(settings, policy = ASSISTANT_POLICY) {
  if (!validAssistantSettings(settings)) return 'assistant_configuration_invalid';
  // Approval evidence is source-controlled, not an editable dashboard claim.
  if (settings.model !== policy.model) return 'assistant_model_not_approved';
  for (const key of ['outputTokens', 'dailyRequests', 'requestsPerMinute', 'concurrentRequests']) {
    if (settings[key] > policy.limits[key]) return 'assistant_limit_not_approved';
  }
  for (const key of ['dailyUsdMicros', 'monthlyUsdMicros']) {
    if (settings[key] !== null && (!policy.spendingApproval || settings[key] > policy.spendingApproval[key])) return 'assistant_budget_not_approved';
  }
  return null;
}

export function policyWithAssistantSettings(policy, settings) {
  return { ...policy, model: settings.model, limits: { ...policy.limits, outputTokens: settings.outputTokens,
    dailyRequests: Math.min(settings.dailyRequests, policy.limits.dailyRequests), requestsPerMinute: Math.min(settings.requestsPerMinute, policy.limits.requestsPerMinute),
    concurrentRequests: Math.min(settings.concurrentRequests, policy.limits.concurrentRequests) },
    spendingApproval: policy.spendingApproval ? { ...policy.spendingApproval,
      dailyUsdMicros: Math.min(settings.dailyUsdMicros ?? policy.spendingApproval.dailyUsdMicros, policy.spendingApproval.dailyUsdMicros),
      monthlyUsdMicros: Math.min(settings.monthlyUsdMicros ?? policy.spendingApproval.monthlyUsdMicros, policy.spendingApproval.monthlyUsdMicros) } : null };
}

export async function readStoredAssistantControl(storage) {
  const value = await storage.get(ASSISTANT_CONTROL_STORAGE_KEY);
  if (value === undefined) return { version: 1, revision: 0, settings: assistantDefaultSettings(), previous: null, audit: [], updatedAt: null };
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1 || !validAssistantSettings(value.settings) ||
      !Array.isArray(value.audit) || value.audit.length > 50 || !Number.isFinite(Date.parse(value.updatedAt)) ||
      (value.previous !== null && !validAssistantSettings(value.previous)) || value.audit.some(entry =>
      !exact(entry, ['revision', 'at', 'actor', 'action', 'changed']) || !integer(entry.revision, value.revision) ||
      !Number.isFinite(Date.parse(entry.at)) || !/^[a-zA-Z0-9_-]{1,128}$/.test(entry.actor || '') ||
      !['save', 'restore_off'].includes(entry.action) || !subset(entry.changed, fields))) throw new Error('assistant_control_invalid');
  return value;
}

export async function writeStoredAssistantControl(storage, body, now, restore = false) {
  if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0 || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.actor || '')) return { ok: false, code: 'assistant_configuration_invalid' };
  return storage.transaction(async txn => {
    const current = await readStoredAssistantControl(txn);
    if (current.revision !== body.revision) return { ok: false, code: 'assistant_configuration_conflict' };
    const settings = restore ? (current.previous && { ...current.previous, mode: 'off' }) : body.settings;
    if (!validAssistantSettings(settings)) return { ok: false, code: 'assistant_configuration_invalid' };
    const changed = fields.filter(key => JSON.stringify(settings[key]) !== JSON.stringify(current.settings[key]));
    if (!changed.length) return { ok: true, control: current };
    const at = new Date(now).toISOString(), revision = current.revision + 1;
    const next = { version: 1, revision, settings, previous: current.settings, updatedAt: at,
      audit: [{ revision, at, actor: body.actor, action: restore ? 'restore_off' : 'save', changed }, ...current.audit].slice(0, 50) };
    await txn.put(ASSISTANT_CONTROL_STORAGE_KEY, next);
    return { ok: true, control: next };
  });
}

export async function callAssistantControl(env, action = 'read', body = {}) {
  const namespace = env?.PUBLIC_RATE_LIMITER;
  if (!namespace?.idFromName || !namespace?.get) return { ok: false, code: 'assistant_control_unavailable' };
  try {
    const stub = namespace.get(namespace.idFromName(ASSISTANT_BUDGET_OBJECT_NAME));
    const response = await stub.fetch(`https://rate-limit.internal/assistant/control-${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, code: 'assistant_control_unavailable' };
    const result = await response.json();
    if (typeof result.ok !== 'boolean' || (result.ok && (!result.control || !validAssistantSettings(result.control.settings)))) return { ok: false, code: 'assistant_control_unavailable' };
    return result;
  } catch { return { ok: false, code: 'assistant_control_unavailable' }; }
}

const topicUrl = (path, language) => 'https://bitbi.ai' + (language === 'de' ? (path === '/legal/privacy.html' ? '/de/legal/datenschutz.html' : '/de' + path) : path);
export function assistantAdminOverview(env, policy, snapshot) {
  const { control, usage } = snapshot, settings = control.settings;
  const effectivePolicy = policyWithAssistantSettings(policy, settings);
  const publicState = assistantReadiness(env, effectivePolicy, { knowledgeVersion });
  const adminState = assistantReadiness(env, effectivePolicy, { knowledgeVersion, privateAcceptance: true });
  const invalid = validateAssistantSettings(settings, policy);
  const selectedState = settings.mode === 'admin' ? adminState : publicState;
  const blockers = [...selectedState.blockers];
  if (invalid) blockers.push({ code: invalid, message: 'Saved settings exceed current approved policy. Save valid settings before enabling inference.' });
  let budgetPaused = false;
  if (selectedState.ready && settings.mode !== 'off') {
    const limits = selectedState.budgetLimits;
    if (usage.daily.chargedMicros + selectedState.reservationMicros > limits.dailyMicros ||
        usage.monthly.chargedMicros + selectedState.reservationMicros > limits.monthlyMicros ||
        usage.daily.requests >= limits.dailyRequests) {
      budgetPaused = true;
      blockers.push({ code: 'budget_paused', message: 'The saved mode is enabled, but the daily/monthly budget or request allowance is exhausted.' });
    }
  }
  const effectiveMode = settings.mode === 'off' ? 'off' : blockers.length ? (budgetPaused && blockers.length === 1 ? 'budget_paused' : 'blocked') : settings.mode;
  const rates = policy.pricing;
  const ratesValid = rates && rates.currency === 'USD' && rates.unit === 'million_tokens' &&
    integer(rates.inputUsdMicrosPerMillion, 1e12) && integer(rates.outputUsdMicrosPerMillion, 1e12) &&
    /^https:\/\/[^\s]+$/.test(rates.source || '') && Number.isFinite(Date.parse(rates.verifiedAt)) &&
    Date.parse(rates.verifiedAt) <= Date.now() && Number.isFinite(Date.parse(rates.validUntil));
  const ratesStatus = !rates ? 'unknown' : !ratesValid ? 'invalid' : Date.parse(rates.validUntil) <= Date.now() ? 'expired' : 'verified';
  const success = usage.lastSuccessfulInference;
  const genuine = success?.evidence === 'real' && Number.isFinite(Date.parse(success.at)) && Date.parse(success.at) <= Date.now() && ASSISTANT_MODELS[success.model]
    ? { ...success, historical: true, matchesSelectedModel: success.model === settings.model } : null;
  const accessDateValid = Number.isFinite(Date.parse(policy.accessVerifiedAt)) && Date.parse(policy.accessVerifiedAt) <= Date.now();
  return { ok: true, config: { revision: control.revision, updatedAt: control.updatedAt, settings, constraints: { outputTokens: policy.limits.outputTokens, dailyRequests: policy.limits.dailyRequests, requestsPerMinute: policy.limits.requestsPerMinute, concurrentRequests: policy.limits.concurrentRequests }, previousAvailable: Boolean(control.previous) },
    runtime: { effectiveMode, blockers, publicReady: publicState.ready && !invalid, adminReady: adminState.ready && !invalid, adminTestReady: adminState.ready && !invalid && settings.mode !== 'off',
      publicEnabled: effectiveMode === 'public', adminTestEnabled: ['admin', 'public'].includes(effectiveMode) && adminState.ready,
      deactivation: 'New requests are blocked at the durable admission boundary. Already-admitted requests may finish; transport cancellation is best effort and does not prove provider cancellation.' },
    connection: { provider: 'Cloudflare Workers AI', model: settings.model, route: 'Workers AI binding', bindingPresent: typeof env?.AI?.run === 'function',
      credentialPresence: 'Managed Workers AI binding; no chatbot API secret is used.', gatewayUsed: false,
      access: { state: policy.accessConfirmed === true && settings.model === policy.model && accessDateValid ? 'verified' : 'unverified', verifiedAt: accessDateValid ? policy.accessVerifiedAt : null },
      lastSuccessfulInference: genuine, syntheticEvidencePresent: usage.lastSuccessfulInference?.evidence === 'synthetic',
      status: genuine ? 'historical_inference_recorded' : 'not_verified',
      models: Object.keys(ASSISTANT_MODELS).map(id => ({ id, label: id.includes('apertus') ? 'Apertus v1.5 8B' : 'EuroLLM 9B IT', selectable: id === policy.model,
        reason: id === policy.model ? 'Configured candidate; activation still requires all readiness gates.' : 'Access, rates, terms and spending approval for this model must first be recorded through the protected release process.' })),
      rates: policy.pricing || null, ratesStatus },
    knowledge: { version: knowledgeVersion, reviewedAt: null, languages: ['en', 'de'], sourceManaged: true,
      maintenance: 'Approved knowledge and questions are maintained in the existing versioned product-content files, reviewed in the Admin preview, validated at build time and published through the guarded release. Restore an earlier reviewed content version through the same release path.',
      capabilities: ['Public BITBI help grounded in approved source topics', 'Contextual suggestions without inference per visit', 'Streaming text and verified source links'],
      limitations: ['No access to private accounts, balances, assets or jobs', 'No generation, billing, saving or autonomous account actions', 'Provider-advertised vision and tool calling are not enabled', ...(publicState.blockers.some(item => item.code === 'acceptance_pending') ? ['Real German and English model behavior is not yet accepted for these inputs'] : [])],
      topics: knowledgeArticles.map(article => ({ id: article.id, ...Object.fromEntries(['en', 'de'].map(language => [language, { title: article[language].title, text: article[language].text, url: topicUrl(article.path, language) }])) })),
      pages: publicPageIds.map(id => ({ id, label: id.replaceAll('-', ' ') })),
      suggestions: Object.fromEntries(publicPageIds.map(pageId => [pageId, Object.fromEntries(['en', 'de'].map(language => [language, getSuggestions({ pageId, language })]))])) },
    usage: { ...usage, limits: { dailyUsdMicros: effectivePolicy.spendingApproval?.dailyUsdMicros ?? null, monthlyUsdMicros: effectivePolicy.spendingApproval?.monthlyUsdMicros ?? null, dailyRequests: settings.dailyRequests },
      costBasis: 'Measured tokens priced using verified rates are estimates, not provider-billed totals. Unknown or cancelled usage retains its conservative reservation against the cap.',
      coverage: 'Admitted assistant provider requests only; local unknown answers and rejected requests are excluded. No prompts or responses are stored.' },
    audit: control.audit };
}
