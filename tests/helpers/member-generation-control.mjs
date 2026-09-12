import worker from '../../workers/auth/src/index.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { topUpMemberDailyCredits, grantMemberCredits } from '../../workers/auth/src/lib/billing.js';

const check = (condition,message) => { if(!condition) throw new Error(message); };
const png = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAABAAAAAQBPJcTWAAAEmklEQVR4nO1VfWiWVRQ/9+N53o+9uTVXmAsxg1oKQvZH5cCPYYZU0gj6oDEW+yPYK0IbLsg5P/YhSjAztxGSf5VCkAZSYLByog4GhRZ9EMUsDIutCWvbe5/nuffczr3vnLMW/RFBf+y823n33Pvcc36/c37njrVn0GjNTYBoBTAGQD9ke+gJQAKSTyDr12L6FSwij/45AC1BTgLn/MYx41xaOx+JgotA0V0ITBhwAcLCrLkgWIzE7E0/xyxYBiwGE6Ioxub0oXXLZvYpQTqxCSTvwbMaKEfagRATbmNDxjNwKB63zkcs49PWeB5TPkJ5BLZWhmiMYS506AHFT1x370SLXARCQWkpOnkEtDAD06JlnM2CpdpZT4cDQ7eJgghbBznWrnTGuoNihjx6HsgYl1OQ8qh1QmcYQdFgkkAGNlFSguIZij0OKgzCxCpKgy6+sVCmiR6Pqf4aXVeEdaWOIPTlz7rwgaJd6aDNqa0BzATuJUxAZiBS9CUzmbQ2psjDG8VKARqqFMxrcSxzOR1PgBBSysham9bECsvgEpXok7bVSqnxsqW0/uLJa4nSFQyCAA5VVzDGJjYYxoKa1y4WQE2azdRk4QVkmPYlcuWqkl/oSXPm6SpJ8dkNVFRNzlh3935U7+zZ/7lYBs3N9+TzTx04cNpkob5+XW78p/7+K8Mjo12da3t7epteaZqcH7+zfD5vfvz4yJFLcnecoo6c960bbAMobBOfBmxdaFn89kcj16pHnnuBpdHaq+fWn4X0/TA0sun9toLd27i1U2TbpAG9AgY6dr0UWdXZeeIHvsWg+WazgK/fYINrYMVaOTtZ4FVJD9wxof6TVoB0JAMJUULTIvwceplRr8FqarUNIQyoYQaLWlKo3CjEMWojslkqMkFwE5VwjtQFYam3m0ajfP5RgaavbzhrIZpIBM2rhNVjUFf3gK5ZtW3HYRIDISANKdBDUPNk99Uy0hfUlIOJoKCFkqViy+jZpqYGyQHmDiiJO4ogl8tFk7+TuugxDB0EkxAzYsDoRnFH/AoxkLTPIcKIMChQOZpcP63TU0YpmgeUmrnpkuBkaDQXYXh++W0b+y9AeppVEmUaFW5ikyoRXy3ir37w7cULixGqmfhMWm3hOkmnEr8kLfnqsl/lw1QrmeLS4vDdjz3z7hV5i3wTjKcUYglBDUKRJITClpYGcWR0bIQIiu1xyAvKTw8r8m/f1S4QOrs6iB+lIVwEOaZOGJS8eI9higPWdyUdu18eqj198OBvSwBaWu49XrH88JsDaxJobFx/Yuv3R4/+vBjP9XdVnwz7Wna0AJRQ+Wh6Ix6mLI0fVctdEg+eWUYyvVx7vKfn8i0MaHPn3rdaDy1pbV1aHoU60b29A7SeTsOxY4OvP39HQ8OdsrBienq6eWfz3IMd+/aF1pXIel5KFXp6ejY23LV9+6qZJlOfyI85HbJHTv3ixOrvRUw7DVdSX0Oo+3CM/h4cXAmujQ/5yHSn2glYyS33cmfFG/2726vI33dqRvk3rXi///14/oP54382Oc+L/8Js8V/af5fgr7aQYCHBQoKFBP+HBH8AgaQsdRWXzukAAAAASUVORK5CYII=';
const bytes = value => Uint8Array.from(atob(value),c=>c.charCodeAt(0));

function interceptDb(db, intercept, interceptBatch = (_, execute) => execute()) {
  return {prepare(sql) {
    const wrap = statement => ({raw:statement,sql,bind(...args){return wrap(statement.bind(...args));},
      run:()=>intercept(sql,()=>statement.run()),first:(...args)=>statement.first(...args),all:()=>statement.all(),
    });return wrap(db.prepare(sql));
  },batch:statements=>interceptBatch(statements,()=>db.batch(statements.map(statement=>statement.raw))),exec:sql=>db.exec(sql)};
}

export async function memberGenerationCase(nativeEnv,name,fixture={}) {
  if(!name.startsWith('clock-')) return runMemberGenerationCase(nativeEnv,name,fixture);
  const RealDate=globalThis.Date;
  let offset=0;
  globalThis.Date=class extends RealDate {
    constructor(...args){super(...(args.length?args:[RealDate.now()+offset]));}
    static now(){return RealDate.now()+offset;}
  };
  try {return await runMemberGenerationCase(nativeEnv,name,{...fixture,advance:ms=>{offset+=ms;}});}
  finally {globalThis.Date=RealDate;}
}

async function runMemberGenerationCase(nativeEnv,name,fixture={}) {
  const kind=name==='image'?'image':name.startsWith('music')?'music':'video';
  const videoBytes=fixture.videoBase64 ? bytes(fixture.videoBase64) : new Uint8Array([0,0,0,24,102,116,121,112]);
  const db=nativeEnv.DB, owner=`durable-${name}`, now=new Date().toISOString();
  const calls={provider:0,download:0,ack:0,retry:0,poster:0};
  const messages=[];
  let fail=true;
  let duringProvider=async()=>{};
  const env={...nativeEnv, ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG:'false',
    MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET:'synthetic-member-poster-secret-not-live',
    HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET:'synthetic-member-poster-secret-not-live',
    AI_VIDEO_JOBS_QUEUE:{async send(body){messages.push(body);}},
    AI_IMAGE_DERIVATIVES_QUEUE:{async send(){}},
    AI:{async run(){calls.provider++;await duringProvider();if(kind==='image'||kind==='music')return {image:fixture.imageBase64||png};if(name==='provider-unknown') throw new Error('synthetic provider connection lost');return {video_url:'https://fixture.invalid/member.mp4'};}},
    AI_SERVICE_AUTH_SECRET:'synthetic-service-secret-not-live',
    AI_LAB:{async fetch(){calls.provider++;if(name==='music-failed')return Response.json({ok:false,code:'provider_rejected',error:'Synthetic confirmed rejection'},{status:422,headers:{'x-bitbi-provider-outcome':'failed'}});return Response.json({ok:true,result:{audioBase64:'SUQzBAAAAAAA',mimeType:'audio/mpeg',mode:'song',durationMs:1000},model:{id:'minimax/music-2.6'},preset:'music_studio'});}},
    __TEST_FETCH:async()=>{calls.download++;return new Response(videoBytes,{headers:{'Content-Type':'video/mp4'}});},
  };
  if(name==='insert-response-lost') env.DB=interceptDb(db,async(sql,execute)=>{
    const result=await execute();
    if(fail && sql.includes('INSERT INTO ai_text_assets')) {fail=false;throw new Error('synthetic committed insert reply lost');}
    return result;
  });
  if(['debit-response-lost','unpublished-asset'].includes(name)) env.DB=interceptDb(db,(_,execute)=>execute(),async(statements,execute)=>{
    if(fail && calls.provider>0 && statements.some(statement=>statement.sql.includes('INSERT INTO member_credit_ledger') && statement.sql.includes('latest.balance_after'))) {
      fail=false;
      if(name==='debit-response-lost') await execute();
      throw new Error('synthetic debit boundary interruption');
    }
    return execute();
  });
  if(['finalization-response-lost','storage-restart','clock-finalization-expired'].includes(name)) env.DB=interceptDb(db,async(sql,execute)=>{
    if(fail && ['storage-restart','clock-finalization-expired'].includes(name) && sql.includes('INSERT INTO ai_text_assets')) {fail=false;throw new Error('synthetic database unavailable before asset insertion');}
    const result=await execute();
    if(fail && name==='finalization-response-lost' && sql.includes("SET status = 'succeeded'") && sql.includes("result_save_reference = ?")) {fail=false;throw new Error('synthetic finalized reply lost');}
    return result;
  });
  if(name==='music-cover-retry') env.USER_IMAGES={
    get:key=>nativeEnv.USER_IMAGES.get(key),head:key=>nativeEnv.USER_IMAGES.head(key),delete:key=>nativeEnv.USER_IMAGES.delete(key),
    async put(key,...args){if(fail && key.startsWith('tmp/ai-generated/music-covers/')){fail=false;throw new Error('synthetic temporary cover storage failure');}return nativeEnv.USER_IMAGES.put(key,...args);},
  };
  for(const id of [owner,`${owner}-other`]) {
    await db.prepare("INSERT INTO users(id,email,password_hash,created_at,role,email_verified_at) VALUES(?,?,?,?,'user',?)")
      .bind(id,`${id}@example.invalid`,'synthetic-unused',now,now).run();
    await db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
      .bind(id,id,await sha256Hex(`${id}:${env.SESSION_HASH_SECRET}`),now,new Date(Date.now()+3600000).toISOString(),now).run();
  }
  await topUpMemberDailyCredits({env,userId:owner});
  await grantMemberCredits({env,userId:owner,amount:2000,createdByUserId:owner,idempotencyKey:`grant-${name}-synthetic`});
  const fetch = (path,options={})=>worker.fetch(new Request('https://bitbi.ai'+path,options),env,{waitUntil(){throw new Error('No detached HTTP work allowed');}});
  const headers={'Content-Type':'application/json',Origin:'https://bitbi.ai',Cookie:`bitbi_session=${owner}`,'Idempotency-Key':`member-${name}-idempotency`,Prefer:'respond-async'};
  const abort=new AbortController();
  const body=JSON.stringify(kind==='video'?{prompt:'Synthetic backend-only fixture',duration:5,quality:'720p',generate_audio:true}:kind==='image'?{prompt:'Synthetic backend-only image'}:{prompt:'Synthetic instrumental track',instrumental:true});
  const accepted=await fetch(`/api/ai/generate-${kind}`,{method:'POST',headers,body,signal:abort.signal});
  const acceptance=await accepted.json();
  check(accepted.status===202,`Durable acceptance: ${accepted.status} ${acceptance.code||''}`);
  const id=acceptance.data.job.id;
  const duplicateAcceptance=await fetch(`/api/ai/generate-${kind}`,{method:'POST',headers,body});
  check(duplicateAcceptance.status===202 && (await duplicateAcceptance.json()).data.job.id===id,'Same accepted intent has one durable job');
  check(calls.provider===0,'HTTP acceptance must not dispatch provider');
  const browserLimiter=env.PUBLIC_RATE_LIMITER;
  let internalLimitCalls=0;
  env.PUBLIC_RATE_LIMITER={idFromName(){internalLimitCalls++;throw new Error('Synthetic HTTP limiter unavailable');}};
  const limitedBrowser=await fetch(`/api/ai/generate-${kind}`,{method:'POST',headers,body});
  check(limitedBrowser.status===503 && internalLimitCalls>0,'Browser requests retain the fail-closed HTTP limit');
  internalLimitCalls=0;
  abort.abort(); // No more browser status calls until generation + poster end.
  const row=()=>db.prepare('SELECT * FROM member_generation_jobs WHERE id=?').bind(id).first();
  const deliver=()=>worker.queue({queue:'bitbi-ai-video-jobs',messages:[{body:messages[0],attempts:1,
    ack(){calls.ack++;},retry(){calls.retry++;}}]},env,{waitUntil(){throw new Error('No detached queue work allowed');}});
  if(['clock-lease-expired','clock-credit-expired'].includes(name)) {
    const usage=await db.prepare('SELECT expires_at FROM member_ai_usage_attempts_v2 WHERE id=?').bind((await row()).usage_attempt_id).first();
    check(Math.abs(Date.parse(usage.expires_at)-Date.now()-30*60_000)<5000,'Credit reservation starts at 30 minutes');
    duringProvider=async()=>{
      const active=await row();
      check(Math.abs(Date.parse(active.locked_until)-Date.now()-15*60_000)<5000,'Job lease starts at 15 minutes');
      fixture.advance(16*60_000);
      await deliver(); // A second consumer must not submit the uncertain intent.
      check(calls.provider===1,'Expired lease does not authorize duplicate generation');
      if(name==='clock-credit-expired')fixture.advance(15*60_000);
    };
  }
  if(name==='execution-exhausted') {
    await db.prepare("UPDATE member_generation_jobs SET status='processing',attempt_count=8,locked_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();
    await deliver();await deliver();
    check((await row()).status==='failed' && (await row()).error_code==='generation_retry_exhausted','Killed executions cannot retry forever');
    check(calls.provider===0,'Exhaustion never creates another provider request');
    return {name,calls,status:(await row()).status};
  }
  if(name==='closed-browser') {
    messages.length=0; // Simulate a lost initial queue delivery, not a live browser.
    await worker.scheduled({cron:'*/5 * * * *'},env,{waitUntil(){throw new Error('Outbox repair must be awaited');}});
    check(messages.length===1,'Scheduled repair recovers durable acceptance without browser polling');
    await Promise.all([deliver(),deliver()]);
  } else await deliver();
  if(['clock-lease-expired','clock-credit-expired'].includes(name)) {
    fixture.advance(61_000);
    await worker.scheduled({cron:'*/5 * * * *'},env,{waitUntil(){throw new Error('Scheduled recovery must be awaited');}});
    await deliver();
    if(name==='clock-credit-expired') {
      const current=await row();
      const usage=await db.prepare('SELECT provider_outcome,billing_status,late_outcome FROM member_ai_usage_attempts_v2 WHERE id=?').bind(current.usage_attempt_id).first();
      const receipts=JSON.parse(current.provider_receipts_json);
      check(current.status==='outcome_unknown' && current.error_code==='generation_result_requires_credit_review',`Late result review: ${current.status} ${current.error_code}`);
      check(usage.billing_status==='released' && usage.late_outcome==='succeeded','Expired reservation stays released; late success is recorded');
      const retained=receipts['download-video'] && await env.USER_IMAGES.get(receipts['download-video'].key);
      const retainedBytes=retained && new Uint8Array(await new Response(retained.body).arrayBuffer());
      check(retainedBytes?.length===videoBytes.length && retainedBytes.every((value,index)=>value===videoBytes[index]),'Exact late video bytes survive URL expiry privately');
      const denied=await fetch(`/api/ai/text-assets/${id}/file`,{headers:{Cookie:`bitbi_session=${owner}`}});
      check(denied.status===404,'Unbilled late video is not directly readable');
      const list=await fetch('/api/ai/assets',{headers:{Cookie:`bitbi_session=${owner}`}});
      check(list.ok && !(await list.json()).data.assets.some(asset=>asset.id===id),'Unbilled late video is not exposed as complete');
      await worker.scheduled({cron:'*/5 * * * *'},env,{waitUntil(){}});await deliver();
      const debit=await db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(owner).first();
      check(calls.provider===1 && debit.n===0,'No new generation or charge after expiry');
      return {name,calls,status:current.status,debits:debit.n,lateOutcome:usage.late_outcome,archived:true};
    }
    check((await row()).status==='preview_pending',`Lease recovery: ${(await row()).status} ${(await row()).error_code}`);
  }
  check(internalLimitCalls===0,'Durably accepted execution does not consume the browser HTTP throttle again');
  if(name==='music-failed') {
    await deliver();
    const usage=await db.prepare('SELECT provider_outcome,billing_status FROM member_ai_usage_attempts_v2 WHERE id=?').bind((await row()).usage_attempt_id).first();
    const credits=await db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(owner).first();
    check((await row()).status==='failed' && usage.provider_outcome==='failed' && usage.billing_status==='released',`Confirmed rejection: ${(await row()).status} ${usage.provider_outcome} ${usage.billing_status}`);
    check(calls.provider===1 && credits.n===0,'Confirmed failure neither retries paid generation nor debits');
    return {name,calls,status:(await row()).status,debits:credits.n};
  }
  if(kind!=='video') {
    if(name==='music-cover-retry') {
      check(!fail && (await row()).status==='ingesting','Only music cover remains after temporary failure');
      await db.prepare("UPDATE member_generation_jobs SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();
      await deliver();
    }
    check((await row()).status==='succeeded',`${kind} completed: ${(await row()).error_code}`);
    const table=kind==='image'?'ai_images':'ai_text_assets';
    const asset=await db.prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=?`).bind(id,owner).first();
    check(Boolean(asset?.r2_key && await nativeEnv.USER_IMAGES.get(asset.r2_key)),'Generated media automatically persisted');
    if(kind==='music')check(Boolean(asset.poster_r2_key && await nativeEnv.USER_IMAGES.get(asset.poster_r2_key)),'Music cover persisted');
    await deliver();
    const credits=await db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(owner).first();
    check(credits.n===1 && calls.provider===(kind==='image'?1:2),'One media debit and no repeated cover generation');
    return {name,calls,status:(await row()).status,debits:credits.n};
  }
  if(['debit-response-lost','unpublished-asset','finalization-response-lost','storage-restart','clock-finalization-expired'].includes(name)) {
    check(!fail,'The requested interruption was actually injected');
    check((await row()).status==='queued',`Retryable checkpoint: ${(await row()).status} ${(await row()).error_code}`);
    if(name==='unpublished-asset') {
      const denied=await fetch(`/api/ai/text-assets/${id}/file`,{headers:{Cookie:`bitbi_session=${owner}`}});
      check(denied.status===404,'Uncharged staged video cannot be served');
      const listing=await fetch('/api/ai/assets',{headers:{Cookie:`bitbi_session=${owner}`}});
      check(listing.ok && !(await listing.json()).data.assets.some(asset=>asset.id===id),'Uncharged staged video is absent from My Assets');
      let blocked=false;
      try {await db.prepare("UPDATE ai_text_assets SET visibility='public' WHERE id=?").bind(id).run();} catch {blocked=true;}
      check(blocked,'Uncharged staged video cannot be published');
    }
    if(name==='clock-finalization-expired')fixture.advance(31*60_000);
    env.__TEST_FETCH=async()=>{throw new Error('Provider URL expired after the first saved download');};
    await db.prepare("UPDATE member_generation_jobs SET next_attempt_at='2000-01-01T00:00:00.000Z',locked_until=NULL WHERE id=?").bind(id).run();
    await deliver();
    check(calls.download===1,'Resume uses retained download, not an expiring provider URL');
  }
  if(name==='provider-unknown') {
    await db.prepare("UPDATE member_generation_jobs SET next_attempt_at='2000-01-01T00:00:00.000Z',locked_until=NULL WHERE id=?").bind(id).run();
    await worker.scheduled({cron:'*/5 * * * *'},env,{waitUntil(){}});
    await deliver();
    check(calls.provider===1,'Unknown provider receipt must never generate again');
    check((await row()).status==='outcome_unknown','Unknown outcome remains visible');
    check((await row()).next_attempt_at>new Date().toISOString(),'Missing receipts rotate behind other due recovery rows');
    return {name,calls,status:(await row()).status};
  }
  if(name==='insert-response-lost') check(!fail,'Lost insert reply was actually injected');
  check((await row()).status==='preview_pending',`Video awaits poster: ${(await row()).error_code}`);
  check((await row()).asset_id===id,'Job must own stable asset identity');
  const asset=await db.prepare('SELECT * FROM ai_text_assets WHERE id=?').bind(id).first();
  check(asset?.user_id===owner && Boolean(await nativeEnv.USER_IMAGES.get(asset.r2_key)),'Owned video persisted');
  await deliver();
  check(internalLimitCalls===0,'Recovery retries preserve HTTP admission without re-throttling');
  env.PUBLIC_RATE_LIMITER=browserLimiter;
  const duplicate=await fetch(`/api/ai/generate-${kind}`,{method:'POST',headers,body});
  check(duplicate.status===202 && (await duplicate.json()).data.job.id===id,'HTTP retry retains paid identity');
  check(calls.provider===1,'No duplicate generation');
  const processor=(path,options={})=>fetch(path,{...options,headers:{...options.headers,Authorization:`Bearer ${env.HOMEPAGE_HERO_EXTERNAL_FFMPEG_SECRET}`}});
  const postJob=(job,path,options={})=>processor(path,{...options,headers:{...options.headers,'X-BITBI-Generation-Claim':job.generation_claim}});
  async function claim() {
    const response=await processor('/api/internal/homepage/hero-videos/source-posters/jobs/claim?member_only=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:1,member_only:true})});
    const value=await response.json();check(response.ok,`Poster claim ${response.status}`);check(value.data.jobs.length===1,'Exactly one due poster');return value.data.jobs[0];
  }
  const deniedClaim=await fetch('/api/internal/homepage/hero-videos/source-posters/jobs/claim?member_only=true',
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({member_only:true})});
  check(deniedClaim.status===403,'Private processor claim requires its server credential');
  const publicDisabled=await processor('/api/internal/homepage/hero-videos/source-posters/jobs/claim',
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:1})});
  check(publicDisabled.status===503,'Private member support must not bypass the disabled public Hero processor');
  let poster=await claim();
  check(poster.source_asset_id===id,'Poster source must belong to accepted job');
  const firstPoster=poster;
  if(name==='poster-retry' || name==='stale-poster') {
    if(name==='poster-retry') await db.prepare('UPDATE member_generation_jobs SET attempt_count=16 WHERE id=?').bind(id).run();
    const response=await postJob(poster,poster.completion.failure_url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({error_code:'synthetic_ffmpeg_failure'})});
    check(response.ok,'Poster failure recorded');
    check(Boolean(await nativeEnv.USER_IMAGES.get(asset.r2_key)) && (await row()).status==='preview_pending','Poster failure retains video');
    if(name==='poster-retry') {
      const path=`/api/ai/generation-jobs/${id}/retry-preview`;
      check((await row()).error_code==='preview_retry_exhausted','Exhaustion is visible');
      const foreign=await fetch(path,{method:'POST',headers:{...headers,Cookie:`bitbi_session=${owner}-other`},body:'{}'});
      check(foreign.status===404,'Only the owner may retry the private preview');
      const csrf=await fetch(path,{method:'POST',headers:{...headers,Origin:'https://foreign.invalid'},body:'{}'});
      check(csrf.status===403,'Preview retry is same-origin protected');
      const retry=await fetch(path,{method:'POST',headers,body:'{}'});
      check(retry.status===202 && (await row()).status==='preview_pending','Explicit retry cannot requeue paid video generation');
      await db.prepare("UPDATE member_generation_jobs SET attempt_count=16,error_code=NULL,locked_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();
      await worker.scheduled({cron:'*/5 * * * *'},env,{waitUntil(){throw new Error('No detached repair');}});
      check((await row()).error_code==='preview_retry_exhausted','Lost final processor response exposes exhaustion after lease expiry');
      check((await fetch(path,{method:'POST',headers,body:'{}'})).status===202,'Expired processor can be re-armed without inference');
    }
    await db.prepare("UPDATE member_generation_jobs SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();
    poster=await claim();
    check(poster.generation_claim!==firstPoster.generation_claim,'Retry has a distinct claim');
    const stale=await postJob(firstPoster,firstPoster.source.url);check(stale.status===404,'Old claim cannot read/finish current job');
  }
  const source=await postJob(poster,poster.source.url);check(source.ok && (await source.arrayBuffer()).byteLength===videoBytes.length,'Actual private source endpoint');
  const form=new FormData();form.set('poster',new Blob([bytes(fixture.posterBase64 || png)],{type:fixture.posterBase64?'image/webp':'image/png'}),'poster.webp');
  const diagnostics=[]; const original={log:console.log,warn:console.warn,error:console.error};
  for(const level of Object.keys(original)) console[level]=(...args)=>{
    try { const value=JSON.parse(args[0]); if(value.component==='ai-text-assets') diagnostics.push({event:value.event,reason:value.failure_reason,code:value.error_code,message:value.error_message}); } catch {}
    original[level](...args);
  };
  let completed;
  try {completed=await postJob(poster,poster.completion.url,{method:'POST',body:form});}
  finally {Object.assign(console,original);}
  check(completed.ok,`Poster completion ${completed.status} ${await completed.text()} ${JSON.stringify(diagnostics)}`);calls.poster++;
  check((await row()).status==='succeeded','Complete only after persisted poster');
  const finished=await db.prepare('SELECT * FROM ai_text_assets WHERE id=?').bind(id).first();
  check(Boolean(await nativeEnv.USER_IMAGES.get(finished.poster_r2_key)),'Native poster bytes retained');
  const status=await fetch(`/api/ai/generation-jobs/${id}`,{headers:{Cookie:`bitbi_session=${owner}`}});
  check(status.ok && (await status.json()).data.job.status==='succeeded','Later session sees completion');
  const denied=await fetch(`/api/ai/generation-jobs/${id}`,{headers:{Cookie:`bitbi_session=${owner}-other`}});
  check(denied.status===404,'Foreign user cannot inspect job');
  const ownedList=await fetch('/api/ai/assets',{headers:{Cookie:`bitbi_session=${owner}`}});
  check(ownedList.ok && (await ownedList.json()).data.assets.some(asset=>asset.id===id),'Later owner session lists the completed video');
  const otherList=await fetch('/api/ai/assets',{headers:{Cookie:`bitbi_session=${owner}-other`}});
  check(otherList.ok && !(await otherList.json()).data.assets.some(asset=>asset.id===id),'Other account cannot list completed video');
  const credits=await db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(owner).first();
  check(credits.n===1 && calls.provider===1,'One successful generation debit, no poster debit');
  check((await db.prepare('SELECT COUNT(*) AS n FROM ai_text_assets WHERE user_id=?').bind(owner).first()).n===1,'Exactly one owner asset');
  const completion={name,calls,status:(await row()).status,debits:credits.n,ownerDenied:denied.status};
  if(name==='closed-browser') {
    const removed=await fetch(`/api/ai/text-assets/${id}`,{method:'DELETE',headers});
    check(removed.ok,'Owner can remove their generated asset normally');
    await deliver();
    const removedStatus=await (await fetch(`/api/ai/generation-jobs/${id}`,{headers:{Cookie:`bitbi_session=${owner}`}})).json();
    check(removedStatus.data.job.error_code==='generation_asset_removed' && removedStatus.data.job.asset_id===null && removedStatus.data.result===null,'Removed result cannot be resurrected or served from its job checkpoint');
    completion.afterExplicitRemoval=removedStatus.data.job.status;
  }
  return completion;
}

export default {async fetch(request,env) {
  if(request.method!=='POST'||request.headers.get('x-q2-control')!==env.Q2_CONTROL_TOKEN) return new Response(null,{status:403});
  const {name,...fixture}=await request.json();
  if(!['clock-lease-expired','clock-credit-expired','clock-finalization-expired','closed-browser','execution-exhausted','poster-retry','stale-poster','insert-response-lost','provider-unknown','music-failed','image','music','music-cover-retry','debit-response-lost','unpublished-asset','finalization-response-lost','storage-restart'].includes(name)) return new Response(null,{status:400});
  return Response.json(await memberGenerationCase(env,name,fixture));
}};
