import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertCanvasAgentAiConfig,canvasAgentActivationFlags,canvasAgentFlagArguments,reviewedCanvasAgentConfigFiles,verifyCanvasAgentActivationFlags} from './lib/canvas-agent-release.mjs';
import {assertMediaAuthConfig} from './lib/media-publication.mjs';
import {backendContinuationSupported} from './lib/backend-continuation.mjs';
import {createReleasePlan,evaluateStaticDeploySafety} from './lib/release-plan.mjs';
import {loadReleaseCompatibilityContext} from './lib/release-compat.mjs';
import {activateAuthVersion,verifyAiActivation,assertSupportedBackendMigrations,verifyAuthPrerequisites} from './lib/backend-publication.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const load=worker=>JSON.parse(fs.readFileSync(path.join(root,`workers/${worker}/wrangler.jsonc`)));
{
 const context={...loadReleaseCompatibilityContext(root),repoRoot:root};
 const readme='workers/shared/canvas-agent/README.md',runtime='workers/shared/canvas-agent/core.mjs';
 const documentation=createReleasePlan(context,{changedFiles:[readme]});
 assert.deepEqual(documentation.impacts.validationOnlyFiles,[readme]);
 assert.deepEqual(documentation.impacts.uncategorizedFiles,[]);
 assert.deepEqual(documentation.deploySteps,[],'Policy documentation alone must not deploy runtime units');
 const combined=createReleasePlan(context,{changedFiles:[readme,runtime]});
 assert.deepEqual(combined.workerDeploys.map(step=>step.worker),['ai','auth']);
 assert(backendContinuationSupported(combined),'Documentation must not block reviewed runtime changes');
 for(const unknown of ['workers/shared/canvas-agent/unreviewed-runtime.mjs','workers/shared/canvas-agent/skills/unreviewed.md']) {
  const rejected=createReleasePlan(context,{changedFiles:[readme,runtime,unknown]});
  assert.deepEqual(rejected.impacts.uncategorizedFiles,[unknown],'Only the exact approved README gains documentation classification');
  assert(!backendContinuationSupported(rejected),'Unknown policy inputs must still block automatic backend continuation');
 }
}
if(process.argv.includes('--documentation-mapping-only')) {
 console.log('Canvas agent policy README mapping: documentation-only, reviewed runtime continuation and unknown runtime/policy rejection passed.');
 process.exit(0);
}
{
 const migration='0107_canvas_agent_autonomy.sql';
 const changedFiles=[`workers/auth/migrations/${migration}`,'config/release-compat.json',
  'workers/ai/src/index.js','workers/ai/src/routes/canvas-agent-plan.js','workers/ai/src/lib/canvas-agent-plan.js','workers/ai/src/lib/caller-policy.js',
  'workers/auth/src/lib/canvas-agent-model-operations.js','workers/auth/src/lib/canvas-agent-planning.js',
  'js/pages/canvas/agent.js','js/pages/canvas/agent-copy.js'];
 const context={...loadReleaseCompatibilityContext(root),repoRoot:root},plan=createReleasePlan(context,{changedFiles});
 // The changed migration can precede the required current schema checkpoint.
 const checkpoint=context.manifest.release.schemaCheckpoints.auth.latest;
 assert(backendContinuationSupported(plan));assertSupportedBackendMigrations([migration,checkpoint]);
 assert.deepEqual(plan.workerDeploys.map(step=>step.worker),['ai','auth']);
 assert.deepEqual(plan.deploySteps.map(step=>step.type),['schema-checkpoint','worker','worker','static']);
 assert.equal(plan.schemaApplies[0].latestMigration,checkpoint);
 assert(!plan.workerDeploys.some(step=>step.worker==='media'),'Planner repair must retain the unchanged media activation');
 assert(plan.manualPrerequisites.required.some(item=>item.name==='H3_CLOUDFLARE_API_TOKEN'&&item.worker==='auth'));
 for(const file of ['workers/ai/src/lib/generation-timeout.js','workers/ai/src/routes/unreviewed-background.js','workers/ai/wrangler.jsonc'])
  assert(!backendContinuationSupported(createReleasePlan(context,{changedFiles:[...changedFiles,file]})),'No broad AI transport/config exception');
 assert.throws(()=>assertSupportedBackendMigrations([migration,'0999_unreviewed.sql']));
 const retention=createReleasePlan(context,{changedFiles:['workers/auth/migrations/0108_canvas_creative_export_retention.sql','config/release-compat.json']});
 assert(backendContinuationSupported(retention));assertSupportedBackendMigrations(['0108_canvas_creative_export_retention.sql']);
 assert.equal(retention.schemaApplies[0].latestMigration,checkpoint);
 assert.deepEqual(retention.workerDeploys.map(step=>step.worker),['auth']);
 assert(!retention.deploySteps.some(step=>step.type==='service'),'Retention-only schema work must not redeploy the media processor');
 const dialogueFiles=['workers/shared/canvas-agent-dialogue.mjs','workers/shared/canvas-agent-actions.mjs','js/shared/canvas-agent-control-intent.mjs','workers/shared/canvas-agent/legacy/creative-briefing-v1.mjs','workers/shared/canvas-agent/core.mjs','workers/shared/canvas-agent/manifest.mjs',
  ...['creative-briefing','conversation-actions','story-and-continuity','model-selection','canvas-editing','generation-and-recovery','review-and-export'].map(name=>`workers/shared/canvas-agent/skills/${name}.mjs`)];
 for(const file of dialogueFiles) {
  const policyPlan=createReleasePlan(context,{changedFiles:[file]});
  assert.deepEqual(policyPlan.workerDeploys.map(step=>step.worker),['ai','auth'],`${file} is runtime input to both signed reasoning and accounting`);
  assert.equal(policyPlan.impacts.uncategorizedFiles.length,0);
  assert(backendContinuationSupported(policyPlan));
 }
 const dialogue=createReleasePlan(context,{changedFiles:[...dialogueFiles,'workers/ai/src/lib/canvas-agent-dialogue.js',
  'workers/auth/migrations/0109_canvas_agent_conversations.sql','workers/auth/migrations/0110_canvas_agent_conversation_actions.sql','workers/auth/src/routes/canvas-agent-conversation.js','config/release-compat.json','js/pages/canvas/agent.js']});
 assert(backendContinuationSupported(dialogue));assertSupportedBackendMigrations(['0109_canvas_agent_conversations.sql','0110_canvas_agent_conversation_actions.sql']);
 assert.deepEqual(dialogue.workerDeploys.map(step=>step.worker),['ai','auth']);
 assert.deepEqual(dialogue.deploySteps.map(step=>step.type),['schema-checkpoint','worker','worker','static']);
 assert.equal(dialogue.schemaApplies[0].latestMigration,checkpoint);
 assert(!backendContinuationSupported(createReleasePlan(context,{changedFiles:[...dialogue.changedFiles,'workers/ai/src/lib/arbitrary-chat.js']})),'Unreviewed AI modules remain blocked');
 assert(createReleasePlan(context,{changedFiles:['workers/shared/unapproved-agent/manifest.mjs']}).impacts.uncategorizedFiles.length>0,'Unapproved policy directories do not gain deployment authority');
 const creative=createReleasePlan(context,{changedFiles:[...changedFiles,'services/homepage-ffmpeg-processor/canvas-assembly-contract.mjs','workers/auth/src/lib/canvas-export-recipes.js']});
 assert(backendContinuationSupported(creative));
 assert.deepEqual(creative.workerDeploys.map(step=>step.worker),['ai','media','auth']);
 assert(creative.deploySteps.some(step=>step.type==='service'&&step.service==='homepage-ffmpeg-processor'));
 assert.equal(creative.schemaApplies[0].latestMigration,checkpoint);
}
for(const worker of ['auth','ai']) {
 const after=load(worker),before=structuredClone(after);for(const key of worker==='auth'?['CANVAS_AGENT_ENABLED','ENABLE_GROK_4_7','CANVAS_VOICE_ENABLED']:['ENABLE_GROK_4_7'])delete before.vars[key];
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
 assert(commands[0].includes('--keep-vars'));assert(commands[0].includes('CANVAS_AGENT_ENABLED:false'));assert(commands[0].includes('ENABLE_GROK_4_7:true'));assert(commands[0].includes('CANVAS_VOICE_ENABLED:true'));
 const disabled={id:'voice-kill-version',resources:{bindings:[{name:'CANVAS_VOICE_ENABLED',type:'plain_text',text:'false'}]}};
 const offFlags=canvasAgentActivationFlags(config,disabled,'auth');assert.equal(offFlags.CANVAS_VOICE_ENABLED.value,'false');assert.equal(offFlags.CANVAS_VOICE_ENABLED.preservedFrom,disabled.id);
 const published={resources:{bindings:Object.entries(offFlags).map(([name,setting])=>({name,type:'plain_text',text:setting.value}))}};
 await verifyCanvasAgentActivationFlags(offFlags,config,published,'auth',async()=>disabled);
 const unexpected=structuredClone(published);unexpected.resources.bindings.find(binding=>binding.name==='CANVAS_VOICE_ENABLED').text='true';
 await assert.rejects(()=>verifyCanvasAgentActivationFlags(offFlags,config,unexpected,'auth',async()=>disabled),'Active Voice enable cannot override preserved kill-switch evidence');
 const voicePlan=createReleasePlan({...loadReleaseCompatibilityContext(root),repoRoot:root},{changedFiles:['workers/auth/src/lib/canvas-voice-accounting.js','workers/auth/migrations/0119_canvas_voice_sessions.sql','workers/auth/wrangler.jsonc','config/release-compat.json','js/pages/canvas/voice.js']});
 assert(backendContinuationSupported(voicePlan));assert.deepEqual(voicePlan.workerDeploys.map(step=>step.worker),['auth']);
 assert.deepEqual(voicePlan.deploySteps.map(step=>step.type),['schema-checkpoint','worker','static']);
 const prerequisite=voicePlan.manualPrerequisites.required.find(item=>item.id==='auth-xai-voice-api-key');assert(prerequisite&&prerequisite.name==='XAI_API_KEY'&&prerequisite.worker==='auth');
 const prerequisitePlan={manualPrerequisites:{required:[prerequisite]}},secrets=['XAI_API_KEY','MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET','GITHUB_ACTIONS_DISPATCH_TOKEN'];
 const active={resources:{bindings:secrets.map(name=>({name,type:'secret_text'}))}};verifyAuthPrerequisites(prerequisitePlan,active,{vars:{}},false);
 assert.throws(()=>verifyAuthPrerequisites(prerequisitePlan,{resources:{bindings:active.resources.bindings.filter(binding=>binding.name!=='XAI_API_KEY')}},{vars:{}},false),'Missing Voice credential blocks protected activation');
 assert.throws(()=>verifyAuthPrerequisites(prerequisitePlan,{resources:{bindings:active.resources.bindings.map(binding=>binding.name==='XAI_API_KEY'?{...binding,type:'plain_text'}:binding)}},{vars:{}},false),'A public variable is not a Voice secret');
 const aiConfig=load('ai'),aiFlags=canvasAgentActivationFlags(aiConfig,{resources:{bindings:[]}},'ai');
 const receipt={sha,version:id,deployment:'synthetic-deployment',featureFlags:aiFlags};
 const version={id,annotations:{'workers/message':`bitbi-ai:${sha}`},resources:{bindings:[{name:'AI',type:'ai'},{name:'SERVICE_AUTH_REPLAY',type:'durable_object_namespace'},{name:'AI_SERVICE_AUTH_SECRET',type:'secret_text'},{name:'ENABLE_GROK_4_6',text:'true'},{name:'ENABLE_GROK_4_7',type:'plain_text',text:'true'}]}};
 const read=async endpoint=>endpoint.endsWith('/deployments')?{deployments:[{id:receipt.deployment,versions:[{version_id:id,percentage:100}]}]}:version;
 await verifyAiActivation(receipt,sha,read,aiConfig);await assert.rejects(verifyAiActivation({...receipt,featureFlags:undefined},sha,read,aiConfig));
 version.resources.bindings.pop();await assert.rejects(verifyAiActivation(receipt,sha,read,aiConfig));
}
console.log('Canvas agent release: real Git config proof, exact defaults, unknown-config rejection, preserved remote disables, upload arguments, activation drift and historical receipt controls passed.');
