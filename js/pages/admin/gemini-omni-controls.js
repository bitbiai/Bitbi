import { OMNI_FEATURES, OMNI_RESOLUTIONS } from '../../shared/gemini-omni-contract.mjs';
import { apiAdminModelPricingChange } from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { refreshModelPricing } from '../../shared/model-pricing-client.js';

const element = (tag, text) => { const node=document.createElement(tag); if(text)node.textContent=text; return node; };
const names={generation:'Base generation and generated audio',image:'First-frame / image input',frames:'Last-frame input',reference_images:'Ordered reference images (up to 10)',video_edit:'Independent video-input editing',audio_reference:'Uploaded audio reference'};

export function createOmniReadinessControls(initial) {
    const root=element('section');root.className='model-status__system';root.dataset.omniControls='';root.lang='en';
    let state=initial,busy=false;
    function render(){
        root.replaceChildren(element('h3','Gemini Omni Flash · activation'));
        root.append(element('p','Exact model: google/gemini-omni-flash · Cloudflare Workers AI / default AI Gateway. Provider costs and live capability acceptance are not implied by configuration. Conversation continuation is deferred.'));
        root.append(element('p','Retail tariffs are configured separately in Model Pricing for each operation and resolution. They are final customer credit prices. Admin tests reserve the platform-budget units below; they do not debit members or require a member tariff.'));
        if(!state){root.append(element('p','Readiness unavailable. New Omni requests remain blocked.'));return;}
        root.append(element('p',`Active revision ${state.revision}. Admin paid testing: ${state.adminTestEnabled?'enabled':'off'}.`));
        const form=element('form');form.className='model-pricing__settings';form.addEventListener('submit',event=>event.preventDefault());
        const field=(label,input)=>{const node=element('label',label+' ');node.append(input);form.append(node);return input;};
        const enabled=element('input');enabled.type='checkbox';enabled.checked=state.adminTestEnabled;
        field('Enable explicitly initiated paid Admin tests',enabled);
        const credits=element('input');credits.type='number';credits.min='1';credits.max='100000';credits.step='1';credits.value=state.adminTestCredits??'';
        field('Reserved platform-budget units per test (not a verified USD cost)',credits);
        const reason=field('Change / acceptance note',element('input'));reason.maxLength=500;reason.minLength=10;reason.required=true;
        const evidence=field('Completed owned Admin job ID (required for member activation)',element('input'));evidence.maxLength=128;
        const status=element('p');status.setAttribute('role','status');
        async function save(change){
            if(busy)return;
            if(!reason.reportValidity())return;
            busy=true;for(const input of root.querySelectorAll('button,input'))input.disabled=true;
            status.textContent='Saving configuration… No model is called.';
            const result=await apiAdminModelPricingChange({action:'omni_readiness',revision:state.revision,reason:reason.value.trim(),...change});
            busy=false;
            if(result.ok){state=result.data.omni;await refreshModelPricing();render();}
            else{status.textContent=result.error||'Settings were not saved. Reload if another administrator changed them.';for(const input of root.querySelectorAll('button,input'))input.disabled=false;}
        }
        const button=(text,change)=>{const button=element('button',text);button.type='button';button.className='model-pricing__button';button.addEventListener('click',()=>save(change()));return button;};
        form.append(button('Save Admin test settings',()=>({config:{adminTestEnabled:enabled.checked,adminTestCredits:credits.value===''?null:Number(credits.value)}})));
        root.append(form,element('p','Member activation requires your acceptance of a stored Admin test that exercised that capability/resolution. Successful storage alone does not certify visual quality. Set prices first; disabling any required capability blocks new member inference immediately.'));
        const list=element('div');list.className='model-pricing__settings';
        for(const feature of [...OMNI_FEATURES,...OMNI_RESOLUTIONS]){
            const row=element('div');row.append(element('strong',names[feature]||feature),element('p',state.enabled[feature]?'Member enabled · owner acceptance recorded':'Member off · unverified or deactivated'));
            if(state.acceptance?.[feature])row.append(element('small',`Accepted job ${state.acceptance[feature].jobId} · ${state.acceptance[feature].completedAt}`));
            row.append(button(state.enabled[feature]?'Deactivate for members':'Accept test and activate',()=>({feature,enabled:!state.enabled[feature],evidenceJobId:evidence.value.trim()})));list.append(row);
        }
        root.append(list,status);
        const history=element('details');history.append(element('summary','Configuration history'));
        for(const change of [...state.history].reverse())history.append(element('p',`Revision ${change.revision} · ${change.at} · ${change.actor} · ${change.feature}: ${change.enabled?'on':'off'} · ${change.reason}`));
        root.append(history);
    }
    render();return root;
}
