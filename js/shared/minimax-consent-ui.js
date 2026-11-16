import { MINIMAX_CONSENT_COPY } from './minimax-consent-copy.mjs?v=__ASSET_VERSION__';
import { isMinimaxConsentModel, MINIMAX_CONSENT_TEXT_VERSION } from './minimax-consent.mjs?v=__ASSET_VERSION__';
import { getCurrentLocale } from './locale.js?v=__ASSET_VERSION__';
import { getAuthState,patchAuthUser } from './auth-state.js';
import { apiMinimaxConsent,apiGrantMinimaxConsent,apiRevokeMinimaxConsent } from './auth-api.js?v=__ASSET_VERSION__';
let activeDialog=null;
const copy=()=>MINIMAX_CONSENT_COPY[getCurrentLocale()];
const element=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
function styles(){if(document.getElementById('minimaxConsentStyles'))return;const link=element('link');link.id='minimaxConsentStyles';link.rel='stylesheet';link.href='/css/components/minimax-consent.css?v=__ASSET_VERSION__';document.head.append(link);}
function linkedText(node,text,c=copy()) {
  const entries=Object.entries(c.linkLabels).sort((a,b)=>b[1].length-a[1].length);
  // Supplied copy is plain text. Only the two fixed local destinations become links.
  while(text){let best=null;for(const [key,label]of entries){const index=text.indexOf(label);if(index>=0&&(!best||index<best.index))best={key,label,index};}
    if(!best){node.append(document.createTextNode(text));break;}
    node.append(document.createTextNode(text.slice(0,best.index)));const link=element('a',best.label);link.href=c.links[best.key];node.append(link);text=text.slice(best.index+best.label.length);}
  return node;
}
function dated(text,date){const value=date&&Number.isFinite(Date.parse(date))?new Intl.DateTimeFormat(getCurrentLocale(),{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(date)):'—';return text.replaceAll('[DATUM]',value);}
function remember(consent,owner){if(getAuthState().user?.id===owner)patchAuthUser({minimaxConsent:consent});}
export function mountMinimaxRegistration(form){
  styles();const c=copy(),root=element('div');root.className='minimax-consent-registration';
  const label=element('label'),checkbox=element('input');checkbox.type='checkbox';checkbox.name='minimaxConsent';checkbox.id='authMinimaxConsent';label.append(checkbox,document.createTextNode(c.register.label));root.append(label);
  for(const text of c.register.paragraphs)root.append(linkedText(element('p'),text,c));
  const link=element('a',c.register.linkText);link.href=c.links.privacy;root.append(link);form.querySelector('button[type="submit"]').before(root);
}
export function showMinimaxConsentDialog({source='first_use',signal}={}){
  if(activeDialog)return activeDialog;
  styles();const c=copy(),owner=getAuthState().user?.id;
  activeDialog=new Promise(resolve=>{
    const dialog=element('dialog');dialog.className='minimax-consent-dialog';dialog.dataset.minimaxConsentDialog='';
    const title=element('h2',c.dialog.title);title.id='minimaxConsentTitle';dialog.setAttribute('aria-labelledby',title.id);dialog.append(title);
    for(const text of c.dialog.paragraphs)dialog.append(linkedText(element('p'),text,c));
    const message=element('p');message.setAttribute('role','status');dialog.append(message);
    const actions=element('div');actions.className='minimax-consent-actions';const accept=element('button',c.dialog.accept),decline=element('button',c.dialog.decline);accept.type=decline.type='button';actions.append(decline,accept);dialog.append(actions);
    const previous=document.activeElement;
    const finish=value=>{document.removeEventListener('bitbi:auth-change',changed);signal?.removeEventListener('abort',abort);dialog.close();dialog.remove();previous?.focus?.();resolve(value);};
    const abort=()=>finish(false),changed=()=>{if(getAuthState().user?.id!==owner)finish(false);};
    document.addEventListener('bitbi:auth-change',changed);signal?.addEventListener('abort',abort,{once:true});
    decline.addEventListener('click',()=>finish(false));dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
    let reloadRequired=false;
    accept.addEventListener('click',async()=>{
      if(reloadRequired){location.reload();return;}
      accept.disabled=decline.disabled=true;const result=await apiGrantMinimaxConsent({confirmed:true,source,locale:getCurrentLocale(),displayedTextVersion:MINIMAX_CONSENT_TEXT_VERSION});
      if(!dialog.isConnected)return;
      if(result.ok&&result.data?.consent?.granted&&getAuthState().user?.id===owner){remember(result.data.consent,owner);finish(true);}
      else if(result.code==='consent_text_changed'){
        // Never acknowledge a server version whose risk text this page did not display.
        reloadRequired=true;message.textContent=getCurrentLocale()==='de'?'Der Einwilligungstext wurde aktualisiert. Bitte lade die Seite neu und lies den aktuellen Text.':'The consent text has changed. Reload the page and review the current text.';
        accept.textContent=getCurrentLocale()==='de'?'Seite neu laden':'Reload page';accept.disabled=decline.disabled=false;
      }
      else{message.textContent=getCurrentLocale()==='de'?'Einwilligung konnte nicht gespeichert werden. Bitte erneut versuchen.':'Consent could not be saved. Please try again.';accept.disabled=decline.disabled=false;}
    });
    document.body.append(dialog);dialog.showModal();decline.focus();if(signal?.aborted)finish(false);
  }).finally(()=>{activeDialog=null;});return activeDialog;
}
export async function ensureMinimaxConsent(model,{force=false,signal}={}){
  if(!isMinimaxConsentModel(model))return true;
  if(signal?.aborted)return false;
  const owner=getAuthState().user?.id;
  if(!force){const result=await apiMinimaxConsent();if(signal?.aborted||getAuthState().user?.id!==owner)return false;if(!result.ok)return false;remember(result.data.consent,owner);if(result.data.consent?.granted)return true;}
  return showMinimaxConsentDialog({signal});
}
export function minimaxConsentDeclined(){return {ok:false,status:403,code:'consent_required',error:copy().dialog.blocked,phase:'preflight'};}
export function renderMinimaxNotice(root,model){
  if(!root)return;root.dataset.minimaxConsentModel=model||'';root.replaceChildren();root.hidden=!isMinimaxConsentModel(model);if(root.hidden)return;root.className='minimax-consent-notice';
  const c=copy(),status=getAuthState().user?.minimaxConsent;
  linkedText(root,status?.granted?dated(c.notices[model==='minimax/music-2.6'?'music':'video'],status.grantedAt):c.dialog.blocked,c);
}
export function createMinimaxNotice(anchor,model){styles();const root=element('p');root.dataset.minimaxConsentNotice='';anchor.after(root);renderMinimaxNotice(root,model);document.addEventListener('bitbi:auth-change',()=>{if(root.isConnected)renderMinimaxNotice(root,root.dataset.minimaxConsentModel);});return root;}
export function minimaxReferenceConfirmation(){const label=element('label'),input=element('input');input.type='checkbox';input.dataset.minimaxReferenceAssurance='';label.className='minimax-reference-assurance';label.append(input,document.createTextNode(copy().referenceLabel));styles();return {label,input};}
export function mountMinimaxSettings(root){
  if(!root)return;styles();const c=copy(),heading=element('h2',c.settings.label),description=linkedText(element('p'),c.settings.description),toggle=element('input'),label=element('label',c.settings.label),status=element('p');
  toggle.type='checkbox';toggle.setAttribute('role','switch');toggle.id='minimaxConsentToggle';toggle.disabled=true;label.htmlFor=toggle.id;status.setAttribute('role','status');root.append(heading,description,label,toggle,status);
  const render=consent=>{toggle.checked=Boolean(consent?.granted);status.textContent=consent?.granted?dated(c.settings.granted,consent.grantedAt):consent?.revokedAt?c.settings.revoked:c.settings.notGranted;};
  const refresh=async()=>{toggle.disabled=true;const owner=getAuthState().user?.id,result=await apiMinimaxConsent();if(result.ok&&getAuthState().user?.id===owner){remember(result.data.consent,owner);render(result.data.consent);toggle.disabled=false;}};
  toggle.addEventListener('change',async()=>{const grant=toggle.checked;toggle.checked=!grant;toggle.disabled=true;const owner=getAuthState().user?.id;
    if(grant)await showMinimaxConsentDialog({source:'settings'});
    else{const result=await apiRevokeMinimaxConsent();if(result.ok){remember(result.data.consent,owner);}else{render(getAuthState().user?.minimaxConsent);status.textContent=getCurrentLocale()==='de'?'Widerruf nicht gespeichert. Bitte erneut versuchen.':'Withdrawal was not saved. Please try again.';toggle.disabled=!getAuthState().loggedIn;return;}}
    const consent=getAuthState().user?.minimaxConsent;render(consent);
    if(grant&&consent?.granted)status.textContent=dated(c.settings.regranted,consent.grantedAt);
    toggle.disabled=!getAuthState().loggedIn;
  });
  document.addEventListener('bitbi:auth-change',()=>{render(getAuthState().user?.minimaxConsent);toggle.disabled=!getAuthState().loggedIn;});void refresh();
}

export function confirmMinimaxReference(){
  styles();return new Promise(resolve=>{
    const dialog=element('dialog');dialog.className='minimax-consent-dialog';
    const assurance=minimaxReferenceConfirmation(),cancel=element('button',copy().dialog.decline),accept=element('button',getCurrentLocale()==='de'?'Referenz hinzufügen':'Add reference');
    cancel.type=accept.type='button';accept.disabled=true;assurance.input.addEventListener('change',()=>{accept.disabled=!assurance.input.checked;});
    const finish=value=>{dialog.close();dialog.remove();resolve(value);};
    cancel.addEventListener('click',()=>finish(false));accept.addEventListener('click',()=>{if(assurance.input.checked)finish(true);});dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
    const actions=element('div');actions.className='minimax-consent-actions';actions.append(cancel,accept);dialog.append(assurance.label,actions);document.body.append(dialog);dialog.showModal();assurance.input.focus();
  });
}
