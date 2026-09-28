// Audition only: no encoding, normalization, ducking or makeup gain.
// Match the export's 10 ms linear loop overlap and sample-zero first pass.
export function loopPosition(frame,length,rate) {
    const overlap=Math.min(Math.round(rate*.01),Math.floor(length/4)),period=length-overlap;
    const position=frame<period?frame:overlap+((frame-overlap)%period);
    return {position,overlap,period};
}
if(typeof registerProcessor==='function') {
    class CanvasMusicPreview extends AudioWorkletProcessor {
        constructor() {
            super();this.channels=[];this.rate=48000;this.frame=0;this.gain=1;this.active=false;this.limited=1;
            this.port.onmessage=({data})=>{
                if(data.channels){this.channels=data.channels;this.rate=data.rate;}
                if(data.gain!==undefined)this.gain=Math.max(0,Math.min(1,data.gain));
                if(data.active!==undefined)this.active=data.active;
                if(data.time!==undefined)this.frame=Math.max(0,data.time*this.rate);
                if(data.speed!==undefined)this.speed=data.speed;
                if(data.repeat!==undefined)this.repeat=data.repeat;
            };
        }
        process(inputs,outputs) {
            const input=inputs[0],output=outputs[0],length=this.channels[0]?.length||0;
            for(let i=0;i<output[0].length;i++) {
                const added=this.active && this.gain>0 && length>1 && (this.repeat||this.frame<length);
                const {position,overlap,period}=added?(this.repeat?loopPosition(Math.floor(this.frame),length,this.rate):{position:Math.floor(this.frame),period:length}):{};
                let peak=0;
                for(let c=0;c<output.length;c++) {
                    let music=0;
                    if(added) {
                        const samples=this.channels[Math.min(c,this.channels.length-1)];music=samples[position];
                        if(position>=period){const t=(position-period+1)/(overlap+1);music=music*(1-t)+samples[position-period]*t;}
                    }
                    output[c][i]=(input[c]?.[i]??input[0]?.[i]??0)+music*this.gain;
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
