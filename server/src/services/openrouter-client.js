import { AppError } from '../utils/errors.js';

export const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';
const CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

export function getOpenRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new AppError('OpenRouter is unavailable because OPENROUTER_API_KEY is missing from this server environment. On Vercel, add it in Project Settings → Environment Variables for Production, then redeploy; a local .env file is not deployed.', 503, 'OPENROUTER_NOT_CONFIGURED');

  const model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
  if (model !== DEFAULT_OPENROUTER_MODEL && !/:free$/i.test(model)) {
    throw new AppError('OPENROUTER_MODEL must be openrouter/free or a model ID ending in :free to keep inference free.', 503, 'OPENROUTER_MODEL_NOT_FREE');
  }
  return { apiKey, model };
}

function jsonSchema(node) {
  const type = String(node?.type ?? '').toLowerCase();
  const schema = {};
  if (type) schema.type = type;
  if (node?.description) schema.description = node.description;
  if (Array.isArray(node?.enum)) schema.enum = node.enum;
  if (node?.items) schema.items = jsonSchema(node.items);
  if (node?.properties) {
    schema.properties = Object.fromEntries(Object.entries(node.properties).map(([key, value]) => [key, jsonSchema(value)]));
    schema.required = node.required ?? Object.keys(node.properties);
    schema.additionalProperties = false;
  }
  return schema;
}

export function buildOpenRouterPayload({ model, messages, schemaName, schema, maxTokens, plugins = [] }) {
  return {
    model,
    messages,
    max_tokens: maxTokens,
    reasoning: { enabled: false },
    provider: { require_parameters: true },
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: schemaName,
        strict: true,
        schema: jsonSchema(schema),
      },
    },
    ...(plugins.length ? { plugins } : {}),
  };
}

function responseText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => typeof part?.text === 'string' ? part.text : '').join('');
}

export async function requestOpenRouter({ messages, schemaName, schema, maxTokens, timeoutMs, plugins = [] }, dependencies = {}) {
  const { apiKey, model } = getOpenRouterConfig();
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const response = await fetchImpl(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildOpenRouterPayload({ model, messages, schemaName, schema, maxTokens, plugins })),
    signal: AbortSignal.timeout(timeoutMs),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = payload?.error?.message ?? payload?.message ?? `OpenRouter returned HTTP ${response.status}.`;
    const error = new Error(String(detail));
    error.status = Number(payload?.error?.code) || response.status;
    error.code = typeof payload?.error?.code === 'string' ? payload.error.code : undefined;
    error.name = 'OpenRouterApiError';
    throw error;
  }

  const choice = payload?.choices?.[0];
  return {
    text: responseText(choice?.message?.content),
    annotations: Array.isArray(choice?.message?.annotations) ? choice.message.annotations : [],
    model: typeof payload?.model === 'string' ? payload.model : model,
    finishReason: choice?.finish_reason ?? null,
  };
}

export function mapOpenRouterError(error, task) {
  const status = Number(error?.status ?? error?.statusCode);
  const summary = `${error?.code ?? ''} ${error?.message ?? ''}`.toUpperCase();
  if (status === 429 || /RATE.?LIMIT|QUOTA/.test(summary)) {
    return new AppError('OpenRouter free-model limits were reached. Wait before trying again, or choose another free model in OPENROUTER_MODEL.', 429, 'OPENROUTER_RATE_LIMIT');
  }
  if (status === 401 || status === 403) {
    return new AppError('OpenRouter rejected the API key or model. Check OPENROUTER_API_KEY and OPENROUTER_MODEL.', 502, 'OPENROUTER_ACCESS_DENIED');
  }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timeout|timed out/i.test(error?.message ?? '')) {
    return new AppError(`${task} timed out. Try again with a shorter request.`, 504, 'OPENROUTER_TIMEOUT');
  }
  if (status === 400 || status === 404 || status === 422) {
    return new AppError(`OpenRouter rejected the ${task.toLowerCase()} request. Check the free model's file and structured-output support.`, 502, 'OPENROUTER_BAD_REQUEST');
  }
  if (status >= 500) return new AppError(`OpenRouter is temporarily unavailable. Try the ${task.toLowerCase()} again shortly.`, 502, 'OPENROUTER_UNAVAILABLE');
  return new AppError(`OpenRouter could not complete the ${task.toLowerCase()}. Check the API key, free model, and network.`, 502, 'OPENROUTER_UNAVAILABLE');
}

export function logOpenRouterFailure(area, error) {
  const status = Number(error?.status ?? error?.statusCode);
  console.error(`[openrouter:${area}] request failed`, {
    name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
    status: Number.isFinite(status) ? status : null,
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
  });
}

export function parseOpenRouterJson(text, task) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new AppError(`OpenRouter returned an empty ${task.toLowerCase()}.`, 502, 'OPENROUTER_INVALID_RESPONSE');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(`OpenRouter returned invalid JSON for the ${task.toLowerCase()}.`, 502, 'OPENROUTER_INVALID_RESPONSE');
  }
}
