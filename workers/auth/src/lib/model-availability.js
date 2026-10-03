import { modelAreaCatalog, modelAreaKey } from '../../../../js/shared/model-area-contract.mjs';
import { ASSISTANT_POLICY, assistantReadiness } from './website-assistant-policy.js';
import { callAssistantControl, policyWithAssistantSettings, validateAssistantSettings, assistantAdminOverview } from './website-assistant-control.js';
import { knowledgeVersion } from '../../../shared/website-assistant-knowledge.mjs';
import { getPublicOmniReadiness } from './gemini-omni-readiness.js';
import { omniMemberVisible } from '../../../../js/shared/gemini-omni-pricing.mjs';
import { getModelTariff } from './model-tariffs.js';
import { BillingError } from './billing.js';
import { failAiDispatch } from './ai-dispatch-state.js';

const areas = new WeakMap();
const fail = (code, status=503) => { throw new BillingError(code === 'model_area_disabled' ? 'This model has been temporarily disabled.' : 'Model availability could not be confirmed.', {code,status}); };
export const areaCatalog = () => modelAreaCatalog(ASSISTANT_POLICY.model);
export function modelAreaEnvironment(env, area) { const scoped=Object.create(env); areas.set(scoped,area); return scoped; }
export function trustedModelArea(env, route) {
    for(let scope=env;scope;scope=Object.getPrototypeOf(scope)){if(areas.has(scope))return areas.get(scope);}
    return route.startsWith('/api/admin/') ? null : route === '/api/ai/generate-text' ? 'canvas' : 'generation';
}
function decode(row) {
    if (!row) return { revision:0, enabled:true, updatedAt:null, history:[] };
    let value;try { value=JSON.parse(row.value_json); } catch { fail('model_availability_invalid'); }
    if (value?.version!==1 || !Number.isSafeInteger(value.revision) || value.revision<1 || typeof value.enabled!=='boolean' || !Array.isArray(value.history)) fail('model_availability_invalid');
    return value;
}
export async function readModelArea(env, modelId, area) {
    if (!areaCatalog().some(model=>model.id===modelId && model.areas.includes(area)) || area==='main') fail('model_area_unsupported',400);
    return decode(await env.DB.prepare('SELECT value_json FROM app_settings WHERE key=?').bind(modelAreaKey(modelId,area)).first());
}
export async function assertModelArea(env, modelId, area, {attempt, table}={}) {
    if (!area) return null; // Direct Admin Lab testing is independent.
    // A retained dispatch is not new admission. Recovery and settlement keep
    // their original identity; the existing dispatch fences forbid paid replay.
    if (attempt && attempt.providerOutcome && attempt.providerOutcome!=='not_dispatched') return null;
    let state;
    try { state=await readModelArea(env,modelId,area); } catch (error) { if(error instanceof BillingError)throw error; fail('model_availability_unavailable'); }
    if (!state.enabled) {
        if (attempt?.id && table) await failAiDispatch(env,table,attempt.id,{definitelyNotDispatched:true,code:'model_area_disabled'});
        fail('model_area_disabled',409);
    }
    return modelAreaKey(modelId,area);
}
export async function publicModelAvailability(env) {
    const result=await env.DB.prepare("SELECT key,value_json FROM app_settings WHERE key LIKE 'model_area:%'").all();
    if(result.success===false)fail('model_availability_unavailable');
    const stored=new Map((result.results||[]).map(row=>[row.key,row]));
    const models={};
    for(const model of areaCatalog()) {
        const flags={};for(const area of model.areas.filter(area=>area!=='main')) flags[area]=decode(stored.get(modelAreaKey(model.id,area))).enabled;
        if(Object.keys(flags).length)models[model.id]=flags;
    }
    return {version:1,models};
}
export async function adminModelAvailability(env) {
    const [tariff,omni,assistant]=await Promise.all([getModelTariff(env),getPublicOmniReadiness(env),callAssistantControl(env)]);
    const snapshot={...tariff,omni}, models=[];
    for(const model of areaCatalog()) {
        const switches={};
        for(const area of model.areas) {
            if(area==='main') {
                if(!assistant.ok){switches.main={enabled:false,available:false,revision:null,blockers:['Assistant control is unavailable.']};continue;}
                const {control}=assistant;
                const overview=assistantAdminOverview(env,ASSISTANT_POLICY,assistant);
                const blockers=overview.runtime.blockers.map(item=>item.message);
                switches.main={enabled:control.settings.mode==='public',available:control.settings.mode==='public'&&!blockers.length,revision:control.revision,blockers};
            }else {
                const state=await readModelArea(env,model.id,area),blockers=[];
                if(model.id==='google/gemini-omni-flash'&&!omniMemberVisible(snapshot))blockers.push('An activated capability and a valid retail tariff are required.');
                if(model.id==='xai/grok-4.6'&&String(env.ENABLE_GROK_4_6)!=='true')blockers.push('The existing Grok provider release is off.');
                switches[area]={enabled:state.enabled,available:state.enabled&&!blockers.length,revision:state.revision,blockers};
            }
        }
        models.push({...model,switches});
    }
    return {models,observedAt:new Date().toISOString()};
}
export async function changeModelAvailability(env,actor,body,{policy=ASSISTANT_POLICY}={}) {
    if(!body || Object.keys(body).some(k=>!['modelId','area','enabled','revision'].includes(k)) || typeof body.enabled!=='boolean' || !Number.isSafeInteger(body.revision) || body.revision<0 || !areaCatalog().some(m=>m.id===body.modelId&&m.areas.includes(body.area)))fail('model_availability_invalid',400);
    if(body.area==='main') {
        const snapshot=await callAssistantControl(env);if(!snapshot.ok)fail('model_availability_unavailable');
        if(snapshot.control.revision!==body.revision)fail('model_availability_conflict',409);
        const current=snapshot.control.settings;
        const settings={...current,mode:body.enabled?'public':current.mode==='public'?'admin':current.mode};
        if(body.enabled){const readiness=assistantReadiness(env,policyWithAssistantSettings(policy,settings),{knowledgeVersion});if(!readiness.ready||validateAssistantSettings(settings,policy))fail('assistant_activation_blocked',409);}
        const saved=await callAssistantControl(env,'write',{revision:body.revision,actor:actor.id,settings});
        if(!saved.ok)fail(saved.code,saved.code==='assistant_configuration_conflict'?409:503);
        return {modelId:body.modelId,area:body.area,enabled:settings.mode==='public',revision:saved.control.revision};
    }
    const current=await readModelArea(env,body.modelId,body.area);
    if(current.revision!==body.revision)fail('model_availability_conflict',409);
    if(current.enabled===body.enabled)return {...body};
    const at=new Date().toISOString(), next={version:1,revision:current.revision+1,enabled:body.enabled,previous:current.enabled,updatedAt:at,
        history:[...current.history,{revision:current.revision+1,actor:actor.id,at,enabled:body.enabled}].slice(-30)};
    const result=await env.DB.prepare(`INSERT INTO app_settings(key,value_json,updated_at,updated_by_user_id,reason) VALUES(?,?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at,updated_by_user_id=excluded.updated_by_user_id,reason=excluded.reason
        WHERE app_settings.value_json=?`).bind(modelAreaKey(body.modelId,body.area),JSON.stringify(next),at,actor.id,'Model area availability',current.revision?JSON.stringify(current):'').run();
    if(result.meta?.changes!==1)fail('model_availability_conflict',409);
    return {...body,revision:next.revision};
}
