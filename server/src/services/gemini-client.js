import { AppError } from '../utils/errors.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
const GENERATE_CONTENT_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new AppError('Gemini is not configured because GEMINI_API_KEY is missing.', 503, 'GEMINI_NOT_CONFIGURED');
  return { apiKey, model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL };
}

function toGeminiSchema(node) {
  const schema = {};
  const type = String(node?.type ?? '').toUpperCase();
  if (type) schema.type = type;
  if (node?.description) schema.description = node.description;
  if (Array.isArray(node?.enum)) schema.enum = node.enum;
  if (Number.isInteger(node?.minItems)) schema.minItems = node.minItems;
  if (Number.isInteger(node?.maxItems)) schema.maxItems = node.maxItems;
  if (node?.items) schema.items = toGeminiSchema(node.items);
  if (node?.properties) {
    schema.properties = Object.fromEntries(Object.entries(node.properties).map(([key, value]) => [key, toGeminiSchema(value)]));
    schema.required = node.required ?? Object.keys(node.properties);
  }
  return schema;
}

function textParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (part?.type === 'text' && typeof part.text === 'string') return [{ text: part.text }];
    const fileData = part?.file?.file_data;
    if (part?.type === 'file' && typeof fileData === 'string') {
      const match = fileData.match(/^data:([^;,]+);base64,(.+)$/);
      if (match) return [{ inlineData: { mimeType: match[1], data: match[2] } }];
    }
    return [];
  });
}

function toGeminiContents(messages = []) {
  const systemInstruction = messages.filter((message) => message.role === 'system')
    .flatMap((message) => textParts(message.content))
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n\n');
  const contents = messages.filter((message) => message.role !== 'system').map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: textParts(message.content),
  })).filter((message) => message.parts.length);
  return { contents, systemInstruction };
}

function latencyConfig(model) {
  return /^gemini-3(?:\.|-)/i.test(model) ? { thinkingConfig: { thinkingLevel: 'low' } } : {};
}

function schemaInstruction(schema) {
  return `Return one valid JSON object. Follow this JSON Schema exactly and return no markdown: ${JSON.stringify(toGeminiSchema(schema))}`;
}

function withGeminiSchemaPrompt(messages, schema) {
  const instruction = schemaInstruction(schema);
  if (!messages.length) return [{ role: 'user', content: instruction }];
  const next = [...messages];
  const systemIndex = next.findIndex((message) => message.role === 'system' && typeof message.content === 'string');
  if (systemIndex >= 0) {
    next[systemIndex] = { ...next[systemIndex], content: `${next[systemIndex].content}\n\n${instruction}` };
    return next;
  }
  const last = next[next.length - 1];
  if (last && typeof last.content === 'string') {
    next[next.length - 1] = { ...last, content: `${last.content}\n\n${instruction}` };
  } else {
    next.push({ role: 'user', content: instruction });
  }
  return next;
}

export function buildGeminiPayload({ model, messages, schema, maxTokens, includeSchema = true }) {
  const { contents, systemInstruction } = toGeminiContents(messages);
  return {
    contents,
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    generationConfig: {
      responseMimeType: 'application/json',
      ...(includeSchema ? { responseSchema: toGeminiSchema(schema) } : {}),
      maxOutputTokens: maxTokens,
      ...latencyConfig(model),
    },
  };
}

export async function requestGemini({ messages, schema, maxTokens, timeoutMs, allowPlainJsonFallback = true }, dependencies = {}) {
  const { apiKey, model } = getGeminiConfig();
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const endpoint = `${GENERATE_CONTENT_URL}/${encodeURIComponent(model)}:generateContent`;

  const send = async (requestMessages, includeSchema = true) => {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(buildGeminiPayload({ model, messages: requestMessages, schema, maxTokens, includeSchema })),
      signal: AbortSignal.timeout(timeoutMs),
    });

    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const detail = payload?.error?.message ?? `Gemini returned HTTP ${response.status}.`;
      const error = new Error(String(detail));
      error.status = response.status;
      error.code = typeof payload?.error?.status === 'string' ? payload.error.status : undefined;
      error.name = 'GeminiApiError';
      throw error;
    }

    const candidate = payload?.candidates?.[0];
    const text = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts.map((part) => typeof part?.text === 'string' ? part.text : '').join('')
      : '';
    return { text, model, finishReason: candidate?.finishReason ?? null };
  };

  try {
    return await send(messages, true);
  } catch (error) {
    const detail = String(error?.message ?? '').toLowerCase();
    const schemaRejected = [400, 404, 422].includes(Number(error?.status)) && /schema|response.?schema|response.?mime|json|unsupported|invalid|unknown name|not found/.test(detail);
    if (!allowPlainJsonFallback || !schemaRejected) throw error;
    console.warn('[gemini] structured schema was rejected; retrying with JSON-mode prompt', {
      status: Number(error.status) || null,
      code: typeof error.code === 'string' ? error.code.slice(0, 80) : null,
    });
    return send(withGeminiSchemaPrompt(messages, schema), false);
  }
}

export function logGeminiFailure(area, error) {
  const status = Number(error?.status ?? error?.statusCode);
  console.error(`[gemini:${area}] request failed`, {
    name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
    status: Number.isFinite(status) ? status : null,
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
  });
}

function safeGeminiDetail(error) {
  const detail = String(error?.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);
  return detail ? ` (${detail})` : '';
}

export function mapGeminiError(error, task) {
  const status = Number(error?.status ?? error?.statusCode);
  const summary = `${error?.code ?? ''} ${error?.message ?? ''}`.toUpperCase();
  if (status === 429 || /RESOURCE_EXHAUSTED|QUOTA|RATE.?LIMIT/.test(summary)) {
    return new AppError(`Gemini free-tier quota or rate limits were reached${safeGeminiDetail(error)}.`, 429, 'GEMINI_RATE_LIMIT');
  }
  if (status === 401 || status === 403 || /API.?KEY|PERMISSION_DENIED|UNAUTHENTICATED/.test(summary)) {
    return new AppError(`Gemini rejected the API key or model. Check GEMINI_API_KEY and GEMINI_MODEL${safeGeminiDetail(error)}.`, 502, 'GEMINI_ACCESS_DENIED');
  }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timeout|timed out/i.test(error?.message ?? '')) {
    return new AppError(`${task} timed out on Gemini.`, 504, 'GEMINI_TIMEOUT');
  }
  if (status === 400 || status === 404 || status === 422) {
    return new AppError(`Gemini rejected the ${task.toLowerCase()} request. Check GEMINI_MODEL and output support${safeGeminiDetail(error)}.`, 502, 'GEMINI_BAD_REQUEST');
  }
  if (status >= 500) return new AppError(`Gemini is temporarily unavailable for ${task.toLowerCase()}${safeGeminiDetail(error)}.`, 502, 'GEMINI_UNAVAILABLE');
  return new AppError(`Gemini could not complete ${task.toLowerCase()}. Check the API key, model, and network${safeGeminiDetail(error)}.`, 502, 'GEMINI_UNAVAILABLE');
}
