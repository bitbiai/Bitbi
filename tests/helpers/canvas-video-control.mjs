import { encodeAdminMfaProofToken } from '../../workers/auth/src/lib/admin-mfa.js';
import worker from '../../workers/auth/src/index.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { topUpMemberDailyCredits, grantMemberCredits } from '../../workers/auth/src/lib/billing.js';
import { saveGeneratedVideoAsset } from '../../workers/auth/src/lib/ai-text-assets.js';

const check = (value, message) => { if (!value) throw new Error(message); };
export async function canvasVideoCase(base, name, fixture) {
  const owner = `canvas-video-${name}`, other = `${owner}-other`, now = new Date().toISOString();
  const db = base.DB, messages = [], requests = [], waits = [];
  const bytes = Uint8Array.from(atob(fixture.videoBase64), char => char.charCodeAt(0));
  const env = { ...base, BITBI_ENV: 'production', PIXVERSE_API_KEY: '',
    MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET:'synthetic-poster', ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG: 'false', ENABLE_MEMVID_STREAM_PREVIEW_AUTO_DISPATCH: 'false',
    AI_VIDEO_JOBS_QUEUE: { async send(body) { messages.push(body); } }, AI_IMAGE_DERIVATIVES_QUEUE: { async send() {} },
    AI: { async run(model, body) { requests.push({ model, body }); if (name === 'provider-interrupted') throw new Error('Synthetic lost provider response'); return { video: 'https://fixture.invalid/result.mp4' }; } },
    __TEST_FETCH: async (url, init) => {
      if (url === 'https://fixture.invalid/result.mp4') return new Response(bytes, { headers: { 'Content-Type': 'video/mp4' } });
      throw new Error('Canvas must not contact the direct provider');
    },
  };
  if (name === 'receipt-write') env.USER_IMAGES = new Proxy(base.USER_IMAGES, { get(target, prop) {
    if (prop === 'put') return (key, ...args) => {
      if (key.endsWith('/provider-ai-0.json')) throw new Error('Synthetic receipt storage failure');
      return target.put(key, ...args);
    };
    const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  for (const id of [owner, other]) {
    await db.prepare("INSERT INTO users(id,email,password_hash,created_at,role,email_verified_at) VALUES(?,?,?,?,'user',?)").bind(id, `${id}@example.invalid`, 'synthetic', now, now).run();
    await db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
      .bind(id,id,await sha256Hex(`${id}:${env.SESSION_HASH_SECRET}`),now,new Date(Date.now()+3600000).toISOString(),now).run();
  }
  await topUpMemberDailyCredits({ env, userId: owner });
  await grantMemberCredits({ env, userId: owner, amount: 2000, createdByUserId: owner, idempotencyKey: `grant-${name}` });
  const original = await saveGeneratedVideoAsset(env, { userId: name === 'foreign' ? other : owner, title: 'Source original', videoBytes: bytes, mimeType: 'video/mp4', payload: { duration: 1 } });
  const pid = (await sha256Hex(name)).slice(0,32), src = (await sha256Hex(name+'source')).slice(0,32), dest = (await sha256Hex(name+'dest')).slice(0,32), eid = (await sha256Hex(name+'edge')).slice(0,32);
  await db.prepare('INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,?,\'en\',?,?)').bind(pid,owner,'Video continuation',now,now).run();
  for (const [id, asset, output] of [[src,original.id,{ kind:'video',assetId:original.id,runId:'source-run' }],[dest,null,null]]) {
    await db.prepare("INSERT INTO canvas_nodes(id,project_id,user_id,type,title,model_id,x,y,config_json,content_json,asset_id,output_json,created_at,updated_at) VALUES(?,?,?,'video_generation',?,'pixverse/v6',0,0,?,'{}',?,?,?,?)")
      .bind(id,pid,owner,id===src?'Source':'Continue',JSON.stringify({prompt:'Continue this fixture',duration:2,quality:'720p',generateAudio:false}),asset,output?JSON.stringify(output):null,now,now).run();
  }
  await db.prepare('INSERT INTO canvas_edges(id,project_id,user_id,source_node_id,target_node_id,config_json,created_at,updated_at) VALUES(?,?,?,?,?,\'{}\',?,?)').bind(eid,pid,owner,src,dest,now,now).run();
  const request = async (path, method='GET', body, user=owner, key=`canvas-video-${name}`) => {
    const response = await worker.fetch(new Request('https://bitbi.ai'+path, { method, headers: { Cookie:`__Host-bitbi_session=${user}${user===owner && env.testProof ? '; __Host-bitbi_admin_mfa='+env.testProof : ''}`,Origin:'https://bitbi.ai','Content-Type':'application/json','Idempotency-Key':key },body:body?JSON.stringify(body):undefined }),env,{ waitUntil(p){ waits.push(p); } });
    return { status:response.status, body:await response.json() };
  };
  const projectPath = `/api/account/canvas/projects/${pid}`, runPath = `${projectPath}/nodes/${dest}/run`, edgePath = `${projectPath}/edges/${eid}`;
  check((await request(projectPath,'GET',null,other)).status===404,'Foreign project denied');
  let result,method;
  if(name==='first') await db.prepare('DELETE FROM canvas_edges WHERE id=?').bind(eid).run();
  else {
  result=await request(runPath,'POST',{});
  check(result.status===409 || (name==='foreign' && result.status===404),'Unselected video must not generate');
  check(requests.length===0,'No provider on missing method');
  if (name === 'blocked' || name === 'blocked-admin') {
    if (name === 'blocked-admin') {
      await db.prepare("UPDATE users SET role='admin' WHERE id=?").bind(owner).run();
      await seedProof(env, owner, now);
    }
    env.PIXVERSE_API_KEY = 'synthetic-pixverse-test-only';
    const before = await db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=?').bind(owner).first();
    const extend = {videoInput:{modelId:'pixverse/v6',assetId:original.id,runId:'source-run',method:'extend'}};
    check((await request(edgePath,'PATCH',{config:extend,surface:'admin'})).status>=400,'Manipulated Extend denied');
    await db.prepare('UPDATE canvas_edges SET config_json=? WHERE id=?').bind(JSON.stringify(extend),eid).run();
    check((await request(runPath,'POST',{surface:'admin',operation:'extend'})).status===400,'Client cannot select execution surface');
    const denied = await request(runPath,'POST',{});
    check(denied.status===409 && denied.body.code==='video_method_invalid',`Stored Extend denied: ${JSON.stringify(denied)}`);
    const memberEndpoint = await request('/api/ai/generate-video','POST',{model:'pixverse/v6',prompt:'Synthetic',operation:'extend',source_asset_id:original.id,surface:'admin'});
    check(memberEndpoint.status>=400,'Member endpoint cannot claim Admin surface');
    check((await db.prepare('SELECT COUNT(*) AS n FROM member_generation_jobs WHERE user_id=?').bind(owner).first()).n===0,'No durable job created');
    check((await db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=?').bind(owner).first()).n===before.n,'No ledger mutation');
    check(!requests.length && !messages.length,'No provider, upload or queue');
    return {name,status:'denied'};
  }
  method='last_frame';
  const config={videoInput:{modelId:'pixverse/v6',assetId:original.id,runId:'source-run',method}};
  if (method==='last_frame') {
    const invalid=await request(edgePath,'PATCH',{config,frame_image:'data:image/png;base64,bm90IGEgcG5n'});
    check(invalid.status>=400 && requests.length===0, 'Invalid frame upload stops before inference');
  }
  result=await request(edgePath,'PATCH',{config,...(method==='last_frame'?{frame_image:`data:image/png;base64,${fixture.imageBase64}`}:{})});
  if(name==='foreign') {check(result.status===404,'Foreign video denied before preparation');return {name,requests,status:'denied'};}
  check(result.status===200,`Prepare edge: ${JSON.stringify(result)}`);
  const prepared=result.body.data.edge.config.videoInput;
  if(method==='last_frame') {
    check(prepared.frame?.imageId,'Frame saved as real private image');
    check(!(await db.prepare('SELECT config_json FROM canvas_edges WHERE id=?').bind(eid).first()).config_json.includes('base64'),'No graph Base64');
    const changed={...config,videoInput:{...config.videoInput,frame:{imageId:'foreign-forged'}}};
    const kept=await request(edgePath,'PATCH',{config:changed});
    check(kept.body.data.edge.config.videoInput.frame.imageId===prepared.frame.imageId,'Client cannot forge a frame association');
  }
  if(name==='changed') {
    await db.prepare('UPDATE canvas_nodes SET output_json=? WHERE id=?').bind(JSON.stringify({kind:'video',assetId:original.id,runId:'replacement-run'}),src).run();
    check((await request(runPath,'POST',{})).status===409,'Source run change requires new selection');
    check(requests.length===0,'No stale-source generation');
    await db.prepare('UPDATE canvas_nodes SET asset_id=NULL,output_json=NULL WHERE id=?').bind(src).run();
    check((await request(runPath,'POST',{})).status===409 && requests.length===0, 'Missing output blocks before inference');return {name,requests,status:'denied'};
  }
  }
  result=await request(runPath,'POST',{});
  check(result.status===202 && result.body.code==='canvas_video_pending',`Durable accepted: ${JSON.stringify(result)}`);
  const job=await db.prepare('SELECT * FROM member_generation_jobs WHERE user_id=?').bind(owner).first();
  check(job && messages.length===1,'Existing durable queue accepted once');
  check(job.request_key.startsWith('canvas-video-'), 'Server-derived request identity');
  check(result.body.data.run.video_job_id === job.id && result.body.data.run.status === 'running' && result.body.data.run.retry_key, 'Acceptance returns durable UI run identity immediately');
  const pending = (await request(projectPath)).body.data.runs[0];
  check(pending.video_job_status === 'queued' && pending.video_job_id === job.id, 'Reload restores actual job phase');
  if (name === 'success') {
    // Simulate process death after durable acceptance, before the Canvas write.
    await db.prepare("UPDATE canvas_runs SET status='running',output_json=NULL,error_code=NULL WHERE user_id=?").bind(owner).run();
    const restored = (await request(projectPath)).body.data.runs[0];
    check(restored.video_job_id === job.id && restored.retry_key, 'Reload recovers durable acceptance gap');
  }
  const deliver=()=>worker.queue({messages:[{body:{type:'member_generation.process',job_id:job.id},ack(){},retry(){}}]},env,{waitUntil(p){waits.push(p);}});
  await deliver();
  if (['provider-interrupted', 'receipt-write'].includes(name)) {
    const failed = await db.prepare('SELECT * FROM member_generation_jobs WHERE id=?').bind(job.id).first();
    const expected = name === 'receipt-write' ? 'generation_receipt_write_failed' : 'generation_provider_call_outcome_unknown';
    check(failed.status === 'outcome_unknown' && failed.error_code === expected, `Specific failure ${failed.status}/${failed.error_code}`);
    check(JSON.parse(failed.provider_receipts_json)['ai-0'], 'Intent retained for reconciliation');
    await deliver();
    const attached = await request(runPath, 'POST', {});
    check(attached.status === 409 && attached.body.data.run.error_code === 'canvas_video_review_required', 'Unknown attachment stays review-required');
    const restored = (await request(projectPath)).body.data.runs[0];
    check(restored.video_job_id === job.id && restored.video_job_status === 'outcome_unknown' && restored.retry_key === pending.retry_key, 'Reload retains unknown job identity');
    check((await request(runPath, 'POST', {})).status === 409, 'Original request remains blocked');
    check(requests.filter(r => r.model).length === 1, 'No second provider call');
    check((await db.prepare('SELECT COUNT(*) AS n FROM member_generation_jobs WHERE user_id=?').bind(owner).first()).n === 1, 'One job');
    const usage = await db.prepare('SELECT provider_outcome,billing_status FROM member_ai_usage_attempts_v2 WHERE id=?').bind(job.usage_attempt_id).first();
    check(usage.provider_outcome === 'unknown' && usage.billing_status === 'reserved', 'Unknown reservation is not consumed or refunded');
    check((await db.prepare("SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND entry_type='consume'").bind(owner).first()).n === 0, 'No false debit');
    await Promise.allSettled(waits);
    return { name, status: failed.status, code: failed.error_code, providerCalls: requests.length };
  }
  if(method==='last_frame') {
    check(requests.filter(r=>r.model).length===1,'One image-to-video call');
    check(requests.find(r=>r.model).body.image_input===`data:image/png;base64,${fixture.imageBase64}`,'Actual saved frame passed as start image');
  }
  const finalJob=await db.prepare('SELECT * FROM member_generation_jobs WHERE id=?').bind(job.id).first();
  const debits=await db.prepare("SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND entry_type='consume'").bind(owner).first();
  {
    check(['succeeded','preview_pending'].includes(finalJob.status),`Background completion ${finalJob.status}/${finalJob.error_code}`);
    check(debits.n===1,'Exactly one credit debit');
    check((await db.prepare("SELECT amount FROM member_credit_ledger WHERE user_id=? AND entry_type='consume'").bind(owner).first()).amount===-56,'Existing 2s/720p/no-audio price unchanged');
    const detached=await db.prepare('SELECT status,asset_id FROM canvas_runs WHERE user_id=?').bind(owner).first();
    check(detached.status==='completed' && detached.asset_id===job.id,'Queue completes Canvas without a browser attach');
    result=await request(runPath,'POST',{});check(result.status===200,`Attach completed job: ${JSON.stringify(result)}`);
    const asset=result.body.data.run.asset_id;check(asset===job.id && asset!==original.id,'Owned new asset, original preserved');
    check((await request(runPath,'POST',{})).body.data.idempotent_replay===true,'Canvas replay');
    check((await db.prepare('SELECT usage_attempt_id FROM canvas_runs WHERE user_id=?').bind(owner).first()).usage_attempt_id === job.usage_attempt_id, 'Canvas retains credit-attempt identity');
    const project=await request(projectPath);check(project.body.data.nodes.find(n=>n.id===dest).output.assetId===asset,'Reload restores output');
    await deliver();check((await db.prepare("SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND entry_type='consume'").bind(owner).first()).n===1,'Duplicate queue does not recharge');
    check((await request(`/api/ai/generation-jobs/${job.id}`,'GET',null,other)).status===404,'Foreign job denied');
  }
  if(name==='first'||name==='success') {
    const posterBase='/api/internal/homepage/hero-videos/source-posters/jobs';
    const processor=(url,body,token)=>worker.fetch(new Request('https://bitbi.ai'+url,{method:'POST',headers:{Authorization:'Bearer synthetic-poster',...(token?{'X-BITBI-Generation-Claim':token}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body)}),env,{waitUntil(){}});
    const claim=await processor(posterBase+'/claim?member_only=true',{member_only:true,limit:8});
    const item=(await claim.json()).data.jobs.find(j=>j.id===job.id);check(item,'First/continuation private poster claim');
    const form=new FormData();form.set('poster',new Blob([Uint8Array.from(atob(fixture.imageBase64),c=>c.charCodeAt(0))],{type:'image/png'}),'poster.png');
    check((await processor(item.completion.url,form,item.generation_claim)).ok,'Poster completes on existing endpoint');
    const project=(await request(projectPath)).body.data;
    check(project.nodes.find(n=>n.id===dest).output.previewUrl===`/api/ai/text-assets/${job.id}/poster`,'Reload refreshes frozen Canvas poster');
    check(requests.filter(r=>r.model).length===1,'Poster never generates again');
    check((await db.prepare("SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND entry_type='consume'").bind(owner).first()).n===1,'Poster never debits again');
  }
  await Promise.allSettled(waits);
  return {name,requests:requests.map(({body,...item})=>({...item,operation:body?.model||null})),status:finalJob.status,debits:debits.n};
}

async function seedProof(env, user, now) {
  await env.DB.prepare('INSERT INTO admin_mfa_credentials(admin_user_id,secret_ciphertext,secret_iv,enabled_at,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .bind(user,'synthetic-credential','synthetic-iv',now,now,now).run();
  env.testProof = await encodeAdminMfaProofToken(env,{userId:user,sessionId:user});
}

export async function adminPixverseCase(base, name, fixture) {
  const user = `pixverse-admin-${name}`, other = `${user}-member`, now = new Date().toISOString();
  const db=base.DB, messages=[], calls=[], waits=[];
  const bytes=Uint8Array.from(atob(fixture.videoBase64), c=>c.charCodeAt(0));
  const env={...base,BITBI_ENV:'production',PIXVERSE_API_KEY:'synthetic-pixverse-test-only',ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET:'true',
    ENABLE_HOMEPAGE_HERO_EXTERNAL_FFMPEG:'false',ENABLE_MEMVID_STREAM_PREVIEW_AUTO_DISPATCH:'false',
    AI_VIDEO_JOBS_QUEUE:{async send(body){messages.push(body);}},AI_IMAGE_DERIVATIVES_QUEUE:{async send(){}},
    AI_LAB:{async fetch(request){
      if(new URL(request.url).pathname==='/internal/ai/models') return Response.json({ok:true,models:{video:[]}});
      throw new Error('Direct route must not call Cloudflare inference');
    }},
    __TEST_FETCH:async(url,init)=>{
      if(url==='https://media.pixverse.ai/synthetic.mp4') return new Response(bytes,{headers:{'Content-Type':'video/mp4'}});
      const path=new URL(url).pathname;calls.push(path);
      if(path.endsWith('/media/upload')) {
        const file=init.body.get('file'), actual=new Uint8Array(await file.arrayBuffer());
        check(file.type==='video/mp4' && actual.length===bytes.length && actual.every((b,i)=>b===bytes[i]),'Exact owned original upload');
        return Response.json({ErrCode:0,Resp:{media_type:'video',media_id:12345}});
      }
      if(path.endsWith('/extend/generate')) {
        const body=JSON.parse(init.body);
        check(body.video_media_id===12345 && body.model==='v6' && body.duration===2 && body.quality==='720p' && body.generate_audio_switch===false,'Actual V6 direct schema');
        check(!body.image_input && !body.aspect_ratio && !body.source_video_id,'No false CF or asset identity');
        if(name==='unknown') throw new Error('Synthetic lost acceptance response');
        return Response.json({ErrCode:0,Resp:{video_id:67890}});
      }
      check(path.endsWith('/video/result/67890'),'Poll recorded provider identity');
      return Response.json({ErrCode:0,Resp:{id:67890,status:name==='failure'?8:1,url:'https://media.pixverse.ai/synthetic.mp4'}});
    }};
  for(const [id,role] of [[user,'admin'],[other,'user']]) {
    await db.prepare('INSERT INTO users(id,email,password_hash,created_at,role,email_verified_at) VALUES(?,?,?,?,?,?)').bind(id,id+'@example.invalid','synthetic',now,role,now).run();
    await db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
      .bind(id,id,await sha256Hex(`${id}:${env.SESSION_HASH_SECRET}`),now,new Date(Date.now()+3600000).toISOString(),now).run();
  }
  await seedProof(env,user,now);
  await db.prepare('INSERT OR REPLACE INTO admin_runtime_budget_switches(switch_key,enabled,created_at,updated_at) VALUES(?,1,?,?)').bind('ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET',now,now).run();
  for(const window of ['daily','monthly']) await db.prepare("INSERT OR IGNORE INTO platform_budget_limits(id,budget_scope,window_type,limit_units,created_at,updated_at) VALUES(?,'platform_admin_lab_budget',?,1000000,?,?)").bind(window,window,now,now).run();
  const asset=await saveGeneratedVideoAsset(env,{userId:user,title:'Synthetic original',videoBytes:bytes,mimeType:'video/mp4',payload:{duration:1}});
  const body={model:'pixverse/v6',prompt:'Continue synthetic video',duration:2,quality:'720p',generate_audio:false,operation:'extend',source_asset_id:asset.id};
  const path='/api/admin/ai/video-jobs'; let requestNumber=0;
  const request=async(payload=body,{actor=user,proof=true,origin='https://bitbi.ai',route=path,method='POST'}={})=>{
    const res=await worker.fetch(new Request('https://bitbi.ai'+route,{method,headers:{Cookie:`__Host-bitbi_session=${actor}${proof?'; __Host-bitbi_admin_mfa='+env.testProof:''}`,Origin:origin,'Content-Type':'application/json','Idempotency-Key':`direct-${name}`,'CF-Connecting-IP':`192.0.2.${++requestNumber}`},body:method==='POST'?JSON.stringify(payload):undefined}),env,{waitUntil(p){waits.push(p);}});
    return {status:res.status,body:await res.json()};
  };
  check((await request(body,{actor:other})).status===403,'Member denied');
  check((await request(body,{proof:false})).status===403,'MFA required');
  check((await request(body,{origin:'https://foreign.invalid'})).status===403,'CSRF required');
  env.PIXVERSE_API_KEY='';
  const absent = await request(null,{route:'/api/admin/ai/models',method:'GET'});
  check(absent.status===200 && absent.body.pixverseDirect.configured===false,'Protected catalog reports missing access');
  check((await request()).status===503,'Missing direct key denied');env.PIXVERSE_API_KEY='synthetic-pixverse-test-only';
  env.ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET='false';check((await request()).status===503,'Admin budget denied');env.ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET='true';
  check((await request({...body,source_asset_id:'missing'})).status===404,'Missing/foreign source denied');
  check(!messages.length && !calls.length,'Denied attempts never queue or upload');
  const catalog = await request(null,{route:'/api/admin/ai/models',method:'GET'});
  check(catalog.status===200 && catalog.body.pixverseDirect.configured===true && !JSON.stringify(catalog).includes(env.PIXVERSE_API_KEY),'Only configuration presence exposed');
  const foreign=await saveGeneratedVideoAsset(env,{userId:other,title:'Other original',videoBytes:bytes,mimeType:'video/mp4',payload:{duration:1}});
  check((await request({...body,source_asset_id:foreign.id})).status===404,'Foreign owned video denied');
  const accepted=await request();check(accepted.status===202,`Admin accepted: ${JSON.stringify(accepted)}`);
  check((await request()).body.existing===true && messages.length===1,'Same Admin job reused');
  const job=await db.prepare('SELECT * FROM ai_video_jobs_v2 WHERE user_id=?').bind(user).first();
  check(job.provider==='pixverse-direct' && JSON.parse(job.budget_policy_json).provider_family==='pixverse_direct','Direct provider and platform budget identity');
  const deliver=()=>worker.queue({queue:'bitbi-ai-video-jobs',messages:[{body:messages[0],ack(){},retry(){}}]},env,{waitUntil(p){waits.push(p);}});
  await deliver();
  if(name==='unknown') await db.prepare('UPDATE ai_video_jobs_v2 SET locked_until=? WHERE id=?').bind('2000-01-01T00:00:00.000Z',job.id).run();
  await db.prepare('UPDATE ai_video_jobs_v2 SET next_attempt_at=? WHERE id=?').bind('2000-01-01T00:00:00.000Z',job.id).run();
  await deliver();
  const final=await db.prepare('SELECT * FROM ai_video_jobs_v2 WHERE id=?').bind(job.id).first();
  check(final.status===(name==='success'?'succeeded':name==='failure'?'failed':'processing'),`Admin final: ${final.status}/${final.error_code}`);
  if(name==='unknown') check(final.provider_outcome==='unknown','Lost response held for review');
  await deliver();
  check(calls.filter(p=>p.endsWith('/extend/generate')).length===1,'One paid submission including lost-response retry');
  check((await db.prepare('SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=?').bind(user).first()).n===0,'No member-credit debit');
  if(name==='success') {
    check(final.output_r2_key && await env.USER_IMAGES.head(final.output_r2_key),'Original result ingested privately');
    check((await request(null,{route:`${path}/${job.id}`,method:'GET',actor:other})).status===403,'Member cannot inspect Admin job');
    check((await db.prepare('SELECT COUNT(*) AS n FROM platform_budget_usage_events WHERE source_job_id=?').bind(job.id).first()).n===1,'One platform budget event');
  }
  await Promise.allSettled(waits);
  return {name,status:final.status,calls,provider:final.provider};
}
