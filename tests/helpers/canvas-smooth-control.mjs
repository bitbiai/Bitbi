import {canvasAudioFixture} from './canvas-audio-control.mjs';
import {validAudioFit,cutSafeAudio,audioFitResultText} from '../../js/shared/canvas-audio-fit.mjs';
import {effectiveAudio} from '../../js/shared/canvas-audio.mjs';
import {enqueueCanvasProcessing} from '../../workers/auth/src/lib/canvas-video-processing.js';
import {canvasClipIdentity} from '../../js/shared/canvas-export.mjs';
const check=(value,message)=>{if(!value)throw new Error(message);};
export function canvasAudioFitSettingsCase() {
  // Exercise the exact worklet composition: a generated node can omit its
  // unchanged defaults, while the processor still reports a valid audio fit.
  const unity={enabled:true,gain:1,fadeIn:0,fadeOut:0};
  const uncut={policy:'fit-picture-v1',trimStart:0,trimEnd:0};
  const fitted={...uncut,trimStart:.2,trimEnd:.3};
  const actual=(value,fit)=>effectiveAudio(cutSafeAudio(value,fit),8);
  const equal=(value,expected,message)=>check(JSON.stringify(value)===JSON.stringify(expected),message);
  equal(actual(undefined,uncut),unity,'Omitted source settings retain unity in the worklet timeline');
  equal(actual(undefined,fitted),{...unity,fadeIn:.005,fadeOut:.005},'Omitted source settings receive only the bounded cut-edge ramps');
  equal(actual(undefined,undefined),unity,'Absent legacy fit keeps normal default playback');
  equal(actual(undefined,{...uncut,trimStart:1/48000,trimEnd:1/48000}),unity,'One-sample fit threshold remains unchanged');
  const explicit={enabled:false,gain:.37,fadeIn:.4,fadeOut:.7},before=JSON.stringify(explicit);
  equal(actual(explicit,fitted),explicit,'Explicit mute, gain and fades are preserved');
  equal(actual({...explicit,enabled:true,fadeOut:0},fitted),{...explicit,enabled:true,fadeOut:.005},'Only an absent outgoing fade receives the cut-edge ramp');
  check(JSON.stringify(explicit)===before,'Preparing audition never mutates saved settings');
  const invalidFades=[NaN,false,'',null,-1,601].flatMap(value=>[{...unity,fadeIn:value},{...unity,fadeOut:value}]);
  for(const invalid of [null,{},[],false,'bad',{gain:.3},{...unity,gain:NaN},{...unity,gain:-1},{...unity,gain:1.1},{...unity,enabled:'yes'},{...unity,extra:true},...invalidFades]) {
    for(const fit of [uncut,fitted,undefined]) {
      let rejected=false;try{actual(invalid,fit);}catch(error){rejected=error.code==='canvas_audio_settings';}
      check(rejected,'Malformed settings must not become valid defaults');
    }
  }
  for(const invalid of [null,{...fitted,trimStart:-1},{...fitted,trimEnd:null},{...fitted,extra:true}]) {
    check(!validAudioFit(invalid)&&cutSafeAudio(explicit,invalid)===explicit,'Invalid fit metadata cannot add edge fades');
  }
  return {omittedDefaults:true,explicitSettings:true,malformedRejected:true};
}
export async function canvasSmoothCase(base,media) {
  canvasAudioFitSettingsCase();
  const fitted={policy:'fit-picture-v1',trimStart:0,trimEnd:.2};
  check(validAudioFit(fitted)&&!validAudioFit({...fitted,trimEnd:null})&&!validAudioFit({...fitted,private:'forbidden'}),'Strict fit report');
  check(cutSafeAudio({enabled:true,gain:.5,fadeOut:.3},fitted).fadeOut===.3&&cutSafeAudio({enabled:true,gain:.5,fadeOut:0},fitted).fadeOut===.005,'Audition uses the same single edge ramp and retains gain');
  check(audioFitResultText([{originalAudioFit:fitted}],true).includes('gekürzt')&&audioFitResultText([{originalAudioFit:fitted}],false).includes('trimmed'),'Both languages disclose shortened audio');
  const f=await canvasAudioFixture(base,{...media,scope:'smooth'}),internal='/api/internal/homepage/hero-videos/canvas-exports/jobs';
  const ledger=JSON.stringify((await f.db.prepare('SELECT * FROM member_credit_ledger WHERE user_id=? ORDER BY id').bind(f.owner).all()).results);
  const view=await f.data(await f.request(f.endpoint)),clips=view.chain.clips.map(canvasClipIdentity);
  const body={orderedClips:clips,mergeMode:'chain',backgroundMusic:{enabled:false,gain:1}};
  const post=(body,key)=>f.request(f.endpoint,'POST',body,{'Idempotency-Key':key});
  const setting=`${f.projectPath}/nodes/${f.last.id}`;
  check((await f.readProject()).nodes.find(n=>n.id===f.last.id).config.smoothJoins===undefined,'Legacy setting defaults OFF without migration activation');
  for(const invalid of [null,'yes',1,{}])check((await f.request(setting,'PATCH',{config:{smoothJoins:invalid}})).status===400,'Strict persistent boolean');
  await f.data(await f.request(setting,'PATCH',{config:{smoothJoins:true}}));
  check((await f.readProject()).nodes.find(n=>n.id===f.last.id).config.smoothJoins===true,'Project reload preserves selected mode');
  const normal=(await f.data(await post(body,'smooth-off-acceptance'))).export;
  check(normal.recipe.version===5&&!normal.recipe.smoothJoins.enabled&&normal.recipe.timingPolicy==='video-clock-v2'&&normal.recipe.originalAudioPolicy==='fit-picture-v1','OFF still uses corrected video timing');
  const legacyRecipe={...normal.recipe,version:4,timingPolicy:'video-clock-v1'};delete legacyRecipe.originalAudioPolicy;
  const legacy=await enqueueCanvasProcessing(f.env,{userId:f.owner,projectId:f.project,runId:{nodeId:f.last.id},kind:'concat',sources:legacyRecipe.videos,recipe:legacyRecipe,requestKey:'audio-fit-legacy-key'});
  await f.db.prepare("UPDATE canvas_video_processing SET status='failed',error_code='canvas_audio_tail_exceeds_video' WHERE id=?").bind(legacy.id).run();
  const replay=(await f.data(await post(body,'audio-fit-legacy-key'))).export;
  check(replay.id===legacy.id&&replay.recipe.version===4&&replay.status==='failed','Old accepted failure is observed without changing its policy');
  const smooth=(await f.data(await post({...body,smoothJoins:true},'smooth-on-acceptance'))).export;
  check(smooth.id!==normal.id&&smooth.recipe.smoothJoins.policy==='motion-anchors-v1','Mode/policy is immutable render input');
  check((await post({...body,smoothJoins:false},'smooth-on-acceptance')).status===409,'Unknown outcome cannot silently change mode');
  check((await post({...body,smoothJoins:{filter:'unsafe'}},'smooth-bad-acceptance')).status===400,'No unrestricted filter input');
  check((await post({...body,smoothJoins:true,preview:{seamIndex:99}},'smooth-bad-preview')).status===400,'Preview index bounded by actual ordered sources');
  const previewBody={...body,smoothJoins:true,preview:{seamIndex:1}};
  check((await f.request(f.endpoint,'POST',previewBody,{Cookie:'__Host-bitbi_session=invalid','Idempotency-Key':'smooth-unauth-preview'})).status===401,'Direct preview requires authentication');
  const preview=(await f.data(await post(previewBody,'smooth-preview-acceptance'))).preview;
  const cached=(await f.data(await post(previewBody,'smooth-preview-second'))).preview;
  check(preview.id===cached.id,'Equal immutable recipe reuses accepted comparison, not another render');
  check((await f.data(await f.request(f.endpoint))).export.id===smooth.id,'Preview never replaces full export head');
  check((await f.data(await f.request(f.endpoint+'?seamPreview='+preview.id))).preview.id===preview.id,'Scoped status readback');
  check((await f.request(f.endpoint+'?seamPreview='+normal.id)).status===404,'Full export cannot be mislabelled comparison');
  await f.data(await f.request(setting,'PATCH',{config:{smoothJoins:false,originalAudio:{enabled:false,gain:.7,fadeIn:.2,fadeOut:0}}}));
  const changed=(await f.data(await post(previewBody,'smooth-preview-audio-change'))).preview;
  check(changed.id!==preview.id,'Changed audio invalidates cached comparison');
  for(const key of ['smooth-preview-acceptance','smooth-preview-second'])check((await f.data(await post(previewBody,key))).preview.id===preview.id,'Original and cached request keys retain their accepted snapshot after editing');
  check(preview.recipe.videos.at(-1).originalAudio.enabled===true,'Accepted preview is not changed by later sound editing');
  const compatible=await enqueueCanvasProcessing(f.env,{userId:f.owner,projectId:f.project,runId:{nodeId:f.last.id},kind:'concat',sources:legacyRecipe.videos,recipe:legacyRecipe,requestKey:'audio-fit-compatible-control'});
  const newPolicyIds=[normal.id,smooth.id,preview.id,changed.id];
  // The native suite shares a real backend queue with earlier fixtures. Put
  // these incompatible jobs first, then one compatible positive control;
  // protocol exclusion must skip them without claiming unrelated queued work.
  for(const id of newPolicyIds)await f.db.prepare("UPDATE canvas_video_processing SET next_attempt_at='1900-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();
  await f.db.prepare("UPDATE canvas_video_processing SET next_attempt_at='1901-01-01T00:00:00.000Z' WHERE id=?").bind(compatible.id).run();
  const unrelated=async()=>(await f.db.prepare('SELECT id,status,attempt_count,processing_token FROM canvas_video_processing WHERE user_id<>? ORDER BY id').bind(f.owner).all()).results;
  const unrelatedBefore=JSON.stringify(await unrelated());
  const head=await f.db.prepare('SELECT latest_id,current_id FROM canvas_export_heads WHERE node_id=?').bind(f.last.id).first();
  const auth={Authorization:'Bearer synthetic-audio-processor'};
  const oldJobs=(await f.data(await f.request(internal+'/claim','POST',{protocol:1,recipeProtocol:5,limit:1},auth))).jobs;
  check(oldJobs.length===1&&oldJobs[0].id===compatible.id&&oldJobs[0].recipeVersion===4,'Old processor cannot claim new policy and still claims its compatible recipe');
  for(const id of newPolicyIds){
    const row=await f.db.prepare('SELECT status,attempt_count,processing_token FROM canvas_video_processing WHERE id=?').bind(id).first();
    check(row.status==='queued'&&row.attempt_count===0&&row.processing_token===null,'Old processor leaves every new-policy job unclaimed');
  }
  const remaining=new Set(newPolicyIds);
  let previewJob;
  for(let i=0;i<4;i++) {
    const job=(await f.data(await f.request(internal+'/claim','POST',{protocol:1,recipeProtocol:6,limit:1},auth))).jobs[0];
    check(remaining.delete(job?.id)&&job.recipeVersion===5&&job.originalAudioPolicy==='fit-picture-v1'&&job.smoothJoins.policy==='motion-anchors-v1','New processor receives each exact new-policy job once');
    if(job.id===preview.id)previewJob=job;
  }
  check(remaining.size===0&&JSON.stringify(await unrelated())===unrelatedBefore,'Policy probes preserve unrelated shared-queue jobs');
  check(previewJob.preview.seamIndex===1,'Real claim receives the same requested seam');
  const form=(report=true,fit=true)=>{const form=new FormData();form.set('video',new Blob([Uint8Array.from(atob(media.videoBase64),c=>c.charCodeAt(0))],{type:'video/mp4'}),'preview.mp4');
    form.set('duration','2');form.set('width','320');form.set('height','180');form.set('audioTimeline',JSON.stringify([0,1].map(start=>({start,duration:1,...(fit?{originalAudioFit:{policy:'fit-picture-v1',trimStart:0,trimEnd:start?.2:0}}:{})}))));
    if(report)form.set('seamResult',JSON.stringify({policy:'motion-anchors-v1',improved:0,seams:[{index:1,at:2,reason:'uncertain_motion'}]}));return form;};
  const lease={...auth,'X-BITBI-Canvas-Claim':previewJob.claim};
  check((await f.request(previewJob.completion.url,'POST',form(true,false),lease)).status===409,'Missing fit report blocks completion');
  const malformed=form();malformed.set('audioTimeline',JSON.stringify([{start:0,duration:1,originalAudioFit:{policy:'fit-picture-v1',trimStart:0,trimEnd:-1}},{start:1,duration:1}]));
  check((await f.request(previewJob.completion.url,'POST',malformed,lease)).status===409,'Malformed fit is not a zero trim');
  check((await f.request(previewJob.completion.url,'POST',form(false),lease)).status===409,'Missing result cannot become a silent successful smoothing');
  await f.data(await f.request(previewJob.completion.url+'?part=preview-base','POST',form(),lease));
  await f.data(await f.request(previewJob.completion.url,'POST',form(),lease));
  const ready=(await f.data(await f.request(f.endpoint+'?seamPreview='+preview.id))).preview;
  check(ready.audio_timeline[1].originalAudioFit.trimEnd===.2,'Fit disclosure persists in authoritative readback');
  check((await f.db.prepare('SELECT recipe_json,status FROM canvas_video_processing WHERE id=?').bind(legacy.id).first()).recipe_json===JSON.stringify(legacyRecipe),'Old accepted recipe remains immutable');
  check(ready.preview_base&&ready.asset&&ready.seam_result.improved===0,'Fallback and both source-protected comparisons are visible');
  check((await f.request(ready.preview_base.file_url)).ok,'Owner can read before preview');
  check((await f.request(ready.preview_base.file_url,'GET',null,{Cookie:'__Host-bitbi_session=invalid'})).status===401,'Private comparison stays protected');
  check((await post({saveExportId:preview.id},'smooth-preview-save')).status===409,'Comparison cannot masquerade as full saved export');
  check(JSON.stringify(await f.db.prepare('SELECT latest_id,current_id FROM canvas_export_heads WHERE node_id=?').bind(f.last.id).first())===JSON.stringify(head),'Completion leaves full heads intact');
  let immutable=false;try{await f.db.prepare("UPDATE canvas_video_processing SET seam_result_json='{}' WHERE id=?").bind(preview.id).run();}catch(error){immutable=String(error).includes('canvas_seam_result_immutable');}check(immutable,'Committed result is immutable');
  check(f.calls.length===0,'No inference for settings/comparison/render/recovery');
  check(JSON.stringify((await f.db.prepare('SELECT * FROM member_credit_ledger WHERE user_id=? ORDER BY id').bind(f.owner).all()).results)===ledger,'No merge charge or changed credit row');
  await f.db.prepare('DELETE FROM canvas_projects WHERE id=?').bind(f.project).run();
  return {providerCalls:0,modeIsolation:true,previewCache:true,privateReadback:true,immutable:true};
}
