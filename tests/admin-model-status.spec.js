const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1');
const load=()=>import('../workers/auth/src/lib/admin-model-status.js');
const now=Date.parse('2026-09-13T12:00:00Z'), time=offset=>new Date(now+offset).toISOString();
const registry=[{id:'model-a',label:'Model A',mediaTypes:['video'],configuration:[{scope:'admin',enabled:true}]}];
const row=(id,extra={})=>({id,model_id:'model-a',operation_key:'admin.video',status:'succeeded',provider_outcome:'succeeded',completed_at:time(-1000),created_at:time(-2000),...extra});
test('model status follows registry membership, canonical IDs and unknown vendors without a second catalog',async()=>{
 const {modelStatusCatalog}=await load();
 const item={id:'future/model',label:'Future',vendor:'Unknown vendor',capabilities:{generationEnabled:false}};
 const catalog=modelStatusCatalog({}, {models:{image:[item],video:[item]}},[{...item,mediaType:'image'}],[]);
 expect(catalog).toHaveLength(1);expect(catalog[0].mediaTypes).toEqual(['image','video']);expect(catalog[0].scopes).toEqual(['admin','member']);
 expect(modelStatusCatalog({}, {models:{}},[],[])).toEqual([]);
 const actual=modelStatusCatalog({});expect(new Set(actual.map(m=>m.id)).size).toBe(actual.length);expect(actual.some(m=>m.mediaTypes.includes('chat'))).toBe(true);
});
test('model status expires success, counts durable attempts once and never treats cache/input/unknown failures as outages',async()=>{
 const {summarizeModelStatus:s}=await load();const assess=rows=>s(registry,[{name:'admin',rows}],now).models[0];
 expect(assess([row('one'),row('one')]).paths[0].completed).toBe(1);
 expect(assess([row('old',{completed_at:time(-25*3600000),updated_at:time(0)})]).state).toBe('unknown');
 expect(assess([row('cache',{cache_hit:true})]).state).toBe('unknown');
 expect(assess([row('waiting',{status:'provider_running',provider_outcome:'dispatched',completed_at:null})]).paths[0].pending).toBe(1);
 for(const code of ['validation_error','insufficient_credits','forbidden','generation_timeout','provider_unavailable','unknown'])expect(assess([row('f',{status:'provider_failed',provider_outcome:'failed',error_code:code})]).state).toBe('unknown');
 const failure=(id,at,code='upstream_error')=>row(id,{status:'provider_failed',provider_outcome:'failed',error_code:code,completed_at:time(at)});
 expect(assess([failure('a',-500),failure('b',-300)]).state).toBe('degraded');
 expect(assess([failure('a',-3000),failure('b',-2000),row('success'),failure('c',-300)]).state).toBe('successful');
 expect(assess(['a','b','c'].map(id=>failure(id,-300,'provider_http_503'))).state).toBe('unavailable');
 expect(assess([failure('a',-300),failure('b',-200),row('success',{operation_key:'admin.other'})]).state).toBe('degraded');
 expect(s([{...registry[0],configuration:[{enabled:false}]}],[{name:'admin',rows:[row('one')]}],now).models[0].state).toBe('disabled');
});
test('model status separates provider completion, ownership/storage, video preview and music cover; no cross-path inherited success',async()=>{
 const {summarizeModelStatus:s}=await load();
 const r=row('video',{billing_status:'finalized',asset_present:1,job_status:'preview_pending',cover_status:null});
 const pending=s(registry,[{name:'member',rows:[r]}],now);
 expect(pending.models[0].state).toBe('unknown');expect(pending.models[0].reason).toBe('asset_retained_preview_pending');expect(pending.pipeline.previewPending).toBe(1);expect(pending.pipeline.stored).toBe(1);
 expect(s(registry,[{name:'member',rows:[{...r,job_status:'succeeded',asset_completed_at:time(-500)}]}],now).models[0].state).toBe('successful');
 expect(s(registry,[{name:'member',rows:[{...r,job_status:'succeeded',asset_present:0,asset_completed_at:time(-500)}]}],now).models[0].state).toBe('unknown');
 expect(s(registry,[{name:'member',rows:[{...r,job_status:'succeeded',completed_at:time(-25*3600000),asset_completed_at:time(-500)}]}],now).models[0].state).toBe('unknown');
 const missing=s(registry,[{name:'member',rows:[{...r,model_id:null,cover_status:'pending'}]}],now);expect(missing.unattributed).toBe(1);expect(missing.pipeline.coverPending).toBe(1);
});
test('model status real SQL is bounded/indexed, excludes private fields, caches reads and degrades independently on source errors',async()=>{
 const {readModelStatusSources,getAdminModelStatus,MODEL_STATUS_SOURCES,modelStatusQuery}=await load();
 const DB=new SqliteD1Database();applyAuthMigrations(DB);
 try {
  const sources=await readModelStatusSources({DB},now);expect(sources.every(s=>s.available)).toBe(true);
  for(const source of MODEL_STATUS_SOURCES){const plan=await DB.prepare('EXPLAIN QUERY PLAN '+modelStatusQuery(source)).bind(source.statuses[0],time(-86400000)).all();expect(plan.results.some(r=>/status_expires/.test(r.detail))).toBe(true);}
  let calls=0;const fetcher=async url=>{expect(url).toBe('https://www.cloudflarestatus.com/api/v2/components.json');calls++;return Response.json({components:[{name:'Workers AI',status:'operational',updated_at:time(0)},{name:'Unrelated',status:'major_outage'}]});};
  const env={DB};const a=await getAdminModelStatus(env,{now,fetcher});const b=await getAdminModelStatus(env,{now:now+100,fetcher});expect(calls).toBe(1);expect(b).toBe(a);expect(a.models.every(m=>['unknown','disabled'].includes(m.state))).toBe(true);expect(a.provider.components).toHaveLength(1);
  const before=DB.prepare;DB.prepare=()=>{throw Error('private failure detail');};
  const partial=await getAdminModelStatus(env,{now:now+300001,fetcher:async()=>{throw Error('secret');}});DB.prepare=before;
  expect(partial.stale).toBe(true);expect(partial.provider.stale).toBe(true);expect(JSON.stringify(partial)).not.toMatch(/private failure|secret|prompt|user_id|r2_key/);
 }finally{DB.close();}
});
