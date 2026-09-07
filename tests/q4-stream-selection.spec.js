const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1.js');
const load = name => import(pathToFileURL(path.join(process.cwd(),name)).href);
const CURSOR = 'memvid.stream_repair_scan.v2';
async function fixture(run) {
  const db=new SqliteD1Database();
  try {
    applyAuthMigrations(db,{through:'0084_add_memvid_stream_upload_receipts.sql'});
    const [source,helpers]=await Promise.all([load('workers/auth/src/lib/memvid-stream-upload-receipts.js'),load('tests/helpers/q4-stream-fixture.mjs')]);
    const env={DB:db};
    async function seed(number,{ready=false,healthy=false}={}) {
      const job=await helpers.seedStreamJob(db,number);const uid=number.toString(16).padStart(32,'0');
      const at=new Date(Date.UTC(2026,0,1,0,0,number)).toISOString();
      const urls=[`https://videodelivery.net/${uid}/downloads/default.mp4`,`HTTPS://CUSTOMER-FIXTURE.CLOUDFLARESTREAM.COM/${uid}/downloads/default.mp4`];
      // Both nested and top-level fallbacks are legitimate existing contracts.
      const metadata=healthy ? (number%2 ? {provider_metadata:{download:{status:'ready',url:urls[0]}}} : {provider_metadata:{cloudflare_stream_download_status:'ready'},mp4_url:urls[1]}) : {};
      await db.prepare('UPDATE memvid_stream_previews SET status=?,stream_uid=?,provider_metadata_json=?,created_at=? WHERE id=?').bind(ready?'ready':'queued',ready?uid:null,JSON.stringify(metadata),at,job.id).run();
      return {...job,uid};
    }
    await run({db,env,source,seed});
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally {db.close();}
}
const claim=(f,options={})=>f.source.claimStreamPreviewJobs(f.env,{limit:1,repairDownloads:true,...options});
const cursor=async f=>JSON.parse((await f.db.prepare('SELECT value_json FROM app_settings WHERE key=?').bind(CURSOR).first()).value_json);

test('Q4 bounded Stream selector prioritizes queued/resumable work beyond64 healthy legacy rows',async()=>fixture(async f=>{
  for(let n=1;n<=70;n+=1)await f.seed(n,{ready:true,healthy:true});
  const queued=await f.seed(200), resumable=await f.seed(201);
  // Historical pre-fix candidate query: healthy legacy rows consumed its whole
  // LIMIT before JS readiness filtering. This countercontrol is not a product pass.
  const oldPage=await f.db.prepare(`SELECT p.* FROM memvid_stream_previews p JOIN ai_text_assets a ON a.id=p.asset_id
    LEFT JOIN memvid_stream_upload_receipts r ON r.job_id=p.id
    WHERE a.visibility='public' AND a.source_module='video' AND a.user_id=p.user_id
      AND a.r2_key=p.source_r2_key AND p.source_fingerprint IS NOT NULL
      AND ((r.job_id IS NULL AND (p.status='queued' OR (1=1 AND p.status='ready' AND p.stream_uid IS NOT NULL)))
        OR (r.retired_at IS NULL AND r.claim_expires_at<=? AND r.phase IN ('prepared','received')
          AND p.status IN ('processing','uploading','ready')))
    ORDER BY p.created_at,p.id LIMIT 8`).bind(new Date().toISOString()).all();
  const {hasReadyStreamDownloadMetadata}=await load('workers/auth/src/lib/cloudflare-stream-previews.js');
  expect(oldPage.results.filter(row=>!(row.status==='ready'&&hasReadyStreamDownloadMetadata(row.provider_metadata_json)))).toEqual([]);
  const urgent=await f.source.claimStreamPreviewJobs(f.env,{limit:2,repairDownloads:true});expect(urgent.jobs.map(j=>j.id)).toEqual([queued.id,resumable.id]);
  expect(urgent.scan).toEqual({checked:64,incomplete:true});
  const old=urgent.jobs[1];
  const permit=await f.source.beginStreamUpload(f.env,old.id,{claim_token:old.claim_token,source_fingerprint:old.source_fingerprint});
  await f.source.recordStreamUpload(f.env,old.id,{upload_token:permit.upload_token,source_fingerprint:old.source_fingerprint,stream_uid:resumable.uid});
  await f.db.prepare("UPDATE memvid_stream_upload_receipts SET claim_expires_at='2000-01-01T00:00:00Z' WHERE job_id=?").bind(resumable.id).run();
  const result=await claim(f);expect(result.jobs).toHaveLength(1);expect(result.jobs[0].id).toBe(resumable.id);expect(result.jobs[0].stream_uid).toBe(resumable.uid);
  expect(result.scan).toEqual({checked:6,incomplete:false});
  expect((await f.db.prepare('SELECT COUNT(*) AS n FROM memvid_stream_upload_receipts').first()).n).toBe(2);
}));

test('Q4 bounded repair cursor crosses healthy pages, finds missing download, wraps and revisits earlier inserts',async()=>fixture(async f=>{
  for(let n=1;n<=70;n+=1)await f.seed(n,{ready:true,healthy:true});const repair=await f.seed(71,{ready:true});
  const first=await claim(f);expect(first.jobs).toEqual([]);expect(first.scan).toEqual({checked:64,incomplete:true});
  expect(Object.keys(await cursor(f)).sort()).toEqual(['created_at','id']);
  const second=await claim(f);expect(second.jobs).toHaveLength(1);expect(second.jobs[0].id).toBe(repair.id);expect(second.jobs[0].stream_uid).toBe(repair.uid);expect(second.scan.checked).toBe(7);expect(await cursor(f)).toEqual({});
  const early=await f.seed(0,{ready:true});const third=await claim(f);expect(third.jobs[0].id).toBe(early.id);expect(third.scan.checked).toBe(64);
  expect((await f.db.prepare('SELECT COUNT(*) AS n FROM memvid_stream_upload_receipts').first()).n).toBe(2);
}));

test('Q4 advisory repair cursor store failure occurs before any job claim',async()=>fixture(async f=>{
  await f.seed(1);
  f.db.exec("CREATE TRIGGER q4_cursor_fault BEFORE INSERT ON app_settings WHEN NEW.key='memvid.stream_repair_scan.v2' BEGIN SELECT RAISE(ABORT,'synthetic repair cursor failure'); END;");
  await expect(claim(f)).rejects.toThrow('synthetic repair cursor failure');
  expect((await f.db.prepare('SELECT COUNT(*) AS n FROM memvid_stream_upload_receipts').first()).n).toBe(0);expect((await f.db.prepare('SELECT status FROM memvid_stream_previews').first()).status).toBe('queued');
  f.db.exec('DROP TRIGGER q4_cursor_fault');expect((await claim(f)).jobs).toHaveLength(1);
}));

test('Q4 malformed repair cursor is an explicit failure, never an empty success or claim permission',async()=>fixture(async f=>{
  await f.seed(1);await f.db.prepare("INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,'{broken','2026-01-01T00:00:00Z')").bind(CURSOR).run();
  await expect(claim(f)).rejects.toMatchObject({code:'stream_repair_cursor_invalid',status:503});
  expect((await f.db.prepare('SELECT COUNT(*) AS n FROM memvid_stream_upload_receipts').first()).n).toBe(0);
  // A disabled repair pass uses only urgent SQL work, not the advisory cursor.
  expect((await claim(f,{repairDownloads:false})).jobs).toHaveLength(1);
}));

test('Q4 concurrent cursor scans still grant at most one authority for a repair',async()=>fixture(async f=>{
  await f.seed(1,{ready:true});const [a,b]=await Promise.all([claim(f),claim(f)]);
  expect([...a.jobs,...b.jobs]).toHaveLength(1);expect((await f.db.prepare('SELECT COUNT(*) AS n FROM memvid_stream_upload_receipts').first()).n).toBe(1);
}));
