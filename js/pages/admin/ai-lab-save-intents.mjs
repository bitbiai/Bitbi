export function buildSaveTitle(seed, fallback) {
    const cleaned = String(seed || '')
        .replace(/\s+/g, ' ')
        .replace(/[\x00-\x1f\x7f]/g, '')
        .trim()
        .slice(0, 120);
    return cleaned || fallback;
}

export function buildTextSaveIntent({
    response,
    prompt,
    system,
    receivedAt,
    warnings,
}) {
    const result = response?.result;
    if (!result?.text) return null;
    return {
        type: 'text',
        sourceModule: 'text',
        modalTitle: 'Save Text Result',
        description: 'Save the current text run as a UTF-8 .txt file in your existing Image Studio folder structure.',
        confirmLabel: 'Save Text',
        defaultTitle: buildSaveTitle(prompt, 'AI Lab Text'),
        note: 'The auth worker serializes the final .txt server-side and stores it beside your images.',
        payload: {
            preset: response?.preset || null,
            model: response?.model || null,
            system: system || '',
            prompt: prompt || '',
            output: result.text,
            maxTokens: result.maxTokens,
            temperature: result.temperature,
            usage: result.usage || null,
            warnings,
            elapsedMs: response?.elapsedMs || null,
            receivedAt,
        },
    };
}

export function buildImageSaveIntent({
    response,
    prompt,
    fallbackModel,
}) {
    const result = response?.result;
    if (!result?.imageBase64) return null;
    return {
        type: 'image',
        modalTitle: 'Save Image',
        description: 'Save the current image with the same folder logic and backend path used by the existing Image Studio.',
        confirmLabel: 'Save Image',
        defaultTitle: buildSaveTitle(prompt, 'AI Lab Image'),
        note: 'The existing image save endpoint generates the final filename automatically. Only the folder selection is required here.',
        payload: {
            imageData: `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`,
            prompt: response?.prompt || prompt || '',
            model: response?.model?.id || fallbackModel || '',
            steps: result.steps,
            seed: result.seed,
            guidance: result.guidance,
        },
    };
}

export function buildEmbeddingsSaveIntent({
    response,
    input,
    receivedAt,
    warnings,
}) {
    const result = response?.result;
    if (!Array.isArray(result?.vectors) || result.vectors.length === 0) return null;
    const inputItems = String(input || '')
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean);
    return {
        type: 'text',
        sourceModule: 'embeddings',
        modalTitle: 'Save Embeddings Result',
        description: 'Save the current embeddings run as a structured .txt file in your existing folder structure.',
        confirmLabel: 'Save Embeddings',
        defaultTitle: buildSaveTitle(inputItems[0] || 'AI Lab Embeddings', 'AI Lab Embeddings'),
        note: 'Vectors are serialized server-side into a plain-text file with bounded metadata and the recorded vector output.',
        payload: {
            preset: response?.preset || null,
            model: response?.model || null,
            inputItems,
            vectors: result.vectors,
            dimensions: result.dimensions,
            count: result.count,
            shape: Array.isArray(result.shape) ? result.shape : null,
            pooling: result.pooling || null,
            warnings,
            elapsedMs: response?.elapsedMs || null,
            receivedAt,
        },
    };
}

export function buildCompareSaveIntent({
    response,
    prompt,
    system,
    receivedAt,
    warnings,
    diffSummary,
}) {
    const results = Array.isArray(response?.result?.results) ? response.result.results : [];
    if (results.length === 0) return null;
    return {
        type: 'text',
        sourceModule: 'compare',
        modalTitle: 'Save Compare Result',
        description: 'Save the current compare run as a structured .txt file with both model outputs and the existing difference aid summary.',
        confirmLabel: 'Save Compare',
        defaultTitle: buildSaveTitle(prompt, 'AI Lab Compare'),
        note: 'The saved file includes the shared prompt, per-model outputs, warnings, and the compare difference summary.',
        payload: {
            prompt: prompt || '',
            system: system || '',
            maxTokens: response?.result?.maxTokens || null,
            temperature: response?.result?.temperature || null,
            elapsedMs: response?.elapsedMs || null,
            receivedAt,
            warnings,
            diffSummary,
            results,
        },
    };
}

export function buildMusicSaveIntent({
    response,
    prompt,
    warnings,
    receivedAt,
}) {
    const result = response?.result;
    if (!result?.audioBase64) return null;
    return {
        type: 'text',
        sourceModule: 'music',
        modalTitle: 'Save Music Result',
        description: 'Save the generated MP3 audio into your existing folder structure.',
        confirmLabel: 'Save Audio',
        defaultTitle: buildSaveTitle(prompt, 'AI Lab Music'),
        note: 'The audio file is stored as an MP3 alongside your existing saved assets.',
        payload: {
            audioBase64: result.audioBase64,
            mimeType: result.mimeType || 'audio/mpeg',
            prompt: result.prompt || prompt || '',
            model: response?.model || null,
            mode: result.mode,
            lyricsMode: result.lyricsMode,
            bpm: result.bpm,
            key: result.key,
            lyricsPreview: result.lyricsPreview,
            durationMs: result.durationMs,
            sampleRate: result.sampleRate,
            channels: result.channels,
            bitrate: result.bitrate,
            sizeBytes: result.sizeBytes,
            traceId: response?.traceId || null,
            warnings,
            elapsedMs: response?.elapsedMs || null,
            receivedAt,
        },
    };
}

function deriveTranscriptFromDom(transcriptRoot) {
    if (!transcriptRoot) return [];
    const bubbles = Array.from(transcriptRoot.querySelectorAll('.admin-ai__chat-msg'));
    return bubbles.map((bubble) => {
        const role = String(
            bubble.querySelector('.admin-ai__chat-role')?.textContent || ''
        ).trim().toLowerCase();
        const parts = Array.from(bubble.querySelectorAll('span'));
        const content = parts
            .slice(1)
            .map((node) => node.textContent || '')
            .join(' ')
            .trim();
        return role && content ? { role, content } : null;
    }).filter(Boolean);
}

function normalizeLiveAgentMessages(messages, transcriptRoot) {
    if (Array.isArray(messages) && messages.length > 0) {
        return messages
            .map((entry) => ({
                role: String(entry?.role || '').trim().toLowerCase(),
                content: String(entry?.content || '').trim(),
            }))
            .filter((entry) => entry.role && entry.content);
    }
    return deriveTranscriptFromDom(transcriptRoot);
}

export function buildLiveAgentSaveIntent({
    messages,
    transcriptRoot,
    system,
    model,
    receivedAt,
}) {
    const transcript = normalizeLiveAgentMessages(messages, transcriptRoot);
    if (transcript.length === 0) return null;

    const lastAssistant = [...transcript].reverse().find((entry) => entry.role === 'assistant');
    const lastUser = [...transcript].reverse().find((entry) => entry.role === 'user');
    return {
        type: 'text',
        sourceModule: 'live_agent',
        modalTitle: 'Save Live Agent Transcript',
        description: 'Save the current live-agent transcript as a structured .txt file in your existing folder structure.',
        confirmLabel: 'Save Transcript',
        defaultTitle: buildSaveTitle(lastUser?.content || 'AI Lab Live Agent', 'AI Lab Live Agent'),
        note: 'The transcript is serialized server-side as plain text with the system prompt, ordered messages, and final assistant response.',
        payload: {
            model,
            system: system || '',
            transcript,
            finalResponse: lastAssistant?.content || '',
            receivedAt,
        },
    };
}
