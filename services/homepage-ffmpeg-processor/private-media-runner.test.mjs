import assert from 'node:assert/strict';
import {runPrivateMedia} from './private-media-runner.mjs';
import {createWebpPoster} from './processor.mjs';
import {mediaCommand} from './canvas-full-video.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
export async function testPrivateMediaRunner() {
  const token='a'.repeat(32),runner='synthetic',actions=[];let pass=0;
  const args={token,runner,requestJson:async(url,{body})=>{assert.equal(url,'/api/internal/homepage/hero-videos/private-media/runner');const p=JSON.parse(body);actions.push(p.action);assert.equal(p.token,token);return {data:{pending:pass<2?1:0}};},processExports:async()=>{actions.push('export');},processPosters:async()=>{actions.push('poster');pass++;}};
  assert.equal((await runPrivateMedia(args)).passes,2);
  assert.deepEqual(actions,['acquire','heartbeat','export','poster','heartbeat','heartbeat','export','poster','heartbeat','finish']);
  actions.length=0;await assert.rejects(runPrivateMedia({...args,processExports:async()=>{throw Error('synthetic crash');}}),/synthetic crash/);assert.equal(actions.at(-1),'finish');
  actions.length=0;await assert.rejects(runPrivateMedia({...args,requestJson:async()=>{throw Error('lost lease');}}),/lost lease/);assert.equal(actions.length,0);
  pass=0;assert.equal((await runPrivateMedia({...args,requestJson:async()=>({data:{pending:1}})})).passes,8,'Bounded drain, next activation handles remainder');
  await assert.rejects(runPrivateMedia({...args,token:'invalid'}),/media_runner_invalid/);
  const dir=await mkdtemp(path.join(os.tmpdir(),'bitbi-private-poster-'));
  try {
    const input=path.join(dir,'input.mp4'),poster=path.join(dir,'poster.webp');
    await mediaCommand('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=320x180:d=0.5','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',input]);
    await createWebpPoster({input,poster,posterWidth:320,dir});
    const bytes=await readFile(poster);assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WEBP');
    console.log(JSON.stringify({test:'private-media-runner',drain:true,crash:true,fencing:true,bounded:true,nativePosterBytes:bytes.length}));
  }finally{await rm(dir,{recursive:true,force:true});}
}

// Executed inside the final Linux image by private-media-image.mjs. The HTTP
// runner is real; only the authenticated backend responses are synthetic.
export async function testContainerLifecycle() {
  const {createServer}=await import('node:http'),{spawn}=await import('node:child_process'),{once}=await import('node:events');
  const first='c'.repeat(32),next='d'.repeat(32);let accepted=0,exports=0,finished;
  const finishedPromise=new Promise(resolve=>{finished=resolve;});
  const backend=createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');
    assert.equal(req.headers.authorization,'Bearer synthetic-container-only');
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:status===200,data}));};
    if(req.url.endsWith('/runner')) {
      if(body.action==='acquire') {
        if(body.token===first&&accepted)return send(409,{code:'media_runner_claim_lost'});
        accepted++;
      }
      if(body.action==='finish')finished();
      return send(200,{pending:0});
    }
    if(req.url.includes('canvas-exports')&&req.method==='POST') {exports++;if(exports===1)return;}
    send(200,{protocol:1,jobs:[]});
  });
  backend.listen(0,'127.0.0.1');await once(backend,'listening');let processHandle;
  const start=async()=>{
    processHandle=spawn(process.execPath,['container-server.mjs'],{cwd:process.cwd(),detached:true,env:{...process.env,AUTH_WORKER_BASE_URL:`http://127.0.0.1:${backend.address().port}`,MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET:'synthetic-container-only'},stdio:['ignore','pipe','pipe']});
    await once(processHandle.stdout,'data',{signal:AbortSignal.timeout(5000)});
  };
  const stop=async()=>{const exited=once(processHandle,'exit');process.kill(-processHandle.pid,'SIGKILL');await exited;processHandle=null;};
  const wake=body=>fetch('http://127.0.0.1:8080/wake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  try {
    await start();assert.equal((await wake({token:'wrong'})).status,400);
    assert.equal((await wake({token:first})).status,202);
    assert.equal((await wake({token:first})).status,202);
    assert.equal((await wake({token:next})).status,409);
    // Observe the actual held export claim before killing the full process group.
    const deadline=Date.now()+5000;while(exports!==1&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.equal(exports,1);
    await stop();await start();
    // Durable D1 expiry/new fencing token is covered by the native test; the
    // restarted real runner must accept its new activation and finish once.
    assert.equal((await wake({token:next})).status,202);
    await Promise.race([finishedPromise,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Container recovery did not finish')),5000);t.unref();})]);
    assert.equal(accepted,2);assert.equal(exports,2);
    console.log(JSON.stringify({test:'container-process-restart',oneConcurrent:true,malformedRejected:true,restarted:true,finished:true}));
  }finally{if(processHandle)await stop();backend.closeAllConnections();await new Promise(r=>backend.close(r));}
}
