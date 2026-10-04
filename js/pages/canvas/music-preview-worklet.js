// Audition only: no encoding, normalization, ducking or makeup gain.
// Match the export's 10 ms linear loop overlap and sample-zero first pass.
import { effectiveAudio } from '../../shared/canvas-audio.mjs?v=__ASSET_VERSION__';
const envelope=(s,t,d,gain=s?.gain)=>!s?.enabled||t<0||t>=d?0:gain*Math.min(1,s.fadeIn?t/s.fadeIn:1,s.fadeOut?(d-t)/s.fadeOut:1);
export function loopPosition(frame,length,rate) {
    const overlap=Math.min(Math.round(rate*.01),Math.floor(length/4)),period=length-overlap;
    const position=frame<period?frame:overlap+((frame-overlap)%period);
    return {position,overlap,period};
}
if(typeof registerProcessor==='function') {
    class CanvasMusicPreview extends AudioWorkletProcessor {
        constructor() {
            super();this.channels=[];this.rate=48000;this.frame=0;this.gain=1;this.active=false;this.limited=1;this.timeline=[];this.segmentIndex=0;
            this.port.onmessage=({data})=>{
                if(data.channels){this.channels=data.channels;this.rate=data.rate;}
                if(data.gain!==undefined)this.gain=Math.max(0,Math.min(1,data.gain));
                if(data.active!==undefined)this.active=data.active;
                if(data.time!==undefined){this.frame=Math.max(0,data.time*this.rate);this.segmentIndex=0;}
                if(data.speed!==undefined)this.speed=data.speed;
                if(data.repeat!==undefined)this.repeat=data.repeat;
                if(data.timeline){this.timeline=data.timeline.map(clip=>({...clip,settings:effectiveAudio(clip.originalAudio,clip.duration)}));this.segmentIndex=0;}
                if(data.duration)this.duration=data.duration;
                if(data.music)this.music=effectiveAudio(data.music,data.duration||this.duration);
            };
        }
        process(inputs,outputs) {
            const input=inputs[0],output=outputs[0],length=this.channels[0]?.length||0;
            for(let i=0;i<output[0].length;i++) {
                const time=this.frame/this.rate;
                while(this.segmentIndex<this.timeline.length && time>=this.timeline[this.segmentIndex].start+this.timeline[this.segmentIndex].duration)this.segmentIndex++;
                const segment=this.timeline[this.segmentIndex];
                const originalGain=this.timeline.length?(segment?envelope(segment.settings,time-segment.start,segment.duration):0):1;
                const musicGain=this.music?envelope(this.music,time,this.duration,this.gain):this.gain;
                const added=this.active && this.gain>0 && length>1 && (this.repeat||this.frame<length);
                const {position,overlap,period}=added?(this.repeat?loopPosition(Math.floor(this.frame),length,this.rate):{position:Math.floor(this.frame),period:length}):{};
                let peak=0;
                for(let c=0;c<output.length;c++) {
                    let music=0;
                    if(added) {
                        const samples=this.channels[Math.min(c,this.channels.length-1)];music=samples[position];
                        if(position>=period){const t=(position-period+1)/(overlap+1);music=music*(1-t)+samples[position-period]*t;}
                    }
                    output[c][i]=(input[c]?.[i]??input[0]?.[i]??0)*originalGain+music*musicGain;
                    peak=Math.max(peak,Math.abs(output[c][i]));
                }
                const target=added?Math.min(1,.95/Math.max(peak,.95)):1;
                this.limited=added?Math.min(target,this.limited+(1-this.limited)/(sampleRate*.05)):1;
                for(const channel of output)channel[i]*=this.limited;
                if(this.active)this.frame+=this.rate/sampleRate*(this.speed||1);
            }
            return true;
        }
    }
    registerProcessor('canvas-music-preview',CanvasMusicPreview);
}
