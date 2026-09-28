import worker from '../../workers/auth/src/index.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { captureCanvasContributors, resolveCanvasContributors } from '../../workers/auth/src/lib/canvas-contributors.js';
const check = (condition, label) => { if (!condition) throw new Error(label); };

export async function canvasContributorsCase(env) {
  const db=env.DB, owner='contributor-owner', now=new Date().toISOString();
  const id = value => String(value).padStart(32,'0');
  for(const user of [owner,'contributor-foreign']) {
    await db.prepare('INSERT INTO users(id,email,password_hash,created_at,role,email_verified_at) VALUES(?,?,?,?,?,?)').bind(user,user+'@example.invalid','synthetic',now,'user',now).run();
    await db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)').bind(user,user,await sha256Hex(`${user}:${env.SESSION_HASH_SECRET}`),now,new Date(Date.now()+3600000).toISOString(),now).run();
  }
  const project=id(800), other=id(801);
  for(const pid of [project,other]) await db.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,?,'en',?,?)").bind(pid,owner,'Contributor evidence',now,now).run();
  // A 46-run chain with an independent image/text branch, beyond the 40-run UI.
  for(let i=0;i<49;i++) {
    await db.prepare("INSERT INTO canvas_nodes(id,project_id,user_id,type,model_id,x,y,config_json,content_json,created_at,updated_at) VALUES(?,?,?,'video_generation','minimax/h3',0,0,'{}','{}',?,?)").bind(id(i+1),project,owner,now,now).run();
    const sources=i<45?[{nodeId:id(i+2),runId:id(i+102),assetId:'asset-'+(i+1),edgeId:id(i+201),version:'original'}]:[];
    if(i===0) sources.push({nodeId:id(47),runId:id(147),assetId:'asset-46',edgeId:id(300),version:'image-version'});
    if(i===46) sources.push({nodeId:id(48),edgeId:id(301),version:'original-text-hash'});
    const input=i===48?{connected_node_ids:[id(48),id(49)],connected_video_inputs:[{runId:id(147),assetId:'asset-46',edgeId:id(302)}]}:{used_sources:sources};
    await db.prepare("INSERT INTO canvas_runs(id,project_id,node_id,user_id,model_id,operation_type,idempotency_key,status,input_json,asset_id,created_at,updated_at) VALUES(?,?,?,?,'minimax/h3','video',?,'completed',?,?,?,?)").bind(id(i+101),project,id(i+1),owner,'contributors-'+i,JSON.stringify(input),'asset-'+i,now,now).run();
  }
  const get=async(run,actor=owner,pid=project)=>worker.fetch(new Request(`https://bitbi.ai/api/account/canvas/projects/${pid}/runs/${run}/contributors`,{headers:{Cookie:`__Host-bitbi_session=${actor}`}}),env,{waitUntil(){throw new Error('Read-only resolver');}});
  const response=await get(id(101));check(response.status===200,'Actual contributor route');const {data}=await response.json();
  check(data.nodeIds.length===47 && data.edges.length===47 && !data.incomplete,'Complete branched historical chain beyond 40 runs');
  check(data.nodeIds.includes(id(46)) && data.nodeIds.includes(id(48)) && !data.nodeIds.includes(id(49)),'All genuine branches, no unrelated nodes');
  // Mutable current output and graph cannot rewrite this old successful output.
  await db.prepare('UPDATE canvas_nodes SET output_json=? WHERE id=?').bind(JSON.stringify({runId:'new-run',assetId:'new-asset'}),id(2)).run();
  check(JSON.stringify((await (await get(id(101))).json()).data)===JSON.stringify(data),'Source rerun does not alter retained ancestry');
  check((await get(id(101),'contributor-foreign')).status===404 && (await get(id(101),owner,other)).status===404,'Owner and project isolation');
  const legacy=(await (await get(id(149))).json()).data;
  check(legacy.incomplete && legacy.edges.length===2 && !legacy.nodeIds.includes(id(49)),'Legacy only historically provable continuation and its branch');
  await db.prepare("UPDATE canvas_runs SET status='failed' WHERE id=?").bind(id(101)).run();
  check((await get(id(101))).status===404,'Failed attempt is not a displayed output');
  const source={status:'compatible',sourceNodeId:'text',edgeId:'text-edge',inputKind:'prompt',text:'Private original'};
  check((await captureCanvasContributors({sources:[source],promptSource:'direct'},{prompt:'Own prompt'})).length===0,'Unused connected text excluded');
  const captured=await captureCanvasContributors({sources:[source],promptSource:'connected'},{prompt:source.text});
  check(captured.length===1 && captured[0].version.length===64 && !JSON.stringify(captured).includes(source.text),'Consumed text identity without retained cleartext in response');
  let reads=0;
  const bounded = { DB: { prepare() { return { bind(run, pid, uid) {
    check(pid === project && uid === owner, 'Every bounded lookup remains scoped');
    return { async first() {
      reads++;
      if(run==='root') return {id:run,node_id:'root-node',status:'completed',input_json:JSON.stringify({used_sources:Array.from({length:200},(_,i)=>({nodeId:`parent-${i}`,runId:`parent-${i}`,edgeId:`edge-${i}`}))})};
      if(run.startsWith('parent-')) return {id:run,node_id:run,status:'completed',input_json:JSON.stringify({connected_video_inputs:Array.from({length:200},(_,i)=>({runId:`missing-${run}-${i}`,assetId:'missing',edgeId:`legacy-${i}`}))})};
      return null;
    } };
  } }; } } };
  const limited=await resolveCanvasContributors(bounded,owner,project,'root');
  check(reads===500 && limited.incomplete && limited.edges.length===200,'Missing legacy sources cannot cause unbounded database reads');
  return {nodes:data.nodeIds.length,edges:data.edges.length,legacyIncomplete:legacy.incomplete};
}
