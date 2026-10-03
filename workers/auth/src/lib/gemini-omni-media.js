import { parseOmniResult } from '../../../../js/shared/gemini-omni-contract.mjs';

export function decodeOmniInlineVideo(value) {
    const { video } = parseOmniResult({ video: value });
    const separator = video.indexOf(','), encoded = video.slice(separator + 1);
    const mime = video.slice(5, video.indexOf(';'));
    const binary = atob(encoded), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    assertOmniMediaSignature(bytes, mime);
    return { body: bytes.buffer, contentType: mime, sizeBytes: bytes.byteLength };
}

// Type admission complements the existing owned upload path. It is not a
// decoder or a claim about native Gemini duration/resolution limits.
export function assertOmniMediaSignature(bytes, mime) {
    const starts = (...values) => values.every((value, index) => bytes[index] === value);
    const text = (start, end) => new TextDecoder().decode(bytes.subarray(start, end));
    const valid = mime === 'image/png' ? starts(137, 80, 78, 71, 13, 10, 26, 10)
        : mime === 'image/jpeg' ? starts(255, 216, 255)
        : mime === 'image/webp' ? text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP'
        : ['video/mp4', 'video/quicktime'].includes(mime) ? bytes.length >= 16 && text(4, 8) === 'ftyp'
        : mime === 'video/webm' ? starts(26, 69, 223, 163)
        : ['audio/wav', 'audio/x-wav'].includes(mime) ? text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE'
        : mime === 'audio/mpeg' ? text(0, 3) === 'ID3' || bytes[0] === 255 && (bytes[1] & 224) === 224 : false;
    if (!valid) throw Object.assign(new Error('The media bytes do not match the supported file type.'), { status: 400, code: 'omni_media_invalid' });
}
