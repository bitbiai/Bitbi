import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeVoiceBrowserBridge} from './helpers/q2-runtime/voice-browser-bridge.mjs';
import {VOICE_BROWSER_SANDBOX} from './helpers/canvas-voice-native-launcher.mjs';

test('native/browser bridge permits its owned project and read-only pricing, rejecting unknown and foreign commands before Auth',async()=>{
  const projectId='a'.repeat(32),calls=[];
  const runtime={
    control:async(path,body)=>{assert.equal(path,'/canvas-voice-owner-seed');assert.equal(body.credits,10000);return Response.json({projectId,userId:'synthetic-owner'});},
    mf:{getWorker:async name=>{assert.equal(name,'q2-voice-provider');return {fetch:async()=>Response.json({})};},
      dispatchFetch:async(url,init)=>{calls.push({url,init});return Response.json({ok:true,data:{}});}},
  };
  const bridge=await createNativeVoiceBrowserBridge(runtime,{name:'synthetic',artifacts:'/private/synthetic'});
  for(const url of ['/api/account/canvas/projects/'+ 'b'.repeat(32)+'/agent/voice','/api/account/canvas/projects/'+projectId+'/agent-other','/api/admin/users'])
    await assert.rejects(()=>bridge.call('fetch',{url}),/only the synthetic owned project/);
  await assert.rejects(()=>bridge.call('fetch',{url:'/api/model-pricing',method:'POST',body:'{}'}),/only the synthetic owned project/);
  await assert.rejects(()=>bridge.call('sql',{query:'SELECT secret'}),/Unknown browser\/native fixture command/);
  assert.equal(calls.length,0,'Rejected controls never reach a Worker or provider');
  await bridge.call('fetch',{url:'/api/account/canvas/projects/'+projectId+'/agent/voice'});
  await bridge.call('fetch',{url:'/api/model-pricing'});
  assert.equal(calls.length,2);assert(calls.every(call=>call.url.startsWith('https://bitbi.ai/')));
  assert(calls.every(call=>call.init.headers.Cookie==='__Host-bitbi_session=synthetic-owner'));
});

test('Mac native child retains loopback-only kernel network boundary without browser socket permissions',()=>{
  assert.match(VOICE_BROWSER_SANDBOX,/\(deny network\*\)/);
  assert.deepEqual(VOICE_BROWSER_SANDBOX.split('\n').filter(line=>line.startsWith('(allow network')),[
    '(allow network-bind (local ip "localhost:*"))',
    '(allow network-inbound (local ip "localhost:*"))',
    '(allow network-outbound (remote ip "localhost:*"))',
  ]);
  assert(!VOICE_BROWSER_SANDBOX.includes('unix-socket'));
});
