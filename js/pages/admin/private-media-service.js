import { apiAdminPrivateMediaService,apiAdminSetPrivateMediaService } from '../../shared/auth-api.js?v=__ASSET_VERSION__';
export function createPrivateMediaServicePanel() {
    const byId=id=>document.getElementById(id),form=byId('privateMediaServiceForm'),select=byId('privateMediaServiceSelect'),thumbnail=byId('thumbnailMediaServiceSelect'),save=byId('privateMediaServiceSave'),reason=byId('privateMediaServiceReason'),status=byId('privateMediaServiceStatus');
    const de=document.documentElement.lang==='de'||new URLSearchParams(location.search).get('lang')==='de';
    const states=de?{ready:'Bereit',not_configured:'Nicht eingerichtet',degraded:'Gestört'}:{ready:'Ready',not_configured:'Not configured',degraded:'Degraded'};
    let current=null,pending=false,dirty=false,epoch=0;
    if(!form)return {load:async()=>{}};
    if(de){byId('privateMediaServiceTitle').textContent='Private Medienverarbeitung';byId('privateMediaServiceScope').textContent='Thumbnails und Vorschauen unabhängig von vollständigen Videoexporten verarbeiten. Angenommene Aufträge behalten ihren Service.';form.querySelector('label[for="privateMediaServiceSelect"] span').textContent='Gesamtvideo erstellen';form.querySelector('label[for="thumbnailMediaServiceSelect"] span').textContent='Thumbnails und Vorschauen';form.querySelector('label[for="privateMediaServiceReason"] span').textContent='Begründung';save.textContent='Service speichern';}
    function render(data){
        current=data;select.disabled=false;thumbnail.disabled=false;
        for(const option of select.options)option.disabled=data.services[option.value]?.state!=='ready';
        for(const option of thumbnail.options){const service=data.services[option.value];option.disabled=(service?.thumbnailState||service?.state)!=='ready';}
        select.value=data.backend;thumbnail.value=data.thumbnailBackend;save.disabled=false;
        status.textContent=`GitHub Actions: ${states[data.services.github.state]} · Cloudflare Container: ${states[data.services.cloudflare.state]}${data.services.cloudflare.thumbnailState&&data.services.cloudflare.thumbnailState!==data.services.cloudflare.state?` · ${de?'Vorschauen':'Previews'}: ${states[data.services.cloudflare.thumbnailState]}`:''}`;
    }
    async function load(){
        if(pending||dirty)return;pending=true;const activeEpoch=epoch;
        try{const r=await apiAdminPrivateMediaService();if(activeEpoch!==epoch)return;if(!r.ok)throw new Error();render(r.data.data);}
        catch{status.textContent=de?'Status nicht verfügbar. Auswahl wurde nicht geändert.':'Status unavailable. Selection has not changed.';select.disabled=true;thumbnail.disabled=true;save.disabled=true;}
        finally{pending=false;}
    }
    form.addEventListener('input',()=>{dirty=true;});
    form.addEventListener('submit',async event=>{
        event.preventDefault();if(pending||!current||!form.reportValidity())return;
        const backend=select.value,thumbnailBackend=thumbnail.value,description=reason.value.trim();if(!description)return;
        if(!window.confirm(de?'Service nur für neue Medienaufträge wechseln?':'Change service for new media jobs only?'))return;
        const activeEpoch=epoch;pending=true;save.disabled=true;select.disabled=true;thumbnail.disabled=true;reason.disabled=true;
        try{const r=await apiAdminSetPrivateMediaService({backend,thumbnailBackend,reason:description});if(activeEpoch!==epoch)return;if(!r.ok)throw new Error();dirty=false;render(r.data.data);reason.value='';}
        catch{status.textContent=de?'Speichern nicht bestätigt. Gespeicherten Status erneut laden.':'Save not confirmed. Reload the stored status before another change.';dirty=false;}
        finally{pending=false;reason.disabled=false;await load();}
    });
    document.addEventListener('bitbi:auth-change',({detail})=>{if(!detail?.ready||detail.loggedIn&&detail.sessionConfirmed!==false&&detail.user?.role==='admin')return;epoch++;current=null;dirty=false;select.disabled=true;thumbnail.disabled=true;save.disabled=true;reason.value='';status.textContent='';});
    return {load};
}
