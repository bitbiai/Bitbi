import { nowIso } from './tokens.js';

const types=new Set(['action','decision_summary','provider_summary','media','error']);
const messages={
    started:['Production authorized. Preparing a plan within your credit ceiling.','Produktion freigegeben. Ein Plan innerhalb deines Creditlimits wird vorbereitet.'],
    planning:['The assistant is preparing the storyboard. Waiting for the provider response.','Der Assistent erstellt das Storyboard. Die Anbieterantwort steht noch aus.'],
    proposed:['The storyboard is saved and available for inspection.','Das Storyboard ist gespeichert und kann angesehen werden.'],
    repairing:['The saved plan needs a correction. Preparing a bounded revision within the budget.','Der gespeicherte Plan benötigt eine Korrektur. Eine begrenzte Überarbeitung innerhalb des Budgets wird vorbereitet.'],
    applied:['The editable Canvas project is ready. Generating the planned media.','Das bearbeitbare Canvas-Projekt ist angelegt. Die geplanten Medien werden erstellt.'],
    generating:['Generating this Canvas node. Accepted requests continue in the background.','Dieser Canvas-Knoten wird generiert. Angenommene Aufträge laufen im Hintergrund weiter.'],
    media_ready:['A generated result is saved and available in Canvas.','Ein generiertes Ergebnis ist gespeichert und in Canvas verfügbar.'],
    technical_only:['The budget covers technical media checks. A paid visual review is omitted.','Das Budget deckt die technischen Medienprüfungen. Eine kostenpflichtige visuelle Bewertung entfällt.'],
    budget:['The next action exceeds the authorized ceiling. Waiting for your budget decision.','Die nächste Aktion überschreitet das freigegebene Limit. Deine Budgetentscheidung steht aus.'],
    accepted:['The displayed credit ceiling was approved. Continuing the saved production.','Das angezeigte Creditlimit wurde genehmigt. Die gespeicherte Produktion wird fortgesetzt.'],
    declined:['The credit ceiling stays unchanged. Checking a cheaper alternative.','Das Creditlimit bleibt unverändert. Eine günstigere Alternative wird geprüft.'],
    paused:['Production is paused. Existing work and accepted requests are retained.','Die Produktion pausiert. Vorhandene Arbeit und angenommene Aufträge bleiben erhalten.'],
    cancelled:['Production was cancelled. Already accepted results and costs are retained.','Die Produktion wurde abgebrochen. Bereits angenommene Ergebnisse und Kosten bleiben erhalten.'],
    taken_over:['Manual control is active. The assistant will not start further work.','Die manuelle Bearbeitung ist aktiv. Der Assistent startet keine weiteren Arbeiten.'],
    exporting:['Assembling and checking the saved video.','Das gespeicherte Video wird zusammengesetzt und geprüft.'],
    completed:['The playable final video is saved. The Canvas project remains editable.','Das abspielbare fertige Video ist gespeichert. Das Canvas-Projekt bleibt bearbeitbar.'],
};
export function canvasAgentEventStatement(env,run,key,type,fields={}) {
    if(!types.has(type)||typeof key!=='string'||key.length>180)throw new TypeError('Invalid Canvas event');
    const locale=JSON.parse(run.input_json||'{}').locale==='de'?1:0;
    const payload={...fields,...(messages[fields.code]?{text:messages[fields.code][locale]}:{})};
    const json=JSON.stringify(payload);
    if(new TextEncoder().encode(json).length>12000)throw new TypeError('Canvas event too large');
    return env.DB.prepare(`INSERT INTO canvas_agent_events(run_id,event_key,type,payload_json,created_at)
        VALUES(?,?,?,?,?) ON CONFLICT(run_id,event_key) DO NOTHING`).bind(run.id,key,type,json,nowIso());
}
export async function appendCanvasAgentEvent(env,run,key,type,fields={}) {
    await canvasAgentEventStatement(env,run,key,type,fields).run();
    if(type==='error')await (await import('./canvas-agent-incidents.js')).captureCanvasProjectIncidents(env,run.project_id,run.user_id);
}
export async function readCanvasAgentEvents(env,runId,after=0) {
    if(!Number.isSafeInteger(after)||after<0)throw Object.assign(new Error('canvas_agent_event_cursor_invalid'),{code:'canvas_agent_event_cursor_invalid',status:400});
    const rows=(await env.DB.prepare('SELECT id,type,payload_json,created_at FROM canvas_agent_events WHERE run_id=? AND id>? ORDER BY id LIMIT 101').bind(runId,after).all()).results;
    const events=rows.slice(0,100).map(row=>({id:row.id,at:row.created_at,type:row.type,...JSON.parse(row.payload_json)}));
    return {events,eventCursor:events.at(-1)?.id||after,hasMore:rows.length>100};
}
export async function persistCanvasAgentProposal(env,run,step,plan) {
    if(!plan||!Array.isArray(plan.nodes)||!plan.assembly)throw Object.assign(new Error('canvas_agent_completed_plan_missing'),{code:'canvas_agent_completed_plan_missing',status:409});
    const json=JSON.stringify(plan);
    if(new TextEncoder().encode(json).length>100000)throw Object.assign(new Error('canvas_agent_plan_invalid'),{code:'canvas_agent_plan_invalid'});
    const now=nowIso();
    await env.DB.prepare(`INSERT INTO canvas_agent_proposals(step_id,run_id,plan_json,created_at,updated_at)
        VALUES(?,?,?,?,?) ON CONFLICT(step_id) DO NOTHING`).bind(step.id,run.id,json,now,now).run();
    const existing=await env.DB.prepare('SELECT plan_json FROM canvas_agent_proposals WHERE step_id=? AND run_id=?').bind(step.id,run.id).first();
    if(existing?.plan_json!==json)throw Object.assign(new Error('canvas_agent_proposal_conflict'),{code:'canvas_agent_proposal_conflict'});
    await appendCanvasAgentEvent(env,run,`proposal:${step.id}`,'action',{code:'proposed',phase:'validating',model:run.model_id||'xai/grok-4.7',tool:'plan.validate'});
}
export async function markCanvasAgentProposal(env,stepId,status,validation) {
    const value={issues:(validation?.issues||[]).slice(0,16),repairs:(validation?.repairs||[]).slice(0,32),costs:validation?.costs||null};
    await env.DB.prepare('UPDATE canvas_agent_proposals SET status=?,validation_json=?,updated_at=? WHERE step_id=?')
        .bind(status,JSON.stringify(value),nowIso(),stepId).run();
}
export async function publicCanvasAgentProposal(env,run) {
    const row=await env.DB.prepare('SELECT * FROM canvas_agent_proposals WHERE run_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').bind(run.id).first();
    if(!row)return null;
    const plan=JSON.parse(row.plan_json),validation=JSON.parse(row.validation_json||'{}');
    const nodes=plan.nodes||[],updates=plan.updates||[];
    return {revision:row.step_id,status:row.status,title:plan.title||'',summary:plan.summary||'',continuity:plan.continuity||'',
        targetDurationSeconds:plan.assembly?.targetDurationSeconds??run.target_seconds,
        audioTreatment:plan.audioTreatment||'',shots:(plan.assembly?.clips||[]).map((clip,index)=>{
            const node=nodes.find(n=>n.key===clip.key)||updates.find(n=>`existing:${n.nodeId}`===clip.key);
            return {id:clip.key,title:node?.title||`Shot ${index+1}`,description:node?.prompt||'',model:node?.modelId||null,
                durationSeconds:clip.trim?.duration??node?.config?.duration??node?.config?.seedance25?.duration??null,
                nodeId:clip.key.startsWith('existing:')?clip.key.slice(9):null};
        }),nodes:plan.nodes,assembly:plan.assembly,validation,createdAt:row.created_at};
}
export async function publicCanvasAgentOutputs(env,run) {
    const nodes=(await env.DB.prepare(`SELECT n.id,n.type,n.title,n.asset_id,n.output_json FROM canvas_nodes n
        WHERE n.project_id=? AND n.user_id=? AND n.deleted_at IS NULL AND n.output_json IS NOT NULL
        AND EXISTS(SELECT 1 FROM canvas_agent_steps s JOIN canvas_agent_runs r ON r.id=s.run_id
          WHERE s.node_id=n.id AND r.project_id=n.project_id) ORDER BY n.updated_at LIMIT 60`).bind(run.project_id,run.user_id).all()).results;
    return nodes.flatMap(n=>{
        const output=JSON.parse(n.output_json),type=({image_generation:'image',video_generation:'video',music_generation:'audio',text_generation:'text'})[n.type];
        if(!type)return [];
        const id=n.asset_id||output.assetId||output.asset?.id;
        if(type==='text')return [{type,nodeId:n.id,title:n.title,text:String(output.text||output.result?.text||'').slice(0,12000)}];
        if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))return [];
        return [{type,nodeId:n.id,title:n.title,fileUrl:type==='image'?`/api/ai/images/${id}/file`:`/api/ai/text-assets/${id}/file`,
            previewUrl:type==='image'?`/api/ai/images/${id}/thumb`:`/api/ai/text-assets/${id}/poster`}];
    });
}
// This is only an observer. Closing a stream cannot own, cancel or restart work.
export function canvasAgentEventStream(env,run,userId,after,signal) {
    let stopped=false;
    return new Response(new ReadableStream({
        async start(controller){
            const encoder=new TextEncoder(),started=Date.now();let cursor=after,bytes=0;
            const send=(name,data)=>{const chunk=encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);bytes+=chunk.length;controller.enqueue(chunk);};
            try {while(!stopped&&!signal?.aborted&&Date.now()-started<25000&&bytes<2_000_000){
                const owner=await env.DB.prepare(`SELECT p.id FROM canvas_projects p JOIN users u ON u.id=p.user_id
                    WHERE p.id=? AND p.user_id=? AND p.deleted_at IS NULL AND u.status='active'`).bind(run.project_id,userId).first();
                if(!owner)break;
                const page=await readCanvasAgentEvents(env,run.id,cursor);
                for(const event of page.events){if(stopped||signal?.aborted)break;send('canvas_event',event);cursor=event.id;}
                if(stopped||signal?.aborted)break;
                send('heartbeat',{eventCursor:cursor,at:nowIso()});
                if(!page.hasMore)await new Promise(resolve=>setTimeout(resolve,2000));
            }}catch {if(!stopped&&!signal?.aborted)send('disconnected',{eventCursor:cursor});}
            finally {if(!stopped){stopped=true;controller.close();}}
        },cancel(){stopped=true;}
    }),{headers:{'Content-Type':'text/event-stream','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
