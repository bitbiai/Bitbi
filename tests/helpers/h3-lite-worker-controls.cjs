const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');
const {pathToFileURL}=require('url');

// Registered once by workers.spec.js; retains its existing selected-suite titles.
function registerH3LiteWorkerControls({createAuthTestEnv,loadInvokeAiVideoModule}) {
test('Canvas MiniMax H3 inspects original media bounds and the AI task adapter disables private Gateway logs',async()=>{
  const {inspectH3TimeReference,validateH3Dimensions}=await import(pathToFileURL(path.join(process.cwd(),'workers/auth/src/lib/h3-reference-metadata.js')).href);
  const fixture=fs.readFileSync(path.join(__dirname,'../fixtures/media/h3-reference.mp4'));
  expect(inspectH3TimeReference(fixture,'video','video/mp4')).toMatchObject({duration:2,width:320,height:320,fps:24,frames:48});
  expect(()=>inspectH3TimeReference(fixture.subarray(0,50),'video','video/mp4')).toThrow();
  expect(()=>inspectH3TimeReference(fs.readFileSync(path.join(__dirname,'../fixtures/media/detail-original.mp4')),'video','video/mp4')).toThrow();
  expect(()=>validateH3Dimensions({width:320,height:180})).toThrow();
  const env=createAuthTestEnv({privateVideoReferences:[
    {user_id:'owner',status:'ready',storage_reserved_bytes:10},{user_id:'owner',status:'failed',storage_reserved_bytes:20},
    {user_id:'owner',status:'retired',storage_reserved_bytes:80},{user_id:'other',status:'ready',storage_reserved_bytes:200},
  ]});
  const {calculateUserAssetStorageUsage}=await import(pathToFileURL(path.join(process.cwd(),'workers/auth/src/lib/asset-storage-quota.js')).href);
  expect(await calculateUserAssetStorageUsage(env,'owner')).toBe(30);
  const {createVideoProviderTask}=await loadInvokeAiVideoModule();let calls=0;
  for(const status of ['queued','running','succeeded','failed','cancelled']) {
    const result=await createVideoProviderTask({AI:{run:async(model,input,options)=>{
      calls++;expect(model).toBe('minimax/h3');expect(options.gateway.collectLog).toBe(false);expect(options.gateway.skipCache).toBe(true);
      expect(input.callback_url).toBe('https://bitbi.ai/api/internal/ai/h3-callback/synthetic');
      return {task:{id:'task-'+status,model:'MiniMax-H3',status,content:{url:'https://fixture.invalid/output.mp4'},resolution:'768P',usage:{output_seconds:4}}};
    }}},{id:'minimax/h3',proxied:true},{model:'minimax/h3',prompt:'Synthetic',duration:4,resolution:'768P',h3_callback:'https://bitbi.ai/api/internal/ai/h3-callback/synthetic'});
    expect(result.status).toBe(['queued','running'].includes(status)?'provider_pending':['failed','cancelled'].includes(status)?'failed':'succeeded');
    expect(result.providerTaskId).toBe('task-'+status);
  }
  expect(calls).toBe(5);
});


test('Canvas MiniMax H3 Lite keeps independent defaults, tariffs, resolution and reference-ratio rules', async()=>{
  const h3=await import('../../js/shared/minimax-h3.mjs');
  const {creditsForProviderCostUsd}=await import('../../js/shared/model-credit-pricing.mjs');
  const {validateAdminAiVideoBody}=await import('../../js/shared/admin-ai-contract.mjs');
  const {calculateAiVideoCreditCost}=await import('../../js/shared/ai-model-pricing.mjs');
  const lite={model:'minimax/h3-lite',prompt:'Synthetic Lite motion'};
  expect(h3.normalizeH3Request(lite)).toMatchObject({model:lite.model,preset:'video_minimax_h3_lite',duration:5,resolution:'480P',aspect_ratio:'16:9'});
  expect(h3.normalizeH3Request({...lite,model:'minimax/h3'})).toMatchObject({preset:'video_minimax_h3',resolution:'768P'});
  expect(validateAdminAiVideoBody({preset:'video_minimax_h3_lite',prompt:lite.prompt})).toMatchObject({model:'minimax/h3-lite',preset:'video_minimax_h3_lite',resolution:'480P'});
  for(const [model,preset] of [['minimax/h3-lite','video_minimax_h3'],['minimax/h3','video_minimax_h3_lite']]) {
    expect(()=>h3.normalizeH3Request({model,preset,prompt:lite.prompt})).toThrow();
    expect(()=>validateAdminAiVideoBody({model,preset,prompt:lite.prompt})).toThrow();
  }
  for(const [model,resolution,rate] of [['minimax/h3-lite','480P',0.025],['minimax/h3-lite','768P',0.04],['minimax/h3','768P',0.08],['minimax/h3','2K',0.13]])for(const duration of [4,5,15]) {
    const input={model,prompt:lite.prompt,resolution,duration};
    const price=h3.calculateH3CreditPricing(input);
    expect(price.modelId).toBe(model);expect(price.providerCostUsd).toBeCloseTo(rate*duration,9);
    expect(price.credits).toBe(creditsForProviderCostUsd(rate*duration));
    expect(calculateAiVideoCreditCost(model,input).credits).toBe(price.credits);
    expect(validateAdminAiVideoBody(input)).toMatchObject({model,resolution,duration});
  }
  for(const changes of [{duration:3},{duration:4.5},{duration:16},{resolution:'2K'},{resolution:'480p'},{generate_audio:true},{seed:123},{negative_prompt:'unavailable'},{callback_url:'https://foreign.invalid'}]) {
    expect(()=>h3.normalizeH3Request({...lite,...changes})).toThrow();
    expect(()=>validateAdminAiVideoBody({...lite,...changes})).toThrow();
  }
  const ref=role=>({role,source:{source_type:'saved_asset',asset_id:'owned-'+role}});
  expect(()=>h3.normalizeH3Request({...lite,aspect_ratio:'adaptive'})).toThrow();
  for(const role of ['reference_image','reference_video','reference_audio']) {
    expect(()=>h3.normalizeH3Request({...lite,references:[ref(role)],aspect_ratio:'adaptive'})).toThrow();
    expect(h3.normalizeH3Request({...lite,references:[ref(role)],aspect_ratio:'9:16'}).aspect_ratio).toBe('9:16');
    expect(h3.normalizeH3Request({...lite,model:'minimax/h3',references:[ref(role)],aspect_ratio:'adaptive'}).aspect_ratio).toBe('adaptive');
  }
  for(const references of [[ref('first_frame')],[ref('last_frame')],[ref('first_frame'),ref('last_frame')]]) {
    expect(h3.normalizeH3Request({...lite,references,aspect_ratio:'adaptive'}).references).toEqual(references);
    expect(()=>h3.normalizeH3Request({...lite,references,aspect_ratio:'16:9'})).toThrow();
  }
  expect(()=>h3.normalizeH3Request({...lite,references:[ref('first_frame'),ref('reference_image')],aspect_ratio:'adaptive'})).toThrow(/mixed/);
});

test('Canvas MiniMax H3 Lite planner constraints match concrete-ratio quote validation without changing H3',async()=>{
  const {canvasAgentModelConstraints}=await import('../../workers/auth/src/lib/canvas-agent-plan-feedback.js');
  const {prepareCanvasAgentPriceInput}=await import('../../workers/auth/src/lib/canvas-agent-price-input.js');
  const {getCanvasModelForRole}=await import('../../js/shared/canvas-model-contract.mjs');
  const full=getCanvasModelForRole('minimax/h3','member'),lite=getCanvasModelForRole('minimax/h3-lite','member');
  const fullConstraints=canvasAgentModelConstraints(full),liteConstraints=canvasAgentModelConstraints(lite);
  const referenceRoles=['reference_image','reference_video','reference_audio'];
  expect(fullConstraints).toEqual({source:'js/shared/minimax-h3.mjs',
    referenceModes:[{id:'frames',roles:['first_frame','last_frame'],requires:{aspectRatio:'adaptive'},limits:{first_frame:1,last_frame:1}},
      {id:'reference',roles:referenceRoles,limits:{reference_image:9,reference_video:3,reference_audio:3}}],
    mutuallyExclusiveModes:['frames','reference'],maxReferences:12,
    videoLastFrame:{method:'last_frame',effectiveRole:'first_frame',requires:{aspectRatio:'adaptive'},cannotCombineWith:referenceRoles},
    referenceDurationSeconds:{video:{min:2,max:15,totalMax:15},audio:{min:2,max:15,totalMax:15}}});
  const concrete=['21:9','16:9','4:3','1:1','3:4','9:16'];
  expect(liteConstraints.referenceModes[1].requires).toEqual({aspectRatioAny:concrete});
  expect(liteConstraints.conditional).toEqual([{when:{rolesNone:['first_frame','last_frame']},requires:{aspectRatioAny:concrete}}]);
  expect(liteConstraints.referenceModes[0]).toEqual(fullConstraints.referenceModes[0]);
  const dependency=role=>({dep:{role,key:'source'},source:{key:'source'},kind:role==='reference_video'?'video':role==='reference_audio'?'audio':'image'});
  const quote=(model,aspectRatio,dependencies)=>prepareCanvasAgentPriceInput({model,node:{prompt:'Synthetic planner motion',config:{aspectRatio}},dependencies});
  for(const dependencies of [[],...referenceRoles.map(role=>[dependency(role)])]) {
    expect(()=>quote(lite,'adaptive',dependencies)).toThrow(/concrete ratio/);
    for(const ratio of concrete)expect(quote(lite,ratio,dependencies)).toMatchObject({model:lite.id,resolution:'480P',aspect_ratio:ratio});
  }
  for(const role of referenceRoles)expect(quote(full,'adaptive',[dependency(role)])).toMatchObject({model:full.id,resolution:'768P',aspect_ratio:'adaptive'});
  for(const role of ['first_frame','last_frame']) {
    expect(quote(lite,'adaptive',[dependency(role)]).aspect_ratio).toBe('adaptive');
    expect(()=>quote(lite,'16:9',[dependency(role)])).toThrow(/canvas_agent_h3_frame_ratio_required/);
  }
});

test('Canvas MiniMax H3 Lite sends exact private REST envelope and never falls back after uncertainty',async()=>{
  const {callH3Provider}=await import('../../workers/auth/src/lib/h3-provider-result.js');
  const {buildVideoPayload}=await loadInvokeAiVideoModule();
  const input={model:'minimax/h3-lite',prompt:'PRIVATE_PROMPT',duration:4,resolution:'480P',aspect_ratio:'16:9',h3_callback:'https://bitbi.ai/api/internal/ai/h3-callback/synthetic-private'};
  const wire={content:[{type:'text',text:'PRIVATE_PROMPT'}],duration:4,resolution:'480P',ratio:'16:9',callback_url:input.h3_callback};
  expect(buildVideoPayload({id:input.model},input).payload).toEqual(wire);
  for(const outcome of ['success','redirect','transport','invalid-json']) {
    let calls=0,bindingCalls=0;
    const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),H3_CLOUDFLARE_API_TOKEN:'synthetic-only',AI:{run(){bindingCalls++;throw new Error('Forbidden binding fallback');}},__TEST_FETCH:async(url,init)=>{
      calls++;expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/run`);
      expect(init.redirect).toBe('manual');expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({model:'minimax/h3-lite',input:wire});
      const headers=new Headers(init.headers);
      expect(headers.get('Authorization')).toBe('Bearer synthetic-only');
      expect(headers.get('cf-aig-gateway-id')).toBe('default');expect(headers.get('cf-aig-max-attempts')).toBe('1');
      expect(headers.get('cf-aig-skip-cache')).toBe('true');expect(headers.get('cf-aig-collect-log')).toBe('false');
      expect(headers.get('cf-aig-metadata')).toBe('{"bitbi_dispatch":"lite-dispatch-123"}');
      if(outcome==='transport')throw new Error('PRIVATE_PROMPT synthetic-only');
      if(outcome==='redirect')return new Response(null,{status:302,headers:{Location:'https://foreign.invalid/private'}});
      if(outcome==='invalid-json')return new Response('PRIVATE_PROMPT');
      return Response.json({success:true,result:{state:'Completed',result:{task:{id:'lite-task',model:'MiniMax-H3-Lite',status:'queued'}}}});
    }};
    const response=await callH3Provider(env,input.model,wire,{gateway:{collectLog:true,skipCache:false}},'lite-dispatch-123').catch(error=>error);
    if(outcome==='success')expect(response.task.model).toBe('MiniMax-H3-Lite');
    else {expect(response.code).toBe('generation_provider_call_outcome_unknown');expect(JSON.stringify(response)).not.toMatch(/PRIVATE_PROMPT|synthetic-only|foreign.invalid/);}
    expect(calls).toBe(1);expect(bindingCalls).toBe(0);
  }
});

test('Canvas MiniMax H3 Lite rejects cross-model stored receipts and adapter task results in both directions',async()=>{
  const {parseH3Task}=await import('../../js/shared/minimax-h3.mjs');
  const {storedH3MemberTask,h3ProviderResult}=await import('../../workers/auth/src/lib/minimax-h3-callback.js');
  const {createVideoProviderTask}=await loadInvokeAiVideoModule();
  for(const [model,provider,foreign,resolution] of [['minimax/h3-lite','MiniMax-H3-Lite','MiniMax-H3','480P'],['minimax/h3','MiniMax-H3','MiniMax-H3-Lite','768P']]) {
    const task={id:'same-task-id',model:provider,status:'succeeded',resolution,duration:15,usage:{output_seconds:4,input_seconds:99,total_seconds:114},content:{url:'https://fixture.invalid/output.mp4'}};
    expect(parseH3Task({task},model).outputSeconds).toBe(4);
    expect(()=>parseH3Task({task:{...task,model:foreign}},model)).toThrow(/receipt/);
    expect(()=>h3ProviderResult({task:{...task,model:foreign}},model)).toThrow(/receipt/);
    expect(()=>parseH3Task({task:{...task,content:{prompt:'https://fixture.invalid/input.mp4'}}},model)).toThrow(/output/);
    const key='users/synthetic/generation-jobs/job/provider-ai-0.json';
    const job={id:'job',user_id:'synthetic',media_type:'video',input_r2_key:'accepted-input',provider_receipts_json:JSON.stringify({'ai-0':{key,fingerprint:'a'.repeat(64)}})};
    for(const receiptModel of [provider,foreign]) {
      const env={USER_IMAGES:{async get(path){return {body:JSON.stringify(path==='accepted-input'?{model}:{kind:'json',value:{task:{...task,model:receiptModel}}})};}}};
      if(receiptModel===provider)expect((await storedH3MemberTask(env,job)).task.model).toBe(provider);
      else await expect(storedH3MemberTask(env,job)).rejects.toMatchObject({code:'h3_invalid_receipt'});
    }
    const input={model,prompt:'Synthetic',duration:5,resolution,aspect_ratio:'16:9',h3_callback:'https://bitbi.ai/api/internal/ai/h3-callback/synthetic'};
    for(const state of ['queued','running','succeeded','failed','cancelled']) {
      const result=await createVideoProviderTask({AI:{run:async(id,payload,options)=>{
        expect(id).toBe(model);expect(options.gateway.collectLog).toBe(false);expect(options.gateway.skipCache).toBe(true);
        return {task:{...task,status:state}};
      }}},{id:model,proxied:true},input);
      expect(result.status).toBe(['queued','running'].includes(state)?'provider_pending':['failed','cancelled'].includes(state)?'failed':'succeeded');
    }
    await expect(createVideoProviderTask({AI:{run:async()=>({task:{...task,model:foreign}})}},{id:model,proxied:true},input)).rejects.toMatchObject({code:'h3_invalid_receipt'});
  }
});

// The same control is executed by the isolated workerd/D1 member-generation
// suite. These focused SQLite cases are fast diagnostics, not native acceptance.
for(const name of ['h3-callback','h3-wrong-receipt','h3-lite-callback','h3-lite-callback-failed','h3-lite-failed','h3-lite-output-usage','h3-lite-references','h3-lite-wrong-receipt','h3-lite-credit-review-resolution','h3-lite-credit-review-missing','h3-lite-credit-review-invalid'])test(`Canvas MiniMax H3 Lite durable family: ${name}`,async()=>{
  const {SqliteD1Database,applyAuthMigrations}=require('./sqlite-d1.js');
  const db=new SqliteD1Database();applyAuthMigrations(db);
  const nativeFetch=globalThis.fetch,lite=name.startsWith('h3-lite-'),scenario=name.replace('h3-lite-','h3-');
  globalThis.fetch=async(url,init)=>{
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/run`);
    const {model,input}=JSON.parse(init.body);expect(model).toBe(lite?'minimax/h3-lite':'minimax/h3');
    return Response.json({success:true,result:{state:'Completed',result:{task:{id:'synthetic-h3-'+name,model:(scenario==='h3-wrong-receipt'?!lite:lite)?'MiniMax-H3-Lite':'MiniMax-H3',status:scenario.startsWith('h3-callback')?'queued':scenario==='h3-failed'?'failed':'succeeded',resolution:scenario==='h3-credit-review-resolution'?'2K':input.resolution,duration:input.duration,content:{url:'https://fixture.invalid/member.mp4'},usage:{...(scenario==='h3-credit-review-missing'?{}:{output_seconds:scenario==='h3-credit-review-invalid'?0:scenario==='h3-output-usage'?4:input.duration}),input_seconds:99,total_seconds:104}}}}});
  };
  try {
    const {memberGenerationCase}=await import('./member-generation-control.mjs');
    const fixture={kind:'video',input:{model:lite?'minimax/h3-lite':'minimax/h3',prompt:'Synthetic family motion',duration:5,resolution:lite&&scenario!=='h3-references'?'480P':'768P'}};
    for(const [key,file] of [['videoBase64','test-video-changing.mp4'],['posterBase64','member-video-poster.webp'],['h3VideoBase64','h3-reference.mp4'],['h3ImageBase64','h3-frame.png']])fixture[key]=fs.readFileSync(path.join(__dirname,'../fixtures/media',file)).toString('base64');
    const result=await memberGenerationCase({...createAuthTestEnv(),DB:db},name,fixture);
    expect(result.calls.provider).toBe(1);
    expect(result.status).toBe(scenario==='h3-wrong-receipt'||scenario.startsWith('h3-credit-review-')?'outcome_unknown':['h3-failed','h3-callback-failed'].includes(scenario)?'failed':'succeeded');
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally {globalThis.fetch=nativeFetch;db.close();}
});

}
module.exports={registerH3LiteWorkerControls};
