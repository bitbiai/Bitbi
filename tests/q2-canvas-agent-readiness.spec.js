const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');
const fs=require('node:fs'),path=require('node:path');

for(const name of ['accepted-pending','accepted-saved','retry-recover','retry-exhausted','disabled','model-disabled','revoked','expired','edited','unknown'])test(`Canvas readiness recovery ${name}`,async()=>{
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  const media=Object.fromEntries([['videoBase64','canvas-end-frame.mp4'],['imageBase64','h3-frame.png'],['musicBase64','member-music.mp3']].map(([key,file])=>[key,fs.readFileSync(path.join(__dirname,'fixtures/media',file)).toString('base64')]));
  try{
    const {canvasAgentReadinessCase}=await import('./helpers/canvas-agent-readiness-control.mjs');
    expect((await canvasAgentReadinessCase({...createAuthTestEnv(),DB},name,media)).name).toBe(name);
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  }finally{DB.close();}
});

test('Canvas readiness diagnostics distinguish configuration, authentication, protocol and temporary observation failures',async()=>{
  const {readCanvasAgentProviderReadiness}=await import('../workers/auth/src/lib/canvas-agent-planning.js');
  const good={ok:true,available:true,reason:null,model:'xai/grok-4.7',accountAccess:'unverified',protocolVersion:1,transport:'cloudflare-background'};
  const env={...createAuthTestEnv(),CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),H3_CLOUDFLARE_API_TOKEN:'synthetic-readiness-only',AI_SERVICE_AUTH_SECRET:'synthetic-readiness-service-secret',AI_LAB:{fetch:()=>Response.json(good)}};
  expect(await readCanvasAgentProviderReadiness(env)).toEqual({available:true,reason:null,model:good.model,accountAccess:'unverified'});
  const cases=[
    [{H3_CLOUDFLARE_API_TOKEN:''},'canvas_agent_readiness_configuration',false,null],
    [{AI_LAB:{fetch:()=>Response.json({ok:false},{status:401})}},'canvas_agent_readiness_service_auth',false,401],
    [{AI_LAB:{fetch:()=>Response.json({ok:false},{status:503})}},'canvas_agent_readiness_http',true,503],
    [{AI_LAB:{fetch:()=>new Response('temporarily unavailable',{status:502})}},'canvas_agent_readiness_http',true,502],
    [{AI_LAB:{fetch:()=>Response.json({ok:false},{status:429})}},'canvas_agent_readiness_http',true,429],
    [{AI_LAB:{fetch:()=>Response.json({...good,transport:'untrusted'})}},'canvas_agent_readiness_contract',false,200],
    [{AI_LAB:{fetch:()=>new Response('broken JSON')}},'canvas_agent_readiness_contract',false,200],
    [{AI_LAB:{fetch:()=>{throw Object.assign(new Error('private payload must not escape'),{code:'generation_timeout'});}}},'canvas_agent_readiness_timeout',true,null],
    [{AI_LAB:{fetch:()=>{throw new TypeError('private endpoint must not escape');}}},'canvas_agent_readiness_transport',true,null],
  ];
  for(const [change,code,retryable,httpStatus]of cases){
    const result=await readCanvasAgentProviderReadiness({...env,...change});
    expect(result).toMatchObject({available:false,reason:'canvas_agent_provider_unavailable',diagnostic:{stage:'assistant_readiness',code,retryable,...(httpStatus?{httpStatus}:{})}});
    expect(JSON.stringify(result)).not.toMatch(/private payload|private endpoint|synthetic-readiness/);
  }
});
