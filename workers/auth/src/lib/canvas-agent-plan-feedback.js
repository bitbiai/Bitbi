import { isGptImage25Model } from '../../../../js/shared/gpt-image-25-contract.mjs';
import { H3_MODEL, H3_LIMITS } from '../../../../js/shared/minimax-h3.mjs';
import { OMNI_MODEL } from '../../../../js/shared/gemini-omni-contract.mjs';
import { SEEDANCE_25_MODEL, SEEDANCE_25_REFERENCE_LIMITS } from '../../../../js/shared/seedance-25-contract.mjs';
import { getCanvasModelForRole } from '../../../../js/shared/canvas-model-contract.mjs';

// Parameter names are application-owned; values come only from the integrated
// model contract. Never quote the rejected value or an arbitrary exception.
export const CANVAS_AGENT_CHOICE_CONTROLS=Object.freeze({aspectRatio:'aspectRatioOptions',quality:'qualityOptions',resolution:'resolutionOptions',size:'sizeOptions',outputFormat:'outputFormatOptions',background:'backgroundOptions'});
export function canvasAgentParameterError(key) {
    return Object.assign(canvasAgentFeedbackError('canvas_agent_parameter_unsupported'),
        Object.hasOwn(CANVAS_AGENT_CHOICE_CONTROLS,key)?{parameterKey:key}:{});
}
function parameterFeedback(field,modelId) {
    const key=typeof field==='string'&&field.startsWith('config.')?field.slice(7):null;
    const model=typeof modelId==='string'?getCanvasModelForRole(modelId,'member'):null;
    if(!model||!Object.hasOwn(CANVAS_AGENT_CHOICE_CONTROLS,key))return null;
    const options=model.controls[CANVAS_AGENT_CHOICE_CONTROLS[key]];
    const exposed=Array.isArray(options)&&options.length>0;
    const reason=exposed?'value_not_allowed':'parameter_not_exposed';
    return {field:`config.${key}`,reason,
        message:exposed?`${reason}: Choose a supported value for config.${key} from allowed. Preserve any confirmed creative requirement with an eligible model if necessary.`
            :`${reason}: This Canvas model does not expose config.${key}. Omit that setting, or choose an eligible model that explicitly supports it if it is a confirmed requirement.${key==='outputFormat'?' Response transport such as url or b64_json does not select the image file format.':''}`,
        allowed:exposed?options.filter(value=>typeof value==='string'&&value.length<=500&&!/[\u0000-\u001f\u007f]/.test(value)).slice(0,16):[]};
}

// Reconstruct new correction feedback from the current server contract, not
// serialized allowed/message/reason fields. Accepted step payloads stay pinned.
export function canvasAgentParameterCorrectionFeedback(issue) {
    if(issue?.code!=='canvas_agent_parameter_unsupported')return null;
    const precise=parameterFeedback(issue.field,issue.modelId);
    const [field,message]=MESSAGES.canvas_agent_parameter_unsupported;
    if(!precise)return {field,message,allowed:[]};
    // The existing AI repair envelope deliberately has no reason property.
    return {field:precise.field,message:precise.message,allowed:precise.allowed};
}

// Conditional constraints describe the integrated Canvas adapters, not an
// independent provider API. Their validators remain authoritative at dispatch.
export function canvasAgentModelConstraints(model) {
    if(isGptImage25Model(model.id))return {source:'workers/auth/src/lib/model-tariffs.js',operations:[{id:'text_to_image',priced:true},{id:'reference_edit',priced:false,reason:'gpt_image_25_reference_pricing_unavailable'}]};
    if (model.id === H3_MODEL) return {
        source:'js/shared/minimax-h3.mjs',
        referenceModes:[{id:'frames',roles:['first_frame','last_frame'],requires:{aspectRatio:'adaptive'},limits:{first_frame:1,last_frame:1}},
            {id:'reference',roles:['reference_image','reference_video','reference_audio'],limits:{reference_image:H3_LIMITS.image,reference_video:H3_LIMITS.video,reference_audio:H3_LIMITS.audio}}],
        mutuallyExclusiveModes:['frames','reference'],maxReferences:H3_LIMITS.total,
        videoLastFrame:{method:'last_frame',effectiveRole:'first_frame',requires:{aspectRatio:'adaptive'},cannotCombineWith:['reference_image','reference_video','reference_audio']},
        referenceDurationSeconds:{video:{min:2,max:15,totalMax:15},audio:{min:2,max:15,totalMax:15}},
    };
    if (model.id === SEEDANCE_25_MODEL) return {
        source:'js/shared/seedance-25-contract.mjs',maxReferences:52,roleLimits:SEEDANCE_25_REFERENCE_LIMITS,
        conditional:[{when:{role:'last_frame'},requires:{role:'first_frame'}},
            {when:{rolesAny:['first_frame','last_frame']},requires:{'seedance25.aspect_ratio':'adaptive'}},
            {when:{'seedance25.workflowAny':['edit','extend']},requires:{role:'reference_video'}},
            {when:{'seedance25.workflow':'edit'},requires:{'seedance25.duration':-1}}],
        nativeVideoRoles:true,lastFrameExtraction:false,
    };
    if (model.id === OMNI_MODEL) return {source:'js/shared/gemini-omni-contract.mjs',
        roleLimits:{first_frame:1,last_frame:1,reference_image:10,reference_video:1,reference_audio:1},maxReferences:14,
        operationPriority:[{role:'reference_video',operation:'edit'},{role:'last_frame',operation:'frames'},
            {role:'reference_image',operation:'reference'},{role:'first_frame',operation:'image'},{operation:'text'}],
        providerChoosesDuration:true,nativeVideoRoles:true,lastFrameExtraction:false};
    return {source:'js/shared/canvas-model-contract.mjs',
        maxReferenceImages:model.controls.maxReferenceImages||0,
        ...(model.capability==='video'?{maxVideoInputs:1,lastFrameCannotCombineWithImages:true}:{}),
        promptReferences:{roles:['prompt'],sourceKinds:['text','note']}};
}

const MESSAGES={
    omni_capability_disabled:['dependencies','This Omni operation or resolution is disabled for members. Choose an enabled combination from its current readiness flags or another eligible model while preserving the required creative references.'],
    canvas_agent_h3_reference_modes_mixed:['dependencies','H3 cannot combine first/last frames (including extracted video last frames) with image, video or audio reference mode. Replan this shot using one mode; preserve required creative references through a compatible model or reference design.'],
    canvas_agent_h3_frame_ratio_required:['config.aspectRatio','H3 first/last-frame generation requires adaptive aspect ratio. Preserve the requested framing by choosing a suitable source frame, or use reference mode for an explicit output ratio.'],
    canvas_agent_seedance_last_frame_requires_first:['dependencies','Seedance 2.5 requires a first frame whenever a last frame is provided.'],
    canvas_agent_seedance_video_required:['dependencies','Seedance 2.5 edit and extend require a native reference_video source.'],
    canvas_agent_seedance_edit_duration:['config.seedance25.duration','Seedance 2.5 edit requires Auto duration (-1); requested duration cannot be applied to an edit.'],
    canvas_agent_seedance_frame_ratio_required:['config.seedance25.aspect_ratio','Seedance 2.5 frame inputs use adaptive aspect ratio; choose suitable source framing or a reference-only workflow.'],
    canvas_agent_reference_limit:['dependencies','Reduce reference count to this model’s integrated role and total limits, or choose an eligible model that supports all required inputs.'],
    canvas_agent_reference_unsupported:['dependencies','Use the supported media kind, role and operation combination from the capability inventory. Do not drop required creative references silently.'],
    canvas_agent_parameter_unsupported:['config','Choose only this model’s supported settings and values from the capability inventory.'],
    canvas_agent_duration_unsupported:['config.duration','Choose a supported per-request duration; assembly duration is a separate creative target.'],
    canvas_agent_prompt_limit:['prompt','Shorten this node prompt to the selected model’s maximum while preserving the requested subjects and action.'],
    canvas_agent_model_ineligible:['modelId','Choose an enabled, priced member Canvas model with the required capability.'],
    gpt_image_25_reference_pricing_unavailable:['dependencies','GPT Image 2.5 reference editing has no verified input-image price in Canvas. Preserve the reference intent with another enabled, priced image model; text-to-image remains a separate supported operation.'],
    model_pricing_unavailable:['modelId','This model or operation has no verified current Canvas price. Select an eligible priced operation.'],
    canvas_agent_project_limit:['nodes','The proposed graph exceeds the existing project node or connection quota. Reuse existing editable nodes or reduce the proposed graph.'],
    canvas_agent_plan_invalid:['plan','Return a valid plan schema with unique node keys, acyclic generation dependencies and a separate valid playback order.'],
    canvas_agent_assembly_clip_invalid:['assembly.clips','Playback entries must resolve to video nodes in the current project or this proposal.'],
    canvas_agent_assembly_music_invalid:['assembly.musicKey','Background music must resolve to an audio or music node in the current project or this proposal.'],
    canvas_agent_revision_scope_invalid:['updates','Revise only the requested existing nodes and preserve unrelated nodes, playback order, trims, transitions and music.'],
    canvas_agent_trim_outside_planned_source:['assembly.clips','A trim extends beyond the known source duration. Use available source frames; do not pad, freeze or repeat footage.'],
    canvas_agent_target_duration_invalid:['assembly.targetDurationSeconds','Choose a creative target within the admitted production duration bounds.'],
};
export function canvasAgentValidationIssue(error,node=null,model=null) {
    const known=Object.hasOwn(MESSAGES,error?.code)?MESSAGES[error.code]:null;
    const code=known?error.code:'canvas_agent_parameter_unsupported';
    const [field,message]=known||MESSAGES[code];
    const precise=code==='canvas_agent_parameter_unsupported'&&Object.hasOwn(CANVAS_AGENT_CHOICE_CONTROLS,error?.parameterKey)
        ?parameterFeedback(`config.${error.parameterKey}`,model?.id):null;
    return {code,nodeKey:node?.key||null,modelId:model?.id||node?.modelId||null,field,message,
        ...(precise||{}),
        ...(model?{constraints:canvasAgentModelConstraints(model)}:{})};
}
export function canvasAgentFeedbackError(code) {return Object.assign(new Error(code),{code,status:400});}
