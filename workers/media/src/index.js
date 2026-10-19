import { Container } from '@cloudflare/containers';
const DELIVERY_KEY='private-media-delivery';
const BACKOFF_SECONDS=[2,5,15,30,60];
const validToken=token=>/^[a-f0-9]{32}$/.test(token||'');
const safeDelivery=state=>state?{reference:state.reference,state:state.state,stage:state.stage,attempt:state.attempt,httpStatus:state.httpStatus??null,errorCode:state.errorCode??null,elapsedMs:Math.max(0,Date.now()-state.startedAt),nextAttemptAt:state.nextAttemptAt??null,...(state.recovery?{recovery:state.recovery}:{})}:null;
export class PrivateMediaContainer extends Container {
  defaultPort=8080;
  entrypoint=['node','container-server.mjs'];
  sleepAfter='30s';
  envVars={AUTH_WORKER_BASE_URL:'https://bitbi.ai',MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET:this.env.PRIVATE_MEDIA_PROCESSOR_SECRET,SOURCE_SHA:this.env.SOURCE_SHA,
    CLOUDFLARE_ACCOUNT_ID:this.env.CLOUDFLARE_ACCOUNT_ID,CLOUDFLARE_STREAM_API_TOKEN:this.env.CLOUDFLARE_STREAM_API_TOKEN};
  async fetch(request) {
    const pathname=new URL(request.url).pathname;
    if(pathname==='/status') {
      const proof=await this.ctx.storage.get('functional-proof');
      return Response.json({protocol:1,version:this.env.SOURCE_SHA,functional_verified:proof?.sha===this.env.SOURCE_SHA,preview_configured:Boolean(this.env.CLOUDFLARE_ACCOUNT_ID&&this.env.CLOUDFLARE_STREAM_API_TOKEN),delivery:safeDelivery(await this.ctx.storage.get(DELIVERY_KEY))});
    }
    if(pathname==='/verified'&&request.method==='POST'){
      const proof=await request.json();
      if(proof.sha!==this.env.SOURCE_SHA||!/^[a-f0-9]{32}$/.test(proof.job||''))return new Response(null,{status:409});
      await this.ctx.storage.put('functional-proof',{sha:proof.sha,job:proof.job});
      return Response.json({verified:true});
    }
    if(pathname==='/retry'&&request.method==='POST') {
      const body=await request.json();
      if(!validToken(body?.token)||!validToken(body?.requestId)||!validToken(body?.jobId)||typeof body.reference!=='string'||Object.keys(body).some(k=>!['token','requestId','reference','jobId'].includes(k)))return new Response(null,{status:400});
      return this.ctx.blockConcurrencyWhile(async()=>{
        const state=await this.ctx.storage.get(DELIVERY_KEY);
        if(state?.token!==body.token||state.reference!==body.reference)return Response.json({code:'media_delivery_recovery_changed'},{status:409});
        if(state.recovery?.requestId===body.requestId&&state.recovery.jobId===body.jobId)return state.state==='blocked'?Response.json({accepted:false,code:'media_delivery_exhausted'},{status:409}):Response.json({accepted:true},{status:202});
        if(state.state!=='blocked'||(state.failures?.length||0)>=3)return Response.json({code:'media_delivery_recovery_unavailable'},{status:409});
        state.failures=[...(state.failures||[]),safeDelivery(state)];
        state.recovery={requestId:body.requestId,jobId:body.jobId,requestedAt:Date.now()};state.attemptStart=state.attempt;state.state='prepared';
        state.stage='authorized_recovery';state.nextAttemptAt=null;state.scheduleId=null;
        // Preparation does not start an alarm. Auth must first commit the guarded
        // dispatch lease renewal; its ordinary /wake observes that authority.
        await this.ctx.storage.put(DELIVERY_KEY,state);
        console.log(JSON.stringify({event:'private_media_delivery_recovery',...safeDelivery(state),previousFailures:state.failures.length}));
        return Response.json({accepted:true},{status:202});
      });
    }
    if(pathname!=='/wake'||request.method!=='POST')return new Response(null,{status:404});
    const body=await request.json();if(!validToken(body?.token)||Object.keys(body).length!==1)return new Response(null,{status:400});
    return this.ctx.blockConcurrencyWhile(async()=>{
      let state=await this.ctx.storage.get(DELIVERY_KEY);
      if(state?.token===body.token) {
        if(state.state==='prepared') {
          const current=await this.activation(body);
          if(current!=='pending')return Response.json({accepted:true},{status:202});
          state.state='scheduled';
        }
        if(state.state==='blocked')return Response.json({code:'media_delivery_exhausted',diagnostic:safeDelivery(state)},{status:409});
        if(['running','stale','acknowledged'].includes(state.state))return Response.json({accepted:true},{status:202});
        if(state.scheduleId&&(await this.getSchedule(state.scheduleId))?.payload?.token===body.token)return Response.json({accepted:true},{status:202});
      } else {
        // Serialize a different-token arrival with authoritative observation. A
        // delayed old /wake must not replace a newer accepted schedule.
        if(state) {
          const current=await this.activation(body);
          if(current==='stale')return Response.json({accepted:true},{status:202});
          if(current==='blocked')return Response.json({code:'media_delivery_exhausted'},{status:409});
        }
        state={token:body.token,reference:crypto.randomUUID(),startedAt:Date.now(),attempt:0,state:'scheduled',stage:'scheduled'};
      }
      await this.ctx.storage.put(DELIVERY_KEY,state);
      const scheduled=await this.schedule(0,'deliver',{token:body.token});
      state.scheduleId=scheduled?.taskId;await this.ctx.storage.put(DELIVERY_KEY,state);
      return Response.json({accepted:true},{status:202}); // Scheduling only, never renderer completion.
    });
  }
  async recordDelivery(state,{delay}={}) {
    return this.ctx.blockConcurrencyWhile(async()=>{
      const current=await this.ctx.storage.get(DELIVERY_KEY);
      if(current&&(current.token!==state.token||current.attempt>state.attempt||current.recovery?.requestId!==state.recovery?.requestId))return false;
      state.nextAttemptAt=delay===undefined?null:new Date(Date.now()+delay*1000).toISOString();
      await this.ctx.storage.put(DELIVERY_KEY,state);
      // The pinned SDK catches callback exceptions and deletes their schedule.
      // Persist an explicit new bounded schedule before returning from this one.
      if(delay!==undefined){const scheduled=await this.schedule(delay,'deliver',{token:state.token});state.scheduleId=scheduled?.taskId;await this.ctx.storage.put(DELIVERY_KEY,state);}
      console.log(JSON.stringify({event:'private_media_delivery',...safeDelivery(state)}));
      return true;
    });
  }
  async activation(body,action='observe') {
    const response=await fetch('https://bitbi.ai/api/internal/homepage/hero-videos/private-media/runner',{
      method:'POST',headers:{Authorization:`Bearer ${this.env.PRIVATE_MEDIA_PROCESSOR_SECRET}`,'Content-Type':'application/json'},
      body:JSON.stringify({token:body.token,runner:'container-delivery',action}),signal:AbortSignal.timeout(15000),
    });
    const result=await response.json();
    // During the protected media-before-Auth rollout, the previous authenticated
    // runner contract rejects only this new action. Its original child acquire
    // still fences stale activations before job claims. No transport/error fallback.
    if(response.status===409&&result?.code==='media_runner_invalid')return 'legacy';
    if(!response.ok||result?.ok!==true||result.data?.protocol!==1||!['stale','pending','running','blocked'].includes(result.data.state))throw Object.assign(new Error('media_delivery_authority_unavailable'),{httpStatus:response.status});
    return result.data.state;
  }
  async deliver(body) {
    if(!validToken(body?.token)||this.deliveryInFlight===body.token)return;
    this.deliveryInFlight=body.token;
    try{return await this.deliverCurrent(body);}finally{if(this.deliveryInFlight===body.token)this.deliveryInFlight=null;}
  }
  async deliverCurrent(body) {
    let state=await this.ctx.storage.get(DELIVERY_KEY);
    if(state&&state.token!==body.token)return; // Superseded schedule, no container call.
    state??={token:body.token,reference:crypto.randomUUID(),startedAt:Date.now(),attempt:0,state:'scheduled',stage:'scheduled'}; // Accepted schedules from the preceding release.
    if(['running','stale','blocked','acknowledged','prepared'].includes(state.state))return;
    state={...state,attempt:state.attempt+1,state:'delivering',httpStatus:null,errorCode:null};
    if(!await this.recordDelivery(state))return;
    let stage='authority';
    try {
      const current=await this.activation(body);
      if(current==='blocked'&&state.recovery)throw Object.assign(new Error('media_delivery_authority_unavailable'),{httpStatus:503});
      if(!['pending','legacy'].includes(current))return this.recordDelivery({...state,state:current,stage:'runner_observation'});
      const latest=await this.ctx.storage.get(DELIVERY_KEY);
      if(latest?.token!==state.token||latest.recovery?.requestId!==state.recovery?.requestId)return;
      stage='container';
      const response=await this.containerFetch('http://container/wake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
      state.httpStatus=response.status;stage='acknowledgement';
      // SDK 0.3.7 keeps its request in flight until the body finishes, including errors.
      await response.arrayBuffer();
      if(!response.ok)throw Object.assign(new Error('media_delivery_http'),{httpStatus:response.status,code:'media_delivery_http'});
      // 202 proves only child acceptance. Observe the existing D1 runner claim;
      // a lost acknowledgement or child crash may reuse this same token safely.
      const acquired=await this.activation(body);
      if(acquired==='legacy')return this.recordDelivery({...state,state:'acknowledged',stage:'container_acknowledgement'});
      if(acquired!=='pending')return this.recordDelivery({...state,state:acquired,stage:'runner_observation'});
      stage='runner_pending';
    } catch(error) {
      state.httpStatus=Number.isInteger(error.httpStatus)?error.httpStatus:state.httpStatus;
      state.errorCode=stage==='authority'?'media_delivery_authority_unavailable':state.httpStatus===409?'media_container_busy':error.code==='media_delivery_http'?'media_delivery_http':error?.name==='TimeoutError'||error?.name==='AbortError'?'media_delivery_timeout':'media_delivery_transport';
    }
    const delay=BACKOFF_SECONDS[state.attempt-(state.attemptStart||0)-1];
    const retryable=['media_delivery_transport','media_delivery_timeout'].includes(state.errorCode)||!state.httpStatus||[408,409,425,429].includes(state.httpStatus)||state.httpStatus>=500||stage==='runner_pending';
    if(delay!==undefined&&retryable)return this.recordDelivery({...state,state:'retrying',stage},{delay});
    // Do not erase or rotate the original activation. A late accepted runner
    // wins over this report; the Auth CAS only blocks an unacquired current token.
    try {
      const current=await this.activation(body,'delivery_failed');
      return this.recordDelivery({...state,state:['pending','legacy'].includes(current)?'blocked':current,stage,errorCode:state.errorCode||'media_delivery_exhausted'});
    } catch {
      // No unlimited retry loop. Duplicate /wake receives the durable blocked
      // response and projects the same outage into the existing dispatch row.
      return this.recordDelivery({...state,state:'blocked',stage,errorCode:state.errorCode||'media_delivery_exhausted'});
    }
  }
  async onActivityExpired() {
    // Keep a newly accepted wake from racing the health-check/stop boundary.
    // Existing SDK schedules remain durable; no second dispatcher or job lease.
    await this.ctx.blockConcurrencyWhile(async()=>{
      if(!this.ctx.container.running)return;
      try {
        const response=await this.containerFetch('http://container/health',{signal:AbortSignal.timeout(5000)});
        const health=await response.json();
        // A running instance may still have the previous deployment's SHA.
        // Its local busy flag, not equality with the new actor SHA, protects work.
        if(!response.ok||health.protocol!==1||!/^[a-f0-9]{40}$/.test(health.source||'')||typeof health.busy!=='boolean')throw new Error('media_container_health_unknown');
        if(health.busy||(await this.listSchedules('deliver')).length){this.renewActivityTimeout();return;}
        await this.stop();
        // stop() signals SIGTERM; await exit before a later wake starts a child.
        try{await this.ctx.container.monitor();}catch{if(this.ctx.container.running)throw new Error('media_container_stop_failed');}
      } catch {
        // Uncertain health must never kill active work or reset the actor.
        this.renewActivityTimeout();
        console.error(JSON.stringify({event:'private_media_container_idle_check_failed'}));
      }
    });
  }
  onStart(){console.log(JSON.stringify({event:'private_media_container_started'}));}
  onStop(){console.log(JSON.stringify({event:'private_media_container_stopped'}));}
  onError(){console.error(JSON.stringify({event:'private_media_container_error'}));}
}
export default {
  // Service binding only: workers.dev, previews and public routes are disabled.
  fetch(request,env){return env.MEDIA_CONTAINER.getByName('private-media-singleton').fetch(request);},
};
