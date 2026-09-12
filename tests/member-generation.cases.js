const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
for(const name of ['closed-browser','execution-exhausted','poster-retry','stale-poster','insert-response-lost','provider-unknown','music-failed','image','music','music-cover-retry','debit-response-lost','unpublished-asset','finalization-response-lost','storage-restart']) {
  test(`durable member generation: ${name}`,async()=>{
    const db=new SqliteD1Database();applyAuthMigrations(db);
    try {
      const {memberGenerationCase}=await import(pathToFileURL(path.join(__dirname,'helpers/member-generation-control.mjs')).href);
      const result=await memberGenerationCase({...createAuthTestEnv(),DB:db},name);
      expect(result.calls.provider).toBe(name==='execution-exhausted'?0:name.startsWith('music') && name!=='music-failed'?2:1);
      expect(result.status).toBe(name==='provider-unknown'?'outcome_unknown':['music-failed','execution-exhausted'].includes(name)?'failed':'succeeded');
      expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
      await test.info().attach('member-generation-result',{body:JSON.stringify(result),contentType:'application/json'});
    } finally {db.close();}
  });
}

test('durable member generation: one pending poster dispatches the existing processor, with cooldown',async()=>{
  const {maybeDispatchMemvidStreamPreviewProcessor}=await import(pathToFileURL(path.resolve(__dirname,'../workers/auth/src/lib/memvid-stream-preview-dispatch.js')).href);
  const env={...createAuthTestEnv(),ENABLE_MEMVID_STREAM_PREVIEW_AUTO_DISPATCH:'true',
    MEMVID_STREAM_PREVIEW_AUTO_DISPATCH_THRESHOLD:'3',GITHUB_ACTIONS_DISPATCH_TOKEN:'synthetic-not-live',
    GITHUB_ACTIONS_DISPATCH_OWNER:'fixture',GITHUB_ACTIONS_DISPATCH_REPO:'fixture',GITHUB_ACTIONS_DISPATCH_REF:'main'};
  const requests=[],original=global.fetch;
  global.fetch=async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});return new Response(null,{status:204});};
  try {
    const options={reason:'member_video_posters',queuedNewCount:1,memberGenerationPosters:true};
    expect((await maybeDispatchMemvidStreamPreviewProcessor(env,options)).started).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].body.inputs).toMatchObject({member_generation_posters:'true',max_runs:'1',dry_run:'false'});
    expect(requests[0].url).toMatch(/memvid-stream-preview-processor.yml\/dispatches$/);
    expect((await maybeDispatchMemvidStreamPreviewProcessor(env,options)).dispatch_skipped_reason).toBe('dispatch_cooldown_active');
    expect(requests).toHaveLength(1);
    env.ENABLE_MEMVID_STREAM_PREVIEW_AUTO_DISPATCH='false';
    expect((await maybeDispatchMemvidStreamPreviewProcessor(env,options)).dispatch_skipped_reason).toBe('auto_dispatch_disabled');
  } finally {global.fetch=original;}
});
