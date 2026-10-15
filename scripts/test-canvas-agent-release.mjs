import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertCanvasAgentAiConfig,canvasAgentActivationFlags,canvasAgentFlagArguments,reviewedCanvasAgentConfigFiles,verifyCanvasAgentActivationFlags} from './lib/canvas-agent-release.mjs';
import {assertMediaAuthConfig} from './lib/media-publication.mjs';
import {backendContinuationSupported} from './lib/backend-continuation.mjs';
import {createReleasePlan,evaluateStaticDeploySafety} from './lib/release-plan.mjs';
import {loadReleaseCompatibilityContext} from './lib/release-compat.mjs';
import {activateAuthVersion,verifyAiActivation} from './lib/backend-publication.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const load=worker=>JSON.parse(fs.readFileSync(path.join(root,`workers/${worker}/wrangler.jsonc`)));
for(const worker of ['auth','ai']) {
 const after=load(worker),before=structuredClone(after);for(const key of worker==='auth'?['CANVAS_AGENT_ENABLED','ENABLE_GROK_4_7']:['ENABLE_GROK_4_7'])delete before.vars[key];
 const verify=worker==='auth'?assertMediaAuthConfig:assertCanvasAgentAiConfig;
 verify(before,after);verify(after,structuredClone(after));
 for(const value of ['false','TRUE',true,null,undefined]){const bad=structuredClone(after);bad.vars.ENABLE_GROK_4_7=value;assert.throws(()=>verify(before,bad));}
 for(const mutate of [c=>{c.vars.ARBITRARY_NEW_GATE='true';},c=>{c.vars.ENABLE_GROK_4_6='false';},c=>{c.secrets={required:['UNAPPROVED_SECRET']};},c=>{c.services=[{binding:'OUTSIDE',service:'outside'}];},c=>{c.main='src/arbitrary.js';}]){const bad=structuredClone(after);mutate(bad);assert.throws(()=>verify(before,bad));}
 const off=structuredClone(after);off.vars.ENABLE_GROK_4_7='false';verify(off,structuredClone(off));assert.throws(()=>verify(off,after),'Existing disabled config cannot be silently enabled');
 const active={id:'previous-version',resources:{bindings:[{name:'ENABLE_GROK_4_7',type:'plain_text',text:'false'}]}};
 const flags=canvasAgentActivationFlags(after,active,worker),keys=Object.keys(flags);assert.equal(flags.ENABLE_GROK_4_7.value,'false');assert.equal(flags.ENABLE_GROK_4_7.preservedFrom,active.id);
 const published={resources:{bindings:keys.map(name=>({name,type:'plain_text',text:flags[name].value}))}};
 await verifyCanvasAgentActivationFlags(flags,after,published,worker,async id=>{assert.equal(id,active.id);return active;});
 await assert.rejects(verifyCanvasAgentActivationFlags(undefined,after,published,worker,async()=>active),'New candidates need explicit flag evidence');
 await assert.rejects(verifyCanvasAgentActivationFlags(flags,after,published,worker,async()=>({...active,resources:{bindings:[]}})),'Preserved off requires real previous-version proof');
 const drift=structuredClone(published);drift.resources.bindings[0].text=drift.resources.bindings[0].text==='false'?'true':'false';
 await assert.rejects(verifyCanvasAgentActivationFlags(flags,after,drift,worker,async()=>active));
 assert.throws(()=>canvasAgentActivationFlags(after,{...active,resources:{bindings:[{name:'ENABLE_GROK_4_7',type:'secret_text'}]}},worker),'A secret can never become an admitted plain-text override');
 assert.throws(()=>canvasAgentFlagArguments({ARBITRARY:{value:'true'}}));
 await verifyCanvasAgentActivationFlags(undefined,before,{resources:{bindings:[]}},worker,async()=>{throw Error('Historical receipt has no new feature flags');});
}
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-agent-release-'));
try {
 const git=args=>execFileSync('git',args,{cwd:temporary,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const write=(file,value)=>{fs.mkdirSync(path.dirname(path.join(temporary,file)),{recursive:true});fs.writeFileSync(path.join(temporary,file),typeof value==='string'?value:JSON.stringify(value));};
 const commit=label=>{git(['add','.']);git(['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','-qm',label]);return git(['rev-parse','HEAD']);};
 git(['init','-q']);const initial=load('ai');delete initial.vars.ENABLE_GROK_4_7;write('workers/ai/wrangler.jsonc',initial);write('workers/ai/src/index.js','export default {};');const base=commit('base');
 write('workers/ai/wrangler.jsonc',load('ai'));write('workers/ai/src/routes/canvas-agent-plan.js','export const fixture=true;');const head=commit('reviewed flags');
 const source={mode:'git-diff',base,head},files=git(['diff','--name-only',`${base}...${head}`]).split('\n');
 const context={...loadReleaseCompatibilityContext(root),repoRoot:temporary};
 const plan=createReleasePlan(context,{source,changedFiles:files});assert.deepEqual(plan.reviewedCanvasAgentConfigFiles,['workers/ai/wrangler.jsonc']);assert(backendContinuationSupported(plan));
 assert.equal(evaluateStaticDeploySafety(plan,{eventName:'push'}).allowed,false);assert.equal(evaluateStaticDeploySafety(plan,{eventName:'push',dependenciesVerified:true}).allowed,true);
 assert.deepEqual(reviewedCanvasAgentConfigFiles(temporary,{mode:'explicit'},files),[]);
 assert(!backendContinuationSupported({...plan,reviewedCanvasAgentConfigFiles:[]}));
 const unsafe=load('ai');unsafe.vars.ARBITRARY='true';write('workers/ai/wrangler.jsonc',unsafe);const badHead=commit('unreviewed config');
 const badPlan=createReleasePlan(context,{source:{...source,head:badHead},changedFiles:files});assert(!backendContinuationSupported(badPlan));
 assert.deepEqual(reviewedCanvasAgentConfigFiles(temporary,{...source,head:'missing-ref'},files),[]);
 // Actual committed candidate bytes govern the decision, not a later dirty
 // working-copy edit that attempts to make a rejected source appear reviewed.
 write('workers/ai/wrangler.jsonc',load('ai'));assert.deepEqual(reviewedCanvasAgentConfigFiles(temporary,{...source,head:badHead},files),[]);
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
{
 const sha='a'.repeat(40),id='12345678-1234-1234-1234-123456789abc',commands=[];
 const config=load('auth'),flags=canvasAgentActivationFlags(config,{id:'prior',resources:{bindings:[{name:'CANVAS_AGENT_ENABLED',type:'plain_text',text:'false'}]}},'auth');
 await activateAuthVersion({sha,secretFile:'/private/synthetic.json',featureFlags:flags,assertCurrent:async()=>{},command:args=>{commands.push(args);return `Worker Version ID: ${id}`;}});
 assert(commands[0].includes('--keep-vars'));assert(commands[0].includes('CANVAS_AGENT_ENABLED:false'));assert(commands[0].includes('ENABLE_GROK_4_7:true'));
 const aiConfig=load('ai'),aiFlags=canvasAgentActivationFlags(aiConfig,{resources:{bindings:[]}},'ai');
 const receipt={sha,version:id,deployment:'synthetic-deployment',featureFlags:aiFlags};
 const version={id,annotations:{'workers/message':`bitbi-ai:${sha}`},resources:{bindings:[{name:'AI',type:'ai'},{name:'SERVICE_AUTH_REPLAY',type:'durable_object_namespace'},{name:'AI_SERVICE_AUTH_SECRET',type:'secret_text'},{name:'ENABLE_GROK_4_6',text:'true'},{name:'ENABLE_GROK_4_7',type:'plain_text',text:'true'}]}};
 const read=async endpoint=>endpoint.endsWith('/deployments')?{deployments:[{id:receipt.deployment,versions:[{version_id:id,percentage:100}]}]}:version;
 await verifyAiActivation(receipt,sha,read,aiConfig);await assert.rejects(verifyAiActivation({...receipt,featureFlags:undefined},sha,read,aiConfig));
 version.resources.bindings.pop();await assert.rejects(verifyAiActivation(receipt,sha,read,aiConfig));
}
console.log('Canvas agent release: real Git config proof, exact defaults, unknown-config rejection, preserved remote disables, upload arguments, activation drift and historical receipt controls passed.');
