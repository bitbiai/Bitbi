// Production orchestration shared with the synthetic process/runtime tests.
// Dependencies are the actual processor's IO functions, not alternate logic.
export async function runMemvidPreviewFlow(job, { convert, begin, upload, receipt, downloads, complete }) {
  if (job.receipt_protocol !== 2 || !job.claim_token || !job.completion?.receipt_url)
    throw Object.assign(new Error('Receipt protocol 2 is required before processing.'), { code: 'stream_receipt_protocol_required' });
  let result = { metadata: {} };
  let stream = job.stream_uid ? { uid: job.stream_uid, metadata: {} } : null;
  if (!stream) {
    result = await convert();
    // This permit is not replayable. A response lost here leaves an explicitly
    // unknown intent; it must not cause an automatic second provider Create.
    const permitted = await begin(job);
    if (!permitted?.upload_token) throw Object.assign(new Error('Upload permit unconfirmed.'), { code: 'stream_upload_permit_unknown' });
    stream = await upload(result.output, { ...job, upload_token: permitted.upload_token });
    const body = { stream_uid: stream.uid, upload_token: permitted.upload_token, source_fingerprint: job.source?.fingerprint };
    // Repeating the exact receipt is safe; repeating upload is not. Persist the
    // UID before any download/poll/completion. Both failed receipt responses
    // leave the durable pre-upload intent held for provider reconciliation.
    try { await receipt(job, body); }
    catch { await receipt(job, body); }
  }
  stream.download = await downloads(stream.uid);
  await complete(job, result, stream);
  return { uid: stream.uid };
}
