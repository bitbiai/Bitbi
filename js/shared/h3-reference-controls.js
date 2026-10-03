import { SEEDANCE_25_ROLES, seedance25References } from './seedance-25-contract.mjs?v=__ASSET_VERSION__';
import { uploadOmniReference } from './omni-reference-upload.js?v=__ASSET_VERSION__';
import { OMNI_ROLES, omniReferences } from './gemini-omni-contract.mjs?v=__ASSET_VERSION__';
import { H3_ROLES, h3MediaType } from './minimax-h3.mjs?v=__ASSET_VERSION__';

export function h3RoleLabel(role,de=false) {
    return ({first_frame:['First frame','Anfangsbild'],last_frame:['Last frame','Endbild'],reference_image:['Reference image','Bildreferenz'],
        reference_video:['Reference video','Videoreferenz'],reference_audio:['Reference audio','Audioreferenz']})[role]?.[de?1:0] || role;
}

// Uses each workspace's existing owned-asset picker and saved form settings.
export function createH3ReferenceControls({anchor,de=false,pick,changed,read,write,classes={},omni=false,seedance25=false}) {
    const root=document.createElement('fieldset');if(seedance25)root.dataset.seedance25References='';else if(omni)root.dataset.omniReferences='';else root.dataset.h3References='';root.hidden=true;
    root.className=classes.root||'generate-lab__settings-group';anchor.after(root);
    const legend=document.createElement('legend');legend.textContent=de?'Referenzen':'References';root.append(legend);
    const label=document.createElement('label'),select=document.createElement('select');
    label.textContent=de?'Eingaberolle ':'Input role ';select.className=classes.select||'generate-lab__select';
    for(const role of (seedance25?SEEDANCE_25_ROLES:omni?OMNI_ROLES:H3_ROLES)){const option=document.createElement('option');option.value=role;option.textContent=h3RoleLabel(role,de);select.append(option);}
    label.append(select);root.append(label);
    const add=document.createElement('button');add.type='button';add.className=classes.button||'generate-lab__secondary-btn';add.textContent=de?'Gespeichertes Medium auswählen':'Choose saved media';root.append(add);
    const notice=document.createElement('p');notice.setAttribute('role','status');root.append(notice);
    if(omni){const hint=document.createElement('p');hint.textContent=de?'Ton im Prompt beschreiben. Dauer und Gesprächsfortsetzung sind nicht verfügbar; 4K ist eine Ausgabeoption, keine Zusicherung nativer 4K-Erzeugung.':'Describe generated audio in the instruction. Duration and conversation continuation are unavailable; 4K is an output option, not a claim of native 4K generation.';root.append(hint);}
    const list=document.createElement('ol');root.append(list);
    let version=0,disabled=false,uploading=false;
    const file=document.createElement('input');file.type='file';file.hidden=true;file.accept='image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav';
    const uploadButton=document.createElement('button');uploadButton.type='button';uploadButton.className=classes.button||'generate-lab__secondary-btn';uploadButton.textContent=de?'Medium hochladen':'Upload media';
    if(omni||seedance25){if(seedance25)file.accept=file.accept.replace(',video/webm','');root.append(uploadButton,file);uploadButton.addEventListener('click',()=>file.click());file.addEventListener('change',async()=>{
        const selected=file.files[0],role=select.value,epoch=version;file.value='';if(!selected||disabled||uploading)return;
        if(!selected.type.startsWith(h3MediaType(role)+'/')){notice.textContent=de?'Dateityp passt nicht zur Eingaberolle.':'The file type does not match the selected role.';return;}
        uploading=true;uploadButton.disabled=true;notice.textContent=de?'Medium wird privat gespeichert…':'Saving private media…';
        try{const asset=await uploadOmniReference(selected);if(epoch!==version)return;const old=read(),next=role==='reference_image'||seedance25&&role.startsWith('reference_')?old:old.filter(entry=>entry.role!==role);const entry={role,source:{source_type:'saved_asset',asset_id:asset.id},title:asset.title};(seedance25?seedance25References:omniReferences)([...next,entry].map(({role,source})=>({role,source})));write([...next,entry]);notice.textContent='';render();changed();}
        catch(error){if(epoch===version)notice.textContent=de?'Referenz konnte nicht hinzugefügt werden. Gespeicherte Uploads finden Sie in Assets.':error.message;}
        finally{uploading=false;uploadButton.disabled=disabled;}
    });}

    function render(){
        list.replaceChildren();if(root.hidden)return;const entries=read();
        entries.forEach((entry,index)=>{
            const li=document.createElement('li'),text=document.createElement('span');text.textContent=`${h3RoleLabel(entry.role,de)}: ${entry.title || entry.source.asset_id}`;li.append(text);
            if((omni||seedance25) && /^[A-Za-z0-9_-]{1,128}$/.test(entry.source?.asset_id||'')){
                const media=h3MediaType(entry.role),preview=document.createElement(media==='image'?'img':media);
                preview.src=media==='image'?`/api/ai/images/${encodeURIComponent(entry.source.asset_id)}/medium`:`/api/ai/text-assets/${encodeURIComponent(entry.source.asset_id)}/file`;
                preview.style.maxWidth='160px';preview.style.maxHeight='100px';
                if(media==='image'){preview.alt=entry.title||h3RoleLabel(entry.role,de);preview.loading='lazy';}else{preview.controls=true;preview.preload='none';preview.setAttribute('aria-label',text.textContent);}li.append(preview);
            }
            for(const [symbol,name,action] of [
                ['↑',de?'Nach oben':'Move up',()=>{if(index){const items=[...read()];[items[index-1],items[index]]=[items[index],items[index-1]];write(items);}}],
                ['×',de?'Entfernen':'Remove',()=>write(read().filter((_,i)=>i!==index))],
            ]) {
                const button=document.createElement('button');button.type='button';button.className=classes.button||'generate-lab__secondary-btn';button.textContent=symbol;button.setAttribute('aria-label',`${name}: ${text.textContent}`);button.disabled=disabled||(symbol==='↑'&&index===0);
                button.addEventListener('click',()=>{action();render();changed();});li.append(button);
            }
            list.append(li);
        });
        add.disabled=disabled||entries.length>=(seedance25?52:omni?14:12);select.disabled=disabled;uploadButton.disabled=disabled||uploading;
    }
    add.addEventListener('click',()=>{
        const role=select.value,epoch=version;
        pick({media:h3MediaType(role),max:1,trigger:add,onApply:assets=>{
            if(epoch!==version||disabled||!assets[0])return false;
            const entry={role,source:{source_type:'saved_asset',asset_id:assets[0].id},title:assets[0].title||assets[0].file_name||''};
            const old=read(),frame=['first_frame','last_frame'].includes(role);
            const next=seedance25?(frame?old.filter(e=>e.role!==role):old):omni?(role==='reference_image'?old:old.filter(e=>e.role!==role)):frame?old.filter(e=>['first_frame','last_frame'].includes(e.role)&&e.role!==role):old.filter(e=>!['first_frame','last_frame'].includes(e.role));
            try{if(omni||seedance25)(seedance25?seedance25References:omniReferences)([...next,entry].map(({role,source})=>({role,source})));}catch(error){notice.textContent=de?'Für diese Rolle sind keine weiteren Referenzen erlaubt.':error.message;return false;}
            notice.textContent='';write([...next,entry]);render();changed();return true;
        }});
    });
    return {sync(visible,busy){if(root.hidden===visible)version++;root.hidden=!visible;disabled=busy;render();},
        values(){return read().map(({role,source})=>({role,source:{...source}}));}};
}
