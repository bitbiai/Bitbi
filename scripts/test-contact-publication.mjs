import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {publishContact,verifyContactReceipt} from './lib/contact-publication.mjs';

const original=process.cwd(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'bitbi-contact-publication-'));
const config=JSON.parse(fs.readFileSync('workers/contact/wrangler.jsonc'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const bundle='export default {fetch(){return new Response("synthetic contact");}};';
const oldId='11111111-1111-1111-1111-111111111111',newId='22222222-2222-2222-2222-222222222222';
let assertions=0;
try {
  process.chdir(directory);
  const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','-q']);git(['config','user.name','Synthetic release fixture']);git(['config','user.email','synthetic@example.test']);
  fs.mkdirSync('workers/contact/src',{recursive:true});fs.writeFileSync('workers/contact/wrangler.jsonc',JSON.stringify(config));
  fs.writeFileSync('workers/contact/src/index.js','export default {};');git(['add','.']);git(['commit','-qm','Synthetic existing service']);
  const base=git(['rev-parse','HEAD']);
  fs.writeFileSync('workers/contact/src/index.js',bundle);git(['add','.']);git(['commit','-qm','Synthetic reviewed Contact candidate']);
  const sha=git(['rev-parse','HEAD']);
  const contact={worker:'contact',workerName:'bitbi-contact',wranglerPath:'workers/contact/wrangler.jsonc'};
  const c={sha,base,runId:'42',attempt:'1',plan:{workerDeploys:[contact]}};
  function fixture() {
    const value={commands:[],currentChecks:[],verified:[],activeId:oldId,uploaded:null,
      routes:[{id:'route-1',pattern:'contact.bitbi.ai/*',script:'bitbi-contact'}],
      domains:[{id:'domain-1',hostname:'contact.bitbi.ai',service:'bitbi-contact',environment:'production',zone_id:'zone-1',enabled:true,previews_enabled:false}],
      subdomain:{enabled:false,previews_enabled:false},
      version:{id:oldId,annotations:{'workers/message':'previous Contact'},resources:{
        script_runtime:{migration_tag:'v1-public-rate-limiter',compatibility_date:'2026-03-08',usage_model:'standard'},bindings:[
          {name:'BITBI_ENV',type:'plain_text',text:'production'},
          {name:'PUBLIC_RATE_LIMITER',type:'durable_object_namespace',class_name:'ContactPublicRateLimiterDurableObject',namespace_id:'a'.repeat(32)},
          {name:'RESEND_API_KEY',type:'secret_text'}]}}};
    value.deps={directory:path.join(directory,'bundle'),
      current:async actual=>{assert.equal(actual,sha);value.currentChecks.push(actual);if(value.currentFailure)throw Error('Superseded candidate');},
      read:async endpoint=>{
        if(value.readFailure)throw Error('Read unavailable');
        const root='workers/scripts/bitbi-contact';
        if(endpoint===`${root}/deployments`)return {deployments:[{id:`deployment-${value.activeId}`,versions:value.splitTraffic?[{version_id:oldId,percentage:50},{version_id:newId,percentage:50}]:[{version_id:value.activeId,percentage:100}]}]};
        if(endpoint===`${root}/versions/${value.activeId}`)return structuredClone(value.activeId===oldId?value.version:value.uploaded);
        if(endpoint===`${root}/versions/${newId}`&&value.uploaded)return structuredClone(value.uploaded);
        if(endpoint===`${root}/routes`)return structuredClone(value.routes);
        if(endpoint===`${root}/subdomain`)return structuredClone(value.subdomain);
        if(endpoint==='workers/domains?service=bitbi-contact')return structuredClone(value.domains);
        throw Error(`Unexpected provider read: ${endpoint}`);
      },
      command:async args=>{
        value.commands.push(args);
        if(args.includes('--dry-run')){fs.mkdirSync(value.deps.directory,{recursive:true});fs.writeFileSync(path.join(value.deps.directory,'index.js'),bundle);return '';}
        if(args[1]==='upload'){
          if(value.uploadFailure)throw Error('Upload response unavailable');
          value.uploaded=structuredClone(value.version);value.uploaded.id=newId;value.uploaded.annotations={'workers/message':`bitbi-contact:${sha}`};
          if(value.replaceNamespace)value.uploaded.resources.bindings[1].namespace_id='b'.repeat(32);
          return `Worker Version ID: ${newId}`;
        }
        assert.deepEqual(args,['versions','deploy',`${newId}@100%`,'--yes','--message',`bitbi-contact:${sha}`]);
        if(value.deployFailure&&!value.lostAcknowledgement)throw Error('Deploy rejected');
        value.activeId=newId;
        if(value.triggerDrift)value.domains[0].service='unrelated-worker';
        if(value.lostAcknowledgement)throw Error('Deploy acknowledgement lost');
        return '';
      },
      verifyBundle:async (hash,_reader,worker)=>{assert.equal(worker,'bitbi-contact');assert.equal(hash,digest(bundle));value.verified.push(hash);if(value.badBundle)throw Error('Active bundle differs');},
    };
    return value;
  }
  async function rejectSetup(change,pattern) {
    const f=fixture();change(f);await assert.rejects(()=>publishContact(c,f.deps),pattern);assert.equal(f.commands.filter(a=>!a.includes('--dry-run')).length,0);assertions++;
  }
  const f=fixture(),receipt=await publishContact(c,f.deps);
  assert.deepEqual(f.commands.map(a=>a.slice(0,2)),[['versions','upload'],['versions','upload'],['versions','deploy']]);
  assert.equal(receipt.sourceTree,git(['rev-parse',`${sha}:workers/contact`]));assert.equal(receipt.configDigest,digest(JSON.stringify(config)));
  assert.equal(receipt.version,newId);assert.equal(receipt.run,'42');assert.equal(receipt.attempt,'1');assert.equal(f.currentChecks.length,3);assertions++;
  const before=f.commands.length;await publishContact(c,f.deps);assert.equal(f.commands.length,before+1);assert(f.commands.at(-1).includes('--dry-run'));assertions++;
  await verifyContactReceipt(receipt,c,f.deps);assertions++;
  const combined=fixture();await publishContact({...c,plan:{workerDeploys:[{worker:'auth'},contact]}},combined.deps);assert.equal(combined.activeId,newId);assertions++;
  for(const [key,value] of Object.entries({sha:base,base:sha,run:'43',attempt:'2',worker:'unrelated-worker',version:oldId,deployment:'wrong',sourceTree:'0'.repeat(40),configDigest:'0'.repeat(64),bundleDigest:''})) {
    await assert.rejects(()=>verifyContactReceipt({...receipt,[key]:value},c,f.deps));assertions++;
  }
  await assert.rejects(()=>verifyContactReceipt(undefined,c,f.deps));assertions++;
  for(const change of [x=>({...x,sha:'bad'}),x=>({...x,runId:undefined}),x=>({...x,plan:{workerDeploys:[]}}),x=>({...x,plan:{workerDeploys:[{...contact,workerName:'other'}]}})]) {
    const invalid=fixture();await assert.rejects(()=>publishContact(change(c),invalid.deps));assert.equal(invalid.commands.length,0);assertions++;
  }
  await rejectSetup(f=>{f.version.resources.bindings.pop();},/bindings/);
  await rejectSetup(f=>{f.version.resources.bindings[1].namespace_id='';},/namespace/);
  await rejectSetup(f=>{f.version.resources.script_runtime.migration_tag='unknown';},/migration/);
  await rejectSetup(f=>{f.version.resources.bindings[0].text='staging';},/environment/);
  await rejectSetup(f=>{f.domains[0].service='foreign';},/equal/);
  await rejectSetup(f=>{f.domains[0].enabled=false;},/disabled/);
  await rejectSetup(f=>{f.routes[0].pattern='*.bitbi.ai/*';},/routes/);
  await rejectSetup(f=>{f.subdomain.enabled=true;},/workers.dev/);
  await rejectSetup(f=>{f.splitTraffic=true;},/traffic/);
  await rejectSetup(f=>{f.currentFailure=true;},/Superseded/);
  await rejectSetup(f=>{f.readFailure=true;},/unavailable/);
  for(const failure of ['uploadFailure','deployFailure','replaceNamespace','triggerDrift','badBundle']) {
    const broken=fixture();broken[failure]=true;await assert.rejects(()=>publishContact(c,broken.deps));
    assert(broken.commands.filter(a=>!a.includes('--dry-run')).length<=2,'No mutation retry after failure');assert.equal(broken.commands.filter(a=>a[1]==='upload'&&!a.includes('--dry-run')).length,1);assertions++;
  }
  const lost=fixture();lost.lostAcknowledgement=true;await assert.rejects(()=>publishContact(c,lost.deps),/acknowledgement lost/);
  lost.lostAcknowledgement=false;const recovered=await publishContact(c,lost.deps);assert.equal(recovered.version,newId);
  assert.equal(lost.commands.filter(a=>a[1]==='upload'&&!a.includes('--dry-run')).length,1);assert.equal(lost.commands.filter(a=>a[1]==='deploy').length,1);assertions++;
  fs.writeFileSync('workers/contact/wrangler.jsonc',JSON.stringify({...config,workers_dev:true}));
  const dirty=fixture();await assert.rejects(()=>publishContact(c,dirty.deps),/differs from candidate/);assert.equal(dirty.commands.length,0);assertions++;
  git(['add','.']);git(['commit','-qm','Unreviewed config']);
  await assert.rejects(()=>publishContact({...c,sha:git(['rev-parse','HEAD'])},fixture().deps),/config changes require separate review/);assertions++;
  console.log(`Contact publication: ${assertions} passed synthetic boundary checks; no remote mutations.`);
} finally {process.chdir(original);fs.rmSync(directory,{recursive:true,force:true});}
