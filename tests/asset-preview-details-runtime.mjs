import assert from 'node:assert/strict';

// Runs after the existing real queue/save fixtures, without another generation.
export async function runAssetPreviewDetailsTests(f) {
  const image = await f.sql(`SELECT i.*,j.input_r2_key FROM ai_images i JOIN member_generation_jobs j ON j.asset_id=i.id
    JOIN member_ai_usage_attempts_v2 a ON a.id=j.usage_attempt_id
    WHERE j.media_type='image' AND a.billing_status='finalized' LIMIT 1`).first();
  assert.ok(image, 'Existing native queue supplied a finalized image');
  const call = (owner, path, options={}) => f.mf.dispatchFetch('https://bitbi.ai'+path, {
    ...options, headers: { Cookie: `bitbi_session=${owner}`, Origin:'https://bitbi.ai', 'Content-Type':'application/json' },
  });
  const path = `/api/ai/images/${image.id}/details`;
  const original = JSON.parse(await (await f.bucket.get(image.input_r2_key)).text());
  const before = await f.rows('SELECT * FROM member_credit_ledger WHERE user_id=?',image.user_id);
  await f.test('asset_details_native_original_provenance_survives_real_rename_and_returns_measured_not_thumbnail_dimensions',async()=>{
    const renamed = await call(image.user_id, `/api/ai/images/${image.id}/rename`, {method:'PATCH',body:JSON.stringify({name:'A renamed display title'})});
    assert.equal(renamed.status,200);
    const response=await call(image.user_id,path);assert.equal(response.status,200);
    assert.match(response.headers.get('cache-control'),/private, no-store/);
    const {details}=await response.json();
    assert.equal(details.prompt,original.prompt);assert.notEqual(details.prompt,'A renamed display title');
    const head=await f.bucket.head(image.r2_key);
    assert.ok(Number(head.customMetadata.original_width)>0,'Real save stores measured original dimensions');
    assert.equal(details.width,Number(head.customMetadata.original_width));
    assert.equal(details.height,Number(head.customMetadata.original_height));
    assert.equal(details.mimeType,head.customMetadata.original_mime);
    assert.deepEqual(Object.keys(details).sort(),['height','mimeType','model','prompt','seed','steps','width'].sort());
  });
  await f.test('asset_details_native_ownership_and_missing_provenance_fail_closed_without_accounting_changes',async()=>{
    assert.equal((await call(image.user_id+'-other',path)).status,404);
    assert.equal((await call('no-session',path)).status,401);
    const retained=await f.bucket.get(image.input_r2_key), bytes=await retained.arrayBuffer();
    await f.bucket.delete(image.input_r2_key);
    const response=await call(image.user_id,path);assert.equal(response.status,200);
    assert.equal((await response.json()).details.prompt,null);
    await f.bucket.put(image.input_r2_key,bytes);
    assert.deepEqual(await f.rows('SELECT * FROM member_credit_ledger WHERE user_id=?',image.user_id),before);
  });
  await f.test('asset_details_native_nested_file_metadata_is_allowlisted_and_requested_dimensions_are_not_measured',async()=>{
    const file=await f.sql('SELECT * FROM ai_text_assets LIMIT 1').first();assert.ok(file);
    const metadata={model:JSON.stringify({id:'recorded-model',private_url:'https://private.invalid/secret'}),prompt:'Full original prompt',
      audio:JSON.stringify({sample_rate:44100,channels:2,bitrate:256000,actual_duration_ms:4567,requested_duration_ms:5000}),
      width:1920,height:1080,seed:0,steps:12,provider:{token:'never-return'},source_url:'private'};
    await f.sql('UPDATE ai_text_assets SET metadata_json=?,title=? WHERE id=?',JSON.stringify(metadata),'Renamed music',file.id).run();
    const response=await call(file.user_id,`/api/ai/text-assets/${file.id}/details`);assert.equal(response.status,200);
    const {details}=await response.json();
    assert.equal(details.model,'recorded-model');assert.equal(details.prompt,metadata.prompt);
    assert.equal(details.sampleRate,44100);assert.equal(details.channels,2);assert.equal(details.bitrate,256000);
    assert.equal(details.durationSeconds,4.567);assert.equal(details.requestedDurationSeconds,5);
    assert.equal(details.width,null);assert.equal(details.height,null);assert.equal(details.seed,0);
    assert.ok(!JSON.stringify(details).match(/private|token|provider|source_url/));
    assert.equal((await call(file.user_id+'-other',`/api/ai/text-assets/${file.id}/details`)).status,404);
    await f.sql('UPDATE ai_text_assets SET metadata_json=? WHERE id=?','{}',file.id).run();
    const missing=(await (await call(file.user_id,`/api/ai/text-assets/${file.id}/details`)).json()).details;
    assert.equal(missing.prompt,null);assert.equal(missing.model,null);assert.equal(missing.bitrate,null);
    await f.sql('UPDATE ai_text_assets SET metadata_json=?,title=? WHERE id=?',file.metadata_json,file.title,file.id).run();
    assert.equal(f.counters.outboundDenied,0);assert.equal(f.counters.serviceDenied,0);
  });
}
