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
    check(f.calls.length===0,'No paid generation');
    return {provider:'synthetic',workspace:true,owner:true,immutable:true,manual:true,protocol:true,providerCalls:0};
}
