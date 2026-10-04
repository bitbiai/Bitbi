// One controller for the existing aggregate video. Only authenticated media GETs.
const MAX_BYTES=80_000_000;
export function createMusicPreview({video,signal,onState=()=>{}}) {
    let context,source,mixer,ready,load,epoch=0,disposed=false,active=false,buffering=false,track=null;
    let clock=0,clockTime=0,musicDuration=0,reported=null,selectedGain=1,failedProcessor=false,settings={};
    const report=state=>{if(!disposed&&reported!==state){reported=state;onState(state);}};
    const send=data=>mixer?.port.postMessage(data);
    const route=preview=>{if(!source)return;source.disconnect();source.connect(preview?mixer:context.destination);};
    const stop=()=>{send({active:false});clock=0;};
    const sync=(force=false)=>{
        if(!active || disposed || !mixer)return;
        // WebKit/GStreamer can report HAVE_CURRENT_DATA during advancing
        // playback after a seek. The waiting/playing events own underflow.
        const playing=!video.paused&&!video.ended&&!video.seeking&&!buffering&&video.readyState>=2;
        const drift=Math.abs(video.currentTime-(clockTime+(context.currentTime-clock)*video.playbackRate));
        if(force || drift>.08){send({time:video.currentTime});clock=context.currentTime;clockTime=video.currentTime;}
        send({active:playing,speed:video.playbackRate});report(playing?'playing':'paused');
    };
    async function setup() {
        if(failedProcessor)throw new Error('unsupported');
        if(ready)return ready;
        const Audio=window.AudioContext||window.webkitAudioContext;
        if(!Audio)throw new Error('unsupported');
        context=new Audio({sampleRate:48000});
        // Resume immediately inside the click, before awaiting fetch/module work.
        const resumed=context.resume();
        ready=(async()=>{
            await context.audioWorklet.addModule(new URL('./music-preview-worklet.js?v=__ASSET_VERSION__',import.meta.url));
            if(disposed)throw new Error('disposed');
            mixer=new AudioWorkletNode(context,'canvas-music-preview',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
            mixer.addEventListener('processorerror',()=>{failedProcessor=true;active=false;video.pause();route(false);report('error');},{signal});
            source=context.createMediaElementSource(video);route(false);mixer.connect(context.destination);
            await resumed;
        })();
        return ready;
    }
    async function readTrack(url,abort) {
        const resolved=new URL(url,location.href);
        if(resolved.origin!==location.origin || !resolved.pathname.startsWith('/api/'))throw new Error('source');
        const response=await fetch(resolved,{credentials:'same-origin',signal:abort,redirect:'error'});
        if(!response.ok || Number(response.headers.get('content-length'))>MAX_BYTES)throw new Error('media');
        const reader=response.body.getReader(),parts=[];let size=0;
        try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES)throw new Error('size');parts.push(value);}}
        finally {await reader.cancel().catch(()=>{});}
        const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
        const audio=await context.decodeAudioData(bytes.buffer);
        if(!(audio.duration>0&&audio.duration<=600) || audio.numberOfChannels>2)throw new Error('media');
        return audio;
    }
    async function start({baseUrl,musicUrl,gain=0,originalAudio,timeline,music}) {
        settings={originalAudio,timeline,music:music||{enabled:Boolean(musicUrl),gain,fadeIn:0,fadeOut:0}};
        selectedGain=gain;
        const token=++epoch;load?.abort();load=new AbortController();stop();active=false;video.pause();report('loading');
        try {
            const base=new URL(baseUrl,location.href);
            if(base.origin!==location.origin || !base.pathname.startsWith('/api/'))throw new Error('source');
            await setup();await context.resume();
            if(disposed || token!==epoch)return;
            if(musicUrl && track!==musicUrl) {
                const audio=await readTrack(musicUrl,load.signal);
                if(disposed || token!==epoch)return;
                const channels=Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i).slice());
                mixer.port.postMessage({channels,rate:audio.sampleRate},channels.map(c=>c.buffer));track=musicUrl;musicDuration=audio.duration;
            }
            const position=video.ended?0:video.currentTime;
            if(video.getAttribute('src')!==baseUrl){video.src=baseUrl;video.load();}
            if(video.readyState<1)await new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>finish(new Error('media')),15000);
                const done=()=>finish(),fail=()=>finish(new Error('media'));
                const finish=error=>{clearTimeout(timer);video.removeEventListener('loadedmetadata',done);video.removeEventListener('error',fail);load.signal.removeEventListener('abort',fail);error?reject(error):resolve();};
                video.addEventListener('loadedmetadata',done,{once:true});video.addEventListener('error',fail,{once:true});load.signal.addEventListener('abort',fail,{once:true});
            });
            if(disposed || token!==epoch)return;
            video.currentTime=Math.min(position,Number.isFinite(video.duration)?Math.max(0,video.duration-.01):position);
            active=true;buffering=false;route(true);send({gain:musicUrl?selectedGain:0,time:video.currentTime,speed:video.playbackRate,repeat:video.duration>musicDuration});
            setAudio(settings);
            await video.play();if(disposed || token!==epoch)return;sync(true);
        } catch(error) {if(disposed || token!==epoch)return;active=false;stop();route(false);video.pause();report('error');}
    }
    function reset() {++epoch;load?.abort();active=false;stop();route(false);video.pause();report('idle');}
    function setAudio(next) {
        settings={...settings,...next};
        if(!(Number.isFinite(video.duration)&&video.duration>0))return;
        const m=settings.music||{enabled:false,gain:0};
        send({duration:video.duration,timeline:settings.timeline || [{start:0,duration:video.duration,originalAudio:settings.originalAudio}],
            music:{enabled:m.enabled,gain:m.gain,fadeIn:m.fadeIn||0,fadeOut:m.fadeOut||0}});
    }
    video.addEventListener('playing',()=>{buffering=false;sync(true);},{signal});
    for(const name of ['pause','ended','seeking'])video.addEventListener(name,()=>{stop();sync(true);},{signal});
    video.addEventListener('waiting',()=>{if(active){buffering=true;stop();report('paused');}},{signal});
    video.addEventListener('seeked',()=>{buffering=false;sync(true);},{signal});
    video.addEventListener('ratechange',()=>sync(true),{signal});
    video.addEventListener('timeupdate',()=>sync(),{signal});
    video.addEventListener('error',()=>{if(active){reset();report('error');}},{signal});
    signal.addEventListener('abort',()=>{disposed=true;reset();source?.disconnect();mixer?.disconnect();mixer?.port.close();void context?.close().catch(()=>{});track=null;},{once:true});
    return {start,pause(){++epoch;load?.abort();video.pause();stop();report('paused');},reset,setAudio,
        get active(){return active;},get loading(){return reported==='loading';},setGain(gain){selectedGain=gain;send({gain});}};
}
