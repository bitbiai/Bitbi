import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

export const CANVAS_AGENT_RELEASE_FLAGS=Object.freeze({auth:['CANVAS_AGENT_ENABLED','ENABLE_GROK_4_7','CANVAS_VOICE_ENABLED'],ai:['ENABLE_GROK_4_7']});
// This release introduces exact defaults only. Existing switches, including an
// explicit disable, cannot be changed through this exception.
export function normalizeCanvasAgentConfigDelta(before,after,worker) {
  const previous=structuredClone(before),next=structuredClone(after);
  for(const key of CANVAS_AGENT_RELEASE_FLAGS[worker]||[]) {
    const old=previous.vars?.[key],value=next.vars?.[key];
    if(old===undefined&&value===undefined)continue;
    assert(['true','false'].includes(value),`Invalid Canvas agent setting ${key}`);
    if(old===undefined){assert.equal(value,'true',`Unreviewed Canvas agent introduction ${key}`);previous.vars??={};previous.vars[key]='true';}
    else assert.equal(value,old,`Unreviewed Canvas agent change ${key}`);
  }
  return {previous,next};
}
export function assertCanvasAgentAiConfig(before,after) {
  const {previous,next}=normalizeCanvasAgentConfigDelta(before,after,'ai');
  assert.deepEqual(next,previous,'Unreviewed AI configuration change');
}
export function reviewedCanvasAgentConfigFiles(repoRoot,source,files) {
  const file='workers/ai/wrangler.jsonc';
  if(!files.includes(file)||!['git-diff','git-status'].includes(source?.mode))return [];
  try {
    const read=ref=>JSON.parse(execFileSync('git',['show',`${ref}:${file}`],{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
    const before=read(source.mode==='git-diff'?source.base:'HEAD');
    const after=source.mode==='git-diff'?read(source.head||'HEAD'):JSON.parse(fs.readFileSync(path.join(repoRoot,file),'utf8'));
    assert.equal(before.vars?.ENABLE_GROK_4_7,undefined);assert.equal(after.vars?.ENABLE_GROK_4_7,'true');
    assertCanvasAgentAiConfig(before,after);return [file];
  }catch{return [];}
}
export function canvasAgentActivationFlags(config,version,worker) {
  const flags={};
  for(const key of CANVAS_AGENT_RELEASE_FLAGS[worker]||[]) {
    if(config.vars?.[key]===undefined)continue;
    const intended=config.vars[key];assert(['true','false'].includes(intended),`Invalid Canvas agent default ${key}`);
    const matches=(version.resources?.bindings||[]).filter(b=>b.name===key);
    assert(matches.length<=1,`Ambiguous Canvas agent setting ${key}`);
    const previous=matches[0]?.text;assert(!matches.length||matches[0].type==='plain_text'&&['true','false'].includes(previous),`Invalid active Canvas agent setting ${key}`);
    const value=previous==='false'?'false':intended;
    flags[key]={value,...(value!==intended?{preservedFrom:version.id}:{})};
    if(value!==intended)assert(version.id,'Missing previous version for preserved disable');
  }
  return flags;
}
export function canvasAgentFlagArguments(flags={}) {
  for(const [key,setting] of Object.entries(flags))assert(Object.values(CANVAS_AGENT_RELEASE_FLAGS).flat().includes(key)&&['true','false'].includes(setting.value),'Unreviewed deployment variable');
  return Object.entries(flags).flatMap(([key,{value}])=>['--var',`${key}:${value}`]);
}
export async function verifyCanvasAgentActivationFlags(flags,config,version,worker,readPrevious) {
  const keys=(CANVAS_AGENT_RELEASE_FLAGS[worker]||[]).filter(key=>config.vars?.[key]!==undefined).sort();
  assert.deepEqual(Object.keys(flags||{}).sort(),keys,'Missing or unrelated Canvas agent activation evidence');
  for(const key of keys) {
    const setting=flags[key];assert(setting&&['true','false'].includes(setting.value)&&Object.keys(setting).every(k=>['value','preservedFrom'].includes(k)),'Invalid Canvas agent activation evidence');
    const matches=(version.resources?.bindings||[]).filter(b=>b.name===key);
    assert.equal(matches.length,1,`Missing Canvas agent activation ${key}`);assert.equal(matches[0].type,'plain_text',`Invalid Canvas agent binding ${key}`);assert.equal(matches[0].text,setting.value,`Canvas agent activation drift ${key}`);
    if(setting.value!==config.vars[key]) {
      assert.equal(config.vars[key],'true');assert.equal(setting.value,'false');
      assert(typeof setting.preservedFrom==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(setting.preservedFrom)&&readPrevious,'Unproven preserved Canvas agent disable');
      const prior=await readPrevious(setting.preservedFrom);
      assert.equal(prior.id,setting.preservedFrom,'Wrong previous Canvas agent version');
      assert(prior.resources?.bindings?.some(b=>b.name===key&&b.type==='plain_text'&&b.text==='false'),'Previous version did not explicitly disable Canvas agent');
    } else assert.equal(setting.preservedFrom,undefined,'Unexpected override evidence');
  }
}
