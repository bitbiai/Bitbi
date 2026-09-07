import assert from 'node:assert/strict';

export async function runPublicVideoTests(f) {
  const { db, sql, bucket, migrations, mf, test } = f;
  for (const m of migrations) await db.batch(m.statements.map(s => db.prepare(s)));
  const bytes = new Uint8Array(Array.from({length:32}, (_,i)=>i));
  const now = '2026-09-07T12:00:00.000Z', id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  await sql("INSERT INTO users(id,email,password_hash,created_at,role,status) VALUES('video-user','video@example.invalid','synthetic',?,'user','active')",now).run();
  await sql(`INSERT INTO ai_text_assets(id,user_id,title,file_name,mime_type,size_bytes,source_module,r2_key,created_at,visibility)
    VALUES (?,'video-user','Synthetic','synthetic.mp4','video/mp4',32,'video','public-video',?,'public')`,id,now).run();
  await sql(`INSERT INTO homepage_hero_video_derivatives(id,slot,source_type,source_asset_id,provider,status,version,file_r2_key,file_mime_type,created_at,updated_at)
    VALUES('video-derivative','left_top','public',?,'mock','succeeded','range-v1','hero-video','video/mp4',?,?)`,id,now,now).run();
  await sql("UPDATE homepage_hero_video_slots SET enabled=1,derivative_id='video-derivative' WHERE slot='left_top'").run();
  for (const key of ['public-video','hero-video']) await bucket.put(key,bytes,{httpMetadata:{contentType:'video/mp4'}});
  const worker=await mf.getWorker('q2-candidate'); let call=0;
  const get=(path,headers={},method='GET')=>worker.fetch('https://bitbi.ai'+path,{method,redirect:'manual',headers:{'CF-Connecting-IP':`192.0.2.${++call}`,...headers}});
  const alias=await get(`/api/gallery/memvids/${id}/file`);assert.equal(alias.status,302);
  const paths=[new URL(alias.headers.get('location'),'https://bitbi.ai').pathname,'/api/homepage/hero-videos/left_top/range-v1/file'];
  await test('q4_public_video_actual_handlers_stream_full_and_partial_R2_bytes_with_exact_headers',async()=>{
    for(const path of paths){
      assert.equal((await get(path, { Range:'bytes=0-1' }, 'HEAD')).status,404, 'Existing GET-only route policy remains unchanged');
      const full=await get(path);assert.equal(full.status,200);assert.equal(full.headers.get('accept-ranges'),'bytes');
      assert.equal(full.headers.get('content-length'),'32');assert.equal(full.headers.get('cache-control'),'public, max-age=31536000, immutable');
      assert.deepEqual(new Uint8Array(await full.arrayBuffer()),bytes);
      const etag=full.headers.get('etag');assert.ok(etag);
      for(const [range,offset,length] of [['bytes=2-6',2,5],['bytes=30-',30,2],['bytes=-3',29,3],['bytes=0-999',0,32]]){
        const partial=await get(path,{Range:range});assert.equal(partial.status,206);
        assert.equal(partial.headers.get('content-range'),`bytes ${offset}-${offset+length-1}/32`);
        assert.equal(partial.headers.get('content-length'),String(length));assert.equal(partial.headers.get('etag'),etag);
        assert.deepEqual(new Uint8Array(await partial.arrayBuffer()),bytes.slice(offset,offset+length));
      }
      for(const range of ['bytes=32-','bytes=-0','bytes=8-2']){
        const no=await get(path,{Range:range});assert.equal(no.status,416);assert.equal(no.headers.get('content-range'),'bytes */32');await no.arrayBuffer();
      }
      for(const range of ['items=0-1','bytes=bad','bytes=0-1,4-5']){
        const ignored=await get(path,{Range:range});assert.equal(ignored.status,200);assert.deepEqual(new Uint8Array(await ignored.arrayBuffer()),bytes);
      }
      const stale=await get(path,{Range:'bytes=2-6','If-Range':'"other"'});assert.equal(stale.status,200);await stale.arrayBuffer();
      const current=await get(path,{Range:'bytes=2-6','If-Range':etag});assert.equal(current.status,206);await current.arrayBuffer();
    }
  });
  await test('q4_public_video_ranges_do_not_bypass_publication_version_or_missing_object_gates',async()=>{
    await sql("UPDATE ai_text_assets SET visibility='private' WHERE id=?",id).run();
    assert.equal((await get(paths[0],{Range:'bytes=0-1'})).status,404);
    await sql("UPDATE homepage_hero_video_slots SET enabled=0 WHERE slot='left_top'").run();
    assert.equal((await get(paths[1],{Range:'bytes=0-1'})).status,404);
    await sql("UPDATE homepage_hero_video_slots SET enabled=1 WHERE slot='left_top'").run();
    assert.equal((await get(paths[1].replace('range-v1','other'),{Range:'bytes=0-1'})).status,404);
    await bucket.delete('hero-video');assert.equal((await get(paths[1],{Range:'bytes=0-1'})).status,404);
    const metadata=await bucket.head('public-video');
    await bucket.put('public-video',new Uint8Array([9,8,7]));
    const raced=await bucket.get('public-video',{range:{offset:0,length:2},onlyIf:{etagMatches:metadata.etag}});
    assert.ok(raced && !('body' in raced), 'Native R2 generation condition must not return replacement bytes');
    assert.equal(f.counters.outboundDenied,0);
  });
}
