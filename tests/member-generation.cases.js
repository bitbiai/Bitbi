const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
for(const name of ['flux-success','flux-schema','flux-5006','flux-http400','flux-transport'])test(`durable member generation: ${name}`,async()=>{
  const db=new SqliteD1Database();applyAuthMigrations(db);
  try {
    const {memberGenerationCase}=await import('./helpers/member-generation-control.mjs');
    const result=await memberGenerationCase({...createAuthTestEnv(),DB:db},name,{kind:'image',input:{model:'@cf/black-forest-labs/flux-1-schnell',prompt:'Synthetic strict-schema image',steps:6,seed:12345}});
    expect(result.calls.provider).toBe(1);
    expect(result.status).toBe(name==='flux-success'?'succeeded':'outcome_unknown');
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally {db.close();}
});
for(const name of ['asset-naming-video','asset-naming-manual','asset-naming-image','asset-naming-music','asset-naming-image-manual','asset-naming-music-manual','clock-lease-expired','clock-credit-expired','clock-finalization-expired','closed-browser','execution-exhausted','poster-retry','stale-poster','insert-response-lost','provider-unknown','music-failed','image','music','music-cover-retry','debit-response-lost','unpublished-asset','finalization-response-lost','storage-restart']) {
  test(`durable member generation: ${name}`,async()=>{
    const db=new SqliteD1Database();applyAuthMigrations(db);
    try {
      const {memberGenerationCase}=await import(pathToFileURL(path.join(__dirname,'helpers/member-generation-control.mjs')).href);
      const result=await memberGenerationCase({...createAuthTestEnv(),DB:db},name);
      expect(result.calls.provider).toBe(name==='execution-exhausted'?0:(name.startsWith('music') || name.startsWith('asset-naming-music')) && name!=='music-failed'?2:1);
      expect(result.status).toBe(['provider-unknown','clock-credit-expired'].includes(name)?'outcome_unknown':['music-failed','execution-exhausted'].includes(name)?'failed':'succeeded');
      expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
      await test.info().attach('member-generation-result',{body:JSON.stringify(result),contentType:'application/json'});
    } finally {db.close();}
  });
}

test('durable member generation: one pending poster dispatches the existing processor, with cooldown',async()=>{
  const {maybeDispatchMemvidStreamPreviewProcessor}=await import(pathToFileURL(path.resolve(__dirname,'../workers/auth/src/lib/memvid-stream-preview-dispatch.js')).href);
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  const env={...createAuthTestEnv(),DB,ENABLE_MEMVID_STREAM_PREVIEW_AUTO_DISPATCH:'true',
    MEMVID_STREAM_PREVIEW_AUTO_DISPATCH_THRESHOLD:'3',GITHUB_ACTIONS_DISPATCH_TOKEN:'synthetic-not-live',
    GITHUB_ACTIONS_DISPATCH_OWNER:'fixture',GITHUB_ACTIONS_DISPATCH_REPO:'fixture',GITHUB_ACTIONS_DISPATCH_REF:'main'};
  const requests=[],original=global.fetch;
  global.fetch=async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});return new Response(null,{status:204});};
  try {
    const options={reason:'member_video_posters',queuedNewCount:1,memberGenerationPosters:true};
    // Admission hints are not backlog. The current dispatcher reads durable,
    // processor-assigned work before acquiring a lease or sending a request.
    expect((await maybeDispatchMemvidStreamPreviewProcessor(env,options)).started).toBe(false);
    expect(requests).toEqual([]);
    const now=new Date().toISOString(),id='synthetic-poster-dispatch';
    await DB.prepare('INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)').bind(id,id+'@example.invalid','synthetic',now).run();
    await DB.prepare("INSERT INTO member_ai_usage_attempts_v2(id,user_id,feature_key,operation_key,route,idempotency_key,request_fingerprint,credit_cost,created_at,updated_at,expires_at) VALUES(?,?,'ai.video.generate','member.video.generate','/api/ai/generate-video',?,'synthetic',1,?,?,?)").bind(id,id,id,now,now,'2099-01-01').run();
    await DB.prepare("INSERT INTO member_generation_jobs(id,user_id,usage_attempt_id,media_type,request_key,input_r2_key,next_attempt_at,created_at,updated_at,status,processing_backend) VALUES(?,?,?,'video',?,'synthetic/input',?,?,?,'preview_pending','github')").bind(id,id,id,id,now,now,now).run();
    expect((await maybeDispatchMemvidStreamPreviewProcessor(env,options)).started).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].body.inputs).toMatchObject({member_generation_posters:'true',max_runs:'1',dry_run:'false'});
    expect(requests[0].url).toMatch(/memvid-stream-preview-processor.yml\/dispatches$/);
    expect((await maybeDispatchMemvidStreamPreviewProcessor(env,options)).dispatch_skipped_reason).toBe('dispatch_cooldown_active');
    expect(requests).toHaveLength(1);
    env.ENABLE_MEMVID_STREAM_PREVIEW_AUTO_DISPATCH='false';
    expect((await maybeDispatchMemvidStreamPreviewProcessor(env,options)).dispatch_skipped_reason).toBe('auto_dispatch_disabled');
  } finally {global.fetch=original;DB.close();}
});


test('asset naming: whitespace, short and empty prompts; existing filename sanitizer', async () => {
  const {promptAssetTitle,slugifyFileName}=await import('../workers/auth/src/lib/asset-names.js');
  for(const [prompt,expected] of [['a little worm in a pile','a little worm'],['  a\n little \t worm  in','a little worm'],['two words','two words'],['alone','alone'],[' \n ', 'Generated Video']]) {
    expect(promptAssetTitle(prompt,'Generated Video')).toBe(expected);
  }
  expect(slugifyFileName(promptAssetTitle('a little worm in a pile'))+'.mp4').toBe('a-little-worm.mp4');
  expect(slugifyFileName('../My own manual name')).toBe('my-own-manual-name');
});
