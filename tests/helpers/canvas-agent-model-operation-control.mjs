import worker from '../../workers/auth/src/index.js';
import aiWorker from '../../workers/ai/src/index.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { topUpMemberDailyCredits, grantMemberCredits } from '../../workers/auth/src/lib/billing.js';
import { getModelTariff } from '../../workers/auth/src/lib/model-tariffs.js';
import { freshCanvasAgentPlan } from './canvas-agent-control.mjs';

const check=(value,message)=>{if(!value)throw new Error(message);};

// Shared browser/Worker/native fixture: real signed adapters, routes, D1,
// accounting and queue; only the external background provider is synthetic.
// No filesystem, paid call, browser-driven production or custom response model.
export async function canvasAgentModelOperationFixture(base,{scope='model-operation',kind='plan',providerResponse=null,mediaPolicy=null}={}) {
    check(kind==='plan','This fixture starts an ordinary planning operation');
    const db=base.DB,owner=`canvas-agent-${scope}`,project=(await sha256Hex(owner)).slice(0,32);
    const calls=[],messages=[],serviceCalls=[],waits=[],RealDate=globalThis.Date;
    let clock=RealDate.now(),sequence=0,runId=null,serial=Promise.resolve();
    class FixtureDate extends RealDate {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
    const atClock=operation=>{
        const task=serial.then(async()=>{const previous=globalThis.Date;globalThis.Date=FixtureDate;try{return await operation();}finally{globalThis.Date=previous;}});
        serial=task.catch(()=>{});return task;
    };
    const env={...base,CANVAS_AGENT_ENABLED:'true',ENABLE_GROK_4_7:'true',
        CLOUDFLARE_ACCOUNT_ID:'c'.repeat(32),H3_CLOUDFLARE_API_TOKEN:'synthetic-canvas-background-token',
        AI_SERVICE_AUTH_SECRET:'synthetic-canvas-model-operation-service',
        AI_VIDEO_JOBS_QUEUE:{async send(body){messages.push(body);}},
        PRIVATE_MEDIA_PROCESSOR:{async fetch(){throw new Error('Unexpected processor before planning completes');}},
    };
    env.AI_LAB={async fetch(request){
        serviceCalls.push(new URL(request.url).pathname);
        return aiWorker.fetch(request,{ENABLE_GROK_4_7:'true',AI_SERVICE_AUTH_SECRET:env.AI_SERVICE_AUTH_SECRET,
            SERVICE_AUTH_REPLAY:env.SERVICE_AUTH_REPLAY||env.PUBLIC_RATE_LIMITER,
            AI:{run(){throw new Error('Signed preparation/normalization must not submit inference');}}},
        {waitUntil(){throw new Error('No detached provider work in the AI adapter');}});
    }};
    env.__TEST_FETCH=async(url,init)=>{
        check(String(url)===`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run`,'Only the existing background provider route is permitted');
        const body=JSON.parse(init.body),headers=new Headers(init.headers);
        check(init.method==='POST'&&body.model==='xai/grok-4.7'&&body.options?.background===true,'One explicit background Grok request');
        check(headers.get('cf-aig-collect-log')==='false'&&headers.get('cf-aig-skip-cache')==='true'&&headers.get('cf-aig-max-attempts')==='1','Private single-attempt gateway transport');
        check(new URL(body.options.webhookUrl).pathname.startsWith('/api/internal/ai/canvas-agent-result/'),'The actual dispatcher supplies its signed result callback');
        const id=`synthetic-${scope}-${calls.length+1}`;
        // Keep callback capability inside this local fixture; never return it
        // in public evidence, diagnostic artifacts or assertion output.
        calls.push({id,body,headers});
        return providerResponse?providerResponse({id,body,headers}):Response.json({success:true,result:{id,state:'Queued'}});
    };
    await atClock(async()=>{
        const now=new Date().toISOString();
        await db.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,?,?,'user','active',?)")
            .bind(owner,owner+'@example.invalid','synthetic',now,now).run();
        await db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
            .bind(owner,owner,await sha256Hex(`${owner}:${env.SESSION_HASH_SECRET}`),now,new Date(clock+24*3600_000).toISOString(),now).run();
        await topUpMemberDailyCredits({env,userId:owner});
        await grantMemberCredits({env,userId:owner,amount:10000,createdByUserId:owner,idempotencyKey:'model-operation-credits-'+scope});
        await db.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,'Durable reasoning fixture','en',?,?)")
            .bind(project,owner,now,now).run();
    });
    const projectPath=`/api/account/canvas/projects/${project}`,route=projectPath+'/agent';
    const request=(url,method='GET',body,headers={})=>atClock(async()=>{
        const tariff=(await getModelTariff(env)).revision;
        const response=await worker.fetch(new Request(new URL(url,'https://bitbi.ai'),{method,headers:{
            Cookie:`__Host-bitbi_session=${owner}`,Origin:'https://bitbi.ai','CF-Connecting-IP':`192.0.2.${(++sequence%200)+1}`,
            'X-Bitbi-Tariff-Revision':String(tariff),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},
            ...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),env,{waitUntil(promise){waits.push(promise);}});
        await Promise.all(waits.splice(0));return response;
    });
    const data=async response=>{const value=await response.json();check(response.ok,`Actual Canvas API returned ${response.status}/${value.code||'unknown'}`);return value.data;};
    const input={brief:'Create a 12 second film with three editable shots of the same house and duck pool.',targetDurationSeconds:12,expectedRevision:0,budgetCredits:10000,locale:'en'};
    if(mediaPolicy){
        const saved=await data(await request(route+'/media-policy','PUT',{expectedRevision:0,...mediaPolicy},{'Idempotency-Key':'fixture-media-policy-'+scope}));
        check(saved.policy.revision===1,'The policy is persisted before the original production is authorized');
        input.mediaPolicyRevision=saved.policy.revision;
    }
    const started=await data(await request(route,'POST',input,{'Idempotency-Key':'model-operation-start-'+scope}));runId=started.run.id;
    async function deliver({duplicates=2}={}) {
        const run=await db.prepare('SELECT next_attempt_at FROM canvas_agent_runs WHERE id=?').bind(runId).first();
        clock=Math.max(clock,Date.parse(run.next_attempt_at)||clock);
        return atClock(async()=>{
            let acknowledged=0;
            await worker.queue({queue:'bitbi-ai-video-jobs',messages:Array.from({length:duplicates},()=>({body:{type:'canvas_agent.process',run_id:runId},attempts:1,
                ack(){acknowledged++;},retry(){throw new Error('Unexpected reasoning queue retry');}}))},env,{waitUntil(promise){waits.push(promise);}});
            await Promise.all(waits.splice(0));check(acknowledged===duplicates,'Every duplicate queue delivery is acknowledged');
            return db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(runId).first();
        });
    }
    const operation=()=>db.prepare('SELECT * FROM canvas_agent_model_operations WHERE run_id=? ORDER BY rowid DESC LIMIT 1').bind(runId).first();
    const observe=async()=>((await data(await request(route))).run);
    async function complete(overrides={}) {
        check(calls.length===1,'A completion must refer to the single original dispatch');
        const {id,body}=calls[0],plan=freshCanvasAgentPlan();
        return request(body.options.webhookUrl,'POST',{id,state:'Completed',model:'xai/grok-4.7',result:{id:'synthetic-plan-result',object:'chat.completion',model:'grok-4.7',
            choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(plan)}}],usage:{prompt_tokens:120,completion_tokens:200,total_tokens:320}},...overrides});
    }
    async function expire(){const op=await operation();check(op,'A dispatched operation exists before expiry');clock=Math.max(clock,Date.parse(op.receipt_deadline)+1);return observe();}
    return {env,db,project,projectPath,route,owner,runId,calls,messages,serviceCalls,input,request,data,deliver,complete,expire,observe,operation,
        advance(milliseconds){check(Number.isFinite(milliseconds)&&milliseconds>=0,'Clock only advances');clock+=milliseconds;return clock;},
        atClock};
}
