import { H3_ROLES, h3MediaType } from './minimax-h3.mjs?v=__ASSET_VERSION__';

export function h3RoleLabel(role,de=false) {
    return ({first_frame:['First frame','Anfangsbild'],last_frame:['Last frame','Endbild'],reference_image:['Reference image','Bildreferenz'],
        reference_video:['Reference video','Videoreferenz'],reference_audio:['Reference audio','Audioreferenz']})[role]?.[de?1:0] || role;
}

// Uses each workspace's existing owned-asset picker and saved form settings.
export function createH3ReferenceControls({anchor,de=false,pick,changed,read,write,classes={}}) {
    const root=document.createElement('fieldset');root.dataset.h3References='';root.hidden=true;
    root.className=classes.root||'generate-lab__settings-group';anchor.after(root);
    const legend=document.createElement('legend');legend.textContent=de?'Referenzen':'References';root.append(legend);
    const label=document.createElement('label'),select=document.createElement('select');
    label.textContent=de?'Eingaberolle ':'Input role ';select.className=classes.select||'generate-lab__select';
    for(const role of H3_ROLES){const option=document.createElement('option');option.value=role;option.textContent=h3RoleLabel(role,de);select.append(option);}
    label.append(select);root.append(label);
    const add=document.createElement('button');add.type='button';add.className=classes.button||'generate-lab__secondary-btn';add.textContent=de?'Gespeichertes Medium auswählen':'Choose saved media';root.append(add);
    const list=document.createElement('ol');root.append(list);
    let version=0,disabled=false;
    function render(){
        list.replaceChildren();const entries=read();
        entries.forEach((entry,index)=>{
            const li=document.createElement('li'),text=document.createElement('span');text.textContent=`${h3RoleLabel(entry.role,de)}: ${entry.title || entry.source.asset_id}`;li.append(text);
            for(const [symbol,name,action] of [
                ['↑',de?'Nach oben':'Move up',()=>{if(index){const items=[...read()];[items[index-1],items[index]]=[items[index],items[index-1]];write(items);}}],
                ['×',de?'Entfernen':'Remove',()=>write(read().filter((_,i)=>i!==index))],
            ]) {
                const button=document.createElement('button');button.type='button';button.className=classes.button||'generate-lab__secondary-btn';button.textContent=symbol;button.setAttribute('aria-label',`${name}: ${text.textContent}`);button.disabled=disabled||(symbol==='↑'&&index===0);
                button.addEventListener('click',()=>{action();render();changed();});li.append(button);
            }
            list.append(li);
        });
        add.disabled=disabled||entries.length>=12;select.disabled=disabled;
    }
    add.addEventListener('click',()=>{
        const role=select.value,epoch=version;
        pick({media:h3MediaType(role),max:1,trigger:add,onApply:assets=>{
            if(epoch!==version||disabled||!assets[0])return false;
            const entry={role,source:{source_type:'saved_asset',asset_id:assets[0].id},title:assets[0].title||assets[0].file_name||''};
            const old=read(),frame=['first_frame','last_frame'].includes(role);
            const next=frame?old.filter(e=>['first_frame','last_frame'].includes(e.role)&&e.role!==role):old.filter(e=>!['first_frame','last_frame'].includes(e.role));
            write([...next,entry]);render();changed();return true;
        }});
    });
    return {sync(visible,busy){if(root.hidden===visible)version++;root.hidden=!visible;disabled=busy;render();},
        values(){return read().map(({role,source})=>({role,source:{...source}}));}};
}
