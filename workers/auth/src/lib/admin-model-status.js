import { readTextBodyLimited } from './request.js';
import { listAdminAiCatalog, resolveAdminAiModelSelection } from '../../../../js/shared/admin-ai-contract.mjs';
import { getMemberExposedModels } from '../../../../js/shared/member-model-exposure.mjs';
import { listPublicChatModels } from '../../../shared/chat-model-contract.mjs';

export const MODEL_STATUS_FRESH_MS = 24 * 60 * 60 * 1000;
const TECHNICAL_PROVIDER_CODES = new Set(['upstream_error','provider_http_500','provider_http_502','provider_http_503','provider_http_504']);
const OUTAGE_CODES = new Set(['provider_http_503']);
const PROCESSING_CODES = new Set(['generation_storage_failed','generation_preview_failed','generation_result_requires_credit_review','storage_error','save_failed']);
const cache = new WeakMap();
const iso = value => { const time=Date.parse(value); return Number.isFinite(time)?new Date(time).toISOString():null; };

export function modelStatusCatalog(env, catalog=listAdminAiCatalog(), members=getMemberExposedModels(), chats=listPublicChatModels(env)) {
  const models=new Map();
  const add=(model,type,scope,enabled=true)=>{
    if(typeof model.id!=='string'||!model.id)return;
    let row=models.get(model.id);
    if(!row) {
      row={id:model.id,label:model.label||model.id,mediaTypes:[],vendor:model.vendor||model.provider||'Unknown',
        execution:model.id.startsWith('@cf/')?'Cloudflare Workers AI':(model.providerLabel && model.providerLabel!==model.vendor ? model.providerLabel : 'Not verified'),scopes:[],configuration:[]};
      models.set(row.id,row);
    }
    if(!row.mediaTypes.includes(type))row.mediaTypes.push(type);
    if(!row.scopes.includes(scope))row.scopes.push(scope);
    row.configuration.push({scope,enabled});
  };
  for(const [type,rows]of Object.entries(catalog.models||{}))for(const model of rows)add(model,type,'admin',model.capabilities?.generationEnabled!==false);
  for(const model of members)add(model,model.mediaType,'member');
  for(const model of chats)add(model,'chat','chat',model.enabled);
  return [...models.values()];
}

function canonicalModel(id, catalog) {
  if(catalog.has(id))return id;
  for(const task of ['image','video','music','text','embeddings']) {
    try {const canonical=resolveAdminAiModelSelection(task,{model:id}).model.id;if(catalog.has(canonical))return canonical;}catch{}
  }
  return null;
}

// Rows are one durable attempt each, never provider polls, deliveries or browser requests.
export function summarizeModelStatus(catalog, sources, now=Date.now()) {
  const fresh=value=>{const t=Date.parse(value);return Number.isFinite(t)&&t<=now&&t>=now-MODEL_STATUS_FRESH_MS;};
  const index=new Map(catalog.map(model=>[model.id,{...model,paths:[],state:'unknown',lastSuccess:null,reason:'no_recent_evidence'}]));
  const pipeline={active:0,stored:0,previewPending:0,previewFailed:0,coverPending:0,coverFailed:0,failed:0,unknown:0};
  let unattributed=0;
  const seen=new Set(), aliases=new Map();
  for(const source of sources)for(const row of source.rows||[]) {
    const key=source.name+':'+row.id;if(seen.has(key))continue;seen.add(key);
    const member=source.name==='member';
    const recentJob=fresh(row.asset_completed_at||row.created_at);
    const stored=member&&row.asset_present===1&&row.billing_status==='finalized'&&['succeeded','preview_pending','ingesting'].includes(row.job_status);
    if(member&&recentJob){
      if(stored)pipeline.stored++;
      if(row.job_status==='preview_pending'){if(row.job_error_code==='preview_retry_exhausted')pipeline.previewFailed++;else pipeline.previewPending++;}
      if(row.cover_status==='failed')pipeline.coverFailed++;else if(row.cover_status==='pending')pipeline.coverPending++;
      if(['queued','processing','ingesting'].includes(row.job_status))pipeline.active++;
      if(row.job_status==='failed')pipeline.failed++;
      if(row.job_status==='outcome_unknown')pipeline.unknown++;
    }
    if(!aliases.has(row.model_id))aliases.set(row.model_id,typeof row.model_id==='string'&&row.model_id?canonicalModel(row.model_id,index):null);
    const model=index.get(aliases.get(row.model_id));
    if(!model){unattributed++;continue;}
    const operation=/^[a-zA-Z0-9_.:-]{1,120}$/.test(row.operation_key||'')?row.operation_key:'unattributed';
    const execution=/^[a-zA-Z0-9_.-]{1,64}$/.test(row.execution_provider||'')?row.execution_provider:'not_recorded';
    const pathId=source.name+':'+operation+':'+execution;
    let path=model.paths.find(p=>p.id===pathId);
    if(!path){path={id:pathId,source:source.name,operation,execution,lastSuccess:null,lastProblem:null,completed:0,technicalFailures:0,outages:0,otherFailures:0,pending:0,providerOutcome:'unconfirmed',assetOutcome:'not_observed',cache:'not_recorded',failures:[]};model.paths.push(path);}
    // A late poster completion must not refresh an old provider observation.
    const time=iso(row.completed_at);
    const providerDone=row.provider_outcome==='succeeded'||(!row.provider_outcome&&row.provider_status==='succeeded');
    const cacheHit=['hit','HIT','true',true,1].includes(row.cache_hit);
    if(cacheHit){path.cache='hit';continue;}
    const complete=member?stored&&row.job_status==='succeeded':row.status==='succeeded'&&providerDone;
    if(providerDone)path.providerOutcome='result_received';
    if(stored)path.assetOutcome=row.job_status==='preview_pending'?'preview_pending':row.job_status==='succeeded'?'stored':'storage_finalizing';
    if(complete&&time&&Date.parse(time)<=now) {if(fresh(time))path.completed++;if(!path.lastSuccess||time>path.lastSuccess)path.lastSuccess=time;}
    if(['pending','reserved','provider_running'].includes(row.status)&&fresh(row.created_at))path.pending++;
    const problemTime=iso(row.completed_at); // Never cleanup-sensitive updated_at.
    if(!fresh(problemTime))continue;
    const failed=row.provider_outcome==='failed'||row.provider_status==='failed';
    if(failed&&TECHNICAL_PROVIDER_CODES.has(row.error_code)){
      path.failures.push({at:problemTime,outage:OUTAGE_CODES.has(row.error_code)});
      if(!path.lastProblem||problemTime>path.lastProblem)path.lastProblem=problemTime;
    }else if(row.error_code){path.otherFailures++;if(PROCESSING_CODES.has(row.error_code))path.assetOutcome='processing_problem';}
  }
  for(const model of index.values()) {
    for(const path of model.paths){
      const current=path.failures.filter(f=>!path.lastSuccess||f.at>path.lastSuccess);
      path.technicalFailures=current.length;path.outages=current.filter(f=>f.outage).length;delete path.failures;
    }
    const successful=model.paths.map(p=>p.lastSuccess).filter(Boolean).sort();model.lastSuccess=successful.at(-1)||null;
    const failing=model.paths.filter(p=>p.technicalFailures>=2&&(!p.lastSuccess||p.lastProblem>p.lastSuccess));
    for(const path of model.paths)path.state=path.technicalFailures>=2&&(!path.lastSuccess||path.lastProblem>path.lastSuccess)?(path.outages>=3?'unavailable':'degraded'):fresh(path.lastSuccess)?'successful':'unknown';
    if(model.configuration.every(c=>c.enabled===false)){model.state='disabled';model.reason='configuration_disabled';}
    else if(failing.length){model.state=!fresh(model.lastSuccess)&&failing.every(p=>p.outages>=3)?'unavailable':'degraded';model.reason='repeated_technical_failures';}
    else if(fresh(model.lastSuccess)){model.state='successful';model.reason='recent_completed_result';}
    else if(model.paths.some(p=>p.assetOutcome==='preview_pending'))model.reason='asset_retained_preview_pending';
    else if(model.paths.some(p=>p.otherFailures))model.reason='unclassified_or_input_account_problem';
  }
  return {models:[...index.values()],pipeline,unattributed};
}

export const MODEL_STATUS_SOURCES = [
  {name:'member',table:'member_ai_usage_attempts_v2',statuses:['reserved','provider_running','provider_failed','finalizing','billing_failed','succeeded','expired'],
    columns:`a.id, a.operation_key, a.status, a.provider_status, a.provider_outcome, NULL AS execution_provider, a.billing_status, a.result_model AS model_id, a.error_code, a.created_at, a.completed_at,
      json_extract(CASE WHEN json_valid(a.metadata_json) THEN a.metadata_json ELSE '{}' END,'$.cover_generation_status') AS cover_status,
      json_extract(CASE WHEN json_valid(a.metadata_json) THEN a.metadata_json ELSE '{}' END,'$.cache_hit') AS cache_hit,
      j.status AS job_status, j.error_code AS job_error_code, j.completed_at AS asset_completed_at, CASE WHEN j.asset_id IS NOT NULL AND (EXISTS(SELECT 1 FROM ai_images i WHERE i.id=j.asset_id AND i.user_id=j.user_id) OR EXISTS(SELECT 1 FROM ai_text_assets t WHERE t.id=j.asset_id AND t.user_id=j.user_id)) THEN 1 ELSE 0 END AS asset_present`,
    join:'LEFT JOIN member_generation_jobs j ON j.usage_attempt_id=a.id AND j.user_id=a.user_id'},
  {name:'admin',table:'admin_ai_usage_attempts_v2',statuses:['pending','provider_running','provider_failed','succeeded','terminal_failure','expired'],
    columns:`a.id, a.operation_key, a.status, a.provider_status, a.provider_outcome, a.provider_family AS execution_provider, a.model_key AS model_id, a.error_code, a.created_at, a.completed_at,
      json_extract(CASE WHEN json_valid(a.result_metadata_json) THEN a.result_metadata_json ELSE '{}' END,'$.cache_hit') AS cache_hit`,join:''},
];
export function modelStatusQuery(source) {
  // Existing (status, expires_at) indexes bound the scan; joins use unique/PK keys.
  return `SELECT ${source.columns} FROM ${source.table} a ${source.join} WHERE a.status=? AND a.expires_at>=? ORDER BY a.expires_at DESC LIMIT 100`;
}
export async function readModelStatusSources(env, now=Date.now()) {
  const cutoff=new Date(now-MODEL_STATUS_FRESH_MS).toISOString();
  return Promise.all(MODEL_STATUS_SOURCES.map(async source=>{
    try {
      const rows=[];let truncated=false;
      for(const status of source.statuses){const result=await env.DB.prepare(modelStatusQuery(source)).bind(status,cutoff).all();if(!result.success&&result.success!==undefined)throw Error('read');rows.push(...result.results);truncated ||= result.results.length===100;}
      return {name:source.name,available:true,truncated,rows};
    }catch{return {name:source.name,available:false,truncated:false,rows:[]};}
  }));
}

export async function getAdminModelStatus(env, {now=Date.now(),fetcher=fetch}={}) {
  let entry=cache.get(env);
  if(entry?.value&&now-entry.at<300_000)return entry.value;
  if(entry?.pending)return entry.pending;
  if(!entry){entry={};cache.set(env,entry);}
  entry.pending=(async()=>{
    const sources=await readModelStatusSources(env,now);
    const partial=sources.some(s=>!s.available);
    let provider;
    try {
      const response=await fetcher('https://www.cloudflarestatus.com/api/v2/components.json',{headers:{'User-Agent':'BITBI-Admin-Status/1.0 (+https://bitbi.ai)'},signal:AbortSignal.timeout(8000),redirect:'error',cf:{cacheTtl:300,cacheEverything:true}});
      if(!response.ok)throw Error('status');
      let text;try{text=await readTextBodyLimited(response,{maxBytes:300_000});}finally{await response.body?.cancel().catch(()=>{});}
      const data=JSON.parse(text);if(!Array.isArray(data.components))throw Error('format');
      provider={source:'https://www.cloudflarestatus.com/api',observedAt:new Date(now).toISOString(),stale:false,
        components:data.components.filter(c=>['Workers AI','AI Gateway','R2','D1','Workers','Queues','Stream'].includes(c.name)).map(c=>({name:c.name,state:['operational','degraded_performance','partial_outage','major_outage','under_maintenance'].includes(c.status)?c.status:'unknown',updatedAt:iso(c.updated_at)}))};
    }catch{provider=entry.value?.provider?{...entry.value.provider,stale:true}:{source:'https://www.cloudflarestatus.com/api',observedAt:null,stale:true,components:[]};}
    const value={observedAt:new Date(now).toISOString(),freshForSeconds:300,evidenceWindowHours:24,
      ...(partial&&entry.value ? {models:modelStatusCatalog(env).map(m=>{const old=entry.value.models.find(p=>p.id===m.id);return {...m,lastSuccess:old?.lastSuccess||null,state:m.configuration.every(c=>!c.enabled)?'disabled':'unknown',reason:'source_stale',paths:(old?.paths||[]).map(p=>({...p,state:'unknown'}))};}),pipeline:entry.value.pipeline,unattributed:entry.value.unattributed} : summarizeModelStatus(modelStatusCatalog(env),sources,now)),
      stale:partial, evidenceObservedAt:partial&&entry.value?entry.value.evidenceObservedAt:new Date(now).toISOString(),sources:sources.map(({rows,...source})=>source),provider,
      coverage:{chat:'not_connected',gatewayLogs:'not_connected',providerStatus:'component_only',adminMediaStorage:'not_correlated',memberFailedModel:'unattributed_when_result_model_missing',sampleLimitPerStatus:100}};
    entry.value=value;entry.at=now;return value;
  })();
  try{return await entry.pending;}finally{entry.pending=null;}
}
