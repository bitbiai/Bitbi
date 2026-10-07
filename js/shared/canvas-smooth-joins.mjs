// Versioned render contract, shared by admission, Inspector and result checks.
// No technical interpolation controls or arbitrary filter strings are accepted.
export const CANVAS_SEAM_POLICY='motion-anchors-v1';
export function smoothJoinSettings(value=false) {
    if(typeof value!=='boolean')throw Object.assign(new Error('canvas_smooth_settings'),{code:'canvas_smooth_settings',status:400});
    return {enabled:value,policy:CANVAS_SEAM_POLICY};
}
export function seamPreviewSettings(value,count) {
    if(value===undefined)return null;
    if(!value||Object.keys(value).join(',')!=='seamIndex'||!Number.isInteger(value.seamIndex)||value.seamIndex<0||value.seamIndex>=count-1)
        throw Object.assign(new Error('canvas_seam_index_invalid'),{code:'canvas_seam_index_invalid',status:400});
    return {seamIndex:value.seamIndex};
}
export function validSeamResult(value,{enabled,preview,count}) {
    const reasons=['explicit_transition','short_clip','analysis_budget','resolution_budget','cadence_budget','uncertain_motion','uncertain_pause','still_or_changing_motion','scene_or_geometry_change','already_smooth','direction_change','quality_fallback','repeated_boundary','small_motion_jump'];
    if(!value||value.policy!==CANVAS_SEAM_POLICY||!Array.isArray(value.seams)||value.seams.length!==(enabled?(preview?1:count-1):0))return false;
    if(value.improved!==value.seams.filter(seam=>seam.improved===true).length)return false;
    return value.seams.every((seam,i)=>seam.index===(preview?.seamIndex??i)&&Number.isFinite(seam.at)&&seam.at>0&&seam.at<600&&reasons.includes(seam.reason)
        &&(seam.improved===undefined||seam.improved===true&&['repeated_boundary','small_motion_jump'].includes(seam.reason)));
}
export function smoothJoinResultText(result,german=false) {
    if(!result)return '';
    const explicit=result.seams?.filter(seam=>seam.reason==='explicit_transition').length||0;
    const total=(result.seams?.length||0)-explicit;if(!total&&!explicit)return '';
    const effects=explicit?(german?` ${explicit} mit gewähltem Videoübergang statt Glättung.`:` ${explicit} use the selected video transition instead of smoothing.`):'';
    if(!total)return effects.trim();
    const bounded=result.seams.filter(seam=>seam.reason.endsWith('_budget')).length;
    const limit=bounded?(german?` ${bounded} davon außerhalb der Verarbeitungsgrenzen.`:` ${bounded} exceed the processing limits.`):'';
    return (german?`${result.improved} von ${total} Übergängen geglättet. ${total-result.improved} unverändert (bereits flüssig oder nicht sicher verbesserbar).`
        :`${result.improved} of ${total} joins smoothed. ${total-result.improved} unchanged (already smooth or no safe improvement).`)+limit+effects;
}
