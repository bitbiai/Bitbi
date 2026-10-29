import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

export const VOICE_BROWSER_SANDBOX='(version 1)\n(allow default)\n(deny network*)\n(allow network-bind (local ip "localhost:*"))\n(allow network-inbound (local ip "localhost:*"))\n(allow network-outbound (remote ip "localhost:*"))\n';
export async function launchCanvasVoiceNativeChild({artifacts,name,locale='de'}){
  assert.equal(process.platform,'darwin','The registered native/browser caller requires the Mac sandbox-exec boundary; Linux native coverage uses its existing isolated suite.');
  const profile=path.join(artifacts,name+'-network.sb');fs.writeFileSync(profile,VOICE_BROWSER_SANDBOX,{mode:0o600,flag:'wx'});
  const entry=fileURLToPath(new URL('./q2-runtime/voice-browser-child.mjs',import.meta.url));
  const child=spawn('/usr/bin/sandbox-exec',['-f',profile,process.execPath,entry],{detached:true,stdio:['ignore','pipe','pipe','ipc']});
  // This process group contains only this fixture's Node/workerd/esbuild. Even
  // an interrupted native request cannot leave a background runtime behind.
  const terminate=()=>{if(child.connected)child.disconnect();try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}};
  const log=fs.createWriteStream(path.join(artifacts,name+'-native.log'),{flags:'wx',mode:0o600});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  let sequence=0,onSocket=()=>{},onClose=()=>{};const pending=new Map();
  child.on('message',value=>{
    if(value.event==='socket')return onSocket(value.data);
    if(value.event==='closed')return onClose(value);
    const operation=pending.get(value.id);if(!operation)return;pending.delete(value.id);clearTimeout(operation.timer);
    value.error?operation.reject(new Error(value.error.message+'\n'+value.error.stack)):operation.resolve(value.result);
  });
  child.on('exit',(code,signal)=>{for(const operation of pending.values()){clearTimeout(operation.timer);operation.reject(new Error(`Native Voice child ended ${code}/${signal}; ${artifacts}`));}pending.clear();});
  const call=(command,input)=>new Promise((resolve,reject)=>{
    if(!child.connected){reject(new Error('Native Voice child is closed'));return;}
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Native Voice ${command} timeout; ${artifacts}`));},command==='init'?120000:20000);
    pending.set(id,{resolve,reject,timer});child.send({id,command,input});
  });
  try{
    const identity=await call('init',{artifacts,name,locale});
    return {call,identity,artifacts:identity.artifacts,setSocket(receive,close){onSocket=receive;onClose=close;},async close(){try{if(child.connected)await call('dispose');}finally{terminate();log.end();}}};
  }catch(error){terminate();log.end();throw error;}
}
