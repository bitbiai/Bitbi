// Auth, private FFmpeg and the reviewed existing AI generation service are automated. Other Workers,
// config changes, unknown prerequisites and unknown paths remain fail-closed.
export function backendContinuationSupported(plan) {
  if(!plan?.impacts || plan.consistencyIssues?.length || plan.impacts.uncategorizedFiles?.length) return false;
  if(!plan.workerDeploys?.length || plan.workerDeploys.some(s=>!['auth','media','ai'].includes(s.worker))) return false;
  if(plan.workerDeploys.some(s=>s.worker==='ai') && !plan.changedFiles.every(f=>!f.startsWith('workers/ai/') || ['workers/ai/src/routes/text.js','workers/ai/src/lib/grok-chat.js','workers/ai/src/lib/invoke-ai.js','workers/ai/src/lib/invoke-ai-video.js'].includes(f)))return false;
  if(plan.schemaApplies?.some(s=>s.checkpoint!=='auth')) return false;
  if(plan.deploySteps.some(s=>!['static','worker','schema-checkpoint','service'].includes(s.type) || s.type==='service'&&s.service!=='homepage-ffmpeg-processor'))return false;
  if(plan.changedFiles.some(f=>/^workers\/.*\/(wrangler\.jsonc|package(?:-lock)?\.json)$/.test(f)&&f!=='workers/auth/wrangler.jsonc'&&!f.startsWith('workers/media/')))return false;
  return (plan.manualPrerequisites?.required||[]).every(p=>(p.worker==='auth'&&['secret','cloudflare_feature','cloudflare_queue','cloudflare_r2_bucket'].includes(p.kind)) || (p.worker==='ai'&&p.kind==='secret'));
}
