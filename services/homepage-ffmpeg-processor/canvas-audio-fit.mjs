// Recipe v5 only. Source timestamps remain relative to the first picture;
// trimming/padding never stretches speech or extends the picture timeline.
export const AUDIO_FIT_POLICY='fit-picture-v1';
const invalid=()=>{throw Object.assign(new Error('canvas_media_timing_invalid'),{code:'canvas_media_timing_invalid'});};
const seconds=(value,{positive=false}={})=>{
  if(value===undefined||value===null||value==='N/A'||value==='')invalid();
  const number=Number(value);
  if(!Number.isFinite(number)||Math.abs(number)>86400||(positive&&number<=0))invalid();
  return number;
};
export function pictureTiming(clip,fps) {
  const start=seconds(clip.video.start_time),duration=seconds(clip.video.duration,{positive:true});
  if(duration>600)invalid();
  let audio=null;
  if(clip.audio) {
    const audioStart=seconds(clip.audio.start_time),audioDuration=seconds(clip.audio.duration,{positive:true});
    if(audioDuration>600||Math.abs(audioStart-start)>600)invalid();
    audio={start:audioStart-start,duration:audioDuration};
  }
  return {start,duration:Math.ceil(duration*fps-0.0001)/fps,audio};
}
export function audioFitReport(timing,duration) {
  const audio=timing.audio;
  return {policy:AUDIO_FIT_POLICY,trimStart:audio?Math.min(audio.duration,Math.max(0,-audio.start)):0,
    trimEnd:audio?Math.min(audio.duration,Math.max(0,audio.start+audio.duration-duration)):0};
}
export function fittedSourceFilter(timing,selection) {
  // copyts retains meaningful delayed/early audio. first_pts pads an initial
  // delay or trims negative samples; it does not time-stretch the signal.
  return `asetpts=PTS-${timing.start}/TB,aresample=48000:first_pts=0,aformat=channel_layouts=stereo,apad,atrim=start=${selection.offset}:end=${selection.offset+selection.duration},asetpts=PTS-STARTPTS`;
}
export function cutSafeSettings(settings,fit) {
  if(!fit)return settings;
  if(fit.policy!==AUDIO_FIT_POLICY)invalid();
  // One short ramp only where fitting makes a new cut and the user has not
  // already configured that edge. Never multiply two fade envelopes.
  return {...settings,fadeIn:settings?.fadeIn||(fit.trimStart > 1/48000 ? .005 : 0),fadeOut:settings?.fadeOut||(fit.trimEnd > 1/48000 ? .005 : 0)};
}
