import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createReleasePlanFromRepo} from './lib/release-plan.mjs';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

{
 const {assertMediaAuthConfig}=await import('./lib/media-publication.mjs');
 const before=JSON.parse(fs.readFileSync(path.join(repoRoot,'workers/auth/wrangler.jsonc')));
 const after=structuredClone(before);delete before.vars.PRIVATE_MEDIA_SOURCE_SHA;before.services=before.services.filter(s=>s.binding!=='PRIVATE_MEDIA_PROCESSOR');before.secrets.required=before.secrets.required.filter(s=>s!=='PRIVATE_MEDIA_PROCESSOR_SECRET');
 // The original fixture cloned the current config on both sides, so it never
 // exercised introduction of the disabled assistant gate from the live baseline.
 delete before.vars.WEBSITE_ASSISTANT_ENABLED;
 const originalBefore=structuredClone(before),originalAfter=structuredClone(after);
 assertMediaAuthConfig(before,after);
 assert.deepEqual(before,originalBefore);assert.deepEqual(after,originalAfter);
 assertMediaAuthConfig(after,structuredClone(after));
 const historical=structuredClone(after);delete historical.vars.WEBSITE_ASSISTANT_ENABLED;
 assertMediaAuthConfig(before,historical);
 assert.throws(()=>assertMediaAuthConfig(after,historical),/explicitly disabled inference/,'Removing the explicit off switch is not this reviewed change');
 for(const value of ['true','TRUE','False','0','',true,false,null,undefined]) {
  const invalid=structuredClone(after);invalid.vars.WEBSITE_ASSISTANT_ENABLED=value;
  assert.throws(()=>assertMediaAuthConfig(before,invalid),/explicitly disabled inference/,'Only the exact disabled string is admitted');
  assert.throws(()=>assertMediaAuthConfig(invalid,after),/Unreviewed previous website assistant/,'Unknown prior state is not silently normalized');
 }
 const unknownGate=structuredClone(after);unknownGate.vars.UNREVIEWED_ASSISTANT_SETTING='false';
 assert.throws(()=>assertMediaAuthConfig(before,unknownGate),/Unreviewed Auth/,'No blanket variable allowlist');
 const loggingBefore=structuredClone(before);loggingBefore.observability.logs.invocation_logs=true;
 assertMediaAuthConfig(loggingBefore,after);
 const unsafeLogs=structuredClone(after);unsafeLogs.observability.logs.invocation_logs=true;
 assert.throws(()=>assertMediaAuthConfig(before,unsafeLogs),/invocation logs disabled/);
 const alteredLogs=structuredClone(after);alteredLogs.observability.logs.enabled=false;
 assert.throws(()=>assertMediaAuthConfig(before,alteredLogs),/Unreviewed Auth/);
 const invalid=structuredClone(after);invalid.routes=[];assert.throws(()=>assertMediaAuthConfig(before,invalid),/Unreviewed Auth/);
 const media=createReleasePlanFromRepo(repoRoot,{files:['workers/media/src/index.js','workers/auth/wrangler.jsonc','workers/auth/migrations/0089_add_private_media_services.sql','admin/index.html']});
 const {backendContinuationSupported}=await import('./lib/backend-continuation.mjs');assert(backendContinuationSupported(media));
 assert.equal(media.schemaApplies[0].checkpoint,'auth');
 console.log('Auth configuration: reviewed absent-to-off and retained-off admission; activation, unknown values, removal and unrelated config changes rejected.');
}
