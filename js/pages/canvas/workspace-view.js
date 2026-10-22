import {workspaceBounds,workspaceSize,validWorkspaceSize,WORKSPACE_LIMIT,NODE_HANDLE} from '../../shared/canvas-workspace.mjs?v=__ASSET_VERSION__';

export function createWorkspaceView({viewport,surface,nodesRoot,edgesRoot,toolbar,getState,save,measureSave,german}) {
    let zoom=1,projectId=null,size=workspaceSize(),busy=false,feedback='';
    const preferences=new Map(),wrap=document.createElement('div'),spacer=document.createElement('div');
    wrap.className='canvas-view-controls';spacer.className='canvas-view-spacer';surface.before(spacer);spacer.append(surface);
    const button=(text,label,action)=>{const b=document.createElement('button');b.type='button';b.className='canvas-button canvas-button--compact';b.textContent=text;b.setAttribute('aria-label',label);b.addEventListener('click',action);wrap.append(b);return b;};
    const minus=button('−',german?'Verkleinern':'Zoom out',()=>scale(zoom/1.2));
    const percent=document.createElement('output');percent.setAttribute('aria-label','Zoom');wrap.append(percent);
    const plus=button('+',german?'Vergrößern':'Zoom in',()=>scale(zoom*1.2));
    button(german?'Inhalt einpassen':'Fit contents',german?'Gesamten Graph einpassen':'Fit the whole graph',fit);
    const dimensions=document.createElement('details'),summary=document.createElement('summary'),fields=document.createElement('div'),explanation=document.createElement('p');
    dimensions.className='canvas-workspace-size';fields.className='canvas-workspace-size__fields';summary.textContent=german?'Arbeitsfläche':'Workspace size';
    explanation.textContent=german?'Die Arbeitsfläche wächst mit deinen Nodes. Eine feste Größe ist optional.':'The workspace grows with your nodes. A fixed size is optional.';
    fields.append(explanation);dimensions.append(summary,fields);wrap.append(dimensions);
    dimensions.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dimensions.open=false;summary.focus();}});
    const inputs={};
    for(const [key,label] of [['width',german?'Breite':'Width'],['height',german?'Höhe':'Height']]) {
        const field=document.createElement('label'),input=document.createElement('input');field.textContent=label;input.type='number';input.step='1';input.max=String(WORKSPACE_LIMIT);input.className='canvas-input';input.setAttribute('aria-label',label);field.append(input);fields.append(field);inputs[key]=input;
        input.addEventListener('change',()=>void resize());input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void resize();}if(event.key==='Escape'){input.value=String(size[key]);input.blur();}});
    }
    const note=document.createElement('span');note.className='canvas-workspace-minimum';note.setAttribute('role','status');fields.append(note);toolbar.querySelector('.canvas-graph-actions').before(wrap);
    const measured=()=>getState().nodes.map(node=>{const card=[...nodesRoot.children].find(c=>c.dataset.nodeId===node.id);return {...node,width:card?.offsetWidth||node.width,height:card?.offsetHeight||node.height};});
    function paint() {
        const state=getState(),nodes=measured(),bounds=workspaceBounds(nodes);size=workspaceSize(state.project,nodes);
        surface.style.width=size.width+'px';surface.style.height=size.height+'px';surface.style.transform=`scale(${zoom})`;surface.style.transformOrigin='0 0';
        for(const layer of [nodesRoot,edgesRoot]){layer.style.transform=`translate(${-size.left}px,${-size.top}px)`;layer.style.inset='0 auto auto 0';}
        edgesRoot.setAttribute('width',String(size.width));edgesRoot.setAttribute('height',String(size.height));
        spacer.style.width=size.width*zoom+'px';spacer.style.height=size.height*zoom+'px';percent.value=`${zoom<.1?(zoom*100).toFixed(1):Math.round(zoom*100)}%`;
        minus.disabled=zoom<=.001;plus.disabled=zoom>=2;
        for(const key of ['width','height']){inputs[key].min=String(bounds[key]);inputs[key].disabled=busy||!state.project;if(document.activeElement!==inputs[key])inputs[key].value=String(size[key]);}
        if(!busy)note.textContent=feedback||`Minimum: ${bounds.width} × ${bounds.height}`;
    }
    function scale(next) {
        const x=(viewport.scrollLeft+viewport.clientWidth/2)/zoom,y=(viewport.scrollTop+viewport.clientHeight/2)/zoom;
        zoom=Math.min(2,Math.max(.001,next));paint();viewport.scrollTo(x*zoom-viewport.clientWidth/2,y*zoom-viewport.clientHeight/2);remember();
    }
    function remember(){if(projectId)preferences.set(projectId,{zoom,x:viewport.scrollLeft,y:viewport.scrollTop});}
    viewport.addEventListener('scroll',remember,{passive:true});
    function fit(){paint();const b=workspaceBounds(measured()),margin=40;zoom=Math.min(2,Math.max(.001,Math.min(viewport.clientWidth/(b.width+margin*2),viewport.clientHeight/(b.height+margin*2))));paint();viewport.scrollTo(Math.max(0,(b.left-size.left-margin)*zoom),Math.max(0,(b.top-size.top-margin)*zoom));remember();}
    function focusNode(id){const node=measured().find(item=>item.id===id);if(!node)return;paint();viewport.scrollTo(Math.max(0,(Number(node.x)-size.left+(node.width||230)/2)*zoom-viewport.clientWidth/2),Math.max(0,(Number(node.y)-size.top+(node.height||126)/2)*zoom-viewport.clientHeight/2));remember();}
    function centerPlacement(){
        const width=230,height=126,gap=24,visible={left:Math.max(size.left+NODE_HANDLE,size.left+viewport.scrollLeft/zoom+NODE_HANDLE),top:Math.max(size.top,size.top+viewport.scrollTop/zoom),right:Math.min(size.left+size.width-width-NODE_HANDLE,size.left+(viewport.scrollLeft+viewport.clientWidth)/zoom-width-NODE_HANDLE),bottom:Math.min(size.top+size.height-height,size.top+(viewport.scrollTop+viewport.clientHeight)/zoom-height)};
        const x=Math.max(visible.left,Math.min(visible.right,size.left+(viewport.scrollLeft+viewport.clientWidth/2)/zoom-width/2)),y=Math.max(visible.top,Math.min(visible.bottom,size.top+(viewport.scrollTop+viewport.clientHeight/2)/zoom-height/2));
        const nodes=measured(),xs=[x,x+width+gap,x-width-gap,visible.left,visible.right],ys=[y,y+height+gap,y-height-gap,visible.top,visible.bottom];
        for(const candidateY of ys)for(const candidateX of xs){
            if(candidateX<visible.left||candidateX>visible.right||candidateY<visible.top||candidateY>visible.bottom)continue;
            if(!nodes.some(node=>candidateX<Number(node.x)+(node.width||width)+gap&&candidateX+width+gap>Number(node.x)&&candidateY<Number(node.y)+(node.height||height)+gap&&candidateY+height+gap>Number(node.y)))return {x:candidateX,y:candidateY};
        }
        // A crowded/small view still receives the node in view; it never uses
        // the global node count to place new work beyond the current viewport.
        return {x,y};
    }
    async function resize(){
        if(busy||!getState().project)return;const width=Number(inputs.width.value),height=Number(inputs.height.value),nodes=measured(),bounds=workspaceBounds(nodes);
        if(!validWorkspaceSize(width,height,bounds)){inputs.width.value=String(size.width);inputs.height.value=String(size.height);note.textContent=feedback=(german?'Nicht gespeichert. Minimum: ':'Not saved. Minimum: ')+`${bounds.width} × ${bounds.height}; Maximum: ${WORKSPACE_LIMIT}.`;return;}
        if(width===size.width&&height===size.height)return; // Enter followed by blur must not resubmit the same size.
        const project=getState().project;feedback='';busy=true;paint();
        try{await measureSave(nodes);const result=await save(project,{workspace_width:width,workspace_height:height});if(!result.ok)throw Error(result.error||'Save failed');}
        catch(error){if(getState().project===project){inputs.width.value=String(size.width);inputs.height.value=String(size.height);note.textContent=feedback=german?'Größe nicht gespeichert. Bitte erneut versuchen.':'Size not saved. Please try again.';}return;}
        finally{busy=false;for(const input of Object.values(inputs))input.disabled=false;}
        if(getState().project===project){paint();inputs.width.value=String(size.width);inputs.height.value=String(size.height);}
    }
    const observer=new ResizeObserver(()=>paint());
    return {refresh(){observer.disconnect();observer.observe(viewport);for(const card of nodesRoot.children)observer.observe(card);const id=getState().project?.id;if(id!==projectId){projectId=id;feedback='';const pref=preferences.get(id);zoom=pref?.zoom||1;paint();viewport.scrollTo(pref?.x||0,pref?.y||0);}else paint();},get zoom(){return zoom;},focusNode,centerPlacement,placement(offsetX=70,offsetY=70){return {x:size.left+(viewport.scrollLeft+offsetX)/zoom,y:size.top+(viewport.scrollTop+offsetY)/zoom};},limits(card){return {minX:size.left+NODE_HANDLE,minY:size.top,maxX:size.left+size.width-(card?.offsetWidth||230)-NODE_HANDLE,maxY:size.top+size.height-(card?.offsetHeight||126)};}};
}
