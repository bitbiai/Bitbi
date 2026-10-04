import { effectiveAudio, originalAudioSettings, hasAudioEffects } from '../../shared/canvas-audio.mjs?v=__ASSET_VERSION__';
import { createMusicPreview } from './music-preview.js?v=__ASSET_VERSION__';

// One collapsed Inspector section, shared by generated and imported video nodes.
export function canvasAudioControls({section,video,german,signal,original,backgroundMusic,tracks,onChange}) {
    const copy=german?{title:'Sound & Musik',original:'Originalton',music:'Hintergrundmusik',on:'Originalton aktiv',add:'Musik als Hintergrund hinzufügen',gain:'Lautstärke',in:'Einblenden',out:'Ausblenden',seconds:'Sekunden',choose:'Musik auswählen',none:'Eine Musikquelle als Hintergrundmusik verbinden.',silent:'Dieses Video hat keine Audiospur.',effective:'Überlappende Blenden werden proportional auf die Spieldauer begrenzt.',error:'Tonvorschau nicht verfügbar. Wiedergabe pausiert.',type:'Musikquelle'}
        :{title:'Sound & Music',original:'Original audio',music:'Background music',on:'Original audio enabled',add:'Add music as background',gain:'Volume',in:'Fade in',out:'Fade out',seconds:'seconds',choose:'Choose music',none:'Connect a music source as background music.',silent:'This video has no audio track.',effective:'Overlapping fades are proportionally limited to the playback duration.',error:'Audio preview unavailable. Playback paused.',type:'Music source'};
    let originalValue=originalAudioSettings(original),musicValue={enabled:false,gain:1,fadeIn:0,fadeOut:0,...backgroundMusic},exportDuration=null;
    const details=document.createElement('details');details.className='canvas-sound';
    const summary=document.createElement('summary');summary.textContent=copy.title;details.append(summary);section.append(details);
    const status=document.createElement('p');status.className='canvas-muted';status.setAttribute('role','status');
    const effectiveMusic=document.createElement('p');effectiveMusic.className='canvas-muted';effectiveMusic.setAttribute('role','status');
    const reflectMusic=()=>{
        const describe=(duration,label)=>{if(!(Number.isFinite(duration)&&duration>0))return '';const s=effectiveAudio(musicAudio(),duration);return `${label}: ${Number(s.fadeIn.toFixed(2))} s / ${Number(s.fadeOut.toFixed(2))} s`;};
        effectiveMusic.textContent=[describe(video.duration,german?'Wirksame Musikblenden in diesem Clip (ein/aus)':'Effective music fades in this clip (in/out)'),describe(exportDuration,german?'Im vollständigen Video':'In the full video')].filter(Boolean).join(' · ');
    };
    const audition=createMusicPreview({video,signal,onState:state=>{if(state==='error')status.textContent=copy.error;}});
    const chosen=()=>musicValue.musicAssetId?tracks.find(track=>track.assetId===musicValue.musicAssetId):tracks.length===1?tracks[0]:null;
    const musicAudio=()=>({enabled:musicValue.enabled&&Boolean(chosen()),gain:musicValue.gain,fadeIn:musicValue.fadeIn,fadeOut:musicValue.fadeOut});
    const start=()=>audition.start({baseUrl:video.getAttribute('src'),musicUrl:musicValue.enabled?chosen()?.fileUrl:null,gain:musicValue.gain,originalAudio:originalValue,music:musicAudio()});
    const change=(kind,value)=>{
        if(kind==='original')originalValue=value;else musicValue=value;
        reflectMusic();
        audition.setAudio({originalAudio:originalValue,music:musicAudio()});audition.setGain(musicValue.enabled?musicValue.gain:0);
        onChange({originalAudio:originalValue,backgroundMusic:musicValue});
        details.dispatchEvent(new Event('canvas:sound-change'));
        if((!video.paused||audition.loading) && (!audition.active || kind==='music'))void start();
    };
    video.addEventListener('play',()=>{if(!audition.active&&(hasAudioEffects(originalValue)||musicValue.enabled&&chosen()))void start();},{signal});
    const groups=[];
    function group(kind,label,initial) {
        const box=document.createElement('fieldset');box.className='canvas-sound-group';
        const legend=document.createElement('legend');legend.textContent=label;box.append(legend);details.append(box);
        const toggleLabel=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=initial.enabled;
        toggleLabel.className='canvas-field';toggleLabel.append(toggle,document.createTextNode(kind==='original'?copy.on:copy.add));box.append(toggleLabel);
        let value={...initial};
        const notify=()=>change(kind,{...value,enabled:toggle.checked});
        toggle.addEventListener('change',notify,{signal});
        const rows=[];
        for(const key of ['gain','fadeIn','fadeOut']) {
            const row=document.createElement('div');row.className='canvas-audio-row';
            const name=key==='gain'?copy.gain:key==='fadeIn'?copy.in:copy.out;
            const text=document.createElement('span');text.textContent=name;row.append(text);
            const slider=document.createElement('input'),number=document.createElement('input'),unit=document.createElement('span');
            slider.type='range';number.type='number';slider.min=number.min='0';slider.max=number.max=key==='gain'?'100':'600';slider.step=number.step=key==='gain'?'1':'0.01';
            slider.setAttribute('aria-label',`${label}: ${name}`);number.setAttribute('aria-label',`${label}: ${name} (${key==='gain'?'%':copy.seconds})`);
            number.className='canvas-input';unit.textContent=key==='gain'?'%':'s';
            const paint=(preserveEdit=true)=>{const shown=key==='gain'?Math.round(value[key]*100):Number(value[key].toFixed(2));slider.value=String(shown);if(!preserveEdit||document.activeElement!==number)number.value=String(shown);slider.setAttribute('aria-valuetext',`${shown} ${unit.textContent}`);};
            const update=control=>{if(control.value===''||!Number.isFinite(Number(control.value)))return;value[key]=Math.min(Number(control.max),Math.max(0,Number(control.value)))/(key==='gain'?100:1);
                if(kind==='original')value=effectiveAudio({...value,enabled:toggle.checked},video.duration);
                rows.forEach(row=>row.paint());notify();};
            slider.addEventListener('input',()=>update(slider),{signal});
            number.addEventListener('input',()=>update(number),{signal});
            number.addEventListener('change',()=>{update(number);paint(false);},{signal});
            row.append(slider,number,unit);box.append(row);rows.push({paint,key,slider,number});paint();
        }
        if(kind==='music') {
            const select=document.createElement('select'),label=document.createElement('label');label.className='canvas-field';label.append(document.createTextNode(copy.type),select);box.append(label);
            const empty=document.createElement('option');empty.value='';empty.textContent=copy.choose;select.append(empty);
            for(const track of tracks){const option=document.createElement('option');option.value=track.assetId;option.textContent=track.sourceTitle;select.append(option);}
            select.value=value.musicAssetId|| (tracks.length===1?tracks[0].assetId:'');select.disabled=!tracks.length;
            select.addEventListener('change',()=>{if(select.value)value.musicAssetId=select.value;else delete value.musicAssetId;notify();},{signal});
            if(!tracks.length){const note=document.createElement('p');note.className='canvas-muted';note.textContent=copy.none;box.append(note);}
        }
        groups.push({kind,refresh(){if(kind==='original'){value=effectiveAudio({...value,enabled:toggle.checked},video.duration);originalValue=value;rows.filter(row=>row.key!=='gain').forEach(row=>{row.slider.max=row.number.max=String(Math.min(600,video.duration||600));});rows.forEach(row=>row.paint());audition.setAudio({originalAudio:value});}}});
    }
    group('original',copy.original,originalValue);group('music',copy.music,musicValue);
    // Keep actionable buttons above metadata-dependent notes so late duration
    // or audio-track discovery cannot move them during pointer-down/up.
    const previewControls=document.createElement('div');previewControls.className='canvas-audition-controls';details.append(previewControls);
    const help=document.createElement('p');help.className='canvas-muted';help.textContent=copy.effective;details.append(help,effectiveMusic,status);
    video.addEventListener('loadedmetadata',()=>{groups.forEach(group=>group.refresh());reflectMusic();},{signal});
    for(const event of ['loadeddata','playing'])video.addEventListener(event,()=>{if(video.audioTracks?.length===0)status.textContent=copy.silent;else if(status.textContent===copy.silent)status.textContent='';},{signal});
    return {details,previewControls, get original(){return originalValue;}, get music(){return musicValue;}, chosen,
        setExportDuration(duration){exportDuration=duration;reflectMusic();},
        setSilent(value){if(value)status.textContent=copy.silent;}};
}
