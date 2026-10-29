// Native browser bridge: the established runtime runner owns isolation, build
// and disposal. All commands call the real Auth route/owner/D1 services.
import assert from 'node:assert/strict';

export async function createNativeVoiceBrowserBridge(runtime,{name,artifacts,locale='de'}){
let identity,socket,provider,onSocket=()=>{},onClose=()=>{};
const send=value=>value.event==='socket'?onSocket(value.data):onClose(value);
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
async function execute(command,input){
  if(command==='init'){
    identity=await json(await runtime.control('/canvas-voice-owner-seed',{name:input.name,credits:10000,locale}));
    provider=await runtime.mf.getWorker('q2-voice-provider');
    await json(await provider.fetch('https://voice-fixture.invalid/journey/reset',{method:'POST',body:'{}'}));
    return identity;
  }
  assert(runtime&&identity,'Initialize the isolated native runtime first');
  if(command==='provider')return json(await provider.fetch('https://voice-fixture.invalid/journey/'+(input?'emit':'state'),input?{method:'POST',body:JSON.stringify(input)}:{}));
  if(command==='fetch'||command==='socket'){
    const path=new URL(input.url,'https://bitbi.ai').pathname;
    const ownedPath=`/api/account/canvas/projects/${identity.projectId}/agent`;
    assert((path===ownedPath||path.startsWith(ownedPath+'/'))
      ||path==='/api/model-pricing'&&(!input.method||input.method==='GET'),'Bridge only the synthetic owned project or read-only canonical pricing');
    const response=await runtime.mf.dispatchFetch('https://bitbi.ai'+path,{method:input.method||'GET',headers:{
      Origin:'https://bitbi.ai',Cookie:`__Host-bitbi_session=${identity.userId}`,'Content-Type':'application/json',
      ...(input.headers||{}),...(command==='socket'?{Upgrade:'websocket'}:{})},...(input.body!==undefined&&input.body!==null?{body:input.body}:{})});
    if(command==='socket'){
      assert.equal(response.status,101,response.status===101?'':await response.clone().text());socket=response.webSocket;
      socket.addEventListener('message',event=>send({event:'socket',data:event.data}));
      socket.addEventListener('close',event=>send({event:'closed',code:event.code,reason:event.reason}));socket.accept();return {connected:true};
    }
    return {status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer()).toString('base64')};
  }
  if(command==='send'){assert(socket,'Native socket required');socket.send(input);return true;}
  if(command==='close'){try{socket?.close(1000);}catch{/* already closed */}return true;}
  if(command==='snapshot'){
    const one=sql=>runtime.db.prepare(sql).bind(identity.projectId).first();
    return {
      conversation:await one('SELECT revision,brief_revision,brief_json FROM canvas_agent_conversations WHERE project_id=?'),
      turns:(await runtime.db.prepare('SELECT user_text,state FROM canvas_agent_turns WHERE project_id=? ORDER BY rowid').bind(identity.projectId).all()).results,
      runs:(await runtime.db.prepare('SELECT id,status,budget_credits FROM canvas_agent_runs WHERE project_id=? ORDER BY rowid').bind(identity.projectId).all()).results,
      sessions:(await runtime.db.prepare('SELECT id,state,exposure_json FROM canvas_voice_sessions WHERE project_id=? ORDER BY rowid').bind(identity.projectId).all()).results,
      voiceTurns:(await runtime.db.prepare('SELECT v.provider_response_id,v.interrupted,v.heard_audio_ms,v.retained_text FROM canvas_voice_turns v JOIN canvas_agent_turns t ON t.id=v.turn_id WHERE t.project_id=?').bind(identity.projectId).all()).results,
    };
  }
  throw new Error('Unknown browser/native fixture command');
}
identity=await execute('init',{name});
return {call:execute,identity,artifacts,setSocket(receive,close){onSocket=receive;onClose=close;}};
}
