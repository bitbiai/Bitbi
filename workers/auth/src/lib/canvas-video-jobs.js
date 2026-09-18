import { readMemberGenerationJobs } from './member-generation-jobs.js';

export function pendingCanvasVideo(jobId) {
  return Object.assign(new Error('Video processing continues in the background. Reopen this project to restore the result.'), {
    status: 202, code: 'canvas_video_pending', videoJobId: jobId,
  });
}

export async function readCanvasVideoResult(ctx, jobId) {
  const response = await readMemberGenerationJobs(ctx, jobId);
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw Object.assign(new Error('The accepted video job is unavailable.'), { status: response.status, code: 'canvas_video_unavailable' });
  const { job, result } = payload.data;
  if (['queued', 'processing', 'ingesting'].includes(job.status)) throw pendingCanvasVideo(job.id);
  if (!['succeeded', 'preview_pending'].includes(job.status) || !result?.ok || !result.data?.asset?.id) {
    throw Object.assign(new Error('Video processing needs attention; no automatic regeneration will occur.'), { status: 409, code: 'canvas_video_review_required' });
  }
  return { response: { ok: true }, payload: result, usageAttemptId: null };
}

// Recover the acceptance-to-Canvas checkpoint gap from the immutable durable
// request key. It is server-derived from the private run ID, not a browser ID.
export async function restoreCanvasVideoJobs(env, userId, rows) {
  return Promise.all(rows.map(async row => {
    let input; try { input = JSON.parse(row.input_json || '{}'); } catch { return row; }
    if (!['queued', 'running'].includes(row.status) && !['canvas_video_pending', 'canvas_run_failed'].includes(row.error_code) || !input.connected_video_inputs?.length) return row;
    const job = await env.DB.prepare("SELECT id, usage_attempt_id FROM member_generation_jobs WHERE user_id = ? AND media_type = 'video' AND request_key = ?")
      .bind(userId, `canvas-video-${row.id}`).first();
    if (!job) return row;
    return { ...row, status: 'failed', error_code: 'canvas_video_pending', error_message: null,
      output_json: JSON.stringify({ videoJobId: job.id, usageAttemptId: job.usage_attempt_id }) };
  }));
}
