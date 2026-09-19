import { Container } from '@cloudflare/containers';
export class PrivateMediaContainer extends Container {
  defaultPort=8080;
  entrypoint=['node','container-server.mjs'];
  sleepAfter='30s';
  envVars={AUTH_WORKER_BASE_URL:'https://bitbi.ai',MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET:this.env.PRIVATE_MEDIA_PROCESSOR_SECRET,SOURCE_SHA:this.env.SOURCE_SHA};
  async fetch(request) {
    const pathname=new URL(request.url).pathname;
    if(pathname==='/status') {
      const proof=await this.ctx.storage.get('functional-proof');
      return Response.json({protocol:1,version:this.env.SOURCE_SHA,functional_verified:proof?.sha===this.env.SOURCE_SHA});
    }
    if(pathname==='/verified'&&request.method==='POST'){
      const proof=await request.json();
      if(proof.sha!==this.env.SOURCE_SHA||!/^[a-f0-9]{32}$/.test(proof.job||''))return new Response(null,{status:409});
      await this.ctx.storage.put('functional-proof',{sha:proof.sha,job:proof.job});
      return Response.json({verified:true});
    }
    if(pathname!=='/wake'||request.method!=='POST')return new Response(null,{status:404});
    const body=await request.json();if(!/^[a-f0-9]{32}$/.test(body?.token||'')||Object.keys(body).length!==1)return new Response(null,{status:400});
    await this.schedule(0,'deliver',body); // Durable activation before acknowledging.
    return Response.json({accepted:true},{status:202});
  }
  async deliver(body) {
    const response=await this.containerFetch('http://container/wake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    // SDK 0.3.7 keeps a request in flight until the body finishes. The tiny
    // acknowledgement must be consumed on success AND failure, or idle never fires.
    await response.arrayBuffer();
    if(!response.ok)throw new Error('media_container_start_failed');
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
