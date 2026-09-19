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
    if(!response.ok)throw new Error('media_container_start_failed');
  }
  async onActivityExpired() {
    if(!this.ctx.container.running)return;
    const response=await this.containerFetch('http://container/health');
    if((await response.json()).busy)this.renewActivityTimeout();
    else await this.stop();
  }
  onError(){console.error(JSON.stringify({event:'private_media_container_error'}));}
}
export default {
  // Service binding only: workers.dev, previews and public routes are disabled.
  fetch(request,env){return env.MEDIA_CONTAINER.getByName('private-media-singleton').fetch(request);},
};
