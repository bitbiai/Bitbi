// Explicit operator review of a stored answer, never a runtime config cleanup.
// The owner accepts the provider's native format; this does not promise JPEG.
import { getCanvasModelForRole } from '../../../../js/shared/canvas-model-contract.mjs';

export const CANVAS_PLAN_NATIVE_FORMAT_POLICY='canvas-plan-reviewed-native-format-v2';
const MODEL='xai/grok-imagine-image-2.0';
const fail=()=>{throw Object.assign(new Error('canvas_agent_plan_format_approval_invalid'),{code:'canvas_agent_plan_format_approval_invalid',status:409});};
const fields=['version','sourceResponseDigest','approvalRef','nodeKeys','requestedFormat','effectiveFormat'];
export function assertCanvasPlanNativeFormatReviewSupported(){
    const model=getCanvasModelForRole(MODEL,'member');
    if(!model?.runnable||model.capability!=='image'||!Array.isArray(model.controls.outputFormatOptions)||model.controls.outputFormatOptions.length)fail();
}
export function deriveCanvasReviewedNativeFormat(plan,approval,sourceResponseDigest){
    if(!approval||typeof approval!=='object'||Array.isArray(approval)||Object.keys(approval).some(key=>!fields.includes(key))
        ||approval.version!==1||approval.requestedFormat!=='jpeg'||approval.effectiveFormat!=='provider-native'
        ||typeof approval.approvalRef!=='string'||!/^\w[\w.:/-]{0,159}$/.test(approval.approvalRef)
        ||typeof approval.sourceResponseDigest!=='string'||!/^[a-f0-9]{64}$/.test(approval.sourceResponseDigest)
        ||approval.sourceResponseDigest!==sourceResponseDigest||!Array.isArray(approval.nodeKeys)||!approval.nodeKeys.length
        ||approval.nodeKeys.length>60||approval.nodeKeys.some(key=>typeof key!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(key))
        ||new Set(approval.nodeKeys).size!==approval.nodeKeys.length)fail();
    const nodes=plan.nodes.filter(node=>node.type==='image_generation'&&node.modelId===MODEL&&node.config?.outputFormat==='jpeg');
    const keys=nodes.map(node=>node.key).sort(),approved=[...approval.nodeKeys].sort();
    // Only plan.nodes creates new nodes. Existing-node updates and other models
    // cannot enter the complete approved set, even if their key is supplied.
    if(!keys.length||JSON.stringify(keys)!==JSON.stringify(approved))fail();
    const candidate=structuredClone(plan),changes=[];
    for(const key of keys){
        const index=candidate.nodes.findIndex(node=>node.key===key);
        delete candidate.nodes[index].config.outputFormat;
        changes.push({path:`plan.nodes[${index}].config.outputFormat`,nodeKey:key,modelId:MODEL,from:'jpeg',to:'provider-native'});
    }
    return {plan:candidate,approval:{...approval,nodeKeys:approved},changes};
}
