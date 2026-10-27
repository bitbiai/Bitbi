import {CANVAS_VOICE_OWNER_LIFECYCLE_CASES,runCanvasVoiceOwnerLifecycleTest} from './voice-owner-lifecycle.mjs';
import {CANVAS_VOICE_ACCOUNTING_CASES} from '../canvas-voice-accounting-control.mjs';
import {runCanvasVoiceOwnerTest} from './voice-owner.mjs';
import assert from 'node:assert/strict';
import {CANVAS_VOICE_CONVERSATION_CASES} from '../canvas-voice-conversation-control.mjs';
import {CANVAS_VOICE_SETTINGS_CASES} from '../canvas-voice-settings-control.mjs';

export const canvasVoiceInventory=Object.freeze(['canvas_voice_empty_migration','canvas_voice_populated_migration',
 ...CANVAS_VOICE_CONVERSATION_CASES.map(name=>'canvas_voice_conversation_'+name),
 ...CANVAS_VOICE_SETTINGS_CASES.map(name=>'canvas_voice_settings_'+name),'canvas_voice_authenticated_routes',...CANVAS_VOICE_ACCOUNTING_CASES.map(name=>'canvas_voice_accounting_'+name),'canvas_voice_native_owner',...CANVAS_VOICE_OWNER_LIFECYCLE_CASES.map(name=>'canvas_voice_owner_'+name)]);
async function control(f,path,body){const response=await f.control(path,body);assert.equal(response.status,200,await response.clone().text());return response.json();}
export async function runCanvasVoiceTests(f){
 await f.test('canvas_voice_empty_migration',async()=>{
  assert(f.imageDb,'Use the existing isolated native auxiliary D1 database');
  for(const migration of f.migrations)await f.imageDb.batch(migration.statements.map(sql=>f.imageDb.prepare(sql)));
  for(const table of ['canvas_voice_settings','canvas_voice_sessions','canvas_voice_turns','canvas_voice_calls'])assert.equal((await f.imageDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,0);
  assert.deepEqual((await f.imageDb.prepare('PRAGMA foreign_key_check').all()).results,[]);
 });
 let snapshot;
 for(const migration of f.migrations){
  if(migration.path.startsWith('0119'))snapshot=await control(f,'/canvas-voice-migration-seed',{});
  await f.db.batch(migration.statements.map(sql=>f.db.prepare(sql)));
 }
 await f.test('canvas_voice_populated_migration',async()=>{
  assert(snapshot,'Exercise the actual populated 0119 boundary');
  assert.deepEqual(await control(f,'/canvas-voice-migration-verify',snapshot),{preserved:true});
  await assert.rejects(()=>control(f,'/canvas-voice-migration-verify',{...snapshot,snapshot:'{}'}),/0119 preserves existing/);
 });
 for(const name of CANVAS_VOICE_CONVERSATION_CASES)await f.test('canvas_voice_conversation_'+name,async()=>{
  assert.deepEqual(await control(f,'/canvas-voice-conversation',{name}),{case:name,inferenceCalls:0,productionActions:0});
 });
 for(const name of CANVAS_VOICE_SETTINGS_CASES)await f.test('canvas_voice_settings_'+name,async()=>{
  assert.deepEqual(await control(f,'/canvas-voice-settings',{name}),{case:name,providerCalls:0});
 });
 await f.test('canvas_voice_authenticated_routes',async()=>{
  assert.deepEqual(await control(f,'/canvas-voice-routes',{}),{case:'routes',providerCalls:0});
 });
 for(const name of CANVAS_VOICE_ACCOUNTING_CASES)await f.test('canvas_voice_accounting_'+name,async()=>{
  assert.deepEqual(await control(f,'/canvas-voice-accounting',{name}),{case:name,providerCalls:0});
 });
 await f.test('canvas_voice_native_owner',()=>runCanvasVoiceOwnerTest(f));
 for(const name of CANVAS_VOICE_OWNER_LIFECYCLE_CASES)await f.test('canvas_voice_owner_'+name,()=>runCanvasVoiceOwnerLifecycleTest(f,name));
 assert.equal(f.canvasProvider.requests.length,0,'Conversation and settings never call a paid provider');
}
