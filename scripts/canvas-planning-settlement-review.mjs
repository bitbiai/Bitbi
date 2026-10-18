#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateCanvasSettlementOperatorInput,createCanvasSettlementCloudflareClient,createCanvasSettlementD1Binding,
    verifyCanvasSettlementRuntime,verifyCanvasSettlementOperatorQuote,verifyCanvasSettlementSource,canvasSettlementRuntimeEnvironment} from './lib/canvas-settlement-operator.mjs';
import {previewCanvasPlanningSettlementReview,applyCanvasPlanningSettlementReview,
    previewCanvasPlanningSettlementContinuation,applyCanvasPlanningSettlementContinuation} from '../workers/auth/src/lib/canvas-agent-settlement-review.js';

const root=fs.realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const fail=code=>{throw Object.assign(new Error(code),{code});};
let outputPath=null,record=null;
function outsideRepository(file,{input=false}={}) {
    if(typeof file!=='string'||!path.isAbsolute(file))fail('canvas_settlement_private_path_required');
    const resolved=input?fs.realpathSync(file):path.join(fs.realpathSync(path.dirname(file)),path.basename(file));
    if(resolved===root||resolved.startsWith(root+path.sep)||fs.existsSync(resolved)&&!input)
        fail('canvas_settlement_private_path_required');
    if(input){const stat=fs.statSync(resolved);if(!stat.isFile()||(stat.mode&0o077)!==0||stat.size>12000)fail('canvas_settlement_private_input_invalid');}
    return resolved;
}
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
const command=(program,args)=>execFileSync(program,args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],
    env:{...process.env,WRANGLER_SEND_METRICS:'false'},maxBuffer:1024*1024});
try {
    const args=process.argv.slice(2),options={execute:false,continuePlan:false};
    for(let i=0;i<args.length;i++){
        if(args[i]==='--execute'&&!options.execute)options.execute=true;
        else if(args[i]==='--continue-plan'&&!options.continuePlan)options.continuePlan=true;
        else if(['--input','--output'].includes(args[i])&&!options[args[i].slice(2)]&&args[i+1])options[args[i].slice(2)]=args[++i];
        else fail('canvas_settlement_operator_arguments_invalid');
    }
    const inputPath=outsideRepository(options.input,{input:true});
    outputPath=outsideRepository(options.output);
    const beforePath=outsideRepository(outputPath+'.before.json');
    const input=validateCanvasSettlementOperatorInput(JSON.parse(fs.readFileSync(inputPath,'utf8')),options);
    const contract=JSON.parse(fs.readFileSync(path.join(root,'config/release-compat.json'),'utf8'));
    if(input.expectedSchema!==contract.release.schemaCheckpoints.auth.latest)fail('canvas_settlement_schema_not_current');
    verifyCanvasSettlementSource(input,args=>command('git',args));
    const codePaths=['workers/auth/src','workers/auth/migrations','workers/auth/wrangler.jsonc','workers/ai/src','workers/ai/wrangler.jsonc',
        'workers/shared','js/shared','config/release-compat.json','scripts/canvas-planning-settlement-review.mjs','scripts/lib/canvas-settlement-operator.mjs'];
    if(command('git',['status','--porcelain','--untracked-files=all','--',...codePaths]).trim())fail('canvas_settlement_runtime_source_dirty');
    const authConfig=JSON.parse(fs.readFileSync(path.join(root,'workers/auth/wrangler.jsonc'),'utf8'));
    const accountId=authConfig.vars?.CLOUDFLARE_ACCOUNT_ID,databaseId=authConfig.d1_databases?.find(binding=>binding.binding==='DB')?.database_id;
    let credential;
    try {credential=JSON.parse(command(process.execPath,['workers/auth/node_modules/wrangler/bin/wrangler.js','auth','token','--json']));}
    catch {fail('canvas_settlement_operator_credential_unavailable');}
    const client=createCanvasSettlementCloudflareClient({accountId,databaseId,token:credential.token});
    const readEnv={DB:createCanvasSettlementD1Binding(client)};
    const runtime=await verifyCanvasSettlementRuntime(client,readEnv.DB,input);
    const preview=options.continuePlan?previewCanvasPlanningSettlementContinuation:previewCanvasPlanningSettlementReview;
    const apply=options.continuePlan?applyCanvasPlanningSettlementContinuation:applyCanvasPlanningSettlementReview;
    const before=verifyCanvasSettlementOperatorQuote(input,await preview(options.continuePlan?canvasSettlementRuntimeEnvironment(runtime,readEnv.DB):readEnv,input));
    record={mode:options.execute?'execute':'dry_run',operation:options.continuePlan?'continue_stored_plan':'settle_stored_plan',source:input.expectedSource,schema:input.expectedSchema,runtime,before,startedAt:new Date().toISOString()};
    if(!options.execute){save(outputPath,{...record,completedAt:new Date().toISOString()});}
    else {
        save(beforePath,record);
        // Recheck serving identities immediately before enabling mutations. The
        // service separately guards the exact project/receipt/accounting state.
        const currentRuntime=await verifyCanvasSettlementRuntime(client,readEnv.DB,input);
        const DB=createCanvasSettlementD1Binding(client,{readOnly:false});
        const after=await apply(options.continuePlan?canvasSettlementRuntimeEnvironment(currentRuntime,DB):{DB},input);
        save(outputPath,{...record,after,completedAt:new Date().toISOString()});
    }
    console.log(JSON.stringify({ok:true,mode:record.mode,evidence:outputPath}));
} catch(error) {
    const code=/^(?:canvas_|generation_|member_|insufficient_)[a-z0-9_]{1,100}$/.test(error?.code||'')?error.code:'canvas_settlement_operator_failed';
    const failure={ok:false,code,mode:record?.mode||'not_started',...(record?{before:record.before,runtime:record.runtime}:{}),observedAt:new Date().toISOString()};
    if(outputPath&&!fs.existsSync(outputPath)){try {save(outputPath,failure);}catch{/* Never print private error details. */}}
    console.error(JSON.stringify({ok:false,code,...(outputPath?{evidence:outputPath}:{})}));process.exitCode=1;
}
