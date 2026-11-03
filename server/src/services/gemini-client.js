import { AppError } from '../utils/errors.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
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

export function buildGeminiPayload({ model, messages, schema, maxTokens }) {
  const { contents, systemInstruction } = toGeminiContents(messages);
  return {
    contents,
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(schema),
      maxOutputTokens: maxTokens,
      ...latencyConfig(model),
    },
  };
}

export async function requestGemini({ messages, schema, maxTokens, timeoutMs }, dependencies = {}) {
  const { apiKey, model } = getGeminiConfig();
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const response = await fetchImpl(`${GENERATE_CONTENT_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(buildGeminiPayload({ model, messages, schema, maxTokens })),
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
    error.status = Number(payload?.error?.code) || response.status;
    error.code = typeof payload?.error?.status === 'string' ? payload.error.status : undefined;
    error.name = 'GeminiApiError';
    throw error;
  }

  const candidate = payload?.candidates?.[0];
  const text = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts.map((part) => typeof part?.text === 'string' ? part.text : '').join('')
    : '';
  return { text, model, finishReason: candidate?.finishReason ?? null };
}

export function logGeminiFailure(area, error) {
  const status = Number(error?.status ?? error?.statusCode);
  console.error(`[gemini:${area}] request failed`, {
    name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
    status: Number.isFinite(status) ? status : null,
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
  });
}

export function mapGeminiError(error, task) {
  const status = Number(error?.status ?? error?.statusCode);
  const summary = `${error?.code ?? ''} ${error?.message ?? ''}`.toUpperCase();
  if (status === 429 || /RESOURCE_EXHAUSTED|QUOTA|RATE.?LIMIT/.test(summary)) {
    return new AppError('Gemini free-tier quota or rate limits were reached.', 429, 'GEMINI_RATE_LIMIT');
  }
  if (status === 401 || status === 403 || /API.?KEY|PERMISSION_DENIED|UNAUTHENTICATED/.test(summary)) {
    return new AppError('Gemini rejected the API key or model. Check GEMINI_API_KEY and GEMINI_MODEL.', 502, 'GEMINI_ACCESS_DENIED');
  }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timeout|timed out/i.test(error?.message ?? '')) {
    return new AppError(`${task} timed out on Gemini.`, 504, 'GEMINI_TIMEOUT');
  }
  if (status === 400 || status === 404 || status === 422) {
    return new AppError(`Gemini rejected the ${task.toLowerCase()} request. Check the model and structured-output support.`, 502, 'GEMINI_BAD_REQUEST');
  }
  if (status >= 500) return new AppError(`Gemini is temporarily unavailable for ${task.toLowerCase()}.`, 502, 'GEMINI_UNAVAILABLE');
  return new AppError(`Gemini could not complete ${task.toLowerCase()}. Check the API key, model, and network.`, 502, 'GEMINI_UNAVAILABLE');
}
