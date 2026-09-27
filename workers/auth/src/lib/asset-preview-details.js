// Private, bounded projection: never return raw provider/job/metadata objects.
export function detailObject(value) {
  if (typeof value === 'string' && value.length <= 65536) {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
const text = (value, max = 200) => typeof value === 'string' && value.length <= max ? value : null;
const number = value => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
const positive = value => number(value) > 0 ? number(value) : null;
export function projectFileDetails(row) {
  const meta = detailObject(row.metadata_json), audio = detailObject(meta.audio), model = detailObject(meta.model);
  return {
    model: text(model.displayName || model.name || model.id || meta.model), prompt: text(meta.prompt, 32768),
    mimeType: text(row.mime_type, 100), width: positive(meta.original_width), height: positive(meta.original_height),
    durationSeconds: positive(audio.actual_duration_ms) / 1000 || null,
    recordedDurationSeconds: positive(audio.duration_ms) / 1000 || null,
    requestedDurationSeconds: positive(audio.requested_duration_ms) / 1000 || positive(meta.duration),
    sampleRate: positive(audio.sample_rate), channels: positive(audio.channels), bitrate: positive(audio.bitrate),
    seed: number(meta.seed), steps: positive(meta.steps), fps: positive(meta.original_fps),
    bpm: positive(meta.bpm), key: text(meta.key, 80),
  };
}
