import worker from '../../workers/auth/src/index.js';
import aiWorker from '../../workers/ai/src/index.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { grantMemberCredits } from '../../workers/auth/src/lib/billing.js';
import { processCanvasAgentConversation } from '../../workers/auth/src/lib/canvas-agent-conversation.js';
import { canvasAgentEnvironment, canvasAgentSession } from '../../workers/auth/src/lib/canvas-agent-authority.js';
import { getModelTariff } from '../../workers/auth/src/lib/model-tariffs.js';
import { TARIFF_HEADER } from '../../js/shared/model-tariff.mjs';

const check=(value,message)=>{if(!value)throw new Error(message);};
const blankBrief={version:1,revision:0,fields:{},duration:{targetDurationSeconds:null,choice:null,asked:false,sourceMessageId:null},openQuestions:[]};

// Uses the real authenticated Worker and SQL engine. Faults are placed at the
// storage boundary after committed writes, never by replacing route responses.
export async function canvasProjectLifecycleCase(base) {
  const db=base.DB,owner='canvas-lifecycle-owner',other='canvas-lifecycle-other',now=new Date().toISOString();
  const expires=new Date(Date.now()+3600000).toISOString(),id=async label=>(await sha256Hex(`lifecycle:${label}`)).slice(0,32);
  const pending=[],providerCalls=[],nonces=new Set();
  let failCleanup=false,failBatch=false,loseBatchReply=false,cleanupFailures=0,statementFence=null;
  const env={...base,AI_SERVICE_AUTH_SECRET:'synthetic-lifecycle-service',DB:{
    prepare(sql){
      if(failCleanup&&sql.includes('FROM canvas_export_reclaimable')){
        cleanupFailures++;throw Object.assign(new Error('Synthetic cleanup unavailable'),{code:'synthetic_cleanup_unavailable'});
      }
      const statement=db.prepare(sql),fence=statementFence;
      if(!fence||!sql.replace(/\s+/g,' ').trim().startsWith(fence.prefix))return statement;
      const delayed=bound=>({
        bind(...values){return delayed(bound.bind(...values));},
        async first(...args){statementFence=null;fence.enter();await fence.released;return bound.first(...args);},
        async run(...args){statementFence=null;fence.enter();await fence.released;return bound.run(...args);},
      });
      return delayed(statement);
    },
    async batch(statements){
      if(failBatch){failBatch=false;throw new Error('Synthetic batch unavailable before commit');}
      const result=await db.batch(statements);
      if(loseBatchReply){loseBatchReply=false;throw new Error('Synthetic lost committed batch acknowledgement');}
      return result;
    },
  }};
  env.AI_LAB={fetch:request=>aiWorker.fetch(request,{
    AI_SERVICE_AUTH_SECRET:env.AI_SERVICE_AUTH_SECRET,
    SERVICE_AUTH_REPLAY:{idFromName:value=>value,get:value=>({async fetch(){const replayed=nonces.has(value);nonces.add(value);return Response.json({replayed});}})},
    AI:{async run(model,input){providerCalls.push({model,input});return{response:'A persisted synthetic scene.',usage:{prompt_tokens:8,completion_tokens:12,total_tokens:20}};}},
  },{waitUntil(promise){pending.push(promise);}})};
  for(const user of [owner,other]){
    await db.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,?,?,'user','active',?)").bind(user,`${user}@example.invalid`,'synthetic',now,now).run();
    await db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)').bind(user,user,await sha256Hex(`${user}:${env.SESSION_HASH_SECRET}`),now,expires,now).run();
  }
  const request=(path,method='GET',{user=owner,key='lifecycle-replay-key',body={},headers={}}={})=>worker.fetch(new Request(`https://bitbi.ai${path}`,{
    method,headers:{Origin:'https://bitbi.ai',Cookie:`__Host-bitbi_session=${user}`,'X-Bitbi-Correlation-Id':'lifecycle-cleanup-fixture',
      ...(['POST','PATCH'].includes(method)?{'Content-Type':'application/json','Idempotency-Key':key}:{}),...headers},...(['POST','PATCH'].includes(method)?{body:JSON.stringify(body)}:{}),
  }),env,{waitUntil(promise){pending.push(promise);}});
  const payload=async(response,status=200)=>{const body=await response.json();check(response.status===status,`Lifecycle expected ${status}, got ${response.status}/${body.code}`);return body;};
  const createProject=async label=>{const project=await id(label);await db.prepare("INSERT INTO canvas_projects(id,user_id,title,created_at,updated_at) VALUES(?,?,'Synthetic lifecycle project',?,?)").bind(project,owner,now,now).run();return project;};
  const createNode=async(project,label,type='note')=>{const node=await id(label);await db.prepare('INSERT INTO canvas_nodes(id,project_id,user_id,type,x,y,created_at,updated_at) VALUES(?,?,?,?,0,0,?,?)').bind(node,project,owner,type,now,now).run();return node;};
  const project=await createProject('protected-history'),node=await createNode(project,'history-node'),second=await createNode(project,'history-node-two');
  const edge=await id('history-edge'),run=await id('production'),turn=await id('turn'),briefingRun=await id('briefing'),step=await id('plan-step'),operation=await id('operation');
  const path=`/api/account/canvas/projects/${project}`;
  await db.prepare('INSERT INTO canvas_edges(id,project_id,user_id,source_node_id,target_node_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(edge,project,owner,node,second,now,now).run();
  await db.prepare("INSERT INTO canvas_agent_conversations(project_id,user_id,brief_json,draft,allowance_credits,allowance_tariff,created_at,updated_at) VALUES(?,?,?,'Private draft',1000,1,?,?)")
    .bind(project,owner,JSON.stringify({...blankBrief,fields:{story:{value:'Private synthetic brief',provenance:'user_stated',sourceMessageId:turn,revision:0}}}),now,now).run();
  for(const [runId,purpose]of[[run,'production'],[briefingRun,'briefing']])await db.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,purpose,expected_revision,budget_credits,tariff_revision,lease_token,lease_until,next_attempt_at,created_at,updated_at,expires_at)
    VALUES(?,?,?,?,'{"original":"accepted"}','planning',?,0,1000,1,'synthetic-original-lease',?,?,?,?,?)`)
    .bind(runId,project,owner,runId,purpose,expires,now,now,now,expires).run();
  await db.prepare("INSERT INTO canvas_agent_steps(id,run_id,step_key,kind,input_json,status,allocation_credits,receipt_json,created_at,updated_at) VALUES(?,?,'plan','plan','{\"original\":\"request\"}','completed',0,'{\"original\":\"receipt\"}',?,?)").bind(step,run,now,now).run();
  await db.prepare(`INSERT INTO canvas_agent_model_operations(id,step_id,run_id,user_id,usage_attempt_id,dispatch_token,kind,model,request_id,input_digest,context_json,caller_policy_json,state,response_json,receipt_json,dispatched_at,next_attempt_at,receipt_deadline,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'plan','xai/grok-4.7',?,?,'{"original":"context"}','{}','completed','{"original":"answer"}','{"original":"receipt"}',?,?,?,?,?)`)
    .bind(operation,step,run,owner,'synthetic-accepted-usage','synthetic-original-dispatch','synthetic-original-request','synthetic-original-digest',now,now,expires,now,now).run();
  await db.prepare("INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,run_id,conversation_revision,brief_revision,user_text,assistant_text,state,policy_json,created_at,updated_at) VALUES(?,?,'synthetic-turn','{\"message\":\"private\"}',?,0,0,'Private question','Private answer','completed','{\"version\":1}',?,?)")
    .bind(turn,project,briefingRun,now,now).run();
  const start=await id('start'),decision=await id('decision'),queuedDecision=await id('queued-decision');
  await db.prepare(`INSERT INTO canvas_agent_start_intents(id,project_id,user_id,request_key,input_json,source_turn_id,expected_revision,source_brief_revision,state,run_id,created_at,updated_at,expires_at)
    VALUES(?,?,?,'synthetic-start','{"accepted":true}',?,0,0,'started',?,?,?,?)`).bind(start,project,owner,turn,run,now,now,expires).run();
  for(const [decisionId,state]of[[decision,'consumed'],[queuedDecision,'pending']])await db.prepare(`INSERT INTO canvas_agent_conversation_decisions(id,project_id,user_id,request_key,kind,state,input_json,scope_json,source_turn_id,run_id,created_at,updated_at,expires_at)
    VALUES(?,?,?,?,'production_start',?,'{"user":"yes"}','{"budget":1000}',?,?,?,?,?)`).bind(decisionId,project,owner,decisionId,state,turn,run,now,now,expires).run();
  // Cover an accepted applying phase too; deleting a project must clear its
  // authority without rewriting the accepted request, plan or billing receipt.
  await db.prepare("UPDATE canvas_agent_runs SET status='applying' WHERE id=?").bind(run).run();
  await db.prepare('UPDATE canvas_projects SET revision=revision+1 WHERE id=?').bind(project).run();
  check((await db.prepare('SELECT status,lease_token FROM canvas_agent_runs WHERE id=?').bind(run).first()).status==='applying','Ordinary graph revision changes preserve the applying transaction');
  const originalOperation=await db.prepare('SELECT * FROM canvas_agent_model_operations WHERE id=?').bind(operation).first();
  const originalStart=await db.prepare('SELECT * FROM canvas_agent_start_intents WHERE id=?').bind(start).first();
  const originalDecision=await db.prepare('SELECT * FROM canvas_agent_conversation_decisions WHERE id=?').bind(decision).first();
  const originalStep=await db.prepare('SELECT * FROM canvas_agent_steps WHERE id=?').bind(step).first();
  check((await request(path,'DELETE',{user:other})).status===404,'Cross-owner deletion must not disclose or mutate the project');

  // Independent broken-case control: reproduce the previous cascading trigger
  // against populated immutable source-turn references through the same DELETE.
  const installed=(await db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='canvas_agent_manual_edit'").first()).sql;
  await db.prepare('DROP TRIGGER canvas_agent_manual_edit').run();
  try{
    await db.prepare(`CREATE TRIGGER canvas_agent_manual_edit AFTER UPDATE OF revision,deleted_at ON canvas_projects
      WHEN NEW.revision IS NOT OLD.revision OR NEW.deleted_at IS NOT OLD.deleted_at
      BEGIN DELETE FROM canvas_agent_conversations WHERE project_id=NEW.id AND NEW.deleted_at IS NOT NULL; END`).run();
    await payload(await request(path,'DELETE'),500);
    check(!(await db.prepare('SELECT deleted_at FROM canvas_projects WHERE id=?').bind(project).first()).deleted_at,'Foreign-key failure rolls back the whole project deletion');
    check((await db.prepare('SELECT state,user_text FROM canvas_agent_turns WHERE id=?').bind(turn).first()).user_text==='Private question','Failed delete retains original conversation');
  }finally{
    await db.prepare('DROP TRIGGER canvas_agent_manual_edit').run();
    await db.prepare(installed).run();
  }
  failCleanup=true;
  const deleted=(await payload(await request(path,'DELETE'))).data;
  check(deleted.deleted===true&&deleted.cleanupPending===true&&typeof deleted.diagnosticRef==='string','Committed project deletion truthfully reports deferred cleanup');
  check(cleanupFailures===1,'Fault was reached after commit, not inferred from the HTTP result');
  const snapshot=await db.prepare('SELECT * FROM canvas_projects WHERE id=?').bind(project).first();
  check(Boolean(snapshot.deleted_at),'Project tombstone is durable');
  check((await request(path)).status===404,'Deleted project is not readable through the normal API');
  for(const table of ['canvas_nodes','canvas_edges'])check((await db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE project_id=? AND deleted_at IS NULL`).bind(project).first()).n===0,'All owned graph rows are soft deleted');
  const conversation=await db.prepare('SELECT * FROM canvas_agent_conversations WHERE project_id=?').bind(project).first();
  check(conversation.state==='cancelled'&&conversation.draft===''&&JSON.stringify(JSON.parse(conversation.brief_json))===JSON.stringify(blankBrief),'Deleted creative memory is redacted, not retained as hidden active context');
  const tombstone=await db.prepare('SELECT * FROM canvas_agent_turns WHERE id=?').bind(turn).first();
  check(tombstone.state==='deleted'&&tombstone.user_text===''&&tombstone.assistant_text===null&&tombstone.input_json==='{}'&&tombstone.run_id===briefingRun,'Turn identity remains while private dialogue is erased');
  for(const [table,key,value]of[['canvas_agent_model_operations',operation,originalOperation],['canvas_agent_start_intents',start,originalStart],['canvas_agent_conversation_decisions',decision,originalDecision],['canvas_agent_steps',step,originalStep]])
    check(JSON.stringify(await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(key).first())===JSON.stringify(value),'Accepted operation and approval evidence is immutable across deletion');
  for(const runId of [run,briefingRun]){
    const row=await db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(runId).first();
    check(row.status==='paused'&&!row.lease_token&&!row.lease_until&&row.input_json==='{"original":"accepted"}','Both active production and briefing are fenced without rewriting their inputs');
  }
  check((await db.prepare('SELECT state FROM canvas_agent_conversation_decisions WHERE id=?').bind(queuedDecision).first()).state==='cancelled','A pending spending decision is revoked');
  let stopped=false;
  try{await processCanvasAgentConversation(env,await db.prepare('SELECT * FROM canvas_agent_runs WHERE id=?').bind(briefingRun).first(),{id:owner});}catch(error){stopped=error.code==='canvas_agent_conversation_stopped';}
  check(stopped&&providerCalls.length===0,'Late conversation work cannot restore deleted memory or invoke a provider');
  let revoked=false;
  try{await canvasAgentSession(new Request(`https://bitbi.ai${path}/nodes/${node}/run`),canvasAgentEnvironment(env,{runId:run,stepId:step,projectId:project,userId:owner,leaseToken:'synthetic-original-lease'}));}catch(error){revoked=error.code==='canvas_agent_authority_revoked';}
  check(revoked,'Late production dispatch cannot use revoked project authority');
  await payload(await request(path,'DELETE')); // original successful HTTP reply may have been lost
  check(JSON.stringify(await db.prepare('SELECT * FROM canvas_projects WHERE id=?').bind(project).first())===JSON.stringify(snapshot),'Duplicate DELETE preserves the original tombstone and revision');
  failCleanup=false;
  check((await payload(await request(path,'DELETE'))).data.cleanupPending===false,'The same DELETE can finish deferred cleanup without recreating a project');
  check((await request(path,'DELETE',{user:other})).status===404,'Tombstones remain owner-private');

  const uncommitted=await createProject('uncommitted'),uncommittedPath=`/api/account/canvas/projects/${uncommitted}`;
  failBatch=true;await payload(await request(uncommittedPath,'DELETE'),500);
  check(!(await db.prepare('SELECT deleted_at FROM canvas_projects WHERE id=?').bind(uncommitted).first()).deleted_at,'A true precommit failure cannot report deletion');
  loseBatchReply=true;await payload(await request(uncommittedPath,'DELETE'),500);
  check(Boolean((await db.prepare('SELECT deleted_at FROM canvas_projects WHERE id=?').bind(uncommitted).first()).deleted_at),'Ambiguous transport can lose an already committed batch reply');
  await payload(await request(uncommittedPath,'DELETE'));

  // Calibrate actual authenticated graph writes before interleaving DELETE.
  // These controls use the same routes and SQL as the rejected late writes.
  const editable=await createProject('ordinary-edits'),editablePath=`/api/account/canvas/projects/${editable}`;
  const firstNode=(await payload(await request(`${editablePath}/nodes`,'POST',{body:{type:'note',title:'First'}}),201)).data.node.id;
  const nextNode=(await payload(await request(`${editablePath}/nodes`,'POST',{body:{type:'note',title:'Next'}}),201)).data.node.id;
  const connection=(await payload(await request(`${editablePath}/edges`,'POST',{body:{source_node_id:firstNode,target_node_id:nextNode}}),201)).data.edge.id;
  await payload(await request(editablePath,'PATCH',{body:{title:'Renamed editable project'}}));
  await payload(await request(`${editablePath}/nodes/${firstNode}`,'PATCH',{body:{title:'Edited note'}}));
  await payload(await request(`${editablePath}/edges/${connection}`,'PATCH',{body:{label:'Edited connection'}}));
  check((await db.prepare('SELECT title FROM canvas_projects WHERE id=?').bind(editable).first()).title==='Renamed editable project','Normal project edits really persist');
  check((await db.prepare('SELECT title FROM canvas_nodes WHERE id=?').bind(firstNode).first()).title==='Edited note','Normal node edits really persist');
  check((await db.prepare('SELECT label FROM canvas_edges WHERE id=?').bind(connection).first()).label==='Edited connection','Normal edge edits really persist');

  const raceCases=[
    {kind:'create-node',prefix:'INSERT INTO canvas_nodes',method:'POST',target:'nodes',code:'project_not_found'},
    {kind:'create-edge-project',prefix:'INSERT INTO canvas_edges',method:'POST',target:'edges',code:'project_not_found'},
    {kind:'create-edge-endpoint',prefix:'INSERT INTO canvas_edges',method:'POST',target:'edges',code:'node_not_found',removeEndpoint:true},
    {kind:'rename-project',prefix:'UPDATE canvas_projects SET title = ?',method:'PATCH',target:'',code:'project_not_found'},
    {kind:'edit-node',prefix:'UPDATE canvas_nodes SET title = ?',method:'PATCH',target:'node',code:'node_not_found'},
    {kind:'edit-edge',prefix:'UPDATE canvas_edges SET label = ?',method:'PATCH',target:'edge',code:'edge_not_found',removeEndpoint:true},
  ];
  for(const scenario of raceCases){
    const raceProject=await createProject(scenario.kind),racePath=`/api/account/canvas/projects/${raceProject}`;
    const source=await createNode(raceProject,`${scenario.kind}:source`),target=await createNode(raceProject,`${scenario.kind}:target`),edgeId=await id(`${scenario.kind}:edge`);
    if(scenario.target==='edge')await db.prepare('INSERT INTO canvas_edges(id,project_id,user_id,source_node_id,target_node_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .bind(edgeId,raceProject,owner,source,target,now,now).run();
    let enter,release;
    const entered=new Promise(resolve=>{enter=resolve;}),released=new Promise(resolve=>{release=resolve;});
    statementFence={prefix:scenario.prefix,enter,released};
    const suffix=scenario.target==='node'?`nodes/${source}`:scenario.target==='edge'?`edges/${edgeId}`:scenario.target;
    const body=scenario.target==='nodes'?{type:'note',title:'Late node'}:scenario.target==='edges'?{source_node_id:source,target_node_id:target}:scenario.target==='edge'?{label:'Late label'}:{title:'Late title'};
    const writing=request(`${racePath}${suffix?`/${suffix}`:''}`,scenario.method,{body});
    // A rejected request before the intended boundary is a fixture failure,
    // not evidence that the SQL guard prevented this deletion race.
    await Promise.race([entered,writing.then(response=>{throw new Error(`Mutation fence not reached for ${scenario.kind}: ${response.status}`);})]);
    let snapshot;
    const readSnapshot=async()=>({project:await db.prepare('SELECT * FROM canvas_projects WHERE id=?').bind(raceProject).first(),
      nodes:(await db.prepare('SELECT * FROM canvas_nodes WHERE project_id=? ORDER BY id').bind(raceProject).all()).results,
      edges:(await db.prepare('SELECT * FROM canvas_edges WHERE project_id=? ORDER BY id').bind(raceProject).all()).results});
    try{
      await payload(await request(scenario.removeEndpoint?`${racePath}/nodes/${target}`:racePath,'DELETE'));
      snapshot=await readSnapshot();
    }finally{release();statementFence=null;}
    const rejected=await payload(await writing,404);
    check(rejected.code===scenario.code,`Precise missing-resource response after ${scenario.kind}`);
    check(JSON.stringify(await readSnapshot())===JSON.stringify(snapshot),`Late ${scenario.kind} cannot create active children or rewrite deleted history`);
  }

  const active=await createProject('active'),removed=await createNode(active,'removed-node');
  failCleanup=true;
  check((await payload(await request(`/api/account/canvas/projects/${active}/nodes/${removed}`,'DELETE'))).data.cleanupPending===true,'Node deletion also survives postcommit cleanup failure');
  check(Boolean((await db.prepare('SELECT deleted_at FROM canvas_nodes WHERE id=?').bind(removed).first()).deleted_at),'Node was actually removed');
  const textNode=await createNode(active,'text-node','text_generation'),model='@cf/meta/llama-3.1-8b-instruct-fast';
  await db.prepare('UPDATE canvas_nodes SET model_id=?,config_json=? WHERE id=?').bind(model,JSON.stringify({prompt:'Write a short scene.',maxTokens:100}),textNode).run();
  await grantMemberCredits({env,userId:owner,amount:100,createdByUserId:owner,idempotencyKey:'lifecycle-credit-grant'});
  const runPath=`/api/account/canvas/projects/${active}/nodes/${textNode}/run`;
  // A normal generation acknowledges the current tariff, just like Canvas.
  // The broken header must still reject before any provider call or debit.
  const tariff=(await getModelTariff(env)).revision,headers={[TARIFF_HEADER]:String(tariff)};
  const stale=await payload(await request(runPath,'POST',{key:'lifecycle-stale-tariff',headers:{[TARIFF_HEADER]:String(tariff-1)}}),409);
  check(stale.code==='model_pricing_stale'&&providerCalls.length===0,'A stale tariff cannot reach the provider');
  check((await db.prepare('SELECT COUNT(*) n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(owner).first()).n===0,'Rejected stale-price work cannot debit credits');
  const generated=(await payload(await request(runPath,'POST',{headers}))).data;
  check(generated.cleanupPending===true&&generated.run.status==='completed'&&generated.run.output.text==='A persisted synthetic scene.','A saved generation remains successful when unrelated cleanup fails');
  const saved=await db.prepare('SELECT status,output_json,usage_attempt_id FROM canvas_runs WHERE id=?').bind(generated.run.id).first();
  check(saved.status==='completed'&&JSON.parse(saved.output_json).text===generated.run.output.text&&Boolean(saved.usage_attempt_id),'Completed output and usage identity are durable');
  check(providerCalls.length===1,'Only the intended synthetic generation was dispatched');
  const charges=(await db.prepare('SELECT COUNT(*) n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(owner).first()).n;
  check(charges===1,'One committed generation debit');
  const replay=(await payload(await request(runPath,'POST',{headers}))).data;
  check(replay.idempotent_replay===true&&replay.run.id===generated.run.id&&providerCalls.length===1,'Retrying the response never generates another result');
  check((await db.prepare('SELECT COUNT(*) n FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(owner).first()).n===charges,'Generation replay cannot debit again');
  await Promise.all(pending);
  return{foreignKeyCountercontrol:true,committedDeletion:true,redactedHistory:true,duplicateDeletion:true,lateWorkFenced:true,lateGraphWritesFenced:raceCases.length,cleanupFailureBoundaries:3,completedGenerationReplayed:true};
}
