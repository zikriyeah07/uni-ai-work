import { AppError } from '../utils/errors.js';

export const DEFAULT_OPENCODE_MODEL = 'big-pickle';
export const DEFAULT_OPENCODE_BASE_URL = 'https://opencode.ai/zen/v1';

export function getOpenCodeConfig() {
  const apiKey = process.env.OPENCODE_API_KEY?.trim();
  if (!apiKey) throw new AppError('OpenCode is unavailable because OPENCODE_API_KEY is missing from this server environment.', 503, 'OPENCODE_NOT_CONFIGURED');

  const baseUrl = (process.env.OPENCODE_BASE_URL?.trim() || DEFAULT_OPENCODE_BASE_URL).replace(/\/+$/, '');
  const model = process.env.OPENCODE_MODEL?.trim() || DEFAULT_OPENCODE_MODEL;
  return { apiKey, baseUrl, model };
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

export function buildOpenCodePayload({ model, messages, schemaName, schema, maxTokens, structuredOutput = true }) {
  return {
    model,
    messages,
    max_tokens: maxTokens,
    ...(structuredOutput ? {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schemaName,
          strict: true,
          schema: jsonSchema(schema),
        },
      },
    } : {}),
  };
}

function responseText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => typeof part?.text === 'string' ? part.text : '').join('');
}

function isStructuredOutputRejection(error) {
  const status = Number(error?.status ?? error?.statusCode);
  const detail = String(error?.message ?? '').toLowerCase();
  return [400, 404, 422].includes(status)
    && /structured.?output|response.?format|json.?schema|schema support|unsupported.{0,30}(format|schema)|(format|schema).{0,30}unsupported/.test(detail);
}

function withSchemaInstructions(messages, schemaName, schema) {
  const instruction = `Return one valid JSON object for ${schemaName}. Follow this JSON Schema exactly and return no markdown: ${JSON.stringify(jsonSchema(schema))}`;
  const systemIndex = messages.findIndex((message) => message.role === 'system' && typeof message.content === 'string');
  if (systemIndex < 0) return [{ role: 'system', content: instruction }, ...messages];
  return messages.map((message, index) => index === systemIndex
    ? { ...message, content: `${message.content}\n\n${instruction}` }
    : message);
}

import { randomUUID } from 'node:crypto';

export async function requestOpenCode({ messages, schemaName, schema, maxTokens, timeoutMs, allowPlainJsonFallback = false }, dependencies = {}) {
  const { apiKey, baseUrl, model } = getOpenCodeConfig();
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const endpoint = `${baseUrl}/chat/completions`;

  const send = async (requestPayload) => {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'x-opencode-session': randomUUID(),
      },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const detail = payload?.error?.message ?? payload?.message ?? `OpenCode returned HTTP ${response.status}.`;
      const error = new Error(String(detail));
      error.status = response.status;
      error.code = typeof payload?.error?.code === 'string' ? payload.error.code : payload?.error?.type;
      error.name = 'OpenCodeApiError';
      throw error;
    }

    const choice = payload?.choices?.[0];
    return {
      text: responseText(choice?.message?.content),
      annotations: Array.isArray(choice?.message?.annotations) ? choice.message.annotations : [],
      model: typeof payload?.model === 'string' ? payload.model : model,
      finishReason: choice?.finish_reason ?? null,
    };
  };

  const requestPayload = buildOpenCodePayload({ model, messages, schemaName, schema, maxTokens });
  try {
    return await send(requestPayload);
  } catch (error) {
    if (!allowPlainJsonFallback || !isStructuredOutputRejection(error)) throw error;
    console.warn('[opencode] structured output was rejected; retrying with schema-guided JSON text', {
      status: Number(error.status ?? error.statusCode) || null,
      code: typeof error.code === 'string' ? error.code.slice(0, 80) : null,
    });
    const fallbackPayload = buildOpenCodePayload({
      model,
      messages: withSchemaInstructions(messages, schemaName, schema),
      schemaName,
      schema,
      maxTokens,
      structuredOutput: false,
    });
    return send(fallbackPayload);
  }
}

export function mapOpenCodeError(error, task) {
  const status = Number(error?.status ?? error?.statusCode);
  const summary = `${error?.code ?? ''} ${error?.message ?? ''}`.toUpperCase();
  if (status === 429 || /RATE.?LIMIT|QUOTA|INSUFFICIENT/.test(summary)) {
    return new AppError('OpenCode rate or quota limits were reached. Wait before trying again or check your credits/model.', 429, 'OPENCODE_RATE_LIMIT');
  }
  if (status === 401 || status === 403) {
    return new AppError('OpenCode rejected the API key or model. Check OPENCODE_API_KEY and OPENCODE_MODEL.', 502, 'OPENCODE_ACCESS_DENIED');
  }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timeout|timed out/i.test(error?.message ?? '')) {
    return new AppError(`${task} timed out on OpenCode. Try again with a shorter request.`, 504, 'OPENCODE_TIMEOUT');
  }
  if (status === 400 || status === 404 || status === 422) {
    return new AppError(`OpenCode rejected the ${task.toLowerCase()} request. Check OPENCODE_MODEL, OPENCODE_BASE_URL, and request support.`, 502, 'OPENCODE_BAD_REQUEST');
  }
  if (status >= 500) return new AppError(`OpenCode is temporarily unavailable for ${task.toLowerCase()}.`, 502, 'OPENCODE_UNAVAILABLE');
  return new AppError(`OpenCode could not complete the ${task.toLowerCase()}. Check the API key, model, and network.`, 502, 'OPENCODE_UNAVAILABLE');
}

export function logOpenCodeFailure(area, error) {
  const status = Number(error?.status ?? error?.statusCode);
  console.error(`[opencode:${area}] request failed`, {
    name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
    status: Number.isFinite(status) ? status : null,
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
  });
}
