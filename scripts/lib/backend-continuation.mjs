// Auth, private FFmpeg, the reviewed AI service and existing Contact mail delivery are automated. Other Workers,
// config changes, unknown prerequisites and unknown paths remain fail-closed.
export function backendContinuationSupported(plan) {
  if(!plan?.impacts || plan.consistencyIssues?.length || plan.impacts.uncategorizedFiles?.length) return false;
  const runtimeFiles = plan.changedFiles.filter(file => !plan.toolingOnlyWorkerPackageFiles?.includes(file));
  const reviewedWorkerTooling = file => {
    const worker=/^workers\/(auth|ai)\/package(?:-lock)?\.json$/.exec(file)?.[1];
    return worker&&plan.workerDeploys.some(step=>step.worker===worker)&&plan.reviewedToolingPatchFiles?.includes(file);
  };
  if(!plan.workerDeploys?.length || plan.workerDeploys.some(s=>!['auth','media','ai','contact'].includes(s.worker))) return false;
  if(plan.workerDeploys.some(s=>s.worker==='ai') && !runtimeFiles.every(f=>!f.startsWith('workers/ai/') || ['workers/ai/src/routes/text.js','workers/ai/src/lib/grok-chat.js','workers/ai/src/lib/invoke-ai.js','workers/ai/src/lib/invoke-ai-video.js','workers/ai/src/routes/video-task.js',
    'workers/ai/src/index.js','workers/ai/src/routes/canvas-agent-plan.js','workers/ai/src/lib/canvas-agent-plan.js','workers/ai/src/lib/canvas-agent-dialogue.js','workers/ai/src/lib/caller-policy.js','workers/ai/src/lib/validate.js','workers/ai/src/lib/responses.js','workers/ai/src/routes/image.js','workers/ai/src/routes/music.js'].includes(f) || reviewedWorkerTooling(f) || f==='workers/ai/wrangler.jsonc'&&plan.reviewedCanvasAgentConfigFiles?.includes(f)))return false;
  if(plan.workerDeploys.some(s=>s.worker==='contact') && runtimeFiles.some(f=>f.startsWith('workers/contact/')&&!['workers/contact/src/index.js','workers/contact/src/lib/contact-mail.js'].includes(f)))return false;
  if(plan.schemaApplies?.some(s=>s.checkpoint!=='auth')) return false;
  if(plan.deploySteps.some(s=>!['static','worker','schema-checkpoint','service'].includes(s.type) || s.type==='service'&&s.service!=='homepage-ffmpeg-processor'))return false;
  if(runtimeFiles.some(f=>/^workers\/.*\/(wrangler\.jsonc|package(?:-lock)?\.json)$/.test(f)&&f!=='workers/auth/wrangler.jsonc'&&!f.startsWith('workers/media/')&&!reviewedWorkerTooling(f)&&!(f==='workers/ai/wrangler.jsonc'&&plan.reviewedCanvasAgentConfigFiles?.includes(f))))return false;
  return (plan.manualPrerequisites?.required||[]).every(p=>(p.worker==='auth'&&['secret','cloudflare_feature','cloudflare_queue','cloudflare_r2_bucket'].includes(p.kind)) || (p.worker==='ai'&&p.kind==='secret') || (p.worker==='contact'&&p.kind==='secret'&&p.name==='RESEND_API_KEY'));
}
