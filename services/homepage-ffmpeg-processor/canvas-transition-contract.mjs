export const TRANSITION_POLICY='overlap-v1';
export const TRANSITIONS=Object.freeze([
    {id:'none',group:'none',en:'None · hard cut',de:'Keine · harter Schnitt'},
    {id:'fade',group:'dissolve',en:'Cross dissolve',de:'Weiche Überblendung'},
    {id:'dissolve',group:'dissolve',en:'Granular dissolve',de:'Körnige Überblendung'},
    {id:'fadeblack',group:'dissolve',en:'Fade through black',de:'Über Schwarz'},
    {id:'fadewhite',group:'dissolve',en:'Fade through white',de:'Über Weiß'},
    {id:'directional',group:'blur',en:'Directional blur',de:'Gerichtete Unschärfe',parameter:'strength',min:4,max:24,default:12},
    {id:'radial-blur',group:'blur',en:'Radial blur',de:'Radiale Unschärfe',parameter:'strength',min:2,max:10,default:5},
    {id:'zoom-blur',group:'blur',en:'Zoom blur',de:'Zoom-Unschärfe',parameter:'strength',min:.03,max:.15,default:.08},
    {id:'zoomin',group:'motion',en:'Zoom in',de:'Heranzoomen'},
    {id:'slideleft',group:'motion',en:'Pan left',de:'Schwenk nach links'},
    {id:'slideright',group:'motion',en:'Pan right',de:'Schwenk nach rechts'},
    {id:'bloom',group:'light',en:'Bloom / glow',de:'Lichtschein',parameter:'strength',min:.2,max:.8,default:.5},
    {id:'flash',group:'light',en:'Flash',de:'Lichtblitz',parameter:'strength',min:.2,max:1,default:.7},
    {id:'light-wash',group:'light',en:'Stationary light wash',de:'Ruhiger Lichtschleier',parameter:'strength',min:.2,max:1,default:.6},
]);
const fail=code=>{throw Object.assign(new Error(code),{code,status:400});};
export function transitionSettings(value) {
    if(value===undefined||value===null)return {preset:'none'};
    if(typeof value!=='object'||Array.isArray(value))fail('canvas_transition_invalid');
    const preset=TRANSITIONS.find(p=>p.id===value.preset);if(!preset)fail('canvas_transition_invalid');
    const allowed=['preset',...(preset.id==='none'?[]:['duration']),...(preset.parameter?[preset.parameter]:[])];
    if(Object.keys(value).some(k=>!allowed.includes(k)))fail('canvas_transition_invalid');
    if(preset.id==='none')return {preset:'none'};
    if(!Number.isFinite(value.duration)||value.duration<.1||value.duration>2)fail('canvas_transition_duration');
    const result={preset:preset.id,duration:Math.round(value.duration*1000)/1000};
    if(preset.parameter){const v=value[preset.parameter]??preset.default;if(!Number.isFinite(v)||v<preset.min||v>preset.max)fail('canvas_transition_invalid');result[preset.parameter]=v;}
    return result;
}
export function sequenceTransitions(clips,edges) {
    return clips.slice(1).map((right,i)=>{
        const matches=edges.filter(e=>e.source_node_id===clips[i].nodeId&&e.target_node_id===right.nodeId);
        if(matches.length>1)fail('canvas_transition_ambiguous');
        return transitionSettings(matches[0]?.config?.transition);
    });
}
export function transitionTimeline(durations,transitions,fps) {
    if(!Array.isArray(transitions)||transitions.length!==durations.length-1||!Number.isFinite(fps)||fps<=0||fps>60)fail('canvas_transition_invalid');
    const overlaps=transitions.map(t=>{const s=transitionSettings(t);return s.preset==='none'?0:Math.max(1,Math.round(s.duration*fps))/fps;});
    for(let i=0;i<durations.length;i++) {
        if(!Number.isFinite(durations[i])||durations[i]<=0||(overlaps[i-1]||0)+(overlaps[i]||0)>durations[i]-1/fps+.00001
            ||(overlaps[i]||0)>durations[i]/2+.00001||(overlaps[i-1]||0)>durations[i]/2+.00001)fail('canvas_transition_too_long');
    }
    let start=0;const timeline=durations.map((duration,i)=>{const row={start,duration,overlap:overlaps[i]||0};start+=duration-(overlaps[i]||0);return row;});
    return {timeline,duration:start,overlaps};
}
