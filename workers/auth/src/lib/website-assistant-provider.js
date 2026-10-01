// Direct Workers AI binding: no API key in the browser, no default AI Gateway
// (which may log prompts), tools, URL retrieval, retries or model substitution.
export async function openAssistantModel(env, admission, messages) {
  if (typeof env?.AI?.run !== 'function') throw new Error('provider_unavailable');
  const stream = await env.AI.run(admission.model, {
    messages, stream: true, max_tokens: admission.limits.outputTokens, temperature: 0.2,
  });
  if (!stream || typeof stream.getReader !== 'function') throw new Error('provider_protocol');
  return stream;
}

// Parse the model's SSE incrementally with bounds even if an upstream sends an
// unterminated event or malformed JSON. Never forward upstream errors/raw data.
export async function* assistantModelEvents(stream, { signal, outputChars = 8000 } = {}) {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', count = 0, totalBytes = 0, done = false;
  let observedUsage = null, usageConflict = false, cancellationStarted = false;
  let rejectAbortedRead;
  const abortedRead = new Promise((resolve, reject) => { rejectAbortedRead = reject; });
  // The abort can arrive while the generator is paused at yield, before its
  // next read race. Attach a rejection handler immediately in that case.
  void abortedRead.catch(() => {});
  const cancelUpstream = () => {
    if (cancellationStarted) return;
    cancellationStarted = true;
    try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* unknown upstream outcome */ }
  };
  const abort = () => {
    rejectAbortedRead(new Error('cancelled'));
    cancelUpstream();
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (!done) {
      if (signal?.aborted) throw new Error('cancelled');
      const item = await Promise.race([reader.read(), abortedRead]);
      if (item.done) break;
      totalBytes += item.value.byteLength;
      if (totalBytes > 128 * 1024) throw new Error('provider_protocol');
      buffer += decoder.decode(item.value, { stream: true }).replace(/\r/g, '');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        if (boundary > 16384) throw new Error('provider_protocol');
        const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const raw = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!raw) continue;
        if (raw === '[DONE]') { done = true; break; }
        let data;
        try { data = JSON.parse(raw); } catch { throw new Error('provider_protocol'); }
        if (!data || data.error || data.errors) throw new Error('provider_error');
        // Both Workers AI and OpenAI-compatible delta envelopes are supported;
        // actual gated-model streaming/usage still requires real acceptance.
        const text = data.response ?? data.choices?.[0]?.delta?.content;
        if (text !== undefined) {
          if (typeof text !== 'string') throw new Error('provider_protocol');
          count += text.length;
          if (count > outputChars) throw new Error('provider_protocol');
          if (text) yield { text };
        }
        if (data.usage != null) {
          const { prompt_tokens: input, completion_tokens: output, total_tokens: total } = data.usage;
          if (!Number.isSafeInteger(input) || input <= 0 || !Number.isSafeInteger(output) || output <= 0 ||
              (total !== undefined && (!Number.isSafeInteger(total) || total !== input + output))) {
            usageConflict = true;
          } else if (observedUsage && (observedUsage.prompt_tokens !== input || observedUsage.completion_tokens !== output)) {
            usageConflict = true;
          } else {
            observedUsage = { prompt_tokens: input, completion_tokens: output };
          }
        }
      }
      if (buffer.length > 16384) throw new Error('provider_protocol');
    }
    if (signal?.aborted) throw new Error('cancelled');
    if (!done || !count) throw new Error('provider_incomplete');
    // Only release one consistent final usage value after terminal completion.
    // Defaults, conflicting duplicates or malformed counters cannot refund the
    // conservative reservation, even if the visible answer itself completed.
    if (observedUsage && !usageConflict) yield { usage: observedUsage };
  } finally {
    signal?.removeEventListener('abort', abort);
    // Cancellation is best effort. An upstream cancel promise may never settle;
    // it must not hold the route's timeout, completion or budget settlement open.
    cancelUpstream();
    try { reader.releaseLock(); } catch { /* pending read remains cancelled */ }
  }
}
