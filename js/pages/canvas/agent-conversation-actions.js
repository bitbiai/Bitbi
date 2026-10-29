import {refreshCanvasNotifications} from './notifications.js?v=__ASSET_VERSION__';
const create=(tag,className='',text='')=>{const node=document.createElement(tag);node.className=className;node.textContent=text;return node;};
const id=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const number=value=>Number.isSafeInteger(value)&&value>=0;

// Only server-persisted action results can offer confirmations or navigation.
// No model-supplied endpoint, HTML, arbitrary request body or URL is executed.
export function createCanvasConversationActions({parent,copy,confirm,effect,changed}){
    const list=create('div','canvas-agent__conversation-actions');parent.append(list);
    const entries=new Map(),seen=new Set();let initialized=false;
    function render(values,{busy=false}={}){
        const actions=(Array.isArray(values)?values:[]).filter(value=>value&&id(value.id)).slice(-12),retained=new Set();
        for(const action of actions){
            const effectKey=`${action.id}:${action.state}`;
            if(action.state==='completed'&&!seen.has(effectKey)&&initialized){
                refreshCanvasNotifications();
                const value=action.effect;
                if(value&&['refresh','show_project','show_result','focus_node'].includes(value.kind)&&(value.kind!=='focus_node'||id(value.targetId)))void effect({kind:value.kind,...(id(value.targetId)?{targetId:value.targetId}:{})});
            }
            seen.add(effectKey);
            if(action.state!=='confirmation_required')continue;
            retained.add(action.id);let entry=entries.get(action.id);
            if(!entry){
                const row=create('section','canvas-agent__action'),title=create('h4'),text=create('p'),amount=create('p','canvas-muted'),buttons=create('div','canvas-agent__actions');
                const accept=create('button','canvas-button canvas-button--primary',copy.actionConfirm),decline=create('button','canvas-button',copy.actionDecline);accept.type=decline.type='button';buttons.append(accept,decline);row.append(title,text,amount,buttons);list.append(row);
                entry={row,title,text,amount,buttons,accept,decline,key:null,action:null};entries.set(action.id,entry);
                for(const [button,decision]of [[accept,'accept'],[decline,'decline']])button.addEventListener('click',()=>{if(!button.disabled&&entry.action?.confirmation)void confirm(entry.action,decision);});
            }
            entry.action=action;
            const key=JSON.stringify(action),confirmation=action.confirmation;
            if(key!==entry.key){entry.key=key;entry.row.dataset.actionId=action.id;entry.row.dataset.state=action.state;
                entry.title.textContent=copy.actionTitle;
                entry.text.textContent=confirmation?.kind==='clear'?copy.clearHint:typeof action.text==='string'?action.text:'';
                const credits=confirmation?.capCredits??confirmation?.credits;
                entry.amount.textContent=number(credits)?`${copy.actionCosts}: ${credits}`:'';entry.amount.hidden=!entry.amount.textContent;
                changed();
            }
            const quoted=['clear','voice'].includes(confirmation?.kind)||number(confirmation?.tariffRevision)&&(confirmation.kind==='regenerate'?number(confirmation.credits):number(confirmation.capCredits)&&confirmation.capCredits>0);
            const valid=confirmation&&quoted&&number(confirmation.expectedRevision)&&number(confirmation.expectedBriefRevision)&&['allowance','budget','regenerate','clear','voice'].includes(confirmation.kind);
            entry.accept.disabled=entry.decline.disabled=busy||!valid;

        }
        for(const [key,entry]of entries)if(!retained.has(key)){entry.row.remove();entries.delete(key);}
        initialized=true;list.hidden=entries.size===0;
    }
    return {render,reset(){for(const entry of entries.values())entry.row.remove();entries.clear();seen.clear();initialized=false;}};
}
