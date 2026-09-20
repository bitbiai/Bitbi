// Bounded inspection of owned reference bytes, not requested generation settings
// or poster dimensions. This validates input constraints; it is not a decoder.
const fail=()=>{throw Object.assign(new Error('Reference media metadata is unsupported or invalid.'),{status:400,code:'h3_reference_metadata_invalid'});};
const text=(bytes,start,length)=>new TextDecoder().decode(bytes.subarray(start,start+length));
function mp4(bytes) {
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const boxes=(start,end)=>{
        const result=[];
        for(let offset=start;offset<end;) {
            if(offset+8>end)fail();
            let size=view.getUint32(offset),header=8;
            if(size===1){if(offset+16>end)fail();size=Number(view.getBigUint64(offset+8));header=16;}
            if(size===0)size=end-offset;
            if(!Number.isSafeInteger(size)||size<header||offset+size>end)fail();
            result.push({type:text(bytes,offset+4,4),start:offset+header,end:offset+size});offset+=size;
        }
        return result;
    };
    const child=(box,type)=>boxes(box.start,box.end).find(item=>item.type===type);
    const movie=boxes(0,bytes.length).find(box=>box.type==='moov');if(!movie)fail();
    const mvhd=child(movie,'mvhd');if(!mvhd)fail();
    const movieScaleOffset=mvhd.start+(bytes[mvhd.start]===1?20:12);
    if(movieScaleOffset+4>mvhd.end)fail();
    const movieScale=view.getUint32(movieScaleOffset);if(!movieScale)fail();
    const presentedDuration=(track,raw,scale)=>{
        const edit=child(track,'edts'),list=edit&&child(edit,'elst');if(!list)return raw;
        const v=bytes[list.start],wide=v===1;if(![0,1].includes(v)||list.end-list.start<8)fail();
        const count=view.getUint32(list.start+4),stride=wide?20:12;
        if(count!==1||list.start+8+stride!==list.end)fail();
        const at=list.start+8,segment=wide?Number(view.getBigUint64(at)):view.getUint32(at);
        const time=wide?Number(view.getBigInt64(at+8)):view.getInt32(at+4),rate=at+(wide?16:8);
        if(time<0||view.getInt16(rate)!==1||view.getInt16(rate+2)!==0||segment/movieScale>raw+0.001)fail();
        // MP4 edit durations use the movie timescale (often milliseconds).
        // They cannot extend the track past its actual media end after the
        // encoder-delay offset. Honor both bounds without rounding metadata.
        return Math.min(segment/movieScale,raw-time/scale);
    };
    let video=null,audioDuration=0;
    for(const track of boxes(movie.start,movie.end).filter(box=>box.type==='trak')) {
        const media=child(track,'mdia'),header=child(track,'tkhd');if(!media)fail();
        const handler=child(media,'hdlr'),duration=child(media,'mdhd'),info=child(media,'minf');
        if(!handler||handler.end-handler.start<12||!duration||!info)fail();
        const kind=text(bytes,handler.start+8,4),table=child(info,'stbl');if(!table)fail();
        const sample=child(table,'stsd');if(!sample||sample.end-sample.start<16||view.getUint32(sample.start+4)!==1)fail();
        const codec=text(bytes,sample.start+12,4);
        if(kind==='soun'&&!['mp4a','.mp3','mp3 '].includes(codec))fail();
        const v=bytes[duration.start];if(![0,1].includes(v))fail();
        const scaleOffset=duration.start+(v===1?20:12),ticksOffset=scaleOffset+4;
        if(ticksOffset+(v===1?8:4)>duration.end)fail();
        const scale=view.getUint32(scaleOffset),ticks=v===1?Number(view.getBigUint64(ticksOffset)):view.getUint32(ticksOffset);
        if(kind==='soun'){audioDuration=Math.max(audioDuration,presentedDuration(track,ticks/scale,scale));continue;}
        if(kind!=='vide')continue;
        if(video||!['avc1','avc3','hvc1','hev1'].includes(codec)||!header||header.end-header.start<8)fail();
        const timing=child(table,'stts');if(!timing||timing.end-timing.start<8)fail();
        const count=view.getUint32(timing.start+4);if(count>10000||timing.start+8+count*8!==timing.end)fail();
        const composition=child(table,'ctts'),offsets=[];
        if(composition) {
            if(composition.end-composition.start<8||![0,1].includes(bytes[composition.start]))fail();
            const n=view.getUint32(composition.start+4);if(n>10000||composition.start+8+n*8!==composition.end)fail();
            for(let i=0;i<n;i++) {
                const at=composition.start+8+i*8;
                offsets.push([view.getUint32(at),bytes[composition.start]===1?view.getInt32(at+4):view.getUint32(at+4)]);
            }
        }
        let frames=0,dts=0,endPts=0,offsetIndex=0,remaining=offsets[0]?.[0]||0;
        for(let i=0;i<count;i++) {
            const at=timing.start+8+i*8,n=view.getUint32(at),delta=view.getUint32(at+4);
            if(!delta||frames+n>100000)fail();
            for(let j=0;j<n;j++) {
                if(composition&&!remaining)fail();
                endPts=Math.max(endPts,dts+(offsets[offsetIndex]?.[1]||0)+delta);dts+=delta;frames++;
                if(composition&&!--remaining){offsetIndex++;remaining=offsets[offsetIndex]?.[0]||0;}
            }
        }
        if(composition&&offsetIndex!==offsets.length)fail();
        video={frames,videoDuration:presentedDuration(track,endPts/scale,scale),duration:presentedDuration(track,endPts/scale,scale),width:view.getUint32(header.end-8)/65536,height:view.getUint32(header.end-4)/65536,fps:frames/(dts/scale)};
    }
    if(!video||!Number.isFinite(audioDuration))fail();return {...video,audioDuration,duration:Math.max(video.duration,audioDuration)};
}
function wav(bytes) {
    if(text(bytes,0,4)!=='RIFF'||text(bytes,8,4)!=='WAVE')fail();
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let rate=0,data=0;
    for(let offset=12;offset+8<=bytes.length;) {
        const size=view.getUint32(offset+4,true),start=offset+8;if(start+size>bytes.length)fail();
        const type=text(bytes,offset,4);
        if(type==='fmt '){if(size<16||![1,3,65534].includes(view.getUint16(start,true)))fail();rate=view.getUint32(start+8,true);}
        if(type==='data')data+=size;
        offset=start+size+(size%2);
    }
    if(!rate||!data)fail();return {duration:data/rate};
}
function mp3(bytes) {
    let offset=0,duration=0,frames=0;
    if(text(bytes,0,3)==='ID3') {
        if(bytes.length<10||bytes.subarray(6,10).some(value=>value&128))fail();
        offset=10+((bytes[6]<<21)|(bytes[7]<<14)|(bytes[8]<<7)|bytes[9])+((bytes[5]&16)?10:0);
    }
    while(offset+4<=bytes.length) {
        if(bytes.length-offset===128&&text(bytes,offset,3)==='TAG'){offset+=128;break;}
        const a=bytes[offset],b=bytes[offset+1],c=bytes[offset+2];
        if(a!==255||(b&224)!==224||(b&6)!==2||(b&24)===8)fail();
        const version=(b>>3)&3,index=c>>4,sampleIndex=(c>>2)&3;
        if(!index||index===15||sampleIndex===3)fail();
        const bitrates=version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
        const rate=[44100,48000,32000][sampleIndex]/(version===3?1:version===2?2:4);
        const length=Math.floor((version===3?144:72)*bitrates[index]*1000/rate)+((c>>1)&1);
        if(offset+length>bytes.length)fail();offset+=length;frames++;duration+=(version===3?1152:576)/rate;
    }
    if(!frames||offset!==bytes.length)fail();return {duration};
}
export function inspectH3TimeReference(bytes,media,mime,{inspectOverrun=false}={}) {
    const result=media==='video'?mp4(bytes):mime==='audio/mpeg'?mp3(bytes):wav(bytes);
    if(!Number.isFinite(result.duration)||result.duration<=0)fail();
    if(result.duration<2 || (!inspectOverrun && result.duration>15))throw h3DurationError();
    if(media==='video'&&(!Number.isFinite(result.fps)||result.fps<23.976||result.fps>60))fail();
    if(media==='video')validateH3Dimensions(result);
    return result;
}
export function validateH3Dimensions({width,height}) {
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<256||height<256||width>5760||height>5760||width/height<0.4||width/height>2.5)fail();
}

export function h3DurationError(aggregate=false) {
    return Object.assign(new Error(aggregate
        ? 'Reference videos or audio must total at most 15 seconds per media type.'
        : 'Each reference video or audio must be between 2 and 15 seconds.'),
    {status:400,code:aggregate?'h3_reference_total_duration':'h3_reference_file_duration'});
}
// Only server-proven, nominal 15s generations qualify. Two frames are the
// measured encoder overhang, not a tolerance for uploaded or longer clips.
export function h3EncoderOverrun(metadata,nominalGeneratedDuration) {
    return nominalGeneratedDuration===15 && metadata.duration>15
        && metadata.duration<=15+2/metadata.fps+0.000001
        && metadata.frames<=Math.round(15*metadata.fps)+2;
}
