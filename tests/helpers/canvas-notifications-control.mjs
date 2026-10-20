import worker from '../../workers/auth/src/index.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { getModelTariff } from '../../workers/auth/src/lib/model-tariffs.js';
import { TARIFF_HEADER } from '../../js/shared/model-tariff.mjs';

const check=(value,message)=>{if(!value)throw new Error(message);};
const api='/api/account/canvas/notifications';
const iso=offset=>new Date(Date.now()+offset).toISOString();
function transport(env,owner){
  return (path=api,body=null,user=owner)=>worker.fetch(new Request(`https://bitbi.ai${path}`,{
    method:body?'POST':'GET',headers:{Origin:'https://bitbi.ai',Cookie:`__Host-bitbi_session=${user}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),
  }),env,{waitUntil(){}});
}
async function bodyOf(response,status=200){const body=await response.json();check(response.status===status,`Notifications expected ${status}, got ${response.status}/${body.code}`);check(response.headers.get('Cache-Control')==='private, no-store','Inbox responses remain private and uncached');return body.data;}
async function conversationRejection(response,status,code){
  const body=await response.json();
  check(response.status===status,`Conversation rejection expected ${status}, got ${response.status}/${body.code}`);
  // Rejections use the existing Canvas error boundary, not the inbox responder.
  check(response.headers.get('Cache-Control')==='no-store','Conversation errors remain uncached');
  check(body?.ok===false&&body.code===code&&body.error===code&&Object.keys(body).sort().join(',')==='code,error,ok',
    'Conversation errors expose only the expected safe rejection, never draft or project data');
}
async function seed(env,suffix){
  const db=env.DB,owner=`canvas-notice-${suffix}`,other=`${owner}-other`,old=iso(-172800000),now=iso(0),expires=iso(3600000);
  const id=async label=>(await sha256Hex(`${owner}:${label}`)).slice(0,32),project=await id('project'),foreign=await id('foreign'),node=await id('node'),complete=await id('complete'),failed=await id('failed');
  for(const user of [owner,other]){
    await db.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,?,?,'user','active',?)").bind(user,`${user}@example.invalid`,'synthetic',old,old).run();
    await db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)').bind(user,user,await sha256Hex(`${user}:${env.SESSION_HASH_SECRET}`),now,expires,now).run();
  }
  for(const [p,u]of[[project,owner],[foreign,other]])await db.prepare("INSERT INTO canvas_projects(id,user_id,title,created_at,updated_at) VALUES(?,?,'Synthetic notification project',?,?)").bind(p,u,old,old).run();
  await db.prepare("INSERT INTO canvas_nodes(id,project_id,user_id,type,x,y,created_at,updated_at) VALUES(?,?,?,'video_generation',0,0,?,?)").bind(node,project,owner,old,old).run();
  for(const [run,status,error]of[[complete,'completed',null],[failed,'failed','canvas_media_invalid']])await db.prepare(`INSERT INTO canvas_runs(id,project_id,node_id,user_id,model_id,operation_type,idempotency_key,status,input_json,output_json,error_code,created_at,updated_at,completed_at)
    VALUES(?,?,?,?,'minimax/h3','canvas.video.generate',?,?,'{"synthetic":"input"}','{"synthetic":"output"}',?,?,?,?)`).bind(run,project,node,owner,run,status,error,old,old,old).run();
  return{owner,other,project,foreign,node,complete,failed,old};
}
export async function seedCanvasNotificationsMigration(env){
  const fixture=await seed(env,'migration');
  const rows=(await env.DB.prepare('SELECT * FROM canvas_runs WHERE project_id=? ORDER BY id').bind(fixture.project).all()).results;
  const turn=(await sha256Hex('notice-migration-turn')).slice(0,32),decision=(await sha256Hex('notice-migration-decision')).slice(0,32);
  await env.DB.prepare("INSERT INTO canvas_agent_conversations(project_id,user_id,brief_json,created_at,updated_at) VALUES(?,?,'{}',?,?)").bind(fixture.project,fixture.owner,fixture.old,fixture.old).run();
  await env.DB.prepare("INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,state,created_at,updated_at) VALUES(?,?,'old-turn','{}',0,0,'Retained synthetic historical message','completed',?,?)").bind(turn,fixture.project,fixture.old,fixture.old).run();
  await env.DB.prepare(`INSERT INTO canvas_agent_conversation_decisions(id,project_id,user_id,request_key,kind,state,input_json,scope_json,source_turn_id,created_at,updated_at,expires_at)
    VALUES(?,?,?,'old-consumed-decision','production_start','consumed','{"original":true}','{"budget":1000}',?,?,?,?)`).bind(decision,fixture.project,fixture.owner,turn,fixture.old,fixture.old,iso(3600000)).run();
  await env.DB.prepare(`INSERT INTO canvas_agent_conversation_actions(project_id,request_key,input_json,created_at)
    VALUES(?,'old-saved-control','{"kind":"control","action":"save","draft":"Private historical draft","expectedConversationRevision":0}',?)`).bind(fixture.project,fixture.old).run();
  const originalTurn=await env.DB.prepare('SELECT * FROM canvas_agent_turns WHERE id=?').bind(turn).first(),originalDecision=await env.DB.prepare('SELECT * FROM canvas_agent_conversation_decisions WHERE id=?').bind(decision).first();
  const originalControl=await env.DB.prepare("SELECT * FROM canvas_agent_conversation_actions WHERE project_id=? AND request_key='old-saved-control'").bind(fixture.project).first();
  return{...fixture,rows,originalTurn,originalDecision,originalControl};
}
export async function verifyCanvasNotificationsMigration(env,fixture){
  const rows=(await env.DB.prepare('SELECT * FROM canvas_runs WHERE project_id=? ORDER BY id').bind(fixture.project).all()).results;
  check(JSON.stringify(rows)===JSON.stringify(fixture.rows),'Notification migration preserves original generation evidence');
  for(const [table,row]of[['canvas_agent_turns',fixture.originalTurn],['canvas_agent_conversation_decisions',fixture.originalDecision]])
    check(JSON.stringify(await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(row.id).first())===JSON.stringify(row),'Migration preserves populated immutable source-turn references');
  check(JSON.stringify(await env.DB.prepare("SELECT * FROM canvas_agent_conversation_actions WHERE project_id=? AND request_key='old-saved-control'").bind(fixture.project).first())===JSON.stringify(fixture.originalControl),'Migration preserves the original control receipt without rewriting its draft or identity');
  const request=transport(env,fixture.owner),data=await bodyOf(await request());
  check(data.items.find(item=>item.id===`run:${fixture.complete}:completed`)?.readAt===data.baselineAt,'Old resolved output starts read');
  check(data.items.find(item=>item.id===`conversation-control:${fixture.project}:control:0`)?.readAt===data.baselineAt,'Old committed control receipts start read under the same rollout baseline');
  check(data.items.find(item=>item.id===`run:${fixture.failed}:failed:canvas_media_invalid`)?.readAt===null&&data.unreadCount===1,'Old unresolved failure stays unread');
  check((await env.DB.prepare('SELECT COUNT(*) n FROM canvas_notification_reads WHERE user_id=?').bind(fixture.owner).first()).n===0,'Migration and GET do not fabricate per-viewer acknowledgements');
  return{originalRowsPreserved:2,oldResolvedRead:true,oldUnresolvedUnread:true,readWrites:0};
}
async function notificationReadBatchBoundary(env){
  const f=await seed(env,'read-batch'),db=env.DB,request=transport(env,f.owner),now=iso(0);
  const ids=await Promise.all(Array.from({length:101},(_,index)=>sha256Hex(`${f.owner}:notice:${index}`).then(value=>value.slice(0,32))));
  await db.prepare(`INSERT INTO canvas_notification_clients(id,user_id,request_key,project_id,code,http_status,created_at)
    SELECT value,?,value,?,'network_error',0,? FROM json_each(?)`).bind(f.owner,f.project,now,JSON.stringify(ids.slice(0,100))).run();
  const selected=ids.slice(0,100).map(id=>`client:${id}`),unselected=`client:${ids[100]}`;
  const savedReads=async()=> (await db.prepare('SELECT notification_id,read_at FROM canvas_notification_reads WHERE user_id=? ORDER BY notification_id').bind(f.owner).all()).results;
  await bodyOf(await request(`${api}/read`,{ids:[...selected,unselected]}),400);
  check((await savedReads()).length===0,'A 101-ID request is rejected before any acknowledgements are written');
  const before=await bodyOf(await request(`${api}?limit=80`));
  check(Boolean(before.nextCursor),'The maximum acknowledgement spans more than one ordinary page');
  const next=await bodyOf(await request(`${api}?limit=80&cursor=${encodeURIComponent(before.nextCursor)}`));
  const presented=[...before.items,...next.items].map(item=>item.id);
  check(selected.every(id=>presented.includes(id)),'All 100 acknowledged identities were returned by owned paginated GETs');
  await db.prepare("INSERT INTO canvas_notification_clients(id,user_id,request_key,project_id,code,http_status,created_at) VALUES(?,?,?,?,'network_error',0,?)").bind(ids[100],f.owner,ids[100],f.project,iso(0)).run();
  const accepted=await bodyOf(await request(`${api}/read`,{ids:selected}));
  check(accepted.viewerId===f.owner&&accepted.readIds.length===100&&JSON.stringify([...accepted.readIds].sort())===JSON.stringify([...selected].sort()),'The real read endpoint acknowledges all 100 selected owned IDs');
  check(accepted.unreadCount===before.unreadCount+1-100,'A full acknowledgement consumes exactly its selected rows and preserves the later arrival');
  const saved=await savedReads();
  check(saved.length===100&&saved.every(row=>selected.includes(row.notification_id)),'The 100-ID acknowledgement stores no unselected identity');
  check(!await db.prepare('SELECT notification_id FROM canvas_notification_reads WHERE user_id=? AND notification_id=?').bind(f.owner,unselected).first(),'An unselected arrival remains unread after the maximum batch');
  const repeated=await bodyOf(await request(`${api}/read`,{ids:selected}));
  check(repeated.readIds.length===100&&repeated.unreadCount===accepted.unreadCount&&JSON.stringify(await savedReads())===JSON.stringify(saved),'Replaying a 100-ID batch preserves read timestamps and exact unread counts');
  const foreign=await bodyOf(await request(`${api}/read`,{ids:[selected[0],selected[99]]},f.other));
  check(foreign.viewerId===f.other&&foreign.readIds.length===0,'The compact ID selection cannot acknowledge another viewer’s history');
  check((await db.prepare('SELECT COUNT(*) n FROM canvas_notification_reads WHERE user_id=?').bind(f.other).first()).n===0,'A foreign selection writes no acknowledgements');
}
async function conversationControlNotifications(base){
  const f=await seed(base,'conversation-controls'),db=base.DB;
  let paidCalls=0,wakes=0;
  const env={...base,AI:{async run(){paidCalls++;throw new Error('Notification controls cannot invoke inference');}},
    AI_VIDEO_JOBS_QUEUE:{async send(){wakes++;throw new Error('Notification reads cannot schedule production');}}};
  const request=transport(env,f.owner),path=`/api/account/canvas/projects/${f.project}/agent/conversation`;
  const read=async()=> (await bodyOf(await request(path))).conversation;
  const tariff=String((await getModelTariff(env)).revision);
  const post=(suffix,body,key,user=f.owner)=>worker.fetch(new Request(`https://bitbi.ai${path}/${suffix}`,{
    method:'POST',headers:{Origin:'https://bitbi.ai',Cookie:`__Host-bitbi_session=${user}`,'Content-Type':'application/json',
      'Idempotency-Key':key,[TARIFF_HEADER]:tariff},body:JSON.stringify(body),
  }),env,{waitUntil(){}});
  const notices=async()=> (await bodyOf(await request(`${api}?projectId=${f.project}`))).items.filter(item=>item.id.startsWith('conversation-control:'));
  const receipts=async()=> (await db.prepare('SELECT * FROM canvas_agent_conversation_actions WHERE project_id=? ORDER BY request_key').bind(f.project).all()).results;
  const initial=await read(),project=await db.prepare('SELECT * FROM canvas_projects WHERE id=?').bind(f.project).first();
  const nodes=(await db.prepare('SELECT * FROM canvas_nodes WHERE project_id=? ORDER BY id').bind(f.project).all()).results;
  const runs=(await db.prepare('SELECT * FROM canvas_runs WHERE project_id=? ORDER BY id').bind(f.project).all()).results;
  check((await notices()).length===0,'No saved acknowledgement exists without an accepted control receipt');
  const draft='PRIVATE-SYNTHETIC-DRAFT-DO-NOT-PROJECT';
  const save={action:'save',draft,expectedConversationRevision:initial.revision},saveKey='private-synthetic-save-identity';
  await conversationRejection(await post('control',{...save,expectedConversationRevision:initial.revision+1},'notice-stale-save'),409,'canvas_agent_conversation_changed');
  await conversationRejection(await post('control',save,'notice-foreign-save',f.other),404,'project_not_found');
  check((await receipts()).length===0&&(await notices()).length===0,'Rejected stale/foreign writes produce no success receipt or notification');
  await bodyOf(await post('control',save,saveKey));
  check((await read()).state==='saved'&&(await read()).draft===draft,'The actual save endpoint persists the draft before exposing a success');
  const saved=(await notices())[0],saveId=`conversation-control:${f.project}:control:${initial.revision}`;
  check(saved?.id===saveId&&saved.code==='canvas_brief_saved'&&saved.confirmed&&saved.resolved
    &&saved.source==='conversation'&&saved.kind==='control'&&saved.status==='completed'&&saved.details.actionType==='brief_save','Save notification comes from its committed guarded receipt');
  await bodyOf(await request(`${api}/read`,{ids:[saveId]}));
  const readAt=(await notices())[0].readAt;
  await bodyOf(await post('control',save,saveKey));
  check((await receipts()).length===1&&(await notices()).length===1&&(await notices())[0].readAt===readAt,'Save replay preserves the same notification and read identity');
  await conversationRejection(await post('control',{...save,draft:'Different draft'},saveKey),409,'idempotency_conflict');
  const accepted=[];
  for(const action of ['resume','cancel','clear']){
    const current=await read(),input={action,expectedConversationRevision:current.revision},key=`notification-control-${action}`;
    await bodyOf(await post('control',input,key));await bodyOf(await post('control',input,key));
    accepted.push({action,revision:current.revision});
    const currentState=await read();
    check(currentState.state===(action==='cancel'?'cancelled':'active'),'Each control keeps its normal conversation effect');
    if(action==='clear')check(currentState.draft===''&&currentState.messages.length===0,'Clear removes creative conversation content through the normal caller');
  }
  const current=await read(),allowance={capCredits:20,expectedConversationRevision:current.revision};
  await bodyOf(await post('allowance',allowance,'notification-direct-allowance'));
  await bodyOf(await post('allowance',allowance,'notification-direct-allowance'));
  check((await read()).allowance.capCredits===20,'The direct allowance receipt follows the real saved briefing ceiling');
  const items=await notices();
  check(items.length===4&&['canvas_brief_saved','canvas_brief_cancelled','canvas_brief_cleared','canvas_allowance_accepted'].every(code=>items.filter(item=>item.code===code).length===1),'Only save, cancel, clear and direct allowance produce these four distinct acknowledgements');
  check(!items.some(item=>item.id===`conversation-control:${f.project}:control:${accepted.find(item=>item.action==='resume').revision}`),'Resume is not invented as a saved, cancelled or paid operation');
  check(items.find(item=>item.code==='canvas_allowance_accepted')?.kind==='authorization','Conversation spending scope remains explicit');
  const before=JSON.stringify(await receipts());
  const reread=await bodyOf(await request(`${api}?projectId=${f.project}`));
  check(!JSON.stringify(reread).includes(draft)&&!JSON.stringify(reread).includes(saveKey)&&!JSON.stringify(reread).includes('input_json'),'Notification data excludes drafts, raw request identities and stored input JSON');
  check(JSON.stringify(await receipts())===before,'Notification reads do not rewrite accepted control evidence');
  check(!(await bodyOf(await request(`${api}?projectId=${f.project}`,null,f.other))).items.length,'Control acknowledgements cannot be read by another owner');
  check((await bodyOf(await request(`${api}/read`,{ids:items.map(item=>item.id)},f.other))).readIds.length===0,'Control acknowledgements cannot be marked read by another owner');
  check(JSON.stringify(await db.prepare('SELECT * FROM canvas_projects WHERE id=?').bind(f.project).first())===JSON.stringify(project)
    &&JSON.stringify((await db.prepare('SELECT * FROM canvas_nodes WHERE project_id=? ORDER BY id').bind(f.project).all()).results)===JSON.stringify(nodes)
    &&JSON.stringify((await db.prepare('SELECT * FROM canvas_runs WHERE project_id=? ORDER BY id').bind(f.project).all()).results)===JSON.stringify(runs),'Control notification projection leaves graph, source media and historical generation receipts unchanged');
  check((await db.prepare('SELECT COUNT(*) n FROM canvas_agent_runs WHERE project_id=?').bind(f.project).first()).n===0
    &&(await db.prepare('SELECT COUNT(*) n FROM canvas_agent_model_operations WHERE user_id=?').bind(f.owner).first()).n===0
    &&paidCalls===0&&wakes===0,'Notification controls and readback create no production, paid inference or queue work');
  // Synthetic already-accepted nested receipts exercise projection deduplication;
  // the real control callers above independently prove when a receipt may exist.
  const turn=(await sha256Hex('notification-nested-turn')).slice(0,32),action=(await sha256Hex('notification-nested-action')).slice(0,32);
  const decision=(await sha256Hex('notification-nested-decision')).slice(0,32),now=iso(0);
  await db.prepare("INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,state,created_at,updated_at) VALUES(?,?,'nested-notice-turn','{}',0,0,'Synthetic accepted action','completed',?,?)").bind(turn,f.project,now,now).run();
  await db.prepare(`INSERT INTO canvas_agent_action_receipts(id,project_id,user_id,turn_id,ordinal,input_json,state,result_json,created_at,updated_at)
    VALUES(?,?,?,?,0,'{"action":{"type":"brief_save"}}','completed','{"pending":false}',?,?)`).bind(action,f.project,f.owner,turn,now,now).run();
  await db.prepare(`INSERT INTO canvas_agent_conversation_decisions(id,project_id,user_id,request_key,kind,state,input_json,scope_json,decision_key,created_at,updated_at,expires_at)
    VALUES(?,?,?,'nested-notice-decision','briefing_allowance','consumed','{}','{}','nested-decision-accepted',?,?,?)`).bind(decision,f.project,f.owner,now,now,iso(3600000)).run();
  for(const [key,input]of[
    [`canvas_action_${action}`,{kind:'control',action:'save',expectedConversationRevision:200}],
    [`decision-allowance:${decision}`,{kind:'allowance',capCredits:20,expectedConversationRevision:201}],
    ['nested-decision-accepted',{kind:'decision',decisionId:decision}],
    ['canvas_action_unknown',{kind:'control',action:'save',expectedConversationRevision:202}],
  ])await db.prepare('INSERT INTO canvas_agent_conversation_actions(project_id,request_key,input_json,created_at) VALUES(?,?,?,?)').bind(f.project,key,JSON.stringify(input),now).run();
  const nested=await bodyOf(await request(`${api}?projectId=${f.project}`));
  check(nested.items.filter(item=>item.details.actionId===action).length===1&&nested.items.filter(item=>item.details.decisionId===decision).length===1,'Nested action and approval outcomes keep their existing canonical projection');
  check(!nested.items.some(item=>item.id===`conversation-control:${f.project}:control:200`||item.id===`conversation-control:${f.project}:allowance:201`),'An inner service receipt cannot duplicate its proven parent action or decision');
  check(nested.items.some(item=>item.id===`conversation-control:${f.project}:control:202`),'An unproven request-key prefix alone cannot suppress a committed control');
}
export async function canvasNotificationsCase(env){
  const f=await seed(env,'api'),db=env.DB,request=transport(env,f.owner),now=iso(0),expires=iso(3600000);
  const id=async label=>(await sha256Hex(`notifications:${label}`)).slice(0,32);
  const initial=await bodyOf(await request());
  check(initial.viewerId===f.owner&&initial.unreadCount===1,'Viewer and rollout semantics come from authenticated context');
  check(initial.items.every(item=>item.projectDeleted===false),'Active owned projects remain navigable');
  const foreign=await bodyOf(await request(api,null,f.other));
  check(foreign.viewerId===f.other&&foreign.items.every(item=>item.projectId===f.foreign),'Other account receives only its own history');
  check((await bodyOf(await request(`${api}?projectId=${f.foreign}`))).items.length===0,'Project filtering cannot cross ownership');
  const post=(input,user=f.owner)=>request(`${api}/client`,input,user);
  const notice=(requestId,extra={})=>({requestId,code:'network_error',projectId:f.project,status:0,...extra});
  const first=await bodyOf(await post(notice('notice-transport-one')),201);
  check(first.item.source==='client'&&!first.item.confirmed&&first.item.severity==='warning','Client transport assertion never becomes confirmed operation history');
  const replay=await bodyOf(await post(notice('notice-transport-one')),201);
  check(replay.item.id===first.item.id,'Same accepted transport identity deduplicates across tabs');
  const tabs=await Promise.all([post(notice('notice-concurrent-tabs')),post(notice('notice-concurrent-tabs'))]);
  const tabItems=await Promise.all(tabs.map(response=>bodyOf(response,201)));
  check(tabItems[0].item.id===tabItems[1].item.id,'Concurrent tabs retain one durable notice identity');
  const conflict=await Promise.all([post(notice('notice-concurrent-inputs')),post(notice('notice-concurrent-inputs',{status:502}))]);
  check(conflict.map(response=>response.status).sort().join(',')==='201,409','Concurrent changed input cannot silently reuse a different accepted notice');
  for(const response of conflict)await response.json();
  await bodyOf(await post(notice('notice-transport-one',{status:503})),409);
  await bodyOf(await post(notice('notice-foreign-project',{projectId:f.foreign})),404);
  await bodyOf(await post(notice('notice-forged-role',{authorized:true})),400);
  await bodyOf(await post(notice('notice-private-payload',{message:'Private provider text'})),400);
  await bodyOf(await post(notice('notice-arbitrary-code',{code:'invented_provider_result'})),400);
  const technical=await bodyOf(await post(notice('notice-safe-technical',{errorCode:'future_precise_failure'})),201);
  check(technical.item.details.errorCode==='future_precise_failure'&&!technical.item.confirmed,'Unknown safe technical code survives reload without becoming an authoritative outcome');
  await bodyOf(await post(notice('notice-safe-technical',{errorCode:'different_failure'})),409);
  await bodyOf(await post(notice('notice-hostile-technical',{errorCode:'<script>private payload</script>'})),400);
  check((await bodyOf(await request())).items.find(item=>item.id===technical.item.id)?.details.errorCode==='future_precise_failure','Persisted technical diagnostic remains available after reread');
  const sameForeign=await bodyOf(await post(notice('notice-transport-one',{projectId:f.foreign}),f.other),201);
  check(sameForeign.item.id!==first.item.id,'Request identities are account-scoped');
  const page=await bodyOf(await request(`${api}?limit=1`));
  check(page.items.length===1&&Boolean(page.nextCursor),'Partial pages retain a cursor');
  const next=await bodyOf(await request(`${api}?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`));
  check(next.items.length===1&&next.items[0].id!==page.items[0].id,'Cursor follows deterministic identities without duplicate page items');
  check((await db.prepare('SELECT COUNT(*) n FROM canvas_notification_reads WHERE user_id=?').bind(f.owner).first()).n===0,'Viewing multiple pages does not mark history read');
  const late=await bodyOf(await post(notice('notice-arrived-after-page')),201);
  const read=await bodyOf(await request(`${api}/read`,{ids:[page.items[0].id,page.items[0].id,sameForeign.item.id]}));
  check(read.readIds.length===1&&read.readIds[0]===page.items[0].id,'Ack binds exact displayed owned IDs and ignores foreign IDs');
  const afterRead=await bodyOf(await request());
  check(afterRead.items.find(item=>item.id===late.item.id)?.readAt===null&&afterRead.unreadCount>=1,'A new arrival during acknowledgement remains unread');
  const repeated=await bodyOf(await request(`${api}/read`,{ids:[page.items[0].id]}));
  check(repeated.unreadCount===afterRead.unreadCount,'Replayed acknowledgement is idempotent');
  await bodyOf(await request(`${api}/read`,{ids:[],readAll:true}),400);
  await bodyOf(await request(`${api}?cursor=not-base64`),400);
  await bodyOf(await request(`${api}?limit=1000`),400);
  // Legacy async Canvas rows use status=failed while provider work is pending.
  // A later permanent error must have a fresh outcome identity despite keeping
  // that status; timestamps/heartbeats alone must never change the identity.
  await db.prepare("UPDATE canvas_runs SET error_code='canvas_video_pending',updated_at=? WHERE id=?").bind(now,f.failed).run();
  const waiting=(await bodyOf(await request())).items.find(item=>item.details.runId===f.failed);
  check(waiting.severity==='info'&&waiting.id.endsWith(':canvas_video_pending'),'Accepted pending work is informational');
  await bodyOf(await request(`${api}/read`,{ids:[waiting.id]}));
  await db.prepare("UPDATE canvas_runs SET error_code='canvas_video_review_required',updated_at=? WHERE id=?").bind(iso(1),f.failed).run();
  const material=(await bodyOf(await request())).items.find(item=>item.details.runId===f.failed);
  check(material.id!==waiting.id&&material.readAt===null&&material.severity==='error','A later real failure is not hidden by the pending acknowledgement');
  await db.prepare('UPDATE canvas_runs SET updated_at=? WHERE id=?').bind(iso(2),f.failed).run();
  check((await bodyOf(await request())).items.find(item=>item.details.runId===f.failed).id===material.id,'An unchanged failure heartbeat does not create another notification');

  // A complete canonical export remains ready even if its separate poster fails.
  // Notification reads consume the job fact; they must not claim, retry or render.
  const exportId=await id('export'),assetId=await id('owned-result');
  await db.prepare(`INSERT INTO canvas_video_processing(id,user_id,project_id,node_id,kind,sources_json,status,asset_id,error_code,next_attempt_at,created_at,updated_at)
    VALUES(?,?,?,?,'concat','[]','failed',?,'canvas_poster_failed',?,?,?)`).bind(exportId,f.owner,f.project,f.node,assetId,now,now,now).run();
  const production=await id('production'),briefing=await id('briefing');
  for(const [run,purpose]of[[production,'production'],[briefing,'briefing']])await db.prepare(`INSERT INTO canvas_agent_runs(id,project_id,user_id,request_key,input_json,status,purpose,expected_revision,budget_credits,next_attempt_at,created_at,updated_at,expires_at)
    VALUES(?,?,?,?,'{}','blocked',?,0,100,?,?,?,?)`).bind(run,f.project,f.owner,run,purpose,now,now,now,expires).run();
  const event=async(run,key,payload)=>{await db.prepare("INSERT INTO canvas_agent_events(run_id,event_key,type,payload_json,created_at) VALUES(?,?,'error',?,?)").bind(run,key,JSON.stringify(payload),now).run();return(await db.prepare('SELECT id FROM canvas_agent_events WHERE run_id=? AND event_key=?').bind(run,key).first()).id;};
  const known=await event(production,'first',{code:'model_unavailable',tool:'production.readiness'});
  await event(production,'repeat',{code:'model_unavailable',tool:'production.readiness'});
  const withoutTool=[await event(production,'unknown-one',{code:'canvas_request_failed'}),await event(production,'unknown-two',{code:'canvas_request_failed'})];
  const hidden=await event(briefing,'private-briefing',{code:'private_briefing'});
  const turn=await id('action-turn'),action=await id('action'),readOnly=await id('readonly-action');
  await db.prepare("INSERT INTO canvas_agent_conversations(project_id,user_id,brief_json,created_at,updated_at) VALUES(?,?,'{}',?,?)").bind(f.project,f.owner,now,now).run();
  await db.prepare("INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,state,created_at,updated_at) VALUES(?,?,'notification-turn','{}',0,0,'Synthetic action','completed',?,?)").bind(turn,f.project,now,now).run();
  for(const [key,ordinal,type]of[[action,0,'export'],[readOnly,1,'status']])await db.prepare(`INSERT INTO canvas_agent_action_receipts(id,project_id,user_id,turn_id,ordinal,input_json,state,result_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'completed','{"pending":true}',?,?)`).bind(key,f.project,f.owner,turn,ordinal,JSON.stringify({action:{type}}),now,now).run();
  const before=await db.prepare('SELECT * FROM canvas_video_processing WHERE id=?').bind(exportId).first();
  const canonical=await bodyOf(await request());
  const video=canonical.items.find(item=>item.id===`export:${exportId}:ready`);
  check(video?.code==='canvas_export_ready'&&video.details.assetId===assetId&&video.details.posterPending===true&&video.severity==='success','Saved final result outranks a separate failed poster');
  check(canonical.items.filter(item=>item.source==='event').length===3&&canonical.items.some(item=>item.id===`event:${known}`)&&withoutTool.every(key=>canonical.items.some(item=>item.id===`event:${key}`)),'Readiness duplicates coalesce; distinct null-tool errors remain visible');
  check(!canonical.items.some(item=>item.id===`event:${hidden}`),'Briefing ledger is not fabricated as production progress');
  check((await bodyOf(await post({requestId:'source-event-link',source:'event',sourceId:String(known)}),201)).item?.id===`event:${known}`,'A bare immutable event identity resolves without a fake state suffix');
  check((await bodyOf(await post({requestId:'source-project-link',source:'lifecycle',sourceId:f.project}),201)).item?.id===`project:${f.project}:created`,'Lifecycle source identities use the canonical project prefix');
  const pending=canonical.items.find(item=>item.id===`action:${action}:completed:1`);
  check(pending?.code==='canvas_agent_action_pending'&&pending.severity==='info'&&!canonical.items.some(item=>item.details.actionId===readOnly),'Pending action stays pending and read-only status actions do not spam history');
  await bodyOf(await request(`${api}/read`,{ids:[pending.id]}));
  await db.prepare('UPDATE canvas_agent_action_receipts SET result_json=?,updated_at=? WHERE id=?').bind('{"pending":false}',iso(1),action).run();
  const finished=await bodyOf(await request());
  check(finished.items.find(item=>item.id===`action:${action}:completed:0`)?.readAt===null,'A later action result needs its own acknowledgement');
  const linked=await bodyOf(await post({requestId:'source-export-link',source:'export',sourceId:exportId}),201);
  check(linked.item.id===video.id&&linked.item.confirmed,'Client links canonical evidence instead of inventing a duplicate notice');
  check((await bodyOf(await post({requestId:'source-wildcard-link',source:'export',sourceId:'_'.repeat(32)}),201)).item===null,'Underscores in source IDs are literal, never SQL wildcards');
  check((await bodyOf(await post({requestId:'source-foreign-link',source:'export',sourceId:exportId},f.other),201)).item===null,'Canonical source lookup cannot expose another owner');
  check(JSON.stringify(await db.prepare('SELECT * FROM canvas_video_processing WHERE id=?').bind(exportId).first())===JSON.stringify(before),'Notifications never claim or execute export work');
  check((await db.prepare('SELECT COUNT(*) n FROM canvas_agent_model_operations WHERE user_id=?').bind(f.owner).first()).n===0,'Production event display invokes no language model');
  const removed=await worker.fetch(new Request(`https://bitbi.ai/api/account/canvas/projects/${f.project}`,{method:'DELETE',headers:{Origin:'https://bitbi.ai',Cookie:`__Host-bitbi_session=${f.owner}`}}),env,{waitUntil(){}});
  check(removed.ok,'Owned project deletion still uses its normal service');
  const deleted=await bodyOf(await request());
  check(deleted.items.some(item=>item.id===`project:${f.project}:deleted`&&item.confirmed&&item.projectDeleted===true),'Account inbox retains canonical deletion evidence without linking to a removed project');
  check(!deleted.items.some(item=>['action','event','run','export','conversation'].includes(item.source)&&item.projectId===f.project),'Deleted creative context is no longer exposed by operational projections');
  check(deleted.items.find(item=>item.id===first.item.id)?.confirmed===false&&deleted.items.find(item=>item.id===first.item.id)?.projectDeleted===true,'Client history keeps its unconfirmed provenance and removed-project context');
  await notificationReadBatchBoundary(env);
  await conversationControlNotifications(env);
  return{ownerIsolation:true,baseline:true,explicitReadIds:true,arrivalPreserved:true,clientDeduplicated:true,canonicalOnly:true,posterTruth:true,deletedProjectNotice:true};
}
