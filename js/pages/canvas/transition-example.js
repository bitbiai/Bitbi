import {TRANSITIONS} from '../../shared/canvas-transitions.mjs?v=__ASSET_VERSION__';

// Static illustrations only: no Canvas API, project state or rendering actions.
export function transitionExample({parent,german,signal}) {
    const copy=german?{example:'Beispiel',label:'Generisches Übergangsbeispiel',note:'Generische Illustration A → B. Nicht deine Clips oder aktuellen Parameter.',pause:'Beispiel pausieren',play:'Beispiel wiederholen',loading:'Beispiel wird geladen…',error:'Beispiel nicht verfügbar. Die Effekteinstellungen bleiben nutzbar.',still:'Standbild · Animation auf Wunsch',playing:'Animation · A → B'}
        :{example:'Example',label:'Generic transition example',note:'Generic A → B illustration. Not your clips or current parameters.',pause:'Pause example',play:'Replay example',loading:'Loading example…',error:'Example unavailable. Effect settings remain available.',still:'Still image · play when ready',playing:'Animation · A → B'};
    const figure=document.createElement('figure');figure.className='canvas-transition-example';figure.setAttribute('aria-label',copy.label);
    const caption=document.createElement('figcaption'),name=document.createElement('strong'),note=document.createElement('p');
    note.className='canvas-muted';note.textContent=copy.note;caption.append(name,note);
    const media=document.createElement('div');media.className='canvas-transition-example__media';
    const state=document.createElement('p');state.className='canvas-muted';state.setAttribute('aria-live','polite');
    const button=document.createElement('button');button.type='button';button.className='canvas-button canvas-button--compact';
    figure.append(caption,media,state,button);parent.append(figure);
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    let preset=null,paused=true,userPaused=false,generation=0,image=null,failed=false;
    function clear(){generation++;if(image){image.onload=image.onerror=null;image.removeAttribute('src');image.remove();image=null;}media.replaceChildren();}
    function load(){
        clear();if(signal.aborted||!preset)return;
        const version=generation;failed=false;state.textContent=copy.loading;
        button.textContent=paused?copy.play:copy.pause;
        const next=new Image(160,90);image=next;next.alt=`${copy.example}: ${german?preset.de:preset.en} · A → B`;next.decoding='async';
        next.onload=()=>{if(signal.aborted||version!==generation)return;media.replaceChildren(next);state.textContent=paused?copy.still:copy.playing;};
        next.onerror=()=>{if(signal.aborted||version!==generation)return;failed=true;clear();state.textContent=copy.error;button.textContent=copy.play;};
        next.src=`/assets/canvas/transition-examples/${preset.id}.${paused?'png':'gif'}?v=__ASSET_VERSION__`;
    }
    button.addEventListener('click',()=>{paused=failed?false:!paused;userPaused=paused;load();},{signal});
    motion.addEventListener('change',()=>{if(motion.matches){paused=true;load();}},{signal});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&!paused){paused=true;load();}},{signal});
    signal.addEventListener('abort',clear,{once:true});
    return {show(id){
        if(signal.aborted||preset?.id===id)return;
        preset=TRANSITIONS.find(entry=>entry.id===id)||null;
        if(!preset){clear();figure.hidden=true;return;}
        figure.hidden=false;name.textContent=`${copy.example} · ${german?preset.de:preset.en}`;
        // Flash is opt-in even without reduced motion. Replay is always explicit.
        paused=userPaused||motion.matches||preset.id==='flash';load();
    }};
}
