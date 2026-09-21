import { readMemberGenerationJobs } from './member-generation-jobs.js';

export function pendingCanvasVideo(jobId, status = 'queued') {
  return Object.assign(new Error('Video processing continues in the background. Reopen this project to restore the result.'), {
    status: 202, code: 'canvas_video_pending', videoJobId: jobId, videoJobStatus: status,
  });
}

export async function readCanvasVideoResult(ctx, jobId) {
  const response = await readMemberGenerationJobs(ctx, jobId);
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw Object.assign(new Error('The accepted video job is unavailable.'), { status: response.status, code: 'canvas_video_unavailable' });
  const { job, result } = payload.data;
  if (['queued', 'processing', 'ingesting'].includes(job.status)) throw pendingCanvasVideo(job.id, job.status);
  if (job.rejection_settled) throw Object.assign(new Error('Provider rejected the request; reserved credits were released.'), {status:422,code:'canvas_video_rejected',videoJobStatus:'failed'});
  if (!['succeeded', 'preview_pending'].includes(job.status) || !result?.ok || !result.data?.asset?.id) {
    throw Object.assign(new Error('Video processing needs attention; no automatic regeneration will occur.'), { status: 409, code: 'canvas_video_review_required', videoJobStatus: job.status });
  }
  return { response: { ok: true }, payload: result, usageAttemptId: null };
}

// Recover the acceptance-to-Canvas checkpoint gap from the immutable durable
// request key. It is server-derived from the private run ID, not a browser ID.
export async function restoreCanvasVideoJobs(env, userId, rows) {
  return Promise.all(rows.map(async row => {
    if (!['queued', 'running'].includes(row.status) && !['canvas_video_pending', 'canvas_video_review_required', 'canvas_video_rejected', 'canvas_run_failed'].includes(row.error_code) || row.operation_type !== 'canvas.video.generate') return row;
    const job = await env.DB.prepare("SELECT id, usage_attempt_id, status, error_code FROM member_generation_jobs WHERE user_id = ? AND media_type = 'video' AND request_key = ?")
      .bind(userId, `canvas-video-${row.id}`).first();
    if (!job) return row;
    const usage = job.status==='failed' && job.error_code==='generation_provider_rejected'
      ? await env.DB.prepare('SELECT provider_outcome,billing_status FROM member_ai_usage_attempts_v2 WHERE id=? AND user_id=?').bind(job.usage_attempt_id,userId).first() : null;
    const rejected = usage?.provider_outcome==='failed' && usage.billing_status==='released';
    const pending = ['queued', 'processing', 'ingesting', 'preview_pending', 'succeeded'].includes(job.status);
    return { ...row, status: 'failed', error_code: rejected ? 'canvas_video_rejected' : pending ? 'canvas_video_pending' : 'canvas_video_review_required', error_message: null,
      output_json: JSON.stringify({ videoJobId: job.id, videoJobStatus: job.status, usageAttemptId: job.usage_attempt_id }) };
  }));
}
