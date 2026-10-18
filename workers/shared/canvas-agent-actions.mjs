// Release-controlled proposals, never authorization. IDs refer only to the supplied
// current project; the server independently resolves ownership and revisions.
export const CANVAS_AGENT_ACTION_VERSION = 1;
export const CANVAS_AGENT_ACTION_TYPES = Object.freeze([
  'status','brief_summary','brief_save','brief_resume','brief_cancel','skip_questions','delegate_duration','start_now',
  'production_pause','production_resume','production_cancel','production_takeover',
  'allowance_propose','budget_accept','budget_decline','conversation_clear',
  'focus_node','show_result','show_project','clip_remove','clip_order','clip_add','clip_replace','clip_trim',
  'transition','transition_strength','music_volume','music_enabled','music_fade_in','music_fade_out','music_source','smooth_joins',
  'node_prompt','node_model','node_parameter','original_audio_volume','original_audio_enabled','original_audio_fade_in','original_audio_fade_out','regenerate','export','save_result',
]);
const nullable = schema => ({ anyOf:[schema,{type:'null'}] });
export const CANVAS_AGENT_ACTION_SCHEMA = {type:'object',additionalProperties:false,
  properties:{type:{type:'string',enum:CANVAS_AGENT_ACTION_TYPES},targetId:nullable({type:'string',pattern:'^[a-f0-9]{32}$'}),
    value:nullable({type:'string',maxLength:6000}),number:nullable({type:'number'}),secondaryNumber:nullable({type:'number'}),
    ids:{type:'array',items:{type:'string',pattern:'^[a-f0-9]{32}$'},maxItems:120},revision:{type:'integer',minimum:0}},
  required:['type','targetId','value','number','secondaryNumber','ids','revision']};
const targetTypes = new Set(['focus_node','clip_remove','clip_add','clip_replace','clip_trim','transition','transition_strength','music_source',
  'node_prompt','node_model','node_parameter','original_audio_volume','original_audio_enabled','original_audio_fade_in','original_audio_fade_out','regenerate','save_result']);
const valueTypes = new Set(['transition','music_enabled','smooth_joins','node_prompt','node_model','node_parameter','original_audio_enabled']);
const numberTypes = new Set(['allowance_propose','clip_add','clip_trim','transition','transition_strength','music_volume','music_fade_in','music_fade_out','node_parameter','original_audio_volume','original_audio_fade_in','original_audio_fade_out']);
const idsTypes = new Set(['clip_order','clip_replace']);
const fail=()=>{throw Object.assign(new TypeError('canvas_agent_action_invalid'),{code:'canvas_agent_action_invalid',status:400,outcome:'not_submitted'});};
export function validateCanvasAgentActions(actions,{projectRevision}={}) {
  if(!Array.isArray(actions)||actions.length>4)fail();
  for(const action of actions){
    if(!action||Array.isArray(action)||typeof action!=='object'||Object.keys(action).sort().join(',')!=='ids,number,revision,secondaryNumber,targetId,type,value'
      ||!CANVAS_AGENT_ACTION_TYPES.includes(action.type)||!Number.isSafeInteger(action.revision)||action.revision<0
      ||projectRevision!==undefined&&action.revision!==projectRevision
      ||(targetTypes.has(action.type)? !/^[a-f0-9]{32}$/.test(action.targetId||''):action.targetId!==null)
      ||(valueTypes.has(action.type)?typeof action.value!=='string'||!action.value.trim()||action.value.length>6000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(action.value):action.value!==null)
      ||(numberTypes.has(action.type)?action.number!==null&&!Number.isFinite(action.number):action.number!==null)
      ||(action.type==='clip_trim'?action.secondaryNumber!==null&&!Number.isFinite(action.secondaryNumber):action.secondaryNumber!==null)
      ||!Array.isArray(action.ids)||action.ids.length>120||action.ids.some(id=>!/^[a-f0-9]{32}$/.test(id))
      ||new Set(action.ids).size!==action.ids.length||(!idsTypes.has(action.type)&&action.ids.length))fail();
    if(['music_enabled','smooth_joins','original_audio_enabled'].includes(action.type)&&!['on','off'].includes(action.value)
      ||action.type==='clip_replace'&&action.ids.length!==1||action.type==='clip_order'&&!action.ids.length
      ||action.type==='allowance_propose'&&(!Number.isSafeInteger(action.number)||action.number<1||action.number>100000)
      ||['clip_trim','transition_strength','music_volume','music_fade_in','music_fade_out','node_parameter','original_audio_volume','original_audio_fade_in','original_audio_fade_out'].includes(action.type)&&action.number===null
      ||['music_volume','original_audio_volume'].includes(action.type)&&(action.number<0||action.number>1)
      ||['music_fade_in','music_fade_out','original_audio_fade_in','original_audio_fade_out'].includes(action.type)&&(action.number<0||action.number>600))fail();
  }
  if(new Set(actions.map(action=>JSON.stringify(action))).size!==actions.length)fail();
  return structuredClone(actions);
}

export { detectCanvasDirectControl, canvasImmediateStartRequested } from '../../js/shared/canvas-agent-control-intent.mjs';
