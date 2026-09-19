import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
let active=null;
const server=createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(req.method==='GET'&&req.url==='/health')return send(200,{protocol:1,busy:Boolean(active),source:process.env.SOURCE_SHA});
  if(req.method!=='POST'||req.url!=='/wake')return send(404,{code:'not_found'});
  let bytes='';for await(const chunk of req){bytes+=chunk;if(bytes.length>128){send(413,{code:'body_too_large'});req.destroy();return;}}
  let body;try{body=JSON.parse(bytes);}catch{return send(400,{code:'invalid_payload'});}
  if(!/^[a-f0-9]{32}$/.test(body?.token||'')||Object.keys(body).length!==1)return send(400,{code:'invalid_payload'});
  if(active)return send(active.token===body.token?202:409,{accepted:active.token===body.token});
  const child=spawn(process.execPath,['processor.mjs'],{cwd:'/app',env:{...process.env,PRIVATE_MEDIA_DISPATCH:body.token,PRIVATE_MEDIA_RUNNER:`container-${randomUUID()}`,
    MEMBER_GENERATION_POSTERS_ONLY:'1',PROCESS_HOMEPAGE_HERO:'0',PROCESS_HOMEPAGE_SOURCE_POSTERS:'1',PROCESS_MEMVID_STREAM_PREVIEWS:'0',JOB_LIMIT:'1'},stdio:['ignore','inherit','inherit']});
  active={child,token:body.token};const timer=setTimeout(()=>child.kill('SIGKILL'),20*60_000);
  const clear=()=>{clearTimeout(timer);active=null;};child.once('error',clear);child.once('exit',clear);
  return send(202,{accepted:true});
});
server.listen(8080,'0.0.0.0',()=>console.log(JSON.stringify({event:'private_media_listener_ready'})));
process.on('SIGTERM',()=>{active?.child.kill('SIGTERM');server.close(()=>process.exit(0));});
