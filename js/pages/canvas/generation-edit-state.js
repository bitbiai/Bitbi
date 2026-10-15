import { canvasGenerationSettings } from '../../shared/canvas-generation-settings.mjs?v=__ASSET_VERSION__';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const json=value=>JSON.stringify(canonical(value));
const sorted=value=>[...value].sort();
const settingsKeys=new Set(['model','prompt','system_prompt','reasoningEffort','max_tokens','temperature','steps','seed','width','height','quality','resolution','aspectRatio','size','outputFormat','background','safetyTolerance','workflow','duration','aspect_ratio','ratio','negative_prompt','generate_audio','watermark','instrumental','generateLyrics','lyrics','music_length_ms','force_instrumental','composition_plan','respect_sections_durations']);

// A comparison is evidence about the selected output, never an instruction to
// execute it. Missing historical inputs remain unknown, including paged history.
export function generationEditState(node, analysis, runs) {
    if(!node.output?.runId)return 'none';
    const run=runs.find(item=>item.id===node.output.runId&&item.status==='completed');
    const previous=run?.input?.generation;
    if(!previous||!analysis?.model)return 'unknown';
    if((run.model_id||run.input.model_id)!==analysis.model.id)return 'changed';
    let current;try{current=canvasGenerationSettings(node.config||{},analysis.model,analysis.effectivePrompt);}catch{return 'changed';}
    let incomplete=false;
    for(const key of new Set([...Object.keys(current),...Object.keys(previous)])) {
        if(!settingsKeys.has(key))continue;
        // Older provider requests may omit defaults. Absence is not proof that
        // rendering a default control changed the generated pixels.
        if(!Object.hasOwn(previous,key)||!Object.hasOwn(current,key)){incomplete=true;continue;}
        if(json(previous[key])!==json(current[key]))return 'changed';
    }
    const sources=analysis.sources||[],input=run.input;
    for(const [key,values] of [['connected_node_ids',sources.map(source=>source.sourceNodeId)],['connected_asset_ids',sources.map(source=>source.assetId).filter(Boolean)]]) {
        if(Array.isArray(input[key])) {if(json(sorted(input[key]))!==json(sorted(values)))return 'changed';}
        else if(values.length)incomplete=true;
    }
    for(const used of input.used_sources||[]) {
        const source=sources.find(item=>item.edgeId===used.edgeId);
        if(!source||used.assetId&&source.assetId!==used.assetId||used.runId&&source.runId!==used.runId)return 'changed';
    }
    for(const source of sources.filter(item=>item.assetId)) {
        const reference=previous.references?.find(item=>item.source?.asset_id===source.assetId);
        if(reference?.role&&source.h3Role&&reference.role!==source.h3Role)return 'changed';
        if(source.videoInput&&input.connected_video_inputs) {
            const referenceInput=input.connected_video_inputs.find(item=>item.edgeId===source.edgeId);
            if(referenceInput&&referenceInput.method!==source.videoInput.method)return 'changed';
        }
    }
    // Provider-specific reference transforms can add derived private frames and
    // reorder references. Without a complete comparison, keep that uncertainty.
    if(sources.some(source=>source.assetId)||previous.source_images?.length||previous.referenceOrder?.length)incomplete=true;
    return incomplete?'unknown':'unchanged';
}

export function generationEditMessage(state,german) {
    if(state==='changed')return german?'Generierungseinstellungen geändert. Erneut ausführen, um die Änderungen anzuwenden; die gespeicherte Ausgabe bleibt unverändert.':'Generation settings changed. Rerun to apply the changes; the saved output stays unchanged.';
    if(state==='unknown')return german?'Gespeicherte Ausgabe. Frühere Eingaben sind nicht vollständig vergleichbar. Nach Änderungen an der Generierung erneut ausführen.':'Saved output. Previous inputs cannot be fully compared. Rerun after changing generation settings.';
    return '';
}
