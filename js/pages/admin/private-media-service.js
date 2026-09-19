import { apiAdminPrivateMediaService,apiAdminSetPrivateMediaService } from '../../shared/auth-api.js?v=__ASSET_VERSION__';
export function createPrivateMediaServicePanel() {
    const byId=id=>document.getElementById(id),form=byId('privateMediaServiceForm'),select=byId('privateMediaServiceSelect'),save=byId('privateMediaServiceSave'),reason=byId('privateMediaServiceReason'),status=byId('privateMediaServiceStatus');
    const de=document.documentElement.lang==='de'||new URLSearchParams(location.search).get('lang')==='de';
    const states=de?{ready:'Bereit',not_configured:'Nicht eingerichtet',degraded:'Gestört'}:{ready:'Ready',not_configured:'Not configured',degraded:'Degraded'};
    let current=null,pending=false,dirty=false,epoch=0;
    if(!form)return {load:async()=>{}};
    if(de){byId('privateMediaServiceTitle').textContent='Private Medienverarbeitung';byId('privateMediaServiceScope').textContent='Video-Thumbnails und vollständige Canvas-Exporte. Bestehende Aufträge behalten ihren Service; öffentliche Hero- und Stream-Verarbeitung bleiben unverändert.';form.querySelector('label[for="privateMediaServiceSelect"] span').textContent='Service';form.querySelector('label[for="privateMediaServiceReason"] span').textContent='Begründung';save.textContent='Service speichern';}
    function render(data){
        current=data;select.disabled=false;
        for(const option of select.options)option.disabled=data.services[option.value]?.state!=='ready';
        select.value=data.backend;save.disabled=false;
        status.textContent=`GitHub Actions: ${states[data.services.github.state]} · Cloudflare Container: ${states[data.services.cloudflare.state]}`;
    }
    async function load(){
        if(pending||dirty)return;pending=true;const activeEpoch=epoch;
        try{const r=await apiAdminPrivateMediaService();if(activeEpoch!==epoch)return;if(!r.ok)throw new Error();render(r.data.data);}
        catch{status.textContent=de?'Status nicht verfügbar. Auswahl wurde nicht geändert.':'Status unavailable. Selection has not changed.';select.disabled=true;save.disabled=true;}
        finally{pending=false;}
    }
    form.addEventListener('input',()=>{dirty=true;});
    form.addEventListener('submit',async event=>{
        event.preventDefault();if(pending||!current||!form.reportValidity())return;
        const backend=select.value,description=reason.value.trim();if(!description)return;
        if(!window.confirm(de?'Service nur für neue private Medienaufträge wechseln?':'Change service for new private media jobs only?'))return;
        const activeEpoch=epoch;pending=true;save.disabled=true;select.disabled=true;reason.disabled=true;
        try{const r=await apiAdminSetPrivateMediaService({backend,reason:description});if(activeEpoch!==epoch)return;if(!r.ok)throw new Error();dirty=false;render(r.data.data);reason.value='';}
        catch{status.textContent=de?'Speichern nicht bestätigt. Gespeicherten Status erneut laden.':'Save not confirmed. Reload the stored status before another change.';dirty=false;}
        finally{pending=false;reason.disabled=false;await load();}
    });
    document.addEventListener('bitbi:auth-change',({detail})=>{if(!detail?.ready||detail.loggedIn&&detail.sessionConfirmed!==false&&detail.user?.role==='admin')return;epoch++;current=null;dirty=false;select.disabled=true;save.disabled=true;reason.value='';status.textContent='';});
    return {load};
}
