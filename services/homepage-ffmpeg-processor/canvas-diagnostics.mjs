// Shared processor/Worker allowlist. Never return tool text, arguments or URLs.
const stages=new Set(['sources','normalize','source_audio','smooth','transitions','music','preview_upload','complete']);
const classes=new Set(['filter','media','configuration','deadline','transient','resource','unknown']);
const reasons=new Set(['timebase_mismatch','filter_configuration','invalid_media','tool_configuration','resource_limit','deadline','output_limit','transport','unknown']);
const osCodes=new Set(['ENOENT','EACCES','EPERM','ENOEXEC','EAGAIN','ENOMEM','E2BIG','EMFILE','ENFILE','ENOTDIR','EINVAL']);
export function safeCanvasDiagnostic(value={}) {
    const result={};
    for(const [key,values] of [['stage',stages],['errorClass',classes],['reason',reasons],['tool',new Set(['ffmpeg','ffprobe','media-tool'])],['osCode',osCodes],['signal',new Set(['SIGKILL','SIGTERM','SIGABRT','SIGSEGV','SIGBUS'])]])if(values.has(value?.[key]))result[key]=value[key];
    for(const key of ['elapsedMs','exit'])if(Number.isSafeInteger(value?.[key])&&value[key]>=0&&value[key]<=(key==='exit'?255:900000))result[key]=value[key];
    if(value?.exit===null)result.exit=null;
    if(value?.signal===null)result.signal=null;
    return result;
}
export function classifyMediaFailure({stderr='',osCode,deadline=false,outputLimit=false}={}) {
    if(deadline)return {code:'canvas_processing_deadline',errorClass:'deadline',reason:'deadline'};
    if(outputLimit)return {code:'canvas_media_output_limit',errorClass:'configuration',reason:'output_limit'};
    if(osCode==='ENOMEM'||/Cannot allocate memory|No space left on device/.test(stderr))return {code:'canvas_media_resource_limit',errorClass:'resource',reason:'resource_limit'};
    if(/timebase .*do not match.*timebase/.test(stderr))return {code:'canvas_media_filter_invalid',errorClass:'filter',reason:'timebase_mismatch'};
    if(/No such filter|Error initializing (?:complex )?filters|Failed to configure output pad|Error reinitializing filters/.test(stderr))return {code:'canvas_media_filter_invalid',errorClass:'filter',reason:'filter_configuration'};
    if(/Invalid data found|Error while decoding|Invalid NAL unit/.test(stderr))return {code:'canvas_media_invalid',errorClass:'media',reason:'invalid_media'};
    if(['EAGAIN','EMFILE','ENFILE'].includes(osCode))return {code:'canvas_processing_transient',errorClass:'transient',reason:'resource_limit'};
    if(osCode||/Unknown encoder|No such file or directory|Error initializing output stream/.test(stderr))return {code:'canvas_media_configuration',errorClass:'configuration',reason:'tool_configuration'};
    return {code:'canvas_media_tool_failed',errorClass:'unknown',reason:'unknown'};
}
export const canvasFailureCanRetry=code=>['canvas_processing_transient','canvas_source_unavailable'].includes(code);

const failureCodes=new Set(('audio_fit_policy_invalid audio_tail_exceeds_video duration_limit frame_rate_unsupported media_limits music_ambiguous music_gain_invalid music_invalid music_unavailable orientation_unsupported output_incomplete output_size_limit picture_timeline_mismatch processing_deadline processing_failed processing_transient processor_protocol sample_aspect_ratio_unsupported seam_index_invalid seam_policy_invalid source_changed source_invalid source_name_invalid source_route_invalid source_size sources_invalid spatial_policy_unsupported stream_layout_unsupported temporary_size_limit transition_invalid transition_too_long transition_incomplete media_timing_invalid seam_decode_incomplete seam_output_mismatch media_output_limit media_filter_invalid media_invalid media_resource_limit media_configuration media_tool_failed source_unavailable poster_failed').split(' ').map(code=>'canvas_'+code));
export const safeCanvasFailureCode=code=>failureCodes.has(code)?code:'canvas_processing_failed';
