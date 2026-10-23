import { apiAdminConsumerDeclarations,apiAdminConsumerDeclarationReview,apiAdminConsumerCancellation } from '../../../shared/auth-api.js?v=__ASSET_VERSION__';
import { byId,el,detailRows,downloadTextFile } from './core.js?v=__ASSET_VERSION__';

export function createConsumerDeclarationReview({formatDate}) {
    let generation=0,cursor=null,bound=false;
    const state=text=>{const area=byId('consumerDeclarationsState');if(area)area.textContent=text;};
    function field(label,type='text',value='') {
        const wrapper=el('label',type==='checkbox'?'admin-ai__field admin-ai__field--inline':'admin-ai__field',label),input=el(type==='textarea'?'textarea':'input',type==='checkbox'?null:'admin-ai__input');
        if(type!=='textarea')input.type=type;
        input.value=value;wrapper.append(input);return {wrapper,input};
    }
    function itemView(item) {
        const itemNode=el('article','admin-control-subsection'),heading=el('h4','admin-section-title',`${item.kind==='withdrawal'?'Withdrawal':'Cancellation'} · ${item.id}`);
        const overdue=item.state!=='closed'&&Date.parse(item.review_due_at)<Date.now();
        itemNode.append(heading,detailRows([
            ['Received',formatDate(item.received_at)],['Review target (internal, not statutory)',`${formatDate(item.review_due_at)}${overdue?' — OVERDUE':''}`],
            ['Consumer',item.name],['Electronic contact',item.email],['Contract reference',item.contract_reference],['Review',item.state],
            ['Acknowledgement',item.acknowledgement_state||'unconfirmed'],['Mail issue',item.acknowledgement_error||'none'],['Subscription outcome',item.provider_state],
        ]));
        const evidence=el('details'),summary=el('summary',null,'Original declaration / durable receipt');
        const text=el('pre','admin-json-summary',item.receipt_text),save=el('button','btn-action btn-action--secondary','Download receipt');save.type='button';
        save.addEventListener('click',()=>downloadTextFile(`bitbi-${item.id}.txt`,item.receipt_text,'text/plain;charset=utf-8'));evidence.append(summary,text,save);itemNode.append(evidence);
        if(item.state==='closed')return itemNode;
        const note=field('Review / identity-verification note','textarea');note.input.maxLength=1500;note.input.required=true;
        const result=el('p','admin-state');result.setAttribute('role','status');itemNode.append(note.wrapper,result);
        const buttons=el('div','admin-control-actions');
        const operations=new Map();
        const perform=async(button,kind,body)=>{
            if(!note.input.reportValidity())return;
            const payload={expectedRevision:item.revision,note:note.input.value.trim(),...body};
            const signature=JSON.stringify({kind,payload});if(!operations.has(signature))operations.set(signature,crypto.randomUUID());
            payload.requestId=operations.get(signature);button.disabled=true;
            const response=kind==='subscription'?await apiAdminConsumerCancellation(item.id,payload):await apiAdminConsumerDeclarationReview(item.id,payload);
            button.disabled=false;
            if(!response.ok){result.textContent=`Not confirmed: ${response.code||response.error}. The original receipt remains saved.`;return;}
            result.textContent=kind==='subscription'?`Provider outcome: ${response.data.state}. Only a confirmed outcome establishes an effective end.`:'Review saved. No refund or credit change was performed.';
            await load();
        };
        for(const [label,value] of [['Mark in review','in_review'],['Close review','closed']]) {
            const button=el('button','btn-action btn-action--secondary',label);button.type='button';
            button.disabled=value==='closed'&&['dispatching','unknown'].includes(item.provider_state);
            button.addEventListener('click',()=>perform(button,'review',{state:value}));buttons.append(button);
        }
        itemNode.append(buttons);
        if(item.kind==='cancellation') {
            const controls=el('details'),summary=el('summary',null,'Verified subscription cancellation / original-outcome reconciliation');
            controls.append(summary,el('p','admin-shell__desc','Verify the consumer and exact subscription first. Anonymous contact data alone is not ownership proof. Ordinary cancellation only; special dates and extraordinary grounds require individual review. This never refunds, revokes credits or deletes media.'));
            let pinned={};try{pinned=JSON.parse(item.provider_result_json||'{}');}catch{result.textContent='Stored provider reference needs support review.';}
            const owner=field('Verified account user ID','text',pinned.userId||item.user_id||'');
            const subscription=field('Exact Stripe subscription ID','text',pinned.subscriptionId||'');
            owner.input.required=true;subscription.input.required=true;
            if(pinned.subscriptionId){owner.input.readOnly=true;subscription.input.readOnly=true;}
            const confirm=field('I verified identity, contract association and the requested ending','checkbox');confirm.input.checked=false;
            const apply=el('button','btn-action',item.provider_state==='not_requested'?'Apply verified cancellation':'Reconcile original outcome');apply.type='button';
            apply.disabled=item.provider_state==='applied';
            apply.addEventListener('click',()=>{
                if(!owner.input.reportValidity()||!subscription.input.reportValidity())return;
                if(!confirm.input.checked){result.textContent='Identity and contract verification are required.';confirm.input.focus();return;}
                perform(apply,'subscription',{userId:owner.input.value.trim(),providerSubscriptionId:subscription.input.value.trim(),identityVerified:true});
            });
            controls.append(owner.wrapper,subscription.wrapper,confirm.wrapper,apply);itemNode.append(controls);
        }
        return itemNode;
    }
    async function load({more=false}={}) {
        const list=byId('consumerDeclarationsList');if(!list)return;
        const current=++generation;state('Loading consumer declarations…');
        const response=await apiAdminConsumerDeclarations({state:byId('consumerDeclarationsFilter')?.value||'open',cursor:more?cursor:null});
        if(current!==generation)return;
        if(!response.ok){state(`Consumer declarations unavailable: ${response.code||response.error}. Receipt intake and queued work are independent of this view.`);return;}
        if(!more)list.replaceChildren();
        for(const item of response.data.items||[])list.append(itemView(item));
        cursor=response.data.nextCursor||null;byId('consumerDeclarationsMore').hidden=!cursor;
        const failures=byId('consumerMailFailures');failures.replaceChildren();
        for(const mail of response.data.mailFailures||[])failures.append(el('p',null,`${mail.kind} · ${mail.source_id} · ${mail.state} · ${mail.error_code||'delivery unconfirmed'}`));
        const overdue=(response.data.items||[]).filter(item=>item.state!=='closed'&&Date.parse(item.review_due_at)<Date.now()).length;
        state(`${list.children.length} declarations shown. ${overdue} overdue in this page. ${response.data.mailFailures?.length||0} mail failures require review. Reading this list does not perform an action.`);
    }
    return {load,hide:()=>{generation++;},bind:()=>{
        if(bound)return;bound=true;
        byId('consumerDeclarationsRefresh')?.addEventListener('click',()=>load());
        byId('consumerDeclarationsFilter')?.addEventListener('change',()=>load());
        byId('consumerDeclarationsMore')?.addEventListener('click',()=>load({more:true}));
    }};
}
