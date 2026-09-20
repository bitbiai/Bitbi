import assert from 'node:assert/strict';
import fs from 'node:fs';
import {expectNativeRejection} from './helpers/q2-runtime/assertions.mjs';
import {getMemberExposedModels} from '../js/shared/member-model-exposure.mjs';
export async function runMemberGenerationTests(f) {
  for (const migration of f.migrations) {
    try {
      if(migration.path.startsWith('0092_')) await f.test('member_generation_0092_populated_transition_preserves_accepted_job',async()=>{
        const now=new Date().toISOString(),id='migration-0092-fixture';
        await f.sql("INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)",id,id+'@example.invalid','synthetic',now).run();
        await f.sql("INSERT INTO member_ai_usage_attempts_v2(id,user_id,feature_key,operation_key,route,idempotency_key,request_fingerprint,credit_cost,created_at,updated_at,expires_at) VALUES(?,?,'ai.video.generate','member.video.generate','/api/ai/generate-video',?,'synthetic',1,?,?,?)",id,id,id,now,now,'2099-01-01').run();
        await f.sql("INSERT INTO member_generation_jobs(id,user_id,usage_attempt_id,media_type,request_key,input_r2_key,next_attempt_at,created_at,updated_at) VALUES(?,?,?,'video',?,'synthetic/accepted-input',?,?,?)",id,id,id,id,'2099-01-01',now,now).run();
        const before=await f.rows('SELECT * FROM member_generation_jobs WHERE id=?',id);
        await assert.rejects(f.db.batch([...migration.statements.map(sql=>f.db.prepare(sql)),f.db.prepare('INSERT INTO member_generation_jobs(id) VALUES(NULL)')]));
        assert.deepEqual(await f.rows('SELECT * FROM member_generation_jobs WHERE id=?',id),before);
        await f.db.batch(migration.statements.map(sql=>f.db.prepare(sql)));
        const after=await f.rows('SELECT * FROM member_generation_jobs WHERE id=?',id);
        assert.equal(after[0].source_refs_json,'[]');assert.deepEqual(after.map(({source_refs_json,...job})=>job),before);
        await expectNativeRejection(()=>f.sql("UPDATE member_generation_jobs SET source_refs_json='[{\"r2_key\":\"foreign\"}]' WHERE id=?",id).run(),'generation source identity is immutable');
        await f.sql("INSERT INTO r2_object_tombstones(r2_key,retired_at) VALUES('synthetic/retired-source',?)",now).run();
        await expectNativeRejection(()=>f.sql("INSERT INTO member_generation_jobs(id,user_id,usage_attempt_id,media_type,request_key,input_r2_key,next_attempt_at,created_at,updated_at,source_refs_json) VALUES(?,?,?,'video',?,'synthetic/accepted-input',?,?,?,'[{\"r2_key\":\"synthetic/retired-source\"}]')",id,id,id,id,'2099-01-01',now,now).run(),'r2_object_key_retired');
        assert.deepEqual(await f.rows('PRAGMA foreign_key_check'),[]);
      });
      else await f.db.batch(migration.statements.map(sql=>f.db.prepare(sql)));
    }
    catch(error) { throw new Error(`${migration.path}: ${error.message}`); }
  }
  assert.deepEqual(JSON.parse((await f.sql("SELECT value_json FROM app_settings WHERE key='private_media_service'").first()).value_json),{backend:'github',thumbnailBackend:'github'});
  const fixture={h3VideoBase64:fs.readFileSync(new URL('./fixtures/media/h3-reference.mp4',import.meta.url)).toString('base64'),h3ImageBase64:fs.readFileSync(new URL('./fixtures/media/h3-frame.png',import.meta.url)).toString('base64'),imageBase64:fs.readFileSync(new URL('./fixtures/media/member-image.png',import.meta.url)).toString('base64'),videoBase64:fs.readFileSync(new URL('./fixtures/media/test-video-changing.mp4',import.meta.url)).toString('base64'),posterBase64:fs.readFileSync(new URL('./fixtures/media/member-video-poster.webp',import.meta.url)).toString('base64')};
  const grokCases = ['base','preview'].flatMap(alias=>['generate','edit','extend'].map(operation=>({name:`admin-lab-grok-${alias}-${operation}`,kind:'video',input:{model:alias==='base'?'xai/grok-imagine-video':'xai/grok-imagine-video-1.5-preview',prompt:'Synthetic motion',_operation:operation,duration:2,resolution:'480p'}})));
  const h3Cases=['h3-callback','h3-callback-failed','h3-failed','h3-output-usage','h3-references'].map(name=>({name,kind:'video',input:{model:'minimax/h3',prompt:'Synthetic H3 motion',duration:5,resolution:'768P'}}));
  const catalogCases=getMemberExposedModels().filter(m=>!['pixverse/v6','minimax/music-2.6','xai/grok-imagine-video','xai/grok-imagine-video-1.5-preview'].includes(m.id)).map((m,i)=>({name:`admin-lab-catalog-${i}`,kind:m.mediaType,input:{model:m.id,prompt:'Synthetic catalog request'}}));
  for(const name of ['admin-lab-image','admin-lab-music','admin-lab-video','asset-naming-video','asset-naming-manual','asset-naming-image','asset-naming-music','asset-naming-image-manual','asset-naming-music-manual','clock-lease-expired','clock-credit-expired','clock-finalization-expired','closed-browser','execution-exhausted','poster-retry','stale-poster','insert-response-lost','provider-unknown','music-failed','image','music','music-cover-retry','debit-response-lost','unpublished-asset','finalization-response-lost','storage-restart',...[...grokCases,...catalogCases,...h3Cases].map(c=>c.name)]) {
    await f.test(`member_generation_actual_queue_${name}`,async()=>{
      const response=await f.control('/member-generation',{name,...fixture,...([...grokCases,...catalogCases,...h3Cases].find(c=>c.name===name)||{})});
      assert.equal(response.status,200,`Native member generation case ${name}`);
      const result=await response.json();
      const blocked=name.startsWith('admin-lab-grok-') && /-(edit|extend)$/.test(name);
      assert.equal(result.calls.provider,blocked||name==='execution-exhausted'?0:(name.startsWith('music') || name.startsWith('asset-naming-music') || name==='admin-lab-music') && name!=='music-failed'?2:1);
      assert.equal(result.status,blocked?'billing_unverified':['provider-unknown','clock-credit-expired'].includes(name)?'outcome_unknown':['music-failed','h3-failed','h3-callback-failed','execution-exhausted'].includes(name)?'failed':'succeeded');
      assert.deepEqual(await f.rows('PRAGMA foreign_key_check'),[]);
      assert.equal(f.counters.outboundDenied,0);
      assert.equal(f.counters.serviceDenied,0);
      f.metrics.push(result);
    });
  }
}
