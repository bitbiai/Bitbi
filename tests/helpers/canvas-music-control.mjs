import worker from '../../workers/auth/src/index.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { grantMemberCredits } from '../../workers/auth/src/lib/billing.js';
import { calculateMemberMusic26CreditCost } from '../../workers/auth/src/routes/ai/music-generate.js';

const check = (value, message) => { if (!value) throw new Error(message); };
export const canvasMusicCases = ['instrumental', 'automatic', 'manual', 'generated', 'instrumental-manual', 'instrumental-generated', 'manual-generated', 'provider-failed'];

// Real Canvas construction -> strict member handler -> owned storage/accounting.
// Only provider/cover boundaries are synthetic, in Node SQLite and native D1/R2.
export async function canvasMusicCase(base, name, role, imageBase64) {
  check(canvasMusicCases.includes(name) && ['user','admin'].includes(role), 'Known synthetic case');
  const db = base.DB, owner = `canvas-music-${role}-${name}`, other = owner+'-other', now = new Date().toISOString();
  const calls = [], waits = [];
  const env = { ...base, BITBI_ENV:'production', AI_SERVICE_AUTH_SECRET:'synthetic-canvas-music-only',
    AI_IMAGE_DERIVATIVES_QUEUE:{async send(){}},
    AI:{async run(){return {image:imageBase64};}},
    AI_LAB:{async fetch(request){
      const path = new URL(request.url).pathname, body = await request.json(); calls.push({path,body});
      if(path === '/internal/ai/test-text') return Response.json({ok:true,result:{text:'[Verse]\nSynthetic original lyrics'},model:{id:'synthetic-lyrics'}});
      check(path === '/internal/ai/test-music', 'Only the expected internal music caller');
      if(name === 'provider-failed') return Response.json({ok:false,code:'provider_rejected',error:'Synthetic confirmed rejection'}, {status:422,headers:{'x-bitbi-provider-outcome':'failed'}});
      return Response.json({ok:true,result:{audioBase64:'SUQzBAAAAAAA',mimeType:'audio/mpeg',mode:body.mode,durationMs:1000},model:{id:'minimax/music-2.6'},preset:'music_studio'});
    }},
  };
  for(const id of [owner,other]) {
    await db.prepare('INSERT INTO users(id,email,password_hash,created_at,role,email_verified_at) VALUES(?,?,?,?,?,?)').bind(id,id+'@example.invalid','synthetic',now,id===owner?role:'user',now).run();
    await db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
      .bind(id,id,await sha256Hex(`${id}:${env.SESSION_HASH_SECRET}`),now,new Date(Date.now()+3600000).toISOString(),now).run();
  }
  await grantMemberCredits({env,userId:owner,amount:2000,createdByUserId:owner,idempotencyKey:`grant-${owner}`});
  const config = {prompt:'Synthetic Canvas music',instrumental:name.startsWith('instrumental') || name==='provider-failed',generateLyrics:name.endsWith('generated')};
  if(name.includes('manual')) config.lyrics = '[Verse]\nManual original lyrics';
  const pid=(await sha256Hex(owner+'project')).slice(0,32), nid=(await sha256Hex(owner+'node')).slice(0,32);
  const previous={kind:'audio',assetId:`previous-${owner}`,modelId:'minimax/music-2.6'};
  const previousKey=`users/${owner}/previous.mp3`, previousBytes='synthetic previous owned audio';
  await env.USER_IMAGES.put(previousKey,previousBytes,{httpMetadata:{contentType:'audio/mpeg'}});
  await db.prepare("INSERT INTO ai_text_assets(id,user_id,r2_key,title,file_name,source_module,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,'music','audio/mpeg',?,?)")
    .bind(previous.assetId,owner,previousKey,'Previous','previous.mp3',previousBytes.length,now).run();
  await db.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,?,'en',?,?)").bind(pid,owner,'Music contract',now,now).run();
  await db.prepare("INSERT INTO canvas_nodes(id,project_id,user_id,type,title,model_id,x,y,config_json,content_json,asset_id,output_json,created_at,updated_at) VALUES(?,?,?,'music_generation','Music','minimax/music-2.6',0,0,?,'{}',?,?,?,?)")
    .bind(nid,pid,owner,JSON.stringify(config),previous.assetId,JSON.stringify(previous),now,now).run();
  const path=`/api/account/canvas/projects/${pid}/nodes/${nid}/run`, key=`canvas-music-${role}-${name}`;
  const tariffRevision=(await db.prepare('SELECT revision FROM model_pricing_state WHERE id=1').first()).revision;
  const request=async(url,body={},actor=owner,idempotency=key,method='POST')=>{
    const response=await worker.fetch(new Request('https://bitbi.ai'+url,{method,headers:{Cookie:`__Host-bitbi_session=${actor}`,Origin:'https://bitbi.ai','Content-Type':'application/json','Idempotency-Key':idempotency,'X-Bitbi-Tariff-Revision':String(tariffRevision)},body:method==='GET'?undefined:JSON.stringify(body)}),env,{waitUntil(p){waits.push(p);}});
    return {status:response.status,body:await response.json()};
  };
  const scalar=async(sql,...args)=>Number((await db.prepare(sql).bind(...args).first()).n);
  const attempts=()=>scalar('SELECT COUNT(*) AS n FROM member_ai_usage_attempts_v2 WHERE user_id=?',owner);
  const debits=()=>scalar("SELECT COUNT(*) AS n FROM member_credit_ledger WHERE user_id=? AND entry_type='consume'",owner);
  const orgLedgerBefore=await scalar('SELECT COUNT(*) AS n FROM credit_ledger');
  // The endpoint stays strict, including the exact old adapter payload.
  for(const extra of [{model:'minimax/music-2.6'},{unknown_option:true}]) {
    const rejected=await request('/api/ai/generate-music',{prompt:config.prompt,instrumental:true,generateLyrics:false,...extra});
    check(rejected.status===400 && rejected.body.code==='unsupported_option','Unknown member fields rejected');
    check(!calls.length && await attempts()===0 && await debits()===0,'Preflight rejection has no provider/usage/debit');
  }
  check((await request(path,{},other)).status===404,'Foreign Canvas denied');
  const result=await request(path);
  const invalid=['instrumental-generated','manual-generated'].includes(name), failed=invalid || name==='provider-failed';
  check(result.status===(invalid?400:name==='provider-failed'?422:200),`Canvas music ${name}: ${result.status} ${result.body.code}`);
  const run=await db.prepare('SELECT * FROM canvas_runs WHERE user_id=? AND idempotency_key=?').bind(owner,key).first();
  check(run?.model_id==='minimax/music-2.6' && JSON.parse(run.input_json).generation.model==='minimax/music-2.6','Stored selected-model and request identity retained');
  const node=await db.prepare('SELECT * FROM canvas_nodes WHERE id=?').bind(nid).first();
  if(failed) {
    check(run.status==='failed','Specific failed run retained');
    check(node.output_json===JSON.stringify(previous) && node.asset_id===previous.assetId,'Failure preserves previous output');
    check(await debits()===0,'Failed generation does not debit');
    if(invalid)check(result.body.code==='invalid_lyrics_generation' && !calls.length && await attempts()===0,'Invalid combinations rejected before usage/provider');
  } else {
    check(run.status==='completed' && run.asset_id && node.asset_id===run.asset_id,'Normal Canvas completion stores owned output');
    const asset=await db.prepare('SELECT * FROM ai_text_assets WHERE id=? AND user_id=?').bind(run.asset_id,owner).first();
    check(asset?.source_module==='music' && await env.USER_IMAGES.head(asset.r2_key),'Owned durable music bytes');
    check(await debits()===1,'Exactly one personal debit for member and Admin');
    const ledger=await db.prepare("SELECT amount FROM member_credit_ledger WHERE user_id=? AND entry_type='consume'").bind(owner).first();
    check(ledger.amount===-calculateMemberMusic26CreditCost({separateLyricsGeneration:config.generateLyrics}),'Server music tariff, not UI estimate');
    const usage=await db.prepare('SELECT * FROM member_ai_usage_attempts_v2 WHERE user_id=?').bind(owner).first();
    check(usage.billing_status==='finalized' && run.usage_attempt_id===usage.id,'Canvas correlates the personal finalized attempt');
    const music=calls.filter(call=>call.path.endsWith('test-music'));check(music.length===1,'One controlled audio provider call');
    check(music[0].body.mode===(config.instrumental?'instrumental':'vocals'),'Instrumental option preserved');
    check(music[0].body.lyrics===(config.instrumental?null:config.generateLyrics?'[Verse]\nSynthetic original lyrics':config.lyrics||null),'Manual/generated/automatic lyrics contract');
    check(calls.filter(call=>call.path.endsWith('test-text')).length===(config.generateLyrics?1:0),'Only requested separate lyrics call');
    const output=await db.prepare('SELECT * FROM canvas_media_outputs WHERE run_id=?').bind(run.id).first();
    check(output?.user_id===owner && output.asset_id===asset.id,'Canvas output ownership');
  }
  const beforeCalls=calls.length, beforeAttempts=await attempts(), beforeDebits=await debits();
  const replay=await request(path);
  check(replay.status===(failed?409:200) && replay.body.data?.idempotent_replay===true,'Replay uses retained run, including failed runs');
  check(calls.length===beforeCalls && await attempts()===beforeAttempts && await debits()===beforeDebits,'Replay never regenerates or charges');
  // A pre-fix unsupported_option run has the same stored identity. Do not
  // silently revive it or reinterpret it as an idempotency conflict after repair.
  const historicalKey=key+'-historical', historicalId=(await sha256Hex(historicalKey)).slice(0,32);
  await db.prepare("INSERT INTO canvas_runs(id,project_id,node_id,user_id,model_id,operation_type,idempotency_key,status,input_json,error_code,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'failed',?,'unsupported_option','Unsupported music generation option.',?,?)")
    .bind(historicalId,pid,nid,owner,run.model_id,run.operation_type,historicalKey,run.input_json,now,now).run();
  const historical=await request(path,{},owner,historicalKey);
  check(historical.status===409 && historical.body.code==='unsupported_option' && historical.body.data?.idempotent_replay===true,'Historical failure identity retained without replay');
  check(calls.length===beforeCalls && await attempts()===beforeAttempts && await debits()===beforeDebits,'Historical failure never regenerates or charges');
  check(await scalar('SELECT COUNT(*) AS n FROM credit_ledger')===orgLedgerBefore,'No organization ledger changes for Admin or member music');
  const retained=await env.USER_IMAGES.get(previousKey);
  check(retained && await new Response(retained.body).text()===previousBytes,'Previous owned bytes preserved on success and failure');
  check(await db.prepare('SELECT id FROM ai_text_assets WHERE id=? AND user_id=?').bind(previous.assetId,owner).first(),'Previous owned asset preserved');
  await db.prepare('UPDATE canvas_nodes SET model_id=? WHERE id=?').bind('unsupported/music',nid).run();
  check((await request(path,{},owner,key+'-unknown')).body.code==='model_required','Selected model remains validated');
  check(calls.length===beforeCalls,'Invalid model never dispatches');
  await Promise.allSettled(waits);
  return {name,role,status:run.status,audioCalls:calls.filter(call=>call.path.endsWith('test-music')).length,attempts:await attempts(),debits:await debits()};
}
