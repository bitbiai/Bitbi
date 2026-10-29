// Only launched by the Mac-local browser caller under sandbox-exec. The normal
// runtime owns sanitized bindings, native D1/DO and complete external denial.
import {prepareBuild,createRuntime} from './environment.mjs';
import {createNativeVoiceBrowserBridge} from './voice-browser-bridge.mjs';
let build,runtime,bridge,serial=Promise.resolve();
const send=value=>process.connected&&process.send(value);
process.on('message',({id,command,input})=>{serial=serial.then(async()=>{
  try{
    let result;
    if(command==='init'){
      if(runtime)throw new Error('One native runtime lifecycle owner');
      build=prepareBuild(input.artifacts);runtime=await createRuntime(build,'canvas-voice');
      for(const migration of runtime.migrations)await runtime.db.batch(migration.statements.map(sql=>runtime.db.prepare(sql)));
      bridge=await createNativeVoiceBrowserBridge(runtime,{name:input.name,artifacts:build.workDir,locale:input.locale});
      bridge.setSocket(data=>send({event:'socket',data}),value=>send({event:'closed',...value}));
      result={...bridge.identity,artifacts:build.workDir};
    }else if(command==='dispose'){await runtime?.close();runtime=null;build?.esbuild.stop();result=true;}
    else{if(!bridge)throw new Error('Initialize the native fixture first');result=await bridge.call(command,input);}
    send({id,result});
  }catch(error){send({id,error:{message:error.message,stack:error.stack}});}
});});
process.on('disconnect',()=>{void Promise.resolve(runtime?.close()).finally(()=>{build?.esbuild.stop();process.exit();});});
