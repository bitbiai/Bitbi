// Uses the existing owned-asset picker; never accepts provider/public URLs.
export function createGrokVideoControls({anchor, de, pick, changed}) {
    const root=document.createElement('div');root.className='generate-lab__settings-group';root.hidden=true;anchor.after(root);
    const fields=document.createElement('div');fields.className='generate-lab__field-grid';root.append(fields);
    const actions=document.createElement('div');actions.className='generate-lab__result-actions';root.append(actions);
    const field=(name, control)=>{const label=document.createElement('label');label.className='generate-lab__field';const text=document.createElement('span');text.className='generate-lab__label';text.textContent=name;label.append(text,control);fields.append(label);return label;};
    const operation=document.createElement('select');operation.id='labVideoOperation';operation.className='generate-lab__select';
    for(const [value,en,deLabel] of [['generate','Generate','Generieren'],['edit','Edit','Bearbeiten'],['extend','Extend','Verlängern']]){const option=document.createElement('option');option.value=value;option.textContent=de?deLabel:en;operation.append(option);}
    field(de?'Vorgang':'Operation',operation);
    const size=document.createElement('select');size.id='labVideoSize';size.className='generate-lab__select';field(de?'Größe':'Size',size);
    const sources=document.createElement('button');sources.type='button';sources.className='generate-lab__secondary-btn';sources.id='labVideoSources';actions.append(sources);
    const references=document.createElement('button');references.type='button';references.className='generate-lab__secondary-btn';references.id='labVideoReferenceImages';actions.append(references);
    const clear=document.createElement('button');clear.type='button';clear.className='generate-lab__secondary-btn';clear.textContent=de?'Referenzen entfernen':'Clear references';actions.append(clear);
    let images=[],video=null,currentModel=null;
    const render=()=>{sources.textContent=operation.value==='generate'?(de?`Bildreferenzen (${images.length})`:`Image references (${images.length})`):(video?.title|| (de?'Originalvideo auswählen':'Choose original video'));references.hidden=operation.value==='generate';references.textContent=de?`Bildreferenzen (${images.length}/10)`:`Reference images (${images.length}/10)`;clear.hidden=!images.length&&!video;};
    const reset=()=>{images=[];video=null;render();};
    operation.addEventListener('change',()=>{reset();changed();});size.addEventListener('change',changed);
    clear.addEventListener('click',()=>{reset();changed();});
    const choose=(imageOnly,trigger)=>{
        const model=currentModel,op=operation.value,media=imageOnly||op==='generate'?'image':'video';
        pick({media,max:media==='image'?10:1,trigger,onApply:selection=>{
            if(model!==currentModel||op!==operation.value)return false;
            if(media==='image')images=selection;else video=selection[0];render();changed();return true;
        }});
    };
    sources.addEventListener('click',()=>choose(false,sources));
    references.addEventListener('click',()=>choose(true,references));
    return {
        sync(model,busy){root.hidden=!model.id.startsWith('xai/grok-imagine-video');if(root.hidden)return;
            if(currentModel!==model.id){currentModel=model.id;for(const option of operation.options)option.disabled=!(model.options.operation||['generate']).includes(option.value);operation.value='generate';size.replaceChildren();for(const value of ['',...(model.options.size||[])]){const option=document.createElement('option');option.value=value;option.textContent=value||(de?'Automatisch':'Automatic');size.append(option);}reset();}
            for(const control of [operation,size,sources,references,clear])control.disabled=busy;
        },
        values(){const ref=asset=>({source_type:'saved_asset',asset_id:asset.id});return {_operation:operation.value,...(size.value?{size:size.value}:{}),...(operation.value==='generate'?(images.length===1?{source_image:ref(images[0])}:images.length?{source_images:images.map(ref)}:{}):{...(video?{source_video:ref(video)}:{}),...(images.length?{source_images:images.map(ref)}:{})})};},
        valid(){return operation.value==='generate'||Boolean(video);},
    };
}
