#!/usr/bin/env node
// Explicit operator authorization for one proven late H3 result. The deployed
// service verifies private bytes and resumes through its ordinary scheduled job.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createCanvasSettlementCloudflareClient,createCanvasSettlementD1Binding,verifyCanvasSettlementRuntime,verifyCanvasSettlementSource} from './lib/canvas-settlement-operator.mjs';
import {previewCanvasMediaRecovery,authorizeCanvasMediaRecovery} from '../workers/auth/src/lib/canvas-agent-media-recovery.js';
const root=fs.realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const command=(program,args)=>execFileSync(program,args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false'},maxBuffer:1024*1024});
function privatePath(file,input=false){
 if(typeof file!=='string'||!path.isAbsolute(file))fail('canvas_recovery_private_path_required');
 const target=input?fs.realpathSync(file):path.join(fs.realpathSync(path.dirname(file)),path.basename(file));
 if(target===root||target.startsWith(root+path.sep)||!input&&fs.existsSync(target))fail('canvas_recovery_private_path_required');
 if(input){const stat=fs.statSync(target);if(!stat.isFile()||stat.size>6000||(stat.mode&0o077)!==0)fail('canvas_recovery_private_input_invalid');}
 return target;
}
let output=null;
try{
 const options={execute:false},args=process.argv.slice(2);
 for(let i=0;i<args.length;i++){
  if(args[i]==='--execute'&&!options.execute)options.execute=true;
  else if(['--input','--output'].includes(args[i])&&!options[args[i].slice(2)]&&args[i+1])options[args[i].slice(2)]=args[++i];
  else fail('canvas_recovery_arguments_invalid');
 }
 const input=JSON.parse(fs.readFileSync(privatePath(options.input,true),'utf8'));output=privatePath(options.output);
 const fields=['runId','projectId','userId','expectedSource','expectedAiSource','expectedSchema','projectCapCredits','recoveryDigest','actor','authorizationRef'];
 if(!input||Object.keys(input).some(key=>!fields.includes(key))||['runId','projectId','userId'].some(key=>!/^[A-Za-z0-9_-]{1,128}$/.test(input[key]||''))
   ||!/^[a-f0-9]{40}$/.test(input.expectedSource||'')||input.expectedAiSource&&!/^[a-f0-9]{40}$/.test(input.expectedAiSource)
   ||!Number.isSafeInteger(input.projectCapCredits)||input.projectCapCredits<1||input.projectCapCredits>100000
   ||options.execute&&!/^[a-f0-9]{64}$/.test(input.recoveryDigest||''))fail('canvas_recovery_input_invalid');
 const contract=JSON.parse(fs.readFileSync(path.join(root,'config/release-compat.json'),'utf8'));
 if(input.expectedSchema!==contract.release.schemaCheckpoints.auth.latest)fail('canvas_recovery_schema_not_current');
 verifyCanvasSettlementSource(input,args=>command('git',args));
 const paths=['workers/auth/src','workers/auth/migrations','workers/auth/wrangler.jsonc','workers/ai/src','workers/ai/wrangler.jsonc','workers/shared','js/shared','config/release-compat.json','scripts/canvas-h3-recovery.mjs','scripts/lib/canvas-settlement-operator.mjs'];
 if(command('git',['status','--porcelain','--untracked-files=all','--',...paths]).trim())fail('canvas_recovery_source_dirty');
 const config=JSON.parse(fs.readFileSync(path.join(root,'workers/auth/wrangler.jsonc'),'utf8'));
 let credential;try{credential=JSON.parse(command(process.execPath,['workers/auth/node_modules/wrangler/bin/wrangler.js','auth','token','--json']));}catch{fail('canvas_recovery_credential_unavailable');}
 const client=createCanvasSettlementCloudflareClient({accountId:config.vars.CLOUDFLARE_ACCOUNT_ID,databaseId:config.d1_databases.find(x=>x.binding==='DB').database_id,token:credential.token});
 const DB=createCanvasSettlementD1Binding(client),runtime=await verifyCanvasSettlementRuntime(client,DB,input),before=await previewCanvasMediaRecovery({DB},input);
 if(before.capCredits!==input.projectCapCredits||input.recoveryDigest&&input.recoveryDigest!==before.recoveryDigest)fail('canvas_recovery_scope_changed');
 const record={mode:options.execute?'authorize':'dry_run',runtime,before,startedAt:new Date().toISOString()};
 if(options.execute){
  fs.writeFileSync(privatePath(output+'.before.json'),JSON.stringify(record,null,2),{mode:0o600,flag:'wx'});
  await verifyCanvasSettlementRuntime(client,DB,input);
  record.after=await authorizeCanvasMediaRecovery({DB:createCanvasSettlementD1Binding(client,{readOnly:false})},input);
 }
 fs.writeFileSync(output,JSON.stringify({...record,completedAt:new Date().toISOString()},null,2),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({ok:true,mode:record.mode,evidence:output}));
}catch(error){const code=/^canvas_[a-z0-9_]{1,100}$/.test(error.code||'')?error.code:'canvas_recovery_operator_failed';console.error(JSON.stringify({ok:false,code}));process.exitCode=1;}
