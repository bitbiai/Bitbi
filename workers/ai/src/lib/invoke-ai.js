function ensureAI(env) {
  if (!env?.AI || typeof env.AI.run !== "function") {
    const error = new Error("Workers AI binding is not configured.");
    error.status = 503;
    throw error;
  }
}

function buildMessages(system, prompt) {
  const messages = [];
  if (system) {
    messages.push({ role: "system", content: system });
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}

function collectTextContent(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const text = value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          if (typeof entry.text === "string") return entry.text;
          if (typeof entry.content === "string") return entry.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();

    return text || null;
  }

  return null;
}

function extractTextResponse(result) {
  const directCandidates = [
    result?.response,
    result?.text,
    result?.output_text,
    result?.result?.response,
    result?.result?.text,
    result?.message?.content,
    result?.choices?.[0]?.message?.content,
    result?.choices?.[0]?.text,
  ];

  for (const candidate of directCandidates) {
    const text = collectTextContent(candidate);
    if (text) return text;
  }

  if (Array.isArray(result?.output)) {
    const chunks = [];
    for (const item of result.output) {
      const text = collectTextContent(item?.content);
      if (text) chunks.push(text);
    }
    if (chunks.length > 0) return chunks.join("\n").trim();
  }

  return null;
}

function parseBase64Image(value) {
  if (typeof value !== "string" || value.length === 0) return null;

  const dataUriMatch = value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (dataUriMatch) {
    return {
      base64: dataUriMatch[2],
      mimeType: dataUriMatch[1],
    };
  }

  if (/^[A-Za-z0-9+/\n\r]+=*$/.test(value.slice(0, Math.min(value.length, 200)))) {
    return {
      base64: value,
      mimeType: null,
    };
  }

  return null;
}

async function toArrayBuffer(value) {
  if (value == null) return null;
  if (value instanceof ArrayBuffer) return value;
  if (typeof value.arrayBuffer === "function") {
    try {
      return await value.arrayBuffer();
    } catch {
      return null;
    }
  }
  if (value.buffer instanceof ArrayBuffer && typeof value.byteLength === "number") {
    return value.buffer.byteLength === value.byteLength
      ? value.buffer
      : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return null;
}

async function extractImageResponse(result, model) {
  const candidates = [];
  if (result && typeof result === "object" && !ArrayBuffer.isView(result) && !(result instanceof ArrayBuffer)) {
    if (result.image != null) candidates.push(result.image);
    if (Array.isArray(result.images) && result.images.length > 0) candidates.push(result.images[0]);
    if (result.data != null) candidates.push(result.data);
  }
  candidates.push(result);

  for (const candidate of candidates) {
    const parsed = parseBase64Image(candidate);
    if (parsed) {
      return {
        imageBase64: parsed.base64,
        mimeType: parsed.mimeType || model.defaultMimeType || "image/jpeg",
      };
    }

    const buffer = await toArrayBuffer(candidate);
    if (buffer && buffer.byteLength > 0) {
      const bytes = new Uint8Array(buffer);
      const base64 = btoa(bytes.reduce((acc, byte) => acc + String.fromCharCode(byte), ""));
      return {
        imageBase64: base64,
        mimeType: model.defaultMimeType || "image/jpeg",
      };
    }
  }

  return null;
}

function normalizeVectorArray(candidate) {
  if (!Array.isArray(candidate) || candidate.length === 0) return null;

  if (candidate.every((item) => Array.isArray(item))) {
    return candidate;
  }

  if (candidate.every((item) => typeof item === "number")) {
    return [candidate];
  }

  if (candidate.every((item) => Array.isArray(item?.embedding))) {
    return candidate.map((item) => item.embedding);
  }

  return null;
}

function extractEmbeddingsResponse(result) {
  const candidates = [
    result?.data,
    result?.response,
    result?.result?.data,
    result?.result?.response,
  ];

  for (const candidate of candidates) {
    const vectors = normalizeVectorArray(candidate);
    if (vectors) {
      return {
        vectors,
        shape: Array.isArray(result?.shape) ? result.shape : [vectors.length, vectors[0]?.length || 0],
        pooling: result?.pooling || result?.result?.pooling || null,
      };
    }
  }

  return null;
}

function dataUriToBlob(dataUri) {
  const commaIndex = dataUri.indexOf(",");
  if (commaIndex === -1) return null;
  const meta = dataUri.slice(0, commaIndex);
  const base64 = dataUri.slice(commaIndex + 1);
  const mimeMatch = meta.match(/^data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function buildMultipartImageRequest(model, input) {
  const form = new FormData();

  if (input.structuredPrompt) {
    form.append("prompt", input.structuredPrompt);
  } else {
    form.append("prompt", input.prompt);
  }

  const width = input.width || model.defaultSize?.width || null;
  const height = input.height || model.defaultSize?.height || null;

  if (width && height) {
    form.append("width", String(width));
    form.append("height", String(height));
  }

  if (model.supportsSteps && input.steps !== null && input.steps !== undefined) {
    form.append("steps", String(input.steps));
  }

  if (model.supportsSeed && input.seed !== null && input.seed !== undefined) {
    form.append("seed", String(input.seed));
  }

  if (model.supportsGuidance && input.guidance !== null && input.guidance !== undefined) {
    form.append("guidance", String(input.guidance));
  }

  if (model.supportsReferenceImages && Array.isArray(input.referenceImages)) {
    for (const refImg of input.referenceImages) {
      const blob = dataUriToBlob(refImg);
      if (blob) {
        form.append("image", blob);
      }
    }
  }

  const response = new Response(form);
  const contentType = response.headers.get("content-type");
  const body = response.body;

  if (!contentType || !body) {
    throw new Error("Failed to encode multipart image request.");
  }

  return {
    payload: {
      multipart: {
        body,
        contentType,
      },
    },
    appliedSteps: model.supportsSteps ? input.steps : null,
    appliedSeed: model.supportsSeed ? input.seed : null,
    appliedGuidance: model.supportsGuidance ? input.guidance : null,
    appliedSize: width && height ? { width, height } : null,
  };
}

export async function invokeText(env, model, input) {
  ensureAI(env);
  const startedAt = Date.now();

  const payload = {
    messages: buildMessages(input.system, input.prompt),
    max_tokens: Math.min(input.maxTokens, model.maxTokens || input.maxTokens),
    temperature: input.temperature,
  };

  const raw = await env.AI.run(model.id, payload);
  const text = extractTextResponse(raw);

  if (!text) {
    throw new Error("Model returned no text output.");
  }

  return {
    text,
    usage: raw?.usage || raw?.result?.usage || null,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function invokeImage(env, model, input) {
  ensureAI(env);
  const startedAt = Date.now();
  const warnings = [];
  let payload;
  let appliedSteps = null;
  let appliedSeed = null;
  let appliedGuidance = null;
  let appliedSize = null;

  if (model.inputFormat === "multipart") {
    const multipartRequest = buildMultipartImageRequest(model, input);
    payload = multipartRequest.payload;
    appliedSteps = multipartRequest.appliedSteps;
    appliedSeed = multipartRequest.appliedSeed;
    appliedGuidance = multipartRequest.appliedGuidance;
    appliedSize = multipartRequest.appliedSize;
  } else {
    payload = {
      prompt: input.prompt,
      steps: Math.min(input.steps ?? model.defaultSteps ?? 4, model.maxSteps || input.steps || 8),
    };

    if (input.seed !== null && input.seed !== undefined) {
      payload.seed = input.seed;
    }

    appliedSteps = payload.steps;
    appliedSeed = input.seed;

    if (input.width && input.height) {
      if (model.supportsDimensions) {
        payload.width = input.width;
        payload.height = input.height;
        appliedSize = { width: input.width, height: input.height };
      } else {
        warnings.push(`Model "${model.id}" ignores width and height overrides.`);
      }
    }
  }

  if (!model.supportsGuidance && input.guidance !== null && input.guidance !== undefined) {
    warnings.push(`Model "${model.id}" does not support guidance.`);
  }
  if (!model.supportsStructuredPrompt && input.structuredPrompt) {
    warnings.push(`Model "${model.id}" does not support structured prompts. Using standard prompt.`);
  }
  if (!model.supportsReferenceImages && input.referenceImages?.length > 0) {
    warnings.push(`Model "${model.id}" does not support reference images. They were ignored.`);
  }

  const raw = await env.AI.run(model.id, payload);
  const image = await extractImageResponse(raw, model);

  if (!image) {
    throw new Error("Model returned no image output.");
  }

  return {
    ...image,
    appliedSteps,
    appliedSeed,
    appliedGuidance,
    appliedSize,
    warnings,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function invokeEmbeddings(env, model, input) {
  ensureAI(env);
  const startedAt = Date.now();
  const raw = await env.AI.run(model.id, {
    text: input.input.length === 1 ? input.input[0] : input.input,
  });

  const embeddings = extractEmbeddingsResponse(raw);
  if (!embeddings) {
    throw new Error("Model returned no embeddings output.");
  }

  return {
    ...embeddings,
    elapsedMs: Date.now() - startedAt,
  };
}
