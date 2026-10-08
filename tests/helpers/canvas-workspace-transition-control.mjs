import {canvasAudioFixture} from './canvas-audio-control.mjs';
import {canvasClipIdentity} from '../../js/shared/canvas-export.mjs';
import {workspaceBounds} from '../../js/shared/canvas-workspace.mjs';
const check=(value,message)=>{if(!value)throw Error(message);};
export async function canvasWorkspaceTransitionCase(base,media) {
    const f=await canvasAudioFixture(base,{...media,scope:'workspace-transitions'});
    const project=(await f.readProject()).project;check(project.workspace_width===2400&&project.workspace_height===1600,'Safe legacy workspace defaults');
    await f.data(await f.request(f.projectPath,'PATCH',{workspace_width:4000,workspace_height:3000}));
    const node=f.order[0];await f.data(await f.request(`${f.projectPath}/nodes/${node}`,'PATCH',{x:2076,y:1750,width:230,height:330}));
    let state=await f.readProject(),bounds=workspaceBounds(state.nodes);
    check(bounds.width>=2319&&bounds.height===2080,'Right/bottom bounds include full variable card and port');
    const failed=await f.request(f.projectPath,'PATCH',{workspace_width:2076,workspace_height:1800});check(failed.status===409,'Origin-only shrink rejected');
    state=await f.readProject();check(state.project.workspace_width===4000&&state.project.workspace_height===3000,'Invalid shrink preserves saved dimensions');
    const unauthorized=await f.request(f.projectPath,'PATCH',{workspace_width:4000,workspace_height:3000},{Cookie:'__Host-bitbi_session=invalid'});check(unauthorized.status===401,'Direct dimension mutation needs owner');
    await f.data(await f.request(`${f.projectPath}/nodes/${node}`,'PATCH',{x:20,y:30,width:230,height:150}));
    bounds=workspaceBounds((await f.readProject()).nodes);await f.data(await f.request(f.projectPath,'PATCH',{workspace_width:bounds.width,workspace_height:bounds.height}));
    check((await f.readProject()).project.workspace_height===bounds.height,'Independent exact minimum saves below initial defaults');
    const db=f.env.DB;let raced=false;
    f.env.DB={prepare(sql){const statement=db.prepare(sql);if(sql.startsWith('UPDATE canvas_projects SET workspace_width'))return {bind(...values){const bound=statement.bind(...values);return {async run(){raced=true;await db.prepare('UPDATE canvas_nodes SET x=x+1000 WHERE id=?').bind(node).run();return bound.run();}};}};return statement;},batch:db.batch.bind(db)};
    try{const conflict=await f.request(f.projectPath,'PATCH',{workspace_width:bounds.width,workspace_height:bounds.height});check(raced&&conflict.status===409,'Concurrent node movement cannot pass stale geometry admission');}
    finally{f.env.DB=db;await db.prepare('UPDATE canvas_nodes SET x=x-1000 WHERE id=?').bind(node).run();}
    const effect={preset:'radial-blur',duration:.25,strength:5},edge=f.edges[0];
    await f.data(await f.request(`${f.projectPath}/edges/${edge.id}`,'PATCH',{config:{transition:effect}}));
    const invalid=await f.request(`${f.projectPath}/edges/${edge.id}`,'PATCH',{config:{transition:{preset:'radial-blur',duration:.25,strength:5,filter:'movie=https://invalid'}}});check(invalid.status===400,'No arbitrary filters');
    const view=await f.data(await f.request(f.endpoint)),clips=view.chain.clips.map(canvasClipIdentity),body={orderedClips:clips,mergeMode:'chain',smoothJoins:true,backgroundMusic:{enabled:false,gain:1}},key='transition-immutable-0001';
    const post=(value=body,k=key)=>f.request(f.endpoint,'POST',value,{'Idempotency-Key':k});
    const accepted=(await f.data(await post())).export;check(accepted.recipe.version===6&&accepted.recipe.originalAudioPolicy==='fit-picture-v1','Version 6 keeps audio fitting');
    check(JSON.stringify(accepted.recipe.transitions[0])===JSON.stringify(effect),'Current exact ordered boundary snapshot');
    await f.data(await f.request(`${f.projectPath}/edges/${edge.id}`,'PATCH',{config:{transition:{preset:'flash',duration:.4,strength:.5}}}));
    const replay=(await f.data(await post())).export;check(replay.id===accepted.id&&replay.recipe.transitions[0].preset==='radial-blur','Replay retains accepted effect after edit');
    const newer=(await f.data(await post(body,'transition-new-settings'))).export;check(newer.id!==accepted.id&&newer.recipe.transitions[0].preset==='flash','New request uses new transition');
    const manual=(await f.data(await post({...body,mergeMode:undefined,orderedClips:[clips[1],clips[0],...clips.slice(2)]},'transition-manual-reverse'))).export;
    check(manual.recipe.version===5,'Reversed/unconnected manual pairs stay ordinary cuts');
    const leaseHeaders={Authorization:'Bearer synthetic-audio-processor'};
    const oldClaim=await f.data(await f.request('/api/internal/homepage/hero-videos/canvas-exports/jobs/claim','POST',{protocol:1,recipeProtocol:6,limit:3},leaseHeaders));check(oldClaim.jobs.every(j=>j.recipeVersion!==6),'Old processor cannot claim transition recipe');
    const claim=await f.data(await f.request('/api/internal/homepage/hero-videos/canvas-exports/jobs/claim','POST',{protocol:1,recipeProtocol:7,limit:3},leaseHeaders));check(claim.jobs.some(j=>j.recipeVersion===6&&j.transitionPolicy==='overlap-v1'),'New processor receives immutable policy');
    // Lost POST reconciliation is a read, owner/project/subject scoped.
    const observed=await f.data(await f.request(f.endpoint+'?requestKey='+key));
    check(observed.submission.found&&observed.export.id===accepted.id,'Exact accepted intent lookup');
    check(!(await f.data(await f.request(f.endpoint+'?requestKey=missing-request-0001'))).submission.found,'Absent intent is explicit');
    check((await f.request(f.endpoint+'?requestKey='+key,'GET',null,{Cookie:'__Host-bitbi_session=invalid'})).status===401,'Lookup never bypasses owner');
    const malformed=await f.request(f.endpoint+'?requestKey=invalid');
    check(malformed.status===409&&(await malformed.json()).code==='canvas_export_key_required','Malformed lookup preserves the export key conflict contract');
    const jobs=claim.jobs.filter(j=>j.recipeVersion===6),failurePath=j=>`/api/internal/homepage/hero-videos/canvas-exports/jobs/${j.id}/fail`;
    check(jobs.length>=2&&jobs.every(j=>j.attempt===1),'Claim exposes actual first attempt');
    const fail=(job,code)=>f.request(failurePath(job),'POST',{code,diagnostic:{stage:'transitions',errorClass:'filter',reason:'timebase_mismatch',stderr:'private-token',url:'https://private.invalid'}},{...leaseHeaders,'X-BITBI-Canvas-Claim':job.claim});
    await f.data(await fail(jobs[0],'canvas_media_filter_invalid'));
    let failedRow=await db.prepare('SELECT status,attempt_count,error_code FROM canvas_video_processing WHERE id=?').bind(jobs[0].id).first();
    check(failedRow.status==='failed'&&failedRow.attempt_count===1,'Deterministic filter failure terminates once');
    check((await fail(jobs[0],'canvas_processing_transient')).status===409,'A stale failure cannot resurrect terminal work');
    let transient=jobs[1];
    for(let attempt=1;attempt<=3;attempt++){
      await f.data(await fail(transient,'canvas_processing_transient'));
      const row=await db.prepare('SELECT status,attempt_count FROM canvas_video_processing WHERE id=?').bind(transient.id).first();
      check(row.attempt_count===attempt&&row.status===(attempt<3?'queued':'failed'),'Transient retries stop at three actual attempts');
      if(attempt<3){
        await db.prepare("UPDATE canvas_video_processing SET next_attempt_at='2000-01-01' WHERE id=?").bind(transient.id).run();
        const renewed=await f.data(await f.request('/api/internal/homepage/hero-videos/canvas-exports/jobs/claim','POST',{protocol:1,recipeProtocol:7,limit:3},leaseHeaders));
        const previous=transient;transient=renewed.jobs.find(j=>j.id===previous.id);
        check(transient?.attempt===attempt+1,'Retry claim correlation increments');
        check((await fail(previous,'canvas_media_filter_invalid')).status===409,'Late old claim cannot fail new attempt');
      }
    }
    // A lost process lease is bounded too, but a committed private asset is
    // recovered before that budget is applied (no blind render or deletion).
    await db.prepare("UPDATE canvas_video_processing SET status='processing',locked_until='2000-01-01',next_attempt_at='2000-01-01' WHERE id=?").bind(transient.id).run();
    const exhausted=await f.data(await f.request('/api/internal/homepage/hero-videos/canvas-exports/jobs/claim','POST',{protocol:1,recipeProtocol:7,limit:3},leaseHeaders));
    check(!exhausted.jobs.some(j=>j.id===transient.id),'Expired third lease cannot dispatch a fourth render');
    check((await db.prepare('SELECT status FROM canvas_video_processing WHERE id=?').bind(transient.id).first()).status==='failed','Lease exhaustion is terminal');
    const recovery=(await f.data(await post(body,'transition-stored-response'))).export;
    const recoveryClaim=(await f.data(await f.request('/api/internal/homepage/hero-videos/canvas-exports/jobs/claim','POST',{protocol:1,recipeProtocol:7,limit:3},leaseHeaders))).jobs.find(j=>j.id===recovery.id);
    const {saveGeneratedVideoAsset}=await import('../../workers/auth/src/lib/ai-text-assets.js');
    await saveGeneratedVideoAsset(f.env,{userId:f.owner,title:'Synthetic accepted export',videoBytes:Uint8Array.from(atob(media.videoBase64),c=>c.charCodeAt(0)),mimeType:'video/mp4',processingClaim:{id:recovery.id,token:recoveryClaim.claim}});
    await f.data(await fail(recoveryClaim,'canvas_processing_failed'));
    const recovered=await db.prepare('SELECT status,asset_id,attempt_count FROM canvas_video_processing WHERE id=?').bind(recovery.id).first();
    check(recovered.status==='preview_pending'&&recovered.asset_id===recovery.id&&recovered.attempt_count===0,'Unknown completion response preserves stored output and independent poster lifecycle');
    check((await f.request(`/api/ai/text-assets/${recovery.id}/file`)).status===200,'Recovered output remains owner-readable');
    check(f.calls.length===0,'No paid generation');
    return {provider:'synthetic',workspace:true,owner:true,immutable:true,manual:true,protocol:true,providerCalls:0};
}
