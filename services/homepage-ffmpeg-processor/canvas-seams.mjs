import {readFile,writeFile,stat,rm} from 'node:fs/promises';
import path from 'node:path';

export const SEAM_POLICY='motion-anchors-v1';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

// Deliberately narrow: coherent translation with matching detail on BOTH sides.
// Independent motion, occlusion, cuts, low texture and long stillness are not
// evidence of a repairable seam. Analysis is bounded, at 240 px, never output.
export function frameMotion(a,b,w,h) {
  let best={error:Infinity,x:0,y:0},texture=0;const scores=[];
  for(let y=12;y<h-12;y+=3)for(let x=12;x<w-12;x+=3)texture+=Math.abs(a[y*w+x]-a[y*w+x-2]);
  const count=Math.ceil((h-24)/3)*Math.ceil((w-24)/3);
  if(texture/count<2)return null;
  for(let dy=-9;dy<=9;dy++)for(let dx=-9;dx<=9;dx++) {
    let sum=0;
    for(let y=12;y<h-12;y+=3)for(let x=12;x<w-12;x+=3)sum+=Math.abs(a[y*w+x]-b[(y+dy)*w+x+dx]);
    const error=sum/count;
    const score={error,x:dx,y:dy};scores.push(score);if(error<best.error)best=score;
  }
  // Adjacent integer vectors can tie for genuine subpixel motion after the
  // analysis resize. Test ambiguity against a DIFFERENT displacement, not the
  // two equally valid neighbours of e.g. 1.5 pixels.
  const next=Math.min(...scores.filter(s=>distance(s,best)>1.5).map(s=>s.error));
  return best.error<4 && next-best.error>.12 && Math.abs(best.x)<9 && Math.abs(best.y)<9?best:null;
}

export function seamDecision(frames,w,h,boundary) {
  if(boundary<6||frames.length-boundary<6)return {reason:'short_clip'};
  const motion=frames.slice(1).map((b,i)=>frameMotion(frames[i],b,w,h));
  const sides=[...motion.slice(boundary-6,boundary-3),...motion.slice(boundary+2,boundary+5)];
  if(sides.some(m=>!m))return {reason:'uncertain_motion'};
  const typical={x:median(sides.map(m=>m.x)),y:median(sides.map(m=>m.y))};
  if(Math.hypot(typical.x,typical.y)<1 || sides.some(m=>distance(m,typical)>1.25))return {reason:'still_or_changing_motion'};
  const middle=motion.slice(boundary-3,boundary+2);
  if(middle.some(m=>!m))return {reason:'scene_or_geometry_change'};
  if(middle.every(m=>distance(m,typical)<=1.25))return {reason:'already_smooth'};
  if(middle.some(m=>m.x*typical.x+m.y*typical.y<0))return {reason:'direction_change'};
  const repeated=middle.some(m=>Math.hypot(m.x,m.y)<.5),speed=Math.hypot(typical.x,typical.y);
  // A pause followed by ordinary motion can be intentional. Reconstruct a
  // repeated boundary only when a compensating jump also proves lost cadence.
  // Two-pixel tolerance keeps analysis quantization from inventing that jump.
  if(repeated&&!middle.some(m=>Math.hypot(m.x,m.y)>=Math.max(speed*1.75,speed+2)))return {reason:'uncertain_pause'};
  const from=boundary-4,to=boundary+4,span=to-from;
  const displacement=middle.reduce((s,m)=>s+Math.hypot(m.x,m.y),0)/middle.length;
  if(displacement<.5*Math.hypot(typical.x,typical.y)||displacement>1.7*Math.hypot(typical.x,typical.y))return {reason:'uncertain_motion'};
  return {reason:repeated?'repeated_boundary':'small_motion_jump',from,to,span};
}

async function grayFrames(file,start,count,fps,dir,tag,{run,ffmpeg},width=240,height=136) {
  const output=path.join(dir,tag+'.gray');
  await run(ffmpeg,['-y','-v','error','-nostdin','-ss',String(start),'-i',file,'-an','-vf',`fps=${fps},scale=${width}:${height},format=gray`,
    '-frames:v',String(count),'-threads','1','-f','rawvideo',output],{cwd:dir});
  const bytes=await readFile(output);await rm(output);
  const size=width*height;if(bytes.length!==count*size)fail('canvas_seam_decode_incomplete');
  return Array.from({length:count},(_,i)=>bytes.subarray(i*size,(i+1)*size));
}

// No frame removal, retiming, image blending or whole-video interpolation.
// Four source anchors provide motion on both sides; only their INNER interval
// is reconstructed at the original cadence. Audio is stream-copied untouched.
export async function smoothVideoSeams(base,dir,options) {
  const {run,ffmpeg='ffmpeg',limits={outputBytes:80000000},seamIndices,originalSeamIndex}=options;
  const report={policy:SEAM_POLICY,improved:0,seams:[]};
  const fps=base.fps;if(!(fps>0&&fps<=60))fail('canvas_frame_rate_unsupported');
  const patches=[];const started=Date.now();
  const indices=seamIndices||base.timeline.slice(1).map((_,i)=>i);
  for(const index of indices) {
    const time=base.timeline[index+1]?.start,left=base.timeline[index],right=base.timeline[index+1];
    if(!left||!right)fail('canvas_seam_index_invalid');
    const entry={index:originalSeamIndex??index,at:time+(base.previewOffset||0),reason:'short_clip'};report.seams.push(entry);
    if(options.skipSeams?.has(index)){entry.reason='explicit_transition';continue;}
    if(fps<20){entry.reason='cadence_budget';continue;}
    if(entry.index>=8){entry.reason='analysis_budget';continue;}
    // Twelve frames of context each side; reconstruct only the inner eight.
    if(left.duration<13/fps||right.duration<13/fps)continue;
    if(base.width*base.height>1920*1080){entry.reason='resolution_budget';continue;}
    const frame=Math.round(time*fps),start=(frame-12)/fps;
    const frames=await grayFrames(base.output,start,25,fps,dir,`seam-${index}`,{run,ffmpeg});
    const decision=seamDecision(frames,240,136,12);entry.reason=decision.reason;
    if(decision.from===undefined)continue;
    const raw=path.join(dir,`anchors-${index}.yuv`),patch=path.join(dir,`seam-${index}.nut`);
    // The four anchors are frame -12,-4,+4,+12 relative to the join. This
    // explicitly removes the defective interior samples from interpolation.
    await run(ffmpeg,['-y','-v','error','-nostdin','-ss',String(start),'-i',base.output,'-an',
      '-vf',`fps=${fps},select='eq(n,0)+eq(n,8)+eq(n,16)+eq(n,24)'`,'-frames:v','4','-vsync','0',
      '-pix_fmt','yuv420p','-threads','1','-f','rawvideo',raw],{cwd:dir});
    if((await stat(raw)).size!==base.width*base.height*1.5*4)fail('canvas_seam_decode_incomplete');
    await run(ffmpeg,['-y','-v','error','-nostdin','-f','rawvideo','-pixel_format','yuv420p','-video_size',`${base.width}x${base.height}`,
      '-framerate',String(fps/8),'-i',raw,'-vf',`minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=fdiff,trim=start_frame=8:end_frame=17,setpts=PTS-STARTPTS`,
      '-an','-c:v','ffv1','-threads','1',patch],{cwd:dir});
    const after=await grayFrames(patch,0,9,fps,dir,`verified-${index}`,{run,ffmpeg});
    const before=frames.slice(8,17);
    const metrics=sequence=>{
      const shifts=sequence.slice(1).map((b,i)=>frameMotion(sequence[i],b,240,136));
      if(shifts.some(m=>!m))return null;
      return {jerk:Math.max(...shifts.slice(1).map((m,i)=>distance(m,shifts[i]))),holds:shifts.filter(m=>Math.hypot(m.x,m.y)<.5).length};
    };
    const original=metrics(before),corrected=metrics(after);
    if(!original||!corrected||corrected.jerk>original.jerk*.8||corrected.holds>original.holds
      ||corrected.jerk>=original.jerk && corrected.holds>=original.holds) {entry.reason='quality_fallback';await rm(patch);continue;}
    entry.improved=true;report.improved++;patches.push({file:patch,startFrame:frame-4,endFrame:frame+4,expected:after});
    await rm(raw);
  }
  report.elapsedMs=Date.now()-started;
  if(!patches.length)return {...base,seams:report};
  const output=path.join(dir,'full-video-smooth.mp4');
  const args=['-y','-v','error','-nostdin','-i',base.output];
  for(const patch of patches)args.push('-i',patch.file);
  // Replacement is frame-indexed, duration preserving. Each patch ends at its
  // original right anchor; overlay never extends EOF or affects the soundtrack.
  const filters=[`[0:v]setpts=PTS-STARTPTS[base0]`];
  patches.forEach((p,i)=>{filters.push(`[${i+1}:v]setpts=PTS-STARTPTS+${p.startFrame}/(${fps}*TB)[patch${i}]`);
    filters.push(`[base${i}][patch${i}]overlay=eof_action=pass:repeatlast=0:enable='between(t,${p.startFrame/fps-.00001},${p.endFrame/fps+.00001})'[base${i+1}]`);});
  args.push('-filter_complex',filters.join(';'),'-map',`[base${patches.length}]`,'-map','0:a?','-c:a','copy','-c:v','libx264','-crf','16','-preset','veryfast','-threads','2',
    '-fps_mode','passthrough','-fs',String(limits.outputBytes+1),'-movflags','+faststart',output);
  await run(ffmpeg,args,{cwd:dir});
  if((await stat(output)).size>limits.outputBytes)fail('canvas_output_size_limit');
  // Verify the encoded file, not just a generated patch/filter expression.
  // A compositor/timestamp/decode defect must fail, never claim improvement.
  for(const [i,patch] of patches.entries()) {
    const actual=await grayFrames(output,patch.startFrame/fps,9,fps,dir,`output-${i}`,{run,ffmpeg});
    for(let f=0;f<actual.length;f++) {
      let error=0;for(let n=0;n<actual[f].length;n++)error+=Math.abs(actual[f][n]-patch.expected[f][n]);
      if(error/actual[f].length>1.5)fail('canvas_seam_output_mismatch');
    }
  }
  report.elapsedMs=Date.now()-started;
  return {...base,output,seams:report,mode:base.mode+'+smooth'};
}
