// Only unresolved export intent, scoped to this browser tab and project/subject.
// No prompts, credentials or media bytes. Accepted recipes remain server-owned.
const pending=new Map();
export function exportRequest(projectId,anchor) {
    const storageKey=`bitbi:canvas-export:${projectId}:${anchor.nodeId||anchor}`;
    return {
        read(){
            try{const raw=sessionStorage.getItem(storageKey);if(raw&&raw.length<40000){const value=JSON.parse(raw);if(/^[a-zA-Z0-9_-]{16,100}$/.test(value?.key)&&value.body&&typeof value.body==='object')return value;}}catch{}
            return pending.get(storageKey)||null;
        },
        save(value){pending.set(storageKey,structuredClone(value));try{sessionStorage.setItem(storageKey,JSON.stringify(value));}catch{}},
        clear(){pending.delete(storageKey);try{sessionStorage.removeItem(storageKey);}catch{}},
    };
}
