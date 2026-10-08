// Original BITBI compositions over stock FFmpeg. No downloaded shaders/assets.
import path from 'node:path';
import {stat} from 'node:fs/promises';
import {TRANSITION_POLICY,transitionSettings,transitionTimeline} from './canvas-transition-contract.mjs';

function effectFilters(filters,input,value,start,duration,base,index) {
    const {preset,strength}=transitionSettings(value);
    if(!['directional','radial-blur','zoom-blur','bloom'].includes(preset))return input;
    const prefix=`effect${index}`,output=prefix+'out',window=`between(t,${start},${start+duration})`;
    const envelope=`sin(PI*(T-${start})/${duration})`,active=`between(T,${start},${start+duration})`;
    if(['radial-blur','zoom-blur'].includes(preset)) {
        filters.push(`[${input}]split=5`+[0,1,2,3,4].map(i=>`[${prefix}in${i}]`).join(''));
        for(let i=0;i<5;i++){
            let effect;
            if(preset==='radial-blur'){
                const pad=Math.ceil(Math.hypot(base.width,base.height)*Math.sin(strength*Math.PI/180)+4);
                // Mirror edge pixels before angular integration; no black wedges.
                effect=`pad=iw+${2*pad}:ih+${2*pad}:${pad}:${pad},fillborders=left=${pad}:right=${pad}:top=${pad}:bottom=${pad}:mode=mirror,rotate=angle='${(i-2)*strength*Math.PI/360}*sin(PI*(t-${start})/${duration})':enable='${window}',crop=${base.width}:${base.height}:${pad}:${pad}`;
            }else effect=`zoompan=z='1+${i*strength/4}*sin(PI*(in_time-${start})/${duration})*between(in_time,${start},${start+duration})':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${base.width}x${base.height}:fps=${base.fps},settb=AVTB`;
            filters.push(`[${prefix}in${i}]${effect}[${prefix}tap${i}]`);
        }
        filters.push([0,1,2,3,4].map(i=>`[${prefix}tap${i}]`).join('')+`mix=inputs=5:weights='1 1 1 1 1'[${output}]`);
    }else{
        filters.push(`[${input}]split=2[${prefix}raw][${prefix}in]`);
        const effect=preset==='directional'?`dblur=angle=0:radius=${strength}:enable='${window}'`
            :`lutrgb=r='max(val-160,0)':g='max(val-160,0)':b='max(val-160,0)',gblur=sigma=10:enable='${window}'`;
        filters.push(`[${prefix}in]${effect}[${prefix}blur]`);
        const mix=preset==='bloom'?`min(255,A+B*${strength}*${envelope})`:`A*(1-${envelope})+B*${envelope}`;
        filters.push(`[${prefix}raw][${prefix}blur]blend=all_expr='if(${active},${mix},A)'[${output}]`);
    }
    return output;
}

export function transitionFilter(value,duration,offset) {
    const settings=transitionSettings(value),id=settings.preset;
    if(['fade','dissolve','fadeblack','fadewhite','zoomin','slideleft','slideright'].includes(id))return `xfade=transition=${id}:duration=${duration}:offset=${offset}`;
    let expr='A*P+B*(1-P)';
    if(['directional','radial-blur','zoom-blur','bloom'].includes(id))return `xfade=transition=fade:duration=${duration}:offset=${offset}`;
    if(id==='flash')expr=`(${expr})*(1-${settings.strength}*pow(sin(PI*P),8))+255*${settings.strength}*pow(sin(PI*P),8)`;
    else if(id==='light-wash') {
        const wash=`${settings.strength}*sin(PI*P)*exp(-8*(pow(X/W-0.35,2)+pow(Y/H-0.35,2)))`;
        expr=`(${expr})*(1-${wash})+255*if(eq(PLANE,1),0.6,1)*${wash}`;
    }else throw Object.assign(Error('canvas_transition_invalid'),{code:'canvas_transition_invalid'});
    return `xfade=transition=custom:duration=${duration}:offset=${offset}:expr='${expr}'`;
}
export async function applyVideoTransitions(base,transitions,dir,{run,ffmpeg='ffmpeg',ffprobe='ffprobe',inspect,limits}) {
    if(!transitions?.some(t=>t.preset!=='none'))return base;
    const timing=transitionTimeline(base.timeline.map(s=>s.duration),transitions,base.fps);
    const args=['-y','-v','error','-nostdin','-filter_complex_threads','1'];
    // Bounded decode: two threads per input, with total source bytes/duration
    // already fenced by admission. No generated filter expression crosses API.
    const filters=[];base.timeline.forEach((s,i)=>{
        args.push('-threads','1','-ss',String(s.start),'-t',String(s.duration),'-i',base.output);
        // fps replaces its input timebase. Normalize AFTER it so concat,
        // xfade and zoompan all meet the same rational clock at every join.
        filters.push(`[${i}:v]setpts=PTS-STARTPTS,fps=${base.fps},settb=AVTB,format=gbrp[v${i}]`);
    });
    let current='v0',end=base.timeline[0].duration;
    for(let i=0;i<transitions.length;i++){
        const next=`j${i}`,d=timing.overlaps[i];filters.push(`[${current}][v${i+1}]`+(d?transitionFilter(transitions[i],d,end-d):'concat=n=2:v=1:a=0')+`[${next}]`);
        const effected=effectFilters(filters,next,transitions[i],end-d,d,base,i);current=`clock${i}`;
        filters.push(`[${effected}]settb=AVTB[${current}]`);end+=base.timeline[i+1].duration-d;
    }
    const hasAudio=Boolean((await inspect(base.output,{run,ffprobe})).audio);
    if(hasAudio){
        base.timeline.forEach((s,i)=>filters.push(`[${i}:a]aresample=48000,asetpts=PTS-STARTPTS,apad,atrim=duration=${s.duration}[a${i}]`));
        let audio='a0';for(let i=0;i<transitions.length;i++){const next=`m${i}`,d=timing.overlaps[i];filters.push(`[${audio}][a${i+1}]`+(d?`acrossfade=d=${d}:c1=tri:c2=tri`:'concat=n=2:v=0:a=1')+`[${next}]`);audio=next;}
        args.push('-filter_complex',filters.join(';'),'-map',`[${current}]`,'-map',`[${audio}]`,'-c:a','aac','-b:a','192k');
    }else args.push('-filter_complex',filters.join(';'),'-map',`[${current}]`);
    const output=path.join(dir,'full-video-transitions.mp4');
    args.push('-t',String(timing.duration),'-c:v','libx264','-threads','2','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart','-fs',String(limits.outputBytes+1),output);
    const start=Date.now();await run(ffmpeg,args,{cwd:dir});
    const decoded=await inspect(output,{run,ffprobe});
    if((await stat(output)).size>limits.outputBytes||Math.abs(decoded.videoDuration-timing.duration)>1/base.fps+.001||Boolean(decoded.audio)!==hasAudio)throw Object.assign(Error('canvas_transition_incomplete'),{code:'canvas_transition_incomplete'});
    return {...base,output,duration:timing.duration,totalDuration:base.transitionDuration??timing.duration,mode:base.mode+'+transitions',
        timeline:timing.timeline.map((s,i)=>({...s,originalAudioFit:base.timeline[i].originalAudioFit})),
        ...(base.seams?{seams:{...base.seams,seams:base.seams.seams.map((s,i)=>({...s,at:timing.timeline[i+1].start+timing.overlaps[i]/2}))}}:{}),
        transitions:{policy:TRANSITION_POLICY,overlaps:timing.overlaps,processingMs:Date.now()-start}};
}
