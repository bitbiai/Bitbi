import assert from 'node:assert/strict';
import fs from 'node:fs';
export async function runMemberGenerationTests(f) {
  for (const migration of f.migrations) {
    try { await f.db.batch(migration.statements.map(sql=>f.db.prepare(sql))); }
    catch(error) { throw new Error(`${migration.path}: ${error.message}`); }
  }
  const fixture={imageBase64:fs.readFileSync(new URL('./fixtures/media/member-image.png',import.meta.url)).toString('base64'),videoBase64:fs.readFileSync(new URL('./fixtures/media/test-video-changing.mp4',import.meta.url)).toString('base64'),posterBase64:fs.readFileSync(new URL('./fixtures/media/member-video-poster.webp',import.meta.url)).toString('base64')};
  for(const name of ['clock-lease-expired','clock-credit-expired','clock-finalization-expired','closed-browser','execution-exhausted','poster-retry','stale-poster','insert-response-lost','provider-unknown','music-failed','image','music','music-cover-retry','debit-response-lost','unpublished-asset','finalization-response-lost','storage-restart']) {
    await f.test(`member_generation_actual_queue_${name}`,async()=>{
      const response=await f.control('/member-generation',{name,...fixture});
      assert.equal(response.status,200,`Native member generation case ${name}`);
      const result=await response.json();
      assert.equal(result.calls.provider,name==='execution-exhausted'?0:name.startsWith('music') && name!=='music-failed'?2:1);
      assert.equal(result.status,['provider-unknown','clock-credit-expired'].includes(name)?'outcome_unknown':['music-failed','execution-exhausted'].includes(name)?'failed':'succeeded');
      assert.deepEqual(await f.rows('PRAGMA foreign_key_check'),[]);
      assert.equal(f.counters.outboundDenied,0);
      assert.equal(f.counters.serviceDenied,0);
      f.metrics.push(result);
    });
  }
}
