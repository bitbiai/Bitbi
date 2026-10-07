// Canvas coordinates only: neither browser zoom nor exported media dimensions.
export const WORKSPACE_DEFAULT = Object.freeze({width:2400,height:1600});
export const WORKSPACE_LIMIT = 50000;
export const NODE_HANDLE = 13;
export function workspaceBounds(nodes) {
    let left=0,top=0,right=0,bottom=0;
    for(const node of nodes) {
        const x=Number(node.x)||0,y=Number(node.y)||0;
        const width=Math.max(230,Number(node.width)||230),height=Math.max(126,Number(node.height)||126);
        left=Math.min(left,x-NODE_HANDLE);top=Math.min(top,y);
        right=Math.max(right,x+width+NODE_HANDLE);bottom=Math.max(bottom,y+height);
    }
    return {left,top,right,bottom,width:Math.max(64,Math.ceil(right-left)),height:Math.max(64,Math.ceil(bottom-top))};
}
export function workspaceSize(project,nodes=[]) {
    const bounds=workspaceBounds(nodes);
    return {...bounds,width:Math.max(bounds.width,project?.workspace_width??WORKSPACE_DEFAULT.width),height:Math.max(bounds.height,project?.workspace_height??WORKSPACE_DEFAULT.height)};
}
export function validWorkspaceSize(width,height,bounds) {
    return [width,height].every(n=>Number.isInteger(n)&&n<=WORKSPACE_LIMIT)&&width>=bounds.width&&height>=bounds.height;
}
