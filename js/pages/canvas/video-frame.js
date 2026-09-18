// Decode the owned original to its natural end, without seeking to a guessed
// offset. At ended, drawImage reads the current (last decoded) video frame.
// rVFC confirms actual decoding; time/readyState alone never count as output.
export async function extractCanvasLastFrame(fileUrl, { signal, timeoutMs = 90000 } = {}) {
    const url = new URL(fileUrl, location.href);
    if (url.origin !== location.origin || !/^\/api\/ai\/text-assets\/[A-Za-z0-9_-]+\/file$/.test(url.pathname)) throw new Error('video_source_unavailable');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    // Mounted, offscreen and non-interactive, not display:none (WebKit decoder).
    video.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;pointer-events:none';
    video.setAttribute('aria-hidden', 'true'); video.tabIndex = -1;
    let objectUrl, callback;
    try {
        const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (!response.ok || !/^video\//.test(response.headers.get('Content-Type') || '')) throw new Error('video_source_unavailable');
        if (Number(response.headers.get('Content-Length')) > 50_000_000) throw new Error('video_source_too_large');
        const chunks = []; let size = 0;
        const reader = response.body.getReader();
        while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > 50_000_000) { await reader.cancel(); throw new Error('video_source_too_large'); }
            chunks.push(value);
        }
        objectUrl = URL.createObjectURL(new Blob(chunks, { type: response.headers.get('Content-Type') }));
        document.body.append(video);
        if (typeof video.requestVideoFrameCallback !== 'function') throw new Error('video_frame_decoder_unavailable');
        return await new Promise((resolve, reject) => {
            let frames = 0, lastMediaTime = -1;
            const fail = () => reject(new Error(controller.signal.aborted ? 'video_frame_cancelled_or_timeout' : 'video_frame_decode_failed'));
            controller.signal.addEventListener('abort', fail, { once: true });
            video.addEventListener('error', fail, { once: true });
            video.addEventListener('loadedmetadata', () => {
                if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 60 || video.videoWidth * video.videoHeight > 16_000_000) fail();
            }, { once: true });
            const frame = (_, metadata) => {
                if (Number.isFinite(metadata.mediaTime) && metadata.mediaTime >= lastMediaTime) { frames++; lastMediaTime = metadata.mediaTime; }
                callback = video.requestVideoFrameCallback(frame);
            };
            callback = video.requestVideoFrameCallback(frame);
            video.addEventListener('ended', () => {
                if (!frames || video.error || !video.videoWidth || video.readyState < 2) return fail();
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
                    canvas.getContext('2d').drawImage(video, 0, 0);
                    resolve({ imageData: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, duration: video.duration });
                } catch { fail(); }
            }, { once: true });
            if (controller.signal.aborted) return fail();
            video.src = objectUrl;
            video.play().catch(fail);
        });
    } catch (error) {
        if (controller.signal.aborted) throw new Error('video_frame_cancelled_or_timeout');
        throw error;
    } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (callback !== undefined) video.cancelVideoFrameCallback?.(callback);
        video.pause(); video.removeAttribute('src'); video.load(); video.remove();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
}
